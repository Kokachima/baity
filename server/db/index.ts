import crypto from 'crypto';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import postgres from 'postgres';
import * as schema from './schema.ts';
import {
  isStrictRuntimeMode,
  STRICT_MODE_AI_STUDIO_HINT,
  STRICT_COOKIE_CROSS_SITE_ERROR_MESSAGE,
} from '../config/runtimeMode.ts';

let dbInstance: any = null;
let rawClient: any = null;
let injectedTestDbInstance: any = null;
let injectedTestRawClient: any = null;
let activeTestSchema: string | null = null;

/**
 * Hook CHỈ DÙNG TRONG KIỂM THỬ (ví dụ prod:rehearsal) để tiêm trực tiếp thực thể PGlite in-memory.
 * Tuyệt đối không thể kích hoạt qua biến môi trường USE_PGLITE ở chế độ strict production.
 */
export function setTestDbInstanceForRehearsal(db: any, client?: any): void {
  injectedTestDbInstance = db;
  injectedTestRawClient = client ?? null;
  dbInstance = db;
  rawClient = client ?? null;
}

export function getActiveTestSchema(): string | null {
  return activeTestSchema;
}

export interface ParsedPgEndpoint {
  host: string;
  port: string;
  dbName: string;
  schemaName: string;
  cleanUrl: string;
}

export function parsePgEndpoint(raw: string, label: string): ParsedPgEndpoint {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`❌ FATAL: ${label} không phải là URL kết nối PostgreSQL hợp lệ!`);
  }
  const host = u.hostname.toLowerCase();
  const port = u.port || '5432';
  const dbName = decodeURIComponent(u.pathname.replace(/^\/+/, '')).trim();
  const rawSchema = (
    u.searchParams.get('schema') ||
    u.searchParams.get('currentSchema') ||
    'public'
  ).trim();
  if (!host || !dbName) {
    throw new Error(`❌ FATAL: ${label} thiếu hostname hoặc tên database!`);
  }
  if (!/^[a-zA-Z0-9_]+$/.test(rawSchema)) {
    throw new Error(`❌ FATAL: Tên schema "${rawSchema}" trong ${label} chứa ký tự không hợp lệ!`);
  }

  const cleanUrlObj = new URL(raw);
  cleanUrlObj.searchParams.delete('schema');
  cleanUrlObj.searchParams.delete('currentSchema');

  return {
    host,
    port,
    dbName,
    schemaName: rawSchema,
    cleanUrl: cleanUrlObj.toString(),
  };
}

/**
 * Kiểm tra an toàn cấu hình TEST_DATABASE_URL trước khi kết nối:
 * 1. Từ chối nếu đang ở chế độ strict production.
 * 2. Từ chối nếu trùng cấu hình (host, port, database và schema) với DATABASE_URL.
 * 3. Bắt buộc tên schema (hoặc tên database khi schema tách riêng) phải chứa chữ "test".
 *    Trên Supabase (tên database luôn là "postgres"), tên schema bắt buộc phải chứa "test" (ví dụ ?schema=test_pg).
 */
export function validateTestDatabaseUrlConfig(
  testDbUrlRaw: string,
  mainDbUrlRaw?: string,
  env: NodeJS.ProcessEnv = process.env
): ParsedPgEndpoint {
  const isStrictProd = isStrictRuntimeMode(env);

  if (isStrictProd) {
    throw new Error('❌ FATAL: Từ chối chạy bộ test PostgreSQL (test:pg) khi ở môi trường Production!');
  }

  const testDbUrl = (testDbUrlRaw || '').trim();
  const mainDbUrl = (mainDbUrlRaw || '').trim();

  if (!testDbUrl) {
    throw new Error(
      '❌ FATAL: Bắt buộc cung cấp biến môi trường TEST_DATABASE_URL riêng biệt để chạy test:pg (tuyệt đối không dùng DATABASE_URL)!'
    );
  }

  const parsedTest = parsePgEndpoint(testDbUrl, 'TEST_DATABASE_URL');

  if (mainDbUrl && !mainDbUrl.includes('placeholder')) {
    let parsedMain: ParsedPgEndpoint | null = null;
    try {
      parsedMain = parsePgEndpoint(mainDbUrl, 'DATABASE_URL');
    } catch {
      parsedMain = null;
    }
    if (parsedMain) {
      const sameEndpoint =
        parsedTest.host === parsedMain.host &&
        parsedTest.port === parsedMain.port &&
        parsedTest.dbName.toLowerCase() === parsedMain.dbName.toLowerCase() &&
        parsedTest.schemaName.toLowerCase() === parsedMain.schemaName.toLowerCase();
      if (sameEndpoint) {
        throw new Error(
          `❌ FATAL: TEST_DATABASE_URL trỏ tới cùng host (${parsedTest.host}:${parsedTest.port}), database (${parsedTest.dbName}) và schema (${parsedTest.schemaName}) với DATABASE_URL! Từ chối chạy test:pg để bảo vệ cơ sở dữ liệu chính.`
        );
      }
    }
  }

  const dbHasTest = parsedTest.dbName.toLowerCase().includes('test');
  const schemaHasTest = parsedTest.schemaName.toLowerCase().includes('test');

  if (!dbHasTest && !schemaHasTest) {
    throw new Error(
      `❌ FATAL: Tên database ("${parsedTest.dbName}") hoặc tên schema ("${parsedTest.schemaName}") trong TEST_DATABASE_URL bắt buộc phải chứa chuỗi "test" (ví dụ thêm ?schema=test_pg vào cuối URL)!`
    );
  }

  if (parsedTest.schemaName.toLowerCase() !== 'public' && !schemaHasTest) {
    throw new Error(
      `❌ FATAL: Tên schema ("${parsedTest.schemaName}") trong TEST_DATABASE_URL bắt buộc phải chứa chuỗi "test"!`
    );
  }

  return parsedTest;
}

export async function getDb() {
  const isStrictProd = isStrictRuntimeMode();

  if (isStrictProd && process.env.COOKIE_CROSS_SITE === 'true') {
    const err = new Error(STRICT_COOKIE_CROSS_SITE_ERROR_MESSAGE);
    console.error(err.message);
    throw err;
  }

  if (injectedTestDbInstance) {
    return injectedTestDbInstance;
  }

  if (dbInstance) {
    return dbInstance;
  }

  const databaseUrl = process.env.DATABASE_URL;
  const forcePglite = process.env.USE_PGLITE === 'true';

  // 1. Kiểm tra nghiêm ngặt: USE_PGLITE TUYỆT ĐỐI KHÔNG ĐƯỢC có hiệu lực ở MỌI chế độ strict production
  if (isStrictProd && forcePglite) {
    const err = new Error(
      `❌ FATAL: USE_PGLITE không được phép hoạt động ở chế độ strict production! Môi trường Production bắt buộc sử dụng cơ sở dữ liệu PostgreSQL bền vững (Supabase/Neon) qua biến DATABASE_URL. (${STRICT_MODE_AI_STUDIO_HINT})`
    );
    console.error(err.message);
    throw err;
  }

  // 2. Kiểm tra ở MỌI chế độ strict production bắt buộc có DATABASE_URL
  if (isStrictProd) {
    if (!databaseUrl || databaseUrl.trim() === '') {
      const err = new Error(
        `❌ FATAL: Thiếu biến môi trường DATABASE_URL ở chế độ strict production. Hệ thống KHÔNG tự động chuyển sang PGlite để đảm bảo dữ liệu không bị mất. (${STRICT_MODE_AI_STUDIO_HINT})`
      );
      console.error(err.message);
      throw err;
    }

    try {
      console.log('🔄 [PRODUCTION] Đang kết nối PostgreSQL qua Supabase / Neon...');
      rawClient = postgres(databaseUrl, {
        prepare: false,
        max: 10,
        idle_timeout: 20,
        connect_timeout: 10,
      });
      dbInstance = drizzlePg(rawClient, { schema });
      await rawClient`SELECT 1;`;
      console.log('✅ [PRODUCTION] Kết nối thành công tới PostgreSQL (Supabase/Neon). Đang sử dụng cơ sở dữ liệu bền vững!');
      return dbInstance;
    } catch (err: any) {
      console.error('❌ FATAL: Không thể kết nối tới cơ sở dữ liệu PostgreSQL ở production:', err.message);
      throw err;
    }
  }

  // 2a. Chế độ kiểm thử trên PostgreSQL thật (npm run test:pg):
  // Tự động tạo schema riêng tên test_<ngẫu nhiên>, chạy migration vào schema đó và xóa schema khi xong
  if (process.env.USE_TEST_DATABASE_URL === 'true') {
    const parsedTest = validateTestDatabaseUrlConfig(
      process.env.TEST_DATABASE_URL || '',
      process.env.DATABASE_URL || '',
      process.env
    );

    const basePrefix = parsedTest.schemaName.toLowerCase().includes('test')
      ? parsedTest.schemaName.toLowerCase().replace(/[^a-z0-9_]/g, '_')
      : 'test_pg';
    const randomSuffix = crypto.randomBytes(4).toString('hex');
    activeTestSchema = `${basePrefix}_${randomSuffix}`;

    console.log(
      `🔄 [TEST:PG] Đang kết nối PostgreSQL thật qua TEST_DATABASE_URL và khởi tạo schema cô lập "${activeTestSchema}"...`
    );

    // Khởi tạo schema test_<ngẫu nhiên> trước rồi gắn search_path mặc định cho toàn bộ connection pool
    const bootstrapClient = postgres(parsedTest.cleanUrl, {
      prepare: false,
      max: 1,
      idle_timeout: 5,
      connect_timeout: 10,
    });
    try {
      await bootstrapClient.unsafe(`CREATE SCHEMA IF NOT EXISTS "${activeTestSchema}";`);
      await bootstrapClient.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    } finally {
      await bootstrapClient.end({ timeout: 2 });
    }

    rawClient = postgres(parsedTest.cleanUrl, {
      prepare: false,
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      connection: {
        search_path: `${activeTestSchema},public`,
      },
    });
    dbInstance = drizzlePg(rawClient, { schema });
    await rawClient.unsafe(`SET search_path TO "${activeTestSchema}", public;`);
    console.log(`✅ [TEST:PG] Kết nối PostgreSQL thật thành công trên schema riêng "${activeTestSchema}"!`);
    return dbInstance;
  }

  // 2b. Môi trường Development / Test (nếu không ép dùng PGlite cho test cô lập)
  if (!forcePglite && databaseUrl && !databaseUrl.includes('localhost:5432/baity') && !databaseUrl.includes('placeholder')) {
    try {
      console.log('🔄 [DEVELOPMENT] Đang kết nối PostgreSQL từ DATABASE_URL...');
      rawClient = postgres(databaseUrl, {
        prepare: false,
        max: 5,
      });
      dbInstance = drizzlePg(rawClient, { schema });
      await rawClient`SELECT 1;`;
      console.log('✅ [DEVELOPMENT] Kết nối PostgreSQL thành công!');
      return dbInstance;
    } catch (err: any) {
      console.warn('⚠️ [DEVELOPMENT] Kết nối PostgreSQL thất bại, sử dụng PGlite lưu tại .data/pglite cho dev/test:', err.message);
    }
  }

  // Khởi tạo PostgreSQL PGlite kèm extension pg_trgm cho dev/test
  const pgliteDir = process.env.PGLITE_DATA_DIR || '.data/pglite';
  if (!pgliteDir.startsWith('memory://')) {
    const fs = await import('fs');
    const path = await import('path');
    fs.mkdirSync(path.dirname(path.resolve(process.cwd(), pgliteDir)), { recursive: true });
  }
  console.log(`📦 [DEV/TEST] Khởi tạo PostgreSQL PGlite (${pgliteDir})...`);
  rawClient = new PGlite(pgliteDir, {
    extensions: { pg_trgm },
  });
  dbInstance = drizzlePglite(rawClient, { schema });
  console.log(`✅ [DEV/TEST] Khởi tạo PGlite thành công (${pgliteDir})!`);
  return dbInstance;
}

export let queryCounter = 0;
export function resetQueryCounter() {
  queryCounter = 0;
}
export function getQueryCount() {
  return queryCounter;
}

/**
 * Helper chuẩn hóa kết quả trả về từ db.execute() cho cả postgres-js (Array) và pglite ({ rows: Array })
 */
export async function queryRows<T = any>(sqlQuery: any): Promise<T[]> {
  queryCounter++;
  const db = await getDb();
  const res = await db.execute(sqlQuery);
  if (Array.isArray(res)) {
    return res as T[];
  }
  if (res && Array.isArray(res.rows)) {
    return res.rows as T[];
  }
  return [];
}

/**
 * Thực thi một hàm bên trong Database Transaction ACID (tự động ROLLBACK nếu có bất kỳ lỗi nào ném ra)
 */
export async function withTransaction<T>(
  fn: (txQueryRows: <R = any>(sqlQuery: any) => Promise<R[]>) => Promise<T>
): Promise<T> {
  const db = await getDb();
  return await db.transaction(async (tx: any) => {
    if (activeTestSchema) {
      await tx.execute(
        sql.raw(`SET LOCAL search_path TO "${activeTestSchema}", public;`)
      );
    }
    const txQueryRows = async <R = any>(sqlQuery: any): Promise<R[]> => {
      queryCounter++;
      const res = await tx.execute(sqlQuery);
      if (Array.isArray(res)) {
        return res as R[];
      }
      if (res && Array.isArray(res.rows)) {
        return res.rows as R[];
      }
      return [];
    };
    return await fn(txQueryRows);
  });
}

/**
 * Xóa toàn bộ schema kiểm thử tạm thời test_<ngẫu nhiên> sau khi chạy xong test:pg
 */
export async function dropActiveTestSchema(): Promise<void> {
  if (activeTestSchema && rawClient && typeof rawClient.unsafe === 'function') {
    const schemaToDrop = activeTestSchema;
    try {
      await rawClient.unsafe(`DROP SCHEMA IF EXISTS "${schemaToDrop}" CASCADE;`);
      console.log(`🧹 [TEST:PG] Đã xóa hoàn toàn schema kiểm thử tạm thời "${schemaToDrop}".`);
    } catch (err: any) {
      console.warn(`⚠️ [TEST:PG] Lỗi khi xóa schema "${schemaToDrop}":`, err.message);
    } finally {
      activeTestSchema = null;
    }
  }
}

export async function closeDb() {
  const clientToClose = rawClient || injectedTestRawClient;
  if (clientToClose) {
    try {
      if (typeof clientToClose.end === 'function') {
        await clientToClose.end({ timeout: 2 });
      } else if (typeof clientToClose.close === 'function') {
        await clientToClose.close();
      }
    } catch {
      // ignore close errors
    }
  }
  rawClient = null;
  dbInstance = null;
  injectedTestDbInstance = null;
  injectedTestRawClient = null;
  activeTestSchema = null;
}

export { schema };


