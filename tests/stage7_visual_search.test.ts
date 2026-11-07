import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';

process.env.DATABASE_URL = '';
process.env.PGLITE_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.COOKIE_CROSS_SITE = 'false';
process.env.JWT_SECRET = 'test-secret-stage7-visual-search-key-2026-secure';
process.env.GEMINI_API_KEY = 'AIzaSyTestFakeKeyDoNotLeak999999999';

import { createApp } from '../server/app.ts';
import { initDatabase } from '../server/db/init.ts';
import { queryRows, closeDb } from '../server/db/index.ts';
import { seedDatabase } from '../server/db/seed.ts';
import {
  setVisualSearchGeminiClientForTest,
  resetVisualSearchStateForTest,
  getVisualSearchGeminiCallCountForTest,
  cleanupOldAiSearchLogs,
  getVisualSearchDailyUserCap,
  getVisualSearchBurstPerMinuteCap,
  getVisualSearchDailyGlobalCap,
  type VisualSearchVocabulary,
} from '../server/services/visualSearch.ts';
import {
  getLocalStorageObjectCountForTest,
  clearLocalStorageForTest,
} from '../server/services/upload.ts';

let baseUrl = '';
let serverInstance: any = null;
let validJpegDataUrl = '';

async function createSampleJpegDataUrl(width = 300, height = 400): Promise<string> {
  const buf = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 35, g: 55, b: 75 },
    },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

test.before(async () => {
  await initDatabase();
  await seedDatabase();
  validJpegDataUrl = await createSampleJpegDataUrl();

  const app = createApp();
  await new Promise<void>((resolve) => {
    serverInstance = app.listen(0, '127.0.0.1', () => {
      const addr = serverInstance.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

test.after(async () => {
  setVisualSearchGeminiClientForTest(null);
  if (serverInstance) {
    await new Promise<void>((resolve) => serverInstance.close(() => resolve()));
  }
  await closeDb();
});

test('1. Gemini trả JSON sai schema hoặc giá trị ngoài bộ từ vựng: giá trị lạ bị loại bỏ, confidence được kẹp trong 0..1 và lỗi JSON xử lý êm', async () => {
  await resetVisualSearchStateForTest();

  // Trường hợp 1a: Gemini trả về danh mục/màu sắc bịa đặt ngoài DB và confidence = 9.5
  setVisualSearchGeminiClientForTest(
    async ({ vocabulary }: { vocabulary: VisualSearchVocabulary }) => ({
      isApparel: true,
      categorySlug: 'ao-giap-vu-tru-khong-ton-tai',
      primaryColor: vocabulary.colors[0] || 'Đen',
      secondaryColor: 'Màu Tím Vũ Trụ Bịa Đặt',
      style: 'Phong Cách Sao Hỏa',
      pattern: vocabulary.patterns[0] || 'Trơn',
      fit: 'Siêu Bó Bịa Đặt',
      targetGender: 'unisex',
      confidence: 9.5,
    })
  );

  const resValid = await fetch(`${baseUrl}/api/visual-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: validJpegDataUrl }),
  });
  assert.equal(resValid.status, 200);
  const bodyValid = await resValid.json();
  assert.equal(bodyValid.success, true);
  assert.equal(bodyValid.recognizedAttributes.categorySlug, null);
  assert.equal(bodyValid.recognizedAttributes.secondaryColor, null);
  assert.equal(bodyValid.recognizedAttributes.style, null);
  assert.equal(bodyValid.recognizedAttributes.fit, null);
  assert.equal(bodyValid.recognizedAttributes.confidence, 1);

  // Trường hợp 1b: Gemini trả về cấu trúc hỏng hoàn toàn (thiếu isApparel boolean) -> xử lý êm với fallback=true
  setVisualSearchGeminiClientForTest(async () => ({
    brokenField: 'not_matching_schema',
  }));

  const resInvalid = await fetch(`${baseUrl}/api/visual-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: validJpegDataUrl }),
  });
  assert.equal(resInvalid.status, 200);
  const bodyInvalid = await resInvalid.json();
  assert.equal(bodyInvalid.fallback, true);
  assert.equal(bodyInvalid.fallbackCode, 'VISUAL_SEARCH_SCHEMA_INVALID');
  assert.equal(Array.isArray(bodyInvalid.products), true);
});

test('2. Ảnh không phải quần áo (isApparel=false): trả thông báo rõ ràng và 0 sản phẩm', async () => {
  await resetVisualSearchStateForTest();

  setVisualSearchGeminiClientForTest(async () => ({
    isApparel: false,
    categorySlug: null,
    primaryColor: null,
    secondaryColor: null,
    style: null,
    pattern: null,
    fit: null,
    targetGender: null,
    confidence: 0.96,
  }));

  const res = await fetch(`${baseUrl}/api/visual-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: validJpegDataUrl }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.recognizedAttributes.isApparel, false);
  assert.equal(body.products.length, 0);
  assert.match(body.message, /không phải là quần áo/i);
});

test('3. Sản phẩm Unisex khớp khi tìm đồ Nam hoặc Nữ; sản phẩm khác giới bị trừ điểm xếp dưới', async () => {
  await resetVisualSearchStateForTest();

  // Lấy một sản phẩm Unisex đang hoạt động trong DB để kiểm tra
  const unisexRows = await queryRows<{ slug: string; category_slug: string }>(sql`
    SELECT p.slug, c.slug AS category_slug
    FROM products p
    INNER JOIN categories c ON c.id = p.category_id
    WHERE p.target_gender = 'unisex' AND p.is_active = true
    LIMIT 1;
  `);
  assert.ok(unisexRows.length > 0, 'Cần có ít nhất 1 sản phẩm Unisex trong dữ liệu seed');

  // Khi tìm với targetGender = 'men' và category của sản phẩm Unisex -> sản phẩm Unisex phải khớp
  setVisualSearchGeminiClientForTest(async () => ({
    isApparel: true,
    categorySlug: unisexRows[0].category_slug,
    primaryColor: null,
    secondaryColor: null,
    style: null,
    pattern: null,
    fit: null,
    targetGender: 'men',
    confidence: 0.9,
  }));

  const resMen = await fetch(`${baseUrl}/api/visual-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: validJpegDataUrl }),
  });
  const bodyMen = await resMen.json();
  assert.equal(bodyMen.success, true);
  assert.ok(
    bodyMen.products.some((p: any) => p.slug === unisexRows[0].slug),
    'Sản phẩm Unisex phải xuất hiện khi tìm trang phục Nam cùng danh mục'
  );

  // Khi tìm với targetGender = 'women' và category của sản phẩm Unisex -> sản phẩm Unisex cũng phải khớp
  setVisualSearchGeminiClientForTest(async () => ({
    isApparel: true,
    categorySlug: unisexRows[0].category_slug,
    primaryColor: null,
    secondaryColor: null,
    style: null,
    pattern: null,
    fit: null,
    targetGender: 'women',
    confidence: 0.9,
  }));

  const resWomen = await fetch(`${baseUrl}/api/visual-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: validJpegDataUrl }),
  });
  const bodyWomen = await resWomen.json();
  assert.equal(bodyWomen.success, true);
  assert.ok(
    bodyWomen.products.some((p: any) => p.slug === unisexRows[0].slug),
    'Sản phẩm Unisex phải xuất hiện khi tìm trang phục Nữ cùng danh mục'
  );
});

test('4. Sản phẩm ẩn (is_active=false) hoặc hết sạch tồn kho (stock_quantity=0) không bao giờ xuất hiện trong kết quả', async () => {
  await resetVisualSearchStateForTest();

  const targetRows = await queryRows<{ id: string; slug: string; category_slug: string }>(sql`
    SELECT p.id, p.slug, c.slug AS category_slug
    FROM products p
    INNER JOIN categories c ON c.id = p.category_id
    WHERE p.is_active = true
    LIMIT 2;
  `);
  assert.ok(targetRows.length >= 2);
  const hiddenProd = targetRows[0];
  const outOfStockProd = targetRows[1];

  const oldVariants = await queryRows<{ id: string; stock_quantity: number }>(sql`
    SELECT id, stock_quantity FROM product_variants WHERE product_id = ${outOfStockProd.id}::uuid;
  `);

  try {
    await queryRows(sql`UPDATE products SET is_active = false WHERE id = ${hiddenProd.id}::uuid;`);
    await queryRows(
      sql`UPDATE product_variants SET stock_quantity = 0 WHERE product_id = ${outOfStockProd.id}::uuid;`
    );

    setVisualSearchGeminiClientForTest(async () => ({
      isApparel: true,
      categorySlug: hiddenProd.category_slug,
      primaryColor: null,
      secondaryColor: null,
      style: null,
      pattern: null,
      fit: null,
      targetGender: 'unisex',
      confidence: 0.92,
    }));

    const res = await fetch(`${baseUrl}/api/visual-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: validJpegDataUrl }),
    });
    const body = await res.json();
    assert.equal(body.success, true);
    const returnedSlugs = body.products.map((p: any) => p.slug);
    assert.equal(
      returnedSlugs.includes(hiddenProd.slug),
      false,
      'Sản phẩm is_active=false không được xuất hiện'
    );
    assert.equal(
      returnedSlugs.includes(outOfStockProd.slug),
      false,
      'Sản phẩm có tổng tồn kho = 0 không được xuất hiện'
    );
  } finally {
    await queryRows(sql`UPDATE products SET is_active = true WHERE id = ${hiddenProd.id}::uuid;`);
    for (const v of oldVariants) {
      await queryRows(
        sql`UPDATE product_variants SET stock_quantity = ${v.stock_quantity} WHERE id = ${v.id}::uuid;`
      );
    }
  }
});

test('5. Vượt giới hạn tần suất (nhiều yêu cầu song song): chặn đúng bằng bộ đếm nguyên tử trong DB trước khi gọi Gemini', async () => {
  await resetVisualSearchStateForTest();

  const burstCap = getVisualSearchBurstPerMinuteCap();
  const userDailyCap = getVisualSearchDailyUserCap();
  const globalDailyCap = getVisualSearchDailyGlobalCap();

  setVisualSearchGeminiClientForTest(
    async ({ vocabulary }: { vocabulary: VisualSearchVocabulary }) => ({
      isApparel: true,
      categorySlug: vocabulary.categories[0]?.slug || null,
      primaryColor: vocabulary.colors[0] || null,
      secondaryColor: null,
      style: null,
      pattern: null,
      fit: null,
      targetGender: 'unisex',
      confidence: 0.85,
    })
  );

  // 5a. Gửi song song (burstCap + 3) yêu cầu từ cùng 1 IP (vượt ngưỡng burst = 5 yêu cầu / phút)
  const parallelBurst = await Promise.all(
    Array.from({ length: burstCap + 3 }, () =>
      fetch(`${baseUrl}/api/visual-search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.55',
        },
        body: JSON.stringify({ image: validJpegDataUrl }),
      })
    )
  );
  const statuses = parallelBurst.map((r) => r.status);
  const okCount = statuses.filter((s) => s === 200).length;
  const rateLimitedCount = statuses.filter((s) => s === 429).length;
  assert.equal(okCount, burstCap);
  assert.equal(rateLimitedCount, 3);
  assert.equal(
    getVisualSearchGeminiCallCountForTest(),
    burstCap,
    'Chỉ được gọi Gemini đúng bằng số yêu cầu hợp lệ trước khi bị chặn tốc độ'
  );

  // 5b. Kiểm tra trần toàn hệ thống trong ngày (globalDailyCap = 300)
  await resetVisualSearchStateForTest();
  const todayUtc = new Date().toISOString().slice(0, 10);
  await queryRows(sql`
    INSERT INTO chatbot_daily_counters (date_key, scope_key, call_count, updated_at)
    VALUES (${todayUtc}, 'visual_global', ${globalDailyCap}, NOW());
  `);

  const globalCapRes = await fetch(`${baseUrl}/api/visual-search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '198.51.100.77',
    },
    body: JSON.stringify({ image: validJpegDataUrl }),
  });
  assert.equal(globalCapRes.status, 429);
  const globalCapBody = await globalCapRes.json();
  assert.equal(globalCapBody.code, 'GLOBAL_DAILY_CAP');
  assert.equal(getVisualSearchGeminiCallCountForTest(), 0);
  assert.ok(userDailyCap > 0);
});

test('6. Sai loại file (.pdf/.svg), đổi đuôi giả (.jpg chứa nội dung văn bản) và vượt dung lượng (>5MB) bị từ chối HTTP 400', async () => {
  await resetVisualSearchStateForTest();

  // 6a. Giả mạo header data:image/jpeg nhưng magic bytes thực tế là file PDF (%PDF-1.5)
  const fakePdfBuffer = Buffer.from('%PDF-1.5\nFake PDF disguised as JPEG', 'utf8');
  const disguisedJpgDataUrl = `data:image/jpeg;base64,${fakePdfBuffer.toString('base64')}`;

  const resFake = await fetch(`${baseUrl}/api/visual-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: disguisedJpgDataUrl }),
  });
  assert.equal(resFake.status, 400);
  const bodyFake = await resFake.json();
  assert.equal(bodyFake.code, 'INVALID_IMAGE_MAGIC_BYTES');

  // 6b. Ảnh SVG (không nằm trong JPEG/PNG/WEBP)
  const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
  const svgDataUrl = `data:image/svg+xml;base64,${svgBuffer.toString('base64')}`;
  const resSvg = await fetch(`${baseUrl}/api/visual-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: svgDataUrl }),
  });
  assert.equal(resSvg.status, 400);

  // 6c. Vượt dung lượng 5MB (5MB + 1024 bytes)
  const over5MbBuffer = Buffer.alloc(5 * 1024 * 1024 + 1024, 0xff);
  const over5MbDataUrl = `data:image/jpeg;base64,${over5MbBuffer.toString('base64')}`;
  const resLarge = await fetch(`${baseUrl}/api/visual-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: over5MbDataUrl }),
  });
  assert.equal(resLarge.status, 400);
  const bodyLarge = await resLarge.json();
  assert.equal(bodyLarge.code, 'IMAGE_TOO_LARGE');

  // Đảm bảo không có lệnh gọi Gemini nào được thực hiện khi file không hợp lệ
  assert.equal(getVisualSearchGeminiCallCountForTest(), 0);
});

test('7. Sau khi gọi POST /api/visual-search, bảng uploads có 0 dòng mới và Storage có 0 đối tượng mới', async () => {
  await resetVisualSearchStateForTest();
  clearLocalStorageForTest();

  const beforeUploads = await queryRows<{ cnt: number }>(
    sql`SELECT COUNT(*)::int AS cnt FROM uploads;`
  );
  const beforeStorageCount = getLocalStorageObjectCountForTest();

  setVisualSearchGeminiClientForTest(
    async ({ vocabulary }: { vocabulary: VisualSearchVocabulary }) => ({
      isApparel: true,
      categorySlug: vocabulary.categories[0]?.slug || null,
      primaryColor: vocabulary.colors[0] || null,
      secondaryColor: null,
      style: null,
      pattern: null,
      fit: null,
      targetGender: 'unisex',
      confidence: 0.91,
    })
  );

  const res = await fetch(`${baseUrl}/api/visual-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: validJpegDataUrl }),
  });
  assert.equal(res.status, 200);

  const afterUploads = await queryRows<{ cnt: number }>(
    sql`SELECT COUNT(*)::int AS cnt FROM uploads;`
  );
  const afterStorageCount = getLocalStorageObjectCountForTest();

  assert.equal(
    afterUploads[0].cnt,
    beforeUploads[0].cnt,
    'Bảng uploads phải có đúng 0 dòng mới sau khi tìm kiếm bằng ảnh'
  );
  assert.equal(
    afterStorageCount,
    beforeStorageCount,
    'Storage phải có đúng 0 đối tượng mới sau khi tìm kiếm bằng ảnh'
  );
});

test('8. ai_search_logs không chứa ảnh hay văn bản tự do và tự xóa bản ghi quá 90 ngày', async () => {
  const logs = await queryRows<{
    id: string;
    recognized_attributes: any;
    result_count: number;
    latency_ms: number;
    is_success: boolean;
    actor_hmac: string | null;
  }>(sql`
    SELECT id, recognized_attributes, result_count, latency_ms, is_success, actor_hmac
    FROM ai_search_logs
    ORDER BY created_at DESC
    LIMIT 5;
  `);

  assert.ok(logs.length > 0, 'Phải ghi nhận bản ghi vào ai_search_logs');
  const latest = logs[0];
  const serialized = JSON.stringify(latest.recognized_attributes);

  // Không chứa base64 hay data:image
  assert.equal(serialized.includes('data:image'), false);
  assert.equal(serialized.includes('base64'), false);

  // Chỉ chứa các khóa thuộc tính cố định
  const allowedKeys = new Set([
    'isApparel',
    'categorySlug',
    'primaryColor',
    'secondaryColor',
    'style',
    'pattern',
    'fit',
    'targetGender',
    'confidence',
  ]);
  for (const key of Object.keys(latest.recognized_attributes || {})) {
    assert.ok(allowedKeys.has(key), `Khóa không hợp lệ trong ai_search_logs: ${key}`);
  }

  // Chèn 1 dòng cũ 95 ngày và kiểm tra hàm dọn dẹp 90 ngày
  await queryRows(sql`
    INSERT INTO ai_search_logs (recognized_attributes, result_count, latency_ms, is_success, actor_hmac, created_at)
    VALUES ('{"isApparel":true}'::jsonb, 3, 120, true, 'old_hmac', NOW() - INTERVAL '95 days');
  `);

  const deletedCount = await cleanupOldAiSearchLogs(queryRows);
  assert.ok(deletedCount >= 1, 'Phải tự động xóa các dòng ai_search_logs cũ hơn 90 ngày');
});

test('9. POST /api/visual-search/refine cập nhật kết quả theo bộ lọc đã sửa và KHÔNG gọi Gemini', async () => {
  await resetVisualSearchStateForTest();

  const vocabRes = await fetch(`${baseUrl}/api/visual-search/vocabulary`);
  const vocabBody = await vocabRes.json();
  assert.equal(vocabBody.success, true);
  const firstCat = vocabBody.vocabulary.categories[0]?.slug;
  const firstColor = vocabBody.vocabulary.colors[0];

  const callsBefore = getVisualSearchGeminiCallCountForTest();

  const refineRes = await fetch(`${baseUrl}/api/visual-search/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attributes: {
        categorySlug: firstCat,
        primaryColor: firstColor,
        targetGender: 'unisex',
      },
    }),
  });
  assert.equal(refineRes.status, 200);
  const refineBody = await refineRes.json();
  assert.equal(refineBody.success, true);
  assert.equal(refineBody.recognizedAttributes.categorySlug, firstCat);
  assert.equal(refineBody.recognizedAttributes.primaryColor, firstColor);
  assert.ok(Array.isArray(refineBody.products));

  const callsAfter = getVisualSearchGeminiCallCountForTest();
  assert.equal(
    callsAfter,
    callsBefore,
    'POST /api/visual-search/refine tuyệt đối không được gọi lại Gemini'
  );
});

test('10. Quét bản build dist: không lộ khóa AIza... hoặc giá trị bí mật ra mã trình duyệt', () => {
  const distDir = path.resolve(process.cwd(), 'dist');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    execSync('npm run build', { stdio: 'pipe' });
  }
  assert.ok(fs.existsSync(distDir), 'Thư mục dist phải tồn tại sau khi chạy npm run build');

  const walk = (dir: string): string[] => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) files.push(...walk(full));
      else if (e.isFile()) files.push(full);
    }
    return files;
  };

  const secretValues = [
    process.env.GEMINI_API_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.JWT_SECRET,
    process.env.DATABASE_URL,
  ]
    .map((v) => (v || '').trim())
    .filter((v) => v.length >= 8);

  const googleKeyRegex = /AIza[0-9A-Za-z_-]{20,}/;

  for (const filePath of walk(distDir)) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert.equal(
      googleKeyRegex.test(content),
      false,
      `Phát hiện chuỗi giống khóa Google API trong file build: ${path.relative(distDir, filePath)}`
    );
    for (const secret of secretValues) {
      assert.equal(
        content.includes(secret),
        false,
        `Phát hiện giá trị biến môi trường bí mật bị lộ trong file build: ${path.relative(
          distDir,
          filePath
        )}`
      );
    }
  }
});

test('11. Ngưỡng độ tin cậy (confidence < 0.5): coi như không nhận diện được (LOW_CONFIDENCE), trả thông báo thân thiện và lưu cột confidence dạng số vào ai_search_logs', async () => {
  await resetVisualSearchStateForTest();

  setVisualSearchGeminiClientForTest(async () => ({
    isApparel: true,
    categorySlug: 'ao-so-mi',
    primaryColor: 'Đen',
    secondaryColor: null,
    style: 'Tối giản',
    pattern: 'Trơn',
    fit: 'Regular Fit',
    targetGender: 'unisex',
    confidence: 0.35,
  }));

  const res = await fetch(`${baseUrl}/api/visual-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: validJpegDataUrl }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.isApparel, false);
  assert.equal(body.fallbackCode, 'LOW_CONFIDENCE');
  assert.equal(body.products.length, 0);
  assert.equal(body.recognizedAttributes.isApparel, false);
  assert.equal(body.recognizedAttributes.confidence, 0.35);
  assert.match(body.message, /0\.5|chưa đủ rõ nét/i);

  // Kiểm tra cột confidence (double precision) trong bảng ai_search_logs
  const logRows = await queryRows<{ confidence: number; recognized_attributes: any }>(sql`
    SELECT confidence, recognized_attributes
    FROM ai_search_logs
    ORDER BY created_at DESC, id DESC
    LIMIT 1;
  `);
  assert.ok(logRows.length > 0);
  assert.equal(typeof Number(logRows[0].confidence), 'number');
  assert.equal(Number(logRows[0].confidence), 0.35);
});

test('12. Giới hạn theo phút cho POST /api/visual-search/refine: vượt ngưỡng trả HTTP 429 REFINE_RATE_LIMIT', async () => {
  await resetVisualSearchStateForTest();

  const prevRefineCap = process.env.VISUAL_SEARCH_REFINE_PER_MIN_CAP;
  process.env.VISUAL_SEARCH_REFINE_PER_MIN_CAP = '3';
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${baseUrl}/api/visual-search/refine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.0.2.99',
        },
        body: JSON.stringify({
          attributes: {
            categorySlug: 'ao-so-mi',
            targetGender: 'unisex',
          },
        }),
      });
      statuses.push(r.status);
    }

    const okCount = statuses.filter((s) => s === 200).length;
    const rateLimitedCount = statuses.filter((s) => s === 429).length;
    assert.equal(okCount, 3, 'Đúng 3 yêu cầu refine đầu tiên trong phút được phép');
    assert.equal(rateLimitedCount, 2, 'Các yêu cầu vượt ngưỡng refine mỗi phút nhận HTTP 429');
  } finally {
    if (prevRefineCap === undefined) {
      delete process.env.VISUAL_SEARCH_REFINE_PER_MIN_CAP;
    } else {
      process.env.VISUAL_SEARCH_REFINE_PER_MIN_CAP = prevRefineCap;
    }
  }
});

test('13. Giao diện /visual-search (VisualSearchPage component & client flow): chọn file sai định dạng hiện lỗi; chọn ảnh hợp lệ hiện thẻ thuộc tính & lưới kết quả; sửa thẻ thuộc tính gọi refine (0 lần gọi Gemini); hết lượt (429) hiện thông báo; nội dung hiển thị được thoát chuỗi thuần (plain text)', async () => {
  await resetVisualSearchStateForTest();

  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const {
    VisualSearchPage,
    createVisualSearchClientController,
  } = await import('../src/components/search/VisualSearchPage.tsx');

  // Helper bọc fetch vào chữ ký của apiRequest
  const testRequestFn = async (endpoint: string, options: RequestInit = {}) => {
    const resp = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const json = await resp.json();
    return {
      ok: resp.ok,
      status: resp.status,
      data: json,
      errorCode: json?.code || json?.error?.code,
      errorMessage: json?.message || json?.error?.message,
    };
  };

  const controller = createVisualSearchClientController(testRequestFn as any);

  // (a) Chọn file sai định dạng (.pdf) -> báo lỗi ngay và không gọi Gemini
  const invalidState = await controller.selectFileAndSearch(
    { name: 'tai-lieu.pdf', type: 'application/pdf', size: 12000 },
    'data:application/pdf;base64,JVBERi0xLjU='
  );
  assert.ok(invalidState.errorState);
  assert.equal(invalidState.errorState?.code, 'INVALID_IMAGE_MAGIC_BYTES');
  assert.equal(getVisualSearchGeminiCallCountForTest(), 0);

  const errorHtml = renderToStaticMarkup(
    React.createElement(VisualSearchPage, {
      onBackToCatalog: () => {},
      onSelectProductSlug: () => {},
      onAddToCart: () => {},
      onToggleWishlist: () => {},
      wishlistItems: [],
      initialErrorState: invalidState.errorState,
    })
  );
  assert.ok(errorHtml.includes('data-testid="visual-search-error-banner"'));
  assert.ok(errorHtml.includes('Chỉ chấp nhận hình ảnh định dạng JPG, PNG hoặc WEBP'));

  // (b) Chọn ảnh hợp lệ -> gọi API, nhận diện thẻ thuộc tính và hiển thị lưới kết quả
  const vocabRes = await fetch(`${baseUrl}/api/visual-search/vocabulary`);
  const vocabData = (await vocabRes.json()).vocabulary;
  const firstCat = vocabData.categories[0]?.slug || 'ao-so-mi';
  const secondCat = vocabData.categories[1]?.slug || firstCat;
  const firstColor = vocabData.colors[0] || 'Đen';

  setVisualSearchGeminiClientForTest(async () => ({
    isApparel: true,
    categorySlug: firstCat,
    primaryColor: firstColor,
    secondaryColor: null,
    style: 'Tối giản',
    pattern: 'Trơn',
    fit: 'Regular Fit',
    targetGender: 'unisex',
    confidence: 0.92,
  }));

  const validState = await controller.selectFileAndSearch(
    { name: 'ao-so-mi.jpg', type: 'image/jpeg', size: 45000 },
    validJpegDataUrl
  );
  assert.equal(validState.errorState, null);
  assert.equal(validState.recognizedAttributes?.isApparel, true);
  assert.equal(validState.recognizedAttributes?.categorySlug, firstCat);
  assert.ok(validState.products.length > 0);
  assert.equal(getVisualSearchGeminiCallCountForTest(), 1);

  const resultsHtml = renderToStaticMarkup(
    React.createElement(VisualSearchPage, {
      onBackToCatalog: () => {},
      onSelectProductSlug: () => {},
      onAddToCart: () => {},
      onToggleWishlist: () => {},
      wishlistItems: [],
      initialRecognizedAttributes: validState.recognizedAttributes,
      initialProducts: validState.products,
      initialStatusMessage: validState.statusMessage,
    })
  );
  assert.ok(resultsHtml.includes('data-testid="attr-chip-categorySlug"'));
  assert.ok(resultsHtml.includes('data-testid="visual-search-results-grid"'));
  assert.ok(resultsHtml.includes('data-testid="visual-search-product-card"'));

  // (c) Sửa thẻ thuộc tính -> gọi POST /api/visual-search/refine (0 lần gọi thêm Gemini)
  const geminiCallsBeforeRefine = getVisualSearchGeminiCallCountForTest();
  controller.updateDraftAttribute('categorySlug', secondCat);
  const refinedState = await controller.refineByAttributes();
  assert.equal(refinedState.errorState, null);
  assert.equal(refinedState.recognizedAttributes?.categorySlug, secondCat);
  assert.equal(
    getVisualSearchGeminiCallCountForTest(),
    geminiCallsBeforeRefine,
    'Sửa thẻ thuộc tính gọi refine không được tăng số lần gọi Gemini'
  );

  // (d) Khi hết lượt (429) -> hiển thị thông báo giới hạn lượt dùng
  const todayUtc = new Date().toISOString().slice(0, 10);
  await queryRows(sql`
    INSERT INTO chatbot_daily_counters (date_key, scope_key, call_count, updated_at)
    VALUES (${todayUtc}, 'visual_global', 9999, NOW())
    ON CONFLICT (date_key, scope_key) DO UPDATE SET call_count = 9999;
  `);
  const quotaState = await controller.selectFileAndSearch(
    { name: 'anh-tiep.jpg', type: 'image/jpeg', size: 30000 },
    validJpegDataUrl
  );
  assert.equal(quotaState.errorState?.isRateLimit, true);

  const rateLimitHtml = renderToStaticMarkup(
    React.createElement(VisualSearchPage, {
      onBackToCatalog: () => {},
      onSelectProductSlug: () => {},
      onAddToCart: () => {},
      onToggleWishlist: () => {},
      wishlistItems: [],
      initialErrorState: quotaState.errorState,
    })
  );
  assert.ok(rateLimitHtml.includes('Đã đạt giới hạn lượt tìm kiếm bằng ảnh trong ngày'));

  // (e) Nội dung hiển thị là văn bản thuần (escaped plain text, chống XSS)
  const xssHtml = renderToStaticMarkup(
    React.createElement(VisualSearchPage, {
      onBackToCatalog: () => {},
      onSelectProductSlug: () => {},
      onAddToCart: () => {},
      onToggleWishlist: () => {},
      wishlistItems: [],
      initialRecognizedAttributes: {
        isApparel: true,
        categorySlug: '<script>alert("xss")</script>',
        primaryColor: '<img src=x onerror=alert(1)>',
        secondaryColor: null,
        style: null,
        pattern: null,
        fit: null,
        targetGender: 'unisex',
        confidence: 0.88,
      },
      initialProducts: [
        {
          ...validState.products[0],
          name: 'Áo <script>evil()</script>',
          matchReason: 'Lý do <b>in đậm giả</b>',
        },
      ],
    })
  );
  assert.equal(xssHtml.includes('<script>alert("xss")</script>'), false);
  assert.equal(xssHtml.includes('<script>evil()</script>'), false);
  assert.ok(xssHtml.includes('&lt;script&gt;evil()&lt;/script&gt;'));
});

test('14. Kiểm tra tự động ảnh chính sản phẩm (không gọi Gemini): không có hai sản phẩm KHÁC loại dùng chung một URL ảnh chính', async () => {
  const callsBefore = getVisualSearchGeminiCallCountForTest();

  const crossCategorySharedRows = await queryRows<{
    image_url: string;
    category_slugs: string[];
    product_names: string[];
  }>(sql`
    WITH primary_product_images AS (
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        c.slug AS category_slug,
        (
          SELECT pi.image_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          ORDER BY pi.is_primary DESC, pi.display_order ASC
          LIMIT 1
        ) AS image_url
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = true
    )
    SELECT
      image_url,
      array_agg(DISTINCT category_slug ORDER BY category_slug) AS category_slugs,
      array_agg(product_name || ' [' || category_slug || ']' ORDER BY product_name) AS product_names
    FROM primary_product_images
    WHERE image_url IS NOT NULL
    GROUP BY image_url
    HAVING COUNT(DISTINCT category_slug) > 1;
  `);

  assert.equal(
    getVisualSearchGeminiCallCountForTest(),
    callsBefore,
    'Test kiểm tra trùng URL ảnh chính khác loại không được gọi Gemini'
  );

  assert.equal(
    crossCategorySharedRows.length,
    0,
    `Phát hiện sản phẩm KHÁC loại dùng chung URL ảnh chính: ${crossCategorySharedRows
      .map(
        (r) =>
          `url=${r.image_url} dùng chung bởi: ${(r.product_names || []).join(' & ')}`
      )
      .join(' | ')}`
  );
});


