/**
 * Module duy nhất quản lý chế độ chạy (Runtime Mode) và chính sách mật khẩu Admin.
 * Mọi truy cập tới process.env.RENDER, process.env.PRODUCTION_STRICT và process.env.APP_MODE
 * trong toàn bộ mã nguồn server và scripts bắt buộc chỉ đặt tại file này.
 */

export const PREVIEW_MODE_WARNING_BANNER =
  '⚠️ [PREVIEW MODE - không dùng cho production] Hệ thống đang chạy ở chế độ APP_MODE=preview.';

export const STRICT_MODE_AI_STUDIO_HINT = 'AI Studio: đặt APP_MODE=preview';

export const STRICT_COOKIE_CROSS_SITE_ERROR_MESSAGE =
  '❌ FATAL SECURITY CONFIG: Không được phép bật COOKIE_CROSS_SITE=true khi RENDER=true, PRODUCTION_STRICT=true hoặc chế độ strict production! Môi trường Production bắt buộc sử dụng cookie SameSite=Lax. (AI Studio: đặt APP_MODE=preview)';

const BANNED_ADMIN_PASSWORD_EXACT = new Set([
  'admin@123',
  'khach@123',
  'baity2026shop9xk',
  'admin@123456',
  'admin12345678',
  'khach@123456',
  'khach12345678',
  'password123456',
  '1234567890ab',
  'qwerty123456',
  'changeme_strongadminpass@2026',
]);

const BANNED_ADMIN_PASSWORD_SUBSTRINGS = [
  'admin@123',
  'khach@123',
  'baity2026shop9xk',
  'admin12345',
  'khach12345',
  'changeme_strongadminpass',
];

/**
 * Công thức xác định chế độ nghiêm ngặt (Strict Production):
 * strict = RENDER === 'true' || PRODUCTION_STRICT === 'true' || (NODE_ENV === 'production' && APP_MODE !== 'preview')
 * - Chỉ APP_MODE='preview' mới cho phép NODE_ENV='production' chạy không nghiêm ngặt.
 * - RENDER='false', PRODUCTION_STRICT='false' và COOKIE_CROSS_SITE='true' KHÔNG làm yếu chế độ nghiêm ngặt.
 * - RENDER='true' (và PRODUCTION_STRICT='true') luôn thắng APP_MODE='preview'.
 */
export function isStrictRuntimeMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const renderVal = env === process.env ? process.env.RENDER : env.RENDER;
  const prodStrictVal =
    env === process.env ? process.env.PRODUCTION_STRICT : env.PRODUCTION_STRICT;
  const nodeEnvVal = env === process.env ? process.env.NODE_ENV : env.NODE_ENV;
  const appModeVal = env === process.env ? process.env.APP_MODE : env.APP_MODE;

  return (
    renderVal === 'true' ||
    prodStrictVal === 'true' ||
    (nodeEnvVal === 'production' && appModeVal !== 'preview')
  );
}

/**
 * Kiểm tra xem ứng dụng có đang chạy ở chế độ xem trước (APP_MODE=preview và không bị ép strict bởi RENDER/PRODUCTION_STRICT)
 */
export function isPreviewRuntimeMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const appModeVal = env === process.env ? process.env.APP_MODE : env.APP_MODE;
  return !isStrictRuntimeMode(env) && appModeVal === 'preview';
}

/**
 * Kiểm tra xem server có cần phục vụ bundle tĩnh từ dist/ hay không
 */
export function shouldServeStaticDist(env: NodeJS.ProcessEnv = process.env): boolean {
  const nodeEnvVal = env === process.env ? process.env.NODE_ENV : env.NODE_ENV;
  return nodeEnvVal === 'production' || isStrictRuntimeMode(env);
}

/**
 * In cảnh báo lớn khi chạy ở chế độ preview (APP_MODE=preview)
 */
export function logPreviewModeWarningIfNeeded(
  env: NodeJS.ProcessEnv = process.env,
  logger: (msg: string) => void = console.warn
): boolean {
  if (isPreviewRuntimeMode(env)) {
    logger('================================================================================');
    logger(PREVIEW_MODE_WARNING_BANNER);
    logger('================================================================================');
    return true;
  }
  return false;
}

/**
 * Định dạng dòng tóm tắt trạng thái khởi động an toàn (không lộ bất kỳ khóa bí mật nào)
 */
export function formatStartupSecuritySummary(env: NodeJS.ProcessEnv = process.env): string {
  const strict = isStrictRuntimeMode(env);
  const preview = isPreviewRuntimeMode(env);
  return `🛡️ [STARTUP SECURITY CHECK] NODE_ENV=${env.NODE_ENV || 'development'}, APP_MODE=${env.APP_MODE || 'unset'}, RENDER=${env.RENDER || 'false'}, PRODUCTION_STRICT=${env.PRODUCTION_STRICT || 'false'}, STRICT=${strict}, PREVIEW=${preview}, COOKIE_CROSS_SITE=${env.COOKIE_CROSS_SITE || 'false'}, TRUST_PROXY_HOPS=${env.TRUST_PROXY_HOPS || '1'}, SEED_DEV_ACCOUNTS=${env.SEED_DEV_ACCOUNTS || 'false'}`;
}

/**
 * Thiết lập biến môi trường cho buổi diễn tập Production nghiêm ngặt (prod:rehearsal)
 */
export function applyStrictRehearsalModeEnv(env: NodeJS.ProcessEnv = process.env): void {
  delete env.RENDER;
  delete env.APP_MODE;
  env.NODE_ENV = 'production';
  env.PRODUCTION_STRICT = 'true';
}

/**
 * Khôi phục các cờ chế độ chạy sau kiểm thử
 */
export function restoreRuntimeModeEnv(
  snapshot: Partial<NodeJS.ProcessEnv>,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (snapshot.NODE_ENV !== undefined) env.NODE_ENV = snapshot.NODE_ENV;
  else delete env.NODE_ENV;

  if (snapshot.RENDER !== undefined) env.RENDER = snapshot.RENDER;
  else delete env.RENDER;

  if (snapshot.PRODUCTION_STRICT !== undefined) env.PRODUCTION_STRICT = snapshot.PRODUCTION_STRICT;
  else delete env.PRODUCTION_STRICT;

  if (snapshot.APP_MODE !== undefined) env.APP_MODE = snapshot.APP_MODE;
  else delete env.APP_MODE;
}

/**
 * Kiểm tra chính sách mật khẩu Admin ở MỌI chế độ (trừ NODE_ENV=test):
 * - Tối thiểu 12 ký tự
 * - Có cả chữ cái (A-Z, a-z) và chữ số (0-9)
 * - Không nằm trong danh sách cấm (Admin@123, Khach@123, Baity2026Shop9xK và các biến thể thường gặp)
 * - Tuyệt đối không bao giờ trả về hay in giá trị mật khẩu trong thông báo lỗi
 */
export function validateAdminPasswordPolicy(rawPassword: string | undefined | null): {
  valid: boolean;
  reason?: string;
} {
  const pwd = typeof rawPassword === 'string' ? rawPassword.trim() : '';
  if (!pwd) {
    return {
      valid: false,
      reason:
        'ADMIN_INITIAL_PASSWORD: Bắt buộc cấu hình mật khẩu khởi tạo Admin (tối thiểu 12 ký tự, có chữ và số, không thuộc danh sách mật khẩu cấm).',
    };
  }

  if (pwd.length < 12) {
    return {
      valid: false,
      reason:
        'ADMIN_INITIAL_PASSWORD: Mật khẩu khởi tạo Admin quá ngắn (bắt buộc tối thiểu 12 ký tự, có chữ và số, không thuộc danh sách mật khẩu cấm).',
    };
  }

  const hasLetter = /[A-Za-z]/.test(pwd);
  const hasDigit = /[0-9]/.test(pwd);
  if (!hasLetter || !hasDigit) {
    return {
      valid: false,
      reason:
        'ADMIN_INITIAL_PASSWORD: Mật khẩu khởi tạo Admin bắt buộc phải chứa cả chữ cái và chữ số (tối thiểu 12 ký tự).',
    };
  }

  const lower = pwd.toLowerCase();
  const compact = lower.replace(/[\s_.-]+/g, '');
  const alnumOnly = lower.replace(/[^a-z0-9]+/g, '');

  if (
    BANNED_ADMIN_PASSWORD_EXACT.has(lower) ||
    BANNED_ADMIN_PASSWORD_EXACT.has(compact) ||
    BANNED_ADMIN_PASSWORD_SUBSTRINGS.some(
      (pattern) => lower.includes(pattern) || compact.includes(pattern)
    ) ||
    alnumOnly.includes('baity2026shop9xk') ||
    alnumOnly === 'admin123' ||
    alnumOnly === 'khach123'
  ) {
    return {
      valid: false,
      reason:
        'ADMIN_INITIAL_PASSWORD: Mật khẩu khởi tạo Admin nằm trong danh sách mật khẩu mẫu hoặc phổ biến bị cấm.',
    };
  }

  return { valid: true };
}


