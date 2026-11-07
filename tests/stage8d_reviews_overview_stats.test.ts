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
process.env.JWT_SECRET = 'test-secret-stage8d-reviews-overview-stats';

import { createApp } from '../server/app.ts';
import { initDatabase } from '../server/db/init.ts';
import { queryRows, closeDb, resetQueryCounter, getQueryCount } from '../server/db/index.ts';
import { seedDatabase } from '../server/db/seed.ts';
import { generateToken, AUTH_COOKIE_NAME } from '../server/services/auth.ts';
import { OperationsOverviewPage } from '../src/components/admin/OperationsOverviewPage.tsx';
import { ReviewsAdminPage } from '../src/components/admin/ReviewsAdminPage.tsx';
import { StatsDashboardPage } from '../src/components/admin/StatsDashboardPage.tsx';
import { StatsRevenueChart } from '../src/components/admin/stats/StatsRevenueChart.tsx';

let server: http.Server;
let baseUrl = '';
let adminCookie = '';
let customerCookie = '';
let adminUserId = '';
let customerUserId = '';
let testProductId = '';
let testProductSlug = '';
let testVariantId = '';

before(async () => {
  await initDatabase();
  await seedDatabase();
  const app = createApp();

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });

  // Đảm bảo tài khoản admin
  const adminRows = await queryRows<{ id: string; email: string }>(sql`
    INSERT INTO users (full_name, email, phone, password_hash, role)
    VALUES ('Admin Stage 8d', 'admin_stage8d@baity.vn', '0908880001', 'hash_admin', 'admin')
    ON CONFLICT (email) DO UPDATE SET role = 'admin'
    RETURNING id, email;
  `);
  adminUserId = adminRows[0].id;
  adminCookie = `${AUTH_COOKIE_NAME}=${generateToken({
    id: adminUserId,
    email: adminRows[0].email,
    role: 'admin',
  })}`;

  // Đảm bảo tài khoản customer
  const custRows = await queryRows<{ id: string; email: string }>(sql`
    INSERT INTO users (full_name, email, phone, password_hash, role)
    VALUES ('Khách Hàng 8d Bí Mật', 'customer_stage8d_pii@baity.vn', '0919998877', 'hash_cust', 'customer')
    ON CONFLICT (email) DO UPDATE SET role = 'customer'
    RETURNING id, email;
  `);
  customerUserId = custRows[0].id;
  customerCookie = `${AUTH_COOKIE_NAME}=${generateToken({
    id: customerUserId,
    email: custRows[0].email,
    role: 'customer',
  })}`;

  // Chọn 1 sản phẩm và biến thể trong seed
  const prodRows = await queryRows<{ id: string; slug: string; variant_id: string }>(sql`
    SELECT p.id, p.slug, pv.id AS variant_id
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id
    WHERE p.is_active = true
    LIMIT 1;
  `);
  assert.ok(prodRows.length > 0, 'Phải có ít nhất 1 sản phẩm và biến thể trong seed');
  testProductId = prodRows[0].id;
  testProductSlug = prodRows[0].slug;
  testVariantId = prodRows[0].variant_id;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await closeDb();
});

// ============================================================================
// 1. KIỂM THỬ PHÂN QUYỀN (401 CHƯA ĐĂNG NHẬP & 403 CUSTOMER) CHO MỌI ROUTE 8D
// ============================================================================
test('Stage 8d.1a: Chưa đăng nhập (401) bị từ chối ở toàn bộ route /api/admin/* của Giai đoạn 8d', async () => {
  const endpoints: Array<{ method: string; path: string; body?: unknown }> = [
    { method: 'GET', path: '/api/admin/overview' },
    { method: 'GET', path: '/api/admin/reviews' },
    {
      method: 'PATCH',
      path: '/api/admin/reviews/00000000-0000-0000-0000-000000000001/visibility',
      body: { isVisible: false, reason: 'Vi phạm ngôn từ' },
    },
    { method: 'GET', path: '/api/admin/stats/overview?from=2026-01-01&to=2026-01-07&granularity=day' },
    { method: 'GET', path: '/api/admin/stats/products?from=2026-01-01&to=2026-01-07' },
    { method: 'GET', path: '/api/admin/stats/vouchers?from=2026-01-01&to=2026-01-07' },
    { method: 'GET', path: '/api/admin/stats/visual-search?from=2026-01-01&to=2026-01-07' },
    { method: 'GET', path: '/api/admin/stats/export.csv?type=orders&from=2026-01-01&to=2026-01-07' },
  ];

  for (const ep of endpoints) {
    const res = await fetch(`${baseUrl}${ep.path}`, {
      method: ep.method,
      headers: ep.body ? { 'Content-Type': 'application/json' } : undefined,
      body: ep.body ? JSON.stringify(ep.body) : undefined,
    });
    assert.equal(
      res.status,
      401,
      `Kỳ vọng 401 cho ${ep.method} ${ep.path} khi chưa đăng nhập nhưng nhận ${res.status}`
    );
  }
});

test('Stage 8d.1b: Khách hàng thường (role=customer) bị từ chối (403) ở toàn bộ route /api/admin/* của Giai đoạn 8d', async () => {
  const endpoints: Array<{ method: string; path: string; body?: unknown }> = [
    { method: 'GET', path: '/api/admin/overview' },
    { method: 'GET', path: '/api/admin/reviews' },
    {
      method: 'PATCH',
      path: '/api/admin/reviews/00000000-0000-0000-0000-000000000001/visibility',
      body: { isVisible: false, reason: 'Vi phạm ngôn từ' },
    },
    { method: 'GET', path: '/api/admin/stats/overview?from=2026-01-01&to=2026-01-07&granularity=day' },
    { method: 'GET', path: '/api/admin/stats/products?from=2026-01-01&to=2026-01-07' },
    { method: 'GET', path: '/api/admin/stats/vouchers?from=2026-01-01&to=2026-01-07' },
    { method: 'GET', path: '/api/admin/stats/visual-search?from=2026-01-01&to=2026-01-07' },
    { method: 'GET', path: '/api/admin/stats/export.csv?type=orders&from=2026-01-01&to=2026-01-07' },
  ];

  for (const ep of endpoints) {
    const res = await fetch(`${baseUrl}${ep.path}`, {
      method: ep.method,
      headers: {
        Cookie: customerCookie,
        ...(ep.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: ep.body ? JSON.stringify(ep.body) : undefined,
    });
    assert.equal(
      res.status,
      403,
      `Kỳ vọng 403 cho ${ep.method} ${ep.path} với role=customer nhưng nhận ${res.status}`
    );
  }
});

// ============================================================================
// 2. QUẢN TRỊ ĐÁNH GIÁ: PHẢN HỒI, ẨN/HIỆN KÈM LÝ DO, TÍNH LẠI RATING, CHẶN ADMIN SỬA/XÓA NỘI DUNG KHÁCH
// ============================================================================
let createdReview1Id = '';
let createdReview2Id = '';

test('Stage 8d.2a: Chuẩn bị 2 đánh giá hợp lệ (5 sao và 1 sao) và kiểm tra GET /api/admin/reviews lọc theo sao, sản phẩm, phản hồi, hiển thị', async () => {
  await queryRows(sql`DELETE FROM reviews WHERE product_id = ${testProductId}::uuid;`);

  const order1Id = `BAITY-REV8D-1-${Date.now()}`;
  const order2Id = `BAITY-REV8D-2-${Date.now()}`;

  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status, delivered_at
    ) VALUES
      (${order1Id}, ${customerUserId}::uuid, 'Khách Đánh Giá 1', '0919998877', '123 Lê Lợi', 'standard', 0, 350000, 0, 350000, 'delivered', NOW()),
      (${order2Id}, ${customerUserId}::uuid, 'Khách Đánh Giá 2', '0919998877', '123 Lê Lợi', 'standard', 0, 350000, 0, 350000, 'completed', NOW());
  `);

  const r1Rows = await queryRows<{ id: string }>(sql`
    INSERT INTO reviews (user_id, product_id, order_id, rating, comment, is_visible)
    VALUES (${customerUserId}::uuid, ${testProductId}::uuid, ${order1Id}, 5, 'Áo sơ mi rất đẹp, đường may sắc nét', true)
    RETURNING id;
  `);
  createdReview1Id = r1Rows[0].id;

  const r2Rows = await queryRows<{ id: string }>(sql`
    INSERT INTO reviews (user_id, product_id, order_id, rating, comment, is_visible)
    VALUES (${customerUserId}::uuid, ${testProductId}::uuid, ${order2Id}, 1, 'Bình luận spam quảng cáo vi phạm chính sách', true)
    RETURNING id;
  `);
  createdReview2Id = r2Rows[0].id;

  const listRes = await fetch(
    `${baseUrl}/api/admin/reviews?productId=${testProductId}&replied=unreplied&visibility=visible`,
    { headers: { Cookie: adminCookie } }
  );
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  assert.equal(listBody.total, 2);
  assert.equal(listBody.items.length, 2);

  const rating1Res = await fetch(
    `${baseUrl}/api/admin/reviews?productId=${testProductId}&rating=1`,
    { headers: { Cookie: adminCookie } }
  );
  assert.equal(rating1Res.status, 200);
  const rating1Body = await rating1Res.json();
  assert.equal(rating1Body.total, 1);
  assert.equal(rating1Body.items[0].id, createdReview2Id);
});

test('Stage 8d.2b: Admin phản hồi đánh giá (PUT /api/reviews/:id/reply) lưu sellerReply và ghi admin_audit_logs', async () => {
  const replyRes = await fetch(`${baseUrl}/api/reviews/${createdReview1Id}/reply`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      sellerReply: 'Cảm ơn quý khách đã tin tưởng lựa chọn sản phẩm của BAITY!',
    }),
  });
  assert.equal(replyRes.status, 200);
  const replyBody = await replyRes.json();
  assert.equal(
    replyBody.data.sellerReply,
    'Cảm ơn quý khách đã tin tưởng lựa chọn sản phẩm của BAITY!'
  );
  assert.ok(replyBody.data.sellerRepliedAt);

  const auditRows = await queryRows<{ cnt: number }>(sql`
    SELECT COUNT(*)::int AS cnt
    FROM admin_audit_logs
    WHERE action = 'REVIEW_REPLY' AND target_id = ${createdReview1Id};
  `);
  assert.ok(auditRows[0].cnt >= 1, 'Phải ghi nhận REVIEW_REPLY vào admin_audit_logs');
});

test('Stage 8d.2c: Admin ẩn đánh giá vi phạm (PATCH /api/admin/reviews/:id/visibility) bắt buộc có lý do, loại khỏi trang sản phẩm, tính lại rating_avg và ghi audit log', async () => {
  // Trước khi ẩn: sản phẩm có 2 đánh giá hiển thị (5 sao và 1 sao) -> ratingAvg = 3.0, reviewCount = 2
  const beforeDetailRes = await fetch(`${baseUrl}/api/products/${testProductSlug}`);
  assert.equal(beforeDetailRes.status, 200);
  const beforeDetail = await beforeDetailRes.json();
  assert.equal(Number(beforeDetail.data.reviewCount), 2);
  assert.equal(Number(beforeDetail.data.ratingAvg), 3);

  // Thiếu hoặc lý do quá ngắn (< 2 ký tự) bị từ chối 400
  const missingReasonRes = await fetch(
    `${baseUrl}/api/admin/reviews/${createdReview2Id}/visibility`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({ isVisible: false, reason: 'a' }),
    }
  );
  assert.equal(missingReasonRes.status, 400);
  const missingReasonBody = await missingReasonRes.json();
  assert.equal(missingReasonBody.code, 'INVALID_VISIBILITY_INPUT');

  // Ẩn đánh giá 1 sao kèm lý do hợp lệ
  const hideRes = await fetch(
    `${baseUrl}/api/admin/reviews/${createdReview2Id}/visibility`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        isVisible: false,
        reason: 'Bình luận chứa liên kết spam quảng cáo trái phép',
      }),
    }
  );
  assert.equal(hideRes.status, 200);
  const hideBody = await hideRes.json();
  assert.equal(hideBody.review.isVisible, false);
  assert.equal(
    hideBody.review.hiddenReason,
    'Bình luận chứa liên kết spam quảng cáo trái phép'
  );

  // Kiểm tra ghi nhận audit log trong cùng giao dịch
  const auditRows = await queryRows<{ cnt: number }>(sql`
    SELECT COUNT(*)::int AS cnt
    FROM admin_audit_logs
    WHERE action = 'REVIEW_HIDE_VIOLATING' AND target_id = ${createdReview2Id};
  `);
  assert.equal(auditRows[0].cnt, 1, 'Phải ghi REVIEW_HIDE_VIOLATING vào admin_audit_logs');

  // Sau khi ẩn đánh giá 1 sao: ngoài cửa hàng chỉ còn đánh giá 5 sao -> reviewCount = 1, ratingAvg = 5.0
  const afterDetailRes = await fetch(`${baseUrl}/api/products/${testProductSlug}`);
  assert.equal(afterDetailRes.status, 200);
  const afterDetail = await afterDetailRes.json();
  assert.equal(
    Number(afterDetail.data.reviewCount),
    1,
    'Sau khi ẩn đánh giá 1 sao, reviewCount ngoài cửa hàng chỉ còn 1'
  );
  assert.equal(
    Number(afterDetail.data.ratingAvg),
    5,
    'Sau khi ẩn đánh giá 1 sao, ratingAvg ngoài cửa hàng phải tính lại thành 5.0'
  );
  assert.equal(
    afterDetail.data.reviews.some((r: any) => r.id === createdReview2Id),
    false,
    'Đánh giá bị ẩn không được xuất hiện trong danh sách reviews của GET /api/products/:slug'
  );

  // GET /api/products/:slug/reviews cũng loại bỏ đánh giá bị ẩn
  const pubReviewsRes = await fetch(`${baseUrl}/api/products/${testProductSlug}/reviews`);
  assert.equal(pubReviewsRes.status, 200);
  const pubReviewsBody = await pubReviewsRes.json();
  assert.equal(Number(pubReviewsBody.reviewCount), 1);
  assert.equal(Number(pubReviewsBody.ratingAvg), 5);
  assert.equal(
    (pubReviewsBody.items || []).some((r: any) => r.id === createdReview2Id),
    false,
    'Đánh giá bị ẩn không được xuất hiện ở GET /api/products/:slug/reviews'
  );

  // Danh sách sản phẩm ngoài cửa hàng (sqlProductPricingCte) cũng phản ánh ratingAvg = 5, reviewCount = 1
  const listProdRes = await fetch(
    `${baseUrl}/api/products?search=${encodeURIComponent(testProductSlug.split('-')[0])}&limit=50`
  );
  assert.equal(listProdRes.status, 200);
  const listProdBody = await listProdRes.json();
  const matchedProd = (listProdBody.data || []).find((p: any) => p.id === testProductId);
  if (matchedProd) {
    assert.equal(Number(matchedProd.reviewCount), 1);
    assert.equal(Number(matchedProd.ratingAvg), 5);
  }

  // Hiển thị lại -> ratingAvg quay về 3.0, reviewCount = 2 và ghi REVIEW_RESTORE_VISIBILITY
  const unhideRes = await fetch(
    `${baseUrl}/api/admin/reviews/${createdReview2Id}/visibility`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        isVisible: true,
        reason: 'Đã xác minh lại với khách hàng, khôi phục hiển thị',
      }),
    }
  );
  assert.equal(unhideRes.status, 200);
  const unhideBody = await unhideRes.json();
  assert.equal(unhideBody.review.isVisible, true);
  assert.equal(unhideBody.review.hiddenReason, null);

  // Ẩn lại đánh giá spam
  await fetch(`${baseUrl}/api/admin/reviews/${createdReview2Id}/visibility`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      isVisible: false,
      reason: 'Ẩn lại đánh giá spam phục vụ kiểm thử tổng quan vận hành',
    }),
  });
});

test('Stage 8d.2d: Admin cố sửa nội dung hoặc số sao (PUT /api/reviews/:id) hay xóa (DELETE /api/reviews/:id) đánh giá của khách bị từ chối 403', async () => {
  const editRes = await fetch(`${baseUrl}/api/reviews/${createdReview1Id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      rating: 5,
      comment: 'Admin cố tình sửa nội dung đánh giá của khách hàng',
    }),
  });
  assert.equal(editRes.status, 403);
  const editBody = await editRes.json();
  assert.equal(editBody.code, 'FORBIDDEN_NOT_REVIEW_OWNER');

  const deleteRes = await fetch(`${baseUrl}/api/reviews/${createdReview1Id}`, {
    method: 'DELETE',
    headers: { Cookie: adminCookie },
  });
  assert.equal(deleteRes.status, 403);
  const deleteBody = await deleteRes.json();
  assert.equal(deleteBody.code, 'FORBIDDEN_NOT_REVIEW_OWNER');
});

// ============================================================================
// 3. TRANG TỔNG QUAN VẬN HÀNH (/api/admin/overview): ĐÚNG 6 CHỈ SỐ, KHÔNG RÒ RỈ PII
// ============================================================================
test('Stage 8d.3: GET /api/admin/overview trả đúng 6 số đếm vận hành và tuyệt đối không chứa thông tin cá nhân (PII)', async () => {
  // 1. Đơn chờ xác nhận (COD)
  const ordPendingCod = `BAITY-OV-COD-${Date.now()}`;
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status
    ) VALUES (
      ${ordPendingCod}, ${customerUserId}::uuid, 'Nguyễn Văn Bí Mật PII', '0987654321', '999 Đường Bí Mật, Quận 1',
      'standard', 0, 200000, 0, 200000, 'pending'
    );
  `);
  await queryRows(sql`
    INSERT INTO payments (order_id, method, status)
    VALUES (${ordPendingCod}, 'cod', 'pending');
  `);

  // 2. Đơn chờ thanh toán VietQR
  const ordPendingVietqr = `BAITY-OV-VQR-${Date.now()}`;
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status
    ) VALUES (
      ${ordPendingVietqr}, ${customerUserId}::uuid, 'Trần Thị Bí Mật PII', '0912345678', '888 Đường Riêng Tư, Quận 3',
      'standard', 0, 300000, 0, 300000, 'pending'
    );
  `);
  await queryRows(sql`
    INSERT INTO payments (order_id, method, status)
    VALUES (${ordPendingVietqr}, 'vietqr', 'pending');
  `);

  // 3. Sự cố thanh toán chưa xử lý (refund_needed)
  const ordIssue = `BAITY-OV-ISS-${Date.now()}`;
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status
    ) VALUES (
      ${ordIssue}, ${customerUserId}::uuid, 'Lê Văn Sự Cố PII', '0933445566', '777 Đường Sự Cố',
      'standard', 0, 400000, 0, 400000, 'cancelled'
    );
  `);
  await queryRows(sql`
    INSERT INTO payments (order_id, method, status)
    VALUES (${ordIssue}, 'vietqr', 'refund_needed');
  `);

  // 4. Yêu cầu đổi trả chờ duyệt
  const itemRows = await queryRows<{ id: string }>(sql`
    INSERT INTO order_items (order_id, variant_id, product_name, color, size, unit_price, quantity, total_price)
    VALUES (${ordPendingCod}, ${testVariantId}::uuid, 'Áo Sơ Mi Test OV', 'Trắng', 'M', 200000, 1, 200000)
    RETURNING id;
  `);
  await queryRows(sql`
    INSERT INTO return_requests (order_id, user_id, order_item_id, reason, type, quantity, refund_amount, status)
    VALUES (${ordPendingCod}, ${customerUserId}::uuid, ${itemRows[0].id}::uuid, 'wrong_size', 'exchange', 1, 0, 'pending');
  `);

  // 5. Biến thể sắp hết hàng (stock <= lowStockThreshold)
  await queryRows(sql`
    UPDATE product_variants SET stock_quantity = 2 WHERE id = ${testVariantId}::uuid;
  `);

  // 6. Đánh giá hiển thị chưa có phản hồi
  const ordUnreplied = `BAITY-OV-REV-${Date.now()}`;
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status, delivered_at
    ) VALUES (
      ${ordUnreplied}, ${customerUserId}::uuid, 'Phạm Thị Review PII', '0944556677', '666 Đường Review',
      'standard', 0, 250000, 0, 250000, 'delivered', NOW()
    );
  `);
  await queryRows(sql`
    INSERT INTO reviews (user_id, product_id, order_id, rating, comment, is_visible)
    VALUES (${customerUserId}::uuid, ${testProductId}::uuid, ${ordUnreplied}, 4, 'Đánh giá chưa có phản hồi từ shop', true);
  `);

  const ovRes = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(ovRes.status, 200);
  const ovBody = await ovRes.json();
  const c = ovBody.overview;

  assert.ok(typeof c.pendingConfirmationOrders === 'number' && c.pendingConfirmationOrders >= 2);
  assert.ok(typeof c.awaitingVietQrOrders === 'number' && c.awaitingVietQrOrders >= 1);
  assert.ok(typeof c.pendingReturnRequests === 'number' && c.pendingReturnRequests >= 1);
  assert.ok(typeof c.unresolvedPaymentIssues === 'number' && c.unresolvedPaymentIssues >= 1);
  assert.ok(typeof c.lowStockVariants === 'number' && c.lowStockVariants >= 1);
  assert.ok(typeof c.unrepliedReviews === 'number' && c.unrepliedReviews >= 1);

  // Kiểm tra tuyệt đối không chứa PII trong phản hồi
  const rawJson = JSON.stringify(ovBody);
  assert.equal(rawJson.includes('Nguyễn Văn Bí Mật PII'), false);
  assert.equal(rawJson.includes('0987654321'), false);
  assert.equal(rawJson.includes('999 Đường Bí Mật'), false);
  assert.equal(rawJson.includes('customer_stage8d_pii@baity.vn'), false);
});

// ============================================================================
// 4. THỐNG KÊ DOANH THU THỰC, GIÁ TRỊ ĐƠN ĐẶT & BIÊN NGÀY THEO MÚI GIỜ Asia/Ho_Chi_Minh
// ============================================================================
test('Stage 8d.4a: Thống kê doanh thu thực (đơn đã giao trừ hoàn tiền hoàn tất), giá trị đơn đặt (đơn không hủy) và biên ngày theo múi giờ Asia/Ho_Chi_Minh (23:30 UTC sang ngày hôm sau ở GMT+7)', async () => {
  await queryRows(sql`DELETE FROM return_requests WHERE order_id LIKE 'BAITY-STAT8D-%';`);
  await queryRows(sql`DELETE FROM order_items WHERE order_id LIKE 'BAITY-STAT8D-%';`);
  await queryRows(sql`DELETE FROM orders WHERE id LIKE 'BAITY-STAT8D-%';`);

  // Order A: tạo & giao lúc 2028-05-10T23:30:00.000Z
  // Ở UTC là 23:30 ngày 10/05.
  // Ở Asia/Ho_Chi_Minh (GMT+7) là 06:30 sáng ngày 11/05!
  const ordTzBoundary = 'BAITY-STAT8D-TZ-1';
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status,
      created_at, delivered_at
    ) VALUES (
      ${ordTzBoundary}, ${customerUserId}::uuid, 'Khách Biên Múi Giờ', '0901122334', '100 Nguyễn Huệ',
      'standard', 0, 500000, 0, 500000, 'delivered',
      '2028-05-10T23:30:00.000Z'::timestamptz,
      '2028-05-10T23:30:00.000Z'::timestamptz
    );
  `);

  // Order B: tạo & xác nhận vào 2028-05-11T04:00:00.000Z (11:00 GMT+7 ngày 11/05), chưa giao (300.000đ)
  const ordConfirmed = 'BAITY-STAT8D-CONF-2';
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status,
      created_at
    ) VALUES (
      ${ordConfirmed}, ${customerUserId}::uuid, 'Khách Đã Đặt', '0901122335', '101 Nguyễn Huệ',
      'standard', 0, 300000, 0, 300000, 'confirmed',
      '2028-05-11T04:00:00.000Z'::timestamptz
    );
  `);

  // Order C: tạo & hủy vào 2028-05-11T05:00:00.000Z (400.000đ) -> không tính vào placedOrderValue và netRevenue
  const ordCancelled = 'BAITY-STAT8D-CANC-3';
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status,
      created_at
    ) VALUES (
      ${ordCancelled}, ${customerUserId}::uuid, 'Khách Hủy Đơn', '0901122336', '102 Nguyễn Huệ',
      'standard', 0, 400000, 0, 400000, 'cancelled',
      '2028-05-11T05:00:00.000Z'::timestamptz
    );
  `);

  // Hoàn tiền hoàn tất (status = 'completed') vào 2028-05-11T08:00:00.000Z (15:00 GMT+7 ngày 11/05) trị giá 120.000đ
  const oiRows = await queryRows<{ id: string }>(sql`
    INSERT INTO order_items (order_id, variant_id, product_name, color, size, unit_price, quantity, total_price)
    VALUES (${ordTzBoundary}, ${testVariantId}::uuid, 'Áo Sơ Mi Thống Kê', 'Xanh', 'L', 500000, 1, 500000)
    RETURNING id;
  `);
  await queryRows(sql`
    INSERT INTO return_requests (
      order_id, user_id, order_item_id, reason, type, quantity, refund_amount, status,
      created_at, updated_at
    ) VALUES (
      ${ordTzBoundary}, ${customerUserId}::uuid, ${oiRows[0].id}::uuid,
      'defective_product', 'refund', 1, 120000, 'completed',
      '2028-05-11T07:00:00.000Z'::timestamptz,
      '2028-05-11T08:00:00.000Z'::timestamptz
    );
  `);

  const statsRes = await fetch(
    `${baseUrl}/api/admin/stats/overview?from=2028-05-10&to=2028-05-12&granularity=day`,
    { headers: { Cookie: adminCookie } }
  );
  assert.equal(statsRes.status, 200);
  const statsBody = await statsRes.json();

  assert.equal(statsBody.range.timezone, 'Asia/Ho_Chi_Minh');
  assert.equal(statsBody.series.length, 3);

  const dayMay10 = statsBody.series.find((b: any) => b.bucketKey === '2028-05-10');
  const dayMay11 = statsBody.series.find((b: any) => b.bucketKey === '2028-05-11');
  assert.ok(dayMay10, 'Phải có mốc 2028-05-10');
  assert.ok(dayMay11, 'Phải có mốc 2028-05-11');

  // Xác nhận đơn lúc 23:30 UTC ngày 10/05 KHÔNG nằm ở ngày 10/05 theo giờ Việt Nam
  assert.equal(
    dayMay10.grossDeliveredRevenue,
    0,
    'Đơn lúc 23:30 UTC ngày 10/05 phải thuộc ngày 11/05 theo giờ Việt Nam (GMT+7), không thuộc ngày 10/05'
  );
  assert.equal(dayMay10.placedOrderValue, 0);

  // Xác nhận ngày 11/05 theo giờ Việt Nam:
  // - grossDeliveredRevenue = 500.000
  // - completedRefundAmount = 120.000
  // - netRevenue = 500.000 - 120.000 = 380.000
  // - placedOrderValue = 500.000 (Order A) + 300.000 (Order B) = 800.000 (Order C hủy bị loại trừ)
  assert.equal(dayMay11.grossDeliveredRevenue, 500000);
  assert.equal(dayMay11.completedRefundAmount, 120000);
  assert.equal(
    dayMay11.netRevenue,
    380000,
    'Doanh thu thực phải bằng đơn đã giao (500.000) trừ hoàn tiền hoàn tất (120.000) = 380.000'
  );
  assert.equal(
    dayMay11.placedOrderValue,
    800000,
    'Giá trị đơn đặt phải bằng tổng các đơn không hủy (500.000 + 300.000 = 800.000)'
  );
  assert.equal(dayMay11.placedOrderCount, 2);
  assert.equal(dayMay11.cancelledOrderCount, 1);

  assert.equal(statsBody.summary.netRevenue, 380000);
  assert.equal(statsBody.summary.placedOrderValue, 800000);
});

// ============================================================================
// 5. KIỂM TRA RÀNG BUỘC KHOẢNG NGÀY (> 366 NGÀY, FROM > TO) & SỐ LƯỢNG CÂU SQL KHÔNG TĂNG THEO SỐ NGÀY
// ============================================================================
test('Stage 8d.5a: Từ chối khoảng ngày không hợp lệ (from > to, vượt quá 366 ngày, granularity sai)', async () => {
  // 1. from > to
  const resFromAfterTo = await fetch(
    `${baseUrl}/api/admin/stats/overview?from=2026-05-10&to=2026-05-01&granularity=day`,
    { headers: { Cookie: adminCookie } }
  );
  assert.equal(resFromAfterTo.status, 400);
  const body1 = await resFromAfterTo.json();
  assert.equal(body1.code, 'INVALID_DATE_RANGE_ORDER');

  // 2. Range > 366 days (ví dụ: 2025-01-01 đến 2026-01-15 = 380 ngày)
  const resTooLarge = await fetch(
    `${baseUrl}/api/admin/stats/overview?from=2025-01-01&to=2026-01-15&granularity=day`,
    { headers: { Cookie: adminCookie } }
  );
  assert.equal(resTooLarge.status, 400);
  const body2 = await resTooLarge.json();
  assert.equal(body2.code, 'DATE_RANGE_TOO_LARGE');

  // 3. Invalid granularity
  const resBadGranularity = await fetch(
    `${baseUrl}/api/admin/stats/overview?from=2026-01-01&to=2026-01-07&granularity=hour`,
    { headers: { Cookie: adminCookie } }
  );
  assert.equal(resBadGranularity.status, 400);
  const body3 = await resBadGranularity.json();
  assert.equal(body3.code, 'INVALID_STATS_QUERY');
});

test('Stage 8d.5b: Số câu truy vấn SQL của GET /api/admin/stats/overview là hằng số, không tăng theo độ dài khoảng ngày (không N+1)', async () => {
  resetQueryCounter();
  const res7Days = await fetch(
    `${baseUrl}/api/admin/stats/overview?from=2026-01-01&to=2026-01-07&granularity=day`,
    { headers: { Cookie: adminCookie } }
  );
  assert.equal(res7Days.status, 200);
  const callsFor7Days = getQueryCount();

  resetQueryCounter();
  const res180Days = await fetch(
    `${baseUrl}/api/admin/stats/overview?from=2026-01-01&to=2026-06-29&granularity=day`,
    { headers: { Cookie: adminCookie } }
  );
  assert.equal(res180Days.status, 200);
  const callsFor180Days = getQueryCount();

  assert.equal(
    callsFor180Days,
    callsFor7Days,
    `Số câu truy vấn SQL cho 180 ngày (${callsFor180Days}) phải bằng đúng số câu truy vấn cho 7 ngày (${callsFor7Days}), tuyệt đối không lặp theo từng ngày`
  );
  assert.ok(
    callsFor7Days <= 10,
    `Số câu SQL cho overview phải nhỏ gọn (<= 10), thực tế: ${callsFor7Days}`
  );
});

// ============================================================================
// 6. THỐNG KÊ SẢN PHẨM, VOUCHER, TÌM KIẾM HÌNH ẢNH
// ============================================================================
test('Stage 8d.6: Các endpoint /api/admin/stats/products, /api/admin/stats/vouchers, /api/admin/stats/visual-search trả đúng cấu trúc tổng hợp SQL', async () => {
  const [prodRes, voucherRes, vsRes] = await Promise.all([
    fetch(`${baseUrl}/api/admin/stats/products?from=2028-05-01&to=2028-05-31`, {
      headers: { Cookie: adminCookie },
    }),
    fetch(`${baseUrl}/api/admin/stats/vouchers?from=2026-01-01&to=2026-12-31`, {
      headers: { Cookie: adminCookie },
    }),
    fetch(`${baseUrl}/api/admin/stats/visual-search?from=2026-01-01&to=2026-12-31`, {
      headers: { Cookie: adminCookie },
    }),
  ]);

  assert.equal(prodRes.status, 200);
  const prodBody = await prodRes.json();
  assert.ok(Array.isArray(prodBody.topProducts));
  assert.ok(Array.isArray(prodBody.categoryBreakdown));
  assert.ok(Array.isArray(prodBody.slowMovingProducts));
  assert.equal(prodBody.topProducts[0]?.productId, testProductId);

  assert.equal(voucherRes.status, 200);
  const voucherBody = await voucherRes.json();
  assert.ok(Array.isArray(voucherBody.items));

  assert.equal(vsRes.status, 200);
  const vsBody = await vsRes.json();
  assert.equal(typeof vsBody.summary.totalSearches, 'number');
  assert.ok(Array.isArray(vsBody.topRecognizedCategories));
});

// ============================================================================
// 7. XUẤT CSV (/api/admin/stats/export.csv): KHÔNG CHỨA PII, CHỐNG FORMULA INJECTION, GHI AUDIT LOG
// ============================================================================
test('Stage 8d.7a: Xuất CSV đơn hàng (type=orders) không chứa tên, SĐT, email, địa chỉ người nhận và ghi nhận EXPORT_STATS_CSV vào admin_audit_logs', async () => {
  const ordCsvId = 'BAITY-CSV8D-1';
  await queryRows(sql`DELETE FROM orders WHERE id = ${ordCsvId};`);
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status,
      cancel_reason, created_at
    ) VALUES (
      ${ordCsvId}, ${customerUserId}::uuid,
      'Khách Hàng Mật CSV Không Được Xuất',
      '0977889900',
      'Số 1 Đường Tuyệt Mật, Phường Bến Nghé, Quận 1',
      'standard', 30000, 450000, 0, 480000, 'cancelled',
      '=HYPERLINK("http://evil.example/leak", "Click")',
      '2028-05-11T09:00:00.000Z'::timestamptz
    );
  `);

  const csvRes = await fetch(
    `${baseUrl}/api/admin/stats/export.csv?type=orders&from=2028-05-10&to=2028-05-12`,
    { headers: { Cookie: adminCookie } }
  );
  assert.equal(csvRes.status, 200);
  assert.match(String(csvRes.headers.get('content-type')), /text\/csv/i);
  assert.match(
    String(csvRes.headers.get('content-disposition')),
    /attachment;\s*filename="baity-stats-orders-2028-05-10-to-2028-05-12\.csv"/
  );

  const rawBytes = new Uint8Array(await csvRes.arrayBuffer());
  // Bắt đầu bằng UTF-8 BOM (0xEF, 0xBB, 0xBF)
  assert.equal(rawBytes[0], 0xef, 'Byte đầu tiên của CSV phải là 0xEF (UTF-8 BOM)');
  assert.equal(rawBytes[1], 0xbb, 'Byte thứ hai của CSV phải là 0xBB (UTF-8 BOM)');
  assert.equal(rawBytes[2], 0xbf, 'Byte thứ ba của CSV phải là 0xBF (UTF-8 BOM)');
  const csvText = new TextDecoder('utf-8').decode(rawBytes);

  // Tuyệt đối không chứa PII của khách hàng
  assert.equal(
    csvText.includes('Khách Hàng Mật CSV Không Được Xuất'),
    false,
    'CSV tuyệt đối không được chứa tên người nhận'
  );
  assert.equal(
    csvText.includes('0977889900'),
    false,
    'CSV tuyệt đối không được chứa số điện thoại người nhận'
  );
  assert.equal(
    csvText.includes('Số 1 Đường Tuyệt Mật'),
    false,
    'CSV tuyệt đối không được chứa địa chỉ giao hàng'
  );
  assert.equal(
    csvText.includes('customer_stage8d_pii@baity.vn'),
    false,
    'CSV tuyệt đối không được chứa email khách hàng'
  );

  // Kiểm tra ghi nhận audit log cho thao tác xuất CSV
  const auditRows = await queryRows<{ cnt: number }>(sql`
    SELECT COUNT(*)::int AS cnt
    FROM admin_audit_logs
    WHERE action = 'EXPORT_STATS_CSV' AND target_id = 'orders:2028-05-10_2028-05-12';
  `);
  assert.ok(auditRows[0].cnt >= 1, 'Xuất CSV phải ghi nhận EXPORT_STATS_CSV vào admin_audit_logs');
});

test('Stage 8d.7b: Xuất CSV sản phẩm (type=products) tự động thêm dấu nháy đơn (\') trước mọi ô bắt đầu bằng =, +, -, @, tab hoặc xuống dòng (chống CSV Formula Injection)', async () => {
  const catRows = await queryRows<{ id: string }>(sql`SELECT id FROM categories LIMIT 1;`);
  const formulaProdRows = await queryRows<{ id: string }>(sql`
    INSERT INTO products (
      category_id, name, slug, target_gender, description, material, care_instructions, base_price, search_text, is_active
    )
    VALUES (
      ${catRows[0].id}::uuid,
      '=SUM(1,2)+CMD',
      'san-pham-formula-csv-8d',
      'unisex',
      'Test CSV formula escape',
      'Cotton 100%',
      'Giặt nhẹ',
      290000,
      'sum 1 2 cmd',
      true
    )
    ON CONFLICT (slug) DO UPDATE SET name = '=SUM(1,2)+CMD'
    RETURNING id;
  `);
  const formulaProdId = formulaProdRows[0].id;

  const formulaVarRows = await queryRows<{ id: string }>(sql`
    INSERT INTO product_variants (product_id, sku, color_name, color_code, size, stock_quantity)
    VALUES (${formulaProdId}::uuid, 'SKU-FORMULA-8D', '+Màu Công Thức', '#112233', 'M', 10)
    ON CONFLICT (sku) DO UPDATE SET color_name = '+Màu Công Thức'
    RETURNING id;
  `);

  const ordFormulaId = 'BAITY-CSV8D-FORMULA';
  await queryRows(sql`DELETE FROM order_items WHERE order_id = ${ordFormulaId};`);
  await queryRows(sql`DELETE FROM orders WHERE id = ${ordFormulaId};`);
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status,
      created_at, delivered_at
    ) VALUES (
      ${ordFormulaId}, ${customerUserId}::uuid, 'Khách Formula', '0900001111', '123 Đường Test',
      'standard', 0, 290000, 0, 290000, 'delivered',
      '2028-05-11T10:00:00.000Z'::timestamptz,
      '2028-05-11T10:00:00.000Z'::timestamptz
    );
  `);
  await queryRows(sql`
    INSERT INTO order_items (order_id, variant_id, product_name, color, size, unit_price, quantity, total_price)
    VALUES (${ordFormulaId}, ${formulaVarRows[0].id}::uuid, '=SUM(1,2)+CMD', '+Màu Công Thức', 'M', 290000, 1, 290000);
  `);

  const csvRes = await fetch(
    `${baseUrl}/api/admin/stats/export.csv?type=products&from=2028-05-10&to=2028-05-12`,
    { headers: { Cookie: adminCookie } }
  );
  assert.equal(csvRes.status, 200);
  const csvText = await csvRes.text();

  // Tên sản phẩm bắt đầu bằng dấu = phải được tiền tố bằng dấu nháy đơn (')
  assert.equal(
    csvText.includes("'=SUM(1,2)+CMD"),
    true,
    'Tên sản phẩm bắt đầu bằng dấu = phải được tiền tố bằng dấu nháy đơn (\') để chống CSV Formula Injection'
  );
});

test('Stage 8d.4b: Cột cố định return_requests.refunded_at — ghi một lần khi chuyển sang completed; sửa mô tả/ghi chú sau khi hoàn tiền (updated_at thay đổi) KHÔNG làm lệch kỳ thống kê doanh thu thực; định nghĩa nêu rõ phí vận chuyển', async () => {
  const ordRefundTestId = 'BAITY-REFUNDED-AT-1';
  await queryRows(sql`DELETE FROM return_requests WHERE order_id = ${ordRefundTestId};`);
  await queryRows(sql`DELETE FROM order_items WHERE order_id = ${ordRefundTestId};`);
  await queryRows(sql`DELETE FROM payments WHERE order_id = ${ordRefundTestId};`);
  await queryRows(sql`DELETE FROM orders WHERE id = ${ordRefundTestId};`);

  // 1. Tạo đơn đã giao vào ngày 2029-03-10 GMT+7 (04:00 UTC)
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status,
      created_at, delivered_at
    ) VALUES (
      ${ordRefundTestId}, ${customerUserId}::uuid, 'Khách Hoàn Tiền', '0911223344', '100 Lê Lợi',
      'standard', 30000, 470000, 0, 500000, 'delivered',
      '2029-03-10T04:00:00.000Z'::timestamptz,
      '2029-03-10T04:00:00.000Z'::timestamptz
    );
  `);
  const oiRows = await queryRows<{ id: string }>(sql`
    INSERT INTO order_items (order_id, variant_id, product_name, color, size, unit_price, quantity, total_price)
    VALUES (${ordRefundTestId}, ${testVariantId}::uuid, 'Áo Test RefundedAt', 'Đen', 'M', 470000, 1, 470000)
    RETURNING id;
  `);

  // Tạo yêu cầu hoàn tiền ở trạng thái approved, sau đó gọi POST /api/admin/returns/:id/refund để chuyển sang completed
  const rrInsertRows = await queryRows<{ id: string }>(sql`
    INSERT INTO return_requests (
      order_id, order_item_id, user_id, reason, description, type, status, quantity, refund_amount,
      created_at, updated_at
    ) VALUES (
      ${ordRefundTestId}, ${oiRows[0].id}::uuid, ${customerUserId}::uuid,
      'store_fault', 'Áo bị sứt chỉ', 'refund', 'approved', 1, 150000,
      '2029-03-10T05:00:00.000Z'::timestamptz,
      '2029-03-10T05:00:00.000Z'::timestamptz
    )
    RETURNING id;
  `);
  const rrId = rrInsertRows[0].id;

  const refundRes = await fetch(`${baseUrl}/api/admin/returns/${rrId}/refund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie,
    },
    body: JSON.stringify({}),
  });
  assert.equal(refundRes.status, 200, 'POST /api/admin/returns/:id/refund sang completed phải trả 200');

  const checkRefundedAtRows = await queryRows<{ refunded_at: string | null }>(sql`
    SELECT refunded_at FROM return_requests WHERE id = ${rrId}::uuid;
  `);
  assert.ok(
    checkRefundedAtRows[0]?.refunded_at,
    'Khi chuyển sang completed qua POST /api/admin/returns/:id/refund, cột refunded_at phải được ghi tự động'
  );

  // Đặt refunded_at cố định vào ngày 2029-03-10T06:00:00.000Z (tức 13:00 ngày 10/03/2029 GMT+7)
  await queryRows(sql`
    UPDATE return_requests
    SET refunded_at = '2029-03-10T06:00:00.000Z'::timestamptz,
        updated_at = '2029-03-10T06:00:00.000Z'::timestamptz
    WHERE id = ${rrId}::uuid;
  `);

  const statsBeforeEditRes = await fetch(
    `${baseUrl}/api/admin/stats/overview?from=2029-03-10&to=2029-03-10&granularity=day`,
    { headers: { Cookie: adminCookie } }
  );
  assert.equal(statsBeforeEditRes.status, 200);
  const statsBefore = await statsBeforeEditRes.json();
  assert.equal(statsBefore.summary.grossDeliveredRevenue, 500000);
  assert.equal(statsBefore.summary.completedRefundAmount, 150000);
  assert.equal(statsBefore.summary.netRevenue, 350000);

  // Định nghĩa chỉ số phải nêu rõ có gồm phí vận chuyển không
  assert.ok(
    statsBefore.definitions?.netRevenue?.includes('phí vận chuyển'),
    'Định nghĩa Doanh thu thực phải nêu rõ chính sách phí vận chuyển'
  );
  assert.ok(
    statsBefore.definitions?.shippingFeePolicy?.includes('orders.total_amount'),
    'Định nghĩa shippingFeePolicy phải giải thích rõ orders.total_amount và return_requests.refund_amount'
  );

  // 2. Sửa ghi chú/mô tả yêu cầu đổi trả vào tháng sau (2029-04-20) làm updated_at thay đổi sang tháng 04/2029
  await queryRows(sql`
    UPDATE return_requests
    SET description = 'Cập nhật ghi chú lưu trữ nội bộ sau 1 tháng',
        updated_at = '2029-04-20T09:00:00.000Z'::timestamptz
    WHERE id = ${rrId}::uuid;
  `);

  // Kiểm tra lại kỳ tháng 03/2029 (2029-03-10): Doanh thu thực và Tiền hoàn KHÔNG bị đổi
  const statsMarchAfterEditRes = await fetch(
    `${baseUrl}/api/admin/stats/overview?from=2029-03-10&to=2029-03-10&granularity=day`,
    { headers: { Cookie: adminCookie } }
  );
  assert.equal(statsMarchAfterEditRes.status, 200);
  const statsMarchAfter = await statsMarchAfterEditRes.json();
  assert.equal(
    statsMarchAfter.summary.completedRefundAmount,
    150000,
    'Sửa ghi chú yêu cầu đổi trả (updated_at đổi sang tháng 04) KHÔNG được làm mất khoản hoàn tiền của ngày 2029-03-10'
  );
  assert.equal(
    statsMarchAfter.summary.netRevenue,
    350000,
    'Doanh thu thực ngày 2029-03-10 phải giữ nguyên 350.000₫ sau khi sửa ghi chú đổi trả'
  );

  // Và kiểm tra ngày 2029-04-20: KHÔNG bị cộng nhầm khoản hoàn tiền cũ
  const statsAprilAfterEditRes = await fetch(
    `${baseUrl}/api/admin/stats/overview?from=2029-04-20&to=2029-04-20&granularity=day`,
    { headers: { Cookie: adminCookie } }
  );
  assert.equal(statsAprilAfterEditRes.status, 200);
  const statsAprilAfter = await statsAprilAfterEditRes.json();
  assert.equal(
    statsAprilAfter.summary.completedRefundAmount,
    0,
    'Ngày cập nhật ghi chú 2029-04-20 tuyệt đối không được tính nhầm khoản hoàn tiền đã hoàn tất từ tháng 03'
  );
});

test('Stage 8d.7c: Kiểm tra riêng UTF-8 BOM (0xEF, 0xBB, 0xBF) ở đầu file CSV cho cả type=orders và type=products', async () => {
  const { resetCsvExportRateLimitForTest } = await import('../server/routes/adminStage8d.ts');
  resetCsvExportRateLimitForTest();

  for (const exportType of ['orders', 'products'] as const) {
    const res = await fetch(
      `${baseUrl}/api/admin/stats/export.csv?type=${exportType}&from=2028-05-10&to=2028-05-12`,
      { headers: { Cookie: adminCookie } }
    );
    assert.equal(res.status, 200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.ok(bytes.length >= 3, `CSV (${exportType}) phải có ít nhất 3 byte BOM`);
    assert.equal(bytes[0], 0xef, `CSV (${exportType}) byte[0] phải là 0xEF`);
    assert.equal(bytes[1], 0xbb, `CSV (${exportType}) byte[1] phải là 0xBB`);
    assert.equal(bytes[2], 0xbf, `CSV (${exportType}) byte[2] phải là 0xBF`);
  }
});

test('Stage 8d.7d: Kiểm tra riêng chống Formula Injection với type=orders (ô bắt đầu bằng =, +, -, @ được tiền tố bằng dấu nháy đơn \')', async () => {
  const { resetCsvExportRateLimitForTest } = await import('../server/routes/adminStage8d.ts');
  resetCsvExportRateLimitForTest();

  const formulaOrderId = '=CMD|" /C calc"!A0';
  await queryRows(sql`DELETE FROM orders WHERE id = ${formulaOrderId};`);
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status,
      created_at
    ) VALUES (
      ${formulaOrderId}, ${customerUserId}::uuid, 'Khách Formula Order', '0912345678', '123 Lê Lợi',
      '+EXPRESS_FORMULA', 30000, 200000, 0, 230000, 'pending',
      '2028-05-11T11:00:00.000Z'::timestamptz
    );
  `);

  const res = await fetch(
    `${baseUrl}/api/admin/stats/export.csv?type=orders&from=2028-05-10&to=2028-05-12`,
    { headers: { Cookie: adminCookie } }
  );
  assert.equal(res.status, 200);
  const csvText = await res.text();

  assert.equal(
    csvText.includes("'=CMD|\"\" /C calc\"\"!A0"),
    true,
    'Mã đơn hàng bắt đầu bằng dấu = trong CSV (type=orders) phải được tiền tố bằng dấu nháy đơn (\') và escape dấu nháy kép'
  );
  assert.equal(
    csvText.includes("'+EXPRESS_FORMULA"),
    true,
    'Phương thức vận chuyển bắt đầu bằng dấu + trong CSV (type=orders) phải được tiền tố bằng dấu nháy đơn (\')'
  );

  await queryRows(sql`DELETE FROM orders WHERE id = ${formulaOrderId};`);
});

test('Stage 8d.7e: Kiểm tra riêng giới hạn 50.000 dòng (MAX_CSV_EXPORT_ROWS = 50000) và cắt đúng số dòng tối đa khi xuất CSV', async () => {
  const {
    MAX_CSV_EXPORT_ROWS,
    resetCsvExportRateLimitForTest,
    setMaxCsvExportRowsForTest,
  } = await import('../server/routes/adminStage8d.ts');
  resetCsvExportRateLimitForTest();

  assert.equal(MAX_CSV_EXPORT_ROWS, 50000, 'Hằng số MAX_CSV_EXPORT_ROWS phải bằng đúng 50.000 dòng');

  // Kiểm tra header X-CSV-Max-Rows mặc định là 50000
  const defaultRes = await fetch(
    `${baseUrl}/api/admin/stats/export.csv?type=orders&from=2028-05-10&to=2028-05-12`,
    { headers: { Cookie: adminCookie } }
  );
  assert.equal(defaultRes.status, 200);
  assert.equal(defaultRes.headers.get('x-csv-max-rows'), '50000');

  // Đặt trần thử nghiệm = 2 dòng trong khi khoảng ngày 2028-05-10..2028-05-12 có >= 4 đơn hàng
  try {
    setMaxCsvExportRowsForTest(2);
    const cappedRes = await fetch(
      `${baseUrl}/api/admin/stats/export.csv?type=orders&from=2028-05-10&to=2028-05-12`,
      { headers: { Cookie: adminCookie } }
    );
    assert.equal(cappedRes.status, 200);
    assert.equal(cappedRes.headers.get('x-csv-row-count'), '2');
    const cappedText = (await cappedRes.text()).replace(/^\uFEFF/, '').trim();
    const rows = cappedText.split(/\r?\n/);
    // 1 dòng tiêu đề + tối đa 2 dòng dữ liệu = 3 dòng
    assert.equal(rows.length, 3, 'CSV phải cắt đúng theo giới hạn dòng (1 header + 2 dòng dữ liệu)');
  } finally {
    setMaxCsvExportRowsForTest(null);
  }
});

test('Stage 8d.7f: Kiểm tra riêng giới hạn tần suất (rate limit) xuất CSV trả 429 CSV_EXPORT_RATE_LIMIT khi vượt quá 10 lần/phút', async () => {
  const { resetCsvExportRateLimitForTest } = await import('../server/routes/adminStage8d.ts');
  resetCsvExportRateLimitForTest();

  for (let i = 0; i < 10; i++) {
    const okRes = await fetch(
      `${baseUrl}/api/admin/stats/export.csv?type=orders&from=2028-05-10&to=2028-05-12`,
      { headers: { Cookie: adminCookie } }
    );
    assert.equal(okRes.status, 200, `Lần xuất CSV thứ ${i + 1}/10 phải thành công 200`);
  }

  const rateLimitedRes = await fetch(
    `${baseUrl}/api/admin/stats/export.csv?type=orders&from=2028-05-10&to=2028-05-12`,
    { headers: { Cookie: adminCookie } }
  );
  assert.equal(rateLimitedRes.status, 429, 'Lần xuất CSV thứ 11 trong 1 phút phải bị chặn 429');
  const errBody = await rateLimitedRes.json();
  assert.equal(errBody.code, 'CSV_EXPORT_RATE_LIMIT');

  resetCsvExportRateLimitForTest();
});

// ============================================================================
// 8. GIAO DIỆN ADMIN GIAI ĐOẠN 8D RENDER SẠCH SẼ
// ============================================================================
test('Stage 8d.8: Các component giao diện Admin Giai đoạn 8d (OperationsOverviewPage, ReviewsAdminPage, StatsDashboardPage) render sạch không lỗi', async () => {
  const overviewHtml = renderToStaticMarkup(
    React.createElement(OperationsOverviewPage, {
      overview: {
        pendingConfirmationOrders: 3,
        awaitingVietQrOrders: 2,
        pendingReturnRequests: 1,
        unresolvedPaymentIssues: 1,
        lowStockVariants: 4,
        unrepliedReviews: 5,
        unrepliedChats: 2,
      },
      onRefresh: () => {},
      onNavigateWithFilter: () => {},
    })
  );
  assert.ok(overviewHtml.length > 0);

  const reviewsHtml = renderToStaticMarkup(React.createElement(ReviewsAdminPage));
  assert.ok(reviewsHtml.length > 0);

  const statsHtml = renderToStaticMarkup(React.createElement(StatsDashboardPage));
  assert.ok(statsHtml.length > 0);

  const chartHtml = renderToStaticMarkup(
    React.createElement(StatsRevenueChart, {
      granularity: 'day',
      series: [
        {
          bucketKey: '2026-05-10',
          placedOrderCount: 3,
          cancelledOrderCount: 0,
          deliveredOrderCount: 2,
          placedOrderValue: 950000,
          grossDeliveredRevenue: 650000,
          completedRefundAmount: 50000,
          netRevenue: 600000,
        },
      ],
    })
  );
  assert.ok(chartHtml.includes('Biểu đồ Doanh thu thực'));
});

