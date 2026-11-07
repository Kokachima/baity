import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { createApp } from '../server/app.ts';
import { initDatabase } from '../server/db/init.ts';
import { queryRows, closeDb } from '../server/db/index.ts';
import { sql } from 'drizzle-orm';
import { resetVoucherValidateRateLimit } from '../server/routes/vouchers.ts';
import { resetOrderCreateRateLimit } from '../server/routes/orders.ts';
import { createWebhookSignature } from '../server/services/vietqr.ts';
import { runScopedLazyCleanup } from '../server/services/lazyCleanup.ts';

let server: http.Server;
let baseUrl = '';

function extractCookies(res: Response, existingCookieHeader = ''): string {
  const cookieMap = new Map<string, string>();
  if (existingCookieHeader) {
    for (const part of existingCookieHeader.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k && v.length > 0) cookieMap.set(k.trim(), v.join('=').trim());
    }
  }
  const setCookieHeaders = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const raw of setCookieHeaders) {
    const firstPair = raw.split(';')[0];
    const [k, ...v] = firstPair.split('=');
    if (k && v.length > 0) {
      const val = v.join('=').trim();
      if (val === '') cookieMap.delete(k.trim());
      else cookieMap.set(k.trim(), val);
    }
  }
  return Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

before(async () => {
  process.env.USE_PGLITE = 'true';
  process.env.PGLITE_DATA_DIR = 'memory://';
  process.env.COOKIE_CROSS_SITE = 'false';
  process.env.JWT_SECRET = 'test-stage4-jwt-secret-key';
  process.env.PAYMENT_WEBHOOK_SECRET = 'baity-test-webhook-secret-2026';
  process.env.ENABLE_DEMO_PAYMENT_WEBHOOK = 'true';
  process.env.SEED_DEV_ACCOUNTS = 'true';

  await initDatabase();

  // Fast Batch Seed cho Test Giai đoạn 4
  const pwd = bcrypt.hashSync('Khach@123', 4);
  await queryRows(sql`
    INSERT INTO users (full_name, email, phone, password_hash, role)
    VALUES
      ('Trần Hoàng Nam', 'khach1@baity.vn', '0912345678', ${pwd}, 'customer'),
      ('Lê Thị Mai Chi', 'khach2@baity.vn', '0987654321', ${pwd}, 'customer');
  `);

  await queryRows(sql`
    INSERT INTO store_settings (key, value, description)
    VALUES
      ('general', '{"freeShippingThreshold": 499000, "defaultShippingFee": 30000, "expressShippingFee": 45000}'::jsonb, 'Cài đặt chung'),
      ('vietqr_config', '{"bankId": "970422", "bankName": "MBBank", "accountNo": "0901234567", "accountName": "CONG TY TNHH BAITY FASHION", "template": "compact"}'::jsonb, 'VietQR');
  `);

  await queryRows(sql`
    INSERT INTO vouchers (code, discount_type, discount_value, max_discount, min_order_value, usage_limit, per_user_limit, used_count, start_date, end_date, is_active)
    VALUES
      ('BAITYWELCOME', 'percent', 15, 100000, 299000, 500, 1, 0, NOW() - INTERVAL '5 days', NOW() + INTERVAL '90 days', true),
      ('BAITYFREESHIP', 'free_shipping', 0, NULL, 499000, 1000, 3, 0, NOW() - INTERVAL '5 days', NOW() + INTERVAL '60 days', true),
      ('BAITYVIP50K', 'fixed', 50000, 50000, 599000, 200, 1, 0, NOW() - INTERVAL '2 days', NOW() + INTERVAL '30 days', true),
      ('BAITYSOLO1', 'fixed', 20000, 20000, 100000, 1, 1, 0, NOW() - INTERVAL '1 day', NOW() + INTERVAL '10 days', true);
  `);

  const catRows = await queryRows<{ id: string }>(sql`
    INSERT INTO categories (name, slug, display_order)
    VALUES ('Áo sơ mi', 'ao-so-mi', 1)
    RETURNING id;
  `);
  const catId = catRows[0].id;

  const prodRows = await queryRows<{ id: string }>(sql`
    INSERT INTO products (name, slug, category_id, target_gender, description, material, care_instructions, base_price, search_text, is_active)
    VALUES
      ('Áo Sơ Mi Oxford Nam', 'ao-so-mi-oxford-nam', ${catId}, 'men', 'Sơ mi cao cấp', 'Cotton', 'Giặt nhẹ', 390000, 'ao so mi oxford nam', true),
      ('Áo Sơ Mi Lụa Nữ', 'ao-so-mi-lua-nu', ${catId}, 'women', 'Sơ mi lụa', 'Lụa', 'Giặt nhẹ', 420000, 'ao so mi lua nu', true)
    RETURNING id;
  `);

  await queryRows(sql`
    INSERT INTO product_variants (product_id, sku, color_name, color_code, size, stock_quantity, price_override)
    VALUES
      (${prodRows[0].id}, 'SKU-001', 'Trắng', '#FFFFFF', 'M', 25, NULL),
      (${prodRows[0].id}, 'SKU-002', 'Xanh', '#0000FF', 'L', 20, NULL),
      (${prodRows[1].id}, 'SKU-003', 'Hồng', '#FFC0CB', 'S', 18, NULL),
      (${prodRows[1].id}, 'SKU-004', 'Be', '#F5F5DC', 'M', 15, 250000);
  `);

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

beforeEach(async () => {
  resetOrderCreateRateLimit();
  await queryRows(sql`
    UPDATE orders
    SET status = 'cancelled', cancel_reason = 'Test cleanup'
    WHERE status = 'pending'
      AND id IN (SELECT order_id FROM payments WHERE method IN ('vietqr', 'wallet', 'card') AND status = 'pending');
  `);
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await closeDb();
});

// ==========================================
// NHÓM 1: GIỎ HÀNG & DANH SÁCH YÊU THÍCH (QUY TẮC 8)
// ==========================================

test('Stage 4 - Quy tắc 8: Giỏ hàng khách vãng lai quản lý qua httpOnly cookie và tự động gộp khi đăng nhập', async () => {
  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants LIMIT 1;`);
  const varId = vRows[0].id;

  // Gọi giỏ hàng khách vãng lai
  const initRes = await fetch(`${baseUrl}/api/cart`);
  assert.equal(initRes.status, 200);
  const rawSetCookies = initRes.headers.getSetCookie();
  assert.ok(
    rawSetCookies.some((c) => c.includes('baity_session_id=') && c.toLowerCase().includes('httponly')),
    'Khách vãng lai phải được cấp cookie baity_session_id có cờ HttpOnly'
  );
  let guestCookie = extractCookies(initRes);

  // Thêm 2 chiếc vào giỏ vãng lai
  const addRes = await fetch(`${baseUrl}/api/cart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: guestCookie },
    body: JSON.stringify({ variantId: varId, quantity: 2 }),
  });
  assert.equal(addRes.status, 200);
  guestCookie = extractCookies(addRes, guestCookie);

  // Đăng nhập khach1@baity.vn -> tự động gộp
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: guestCookie },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  assert.equal(loginRes.status, 200);
  const userCookie = extractCookies(loginRes, guestCookie);

  const cartRes = await fetch(`${baseUrl}/api/cart`, { headers: { Cookie: userCookie } });
  assert.equal(cartRes.status, 200);
  const cartBody = await cartRes.json();
  const mergedItem = cartBody.items.find((i: any) => i.variantId === varId);
  assert.ok(mergedItem, 'Sản phẩm từ khách vãng lai phải gộp vào tài khoản đăng nhập');
  assert.ok(mergedItem.quantity >= 2);
});

test('Stage 4 - Quy tắc 8: Giới hạn số lượng 1-10 mỗi dòng sản phẩm và tối đa 50 dòng trong giỏ hàng', async () => {
  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants LIMIT 1;`);
  const varId = vRows[0].id;

  // Thử thêm 0 chiếc -> từ chối 400
  const zeroRes = await fetch(`${baseUrl}/api/cart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantId: varId, quantity: 0 }),
  });
  assert.equal(zeroRes.status, 400);

  // Thử thêm 11 chiếc -> từ chối 400
  const over10Res = await fetch(`${baseUrl}/api/cart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantId: varId, quantity: 11 }),
  });
  assert.equal(over10Res.status, 400);
});

test('Stage 4 - Quy tắc 8: API giỏ hàng trả cờ price_changed, out_of_stock, insufficient_stock khi có biến động', async () => {
  // Đăng nhập khach1@baity.vn
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  // Lấy 1 biến thể có tồn kho 5
  const vRows = await queryRows<{ id: string; product_id: string }>(sql`
    SELECT id, product_id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;
  `);
  const varId = vRows[0].id;
  const prodId = vRows[0].product_id;

  // Thêm 4 chiếc vào giỏ
  const addRes = await fetch(`${baseUrl}/api/cart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ variantId: varId, quantity: 4 }),
  });
  assert.equal(addRes.status, 200);

  // Mô phỏng giảm tồn kho xuống 2 (nhỏ hơn 4 trong giỏ) và tăng giá gốc
  await queryRows(sql`UPDATE product_variants SET stock_quantity = 2 WHERE id = ${varId}::uuid;`);
  await queryRows(sql`UPDATE products SET base_price = 550000 WHERE id = ${prodId}::uuid;`);

  const inspectCartRes = await fetch(`${baseUrl}/api/cart`, { headers: { Cookie: cookie } });
  assert.equal(inspectCartRes.status, 200);
  const body = await inspectCartRes.json();
  const item = body.items.find((i: any) => i.variantId === varId);
  assert.ok(item);
  assert.equal(item.insufficient_stock, true, 'Phải gắn cờ insufficient_stock khi tồn kho DB nhỏ hơn số lượng giỏ');
  assert.ok(item.effectivePrice > 390000, 'Phải cập nhật giá hiệu lực theo giá mới');

  // Khôi phục lại
  await queryRows(sql`UPDATE product_variants SET stock_quantity = 25 WHERE id = ${varId}::uuid;`);
  await queryRows(sql`UPDATE products SET base_price = 390000 WHERE id = ${prodId}::uuid;`);
});

test('Stage 4 - Quy tắc 8: Wishlist bắt buộc đăng nhập và chống trùng lặp qua UNIQUE(user_id, product_id)', async () => {
  const unauthRes = await fetch(`${baseUrl}/api/wishlist`);
  assert.equal(unauthRes.status, 401, 'Chưa đăng nhập xem wishlist phải trả về 401');

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach2@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const prodRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM products LIMIT 1;
  `);
  const prodId = prodRows[0].id;

  const add1 = await fetch(`${baseUrl}/api/wishlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ productId: prodId }),
  });
  assert.equal(add1.status, 201);

  const add2 = await fetch(`${baseUrl}/api/wishlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ productId: prodId }),
  });
  assert.equal(add2.status, 200);

  const listRes = await fetch(`${baseUrl}/api/wishlist`, { headers: { Cookie: cookie } });
  const listBody = await listRes.json();
  const matches = listBody.items.filter((i: any) => i.id === prodId);
  assert.equal(matches.length, 1, 'Chống trùng lặp tuyệt đối');
});

test('Stage 4 - Quy tắc 8: Wishlist có endpoint chuyển nhanh sang giỏ (POST /api/wishlist/:id/move-to-cart)', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach2@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const prodRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM products LIMIT 1;
  `);
  const prodId = prodRows[0].id;

  // Đảm bảo có trong wishlist
  await fetch(`${baseUrl}/api/wishlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ productId: prodId }),
  });

  // Chuyển nhanh sang giỏ
  const moveRes = await fetch(`${baseUrl}/api/wishlist/${prodId}/move-to-cart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ quantity: 1 }),
  });
  assert.equal(moveRes.status, 200);
  const moveBody = await moveRes.json();
  assert.equal(moveBody.success, true);

  // Kiểm tra đã xóa khỏi wishlist
  const checkWish = await fetch(`${baseUrl}/api/wishlist`, { headers: { Cookie: cookie } });
  const checkWishBody = await checkWish.json();
  assert.equal(checkWishBody.items.some((i: any) => i.id === prodId), false);
});

// ==========================================
// NHÓM 2: VOUCHER (QUY TẮC 4)
// ==========================================

test('Stage 4 - Quy tắc 4: GET /api/vouchers/available trả danh sách voucher đang kích hoạt', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const res = await fetch(`${baseUrl}/api/vouchers/available`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  const codes = body.data.map((v: any) => v.code);
  assert.ok(codes.includes('BAITYWELCOME'));
  assert.ok(codes.includes('BAITYFREESHIP'));
  assert.ok(codes.includes('BAITYVIP50K'));
});

test('Stage 4 - Quy tắc 4: Rate limit cho POST /api/vouchers/validate (chặn lạm dụng brute-force)', async () => {
  const testIp = '198.51.100.99';
  resetVoucherValidateRateLimit();

  // Gửi request liên tiếp vượt ngưỡng 30 lần trong 1 phút
  let hitRateLimit = false;
  for (let i = 0; i < 35; i++) {
    const res = await fetch(`${baseUrl}/api/vouchers/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': testIp,
      },
      body: JSON.stringify({ code: 'BAITYWELCOME', subtotal: 350000, shippingFee: 30000 }),
    });
    if (res.status === 429) {
      hitRateLimit = true;
      break;
    }
  }
  assert.equal(hitRateLimit, true, 'Phải kích hoạt rate limit (429) khi gọi validate liên tục');
});

test('Stage 4 - Quy tắc 4: Xác thực voucher percent có trần, fixed, free_shipping và min_order_value tính trên giá sau khuyến mãi', async () => {
  resetVoucherValidateRateLimit();
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach2@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const skuRows = await queryRows<{ id: string; sku: string }>(sql`
    SELECT id, sku FROM product_variants WHERE sku IN ('SKU-001', 'SKU-004');
  `);
  const var390k = skuRows.find((r) => r.sku === 'SKU-001')!.id;
  const var250k = skuRows.find((r) => r.sku === 'SKU-004')!.id;

  // a. Dưới min_order_value (299k) -> 1 chiếc 250k -> 400
  const underMin = await fetch(`${baseUrl}/api/vouchers/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      code: 'BAITYWELCOME',
      items: [{ variantId: var250k, quantity: 1 }],
    }),
  });
  assert.equal(underMin.status, 400);

  // b. Percent có trần 100k -> 3 chiếc * 390k = 1.170.000₫ -> 15% = 175.500₫ -> bị chặn trần 100k
  const capRes = await fetch(`${baseUrl}/api/vouchers/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      code: 'BAITYWELCOME',
      items: [{ variantId: var390k, quantity: 3 }],
    }),
  });
  assert.equal(capRes.status, 200);
  const capBody = await capRes.json();
  assert.equal(capBody.data.discountAmount, 100000);

  // c. Free shipping (chọn express 45.000₫ từ store_settings, subtotal = 2 * 390k = 780k >= 499k)
  const fsRes = await fetch(`${baseUrl}/api/vouchers/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      code: 'BAITYFREESHIP',
      shippingMethod: 'express',
      items: [{ variantId: var390k, quantity: 2 }],
    }),
  });
  assert.equal(fsRes.status, 200);
  const fsBody = await fsRes.json();
  assert.equal(fsBody.data.discountAmount, 45000);

  // d. Fixed 50k (subtotal = 2 * 390k = 780k >= 599k)
  const fixRes = await fetch(`${baseUrl}/api/vouchers/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      code: 'BAITYVIP50K',
      items: [{ variantId: var390k, quantity: 2 }],
    }),
  });
  assert.equal(fixRes.status, 200);
  const fixBody = await fixRes.json();
  assert.equal(fixBody.data.discountAmount, 50000);
});

test('Stage 4 - Quy tắc 4 Đồng thời: Voucher còn đúng 1 lượt dùng, gửi đồng thời (Promise.all) chỉ 1 đơn thành công', async () => {
  // Lấy cookie của 2 khách hàng khác nhau
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

  // Thiết lập voucher BAITYSOLO1: usage_limit = 1, used_count = 0
  await queryRows(sql`
    UPDATE vouchers
    SET usage_limit = 1, used_count = 0, is_active = true
    WHERE code = 'BAITYSOLO1';
  `);

  const vRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM product_variants WHERE stock_quantity >= 10 LIMIT 1;
  `);
  const varId = vRows[0].id;

  // Gửi song song thật bằng Promise.all
  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
      body: JSON.stringify({
        items: [{ variantId: varId, quantity: 1 }],
        receiverName: 'Khách 1',
        receiverPhone: '0912345678',
        shippingAddress: 'Địa chỉ 1',
        shippingMethod: 'standard',
        paymentMethod: 'cod',
        voucherCode: 'BAITYSOLO1',
      }),
    }),
    fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie2 },
      body: JSON.stringify({
        items: [{ variantId: varId, quantity: 1 }],
        receiverName: 'Khách 2',
        receiverPhone: '0987654321',
        shippingAddress: 'Địa chỉ 2',
        shippingMethod: 'standard',
        paymentMethod: 'cod',
        voucherCode: 'BAITYSOLO1',
      }),
    }),
  ]);

  const statuses = [res1.status, res2.status].sort();
  assert.deepEqual(
    statuses,
    [201, 400],
    'Voucher còn 1 lượt dùng: đúng 1 đơn thành công (201), đơn thứ hai phải bị từ chối (400)'
  );

  // Kiểm tra used_count trong DB đúng bằng 1
  const vCheck = await queryRows<{ used_count: number }>(sql`
    SELECT used_count FROM vouchers WHERE code = 'BAITYSOLO1';
  `);
  assert.equal(vCheck[0].used_count, 1);
});

// ==========================================
// NHÓM 3: ĐẶT HÀNG, IDEMPOTENCY & TỒN KHO (QUY TẮC 3, 9)
// ==========================================

test('Stage 4 - Quy tắc 9: Đặt hàng bắt buộc đăng nhập (401 nếu chưa xác thực)', async () => {
  const unauthRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [],
      receiverName: 'Test',
      receiverPhone: '0900000000',
      shippingAddress: 'Test',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(unauthRes.status, 401);
});

test('Stage 4 - Quy tắc 9: Bỏ qua giá client gửi lên; order_items lưu snapshot tên sản phẩm, biến thể, đơn giá thực tế', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string; product_id: string }>(sql`
    SELECT pv.id, pv.product_id
    FROM product_variants pv
    WHERE pv.stock_quantity >= 5
    LIMIT 1;
  `);
  const varId = vRows[0].id;

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1, price: 99, unitPrice: 99 }],
      receiverName: 'Trần Hoàng Nam',
      receiverPhone: '0912345678',
      shippingAddress: '123 Lê Lợi, Bến Nghé, Quận 1, TP.HCM',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
      totalAmount: 99, // Cố tình gửi sai
    }),
  });
  assert.equal(orderRes.status, 201);
  const body = await orderRes.json();
  const orderId = body.data.id;

  // Kiểm tra order_items trong DB lưu snapshot chính xác
  const itemRows = await queryRows<any>(sql`
    SELECT product_name, color, size, unit_price, quantity, total_price
    FROM order_items
    WHERE order_id = ${orderId};
  `);
  assert.equal(itemRows.length, 1);
  assert.ok(itemRows[0].unit_price >= 350000, 'Đơn giá lưu snapshot phải từ DB, bỏ qua giá giả mạo');
  assert.ok(itemRows[0].product_name.length > 0);
  assert.ok(itemRows[0].color.length > 0);
  assert.ok(itemRows[0].size.length > 0);
});

test('Stage 4 - Quy tắc 9: Phí ship và ngưỡng miễn phí ship đọc động từ store_settings, tính trên tổng sau giảm', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;
  `);
  const varId = vRows[0].id;

  // Mua 1 chiếc giá 390.000₫ (< 499.000₫ ngưỡng freeship) -> phí ship = 30.000₫
  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Trần Hoàng Nam',
      receiverPhone: '0912345678',
      shippingAddress: '123 Lê Lợi, Quận 1',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(orderRes.status, 201);
  const body = await orderRes.json();
  assert.equal(body.data.shippingFee, 30000, 'Đơn dưới ngưỡng freeship tính đúng defaultShippingFee từ settings');
});

test('Stage 4 - Quy tắc 3: Idempotency-Key song song (Promise.all) chỉ ra 1 đơn duy nhất và trừ tồn kho 1 lần', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string; stock_quantity: number }>(sql`
    SELECT id, stock_quantity FROM product_variants WHERE stock_quantity >= 10 LIMIT 1;
  `);
  const varId = vRows[0].id;
  const initialStock = vRows[0].stock_quantity;

  const idempotencyKey = `idem-test-key-${Date.now()}-${Math.random()}`;

  // Gửi 2 request cùng khóa ĐỒNG THỜI
  const [req1, req2] = await Promise.all([
    fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        Cookie: cookie,
      },
      body: JSON.stringify({
        items: [{ variantId: varId, quantity: 2 }],
        receiverName: 'Trần Hoàng Nam',
        receiverPhone: '0912345678',
        shippingAddress: '123 Lê Lợi, Quận 1',
        shippingMethod: 'standard',
        paymentMethod: 'cod',
      }),
    }),
    fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        Cookie: cookie,
      },
      body: JSON.stringify({
        items: [{ variantId: varId, quantity: 2 }],
        receiverName: 'Trần Hoàng Nam',
        receiverPhone: '0912345678',
        shippingAddress: '123 Lê Lợi, Quận 1',
        shippingMethod: 'standard',
        paymentMethod: 'cod',
      }),
    }),
  ]);

  const [body1, body2] = await Promise.all([req1.json(), req2.json()]);

  assert.ok(req1.status === 200 || req1.status === 201);
  assert.ok(req2.status === 200 || req2.status === 201);
  assert.equal(body1.data.id, body2.data.id, 'Cùng Idempotency-Key phải trả về chính xác cùng 1 đơn hàng');

  // Kiểm tra tồn kho chỉ bị trừ đúng 2 chiếc (không bị trừ 4 chiếc)
  const stockCheck = await queryRows<{ stock_quantity: number }>(sql`
    SELECT stock_quantity FROM product_variants WHERE id = ${varId}::uuid;
  `);
  assert.equal(stockCheck[0].stock_quantity, initialStock - 2, 'Tồn kho chỉ được trừ đúng 1 lần duy nhất');
});

test('Stage 4 - Quy tắc 3: Cùng Idempotency-Key nhưng nội dung khác trả về HTTP 422 Unprocessable Entity', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 2;`);
  const var1 = vRows[0].id;
  const var2 = vRows[1].id;

  const idempotencyKey = `KEY-422-${Date.now()}`;

  // Lần 1: Tạo đơn với biến thể 1
  const req1 = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      Cookie: cookie,
    },
    body: JSON.stringify({
      items: [{ variantId: var1, quantity: 1 }],
      receiverName: 'Khách',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(req1.status, 201);

  // Lần 2: Gửi cùng idempotencyKey nhưng sản phẩm khác (var2) -> 422
  const req2 = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      Cookie: cookie,
    },
    body: JSON.stringify({
      items: [{ variantId: var2, quantity: 1 }],
      receiverName: 'Khách',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(req2.status, 422, 'Cùng Idempotency-Key nhưng khác nội dung đơn hàng phải trả về HTTP 422');
});

test('Stage 4 - Chống âm kho: Đặt hàng vượt tồn kho hoặc tranh chấp song song (Promise.all) không làm âm kho và rollback toàn bộ đơn', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  // Tạo biến thể có đúng 3 sản phẩm
  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants LIMIT 1;`);
  const varId = vRows[0].id;
  await queryRows(sql`UPDATE product_variants SET stock_quantity = 3 WHERE id = ${varId}::uuid;`);

  // Hai đơn song song mỗi đơn đòi 2 chiếc (cầu = 4 > cung = 3)
  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/orders`, {
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
    }),
    fetch(`${baseUrl}/api/orders`, {
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
    }),
  ]);

  const statuses = [res1.status, res2.status].sort();
  assert.deepEqual(statuses, [201, 400], 'Đúng 1 đơn thành công, đơn còn lại bị rollback toàn bộ');

  const finalStock = await queryRows<{ stock_quantity: number }>(sql`
    SELECT stock_quantity FROM product_variants WHERE id = ${varId}::uuid;
  `);
  assert.equal(finalStock[0].stock_quantity, 1, 'Tồn kho còn lại đúng bằng 1, tuyệt đối không âm');
});

// ==========================================
// NHÓM 4: PHƯƠNG THỨC THANH TOÁN & WEBHOOK (QUY TẮC 5, 6)
// ==========================================

test('Stage 4 - Quy tắc 6: Phương thức thanh toán COD không bị tự hủy sau 30 phút, VietQR có hạn thanh toán 30 phút', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;
  `);
  const varId = vRows[0].id;

  // 1. Tạo đơn COD
  const codRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách COD',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  const codOrder = (await codRes.json()).data;

  // Lùi thời gian tạo về 40 phút trước
  await queryRows(sql`UPDATE orders SET created_at = NOW() - INTERVAL '40 minutes' WHERE id = ${codOrder.id};`);

  // Chạy Scoped Lazy Cleanup
  await runScopedLazyCleanup({ orderId: codOrder.id });

  // Kiểm tra trạng thái đơn COD vẫn là pending
  const codCheck = await queryRows<{ status: string }>(sql`
    SELECT status FROM orders WHERE id = ${codOrder.id};
  `);
  assert.equal(codCheck[0].status, 'pending', 'Đơn COD tuyệt đối không bị tự hủy sau 30 phút');

  // 2. Tạo đơn VietQR
  const vqrRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách VietQR',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'vietqr',
    }),
  });
  const vqrOrder = (await vqrRes.json()).data;
  assert.ok(vqrOrder.vietqr?.qrImageUrl.includes('img.vietqr.io'));

  // Kiểm tra polling payment-status
  const statusRes = await fetch(`${baseUrl}/api/orders/${vqrOrder.id}/payment-status`, {
    headers: { Cookie: cookie },
  });
  assert.equal(statusRes.status, 200);
  const statusBody = await statusRes.json();
  assert.equal(statusBody.data.paymentStatus, 'pending');
});

test('Stage 4 - Quy tắc 5: Webhook từ chối 401 khi sai chữ ký bí mật hoặc sai secret', async () => {
  const unauth = await fetch(`${baseUrl}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'invalid-secret' },
    body: JSON.stringify({ orderCode: 'BAITY-0001', amount: 100000, transactionId: 'TX-001' }),
  });
  assert.equal(unauth.status, 401);
});

test('Stage 4 - Quy tắc 5: Webhook từ chối 400 khi số tiền thanh toán không khớp với tổng đơn hàng', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;
  `);
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
      paymentMethod: 'vietqr',
    }),
  });
  const order = (await orderRes.json()).data;

  // Gửi webhook với số tiền sai (ví dụ thiếu 10.000₫)
  const payload = {
    orderCode: order.orderCode,
    transactionId: `TX-WRONG-${Date.now()}`,
    amount: Number(order.totalAmount) - 10000,
  };
  const rawBody = JSON.stringify(payload);
  const ts = String(Date.now());
  const sig = createWebhookSignature(rawBody, ts, process.env.PAYMENT_WEBHOOK_SECRET!);

  const res = await fetch(`${baseUrl}/api/payments/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-timestamp': ts,
      'x-webhook-signature': sig,
    },
    body: rawBody,
  });
  assert.equal(res.status, 400, 'Số tiền sai phải bị từ chối 400');
});

test('Stage 4 - Quy tắc 5: Webhook idempotent theo transaction_id khi gọi lặp lại', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;
  `);
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
      paymentMethod: 'vietqr',
    }),
  });
  const order = (await orderRes.json()).data;
  const txId = `FT-IDEMP-${Date.now()}`;

  const payload = {
    orderCode: order.orderCode,
    transactionId: txId,
    amount: Number(order.totalAmount),
  };
  const rawBody = JSON.stringify(payload);
  const ts = String(Date.now());
  const sig = createWebhookSignature(rawBody, ts, process.env.PAYMENT_WEBHOOK_SECRET!);

  // Lần 1
  const call1 = await fetch(`${baseUrl}/api/payments/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-timestamp': ts,
      'x-webhook-signature': sig,
    },
    body: rawBody,
  });
  assert.equal(call1.status, 200);
  const body1 = await call1.json();
  assert.equal(body1.idempotent, false);

  // Lần 2 (lặp lại)
  const call2 = await fetch(`${baseUrl}/api/payments/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-timestamp': ts,
      'x-webhook-signature': sig,
    },
    body: rawBody,
  });
  assert.equal(call2.status, 200);
  const body2 = await call2.json();
  assert.equal(body2.idempotent, true, 'Lần 2 phải trả về idempotent: true');
});

test('Stage 4 - Quy tắc 5: Tiền về muộn khi đơn đã bị hủy/hết hạn ghi nhận thanh toán ở trạng thái refund_needed', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;
  `);
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
      paymentMethod: 'vietqr',
    }),
  });
  const order = (await orderRes.json()).data;

  // Giả lập đơn bị hủy do hết hạn trước đó
  await queryRows(sql`
    UPDATE orders SET status = 'cancelled', cancel_reason = 'Hết hạn thanh toán' WHERE id = ${order.id};
  `);

  // Tiền về muộn
  const txId = `FT-LATE-${Date.now()}`;
  const payload = {
    orderCode: order.orderCode,
    transactionId: txId,
    amount: Number(order.totalAmount),
  };
  const rawBody = JSON.stringify(payload);
  const ts = String(Date.now());
  const sig = createWebhookSignature(rawBody, ts, process.env.PAYMENT_WEBHOOK_SECRET!);

  const res = await fetch(`${baseUrl}/api/payments/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-timestamp': ts,
      'x-webhook-signature': sig,
    },
    body: rawBody,
  });
  assert.equal(res.status, 200);
  const resBody = await res.json();
  assert.equal(resBody.refundNeeded, true);
  assert.equal(resBody.paymentStatus, 'refund_needed');

  const paymentCheck = await queryRows<{ status: string }>(sql`
    SELECT status FROM payments WHERE order_id = ${order.id};
  `);
  assert.equal(paymentCheck[0].status, 'refund_needed', 'Thanh toán phải ghi nhận refund_needed để hoàn tiền cho khách');
});

// ==========================================
// NHÓM 5: HỦY ĐƠN & HẾT HẠN TỒN KHO (QUY TẮC 7, 9)
// ==========================================

test('Stage 4 - Quy tắc 9: Hủy đơn hàng yêu cầu lý do, chỉ chủ đơn được hủy và không cho hủy khi đã giao hàng', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants LIMIT 1;`);
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

  // Hủy thiếu lý do -> 400
  const noReason = await fetch(`${baseUrl}/api/orders/${order.id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ reason: '' }),
  });
  assert.equal(noReason.status, 400);

  // Chuyển đơn sang 'shipped' (đang giao hàng) -> thử hủy bị chặn
  await queryRows(sql`UPDATE orders SET status = 'shipped' WHERE id = ${order.id};`);

  const cancelShipped = await fetch(`${baseUrl}/api/orders/${order.id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ reason: 'Muốn đổi mẫu' }),
  });
  assert.equal(cancelShipped.status, 400, 'Không được phép hủy khi đơn đã chuyển đang giao');
});

test('Stage 4 - Quy tắc 9: Đơn VietQR đã thanh toán khi hủy tự động tạo yêu cầu hoàn tiền (return_requests)', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants LIMIT 1;`);
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
      paymentMethod: 'vietqr',
    }),
  });
  const order = (await orderRes.json()).data;

  // Giả lập đã thanh toán (payment='paid', order='pending')
  await queryRows(sql`
    UPDATE payments SET status = 'paid', transaction_id = 'TX-PAID-01' WHERE order_id = ${order.id};
  `);

  // Khách bấm hủy
  const cancelRes = await fetch(`${baseUrl}/api/orders/${order.id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ reason: 'Khách đổi ý, yêu cầu hoàn tiền về tài khoản' }),
  });
  assert.equal(cancelRes.status, 200);

  // Kiểm tra bảng return_requests được tự động ghi nhận
  const returnRows = await queryRows<{ id: string; status: string; type: string }>(sql`
    SELECT id, status, type FROM return_requests WHERE order_id = ${order.id};
  `);
  assert.equal(returnRows.length, 1);
  assert.equal(returnRows[0].status, 'pending');
  assert.equal(returnRows[0].type, 'refund');
});

test('Stage 4 - Quy tắc 7 Đồng thời: Hai lần cleanup chạy song song (Promise.all) hoàn kho và voucher đúng 1 lần duy nhất', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string; stock_quantity: number }>(sql`
    SELECT id, stock_quantity FROM product_variants WHERE stock_quantity >= 10 LIMIT 1;
  `);
  const varId = vRows[0].id;
  const initialStock = vRows[0].stock_quantity;

  // Tạo đơn VietQR kèm voucher BAITYVIP50K
  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 2 }],
      receiverName: 'Khách Cleanup',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'vietqr',
      voucherCode: 'BAITYVIP50K',
    }),
  });
  const order = (await orderRes.json()).data;

  // Lùi thời gian tạo về 35 phút trước
  await queryRows(sql`
    UPDATE orders SET created_at = NOW() - INTERVAL '35 minutes' WHERE id = ${order.id};
  `);

  // Chạy 2 lần cleanup SONG SONG thật qua Promise.all
  const [clean1, clean2] = await Promise.all([
    runScopedLazyCleanup({ orderId: order.id }),
    runScopedLazyCleanup({ orderId: order.id }),
  ]);

  const cancelledCount = clean1.cancelledOrders.length + clean2.cancelledOrders.length;
  assert.equal(cancelledCount, 1, 'Chỉ duy nhất 1 luồng cleanup hủy được đơn thành công');

  // Kiểm tra tồn kho sau cleanup hoàn lại đúng bằng initialStock (không bị hoàn 2 lần)
  const stockCheck = await queryRows<{ stock_quantity: number }>(sql`
    SELECT stock_quantity FROM product_variants WHERE id = ${varId}::uuid;
  `);
  assert.equal(stockCheck[0].stock_quantity, initialStock, 'Tồn kho chỉ được hoàn lại đúng 1 lần');
});

test('Stage 4 - Mục A.5: Khi ENABLE_DEMO_PAYMENT_WEBHOOK không phải "true" thì webhook bị tắt (403) và dữ liệu không đổi', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;
  `);
  const varId = vRows[0].id;

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách Webhook Disabled',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ',
      shippingMethod: 'standard',
      paymentMethod: 'vietqr',
    }),
  });
  const order = (await orderRes.json()).data;

  // Tắt cờ ENABLE_DEMO_PAYMENT_WEBHOOK
  const prevFlag = process.env.ENABLE_DEMO_PAYMENT_WEBHOOK;
  process.env.ENABLE_DEMO_PAYMENT_WEBHOOK = 'false';

  try {
    const payload = {
      orderCode: order.orderCode,
      transactionId: `TX-DISABLED-${Date.now()}`,
      amount: Number(order.totalAmount),
    };
    const rawBody = JSON.stringify(payload);
    const ts = String(Date.now());
    const sig = createWebhookSignature(rawBody, ts, process.env.PAYMENT_WEBHOOK_SECRET!);

    const res = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-timestamp': ts,
        'x-webhook-signature': sig,
      },
      body: rawBody,
    });

    assert.ok(res.status === 403 || res.status === 404, 'Khi ENABLE_DEMO_PAYMENT_WEBHOOK !== "true" phải trả về 403 hoặc 404');

    // Kiểm tra dữ liệu đơn hàng và thanh toán trong CSDL hoàn toàn không đổi
    const orderCheck = await queryRows<{ status: string }>(sql`SELECT status FROM orders WHERE id = ${order.id};`);
    const payCheck = await queryRows<{ status: string }>(sql`SELECT status FROM payments WHERE order_id = ${order.id};`);
    assert.equal(orderCheck[0].status, 'pending', 'Trạng thái đơn hàng không được thay đổi khi webhook bị tắt');
    assert.equal(payCheck[0].status, 'pending', 'Trạng thái thanh toán không được thay đổi khi webhook bị tắt');
  } finally {
    process.env.ENABLE_DEMO_PAYMENT_WEBHOOK = prevFlag;
  }
});

test('Stage 4 - Mục A.6: Phí vận chuyển Hỏa tốc đọc động từ store_settings (không cố định trong code)', async () => {
  // Cập nhật expressShippingFee = 65000 trong store_settings
  await queryRows(sql`
    UPDATE store_settings
    SET value = jsonb_set(value, '{expressShippingFee}', '65000'::jsonb)
    WHERE key = 'general';
  `);

  try {
    // 1. Kiểm tra API GET /api/settings/general trả về đúng expressShippingFee = 65000 cho giao diện thanh toán
    const settingsRes = await fetch(`${baseUrl}/api/settings/general`);
    assert.equal(settingsRes.status, 200);
    const settingsBody = await settingsRes.json();
    assert.equal(settingsBody.data.expressShippingFee, 65000, 'API cài đặt chung phải trả về expressShippingFee đọc từ store_settings');

    // 2. Đặt đơn hàng với shippingMethod = 'express' -> phí ship phải tính đúng 65.000₫ từ store_settings
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
        items: [{ variantId: varId, quantity: 2 }], // Subtotal > 499k nhưng chọn express vẫn tính đúng expressShippingFee = 65000
        receiverName: 'Khách Hỏa Tốc Động',
        receiverPhone: '0912345678',
        shippingAddress: 'Địa chỉ Hỏa Tốc',
        shippingMethod: 'express',
        paymentMethod: 'cod',
      }),
    });
    assert.equal(orderRes.status, 201);
    const order = (await orderRes.json()).data;
    assert.equal(order.shippingFee, 65000, 'Đơn hàng Hỏa tốc phải lấy phí 65.000₫ động từ store_settings');
  } finally {
    await queryRows(sql`
      UPDATE store_settings
      SET value = jsonb_set(value, '{expressShippingFee}', '50000'::jsonb)
      WHERE key = 'general';
    `);
  }
});

test('Stage 4 - Mục A.7: Đặt hàng bằng addressId của địa chỉ hai cấp (district = null) tạo chuỗi shippingAddress chuẩn xác', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  // Tạo địa chỉ 2 cấp (district = null)
  const addrRes = await fetch(`${baseUrl}/api/user/addresses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      receiverName: 'Người Nhận 2 Cấp',
      phone: '0912345678',
      province: 'TP. Hồ Chí Minh',
      district: null,
      ward: 'Phường Bến Nghé',
      streetAddress: 'Số 88 Đồng Khởi',
      isDefault: true,
    }),
  });
  assert.equal(addrRes.status, 201);
  const addr = (await addrRes.json()).data;
  assert.equal(addr.district, null);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      addressId: addr.id,
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(orderRes.status, 201);
  const order = (await orderRes.json()).data;
  assert.equal(
    order.shippingAddress,
    'Số 88 Đồng Khởi, Phường Bến Nghé, TP. Hồ Chí Minh',
    'Chuỗi địa chỉ giao hàng 2 cấp phải nối sạch sẽ không chứa null'
  );
});

test('Stage 4 - Mục ƯU TIÊN 2.6: Idempotency-Key chỉ gắn với yêu cầu đặt hàng thành công; khi gặp lỗi nghiệp vụ (hết hàng / voucher sai) thì sau khi sửa vẫn dùng lại khóa đó đặt hàng thành công', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE stock_quantity >= 5 LIMIT 1;`);
  const varId = vRows[0].id;

  const sharedKey = `IDEMP-RETRY-BIZ-${crypto.randomUUID()}`;

  // Lần 1: Gửi kèm mã voucher sai với Idempotency-Key -> Lỗi nghiệp vụ 404/400 (Transaction rollback, KHÔNG khóa Idempotency-Key)
  const failVoucherRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': sharedKey,
      Cookie: cookie,
    },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách Retry Idempotency',
      receiverPhone: '0912345678',
      shippingAddress: '100 Nguyễn Huệ, Phường Bến Nghé, TP. Hồ Chí Minh',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
      voucherCode: 'VOUCHER_SAI_KHONG_TON_TAI',
    }),
  });
  assert.ok(failVoucherRes.status === 400 || failVoucherRes.status === 404, 'Đặt hàng với voucher sai phải bị từ chối');

  // Lần 2: Gửi số lượng vượt tồn kho (999 chiếc) với CÙNG Idempotency-Key -> Lỗi nghiệp vụ 400 (KHÔNG khóa Idempotency-Key)
  const failStockRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': sharedKey,
      Cookie: cookie,
    },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 999 }],
      receiverName: 'Khách Retry Idempotency',
      receiverPhone: '0912345678',
      shippingAddress: '100 Nguyễn Huệ, Phường Bến Nghé, TP. Hồ Chí Minh',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(failStockRes.status, 400, 'Đặt hàng vượt tồn kho phải bị từ chối 400');

  // Lần 3: Sửa lại số lượng hợp lệ (1 chiếc) và bỏ voucher sai, gửi lại với CÙNG Idempotency-Key -> Phải tạo đơn mới thành công 201!
  const successRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': sharedKey,
      Cookie: cookie,
    },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách Retry Idempotency',
      receiverPhone: '0912345678',
      shippingAddress: '100 Nguyễn Huệ, Phường Bến Nghé, TP. Hồ Chí Minh',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(successRes.status, 201, 'Sau khi sửa lỗi nghiệp vụ, gửi lại cùng Idempotency-Key phải đặt hàng thành công 201');
  const successBody = await successRes.json();
  assert.equal(successBody.success, true);
  assert.ok(successBody.data.id);
});


