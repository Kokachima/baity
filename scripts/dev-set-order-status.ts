import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { queryRows, closeDb } from '../server/db/index.ts';
import {
  VALID_ORDER_TRANSITIONS,
  transitionOrderStatus,
} from '../server/services/orderStateMachine.ts';
import { isStrictRuntimeMode } from '../server/config/runtimeMode.ts';

export interface DevSetOrderStatusOptions {
  orderId: string;
  targetStatus: string;
  env?: NodeJS.ProcessEnv;
}

export function extractDatabaseHost(rawUrl: string | undefined): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return 'pglite://memory (in-memory dev/test)';
  try {
    const parsed = new URL(trimmed);
    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  } catch {
    return 'unknown-host';
  }
}

export function assertDevOnlyEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const isStrict = isStrictRuntimeMode(env);
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();

  if (isStrict || nodeEnv === 'production') {
    const err: any = new Error(
      'TỪ CHỐI CHẠY: Công cụ dev:set-order-status chỉ được phép chạy ở môi trường phát triển.'
    );
    err.code = 'DEV_TOOL_FORBIDDEN_IN_PRODUCTION';
    throw err;
  }

  const allowDevTools = String(env.ALLOW_DEV_TOOLS || '').trim();
  if (allowDevTools !== 'true') {
    const err: any = new Error(
      'TỪ CHỐI CHẠY: Bắt buộc truyền biến ALLOW_DEV_TOOLS=true trực tiếp khi gọi lệnh (ví dụ: ALLOW_DEV_TOOLS=true npm run dev:set-order-status -- <mã đơn> <trạng thái>). Không lưu ALLOW_DEV_TOOLS vào Secrets.'
    );
    err.code = 'ALLOW_DEV_TOOLS_REQUIRED';
    throw err;
  }
}

/**
 * Tìm đường đi ngắn nhất hợp lệ trên đồ thị máy trạng thái VALID_ORDER_TRANSITIONS
 * từ currentStatus sang targetStatus để ghi đầy đủ lịch sử từng bước (order_status_history)
 * và mốc thời gian delivered_at / completed_at.
 */
export function findValidTransitionPath(currentStatus: string, targetStatus: string): string[] | null {
  if (currentStatus === targetStatus) return [];
  if (!(currentStatus in VALID_ORDER_TRANSITIONS) || !(targetStatus in VALID_ORDER_TRANSITIONS)) {
    return null;
  }

  const queue: { state: string; path: string[] }[] = [{ state: currentStatus, path: [] }];
  const visited = new Set<string>([currentStatus]);

  while (queue.length > 0) {
    const { state, path } = queue.shift()!;
    const neighbors = VALID_ORDER_TRANSITIONS[state] || [];
    for (const next of neighbors) {
      const nextPath = [...path, next];
      if (next === targetStatus) {
        return nextPath;
      }
      if (!visited.has(next)) {
        visited.add(next);
        queue.push({ state: next, path: nextPath });
      }
    }
  }

  return null;
}

/**
 * Thực thi chuyển trạng thái đơn hàng dành riêng cho môi trường dev.
 * Tuyệt đối không truy vấn hay in ra thông tin cá nhân (tên, SĐT, email, địa chỉ).
 */
export async function runDevSetOrderStatus(options: DevSetOrderStatusOptions) {
  const env = options.env || process.env;
  assertDevOnlyEnvironment(env);

  const dbHost = extractDatabaseHost(env.DATABASE_URL);
  console.warn(
    `⚠️ [DEV-SET-ORDER-STATUS WARNING] Đang tác động trực tiếp lên database host: ${dbHost}`
  );

  const orderId = String(options.orderId || '').trim().toUpperCase();
  const targetStatus = String(options.targetStatus || '').trim().toLowerCase();

  if (!orderId || !targetStatus) {
    const err: any = new Error(
      'Thiếu tham số. Cú pháp: npm run dev:set-order-status -- <mã đơn> <trạng thái>'
    );
    err.code = 'INVALID_ARGS';
    throw err;
  }

  if (!(targetStatus in VALID_ORDER_TRANSITIONS)) {
    const allowed = Object.keys(VALID_ORDER_TRANSITIONS).join(', ');
    const err: any = new Error(
      `Trạng thái đích "${targetStatus}" không tồn tại trong máy trạng thái (chỉ chấp nhận: ${allowed}).`
    );
    err.code = 'INVALID_TARGET_STATUS';
    throw err;
  }

  // Chỉ đọc id, status, delivered_at, completed_at — tuyệt đối không đọc PII (receiver_name, receiver_phone, shipping_address)
  const orderRows = await queryRows<{
    id: string;
    status: string;
    delivered_at: string | null;
    completed_at: string | null;
  }>(sql`
    SELECT id, status, delivered_at, completed_at
    FROM orders
    WHERE id = ${orderId}
    LIMIT 1;
  `);

  if (orderRows.length === 0) {
    const err: any = new Error(`Không tìm thấy đơn hàng có mã "${orderId}".`);
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  }

  const initialStatus = orderRows[0].status;
  if (initialStatus === targetStatus) {
    return {
      orderId,
      previousStatus: initialStatus,
      currentStatus: initialStatus,
      steps: [] as string[],
      changed: false,
      deliveredAt: orderRows[0].delivered_at,
      completedAt: orderRows[0].completed_at,
    };
  }

  const transitionSteps = findValidTransitionPath(initialStatus, targetStatus);
  if (!transitionSteps || transitionSteps.length === 0) {
    const err: any = new Error(
      `Không thể chuyển trạng thái đơn "${orderId}" từ "${initialStatus}" sang "${targetStatus}" theo máy trạng thái.`
    );
    err.code = 'INVALID_STATE_TRANSITION';
    throw err;
  }

  let lastResult: any = null;
  for (const stepStatus of transitionSteps) {
    lastResult = await transitionOrderStatus({
      orderId,
      newStatus: stepStatus,
      changedBy: 'admin',
      isAdmin: true,
      note:
        stepStatus === 'delivered'
          ? '[DEV CLI] Đơn hàng đã được giao thành công tới người nhận'
          : `[DEV CLI] Chuyển trạng thái đơn hàng sang "${stepStatus}"`,
    });
  }

  return {
    orderId,
    previousStatus: initialStatus,
    currentStatus: lastResult?.currentStatus || targetStatus,
    steps: transitionSteps,
    changed: true,
    deliveredAt: lastResult?.deliveredAt || null,
    completedAt: lastResult?.completedAt || null,
  };
}

async function main() {
  try {
    const args = process.argv.slice(2).filter((arg) => arg !== '--');
    const [orderId, targetStatus] = args;
    const result = await runDevSetOrderStatus({
      orderId: orderId || '',
      targetStatus: targetStatus || '',
    });

    console.log(
      JSON.stringify({
        success: true,
        orderId: result.orderId,
        previousStatus: result.previousStatus,
        steps: result.steps,
        currentStatus: result.currentStatus,
        changed: result.changed,
        deliveredAt: result.deliveredAt,
        completedAt: result.completedAt,
      })
    );
  } catch (err: any) {
    console.error(`[DEV-SET-ORDER-STATUS ERROR] ${err?.code || 'ERROR'}: ${err?.message || 'Unknown error'}`);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('dev-set-order-status.ts') ||
    process.argv[1].endsWith('dev-set-order-status.js'));

if (isDirectRun) {
  main();
}
