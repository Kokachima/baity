import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';

// Chạy trên PGlite in-memory cô lập
process.env.DATABASE_URL = '';
process.env.PGLITE_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-stage6b-policies-faq-key-2026-secure';

import { createApp } from '../server/app.ts';
import { initDatabase } from '../server/db/init.ts';
import { getDb, queryRows, closeDb } from '../server/db/index.ts';
import { parseSafeMarkdownBlocks, stripRawHtmlFromMarkdown } from '../shared/safeMarkdown.ts';
import {
  POLICY_SYSTEM_CONSTANTS,
  ensurePoliciesAndFaqSeeded,
  interpolatePolicyContent,
  buildPolicyTemplateVariables,
} from '../server/services/policyFaq.ts';

let server: http.Server;
let baseUrl = '';

before(async () => {
  await initDatabase();
  await ensurePoliciesAndFaqSeeded();

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

test('Bước 6b.1: GET /api/policies, GET /api/policies/:slug và GET /api/faq truy cập công khai (200) không cần đăng nhập, có Cache-Control ngắn và không lộ trường nội bộ', async () => {
  const listRes = await fetch(`${baseUrl}/api/policies`);
  assert.equal(listRes.status, 200);
  const cacheControl = listRes.headers.get('cache-control') || '';
  assert.ok(
    cacheControl.includes('public') && cacheControl.includes('max-age='),
    'Phải đặt Cache-Control public ngắn'
  );

  const listBody = await listRes.json();
  assert.equal(listBody.success, true);
  assert.ok(Array.isArray(listBody.items));
  assert.ok(
    listBody.items.length >= 4,
    'Phải có ít nhất 4 trang chính sách: đổi trả, vận chuyển, thanh toán, bảo mật'
  );

  const slugs = listBody.items.map((item: any) => item.slug);
  assert.ok(slugs.includes('return'));
  assert.ok(slugs.includes('shipping'));
  assert.ok(slugs.includes('payment'));
  assert.ok(slugs.includes('privacy'));

  for (const item of listBody.items) {
    assert.equal(typeof item.slug, 'string');
    assert.equal(typeof item.title, 'string');
    assert.equal(typeof item.displayOrder, 'number');
    assert.equal(item.id, undefined, 'Không được trả trường nội bộ id');
    assert.equal(item.content, undefined, 'Danh sách tóm tắt không trả toàn bộ content');
  }

  // Kiểm tra chi tiết từng chính sách (cả slug chuẩn và slug tiếng Việt alias)
  for (const slug of [
    'return',
    'shipping',
    'payment',
    'privacy',
    'doi-tra',
    'van-chuyen',
    'thanh-toan',
    'bao-mat',
  ]) {
    const detailRes = await fetch(`${baseUrl}/api/policies/${slug}`);
    assert.equal(detailRes.status, 200, `Slug ${slug} phải trả về 200`);
    const detailBody = await detailRes.json();
    assert.equal(detailBody.success, true);
    assert.ok(detailBody.data.title.length > 5);
    assert.ok(detailBody.data.content.length > 50);
    assert.ok(
      !detailBody.data.content.includes('{{'),
      `Nội dung chính sách ${slug} không được còn sót biến {{...}} chưa thay thế`
    );
  }

  // Kiểm tra GET /api/faq nhóm theo chủ đề
  const faqRes = await fetch(`${baseUrl}/api/faq`);
  assert.equal(faqRes.status, 200);
  const faqCache = faqRes.headers.get('cache-control') || '';
  assert.ok(faqCache.includes('public') && faqCache.includes('max-age='));

  const faqBody = await faqRes.json();
  assert.equal(faqBody.success, true);
  assert.ok(faqBody.total >= 10, 'Phải có tối thiểu 10 câu hỏi FAQ thực tế');
  assert.ok(
    Array.isArray(faqBody.groups) && faqBody.groups.length >= 5,
    'Phải nhóm theo đủ các chủ đề thực tế'
  );

  for (const group of faqBody.groups) {
    assert.equal(typeof group.topic, 'string');
    assert.ok(Array.isArray(group.items) && group.items.length > 0);
    for (const q of group.items) {
      assert.ok(q.question.length > 5);
      assert.ok(q.answer.length > 10);
      assert.ok(!q.answer.includes('{{'), 'Câu trả lời FAQ không được còn sót biến {{...}}');
      assert.equal(q.id, undefined, 'Không được trả trường nội bộ id trong FAQ');
    }
  }
});

test('Bước 6b.2: GET /api/policies/:slug với slug không tồn tại trả 404 gọn gàng', async () => {
  const res = await fetch(`${baseUrl}/api/policies/chinh-sach-khong-ton-tai-9999`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.code, 'POLICY_NOT_FOUND');
});

test('Bước 6b.3: Chống XSS — nội dung có <script>, <iframe>, onerror hoặc javascript: trong DB không bao giờ được thực thi hay render thành HTML thô, liên kết ngoài tự gắn rel="noopener noreferrer" target="_blank"', async () => {
  const xssSlug = 'test-xss-policy-temp';
  const maliciousMarkdown = [
    '## Chính sách kiểm thử bảo mật',
    'Đoạn văn hợp lệ có **in đậm** và thẻ độc hại <script>window.__xssExecuted = true; alert("xss")</script> ở giữa.',
    '<iframe src="https://evil.example.com"></iframe>',
    '<img src="x" onerror="alert(1)" />',
    '- Mục danh sách có [Liên kết độc hại](javascript:alert(1)) và [Liên kết ngoài an toàn](https://vietqr.io/danh-sach-ngan-hang) cùng [Liên kết nội bộ](/policies/return).',
  ].join('\n\n');

  await queryRows(sql`
    INSERT INTO faq_policies (type, title, content, display_order)
    VALUES (${xssSlug}, 'Chính sách kiểm thử XSS <script>alert(1)</script>', ${maliciousMarkdown}, 99);
  `);

  try {
    const res = await fetch(`${baseUrl}/api/policies/${xssSlug}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);

    // 1. Ngay từ tầng API trả về, thẻ <script>, <iframe>, <img> đã bị loại bỏ hoàn toàn
    const apiContent: string = body.data.content;
    assert.ok(!apiContent.toLowerCase().includes('<script'), 'API phải tước bỏ thẻ <script>');
    assert.ok(!apiContent.toLowerCase().includes('<iframe'), 'API phải tước bỏ thẻ <iframe>');
    assert.ok(!apiContent.toLowerCase().includes('<img'), 'API phải tước bỏ thẻ <img>');
    assert.ok(!apiContent.toLowerCase().includes('onerror'), 'API phải tước bỏ thuộc tính onerror');

    // 2. Ngay cả khi truyền chuỗi độc hại trực tiếp vào bộ phân tích Markdown giới hạn của Frontend (parseSafeMarkdownBlocks)
    const stripped = stripRawHtmlFromMarkdown(maliciousMarkdown);
    assert.ok(!stripped.includes('<script'));
    assert.ok(!stripped.includes('<iframe'));

    const blocks = parseSafeMarkdownBlocks(maliciousMarkdown);
    const serializedBlocks = JSON.stringify(blocks);
    assert.ok(!serializedBlocks.includes('<script'), 'Blocks phân tích không được chứa <script>');
    assert.ok(!serializedBlocks.includes('javascript:'), 'Giao thức javascript: phải bị chặn hoàn toàn');

    // Kiểm tra liên kết ngoài có isExternal = true và liên kết nội bộ có isExternal = false
    const listBlock = blocks.find((b) => b.type === 'unordered-list');
    assert.ok(listBlock && listBlock.type === 'unordered-list' && listBlock.items);
    const flatTokens = listBlock.items.flat();
    const externalLink = flatTokens.find(
      (t) => t && t.type === 'link' && t.href === 'https://vietqr.io/danh-sach-ngan-hang'
    );
    assert.ok(externalLink && externalLink.type === 'link', 'Liên kết https:// hợp lệ phải được giữ lại');
    assert.equal(externalLink.isExternal, true, 'Liên kết ngoài phải được đánh dấu isExternal = true');

    const internalLink = flatTokens.find(
      (t) => t && t.type === 'link' && t.href === '/policies/return'
    );
    assert.ok(internalLink && internalLink.type === 'link', 'Liên kết nội bộ /policies/return phải được giữ lại');
    assert.equal(internalLink.isExternal, false, 'Liên kết nội bộ phải có isExternal = false');

    // Kiểm tra mã nguồn SafeMarkdown.tsx đảm bảo gắn target="_blank" rel="noopener noreferrer" và không dùng dangerouslySetInnerHTML
    const safeMdCode = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/common/SafeMarkdown.tsx'),
      'utf-8'
    );
    assert.ok(
      !safeMdCode.includes('dangerouslySetInnerHTML'),
      'SafeMarkdown.tsx tuyệt đối không được dùng dangerouslySetInnerHTML'
    );
    assert.ok(safeMdCode.includes('target="_blank"'));
    assert.ok(safeMdCode.includes('rel="noopener noreferrer"'));
  } finally {
    await queryRows(sql`
      DELETE FROM faq_policies WHERE type = ${xssSlug};
    `);
  }
});

test('Bước 6b.4: Nội dung chính sách và FAQ tự động cập nhật số liệu khi thay đổi cấu hình store_settings (không lệch lời hứa với quy tắc chạy thật)', async () => {
  const existingRows = await queryRows<{ key: string; value: any }>(sql`
    SELECT key, value FROM store_settings WHERE key = 'general' LIMIT 1;
  `);
  const originalValue = existingRows[0]?.value;

  try {
    const customConfig = {
      storeName: 'VAULT Minimalist',
      phone: '028 3822 9999',
      email: 'vip-support@vault.vn',
      defaultShippingFee: 25000,
      expressShippingFee: 55000,
      freeShippingThreshold: 799000,
      returnDaysLimit: 14,
    };

    await queryRows(sql`
      INSERT INTO store_settings (key, value)
      VALUES ('general', ${JSON.stringify(customConfig)}::jsonb)
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value;
    `);

    const shippingRes = await fetch(`${baseUrl}/api/policies/shipping`);
    assert.equal(shippingRes.status, 200);
    const shippingData = (await shippingRes.json()).data;
    assert.ok(
      shippingData.content.includes('25.000₫'),
      'Phí giao tiêu chuẩn mới (25.000₫) phải tự động cập nhật trong chính sách vận chuyển'
    );
    assert.ok(
      shippingData.content.includes('55.000₫'),
      'Phí giao hỏa tốc mới (55.000₫) phải tự động cập nhật trong chính sách vận chuyển'
    );
    assert.ok(
      shippingData.content.includes('799.000₫'),
      'Ngưỡng miễn phí vận chuyển mới (799.000₫) phải tự động cập nhật'
    );

    const returnRes = await fetch(`${baseUrl}/api/policies/return`);
    assert.equal(returnRes.status, 200);
    const returnData = (await returnRes.json()).data;
    assert.ok(
      returnData.content.includes('14 ngày'),
      'Thời hạn đổi trả mới (14 ngày) phải tự động cập nhật trong chính sách đổi trả'
    );
    assert.ok(
      returnData.content.includes('vip-support@vault.vn'),
      'Email hỗ trợ mới phải tự động cập nhật'
    );

    const paymentRes = await fetch(`${baseUrl}/api/policies/payment`);
    assert.equal(paymentRes.status, 200);
    const paymentData = (await paymentRes.json()).data;
    assert.ok(
      paymentData.content.includes(`${POLICY_SYSTEM_CONSTANTS.ORDER_PAYMENT_TIMEOUT_MINUTES} phút`),
      'Thời hạn giữ đơn chờ thanh toán phải phản ánh đúng hằng số hệ thống (30 phút)'
    );

    const faqRes = await fetch(`${baseUrl}/api/faq`);
    assert.equal(faqRes.status, 200);
    const faqText = JSON.stringify((await faqRes.json()).groups);
    assert.ok(faqText.includes('799.000₫'), 'FAQ cũng phải phản ánh ngưỡng freeship mới 799.000₫');
    assert.ok(faqText.includes('14 ngày'), 'FAQ cũng phải phản ánh thời hạn đổi trả mới 14 ngày');
    assert.ok(
      faqText.includes(`${POLICY_SYSTEM_CONSTANTS.MAX_REVIEW_IMAGES} ảnh`),
      'FAQ phải phản ánh đúng giới hạn số ảnh đánh giá từ hằng số hệ thống'
    );
  } finally {
    if (originalValue !== undefined) {
      await queryRows(sql`
        UPDATE store_settings
        SET value = ${JSON.stringify(originalValue)}::jsonb
        WHERE key = 'general';
      `);
    } else {
      await queryRows(sql`DELETE FROM store_settings WHERE key = 'general';`);
    }
  }
});

test('Bước 6b.5: Khi DB gặp sự cố bất ngờ, các API /api/policies và /api/faq trả 500 kèm thông báo chung an toàn (không lộ chi tiết SQL hay err.message)', async () => {
  const dbInstance = (await getDb()) as any;
  const origExecute = dbInstance.execute.bind(dbInstance);
  dbInstance.execute = async () => {
    throw new Error('SENSITIVE_SQL_FAILURE: select * from faq_policies where secret_column = 123');
  };

  try {
    for (const endpoint of ['/api/policies', '/api/policies/return', '/api/faq']) {
      const res = await fetch(`${baseUrl}${endpoint}`);
      assert.equal(res.status, 500);
      const rawText = await res.text();
      assert.ok(
        !rawText.includes('SENSITIVE_SQL_FAILURE'),
        `Endpoint ${endpoint} không được làm lộ err.message nội bộ`
      );
      assert.ok(
        !rawText.includes('secret_column'),
        `Endpoint ${endpoint} không được làm lộ câu truy vấn SQL`
      );
    }
  } finally {
    dbInstance.execute = origExecute;
  }
});

test('Bước 6b.6: interpolatePolicyContent() không bao giờ để lộ chuỗi thô {{...}} ra giao diện; biến thiếu tự dùng giá trị mặc định và ghi cảnh báo log', async () => {
  const vars = await buildPolicyTemplateVariables();
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => {
    warnings.push(args.map((a) => String(a)).join(' '));
  };

  try {
    const template =
      'Chào mừng đến {{store_name}}, phí ship {{default_shipping_fee}}, biến lạ {{bien_khong_ton_tai_xyz}} và {{custom_missing_key}}.';
    const rendered = interpolatePolicyContent(template, vars);

    assert.ok(!rendered.includes('{{'), 'Tuyệt đối không được để lộ {{...}} ra ngoài');
    assert.ok(!rendered.includes('}}'), 'Tuyệt đối không được để lộ }} ra ngoài');
    assert.ok(rendered.includes(vars.store_name));
    assert.ok(
      rendered.includes('theo quy định cửa hàng'),
      'Biến không xác định phải thay bằng giá trị mặc định an toàn'
    );
    assert.ok(
      warnings.some((w) => w.includes('bien_khong_ton_tai_xyz')),
      'Phải ghi cảnh báo console.warn khi gặp biến {{...}} chưa khai báo'
    );
  } finally {
    console.warn = origWarn;
  }
});

test('Bước 6b.7: Seed chính sách và FAQ theo slug độc lập với ENABLE_SEED_DEMO_DATA, chèn khi slug chưa có và KHÔNG ghi đè nội dung đã chỉnh sửa của slug đã tồn tại', async () => {
  // 1. Giả lập admin sửa nội dung của chính sách có slug = 'return'
  const origRows = await queryRows<{ id: string; content: string }>(sql`
    SELECT id, content FROM faq_policies WHERE slug = 'return' LIMIT 1;
  `);
  assert.equal(origRows.length, 1, 'Phải có bản ghi slug = return');
  const origContent = origRows[0].content;
  const editedContent = `${origContent}\n\nLƯU Ý ĐẶC BIỆT ĐÃ CHỈNH SỬA BỞI CHỦ SHOP 2026.`;

  // 2. Xóa tạm 1 câu FAQ theo slug ('faq-vietqr-timeout') để kiểm tra seed chỉ chèn lại đúng slug bị thiếu
  const deletedFaqRows = await queryRows<{ slug: string; title: string; content: string }>(sql`
    SELECT slug, title, content FROM faq_policies WHERE slug = 'faq-vietqr-timeout' LIMIT 1;
  `);
  assert.equal(deletedFaqRows.length, 1);

  try {
    await queryRows(sql`
      UPDATE faq_policies SET content = ${editedContent} WHERE slug = 'return';
    `);
    await queryRows(sql`
      DELETE FROM faq_policies WHERE slug = 'faq-vietqr-timeout';
    `);

    // 3. Chạy lại ensurePoliciesAndFaqSeeded() (ngay cả khi ENABLE_SEED_DEMO_DATA = 'false')
    const prevDemoFlag = process.env.ENABLE_SEED_DEMO_DATA;
    process.env.ENABLE_SEED_DEMO_DATA = 'false';
    try {
      await ensurePoliciesAndFaqSeeded();
    } finally {
      process.env.ENABLE_SEED_DEMO_DATA = prevDemoFlag;
    }

    // 4. Xác nhận slug = 'return' KHÔNG bị ghi đè mất phần đã chỉnh sửa
    const afterReturnRows = await queryRows<{ content: string }>(sql`
      SELECT content FROM faq_policies WHERE slug = 'return' LIMIT 1;
    `);
    assert.equal(
      afterReturnRows[0].content,
      editedContent,
      'Seed không được ghi đè nội dung của slug đã tồn tại'
    );

    // 5. Xác nhận slug = 'faq-vietqr-timeout' bị thiếu đã được chèn lại đầy đủ
    const restoredFaqRows = await queryRows<{ slug: string; title: string }>(sql`
      SELECT slug, title FROM faq_policies WHERE slug = 'faq-vietqr-timeout' LIMIT 1;
    `);
    assert.equal(restoredFaqRows.length, 1, 'Slug bị thiếu phải được chèn mới');
  } finally {
    await queryRows(sql`
      UPDATE faq_policies SET content = ${origContent} WHERE slug = 'return';
    `);
  }
});

test('Bước 6b.8 (Phần 1 Mục 1a-1f): Chính sách & FAQ không chứa thông tin giả (1900 8888, cskh@baity.vn), ánh xạ đúng tên ngân hàng từ VIETQR_BANK_ID, sửa chủ đề faq-ai-features, nêu rõ ví/thẻ thử nghiệm và đơn vị xử lý dữ liệu kỹ thuật', async () => {
  await queryRows(sql`DELETE FROM store_settings WHERE key IN ('contact', 'general');`);
  const prevBankId = process.env.VIETQR_BANK_ID;
  process.env.VIETQR_BANK_ID = '970407';

  try {
    const [retRes, payRes, privRes, faqRes] = await Promise.all([
      fetch(`${baseUrl}/api/policies/return`),
      fetch(`${baseUrl}/api/policies/payment`),
      fetch(`${baseUrl}/api/policies/privacy`),
      fetch(`${baseUrl}/api/faq`),
    ]);

    const retText = (await retRes.json()).data.content as string;
    const payText = (await payRes.json()).data.content as string;
    const privText = (await privRes.json()).data.content as string;
    const faqGroups = (await faqRes.json()).groups as any[];
    const allFaqText = JSON.stringify(faqGroups);

    // (b) Khi chưa cấu hình contact trong store_settings, hiển thị "Cửa hàng chưa cập nhật thông tin liên hệ", không có số giả
    assert.ok(retText.includes('Cửa hàng chưa cập nhật thông tin liên hệ'));
    assert.ok(payText.includes('Cửa hàng chưa cập nhật thông tin liên hệ'));
    assert.ok(privText.includes('Cửa hàng chưa cập nhật thông tin liên hệ'));
    assert.equal(retText.includes('1900 8888'), false);
    assert.equal(retText.includes('cskh@baity.vn'), false);
    assert.equal(allFaqText.includes('1900 8888'), false);
    assert.equal(allFaqText.includes('cskh@baity.vn'), false);

    // (a) Tên ngân hàng ánh xạ từ VIETQR_BANK_ID=970407 sang Techcombank
    assert.ok(payText.includes('Techcombank'), 'VIETQR_BANK_ID=970407 phải ánh xạ sang Techcombank');
    assert.equal(payText.includes('MBBank'), false, 'Không được ghi cố định MBBank khi cấu hình là 970407');

    // (d) faq-ai-features phải thuộc chủ đề "Chọn kích cỡ & Sản phẩm"
    const sizeGroup = faqGroups.find((g) => g.topic === 'Chọn kích cỡ & Sản phẩm');
    assert.ok(sizeGroup, 'Phải có nhóm chủ đề "Chọn kích cỡ & Sản phẩm"');
    const aiFaqInSizeGroup = sizeGroup.items.find((it: any) => it.slug === 'faq-ai-features');
    assert.ok(aiFaqInSizeGroup, 'faq-ai-features phải nằm trong nhóm "Chọn kích cỡ & Sản phẩm"');

    // (e) Nêu rõ ví điện tử và thẻ là "chế độ thử nghiệm, chưa thu tiền thật"
    assert.ok(
      payText.includes('chế độ thử nghiệm, chưa thu tiền thật'),
      'Chính sách thanh toán phải nêu rõ ví điện tử và thẻ là chế độ thử nghiệm, chưa thu tiền thật'
    );

    // (f) Chính sách bảo mật nêu rõ các đơn vị xử lý dữ liệu kỹ thuật và băm HMAC-SHA256 tối đa 2 ngày
    assert.ok(privText.includes('Supabase'));
    assert.ok(privText.includes('VietQR'));
    assert.ok(privText.includes('Google Gemini'));
    assert.ok(privText.includes('HMAC-SHA256'));
    assert.ok(privText.includes('tối đa **2 ngày**'));
  } finally {
    if (prevBankId !== undefined) process.env.VIETQR_BANK_ID = prevBankId;
    else delete process.env.VIETQR_BANK_ID;
  }
});

test('Bước 6b.9 (Phần 1 Mục 4 & 5): Không lặp 2 lần cụm "Cửa hàng chưa cập nhật thông tin liên hệ" trong cùng một câu, và cập nhật store_settings đổi cả dữ liệu Banner (/api/settings/general) lẫn Chính sách (/api/policies/shipping)', async () => {
  await queryRows(sql`DELETE FROM store_settings WHERE key IN ('contact', 'general');`);

  // 1. Kiểm tra không có câu nào lặp 2 lần "Cửa hàng chưa cập nhật thông tin liên hệ"
  const [retRes, payRes, privRes, faqRes] = await Promise.all([
    fetch(`${baseUrl}/api/policies/return`),
    fetch(`${baseUrl}/api/policies/payment`),
    fetch(`${baseUrl}/api/policies/privacy`),
    fetch(`${baseUrl}/api/faq`),
  ]);

  const docs = [
    (await retRes.json()).data.content as string,
    (await payRes.json()).data.content as string,
    (await privRes.json()).data.content as string,
    JSON.stringify((await faqRes.json()).groups),
  ];

  const missingPhrase = 'Cửa hàng chưa cập nhật thông tin liên hệ';
  for (const doc of docs) {
    const sentences = doc.split(/[\r\n.!?]+/);
    for (const sentence of sentences) {
      const occurrences = sentence.split(missingPhrase).length - 1;
      assert.ok(
        occurrences <= 1,
        `Không được xuất hiện cụm "${missingPhrase}" 2 lần trong cùng một câu: "${sentence.trim()}"`
      );
    }
  }

  // 2. Cập nhật store_settings -> kiểm tra cả GET /api/settings/general (nguồn của Banner/Footer) và GET /api/policies/shipping cùng thay đổi đồng nhất
  await queryRows(sql`
    INSERT INTO store_settings (key, value)
    VALUES ('general', ${JSON.stringify({
      storeName: 'Baity Fashion',
      defaultShippingFee: 28000,
      expressShippingFee: 48000,
      freeShippingThreshold: 599000,
      returnDaysLimit: 10,
    })}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  `);

  const [genSettingsRes, shipPolicyRes] = await Promise.all([
    fetch(`${baseUrl}/api/settings/general`),
    fetch(`${baseUrl}/api/policies/shipping`),
  ]);
  assert.equal(genSettingsRes.status, 200);
  assert.equal(shipPolicyRes.status, 200);

  const genData = (await genSettingsRes.json()).data;
  const shipContent = (await shipPolicyRes.json()).data.content as string;

  assert.equal(genData.freeShippingThreshold, 599000, 'Banner đọc từ /api/settings/general phải nhận ngưỡng freeship mới 599000');
  assert.equal(genData.defaultShippingFee, 28000);
  assert.equal(genData.expressShippingFee, 48000);
  assert.equal(genData.returnDaysLimit, 10);

  assert.ok(shipContent.includes('599.000₫'), 'Chính sách vận chuyển phải hiển thị ngưỡng freeship mới 599.000₫');
  assert.ok(shipContent.includes('28.000₫'), 'Chính sách vận chuyển phải hiển thị phí tiêu chuẩn mới 28.000₫');
  assert.ok(shipContent.includes('48.000₫'), 'Chính sách vận chuyển phải hiển thị phí hỏa tốc mới 48.000₫');
});


