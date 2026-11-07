import { Router, type Response } from 'express';
import { queryRows, withTransaction } from '../db/index.ts';
import { sql } from 'drizzle-orm';
import { requireAuth, requireAdmin, type AuthRequest } from '../services/auth.ts';
import { transitionOrderStatus } from '../services/orderStateMachine.ts';
import { calculateRefundAmount, getStoreShippingSettings } from '../services/pricing.ts';

export const returnsRouter = Router();

const VALID_RETURN_REASONS = [
  'defective_product',
  'wrong_item',
  'size_not_fit',
  'not_as_described',
  'other',
];

/**
 * 1. TẠO YÊU CẦU ĐỔI TRẢ / HOÀN TIỀN (POST /api/returns)
 * - Ràng buộc nghiệp vụ Giai đoạn 5 & 8c:
 *   + Chỉ áp dụng cho đơn hàng đã giao (status = 'delivered')
 *   + Trong vòng returnDaysLimit ngày kể từ delivered_at (bảo lưu thời hạn cũ cho đơn giao trước khi rút ngắn)
 *   + Chọn sản phẩm và số lượng (không vượt số đã mua trừ số đã yêu cầu)
 *   + Lý do chọn từ danh sách hợp lệ và mô tả
 *   + Tối đa 3 ảnh minh chứng (chỉ lưu path trong bucket private)
 *   + Mỗi dòng sản phẩm (order_item_id) chỉ có tối đa 1 yêu cầu đang xử lý (pending, approved, receiving)
 *   + Số tiền hoàn do server tính tự động (phân bổ voucher theo tỷ lệ giá trị), không nhận từ client
 */
returnsRouter.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      orderId,
      orderItemId,
      quantity = 1,
      type,
      reason,
      description = '',
      newVariantId = null,
      imageProofUrls = [],
    } = req.body || {};

    if (!orderId || !orderItemId || !type || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp đầy đủ: orderId, orderItemId, type và reason',
      });
    }

    if (!['exchange', 'refund'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Loại yêu cầu không hợp lệ (chỉ hỗ trợ exchange hoặc refund)',
      });
    }

    if (!VALID_RETURN_REASONS.includes(reason)) {
      return res.status(400).json({
        success: false,
        message: 'Lý do đổi trả không nằm trong danh sách quy định',
      });
    }

    const returnQty = Number(quantity);
    if (!Number.isInteger(returnQty) || returnQty < 1) {
      return res.status(400).json({
        success: false,
        message: 'Số lượng yêu cầu đổi trả phải là số nguyên dương (>= 1)',
      });
    }

    const imagesArray = Array.isArray(imageProofUrls) ? imageProofUrls : [];
    if (imagesArray.length > 3) {
      return res.status(400).json({
        success: false,
        message: 'Tối đa 3 ảnh minh chứng cho mỗi yêu cầu đổi trả',
      });
    }

    // Kiểm tra từng đường dẫn ảnh minh chứng phải thuộc thư mục của chính người dùng (<userId>/return/<filename>)
    const returnPathRegex = /^([a-f0-9\-]+)\/return\/([a-zA-Z0-9_\-\.]+\.(jpg|jpeg|png|webp))$/i;
    for (const rawPath of imagesArray) {
      if (
        typeof rawPath !== 'string' ||
        rawPath.includes('..') ||
        rawPath.includes('\\') ||
        rawPath.includes('\0') ||
        /[\s<>:"|?*]/.test(rawPath)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Đường dẫn ảnh minh chứng không hợp lệ',
        });
      }
      const match = rawPath.match(returnPathRegex);
      if (!match || match[1] !== userId) {
        return res.status(400).json({
          success: false,
          message: 'Đường dẫn ảnh minh chứng phải thuộc thư mục đổi trả của chính người dùng (<userId>/return/<filename>)',
        });
      }
    }

    const created = await withTransaction(async (txQueryRows) => {
      // 1. Kiểm tra đơn hàng thuộc quyền sở hữu của user
      const orderRows = await txQueryRows<{
        id: string;
        user_id: string;
        status: string;
        delivered_at: string | null;
        subtotal: number;
        discount_amount: number;
        total_amount: number;
      }>(sql`
        SELECT id, user_id, status, delivered_at, subtotal, discount_amount, total_amount
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
      if (order.user_id !== userId && req.user!.role !== 'admin') {
        const err: any = new Error('Không tìm thấy đơn hàng');
        err.statusCode = 404;
        throw err;
      }

      // Chỉ áp dụng cho đơn delivered hoặc return_requested (cho phép đổi trả món khác trong cùng đơn)
      if (order.status !== 'delivered' && order.status !== 'return_requested') {
        const err: any = new Error(
          `Chỉ có thể tạo yêu cầu đổi trả cho đơn hàng đã giao thành công (delivered). Trạng thái hiện tại: "${order.status}"`
        );
        err.statusCode = 400;
        throw err;
      }

      // Kiểm tra ranh giới returnDaysLimit kể từ delivered_at (kèm quy tắc bảo lưu cho đơn đã giao trước khi rút ngắn)
      if (!order.delivered_at) {
        const err: any = new Error('Đơn hàng chưa ghi nhận thời điểm giao hàng delivered_at hợp lệ');
        err.statusCode = 400;
        throw err;
      }

      const storeShippingSettings = await getStoreShippingSettings(txQueryRows);
      const deliveredMs = new Date(order.delivered_at).getTime();
      const nowMs = Date.now();
      const diffDays = (nowMs - deliveredMs) / (1000 * 60 * 60 * 24);

      let effectiveReturnDaysLimit = storeShippingSettings.returnDaysLimit;
      if (storeShippingSettings.returnPolicyChangedAt) {
        const policyChangedMs = new Date(storeShippingSettings.returnPolicyChangedAt).getTime();
        if (!Number.isNaN(policyChangedMs) && deliveredMs < policyChangedMs) {
          // Đơn hàng đã giao trước thời điểm thay đổi chính sách được bảo lưu thời hạn có lợi hơn (tối thiểu 7 ngày hoặc mốc trước khi giảm)
          effectiveReturnDaysLimit = Math.max(
            storeShippingSettings.returnDaysLimit,
            storeShippingSettings.previousReturnDaysLimit || 7,
            7
          );
        }
      }

      if (diffDays > effectiveReturnDaysLimit) {
        const err: any = new Error(
          `Đã quá thời hạn ${effectiveReturnDaysLimit} ngày kể từ khi nhận hàng để gửi yêu cầu đổi trả (Đã giao cách đây ${Math.floor(
            diffDays
          )} ngày)`
        );
        err.statusCode = 400;
        throw err;
      }

      // 2. Kiểm tra dòng sản phẩm order_item_id trong đơn
      const itemRows = await txQueryRows<{
        id: string;
        order_id: string;
        variant_id: string;
        product_name: string;
        color: string;
        size: string;
        unit_price: number;
        quantity: number;
      }>(sql`
        SELECT id, order_id, variant_id, product_name, color, size, unit_price, quantity
        FROM order_items
        WHERE id = ${orderItemId}::uuid AND order_id = ${orderId}
        LIMIT 1;
      `);

      if (itemRows.length === 0) {
        const err: any = new Error('Không tìm thấy dòng sản phẩm hợp lệ trong đơn hàng');
        err.statusCode = 400;
        throw err;
      }

      const item = itemRows[0];

      // 3. Kiểm tra yêu cầu đang xử lý trên dòng sản phẩm này
      const activeRequests = await txQueryRows<{ id: string; status: string }>(sql`
        SELECT id, status
        FROM return_requests
        WHERE order_item_id = ${orderItemId}::uuid
          AND status IN ('pending', 'approved', 'receiving')
        LIMIT 1;
      `);

      if (activeRequests.length > 0) {
        const err: any = new Error(
          'Dòng sản phẩm này hiện đang có một yêu cầu đổi trả đang được xử lý. Không thể tạo thêm yêu cầu trùng lặp.'
        );
        err.statusCode = 400;
        throw err;
      }

      // 4. Kiểm tra tổng số lượng đã yêu cầu trước đó
      const historyRequests = await txQueryRows<{ sum_qty: string | null }>(sql`
        SELECT COALESCE(SUM(quantity), 0) AS sum_qty
        FROM return_requests
        WHERE order_item_id = ${orderItemId}::uuid
          AND status IN ('pending', 'approved', 'receiving', 'completed');
      `);

      const totalRequestedPreviously = Number(historyRequests[0]?.sum_qty || 0);
      const remainingReturnable = item.quantity - totalRequestedPreviously;

      if (returnQty > remainingReturnable) {
        const err: any = new Error(
          `Số lượng yêu cầu đổi trả (${returnQty}) vượt quá số lượng sản phẩm có thể đổi trả (${remainingReturnable})`
        );
        err.statusCode = 400;
        throw err;
      }

      // 4b. Kiểm tra tổng số tiền đã được hoàn/yêu cầu hoàn trước đó cho đơn hàng
      const previousRefunds = await txQueryRows<{ sum_refund: string | null }>(sql`
        SELECT COALESCE(SUM(refund_amount), 0) AS sum_refund
        FROM return_requests
        WHERE order_id = ${orderId}
          AND type = 'refund'
          AND status IN ('pending', 'approved', 'receiving', 'completed');
      `);
      const totalPreviouslyRefunded = Number(previousRefunds[0]?.sum_refund || 0);

      // 4c. Kiểm tra loại voucher của đơn hàng (nếu là free_shipping thì phần giảm đó thuộc phí ship, KHÔNG trừ vào tiền hoàn sản phẩm)
      const orderVoucherRows = await txQueryRows<{ discount_type: string }>(sql`
        SELECT v.discount_type
        FROM voucher_usages vu
        JOIN vouchers v ON v.id = vu.voucher_id
        WHERE vu.order_id = ${orderId}
        LIMIT 1;
      `);
      const voucherDiscountType = orderVoucherRows[0]?.discount_type || null;

      // 5. Tính số tiền hoàn tự động trên Server qua calculateRefundAmount (bỏ qua mọi giá trị client gửi)
      let refundAmount = 0;
      if (type === 'refund') {
        const refundCalc = calculateRefundAmount({
          itemUnitPrice: Number(item.unit_price),
          returnQty,
          orderSubtotal: Number(order.subtotal),
          orderDiscountAmount: Number(order.discount_amount || 0),
          orderTotalAmount: Number(order.total_amount),
          voucherDiscountType,
          totalPreviouslyRefunded,
          includeShippingFee: false,
        });
        refundAmount = refundCalc.refundAmount;
      }

      // 6. Ghi bản ghi return_requests
      const inserted = await txQueryRows<any>(sql`
        INSERT INTO return_requests (
          order_id,
          user_id,
          order_item_id,
          reason,
          type,
          quantity,
          refund_amount,
          description,
          new_variant_id,
          image_proof_urls,
          status
        )
        VALUES (
          ${orderId},
          ${userId}::uuid,
          ${orderItemId}::uuid,
          ${reason},
          ${type},
          ${returnQty},
          ${refundAmount},
          ${description ? String(description).trim() : null},
          ${newVariantId ? sql`${newVariantId}::uuid` : sql`NULL`},
          ${JSON.stringify(imagesArray)}::jsonb,
          'pending'
        )
        RETURNING *;
      `);

      // 7. Chuyển trạng thái đơn sang return_requested nếu đơn đang là delivered
      if (order.status === 'delivered') {
        await transitionOrderStatus({
          orderId,
          newStatus: 'return_requested',
          changedBy: 'customer',
          requestingUserId: userId,
          note: `Khách hàng gửi yêu cầu ${type === 'exchange' ? 'đổi hàng' : 'hoàn tiền'}: ${reason}`,
          txQueryRows,
        });
      }

      return inserted[0];
    });

    const isStoreFaultProposal = ['defective_product', 'wrong_item'].includes(reason);
    const formatted = {
      ...created,
      id: created.id,
      orderId: created.order_id,
      orderItemId: created.order_item_id,
      userId: created.user_id,
      refundAmount: Number(created.refund_amount || 0),
      shippingFeeRefundProposed: isStoreFaultProposal,
      refundShippingFee: false,
      newVariantId: created.new_variant_id,
      imageProofUrls: created.image_proof_urls,
      rejectionReason: created.rejection_reason,
      createdAt: created.created_at,
    };

    res.status(201).json({
      success: true,
      message: 'Gửi yêu cầu đổi trả / hoàn tiền thành công',
      data: formatted,
      request: formatted,
    });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Lỗi gửi yêu cầu đổi trả',
    });
  }
});

/**
 * 2. DANH SÁCH YÊU CẦU ĐỔI TRẢ (GET /api/returns)
 * - Khách hàng: xem yêu cầu của chính mình
 * - Admin: xem tất cả yêu cầu
 */
returnsRouter.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    const statusFilter = req.query.status as string;

    const conditions = [];
    if (!isAdmin) {
      conditions.push(sql`rr.user_id = ${userId}::uuid`);
    }
    if (statusFilter && statusFilter !== 'all') {
      conditions.push(sql`rr.status = ${statusFilter}`);
    }

    const whereSql = conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    const rows = await queryRows(sql`
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
        rr.created_at AS "createdAt",
        oi.product_name AS "productName",
        oi.color,
        oi.size,
        oi.unit_price AS "unitPrice"
      FROM return_requests rr
      JOIN order_items oi ON oi.id = rr.order_item_id
      ${whereSql}
      ORDER BY rr.created_at DESC;
    `);

    res.json({
      success: true,
      data: rows,
      items: rows,
      total: rows.length,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Lỗi tải danh sách yêu cầu đổi trả',
      error: err.message,
    });
  }
});

/**
 * 3. CHI TIẾT YÊU CẦU ĐỔI TRẢ (GET /api/returns/:id)
 * - Chỉ chủ yêu cầu hoặc Admin được xem; người khác trả về 404
 */
returnsRouter.get('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const returnId = req.params.id;
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    const rows = await queryRows<any>(sql`
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
        rr.new_variant_id AS "newVariantId",
        rr.image_proof_urls AS "imageProofUrls",
        rr.status,
        rr.rejection_reason AS "rejectionReason",
        rr.created_at AS "createdAt",
        oi.product_name AS "productName",
        oi.color,
        oi.size,
        oi.unit_price AS "unitPrice",
        o.status AS "orderStatus",
        o.delivered_at AS "deliveredAt"
      FROM return_requests rr
      JOIN order_items oi ON oi.id = rr.order_item_id
      JOIN orders o ON o.id = rr.order_id
      WHERE rr.id = ${returnId}::uuid
      LIMIT 1;
    `);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy yêu cầu đổi trả',
      });
    }

    const item = rows[0];
    if (!isAdmin && item.userId !== userId) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy yêu cầu đổi trả',
      });
    }

    res.json({
      success: true,
      data: item,
      request: item,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Lỗi tải chi tiết yêu cầu đổi trả',
      error: err.message,
    });
  }
});
