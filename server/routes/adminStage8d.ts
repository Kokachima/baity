import { Router, type Response } from 'express';
import { z } from 'zod';
import { sql, type SQL } from 'drizzle-orm';
import { queryRows, withTransaction } from '../db/index.ts';
import { requireAuth, requireAdmin, type AuthRequest } from '../services/auth.ts';
import { insertAdminAuditLogInTx } from '../services/orderStateMachine.ts';
import { getStoreShippingSettings } from '../services/pricing.ts';
import {
  PAYMENT_STATUS,
  SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION,
  SELLER_CHAT_MESSAGE_MAX_LENGTH,
} from '../../shared/contracts.ts';
import { stripRawHtmlFromMarkdown } from '../../shared/safeMarkdown.ts';
import { maskReviewerName } from './reviews.ts';

// ============================================================================
// 1. HẰNG SỐ ĐỊNH NGHĨA CHỈ SỐ THỐNG KÊ & BẢO VỆ CSV
// ============================================================================
export const STATS_METRIC_DEFINITIONS = {
  netRevenue:
    'Doanh thu thực = Tổng tiền đơn hàng đã giao hoặc hoàn tất (orders.total_amount của các đơn status IN (delivered, completed), ĐÃ BAO GỒM phí vận chuyển khách thanh toán: subtotal - discount_amount + shipping_fee) tính theo ngày giao hàng (delivered_at, múi giờ Asia/Ho_Chi_Minh) TRỪ tổng tiền hoàn đã hoàn tất (return_requests.refund_amount của các yêu cầu type = refund và status = completed; chỉ bao gồm phí vận chuyển khi cửa hàng xác nhận lỗi thuộc về cửa hàng) tính theo ngày hoàn tất hoàn tiền (COALESCE(refunded_at, updated_at), múi giờ Asia/Ho_Chi_Minh).',
  placedOrderValue:
    'Giá trị đơn đặt = Tổng tiền (orders.total_amount, đã bao gồm phí vận chuyển) của các đơn hàng chưa hủy (status <> cancelled) tính theo ngày tạo đơn (created_at, múi giờ Asia/Ho_Chi_Minh).',
  shippingFeeNote:
    'Doanh thu thực CÓ bao gồm phí vận chuyển khách đã thanh toán trong orders.total_amount (trừ trường hợp đơn miễn phí vận chuyển 0₫ hoặc hoàn tiền lỗi cửa hàng có hoàn phí vận chuyển trong return_requests.refund_amount).',
  shippingFeePolicy:
    'Doanh thu thực CÓ bao gồm phí vận chuyển khách đã thanh toán trong orders.total_amount (subtotal - discount_amount + shipping_fee); khi hoàn tiền (return_requests.refund_amount), phí vận chuyển chỉ được hoàn lại nếu lỗi thuộc về cửa hàng.',
} as const;

export const MAX_STATS_RANGE_DAYS = 366;
export const MAX_STATS_BUCKETS = 400;
export const MAX_CSV_EXPORT_ROWS = 50000;
let maxCsvExportRowsOverrideForTest: number | null = null;

export function setMaxCsvExportRowsForTest(limit: number | null): void {
  maxCsvExportRowsOverrideForTest = limit;
}

// Giới hạn tần suất xuất CSV (tối đa 10 lần / 5 phút / admin)
const CSV_RATE_WINDOW_MS = 5 * 60 * 1000;
const CSV_RATE_MAX_REQUESTS = 10;
const csvExportRateMap = new Map<string, { count: number; windowStart: number }>();

export function checkAndRecordCsvExportRateLimit(adminId: string): boolean {
  const now = Date.now();
  for (const [k, v] of csvExportRateMap.entries()) {
    if (now - v.windowStart >= CSV_RATE_WINDOW_MS) {
      csvExportRateMap.delete(k);
    }
  }
  const current = csvExportRateMap.get(adminId);
  if (!current || now - current.windowStart >= CSV_RATE_WINDOW_MS) {
    csvExportRateMap.set(adminId, { count: 1, windowStart: now });
    return true;
  }
  if (current.count >= CSV_RATE_MAX_REQUESTS) {
    return false;
  }
  current.count += 1;
  return true;
}

export function resetCsvExportRateLimitForTest(): void {
  csvExportRateMap.clear();
}

/**
 * Chống CSV Formula Injection:
 * Mọi ô bắt đầu bằng =, +, -, @, tab (\t), hoặc xuống dòng (\r, \n) (kể cả khi có khoảng trắng đầu)
 * đều được thêm dấu nháy đơn (') ở đầu trước khi đóng gói CSV.
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  let str = String(value);
  if (/^[\s]*[=+\-@\t\r\n]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function sendStage8dError(res: Response, err: any, fallbackMessage: string) {
  const status =
    typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500
      ? err.statusCode
      : 500;

  if (status < 500) {
    const code = err.code || `HTTP_${status}`;
    const message = err.message || fallbackMessage;
    return res.status(status).json({
      success: false,
      code,
      message,
      error: { code, message },
    });
  }

  console.error('[ADMIN 8D ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
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

// ============================================================================
// 2. ZOD SCHEMAS CHO ĐÁNH GIÁ ADMIN & THỐNG KÊ THEO MÚI GIỜ ASIA/HO_CHI_MINH
// ============================================================================
const adminReviewsQuerySchema = z.object({
  rating: z
    .string()
    .trim()
    .optional()
    .refine(
      (val) => !val || val === 'all' || /^[1-5]$/.test(val),
      'Bộ lọc số sao (rating) phải từ 1 đến 5'
    ),
  productId: z
    .string()
    .trim()
    .optional()
    .refine(
      (val) =>
        !val ||
        val === 'all' ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val),
      'Mã sản phẩm (productId) không đúng định dạng UUID'
    ),
  replied: z.enum(['all', 'replied', 'unreplied']).optional().default('all'),
  visibility: z.enum(['all', 'visible', 'hidden']).optional().default('all'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const patchReviewVisibilitySchema = z
  .object({
    isVisible: z.boolean().optional(),
    isHidden: z.boolean().optional(),
    reason: z
      .string()
      .trim()
      .transform((val) => stripRawHtmlFromMarkdown(val.replace(/\0/g, '')).trim())
      .refine((val) => val.length >= 2, 'Lý do ẩn/hiện đánh giá phải có ít nhất 2 ký tự')
      .refine((val) => val.length <= 500, 'Lý do ẩn/hiện đánh giá không vượt quá 500 ký tự'),
  })
  .refine(
    (data) => typeof data.isVisible === 'boolean' || typeof data.isHidden === 'boolean',
    'Phải cung cấp trạng thái isVisible hoặc isHidden (boolean)'
  );

function getVietnamTodayYmd(): string {
  const vnNow = new Date(Date.now() + 7 * 3600 * 1000);
  return vnNow.toISOString().slice(0, 10);
}

function getVietnamDaysAgoYmd(daysAgo: number): string {
  const vnDate = new Date(Date.now() + 7 * 3600 * 1000 - daysAgo * 86400 * 1000);
  return vnDate.toISOString().slice(0, 10);
}

function parseYmdToUtcMidnight(ymd: string): number | null {
  const trimmed = String(ymd || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [y, m, d] = trimmed.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return dt.getTime();
}

const statsDateRangeSchema = z.object({
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  granularity: z.enum(['day', 'week', 'month']).optional().default('day'),
});

export interface ValidatedStatsRange {
  fromYmd: string;
  toYmd: string;
  fromIsoTz: string;
  toEndIsoTz: string;
  inclusiveDays: number;
  granularity: 'day' | 'week' | 'month';
}

export function validateStatsDateRange(rawQuery: Record<string, any>): {
  ok: true;
  data: ValidatedStatsRange;
} | {
  ok: false;
  code: string;
  message: string;
} {
  const parsed = statsDateRangeSchema.safeParse(rawQuery);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_STATS_QUERY',
      message: parsed.error.issues[0]?.message || 'Tham số truy vấn thống kê không hợp lệ',
    };
  }

  const toYmd = parsed.data.to ? parsed.data.to.slice(0, 10) : getVietnamTodayYmd();
  const fromYmd = parsed.data.from ? parsed.data.from.slice(0, 10) : getVietnamDaysAgoYmd(29);
  const granularity = parsed.data.granularity;

  const fromMs = parseYmdToUtcMidnight(fromYmd);
  const toMs = parseYmdToUtcMidnight(toYmd);

  if (fromMs === null || toMs === null) {
    return {
      ok: false,
      code: 'INVALID_DATE_FORMAT',
      message: 'Ngày bắt đầu (from) và ngày kết thúc (to) phải theo định dạng YYYY-MM-DD hợp lệ',
    };
  }

  if (fromMs > toMs) {
    return {
      ok: false,
      code: 'INVALID_DATE_RANGE_ORDER',
      message: 'Ngày bắt đầu (from) phải nhỏ hơn hoặc bằng ngày kết thúc (to)',
    };
  }

  const inclusiveDays = Math.floor((toMs - fromMs) / (24 * 3600 * 1000)) + 1;
  if (inclusiveDays > MAX_STATS_RANGE_DAYS) {
    return {
      ok: false,
      code: 'DATE_RANGE_TOO_LARGE',
      message: `Khoảng thời gian thống kê tối đa là ${MAX_STATS_RANGE_DAYS} ngày (hiện tại: ${inclusiveDays} ngày)`,
    };
  }

  const estimatedBuckets =
    granularity === 'day'
      ? inclusiveDays
      : granularity === 'week'
      ? Math.ceil(inclusiveDays / 7) + 1
      : Math.ceil(inclusiveDays / 28) + 1;

  if (estimatedBuckets > MAX_STATS_BUCKETS) {
    return {
      ok: false,
      code: 'TOO_MANY_BUCKETS',
      message: `Số mốc thời gian không được vượt quá ${MAX_STATS_BUCKETS} mốc`,
    };
  }

  return {
    ok: true,
    data: {
      fromYmd,
      toYmd,
      fromIsoTz: `${fromYmd}T00:00:00+07:00`,
      toEndIsoTz: `${toYmd}T23:59:59.999+07:00`,
      inclusiveDays,
      granularity,
    },
  };
}

// ============================================================================
// 3. HELPER ĐẾM TỔNG QUAN VẬN HÀNH (CHỈ TRẢ SỐ ĐẾM, KHÔNG LỘ PII)
// ============================================================================
export async function getOperationsOverviewCounts() {
  const shippingSettings = await getStoreShippingSettings();
  const lowStockThreshold = shippingSettings.lowStockThreshold ?? 5;

  const rows = await queryRows<{
    pending_confirmation_orders: number;
    awaiting_vietqr_orders: number;
    pending_return_requests: number;
    active_return_requests: number;
    refund_needed_payments: number;
    unresolved_mismatch_events: number;
    low_stock_variants: number;
    unreplied_reviews: number;
    unreplied_chats: number;
  }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM orders WHERE status = 'pending') AS pending_confirmation_orders,
      (
        SELECT COUNT(*)::int
        FROM orders o
        WHERE o.status = 'pending'
          AND EXISTS (
            SELECT 1
            FROM payments pm
            WHERE pm.order_id = o.id
              AND pm.method = 'vietqr'
              AND pm.status = 'pending'
          )
      ) AS awaiting_vietqr_orders,
      (SELECT COUNT(*)::int FROM return_requests WHERE status = 'pending') AS pending_return_requests,
      (SELECT COUNT(*)::int FROM return_requests WHERE status IN ('pending', 'approved', 'receiving')) AS active_return_requests,
      (SELECT COUNT(*)::int FROM payments WHERE status = ${PAYMENT_STATUS.REFUND_NEEDED}) AS refund_needed_payments,
      (SELECT COUNT(*)::int FROM payment_events WHERE event_type = 'amount_mismatch' AND resolved_at IS NULL) AS unresolved_mismatch_events,
      (SELECT COUNT(*)::int FROM product_variants WHERE stock_quantity <= ${lowStockThreshold}) AS low_stock_variants,
      (
        SELECT COUNT(*)::int
        FROM reviews
        WHERE is_visible = true
          AND (seller_reply IS NULL OR BTRIM(seller_reply) = '')
      ) AS unreplied_reviews,
      (
        SELECT COUNT(*)::int
        FROM chat_conversations
        WHERE mode = 'human'
          AND status = 'open'
          AND unread_admin > 0
      ) AS unreplied_chats;
  `);

  const r = rows[0] || {
    pending_confirmation_orders: 0,
    awaiting_vietqr_orders: 0,
    pending_return_requests: 0,
    active_return_requests: 0,
    refund_needed_payments: 0,
    unresolved_mismatch_events: 0,
    low_stock_variants: 0,
    unreplied_reviews: 0,
    unreplied_chats: 0,
  };

  const refundNeededCount = Number(r.refund_needed_payments || 0);
  const paymentMismatchCount = Number(r.unresolved_mismatch_events || 0);

  return {
    pendingOrders: Number(r.pending_confirmation_orders || 0),
    pendingConfirmationOrders: Number(r.pending_confirmation_orders || 0),
    awaitingVietQrOrders: Number(r.awaiting_vietqr_orders || 0),
    pendingReturns: Number(r.pending_return_requests || 0),
    pendingReturnRequests: Number(r.pending_return_requests || 0),
    activeReturnRequests: Number(r.active_return_requests || 0),
    refundNeededCount,
    paymentMismatchCount,
    unresolvedPaymentIssues: refundNeededCount + paymentMismatchCount,
    lowStockVariants: Number(r.low_stock_variants || 0),
    lowStockThreshold,
    unrepliedReviews: Number(r.unreplied_reviews || 0),
    unrepliedChats: Number(r.unreplied_chats || 0),
  };
}

// ============================================================================
// 4. ĐĂNG KÝ CÁC ROUTE GIAI ĐOẠN 8D & 6D TRÊN ADMIN ROUTER
// ============================================================================
export const adminStage8dRouter = Router();
let stage8dRoutesInitialized = false;

export function registerAdminStage8dRoutes(parentRouter: Router): void {
  parentRouter.use(adminStage8dRouter);
  if (stage8dRoutesInitialized) return;
  stage8dRoutesInitialized = true;
  const adminRouter = adminStage8dRouter;

  // Bảo vệ tường minh ở tầng router
  adminRouter.use(requireAuth, requireAdmin);

  // --------------------------------------------------------------------------
  // 4.1 GET /api/admin/overview — Trang tổng quan vận hành (chỉ chứa số đếm, không PII)
  // --------------------------------------------------------------------------
  adminRouter.get('/overview', async (_req: AuthRequest, res: Response) => {
    try {
      const counts = await getOperationsOverviewCounts();
      return res.json({
        success: true,
        overview: counts,
        data: counts,
      });
    } catch (err: any) {
      return sendStage8dError(res, err, 'Lỗi tải số liệu tổng quan vận hành');
    }
  });

  // --------------------------------------------------------------------------
  // 4.2 GET /api/admin/reviews — Danh sách đánh giá (lọc theo sao, sản phẩm, phản hồi, hiển thị)
  // --------------------------------------------------------------------------
  adminRouter.get('/reviews', async (req: AuthRequest, res: Response) => {
    try {
      const parsed = adminReviewsQuerySchema.safeParse({
        rating: req.query.rating,
        productId: req.query.productId,
        replied: req.query.replied || 'all',
        visibility: req.query.visibility || 'all',
        page: req.query.page || 1,
        limit: req.query.limit || req.query.pageSize || 20,
      });

      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_ADMIN_REVIEWS_QUERY',
          message: parsed.error.issues[0]?.message || 'Tham số lọc đánh giá không hợp lệ',
        });
      }

      const { rating, productId, replied, visibility, page, limit } = parsed.data;
      const conditions: SQL[] = [];

      if (rating && rating !== 'all') {
        conditions.push(sql`rv.rating = ${Number(rating)}`);
      }
      if (productId && productId !== 'all') {
        conditions.push(sql`rv.product_id = ${productId}::uuid`);
      }
      if (replied === 'replied') {
        conditions.push(sql`(rv.seller_reply IS NOT NULL AND BTRIM(rv.seller_reply) <> '')`);
      } else if (replied === 'unreplied') {
        conditions.push(sql`(rv.seller_reply IS NULL OR BTRIM(rv.seller_reply) = '')`);
      }
      if (visibility === 'visible') {
        conditions.push(sql`rv.is_visible = true`);
      } else if (visibility === 'hidden') {
        conditions.push(sql`rv.is_visible = false`);
      }

      const whereSql =
        conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
      const offset = (page - 1) * limit;

      const [countRows, summaryRows, itemRows] = await Promise.all([
        queryRows<{ total: number }>(sql`
          SELECT COUNT(*)::int AS total
          FROM reviews rv
          ${whereSql};
        `),
        queryRows<{
          total_reviews: number;
          unreplied_visible_reviews: number;
          hidden_reviews: number;
        }>(sql`
          SELECT
            COUNT(*)::int AS total_reviews,
            COUNT(*) FILTER (
              WHERE is_visible = true AND (seller_reply IS NULL OR BTRIM(seller_reply) = '')
            )::int AS unreplied_visible_reviews,
            COUNT(*) FILTER (WHERE is_visible = false)::int AS hidden_reviews
          FROM reviews;
        `),
        queryRows<any>(sql`
          SELECT
            rv.id,
            rv.product_id AS "productId",
            p.name AS "productName",
            p.slug AS "productSlug",
            rv.order_id AS "orderId",
            rv.rating,
            rv.comment,
            rv.seller_reply AS "sellerReply",
            rv.seller_replied_at AS "sellerRepliedAt",
            rv.is_visible AS "isVisible",
            rv.hidden_reason AS "hiddenReason",
            rv.created_at AS "createdAt",
            rv.updated_at AS "updatedAt",
            u.full_name AS "rawFullName",
            COALESCE((
              SELECT json_agg(ri.image_url ORDER BY ri.id ASC)
              FROM review_images ri
              WHERE ri.review_id = rv.id
            ), '[]'::json) AS images
          FROM reviews rv
          JOIN products p ON p.id = rv.product_id
          JOIN users u ON u.id = rv.user_id
          ${whereSql}
          ORDER BY rv.created_at DESC, rv.id DESC
          LIMIT ${limit} OFFSET ${offset};
        `),
      ]);

      const total = Number(countRows[0]?.total || 0);
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const summary = summaryRows[0] || {
        total_reviews: 0,
        unreplied_visible_reviews: 0,
        hidden_reviews: 0,
      };

      const items = itemRows.map((row) => ({
        id: row.id,
        productId: row.productId,
        productName: row.productName,
        productSlug: row.productSlug,
        orderId: row.orderId,
        rating: Number(row.rating),
        comment: String(row.comment || ''),
        sellerReply: row.sellerReply || null,
        sellerRepliedAt: row.sellerRepliedAt || null,
        isVisible: Boolean(row.isVisible),
        hiddenReason: row.hiddenReason || null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        reviewerName: maskReviewerName(row.rawFullName),
        images: Array.isArray(row.images) ? row.images : [],
      }));

      return res.json({
        success: true,
        items,
        data: items,
        total,
        page,
        limit,
        totalPages,
        summary: {
          totalReviews: Number(summary.total_reviews || 0),
          unrepliedVisibleReviews: Number(summary.unreplied_visible_reviews || 0),
          hiddenReviews: Number(summary.hidden_reviews || 0),
        },
      });
    } catch (err: any) {
      return sendStage8dError(res, err, 'Lỗi tải danh sách đánh giá quản trị');
    }
  });

  // --------------------------------------------------------------------------
  // 4.3 PATCH /api/admin/reviews/:id/visibility — Ẩn/hiện đánh giá vi phạm kèm lý do & ghi audit log
  // --------------------------------------------------------------------------
  adminRouter.patch('/reviews/:id/visibility', async (req: AuthRequest, res: Response) => {
    try {
      const adminId = req.user!.id;
      const reviewId = String(req.params.id || '').trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reviewId)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_REVIEW_ID',
          message: 'Mã đánh giá (reviewId) không đúng định dạng UUID',
        });
      }

      const parsed = patchReviewVisibilitySchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_VISIBILITY_INPUT',
          message: parsed.error.issues[0]?.message || 'Dữ liệu ẩn/hiện đánh giá không hợp lệ',
        });
      }

      const nextIsVisible =
        typeof parsed.data.isVisible === 'boolean'
          ? parsed.data.isVisible
          : !parsed.data.isHidden;
      const cleanReason = parsed.data.reason;

      const updated = await withTransaction(async (txQueryRows) => {
        const existingRows = await txQueryRows<{
          id: string;
          product_id: string;
          order_id: string;
          is_visible: boolean;
        }>(sql`
          SELECT id, product_id, order_id, is_visible
          FROM reviews
          WHERE id = ${reviewId}::uuid
          FOR UPDATE;
        `);

        if (existingRows.length === 0) {
          const err: any = new Error('Không tìm thấy đánh giá cần cập nhật');
          err.statusCode = 404;
          err.code = 'REVIEW_NOT_FOUND';
          throw err;
        }

        const updRows = await txQueryRows<any>(sql`
          UPDATE reviews
          SET is_visible = ${nextIsVisible},
              hidden_reason = ${nextIsVisible ? null : cleanReason},
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

        const auditLog = await insertAdminAuditLogInTx(txQueryRows, {
          adminId,
          action: nextIsVisible ? 'REVIEW_RESTORE_VISIBILITY' : 'REVIEW_HIDE_VIOLATING',
          targetType: 'review',
          targetId: reviewId,
          summary: nextIsVisible
            ? `Hiển thị lại đánh giá ${reviewId} (đơn ${existingRows[0].order_id}). Lý do: ${cleanReason}`
            : `Ẩn đánh giá vi phạm ${reviewId} (đơn ${existingRows[0].order_id}). Lý do: ${cleanReason}`,
        });

        return {
          review: updRows[0],
          auditLogId: auditLog.id,
        };
      });

      return res.json({
        success: true,
        message: nextIsVisible
          ? 'Đã hiển thị lại đánh giá trên cửa hàng'
          : 'Đã ẩn đánh giá vi phạm và cập nhật lại điểm trung bình sản phẩm',
        review: updated.review,
        data: updated.review,
        auditLogId: updated.auditLogId,
      });
    } catch (err: any) {
      return sendStage8dError(res, err, 'Lỗi cập nhật trạng thái hiển thị của đánh giá');
    }
  });

  // --------------------------------------------------------------------------
  // 4.4 GET /api/admin/stats/overview?from&to&granularity=day|week|month
  // Toàn bộ phép tính bằng SQL với generate_series theo múi giờ Asia/Ho_Chi_Minh (cố định 2 truy vấn, không N+1)
  // Dùng COALESCE(refunded_at, updated_at) cho kỳ hoàn tiền để việc sửa ghi chú sau hoàn tiền không đổi số liệu theo kỳ.
  // --------------------------------------------------------------------------
  adminRouter.get('/stats/overview', async (req: AuthRequest, res: Response) => {
    try {
      const rangeValidation = validateStatsDateRange(req.query);
      if (!rangeValidation.ok) {
        return res.status(400).json({
          success: false,
          code: rangeValidation.code,
          message: rangeValidation.message,
        });
      }

      const { fromYmd, toYmd, fromIsoTz, toEndIsoTz, granularity } = rangeValidation.data;
      const truncUnit =
        granularity === 'week' ? 'week' : granularity === 'month' ? 'month' : 'day';
      const stepInterval =
        granularity === 'week' ? '1 week' : granularity === 'month' ? '1 month' : '1 day';

      const [summaryAndBreakdownRows, seriesRows] = await Promise.all([
        queryRows<any>(sql`
          WITH placed_in_range AS (
            SELECT
              id,
              user_id,
              status,
              total_amount
            FROM orders
            WHERE created_at >= ${fromIsoTz}::timestamptz
              AND created_at <= ${toEndIsoTz}::timestamptz
          ),
          delivered_in_range AS (
            SELECT
              id,
              total_amount
            FROM orders
            WHERE status IN ('delivered', 'completed')
              AND COALESCE(delivered_at, completed_at, created_at) >= ${fromIsoTz}::timestamptz
              AND COALESCE(delivered_at, completed_at, created_at) <= ${toEndIsoTz}::timestamptz
          ),
          refunds_in_range AS (
            SELECT
              COALESCE(SUM(refund_amount), 0)::bigint AS completed_refund_amount,
              COUNT(*)::int AS completed_refund_count
            FROM return_requests
            WHERE type = 'refund'
              AND status = 'completed'
              AND COALESCE(refunded_at, updated_at) >= ${fromIsoTz}::timestamptz
              AND COALESCE(refunded_at, updated_at) <= ${toEndIsoTz}::timestamptz
          ),
          customer_orders AS (
            SELECT
              u.id AS user_id,
              (
                u.created_at >= ${fromIsoTz}::timestamptz
                AND u.created_at <= ${toEndIsoTz}::timestamptz
              ) AS is_new_in_range,
              (
                SELECT COUNT(*)::int
                FROM orders o_all
                WHERE o_all.user_id = u.id
                  AND o_all.status <> 'cancelled'
              ) AS lifetime_non_cancelled_orders,
              EXISTS (
                SELECT 1
                FROM placed_in_range pir
                WHERE pir.user_id = u.id
                  AND pir.status <> 'cancelled'
              ) AS ordered_in_range
            FROM users u
            WHERE u.role = 'customer'
          )
          SELECT
            (SELECT COALESCE(SUM(total_amount), 0)::bigint FROM delivered_in_range) AS gross_delivered_revenue,
            (SELECT COUNT(*)::int FROM delivered_in_range) AS delivered_order_count,
            (SELECT completed_refund_amount FROM refunds_in_range) AS completed_refund_amount,
            (SELECT completed_refund_count FROM refunds_in_range) AS completed_refund_count,
            (SELECT COALESCE(SUM(total_amount), 0)::bigint FROM placed_in_range WHERE status <> 'cancelled') AS placed_order_value,
            (SELECT COUNT(*)::int FROM placed_in_range WHERE status <> 'cancelled') AS placed_order_count,
            (SELECT COUNT(*)::int FROM placed_in_range) AS total_created_orders,
            (SELECT COUNT(*)::int FROM placed_in_range WHERE status = 'cancelled') AS cancelled_order_count,
            (SELECT COUNT(*)::int FROM customer_orders WHERE is_new_in_range = true) AS new_customers_count,
            (SELECT COUNT(*)::int FROM customer_orders WHERE ordered_in_range = true AND lifetime_non_cancelled_orders >= 2) AS returning_customers_count,
            (SELECT COUNT(*)::int FROM placed_in_range WHERE status = 'pending') AS status_pending,
            (SELECT COUNT(*)::int FROM placed_in_range WHERE status = 'confirmed') AS status_confirmed,
            (SELECT COUNT(*)::int FROM placed_in_range WHERE status = 'processing') AS status_processing,
            (SELECT COUNT(*)::int FROM placed_in_range WHERE status = 'shipping') AS status_shipping,
            (SELECT COUNT(*)::int FROM placed_in_range WHERE status = 'delivered') AS status_delivered,
            (SELECT COUNT(*)::int FROM placed_in_range WHERE status = 'completed') AS status_completed,
            (SELECT COUNT(*)::int FROM placed_in_range WHERE status = 'cancelled') AS status_cancelled,
            (SELECT COUNT(*)::int FROM placed_in_range WHERE status = 'return_requested') AS status_return_requested;
        `),
        queryRows<any>(sql`
          WITH buckets AS (
            SELECT
              gs::timestamp AS bucket_start_local
            FROM generate_series(
              date_trunc(${truncUnit}, (${fromIsoTz}::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')),
              date_trunc(${truncUnit}, (${toEndIsoTz}::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')),
              ${stepInterval}::interval
            ) AS gs
          ),
          placed_agg AS (
            SELECT
              date_trunc(${truncUnit}, (o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')) AS bucket_start_local,
              COUNT(*) FILTER (WHERE o.status <> 'cancelled')::int AS placed_order_count,
              COUNT(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled_order_count,
              COALESCE(SUM(o.total_amount) FILTER (WHERE o.status <> 'cancelled'), 0)::bigint AS placed_order_value
            FROM orders o
            WHERE o.created_at >= ${fromIsoTz}::timestamptz
              AND o.created_at <= ${toEndIsoTz}::timestamptz
            GROUP BY 1
          ),
          delivered_agg AS (
            SELECT
              date_trunc(${truncUnit}, (COALESCE(o.delivered_at, o.completed_at, o.created_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')) AS bucket_start_local,
              COUNT(*)::int AS delivered_order_count,
              COALESCE(SUM(o.total_amount), 0)::bigint AS gross_delivered_revenue
            FROM orders o
            WHERE o.status IN ('delivered', 'completed')
              AND COALESCE(o.delivered_at, o.completed_at, o.created_at) >= ${fromIsoTz}::timestamptz
              AND COALESCE(o.delivered_at, o.completed_at, o.created_at) <= ${toEndIsoTz}::timestamptz
            GROUP BY 1
          ),
          refund_agg AS (
            SELECT
              date_trunc(${truncUnit}, (COALESCE(rr.refunded_at, rr.updated_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')) AS bucket_start_local,
              COALESCE(SUM(rr.refund_amount), 0)::bigint AS completed_refund_amount
            FROM return_requests rr
            WHERE rr.type = 'refund'
              AND rr.status = 'completed'
              AND COALESCE(rr.refunded_at, rr.updated_at) >= ${fromIsoTz}::timestamptz
              AND COALESCE(rr.refunded_at, rr.updated_at) <= ${toEndIsoTz}::timestamptz
            GROUP BY 1
          )
          SELECT
            to_char(b.bucket_start_local, 'YYYY-MM-DD') AS bucket_key,
            COALESCE(pa.placed_order_count, 0)::int AS placed_order_count,
            COALESCE(pa.cancelled_order_count, 0)::int AS cancelled_order_count,
            COALESCE(pa.placed_order_value, 0)::bigint AS placed_order_value,
            COALESCE(da.delivered_order_count, 0)::int AS delivered_order_count,
            COALESCE(da.gross_delivered_revenue, 0)::bigint AS gross_delivered_revenue,
            COALESCE(ra.completed_refund_amount, 0)::bigint AS completed_refund_amount,
            (COALESCE(da.gross_delivered_revenue, 0)::bigint - COALESCE(ra.completed_refund_amount, 0)::bigint) AS net_revenue
          FROM buckets b
          LEFT JOIN placed_agg pa ON pa.bucket_start_local = b.bucket_start_local
          LEFT JOIN delivered_agg da ON da.bucket_start_local = b.bucket_start_local
          LEFT JOIN refund_agg ra ON ra.bucket_start_local = b.bucket_start_local
          ORDER BY b.bucket_start_local ASC;
        `),
      ]);

      const s = summaryAndBreakdownRows[0] || {};
      const grossDeliveredRevenue = Number(s.gross_delivered_revenue || 0);
      const completedRefundAmount = Number(s.completed_refund_amount || 0);
      const netRevenue = grossDeliveredRevenue - completedRefundAmount;
      const placedOrderValue = Number(s.placed_order_value || 0);
      const placedOrderCount = Number(s.placed_order_count || 0);
      const deliveredOrderCount = Number(s.delivered_order_count || 0);
      const totalCreatedOrders = Number(s.total_created_orders || 0);
      const cancelledOrderCount = Number(s.cancelled_order_count || 0);
      const cancellationRatePercent =
        totalCreatedOrders > 0
          ? Number(((cancelledOrderCount / totalCreatedOrders) * 100).toFixed(1))
          : 0;
      const averageOrderValue =
        placedOrderCount > 0 ? Math.round(placedOrderValue / placedOrderCount) : 0;

      const series = seriesRows.map((row) => ({
        bucketKey: String(row.bucket_key),
        placedOrderCount: Number(row.placed_order_count || 0),
        cancelledOrderCount: Number(row.cancelled_order_count || 0),
        deliveredOrderCount: Number(row.delivered_order_count || 0),
        placedOrderValue: Number(row.placed_order_value || 0),
        grossDeliveredRevenue: Number(row.gross_delivered_revenue || 0),
        completedRefundAmount: Number(row.completed_refund_amount || 0),
        netRevenue: Number(row.net_revenue || 0),
      }));

      const statusBreakdown = {
        pending: Number(s.status_pending || 0),
        confirmed: Number(s.status_confirmed || 0),
        processing: Number(s.status_processing || 0),
        shipping: Number(s.status_shipping || 0),
        delivered: Number(s.status_delivered || 0),
        completed: Number(s.status_completed || 0),
        cancelled: Number(s.status_cancelled || 0),
        return_requested: Number(s.status_return_requested || 0),
      };

      return res.json({
        success: true,
        range: {
          from: fromYmd,
          to: toYmd,
          granularity,
          timezone: 'Asia/Ho_Chi_Minh',
        },
        definitions: STATS_METRIC_DEFINITIONS,
        summary: {
          netRevenue,
          grossDeliveredRevenue,
          completedRefundAmount,
          completedRefundCount: Number(s.completed_refund_count || 0),
          placedOrderValue,
          placedOrderCount,
          deliveredOrderCount,
          totalCreatedOrders,
          cancelledOrderCount,
          cancellationRatePercent,
          averageOrderValue,
          newCustomersCount: Number(s.new_customers_count || 0),
          returningCustomersCount: Number(s.returning_customers_count || 0),
        },
        statusBreakdown,
        series,
      });
    } catch (err: any) {
      return sendStage8dError(res, err, 'Lỗi tải dữ liệu thống kê tổng quan');
    }
  });

  // --------------------------------------------------------------------------
  // 4.5 GET /api/admin/stats/products?from&to
  // Top sản phẩm bán chạy, doanh thu theo danh mục & tồn kho chậm luân chuyển (SQL thuần)
  // --------------------------------------------------------------------------
  adminRouter.get('/stats/products', async (req: AuthRequest, res: Response) => {
    try {
      const rangeValidation = validateStatsDateRange(req.query);
      if (!rangeValidation.ok) {
        return res.status(400).json({
          success: false,
          code: rangeValidation.code,
          message: rangeValidation.message,
        });
      }

      const { fromYmd, toYmd, fromIsoTz, toEndIsoTz } = rangeValidation.data;

      const [topProductRows, categoryRevenueRows, slowMovingRows] = await Promise.all([
        queryRows<any>(sql`
          SELECT
            p.id AS "productId",
            p.name AS "productName",
            p.slug AS "productSlug",
            c.name AS "categoryName",
            p.base_price AS "basePrice",
            COALESCE(SUM(oi.quantity) FILTER (
              WHERE o.status IN ('delivered', 'completed')
                AND COALESCE(o.delivered_at, o.completed_at, o.created_at) >= ${fromIsoTz}::timestamptz
                AND COALESCE(o.delivered_at, o.completed_at, o.created_at) <= ${toEndIsoTz}::timestamptz
            ), 0)::int AS "soldQuantity",
            COALESCE(SUM(oi.total_price) FILTER (
              WHERE o.status IN ('delivered', 'completed')
                AND COALESCE(o.delivered_at, o.completed_at, o.created_at) >= ${fromIsoTz}::timestamptz
                AND COALESCE(o.delivered_at, o.completed_at, o.created_at) <= ${toEndIsoTz}::timestamptz
            ), 0)::bigint AS "deliveredRevenue",
            COALESCE(SUM(oi.quantity) FILTER (
              WHERE o.status <> 'cancelled'
                AND o.created_at >= ${fromIsoTz}::timestamptz
                AND o.created_at <= ${toEndIsoTz}::timestamptz
            ), 0)::int AS "placedQuantity",
            (
              SELECT COALESCE(SUM(pv2.stock_quantity), 0)::int
              FROM product_variants pv2
              WHERE pv2.product_id = p.id
            ) AS "currentStock"
          FROM products p
          JOIN categories c ON c.id = p.category_id
          LEFT JOIN product_variants pv ON pv.product_id = p.id
          LEFT JOIN order_items oi ON oi.variant_id = pv.id
          LEFT JOIN orders o ON o.id = oi.order_id
          GROUP BY p.id, p.name, p.slug, c.name, p.base_price
          ORDER BY "soldQuantity" DESC, "deliveredRevenue" DESC, "placedQuantity" DESC, p.name ASC
          LIMIT 15;
        `),
        queryRows<any>(sql`
          SELECT
            c.id AS "categoryId",
            c.name AS "categoryName",
            c.slug AS "categorySlug",
            COALESCE(SUM(oi.quantity) FILTER (
              WHERE o.status IN ('delivered', 'completed')
                AND COALESCE(o.delivered_at, o.completed_at, o.created_at) >= ${fromIsoTz}::timestamptz
                AND COALESCE(o.delivered_at, o.completed_at, o.created_at) <= ${toEndIsoTz}::timestamptz
            ), 0)::int AS "soldQuantity",
            COALESCE(SUM(oi.total_price) FILTER (
              WHERE o.status IN ('delivered', 'completed')
                AND COALESCE(o.delivered_at, o.completed_at, o.created_at) >= ${fromIsoTz}::timestamptz
                AND COALESCE(o.delivered_at, o.completed_at, o.created_at) <= ${toEndIsoTz}::timestamptz
            ), 0)::bigint AS "deliveredRevenue"
          FROM categories c
          LEFT JOIN products p ON p.category_id = c.id
          LEFT JOIN product_variants pv ON pv.product_id = p.id
          LEFT JOIN order_items oi ON oi.variant_id = pv.id
          LEFT JOIN orders o ON o.id = oi.order_id
          GROUP BY c.id, c.name, c.slug
          ORDER BY "deliveredRevenue" DESC, "soldQuantity" DESC, c.display_order ASC;
        `),
        queryRows<any>(sql`
          SELECT
            p.id AS "productId",
            p.name AS "productName",
            p.slug AS "productSlug",
            c.name AS "categoryName",
            COALESCE(SUM(pv.stock_quantity), 0)::int AS "totalStock",
            COALESCE((
              SELECT SUM(oi2.quantity)::int
              FROM order_items oi2
              JOIN orders o2 ON o2.id = oi2.order_id
              JOIN product_variants pv2 ON pv2.id = oi2.variant_id
              WHERE pv2.product_id = p.id
                AND o2.status <> 'cancelled'
                AND o2.created_at >= ${fromIsoTz}::timestamptz
                AND o2.created_at <= ${toEndIsoTz}::timestamptz
            ), 0)::int AS "periodSoldQty"
          FROM products p
          JOIN categories c ON c.id = p.category_id
          JOIN product_variants pv ON pv.product_id = p.id
          WHERE p.is_active = true
          GROUP BY p.id, p.name, p.slug, c.name
          HAVING COALESCE(SUM(pv.stock_quantity), 0) > 0
          ORDER BY "periodSoldQty" ASC, "totalStock" DESC, p.name ASC
          LIMIT 15;
        `),
      ]);

      return res.json({
        success: true,
        range: { from: fromYmd, to: toYmd, timezone: 'Asia/Ho_Chi_Minh' },
        topProducts: topProductRows.map((r) => ({
          productId: r.productId,
          productName: r.productName,
          productSlug: r.productSlug,
          categoryName: r.categoryName,
          basePrice: Number(r.basePrice || 0),
          soldQuantity: Number(r.soldQuantity || 0),
          deliveredRevenue: Number(r.deliveredRevenue || 0),
          placedQuantity: Number(r.placedQuantity || 0),
          currentStock: Number(r.currentStock || 0),
        })),
        categoryBreakdown: categoryRevenueRows.map((r) => ({
          categoryId: r.categoryId,
          categoryName: r.categoryName,
          categorySlug: r.categorySlug,
          soldQuantity: Number(r.soldQuantity || 0),
          deliveredRevenue: Number(r.deliveredRevenue || 0),
        })),
        slowMovingProducts: slowMovingRows.map((r) => ({
          productId: r.productId,
          productName: r.productName,
          productSlug: r.productSlug,
          categoryName: r.categoryName,
          totalStock: Number(r.totalStock || 0),
          periodSoldQty: Number(r.periodSoldQty || 0),
        })),
      });
    } catch (err: any) {
      return sendStage8dError(res, err, 'Lỗi tải thống kê sản phẩm và danh mục');
    }
  });

  // --------------------------------------------------------------------------
  // 4.6 GET /api/admin/stats/vouchers?from&to
  // Hiệu quả sử dụng mã giảm giá trong khoảng thời gian
  // --------------------------------------------------------------------------
  adminRouter.get('/stats/vouchers', async (req: AuthRequest, res: Response) => {
    try {
      const rangeValidation = validateStatsDateRange(req.query);
      if (!rangeValidation.ok) {
        return res.status(400).json({
          success: false,
          code: rangeValidation.code,
          message: rangeValidation.message,
        });
      }

      const { fromYmd, toYmd, fromIsoTz, toEndIsoTz } = rangeValidation.data;

      const rows = await queryRows<any>(sql`
        SELECT
          v.id,
          v.code,
          v.discount_type AS "discountType",
          v.discount_value AS "discountValue",
          v.usage_limit AS "usageLimit",
          v.used_count AS "totalUsedCount",
          v.is_active AS "isActive",
          COUNT(vu.id) FILTER (
            WHERE vu.used_at >= ${fromIsoTz}::timestamptz
              AND vu.used_at <= ${toEndIsoTz}::timestamptz
              AND o.status <> 'cancelled'
          )::int AS "periodUsageCount",
          COALESCE(SUM(o.discount_amount) FILTER (
            WHERE vu.used_at >= ${fromIsoTz}::timestamptz
              AND vu.used_at <= ${toEndIsoTz}::timestamptz
              AND o.status <> 'cancelled'
          ), 0)::bigint AS "periodDiscountAmount",
          COALESCE(SUM(o.total_amount) FILTER (
            WHERE vu.used_at >= ${fromIsoTz}::timestamptz
              AND vu.used_at <= ${toEndIsoTz}::timestamptz
              AND o.status <> 'cancelled'
          ), 0)::bigint AS "periodOrderRevenue"
        FROM vouchers v
        LEFT JOIN voucher_usages vu ON vu.voucher_id = v.id
        LEFT JOIN orders o ON o.id = vu.order_id
        GROUP BY v.id, v.code, v.discount_type, v.discount_value, v.usage_limit, v.used_count, v.is_active
        ORDER BY "periodUsageCount" DESC, v.used_count DESC, v.code ASC;
      `);

      const items = rows.map((r) => ({
        id: r.id,
        code: r.code,
        discountType: r.discountType,
        discountValue: Number(r.discountValue || 0),
        usageLimit: r.usageLimit !== null ? Number(r.usageLimit) : null,
        totalUsedCount: Number(r.totalUsedCount || 0),
        isActive: Boolean(r.isActive),
        periodUsageCount: Number(r.periodUsageCount || 0),
        periodDiscountAmount: Number(r.periodDiscountAmount || 0),
        periodOrderRevenue: Number(r.periodOrderRevenue || 0),
      }));

      return res.json({
        success: true,
        range: { from: fromYmd, to: toYmd, timezone: 'Asia/Ho_Chi_Minh' },
        items,
        data: items,
      });
    } catch (err: any) {
      return sendStage8dError(res, err, 'Lỗi tải thống kê mã giảm giá');
    }
  });

  // --------------------------------------------------------------------------
  // 4.7 GET /api/admin/stats/visual-search?from&to
  // Thống kê tìm kiếm bằng hình ảnh AI từ bảng ai_search_logs
  // --------------------------------------------------------------------------
  adminRouter.get('/stats/visual-search', async (req: AuthRequest, res: Response) => {
    try {
      const rangeValidation = validateStatsDateRange(req.query);
      if (!rangeValidation.ok) {
        return res.status(400).json({
          success: false,
          code: rangeValidation.code,
          message: rangeValidation.message,
        });
      }

      const { fromYmd, toYmd, fromIsoTz, toEndIsoTz } = rangeValidation.data;

      const [aggRows, categoryRows] = await Promise.all([
        queryRows<any>(sql`
          SELECT
            COUNT(*)::int AS total_searches,
            COUNT(*) FILTER (WHERE is_success = true)::int AS successful_searches,
            COUNT(*) FILTER (WHERE is_success = true AND result_count = 0)::int AS zero_result_searches,
            COALESCE(ROUND(AVG(latency_ms))::int, 0) AS avg_latency_ms,
            COALESCE(ROUND(AVG(confidence)::numeric, 2)::float, 0) AS avg_confidence,
            COALESCE(ROUND(AVG(result_count)::numeric, 1)::float, 0) AS avg_result_count
          FROM ai_search_logs
          WHERE created_at >= ${fromIsoTz}::timestamptz
            AND created_at <= ${toEndIsoTz}::timestamptz;
        `),
        queryRows<{ category_slug: string; search_count: number }>(sql`
          SELECT
            COALESCE(NULLIF(recognized_attributes->>'category', ''), 'khong-xac-dinh') AS category_slug,
            COUNT(*)::int AS search_count
          FROM ai_search_logs
          WHERE created_at >= ${fromIsoTz}::timestamptz
            AND created_at <= ${toEndIsoTz}::timestamptz
            AND is_success = true
          GROUP BY 1
          ORDER BY search_count DESC, category_slug ASC
          LIMIT 10;
        `),
      ]);

      const a = aggRows[0] || {};
      const totalSearches = Number(a.total_searches || 0);
      const successfulSearches = Number(a.successful_searches || 0);
      const zeroResultSearches = Number(a.zero_result_searches || 0);
      const successRatePercent =
        totalSearches > 0 ? Number(((successfulSearches / totalSearches) * 100).toFixed(1)) : 0;
      const zeroResultRatePercent =
        successfulSearches > 0
          ? Number(((zeroResultSearches / successfulSearches) * 100).toFixed(1))
          : 0;

      return res.json({
        success: true,
        range: { from: fromYmd, to: toYmd, timezone: 'Asia/Ho_Chi_Minh' },
        summary: {
          totalSearches,
          successfulSearches,
          zeroResultSearches,
          successRatePercent,
          zeroResultRatePercent,
          avgLatencyMs: Number(a.avg_latency_ms || 0),
          avgConfidence: Number(a.avg_confidence || 0),
          avgResultCount: Number(a.avg_result_count || 0),
        },
        topRecognizedCategories: categoryRows.map((r) => ({
          categorySlug: r.category_slug,
          searchCount: Number(r.search_count || 0),
        })),
      });
    } catch (err: any) {
      return sendStage8dError(res, err, 'Lỗi tải thống kê tìm kiếm bằng hình ảnh');
    }
  });

  // --------------------------------------------------------------------------
  // 4.8 GET /api/admin/stats/export.csv?type=orders|products&from&to
  // Xuất báo cáo CSV: chỉ cột nghiệp vụ (không có tên, SĐT, email, địa chỉ),
  // chống formula injection, UTF-8 BOM, giới hạn 50.000 dòng, rate limit, ghi admin_audit_logs.
  // --------------------------------------------------------------------------
  adminRouter.get('/stats/export.csv', async (req: AuthRequest, res: Response) => {
    try {
      const adminId = req.user!.id;
      if (!checkAndRecordCsvExportRateLimit(adminId)) {
        return res.status(429).json({
          success: false,
          code: 'CSV_EXPORT_RATE_LIMIT',
          message: 'Bạn đã xuất báo cáo CSV quá nhiều lần trong thời gian ngắn. Vui lòng thử lại sau ít phút.',
        });
      }

      const rawType = String(req.query.type || 'orders').trim().toLowerCase();
      if (rawType !== 'orders' && rawType !== 'products') {
        return res.status(400).json({
          success: false,
          code: 'INVALID_CSV_EXPORT_TYPE',
          message: 'Tham số type chỉ chấp nhận "orders" hoặc "products"',
        });
      }

      const rangeValidation = validateStatsDateRange(req.query);
      if (!rangeValidation.ok) {
        return res.status(400).json({
          success: false,
          code: rangeValidation.code,
          message: rangeValidation.message,
        });
      }

      const { fromYmd, toYmd, fromIsoTz, toEndIsoTz } = rangeValidation.data;
      const effectiveRowLimit =
        typeof maxCsvExportRowsOverrideForTest === 'number' && maxCsvExportRowsOverrideForTest > 0
          ? Math.min(MAX_CSV_EXPORT_ROWS, maxCsvExportRowsOverrideForTest)
          : MAX_CSV_EXPORT_ROWS;
      const lines: string[] = [];
      let exportedRowCount = 0;

      if (rawType === 'orders') {
        // Chỉ chọn các cột nghiệp vụ, TUYỆT ĐỐI KHÔNG chọn receiver_name, receiver_phone, shipping_address, email
        const orderRows = await queryRows<any>(sql`
          SELECT
            o.id AS order_id,
            to_char(o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI:SS') AS created_at_vn,
            COALESCE(to_char(o.delivered_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI:SS'), '') AS delivered_at_vn,
            o.status,
            o.shipping_method,
            COALESCE((SELECT pm.method FROM payments pm WHERE pm.order_id = o.id LIMIT 1), 'cod') AS payment_method,
            COALESCE((SELECT pm.status FROM payments pm WHERE pm.order_id = o.id LIMIT 1), 'pending') AS payment_status,
            o.subtotal,
            o.discount_amount,
            o.shipping_fee,
            o.total_amount,
            COALESCE((
              SELECT SUM(rr.refund_amount)::int
              FROM return_requests rr
              WHERE rr.order_id = o.id
                AND rr.type = 'refund'
                AND rr.status = 'completed'
            ), 0)::int AS completed_refund_amount
          FROM orders o
          WHERE o.created_at >= ${fromIsoTz}::timestamptz
            AND o.created_at <= ${toEndIsoTz}::timestamptz
          ORDER BY o.created_at DESC, o.id DESC
          LIMIT ${effectiveRowLimit};
        `);

        const headers = [
          'Ma_Don_Hang',
          'Ngay_Dat_GMT7',
          'Ngay_Giao_GMT7',
          'Trang_Thai_Don',
          'Phuong_Thuc_Van_Chuyen',
          'Phuong_Thuc_Thanh_Toan',
          'Trang_Thai_Thanh_Toan',
          'Tien_Hang_VND',
          'Giam_Gia_VND',
          'Phi_Van_Chuyen_VND',
          'Tong_Thanh_Toan_VND',
          'Tien_Hoan_Da_Xu_Ly_VND',
          'Doanh_Thu_Thuc_Don_VND',
        ];
        lines.push(headers.map(sanitizeCsvCell).join(','));

        for (const r of orderRows) {
          const isDeliveredOrCompleted = r.status === 'delivered' || r.status === 'completed';
          const grossDelivered = isDeliveredOrCompleted ? Number(r.total_amount || 0) : 0;
          const refunded = Number(r.completed_refund_amount || 0);
          const netOrderRev = grossDelivered - refunded;

          lines.push(
            [
              r.order_id,
              r.created_at_vn,
              r.delivered_at_vn,
              r.status,
              r.shipping_method,
              r.payment_method,
              r.payment_status,
              Number(r.subtotal || 0),
              Number(r.discount_amount || 0),
              Number(r.shipping_fee || 0),
              Number(r.total_amount || 0),
              refunded,
              netOrderRev,
            ]
              .map(sanitizeCsvCell)
              .join(',')
          );
        }
        exportedRowCount = orderRows.length;
      } else {
        const prodRows = await queryRows<any>(sql`
          SELECT
            p.id AS product_id,
            p.slug AS product_slug,
            p.name AS product_name,
            c.name AS category_name,
            p.base_price,
            (
              SELECT COALESCE(SUM(pv2.stock_quantity), 0)::int
              FROM product_variants pv2
              WHERE pv2.product_id = p.id
            ) AS current_stock,
            COALESCE(SUM(oi.quantity) FILTER (
              WHERE o.status IN ('delivered', 'completed')
                AND COALESCE(o.delivered_at, o.completed_at, o.created_at) >= ${fromIsoTz}::timestamptz
                AND COALESCE(o.delivered_at, o.completed_at, o.created_at) <= ${toEndIsoTz}::timestamptz
            ), 0)::int AS sold_quantity,
            COALESCE(SUM(oi.total_price) FILTER (
              WHERE o.status IN ('delivered', 'completed')
                AND COALESCE(o.delivered_at, o.completed_at, o.created_at) >= ${fromIsoTz}::timestamptz
                AND COALESCE(o.delivered_at, o.completed_at, o.created_at) <= ${toEndIsoTz}::timestamptz
            ), 0)::bigint AS delivered_revenue,
            COALESCE((
              SELECT SUM(rr.quantity)::int
              FROM return_requests rr
              JOIN order_items oi_r ON oi_r.id = rr.order_item_id
              JOIN product_variants pv_r ON pv_r.id = oi_r.variant_id
              WHERE pv_r.product_id = p.id
                AND rr.status = 'completed'
                AND COALESCE(rr.refunded_at, rr.updated_at) >= ${fromIsoTz}::timestamptz
                AND COALESCE(rr.refunded_at, rr.updated_at) <= ${toEndIsoTz}::timestamptz
            ), 0)::int AS returned_quantity
          FROM products p
          JOIN categories c ON c.id = p.category_id
          LEFT JOIN product_variants pv ON pv.product_id = p.id
          LEFT JOIN order_items oi ON oi.variant_id = pv.id
          LEFT JOIN orders o ON o.id = oi.order_id
          GROUP BY p.id, p.slug, p.name, c.name, p.base_price
          ORDER BY sold_quantity DESC, delivered_revenue DESC, p.name ASC
          LIMIT ${effectiveRowLimit};
        `);

        const headers = [
          'Ma_San_Pham',
          'Slug_San_Pham',
          'Ten_San_Pham',
          'Danh_Muc',
          'Gia_Goc_VND',
          'Ton_Kho_Hien_Tai',
          'So_Luong_Da_Ban',
          'Doanh_Thu_Giao_Thanh_Cong_VND',
          'So_Luong_Hoan_Tra',
        ];
        lines.push(headers.map(sanitizeCsvCell).join(','));

        for (const r of prodRows) {
          lines.push(
            [
              r.product_id,
              r.product_slug,
              r.product_name,
              r.category_name,
              Number(r.base_price || 0),
              Number(r.current_stock || 0),
              Number(r.sold_quantity || 0),
              Number(r.delivered_revenue || 0),
              Number(r.returned_quantity || 0),
            ]
              .map(sanitizeCsvCell)
              .join(',')
          );
        }
        exportedRowCount = prodRows.length;
      }

      // Ghi nhật ký xuất CSV vào admin_audit_logs
      await queryRows(sql`
        INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, summary)
        VALUES (
          ${adminId}::uuid,
          'EXPORT_STATS_CSV',
          'stats_csv',
          ${`${rawType}:${fromYmd}_${toYmd}`},
          ${`Xuất báo cáo CSV (${rawType}) từ ${fromYmd} đến ${toYmd} (${exportedRowCount} dòng)`}
        );
      `);

      const safeFilename = `baity-stats-${rawType}-${fromYmd}-to-${toYmd}.csv`.replace(
        /[^a-zA-Z0-9._-]/g,
        '_'
      );
      const csvBody = `\uFEFF${lines.join('\r\n')}\r\n`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.setHeader('X-CSV-Max-Rows', String(effectiveRowLimit));
      res.setHeader('X-CSV-Row-Count', String(exportedRowCount));
      return res.status(200).send(csvBody);
    } catch (err: any) {
      return sendStage8dError(res, err, 'Lỗi xuất báo cáo thống kê CSV');
    }
  });

  // ==========================================================================
  // 5. GIAI ĐOẠN 6D — QUẢN TRỊ CHAT VỚI NGƯỜI BÁN (/api/admin/chats)
  // Chỉ trả tên hiển thị rút gọn (maskReviewerName), TUYỆT ĐỐI KHÔNG trả email, SĐT, địa chỉ.
  // Không gọi Gemini, không ghi log nội dung tin nhắn.
  // ==========================================================================

  // 5.1 GET /api/admin/chats — Danh sách hội thoại (lọc: unreplied | open | closed | all, phân trang)
  adminRouter.get('/chats', async (req: AuthRequest, res: Response) => {
    try {
      const rawFilter = String(req.query.filter || req.query.status || 'all')
        .trim()
        .toLowerCase();
      if (!['unreplied', 'open', 'closed', 'all'].includes(rawFilter)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_CHAT_FILTER',
          message: 'Bộ lọc trạng thái hội thoại chỉ chấp nhận unreplied, open, closed hoặc all',
        });
      }

      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const rawLimit = parseInt(String(req.query.limit || '20'), 10) || 20;
      const limit = Math.min(50, Math.max(1, rawLimit));
      const offset = (page - 1) * limit;

      const conditions: SQL[] = [sql`cc.mode = 'human'`];
      if (rawFilter === 'unreplied') {
        conditions.push(sql`cc.status = 'open' AND cc.unread_admin > 0`);
      } else if (rawFilter === 'open') {
        conditions.push(sql`cc.status = 'open'`);
      } else if (rawFilter === 'closed') {
        conditions.push(sql`cc.status = 'closed'`);
      }

      const whereSql = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

      const [countRows, summaryRows, convRows] = await Promise.all([
        queryRows<{ total: number }>(sql`
          SELECT COUNT(*)::int AS total
          FROM chat_conversations cc
          ${whereSql};
        `),
        queryRows<{
          total_all: number;
          unreplied_count: number;
          open_count: number;
          closed_count: number;
        }>(sql`
          SELECT
            COUNT(*)::int AS total_all,
            COUNT(*) FILTER (WHERE status = 'open' AND unread_admin > 0)::int AS unreplied_count,
            COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
            COUNT(*) FILTER (WHERE status = 'closed')::int AS closed_count
          FROM chat_conversations
          WHERE mode = 'human';
        `),
        queryRows<any>(sql`
          SELECT
            cc.id,
            cc.status,
            cc.last_message AS "lastMessage",
            cc.last_message_at AS "lastMessageAt",
            cc.closed_at AS "closedAt",
            cc.unread_admin AS "unreadAdmin",
            cc.unread_user AS "unreadUser",
            cc.user_last_read_at AS "userLastReadAt",
            cc.admin_last_read_at AS "adminLastReadAt",
            cc.created_at AS "createdAt",
            cc.updated_at AS "updatedAt",
            u.full_name AS "rawFullName",
            (
              SELECT COUNT(*)::int
              FROM chat_messages cm
              WHERE cm.conversation_id = cc.id
            ) AS "messageCount"
          FROM chat_conversations cc
          LEFT JOIN users u ON u.id = cc.user_id
          ${whereSql}
          ORDER BY
            CASE WHEN cc.status = 'open' AND cc.unread_admin > 0 THEN 0 ELSE 1 END ASC,
            cc.last_message_at DESC,
            cc.id DESC
          LIMIT ${limit} OFFSET ${offset};
        `),
      ]);

      const total = Number(countRows[0]?.total || 0);
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const sum = summaryRows[0] || {
        total_all: 0,
        unreplied_count: 0,
        open_count: 0,
        closed_count: 0,
      };

      const items = convRows.map((r) => ({
        id: r.id,
        status: r.status as 'open' | 'closed',
        customerDisplayName: maskReviewerName(r.rawFullName),
        lastMessage: r.lastMessage ? String(r.lastMessage) : null,
        lastMessageAt: r.lastMessageAt,
        closedAt: r.closedAt || null,
        unreadAdmin: Number(r.unreadAdmin || 0),
        unreadUser: Number(r.unreadUser || 0),
        userLastReadAt: r.userLastReadAt || null,
        adminLastReadAt: r.adminLastReadAt || null,
        messageCount: Number(r.messageCount || 0),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));

      return res.json({
        success: true,
        items,
        data: items,
        total,
        page,
        limit,
        totalPages,
        summary: {
          totalConversations: Number(sum.total_all || 0),
          unrepliedCount: Number(sum.unreplied_count || 0),
          openCount: Number(sum.open_count || 0),
          closedCount: Number(sum.closed_count || 0),
        },
      });
    } catch (err: any) {
      return sendStage8dError(res, err, 'Lỗi tải danh sách hội thoại hỏi đáp');
    }
  });

  // 5.2 GET /api/admin/chats/:id/messages — Xem lịch sử tin nhắn của một hội thoại & đánh dấu admin đã đọc
  adminRouter.get('/chats/:id/messages', async (req: AuthRequest, res: Response) => {
    try {
      const convId = String(req.params.id || '').trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(convId)) {
        return res.status(404).json({
          success: false,
          code: 'CHAT_CONVERSATION_NOT_FOUND',
          message: 'Không tìm thấy hội thoại',
        });
      }

      const afterId =
        typeof req.query.after === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          req.query.after.trim()
        )
          ? req.query.after.trim()
          : null;

      const convRows = await queryRows<any>(sql`
        UPDATE chat_conversations cc
        SET unread_admin = 0,
            admin_last_read_at = NOW(),
            updated_at = NOW()
        FROM users u
        WHERE cc.id = ${convId}::uuid
          AND cc.mode = 'human'
          AND u.id = cc.user_id
        RETURNING
          cc.id,
          cc.status,
          cc.last_message AS "lastMessage",
          cc.last_message_at AS "lastMessageAt",
          cc.closed_at AS "closedAt",
          cc.unread_admin AS "unreadAdmin",
          cc.unread_user AS "unreadUser",
          cc.user_last_read_at AS "userLastReadAt",
          cc.admin_last_read_at AS "adminLastReadAt",
          cc.created_at AS "createdAt",
          cc.updated_at AS "updatedAt",
          u.full_name AS "rawFullName";
      `);

      if (convRows.length === 0) {
        return res.status(404).json({
          success: false,
          code: 'CHAT_CONVERSATION_NOT_FOUND',
          message: 'Không tìm thấy hội thoại',
        });
      }

      const conv = convRows[0];
      const msgRows = afterId
        ? await queryRows<any>(sql`
            SELECT
              cm.id,
              cm.conversation_id AS "conversationId",
              cm.sender_type AS "senderType",
              cm.content,
              cm.created_at AS "createdAt"
            FROM chat_messages cm
            WHERE cm.conversation_id = ${convId}::uuid
              AND (
                cm.created_at > (SELECT created_at FROM chat_messages WHERE id = ${afterId}::uuid LIMIT 1)
                OR (
                  cm.created_at = (SELECT created_at FROM chat_messages WHERE id = ${afterId}::uuid LIMIT 1)
                  AND cm.id > ${afterId}::uuid
                )
              )
            ORDER BY cm.created_at ASC, cm.id ASC
            LIMIT ${SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION};
          `)
        : await queryRows<any>(sql`
            SELECT
              cm.id,
              cm.conversation_id AS "conversationId",
              cm.sender_type AS "senderType",
              cm.content,
              cm.created_at AS "createdAt"
            FROM chat_messages cm
            WHERE cm.conversation_id = ${convId}::uuid
            ORDER BY cm.created_at ASC, cm.id ASC
            LIMIT ${SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION};
          `);

      const conversation = {
        id: conv.id,
        status: conv.status as 'open' | 'closed',
        customerDisplayName: maskReviewerName(conv.rawFullName),
        lastMessage: conv.lastMessage || null,
        lastMessageAt: conv.lastMessageAt,
        closedAt: conv.closedAt || null,
        unreadAdmin: Number(conv.unreadAdmin || 0),
        unreadUser: Number(conv.unreadUser || 0),
        userLastReadAt: conv.userLastReadAt || null,
        adminLastReadAt: conv.adminLastReadAt || null,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
      };

      return res.json({
        success: true,
        conversation,
        messages: msgRows,
        data: {
          conversation,
          messages: msgRows,
        },
      });
    } catch (err: any) {
      return sendStage8dError(res, err, 'Lỗi tải nội dung tin nhắn hội thoại');
    }
  });

  // 5.3 POST /api/admin/chats/:id/messages — Admin trả lời khách hàng (văn bản thuần, tối đa 1000 ký tự, không đính kèm tệp)
  adminRouter.post('/chats/:id/messages', async (req: AuthRequest, res: Response) => {
    try {
      const convId = String(req.params.id || '').trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(convId)) {
        return res.status(404).json({
          success: false,
          code: 'CHAT_CONVERSATION_NOT_FOUND',
          message: 'Không tìm thấy hội thoại',
        });
      }

      const body = req.body || {};
      if (
        body.attachments !== undefined ||
        body.files !== undefined ||
        body.image !== undefined ||
        body.imageUrl !== undefined ||
        body.fileUrl !== undefined
      ) {
        return res.status(400).json({
          success: false,
          code: 'CHAT_ATTACHMENT_FORBIDDEN',
          message: 'Tính năng chat với người bán chỉ hỗ trợ tin nhắn văn bản thuần, không đính kèm tệp hoặc ảnh.',
        });
      }

      const rawContent = typeof body.content === 'string' ? body.content : '';
      const cleanContent = rawContent.replace(/\0/g, '').trim();

      if (cleanContent.length < 1) {
        return res.status(400).json({
          success: false,
          code: 'EMPTY_CHAT_MESSAGE',
          message: 'Nội dung tin nhắn phản hồi không được để trống.',
        });
      }

      if (cleanContent.length > SELLER_CHAT_MESSAGE_MAX_LENGTH) {
        return res.status(400).json({
          success: false,
          code: 'CHAT_MESSAGE_TOO_LONG',
          message: `Nội dung tin nhắn không được vượt quá ${SELLER_CHAT_MESSAGE_MAX_LENGTH} ký tự.`,
        });
      }

      const result = await withTransaction(async (txQueryRows) => {
        const convRows = await txQueryRows<{
          id: string;
          status: string;
        }>(sql`
          SELECT id, status
          FROM chat_conversations
          WHERE id = ${convId}::uuid
            AND mode = 'human'
          FOR UPDATE;
        `);

        if (convRows.length === 0) {
          const err: any = new Error('Không tìm thấy hội thoại');
          err.statusCode = 404;
          err.code = 'CHAT_CONVERSATION_NOT_FOUND';
          throw err;
        }

        const msgCountRows = await txQueryRows<{ cnt: number }>(sql`
          SELECT COUNT(*)::int AS cnt
          FROM chat_messages
          WHERE conversation_id = ${convId}::uuid;
        `);
        const currentCount = Number(msgCountRows[0]?.cnt || 0);
        if (currentCount >= SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION) {
          const err: any = new Error(
            `Hội thoại đã đạt giới hạn tối đa ${SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION} tin nhắn.`
          );
          err.statusCode = 400;
          err.code = 'CHAT_CONVERSATION_MESSAGE_LIMIT';
          throw err;
        }

        const insertedMsgRows = await txQueryRows<any>(sql`
          INSERT INTO chat_messages (conversation_id, sender_type, content, created_at)
          VALUES (
            ${convId}::uuid,
            'admin',
            ${cleanContent},
            GREATEST(
              NOW(),
              COALESCE(
                (SELECT MAX(created_at) + INTERVAL '1 millisecond' FROM chat_messages WHERE conversation_id = ${convId}::uuid),
                NOW()
              )
            )
          )
          RETURNING
            id,
            conversation_id AS "conversationId",
            sender_type AS "senderType",
            content,
            created_at AS "createdAt";
        `);

        const updatedConvRows = await txQueryRows<any>(sql`
          UPDATE chat_conversations
          SET last_message = ${cleanContent.slice(0, 200)},
              last_message_at = NOW(),
              unread_user = unread_user + 1,
              unread_admin = 0,
              admin_last_read_at = NOW(),
              updated_at = NOW()
          WHERE id = ${convId}::uuid
          RETURNING
            id,
            status,
            last_message AS "lastMessage",
            last_message_at AS "lastMessageAt",
            closed_at AS "closedAt",
            unread_admin AS "unreadAdmin",
            unread_user AS "unreadUser",
            user_last_read_at AS "userLastReadAt",
            admin_last_read_at AS "adminLastReadAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt";
        `);

        return {
          message: insertedMsgRows[0],
          conversation: updatedConvRows[0],
        };
      });

      return res.status(201).json({
        success: true,
        message: result.message,
        conversation: result.conversation,
        data: result.message,
      });
    } catch (err: any) {
      return sendStage8dError(res, err, 'Lỗi gửi tin nhắn phản hồi cho khách hàng');
    }
  });

  // 5.4 PATCH /api/admin/chats/:id/status — Đóng hoặc mở lại hội thoại, ghi nhật ký admin trong cùng giao dịch
  adminRouter.patch('/chats/:id/status', async (req: AuthRequest, res: Response) => {
    try {
      const adminId = req.user!.id;
      const convId = String(req.params.id || '').trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(convId)) {
        return res.status(404).json({
          success: false,
          code: 'CHAT_CONVERSATION_NOT_FOUND',
          message: 'Không tìm thấy hội thoại',
        });
      }

      const rawStatus = String(req.body?.status || '').trim().toLowerCase();
      if (rawStatus !== 'open' && rawStatus !== 'closed') {
        return res.status(400).json({
          success: false,
          code: 'INVALID_CHAT_STATUS',
          message: 'Trạng thái hội thoại chỉ chấp nhận "open" hoặc "closed"',
        });
      }
      const nextStatus = rawStatus as 'open' | 'closed';

      const updated = await withTransaction(async (txQueryRows) => {
        const convRows = await txQueryRows<{
          id: string;
          user_id: string | null;
          status: string;
        }>(sql`
          SELECT id, user_id, status
          FROM chat_conversations
          WHERE id = ${convId}::uuid
            AND mode = 'human'
          FOR UPDATE;
        `);

        if (convRows.length === 0) {
          const err: any = new Error('Không tìm thấy hội thoại');
          err.statusCode = 404;
          err.code = 'CHAT_CONVERSATION_NOT_FOUND';
          throw err;
        }

        const current = convRows[0];
        if (nextStatus === 'open' && current.status !== 'open' && current.user_id) {
          const otherOpenRows = await txQueryRows<{ id: string }>(sql`
            SELECT id
            FROM chat_conversations
            WHERE user_id = ${current.user_id}::uuid
              AND status = 'open'
              AND id <> ${convId}::uuid
            LIMIT 1;
          `);
          if (otherOpenRows.length > 0) {
            const err: any = new Error(
              'Khách hàng này đang có một hội thoại mở khác; mỗi khách hàng chỉ có tối đa một hội thoại mở.'
            );
            err.statusCode = 409;
            err.code = 'OPEN_CONVERSATION_ALREADY_EXISTS';
            throw err;
          }
        }

        const updRows = await txQueryRows<any>(sql`
          UPDATE chat_conversations
          SET status = ${nextStatus},
              closed_at = ${nextStatus === 'closed' ? sql`NOW()` : sql`NULL`},
              unread_admin = ${nextStatus === 'closed' ? 0 : sql`unread_admin`},
              updated_at = NOW()
          WHERE id = ${convId}::uuid
          RETURNING
            id,
            status,
            last_message AS "lastMessage",
            last_message_at AS "lastMessageAt",
            closed_at AS "closedAt",
            unread_admin AS "unreadAdmin",
            unread_user AS "unreadUser",
            user_last_read_at AS "userLastReadAt",
            admin_last_read_at AS "adminLastReadAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt";
        `);

        const auditLog = await insertAdminAuditLogInTx(txQueryRows, {
          adminId,
          action: nextStatus === 'closed' ? 'SELLER_CHAT_CLOSE' : 'SELLER_CHAT_REOPEN',
          targetType: 'chat_conversation',
          targetId: convId,
          summary:
            nextStatus === 'closed'
              ? `Đóng hội thoại hỏi đáp ${convId}`
              : `Mở lại hội thoại hỏi đáp ${convId}`,
        });

        return {
          conversation: updRows[0],
          auditLogId: auditLog.id,
        };
      });

      return res.json({
        success: true,
        message:
          nextStatus === 'closed'
            ? 'Đã đóng hội thoại hỏi đáp'
            : 'Đã mở lại hội thoại hỏi đáp',
        conversation: updated.conversation,
        data: updated.conversation,
        auditLogId: updated.auditLogId,
      });
    } catch (err: any) {
      return sendStage8dError(res, err, 'Lỗi cập nhật trạng thái hội thoại');
    }
  });
}

