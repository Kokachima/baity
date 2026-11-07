import fs from 'node:fs';
import { isStrictRuntimeMode } from '../server/config/runtimeMode.ts';

const ALLOWED_CONTAINER_SECRET_KEYS = new Set([
  'ADMIN_EMAIL',
  'ADMIN_INITIAL_PASSWORD',
  'GEMINI_API_KEY',
  'DATABASE_URL',
  'TEST_DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_PUBLIC_BUCKET',
  'SUPABASE_RETURNS_BUCKET',
  'EMAIL_PROVIDER',
  'EMAIL_FROM',
  'BREVO_API_KEY',
  'RESEND_API_KEY',
  'CRON_SECRET_KEY',
  'PAYMENT_WEBHOOK_SECRET',
  'WEBHOOK_SECRET',
  'JWT_SECRET',
]);

/**
 * Đọc các biến môi trường từ tiến trình dev server (/app/.dev.pid -> /proc/<pid>/environ)
 * cho các lệnh CLI chạy trong subshell của container AI Studio.
 * - Tuyệt đối KHÔNG chạy khi đang ở chế độ strict production (isStrictRuntimeMode(env) === true).
 * - Tuyệt đối KHÔNG chạy khi NODE_ENV === 'test' trừ khi USE_TEST_DATABASE_URL === 'true' (cho npm run test:pg).
 * - Tuyệt đối KHÔNG in bất kỳ giá trị biến nào ra console/log.
 * - Chỉ điền các biến nằm trong danh sách cho phép ALLOWED_CONTAINER_SECRET_KEYS đang trống/chưa đặt trong env.
 */
export function loadContainerSecretsIfMissing(
  env: NodeJS.ProcessEnv = process.env,
  options?: {
    devPidFile?: string;
    procRoot?: string;
  }
): string[] {
  if (isStrictRuntimeMode(env)) {
    return [];
  }
  if (env.NODE_ENV === 'test' && env.USE_TEST_DATABASE_URL !== 'true') {
    return [];
  }

  const devPidFile = options?.devPidFile || '/app/.dev.pid';
  const procRoot = options?.procRoot || '/proc';
  const loadedKeys: string[] = [];

  try {
    if (!fs.existsSync(devPidFile)) {
      return [];
    }
    const devPid = String(fs.readFileSync(devPidFile, 'utf8')).trim();
    if (!/^\d+$/.test(devPid)) {
      return [];
    }
    const environPath = `${procRoot}/${devPid}/environ`;
    if (!fs.existsSync(environPath)) {
      return [];
    }
    const rawEnviron = String(fs.readFileSync(environPath, 'utf8'));
    for (const entry of rawEnviron.split('\0')) {
      if (!entry) continue;
      const eqIdx = entry.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = entry.slice(0, eqIdx);
      const val = entry.slice(eqIdx + 1);
      if (!ALLOWED_CONTAINER_SECRET_KEYS.has(key)) continue;
      if (env[key] === undefined || env[key] === '') {
        env[key] = val;
        loadedKeys.push(key);
      }
    }
  } catch {
    // Bỏ qua nếu không chạy trong container Linux có /app/.dev.pid
  }

  return loadedKeys;
}
