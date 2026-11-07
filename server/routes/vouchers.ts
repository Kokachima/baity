import { Router, type Response } from 'express';
import { queryRows } from '../db/index.ts';
import { sql } from 'drizzle-orm';
import { optionalAuth, type AuthRequest } from '../services/auth.ts';
import {
  calculateVoucherDiscount,
  calculateEffectivePrice,
  calculateServerShippingFee,
  type PromotionInfo,
} from '../services/pricing.ts';
import { getEnrichedCart, getGuestSessionIdFromReq, mergeGuestCartIntoUserCart } from './cart.ts';

export const vouchersRouter = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VoucherEvaluationInput {
  code: string;
  userId?: string | null;
  subtotal: number;
  shippingFee: number;
  categorySubtotals?: Record<string, number>;
  runQuery?: <R = any>(q: any) => Promise<R[]>;
}

export interface InternalVoucherInfo {
  id: string;
  code: string;
  description: string;
  discountType: 'percent' | 'fixed' | 'free_shipping';
  discountValue: number;
  maxDiscount: number | null;
  minOrderValue: number;
  usageLimit: number | null;
  perUserLimit: number;
  usedCount: number;
  applicableCategoryId: string | null;
  applicableCategoryName: string | null;
  startDate: string;
  endDate: string;
}

export interface PublicVoucherInfo {
  code: string;
  description: string;
  discountType: 'percent' | 'fixed' | 'free_shipping';
  discountValue: number;
  maxDiscount: number | null;
  minOrderValue: number;
  applicableCategoryId: string | null;
  applicableCategoryName: string | null;
  startDate: string;
  endDate: string;
}

export interface VoucherEvaluationResult {
  valid: boolean;
  statusCode: number;
  code?: string;
  message: string;
  discountAmount: number;
  voucher?: InternalVoucherInfo;
}

function buildVoucherDescription(v: {
  description?: string | null;
  discount_type: string;
  discount_value: number;
  max_discount: number | null;
  min_order_value: number;
  applicable_category_name?: string | null;
}): string {
  if (typeof v.description === 'string' && v.description.trim()) {
    return v.description.trim();
  }
  const minStr = Number(v.min_order_value || 0).toLocaleString('vi-VN');
  const catSuffix = v.applicable_category_name ? ` cho danh mục ${v.applicable_category_name}` : '';
  if (v.discount_type === 'free_shipping') {
    return `Miễn phí vận chuyển cho đơn từ ${minStr}₫${catSuffix}`;
  }
  if (v.discount_type === 'percent') {
    const maxStr =
      v.max_discount !== null && v.max_discount !== undefined
        ? ` (tối đa ${Number(v.max_discount).toLocaleString('vi-VN')}₫)`
        : '';
    return `Giảm ${Number(v.discount_value)}%${maxStr} cho đơn từ ${minStr}₫${catSuffix}`;
  }
  return `Giảm ${Number(v.discount_value).toLocaleString('vi-VN')}₫ cho đơn từ ${minStr}₫${catSuffix}`;
}

/**
 * Chỉ trích xuất các trường công khai của Voucher để trả về qua HTTP API
 * (Tuyệt đối không lộ id, usedCount/used_count, usageLimit/usage_limit, perUserLimit/per_user_limit)
 */
export function toPublicVoucher(v: InternalVoucherInfo): PublicVoucherInfo {
  return {
    code: v.code,
    description: v.description,
    discountType: v.discountType,
    discountValue: v.discountValue,
    maxDiscount: v.maxDiscount,
    minOrderValue: v.minOrderValue,
    applicableCategoryId: v.applicableCategoryId,
    applicableCategoryName: v.applicableCategoryName,
    startDate: v.startDate,
    endDate: v.endDate,
  };
}

/**
 * Kiểm tra toàn diện điều kiện áp dụng Voucher:
 * 1. Tồn tại và is_active = true
 * 2. Còn trong thời hạn (start_date <= NOW() <= end_date)
 * 3. Chưa vượt tổng lượt dùng (usage_limit IS NULL OR used_count < usage_limit)
 * 4. Chưa vượt giới hạn mỗi người dùng (per_user_limit) trong bảng voucher_usages
 * 5. Đạt giá trị đơn hàng tối thiểu (min_order_value) tính trên tổng tiền hàng sau khuyến mãi
 * 6. Đúng danh mục áp dụng (applicable_category_id) nếu có
 */
export async function evaluateVoucherForOrder(
  input: VoucherEvaluationInput
): Promise<VoucherEvaluationResult> {
  const execQuery = input.runQuery || queryRows;
  const normalizedCode = (input.code || '').trim().toUpperCase();

  if (!normalizedCode) {
    return {
      valid: false,
      statusCode: 400,
      code: 'MISSING_VOUCHER_CODE',
      message: 'Vui lòng nhập mã giảm giá (voucher code)',
      discountAmount: 0,
    };
  }

  const rows = await execQuery<any>(sql`
    SELECT
      v.id,
      v.code,
      v.description,
      v.discount_type,
      v.discount_value,
      v.max_discount,
      v.min_order_value,
      v.usage_limit,
      v.per_user_limit,
      v.used_count,
      v.applicable_category_id,
      v.start_date,
      v.end_date,
      v.is_active,
      (NOW() >= v.start_date) AS is_started,
      (NOW() <= v.end_date) AS is_not_expired,
      c.name AS applicable_category_name
    FROM vouchers v
    LEFT JOIN categories c ON c.id = v.applicable_category_id
    WHERE UPPER(v.code) = ${normalizedCode}
    LIMIT 1;
  `);

  if (rows.length === 0) {
    return {
      valid: false,
      statusCode: 404,
      code: 'VOUCHER_NOT_FOUND',
      message: `Mã giảm giá "${normalizedCode}" không tồn tại`,
      discountAmount: 0,
    };
  }

  const v = rows[0];

  if (!v.is_active) {
    return {
      valid: false,
      statusCode: 400,
      code: 'VOUCHER_INACTIVE',
      message: `Mã giảm giá "${v.code}" hiện đang tạm ngưng hoạt động`,
      discountAmount: 0,
    };
  }

  if (!v.is_started) {
    return {
      valid: false,
      statusCode: 400,
      code: 'VOUCHER_NOT_STARTED',
      message: `Mã giảm giá "${v.code}" chưa đến thời gian có hiệu lực`,
      discountAmount: 0,
    };
  }

  if (!v.is_not_expired) {
    return {
      valid: false,
      statusCode: 400,
      code: 'VOUCHER_EXPIRED',
      message: `Mã giảm giá "${v.code}" đã hết hạn sử dụng`,
      discountAmount: 0,
    };
  }

  // Hỗ trợ usage_limit IS NULL (không giới hạn tổng lượt dùng)
  if (
    v.usage_limit !== null &&
    v.usage_limit !== undefined &&
    Number(v.used_count) >= Number(v.usage_limit)
  ) {
    return {
      valid: false,
      statusCode: 400,
      code: 'VOUCHER_USAGE_EXHAUSTED',
      message: `Mã giảm giá "${v.code}" đã hết tổng lượt sử dụng cho phép`,
      discountAmount: 0,
    };
  }

  // Kiểm tra giới hạn số lần dùng trên mỗi tài khoản (per_user_limit)
  if (input.userId) {
    const usageRows = await execQuery<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM voucher_usages
      WHERE voucher_id = ${v.id}::uuid AND user_id = ${input.userId}::uuid;
    `);
    const userUsedCount = Number(usageRows[0]?.count || 0);
    if (userUsedCount >= Number(v.per_user_limit)) {
      return {
        valid: false,
        statusCode: 400,
        code: 'VOUCHER_USER_LIMIT_REACHED',
        message: `Bạn đã sử dụng hết lượt cho phép của mã "${v.code}" (tối đa ${v.per_user_limit} lần/tài khoản)`,
        discountAmount: 0,
      };
    }
  }

  const subtotal = Math.max(Number(input.subtotal) || 0, 0);
  const shippingFee = Math.max(Number(input.shippingFee) || 0, 0);
  const minOrderValue = Number(v.min_order_value) || 0;

  if (subtotal < minOrderValue) {
    return {
      valid: false,
      statusCode: 400,
      code: 'VOUCHER_MIN_ORDER_NOT_MET',
      message: `Đơn hàng tối thiểu phải đạt ${minOrderValue.toLocaleString('vi-VN')}₫ (sau khuyến mãi) để áp dụng mã "${v.code}"`,
      discountAmount: 0,
    };
  }

  // Kiểm tra danh mục áp dụng (applicable_category_id) nếu voucher giới hạn danh mục
  let targetSubtotalForDiscount = subtotal;
  if (v.applicable_category_id) {
    if (input.categorySubtotals) {
      const catSub = Number(input.categorySubtotals[v.applicable_category_id] || 0);
      if (catSub <= 0) {
        return {
          valid: false,
          statusCode: 400,
          message: `Mã giảm giá "${v.code}" chỉ áp dụng cho sản phẩm thuộc danh mục "${v.applicable_category_name || 'chỉ định'}"`,
          discountAmount: 0,
        };
      }
      targetSubtotalForDiscount = catSub;
    }
  }

  const calc = calculateVoucherDiscount(targetSubtotalForDiscount, shippingFee, {
    discountType: v.discount_type,
    discountValue: Number(v.discount_value),
    maxDiscount: v.max_discount !== null && v.max_discount !== undefined ? Number(v.max_discount) : null,
    minOrderValue: 0, // Đã kiểm tra minOrderValue ở trên
  });

  return {
    valid: true,
    statusCode: 200,
    message: `Áp dụng mã giảm giá "${v.code}" thành công`,
    discountAmount: calc.discountAmount,
    voucher: {
      id: v.id,
      code: v.code,
      description: buildVoucherDescription(v),
      discountType: v.discount_type,
      discountValue: Number(v.discount_value),
      maxDiscount: v.max_discount !== null && v.max_discount !== undefined ? Number(v.max_discount) : null,
      minOrderValue,
      usageLimit: v.usage_limit !== null && v.usage_limit !== undefined ? Number(v.usage_limit) : null,
      perUserLimit: Number(v.per_user_limit),
      usedCount: Number(v.used_count),
      applicableCategoryId: v.applicable_category_id || null,
      applicableCategoryName: v.applicable_category_name || null,
      startDate: v.start_date,
      endDate: v.end_date,
    },
  };
}

/**
 * 1. LẤY DANH SÁCH VOUCHER KHẢ DỤNG (GET /api/vouchers/available & GET /api/vouchers)
 * - Hỗ trợ (v.usage_limit IS NULL OR v.used_count < v.usage_limit)
 * - Chỉ trả các trường công khai của voucher
 */
async function handleGetAvailableVouchers(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id || null;
    const sessionId = getGuestSessionIdFromReq(req);

    if (userId && sessionId) {
      await mergeGuestCartIntoUserCart(sessionId, userId);
    }

    const cart = await getEnrichedCart(userId, userId ? null : sessionId);
    const subtotal = cart.summary.subtotal;
    const shippingFee = cart.summary.estimatedShippingFee;

    const categorySubtotals: Record<string, number> = {};
    for (const item of cart.items) {
      categorySubtotals[item.categoryId] =
        (categorySubtotals[item.categoryId] || 0) + item.lineTotal;
    }

    const vouchersRows = await queryRows<any>(sql`
      SELECT
        v.id,
        v.code,
        v.description,
        v.discount_type,
        v.discount_value,
        v.max_discount,
        v.min_order_value,
        v.usage_limit,
        v.per_user_limit,
        v.used_count,
        v.applicable_category_id,
        v.start_date,
        v.end_date,
        v.is_active,
        c.name AS applicable_category_name
      FROM vouchers v
      LEFT JOIN categories c ON c.id = v.applicable_category_id
      WHERE v.is_active = true
        AND NOW() BETWEEN v.start_date AND v.end_date
        AND (v.usage_limit IS NULL OR v.used_count < v.usage_limit)
      ORDER BY v.min_order_value ASC, v.code ASC;
    `);

    const items = [];
    for (const v of vouchersRows) {
      const evaluation = await evaluateVoucherForOrder({
        code: v.code,
        userId,
        subtotal,
        shippingFee,
        categorySubtotals: cart.items.length > 0 ? categorySubtotals : undefined,
      });

      items.push({
        code: v.code,
        description: buildVoucherDescription(v),
        discountType: v.discount_type,
        discountValue: Number(v.discount_value),
        maxDiscount: v.max_discount !== null && v.max_discount !== undefined ? Number(v.max_discount) : null,
        minOrderValue: Number(v.min_order_value),
        applicableCategoryId: v.applicable_category_id || null,
        applicableCategoryName: v.applicable_category_name || null,
        startDate: v.start_date,
        endDate: v.end_date,
        isEligible: evaluation.valid,
        estimatedDiscount: evaluation.discountAmount,
        ineligibleReason: evaluation.valid ? null : evaluation.message,
      });
    }

    res.json({
      success: true,
      items,
      data: items,
    });
  } catch (err: any) {
    console.error('[VOUCHERS AVAILABLE ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Đã xảy ra lỗi hệ thống khi tải danh sách mã giảm giá',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Đã xảy ra lỗi hệ thống khi tải danh sách mã giảm giá',
      },
    });
  }
}

vouchersRouter.get('/available', optionalAuth, handleGetAvailableVouchers);
vouchersRouter.get('/', optionalAuth, handleGetAvailableVouchers);

// ==========================================
// BỘ ĐẾM RATE LIMIT CÓ GIỚI HẠN BỘ NHỚ CHO POST /api/vouchers/validate
// (Tối đa 30 lần/phút/IP hoặc User, giới hạn tối đa MAX_VOUCHER_RATE_LIMIT_ENTRIES phần tử trong RAM)
// ==========================================
const voucherValidateRateMap = new Map<string, { count: number; windowStart: number }>();
export const VOUCHER_VALIDATE_WINDOW_MS = 60 * 1000;
export const VOUCHER_VALIDATE_MAX_REQUESTS = 30;
export const MAX_VOUCHER_RATE_LIMIT_ENTRIES = 10000;
let lastVoucherPruneTime = 0;

function pruneVoucherRateMap(now: number, maxEntries = MAX_VOUCHER_RATE_LIMIT_ENTRIES): void {
  if (now - lastVoucherPruneTime >= 30_000 || voucherValidateRateMap.size >= maxEntries) {
    lastVoucherPruneTime = now;
    for (const [k, entry] of voucherValidateRateMap.entries()) {
      if (now - entry.windowStart >= VOUCHER_VALIDATE_WINDOW_MS) {
        voucherValidateRateMap.delete(k);
      }
    }
  }

  while (voucherValidateRateMap.size > maxEntries) {
    const oldestKey = voucherValidateRateMap.keys().next().value;
    if (oldestKey === undefined) break;
    voucherValidateRateMap.delete(oldestKey);
  }
}

export function getVoucherRateLimitSizeForTest(): number {
  return voucherValidateRateMap.size;
}

export function pruneVoucherRateLimitWithCapForTest(maxEntries: number): void {
  pruneVoucherRateMap(Date.now(), maxEntries);
}

export function checkVoucherValidateRateLimit(key: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  pruneVoucherRateMap(now);

  const entry = voucherValidateRateMap.get(key);
  if (!entry || now - entry.windowStart >= VOUCHER_VALIDATE_WINDOW_MS) {
    voucherValidateRateMap.delete(key);
    voucherValidateRateMap.set(key, { count: 1, windowStart: now });
    pruneVoucherRateMap(now);
    return { allowed: true, remaining: VOUCHER_VALIDATE_MAX_REQUESTS - 1 };
  }
  if (entry.count >= VOUCHER_VALIDATE_MAX_REQUESTS) {
    return { allowed: false, remaining: 0 };
  }
  entry.count++;
  // Cập nhật vị trí mới nhất trong Map
  voucherValidateRateMap.delete(key);
  voucherValidateRateMap.set(key, entry);
  return { allowed: true, remaining: VOUCHER_VALIDATE_MAX_REQUESTS - entry.count };
}

export function resetVoucherValidateRateLimit(): void {
  voucherValidateRateMap.clear();
}

/**
 * 2. KIỂM TRA VÀ TÍNH TOÁN MÃ VOUCHER (POST /api/vouchers/validate & POST /api/vouchers/apply)
 * - Tích hợp Rate Limiting chống brute-force mã giảm giá
 * - TUYỆT ĐỐI KHÔNG NHẬN subtotal và shippingFee từ client; chỉ tính từ items (lấy giá DB) hoặc giỏ hàng trong DB
 * - Kiểm tra items: tối đa 50 dòng, mỗi dòng quantity là số nguyên từ 1 đến 10
 * - Tính phí vận chuyển bằng hàm dùng chung calculateServerShippingFee (đọc store_settings)
 * - Response chỉ trả các trường công khai của voucher (không lộ id, used_count, usage_limit, per_user_limit)
 */
async function handleValidateVoucher(req: AuthRequest, res: Response) {
  try {
    const rateLimitKey = req.user?.id || req.ip || req.socket?.remoteAddress || 'unknown';
    const rateCheck = checkVoucherValidateRateLimit(rateLimitKey);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        valid: false,
        message: 'Bạn đã thử kiểm tra mã giảm giá quá nhiều lần. Vui lòng thử lại sau 1 phút.',
      });
    }

    const { code, shippingMethod = 'standard', items: rawItems } = req.body || {};
    const userId = req.user?.id || null;
    const sessionId = getGuestSessionIdFromReq(req);
    const normalizedShippingMethod: 'standard' | 'express' =
      shippingMethod === 'express' ? 'express' : 'standard';

    let subtotal = 0;
    const categorySubtotals: Record<string, number> = {};
    let hasCategoryBreakdown = false;

    // Nếu client gửi items: kiểm tra chặt chẽ tối đa 50 dòng, mỗi dòng quantity 1..10
    if (rawItems !== undefined) {
      if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 50) {
        return res.status(400).json({
          success: false,
          valid: false,
          code: 'INVALID_VOUCHER_ITEMS',
          message: 'Danh sách sản phẩm kiểm tra mã giảm giá phải có từ 1 đến tối đa 50 dòng',
        });
      }

      const mergedQtyByVariant = new Map<string, number>();
      for (const item of rawItems) {
        const vid = String(item?.variantId || '').trim();
        const qty = Number(item?.quantity);
        if (!UUID_REGEX.test(vid) || !Number.isInteger(qty) || qty < 1 || qty > 10) {
          return res.status(400).json({
            success: false,
            valid: false,
            code: 'INVALID_VOUCHER_ITEM_QUANTITY',
            message: 'Mỗi dòng sản phẩm phải có variantId hợp lệ và số lượng nguyên từ 1 đến 10',
          });
        }
        const nextQty = (mergedQtyByVariant.get(vid) || 0) + qty;
        if (nextQty > 10) {
          return res.status(400).json({
            success: false,
            valid: false,
            code: 'INVALID_VOUCHER_ITEM_QUANTITY',
            message: 'Tổng số lượng cho mỗi biến thể sản phẩm không được vượt quá 10',
          });
        }
        mergedQtyByVariant.set(vid, nextQty);
      }

      hasCategoryBreakdown = true;
      for (const [vid, qty] of mergedQtyByVariant.entries()) {
        const vRows = await queryRows<any>(sql`
          SELECT
            pv.price_override,
            p.id AS product_id,
            p.base_price,
            p.category_id,
            COALESCE((
              SELECT json_agg(
                json_build_object('id', pr.id, 'title', pr.title, 'discountPercent', pt.discount_percent)
              )
              FROM promotion_targets pt
              JOIN promotions pr ON pr.id = pt.promotion_id
              WHERE pr.is_active = true
                AND NOW() BETWEEN pr.start_time AND pr.end_time
                AND (
                  (pt.target_type = 'product' AND pt.target_id = p.id)
                  OR (pt.target_type = 'category' AND pt.target_id = p.category_id)
                )
            ), '[]'::json) AS active_promotions
          FROM product_variants pv
          JOIN products p ON p.id = pv.product_id
          WHERE pv.id = ${vid}::uuid AND p.is_active = true
          LIMIT 1;
        `);
        if (vRows.length > 0) {
          const row = vRows[0];
          const promos: PromotionInfo[] = Array.isArray(row.active_promotions) ? row.active_promotions : [];
          const calc = calculateEffectivePrice(
            Number(row.base_price),
            row.price_override !== null && row.price_override !== undefined ? Number(row.price_override) : null,
            promos
          );
          const lineTotal = calc.effectivePrice * qty;
          subtotal += lineTotal;
          categorySubtotals[row.category_id] = (categorySubtotals[row.category_id] || 0) + lineTotal;
        }
      }
    } else {
      // Không gửi items: Chỉ tính trực tiếp từ giỏ hàng trong DB của user / session (tuyệt đối bỏ qua subtotal từ client)
      if (userId && sessionId) {
        await mergeGuestCartIntoUserCart(sessionId, userId);
      }
      const cart = await getEnrichedCart(userId, userId ? null : sessionId);
      if (cart.items.length > 0) {
        hasCategoryBreakdown = true;
        subtotal = cart.summary.subtotal;
        for (const item of cart.items) {
          categorySubtotals[item.categoryId] = (categorySubtotals[item.categoryId] || 0) + item.lineTotal;
        }
      }
    }

    // Tính phí vận chuyển chuẩn từ cấu hình server qua hàm dùng chung (tuyệt đối bỏ qua shippingFee từ client)
    const shippingFee =
      subtotal > 0 ? await calculateServerShippingFee(normalizedShippingMethod, subtotal) : 0;

    const result = await evaluateVoucherForOrder({
      code,
      userId,
      subtotal,
      shippingFee,
      categorySubtotals: hasCategoryBreakdown ? categorySubtotals : undefined,
    });

    if (!result.valid || !result.voucher) {
      const errCode = result.code || 'VOUCHER_INVALID';
      return res.status(result.statusCode).json({
        success: false,
        valid: false,
        code: errCode,
        message: result.message,
        discountAmount: 0,
        error: {
          code: errCode,
          message: result.message,
        },
      });
    }

    const publicVoucher = toPublicVoucher(result.voucher);
    const finalTotal = Math.max(subtotal + shippingFee - result.discountAmount, 0);

    res.json({
      success: true,
      valid: true,
      message: result.message,
      voucher: publicVoucher,
      subtotal,
      shippingFee,
      discountAmount: result.discountAmount,
      finalTotal,
      data: {
        voucher: publicVoucher,
        subtotal,
        shippingFee,
        discountAmount: result.discountAmount,
        finalTotal,
      },
    });
  } catch (err: any) {
    console.error('[VOUCHER VALIDATE ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Đã xảy ra lỗi hệ thống khi kiểm tra mã giảm giá',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Đã xảy ra lỗi hệ thống khi kiểm tra mã giảm giá',
      },
    });
  }
}

vouchersRouter.post('/validate', optionalAuth, handleValidateVoucher);
vouchersRouter.post('/apply', optionalAuth, handleValidateVoucher);

