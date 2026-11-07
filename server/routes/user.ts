import { Router, type Response } from 'express';
import { z } from 'zod';
import { queryRows } from '../db/index.ts';
import { sql } from 'drizzle-orm';
import { requireAuth, type AuthRequest } from '../services/auth.ts';

export const userRouter = Router();

// Áp dụng middleware requireAuth cho toàn bộ các route trong userRouter
userRouter.use(requireAuth);

export const VN_PHONE_REGEX = /^(0|\+84)(3|5|7|8|9)[0-9]{8}$/;

// Schema cập nhật hồ sơ cá nhân (hỗ trợ cập nhật toàn phần hoặc một phần - Partial Updates)
const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Họ tên phải có ít nhất 2 ký tự').max(100).optional(),
  phone: z
    .string()
    .trim()
    .regex(VN_PHONE_REGEX, 'Số điện thoại không hợp lệ (bắt đầu bằng 0 hoặc +84, đúng định dạng di động Việt Nam)')
    .optional(),
  avatarUrl: z.string().nullable().optional(),
  heightCm: z
    .number()
    .int('Chiều cao phải là số nguyên')
    .min(100, 'Chiều cao phải từ 100 cm trở lên')
    .max(230, 'Chiều cao không được vượt quá 230 cm')
    .nullable()
    .optional(),
  weightKg: z
    .number()
    .int('Cân nặng phải là số nguyên')
    .min(30, 'Cân nặng phải từ 30 kg trở lên')
    .max(200, 'Cân nặng không được vượt quá 200 kg')
    .nullable()
    .optional(),
});

// Khóa tuần tự hóa thao tác địa chỉ theo từng userId để chống race condition trên partial unique index is_default
const userAddressLocks = new Map<string, Promise<any>>();
async function withUserAddressLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = userAddressLocks.get(userId) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => {
    release = r;
  });
  userAddressLocks.set(userId, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (userAddressLocks.get(userId) === next) {
      userAddressLocks.delete(userId);
    }
  }
}

// Schema thêm/sửa địa chỉ (hỗ trợ địa chỉ hành chính 2 cấp Tỉnh/Thành phố + Phường/Xã; district cho phép null để tương thích dữ liệu cũ)
const addressSchema = z.object({
  receiverName: z.string().trim().min(2, 'Tên người nhận phải có ít nhất 2 ký tự').max(100),
  phone: z
    .string()
    .trim()
    .regex(VN_PHONE_REGEX, 'Số điện thoại không hợp lệ (bắt đầu bằng 0 hoặc +84, đúng định dạng di động Việt Nam)'),
  province: z.string().trim().min(1, 'Vui lòng chọn Tỉnh/Thành phố'),
  district: z.string().trim().nullable().optional(),
  ward: z.string().trim().min(1, 'Vui lòng chọn Phường/Xã'),
  streetAddress: z.string().trim().min(5, 'Địa chỉ chi tiết phải có ít nhất 5 ký tự'),
  isDefault: z.boolean().optional(),
});

/**
 * 1. LẤY HỒ SƠ CÁ NHÂN (GET /api/user/profile)
 */
userRouter.get('/profile', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const rows = await queryRows<any>(sql`
      SELECT id, full_name, email, phone, role, avatar_url, height_cm, weight_kg, created_at
      FROM users
      WHERE id = ${userId}
      LIMIT 1;
    `);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
    }

    const u = rows[0];
    res.json({
      success: true,
      data: {
        id: u.id,
        fullName: u.full_name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        avatarUrl: u.avatar_url,
        heightCm: u.height_cm,
        weightKg: u.weight_kg,
        createdAt: u.created_at,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Lỗi tải hồ sơ cá nhân', error: err.message });
  }
});

/**
 * 2. CẬP NHẬT HỒ SƠ CÁ NHÂN (PUT /api/user/profile)
 * - Kiểm tra miền giá trị chiều cao (100–230 cm) và cân nặng (30–200 kg)
 * - Hỗ trợ cập nhật một phần (Partial Updates): chỉ cập nhật các trường được gửi lên
 */
userRouter.put('/profile', async (req: AuthRequest, res: Response) => {
  try {
    const parseResult = profileSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || 'Dữ liệu hồ sơ không hợp lệ',
      });
    }

    const userId = req.user!.id;
    const currentRows = await queryRows<any>(sql`
      SELECT full_name, phone, avatar_url, height_cm, weight_kg
      FROM users
      WHERE id = ${userId}
      LIMIT 1;
    `);
    if (currentRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
    }

    const current = currentRows[0];
    const data = parseResult.data;

    const nextFullName = data.fullName !== undefined ? data.fullName : current.full_name;
    const nextPhone = data.phone !== undefined ? data.phone : current.phone;
    const nextAvatarUrl = data.avatarUrl !== undefined ? (data.avatarUrl || null) : current.avatar_url;
    const nextHeightCm = data.heightCm !== undefined ? data.heightCm : current.height_cm;
    const nextWeightKg = data.weightKg !== undefined ? data.weightKg : current.weight_kg;

    const rows = await queryRows<any>(sql`
      UPDATE users
      SET full_name = ${nextFullName},
          phone = ${nextPhone},
          avatar_url = ${nextAvatarUrl},
          height_cm = ${nextHeightCm},
          weight_kg = ${nextWeightKg}
      WHERE id = ${userId}
      RETURNING id, full_name, email, phone, role, avatar_url, height_cm, weight_kg;
    `);

    const updated = rows[0];
    res.json({
      success: true,
      message: 'Cập nhật thông tin hồ sơ thành công',
      data: {
        id: updated.id,
        fullName: updated.full_name,
        email: updated.email,
        phone: updated.phone,
        role: updated.role,
        avatarUrl: updated.avatar_url,
        heightCm: updated.height_cm,
        weightKg: updated.weight_kg,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Lỗi cập nhật hồ sơ', error: err.message });
  }
});

/**
 * 3. LẤY DANH SÁCH ĐỊA CHỈ (GET /api/user/addresses)
 */
userRouter.get('/addresses', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const rows = await queryRows<any>(sql`
      SELECT id, receiver_name, phone, province, district, ward, street_address, is_default, created_at
      FROM addresses
      WHERE user_id = ${userId}
      ORDER BY is_default DESC, created_at DESC;
    `);

    res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        receiverName: r.receiver_name,
        phone: r.phone,
        province: r.province,
        district: r.district,
        ward: r.ward,
        streetAddress: r.street_address,
        isDefault: r.is_default,
        createdAt: r.created_at,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Lỗi tải danh sách địa chỉ', error: err.message });
  }
});

/**
 * 4. THÊM ĐỊA CHỈ MỚI (POST /api/user/addresses)
 * - Nếu là địa chỉ đầu tiên hoặc isDefault=true, tự động đặt mặc định và bỏ mặc định các địa chỉ khác
 */
userRouter.post('/addresses', async (req: AuthRequest, res: Response) => {
  try {
    const parseResult = addressSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || 'Dữ liệu địa chỉ không hợp lệ',
      });
    }

    const userId = req.user!.id;
    const { receiverName, phone, province, district, ward, streetAddress } = parseResult.data;

    const r = await withUserAddressLock(userId, async () => {
      const existingCount = await queryRows<{ count: number }>(sql`
        SELECT count(*)::int as count FROM addresses WHERE user_id = ${userId};
      `);
      const isFirst = (existingCount[0]?.count || 0) === 0;
      const shouldBeDefault = isFirst || parseResult.data.isDefault === true;

      if (shouldBeDefault) {
        await queryRows(sql`
          UPDATE addresses SET is_default = false WHERE user_id = ${userId};
        `);
      }

      const inserted = await queryRows<any>(sql`
        INSERT INTO addresses (user_id, receiver_name, phone, province, district, ward, street_address, is_default)
        VALUES (${userId}, ${receiverName}, ${phone}, ${province}, ${district || null}, ${ward}, ${streetAddress}, ${shouldBeDefault})
        RETURNING id, receiver_name, phone, province, district, ward, street_address, is_default, created_at;
      `);
      return inserted[0];
    });

    res.status(201).json({
      success: true,
      message: 'Thêm địa chỉ giao hàng thành công',
      data: {
        id: r.id,
        receiverName: r.receiver_name,
        phone: r.phone,
        province: r.province,
        district: r.district,
        ward: r.ward,
        streetAddress: r.street_address,
        isDefault: r.is_default,
        createdAt: r.created_at,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Lỗi thêm địa chỉ', error: err.message });
  }
});

/**
 * 5. CẬP NHẬT ĐỊA CHỈ (PUT /api/user/addresses/:id)
 * - Kiểm tra quyền sở hữu (address phải thuộc về user_id của người đăng nhập)
 */
userRouter.put('/addresses/:id', async (req: AuthRequest, res: Response) => {
  try {
    const addressId = req.params.id;
    const userId = req.user!.id;

    // Kiểm tra quyền sở hữu
    const existing = await queryRows<{ id: string; is_default: boolean }>(sql`
      SELECT id, is_default FROM addresses WHERE id = ${addressId} AND user_id = ${userId} LIMIT 1;
    `);

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Địa chỉ không tồn tại hoặc bạn không có quyền sửa' });
    }

    const parseResult = addressSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || 'Dữ liệu địa chỉ không hợp lệ',
      });
    }

    const { receiverName, phone, province, district, ward, streetAddress } = parseResult.data;
    const isDefault = parseResult.data.isDefault ?? existing[0].is_default;

    if (isDefault) {
      await queryRows(sql`
        UPDATE addresses SET is_default = false WHERE user_id = ${userId};
      `);
    }

    const updated = await queryRows<any>(sql`
      UPDATE addresses
      SET receiver_name = ${receiverName},
          phone = ${phone},
          province = ${province},
          district = ${district || null},
          ward = ${ward},
          street_address = ${streetAddress},
          is_default = ${isDefault}
      WHERE id = ${addressId} AND user_id = ${userId}
      RETURNING id, receiver_name, phone, province, district, ward, street_address, is_default, created_at;
    `);

    const r = updated[0];
    res.json({
      success: true,
      message: 'Cập nhật địa chỉ thành công',
      data: {
        id: r.id,
        receiverName: r.receiver_name,
        phone: r.phone,
        province: r.province,
        district: r.district,
        ward: r.ward,
        streetAddress: r.street_address,
        isDefault: r.is_default,
        createdAt: r.created_at,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Lỗi cập nhật địa chỉ', error: err.message });
  }
});

/**
 * 6. XÓA ĐỊA CHỈ (DELETE /api/user/addresses/:id)
 * - Kiểm tra quyền sở hữu
 * - Nếu xóa địa chỉ mặc định, tự động chuyển địa chỉ còn lại mới nhất thành mặc định
 */
userRouter.delete('/addresses/:id', async (req: AuthRequest, res: Response) => {
  try {
    const addressId = req.params.id;
    const userId = req.user!.id;

    // Kiểm tra quyền sở hữu
    const existing = await queryRows<{ id: string; is_default: boolean }>(sql`
      SELECT id, is_default FROM addresses WHERE id = ${addressId} AND user_id = ${userId} LIMIT 1;
    `);

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Địa chỉ không tồn tại hoặc bạn không có quyền xóa' });
    }

    const wasDefault = existing[0].is_default;

    await queryRows(sql`
      DELETE FROM addresses WHERE id = ${addressId} AND user_id = ${userId};
    `);

    // Nếu vừa xóa địa chỉ mặc định, nâng địa chỉ kế tiếp thành mặc định
    if (wasDefault) {
      const remaining = await queryRows<{ id: string }>(sql`
        SELECT id FROM addresses WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 1;
      `);
      if (remaining.length > 0) {
        await queryRows(sql`
          UPDATE addresses SET is_default = true WHERE id = ${remaining[0].id};
        `);
      }
    }

    res.json({ success: true, message: 'Đã xóa địa chỉ thành công' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Lỗi xóa địa chỉ', error: err.message });
  }
});

/**
 * 7. ĐẶT LÀM ĐỊA CHỈ MẶC ĐỊNH (PUT /api/user/addresses/:id/set-default)
 */
userRouter.put('/addresses/:id/set-default', async (req: AuthRequest, res: Response) => {
  try {
    const addressId = req.params.id;
    const userId = req.user!.id;

    const existing = await queryRows<{ id: string }>(sql`
      SELECT id FROM addresses WHERE id = ${addressId} AND user_id = ${userId} LIMIT 1;
    `);

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: 'Địa chỉ không tồn tại hoặc bạn không có quyền chỉnh sửa' });
    }

    // Reset toàn bộ về false và bật địa chỉ này lên true một cách tuần tự theo userId
    await withUserAddressLock(userId, async () => {
      await queryRows(sql`
        UPDATE addresses SET is_default = false WHERE user_id = ${userId};
      `);
      await queryRows(sql`
        UPDATE addresses SET is_default = true WHERE id = ${addressId} AND user_id = ${userId};
      `);
    });

    res.json({ success: true, message: 'Đã đặt làm địa chỉ mặc định thành công' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Lỗi thiết lập địa chỉ mặc định', error: err.message });
  }
});
