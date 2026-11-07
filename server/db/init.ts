import path from 'path';
import { fileURLToPath } from 'url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getDb, getActiveTestSchema } from './index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Khởi tạo cơ sở dữ liệu bằng cách chỉ áp dụng duy nhất bộ migration chuẩn của Drizzle
 * từ thư mục migrations/ (Single Source of Truth: server/db/schema.ts -> migrations/*.sql).
 * Tương thích đồng nhất cho cả PostgreSQL (Supabase/Neon), schema test_<ngẫu nhiên> và PGlite.
 */
let initializedDbRef: unknown = null;

export async function initDatabase() {
  const db = await getDb();
  if (initializedDbRef === db) {
    return;
  }
  const activeTestSchema = getActiveTestSchema();
  const migrationsFolder = path.resolve(__dirname, '../../migrations');
  try {
    if (activeTestSchema) {
      await migrate(db, {
        migrationsFolder,
        migrationsSchema: activeTestSchema,
      });
    } else {
      await migrate(db, { migrationsFolder });
    }
    initializedDbRef = db;
    console.log(
      activeTestSchema
        ? `✅ Đã áp dụng Drizzle migrations thành công vào schema kiểm thử "${activeTestSchema}"!`
        : '✅ Đã áp dụng Drizzle migrations thành công từ thư mục migrations/ (Single Source of Truth)!'
    );
  } catch (err: any) {
    if (activeTestSchema) {
      throw err;
    }
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('already exists') || msg.includes('drizzle')) {
      initializedDbRef = db;
      return;
    }
    throw err;
  }
}

