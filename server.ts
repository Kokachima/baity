import dotenv from 'dotenv';
dotenv.config({ override: true });

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { sql } from 'drizzle-orm';
import { queryRows } from './server/db/index.ts';
import { initDatabase } from './server/db/init.ts';
import { seedDatabase } from './server/db/seed.ts';
import { createApp, validateProductionStartupEnv } from './server/app.ts';
import {
  isStrictRuntimeMode,
  shouldServeStaticDist,
  formatStartupSecuritySummary,
  logPreviewModeWarningIfNeeded,
} from './server/config/runtimeMode.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const isStrictProd = isStrictRuntimeMode(process.env);
  const serveStaticDist = shouldServeStaticDist(process.env);

  // Khi không phải strict production (ví dụ bản preview hoặc dev), mặc định bật COOKIE_CROSS_SITE=true nếu chưa cấu hình
  if (!isStrictProd && process.env.COOKIE_CROSS_SITE === undefined) {
    process.env.COOKIE_CROSS_SITE = 'true';
  }

  logPreviewModeWarningIfNeeded(process.env);
  console.log(formatStartupSecuritySummary(process.env));

  if (isStrictProd) {
    // Kiểm tra ngay lập tức toàn bộ biến bắt buộc không phụ thuộc trạng thái bảng users.
    // Riêng ADMIN_EMAIL và ADMIN_INITIAL_PASSWORD sẽ được kiểm tra ngay sau khi kết nối CSDL nếu CSDL chưa có Admin.
    const envCheck = validateProductionStartupEnv(process.env, { hasExistingAdmin: true });
    if (!envCheck.ok) {
      for (const errMsg of envCheck.errors) {
        console.error(`❌ [STARTUP ENV ERROR] ${errMsg}`);
      }
      process.exit(1);
    }
  }

  let app: express.Express;
  try {
    app = createApp();
  } catch (err: any) {
    console.error('❌ [STARTUP BLOCKED] Server từ chối khởi động do chốt chặn cấu hình bảo mật:', err.message || err);
    process.exit(1);
  }

  const PORT = Number(process.env.PORT) || 3000;

  // 1. Khởi tạo cơ sở dữ liệu (Drizzle migrator) và kiểm tra/seed dữ liệu
  // Chạy bất đồng bộ kèm cổng chờ đặt TRƯỚC các route /api/* để cổng 3000 mở ngay lập tức khi cold-start
  const dbReadyPromise = (async () => {
    try {
      await initDatabase();
      if (isStrictProd) {
        const existingAdmin = await queryRows<{ id: string }>(
          sql`SELECT id FROM users WHERE role = 'admin' LIMIT 1;`
        );
        const adminEnvCheck = validateProductionStartupEnv(process.env, {
          hasExistingAdmin: existingAdmin.length > 0,
          suppressWarnings: true,
        });
        if (!adminEnvCheck.ok) {
          for (const errMsg of adminEnvCheck.errors) {
            console.error(`❌ [STARTUP ENV ERROR] ${errMsg}`);
          }
          process.exit(1);
        }
      }
      await seedDatabase();
    } catch (err: any) {
      console.error('❌ Lỗi khởi tạo cơ sở dữ liệu:', err.message || err);
      if (String(err?.message || '').includes('FATAL') || isStrictProd) {
        process.exit(1);
      }
    }
  })();

  const serverApp = express();
  serverApp.disable('x-powered-by');
  serverApp.use('/api', async (_req, _res, next) => {
    await dbReadyPromise;
    next();
  });
  serverApp.use(app);

  // 2. Phục vụ Frontend React
  if (!serveStaticDist) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    serverApp.use(vite.middlewares);
    console.log('🚀 Chế độ Development: Vite middleware đã được gắn vào Express.');
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    serverApp.use(express.static(distPath));
    serverApp.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
    console.log('📦 Phục vụ static files từ thư mục dist.');
  }

  // 3. Lắng nghe cổng 3000 (0.0.0.0) ngay lập tức
  serverApp.listen(PORT, '0.0.0.0', () => {
    console.log(`✨ Baity Fashion E-Commerce Server đang chạy tại http://0.0.0.0:${PORT}`);
  });
}

startServer();
