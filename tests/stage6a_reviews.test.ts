import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';

// Chạy trên PGlite in-memory cô lập
process.env.DATABASE_URL = '';
process.env.PGLITE_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-stage6a-reviews-key-2026-secure';

import { createApp } from '../server/app.ts';
import { initDatabase } from '../server/db/init.ts';
import { queryRows, closeDb } from '../server/db/index.ts';
import { resetUploadRateLimitForTest } from '../server/routes/api.ts';
import {
  SUPABASE_PUBLIC_BUCKET,
  getObjectFromLocalStorageForTest,
  removeObjectFromLocalStorageForTest,
  clearLocalStorageForTest,
} from '../server/services/upload.ts';
import {
  reviewsRouter,
  resetReviewRateLimit,
  maskReviewerName,
  isValidUserReviewImagePath,
  sendReviewRouteError,
  recordReviewRateLimit,
  getReviewRateLimitSizeForTest,
  pruneReviewRateLimitWithCapForTest,
} from '../server/routes/reviews.ts';
import { requireAdmin } from '../server/services/auth.ts';

let server: http.Server;
let baseUrl = '';

let buyerCookie = '';
let buyerId = '';

let nonBuyerCookie = '';
let nonBuyerId = '';

let adminCookie = '';
let adminId = '';

let testProductId = '';
let testProductSlug = '';
let testVariantId = '';
let secondProductId = '';

async function requestJson(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
  } = {}
) {
  const method = options.method || 'GET';
  const headers: Record<string, string> = {
    Origin: baseUrl,
    ...(options.headers || {}),
  };
  let bodyStr: string | undefined;
  if (options.body !== undefined) {
    bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: bodyStr,
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, setCookie, headers: res.headers };
}

/**
 * Tạo ảnh JPEG thật có gắn metadata EXIF (bao gồm tọa độ GPS và tên thiết bị) để kiểm thử
 */
async function createSampleJpegBufferWithExif(): Promise<Buffer> {
  return await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: { r: 45, g: 74, b: 62 },
    },
  })
    .withMetadata({
      exif: {
        IFD0: {
          Make: 'SecretCameraBrand',
          Model: 'GPSLoggerPro9000',
          Software: 'ExifSecretLocationTag',
        },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '10/1 46/1 36/1',
          GPSLongitudeRef: 'E',
          GPSLongitude: '106/1 42/1 3/1',
        },
      },
    })
    .jpeg({ quality: 90 })
    .toBuffer();
}

before(async () => {
  await initDatabase();
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

  // 1. Tạo tài khoản người mua hàng (buyer) có tên đầy đủ, email và số điện thoại
  const regBuyer = await requestJson('/api/auth/register', {
    method: 'POST',
    body: {
      fullName: 'Trần Hoàng Nam',
      email: 'buyer.review6a@baity.vn',
      phone: '0912345678',
      password: 'Password123!',
    },
  });
  assert.equal(regBuyer.status, 201);
  buyerCookie = regBuyer.setCookie.split(';')[0];
  buyerId = regBuyer.data.user.id;

  // 2. Tạo tài khoản người chưa mua hàng (nonBuyer)
  const regNonBuyer = await requestJson('/api/auth/register', {
    method: 'POST',
    body: {
      fullName: 'Lê Minh Khôi',
      email: 'nonbuyer.review6a@baity.vn',
      phone: '0987654321',
      password: 'Password123!',
    },
  });
  assert.equal(regNonBuyer.status, 201);
  nonBuyerCookie = regNonBuyer.setCookie.split(';')[0];
  nonBuyerId = regNonBuyer.data.user.id;

  // 3. Tạo tài khoản Admin
  const regAdmin = await requestJson('/api/auth/register', {
    method: 'POST',
    body: {
      fullName: 'Quản Trị Viên Baity',
      email: 'admin.review6a@baity.vn',
      phone: '0909998877',
      password: 'Password123!',
    },
  });
  assert.equal(regAdmin.status, 201);
  adminId = regAdmin.data.user.id;
  await queryRows(sql`UPDATE users SET role = 'admin' WHERE id = ${adminId}::uuid;`);

  const loginAdmin = await requestJson('/api/auth/login', {
    method: 'POST',
    body: {
      email: 'admin.review6a@baity.vn',
      password: 'Password123!',
    },
  });
  assert.equal(loginAdmin.status, 200);
  adminCookie = loginAdmin.setCookie.split(';')[0];

  // 4. Tạo danh mục, sản phẩm và biến thể để kiểm thử đánh giá
  const catRows = await queryRows<{ id: string }>(sql`
    INSERT INTO categories (name, slug, display_order)
    VALUES ('Áo Thun Nam', 'ao-thun-nam-6a', 1)
    RETURNING id;
  `);
  const categoryId = catRows[0].id;

  const createdProdRows = await queryRows<{ id: string; slug: string }>(sql`
    INSERT INTO products (
      name, slug, category_id, target_gender, description, material, care_instructions, base_price, search_text, is_active
    )
    VALUES (
      'Áo Thun Polo Baity Pima Cotton',
      'ao-thun-polo-baity-pima-cotton-6a',
      ${categoryId}::uuid,
      'men',
      'Áo thun polo cao cấp phục vụ kiểm thử đánh giá 6a',
      'Cotton Pima',
      'Giặt nhẹ',
      350000,
      'ao thun polo baity pima cotton 6a',
      true
    )
    RETURNING id, slug;
  `);
  testProductId = createdProdRows[0].id;
  testProductSlug = createdProdRows[0].slug;

  const secondProdRows = await queryRows<{ id: string }>(sql`
    INSERT INTO products (
      name, slug, category_id, target_gender, description, material, care_instructions, base_price, search_text, is_active
    )
    VALUES (
      'Áo Sơ Mi Linen Baity 6a',
      'ao-so-mi-linen-baity-6a',
      ${categoryId}::uuid,
      'men',
      'Áo sơ mi phụ phục vụ test không đổi sản phẩm',
      'Linen',
      'Giặt tay',
      420000,
      'ao so mi linen baity 6a',
      true
    )
    RETURNING id;
  `);
  secondProductId = secondProdRows[0].id;

  const createdVarRows = await queryRows<{ id: string }>(sql`
    INSERT INTO product_variants (
      product_id, sku, color_name, color_code, size, stock_quantity, price_override
    )
    VALUES (
      ${testProductId}::uuid,
      'SKU-6A-BLK-L',
      'Đen',
      '#000000',
      'L',
      50,
      NULL
    )
    RETURNING id;
  `);
  testVariantId = createdVarRows[0].id;
});

beforeEach(async () => {
  resetReviewRateLimit();
  resetUploadRateLimitForTest();
  clearLocalStorageForTest();
  await queryRows(sql`DELETE FROM review_images;`);
  await queryRows(sql`DELETE FROM reviews WHERE product_id = ${testProductId}::uuid;`);
  await queryRows(sql`DELETE FROM uploads;`);
  await queryRows(sql`
    DELETE FROM orders
    WHERE user_id IN (${buyerId}::uuid, ${nonBuyerId}::uuid);
  `);
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await closeDb();
});

async function createOrderWithStatus(params: {
  orderId: string;
  userId: string;
  variantId: string;
  status: string;
}) {
  const { orderId, userId, variantId, status } = params;
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      subtotal, shipping_fee, discount_amount, total_amount, status
    )
    VALUES (
      ${orderId}, ${userId}::uuid, 'Trần Hoàng Nam', '0912345678',
      '123 Nguyễn Huệ, Quận 1, TP.HCM', 350000, 30000, 0, 380000, ${status}
    );
  `);
  await queryRows(sql`
    INSERT INTO order_items (
      order_id, variant_id, product_name, color, size,
      unit_price, quantity, total_price
    )
    VALUES (
      ${orderId}, ${variantId}::uuid, 'Áo Thun Baity', 'Đen', 'L', 350000, 1, 350000
    );
  `);
}

// ============================================================================
// TEST 6a.1: Chỉ người đã mua sản phẩm đó trong đơn delivered hoặc completed mới được đánh giá
// ============================================================================
test('Step 6a.1: Chỉ người đã mua sản phẩm trong đơn delivered hoặc completed mới được đánh giá', async () => {
  const resNotPurchased = await requestJson('/api/reviews', {
    method: 'POST',
    headers: {
      Cookie: nonBuyerCookie,
    },
    body: {
      productId: testProductId,
      rating: 5,
      comment: 'Tôi chưa mua nhưng thử gửi đánh giá',
    },
  });
  assert.equal(resNotPurchased.status, 403);
  assert.equal(resNotPurchased.data.code, 'REVIEW_NOT_ELIGIBLE');

  for (const invalidStatus of ['pending', 'confirmed', 'shipping', 'cancelled']) {
    const orderId = `ORD-6A1-${invalidStatus.toUpperCase()}`;
    await createOrderWithStatus({
      orderId,
      userId: buyerId,
      variantId: testVariantId,
      status: invalidStatus,
    });

    const resInvalidStatus = await requestJson('/api/reviews', {
      method: 'POST',
      headers: {
        Cookie: buyerCookie,
      },
      body: {
        productId: testProductId,
        orderId,
        rating: 5,
        comment: `Thử đánh giá khi đơn đang ở trạng thái ${invalidStatus}`,
      },
    });
    assert.equal(
      resInvalidStatus.status,
      403,
      `Đơn ở trạng thái ${invalidStatus} không được phép đánh giá`
    );
    assert.equal(resInvalidStatus.data.code, 'REVIEW_ORDER_NOT_DELIVERED');
  }

  const deliveredOrderId = 'ORD-6A1-DELIVERED';
  await createOrderWithStatus({
    orderId: deliveredOrderId,
    userId: buyerId,
    variantId: testVariantId,
    status: 'delivered',
  });

  const resDelivered = await requestJson('/api/reviews', {
    method: 'POST',
    headers: {
      Cookie: buyerCookie,
    },
    body: {
      productId: testProductId,
      orderId: deliveredOrderId,
      rating: 5,
      comment: 'Sản phẩm giao nhanh, chất vải rất đẹp!',
    },
  });
  assert.equal(resDelivered.status, 201);
  assert.equal(resDelivered.data.review.orderId, deliveredOrderId);

  const completedOrderId = 'ORD-6A1-COMPLETED';
  await createOrderWithStatus({
    orderId: completedOrderId,
    userId: buyerId,
    variantId: testVariantId,
    status: 'completed',
  });

  const resCompleted = await requestJson('/api/reviews', {
    method: 'POST',
    headers: {
      Cookie: buyerCookie,
    },
    body: {
      productId: testProductId,
      orderId: completedOrderId,
      rating: 4,
      comment: 'Đơn hoàn tất, đóng gói cẩn thận.',
    },
  });
  assert.equal(resCompleted.status, 201);
  assert.equal(resCompleted.data.review.orderId, completedOrderId);
});

// ============================================================================
// TEST 6a.2: Mỗi (người dùng, sản phẩm, đơn) chỉ được tối đa 1 đánh giá (409 nếu trùng)
// ============================================================================
test('Step 6a.2: Mỗi (user_id, product_id, order_id) chỉ được tối đa 1 đánh giá', async () => {
  const orderId1 = 'ORD-6A2-FIRST';
  await createOrderWithStatus({
    orderId: orderId1,
    userId: buyerId,
    variantId: testVariantId,
    status: 'delivered',
  });

  const firstRes = await requestJson('/api/reviews', {
    method: 'POST',
    headers: {
      Cookie: buyerCookie,
    },
    body: {
      productId: testProductId,
      orderId: orderId1,
      rating: 5,
      comment: 'Đánh giá lần đầu cho đơn ORD-6A2-FIRST',
    },
  });
  assert.equal(firstRes.status, 201);

  const dupWithOrderId = await requestJson('/api/reviews', {
    method: 'POST',
    headers: {
      Cookie: buyerCookie,
    },
    body: {
      productId: testProductId,
      orderId: orderId1,
      rating: 4,
      comment: 'Thử gửi đánh giá trùng cho cùng đơn hàng',
    },
  });
  assert.equal(dupWithOrderId.status, 409);
  assert.equal(dupWithOrderId.data.code, 'REVIEW_ALREADY_EXISTS');

  const dupWithoutOrderId = await requestJson('/api/reviews', {
    method: 'POST',
    headers: {
      Cookie: buyerCookie,
    },
    body: {
      productId: testProductId,
      rating: 3,
      comment: 'Thử gửi tiếp khi không còn đơn nào chưa đánh giá',
    },
  });
  assert.equal(dupWithoutOrderId.status, 409);
  assert.equal(dupWithoutOrderId.data.code, 'REVIEW_ALREADY_EXISTS');

  const countRows = await queryRows<{ cnt: number }>(sql`
    SELECT COUNT(*)::int AS cnt
    FROM reviews
    WHERE user_id = ${buyerId}::uuid
      AND product_id = ${testProductId}::uuid
      AND order_id = ${orderId1};
  `);
  assert.equal(countRows[0].cnt, 1);
});

// ============================================================================
// TEST 6a.3: Nội dung văn bản thuần (không render HTML) và kiểm tra đầu vào bằng Zod
// ============================================================================
test('Step 6a.3: Nội dung lưu & trả dạng văn bản thuần và kiểm tra chặt rating/comment bằng Zod', async () => {
  const orderId = 'ORD-6A3-PLAINTEXT';
  await createOrderWithStatus({
    orderId,
    userId: buyerId,
    variantId: testVariantId,
    status: 'completed',
  });

  const badRatingRes = await requestJson('/api/reviews', {
    method: 'POST',
    headers: {
      Cookie: buyerCookie,
    },
    body: {
      productId: testProductId,
      orderId,
      rating: 6,
      comment: 'Số sao vượt quá 5',
    },
  });
  assert.equal(badRatingRes.status, 400);
  assert.equal(badRatingRes.data.code, 'INVALID_REVIEW_INPUT');

  const shortCommentRes = await requestJson('/api/reviews', {
    method: 'POST',
    headers: {
      Cookie: buyerCookie,
    },
    body: {
      productId: testProductId,
      orderId,
      rating: 5,
      comment: 'A',
    },
  });
  assert.equal(shortCommentRes.status, 400);
  assert.equal(shortCommentRes.data.code, 'INVALID_REVIEW_INPUT');

  const rawHtmlComment = '<script>alert("xss")</script><b>Áo rất đẹp & bền</b>';
  const createRes = await requestJson('/api/reviews', {
    method: 'POST',
    headers: {
      Cookie: buyerCookie,
    },
    body: {
      productId: testProductId,
      orderId,
      rating: 5,
      comment: rawHtmlComment,
    },
  });
  assert.equal(createRes.status, 201);
  assert.equal(createRes.data.review.comment, rawHtmlComment);
});

// ============================================================================
// TEST 6a.4 (Mục 7a): Đường dẫn ảnh đánh giá trong bucket công khai KHÔNG chứa userId;
// kiểm tra quyền sở hữu qua bảng `uploads`, giới hạn tối đa 3 ảnh
// ============================================================================
test('Step 6a.4 (Mục 7a): Đường dẫn ảnh đánh giá trong bucket công khai KHÔNG chứa userId; xác minh quyền sở hữu qua bảng uploads và giới hạn tối đa 3 ảnh', async () => {
  const orderId = 'ORD-6A4-UPLOADS';
  await createOrderWithStatus({
    orderId,
    userId: buyerId,
    variantId: testVariantId,
    status: 'delivered',
  });

  // 1. Kiểm tra helper isValidUserReviewImagePath: từ chối mọi path có chứa userId hoặc traversal
  assert.equal(isValidUserReviewImagePath(`reviews/a1b2c3d4e5f60718/anh_1.jpg`, buyerId), true);
  assert.equal(
    isValidUserReviewImagePath(`${buyerId}/review/anh_1.jpg`, buyerId),
    false,
    'Path chứa userId trong bucket công khai phải bị từ chối'
  );
  assert.equal(
    isValidUserReviewImagePath(`reviews/${buyerId}/anh_1.jpg`, buyerId),
    false,
    'Path chứa userId ở bất kỳ vị trí nào phải bị từ chối'
  );
  assert.equal(isValidUserReviewImagePath(`reviews/a1b2c3d4e5f60718/../secret.jpg`, buyerId), false);
  assert.equal(isValidUserReviewImagePath(`https://evil.example.com/anh.jpg`, buyerId), false);

  // 2. Tải ảnh đánh giá lên qua POST /api/upload cho buyer và nonBuyer
  const jpegBuf = await createSampleJpegBufferWithExif();
  const dataUrl = `data:image/jpeg;base64,${jpegBuf.toString('base64')}`;

  const buyerUpload1 = await requestJson('/api/upload', {
    method: 'POST',
    headers: { Cookie: buyerCookie },
    body: { image: dataUrl, purpose: 'review' },
  });
  assert.equal(buyerUpload1.status, 200);
  const buyerPath1 = buyerUpload1.data.path as string;

  // Xác nhận đường dẫn sinh ra KHÔNG chứa buyerId và có dạng reviews/<16-hex>/<uuid>.jpg
  assert.ok(
    !buyerPath1.toLowerCase().includes(buyerId.toLowerCase()),
    `Đường dẫn lưu trong bucket công khai (${buyerPath1}) tuyệt đối KHÔNG được chứa userId`
  );
  assert.match(buyerPath1, /^reviews\/[a-f0-9]{16}\/[a-f0-9-]+\.jpg$/i);

  // Tải ảnh của người dùng khác (nonBuyer)
  const nonBuyerUpload = await requestJson('/api/upload', {
    method: 'POST',
    headers: { Cookie: nonBuyerCookie },
    body: { image: dataUrl, purpose: 'review' },
  });
  assert.equal(nonBuyerUpload.status, 200);
  const nonBuyerPath = nonBuyerUpload.data.path as string;

  // 3. Buyer cố dùng ảnh thuộc sở hữu của nonBuyer (kiểm tra bằng bảng uploads) -> bị chặn 403 FORBIDDEN_REVIEW_IMAGE_OWNER
  const stolenImgRes = await requestJson('/api/reviews', {
    method: 'POST',
    headers: { Cookie: buyerCookie },
    body: {
      productId: testProductId,
      orderId,
      rating: 5,
      comment: 'Thử dùng ảnh đánh giá của người dùng khác trong bảng uploads',
      imageUrls: [nonBuyerPath],
    },
  });
  assert.equal(stolenImgRes.status, 403);
  assert.equal(stolenImgRes.data.code, 'FORBIDDEN_REVIEW_IMAGE_OWNER');

  // 4. Gửi quá 3 ảnh -> bị chặn 400 INVALID_REVIEW_INPUT (giới hạn tối đa 3 ảnh)
  const tooManyImagesRes = await requestJson('/api/reviews', {
    method: 'POST',
    headers: { Cookie: buyerCookie },
    body: {
      productId: testProductId,
      orderId,
      rating: 5,
      comment: 'Thử gửi 4 hình ảnh vượt quá giới hạn tối đa 3 ảnh',
      imageUrls: [buyerPath1, buyerPath1, buyerPath1, buyerPath1],
    },
  });
  assert.equal(tooManyImagesRes.status, 400);
  assert.equal(tooManyImagesRes.data.code, 'INVALID_REVIEW_INPUT');

  // 5. Gửi đánh giá với ảnh chính chủ hợp lệ (<= 3 ảnh) -> thành công 201
  const validReviewRes = await requestJson('/api/reviews', {
    method: 'POST',
    headers: { Cookie: buyerCookie },
    body: {
      productId: testProductId,
      orderId,
      rating: 5,
      comment: 'Hình ảnh thực tế sản phẩm rất đẹp!',
      imageUrls: [buyerPath1],
    },
  });
  assert.equal(validReviewRes.status, 201);
  assert.deepEqual(validReviewRes.data.review.images, [buyerPath1]);
});

// ============================================================================
// TEST 6a.5: Tên người đánh giá rút gọn, không lộ email, số điện thoại hay userId
// ============================================================================
test('Step 6a.5: Tên người đánh giá được rút gọn (maskReviewerName), không lộ email hay số điện thoại', async () => {
  assert.equal(maskReviewerName('Trần Hoàng Nam'), 'Trần *** Nam');
  assert.equal(maskReviewerName('Nguyễn An'), 'Nguyễn A***');
  assert.equal(maskReviewerName('buyer.review6a@baity.vn'), 'bu***');
  assert.ok(!maskReviewerName('Khách 0912345678').includes('0912345678'));

  const orderId = 'ORD-6A5-PRIVACY';
  await createOrderWithStatus({
    orderId,
    userId: buyerId,
    variantId: testVariantId,
    status: 'delivered',
  });

  const postRes = await requestJson('/api/reviews', {
    method: 'POST',
    headers: {
      Cookie: buyerCookie,
    },
    body: {
      productId: testProductId,
      orderId,
      rating: 5,
      comment: 'Kiểm tra ẩn thông tin cá nhân người đánh giá.',
    },
  });
  assert.equal(postRes.status, 201);
  assert.equal(postRes.data.review.userName, 'Trần *** Nam');
  assert.equal('email' in postRes.data.review, false);
  assert.equal('phone' in postRes.data.review, false);
  assert.equal('userId' in postRes.data.review, false);

  const getReviewsRes = await requestJson(`/api/products/${testProductSlug}/reviews`);
  assert.equal(getReviewsRes.status, 200);
  const revItem = getReviewsRes.data.items[0];
  assert.equal(revItem.userName, 'Trần *** Nam');
  const serializedReviews = JSON.stringify(getReviewsRes.data.items);
  assert.ok(!serializedReviews.includes('buyer.review6a@baity.vn'), 'Không được lộ email');
  assert.ok(!serializedReviews.includes('0912345678'), 'Không được lộ số điện thoại');
  assert.ok(!serializedReviews.includes('Trần Hoàng Nam'), 'Không được lộ họ tên đầy đủ');
  assert.ok(!serializedReviews.includes(buyerId), 'Không được lộ userId của người đánh giá');
});

// ============================================================================
// TEST 6a.6: Rate limit gửi đánh giá & giới hạn kích thước Map trong RAM
// ============================================================================
test('Step 6a.6: Rate limit chặn 429 khi gửi vượt 5 đánh giá/10 phút và giới hạn kích thước bộ đếm trong RAM', async () => {
  for (let i = 1; i <= 6; i++) {
    await createOrderWithStatus({
      orderId: `ORD-6A6-RATE-${i}`,
      userId: buyerId,
      variantId: testVariantId,
      status: 'delivered',
    });
  }

  for (let i = 1; i <= 5; i++) {
    const res = await requestJson('/api/reviews', {
      method: 'POST',
      headers: {
        Cookie: buyerCookie,
      },
      body: {
        productId: testProductId,
        orderId: `ORD-6A6-RATE-${i}`,
        rating: 5,
        comment: `Đánh giá hợp lệ lần thứ ${i}`,
      },
    });
    assert.equal(res.status, 201, `Lần gửi thứ ${i} phải thành công`);
  }

  const sixthRes = await requestJson('/api/reviews', {
    method: 'POST',
    headers: {
      Cookie: buyerCookie,
    },
    body: {
      productId: testProductId,
      orderId: 'ORD-6A6-RATE-6',
      rating: 5,
      comment: 'Đánh giá lần thứ 6 vượt giới hạn tốc độ',
    },
  });
  assert.equal(sixthRes.status, 429);
  assert.equal(sixthRes.data.code, 'REVIEW_RATE_LIMIT_EXCEEDED');

  resetReviewRateLimit();
  for (let i = 0; i < 60; i++) {
    recordReviewRateLimit(`test-rate-key-${i}`);
  }
  assert.equal(getReviewRateLimitSizeForTest(), 60);
  pruneReviewRateLimitWithCapForTest(25);
  assert.equal(getReviewRateLimitSizeForTest(), 25);
});

// ============================================================================
// TEST 6a.7: Lỗi 500 không lộ chi tiết SQL/err.message
// ============================================================================
test('Step 6a.7: Lỗi 500 tại reviews không lộ chi tiết SQL hay thông báo lỗi nội bộ', async () => {
  let capturedStatus = 0;
  let capturedBody: any = null;
  const mockRes: any = {
    status(code: number) {
      capturedStatus = code;
      return this;
    },
    json(payload: any) {
      capturedBody = payload;
      return this;
    },
  };

  const rawSqlError = new Error(
    'relation "reviews_partition_secret_2026" does not exist at character 42'
  );
  sendReviewRouteError(mockRes, rawSqlError, 'Đã xảy ra lỗi hệ thống khi xử lý đánh giá sản phẩm');

  assert.equal(capturedStatus, 500);
  assert.equal(capturedBody.code, 'INTERNAL_SERVER_ERROR');
  assert.equal(capturedBody.message, 'Đã xảy ra lỗi hệ thống khi xử lý đánh giá sản phẩm');
  assert.ok(
    !JSON.stringify(capturedBody).includes('reviews_partition_secret_2026'),
    'Tuyệt đối không lộ chi tiết SQL trong phản hồi lỗi 500'
  );
});

// ============================================================================
// TEST 6a.8 (Mục 6a): PUT /api/reviews/:id và DELETE /api/reviews/:id
// Chỉ chủ đánh giá mới được sửa/xóa (Admin xóa ở Giai đoạn 8); sửa không đổi đơn hay sản phẩm
// ============================================================================
test('Step 6a.8 (Mục 6a): PUT /api/reviews/:id và DELETE /api/reviews/:id chỉ cho phép chủ đánh giá (kể cả Admin cũng nhận 403 ở 6a); sửa không được đổi đơn hay sản phẩm', async () => {
  const orderId = 'ORD-6A8-OWNER';
  await createOrderWithStatus({
    orderId,
    userId: buyerId,
    variantId: testVariantId,
    status: 'delivered',
  });

  const createRes = await requestJson('/api/reviews', {
    method: 'POST',
    headers: { Cookie: buyerCookie },
    body: {
      productId: testProductId,
      orderId,
      rating: 4,
      comment: 'Nhận xét ban đầu 4 sao',
    },
  });
  assert.equal(createRes.status, 201);
  const reviewId = createRes.data.review.id;

  // 1. Người dùng khác (nonBuyer) gọi PUT /api/reviews/:id -> 403 FORBIDDEN_NOT_REVIEW_OWNER
  const otherEditRes = await requestJson(`/api/reviews/${reviewId}`, {
    method: 'PUT',
    headers: { Cookie: nonBuyerCookie },
    body: { rating: 1, comment: 'Người khác cố tình sửa đánh giá' },
  });
  assert.equal(otherEditRes.status, 403);
  assert.equal(otherEditRes.data.code, 'FORBIDDEN_NOT_REVIEW_OWNER');

  // 2. Chủ đánh giá cố tình đổi productId hoặc orderId khi sửa -> bị từ chối 400 CANNOT_CHANGE_REVIEW_TARGET
  const changeProductRes = await requestJson(`/api/reviews/${reviewId}`, {
    method: 'PUT',
    headers: { Cookie: buyerCookie },
    body: {
      productId: secondProductId,
      rating: 5,
      comment: 'Thử đổi sản phẩm của đánh giá',
    },
  });
  assert.equal(changeProductRes.status, 400);
  assert.equal(changeProductRes.data.code, 'CANNOT_CHANGE_REVIEW_TARGET');

  const changeOrderRes = await requestJson(`/api/reviews/${reviewId}`, {
    method: 'PUT',
    headers: { Cookie: buyerCookie },
    body: {
      orderId: 'ORD-OTHER-999',
      rating: 5,
      comment: 'Thử đổi mã đơn hàng của đánh giá',
    },
  });
  assert.equal(changeOrderRes.status, 400);
  assert.equal(changeOrderRes.data.code, 'CANNOT_CHANGE_REVIEW_TARGET');

  // 3. Chủ đánh giá sửa số sao và nội dung hợp lệ -> 200 OK, giữ nguyên productId và orderId
  const ownerEditRes = await requestJson(`/api/reviews/${reviewId}`, {
    method: 'PUT',
    headers: { Cookie: buyerCookie },
    body: {
      rating: 5,
      comment: 'Đã cập nhật lên 5 sao sau 1 tuần mặc thử!',
    },
  });
  assert.equal(ownerEditRes.status, 200);
  assert.equal(ownerEditRes.data.review.rating, 5);
  assert.equal(ownerEditRes.data.review.comment, 'Đã cập nhật lên 5 sao sau 1 tuần mặc thử!');
  assert.equal(ownerEditRes.data.review.productId, testProductId);
  assert.equal(ownerEditRes.data.review.orderId, orderId);

  // 4. Người khác (nonBuyer) và Admin gọi DELETE /api/reviews/:id ở Giai đoạn 6a -> đều nhận 403 FORBIDDEN_NOT_REVIEW_OWNER
  const otherDelRes = await requestJson(`/api/reviews/${reviewId}`, {
    method: 'DELETE',
    headers: { Cookie: nonBuyerCookie },
  });
  assert.equal(otherDelRes.status, 403);
  assert.equal(otherDelRes.data.code, 'FORBIDDEN_NOT_REVIEW_OWNER');

  const adminDelRes = await requestJson(`/api/reviews/${reviewId}`, {
    method: 'DELETE',
    headers: { Cookie: adminCookie },
  });
  assert.equal(adminDelRes.status, 403, 'Ở Giai đoạn 6a, DELETE /api/reviews/:id chỉ cho phép chủ đánh giá (Admin xóa ở Giai đoạn 8)');
  assert.equal(adminDelRes.data.code, 'FORBIDDEN_NOT_REVIEW_OWNER');

  // 5. Chủ đánh giá xóa đánh giá của chính mình -> 200 OK
  const ownerDelRes = await requestJson(`/api/reviews/${reviewId}`, {
    method: 'DELETE',
    headers: { Cookie: buyerCookie },
  });
  assert.equal(ownerDelRes.status, 200);
  assert.equal(ownerDelRes.data.deletedId, reviewId);
});

// ============================================================================
// TEST 6a.9 (Mục 6b): GET /api/products/:slug/reviews
// Phân trang, lọc theo số sao, sắp xếp (mới nhất, sao cao, sao thấp),
// trả điểm trung bình, tổng số đánh giá, phân bố từng sao, cờ "Đã mua hàng", phản hồi người bán
// ============================================================================
test('Step 6a.9 (Mục 6b): GET /api/products/:slug/reviews hỗ trợ phân trang, lọc theo sao, sắp xếp (newest, rating_desc, rating_asc), trả điểm TB, tổng đánh giá, phân bố sao, cờ Đã mua hàng và phản hồi người bán', async () => {
  const ratings = [2, 5, 4];
  const createdIds: string[] = [];

  for (let i = 0; i < ratings.length; i++) {
    const ordId = `ORD-6A9-${i + 1}`;
    await createOrderWithStatus({
      orderId: ordId,
      userId: buyerId,
      variantId: testVariantId,
      status: 'delivered',
    });
    const res = await requestJson('/api/reviews', {
      method: 'POST',
      headers: { Cookie: buyerCookie },
      body: {
        productId: testProductId,
        orderId: ordId,
        rating: ratings[i],
        comment: `Nhận xét thứ ${i + 1} với ${ratings[i]} sao`,
      },
    });
    assert.equal(res.status, 201);
    createdIds.push(res.data.review.id);
  }

  // Admin phản hồi vào đánh giá 5 sao
  await requestJson(`/api/reviews/${createdIds[1]}/reply`, {
    method: 'PUT',
    headers: { Cookie: adminCookie },
    body: { sellerReply: 'Cảm ơn quý khách đã đánh giá 5 sao!' },
  });

  // 1. Lấy danh sách phân trang (page=1, pageSize=2, sort=rating_desc)
  const descRes = await requestJson(
    `/api/products/${testProductSlug}/reviews?page=1&pageSize=2&sort=rating_desc`
  );
  assert.equal(descRes.status, 200);
  assert.equal(descRes.data.reviewCount, 3);
  assert.equal(descRes.data.ratingAvg, 3.7); // (2 + 5 + 4) / 3 = 3.666... -> 3.7
  assert.deepEqual(descRes.data.ratingBreakdown, { 1: 0, 2: 1, 3: 0, 4: 1, 5: 1 });
  assert.equal(descRes.data.page, 1);
  assert.equal(descRes.data.pageSize, 2);
  assert.equal(descRes.data.total, 3);
  assert.equal(descRes.data.totalPages, 2);
  assert.equal(descRes.data.items.length, 2);
  assert.equal(descRes.data.items[0].rating, 5);
  assert.equal(descRes.data.items[1].rating, 4);
  assert.equal(descRes.data.items[0].verifiedPurchase, true);
  assert.equal(descRes.data.items[0].verifiedPurchaseLabel, 'Đã mua hàng');
  assert.equal(descRes.data.items[0].sellerReply, 'Cảm ơn quý khách đã đánh giá 5 sao!');

  // 2. Sắp xếp sao thấp nhất trước (sort=rating_asc)
  const ascRes = await requestJson(
    `/api/products/${testProductSlug}/reviews?page=1&pageSize=3&sort=rating_asc`
  );
  assert.equal(ascRes.status, 200);
  assert.deepEqual(
    ascRes.data.items.map((r: any) => r.rating),
    [2, 4, 5]
  );

  // 3. Lọc theo số sao (rating=4)
  const filter4Res = await requestJson(`/api/products/${testProductSlug}/reviews?rating=4`);
  assert.equal(filter4Res.status, 200);
  assert.equal(filter4Res.data.items.length, 1);
  assert.equal(filter4Res.data.items[0].rating, 4);
  assert.equal(filter4Res.data.reviewCount, 3, 'reviewCount tổng của sản phẩm vẫn giữ nguyên là 3');
});

// ============================================================================
// TEST 6a.10 (Mục 7b): Kiểm tra file thật sự tồn tại trong Storage & Server tái mã hóa xóa EXIF/GPS
// ============================================================================
test('Step 6a.10 (Mục 7b): Server tái mã hóa ảnh bằng sharp xóa sạch metadata EXIF/GPS và kiểm tra file thật sự tồn tại trong Storage trước khi lưu đánh giá', async () => {
  const orderId = 'ORD-6A10-EXIF-STORAGE';
  await createOrderWithStatus({
    orderId,
    userId: buyerId,
    variantId: testVariantId,
    status: 'delivered',
  });

  // 1. Tạo ảnh JPEG có chứa thẻ EXIF nhạy cảm (Make: SecretCameraBrand, Model: GPSLoggerPro9000, GPSLatitude, GPSLongitude)
  const rawJpegWithExif = await createSampleJpegBufferWithExif();
  assert.ok(
    rawJpegWithExif.includes(Buffer.from('SecretCameraBrand')) ||
      rawJpegWithExif.includes(Buffer.from('Exif')),
    'Buffer ảnh gốc trước khi upload phải chứa thẻ EXIF'
  );

  const uploadRes = await requestJson('/api/upload', {
    method: 'POST',
    headers: { Cookie: buyerCookie },
    body: {
      image: `data:image/jpeg;base64,${rawJpegWithExif.toString('base64')}`,
      purpose: 'review',
    },
  });
  assert.equal(uploadRes.status, 200);
  assert.equal(uploadRes.data.exifStripped, true);
  const uploadedPath = uploadRes.data.path as string;

  // Kiểm tra buffer đã lưu trong Storage sau khi server tái mã hóa bằng sharp:
  // Mọi thông tin EXIF/GPS nhạy cảm phải bị xóa hoàn toàn
  const storedObj = getObjectFromLocalStorageForTest(SUPABASE_PUBLIC_BUCKET, uploadedPath);
  assert.ok(storedObj, 'File ảnh phải tồn tại trong Storage sau khi tải lên');
  assert.equal(
    storedObj.buffer.includes(Buffer.from('SecretCameraBrand')),
    false,
    'Metadata EXIF (Make: SecretCameraBrand) phải bị xóa hoàn toàn sau khi tái mã hóa'
  );
  assert.equal(
    storedObj.buffer.includes(Buffer.from('GPSLoggerPro9000')),
    false,
    'Metadata EXIF (Model: GPSLoggerPro9000) phải bị xóa hoàn toàn'
  );
  const metadataAfter = await sharp(storedObj.buffer).metadata();
  assert.equal(metadataAfter.exif, undefined, 'Ảnh sau khi tái mã hóa không còn trường exif');

  // 2. Giả lập file bị xóa khỏi Storage (dù vẫn còn bản ghi trong bảng uploads) -> POST /api/reviews phải từ chối 400 REVIEW_IMAGE_NOT_IN_STORAGE
  removeObjectFromLocalStorageForTest(SUPABASE_PUBLIC_BUCKET, uploadedPath);

  const missingStorageRes = await requestJson('/api/reviews', {
    method: 'POST',
    headers: { Cookie: buyerCookie },
    body: {
      productId: testProductId,
      orderId,
      rating: 5,
      comment: 'Thử gửi đánh giá khi file ảnh không thật sự tồn tại trong Storage',
      imageUrls: [uploadedPath],
    },
  });
  assert.equal(missingStorageRes.status, 400);
  assert.equal(missingStorageRes.data.code, 'REVIEW_IMAGE_NOT_IN_STORAGE');
});

// ============================================================================
// TEST 6a.11 (Mục 8): PUT /api/reviews/:id/reply dùng middleware requireAdmin ở tầng router;
// nội dung văn bản thuần tối đa 1000 ký tự
// ============================================================================
test('Step 6a.11 (Mục 8): PUT /api/reviews/:id/reply dùng middleware requireAdmin ở tầng router; chỉ nhận văn bản thuần tối đa 1000 ký tự', async () => {
  // 1. Xác nhận tầng router của reviewsRouter gắn trực tiếp middleware requireAdmin cho PUT /:id/reply
  const replyLayer = (reviewsRouter as any).stack.find(
    (layer: any) => layer.route && layer.route.path === '/:id/reply'
  );
  assert.ok(replyLayer, 'Route /:id/reply phải tồn tại trong reviewsRouter');
  const replyMiddlewares = replyLayer.route.stack.map((s: any) => s.handle);
  assert.ok(
    replyMiddlewares.includes(requireAdmin),
    'Route PUT /api/reviews/:id/reply bắt buộc phải gắn middleware requireAdmin ở tầng router'
  );

  const orderId = 'ORD-6A11-REPLY';
  await createOrderWithStatus({
    orderId,
    userId: buyerId,
    variantId: testVariantId,
    status: 'delivered',
  });

  const createRes = await requestJson('/api/reviews', {
    method: 'POST',
    headers: { Cookie: buyerCookie },
    body: {
      productId: testProductId,
      orderId,
      rating: 5,
      comment: 'Áo rất vừa vặn và thoáng mát.',
    },
  });
  assert.equal(createRes.status, 201);
  const reviewId = createRes.data.review.id;

  // 2. Chưa đăng nhập -> 401
  const unauthReplyRes = await requestJson(`/api/reviews/${reviewId}/reply`, {
    method: 'PUT',
    body: { sellerReply: 'Phản hồi không có token' },
  });
  assert.equal(unauthReplyRes.status, 401);

  // 3. Khách hàng gọi -> 403 từ middleware requireAdmin
  const customerReplyRes = await requestJson(`/api/reviews/${reviewId}/reply`, {
    method: 'PUT',
    headers: { Cookie: buyerCookie },
    body: { sellerReply: 'Khách tự phản hồi' },
  });
  assert.equal(customerReplyRes.status, 403);

  // 4. Admin gửi nội dung vượt quá 1000 ký tự -> 400 INVALID_REPLY_INPUT
  const tooLongReplyRes = await requestJson(`/api/reviews/${reviewId}/reply`, {
    method: 'PUT',
    headers: { Cookie: adminCookie },
    body: { sellerReply: 'R'.repeat(1001) },
  });
  assert.equal(tooLongReplyRes.status, 400);
  assert.equal(tooLongReplyRes.data.code, 'INVALID_REPLY_INPUT');

  // 5. Admin gửi nội dung văn bản thuần hợp lệ (<= 1000 ký tự) -> 200 OK
  const validReplyText = 'Baity Fashion cảm ơn bạn đã tin tưởng và ủng hộ sản phẩm!';
  const adminReplyRes = await requestJson(`/api/reviews/${reviewId}/reply`, {
    method: 'PUT',
    headers: { Cookie: adminCookie },
    body: { sellerReply: validReplyText },
  });
  assert.equal(adminReplyRes.status, 200);
  assert.equal(adminReplyRes.data.review.sellerReply, validReplyText);
  assert.ok(adminReplyRes.data.review.sellerRepliedAt);
});

// ============================================================================
// TEST 6a.12 (Mục 5 & Mục 6): Đối chiếu ratingAvg & reviewCount trên GET /api/products/:slug
// và GET /api/products/:slug/reviews với SQL tính trực tiếp sau khi THÊM, SỬA, XÓA đánh giá;
// đồng thời xác nhận tách khối đánh giá sang src/components/product/ReviewSection.tsx
// ============================================================================
test('Step 6a.12 (Mục 5 & 6): Đối chiếu ratingAvg và reviewCount sau khi thêm, sửa, xóa đánh giá khớp tuyệt đối với SQL; giao diện tách riêng ReviewSection.tsx', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');

  // 1. Xác nhận khối đánh giá đã tách sang src/components/product/ReviewSection.tsx và ProductDetailView.tsx chỉ nhúng ReviewSection
  const reviewSectionPath = path.resolve(process.cwd(), 'src/components/product/ReviewSection.tsx');
  const productDetailPath = path.resolve(process.cwd(), 'src/components/product/ProductDetailView.tsx');
  assert.equal(fs.existsSync(reviewSectionPath), true, 'File ReviewSection.tsx phải tồn tại');
  const detailSrc = fs.readFileSync(productDetailPath, 'utf-8');
  assert.ok(
    detailSrc.includes('<ReviewSection product={product} currentUser={currentUser} />'),
    'ProductDetailView.tsx phải nhúng trực tiếp <ReviewSection />'
  );
  assert.equal(
    detailSrc.includes('handleSubmitReview'),
    false,
    'Logic form đánh giá phải nằm trong ReviewSection.tsx, không còn nằm trong ProductDetailView.tsx'
  );

  // 2. Đối chiếu ratingAvg & reviewCount sau khi THÊM 2 đánh giá (5 sao và 2 sao -> TB = 3.5, count = 2)
  const ordA = 'ORD-6A12-A';
  const ordB = 'ORD-6A12-B';
  await createOrderWithStatus({ orderId: ordA, userId: buyerId, variantId: testVariantId, status: 'delivered' });
  await createOrderWithStatus({ orderId: ordB, userId: buyerId, variantId: testVariantId, status: 'completed' });

  const revARes = await requestJson('/api/reviews', {
    method: 'POST',
    headers: { Cookie: buyerCookie },
    body: { productId: testProductId, orderId: ordA, rating: 5, comment: 'Đánh giá A 5 sao' },
  });
  const revBRes = await requestJson('/api/reviews', {
    method: 'POST',
    headers: { Cookie: buyerCookie },
    body: { productId: testProductId, orderId: ordB, rating: 2, comment: 'Đánh giá B 2 sao' },
  });
  assert.equal(revARes.status, 201);
  assert.equal(revBRes.status, 201);
  const revBId = revBRes.data.review.id;

  const verifyMetricsMatchSql = async (expectedAvg: number, expectedCount: number) => {
    const sqlAgg = await queryRows<{ avg_val: number; cnt_val: number }>(sql`
      SELECT
        COALESCE(ROUND(AVG(rating)::numeric, 1)::float, 0)::float AS avg_val,
        COUNT(id)::int AS cnt_val
      FROM reviews
      WHERE product_id = ${testProductId}::uuid;
    `);
    assert.equal(sqlAgg[0].avg_val, expectedAvg);
    assert.equal(sqlAgg[0].cnt_val, expectedCount);

    const [detailRes, reviewsRes] = await Promise.all([
      requestJson(`/api/products/${testProductSlug}`),
      requestJson(`/api/products/${testProductSlug}/reviews`),
    ]);
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.data.data.ratingAvg, expectedAvg);
    assert.equal(detailRes.data.data.reviewCount, expectedCount);
    assert.equal(reviewsRes.status, 200);
    assert.equal(reviewsRes.data.ratingAvg, expectedAvg);
    assert.equal(reviewsRes.data.reviewCount, expectedCount);
  };

  await verifyMetricsMatchSql(3.5, 2);

  // 3. Sau khi SỬA đánh giá B từ 2 sao lên 4 sao -> TB = (5 + 4)/2 = 4.5, count = 2
  const editBRes = await requestJson(`/api/reviews/${revBId}`, {
    method: 'PUT',
    headers: { Cookie: buyerCookie },
    body: { rating: 4, comment: 'Đánh giá B sửa thành 4 sao' },
  });
  assert.equal(editBRes.status, 200);
  await verifyMetricsMatchSql(4.5, 2);

  // 4. Sau khi XÓA đánh giá B -> còn lại đánh giá A (5 sao) -> TB = 5.0, count = 1
  const delBRes = await requestJson(`/api/reviews/${revBId}`, {
    method: 'DELETE',
    headers: { Cookie: buyerCookie },
  });
  assert.equal(delBRes.status, 200);
  await verifyMetricsMatchSql(5, 1);
});

