import { Router, type Response } from 'express';
import { z } from 'zod';
import { sql, type SQL } from 'drizzle-orm';
import { queryRows, withTransaction } from '../db/index.ts';
import {
  requireAuth,
  requireAdmin,
  optionalAuth,
  type AuthRequest,
} from '../services/auth.ts';
import { verifyObjectExistsInStorage } from '../services/upload.ts';
import { stripRawHtmlFromMarkdown } from '../../shared/safeMarkdown.ts';

export const reviewsRouter = Router();

export const MAX_REVIEW_IMAGES = 3;

// ==========================================
// 1. CHUẨN HÓA LỖI 500 (KHÔNG LỘ CHI TIẾT SQL / NỘI BỘ)
// ==========================================
export function sendReviewRouteError(res: Response, err: any, fallbackMessage: string) {
  const status =
    typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500
      ? err.statusCode
      : 500;

  if (status < 500) {
    return res.status(status).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      message: err.message || fallbackMessage,
      error: {
        code: err.code || `HTTP_${status}`,
        message: err.message || fallbackMessage,
      },
    });
  }

  console.error('[REVIEWS INTERNAL ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_SERVER_ERROR',
    message: fallbackMessage,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: fallbackMessage,
    },
  });
}

// ==========================================
// 2. RÚT GỌN TÊN NGƯỜI ĐÁNH GIÁ (KHÔNG LỘ EMAIL / SỐ ĐIỆN THOẠI)
// ==========================================
export function maskReviewerName(rawName: string | null | undefined): string {
  const cleaned = String(rawName || '').trim();
  if (!cleaned) {
    return 'Khách hàng ẩn danh';
  }

  // Nếu chuỗi vô tình là email (chứa @), chỉ lấy 2 ký tự đầu trước @ và che hoàn toàn phần còn lại
  if (cleaned.includes('@')) {
    const localPart = cleaned.split('@')[0] || 'Khách';
    const prefix = localPart.slice(0, Math.min(2, localPart.length));
    return `${prefix}***`;
  }

  // Nếu chuỗi chứa dãy số điện thoại (từ 7 chữ số liên tiếp trở lên), che toàn bộ dãy số
  const withoutPhone = cleaned.replace(/\+?\d[\d\s.-]{6,}\d/g, '***').trim();
  const words = withoutPhone.split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return 'Khách ***';
  }

  if (words.length === 1) {
    const word = words[0];
    if (word.length <= 2) {
      return `${word.slice(0, 1)}***`;
    }
    return `${word.slice(0, 1)}***${word.slice(-1)}`;
  }

  if (words.length === 2) {
    const first = words[0];
    const last = words[1];
    return `${first} ${last.slice(0, 1)}***`;
  }

  // Từ 3 từ trở lên (ví dụ "Trần Hoàng Nam" -> "Trần *** Nam")
  return `${words[0]} *** ${words[words.length - 1]}`;
}

// ==========================================
// 3. BỘ GIỚI HẠN TỐC ĐỘ ĐÁNH GIÁ TRONG RAM (BOUNDED RATE LIMITER)
// Tối đa 5 lần gửi đánh giá / 10 phút / người dùng (hoặc IP)
// Giới hạn kích thước tối đa 10.000 mục, tự dọn mục hết hạn & xóa mục cũ nhất
// ==========================================
export const REVIEW_RATE_WINDOW_MS = 10 * 60 * 1000; // 10 phút
export const REVIEW_RATE_MAX_ATTEMPTS = 5;
export const MAX_REVIEW_RATE_ENTRIES = 10000;

const reviewRateMap = new Map<string, { count: number; windowStart: number }>();
let lastReviewRatePruneTime = 0;

function pruneReviewRateMap(now: number, maxEntries = MAX_REVIEW_RATE_ENTRIES): void {
  if (now - lastReviewRatePruneTime >= 30_000 || reviewRateMap.size >= maxEntries) {
    lastReviewRatePruneTime = now;
    for (const [k, entry] of reviewRateMap.entries()) {
      if (now - entry.windowStart >= REVIEW_RATE_WINDOW_MS) {
        reviewRateMap.delete(k);
      }
    }
  }
  while (reviewRateMap.size > maxEntries) {
    const oldestKey = reviewRateMap.keys().next().value;
    if (oldestKey === undefined) break;
    reviewRateMap.delete(oldestKey);
  }
}

export function checkReviewRateLimit(key: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  pruneReviewRateMap(now);
  const entry = reviewRateMap.get(key);
  if (!entry || now - entry.windowStart >= REVIEW_RATE_WINDOW_MS) {
    return { allowed: true, remaining: REVIEW_RATE_MAX_ATTEMPTS };
  }
  if (entry.count >= REVIEW_RATE_MAX_ATTEMPTS) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: REVIEW_RATE_MAX_ATTEMPTS - entry.count };
}

export function recordReviewRateLimit(key: string): void {
  const now = Date.now();
  pruneReviewRateMap(now);
  const entry = reviewRateMap.get(key);
  if (!entry || now - entry.windowStart >= REVIEW_RATE_WINDOW_MS) {
    reviewRateMap.delete(key);
    reviewRateMap.set(key, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
    reviewRateMap.delete(key);
    reviewRateMap.set(key, entry);
  }
  pruneReviewRateMap(now);
}

export function resetReviewRateLimit(key?: string): void {
  if (key) {
    reviewRateMap.delete(key);
  } else {
    reviewRateMap.clear();
  }
}

export function getReviewRateLimitSizeForTest(): number {
  return reviewRateMap.size;
}

export function pruneReviewRateLimitWithCapForTest(maxEntries: number, now = Date.now()): void {
  pruneReviewRateMap(now, maxEntries);
}

// ==========================================
// 4. KIỂM TRA ĐƯỜNG DẪN ẢNH ĐÁNH GIÁ VÀ QUYỀN SỞ HỮU QUA BẢNG UPLOADS + STORAGE
// - Đường dẫn trong bucket công khai TUYỆT ĐỐI KHÔNG chứa userId (dạng reviews/<random_hex>/<uuid>.<ext>)
// - Quyền sở hữu được xác minh bằng bảng `uploads` trong CSDL và kiểm tra file tồn tại thực sự trong Storage
// ==========================================
export function isValidUserReviewImagePath(rawPath: string, userId?: string): boolean {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return false;
  }
  const pathStr = rawPath.trim();

  // Chặn tuyệt đối directory traversal, backslash, ký tự điều khiển, khoảng trắng hoặc URL đầy đủ
  if (
    pathStr.includes('..') ||
    pathStr.includes('\\') ||
    pathStr.includes('\0') ||
    pathStr.includes('://') ||
    pathStr.startsWith('/') ||
    pathStr.startsWith('data:') ||
    /[\s<>:"|?*]/.test(pathStr)
  ) {
    return false;
  }

  // Đường dẫn lưu trong bucket công khai KHÔNG ĐƯỢC chứa userId
  if (userId && userId.trim() && pathStr.toLowerCase().includes(userId.trim().toLowerCase())) {
    return false;
  }

  const parts = pathStr.split('/');
  if (parts.length !== 3) {
    return false;
  }

  const [prefix, randomFolder, filename] = parts;
  if (prefix !== 'reviews') {
    return false;
  }

  // Thư mục ngẫu nhiên chỉ gồm ký tự hex an toàn (8..64 ký tự), không phải UUID có dấu gạch ngang
  if (!/^[a-f0-9]{8,64}$/i.test(randomFolder)) {
    return false;
  }

  return /^[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$/i.test(filename);
}

/**
 * Xác minh toàn diện danh sách đường dẫn ảnh đánh giá:
 * 1. Cấu trúc đường dẫn hợp lệ và KHÔNG chứa userId
 * 2. Tồn tại trong bảng `uploads` với `purpose = 'review'` và thuộc quyền sở hữu của `userId`
 * 3. File thật sự tồn tại trong Storage (`verifyObjectExistsInStorage`)
 */
export async function verifyUserOwnedReviewImages(
  imageUrls: string[],
  userId: string,
  runQuery: <R = any>(sqlQuery: any) => Promise<R[]> = queryRows
): Promise<string[]> {
  const verifiedPaths: string[] = [];

  for (const rawPath of imageUrls) {
    const cleanPath = String(rawPath || '').trim();
    if (!isValidUserReviewImagePath(cleanPath, userId)) {
      const err: any = new Error(
        'Đường dẫn ảnh đánh giá không hợp lệ. Đường dẫn trong bucket công khai không được chứa userId và phải theo định dạng reviews/<random_folder>/<filename>.'
      );
      err.statusCode = 400;
      err.code = 'INVALID_REVIEW_IMAGE_PATH';
      throw err;
    }

    const uploadRows = await runQuery<{
      id: string;
      user_id: string;
      bucket: string;
      object_path: string;
      purpose: string;
    }>(sql`
      SELECT id, user_id, bucket, object_path, purpose
      FROM uploads
      WHERE object_path = ${cleanPath}
      LIMIT 1;
    `);

    if (uploadRows.length === 0) {
      const err: any = new Error(
        'Ảnh đánh giá không tồn tại trong hệ thống tải lên. Vui lòng tải ảnh lên qua /api/upload trước.'
      );
      err.statusCode = 400;
      err.code = 'REVIEW_IMAGE_NOT_UPLOADED';
      throw err;
    }

    const uploadRecord = uploadRows[0];
    if (uploadRecord.user_id.toLowerCase() !== userId.toLowerCase() || uploadRecord.purpose !== 'review') {
      const err: any = new Error(
        'Bạn không có quyền sử dụng hình ảnh đánh giá của người dùng khác hoặc sai mục đích tải lên.'
      );
      err.statusCode = 403;
      err.code = 'FORBIDDEN_REVIEW_IMAGE_OWNER';
      throw err;
    }

    const existsInStorage = await verifyObjectExistsInStorage(
      uploadRecord.bucket,
      uploadRecord.object_path
    );
    if (!existsInStorage) {
      const err: any = new Error(
        'File ảnh đánh giá không thật sự tồn tại trong Storage. Vui lòng tải lại hình ảnh.'
      );
      err.statusCode = 400;
      err.code = 'REVIEW_IMAGE_NOT_IN_STORAGE';
      throw err;
    }

    verifiedPaths.push(cleanPath);
  }

  return verifiedPaths;
}

// ==========================================
// 5. ZOD SCHEMAS CHO ĐÁNH GIÁ SẢN PHẨM
// ==========================================
const createReviewSchema = z.object({
  productId: z.string().trim().uuid('Mã sản phẩm (productId) không đúng định dạng UUID'),
  orderId: z
    .string()
    .trim()
    .min(3, 'Mã đơn hàng (orderId) không hợp lệ')
    .max(64, 'Mã đơn hàng (orderId) không được vượt quá 64 ký tự')
    .optional(),
  rating: z
    .number()
    .int('Số sao đánh giá (rating) phải là số nguyên từ 1 đến 5')
    .min(1, 'Số sao đánh giá tối thiểu là 1 sao')
    .max(5, 'Số sao đánh giá tối đa là 5 sao'),
  comment: z
    .string()
    .trim()
    .transform((val) => val.replace(/\0/g, '').trim())
    .refine((val) => val.length >= 2, 'Nội dung nhận xét phải có ít nhất 2 ký tự')
    .refine((val) => val.length <= 1000, 'Nội dung nhận xét không được vượt quá 1000 ký tự'),
  imageUrls: z
    .array(z.string().trim().min(1).max(255))
    .max(MAX_REVIEW_IMAGES, `Mỗi đánh giá chỉ được đính kèm tối đa ${MAX_REVIEW_IMAGES} hình ảnh`)
    .optional(),
});

const updateReviewSchema = z.object({
  rating: z
    .number()
    .int('Số sao đánh giá (rating) phải là số nguyên từ 1 đến 5')
    .min(1, 'Số sao đánh giá tối thiểu là 1 sao')
    .max(5, 'Số sao đánh giá tối đa là 5 sao')
    .optional(),
  comment: z
    .string()
    .trim()
    .transform((val) => val.replace(/\0/g, '').trim())
    .refine((val) => val.length >= 2, 'Nội dung nhận xét phải có ít nhất 2 ký tự')
    .refine((val) => val.length <= 1000, 'Nội dung nhận xét không được vượt quá 1000 ký tự')
    .optional(),
  imageUrls: z
    .array(z.string().trim().min(1).max(255))
    .max(MAX_REVIEW_IMAGES, `Mỗi đánh giá chỉ được đính kèm tối đa ${MAX_REVIEW_IMAGES} hình ảnh`)
    .optional(),
});

const replyReviewSchema = z.object({
  sellerReply: z
    .string()
    .trim()
    .transform((val) => stripRawHtmlFromMarkdown(val.replace(/\0/g, '')).trim())
    .refine((val) => val.length >= 2, 'Nội dung phản hồi phải có ít nhất 2 ký tự')
    .refine((val) => val.length <= 1000, 'Nội dung phản hồi không được vượt quá 1000 ký tự'),
});

export const ALLOWED_REVIEW_SORTS = [
  'newest',
  'rating_desc',
  'rating_asc',
  'highest',
  'lowest',
] as const;

export type ReviewSortOption = (typeof ALLOWED_REVIEW_SORTS)[number];

export function normalizeReviewSort(rawSort: unknown): 'newest' | 'rating_desc' | 'rating_asc' | null {
  if (rawSort === undefined || rawSort === null || String(rawSort).trim() === '') {
    return 'newest';
  }
  const s = String(rawSort).trim().toLowerCase();
  if (s === 'newest') return 'newest';
  if (s === 'rating_desc' || s === 'highest' || s === 'high') return 'rating_desc';
  if (s === 'rating_asc' || s === 'lowest' || s === 'low') return 'rating_asc';
  return null;
}

// ==========================================
// 6. HELPER TẢI DANH SÁCH ĐÁNH GIÁ & ĐƠN ĐỦ ĐIỀU KIỆN
// Hỗ trợ phân trang, lọc theo số sao, sắp xếp (mới nhất, sao cao, sao thấp),
// trả điểm trung bình, tổng số đánh giá, phân bố từng sao, cờ "Đã mua hàng" và phản hồi người bán
// ==========================================
export async function getProductReviewsData(params: {
  productId: string;
  userId?: string;
  ratingFilter?: number;
  sort?: 'newest' | 'rating_desc' | 'rating_asc';
  page?: number;
  pageSize?: number;
}) {
  const {
    productId,
    userId,
    ratingFilter,
    sort = 'newest',
    page = 1,
    pageSize = 10,
  } = params;
  const safePage = Math.max(1, page);
  const safePageSize = Math.min(50, Math.max(1, pageSize));
  const offset = (safePage - 1) * safePageSize;

  const conditions = [sql`rv.product_id = ${productId}::uuid`, sql`rv.is_visible = true`];
  if (ratingFilter && Number.isInteger(ratingFilter) && ratingFilter >= 1 && ratingFilter <= 5) {
    conditions.push(sql`rv.rating = ${ratingFilter}`);
  }
  const whereClause = sql.join(conditions, sql` AND `);

  let orderBySql: SQL = sql`rv.created_at DESC, rv.id DESC`;
  if (sort === 'rating_desc') {
    orderBySql = sql`rv.rating DESC, rv.created_at DESC, rv.id DESC`;
  } else if (sort === 'rating_asc') {
    orderBySql = sql`rv.rating ASC, rv.created_at DESC, rv.id DESC`;
  }

  const [summaryRows, breakdownRows, filteredCountRows, reviewRows] = await Promise.all([
    queryRows<{ rating_avg: number; review_count: number }>(sql`
      SELECT
        COALESCE(ROUND(AVG(rating)::numeric, 1)::float, 0)::float AS rating_avg,
        COUNT(id)::int AS review_count
      FROM reviews
      WHERE product_id = ${productId}::uuid
        AND is_visible = true;
    `),
    queryRows<{ rating: number; count: number }>(sql`
      SELECT rating, COUNT(id)::int AS count
      FROM reviews
      WHERE product_id = ${productId}::uuid
        AND is_visible = true
      GROUP BY rating;
    `),
    queryRows<{ total: number }>(sql`
      SELECT COUNT(rv.id)::int AS total
      FROM reviews rv
      WHERE ${whereClause};
    `),
    queryRows<any>(sql`
      SELECT
        rv.id,
        rv.product_id AS "productId",
        rv.order_id AS "orderId",
        rv.user_id AS "ownerUserId",
        rv.rating,
        rv.comment,
        rv.seller_reply AS "sellerReply",
        rv.seller_replied_at AS "sellerRepliedAt",
        rv.created_at AS "createdAt",
        u.full_name AS "rawFullName",
        u.avatar_url AS "userAvatar",
        COALESCE((
          SELECT json_agg(ri.image_url ORDER BY ri.id ASC)
          FROM review_images ri
          WHERE ri.review_id = rv.id
        ), '[]'::json) AS images
      FROM reviews rv
      JOIN users u ON u.id = rv.user_id
      WHERE ${whereClause}
      ORDER BY ${orderBySql}
      LIMIT ${safePageSize} OFFSET ${offset};
    `),
  ]);

  const ratingBreakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of breakdownRows) {
    const r = Number(row.rating);
    if (r >= 1 && r <= 5) {
      ratingBreakdown[r] = Number(row.count) || 0;
    }
  }

  // Che tên người đánh giá, tuyệt đối không trả email, phone hay userId
  const sanitizedReviews = reviewRows.map((row) => ({
    id: row.id,
    productId: row.productId,
    orderId: row.orderId,
    rating: Number(row.rating),
    comment: String(row.comment ?? ''),
    verifiedPurchase: true,
    verifiedPurchaseLabel: 'Đã mua hàng',
    isOwner: Boolean(userId && String(row.ownerUserId).toLowerCase() === userId.toLowerCase()),
    sellerReply: row.sellerReply ? String(row.sellerReply) : null,
    sellerRepliedAt: row.sellerRepliedAt || null,
    createdAt: row.createdAt,
    userName: maskReviewerName(row.rawFullName),
    userAvatar: row.userAvatar || null,
    images: Array.isArray(row.images) ? row.images : [],
  }));

  // Nếu có người dùng đang đăng nhập, tìm danh sách đơn hàng delivered/completed có sản phẩm này mà chưa đánh giá
  let eligibleOrders: { orderId: string; status: string; createdAt: string }[] = [];
  if (userId) {
    const eligRows = await queryRows<{ id: string; status: string; created_at: string }>(sql`
      SELECT DISTINCT o.id, o.status, o.created_at
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN product_variants pv ON pv.id = oi.variant_id
      WHERE o.user_id = ${userId}::uuid
        AND pv.product_id = ${productId}::uuid
        AND o.status IN ('delivered', 'completed')
        AND NOT EXISTS (
          SELECT 1
          FROM reviews rv
          WHERE rv.user_id = ${userId}::uuid
            AND rv.product_id = ${productId}::uuid
            AND rv.order_id = o.id
        )
      ORDER BY o.created_at DESC;
    `);
    eligibleOrders = eligRows.map((r) => ({
      orderId: r.id,
      status: r.status,
      createdAt: r.created_at,
    }));
  }

  const totalFiltered = Number(filteredCountRows[0]?.total || 0);
  const totalPages = totalFiltered === 0 ? 0 : Math.ceil(totalFiltered / safePageSize);

  return {
    ratingAvg: Number(summaryRows[0]?.rating_avg || 0),
    reviewCount: Number(summaryRows[0]?.review_count || 0),
    ratingBreakdown,
    items: sanitizedReviews,
    total: totalFiltered,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
    sort,
    pagination: {
      total: totalFiltered,
      page: safePage,
      pageSize: safePageSize,
      totalPages,
    },
    eligibleOrders,
    canReview: eligibleOrders.length > 0,
  };
}

// ==========================================
// 7. GET /api/reviews (Lấy danh sách đánh giá theo productId)
// ==========================================
reviewsRouter.get('/', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const productId = String(req.query.productId || '').trim();
    if (!productId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PRODUCT_ID',
        message: 'Vui lòng cung cấp mã sản phẩm (productId) hợp lệ',
      });
    }

    const ratingParam = req.query.rating ? Number(req.query.rating) : undefined;
    if (ratingParam !== undefined && (!Number.isInteger(ratingParam) || ratingParam < 1 || ratingParam > 5)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_RATING_FILTER',
        message: 'Bộ lọc số sao (rating) phải là số nguyên từ 1 đến 5',
      });
    }

    const normalizedSort = normalizeReviewSort(req.query.sort);
    if (!normalizedSort) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_SORT_OPTION',
        message: 'Tham số sắp xếp (sort) chỉ chấp nhận: newest, rating_desc (hoặc highest), rating_asc (hoặc lowest)',
      });
    }

    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize || 10)));

    const data = await getProductReviewsData({
      productId,
      userId: req.user?.id,
      ratingFilter: ratingParam,
      sort: normalizedSort,
      page,
      pageSize,
    });

    return res.json({
      success: true,
      ...data,
      data,
    });
  } catch (err: any) {
    return sendReviewRouteError(res, err, 'Đã xảy ra lỗi hệ thống khi tải danh sách đánh giá');
  }
});

// ==========================================
// 8. POST /api/reviews (Tạo đánh giá mới cho sản phẩm đã mua trong đơn delivered / completed)
// ==========================================
reviewsRouter.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const clientIp = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const rateKey = `user:${userId}`;
    const ipRateKey = `ip:${clientIp}`;

    // 1. Kiểm tra Rate Limit trước khi xử lý
    const userRate = checkReviewRateLimit(rateKey);
    const ipRate = checkReviewRateLimit(ipRateKey);
    if (!userRate.allowed || !ipRate.allowed) {
      return res.status(429).json({
        success: false,
        code: 'REVIEW_RATE_LIMIT_EXCEEDED',
        message: 'Bạn đã gửi quá nhiều đánh giá trong thời gian ngắn. Vui lòng thử lại sau ít phút.',
        error: {
          code: 'REVIEW_RATE_LIMIT_EXCEEDED',
          message: 'Bạn đã gửi quá nhiều đánh giá trong thời gian ngắn. Vui lòng thử lại sau ít phút.',
        },
      });
    }

    // 2. Kiểm tra dữ liệu đầu vào bằng Zod (tối đa 3 ảnh)
    const rawBody = req.body || {};
    const parsed = createReviewSchema.safeParse({
      productId: rawBody.productId,
      orderId: rawBody.orderId,
      rating: typeof rawBody.rating === 'string' ? Number(rawBody.rating) : rawBody.rating,
      comment: rawBody.comment,
      imageUrls: rawBody.imageUrls ?? rawBody.images,
    });

    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message || 'Dữ liệu đánh giá không hợp lệ';
      return res.status(400).json({
        success: false,
        code: 'INVALID_REVIEW_INPUT',
        message: msg,
        error: {
          code: 'INVALID_REVIEW_INPUT',
          message: msg,
        },
      });
    }

    const { productId, orderId: requestedOrderId, rating, comment, imageUrls = [] } = parsed.data;

    // 3. Kiểm tra bảo mật ảnh đánh giá:
    // - Path KHÔNG chứa userId (dạng reviews/<random_hex>/<uuid>.<ext>)
    // - Thuộc sở hữu của userId trong bảng `uploads`
    // - File thật sự tồn tại trong Storage
    const verifiedImages = await verifyUserOwnedReviewImages(imageUrls, userId, queryRows);

    // 4. Thực thi trong Transaction: Kiểm tra đơn hàng delivered/completed có sản phẩm này và chặn trùng lặp (user, product, order)
    const createdReview = await withTransaction(async (txQueryRows) => {
      let targetOrderId = requestedOrderId ? requestedOrderId.trim().toUpperCase() : '';

      if (targetOrderId) {
        const existingRev = await txQueryRows<{ id: string }>(sql`
          SELECT id
          FROM reviews
          WHERE user_id = ${userId}::uuid
            AND product_id = ${productId}::uuid
            AND order_id = ${targetOrderId}
          LIMIT 1;
        `);

        if (existingRev.length > 0) {
          const dupErr: any = new Error('Bạn đã đánh giá sản phẩm này cho đơn hàng này rồi');
          dupErr.statusCode = 409;
          dupErr.code = 'REVIEW_ALREADY_EXISTS';
          throw dupErr;
        }

        const orderPurchaseRows = await txQueryRows<{ id: string; status: string }>(sql`
          SELECT o.id, o.status
          FROM orders o
          JOIN order_items oi ON oi.order_id = o.id
          JOIN product_variants pv ON pv.id = oi.variant_id
          WHERE o.id = ${targetOrderId}
            AND o.user_id = ${userId}::uuid
            AND pv.product_id = ${productId}::uuid
          LIMIT 1;
        `);

        if (orderPurchaseRows.length === 0) {
          const err: any = new Error(
            'Chỉ khách hàng đã mua sản phẩm này trong đơn hàng đã giao thành công (delivered hoặc completed) mới được phép đánh giá'
          );
          err.statusCode = 403;
          err.code = 'REVIEW_NOT_ELIGIBLE';
          throw err;
        }

        const orderStatus = orderPurchaseRows[0].status;
        if (orderStatus !== 'delivered' && orderStatus !== 'completed') {
          const err: any = new Error(
            `Đơn hàng "${targetOrderId}" đang ở trạng thái "${orderStatus}". Chỉ đơn hàng đã giao (delivered) hoặc hoàn tất (completed) mới được đánh giá.`
          );
          err.statusCode = 403;
          err.code = 'REVIEW_ORDER_NOT_DELIVERED';
          throw err;
        }
      } else {
        const purchasedOrders = await txQueryRows<{ id: string }>(sql`
          SELECT DISTINCT o.id, o.created_at
          FROM orders o
          JOIN order_items oi ON oi.order_id = o.id
          JOIN product_variants pv ON pv.id = oi.variant_id
          WHERE o.user_id = ${userId}::uuid
            AND pv.product_id = ${productId}::uuid
            AND o.status IN ('delivered', 'completed')
          ORDER BY o.created_at DESC;
        `);

        if (purchasedOrders.length === 0) {
          const err: any = new Error(
            'Chỉ khách hàng đã mua sản phẩm này trong đơn hàng đã giao thành công (delivered hoặc completed) mới được phép đánh giá'
          );
          err.statusCode = 403;
          err.code = 'REVIEW_NOT_ELIGIBLE';
          throw err;
        }

        const unreviewedOrders = await txQueryRows<{ id: string }>(sql`
          SELECT DISTINCT o.id, o.created_at
          FROM orders o
          JOIN order_items oi ON oi.order_id = o.id
          JOIN product_variants pv ON pv.id = oi.variant_id
          WHERE o.user_id = ${userId}::uuid
            AND pv.product_id = ${productId}::uuid
            AND o.status IN ('delivered', 'completed')
            AND NOT EXISTS (
              SELECT 1
              FROM reviews rv
              WHERE rv.user_id = ${userId}::uuid
                AND rv.product_id = ${productId}::uuid
                AND rv.order_id = o.id
            )
          ORDER BY o.created_at DESC
          LIMIT 1;
        `);

        if (unreviewedOrders.length === 0) {
          const dupErr: any = new Error('Bạn đã đánh giá sản phẩm này cho đơn hàng đã mua rồi');
          dupErr.statusCode = 409;
          dupErr.code = 'REVIEW_ALREADY_EXISTS';
          throw dupErr;
        }

        targetOrderId = unreviewedOrders[0].id;
      }

      const insertedRows = await txQueryRows<any>(sql`
        INSERT INTO reviews (
          product_id,
          user_id,
          order_id,
          rating,
          comment
        )
        VALUES (
          ${productId}::uuid,
          ${userId}::uuid,
          ${targetOrderId},
          ${rating},
          ${comment}
        )
        RETURNING id, product_id AS "productId", order_id AS "orderId", rating, comment, created_at AS "createdAt";
      `);

      const rev = insertedRows[0];

      const savedImages: string[] = [];
      for (const cleanPath of verifiedImages) {
        await txQueryRows(sql`
          INSERT INTO review_images (review_id, image_url)
          VALUES (${rev.id}::uuid, ${cleanPath});
        `);
        savedImages.push(cleanPath);
      }

      const userRows = await txQueryRows<{ full_name: string; avatar_url: string | null }>(sql`
        SELECT full_name, avatar_url FROM users WHERE id = ${userId}::uuid LIMIT 1;
      `);

      return {
        id: rev.id,
        productId: rev.productId,
        orderId: rev.orderId,
        rating: Number(rev.rating),
        comment: String(rev.comment),
        verifiedPurchase: true,
        verifiedPurchaseLabel: 'Đã mua hàng',
        isOwner: true,
        sellerReply: null,
        sellerRepliedAt: null,
        createdAt: rev.createdAt,
        userName: maskReviewerName(userRows[0]?.full_name || req.user?.fullName),
        userAvatar: userRows[0]?.avatar_url || null,
        images: savedImages,
      };
    });

    recordReviewRateLimit(rateKey);
    recordReviewRateLimit(ipRateKey);

    return res.status(201).json({
      success: true,
      message: 'Cảm ơn bạn đã gửi đánh giá sản phẩm!',
      review: createdReview,
      data: createdReview,
    });
  } catch (err: any) {
    if (
      err?.code === '23505' ||
      String(err?.message || '').includes('uniq_user_product_order_review')
    ) {
      return res.status(409).json({
        success: false,
        code: 'REVIEW_ALREADY_EXISTS',
        message: 'Bạn đã đánh giá sản phẩm này cho đơn hàng này rồi',
        error: {
          code: 'REVIEW_ALREADY_EXISTS',
          message: 'Bạn đã đánh giá sản phẩm này cho đơn hàng này rồi',
        },
      });
    }

    return sendReviewRouteError(res, err, 'Đã xảy ra lỗi hệ thống khi xử lý đánh giá sản phẩm');
  }
});

// ==========================================
// 9. PUT /api/reviews/:id (Chủ đánh giá sửa đánh giá của chính mình; không đổi đơn hay sản phẩm)
// ==========================================
reviewsRouter.put('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const reviewId = String(req.params.id || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reviewId)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_REVIEW_ID',
        message: 'Mã đánh giá (reviewId) không hợp lệ',
      });
    }

    const existingRows = await queryRows<{
      id: string;
      user_id: string;
      product_id: string;
      order_id: string;
      rating: number;
      comment: string;
      seller_reply: string | null;
      seller_replied_at: string | null;
      created_at: string;
    }>(sql`
      SELECT id, user_id, product_id, order_id, rating, comment, seller_reply, seller_replied_at, created_at
      FROM reviews
      WHERE id = ${reviewId}::uuid
      LIMIT 1;
    `);

    if (existingRows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'REVIEW_NOT_FOUND',
        message: 'Không tìm thấy đánh giá',
      });
    }

    const existingReview = existingRows[0];

    // Mục 6(a): Chỉ chủ đánh giá mới được sửa (kể cả Admin cũng không được sửa đánh giá của khách)
    if (existingReview.user_id.toLowerCase() !== userId.toLowerCase()) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_NOT_REVIEW_OWNER',
        message: 'Chỉ chủ sở hữu đánh giá mới có quyền chỉnh sửa đánh giá này',
      });
    }

    const rawBody = req.body || {};

    // Mục 6(a): Sửa đánh giá TUYỆT ĐỐI KHÔNG được đổi đơn hàng (orderId) hay sản phẩm (productId) của đánh giá
    if (
      rawBody.productId !== undefined &&
      String(rawBody.productId).trim().toLowerCase() !== existingReview.product_id.toLowerCase()
    ) {
      return res.status(400).json({
        success: false,
        code: 'CANNOT_CHANGE_REVIEW_TARGET',
        message: 'Không được phép thay đổi sản phẩm (productId) của đánh giá đã tạo',
      });
    }

    if (
      rawBody.orderId !== undefined &&
      String(rawBody.orderId).trim().toUpperCase() !== existingReview.order_id.toUpperCase()
    ) {
      return res.status(400).json({
        success: false,
        code: 'CANNOT_CHANGE_REVIEW_TARGET',
        message: 'Không được phép thay đổi mã đơn hàng (orderId) của đánh giá đã tạo',
      });
    }

    const parsed = updateReviewSchema.safeParse({
      rating:
        rawBody.rating !== undefined
          ? typeof rawBody.rating === 'string'
            ? Number(rawBody.rating)
            : rawBody.rating
          : undefined,
      comment: rawBody.comment,
      imageUrls: rawBody.imageUrls ?? rawBody.images,
    });

    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message || 'Dữ liệu cập nhật đánh giá không hợp lệ';
      return res.status(400).json({
        success: false,
        code: 'INVALID_REVIEW_INPUT',
        message: msg,
      });
    }

    const nextRating = parsed.data.rating ?? Number(existingReview.rating);
    const nextComment = parsed.data.comment ?? String(existingReview.comment ?? '');
    const rawNextImages = parsed.data.imageUrls;

    let verifiedImages: string[] | undefined;
    if (rawNextImages !== undefined) {
      verifiedImages = await verifyUserOwnedReviewImages(rawNextImages, userId, queryRows);
    }

    const updatedReview = await withTransaction(async (txQueryRows) => {
      // Chỉ cập nhật rating và comment, giữ nguyên bất biến product_id và order_id
      const updRows = await txQueryRows<any>(sql`
        UPDATE reviews
        SET rating = ${nextRating},
            comment = ${nextComment}
        WHERE id = ${reviewId}::uuid
          AND user_id = ${userId}::uuid
        RETURNING
          id,
          product_id AS "productId",
          order_id AS "orderId",
          rating,
          comment,
          seller_reply AS "sellerReply",
          seller_replied_at AS "sellerRepliedAt",
          created_at AS "createdAt";
      `);

      const rev = updRows[0];

      let finalImages: string[] = [];
      if (verifiedImages !== undefined) {
        await txQueryRows(sql`
          DELETE FROM review_images
          WHERE review_id = ${reviewId}::uuid;
        `);
        for (const cleanPath of verifiedImages) {
          await txQueryRows(sql`
            INSERT INTO review_images (review_id, image_url)
            VALUES (${reviewId}::uuid, ${cleanPath});
          `);
          finalImages.push(cleanPath);
        }
      } else {
        const imgRows = await txQueryRows<{ image_url: string }>(sql`
          SELECT image_url FROM review_images WHERE review_id = ${reviewId}::uuid ORDER BY id ASC;
        `);
        finalImages = imgRows.map((r) => r.image_url);
      }

      const userRows = await txQueryRows<{ full_name: string; avatar_url: string | null }>(sql`
        SELECT full_name, avatar_url FROM users WHERE id = ${userId}::uuid LIMIT 1;
      `);

      return {
        id: rev.id,
        productId: rev.productId,
        orderId: rev.orderId,
        rating: Number(rev.rating),
        comment: String(rev.comment),
        verifiedPurchase: true,
        verifiedPurchaseLabel: 'Đã mua hàng',
        isOwner: true,
        sellerReply: rev.sellerReply || null,
        sellerRepliedAt: rev.sellerRepliedAt || null,
        createdAt: rev.createdAt,
        userName: maskReviewerName(userRows[0]?.full_name || req.user?.fullName),
        userAvatar: userRows[0]?.avatar_url || null,
        images: finalImages,
      };
    });

    return res.json({
      success: true,
      message: 'Đã cập nhật đánh giá thành công',
      review: updatedReview,
      data: updatedReview,
    });
  } catch (err: any) {
    return sendReviewRouteError(res, err, 'Đã xảy ra lỗi hệ thống khi cập nhật đánh giá');
  }
});

// ==========================================
// 10. DELETE /api/reviews/:id (Chỉ chủ đánh giá mới được xóa ở Giai đoạn 6a; Admin xóa ở Giai đoạn 8)
// ==========================================
reviewsRouter.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const reviewId = String(req.params.id || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reviewId)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_REVIEW_ID',
        message: 'Mã đánh giá (reviewId) không hợp lệ',
      });
    }

    const existingRows = await queryRows<{
      id: string;
      user_id: string;
      product_id: string;
      order_id: string;
    }>(sql`
      SELECT id, user_id, product_id, order_id
      FROM reviews
      WHERE id = ${reviewId}::uuid
      LIMIT 1;
    `);

    if (existingRows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'REVIEW_NOT_FOUND',
        message: 'Không tìm thấy đánh giá',
      });
    }

    const existingReview = existingRows[0];

    // Mục 6(a): Chỉ chủ đánh giá mới được xóa qua DELETE /api/reviews/:id (Admin xóa ở Giai đoạn 8)
    if (existingReview.user_id.toLowerCase() !== userId.toLowerCase()) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_NOT_REVIEW_OWNER',
        message: 'Chỉ chủ sở hữu đánh giá mới có quyền xóa đánh giá này',
      });
    }

    await queryRows(sql`
      DELETE FROM reviews
      WHERE id = ${reviewId}::uuid
        AND user_id = ${userId}::uuid;
    `);

    return res.json({
      success: true,
      message: 'Đã xóa đánh giá của bạn thành công',
      deletedId: reviewId,
      productId: existingReview.product_id,
      orderId: existingReview.order_id,
    });
  } catch (err: any) {
    return sendReviewRouteError(res, err, 'Đã xảy ra lỗi hệ thống khi xóa đánh giá');
  }
});

// ==========================================
// 11. PUT /api/reviews/:id/reply (Dùng middleware requireAdmin ở tầng router; văn bản thuần tối đa 1000 ký tự)
// ==========================================
reviewsRouter.put('/:id/reply', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const reviewId = String(req.params.id || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reviewId)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_REVIEW_ID',
        message: 'Mã đánh giá (reviewId) không hợp lệ',
      });
    }

    const parsed = replyReviewSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_REPLY_INPUT',
        message: parsed.error.issues[0]?.message || 'Nội dung phản hồi không hợp lệ',
      });
    }

    const updated = await withTransaction(async (txQueryRows) => {
      const rows = await txQueryRows<any>(sql`
        UPDATE reviews
        SET seller_reply = ${parsed.data.sellerReply},
            seller_replied_at = NOW(),
            updated_at = NOW()
        WHERE id = ${reviewId}::uuid
        RETURNING
          id,
          product_id AS "productId",
          order_id AS "orderId",
          rating,
          comment,
          seller_reply AS "sellerReply",
          seller_replied_at AS "sellerRepliedAt",
          is_visible AS "isVisible",
          hidden_reason AS "hiddenReason",
          created_at AS "createdAt",
          updated_at AS "updatedAt";
      `);

      if (rows.length > 0 && req.user?.id) {
        await txQueryRows(sql`
          INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, summary)
          VALUES (
            ${req.user.id}::uuid,
            'REVIEW_REPLY',
            'review',
            ${reviewId},
            ${`Phản hồi đánh giá cho đơn ${rows[0].orderId} (${parsed.data.sellerReply.length} ký tự)`}
          );
        `);
      }

      return rows;
    });

    if (updated.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đánh giá',
      });
    }

    return res.json({
      success: true,
      message: 'Đã cập nhật phản hồi đánh giá thành công',
      review: updated[0],
      data: updated[0],
    });
  } catch (err: any) {
    return sendReviewRouteError(res, err, 'Đã xảy ra lỗi hệ thống khi phản hồi đánh giá');
  }
});
