import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function checkSchemaDrift() {
  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  const initialFiles = new Set(fs.readdirSync(migrationsDir));

  const journalPath = path.resolve(migrationsDir, 'meta', '_journal.json');
  const initialJournal = fs.existsSync(journalPath) ? fs.readFileSync(journalPath, 'utf-8') : null;

  let output = '';
  try {
    output = execSync('npx drizzle-kit generate --name __drift_check__', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: any) {
    console.error('Lỗi khi chạy drizzle-kit generate:', err.message);
    process.exit(1);
  }

  const currentFiles = fs.readdirSync(migrationsDir);
  const newFiles = currentFiles.filter((f) => !initialFiles.has(f));

  // Nếu có file mới sinh ra
  if (newFiles.length > 0 || !output.includes('No schema changes, nothing to migrate')) {
    // Dọn dẹp các file tạm vừa sinh ra để không làm bẩn git repo
    for (const f of newFiles) {
      try {
        fs.unlinkSync(path.join(migrationsDir, f));
      } catch {}
    }

    if (initialJournal && fs.existsSync(journalPath)) {
      try {
        fs.writeFileSync(journalPath, initialJournal, 'utf-8');
      } catch {}
    }

    console.error('\n❌ [SCHEMA DRIFT DETECTED] server/db/schema.ts đang bị lệch so với thư mục migrations/!');
    console.error('👉 Phát hiện thay đổi schema chưa được tạo migration.');
    console.error("👉 Vui lòng chạy lệnh 'npm run db:generate' để sinh file migration mới trước khi commit/test.\n");
    process.exit(1);
  }

  console.log('✅ [SCHEMA SYNC] server/db/schema.ts và migrations/ hoàn toàn đồng bộ, không bị lệch (No schema drift).');
  process.exit(0);
}

checkSchemaDrift();
