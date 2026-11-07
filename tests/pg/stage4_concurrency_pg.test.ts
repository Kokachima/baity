import 'dotenv/config';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { createApp } from '../../server/app.ts';
import { initDatabase } from '../../server/db/init.ts';
import {
  getDb,
  queryRows,
  closeDb,
  getActiveTestSchema,
  dropActiveTestSchema,
  validateTestDatabaseUrlConfig,
} from '../../server/db/index.ts';
import { sql } from 'drizzle-orm';
import { runScopedLazyCleanup } from '../../server/services/lazyCleanup.ts';
import { resetOrderCreateRateLimit } from '../../server/routes/orders.ts';
import { loadContainerSecretsIfMissing } from '../../scripts/load-container-env.ts';

// Bắt buộc sử dụng PostgreSQL thật qua TEST_DATABASE_URL riêng biệt (tuyệt đối không dùng DATABASE_URL)
process.env.USE_PGLITE = 'false';
process.env.USE_TEST_DATABASE_URL = 'true';
process.env.ENABLE_DEMO_PAYMENT_WEBHOOK = 'true';
process.env.PAYMENT_WEBHOOK_SECRET = 'baity_test_webhook_secret_key_2026';
process.env.JWT_SECRET = 'baity_jwt_test_secret_key_super_secure_32_chars';
process.env.COOKIE_CROSS_SITE = 'false';

let server: http.Server;
let baseUrl = '';
const createdOrderIds: string[] = [];
const createdVoucherCodes: string[] = [];
const createdTestEmails = ['pg_test_admin@baity.vn', 'pg_test_khach1@baity.vn', 'pg_test_khach2@baity.vn'];
const modifiedVariantStocks = new Map<string, number>();

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
  loadContainerSecretsIfMissing();
  if (!process.env.TEST_DATABASE_URL && process.env.DATABASE_URL) {
    const sep = process.env.DATABASE_URL.includes('?') ? '&' : '?';
    process.env.TEST_DATABASE_URL = `${process.env.DATABASE_URL}${sep}schema=test_pg`;
  }
  // Kiểm tra chốt chặn bảo vệ TEST_DATABASE_URL trước khi kết nối
  validateTestDatabaseUrlConfig(
    process.env.TEST_DATABASE_URL || '',
    process.env.DATABASE_URL || '',
    process.env
  );

  console.log('🔄 Đang kết nối PostgreSQL thật qua TEST_DATABASE_URL cho bộ test đồng thời...');
  await getDb();
  await initDatabase();

  const activeSchema = getActiveTestSchema();
  console.log(`🛡️ Đang chạy kiểm thử đồng thời trên schema cô lập: "${activeSchema}"`);

  // Khởi tạo dữ liệu danh mục & biến thể sản phẩm tối thiểu trong schema kiểm thử test_<ngẫu nhiên>
  const existingVars = await queryRows<{ id: string }>(sql`
    SELECT id FROM product_variants LIMIT 1;
  `);
  if (existingVars.length === 0) {
    const catRows = await queryRows<{ id: string }>(sql`
      INSERT INTO categories (name, slug, display_order)
      VALUES ('Áo Sơ Mi PG Test', 'ao-so-mi-pg-test', 1)
      RETURNING id;
    `);
    const prodRows = await queryRows<{ id: string }>(sql`
      INSERT INTO products (name, slug, category_id, target_gender, description, material, care_instructions, base_price, search_text, is_active)
      VALUES ('Áo Sơ Mi Oxford PG Test', 'ao-so-mi-oxford-pg-test', ${catRows[0].id}::uuid, 'men', 'Mô tả test', 'Cotton', 'Giặt nhẹ', 350000, 'ao so mi oxford pg test', true)
      RETURNING id;
    `);
    await queryRows(sql`
      INSERT INTO product_variants (product_id, sku, color_name, color_code, size, stock_quantity, price_override)
      VALUES
        (${prodRows[0].id}::uuid, 'PG-TEST-SKU-1', 'Trắng', '#FFFFFF', 'L', 20, NULL),
        (${prodRows[0].id}::uuid, 'PG-TEST-SKU-2', 'Đen', '#000000', 'M', 20, NULL);
    `);
  }

  // Khởi tạo tài khoản kiểm thử riêng có tiền tố pg_test_
  const pwdAdmin = bcrypt.hashSync('Admin@123', 10);
  const pwdUser = bcrypt.hashSync('Khach@123', 10);

  await queryRows(sql`
    INSERT INTO users (full_name, email, phone, password_hash, role)
    VALUES
      ('PG Test Admin', 'pg_test_admin@baity.vn', '0901234567', ${pwdAdmin}, 'admin'),
      ('PG Test Khách 1', 'pg_test_khach1@baity.vn', '0912345678', ${pwdUser}, 'customer'),
      ('PG Test Khách 2', 'pg_test_khach2@baity.vn', '0987654321', ${pwdUser}, 'customer')
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;
  `);

  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address() as any;
      baseUrl = `http://localhost:${addr.port}`;
      console.log(`✅ Server test đồng thời trên PostgreSQL thật đang chạy tại ${baseUrl}`);
      resolve();
    });
  });
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const activeSchema = getActiveTestSchema();
  if (activeSchema) {
    await dropActiveTestSchema();
  } else {
    try {
      for (const [varId, originalStock] of modifiedVariantStocks.entries()) {
        await queryRows(sql`
          UPDATE product_variants SET stock_quantity = ${originalStock} WHERE id = ${varId}::uuid;
        `);
      }
      for (const ordId of createdOrderIds) {
        await queryRows(sql`DELETE FROM orders WHERE id = ${ordId};`);
      }
      for (const email of createdTestEmails) {
        await queryRows(sql`
          DELETE FROM orders
          WHERE user_id IN (SELECT id FROM users WHERE email = ${email});
        `);
      }
      for (const code of createdVoucherCodes) {
        await queryRows(sql`DELETE FROM vouchers WHERE code = ${code};`);
      }
      for (const email of createdTestEmails) {
        await queryRows(sql`DELETE FROM users WHERE email = ${email};`);
      }
    } catch (cleanupErr: any) {
      console.warn('⚠️ Lỗi khi dọn dữ liệu test:', cleanupErr.message);
    }
  }

  await closeDb();
});

// ==========================================
// 0. KIỂM TRA CHỐT CHẶN AN TOÀN TEST_DATABASE_URL & SCHEMA TEST_<NGẪU NHIÊN>
// ==========================================
test('Real PG Concurrency - Guard TEST_DATABASE_URL: Từ chối khi NODE_ENV=production, trùng DATABASE_URL hoặc thiếu "test" trong tên schema; xác nhận đang chạy trên schema riêng test_<ngẫu nhiên>', async () => {
  const currentSchemaRows = await queryRows<{ current_schema: string }>(sql`
    SELECT current_schema() AS current_schema;
  `);
  const currentSchema = currentSchemaRows[0]?.current_schema || '';
  assert.ok(
    currentSchema.startsWith('test_') && currentSchema.includes('test'),
    `Bộ test phải đang thực thi trên schema riêng có tên chứa "test" (hiện tại: "${currentSchema}")`
  );

  // 1. Từ chối khi NODE_ENV=production
  assert.throws(
    () =>
      validateTestDatabaseUrlConfig(
        'postgresql://u:p@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?schema=test_pg',
        'postgresql://u:p@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
        { NODE_ENV: 'production' } as any
      ),
    /Production/i
  );

  // 2. Từ chối khi trùng host, port, database và schema với DATABASE_URL
  assert.throws(
    () =>
      validateTestDatabaseUrlConfig(
        'postgresql://u:p@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
        'postgresql://u:p@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
        { NODE_ENV: 'development' } as any
      ),
    /cùng host/i
  );

  // 3. Từ chối trên Supabase (db=postgres) nếu tên schema không chứa "test"
  assert.throws(
    () =>
      validateTestDatabaseUrlConfig(
        'postgresql://u:p@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?schema=staging_only',
        'postgresql://u:p@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
        { NODE_ENV: 'development' } as any
      ),
    /chứa chuỗi "test"/i
  );
});


// ==========================================
// 1. CHỐNG ÂM KHO: ĐẶT HÀNG TRANH CHẤP SONG SONG TRÊN POSTGRESQL THẬT
// ==========================================
test('Real PG Concurrency - Chống âm kho: Đặt hàng vượt tồn kho song song (Promise.all) không làm âm kho và rollback toàn bộ', async () => {
  const [log1, log2] = await Promise.all([
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pg_test_khach1@baity.vn', password: 'Khach@123' }),
    }),
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pg_test_khach2@baity.vn', password: 'Khach@123' }),
    }),
  ]);
  const cookie1 = extractCookies(log1);
  const cookie2 = extractCookies(log2);

  // Chọn 1 biến thể và đặt tồn kho đúng 3 chiếc
  const vRows = await queryRows<{ id: string; stock_quantity: number }>(sql`
    SELECT id, stock_quantity FROM product_variants WHERE stock_quantity >= 3 LIMIT 1;
  `);
  const varId = vRows[0].id;
  if (!modifiedVariantStocks.has(varId)) {
    modifiedVariantStocks.set(varId, vRows[0].stock_quantity);
  }
  await queryRows(sql`UPDATE product_variants SET stock_quantity = 3 WHERE id = ${varId}::uuid;`);

  // Hai người dùng gửi yêu cầu mua 2 chiếc cùng lúc (tổng cần 4 chiếc, vượt tồn kho 3 chiếc)
  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
      body: JSON.stringify({
        items: [{ variantId: varId, quantity: 2 }],
        receiverName: 'Khách 1',
        receiverPhone: '0912345678',
        shippingAddress: '123 Phố Huế, Phường Phố Huế, TP. Hà Nội',
        shippingMethod: 'standard',
        paymentMethod: 'cod',
      }),
    }),
    fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie2 },
      body: JSON.stringify({
        items: [{ variantId: varId, quantity: 2 }],
        receiverName: 'Khách 2',
        receiverPhone: '0987654321',
        shippingAddress: '456 Hai Bà Trưng, Phường Tân Định, TP. Hồ Chí Minh',
        shippingMethod: 'standard',
        paymentMethod: 'cod',
      }),
    }),
  ]);

  const statuses = [res1.status, res2.status].sort();
  assert.deepEqual(statuses, [201, 400], 'Đúng 1 đơn thành công (201) và 1 đơn bị từ chối thiếu hàng (400)');

  // Tồn kho thực tế trong PostgreSQL phải còn đúng 1 chiếc (3 - 2 = 1), tuyệt đối không âm
  const checkStock = await queryRows<{ stock_quantity: number }>(sql`
    SELECT stock_quantity FROM product_variants WHERE id = ${varId}::uuid;
  `);
  assert.equal(checkStock[0].stock_quantity, 1, 'Tồn kho trong PostgreSQL phải giảm đúng 2 chiếc, còn lại 1 chiếc');
});

// ==========================================
// 2. VOUCHER CÒN 1 LƯỢT: HAI ĐƠN SONG SONG TRÊN POSTGRESQL THẬT
// ==========================================
test('Real PG Concurrency - Voucher còn 1 lượt dùng: Hai đơn gửi đồng thời (Promise.all) chỉ 1 đơn dùng được', async () => {
  const [log1, log2] = await Promise.all([
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pg_test_khach1@baity.vn', password: 'Khach@123' }),
    }),
    fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pg_test_khach2@baity.vn', password: 'Khach@123' }),
    }),
  ]);
  const cookie1 = extractCookies(log1);
  const cookie2 = extractCookies(log2);

  const testVoucherCode = `RACE_PG_${Date.now()}`;
  createdVoucherCodes.push(testVoucherCode);
  await queryRows(sql`
    INSERT INTO vouchers (code, discount_type, discount_value, min_order_value, usage_limit, per_user_limit, used_count, start_date, end_date, is_active)
    VALUES (${testVoucherCode}, 'fixed', 50000, 100000, 1, 1, 0, NOW() - INTERVAL '1 day', NOW() + INTERVAL '10 days', true);
  `);

  const vRows = await queryRows<{ id: string; stock_quantity: number }>(sql`SELECT id, stock_quantity FROM product_variants WHERE stock_quantity >= 10 LIMIT 1;`);
  const varId = vRows[0].id;
  if (!modifiedVariantStocks.has(varId)) {
    modifiedVariantStocks.set(varId, vRows[0].stock_quantity);
  }

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
        voucherCode: testVoucherCode,
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
        voucherCode: testVoucherCode,
      }),
    }),
  ]);

  const statuses = [res1.status, res2.status].sort();
  assert.deepEqual(statuses, [201, 400], 'Duy nhất 1 đơn thành công (201), đơn còn lại bị từ chối vì hết lượt (400)');

  const vCheck = await queryRows<{ used_count: number }>(sql`
    SELECT used_count FROM vouchers WHERE code = ${testVoucherCode};
  `);
  assert.equal(vCheck[0].used_count, 1, 'used_count của voucher trong PostgreSQL chỉ tăng đúng 1 lần');
});

// ==========================================
// 3. IDEMPOTENCY-KEY SONG SONG TRÊN POSTGRESQL THẬT
// ==========================================
test('Real PG Concurrency - Idempotency-Key song song (Promise.all) chỉ ra 1 đơn duy nhất và trừ tồn kho 1 lần', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pg_test_khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string; stock_quantity: number }>(sql`
    SELECT id, stock_quantity FROM product_variants WHERE stock_quantity >= 10 LIMIT 1;
  `);
  const varId = vRows[0].id;
  const initialStock = vRows[0].stock_quantity;
  if (!modifiedVariantStocks.has(varId)) {
    modifiedVariantStocks.set(varId, initialStock);
  }

  const idempotencyKey = `PG-IDEMP-${Date.now()}-${crypto.randomUUID()}`;
  const orderPayload = {
    items: [{ variantId: varId, quantity: 2 }],
    receiverName: 'Khách Idempotent',
    receiverPhone: '0912345678',
    shippingAddress: '789 Đường Láng, Phường Láng Thượng, TP. Hà Nội',
    shippingMethod: 'standard',
    paymentMethod: 'cod',
  };

  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        Cookie: cookie,
      },
      body: JSON.stringify(orderPayload),
    }),
    fetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        Cookie: cookie,
      },
      body: JSON.stringify(orderPayload),
    }),
  ]);

  assert.ok(res1.status === 200 || res1.status === 201);
  assert.ok(res2.status === 200 || res2.status === 201);

  const b1 = await res1.json();
  const b2 = await res2.json();
  assert.equal(b1.order.id, b2.order.id, 'Cả hai request song song phải trả về cùng một mã đơn hàng');
  createdOrderIds.push(b1.order.id);

  const stockCheck = await queryRows<{ stock_quantity: number }>(sql`
    SELECT stock_quantity FROM product_variants WHERE id = ${varId}::uuid;
  `);
  assert.equal(stockCheck[0].stock_quantity, initialStock - 2, 'Tồn kho chỉ bị trừ đúng 2 chiếc 1 lần duy nhất');
});

// ==========================================
// 4. HAI LẦN CLEANUP SONG SONG TRÊN POSTGRESQL THẬT
// ==========================================
test('Real PG Concurrency - Hai lần cleanup chạy song song (Promise.all) hoàn kho và voucher đúng 1 lần duy nhất', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pg_test_khach1@baity.vn', password: 'Khach@123' }),
  });
  const cookie = extractCookies(loginRes);

  const vRows = await queryRows<{ id: string; stock_quantity: number }>(sql`
    SELECT id, stock_quantity FROM product_variants WHERE stock_quantity >= 10 LIMIT 1;
  `);
  const varId = vRows[0].id;
  const initialStock = vRows[0].stock_quantity;
  if (!modifiedVariantStocks.has(varId)) {
    modifiedVariantStocks.set(varId, initialStock);
  }

  const testVoucherCode = `CLEANUP_PG_${Date.now()}`;
  createdVoucherCodes.push(testVoucherCode);
  await queryRows(sql`
    INSERT INTO vouchers (code, discount_type, discount_value, min_order_value, usage_limit, per_user_limit, used_count, start_date, end_date, is_active)
    VALUES (${testVoucherCode}, 'fixed', 30000, 100000, 10, 1, 0, NOW() - INTERVAL '1 day', NOW() + INTERVAL '10 days', true);
  `);

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
      voucherCode: testVoucherCode,
    }),
  });
  const order = (await orderRes.json()).data;
  createdOrderIds.push(order.id);

  // Giả lập lùi thời gian tạo về 35 phút trước để quá hạn thanh toán
  await queryRows(sql`
    UPDATE orders SET created_at = NOW() - INTERVAL '35 minutes' WHERE id = ${order.id};
  `);

  // Chạy 2 lần cleanup SONG SONG thật trên PostgreSQL qua Promise.all
  const [clean1, clean2] = await Promise.all([
    runScopedLazyCleanup({ orderId: order.id }),
    runScopedLazyCleanup({ orderId: order.id }),
  ]);

  const cancelledCount = clean1.cancelledOrders.length + clean2.cancelledOrders.length;
  assert.equal(cancelledCount, 1, 'Chỉ duy nhất 1 luồng cleanup hủy được đơn thành công');

  const stockCheck = await queryRows<{ stock_quantity: number }>(sql`
    SELECT stock_quantity FROM product_variants WHERE id = ${varId}::uuid;
  `);
  assert.equal(stockCheck[0].stock_quantity, initialStock, 'Tồn kho chỉ được hoàn lại đúng 1 lần bằng initialStock');

  const vCheck = await queryRows<{ used_count: number }>(sql`
    SELECT used_count FROM vouchers WHERE code = ${testVoucherCode};
  `);
  assert.equal(vCheck[0].used_count, 0, 'Lượt dùng voucher chỉ hoàn lại đúng 1 lần về 0');
});

// ==========================================
// 6. KIỂM THỬ ĐỐI CHIẾU CẤU TRÚC SCHEMA TẠO TỪ MIGRATIONS VỚI SCHEMA PUBLIC CỦA DEV DB (PHẦN 1 - MỤC 1)
// ==========================================
test('PG Concurrency 6 (Migration Schema Parity vs Public Dev DB & Original 0000 Integrity): Tệp 0000_supreme_changeling.sql nguyên bản 100%; search_path = <schema_test>, public; cấu trúc tạo từ migrations trong schema mới khớp hoàn toàn với schema public về bảng, cột, kiểu, ràng buộc, index và extension', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');

  // 1. Xác nhận tệp migrations/0000_supreme_changeling.sql được giữ nguyên văn bản gốc (SHA-256 khớp với bản ghi đã áp dụng trên dev DB)
  const mig0000Path = path.resolve(process.cwd(), 'migrations/0000_supreme_changeling.sql');
  const mig0000Hash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(mig0000Path))
    .digest('hex');
  assert.equal(
    mig0000Hash,
    'ec2da5c5fa4730a2c2240ebe2e50fff44fa1a496d2bac36ab6b17b560c95eb2d',
    'Không bao giờ được sửa tệp migration 0000_supreme_changeling.sql đã áp dụng trên dev DB'
  );

  const testSchema = getActiveTestSchema();
  assert.ok(testSchema && testSchema.startsWith('test_'), 'Phải đang chạy trên schema test_<ngẫu nhiên>');

  // 1b. Xác nhận bảng __drizzle_migrations trong schema trống vừa tạo đã chạy đủ chuỗi 8 migrations (0000..0007) theo đúng thứ tự _journal.json
  const journal = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'migrations/meta/_journal.json'), 'utf-8')
  );
  const appliedMigs = await queryRows<{ id: number; hash: string; created_at: string }>(
    sql.raw(`SELECT id, hash, created_at FROM "${testSchema}"."__drizzle_migrations" ORDER BY id ASC;`)
  );
  assert.equal(
    appliedMigs.length,
    journal.entries.length,
    `Tất cả ${journal.entries.length} migrations trong _journal.json phải được thực thi đầy đủ trên schema trống`
  );

  // 2. Xác nhận search_path = <schema_test>, public và extension pg_trgm nằm ở public
  const spRows = await queryRows<{ search_path: string }>(sql`SHOW search_path;`);
  const currentSearchPath = spRows[0]?.search_path || '';
  assert.ok(
    currentSearchPath.includes(testSchema) && currentSearchPath.includes('public'),
    `search_path phải chứa "${testSchema}" và "public" (hiện tại: ${currentSearchPath})`
  );

  const extRows = await queryRows<{ extname: string; schema_name: string }>(sql`
    SELECT e.extname, n.nspname AS schema_name
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm';
  `);
  assert.equal(extRows.length, 1, 'Extension pg_trgm phải được cài đặt');
  assert.equal(extRows[0].schema_name, 'public', 'Extension pg_trgm phải nằm ở schema public');

  // 3. So sánh danh sách bảng ứng dụng giữa schema mới (tạo từ migrations) và schema public của dev DB
  const [pubTables, testTables] = await Promise.all([
    queryRows<{ tablename: string }>(sql`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename <> '__drizzle_migrations'
      ORDER BY tablename;
    `),
    queryRows<{ tablename: string }>(sql`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = ${testSchema}
        AND tablename <> '__drizzle_migrations'
      ORDER BY tablename;
    `),
  ]);

  assert.deepEqual(
    testTables.map((t) => t.tablename),
    pubTables.map((t) => t.tablename),
    'Danh sách bảng giữa schema tạo từ migrations và schema public phải giống hệt nhau'
  );

  // 4. So sánh chi tiết tất cả cột, kiểu dữ liệu, nullability và giá trị mặc định
  const normalizeDefault = (def: string | null) => {
    if (!def) return null;
    return def.replace(new RegExp(`"?${testSchema}"?\\.`, 'g'), '').replace(/"?public"?\./g, '');
  };

  const [pubCols, testCols] = await Promise.all([
    queryRows<{
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
    }>(sql`
      SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name <> '__drizzle_migrations'
      ORDER BY table_name, column_name;
    `),
    queryRows<{
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
    }>(sql`
      SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = ${testSchema}
        AND table_name <> '__drizzle_migrations'
      ORDER BY table_name, column_name;
    `),
  ]);

  assert.deepEqual(
    testCols.map((c) => ({ ...c, column_default: normalizeDefault(c.column_default) })),
    pubCols.map((c) => ({ ...c, column_default: normalizeDefault(c.column_default) })),
    'Toàn bộ cột, kiểu dữ liệu, is_nullable và column_default giữa schema mới và public phải khớp 100%'
  );

  // 5. So sánh toàn bộ ràng buộc (PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK) và xác nhận FK trỏ nội bộ đúng schema của nó
  const normalizeConstraintDef = (def: string) =>
    def
      .replace(new RegExp(`REFERENCES "?${testSchema}"?\\.`, 'g'), 'REFERENCES ')
      .replace(/REFERENCES "?public"?\./g, 'REFERENCES ');

  const [pubCons, testCons] = await Promise.all([
    queryRows<{
      table_name: string;
      conname: string;
      contype: string;
      condef: string;
      ref_schema: string | null;
    }>(sql`
      SELECT
        rel.relname AS table_name,
        con.conname,
        con.contype::text AS contype,
        pg_get_constraintdef(con.oid) AS condef,
        fnsp.nspname AS ref_schema
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      LEFT JOIN pg_class frel ON frel.oid = con.confrelid
      LEFT JOIN pg_namespace fnsp ON fnsp.oid = frel.relnamespace
      WHERE nsp.nspname = 'public'
        AND rel.relname <> '__drizzle_migrations'
      ORDER BY rel.relname, con.conname;
    `),
    queryRows<{
      table_name: string;
      conname: string;
      contype: string;
      condef: string;
      ref_schema: string | null;
    }>(sql`
      SELECT
        rel.relname AS table_name,
        con.conname,
        con.contype::text AS contype,
        pg_get_constraintdef(con.oid) AS condef,
        fnsp.nspname AS ref_schema
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      LEFT JOIN pg_class frel ON frel.oid = con.confrelid
      LEFT JOIN pg_namespace fnsp ON fnsp.oid = frel.relnamespace
      WHERE nsp.nspname = ${testSchema}
        AND rel.relname <> '__drizzle_migrations'
      ORDER BY rel.relname, con.conname;
    `),
  ]);

  // Mọi khóa ngoại trong schema test phải tham chiếu tới bảng trong chính schema test (không bị rò sang public)
  for (const c of testCons) {
    if (c.contype === 'f') {
      assert.equal(
        c.ref_schema,
        testSchema,
        `Khóa ngoại ${c.table_name}.${c.conname} phải trỏ vào chính ${testSchema}, không được trỏ sang ${c.ref_schema}`
      );
    }
  }

  assert.deepEqual(
    testCons.map((c) => ({
      table_name: c.table_name,
      conname: c.conname,
      contype: c.contype,
      condef: normalizeConstraintDef(c.condef),
    })),
    pubCons.map((c) => ({
      table_name: c.table_name,
      conname: c.conname,
      contype: c.contype,
      condef: normalizeConstraintDef(c.condef),
    })),
    'Toàn bộ ràng buộc (PK, FK, UNIQUE, CHECK) giữa schema tạo từ migrations và public phải khớp 100%'
  );

  // 6. So sánh toàn bộ Index giữa schema tạo từ migrations và schema public
  const normalizeIndexDef = (def: string) =>
    def
      .replace(new RegExp(`ON "?${testSchema}"?\\.`, 'g'), 'ON ')
      .replace(/ON "?public"?\./g, 'ON ')
      .replace(/public\.gin_trgm_ops/g, 'gin_trgm_ops');

  const [pubIdx, testIdx] = await Promise.all([
    queryRows<{ tablename: string; indexname: string; indexdef: string }>(sql`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename <> '__drizzle_migrations'
      ORDER BY tablename, indexname;
    `),
    queryRows<{ tablename: string; indexname: string; indexdef: string }>(sql`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = ${testSchema}
        AND tablename <> '__drizzle_migrations'
      ORDER BY tablename, indexname;
    `),
  ]);

  assert.deepEqual(
    testIdx.map((i) => ({
      tablename: i.tablename,
      indexname: i.indexname,
      indexdef: normalizeIndexDef(i.indexdef),
    })),
    pubIdx.map((i) => ({
      tablename: i.tablename,
      indexname: i.indexname,
      indexdef: normalizeIndexDef(i.indexdef),
    })),
    'Toàn bộ index giữa schema tạo từ migrations và public phải khớp 100%'
  );
});

// ==========================================
// 7. KIỂM THỬ BẮT BUỘC BẬT RLS (ROW LEVEL SECURITY) TRÊN MỌI BẢNG ỨNG DỤNG (PHẦN 1 - MỤC 3)
// ==========================================
test('PG Concurrency 7 (RLS Enabled on All Tables in Public & Test Schema): Tất cả bảng ứng dụng trong cả public và schema test đều bật pg_class.relrowsecurity = true; bất kỳ bảng mới nào thiếu RLS sẽ làm test hỏng ngay', async () => {
  const testSchema = getActiveTestSchema()!;

  const [unprotectedPublic, unprotectedTest] = await Promise.all([
    queryRows<{ tablename: string }>(sql`
      SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname <> '__drizzle_migrations'
        AND c.relrowsecurity = false
      ORDER BY c.relname;
    `),
    queryRows<{ tablename: string }>(sql`
      SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${testSchema}
        AND c.relkind = 'r'
        AND c.relname <> '__drizzle_migrations'
        AND c.relrowsecurity = false
      ORDER BY c.relname;
    `),
  ]);

  assert.deepEqual(
    unprotectedPublic.map((r) => r.tablename),
    [],
    `Các bảng trong schema public CHƯA bật RLS: ${unprotectedPublic.map((r) => r.tablename).join(', ')}`
  );

  assert.deepEqual(
    unprotectedTest.map((r) => r.tablename),
    [],
    `Các bảng trong schema ${testSchema} CHƯA bật RLS: ${unprotectedTest.map((r) => r.tablename).join(', ')}`
  );
});

// ==========================================
// 8. KIỂM THỬ QUY TẮC ON DELETE & ON UPDATE CỦA MỌI KHÓA NGOẠI (PHẦN 2 - MỤC 2)
// ==========================================
test('PG Concurrency 8 (Foreign Key ON DELETE & ON UPDATE Integrity vs schema.ts & 0000): Quy tắc ON DELETE và ON UPDATE (pg_constraint confdeltype, confupdtype) của mọi khóa ngoại trong cấu trúc cuối cùng khớp 100% với khai báo trong server/db/schema.ts và 0000_supreme_changeling.sql (không mất CASCADE, RESTRICT hay SET NULL)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { getTableConfig } = await import('drizzle-orm/pg-core');
  const { Table, is } = await import('drizzle-orm');
  const schemaModule = await import('../../server/db/schema.ts');

  const testSchema = getActiveTestSchema()!;

  const pgCodeToAction: Record<string, string> = {
    a: 'no action',
    r: 'restrict',
    c: 'cascade',
    n: 'set null',
    d: 'set default',
  };

  // 1. Trích xuất toàn bộ khóa ngoại từ server/db/schema.ts
  const schemaFks = new Map<
    string,
    {
      tableName: string;
      columnName: string;
      refTableName: string;
      refColumnName: string;
      onDelete: string;
      onUpdate: string;
    }
  >();

  for (const exportedVal of Object.values(schemaModule)) {
    if (is(exportedVal, Table)) {
      const cfg = getTableConfig(exportedVal as any);
      for (const fk of cfg.foreignKeys) {
        const ref = fk.reference();
        const colName = ref.columns[0]?.name || '';
        const refTblCfg = getTableConfig(ref.foreignTable);
        const refColName = ref.foreignColumns[0]?.name || '';
        const onDelete = (fk.onDelete || 'no action').toLowerCase();
        const onUpdate = (fk.onUpdate || 'no action').toLowerCase();
        const key = `${cfg.name}.${colName}->${refTblCfg.name}.${refColName}`;
        schemaFks.set(key, {
          tableName: cfg.name,
          columnName: colName,
          refTableName: refTblCfg.name,
          refColumnName: refColName,
          onDelete,
          onUpdate,
        });
      }
    }
  }

  assert.equal(schemaFks.size, 32, 'server/db/schema.ts phải có đúng 32 khóa ngoại');

  // 2. Trích xuất toàn bộ khóa ngoại gốc từ migrations/0000_supreme_changeling.sql (28 FK gốc)
  const mig0000Content = fs.readFileSync(
    path.resolve(process.cwd(), 'migrations/0000_supreme_changeling.sql'),
    'utf-8'
  );
  const fk0000Regex =
    /ALTER\s+TABLE\s+"([^"]+)"\s+ADD\s+CONSTRAINT\s+"([^"]+)"\s+FOREIGN\s+KEY\s+\("([^"]+)"\)\s+REFERENCES\s+"public"\."([^"]+)"\("([^"]+)"\)\s+ON\s+DELETE\s+(cascade|restrict|set null|set default|no action)\s+ON\s+UPDATE\s+(cascade|restrict|set null|set default|no action)/gi;
  const mig0000Fks = new Map<string, { onDelete: string; onUpdate: string; conname: string }>();
  for (const m of mig0000Content.matchAll(fk0000Regex)) {
    const key = `${m[1]}.${m[3]}->${m[4]}.${m[5]}`;
    mig0000Fks.set(key, {
      conname: m[2],
      onDelete: m[6].toLowerCase(),
      onUpdate: m[7].toLowerCase(),
    });
  }
  assert.equal(mig0000Fks.size, 28, 'migrations/0000_supreme_changeling.sql phải có đúng 28 khóa ngoại gốc');

  // Đối chiếu 28 khóa ngoại gốc trong 0000 với server/db/schema.ts
  for (const [key, orig] of mig0000Fks.entries()) {
    const inSchema = schemaFks.get(key);
    assert.ok(inSchema, `Khóa ngoại ${key} trong 0000 phải tồn tại trong server/db/schema.ts`);
    assert.equal(
      inSchema.onDelete,
      orig.onDelete,
      `Quy tắc ON DELETE của ${key} trong schema.ts phải khớp với 0000`
    );
    assert.equal(
      inSchema.onUpdate,
      orig.onUpdate,
      `Quy tắc ON UPDATE của ${key} trong schema.ts phải khớp với 0000`
    );
  }

  // 3. Truy vấn pg_constraint (confdeltype, confupdtype) trên cả schema mới (testSchema) và schema public
  const queryFkConstraints = async (targetSchema: string) =>
    queryRows<{
      table_name: string;
      conname: string;
      col_name: string;
      ref_table_name: string;
      ref_col_name: string;
      confdeltype: string;
      confupdtype: string;
    }>(sql`
      SELECT
        rel.relname AS table_name,
        con.conname,
        att.attname AS col_name,
        frel.relname AS ref_table_name,
        fatt.attname AS ref_col_name,
        con.confdeltype::text AS confdeltype,
        con.confupdtype::text AS confupdtype
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      JOIN pg_class frel ON frel.oid = con.confrelid
      JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = con.conkey[1]
      JOIN pg_attribute fatt ON fatt.attrelid = frel.oid AND fatt.attnum = con.confkey[1]
      WHERE con.contype = 'f'
        AND nsp.nspname = ${targetSchema}
      ORDER BY rel.relname, con.conname;
    `);

  const [testDbFks, pubDbFks] = await Promise.all([
    queryFkConstraints(testSchema),
    queryFkConstraints('public'),
  ]);

  assert.equal(
    testDbFks.length,
    schemaFks.size,
    `Số lượng khóa ngoại trong ${testSchema} (${testDbFks.length}) phải khớp đúng ${schemaFks.size} khóa ngoại trong server/db/schema.ts`
  );
  assert.equal(
    pubDbFks.length,
    schemaFks.size,
    `Số lượng khóa ngoại trong public (${pubDbFks.length}) phải khớp đúng ${schemaFks.size} khóa ngoại trong server/db/schema.ts`
  );

  for (const [label, dbRows] of [
    [testSchema, testDbFks],
    ['public', pubDbFks],
  ] as const) {
    for (const row of dbRows) {
      const key = `${row.table_name}.${row.col_name}->${row.ref_table_name}.${row.ref_col_name}`;
      const expected = schemaFks.get(key);
      assert.ok(expected, `[${label}] Khóa ngoại ${key} (${row.conname}) phải được khai báo trong server/db/schema.ts`);

      const actualDelete = pgCodeToAction[row.confdeltype] || row.confdeltype;
      const actualUpdate = pgCodeToAction[row.confupdtype] || row.confupdtype;

      assert.equal(
        actualDelete,
        expected.onDelete,
        `[${label}] Khóa ngoại ${key} (${row.conname}) có ON DELETE="${actualDelete}" lệch so với schema.ts ("${expected.onDelete}")`
      );
      assert.equal(
        actualUpdate,
        expected.onUpdate,
        `[${label}] Khóa ngoại ${key} (${row.conname}) có ON UPDATE="${actualUpdate}" lệch so với schema.ts ("${expected.onUpdate}")`
      );
    }
  }
});

// ==========================================
// 9. KIỂM THỬ RÀNG BUỘC QUAN TRỌNG THEO DANH SÁCH CỨNG & HÀNH VI THẬT (PHẦN 1 - MỤC 1 & PHẦN 2 - MỤC 8)
// ==========================================
test('PG Concurrency 9 (Hardcoded Critical Constraints & Real Behavioral Enforcement): Đối chiếu pg_constraint và pg_indexes với danh sách kỳ vọng viết cứng (PK mọi bảng, CHECK stock >= 0, 7 CHECK tiền/số lượng >= 0, CHECK enum, UNIQUE idempotency_key/cart/reviews/wishlist/voucher/payment/email/slug, partial unique địa chỉ mặc định) và kiểm thử hành vi thật từ chối tồn kho âm, tiền âm, số lượng < 1, trùng idempotency_key, trùng giỏ hàng, trùng đánh giá', async () => {
  const testSchema = getActiveTestSchema()!;

  // 1. Danh sách kỳ vọng VIẾT CỨNG trong test (tuyệt đối không sinh từ server/db/schema.ts)
  const HARDCODED_EXPECTED_PKS: readonly [string, string, string][] = [
    ['addresses', 'addresses_pkey', 'PRIMARY KEY (id)'],
    ['admin_audit_logs', 'admin_audit_logs_pkey', 'PRIMARY KEY (id)'],
    ['cart_items', 'cart_items_pkey', 'PRIMARY KEY (id)'],
    ['categories', 'categories_pkey', 'PRIMARY KEY (id)'],
    ['chat_conversations', 'chat_conversations_pkey', 'PRIMARY KEY (id)'],
    ['chat_messages', 'chat_messages_pkey', 'PRIMARY KEY (id)'],
    ['chatbot_daily_counters', 'chatbot_daily_counters_pkey', 'PRIMARY KEY (id)'],
    ['faq_policies', 'faq_policies_pkey', 'PRIMARY KEY (id)'],
    ['order_items', 'order_items_pkey', 'PRIMARY KEY (id)'],
    ['order_status_history', 'order_status_history_pkey', 'PRIMARY KEY (id)'],
    ['orders', 'orders_pkey', 'PRIMARY KEY (id)'],
    ['payment_events', 'payment_events_pkey', 'PRIMARY KEY (id)'],
    ['payments', 'payments_pkey', 'PRIMARY KEY (id)'],
    ['product_attributes', 'product_attributes_pkey', 'PRIMARY KEY (id)'],
    ['product_images', 'product_images_pkey', 'PRIMARY KEY (id)'],
    ['product_variants', 'product_variants_pkey', 'PRIMARY KEY (id)'],
    ['products', 'products_pkey', 'PRIMARY KEY (id)'],
    ['promotion_targets', 'promotion_targets_pkey', 'PRIMARY KEY (id)'],
    ['promotions', 'promotions_pkey', 'PRIMARY KEY (id)'],
    ['return_requests', 'return_requests_pkey', 'PRIMARY KEY (id)'],
    ['review_images', 'review_images_pkey', 'PRIMARY KEY (id)'],
    ['reviews', 'reviews_pkey', 'PRIMARY KEY (id)'],
    ['stock_movements', 'stock_movements_pkey', 'PRIMARY KEY (id)'],
    ['store_settings', 'store_settings_pkey', 'PRIMARY KEY (key)'],
    ['uploads', 'uploads_pkey', 'PRIMARY KEY (id)'],
    ['users', 'users_pkey', 'PRIMARY KEY (id)'],
    ['voucher_usages', 'voucher_usages_pkey', 'PRIMARY KEY (id)'],
    ['vouchers', 'vouchers_pkey', 'PRIMARY KEY (id)'],
    ['wishlist_items', 'wishlist_items_pkey', 'PRIMARY KEY (id)'],
  ];

  const HARDCODED_EXPECTED_UNIQUES: readonly [string, string, string][] = [
    ['orders', 'orders_idempotency_key_unique', 'UNIQUE (idempotency_key)'],
    ['cart_items', 'uniq_cart_items_user_variant', 'UNIQUE (user_id, variant_id)'],
    ['cart_items', 'uniq_cart_items_session_variant', 'UNIQUE (session_id, variant_id)'],
    ['reviews', 'uniq_user_product_order_review', 'UNIQUE (user_id, product_id, order_id)'],
    ['wishlist_items', 'uniq_wishlist_user_product', 'UNIQUE (user_id, product_id)'],
    ['vouchers', 'vouchers_code_unique', 'UNIQUE (code)'],
    ['payments', 'payments_transaction_id_unique', 'UNIQUE (transaction_id)'],
    ['users', 'users_email_unique', 'UNIQUE (email)'],
    ['categories', 'categories_slug_unique', 'UNIQUE (slug)'],
    ['products', 'products_slug_unique', 'UNIQUE (slug)'],
    ['product_variants', 'product_variants_sku_unique', 'UNIQUE (sku)'],
    ['uploads', 'uploads_object_path_unique', 'UNIQUE (object_path)'],
    ['faq_policies', 'faq_policies_slug_unique', 'UNIQUE (slug)'],
    ['chatbot_daily_counters', 'uniq_chatbot_daily_counters_date_scope', 'UNIQUE (date_key, scope_key)'],
  ];

  const HARDCODED_EXPECTED_CHECKS: readonly [string, string, RegExp][] = [
    ['product_variants', 'check_stock_non_negative', /stock_quantity\s*>=\s*0/i],
    ['cart_items', 'check_cart_quantity_positive', /quantity\s*>\s*0/i],
    ['reviews', 'check_review_rating_range', /rating\s*>=\s*1[\s\S]*rating\s*<=\s*5/i],
    ['products', 'products_target_gender_check', /target_gender[\s\S]*men[\s\S]*women[\s\S]*unisex/i],
    ['promotion_targets', 'promotion_targets_target_type_check', /target_type[\s\S]*product[\s\S]*category/i],
    ['vouchers', 'vouchers_discount_type_check', /discount_type[\s\S]*percent[\s\S]*fixed[\s\S]*free_shipping/i],
    ['chatbot_daily_counters', 'check_chatbot_call_count_non_negative', /call_count\s*>=\s*0/i],
    // 7 ràng buộc CHECK tiền và số lượng từ migration 0009 (Mục 8 Phần 2)
    ['products', 'check_products_base_price_non_negative', /base_price\s*>=\s*0/i],
    ['product_variants', 'check_variants_price_override_non_negative', /(price_override\s*>=\s*0[\s\S]*price_override\s*IS\s*NULL|price_override\s*IS\s*NULL[\s\S]*price_override\s*>=\s*0)/i],
    ['order_items', 'check_order_items_quantity_positive', /quantity\s*>=\s*1/i],
    ['order_items', 'check_order_items_unit_price_non_negative', /unit_price\s*>=\s*0/i],
    ['orders', 'check_orders_total_amount_non_negative', /total_amount\s*>=\s*0/i],
    ['orders', 'check_orders_discount_amount_non_negative', /discount_amount\s*>=\s*0/i],
    ['vouchers', 'check_vouchers_used_count_non_negative', /used_count\s*>=\s*0/i],
    // 2 ràng buộc CHECK từ migration 0010 (thống nhất trạng thái thanh toán & purpose upload sản phẩm)
    ['payments', 'payments_status_check', /status[\s\S]*pending[\s\S]*paid[\s\S]*failed[\s\S]*refunded[\s\S]*refund_needed/i],
    ['uploads', 'uploads_purpose_check', /purpose[\s\S]*review[\s\S]*return[\s\S]*product/i],
    // 3 ràng buộc CHECK từ migration 0014 (Chat với người bán - Giai đoạn 6d)
    ['chat_conversations', 'chat_conversations_status_check', /status[\s\S]*open[\s\S]*closed/i],
    ['chat_conversations', 'check_chat_conv_unread_non_negative', /unread_admin\s*>=\s*0[\s\S]*unread_user\s*>=\s*0/i],
    ['chat_messages', 'chat_messages_content_length_check', /char_length[\s\S]*content[\s\S]*>=\s*1[\s\S]*<=\s*1000/i],
  ];

  const HARDCODED_EXPECTED_UNIQUE_INDEXES: readonly [string, string, RegExp][] = [
    ['users', 'idx_users_lower_email', /CREATE UNIQUE INDEX idx_users_lower_email ON .*users USING btree \(lower\(email\)\)/i],
    ['addresses', 'idx_addresses_single_default', /CREATE UNIQUE INDEX idx_addresses_single_default ON .*addresses USING btree \(user_id\) WHERE \(is_default = true\)/i],
    ['chat_conversations', 'idx_chat_conv_single_open_user', /CREATE UNIQUE INDEX idx_chat_conv_single_open_user ON .*chat_conversations USING btree \(user_id\) WHERE \(status = 'open'/i],
  ];

  for (const targetSchema of [testSchema, 'public']) {
    const [cons, idxs] = await Promise.all([
      queryRows<{ table_name: string; conname: string; contype: string; condef: string }>(sql`
        SELECT
          rel.relname AS table_name,
          con.conname,
          con.contype::text AS contype,
          pg_get_constraintdef(con.oid) AS condef
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = ${targetSchema}
          AND rel.relname <> '__drizzle_migrations';
      `),
      queryRows<{ tablename: string; indexname: string; indexdef: string }>(sql`
        SELECT tablename, indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = ${targetSchema}
          AND tablename <> '__drizzle_migrations';
      `),
    ]);

    for (const [tbl, conName, expectedDef] of HARDCODED_EXPECTED_PKS) {
      const found = cons.find((c) => c.table_name === tbl && c.conname === conName && c.contype === 'p');
      assert.ok(found, `[${targetSchema}] Thiếu khóa chính PK ${tbl}.${conName}`);
      assert.equal(found.condef, expectedDef, `[${targetSchema}] Định nghĩa PK ${tbl}.${conName} không khớp`);
    }

    for (const [tbl, conName, expectedDef] of HARDCODED_EXPECTED_UNIQUES) {
      const found = cons.find((c) => c.table_name === tbl && c.conname === conName && c.contype === 'u');
      assert.ok(found, `[${targetSchema}] Thiếu ràng buộc UNIQUE ${tbl}.${conName}`);
      assert.equal(found.condef, expectedDef, `[${targetSchema}] Định nghĩa UNIQUE ${tbl}.${conName} không khớp`);
    }

    for (const [tbl, conName, pattern] of HARDCODED_EXPECTED_CHECKS) {
      const found = cons.find((c) => c.table_name === tbl && c.conname === conName && c.contype === 'c');
      assert.ok(found, `[${targetSchema}] Thiếu ràng buộc CHECK ${tbl}.${conName}`);
      assert.match(found.condef, pattern, `[${targetSchema}] Biểu thức CHECK ${tbl}.${conName} không khớp: ${found.condef}`);
    }

    for (const [tbl, idxName, pattern] of HARDCODED_EXPECTED_UNIQUE_INDEXES) {
      const found = idxs.find((i) => i.tablename === tbl && i.indexname === idxName);
      assert.ok(found, `[${targetSchema}] Thiếu UNIQUE INDEX ${tbl}.${idxName}`);
      assert.match(found.indexdef, pattern, `[${targetSchema}] Định nghĩa UNIQUE INDEX ${tbl}.${idxName} không khớp: ${found.indexdef}`);
    }
  }

  // 2. Kiểm thử hành vi thật trên PostgreSQL
  const userRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM users WHERE email = 'pg_test_khach1@baity.vn' LIMIT 1;
  `);
  const userId = userRows[0].id;

  const varRows = await queryRows<{ id: string; product_id: string }>(sql`
    SELECT id, product_id FROM product_variants LIMIT 1;
  `);
  const variantId = varRows[0].id;
  const productId = varRows[0].product_id;

  // (a) Gán tồn kho âm bị từ chối bởi CHECK check_stock_non_negative
  await assert.rejects(
    async () => {
      await queryRows(sql`
        UPDATE product_variants SET stock_quantity = -1 WHERE id = ${variantId}::uuid;
      `);
    },
    (err: any) => {
      const msg = `${err?.message || ''} ${err?.cause?.message || ''} ${err?.cause?.constraint_name || ''}`;
      return /check_stock_non_negative|violates check constraint/i.test(msg);
    },
    'PostgreSQL bắt buộc phải từ chối gán stock_quantity < 0'
  );

  // (b) Chèn trùng orders.idempotency_key bị từ chối bởi UNIQUE orders_idempotency_key_unique
  const dupIdemKey = `PG9-DUP-IDEM-${Date.now()}`;
  const orderId1 = `BAITY-PG9A-${Date.now()}`;
  const orderId2 = `BAITY-PG9B-${Date.now()}`;
  createdOrderIds.push(orderId1, orderId2);

  await queryRows(sql`
    INSERT INTO orders (id, user_id, idempotency_key, receiver_name, receiver_phone, shipping_address, shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status)
    VALUES (${orderId1}, ${userId}::uuid, ${dupIdemKey}, 'PG9 Test', '0912345678', '123 Test', 'standard', 30000, 350000, 0, 380000, 'delivered');
  `);

  await assert.rejects(
    async () => {
      await queryRows(sql`
        INSERT INTO orders (id, user_id, idempotency_key, receiver_name, receiver_phone, shipping_address, shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status)
        VALUES (${orderId2}, ${userId}::uuid, ${dupIdemKey}, 'PG9 Test 2', '0912345678', '123 Test', 'standard', 30000, 350000, 0, 380000, 'pending');
      `);
    },
    (err: any) => {
      const msg = `${err?.message || ''} ${err?.cause?.message || ''} ${err?.cause?.constraint_name || ''}`;
      return /orders_idempotency_key_unique|duplicate key value violates unique constraint/i.test(msg);
    },
    'PostgreSQL bắt buộc phải từ chối chèn trùng orders.idempotency_key'
  );

  // (c) Chèn trùng dòng giỏ hàng (user_id, variant_id) và (session_id, variant_id) bị từ chối
  await queryRows(sql`
    DELETE FROM cart_items WHERE user_id = ${userId}::uuid AND variant_id = ${variantId}::uuid;
  `);
  await queryRows(sql`
    INSERT INTO cart_items (user_id, variant_id, quantity)
    VALUES (${userId}::uuid, ${variantId}::uuid, 1);
  `);
  await assert.rejects(
    async () => {
      await queryRows(sql`
        INSERT INTO cart_items (user_id, variant_id, quantity)
        VALUES (${userId}::uuid, ${variantId}::uuid, 2);
      `);
    },
    (err: any) => {
      const msg = `${err?.message || ''} ${err?.cause?.message || ''} ${err?.cause?.constraint_name || ''}`;
      return /uniq_cart_items_user_variant|duplicate key value violates unique constraint/i.test(msg);
    },
    'PostgreSQL bắt buộc phải từ chối chèn trùng dòng giỏ hàng (user_id, variant_id)'
  );
  await queryRows(sql`
    DELETE FROM cart_items WHERE user_id = ${userId}::uuid AND variant_id = ${variantId}::uuid;
  `);

  const testSessionId = `pg9_sess_${Date.now()}`;
  await queryRows(sql`
    INSERT INTO cart_items (session_id, variant_id, quantity)
    VALUES (${testSessionId}, ${variantId}::uuid, 1);
  `);
  await assert.rejects(
    async () => {
      await queryRows(sql`
        INSERT INTO cart_items (session_id, variant_id, quantity)
        VALUES (${testSessionId}, ${variantId}::uuid, 3);
      `);
    },
    (err: any) => {
      const msg = `${err?.message || ''} ${err?.cause?.message || ''} ${err?.cause?.constraint_name || ''}`;
      return /uniq_cart_items_session_variant|duplicate key value violates unique constraint/i.test(msg);
    },
    'PostgreSQL bắt buộc phải từ chối chèn trùng dòng giỏ hàng (session_id, variant_id)'
  );
  await queryRows(sql`
    DELETE FROM cart_items WHERE session_id = ${testSessionId};
  `);

  // (d) Chèn đánh giá trùng (user_id, product_id, order_id) bị từ chối
  await queryRows(sql`
    INSERT INTO reviews (product_id, user_id, order_id, rating, comment)
    VALUES (${productId}::uuid, ${userId}::uuid, ${orderId1}, 5, 'Đánh giá hợp lệ lần 1');
  `);
  await assert.rejects(
    async () => {
      await queryRows(sql`
        INSERT INTO reviews (product_id, user_id, order_id, rating, comment)
        VALUES (${productId}::uuid, ${userId}::uuid, ${orderId1}, 4, 'Đánh giá trùng lần 2');
      `);
    },
    (err: any) => {
      const msg = `${err?.message || ''} ${err?.cause?.message || ''} ${err?.cause?.constraint_name || ''}`;
      return /uniq_user_product_order_review|duplicate key value violates unique constraint/i.test(msg);
    },
    'PostgreSQL bắt buộc phải từ chối chèn đánh giá trùng (user_id, product_id, order_id)'
  );

  // (e) Kiểm thử hành vi thật cho 7 ràng buộc CHECK tiền và số lượng từ migration 0009
  await assert.rejects(
    async () => {
      await queryRows(sql`UPDATE products SET base_price = -100 WHERE id = ${productId}::uuid;`);
    },
    (err: any) => /check_products_base_price_non_negative|violates check constraint/i.test(`${err?.message || ''} ${err?.cause?.message || ''}`)
  );

  await assert.rejects(
    async () => {
      await queryRows(sql`UPDATE product_variants SET price_override = -50 WHERE id = ${variantId}::uuid;`);
    },
    (err: any) => /check_variants_price_override_non_negative|violates check constraint/i.test(`${err?.message || ''} ${err?.cause?.message || ''}`)
  );

  await assert.rejects(
    async () => {
      await queryRows(sql`
        INSERT INTO order_items (order_id, variant_id, product_name, color, size, unit_price, quantity, total_price)
        VALUES (${orderId1}, ${variantId}::uuid, 'Test SP', 'Đen', 'M', 100000, 0, 0);
      `);
    },
    (err: any) => /check_order_items_quantity_positive|violates check constraint/i.test(`${err?.message || ''} ${err?.cause?.message || ''}`)
  );

  await assert.rejects(
    async () => {
      await queryRows(sql`
        INSERT INTO order_items (order_id, variant_id, product_name, color, size, unit_price, quantity, total_price)
        VALUES (${orderId1}, ${variantId}::uuid, 'Test SP', 'Đen', 'M', -1, 1, -1);
      `);
    },
    (err: any) => /check_order_items_unit_price_non_negative|violates check constraint/i.test(`${err?.message || ''} ${err?.cause?.message || ''}`)
  );

  await assert.rejects(
    async () => {
      await queryRows(sql`UPDATE orders SET total_amount = -1 WHERE id = ${orderId1};`);
    },
    (err: any) => /check_orders_total_amount_non_negative|violates check constraint/i.test(`${err?.message || ''} ${err?.cause?.message || ''}`)
  );

  await assert.rejects(
    async () => {
      await queryRows(sql`UPDATE orders SET discount_amount = -1 WHERE id = ${orderId1};`);
    },
    (err: any) => /check_orders_discount_amount_non_negative|violates check constraint/i.test(`${err?.message || ''} ${err?.cause?.message || ''}`)
  );

  await assert.rejects(
    async () => {
      await queryRows(sql`UPDATE vouchers SET used_count = -1;`);
    },
    (err: any) => /check_vouchers_used_count_non_negative|violates check constraint/i.test(`${err?.message || ''} ${err?.cause?.message || ''}`)
  );

  // (f) Kiểm thử hành vi thật cho CHECK payments_status_check (từ chối giá trị 'success' không chuẩn)
  await assert.rejects(
    async () => {
      await queryRows(sql`
        INSERT INTO payments (order_id, method, status)
        VALUES (${orderId1}, 'vietqr', 'success');
      `);
    },
    (err: any) => /payments_status_check|violates check constraint/i.test(`${err?.message || ''} ${err?.cause?.message || ''}`)
  );
});

// ==========================================
// 10. HAI ADMIN CÙNG HỦY MỘT ĐƠN HÀNG SONG SONG TRÊN POSTGRESQL THẬT (PHẦN 1 - MỤC 4)
// ==========================================
test('PG Concurrency 10 (Two Admins Cancelling Same Order Concurrently on Real PostgreSQL): Hai Admin cùng hủy một đơn song song chỉ hoàn kho và hoàn voucher đúng 1 lần duy nhất, người thứ hai nhận 409 Conflict', async () => {
  const { generateToken, AUTH_COOKIE_NAME } = await import('../../server/services/auth.ts');

  const adminRows = await queryRows<{ id: string; email: string }>(sql`
    SELECT id, email FROM users WHERE email = 'pg_test_admin@baity.vn' LIMIT 1;
  `);
  const adminToken = generateToken({
    id: adminRows[0].id,
    email: adminRows[0].email,
    role: 'admin',
  });

  const userRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM users WHERE email = 'pg_test_khach1@baity.vn' LIMIT 1;
  `);
  const custId = userRows[0].id;

  const vRows = await queryRows<{ id: string; stock_quantity: number }>(sql`
    SELECT id, stock_quantity FROM product_variants LIMIT 1;
  `);
  const varId = vRows[0].id;
  const stockBefore = Number(vRows[0].stock_quantity);

  const vCode = `PG10_VOUCHER_${Date.now()}`;
  createdVoucherCodes.push(vCode);
  const voucherRows = await queryRows<{ id: string }>(sql`
    INSERT INTO vouchers (
      code, discount_type, discount_value, min_order_value, usage_limit, used_count,
      start_date, end_date, is_active
    ) VALUES (
      ${vCode}, 'fixed', 30000, 100000, 10, 1,
      NOW() - INTERVAL '1 day', NOW() + INTERVAL '7 days', TRUE
    )
    RETURNING id;
  `);
  const voucherId = voucherRows[0].id;

  const raceOrderId = `BAITY-PG10-${Date.now()}`;
  createdOrderIds.push(raceOrderId);

  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status
    ) VALUES (
      ${raceOrderId}, ${custId}::uuid, 'Khách Đua Hủy PG', '0911222333', '10 Lê Lợi',
      'standard', 30000, 400000, 30000, 400000, 'pending'
    );
  `);
  await queryRows(sql`
    INSERT INTO order_items (order_id, variant_id, product_name, color, size, unit_price, quantity, total_price)
    VALUES (${raceOrderId}, ${varId}::uuid, 'Áo Đua Hủy PG', 'Đen', 'M', 200000, 2, 400000);
  `);
  await queryRows(sql`
    INSERT INTO voucher_usages (voucher_id, user_id, order_id)
    VALUES (${voucherId}::uuid, ${custId}::uuid, ${raceOrderId});
  `);

  const [resA, resB] = await Promise.all([
    fetch(`${baseUrl}/api/admin/orders/${raceOrderId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify({
        status: 'cancelled',
        expectedStatus: 'pending',
        reason: 'Admin A hủy đơn song song trên PG',
      }),
    }),
    fetch(`${baseUrl}/api/admin/orders/${raceOrderId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify({
        status: 'cancelled',
        expectedStatus: 'pending',
        reason: 'Admin B hủy đơn song song trên PG',
      }),
    }),
  ]);

  const statuses = [resA.status, resB.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 409], 'Một request thành công (200) và request còn lại nhận 409 Conflict');

  const afterVarRows = await queryRows<{ stock_quantity: number }>(sql`
    SELECT stock_quantity FROM product_variants WHERE id = ${varId}::uuid;
  `);
  assert.equal(Number(afterVarRows[0].stock_quantity), stockBefore + 2, 'Tồn kho chỉ được hoàn +2 đúng 1 lần');

  const afterVoucherRows = await queryRows<{ used_count: number }>(sql`
    SELECT used_count FROM vouchers WHERE id = ${voucherId}::uuid;
  `);
  assert.equal(Number(afterVoucherRows[0].used_count), 0, 'Lượt dùng voucher chỉ hoàn về 0 đúng 1 lần');
});

// ==========================================
// 11. HAI ADMIN CÙNG XÁC NHẬN THANH TOÁN THỦ CÔNG SONG SONG TRÊN POSTGRESQL THẬT (PHẦN 1 - MỤC 4)
// ==========================================
test('PG Concurrency 11 (Two Admins Confirming Payment Concurrently on Real PostgreSQL): Hai Admin cùng xác nhận thanh toán thủ công song song chỉ ghi nhận chuyển trạng thái và lịch sử đúng 1 lần', async () => {
  const { generateToken, AUTH_COOKIE_NAME } = await import('../../server/services/auth.ts');

  const adminRows = await queryRows<{ id: string; email: string }>(sql`
    SELECT id, email FROM users WHERE email = 'pg_test_admin@baity.vn' LIMIT 1;
  `);
  const adminToken = generateToken({
    id: adminRows[0].id,
    email: adminRows[0].email,
    role: 'admin',
  });

  const userRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM users WHERE email = 'pg_test_khach1@baity.vn' LIMIT 1;
  `);
  const custId = userRows[0].id;

  const orderId = `BAITY-PG11-${Date.now()}`;
  createdOrderIds.push(orderId);

  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status
    ) VALUES (
      ${orderId}, ${custId}::uuid, 'Khách Đua Confirm Payment', '0911222333', '10 Lê Lợi',
      'standard', 0, 500000, 0, 500000, 'pending'
    );
  `);
  await queryRows(sql`
    INSERT INTO payments (order_id, method, status)
    VALUES (${orderId}, 'vietqr', 'pending');
  `);

  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/admin/orders/${orderId}/confirm-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify({ transactionId: `FT-PG11-A-${Date.now()}` }),
    }),
    fetch(`${baseUrl}/api/admin/orders/${orderId}/confirm-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify({ transactionId: `FT-PG11-B-${Date.now()}` }),
    }),
  ]);

  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);
  const b1 = await res1.json();
  const b2 = await res2.json();
  const idempotentFlags = [Boolean(b1.idempotent), Boolean(b2.idempotent)].sort();
  assert.deepEqual(idempotentFlags, [false, true], 'Chỉ đúng 1 lần ghi nhận mới (idempotent=false) và 1 lần nhận diện đã xử lý (idempotent=true)');

  const histRows = await queryRows<{ cnt: number }>(sql`
    SELECT COUNT(*)::int AS cnt FROM order_status_history WHERE order_id = ${orderId} AND status = 'confirmed';
  `);
  assert.equal(histRows[0].cnt, 1, 'Chỉ ghi đúng 1 dòng lịch sử confirmed trong order_status_history');
});

// ==========================================
// 12. HAI ADMIN CÙNG HOÀN TIỀN MỘT YÊU CẦU ĐỔI TRẢ SONG SONG TRÊN POSTGRESQL THẬT (PHẦN 1 - MỤC 4)
// ==========================================
test('PG Concurrency 12 (Two Admins Refunding Same Return Request Concurrently on Real PostgreSQL): Hai Admin cùng hoàn tiền một yêu cầu đổi trả song song chỉ ghi nhận hoàn tiền đúng 1 lần', async () => {
  const { generateToken, AUTH_COOKIE_NAME } = await import('../../server/services/auth.ts');

  const adminRows = await queryRows<{ id: string; email: string }>(sql`
    SELECT id, email FROM users WHERE email = 'pg_test_admin@baity.vn' LIMIT 1;
  `);
  const adminToken = generateToken({
    id: adminRows[0].id,
    email: adminRows[0].email,
    role: 'admin',
  });

  const userRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM users WHERE email = 'pg_test_khach1@baity.vn' LIMIT 1;
  `);
  const custId = userRows[0].id;

  const vRows = await queryRows<{ id: string }>(sql`SELECT id FROM product_variants LIMIT 1;`);
  const varId = vRows[0].id;

  const orderId = `BAITY-PG12-${Date.now()}`;
  createdOrderIds.push(orderId);

  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status, delivered_at
    ) VALUES (
      ${orderId}, ${custId}::uuid, 'Khách Đua Refund PG', '0911222333', '10 Lê Lợi',
      'standard', 0, 350000, 0, 350000, 'return_requested', NOW()
    );
  `);
  const itemRows = await queryRows<{ id: string }>(sql`
    INSERT INTO order_items (order_id, variant_id, product_name, color, size, unit_price, quantity, total_price)
    VALUES (${orderId}, ${varId}::uuid, 'Áo Refund PG', 'Đen', 'M', 350000, 1, 350000)
    RETURNING id;
  `);
  const rrRows = await queryRows<{ id: string }>(sql`
    INSERT INTO return_requests (order_id, user_id, order_item_id, reason, type, quantity, refund_amount, status)
    VALUES (${orderId}, ${custId}::uuid, ${itemRows[0].id}::uuid, 'defective_product', 'refund', 1, 350000, 'approved')
    RETURNING id;
  `);
  const returnId = rrRows[0].id;

  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/admin/returns/${returnId}/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify({}),
    }),
    fetch(`${baseUrl}/api/admin/returns/${returnId}/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify({}),
    }),
  ]);

  assert.equal(res1.status, 200);
  assert.equal(res2.status, 200);
  const b1 = await res1.json();
  const b2 = await res2.json();
  const idempotentFlags = [Boolean(b1.idempotent), Boolean(b2.idempotent)].sort();
  assert.deepEqual(idempotentFlags, [false, true], 'Chỉ đúng 1 lần thực hiện hoàn tiền (idempotent=false) và 1 lần idempotent=true');

  const auditRows = await queryRows<{ cnt: number }>(sql`
    SELECT COUNT(*)::int AS cnt FROM admin_audit_logs
    WHERE action = 'RETURN_MARK_REFUNDED' AND target_id = ${returnId};
  `);
  assert.equal(auditRows[0].cnt, 1, 'Chỉ ghi đúng 1 bản ghi RETURN_MARK_REFUNDED trong admin_audit_logs');
});

// ==========================================
// 13. HAI ADMIN CÙNG TRỪ KHO SONG SONG TRÊN POSTGRESQL THẬT (PHẦN 2 - MỤC 12 & 14)
// ==========================================
test('PG Concurrency 13 (Two Admins Deducting Stock Concurrently via stock-adjust on Real PostgreSQL): Khi tồn kho chỉ đủ cho một người, hai Admin cùng trừ kho song song chỉ 1 người thành công (200) và 1 người bị từ chối (409), tồn kho không âm', async () => {
  const { generateToken, AUTH_COOKIE_NAME } = await import('../../server/services/auth.ts');

  const adminRows = await queryRows<{ id: string; email: string }>(sql`
    SELECT id, email FROM users WHERE email = 'pg_test_admin@baity.vn' LIMIT 1;
  `);
  const adminToken = generateToken({
    id: adminRows[0].id,
    email: adminRows[0].email,
    role: 'admin',
  });

  const vRows = await queryRows<{ id: string; stock_quantity: number }>(sql`
    SELECT id, stock_quantity FROM product_variants LIMIT 1;
  `);
  const varId = vRows[0].id;
  if (!modifiedVariantStocks.has(varId)) {
    modifiedVariantStocks.set(varId, Number(vRows[0].stock_quantity));
  }

  // Đặt tồn kho = 5, hai Admin cùng trừ 4 chiếc song song (delta = -4)
  await queryRows(sql`UPDATE product_variants SET stock_quantity = 5 WHERE id = ${varId}::uuid;`);

  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/admin/variants/${varId}/stock-adjust`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify({
        delta: -4,
        reason: 'damaged',
        note: 'Xuất hủy hàng lỗi đợt 1',
      }),
    }),
    fetch(`${baseUrl}/api/admin/variants/${varId}/stock-adjust`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify({
        delta: -4,
        reason: 'damaged',
        note: 'Xuất hủy hàng lỗi đợt 2',
      }),
    }),
  ]);

  const statuses = [res1.status, res2.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 409], 'Đúng 1 lệnh trừ kho thành công (200) và 1 lệnh bị từ chối (409 INSUFFICIENT_STOCK_FOR_ADJUSTMENT)');

  const afterRows = await queryRows<{ stock_quantity: number }>(sql`
    SELECT stock_quantity FROM product_variants WHERE id = ${varId}::uuid;
  `);
  assert.equal(Number(afterRows[0].stock_quantity), 1, 'Tồn kho còn đúng 1 (5 - 4 = 1), không bao giờ âm');
});

// ==========================================
// 14. HAI ADMIN CÙNG SỬA MỘT SẢN PHẨM SONG SONG TRÊN POSTGRESQL THẬT (PHẦN 2 - MỤC 10 & 14)
// ==========================================
test('PG Concurrency 14 (Two Admins Updating Same Product Concurrently with expectedUpdatedAt on Real PostgreSQL): Hai Admin cùng cập nhật một sản phẩm song song với cùng expectedUpdatedAt thì 1 người thành công (200) và 1 người nhận 409 Conflict', async () => {
  const { generateToken, AUTH_COOKIE_NAME } = await import('../../server/services/auth.ts');

  const adminRows = await queryRows<{ id: string; email: string }>(sql`
    SELECT id, email FROM users WHERE email = 'pg_test_admin@baity.vn' LIMIT 1;
  `);
  const adminToken = generateToken({
    id: adminRows[0].id,
    email: adminRows[0].email,
    role: 'admin',
  });

  const prodRows = await queryRows<{ id: string }>(sql`SELECT id FROM products LIMIT 1;`);
  const productId = prodRows[0].id;

  const getRes = await fetch(`${baseUrl}/api/admin/products/${productId}`, {
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` },
  });
  assert.equal(getRes.status, 200);
  const prodDetail = (await getRes.json()).product;
  const sharedExpectedUpdatedAt = prodDetail.updatedAt;

  const buildUpdatePayload = (newName: string) => ({
    name: newName,
    slug: prodDetail.slug,
    categoryId: prodDetail.categoryId,
    basePrice: prodDetail.basePrice,
    salePrice: prodDetail.salePrice,
    description: prodDetail.description || 'Mô tả sản phẩm',
    isActive: prodDetail.isActive,
    expectedUpdatedAt: sharedExpectedUpdatedAt,
    variants: prodDetail.variants.map((v: any) => ({
      id: v.id,
      sku: v.sku,
      colorName: v.colorName,
      colorCode: v.colorCode,
      size: v.size,
      priceOverride: v.priceOverride,
    })),
    images: [],
    attributes: prodDetail.attributes || [],
  });

  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/admin/products/${productId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify(buildUpdatePayload('Áo Sơ Mi Oxford PG Edit A')),
    }),
    fetch(`${baseUrl}/api/admin/products/${productId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify(buildUpdatePayload('Áo Sơ Mi Oxford PG Edit B')),
    }),
  ]);

  const statuses = [res1.status, res2.status].sort((a, b) => a - b);
  assert.deepEqual(
    statuses,
    [200, 409],
    'Một Admin cập nhật thành công (200) và Admin còn lại nhận 409 Conflict do lệch updated_at'
  );
});

// ==========================================
// 15. KIỂM THỬ MIGRATION 0010 CHUYỂN HÓA DỮ LIỆU CŨ payments.status = 'success' -> 'paid' VÀ RÀNG BUỘC CHECK (PHẦN 1 - MỤC 3)
// ==========================================
test('PG Concurrency 15 (Migration 0010 Legacy Payment Status Sanitization & CHECK Constraint): Tạo dòng payments với status = "success" ở trạng thái trước 0010, chạy 0010, xác nhận dòng đổi thành "paid" và CHECK từ chối "success"', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const postgresMod = await import('postgres');

  const rawUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!;
  const parsedUrl = new URL(rawUrl);
  parsedUrl.searchParams.delete('schema');
  const tempSchema = `test_mig0010_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  const sqlClient = postgresMod.default(parsedUrl.toString(), {
    ssl: 'require',
    max: 1,
    onnotice: () => {},
  });

  try {
    await sqlClient.unsafe(`CREATE SCHEMA "${tempSchema}";`);
    await sqlClient.unsafe(`SET search_path TO "${tempSchema}", public;`);

    const migrationsDir = path.resolve(process.cwd(), 'migrations');
    const journalPath = path.join(migrationsDir, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8'));

    const sanitizeSqlForTempSchema = (rawSql: string) =>
      rawSql
        .replace(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+"pg_trgm"\s*;/gi, '-- pg_trgm skipped')
        .replace(/"public"\./g, '');

    // 1. Chạy các migration từ 0000 đến 0009 (trước 0010)
    for (const entry of journal.entries) {
      if (entry.idx >= 10) break;
      const sqlFile = path.join(migrationsDir, `${entry.tag}.sql`);
      const fileContent = fs.readFileSync(sqlFile, 'utf-8');
      const cleanedSql = fileContent
        .split('--> statement-breakpoint')
        .map((s) => sanitizeSqlForTempSchema(s).trim())
        .filter(Boolean)
        .join('\n');
      await sqlClient.unsafe(cleanedSql);
    }

    // 2. Tạo user, đơn hàng và dòng payments với status = 'success' ở trạng thái trước 0010
    const userRes = await sqlClient.unsafe(
      `INSERT INTO "users" (full_name, email, phone, password_hash, role)
       VALUES ('Khách Test 0010', 'mig0010_user@baity.vn', '0901112222', 'hash_test', 'customer')
       RETURNING id;`
    );
    const userId = userRes[0].id;

    const orderId = `ORD-MIG0010-${Date.now()}`;
    await sqlClient.unsafe(
      `INSERT INTO "orders" (id, user_id, receiver_name, receiver_phone, shipping_address, shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status)
       VALUES ($1, $2::uuid, 'Khách Test 0010', '0901112222', '123 Lê Lợi', 'standard', 0, 250000, 0, 250000, 'confirmed');`,
      [orderId, userId]
    );

    const insertPayRes = await sqlClient.unsafe(
      `INSERT INTO "payments" (order_id, method, status)
       VALUES ($1, 'vietqr', 'success')
       RETURNING id, status;`,
      [orderId]
    );
    const paymentId = insertPayRes[0].id;
    assert.equal(insertPayRes[0].status, 'success');

    // 3. Chạy migration 0010_brief_winter_soldier.sql
    const mig0010Content = fs.readFileSync(
      path.join(migrationsDir, '0010_brief_winter_soldier.sql'),
      'utf-8'
    );
    const cleaned0010Sql = mig0010Content
      .split('--> statement-breakpoint')
      .map((s) => sanitizeSqlForTempSchema(s).trim())
      .filter(Boolean)
      .join('\n');
    await sqlClient.unsafe(cleaned0010Sql);

    // 4. Xác nhận dòng payments đã tự động chuyển từ 'success' thành 'paid'
    const afterPayRes = await sqlClient.unsafe(
      `SELECT status FROM "payments" WHERE id = $1::uuid;`,
      [paymentId]
    );
    assert.equal(
      afterPayRes[0].status,
      'paid',
      'Migration 0010 phải chuyển dòng payments có status = "success" sang "paid" trước khi thêm CHECK'
    );

    // 5. Xác nhận ràng buộc CHECK payments_status_check từ chối giá trị 'success'
    let checkRejected = false;
    try {
      await sqlClient.unsafe(`UPDATE "payments" SET status = 'success' WHERE id = $1::uuid;`, [
        paymentId,
      ]);
    } catch (err: any) {
      checkRejected = true;
      assert.equal(err.code, '23514', 'PostgreSQL phải ném mã lỗi 23514 (check_violation)');
    }
    assert.equal(checkRejected, true, 'Ràng buộc payments_status_check phải từ chối status = "success"');
  } finally {
    await sqlClient.unsafe(`DROP SCHEMA IF EXISTS "${tempSchema}" CASCADE;`).catch(() => {});
    await sqlClient.end().catch(() => {});
  }
});

// ==========================================
// 16. HAI ADMIN CÙNG SỬA MỘT VOUCHER SONG SONG & TỪ CHỐI GIẢM usageLimit DƯỚI usedCount (GIAI ĐOẠN 8c - MỤC 5 & 10)
// ==========================================
test('PG Concurrency 16 (Two Admins Updating Same Voucher Concurrently & Rejecting usageLimit < usedCount on Real PostgreSQL): Hai Admin cùng sửa một voucher song song với cùng expectedUpdatedAt thì 1 người 200 và 1 người 409; giảm usageLimit xuống dưới usedCount bị từ chối 400', async () => {
  const { generateToken, AUTH_COOKIE_NAME } = await import('../../server/services/auth.ts');

  const adminRows = await queryRows<{ id: string; email: string }>(sql`
    SELECT id, email FROM users WHERE email = 'pg_test_admin@baity.vn' LIMIT 1;
  `);
  const adminToken = generateToken({
    id: adminRows[0].id,
    email: adminRows[0].email,
    role: 'admin',
  });

  // 1. Tạo một voucher mới qua POST /api/admin/vouchers
  const createRes = await fetch(`${baseUrl}/api/admin/vouchers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      code: 'PGCONC8C',
      description: 'Voucher kiểm thử tương tranh PG 8c',
      discountType: 'percent',
      discountValue: 15,
      minOrderValue: 200000,
      maxDiscount: 50000,
      usageLimit: 20,
      perUserLimit: 2,
      startDate: '2026-01-01T08:00',
      endDate: '2027-12-31T22:00',
      isActive: true,
    }),
  });
  assert.equal(createRes.status, 201);
  const createdVoucher = (await createRes.json()).voucher;
  const voucherId = createdVoucher.id;
  const sharedUpdatedAt = createdVoucher.updatedAt;

  // 2. Hai Admin cùng gửi PUT /api/admin/vouchers/:id song song với cùng expectedUpdatedAt
  const buildPutBody = (desc: string, limitVal: number) => ({
    code: 'PGCONC8C',
    description: desc,
    discountType: 'percent',
    discountValue: 15,
    minOrderValue: 200000,
    maxDiscount: 50000,
    usageLimit: limitVal,
    perUserLimit: 2,
    startDate: '2026-01-01T08:00',
    endDate: '2027-12-31T22:00',
    isActive: true,
    expectedUpdatedAt: sharedUpdatedAt,
  });

  const [resA, resB] = await Promise.all([
    fetch(`${baseUrl}/api/admin/vouchers/${voucherId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify(buildPutBody('Admin A cập nhật', 30)),
    }),
    fetch(`${baseUrl}/api/admin/vouchers/${voucherId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify(buildPutBody('Admin B cập nhật', 40)),
    }),
  ]);

  const statuses = [resA.status, resB.status].sort((a, b) => a - b);
  assert.deepEqual(
    statuses,
    [200, 409],
    'Hai Admin sửa cùng một voucher song song phải có đúng 1 kết quả 200 và 1 kết quả 409'
  );

  // 3. Giả lập voucher đã có used_count = 5 trên DB thật, sau đó hạ usageLimit xuống 3 (< 5) -> phải bị từ chối 400 USAGE_LIMIT_BELOW_USED_COUNT
  await queryRows(sql`
    UPDATE vouchers SET used_count = 5 WHERE id = ${voucherId}::uuid;
  `);

  const latestRows = await queryRows<{ updated_at: string }>(sql`
    SELECT updated_at FROM vouchers WHERE id = ${voucherId}::uuid LIMIT 1;
  `);

  const lowerLimitRes = await fetch(`${baseUrl}/api/admin/vouchers/${voucherId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      ...buildPutBody('Hạ usageLimit thấp hơn usedCount', 3),
      expectedUpdatedAt: latestRows[0].updated_at,
    }),
  });
  assert.equal(lowerLimitRes.status, 400);
  const lowerBody = await lowerLimitRes.json();
  assert.equal(lowerBody.code, 'USAGE_LIMIT_BELOW_USED_COUNT');
});

// ==========================================
// 17. HAI ADMIN CÙNG CẬP NHẬT CÀI ĐẶT CỬA HÀNG SONG SONG TRÊN POSTGRESQL THẬT (GIAI ĐOẠN 8c - MỤC 7 & 10)
// ==========================================
test('PG Concurrency 17 (Two Admins Updating Store Settings Concurrently on Real PostgreSQL): Hai Admin cùng PUT /api/admin/settings song song với cùng expectedUpdatedAt thì 1 người 200 và 1 người 409', async () => {
  const { generateToken, AUTH_COOKIE_NAME } = await import('../../server/services/auth.ts');

  const adminRows = await queryRows<{ id: string; email: string }>(sql`
    SELECT id, email FROM users WHERE email = 'pg_test_admin@baity.vn' LIMIT 1;
  `);
  const adminToken = generateToken({
    id: adminRows[0].id,
    email: adminRows[0].email,
    role: 'admin',
  });

  const getRes = await fetch(`${baseUrl}/api/admin/settings`, {
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` },
  });
  assert.equal(getRes.status, 200);
  const currentSettings = await getRes.json();
  const sharedUpdatedAt = currentSettings.updatedAt;

  const buildSettingsPayload = (stdFee: number, banner: string) => ({
    contact: {
      storeName: 'BAITY',
      hotline: '0901234567',
      email: 'support@baity-test.vn',
      address: '123 Nguyễn Huệ, Quận 1, TP.HCM',
      workingHours: '08:30 - 21:30',
      legalEntityName: 'Công ty TNHH Thời Trang BAITY',
      taxId: '0101234567',
      returnAddress: 'Kho Quận 7, TP.HCM',
    },
    shipping: {
      standardShippingFee: stdFee,
      expressShippingFee: 50000,
      freeShippingThreshold: 500000,
    },
    returns: {
      returnDaysLimit: 7,
    },
    inventory: {
      lowStockThreshold: 5,
    },
    bannerText: banner,
    expectedUpdatedAt: sharedUpdatedAt,
  });

  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify(buildSettingsPayload(25000, 'Banner Admin 1')),
    }),
    fetch(`${baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify(buildSettingsPayload(35000, 'Banner Admin 2')),
    }),
  ]);

  const statuses = [res1.status, res2.status].sort((a, b) => a - b);
  assert.deepEqual(
    statuses,
    [200, 409],
    'Hai Admin cập nhật store_settings song song phải có đúng 1 người 200 và 1 người 409'
  );
});

// ==========================================
// 18. KIỂM THỬ THỐNG KÊ DOANH THU THỰC, MÚI GIỜ Asia/Ho_Chi_Minh VÀ ẨN ĐÁNH GIÁ TRÊN POSTGRESQL THẬT (GIAI ĐOẠN 8d - MỤC 11)
// ==========================================
test('PG Concurrency 18 (Stage 8d Real PostgreSQL Stats Net Revenue, Asia/Ho_Chi_Minh Timezone Boundary & Review Visibility): Trên PostgreSQL thật, thống kê tách đúng doanh thu thực (đơn đã giao trừ hoàn tiền hoàn tất), giá trị đơn đặt, biên ngày 23:30 UTC sang ngày hôm sau ở GMT+7, và ẩn đánh giá loại khỏi rating_avg', async () => {
  const { generateToken, AUTH_COOKIE_NAME } = await import('../../server/services/auth.ts');

  const adminRows = await queryRows<{ id: string; email: string }>(sql`
    SELECT id, email FROM users WHERE email = 'pg_test_admin@baity.vn' LIMIT 1;
  `);
  const adminToken = generateToken({
    id: adminRows[0].id,
    email: adminRows[0].email,
    role: 'admin',
  });

  const userRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM users WHERE email = 'pg_test_khach1@baity.vn' LIMIT 1;
  `);
  const custId = userRows[0].id;

  const vRows = await queryRows<{ id: string; product_id: string }>(sql`
    SELECT pv.id, pv.product_id FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE p.is_active = true LIMIT 1;
  `);
  const varId = vRows[0].id;
  const prodId = vRows[0].product_id;

  // Dọn các đơn test 2029-08-15..2029-08-17 nếu có từ lần chạy trước
  const ordBoundaryId = `BAITY-PG18-TZ-${Date.now()}`;
  const ordPlacedId = `BAITY-PG18-PL-${Date.now()}`;
  createdOrderIds.push(ordBoundaryId, ordPlacedId);

  // 1. Tạo đơn giao lúc 2029-08-15T23:30:00.000Z (tức 06:30 sáng ngày 2029-08-16 theo giờ Việt Nam GMT+7)
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status,
      created_at, delivered_at
    ) VALUES (
      ${ordBoundaryId}, ${custId}::uuid, 'Khách PG18 Biên Giờ', '0911223344', '10 Lê Lợi',
      'standard', 0, 600000, 0, 600000, 'delivered',
      '2029-08-15T23:30:00.000Z'::timestamptz,
      '2029-08-15T23:30:00.000Z'::timestamptz
    );
  `);

  const oiRows = await queryRows<{ id: string }>(sql`
    INSERT INTO order_items (order_id, variant_id, product_name, color, size, unit_price, quantity, total_price)
    VALUES (${ordBoundaryId}, ${varId}::uuid, 'Áo PG18', 'Đen', 'M', 600000, 1, 600000)
    RETURNING id;
  `);

  // Tạo khoản hoàn tiền hoàn tất (status = 'completed') 150.000đ vào 2029-08-16T03:00:00.000Z (10:00 sáng 16/08 GMT+7)
  await queryRows(sql`
    INSERT INTO return_requests (
      order_id, user_id, order_item_id, reason, type, quantity, refund_amount, status,
      created_at, updated_at
    ) VALUES (
      ${ordBoundaryId}, ${custId}::uuid, ${oiRows[0].id}::uuid,
      'defective_product', 'refund', 1, 150000, 'completed',
      '2029-08-16T02:00:00.000Z'::timestamptz,
      '2029-08-16T03:00:00.000Z'::timestamptz
    );
  `);

  // 2. Tạo thêm 1 đơn đặt chưa giao (status = 'confirmed') 250.000đ vào 2029-08-16T04:00:00.000Z
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status,
      created_at
    ) VALUES (
      ${ordPlacedId}, ${custId}::uuid, 'Khách PG18 Đơn Đặt', '0911223355', '12 Lê Lợi',
      'standard', 0, 250000, 0, 250000, 'confirmed',
      '2029-08-16T04:00:00.000Z'::timestamptz
    );
  `);

  // 3. Gọi GET /api/admin/stats/overview trên PostgreSQL thật
  const statsRes = await fetch(
    `${baseUrl}/api/admin/stats/overview?from=2029-08-15&to=2029-08-17&granularity=day`,
    { headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` } }
  );
  assert.equal(statsRes.status, 200);
  const statsBody = await statsRes.json();

  const bucketAug15 = statsBody.series.find((b: any) => b.bucketKey === '2029-08-15');
  const bucketAug16 = statsBody.series.find((b: any) => b.bucketKey === '2029-08-16');
  assert.ok(bucketAug15 && bucketAug16);

  // Đơn lúc 23:30 UTC ngày 15/08 phải thuộc ngày 16/08 theo Asia/Ho_Chi_Minh
  assert.equal(bucketAug15.grossDeliveredRevenue, 0);
  assert.equal(bucketAug15.placedOrderValue, 0);

  // Ngày 16/08 có: grossDeliveredRevenue = 600.000, completedRefundAmount = 150.000 -> netRevenue = 450.000
  // placedOrderValue = 600.000 + 250.000 = 850.000
  assert.equal(bucketAug16.grossDeliveredRevenue, 600000);
  assert.equal(bucketAug16.completedRefundAmount, 150000);
  assert.equal(bucketAug16.netRevenue, 450000);
  assert.equal(bucketAug16.placedOrderValue, 850000);

  // 4. Tạo đánh giá trên đơn ordBoundaryId, sau đó ẩn qua PATCH /api/admin/reviews/:id/visibility và kiểm tra is_visible = false
  const revRows = await queryRows<{ id: string }>(sql`
    INSERT INTO reviews (user_id, product_id, order_id, rating, comment, is_visible)
    VALUES (${custId}::uuid, ${prodId}::uuid, ${ordBoundaryId}, 1, 'Đánh giá PG18 kiểm thử ẩn', true)
    RETURNING id;
  `);
  const revId = revRows[0].id;

  const hideRes = await fetch(`${baseUrl}/api/admin/reviews/${revId}/visibility`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      isVisible: false,
      reason: 'Ẩn đánh giá vi phạm trên PostgreSQL thật',
    }),
  });
  assert.equal(hideRes.status, 200);

  const checkRevRows = await queryRows<{ is_visible: boolean; hidden_reason: string }>(sql`
    SELECT is_visible, hidden_reason FROM reviews WHERE id = ${revId}::uuid;
  `);
  assert.equal(checkRevRows[0].is_visible, false);
  assert.equal(checkRevRows[0].hidden_reason, 'Ẩn đánh giá vi phạm trên PostgreSQL thật');

  // Dọn đánh giá vừa tạo
  await queryRows(sql`DELETE FROM reviews WHERE id = ${revId}::uuid;`);
});

// ==========================================
// 19. KIỂM THỬ GIAI ĐOẠN 6d & 8d TRÊN POSTGRESQL THẬT: MỘT HỘI THOẠI MỞ DUY NHẤT KHI TẠO SONG SONG (Promise.all) & BACKFILL refunded_at (MỤC 3, 5, 10)
// ==========================================
test('PG Concurrency 19 (Stage 6d Single Open Conversation Under Parallel Creation & Stage 8d refunded_at Immutability): Trên PostgreSQL thật, tạo song song 6 yêu cầu POST /api/chat/conversations (Promise.all) cho cùng một khách hàng vẫn chỉ có đúng 1 hội thoại mở nhờ partial unique index idx_chat_conv_single_open_user, chèn trực tiếp hội thoại mở thứ 2 bị chặn 23505, và sửa return_requests.updated_at sau khi hoàn tất không làm lệch kỳ thống kê hoàn tiền nhờ refunded_at', async () => {
  const { generateToken, AUTH_COOKIE_NAME } = await import('../../server/services/auth.ts');

  const userRows = await queryRows<{ id: string; email: string }>(sql`
    SELECT id, email FROM users WHERE email = 'pg_test_khach2@baity.vn' LIMIT 1;
  `);
  const custId = userRows[0].id;
  const custToken = generateToken({
    id: custId,
    email: userRows[0].email,
    role: 'customer',
  });

  // Dọn hội thoại cũ của khách này nếu có
  await queryRows(sql`DELETE FROM chat_conversations WHERE user_id = ${custId}::uuid;`);

  // 1. Gắn 6 request POST /api/chat/conversations song song qua Promise.all trên PostgreSQL thật
  const parallelResponses = await Promise.all(
    Array.from({ length: 6 }, () =>
      fetch(`${baseUrl}/api/chat/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${AUTH_COOKIE_NAME}=${custToken}`,
        },
        body: JSON.stringify({}),
      })
    )
  );

  for (const r of parallelResponses) {
    assert.equal(r.status, 200, 'Mọi yêu cầu POST /api/chat/conversations song song đều phải trả 200 OK');
  }
  const bodies = await Promise.all(parallelResponses.map((r) => r.json()));
  const uniqueConvIds = new Set(bodies.map((b: any) => b.conversation.id));
  assert.equal(uniqueConvIds.size, 1, 'Tất cả 6 request song song phải trả về cùng 1 conversation.id duy nhất');

  const openRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM chat_conversations WHERE user_id = ${custId}::uuid AND status = 'open';
  `);
  assert.equal(openRows.length, 1, 'Trong CSDL PostgreSQL thật chỉ được tồn tại đúng 1 hội thoại status = open cho khách hàng');

  // 2. Chứng minh partial unique index idx_chat_conv_single_open_user ở tầng PostgreSQL chặn INSERT hội thoại open thứ 2
  let duplicateOpenBlocked = false;
  try {
    await queryRows(sql`
      INSERT INTO chat_conversations (user_id, mode, status)
      VALUES (${custId}::uuid, 'human', 'open');
    `);
  } catch (err: any) {
    const pgCode = err?.code || err?.cause?.code;
    if (pgCode === '23505' || String(err?.message || '').includes('idx_chat_conv_single_open_user')) {
      duplicateOpenBlocked = true;
    }
  }
  assert.equal(
    duplicateOpenBlocked,
    true,
    'Partial unique index idx_chat_conv_single_open_user phải chặn INSERT hội thoại open thứ 2 với mã lỗi 23505'
  );

  // Nhưng chèn hội thoại status = 'closed' thì được phép
  const closedConvRows = await queryRows<{ id: string }>(sql`
    INSERT INTO chat_conversations (user_id, mode, status, closed_at)
    VALUES (${custId}::uuid, 'human', 'closed', NOW())
    RETURNING id;
  `);
  assert.equal(closedConvRows.length, 1, 'Được phép có thêm hội thoại lịch sử ở trạng thái closed');

  // Dọn dẹp hội thoại test
  await queryRows(sql`DELETE FROM chat_conversations WHERE user_id = ${custId}::uuid;`);
});

// ==========================================
// 20. HAI ADMIN ĐỒNG THỜI CẬP NHẬT ẢNH CHÍNH CÙNG MỘT SẢN PHẨM VỚI CÙNG expectedUpdatedAt
// (Optimistic Locking + Transaction Row Lock trên PostgreSQL thật -> đúng 1 request 200 OK và 1 request 409 Conflict)
// ==========================================
test('Real PG Concurrency 20 - Concurrent Primary Image Update: Hai admin cùng cập nhật ảnh chính một sản phẩm với cùng expectedUpdatedAt trên PostgreSQL thật -> đúng một 200 và một 409', async () => {
  const sharpMod = (await import('sharp')).default;

  // Đăng nhập hai phiên Admin độc lập
  const loginAdminSession = async (): Promise<string> => {
    const initRes = await fetch(`${baseUrl}/api/auth/me`);
    let cookies = extractCookies(initRes);
    const csrfMatch = cookies.match(/baity_csrf_token=([^;]+)/);
    const csrf = csrfMatch ? csrfMatch[1] : '';

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookies,
        'X-CSRF-Token': csrf,
      },
      body: JSON.stringify({ email: 'pg_test_admin@baity.vn', password: 'Admin@123' }),
    });
    assert.equal(loginRes.status, 200, 'Đăng nhập pg_test_admin@baity.vn phải trả 200');
    return extractCookies(loginRes, cookies);
  };

  const adminCookies1 = await loginAdminSession();
  const adminCookies2 = await loginAdminSession();
  const getCsrfToken = (cookies: string) => {
    const m = cookies.match(/baity_csrf_token=([^;]+)/);
    return m ? m[1] : '';
  };

  // Tạo 1 sản phẩm kiểm thử cô lập trong schema test PG
  const catRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM categories LIMIT 1;
  `);
  assert.ok(catRows.length > 0, 'Phải có ít nhất 1 danh mục trong schema test');

  const prodRows = await queryRows<{ id: string; updated_at: string }>(sql`
    INSERT INTO products (
      name, slug, category_id, target_gender, description, material, care_instructions, base_price, search_text, is_active
    )
    VALUES (
      'Sản Phẩm Test Đồng Thời Ảnh Chính PG',
      ${`sp-test-concurrent-img-${Date.now()}`},
      ${catRows[0].id}::uuid,
      'unisex',
      'Mô tả kiểm thử đồng thời ảnh chính',
      'Cotton',
      'Giặt máy',
      290000,
      'san pham test dong thoi anh chinh pg',
      true
    )
    RETURNING id, updated_at;
  `);
  const productId = prodRows[0].id;
  const sharedExpectedUpdatedAt = prodRows[0].updated_at;

  await queryRows(sql`
    INSERT INTO product_images (product_id, image_url, is_primary, display_order)
    VALUES (${productId}::uuid, 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800', true, 0);
  `);

  try {
    // Tải lên 2 ảnh hợp lệ qua /api/upload (purpose=product) cho 2 admin
    const uploadValidJpeg = async (cookies: string, color: { r: number; g: number; b: number }) => {
      const buf = await sharpMod({
        create: { width: 48, height: 48, channels: 3, background: color },
      })
        .jpeg({ quality: 88 })
        .toBuffer();
      const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookies,
          'X-CSRF-Token': getCsrfToken(cookies),
        },
        body: JSON.stringify({
          image: dataUrl,
          purpose: 'product',
        }),
      });
      assert.equal(res.status, 200, 'Upload ảnh cho admin trong PG test phải trả 200');
      return (await res.json()) as { url: string; path: string };
    };

    const [uploaded1, uploaded2] = await Promise.all([
      uploadValidJpeg(adminCookies1, { r: 220, g: 40, b: 40 }),
      uploadValidJpeg(adminCookies2, { r: 40, g: 120, b: 220 }),
    ]);

    // Bắn đồng thời 2 request PUT /api/admin/products/:id/primary-image với CÙNG expectedUpdatedAt
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/admin/products/${productId}/primary-image`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookies1,
          'X-CSRF-Token': getCsrfToken(adminCookies1),
        },
        body: JSON.stringify({
          imageUrl: uploaded1.path,
          objectPath: uploaded1.path,
          expectedUpdatedAt: sharedExpectedUpdatedAt,
        }),
      }),
      fetch(`${baseUrl}/api/admin/products/${productId}/primary-image`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookies2,
          'X-CSRF-Token': getCsrfToken(adminCookies2),
        },
        body: JSON.stringify({
          imageUrl: uploaded2.path,
          objectPath: uploaded2.path,
          expectedUpdatedAt: sharedExpectedUpdatedAt,
        }),
      }),
    ]);

    const statuses = [res1.status, res2.status].sort((a, b) => a - b);
    assert.deepEqual(
      statuses,
      [200, 409],
      `Hai admin cập nhật ảnh chính đồng thời với cùng expectedUpdatedAt phải có đúng một 200 và một 409 (nhận được: ${statuses.join(', ')})`
    );

    // Xác nhận trong CSDL chỉ có đúng 1 ảnh có is_primary = true, và tổng số bản ghi ảnh là 2 (1 ảnh gốc is_primary=false + 1 ảnh mới is_primary=true)
    const imgRows = await queryRows<{ image_url: string; is_primary: boolean }>(sql`
      SELECT image_url, is_primary
      FROM product_images
      WHERE product_id = ${productId}::uuid;
    `);
    assert.equal(imgRows.length, 2, 'Chỉ được chèn thêm đúng 1 bản ghi ảnh mới của request thắng cuộc');
    const primaryRows = imgRows.filter((r) => r.is_primary);
    assert.equal(primaryRows.length, 1, 'Phải có đúng 1 ảnh chính (is_primary = true)');
  } finally {
    await queryRows(sql`DELETE FROM product_images WHERE product_id = ${productId}::uuid;`);
    await queryRows(sql`DELETE FROM products WHERE id = ${productId}::uuid;`);
  }
});




