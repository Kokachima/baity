import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import bcrypt from 'bcryptjs';
import { createApp } from '../server/app.ts';
import { initDatabase } from '../server/db/init.ts';
import { getDb, queryRows, closeDb } from '../server/db/index.ts';
import { sql } from 'drizzle-orm';
import { transitionOrderStatus } from '../server/services/orderStateMachine.ts';
import { resetOrderCreateRateLimit } from '../server/routes/orders.ts';

process.env.USE_PGLITE = 'true';
process.env.PGLITE_DATA_DIR = 'memory://';
process.env.COOKIE_CROSS_SITE = 'false';
process.env.JWT_SECRET = 'baity_jwt_test_secret_key_super_secure_32_chars';
process.env.ENABLE_DEMO_PAYMENT_WEBHOOK = 'true';

let server: http.Server;
let baseUrl = '';

function extractCookies(res: any, existingCookies = ''): string {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  const cookieMap = new Map<string, string>();
  if (existingCookies) {
    existingCookies.split(';').forEach((part: string) => {
      const [k, v] = part.trim().split('=');
      if (k && v) cookieMap.set(k, v);
    });
  }
  for (const c of raw) {
    const main = c.split(';')[0];
    const [k, v] = main.trim().split('=');
    if (k && v) cookieMap.set(k, v);
  }
  return Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

before(async () => {
  await getDb();
  await initDatabase();

  const pwdAdmin = bcrypt.hashSync('Admin@123', 10);
  const pwdUser = bcrypt.hashSync('Khach@123', 10);

  await queryRows(sql`
    INSERT INTO users (full_name, email, phone, password_hash, role)
    VALUES
      ('Admin Baity', 'admin@baity.vn', '0901234567', ${pwdAdmin}, 'admin'),
      ('Khách Hàng 1', 'khach1@baity.vn', '0912345678', ${pwdUser}, 'customer'),
      ('Khách Hàng 2', 'khach2@baity.vn', '0987654321', ${pwdUser}, 'customer')
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;
  `);

  await queryRows(sql`
    INSERT INTO store_settings (key, value, description)
    VALUES
      ('general', '{"freeShippingThreshold": 499000, "defaultShippingFee": 30000, "expressShippingFee": 50000}'::jsonb, 'Cài đặt chung'),
      ('vietqr_config', '{"bankId": "970422", "bankName": "MBBank", "accountNo": "0901234567", "accountName": "CONG TY TNHH BAITY FASHION", "template": "compact"}'::jsonb, 'VietQR')
    ON CONFLICT (key) DO NOTHING;
  `);

  await queryRows(sql`
    INSERT INTO vouchers (code, discount_type, discount_value, max_discount, min_order_value, usage_limit, per_user_limit, used_count, start_date, end_date, is_active)
    VALUES
      ('BAITYVIP50K', 'fixed', 50000, 50000, 100000, 200, 1, 0, NOW() - INTERVAL '2 days', NOW() + INTERVAL '30 days', true),
      ('BAITYWELCOME', 'percent', 15, 100000, 100000, 500, 1, 0, NOW() - INTERVAL '5 days', NOW() + INTERVAL '90 days', true)
    ON CONFLICT (code) DO NOTHING;
  `);

  const catRows = await queryRows<{ id: string }>(sql`
    INSERT INTO categories (name, slug, display_order)
    VALUES ('Áo Sơ Mi Nam', 'ao-so-mi-nam-test', 1)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id;
  `);
  const catId = catRows[0].id;

  const prodRows = await queryRows<{ id: string }>(sql`
    INSERT INTO products (name, slug, category_id, target_gender, description, material, care_instructions, base_price, search_text, is_active)
    VALUES
      ('Áo Sơ Mi Oxford Nam Stage 5', 'ao-so-mi-oxford-nam-s5', ${catId}, 'men', 'Sơ mi oxford bền đẹp', 'Cotton', 'Giặt nhẹ', 350000, 'ao so mi oxford nam stage 5', true)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id;
  `);
  const prodId = prodRows[0].id;

  await queryRows(sql`
    INSERT INTO product_variants (product_id, sku, color_name, color_code, size, stock_quantity, price_override)
    VALUES
      (${prodId}, 'SKU-S5-01', 'Trắng', '#FFFFFF', 'M', 20, NULL),
      (${prodId}, 'SKU-S5-02', 'Xanh', '#0000FF', 'L', 15, NULL)
    ON CONFLICT (sku) DO UPDATE SET stock_quantity = 20;
  `);

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address() as any;
      baseUrl = `http://localhost:${addr.port}`;
      resolve();
    });
  });
});

beforeEach(async () => {
  resetOrderCreateRateLimit();
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await closeDb();
});

// ==========================================
// 1. QUYỀN TRUY CẬP ĐƠN HÀNG: CHỦ ĐƠN HOẶC ADMIN (NGƯỜI KHÁC 404)
// ==========================================
test('Stage 5 - Quy tắc 1: Chủ đơn mới xem được đơn hàng, người khác nhận HTTP 404 (không lộ mã đơn)', async () => {
  const [log1, log2] = await Promise.all([
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
    }),
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'khach2@baity.vn', password: 'Khach@123' }),
    }),
  ]);
  const cookie1 = extractCookies(log1);
  const cookie2 = extractCookies(log2);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  // Khách 1 tạo đơn
  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách 1',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ nhà',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(orderRes.status, 201);
  const order = (await orderRes.json()).data;

  // Khách 1 xem đơn của chính mình -> 200 OK
  const ownerView = await fetch(`${baseUrl}/api/orders/${order.id}`, {
    headers: { Cookie: cookie1 },
  });
  assert.equal(ownerView.status, 200);

  // Khách 2 xem đơn của Khách 1 -> Nhận đúng 404 Not Found (Bảo mật, không để lộ mã đơn)
  const otherView = await fetch(`${baseUrl}/api/orders/${order.id}`, {
    headers: { Cookie: cookie2 },
  });
  assert.equal(otherView.status, 404, 'Người khác truy cập đơn hàng phải nhận đúng HTTP 404');
});

// ==========================================
// 2. MÁY TRẠNG THÁI ĐƠN HÀNG: CHUYỂN TRẠNG THÁI TRÁI LUỒNG BỊ TỪ CHỐI
// ==========================================
test('Stage 5 - Quy tắc 2: Chuyển trạng thái đơn hàng trái luồng bị từ chối với HTTP 400', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  const order = (await orderRes.json()).data;

  // Đang ở 'pending', thử nhảy cóc sang 'delivered' hoặc 'completed' mà không qua confirmed/processing/shipping
  await assert.rejects(
    async () => {
      await transitionOrderStatus({
        orderId: order.id,
        newStatus: 'completed',
        changedBy: 'admin',
        isAdmin: true,
      });
    },
    (err: any) => {
      assert.equal(err.statusCode, 400);
      assert.ok(err.message.includes('Luồng chuyển trạng thái không hợp lệ'));
      return true;
    }
  );

  // Chuyển hợp lệ: pending -> confirmed -> processing -> shipping -> delivered
  await transitionOrderStatus({ orderId: order.id, newStatus: 'confirmed', changedBy: 'admin', isAdmin: true });
  await transitionOrderStatus({ orderId: order.id, newStatus: 'processing', changedBy: 'admin', isAdmin: true });
  await transitionOrderStatus({ orderId: order.id, newStatus: 'shipping', changedBy: 'admin', isAdmin: true });
  const delivRes = await transitionOrderStatus({ orderId: order.id, newStatus: 'delivered', changedBy: 'admin', isAdmin: true });
  assert.equal(delivRes.currentStatus, 'delivered');
  assert.ok(delivRes.deliveredAt, 'Phải tự động ghi nhận delivered_at khi chuyển sang delivered');
});

// ==========================================
// 3. RANH GIỚI ĐỔI TRẢ 7 NGÀY: NGÀY 7 THÀNH CÔNG, NGÀY 8 BỊ CHẶN 400
// ==========================================
test('Stage 5 - Quy tắc 3: Ranh giới đổi trả 7 ngày - ngày thứ 7 được đổi trả, ngày thứ 8 bị chặn (HTTP 400)', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  // Tạo đơn hàng
  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 2 }],
      receiverName: 'Khách Đổi Trả',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  const order = (await orderRes.json()).data;
  const orderItemId = order.items[0].id;

  // 1. Trường hợp Ngày thứ 8 (> 7 ngày): lùi delivered_at về 8 ngày trước -> Bị chặn 400
  await queryRows(sql`
    UPDATE orders
    SET status = 'delivered',
        delivered_at = NOW() - INTERVAL '8 days'
    WHERE id = ${order.id};
  `);

  const day8Res = await fetch(`${baseUrl}/api/returns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      orderId: order.id,
      orderItemId,
      quantity: 1,
      type: 'refund',
      reason: 'defective_product',
      description: 'Lỗi rách đường chỉ',
    }),
  });
  assert.equal(day8Res.status, 400, 'Đơn giao quá 7 ngày (ngày thứ 8) phải bị từ chối');
  const day8Body = await day8Res.json();
  assert.ok(day8Body.message.includes('quá thời hạn 7 ngày'));

  // 2. Trường hợp Ngày thứ 7 (6.5 ngày trước <= 7 ngày) -> Thành công 201
  await queryRows(sql`
    UPDATE orders
    SET delivered_at = NOW() - INTERVAL '6 days 12 hours'
    WHERE id = ${order.id};
  `);

  const day7Res = await fetch(`${baseUrl}/api/returns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      orderId: order.id,
      orderItemId,
      quantity: 1,
      type: 'refund',
      reason: 'defective_product',
      description: 'Lỗi rách đường chỉ',
    }),
  });
  assert.equal(day7Res.status, 201, 'Trong thời hạn 7 ngày (ngày thứ 7) phải tạo yêu cầu đổi trả thành công');
});

// ==========================================
// 4. KIỂM SOÁT SỐ LƯỢNG ĐỔI TRẢ VÀ CHỐNG YÊU CẦU TRÙNG LẶP
// ==========================================
test('Stage 5 - Quy tắc 4: Vượt số lượng đã mua bị từ chối và mỗi dòng sản phẩm chỉ có tối đa 1 yêu cầu đang xử lý', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 2 }],
      receiverName: 'Khách',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  const order = (await orderRes.json()).data;
  const orderItemId = order.items[0].id;

  // Đặt trạng thái delivered 1 ngày trước
  await queryRows(sql`
    UPDATE orders SET status = 'delivered', delivered_at = NOW() - INTERVAL '1 day' WHERE id = ${order.id};
  `);

  // a. Thử yêu cầu 5 chiếc (trong khi chỉ mua 2 chiếc) -> 400
  const overQty = await fetch(`${baseUrl}/api/returns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      orderId: order.id,
      orderItemId,
      quantity: 5,
      type: 'refund',
      reason: 'wrong_item',
    }),
  });
  assert.equal(overQty.status, 400, 'Yêu cầu vượt số lượng mua phải trả về 400');

  // b. Yêu cầu 1 chiếc hợp lệ -> 201
  const validReq = await fetch(`${baseUrl}/api/returns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      orderId: order.id,
      orderItemId,
      quantity: 1,
      type: 'refund',
      reason: 'wrong_item',
      description: 'Sai màu áo',
    }),
  });
  assert.equal(validReq.status, 201);

  // c. Gửi tiếp yêu cầu thứ hai trên cùng dòng sản phẩm khi yêu cầu 1 đang pending -> Bị từ chối trùng lặp 400
  const duplicateReq = await fetch(`${baseUrl}/api/returns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      orderId: order.id,
      orderItemId,
      quantity: 1,
      type: 'refund',
      reason: 'wrong_item',
    }),
  });
  assert.equal(duplicateReq.status, 400, 'Không được tạo yêu cầu trùng khi đang có yêu cầu xử lý');
  const dupBody = await duplicateReq.json();
  assert.ok(dupBody.message.includes('đang có một yêu cầu đổi trả đang được xử lý'));
});

// ==========================================
// 5. TỰ HOÀN TẤT LAZY: DELIVERED > 7 NGÀY CHUYỂN COMPLETED
// ==========================================
test('Stage 5 - Quy tắc 5: Tự hoàn tất lazy - đơn delivered quá 7 ngày tự động chuyển completed khi truy vấn', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách Lazy Complete',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  const order = (await orderRes.json()).data;

  // Giả lập đơn đã delivered 10 ngày trước
  await queryRows(sql`
    UPDATE orders
    SET status = 'delivered',
        delivered_at = NOW() - INTERVAL '10 days'
    WHERE id = ${order.id};
  `);

  // Khi khách truy vấn chi tiết đơn hàng hoặc danh sách đơn -> kích hoạt lazy cleanup
  const detailRes = await fetch(`${baseUrl}/api/orders/${order.id}`, {
    headers: { Cookie: cookie },
  });
  assert.equal(detailRes.status, 200);
  const detail = (await detailRes.json()).data;
  assert.equal(detail.status, 'completed', 'Đơn hàng phải tự động chuyển completed sau 7 ngày');
  assert.ok(detail.completedAt, 'completed_at phải được cập nhật thời điểm tự hoàn tất');
});

// ==========================================
// 6. MUA LẠI: THÊM SẢN PHẨM CŨ VÀO GIỎ, BÁO RÕ MÓN HẾT HÀNG
// ==========================================
test('Stage 5 - Quy tắc 6: Mua lại (POST /api/orders/:id/reorder) thêm vào giỏ, thông báo rõ món hết hàng', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  // Chọn 2 biến thể khác nhau
  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 2;`);
  const var1 = vRows[0].id;
  const var2 = vRows[1].id;

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      items: [
        { variantId: var1, quantity: 2 },
        { variantId: var2, quantity: 1 },
      ],
      receiverName: 'Khách Reorder',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  const order = (await orderRes.json()).data;

  // Giả lập var2 bị hết hàng (stock_quantity = 0)
  await queryRows(sql`UPDATE product_variants SET stock_quantity = 0 WHERE id = ${var2}::uuid;`);

  // Gọi API mua lại
  const reorderRes = await fetch(`${baseUrl}/api/orders/${order.id}/reorder`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  assert.equal(reorderRes.status, 200);
  const reorderBody = await reorderRes.json();

  assert.equal(reorderBody.success, true);
  assert.equal(reorderBody.addedItems.length, 1, 'Chỉ món còn hàng mới được thêm vào giỏ');
  assert.equal(reorderBody.outOfStockItems.length, 1, 'Món hết hàng phải được báo rõ trong outOfStockItems');

  // Khôi phục lại tồn kho var2
  await queryRows(sql`UPDATE product_variants SET stock_quantity = 15 WHERE id = ${var2}::uuid;`);
});

// ==========================================
// 7. HOÀN TIỀN TÍNH ĐÚNG KHI CÓ VOUCHER: PHÂN BỔ THEO TỶ LỆ DÒNG SẢN PHẨM
// ==========================================
test('Stage 5 - Quy tắc 7: Hoàn tiền tính đúng khi đơn có voucher (phân bổ giảm giá theo tỷ lệ giá trị)', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  // Đặt đơn hàng có voucher giảm giá BAITYVIP50K (50.000đ)
  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 2 }],
      receiverName: 'Khách Refund Voucher',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'vietqr',
      voucherCode: 'BAITYVIP50K',
    }),
  });
  const order = (await orderRes.json()).data;
  const orderItemId = order.items[0].id;
  const itemUnitPrice = Number(order.items[0].unitPrice);

  // Chuyển đơn sang delivered 2 ngày trước
  await queryRows(sql`
    UPDATE orders SET status = 'delivered', delivered_at = NOW() - INTERVAL '2 days' WHERE id = ${order.id};
  `);

  // Yêu cầu hoàn tiền 1 trong số 2 chiếc
  const returnRes = await fetch(`${baseUrl}/api/returns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      orderId: order.id,
      orderItemId,
      quantity: 1,
      type: 'refund',
      reason: 'defective_product',
      description: 'Lỗi sản phẩm',
    }),
  });
  assert.equal(returnRes.status, 201);
  const returnData = (await returnRes.json()).data;

  // Công thức:
  // lineTotal = unitPrice * 1
  // subtotal = unitPrice * 2
  // discountAmount = 50.000đ
  // voucherProportion = 50.000 * (1 / 2) = 25.000đ
  // refundAmount = unitPrice - 25.000đ
  const expectedRefund = itemUnitPrice - 25000;
  assert.equal(returnData.refundAmount, expectedRefund, 'Số tiền hoàn phải trừ đi tỷ lệ voucher được phân bổ');
});

// ==========================================
// 8a. SERVER BỎ QUA REFUND_AMOUNT DO CLIENT GỬI LÊN
// ==========================================
test('Stage 5 - Quy tắc 8a: Server hoàn toàn bỏ qua refundAmount do client giả mạo gửi lên', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách Kiểm Tra Server Refund',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(orderRes.status, 201);
  const order = (await orderRes.json()).data;
  const orderItemId = order.items[0].id;
  const itemUnitPrice = Number(order.items[0].unitPrice);

  await queryRows(sql`
    UPDATE orders SET status = 'delivered', delivered_at = NOW() - INTERVAL '1 day' WHERE id = ${order.id};
  `);

  // Client cố tình gửi refundAmount = 99999999 (giả mạo số tiền hoàn)
  const returnRes = await fetch(`${baseUrl}/api/returns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      orderId: order.id,
      orderItemId,
      quantity: 1,
      type: 'refund',
      reason: 'defective_product',
      description: 'Cố tình gửi refundAmount giả mạo',
      refundAmount: 99999999,
      refund_amount: 99999999,
    }),
  });
  assert.equal(returnRes.status, 201);
  const returnData = (await returnRes.json()).data;
  assert.equal(
    returnData.refundAmount,
    itemUnitPrice,
    'Server phải hoàn toàn bỏ qua refundAmount client gửi lên và tính đúng theo giá thực tế trên server'
  );
});

// ==========================================
// 8b. LỌC ĐƠN HÀNG & PHÂN TRANG QUA GET /api/orders
// ==========================================
test('Stage 5 - Quy tắc 8b: GET /api/orders hỗ trợ lọc theo trạng thái và phân trang chính xác', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const listRes = await fetch(`${baseUrl}/api/orders?status=pending&page=1&pageSize=5`, {
    headers: { Cookie: cookie },
  });
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  assert.equal(listBody.success, true);
  assert.ok(Array.isArray(listBody.items));
  assert.equal(listBody.page, 1);
  assert.equal(listBody.pageSize, 5);
  for (const o of listBody.items) {
    assert.equal(o.status, 'pending', 'Mọi đơn trả về khi lọc status=pending phải có trạng thái pending');
  }
});

// ==========================================
// 8c. TIẾP TỤC THANH TOÁN VIETQR QUA GET /api/orders/:id/payment-status
// ==========================================
test('Stage 5 - Quy tắc 8c: GET /api/orders/:id/payment-status trả về thông tin QR và thời gian đếm ngược để tiếp tục thanh toán VietQR', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách Tiếp Tục VietQR',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'vietqr',
    }),
  });
  assert.equal(orderRes.status, 201);
  const order = (await orderRes.json()).data;

  const payStatusRes = await fetch(`${baseUrl}/api/orders/${order.id}/payment-status`, {
    headers: { Cookie: cookie },
  });
  assert.equal(payStatusRes.status, 200);
  const payStatusData = (await payStatusRes.json()).data;
  assert.equal(payStatusData.paymentMethod, 'vietqr');
  assert.ok(payStatusData.vietqr?.qrImageUrl, 'Phải có đường dẫn mã QR để khách tiếp tục thanh toán');
  assert.equal(payStatusData.isExpired, false, 'Đơn VietQR mới tạo phải còn thời gian thanh toán');
});

// ==========================================
// 9. PHÂN QUYỀN ĐỔI TRẠNG THÁI ĐƠN (PUT /api/admin/orders/:id/status)
// ==========================================
test('Stage 5 - Mục A.2: PUT /api/admin/orders/:id/status chỉ admin được gọi; tài khoản khách gọi nhận 403 và dữ liệu không đổi; route cũ PUT /api/orders/:id/status đã được gỡ bỏ', async () => {
  const [logAdmin, logCust1, logCust2] = await Promise.all([
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@baity.vn', password: 'Admin@123' }),
    }),
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
    }),
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'khach2@baity.vn', password: 'Khach@123' }),
    }),
  ]);
  const adminCookie = extractCookies(logAdmin);
  const cust1Cookie = extractCookies(logCust1);
  const cust2Cookie = extractCookies(logCust2);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  // Khách 1 tạo đơn
  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cust1Cookie },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách 1',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  const order = (await orderRes.json()).data;

  // a. Route cũ PUT /api/orders/:id/status đã được gỡ bỏ (404)
  const removedOldRouteRes = await fetch(`${baseUrl}/api/orders/${order.id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ status: 'confirmed' }),
  });
  assert.equal(removedOldRouteRes.status, 404, 'Route trùng PUT /api/orders/:id/status phải trả 404');

  // b. Khách 2 hoặc Khách 1 gọi PUT /api/admin/orders/:id/status -> Nhận 403 từ requireAdmin và DB không đổi
  const otherCustRes = await fetch(`${baseUrl}/api/admin/orders/${order.id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cust2Cookie },
    body: JSON.stringify({ status: 'confirmed', expectedStatus: 'pending' }),
  });
  assert.equal(otherCustRes.status, 403, 'Khách gọi route admin phải nhận 403');

  const custPendingToConfirmed = await fetch(`${baseUrl}/api/admin/orders/${order.id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cust1Cookie },
    body: JSON.stringify({ status: 'confirmed', expectedStatus: 'pending' }),
  });
  assert.equal(custPendingToConfirmed.status, 403, 'Khách tự gọi pending -> confirmed phải nhận 403');
  const checkDb1 = await queryRows<{ status: string }>(sql`SELECT status FROM orders WHERE id = ${order.id};`);
  assert.equal(checkDb1[0].status, 'pending', 'Trạng thái đơn trong CSDL phải giữ nguyên pending');

  // c. Admin gọi PUT /api/admin/orders/:id/status: pending -> confirmed -> processing -> shipping -> Thành công 200
  const transitions: { prev: string; next: string; trackingCode?: string }[] = [
    { prev: 'pending', next: 'confirmed' },
    { prev: 'confirmed', next: 'processing' },
    { prev: 'processing', next: 'shipping', trackingCode: 'GHN-STAGE5-001' },
  ];
  for (const step of transitions) {
    const adminRes = await fetch(`${baseUrl}/api/admin/orders/${order.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({
        status: step.next,
        expectedStatus: step.prev,
        trackingCode: step.trackingCode,
      }),
    });
    assert.equal(adminRes.status, 200, `Admin chuyển sang ${step.next} phải thành công 200`);
  }

  // d. Khách 1 (chủ đơn) gọi PUT /api/admin/orders/:id/status (shipping -> delivered) -> Nhận 403 và DB không đổi
  const custShippingToDelivered = await fetch(`${baseUrl}/api/admin/orders/${order.id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cust1Cookie },
    body: JSON.stringify({ status: 'delivered', expectedStatus: 'shipping' }),
  });
  assert.equal(custShippingToDelivered.status, 403, 'Khách tự gọi shipping -> delivered phải nhận 403');
  const checkDb2 = await queryRows<{ status: string }>(sql`SELECT status FROM orders WHERE id = ${order.id};`);
  assert.equal(checkDb2[0].status, 'shipping', 'Trạng thái đơn trong CSDL phải giữ nguyên shipping');
});

// ==========================================
// 10. HỦY ĐƠN: KIỂM THỬ TỪNG TRẠNG THÁI (MỤC A.3)
// ==========================================
test('Stage 5 - Mục A.3: Hủy đơn chỉ được phép ở pending, confirmed, processing; từ shipping trở đi bị chặn 400 (test từng trạng thái)', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  // Khôi phục tồn kho đủ lớn để tạo nhiều đơn test
  await queryRows(sql`UPDATE product_variants SET stock_quantity = 50 WHERE id = ${varId}::uuid;`);

  // 1. Các trạng thái ĐƯỢC PHÉP hủy: pending, confirmed, processing
  for (const allowedStatus of ['pending', 'confirmed', 'processing'] as const) {
    const createRes = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        items: [{ variantId: varId, quantity: 1 }],
        receiverName: `Khách Cancel ${allowedStatus}`,
        receiverPhone: '0912345678',
        shippingAddress: 'Địa chỉ',
        shippingMethod: 'standard',
        paymentMethod: 'cod',
      }),
    });
    const ord = (await createRes.json()).data;
    await queryRows(sql`UPDATE orders SET status = ${allowedStatus} WHERE id = ${ord.id};`);

    const cancelRes = await fetch(`${baseUrl}/api/orders/${ord.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ reason: `Hủy ở trạng thái ${allowedStatus}` }),
    });
    assert.equal(cancelRes.status, 200, `Hủy đơn ở trạng thái "${allowedStatus}" phải được phép (HTTP 200)`);
    const check = await queryRows<{ status: string }>(sql`SELECT status FROM orders WHERE id = ${ord.id};`);
    assert.equal(check[0].status, 'cancelled');
  }

  // 2. Các trạng thái BỊ CHẶN hủy (400): shipping, delivered, completed, return_requested, cancelled
  for (const blockedStatus of ['shipping', 'delivered', 'completed', 'return_requested', 'cancelled'] as const) {
    const createRes = await fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        items: [{ variantId: varId, quantity: 1 }],
        receiverName: `Khách Blocked ${blockedStatus}`,
        receiverPhone: '0912345678',
        shippingAddress: 'Địa chỉ',
        shippingMethod: 'standard',
        paymentMethod: 'cod',
      }),
    });
    const ord = (await createRes.json()).data;
    await queryRows(sql`UPDATE orders SET status = ${blockedStatus} WHERE id = ${ord.id};`);

    const cancelRes = await fetch(`${baseUrl}/api/orders/${ord.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ reason: `Thử hủy ở trạng thái ${blockedStatus}` }),
    });
    assert.equal(cancelRes.status, 400, `Hủy đơn ở trạng thái "${blockedStatus}" phải bị chặn với HTTP 400`);
    const check = await queryRows<{ status: string }>(sql`SELECT status FROM orders WHERE id = ${ord.id};`);
    assert.equal(check[0].status, blockedStatus, `Trạng thái "${blockedStatus}" trong DB không được phép thay đổi`);
  }
});

// ==========================================
// 11. HOÀN TIỀN KHI VOUCHER LÀ FREE_SHIPPING (MỤC A.9)
// ==========================================
test('Stage 5 - Mục A.9: Khi đơn dùng voucher free_shipping thì phần giảm phí ship KHÔNG bị trừ vào tiền hoàn sản phẩm', async () => {
  await queryRows(sql`
    INSERT INTO vouchers (code, discount_type, discount_value, max_discount, min_order_value, usage_limit, per_user_limit, used_count, start_date, end_date, is_active)
    VALUES ('BAITYFREESHIP_S5', 'free_shipping', 50000, 50000, 100000, 200, 10, 0, NOW() - INTERVAL '2 days', NOW() + INTERVAL '30 days', true)
    ON CONFLICT (code) DO NOTHING;
  `);

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  // Đặt đơn hàng Hỏa tốc (phí ship 50.000₫) và dùng voucher BAITYFREESHIP_S5 giảm 50.000₫ phí ship
  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 2 }],
      receiverName: 'Khách FreeShip Refund',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'express',
      paymentMethod: 'cod',
      voucherCode: 'BAITYFREESHIP_S5',
    }),
  });
  assert.equal(orderRes.status, 201);
  const order = (await orderRes.json()).data;
  assert.equal(order.discountAmount, 50000, 'Voucher free_shipping giảm 50.000₫ phí ship');

  const orderItemId = order.items[0].id;
  const itemUnitPrice = Number(order.items[0].unitPrice);

  await queryRows(sql`
    UPDATE orders SET status = 'delivered', delivered_at = NOW() - INTERVAL '1 day' WHERE id = ${order.id};
  `);

  // Yêu cầu hoàn 1 sản phẩm -> Tiền hoàn phải bằng đúng 100% itemUnitPrice (không bị trừ 25.000₫ của free_shipping)
  const returnRes = await fetch(`${baseUrl}/api/returns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      orderId: order.id,
      orderItemId,
      quantity: 1,
      type: 'refund',
      reason: 'defective_product',
      description: 'Hoàn 1 áo trong đơn có voucher free_shipping',
    }),
  });
  assert.equal(returnRes.status, 201);
  const returnData = (await returnRes.json()).data;
  assert.equal(
    returnData.refundAmount,
    itemUnitPrice,
    'Phần giảm giá của voucher free_shipping thuộc phí ship, tuyệt đối KHÔNG trừ vào tiền hoàn sản phẩm'
  );
});

// ==========================================
// 12. POST /api/tasks/cron-cleanup (MỤC A.11)
// ==========================================
test('Stage 5 - Mục A.11: POST /api/tasks/cron-cleanup đúng CRON_SECRET_KEY thì chạy (tự hoàn tất đơn delivered > 7 ngày), sai hoặc thiếu nhận 401', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách Cron Complete',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  const order = (await orderRes.json()).data;

  // Giả lập đơn đã delivered 9 ngày trước (> 7 ngày)
  await queryRows(sql`
    UPDATE orders SET status = 'delivered', delivered_at = NOW() - INTERVAL '9 days' WHERE id = ${order.id};
  `);

  // a. Không truyền header x-cron-secret -> 401
  const missingKeyRes = await fetch(`${baseUrl}/api/tasks/cron-cleanup`, { method: 'POST' });
  assert.equal(missingKeyRes.status, 401, 'Thiếu CRON_SECRET_KEY phải trả về 401');

  // b. Truyền sai x-cron-secret -> 401
  const wrongKeyRes = await fetch(`${baseUrl}/api/tasks/cron-cleanup`, {
    method: 'POST',
    headers: { 'x-cron-secret': 'wrong-secret-key' },
  });
  assert.equal(wrongKeyRes.status, 401, 'Sai CRON_SECRET_KEY phải trả về 401');

  // c. Truyền đúng CRON_SECRET_KEY -> 200 và tự hoàn tất đơn delivered > 7 ngày
  const expectedSecret = process.env.CRON_SECRET_KEY || 'baity-cron-secret-token-key-2026';
  const validKeyRes = await fetch(`${baseUrl}/api/tasks/cron-cleanup`, {
    method: 'POST',
    headers: { 'x-cron-secret': expectedSecret },
  });
  assert.equal(validKeyRes.status, 200);
  const validBody = await validKeyRes.json();
  assert.equal(validBody.success, true);
  assert.ok(validBody.completedOrders.includes(order.id), 'Cron cleanup phải tự hoàn tất đơn delivered quá 7 ngày');

  const checkOrder = await queryRows<{ status: string }>(sql`SELECT status FROM orders WHERE id = ${order.id};`);
  assert.equal(checkOrder[0].status, 'completed');
});

// ==========================================
// 13a. QUY TẮC ĐỔI TRẢ 1: CHỈ ĐƠN DELIVERED MỚI ĐƯỢC ĐỔI TRẢ (MỤC A.11a & ƯU TIÊN 2.7)
// ==========================================
test('Stage 5 - Mục A.11a: POST /api/returns chỉ cho phép tạo yêu cầu đổi trả khi đơn hàng ở trạng thái delivered (đơn chưa delivered nhận 400)', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie1 = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách 1 Return Delivered Only',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  const order = (await orderRes.json()).data;
  const orderItemId = order.items[0].id;

  // Đơn đang ở pending (chưa delivered) -> Từ chối 400
  const notDeliveredRes = await fetch(`${baseUrl}/api/returns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
    body: JSON.stringify({
      orderId: order.id,
      orderItemId,
      quantity: 1,
      type: 'refund',
      reason: 'defective_product',
    }),
  });
  assert.equal(notDeliveredRes.status, 400, 'Đơn chưa ở trạng thái delivered phải bị từ chối 400');
});

// ==========================================
// 13b. QUY TẮC ĐỔI TRẢ 2: CHỈ CHỦ ĐƠN MỚI ĐƯỢC YÊU CẦU ĐỔI TRẢ (MỤC A.11b & ƯU TIÊN 2.7)
// ==========================================
test('Stage 5 - Mục A.11b: POST /api/returns chỉ cho phép chủ đơn thực hiện; người dùng khác gọi trên đơn không thuộc mình nhận 404', async () => {
  const [log1, log2] = await Promise.all([
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
    }),
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'khach2@baity.vn', password: 'Khach@123' }),
    }),
  ]);
  const cookie1 = extractCookies(log1);
  const cookie2 = extractCookies(log2);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách 1 Return Owner Only',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  const order = (await orderRes.json()).data;
  const orderItemId = order.items[0].id;

  await queryRows(sql`
    UPDATE orders SET status = 'delivered', delivered_at = NOW() - INTERVAL '1 day' WHERE id = ${order.id};
  `);

  // Khách 2 gửi yêu cầu đổi trả trên đơn của Khách 1 -> Nhận 404
  const notOwnerRes = await fetch(`${baseUrl}/api/returns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie2 },
    body: JSON.stringify({
      orderId: order.id,
      orderItemId,
      quantity: 1,
      type: 'refund',
      reason: 'defective_product',
    }),
  });
  assert.equal(notOwnerRes.status, 404, 'Không phải chủ đơn gửi yêu cầu đổi trả phải nhận 404');
});

// ==========================================
// 13c. QUY TẮC ĐỔI TRẢ 3: TỐI ĐA 3 ẢNH MINH CHỨNG (MỤC A.11c & ƯU TIÊN 2.7)
// ==========================================
test('Stage 5 - Mục A.11c: POST /api/returns giới hạn tối đa 3 ảnh minh chứng (gửi 4 ảnh bị từ chối 400)', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie1 = extractCookies(loginRes);
  const user1 = (await loginRes.json()).user;

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách 1 Max 3 Images',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  const order = (await orderRes.json()).data;
  const orderItemId = order.items[0].id;

  await queryRows(sql`
    UPDATE orders SET status = 'delivered', delivered_at = NOW() - INTERVAL '1 day' WHERE id = ${order.id};
  `);

  const tooManyImagesRes = await fetch(`${baseUrl}/api/returns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
    body: JSON.stringify({
      orderId: order.id,
      orderItemId,
      quantity: 1,
      type: 'refund',
      reason: 'defective_product',
      imageProofUrls: [
        `${user1.id}/return/img1.jpg`,
        `${user1.id}/return/img2.jpg`,
        `${user1.id}/return/img3.jpg`,
        `${user1.id}/return/img4.jpg`,
      ],
    }),
  });
  assert.equal(tooManyImagesRes.status, 400, 'Quá 3 ảnh minh chứng phải bị từ chối 400');
});

// ==========================================
// 13d. QUY TẮC ĐỔI TRẢ 4: PATH ẢNH THUỘC THƯ MỤC CỦA CHÍNH NGƯỜI DÙNG (MỤC A.11d & ƯU TIÊN 2.7)
// ==========================================
test('Stage 5 - Mục A.11d: POST /api/returns bắt buộc path ảnh minh chứng phải thuộc thư mục của chính người dùng (<userId>/return/...)', async () => {
  const [log1, log2] = await Promise.all([
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
    }),
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'khach2@baity.vn', password: 'Khach@123' }),
    }),
  ]);
  const cookie1 = extractCookies(log1);
  const user1 = (await log1.json()).user;
  const user2 = (await log2.json()).user;

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách 1 Own Image Path',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  const order = (await orderRes.json()).data;
  const orderItemId = order.items[0].id;

  await queryRows(sql`
    UPDATE orders SET status = 'delivered', delivered_at = NOW() - INTERVAL '1 day' WHERE id = ${order.id};
  `);

  // Path ảnh thuộc thư mục của user2 -> Từ chối 400
  const foreignPathRes = await fetch(`${baseUrl}/api/returns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
    body: JSON.stringify({
      orderId: order.id,
      orderItemId,
      quantity: 1,
      type: 'refund',
      reason: 'defective_product',
      imageProofUrls: [`${user2.id}/return/stolen.jpg`],
    }),
  });
  assert.equal(foreignPathRes.status, 400, 'Path ảnh thuộc thư mục người dùng khác phải bị từ chối 400');

  // Path ảnh hợp lệ thuộc thư mục `${user1.id}/return/...` -> Thành công 201
  const validProofRes = await fetch(`${baseUrl}/api/returns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
    body: JSON.stringify({
      orderId: order.id,
      orderItemId,
      quantity: 1,
      type: 'refund',
      reason: 'defective_product',
      imageProofUrls: [
        `${user1.id}/return/proof1.jpg`,
        `${user1.id}/return/proof2.png`,
      ],
    }),
  });
  assert.equal(validProofRes.status, 201, 'Path ảnh hợp lệ của chính chủ (<= 3 ảnh) phải tạo đổi trả thành công 201');
});

// ==========================================
// 14. HOÀN PHÍ SHIP KHI ĐỔI TRẢ DO ADMIN XÁC NHẬN KHI DUYỆT (MỤC ƯU TIÊN 2.5)
// ==========================================
test('Stage 5 - Mục ƯU TIÊN 2.5: Lý do khách chọn chỉ là đề xuất (ban đầu chưa cộng phí ship); khi Admin duyệt (POST /api/admin/returns/:id/decision) và xác nhận refundShippingFee=true thì server tự tính lại số tiền hoàn kèm phí ship', async () => {
  const [logAdmin, logCust] = await Promise.all([
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@baity.vn', password: 'Admin@123' }),
    }),
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
    }),
  ]);
  const adminCookie = extractCookies(logAdmin);
  const custCookie = extractCookies(logCust);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  // Đặt 1 chiếc (390.000₫ < 499.000₫ -> phí ship tiêu chuẩn 30.000₫, tổng thanh toán 420.000₫)
  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: custCookie },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách Đề Xuất Hoàn Ship',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(orderRes.status, 201);
  const order = (await orderRes.json()).data;
  const orderItemId = order.items[0].id;
  const itemUnitPrice = Number(order.items[0].unitPrice);
  const orderShippingFee = Number(order.shippingFee);
  assert.equal(orderShippingFee, 30000);

  await queryRows(sql`
    UPDATE orders SET status = 'delivered', delivered_at = NOW() - INTERVAL '1 day' WHERE id = ${order.id};
  `);

  // 1. Khách chọn lý do defective_product (lỗi nhà sản xuất) -> Chỉ là đề xuất (shippingFeeRefundProposed=true), tiền hoàn ban đầu chưa cộng phí ship
  const createRetRes = await fetch(`${baseUrl}/api/returns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: custCookie },
    body: JSON.stringify({
      orderId: order.id,
      orderItemId,
      quantity: 1,
      type: 'refund',
      reason: 'defective_product',
      description: 'Áo bị lỗi đường chỉ',
    }),
  });
  assert.equal(createRetRes.status, 201);
  const createdRet = (await createRetRes.json()).data;
  assert.equal(createdRet.shippingFeeRefundProposed, true, 'Lý do lỗi cửa hàng được ghi nhận là đề xuất hoàn phí ship');
  assert.equal(createdRet.refundAmount, itemUnitPrice, 'Khi khách mới gửi yêu cầu, số tiền hoàn tạm tính chỉ gồm tiền hàng');

  // 1b. Route cũ PATCH /api/returns/:id/status đã được gỡ bỏ (404)
  const oldReturnRouteRes = await fetch(`${baseUrl}/api/returns/${createdRet.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ status: 'approved', refundShippingFee: true }),
  });
  assert.equal(oldReturnRouteRes.status, 404, 'Route trùng PATCH /api/returns/:id/status phải trả 404');

  // 2. Admin duyệt yêu cầu qua PUT /api/admin/returns/:id/decision và xác nhận hoàn phí vận chuyển (refundShippingFee: true), cố tình gửi kèm refundAmount giả mạo 99999999
  const approveRes = await fetch(`${baseUrl}/api/admin/returns/${createdRet.id}/decision`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      decision: 'approve',
      refundShippingFee: true,
      refundAmount: 99999999,
    }),
  });
  assert.equal(approveRes.status, 200);
  const approveBody = await approveRes.json();
  assert.equal(approveBody.status, 'approved');
  assert.equal(approveBody.refundShippingFee, true);
  assert.equal(
    approveBody.refundAmount,
    itemUnitPrice + orderShippingFee,
    'Khi Admin xác nhận hoàn phí ship, Server tự tính lại số tiền hoàn cuối cùng = tiền hàng + phí ship (bỏ qua số tiền giả mạo)'
  );
});



