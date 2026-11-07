import dotenv from 'dotenv';
dotenv.config({ override: true });
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { getDb, queryRows, closeDb } from '../server/db/index.ts';
import {
  isStrictRuntimeMode,
  validateAdminPasswordPolicy,
} from '../server/config/runtimeMode.ts';
import { loadContainerSecretsIfMissing } from './load-container-env.ts';

const DEV_SEED_EMAILS = ['admin@baity.vn', 'khach1@baity.vn', 'khach2@baity.vn'];

export interface SecureDevAccountsResult {
  rotatedDevEmails: string[];
  adminEmail: string | null;
  adminAction: 'created' | 'updated' | 'skipped';
  passwordPolicyPassed?: boolean;
}

export function hasSecureDevAccountsConfirmFlag(argv: string[] = process.argv): boolean {
  return argv.includes('--confirm');
}

/**
 * Khóa/đổi ngẫu nhiên mật khẩu các tài khoản mẫu dev (admin@baity.vn, khach1@baity.vn, khach2@baity.vn)
 * mà KHÔNG xóa bất kỳ dữ liệu liên quan nào (orders, addresses, reviews...).
 * Đồng thời tạo hoặc cập nhật tài khoản admin thật từ ADMIN_EMAIL và ADMIN_INITIAL_PASSWORD
 * khi mật khẩu đạt chính sách mật khẩu Admin (tối thiểu 12 ký tự, có chữ và số, không thuộc danh sách cấm).
 * - Từ chối chạy ở chế độ strict production.
 * - Khi chạy từ dòng lệnh (CLI), bắt buộc có cờ xác nhận `--confirm`.
 * - Tuyệt đối không in mật khẩu hoặc password hash ra log.
 */
export async function secureDevAccounts(options?: {
  adminEmail?: string;
  adminInitialPassword?: string;
  requireConfirmFlag?: boolean;
  argv?: string[];
}): Promise<SecureDevAccountsResult> {
  loadContainerSecretsIfMissing();
  const isProd = isStrictRuntimeMode();

  if (isProd) {
    throw new Error(
      '❌ FATAL: Script db:secure-dev-accounts bị từ chối chạy ở môi trường Production!'
    );
  }

  if (options?.requireConfirmFlag && !hasSecureDevAccountsConfirmFlag(options.argv ?? process.argv)) {
    throw new Error(
      '❌ THIẾU CỜ XÁC NHẬN: Đặt lại mật khẩu Admin/tài khoản mẫu là thao tác nhạy cảm. Vui lòng chạy kèm cờ xác nhận: npm run db:secure-dev-accounts -- --confirm'
    );
  }

  await getDb();
  const { initDatabase } = await import('../server/db/init.ts');
  await initDatabase();

  const rotatedDevEmails: string[] = [];

  for (const devEmail of DEV_SEED_EMAILS) {
    const existing = await queryRows<{ id: string; email: string }>(sql`
      SELECT id, email FROM users WHERE LOWER(email) = LOWER(${devEmail}) LIMIT 1;
    `);
    if (existing.length > 0) {
      // Sinh mật khẩu ngẫu nhiên 32 byte (64 ký tự hex) không thể đoán và cập nhật password_changed_at = NOW()
      // để vô hiệu hóa mọi JWT cũ đã cấp trước đó, đồng thời giữ nguyên 100% dữ liệu đơn hàng/địa chỉ liên quan.
      const randomSecret = crypto.randomBytes(32).toString('hex') + '!Aa9';
      const randomHash = await bcrypt.hash(randomSecret, 10);

      await queryRows(sql`
        UPDATE users
        SET
          password_hash = ${randomHash},
          password_changed_at = NOW()
        WHERE id = ${existing[0].id}::uuid;
      `);
      rotatedDevEmails.push(existing[0].email);
    }
  }

  const rawAdminEmail = (options?.adminEmail ?? process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const rawAdminPass = (options?.adminInitialPassword ?? process.env.ADMIN_INITIAL_PASSWORD ?? '').trim();

  let adminAction: 'created' | 'updated' | 'skipped' = 'skipped';
  let finalAdminEmail: string | null = null;

  const isSampleCustomerEmail = ['khach1@baity.vn', 'khach2@baity.vn'].includes(rawAdminEmail);
  const pwdCheck = validateAdminPasswordPolicy(rawAdminPass);

  if (rawAdminEmail && rawAdminPass && !isSampleCustomerEmail) {
    if (!pwdCheck.valid) {
      console.error(`❌ [ADMIN PASSWORD POLICY ERROR] ${pwdCheck.reason}`);
      return {
        rotatedDevEmails,
        adminEmail: null,
        adminAction: 'skipped',
        passwordPolicyPassed: false,
      };
    }

    const adminHash = await bcrypt.hash(rawAdminPass, 10);
    const existingAdmin = await queryRows<{ id: string; email: string }>(sql`
      SELECT id, email FROM users WHERE LOWER(email) = LOWER(${rawAdminEmail}) LIMIT 1;
    `);

    if (existingAdmin.length > 0) {
      await queryRows(sql`
        UPDATE users
        SET
          password_hash = ${adminHash},
          role = 'admin',
          password_changed_at = NOW()
        WHERE id = ${existingAdmin[0].id}::uuid;
      `);
      adminAction = 'updated';
      finalAdminEmail = existingAdmin[0].email;
    } else {
      await queryRows(sql`
        INSERT INTO users (full_name, email, phone, password_hash, role, password_changed_at)
        VALUES ('Quản Trị Viên Baity', ${rawAdminEmail}, '0909000999', ${adminHash}, 'admin', NOW());
      `);
      adminAction = 'created';
      finalAdminEmail = rawAdminEmail;
    }
  }

  return {
    rotatedDevEmails,
    adminEmail: finalAdminEmail,
    adminAction,
    passwordPolicyPassed: pwdCheck.valid,
  };
}

// Chạy trực tiếp từ CLI: `npm run db:secure-dev-accounts -- --confirm`
const isDirectExecution =
  process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/secure-dev-accounts.ts');

if (isDirectExecution) {
  secureDevAccounts({ requireConfirmFlag: true, argv: process.argv })
    .then((res) => {
      console.log(
        `✅ [db:secure-dev-accounts] Đã đổi ngẫu nhiên mật khẩu & thu hồi phiên cho ${res.rotatedDevEmails.length} tài khoản mẫu (${res.rotatedDevEmails.join(', ') || 'không có'}).`
      );
      if (res.adminAction !== 'skipped' && res.adminEmail) {
        console.log(
          `✅ [db:secure-dev-accounts] Tài khoản Admin (${res.adminEmail}): ${res.adminAction === 'created' ? 'Đã tạo mới' : 'Đã cập nhật mật khẩu & quyền admin'}.`
        );
      } else {
        console.log(
          'ℹ️ [db:secure-dev-accounts] Không tạo/cập nhật tài khoản Admin (do thiếu cấu hình hoặc mật khẩu chưa đạt chính sách tối thiểu 12 ký tự).'
        );
      }
      return closeDb();
    })
    .catch(async (err) => {
      console.error(err?.message || 'Lỗi khi chạy db:secure-dev-accounts');
      await closeDb();
      process.exit(1);
    });
}
