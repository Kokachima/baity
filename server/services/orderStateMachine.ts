import { queryRows, withTransaction } from '../db/index.ts';
import { sql } from 'drizzle-orm';
import { PAYMENT_STATUS } from '../../shared/contracts.ts';

/**
 * Bảng các chuyển trạng thái hợp lệ của đơn hàng (Single Source of Truth)
 * Áp dụng thống nhất cho cả Khách hàng, Admin, Webhook và Hệ thống Cron
 */
export const VALID_ORDER_TRANSITIONS: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['shipping', 'cancelled'],
  shipping: ['delivered'],
  delivered: ['completed', 'return_requested'],
  return_requested: ['completed'],
  completed: [],
  cancelled: [],
};

export const TRACKING_CODE_REGEX = /^[A-Za-z0-9-]+$/;
export const MAX_TRACKING_CODE_LENGTH = 64;

export interface AdminAuditLogPayload {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
}

export interface TransitionOrderParams {
  orderId: string;
  newStatus: string;
  expectedStatus?: string;
  trackingCode?: string;
  changedBy: 'customer' | 'admin' | 'system' | 'webhook';
  note?: string;
  reason?: string;
  requestingUserId?: string;
  isAdmin?: boolean;
  auditLog?: AdminAuditLogPayload;
  txQueryRows?: <R = any>(sqlQuery: any) => Promise<R[]>;
}

export async function insertAdminAuditLogInTx(
  txQueryRows: <R = any>(sqlQuery: any) => Promise<R[]>,
  log: AdminAuditLogPayload
): Promise<{ id: string; createdAt: string }> {
  const rows = await txQueryRows<{ id: string; created_at: string }>(sql`
    INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, summary)
    VALUES (
      ${log.adminId}::uuid,
      ${log.action},
      ${log.targetType},
      ${log.targetId},
      ${log.summary}
    )
    RETURNING id, created_at;
  `);
  return {
    id: rows[0]?.id,
    createdAt: rows[0]?.created_at,
  };
}

/**
 * Hủy đơn hàng khi chưa giao (pending, confirmed, processing),
 * hoàn lại tồn kho, ghi stock_movements và hoàn lại lượt dùng voucher trong cùng một Transaction ACID.
 * Nếu đơn hàng đã được thanh toán (payments.status = 'paid'), tự động chuyển payment sang 'refund_needed'
 * và tạo bản ghi return_requests (type = 'refund', status = 'pending').
 */
export async function cancelOrderTransactional(params: {
  orderId: string;
  requestingUserId: string;
  isAdmin: boolean;
  reason?: string;
  note?: string;
  changedBy?: 'customer' | 'admin' | 'system' | 'webhook';
  expectedStatus?: string;
  txQueryRows?: <R = any>(sqlQuery: any) => Promise<R[]>;
}): Promise<{
  orderId: string;
  previousStatus: string;
  status: string;
  cancelReason: string;
  refundRequested?: boolean;
  restoredItems: { variantId: string; quantity: number }[];
  restoredVoucherIds: string[];
}> {
  const {
    orderId,
    requestingUserId,
    isAdmin,
    reason,
    note,
    changedBy,
    expectedStatus,
    txQueryRows: externalTx,
  } = params;
  const cancelReason = (reason && reason.trim()) || '';
  if (!cancelReason || cancelReason.length < 2) {
    const err: any = new Error('Vui lòng cung cấp lý do hủy đơn hàng');
    err.statusCode = 400;
    throw err;
  }

  const runCancel = async (txQueryRows: <R = any>(sqlQuery: any) => Promise<R[]>) => {
    const orderRows = await txQueryRows<{
      id: string;
      user_id: string;
      status: string;
    }>(sql`
      SELECT id, user_id, status
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

    // Kiểm tra quyền sở hữu đơn hàng
    if (!isAdmin && changedBy !== 'system' && order.user_id !== requestingUserId) {
      const err: any = new Error('Bạn không có quyền truy cập hoặc hủy đơn hàng của người khác');
      err.statusCode = 403;
      throw err;
    }

    if (expectedStatus && order.status !== expectedStatus) {
      const err: any = new Error(
        `Trạng thái đơn hàng đã thay đổi bởi thao tác khác (hiện tại: "${order.status}", kỳ vọng: "${expectedStatus}").`
      );
      err.statusCode = 409;
      err.code = 'ORDER_STATUS_CONFLICT';
      throw err;
    }

    if (order.status === 'cancelled') {
      const err: any = new Error('Đơn hàng này đã được hủy trước đó');
      err.statusCode = expectedStatus ? 409 : 400;
      throw err;
    }

    // Chỉ cho phép hủy khi đơn hàng chưa bàn giao vận chuyển
    const cancellableStatuses = ['pending', 'confirmed', 'processing'];
    if (!cancellableStatuses.includes(order.status)) {
      const err: any = new Error(
        `Không thể hủy đơn hàng đang ở trạng thái "${order.status}". Chỉ có thể hủy đơn khi chưa giao cho đơn vị vận chuyển.`
      );
      err.statusCode = 400;
      throw err;
    }

    const expectedCurrentStatus = expectedStatus || order.status;

    // Cập nhật có điều kiện nguyên tử trên orders.status để chống race condition gọi hủy 2 lần cùng lúc
    const updatedOrder = await txQueryRows<{ id: string }>(sql`
      UPDATE orders
      SET status = 'cancelled',
          cancel_reason = ${cancelReason}
      WHERE id = ${orderId}
        AND status = ${expectedCurrentStatus}
        AND status IN ('pending', 'confirmed', 'processing')
      RETURNING id;
    `);

    if (updatedOrder.length === 0) {
      const err: any = new Error('Đơn hàng không thể hủy hoặc đã thay đổi trạng thái bởi người khác');
      err.statusCode = 409;
      err.code = 'ORDER_STATUS_CONFLICT';
      throw err;
    }

    // 1. Hoàn lại tồn kho cho từng biến thể trong order_items
    const items = await txQueryRows<{ variant_id: string; quantity: number }>(sql`
      SELECT variant_id, quantity
      FROM order_items
      WHERE order_id = ${orderId};
    `);

    const restoredItems: { variantId: string; quantity: number }[] = [];
    for (const item of items) {
      await txQueryRows(sql`
        UPDATE product_variants
        SET stock_quantity = stock_quantity + ${item.quantity}
        WHERE id = ${item.variant_id}::uuid;
      `);

      await txQueryRows(sql`
        INSERT INTO stock_movements (variant_id, delta_quantity, reason, reference_id)
        VALUES (${item.variant_id}::uuid, ${item.quantity}, 'order_cancelled', ${orderId});
      `);

      restoredItems.push({ variantId: item.variant_id, quantity: item.quantity });
    }

    // 2. Hoàn lại lượt dùng voucher (nếu đơn có dùng voucher)
    const deletedUsages = await txQueryRows<{ voucher_id: string }>(sql`
      DELETE FROM voucher_usages
      WHERE order_id = ${orderId}
      RETURNING voucher_id;
    `);

    const restoredVoucherIds: string[] = [];
    for (const usage of deletedUsages) {
      await txQueryRows(sql`
        UPDATE vouchers
        SET used_count = GREATEST(used_count - 1, 0)
        WHERE id = ${usage.voucher_id}::uuid;
      `);
      restoredVoucherIds.push(usage.voucher_id);
    }

    // 3. Cập nhật trạng thái thanh toán và tạo yêu cầu hoàn tiền nếu đã thanh toán (status = 'paid')
    const paymentRows = await txQueryRows<{ id: string; method: string; status: string }>(sql`
      SELECT id, method, status FROM payments WHERE order_id = ${orderId} LIMIT 1;
    `);

    const wasPaid =
      paymentRows.length > 0 && paymentRows[0].status === PAYMENT_STATUS.PAID;

    if (wasPaid) {
      await txQueryRows(sql`
        UPDATE payments
        SET paid_at = COALESCE(paid_at, NOW()),
            status = ${PAYMENT_STATUS.REFUND_NEEDED}
        WHERE order_id = ${orderId};
      `);

      // Tự động tạo yêu cầu hoàn tiền trong return_requests kèm số tiền đơn hàng
      const orderDetailRows = await txQueryRows<{ id: string; total_amount: number }>(sql`
        SELECT oi.id, o.total_amount
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE oi.order_id = ${orderId}
        LIMIT 1;
      `);

      if (orderDetailRows.length > 0) {
        await txQueryRows(sql`
          INSERT INTO return_requests (
            order_id,
            user_id,
            order_item_id,
            reason,
            type,
            refund_amount,
            status
          )
          VALUES (
            ${orderId},
            ${order.user_id}::uuid,
            ${orderDetailRows[0].id}::uuid,
            ${`Hủy đơn hàng đã thanh toán: ${cancelReason}`},
            'refund',
            ${Number(orderDetailRows[0].total_amount || 0)},
            'pending'
          );
        `);
      }
    } else {
      await txQueryRows(sql`
        UPDATE payments
        SET paid_at = paid_at,
            status = ${PAYMENT_STATUS.FAILED}
        WHERE order_id = ${orderId} AND status = ${PAYMENT_STATUS.PENDING};
      `);
    }

    // 4. Lưu lịch sử trạng thái đơn hàng
    const statusNote =
      note ||
      (wasPaid
        ? `Đã hủy đơn hàng đã thanh toán. Đã tạo yêu cầu hoàn tiền (refund_needed). Lý do: ${cancelReason}`
        : cancelReason);

    const effectiveChangedBy = changedBy || (isAdmin ? 'admin' : 'customer');

    await txQueryRows(sql`
      INSERT INTO order_status_history (order_id, status, note, changed_by)
      VALUES (
        ${orderId},
        'cancelled',
        ${statusNote},
        ${effectiveChangedBy}
      );
    `);

    return {
      orderId,
      previousStatus: order.status,
      status: 'cancelled',
      cancelReason,
      refundRequested: wasPaid,
      restoredItems,
      restoredVoucherIds,
    };
  };

  if (externalTx) {
    return await runCancel(externalTx);
  }
  return await withTransaction(runCancel);
}

/**
 * Hàm máy trạng thái chuyển đổi trạng thái đơn hàng duy nhất dùng chung
 */
export async function transitionOrderStatus(params: TransitionOrderParams) {
  const {
    orderId,
    newStatus,
    expectedStatus,
    trackingCode,
    changedBy,
    note,
    reason,
    requestingUserId,
    isAdmin = false,
    auditLog,
    txQueryRows: externalTx,
  } = params;

  const executeTransition = async (txQueryRows: <R = any>(sqlQuery: any) => Promise<R[]>) => {
    const orderRows = await txQueryRows<{
      id: string;
      user_id: string;
      status: string;
      tracking_code: string | null;
      delivered_at: string | null;
      completed_at: string | null;
    }>(sql`
      SELECT id, user_id, status, tracking_code, delivered_at, completed_at
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

    // Kiểm tra quyền sở hữu đơn hàng: nếu không phải admin/system/webhook và đơn của người khác -> 404 (không lộ mã đơn)
    if (!isAdmin && changedBy === 'customer') {
      if (requestingUserId && order.user_id !== requestingUserId) {
        const err: any = new Error('Không tìm thấy đơn hàng');
        err.statusCode = 404;
        throw err;
      }

      // Khách hàng chỉ được phép Hủy đơn (cancelled) hoặc Yêu cầu đổi trả (return_requested)
      const customerAllowedTargets = ['cancelled', 'return_requested'];
      if (!customerAllowedTargets.includes(newStatus)) {
        const err: any = new Error(
          `Khách hàng không có quyền chuyển trạng thái đơn sang "${newStatus}". Khách chỉ được phép hủy đơn hoặc yêu cầu đổi trả.`
        );
        err.statusCode = 403;
        throw err;
      }
    }

    // Kiểm tra expectedStatus (chống ghi đè đồng thời - Optimistic Concurrency Control)
    if (expectedStatus !== undefined) {
      const normalizedExpected = String(expectedStatus).trim();
      if (!normalizedExpected || order.status !== normalizedExpected) {
        const err: any = new Error(
          `Trạng thái đơn hàng đã thay đổi bởi người khác (hiện tại: "${order.status}", kỳ vọng: "${normalizedExpected}"). Vui lòng tải lại đơn hàng.`
        );
        err.statusCode = 409;
        err.code = 'ORDER_STATUS_CONFLICT';
        throw err;
      }
    }

    // Nếu trạng thái đích trùng trạng thái hiện tại (và không bị bắt lỗi expectedStatus)
    if (order.status === newStatus) {
      return {
        orderId,
        previousStatus: order.status,
        currentStatus: order.status,
        changed: false,
      };
    }

    // Kiểm tra tính hợp lệ của luồng chuyển trạng thái
    const allowedTargets = VALID_ORDER_TRANSITIONS[order.status] || [];
    if (!allowedTargets.includes(newStatus)) {
      const err: any = new Error(
        `Không thể chuyển trạng thái đơn hàng từ "${order.status}" sang "${newStatus}". Luồng chuyển trạng thái không hợp lệ.`
      );
      err.statusCode = 400;
      throw err;
    }

    // Nếu chuyển sang 'shipping', kiểm tra trackingCode khi được truyền hoặc khi thao tác qua Admin API (có auditLog)
    let cleanedTrackingCode: string | null = null;
    if (newStatus === 'shipping') {
      if (trackingCode !== undefined || auditLog !== undefined) {
        const rawTracking = typeof trackingCode === 'string' ? trackingCode.trim() : '';
        if (!rawTracking) {
          const err: any = new Error(
            'Vui lòng cung cấp mã vận đơn (trackingCode) khi chuyển đơn sang trạng thái đang giao hàng (shipping)'
          );
          err.statusCode = 400;
          err.code = 'MISSING_TRACKING_CODE';
          throw err;
        }
        if (
          rawTracking.length > MAX_TRACKING_CODE_LENGTH ||
          !TRACKING_CODE_REGEX.test(rawTracking)
        ) {
          const err: any = new Error(
            `Mã vận đơn (trackingCode) chỉ gồm chữ cái, chữ số hoặc dấu gạch ngang (-) và tối đa ${MAX_TRACKING_CODE_LENGTH} ký tự`
          );
          err.statusCode = 400;
          err.code = 'INVALID_TRACKING_CODE';
          throw err;
        }
        cleanedTrackingCode = rawTracking;
      }
    }

    // Nếu là thao tác hủy đơn -> tái sử dụng logic hoàn kho, hoàn voucher chuẩn TRONG CÙNG GIAO DỊCH
    if (newStatus === 'cancelled') {
      const cancelResult = await cancelOrderTransactional({
        orderId,
        requestingUserId: requestingUserId || order.user_id,
        isAdmin: isAdmin || changedBy === 'system',
        changedBy,
        reason: isAdmin || changedBy === 'system' ? reason || note : reason || note || 'Khách hàng hủy đơn hàng',
        note,
        expectedStatus: expectedStatus || order.status,
        txQueryRows,
      });

      let auditLogResult: { id: string; createdAt: string } | undefined;
      if (auditLog) {
        auditLogResult = await insertAdminAuditLogInTx(txQueryRows, auditLog);
      }

      return {
        orderId,
        previousStatus: order.status,
        currentStatus: 'cancelled',
        changed: true,
        cancelResult,
        auditLogId: auditLogResult?.id,
      };
    }

    const expectedCurrentStatus = expectedStatus || order.status;

    // Cập nhật trạng thái có điều kiện WHERE id = ... AND status = expectedStatus
    let updateSql = sql`
      UPDATE orders
      SET status = ${newStatus}
      WHERE id = ${orderId}
        AND status = ${expectedCurrentStatus}
      RETURNING id, status, tracking_code, delivered_at, completed_at;
    `;

    if (newStatus === 'shipping' && cleanedTrackingCode) {
      updateSql = sql`
        UPDATE orders
        SET status = 'shipping',
            tracking_code = ${cleanedTrackingCode}
        WHERE id = ${orderId}
          AND status = ${expectedCurrentStatus}
        RETURNING id, status, tracking_code, delivered_at, completed_at;
      `;
    } else if (newStatus === 'delivered') {
      updateSql = sql`
        UPDATE orders
        SET status = 'delivered',
            delivered_at = COALESCE(delivered_at, NOW())
        WHERE id = ${orderId}
          AND status = ${expectedCurrentStatus}
        RETURNING id, status, tracking_code, delivered_at, completed_at;
      `;
    } else if (newStatus === 'completed') {
      updateSql = sql`
        UPDATE orders
        SET status = 'completed',
            completed_at = COALESCE(completed_at, NOW())
        WHERE id = ${orderId}
          AND status = ${expectedCurrentStatus}
        RETURNING id, status, tracking_code, delivered_at, completed_at;
      `;
    }

    const updatedRows = await txQueryRows<{
      id: string;
      status: string;
      tracking_code: string | null;
      delivered_at: string | null;
      completed_at: string | null;
    }>(updateSql);

    if (updatedRows.length === 0) {
      const err: any = new Error(
        `Trạng thái đơn hàng đã thay đổi bởi thao tác khác. Vui lòng tải lại đơn hàng.`
      );
      err.statusCode = 409;
      err.code = 'ORDER_STATUS_CONFLICT';
      throw err;
    }

    const historyNote =
      note ||
      reason ||
      (newStatus === 'shipping' && cleanedTrackingCode
        ? `Đơn hàng đã bàn giao đơn vị vận chuyển (Mã vận đơn: ${cleanedTrackingCode})`
        : newStatus === 'delivered'
        ? 'Đơn hàng đã được giao thành công tới người nhận'
        : newStatus === 'completed'
        ? 'Đơn hàng đã hoàn tất thành công'
        : `Chuyển trạng thái đơn hàng sang "${newStatus}"`);

    await txQueryRows(sql`
      INSERT INTO order_status_history (order_id, status, note, changed_by, created_at)
      VALUES (
        ${orderId},
        ${newStatus},
        ${historyNote},
        ${changedBy},
        NOW()
      );
    `);

    let auditLogResult: { id: string; createdAt: string } | undefined;
    if (auditLog) {
      auditLogResult = await insertAdminAuditLogInTx(txQueryRows, auditLog);
    }

    return {
      orderId,
      previousStatus: order.status,
      currentStatus: newStatus,
      changed: true,
      trackingCode: updatedRows[0]?.tracking_code,
      deliveredAt: updatedRows[0]?.delivered_at,
      completedAt: updatedRows[0]?.completed_at,
      auditLogId: auditLogResult?.id,
    };
  };

  if (externalTx) {
    return await executeTransition(externalTx);
  }
  return await withTransaction(executeTransition);
}

/**
 * Tự động hoàn tất các đơn hàng đã delivered quá 7 ngày
 * Dùng cho cả Lazy Cleanup khi user/admin query và Cron Cleanup Job
 */
export async function autoCompleteDeliveredOrders(
  runQuery: <R = any>(sqlQuery: any) => Promise<R[]> = queryRows
): Promise<string[]> {
  try {
    const expiredRows = await runQuery<{ id: string }>(sql`
      SELECT id
      FROM orders
      WHERE status = 'delivered'
        AND delivered_at IS NOT NULL
        AND delivered_at <= NOW() - INTERVAL '7 days'
      FOR UPDATE SKIP LOCKED;
    `);

    const completedIds: string[] = [];
    for (const row of expiredRows) {
      try {
        await transitionOrderStatus({
          orderId: row.id,
          newStatus: 'completed',
          changedBy: 'system',
          note: 'Đơn hàng tự động hoàn tất sau 7 ngày giao hàng thành công (hết hạn đổi trả/khiếu nại)',
        });
        completedIds.push(row.id);
      } catch (e: any) {
        console.error(`Lỗi tự động hoàn tất đơn ${row.id}:`, e.message);
      }
    }

    return completedIds;
  } catch {
    return [];
  }
}
