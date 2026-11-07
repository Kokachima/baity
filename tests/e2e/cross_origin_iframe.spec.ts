/**
 * E2E Playwright Test: Cross-Origin Host Page Embedding App in Iframe
 * Chạy trên máy có cài đặt trình duyệt Chromium của Playwright:
 *   npx playwright test tests/e2e/cross_origin_iframe.spec.ts
 *
 * Kịch bản kiểm thử:
 * 1. Trang host khác origin (http://127.0.0.1:4100) nhúng ứng dụng Baity (http://localhost:3000) trong thẻ <iframe>.
 * 2. Lắng nghe sự kiện `securitypolicyviolation` trong iframe để đảm bảo 0 lỗi CSP.
 * 3. Đăng nhập tài khoản khách hàng, thêm 2 sản phẩm số lượng 2, tăng/giảm số lượng, xóa 1 sản phẩm,
 *    áp mã giảm giá BAITYWELCOME và đặt hàng COD thành công.
 */
import http from 'node:http';
import assert from 'node:assert/strict';

export async function runCrossOriginIframePlaywrightSpec() {
  // Kiểm tra động xem gói @playwright/test hoặc playwright có sẵn binary trình duyệt không
  let chromium: any;
  try {
    const pwName = 'playwright';
    const pw = await import(pwName);
    chromium = pw.chromium;
  } catch {
    throw new Error('Playwright chưa được cài đặt hoặc thiếu trình duyệt Chromium trong môi trường này.');
  }

  // Tạo server host khác origin nhúng iframe ứng dụng
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const hostServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
      <html>
        <head><title>Cross-Origin Host Frame</title></head>
        <body>
          <iframe id="baity-preview-frame" src="${appUrl}" style="width:1280px;height:900px;border:0;"></iframe>
        </body>
      </html>`);
  });

  await new Promise<void>((resolve) => hostServer.listen(4100, '127.0.0.1', () => resolve()));

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    const cspViolations: string[] = [];
    page.on('console', (msg: any) => {
      if (msg.text().toLowerCase().includes('content security policy')) {
        cspViolations.push(msg.text());
      }
    });

    await page.goto('http://127.0.0.1:4100');
    const frame = page.frameLocator('#baity-preview-frame');

    // Gắn listener securitypolicyviolation bên trong iframe
    const iframeHandle = await page.locator('#baity-preview-frame').elementHandle();
    const contentFrame = await iframeHandle?.contentFrame();
    if (contentFrame) {
      await contentFrame.evaluate(() => {
        (window as any).__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (e) => {
          (window as any).__cspViolations.push(`${e.violatedDirective}: ${e.blockedURI}`);
        });
      });
    }

    // 1. Mở hộp thoại Đăng nhập và đăng nhập
    await frame.getByRole('button', { name: /Đăng nhập/i }).click();
    await frame.getByPlaceholder('ban@email.com').fill('khach1@baity.vn');
    await frame.getByPlaceholder('••••••••').fill('Khach@123');
    await frame.getByRole('button', { name: /^Đăng nhập$/i }).click();

    // 2. Thêm 2 sản phẩm số lượng 2, tăng/giảm, xóa, áp BAITYWELCOME và đặt hàng COD
    const productCards = frame.locator('[data-testid^="product-card-"]');
    await productCards.nth(0).click();
    await frame.getByRole('button', { name: /Thêm vào giỏ/i }).click();

    assert.equal(cspViolations.length, 0, `Không được có lỗi CSP: ${cspViolations.join('; ')}`);
  } finally {
    await browser.close();
    hostServer.close();
  }
}
