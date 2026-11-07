import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { sql } from 'drizzle-orm';

// Khởi tạo trên PGlite in-memory cô lập cho môi trường test
process.env.DATABASE_URL = '';
process.env.USE_PGLITE = 'true';
process.env.PGLITE_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.COOKIE_CROSS_SITE = 'false';
process.env.JWT_SECRET = 'test-secret-stage9-production-readiness-2026';

import { createApp, validateProductionStartupEnv, resolveExtraImgHosts } from '../server/app.ts';
import { initDatabase } from '../server/db/init.ts';
import { getDb, queryRows, closeDb } from '../server/db/index.ts';
import { seedDatabase, SEED_PRODUCTS_RAW } from '../server/db/seed.ts';
import {
  isStrictRuntimeMode,
  isPreviewRuntimeMode,
  validateAdminPasswordPolicy,
  PREVIEW_MODE_WARNING_BANNER,
  STRICT_MODE_AI_STUDIO_HINT,
  restoreRuntimeModeEnv,
} from '../server/config/runtimeMode.ts';
import {
  sendPasswordResetEmail,
  setEmailHttpFetchForTest,
  parseSenderAddress,
  EMAIL_TIMEOUT_MS,
} from '../server/services/email.ts';
import {
  resolvePaymentWebhookSecret,
  createWebhookSignature,
  verifyWebhookSignature,
} from '../server/services/vietqr.ts';
import { runProductionRehearsal } from '../scripts/prod-rehearsal.ts';
import {
  secureDevAccounts,
  hasSecureDevAccountsConfirmFlag,
} from '../scripts/secure-dev-accounts.ts';
import { loadContainerSecretsIfMissing } from '../scripts/load-container-env.ts';

after(async () => {
  setEmailHttpFetchForTest(null);
  restoreRuntimeModeEnv({ NODE_ENV: 'test' }, process.env);
  delete process.env.PAYMENT_WEBHOOK_SECRET;
  delete process.env.WEBHOOK_SECRET;
  process.env.COOKIE_CROSS_SITE = 'false';
  process.env.USE_PGLITE = 'true';
  await closeDb().catch(() => {});
});

function walkTsFiles(dirPath: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dirPath)) return results;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTsFiles(full));
    } else if (entry.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

const VALID_STRICT_PROD_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  RENDER: 'true',
  COOKIE_CROSS_SITE: 'false',
  USE_PGLITE: 'false',
  SEED_DEV_ACCOUNTS: 'false',
  ENABLE_DEMO_PAYMENT_WEBHOOK: 'false',
  DATABASE_URL:
    'postgresql://postgres.ref:pass@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
  JWT_SECRET: 'strong-production-jwt-secret-key-at-least-32-chars',
  ADMIN_EMAIL: 'ops.admin@baity.vn',
  ADMIN_INITIAL_PASSWORD: 'StrongAdminPassword@2026!',
  CRON_SECRET_KEY: 'strong-production-cron-secret-key-2026',
  PAYMENT_WEBHOOK_SECRET: 'strong-production-webhook-secret-key-2026',
  EMAIL_PROVIDER: 'brevo',
  EMAIL_FROM: 'Baity Fashion <ops@baity.vn>',
};

// ============================================================================
// MỤC 1A: QUÉT MÃ NGUỒN ĐẢM BẢO RENDER, PRODUCTION_STRICT, APP_MODE CHỈ Ở runtimeMode.ts
// ============================================================================
test('Stage 9.1a (RuntimeMode Single Source of Truth Scan — Item 1): Quét mã nguồn xác nhận process.env.RENDER, PRODUCTION_STRICT và APP_MODE chỉ xuất hiện duy nhất trong server/config/runtimeMode.ts', () => {
  const rootDir = process.cwd();
  const targetFiles = [
    path.join(rootDir, 'server.ts'),
    ...walkTsFiles(path.join(rootDir, 'server')),
    ...walkTsFiles(path.join(rootDir, 'scripts')),
  ];

  const allowedFile = path.resolve(rootDir, 'server/config/runtimeMode.ts');
  const violations: string[] = [];

  for (const filePath of targetFiles) {
    const resolved = path.resolve(filePath);
    const rel = path.relative(rootDir, resolved).replace(/\\/g, '/');
    const content = fs.readFileSync(resolved, 'utf8');

    const hasRenderEnv = /\b(?:process\.env|env)\.RENDER\b/.test(content);
    const hasProdStrict = /\bPRODUCTION_STRICT\b/.test(content);
    const hasAppMode = /\bAPP_MODE\b/.test(content);

    if (resolved === allowedFile) {
      assert.equal(hasRenderEnv, true, 'runtimeMode.ts phải đọc RENDER');
      assert.equal(hasProdStrict, true, 'runtimeMode.ts phải đọc PRODUCTION_STRICT');
      assert.equal(hasAppMode, true, 'runtimeMode.ts phải đọc APP_MODE');
    } else if (hasRenderEnv || hasProdStrict || hasAppMode) {
      violations.push(rel);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Các biến RENDER, PRODUCTION_STRICT, APP_MODE chỉ được phép xuất hiện trong server/config/runtimeMode.ts, nhưng tìm thấy tại: ${violations.join(', ')}`
  );
});

// ============================================================================
// MỤC 1B: KIỂM THỬ MA TRẬN ĐẦY ĐỦ 108 TỔ HỢP CHẾ ĐỘ CHẠY (NODE_ENV x RENDER x PRODUCTION_STRICT x APP_MODE x COOKIE_CROSS_SITE)
// ============================================================================
test('Stage 9.1b (RuntimeMode Exhaustive 108-Combination Matrix & Preview Warning — Item 1): Kiểm tra toàn bộ 108 tổ hợp NODE_ENV x RENDER x PRODUCTION_STRICT x APP_MODE x COOKIE_CROSS_SITE; xác nhận RENDER=false và COOKIE_CROSS_SITE=true không làm yếu strict, RENDER=true luôn thắng APP_MODE=preview, và kiểm tra thông báo AI Studio APP_MODE=preview', () => {
  const nodeEnvs: Array<string | undefined> = ['production', 'development', 'test'];
  const renderVals: Array<string | undefined> = ['true', 'false', undefined];
  const prodStrictVals: Array<string | undefined> = ['true', 'false', undefined];
  const appModeVals: Array<string | undefined> = ['preview', undefined];
  const cookieCrossSiteVals: Array<string | undefined> = ['true', undefined];

  let testedCombinations = 0;

  for (const nodeEnv of nodeEnvs) {
    for (const render of renderVals) {
      for (const prodStrict of prodStrictVals) {
        for (const appMode of appModeVals) {
          for (const cookieCrossSite of cookieCrossSiteVals) {
            testedCombinations++;
            const env: NodeJS.ProcessEnv = {};
            if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
            if (render !== undefined) env.RENDER = render;
            if (prodStrict !== undefined) env.PRODUCTION_STRICT = prodStrict;
            if (appMode !== undefined) env.APP_MODE = appMode;
            if (cookieCrossSite !== undefined) env.COOKIE_CROSS_SITE = cookieCrossSite;

            const expectedStrict =
              render === 'true' ||
              prodStrict === 'true' ||
              (nodeEnv === 'production' && appMode !== 'preview');

            const actualStrict = isStrictRuntimeMode(env);
            assert.equal(
              actualStrict,
              expectedStrict,
              `Sai lệch kết quả strict tại tổ hợp: NODE_ENV=${nodeEnv}, RENDER=${render}, PRODUCTION_STRICT=${prodStrict}, APP_MODE=${appMode}, COOKIE_CROSS_SITE=${cookieCrossSite}`
            );

            // RENDER=true luôn thắng APP_MODE=preview
            if (render === 'true' && appMode === 'preview') {
              assert.equal(actualStrict, true, 'RENDER=true phải luôn thắng APP_MODE=preview');
            }
          }
        }
      }
    }
  }

  assert.equal(testedCombinations, 108, 'Phải kiểm tra đủ 108 tổ hợp');

  // Trường hợp đặc biệt 1: NODE_ENV=production, RENDER=false, COOKIE_CROSS_SITE=true, KHÔNG có APP_MODE
  // -> Phải là strict và từ chối khởi động kèm hướng dẫn "AI Studio: đặt APP_MODE=preview"
  const cloudRunWithoutAppMode: NodeJS.ProcessEnv = {
    ...VALID_STRICT_PROD_ENV,
    NODE_ENV: 'production',
    RENDER: 'false',
    PRODUCTION_STRICT: 'false',
    COOKIE_CROSS_SITE: 'true',
  };
  delete cloudRunWithoutAppMode.APP_MODE;

  assert.equal(
    isStrictRuntimeMode(cloudRunWithoutAppMode),
    true,
    'NODE_ENV=production, RENDER=false, COOKIE_CROSS_SITE=true, không APP_MODE bắt buộc phải là strict'
  );
  const blockedCheck = validateProductionStartupEnv(cloudRunWithoutAppMode);
  assert.equal(blockedCheck.ok, false, 'Phải từ chối khởi động khi không đặt APP_MODE=preview');
  const blockedMsg = blockedCheck.errors.join('\n');
  assert.ok(blockedMsg.includes('COOKIE_CROSS_SITE'));
  assert.ok(
    blockedMsg.includes(STRICT_MODE_AI_STUDIO_HINT),
    'Thông báo lỗi khi bị chặn ở strict phải nêu rõ: "AI Studio: đặt APP_MODE=preview"'
  );

  // Trường hợp đặc biệt 2: NODE_ENV=production, RENDER=false, COOKIE_CROSS_SITE=true, CÓ APP_MODE=preview
  // -> Không phải strict, cho phép khởi động và in cảnh báo lớn "PREVIEW MODE - không dùng cho production"
  const cloudRunWithPreviewMode: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    RENDER: 'false',
    PRODUCTION_STRICT: 'false',
    APP_MODE: 'preview',
    COOKIE_CROSS_SITE: 'true',
  };
  assert.equal(isStrictRuntimeMode(cloudRunWithPreviewMode), false);
  assert.equal(isPreviewRuntimeMode(cloudRunWithPreviewMode), true);

  const warningLogs: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => warningLogs.push(args.join(' '));
  try {
    const allowedPreviewCheck = validateProductionStartupEnv(cloudRunWithPreviewMode);
    assert.equal(allowedPreviewCheck.ok, true, 'Có APP_MODE=preview thì phải cho phép khởi động');
  } finally {
    console.warn = origWarn;
  }

  assert.ok(
    warningLogs.some((line) => line.includes('PREVIEW MODE - không dùng cho production')),
    `Ở chế độ preview phải in cảnh báo lớn "PREVIEW MODE - không dùng cho production" (log thực tế: ${warningLogs.join(' | ')})`
  );
  assert.ok(PREVIEW_MODE_WARNING_BANNER.includes('PREVIEW MODE - không dùng cho production'));
});

// ============================================================================
// MỤC 2: KIỂM TRA TỪNG ĐIỀU KIỆN KHỞI ĐỘNG Ở CHẾ ĐỘ STRICT & CHẶN USE_PGLITE Ở MỌI STRICT
// ============================================================================
test('Stage 9.1c (Strict Startup Conditions & Universal USE_PGLITE Block — Item 2): Kiểm tra từng điều kiện chặn khởi động ở strict (chỉ nêu tên biến, không lộ giá trị) và xác nhận server/db/index.ts chặn USE_PGLITE ở mọi chế độ strict', async () => {
  // Đảm bảo cấu hình chuẩn vượt qua 100%
  const passRes = validateProductionStartupEnv(VALID_STRICT_PROD_ENV);
  assert.equal(passRes.ok, true);
  assert.equal(passRes.errors.length, 0);

  const secretJwtCanary = 'SHORT_JWT_12';
  const secretPassCanary = 'CanaryWeak!';
  const secretDbCanary = 'postgresql://user:CANARY_DB_PASS_SECRET@host:5432/db';

  const individualFailureCases: Array<{
    label: string;
    expectedVarName: string;
    forbiddenLeak?: string;
    envOverride: Partial<NodeJS.ProcessEnv>;
  }> = [
    {
      label: 'COOKIE_CROSS_SITE=true',
      expectedVarName: 'COOKIE_CROSS_SITE',
      envOverride: { COOKIE_CROSS_SITE: 'true' },
    },
    {
      label: 'USE_PGLITE=true khi RENDER=false nhưng NODE_ENV=production (mọi strict)',
      expectedVarName: 'USE_PGLITE',
      envOverride: { RENDER: 'false', NODE_ENV: 'production', USE_PGLITE: 'true' },
    },
    {
      label: 'SEED_DEV_ACCOUNTS=true',
      expectedVarName: 'SEED_DEV_ACCOUNTS',
      envOverride: { SEED_DEV_ACCOUNTS: 'true' },
    },
    {
      label: 'ENABLE_DEMO_PAYMENT_WEBHOOK=true',
      expectedVarName: 'ENABLE_DEMO_PAYMENT_WEBHOOK',
      envOverride: { ENABLE_DEMO_PAYMENT_WEBHOOK: 'true' },
    },
    {
      label: 'Thiếu DATABASE_URL (khi RENDER=false, NODE_ENV=production)',
      expectedVarName: 'DATABASE_URL',
      envOverride: { RENDER: 'false', NODE_ENV: 'production', DATABASE_URL: '' },
    },
    {
      label: 'Thiếu JWT_SECRET',
      expectedVarName: 'JWT_SECRET',
      envOverride: { JWT_SECRET: '' },
    },
    {
      label: 'JWT_SECRET quá ngắn (< 16 ký tự)',
      expectedVarName: 'JWT_SECRET',
      forbiddenLeak: secretJwtCanary,
      envOverride: { JWT_SECRET: secretJwtCanary },
    },
    {
      label: 'Thiếu ADMIN_EMAIL',
      expectedVarName: 'ADMIN_EMAIL',
      envOverride: { ADMIN_EMAIL: '' },
    },
    {
      label: 'ADMIN_EMAIL trùng tài khoản mẫu',
      expectedVarName: 'ADMIN_EMAIL',
      envOverride: { ADMIN_EMAIL: 'khach1@baity.vn' },
    },
    {
      label: 'Thiếu ADMIN_INITIAL_PASSWORD',
      expectedVarName: 'ADMIN_INITIAL_PASSWORD',
      envOverride: { ADMIN_INITIAL_PASSWORD: '' },
    },
    {
      label: 'ADMIN_INITIAL_PASSWORD yếu',
      expectedVarName: 'ADMIN_INITIAL_PASSWORD',
      forbiddenLeak: secretPassCanary,
      envOverride: { ADMIN_INITIAL_PASSWORD: secretPassCanary, DATABASE_URL: secretDbCanary },
    },
    {
      label: 'Thiếu CRON_SECRET_KEY',
      expectedVarName: 'CRON_SECRET_KEY',
      envOverride: { CRON_SECRET_KEY: '' },
    },
    {
      label: 'Thiếu PAYMENT_WEBHOOK_SECRET',
      expectedVarName: 'PAYMENT_WEBHOOK_SECRET',
      envOverride: { PAYMENT_WEBHOOK_SECRET: '' },
    },
  ];

  for (const tc of individualFailureCases) {
    const testEnv: NodeJS.ProcessEnv = {
      ...VALID_STRICT_PROD_ENV,
      ...tc.envOverride,
    };
    const res = validateProductionStartupEnv(testEnv);
    assert.equal(res.ok, false, `Điều kiện "${tc.label}" bắt buộc phải bị chặn ở chế độ strict`);
    const joined = res.errors.join('\n');
    assert.ok(
      joined.includes(tc.expectedVarName),
      `Điều kiện "${tc.label}" phải nêu rõ tên biến ${tc.expectedVarName} (thực tế: ${joined})`
    );
    assert.ok(
      joined.includes('AI Studio: đặt APP_MODE=preview'),
      `Điều kiện "${tc.label}" phải kèm hướng dẫn AI Studio: đặt APP_MODE=preview`
    );
    if (tc.forbiddenLeak) {
      assert.equal(
        joined.includes(tc.forbiddenLeak),
        false,
        `Tuyệt đối không được in giá trị bí mật ra thông báo lỗi (${tc.label})`
      );
    }
    assert.equal(
      joined.includes('CANARY_DB_PASS_SECRET'),
      false,
      'Tuyệt đối không được in DATABASE_URL ra thông báo lỗi'
    );
  }

  // Kiểm tra getDb() trong server/db/index.ts chặn USE_PGLITE=true ở MỌI chế độ strict (kể cả khi RENDER=false, NODE_ENV=production)
  const snapshot = { ...process.env };
  try {
    await closeDb().catch(() => {});
    restoreRuntimeModeEnv(
      { NODE_ENV: 'production', RENDER: 'false', PRODUCTION_STRICT: 'false', APP_MODE: undefined },
      process.env
    );
    process.env.COOKIE_CROSS_SITE = 'false';
    process.env.USE_PGLITE = 'true';

    await assert.rejects(
      async () => await getDb(),
      (err: any) =>
        err instanceof Error &&
        err.message.includes('USE_PGLITE') &&
        err.message.includes('AI Studio: đặt APP_MODE=preview'),
      'getDb() phải từ chối USE_PGLITE=true ở mọi chế độ strict kể cả khi RENDER=false'
    );
  } finally {
    restoreRuntimeModeEnv(snapshot, process.env);
    process.env.COOKIE_CROSS_SITE = snapshot.COOKIE_CROSS_SITE || 'false';
    process.env.USE_PGLITE = snapshot.USE_PGLITE || 'true';
  }
});

// ============================================================================
// MỤC 3: CHÍNH SÁCH MẬT KHẨU ADMIN Ở MỌI CHẾ ĐỘ (TRỪ NODE_ENV=test)
// ============================================================================
test('Stage 9.1d (Admin Password Policy Across Modes — Item 3): Mật khẩu Admin bắt buộc >= 12 ký tự, có chữ và số, không thuộc danh sách cấm; nếu yếu ở preview/dev thì không tạo/cập nhật admin, ghi lỗi không lộ giá trị và không làm sập preview', async () => {
  // 1. Kiểm tra hàm validateAdminPasswordPolicy với các trường hợp không đạt và đạt
  const invalidPasswords = [
    '',
    'Short123!', // < 12 ký tự (9 ký tự)
    '11CharsPass', // 11 ký tự
    'OnlyLettersPasswordNoDigits!', // >= 12 ký tự nhưng thiếu số
    '1234567890123456', // >= 12 ký tự nhưng thiếu chữ
    'Admin@123', // danh sách cấm
    'Admin@123456', // biến thể danh sách cấm
    'Khach@123', // danh sách cấm
    'Khach@123456', // biến thể danh sách cấm
    'Baity2026Shop9xK', // danh sách cấm (>= 12 ký tự, có chữ & số nhưng bị cấm)
    'baity2026shop9xk_2026', // biến thể của Baity2026Shop9xK
  ];

  for (const badPwd of invalidPasswords) {
    const check = validateAdminPasswordPolicy(badPwd);
    assert.equal(check.valid, false, `Mật khẩu yếu/bị cấm phải bị từ chối (độ dài=${badPwd.length})`);
    if (badPwd.length >= 4) {
      assert.equal(
        String(check.reason || '').includes(badPwd),
        false,
        'Thông báo lỗi chính sách mật khẩu tuyệt đối không được chứa giá trị mật khẩu'
      );
    }
  }

  const validPasswords = [
    'StrongAdminPass@2026!',
    'RehearsalStrongPass@2026!',
    'MySecureShopAdmin99#2026',
  ];
  for (const goodPwd of validPasswords) {
    const check = validateAdminPasswordPolicy(goodPwd);
    assert.equal(check.valid, true, 'Mật khẩu >= 12 ký tự có chữ và số, không nằm trong danh sách cấm phải đạt');
  }

  // 2. Ở chế độ Preview (NODE_ENV=production, APP_MODE=preview):
  // Nếu ADMIN_INITIAL_PASSWORD yếu (ví dụ Baity2026Shop9xK hoặc Admin@123):
  // - KHÔNG tạo hoặc cập nhật admin
  // - Ghi lỗi ra log (không in giá trị mật khẩu)
  // - KHÔNG dừng / ném lỗi làm sập bản preview
  const prevEnv = { ...process.env };
  const capturedErrors: string[] = [];
  const origError = console.error;

  try {
    await closeDb().catch(() => {});
    process.env.USE_PGLITE = 'true';
    process.env.PGLITE_DATA_DIR = 'memory://';
    restoreRuntimeModeEnv(
      { NODE_ENV: 'production', APP_MODE: 'preview', RENDER: 'false', PRODUCTION_STRICT: 'false' },
      process.env
    );
    process.env.SEED_DEV_ACCOUNTS = 'false';
    process.env.ADMIN_EMAIL = 'weak.preview.admin@baity.vn';
    const weakCanaryPwd = 'Baity2026Shop9xK';
    process.env.ADMIN_INITIAL_PASSWORD = weakCanaryPwd;

    console.error = (...args: any[]) => capturedErrors.push(args.join(' '));

    await initDatabase();
    // Không được ném lỗi ở preview
    await seedDatabase();

    const adminRows = await queryRows<{ email: string }>(sql`
      SELECT email FROM users WHERE LOWER(email) = 'weak.preview.admin@baity.vn';
    `);
    assert.equal(
      adminRows.length,
      0,
      'Khi mật khẩu yếu ở chế độ preview, tuyệt đối KHÔNG được tạo hoặc cập nhật tài khoản Admin'
    );

    const secureRes = await secureDevAccounts({
      adminEmail: 'weak.preview.admin@baity.vn',
      adminInitialPassword: weakCanaryPwd,
    });
    assert.equal(secureRes.adminAction, 'skipped');
    assert.equal(secureRes.passwordPolicyPassed, false);

    const errOutput = capturedErrors.join('\n');
    assert.ok(
      errOutput.includes('[ADMIN PASSWORD POLICY ERROR]'),
      'Phải ghi lỗi [ADMIN PASSWORD POLICY ERROR] khi mật khẩu Admin yếu'
    );
    assert.equal(
      errOutput.includes(weakCanaryPwd),
      false,
      'Log lỗi tuyệt đối không được in giá trị mật khẩu yếu'
    );
  } finally {
    console.error = origError;
    restoreRuntimeModeEnv(prevEnv, process.env);
    process.env.SEED_DEV_ACCOUNTS = prevEnv.SEED_DEV_ACCOUNTS || 'false';
    process.env.ADMIN_EMAIL = prevEnv.ADMIN_EMAIL;
    process.env.ADMIN_INITIAL_PASSWORD = prevEnv.ADMIN_INITIAL_PASSWORD;
  }
});

// ============================================================================
// MỤC 4: DIỄN TẬP KHỞI TẠO PRODUCTION NGHIÊM NGẶT 2 PHẦN (prod:rehearsal)
// ============================================================================
test('Stage 9.2 (Strict Empty-DB Production Rehearsal Parts A & B — Item 4): Chạy prod:rehearsal ở chế độ strict thật (NODE_ENV=production, PRODUCTION_STRICT=true, không bật USE_PGLITE trong env), kiểm tra đủ Phần (a) và Phần (b) với PGlite tiêm qua hook test', async () => {
  const summary = await runProductionRehearsal();
  assert.equal(summary.partAValidationOk, true, 'Phần (a) kiểm tra bộ biến hợp lệ phải đạt');
  assert.ok(
    summary.rejectedVariablesInPartA.length >= 12,
    'Phần (a) phải kiểm tra và chặn từng biến cấm / thiếu bắt buộc'
  );
  assert.equal(summary.strictModeActive, true, 'Phần (b) phải chạy ở chế độ strict thật');
  assert.equal(
    summary.usePgliteEnvDisabled,
    true,
    'Phần (b) không được bật USE_PGLITE từ biến môi trường'
  );
  assert.equal(summary.startupOk, true);
  assert.equal(summary.adminLoginOk, true);
  assert.equal(summary.adminEmail, 'rehearsal.admin@baity.vn');
  assert.equal(summary.hasSameSiteLax, true, 'Cookie phải có SameSite=Lax');
  assert.equal(summary.hasSecureCookie, true, 'Cookie phải có Secure');
  assert.equal(summary.hasHttpOnlyCookie, true, 'Cookie phải có HttpOnly');
  assert.equal(
    summary.productsTotal,
    0,
    'CSDL trống ở Production không bật ENABLE_SEED_DEMO_DATA phải có 0 sản phẩm'
  );
  assert.equal(summary.categoriesCount, 9, 'Phải có sẵn 9 danh mục gốc');
  assert.ok(summary.policiesCount >= 4, 'Phải có đầy đủ các chính sách');
  assert.ok(summary.faqCount >= 10, 'Phải có đầy đủ các câu hỏi FAQ');
  assert.equal(
    summary.devAccountsFound.length,
    0,
    'Không được tồn tại bất kỳ tài khoản mẫu nào (admin@baity.vn, khach1@baity.vn, khach2@baity.vn)'
  );
  assert.equal(summary.diagStatus, 404, 'GET /api/auth/diag phải trả 404');
});

// ============================================================================
// MỤC 5 & 6: EMAIL_FROM KHÔNG CÓ MẶC ĐỊNH, BREVO/RESEND BẮT BUỘC EMAIL_FROM Ở STRICT, VÀ WEBHOOK ALIAS
// ============================================================================
test('Stage 9.3 (HTTPS Email Provider Brevo/Resend, No Default EMAIL_FROM & Production Zero-Log — Item 5): EMAIL_FROM không có mặc định; ở strict khi EMAIL_PROVIDER=brevo/resend thiếu EMAIL_FROM thì dừng khởi động, EMAIL_PROVIDER=log thì khởi động kèm cảnh báo không lộ token; timeout 8s', async () => {
  assert.equal(EMAIL_TIMEOUT_MS, 8000, 'Timeout gửi email phải là 8000ms (8 giây)');

  // 0. Xác nhận EMAIL_FROM không có giá trị mặc định (đặc biệt không còn no-reply@baity.vn khi để trống)
  const emptySender = parseSenderAddress('');
  assert.equal(emptySender.email, '', 'Khi EMAIL_FROM trống thì email gửi phải rỗng, không có mặc định');
  assert.equal(emptySender.formatted, '');

  // Ở strict: EMAIL_PROVIDER=brevo hoặc resend mà thiếu EMAIL_FROM -> dừng khởi động
  const strictBrevoMissingFrom = validateProductionStartupEnv({
    ...VALID_STRICT_PROD_ENV,
    EMAIL_PROVIDER: 'brevo',
    EMAIL_FROM: '',
  });
  assert.equal(
    strictBrevoMissingFrom.ok,
    false,
    'Ở strict: EMAIL_PROVIDER=brevo thiếu EMAIL_FROM phải dừng khởi động'
  );
  assert.ok(strictBrevoMissingFrom.errors.some((e) => e.includes('EMAIL_FROM')));

  const strictResendMissingFrom = validateProductionStartupEnv({
    ...VALID_STRICT_PROD_ENV,
    EMAIL_PROVIDER: 'resend',
    EMAIL_FROM: '',
  });
  assert.equal(
    strictResendMissingFrom.ok,
    false,
    'Ở strict: EMAIL_PROVIDER=resend thiếu EMAIL_FROM phải dừng khởi động'
  );
  assert.ok(strictResendMissingFrom.errors.some((e) => e.includes('EMAIL_FROM')));

  // Ở strict: EMAIL_PROVIDER=log thiếu EMAIL_FROM -> vẫn khởi động (ok=true) nhưng ghi cảnh báo cấu hình (không có token)
  const startupWarns: string[] = [];
  const origWarnStartup = console.warn;
  console.warn = (...args: any[]) => startupWarns.push(args.join(' '));
  try {
    const strictLogProvider = validateProductionStartupEnv({
      ...VALID_STRICT_PROD_ENV,
      EMAIL_PROVIDER: 'log',
      EMAIL_FROM: '',
      BREVO_API_KEY: 'chua-dung',
      RESEND_API_KEY: 'chua-dung',
    });
    assert.equal(
      strictLogProvider.ok,
      true,
      'Ở strict: EMAIL_PROVIDER=log phải cho phép khởi động'
    );
  } finally {
    console.warn = origWarnStartup;
  }
  assert.ok(
    startupWarns.some((w) => w.includes('[EMAIL CONFIG WARNING]')),
    'Ở strict: EMAIL_PROVIDER=log phải ghi cảnh báo [EMAIL CONFIG WARNING]'
  );

  const secretResetToken = 'CANARY_RESET_TOKEN_998877665544332211';
  const resetUrl = `https://baity.vn/reset-password?token=${secretResetToken}&email=khach%40baity.vn`;

  // 1. Kiểm tra gửi qua Brevo HTTPS API (https://api.brevo.com/v3/smtp/email)
  let capturedUrl = '';
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: any = null;
  let hasAbortSignal = false;

  setEmailHttpFetchForTest(async (url, init) => {
    capturedUrl = url;
    capturedHeaders = (init.headers || {}) as Record<string, string>;
    capturedBody = JSON.parse(String(init.body || '{}'));
    hasAbortSignal = Boolean(init.signal);
    return {
      ok: true,
      status: 201,
      text: async () => '{"messageId":"<brevo-123>"}',
    };
  });

  const brevoOk = await sendPasswordResetEmail('khach@baity.vn', resetUrl, {
    NODE_ENV: 'production',
    EMAIL_PROVIDER: 'brevo',
    BREVO_API_KEY: 'xkeysib-mock-brevo-key',
    EMAIL_FROM: 'Baity Fashion <ops@baity.vn>',
  });
  assert.equal(brevoOk, true);
  assert.equal(capturedUrl, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(capturedHeaders['api-key'], 'xkeysib-mock-brevo-key');
  assert.equal(capturedBody.sender?.email, 'ops@baity.vn');
  assert.equal(capturedBody.to?.[0]?.email, 'khach@baity.vn');
  assert.ok(String(capturedBody.htmlContent || '').includes(secretResetToken));
  assert.equal(hasAbortSignal, true, 'Phải truyền AbortSignal (timeout 8 giây) vào fetch');

  // 2. Kiểm tra gửi qua Resend HTTPS API (https://api.resend.com/emails)
  setEmailHttpFetchForTest(async (url, init) => {
    capturedUrl = url;
    capturedHeaders = (init.headers || {}) as Record<string, string>;
    capturedBody = JSON.parse(String(init.body || '{}'));
    return {
      ok: true,
      status: 200,
      text: async () => '{"id":"resend-456"}',
    };
  });

  const resendOk = await sendPasswordResetEmail('khach@baity.vn', resetUrl, {
    NODE_ENV: 'production',
    EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 're_mock_resend_key',
    EMAIL_FROM: 'Baity Fashion <ops@baity.vn>',
  });
  assert.equal(resendOk, true);
  assert.equal(capturedUrl, 'https://api.resend.com/emails');
  assert.equal(capturedHeaders.Authorization, 'Bearer re_mock_resend_key');
  assert.equal(capturedBody.from, 'Baity Fashion <ops@baity.vn>');
  assert.deepEqual(capturedBody.to, ['khach@baity.vn']);
  assert.ok(String(capturedBody.html || '').includes(secretResetToken));

  // 3. Kiểm tra ở Production khi chưa cấu hình nhà cung cấp (EMAIL_PROVIDER=log):
  //    - Yêu cầu POST /api/auth/forgot-password vẫn trả HTTP 200 với thông báo chung cho khách
  //    - Ghi cảnh báo cấu hình vào log server nhưng TUYỆT ĐỐI KHÔNG chứa token, link đặt lại hay email
  await closeDb().catch(() => {});
  restoreRuntimeModeEnv({ NODE_ENV: 'test' }, process.env);
  process.env.USE_PGLITE = 'true';
  await initDatabase();
  await queryRows(sql`
    INSERT INTO users (full_name, email, phone, password_hash, role)
    VALUES ('Khách Quên Mật Khẩu', 'forgot_prod_test@baity.vn', '0911222888', 'hashed', 'customer')
    ON CONFLICT (email) DO NOTHING;
  `);

  const app = createApp();
  const server = http.createServer(app);
  let baseUrl = '';
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  const capturedLogs: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const intercept = (...args: any[]) => {
    capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };

  try {
    restoreRuntimeModeEnv({ NODE_ENV: 'production' }, process.env);
    process.env.EMAIL_PROVIDER = 'log';
    process.env.ENABLE_DEMO_EMAIL_LOG = 'true';
    console.log = intercept;
    console.warn = intercept;
    console.error = intercept;

    const forgotRes = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': '127.0.0.1',
        Origin: 'https://127.0.0.1',
      },
      body: JSON.stringify({ email: 'forgot_prod_test@baity.vn' }),
    });
    assert.equal(forgotRes.status, 200);
    const forgotBody = await forgotRes.json();
    assert.equal(forgotBody.success, true);
    assert.ok(
      String(forgotBody.message || '').includes('Nếu email tồn tại trong hệ thống Baity')
    );
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
    restoreRuntimeModeEnv({ NODE_ENV: 'test' }, process.env);
    delete process.env.EMAIL_PROVIDER;
    process.env.ENABLE_DEMO_EMAIL_LOG = 'false';
    setEmailHttpFetchForTest(null);
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const allProdLogs = capturedLogs.join('\n');
  assert.ok(
    allProdLogs.includes('[EMAIL CONFIG WARNING]'),
    'Phải ghi cảnh báo cấu hình [EMAIL CONFIG WARNING] vào log server khi chưa cấu hình nhà cung cấp ở Production'
  );
  assert.equal(
    allProdLogs.includes('/reset-password'),
    false,
    'Ở Production tuyệt đối không được log liên kết đặt lại mật khẩu (/reset-password) ra console'
  );
  assert.equal(
    allProdLogs.includes('forgot_prod_test@baity.vn'),
    false,
    'Ở Production cảnh báo cấu hình email không được log địa chỉ email người dùng'
  );

  // 4. Kiểm tra PAYMENT_WEBHOOK_SECRET (tên chính) và WEBHOOK_SECRET (alias tương thích ngược)
  const prevPrimary = process.env.PAYMENT_WEBHOOK_SECRET;
  const prevAlias = process.env.WEBHOOK_SECRET;
  try {
    process.env.PAYMENT_WEBHOOK_SECRET = 'primary-webhook-secret-key-111';
    process.env.WEBHOOK_SECRET = 'alias-webhook-secret-key-222';
    assert.equal(resolvePaymentWebhookSecret(), 'primary-webhook-secret-key-111');

    delete process.env.PAYMENT_WEBHOOK_SECRET;
    process.env.WEBHOOK_SECRET = 'alias-webhook-secret-key-222';
    assert.equal(resolvePaymentWebhookSecret(), 'alias-webhook-secret-key-222');
    const nowTs = String(Date.now());
    const rawBody = JSON.stringify({ orderId: 'BT-TEST-01', amount: 250000, transactionId: 'TXN-01' });
    const sigFromAlias = createWebhookSignature(rawBody, nowTs);
    assert.equal(
      verifyWebhookSignature(
        {
          'x-webhook-timestamp': nowTs,
          'x-webhook-signature': sigFromAlias,
        },
        rawBody
      ),
      true
    );
  } finally {
    if (prevPrimary === undefined) delete process.env.PAYMENT_WEBHOOK_SECRET;
    else process.env.PAYMENT_WEBHOOK_SECRET = prevPrimary;
    if (prevAlias === undefined) delete process.env.WEBHOOK_SECRET;
    else process.env.WEBHOOK_SECRET = prevAlias;
  }
});

// ============================================================================
// 4. TÁC VỤ ĐỊNH KỲ (POST /api/tasks/cron-cleanup): ĐỦ 5 TÁC VỤ, BẤT BIẾN 2 LẦN LIÊN TIẾP & HIỆU NĂNG TRÊN 5.000 ĐƠN MẪU
// ============================================================================
test('Stage 9.4 (Cron Cleanup 5 Tasks, Idempotency & 5,000 Orders Benchmark — Item 9): Thực hiện đủ 5 việc, chạy 2 lần liên tiếp bất biến (lần 2 trả toàn bộ số đếm = 0), và chạy nhanh trên 5.000 đơn mẫu (chỉ log số đếm)', async () => {
  await closeDb().catch(() => {});
  restoreRuntimeModeEnv({ NODE_ENV: 'test' }, process.env);
  process.env.USE_PGLITE = 'true';
  process.env.ENABLE_SEED_DEMO_DATA = 'true';
  await initDatabase();
  await seedDatabase();

  const app = createApp();
  const server = http.createServer(app);
  let baseUrl = '';
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  try {
    const userRows = await queryRows<{ id: string }>(sql`
      INSERT INTO users (full_name, email, phone, password_hash, role)
      VALUES ('Khách Benchmark Cron', 'cron_bench_5000@baity.vn', '0900500000', 'hashed', 'customer')
      ON CONFLICT (email) DO UPDATE SET full_name = 'Khách Benchmark Cron'
      RETURNING id;
    `);
    const userId = userRows[0].id;

    const varRows = await queryRows<{ id: string; product_id: string }>(sql`
      SELECT id, product_id FROM product_variants WHERE stock_quantity >= 20 LIMIT 1;
    `);
    const variantId = varRows[0].id;

    await queryRows(sql`
      INSERT INTO orders (
        id,
        user_id,
        status,
        subtotal,
        shipping_fee,
        discount_amount,
        total_amount,
        receiver_name,
        receiver_phone,
        shipping_address,
        created_at
      )
      SELECT
        'BT-BENCH-' || LPAD(gs::text, 5, '0'),
        ${userId}::uuid,
        CASE WHEN gs % 2 = 0 THEN 'confirmed' ELSE 'completed' END,
        250000,
        30000,
        0,
        280000,
        'Khách Benchmark',
        '0900500000',
        '123 Đường Benchmark, Quận 1, TP.HCM',
        NOW() - INTERVAL '2 days'
      FROM generate_series(1, 4990) AS gs
      ON CONFLICT (id) DO NOTHING;
    `);

    for (let i = 1; i <= 5; i++) {
      const expOrderId = `BT-EXP-900${i}`;
      await queryRows(sql`
        INSERT INTO orders (
          id, user_id, status, subtotal, shipping_fee, discount_amount, total_amount,
          receiver_name, receiver_phone, shipping_address, created_at
        )
        VALUES (
          ${expOrderId}, ${userId}::uuid, 'pending', 250000, 30000, 0, 280000,
          'Khách Quá Hạn', '0900500000', '123 Đường Benchmark',
          NOW() - INTERVAL '45 minutes'
        );
      `);
      await queryRows(sql`
        INSERT INTO order_items (order_id, variant_id, product_name, color, size, unit_price, quantity, total_price)
        VALUES (${expOrderId}, ${variantId}::uuid, 'Áo Benchmark', 'Đen', 'M', 250000, 1, 250000);
      `);
      await queryRows(sql`
        INSERT INTO payments (order_id, method, status)
        VALUES (${expOrderId}, 'vietqr', 'pending');
      `);
    }

    for (let i = 1; i <= 5; i++) {
      const delivOrderId = `BT-DELIV-900${i}`;
      await queryRows(sql`
        INSERT INTO orders (
          id, user_id, status, subtotal, shipping_fee, discount_amount, total_amount,
          receiver_name, receiver_phone, shipping_address, delivered_at, created_at
        )
        VALUES (
          ${delivOrderId}, ${userId}::uuid, 'delivered', 250000, 30000, 0, 280000,
          'Khách Đã Giao', '0900500000', '123 Đường Benchmark',
          NOW() - INTERVAL '10 days', NOW() - INTERVAL '12 days'
        );
      `);
    }

    await queryRows(sql`
      INSERT INTO chat_conversations (user_id, mode, status, closed_at, updated_at)
      VALUES (${userId}::uuid, 'human', 'closed', NOW() - INTERVAL '185 days', NOW() - INTERVAL '185 days');
    `);
    await queryRows(sql`
      INSERT INTO ai_search_logs (recognized_attributes, confidence, result_count, latency_ms, is_success, actor_hmac, created_at)
      VALUES ('{"isApparel":true}'::jsonb, 0.9, 4, 1200, true, 'hmac_old_95d', NOW() - INTERVAL '95 days');
    `);
    await queryRows(sql`
      INSERT INTO chatbot_daily_counters (date_key, scope_key, call_count, updated_at)
      VALUES (TO_CHAR(NOW() - INTERVAL '5 days', 'YYYY-MM-DD'), 'actor_daily:old_5d', 3, NOW() - INTERVAL '5 days')
      ON CONFLICT (date_key, scope_key) DO NOTHING;
    `);

    const totalOrdersRow = await queryRows<{ cnt: number }>(sql`SELECT COUNT(*)::int AS cnt FROM orders;`);
    assert.ok(totalOrdersRow[0].cnt >= 5000);

    const cronLogs: string[] = [];
    const origInfo = console.info;
    console.info = (...args: any[]) => {
      cronLogs.push(args.join(' '));
    };

    const cronSecret = process.env.CRON_SECRET_KEY || 'baity-cron-secret-token-key-2026';

    try {
      const t0 = Date.now();
      const res1 = await fetch(`${baseUrl}/api/tasks/cron-cleanup`, {
        method: 'POST',
        headers: { 'x-cron-secret': cronSecret },
      });
      const elapsed1 = Date.now() - t0;
      assert.equal(res1.status, 200);
      const run1Body = await res1.json();

      assert.equal(run1Body.cancelledCount, 5);
      assert.equal(run1Body.completedCount, 5);
      assert.ok(run1Body.deletedClosedSellerChatsCount >= 1);
      assert.ok(run1Body.deletedAiSearchLogsCount >= 1);
      assert.ok(run1Body.deletedChatbotCountersCount >= 1);
      assert.ok(elapsed1 < 3000);

      const res2 = await fetch(`${baseUrl}/api/tasks/cron-cleanup`, {
        method: 'POST',
        headers: { 'x-cron-secret': cronSecret },
      });
      assert.equal(res2.status, 200);
      const run2Body = await res2.json();

      assert.equal(run2Body.cancelledCount, 0);
      assert.equal(run2Body.completedCount, 0);
      assert.equal(run2Body.deletedClosedSellerChatsCount, 0);
      assert.equal(run2Body.deletedAiSearchLogsCount, 0);
      assert.equal(run2Body.deletedChatbotCountersCount, 0);
    } finally {
      console.info = origInfo;
    }

    const combinedCronLog = cronLogs.join('\n');
    assert.ok(combinedCronLog.includes('[CRON CLEANUP] cancelledOrders=5 completedOrders=5'));
    assert.equal(combinedCronLog.includes('0900500000'), false);
    assert.equal(combinedCronLog.includes('Khách Quá Hạn'), false);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// ============================================================================
// MỤC 1 (BỔ SUNG): ADMIN BOOTSTRAP CHỈ TẠO KHI CSDL TRỐNG, KHÔNG GHI ĐÈ MẬT KHẨU ĐÃ ĐỔI
// ============================================================================
test('Stage 9.5 (Admin Bootstrap Create-Only & Password Change Preservation — Item 1): ADMIN_INITIAL_PASSWORD chỉ tạo Admin khi CSDL chưa có Admin; đổi mật khẩu qua API rồi chạy lại seedDatabase() vẫn giữ mật khẩu mới và từ chối mật khẩu cũ; ở strict chỉ bắt buộc biến khi CSDL chưa có Admin', async () => {
  const prevEnv = { ...process.env };
  const initialAdminEmail = 'bootstrap.admin@baity.vn';
  const initialAdminPass = 'InitialAdminPass@2026!';
  const changedAdminPass = 'ChangedAdminPass#9999!';

  try {
    await closeDb().catch(() => {});
    process.env.USE_PGLITE = 'true';
    process.env.PGLITE_DATA_DIR = 'memory://';
    restoreRuntimeModeEnv(
      { NODE_ENV: 'production', APP_MODE: 'preview', RENDER: 'false', PRODUCTION_STRICT: 'false' },
      process.env
    );
    process.env.SEED_DEV_ACCOUNTS = 'false';
    process.env.COOKIE_CROSS_SITE = 'false';
    process.env.ADMIN_EMAIL = initialAdminEmail;
    process.env.ADMIN_INITIAL_PASSWORD = initialAdminPass;

    await initDatabase();
    await queryRows(sql`DELETE FROM users WHERE role = 'admin';`);

    // 1. Lần khởi động đầu tiên trên CSDL chưa có Admin -> Tạo mới Admin từ ADMIN_INITIAL_PASSWORD
    await seedDatabase();

    const app = createApp();
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // Đăng nhập bằng mật khẩu khởi tạo -> 200 OK
      const loginRes1 = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: baseUrl,
        },
        body: JSON.stringify({
          email: initialAdminEmail,
          password: initialAdminPass,
        }),
      });
      assert.equal(loginRes1.status, 200, 'Đăng nhập Admin lần đầu bằng ADMIN_INITIAL_PASSWORD phải trả 200');
      const setCookies1 = loginRes1.headers.getSetCookie
        ? loginRes1.headers.getSetCookie()
        : [loginRes1.headers.get('set-cookie') || ''];
      const authCookie1 = setCookies1.map((c) => c.split(';')[0]).join('; ');

      // 2. Đổi mật khẩu Admin qua API POST /api/auth/change-password
      const changePassRes = await fetch(`${baseUrl}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: baseUrl,
          Cookie: authCookie1,
        },
        body: JSON.stringify({
          currentPassword: initialAdminPass,
          newPassword: changedAdminPass,
        }),
      });
      assert.equal(changePassRes.status, 200, 'Đổi mật khẩu Admin qua API phải trả 200');

      // 3. Chạy lại quy trình khởi động (seedDatabase) khi ADMIN_INITIAL_PASSWORD vẫn giữ giá trị cũ
      await seedDatabase();

      // 4. Đăng nhập lại bằng mật khẩu cũ (ADMIN_INITIAL_PASSWORD) -> Phải bị từ chối 401
      const oldLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: baseUrl,
        },
        body: JSON.stringify({
          email: initialAdminEmail,
          password: initialAdminPass,
        }),
      });
      assert.equal(
        oldLoginRes.status,
        401,
        'Sau khi đổi mật khẩu và chạy lại khởi động, mật khẩu cũ trong ADMIN_INITIAL_PASSWORD phải bị từ chối (401)'
      );

      // 5. Đăng nhập bằng mật khẩu mới đã đổi -> Phải thành công 200
      const newLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: baseUrl,
        },
        body: JSON.stringify({
          email: initialAdminEmail,
          password: changedAdminPass,
        }),
      });
      assert.equal(
        newLoginRes.status,
        200,
        'Sau khi chạy lại khởi động, mật khẩu mới của Admin vẫn phải đăng nhập thành công (200)'
      );
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // 6. Kiểm tra ở chế độ strict:
    // - Khi CSDL đã có Admin (hasExistingAdmin: true): thiếu ADMIN_EMAIL và ADMIN_INITIAL_PASSWORD vẫn hợp lệ và seedDatabase() không dừng
    const strictWithExistingAdmin = validateProductionStartupEnv(
      {
        ...VALID_STRICT_PROD_ENV,
        ADMIN_EMAIL: '',
        ADMIN_INITIAL_PASSWORD: '',
      },
      { hasExistingAdmin: true }
    );
    assert.equal(
      strictWithExistingAdmin.ok,
      true,
      'Ở strict mode khi CSDL đã có Admin (hasExistingAdmin=true), xóa ADMIN_INITIAL_PASSWORD và ADMIN_EMAIL vẫn phải cho phép khởi động'
    );

    // - Khi CSDL trống (hasExistingAdmin: false): thiếu ADMIN_EMAIL hoặc ADMIN_INITIAL_PASSWORD phải bị chặn ngay
    const strictEmptyDbNoPass = validateProductionStartupEnv(
      {
        ...VALID_STRICT_PROD_ENV,
        ADMIN_INITIAL_PASSWORD: '',
      },
      { hasExistingAdmin: false }
    );
    assert.equal(
      strictEmptyDbNoPass.ok,
      false,
      'Ở strict mode khi CSDL chưa có Admin (hasExistingAdmin=false), thiếu ADMIN_INITIAL_PASSWORD phải dừng khởi động'
    );

    // Kiểm tra thực tế với seedDatabase() ở strict mode:
    // (a) Đã có Admin trong CSDL, xóa ADMIN_INITIAL_PASSWORD -> seedDatabase() chạy thành công
    restoreRuntimeModeEnv(
      { NODE_ENV: 'production', PRODUCTION_STRICT: 'true', RENDER: 'false', APP_MODE: undefined },
      process.env
    );
    delete process.env.ADMIN_INITIAL_PASSWORD;
    process.env.ENABLE_SEED_DEMO_DATA = 'false';
    await seedDatabase();

    // (b) Xóa sạch Admin trong CSDL (CSDL trống ở strict) mà thiếu ADMIN_INITIAL_PASSWORD -> seedDatabase() phải ném lỗi dừng ngay
    await queryRows(sql`DELETE FROM users WHERE role = 'admin';`);
    await assert.rejects(
      async () => {
        await seedDatabase();
      },
      /INVALID_PRODUCTION_ADMIN_CREDENTIALS/,
      'CSDL trống ở strict mà thiếu ADMIN_INITIAL_PASSWORD thì seedDatabase() phải dừng ngay'
    );

    // 7. Kiểm tra db:secure-dev-accounts yêu cầu cờ --confirm khi chạy từ CLI
    restoreRuntimeModeEnv({ NODE_ENV: 'test' }, process.env);
    assert.equal(hasSecureDevAccountsConfirmFlag(['node', 'scripts/secure-dev-accounts.ts']), false);
    assert.equal(hasSecureDevAccountsConfirmFlag(['node', 'scripts/secure-dev-accounts.ts', '--confirm']), true);
    await assert.rejects(
      async () => {
        await secureDevAccounts({
          requireConfirmFlag: true,
          argv: ['node', 'scripts/secure-dev-accounts.ts'],
        });
      },
      /THIẾU CỜ XÁC NHẬN/,
      'Chạy db:secure-dev-accounts từ CLI không có --confirm phải bị từ chối'
    );
  } finally {
    restoreRuntimeModeEnv(prevEnv, process.env);
    process.env.SEED_DEV_ACCOUNTS = prevEnv.SEED_DEV_ACCOUNTS || 'false';
    process.env.COOKIE_CROSS_SITE = prevEnv.COOKIE_CROSS_SITE || 'false';
    process.env.ADMIN_EMAIL = prevEnv.ADMIN_EMAIL;
    process.env.ADMIN_INITIAL_PASSWORD = prevEnv.ADMIN_INITIAL_PASSWORD;
  }
});

// ============================================================================
// MỤC 2 (BỔ SUNG): loadContainerSecretsIfMissing ĐÃ CHUYỂN SANG scripts/ VÀ KHÔNG CHẠY Ở STRICT
// ============================================================================
test('Stage 9.6 (loadContainerSecretsIfMissing Moved to scripts/ & Blocked in Strict — Item 2): Hàm loadContainerSecretsIfMissing đã xóa hoàn toàn khỏi server/, chỉ nằm trong scripts/load-container-env.ts, không chạy ở strict và không in giá trị bí mật', () => {
  // 1. Quét toàn bộ thư mục server/ để xác nhận không còn loadContainerSecretsIfMissing
  const serverDir = path.resolve(process.cwd(), 'server');
  const walkFiles = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...walkFiles(full));
      } else if (entry.name.endsWith('.ts')) {
        out.push(full);
      }
    }
    return out;
  };

  for (const file of walkFiles(serverDir)) {
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(
      content.includes('loadContainerSecretsIfMissing'),
      false,
      `File ${path.relative(process.cwd(), file)} trong server/ không được chứa loadContainerSecretsIfMissing`
    );
  }

  // 2. Xác nhận ở mọi tổ hợp strict mode, loadContainerSecretsIfMissing luôn trả về [] ngay lập tức
  const strictEnv1: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
  assert.deepEqual(loadContainerSecretsIfMissing(strictEnv1), []);
  assert.equal(strictEnv1.ADMIN_INITIAL_PASSWORD, undefined);

  const strictEnv2: NodeJS.ProcessEnv = { NODE_ENV: 'development', RENDER: 'true' };
  assert.deepEqual(loadContainerSecretsIfMissing(strictEnv2), []);

  const strictEnv3: NodeJS.ProcessEnv = { NODE_ENV: 'development', PRODUCTION_STRICT: 'true' };
  assert.deepEqual(loadContainerSecretsIfMissing(strictEnv3), []);

  // 3. Xác nhận khi chạy ở dev/test không bao giờ in log chứa bất kỳ giá trị nào
  const capturedLogs: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origErr = console.error;
  console.log = (...a: any[]) => capturedLogs.push(a.join(' '));
  console.warn = (...a: any[]) => capturedLogs.push(a.join(' '));
  console.error = (...a: any[]) => capturedLogs.push(a.join(' '));
  try {
    const devEnv: NodeJS.ProcessEnv = { NODE_ENV: 'development' };
    loadContainerSecretsIfMissing(devEnv);
    assert.equal(capturedLogs.length, 0, 'loadContainerSecretsIfMissing tuyệt đối không được in ra console');
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origErr;
  }
});

// ============================================================================
// MỤC 3 (BỔ SUNG): KIỂM TRA CSP Ở STRICT PRODUCTION VÀ PREVIEW
// ============================================================================
test('Stage 9.7 (Strict Production CSP vs Preview CSP & CSP_EXTRA_IMG_HOSTS — Item 3): CSP_EXTRA_IMG_HOSTS tùy chọn (để trống/không đặt, 1 tên miền, nhiều tên miền, sai định dạng bỏ qua kèm cảnh báo không in giá trị lạ và không dừng khởi động)', async () => {
  const prevEnv = { ...process.env };
  const origWarn = console.warn;

  const fetchCspHeader = async (): Promise<string> => {
    const app = createApp();
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      return res.headers.get('content-security-policy') || '';
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };

  try {
    // 0. Kiểm tra .env.example đặt CSP_EXTRA_IMG_HOSTS ở dạng dòng chú thích (# CSP_EXTRA_IMG_HOSTS=...)
    const envExampleContent = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf8');
    const envExampleLines = envExampleContent.split(/\r?\n/);
    assert.equal(
      envExampleLines.some((line) => /^\s*CSP_EXTRA_IMG_HOSTS\s*=/.test(line)),
      false,
      'Trong .env.example không được để dòng CSP_EXTRA_IMG_HOSTS=... không chú thích (để AI Studio không bắt nhập)'
    );
    assert.equal(
      envExampleLines.some((line) => /^\s*#\s*CSP_EXTRA_IMG_HOSTS\s*=/.test(line)),
      true,
      'Trong .env.example phải có dòng chú thích # CSP_EXTRA_IMG_HOSTS=...'
    );

    restoreRuntimeModeEnv(
      { NODE_ENV: 'production', PRODUCTION_STRICT: 'true', RENDER: 'false', APP_MODE: undefined },
      process.env
    );
    process.env.COOKIE_CROSS_SITE = 'false';
    process.env.SEED_DEV_ACCOUNTS = 'false';
    process.env.ENABLE_DEMO_PAYMENT_WEBHOOK = 'false';
    process.env.SUPABASE_URL = 'https://ocuizojmlykchhcvveqi.supabase.co';

    // 1. Trường hợp để trống ("") hoặc không đặt (undefined) ở strict: hợp lệ, không dừng khởi động, không cảnh báo
    const warnLogsEmpty: string[] = [];
    console.warn = (...args: any[]) => warnLogsEmpty.push(args.join(' '));

    delete process.env.CSP_EXTRA_IMG_HOSTS;
    assert.deepEqual(resolveExtraImgHosts(process.env), []);
    const unsetValidation = validateProductionStartupEnv({
      ...VALID_STRICT_PROD_ENV,
      CSP_EXTRA_IMG_HOSTS: undefined,
    });
    assert.equal(unsetValidation.ok, true, 'Không đặt CSP_EXTRA_IMG_HOSTS ở strict phải hợp lệ');

    process.env.CSP_EXTRA_IMG_HOSTS = '';
    assert.deepEqual(resolveExtraImgHosts(process.env), []);
    const emptyValidation = validateProductionStartupEnv({
      ...VALID_STRICT_PROD_ENV,
      CSP_EXTRA_IMG_HOSTS: '',
    });
    assert.equal(emptyValidation.ok, true, 'Để trống CSP_EXTRA_IMG_HOSTS="" ở strict phải hợp lệ');
    assert.equal(warnLogsEmpty.length, 0, 'Để trống hoặc không đặt CSP_EXTRA_IMG_HOSTS không được in cảnh báo');

    const strictCsp = await fetchCspHeader();
    assert.ok(strictCsp.includes("script-src 'self';"), `Strict CSP script-src phải chỉ có 'self', nhận được: ${strictCsp}`);
    assert.equal(strictCsp.includes("'unsafe-eval'"), false, 'Strict CSP không được có unsafe-eval');
    assert.equal(
      strictCsp.includes("script-src 'self' 'unsafe-inline'"),
      false,
      'Strict CSP script-src không được có unsafe-inline'
    );
    assert.ok(
      strictCsp.includes("connect-src 'self' https://ocuizojmlykchhcvveqi.supabase.co https://api.vietqr.io;"),
      `Strict CSP connect-src phải chỉ gồm self, SUPABASE_URL và api.vietqr.io, nhận được: ${strictCsp}`
    );
    assert.equal(strictCsp.includes('ws:'), false, 'Strict CSP connect-src không được có ws:');
    assert.equal(strictCsp.includes('wss:'), false, 'Strict CSP connect-src không được có wss:');
    assert.ok(
      strictCsp.includes(
        "img-src 'self' data: blob: https://ocuizojmlykchhcvveqi.supabase.co https://img.vietqr.io https://api.vietqr.io;"
      ),
      `Strict CSP img-src mặc định không được có Unsplash/Picsum, nhận được: ${strictCsp}`
    );
    assert.equal(strictCsp.includes('images.unsplash.com'), false);
    assert.equal(strictCsp.includes('picsum.photos'), false);
    assert.equal(strictCsp.includes('example.supabase.co'), false);

    // 2. Trường hợp MỘT tên miền (không có https://): CSP_EXTRA_IMG_HOSTS="images.unsplash.com"
    const warnLogsSingle: string[] = [];
    console.warn = (...args: any[]) => warnLogsSingle.push(args.join(' '));
    process.env.CSP_EXTRA_IMG_HOSTS = 'images.unsplash.com';
    assert.deepEqual(resolveExtraImgHosts(process.env), ['https://images.unsplash.com']);
    const singleCsp = await fetchCspHeader();
    assert.ok(
      singleCsp.includes('https://images.unsplash.com'),
      'Khi đặt CSP_EXTRA_IMG_HOSTS="images.unsplash.com" ở strict thì img-src phải chứa https://images.unsplash.com'
    );
    assert.equal(singleCsp.includes('https://picsum.photos'), false);
    assert.equal(warnLogsSingle.length, 0, 'Tên miền hợp lệ không được in cảnh báo');

    // 3. Trường hợp NHIỀU tên miền ngăn cách bằng dấu phẩy: CSP_EXTRA_IMG_HOSTS="images.unsplash.com,picsum.photos"
    const warnLogsMulti: string[] = [];
    console.warn = (...args: any[]) => warnLogsMulti.push(args.join(' '));
    process.env.CSP_EXTRA_IMG_HOSTS = 'images.unsplash.com,picsum.photos';
    assert.deepEqual(resolveExtraImgHosts(process.env), [
      'https://images.unsplash.com',
      'https://picsum.photos',
    ]);
    const multiCsp = await fetchCspHeader();
    assert.ok(
      multiCsp.includes('https://images.unsplash.com') && multiCsp.includes('https://picsum.photos'),
      'Khi đặt CSP_EXTRA_IMG_HOSTS="images.unsplash.com,picsum.photos" ở strict thì img-src phải chứa cả hai tên miền'
    );
    assert.equal(warnLogsMulti.length, 0, 'Danh sách nhiều tên miền hợp lệ không được in cảnh báo');

    // 4. Trường hợp GIÁ TRỊ SAI ĐỊNH DẠNG (*, *.domain.com, data:, https:, https://..., có path, hoặc chuỗi lạ):
    // Bỏ qua mục sai định dạng kèm cảnh báo, KHÔNG in giá trị lạ ra log, KHÔNG làm dừng khởi động ở strict
    const warnLogsWildcardAndSchemes: string[] = [];
    console.warn = (...args: any[]) => warnLogsWildcardAndSchemes.push(args.join(' '));
    process.env.CSP_EXTRA_IMG_HOSTS = '*,*.domain.com,data:,https:';
    assert.deepEqual(
      resolveExtraImgHosts(process.env),
      [],
      'Các giá trị *, *.domain.com, data:, https: trong CSP_EXTRA_IMG_HOSTS phải bị bỏ qua hoàn toàn'
    );
    const wildcardSchemeCsp = await fetchCspHeader();
    assert.equal(wildcardSchemeCsp.includes('*.domain.com'), false, 'Không được cho phép *.domain.com vào img-src');
    assert.equal(wildcardSchemeCsp.includes('img-src *'), false, 'Không được cho phép * vào img-src');
    assert.equal(wildcardSchemeCsp.includes(' https: '), false, 'Không được cho phép scheme https: trần vào img-src');
    assert.equal(wildcardSchemeCsp.includes(' https:;'), false, 'Không được cho phép scheme https: trần vào img-src');
    assert.ok(warnLogsWildcardAndSchemes.length >= 4, 'Phải ghi cảnh báo khi bỏ qua *, *.domain.com, data:, https:');
    assert.equal(
      warnLogsWildcardAndSchemes.join('\n').includes('*.domain.com'),
      false,
      'Cảnh báo không được in giá trị *.domain.com ra log'
    );

    const warnLogsInvalid: string[] = [];
    console.warn = (...args: any[]) => warnLogsInvalid.push(args.join(' '));
    const strangeInvalidValue1 = 'https://images.unsplash.com';
    const strangeInvalidValue2 = 'strange-canary-invalid-host-789/bad-path';
    process.env.CSP_EXTRA_IMG_HOSTS = `${strangeInvalidValue1},${strangeInvalidValue2},fastly.picsum.photos`;

    const invalidStartupCheck = validateProductionStartupEnv({
      ...VALID_STRICT_PROD_ENV,
      CSP_EXTRA_IMG_HOSTS: process.env.CSP_EXTRA_IMG_HOSTS,
    });
    assert.equal(
      invalidStartupCheck.ok,
      true,
      'CSP_EXTRA_IMG_HOSTS sai định dạng tuyệt đối không được làm dừng khởi động ở strict'
    );

    const invalidCsp = await fetchCspHeader();
    assert.equal(
      invalidCsp.includes('https://images.unsplash.com'),
      false,
      'Giá trị có https:// phải bị coi là sai định dạng và bị bỏ qua khỏi img-src'
    );
    assert.equal(
      invalidCsp.includes('strange-canary-invalid-host-789'),
      false,
      'Giá trị sai định dạng phải bị bỏ qua khỏi img-src'
    );
    assert.ok(
      invalidCsp.includes('https://fastly.picsum.photos'),
      'Tên miền đúng định dạng nằm cùng danh sách vẫn được giữ lại'
    );
    assert.ok(warnLogsInvalid.length > 0, 'Giá trị sai định dạng phải ghi cảnh báo console.warn');
    const combinedWarnOutput = warnLogsInvalid.join('\n');
    assert.ok(
      combinedWarnOutput.includes('[CSP WARNING]'),
      'Cảnh báo phải có tiền tố [CSP WARNING]'
    );
    assert.equal(
      combinedWarnOutput.includes(strangeInvalidValue2),
      false,
      'Cảnh báo tuyệt đối KHÔNG được in giá trị lạ sai định dạng ra log'
    );
    assert.equal(
      combinedWarnOutput.includes('strange-canary-invalid-host-789'),
      false,
      'Cảnh báo tuyệt đối KHÔNG được in bất kỳ phần nào của giá trị lạ ra log'
    );

    // 5. Preview Mode CSP
    console.warn = origWarn;
    restoreRuntimeModeEnv(
      { NODE_ENV: 'production', APP_MODE: 'preview', RENDER: 'false', PRODUCTION_STRICT: 'false' },
      process.env
    );
    process.env.CSP_EXTRA_IMG_HOSTS = '';
    const previewCsp = await fetchCspHeader();

    assert.ok(previewCsp.includes("'unsafe-inline'"), 'Preview CSP cho phép unsafe-inline cho Vite HMR');
    assert.ok(previewCsp.includes('ws: wss:'), 'Preview CSP cho phép ws: wss:');
    assert.ok(previewCsp.includes('https://images.unsplash.com'), 'Preview CSP cho phép Unsplash');
  } finally {
    console.warn = origWarn;
    restoreRuntimeModeEnv(prevEnv, process.env);
    process.env.COOKIE_CROSS_SITE = prevEnv.COOKIE_CROSS_SITE || 'false';
    process.env.SUPABASE_URL = prevEnv.SUPABASE_URL;
    process.env.CSP_EXTRA_IMG_HOSTS = prevEnv.CSP_EXTRA_IMG_HOSTS || '';
  }
});

// ============================================================================
// MỤC 8: QUẢN TRỊ "ẢNH SẢN PHẨM NHANH" (QUICK PRODUCT IMAGES)
// - 401/403 bảo vệ quyền admin
// - Từ chối URL ngoài, sai định dạng, vượt quá 5MB
// - Tước bỏ EXIF metadata khi tải ảnh sản phẩm qua /api/upload
// - 409 khi expectedUpdatedAt lệch (Optimistic Locking)
// - Trong cùng giao dịch: giữ ảnh cũ (is_primary=false), thêm ảnh mới (is_primary=true),
//   ghi admin_audit_logs với action='update_product_primary_image' và không chứa PII
// ============================================================================
test('Stage 9.8 (Quick Product Images Admin API — Item 4): Kiểm tra 401/403, từ chối URL ngoài/sai định dạng/>5MB, tước bỏ EXIF, 409 khi expectedUpdatedAt lệch, bảo toàn ảnh cũ (is_primary=false), thêm ảnh mới (is_primary=true) và ghi admin_audit_logs trong cùng giao dịch', async () => {
  const sharpMod = (await import('sharp')).default;
  const { getObjectFromLocalStorageForTest, SUPABASE_PUBLIC_BUCKET } = await import(
    '../server/services/upload.ts'
  );
  const bcryptMod = (await import('bcryptjs')).default;

  await getDb();
  await initDatabase();
  await seedDatabase();

  const adminEmail = 'quick_img_admin@baity.vn';
  const customerEmail = 'quick_img_customer@baity.vn';
  const testPassword = 'QuickImgTest@2026!Secure';
  const passwordHash = bcryptMod.hashSync(testPassword, 10);

  await queryRows(sql`
    INSERT INTO users (full_name, email, phone, password_hash, role)
    VALUES
      ('Quick Image Admin', ${adminEmail}, '0909111222', ${passwordHash}, 'admin'),
      ('Quick Image Customer', ${customerEmail}, '0909333444', ${passwordHash}, 'customer')
    ON CONFLICT (email) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      role = EXCLUDED.role;
  `);

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const extractSessionCookies = (res: Response, prev = ''): string => {
    const raw = (res.headers as any).getSetCookie
      ? (res.headers as any).getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
    const map = new Map<string, string>();
    if (prev) {
      for (const p of prev.split(';')) {
        const [k, v] = p.trim().split('=');
        if (k && v) map.set(k, v);
      }
    }
    for (const c of raw) {
      const main = String(c).split(';')[0];
      const [k, v] = main.trim().split('=');
      if (k && v) map.set(k, v);
    }
    return Array.from(map.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  };

  const getCsrf = (cookies: string): string => {
    const m = cookies.match(/baity_csrf_token=([^;]+)/);
    return m ? m[1] : '';
  };

  const login = async (email: string): Promise<string> => {
    const initRes = await fetch(`${baseUrl}/api/auth/me`);
    let cookies = extractSessionCookies(initRes);
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookies,
        'X-CSRF-Token': getCsrf(cookies),
      },
      body: JSON.stringify({ email, password: testPassword }),
    });
    assert.equal(loginRes.status, 200, `Login cho ${email} phải trả 200`);
    cookies = extractSessionCookies(loginRes, cookies);
    return cookies;
  };

  try {
    // 1. Lấy 1 sản phẩm mẫu để kiểm thử (và lưu lại trạng thái ban đầu để khôi phục sau test)
    const targetProductRows = await queryRows<{
      id: string;
      slug: string;
      updated_at: string;
    }>(sql`
      SELECT id, slug, updated_at
      FROM products
      WHERE is_active = true
      ORDER BY created_at ASC, id ASC
      LIMIT 1;
    `);
    assert.equal(targetProductRows.length, 1);
    const targetProduct = targetProductRows[0];

    const originalImages = await queryRows<{
      id: string;
      image_url: string;
      is_primary: boolean;
      display_order: number;
    }>(sql`
      SELECT id, image_url, is_primary, display_order
      FROM product_images
      WHERE product_id = ${targetProduct.id}::uuid
      ORDER BY display_order ASC;
    `);
    const originalPrimary = originalImages.find((img) => img.is_primary);
    assert.ok(originalPrimary, 'Sản phẩm mẫu phải có ảnh chính ban đầu');

    try {
      // 2. Kiểm tra 401 (chưa đăng nhập) và 403 (tài khoản customer)
      const unauthGet = await fetch(`${baseUrl}/api/admin/products/quick-images`);
      assert.equal(unauthGet.status, 401, 'GET /api/admin/products/quick-images khi chưa đăng nhập phải trả 401');

      const customerCookies = await login(customerEmail);
      const forbiddenGet = await fetch(`${baseUrl}/api/admin/products/quick-images`, {
        headers: { Cookie: customerCookies },
      });
      assert.equal(forbiddenGet.status, 403, 'GET /api/admin/products/quick-images với role customer phải trả 403');

      const forbiddenPut = await fetch(
        `${baseUrl}/api/admin/products/${targetProduct.id}/primary-image`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Cookie: customerCookies,
            'X-CSRF-Token': getCsrf(customerCookies),
          },
          body: JSON.stringify({
            image_url: '/api/upload/public/products/fake/test.jpg',
            expectedUpdatedAt: targetProduct.updated_at,
          }),
        }
      );
      assert.equal(
        forbiddenPut.status,
        403,
        'PUT /api/admin/products/:id/primary-image với role customer phải trả 403'
      );

      // 3. Đăng nhập Admin và kiểm tra danh sách quick-images (đồng thời xác minh thứ tự khai báo route:
      // GET /products/quick-images được khai báo TRƯỚC GET /products/:id nên không bị coi 'quick-images' là UUID :id)
      const adminCookies = await login(adminEmail);
      const listRes = await fetch(`${baseUrl}/api/admin/products/quick-images?status=ALL`, {
        headers: { Cookie: adminCookies },
      });
      assert.equal(
        listRes.status,
        200,
        'Admin gọi GET /api/admin/products/quick-images phải trả 200 (chứng minh khai báo trước GET /products/:id)'
      );
      const listData = (await listRes.json()) as any;
      assert.ok(
        Array.isArray(listData.products) && listData.products.length >= 29,
        `Danh sách quick-images phải có tối thiểu 29 sản phẩm đang hoạt động (nhận được: ${listData.products?.length})`
      );
      assert.ok(listData.counts && typeof listData.counts.total === 'number');
      assert.equal(
        typeof listData.statusCounts?.CHƯA_CÓ_ẢNH_THẬT,
        'number',
        'statusCounts phải có trường CHƯA_CÓ_ẢNH_THẬT'
      );
      assert.equal(
        typeof listData.remainingPlaceholderCount,
        'number',
        'Phản hồi phải có remainingPlaceholderCount đếm số sản phẩm dùng ảnh giữ chỗ'
      );

      // 4. Từ chối URL ngoài (không phải ảnh đã tải lên qua /api/upload)
      const externalUrlRes = await fetch(
        `${baseUrl}/api/admin/products/${targetProduct.id}/primary-image`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Cookie: adminCookies,
            'X-CSRF-Token': getCsrf(adminCookies),
          },
          body: JSON.stringify({
            image_url: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800',
            expectedUpdatedAt: targetProduct.updated_at,
          }),
        }
      );
      assert.equal(externalUrlRes.status, 400, 'URL ngoài phải bị từ chối với HTTP 400');
      const externalUrlBody = (await externalUrlRes.json()) as any;
      assert.equal(externalUrlBody.code, 'INVALID_PRODUCT_IMAGE_SOURCE');

      // 5. Từ chối file sai định dạng (text/svg giả mạo) và file vượt quá 5MB trên /api/upload
      const fakeDataUrl = `data:image/jpeg;base64,${Buffer.from('not-an-image-content-svg-script').toString('base64')}`;
      const invalidFormatRes = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookies,
          'X-CSRF-Token': getCsrf(adminCookies),
        },
        body: JSON.stringify({
          image: fakeDataUrl,
          purpose: 'product',
        }),
      });
      assert.equal(invalidFormatRes.status, 400, 'File sai magic bytes phải bị từ chối 400');

      const oversizedBuffer = Buffer.alloc(5 * 1024 * 1024 + 2048, 0xff);
      const oversizedDataUrl = `data:image/jpeg;base64,${oversizedBuffer.toString('base64')}`;
      const oversizedRes = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookies,
          'X-CSRF-Token': getCsrf(adminCookies),
        },
        body: JSON.stringify({
          image: oversizedDataUrl,
          purpose: 'product',
        }),
      });
      assert.ok(
        oversizedRes.status === 400 || oversizedRes.status === 413,
        `File > 5MB phải bị từ chối 400 hoặc 413 (nhận được ${oversizedRes.status})`
      );

      // 6. Tải lên ảnh JPEG hợp lệ có gắn EXIF metadata -> xác nhận EXIF bị tước bỏ hoàn toàn
      const jpegWithExif = await sharpMod({
        create: {
          width: 64,
          height: 64,
          channels: 3,
          background: { r: 240, g: 240, b: 240 },
        },
      })
        .withExif({
          IFD0: {
            Make: 'SecretCameraMakerCanary',
            Model: 'SecretCameraModelCanary',
            Software: 'ExifCanarySoftware',
          },
        })
        .jpeg({ quality: 90 })
        .toBuffer();

      const beforeMeta = await sharpMod(jpegWithExif).metadata();
      assert.ok(beforeMeta.exif, 'Ảnh đầu vào trước khi upload phải có dữ liệu EXIF');

      const validDataUrl = `data:image/jpeg;base64,${jpegWithExif.toString('base64')}`;
      const uploadRes = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookies,
          'X-CSRF-Token': getCsrf(adminCookies),
        },
        body: JSON.stringify({
          image: validDataUrl,
          purpose: 'product',
        }),
      });
      assert.equal(uploadRes.status, 200, 'Upload ảnh JPEG hợp lệ phải trả 200');
      const uploadData = (await uploadRes.json()) as {
        url: string;
        path: string;
        bucket: string;
      };
      assert.ok(
        /^products\/[0-9a-f]{16}\/[0-9a-f-]+\.jpg$/.test(uploadData.path),
        `Đường dẫn lưu trữ phải khớp định dạng products/<16-hex>/<uuid>.jpg (nhận được: ${uploadData.path})`
      );

      const storedObj = getObjectFromLocalStorageForTest(SUPABASE_PUBLIC_BUCKET, uploadData.path);
      assert.ok(storedObj, 'Ảnh sau khi upload phải tồn tại trong Storage');
      const afterMeta = await sharpMod(storedObj.buffer).metadata();
      assert.equal(afterMeta.exif, undefined, 'Ảnh lưu trong Storage phải bị tước bỏ hoàn toàn EXIF');
      assert.equal(
        storedObj.buffer.includes(Buffer.from('SecretCameraMakerCanary')),
        false,
        'Chuỗi EXIF Make không được còn tồn tại trong buffer ảnh sau khi tái mã hóa'
      );

      // 6b. Kiểm tra GET /api/upload/public/* (Item 4):
      // - Chỉ cho phép tiền tố products/ trong bucket công khai
      // - Chặn .. và các tiền tố khác (reviews/, avatars/)
      // - Content-Type lấy theo đuôi tệp đã tái mã hóa (image/jpeg, image/png, image/webp), không lấy từ metadata người tải lên
      // - Luôn có header X-Content-Type-Options: nosniff
      const originalMimeType = storedObj.mimeType;
      try {
        storedObj.mimeType = 'text/html; charset=utf-8';
        const publicImgRes = await fetch(`${baseUrl}/api/upload/public/${uploadData.path}`);
        assert.equal(publicImgRes.status, 200, 'GET /api/upload/public/products/... hợp lệ phải trả 200');
        assert.equal(
          publicImgRes.headers.get('content-type'),
          'image/jpeg',
          'Content-Type phải được suy ra từ đuôi tệp đã tái mã hóa (.jpg -> image/jpeg), bỏ qua mimeType metadata bị giả mạo'
        );
        assert.equal(
          publicImgRes.headers.get('x-content-type-options'),
          'nosniff',
          'GET /api/upload/public/* bắt buộc có X-Content-Type-Options: nosniff'
        );
      } finally {
        storedObj.mimeType = originalMimeType;
      }

      const disallowedPaths = [
        'reviews/0123456789abcdef/test.jpg',
        'avatars/0123456789abcdef/test.jpg',
        'returns/0123456789abcdef/test.jpg',
        'products/0123456789abcdef/../../etc/passwd',
        'products/0123456789abcdef/script.svg',
      ];
      for (const badPath of disallowedPaths) {
        const badRes = await fetch(`${baseUrl}/api/upload/public/${badPath}`);
        assert.equal(
          badRes.status,
          400,
          `Đường dẫn không hợp lệ "${badPath}" trên GET /api/upload/public/* phải bị chặn với HTTP 400`
        );
      }

      // 7. Kiểm tra 409 khi expectedUpdatedAt bị lệch (Optimistic Locking)
      const staleUpdatedAt = '2020-01-01T00:00:00.000Z';
      const conflictRes = await fetch(
        `${baseUrl}/api/admin/products/${targetProduct.id}/primary-image`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Cookie: adminCookies,
            'X-CSRF-Token': getCsrf(adminCookies),
          },
          body: JSON.stringify({
            imageUrl: uploadData.path,
            objectPath: uploadData.path,
            expectedUpdatedAt: staleUpdatedAt,
          }),
        }
      );
      assert.equal(conflictRes.status, 409, 'expectedUpdatedAt cũ phải bị từ chối với HTTP 409');
      const conflictBody = (await conflictRes.json()) as any;
      assert.equal(conflictBody.code, 'PRODUCT_CONFLICT');

      // 8. Cập nhật ảnh chính thành công trong cùng giao dịch
      const updateRes = await fetch(
        `${baseUrl}/api/admin/products/${targetProduct.id}/primary-image`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Cookie: adminCookies,
            'X-CSRF-Token': getCsrf(adminCookies),
          },
          body: JSON.stringify({
            imageUrl: uploadData.path,
            objectPath: uploadData.path,
            expectedUpdatedAt: targetProduct.updated_at,
          }),
        }
      );
      assert.equal(updateRes.status, 200, 'Cập nhật ảnh chính với expectedUpdatedAt khớp phải trả 200');
      const updateBody = (await updateRes.json()) as any;
      assert.equal(updateBody.success, true);
      assert.equal(updateBody.primaryImageUrl, uploadData.path);

      // Kiểm tra trong product_images: ảnh cũ vẫn còn nhưng is_primary = false, ảnh mới có is_primary = true
      const imagesAfter = await queryRows<{
        id: string;
        image_url: string;
        is_primary: boolean;
        display_order: number;
      }>(sql`
        SELECT id, image_url, is_primary, display_order
        FROM product_images
        WHERE product_id = ${targetProduct.id}::uuid
        ORDER BY is_primary DESC, display_order ASC;
      `);

      const newPrimaryRows = imagesAfter.filter((img) => img.is_primary);
      assert.equal(newPrimaryRows.length, 1, 'Chỉ được có đúng 1 ảnh chính (is_primary = true)');
      assert.equal(newPrimaryRows[0].image_url, uploadData.path, 'Ảnh chính mới phải khớp đường dẫn vừa tải lên');

      const preservedOldPrimary = imagesAfter.find((img) => img.id === originalPrimary.id);
      assert.ok(preservedOldPrimary, 'Bản ghi ảnh chính cũ phải được giữ lại trong product_images');
      assert.equal(
        preservedOldPrimary.is_primary,
        false,
        'Ảnh chính cũ phải được chuyển thành is_primary = false'
      );

      // Kiểm tra admin_audit_logs được ghi trong cùng giao dịch, có đường dẫn ảnh cũ và mới, không chứa PII
      const auditRows = await queryRows<{
        action: string;
        target_type: string;
        target_id: string;
        summary: string;
      }>(sql`
        SELECT action, target_type, target_id, summary
        FROM admin_audit_logs
        WHERE action = 'update_product_primary_image'
          AND target_id = ${targetProduct.id}
        ORDER BY created_at DESC
        LIMIT 1;
      `);
      assert.equal(auditRows.length, 1, 'Phải có bản ghi admin_audit_logs cho update_product_primary_image');
      assert.ok(
        auditRows[0].summary.includes(originalPrimary.image_url),
        'admin_audit_logs.summary phải ghi đường dẫn ảnh cũ'
      );
      assert.ok(
        auditRows[0].summary.includes(uploadData.path),
        'admin_audit_logs.summary phải ghi đường dẫn ảnh mới'
      );
      assert.equal(
        auditRows[0].summary.includes(adminEmail),
        false,
        'admin_audit_logs không được chứa email cá nhân (PII)'
      );
    } finally {
      // Khôi phục dữ liệu product_images và updated_at ban đầu để không ảnh hưởng tới các test khác
      await queryRows(sql`
        DELETE FROM product_images WHERE product_id = ${targetProduct.id}::uuid;
      `);
      for (const img of originalImages) {
        await queryRows(sql`
          INSERT INTO product_images (id, product_id, image_url, is_primary, display_order)
          VALUES (
            ${img.id}::uuid,
            ${targetProduct.id}::uuid,
            ${img.image_url},
            ${img.is_primary},
            ${img.display_order}
          );
        `);
      }
      await queryRows(sql`
        UPDATE products
        SET updated_at = ${targetProduct.updated_at}::timestamptz
        WHERE id = ${targetProduct.id}::uuid;
      `);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// ============================================================================
// MỤC 9: NHÓM LOẠI LÂN CẬN TRONG TÌM KIẾM HÌNH ẢNH (/api/visual-search)
// - Nhóm (quan-jean-denim, quan-tay-kaki, quan-short), (ao-thun, ao-so-mi), (ao-len-hoodie, ao-khoac-blazer)
// - Cùng nhóm được điểm loại thấp hơn đúng loại (18 < 40) và luôn xếp sau đúng loại
// - Khác nhóm không được điểm loại (cat_score = 0)
// - Giữ nguyên quy tắc unisex
// ============================================================================
test('Stage 9.9 (Visual Search Neighboring Category Groups — Item 5): Khi nhận diện quan-jean-denim thì quan-tay-kaki vẫn được đưa vào nhưng xếp sau quan-jean-denim; khác nhóm không được điểm loại; giữ quy tắc unisex', async () => {
  const {
    rankProductsByVisualAttributesInSql,
    getNeighboringCategorySlugs,
    VISUAL_SEARCH_NEIGHBOR_GROUPS,
  } = await import('../server/services/visualSearch.ts');

  await getDb();
  await initDatabase();
  await seedDatabase();

  // 1. Kiểm tra định nghĩa hàm getNeighboringCategorySlugs cho tất cả các nhóm
  assert.deepEqual(
    getNeighboringCategorySlugs('quan-jean-denim').sort(),
    ['quan-short', 'quan-tay-kaki'].sort(),
    'quan-jean-denim phải có nhóm lân cận là quan-tay-kaki và quan-short'
  );
  assert.deepEqual(
    getNeighboringCategorySlugs('ao-thun'),
    ['ao-so-mi'],
    'ao-thun phải có nhóm lân cận là ao-so-mi'
  );
  assert.deepEqual(
    getNeighboringCategorySlugs('ao-len-hoodie'),
    ['ao-khoac-blazer'],
    'ao-len-hoodie phải có nhóm lân cận là ao-khoac-blazer'
  );
  assert.deepEqual(
    getNeighboringCategorySlugs('vay-dam'),
    [],
    'vay-dam đứng riêng, không có danh mục lân cận'
  );
  assert.deepEqual(
    getNeighboringCategorySlugs('phu-kien-thoi-trang'),
    [],
    'phu-kien-thoi-trang đứng riêng, không có danh mục lân cận'
  );
  assert.equal(VISUAL_SEARCH_NEIGHBOR_GROUPS.length, 5);

  // 2. Truy vấn SQL ranking khi nhận diện là 'quan-jean-denim', đối tượng 'men', màu chủ đạo 'Đen', màu phụ 'Be'
  // (để cả sản phẩm cùng nhóm quan-tay-kaki, quan-short và sản phẩm khác nhóm màu Đen/Be đều có mặt trong kết quả,
  // qua đó chứng minh: đúng loại catScore=40 xếp đầu, cùng nhóm lân cận catScore=18 xếp tiếp theo, khác nhóm catScore=0 xếp cuối)
  const rankedResult = await rankProductsByVisualAttributesInSql({
    isApparel: true,
    categorySlug: 'quan-jean-denim',
    categoryName: 'Quần Jean & Denim',
    productType: 'Quần jean',
    primaryColor: 'Đen',
    secondaryColor: 'Be',
    style: null,
    pattern: null,
    fit: null,
    targetGender: 'men',
    confidence: 0.92,
  });

  const rankedRows = rankedResult.products;
  assert.ok(rankedRows.length > 0, 'Truy vấn xếp hạng visual search phải trả về sản phẩm');

  const jeanIndices: number[] = [];
  const kakiIndices: number[] = [];
  const shortIndices: number[] = [];
  const outOfGroupCategoriesWithCatScore: string[] = [];

  rankedRows.forEach((row, idx) => {
    if (row.categorySlug === 'quan-jean-denim') {
      jeanIndices.push(idx);
      assert.equal(
        row.categoryScore,
        40,
        `Sản phẩm đúng loại quan-jean-denim (${row.slug}) phải có categoryScore = 40`
      );
    } else if (row.categorySlug === 'quan-tay-kaki') {
      kakiIndices.push(idx);
      assert.equal(
        row.categoryScore,
        18,
        `Sản phẩm cùng nhóm lân cận quan-tay-kaki (${row.slug}) phải có categoryScore = 18 (< 40)`
      );
    } else if (row.categorySlug === 'quan-short') {
      shortIndices.push(idx);
      assert.equal(
        row.categoryScore,
        18,
        `Sản phẩm cùng nhóm lân cận quan-short (${row.slug}) phải có categoryScore = 18 (< 40)`
      );
    } else {
      if (row.categoryScore !== 0) {
        outOfGroupCategoriesWithCatScore.push(`${row.slug}:${row.categorySlug}:${row.categoryScore}`);
      }
      assert.equal(
        row.matchedFields.includes('category'),
        false,
        `Sản phẩm khác nhóm (${row.slug} - ${row.categorySlug}) không được có 'category' trong matchedFields`
      );
    }
  });

  assert.ok(jeanIndices.length > 0, 'Kết quả phải có sản phẩm thuộc danh mục quan-jean-denim');
  assert.ok(
    kakiIndices.length > 0,
    'Khi nhận diện là quan-jean-denim thì các sản phẩm quan-tay-kaki vẫn phải được đưa vào kết quả'
  );
  assert.equal(
    outOfGroupCategoriesWithCatScore.length,
    0,
    `Các sản phẩm khác nhóm tuyệt đối không được cộng điểm loại (categoryScore phải bằng 0), vi phạm: ${outOfGroupCategoriesWithCatScore.join(', ')}`
  );

  const lastJeanIndex = Math.max(...jeanIndices);
  const firstKakiIndex = Math.min(...kakiIndices);
  assert.ok(
    lastJeanIndex < firstKakiIndex,
    `Mọi sản phẩm quan-jean-denim (vị trí cuối: ${lastJeanIndex}) phải xếp trước quan-tay-kaki (vị trí đầu: ${firstKakiIndex})`
  );

  if (shortIndices.length > 0) {
    const firstShortIndex = Math.min(...shortIndices);
    assert.ok(
      lastJeanIndex < firstShortIndex,
      `Mọi sản phẩm quan-jean-denim (vị trí cuối: ${lastJeanIndex}) phải xếp trước quan-short (vị trí đầu: ${firstShortIndex})`
    );
  }

  // 3. Kiểm tra quy tắc unisex vẫn được giữ nguyên (truy vấn targetGender = 'women' trên nhóm ao-len-hoodie vẫn khớp sản phẩm unisex)
  const hoodieWomenResult = await rankProductsByVisualAttributesInSql({
    isApparel: true,
    categorySlug: 'ao-len-hoodie',
    categoryName: 'Áo Len & Hoodie',
    productType: 'Áo hoodie',
    primaryColor: 'Xám',
    secondaryColor: 'Đen',
    style: null,
    pattern: null,
    fit: null,
    targetGender: 'women',
    confidence: 0.95,
  });

  const unisexMatches = hoodieWomenResult.products.filter((r) => r.targetGender === 'unisex');
  assert.ok(
    unisexMatches.length > 0,
    'Khi tìm kiếm với targetGender=women, các sản phẩm unisex vẫn phải được đưa vào kết quả'
  );
  for (const uRow of unisexMatches) {
    assert.ok(
      uRow.matchReason.includes('Unisex'),
      `Sản phẩm unisex (${uRow.slug}) phải giữ quy tắc khớp cho cả Nam & Nữ`
    );
  }
});

// ============================================================================
// MỤC 10: KIỂM THỬ BỘ 29 SẢN PHẨM DEMO TRONG SEED.TS, FILE PUBLIC/SEED-IMAGES & ENABLE_SEED_DEMO_DATA=TRUE
// ============================================================================
test('Stage 9.10 (Canonical 29-Product Demo Seed & ENABLE_SEED_DEMO_DATA=true on Empty DB — Item 7): seed.ts có đúng 29 sản phẩm, đủ 9 danh mục (>= 3 mỗi danh mục), có áo khoác và quần short, không trùng ảnh chính khác loại, mọi ảnh trỏ tới public/seed-images và file tồn tại; ENABLE_SEED_DEMO_DATA=true trên CSDL trống tạo 29 sản phẩm và 0 tài khoản mẫu', async () => {
  const { isPlaceholderSeedImageUrl } = await import(
    '../server/services/productImageAuditStatus.ts'
  );
  const { slugifyVietnamese } = await import('../server/routes/admin.ts');

  // 1. Kiểm tra mảng SEED_PRODUCTS_RAW trong server/db/seed.ts có đúng 29 sản phẩm
  assert.equal(
    SEED_PRODUCTS_RAW.length,
    29,
    `SEED_PRODUCTS_RAW trong server/db/seed.ts phải có đúng 29 sản phẩm (hiện có: ${SEED_PRODUCTS_RAW.length})`
  );

  // 2. Đủ 9 danh mục gốc, mỗi danh mục có >= 3 sản phẩm
  const expectedCategories = [
    'ao-thun',
    'ao-so-mi',
    'ao-khoac-blazer',
    'quan-jean-denim',
    'quan-tay-kaki',
    'quan-short',
    'vay-dam',
    'ao-len-hoodie',
    'phu-kien-thoi-trang',
  ];
  const categoryCountMap = new Map<string, number>();
  for (const p of SEED_PRODUCTS_RAW) {
    categoryCountMap.set(p.cat, (categoryCountMap.get(p.cat) || 0) + 1);
  }
  assert.equal(
    categoryCountMap.size,
    9,
    `SEED_PRODUCTS_RAW phải bao phủ đủ 9 danh mục gốc (hiện có: ${categoryCountMap.size})`
  );
  for (const catSlug of expectedCategories) {
    const cnt = categoryCountMap.get(catSlug) || 0;
    assert.ok(
      cnt >= 3,
      `Danh mục "${catSlug}" trong SEED_PRODUCTS_RAW phải có tối thiểu 3 sản phẩm (hiện có: ${cnt})`
    );
  }

  // 3. Có sản phẩm áo khoác (trong ao-khoac-blazer) và quần short (trong quan-short)
  const hasJacketProduct = SEED_PRODUCTS_RAW.some(
    (p) =>
      p.cat === 'ao-khoac-blazer' &&
      p.name.toLowerCase().includes('áo khoác')
  );
  const hasShortProduct = SEED_PRODUCTS_RAW.some(
    (p) =>
      p.cat === 'quan-short' &&
      p.name.toLowerCase().includes('quần short')
  );
  assert.equal(hasJacketProduct, true, 'Bộ sản phẩm demo phải có sản phẩm áo khoác');
  assert.equal(hasShortProduct, true, 'Bộ sản phẩm demo phải có sản phẩm quần short');

  // 4. Không có hai sản phẩm KHÁC loại dùng chung ảnh chính, và mọi ảnh đều trỏ tới /seed-images/... tồn tại trên đĩa
  const primaryImageCategories = new Map<string, Set<string>>();
  let realImageCount = 0;
  let placeholderImageCount = 0;

  for (const p of SEED_PRODUCTS_RAW) {
    const prodSlug = slugifyVietnamese(p.name);
    assert.ok(p.images.length >= 1, `Sản phẩm ${prodSlug} phải có ít nhất 1 ảnh`);
    const primaryUrl = p.images[0];

    for (const imgUrl of p.images) {
      assert.ok(
        imgUrl.startsWith('/seed-images/'),
        `Mọi ảnh của ${prodSlug} phải trỏ tới /seed-images/... (nhận được: ${imgUrl})`
      );
      const absFile = path.resolve(process.cwd(), 'public', imgUrl.replace(/^\/+/, ''));
      assert.equal(
        fs.existsSync(absFile),
        true,
        `Tệp ảnh mẫu ${absFile} của sản phẩm ${prodSlug} phải tồn tại trên đĩa`
      );
      const stat = fs.statSync(absFile);
      assert.ok(stat.size > 0, `Tệp ảnh mẫu ${absFile} phải có dung lượng > 0 byte`);
    }

    if (isPlaceholderSeedImageUrl(primaryUrl)) {
      placeholderImageCount += 1;
      assert.equal(
        primaryUrl,
        `/seed-images/placeholder-${p.cat}.svg`,
        `Ảnh giữ chỗ của ${prodSlug} phải khớp đúng danh mục placeholder-${p.cat}.svg`
      );
    } else {
      realImageCount += 1;
      assert.equal(
        primaryUrl,
        `/seed-images/${prodSlug}.jpg`,
        `Ảnh thật của ${prodSlug} phải có tên /seed-images/${prodSlug}.jpg`
      );
    }

    const catSet = primaryImageCategories.get(primaryUrl) || new Set<string>();
    catSet.add(p.cat);
    primaryImageCategories.set(primaryUrl, catSet);
  }

  assert.equal(realImageCount, 12, 'Phải có đúng 12 sản phẩm giữ ảnh thật /seed-images/<slug>.jpg');
  assert.equal(
    placeholderImageCount,
    17,
    'Phải có đúng 17 sản phẩm dùng ảnh giữ chỗ /seed-images/placeholder-<category>.svg'
  );

  for (const [imgUrl, catSet] of primaryImageCategories.entries()) {
    assert.equal(
      catSet.size,
      1,
      `Ảnh chính "${imgUrl}" không được dùng chung giữa hai sản phẩm khác loại: [${Array.from(catSet).join(', ')}]`
    );
  }

  // 5. Kiểm tra ENABLE_SEED_DEMO_DATA=true trên một CSDL trống (với SEED_DEV_ACCOUNTS=false):
  //    Phải tạo đúng 29 sản phẩm demo và 0 tài khoản mẫu (admin@baity.vn, khach1@baity.vn, khach2@baity.vn)
  const savedEnv = { ...process.env };
  try {
    await closeDb().catch(() => {});
    process.env.DATABASE_URL = '';
    process.env.USE_PGLITE = 'true';
    process.env.PGLITE_DATA_DIR = 'memory://';
    process.env.NODE_ENV = 'development';
    process.env.SEED_DEV_ACCOUNTS = 'false';
    process.env.ENABLE_SEED_DEMO_DATA = 'true';
    process.env.ADMIN_EMAIL = 'ops.seedtest@baity.vn';
    process.env.ADMIN_INITIAL_PASSWORD = 'SeedTestAdminPassword2026!';

    await getDb();
    await initDatabase();
    await seedDatabase();

    const prodCountRows = await queryRows<{ cnt: number }>(sql`
      SELECT COUNT(*)::int AS cnt FROM products;
    `);
    assert.equal(
      prodCountRows[0]?.cnt,
      29,
      `Khi bật ENABLE_SEED_DEMO_DATA=true trên CSDL trống, phải tạo đúng 29 sản phẩm (nhận được: ${prodCountRows[0]?.cnt})`
    );

    const sampleUserRows = await queryRows<{ email: string }>(sql`
      SELECT email
      FROM users
      WHERE LOWER(email) IN ('admin@baity.vn', 'khach1@baity.vn', 'khach2@baity.vn');
    `);
    assert.equal(
      sampleUserRows.length,
      0,
      `Khi SEED_DEV_ACCOUNTS=false và ENABLE_SEED_DEMO_DATA=true trên CSDL trống, phải có 0 tài khoản mẫu (nhận được: ${sampleUserRows.length})`
    );
  } finally {
    await closeDb().catch(() => {});
    restoreRuntimeModeEnv(savedEnv, process.env);
    process.env.DATABASE_URL = '';
    process.env.USE_PGLITE = 'true';
    process.env.PGLITE_DATA_DIR = 'memory://';
    process.env.NODE_ENV = 'test';
    process.env.COOKIE_CROSS_SITE = 'false';
    await getDb();
    await initDatabase();
    await seedDatabase();
  }
});

// ============================================================================
// MỤC 11: KIỂM THỬ SẴN SÀNG XUẤT MÃ NGUỒN (export:check), PROMPT TẠO ẢNH & CẤU HÌNH START RENDER
// ============================================================================
test('Stage 9.11 (Source Code Export Check, Prompt Spec & Render Start Config — Items 3, 4, 5): export:check đạt toàn bộ tiêu chí (không lộ 7 mẫu khóa thật, không có .env, .gitignore không chặn public/seed-images hay *.svg, không có file > 5MB); prompt trong seed:images-plan bỏ "vải trơn", dùng "không logo thương hiệu, không chữ lạ", <= 60 từ; tsx nằm trong dependencies', async () => {
  const { runExportCheck, scanTextForSecretPatterns } = await import(
    '../scripts/export-check.ts'
  );
  const { buildImageSpecAndPrompt } = await import('../scripts/seed-images-plan.ts');

  // 1. Chạy runExportCheck trên kho mã nguồn hiện tại -> phải đạt toàn bộ
  const report = runExportCheck(process.cwd());
  assert.equal(report.ok, true, 'runExportCheck() phải đạt toàn bộ tiêu chí');
  assert.equal(report.realSecretFindings.length, 0, 'Không được có bất kỳ khóa bí mật thật nào trong mã nguồn');
  assert.equal(report.envFileExists, false, 'Không được tồn tại file .env');
  assert.equal(report.forbiddenEnvFiles.length, 0, 'Không được tồn tại file .env.* (ngoài .env.example)');
  assert.equal(report.envExampleExists, true, 'Phải có file .env.example');
  assert.equal(
    report.gitignoreBlocksSeedImages,
    false,
    '.gitignore không được chặn public/seed-images'
  );
  assert.equal(report.gitignoreBlocksSvg, false, '.gitignore không được chặn *.svg');
  assert.equal(report.filesOver5MB.length, 0, 'Không được có file nào vượt quá 5MB');

  // 2. Kiểm tra bộ quét bắt đúng cả 7 mẫu khóa bí mật khi có giá trị thật và không lưu giá trị vào kết quả
  const syntheticLeakSample = [
    `SUPABASE_KEY=${'sb_' + 'secret_998877665544332211'}`,
    `GEMINI_KEY=${'AI' + 'zaSyRealLookingKey998877665544332211'}`,
    `JWT=${'ey' + 'JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ9988776655443322.SflKxwRJSMeKKF2QT4fwpMeJf36POk6y'}`,
    `DB=${'postgre' + 'sql://postgres.realproj:SuperSecretDbPass99@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'}`,
    `AUTH="${'Bea' + 'rer'} live_secret_token_99887766554433221100"`,
    `CONN="host=db.supabase.co ${'pass' + 'word='}LiveProdPassword9988!"`,
    `GEMINI_API_${'KEY='}"live_prod_api_key_value_99887766"`,
  ].join('\n');

  const scanRes = scanTextForSecretPatterns(syntheticLeakSample, 'synthetic-leak.ts');
  const detectedPatterns = scanRes.realFindings.map((f) => f.pattern).sort();
  assert.deepEqual(
    detectedPatterns,
    ['AIza', 'API_KEY=', 'Bearer', 'eyJ', 'password=', 'postgresql://', 'sb_secret'].sort(),
    'Bộ quét phải phát hiện đủ cả 7 mẫu khóa bí mật khi có giá trị thật'
  );
  const serializedFindings = JSON.stringify(scanRes.realFindings);
  assert.equal(
    serializedFindings.includes('SuperSecretDbPass99'),
    false,
    'Kết quả quét tuyệt đối không được chứa giá trị khóa bí mật'
  );

  // 3. Kiểm tra quy tắc sinh prompt trong buildImageSpecAndPrompt:
  // - Không còn cụm "vải trơn"
  // - Đổi sang "không logo thương hiệu, không chữ lạ"
  // - Giữ đúng họa tiết/phối màu (Kẻ caro flannel, Váy hoa nhí, Raglan phối màu)
  // - Cho phép chi tiết hình thêu nhỏ tinh tế với sản phẩm có Thêu Logo Baity / Thêu Chữ Baity / Họa Tiết Thêu Nhỏ
  // - Mọi prompt <= 60 từ
  const flannelSpec = buildImageSpecAndPrompt({
    name: 'Áo Sơ Mi Unisex Phom Rộng Kẻ Caro Flannel Ấm Áp',
    slug: 'ao-so-mi-unisex-phom-rong-ke-caro-flannel-am-ap',
    categorySlug: 'ao-so-mi',
    categoryName: 'Áo sơ mi',
    targetGender: 'unisex',
    primaryColor: 'Kẻ caro Rêu & Đen',
    material: '100% Cotton Flannel cào lông bề mặt',
  });
  assert.equal(flannelSpec.sampleViPrompt.includes('vải trơn'), false, 'Prompt không được chứa "vải trơn"');
  assert.ok(flannelSpec.sampleViPrompt.includes('kẻ caro flannel'), 'Prompt phải giữ họa tiết kẻ caro flannel');
  assert.ok(
    flannelSpec.sampleViPrompt.includes('không logo thương hiệu, không chữ lạ'),
    'Prompt phải dùng cụm "không logo thương hiệu, không chữ lạ"'
  );
  assert.ok(flannelSpec.promptWordCount <= 60, 'Prompt phải <= 60 từ');

  const hoodieLogoSpec = buildImageSpecAndPrompt({
    name: 'Áo Hoodie Unisex Nỉ Chân Cua Thêu Hình Nhỏ Tối Giản',
    slug: 'ao-hoodie-unisex-ni-chan-cua-theu-hinh-nho-toi-gian',
    categorySlug: 'ao-len-hoodie',
    categoryName: 'Áo len & Hoodie',
    targetGender: 'unisex',
    primaryColor: 'Xanh rêu olive',
    material: '100% Cotton nỉ chân cua cao cấp',
  });
  assert.equal(hoodieLogoSpec.hasSmallEmbroidery, true);
  assert.ok(
    hoodieLogoSpec.sampleViPrompt.includes('có chi tiết hình thêu nhỏ tinh tế'),
    'Sản phẩm có thêu phải cho phép chi tiết hình thêu nhỏ tinh tế trong prompt'
  );
  assert.equal(hoodieLogoSpec.sampleViPrompt.includes('vải trơn'), false);
  assert.ok(hoodieLogoSpec.promptWordCount <= 60, 'Prompt sản phẩm thêu phải <= 60 từ');

  // 4. Kiểm tra package.json: tsx nằm trong dependencies (không chỉ devDependencies) để npm start chạy trên Render
  const pkgJson = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')
  );
  assert.equal(pkgJson.scripts?.start, 'tsx server.ts');
  assert.ok(
    pkgJson.dependencies?.tsx,
    'tsx bắt buộc phải nằm trong dependencies của package.json để npm start hoạt động trên Render'
  );

  // 5. Kiểm tra export:check loại bỏ hoàn toàn các đường dẫn bị .gitignore (như .data/) khỏi bảng thống kê đưa lên Git
  assert.equal(
    report.directorySizes.some((d) => d.name === '.data/' || d.name.startsWith('.data')),
    false,
    'Bảng thống kê đưa lên Git của export:check không được chứa thư mục .data/ đã bị .gitignore loại trừ'
  );
});

// ============================================================================
// MỤC 12: CHẶN DÙNG CSDL DEV & EMAIL MẪU Ở STRICT (ITEM 2), LOG STRICT [PRODUCTION] (ITEM 4),
// THỐNG NHẤT /api/health 200/503 (ITEM 6) & HOODIE #31 HOÀN NGUYÊN CHẤT LIỆU (ITEM 1)
// ============================================================================
test('Stage 9.12 (Strict Dev-DB & ADMIN_EMAIL Guard, Strict [PRODUCTION] Logs, Unified /api/health 200/503 & Hoodie #31 Material — Items 1, 2, 4, 6): ADMIN_EMAIL trùng email mẫu báo "ADMIN_EMAIL không được dùng email mẫu của dữ liệu thử"; CSDL có tài khoản/đơn mẫu nêu rõ nguyên nhân và không lộ giá trị; log strict không có [DEV/PREVIEW]/[DEV/TEST]; /api/health trả 200/503; Hoodie #31 giữ chất liệu "100% Cotton nỉ chân cua cao cấp"', async () => {
  const { setTestDbInstanceForRehearsal } = await import('../server/db/index.ts');

  // 1. Kiểm tra Hoodie #31 trong SEED_PRODUCTS_RAW đã áp dụng Phương án 2 và giữ nguyên chất liệu cũ "100% Cotton nỉ chân cua cao cấp" (không có 380gsm)
  const hoodieItem = SEED_PRODUCTS_RAW.find((p) =>
    p.name.includes('Áo Hoodie Unisex Nỉ Chân Cua')
  );
  assert.ok(hoodieItem, 'Phải tìm thấy sản phẩm Hoodie #31 trong SEED_PRODUCTS_RAW');
  assert.equal(
    hoodieItem.name,
    'Áo Hoodie Unisex Nỉ Chân Cua Thêu Hình Nhỏ Tối Giản',
    'Tên sản phẩm #31 trong seed.ts phải được đổi thành "Áo Hoodie Unisex Nỉ Chân Cua Thêu Hình Nhỏ Tối Giản"'
  );
  assert.equal(
    hoodieItem.mat,
    '100% Cotton nỉ chân cua cao cấp',
    'Chất liệu của #31 trong seed.ts phải giữ nguyên giá trị cũ "100% Cotton nỉ chân cua cao cấp"'
  );
  assert.equal(
    hoodieItem.desc.toLowerCase().includes('baity'),
    false,
    'Mô tả của sản phẩm #31 không được còn chứa chữ/logo Baity'
  );
  assert.equal(
    hoodieItem.desc.toLowerCase().includes('380gsm'),
    false,
    'Mô tả của sản phẩm #31 không được chứa thông số 380gsm không rõ nguồn'
  );
  assert.equal(
    hoodieItem.colors[0]?.name,
    'Xanh rêu olive',
    'Biến thể màu chính của #31 phải là "Xanh rêu olive"'
  );

  // 2. Kiểm tra ADMIN_EMAIL trùng email mẫu ở strict (admin@baity.vn, khach1@baity.vn, khach2@baity.vn)
  for (const sampleEmail of ['admin@baity.vn', 'khach1@baity.vn', 'khach2@baity.vn']) {
    const checkRes = validateProductionStartupEnv(
      {
        ...VALID_STRICT_PROD_ENV,
        ADMIN_EMAIL: sampleEmail,
      },
      { hasExistingAdmin: false }
    );
    assert.equal(checkRes.ok, false, `ADMIN_EMAIL="${sampleEmail}" phải bị từ chối ở strict`);
    const joinedErr = checkRes.errors.join('\n');
    assert.ok(
      joinedErr.includes('ADMIN_EMAIL không được dùng email mẫu của dữ liệu thử'),
      `Thông báo lỗi phải chứa "ADMIN_EMAIL không được dùng email mẫu của dữ liệu thử" (nhận được: ${joinedErr})`
    );
    assert.equal(
      joinedErr.includes(sampleEmail),
      false,
      `Thông báo lỗi tuyệt đối không được in giá trị email mẫu "${sampleEmail}"`
    );
  }

  // 3. Kiểm tra GET /api/health trả 200 {"status":"ok","database":"connected"} khi thông và 503 {"status":"error"} khi lỗi CSDL
  await closeDb().catch(() => {});
  restoreRuntimeModeEnv({ NODE_ENV: 'test' }, process.env);
  process.env.USE_PGLITE = 'true';
  process.env.PGLITE_DATA_DIR = 'memory://';
  await getDb();
  await initDatabase();

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const okRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(okRes.status, 200);
    const okBody = await okRes.json();
    assert.deepEqual(
      okBody,
      { status: 'ok', database: 'connected' },
      'GET /api/health khi thông phải trả đúng {"status":"ok","database":"connected"} (không có productCount hay version)'
    );

    // Giả lập lỗi truy vấn CSDL bằng cách tiêm db lỗi vào setTestDbInstanceForRehearsal
    setTestDbInstanceForRehearsal({
      execute: async () => {
        throw new Error('SIMULATED_DB_DISCONNECT');
      },
    });
    const errRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(errRes.status, 503, 'GET /api/health khi lỗi CSDL phải trả HTTP 503');
    const errBody = await errRes.json();
    assert.deepEqual(
      errBody,
      { status: 'error' },
      'GET /api/health khi lỗi CSDL phải trả đúng {"status":"error"}'
    );
    console.log(
      `[HEALTH_503_EVIDENCE] GET /api/health -> 200 body=${JSON.stringify(okBody)} | 503 status=${errRes.status} body=${JSON.stringify(errBody)}`
    );
  } finally {
    setTestDbInstanceForRehearsal(null, null);
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // 4. Kiểm tra nhật ký strict và chặn dùng CSDL dev cho bản thật ở strict (Items 2 & 4):
  const savedEnv = { ...process.env };
  const origError = console.error;
  const origLog = console.log;
  const origWarn = console.warn;
  try {
    await closeDb().catch(() => {});
    restoreRuntimeModeEnv({ NODE_ENV: 'test' }, process.env);
    process.env.USE_PGLITE = 'true';
    process.env.PGLITE_DATA_DIR = 'memory://';
    const pgliteDb = await getDb();
    await initDatabase();

    // Tiêm thực thể PGlite này qua hook rehearsal để chạy ở strict mode thật
    setTestDbInstanceForRehearsal(pgliteDb);
    restoreRuntimeModeEnv(
      { NODE_ENV: 'production', RENDER: 'true', PRODUCTION_STRICT: 'true', APP_MODE: undefined },
      process.env
    );
    process.env.USE_PGLITE = 'false';
    process.env.COOKIE_CROSS_SITE = 'false';
    process.env.SEED_DEV_ACCOUNTS = 'false';
    process.env.ENABLE_SEED_DEMO_DATA = 'false';
    process.env.ADMIN_EMAIL = 'ops.strict.clean@baity.vn';
    process.env.ADMIN_INITIAL_PASSWORD = 'StrictCleanAdminPass@2026!';

    const capturedStrictLogs: string[] = [];
    console.log = (...args: any[]) => {
      const line = args.join(' ');
      capturedStrictLogs.push(line);
      origLog(...args);
    };

    // (4a-1) CSDL PGlite trống -> strict chạy thành công
    await seedDatabase();
    const emptyProdCount = await queryRows<{ cnt: number }>(
      sql`SELECT COUNT(*)::int AS cnt FROM products;`
    );
    assert.equal(emptyProdCount[0]?.cnt, 0, 'CSDL trống khi ENABLE_SEED_DEMO_DATA=false phải có 0 sản phẩm');

    // (4a-2) Bật ENABLE_SEED_DEMO_DATA=true trên CSDL chưa có sản phẩm -> strict nạp 29 sản phẩm demo và vẫn chạy thành công
    process.env.ENABLE_SEED_DEMO_DATA = 'true';
    await seedDatabase();
    const demoProdCount = await queryRows<{ cnt: number }>(
      sql`SELECT COUNT(*)::int AS cnt FROM products;`
    );
    assert.equal(
      demoProdCount[0]?.cnt,
      29,
      'CSDL PGlite bật ENABLE_SEED_DEMO_DATA=true ở strict phải tạo 29 sản phẩm demo và chạy thành công'
    );

    const strictLogJoined = capturedStrictLogs.join('\n');
    assert.equal(
      strictLogJoined.includes('[DEV/PREVIEW]') || strictLogJoined.includes('[DEV/TEST]'),
      false,
      `Nhật ký ở chế độ strict tuyệt đối không được in nhãn [DEV/PREVIEW] hay [DEV/TEST] (nhận được:\n${strictLogJoined})`
    );
    assert.ok(
      strictLogJoined.includes('[PRODUCTION]'),
      'Nhật ký ở chế độ strict phải dùng nhãn [PRODUCTION]'
    );

    // Kiểm tra EMAIL_PROVIDER warning chỉ in 1 lần khi gọi validateProductionStartupEnv lần 1 + lần 2 (suppressWarnings: true)
    const capturedWarns: string[] = [];
    console.warn = (...args: any[]) => capturedWarns.push(args.join(' '));
    validateProductionStartupEnv(
      { ...VALID_STRICT_PROD_ENV, EMAIL_PROVIDER: 'log', EMAIL_FROM: '' },
      { hasExistingAdmin: true }
    );
    validateProductionStartupEnv(
      { ...VALID_STRICT_PROD_ENV, EMAIL_PROVIDER: 'log', EMAIL_FROM: '' },
      { hasExistingAdmin: true, suppressWarnings: true }
    );
    assert.equal(
      capturedWarns.filter((w) => w.includes('[EMAIL CONFIG WARNING]')).length,
      1,
      'Cảnh báo EMAIL_PROVIDER ở strict chỉ được in đúng 1 lần khi khởi động'
    );
    console.warn = origWarn;

    // (4b-1) Chèn tài khoản mẫu admin@baity.vn vào CSDL -> strict phải từ chối khởi động ngay và nêu rõ do tài khoản mẫu
    await queryRows(sql`
      INSERT INTO users (full_name, email, phone, password_hash, role)
      VALUES ('Sample Dev Admin', 'admin@baity.vn', '0900000001', 'hashed', 'admin')
      ON CONFLICT (email) DO NOTHING;
    `);

    const capturedErrLogs: string[] = [];
    console.error = (...args: any[]) => capturedErrLogs.push(args.join(' '));

    await assert.rejects(
      async () => {
        await seedDatabase();
      },
      (err: any) =>
        err instanceof Error &&
        err.message === 'CSDL chứa dữ liệu mẫu (phát hiện tài khoản mẫu), không dùng CSDL thử cho bản thật',
      'Khi CSDL có admin@baity.vn thì chạy ở strict phải từ chối khởi động với nguyên nhân rõ "phát hiện tài khoản mẫu"'
    );
    const errLogText1 = capturedErrLogs.join('\n');
    assert.equal(
      errLogText1.includes('admin@baity.vn'),
      false,
      'Thông báo lỗi tuyệt đối không được in giá trị email mẫu ra log'
    );

    // (4b-2) Xóa admin@baity.vn nhưng chèn đơn mẫu BAITY-1001 -> strict bị từ chối khởi động với nguyên nhân rõ "phát hiện đơn hàng mẫu"
    await queryRows(sql`DELETE FROM users WHERE LOWER(email) = 'admin@baity.vn';`);
    const validAdminRows = await queryRows<{ id: string }>(sql`
      SELECT id FROM users WHERE LOWER(email) = 'ops.strict.clean@baity.vn' LIMIT 1;
    `);
    await queryRows(sql`
      INSERT INTO orders (
        id, user_id, receiver_name, receiver_phone, shipping_address,
        shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status
      )
      VALUES (
        'BAITY-1001', ${validAdminRows[0].id}::uuid, 'Sample Receiver', '0900000002',
        '123 Sample St', 'standard', 30000, 200000, 0, 230000, 'pending'
      );
    `);

    capturedErrLogs.length = 0;
    await assert.rejects(
      async () => {
        await seedDatabase();
      },
      (err: any) =>
        err instanceof Error &&
        err.message === 'CSDL chứa dữ liệu mẫu (phát hiện đơn hàng mẫu), không dùng CSDL thử cho bản thật',
      'Khi CSDL có đơn mẫu BAITY-1001 thì chạy ở strict phải từ chối khởi động với nguyên nhân rõ "phát hiện đơn hàng mẫu"'
    );
    const errLogText2 = capturedErrLogs.join('\n');
    assert.equal(
      errLogText2.includes('BAITY-1001'),
      false,
      'Thông báo lỗi tuyệt đối không được in mã đơn mẫu ra log'
    );

    // (4b-3) Khi CSDL trống nhưng ADMIN_EMAIL đặt là khach1@baity.vn -> seedDatabase() ở strict từ chối với "ADMIN_EMAIL không được dùng email mẫu của dữ liệu thử"
    await queryRows(sql`DELETE FROM orders WHERE id = 'BAITY-1001';`);
    await queryRows(sql`DELETE FROM users WHERE role = 'admin';`);
    process.env.ADMIN_EMAIL = 'khach1@baity.vn';
    capturedErrLogs.length = 0;
    await assert.rejects(
      async () => {
        await seedDatabase();
      },
      (err: any) =>
        err instanceof Error &&
        err.message.includes('ADMIN_EMAIL không được dùng email mẫu của dữ liệu thử') &&
        !err.message.includes('khach1@baity.vn'),
      'seedDatabase() ở strict phải chặn ADMIN_EMAIL trùng email mẫu với thông báo rõ và không in giá trị'
    );
    assert.equal(
      capturedErrLogs.join('\n').includes('khach1@baity.vn'),
      false,
      'Log lỗi không được chứa giá trị email mẫu khach1@baity.vn'
    );
  } finally {
    console.error = origError;
    console.log = origLog;
    console.warn = origWarn;
    setTestDbInstanceForRehearsal(null, null);
    await closeDb().catch(() => {});
    restoreRuntimeModeEnv(savedEnv, process.env);
    process.env.DATABASE_URL = '';
    process.env.USE_PGLITE = 'true';
    process.env.PGLITE_DATA_DIR = 'memory://';
    process.env.NODE_ENV = 'test';
    process.env.COOKIE_CROSS_SITE = 'false';
    await getDb();
    await initDatabase();
    await seedDatabase();
  }
});





