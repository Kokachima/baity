import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';

// Chạy trên PGlite in-memory cô lập
process.env.DATABASE_URL = '';
process.env.PGLITE_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.COOKIE_CROSS_SITE = 'false';
process.env.JWT_SECRET = 'test-secret-stage8b-catalog-inventory-key-2026-secure';

import { createApp } from '../server/app.ts';
import { initDatabase } from '../server/db/init.ts';
import { queryRows, withTransaction, closeDb } from '../server/db/index.ts';
import { seedDatabase } from '../server/db/seed.ts';
import { generateToken, AUTH_COOKIE_NAME } from '../server/services/auth.ts';
import { resetUploadRateLimitForTest } from '../server/routes/api.ts';

let server: http.Server;
let baseUrl = '';
let adminId = '';
let adminToken = '';
let customerId = '';
let customerToken = '';
let uploadedProductImagePath1 = '';
let uploadedProductImagePath2 = '';

const STAGE_8B_ENDPOINTS: { method: string; path: string }[] = [
  { method: 'GET', path: '/api/admin/categories' },
  { method: 'POST', path: '/api/admin/categories' },
  { method: 'PUT', path: '/api/admin/categories/00000000-0000-0000-0000-000000000001' },
  { method: 'DELETE', path: '/api/admin/categories/00000000-0000-0000-0000-000000000001' },
  { method: 'GET', path: '/api/admin/products' },
  { method: 'POST', path: '/api/admin/products' },
  { method: 'GET', path: '/api/admin/products/00000000-0000-0000-0000-000000000001' },
  { method: 'PUT', path: '/api/admin/products/00000000-0000-0000-0000-000000000001' },
  { method: 'PATCH', path: '/api/admin/products/00000000-0000-0000-0000-000000000001/visibility' },
  { method: 'DELETE', path: '/api/admin/products/00000000-0000-0000-0000-000000000001' },
  { method: 'GET', path: '/api/admin/inventory' },
  { method: 'POST', path: '/api/admin/variants/00000000-0000-0000-0000-000000000001/stock-adjust' },
  { method: 'GET', path: '/api/admin/variants/00000000-0000-0000-0000-000000000001/stock-movements' },
];

before(async () => {
  await initDatabase();
  await seedDatabase();

  const adminRows = await queryRows<{ id: string }>(sql`
    INSERT INTO users (email, password_hash, full_name, phone, role)
    VALUES ('admin-8b@baity.vn', 'hash_admin_8b', 'Admin 8B', '0909888111', 'admin')
    RETURNING id;
  `);
  adminId = adminRows[0].id;
  adminToken = generateToken({
    id: adminId,
    email: 'admin-8b@baity.vn',
    role: 'admin',
  });

  const custRows = await queryRows<{ id: string }>(sql`
    INSERT INTO users (email, password_hash, full_name, phone, role)
    VALUES ('customer-8b@baity.vn', 'hash_cust_8b', 'Khách Hàng 8B', '0912777888', 'customer')
    RETURNING id;
  `);
  customerId = custRows[0].id;
  customerToken = generateToken({
    id: customerId,
    email: 'customer-8b@baity.vn',
    role: 'customer',
  });

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

  // Tải sẵn 2 ảnh hợp lệ vào bảng uploads với purpose = 'product' để dùng trong các bài test tạo/sửa sản phẩm
  const sampleBuf = await sharp({
    create: { width: 24, height: 24, channels: 3, background: { r: 210, g: 195, b: 175 } },
  })
    .jpeg({ quality: 88 })
    .toBuffer();
  const sampleDataUrl = `data:image/jpeg;base64,${sampleBuf.toString('base64')}`;

  const up1 = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({ image: sampleDataUrl, purpose: 'product' }),
  });
  uploadedProductImagePath1 = (await up1.json()).path;

  const up2 = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({ image: sampleDataUrl, purpose: 'product' }),
  });
  uploadedProductImagePath2 = (await up2.json()).path;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await closeDb();
});

// ============================================================================
// 8b.1: PHÂN QUYỀN MỌI ROUTE QUẢN LÝ DANH MỤC, SẢN PHẨM, TỒN KHO
// ============================================================================
test('Bước 8b.1a: Khách chưa đăng nhập gọi mọi route 8b đều bị chặn với HTTP 401', async () => {
  for (const ep of STAGE_8B_ENDPOINTS) {
    const res = await fetch(`${baseUrl}${ep.path}`, {
      method: ep.method,
      headers: { 'Content-Type': 'application/json' },
      body: ep.method !== 'GET' ? JSON.stringify({}) : undefined,
    });
    assert.equal(res.status, 401, `Chưa đăng nhập gọi ${ep.method} ${ep.path} phải nhận 401`);
  }
});

test('Bước 8b.1b: Khách thường (role=customer) gọi mọi route 8b đều bị chặn với HTTP 403', async () => {
  for (const ep of STAGE_8B_ENDPOINTS) {
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

// ============================================================================
// 8b.2: QUẢN LÝ DANH MỤC (MỤC 9 & 14)
// ============================================================================
let parentCatId = '';
let childCatId = '';

test('Bước 8b.2a: Tạo danh mục cha (Cấp 1) và danh mục con (Cấp 2) thành công, tự sinh slug và chặn trùng slug (409)', async () => {
  const resParent = await fetch(`${baseUrl}/api/admin/categories`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      name: 'Bộ Sưu Tập Thu Đông 8B',
      description: 'Danh mục gốc cấp 1',
      displayOrder: 1,
      isActive: true,
    }),
  });
  assert.equal(resParent.status, 201);
  const parentBody = await resParent.json();
  parentCatId = parentBody.category.id;
  assert.equal(parentBody.category.slug, 'bo-suu-tap-thu-dong-8b');

  // Chặn trùng slug -> 409
  const resDup = await fetch(`${baseUrl}/api/admin/categories`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      name: 'Trùng Slug 8B',
      slug: 'bo-suu-tap-thu-dong-8b',
    }),
  });
  assert.equal(resDup.status, 409);

  // Tạo danh mục con cấp 2
  const resChild = await fetch(`${baseUrl}/api/admin/categories`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      name: 'Áo Khoác Dạ 8B',
      parentId: parentCatId,
    }),
  });
  assert.equal(resChild.status, 201);
  childCatId = (await resChild.json()).category.id;
});

test('Bước 8b.2b: Chặn tạo danh mục cấp 3 (tối đa 2 cấp cha -> con)', async () => {
  const resLevel3 = await fetch(`${baseUrl}/api/admin/categories`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      name: 'Danh Mục Cấp 3 Không Hợp Lệ',
      parentId: childCatId,
    }),
  });
  assert.equal(resLevel3.status, 400);
  const body = await resLevel3.json();
  assert.equal(body.code, 'CATEGORY_MAX_DEPTH_EXCEEDED');
});

test('Bước 8b.2c: Chặn tự trỏ parent_id vào chính mình và chặn tạo vòng lặp A -> B -> A', async () => {
  const selfRefRes = await fetch(`${baseUrl}/api/admin/categories/${parentCatId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      name: 'Bộ Sưu Tập Thu Đông 8B',
      parentId: parentCatId,
    }),
  });
  assert.equal(selfRefRes.status, 400);
  assert.equal((await selfRefRes.json()).code, 'CATEGORY_SELF_PARENT');

  // Chặn đặt parentCatId (đang là cha của childCatId) làm con của childCatId
  const cycleRes = await fetch(`${baseUrl}/api/admin/categories/${parentCatId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      name: 'Bộ Sưu Tập Thu Đông 8B',
      parentId: childCatId,
    }),
  });
  assert.equal(cycleRes.status, 400);
});

test('Bước 8b.2d: Chặn xóa cứng danh mục đang có danh mục con hoặc đang có sản phẩm (400)', async () => {
  const delParentWithChild = await fetch(`${baseUrl}/api/admin/categories/${parentCatId}`, {
    method: 'DELETE',
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` },
  });
  assert.equal(delParentWithChild.status, 400);
  assert.equal((await delParentWithChild.json()).code, 'CATEGORY_HAS_CHILDREN');
});

// ============================================================================
// 8b.3: QUẢN LÝ SẢN PHẨM, BIẾN THỂ, ẢNH & THUỘC TÍNH (MỤC 10, 11 & 14)
// ============================================================================
let createdProductId = '';
let createdVariant1Id = '';
let createdVariant2Id = '';

test('Bước 8b.3a: Tạo sản phẩm mới trong 1 giao dịch nguyên tử (sản phẩm + biến thể + ảnh + thuộc tính + stock_movements khởi tạo + audit log)', async () => {
  const createRes = await fetch(`${baseUrl}/api/admin/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      name: 'Áo Blazer Linen Cao Cấp 8B',
      categoryId: childCatId,
      targetGender: 'unisex',
      basePrice: 890000,
      salePrice: 790000,
      description: 'Áo blazer thiết kế tối giản chuẩn mực',
      material: '100% Linen',
      careInstructions: 'Giặt khô hoặc giặt tay nhẹ',
      isActive: true,
      variants: [
        { sku: 'SKU-8B-BLZ-BE-M', color: 'Be', colorHex: '#E5DCC5', size: 'M', stockQuantity: 8 },
        { sku: 'SKU-8B-BLZ-BLK-L', color: 'Đen', colorHex: '#1A1C19', size: 'L', stockQuantity: 5 },
      ],
      images: [
        {
          imageUrl: uploadedProductImagePath1,
          objectPath: uploadedProductImagePath1,
          altText: 'Áo Blazer mặt trước',
          isPrimary: true,
          displayOrder: 0,
        },
        {
          imageUrl: uploadedProductImagePath2,
          objectPath: uploadedProductImagePath2,
          altText: 'Áo Blazer mặt sau',
          isPrimary: false,
          displayOrder: 1,
        },
      ],
      attributes: [
        { name: 'Phom dáng', value: 'Relaxed Fit' },
        { name: 'Xuất xứ', value: 'Việt Nam' },
      ],
    }),
  });
  assert.equal(createRes.status, 201);
  const body = await createRes.json();
  createdProductId = body.product.id;
  assert.equal(body.product.variants.length, 2);
  createdVariant1Id = body.product.variants[0].id;
  createdVariant2Id = body.product.variants[1].id;
  assert.equal(body.product.images.length, 2);
  assert.equal(body.product.images.filter((i: any) => i.isPrimary).length, 1);
  assert.equal(body.product.attributes.length, 2);

  // Xác nhận stock_movements khởi tạo đã được ghi cho biến thể có tồn đầu > 0
  const movRows = await queryRows<{ delta: number; reason: string }>(sql`
    SELECT delta_quantity AS delta, reason FROM stock_movements WHERE variant_id = ${createdVariant1Id}::uuid;
  `);
  assert.equal(movRows.length, 1);
  assert.equal(Number(movRows[0].delta), 8);
  assert.equal(movRows[0].reason, 'manual_import');
});

test('Bước 8b.3b: Chặn tạo sản phẩm có salePrice > basePrice (400), trùng SKU (409) hoặc trùng cặp (màu, kích cỡ) trong cùng sản phẩm (400)', async () => {
  // 1. salePrice > basePrice -> 400
  const badSaleRes = await fetch(`${baseUrl}/api/admin/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      name: 'SP Giá Sale Lỗi',
      categoryId: childCatId,
      basePrice: 500000,
      salePrice: 600000,
      variants: [{ sku: 'SKU-8B-BADSALE', color: 'Trắng', size: 'M', stockQuantity: 1 }],
      images: [{ imageUrl: uploadedProductImagePath1, isPrimary: true }],
    }),
  });
  assert.equal(badSaleRes.status, 400);

  // 2. Trùng SKU đã có ('SKU-8B-BLZ-BE-M') -> 409
  const dupSkuRes = await fetch(`${baseUrl}/api/admin/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      name: 'SP Trùng SKU',
      categoryId: childCatId,
      basePrice: 500000,
      variants: [{ sku: 'SKU-8B-BLZ-BE-M', color: 'Xanh', size: 'XL', stockQuantity: 2 }],
      images: [{ imageUrl: uploadedProductImagePath1, isPrimary: true }],
    }),
  });
  assert.equal(dupSkuRes.status, 409);

  // 3. Trùng (màu, kích cỡ) trong cùng sản phẩm -> 400
  const dupColorSizeRes = await fetch(`${baseUrl}/api/admin/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      name: 'SP Trùng Màu Size',
      categoryId: childCatId,
      basePrice: 500000,
      variants: [
        { sku: 'SKU-8B-CS-1', color: 'Kem', size: 'M', stockQuantity: 2 },
        { sku: 'SKU-8B-CS-2', color: 'Kem', size: 'M', stockQuantity: 3 },
      ],
      images: [{ imageUrl: uploadedProductImagePath1, isPrimary: true }],
    }),
  });
  assert.equal(dupColorSizeRes.status, 400);
});

test('Bước 8b.3c: Rollback giao dịch tạo sản phẩm nếu bước giữa chừng gặp lỗi (không để lại sản phẩm mồ côi)', async () => {
  const beforeCountRows = await queryRows<{ cnt: number }>(sql`
    SELECT COUNT(*)::int AS cnt FROM products;
  `);
  const beforeCount = beforeCountRows[0].cnt;

  // Gửi sản phẩm mới nhưng biến thể thứ 2 cố tình trùng SKU đã tồn tại trong DB ('SKU-8B-BLZ-BE-M')
  const failMidTxRes = await fetch(`${baseUrl}/api/admin/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      name: 'Sản Phẩm Phải Bị Rollback',
      slug: 'san-pham-phai-bi-rollback-8b',
      categoryId: childCatId,
      basePrice: 400000,
      variants: [
        { sku: 'SKU-8B-NEW-OK', color: 'Trắng', size: 'S', stockQuantity: 5 },
        { sku: 'SKU-8B-BLZ-BE-M', color: 'Đen', size: 'M', stockQuantity: 5 },
      ],
      images: [{ imageUrl: uploadedProductImagePath1, isPrimary: true }],
    }),
  });
  assert.equal(failMidTxRes.status, 409);

  const afterCountRows = await queryRows<{ cnt: number }>(sql`
    SELECT COUNT(*)::int AS cnt FROM products;
  `);
  assert.equal(afterCountRows[0].cnt, beforeCount, 'Không được để lại sản phẩm mồ côi khi lỗi giữa chừng');
});

test('Bước 8b.3d: Tải ảnh sản phẩm qua POST /api/upload với purpose="product": chỉ Admin được phép (khách thường nhận 403), đường dẫn lưu products/<16-hex>/<uuid>.jpg không chứa userId và xóa sạch EXIF', async () => {
  resetUploadRateLimitForTest();
  const jpegBuffer = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 200, g: 180, b: 160 } },
  })
    .withMetadata({
      exif: { IFD0: { Make: 'ProductSecretCamera', Model: 'StudioCam8B' } },
    })
    .jpeg({ quality: 90 })
    .toBuffer();
  const dataUrl = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;

  // Khách thường gọi purpose='product' -> 403
  const custUpRes = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${customerToken}`,
    },
    body: JSON.stringify({ image: dataUrl, purpose: 'product' }),
  });
  assert.equal(custUpRes.status, 403);

  // Admin gọi purpose='product' -> 200
  const adminUpRes = await fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({ image: dataUrl, purpose: 'product' }),
  });
  assert.equal(adminUpRes.status, 200);
  const upBody = await adminUpRes.json();
  assert.equal(upBody.exifStripped, true);
  assert.match(upBody.path, /^products\/[0-9a-f]{16}\/[0-9a-f-]+\.jpg$/);
  assert.equal(upBody.path.includes(adminId), false, 'Đường dẫn ảnh sản phẩm không được chứa userId');
});

test('Bước 8b.3e: Chặn xóa biến thể (400) hoặc xóa cứng sản phẩm đã phát sinh trong order_items (409 PRODUCT_HAS_ORDERS); sản phẩm chưa bán được xóa cứng kèm ảnh, thuộc tính, stock_movements và biến thể trong cùng giao dịch kèm audit log', async () => {
  // Tạo 1 đơn hàng chứa createdVariant1Id
  const orderId = 'BAITY-8B-ORD1';
  await queryRows(sql`
    INSERT INTO orders (
      id, user_id, receiver_name, receiver_phone, shipping_address,
      shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status
    ) VALUES (
      ${orderId}, ${customerId}::uuid, 'Khách 8B', '0912777888', '10 Nguyễn Huệ',
      'standard', 0, 790000, 0, 790000, 'pending'
    );
  `);
  await queryRows(sql`
    INSERT INTO order_items (order_id, variant_id, product_name, color, size, unit_price, quantity, total_price)
    VALUES (${orderId}, ${createdVariant1Id}::uuid, 'Áo Blazer 8B', 'Be', 'M', 790000, 1, 790000);
  `);

  // 1. Thử cập nhật sản phẩm mà bỏ createdVariant1Id khỏi danh sách variants -> bị chặn 400 VARIANT_HAS_ORDERS
  const removeVarWithOrderRes = await fetch(`${baseUrl}/api/admin/products/${createdProductId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      name: 'Áo Blazer Linen Cao Cấp 8B',
      categoryId: childCatId,
      basePrice: 890000,
      salePrice: 790000,
      variants: [
        { id: createdVariant2Id, sku: 'SKU-8B-BLZ-BLK-L', color: 'Đen', size: 'L' },
      ],
      images: [
        { imageUrl: uploadedProductImagePath1, isPrimary: true },
      ],
    }),
  });
  assert.equal(removeVarWithOrderRes.status, 400);
  assert.equal((await removeVarWithOrderRes.json()).code, 'VARIANT_HAS_ORDERS');

  // 2. Thử xóa cứng sản phẩm đã có đơn hàng -> bị chặn 409 PRODUCT_HAS_ORDERS
  const delProdWithOrderRes = await fetch(`${baseUrl}/api/admin/products/${createdProductId}`, {
    method: 'DELETE',
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` },
  });
  assert.equal(delProdWithOrderRes.status, 409);
  const delErrBody = await delProdWithOrderRes.json();
  assert.equal(delErrBody.code, 'PRODUCT_HAS_ORDERS');
  assert.equal(delErrBody.error?.code, 'PRODUCT_HAS_ORDERS');

  // 3. Ẩn sản phẩm (is_active = false) qua PATCH /visibility -> sản phẩm biến mất khỏi GET /api/products công khai nhưng vẫn còn trong GET /api/admin/products
  const hideRes = await fetch(`${baseUrl}/api/admin/products/${createdProductId}/visibility`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({ isActive: false }),
  });
  assert.equal(hideRes.status, 200);

  const pubListRes = await fetch(`${baseUrl}/api/products?search=Blazer`);
  const pubListBody = await pubListRes.json();
  assert.equal(
    pubListBody.data.some((p: any) => p.id === createdProductId),
    false,
    'Sản phẩm có is_active=false không được xuất hiện ở danh sách công khai'
  );

  // 4. Tạo một sản phẩm chưa từng bán (kèm ảnh, thuộc tính, biến thể, stock_movements) và xóa cứng qua DELETE /api/admin/products/:id
  const createUnsoldRes = await fetch(`${baseUrl}/api/admin/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      name: 'Sản Phẩm Chưa Bán Để Xóa Cứng',
      slug: 'san-pham-chua-ban-de-xoa-cung-8b',
      categoryId: childCatId,
      basePrice: 320000,
      variants: [
        { sku: 'SKU-8B-UNSOLD-DEL', color: 'Xám', size: 'M', stockQuantity: 4 },
      ],
      images: [{ imageUrl: uploadedProductImagePath1, isPrimary: true }],
      attributes: [{ name: 'Kiểu cổ', value: 'Cổ tròn' }],
    }),
  });
  assert.equal(createUnsoldRes.status, 201);
  const unsoldProd = (await createUnsoldRes.json()).product;
  const unsoldProdId = unsoldProd.id;
  const unsoldVarId = unsoldProd.variants[0].id;

  const delUnsoldRes = await fetch(`${baseUrl}/api/admin/products/${unsoldProdId}`, {
    method: 'DELETE',
    headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` },
  });
  assert.equal(delUnsoldRes.status, 200);

  // Xác nhận sản phẩm, biến thể, ảnh, thuộc tính, stock_movements đều bị xóa sạch và có audit log PRODUCT_DELETE
  const [remProd, remVar, remImg, remAttr, remMov, delAudit] = await Promise.all([
    queryRows(sql`SELECT id FROM products WHERE id = ${unsoldProdId}::uuid;`),
    queryRows(sql`SELECT id FROM product_variants WHERE product_id = ${unsoldProdId}::uuid;`),
    queryRows(sql`SELECT id FROM product_images WHERE product_id = ${unsoldProdId}::uuid;`),
    queryRows(sql`SELECT id FROM product_attributes WHERE product_id = ${unsoldProdId}::uuid;`),
    queryRows(sql`SELECT id FROM stock_movements WHERE variant_id = ${unsoldVarId}::uuid;`),
    queryRows(sql`SELECT id FROM admin_audit_logs WHERE action = 'PRODUCT_DELETE' AND target_id = ${unsoldProdId};`),
  ]);
  assert.equal(remProd.length, 0);
  assert.equal(remVar.length, 0);
  assert.equal(remImg.length, 0);
  assert.equal(remAttr.length, 0);
  assert.equal(remMov.length, 0);
  assert.equal(delAudit.length, 1, 'Phải ghi PRODUCT_DELETE vào admin_audit_logs trong cùng giao dịch');
});

test('Bước 8b.3f (Mục 6): POST/PUT /api/admin/products từ chối URL ảnh ngoài hoặc đường dẫn tùy ý không có trong bảng uploads (purpose="product") với HTTP 400 INVALID_PRODUCT_IMAGE_SOURCE; loại bỏ thẻ <script> và <img onerror> trong tên danh mục, tên/mô tả/thuộc tính sản phẩm', async () => {
  // 1. Từ chối URL ngoài (https://images.unsplash.com/...) trên POST /api/admin/products -> 400 INVALID_PRODUCT_IMAGE_SOURCE
  const extUrlCreateRes = await fetch(`${baseUrl}/api/admin/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      name: 'Sản Phẩm Ảnh Ngoài',
      categoryId: childCatId,
      basePrice: 300000,
      variants: [{ sku: 'SKU-8B-EXT-IMG', color: 'Đen', size: 'S', stockQuantity: 2 }],
      images: [
        {
          url: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=800',
          isPrimary: true,
        },
      ],
    }),
  });
  assert.equal(extUrlCreateRes.status, 400);
  assert.equal((await extUrlCreateRes.json()).code, 'INVALID_PRODUCT_IMAGE_SOURCE');

  // 2. Từ chối đường dẫn tùy ý chưa có trong bảng uploads trên PUT /api/admin/products/:id -> 400 INVALID_PRODUCT_IMAGE_SOURCE
  const fakePathUpdateRes = await fetch(`${baseUrl}/api/admin/products/${createdProductId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      name: 'Áo Blazer Linen Cao Cấp 8B',
      categoryId: childCatId,
      basePrice: 890000,
      variants: [
        { id: createdVariant1Id, sku: 'SKU-8B-BLZ-BE-M', color: 'Be', size: 'M' },
        { id: createdVariant2Id, sku: 'SKU-8B-BLZ-BLK-L', color: 'Đen', size: 'L' },
      ],
      images: [
        {
          imageUrl: 'products/deadbeef12345678/00000000-0000-0000-0000-999999999999.jpg',
          isPrimary: true,
        },
      ],
    }),
  });
  assert.equal(fakePathUpdateRes.status, 400);
  assert.equal((await fakePathUpdateRes.json()).code, 'INVALID_PRODUCT_IMAGE_SOURCE');

  // 3. Loại bỏ <script> và <img onerror> trong tên danh mục, tên sản phẩm, mô tả và thuộc tính sản phẩm
  const xssCatRes = await fetch(`${baseUrl}/api/admin/categories`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      name: 'Áo Thun <script>alert("xss")</script><img src=x onerror="alert(1)"> An Toàn',
      slug: 'ao-thun-an-toan-8b',
      isActive: true,
    }),
  });
  assert.equal(xssCatRes.status, 201);
  const xssCat = (await xssCatRes.json()).category;
  assert.equal(xssCat.name.includes('<script'), false);
  assert.equal(xssCat.name.includes('<img'), false);
  assert.equal(xssCat.name.includes('onerror'), false);

  const xssProdRes = await fetch(`${baseUrl}/api/admin/products`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      name: 'Áo Polo <script>window.evil=1</script><img src=x onerror=alert(2)> Cao Cấp',
      slug: 'ao-polo-an-toan-8b',
      categoryId: xssCat.id,
      basePrice: 390000,
      description: 'Mô tả sạch <script>stealCookie()</script> và <img src="x" onerror="evil()"> chuẩn mực',
      isActive: true,
      variants: [
        {
          sku: 'SKU-8B-XSS-SAFE',
          color: 'Trắng <script>x</script>',
          size: 'L',
          stockQuantity: 3,
        },
      ],
      images: [{ imageUrl: uploadedProductImagePath1, isPrimary: true }],
      attributes: [
        {
          name: 'Chất liệu <img onerror=alert(3) src=x>',
          value: 'Cotton Pima <script>evil()</script>',
        },
      ],
    }),
  });
  assert.equal(xssProdRes.status, 201);

  // Kiểm tra trên API trang khách (/api/categories và /api/products/:slug)
  const pubCatRes = await fetch(`${baseUrl}/api/categories`);
  const pubCatText = JSON.stringify(await pubCatRes.json());
  assert.equal(pubCatText.includes('<script'), false);
  assert.equal(pubCatText.includes('<img'), false);
  assert.equal(pubCatText.includes('onerror'), false);

  const pubProdRes = await fetch(`${baseUrl}/api/products/ao-polo-an-toan-8b`);
  assert.equal(pubProdRes.status, 200);
  const pubProdText = JSON.stringify(await pubProdRes.json());
  assert.equal(pubProdText.includes('<script'), false);
  assert.equal(pubProdText.includes('<img'), false);
  assert.equal(pubProdText.includes('onerror'), false);
});

test('Bước 8b.3g (Mục 7): Quét mã nguồn server đảm bảo không có bất kỳ file nào ngoài server/services/orderStateMachine.ts tự ý cập nhật cột status của bảng orders', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');

  function listTsFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const out: string[] = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...listTsFiles(full));
      } else if (e.isFile() && full.endsWith('.ts')) {
        out.push(full);
      }
    }
    return out;
  }

  const serverDir = path.resolve(process.cwd(), 'server');
  const files = listTsFiles(serverDir);
  const offenders: string[] = [];

  for (const file of files) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
    if (rel === 'server/services/orderStateMachine.ts') continue;
    const content = fs.readFileSync(file, 'utf-8');
    // Kiểm tra UPDATE orders ... SET ... status = hoặc .update(orders).set({ status ... })
    const rawSqlUpdateOrderStatus =
      /UPDATE\s+"?orders"?\s+SET\s+[\s\S]{0,200}?\bstatus\s*=/i.test(content);
    const drizzleUpdateOrderStatus =
      /\.update\(\s*orders\s*\)[\s\S]{0,120}?\.set\(\s*\{[^}]*\bstatus\b/i.test(content);
    if (rawSqlUpdateOrderStatus || drizzleUpdateOrderStatus) {
      offenders.push(rel);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Mọi cập nhật orders.status bắt buộc đi qua server/services/orderStateMachine.ts. Phát hiện vi phạm tại: ${offenders.join(', ')}`
  );
});

// ============================================================================
// 8b.4: QUẢN LÝ TỒN KHO & STOCK_MOVEMENTS (MỞ RỘNG THEO MỤC 8)
// ============================================================================
test('Bước 8b.4a: Điều chỉnh tồn kho bắt buộc ghi chú khi reason="other" và khớp tổng biến động trong stock_movements', async () => {
  const otherNoNoteRes = await fetch(
    `${baseUrl}/api/admin/variants/${createdVariant2Id}/stock-adjust`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify({
        delta: 2,
        reason: 'other',
        note: '',
      }),
    }
  );
  assert.equal(otherNoNoteRes.status, 400);

  // Nhập kho hợp lệ (+7) và xuất hủy (-2) -> tồn kho từ 5 -> 12 -> 10
  const addRes = await fetch(`${baseUrl}/api/admin/variants/${createdVariant2Id}/stock-adjust`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      delta: 7,
      reason: 'manual_import',
      note: 'Nhập bổ sung lô mới',
    }),
  });
  assert.equal(addRes.status, 200);
  assert.equal((await addRes.json()).newQuantity, 12);

  const subRes = await fetch(`${baseUrl}/api/admin/variants/${createdVariant2Id}/stock-adjust`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
    },
    body: JSON.stringify({
      delta: -2,
      reason: 'inventory_audit',
      note: 'Kiểm kê cuối tháng lệch 2 chiếc',
    }),
  });
  assert.equal(subRes.status, 200);
  assert.equal((await subRes.json()).newQuantity, 10);

  const movRes = await fetch(
    `${baseUrl}/api/admin/variants/${createdVariant2Id}/stock-movements`,
    {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` },
    }
  );
  assert.equal(movRes.status, 200);
  const movBody = await movRes.json();
  const sumDelta = movBody.items.reduce((acc: number, m: any) => acc + Number(m.delta), 0);
  assert.equal(
    sumDelta,
    10,
    'Tổng các biến động trong stock_movements phải khớp tuyệt đối với stock_quantity hiện tại (10)'
  );
});

test('Bước 8b.4b (Mục 8): Lý do điều chỉnh kho ngoài danh sách cho phép bị từ chối (400) và delta = 0 bị từ chối (400)', async () => {
  const invalidReasonRes = await fetch(
    `${baseUrl}/api/admin/variants/${createdVariant2Id}/stock-adjust`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify({
        delta: 3,
        reason: 'stolen_or_invalid_reason',
        note: 'Lý do không nằm trong danh sách chuẩn',
      }),
    }
  );
  assert.equal(invalidReasonRes.status, 400);
  assert.equal((await invalidReasonRes.json()).code, 'VALIDATION_ERROR');

  const zeroDeltaRes = await fetch(
    `${baseUrl}/api/admin/variants/${createdVariant2Id}/stock-adjust`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify({
        delta: 0,
        reason: 'manual_import',
        note: 'Điều chỉnh bằng 0',
      }),
    }
  );
  assert.equal(zeroDeltaRes.status, 400);
  assert.equal((await zeroDeltaRes.json()).code, 'VALIDATION_ERROR');
});

test('Bước 8b.4c (Mục 8): Trừ vượt tồn hiện tại trả HTTP 409 (INSUFFICIENT_STOCK_FOR_ADJUSTMENT) và không tạo dòng stock_movements mới', async () => {
  const beforeMovCountRows = await queryRows<{ cnt: number }>(sql`
    SELECT COUNT(*)::int AS cnt FROM stock_movements WHERE variant_id = ${createdVariant2Id}::uuid;
  `);
  const beforeMovCount = beforeMovCountRows[0].cnt;

  const overDeductRes = await fetch(
    `${baseUrl}/api/admin/variants/${createdVariant2Id}/stock-adjust`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify({
        delta: -999,
        reason: 'damaged',
        note: 'Trừ vượt tồn kho hiện tại',
      }),
    }
  );
  assert.equal(overDeductRes.status, 409);
  const errBody = await overDeductRes.json();
  assert.equal(errBody.code, 'INSUFFICIENT_STOCK_FOR_ADJUSTMENT');

  const afterMovCountRows = await queryRows<{ cnt: number }>(sql`
    SELECT COUNT(*)::int AS cnt FROM stock_movements WHERE variant_id = ${createdVariant2Id}::uuid;
  `);
  assert.equal(
    afterMovCountRows[0].cnt,
    beforeMovCount,
    'Khi trừ kho thất bại (409), tuyệt đối không được tạo thêm dòng stock_movements'
  );
});

test('Bước 8b.4d (Mục 8): Phân trang GET /api/admin/variants/:id/stock-movements hoạt động chính xác', async () => {
  // Hiện createdVariant2Id đã có 3 dòng stock_movements (+5 khởi tạo, +7 nhập, -2 kiểm kê)
  const page1Res = await fetch(
    `${baseUrl}/api/admin/variants/${createdVariant2Id}/stock-movements?page=1&limit=2`,
    {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` },
    }
  );
  assert.equal(page1Res.status, 200);
  const page1Body = await page1Res.json();
  assert.equal(page1Body.total, 3);
  assert.equal(page1Body.page, 1);
  assert.equal(page1Body.limit, 2);
  assert.equal(page1Body.totalPages, 2);
  assert.equal(page1Body.items.length, 2);

  const page2Res = await fetch(
    `${baseUrl}/api/admin/variants/${createdVariant2Id}/stock-movements?page=2&limit=2`,
    {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` },
    }
  );
  assert.equal(page2Res.status, 200);
  const page2Body = await page2Res.json();
  assert.equal(page2Body.page, 2);
  assert.equal(page2Body.items.length, 1);
  assert.notEqual(page1Body.items[0].id, page2Body.items[0].id);
});

test('Bước 8b.4e (Mục 8): GET /api/admin/inventory?lowStockOnly=true lọc đúng theo ngưỡng lowStockThreshold trong store_settings', async () => {
  // Cập nhật ngưỡng lowStockThreshold = 9 trong store_settings (key = 'inventory')
  await queryRows(sql`
    INSERT INTO store_settings (key, value)
    VALUES ('inventory', ${JSON.stringify({ lowStockThreshold: 9 })}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  `);

  // createdVariant1Id có stock = 8 (<= 9), createdVariant2Id có stock = 10 (> 9)
  const lowInvRes = await fetch(
    `${baseUrl}/api/admin/inventory?lowStockOnly=true&categoryId=${childCatId}&limit=50`,
    {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${adminToken}` },
    }
  );
  assert.equal(lowInvRes.status, 200);
  const lowInvBody = await lowInvRes.json();
  assert.equal(lowInvBody.lowStockThreshold, 9);
  assert.equal(
    lowInvBody.items.every((item: any) => item.stockQuantity <= 9 && item.isLowStock === true),
    true,
    'Mọi biến thể trả về khi lowStockOnly=true phải có stockQuantity <= lowStockThreshold (9)'
  );
  assert.equal(
    lowInvBody.items.some((item: any) => item.id === createdVariant1Id),
    true,
    'Biến thể có tồn kho 8 (<= 9) phải nằm trong danh sách sắp hết hàng'
  );
  assert.equal(
    lowInvBody.items.some((item: any) => item.id === createdVariant2Id),
    false,
    'Biến thể có tồn kho 10 (> 9) không được nằm trong danh sách sắp hết hàng'
  );
});

test('Bước 8b.4f (Mục 8): Ghi nhận admin_audit_logs (VARIANT_STOCK_ADJUST) trong cùng giao dịch khi điều chỉnh tồn kho', async () => {
  const adjustRes = await fetch(
    `${baseUrl}/api/admin/variants/${createdVariant1Id}/stock-adjust`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTH_COOKIE_NAME}=${adminToken}`,
      },
      body: JSON.stringify({
        delta: 1,
        reason: 'other',
        note: 'Bổ sung 1 chiếc kiểm tra audit log nguyên tử',
      }),
    }
  );
  assert.equal(adjustRes.status, 200);
  const adjustBody = await adjustRes.json();
  assert.ok(adjustBody.auditLogId, 'Phản hồi phải trả về auditLogId được tạo trong giao dịch');

  const auditRows = await queryRows<{
    id: string;
    action: string;
    target_type: string;
    target_id: string;
    summary: string;
  }>(sql`
    SELECT id, action, target_type, target_id, summary
    FROM admin_audit_logs
    WHERE id = ${adjustBody.auditLogId}::uuid;
  `);
  assert.equal(auditRows.length, 1);
  assert.equal(auditRows[0].action, 'VARIANT_STOCK_ADJUST');
  assert.equal(auditRows[0].target_type, 'product_variant');
  assert.equal(auditRows[0].target_id, createdVariant1Id);
  assert.ok(auditRows[0].summary.includes('8 -> 9'));
});

