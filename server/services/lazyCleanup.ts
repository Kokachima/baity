import { withTransaction } from '../db/index.ts';
import { sql } from 'drizzle-orm';
import { PAYMENT_STATUS } from '../../shared/contracts.ts';
import {
  cancelOrderTransactional,
  transitionOrderStatus,
} from './orderStateMachine.ts';
import { getStoreShippingSettings } from './pricing.ts';

export { cancelOrderTransactional };

export interface LazyCleanupResult {
  cancelledOrders: string[];
  completedOrders: string[];
}

/**
 * Cơ chế Lazy Cleanup Scoped & Cron Cleanup:
 * - Khi truyền userId hoặc orderId: chỉ kiểm tra đúng phạm vi của user/đơn hàng đó (tuyệt đối không quét toàn bảng ở mỗi request thông thường).
 * - Khi gọi từ cron-cleanup (all = true): quét các đơn quá hạn toàn hệ thống.
 * - Mọi thao tác hủy đơn quá hạn 30 phút và tự hoàn tất đơn sau returnDaysLimit ngày đều đi qua transitionOrderStatus trong orderStateMachine.ts.
 */
export async function runScopedLazyCleanup(options: {
  userId?: string;
  orderId?: string;
  all?: boolean;
}): Promise<LazyCleanupResult> {
  const { userId, orderId, all = false } = options;
  if (!userId && !orderId && !all) {
    return { cancelledOrders: [], completedOrders: [] };
  }

  return await withTransaction(async (txQueryRows) => {
    const cancelledOrders: string[] = [];
    const completedOrders: string[] = [];

    // 1. Tìm các đơn pending quá 30 phút trong phạm vi được chỉ định
    // Đơn COD KHÔNG bị tự hủy sau 30 phút. Chỉ các đơn thanh toán điện tử/VietQR đang chờ thanh toán (status = 'pending') mới hết hạn.
    // Đơn đã được xác nhận thanh toán (orders.status = 'confirmed' hoặc payments.status = 'paid') KHÔNG bao giờ bị tự hủy.
    const scopeConditions = [
      sql`o.status = 'pending'`,
      sql`o.created_at < NOW() - INTERVAL '30 minutes'`,
      sql`EXISTS (SELECT 1 FROM payments pm WHERE pm.order_id = o.id AND pm.method != 'cod' AND pm.status = ${PAYMENT_STATUS.PENDING})`,
    ];
    if (orderId) {
      scopeConditions.push(sql`o.id = ${orderId}`);
    }
    if (userId) {
      scopeConditions.push(sql`o.user_id = ${userId}::uuid`);
    }

    const whereExpired = sql.join(scopeConditions, sql` AND `);

    const expiredCandidates = await txQueryRows<{ id: string }>(sql`
      SELECT o.id
      FROM orders o
      WHERE ${whereExpired}
      FOR UPDATE;
    `);

    for (const candidate of expiredCandidates) {
      try {
        const res = await transitionOrderStatus({
          orderId: candidate.id,
          newStatus: 'cancelled',
          expectedStatus: 'pending',
          changedBy: 'system',
          isAdmin: true,
          reason: 'Hết hạn thanh toán VietQR (30 phút)',
          note: 'Hệ thống tự động hủy đơn, hoàn kho và hoàn voucher do quá hạn thanh toán 30 phút',
          txQueryRows,
        });
        if (res.changed) {
          cancelledOrders.push(candidate.id);
        }
      } catch {
        // Nếu đơn đã chuyển trạng thái bởi tiến trình khác thì bỏ qua
      }
    }

    // 2. Tự động chuyển các đơn delivered quá returnDaysLimit ngày sang completed trong phạm vi được chỉ định
    const storeShippingSettings = await getStoreShippingSettings(txQueryRows);
    const completionDays = Math.max(storeShippingSettings.returnDaysLimit, 1);
    const deliveredConditions = [
      sql`status = 'delivered'`,
      sql`delivered_at < NOW() - (${completionDays} * INTERVAL '1 day')`,
    ];
    if (orderId) {
      deliveredConditions.push(sql`id = ${orderId}`);
    }
    if (userId) {
      deliveredConditions.push(sql`user_id = ${userId}::uuid`);
    }

    const whereDelivered = sql.join(deliveredConditions, sql` AND `);

    const deliveredCandidates = await txQueryRows<{ id: string; delivered_at: string | null }>(sql`
      SELECT id, delivered_at
      FROM orders
      WHERE ${whereDelivered}
      FOR UPDATE;
    `);

    for (const comp of deliveredCandidates) {
      try {
        if (comp.delivered_at && storeShippingSettings.returnPolicyChangedAt) {
          const deliveredMs = new Date(comp.delivered_at).getTime();
          const changedMs = new Date(storeShippingSettings.returnPolicyChangedAt).getTime();
          if (!Number.isNaN(changedMs) && deliveredMs < changedMs) {
            const grandfatheredDays = Math.max(
              storeShippingSettings.returnDaysLimit,
              storeShippingSettings.previousReturnDaysLimit || 7,
              7
            );
            const diffDays = (Date.now() - deliveredMs) / (1000 * 60 * 60 * 24);
            if (diffDays <= grandfatheredDays) {
              continue;
            }
          }
        }
        const res = await transitionOrderStatus({
          orderId: comp.id,
          newStatus: 'completed',
          expectedStatus: 'delivered',
          changedBy: 'system',
          isAdmin: true,
          note: `Hệ thống tự động hoàn tất đơn hàng sau ${completionDays} ngày giao thành công`,
          txQueryRows,
        });
        if (res.changed) {
          completedOrders.push(comp.id);
        }
      } catch {
        // Bỏ qua nếu đã chuyển trạng thái
      }
    }

    return { cancelledOrders, completedOrders };
  });
}
