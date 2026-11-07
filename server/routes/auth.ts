import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { queryRows } from '../db/index.ts';
import { sql } from 'drizzle-orm';
import {
  generateToken,
  setAuthCookie,
  clearAuthCookie,
  generateRandomToken,
  hashToken,
  checkLoginRateLimit,
  recordFailedLogin,
  resetLoginRateLimit,
  requireAuth,
  optionalAuth,
  type AuthRequest,
} from '../services/auth.ts';
import { sendPasswordResetEmail } from '../services/email.ts';
import { getGuestSessionIdFromReq, mergeGuestCartIntoUserCart } from './cart.ts';
import { VN_PHONE_REGEX } from './user.ts';

export const authRouter = Router();

// Schema kiểm tra đầu vào đăng ký
const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Họ tên phải có ít nhất 2 ký tự').max(100),
  email: z.string().trim().email('Địa chỉ email không đúng định dạng').max(150),
  phone: z.string().trim().regex(VN_PHONE_REGEX, 'Số điện thoại không hợp lệ'),
  password: z.string().min(8, 'Mật khẩu phải có tối thiểu 8 ký tự'),
});

// Schema kiểm tra đăng nhập
const loginSchema = z.object({
  email: z.string().trim().email('Email không hợp lệ'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});

/**
 * 1. ĐĂNG KÝ TÀI KHOẢN (POST /api/auth/register)
 * - Server luôn gán role = 'customer' (bỏ qua mọi giá trị role gửi lên)
 * - Email lưu chữ thường, kiểm tra trùng không phân biệt hoa thường
 * - Mật khẩu tối thiểu 8 ký tự, băm bcrypt
 */
authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || 'Dữ liệu không hợp lệ',
      });
    }

    const { fullName, phone, password } = parseResult.data;
    const normalizedEmail = parseResult.data.email.toLowerCase();

    // Kiểm tra trùng email (không phân biệt hoa thường)
    const existing = await queryRows<{ id: string }>(sql`
      SELECT id FROM users WHERE LOWER(email) = ${normalizedEmail} LIMIT 1;
    `);

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Địa chỉ email này đã được sử dụng. Vui lòng đăng nhập hoặc chọn email khác.',
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Luôn bắt buộc role là 'customer' ở phía server
    const rows = await queryRows<any>(sql`
      INSERT INTO users (full_name, email, phone, password_hash, role, password_changed_at)
      VALUES (${fullName}, ${normalizedEmail}, ${phone}, ${passwordHash}, 'customer', NOW())
      RETURNING id, full_name, email, phone, role, avatar_url, height_cm, weight_kg, password_changed_at;
    `);

    const newUser = rows[0];
    const regChangedMs = newUser.password_changed_at ? new Date(newUser.password_changed_at).getTime() : Date.now();
    const token = generateToken({
      id: newUser.id,
      role: 'customer',
      issuedAtMs: Math.max(Date.now(), regChangedMs),
    });
    setAuthCookie(res, token);

    // Gộp giỏ hàng của khách vãng lai (nếu có cookie session_id) vào tài khoản mới đăng ký
    const guestSessionId = getGuestSessionIdFromReq(req);
    if (guestSessionId) {
      await mergeGuestCartIntoUserCart(guestSessionId, newUser.id);
    }

    res.status(201).json({
      success: true,
      message: 'Đăng ký tài khoản thành công',
      user: {
        id: newUser.id,
        fullName: newUser.full_name,
        email: newUser.email,
        phone: newUser.phone,
        role: newUser.role,
        avatarUrl: newUser.avatar_url,
        heightCm: newUser.height_cm,
        weightKg: newUser.weight_kg,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Lỗi đăng ký tài khoản', error: err.message });
  }
});

/**
 * 2. ĐĂNG NHẬP (POST /api/auth/login)
 * - Rate limit theo IP và Email (tối đa 5 lần thử sai / 15 phút)
 * - Cookie httpOnly, SameSite=lax, Secure ở production
 * - Thông báo lỗi chung (không tiết lộ email có tồn tại hay không)
 */
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập đầy đủ email và mật khẩu hợp lệ',
      });
    }

    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const normalizedEmail = parseResult.data.email.toLowerCase();
    const { password } = parseResult.data;

    // Kiểm tra Rate Limit chống brute-force
    const rateCheck = checkLoginRateLimit(clientIp, normalizedEmail);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        message: `Tài khoản hoặc IP đã thử đăng nhập thất bại quá nhiều lần. Vui lòng chờ ${rateCheck.waitMinutes} phút trước khi thử lại.`,
      });
    }

    // Tra cứu người dùng bằng email chữ thường
    const rows = await queryRows<any>(sql`
      SELECT id, full_name, email, phone, password_hash, role, avatar_url, height_cm, weight_kg, password_changed_at
      FROM users
      WHERE LOWER(email) = ${normalizedEmail}
      LIMIT 1;
    `);

    if (rows.length === 0) {
      recordFailedLogin(clientIp, normalizedEmail);
      // Dummy compare để chống side-channel timing attack
      await bcrypt.compare(password, '$2a$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUV0123456789');
      return res.status(401).json({
        success: false,
        message: 'Email hoặc mật khẩu không chính xác',
      });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      recordFailedLogin(clientIp, normalizedEmail);
      return res.status(401).json({
        success: false,
        message: 'Email hoặc mật khẩu không chính xác',
      });
    }

    // Đăng nhập thành công -> Reset rate limit
    resetLoginRateLimit(clientIp, normalizedEmail);

    const loginChangedMs = user.password_changed_at ? new Date(user.password_changed_at).getTime() : Date.now();
    const token = generateToken({
      id: user.id,
      role: user.role,
      issuedAtMs: Math.max(Date.now(), loginChangedMs),
    });
    setAuthCookie(res, token);

    // Gộp giỏ hàng của khách vãng lai (nếu có cookie session_id) vào tài khoản đăng nhập
    const guestSessionId = getGuestSessionIdFromReq(req);
    if (guestSessionId) {
      await mergeGuestCartIntoUserCart(guestSessionId, user.id);
    }

    res.json({
      success: true,
      message: 'Đăng nhập thành công',
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatarUrl: user.avatar_url,
        heightCm: user.height_cm,
        weightKg: user.weight_kg,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Lỗi đăng nhập', error: err.message });
  }
});

/**
 * 3. ĐĂNG XUẤT (POST /api/auth/logout)
 */
authRouter.post('/logout', (req: Request, res: Response) => {
  clearAuthCookie(res);
  res.json({ success: true, message: 'Đăng xuất thành công' });
});

/**
 * 4. LẤY THÔNG TIN TÀI KHOẢN ĐANG ĐĂNG NHẬP (GET /api/auth/me)
 */
authRouter.get('/me', optionalAuth, (req: AuthRequest, res: Response) => {
  if (!req.user) {
    return res.json({ success: true, authenticated: false, user: null });
  }
  res.json({
    success: true,
    authenticated: true,
    user: req.user,
  });
});

/**
 * 5. QUÊN MẬT KHẨU (POST /api/auth/forgot-password)
 * - Luôn trả cùng một thông báo dù email có tồn tại hay không
 * - Token ngẫu nhiên (32 bytes), lưu băm SHA-256, hết hạn 15 phút, dùng một lần
 * - Demo/Dev ghi link đặt lại vào console log
 */
authRouter.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const emailRaw = req.body.email;
    if (!emailRaw || typeof emailRaw !== 'string') {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp email hợp lệ' });
    }

    const normalizedEmail = emailRaw.toLowerCase().trim();

    const users = await queryRows<{ id: string }>(sql`
      SELECT id FROM users WHERE LOWER(email) = ${normalizedEmail} LIMIT 1;
    `);

    if (users.length > 0) {
      const rawToken = generateRandomToken();
      const tokenHash = hashToken(rawToken);

      // Cập nhật token băm và hạn 15 phút
      await queryRows(sql`
        UPDATE users
        SET reset_token_hash = ${tokenHash},
            reset_token_expiry = NOW() + INTERVAL '15 minutes'
        WHERE id = ${users[0].id};
      `);

      // Gửi email khôi phục (hoặc log demo nếu bật ENABLE_DEMO_EMAIL_LOG=true)
      const appUrl = process.env.APP_URL || 'http://localhost:3000';
      const resetUrl = `${appUrl}/reset-password?token=${rawToken}&email=${encodeURIComponent(normalizedEmail)}`;
      await sendPasswordResetEmail(normalizedEmail, resetUrl);
    }

    // Luôn trả về phản hồi đồng nhất để không tiết lộ sự tồn tại của email
    res.json({
      success: true,
      message: 'Nếu email tồn tại trong hệ thống Baity, chúng tôi đã gửi hướng dẫn đặt lại mật khẩu đến hộp thư của bạn. Vui lòng kiểm tra email.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Lỗi xử lý yêu cầu quên mật khẩu', error: err.message });
  }
});

/**
 * 6. ĐẶT LẠI MẬT KHẨU (POST /api/auth/reset-password)
 * - Kiểm tra token băm SHA-256 còn hiệu lực (chưa quá 15 phút)
 * - Đổi mật khẩu, xóa token đã dùng (dùng 1 lần)
 * - Cập nhật password_changed_at để làm mất hiệu lực toàn bộ phiên cũ
 */
authRouter.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, message: 'Thiếu mã token đặt lại mật khẩu' });
    }

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Mật khẩu mới phải có tối thiểu 8 ký tự' });
    }

    const hashedInputToken = hashToken(token);

    const rows = await queryRows<{ id: string }>(sql`
      SELECT id FROM users
      WHERE reset_token_hash = ${hashedInputToken}
        AND reset_token_expiry > NOW()
      LIMIT 1;
    `);

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn (chỉ có hiệu lực trong 15 phút)',
      });
    }

    const userId = rows[0].id;
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Cập nhật mật khẩu mới, xóa token và cập nhật password_changed_at
    await queryRows(sql`
      UPDATE users
      SET password_hash = ${newPasswordHash},
          reset_token_hash = NULL,
          reset_token_expiry = NULL,
          password_changed_at = NOW()
      WHERE id = ${userId};
    `);

    clearAuthCookie(res);

    res.json({
      success: true,
      message: 'Đặt lại mật khẩu thành công. Tất cả các phiên đăng nhập cũ đã được đăng xuất an toàn. Vui lòng đăng nhập lại.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Lỗi đặt lại mật khẩu', error: err.message });
  }
});

/**
 * 7. ĐỔI MẬT KHẨU KHI ĐANG ĐĂNG NHẬP (POST /api/auth/change-password)
 */
authRouter.post('/change-password', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user!.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Vui lòng cung cấp mật khẩu hiện tại và mật khẩu mới' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Mật khẩu mới phải có tối thiểu 8 ký tự' });
    }

    const userRows = await queryRows<any>(sql`
      SELECT password_hash FROM users WHERE id = ${userId} LIMIT 1;
    `);

    const isMatch = await bcrypt.compare(currentPassword, userRows[0].password_hash);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Mật khẩu hiện tại không đúng' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    const updatedRows = await queryRows<{ password_changed_at: string }>(sql`
      UPDATE users
      SET password_hash = ${newHash},
          password_changed_at = NOW()
      WHERE id = ${userId}
      RETURNING password_changed_at;
    `);

    // Cấp mới token cho phiên hiện tại
    const changedMs = updatedRows[0]?.password_changed_at
      ? new Date(updatedRows[0].password_changed_at).getTime()
      : Date.now();
    const freshToken = generateToken({
      id: userId,
      role: req.user!.role,
      issuedAtMs: Math.max(Date.now(), changedMs),
    });
    setAuthCookie(res, freshToken);

    res.json({
      success: true,
      message: 'Đổi mật khẩu thành công! Các thiết bị khác đã được đăng xuất an toàn.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Lỗi đổi mật khẩu', error: err.message });
  }
});
