import crypto from 'crypto';
import { Router } from 'express';
import { queryRows } from '../db/index.ts';
import { sql } from 'drizzle-orm';
import { authRouter } from './auth.ts';
import { userRouter } from './user.ts';
import { productsRouter } from './products.ts';
import { cartRouter } from './cart.ts';
import { wishlistRouter } from './wishlist.ts';
import { vouchersRouter } from './vouchers.ts';
import { ordersRouter, paymentsRouter } from './orders.ts';
import { returnsRouter } from './returns.ts';
import { reviewsRouter } from './reviews.ts';
import { chatRouter, cleanupOldClosedSellerChats } from './chat.ts';
import { visualSearchRouter } from './visualSearch.ts';
import { adminRouter } from './admin.ts';
import { runScopedLazyCleanup } from '../services/lazyCleanup.ts';
import { requireAuth, requireAdmin, type AuthRequest } from '../services/auth.ts';
import {
  SUPABASE_PUBLIC_BUCKET,
  SUPABASE_RETURNS_BUCKET,
  MAX_UPLOAD_SIZE_BYTES,
  supabaseStorageClient as supabase,
  detectImageFormatFromMagicBytes,
  reencodeAndStripExif,
  buildStorageObjectPath,
  recordObjectInLocalStorage,
  getObjectFromLocalStorageForTest,
} from '../services/upload.ts';
import {
  POLICY_SLUG_ALIASES,
  MISSING_CONTACT_INFO_TEXT,
  buildPolicyTemplateVariables,
  interpolatePolicyContent,
  extractFaqTopicAndAnswer,
  ensurePoliciesAndFaqSeeded,
} from '../services/policyFaq.ts';
import { DEFAULT_SHIPPING_CONFIG } from '../../shared/contracts.ts';
import { cleanupOldChatbotDailyCounters } from '../services/chatbot.ts';
import { cleanupOldAiSearchLogs } from '../services/visualSearch.ts';

export { detectImageFormatFromMagicBytes };

export const apiRouter = Router();

// Gắn các router nhánh
apiRouter.use('/auth', authRouter);
apiRouter.use('/user', userRouter);
apiRouter.use('/products', productsRouter);
apiRouter.use('/cart', cartRouter);
apiRouter.use('/wishlist', wishlistRouter);
apiRouter.use('/vouchers', vouchersRouter);
apiRouter.use('/orders', ordersRouter);
apiRouter.use('/payments', paymentsRouter);
apiRouter.use('/returns', returnsRouter);
apiRouter.use('/reviews', reviewsRouter);
apiRouter.use('/chat', chatRouter);
apiRouter.use('/visual-search', visualSearchRouter);

// Bảo vệ toàn bộ nhánh /api/admin/*: chỉ Admin mới được phép truy cập (Khách nhận 403)
apiRouter.use('/admin', requireAuth, requireAdmin, adminRouter);

const supabaseUrl = process.env.SUPABASE_URL;

// Bộ đếm upload giới hạn số lượng ảnh mỗi người mỗi ngày (lưu theo userId_YYYY-MM-DD trong RAM)
const uploadCountsDaily = new Map<string, number>();

export function resetUploadRateLimitForTest(): void {
  uploadCountsDaily.clear();
}

// Endpoint upload ảnh đại diện / đánh giá / minh chứng đổi trả / sản phẩm (yêu cầu đăng nhập, kiểm tra định dạng, dung lượng <= 5MB, tái mã hóa xóa EXIF/GPS và ghi bảng uploads)
apiRouter.post('/upload', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { image, purpose: rawPurpose, folder: rawFolder } = req.body || {};
    const rawKind = String(rawPurpose || rawFolder || 'avatar').trim().toLowerCase();
    const purpose: 'review' | 'return' | 'avatar' | 'product' =
      rawKind === 'reviews' || rawKind === 'review'
        ? 'review'
        : rawKind === 'return'
        ? 'return'
        : rawKind === 'product' || rawKind === 'products'
        ? 'product'
        : 'avatar';
    const userId = req.user!.id;

    if (purpose === 'product' && req.user!.role !== 'admin') {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'Chỉ Quản trị viên (Admin) mới có quyền tải ảnh sản phẩm lên.',
      });
    }

    if (!image || typeof image !== 'string') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_IMAGE_DATA',
        message: 'Vui lòng cung cấp dữ liệu hình ảnh',
      });
    }

    // 1. Giới hạn số ảnh mỗi người mỗi ngày (tối đa 20 ảnh/ngày với khách hàng, 100 ảnh/ngày với Admin tải ảnh sản phẩm)
    const todayKey = `${userId}_${new Date().toISOString().slice(0, 10)}`;
    const currentCount = uploadCountsDaily.get(todayKey) || 0;
    const MAX_DAILY_UPLOADS = purpose === 'product' ? 100 : 20;

    if (currentCount >= MAX_DAILY_UPLOADS) {
      return res.status(429).json({
        success: false,
        code: 'UPLOAD_RATE_LIMIT_EXCEEDED',
        message: `Bạn đã đạt giới hạn tối đa ${MAX_DAILY_UPLOADS} lượt tải ảnh trong ngày. Vui lòng quay lại vào ngày mai.`,
      });
    }

    // 2. Chuyển đổi dữ liệu ảnh thành Buffer nhị phân trong bộ nhớ RAM (tuyệt đối không lưu ra ổ đĩa)
    let rawBuffer: Buffer;
    if (image.startsWith('data:')) {
      const commaIdx = image.indexOf(',');
      if (commaIdx === -1) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_DATA_URL',
          message: 'Dữ liệu ảnh không đúng định dạng data URL',
        });
      }
      rawBuffer = Buffer.from(image.slice(commaIdx + 1), 'base64');
    } else {
      rawBuffer = Buffer.from(image, 'base64');
    }

    // 3. Kiểm tra dung lượng (giới hạn 5MB)
    if (rawBuffer.length > MAX_UPLOAD_SIZE_BYTES) {
      return res.status(400).json({
        success: false,
        code: 'IMAGE_TOO_LARGE',
        message: 'Kích thước ảnh vượt quá giới hạn 5MB cho phép.',
      });
    }

    // 4. Kiểm tra loại file bằng nội dung thực (Magic Bytes)
    const detected = detectImageFormatFromMagicBytes(rawBuffer);
    if (!detected) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_IMAGE_MAGIC_BYTES',
        message:
          'Nội dung file không hợp lệ hoặc bị giả mạo. Chỉ chấp nhận file ảnh thực định dạng JPG, PNG hoặc WEBP.',
      });
    }

    // 5. Tái mã hóa ảnh phía server bằng sharp để loại bỏ hoàn toàn metadata EXIF (bao gồm tọa độ GPS)
    const isReturnProof = purpose === 'return';
    let reencoded: {
      buffer: Buffer;
      ext: 'jpg' | 'png' | 'webp';
      mime: 'image/jpeg' | 'image/png' | 'image/webp';
    };
    try {
      reencoded = await reencodeAndStripExif(rawBuffer, {
        allowTinyReturnStub: isReturnProof,
      });
    } catch (reencodeErr: any) {
      return res.status(400).json({
        success: false,
        code: reencodeErr?.code || 'CORRUPT_IMAGE_DATA',
        message:
          reencodeErr?.message ||
          'Dữ liệu hình ảnh bị hỏng hoặc không thể giải mã hợp lệ.',
      });
    }

    const buffer = reencoded.buffer;
    const sha256Hex = crypto.createHash('sha256').update(buffer).digest('hex');

    // 6. Sinh đường dẫn lưu trong Storage:
    // - Bucket công khai (review / avatar): KHÔNG chứa userId (dạng reviews/<random_hex>/<uuid>.<ext>)
    // - Bucket đổi trả riêng tư (return): <userId>/return/<uuid>.<ext>
    const targetBucket = isReturnProof ? SUPABASE_RETURNS_BUCKET : SUPABASE_PUBLIC_BUCKET;
    const objectPath = buildStorageObjectPath({
      purpose,
      userId,
      ext: reencoded.ext,
    });

    let uploadedUrl = '';
    let previewSignedUrl: string | undefined;

    // Luôn ghi nhận đối tượng đã xử lý vào kho lưu trữ tiến trình để xác minh tồn tại nhanh & phục vụ test cô lập
    recordObjectInLocalStorage(targetBucket, objectPath, buffer, reencoded.mime);

    if (supabase && process.env.NODE_ENV !== 'test') {
      if (purpose === 'avatar' && req.user?.avatarUrl && supabaseUrl && req.user.avatarUrl.includes(supabaseUrl)) {
        try {
          const oldPathMatch = req.user.avatarUrl.split(`/${SUPABASE_PUBLIC_BUCKET}/`)[1];
          if (oldPathMatch) {
            await supabase.storage.from(SUPABASE_PUBLIC_BUCKET).remove([oldPathMatch]);
          }
        } catch (delErr) {
          console.warn('⚠️ Lỗi xóa ảnh avatar cũ trên Supabase Storage:', delErr);
        }
      }

      const { error: uploadError } = await supabase.storage
        .from(targetBucket)
        .upload(objectPath, buffer, {
          contentType: reencoded.mime,
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`Lỗi tải lên Supabase Storage: ${uploadError.message}`);
      }

      if (isReturnProof) {
        uploadedUrl = objectPath;
        const { data: signData, error: signError } = await supabase.storage
          .from(targetBucket)
          .createSignedUrl(objectPath, 15 * 60);
        if (signError) throw signError;
        previewSignedUrl = signData.signedUrl;
      } else {
        const { data: pubData } = supabase.storage
          .from(targetBucket)
          .getPublicUrl(objectPath);
        uploadedUrl = pubData.publicUrl;
      }
    } else {
      uploadedUrl = isReturnProof
        ? objectPath
        : `data:${reencoded.mime};base64,${buffer.toString('base64')}`;
    }

    // 7. Ghi nhận chủ sở hữu file vào bảng uploads trong CSDL (kiểm tra quyền sở hữu bằng bảng này, không bằng tiền tố đường dẫn)
    const insertedUploads = await queryRows<{ id: string }>(sql`
      INSERT INTO uploads (
        user_id,
        bucket,
        object_path,
        purpose,
        mime_type,
        size_bytes,
        sha256
      )
      VALUES (
        ${userId}::uuid,
        ${targetBucket},
        ${objectPath},
        ${purpose},
        ${reencoded.mime},
        ${buffer.length},
        ${sha256Hex}
      )
      RETURNING id;
    `);

    uploadCountsDaily.set(todayKey, currentCount + 1);

    res.json({
      success: true,
      message: 'Tải ảnh lên thành công',
      uploadId: insertedUploads[0]?.id,
      url: uploadedUrl,
      path: objectPath,
      bucket: targetBucket,
      previewSignedUrl,
      format: reencoded.ext,
      mimeType: reencoded.mime,
      sizeBytes: buffer.length,
      exifStripped: true,
    });
  } catch (err: any) {
    console.error('[UPLOAD INTERNAL ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Lỗi tải ảnh lên',
    });
  }
});

// Phục vụ ảnh sản phẩm công khai (CHỈ cho phép tiền tố products/) từ kho lưu trữ tiến trình hoặc Supabase Public Bucket
apiRouter.get('/upload/public/*', (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const rawPath = String((req.params as any)[0] || '').trim();
  const match =
    rawPath &&
    !rawPath.includes('..') &&
    !rawPath.includes('\\') &&
    !rawPath.includes('\0')
      ? rawPath.match(/^products\/[a-f0-9]{8,64}\/[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$/i)
      : null;

  if (!match) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_PUBLIC_PRODUCT_IMAGE_PATH',
      message: 'Đường dẫn ảnh công khai không hợp lệ (chỉ cho phép tiền tố products/ và không chứa ..)',
    });
  }

  const ext = match[1].toLowerCase();
  const safeContentType =
    ext === 'png'
      ? 'image/png'
      : ext === 'webp'
      ? 'image/webp'
      : 'image/jpeg';

  const localObj = getObjectFromLocalStorageForTest(SUPABASE_PUBLIC_BUCKET, rawPath);
  if (localObj) {
    res.setHeader('Content-Type', safeContentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(localObj.buffer);
  }

  if (supabase) {
    const { data } = supabase.storage.from(SUPABASE_PUBLIC_BUCKET).getPublicUrl(rawPath);
    if (data?.publicUrl) {
      return res.redirect(302, data.publicUrl);
    }
  }

  return res.status(404).json({ success: false, message: 'Không tìm thấy ảnh công khai' });
});

// Endpoint cấp Signed URL ngắn hạn (15 phút) mỗi khi cần hiển thị ảnh đổi trả từ đường dẫn (path) lưu trong CSDL
// Chỉ cấp signed URL cho bucket đổi trả (SUPABASE_RETURNS_BUCKET); từ chối path có "..", ký tự lạ hoặc không bắt đầu bằng id chính chủ (trừ admin)
apiRouter.get('/upload/signed-url', requireAuth, async (req: AuthRequest, res) => {
  try {
    const objectPath = req.query.path as string;

    if (!objectPath || typeof objectPath !== 'string') {
      return res.status(400).json({ success: false, message: 'Thiếu tham số đường dẫn ảnh (path)' });
    }

    // 1. Chống Directory Traversal (".."), ký tự null và ký tự đặc biệt nguy hiểm
    if (objectPath.includes('..') || objectPath.includes('\\') || objectPath.includes('\0') || /[\s<>:"|?*]/.test(objectPath)) {
      return res.status(400).json({ success: false, message: 'Đường dẫn ảnh chứa ký tự không hợp lệ hoặc cố gắng duyệt thư mục' });
    }

    // 2. Kiểm tra cấu trúc đường dẫn chuẩn: chỉ cấp cho thư mục đổi trả (<userId>/return/<filename>)
    const returnPathRegex = /^([a-f0-9\-]+)\/return\/([a-zA-Z0-9_\-\.]+\.(jpg|jpeg|png|webp))$/i;
    const match = objectPath.match(returnPathRegex);

    if (!match) {
      return res.status(400).json({
        success: false,
        message: 'Đường dẫn không hợp lệ. Endpoint này chỉ cấp Signed URL cho ảnh minh chứng đổi trả (<userId>/return/<filename>).',
      });
    }

    const pathUserId = match[1];
    const requestingUserId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    // 3. Kiểm tra quyền sở hữu: chỉ chủ nhân của ảnh (path bắt đầu bằng userId) hoặc Admin mới được cấp Signed URL
    if (!isAdmin && pathUserId !== requestingUserId) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền truy cập hình ảnh đổi trả này' });
    }

    // 4. Chỉ cấp Signed URL từ SUPABASE_RETURNS_BUCKET
    if (!supabase) {
      return res.json({ success: true, signedUrl: objectPath, expiresIn: 900 });
    }

    const { data, error } = await supabase.storage
      .from(SUPABASE_RETURNS_BUCKET)
      .createSignedUrl(objectPath, 15 * 60); // Ngắn hạn 15 phút (900 giây)

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'Không thể tạo liên kết ảnh đổi trả từ bucket', error: error?.message });
    }

    res.json({
      success: true,
      path: objectPath,
      signedUrl: data.signedUrl,
      expiresIn: 900,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Lỗi tạo signed URL', error: err.message });
  }
});

// 1. Kiểm tra trạng thái hệ thống (truy vấn nhẹ kiểm tra CSDL, trả 200 {"status":"ok","database":"connected"} khi thông và 503 {"status":"error"} khi lỗi CSDL)
apiRouter.get('/health', async (_req, res) => {
  try {
    await queryRows(sql`SELECT 1;`);
    res.status(200).json({
      status: 'ok',
      database: 'connected',
    });
  } catch {
    res.status(503).json({
      status: 'error',
    });
  }
});

// 2. Lấy danh sách danh mục đang hoạt động (categories) cho storefront
apiRouter.get('/categories', async (req, res) => {
  try {
    const rows = await queryRows(sql`
      SELECT id, name, slug, parent_id, display_order, is_active
      FROM categories
      WHERE is_active = true
      ORDER BY display_order ASC, name ASC;
    `);
    res.json({ success: true, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. Lấy cài đặt cửa hàng & Bảng quy đổi size
apiRouter.get('/settings/size-charts', async (req, res) => {
  try {
    const rows = await queryRows<{ value: any }>(sql`
      SELECT value FROM store_settings WHERE key = 'size_charts';
    `);
    if (rows.length > 0) {
      res.json({ success: true, data: rows[0].value });
    } else {
      res.status(404).json({ success: false, message: 'Chưa có cấu hình bảng size' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. Lấy thông tin chung của cửa hàng (bao gồm cấu hình phí vận chuyển, đổi trả, tồn kho và thông tin liên hệ từ store_settings)
apiRouter.get('/settings/general', async (req, res) => {
  try {
    const rows = await queryRows<{ key: string; value: any }>(sql`
      SELECT key, value FROM store_settings WHERE key IN ('general', 'contact', 'shipping', 'returns', 'inventory');
    `);
    const generalRow = rows.find((r) => r.key === 'general');
    const contactRow = rows.find((r) => r.key === 'contact');
    const shippingRow = rows.find((r) => r.key === 'shipping');
    const returnsRow = rows.find((r) => r.key === 'returns');
    const inventoryRow = rows.find((r) => r.key === 'inventory');

    const rawGeneral =
      generalRow?.value && typeof generalRow.value === 'object' ? generalRow.value : {};
    const rawContact =
      contactRow?.value && typeof contactRow.value === 'object' ? contactRow.value : {};
    const rawShipping =
      shippingRow?.value && typeof shippingRow.value === 'object' ? shippingRow.value : {};
    const rawReturns =
      returnsRow?.value && typeof returnsRow.value === 'object' ? returnsRow.value : {};
    const rawInventory =
      inventoryRow?.value && typeof inventoryRow.value === 'object' ? inventoryRow.value : {};

    const storeName =
      typeof (rawContact.storeName || rawGeneral.storeName) === 'string' &&
      String(rawContact.storeName || rawGeneral.storeName).trim()
        ? String(rawContact.storeName || rawGeneral.storeName).trim()
        : 'Baity Fashion';

    const phone =
      typeof (rawContact.phone || rawContact.hotline || rawGeneral.phone || rawGeneral.hotline) ===
        'string' &&
      String(rawContact.phone || rawContact.hotline || rawGeneral.phone || rawGeneral.hotline).trim()
        ? String(
            rawContact.phone || rawContact.hotline || rawGeneral.phone || rawGeneral.hotline
          ).trim()
        : MISSING_CONTACT_INFO_TEXT;

    const email =
      typeof (rawContact.email || rawGeneral.email) === 'string' &&
      String(rawContact.email || rawGeneral.email).trim()
        ? String(rawContact.email || rawGeneral.email).trim()
        : MISSING_CONTACT_INFO_TEXT;

    const address =
      typeof (rawContact.address || rawGeneral.address) === 'string' &&
      String(rawContact.address || rawGeneral.address).trim()
        ? String(rawContact.address || rawGeneral.address).trim()
        : MISSING_CONTACT_INFO_TEXT;

    const workingHours =
      typeof (rawContact.workingHours || rawGeneral.workingHours) === 'string'
        ? String(rawContact.workingHours || rawGeneral.workingHours).trim()
        : '';

    const legalEntityName =
      typeof (rawContact.legalEntityName || rawGeneral.legalEntityName) === 'string'
        ? String(rawContact.legalEntityName || rawGeneral.legalEntityName).trim()
        : '';

    const taxId =
      typeof (rawContact.taxId || rawGeneral.taxId) === 'string'
        ? String(rawContact.taxId || rawGeneral.taxId).trim()
        : '';

    const bannerText =
      typeof (rawContact.bannerText ?? rawGeneral.bannerText) === 'string'
        ? String(rawContact.bannerText ?? rawGeneral.bannerText).trim()
        : '';

    const freeShippingThreshold =
      typeof rawShipping.freeShippingThreshold === 'number'
        ? rawShipping.freeShippingThreshold
        : typeof rawGeneral.freeShippingThreshold === 'number'
        ? rawGeneral.freeShippingThreshold
        : DEFAULT_SHIPPING_CONFIG.freeShippingThreshold;

    const defaultShippingFee =
      typeof rawShipping.defaultShippingFee === 'number'
        ? rawShipping.defaultShippingFee
        : typeof rawGeneral.defaultShippingFee === 'number'
        ? rawGeneral.defaultShippingFee
        : DEFAULT_SHIPPING_CONFIG.defaultShippingFee;

    const expressShippingFee =
      typeof rawShipping.expressShippingFee === 'number'
        ? rawShipping.expressShippingFee
        : typeof rawGeneral.expressShippingFee === 'number'
        ? rawGeneral.expressShippingFee
        : DEFAULT_SHIPPING_CONFIG.expressShippingFee;

    const returnDaysLimit =
      typeof rawReturns.returnDaysLimit === 'number'
        ? rawReturns.returnDaysLimit
        : typeof rawGeneral.returnDaysLimit === 'number'
        ? rawGeneral.returnDaysLimit
        : DEFAULT_SHIPPING_CONFIG.returnDaysLimit;

    const returnAddress =
      typeof (rawReturns.returnAddress || rawGeneral.returnAddress) === 'string' &&
      String(rawReturns.returnAddress || rawGeneral.returnAddress).trim()
        ? String(rawReturns.returnAddress || rawGeneral.returnAddress).trim()
        : address;

    const lowStockThreshold =
      typeof rawInventory.lowStockThreshold === 'number'
        ? rawInventory.lowStockThreshold
        : typeof rawGeneral.lowStockThreshold === 'number'
        ? rawGeneral.lowStockThreshold
        : 5;

    res.json({
      success: true,
      data: {
        ...rawGeneral,
        storeName,
        bannerText,
        freeShippingThreshold,
        defaultShippingFee,
        expressShippingFee,
        returnDaysLimit,
        returnAddress,
        lowStockThreshold,
        contact: {
          storeName,
          phone,
          hotline: phone,
          email,
          address,
          workingHours,
          legalEntityName,
          taxId,
          bannerText,
        },
        shipping: {
          defaultShippingFee,
          expressShippingFee,
          freeShippingThreshold,
        },
        returns: {
          returnDaysLimit,
          returnAddress,
        },
        inventory: {
          lowStockThreshold,
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const PUBLIC_POLICY_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=30';

// 5a. Lấy danh sách Chính sách công khai (GET /api/policies) — chỉ trả slug, title, displayOrder
apiRouter.get('/policies', async (_req, res) => {
  try {
    await ensurePoliciesAndFaqSeeded(queryRows);
    const [rows, vars] = await Promise.all([
      queryRows<{ slug: string | null; type: string; title: string; display_order: number }>(sql`
        SELECT slug, type, title, display_order
        FROM faq_policies
        WHERE type <> 'faq' AND type NOT LIKE 'faq:%' AND is_active = true
        ORDER BY display_order ASC, title ASC;
      `),
      buildPolicyTemplateVariables(queryRows),
    ]);

    const items = rows.map((r) => ({
      slug: (r.slug || r.type).replace(/^policy:/i, ''),
      title: interpolatePolicyContent(r.title, vars),
      displayOrder: Number(r.display_order || 0),
    }));

    res.setHeader('Cache-Control', PUBLIC_POLICY_CACHE_CONTROL);
    res.json({
      success: true,
      items,
      data: items,
    });
  } catch (err: any) {
    console.error('[GET /api/policies ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Không thể tải danh sách chính sách lúc này. Vui lòng thử lại sau.',
    });
  }
});

// 5b. Lấy chi tiết một Chính sách theo slug (GET /api/policies/:slug)
apiRouter.get('/policies/:slug', async (req, res) => {
  try {
    const rawSlug = String(req.params.slug || '')
      .trim()
      .toLowerCase();
    if (!rawSlug || rawSlug.length > 100 || !/^[a-z0-9_-]+$/.test(rawSlug)) {
      return res.status(404).json({
        success: false,
        code: 'POLICY_NOT_FOUND',
        message: 'Không tìm thấy chính sách yêu cầu',
      });
    }

    await ensurePoliciesAndFaqSeeded(queryRows);
    const canonicalSlug = POLICY_SLUG_ALIASES[rawSlug] || rawSlug;

    const [rows, vars] = await Promise.all([
      queryRows<{ slug: string | null; type: string; title: string; content: string; display_order: number }>(sql`
        SELECT slug, type, title, content, display_order
        FROM faq_policies
        WHERE type <> 'faq'
          AND type NOT LIKE 'faq:%'
          AND is_active = true
          AND (
            LOWER(COALESCE(slug, '')) = ${canonicalSlug}
            OR LOWER(COALESCE(slug, '')) = ${rawSlug}
            OR LOWER(type) = ${canonicalSlug}
            OR LOWER(type) = ${rawSlug}
            OR LOWER(type) = ${`policy:${canonicalSlug}`}
            OR LOWER(type) = ${`policy:${rawSlug}`}
          )
        ORDER BY display_order ASC
        LIMIT 1;
      `),
      buildPolicyTemplateVariables(queryRows),
    ]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        code: 'POLICY_NOT_FOUND',
        message: 'Không tìm thấy chính sách yêu cầu',
      });
    }

    const row = rows[0];
    const policy = {
      slug: (row.slug || row.type).replace(/^policy:/i, ''),
      title: interpolatePolicyContent(row.title, vars),
      content: interpolatePolicyContent(row.content, vars),
      displayOrder: Number(row.display_order || 0),
    };

    res.setHeader('Cache-Control', PUBLIC_POLICY_CACHE_CONTROL);
    res.json({
      success: true,
      policy,
      data: policy,
    });
  } catch (err: any) {
    console.error('[GET /api/policies/:slug ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Không thể tải nội dung chính sách lúc này. Vui lòng thử lại sau.',
    });
  }
});

// 5c. Lấy danh sách Câu hỏi thường gặp (FAQ) nhóm theo chủ đề (GET /api/faq)
apiRouter.get('/faq', async (_req, res) => {
  try {
    await ensurePoliciesAndFaqSeeded(queryRows);
    const [rows, vars] = await Promise.all([
      queryRows<{ slug: string | null; type: string; title: string; content: string; display_order: number }>(sql`
        SELECT slug, type, title, content, display_order
        FROM faq_policies
        WHERE (type = 'faq' OR type LIKE 'faq:%') AND is_active = true
        ORDER BY display_order ASC, title ASC;
      `),
      buildPolicyTemplateVariables(queryRows),
    ]);

    const groupMap = new Map<
      string,
      {
        topic: string;
        category: string;
        title: string;
        items: {
          slug?: string;
          question: string;
          title: string;
          answer: string;
          content: string;
          topic: string;
          displayOrder: number;
        }[];
      }
    >();

    const flatItems: {
      slug?: string;
      question: string;
      title: string;
      answer: string;
      content: string;
      topic: string;
      displayOrder: number;
    }[] = [];

    for (const r of rows) {
      const question = interpolatePolicyContent(r.title, vars);
      const { topic: rawTopic, answer } = extractFaqTopicAndAnswer(r.content, vars);
      const topic = r.type.startsWith('faq:')
        ? interpolatePolicyContent(r.type.slice(4), vars) || rawTopic
        : rawTopic;
      const item = {
        ...(r.slug ? { slug: r.slug } : {}),
        question,
        title: question,
        answer,
        content: answer,
        topic,
        displayOrder: Number(r.display_order || 0),
      };
      flatItems.push(item);

      if (!groupMap.has(topic)) {
        groupMap.set(topic, {
          topic,
          category: topic,
          title: topic,
          items: [],
        });
      }
      groupMap.get(topic)!.items.push(item);
    }

    const categories = Array.from(groupMap.values());

    res.setHeader('Cache-Control', PUBLIC_POLICY_CACHE_CONTROL);
    res.json({
      success: true,
      categories,
      groups: categories,
      items: flatItems,
      total: flatItems.length,
      data: categories,
    });
  } catch (err: any) {
    console.error('[GET /api/faq ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Không thể tải danh sách câu hỏi thường gặp lúc này. Vui lòng thử lại sau.',
    });
  }
});

// 5d. Lấy danh sách FAQ & Chính sách tổng hợp (tương thích ngược)
apiRouter.get('/faq-policies', async (req, res) => {
  try {
    await ensurePoliciesAndFaqSeeded(queryRows);
    const type = req.query.type as string;
    let query = sql`SELECT type, title, content, display_order FROM faq_policies WHERE is_active = true ORDER BY display_order ASC;`;
    if (type) {
      query = sql`SELECT type, title, content, display_order FROM faq_policies WHERE type = ${type} AND is_active = true ORDER BY display_order ASC;`;
    }
    const [rows, vars] = await Promise.all([
      queryRows<{ type: string; title: string; content: string; display_order: number }>(query),
      buildPolicyTemplateVariables(queryRows),
    ]);
    const sanitized = rows.map((r) => ({
      type: r.type,
      title: interpolatePolicyContent(r.title, vars),
      content: interpolatePolicyContent(r.content, vars),
      displayOrder: Number(r.display_order || 0),
    }));
    res.setHeader('Cache-Control', PUBLIC_POLICY_CACHE_CONTROL);
    res.json({ success: true, data: sanitized });
  } catch (err: any) {
    console.error('[GET /api/faq-policies ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Không thể tải dữ liệu chính sách và câu hỏi thường gặp.',
    });
  }
});

// 6. Cron cleanup task (Endpoint dọn dẹp đơn hết hạn 30p kèm hoàn kho + hoàn voucher, hoàn tất đơn delivered quá 7 ngày, xóa dòng đếm chatbot > 2 ngày, xóa log tìm kiếm ảnh > 90 ngày, và xóa hội thoại hỏi đáp đã đóng > 180 ngày)
apiRouter.post('/tasks/cron-cleanup', async (req, res) => {
  try {
    const cronSecret = req.headers['x-cron-secret'];
    const expectedSecret = process.env.CRON_SECRET_KEY || 'baity-cron-secret-token-key-2026';

    if (cronSecret !== expectedSecret) {
      return res.status(401).json({ success: false, message: 'Unauthorized cron request' });
    }

    const startedAtMs = Date.now();
    const [
      cleanupRes,
      deletedChatbotCountersCount,
      deletedAiSearchLogsCount,
      deletedClosedSellerChatsCount,
    ] = await Promise.all([
      runScopedLazyCleanup({ all: true }),
      cleanupOldChatbotDailyCounters(queryRows),
      cleanupOldAiSearchLogs(queryRows),
      cleanupOldClosedSellerChats(queryRows),
    ]);
    const elapsedMs = Math.max(1, Date.now() - startedAtMs);

    console.info(
      `[CRON CLEANUP] cancelledOrders=${cleanupRes.cancelledOrders.length} completedOrders=${cleanupRes.completedOrders.length} deletedClosedSellerChats=${deletedClosedSellerChatsCount} deletedAiSearchLogs=${deletedAiSearchLogsCount} deletedChatbotCounters=${deletedChatbotCountersCount} elapsedMs=${elapsedMs}`
    );

    res.json({
      success: true,
      message: 'Dọn dẹp định kỳ hoàn tất',
      cancelledCount: cleanupRes.cancelledOrders.length,
      completedCount: cleanupRes.completedOrders.length,
      cancelledOrders: cleanupRes.cancelledOrders,
      completedOrders: cleanupRes.completedOrders,
      deletedChatbotCountersCount,
      deletedAiSearchLogsCount,
      deletedClosedSellerChatsCount,
      deletedClosedSellerChats: deletedClosedSellerChatsCount,
      elapsedMs,
    });
  } catch (err: any) {
    console.error('[POST /api/tasks/cron-cleanup ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Lỗi thực thi tác vụ dọn dẹp định kỳ',
    });
  }
});

