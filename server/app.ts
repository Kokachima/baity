import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { apiRouter } from './routes/api.ts';
import {
  isStrictRuntimeMode,
  logPreviewModeWarningIfNeeded,
  STRICT_MODE_AI_STUDIO_HINT,
  STRICT_COOKIE_CROSS_SITE_ERROR_MESSAGE,
  validateAdminPasswordPolicy,
} from './config/runtimeMode.ts';
import { parseSenderAddress } from './services/email.ts';

function defaultErrorCodeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 422:
      return 'UNPROCESSABLE_ENTITY';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'API_ERROR';
  }
}

function normalizeHostValue(rawHost: string): string {
  return rawHost
    .trim()
    .toLowerCase()
    .replace(/:(80|443)$/, '');
}

/**
 * Đọc số bước proxy tin cậy từ TRUST_PROXY_HOPS (mặc định: 1).
 * Tuyệt đối không dùng `trust proxy: true` để tránh client gửi X-Forwarded-For giả mạo vượt rate limit.
 */
export function getTrustProxyHops(): number {
  const raw = process.env.TRUST_PROXY_HOPS;
  if (raw !== undefined && raw.trim() !== '') {
    const parsed = Number(raw.trim());
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 1;
}

/**
 * Chốt chặn cấu hình an toàn:
 * Nếu đang ở chế độ strict production mà COOKIE_CROSS_SITE=true thì từ chối khởi động ngay lập tức.
 */
export function assertEnvironmentSecurityConfig(env: NodeJS.ProcessEnv = process.env): void {
  const isStrictProd = isStrictRuntimeMode(env);
  if (isStrictProd && env.COOKIE_CROSS_SITE === 'true') {
    const err = new Error(STRICT_COOKIE_CROSS_SITE_ERROR_MESSAGE);
    console.error(err.message);
    throw err;
  }
}

/**
 * Kiểm tra cấu hình biến môi trường ở chế độ strict production lúc khởi động:
 * - Báo lỗi rõ ràng tên biến thiếu hoặc sai định dạng, kèm hướng dẫn (${STRICT_MODE_AI_STUDIO_HINT}).
 * - ADMIN_EMAIL và ADMIN_INITIAL_PASSWORD chỉ bắt buộc khi CSDL chưa có tài khoản Admin (`hasExistingAdmin !== true`).
 * - TUYỆT ĐỐI KHÔNG bao giờ in giá trị bí mật (JWT_SECRET, ADMIN_INITIAL_PASSWORD, DATABASE_URL, CRON_SECRET_KEY, PAYMENT_WEBHOOK_SECRET) ra log hoặc thông báo lỗi.
 */
export function validateProductionStartupEnv(
  env: NodeJS.ProcessEnv = process.env,
  options?: { hasExistingAdmin?: boolean; suppressWarnings?: boolean }
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const isStrictProd = isStrictRuntimeMode(env);

  if (!isStrictProd) {
    logPreviewModeWarningIfNeeded(env);
    return { ok: true, errors: [] };
  }

  const hasExistingAdmin = options?.hasExistingAdmin === true;

  // 1. Cấm COOKIE_CROSS_SITE=true ở strict
  if (env.COOKIE_CROSS_SITE === 'true') {
    errors.push(
      `COOKIE_CROSS_SITE: Không được phép bật COOKIE_CROSS_SITE="true" ở môi trường Production (bắt buộc "false" hoặc bỏ trống để dùng SameSite=Lax). (${STRICT_MODE_AI_STUDIO_HINT})`
    );
  }

  // 2. Cấm USE_PGLITE=true ở MỌI chế độ strict
  if (env.USE_PGLITE === 'true') {
    errors.push(
      `USE_PGLITE: Không được phép bật USE_PGLITE="true" ở môi trường Production. (${STRICT_MODE_AI_STUDIO_HINT})`
    );
  }

  // 3. Cấm SEED_DEV_ACCOUNTS=true ở strict
  if (env.SEED_DEV_ACCOUNTS === 'true') {
    errors.push(
      `SEED_DEV_ACCOUNTS: Không được phép bật SEED_DEV_ACCOUNTS="true" ở môi trường Production. (${STRICT_MODE_AI_STUDIO_HINT})`
    );
  }

  // 4. Cấm ENABLE_DEMO_PAYMENT_WEBHOOK=true ở strict
  if (env.ENABLE_DEMO_PAYMENT_WEBHOOK === 'true') {
    errors.push(
      `ENABLE_DEMO_PAYMENT_WEBHOOK: Không được phép bật ENABLE_DEMO_PAYMENT_WEBHOOK="true" ở môi trường Production. (${STRICT_MODE_AI_STUDIO_HINT})`
    );
  }

  // 5. Bắt buộc DATABASE_URL ở MỌI chế độ strict
  const dbUrl = (env.DATABASE_URL || '').trim();
  if (!dbUrl) {
    errors.push(
      `DATABASE_URL: Bắt buộc cấu hình chuỗi kết nối PostgreSQL bền vững ở môi trường Production. (${STRICT_MODE_AI_STUDIO_HINT})`
    );
  }

  // 6. Bắt buộc JWT_SECRET tối thiểu 16 ký tự
  const jwtSecret = (env.JWT_SECRET || '').trim();
  if (!jwtSecret || jwtSecret.length < 16) {
    errors.push(
      `JWT_SECRET: Bắt buộc cấu hình chuỗi bí mật tối thiểu 16 ký tự ở môi trường Production. (${STRICT_MODE_AI_STUDIO_HINT})`
    );
  }

  // 7 & 8. Kiểm tra ADMIN_EMAIL (từ chối ngay nếu trùng email mẫu dev, không in giá trị) và ADMIN_INITIAL_PASSWORD khi CSDL chưa có Admin
  const adminEmail = (env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (['admin@baity.vn', 'khach1@baity.vn', 'khach2@baity.vn'].includes(adminEmail)) {
    errors.push(
      `ADMIN_EMAIL: ADMIN_EMAIL không được dùng email mẫu của dữ liệu thử (${STRICT_MODE_AI_STUDIO_HINT})`
    );
  } else if (!hasExistingAdmin && !adminEmail) {
    errors.push(
      `ADMIN_EMAIL: Bắt buộc cấu hình email quản trị viên hợp lệ (khi CSDL chưa có Admin). (${STRICT_MODE_AI_STUDIO_HINT})`
    );
  }

  if (!hasExistingAdmin) {
    const pwdCheck = validateAdminPasswordPolicy(env.ADMIN_INITIAL_PASSWORD);
    if (!pwdCheck.valid) {
      errors.push(`${pwdCheck.reason} (${STRICT_MODE_AI_STUDIO_HINT})`);
    }
  }

  // 9. Bắt buộc CRON_SECRET_KEY
  const cronSecret = (env.CRON_SECRET_KEY || '').trim();
  if (!cronSecret) {
    errors.push(
      `CRON_SECRET_KEY: Bắt buộc cấu hình khóa bí mật bảo vệ tác vụ định kỳ ở môi trường Production. (${STRICT_MODE_AI_STUDIO_HINT})`
    );
  }

  // 10. Bắt buộc PAYMENT_WEBHOOK_SECRET
  const paymentWebhookSecret = (env.PAYMENT_WEBHOOK_SECRET || '').trim();
  if (!paymentWebhookSecret) {
    errors.push(
      `PAYMENT_WEBHOOK_SECRET: Bắt buộc cấu hình khóa bí mật xác thực Webhook thanh toán ở môi trường Production. (${STRICT_MODE_AI_STUDIO_HINT})`
    );
  }

  // 11. Kiểm tra EMAIL_PROVIDER và EMAIL_FROM (không có giá trị mặc định)
  const emailProvider = String(env.EMAIL_PROVIDER || 'log')
    .trim()
    .toLowerCase();
  if (emailProvider === 'brevo' || emailProvider === 'resend') {
    const emailFromRaw = String(env.EMAIL_FROM || '').trim();
    const sender = parseSenderAddress(emailFromRaw);
    if (!emailFromRaw || !sender.email || !sender.email.includes('@')) {
      errors.push(
        `EMAIL_FROM: Bắt buộc cấu hình địa chỉ gửi hợp lệ khi EMAIL_PROVIDER="${emailProvider}" ở môi trường Production (không có giá trị mặc định). (${STRICT_MODE_AI_STUDIO_HINT})`
      );
    }
  } else if (!emailProvider || emailProvider === 'log') {
    if (!options?.suppressWarnings) {
      console.warn(
        '[EMAIL CONFIG WARNING] EMAIL_PROVIDER đang ở chế độ "log" trong môi trường Production. Hệ thống vẫn khởi động nhưng sẽ không gửi email khôi phục mật khẩu ra ngoài.'
      );
    }
  } else {
    errors.push(
      `EMAIL_PROVIDER: Nhà cung cấp email không hợp lệ (chỉ hỗ trợ log, brevo, resend). (${STRICT_MODE_AI_STUDIO_HINT})`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

/**
 * Phân tích danh sách frame-ancestors cho Content-Security-Policy:
 * - Ở chế độ strict production: luôn cố định ["'self'"].
 * - Ở bản chạy thử (Preview): đọc từ biến môi trường FRAME_ANCESTORS (cho phép tên miền AI Studio).
 */
export function resolveCspFrameAncestors(isProd: boolean): string[] {
  if (isProd) {
    return ["'self'"];
  }
  const rawEnv = process.env.FRAME_ANCESTORS;
  const source =
    rawEnv && rawEnv.trim().length > 0
      ? rawEnv
      : "'self' https://aistudio.google.com https://*.google.com https://*.googleusercontent.com";

  const tokens = source
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '*');

  if (!tokens.includes("'self'")) {
    tokens.unshift("'self'");
  }
  return tokens;
}

/**
 * Phân tích danh sách tên miền ảnh bổ sung từ biến tùy chọn CSP_EXTRA_IMG_HOSTS:
 * - Định dạng chuẩn: danh sách tên miền ngăn cách bằng dấu phẩy, không có https:// (ví dụ: images.unsplash.com,picsum.photos).
 * - Để trống hoặc không đặt là hoàn toàn hợp lệ và không làm dừng khởi động (kể cả ở strict).
 * - Giá trị sai định dạng sẽ bị bỏ qua kèm cảnh báo (tuyệt đối không in giá trị lạ ra log) và không làm dừng khởi động.
 */
const EXTRA_IMG_HOST_DOMAIN_REGEX =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function resolveExtraImgHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.CSP_EXTRA_IMG_HOSTS;
  if (raw === undefined || raw.trim() === '') {
    return [];
  }

  const hosts = new Set<string>();
  const parts = raw.split(',');

  for (const part of parts) {
    const trimmed = part.trim().toLowerCase();
    if (
      !trimmed ||
      trimmed.length > 253 ||
      !EXTRA_IMG_HOST_DOMAIN_REGEX.test(trimmed)
    ) {
      console.warn(
        '[CSP WARNING] Bỏ qua mục cấu hình sai định dạng trong CSP_EXTRA_IMG_HOSTS (định dạng chuẩn: danh sách tên miền ngăn cách bằng dấu phẩy, không có https://, ví dụ: images.unsplash.com,picsum.photos).'
      );
      continue;
    }
    hosts.add(`https://${trimmed}`);
  }

  return Array.from(hosts);
}

export interface TrustedServerHosts {
  rawHosts: Set<string>;
  normalizedHosts: Set<string>;
  trustedForwardedHosts: string[];
  directHosts: string[];
}

/**
 * Trích xuất danh sách Host tin cậy của server dựa theo số bước proxy (TRUST_PROXY_HOPS):
 * - Với X-Forwarded-Host: chỉ lấy tối đa `trustHops` phần tử từ bên phải (do các lớp proxy tin cậy gắn vào).
 * - Kết hợp với Host trực tiếp của request (và tương đương localhost <-> 127.0.0.1 khi chạy cục bộ).
 */
export function resolveTrustedServerHosts(req: Request): TrustedServerHosts {
  const rawHosts = new Set<string>();
  const normalizedHosts = new Set<string>();

  const trustHops = Number(req.app?.get('trust proxy') ?? getTrustProxyHops());
  const forwardedHostHeader =
    trustHops > 0 ? (req.headers['x-forwarded-host'] as string) || '' : '';
  const directHostHeader = (req.headers.host as string) || '';

  const forwardedParts = forwardedHostHeader
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const trustedForwardedHosts =
    trustHops > 0 && forwardedParts.length > 0
      ? forwardedParts.slice(-trustHops)
      : [];

  const directHosts = directHostHeader
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  for (const trimmed of [...trustedForwardedHosts, ...directHosts]) {
    if (!trimmed || trimmed === '*' || trimmed.includes('*')) continue;

    rawHosts.add(trimmed);
    normalizedHosts.add(normalizeHostValue(trimmed));

    if (trimmed.startsWith('127.0.0.1:')) {
      const localEquiv = trimmed.replace('127.0.0.1:', 'localhost:');
      rawHosts.add(localEquiv);
      normalizedHosts.add(normalizeHostValue(localEquiv));
    } else if (trimmed.startsWith('localhost:')) {
      const loopEquiv = trimmed.replace('localhost:', '127.0.0.1:');
      rawHosts.add(loopEquiv);
      normalizedHosts.add(normalizeHostValue(loopEquiv));
    }
  }

  return {
    rawHosts,
    normalizedHosts,
    trustedForwardedHosts,
    directHosts,
  };
}

/**
 * Trích xuất đúng Origin (ví dụ: https://ocuizojmlykchhcvveqi.supabase.co) từ biến môi trường SUPABASE_URL
 * để cấu hình Content-Security-Policy (img-src & connect-src) thu hẹp thay vì dùng wildcard *.supabase.co
 */
export function resolveSupabaseCspOrigin(): string | null {
  const raw = (process.env.SUPABASE_URL || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.hostname.includes('*')) {
      return parsed.origin.toLowerCase();
    }
  } catch {
    // ignore invalid SUPABASE_URL
  }
  return null;
}

/**
 * Xác định giao thức thật (http / https) của request sau chuỗi reverse proxy theo đúng TRUST_PROXY_HOPS:
 * 1. Nếu trustHops <= 0: chỉ tin trạng thái mã hóa của socket trực tiếp.
 * 2. Ở chế độ strict production:
 *    CHỈ sử dụng header X-Forwarded-Proto đáng tin theo số bước proxy (`protoParts.slice(-trustHops)[0]`).
 *    Tuyệt đối không suy luận giao thức từ APP_URL hay *.run.app ở Production.
 * 3. Khi COOKIE_CROSS_SITE=true VÀ không phải strict production (Preview AI Studio):
 *    Hỗ trợ suy luận giao thức https khi lớp Nginx nội bộ cổng 8080 (`Host: localhost:3000`) ghi đè `X-Forwarded-Proto` thành `http`
 *    nhưng `X-Forwarded-Host` khớp tên miền HTTPS của `APP_URL` hoặc `*.run.app`.
 */
export function resolveTrustedProtocol(req: Request): 'http' | 'https' {
  const socketEncrypted = Boolean((req.socket as any)?.encrypted);
  const trustHops = Number(req.app?.get('trust proxy') ?? getTrustProxyHops());

  if (trustHops <= 0) {
    return socketEncrypted ? 'https' : 'http';
  }

  const isStrictProd = isStrictRuntimeMode();
  const crossSitePreviewMode = !isStrictProd && process.env.COOKIE_CROSS_SITE === 'true';

  const rawProtoHeader = (req.headers['x-forwarded-proto'] as string) || '';
  const protoParts = rawProtoHeader
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is 'http' | 'https' => p === 'http' || p === 'https');

  const trustedProtos = protoParts.slice(-trustHops);

  // Ở Production (hoặc khi tắt COOKIE_CROSS_SITE): chỉ dùng X-Forwarded-Proto đáng tin theo số bước hop
  if (!crossSitePreviewMode) {
    if (trustedProtos.length > 0) {
      return trustedProtos[0];
    }
    return socketEncrypted ? 'https' : 'http';
  }

  // Từ đây trở xuống: CHỈ chạy khi COOKIE_CROSS_SITE=true và KHÔNG phải Production (chế độ Preview AI Studio)
  const rawForwarded = (req.headers['forwarded'] as string) || '';
  const forwardedHops = rawForwarded
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(-trustHops);
  const hasForwardedHttps = forwardedHops.some((hop) =>
    /(?:^|;)\s*proto\s*=\s*"?https"?(?:\s*;|$)/i.test(hop)
  );

  if (trustedProtos.length >= 2) {
    return trustedProtos[0];
  }

  if (trustedProtos.length === 1) {
    if (trustedProtos[0] === 'https' || hasForwardedHttps) {
      return 'https';
    }

    // Trường hợp Preview AI Studio (trustHops >= 2) có lớp Nginx nội bộ (localhost:3000) ghi đè X-Forwarded-Proto thành "http"
    if (trustHops >= 2) {
      const { trustedForwardedHosts, directHosts } = resolveTrustedServerHosts(req);
      const isInnerLoopbackProxy =
        directHosts.length > 0 &&
        directHosts.every(
          (h) =>
            h === 'localhost' ||
            h.startsWith('localhost:') ||
            h === '127.0.0.1' ||
            h.startsWith('127.0.0.1:')
        );

      if (isInnerLoopbackProxy && trustedForwardedHosts.length > 0) {
        let appUrlHttpsHost: string | null = null;
        if (process.env.APP_URL) {
          try {
            const parsedAppUrl = new URL(process.env.APP_URL.trim());
            if (parsedAppUrl.protocol === 'https:') {
              appUrlHttpsHost = normalizeHostValue(parsedAppUrl.host);
            }
          } catch {
            // ignore invalid APP_URL
          }
        }

        const outerForwardedHost = normalizeHostValue(trustedForwardedHosts[0]);
        if (
          (appUrlHttpsHost && outerForwardedHost === appUrlHttpsHost) ||
          outerForwardedHost.endsWith('.run.app')
        ) {
          return 'https';
        }
      }
    }

    return 'http';
  }

  if (hasForwardedHttps) {
    return 'https';
  }

  return socketEncrypted ? 'https' : 'http';
}

/**
 * Kiểm tra Origin/Referer chống CSRF:
 * 1. Cho phép request khi Origin trùng với host của chính server (so với Host hoặc X-Forwarded-Host sau khi tin cậy proxy theo TRUST_PROXY_HOPS).
 * 2. Khi COOKIE_CROSS_SITE=true hoặc ở chế độ strict production:
 *    bắt buộc giao thức của Origin phải khớp với giao thức thật của request sau chuỗi proxy (`resolveTrustedProtocol(req)`), lệch giao thức thì chặn 403.
 * 3. ALLOWED_ORIGINS (và APP_URL) chỉ là danh sách bổ sung.
 * 4. Tuyệt đối không dùng và không chấp nhận ký tự đại diện "*".
 */
export function isOriginTrusted(rawOriginOrReferer: string, req: Request): boolean {
  if (!rawOriginOrReferer || rawOriginOrReferer.trim() === '*') {
    return false;
  }

  try {
    const parsed = new URL(rawOriginOrReferer);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    const crossSiteMode = process.env.COOKIE_CROSS_SITE === 'true';
    const isProd = isStrictRuntimeMode();
    const enforceStrictProtocol = crossSiteMode || isProd;

    const trustedProto = resolveTrustedProtocol(req);
    const requestProtocol = `${trustedProto}:`;

    // Khi bật COOKIE_CROSS_SITE=true hoặc ở Production, giao thức của Origin bắt buộc phải khớp với giao thức thật của request
    if (enforceStrictProtocol && parsed.protocol.toLowerCase() !== requestProtocol) {
      return false;
    }

    const originHostRaw = parsed.host.toLowerCase();
    const originHostNormalized = normalizeHostValue(originHostRaw);
    const originFull = parsed.origin.toLowerCase();

    const { rawHosts: serverHostsRaw, normalizedHosts: serverHostsNormalized } =
      resolveTrustedServerHosts(req);

    // 1. Ưu tiên kiểm tra: Origin trùng với host của chính server
    if (
      serverHostsRaw.has(originHostRaw) ||
      serverHostsNormalized.has(originHostNormalized)
    ) {
      return true;
    }

    // 2. Danh sách bổ sung từ ALLOWED_ORIGINS và APP_URL (tuyệt đối bỏ qua "*")
    const supplementalOrigins = new Set<string>();
    const supplementalHosts = new Set<string>();

    const envSources = [process.env.ALLOWED_ORIGINS, process.env.APP_URL]
      .filter(Boolean)
      .join(',')
      .split(',');

    for (const src of envSources) {
      const s = src.trim();
      if (!s || s === '*' || s.includes('*')) continue;
      try {
        const u = new URL(s);
        if (enforceStrictProtocol && u.protocol.toLowerCase() !== requestProtocol) {
          continue;
        }
        supplementalOrigins.add(u.origin.toLowerCase());
        supplementalHosts.add(u.host.toLowerCase());
        supplementalHosts.add(normalizeHostValue(u.host));
      } catch {
        const lowerHost = s.toLowerCase();
        supplementalHosts.add(lowerHost);
        supplementalHosts.add(normalizeHostValue(lowerHost));
      }
    }

    if (
      supplementalOrigins.has(originFull) ||
      supplementalHosts.has(originHostRaw) ||
      supplementalHosts.has(originHostNormalized)
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

const LARGE_BODY_ROUTES = new Set([
  '/api/upload',
  '/api/products/visual-search',
  '/api/products/search-by-image',
  '/api/visual-search',
]);

/**
 * Khởi tạo Express App độc lập (dùng chung cho cả Server chính và bộ kiểm thử tự động)
 */
export function createApp() {
  // Kiểm tra chốt chặn cấu hình an toàn trước khi khởi tạo app
  assertEnvironmentSecurityConfig();

  const app = express();

  // 1. Cấu hình số bước reverse proxy tin cậy (mặc định 1, qua TRUST_PROXY_HOPS; tuyệt đối không dùng true)
  const trustProxyHops = getTrustProxyHops();
  app.set('trust proxy', trustProxyHops);

  const isProd = isStrictRuntimeMode();

  const frameAncestors = resolveCspFrameAncestors(isProd);
  const supabaseOrigin = resolveSupabaseCspOrigin();
  const extraImgHosts = resolveExtraImgHosts();

  const scriptSrcDirective = isProd
    ? ["'self'"]
    : ["'self'", "'unsafe-inline'", "'unsafe-eval'"];

  const connectSrcDirective = [
    "'self'",
    ...(supabaseOrigin ? [supabaseOrigin] : []),
    'https://api.vietqr.io',
    ...(isProd ? [] : ['ws:', 'wss:']),
  ];

  const imgSrcDirective = Array.from(
    new Set([
      "'self'",
      'data:',
      'blob:',
      ...(supabaseOrigin ? [supabaseOrigin] : []),
      'https://img.vietqr.io',
      'https://api.vietqr.io',
      ...(isProd
        ? []
        : [
            'https://images.unsplash.com',
            'https://picsum.photos',
            'https://fastly.picsum.photos',
          ]),
      ...extraImgHosts,
    ])
  );

  // 2. Thiết lập HTTP Security Headers bằng Helmet
  // - Content-Security-Policy phù hợp với Google Fonts, đúng host trong SUPABASE_URL, VietQR
  // - Ở strict production: script-src chỉ 'self' (bỏ 'unsafe-inline' và 'unsafe-eval'), connect-src bỏ ws: wss:, img-src chỉ bật Unsplash/Picsum ở preview hoặc khi khai báo CSP_EXTRA_IMG_HOSTS
  // - X-XSS-Protection: 0 (mặc định chuẩn của Helmet)
  // - HSTS bật ở Production
  // - frame-ancestors: 'self' ở Production, cho phép FRAME_ANCESTORS ở bản chạy thử
  app.use(
    helmet({
      xXssProtection: true, // Đặt X-XSS-Protection: 0
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: isProd
        ? {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true,
          }
        : false,
      frameguard: isProd ? { action: 'sameorigin' } : false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: scriptSrcDirective,
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: imgSrcDirective,
          connectSrc: connectSrcDirective,
          frameAncestors,
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          ...(isProd ? { upgradeInsecureRequests: [] } : {}),
        },
      },
    })
  );

  // 3. Middleware chuẩn hóa mọi phản hồi lỗi API về dạng thống nhất { error: { code, message } }
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    res.json = function (body: any) {
      const cleanPath = req.path.replace(/\/+$/, '') || '/';
      if (
        cleanPath !== '/health' &&
        res.statusCode >= 400 &&
        body &&
        typeof body === 'object' &&
        !Array.isArray(body)
      ) {
        const existingErrObj =
          body.error && typeof body.error === 'object' ? body.error : null;
        const code = String(
          existingErrObj?.code ||
            body.code ||
            (typeof body.error === 'string' && /^[A-Z0-9_]+$/.test(body.error)
              ? body.error
              : defaultErrorCodeForStatus(res.statusCode))
        );
        const message = String(
          existingErrObj?.message ||
            body.message ||
            (typeof body.error === 'string' ? body.error : 'Đã xảy ra lỗi xử lý yêu cầu')
        );
        body.success = false;
        body.code = code;
        body.message = message;
        body.error = { code, message };
      }
      return originalJson(body);
    };
    next();
  });

  // 4. Middleware chống CSRF bằng kiểm tra Origin / Referer cho mọi request thay đổi dữ liệu
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const mutatingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    if (!mutatingMethods.includes(req.method.toUpperCase())) {
      return next();
    }

    // Các endpoint server-to-server dùng khóa bí mật riêng (Webhook thanh toán / Cron dọn dẹp)
    if (req.path === '/payments/webhook' || req.path === '/tasks/cron-cleanup') {
      return next();
    }

    const crossSiteMode = process.env.COOKIE_CROSS_SITE === 'true';
    const originHeader = ((req.headers.origin as string) || '').trim();
    const refererHeader = ((req.headers.referer as string) || '').trim();

    if (crossSiteMode) {
      // Khi COOKIE_CROSS_SITE=true: mọi request thay đổi dữ liệu BẮT BUỘC phải có header Origin hợp lệ
      if (!originHeader) {
        console.warn(
          `[CSRF BLOCKED] Từ chối request ${req.method} ${req.originalUrl} khi COOKIE_CROSS_SITE=true do thiếu header Origin (Host="${req.headers.host || ''}", X-Forwarded-Host="${req.headers['x-forwarded-host'] || ''}")`
        );
        return res.status(403).json({
          success: false,
          code: 'CSRF_MISSING_ORIGIN',
          message: 'Yêu cầu thay đổi dữ liệu bắt buộc phải có header Origin hợp lệ khi bật COOKIE_CROSS_SITE',
          error: {
            code: 'CSRF_MISSING_ORIGIN',
            message: 'Yêu cầu thay đổi dữ liệu bắt buộc phải có header Origin hợp lệ khi bật COOKIE_CROSS_SITE',
          },
        });
      }

      if (!isOriginTrusted(originHeader, req)) {
        const trustedProto = resolveTrustedProtocol(req);
        console.warn(
          `[CSRF BLOCKED] Từ chối request ${req.method} ${req.originalUrl} vì Origin không hợp lệ hoặc lệch giao thức: "${originHeader}" (trustedProto="${trustedProto}", expressProto="${req.protocol}", Host="${req.headers.host || ''}", X-Forwarded-Host="${req.headers['x-forwarded-host'] || ''}")`
        );
        return res.status(403).json({
          success: false,
          code: 'CSRF_ORIGIN_MISMATCH',
          message: 'Yêu cầu bị từ chối do nguồn gốc (Origin) hoặc giao thức không hợp lệ (CSRF Protection)',
          error: {
            code: 'CSRF_ORIGIN_MISMATCH',
            message: 'Yêu cầu bị từ chối do nguồn gốc (Origin) hoặc giao thức không hợp lệ (CSRF Protection)',
          },
        });
      }

      return next();
    }

    // Khi COOKIE_CROSS_SITE tắt: giữ nguyên hành vi kiểm tra Origin/Referer nếu được gửi lên
    const sourceToVerify = originHeader || refererHeader;
    if (sourceToVerify) {
      if (!isOriginTrusted(sourceToVerify, req)) {
        console.warn(
          `[CSRF BLOCKED] Từ chối request ${req.method} ${req.originalUrl} vì Origin/Referer không hợp lệ: "${sourceToVerify}" (Host="${req.headers.host || ''}", X-Forwarded-Host="${req.headers['x-forwarded-host'] || ''}")`
        );
        return res.status(403).json({
          success: false,
          code: 'CSRF_ORIGIN_MISMATCH',
          message: 'Yêu cầu bị từ chối do nguồn gốc (Origin/Referer) không hợp lệ (CSRF Protection)',
          error: {
            code: 'CSRF_ORIGIN_MISMATCH',
            message: 'Yêu cầu bị từ chối do nguồn gốc (Origin/Referer) không hợp lệ (CSRF Protection)',
          },
        });
      }
    }

    next();
  });

  // 5. Giới hạn kích thước body và lưu req.rawBody nguyên bản để xác thực chữ ký HMAC-SHA256 của Webhook:
  // - Mặc định 100kb cho toàn bộ API thông thường
  // - Chỉ các route upload ảnh và tìm kiếm bằng ảnh mới được nhận tối đa 8MB
  const captureRawBody = (req: Request, _res: Response, buf: Buffer) => {
    if (buf && buf.length > 0) {
      (req as any).rawBody = buf.toString('utf8');
    }
  };
  const jsonDefaultParser = express.json({ limit: '100kb', verify: captureRawBody });
  const jsonLargeParser = express.json({ limit: '8mb', verify: captureRawBody });
  const urlencodedDefaultParser = express.urlencoded({ extended: true, limit: '100kb' });
  const urlencodedLargeParser = express.urlencoded({ extended: true, limit: '8mb' });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const cleanPath = req.path.replace(/\/+$/, '') || '/';
    if (LARGE_BODY_ROUTES.has(cleanPath)) {
      return jsonLargeParser(req, res, next);
    }
    return jsonDefaultParser(req, res, next);
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const cleanPath = req.path.replace(/\/+$/, '') || '/';
    if (LARGE_BODY_ROUTES.has(cleanPath)) {
      return urlencodedLargeParser(req, res, next);
    }
    return urlencodedDefaultParser(req, res, next);
  });

  app.use(cookieParser());

  // Gắn toàn bộ API Routes tại /api
  app.use('/api', apiRouter);

  // Error handler bắt lỗi vượt giới hạn kích thước body (413 Payload Too Large) và lỗi cú pháp JSON
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413 || err.statusCode === 413)) {
      return res.status(413).json({
        success: false,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Kích thước dữ liệu gửi lên vượt quá giới hạn cho phép',
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Kích thước dữ liệu gửi lên vượt quá giới hạn cho phép',
        },
      });
    }
    if (err && err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_JSON',
        message: 'Dữ liệu JSON gửi lên không đúng cú pháp',
        error: {
          code: 'INVALID_JSON',
          message: 'Dữ liệu JSON gửi lên không đúng cú pháp',
        },
      });
    }
    next(err);
  });

  return app;
}
