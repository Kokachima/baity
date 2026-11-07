import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { Request, Response, NextFunction, CookieOptions } from 'express';
import { queryRows } from '../db/index.ts';
import { sql } from 'drizzle-orm';
import { isStrictRuntimeMode } from '../config/runtimeMode.ts';

export const AUTH_COOKIE_NAME = 'baity_token';
const CUSTOMER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày cho khách hàng
const ADMIN_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 giờ cho quản trị viên

let ephemeralDevJwtSecret: string | null = null;
let hasWarnedMissingJwtSecret = false;

/**
 * Đặt lại khóa JWT tạm thời trong bộ nhớ (phục vụ kiểm thử tự động)
 */
export function resetEphemeralJwtSecretForTest(): void {
  ephemeralDevJwtSecret = null;
  hasWarnedMissingJwtSecret = false;
}

/**
 * Lấy JWT_SECRET an toàn:
 * - Ở chế độ strict production:
 *   bắt buộc phải có biến môi trường JWT_SECRET tối thiểu 16 ký tự, nếu thiếu sẽ báo lỗi ngay lập tức.
 * - Ở môi trường Dev/Test khi thiếu JWT_SECRET: tuyệt đối không dùng chuỗi mặc định cố định trong mã nguồn;
 *   tự sinh khóa ngẫu nhiên 32 bytes (64 ký tự hex) trong bộ nhớ lúc khởi chạy và ghi cảnh báo.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  const isProd = isStrictRuntimeMode();

  if (isProd && (!secret || secret.trim().length < 16)) {
    throw new Error(
      'CRITICAL SECURITY ERROR: Biến môi trường JWT_SECRET bắt buộc phải được cấu hình (tối thiểu 16 ký tự) trong môi trường Production!'
    );
  }

  if (secret && secret.trim().length > 0) {
    return secret.trim();
  }

  if (!ephemeralDevJwtSecret) {
    ephemeralDevJwtSecret = crypto.randomBytes(32).toString('hex');
  }

  if (!hasWarnedMissingJwtSecret) {
    hasWarnedMissingJwtSecret = true;
    console.warn(
      '⚠️ [AUTH WARNING] Biến môi trường JWT_SECRET chưa được cấu hình. Hệ thống đã sinh khóa ngẫu nhiên tạm thời trong bộ nhớ cho phiên dev/test hiện tại.'
    );
  }

  return ephemeralDevJwtSecret;
}

export interface JwtPayload {
  id: string;
  userId?: string;
  email?: string;
  role: 'customer' | 'admin';
  issuedAtMs?: number;
  iat?: number;
  exp?: number;
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    fullName: string;
    email: string;
    phone: string | null;
    role: 'customer' | 'admin';
    avatarUrl: string | null;
    heightCm: number | null;
    weightKg: number | null;
  };
}

/**
 * Phân tích chuỗi Cookie header thành object key-value
 */
export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

/**
 * Kiểm tra có đang bật chế độ cookie cross-site cho bản chạy thử trong iframe (AI Studio preview) hay không.
 * - Khi COOKIE_CROSS_SITE === 'true': dùng SameSite=None; Secure; Partitioned để trình duyệt trong iframe khác tên miền lưu và gửi lại cookie.
 * - Ở Production mặc định (COOKIE_CROSS_SITE !== 'true'): giữ nguyên SameSite=Lax; Secure.
 */
export function isCrossSiteCookieMode(): boolean {
  return process.env.COOKIE_CROSS_SITE === 'true';
}

/**
 * Tạo cấu hình tùy chọn Cookie chuẩn bảo mật cho cả xác thực (baity_token) và phiên giỏ hàng (session_id / baity_session_id)
 */
export function buildSessionCookieOptions(maxAgeMs?: number): CookieOptions {
  const crossSite = isCrossSiteCookieMode();
  const isProd = isStrictRuntimeMode();

  const options: CookieOptions = {
    httpOnly: true,
    secure: crossSite ? true : isProd,
    sameSite: crossSite ? 'none' : 'lax',
    path: '/',
  };

  if (crossSite) {
    (options as any).partitioned = true;
  }

  if (typeof maxAgeMs === 'number') {
    options.maxAge = maxAgeMs;
  }

  return options;
}

/**
 * Tạo JWT token cho người dùng:
 * - Cố định thuật toán HS256
 * - Thời hạn: 12h cho quản trị viên (admin), 7d cho khách hàng (customer)
 * - Kèm issuedAtMs chính xác tới từng mili-giây để so sánh an toàn với password_changed_at
 */
export function generateToken(payload: {
  id?: string;
  userId?: string;
  email?: string;
  role: 'customer' | 'admin';
  issuedAtMs?: number;
}): string {
  const uid = payload.id || payload.userId || '';
  const issuedAtMs = payload.issuedAtMs ?? Date.now();
  const expiresIn = payload.role === 'admin' ? '12h' : '7d';

  return jwt.sign(
    {
      id: uid,
      userId: uid,
      email: payload.email,
      role: payload.role,
      issuedAtMs,
    },
    getJwtSecret(),
    {
      algorithm: 'HS256',
      expiresIn,
    }
  );
}

export const signToken = generateToken;

/**
 * Xác thực và giải mã JWT token (chỉ chấp nhận duy nhất thuật toán HS256)
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
    });
    if (!decoded || typeof decoded !== 'object') {
      return null;
    }
    return decoded as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Thiết lập httpOnly cookie chứa JWT (12h cho admin, 7d cho customer)
 */
export function setAuthCookie(res: Response, token: string, role?: 'customer' | 'admin') {
  let effectiveRole = role;
  if (!effectiveRole) {
    const decoded = verifyToken(token);
    effectiveRole = decoded?.role;
  }
  const maxAgeMs = effectiveRole === 'admin' ? ADMIN_MAX_AGE_MS : CUSTOMER_MAX_AGE_MS;
  res.cookie(AUTH_COOKIE_NAME, token, buildSessionCookieOptions(maxAgeMs));
}

/**
 * Xóa httpOnly cookie khi đăng xuất
 */
export function clearAuthCookie(res: Response) {
  res.clearCookie(AUTH_COOKIE_NAME, buildSessionCookieOptions());
}

/**
 * Sinh chuỗi token ngẫu nhiên 32 bytes (64 ký tự hex) dùng cho khôi phục mật khẩu
 */
export function generateRandomToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Băm SHA-256 chuỗi token để lưu trong CSDL (không bao giờ lưu token thô)
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// ==========================================
// BỘ GIỚI HẠN TỐC ĐỘ ĐĂNG NHẬP (BOUNDED IN-MEMORY RATE LIMITER)
// - Khóa tạm thời 15 phút sau 5 lần đăng nhập sai liên tiếp
// - Tự động dọn dẹp các bản ghi hết hạn và giới hạn tối đa MAX_LOGIN_RATE_LIMIT_ENTRIES phần tử trong RAM
// ==========================================
interface RateLimitRecord {
  count: number;
  lockedUntil: number | null;
  updatedAt: number;
}

const loginAttempts = new Map<string, RateLimitRecord>();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 phút
export const MAX_LOGIN_RATE_LIMIT_ENTRIES = 10000;
let lastLoginPruneTime = 0;

function pruneLoginAttempts(now: number, maxEntries = MAX_LOGIN_RATE_LIMIT_ENTRIES): void {
  // Dọn các mục đã hết hạn khóa hoặc quá 15 phút không phát sinh thêm lỗi
  if (now - lastLoginPruneTime >= 30_000 || loginAttempts.size >= maxEntries) {
    lastLoginPruneTime = now;
    for (const [k, rec] of loginAttempts.entries()) {
      const expiredLock = rec.lockedUntil !== null && rec.lockedUntil <= now;
      const staleWindow = rec.lockedUntil === null && now - rec.updatedAt >= LOCKOUT_DURATION_MS;
      if (expiredLock || staleWindow) {
        loginAttempts.delete(k);
      }
    }
  }

  // Nếu vẫn vượt trần bộ nhớ, loại bỏ các mục cũ nhất theo thứ tự chèn của Map (FIFO/LRU)
  while (loginAttempts.size > maxEntries) {
    const oldestKey = loginAttempts.keys().next().value;
    if (oldestKey === undefined) break;
    loginAttempts.delete(oldestKey);
  }
}

export function getLoginRateLimitSizeForTest(): number {
  return loginAttempts.size;
}

export function pruneLoginAttemptsWithCapForTest(maxEntries: number): void {
  pruneLoginAttempts(Date.now(), maxEntries);
}

function getRateLimitKey(ip: string, email: string): string {
  return `${ip.trim()}_${email.trim().toLowerCase()}`;
}

function getIpOnlyRateLimitKey(ip: string): string {
  return `ip_${ip.trim()}`;
}

function getEmailOnlyRateLimitKey(email: string): string {
  return `email_${email.trim().toLowerCase()}`;
}

export function checkLoginRateLimit(
  ip: string,
  email: string
): { allowed: boolean; waitMinutes?: number } {
  const now = Date.now();
  pruneLoginAttempts(now);

  const keys = [
    getRateLimitKey(ip, email),
    getIpOnlyRateLimitKey(ip),
    getEmailOnlyRateLimitKey(email),
  ];

  for (const key of keys) {
    const record = loginAttempts.get(key);
    if (!record) continue;

    if (record.lockedUntil) {
      const remainingMs = record.lockedUntil - now;
      if (remainingMs > 0) {
        return {
          allowed: false,
          waitMinutes: Math.max(1, Math.ceil(remainingMs / 60000)),
        };
      }
      loginAttempts.delete(key);
    } else if (now - record.updatedAt >= LOCKOUT_DURATION_MS) {
      loginAttempts.delete(key);
    }
  }

  return { allowed: true };
}

export function recordFailedLogin(ip: string, email: string): void {
  const now = Date.now();
  pruneLoginAttempts(now);

  const keys = [
    getRateLimitKey(ip, email),
    getIpOnlyRateLimitKey(ip),
    getEmailOnlyRateLimitKey(email),
  ];

  for (const key of keys) {
    const current = loginAttempts.get(key) || { count: 0, lockedUntil: null, updatedAt: now };
    current.count += 1;
    current.updatedAt = now;

    if (current.count >= MAX_FAILED_ATTEMPTS) {
      current.lockedUntil = now + LOCKOUT_DURATION_MS;
    }

    // Xóa rồi set lại để cập nhật thứ tự mới nhất trong Map
    loginAttempts.delete(key);
    loginAttempts.set(key, current);
  }

  pruneLoginAttempts(now);
}

export function resetLoginRateLimit(ip: string, email?: string): void {
  if (!ip && !email) {
    loginAttempts.clear();
    return;
  }
  loginAttempts.delete(getIpOnlyRateLimitKey(ip));
  if (email) {
    loginAttempts.delete(getRateLimitKey(ip, email));
    loginAttempts.delete(getEmailOnlyRateLimitKey(email));
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Middleware: Đính kèm thông tin người dùng vào req.user nếu có cookie hợp lệ.
 * - Chỉ coi là chưa đăng nhập (next()) khi không có token, token sai chữ ký/hết hạn, hoặc đã bị thu hồi.
 * - Nếu truy vấn CSDL gặp lỗi hạ tầng (DB lỗi/mất kết nối), trả ngay HTTP 503 DB_UNAVAILABLE để không báo nhầm 401.
 */
export async function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  let decoded: JwtPayload | null = null;
  let targetUserId = '';

  try {
    const cookies = req.cookies || parseCookies(req.headers.cookie);
    const token = cookies?.[AUTH_COOKIE_NAME];
    if (!token) return next();

    decoded = verifyToken(token);
    if (!decoded) return next();

    targetUserId = String(decoded.id || decoded.userId || '').trim();
    if (!targetUserId || !UUID_REGEX.test(targetUserId)) {
      return next();
    }
  } catch {
    return next();
  }

  try {
    const rows = await queryRows<{
      id: string;
      full_name: string;
      email: string;
      phone: string | null;
      role: 'customer' | 'admin';
      avatar_url: string | null;
      height_cm: number | null;
      weight_kg: number | null;
      password_changed_at: string | Date | null;
    }>(sql`
      SELECT id, full_name, email, phone, role, avatar_url, height_cm, weight_kg, password_changed_at
      FROM users
      WHERE id = ${targetUserId}::uuid
      LIMIT 1;
    `);

    if (rows.length > 0) {
      const u = rows[0];

      // Kiểm tra thu hồi phiên cũ khi người dùng đổi hoặc đặt lại mật khẩu
      if (u.password_changed_at) {
        const pwdChangedMs = new Date(u.password_changed_at).getTime();
        if (typeof decoded.issuedAtMs === 'number') {
          if (decoded.issuedAtMs < pwdChangedMs) {
            return next();
          }
        } else if (typeof decoded.iat === 'number') {
          if (decoded.iat * 1000 + 999 < pwdChangedMs) {
            return next();
          }
        }
      }

      req.user = {
        id: u.id,
        fullName: u.full_name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        avatarUrl: u.avatar_url,
        heightCm: u.height_cm,
        weightKg: u.weight_kg,
      };
    }
    return next();
  } catch (dbErr: any) {
    console.error(
      '[AUTH DB ERROR] Lỗi truy vấn cơ sở dữ liệu trong optionalAuth:',
      dbErr?.code || dbErr?.name || 'DB_UNAVAILABLE'
    );
    return res.status(503).json({
      success: false,
      code: 'DB_UNAVAILABLE',
      message: 'Hệ thống cơ sở dữ liệu đang tạm thời gián đoạn, vui lòng thử lại sau',
      error: {
        code: 'DB_UNAVAILABLE',
        message: 'Hệ thống cơ sở dữ liệu đang tạm thời gián đoạn, vui lòng thử lại sau',
      },
    });
  }
}

/**
 * Middleware: Bắt buộc đăng nhập mới được truy cập endpoint
 */
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  await optionalAuth(req, res, () => {});
  if (res.headersSent) return;

  if (!req.user) {
    return res.status(401).json({
      success: false,
      code: 'UNAUTHORIZED',
      message: 'Vui lòng đăng nhập để thực hiện hành động này',
      error: {
        code: 'UNAUTHORIZED',
        message: 'Vui lòng đăng nhập để thực hiện hành động này',
      },
    });
  }
  next();
}

/**
 * Middleware: Bắt buộc quyền Quản trị viên (Admin)
 */
export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  await optionalAuth(req, res, () => {});
  if (res.headersSent) return;

  if (!req.user) {
    return res.status(401).json({
      success: false,
      code: 'UNAUTHORIZED',
      message: 'Vui lòng đăng nhập để tiếp tục',
      error: {
        code: 'UNAUTHORIZED',
        message: 'Vui lòng đăng nhập để tiếp tục',
      },
    });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN_ADMIN_ONLY',
      message: 'Truy cập bị từ chối: Khu vực này chỉ dành cho Quản trị viên',
      error: {
        code: 'FORBIDDEN_ADMIN_ONLY',
        message: 'Truy cập bị từ chối: Khu vực này chỉ dành cho Quản trị viên',
      },
    });
  }
  next();
}

