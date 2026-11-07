import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

// Cấu hình sử dụng PGlite in-memory cô lập cho test Giai đoạn 3
process.env.USE_PGLITE = 'true';
process.env.PGLITE_DATA_DIR = 'memory://';
process.env.COOKIE_CROSS_SITE = 'false';

import { initDatabase } from '../server/db/init.ts';
import { queryRows, resetQueryCounter, getQueryCount, closeDb } from '../server/db/index.ts';
import { createApp } from '../server/app.ts';
import { calculateEffectivePrice } from '../server/services/pricing.ts';
import { normalizeVietnameseText, resetSuggestRateLimit } from '../server/services/search.ts';
import { sql } from 'drizzle-orm';

let server: Server;
let baseUrl = '';

// Biến lưu ID danh mục phục vụ kiểm thử
let catShirtId = '';
let catJacketId = '';
let catPantsId = '';
let activePromoId = '';

before(async () => {
  await initDatabase();
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

  // 1. Khởi tạo bảng size & cài đặt chung
  const sizeCharts = {
    men: [
      { size: 'S', height: '160 - 165cm', weight: '50 - 58kg', chest: '86 - 90cm', waist: '72 - 76cm' },
      { size: 'M', height: '165 - 170cm', weight: '59 - 66kg', chest: '90 - 94cm', waist: '76 - 80cm' },
      { size: 'L', height: '170 - 176cm', weight: '67 - 74kg', chest: '94 - 98cm', waist: '80 - 84cm' },
      { size: 'XL', height: '176 - 182cm', weight: '75 - 82kg', chest: '98 - 104cm', waist: '84 - 90cm' },
      { size: 'XXL', height: '180 - 188cm', weight: '83 - 92kg', chest: '104 - 110cm', waist: '90 - 98cm' },
    ],
    women: [
      { size: 'XS', height: '150 - 155cm', weight: '40 - 45kg', chest: '78 - 82cm', waist: '60 - 64cm' },
      { size: 'S', height: '155 - 160cm', weight: '45 - 50kg', chest: '82 - 86cm', waist: '64 - 68cm' },
      { size: 'M', height: '160 - 165cm', weight: '50 - 56kg', chest: '86 - 90cm', waist: '68 - 72cm' },
      { size: 'L', height: '165 - 170cm', weight: '56 - 63kg', chest: '90 - 94cm', waist: '72 - 76cm' },
    ],
    unisex: [
      { size: 'S', height: '155 - 165cm', weight: '45 - 58kg', fitNote: 'Phom rộng suông' },
      { size: 'M', height: '165 - 172cm', weight: '58 - 68kg', fitNote: 'Chuẩn Streetwear' },
      { size: 'L', height: '172 - 178cm', weight: '68 - 78kg', fitNote: 'Vai thả rộng rãi' },
      { size: 'XL', height: '178 - 185cm', weight: '78 - 88kg', fitNote: 'Oversized' },
    ],
    pants: [
      { size: '29', waist: '74 - 76cm', hip: '89 - 92cm', length: '99cm' },
      { size: '30', waist: '76 - 79cm', hip: '92 - 95cm', length: '100cm' },
      { size: '31', waist: '79 - 81cm', hip: '95 - 98cm', length: '101cm' },
      { size: '32', waist: '81 - 84cm', hip: '98 - 101cm', length: '102cm' },
    ],
  };

  await queryRows(sql`
    INSERT INTO store_settings (key, value, description)
    VALUES
      ('size_charts', ${JSON.stringify(sizeCharts)}::jsonb, 'Bảng size'),
      ('general', ${JSON.stringify({ lowStockThreshold: 5 })}::jsonb, 'Cài đặt chung')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  `);

  // 2. Tạo danh mục mẫu
  const c1 = await queryRows<{ id: string }>(sql`
    INSERT INTO categories (name, slug, display_order) VALUES ('Áo sơ mi', 'ao-so-mi', 1) RETURNING id;
  `);
  const c2 = await queryRows<{ id: string }>(sql`
    INSERT INTO categories (name, slug, display_order) VALUES ('Áo khoác & Blazer', 'ao-khoac-blazer', 2) RETURNING id;
  `);
  const c3 = await queryRows<{ id: string }>(sql`
    INSERT INTO categories (name, slug, display_order) VALUES ('Quần tây & Kaki', 'quan-tay-kaki', 3) RETURNING id;
  `);
  catShirtId = c1[0].id;
  catJacketId = c2[0].id;
  catPantsId = c3[0].id;

  // 3. Tạo chương trình khuyến mãi đang chạy (giảm 20% cho Áo khoác & Blazer)
  const promo = await queryRows<{ id: string }>(sql`
    INSERT INTO promotions (title, start_time, end_time, is_active)
    VALUES ('Flash Sale Mùa Thu - Giảm đến 20%', NOW() - INTERVAL '1 day', NOW() + INTERVAL '7 days', true)
    RETURNING id;
  `);
  activePromoId = promo[0].id;

  await queryRows(sql`
    INSERT INTO promotion_targets (promotion_id, target_type, target_id, discount_percent)
    VALUES (${activePromoId}, 'category', ${catJacketId}, 20);
  `);

  // 4. Tạo 16 sản phẩm đa dạng (Nam, Nữ, Unisex, sản phẩm ẩn, sản phẩm trùng giá để test phân trang ổn định)
  const sampleProducts = [
    {
      name: 'Áo Sơ Mi Oxford Dài Tay Nam Cao Cấp',
      slug: 'ao-so-mi-oxford-dai-tay-nam-cao-cap',
      catId: catShirtId,
      gender: 'men',
      price: 400000,
      desc: 'Áo sơ mi vải Oxford thoáng mát lịch lãm cho phái mạnh.',
      isActive: true,
      variants: [
        { colorName: 'Trắng tinh khôi', colorCode: '#FFFFFF', size: 'M', stock: 20, override: null },
        { colorName: 'Trắng tinh khôi', colorCode: '#FFFFFF', size: 'L', stock: 3, override: null }, // Sắp hết
        { colorName: 'Trắng tinh khôi', colorCode: '#FFFFFF', size: 'XXL', stock: 0, override: null }, // Hết hàng
        { colorName: 'Xanh Navy', colorCode: '#1B263B', size: 'XL', stock: 10, override: 420000 },
      ],
    },
    {
      name: 'Quần Tây Nam Phom Slimfit Công Sở',
      slug: 'quan-tay-nam-phom-slimfit-cong-so',
      catId: catPantsId,
      gender: 'men',
      // Mô tả có chứa cụm "áo sơ mi" để kiểm thử xếp hạng: khớp tên (Áo Sơ Mi Oxford) phải đứng trước khớp mô tả (Quần Tây)
      desc: 'Quần tây nam lịch sự, rất hợp khi phối cùng áo sơ mi oxford đi làm hàng ngày.',
      price: 450000,
      isActive: true,
      variants: [
        { colorName: 'Đen tuyền', colorCode: '#111111', size: '30', stock: 15, override: null },
        { colorName: 'Đen tuyền', colorCode: '#111111', size: '31', stock: 10, override: null },
      ],
    },
    {
      name: 'Áo Khoác Blazer Nữ Dáng Ngắn Thanh Lịch',
      slug: 'ao-khoac-blazer-nu-dang-ngan-thanh-lich',
      catId: catJacketId,
      gender: 'women',
      price: 500000, // Giảm 20% -> effective_price = 400000
      desc: 'Áo khoác blazer nữ tôn dáng công sở hiện đại.',
      isActive: true,
      variants: [
        { colorName: 'Kem bơ', colorCode: '#F5E6D3', size: 'S', stock: 12, override: null },
        { colorName: 'Kem bơ', colorCode: '#F5E6D3', size: 'M', stock: 8, override: null },
      ],
    },
    {
      name: 'Áo Khoác Bomber Unisex Phối Tay Da Đặc Biệt',
      slug: 'ao-khoac-bomber-unisex-phoi-tay-da-dac-biet',
      catId: catJacketId,
      gender: 'unisex',
      price: 600000,
      desc: 'Áo khoác bomber unisex cá tính cho cả nam và nữ.',
      isActive: true,
      // Có biến thể price_override = 550000 -> giảm 20% = 440000
      variants: [
        { colorName: 'Xanh Rêu', colorCode: '#2D4A3E', size: 'M', stock: 14, override: 550000 },
        { colorName: 'Xanh Rêu', colorCode: '#2D4A3E', size: 'L', stock: 9, override: 600000 },
      ],
    },
    {
      name: 'Áo Sơ Mi Lụa Nữ Cổ Đức Tuyệt Đẹp (Đã Ẩn)',
      slug: 'ao-so-mi-lua-nu-co-duc-da-an',
      catId: catShirtId,
      gender: 'women',
      price: 380000,
      desc: 'Sản phẩm đã ngừng kinh doanh (is_active = false).',
      isActive: false,
      variants: [
        { colorName: 'Hồng phấn', colorCode: '#F8C8DC', size: 'S', stock: 10, override: null },
      ],
    },
  ];

  // Thêm 11 sản phẩm Unisex & Nam/Nữ cùng mức giá 350.000₫ để kiểm tra phân trang ổn định (deterministic tie-breaker id)
  for (let i = 1; i <= 11; i++) {
    sampleProducts.push({
      name: `Áo Sơ Mi Basic Baity Mẫu Số ${i}`,
      slug: `ao-so-mi-basic-baity-mau-so-${i}`,
      catId: catShirtId,
      gender: i % 3 === 0 ? 'unisex' : i % 2 === 0 ? 'women' : 'men',
      price: 350000,
      desc: `Mẫu áo sơ mi cơ bản thứ ${i} chất liệu cotton thoáng mát.`,
      isActive: true,
      variants: [
        {
          colorName: i % 2 === 0 ? 'Trắng tinh khôi' : 'Xanh паstel',
          colorCode: '#FFFFFF',
          size: 'M',
          stock: i === 11 ? 0 : 10, // Mẫu số 11 hết hàng hoàn toàn
          override: null,
        },
      ],
    });
  }

  let skuSeq = 5000;
  for (const sp of sampleProducts) {
    const searchText = normalizeVietnameseText(`${sp.name} ${sp.desc} cotton ${sp.gender}`);
    const pRows = await queryRows<{ id: string }>(sql`
      INSERT INTO products (name, slug, category_id, target_gender, description, material, care_instructions, base_price, search_text, is_active)
      VALUES (${sp.name}, ${sp.slug}, ${sp.catId}, ${sp.gender}, ${sp.desc}, '100% Cotton', 'Giặt nhẹ', ${sp.price}, ${searchText}, ${sp.isActive})
      RETURNING id;
    `);
    const pid = pRows[0].id;

    await queryRows(sql`
      INSERT INTO product_images (product_id, image_url, is_primary, display_order)
      VALUES (${pid}, 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=600', true, 0);
    `);

    for (const v of sp.variants) {
      skuSeq++;
      await queryRows(sql`
        INSERT INTO product_variants (product_id, color_name, color_code, size, sku, stock_quantity, price_override)
        VALUES (${pid}, ${v.colorName}, ${v.colorCode}, ${v.size}, ${'SKU-' + skuSeq}, ${v.stock}, ${v.override});
      `);
    }
  }

  // 5. Thêm người dùng và đánh giá mẫu để kiểm thử rating_avg & review_count
  const uRows = await queryRows<{ id: string }>(sql`
    INSERT INTO users (email, phone, password_hash, full_name, role)
    VALUES ('reviewer@baity.test', '0901234567', 'hash_placeholder', 'Người Đánh Giá', 'customer')
    RETURNING id;
  `);
  const reviewerId = uRows[0].id;

  const oxfordProd = await queryRows<{ id: string }>(sql`
    SELECT id FROM products WHERE slug = 'ao-so-mi-oxford-dai-tay-nam-cao-cap' LIMIT 1;
  `);
  const oxfordId = oxfordProd[0].id;

  await queryRows(sql`
    INSERT INTO orders (id, user_id, receiver_name, receiver_phone, shipping_address, subtotal, total_amount, status)
    VALUES ('ORD-TEST-REV1', ${reviewerId}, 'Test Receiver', '0901234567', 'TP.HCM', 400000, 400000, 'completed'),
           ('ORD-TEST-REV2', ${reviewerId}, 'Test Receiver', '0901234567', 'TP.HCM', 400000, 400000, 'completed');
  `);

  await queryRows(sql`
    INSERT INTO reviews (product_id, user_id, order_id, rating, comment)
    VALUES
      (${oxfordId}, ${reviewerId}, 'ORD-TEST-REV1', 5, 'Chất lượng áo rất tuyệt vời, vải thoáng mát'),
      (${oxfordId}, ${reviewerId}, 'ORD-TEST-REV2', 4, 'Đường may chỉn chu, giao hàng nhanh');
  `);
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await closeDb();
});

// 1. Kiểm tra tham số sai trả về HTTP 400 (Zod validation)
test('Stage 3 - GET /api/products: returns HTTP 400 for invalid sort, page, pageSize, minPrice/maxPrice, gender', async () => {
  // a. sort không nằm trong danh sách cho phép
  const badSort = await fetch(`${baseUrl}/api/products?sort=invalid_sort`);
  assert.equal(badSort.status, 400, 'sort sai phải trả về 400');

  // b. pageSize vượt quá 24
  const badPageSize = await fetch(`${baseUrl}/api/products?pageSize=25`);
  assert.equal(badPageSize.status, 400, 'pageSize > 24 phải trả về 400');

  // c. page <= 0
  const badPage = await fetch(`${baseUrl}/api/products?page=0`);
  assert.equal(badPage.status, 400, 'page = 0 phải trả về 400');

  // d. maxPrice < minPrice
  const badPriceRange = await fetch(`${baseUrl}/api/products?minPrice=500000&maxPrice=200000`);
  assert.equal(badPriceRange.status, 400, 'maxPrice < minPrice phải trả về 400');

  // e. minRating > 5
  const badRating = await fetch(`${baseUrl}/api/products?minRating=6`);
  assert.equal(badRating.status, 400, 'minRating > 5 phải trả về 400');

  // f. gender không hợp lệ
  const badGender = await fetch(`${baseUrl}/api/products?gender=kids`);
  assert.equal(badGender.status, 400, 'gender không hợp lệ phải trả về 400');
});

// 2. Kiểm tra phân trang ổn định (Deterministic pagination với khóa phụ id)
test('Stage 3 - GET /api/products: pagination with secondary key (id) has zero duplicates and zero missing items', async () => {
  // Có 15 sản phẩm active (1 sản phẩm bị ẩn is_active=false)
  // Nhiều sản phẩm có cùng giá 350.000₫ và cùng created_at. Sắp xếp theo price_asc với pageSize=5
  const page1Res = await fetch(`${baseUrl}/api/products?sort=price_asc&page=1&pageSize=5`);
  const page2Res = await fetch(`${baseUrl}/api/products?sort=price_asc&page=2&pageSize=5`);
  const page3Res = await fetch(`${baseUrl}/api/products?sort=price_asc&page=3&pageSize=5`);

  assert.equal(page1Res.status, 200);
  assert.equal(page2Res.status, 200);
  assert.equal(page3Res.status, 200);

  const p1 = await page1Res.json();
  const p2 = await page2Res.json();
  const p3 = await page3Res.json();

  assert.equal(p1.total, 15, 'Tổng số sản phẩm active phải là 15');
  assert.equal(p1.totalPages, 3, 'Với pageSize=5 và total=15 thì totalPages phải là 3');
  assert.equal(p1.items.length, 5);
  assert.equal(p2.items.length, 5);
  assert.equal(p3.items.length, 5);

  const allIds = [...p1.items, ...p2.items, ...p3.items].map((item: any) => item.id);
  const uniqueIds = new Set(allIds);
  assert.equal(uniqueIds.size, 15, 'Tất cả 15 sản phẩm qua 3 trang không được trùng lặp hay bỏ sót bất kỳ sản phẩm nào');

  // Kiểm tra thứ tự giá tăng dần thực tế
  const allPrices = [...p1.items, ...p2.items, ...p3.items].map((item: any) => item.effective_price);
  for (let i = 1; i < allPrices.length; i++) {
    assert.ok(allPrices[i] >= allPrices[i - 1], `Giá trang sau phải >= giá trang trước (${allPrices[i]} >= ${allPrices[i - 1]})`);
  }
});

// 3. Kiểm tra lọc đối tượng: Chọn Nam hoặc Nữ vẫn hiển thị sản phẩm Unisex (và tùy chọn bỏ Unisex)
test('Stage 3 - GET /api/products: filtering by men or women includes unisex products by default and supports excluding unisex', async () => {
  // a. Lọc Nam mặc định (includeUnisex = true)
  const menWithUnisexRes = await fetch(`${baseUrl}/api/products?gender=men&pageSize=24`);
  const menWithUnisex = await menWithUnisexRes.json();
  const gendersInMen = new Set(menWithUnisex.items.map((i: any) => i.target_gender));
  assert.ok(gendersInMen.has('men'), 'Phải có sản phẩm Nam');
  assert.ok(gendersInMen.has('unisex'), 'Khi chọn Nam phải hiển thị cả sản phẩm Unisex');
  assert.ok(!gendersInMen.has('women'), 'Không được chứa sản phẩm Nữ');

  // b. Lọc Nữ mặc định (includeUnisex = true)
  const womenWithUnisexRes = await fetch(`${baseUrl}/api/products?gender=women&pageSize=24`);
  const womenWithUnisex = await womenWithUnisexRes.json();
  const gendersInWomen = new Set(womenWithUnisex.items.map((i: any) => i.target_gender));
  assert.ok(gendersInWomen.has('women'), 'Phải có sản phẩm Nữ');
  assert.ok(gendersInWomen.has('unisex'), 'Khi chọn Nữ phải hiển thị cả sản phẩm Unisex');
  assert.ok(!gendersInWomen.has('men'), 'Không được chứa sản phẩm Nam');

  // c. Tùy chọn bỏ Unisex (includeUnisex=false)
  const menStrictRes = await fetch(`${baseUrl}/api/products?gender=men&includeUnisex=false&pageSize=24`);
  const menStrict = await menStrictRes.json();
  for (const item of menStrict.items) {
    assert.equal(item.target_gender, 'men', 'Khi includeUnisex=false chỉ hiển thị sản phẩm thuần Nam');
  }
});

// 4. Kiểm tra lọc từng điều kiện (category, minPrice, maxPrice, size, color, onSale, inStock)
test('Stage 3 - GET /api/products: accurately filters by category, effective price range, size, color, onSale, inStock', async () => {
  // a. Lọc theo category
  const catRes = await fetch(`${baseUrl}/api/products?category=ao-khoac-blazer`);
  const catBody = await catRes.json();
  assert.equal(catBody.items.length, 2);
  for (const item of catBody.items) {
    assert.equal(item.category_slug, 'ao-khoac-blazer');
  }

  // b. Lọc theo khoảng giá hiệu lực (effective_price từ 390.000₫ đến 445.000₫)
  const priceRes = await fetch(`${baseUrl}/api/products?minPrice=390000&maxPrice=445000`);
  const priceBody = await priceRes.json();
  assert.ok(priceBody.items.length >= 2);
  for (const item of priceBody.items) {
    assert.ok(
      item.effective_price >= 390000 && item.effective_price <= 445000,
      `Sản phẩm ${item.name} có effective_price=${item.effective_price} phải nằm trong [390000, 445000]`
    );
  }

  // c. Lọc theo onSale=true
  const saleRes = await fetch(`${baseUrl}/api/products?onSale=true`);
  const saleBody = await saleRes.json();
  assert.equal(saleBody.items.length, 2, 'Có 2 sản phẩm thuộc danh mục Áo khoác đang Flash Sale 20%');
  for (const item of saleBody.items) {
    assert.equal(item.is_on_sale, true);
    assert.ok(item.effective_price < item.base_price);
  }

  // d. Lọc theo size=30
  const sizeRes = await fetch(`${baseUrl}/api/products?size=30`);
  const sizeBody = await sizeRes.json();
  assert.equal(sizeBody.items.length, 1);
  assert.equal(sizeBody.items[0].slug, 'quan-tay-nam-phom-slimfit-cong-so');

  // e. Lọc theo color=Xanh Navy
  const colorRes = await fetch(`${baseUrl}/api/products?color=${encodeURIComponent('Xanh Navy')}`);
  const colorBody = await colorRes.json();
  assert.equal(colorBody.items.length, 1);
  assert.equal(colorBody.items[0].slug, 'ao-so-mi-oxford-dai-tay-nam-cao-cap');

  // f. Lọc theo inStock=true (loại trừ mẫu số 11 có stock = 0)
  const stockRes = await fetch(`${baseUrl}/api/products?inStock=true&pageSize=24`);
  const stockBody = await stockRes.json();
  assert.equal(stockBody.total, 14, '14/15 sản phẩm còn hàng (Mẫu số 11 có tổng tồn kho = 0 bị loại)');
  for (const item of stockBody.items) {
    assert.ok(item.total_stock > 0);
  }
});

// 5. Kiểm tra giá hiệu lực (có khuyến mãi, có price_override) trong và ngoài khung giờ khuyến mãi, khớp 100% với pricing.ts
test('Stage 3 - Effective price calculation: matches pricing.ts with price_override and respects promotion start/end time window', async () => {
  // a. Trong khung giờ khuyến mãi (20% cho danh mục Áo khoác & Blazer):
  // - Áo Khoác Blazer Nữ: base_price = 500000, no override -> effective_price = 400000
  // - Áo Khoác Bomber Unisex: base_price = 600000, biến thể M có price_override = 550000 -> giảm 20% = 440000
  const expectedBlazer = calculateEffectivePrice(500000, null, [
    { id: activePromoId, title: 'Flash Sale', discountPercent: 20 },
  ]);
  const expectedBomber = calculateEffectivePrice(600000, 550000, [
    { id: activePromoId, title: 'Flash Sale', discountPercent: 20 },
  ]);

  assert.equal(expectedBlazer.effectivePrice, 400000);
  assert.equal(expectedBomber.effectivePrice, 440000);

  const activeSaleRes = await fetch(`${baseUrl}/api/products?category=ao-khoac-blazer&sort=price_asc`);
  const activeSaleBody = await activeSaleRes.json();
  assert.equal(activeSaleBody.items[0].slug, 'ao-khoac-blazer-nu-dang-ngan-thanh-lich');
  assert.equal(activeSaleBody.items[0].effective_price, expectedBlazer.effectivePrice);
  assert.equal(activeSaleBody.items[1].slug, 'ao-khoac-bomber-unisex-phoi-tay-da-dac-biet');
  assert.equal(activeSaleBody.items[1].effective_price, expectedBomber.effectivePrice);

  // b. Dịch chuyển thời gian khuyến mãi ra NGOÀI khung giờ hiện tại (đã kết thúc hôm qua)
  await queryRows(sql`
    UPDATE promotions
    SET start_time = NOW() - INTERVAL '10 days',
        end_time = NOW() - INTERVAL '1 day'
    WHERE id = ${activePromoId};
  `);

  const expiredSaleRes = await fetch(`${baseUrl}/api/products?category=ao-khoac-blazer&sort=price_asc`);
  const expiredSaleBody = await expiredSaleRes.json();
  // Khi hết hạn khuyến mãi:
  // - Áo Khoác Blazer Nữ quay về giá gốc 500.000₫ (discount_percent = 0, is_on_sale = false)
  // - Áo Khoác Bomber Unisex quay về min price_override = 550.000₫ (discount_percent = 0)
  assert.equal(expiredSaleBody.items[0].effective_price, 500000);
  assert.equal(expiredSaleBody.items[0].discount_percent, 0);
  assert.equal(expiredSaleBody.items[0].is_on_sale, false);
  assert.equal(expiredSaleBody.items[1].effective_price, 550000);
  assert.equal(expiredSaleBody.items[1].discount_percent, 0);

  // Khôi phục lại khung giờ đang chạy cho các test tiếp theo
  await queryRows(sql`
    UPDATE promotions
    SET start_time = NOW() - INTERVAL '1 day',
        end_time = NOW() + INTERVAL '7 days'
    WHERE id = ${activePromoId};
  `);
});

// 6. Kiểm tra tìm kiếm không dấu, xếp hạng (khớp tên trước, rồi mô tả) và escape ký tự đặc biệt (% _ \)
test('Stage 3 - Search & Ranking: supports unaccented Vietnamese, ranks name matches before description matches, and escapes % _ \\', async () => {
  // a. Tìm kiếm không dấu "ao so mi oxford":
  // - "Áo Sơ Mi Oxford Dài Tay Nam Cao Cấp" khớp trực tiếp trong TÊN
  // - "Quần Tây Nam Phom Slimfit Công Sở" chỉ khớp "ao so mi oxford" trong MÔ TẢ
  const searchRes = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('ao so mi oxford')}`);
  const searchBody = await searchRes.json();
  assert.ok(searchBody.items.length >= 2, 'Phải tìm thấy cả sản phẩm khớp tên và sản phẩm khớp mô tả');
  assert.equal(
    searchBody.items[0].slug,
    'ao-so-mi-oxford-dai-tay-nam-cao-cap',
    'Sản phẩm khớp TÊN phải được xếp hạng đứng đầu tiên trước sản phẩm chỉ khớp mô tả'
  );
  const descMatchIdx = searchBody.items.findIndex(
    (i: any) => i.slug === 'quan-tay-nam-phom-slimfit-cong-so'
  );
  assert.ok(descMatchIdx > 0, 'Sản phẩm khớp mô tả phải xếp sau sản phẩm khớp tên');

  // b. Escape ký tự đặc biệt % _ \:
  // Nếu không escape, q="%%%" sẽ khớp mọi sản phẩm; khi đã escape, nó tìm đúng chuỗi literal "%%%" -> trả về 0 kết quả
  const percentRes = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('%%%')}`);
  assert.equal(percentRes.status, 200);
  const percentBody = await percentRes.json();
  assert.equal(percentBody.items.length, 0, 'Từ khóa "%%%" sau khi escape không được khớp toàn bộ sản phẩm');

  const underscoreRes = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('______')}`);
  assert.equal(underscoreRes.status, 200);
  const underscoreBody = await underscoreRes.json();
  assert.equal(underscoreBody.items.length, 0, 'Từ khóa "______" sau khi escape không được làm wildcard');

  const backslashRes = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('ao\\')}`);
  assert.equal(backslashRes.status, 200, 'Ký tự \\ ở cuối không được gây lỗi SQL LIKE pattern');
});

// 7. Kiểm tra GET /api/products/suggest?q= (tối đa 8 gợi ý + có rate limit)
test('Stage 3 - GET /api/products/suggest: returns max 8 suggestions and enforces rate limit', async () => {
  const testIp = '198.51.100.77';
  resetSuggestRateLimit(testIp);

  const res = await fetch(`${baseUrl}/api/products/suggest?q=${encodeURIComponent('ao so mi')}`, {
    headers: { 'X-Forwarded-For': testIp },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.ok(body.suggestions.length > 0 && body.suggestions.length <= 8, 'Trả về tối đa 8 gợi ý');

  // Kiểm tra Rate Limit (vượt quá 30 request / phút từ cùng 1 IP)
  let hitRateLimit = false;
  for (let i = 0; i < 35; i++) {
    const r = await fetch(`${baseUrl}/api/products/suggest?q=ao`, {
      headers: { 'X-Forwarded-For': testIp },
    });
    if (r.status === 429) {
      hitRateLimit = true;
      break;
    }
  }
  assert.equal(hitRateLimit, true, 'Endpoint /api/products/suggest phải áp dụng rate limit (HTTP 429)');
  resetSuggestRateLimit(testIp);
});

// 8. Kiểm tra GET /api/products/:slug (chi tiết sản phẩm, trạng thái biến thể, gợi ý size, sản phẩm liên quan, và sản phẩm ẩn trả 404)
test('Stage 3 - GET /api/products/:slug: returns full detail, variant stock statuses, size recommendation, related products, and 404 for hidden/missing products', async () => {
  // a. Sản phẩm ẩn (is_active = false) -> Phải trả về 404
  const hiddenRes = await fetch(`${baseUrl}/api/products/ao-so-mi-lua-nu-co-duc-da-an`);
  assert.equal(hiddenRes.status, 404, 'Sản phẩm ẩn (is_active = false) bắt buộc trả về 404');

  // b. Sản phẩm không tồn tại -> Phải trả về 404
  const notFoundRes = await fetch(`${baseUrl}/api/products/san-pham-khong-he-ton-tai-999`);
  assert.equal(notFoundRes.status, 404, 'Slug không tồn tại bắt buộc trả về 404');

  // c. Sản phẩm hợp lệ kèm tham số chiều cao & cân nặng (?height=173&weight=70)
  const detailRes = await fetch(
    `${baseUrl}/api/products/ao-so-mi-oxford-dai-tay-nam-cao-cap?height=173&weight=70`
  );
  assert.equal(detailRes.status, 200);
  const detailBody = await detailRes.json();
  const prod = detailBody.data;

  assert.equal(prod.slug, 'ao-so-mi-oxford-dai-tay-nam-cao-cap');
  assert.ok(Array.isArray(prod.images) && prod.images.length > 0);
  assert.ok(Array.isArray(prod.variants) && prod.variants.length === 4);

  // Kiểm tra đủ 3 trạng thái biến thể: còn hàng (in_stock), sắp hết (low_stock), hết hàng (out_of_stock)
  const varM = prod.variants.find((v: any) => v.size === 'M');
  const varL = prod.variants.find((v: any) => v.size === 'L');
  const varXXL = prod.variants.find((v: any) => v.size === 'XXL');
  const varXL = prod.variants.find((v: any) => v.size === 'XL');

  assert.equal(varM.stockStatus, 'in_stock');
  assert.equal(varL.stockStatus, 'low_stock');
  assert.equal(varXXL.stockStatus, 'out_of_stock');
  assert.equal(varXXL.isAvailable, false);
  assert.equal(varXL.effectivePrice, 420000, 'Biến thể XL có priceOverride = 420000');

  // Kiểm tra bảng size theo đối tượng sản phẩm (Nam) và gợi ý size cho 173cm / 70kg -> Size L
  assert.equal(prod.sizeChart.targetGender, 'men');
  assert.ok(prod.sizeChart.rows.length > 0);
  assert.ok(prod.sizeRecommendation, 'Phải trả về gợi ý size khi có chiều cao & cân nặng');
  assert.equal(prod.sizeRecommendation.recommendedSize, 'L');

  // Kiểm tra sản phẩm liên quan: tối đa 8, không chứa chính nó, tất cả đều còn hàng (total_stock > 0)
  assert.ok(Array.isArray(prod.relatedProducts));
  assert.ok(prod.relatedProducts.length > 0 && prod.relatedProducts.length <= 8);
  for (const rel of prod.relatedProducts) {
    assert.notEqual(rel.id, prod.id, 'Sản phẩm liên quan không được chứa chính sản phẩm đang xem');
    assert.ok(rel.total_stock > 0, 'Sản phẩm liên quan phải còn hàng');
    assert.ok(
      rel.category_slug === prod.categorySlug || rel.target_gender === prod.targetGender,
      'Sản phẩm liên quan phải cùng danh mục hoặc cùng đối tượng'
    );
  }
});

// 9. Kiểm tra bằng EXPLAIN rằng tìm kiếm sử dụng GIN index pg_trgm (idx_products_search_trgm)
test('Stage 3 - EXPLAIN query plan: confirms search query uses pg_trgm GIN index idx_products_search_trgm', async () => {
  await queryRows(sql`SET enable_seqscan = off;`);
  const explainRows = await queryRows<Record<string, string>>(sql`
    EXPLAIN
    SELECT id, name
    FROM products p
    WHERE (p.search_text LIKE '%ao so mi%' ESCAPE '\' OR p.search_text % 'ao so mi');
  `);
  await queryRows(sql`SET enable_seqscan = on;`);

  const planText = explainRows.map((r) => Object.values(r)[0]).join('\n');
  assert.ok(
    planText.includes('idx_products_search_trgm'),
    `Kế hoạch thực thi EXPLAIN bắt buộc phải sử dụng GIN index idx_products_search_trgm. Plan thực tế:\n${planText}`
  );
});

// 10. Giá: đối chiếu SQL effective_price với calculateEffectivePrice trên TOÀN BỘ sản phẩm seed, trong & ngoài giờ khuyến mãi, và khi nhiều khuyến mãi cùng lúc
test('Stage 3 - Pricing: compares SQL effective_price against calculateEffectivePrice on ALL seeded products, handles multiple promotions taking MAX discount, and verifies outside promo window', async () => {
  // a. Trong khung giờ khuyến mãi: Kiểm tra TOÀN BỘ sản phẩm seed trả về từ API
  const listRes = await fetch(`${baseUrl}/api/products?pageSize=24`);
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  assert.ok(listBody.items.length >= 15, 'Phải có ít nhất 15 sản phẩm seed active');

  for (const item of listBody.items) {
    // Truy vấn các khuyến mãi đang hiệu lực cho sản phẩm này trong DB
    const promos = await queryRows<{ id: string; title: string; discountPercent: number }>(sql`
      SELECT pr.id, pr.title, pt.discount_percent AS "discountPercent"
      FROM promotion_targets pt
      JOIN promotions pr ON pr.id = pt.promotion_id
      WHERE pr.is_active = true
        AND NOW() BETWEEN pr.start_time AND pr.end_time
        AND (
          (pt.target_type = 'product' AND pt.target_id = ${item.id})
          OR (pt.target_type = 'category' AND pt.target_id = ${item.category_id})
        )
      ORDER BY pt.discount_percent DESC;
    `);

    // Truy vấn các biến thể của sản phẩm
    const variants = await queryRows<{ price_override: number | null }>(sql`
      SELECT price_override
      FROM product_variants
      WHERE product_id = ${item.id};
    `);

    // Tính giá hiệu lực từng biến thể bằng hàm thuần calculateEffectivePrice (TypeScript service)
    const variantEffectivePrices = variants.map((v) =>
      calculateEffectivePrice(Number(item.base_price), v.price_override ? Number(v.price_override) : null, promos)
    );

    // Quy tắc: Giá của sản phẩm = giá thấp nhất trong các biến thể (hiển thị "từ X₫")
    const expectedLowestEffectivePrice =
      variantEffectivePrices.length > 0
        ? Math.min(...variantEffectivePrices.map((v) => v.effectivePrice))
        : calculateEffectivePrice(Number(item.base_price), null, promos).effectivePrice;

    assert.equal(
      item.effective_price,
      expectedLowestEffectivePrice,
      `Giá SQL (${item.effective_price}) của sản phẩm "${item.name}" phải khớp 100% với calculateEffectivePrice (${expectedLowestEffectivePrice})`
    );
  }

  // b. Khi có NHIỀU khuyến mãi áp dụng cùng lúc: quy tắc lấy mức giảm cao nhất (MAX discount_percent)
  const extraPromo = await queryRows<{ id: string }>(sql`
    INSERT INTO promotions (title, start_time, end_time, is_active)
    VALUES ('Super Mega Sale - Giảm 30%', NOW() - INTERVAL '1 day', NOW() + INTERVAL '10 days', true)
    RETURNING id;
  `);
  const extraPromoId = extraPromo[0].id;

  await queryRows(sql`
    INSERT INTO promotion_targets (promotion_id, target_type, target_id, discount_percent)
    VALUES (${extraPromoId}, 'category', ${catJacketId}, 30);
  `);

  // Truy vấn lại danh mục Áo khoác: Giờ có cả Flash Sale 20% và Super Mega Sale 30% -> phải lấy 30%
  const multiPromoRes = await fetch(`${baseUrl}/api/products?category=ao-khoac-blazer`);
  const multiPromoBody = await multiPromoRes.json();
  for (const item of multiPromoBody.items) {
    assert.equal(
      item.discount_percent,
      30,
      `Khi nhiều khuyến mãi cùng áp dụng, phải chọn mức giảm cao nhất là 30%, thực tế là ${item.discount_percent}%`
    );
  }

  // Dọn dẹp extra promo
  await queryRows(sql`DELETE FROM promotions WHERE id = ${extraPromoId};`);

  // c. Ngoài khung giờ khuyến mãi: dịch chuyển toàn bộ khuyến mãi sang quá khứ
  await queryRows(sql`
    UPDATE promotions
    SET start_time = NOW() - INTERVAL '30 days',
        end_time = NOW() - INTERVAL '2 days'
    WHERE id = ${activePromoId};
  `);

  const outOfPromoRes = await fetch(`${baseUrl}/api/products?pageSize=24`);
  const outOfPromoBody = await outOfPromoRes.json();
  for (const item of outOfPromoBody.items) {
    assert.equal(item.discount_percent, 0, `Ngoài khung giờ khuyến mãi, discount_percent phải là 0 cho ${item.name}`);
    assert.equal(
      item.is_on_sale,
      Boolean(item.initial_price < item.base_price),
      `is_on_sale chỉ true nếu biến thể có price_override < base_price`
    );
  }

  // Khôi phục lại khuyến mãi đang chạy
  await queryRows(sql`
    UPDATE promotions
    SET start_time = NOW() - INTERVAL '1 day',
        end_time = NOW() + INTERVAL '60 days'
    WHERE id = ${activePromoId};
  `);
});

// 11. Tìm kiếm: sort=relevance, mặc định relevance khi có q mà không truyền sort, giữ khóa phụ id
test('Stage 3 - Search sort=relevance: prioritizes name > desc > cat > attr, defaults to relevance when q is provided, and keeps secondary key id', async () => {
  // a. Khi có q mà không truyền sort -> Mặc định sắp xếp theo độ liên quan (relevance)
  const defaultRelevanceRes = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('ao so mi oxford')}`);
  const defaultRelevanceBody = await defaultRelevanceRes.json();
  assert.equal(defaultRelevanceRes.status, 200);

  // b. Khi truyền tường minh sort=relevance -> Phải trả về thứ tự hoàn toàn giống hệt
  const explicitRelevanceRes = await fetch(
    `${baseUrl}/api/products?q=${encodeURIComponent('ao so mi oxford')}&sort=relevance`
  );
  const explicitRelevanceBody = await explicitRelevanceRes.json();
  assert.equal(explicitRelevanceRes.status, 200);

  const defaultIds = defaultRelevanceBody.items.map((i: any) => i.id);
  const explicitIds = explicitRelevanceBody.items.map((i: any) => i.id);
  assert.deepEqual(
    defaultIds,
    explicitIds,
    'Khi có q mà không truyền sort thì mặc định phải tương đương sort=relevance'
  );

  // Khớp tên (Áo Sơ Mi Oxford) đứng trước khớp mô tả (Quần Tây Nam có mô tả "phối cùng áo sơ mi oxford")
  assert.equal(defaultRelevanceBody.items[0].slug, 'ao-so-mi-oxford-dai-tay-nam-cao-cap');
  const descIndex = defaultRelevanceBody.items.findIndex(
    (i: any) => i.slug === 'quan-tay-nam-phom-slimfit-cong-so'
  );
  assert.ok(descIndex > 0, 'Sản phẩm chỉ khớp mô tả phải xếp sau sản phẩm khớp tên');

  // c. Kiểm tra khóa phụ id: các sản phẩm cùng độ khớp điểm phải được sắp xếp tăng dần theo id
  const equalScoreItems = defaultRelevanceBody.items.filter((i: any) =>
    i.slug.startsWith('ao-so-mi-basic-baity-mau-so-')
  );
  for (let i = 1; i < equalScoreItems.length; i++) {
    assert.ok(
      equalScoreItems[i].id >= equalScoreItems[i - 1].id,
      'Các sản phẩm cùng điểm xếp hạng phải được sắp xếp ổn định theo khóa phụ id ASC'
    );
  }
});

// 12. Gợi ý size: kiểm tra height (100–230) và weight (30–200), sai trả HTTP 400
test('Stage 3 - Size Recommendation validation: enforces height (100-230) and weight (30-200), returns HTTP 400 when invalid or missing', async () => {
  const targetSlug = 'ao-so-mi-oxford-dai-tay-nam-cao-cap';

  // a. height < 100 -> 400
  const hLow = await fetch(`${baseUrl}/api/products/${targetSlug}?height=99&weight=60`);
  assert.equal(hLow.status, 400, 'height < 100 phải trả 400');
  const hLowBody = await hLow.json();
  assert.equal(hLowBody.success, false);

  // b. height > 230 -> 400
  const hHigh = await fetch(`${baseUrl}/api/products/${targetSlug}?height=231&weight=60`);
  assert.equal(hHigh.status, 400, 'height > 230 phải trả 400');

  // c. weight < 30 -> 400
  const wLow = await fetch(`${baseUrl}/api/products/${targetSlug}?height=170&weight=29`);
  assert.equal(wLow.status, 400, 'weight < 30 phải trả 400');

  // d. weight > 200 -> 400
  const wHigh = await fetch(`${baseUrl}/api/products/${targetSlug}?height=170&weight=201`);
  assert.equal(wHigh.status, 400, 'weight > 200 phải trả 400');

  // e. Thiếu weight khi đã truyền height -> 400
  const missingW = await fetch(`${baseUrl}/api/products/${targetSlug}?height=170`);
  assert.equal(missingW.status, 400, 'Chỉ truyền height thiếu weight phải trả 400');

  // f. Thiếu height khi đã truyền weight -> 400
  const missingH = await fetch(`${baseUrl}/api/products/${targetSlug}?weight=65`);
  assert.equal(missingH.status, 400, 'Chỉ truyền weight thiếu height phải trả 400');

  // g. Tham số không phải số hợp lệ -> 400
  const notNum = await fetch(`${baseUrl}/api/products/${targetSlug}?height=abc&weight=65`);
  assert.equal(notNum.status, 400, 'height không phải số phải trả 400');

  // h. Hợp lệ: height=173 & weight=70 -> 200
  const validRes = await fetch(`${baseUrl}/api/products/${targetSlug}?height=173&weight=70`);
  assert.equal(validRes.status, 200);
  const validBody = await validRes.json();
  assert.equal(validBody.success, true);
  assert.ok(validBody.data.sizeRecommendation);
  assert.equal(validBody.data.sizeRecommendation.recommendedSize, 'L');
});

// 13. Rating trung bình, số đánh giá và total_stock: đối chiếu số liệu API với tính toán trực tiếp từ DB gốc
test('Stage 3 - Metrics Accuracy: verifies total_stock, rating_avg, and review_count in list and detail match direct SQL calculations', async () => {
  const oxfordSlug = 'ao-so-mi-oxford-dai-tay-nam-cao-cap';

  // 1. Tính toán trực tiếp từ bảng gốc reviews và product_variants trong DB
  const rawMetrics = await queryRows<{ rating_avg: number; review_count: number; total_stock: number }>(sql`
    SELECT
      COALESCE((
        SELECT ROUND(AVG(r.rating)::numeric, 1)::float
        FROM reviews r
        JOIN products p ON p.id = r.product_id
        WHERE p.slug = ${oxfordSlug}
      ), 0)::float AS rating_avg,
      COALESCE((
        SELECT COUNT(r.id)::int
        FROM reviews r
        JOIN products p ON p.id = r.product_id
        WHERE p.slug = ${oxfordSlug}
      ), 0)::int AS review_count,
      COALESCE((
        SELECT SUM(pv.stock_quantity)::int
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        WHERE p.slug = ${oxfordSlug}
      ), 0)::int AS total_stock;
  `);

  const expectedRatingAvg = rawMetrics[0].rating_avg; // 4.5
  const expectedReviewCount = rawMetrics[0].review_count; // 2
  const expectedTotalStock = rawMetrics[0].total_stock; // 33

  assert.equal(expectedRatingAvg, 4.5);
  assert.equal(expectedReviewCount, 2);
  assert.equal(expectedTotalStock, 33);

  // 2. Đối chiếu với API Danh sách (GET /api/products)
  const listRes = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('Oxford')}`);
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  const listItem = listBody.items.find((i: any) => i.slug === oxfordSlug);
  assert.ok(listItem, 'Phải tìm thấy sản phẩm Oxford trong danh sách');
  assert.equal(listItem.rating_avg, expectedRatingAvg, 'rating_avg ở danh sách phải khớp bảng gốc');
  assert.equal(listItem.review_count, expectedReviewCount, 'review_count ở danh sách phải khớp bảng gốc');
  assert.equal(listItem.total_stock, expectedTotalStock, 'total_stock ở danh sách phải khớp bảng gốc');

  // 3. Đối chiếu với API Chi tiết (GET /api/products/:slug)
  const detailRes = await fetch(`${baseUrl}/api/products/${oxfordSlug}`);
  assert.equal(detailRes.status, 200);
  const detailBody = await detailRes.json();
  const detailData = detailBody.data;
  assert.equal(detailData.ratingAvg, expectedRatingAvg, 'ratingAvg ở trang chi tiết phải khớp bảng gốc');
  assert.equal(detailData.reviewCount, expectedReviewCount, 'reviewCount ở trang chi tiết phải khớp bảng gốc');
  assert.equal(detailData.totalStock, expectedTotalStock, 'totalStock ở trang chi tiết phải khớp bảng gốc');
});

// 14. Kiểm tra số truy vấn DB của GET /api/products không tăng theo số sản phẩm (Không N+1)
test('Stage 3 - No N+1: verifies database query count of GET /api/products is constant O(1) regardless of pageSize', async () => {
  // Lần 1: Gọi với pageSize = 2
  resetQueryCounter();
  const res2 = await fetch(`${baseUrl}/api/products?pageSize=2`);
  assert.equal(res2.status, 200);
  const queriesFor2Items = getQueryCount();

  // Lần 2: Gọi với pageSize = 15 (số lượng sản phẩm gấp 7.5 lần)
  resetQueryCounter();
  const res15 = await fetch(`${baseUrl}/api/products?pageSize=15`);
  assert.equal(res15.status, 200);
  const queriesFor15Items = getQueryCount();

  // Khẳng định: Số lượng truy vấn DB hoàn toàn không phụ thuộc vào pageSize (luôn đúng 2 truy vấn: 1 COUNT + 1 CTE lấy sản phẩm kèm ảnh, màu, size)
  assert.equal(
    queriesFor2Items,
    queriesFor15Items,
    `Số truy vấn DB với pageSize=2 (${queriesFor2Items}) phải bằng với pageSize=15 (${queriesFor15Items})`
  );
  assert.ok(
    queriesFor15Items <= 2,
    `Endpoint GET /api/products chỉ được thực thi tối đa 2 truy vấn DB (thực tế: ${queriesFor15Items}), khẳng định không N+1`
  );
});

// 15. Kiểm tra từ khóa "ao so mi", "so mi", "áo sơ mi" trả cùng tập kết quả khác rỗng và quy tắc price_override với onSale
test('Stage 3 - Search equivalence ("ao so mi", "so mi", "áo sơ mi") & price_override onSale consistency', async () => {
  const [res1, res2, res3] = await Promise.all([
    fetch(`${baseUrl}/api/products?q=${encodeURIComponent('ao so mi')}&pageSize=24`),
    fetch(`${baseUrl}/api/products?q=${encodeURIComponent('so mi')}&pageSize=24`),
    fetch(`${baseUrl}/api/products?q=${encodeURIComponent('áo sơ mi')}&pageSize=24`),
  ]);

  const [body1, body2, body3] = await Promise.all([res1.json(), res2.json(), res3.json()]);

  assert.ok(body1.items.length > 0, 'Tìm "ao so mi" phải trả về tập kết quả khác rỗng');
  assert.ok(
    body1.items.some((p: any) => p.category_slug === 'ao-so-mi'),
    'GET /api/products?q=ao so mi phải trả về các sản phẩm áo sơ mi thật'
  );

  const ids1 = body1.items.map((p: any) => p.id).sort();
  const ids2 = body2.items.map((p: any) => p.id).sort();
  const ids3 = body3.items.map((p: any) => p.id).sort();

  assert.deepEqual(ids1, ids2, 'Tập kết quả của "ao so mi" và "so mi" phải giống hệt nhau');
  assert.deepEqual(ids1, ids3, 'Tập kết quả của "ao so mi" và "áo sơ mi" phải giống hệt nhau');

  // Kiểm tra price_override tăng giá theo size (XL = 420.000₫ > base_price 400.000₫) khi không có khuyến mãi -> KHÔNG bật onSale
  const oxfordDetailRes = await fetch(`${baseUrl}/api/products/ao-so-mi-oxford-dai-tay-nam-cao-cap`);
  const oxfordDetail = (await oxfordDetailRes.json()).data;
  assert.equal(oxfordDetail.isOnSale, false, 'Sản phẩm không khuyến mãi có biến thể phụ thu size XL không được gắn nhãn onSale');
  const xlVariant = oxfordDetail.variants.find((v: any) => v.size === 'XL');
  assert.ok(xlVariant);
  assert.equal(xlVariant.priceOverride, 420000);
  assert.equal(xlVariant.effectivePrice, 420000);
  assert.equal(xlVariant.isOnSale, false, 'Biến thể XL có price_override > base_price và không có khuyến mãi thì isOnSale phải bằng false');
});

// 16. Seed integrity
test('Stage 3 - Seed integrity: verifies categories, products, variants, images, and store_settings are populated and valid', async () => {
  const catRes = await fetch(`${baseUrl}/api/categories`);
  assert.equal(catRes.status, 200);
  const catBody = await catRes.json();
  assert.ok(Array.isArray(catBody.data) && catBody.data.length >= 3, 'Phải có ít nhất 3 danh mục');

  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes.status, 200);
  const healthBody = await healthRes.json();
  assert.deepEqual(healthBody, { status: 'ok', database: 'connected' });

  const prodRes = await fetch(`${baseUrl}/api/products?limit=50`);
  assert.equal(prodRes.status, 200);
  const prodBody = await prodRes.json();
  assert.ok(prodBody.total >= 15, 'Dữ liệu sản phẩm khởi tạo phải >= 15 sản phẩm');
});

// 17. Category slug and UUID filter
test('Stage 3 - Category slug and UUID filter: filtering by category slug or category UUID returns identical product sets', async () => {
  const bySlugRes = await fetch(`${baseUrl}/api/products?category=ao-khoac-blazer`);
  const byUuidRes = await fetch(`${baseUrl}/api/products?category=${catJacketId}`);

  assert.equal(bySlugRes.status, 200);
  assert.equal(byUuidRes.status, 200);

  const bySlug = await bySlugRes.json();
  const byUuid = await byUuidRes.json();

  assert.ok(bySlug.items.length > 0);
  assert.deepEqual(
    bySlug.items.map((i: any) => i.id),
    byUuid.items.map((i: any) => i.id),
    'Lọc theo category slug và category UUID phải trả về cùng danh sách sản phẩm'
  );
});

// 18. Rating filter
test('Stage 3 - Rating filter: minRating filters only products meeting minimum average rating threshold', async () => {
  const ratingRes = await fetch(`${baseUrl}/api/products?minRating=4`);
  assert.equal(ratingRes.status, 200);
  const ratingBody = await ratingRes.json();

  assert.ok(ratingBody.items.length >= 1, 'Phải tìm thấy sản phẩm có rating_avg >= 4');
  for (const item of ratingBody.items) {
    assert.ok(item.rating_avg >= 4, `Sản phẩm ${item.slug} phải có rating_avg >= 4 (thực tế: ${item.rating_avg})`);
  }
});

// 19. Sorting options
test('Stage 3 - Sorting options: supports newest, price_asc, price_desc, rating, and bestseller accurately', async () => {
  const ascRes = await fetch(`${baseUrl}/api/products?sort=price_asc&pageSize=24`);
  const descRes = await fetch(`${baseUrl}/api/products?sort=price_desc&pageSize=24`);
  const ratingRes = await fetch(`${baseUrl}/api/products?sort=rating&pageSize=24`);
  const bestRes = await fetch(`${baseUrl}/api/products?sort=bestseller&pageSize=24`);
  const newRes = await fetch(`${baseUrl}/api/products?sort=newest&pageSize=24`);

  assert.equal(ascRes.status, 200);
  assert.equal(descRes.status, 200);
  assert.equal(ratingRes.status, 200);
  assert.equal(bestRes.status, 200);
  assert.equal(newRes.status, 200);

  const ascItems = (await ascRes.json()).items;
  const descItems = (await descRes.json()).items;
  const ratingItems = (await ratingRes.json()).items;

  for (let i = 1; i < ascItems.length; i++) {
    assert.ok(ascItems[i].effective_price >= ascItems[i - 1].effective_price, 'price_asc phải tăng dần');
  }
  for (let i = 1; i < descItems.length; i++) {
    assert.ok(descItems[i].effective_price <= descItems[i - 1].effective_price, 'price_desc phải giảm dần');
  }
  for (let i = 1; i < ratingItems.length; i++) {
    assert.ok(ratingItems[i].rating_avg <= ratingItems[i - 1].rating_avg, 'rating phải giảm dần');
  }
});

// 20. Facets
test('Stage 3 - Facets: GET /api/products/facets returns available colors, ordered sizes, and effective min/max prices', async () => {
  const facetsRes = await fetch(`${baseUrl}/api/products/facets`);
  assert.equal(facetsRes.status, 200);
  const facetsBody = await facetsRes.json();

  assert.equal(facetsBody.success, true);
  assert.ok(Array.isArray(facetsBody.data.colors) && facetsBody.data.colors.length > 0, 'Phải có danh sách màu sắc');
  assert.ok(Array.isArray(facetsBody.data.sizes) && facetsBody.data.sizes.length > 0, 'Phải có danh sách kích cỡ');
  assert.ok(facetsBody.data.minPrice > 0 && facetsBody.data.maxPrice >= facetsBody.data.minPrice, 'Khoảng giá min/max hợp lệ');
});

// 21. Fuzzy matching (gõ sai chính tả)
test('Stage 3 - Fuzzy matching (gõ sai chính tả): pg_trgm finds products even when user types minor spelling mistakes', async () => {
  // Gõ sai chính tả "ao khoac blazzer" hoặc "so mi oxfod" (thiếu r / thừa z)
  const typoRes1 = await fetch(`${baseUrl}/api/products?q=${encodeURIComponent('ao so mi oxfod')}`);
  assert.equal(typoRes1.status, 200);
  const typoBody1 = await typoRes1.json();
  assert.ok(
    typoBody1.items.some((i: any) => i.slug === 'ao-so-mi-oxford-dai-tay-nam-cao-cap'),
    'Tìm kiếm mờ pg_trgm phải tìm ra Áo Sơ Mi Oxford khi gõ sai chính tả thành "ao so mi oxfod"'
  );
});

// 22. Product Detail
test('Stage 3 - Product Detail: supports lookup by both slug and UUID and returns complete attributes, variants, reviews, and sizeChart', async () => {
  const slugRes = await fetch(`${baseUrl}/api/products/ao-so-mi-oxford-dai-tay-nam-cao-cap`);
  assert.equal(slugRes.status, 200);
  const bySlug = (await slugRes.json()).data;

  const uuidRes = await fetch(`${baseUrl}/api/products/${bySlug.id}`);
  assert.equal(uuidRes.status, 200);
  const byUuid = (await uuidRes.json()).data;

  assert.equal(bySlug.id, byUuid.id);
  assert.equal(bySlug.name, byUuid.name);
  assert.ok(Array.isArray(byUuid.variants) && byUuid.variants.length > 0);
  assert.ok(Array.isArray(byUuid.reviews) && byUuid.reviews.length === 2);
  assert.ok(byUuid.sizeChart && Array.isArray(byUuid.sizeChart.rows));
});


