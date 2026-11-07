import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { createApp } from '../server/app.ts';
import { initDatabase } from '../server/db/init.ts';
import { queryRows, closeDb, getDb } from '../server/db/index.ts';
import { resetLoginRateLimit } from '../server/services/auth.ts';
import { resetVoucherValidateRateLimit } from '../server/routes/vouchers.ts';
import { sql } from 'drizzle-orm';

let server: http.Server;
let baseUrl = '';
const APP_ORIGIN = 'https://ais-dev-preview.run.app';

/**
 * Mô phỏng chính xác Cookie Jar của trình duyệt khi chạy trong cross-site iframe (như AI Studio preview):
 * - Chỉ lưu và gửi lại cookie nếu Set-Cookie có đầy đủ `SameSite=None` và `Secure` (khi ở chế độ crossSiteIframe = true).
 * - Nếu cookie chỉ có `SameSite=Lax` hoặc thiếu `Secure`, trình duyệt trong cross-site iframe sẽ chặn (drop) cookie đó.
 */
class BrowserCookieJar {
  private cookies = new Map<string, string>();
  private crossSiteIframe: boolean;

  constructor(crossSiteIframe = true) {
    this.crossSiteIframe = crossSiteIframe;
  }

  captureFromResponse(res: Response) {
    const rawSetCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const raw of rawSetCookies) {
      const parts = raw.split(';').map((p) => p.trim());
      const [nameVal, ...attrs] = parts;
      const eqIdx = nameVal.indexOf('=');
      if (eqIdx === -1) continue;
      const name = nameVal.slice(0, eqIdx).trim();
      const val = nameVal.slice(eqIdx + 1).trim();

      const lowerAttrs = attrs.map((a) => a.toLowerCase());
      const hasSameSiteNone = lowerAttrs.some((a) => a === 'samesite=none');
      const hasSecure = lowerAttrs.some((a) => a === 'secure');

      // Trong iframe khác tên miền (AI Studio), trình duyệt từ chối lưu cookie nếu không phải SameSite=None; Secure
      if (this.crossSiteIframe && (!hasSameSiteNone || !hasSecure)) {
        continue;
      }

      if (val === '' || lowerAttrs.some((a) => a.startsWith('max-age=0'))) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, val);
      }
    }
  }

  getCookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers || {});
    const cookieHeader = this.getCookieHeader();
    if (cookieHeader) {
      headers.set('Cookie', cookieHeader);
    }
    if (!headers.has('X-Forwarded-Proto')) {
      headers.set('X-Forwarded-Proto', 'https');
    }
    if (!headers.has('Origin') && init.method && init.method !== 'GET' && init.method !== 'HEAD') {
      headers.set('Origin', APP_ORIGIN);
    }
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    });
    this.captureFromResponse(res);
    return res;
  }
}

before(async () => {
  process.env.USE_PGLITE = 'true';
  process.env.PGLITE_DATA_DIR = 'memory://';
  process.env.JWT_SECRET = 'test-ui-bugs-jwt-secret-key-2026';
  process.env.COOKIE_CROSS_SITE = 'true';
  process.env.TRUST_PROXY_HOPS = '1';
  process.env.ALLOWED_ORIGINS = APP_ORIGIN;

  await initDatabase();

  const pwd = bcrypt.hashSync('Khach@123', 4);
  const adminPwd = bcrypt.hashSync('Admin@123', 4);
  await queryRows(sql`
    INSERT INTO users (full_name, email, phone, password_hash, role)
    VALUES
      ('Quản Trị Viên', 'admin@baity.vn', '0900000001', ${adminPwd}, 'admin'),
      ('Trần Hoàng Nam', 'khach1@baity.vn', '0912345678', ${pwd}, 'customer'),
      ('Lê Thị Mai Chi', 'khach2@baity.vn', '0987654321', ${pwd}, 'customer')
    ON CONFLICT (email) DO NOTHING;
  `);

  await queryRows(sql`
    INSERT INTO store_settings (key, value, description)
    VALUES
      ('general', '{"freeShippingThreshold": 499000, "defaultShippingFee": 30000, "expressShippingFee": 45000}'::jsonb, 'Cài đặt chung'),
      ('vietqr_config', '{"bankId": "MB", "bankName": "MBBank", "accountNo": "0987654321", "accountName": "CONG TY TNHH THOI TRANG BAITY", "template": "compact2"}'::jsonb, 'VietQR')
    ON CONFLICT (key) DO NOTHING;
  `);

  await queryRows(sql`
    INSERT INTO vouchers (code, discount_type, discount_value, max_discount, min_order_value, usage_limit, per_user_limit, used_count, start_date, end_date, is_active)
    VALUES
      ('BAITYWELCOME', 'percent', 15, 100000, 299000, 500, 5, 0, NOW() - INTERVAL '5 days', NOW() + INTERVAL '90 days', true),
      ('BAITYFREESHIP', 'free_shipping', 0, NULL, 499000, 1000, 3, 0, NOW() - INTERVAL '5 days', NOW() + INTERVAL '60 days', true),
      ('BAITYVIP50K', 'fixed', 50000, 50000, 599000, 200, 2, 0, NOW() - INTERVAL '2 days', NOW() + INTERVAL '30 days', true)
    ON CONFLICT (code) DO NOTHING;
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
      ('Áo Sơ Mi Oxford Nam', 'ao-so-mi-oxford-nam', ${catId}, 'men', 'Sơ mi cao cấp', 'Cotton', 'Giặt nhẹ', 349000, 'ao so mi oxford nam', true),
      ('Áo Thun Pima Nam', 'ao-thun-pima-nam', ${catId}, 'men', 'Áo thun mịn', 'Cotton Pima', 'Giặt nhẹ', 219000, 'ao thun pima nam', true)
    RETURNING id;
  `);

  await queryRows(sql`
    INSERT INTO product_variants (product_id, sku, color_name, color_code, size, stock_quantity, price_override)
    VALUES
      (${prodRows[0].id}, 'UI-SKU-001', 'Trắng', '#FFFFFF', 'L', 25, NULL),
      (${prodRows[1].id}, 'UI-SKU-002', 'Đen', '#000000', 'M', 25, NULL);
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

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await closeDb();
});

// ==========================================
// TEST L1 (VÀ H1): ĐẶT HÀNG SAU KHI ĐĂNG NHẬP TRONG CROSS-SITE IFRAME + CHỐNG CSRF
// ==========================================
test('UI Bug L1 & H1: Đăng nhập trong cross-site iframe giữ được cookie baity_token (SameSite=None; Secure), đặt hàng thành công và chặn CSRF từ Origin lạ', async () => {
  const jar = new BrowserCookieJar(true);
  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE sku = 'UI-SKU-001' LIMIT 1;`);
  const varId = vRows[0].id;

  // 1. Đăng nhập tài khoản khách
  const loginRes = await jar.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  assert.equal(loginRes.status, 200);
  assert.ok(
    jar.getCookieHeader().includes('baity_token='),
    'Khi COOKIE_CROSS_SITE=true, cookie baity_token phải có SameSite=None; Secure để trình duyệt trong iframe lưu lại'
  );

  // 2. Bấm "Đặt hàng" (POST /api/orders) -> Không được báo 401 chưa đăng nhập
  const orderRes = await jar.fetch('/api/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `L1-KEY-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Trần Hoàng Nam',
      receiverPhone: '0912345678',
      shippingAddress: '123 Lê Lợi, Phường Bến Nghé, TP. Hồ Chí Minh',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(orderRes.status, 201, 'Đặt hàng sau khi đăng nhập trong iframe phải trả về 201, không bị 401');

  // 3. Kiểm tra chống CSRF: Request thay đổi dữ liệu từ Origin độc hại phải bị chặn 403 kèm định dạng { error: { code, message } }
  const csrfRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: jar.getCookieHeader(),
      Origin: 'https://evil-csrf-site.example.com',
    },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'CSRF Attacker',
      receiverPhone: '0912345678',
      shippingAddress: 'Địa chỉ giả',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(csrfRes.status, 403, 'Request từ Origin lạ khi bật COOKIE_CROSS_SITE=true phải bị chặn 403 CSRF');
  const csrfBody = await csrfRes.json();
  assert.ok(csrfBody.error?.code && csrfBody.error?.message, 'Lỗi trả về phải theo cấu trúc { error: { code, message } }');
});

// ==========================================
// TEST CSRF/ORIGIN: ORIGIN CÙNG HOST (HOST / X-FORWARDED-HOST) ĐƯỢC PHÉP, ORIGIN LẠ BỊ TỪ CHỐI 403 KÈM GHI LOG SERVER, KHÔNG CHẤP NHẬN "*"
// ==========================================
test('CSRF/Origin Check: Origin trùng với Host hoặc X-Forwarded-Host của chính server được phép; Origin lạ bị từ chối với 403 kèm ghi log địa chỉ Origin bị từ chối; không chấp nhận "*"', async () => {
  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE sku = 'UI-SKU-001' LIMIT 1;`);
  const varId = vRows[0].id;

  const prevAllowed = process.env.ALLOWED_ORIGINS;
  const prevAppUrl = process.env.APP_URL;

  try {
    // 1. Xóa ALLOWED_ORIGINS và APP_URL để chứng minh ALLOWED_ORIGINS chỉ là danh sách bổ sung,
    //    Origin trùng với Host trực tiếp của server vẫn được phép (200)
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.APP_URL;

    const serverHost = new URL(baseUrl).host; // 127.0.0.1:<port>
    const sameHostOrigin = `http://${serverHost}`;

    const sameHostRes = await fetch(`${baseUrl}/api/cart`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: sameHostOrigin,
      },
      body: JSON.stringify({ variantId: varId, quantity: 1 }),
    });
    assert.equal(
      sameHostRes.status,
      200,
      'Origin trùng với Host của chính server phải được phép (200) ngay cả khi không khai báo ALLOWED_ORIGINS'
    );

    // 2. Origin trùng với X-Forwarded-Host (sau khi tin proxy) được phép (200), kể cả khi X-Forwarded-Host có :443
    const proxyHost = 'ais-dev-vln6nr2k4zxgxwx7eabgxn-963538502110.asia-east1.run.app';
    const forwardedRes = await fetch(`${baseUrl}/api/cart`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': `${proxyHost}:443`,
        Origin: `https://${proxyHost}`,
      },
      body: JSON.stringify({ variantId: varId, quantity: 1 }),
    });
    assert.equal(
      forwardedRes.status,
      200,
      'Origin trùng với X-Forwarded-Host của chính server phải được phép (200)'
    );

    // 3. Origin lạ bị từ chối với 403 và server ghi vào log địa chỉ Origin bị từ chối (kể cả khi ALLOWED_ORIGINS bị đặt thành "*")
    process.env.ALLOWED_ORIGINS = '*';
    const capturedWarnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => {
      capturedWarnings.push(args.map((a) => String(a)).join(' '));
      origWarn(...args);
    };

    const foreignOrigin = 'https://malicious-foreign-origin.attacker.org';
    try {
      const rejectRes = await fetch(`${baseUrl}/api/cart`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': proxyHost,
          Origin: foreignOrigin,
        },
        body: JSON.stringify({ variantId: varId, quantity: 1 }),
      });
      assert.equal(rejectRes.status, 403, 'Origin lạ phải bị từ chối với HTTP 403 (không chấp nhận "*")');
      const rejectBody = await rejectRes.json();
      assert.equal(rejectBody.error?.code, 'CSRF_ORIGIN_MISMATCH');
    } finally {
      console.warn = origWarn;
    }

    assert.ok(
      capturedWarnings.some((msg) => msg.includes(foreignOrigin)),
      `Log phía server phải ghi rõ địa chỉ Origin bị từ chối (${foreignOrigin})`
    );
  } finally {
    if (prevAllowed !== undefined) process.env.ALLOWED_ORIGINS = prevAllowed;
    else delete process.env.ALLOWED_ORIGINS;
    if (prevAppUrl !== undefined) process.env.APP_URL = prevAppUrl;
    else delete process.env.APP_URL;
  }
});

// ==========================================
// TEST L3: THÊM VÀO GIỎ HÀNG NHIỀU MẶT HÀNG VÀ CÙNG BIẾN THỂ NHIỀU LẦN TRONG IFRAME
// ==========================================
test('UI Bug L3: Thêm liên tiếp 2 mặt hàng khác nhau và thêm trùng biến thể trong iframe không làm mất món cũ và tăng đúng số lượng', async () => {
  const jar = new BrowserCookieJar(true);
  const vRows = await queryRows<{ id: string; sku: string }>(sql`
    SELECT id, sku FROM product_variants WHERE sku IN ('UI-SKU-001', 'UI-SKU-002') ORDER BY sku ASC;
  `);
  const var1 = vRows[0].id;
  const var2 = vRows[1].id;

  // Lần 1: Thêm món 1 (số lượng 1)
  const add1 = await jar.fetch('/api/cart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantId: var1, quantity: 1 }),
  });
  assert.equal(add1.status, 200);
  const body1 = await add1.json();
  assert.equal(body1.items.length, 1);
  assert.equal(body1.items[0].quantity, 1);

  // Lần 2: Thêm món 2 khác biến thể (số lượng 1) -> Giỏ hàng phải có đủ 2 mặt hàng (món 1 không biến mất)
  const add2 = await jar.fetch('/api/cart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantId: var2, quantity: 1 }),
  });
  assert.equal(add2.status, 200);
  const body2 = await add2.json();
  assert.equal(body2.items.length, 2, 'Thêm món thứ hai không được làm mất món thứ nhất');

  // Lần 3: Thêm lại món 1 thêm 2 chiếc -> Số lượng món 1 phải tăng lên 3 (không bị giữ nguyên ở 1)
  const add3 = await jar.fetch('/api/cart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantId: var1, quantity: 2 }),
  });
  assert.equal(add3.status, 200);
  const body3 = await add3.json();
  const item1After = body3.items.find((i: any) => i.variantId === var1);
  assert.equal(item1After?.quantity, 3, 'Thêm trùng biến thể phải cộng dồn số lượng lên 3');
});

// ==========================================
// TEST L4: TĂNG/GIẢM SỐ LƯỢNG VÀ XÓA MẶT HÀNG TRONG GIỎ HÀNG TRONG IFRAME
// ==========================================
test('UI Bug L4: Tăng/giảm số lượng (PUT /api/cart/:id) và xóa mặt hàng (DELETE /api/cart/:id) hoạt động chính xác trong iframe', async () => {
  const jar = new BrowserCookieJar(true);
  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE sku = 'UI-SKU-001' LIMIT 1;`);
  const varId = vRows[0].id;

  const addRes = await jar.fetch('/api/cart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantId: varId, quantity: 2 }),
  });
  const addBody = await addRes.json();
  const cartItemId = addBody.items[0].id;

  // Tăng số lượng lên 4
  const incRes = await jar.fetch(`/api/cart/${cartItemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 4 }),
  });
  assert.equal(incRes.status, 200, 'Tăng số lượng trong giỏ hàng phải trả về 200');
  const incBody = await incRes.json();
  assert.equal(incBody.items[0].quantity, 4);

  // Giảm số lượng xuống 1
  const decRes = await jar.fetch(`/api/cart/${cartItemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 1 }),
  });
  assert.equal(decRes.status, 200, 'Giảm số lượng trong giỏ hàng phải trả về 200');
  const decBody = await decRes.json();
  assert.equal(decBody.items[0].quantity, 1);

  // Xóa mặt hàng khỏi giỏ
  const delRes = await jar.fetch(`/api/cart/${cartItemId}`, {
    method: 'DELETE',
  });
  assert.equal(delRes.status, 200, 'Xóa mặt hàng khỏi giỏ phải trả về 200');
  const delBody = await delRes.json();
  assert.equal(delBody.items.length, 0, 'Sau khi xóa, giỏ hàng phải rỗng');
});

// ==========================================
// TEST L2: ÁP DỤNG VOUCHER BAITYWELCOME TRONG IFRAME & THỐNG NHẤT ĐỊNH DẠNG LỖI { error: { code, message } }
// ==========================================
test('UI Bug L2: Áp dụng mã giảm giá BAITYWELCOME trong iframe hoạt động đúng với giỏ hàng hiện tại và trả lỗi chuẩn { error: { code, message } } khi không đủ điều kiện', async () => {
  const jar = new BrowserCookieJar(true);
  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE sku = 'UI-SKU-001' LIMIT 1;`);
  const varId = vRows[0].id; // Giá 349.000₫ >= 299.000₫

  await jar.fetch('/api/cart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantId: varId, quantity: 1 }),
  });

  // Gọi POST /api/vouchers/validate đúng như CheckoutModal (chỉ gửi code, shippingMethod, shippingFee, dựa vào giỏ trong phiên/cookie)
  const valRes = await jar.fetch('/api/vouchers/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'BAITYWELCOME',
      shippingMethod: 'standard',
      shippingFee: 30000,
    }),
  });
  assert.equal(valRes.status, 200, 'Áp dụng BAITYWELCOME với giỏ 349.000₫ phải thành công 200');
  const valBody = await valRes.json();
  assert.equal(valBody.valid, true);
  assert.equal(valBody.data.discountAmount, Math.round(349000 * 0.15));

  // Thử mã không tồn tại -> Phải trả về 404 kèm { error: { code, message } }
  const badRes = await jar.fetch('/api/vouchers/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'MA_KHONG_TON_TAI',
      shippingMethod: 'standard',
      shippingFee: 30000,
    }),
  });
  assert.equal(badRes.status, 404);
  const badBody = await badRes.json();
  assert.equal(badBody.error?.code, 'VOUCHER_NOT_FOUND');
  assert.ok(badBody.error?.message);
});

// ==========================================
// TEST C: LUỒNG ĐẦY ĐỦ TRÌNH DUYỆT (KHÁCH -> THÊM 2 MÓN -> THÊM TRÙNG TỐI ĐA 10 -> TĂNG/GIẢM -> XÓA -> ĐĂNG NHẬP GỘP GIỎ -> ÁP BAITYWELCOME -> ĐẶT HÀNG COD)
// ==========================================
test('Requirement C - Luồng trình duyệt đầy đủ qua CookieJar: Khách (session_id) -> Thêm 2 sản phẩm -> Thêm trùng biến thể (tăng số lượng, trần 10) -> Tăng/giảm & Xóa -> Đăng nhập gộp giỏ -> Áp BAITYWELCOME -> Đặt hàng COD', async () => {
  const jar = new BrowserCookieJar(true);
  const vRows = await queryRows<{ id: string; sku: string }>(sql`
    SELECT id, sku FROM product_variants WHERE sku IN ('UI-SKU-001', 'UI-SKU-002') ORDER BY sku ASC;
  `);
  const var1 = vRows[0].id; // 349.000₫
  const var2 = vRows[1].id; // 219.000₫

  // 1. Khách vãng lai thêm 2 sản phẩm khác nhau
  await jar.fetch('/api/cart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantId: var1, quantity: 1 }),
  });
  await jar.fetch('/api/cart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantId: var2, quantity: 1 }),
  });

  // 2. Thêm cùng biến thể var1 lần 2 (+2 -> thành 3), thêm tiếp (+7 -> chạm trần 10), và thử thêm vượt 10 (+1 -> bị chặn 400)
  const dupRes1 = await jar.fetch('/api/cart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantId: var1, quantity: 2 }),
  });
  assert.equal(dupRes1.status, 200);
  const dupBody1 = await dupRes1.json();
  assert.equal(dupBody1.items.find((i: any) => i.variantId === var1).quantity, 3);

  const dupRes2 = await jar.fetch('/api/cart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantId: var1, quantity: 7 }),
  });
  assert.equal(dupRes2.status, 200);
  const dupBody2 = await dupRes2.json();
  const item1InCart = dupBody2.items.find((i: any) => i.variantId === var1);
  const item2InCart = dupBody2.items.find((i: any) => i.variantId === var2);
  assert.equal(item1InCart.quantity, 10, 'Cộng dồn cùng biến thể đạt mức tối đa 10 chiếc');

  const over10Res = await jar.fetch('/api/cart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantId: var1, quantity: 1 }),
  });
  assert.equal(over10Res.status, 400, 'Vượt quá tối đa 10 chiếc mỗi biến thể phải bị chặn 400');

  // 3. Tăng/giảm số lượng món 1 về 2 chiếc, và xóa món 2
  const updateRes = await jar.fetch(`/api/cart/${item1InCart.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity: 2 }),
  });
  assert.equal(updateRes.status, 200);

  const deleteRes = await jar.fetch(`/api/cart/${item2InCart.id}`, {
    method: 'DELETE',
  });
  assert.equal(deleteRes.status, 200);
  const afterDelBody = await deleteRes.json();
  assert.equal(afterDelBody.items.length, 1);
  assert.equal(afterDelBody.items[0].quantity, 2); // 2 * 349.000₫ = 698.000₫ >= 299.000₫

  // 4. Đăng nhập tài khoản khach2@baity.vn -> Giỏ khách tự động gộp vào giỏ tài khoản
  const loginRes = await jar.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach2@baity.vn', password: 'Khach@123' }),
  });
  assert.equal(loginRes.status, 200);

  const mergedCartRes = await jar.fetch('/api/cart');
  const mergedCart = await mergedCartRes.json();
  assert.equal(mergedCart.items.length, 1);
  assert.equal(mergedCart.items[0].variantId, var1);
  assert.equal(mergedCart.items[0].quantity, 2);
  assert.equal(mergedCart.subtotal, 698000);

  // 5. Áp dụng mã BAITYWELCOME với giỏ 698.000₫ (>= 299.000₫)
  const voucherRes = await jar.fetch('/api/vouchers/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'BAITYWELCOME',
      shippingMethod: 'standard',
      shippingFee: 0,
    }),
  });
  assert.equal(voucherRes.status, 200);
  const voucherBody = await voucherRes.json();
  assert.equal(voucherBody.valid, true);
  assert.equal(voucherBody.data.discountAmount, 100000); // 15% của 698k = 104.7k -> trần 100k

  // 6. Đặt hàng COD
  const orderRes = await jar.fetch('/api/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `E2E-COD-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({
      items: mergedCart.items.map((i: any) => ({ variantId: i.variantId, quantity: i.quantity })),
      receiverName: 'Lê Thị Mai Chi',
      receiverPhone: '0987654321',
      shippingAddress: '88 Đường Xuân Thủy, Phường Dịch Vọng, TP. Hà Nội',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
      voucherCode: 'BAITYWELCOME',
    }),
  });
  assert.equal(orderRes.status, 201);
  const orderBody = await orderRes.json();
  assert.equal(orderBody.success, true);
  assert.equal(orderBody.data.subtotal, 698000);
  assert.equal(orderBody.data.discountAmount, 100000);
  assert.equal(orderBody.data.totalAmount, 598000);
});

// ==========================================
// BẢO MẬT 1: TRUST PROXY HOPS (MẶC ĐỊNH 1, CẤU HÌNH QUA TRUST_PROXY_HOPS)
// Gửi X-Forwarded-For giả liên tiếp vẫn bị khóa theo IP thật
// ==========================================
test('Security 1 (TRUST_PROXY_HOPS): Gửi X-Forwarded-For giả liên tiếp ở đầu chuỗi vẫn bị khóa rate limit theo IP thật', async () => {
  const realClientIp = '198.51.100.88';
  const targetEmail = 'khach1@baity.vn';
  resetLoginRateLimit(realClientIp, targetEmail);

  try {
    // Với trust proxy = 1 (1 hop), reverse proxy nối IP thật của client vào cuối chuỗi X-Forwarded-For:
    // "X-Forwarded-For: <IP_giả_do_client_tự_gửi>, <IP_thật_do_proxy_ghi>"
    // Nếu dùng trust proxy = true, Express sẽ lấy <IP_giả> ngoài cùng bên trái và bị vượt rate limit.
    // Với trust proxy = 1 (TRUST_PROXY_HOPS=1), Express lùi đúng 1 bước proxy và lấy đúng realClientIp (198.51.100.88).
    for (let i = 1; i <= 5; i++) {
      const spoofedIp = `10.255.0.${i}`;
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Proto': 'https',
          'X-Forwarded-For': `${spoofedIp}, ${realClientIp}`,
          Origin: APP_ORIGIN,
        },
        body: JSON.stringify({
          email: targetEmail,
          password: `SaiMatKhau_${i}`,
        }),
      });
      assert.equal(res.status, 401, `Lần đăng nhập sai thứ ${i} với X-Forwarded-For giả (${spoofedIp}) trả về 401`);
    }

    // Lần thứ 6 dù đổi tiếp X-Forwarded-For giả mới VÀ đổi cả email khác vẫn phải bị khóa 429 theo IP thật!
    const blockedLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-For': `172.16.99.254, ${realClientIp}`,
        Origin: APP_ORIGIN,
      },
      body: JSON.stringify({
        email: 'other_email_attempt@baity.vn',
        password: 'Khach@123',
      }),
    });
    assert.equal(
      blockedLoginRes.status,
      429,
      'Dù gửi X-Forwarded-For giả liên tiếp khác nhau, lần thứ 6 vẫn phải bị khóa 429 theo IP thật'
    );
  } finally {
    resetLoginRateLimit(realClientIp, targetEmail);
    resetLoginRateLimit(realClientIp, 'other_email_attempt@baity.vn');
  }

  // Kiểm tra tương tự trên route voucher validate (tối đa 30 lần/phút/IP):
  resetVoucherValidateRateLimit();
  const vRowsForRate = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE sku = 'UI-SKU-001' LIMIT 1;`);
  const varIdForRate = vRowsForRate[0].id;
  const realVoucherIp = '198.51.100.89';
  for (let i = 1; i <= 30; i++) {
    const res = await fetch(`${baseUrl}/api/vouchers/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-For': `10.88.1.${i}, ${realVoucherIp}`,
        Origin: APP_ORIGIN,
      },
      body: JSON.stringify({
        code: 'BAITYWELCOME',
        items: [{ variantId: varIdForRate, quantity: 2 }],
      }),
    });
    assert.equal(res.status, 200);
  }
  const blockedVoucherRes = await fetch(`${baseUrl}/api/vouchers/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-For': `10.88.1.250, ${realVoucherIp}`,
      Origin: APP_ORIGIN,
    },
    body: JSON.stringify({
      code: 'BAITYWELCOME',
      items: [{ variantId: varIdForRate, quantity: 2 }],
    }),
  });
  assert.equal(
    blockedVoucherRes.status,
    429,
    'Route /api/vouchers/validate cũng phải khóa 429 theo IP thật bất chấp X-Forwarded-For giả'
  );
  resetVoucherValidateRateLimit();
});

// ==========================================
// BẢO MẬT 2: GIỚI HẠN BODY (MẶC ĐỊNH 100KB; CHỈ UPLOAD & TÌM BẰNG ẢNH TỐI ĐA 8MB)
// ==========================================
test('Security 2 (Body Size Limits): Route thường từ chối payload > 100kb với 413; chỉ route upload và tìm bằng ảnh cho phép > 100kb (tối đa 8MB)', async () => {
  const jar = new BrowserCookieJar(true);
  await jar.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });

  // 1. Gửi body ~150KB vào route thường (/api/cart) -> Bị chặn ngay 413 PAYLOAD_TOO_LARGE
  const padding150kb = 'A'.repeat(150 * 1024);
  const normalOver100kbRes = await jar.fetch('/api/cart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantId: padding150kb, quantity: 1 }),
  });
  assert.equal(
    normalOver100kbRes.status,
    413,
    'Route thông thường (/api/cart) phải từ chối body lớn hơn 100kb với HTTP 413'
  );
  const errBody = await normalOver100kbRes.json();
  assert.equal(errBody.error?.code, 'PAYLOAD_TOO_LARGE');

  // 2. Gửi body ~150KB vào route /api/upload -> Không bị chặn bởi giới hạn 100kb (vượt qua body-parser, chỉ trả 400 do ảnh giả không đúng magic bytes)
  const fakeBase64Over100kb = `data:image/png;base64,${Buffer.alloc(120 * 1024, 0x41).toString('base64')}`;
  const uploadOver100kbRes = await jar.fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: fakeBase64Over100kb, folder: 'reviews' }),
  });
  assert.notEqual(
    uploadOver100kbRes.status,
    413,
    'Route /api/upload phải chấp nhận JSON payload lớn hơn 100kb (dưới 8MB)'
  );
  assert.equal(uploadOver100kbRes.status, 400);

  // 3. Gửi body > 8MB vào route /api/products/visual-search -> Phải bị chặn 413 PAYLOAD_TOO_LARGE
  const over8MbString = 'B'.repeat(8.5 * 1024 * 1024);
  const visualOver8MbRes = await jar.fetch('/api/products/visual-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: over8MbString }),
  });
  assert.equal(
    visualOver8MbRes.status,
    413,
    'Route tìm kiếm bằng ảnh (/api/products/visual-search) phải từ chối payload vượt quá 8MB với HTTP 413'
  );
});

// ==========================================
// BẢO MẬT 3: HEADER BẢO MẬT HELMET & CONTENT-SECURITY-POLICY (THU HẸP SUPABASE_URL)
// ==========================================
test('Security 3 (Helmet & CSP): Phản hồi có đầy đủ CSP (Google Fonts, đúng host trong SUPABASE_URL không dùng *.supabase.co, VietQR), X-XSS-Protection=0, frame-ancestors theo môi trường và HSTS ở production', async () => {
  const prevSupaUrl = process.env.SUPABASE_URL;
  let previewServer: http.Server | null = null;
  try {
    process.env.SUPABASE_URL = 'https://ocuizojmlykchhcvveqi.supabase.co';
    const previewApp = createApp();
    previewServer = http.createServer(previewApp);
    const previewPort = await new Promise<number>((resolve) => {
      previewServer!.listen(0, '127.0.0.1', () => {
        const addr = previewServer!.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });

    const resPreview = await fetch(`http://127.0.0.1:${previewPort}/api/health`);
    assert.equal(resPreview.status, 200);
    assert.equal(resPreview.headers.get('x-xss-protection'), '0', 'X-XSS-Protection phải được đặt về 0');

    const cspPreview = resPreview.headers.get('content-security-policy') || '';
    assert.ok(cspPreview.includes('https://fonts.googleapis.com'), 'CSP phải cho phép Google Fonts stylesheet');
    assert.ok(cspPreview.includes('https://fonts.gstatic.com'), 'CSP phải cho phép Google Fonts font-src');
    assert.ok(
      cspPreview.includes('https://ocuizojmlykchhcvveqi.supabase.co') &&
        !cspPreview.includes('*.supabase.co'),
      'CSP img-src và connect-src phải thu hẹp về đúng host trong SUPABASE_URL, không dùng *.supabase.co'
    );
    assert.ok(cspPreview.includes('https://img.vietqr.io'), 'CSP phải cho phép ảnh mã QR từ VietQR');
    assert.ok(cspPreview.includes('frame-ancestors'), 'CSP phải khai báo frame-ancestors');
    assert.ok(cspPreview.includes('https://aistudio.google.com'), 'Preview CSP phải cho phép tên miền AI Studio trong frame-ancestors');
  } finally {
    if (previewServer) {
      previewServer.closeAllConnections?.();
      await new Promise<void>((resolve) => previewServer!.close(() => resolve()));
    }
    if (prevSupaUrl !== undefined) process.env.SUPABASE_URL = prevSupaUrl;
    else delete process.env.SUPABASE_URL;
  }

  // 2. Kiểm tra ở môi trường Production: HSTS được bật và frame-ancestors chỉ còn 'self'
  const prevNodeEnv = process.env.NODE_ENV;
  const prevCrossSite = process.env.COOKIE_CROSS_SITE;
  let prodServer: http.Server | null = null;
  try {
    process.env.NODE_ENV = 'production';
    process.env.COOKIE_CROSS_SITE = 'false';
    const prodApp = createApp();
    prodServer = http.createServer(prodApp);
    const prodPort = await new Promise<number>((resolve) => {
      prodServer!.listen(0, '127.0.0.1', () => {
        const addr = prodServer!.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });

    const resProd = await fetch(`http://127.0.0.1:${prodPort}/api/health`, {
      headers: { 'X-Forwarded-Proto': 'https' },
    });
    assert.equal(resProd.headers.get('x-xss-protection'), '0');
    const hsts = resProd.headers.get('strict-transport-security') || '';
    assert.ok(hsts.includes('max-age='), 'Ở Production phải bật header Strict-Transport-Security (HSTS)');
    const cspProd = resProd.headers.get('content-security-policy') || '';
    assert.ok(
      cspProd.includes("frame-ancestors 'self'") && !cspProd.includes('aistudio.google.com'),
      "Ở Production, CSP frame-ancestors phải khóa chặt về 'self'"
    );
  } finally {
    if (prodServer) {
      prodServer.closeAllConnections?.();
      await new Promise<void>((resolve) => prodServer!.close(() => resolve()));
    }
    if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
    else delete process.env.NODE_ENV;
    if (prevCrossSite !== undefined) process.env.COOKIE_CROSS_SITE = prevCrossSite;
    else delete process.env.COOKIE_CROSS_SITE;
  }
});

// ==========================================
// BẢO MẬT 4: KHI COOKIE_CROSS_SITE=TRUE, BẮT BUỘC CÓ ORIGIN HỢP LỆ VÀ KHỚP GIAO THỨC (HTTPS)
// ==========================================
test('Security 4 (Strict Origin & Protocol when COOKIE_CROSS_SITE=true): Thiếu Origin hoặc lệch giao thức (http vs https) bị chặn 403; khi tắt COOKIE_CROSS_SITE giữ như hiện tại', async () => {
  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE sku = 'UI-SKU-001' LIMIT 1;`);
  const varId = vRows[0].id;

  // 1. Khi COOKIE_CROSS_SITE=true: Request POST không có Origin header -> Phải bị từ chối 403 (CSRF_MISSING_ORIGIN)
  const noOriginRes = await fetch(`${baseUrl}/api/cart`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-Proto': 'https',
    },
    body: JSON.stringify({ variantId: varId, quantity: 1 }),
  });
  assert.equal(noOriginRes.status, 403, 'Khi COOKIE_CROSS_SITE=true, request thay đổi dữ liệu thiếu Origin phải bị chặn 403');
  const noOriginBody = await noOriginRes.json();
  assert.equal(noOriginBody.error?.code, 'CSRF_MISSING_ORIGIN');

  // 2. Khi COOKIE_CROSS_SITE=true: Request đến qua HTTPS (X-Forwarded-Proto: https) nhưng Origin lại dùng giao thức http:// -> Phải bị chặn 403
  const proxyHost = 'ais-dev-preview.run.app';
  const protoMismatchRes = await fetch(`${baseUrl}/api/cart`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host': proxyHost,
      Origin: `http://${proxyHost}`, // Giao thức http:// lệch với https của request
    },
    body: JSON.stringify({ variantId: varId, quantity: 1 }),
  });
  assert.equal(
    protoMismatchRes.status,
    403,
    'Khi COOKIE_CROSS_SITE=true, Origin khác giao thức (http vs https) với giao thức thật của request phải bị chặn 403'
  );
  const protoMismatchBody = await protoMismatchRes.json();
  assert.equal(protoMismatchBody.error?.code, 'CSRF_ORIGIN_MISMATCH');

  // 3. Khi tắt COOKIE_CROSS_SITE=false: Giữ hành vi hiện tại (request server-to-server / cùng site không gửi Origin không bị chặn bởi cờ cross-site)
  const prevCrossSite = process.env.COOKIE_CROSS_SITE;
  try {
    process.env.COOKIE_CROSS_SITE = 'false';
    const offRes = await fetch(`${baseUrl}/api/cart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variantId: varId, quantity: 1 }),
    });
    assert.equal(offRes.status, 200, 'Khi tắt COOKIE_CROSS_SITE, hành vi hiện tại được giữ nguyên');
  } finally {
    process.env.COOKIE_CROSS_SITE = prevCrossSite;
  }
});

// ==========================================
// BẢO MẬT 5: CHỐT CHẶN CẤU HÌNH PRODUCTION (RENDER=true HOẶC PRODUCTION_STRICT=true MÀ COOKIE_CROSS_SITE=true THÌ TỪ CHỐI KHỞI ĐỘNG)
// ==========================================
test('Security 5 (Production Config Guard): Khi RENDER=true hoặc PRODUCTION_STRICT=true mà COOKIE_CROSS_SITE=true thì server từ chối khởi động và báo rõ lý do', async () => {
  const prevRender = process.env.RENDER;
  const prevStrict = process.env.PRODUCTION_STRICT;
  const prevCross = process.env.COOKIE_CROSS_SITE;

  try {
    process.env.COOKIE_CROSS_SITE = 'true';

    // Trường hợp 1: RENDER=true + COOKIE_CROSS_SITE=true
    process.env.RENDER = 'true';
    delete process.env.PRODUCTION_STRICT;
    assert.throws(
      () => createApp(),
      (err: any) =>
        err instanceof Error &&
        err.message.includes('COOKIE_CROSS_SITE=true') &&
        err.message.includes('Production'),
      'createApp() phải từ chối khởi động và báo rõ lý do khi RENDER=true và COOKIE_CROSS_SITE=true'
    );
    await assert.rejects(
      async () => await getDb(),
      (err: any) => err instanceof Error && err.message.includes('COOKIE_CROSS_SITE=true'),
      'getDb() cũng phải từ chối khởi động khi RENDER=true và COOKIE_CROSS_SITE=true'
    );

    // Trường hợp 2: PRODUCTION_STRICT=true + COOKIE_CROSS_SITE=true
    delete process.env.RENDER;
    process.env.PRODUCTION_STRICT = 'true';
    assert.throws(
      () => createApp(),
      (err: any) =>
        err instanceof Error &&
        err.message.includes('COOKIE_CROSS_SITE=true') &&
        err.message.includes('PRODUCTION_STRICT=true'),
      'createApp() phải từ chối khởi động và báo rõ lý do khi PRODUCTION_STRICT=true và COOKIE_CROSS_SITE=true'
    );
  } finally {
    if (prevRender !== undefined) process.env.RENDER = prevRender;
    else delete process.env.RENDER;
    if (prevStrict !== undefined) process.env.PRODUCTION_STRICT = prevStrict;
    else delete process.env.PRODUCTION_STRICT;
    if (prevCross !== undefined) process.env.COOKIE_CROSS_SITE = prevCross;
    else delete process.env.COOKIE_CROSS_SITE;
  }
});

// ==========================================
// BẢO MẬT 6: HAI CHẾ ĐỘ XÁC ĐỊNH GIAO THỨC TIN CẬY (PREVIEW AI STUDIO vs PRODUCTION RENDER) & ENDPOINT /api/auth/diag
// ==========================================
test('Security 6 (Dual-Mode Protocol Resolution: Preview Cross-Site vs Production Strict): Suy luận https từ APP_URL/*.run.app chỉ chạy khi COOKIE_CROSS_SITE=true và !isProd; ở Production (RENDER=true / PRODUCTION_STRICT=true) chỉ dùng X-Forwarded-Proto theo số hop, lệch giao thức thì chặn 403', async () => {
  const prevHops = process.env.TRUST_PROXY_HOPS;
  const prevAppUrl = process.env.APP_URL;
  const prevCross = process.env.COOKIE_CROSS_SITE;
  const prevAllowed = process.env.ALLOWED_ORIGINS;
  const prevRender = process.env.RENDER;
  const prevStrict = process.env.PRODUCTION_STRICT;
  const prevNodeEnv = process.env.NODE_ENV;

  const cloudRunHost = 'ais-dev-vln6nr2k4zxgxwx7eabgxn-963538502110.asia-east1.run.app';
  const cloudRunOrigin = `https://${cloudRunHost}`;
  const realUserIp = '203.0.113.50';
  const cloudRunInternalIp = '169.254.1.1';

  let proxyServer: http.Server | null = null;
  let prodServer: http.Server | null = null;
  try {
    // --- CHẾ ĐỘ 1: PREVIEW AI STUDIO (COOKIE_CROSS_SITE=true, !isProd) ---
    process.env.TRUST_PROXY_HOPS = '2';
    process.env.COOKIE_CROSS_SITE = 'true';
    process.env.APP_URL = cloudRunOrigin;
    process.env.ALLOWED_ORIGINS = 'https://example.com';
    delete process.env.RENDER;
    delete process.env.PRODUCTION_STRICT;
    process.env.NODE_ENV = 'development';

    const proxyApp = createApp();
    proxyServer = http.createServer(proxyApp);
    const proxyPort = await new Promise<number>((resolve) => {
      proxyServer!.listen(0, '127.0.0.1', () => {
        const addr = proxyServer!.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });
    const proxyBaseUrl = `http://127.0.0.1:${proxyPort}`;

    // 1. Tái hiện chính xác /etc/nginx/nginx.conf của container AI Studio ở Preview:
    //    Host: localhost:3000, X-Forwarded-Host: *.run.app, X-Forwarded-Proto: http (bị Nginx ghi đè)
    const loginRes1 = await fetch(`${proxyBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: 'localhost:3000',
        'X-Forwarded-Host': cloudRunHost,
        'X-Forwarded-For': `${realUserIp}, ${cloudRunInternalIp}`,
        'X-Forwarded-Proto': 'http',
        Origin: cloudRunOrigin,
      },
      body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
    });
    assert.equal(
      loginRes1.status,
      200,
      'Ở chế độ Preview (COOKIE_CROSS_SITE=true, !isProd), đăng nhập qua chuỗi proxy Cloud Run + Nginx nội bộ phải thành công 200'
    );
    const setCookies1 = loginRes1.headers.getSetCookie ? loginRes1.headers.getSetCookie() : [];
    const authCookieRaw = setCookies1.find((c) => c.startsWith('baity_token=')) || '';
    assert.ok(authCookieRaw.includes('SameSite=None'), 'Cookie baity_token phải có SameSite=None');
    assert.ok(authCookieRaw.includes('Secure'), 'Cookie baity_token phải có Secure');
    assert.ok(authCookieRaw.includes('Partitioned'), 'Cookie baity_token phải có Partitioned');

    // 2. Xác thực phiên đăng nhập qua /api/auth/me và xác nhận /api/auth/diag đã gỡ bỏ hoàn toàn (404)
    const tokenPair = authCookieRaw.split(';')[0];
    const meRes = await fetch(`${proxyBaseUrl}/api/auth/me`, {
      headers: {
        Host: 'localhost:3000',
        'X-Forwarded-Host': cloudRunHost,
        'X-Forwarded-For': `9.9.9.9, ${realUserIp}, ${cloudRunInternalIp}`,
        'X-Forwarded-Proto': 'http',
        Origin: cloudRunOrigin,
        Cookie: tokenPair,
      },
    });
    assert.equal(meRes.status, 200);
    const meJson = await meRes.json();
    assert.equal(meJson.user?.email, 'khach1@baity.vn');

    const diagRes = await fetch(`${proxyBaseUrl}/api/auth/diag`, {
      headers: {
        Host: 'localhost:3000',
        'X-Forwarded-Host': cloudRunHost,
        'X-Forwarded-Proto': 'http',
        Origin: cloudRunOrigin,
        Cookie: tokenPair,
      },
    });
    assert.equal(diagRes.status, 404, 'Endpoint /api/auth/diag đã được xóa hoàn toàn ở Giai đoạn 9');

    // --- CHẾ ĐỘ 2: PRODUCTION (PRODUCTION_STRICT=true / RENDER=true, COOKIE_CROSS_SITE=false, TRUST_PROXY_HOPS=1) ---
    // Ở Production: tuyệt đối KHÔNG suy luận https từ APP_URL hay *.run.app; chỉ dùng X-Forwarded-Proto theo số hop.
    process.env.PRODUCTION_STRICT = 'true';
    process.env.COOKIE_CROSS_SITE = 'false';
    process.env.TRUST_PROXY_HOPS = '1';
    process.env.APP_URL = cloudRunOrigin; // Kể cả khi APP_URL là https://*.run.app

    const prodApp = createApp();
    prodServer = http.createServer(prodApp);
    const prodPort = await new Promise<number>((resolve) => {
      prodServer!.listen(0, '127.0.0.1', () => {
        const addr = prodServer!.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });
    const prodBaseUrl = `http://127.0.0.1:${prodPort}`;

    // 2a. Ở Production, nếu X-Forwarded-Proto là "http" trong khi Origin là "https://..." -> Lệch giao thức, PHẢI BỊ CHẶN 403!
    const prodMismatchRes = await fetch(`${prodBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: 'localhost:3000',
        'X-Forwarded-Host': cloudRunHost,
        'X-Forwarded-For': realUserIp,
        'X-Forwarded-Proto': 'http',
        Origin: cloudRunOrigin,
      },
      body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
    });
    assert.equal(
      prodMismatchRes.status,
      403,
      'Ở Production (PRODUCTION_STRICT=true), không được suy luận https từ APP_URL/*.run.app; khi X-Forwarded-Proto là http lệch với Origin https thì phải chặn 403'
    );

    // 2b. Ở Production, khi X-Forwarded-Proto ở đúng hop tin cậy là "https" khớp với Origin "https://..." -> Thành công 200
    const prodValidRes = await fetch(`${prodBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: cloudRunHost,
        'X-Forwarded-Host': cloudRunHost,
        'X-Forwarded-For': realUserIp,
        'X-Forwarded-Proto': 'https',
        Origin: cloudRunOrigin,
      },
      body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
    });
    assert.equal(
      prodValidRes.status,
      200,
      'Ở Production, khi X-Forwarded-Proto đáng tin theo số hop là https khớp với Origin https thì đăng nhập thành công 200'
    );

    // 2c. Ở Production, endpoint /api/auth/diag bị tắt hoàn toàn (404)
    const diagProdRes = await fetch(`${prodBaseUrl}/api/auth/diag`);
    assert.equal(diagProdRes.status, 404, 'Ở Production, /api/auth/diag phải trả về 404');
  } finally {
    if (proxyServer) {
      proxyServer.closeAllConnections?.();
      await new Promise<void>((resolve) => proxyServer!.close(() => resolve()));
    }
    if (prodServer) {
      prodServer.closeAllConnections?.();
      await new Promise<void>((resolve) => prodServer!.close(() => resolve()));
    }
    if (prevHops !== undefined) process.env.TRUST_PROXY_HOPS = prevHops;
    else delete process.env.TRUST_PROXY_HOPS;
    if (prevAppUrl !== undefined) process.env.APP_URL = prevAppUrl;
    else delete process.env.APP_URL;
    if (prevCross !== undefined) process.env.COOKIE_CROSS_SITE = prevCross;
    else delete process.env.COOKIE_CROSS_SITE;
    if (prevAllowed !== undefined) process.env.ALLOWED_ORIGINS = prevAllowed;
    else delete process.env.ALLOWED_ORIGINS;
    if (prevRender !== undefined) process.env.RENDER = prevRender;
    else delete process.env.RENDER;
    if (prevStrict !== undefined) process.env.PRODUCTION_STRICT = prevStrict;
    else delete process.env.PRODUCTION_STRICT;
    if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
    else delete process.env.NODE_ENV;
  }
});

// ==========================================
// BẢO MẬT 7: XỬ LÝ PHẢN HỒI PHI JSON (HTML 403 / 500) & SCRIPT db:secure-dev-accounts
// ==========================================
test('Security 7 (Non-JSON HTML Error Handling & db:secure-dev-accounts): Giao diện hiển thị đúng thông báo theo HTTP status khi nhận HTML 403/500; script secureDevAccounts đổi mật khẩu mẫu, giữ nguyên dữ liệu và từ chối chạy ở Production', async () => {
  const { extractApiError, getHttpStatusDefaultMessage } = await import('../src/lib/api.ts');
  const { secureDevAccounts } = await import('../scripts/secure-dev-accounts.ts');

  // 1. Khi nhận trang HTML 403 hoặc 500 (payload JSON = null), trả thông báo đúng theo status, không báo "chưa đăng nhập"
  const err403 = extractApiError(null, getHttpStatusDefaultMessage(403), 403);
  assert.equal(err403.message, 'Yêu cầu bị chặn (403)');
  assert.ok(!err403.message.toLowerCase().includes('chưa đăng nhập'));

  const err500 = extractApiError(null, getHttpStatusDefaultMessage(500), 500);
  assert.equal(err500.message, 'Máy chủ lỗi (500)');

  // 2. Kiểm tra script secureDevAccounts:
  //    - Từ chối chạy ở Production
  const prevProdStrict = process.env.PRODUCTION_STRICT;
  try {
    process.env.PRODUCTION_STRICT = 'true';
    await assert.rejects(
      async () => await secureDevAccounts(),
      (err: any) => err instanceof Error && err.message.includes('từ chối chạy ở môi trường Production')
    );
  } finally {
    if (prevProdStrict !== undefined) process.env.PRODUCTION_STRICT = prevProdStrict;
    else delete process.env.PRODUCTION_STRICT;
  }

  //    - Chạy ở Dev: đổi ngẫu nhiên mật khẩu các tài khoản mẫu, tạo/cập nhật admin thật, giữ nguyên đơn hàng của khach1/khach2
  const ordersBefore = await queryRows<{ cnt: number }>(sql`SELECT COUNT(*)::int AS cnt FROM orders;`);
  const result = await secureDevAccounts({
    adminEmail: 'real_admin_sec@baity.vn',
    adminInitialPassword: 'StrongAdminPassword!2026',
  });
  assert.ok(result.rotatedDevEmails.includes('khach1@baity.vn'));
  assert.ok(result.rotatedDevEmails.includes('khach2@baity.vn'));
  assert.equal(result.adminEmail, 'real_admin_sec@baity.vn');
  assert.equal(result.adminAction, 'created');

  const ordersAfter = await queryRows<{ cnt: number }>(sql`SELECT COUNT(*)::int AS cnt FROM orders;`);
  assert.equal(ordersAfter[0].cnt, ordersBefore[0].cnt, 'Không được xóa bất kỳ đơn hàng liên quan nào');

  // Mật khẩu mặc định Khach@123 của khach1@baity.vn đã bị vô hiệu hóa
  const khach1Rows = await queryRows<{ password_hash: string }>(sql`
    SELECT password_hash FROM users WHERE email = 'khach1@baity.vn' LIMIT 1;
  `);
  assert.equal(
    bcrypt.compareSync('Khach@123', khach1Rows[0].password_hash),
    false,
    'Mật khẩu mặc định Khach@123 phải không còn hiệu lực sau khi chạy secureDevAccounts'
  );

  // Khôi phục mật khẩu test cho các bài test tiếp theo trong cùng file
  const pwdRestore = bcrypt.hashSync('Khach@123', 4);
  await queryRows(sql`
    UPDATE users SET password_hash = ${pwdRestore} WHERE email IN ('khach1@baity.vn', 'khach2@baity.vn');
  `);
});

// ==========================================
// KIỂM THỬ RIÊNG TỪNG MỤC 1–13 & PHẦN 1 (MỖI TEST CHỈ KIỂM MỘT QUY TẮC)
// ==========================================

// MỤC 1: Chống Deadlock khi đặt nhiều món có thứ tự đảo ngược
test('Hardening 1 (Multi-Item Order Deadlock Prevention): Hai đơn song song có thứ tự món đảo ngược ([varA, varB] vs [varB, varA]) được sắp xếp theo variantId trước khi UPDATE, không deadlock và trừ kho chính xác', async () => {
  const { resetOrderCreateRateLimit } = await import('../server/routes/orders.ts');
  resetOrderCreateRateLimit();

  const jar1 = new BrowserCookieJar(true);
  const jar2 = new BrowserCookieJar(true);
  await Promise.all([
    jar1.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
    }),
    jar2.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'khach2@baity.vn', password: 'Khach@123' }),
    }),
  ]);

  const vRows = await queryRows<{ id: string; sku: string }>(sql`
    SELECT id, sku FROM product_variants WHERE sku IN ('UI-SKU-001', 'UI-SKU-002') ORDER BY sku ASC;
  `);
  const varA = vRows[0].id;
  const varB = vRows[1].id;
  await queryRows(sql`
    UPDATE product_variants SET stock_quantity = 20 WHERE id IN (${varA}::uuid, ${varB}::uuid);
  `);

  const [orderRes1, orderRes2] = await Promise.all([
    jar1.fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { variantId: varA, quantity: 2 },
          { variantId: varB, quantity: 1 },
        ],
        receiverName: 'Khách Đảo 1',
        receiverPhone: '0912345678',
        shippingAddress: '101 Nguyễn Huệ, Quận 1, TP.HCM',
        shippingMethod: 'standard',
        paymentMethod: 'cod',
      }),
    }),
    jar2.fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { variantId: varB, quantity: 2 },
          { variantId: varA, quantity: 1 },
        ],
        receiverName: 'Khách Đảo 2',
        receiverPhone: '0987654321',
        shippingAddress: '202 Lê Lợi, Quận 1, TP.HCM',
        shippingMethod: 'standard',
        paymentMethod: 'cod',
      }),
    }),
  ]);

  assert.equal(orderRes1.status, 201, 'Đơn 1 (varA -> varB) phải thành công 201 không bị deadlock');
  assert.equal(orderRes2.status, 201, 'Đơn 2 (varB -> varA) phải thành công 201 không bị deadlock');

  const stockAfter = await queryRows<{ id: string; stock_quantity: number }>(sql`
    SELECT id, stock_quantity FROM product_variants WHERE id IN (${varA}::uuid, ${varB}::uuid);
  `);
  for (const row of stockAfter) {
    assert.equal(row.stock_quantity, 17, 'Cả hai biến thể phải trừ kho chính xác 3 chiếc (20 - 3 = 17)');
  }
});

// MỤC 2(a): Khóa dòng voucher (SELECT ... FOR UPDATE) trước khi kiểm tra per_user_limit
test('Hardening 2a (Voucher Row Locking for per_user_limit): Khóa dòng voucher trong transaction trước khi kiểm tra per_user_limit chặn 2 đơn song song của cùng 1 người vượt giới hạn', async () => {
  const { resetOrderCreateRateLimit } = await import('../server/routes/orders.ts');
  resetOrderCreateRateLimit();

  const jar1 = new BrowserCookieJar(true);
  await jar1.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });

  const vRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM product_variants WHERE sku IN ('UI-SKU-001', 'UI-SKU-002') ORDER BY sku ASC;
  `);
  const varA = vRows[0].id;
  const varB = vRows[1].id;
  await queryRows(sql`
    UPDATE product_variants SET stock_quantity = 20 WHERE id IN (${varA}::uuid, ${varB}::uuid);
  `);

  await queryRows(sql`
    INSERT INTO vouchers (code, discount_type, discount_value, max_discount, min_order_value, usage_limit, per_user_limit, used_count, start_date, end_date, is_active)
    VALUES ('PERUSERLOCK1', 'fixed', 30000, 30000, 100000, 100, 1, 0, NOW() - INTERVAL '1 day', NOW() + INTERVAL '30 days', true)
    ON CONFLICT (code) DO UPDATE SET used_count = 0, per_user_limit = 1, usage_limit = 100;
  `);
  await queryRows(sql`
    DELETE FROM voucher_usages WHERE voucher_id IN (SELECT id FROM vouchers WHERE code = 'PERUSERLOCK1');
  `);

  const [vConcurrent1, vConcurrent2] = await Promise.all([
    jar1.fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ variantId: varA, quantity: 1 }],
        receiverName: 'Khách 1 Song Song A',
        receiverPhone: '0912345678',
        shippingAddress: '101 Nguyễn Huệ, Quận 1, TP.HCM',
        shippingMethod: 'standard',
        paymentMethod: 'cod',
        voucherCode: 'PERUSERLOCK1',
      }),
    }),
    jar1.fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ variantId: varB, quantity: 1 }],
        receiverName: 'Khách 1 Song Song B',
        receiverPhone: '0912345678',
        shippingAddress: '101 Nguyễn Huệ, Quận 1, TP.HCM',
        shippingMethod: 'standard',
        paymentMethod: 'cod',
        voucherCode: 'PERUSERLOCK1',
      }),
    }),
  ]);

  const vStatuses = [vConcurrent1.status, vConcurrent2.status].sort();
  assert.deepEqual(
    vStatuses,
    [201, 400],
    'Hai đơn song song của cùng 1 người với per_user_limit = 1: đúng 1 đơn 201, đơn còn lại phải bị chặn 400'
  );
});

// MỤC 2(b): Hỗ trợ voucher có usage_limit IS NULL (không giới hạn tổng lượt dùng)
test('Hardening 2b (Voucher usage_limit IS NULL Support): Voucher có usage_limit IS NULL hoạt động đúng ở cả /api/vouchers/validate và POST /api/orders', async () => {
  const { resetOrderCreateRateLimit } = await import('../server/routes/orders.ts');
  resetOrderCreateRateLimit();

  const jar1 = new BrowserCookieJar(true);
  await jar1.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE sku = 'UI-SKU-001' LIMIT 1;`);
  const varA = vRows[0].id;
  await queryRows(sql`UPDATE product_variants SET stock_quantity = 20 WHERE id = ${varA}::uuid;`);

  await queryRows(sql`
    INSERT INTO vouchers (code, discount_type, discount_value, max_discount, min_order_value, usage_limit, per_user_limit, used_count, start_date, end_date, is_active)
    VALUES ('UNLIMITEDNULL', 'fixed', 25000, 25000, 100000, NULL, 5, 999, NOW() - INTERVAL '1 day', NOW() + INTERVAL '30 days', true)
    ON CONFLICT (code) DO UPDATE SET usage_limit = NULL, used_count = 999, per_user_limit = 5;
  `);

  const valNullRes = await jar1.fetch('/api/vouchers/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'UNLIMITEDNULL',
      items: [{ variantId: varA, quantity: 1 }],
    }),
  });
  assert.equal(valNullRes.status, 200, 'Voucher có usage_limit IS NULL phải được chấp nhận ở /api/vouchers/validate dù used_count = 999');

  const orderNullRes = await jar1.fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ variantId: varA, quantity: 1 }],
      receiverName: 'Khách Unlimited Voucher',
      receiverPhone: '0912345678',
      shippingAddress: '101 Nguyễn Huệ, Quận 1, TP.HCM',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
      voucherCode: 'UNLIMITEDNULL',
    }),
  });
  assert.equal(orderNullRes.status, 201, 'Đặt hàng với voucher có usage_limit IS NULL phải thành công 201');
});

// MỤC 3: Kiểm tra đầu vào POST /api/orders bằng Zod và so khớp địa chỉ nhận hàng khi tái dùng Idempotency-Key (không gửi items)
test('Hardening 3 (Order Zod Input Validation & Idempotency Address Mismatch): Kiểm tra số lượng 1-10, tối đa 50 dòng, regex SĐT VN, shippingAddress <= 300, Idempotency-Key <= 64, 422 khi tái dùng khóa khác địa chỉ và thông báo phương thức thanh toán đầy đủ', async () => {
  const { resetOrderCreateRateLimit } = await import('../server/routes/orders.ts');
  resetOrderCreateRateLimit();

  const jar = new BrowserCookieJar(true);
  await jar.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE sku = 'UI-SKU-001' LIMIT 1;`);
  const varId = vRows[0].id;
  await queryRows(sql`UPDATE product_variants SET stock_quantity = 50 WHERE id = ${varId}::uuid;`);

  // 1. Số lượng > 10 -> 400
  const overQtyRes = await jar.fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 11 }],
      receiverName: 'Khách Test',
      receiverPhone: '0912345678',
      shippingAddress: '123 Lê Lợi',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(overQtyRes.status, 400, 'Số lượng mỗi dòng > 10 phải bị từ chối 400');

  // 2. Hơn 50 dòng items -> 400
  const items51 = Array.from({ length: 51 }, () => ({ variantId: varId, quantity: 1 }));
  const overLinesRes = await jar.fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: items51,
      receiverName: 'Khách Test',
      receiverPhone: '0912345678',
      shippingAddress: '123 Lê Lợi',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(overLinesRes.status, 400, 'Quá 50 dòng sản phẩm phải bị từ chối 400');

  // 3. Khi không dùng addressId: phone sai regex VN, shippingAddress > 300 ký tự
  const badPhoneRes = await jar.fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách Test',
      receiverPhone: '0123456789',
      shippingAddress: '123 Lê Lợi',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(badPhoneRes.status, 400, 'Số điện thoại không đúng regex VN phải bị từ chối 400');

  const longAddressRes = await jar.fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách Test',
      receiverPhone: '0912345678',
      shippingAddress: 'A'.repeat(301),
      paymentMethod: 'cod',
    }),
  });
  assert.equal(longAddressRes.status, 400, 'shippingAddress > 300 ký tự phải bị từ chối 400');

  // 4. Idempotency-Key > 64 ký tự -> 400
  const badIdempRes = await jar.fetch('/api/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'K'.repeat(65),
    },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách Test',
      receiverPhone: '0912345678',
      shippingAddress: '123 Lê Lợi',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(badIdempRes.status, 400, 'Idempotency-Key > 64 ký tự phải bị từ chối 400');

  // 5. Thông báo lỗi phương thức thanh toán hiển thị đầy đủ cod, vietqr, card hoặc wallet
  const badPaymentRes = await jar.fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách Test',
      receiverPhone: '0912345678',
      shippingAddress: '123 Lê Lợi',
      paymentMethod: 'bitcoin',
    }),
  });
  assert.equal(badPaymentRes.status, 400);
  const badPaymentBody = await badPaymentRes.json();
  assert.ok(
    badPaymentBody.message.includes('cod, vietqr, card hoặc wallet'),
    'Thông báo lỗi paymentMethod phải nêu rõ cod, vietqr, card hoặc wallet'
  );

  // 6. Khi client KHÔNG gửi items (đặt từ giỏ hàng), tái dùng Idempotency-Key nhưng đổi địa chỉ nhận hàng -> 422
  await jar.fetch('/api/cart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantId: varId, quantity: 1 }),
  });
  const cartIdempKey = `CART-IDEMP-${Date.now()}`;
  const firstFromCart = await jar.fetch('/api/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': cartIdempKey,
    },
    body: JSON.stringify({
      receiverName: 'Người Nhận A',
      receiverPhone: '0912345678',
      shippingAddress: 'Số 10 Nguyễn Huệ, Quận 1, TP.HCM',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(firstFromCart.status, 201);

  const reuseDiffAddress = await jar.fetch('/api/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': cartIdempKey,
    },
    body: JSON.stringify({
      receiverName: 'Người Nhận A',
      receiverPhone: '0912345678',
      shippingAddress: 'Số 999 Đường Khác, Quận 3, TP.HCM',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(
    reuseDiffAddress.status,
    422,
    'Khi không gửi items, tái dùng Idempotency-Key nhưng khác địa chỉ nhận hàng phải trả về 422'
  );
});

// MỤC 4 & PHẦN 1.5: Dọn dẹp có phạm vi đơn quá hạn của chính người dùng trước khi đếm giới hạn 3 đơn chờ thanh toán + Rate limit 10 đơn/giờ
test('Hardening 4 & Phần 1.5 (Scoped Lazy Cleanup Before Pending Limit & Order Rate Limit): Trước khi đếm 3 đơn chờ thanh toán, tự động dọn dẹp đơn quá hạn 30 phút của chính user đó (hoàn kho & voucher 1 lần) để khách không bị chặn oan; chặn đơn chờ thứ 4 còn hạn và chặn vượt 10 đơn/giờ', async () => {
  const { resetOrderCreateRateLimit } = await import('../server/routes/orders.ts');
  resetOrderCreateRateLimit();

  const jar = new BrowserCookieJar(true);
  await jar.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });

  await queryRows(sql`
    UPDATE orders SET status = 'cancelled', cancel_reason = 'Clear pending' WHERE status = 'pending';
  `);

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE sku = 'UI-SKU-001' LIMIT 1;`);
  const varId = vRows[0].id;
  await queryRows(sql`UPDATE product_variants SET stock_quantity = 50 WHERE id = ${varId}::uuid;`);

  // Tạo 1 voucher để gắn vào đơn quá hạn
  await queryRows(sql`
    INSERT INTO vouchers (code, discount_type, discount_value, max_discount, min_order_value, usage_limit, per_user_limit, used_count, start_date, end_date, is_active)
    VALUES ('CLEANUP3ORD', 'fixed', 20000, 20000, 100000, 10, 5, 0, NOW() - INTERVAL '1 day', NOW() + INTERVAL '30 days', true)
    ON CONFLICT (code) DO UPDATE SET used_count = 0, is_active = true;
  `);

  // 1. Tạo 3 đơn chờ thanh toán VietQR (đơn số 1 dùng voucher CLEANUP3ORD)
  const createdOrderIds: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const resOnline = await jar.fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ variantId: varId, quantity: 1 }],
        receiverName: `Khách Online ${i}`,
        receiverPhone: '0912345678',
        shippingAddress: '123 Lê Lợi, Quận 1',
        paymentMethod: 'vietqr',
        ...(i === 1 ? { voucherCode: 'CLEANUP3ORD' } : {}),
      }),
    });
    assert.equal(resOnline.status, 201, `Đơn chờ thanh toán online thứ ${i} phải thành công 201`);
    const body = await resOnline.json();
    createdOrderIds.push(body.data.id);
  }

  // Khi cả 3 đơn đều còn hạn (< 30 phút), đơn thứ 4 bị chặn 400 MAX_PENDING_PAYMENT_ORDERS
  const fourthOnlineBlocked = await jar.fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách Online 4 Blocked',
      receiverPhone: '0912345678',
      shippingAddress: '123 Lê Lợi, Quận 1',
      paymentMethod: 'vietqr',
    }),
  });
  assert.equal(fourthOnlineBlocked.status, 400, 'Khi 3 đơn chờ đều còn hạn, đơn thứ 4 phải bị chặn 400');

  // 2. Phần 1.5: Giả lập đơn số 1 đã quá hạn 31 phút trước -> Khách đặt đơn mới sẽ tự động chạy Scoped Lazy Cleanup cho đơn số 1 (hoàn kho +1, hoàn voucher về 0) và cho phép đặt đơn mới thành công 201!
  const expiredOrderId = createdOrderIds[0];
  await queryRows(sql`
    UPDATE orders SET created_at = NOW() - INTERVAL '31 minutes' WHERE id = ${expiredOrderId};
  `);

  const stockBeforeNewOrder = await queryRows<{ stock_quantity: number }>(sql`
    SELECT stock_quantity FROM product_variants WHERE id = ${varId}::uuid;
  `);
  assert.equal(stockBeforeNewOrder[0].stock_quantity, 47);

  const unblockedRes = await jar.fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách Không Bị Chặn Oan',
      receiverPhone: '0912345678',
      shippingAddress: '123 Lê Lợi, Quận 1',
      paymentMethod: 'vietqr',
    }),
  });
  assert.equal(
    unblockedRes.status,
    201,
    'Khi 1 trong 3 đơn chờ đã quá hạn 30 phút, POST /api/orders phải tự dọn dẹp đơn quá hạn (hoàn kho + voucher) trước khi đếm để khách không bị chặn oan'
  );

  // Xác nhận đơn quá hạn đã chuyển sang cancelled, hoàn voucher used_count về 0 và tổng tồn kho vẫn là 47 (47 + 1 hoàn - 1 đơn mới = 47)
  const [expOrderRow, voucherAfterCleanup, stockAfterNewOrder] = await Promise.all([
    queryRows<{ status: string }>(sql`SELECT status FROM orders WHERE id = ${expiredOrderId};`),
    queryRows<{ used_count: number }>(sql`SELECT used_count FROM vouchers WHERE code = 'CLEANUP3ORD';`),
    queryRows<{ stock_quantity: number }>(sql`SELECT stock_quantity FROM product_variants WHERE id = ${varId}::uuid;`),
  ]);
  assert.equal(expOrderRow[0].status, 'cancelled');
  assert.equal(voucherAfterCleanup[0].used_count, 0, 'Lượt dùng voucher của đơn quá hạn phải được hoàn về 0 đúng 1 lần');
  assert.equal(stockAfterNewOrder[0].stock_quantity, 47, 'Kho được hoàn +1 từ đơn quá hạn và trừ -1 cho đơn mới');

  // 3. Kiểm tra Rate Limit 10 đơn/giờ/người (đã tạo 4 đơn thành công ở trên, tạo thêm 6 đơn COD -> đơn thứ 11 trả 429)
  await queryRows(sql`
    UPDATE orders SET status = 'cancelled', cancel_reason = 'Clear pending' WHERE status = 'pending';
  `);
  for (let i = 5; i <= 10; i++) {
    const resCod = await jar.fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ variantId: varId, quantity: 1 }],
        receiverName: `Khách Rate ${i}`,
        receiverPhone: '0912345678',
        shippingAddress: '123 Lê Lợi, Quận 1',
        paymentMethod: 'cod',
      }),
    });
    assert.equal(resCod.status, 201, `Đơn thứ ${i}/10 trong giờ phải thành công 201`);
  }

  const eleventhOrderRes = await jar.fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ variantId: varId, quantity: 1 }],
      receiverName: 'Khách Rate 11',
      receiverPhone: '0912345678',
      shippingAddress: '123 Lê Lợi, Quận 1',
      paymentMethod: 'cod',
    }),
  });
  assert.equal(eleventhOrderRes.status, 429, 'Đơn thứ 11 trong vòng 1 giờ phải bị chặn 429');
  resetOrderCreateRateLimit();
});

// MỤC 5: Dùng chung calculateServerShippingFee cho giỏ hàng, kiểm tra voucher và đặt hàng
test('Hardening 5 (Shared Server Shipping Fee Calculation): Đổi store_settings thì cả 3 nơi (GET /api/cart, POST /api/vouchers/validate, POST /api/orders) cùng đổi; validate voucher không nhận subtotal/shippingFee từ client', async () => {
  const { resetOrderCreateRateLimit } = await import('../server/routes/orders.ts');
  resetOrderCreateRateLimit();
  resetVoucherValidateRateLimit();

  const jar = new BrowserCookieJar(true);
  await jar.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE sku = 'UI-SKU-001' LIMIT 1;`);
  const varId = vRows[0].id;
  await queryRows(sql`UPDATE product_variants SET stock_quantity = 30 WHERE id = ${varId}::uuid;`);

  await queryRows(sql`
    UPDATE store_settings
    SET value = '{"freeShippingThreshold": 800000, "defaultShippingFee": 42000, "expressShippingFee": 75000}'::jsonb
    WHERE key = 'general';
  `);

  try {
    await queryRows(sql`DELETE FROM cart_items;`);
    await jar.fetch('/api/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variantId: varId, quantity: 2 }),
    });

    const cartRes = await jar.fetch('/api/cart');
    const cartBody = await cartRes.json();
    assert.equal(cartBody.data.summary.shippingFee, 42000, 'GET /api/cart phải tính phí ship 42.000₫ theo store_settings mới');
    assert.equal(cartBody.data.summary.freeShippingThreshold, 800000);

    await queryRows(sql`
      INSERT INTO vouchers (code, discount_type, discount_value, max_discount, min_order_value, usage_limit, per_user_limit, used_count, start_date, end_date, is_active)
      VALUES ('SHIPSYNC2026', 'free_shipping', 0, NULL, 300000, 100, 5, 0, NOW() - INTERVAL '1 day', NOW() + INTERVAL '30 days', true)
      ON CONFLICT (code) DO UPDATE SET is_active = true, used_count = 0;
    `);
    const valRes = await jar.fetch('/api/vouchers/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'SHIPSYNC2026',
        items: [{ variantId: varId, quantity: 2 }],
      }),
    });
    assert.equal(valRes.status, 200);
    const valBody = await valRes.json();
    assert.equal(valBody.data.shippingFee, 42000, 'POST /api/vouchers/validate phải tính phí ship 42.000₫ theo store_settings mới');

    const orderRes = await jar.fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ variantId: varId, quantity: 2 }],
        receiverName: 'Khách Ship Sync',
        receiverPhone: '0912345678',
        shippingAddress: '123 Lê Lợi, Quận 1',
        shippingMethod: 'standard',
        paymentMethod: 'cod',
      }),
    });
    assert.equal(orderRes.status, 201);
    const orderBody = await orderRes.json();
    assert.equal(orderBody.data.shippingFee, 42000, 'POST /api/orders phải tính phí ship 42.000₫ đồng nhất với giỏ hàng và validate voucher');

    // Khi giỏ trống và client chỉ gửi subtotal/shippingFee mà không gửi items -> Từ chối 400
    await queryRows(sql`DELETE FROM cart_items;`);
    const fakeSubtotalRes = await jar.fetch('/api/vouchers/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'SHIPSYNC2026',
        subtotal: 900000,
        shippingFee: 42000,
      }),
    });
    assert.equal(fakeSubtotalRes.status, 400, 'Endpoint /api/vouchers/validate phải bỏ qua subtotal/shippingFee từ client');
  } finally {
    await queryRows(sql`
      UPDATE store_settings
      SET value = '{"freeShippingThreshold": 499000, "defaultShippingFee": 30000, "expressShippingFee": 50000}'::jsonb
      WHERE key = 'general';
    `);
  }
});

// MỤC 6: handleValidateVoucher giới hạn items 1-50 dòng, quantity 1-10 và chỉ trả các trường công khai của voucher
test('Hardening 6 (Voucher Validate Input Limits & Public Fields Only): POST /api/vouchers/validate kiểm tra items tối đa 50 dòng, quantity 1-10 và chỉ trả các trường công khai (không lộ id, used_count, usage_limit, per_user_limit)', async () => {
  resetVoucherValidateRateLimit();
  const jar = new BrowserCookieJar(true);
  await jar.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE sku = 'UI-SKU-001' LIMIT 1;`);
  const varId = vRows[0].id;

  // 1. quantity > 10 -> 400
  const overQtyVal = await jar.fetch('/api/vouchers/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'BAITYWELCOME',
      items: [{ variantId: varId, quantity: 11 }],
    }),
  });
  assert.equal(overQtyVal.status, 400, 'Validate voucher với quantity > 10 phải trả về 400');

  // 2. items > 50 dòng -> 400
  const overLinesVal = await jar.fetch('/api/vouchers/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'BAITYWELCOME',
      items: Array.from({ length: 51 }, () => ({ variantId: varId, quantity: 1 })),
    }),
  });
  assert.equal(overLinesVal.status, 400, 'Validate voucher với hơn 50 dòng items phải trả về 400');

  // 3. Response chỉ trả các trường công khai của voucher
  const validVal = await jar.fetch('/api/vouchers/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'BAITYWELCOME',
      items: [{ variantId: varId, quantity: 2 }],
    }),
  });
  assert.equal(validVal.status, 200);
  const valBody = await validVal.json();
  const voucherObj = valBody.data.voucher;
  assert.equal(voucherObj.code, 'BAITYWELCOME');
  assert.equal('id' in voucherObj, false, 'Không được lộ id nội bộ của voucher');
  assert.equal('usedCount' in voucherObj, false, 'Không được lộ usedCount');
  assert.equal('used_count' in voucherObj, false, 'Không được lộ used_count');
  assert.equal('usageLimit' in voucherObj, false, 'Không được lộ usageLimit');
  assert.equal('usage_limit' in voucherObj, false, 'Không được lộ usage_limit');
  assert.equal('perUserLimit' in voucherObj, false, 'Không được lộ perUserLimit');
  assert.equal('per_user_limit' in voucherObj, false, 'Không được lộ per_user_limit');
});

// MỤC 7: mergeGuestCartIntoUserCart chặn mỗi dòng không vượt 10 và không vượt tồn kho
test('Hardening 7 (Merge Guest Cart Cap 10 & Stock Limit): Sau khi gộp giỏ khách vãng lai vào giỏ người dùng, mỗi dòng không vượt 10 và không vượt tồn kho (LEAST(..., 10, stock))', async () => {
  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE sku = 'UI-SKU-001' LIMIT 1;`);
  const varId = vRows[0].id;
  await queryRows(sql`DELETE FROM cart_items;`);
  await queryRows(sql`UPDATE product_variants SET stock_quantity = 20 WHERE id = ${varId}::uuid;`);

  // User khach2 có sẵn 6 món trong giỏ
  const userJar = new BrowserCookieJar(true);
  await userJar.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach2@baity.vn', password: 'Khach@123' }),
  });
  await userJar.fetch('/api/cart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantId: varId, quantity: 6 }),
  });

  // Guest thêm 7 món rồi đăng nhập vào khach2 -> tổng 6 + 7 = 13 bị chặn ở trần 10
  const guestToUserJar = new BrowserCookieJar(true);
  await guestToUserJar.fetch('/api/cart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variantId: varId, quantity: 7 }),
  });
  await guestToUserJar.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach2@baity.vn', password: 'Khach@123' }),
  });

  const mergedCartRes = await guestToUserJar.fetch('/api/cart');
  const mergedCartBody = await mergedCartRes.json();
  assert.equal(mergedCartBody.data.items.length, 1);
  assert.equal(mergedCartBody.data.items[0].quantity, 10, 'Gộp giỏ (6 + 7) khi tồn kho 20 phải chặn đúng ở trần 10');
});

// MỤC 8: POST /api/cart song song dùng INSERT ... ON CONFLICT DO UPDATE không tạo dòng trùng hay vượt 10
test('Hardening 8 (Concurrent Cart Upsert via ON CONFLICT): Hai hoặc nhiều request POST /api/cart song song không tạo dòng trùng và không vượt trần 10', async () => {
  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE sku = 'UI-SKU-001' LIMIT 1;`);
  const varId = vRows[0].id;
  await queryRows(sql`DELETE FROM cart_items;`);
  await queryRows(sql`UPDATE product_variants SET stock_quantity = 20 WHERE id = ${varId}::uuid;`);

  const jar = new BrowserCookieJar(true);
  await jar.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach2@baity.vn', password: 'Khach@123' }),
  });

  const concurrentCartReqs = Array.from({ length: 5 }, () =>
    jar.fetch('/api/cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variantId: varId, quantity: 3 }),
    })
  );
  await Promise.all(concurrentCartReqs);

  const dbCartRows = await queryRows<{ quantity: number }>(sql`
    SELECT quantity FROM cart_items WHERE variant_id = ${varId}::uuid;
  `);
  assert.equal(dbCartRows.length, 1, 'UNIQUE constraint và ON CONFLICT phải đảm bảo chỉ có đúng 1 dòng');
  assert.ok(dbCartRows[0].quantity <= 10, 'Số lượng sau khi gọi song song không vượt quá 10');
});

// MỤC 9 & PHẦN 1.3 & PHẦN 1.4: Webhook HMAC trên rawBody, chỉ chấp nhận vietqr, lệch tiền ghi vào payment_events (không ghi order_status_history), chỉ Admin đọc được
test('Hardening 9 & Phần 1.3 & Phần 1.4 (Webhook RawBody HMAC Only, VietQR-Only & Admin-Only payment_events): Webhook chỉ nhận chữ ký HMAC trên rawBody kèm timestamp 5 phút (bỏ secret thô), chặn đơn COD, và khi lệch tiền ghi vào bảng riêng payment_events (chỉ Admin đọc được, không ghi order_status_history)', async () => {
  const { createWebhookSignature } = await import('../server/services/vietqr.ts');
  const { resetOrderCreateRateLimit } = await import('../server/routes/orders.ts');
  resetOrderCreateRateLimit();

  const prevWebhookEnable = process.env.ENABLE_DEMO_PAYMENT_WEBHOOK;
  const prevWebhookSecret = process.env.PAYMENT_WEBHOOK_SECRET;
  const prevStrict = process.env.PRODUCTION_STRICT;
  process.env.ENABLE_DEMO_PAYMENT_WEBHOOK = 'true';
  process.env.PAYMENT_WEBHOOK_SECRET = 'webhook-hardening-secret-2026';

  try {
    const custJar = new BrowserCookieJar(true);
    await custJar.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
    });

    await queryRows(sql`
      UPDATE orders SET status = 'cancelled', cancel_reason = 'Cleanup' WHERE status = 'pending';
    `);

    const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants WHERE sku = 'UI-SKU-001' LIMIT 1;`);
    const varId = vRows[0].id;
    await queryRows(sql`UPDATE product_variants SET stock_quantity = 20 WHERE id = ${varId}::uuid;`);

    const codOrderRes = await custJar.fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ variantId: varId, quantity: 1 }],
        receiverName: 'Khách COD Webhook',
        receiverPhone: '0912345678',
        shippingAddress: '123 Lê Lợi, Quận 1',
        paymentMethod: 'cod',
      }),
    });
    const codOrder = (await codOrderRes.json()).data;

    const vqrOrderRes = await custJar.fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ variantId: varId, quantity: 1 }],
        receiverName: 'Khách VietQR Webhook',
        receiverPhone: '0912345678',
        shippingAddress: '123 Lê Lợi, Quận 1',
        paymentMethod: 'vietqr',
      }),
    });
    const vqrOrder = (await vqrOrderRes.json()).data;

    const validRawBody = JSON.stringify({
      orderCode: vqrOrder.id,
      transactionId: `TX-EXP-${Date.now()}`,
      amount: vqrOrder.totalAmount,
    });
    const nowTs = String(Date.now());

    // 1. Phần 1.3: Ở Production (PRODUCTION_STRICT=true), gửi secret thô ở header x-webhook-secret (không có chữ ký HMAC) bị từ chối 401
    process.env.PRODUCTION_STRICT = 'true';
    const rawSecretHeaderRes = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-timestamp': nowTs,
        'x-webhook-secret': process.env.PAYMENT_WEBHOOK_SECRET!,
      },
      body: validRawBody,
    });
    assert.equal(rawSecretHeaderRes.status, 401, 'Gửi secret thô ở header mà không có chữ ký HMAC phải bị từ chối 401');
    delete process.env.PRODUCTION_STRICT;

    // 2. Timestamp lệch quá 5 phút -> 401
    const expiredTs = String(Date.now() - 6 * 60 * 1000);
    const expiredSig = createWebhookSignature(validRawBody, expiredTs, process.env.PAYMENT_WEBHOOK_SECRET!);
    const expRes = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-timestamp': expiredTs,
        'x-webhook-signature': expiredSig,
      },
      body: validRawBody,
    });
    assert.equal(expRes.status, 401, 'Webhook có timestamp lệch quá 5 phút phải bị từ chối 401');

    // 3. Thay đổi khoảng trắng trong rawBody sau khi ký -> 401
    const sigOnCompact = createWebhookSignature(validRawBody, nowTs, process.env.PAYMENT_WEBHOOK_SECRET!);
    const tamperedRawBody = validRawBody.replace('{', '{   ');
    const tamperedRes = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-timestamp': nowTs,
        'x-webhook-signature': sigOnCompact,
      },
      body: tamperedRawBody,
    });
    assert.equal(tamperedRes.status, 401, 'Chữ ký tính trên rawBody: sửa khoảng trắng trong rawBody phải bị từ chối 401');

    // 4. Đơn COD -> 400 WEBHOOK_INVALID_PAYMENT_METHOD
    const codRawBody = JSON.stringify({
      orderCode: codOrder.id,
      transactionId: `TX-COD-${Date.now()}`,
      amount: codOrder.totalAmount,
    });
    const codSig = createWebhookSignature(codRawBody, nowTs, process.env.PAYMENT_WEBHOOK_SECRET!);
    const codWebhookRes = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-timestamp': nowTs,
        'x-webhook-signature': codSig,
      },
      body: codRawBody,
    });
    assert.equal(codWebhookRes.status, 400);
    const codWebhookBody = await codWebhookRes.json();
    assert.equal(codWebhookBody.code, 'WEBHOOK_INVALID_PAYMENT_METHOD');

    // 5. Phần 1.4: Khi lệch tiền, KHÔNG ghi vào order_status_history mà ghi vào bảng riêng payment_events (chỉ Admin đọc được)
    const mismatchTxId = `TX-MISMATCH-${Date.now()}`;
    const mismatchRawBody = JSON.stringify({
      orderCode: vqrOrder.id,
      transactionId: mismatchTxId,
      amount: vqrOrder.totalAmount - 5000,
    });
    const mismatchSig = createWebhookSignature(mismatchRawBody, nowTs, process.env.PAYMENT_WEBHOOK_SECRET!);
    const mismatchRes = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-timestamp': nowTs,
        'x-webhook-signature': mismatchSig,
      },
      body: mismatchRawBody,
    });
    assert.equal(mismatchRes.status, 400);
    const mismatchBody = await mismatchRes.json();
    assert.equal(mismatchBody.code, 'WEBHOOK_AMOUNT_MISMATCH');

    // Xác nhận KHÔNG có dòng nào trong order_status_history
    const historyMismatchRows = await queryRows(sql`
      SELECT id FROM order_status_history WHERE order_id = ${vqrOrder.id} AND changed_by = 'webhook_mismatch';
    `);
    assert.equal(historyMismatchRows.length, 0, 'Tuyệt đối không ghi lệch tiền webhook vào order_status_history');

    // Khách hàng (kể cả chủ đơn) gọi GET /api/orders/:id/payment-events bị chặn 403
    const custEventsRes = await custJar.fetch(`/api/orders/${vqrOrder.id}/payment-events`);
    assert.equal(custEventsRes.status, 403, 'Khách hàng không được phép đọc bảng payment_events (403)');

    // Admin gọi GET /api/orders/:id/payment-events đọc được sự kiện lệch tiền
    resetLoginRateLimit('127.0.0.1', 'admin.events@baity.vn');
    const adminHash = bcrypt.hashSync('Admin@123', 4);
    await queryRows(sql`
      INSERT INTO users (full_name, email, phone, password_hash, role)
      VALUES ('Quản Trị Viên', 'admin.events@baity.vn', '0900000099', ${adminHash}, 'admin')
      ON CONFLICT (email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          role = 'admin',
          password_changed_at = NULL;
    `);
    const adminJar = new BrowserCookieJar(true);
    const adminLoginRes = await adminJar.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin.events@baity.vn', password: 'Admin@123' }),
    });
    assert.equal(adminLoginRes.status, 200);
    const adminEventsRes = await adminJar.fetch(`/api/orders/${vqrOrder.id}/payment-events`);
    assert.equal(adminEventsRes.status, 200, 'Admin có quyền đọc payment_events của đơn hàng');
    const adminEventsBody = await adminEventsRes.json();
    assert.equal(adminEventsBody.data.length, 1);
    assert.equal(adminEventsBody.data[0].eventType, 'amount_mismatch');
    assert.equal(adminEventsBody.data[0].expectedAmount, vqrOrder.totalAmount);
    assert.equal(adminEventsBody.data[0].receivedAmount, vqrOrder.totalAmount - 5000);
    assert.equal(adminEventsBody.data[0].transactionId, mismatchTxId);
  } finally {
    if (prevWebhookEnable !== undefined) process.env.ENABLE_DEMO_PAYMENT_WEBHOOK = prevWebhookEnable;
    else delete process.env.ENABLE_DEMO_PAYMENT_WEBHOOK;
    if (prevWebhookSecret !== undefined) process.env.PAYMENT_WEBHOOK_SECRET = prevWebhookSecret;
    else delete process.env.PAYMENT_WEBHOOK_SECRET;
    if (prevStrict !== undefined) process.env.PRODUCTION_STRICT = prevStrict;
    else delete process.env.PRODUCTION_STRICT;
  }
});

// MỤC 10: Lỗi 500 không trả err.message (chi tiết SQL) cho client trên orders, payments, cart, vouchers
test('Hardening 10 (500 Error Sanitization on Orders, Payments, Cart & Vouchers): Khi xảy ra lỗi 500 hệ thống/SQL, phản hồi chỉ trả thông báo chung kèm mã INTERNAL_SERVER_ERROR, tuyệt đối không lộ err.message hay tên bảng SQL', async () => {
  const jar = new BrowserCookieJar(true);
  await jar.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });

  // Tạm đổi tên bảng cart_items để gây lỗi SQL khi gọi GET /api/cart
  await queryRows(sql`ALTER TABLE cart_items RENAME TO cart_items_temp_broken;`);
  let cartErrRes: Response;
  try {
    cartErrRes = await jar.fetch('/api/cart');
  } finally {
    await queryRows(sql`ALTER TABLE cart_items_temp_broken RENAME TO cart_items;`);
  }

  assert.equal(cartErrRes.status, 500, 'Phải trả về HTTP 500 khi bảng SQL gặp sự cố');
  const cartErrBody = await cartErrRes.json();
  assert.equal(cartErrBody.code, 'INTERNAL_SERVER_ERROR');
  assert.ok(
    !JSON.stringify(cartErrBody).includes('cart_items'),
    'Phản hồi lỗi 500 tuyệt đối không được lộ chi tiết SQL hay tên bảng cart_items'
  );
});

// MỤC 11 & PHẦN 1.8: optionalAuth trả 503 DB_UNAVAILABLE khi DB lỗi & giao diện hiện "Hệ thống đang bận, vui lòng thử lại" mà không đăng xuất / xóa giỏ
test('Hardening 11 & Phần 1.8 (optionalAuth 503 DB_UNAVAILABLE & UI Preserves Session/Cart): optionalAuth trả 503 DB_UNAVAILABLE khi DB lỗi; giao diện hiện "Hệ thống đang bận, vui lòng thử lại" và không đăng xuất người dùng hay xóa giỏ', async () => {
  const { generateToken, optionalAuth } = await import('../server/services/auth.ts');
  const { extractApiError, getHttpStatusDefaultMessage, isDbUnavailableError, DB_UNAVAILABLE_UI_MESSAGE } = await import('../src/lib/api.ts');

  const validUuidToken = generateToken({
    id: '00000000-0000-0000-0000-000000000002',
    email: 'khach1@baity.vn',
    role: 'customer',
  });
  let statusSent = 0;
  let jsonSent: any = null;
  let nextCalled = false;
  const mockReq: any = {
    cookies: { baity_token: validUuidToken },
    headers: {},
  };
  const mockRes: any = {
    headersSent: false,
    status(code: number) {
      statusSent = code;
      this.headersSent = true;
      return this;
    },
    json(payload: any) {
      jsonSent = payload;
      return this;
    },
  };
  await queryRows(sql`ALTER TABLE users RENAME TO users_temp_offline;`);
  try {
    await optionalAuth(mockReq, mockRes, () => {
      nextCalled = true;
    });
  } finally {
    await queryRows(sql`ALTER TABLE users_temp_offline RENAME TO users;`);
  }
  assert.equal(nextCalled, false, 'Khi DB lỗi trong optionalAuth, không được gọi next() như khách chưa đăng nhập');
  assert.equal(statusSent, 503, 'optionalAuth phải trả về HTTP 503 khi truy vấn DB gặp lỗi');
  assert.equal(jsonSent?.code, 'DB_UNAVAILABLE');

  // Phần 1.8: Kiểm tra xử lý phía giao diện (src/lib/api.ts) khi API trả 503 DB_UNAVAILABLE
  assert.equal(getHttpStatusDefaultMessage(503), 'Hệ thống đang bận, vui lòng thử lại');
  const extracted503 = extractApiError(jsonSent, 'Fallback', 503);
  assert.equal(extracted503.code, 'DB_UNAVAILABLE');
  assert.equal(extracted503.message, DB_UNAVAILABLE_UI_MESSAGE);
  assert.equal(isDbUnavailableError(503, extracted503.code), true, 'isDbUnavailableError phải nhận diện đúng lỗi 503 DB_UNAVAILABLE để giữ nguyên currentUser và cartItems');
});

// MỤC 12: JWT bỏ khóa mặc định, coi PRODUCTION_STRICT là production, khóa algorithms: ['HS256'], hạn 12h cho Admin và 7d cho Khách
test('Hardening 12 (JWT Ephemeral Dev Secret, PRODUCTION_STRICT Guard, HS256 & 12h/7d Expiry): JWT không dùng khóa cố định, chặn thiếu JWT_SECRET ở PRODUCTION_STRICT=true, chỉ nhận HS256, thời hạn Admin 12h và Khách 7d', async () => {
  const jwt = (await import('jsonwebtoken')).default;
  const { generateToken, verifyToken, getJwtSecret } = await import('../server/services/auth.ts');

  const adminToken = generateToken({ id: '00000000-0000-0000-0000-000000000001', email: 'admin@baity.vn', role: 'admin' });
  const customerToken = generateToken({ id: '00000000-0000-0000-0000-000000000002', email: 'khach1@baity.vn', role: 'customer' });

  const decodedAdmin = jwt.decode(adminToken) as { iat: number; exp: number };
  const decodedCustomer = jwt.decode(customerToken) as { iat: number; exp: number };
  assert.equal(decodedAdmin.exp - decodedAdmin.iat, 12 * 3600, 'Token Admin phải có thời hạn 12 giờ (43200s)');
  assert.equal(decodedCustomer.exp - decodedCustomer.iat, 7 * 86400, 'Token Khách phải có thời hạn 7 ngày (604800s)');

  const secret = getJwtSecret();
  const hs384Token = jwt.sign(
    { id: '00000000-0000-0000-0000-000000000001', email: 'admin@baity.vn', role: 'admin' },
    secret,
    { algorithm: 'HS384', expiresIn: '1h' }
  );
  assert.equal(verifyToken(hs384Token), null, 'verifyToken phải từ chối token không dùng thuật toán HS256');

  const prevSecret = process.env.JWT_SECRET;
  const prevStrict = process.env.PRODUCTION_STRICT;
  try {
    delete process.env.JWT_SECRET;
    process.env.PRODUCTION_STRICT = 'true';
    assert.throws(
      () => getJwtSecret(),
      (err: any) => err instanceof Error && err.message.includes('JWT_SECRET'),
      'Ở PRODUCTION_STRICT=true, thiếu JWT_SECRET phải ném lỗi ngay'
    );

    delete process.env.PRODUCTION_STRICT;
    const ephemeralSecret = getJwtSecret();
    assert.equal(ephemeralSecret.length, 64, 'Ở dev khi thiếu JWT_SECRET phải sinh khóa ngẫu nhiên 32 byte');
    assert.ok(!ephemeralSecret.includes('baity-fashion-dev-only'));
  } finally {
    if (prevSecret !== undefined) process.env.JWT_SECRET = prevSecret;
    else delete process.env.JWT_SECRET;
    if (prevStrict !== undefined) process.env.PRODUCTION_STRICT = prevStrict;
    else delete process.env.PRODUCTION_STRICT;
  }
});

// MỤC 13: Bộ đếm Rate Limit trong RAM tự dọn mục hết hạn và giới hạn kích thước tối đa (10.000 mục)
test('Hardening 13 (Bounded In-Memory Rate Limiters with Pruning & FIFO Eviction): Bộ đếm rate limit tự dọn mục hết hạn và cắt giảm kích thước về đúng trần maxEntries, kèm ẩn token khôi phục trong log', async () => {
  const {
    checkLoginRateLimit,
    recordFailedLogin,
    getLoginRateLimitSizeForTest,
    pruneLoginAttemptsWithCapForTest,
  } = await import('../server/services/auth.ts');
  const { maskResetUrlForLog } = await import('../server/services/email.ts');

  recordFailedLogin('203.0.113.199', 'ratetest@baity.vn');
  const check = checkLoginRateLimit('203.0.113.199', 'ratetest@baity.vn');
  assert.equal(check.allowed, true);
  assert.ok(getLoginRateLimitSizeForTest() >= 3);
  pruneLoginAttemptsWithCapForTest(1);
  assert.equal(getLoginRateLimitSizeForTest(), 1, 'pruneLoginAttempts phải cắt giảm kích thước Map về đúng trần maxEntries');
  resetLoginRateLimit('203.0.113.199', 'ratetest@baity.vn');

  const rawUrl = 'https://ais-dev-preview.run.app/?token=9f8e7d6c5b4a32109f8e7d6c5b4a3210';
  const masked = maskResetUrlForLog(rawUrl);
  assert.ok(!masked.includes('9f8e7d6c5b4a3210'), 'Link trong log tuyệt đối không được lộ raw reset token');
  assert.ok(masked.includes('token=***REDACTED***'));
});

// ==========================================
// PHẦN 1 - CỦNG CỐ MỤC 3: MỌI BẢNG TRONG CSDL VÀ MIGRATIONS MỚI ĐỀU BẬT ROW LEVEL SECURITY (RLS)
// ==========================================
test('Phần 1.3 (RLS Enabled on All Application Tables & New Migrations): Tất cả bảng ứng dụng đều có pg_class.relrowsecurity = true và các migration tạo bảng mới (payment_events, uploads) đều có ALTER TABLE ... ENABLE ROW LEVEL SECURITY ngay trong migration', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');

  // 1. Truy vấn pg_class.relrowsecurity xác nhận không có bảng ứng dụng nào chưa bật RLS
  const tablesWithoutRls = await queryRows<{ tablename: string }>(sql`
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND c.relkind = 'r'
      AND c.relname <> '__drizzle_migrations'
      AND c.relrowsecurity = false
    ORDER BY c.relname;
  `);

  assert.deepEqual(
    tablesWithoutRls.map((r) => r.tablename),
    [],
    `Phát hiện bảng ứng dụng CHƯA bật RLS: ${tablesWithoutRls.map((r) => r.tablename).join(', ')}`
  );

  // 2. Kiểm tra tĩnh tất cả các tệp migration từ 0006 trở đi: hễ có CREATE TABLE "<tên_bảng>" thì phải có ENABLE ROW LEVEL SECURITY cho bảng đó
  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  const sqlFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && f >= '0006_')
    .sort();

  const allNewMigrationsContent = sqlFiles
    .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
    .join('\n');

  for (const file of sqlFiles) {
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const createMatches = [...content.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"([^"]+)"/gi)];
    for (const match of createMatches) {
      const tableName = match[1];
      const rlsRegex = new RegExp(
        `ALTER TABLE\\s+"?${tableName}"?\\s+ENABLE ROW LEVEL SECURITY`,
        'i'
      );
      assert.ok(
        rlsRegex.test(content) || rlsRegex.test(allNewMigrationsContent),
        `Bảng mới "${tableName}" trong ${file} bắt buộc phải có ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY`
      );
    }
  }
});

// ==========================================
// PHẦN 1 - CỦNG CỐ MỤC 4: GET /api/orders/:id/payment-events DÙNG MIDDLEWARE requireAdmin Ở TẦNG ROUTER & KHÔNG LỘ PII
// ==========================================
test('Phần 1.4 (GET /api/orders/:id/payment-events Router Middleware requireAdmin & Zero Extra PII): Endpoint dùng requireAdmin ở tầng router; chưa đăng nhập trả 401, khách trả 403, admin trả 200 và không trả dữ liệu cá nhân thừa', async () => {
  const { ordersRouter } = await import('../server/routes/orders.ts');
  const { requireAdmin } = await import('../server/services/auth.ts');

  // 1. Xác nhận cấu trúc tầng router của ordersRouter có gắn trực tiếp middleware requireAdmin cho route /:id/payment-events
  const paymentEventsLayer = (ordersRouter as any).stack.find(
    (layer: any) => layer.route && layer.route.path === '/:id/payment-events'
  );
  assert.ok(paymentEventsLayer, 'Route /:id/payment-events phải tồn tại trong ordersRouter');
  const routeMiddlewareFns = paymentEventsLayer.route.stack.map((s: any) => s.handle);
  assert.ok(
    routeMiddlewareFns.includes(requireAdmin),
    'Route GET /api/orders/:id/payment-events bắt buộc phải gắn middleware requireAdmin ở tầng router'
  );

  // 2. Chưa đăng nhập -> 401
  const unauthRes = await fetch(`${baseUrl}/api/orders/BAITY-1001/payment-events`);
  assert.equal(unauthRes.status, 401, 'Chưa đăng nhập gọi payment-events phải nhận 401');

  // 3. Khách hàng đã đăng nhập -> 403 từ middleware requireAdmin
  const custJar = new BrowserCookieJar(true);
  await custJar.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'khach1@baity.vn', password: 'Khach@123' }),
  });
  const custRes = await custJar.fetch('/api/orders/BAITY-1001/payment-events');
  assert.equal(custRes.status, 403, 'Khách hàng gọi payment-events phải nhận 403 từ requireAdmin');

  // 4. Admin đã đăng nhập -> 200 và không trả dữ liệu cá nhân thừa (không có tên, SĐT, email, địa chỉ, userId)
  const sampleOrderRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM orders LIMIT 1;
  `);
  const targetOrderId = sampleOrderRows[0]?.id || 'BAITY-1001';
  await queryRows(sql`
    INSERT INTO payment_events (order_id, event_type, expected_amount, received_amount, transaction_id)
    VALUES (${targetOrderId}, 'amount_mismatch', 350000, 300000, 'TX-PII-CHECK-001');
  `);

  resetLoginRateLimit('127.0.0.1', 'admin.events@baity.vn');
  const adminHash = bcrypt.hashSync('Admin@123', 4);
  await queryRows(sql`
    INSERT INTO users (full_name, email, phone, password_hash, role)
    VALUES ('Quản Trị Viên', 'admin.events@baity.vn', '0900000099', ${adminHash}, 'admin')
    ON CONFLICT (email) DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        role = 'admin',
        password_changed_at = NULL;
  `);
  const adminJar = new BrowserCookieJar(true);
  await adminJar.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin.events@baity.vn', password: 'Admin@123' }),
  });

  const adminRes = await adminJar.fetch(`/api/orders/${targetOrderId}/payment-events`);
  assert.equal(adminRes.status, 200, 'Admin gọi payment-events phải nhận 200');
  const adminBody = await adminRes.json();
  assert.equal(adminBody.success, true);
  assert.ok(Array.isArray(adminBody.items) && adminBody.items.length >= 1);

  const eventObj = adminBody.items[0];
  const allowedKeys = [
    'id',
    'orderId',
    'eventType',
    'expectedAmount',
    'receivedAmount',
    'transactionId',
    'createdAt',
  ].sort();
  assert.deepEqual(
    Object.keys(eventObj).sort(),
    allowedKeys,
    'Mỗi bản ghi payment_events chỉ trả đúng các trường đối soát, tuyệt đối không trả thừa PII (receiverName, phone, email, address, userId)'
  );
});

// ==========================================
// PHẦN 1 - CỦNG CỐ MỤC 5 & MỤC 7: CÔNG CỤ DEV-ONLY `dev:set-order-status`
// ==========================================
test('Phần 1.5 & Mục 7 (Dev-Only CLI dev:set-order-status): Bắt buộc ALLOW_DEV_TOOLS=true, in cảnh báo rõ host database, chuyển trạng thái đơn theo máy trạng thái kèm order_status_history và delivered_at; từ chối chạy ở Production; không lộ PII', async () => {
  const { runDevSetOrderStatus, assertDevOnlyEnvironment, extractDatabaseHost } = await import(
    '../scripts/dev-set-order-status.ts'
  );

  // 1. Từ chối chạy khi NODE_ENV=production, RENDER=true hoặc PRODUCTION_STRICT=true (kể cả khi truyền ALLOW_DEV_TOOLS=true)
  assert.throws(
    () => assertDevOnlyEnvironment({ NODE_ENV: 'production', ALLOW_DEV_TOOLS: 'true' } as any),
    (err: any) => err?.code === 'DEV_TOOL_FORBIDDEN_IN_PRODUCTION'
  );
  assert.throws(
    () =>
      assertDevOnlyEnvironment({
        NODE_ENV: 'development',
        RENDER: 'true',
        ALLOW_DEV_TOOLS: 'true',
      } as any),
    (err: any) => err?.code === 'DEV_TOOL_FORBIDDEN_IN_PRODUCTION'
  );
  assert.throws(
    () =>
      assertDevOnlyEnvironment({
        NODE_ENV: 'development',
        PRODUCTION_STRICT: 'true',
        ALLOW_DEV_TOOLS: 'true',
      } as any),
    (err: any) => err?.code === 'DEV_TOOL_FORBIDDEN_IN_PRODUCTION'
  );

  // 1b. Từ chối chạy nếu thiếu ALLOW_DEV_TOOLS=true
  assert.throws(
    () => assertDevOnlyEnvironment({ NODE_ENV: 'development' } as any),
    (err: any) => err?.code === 'ALLOW_DEV_TOOLS_REQUIRED'
  );
  assert.throws(
    () => assertDevOnlyEnvironment({ NODE_ENV: 'development', ALLOW_DEV_TOOLS: 'false' } as any),
    (err: any) => err?.code === 'ALLOW_DEV_TOOLS_REQUIRED'
  );

  // 1c. Kiểm tra hàm trích xuất host DB không làm lộ mật khẩu kết nối
  assert.equal(
    extractDatabaseHost('postgresql://postgres:secretPass123@db.example.supabase.co:5432/postgres'),
    'db.example.supabase.co:5432'
  );

  // 2. Tạo một đơn hàng ở trạng thái pending và dùng runDevSetOrderStatus để chuyển sang delivered
  const userRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM users WHERE email = 'khach1@baity.vn' LIMIT 1;
  `);
  const cliOrderId = `BAITY-CLI-${Date.now()}`;
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status
    )
    VALUES (
      ${cliOrderId},
      ${userRows[0].id}::uuid,
      'Nguyễn Văn Bí Mật PII',
      '0919888777',
      '999 Đường Bí Mật, Quận 1, TP.HCM',
      'standard',
      30000,
      350000,
      0,
      380000,
      'pending'
    );
  `);

  const warnLogs: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => {
    warnLogs.push(args.map(String).join(' '));
  };

  let resDelivered: any;
  try {
    resDelivered = await runDevSetOrderStatus({
      orderId: cliOrderId,
      targetStatus: 'delivered',
      env: {
        NODE_ENV: 'test',
        ALLOW_DEV_TOOLS: 'true',
        DATABASE_URL: 'postgresql://postgres:topSecretPwd@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres',
      } as any,
    });
  } finally {
    console.warn = origWarn;
  }

  assert.ok(
    warnLogs.some((l) =>
      l.includes('aws-0-ap-southeast-1.pooler.supabase.com:6543') && !l.includes('topSecretPwd')
    ),
    'Phải in cảnh báo rõ host database đang tác động và tuyệt đối không in mật khẩu DB'
  );

  assert.equal(resDelivered.orderId, cliOrderId);
  assert.equal(resDelivered.previousStatus, 'pending');
  assert.equal(resDelivered.currentStatus, 'delivered');
  assert.deepEqual(resDelivered.steps, ['confirmed', 'processing', 'shipping', 'delivered']);
  assert.ok(resDelivered.deliveredAt, 'Khi sang delivered phải ghi nhận delivered_at');

  // Xác nhận kết quả trả về của công cụ không chứa bất kỳ thông tin cá nhân (PII) nào
  const serializedOutput = JSON.stringify(resDelivered);
  assert.ok(!serializedOutput.includes('Nguyễn Văn Bí Mật PII'));
  assert.ok(!serializedOutput.includes('0919888777'));
  assert.ok(!serializedOutput.includes('999 Đường Bí Mật'));

  // Xác nhận order_status_history trong DB đã ghi đầy đủ các bước chuyển trạng thái
  const historyRows = await queryRows<{ status: string }>(sql`
    SELECT status FROM order_status_history WHERE order_id = ${cliOrderId} ORDER BY created_at ASC, id ASC;
  `);
  assert.deepEqual(
    historyRows.map((h) => h.status),
    ['confirmed', 'processing', 'shipping', 'delivered']
  );

  // 3. Thử chuyển ngược máy trạng thái từ delivered về pending -> phải bị từ chối INVALID_STATE_TRANSITION
  await assert.rejects(
    async () =>
      await runDevSetOrderStatus({
        orderId: cliOrderId,
        targetStatus: 'pending',
        env: { NODE_ENV: 'test', ALLOW_DEV_TOOLS: 'true' } as any,
      }),
    (err: any) => err?.code === 'INVALID_STATE_TRANSITION'
  );
});

// ==========================================
// CỦNG CỐ MỤC 2 & PHẦN 2 MỤC 3: MỘT BẢN MIDDLEWARE XÁC THỰC DUY NHẤT & KIỂM TOÁN BẢO MẬT ROUTE
// ==========================================
test('Phần 2.3 (Single Auth Middleware & Route Security Audit): Chỉ tồn tại duy nhất server/services/auth.ts; mọi route POST/PUT/PATCH/DELETE đều có requireAuth/requireAdmin hoặc nằm trong PUBLIC_MUTATING_ROUTE_ALLOWLIST kèm lý do; /api/admin/*, payment-events, cập nhật trạng thái đổi trả và trả lời đánh giá đều có requireAdmin; thêm route mới thiếu middleware sẽ làm test hỏng', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { Router } = await import('express');
  const { requireAuth, requireAdmin, optionalAuth } = await import('../server/services/auth.ts');
  const { apiRouter } = await import('../server/routes/api.ts');
  const { collectExpressRoutes, extractRouterRoutes } = await import(
    '../scripts/project-state.ts'
  );
  const { PUBLIC_MUTATING_ROUTE_ALLOWLIST } = await import(
    '../server/routes/publicRouteAllowlist.ts'
  );

  // 1. Xác nhận không tồn tại thư mục/file trùng lặp server/middleware/auth.ts hay server/middleware/rateLimit.ts
  assert.equal(
    fs.existsSync(path.resolve(process.cwd(), 'server/middleware/auth.ts')),
    false,
    'Không được có bản trùng server/middleware/auth.ts'
  );
  assert.equal(
    fs.existsSync(path.resolve(process.cwd(), 'server/middleware/rateLimit.ts')),
    false,
    'Không được có bản trùng server/middleware/rateLimit.ts'
  );

  // 2. Xác nhận tất cả file router trong server/routes/ chỉ import xác thực từ ../services/auth.ts
  const routesDir = path.resolve(process.cwd(), 'server/routes');
  const routeFiles = fs
    .readdirSync(routesDir)
    .filter((f) => f.endsWith('.ts') && f !== 'publicRouteAllowlist.ts')
    .sort();
  for (const file of routeFiles) {
    const src = fs.readFileSync(path.join(routesDir, file), 'utf-8');
    assert.ok(
      src.includes("from '../services/auth.ts'"),
      `File ${file} phải import xác thực từ ../services/auth.ts`
    );
    assert.equal(
      src.includes('middleware/auth'),
      false,
      `File ${file} không được import từ middleware/auth`
    );
  }

  // 3. Duyệt cây router của apiRouter để khẳng định /api/admin/* và mọi route bảo vệ đều gắn đúng cùng một instance requireAuth / requireAdmin
  const adminMiddlewareLayer = (apiRouter as any).stack.find(
    (l: any) => l.name === 'requireAdmin' || (l.regexp && String(l.regexp).includes('admin'))
  );
  assert.ok(adminMiddlewareLayer, 'Nhánh /api/admin/* phải được đăng ký trên apiRouter');

  const collectedAuthHandles = new Set<Function>();
  function inspectRouterStack(stack: any[]) {
    for (const layer of stack || []) {
      if (layer.handle === requireAuth || layer.handle === requireAdmin || layer.handle === optionalAuth) {
        collectedAuthHandles.add(layer.handle);
      }
      if (layer.route?.stack) {
        for (const routeLayer of layer.route.stack) {
          if (
            routeLayer.handle === requireAuth ||
            routeLayer.handle === requireAdmin ||
            routeLayer.handle === optionalAuth
          ) {
            collectedAuthHandles.add(routeLayer.handle);
          }
        }
      }
      if (layer.handle?.stack) {
        inspectRouterStack(layer.handle.stack);
      }
    }
  }
  inspectRouterStack((apiRouter as any).stack);
  assert.ok(collectedAuthHandles.has(requireAuth), 'apiRouter phải sử dụng đúng hàm requireAuth từ server/services/auth.ts');
  assert.ok(collectedAuthHandles.has(requireAdmin), 'apiRouter phải sử dụng đúng hàm requireAdmin từ server/services/auth.ts');
  assert.ok(collectedAuthHandles.has(optionalAuth), 'apiRouter phải sử dụng đúng hàm optionalAuth từ server/services/auth.ts');

  // 4. Kiểm toán bảo mật toàn bộ route bằng chính collectExpressRoutes() từ scripts/project-state.ts
  const allowlistMap = new Map<string, (typeof PUBLIC_MUTATING_ROUTE_ALLOWLIST)[number]>();
  for (const item of PUBLIC_MUTATING_ROUTE_ALLOWLIST) {
    assert.ok(
      item.reason && item.reason.trim().length >= 10,
      `Mục công khai ${item.method} ${item.fullPath} bắt buộc phải có lý do rõ ràng`
    );
    allowlistMap.set(`${item.method} ${item.fullPath}`, item);
  }

  function auditMutatingRoutes(routes: ReturnType<typeof collectExpressRoutes>): string[] {
    const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    const violations: string[] = [];
    for (const r of routes) {
      if (!mutatingMethods.has(r.method)) continue;
      const hasStrictAuth =
        r.authMiddlewares.includes('requireAuth') || r.authMiddlewares.includes('requireAdmin');
      if (hasStrictAuth) continue;

      const allowEntry = allowlistMap.get(`${r.method} ${r.fullPath}`);
      if (!allowEntry) {
        violations.push(
          `${r.method} ${r.fullPath} (${r.source}) thiếu requireAuth/requireAdmin và không có trong PUBLIC_MUTATING_ROUTE_ALLOWLIST`
        );
      }
    }
    return violations;
  }

  const allRoutes = collectExpressRoutes();
  const routeViolations = auditMutatingRoutes(allRoutes);
  assert.deepEqual(
    routeViolations,
    [],
    `Phát hiện route thay đổi dữ liệu chưa gắn requireAuth/requireAdmin: ${routeViolations.join('; ')}`
  );

  // Đảm bảo không có mục thừa trong PUBLIC_MUTATING_ROUTE_ALLOWLIST không tồn tại trên router thật
  for (const allowed of PUBLIC_MUTATING_ROUTE_ALLOWLIST) {
    const exists = allRoutes.some(
      (r) => r.method === allowed.method && r.fullPath === allowed.fullPath
    );
    assert.ok(
      exists,
      `Mục trong PUBLIC_MUTATING_ROUTE_ALLOWLIST (${allowed.method} ${allowed.fullPath}) phải tương ứng với route thực tế`
    );
  }

  // 5. Khẳng định các route quản trị nhạy cảm bắt buộc có requireAdmin ở tầng router:
  //    - ALL /api/admin/*
  //    - PUT /api/admin/orders/:id/status
  //    - PUT /api/admin/returns/:id/decision
  //    - GET /api/orders/:id/payment-events
  //    - PUT /api/reviews/:id/reply
  //    Và hai route trùng cũ (PUT /api/orders/:id/status, PATCH /api/returns/:id/status) đã được gỡ bỏ hoàn toàn.
  assert.equal(
    allRoutes.some((r) => r.method === 'PUT' && r.fullPath === '/api/orders/:id/status'),
    false,
    'Route trùng PUT /api/orders/:id/status phải được gỡ bỏ hoàn toàn'
  );
  assert.equal(
    allRoutes.some((r) => r.method === 'PATCH' && r.fullPath === '/api/returns/:id/status'),
    false,
    'Route trùng PATCH /api/returns/:id/status phải được gỡ bỏ hoàn toàn'
  );

  const requiredAdminRoutes: { method: string; fullPath: string }[] = [
    { method: 'ALL', fullPath: '/api/admin/*' },
    { method: 'PUT', fullPath: '/api/admin/orders/:id/status' },
    { method: 'PUT', fullPath: '/api/admin/returns/:id/decision' },
    { method: 'GET', fullPath: '/api/orders/:id/payment-events' },
    { method: 'PUT', fullPath: '/api/reviews/:id/reply' },
  ];

  for (const expectedAdmin of requiredAdminRoutes) {
    const found = allRoutes.find(
      (r) => r.method === expectedAdmin.method && r.fullPath === expectedAdmin.fullPath
    );
    assert.ok(
      found,
      `Phải tồn tại route ${expectedAdmin.method} ${expectedAdmin.fullPath} trong hệ thống`
    );
    assert.ok(
      found.authMiddlewares.includes('requireAdmin'),
      `Route ${expectedAdmin.method} ${expectedAdmin.fullPath} bắt buộc phải có middleware requireAdmin ở tầng router (hiện tại: ${found.authMiddlewares.join(', ')})`
    );
  }

  // 6. Kiểm thử tự kiểm (Self-check): Tạo bản sao app thật bằng createApp(), đăng ký thêm một route POST không có middleware xác thực và chứng minh collectExpressRoutes(clonedApp) + bộ kiểm toán phát hiện ngay
  const clonedApp = createApp();
  clonedApp.post('/api/unprotected-mutation-on-app', (_req, res) => res.json({ ok: true }));
  const clonedAppRoutes = collectExpressRoutes(clonedApp);
  const clonedAppViolations = auditMutatingRoutes(clonedAppRoutes);
  assert.equal(
    clonedAppViolations.length,
    1,
    'Khi đăng ký thêm một route POST không có middleware xác thực trên bản sao createApp(), collectExpressRoutes(clonedApp) phải đọc từ _router.stack thật và phát hiện ngay'
  );
  assert.match(clonedAppViolations[0], /POST \/api\/unprotected-mutation-on-app/);

  const dummyRouter = Router();
  dummyRouter.post('/unprotected-subrouter-mutation', (_req, res) => res.json({ ok: true }));
  const clonedAppWithSubRouter = createApp();
  clonedAppWithSubRouter.use('/api/dummy', dummyRouter);
  const subRouterViolations = auditMutatingRoutes(collectExpressRoutes(clonedAppWithSubRouter));
  assert.equal(
    subRouterViolations.length,
    1,
    'Khi gắn thêm sub-router có route POST thiếu middleware xác thực vào bản sao createApp(), bộ kiểm toán phải phát hiện ngay'
  );
  assert.match(subRouterViolations[0], /POST \/api\/dummy\/unprotected-subrouter-mutation/);
});

test('Canary Route Coverage (Every Router & Stage 8c/8d/6d): collectExpressRoutes thu thập đầy đủ ít nhất 26 route đại diện từ MỌI router (bao gồm 8c, 8d, 6d) và báo lỗi ngay nếu thiếu bất kỳ route nào', async () => {
  const { collectExpressRoutes } = await import('../scripts/project-state.ts');
  const allRoutes = collectExpressRoutes();

  // Danh sách >= 26 route đại diện trải đều khắp MỌI router (apiRouter, authRouter, userRouter, productsRouter,
  // cartRouter, wishlistRouter, vouchersRouter, ordersRouter, paymentsRouter, returnsRouter, reviewsRouter,
  // chatRouter + 6d, visualSearchRouter, adminRouter, adminStage8cRouter, adminStage8dRouter + 6d admin chat)
  const canaryRoutes: { method: string; fullPath: string; expectedSource: string }[] = [
    // 1. apiRouter (server/routes/api.ts)
    { method: 'GET', fullPath: '/api/health', expectedSource: 'server/routes/api.ts' },
    { method: 'GET', fullPath: '/api/policies/:slug', expectedSource: 'server/routes/api.ts' },
    { method: 'POST', fullPath: '/api/tasks/cron-cleanup', expectedSource: 'server/routes/api.ts' },
    // 2. authRouter (server/routes/auth.ts)
    { method: 'POST', fullPath: '/api/auth/login', expectedSource: 'server/routes/auth.ts' },
    // 3. userRouter (server/routes/user.ts)
    { method: 'GET', fullPath: '/api/user/profile', expectedSource: 'server/routes/user.ts' },
    // 4. productsRouter (server/routes/products.ts)
    { method: 'GET', fullPath: '/api/products', expectedSource: 'server/routes/products.ts' },
    // 5. cartRouter (server/routes/cart.ts)
    { method: 'POST', fullPath: '/api/cart', expectedSource: 'server/routes/cart.ts' },
    // 6. wishlistRouter (server/routes/wishlist.ts)
    { method: 'POST', fullPath: '/api/wishlist', expectedSource: 'server/routes/wishlist.ts' },
    // 7. vouchersRouter (server/routes/vouchers.ts)
    { method: 'POST', fullPath: '/api/vouchers/validate', expectedSource: 'server/routes/vouchers.ts' },
    // 8. ordersRouter & paymentsRouter (server/routes/orders.ts)
    { method: 'POST', fullPath: '/api/orders', expectedSource: 'server/routes/orders.ts' },
    { method: 'POST', fullPath: '/api/payments/webhook', expectedSource: 'server/routes/orders.ts' },
    // 9. returnsRouter (server/routes/returns.ts)
    { method: 'POST', fullPath: '/api/returns', expectedSource: 'server/routes/returns.ts' },
    // 10. reviewsRouter (server/routes/reviews.ts)
    { method: 'POST', fullPath: '/api/reviews', expectedSource: 'server/routes/reviews.ts' },
    // 11. chatRouter — AI Chatbot + Stage 6d Seller Chat (server/routes/chat.ts)
    { method: 'POST', fullPath: '/api/chat', expectedSource: 'server/routes/chat.ts' },
    { method: 'POST', fullPath: '/api/chat/conversations', expectedSource: 'server/routes/chat.ts' },
    { method: 'GET', fullPath: '/api/chat/conversations/me', expectedSource: 'server/routes/chat.ts' },
    { method: 'POST', fullPath: '/api/chat/conversations/me/messages', expectedSource: 'server/routes/chat.ts' },
    { method: 'POST', fullPath: '/api/chat/conversations/me/read', expectedSource: 'server/routes/chat.ts' },
    // 12. visualSearchRouter (server/routes/visualSearch.ts)
    { method: 'POST', fullPath: '/api/visual-search', expectedSource: 'server/routes/visualSearch.ts' },
    // 13. adminRouter — Stage 8a & 8b (server/routes/admin.ts)
    { method: 'PUT', fullPath: '/api/admin/orders/:id/status', expectedSource: 'server/routes/admin.ts' },
    { method: 'DELETE', fullPath: '/api/admin/products/:id', expectedSource: 'server/routes/admin.ts' },
    // 14. adminStage8cRouter — Stage 8c (server/routes/adminStage8c.ts)
    { method: 'GET', fullPath: '/api/admin/vouchers', expectedSource: 'server/routes/adminStage8c.ts' },
    { method: 'POST', fullPath: '/api/admin/promotions', expectedSource: 'server/routes/adminStage8c.ts' },
    { method: 'PUT', fullPath: '/api/admin/settings', expectedSource: 'server/routes/adminStage8c.ts' },
    { method: 'PUT', fullPath: '/api/admin/policies/:slug', expectedSource: 'server/routes/adminStage8c.ts' },
    // 15. adminStage8dRouter — Stage 8d & Stage 6d Admin Seller Chat (server/routes/adminStage8d.ts)
    { method: 'GET', fullPath: '/api/admin/overview', expectedSource: 'server/routes/adminStage8d.ts' },
    { method: 'GET', fullPath: '/api/admin/stats/overview', expectedSource: 'server/routes/adminStage8d.ts' },
    { method: 'GET', fullPath: '/api/admin/stats/export.csv', expectedSource: 'server/routes/adminStage8d.ts' },
    { method: 'GET', fullPath: '/api/admin/chats', expectedSource: 'server/routes/adminStage8d.ts' },
    { method: 'POST', fullPath: '/api/admin/chats/:id/messages', expectedSource: 'server/routes/adminStage8d.ts' },
    { method: 'PATCH', fullPath: '/api/admin/chats/:id/status', expectedSource: 'server/routes/adminStage8d.ts' },
  ];

  assert.ok(canaryRoutes.length >= 20, 'Danh sách canary phải có ít nhất 20 route đại diện');

  for (const canary of canaryRoutes) {
    const matched = allRoutes.find(
      (r) => r.method === canary.method && r.fullPath === canary.fullPath
    );
    assert.ok(
      matched,
      `Canary thất bại: collectExpressRoutes bỏ sót route ${canary.method} ${canary.fullPath}`
    );
    assert.equal(
      matched.source,
      canary.expectedSource,
      `Route ${canary.method} ${canary.fullPath} phải được ghi nhận đúng file nguồn ${canary.expectedSource} (thực tế: ${matched.source})`
    );
  }
});

test('Two-Level Nested Router Security Audit Self-Check: Gắn router lồng 2 tầng chứa route POST thiếu xác thực vào createApp(), chứng minh collectExpressRoutes và bộ kiểm toán phát hiện ngay', async () => {
  const { Router } = await import('express');
  const { createApp } = await import('../server/app.ts');
  const { collectExpressRoutes } = await import('../scripts/project-state.ts');
  const { PUBLIC_MUTATING_ROUTE_ALLOWLIST } = await import('../server/routes/publicRouteAllowlist.ts');

  const allowlistSet = new Set(
    PUBLIC_MUTATING_ROUTE_ALLOWLIST.map((item) => `${item.method} ${item.fullPath}`)
  );

  const outerRouter = Router();
  const innerRouter = Router();
  innerRouter.post('/deep-unprotected-action', (_req, res) => res.json({ ok: true }));
  outerRouter.use('/level2', innerRouter);

  const testApp = createApp();
  testApp.use('/api/level1', outerRouter);

  const collected = collectExpressRoutes(testApp);
  const foundNested = collected.find(
    (r) => r.method === 'POST' && r.fullPath === '/api/level1/level2/deep-unprotected-action'
  );
  assert.ok(
    foundNested,
    'collectExpressRoutes phải đệ quy thu thập được route bên trong router lồng 2 tầng (/api/level1/level2/deep-unprotected-action)'
  );

  const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const violations = collected.filter((r) => {
    if (!mutatingMethods.has(r.method)) return false;
    const hasStrictAuth =
      r.authMiddlewares.includes('requireAuth') || r.authMiddlewares.includes('requireAdmin');
    if (hasStrictAuth) return false;
    return !allowlistSet.has(`${r.method} ${r.fullPath}`);
  });

  assert.equal(
    violations.length,
    1,
    'Bộ kiểm toán phải phát hiện đúng 1 vi phạm từ route POST không xác thực nằm trong router lồng 2 tầng'
  );
  assert.equal(violations[0].fullPath, '/api/level1/level2/deep-unprotected-action');
});

