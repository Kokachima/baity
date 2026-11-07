import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from 'drizzle-orm';

// Chạy trên PGlite in-memory cô lập
process.env.DATABASE_URL = '';
process.env.PGLITE_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.COOKIE_CROSS_SITE = 'false';
process.env.JWT_SECRET = 'test-secret-stage8c-vouchers-promotions-settings-key-2026';
process.env.VIETQR_BANK_ID = '970407';
process.env.VIETQR_ACCOUNT_NO = '190388889999';
process.env.VIETQR_ACCOUNT_NAME = 'CONG TY TNHH BAITY';

import { createApp } from '../server/app.ts';
import { initDatabase } from '../server/db/init.ts';
import { queryRows, closeDb } from '../server/db/index.ts';
import { seedDatabase } from '../server/db/seed.ts';
import { generateToken, AUTH_COOKIE_NAME } from '../server/services/auth.ts';
import { collectExpressRoutes } from '../scripts/project-state.ts';
import { AdminLayout } from '../src/components/admin/AdminLayout.tsx';
import { VouchersPage } from '../src/components/admin/VouchersPage.tsx';
import { PromotionsPage } from '../src/components/admin/PromotionsPage.tsx';
import { StoreSettingsPage } from '../src/components/admin/StoreSettingsPage.tsx';
import { PoliciesFaqPage } from '../src/components/admin/PoliciesFaqPage.tsx';

let server: http.Server;
let baseUrl = '';
let adminId = '';
let adminToken = '';
let customerId = '';
let customerToken = '';
let sampleCategoryId = '';
let sampleProductId = '';
let sampleProductSlug = '';
let sampleVariantId = '';
let sampleBasePrice = 0;

const STAGE_8C_ENDPOINTS: { method: string; path: string }[] = [
  { method: 'GET', path: '/api/admin/vouchers' },
  { method: 'POST', path: '/api/admin/vouchers' },
  { method: 'PUT', path: '/api/admin/vouchers/00000000-0000-0000-0000-000000000001' },
  { method: 'DELETE', path: '/api/admin/vouchers/00000000-0000-0000-0000-000000000001' },
  { method: 'GET', path: '/api/admin/promotions' },
  { method: 'POST', path: '/api/admin/promotions/preview' },
  { method: 'POST', path: '/api/admin/promotions' },
  { method: 'PUT', path: '/api/admin/promotions/00000000-0000-0000-0000-000000000001' },
  { method: 'POST', path: '/api/admin/promotions/00000000-0000-0000-0000-000000000001/end-early' },
  { method: 'GET', path: '/api/admin/settings' },
  { method: 'PUT', path: '/api/admin/settings' },
  { method: 'GET', path: '/api/admin/policies' },
  { method: 'GET', path: '/api/admin/policies/return' },
  { method: 'POST', path: '/api/admin/policies/preview' },
  { method: 'PUT', path: '/api/admin/policies/return' },
  { method: 'POST', path: '/api/admin/policies/return/restore' },
  { method: 'DELETE', path: '/api/admin/policies/return' },
  { method: 'GET', path: '/api/admin/faqs' },
  { method: 'POST', path: '/api/admin/faqs' },
  { method: 'PUT', path: '/api/admin/faqs/00000000-0000-0000-0000-000000000001' },
  { method: 'PATCH', path: '/api/admin/faqs/00000000-0000-0000-0000-000000000001/visibility' },
];

before(async () => {
  await initDatabase();
  await seedDatabase();

  const adminRows = await queryRows<{ id: string }>(sql`
    INSERT INTO users (email, password_hash, full_name, phone, role)
    VALUES ('admin-8c@baity.vn', 'hash_admin_8c', 'Admin 8C', '0909888222', 'admin')
    RETURNING id;
  `);
  adminId = adminRows[0].id;
  adminToken = generateToken({
    id: adminId,
    email: 'admin-8c@baity.vn',
    role: 'admin',
  });

  const custRows = await queryRows<{ id: string }>(sql`
    INSERT INTO users (email, password_hash, full_name, phone, role)
    VALUES ('customer-8c@baity.vn', 'hash_cust_8c', 'Khách Hàng 8C', '0912777999', 'customer')
    RETURNING id;
  `);
  customerId = custRows[0].id;
  customerToken = generateToken({
    id: customerId,
    email: 'customer-8c@baity.vn',
    role: 'customer',
  });

  const prodRows = await queryRows<{
    id: string;
    slug: string;
    category_id: string;
    base_price: number;
  }>(sql`
    SELECT p.id, p.slug, p.category_id, p.base_price
    FROM products p
    WHERE p.is_active = true AND p.category_id IS NOT NULL
    ORDER BY p.created_at ASC
    LIMIT 1;
  `);
  sampleProductId = prodRows[0].id;
  sampleProductSlug = prodRows[0].slug;
  sampleCategoryId = prodRows[0].category_id;
  sampleBasePrice = Number(prodRows[0].base_price);
  await queryRows(sql`
    UPDATE promotions SET is_active = false;
  `);

  const varRows = await queryRows<{ id: string }>(sql`
    SELECT id FROM product_variants WHERE product_id = ${sampleProductId}::uuid LIMIT 1;
  `);
  sampleVariantId = varRows[0].id;
  await queryRows(sql`
    UPDATE product_variants
    SET stock_quantity = 30, price_override = NULL
    WHERE id = ${sampleVariantId}::uuid;
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await closeDb();
});

// ============================================================================
// NHÓM 8c.1: BẢO VỆ ROUTE 401 / 403 & KIỂM TOÁN BẢO MẬT ROUTE TOÀN HỆ THỐNG
// ============================================================================
test('Bước 8c.1a: Khách chưa đăng nhập (401) bị từ chối ở toàn bộ route /api/admin/* của Giai đoạn 8c', async () => {
  for (const ep of STAGE_8C_ENDPOINTS) {
    const unauthRes = await fetch(`${baseUrl}${ep.path}`, {
      method: ep.method,
      headers: { 'Content-Type': 'application/json' },
      body: ep.method !== 'GET' && ep.method !== 'DELETE' ? JSON.stringify({}) : undefined,
    });
    assert.equal(
      unauthRes.status,
      401,
      `Chưa đăng nhập gọi ${ep.method} ${ep.path} phải nhận 401`
    );
  }
});

test('Bước 8c.1b: Khách hàng thường role=customer (403) bị từ chối ở toàn bộ route /api/admin/* của Giai đoạn 8c và kiểm toán route toàn hệ thống xanh', async () => {
  for (const ep of STAGE_8C_ENDPOINTS) {
    const custRes = await fetch(`${baseUrl}${ep.path}`, {
      method: ep.method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${customerToken}`,
      },
      body: ep.method !== 'GET' && ep.method !== 'DELETE' ? JSON.stringify({}) : undefined,
    });
    assert.equal(
      custRes.status,
      403,
      `Khách hàng thường gọi ${ep.method} ${ep.path} phải nhận 403`
    );
  }

  const allRoutes = collectExpressRoutes();
  const adminRoutes = allRoutes.filter((r) => r.fullPath.startsWith('/api/admin'));
  assert.ok(adminRoutes.length >= 30);
  for (const r of adminRoutes) {
    assert.ok(
      r.authMiddlewares.includes('requireAuth') && r.authMiddlewares.includes('requireAdmin'),
      `Route quản trị ${r.method} ${r.fullPath} bắt buộc có cả requireAuth và requireAdmin`
    );
  }
});

// ============================================================================
// NHÓM 8c.2: QUẢN LÝ VOUCHER & KIỂM THỬ BIÊN TABLE-DRIVEN (MỤC 5)
// ============================================================================
let createdVoucherId = '';
let createdVoucherUpdatedAt = '';

test('Bước 8c.2a: Kiểm thử biên table-driven cho Voucher (percent 0 và 101, fixed 0, code 2 và 33 ký tự, ký tự đặc biệt, startDate >= endDate)', async () => {
  const validDates = {
    startDate: '2026-01-01T08:00',
    endDate: '2027-01-01T08:00',
  };

  const boundaryCases: Array<{
    name: string;
    payload: Record<string, unknown>;
    expectedStatus: number;
  }> = [
    {
      name: 'percent = 0 bị từ chối',
      payload: {
        code: 'PCT_ZERO',
        discountType: 'percent',
        discountValue: 0,
        minOrderValue: 100000,
        ...validDates,
      },
      expectedStatus: 400,
    },
    {
      name: 'percent = 101 bị từ chối',
      payload: {
        code: 'PCT_101',
        discountType: 'percent',
        discountValue: 101,
        minOrderValue: 100000,
        ...validDates,
      },
      expectedStatus: 400,
    },
    {
      name: 'fixed = 0 bị từ chối',
      payload: {
        code: 'FIXED_ZERO',
        discountType: 'fixed',
        discountValue: 0,
        minOrderValue: 100000,
        ...validDates,
      },
      expectedStatus: 400,
    },
    {
      name: 'code dài 2 ký tự (< 3) bị từ chối',
      payload: {
        code: 'AB',
        discountType: 'percent',
        discountValue: 10,
        minOrderValue: 100000,
        ...validDates,
      },
      expectedStatus: 400,
    },
    {
      name: 'code dài 33 ký tự (> 32) bị từ chối',
      payload: {
        code: 'A'.repeat(33),
        discountType: 'percent',
        discountValue: 10,
        minOrderValue: 100000,
        ...validDates,
      },
      expectedStatus: 400,
    },
    {
      name: 'code chứa ký tự đặc biệt bị từ chối',
      payload: {
        code: 'BAITY@2026!',
        discountType: 'percent',
        discountValue: 10,
        minOrderValue: 100000,
        ...validDates,
      },
      expectedStatus: 400,
    },
    {
      name: 'startDate sau endDate bị từ chối',
      payload: {
        code: 'DATE_ERR_8C',
        discountType: 'percent',
        discountValue: 15,
        minOrderValue: 100000,
        startDate: '2027-05-01T10:00',
        endDate: '2027-05-01T09:00',
      },
      expectedStatus: 400,
    },
  ];

  for (const tc of boundaryCases) {
    const res = await fetch(`${baseUrl}/api/admin/vouchers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify(tc.payload),
    });
    assert.equal(res.status, tc.expectedStatus, `Case [${tc.name}] phải trả ${tc.expectedStatus}`);
  }
});

test('Bước 8c.2b: Tạo Voucher hợp lệ (chuẩn hóa uppercase, lọc HTML, múi giờ GMT+7 -> UTC, chống trùng 409, từ chối DELETE 400)', async () => {
  const createRes = await fetch(`${baseUrl}/api/admin/vouchers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      code: 'baity_8c_vip',
      description: 'Ưu đãi VIP 8C <script>alert(1)</script>',
      discountType: 'percent',
      discountValue: 20,
      minOrderValue: 200000,
      maxDiscount: 80000,
      usageLimit: 10,
      perUserLimit: 2,
      startDate: '2026-01-01T07:00', // 07:00 GMT+7 = 00:00 UTC
      endDate: '2027-12-31T23:00',
      applicableCategoryId: sampleCategoryId,
      isActive: true,
    }),
  });
  assert.equal(createRes.status, 201);
  const createBody = await createRes.json();
  assert.equal(createBody.voucher.code, 'BAITY_8C_VIP');
  assert.equal(createBody.voucher.description.includes('<script>'), false);
  assert.equal(new Date(createBody.voucher.startDate).toISOString(), '2026-01-01T00:00:00.000Z');
  createdVoucherId = createBody.voucher.id;
  createdVoucherUpdatedAt = createBody.voucher.updatedAt;

  const dupRes = await fetch(`${baseUrl}/api/admin/vouchers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      code: 'BAITY_8C_VIP',
      discountType: 'fixed',
      discountValue: 50000,
      minOrderValue: 100000,
      startDate: '2026-01-01T08:00',
      endDate: '2027-01-01T08:00',
    }),
  });
  assert.equal(dupRes.status, 409);

  const delRes = await fetch(`${baseUrl}/api/admin/vouchers/${createdVoucherId}`, {
    method: 'DELETE',
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` },
  });
  assert.equal(delRes.status, 404);
  const delBody = await delRes.json();
  assert.equal(delBody.code, 'ADMIN_ROUTE_NOT_FOUND');
});

test('Bước 8c.2c: Voucher đã có lượt sử dụng KHÔNG được sửa code, discountType, discountValue; usageLimit không nhỏ hơn usedCount; xung đột cập nhật trả 409', async () => {
  await queryRows(sql`
    UPDATE vouchers SET used_count = 3 WHERE id = ${createdVoucherId}::uuid;
  `);

  const editValueRes = await fetch(`${baseUrl}/api/admin/vouchers/${createdVoucherId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      code: 'BAITY_8C_VIP',
      description: 'Thử đổi mức giảm',
      discountType: 'percent',
      discountValue: 25,
      minOrderValue: 200000,
      maxDiscount: 80000,
      usageLimit: 10,
      perUserLimit: 2,
      startDate: '2026-01-01T07:00',
      endDate: '2027-12-31T23:00',
      isActive: true,
      expectedUpdatedAt: createdVoucherUpdatedAt,
    }),
  });
  assert.equal(editValueRes.status, 400);
  assert.equal((await editValueRes.json()).code, 'USED_VOUCHER_IMMUTABLE_FIELDS');

  const lowerLimitRes = await fetch(`${baseUrl}/api/admin/vouchers/${createdVoucherId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      code: 'BAITY_8C_VIP',
      description: 'Hạ giới hạn lượt dùng xuống 2',
      discountType: 'percent',
      discountValue: 20,
      minOrderValue: 200000,
      maxDiscount: 80000,
      usageLimit: 2,
      perUserLimit: 2,
      startDate: '2026-01-01T07:00',
      endDate: '2027-12-31T23:00',
      isActive: true,
      expectedUpdatedAt: createdVoucherUpdatedAt,
    }),
  });
  assert.equal(lowerLimitRes.status, 400);
  assert.equal((await lowerLimitRes.json()).code, 'USAGE_LIMIT_BELOW_USED_COUNT');

  const validUpdateRes = await fetch(`${baseUrl}/api/admin/vouchers/${createdVoucherId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      code: 'BAITY_8C_VIP',
      description: 'Đã nâng giới hạn lên 15',
      discountType: 'percent',
      discountValue: 20,
      minOrderValue: 200000,
      maxDiscount: 80000,
      usageLimit: 15,
      perUserLimit: 2,
      startDate: '2026-01-01T07:00',
      endDate: '2027-12-31T23:00',
      isActive: true,
      expectedUpdatedAt: createdVoucherUpdatedAt,
    }),
  });
  assert.equal(validUpdateRes.status, 200);

  const staleRes = await fetch(`${baseUrl}/api/admin/vouchers/${createdVoucherId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      code: 'BAITY_8C_VIP',
      description: 'Gửi bản cũ',
      discountType: 'percent',
      discountValue: 20,
      minOrderValue: 200000,
      maxDiscount: 80000,
      usageLimit: 15,
      perUserLimit: 2,
      startDate: '2026-01-01T07:00',
      endDate: '2027-12-31T23:00',
      isActive: false,
      expectedUpdatedAt: createdVoucherUpdatedAt,
    }),
  });
  assert.equal(staleRes.status, 409);
  assert.equal((await staleRes.json()).code, 'CONCURRENT_MODIFICATION');
});

// ============================================================================
// NHÓM 8c.3: KHUYẾN MÃI & FLASH SALE (TÁCH RIÊNG TỪNG QUY TẮC & KIỂM THỬ BIÊN)
// ============================================================================
let createdPromoId = '';
let placedPromoOrderId = '';
let expectedPromoPrice = 0;

test('Bước 8c.3a: Xem trước phạm vi khuyến mãi (POST /api/admin/promotions/preview) tính đúng số sản phẩm ảnh hưởng và giá trước/sau', async () => {
  await queryRows(sql`UPDATE promotions SET is_active = false;`);
  expectedPromoPrice = Math.round((sampleBasePrice * 75) / 100);

  const previewRes = await fetch(`${baseUrl}/api/admin/promotions/preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      targets: [
        {
          targetType: 'product',
          targetId: sampleProductId,
          discountPercent: 25,
        },
      ],
    }),
  });
  assert.equal(previewRes.status, 200);
  const previewBody = await previewRes.json();
  assert.equal(previewBody.affectedProductCount, 1);
  assert.equal(previewBody.exampleProduct.id, sampleProductId);
  assert.equal(previewBody.exampleProduct.priceBefore, sampleBasePrice);
  assert.equal(previewBody.exampleProduct.priceAfter, expectedPromoPrice);
});

test('Bước 8c.3b: Kiểm thử biên table-driven cho Promotion (discountPercent 0 và 81, thời lượng 91 ngày, startTime sau endTime)', async () => {
  const promoBoundaryCases: Array<{
    name: string;
    payload: Record<string, unknown>;
    expectedStatus: number;
  }> = [
    {
      name: 'discountPercent = 0 bị từ chối',
      payload: {
        title: 'Promo 0%',
        startTime: '2026-01-01T08:00',
        endTime: '2026-01-10T08:00',
        isActive: true,
        targets: [{ targetType: 'product', targetId: sampleProductId, discountPercent: 0 }],
      },
      expectedStatus: 400,
    },
    {
      name: 'discountPercent = 81 (> 80) bị từ chối',
      payload: {
        title: 'Promo 81%',
        startTime: '2026-01-01T08:00',
        endTime: '2026-01-10T08:00',
        isActive: true,
        targets: [{ targetType: 'product', targetId: sampleProductId, discountPercent: 81 }],
      },
      expectedStatus: 400,
    },
    {
      name: 'thời lượng 91 ngày (> 90 ngày) bị từ chối',
      payload: {
        title: 'Promo 91 ngày',
        startTime: '2026-01-01T08:00',
        endTime: '2026-04-02T08:00',
        isActive: true,
        targets: [{ targetType: 'product', targetId: sampleProductId, discountPercent: 20 }],
      },
      expectedStatus: 400,
    },
    {
      name: 'startTime sau endTime bị từ chối',
      payload: {
        title: 'Promo ngược giờ',
        startTime: '2026-02-01T10:00',
        endTime: '2026-02-01T09:00',
        isActive: true,
        targets: [{ targetType: 'product', targetId: sampleProductId, discountPercent: 20 }],
      },
      expectedStatus: 400,
    },
  ];

  for (const tc of promoBoundaryCases) {
    const res = await fetch(`${baseUrl}/api/admin/promotions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify(tc.payload),
    });
    assert.equal(res.status, tc.expectedStatus, `Case [${tc.name}] phải trả ${tc.expectedStatus}`);
  }
});

test('Bước 8c.3c: Tạo Flash Sale đang diễn ra có hiệu lực tức thì trên cửa hàng, giỏ hàng và đơn đặt hàng', async () => {
  const nowMinus1h = new Date(Date.now() - 3600 * 1000).toISOString();
  const nowPlus5d = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();

  const createPromoRes = await fetch(`${baseUrl}/api/admin/promotions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      title: 'Flash Sale Kiểm Thử 8C',
      startTime: nowMinus1h,
      endTime: nowPlus5d,
      isActive: true,
      targets: [
        {
          targetType: 'product',
          targetId: sampleProductId,
          discountPercent: 25,
        },
      ],
    }),
  });
  assert.equal(createPromoRes.status, 201);
  createdPromoId = (await createPromoRes.json()).promotion.id;

  const prodDetailRes = await fetch(`${baseUrl}/api/products/${sampleProductSlug}`);
  assert.equal(prodDetailRes.status, 200);
  const prodDetail = (await prodDetailRes.json()).data;
  assert.equal(prodDetail.effectivePrice, expectedPromoPrice);
  assert.equal(prodDetail.isOnSale, true);

  await queryRows(sql`DELETE FROM cart_items WHERE user_id = ${customerId}::uuid;`);
  const addCart1 = await fetch(`${baseUrl}/api/cart`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${customerToken}`,
    },
    body: JSON.stringify({ variantId: sampleVariantId, quantity: 1 }),
  });
  assert.equal(addCart1.status, 200);
  const cart1Body = await addCart1.json();
  assert.equal(cart1Body.data.items[0].effectivePrice, expectedPromoPrice);

  const orderRes = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${customerToken}`,
    },
    body: JSON.stringify({
      receiverName: 'Khách Đặt Khi Đang Sale',
      receiverPhone: '0912777999',
      shippingAddress: '100 Lê Lợi, Quận 1, TP.HCM',
      shippingMethod: 'standard',
      paymentMethod: 'cod',
      idempotencyKey: `idem-promo-8c-${Date.now()}`,
    }),
  });
  assert.equal(orderRes.status, 201);
  placedPromoOrderId = (await orderRes.json()).data.orderId;
});

test('Bước 8c.3d: Kết thúc sớm chương trình khuyến mãi cập nhật ngay giá giỏ hàng về giá gốc nhưng giữ nguyên giá snapshot của đơn đã đặt', async () => {
  await fetch(`${baseUrl}/api/cart`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${customerToken}`,
    },
    body: JSON.stringify({ variantId: sampleVariantId, quantity: 1 }),
  });

  const endEarlyRes = await fetch(`${baseUrl}/api/admin/promotions/${createdPromoId}/end-early`, {
    method: 'POST',
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` },
  });
  assert.equal(endEarlyRes.status, 200);

  const cartAfterRes = await fetch(`${baseUrl}/api/cart`, {
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${customerToken}` },
  });
  const cartAfterBody = await cartAfterRes.json();
  assert.equal(
    cartAfterBody.data.items[0].effectivePrice,
    sampleBasePrice,
    'Sau khi kết thúc khuyến mãi, giá trong giỏ hàng phải cập nhật ngay về giá gốc'
  );

  const placedOrderItems = await queryRows<{ unit_price: number }>(sql`
    SELECT unit_price FROM order_items WHERE order_id = ${placedPromoOrderId};
  `);
  assert.equal(
    Number(placedOrderItems[0].unit_price),
    expectedPromoPrice,
    'Đơn hàng đã đặt trước đó tuyệt đối không bị đổi giá snapshot khi chương trình khuyến mãi kết thúc'
  );
});

// ============================================================================
// NHÓM 8c.4: CÀI ĐẶT CỬA HÀNG (TÁCH RIÊNG TỪNG QUY TẮC & KIỂM THỬ BIÊN)
// ============================================================================
const validBaseSettingsPayload = {
  contact: {
    storeName: 'BAITY ATELIER',
    hotline: '0901234567',
    email: 'support@baity-atelier.vn',
    address: '88 Đồng Khởi, Quận 1, TP.HCM',
    workingHours: '09:00 - 21:00',
    legalEntityName: 'Công ty TNHH Thời Trang BAITY Atelier',
    taxId: '0101234567',
    returnAddress: 'Kho Đổi Trả Quận 7, TP.HCM',
  },
  shipping: {
    standardShippingFee: 22000,
    expressShippingFee: 45000,
    freeShippingThreshold: 450000,
  },
  returns: {
    returnDaysLimit: 14,
  },
  inventory: {
    lowStockThreshold: 8,
  },
  bannerText: 'Tuần lễ Linen Tự Nhiên',
};

test('Bước 8c.4a: Cài đặt cửa hàng từ chối lưu số tài khoản ngân hàng, khóa API hoặc bí mật hệ thống (400 FORBIDDEN_SENSITIVE_SETTING) và VietQR chỉ hiển thị 4 số cuối', async () => {
  for (const forbiddenPayload of [
    { bankAccount: '190388889999' },
    { contact: { storeName: 'BAITY', apiKey: 'AIzaSyFakeKey' } },
    { GEMINI_API_KEY: 'secret' },
    { jwtSecret: 'secret' },
  ]) {
    const badRes = await fetch(`${baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify(forbiddenPayload),
    });
    assert.equal(badRes.status, 400);
    assert.equal((await badRes.json()).code, 'FORBIDDEN_SENSITIVE_SETTING');
  }

  const getSetRes = await fetch(`${baseUrl}/api/admin/settings`, {
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` },
  });
  assert.equal(getSetRes.status, 200);
  const initSettings = await getSetRes.json();
  assert.equal(initSettings.vietqrReadOnly.bankName.includes('Techcombank'), true);
  assert.equal(initSettings.vietqrReadOnly.accountNumberLast4, '9999');
  assert.equal(initSettings.vietqrReadOnly.accountNumberMasked, '****9999');
});

test('Bước 8c.4b: Kiểm thử biên table-driven cho Cài đặt cửa hàng (phí ship -1 và 500001, ngưỡng miễn phí 10000001, hạn đổi trả 0 và 31, mã số thuế 9 chữ số, SĐT sai, email sai, banner 121 ký tự)', async () => {
  const settingsBoundaryCases: Array<{
    name: string;
    mutate: (base: typeof validBaseSettingsPayload) => Record<string, unknown>;
  }> = [
    {
      name: 'phí ship = -1',
      mutate: (b) => ({ ...b, shipping: { ...b.shipping, standardShippingFee: -1 } }),
    },
    {
      name: 'phí ship = 500001',
      mutate: (b) => ({ ...b, shipping: { ...b.shipping, standardShippingFee: 500001 } }),
    },
    {
      name: 'ngưỡng miễn phí = 10000001',
      mutate: (b) => ({ ...b, shipping: { ...b.shipping, freeShippingThreshold: 10000001 } }),
    },
    {
      name: 'hạn đổi trả = 0',
      mutate: (b) => ({ ...b, returns: { returnDaysLimit: 0 } }),
    },
    {
      name: 'hạn đổi trả = 31',
      mutate: (b) => ({ ...b, returns: { returnDaysLimit: 31 } }),
    },
    {
      name: 'mã số thuế 9 chữ số',
      mutate: (b) => ({ ...b, contact: { ...b.contact, taxId: '123456789' } }),
    },
    {
      name: 'SĐT sai định dạng',
      mutate: (b) => ({ ...b, contact: { ...b.contact, hotline: '12345' } }),
    },
    {
      name: 'email sai định dạng',
      mutate: (b) => ({ ...b, contact: { ...b.contact, email: 'khong-phai-email' } }),
    },
    {
      name: 'banner dài 121 ký tự (> 120)',
      mutate: (b) => ({ ...b, bannerText: 'B'.repeat(121) }),
    },
  ];

  for (const tc of settingsBoundaryCases) {
    const payload = tc.mutate(structuredClone(validBaseSettingsPayload));
    const res = await fetch(`${baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 400, `Case [${tc.name}] phải bị từ chối với HTTP 400`);
  }
});

let settingsAfterStep1UpdatedAt = '';

test('Bước 8c.4c: Cập nhật cài đặt cửa hàng có hiệu lực tức thì ở /api/settings/general, /api/cart và nội suy chính sách /api/policies/return', async () => {
  const getSetRes = await fetch(`${baseUrl}/api/admin/settings`, {
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` },
  });
  const initSettings = await getSetRes.json();

  const step1Res = await fetch(`${baseUrl}/api/admin/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      ...validBaseSettingsPayload,
      expectedUpdatedAt: initSettings.updatedAt,
    }),
  });
  assert.equal(step1Res.status, 200);
  const step1Body = await step1Res.json();
  settingsAfterStep1UpdatedAt = step1Body.updatedAt;

  const [genRes, cartRes, retPolRes] = await Promise.all([
    fetch(`${baseUrl}/api/settings/general`),
    fetch(`${baseUrl}/api/cart`, {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${customerToken}` },
    }),
    fetch(`${baseUrl}/api/policies/return`),
  ]);
  const genData = (await genRes.json()).data;
  assert.equal(genData.bannerText, 'Tuần lễ Linen Tự Nhiên');
  assert.equal(genData.freeShippingThreshold, 450000);
  assert.equal(genData.standardShippingFee, 22000);
  const cartSummary = (await cartRes.json()).data.summary;
  assert.equal(cartSummary.estimatedShippingFee, 22000);
  assert.equal(cartSummary.freeShippingThreshold, 450000);
  const retPolText = (await retPolRes.json()).data.content as string;
  assert.ok(retPolText.includes('0901234567'));
  assert.ok(retPolText.includes('Kho Đổi Trả Quận 7, TP.HCM'));
});

test('Bước 8c.4d: Đơn hàng đã giao trước thời điểm giảm returnDaysLimit vẫn được bảo lưu thời hạn đổi trả cũ', async () => {
  const grandfatheredOrderId = `ORD-GF-${Date.now()}`;
  const fiveDaysAgoIso = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount,
      status, delivered_at, created_at
    ) VALUES (
      ${grandfatheredOrderId}, ${customerId}::uuid, 'Khách Đơn Cũ', '0912777999', '123 Lê Lợi',
      'standard', 0, 500000, 0, 500000,
      'delivered', ${fiveDaysAgoIso}::timestamptz, ${fiveDaysAgoIso}::timestamptz
    );
  `);
  const oiRows = await queryRows<{ id: string }>(sql`
    INSERT INTO order_items (
      order_id, variant_id, product_name, color, size, unit_price, quantity, total_price
    )
    VALUES (
      ${grandfatheredOrderId}, ${sampleVariantId}::uuid, 'Áo Linen', 'Trắng', 'M', 500000, 1, 500000
    )
    RETURNING id;
  `);
  const grandfatheredOrderItemId = oiRows[0].id;
  await queryRows(sql`
    INSERT INTO order_status_history (order_id, status, note, created_at)
    VALUES (${grandfatheredOrderId}, 'delivered', 'Đã giao 5 ngày trước', ${fiveDaysAgoIso}::timestamptz);
  `);

  const step2Res = await fetch(`${baseUrl}/api/admin/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      ...validBaseSettingsPayload,
      returns: {
        returnDaysLimit: 3,
      },
      expectedUpdatedAt: settingsAfterStep1UpdatedAt,
    }),
  });
  assert.equal(step2Res.status, 200);

  const returnReqRes = await fetch(`${baseUrl}/api/returns`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${customerToken}`,
    },
    body: JSON.stringify({
      orderId: grandfatheredOrderId,
      orderItemId: grandfatheredOrderItemId,
      quantity: 1,
      type: 'refund',
      reason: 'size_not_fit',
      description: 'Muốn đổi kích cỡ theo quyền lợi 14 ngày lúc nhận hàng',
    }),
  });
  assert.equal(
    returnReqRes.status,
    201,
    'Đơn hàng đã giao trước thời điểm giảm returnDaysLimit phải được bảo lưu thời hạn đổi trả 14 ngày cũ'
  );
});

// ============================================================================
// NHÓM 8c.5: CHÍNH SÁCH & FAQ (TÁCH RIÊNG TỪNG QUY TẮC & KIỂM THỬ BIÊN)
// ============================================================================
test('Bước 8c.5a: Kiểm thử biên table-driven cho Chính sách (biến lạ {{...}}, nội dung 20001 ký tự, DELETE chính sách rơi vào 404 mặc định)', async () => {
  const delPolRes = await fetch(`${baseUrl}/api/admin/policies/return`, {
    method: 'DELETE',
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` },
  });
  assert.equal(delPolRes.status, 404);
  assert.equal((await delPolRes.json()).code, 'ADMIN_ROUTE_NOT_FOUND');

  const policyBoundaryCases: Array<{
    name: string;
    endpoint: string;
    method: 'POST' | 'PUT';
    payload: { title: string; content: string };
    expectedStatus: number;
  }> = [
    {
      name: 'biến lạ {{secret_admin_token}} ở preview',
      endpoint: '/api/admin/policies/preview',
      method: 'POST',
      payload: {
        title: 'Chính sách đổi trả',
        content: 'Nội dung có biến lạ {{secret_admin_token}} không hợp lệ.',
      },
      expectedStatus: 400,
    },
    {
      name: 'biến lạ {{database_url}} ở PUT policy',
      endpoint: '/api/admin/policies/return',
      method: 'PUT',
      payload: {
        title: 'Chính sách đổi trả',
        content: 'Nội dung có biến lạ {{database_url}} không hợp lệ.',
      },
      expectedStatus: 400,
    },
    {
      name: 'nội dung dài 20001 ký tự (> 20000) ở PUT policy',
      endpoint: '/api/admin/policies/return',
      method: 'PUT',
      payload: {
        title: 'Chính sách quá dài',
        content: 'P'.repeat(20001),
      },
      expectedStatus: 400,
    },
  ];

  for (const tc of policyBoundaryCases) {
    const res = await fetch(`${baseUrl}${tc.endpoint}`, {
      method: tc.method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify(tc.payload),
    });
    assert.equal(res.status, tc.expectedStatus, `Case [${tc.name}] phải trả ${tc.expectedStatus}`);
  }
});

test('Bước 8c.5b: Cập nhật chính sách với SafeMarkdown (loại bỏ HTML thô), nội suy biến hợp lệ và khôi phục mặc định từ seed', async () => {
  const getReturnPol = await fetch(`${baseUrl}/api/admin/policies/return`, {
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` },
  });
  const returnPolData = (await getReturnPol.json()).policy;

  const updatePolRes = await fetch(`${baseUrl}/api/admin/policies/return`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      title: 'Chính sách Đổi trả Ưu việt',
      content:
        '## Quy định mới\nKhách hàng được đổi trả trong **{{return_days}} ngày** tại {{store_name}}. <script>alert("xss")</script>',
      expectedUpdatedAt: returnPolData.updatedAt,
    }),
  });
  assert.equal(updatePolRes.status, 200);
  const updatedPolBody = await updatePolRes.json();
  assert.equal(updatedPolBody.policy.content.includes('<script>'), false);
  assert.ok(updatedPolBody.policy.interpolatedContent.includes('BAITY ATELIER'));

  const restoreRes = await fetch(`${baseUrl}/api/admin/policies/return/restore`, {
    method: 'POST',
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` },
  });
  assert.equal(restoreRes.status, 200);
  const restoredBody = await restoreRes.json();
  assert.equal(
    restoredBody.policy.title,
    'Chính sách đổi trả & hoàn tiền trong {{return_window_days}} ngày'
  );
});

test('Bước 8c.5c: Tạo mới, lọc HTML và ẩn/hiện câu hỏi FAQ trên trang công khai GET /api/faq', async () => {
  const createFaqRes = await fetch(`${baseUrl}/api/admin/faqs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      title: 'Cửa hàng có gói quà tặng miễn phí dịp lễ không?',
      topic: 'Thanh toán & VietQR',
      content: 'Tại **{{store_name}}**, chúng tôi hỗ trợ hộp quà kèm thiệp viết tay. <iframe src="evil"></iframe>',
      displayOrder: 1,
      isActive: true,
    }),
  });
  assert.equal(createFaqRes.status, 201);
  const createdFaq = (await createFaqRes.json()).faq;
  assert.equal(createdFaq.content.includes('<iframe'), false);

  const pubFaqBefore = await (await fetch(`${baseUrl}/api/faq`)).json();
  assert.equal(
    JSON.stringify(pubFaqBefore.groups).includes('Cửa hàng có gói quà tặng miễn phí dịp lễ không?'),
    true
  );

  const hideFaqRes = await fetch(`${baseUrl}/api/admin/faqs/${createdFaq.id}/visibility`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({ isActive: false }),
  });
  assert.equal(hideFaqRes.status, 200);

  const pubFaqAfter = await (await fetch(`${baseUrl}/api/faq`)).json();
  assert.equal(
    JSON.stringify(pubFaqAfter.groups).includes('Cửa hàng có gói quà tặng miễn phí dịp lễ không?'),
    false,
    'Câu hỏi FAQ đã ẩn không được hiển thị trên trang công khai GET /api/faq'
  );
});

// ============================================================================
// NHÓM 8c.6: BẢO VỆ DỮ LIỆU ADMIN KHI CHẠY LẠI SEED (PHẦN 1 MỤC 3)
// ============================================================================
test('Bước 8c.6a: Sửa một voucher, một promotion, một cài đặt, gọi lại seedDatabase() và xác nhận giá trị đã sửa vẫn còn nguyên; REFRESH_DEMO_SALE bị từ chối ở production', async () => {
  // 1. Sửa voucher mẫu BAITYWELCOME (đổi discount_value từ 15 sang 28 và min_order_value sang 388000)
  await queryRows(sql`
    UPDATE vouchers
    SET discount_value = 28, min_order_value = 388000, is_active = false
    WHERE code = 'BAITYWELCOME';
  `);

  // 2. Sửa promotion mẫu Flash Sale Mùa Thu (đổi title và tắt is_active)
  await queryRows(sql`
    UPDATE promotions
    SET title = 'Flash Sale Mùa Thu - Đã Được Admin Tùy Chỉnh', is_active = false
    WHERE title LIKE 'Flash Sale Mùa Thu%';
  `);

  // 3. Sửa cài đặt cửa hàng (đổi storeName và standardShippingFee)
  const getSetBefore = await fetch(`${baseUrl}/api/admin/settings`, {
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` },
  });
  const settingsBefore = await getSetBefore.json();

  const updateSetRes = await fetch(`${baseUrl}/api/admin/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      ...validBaseSettingsPayload,
      contact: {
        ...validBaseSettingsPayload.contact,
        storeName: 'BAITY CUSTOM ADMIN STORE',
      },
      shipping: {
        ...validBaseSettingsPayload.shipping,
        standardShippingFee: 19000,
      },
      expectedUpdatedAt: settingsBefore.updatedAt,
    }),
  });
  assert.equal(updateSetRes.status, 200);

  // 4. Gọi lại seedDatabase() (mặc định REFRESH_DEMO_SALE không bật)
  delete process.env.REFRESH_DEMO_SALE;
  await seedDatabase();

  // 5. Xác nhận cả 3 dữ liệu Admin đã sửa vẫn còn nguyên vẹn
  const voucherRows = await queryRows<{
    discount_value: number;
    min_order_value: number;
    is_active: boolean;
  }>(sql`
    SELECT discount_value, min_order_value, is_active
    FROM vouchers
    WHERE code = 'BAITYWELCOME';
  `);
  assert.equal(Number(voucherRows[0].discount_value), 28);
  assert.equal(Number(voucherRows[0].min_order_value), 388000);
  assert.equal(voucherRows[0].is_active, false);

  const promoRows = await queryRows<{ title: string; is_active: boolean }>(sql`
    SELECT title, is_active
    FROM promotions
    WHERE title = 'Flash Sale Mùa Thu - Đã Được Admin Tùy Chỉnh';
  `);
  assert.equal(promoRows.length, 1);
  assert.equal(promoRows[0].is_active, false);

  const getSetAfter = await fetch(`${baseUrl}/api/admin/settings`, {
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` },
  });
  const settingsAfter = await getSetAfter.json();
  assert.equal(settingsAfter.contact.storeName, 'BAITY CUSTOM ADMIN STORE');
  assert.equal(settingsAfter.shipping.standardShippingFee, 19000);

  // 6. Xác nhận REFRESH_DEMO_SALE=true bị từ chối ở môi trường production
  process.env.REFRESH_DEMO_SALE = 'true';
  process.env.PRODUCTION_STRICT = 'true';
  try {
    await assert.rejects(
      async () => {
        await seedDatabase();
      },
      /REFRESH_DEMO_SALE_FORBIDDEN_IN_PRODUCTION/
    );
  } finally {
    delete process.env.REFRESH_DEMO_SALE;
    delete process.env.PRODUCTION_STRICT;
  }
});

// ============================================================================
// NHÓM 8c.7: GIAO DIỆN QUẢN TRỊ GIAI ĐOẠN 8c (MỤC 9)
// ============================================================================
test('Bước 8c.7: Các component giao diện quản trị Giai đoạn 8c (AdminLayout, VouchersPage, PromotionsPage, StoreSettingsPage, PoliciesFaqPage) tách riêng và render đầy đủ các tab/trạng thái', () => {
  const layoutHtml = renderToStaticMarkup(
    React.createElement(AdminLayout, {
      activeTab: 'vouchers',
      onSelectTab: () => {},
      overview: {},
      adminEmail: 'admin@baity.vn',
      onRefreshOverview: () => {},
      onBackToStore: () => {},
      children: React.createElement('div', null, 'Nội dung tab'),
    })
  );
  assert.ok(layoutHtml.includes('admin-tab-vouchers'));
  assert.ok(layoutHtml.includes('admin-tab-promotions'));
  assert.ok(layoutHtml.includes('admin-tab-settings'));
  assert.ok(layoutHtml.includes('admin-tab-policies'));

  const vouchersHtml = renderToStaticMarkup(React.createElement(VouchersPage, {}));
  assert.ok(vouchersHtml.includes('Quản lý Mã giảm giá (Voucher)'));
  assert.ok(vouchersHtml.includes('GMT+7'));

  const promotionsHtml = renderToStaticMarkup(React.createElement(PromotionsPage, {}));
  assert.ok(promotionsHtml.includes('Chương trình Khuyến mãi &amp; Flash Sale'));
  assert.ok(promotionsHtml.includes('GMT+7'));

  const settingsHtml = renderToStaticMarkup(React.createElement(StoreSettingsPage, {}));
  assert.ok(settingsHtml.includes('Đang tải cài đặt cửa hàng...'));

  const policiesHtml = renderToStaticMarkup(React.createElement(PoliciesFaqPage, {}));
  assert.ok(policiesHtml.includes('Chính sách Cửa hàng'));
  assert.ok(policiesHtml.includes('Câu hỏi thường gặp FAQ'));
});
