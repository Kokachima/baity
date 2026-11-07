import { Router, type Response } from 'express';
import { sql } from 'drizzle-orm';
import { queryRows, withTransaction } from '../db/index.ts';
import { requireAuth, requireAdmin, type AuthRequest } from '../services/auth.ts';
import {
  VALID_ORDER_TRANSITIONS,
  transitionOrderStatus,
  insertAdminAuditLogInTx,
} from '../services/orderStateMachine.ts';
import { runScopedLazyCleanup } from '../services/lazyCleanup.ts';
import { calculateRefundAmount, getStoreShippingSettings } from '../services/pricing.ts';
import { normalizeVietnameseText } from '../db/seed.ts';
import { stripRawHtmlFromMarkdown } from '../../shared/safeMarkdown.ts';
import {
  PAYMENT_STATUS,
  STOCK_ADJUST_REASONS,
  adminCategoryInputSchema,
  adminProductInputSchema,
  adminStockAdjustSchema,
} from '../../shared/contracts.ts';
import {
  SUPABASE_PUBLIC_BUCKET,
  verifyObjectExistsInStorage,
} from '../services/upload.ts';
import {
  loadVisualAuditCacheFromDisk,
  computeProductImageAuditStatus,
  isPlaceholderSeedImageUrl,
  type ProductImageAuditStatus,
} from '../services/productImageAuditStatus.ts';
import { registerAdminStage8cRoutes } from './adminStage8c.ts';
import { registerAdminStage8dRoutes, getOperationsOverviewCounts } from './adminStage8d.ts';

export const adminRouter = Router();

// Bảo vệ toàn bộ router /api/admin/* ở tầng router
adminRouter.use(requireAuth, requireAdmin);

function sendAdminError(res: Response, err: any, fallbackMessage: string) {
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
      error: {
        code,
        message,
      },
    });
  }

  console.error('[ADMIN API ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
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

export function slugifyVietnamese(raw: string): string {
  const normalized = normalizeVietnameseText(raw || '');
  return normalized
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Xác minh toàn bộ ảnh sản phẩm gửi lên trong POST/PUT /api/admin/products:
 * - Bắt buộc là đường dẫn đã đăng ký trong bảng `uploads` với `purpose = 'product'`
 * - Từ chối tuyệt đối URL ngoài (http/https ngoài bucket công khai), data:, javascript:, hoặc đường dẫn tùy ý (400 INVALID_PRODUCT_IMAGE_SOURCE)
 * - Xác minh file thật sự tồn tại trong Storage (`verifyObjectExistsInStorage`)
 */
async function verifyProductImagesFromUploads(
  images: Array<{
    imageUrl: string;
    objectPath?: string;
    isPrimary: boolean;
    displayOrder: number;
  }>
): Promise<
  Array<{
    imageUrl: string;
    objectPath: string;
    isPrimary: boolean;
    displayOrder: number;
  }>
> {
  const verified: Array<{
    imageUrl: string;
    objectPath: string;
    isPrimary: boolean;
    displayOrder: number;
  }> = [];

  const supabasePublicPrefix = process.env.SUPABASE_URL
    ? `${process.env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${SUPABASE_PUBLIC_BUCKET}/`
    : null;

  for (const img of images) {
    const rawUrl = String(img.imageUrl || '').trim();
    const rawObjectPath = img.objectPath ? String(img.objectPath).trim() : '';

    const extractCanonicalPath = (input: string): string | null => {
      if (!input) return null;
      if (supabasePublicPrefix && input.startsWith(supabasePublicPrefix)) {
        return input.slice(supabasePublicPrefix.length).trim();
      }
      if (
        input.includes('://') ||
        input.startsWith('//') ||
        input.startsWith('data:') ||
        input.startsWith('javascript:') ||
        input.startsWith('/') ||
        input.includes('..') ||
        input.includes('\\') ||
        input.includes('\0')
      ) {
        return null;
      }
      return input;
    };

    const pathFromUrl = extractCanonicalPath(rawUrl);
    const pathFromObj = rawObjectPath ? extractCanonicalPath(rawObjectPath) : pathFromUrl;

    if (!pathFromUrl || !pathFromObj || pathFromUrl !== pathFromObj) {
      const err: any = new Error(
        `Đường dẫn ảnh sản phẩm "${rawUrl || rawObjectPath}" không hợp lệ. Chỉ chấp nhận đường dẫn từ bảng uploads (purpose = 'product'), từ chối URL ngoài hoặc đường dẫn tùy ý.`
      );
      err.statusCode = 400;
      err.code = 'INVALID_PRODUCT_IMAGE_SOURCE';
      throw err;
    }

    const cleanObjectPath = pathFromObj;
    if (!/^products\/[a-f0-9]{8,64}\/[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$/i.test(cleanObjectPath)) {
      const err: any = new Error(
        `Đường dẫn ảnh sản phẩm "${cleanObjectPath}" không đúng định dạng lưu trữ products/<folder>/<file> từ /api/upload.`
      );
      err.statusCode = 400;
      err.code = 'INVALID_PRODUCT_IMAGE_SOURCE';
      throw err;
    }

    const uploadRows = await queryRows<{
      id: string;
      bucket: string;
      object_path: string;
      purpose: string;
    }>(sql`
      SELECT id, bucket, object_path, purpose
      FROM uploads
      WHERE object_path = ${cleanObjectPath}
        AND purpose = 'product'
      LIMIT 1;
    `);

    if (uploadRows.length === 0) {
      const err: any = new Error(
        `Ảnh sản phẩm "${cleanObjectPath}" chưa được đăng ký trong bảng uploads với purpose = 'product'. Vui lòng tải ảnh qua POST /api/upload trước.`
      );
      err.statusCode = 400;
      err.code = 'INVALID_PRODUCT_IMAGE_SOURCE';
      throw err;
    }

    const bucket = uploadRows[0].bucket || SUPABASE_PUBLIC_BUCKET;
    const exists = await verifyObjectExistsInStorage(bucket, cleanObjectPath);
    if (!exists) {
      const err: any = new Error(
        `Tệp ảnh sản phẩm "${cleanObjectPath}" không tồn tại thực tế trong kho lưu trữ (Storage)`
      );
      err.statusCode = 400;
      err.code = 'IMAGE_OBJECT_NOT_FOUND';
      throw err;
    }

    verified.push({
      imageUrl: cleanObjectPath,
      objectPath: cleanObjectPath,
      isPrimary: Boolean(img.isPrimary),
      displayOrder: img.displayOrder,
    });
  }

  return verified;
}

adminRouter.get('/dashboard', (_req: AuthRequest, res: Response) => {
  res.json({ success: true, message: 'Admin dashboard access granted' });
});

/**
 * 1. GET /api/admin/me — Xác thực quyền Admin & Thống kê tổng quan cho trang /admin
 */
adminRouter.get('/me', async (req: AuthRequest, res: Response) => {
  try {
    const adminUser = req.user!;
    const shippingSettings = await getStoreShippingSettings();
    const lowStockThreshold = shippingSettings.lowStockThreshold ?? 5;
    const [
      userRows,
      orderStatsRows,
      returnStatsRows,
      paymentAlertRows,
      catalogStatsRows,
      opsCounts,
    ] = await Promise.all([
      queryRows<{ id: string; email: string; full_name: string | null; role: string }>(sql`
        SELECT id, email, full_name, role
        FROM users
        WHERE id = ${adminUser.id}::uuid
        LIMIT 1;
      `),
      queryRows<{
        total_orders: number;
        pending_orders: number;
        confirmed_orders: number;
        processing_orders: number;
        shipping_orders: number;
        delivered_orders: number;
        cancelled_orders: number;
      }>(sql`
        SELECT
          COUNT(*)::int AS total_orders,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_orders,
          COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed_orders,
          COUNT(*) FILTER (WHERE status = 'processing')::int AS processing_orders,
          COUNT(*) FILTER (WHERE status = 'shipping')::int AS shipping_orders,
          COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered_orders,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_orders
        FROM orders;
      `),
      queryRows<{ pending_returns: number; total_returns: number }>(sql`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('pending', 'approved', 'receiving'))::int AS pending_returns,
          COUNT(*)::int AS total_returns
        FROM return_requests;
      `),
      queryRows<{ refund_needed_count: number; mismatch_count: number }>(sql`
        SELECT
          (SELECT COUNT(*)::int FROM payments WHERE status = ${PAYMENT_STATUS.REFUND_NEEDED}) AS refund_needed_count,
          (SELECT COUNT(*)::int FROM payment_events WHERE event_type = 'amount_mismatch' AND resolved_at IS NULL) AS mismatch_count;
      `),
      queryRows<{ total_categories: number; total_products: number; low_stock_variants: number }>(sql`
        SELECT
          (SELECT COUNT(*)::int FROM categories) AS total_categories,
          (SELECT COUNT(*)::int FROM products) AS total_products,
          (SELECT COUNT(*)::int FROM product_variants WHERE stock_quantity <= ${lowStockThreshold}) AS low_stock_variants;
      `),
      getOperationsOverviewCounts(),
    ]);

    const dbUser = userRows[0];
    const orderStats = orderStatsRows[0] || {
      total_orders: 0,
      pending_orders: 0,
      confirmed_orders: 0,
      processing_orders: 0,
      shipping_orders: 0,
      delivered_orders: 0,
      cancelled_orders: 0,
    };
    const returnStats = returnStatsRows[0] || { pending_returns: 0, total_returns: 0 };
    const paymentAlerts = paymentAlertRows[0] || { refund_needed_count: 0, mismatch_count: 0 };
    const catalogStats = catalogStatsRows[0] || {
      total_categories: 0,
      total_products: 0,
      low_stock_variants: 0,
    };

    return res.json({
      success: true,
      admin: {
        id: dbUser?.id || adminUser.id,
        email: dbUser?.email || adminUser.email,
        fullName: dbUser?.full_name || 'Quản trị viên',
        role: 'admin',
      },
      overview: {
        totalOrders: Number(orderStats.total_orders || 0),
        pendingOrders: Number(orderStats.pending_orders || 0),
        pendingConfirmationOrders: opsCounts.pendingConfirmationOrders,
        awaitingVietQrOrders: opsCounts.awaitingVietQrOrders,
        confirmedOrders: Number(orderStats.confirmed_orders || 0),
        processingOrders: Number(orderStats.processing_orders || 0),
        shippingOrders: Number(orderStats.shipping_orders || 0),
        deliveredOrders: Number(orderStats.delivered_orders || 0),
        cancelledOrders: Number(orderStats.cancelled_orders || 0),
        pendingReturns: Number(returnStats.pending_returns || 0),
        pendingReturnRequests: opsCounts.pendingReturnRequests,
        totalReturns: Number(returnStats.total_returns || 0),
        refundNeededCount: Number(paymentAlerts.refund_needed_count || 0),
        paymentMismatchCount: Number(paymentAlerts.mismatch_count || 0),
        unresolvedPaymentIssues: opsCounts.unresolvedPaymentIssues,
        totalCategories: Number(catalogStats.total_categories || 0),
        totalProducts: Number(catalogStats.total_products || 0),
        lowStockVariants: Number(catalogStats.low_stock_variants || 0),
        lowStockThreshold,
        unrepliedReviews: opsCounts.unrepliedReviews,
      },
      validOrderTransitions: VALID_ORDER_TRANSITIONS,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi tải thông tin quản trị viên');
  }
});

/**
 * 2. GET /api/admin/audit-logs — Nhật ký thao tác của Admin (phân trang, không chứa PII)
 */
adminRouter.get('/audit-logs', async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const rawLimit = parseInt(String(req.query.limit || '20'), 10) || 20;
    const limit = Math.min(50, Math.max(1, rawLimit));
    const offset = (page - 1) * limit;

    const actionFilter = typeof req.query.action === 'string' ? req.query.action.trim() : '';
    const targetTypeFilter =
      typeof req.query.targetType === 'string' ? req.query.targetType.trim() : '';

    const conditions = [];
    if (actionFilter) {
      conditions.push(sql`l.action = ${actionFilter}`);
    }
    if (targetTypeFilter) {
      conditions.push(sql`l.target_type = ${targetTypeFilter}`);
    }
    const whereSql =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    const [countRows, rows] = await Promise.all([
      queryRows<{ total: number }>(sql`
        SELECT COUNT(*)::int AS total
        FROM admin_audit_logs l
        ${whereSql};
      `),
      queryRows<{
        id: string;
        admin_id: string;
        action: string;
        target_type: string;
        target_id: string;
        summary: string;
        created_at: string;
      }>(sql`
        SELECT
          l.id,
          l.admin_id,
          l.action,
          l.target_type,
          l.target_id,
          l.summary,
          l.created_at
        FROM admin_audit_logs l
        ${whereSql}
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT ${limit} OFFSET ${offset};
      `),
    ]);

    const total = Number(countRows[0]?.total || 0);
    const items = rows.map((r) => ({
      id: r.id,
      adminId: r.admin_id,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      summary: r.summary,
      createdAt: r.created_at,
    }));

    return res.json({
      success: true,
      items,
      data: items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi tải nhật ký quản trị');
  }
});

/**
 * 3. GET /api/admin/orders — Danh sách đơn hàng cho Admin
 * - Lọc theo trạng thái (status), khoảng ngày (fromDate, toDate)
 * - Tìm kiếm theo mã đơn, tên người nhận hoặc SĐT người nhận (khớp chính xác hoặc 4 số cuối)
 * - Không trả PII (receiverName, receiverPhone, shippingAddress, customerEmail) trong danh sách
 * - Phân trang tối đa 50 dòng/trang
 */
adminRouter.get('/orders', async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const rawLimit = parseInt(String(req.query.limit || '20'), 10) || 20;
    const limit = Math.min(50, Math.max(1, rawLimit));
    const offset = (page - 1) * limit;

    const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const paymentMethodFilter =
      typeof req.query.paymentMethod === 'string' ? req.query.paymentMethod.trim() : '';
    const searchRaw =
      typeof (req.query.search || req.query.q) === 'string'
        ? String(req.query.search || req.query.q).trim()
        : '';
    const fromDateRaw = typeof req.query.fromDate === 'string' ? req.query.fromDate.trim() : '';
    const toDateRaw = typeof req.query.toDate === 'string' ? req.query.toDate.trim() : '';

    const conditions = [];
    if (statusFilter && statusFilter !== 'all') {
      conditions.push(sql`o.status = ${statusFilter}`);
    }
    if (paymentMethodFilter && paymentMethodFilter !== 'all') {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM payments pm2 WHERE pm2.order_id = o.id AND pm2.method = ${paymentMethodFilter})`
      );
    }
    if (fromDateRaw && !Number.isNaN(Date.parse(fromDateRaw))) {
      conditions.push(sql`o.created_at >= ${new Date(fromDateRaw).toISOString()}::timestamptz`);
    }
    if (toDateRaw && !Number.isNaN(Date.parse(toDateRaw))) {
      const endDate = new Date(toDateRaw);
      if (/^\d{4}-\d{2}-\d{2}$/.test(toDateRaw)) {
        endDate.setUTCHours(23, 59, 59, 999);
      }
      conditions.push(sql`o.created_at <= ${endDate.toISOString()}::timestamptz`);
    }
    if (searchRaw) {
      const digitsOnly = searchRaw.replace(/[^0-9]/g, '');
      const likePattern = `%${searchRaw}%`;
      if (/^\d{4}$/.test(searchRaw)) {
        conditions.push(
          sql`(RIGHT(REGEXP_REPLACE(o.receiver_phone, '[^0-9]', '', 'g'), 4) = ${searchRaw} OR o.id ILIKE ${likePattern})`
        );
      } else if (/^\+?\d[\d\s.-]{6,}\d$/.test(searchRaw) && digitsOnly.length >= 8) {
        const last4 = digitsOnly.slice(-4);
        conditions.push(
          sql`(o.receiver_phone = ${searchRaw} OR REGEXP_REPLACE(o.receiver_phone, '[^0-9]', '', 'g') = ${digitsOnly} OR RIGHT(REGEXP_REPLACE(o.receiver_phone, '[^0-9]', '', 'g'), 4) = ${last4})`
        );
      } else {
        conditions.push(
          sql`(o.id ILIKE ${likePattern} OR o.receiver_name ILIKE ${likePattern} OR o.receiver_phone = ${searchRaw})`
        );
      }
    }

    const whereSql =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    const [countRows, rows] = await Promise.all([
      queryRows<{ total: number }>(sql`
        SELECT COUNT(*)::int AS total
        FROM orders o
        ${whereSql};
      `),
      queryRows<any>(sql`
        SELECT
          o.id,
          o.user_id,
          o.shipping_method,
          o.shipping_fee,
          o.subtotal,
          o.discount_amount,
          o.total_amount,
          o.status,
          o.cancel_reason,
          o.tracking_code,
          o.delivered_at,
          o.completed_at,
          o.created_at,
          pm.method AS payment_method,
          pm.status AS payment_status,
          pm.transaction_id,
          pm.paid_at,
          (SELECT COALESCE(SUM(oi.quantity), 0)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count
        FROM orders o
        LEFT JOIN payments pm ON pm.order_id = o.id
        ${whereSql}
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT ${limit} OFFSET ${offset};
      `),
    ]);

    const total = Number(countRows[0]?.total || 0);
    const items = rows.map((r) => ({
      id: r.id,
      orderId: r.id,
      userId: r.user_id,
      shippingMethod: r.shipping_method,
      shippingFee: Number(r.shipping_fee || 0),
      subtotal: Number(r.subtotal || 0),
      discountAmount: Number(r.discount_amount || 0),
      totalAmount: Number(r.total_amount || 0),
      status: r.status,
      cancelReason: r.cancel_reason,
      trackingCode: r.tracking_code,
      deliveredAt: r.delivered_at,
      completedAt: r.completed_at,
      createdAt: r.created_at,
      paymentMethod: r.payment_method,
      paymentStatus: r.payment_status,
      transactionId: r.transaction_id,
      paidAt: r.paid_at,
      itemCount: Number(r.item_count || 0),
      allowedNextStatuses: VALID_ORDER_TRANSITIONS[r.status] || [],
    }));

    return res.json({
      success: true,
      items,
      orders: items,
      data: items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi tải danh sách đơn hàng quản trị');
  }
});

/**
 * 4. GET /api/admin/orders/:id — Chi tiết đơn hàng đầy đủ cho Admin
 * - Trả về dòng sản phẩm, địa chỉ/tên/SĐT người nhận (chỉ ở chi tiết đơn), thanh toán,
 *   lịch sử trạng thái, yêu cầu đổi trả và sự kiện đối soát payment_events.
 */
adminRouter.get('/orders/:id', async (req: AuthRequest, res: Response) => {
  try {
    const orderId = String(req.params.id || '').trim();
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Thiếu mã đơn hàng' });
    }

    await runScopedLazyCleanup({ orderId });

    const orderRows = await queryRows<any>(sql`
      SELECT
        o.id,
        o.user_id,
        o.receiver_name,
        o.receiver_phone,
        o.shipping_address,
        o.shipping_method,
        o.shipping_fee,
        o.subtotal,
        o.discount_amount,
        o.total_amount,
        o.status,
        o.cancel_reason,
        o.tracking_code,
        o.delivered_at,
        o.completed_at,
        o.created_at,
        u.email AS customer_email
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
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

    const [items, payments, statusHistory, returnRequests, paymentEvents] = await Promise.all([
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
          pv.stock_quantity AS "currentStock"
        FROM order_items oi
        LEFT JOIN product_variants pv ON pv.id = oi.variant_id
        WHERE oi.order_id = ${orderId}
        ORDER BY oi.id ASC;
      `),
      queryRows<any>(sql`
        SELECT
          id,
          order_id AS "orderId",
          method,
          transaction_id AS "transactionId",
          status,
          paid_at AS "paidAt"
        FROM payments
        WHERE order_id = ${orderId}
        ORDER BY id ASC;
      `),
      queryRows<any>(sql`
        SELECT
          id,
          status,
          note,
          changed_by AS "changedBy",
          created_at AS "createdAt"
        FROM order_status_history
        WHERE order_id = ${orderId}
        ORDER BY created_at ASC, id ASC;
      `),
      queryRows<any>(sql`
        SELECT
          rr.id,
          rr.order_id AS "orderId",
          rr.order_item_id AS "orderItemId",
          rr.type,
          rr.reason,
          rr.quantity,
          rr.refund_amount AS "refundAmount",
          rr.description,
          rr.image_proof_urls AS "imageProofUrls",
          rr.status,
          rr.rejection_reason AS "rejectionReason",
          rr.created_at AS "createdAt",
          oi.product_name AS "productName",
          oi.color,
          oi.size
        FROM return_requests rr
        LEFT JOIN order_items oi ON oi.id = rr.order_item_id
        WHERE rr.order_id = ${orderId}
        ORDER BY rr.created_at DESC;
      `),
      queryRows<any>(sql`
        SELECT
          id,
          order_id AS "orderId",
          event_type AS "eventType",
          expected_amount AS "expectedAmount",
          received_amount AS "receivedAmount",
          transaction_id AS "transactionId",
          resolved_at AS "resolvedAt",
          resolved_by AS "resolvedBy",
          resolution_note AS "resolutionNote",
          created_at AS "createdAt"
        FROM payment_events
        WHERE order_id = ${orderId}
        ORDER BY created_at DESC, id DESC;
      `),
    ]);

    const primaryPayment = payments[0] || null;
    const detail = {
      id: order.id,
      orderId: order.id,
      userId: order.user_id,
      customerEmail: order.customer_email || null,
      receiverName: order.receiver_name,
      receiverPhone: order.receiver_phone,
      shippingAddress: order.shipping_address,
      shippingMethod: order.shipping_method,
      shippingFee: Number(order.shipping_fee || 0),
      subtotal: Number(order.subtotal || 0),
      discountAmount: Number(order.discount_amount || 0),
      totalAmount: Number(order.total_amount || 0),
      status: order.status,
      cancelReason: order.cancel_reason,
      trackingCode: order.tracking_code,
      deliveredAt: order.delivered_at,
      completedAt: order.completed_at,
      createdAt: order.created_at,
      paymentMethod: primaryPayment?.method || null,
      paymentStatus: primaryPayment?.status || null,
      transactionId: primaryPayment?.transactionId || null,
      paidAt: primaryPayment?.paidAt || null,
      allowedNextStatuses: VALID_ORDER_TRANSITIONS[order.status] || [],
      items: items.map((it) => ({
        ...it,
        unitPrice: Number(it.unitPrice || 0),
        totalPrice: Number(it.totalPrice || 0),
        quantity: Number(it.quantity || 0),
      })),
      payments,
      statusHistory,
      returnRequests: returnRequests.map((rr) => ({
        ...rr,
        refundAmount: Number(rr.refundAmount || 0),
      })),
      paymentEvents: paymentEvents.map((ev) => ({
        ...ev,
        expectedAmount: Number(ev.expectedAmount || 0),
        receivedAmount: Number(ev.receivedAmount || 0),
      })),
    };

    return res.json({
      success: true,
      order: detail,
      data: detail,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi tải chi tiết đơn hàng quản trị');
  }
});

/**
 * 5. PUT /api/admin/orders/:id/status — Chuyển trạng thái đơn hàng (Optimistic Concurrency Control)
 */
adminRouter.put('/orders/:id/status', async (req: AuthRequest, res: Response) => {
  try {
    const orderId = String(req.params.id || '').trim();
    const adminId = req.user!.id;
    const { status: newStatus, expectedStatus, trackingCode, reason, note } = req.body || {};

    if (!newStatus || typeof newStatus !== 'string') {
      return res.status(400).json({
        success: false,
        code: 'MISSING_STATUS',
        message: 'Vui lòng cung cấp trạng thái mới (status)',
      });
    }

    if (!expectedStatus || typeof expectedStatus !== 'string' || !expectedStatus.trim()) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_EXPECTED_STATUS',
        message:
          'Bắt buộc truyền trạng thái hiện tại kỳ vọng (expectedStatus) để chống ghi đè đồng thời',
      });
    }

    const cleanReason = typeof reason === 'string' ? reason.trim() : '';
    if (newStatus === 'cancelled' && cleanReason.length < 2) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_CANCEL_REASON',
        message: 'Vui lòng nhập lý do hủy đơn hàng (tối thiểu 2 ký tự)',
      });
    }

    const summaryDetails =
      newStatus === 'shipping' && trackingCode
        ? ` (mã vận đơn: ${String(trackingCode).trim()})`
        : newStatus === 'cancelled'
        ? ` (đã hoàn kho & voucher)`
        : '';

    const result = await transitionOrderStatus({
      orderId,
      newStatus: newStatus.trim(),
      expectedStatus: expectedStatus.trim(),
      trackingCode,
      changedBy: 'admin',
      isAdmin: true,
      requestingUserId: adminId,
      reason: cleanReason || undefined,
      note: typeof note === 'string' ? note.trim() : undefined,
      auditLog: {
        adminId,
        action: 'ORDER_STATUS_CHANGE',
        targetType: 'order',
        targetId: orderId,
        summary: `Chuyển trạng thái đơn ${orderId} từ ${expectedStatus.trim()} sang ${newStatus.trim()}${summaryDetails}`,
      },
    });

    return res.json({
      success: true,
      message: `Đã chuyển trạng thái đơn hàng ${orderId} sang "${newStatus}"`,
      ...result,
      data: result,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi cập nhật trạng thái đơn hàng');
  }
});

/**
 * 6. POST /api/admin/orders/:id/confirm-payment — Xác nhận thanh toán VietQR thủ công
 * - Đi qua transitionOrderStatus trong orderStateMachine.ts
 */
adminRouter.post('/orders/:id/confirm-payment', async (req: AuthRequest, res: Response) => {
  try {
    const orderId = String(req.params.id || '').trim();
    const adminId = req.user!.id;
    const rawReference =
      typeof req.body?.transactionId === 'string' ? req.body.transactionId.trim() : '';

    // Chạy dọn dẹp đơn quá hạn 30 phút trước khi kiểm tra
    await runScopedLazyCleanup({ orderId });

    const result = await withTransaction(async (txQueryRows) => {
      const orderRows = await txQueryRows<{
        id: string;
        status: string;
        total_amount: number;
        created_at: string;
      }>(sql`
        SELECT id, status, total_amount, created_at
        FROM orders
        WHERE id = ${orderId}
        FOR UPDATE;
      `);

      if (orderRows.length === 0) {
        const err: any = new Error('Không tìm thấy đơn hàng');
        err.statusCode = 404;
        throw err;
      }

      const order = orderRows[0];

      const paymentRows = await txQueryRows<{
        id: string;
        method: string;
        status: string;
        transaction_id: string | null;
        paid_at: string | null;
      }>(sql`
        SELECT id, method, status, transaction_id, paid_at
        FROM payments
        WHERE order_id = ${orderId}
        FOR UPDATE;
      `);

      const payment = paymentRows[0];
      if (!payment || payment.method !== 'vietqr') {
        const err: any = new Error(
          `Chỉ áp dụng xác nhận thanh toán VietQR thủ công cho đơn có phương thức "vietqr" (hiện tại: "${payment?.method || 'unknown'}").`
        );
        err.statusCode = 400;
        err.code = 'INVALID_PAYMENT_METHOD';
        throw err;
      }

      // Kiểm tra tính Idempotent: nếu đã thanh toán trước đó -> trả về kết quả thành công không ghi trùng
      if (payment.status === PAYMENT_STATUS.PAID) {
        return {
          idempotent: true,
          orderId: order.id,
          orderStatus: order.status,
          paymentStatus: PAYMENT_STATUS.PAID,
          transactionId: payment.transaction_id,
          confirmedAt: payment.paid_at,
          confirmedByAdminId: adminId,
        };
      }

      // Nếu đơn đã hủy hoặc quá hạn thanh toán 30 phút -> từ chối và hướng dẫn xử lý hoàn tiền
      const isExpiredTime =
        new Date(order.created_at).getTime() < Date.now() - 30 * 60 * 1000;

      if (
        order.status === 'cancelled' ||
        payment.status === PAYMENT_STATUS.REFUND_NEEDED ||
        isExpiredTime
      ) {
        const err: any = new Error(
          'Đơn hàng đã quá hạn thanh toán 30 phút hoặc đã bị hủy. Không thể xác nhận đơn hàng này; nếu khách đã chuyển khoản muộn, vui lòng chuyển sang mục Đổi trả & Hoàn tiền để đối soát và hoàn tiền cho khách.'
        );
        err.statusCode = 400;
        err.code = 'ORDER_EXPIRED_OR_CANCELLED';
        throw err;
      }

      if (order.status !== 'pending') {
        const err: any = new Error(
          `Chỉ có thể xác nhận thanh toán cho đơn đang chờ thanh toán (pending). Trạng thái hiện tại: "${order.status}".`
        );
        err.statusCode = 400;
        err.code = 'INVALID_ORDER_STATUS';
        throw err;
      }

      const finalTxId = rawReference || payment.transaction_id || `MANUAL-VQR-${orderId}`;

      const updatedPay = await txQueryRows<{ paid_at: string; transaction_id: string }>(sql`
        UPDATE payments
        SET transaction_id = ${finalTxId},
            paid_at = NOW(),
            status = ${PAYMENT_STATUS.PAID}
        WHERE id = ${payment.id}::uuid
        RETURNING paid_at, transaction_id;
      `);

      const confirmedAt = updatedPay[0]?.paid_at || new Date().toISOString();

      const transRes = await transitionOrderStatus({
        orderId,
        newStatus: 'confirmed',
        expectedStatus: 'pending',
        changedBy: 'admin',
        isAdmin: true,
        requestingUserId: adminId,
        note: `Admin (${adminId}) xác nhận thanh toán VietQR thủ công lúc ${confirmedAt} (Mã GD: ${finalTxId})`,
        auditLog: {
          adminId,
          action: 'CONFIRM_VIETQR_PAYMENT',
          targetType: 'order',
          targetId: orderId,
          summary: `Xác nhận thanh toán VietQR thủ công cho đơn ${orderId} (mã GD: ${finalTxId})`,
        },
        txQueryRows,
      });

      return {
        idempotent: false,
        orderId: order.id,
        orderStatus: transRes.currentStatus,
        paymentStatus: PAYMENT_STATUS.PAID,
        transactionId: finalTxId,
        confirmedAt,
        confirmedByAdminId: adminId,
        auditLogId: transRes.auditLogId,
      };
    });

    return res.json({
      success: true,
      message: result.idempotent
        ? 'Thanh toán VietQR của đơn hàng đã được xác nhận trước đó (Idempotent)'
        : 'Đã xác nhận thanh toán VietQR thủ công và chuyển đơn sang Đã xác nhận (confirmed)',
      ...result,
      data: result,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi xác nhận thanh toán VietQR thủ công');
  }
});

/**
 * 7. GET /api/admin/returns — Danh sách yêu cầu đổi trả/hoàn tiền kèm danh sách refund_needed và sự kiện lệch tiền
 */
adminRouter.get('/returns', async (req: AuthRequest, res: Response) => {
  try {
    const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const conditions = [];
    if (statusFilter && statusFilter !== 'all') {
      conditions.push(sql`rr.status = ${statusFilter}`);
    }
    const whereSql =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    const [returnRows, refundNeededRows, mismatchRows] = await Promise.all([
      queryRows<any>(sql`
        SELECT
          rr.id,
          rr.order_id AS "orderId",
          rr.user_id AS "userId",
          rr.order_item_id AS "orderItemId",
          rr.type,
          rr.reason,
          rr.quantity,
          rr.refund_amount AS "refundAmount",
          rr.description,
          rr.image_proof_urls AS "imageProofUrls",
          rr.status,
          rr.rejection_reason AS "rejectionReason",
          rr.refunded_at AS "refundedAt",
          rr.created_at AS "createdAt",
          rr.updated_at AS "updatedAt",
          oi.product_name AS "productName",
          oi.color,
          oi.size,
          oi.unit_price AS "unitPrice",
          o.total_amount AS "orderTotalAmount",
          o.shipping_fee AS "orderShippingFee",
          o.status AS "orderStatus",
          EXISTS (
            SELECT 1 FROM stock_movements sm
            WHERE sm.reason = 'return_restock' AND sm.reference_id = rr.id::text
          ) AS "stockRestored"
        FROM return_requests rr
        JOIN order_items oi ON oi.id = rr.order_item_id
        JOIN orders o ON o.id = rr.order_id
        ${whereSql}
        ORDER BY rr.created_at DESC, rr.id DESC;
      `),
      queryRows<any>(sql`
        SELECT
          pm.id AS "paymentId",
          pm.order_id AS "orderId",
          pm.method,
          pm.status AS "paymentStatus",
          pm.transaction_id AS "transactionId",
          pm.paid_at AS "paidAt",
          o.total_amount AS "totalAmount",
          o.status AS "orderStatus",
          o.cancel_reason AS "cancelReason",
          o.created_at AS "orderCreatedAt"
        FROM payments pm
        JOIN orders o ON o.id = pm.order_id
        WHERE pm.status = ${PAYMENT_STATUS.REFUND_NEEDED}
        ORDER BY pm.paid_at DESC NULLS LAST, o.created_at DESC;
      `),
      queryRows<any>(sql`
        SELECT
          pe.id,
          pe.order_id AS "orderId",
          pe.event_type AS "eventType",
          pe.expected_amount AS "expectedAmount",
          pe.received_amount AS "receivedAmount",
          pe.transaction_id AS "transactionId",
          pe.resolved_at AS "resolvedAt",
          pe.resolved_by AS "resolvedBy",
          pe.resolution_note AS "resolutionNote",
          pe.created_at AS "createdAt",
          o.status AS "orderStatus"
        FROM payment_events pe
        LEFT JOIN orders o ON o.id = pe.order_id
        WHERE pe.event_type = 'amount_mismatch'
        ORDER BY pe.created_at DESC, pe.id DESC;
      `),
    ]);

    const items = returnRows.map((r) => ({
      ...r,
      quantity: Number(r.quantity || 1),
      refundAmount: Number(r.refundAmount || 0),
      unitPrice: Number(r.unitPrice || 0),
      orderTotalAmount: Number(r.orderTotalAmount || 0),
      orderShippingFee: Number(r.orderShippingFee || 0),
      stockRestored: Boolean(r.stockRestored),
    }));

    const refundNeededPayments = refundNeededRows.map((p) => ({
      ...p,
      totalAmount: Number(p.totalAmount || 0),
    }));

    const paymentMismatchEvents = mismatchRows.map((m) => ({
      ...m,
      expectedAmount: Number(m.expectedAmount || 0),
      receivedAmount: Number(m.receivedAmount || 0),
    }));

    return res.json({
      success: true,
      items,
      data: items,
      total: items.length,
      refundNeededPayments,
      paymentMismatchEvents,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi tải danh sách yêu cầu đổi trả & hoàn tiền');
  }
});

/**
 * 7b. GET /api/admin/payment-issues — Danh sách các vấn đề đối soát thanh toán (refund_needed & amount_mismatch)
 */
adminRouter.get('/payment-issues', async (req: AuthRequest, res: Response) => {
  try {
    const includeResolved = req.query.includeResolved === 'true';

    const [refundNeededRows, mismatchRows] = await Promise.all([
      queryRows<any>(sql`
        SELECT
          pm.id AS "paymentId",
          pm.order_id AS "orderId",
          pm.method,
          pm.status AS "paymentStatus",
          pm.transaction_id AS "transactionId",
          pm.paid_at AS "paidAt",
          o.total_amount AS "totalAmount",
          o.status AS "orderStatus",
          o.cancel_reason AS "cancelReason",
          o.created_at AS "orderCreatedAt"
        FROM payments pm
        JOIN orders o ON o.id = pm.order_id
        WHERE pm.status IN (${PAYMENT_STATUS.REFUND_NEEDED}, ${includeResolved ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.REFUND_NEEDED})
        ORDER BY pm.paid_at DESC NULLS LAST, o.created_at DESC;
      `),
      queryRows<any>(sql`
        SELECT
          pe.id,
          pe.order_id AS "orderId",
          pe.event_type AS "eventType",
          pe.expected_amount AS "expectedAmount",
          pe.received_amount AS "receivedAmount",
          pe.transaction_id AS "transactionId",
          pe.resolved_at AS "resolvedAt",
          pe.resolved_by AS "resolvedBy",
          pe.resolution_note AS "resolutionNote",
          pe.created_at AS "createdAt",
          o.status AS "orderStatus"
        FROM payment_events pe
        LEFT JOIN orders o ON o.id = pe.order_id
        WHERE pe.event_type = 'amount_mismatch'
          ${includeResolved ? sql`` : sql`AND pe.resolved_at IS NULL`}
        ORDER BY pe.created_at DESC, pe.id DESC;
      `),
    ]);

    return res.json({
      success: true,
      refundNeededPayments: refundNeededRows.map((p) => ({
        ...p,
        totalAmount: Number(p.totalAmount || 0),
      })),
      paymentMismatchEvents: mismatchRows.map((m) => ({
        ...m,
        expectedAmount: Number(m.expectedAmount || 0),
        receivedAmount: Number(m.receivedAmount || 0),
      })),
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi tải danh sách đối soát thanh toán');
  }
});

/**
 * 7c. POST /api/admin/payment-issues/resolve (và POST /api/admin/payment-issues/:type/:id/resolve)
 * Đánh dấu đã xử lý một vấn đề thanh toán (mismatch hoặc refund_needed) và ghi admin_audit_logs trong cùng giao dịch.
 */
async function handleResolvePaymentIssue(req: AuthRequest, res: Response) {
  try {
    const adminId = req.user!.id;
    const rawType = String(
      req.params.type || req.body?.type || req.body?.issueType || ''
    )
      .trim()
      .toLowerCase();
    const targetId = String(
      req.params.id || req.body?.id || req.body?.paymentId || req.body?.eventId || req.body?.orderId || ''
    ).trim();
    const cleanNote = String(
      req.body?.note || req.body?.resolutionNote || 'Đã đối soát và xử lý thủ công'
    ).trim();

    if (!targetId) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_ISSUE_ID',
        message: 'Vui lòng cung cấp mã bản ghi cần đánh dấu đã xử lý',
      });
    }

    if (cleanNote.length < 2) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_RESOLUTION_NOTE',
        message: 'Vui lòng nhập ghi chú xử lý đối soát (tối thiểu 2 ký tự)',
      });
    }

    const isMismatch =
      rawType === 'mismatch' || rawType === 'amount_mismatch' || rawType === 'payment_event';

    const result = await withTransaction(async (txQueryRows) => {
      if (isMismatch) {
        const evRows = await txQueryRows<any>(sql`
          SELECT *
          FROM payment_events
          WHERE id = ${targetId}::uuid
          FOR UPDATE;
        `);

        if (evRows.length === 0) {
          const err: any = new Error('Không tìm thấy sự kiện lệch tiền (payment_event)');
          err.statusCode = 404;
          throw err;
        }

        const ev = evRows[0];
        if (ev.resolved_at) {
          return {
            idempotent: true,
            type: 'mismatch',
            id: ev.id,
            orderId: ev.order_id,
            resolvedAt: ev.resolved_at,
            resolutionNote: ev.resolution_note,
          };
        }

        const upd = await txQueryRows<any>(sql`
          UPDATE payment_events
          SET resolved_at = NOW(),
              resolved_by = ${adminId}::uuid,
              resolution_note = ${cleanNote}
          WHERE id = ${targetId}::uuid
          RETURNING *;
        `);

        const auditLog = await insertAdminAuditLogInTx(txQueryRows, {
          adminId,
          action: 'RESOLVE_PAYMENT_EVENT',
          targetType: 'payment_event',
          targetId: String(ev.id),
          summary: `Đã xử lý lệch tiền đơn ${ev.order_id} (GD: ${ev.transaction_id || 'N/A'}): ${cleanNote}`,
        });

        return {
          idempotent: false,
          type: 'mismatch',
          id: upd[0].id,
          orderId: upd[0].order_id,
          resolvedAt: upd[0].resolved_at,
          resolutionNote: upd[0].resolution_note,
          auditLogId: auditLog.id,
        };
      }

      // Mặc định: xử lý giao dịch ở trạng thái refund_needed (theo paymentId hoặc orderId)
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        targetId
      );
      const payRows = await txQueryRows<any>(
        isUuid
          ? sql`SELECT * FROM payments WHERE id = ${targetId}::uuid FOR UPDATE;`
          : sql`SELECT * FROM payments WHERE order_id = ${targetId} FOR UPDATE;`
      );

      if (payRows.length === 0) {
        const err: any = new Error('Không tìm thấy bản ghi thanh toán cần xử lý');
        err.statusCode = 404;
        throw err;
      }

      const pay = payRows[0];
      if (pay.status === PAYMENT_STATUS.REFUNDED) {
        return {
          idempotent: true,
          type: 'refund_needed',
          id: pay.id,
          orderId: pay.order_id,
          paymentStatus: PAYMENT_STATUS.REFUNDED,
        };
      }

      if (pay.status !== PAYMENT_STATUS.REFUND_NEEDED) {
        const err: any = new Error(
          `Chỉ có thể đánh dấu hoàn tất cho giao dịch đang ở trạng thái "refund_needed" (hiện tại: "${pay.status}")`
        );
        err.statusCode = 400;
        throw err;
      }

      await txQueryRows(sql`
        UPDATE payments
        SET paid_at = COALESCE(paid_at, NOW()),
            status = ${PAYMENT_STATUS.REFUNDED}
        WHERE id = ${pay.id}::uuid;
      `);

      await txQueryRows(sql`
        UPDATE return_requests
        SET description = COALESCE(description, ${cleanNote}),
            status = 'completed',
            refunded_at = COALESCE(refunded_at, NOW()),
            updated_at = NOW()
        WHERE order_id = ${pay.order_id}
          AND type = 'refund'
          AND status IN ('pending', 'approved', 'receiving');
      `);

      const auditLog = await insertAdminAuditLogInTx(txQueryRows, {
        adminId,
        action: 'RESOLVE_REFUND_NEEDED',
        targetType: 'payment',
        targetId: pay.id,
        summary: `Đã xử lý hoàn tiền cho giao dịch ${pay.transaction_id || pay.id} (đơn ${pay.order_id}): ${cleanNote}`,
      });

      return {
        idempotent: false,
        type: 'refund_needed',
        id: pay.id,
        orderId: pay.order_id,
        paymentStatus: PAYMENT_STATUS.REFUNDED,
        resolutionNote: cleanNote,
        auditLogId: auditLog.id,
      };
    });

    return res.json({
      success: true,
      message: 'Đã đánh dấu xử lý đối soát thanh toán thành công',
      ...result,
      data: result,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi đánh dấu xử lý đối soát thanh toán');
  }
}

adminRouter.post('/payment-issues/:type/:id/resolve', handleResolvePaymentIssue);

/**
 * 8. PUT /api/admin/returns/:id/decision — Duyệt hoặc Từ chối yêu cầu đổi trả
 */
async function handleReturnDecision(req: AuthRequest, res: Response) {
  try {
    const returnId = String(req.params.id || '').trim();
    const adminId = req.user!.id;
    const {
      decision: rawDecision,
      status: rawStatus,
      rejectionReason,
      refundShippingFee,
    } = req.body || {};

    const actionRaw = String(rawDecision || rawStatus || '').trim().toLowerCase();
    const isApprove = actionRaw === 'approve' || actionRaw === 'approved';
    const isReject = actionRaw === 'reject' || actionRaw === 'rejected';

    if (!isApprove && !isReject) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_DECISION',
        message: 'Quyết định không hợp lệ (chỉ chấp nhận approve/approved hoặc reject/rejected)',
      });
    }

    const cleanRejectionReason = typeof rejectionReason === 'string' ? rejectionReason.trim() : '';
    if (isReject && cleanRejectionReason.length < 2) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_REJECTION_REASON',
        message: 'Vui lòng cung cấp lý do từ chối yêu cầu đổi trả (tối thiểu 2 ký tự)',
      });
    }

    const confirmRefundShipping = Boolean(refundShippingFee);
    const targetStatus = isApprove ? 'approved' : 'rejected';

    const updated = await withTransaction(async (txQueryRows) => {
      const rows = await txQueryRows<any>(sql`
        SELECT
          rr.*,
          oi.unit_price,
          o.subtotal AS order_subtotal,
          o.discount_amount AS order_discount_amount,
          o.total_amount AS order_total_amount,
          o.shipping_fee AS order_shipping_fee
        FROM return_requests rr
        JOIN order_items oi ON oi.id = rr.order_item_id
        JOIN orders o ON o.id = rr.order_id
        WHERE rr.id = ${returnId}::uuid
        FOR UPDATE;
      `);

      if (rows.length === 0) {
        const err: any = new Error('Không tìm thấy yêu cầu đổi trả');
        err.statusCode = 404;
        throw err;
      }

      const rr = rows[0];
      if (rr.status !== 'pending' && rr.status !== targetStatus) {
        const err: any = new Error(
          `Không thể duyệt/từ chối yêu cầu đang ở trạng thái "${rr.status}". Chỉ xử lý yêu cầu đang ở trạng thái "pending".`
        );
        err.statusCode = 400;
        throw err;
      }

      let recalculatedRefund = 0;
      if (isApprove && rr.type === 'refund') {
        const otherRefunds = await txQueryRows<{ sum_refund: string | null }>(sql`
          SELECT COALESCE(SUM(refund_amount), 0) AS sum_refund
          FROM return_requests
          WHERE order_id = ${rr.order_id}
            AND id != ${returnId}::uuid
            AND type = 'refund'
            AND status IN ('pending', 'approved', 'receiving', 'completed');
        `);
        const totalPreviouslyRefunded = Number(otherRefunds[0]?.sum_refund || 0);

        const orderVoucherRows = await txQueryRows<{ discount_type: string }>(sql`
          SELECT v.discount_type
          FROM voucher_usages vu
          JOIN vouchers v ON v.id = vu.voucher_id
          WHERE vu.order_id = ${rr.order_id}
          LIMIT 1;
        `);
        const voucherDiscountType = orderVoucherRows[0]?.discount_type || null;

        const refundCalc = calculateRefundAmount({
          itemUnitPrice: Number(rr.unit_price),
          returnQty: Number(rr.quantity),
          orderSubtotal: Number(rr.order_subtotal),
          orderDiscountAmount: Number(rr.order_discount_amount || 0),
          orderTotalAmount: Number(rr.order_total_amount),
          voucherDiscountType,
          totalPreviouslyRefunded,
          includeShippingFee: confirmRefundShipping,
          shippingFee: Number(rr.order_shipping_fee || 0),
        });
        recalculatedRefund = refundCalc.refundAmount;
      }

      const updRows = await txQueryRows<any>(sql`
        UPDATE return_requests
        SET refund_amount = ${recalculatedRefund},
            rejection_reason = ${isReject ? cleanRejectionReason : null},
            status = ${targetStatus},
            updated_at = NOW()
        WHERE id = ${returnId}::uuid
        RETURNING *;
      `);

      const auditLog = await insertAdminAuditLogInTx(txQueryRows, {
        adminId,
        action: isApprove ? 'RETURN_APPROVE' : 'RETURN_REJECT',
        targetType: 'return_request',
        targetId: returnId,
        summary: isApprove
          ? `Duyệt yêu cầu đổi trả ${returnId} (đơn ${rr.order_id}), hoàn phí ship: ${confirmRefundShipping ? 'có' : 'không'}, tiền hoàn: ${recalculatedRefund}₫`
          : `Từ chối yêu cầu đổi trả ${returnId} (đơn ${rr.order_id})`,
      });

      return {
        ...updRows[0],
        refundShippingFee: confirmRefundShipping,
        auditLogId: auditLog.id,
      };
    });

    const formatted = {
      id: updated.id,
      orderId: updated.order_id,
      orderItemId: updated.order_item_id,
      type: updated.type,
      reason: updated.reason,
      quantity: Number(updated.quantity || 1),
      status: updated.status,
      refundAmount: Number(updated.refund_amount || 0),
      refundShippingFee: updated.refundShippingFee,
      rejectionReason: updated.rejection_reason,
      auditLogId: updated.auditLogId,
    };

    return res.json({
      success: true,
      message: isApprove
        ? 'Đã duyệt yêu cầu đổi trả và tính lại số tiền hoàn phía Server'
        : 'Đã từ chối yêu cầu đổi trả',
      ...formatted,
      data: formatted,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi xử lý quyết định yêu cầu đổi trả');
  }
}

adminRouter.put('/returns/:id/decision', handleReturnDecision);

/**
 * 9. POST /api/admin/returns/:id/receive — Đánh dấu đã nhận hàng trả về (kèm tùy chọn hoàn kho đúng 1 lần)
 */
adminRouter.post('/returns/:id/receive', async (req: AuthRequest, res: Response) => {
  try {
    const returnId = String(req.params.id || '').trim();
    const adminId = req.user!.id;
    const restoreStock = Boolean(req.body?.restoreStock);

    const result = await withTransaction(async (txQueryRows) => {
      const rows = await txQueryRows<any>(sql`
        SELECT
          rr.*,
          oi.variant_id
        FROM return_requests rr
        JOIN order_items oi ON oi.id = rr.order_item_id
        WHERE rr.id = ${returnId}::uuid
        FOR UPDATE;
      `);

      if (rows.length === 0) {
        const err: any = new Error('Không tìm thấy yêu cầu đổi trả');
        err.statusCode = 404;
        throw err;
      }

      const rr = rows[0];
      if (!['approved', 'receiving'].includes(rr.status)) {
        const err: any = new Error(
          `Chỉ có thể xác nhận nhận hàng trả về khi yêu cầu ở trạng thái "approved" hoặc "receiving" (hiện tại: "${rr.status}")`
        );
        err.statusCode = 400;
        throw err;
      }

      let stockRestoredNow = false;
      if (restoreStock && rr.variant_id) {
        const existingMovements = await txQueryRows<{ id: string }>(sql`
          SELECT id
          FROM stock_movements
          WHERE reason = 'return_restock'
            AND reference_id = ${returnId}
          LIMIT 1;
        `);

        if (existingMovements.length === 0) {
          const qtyToRestore = Math.max(1, Number(rr.quantity || 1));
          await txQueryRows(sql`
            UPDATE product_variants
            SET stock_quantity = stock_quantity + ${qtyToRestore}
            WHERE id = ${rr.variant_id}::uuid;
          `);

          await txQueryRows(sql`
            INSERT INTO stock_movements (variant_id, delta_quantity, reason, reference_id)
            VALUES (
              ${rr.variant_id}::uuid,
              ${qtyToRestore},
              'return_restock',
              ${returnId}
            );
          `);
          stockRestoredNow = true;
        }
      }

      const updRows = await txQueryRows<any>(sql`
        UPDATE return_requests
        SET quantity = quantity,
            status = 'receiving',
            updated_at = NOW()
        WHERE id = ${returnId}::uuid
        RETURNING *;
      `);

      const auditLog = await insertAdminAuditLogInTx(txQueryRows, {
        adminId,
        action: 'RETURN_RECEIVE_ITEM',
        targetType: 'return_request',
        targetId: returnId,
        summary: `Đã nhận hàng hoàn trả cho yêu cầu ${returnId} (đơn ${rr.order_id}, hoàn kho: ${stockRestoredNow ? 'có' : 'không'})`,
      });

      return {
        id: updRows[0].id,
        orderId: rr.order_id,
        status: updRows[0].status,
        stockRestoredNow,
        auditLogId: auditLog.id,
      };
    });

    return res.json({
      success: true,
      message: 'Đã xác nhận nhận hàng trả về thành công',
      ...result,
      data: result,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi xác nhận nhận hàng trả về');
  }
});

/**
 * 10. POST /api/admin/returns/:id/refund — Đánh dấu đã hoàn tiền (Idempotent, tổng hoàn tích lũy không vượt tổng tiền khách đã trả)
 */
adminRouter.post('/returns/:id/refund', async (req: AuthRequest, res: Response) => {
  try {
    const returnId = String(req.params.id || '').trim();
    const adminId = req.user!.id;

    const result = await withTransaction(async (txQueryRows) => {
      const rows = await txQueryRows<any>(sql`
        SELECT
          rr.*,
          oi.unit_price,
          o.subtotal AS order_subtotal,
          o.discount_amount AS order_discount_amount,
          o.total_amount AS order_total_amount,
          o.shipping_fee AS order_shipping_fee
        FROM return_requests rr
        JOIN order_items oi ON oi.id = rr.order_item_id
        JOIN orders o ON o.id = rr.order_id
        WHERE rr.id = ${returnId}::uuid
        FOR UPDATE;
      `);

      if (rows.length === 0) {
        const err: any = new Error('Không tìm thấy yêu cầu đổi trả');
        err.statusCode = 404;
        throw err;
      }

      const rr = rows[0];

      // Idempotent: nếu đã completed (đã hoàn tiền) trước đó -> trả về 200 OK ngay
      if (rr.status === 'completed') {
        const sumRows = await txQueryRows<{ total_refunded: string | null }>(sql`
          SELECT COALESCE(SUM(refund_amount), 0) AS total_refunded
          FROM return_requests
          WHERE order_id = ${rr.order_id}
            AND status = 'completed';
        `);
        return {
          idempotent: true,
          id: rr.id,
          orderId: rr.order_id,
          status: 'completed',
          refundAmount: Number(rr.refund_amount || 0),
          cumulativeOrderRefunded: Number(sumRows[0]?.total_refunded || 0),
          orderTotalAmount: Number(rr.order_total_amount || 0),
        };
      }

      if (!['approved', 'receiving'].includes(rr.status)) {
        const err: any = new Error(
          `Chỉ có thể xác nhận hoàn tiền cho yêu cầu đã được duyệt ("approved" hoặc "receiving"). Trạng thái hiện tại: "${rr.status}".`
        );
        err.statusCode = 400;
        throw err;
      }

      // Khóa đơn hàng để kiểm tra tổng tiền hoàn tích lũy nguyên tử
      await txQueryRows(sql`
        SELECT id FROM orders WHERE id = ${rr.order_id} FOR UPDATE;
      `);

      const completedRefundsRows = await txQueryRows<{ sum_completed: string | null }>(sql`
        SELECT COALESCE(SUM(refund_amount), 0) AS sum_completed
        FROM return_requests
        WHERE order_id = ${rr.order_id}
          AND id != ${returnId}::uuid
          AND status = 'completed';
      `);

      const alreadyCompletedAmount = Number(completedRefundsRows[0]?.sum_completed || 0);
      const orderTotalPaid = Number(rr.order_total_amount || 0);
      const remainingCap = Math.max(0, orderTotalPaid - alreadyCompletedAmount);

      let finalRefundAmount = Math.max(0, Number(rr.refund_amount || 0));
      if (finalRefundAmount > remainingCap) {
        finalRefundAmount = remainingCap;
      }

      const updRows = await txQueryRows<any>(sql`
        UPDATE return_requests
        SET refund_amount = ${finalRefundAmount},
            status = 'completed',
            refunded_at = COALESCE(refunded_at, NOW()),
            updated_at = NOW()
        WHERE id = ${returnId}::uuid
        RETURNING *;
      `);

      await txQueryRows(sql`
        UPDATE payments
        SET paid_at = COALESCE(paid_at, NOW()),
            status = ${PAYMENT_STATUS.REFUNDED}
        WHERE order_id = ${rr.order_id}
          AND status = ${PAYMENT_STATUS.REFUND_NEEDED};
      `);

      const auditLog = await insertAdminAuditLogInTx(txQueryRows, {
        adminId,
        action: 'RETURN_MARK_REFUNDED',
        targetType: 'return_request',
        targetId: returnId,
        summary: `Hoàn tất hoàn tiền yêu cầu ${returnId} (đơn ${rr.order_id}), số tiền hoàn: ${finalRefundAmount}₫`,
      });

      return {
        idempotent: false,
        id: updRows[0].id,
        orderId: rr.order_id,
        status: 'completed',
        refundAmount: finalRefundAmount,
        cumulativeOrderRefunded: alreadyCompletedAmount + finalRefundAmount,
        orderTotalAmount: orderTotalPaid,
        auditLogId: auditLog.id,
      };
    });

    return res.json({
      success: true,
      message: result.idempotent
        ? 'Yêu cầu đổi trả này đã được xác nhận hoàn tiền trước đó (Idempotent)'
        : 'Đã xác nhận hoàn tiền thành công',
      ...result,
      data: result,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi xác nhận hoàn tiền yêu cầu đổi trả');
  }
});

// ==========================================
// GIAI ĐOẠN 8B: QUẢN LÝ DANH MỤC, SẢN PHẨM, TỒN KHO
// ==========================================

/**
 * 11. GET /api/admin/categories — Danh sách toàn bộ danh mục (2 cấp: cha / con) kèm số sản phẩm
 */
adminRouter.get('/categories', async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await queryRows<any>(sql`
      SELECT
        c.id,
        c.name,
        c.slug,
        c.parent_id AS "parentId",
        p.name AS "parentName",
        c.display_order AS "displayOrder",
        c.is_active AS "isActive",
        (SELECT COUNT(*)::int FROM products pr WHERE pr.category_id = c.id) AS "productCount",
        (SELECT COUNT(*)::int FROM categories ch WHERE ch.parent_id = c.id) AS "childCount"
      FROM categories c
      LEFT JOIN categories p ON p.id = c.parent_id
      ORDER BY c.display_order ASC, c.name ASC;
    `);

    const items = rows.map((r) => ({
      ...r,
      displayOrder: Number(r.displayOrder || 0),
      isActive: Boolean(r.isActive),
      productCount: Number(r.productCount || 0),
      childCount: Number(r.childCount || 0),
    }));

    return res.json({
      success: true,
      items,
      data: items,
      total: items.length,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi tải danh sách danh mục');
  }
});

/**
 * 12. POST /api/admin/categories — Tạo danh mục mới (tối đa 2 cấp cha/con, slug duy nhất, ghi audit log)
 */
adminRouter.post('/categories', async (req: AuthRequest, res: Response) => {
  try {
    const adminId = req.user!.id;
    const parsed = adminCategoryInputSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message || 'Dữ liệu danh mục không hợp lệ',
      });
    }

    const { parentId, displayOrder, isActive } = parsed.data;
    const name = stripRawHtmlFromMarkdown(parsed.data.name).trim();
    if (!name) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Tên danh mục không hợp lệ sau khi loại bỏ thẻ HTML thô',
      });
    }
    const resolvedSlug = (parsed.data.slug || slugifyVietnamese(name)).toLowerCase();
    if (!resolvedSlug || !/^[a-z0-9-]+$/.test(resolvedSlug)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_SLUG',
        message: 'Slug danh mục không hợp lệ (chỉ gồm chữ thường a-z, số 0-9 và dấu gạch ngang)',
      });
    }

    const created = await withTransaction(async (txQueryRows) => {
      // Kiểm tra trùng slug
      const dupRows = await txQueryRows<{ id: string }>(sql`
        SELECT id FROM categories WHERE LOWER(slug) = LOWER(${resolvedSlug}) LIMIT 1;
      `);
      if (dupRows.length > 0) {
        const err: any = new Error(`Slug danh mục "${resolvedSlug}" đã tồn tại`);
        err.statusCode = 409;
        err.code = 'DUPLICATE_CATEGORY_SLUG';
        throw err;
      }

      // Kiểm tra danh mục cha (tối đa 2 cấp: cha không được có parent_id khác null)
      if (parentId) {
        const parentRows = await txQueryRows<{ id: string; parent_id: string | null }>(sql`
          SELECT id, parent_id FROM categories WHERE id = ${parentId}::uuid LIMIT 1;
        `);
        if (parentRows.length === 0) {
          const err: any = new Error('Không tìm thấy danh mục cha');
          err.statusCode = 400;
          err.code = 'PARENT_CATEGORY_NOT_FOUND';
          throw err;
        }
        if (parentRows[0].parent_id !== null) {
          const err: any = new Error(
            'Hệ thống chỉ hỗ trợ danh mục tối đa 2 cấp (Cha -> Con). Không thể tạo danh mục cấp 3.'
          );
          err.statusCode = 400;
          err.code = 'CATEGORY_MAX_DEPTH_EXCEEDED';
          throw err;
        }
      }

      const inserted = await txQueryRows<any>(sql`
        INSERT INTO categories (name, slug, parent_id, display_order, is_active)
        VALUES (
          ${name},
          ${resolvedSlug},
          ${parentId ? sql`${parentId}::uuid` : sql`NULL`},
          ${displayOrder},
          ${isActive}
        )
        RETURNING id, name, slug, parent_id AS "parentId", display_order AS "displayOrder", is_active AS "isActive";
      `);

      const auditLog = await insertAdminAuditLogInTx(txQueryRows, {
        adminId,
        action: 'CATEGORY_CREATE',
        targetType: 'category',
        targetId: inserted[0].id,
        summary: `Tạo danh mục "${name}" (slug: ${resolvedSlug}, hiển thị: ${isActive ? 'bật' : 'ẩn'})`,
      });

      return {
        ...inserted[0],
        auditLogId: auditLog.id,
      };
    });

    return res.status(201).json({
      success: true,
      message: 'Đã tạo danh mục thành công',
      category: created,
      data: created,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi tạo danh mục');
  }
});

/**
 * 13. PUT /api/admin/categories/:id — Cập nhật danh mục (tên, slug, thứ tự hiển thị, bật/tắt hiển thị)
 */
adminRouter.put('/categories/:id', async (req: AuthRequest, res: Response) => {
  try {
    const categoryId = String(req.params.id || '').trim();
    const adminId = req.user!.id;

    const parsed = adminCategoryInputSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message || 'Dữ liệu danh mục không hợp lệ',
      });
    }

    const { parentId, displayOrder, isActive } = parsed.data;
    const name = stripRawHtmlFromMarkdown(parsed.data.name).trim();
    if (!name) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Tên danh mục không hợp lệ sau khi loại bỏ thẻ HTML thô',
      });
    }
    const resolvedSlug = (parsed.data.slug || slugifyVietnamese(name)).toLowerCase();
    if (!resolvedSlug || !/^[a-z0-9-]+$/.test(resolvedSlug)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_SLUG',
        message: 'Slug danh mục không hợp lệ',
      });
    }

    const updated = await withTransaction(async (txQueryRows) => {
      const existingRows = await txQueryRows<any>(sql`
        SELECT * FROM categories WHERE id = ${categoryId}::uuid FOR UPDATE;
      `);
      if (existingRows.length === 0) {
        const err: any = new Error('Không tìm thấy danh mục');
        err.statusCode = 404;
        throw err;
      }

      if (parentId && parentId === categoryId) {
        const err: any = new Error('Danh mục không thể nhận chính nó làm danh mục cha');
        err.statusCode = 400;
        err.code = 'CATEGORY_SELF_PARENT';
        throw err;
      }

      const dupRows = await txQueryRows<{ id: string }>(sql`
        SELECT id
        FROM categories
        WHERE LOWER(slug) = LOWER(${resolvedSlug})
          AND id != ${categoryId}::uuid
        LIMIT 1;
      `);
      if (dupRows.length > 0) {
        const err: any = new Error(`Slug danh mục "${resolvedSlug}" đã tồn tại`);
        err.statusCode = 409;
        err.code = 'DUPLICATE_CATEGORY_SLUG';
        throw err;
      }

      if (parentId) {
        const parentRows = await txQueryRows<{ id: string; parent_id: string | null }>(sql`
          SELECT id, parent_id FROM categories WHERE id = ${parentId}::uuid LIMIT 1;
        `);
        if (parentRows.length === 0) {
          const err: any = new Error('Không tìm thấy danh mục cha');
          err.statusCode = 400;
          err.code = 'PARENT_CATEGORY_NOT_FOUND';
          throw err;
        }
        if (parentRows[0].parent_id !== null) {
          const err: any = new Error('Hệ thống chỉ hỗ trợ danh mục tối đa 2 cấp');
          err.statusCode = 400;
          err.code = 'CATEGORY_MAX_DEPTH_EXCEEDED';
          throw err;
        }
        const childCheck = await txQueryRows<{ cnt: number }>(sql`
          SELECT COUNT(*)::int AS cnt FROM categories WHERE parent_id = ${categoryId}::uuid;
        `);
        if (Number(childCheck[0]?.cnt || 0) > 0) {
          const err: any = new Error(
            'Danh mục đang có danh mục con nên không thể chuyển thành danh mục cấp 2'
          );
          err.statusCode = 400;
          err.code = 'CATEGORY_CYCLE_OR_DEPTH_EXCEEDED';
          throw err;
        }
      }

      const updRows = await txQueryRows<any>(sql`
        UPDATE categories
        SET name = ${name},
            slug = ${resolvedSlug},
            parent_id = ${parentId ? sql`${parentId}::uuid` : sql`NULL`},
            display_order = ${displayOrder},
            is_active = ${isActive}
        WHERE id = ${categoryId}::uuid
        RETURNING id, name, slug, parent_id AS "parentId", display_order AS "displayOrder", is_active AS "isActive";
      `);

      const auditLog = await insertAdminAuditLogInTx(txQueryRows, {
        adminId,
        action: 'CATEGORY_UPDATE',
        targetType: 'category',
        targetId: categoryId,
        summary: `Cập nhật danh mục "${name}" (slug: ${resolvedSlug}, thứ tự: ${displayOrder}, hiển thị: ${isActive ? 'bật' : 'ẩn'})`,
      });

      return {
        ...updRows[0],
        auditLogId: auditLog.id,
      };
    });

    return res.json({
      success: true,
      message: 'Đã cập nhật danh mục thành công',
      category: updated,
      data: updated,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi cập nhật danh mục');
  }
});

/**
 * 14. DELETE /api/admin/categories/:id — Xóa danh mục (từ chối nếu còn sản phẩm hoặc danh mục con)
 */
adminRouter.delete('/categories/:id', async (req: AuthRequest, res: Response) => {
  try {
    const categoryId = String(req.params.id || '').trim();
    const adminId = req.user!.id;

    const deleted = await withTransaction(async (txQueryRows) => {
      const existingRows = await txQueryRows<any>(sql`
        SELECT id, name, slug FROM categories WHERE id = ${categoryId}::uuid FOR UPDATE;
      `);
      if (existingRows.length === 0) {
        const err: any = new Error('Không tìm thấy danh mục');
        err.statusCode = 404;
        throw err;
      }

      const [prodCountRows, childCountRows] = await Promise.all([
        txQueryRows<{ cnt: number }>(sql`
          SELECT COUNT(*)::int AS cnt FROM products WHERE category_id = ${categoryId}::uuid;
        `),
        txQueryRows<{ cnt: number }>(sql`
          SELECT COUNT(*)::int AS cnt FROM categories WHERE parent_id = ${categoryId}::uuid;
        `),
      ]);

      const productCount = Number(prodCountRows[0]?.cnt || 0);
      const childCount = Number(childCountRows[0]?.cnt || 0);

      if (productCount > 0 || childCount > 0) {
        const err: any = new Error(
          `Không thể xóa danh mục "${existingRows[0].name}" vì đang có ${productCount} sản phẩm và ${childCount} danh mục con. Vui lòng chuyển sang ẩn danh mục (isActive = false) hoặc chuyển sản phẩm sang danh mục khác trước.`
        );
        err.statusCode = 400;
        err.code = childCount > 0 ? 'CATEGORY_HAS_CHILDREN' : 'CATEGORY_NOT_EMPTY';
        throw err;
      }

      await txQueryRows(sql`
        DELETE FROM categories WHERE id = ${categoryId}::uuid;
      `);

      const auditLog = await insertAdminAuditLogInTx(txQueryRows, {
        adminId,
        action: 'CATEGORY_DELETE',
        targetType: 'category',
        targetId: categoryId,
        summary: `Xóa danh mục trống "${existingRows[0].name}" (slug: ${existingRows[0].slug})`,
      });

      return {
        id: categoryId,
        auditLogId: auditLog.id,
      };
    });

    return res.json({
      success: true,
      message: 'Đã xóa danh mục thành công',
      ...deleted,
      data: deleted,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi xóa danh mục');
  }
});

/**
 * 15. GET /api/admin/products — Danh sách sản phẩm quản trị (bao gồm cả sản phẩm đang ẩn is_active = false)
 */
adminRouter.get('/products', async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const rawLimit = parseInt(String(req.query.limit || '20'), 10) || 20;
    const limit = Math.min(50, Math.max(1, rawLimit));
    const offset = (page - 1) * limit;

    const searchRaw =
      typeof (req.query.search || req.query.q) === 'string'
        ? String(req.query.search || req.query.q).trim()
        : '';
    const categoryId =
      typeof req.query.categoryId === 'string' ? req.query.categoryId.trim() : '';
    const targetGender =
      typeof req.query.targetGender === 'string' ? req.query.targetGender.trim() : '';
    const isActiveFilter =
      typeof req.query.isActive === 'string' ? req.query.isActive.trim().toLowerCase() : '';

    const conditions = [];
    if (categoryId && categoryId !== 'all') {
      conditions.push(sql`p.category_id = ${categoryId}::uuid`);
    }
    if (targetGender && ['men', 'women', 'unisex'].includes(targetGender)) {
      conditions.push(sql`p.target_gender = ${targetGender}`);
    }
    if (isActiveFilter === 'true') {
      conditions.push(sql`p.is_active = true`);
    } else if (isActiveFilter === 'false') {
      conditions.push(sql`p.is_active = false`);
    }
    if (searchRaw) {
      const likePattern = `%${searchRaw}%`;
      const normPattern = `%${normalizeVietnameseText(searchRaw)}%`;
      conditions.push(
        sql`(p.name ILIKE ${likePattern} OR p.slug ILIKE ${likePattern} OR p.search_text ILIKE ${normPattern} OR EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.sku ILIKE ${likePattern}))`
      );
    }

    const whereSql =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    const [countRows, rows] = await Promise.all([
      queryRows<{ total: number }>(sql`
        SELECT COUNT(*)::int AS total
        FROM products p
        ${whereSql};
      `),
      queryRows<any>(sql`
        SELECT
          p.id,
          p.name,
          p.slug,
          p.category_id AS "categoryId",
          c.name AS "categoryName",
          p.target_gender AS "targetGender",
          p.base_price AS "basePrice",
          p.is_active AS "isActive",
          p.created_at AS "createdAt",
          p.updated_at AS "updatedAt",
          (
            SELECT pi.image_url
            FROM product_images pi
            WHERE pi.product_id = p.id
            ORDER BY pi.is_primary DESC, pi.display_order ASC
            LIMIT 1
          ) AS "primaryImage",
          (
            SELECT COUNT(*)::int
            FROM product_variants pv
            WHERE pv.product_id = p.id
          ) AS "variantCount",
          (
            SELECT COALESCE(SUM(pv.stock_quantity), 0)::int
            FROM product_variants pv
            WHERE pv.product_id = p.id
          ) AS "totalStock"
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        ${whereSql}
        ORDER BY p.updated_at DESC, p.created_at DESC
        LIMIT ${limit} OFFSET ${offset};
      `),
    ]);

    const total = Number(countRows[0]?.total || 0);
    const items = rows.map((r) => ({
      ...r,
      basePrice: Number(r.basePrice || 0),
      isActive: Boolean(r.isActive),
      variantCount: Number(r.variantCount || 0),
      totalStock: Number(r.totalStock || 0),
    }));

    return res.json({
      success: true,
      items,
      data: items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi tải danh sách sản phẩm quản trị');
  }
});

/**
 * 15b. GET /api/admin/products/quick-images — Danh sách sản phẩm kèm trạng thái ảnh (OK/MÀU_LỆCH/LOẠI_LỆCH/HỎNG/DÙNG_CHUNG)
 * - Đọc từ CSDL + file cache `.data/visual-audit-cache.json`, TUYỆT ĐỐI KHÔNG gọi Gemini.
 */
adminRouter.get('/products/quick-images', async (req: AuthRequest, res: Response) => {
  try {
    const searchRaw =
      typeof (req.query.search || req.query.q) === 'string'
        ? String(req.query.search || req.query.q).trim()
        : '';
    const categorySlugFilter =
      typeof req.query.categorySlug === 'string' ? req.query.categorySlug.trim() : '';
    const categoryIdFilter =
      typeof req.query.categoryId === 'string' ? req.query.categoryId.trim() : '';
    const statusFilter =
      typeof req.query.status === 'string' ? req.query.status.trim().toUpperCase() : '';
    const includeInactive = req.query.includeInactive === 'true';

    const auditCache = loadVisualAuditCacheFromDisk();

    const [categories, productRows] = await Promise.all([
      queryRows<{ id: string; name: string; slug: string; displayOrder: number }>(sql`
        SELECT id, name, slug, display_order AS "displayOrder"
        FROM categories
        ORDER BY display_order ASC, name ASC;
      `),
      queryRows<any>(sql`
        SELECT
          p.id,
          p.name,
          p.slug,
          p.category_id AS "categoryId",
          c.name AS "categoryName",
          c.slug AS "categorySlug",
          p.target_gender AS "targetGender",
          p.is_active AS "isActive",
          p.updated_at AS "updatedAt",
          (
            SELECT pv.color_name
            FROM product_variants pv
            WHERE pv.product_id = p.id
            ORDER BY pv.created_at ASC, pv.id ASC
            LIMIT 1
          ) AS "primaryVariantColor",
          (
            SELECT pi.image_url
            FROM product_images pi
            WHERE pi.product_id = p.id
            ORDER BY pi.is_primary DESC, pi.display_order ASC
            LIMIT 1
          ) AS "primaryImageUrl",
          (
            SELECT COUNT(*)::int
            FROM product_images pi
            WHERE pi.product_id = p.id
          ) AS "imageCount",
          EXISTS (
            SELECT 1
            FROM uploads u
            WHERE u.purpose = 'product'
              AND u.object_path = (
                SELECT pi2.image_url
                FROM product_images pi2
                WHERE pi2.product_id = p.id
                ORDER BY pi2.is_primary DESC, pi2.display_order ASC
                LIMIT 1
              )
          ) AS "isRegisteredProductUpload"
        FROM products p
        JOIN categories c ON c.id = p.category_id
        ${includeInactive ? sql`` : sql`WHERE p.is_active = true`}
        ORDER BY p.created_at ASC, p.id ASC;
      `),
    ]);

    const primaryUrlCounts = new Map<string, number>();
    for (const r of productRows) {
      const u = String(r.primaryImageUrl || '').trim();
      if (u && !isPlaceholderSeedImageUrl(u)) {
        primaryUrlCounts.set(u, (primaryUrlCounts.get(u) || 0) + 1);
      }
    }

    const statusCounts: Record<string, number> = {
      ALL: productRows.length,
      OK: 0,
      CHƯA_CÓ_ẢNH_THẬT: 0,
      MÀU_LỆCH: 0,
      LOẠI_LỆCH: 0,
      HỎNG: 0,
      DÙNG_CHUNG: 0,
    };

    const enriched = productRows.map((r) => {
      const url = String(r.primaryImageUrl || '').trim();
      const sharedCount = url
        ? isPlaceholderSeedImageUrl(url)
          ? 1
          : primaryUrlCounts.get(url) || 1
        : 0;
      const audit = computeProductImageAuditStatus({
        imageUrl: url || null,
        categorySlug: r.categorySlug,
        primaryVariantColor: r.primaryVariantColor || '',
        sharedPrimaryUrlCount: sharedCount,
        auditCache,
        isRegisteredProductUpload: Boolean(r.isRegisteredProductUpload),
      });

      statusCounts[audit.status] = (statusCounts[audit.status] || 0) + 1;

      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        categorySlug: r.categorySlug,
        targetGender: r.targetGender,
        isActive: Boolean(r.isActive),
        updatedAt: r.updatedAt,
        primaryVariantColor: r.primaryVariantColor || 'N/A',
        primaryImageUrl: url || null,
        imageCount: Number(r.imageCount || 0),
        sharedPrimaryUrlCount: sharedCount,
        status: audit.status as ProductImageAuditStatus,
        recognizedCategory: audit.recognizedCategory,
        recognizedColors: audit.recognizedColors,
        variantColorFamilies: audit.variantColorFamilies,
        recognizedColorFamilies: audit.recognizedColorFamilies,
      };
    });

    const normSearch = searchRaw ? normalizeVietnameseText(searchRaw) : '';
    const filtered = enriched.filter((item) => {
      if (categorySlugFilter && categorySlugFilter !== 'all' && item.categorySlug !== categorySlugFilter) {
        return false;
      }
      if (categoryIdFilter && categoryIdFilter !== 'all' && item.categoryId !== categoryIdFilter) {
        return false;
      }
      if (
        statusFilter &&
        statusFilter !== 'ALL' &&
        item.status !== statusFilter
      ) {
        return false;
      }
      if (normSearch) {
        const hay = normalizeVietnameseText(
          `${item.name} ${item.slug} ${item.categoryName} ${item.primaryVariantColor}`
        );
        if (!hay.includes(normSearch)) {
          return false;
        }
      }
      return true;
    });

    const remainingPlaceholderCount = statusCounts.CHƯA_CÓ_ẢNH_THẬT || 0;

    return res.json({
      success: true,
      items: filtered,
      products: filtered,
      data: filtered,
      total: filtered.length,
      remainingPlaceholderCount,
      statusCounts,
      counts: {
        ...statusCounts,
        remainingPlaceholderCount,
        total: filtered.length,
      },
      categories,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi tải danh sách ảnh sản phẩm nhanh');
  }
});

/**
 * 15c. PUT /api/admin/products/:id/primary-image — Thay ảnh chính sản phẩm trong 1 giao dịch nguyên tử
 * - Chỉ nhận ảnh đã đăng ký trong bảng `uploads` với `purpose = 'product'` và tồn tại thực tế trong Storage (`verifyObjectExistsInStorage`)
 * - Từ chối URL ngoài, data:, hoặc đường dẫn tùy ý (400 INVALID_PRODUCT_IMAGE_SOURCE)
 * - Trong 1 giao dịch `withTransaction`:
 *   + Khóa dòng sản phẩm `FOR UPDATE`, kiểm tra `expectedUpdatedAt` (lệch trả 409 PRODUCT_CONFLICT)
 *   + Hạ ảnh chính cũ xuống `is_primary = false` trong `product_images` (giữ nguyên ảnh cũ và ảnh phụ)
 *   + Chèn ảnh mới `is_primary = true, display_order = 0`
 *   + Cập nhật `products.updated_at`
 *   + Ghi `admin_audit_logs` (`action = 'update_product_primary_image'`, có đường dẫn ảnh cũ và mới, không ghi dữ liệu cá nhân)
 */
adminRouter.put('/products/:id/primary-image', async (req: AuthRequest, res: Response) => {
  try {
    const productId = String(req.params.id || '').trim();
    const adminId = req.user!.id;

    const rawExpectedUpdatedAt =
      typeof req.body?.expectedUpdatedAt === 'string'
        ? req.body.expectedUpdatedAt.trim()
        : typeof req.body?.updatedAt === 'string'
        ? req.body.updatedAt.trim()
        : '';

    if (!rawExpectedUpdatedAt) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_EXPECTED_UPDATED_AT',
        message: 'Bắt buộc cung cấp expectedUpdatedAt để kiểm tra chống ghi đè đồng thời.',
      });
    }

    const rawObjectPath =
      typeof req.body?.objectPath === 'string'
        ? req.body.objectPath.trim()
        : typeof req.body?.upload_path === 'string'
        ? req.body.upload_path.trim()
        : typeof req.body?.path === 'string'
        ? req.body.path.trim()
        : undefined;
    const rawImageUrl =
      typeof req.body?.imageUrl === 'string'
        ? req.body.imageUrl.trim()
        : typeof req.body?.image_url === 'string'
        ? req.body.image_url.trim()
        : rawObjectPath || '';

    if (!rawImageUrl) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_IMAGE_URL',
        message: 'Vui lòng cung cấp đường dẫn ảnh sản phẩm đã tải lên (imageUrl / objectPath).',
      });
    }

    const verifiedList = await verifyProductImagesFromUploads([
      {
        imageUrl: rawObjectPath || rawImageUrl,
        objectPath: rawObjectPath,
        isPrimary: true,
        displayOrder: 0,
      },
    ]);
    const verifiedImage = verifiedList[0];

    const result = await withTransaction(async (txQueryRows) => {
      const existingRows = await txQueryRows<{
        id: string;
        name: string;
        slug: string;
        updated_at: string;
      }>(sql`
        SELECT id, name, slug, updated_at
        FROM products
        WHERE id = ${productId}::uuid
        FOR UPDATE;
      `);

      if (existingRows.length === 0) {
        const err: any = new Error('Không tìm thấy sản phẩm');
        err.statusCode = 404;
        err.code = 'PRODUCT_NOT_FOUND';
        throw err;
      }

      const existing = existingRows[0];
      const dbTimeMs = new Date(existing.updated_at).getTime();
      const clientTimeMs = new Date(rawExpectedUpdatedAt).getTime();

      if (Number.isNaN(clientTimeMs) || dbTimeMs !== clientTimeMs) {
        const err: any = new Error(
          'Sản phẩm đã được chỉnh sửa bởi quản trị viên khác (lệch expectedUpdatedAt). Vui lòng tải lại dữ liệu mới nhất.'
        );
        err.statusCode = 409;
        err.code = 'PRODUCT_CONFLICT';
        throw err;
      }

      const currentImages = await txQueryRows<{
        id: string;
        image_url: string;
        is_primary: boolean;
        display_order: number;
      }>(sql`
        SELECT id, image_url, is_primary, display_order
        FROM product_images
        WHERE product_id = ${productId}::uuid
        ORDER BY is_primary DESC, display_order ASC
        FOR UPDATE;
      `);

      const oldPrimaryImageUrl =
        currentImages.find((img) => img.is_primary)?.image_url ||
        currentImages[0]?.image_url ||
        null;

      // Hạ toàn bộ ảnh hiện tại xuống is_primary = false và đẩy display_order + 1 (giữ nguyên ảnh cũ và ảnh phụ)
      await txQueryRows(sql`
        UPDATE product_images
        SET is_primary = false,
            display_order = display_order + 1
        WHERE product_id = ${productId}::uuid;
      `);

      // Chèn ảnh mới làm ảnh chính (is_primary = true, display_order = 0)
      await txQueryRows(sql`
        INSERT INTO product_images (product_id, image_url, is_primary, display_order)
        VALUES (${productId}::uuid, ${verifiedImage.imageUrl}, true, 0);
      `);

      // Cập nhật products.updated_at (tăng tối thiểu 1ms để chống trùng dấu thời gian khi thao tác liên tiếp)
      const updatedProdRows = await txQueryRows<{
        id: string;
        name: string;
        slug: string;
        updatedAt: string;
      }>(sql`
        UPDATE products
        SET updated_at = GREATEST(NOW(), updated_at + INTERVAL '1 millisecond')
        WHERE id = ${productId}::uuid
        RETURNING id, name, slug, updated_at AS "updatedAt";
      `);

      const allImagesAfter = await txQueryRows<{
        id: string;
        imageUrl: string;
        isPrimary: boolean;
        displayOrder: number;
      }>(sql`
        SELECT
          id,
          image_url AS "imageUrl",
          is_primary AS "isPrimary",
          display_order AS "displayOrder"
        FROM product_images
        WHERE product_id = ${productId}::uuid
        ORDER BY is_primary DESC, display_order ASC;
      `);

      // Ghi admin_audit_logs trong cùng giao dịch, chỉ lưu đường dẫn ảnh cũ và mới, không lưu PII
      const auditLog = await insertAdminAuditLogInTx(txQueryRows, {
        adminId,
        action: 'update_product_primary_image',
        targetType: 'product',
        targetId: productId,
        summary: `Thay ảnh chính sản phẩm (${existing.slug}): old=${oldPrimaryImageUrl || 'none'} -> new=${verifiedImage.imageUrl}`,
      });

      return {
        id: productId,
        slug: existing.slug,
        primaryImageUrl: verifiedImage.imageUrl,
        primary_image_url: verifiedImage.imageUrl,
        oldPrimaryImageUrl,
        old_primary_image_url: oldPrimaryImageUrl,
        updatedAt: updatedProdRows[0].updatedAt,
        images: allImagesAfter.map((img) => ({
          ...img,
          isPrimary: Boolean(img.isPrimary),
          displayOrder: Number(img.displayOrder || 0),
        })),
        auditLogId: auditLog.id,
      };
    });

    return res.json({
      success: true,
      message: 'Đã cập nhật ảnh chính sản phẩm thành công',
      primaryImageUrl: result.primaryImageUrl,
      primary_image_url: result.primaryImageUrl,
      oldPrimaryImageUrl: result.oldPrimaryImageUrl,
      product: result,
      data: result,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi cập nhật ảnh chính sản phẩm');
  }
});

/**
 * 16. GET /api/admin/products/:id — Chi tiết sản phẩm đầy đủ để chỉnh sửa
 */
adminRouter.get('/products/:id', async (req: AuthRequest, res: Response) => {
  try {
    const productId = String(req.params.id || '').trim();
    const productRows = await queryRows<any>(sql`
      SELECT
        p.id,
        p.name,
        p.slug,
        p.category_id AS "categoryId",
        c.name AS "categoryName",
        p.target_gender AS "targetGender",
        p.base_price AS "basePrice",
        p.description,
        p.material,
        p.care_instructions AS "careInstructions",
        p.is_active AS "isActive",
        p.created_at AS "createdAt",
        p.updated_at AS "updatedAt"
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ${productId}::uuid
      LIMIT 1;
    `);

    if (productRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy sản phẩm',
      });
    }

    const product = productRows[0];
    const [images, variants, attributes] = await Promise.all([
      queryRows<any>(sql`
        SELECT
          id,
          image_url AS "imageUrl",
          is_primary AS "isPrimary",
          display_order AS "displayOrder"
        FROM product_images
        WHERE product_id = ${productId}::uuid
        ORDER BY is_primary DESC, display_order ASC;
      `),
      queryRows<any>(sql`
        SELECT
          id,
          color_name AS "colorName",
          color_code AS "colorCode",
          size,
          sku,
          price_override AS "priceOverride",
          stock_quantity AS "stockQuantity"
        FROM product_variants
        WHERE product_id = ${productId}::uuid
        ORDER BY color_name ASC, size ASC;
      `),
      queryRows<any>(sql`
        SELECT
          id,
          attr_key AS "key",
          attr_value AS "value"
        FROM product_attributes
        WHERE product_id = ${productId}::uuid
        ORDER BY id ASC;
      `),
    ]);

    const detail = {
      ...product,
      basePrice: Number(product.basePrice || 0),
      isActive: Boolean(product.isActive),
      images: images.map((img) => ({
        ...img,
        isPrimary: Boolean(img.isPrimary),
        displayOrder: Number(img.displayOrder || 0),
      })),
      variants: variants.map((v) => ({
        ...v,
        priceOverride: v.priceOverride === null || v.priceOverride === undefined ? null : Number(v.priceOverride),
        stockQuantity: Number(v.stockQuantity || 0),
      })),
      attributes,
    };

    return res.json({
      success: true,
      product: detail,
      data: detail,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi tải chi tiết sản phẩm quản trị');
  }
});

/**
 * 17. POST /api/admin/products — Tạo sản phẩm mới kèm biến thể, ảnh, thuộc tính, cập nhật search_text và ghi audit log trong cùng giao dịch
 */
adminRouter.post('/products', async (req: AuthRequest, res: Response) => {
  try {
    const adminId = req.user!.id;
    const parsed = adminProductInputSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message || 'Dữ liệu sản phẩm không hợp lệ',
      });
    }

    const rawData = parsed.data;
    const cleanName = stripRawHtmlFromMarkdown(rawData.name).trim();
    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Tên sản phẩm không hợp lệ sau khi loại bỏ thẻ HTML thô',
      });
    }

    const data = {
      ...rawData,
      name: cleanName,
      material: rawData.material ? stripRawHtmlFromMarkdown(rawData.material).trim() : '',
      careInstructions: rawData.careInstructions
        ? stripRawHtmlFromMarkdown(rawData.careInstructions).trim()
        : '',
      variants: rawData.variants.map((v) => ({
        ...v,
        colorName: stripRawHtmlFromMarkdown(v.colorName).trim(),
        size: stripRawHtmlFromMarkdown(v.size).trim(),
      })),
      attributes: rawData.attributes
        .map((a) => ({
          key: stripRawHtmlFromMarkdown(a.key).trim(),
          value: stripRawHtmlFromMarkdown(a.value).trim(),
        }))
        .filter((a) => a.key.length > 0 && a.value.length > 0),
    };

    const resolvedSlug = (data.slug || slugifyVietnamese(data.name)).toLowerCase();
    if (!resolvedSlug || !/^[a-z0-9-]+$/.test(resolvedSlug)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_SLUG',
        message: 'Slug sản phẩm không hợp lệ',
      });
    }

    // Kiểm tra trùng SKU và trùng (colorName, size) trong chính mảng variants gửi lên
    const skuSet = new Set<string>();
    const colorSizeSet = new Set<string>();
    for (const v of data.variants) {
      if (!v.colorName || !v.size) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Tên màu hoặc kích cỡ biến thể không hợp lệ sau khi loại bỏ HTML thô',
        });
      }
      const upperSku = v.sku.trim().toUpperCase();
      if (skuSet.has(upperSku)) {
        return res.status(400).json({
          success: false,
          code: 'DUPLICATE_VARIANT_SKU_IN_PAYLOAD',
          message: `Mã SKU "${v.sku}" bị trùng lặp trong danh sách biến thể`,
        });
      }
      skuSet.add(upperSku);

      const csKey = `${v.colorName.trim().toLowerCase()}__${v.size.trim().toLowerCase()}`;
      if (colorSizeSet.has(csKey)) {
        return res.status(400).json({
          success: false,
          code: 'DUPLICATE_VARIANT_COLOR_SIZE',
          message: `Biến thể màu "${v.colorName}" - kích cỡ "${v.size}" bị trùng lặp trong cùng sản phẩm`,
        });
      }
      colorSizeSet.add(csKey);
    }

    // Xác minh toàn bộ ảnh sản phẩm bắt buộc đến từ bảng uploads (purpose = 'product') và tồn tại trong Storage
    const verifiedImages = await verifyProductImagesFromUploads(data.images);
    data.images = verifiedImages;

    const sanitizedDescription = stripRawHtmlFromMarkdown(data.description || '').trim();

    const created = await withTransaction(async (txQueryRows) => {
      // 1. Kiểm tra danh mục tồn tại
      const catRows = await txQueryRows<{ id: string; name: string }>(sql`
        SELECT id, name FROM categories WHERE id = ${data.categoryId}::uuid LIMIT 1;
      `);
      if (catRows.length === 0) {
        const err: any = new Error('Không tìm thấy danh mục sản phẩm');
        err.statusCode = 400;
        err.code = 'CATEGORY_NOT_FOUND';
        throw err;
      }

      // 2. Kiểm tra trùng slug sản phẩm -> trả 409 Conflict
      const dupSlugRows = await txQueryRows<{ id: string }>(sql`
        SELECT id FROM products WHERE LOWER(slug) = LOWER(${resolvedSlug}) LIMIT 1;
      `);
      if (dupSlugRows.length > 0) {
        const err: any = new Error(`Slug sản phẩm "${resolvedSlug}" đã tồn tại`);
        err.statusCode = 409;
        err.code = 'DUPLICATE_PRODUCT_SLUG';
        throw err;
      }

      // 3. Kiểm tra trùng SKU trong DB -> trả 409 Conflict
      for (const v of data.variants) {
        const dupSku = await txQueryRows<{ id: string }>(sql`
          SELECT id FROM product_variants WHERE LOWER(sku) = LOWER(${v.sku.trim()}) LIMIT 1;
        `);
        if (dupSku.length > 0) {
          const err: any = new Error(`Mã SKU "${v.sku}" đã tồn tại trong hệ thống`);
          err.statusCode = 409;
          err.code = 'DUPLICATE_VARIANT_SKU';
          throw err;
        }
      }

      // 4. Tính search_text ngay trong cùng giao dịch
      const colorsText = data.variants.map((v) => v.colorName).join(' ');
      const attrsText = data.attributes.map((a) => `${a.key} ${a.value}`).join(' ');
      const searchText = normalizeVietnameseText(
        `${data.name} ${catRows[0].name} ${data.material || ''} ${colorsText} ${attrsText}`
      );

      // 5. Chèn sản phẩm
      const insertedProdRows = await txQueryRows<any>(sql`
        INSERT INTO products (
          category_id,
          name,
          slug,
          target_gender,
          base_price,
          description,
          material,
          care_instructions,
          is_active,
          search_text,
          updated_at
        )
        VALUES (
          ${data.categoryId}::uuid,
          ${data.name},
          ${resolvedSlug},
          ${data.targetGender},
          ${data.basePrice},
          ${sanitizedDescription},
          ${data.material || null},
          ${data.careInstructions || null},
          ${data.isActive},
          ${searchText},
          NOW()
        )
        RETURNING
          id,
          name,
          slug,
          category_id AS "categoryId",
          target_gender AS "targetGender",
          base_price AS "basePrice",
          description,
          material,
          care_instructions AS "careInstructions",
          is_active AS "isActive",
          created_at AS "createdAt",
          updated_at AS "updatedAt";
      `);

      const product = insertedProdRows[0];

      // 6. Chèn ảnh sản phẩm (đảm bảo đúng 1 ảnh đại diện nếu có ảnh)
      const normalizedImages = data.images.map((img, idx) => ({
        ...img,
        displayOrder: typeof img.displayOrder === 'number' ? img.displayOrder : idx,
      }));
      const primaryIdx = normalizedImages.findIndex((img) => img.isPrimary);
      const insertedImages = [];
      for (let i = 0; i < normalizedImages.length; i++) {
        const isPrimary = primaryIdx >= 0 ? i === primaryIdx : i === 0;
        const imgRows = await txQueryRows<any>(sql`
          INSERT INTO product_images (product_id, image_url, is_primary, display_order)
          VALUES (
            ${product.id}::uuid,
            ${normalizedImages[i].imageUrl},
            ${isPrimary},
            ${normalizedImages[i].displayOrder}
          )
          RETURNING id, image_url AS "imageUrl", is_primary AS "isPrimary", display_order AS "displayOrder";
        `);
        insertedImages.push({
          ...imgRows[0],
          url: imgRows[0].imageUrl,
          isPrimary: Boolean(imgRows[0].isPrimary),
          displayOrder: Number(imgRows[0].displayOrder || 0),
        });
      }

      // 7. Chèn thuộc tính sản phẩm
      const insertedAttributes = [];
      for (const attr of data.attributes) {
        const attrRows = await txQueryRows<any>(sql`
          INSERT INTO product_attributes (product_id, attr_key, attr_value)
          VALUES (${product.id}::uuid, ${attr.key.trim()}, ${attr.value.trim()})
          RETURNING id, attr_key AS "key", attr_value AS "value";
        `);
        insertedAttributes.push({
          ...attrRows[0],
          name: attrRows[0].key,
        });
      }

      // 8. Chèn biến thể và ghi nhận tồn kho ban đầu vào stock_movements
      const insertedVariants = [];
      for (const v of data.variants) {
        const vRows = await txQueryRows<any>(sql`
          INSERT INTO product_variants (
            product_id,
            color_name,
            color_code,
            size,
            sku,
            price_override,
            stock_quantity
          )
          VALUES (
            ${product.id}::uuid,
            ${v.colorName.trim()},
            ${v.colorCode.trim()},
            ${v.size.trim()},
            ${v.sku.trim()},
            ${v.priceOverride !== undefined && v.priceOverride !== null ? v.priceOverride : sql`NULL`},
            ${v.stockQuantity}
          )
          RETURNING
            id,
            color_name AS "colorName",
            color_code AS "colorCode",
            size,
            sku,
            price_override AS "priceOverride",
            stock_quantity AS "stockQuantity";
        `);
        const createdVariant = vRows[0];
        insertedVariants.push(createdVariant);

        if (v.stockQuantity > 0) {
          await txQueryRows(sql`
            INSERT INTO stock_movements (variant_id, delta_quantity, reason, reference_id)
            VALUES (
              ${createdVariant.id}::uuid,
              ${v.stockQuantity},
              'manual_import',
              'initial_product_create'
            );
          `);
        }
      }

      // 9. Ghi admin_audit_logs trong cùng giao dịch
      const auditLog = await insertAdminAuditLogInTx(txQueryRows, {
        adminId,
        action: 'PRODUCT_CREATE',
        targetType: 'product',
        targetId: product.id,
        summary: `Tạo sản phẩm "${product.name}" (slug: ${product.slug}, giá cơ bản: ${product.basePrice}₫, ${insertedVariants.length} biến thể)`,
      });

      return {
        ...product,
        basePrice: Number(product.basePrice || 0),
        variants: insertedVariants,
        images: insertedImages,
        attributes: insertedAttributes,
        auditLogId: auditLog.id,
      };
    });

    return res.status(201).json({
      success: true,
      message: 'Đã tạo sản phẩm thành công',
      product: created,
      data: created,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi tạo sản phẩm');
  }
});

/**
 * 18. PUT /api/admin/products/:id — Cập nhật sản phẩm (kiểm tra tranh chấp updatedAt -> 409, cập nhật search_text, ghi giá cũ/mới vào admin_audit_logs)
 */
adminRouter.put('/products/:id', async (req: AuthRequest, res: Response) => {
  try {
    const productId = String(req.params.id || '').trim();
    const adminId = req.user!.id;

    const rawUpdatedAt = req.body?.updatedAt || req.body?.expectedUpdatedAt;

    const parsed = adminProductInputSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message || 'Dữ liệu sản phẩm không hợp lệ',
      });
    }

    const rawData = parsed.data;
    const cleanName = stripRawHtmlFromMarkdown(rawData.name).trim();
    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Tên sản phẩm không hợp lệ sau khi loại bỏ thẻ HTML thô',
      });
    }

    const data = {
      ...rawData,
      name: cleanName,
      material: rawData.material ? stripRawHtmlFromMarkdown(rawData.material).trim() : '',
      careInstructions: rawData.careInstructions
        ? stripRawHtmlFromMarkdown(rawData.careInstructions).trim()
        : '',
      variants: rawData.variants.map((v) => ({
        ...v,
        colorName: stripRawHtmlFromMarkdown(v.colorName).trim(),
        size: stripRawHtmlFromMarkdown(v.size).trim(),
      })),
      attributes: rawData.attributes
        .map((a) => ({
          key: stripRawHtmlFromMarkdown(a.key).trim(),
          value: stripRawHtmlFromMarkdown(a.value).trim(),
        }))
        .filter((a) => a.key.length > 0 && a.value.length > 0),
    };

    const resolvedSlug = (data.slug || slugifyVietnamese(data.name)).toLowerCase();
    if (!resolvedSlug || !/^[a-z0-9-]+$/.test(resolvedSlug)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_SLUG',
        message: 'Slug sản phẩm không hợp lệ',
      });
    }

    const skuSet = new Set<string>();
    const colorSizeSet = new Set<string>();
    for (const v of data.variants) {
      if (!v.colorName || !v.size) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Tên màu hoặc kích cỡ biến thể không hợp lệ sau khi loại bỏ HTML thô',
        });
      }
      const upperSku = v.sku.trim().toUpperCase();
      if (skuSet.has(upperSku)) {
        return res.status(400).json({
          success: false,
          code: 'DUPLICATE_VARIANT_SKU_IN_PAYLOAD',
          message: `Mã SKU "${v.sku}" bị trùng lặp trong danh sách biến thể`,
        });
      }
      skuSet.add(upperSku);

      const csKey = `${v.colorName.trim().toLowerCase()}__${v.size.trim().toLowerCase()}`;
      if (colorSizeSet.has(csKey)) {
        return res.status(400).json({
          success: false,
          code: 'DUPLICATE_VARIANT_COLOR_SIZE',
          message: `Biến thể màu "${v.colorName}" - kích cỡ "${v.size}" bị trùng lặp trong cùng sản phẩm`,
        });
      }
      colorSizeSet.add(csKey);
    }

    // Xác minh toàn bộ ảnh sản phẩm bắt buộc đến từ bảng uploads (purpose = 'product') và tồn tại trong Storage
    const verifiedImages = await verifyProductImagesFromUploads(data.images);
    data.images = verifiedImages;

    const sanitizedDescription = stripRawHtmlFromMarkdown(data.description || '').trim();

    const updated = await withTransaction(async (txQueryRows) => {
      const existingRows = await txQueryRows<any>(sql`
        SELECT * FROM products WHERE id = ${productId}::uuid FOR UPDATE;
      `);

      if (existingRows.length === 0) {
        const err: any = new Error('Không tìm thấy sản phẩm');
        err.statusCode = 404;
        throw err;
      }

      const existing = existingRows[0];
      if (rawUpdatedAt && typeof rawUpdatedAt === 'string' && rawUpdatedAt.trim()) {
        const dbTimeMs = new Date(existing.updated_at).getTime();
        const clientTimeMs = new Date(rawUpdatedAt).getTime();

        if (Number.isNaN(clientTimeMs) || dbTimeMs !== clientTimeMs) {
          const err: any = new Error(
            'Sản phẩm đã được chỉnh sửa bởi quản trị viên khác. Vui lòng tải lại dữ liệu mới nhất trước khi lưu.'
          );
          err.statusCode = 409;
          err.code = 'PRODUCT_CONFLICT';
          throw err;
        }
      }

      // Kiểm tra danh mục
      const catRows = await txQueryRows<{ id: string; name: string }>(sql`
        SELECT id, name FROM categories WHERE id = ${data.categoryId}::uuid LIMIT 1;
      `);
      if (catRows.length === 0) {
        const err: any = new Error('Không tìm thấy danh mục sản phẩm');
        err.statusCode = 400;
        err.code = 'CATEGORY_NOT_FOUND';
        throw err;
      }

      // Kiểm tra trùng slug
      const dupSlugRows = await txQueryRows<{ id: string }>(sql`
        SELECT id
        FROM products
        WHERE LOWER(slug) = LOWER(${resolvedSlug})
          AND id != ${productId}::uuid
        LIMIT 1;
      `);
      if (dupSlugRows.length > 0) {
        const err: any = new Error(`Slug sản phẩm "${resolvedSlug}" đã tồn tại`);
        err.statusCode = 409;
        err.code = 'DUPLICATE_PRODUCT_SLUG';
        throw err;
      }

      // Kiểm tra trùng SKU với sản phẩm khác
      for (const v of data.variants) {
        const dupSku = await txQueryRows<{ id: string; product_id: string }>(sql`
          SELECT id, product_id
          FROM product_variants
          WHERE LOWER(sku) = LOWER(${v.sku.trim()})
            AND product_id != ${productId}::uuid
          LIMIT 1;
        `);
        if (dupSku.length > 0) {
          const err: any = new Error(`Mã SKU "${v.sku}" đã thuộc về một sản phẩm khác`);
          err.statusCode = 409;
          err.code = 'DUPLICATE_VARIANT_SKU';
          throw err;
        }
      }

      const colorsText = data.variants.map((v) => v.colorName).join(' ');
      const attrsText = data.attributes.map((a) => `${a.key} ${a.value}`).join(' ');
      const searchText = normalizeVietnameseText(
        `${data.name} ${catRows[0].name} ${data.material || ''} ${colorsText} ${attrsText}`
      );

      // Bảo đảm updated_at tăng tối thiểu 1ms để các thao tác cập nhật liên tiếp luôn sinh dấu thời gian mới
      const updProdRows = await txQueryRows<any>(sql`
        UPDATE products
        SET category_id = ${data.categoryId}::uuid,
            name = ${data.name},
            slug = ${resolvedSlug},
            target_gender = ${data.targetGender},
            base_price = ${data.basePrice},
            description = ${sanitizedDescription},
            material = ${data.material || null},
            care_instructions = ${data.careInstructions || null},
            is_active = ${data.isActive},
            search_text = ${searchText},
            updated_at = GREATEST(NOW(), updated_at + INTERVAL '1 millisecond')
        WHERE id = ${productId}::uuid
        RETURNING
          id,
          name,
          slug,
          category_id AS "categoryId",
          target_gender AS "targetGender",
          base_price AS "basePrice",
          description,
          material,
          care_instructions AS "careInstructions",
          is_active AS "isActive",
          created_at AS "createdAt",
          updated_at AS "updatedAt";
      `);

      const updatedProduct = updProdRows[0];

      // Cập nhật product_images
      await txQueryRows(sql`
        DELETE FROM product_images WHERE product_id = ${productId}::uuid;
      `);
      const normalizedImages = data.images.map((img, idx) => ({
        ...img,
        displayOrder: typeof img.displayOrder === 'number' ? img.displayOrder : idx,
      }));
      const primaryIdx = normalizedImages.findIndex((img) => img.isPrimary);
      for (let i = 0; i < normalizedImages.length; i++) {
        const isPrimary = primaryIdx >= 0 ? i === primaryIdx : i === 0;
        await txQueryRows(sql`
          INSERT INTO product_images (product_id, image_url, is_primary, display_order)
          VALUES (
            ${productId}::uuid,
            ${normalizedImages[i].imageUrl},
            ${isPrimary},
            ${normalizedImages[i].displayOrder}
          );
        `);
      }

      // Cập nhật product_attributes
      await txQueryRows(sql`
        DELETE FROM product_attributes WHERE product_id = ${productId}::uuid;
      `);
      for (const attr of data.attributes) {
        await txQueryRows(sql`
          INSERT INTO product_attributes (product_id, attr_key, attr_value)
          VALUES (${productId}::uuid, ${attr.key.trim()}, ${attr.value.trim()});
        `);
      }

      // Đồng bộ product_variants (không xóa biến thể đã nằm trong order_items)
      const existingVariants = await txQueryRows<any>(sql`
        SELECT id, sku, price_override, stock_quantity
        FROM product_variants
        WHERE product_id = ${productId}::uuid
        FOR UPDATE;
      `);

      const keptExistingIds = new Set<string>();
      const syncedVariants = [];
      for (const v of data.variants) {
        const matchedExisting = existingVariants.find(
          (ev) => (v.id && ev.id === v.id) || ev.sku.toLowerCase() === v.sku.trim().toLowerCase()
        );

        if (matchedExisting) {
          keptExistingIds.add(matchedExisting.id);
          const updVar = await txQueryRows<any>(sql`
            UPDATE product_variants
            SET color_name = ${v.colorName.trim()},
                color_code = ${v.colorCode.trim()},
                size = ${v.size.trim()},
                sku = ${v.sku.trim()},
                price_override = ${
                  v.priceOverride !== undefined && v.priceOverride !== null
                    ? v.priceOverride
                    : sql`NULL`
                }
            WHERE id = ${matchedExisting.id}::uuid
            RETURNING
              id,
              color_name AS "colorName",
              color_code AS "colorCode",
              size,
              sku,
              price_override AS "priceOverride",
              stock_quantity AS "stockQuantity";
          `);
          syncedVariants.push(updVar[0]);
        } else {
          const insVar = await txQueryRows<any>(sql`
            INSERT INTO product_variants (
              product_id,
              color_name,
              color_code,
              size,
              sku,
              price_override,
              stock_quantity
            )
            VALUES (
              ${productId}::uuid,
              ${v.colorName.trim()},
              ${v.colorCode.trim()},
              ${v.size.trim()},
              ${v.sku.trim()},
              ${
                v.priceOverride !== undefined && v.priceOverride !== null
                  ? v.priceOverride
                  : sql`NULL`
              },
              ${v.stockQuantity}
            )
            RETURNING
              id,
              color_name AS "colorName",
              color_code AS "colorCode",
              size,
              sku,
              price_override AS "priceOverride",
              stock_quantity AS "stockQuantity";
          `);
          syncedVariants.push(insVar[0]);
          if (v.stockQuantity > 0) {
            await txQueryRows(sql`
              INSERT INTO stock_movements (variant_id, delta_quantity, reason, reference_id)
              VALUES (
                ${insVar[0].id}::uuid,
                ${v.stockQuantity},
                'manual_import',
                'variant_added_on_update'
              );
            `);
          }
        }
      }

      // Kiểm tra các biến thể cũ bị loại khỏi payload: nếu đã nằm trong order_items -> chặn 400 VARIANT_HAS_ORDERS
      const removedVariants = existingVariants.filter((ev) => !keptExistingIds.has(ev.id));
      for (const rv of removedVariants) {
        const orderRefs = await txQueryRows<{ cnt: number }>(sql`
          SELECT COUNT(*)::int AS cnt FROM order_items WHERE variant_id = ${rv.id}::uuid;
        `);
        if (Number(orderRefs[0]?.cnt || 0) > 0) {
          const err: any = new Error(
            `Không thể xóa biến thể SKU "${rv.sku}" vì đã phát sinh trong đơn hàng của khách. Vui lòng giữ nguyên biến thể hoặc đặt tồn kho về 0.`
          );
          err.statusCode = 400;
          err.code = 'VARIANT_HAS_ORDERS';
          throw err;
        }
        await txQueryRows(sql`
          DELETE FROM stock_movements WHERE variant_id = ${rv.id}::uuid;
        `);
        await txQueryRows(sql`
          DELETE FROM product_variants WHERE id = ${rv.id}::uuid;
        `);
      }

      const oldBasePrice = Number(existing.base_price || 0);
      const newBasePrice = Number(data.basePrice || 0);
      const priceDiffNote =
        oldBasePrice !== newBasePrice
          ? `, đổi giá cơ bản: ${oldBasePrice}₫ -> ${newBasePrice}₫`
          : '';

      const auditLog = await insertAdminAuditLogInTx(txQueryRows, {
        adminId,
        action: oldBasePrice !== newBasePrice ? 'PRODUCT_PRICE_UPDATE' : 'PRODUCT_UPDATE',
        targetType: 'product',
        targetId: productId,
        summary: `Cập nhật sản phẩm "${data.name}" (slug: ${resolvedSlug}, hiển thị: ${data.isActive ? 'bật' : 'ẩn'}${priceDiffNote})`,
      });

      return {
        ...updatedProduct,
        basePrice: newBasePrice,
        variants: syncedVariants,
        auditLogId: auditLog.id,
      };
    });

    return res.json({
      success: true,
      message: 'Đã cập nhật sản phẩm thành công',
      product: updated,
      data: updated,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi cập nhật sản phẩm');
  }
});

/**
 * 19. PATCH /api/admin/products/:id/visibility & DELETE /api/admin/products/:id
 * Ẩn / Hiện sản phẩm (is_active = false / true). Không xóa cứng sản phẩm đã từng nằm trong đơn hàng.
 */
async function handleProductVisibility(req: AuthRequest, res: Response, forceHide = false) {
  try {
    const productId = String(req.params.id || '').trim();
    const adminId = req.user!.id;
    const desiredActive = forceHide
      ? false
      : req.body?.isActive !== undefined
      ? Boolean(req.body.isActive)
      : false;

    const result = await withTransaction(async (txQueryRows) => {
      const existingRows = await txQueryRows<any>(sql`
        SELECT id, name, slug, is_active FROM products WHERE id = ${productId}::uuid FOR UPDATE;
      `);
      if (existingRows.length === 0) {
        const err: any = new Error('Không tìm thấy sản phẩm');
        err.statusCode = 404;
        throw err;
      }

      const updRows = await txQueryRows<any>(sql`
        UPDATE products
        SET is_active = ${desiredActive},
            updated_at = GREATEST(NOW(), updated_at + INTERVAL '1 millisecond')
        WHERE id = ${productId}::uuid
        RETURNING id, name, slug, is_active AS "isActive", updated_at AS "updatedAt";
      `);

      const auditLog = await insertAdminAuditLogInTx(txQueryRows, {
        adminId,
        action: desiredActive ? 'PRODUCT_SHOW' : 'PRODUCT_HIDE',
        targetType: 'product',
        targetId: productId,
        summary: `${desiredActive ? 'Hiện' : 'Ẩn'} sản phẩm "${existingRows[0].name}" (slug: ${existingRows[0].slug})`,
      });

      return {
        ...updRows[0],
        isActive: Boolean(updRows[0].isActive),
        auditLogId: auditLog.id,
      };
    });

    return res.json({
      success: true,
      message: desiredActive
        ? 'Đã bật hiển thị sản phẩm trên cửa hàng'
        : 'Đã ẩn sản phẩm khỏi danh sách cửa hàng (vẫn giữ nguyên trong các đơn hàng cũ)',
      product: result,
      data: result,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi cập nhật trạng thái hiển thị sản phẩm');
  }
}

adminRouter.patch('/products/:id/visibility', (req, res) =>
  handleProductVisibility(req, res, false)
);

adminRouter.delete('/products/:id', async (req: AuthRequest, res: Response) => {
  try {
    const productId = String(req.params.id || '').trim();
    const adminId = req.user!.id;

    const deleted = await withTransaction(async (txQueryRows) => {
      const existingRows = await txQueryRows<any>(sql`
        SELECT id, name, slug FROM products WHERE id = ${productId}::uuid FOR UPDATE;
      `);
      if (existingRows.length === 0) {
        const err: any = new Error('Không tìm thấy sản phẩm');
        err.statusCode = 404;
        throw err;
      }

      const orderItemRefs = await txQueryRows<{ cnt: number }>(sql`
        SELECT COUNT(*)::int AS cnt
        FROM order_items oi
        JOIN product_variants pv ON pv.id = oi.variant_id
        WHERE pv.product_id = ${productId}::uuid;
      `);

      if (Number(orderItemRefs[0]?.cnt || 0) > 0) {
        const err: any = new Error(
          `Không thể xóa cứng sản phẩm "${existingRows[0].name}" vì đã phát sinh trong đơn hàng. Vui lòng chuyển sang ẩn sản phẩm (PATCH /api/admin/products/${productId}/visibility với isActive = false).`
        );
        err.statusCode = 409;
        err.code = 'PRODUCT_HAS_ORDERS';
        throw err;
      }

      await txQueryRows(sql`
        DELETE FROM stock_movements
        WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ${productId}::uuid);
      `);
      await txQueryRows(sql`
        DELETE FROM product_variants WHERE product_id = ${productId}::uuid;
      `);
      await txQueryRows(sql`
        DELETE FROM product_images WHERE product_id = ${productId}::uuid;
      `);
      await txQueryRows(sql`
        DELETE FROM product_attributes WHERE product_id = ${productId}::uuid;
      `);
      await txQueryRows(sql`
        DELETE FROM products WHERE id = ${productId}::uuid;
      `);

      const auditLog = await insertAdminAuditLogInTx(txQueryRows, {
        adminId,
        action: 'PRODUCT_DELETE',
        targetType: 'product',
        targetId: productId,
        summary: `Xóa sản phẩm chưa phát sinh đơn hàng "${existingRows[0].name}" (slug: ${existingRows[0].slug})`,
      });

      return {
        id: productId,
        auditLogId: auditLog.id,
      };
    });

    return res.json({
      success: true,
      message: 'Đã xóa sản phẩm thành công',
      ...deleted,
      data: deleted,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi xóa sản phẩm');
  }
});

/**
 * 20. GET /api/admin/inventory — Danh sách biến thể tồn kho & lọc sắp hết hàng theo ngưỡng trong store_settings
 */
adminRouter.get('/inventory', async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const rawLimit = parseInt(String(req.query.limit || '20'), 10) || 20;
    const limit = Math.min(50, Math.max(1, rawLimit));
    const offset = (page - 1) * limit;

    // Đọc ngưỡng tồn kho thấp từ store_settings (ưu tiên key = 'inventory', sau đó 'general', mặc định 5)
    const settingsRows = await queryRows<{ key: string; value: any }>(sql`
      SELECT key, value FROM store_settings
      WHERE key IN ('inventory', 'general')
      ORDER BY CASE WHEN key = 'inventory' THEN 0 ELSE 1 END;
    `);
    let lowStockThreshold = 5;
    for (const s of settingsRows) {
      if (s.value && typeof s.value === 'object') {
        const candidate = Number(s.value.lowStockThreshold ?? s.value.low_stock_threshold);
        if (Number.isInteger(candidate) && candidate >= 0) {
          lowStockThreshold = candidate;
          break;
        }
      }
    }

    const lowStockOnly = req.query.lowStockOnly === 'true' || req.query.filter === 'low_stock';
    const searchRaw =
      typeof (req.query.search || req.query.q) === 'string'
        ? String(req.query.search || req.query.q).trim()
        : '';
    const categoryId =
      typeof req.query.categoryId === 'string' ? req.query.categoryId.trim() : '';

    const conditions = [];
    if (lowStockOnly) {
      conditions.push(sql`pv.stock_quantity <= ${lowStockThreshold}`);
    }
    if (categoryId && categoryId !== 'all') {
      conditions.push(sql`p.category_id = ${categoryId}::uuid`);
    }
    if (searchRaw) {
      const likePattern = `%${searchRaw}%`;
      conditions.push(
        sql`(pv.sku ILIKE ${likePattern} OR p.name ILIKE ${likePattern} OR pv.color_name ILIKE ${likePattern} OR pv.size ILIKE ${likePattern})`
      );
    }

    const whereSql =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    const [countRows, lowCountRows, rows] = await Promise.all([
      queryRows<{ total: number }>(sql`
        SELECT COUNT(*)::int AS total
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        ${whereSql};
      `),
      queryRows<{ low_count: number }>(sql`
        SELECT COUNT(*)::int AS low_count
        FROM product_variants pv
        WHERE pv.stock_quantity <= ${lowStockThreshold};
      `),
      queryRows<any>(sql`
        SELECT
          pv.id,
          pv.product_id AS "productId",
          p.name AS "productName",
          p.slug AS "productSlug",
          p.is_active AS "productIsActive",
          c.name AS "categoryName",
          pv.sku,
          pv.color_name AS "colorName",
          pv.color_code AS "colorCode",
          pv.size,
          p.base_price AS "basePrice",
          pv.price_override AS "priceOverride",
          pv.stock_quantity AS "stockQuantity"
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        ${whereSql}
        ORDER BY pv.stock_quantity ASC, p.name ASC, pv.sku ASC
        LIMIT ${limit} OFFSET ${offset};
      `),
    ]);

    const total = Number(countRows[0]?.total || 0);
    const lowStockCount = Number(lowCountRows[0]?.low_count || 0);
    const items = rows.map((r) => ({
      ...r,
      basePrice: Number(r.basePrice || 0),
      priceOverride:
        r.priceOverride === null || r.priceOverride === undefined ? null : Number(r.priceOverride),
      stockQuantity: Number(r.stockQuantity || 0),
      isLowStock: Number(r.stockQuantity || 0) <= lowStockThreshold,
    }));

    return res.json({
      success: true,
      items,
      data: items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      lowStockThreshold,
      lowStockCount,
      allowedReasons: STOCK_ADJUST_REASONS,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi tải danh sách tồn kho');
  }
});

/**
 * 21. POST /api/admin/variants/:id/stock-adjust — Điều chỉnh tồn kho nguyên tử kèm lý do chuẩn, ghi stock_movements và admin_audit_logs
 */
adminRouter.post('/variants/:id/stock-adjust', async (req: AuthRequest, res: Response) => {
  try {
    const variantId = String(req.params.id || '').trim();
    const adminId = req.user!.id;

    const parsed = adminStockAdjustSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message || 'Dữ liệu điều chỉnh tồn kho không hợp lệ',
      });
    }

    const { delta, reason, note } = parsed.data;

    const result = await withTransaction(async (txQueryRows) => {
      // Cập nhật nguyên tử có điều kiện: stock_quantity + delta >= 0
      const updatedRows = await txQueryRows<{
        id: string;
        product_id: string;
        sku: string;
        color_name: string;
        size: string;
        stock_quantity: number;
      }>(sql`
        UPDATE product_variants
        SET stock_quantity = stock_quantity + ${delta}
        WHERE id = ${variantId}::uuid
          AND stock_quantity + ${delta} >= 0
        RETURNING id, product_id, sku, color_name, size, stock_quantity;
      `);

      if (updatedRows.length === 0) {
        const existsRows = await txQueryRows<{ id: string; stock_quantity: number }>(sql`
          SELECT id, stock_quantity FROM product_variants WHERE id = ${variantId}::uuid LIMIT 1;
        `);
        if (existsRows.length === 0) {
          const err: any = new Error('Không tìm thấy biến thể sản phẩm');
          err.statusCode = 404;
          throw err;
        }
        const err: any = new Error(
          `Không thể trừ kho vượt quá số lượng hiện có (tồn hiện tại: ${existsRows[0].stock_quantity}, điều chỉnh: ${delta})`
        );
        err.statusCode = 409;
        err.code = 'INSUFFICIENT_STOCK_FOR_ADJUSTMENT';
        throw err;
      }

      const updated = updatedRows[0];
      const newStock = Number(updated.stock_quantity);
      const previousStock = newStock - delta;

      const movementRows = await txQueryRows<{ id: string; created_at: string }>(sql`
        INSERT INTO stock_movements (variant_id, delta_quantity, reason, reference_id)
        VALUES (
          ${variantId}::uuid,
          ${delta},
          ${reason},
          ${note ? note.trim() : `admin_adjust:${adminId}`}
        )
        RETURNING id, created_at;
      `);

      const auditLog = await insertAdminAuditLogInTx(txQueryRows, {
        adminId,
        action: 'VARIANT_STOCK_ADJUST',
        targetType: 'product_variant',
        targetId: variantId,
        summary: `Điều chỉnh tồn kho SKU ${updated.sku}: ${previousStock} -> ${newStock} (${delta > 0 ? `+${delta}` : delta}, lý do: ${reason}${note ? `, ghi chú: ${note.trim()}` : ''})`,
      });

      return {
        variantId: updated.id,
        productId: updated.product_id,
        sku: updated.sku,
        colorName: updated.color_name,
        size: updated.size,
        previousStock,
        stockQuantity: newStock,
        newQuantity: newStock,
        delta,
        reason,
        movementId: movementRows[0]?.id,
        auditLogId: auditLog.id,
      };
    });

    return res.json({
      success: true,
      message: 'Đã điều chỉnh tồn kho thành công',
      ...result,
      data: result,
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi điều chỉnh tồn kho biến thể');
  }
});

/**
 * 22. GET /api/admin/variants/:id/stock-movements — Lịch sử biến động kho của một biến thể (phân trang)
 */
adminRouter.get('/variants/:id/stock-movements', async (req: AuthRequest, res: Response) => {
  try {
    const variantId = String(req.params.id || '').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const rawLimit = parseInt(String(req.query.limit || '20'), 10) || 20;
    const limit = Math.min(50, Math.max(1, rawLimit));
    const offset = (page - 1) * limit;

    const variantRows = await queryRows<any>(sql`
      SELECT
        pv.id,
        pv.sku,
        pv.color_name AS "colorName",
        pv.size,
        pv.stock_quantity AS "stockQuantity",
        p.name AS "productName"
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      WHERE pv.id = ${variantId}::uuid
      LIMIT 1;
    `);

    if (variantRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy biến thể sản phẩm',
      });
    }

    const [countRows, rows] = await Promise.all([
      queryRows<{ total: number }>(sql`
        SELECT COUNT(*)::int AS total
        FROM stock_movements
        WHERE variant_id = ${variantId}::uuid;
      `),
      queryRows<any>(sql`
        SELECT
          id,
          variant_id AS "variantId",
          delta_quantity AS "deltaQuantity",
          reason,
          reference_id AS "referenceId",
          created_at AS "createdAt"
        FROM stock_movements
        WHERE variant_id = ${variantId}::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit} OFFSET ${offset};
      `),
    ]);

    const total = Number(countRows[0]?.total || 0);
    const items = rows.map((r) => ({
      ...r,
      deltaQuantity: Number(r.deltaQuantity || 0),
      delta: Number(r.deltaQuantity || 0),
    }));

    return res.json({
      success: true,
      variant: {
        ...variantRows[0],
        stockQuantity: Number(variantRows[0].stockQuantity || 0),
      },
      items,
      data: items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err: any) {
    return sendAdminError(res, err, 'Lỗi tải lịch sử biến động tồn kho');
  }
});

// Đăng ký các route Giai đoạn 8c (Voucher, Khuyến mãi, Cài đặt cửa hàng, Chính sách & FAQ)
registerAdminStage8cRoutes(adminRouter);

// Đăng ký các route Giai đoạn 8d (Đánh giá, Tổng quan vận hành, Thống kê & Xuất CSV)
registerAdminStage8dRoutes(adminRouter);

// Catch-all cho mọi nhánh con /api/admin/* (được bảo vệ bởi requireAdmin ở apiRouter)
adminRouter.all('/*', (_req: AuthRequest, res: Response) => {
  res.status(404).json({
    success: false,
    code: 'ADMIN_ROUTE_NOT_FOUND',
    message: 'Không tìm thấy đường dẫn quản trị',
    error: {
      code: 'ADMIN_ROUTE_NOT_FOUND',
      message: 'Không tìm thấy đường dẫn quản trị',
    },
  });
});
