import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';

// Chạy trên PGlite in-memory cô lập
process.env.DATABASE_URL = '';
process.env.PGLITE_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.COOKIE_CROSS_SITE = 'false';
process.env.JWT_SECRET = 'test-secret-stage8a-admin-key-2026-secure';
process.env.ENABLE_DEMO_PAYMENT_WEBHOOK = 'true';
process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret-stage8a-2026';

import { createApp } from '../server/app.ts';
import { initDatabase } from '../server/db/init.ts';
import { queryRows, withTransaction, closeDb } from '../server/db/index.ts';
import { seedDatabase } from '../server/db/seed.ts';
import { generateToken, AUTH_COOKIE_NAME } from '../server/services/auth.ts';
import { insertAdminAuditLogInTx } from '../server/services/orderStateMachine.ts';
import { createWebhookSignature } from '../server/services/vietqr.ts';
import { runScopedLazyCleanup } from '../server/services/lazyCleanup.ts';

let server: http.Server;
let baseUrl = '';
let adminAId = '';
let adminAToken = '';
let customerId = '';
let customerToken = '';
let testVariantId = '';

const ADMIN_ENDPOINTS: { method: string; path: string }[] = [
  { method: 'GET', path: '/api/admin/me' },
  { method: 'GET', path: '/api/admin/audit-logs' },
  { method: 'GET', path: '/api/admin/orders' },
  { method: 'GET', path: '/api/admin/orders/BAITY-TEST' },
  { method: 'PUT', path: '/api/admin/orders/BAITY-TEST/status' },
  { method: 'POST', path: '/api/admin/orders/BAITY-TEST/confirm-payment' },
  { method: 'GET', path: '/api/admin/returns' },
  { method: 'PUT', path: '/api/admin/returns/00000000-0000-0000-0000-000000000001/decision' },
  { method: 'POST', path: '/api/admin/returns/00000000-0000-0000-0000-000000000001/receive' },
  { method: 'POST', path: '/api/admin/returns/00000000-0000-0000-0000-000000000001/refund' },
  { method: 'GET', path: '/api/admin/payment-issues' },
  {
    method: 'POST',
    path: '/api/admin/payment-issues/payment_event/00000000-0000-0000-0000-000000000001/resolve',
  },
];

before(async () => {
  await initDatabase();
  await seedDatabase();

  const adminARows = await queryRows<{ id: string }>(sql`
    INSERT INTO users (email, password_hash, full_name, phone, role)
    VALUES ('admin-a-8a@baity.vn', 'hash_admin_a', 'Admin Một', '0909000111', 'admin')
    RETURNING id;
  `);
  adminAId = adminARows[0].id;
  adminAToken = generateToken({
    id: adminAId,
    email: 'admin-a-8a@baity.vn',
    role: 'admin',
  });

  const custRows = await queryRows<{ id: string }>(sql`
    INSERT INTO users (email, password_hash, full_name, phone, role)
    VALUES ('customer-8a@baity.vn', 'hash_cust', 'Khách Hàng 8A', '0912888999', 'customer')
    RETURNING id;
  `);
  customerId = custRows[0].id;
  customerToken = generateToken({
    id: customerId,
    email: 'customer-8a@baity.vn',
    role: 'customer',
  });

  const varRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM product_variants LIMIT 1;
  `);
  testVariantId = varRows[0].id;

  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await closeDb();
});

// ============================================================================
// NHÓM 8a.1: BẢO VỆ ROUTE /api/admin/* (MỖI QUY TẮC 1 TEST RIÊNG)
// ============================================================================
test('Bước 8a.1a: Khách chưa đăng nhập gọi bất kỳ route /api/admin/* nào đều nhận HTTP 401', async () => {
  for (const ep of ADMIN_ENDPOINTS) {
    const res = await fetch(`${baseUrl}${ep.path}`, {
      method: ep.method,
      headers: { 'Content-Type': 'application/json' },
      body: ep.method !== 'GET' ? JSON.stringify({}) : undefined,
    });
    assert.equal(res.status, 401, `Chưa đăng nhập gọi ${ep.method} ${ep.path} phải nhận 401`);
  }
});

test('Bước 8a.1b: Khách hàng thường (role=customer) gọi bất kỳ route /api/admin/* nào đều nhận HTTP 403', async () => {
  for (const ep of ADMIN_ENDPOINTS) {
    const res = await fetch(`${baseUrl}${ep.path}`, {
      method: ep.method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${customerToken}`,
      },
      body: ep.method !== 'GET' ? JSON.stringify({}) : undefined,
    });
    assert.equal(res.status, 403, `Khách thường gọi ${ep.method} ${ep.path} phải nhận 403`);
  }
});

test('Bước 8a.1c: Tài khoản Admin (role=admin) gọi GET /api/admin/me nhận HTTP 200 kèm số liệu tổng quan', async () => {
  const res = await fetch(`${baseUrl}/api/admin/me`, {
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.admin.role, 'admin');
});

// ============================================================================
// NHÓM 8a.2: CHỐNG TỰ NÂNG QUYỀN ROLE (MỖI QUY TẮC 1 TEST RIÊNG)
// ============================================================================
test('Bước 8a.2a: Toàn bộ file route trong server/routes/*.ts không có câu lệnh UPDATE users thay đổi cột role', async () => {
  const routesDir = path.resolve(process.cwd(), 'server/routes');
  const routeFiles = fs.readdirSync(routesDir).filter((f) => f.endsWith('.ts'));

  for (const file of routeFiles) {
    const content = fs.readFileSync(path.join(routesDir, file), 'utf-8');
    const updateRoleRegex = /UPDATE\s+users[\s\S]{0,250}?\brole\s*=/i;
    assert.equal(
      updateRoleRegex.test(content),
      false,
      `File route ${file} tuyệt đối không được phép có lệnh UPDATE users thay đổi cột role`
    );
  }
});

test('Bước 8a.2b: Người dùng gửi role="admin" qua PUT /api/user/profile không thể tự nâng quyền trong DB', async () => {
  const updateRes = await fetch(`${baseUrl}/api/user/profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${customerToken}`,
    },
    body: JSON.stringify({
      fullName: 'Khách Thử Nâng Quyền',
      phone: '0912888999',
      role: 'admin',
    }),
  });
  assert.equal(updateRes.status, 200);

  const checkRows = await queryRows<{ role: string }>(sql`
    SELECT role FROM users WHERE id = ${customerId}::uuid;
  `);
  assert.equal(checkRows[0].role, 'customer');
});

// ============================================================================
// NHÓM 8a.3: ĐỌC ĐƠN HÀNG, ẨN PII, LỌC NGÀY/SĐT VÀ CHUYỂN TRẠNG THÁI (MỖI QUY TẮC 1 TEST RIÊNG)
// ============================================================================
test('Bước 8a.3a: GET /api/admin/orders ẩn PII (receiverName, receiverPhone) trên danh sách nhưng GET /api/admin/orders/:id hiển thị đầy đủ trong chi tiết đơn', async () => {
  const orderId = 'BAITY-8A01';
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status
    ) VALUES (
      ${orderId}, ${customerId}::uuid, 'Phạm Bí Mật PII', '0988777666', '99 Nguyễn Huệ, Q1',
      'standard', 30000, 400000, 0, 430000, 'pending'
    );
  `);
  await queryRows(sql`
    INSERT INTO order_items (order_id, variant_id, product_name, color, size, unit_price, quantity, total_price)
    VALUES (${orderId}, ${testVariantId}::uuid, 'Áo Sơ Mi 8A', 'Trắng', 'L', 400000, 1, 400000);
  `);

  const listRes = await fetch(`${baseUrl}/api/admin/orders?search=0988777666&limit=10`, {
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}` },
  });
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  const foundInList = listBody.items.find((o: any) => o.id === orderId);
  assert.ok(foundInList);
  assert.equal('receiverName' in foundInList, false);
  assert.equal('receiverPhone' in foundInList, false);

  const detailRes = await fetch(`${baseUrl}/api/admin/orders/${orderId}`, {
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}` },
  });
  assert.equal(detailRes.status, 200);
  const detailBody = await detailRes.json();
  assert.equal(detailBody.order.receiverName, 'Phạm Bí Mật PII');
  assert.equal(detailBody.order.receiverPhone, '0988777666');
});

test('Bước 8a.3b (Mục 5b): GET /api/admin/orders hỗ trợ lọc theo khoảng ngày (fromDate, toDate) và tìm kiếm theo 4 số cuối SĐT hoặc tên người nhận mà vẫn giữ ẩn PII', async () => {
  const oldOrderId = 'BAITY-8A-DATEOLD';
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status, created_at
    ) VALUES (
      ${oldOrderId}, ${customerId}::uuid, 'Trần Văn Cổ Điển', '0905112233', '12 Lê Lợi',
      'standard', 30000, 300000, 0, 330000, 'pending', '2024-05-15T10:00:00.000Z'
    );
  `);

  // Tìm theo 4 số cuối SĐT (2233) và khoảng ngày năm 2024
  const searchLast4Res = await fetch(
    `${baseUrl}/api/admin/orders?search=2233&fromDate=2024-05-01&toDate=2024-05-31`,
    {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}` },
    }
  );
  assert.equal(searchLast4Res.status, 200);
  const searchLast4Body = await searchLast4Res.json();
  const found = searchLast4Body.items.find((o: any) => o.id === oldOrderId);
  assert.ok(found, 'Phải tìm thấy đơn hàng theo 4 số cuối SĐT và khoảng ngày');
  assert.equal('receiverName' in found, false, 'Danh sách vẫn ẩn receiverName');
  assert.equal('receiverPhone' in found, false, 'Danh sách vẫn ẩn receiverPhone');

  // Lọc khoảng ngày không khớp -> không trả về đơn cũ đó
  const outRangeRes = await fetch(
    `${baseUrl}/api/admin/orders?search=2233&fromDate=2025-01-01&toDate=2025-12-31`,
    {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}` },
    }
  );
  const outRangeBody = await outRangeRes.json();
  assert.equal(
    outRangeBody.items.some((o: any) => o.id === oldOrderId),
    false,
    'Đơn nằm ngoài khoảng fromDate..toDate phải được lọc bỏ'
  );
});

test('Bước 8a.3c: PUT /api/admin/orders/:id/status kiểm tra expectedStatus và trả HTTP 409 Conflict khi trạng thái hiện tại không khớp', async () => {
  const conflictRes = await fetch(`${baseUrl}/api/admin/orders/BAITY-8A01/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({
      status: 'processing',
      expectedStatus: 'confirmed', // Thực tế BAITY-8A01 đang là 'pending'
    }),
  });
  assert.equal(conflictRes.status, 409);
});

test('Bước 8a.3d: Chuyển trạng thái đơn sang shipping bắt buộc phải có trackingCode hợp lệ (thiếu trả 400, đủ trả 200)', async () => {
  await fetch(`${baseUrl}/api/admin/orders/BAITY-8A01/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({ status: 'confirmed', expectedStatus: 'pending' }),
  });
  await fetch(`${baseUrl}/api/admin/orders/BAITY-8A01/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({ status: 'processing', expectedStatus: 'confirmed' }),
  });

  const missingTrackRes = await fetch(`${baseUrl}/api/admin/orders/BAITY-8A01/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({ status: 'shipping', expectedStatus: 'processing' }),
  });
  assert.equal(missingTrackRes.status, 400);

  const toShippingRes = await fetch(`${baseUrl}/api/admin/orders/BAITY-8A01/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({
      status: 'shipping',
      expectedStatus: 'processing',
      trackingCode: 'GHN-2026-8899',
    }),
  });
  assert.equal(toShippingRes.status, 200);
  const toShippingBody = await toShippingRes.json();
  assert.equal(toShippingBody.trackingCode, 'GHN-2026-8899');
});

test('Bước 8a.3e: Chuyển trạng thái đơn sang delivered tự động ghi nhận delivered_at', async () => {
  const toDeliveredRes = await fetch(`${baseUrl}/api/admin/orders/BAITY-8A01/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({
      status: 'delivered',
      expectedStatus: 'shipping',
    }),
  });
  assert.equal(toDeliveredRes.status, 200);
  const toDeliveredBody = await toDeliveredRes.json();
  assert.ok(toDeliveredBody.deliveredAt);
});

// ============================================================================
// NHÓM 8a.5 & MỤC 2 PHẦN 1: THỐNG NHẤT TRẠNG THÁI THANH TOÁN & VIETQR THỦ CÔNG
// ============================================================================
test('Bước 8a.5a: POST /api/admin/orders/:id/confirm-payment xác nhận thanh toán VietQR thủ công đặt payments.status = "paid" và hoạt động Idempotent khi gọi lặp', async () => {
  const vqrOrderId = 'BAITY-8A-VQR1';
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status
    ) VALUES (
      ${vqrOrderId}, ${customerId}::uuid, 'Khách VietQR', '0933444555', '12 Đồng Khởi',
      'standard', 0, 550000, 0, 550000, 'pending'
    );
  `);
  await queryRows(sql`
    INSERT INTO payments (order_id, method, status)
    VALUES (${vqrOrderId}, 'vietqr', 'pending');
  `);

  const confirm1 = await fetch(`${baseUrl}/api/admin/orders/${vqrOrderId}/confirm-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({ transactionId: 'FT26000111' }),
  });
  assert.equal(confirm1.status, 200);
  const body1 = await confirm1.json();
  assert.equal(body1.idempotent, false);
  assert.equal(body1.orderStatus, 'confirmed');
  assert.equal(body1.paymentStatus, 'paid');

  const confirm2 = await fetch(`${baseUrl}/api/admin/orders/${vqrOrderId}/confirm-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({ transactionId: 'FT26000111' }),
  });
  assert.equal(confirm2.status, 200);
  const body2 = await confirm2.json();
  assert.equal(body2.idempotent, true);
});

test('Bước 8a.5b: POST /api/admin/orders/:id/confirm-payment từ chối đơn đã hủy hoặc quá hạn với HTTP 400 ORDER_EXPIRED_OR_CANCELLED', async () => {
  const cancelledOrderId = 'BAITY-8A-VQRCANCEL';
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status, cancel_reason
    ) VALUES (
      ${cancelledOrderId}, ${customerId}::uuid, 'Khách Hủy', '0933444555', '12 Đồng Khởi',
      'standard', 0, 550000, 0, 550000, 'cancelled', 'Quá hạn 30 phút'
    );
  `);
  await queryRows(sql`
    INSERT INTO payments (order_id, method, status)
    VALUES (${cancelledOrderId}, 'vietqr', 'failed');
  `);

  const rejectRes = await fetch(`${baseUrl}/api/admin/orders/${cancelledOrderId}/confirm-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({}),
  });
  assert.equal(rejectRes.status, 400);
  const rejectBody = await rejectRes.json();
  assert.equal(rejectBody.code, 'ORDER_EXPIRED_OR_CANCELLED');
});

test('Bước 8a.5c (Phần 1 Mục 2.i): Đơn VietQR được Admin xác nhận thanh toán thủ công rồi bị hủy thì tạo đúng yêu cầu hoàn tiền và đặt payments.status = "refund_needed"', async () => {
  const orderId = 'BAITY-8A-MANUAL-CANCEL';
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status
    ) VALUES (
      ${orderId}, ${customerId}::uuid, 'Khách Manual Cancel', '0933444555', '12 Đồng Khởi',
      'standard', 0, 420000, 0, 420000, 'pending'
    );
  `);
  await queryRows(sql`
    INSERT INTO order_items (order_id, variant_id, product_name, color, size, unit_price, quantity, total_price)
    VALUES (${orderId}, ${testVariantId}::uuid, 'Áo VietQR Manual', 'Đen', 'M', 420000, 1, 420000);
  `);
  await queryRows(sql`
    INSERT INTO payments (order_id, method, status)
    VALUES (${orderId}, 'vietqr', 'pending');
  `);

  // 1. Admin xác nhận thanh toán thủ công -> status='confirmed', payments.status='paid'
  const confirmRes = await fetch(`${baseUrl}/api/admin/orders/${orderId}/confirm-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({ transactionId: 'FT-MANUAL-CANCEL-01' }),
  });
  assert.equal(confirmRes.status, 200);

  // 2. Admin hủy đơn hàng đó -> do payments.status = 'paid' nên phải tạo yêu cầu hoàn tiền (return_requests) và chuyển payments.status sang 'refund_needed'
  const cancelRes = await fetch(`${baseUrl}/api/admin/orders/${orderId}/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({
      status: 'cancelled',
      expectedStatus: 'confirmed',
      reason: 'Hết màu khách chọn, hoàn tiền cho khách',
    }),
  });
  assert.equal(cancelRes.status, 200);

  const pmtRows = await queryRows<{ status: string }>(sql`
    SELECT status FROM payments WHERE order_id = ${orderId};
  `);
  assert.equal(pmtRows[0].status, 'refund_needed');

  const retRows = await queryRows<{ refund_amount: number }>(sql`
    SELECT refund_amount FROM return_requests WHERE order_id = ${orderId};
  `);
  assert.equal(retRows.length, 1, 'Phải tự động tạo bản ghi return_requests hoàn tiền khi đơn đã paid bị hủy');
  assert.equal(Number(retRows[0].refund_amount), 420000);
});

test('Bước 8a.5d (Phần 1 Mục 2.ii): Webhook gọi lặp sau khi Admin đã xác nhận thanh toán thủ công không tạo bản ghi hay lịch sử trùng', async () => {
  const orderId = 'BAITY-8A-MANUAL-WEBHOOK';
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status
    ) VALUES (
      ${orderId}, ${customerId}::uuid, 'Khách Manual Webhook', '0933444555', '12 Đồng Khởi',
      'standard', 0, 500000, 0, 500000, 'pending'
    );
  `);
  await queryRows(sql`
    INSERT INTO payments (order_id, method, status)
    VALUES (${orderId}, 'vietqr', 'pending');
  `);

  const confirmRes = await fetch(`${baseUrl}/api/admin/orders/${orderId}/confirm-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({ transactionId: 'FT-MANUAL-WH-01' }),
  });
  assert.equal(confirmRes.status, 200);

  const historyBefore = await queryRows<{ cnt: number }>(sql`
    SELECT COUNT(*)::int AS cnt FROM order_status_history WHERE order_id = ${orderId};
  `);

  // Gọi Webhook cho cùng đơn hàng sau khi Admin đã xác nhận thủ công
  const rawBody = JSON.stringify({
    orderCode: orderId,
    transactionId: 'FT-WEBHOOK-LATE-02',
    amount: 500000,
  });
  const ts = String(Date.now());
  const sig = createWebhookSignature(rawBody, ts, process.env.PAYMENT_WEBHOOK_SECRET!);

  const whRes = await fetch(`${baseUrl}/api/payments/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-timestamp': ts,
      'x-webhook-signature': sig,
    },
    body: rawBody,
  });
  assert.equal(whRes.status, 200);
  const whBody = await whRes.json();
  assert.equal(whBody.idempotent, true);

  const historyAfter = await queryRows<{ cnt: number }>(sql`
    SELECT COUNT(*)::int AS cnt FROM order_status_history WHERE order_id = ${orderId};
  `);
  assert.equal(historyAfter[0].cnt, historyBefore[0].cnt, 'Không được ghi thêm lịch sử trạng thái trùng');
});

test('Bước 8a.5e (Phần 1 Mục 2.iii): Đơn VietQR đã được Admin xác nhận thủ công không bị hủy tự động sau 30 phút', async () => {
  const orderId = 'BAITY-8A-MANUAL-NOEXPIRE';
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status
    ) VALUES (
      ${orderId}, ${customerId}::uuid, 'Khách No Expire', '0933444555', '12 Đồng Khởi',
      'standard', 0, 390000, 0, 390000, 'pending'
    );
  `);
  await queryRows(sql`
    INSERT INTO payments (order_id, method, status)
    VALUES (${orderId}, 'vietqr', 'pending');
  `);

  const confirmRes = await fetch(`${baseUrl}/api/admin/orders/${orderId}/confirm-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({ transactionId: 'FT-NOEXPIRE-01' }),
  });
  assert.equal(confirmRes.status, 200);

  // Lùi created_at về 45 phút trước rồi chạy lazyCleanup
  await queryRows(sql`
    UPDATE orders SET created_at = NOW() - INTERVAL '45 minutes' WHERE id = ${orderId};
  `);
  const cleanupResult = await runScopedLazyCleanup({ orderId });
  assert.equal(cleanupResult.cancelledOrders.includes(orderId), false);

  const checkOrd = await queryRows<{ status: string }>(sql`
    SELECT status FROM orders WHERE id = ${orderId};
  `);
  assert.equal(checkOrd[0].status, 'confirmed', 'Đơn đã xác nhận thanh toán thủ công phải giữ nguyên confirmed');
});

// ============================================================================
// NHÓM 8a.6: ĐỔI TRẢ & HOÀN TIỀN (MỖI QUY TẮC 1 TEST RIÊNG)
// ============================================================================
let retOrderId = 'BAITY-8A-RET1';
let rr1Id = '';
let rr2Id = '';

test('Bước 8a.6a: Từ chối yêu cầu đổi trả bắt buộc phải có lý do từ chối (thiếu trả HTTP 400)', async () => {
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status, delivered_at
    ) VALUES (
      ${retOrderId}, ${customerId}::uuid, 'Khách Đổi Trả', '0944555666', '88 Hai Bà Trưng',
      'standard', 30000, 400000, 100000, 330000, 'return_requested', NOW()
    );
  `);
  const item1Rows = await queryRows<{ id: string }>(sql`
    INSERT INTO order_items (order_id, variant_id, product_name, color, size, unit_price, quantity, total_price)
    VALUES (${retOrderId}, ${testVariantId}::uuid, 'Áo Đổi Trả 1', 'Be', 'M', 200000, 1, 200000)
    RETURNING id;
  `);
  const item2Rows = await queryRows<{ id: string }>(sql`
    INSERT INTO order_items (order_id, variant_id, product_name, color, size, unit_price, quantity, total_price)
    VALUES (${retOrderId}, ${testVariantId}::uuid, 'Áo Đổi Trả 2', 'Đen', 'L', 200000, 1, 200000)
    RETURNING id;
  `);
  const rr1Rows = await queryRows<{ id: string }>(sql`
    INSERT INTO return_requests (order_id, user_id, order_item_id, reason, type, quantity, refund_amount, status)
    VALUES (${retOrderId}, ${customerId}::uuid, ${item1Rows[0].id}::uuid, 'defective_product', 'refund', 1, 150000, 'pending')
    RETURNING id;
  `);
  const rr2Rows = await queryRows<{ id: string }>(sql`
    INSERT INTO return_requests (order_id, user_id, order_item_id, reason, type, quantity, refund_amount, status)
    VALUES (${retOrderId}, ${customerId}::uuid, ${item2Rows[0].id}::uuid, 'wrong_item', 'refund', 1, 150000, 'pending')
    RETURNING id;
  `);
  rr1Id = rr1Rows[0].id;
  rr2Id = rr2Rows[0].id;

  const rejectNoReason = await fetch(`${baseUrl}/api/admin/returns/${rr1Id}/decision`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({ decision: 'reject', rejectionReason: '' }),
  });
  assert.equal(rejectNoReason.status, 400);
});

test('Bước 8a.6b: Duyệt đổi trả do Server tự tính lại số tiền hoàn kèm phí vận chuyển, bỏ qua số tiền giả mạo từ client', async () => {
  const approve1 = await fetch(`${baseUrl}/api/admin/returns/${rr1Id}/decision`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({
      decision: 'approve',
      refundShippingFee: true,
      refundAmount: 99999999,
    }),
  });
  assert.equal(approve1.status, 200);
  const approve1Body = await approve1.json();
  assert.equal(approve1Body.refundAmount, 180000);
});

test('Bước 8a.6c: Xác nhận đã nhận hàng trả về kho (POST /api/admin/returns/:id/receive) chỉ cộng hoàn kho đúng 1 lần duy nhất', async () => {
  const stockBeforeRows = await queryRows<{ stock_quantity: number }>(sql`
    SELECT stock_quantity FROM product_variants WHERE id = ${testVariantId}::uuid;
  `);
  const stockBefore = Number(stockBeforeRows[0].stock_quantity);

  const recv1 = await fetch(`${baseUrl}/api/admin/returns/${rr1Id}/receive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({ restoreStock: true }),
  });
  assert.equal(recv1.status, 200);
  assert.equal((await recv1.json()).stockRestoredNow, true);

  const recv2 = await fetch(`${baseUrl}/api/admin/returns/${rr1Id}/receive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({ restoreStock: true }),
  });
  assert.equal(recv2.status, 200);
  assert.equal((await recv2.json()).stockRestoredNow, false);

  const stockAfterRows = await queryRows<{ stock_quantity: number }>(sql`
    SELECT stock_quantity FROM product_variants WHERE id = ${testVariantId}::uuid;
  `);
  assert.equal(Number(stockAfterRows[0].stock_quantity), stockBefore + 1);
});

test('Bước 8a.6d: Đánh dấu hoàn tiền (POST /api/admin/returns/:id/refund) hoạt động Idempotent và tổng tiền hoàn tích lũy của đơn không vượt tổng tiền đã trả', async () => {
  const ref1 = await fetch(`${baseUrl}/api/admin/returns/${rr1Id}/refund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({}),
  });
  assert.equal(ref1.status, 200);
  assert.equal((await ref1.json()).idempotent, false);

  const ref1Dup = await fetch(`${baseUrl}/api/admin/returns/${rr1Id}/refund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({}),
  });
  assert.equal(ref1Dup.status, 200);
  assert.equal((await ref1Dup.json()).idempotent, true);

  const approve2 = await fetch(`${baseUrl}/api/admin/returns/${rr2Id}/decision`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({
      decision: 'approve',
      refundShippingFee: true,
    }),
  });
  assert.equal(approve2.status, 200);
  assert.equal((await approve2.json()).refundAmount, 150000);

  const ref2 = await fetch(`${baseUrl}/api/admin/returns/${rr2Id}/refund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({}),
  });
  assert.equal(ref2.status, 200);
  const ref2Body = await ref2.json();
  assert.equal(ref2Body.cumulativeOrderRefunded, 330000);
  assert.ok(ref2Body.cumulativeOrderRefunded <= ref2Body.orderTotalAmount);
});

// ============================================================================
// NHÓM 8a.7 & MỤC 5c: ĐỐI SOÁT THANH TOÁN & NHẬT KÝ ADMIN_AUDIT_LOGS
// ============================================================================
test('Bước 8a.7a (Mục 5c): GET /api/admin/payment-issues và POST /api/admin/payment-issues/:type/:id/resolve đánh dấu sự cố đã xử lý và ghi admin_audit_logs trong cùng giao dịch', async () => {
  const evRows = await queryRows<{ id: number }>(sql`
    INSERT INTO payment_events (order_id, event_type, expected_amount, received_amount, transaction_id)
    VALUES ('BAITY-8A01', 'amount_mismatch', 430000, 400000, 'TX-ISSUE-8A-01')
    RETURNING id;
  `);
  const evId = evRows[0].id;

  const listRes = await fetch(`${baseUrl}/api/admin/payment-issues`, {
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}` },
  });
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  assert.ok(listBody.paymentMismatchEvents.some((e: any) => e.id === evId));

  const resolveRes = await fetch(
    `${baseUrl}/api/admin/payment-issues/payment_event/${encodeURIComponent(String(evId))}/resolve`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
      },
      body: JSON.stringify({
        note: 'Đã liên hệ khách bù 30.000₫ và đối soát xong',
      }),
    }
  );
  assert.equal(resolveRes.status, 200);
  const resolveBody = await resolveRes.json();
  assert.equal(resolveBody.idempotent, false);

  // Xác nhận các route trùng lặp cũ đã được gỡ bỏ và trả 404 theo định dạng lỗi chuẩn
  const oldPostReturnDecision = await fetch(`${baseUrl}/api/admin/returns/${rr1Id}/decision`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({ decision: 'approve' }),
  });
  assert.equal(oldPostReturnDecision.status, 404);
  const oldReturnErr = await oldPostReturnDecision.json();
  assert.equal(oldReturnErr.error?.code, 'ADMIN_ROUTE_NOT_FOUND');

  const oldPaymentResolve = await fetch(`${baseUrl}/api/admin/payment-issues/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}`,
    },
    body: JSON.stringify({ issueType: 'payment_event', id: evId, note: 'Test' }),
  });
  assert.equal(oldPaymentResolve.status, 404);
  const oldPaymentErr = await oldPaymentResolve.json();
  assert.equal(oldPaymentErr.error?.code, 'ADMIN_ROUTE_NOT_FOUND');

  const auditRows = await queryRows<{ action: string; target_id: string }>(sql`
    SELECT action, target_id FROM admin_audit_logs
    WHERE action = 'RESOLVE_PAYMENT_EVENT' AND target_id = ${String(evId)};
  `);
  assert.equal(auditRows.length, 1, 'Phải ghi bản ghi RESOLVE_PAYMENT_EVENT vào admin_audit_logs');
});

test('Bước 8a.7b: Nhật ký admin_audit_logs bị rollback hoàn toàn nếu giao dịch thất bại và không lộ PII khách hàng', async () => {
  const rollbackTargetId = 'ROLLBACK-TEST-ORDER-999';
  await assert.rejects(async () => {
    await withTransaction(async (txQueryRows) => {
      await insertAdminAuditLogInTx(txQueryRows, {
        adminId: adminAId,
        action: 'TEST_ROLLBACK_ACTION',
        targetType: 'order',
        targetId: rollbackTargetId,
        summary: 'Dòng log này phải bị rollback khi giao dịch lỗi',
      });
      throw new Error('Simulated transaction failure after audit log insert');
    });
  });

  const orphanRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM admin_audit_logs WHERE target_id = ${rollbackTargetId};
  `);
  assert.equal(orphanRows.length, 0);

  const logsRes = await fetch(`${baseUrl}/api/admin/audit-logs?page=1&limit=50`, {
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminAToken}` },
  });
  assert.equal(logsRes.status, 200);
  const logsBody = await logsRes.json();
  assert.ok(logsBody.items.length >= 4);

  for (const log of logsBody.items) {
    assert.ok(!String(log.note || '').includes('Phạm Bí Mật PII'));
    assert.ok(!String(log.note || '').includes('0988777666'));
  }
});
