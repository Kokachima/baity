import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { queryRows, withTransaction } from '../db/index.ts';
import { sql } from 'drizzle-orm';
import { requireAuth, requireAdmin, type AuthRequest } from '../services/auth.ts';
import {
  calculateEffectivePrice,
  calculateServerShippingFee,
  type PromotionInfo,
} from '../services/pricing.ts';
import { getVietQRConfig, generateVietQRPayload, verifyWebhookSignature } from '../services/vietqr.ts';
import { runScopedLazyCleanup, cancelOrderTransactional } from '../services/lazyCleanup.ts';
import { transitionOrderStatus } from '../services/orderStateMachine.ts';
import { PAYMENT_STATUS } from '../../shared/contracts.ts';
import { evaluateVoucherForOrder } from './vouchers.ts';
import { getGuestSessionIdFromReq, mergeGuestCartIntoUserCart } from './cart.ts';
import { VN_PHONE_REGEX } from './user.ts';

export { calculateServerShippingFee };

export const ordersRouter = Router();
export const paymentsRouter = Router();

// ==========================================
// CHUẨN HÓA LỖI 500 (KHÔNG LỘ CHI TIẾT SQL / NỘI BỘ)
// ==========================================
function sendOrderRouteError(res: Response, err: any, fallbackMessage: string) {
  const status =
    typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500
      ? err.statusCode
      : 500;

  if (status < 500) {
    return res.status(status).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      message: err.message || fallbackMessage,
    });
  }

  console.error('[ORDER/PAYMENT INTERNAL ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
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
// BỘ GIỚI HẠN TỐC ĐỘ TẠO ĐƠN HÀNG (BOUNDED IN-MEMORY RATE LIMITER)
// Tối đa 10 đơn hàng / giờ / người dùng
// ==========================================
export const ORDER_CREATE_WINDOW_MS = 60 * 60 * 1000; // 1 giờ
export const ORDER_CREATE_MAX_PER_HOUR = 10;
export const MAX_ORDER_RATE_LIMIT_ENTRIES = 10000;
export const MAX_PENDING_ONLINE_ORDERS_PER_USER = 3;

const orderCreateRateMap = new Map<string, { count: number; windowStart: number }>();
let lastOrderRatePruneTime = 0;

function pruneOrderCreateRateMap(now: number, maxEntries = MAX_ORDER_RATE_LIMIT_ENTRIES): void {
  if (now - lastOrderRatePruneTime >= 30_000 || orderCreateRateMap.size >= maxEntries) {
    lastOrderRatePruneTime = now;
    for (const [k, entry] of orderCreateRateMap.entries()) {
      if (now - entry.windowStart >= ORDER_CREATE_WINDOW_MS) {
        orderCreateRateMap.delete(k);
      }
    }
  }
  while (orderCreateRateMap.size > maxEntries) {
    const oldestKey = orderCreateRateMap.keys().next().value;
    if (oldestKey === undefined) break;
    orderCreateRateMap.delete(oldestKey);
  }
}

export function checkOrderCreateRateLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  pruneOrderCreateRateMap(now);
  const entry = orderCreateRateMap.get(userId);
  if (!entry || now - entry.windowStart >= ORDER_CREATE_WINDOW_MS) {
    return { allowed: true, remaining: ORDER_CREATE_MAX_PER_HOUR };
  }
  if (entry.count >= ORDER_CREATE_MAX_PER_HOUR) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: ORDER_CREATE_MAX_PER_HOUR - entry.count };
}

export function recordOrderCreatedForRateLimit(userId: string): void {
  const now = Date.now();
  pruneOrderCreateRateMap(now);
  const entry = orderCreateRateMap.get(userId);
  if (!entry || now - entry.windowStart >= ORDER_CREATE_WINDOW_MS) {
    orderCreateRateMap.delete(userId);
    orderCreateRateMap.set(userId, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
    orderCreateRateMap.delete(userId);
    orderCreateRateMap.set(userId, entry);
  }
  pruneOrderCreateRateMap(now);
}

export function resetOrderCreateRateLimit(userId?: string): void {
  if (userId) {
    orderCreateRateMap.delete(userId);
  } else {
    orderCreateRateMap.clear();
  }
}

// Khóa tuần tự hóa kiểm tra và trừ lượt voucher theo mã voucher (kết hợp SELECT ... FOR UPDATE trong DB)
const voucherCodeLocks = new Map<string, Promise<any>>();
async function withVoucherCodeLock<T>(voucherCode: string, fn: () => Promise<T>): Promise<T> {
  const key = voucherCode.trim().toUpperCase();
  const prev = voucherCodeLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => {
    release = r;
  });
  voucherCodeLocks.set(key, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (voucherCodeLocks.get(key) === next) {
      voucherCodeLocks.delete(key);
    }
  }
}

// ==========================================
// ZOD SCHEMAS KIỂM TRA ĐẦU VÀO POST /api/orders
// ==========================================
const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1, 'Idempotency-Key không được rỗng')
  .max(64, 'Idempotency-Key không được vượt quá 64 ký tự')
  .regex(
    /^[a-zA-Z0-9._:-]{1,64}$/,
    'Idempotency-Key phải là UUID hoặc chuỗi ký tự an toàn (chữ, số, ., _, :, -) tối đa 64 ký tự'
  );

const orderItemInputSchema = z.object({
  variantId: z
    .string()
    .trim()
    .uuid('Mã biến thể (variantId) không đúng định dạng UUID'),
  quantity: z
    .number()
    .int('Số lượng cho mỗi dòng sản phẩm phải là số nguyên từ 1 đến 10')
    .min(1, 'Số lượng cho mỗi dòng sản phẩm tối thiểu là 1')
    .max(10, 'Số lượng cho mỗi dòng sản phẩm tối đa là 10'),
});

const orderItemsArraySchema = z
  .array(orderItemInputSchema)
  .min(1, 'Danh sách sản phẩm đặt hàng phải có ít nhất 1 dòng')
  .max(50, 'Đơn hàng chỉ cho phép tối đa 50 dòng sản phẩm');

const manualRecipientSchema = z.object({
  receiverName: z
    .string()
    .trim()
    .min(2, 'Vui lòng cung cấp họ tên người nhận hàng hợp lệ (tối thiểu 2 ký tự)')
    .max(100, 'Họ tên người nhận hàng không được vượt quá 100 ký tự'),
  receiverPhone: z
    .string()
    .trim()
    .regex(
      VN_PHONE_REGEX,
      'Vui lòng cung cấp số điện thoại người nhận hợp lệ theo định dạng số điện thoại Việt Nam'
    ),
  shippingAddress: z
    .string()
    .trim()
    .min(5, 'Vui lòng cung cấp địa chỉ giao hàng chi tiết (tối thiểu 5 ký tự)')
    .max(300, 'Địa chỉ giao hàng không được vượt quá 300 ký tự'),
});

/**
 * Helper lấy dữ liệu chi tiết đơn hàng chuẩn hóa cho phản hồi API
 */
export async function getOrderDetailsForResponse(orderId: string, runQuery: any = queryRows) {
  const orderRows = await runQuery(sql`
    SELECT o.*, pm.method AS payment_method, pm.status AS payment_status, pm.transaction_id, pm.paid_at
    FROM orders o
    LEFT JOIN payments pm ON pm.order_id = o.id
    WHERE o.id = ${orderId}
    LIMIT 1;
  `);
  if (orderRows.length === 0) return null;
  const order = orderRows[0];

  const [items, statusHistory, voucherRows] = await Promise.all([
    runQuery(sql`
      SELECT
        oi.id,
        oi.variant_id AS "variantId",
        oi.product_name AS "productName",
        oi.color,
        oi.size,
        oi.unit_price AS "unitPrice",
        oi.quantity,
        oi.total_price AS "totalPrice",
        COALESCE((
          SELECT pi.image_url
          FROM product_variants pv
          JOIN product_images pi ON pi.product_id = pv.product_id
          WHERE pv.id = oi.variant_id
          ORDER BY pi.is_primary DESC, pi.display_order ASC
          LIMIT 1
        ), '') AS "imageUrl"
      FROM order_items oi
      WHERE oi.order_id = ${orderId};
    `),
    runQuery(sql`
      SELECT id, status, note, changed_by AS "changedBy", created_at AS "createdAt"
      FROM order_status_history
      WHERE order_id = ${orderId}
      ORDER BY created_at ASC, id ASC;
    `),
    runQuery(sql`
      SELECT v.code, v.discount_type AS "discountType", v.discount_value AS "discountValue", v.max_discount AS "maxDiscount"
      FROM voucher_usages vu
      JOIN vouchers v ON v.id = vu.voucher_id
      WHERE vu.order_id = ${orderId}
      LIMIT 1;
    `),
  ]);

  const vietqrConfig = await getVietQRConfig();
  const vietqr =
    order.payment_method === 'vietqr'
      ? generateVietQRPayload({
          orderId: order.id,
          amount: Number(order.total_amount),
          config: vietqrConfig,
          createdAt: order.created_at,
        })
      : null;

  return {
    id: order.id,
    orderId: order.id,
    orderCode: order.id,
    order_code: order.id,
    userId: order.user_id,
    idempotencyKey: order.idempotency_key || null,
    receiverName: order.receiver_name,
    receiverPhone: order.receiver_phone,
    shippingAddress: order.shipping_address,
    shippingMethod: order.shipping_method,
    shippingFee: Number(order.shipping_fee),
    subtotal: Number(order.subtotal),
    discountAmount: Number(order.discount_amount),
    totalAmount: Number(order.total_amount),
    status: order.status,
    cancelReason: order.cancel_reason,
    trackingCode: order.tracking_code,
    deliveredAt: order.delivered_at,
    completedAt: order.completed_at,
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status || 'pending',
    payment: {
      method: order.payment_method,
      status: order.payment_status || 'pending',
      transactionId: order.transaction_id,
      paidAt: order.paid_at,
    },
    voucher: voucherRows[0] || null,
    createdAt: order.created_at,
    items,
    statusHistory,
    vietqr,
  };
}

/**
 * 1. ĐẶT HÀNG (POST /api/orders)
 * - Bắt buộc đăng nhập
 * - Kiểm tra đầu vào bằng Zod:
 *   + Idempotency-Key: UUID hoặc chuỗi an toàn <= 64 ký tự
 *   + items: tối đa 50 dòng, mỗi dòng quantity nguyên 1..10
 *   + Khi không dùng addressId: receiverName 2..100 ký tự, phone theo VN_PHONE_REGEX, shippingAddress 5..300 ký tự
 * - Chống giữ kho ảo: tối đa 3 đơn chờ thanh toán trực tuyến (vietqr, wallet, card) cùng lúc; rate limit 10 đơn/giờ/người
 * - Thực thi trong một Transaction ACID:
 *   + Sắp xếp itemsToOrder theo variantId tăng dần trước khi UPDATE để chống Deadlock khi đặt nhiều món song song
 *   + Khóa dòng voucher (SELECT ... FOR UPDATE) trước khi kiểm tra per_user_limit và (usage_limit IS NULL OR used_count < usage_limit)
 */
ordersRouter.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const hasRawIdempotencyHeader = req.headers['idempotency-key'] !== undefined;
  const hasRawIdempotencyBody = req.body?.idempotencyKey !== undefined && req.body?.idempotencyKey !== null;
  const rawIdempotencyKey = (req.headers['idempotency-key'] ?? req.body?.idempotencyKey ?? '') as string;

  let idempotencyKey: string | null = null;
  if (hasRawIdempotencyHeader || hasRawIdempotencyBody) {
    const keyStr = String(rawIdempotencyKey).trim();
    const keyParse = idempotencyKeySchema.safeParse(keyStr);
    if (!keyParse.success) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: keyParse.error.issues[0]?.message || 'Idempotency-Key không hợp lệ',
      });
    }
    idempotencyKey = keyParse.data;
  }

  try {
    const userId = req.user!.id;

    const {
      addressId,
      receiverName: rawReceiverName,
      receiverPhone: rawReceiverPhone,
      phone: rawPhone,
      shippingAddress: rawShippingAddress,
      province,
      district,
      ward,
      streetAddress,
      shippingMethod = 'standard',
      paymentMethod = 'cod',
      voucherCode,
      items: requestedItems,
    } = req.body || {};

    const normalizedPaymentMethod = String(paymentMethod || 'cod').toLowerCase();
    if (!['cod', 'vietqr', 'card', 'wallet'].includes(normalizedPaymentMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Phương thức thanh toán không hợp lệ (chỉ hỗ trợ cod, vietqr, card hoặc wallet)',
      });
    }

    const normalizedShippingMethod: 'standard' | 'express' =
      shippingMethod === 'express' ? 'express' : 'standard';

    // Kiểm tra mảng items bằng Zod nếu client truyền items
    let validatedRequestedItems: { variantId: string; quantity: number }[] | null = null;
    if (requestedItems !== undefined && requestedItems !== null) {
      if (!Array.isArray(requestedItems)) {
        return res.status(400).json({
          success: false,
          message: 'Danh sách sản phẩm đặt hàng (items) phải là một mảng hợp lệ',
        });
      }
      // Nếu mảng rỗng được truyền tường minh -> báo lỗi 400
      const parsedItems = orderItemsArraySchema.safeParse(
        requestedItems.map((it: any) => ({
          variantId: typeof it?.variantId === 'string' ? it.variantId : String(it?.variantId ?? ''),
          quantity: typeof it?.quantity === 'number' ? it.quantity : Number(it?.quantity),
        }))
      );
      if (!parsedItems.success) {
        return res.status(400).json({
          success: false,
          message: parsedItems.error.issues[0]?.message || 'Danh sách sản phẩm đặt hàng không hợp lệ',
        });
      }

      // Gộp các dòng trùng variantId và kiểm tra tổng quantity mỗi dòng <= 10, tổng số dòng <= 50
      const mergedMap = new Map<string, number>();
      for (const item of parsedItems.data) {
        const nextQty = (mergedMap.get(item.variantId) || 0) + item.quantity;
        if (nextQty > 10) {
          return res.status(400).json({
            success: false,
            message: 'Số lượng tối đa cho mỗi dòng biến thể sản phẩm trong đơn hàng là 10',
          });
        }
        mergedMap.set(item.variantId, nextQty);
      }
      validatedRequestedItems = Array.from(mergedMap.entries()).map(([variantId, quantity]) => ({
        variantId,
        quantity,
      }));
    }

    // Xác định và kiểm tra thông tin địa chỉ người nhận trước khi kiểm tra Idempotency
    let finalReceiverName = '';
    let finalReceiverPhone = '';
    let finalShippingAddress = '';

    if (addressId) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(String(addressId))) {
        return res.status(400).json({
          success: false,
          message: 'Mã địa chỉ (addressId) không hợp lệ',
        });
      }

      const addrRows = await queryRows<{
        id: string;
        user_id: string;
        receiver_name: string;
        phone: string;
        province: string;
        district: string;
        ward: string;
        street_address: string;
      }>(sql`
        SELECT id, user_id, receiver_name, phone, province, district, ward, street_address
        FROM addresses
        WHERE id = ${addressId}::uuid
        LIMIT 1;
      `);

      if (addrRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy địa chỉ nhận hàng đã chọn',
        });
      }

      if (addrRows[0].user_id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Bạn không có quyền sử dụng địa chỉ của người dùng khác',
        });
      }

      const a = addrRows[0];
      finalReceiverName = a.receiver_name;
      finalReceiverPhone = a.phone;
      finalShippingAddress = [a.street_address, a.ward, a.district, a.province]
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .join(', ');
    } else {
      const candidateName = String(rawReceiverName || '').trim();
      const candidatePhone = String(rawReceiverPhone || rawPhone || '').trim();
      let candidateAddress = '';
      if (rawShippingAddress && String(rawShippingAddress).trim()) {
        candidateAddress = String(rawShippingAddress).trim();
      } else if (streetAddress || ward || district || province) {
        candidateAddress = [streetAddress, ward, district, province]
          .map((s) => String(s || '').trim())
          .filter(Boolean)
          .join(', ');
      }

      const parsedRecipient = manualRecipientSchema.safeParse({
        receiverName: candidateName,
        receiverPhone: candidatePhone,
        shippingAddress: candidateAddress,
      });

      if (!parsedRecipient.success) {
        return res.status(400).json({
          success: false,
          message: parsedRecipient.error.issues[0]?.message || 'Thông tin người nhận hàng không hợp lệ',
        });
      }

      finalReceiverName = parsedRecipient.data.receiverName;
      finalReceiverPhone = parsedRecipient.data.receiverPhone;
      finalShippingAddress = parsedRecipient.data.shippingAddress;
    }

    // Kiểm tra Idempotency trước khi xử lý tạo đơn mới
    if (idempotencyKey) {
      const existingRows = await queryRows<{
        id: string;
        user_id: string;
        shipping_method: string;
        receiver_name: string;
        receiver_phone: string;
        shipping_address: string;
      }>(sql`
        SELECT id, user_id, shipping_method, receiver_name, receiver_phone, shipping_address
        FROM orders
        WHERE idempotency_key = ${idempotencyKey}
        LIMIT 1;
      `);

      if (existingRows.length > 0) {
        if (existingRows[0].user_id !== userId) {
          return res.status(403).json({
            success: false,
            message: 'Idempotency-Key đã được sử dụng bởi một tài khoản khác',
          });
        }

        const existingOrder = existingRows[0];
        const [existingItems, existingPayment, existingVoucher] = await Promise.all([
          queryRows<{ variant_id: string; quantity: number }>(sql`
            SELECT variant_id, quantity FROM order_items WHERE order_id = ${existingOrder.id} ORDER BY variant_id ASC;
          `),
          queryRows<{ method: string }>(sql`
            SELECT method FROM payments WHERE order_id = ${existingOrder.id} LIMIT 1;
          `),
          queryRows<{ code: string }>(sql`
            SELECT v.code FROM voucher_usages vu JOIN vouchers v ON v.id = vu.voucher_id WHERE vu.order_id = ${existingOrder.id} LIMIT 1;
          `),
        ]);

        let isPayloadMatching = true;

        // 1. So khớp phương thức vận chuyển & thanh toán
        if (normalizedShippingMethod !== existingOrder.shipping_method) {
          isPayloadMatching = false;
        }
        if (normalizedPaymentMethod !== (existingPayment[0]?.method || 'cod')) {
          isPayloadMatching = false;
        }

        // 2. So khớp mã voucher
        const incomingVoucher = voucherCode ? String(voucherCode).trim().toUpperCase() : null;
        const existingVoucherCode = existingVoucher[0]?.code
          ? String(existingVoucher[0].code).trim().toUpperCase()
          : null;
        if (incomingVoucher !== existingVoucherCode) {
          isPayloadMatching = false;
        }

        // 3. So khớp thông tin người nhận và địa chỉ nhận hàng (đặc biệt quan trọng cả khi client gửi hoặc không gửi items)
        if (
          finalReceiverName !== existingOrder.receiver_name ||
          finalReceiverPhone !== existingOrder.receiver_phone ||
          finalShippingAddress !== existingOrder.shipping_address
        ) {
          isPayloadMatching = false;
        }

        // 4. So khớp danh sách sản phẩm nếu client gửi items
        if (validatedRequestedItems && validatedRequestedItems.length > 0) {
          const incomingItems = [...validatedRequestedItems].sort((a, b) =>
            String(a.variantId).localeCompare(String(b.variantId))
          );
          const existingSorted = [...existingItems].sort((a, b) =>
            String(a.variant_id).localeCompare(String(b.variant_id))
          );
          if (incomingItems.length !== existingSorted.length) {
            isPayloadMatching = false;
          } else {
            for (let i = 0; i < incomingItems.length; i++) {
              if (
                incomingItems[i].variantId !== existingSorted[i].variant_id ||
                Number(incomingItems[i].quantity) !== Number(existingSorted[i].quantity)
              ) {
                isPayloadMatching = false;
                break;
              }
            }
          }
        }

        if (!isPayloadMatching) {
          return res.status(422).json({
            success: false,
            code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
            message: 'Idempotency-Key đã được sử dụng với nội dung đặt hàng hoặc địa chỉ nhận hàng khác. Vui lòng sử dụng khóa mới.',
          });
        }

        const fullOrder = await getOrderDetailsForResponse(existingOrder.id);
        return res.status(200).json({
          success: true,
          idempotent: true,
          message: 'Đơn hàng đã được tạo trước đó với khóa này (Idempotent)',
          order: fullOrder,
          data: fullOrder,
        });
      }
    }

    // Kiểm tra Rate Limit tạo đơn hàng (tối đa 10 đơn / giờ / người dùng)
    const rateCheck = checkOrderCreateRateLimit(userId);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        code: 'ORDER_RATE_LIMIT_EXCEEDED',
        message: `Bạn đã tạo tối đa ${ORDER_CREATE_MAX_PER_HOUR} đơn hàng trong 1 giờ qua. Vui lòng thử lại sau.`,
      });
    }

    const guestSessionId = getGuestSessionIdFromReq(req);
    if (guestSessionId) {
      await mergeGuestCartIntoUserCart(guestSessionId, userId);
    }

    // Mục 5: Trước khi đếm giới hạn 3 đơn chờ thanh toán, luôn chạy dọn dẹp có phạm vi (Scoped Lazy Cleanup)
    // cho các đơn quá hạn 30 phút của chính người dùng này (hoàn kho & hoàn voucher đúng 1 lần) để khách thật không bị chặn oan
    await runScopedLazyCleanup({ userId });

    const vietqrConfig = await getVietQRConfig();
    const normalizedVoucherCode =
      voucherCode && String(voucherCode).trim() !== ''
        ? String(voucherCode).trim().toUpperCase()
        : null;

    const executeOrderTransaction = async () =>
      await withTransaction(async (txQueryRows) => {
        // 0. Chống giữ kho ảo: Mỗi người tối đa 3 đơn đang chờ thanh toán (vietqr, wallet, card) cùng lúc
        if (normalizedPaymentMethod !== 'cod') {
          const pendingOnlineRows = await txQueryRows<{ count: number }>(sql`
            SELECT COUNT(*)::int AS count
            FROM orders o
            JOIN payments pm ON pm.order_id = o.id
            WHERE o.user_id = ${userId}::uuid
              AND o.status = 'pending'
              AND pm.status = 'pending'
              AND pm.method IN ('vietqr', 'wallet', 'card');
          `);
          const pendingOnlineCount = Number(pendingOnlineRows[0]?.count || 0);
          if (pendingOnlineCount >= MAX_PENDING_ONLINE_ORDERS_PER_USER) {
            const err: any = new Error(
              `Bạn đang có ${pendingOnlineCount} đơn hàng chờ thanh toán trực tuyến (tối đa ${MAX_PENDING_ONLINE_ORDERS_PER_USER} đơn cùng lúc). Vui lòng hoàn tất thanh toán hoặc hủy đơn chờ trước khi tạo đơn mới.`
            );
            err.statusCode = 400;
            err.code = 'MAX_PENDING_PAYMENT_ORDERS';
            throw err;
          }
        }

        // 1. Lấy danh sách biến thể & số lượng cần đặt (từ body.items hoặc từ cart_items của user)
        let itemsToOrder: { variantId: string; quantity: number }[] = [];

        if (validatedRequestedItems && validatedRequestedItems.length > 0) {
          itemsToOrder = [...validatedRequestedItems];
        } else {
          const cartRows = await txQueryRows<{ variant_id: string; quantity: number }>(sql`
            SELECT variant_id, quantity
            FROM cart_items
            WHERE user_id = ${userId}::uuid
            ORDER BY created_at ASC, id ASC;
          `);
          itemsToOrder = cartRows.map((r) => ({
            variantId: r.variant_id,
            quantity: Number(r.quantity),
          }));
        }

        if (itemsToOrder.length === 0) {
          const err: any = new Error('Giỏ hàng trống. Vui lòng chọn sản phẩm trước khi đặt hàng.');
          err.statusCode = 400;
          throw err;
        }

        if (itemsToOrder.length > 50) {
          const err: any = new Error('Đơn hàng chỉ cho phép tối đa 50 dòng sản phẩm.');
          err.statusCode = 400;
          throw err;
        }

        for (const item of itemsToOrder) {
          if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10) {
            const err: any = new Error('Số lượng cho mỗi dòng sản phẩm phải là số nguyên từ 1 đến 10.');
            err.statusCode = 400;
            throw err;
          }
        }

        // BẮT BUỘC SẮP XẾP CÁC DÒNG THEO variantId TRƯỚC KHI UPDATE KHO ĐỂ CHỐNG DEADLOCK KHI ĐẶT NHIỀU MÓN SONG SONG
        itemsToOrder.sort((a, b) => a.variantId.localeCompare(b.variantId));

        // 2. Duyệt từng biến thể theo thứ tự variantId đã sắp xếp: Kiểm tra sản phẩm, tính giá hiệu lực từ DB và TRỪ KHO CÓ ĐIỀU KIỆN
        const preparedOrderItems: {
          variantId: string;
          productId: string;
          categoryId: string;
          productName: string;
          color: string;
          size: string;
          sku: string;
          unitPrice: number;
          quantity: number;
          totalPrice: number;
        }[] = [];

        let subtotal = 0;
        const categorySubtotals: Record<string, number> = {};

        for (const reqItem of itemsToOrder) {
          const variantInfoRows = await txQueryRows<any>(sql`
            SELECT
              pv.id AS variant_id,
              pv.color_name,
              pv.size,
              pv.sku,
              pv.stock_quantity,
              pv.price_override,
              p.id AS product_id,
              p.name AS product_name,
              p.base_price,
              p.is_active,
              p.category_id,
              COALESCE((
                SELECT json_agg(
                  json_build_object(
                    'id', pr.id,
                    'title', pr.title,
                    'discountPercent', pt.discount_percent
                  )
                  ORDER BY pt.discount_percent DESC
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
            WHERE pv.id = ${reqItem.variantId}::uuid
            LIMIT 1;
          `);

          if (variantInfoRows.length === 0 || !variantInfoRows[0].is_active) {
            const err: any = new Error(
              'Một hoặc nhiều sản phẩm trong đơn hàng không tồn tại hoặc đã ngừng kinh doanh'
            );
            err.statusCode = 400;
            throw err;
          }

          const vInfo = variantInfoRows[0];

          // Trừ kho có điều kiện nguyên tử (Atomic Conditional Stock Update) theo thứ tự variantId đã sắp xếp
          const deductedRows = await txQueryRows<{ id: string; stock_quantity: number }>(sql`
            UPDATE product_variants
            SET stock_quantity = stock_quantity - ${reqItem.quantity}
            WHERE id = ${reqItem.variantId}::uuid
              AND stock_quantity >= ${reqItem.quantity}
            RETURNING id, stock_quantity;
          `);

          if (deductedRows.length === 0) {
            const err: any = new Error(
              `Sản phẩm "${vInfo.product_name}" (${vInfo.color_name} - Size ${vInfo.size}) không đủ số lượng tồn kho (hiện còn ${vInfo.stock_quantity} sản phẩm)`
            );
            err.statusCode = 400;
            throw err;
          }

          // Tính đơn giá hiệu lực chính xác từ DB
          const promos: PromotionInfo[] = Array.isArray(vInfo.active_promotions)
            ? vInfo.active_promotions
            : [];
          const priceCalc = calculateEffectivePrice(
            Number(vInfo.base_price),
            vInfo.price_override !== null && vInfo.price_override !== undefined
              ? Number(vInfo.price_override)
              : null,
            promos
          );

          const unitPrice = priceCalc.effectivePrice;
          const totalPrice = unitPrice * reqItem.quantity;

          subtotal += totalPrice;
          categorySubtotals[vInfo.category_id] =
            (categorySubtotals[vInfo.category_id] || 0) + totalPrice;

          preparedOrderItems.push({
            variantId: reqItem.variantId,
            productId: vInfo.product_id,
            categoryId: vInfo.category_id,
            productName: vInfo.product_name,
            color: vInfo.color_name,
            size: vInfo.size,
            sku: vInfo.sku,
            unitPrice,
            quantity: reqItem.quantity,
            totalPrice,
          });
        }

        // 3. Tính phí vận chuyển từ server qua hàm dùng chung calculateServerShippingFee
        const shippingFee = await calculateServerShippingFee(
          normalizedShippingMethod,
          subtotal,
          txQueryRows
        );

        // 4. Kiểm tra và trừ lượt sử dụng Voucher (nếu có truyền voucherCode)
        // BẮT BUỘC KHÓA DÒNG VOUCHER (SELECT ... FOR UPDATE) TRƯỚC KHI KIỂM TRA per_user_limit TRONG CÙNG TRANSACTION
        let discountAmount = 0;
        let appliedVoucherId: string | null = null;
        let appliedVoucherCode: string | null = null;

        if (normalizedVoucherCode) {
          // Khóa dòng voucher trong transaction trước khi đọc voucher_usages để chống race condition vượt per_user_limit
          await txQueryRows(sql`
            SELECT id
            FROM vouchers
            WHERE UPPER(code) = ${normalizedVoucherCode}
            FOR UPDATE;
          `);

          const evalRes = await evaluateVoucherForOrder({
            code: normalizedVoucherCode,
            userId,
            subtotal,
            shippingFee,
            categorySubtotals,
            runQuery: txQueryRows,
          });

          if (!evalRes.valid || !evalRes.voucher) {
            const err: any = new Error(evalRes.message);
            err.statusCode = evalRes.statusCode || 400;
            err.code = evalRes.code;
            throw err;
          }

          // Cập nhật used_count nguyên tử có điều kiện (hỗ trợ cả usage_limit IS NULL không giới hạn)
          const updatedVoucher = await txQueryRows<{ id: string }>(sql`
            UPDATE vouchers
            SET used_count = used_count + 1
            WHERE id = ${evalRes.voucher.id}::uuid
              AND is_active = true
              AND NOW() BETWEEN start_date AND end_date
              AND (usage_limit IS NULL OR used_count < usage_limit)
            RETURNING id;
          `);

          if (updatedVoucher.length === 0) {
            const err: any = new Error(`Mã giảm giá "${evalRes.voucher.code}" vừa hết lượt sử dụng`);
            err.statusCode = 400;
            err.code = 'VOUCHER_USAGE_EXHAUSTED';
            throw err;
          }

          discountAmount = evalRes.discountAmount;
          appliedVoucherId = evalRes.voucher.id;
          appliedVoucherCode = evalRes.voucher.code;
        }

        const totalAmount = Math.max(subtotal + shippingFee - discountAmount, 0);

        // 5. Sinh mã đơn hàng BAITY-XXXX từ PostgreSQL sequence order_code_seq
        const seqRows = await txQueryRows<{ seq: string }>(sql`
          SELECT nextval('order_code_seq')::text AS seq;
        `);
        const orderId = `BAITY-${seqRows[0].seq}`;

        // 6. Tạo bản ghi đơn hàng (orders) kèm idempotency_key
        const insertedOrders = await txQueryRows<any>(sql`
          INSERT INTO orders (
            id,
            user_id,
            idempotency_key,
            receiver_name,
            receiver_phone,
            shipping_address,
            shipping_method,
            shipping_fee,
            subtotal,
            discount_amount,
            total_amount,
            status
          )
          VALUES (
            ${orderId},
            ${userId}::uuid,
            ${idempotencyKey},
            ${finalReceiverName},
            ${finalReceiverPhone},
            ${finalShippingAddress},
            ${normalizedShippingMethod},
            ${shippingFee},
            ${subtotal},
            ${discountAmount},
            ${totalAmount},
            'pending'
          )
          RETURNING *;
        `);
        const createdOrder = insertedOrders[0];

        // 7. Tạo chi tiết đơn hàng (order_items) & lịch sử kho (stock_movements)
        for (const item of preparedOrderItems) {
          const insItemRows = await txQueryRows<{ id: string }>(sql`
            INSERT INTO order_items (
              order_id,
              variant_id,
              product_name,
              color,
              size,
              unit_price,
              quantity,
              total_price
            )
            VALUES (
              ${orderId},
              ${item.variantId}::uuid,
              ${item.productName},
              ${item.color},
              ${item.size},
              ${item.unitPrice},
              ${item.quantity},
              ${item.totalPrice}
            )
            RETURNING id;
          `);
          (item as any).id = insItemRows[0]?.id;

          await txQueryRows(sql`
            INSERT INTO stock_movements (variant_id, delta_quantity, reason, reference_id)
            VALUES (${item.variantId}::uuid, ${-item.quantity}, 'order_placed', ${orderId});
          `);
        }

        // 8. Lưu lịch sử sử dụng voucher (voucher_usages) nếu có
        if (appliedVoucherId) {
          await txQueryRows(sql`
            INSERT INTO voucher_usages (voucher_id, user_id, order_id)
            VALUES (${appliedVoucherId}::uuid, ${userId}::uuid, ${orderId});
          `);
        }

        // 9. Tạo bản ghi thanh toán (payments)
        await txQueryRows(sql`
          INSERT INTO payments (order_id, method, status)
          VALUES (${orderId}, ${normalizedPaymentMethod}, 'pending');
        `);

        // 10. Ghi lịch sử trạng thái đơn hàng (order_status_history)
        const initialNote =
          normalizedPaymentMethod === 'vietqr'
            ? 'Đơn hàng đã được tạo, đang chờ thanh toán chuyển khoản VietQR (hạn 30 phút)'
            : 'Đơn hàng đã được tạo thành công, đang chờ xác nhận';

        await txQueryRows(sql`
          INSERT INTO order_status_history (order_id, status, note, changed_by)
          VALUES (${orderId}, 'pending', ${initialNote}, 'customer');
        `);

        // 11. Xóa các sản phẩm đã đặt khỏi giỏ hàng của người dùng
        const orderedVariantIds = preparedOrderItems.map((i) => sql`${i.variantId}::uuid`);
        await txQueryRows(sql`
          DELETE FROM cart_items
          WHERE user_id = ${userId}::uuid
            AND variant_id IN (${sql.join(orderedVariantIds, sql`, `)});
        `);

        const vietqr =
          normalizedPaymentMethod === 'vietqr'
            ? generateVietQRPayload({
                orderId,
                amount: totalAmount,
                config: vietqrConfig,
                createdAt: createdOrder.created_at,
              })
            : null;

        return {
          id: orderId,
          orderId,
          orderCode: orderId,
          order_code: orderId,
          userId,
          idempotencyKey,
          receiverName: finalReceiverName,
          receiverPhone: finalReceiverPhone,
          shippingAddress: finalShippingAddress,
          shippingMethod: normalizedShippingMethod,
          shippingFee,
          subtotal,
          discountAmount,
          totalAmount,
          voucherCode: appliedVoucherCode,
          status: createdOrder.status,
          paymentMethod: normalizedPaymentMethod,
          paymentStatus: 'pending',
          payment: {
            method: normalizedPaymentMethod,
            status: 'pending',
          },
          createdAt: createdOrder.created_at,
          items: preparedOrderItems,
          vietqr,
        };
      });

    const orderResult = normalizedVoucherCode
      ? await withVoucherCodeLock(normalizedVoucherCode, executeOrderTransaction)
      : await executeOrderTransaction();

    recordOrderCreatedForRateLimit(userId);

    res.status(201).json({
      success: true,
      message: 'Đặt hàng thành công',
      order: orderResult,
      data: orderResult,
    });
  } catch (err: any) {
    // Xử lý race condition khi 2 request gửi đồng thời cùng 1 Idempotency-Key
    if (
      idempotencyKey &&
      (err.code === '23505' ||
        err.message?.includes('idempotency_key') ||
        err.message?.includes('orders_idempotency_key_unique'))
    ) {
      const existingRows = await queryRows<{ id: string }>(sql`
        SELECT id FROM orders WHERE idempotency_key = ${idempotencyKey} LIMIT 1;
      `);
      if (existingRows.length > 0) {
        const fullOrder = await getOrderDetailsForResponse(existingRows[0].id);
        return res.status(200).json({
          success: true,
          idempotent: true,
          message: 'Đơn hàng đã được tạo trước đó với khóa này (Idempotent)',
          order: fullOrder,
          data: fullOrder,
        });
      }
    }

    return sendOrderRouteError(res, err, 'Đã xảy ra lỗi hệ thống khi tạo đơn hàng');
  }
});

/**
 * 2. DANH SÁCH ĐƠN HÀNG CỦA TÔI (GET /api/orders)
 * - Tự động chạy Scoped Lazy Cleanup cho chính user đang đăng nhập trước khi trả kết quả
 */
ordersRouter.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const statusFilter = req.query.status as string | undefined;
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize || 10)));
    const offset = (page - 1) * pageSize;

    // Chạy Lazy Cleanup chỉ trong phạm vi đơn hàng của chính user này
    await runScopedLazyCleanup({ userId });

    const conditions = [sql`o.user_id = ${userId}::uuid`];
    if (statusFilter && statusFilter.trim() !== '' && statusFilter !== 'all') {
      conditions.push(sql`o.status = ${statusFilter.trim()}`);
    }

    const whereClause = sql.join(conditions, sql` AND `);

    const [totalRows, rows] = await Promise.all([
      queryRows<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count
        FROM orders o
        WHERE ${whereClause};
      `),
      queryRows<any>(sql`
        SELECT
          o.*,
          pm.method AS payment_method,
          pm.status AS payment_status,
          pm.transaction_id,
          pm.paid_at,
          COALESCE((
            SELECT json_agg(
              json_build_object(
                'id', oi.id,
                'variantId', oi.variant_id,
                'productName', oi.product_name,
                'color', oi.color,
                'size', oi.size,
                'unitPrice', oi.unit_price,
                'quantity', oi.quantity,
                'totalPrice', oi.total_price,
                'imageUrl', COALESCE((
                  SELECT pi.image_url
                  FROM product_variants pv
                  JOIN product_images pi ON pi.product_id = pv.product_id
                  WHERE pv.id = oi.variant_id
                  ORDER BY pi.is_primary DESC, pi.display_order ASC
                  LIMIT 1
                ), '')
              )
            )
            FROM order_items oi
            WHERE oi.order_id = o.id
          ), '[]'::json) AS items
        FROM orders o
        LEFT JOIN payments pm ON pm.order_id = o.id
        WHERE ${whereClause}
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT ${pageSize} OFFSET ${offset};
      `),
    ]);

    const total = Number(totalRows[0]?.count || 0);
    const totalPages = Math.ceil(total / pageSize);

    res.json({
      success: true,
      total,
      page,
      pageSize,
      totalPages,
      pagination: {
        total,
        page,
        pageSize,
        totalPages,
      },
      items: rows,
      data: rows,
    });
    } catch (err: any) {
    return sendOrderRouteError(res, err, 'Lỗi tải danh sách đơn hàng');
  }
});

/**
 * 3. CHI TIẾT ĐƠN HÀNG & TIMELINE TRẠNG THÁI (GET /api/orders/:id)
 * - Chạy Scoped Lazy Cleanup cho đơn hàng
 * - Kiểm tra quyền sở hữu: chỉ chủ đơn hàng hoặc Admin mới được xem (trả 404 nếu không tìm thấy hoặc xem đơn người khác)
 */
ordersRouter.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orderId = req.params.id;
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    await runScopedLazyCleanup({ orderId });

    const orderRows = await queryRows<any>(sql`
      SELECT
        o.*,
        pm.method AS payment_method,
        pm.status AS payment_status,
        pm.transaction_id,
        pm.paid_at
      FROM orders o
      LEFT JOIN payments pm ON pm.order_id = o.id
      WHERE o.id = ${orderId}
      LIMIT 1;
    `);

    if (orderRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đơn hàng',
      });
    }

    const order = orderRows[0];

    // Yêu cầu nghiệm thu Giai đoạn 5: người khác nhận 404 (không để lộ mã đơn tồn tại)
    if (!isAdmin && order.user_id !== userId) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đơn hàng',
      });
    }

    const [items, statusHistory, vietqrConfig] = await Promise.all([
      queryRows<any>(sql`
        SELECT
          oi.id,
          oi.variant_id AS "variantId",
          oi.product_name AS "productName",
          oi.color,
          oi.size,
          oi.unit_price AS "unitPrice",
          oi.quantity,
          oi.total_price AS "totalPrice",
          pv.sku,
          p.slug AS "productSlug",
          COALESCE((
            SELECT pi.image_url
            FROM product_images pi
            WHERE pi.product_id = p.id
            ORDER BY pi.is_primary DESC, pi.display_order ASC
            LIMIT 1
          ), '') AS "imageUrl"
        FROM order_items oi
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        LEFT JOIN products p ON p.id = pv.product_id
        WHERE oi.order_id = ${orderId};
      `),
      queryRows<any>(sql`
        SELECT id, status, note, changed_by AS "changedBy", created_at AS "createdAt"
        FROM order_status_history
        WHERE order_id = ${orderId}
        ORDER BY created_at ASC, id ASC;
      `),
      getVietQRConfig(),
    ]);

    const vietqr =
      order.payment_method === 'vietqr'
        ? generateVietQRPayload({
            orderId: order.id,
            amount: Number(order.total_amount),
            config: vietqrConfig,
            createdAt: order.created_at,
          })
        : null;

    const data = {
      ...order,
      id: order.id,
      orderId: order.id,
      userId: order.user_id,
      receiverName: order.receiver_name,
      receiverPhone: order.receiver_phone,
      shippingAddress: order.shipping_address,
      shippingMethod: order.shipping_method,
      shippingFee: Number(order.shipping_fee),
      subtotal: Number(order.subtotal),
      discountAmount: Number(order.discount_amount),
      totalAmount: Number(order.total_amount),
      status: order.status,
      cancelReason: order.cancel_reason,
      trackingCode: order.tracking_code,
      deliveredAt: order.delivered_at,
      completedAt: order.completed_at,
      paymentMethod: order.payment_method,
      paymentStatus: order.payment_status,
      transactionId: order.transaction_id,
      paidAt: order.paid_at,
      createdAt: order.created_at,
      items,
      statusHistory,
      vietqr,
    };

    res.json({
      success: true,
      order: data,
      data,
    });
  } catch (err: any) {
    return sendOrderRouteError(res, err, 'Lỗi tải chi tiết đơn hàng');
  }
});

/**
 * 3.1 MUA LẠI ĐƠN HÀNG (POST /api/orders/:id/reorder)
 * - Thêm các sản phẩm của đơn cũ vào giỏ theo giá và tồn kho hiện tại
 * - Báo rõ món nào hết hàng (out_of_stock) hoặc ngừng bán (inactive)
 */
ordersRouter.post('/:id/reorder', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orderId = req.params.id;
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    const orderRows = await queryRows<{ id: string; user_id: string }>(sql`
      SELECT id, user_id FROM orders WHERE id = ${orderId} LIMIT 1;
    `);

    if (orderRows.length === 0 || (!isAdmin && orderRows[0].user_id !== userId)) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đơn hàng',
      });
    }

    const items = await queryRows<{
      variant_id: string;
      product_name: string;
      quantity: number;
    }>(sql`
      SELECT variant_id, product_name, quantity
      FROM order_items
      WHERE order_id = ${orderId};
    `);

    let addedCount = 0;
    const outOfStockItems: string[] = [];
    const inactiveItems: string[] = [];
    const addedItems: { variantId: string; productName: string; quantity: number }[] = [];

    for (const item of items) {
      const vRows = await queryRows<{
        id: string;
        stock_quantity: number;
        is_active: boolean;
        product_name: string;
      }>(sql`
        SELECT pv.id, pv.stock_quantity, p.is_active, p.name AS product_name
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        WHERE pv.id = ${item.variant_id}::uuid
        LIMIT 1;
      `);

      if (vRows.length === 0 || !vRows[0].is_active) {
        inactiveItems.push(item.product_name);
        continue;
      }

      const variant = vRows[0];
      if (variant.stock_quantity <= 0) {
        outOfStockItems.push(item.product_name);
        continue;
      }

      // Số lượng thêm vào: tối đa 10, không vượt quá tồn kho hiện tại
      const qtyToAdd = Math.min(Math.max(1, item.quantity), variant.stock_quantity, 10);

      await queryRows(sql`
        INSERT INTO cart_items (user_id, variant_id, quantity)
        VALUES (${userId}::uuid, ${item.variant_id}::uuid, ${qtyToAdd})
        ON CONFLICT (user_id, variant_id)
        DO UPDATE SET quantity = LEAST(cart_items.quantity + EXCLUDED.quantity, 10, ${variant.stock_quantity});
      `);

      addedCount += qtyToAdd;
      addedItems.push({
        variantId: item.variant_id,
        productName: item.product_name,
        quantity: qtyToAdd,
      });
    }

    res.json({
      success: true,
      message: `Đã thêm ${addedItems.length} mặt hàng vào giỏ hàng`,
      addedCount,
      addedItems,
      outOfStockItems,
      inactiveItems,
    });
  } catch (err: any) {
    return sendOrderRouteError(res, err, 'Lỗi thực hiện mua lại đơn hàng');
  }
});

/**
 * 4. POLLING TRẠNG THÁI THANH TOÁN VIETQR (GET /api/orders/:id/payment-status)
 * - Tự động kiểm tra hết hạn 30 phút (Lazy Cleanup Scoped)
 * - Kiểm tra quyền sở hữu đơn hàng
 */
ordersRouter.get('/:id/payment-status', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orderId = req.params.id;
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    await runScopedLazyCleanup({ orderId });

    const rows = await queryRows<any>(sql`
      SELECT
        o.id,
        o.user_id,
        o.total_amount,
        o.status AS order_status,
        o.cancel_reason,
        o.created_at,
        pm.method AS payment_method,
        pm.status AS payment_status,
        pm.transaction_id,
        pm.paid_at
      FROM orders o
      LEFT JOIN payments pm ON pm.order_id = o.id
      WHERE o.id = ${orderId}
      LIMIT 1;
    `);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy đơn hàng',
      });
    }

    const row = rows[0];
    if (!isAdmin && row.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Bạn không có quyền truy cập trạng thái thanh toán của đơn hàng này',
      });
    }

    const vietqrConfig = await getVietQRConfig();
    const vietqr =
      row.payment_method === 'vietqr'
        ? generateVietQRPayload({
            orderId: row.id,
            amount: Number(row.total_amount),
            config: vietqrConfig,
            createdAt: row.created_at,
          })
        : null;

    const isExpired =
      row.order_status === 'cancelled' ||
      (row.payment_status === 'pending' &&
        vietqr !== null &&
        new Date(vietqr.expiresAt).getTime() <= Date.now());

    const payload = {
      orderId: row.id,
      orderStatus: row.order_status,
      paymentMethod: row.payment_method,
      paymentStatus: row.payment_status,
      transactionId: row.transaction_id,
      paidAt: row.paid_at,
      totalAmount: Number(row.total_amount),
      cancelReason: row.cancel_reason,
      isPaid: row.payment_status === 'paid',
      isExpired,
      vietqr,
    };

    res.json({
      success: true,
      ...payload,
      data: payload,
    });
  } catch (err: any) {
    return sendOrderRouteError(res, err, 'Lỗi kiểm tra trạng thái thanh toán');
  }
});

/**
 * 4.1 LỊCH SỬ SỰ KIỆN ĐỐI SOÁT THANH TOÁN (GET /api/orders/:id/payment-events)
 * - Chỉ Admin (req.user.role === 'admin') mới có quyền đọc bảng payment_events
 * - Khách hàng (kể cả chủ đơn hàng) gọi endpoint này sẽ nhận 403 Forbidden
 */
ordersRouter.get('/:id/payment-events', requireAuth, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const orderId = req.params.id;
    const events = await queryRows<any>(sql`
      SELECT
        id,
        order_id AS "orderId",
        event_type AS "eventType",
        expected_amount AS "expectedAmount",
        received_amount AS "receivedAmount",
        transaction_id AS "transactionId",
        created_at AS "createdAt"
      FROM payment_events
      WHERE order_id = ${orderId}
      ORDER BY created_at DESC, id DESC;
    `);

    return res.json({
      success: true,
      items: events,
      data: events,
    });
  } catch (err: any) {
    return sendOrderRouteError(res, err, 'Lỗi tải sự kiện đối soát thanh toán');
  }
});

/**
 * 5. HỦY ĐƠN HÀNG KHI CHƯA GIAO (POST /api/orders/:id/cancel & PUT /api/orders/:id/cancel)
 * - Hoàn lại tồn kho (product_variants + stock_movements)
 * - Hoàn lại lượt dùng voucher (vouchers.used_count + xóa voucher_usages)
 */
async function handleCancelOrder(req: AuthRequest, res: Response) {
  try {
    const orderId = req.params.id;
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    const reason = req.body?.reason;

    const result = await cancelOrderTransactional({
      orderId,
      requestingUserId: userId,
      isAdmin,
      reason,
    });

    res.json({
      success: true,
      message: 'Đã hủy đơn hàng, hoàn lại tồn kho và mã giảm giá thành công',
      ...result,
      data: result,
    });
  } catch (err: any) {
    return sendOrderRouteError(res, err, 'Lỗi khi hủy đơn hàng');
  }
}

ordersRouter.post('/:id/cancel', requireAuth, handleCancelOrder);
ordersRouter.put('/:id/cancel', requireAuth, handleCancelOrder);

/**
 * 6. WEBHOOK XÁC NHẬN THANH TOÁN TỰ ĐỘNG VIETQR (POST /api/payments/webhook)
 * - Bắt buộc xác thực chữ ký HMAC-SHA256 trên rawBody kèm x-webhook-timestamp (cửa sổ 5 phút) hoặc WEBHOOK_SECRET kèm timestamp
 * - Chỉ nhận cho đơn có payment_method === 'vietqr' (đơn COD bị từ chối với 400)
 * - Đảm bảo tính Idempotent: gọi lại nhiều lần (kể cả sau khi Admin đã xác nhận tay) không xử lý trùng lặp
 * - Khi paidAmount lệch total_amount: ghi nhận bản ghi đối soát vào payment_events rồi trả về 400
 */
export async function handlePaymentWebhook(req: Request, res: Response) {
  try {
    if (process.env.ENABLE_DEMO_PAYMENT_WEBHOOK !== 'true') {
      return res.status(403).json({
        success: false,
        message: 'Cổng Webhook thanh toán đang tạm đóng (yêu cầu ENABLE_DEMO_PAYMENT_WEBHOOK=true)',
      });
    }

    const rawBody = (req as any).rawBody;
    if (!verifyWebhookSignature(req.headers as any, rawBody)) {
      return res.status(401).json({
        success: false,
        message:
          'Từ chối truy cập: Chữ ký HMAC, khóa bí mật Webhook (WEBHOOK_SECRET) hoặc x-webhook-timestamp không hợp lệ / quá hạn 5 phút',
      });
    }

    const {
      orderId: rawOrderId,
      orderCode: rawOrderCode,
      transactionId: rawTxId,
      referenceCode,
      amount: rawAmount,
      transferAmount,
      content,
      transferContent,
      description,
    } = req.body || {};

    // Trích xuất mã đơn hàng BAITY-XXXX từ orderId, orderCode hoặc từ nội dung chuyển khoản
    let orderId = (rawOrderId || rawOrderCode) ? String(rawOrderId || rawOrderCode).trim().toUpperCase() : '';
    if (!orderId) {
      const textToScan = String(content || transferContent || description || '');
      const match = textToScan.match(/BAITY-\d+/i);
      if (match) {
        orderId = match[0].toUpperCase();
      }
    }

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Không tìm thấy mã đơn hàng (orderId) trong dữ liệu Webhook',
      });
    }

    const transactionId = String(rawTxId || referenceCode || `VQR-${orderId}`).trim();
    const paidAmount = Number(rawAmount ?? transferAmount);

    const webhookResult = await withTransaction(async (txQueryRows) => {
      const orderRows = await txQueryRows<{
        id: string;
        total_amount: number;
        status: string;
      }>(sql`
        SELECT id, total_amount, status
        FROM orders
        WHERE id = ${orderId}
        FOR UPDATE;
      `);

      if (orderRows.length === 0) {
        const err: any = new Error(`Không tìm thấy đơn hàng "${orderId}"`);
        err.statusCode = 404;
        throw err;
      }

      const order = orderRows[0];

      const paymentRows = await txQueryRows<{
        id: string;
        method: string;
        status: string;
        transaction_id: string | null;
      }>(sql`
        SELECT id, method, status, transaction_id
        FROM payments
        WHERE order_id = ${orderId}
        FOR UPDATE;
      `);

      const currentPayment = paymentRows[0];

      // Mục 9(b): Chỉ nhận webhook cho đơn có payment_method === 'vietqr'
      if (!currentPayment || currentPayment.method !== 'vietqr') {
        const err: any = new Error(
          `Đơn hàng "${orderId}" sử dụng phương thức "${currentPayment?.method || 'unknown'}", không chấp nhận xác nhận qua Webhook VietQR`
        );
        err.statusCode = 400;
        err.code = 'WEBHOOK_INVALID_PAYMENT_METHOD';
        throw err;
      }

      // Kiểm tra Idempotency: nếu đơn hàng đã được thanh toán trước đó (qua webhook hoặc Admin xác nhận tay)
      if (currentPayment && currentPayment.status === PAYMENT_STATUS.PAID) {
        return {
          idempotent: true,
          amountMismatch: false,
          orderId: order.id,
          orderStatus: order.status,
          paymentStatus: PAYMENT_STATUS.PAID,
          transactionId: currentPayment.transaction_id || transactionId,
        };
      }

      // Kiểm tra xem transactionId có bị trùng với một đơn hàng khác hay không
      const dupTxRows = await txQueryRows<{ order_id: string }>(sql`
        SELECT order_id
        FROM payments
        WHERE transaction_id = ${transactionId}
        LIMIT 1;
      `);

      if (dupTxRows.length > 0 && dupTxRows[0].order_id !== orderId) {
        const err: any = new Error(
          `Mã giao dịch "${transactionId}" đã được ghi nhận cho một đơn hàng khác`
        );
        err.statusCode = 409;
        throw err;
      }

      if (dupTxRows.length > 0 && dupTxRows[0].order_id === orderId) {
        return {
          idempotent: true,
          amountMismatch: false,
          orderId: order.id,
          orderStatus: order.status,
          paymentStatus: PAYMENT_STATUS.PAID,
          transactionId,
        };
      }

      // Mục 4 (Phần 1): Khi paidAmount !== total_amount, KHÔNG ghi vào order_status_history (khách có thể thấy).
      // Ghi vào bảng riêng payment_events (chỉ Admin đọc được) rồi trả về 400.
      if (!Number.isFinite(paidAmount) || paidAmount !== Number(order.total_amount)) {
        const receivedAmountSafe = Number.isFinite(paidAmount) ? Math.round(paidAmount) : 0;
        const expectedAmountSafe = Math.round(Number(order.total_amount));
        const formattedPaid = receivedAmountSafe.toLocaleString('vi-VN');
        const formattedExpected = expectedAmountSafe.toLocaleString('vi-VN');
        const mismatchMessage = `Số tiền thanh toán (${formattedPaid}₫) không khớp với tổng tiền đơn hàng (${formattedExpected}₫)`;

        await txQueryRows(sql`
          INSERT INTO payment_events (
            order_id,
            event_type,
            expected_amount,
            received_amount,
            transaction_id
          )
          VALUES (
            ${orderId},
            'amount_mismatch',
            ${expectedAmountSafe},
            ${receivedAmountSafe},
            ${transactionId}
          );
        `);

        return {
          idempotent: false,
          amountMismatch: true,
          mismatchMessage,
          orderId: order.id,
          orderStatus: order.status,
          paymentStatus: currentPayment.status,
          transactionId,
          paidAmount: receivedAmountSafe,
          expectedAmount: expectedAmountSafe,
        };
      }

      // Nếu tiền về sau khi đơn đã bị tự hủy hoặc hết hạn: ghi nhận thanh toán ở trạng thái cần hoàn tiền (refund_needed)
      if (order.status === 'cancelled') {
        await txQueryRows(sql`
          UPDATE payments
          SET transaction_id = ${transactionId},
              paid_at = NOW(),
              status = ${PAYMENT_STATUS.REFUND_NEEDED}
          WHERE id = ${currentPayment.id}::uuid;
        `);

        await txQueryRows(sql`
          INSERT INTO order_status_history (order_id, status, note, changed_by)
          VALUES (
            ${orderId},
            'cancelled',
            ${`Tiền về muộn sau khi đơn đã bị tự hủy hoặc hết hạn. Ghi nhận giao dịch ${transactionId} ở trạng thái cần hoàn tiền (refund_needed).`},
            'webhook'
          );
        `);

        return {
          idempotent: false,
          amountMismatch: false,
          refundNeeded: true,
          orderId: order.id,
          orderStatus: 'cancelled',
          paymentStatus: PAYMENT_STATUS.REFUND_NEEDED,
          transactionId,
        };
      }

      // Cập nhật bảng payments sang 'paid'
      await txQueryRows(sql`
        UPDATE payments
        SET transaction_id = ${transactionId},
            paid_at = NOW(),
            status = ${PAYMENT_STATUS.PAID}
        WHERE id = ${currentPayment.id}::uuid;
      `);

      // Chuyển trạng thái đơn hàng từ 'pending' sang 'confirmed' qua orderStateMachine.ts
      let nextOrderStatus = order.status;
      if (order.status === 'pending') {
        const transRes = await transitionOrderStatus({
          orderId,
          newStatus: 'confirmed',
          expectedStatus: 'pending',
          changedBy: 'webhook',
          isAdmin: true,
          note: `Đã nhận thanh toán VietQR tự động (Mã GD: ${transactionId})`,
          txQueryRows,
        });
        nextOrderStatus = transRes.currentStatus;
      }

      return {
        idempotent: false,
        amountMismatch: false,
        orderId: order.id,
        orderStatus: nextOrderStatus,
        paymentStatus: PAYMENT_STATUS.PAID,
        transactionId,
      };
    });

    if (webhookResult.amountMismatch) {
      return res.status(400).json({
        success: false,
        code: 'WEBHOOK_AMOUNT_MISMATCH',
        message: webhookResult.mismatchMessage,
        auditLogged: true,
        orderId: webhookResult.orderId,
        transactionId: webhookResult.transactionId,
      });
    }

    res.status(200).json({
      success: true,
      message: webhookResult.idempotent
        ? 'Giao dịch đã được ghi nhận trước đó (Idempotent)'
        : 'Xác nhận thanh toán VietQR thành công',
      ...webhookResult,
      data: webhookResult,
    });
  } catch (err: any) {
    return sendOrderRouteError(res, err, 'Lỗi xử lý Webhook thanh toán');
  }
}

paymentsRouter.post('/webhook', handlePaymentWebhook);

