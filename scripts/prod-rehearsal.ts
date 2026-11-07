import assert from 'node:assert/strict';
import http from 'node:http';
import { sql } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { initDatabase } from '../server/db/init.ts';
import {
  queryRows,
  closeDb,
  setTestDbInstanceForRehearsal,
  schema,
} from '../server/db/index.ts';
import { seedDatabase } from '../server/db/seed.ts';
import { createApp, validateProductionStartupEnv } from '../server/app.ts';
import {
  isStrictRuntimeMode,
  applyStrictRehearsalModeEnv,
  restoreRuntimeModeEnv,
} from '../server/config/runtimeMode.ts';

export interface ProdRehearsalValidationPartAResult {
  validConfigPassed: boolean;
  forbiddenAndMissingRejectionsCount: number;
  rejectedVariables: string[];
}

export interface ProdRehearsalSummary {
  partAValidationOk: boolean;
  rejectedVariablesInPartA: string[];
  strictModeActive: boolean;
  usePgliteEnvDisabled: boolean;
  startupOk: boolean;
  adminLoginOk: boolean;
  adminEmail: string;
  cookieHeader: string;
  hasSameSiteLax: boolean;
  hasSecureCookie: boolean;
  hasHttpOnlyCookie: boolean;
  productsTotal: number;
  categoriesCount: number;
  policiesCount: number;
  faqCount: number;
  devAccountsFound: string[];
  diagStatus: number;
}

/**
 * Phần (a): Kiểm tra hàm validateProductionStartupEnv ở chế độ strict THẬT:
 * - Bộ biến production hợp lệ phải ĐẠT (ok = true)
 * - Từng biến cấm bật lần lượt (COOKIE_CROSS_SITE=true, USE_PGLITE=true, SEED_DEV_ACCOUNTS=true, ENABLE_DEMO_PAYMENT_WEBHOOK=true)
 *   và từng biến bắt buộc bị thiếu / mật khẩu admin yếu phải THẤT BẠI (ok = false) và báo đúng tên biến.
 */
export function runProductionRehearsalPartAValidation(): ProdRehearsalValidationPartAResult {
  const baseValidEnv: NodeJS.ProcessEnv = {
    COOKIE_CROSS_SITE: 'false',
    SEED_DEV_ACCOUNTS: 'false',
    ENABLE_DEMO_PAYMENT_WEBHOOK: 'false',
    DATABASE_URL:
      'postgresql://postgres.ref:pass@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
    JWT_SECRET: 'prod-rehearsal-jwt-secret-key-2026-baity-secure',
    ADMIN_EMAIL: 'rehearsal.admin@baity.vn',
    ADMIN_INITIAL_PASSWORD: 'RehearsalStrongPass@2026!',
    CRON_SECRET_KEY: 'prod-rehearsal-cron-secret-key-2026',
    PAYMENT_WEBHOOK_SECRET: 'prod-rehearsal-webhook-secret-key-2026',
    EMAIL_PROVIDER: 'brevo',
    EMAIL_FROM: 'Baity Fashion <ops@baity.vn>',
  };
  applyStrictRehearsalModeEnv(baseValidEnv);

  assert.equal(
    isStrictRuntimeMode(baseValidEnv),
    true,
    'Phần (a): baseValidEnv phải ở chế độ strict production thật'
  );

  const validRes = validateProductionStartupEnv(baseValidEnv);
  assert.equal(
    validRes.ok,
    true,
    `Phần (a): Bộ biến production hợp lệ phải đạt, nhưng gặp lỗi: ${validRes.errors.join('; ')}`
  );

  const negativeCases: Array<{
    name: string;
    expectedVar: string;
    override: Partial<NodeJS.ProcessEnv>;
  }> = [
    {
      name: 'Bật biến cấm COOKIE_CROSS_SITE=true',
      expectedVar: 'COOKIE_CROSS_SITE',
      override: { COOKIE_CROSS_SITE: 'true' },
    },
    {
      name: 'Bật biến cấm USE_PGLITE=true',
      expectedVar: 'USE_PGLITE',
      override: { USE_PGLITE: 'true' },
    },
    {
      name: 'Bật biến cấm SEED_DEV_ACCOUNTS=true',
      expectedVar: 'SEED_DEV_ACCOUNTS',
      override: { SEED_DEV_ACCOUNTS: 'true' },
    },
    {
      name: 'Bật biến cấm ENABLE_DEMO_PAYMENT_WEBHOOK=true',
      expectedVar: 'ENABLE_DEMO_PAYMENT_WEBHOOK',
      override: { ENABLE_DEMO_PAYMENT_WEBHOOK: 'true' },
    },
    {
      name: 'Thiếu DATABASE_URL',
      expectedVar: 'DATABASE_URL',
      override: { DATABASE_URL: '' },
    },
    {
      name: 'Thiếu JWT_SECRET',
      expectedVar: 'JWT_SECRET',
      override: { JWT_SECRET: '' },
    },
    {
      name: 'Thiếu ADMIN_EMAIL',
      expectedVar: 'ADMIN_EMAIL',
      override: { ADMIN_EMAIL: '' },
    },
    {
      name: 'Thiếu ADMIN_INITIAL_PASSWORD',
      expectedVar: 'ADMIN_INITIAL_PASSWORD',
      override: { ADMIN_INITIAL_PASSWORD: '' },
    },
    {
      name: 'Mật khẩu ADMIN_INITIAL_PASSWORD yếu/bị cấm',
      expectedVar: 'ADMIN_INITIAL_PASSWORD',
      override: { ADMIN_INITIAL_PASSWORD: 'Admin@123' },
    },
    {
      name: 'Thiếu CRON_SECRET_KEY',
      expectedVar: 'CRON_SECRET_KEY',
      override: { CRON_SECRET_KEY: '' },
    },
    {
      name: 'Thiếu PAYMENT_WEBHOOK_SECRET',
      expectedVar: 'PAYMENT_WEBHOOK_SECRET',
      override: { PAYMENT_WEBHOOK_SECRET: '' },
    },
    {
      name: 'Thiếu EMAIL_FROM khi EMAIL_PROVIDER=brevo',
      expectedVar: 'EMAIL_FROM',
      override: { EMAIL_PROVIDER: 'brevo', EMAIL_FROM: '' },
    },
  ];

  const rejectedVariables: string[] = [];
  for (const tc of negativeCases) {
    const candidateEnv: NodeJS.ProcessEnv = {
      ...baseValidEnv,
      ...tc.override,
    };
    const res = validateProductionStartupEnv(candidateEnv);
    assert.equal(
      res.ok,
      false,
      `Phần (a): Trường hợp "${tc.name}" bắt buộc phải thất bại ở chế độ strict`
    );
    assert.ok(
      res.errors.some((e) => e.includes(tc.expectedVar)),
      `Phần (a): Trường hợp "${tc.name}" phải báo lỗi chứa tên biến ${tc.expectedVar} (thực tế: ${res.errors.join(' | ')})`
    );
    rejectedVariables.push(tc.expectedVar);
  }

  return {
    validConfigPassed: true,
    forbiddenAndMissingRejectionsCount: negativeCases.length,
    rejectedVariables,
  };
}

/**
 * Thực thi trọn vẹn buổi diễn tập khởi tạo Production (prod:rehearsal) gồm 2 phần:
 * - Phần (a): Kiểm tra validateProductionStartupEnv với bộ biến hợp lệ và từng biến cấm/thiếu.
 * - Phần (b): Chạy ứng dụng ở chế độ strict THẬT (qua applyStrictRehearsalModeEnv, KHÔNG bật USE_PGLITE trong env),
 *             tiêm CSDL PGlite in-memory qua hook chỉ dùng trong test (setTestDbInstanceForRehearsal) và kiểm tra toàn diện.
 */
export async function runProductionRehearsal(): Promise<ProdRehearsalSummary> {
  const prevEnv = { ...process.env };

  try {
    // PHẦN (a): Kiểm tra hàm validate khởi động với bộ biến hợp lệ và từng biến cấm/thiếu
    const partA = runProductionRehearsalPartAValidation();

    // PHẦN (b): Đặt chế độ strict THẬT, KHÔNG dùng USE_PGLITE từ biến môi trường
    await closeDb().catch(() => {});

    applyStrictRehearsalModeEnv(process.env);
    delete process.env.USE_PGLITE;
    process.env.COOKIE_CROSS_SITE = 'false';
    process.env.TRUST_PROXY_HOPS = '1';
    process.env.ENABLE_SEED_DEMO_DATA = 'false';
    process.env.SEED_DEV_ACCOUNTS = 'false';
    process.env.ENABLE_DEMO_PAYMENT_WEBHOOK = 'false';
    process.env.DATABASE_URL =
      'postgresql://postgres.ref:pass@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';
    process.env.JWT_SECRET = 'prod-rehearsal-jwt-secret-key-2026-baity-secure';
    process.env.ADMIN_EMAIL = 'rehearsal.admin@baity.vn';
    process.env.ADMIN_INITIAL_PASSWORD = 'RehearsalStrongPass@2026!';
    process.env.CRON_SECRET_KEY = 'prod-rehearsal-cron-secret-key-2026';
    process.env.PAYMENT_WEBHOOK_SECRET = 'prod-rehearsal-webhook-secret-key-2026';
    process.env.EMAIL_PROVIDER = 'log';
    delete process.env.EMAIL_FROM;
    process.env.APP_URL = 'https://baity.vn';
    process.env.ALLOWED_ORIGINS = 'https://baity.vn';

    const strictModeActive = isStrictRuntimeMode(process.env);
    const usePgliteEnvDisabled = process.env.USE_PGLITE !== 'true';
    assert.equal(strictModeActive, true, 'Phần (b): Bắt buộc chạy ở chế độ strict production thật');
    assert.equal(
      usePgliteEnvDisabled,
      true,
      'Phần (b): Tuyệt đối không được bật USE_PGLITE từ biến môi trường'
    );

    const envValidation = validateProductionStartupEnv(process.env);
    assert.equal(
      envValidation.ok,
      true,
      `Phần (b): Kiểm tra môi trường strict production thất bại: ${envValidation.errors.join('; ')}`
    );

    // Tiêm thực thể PGlite in-memory trống qua hook chỉ dùng trong test (không dùng biến môi trường USE_PGLITE)
    const pgliteClient = new PGlite('memory://', {
      extensions: { pg_trgm },
    });
    const injectedDb = drizzlePglite(pgliteClient, { schema });
    setTestDbInstanceForRehearsal(injectedDb, pgliteClient);

    await initDatabase();
    await seedDatabase();

    const app = createApp();
    const server = http.createServer(app);
    let baseUrl = '';

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });

    try {
      // 1. Kiểm tra /api/health
      const healthRes = await fetch(`${baseUrl}/api/health`, {
        headers: { 'X-Forwarded-Proto': 'https' },
      });
      assert.equal(healthRes.status, 200, 'GET /api/health phải trả 200');
      const healthBody = await healthRes.json();
      assert.deepEqual(healthBody, { status: 'ok', database: 'connected' });

      // 2. Kiểm tra các tài khoản mẫu (admin@baity.vn, khach1@baity.vn, khach2@baity.vn) KHÔNG tồn tại
      const devRows = await queryRows<{ email: string }>(sql`
        SELECT email FROM users
        WHERE LOWER(email) IN ('admin@baity.vn', 'khach1@baity.vn', 'khach2@baity.vn');
      `);
      assert.equal(
        devRows.length,
        0,
        `Tài khoản mẫu không được tồn tại ở Production (tìm thấy: ${devRows.map((r) => r.email).join(', ')})`
      );

      // 3. Kiểm tra Admin đăng nhập được bằng ADMIN_EMAIL và ADMIN_INITIAL_PASSWORD kèm Cookie SameSite=Lax và Secure
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Proto': 'https',
          'X-Forwarded-Host': 'baity.vn',
          Origin: 'https://baity.vn',
        },
        body: JSON.stringify({
          email: process.env.ADMIN_EMAIL,
          password: process.env.ADMIN_INITIAL_PASSWORD,
        }),
      });
      assert.equal(
        loginRes.status,
        200,
        'Admin phải đăng nhập thành công (HTTP 200) bằng thông tin môi trường'
      );
      const loginBody = await loginRes.json();
      assert.equal(loginBody.success, true);
      assert.equal(loginBody.user?.email, 'rehearsal.admin@baity.vn');
      assert.equal(loginBody.user?.role, 'admin');

      const setCookieHeader = loginRes.headers.get('set-cookie') || '';
      const hasSameSiteLax = /SameSite=Lax/i.test(setCookieHeader);
      const hasSecureCookie = /\bSecure\b/i.test(setCookieHeader);
      const hasHttpOnlyCookie = /\bHttpOnly\b/i.test(setCookieHeader);
      assert.equal(
        hasSameSiteLax,
        true,
        `Cookie đăng nhập ở Production phải có SameSite=Lax (thực tế: ${setCookieHeader})`
      );
      assert.equal(
        hasSecureCookie,
        true,
        `Cookie đăng nhập ở Production phải có cờ Secure (thực tế: ${setCookieHeader})`
      );
      assert.equal(
        hasHttpOnlyCookie,
        true,
        `Cookie đăng nhập ở Production phải có cờ HttpOnly (thực tế: ${setCookieHeader})`
      );

      // 4. Kiểm tra /api/products trả danh sách rỗng hợp lệ và /api/categories có 9 danh mục gốc
      const productsRes = await fetch(`${baseUrl}/api/products`, {
        headers: { 'X-Forwarded-Proto': 'https' },
      });
      assert.equal(productsRes.status, 200, 'GET /api/products trên CSDL trống phải trả HTTP 200');
      const productsBody = await productsRes.json();
      assert.equal(productsBody.success, true);
      assert.ok(Array.isArray(productsBody.data), 'GET /api/products.data phải là mảng');
      assert.equal(
        productsBody.data.length,
        0,
        'GET /api/products trên CSDL trống không bật ENABLE_SEED_DEMO_DATA phải trả 0 sản phẩm'
      );
      assert.equal(Number(productsBody.pagination?.total || 0), 0);

      const categoriesRes = await fetch(`${baseUrl}/api/categories`, {
        headers: { 'X-Forwarded-Proto': 'https' },
      });
      assert.equal(categoriesRes.status, 200);
      const categoriesBody = await categoriesRes.json();
      assert.ok(
        Array.isArray(categoriesBody.data) && categoriesBody.data.length === 9,
        '9 danh mục gốc phải được nạp sẵn trên CSDL trống'
      );

      // 5. Kiểm tra Chính sách (/api/policies) và FAQ (/api/faq) có nội dung
      const policiesRes = await fetch(`${baseUrl}/api/policies`, {
        headers: { 'X-Forwarded-Proto': 'https' },
      });
      assert.equal(policiesRes.status, 200);
      const policiesBody = await policiesRes.json();
      assert.ok(
        Array.isArray(policiesBody.items) && policiesBody.items.length >= 4,
        'Danh sách chính sách (/api/policies) phải có nội dung'
      );

      const faqRes = await fetch(`${baseUrl}/api/faq`, {
        headers: { 'X-Forwarded-Proto': 'https' },
      });
      assert.equal(faqRes.status, 200);
      const faqBody = await faqRes.json();
      assert.ok(
        Array.isArray(faqBody.items) && faqBody.items.length >= 10,
        'Danh sách FAQ (/api/faq) phải có nội dung'
      );

      // 6. Kiểm tra /api/auth/diag trả 404
      const diagRes = await fetch(`${baseUrl}/api/auth/diag`, {
        headers: { 'X-Forwarded-Proto': 'https' },
      });
      assert.equal(diagRes.status, 404, 'GET /api/auth/diag phải trả 404 (đã gỡ hoàn toàn)');

      return {
        partAValidationOk: partA.validConfigPassed,
        rejectedVariablesInPartA: partA.rejectedVariables,
        strictModeActive,
        usePgliteEnvDisabled,
        startupOk: true,
        adminLoginOk: true,
        adminEmail: loginBody.user.email,
        cookieHeader: setCookieHeader,
        hasSameSiteLax,
        hasSecureCookie,
        hasHttpOnlyCookie,
        productsTotal: productsBody.data.length,
        categoriesCount: categoriesBody.data.length,
        policiesCount: policiesBody.items.length,
        faqCount: faqBody.items.length,
        devAccountsFound: devRows.map((r) => r.email),
        diagStatus: diagRes.status,
      };
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await closeDb().catch(() => {});
    }
  } finally {
    restoreRuntimeModeEnv(prevEnv, process.env);
    for (const k of [
      'USE_PGLITE',
      'PGLITE_DATA_DIR',
      'COOKIE_CROSS_SITE',
      'TRUST_PROXY_HOPS',
      'ENABLE_SEED_DEMO_DATA',
      'SEED_DEV_ACCOUNTS',
      'ENABLE_DEMO_PAYMENT_WEBHOOK',
      'DATABASE_URL',
      'JWT_SECRET',
      'ADMIN_EMAIL',
      'ADMIN_INITIAL_PASSWORD',
      'CRON_SECRET_KEY',
      'PAYMENT_WEBHOOK_SECRET',
      'EMAIL_PROVIDER',
      'EMAIL_FROM',
      'APP_URL',
      'ALLOWED_ORIGINS',
    ]) {
      if (prevEnv[k] !== undefined) process.env[k] = prevEnv[k];
      else delete process.env[k];
    }
  }
}

const isDirectCli =
  process.argv[1] &&
  (process.argv[1].endsWith('prod-rehearsal.ts') || process.argv[1].endsWith('prod-rehearsal.js'));

if (isDirectCli) {
  runProductionRehearsal()
    .then(async (summary) => {
      console.log('=== KẾT QUẢ DIỄN TẬP KHỞI TẠO PRODUCTION NGHIÊM NGẶT (prod:rehearsal) ===');
      console.log(
        `Phần (a) Kiểm tra validateProductionStartupEnv: ĐẠT (Đã chặn đủ ${summary.rejectedVariablesInPartA.length} trường hợp vi phạm: ${summary.rejectedVariablesInPartA.join(', ')})`
      );
      console.log(
        `Phần (b) Khởi chạy ở chế độ Strict thật (strictMode=${summary.strictModeActive}, usePgliteEnvDisabled=${summary.usePgliteEnvDisabled}): THÀNH CÔNG`
      );
      console.log(`1. Đăng nhập Admin từ biến môi trường (${summary.adminEmail}): THÀNH CÔNG (HTTP 200)`);
      console.log(
        `2. Thuộc tính Cookie đăng nhập: SameSite=Lax (${summary.hasSameSiteLax}), Secure (${summary.hasSecureCookie}), HttpOnly (${summary.hasHttpOnlyCookie})`
      );
      console.log(
        `3. GET /api/products trả danh sách rỗng hợp lệ: total=${summary.productsTotal} sản phẩm (danh mục gốc=${summary.categoriesCount})`
      );
      console.log(
        `4. Nội dung Chính sách & FAQ: policies=${summary.policiesCount} mục, faq=${summary.faqCount} câu hỏi`
      );
      console.log(
        `5. Kiểm tra tài khoản mẫu (admin@baity.vn, khach1@baity.vn, khach2@baity.vn): ${summary.devAccountsFound.length} tài khoản tồn tại (ĐẠT)`
      );
      console.log(`6. Kiểm tra GET /api/auth/diag: HTTP ${summary.diagStatus} (ĐẠT)`);
      await closeDb().catch(() => {});
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('❌ [prod:rehearsal THẤT BẠI]:', err?.message || err);
      await closeDb().catch(() => {});
      process.exit(1);
    });
}
