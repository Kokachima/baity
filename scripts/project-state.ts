import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createApp } from '../server/app.ts';
import { apiRouter } from '../server/routes/api.ts';
import { authRouter } from '../server/routes/auth.ts';
import { userRouter } from '../server/routes/user.ts';
import { productsRouter } from '../server/routes/products.ts';
import { cartRouter } from '../server/routes/cart.ts';
import { wishlistRouter } from '../server/routes/wishlist.ts';
import { vouchersRouter } from '../server/routes/vouchers.ts';
import { ordersRouter, paymentsRouter } from '../server/routes/orders.ts';
import { returnsRouter } from '../server/routes/returns.ts';
import { reviewsRouter } from '../server/routes/reviews.ts';
import { chatRouter } from '../server/routes/chat.ts';
import { visualSearchRouter } from '../server/routes/visualSearch.ts';
import { adminRouter } from '../server/routes/admin.ts';
import { adminStage8cRouter } from '../server/routes/adminStage8c.ts';
import { adminStage8dRouter } from '../server/routes/adminStage8d.ts';
import { optionalAuth, requireAuth, requireAdmin } from '../server/services/auth.ts';

const ROOT_DIR = process.cwd();
const TARGET_DIRS = ['migrations', 'scripts', 'server', 'shared', 'src', 'tests'];

function countNewlines(content: string): number {
  let count = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) count++;
  }
  return count;
}

function walkFiles(dirRel: string): string[] {
  const fullDir = path.join(ROOT_DIR, dirRel);
  if (!fs.existsSync(fullDir)) return [];
  const entries = fs.readdirSync(fullDir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const relPath = path.posix.join(dirRel, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(relPath));
    } else if (entry.isFile()) {
      results.push(relPath);
    }
  }
  return results;
}

function collectFileLineCounts(): { files: { file: string; lines: number }[]; totalLines: number } {
  const allFiles: string[] = [];
  for (const d of TARGET_DIRS) {
    allFiles.push(...walkFiles(d));
  }
  allFiles.sort();

  const files: { file: string; lines: number }[] = [];
  let totalLines = 0;
  for (const rel of allFiles) {
    const content = fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');
    const lines = countNewlines(content);
    files.push({ file: rel, lines });
    totalLines += lines;
  }
  return { files, totalLines };
}

function extractTestsFromFile(relPath: string): string[] {
  const content = fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8');
  const lines = content.split(/\r?\n/);
  const tests: string[] = [];
  const regex = /^\s*(?:test|it)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;
  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      tests.push(match[2]);
    }
  }
  return tests;
}

interface MigrationSummary {
  idx: number;
  tag: string;
  fileName: string;
  lines: number;
  sha256: string;
  extensionsCreated: string[];
  tablesCreated: string[];
  rlsEnabledTables: string[];
  tablesAltered: string[];
  indexesCreated: string[];
  indexesDropped: string[];
}

function collectMigrations(): MigrationSummary[] {
  const journalPath = path.join(ROOT_DIR, 'migrations/meta/_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  const summaries: MigrationSummary[] = [];

  for (const entry of journal.entries || []) {
    const fileName = `${entry.tag}.sql`;
    const fullPath = path.join(ROOT_DIR, 'migrations', fileName);
    const content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
    const lines = countNewlines(content);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');

    const extensionsCreated = Array.from(
      new Set(
        Array.from(content.matchAll(/CREATE\s+EXTENSION(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([a-zA-Z0-9_]+)"?/gi)).map(
          (m) => m[1]
        )
      )
    );
    const tablesCreated = Array.from(
      new Set(
        Array.from(
          content.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:"?[a-zA-Z0-9_]+"?\.)?"?([a-zA-Z0-9_]+)"?/gi)
        ).map((m) => m[1])
      )
    );
    const rlsEnabledTables = Array.from(
      new Set(
        Array.from(
          content.matchAll(
            /ALTER\s+TABLE(?:\s+ONLY)?\s+(?:"?[a-zA-Z0-9_]+"?\.)?"?([a-zA-Z0-9_]+)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi
          )
        ).map((m) => m[1])
      )
    );
    const tablesAltered = Array.from(
      new Set(
        Array.from(
          content.matchAll(/ALTER\s+TABLE(?:\s+ONLY)?\s+(?:"?[a-zA-Z0-9_]+"?\.)?"?([a-zA-Z0-9_]+)"?/gi)
        ).map((m) => m[1])
      )
    );
    const indexesCreated = Array.from(
      new Set(
        Array.from(
          content.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([a-zA-Z0-9_]+)"?/gi)
        ).map((m) => m[1])
      )
    );
    const indexesDropped = Array.from(
      new Set(
        Array.from(content.matchAll(/DROP\s+INDEX(?:\s+IF\s+EXISTS)?\s+"?([a-zA-Z0-9_]+)"?/gi)).map((m) => m[1])
      )
    );

    summaries.push({
      idx: entry.idx,
      tag: entry.tag,
      fileName,
      lines,
      sha256,
      extensionsCreated,
      tablesCreated,
      rlsEnabledTables,
      tablesAltered,
      indexesCreated,
      indexesDropped,
    });
  }

  return summaries;
}

export interface RouteEntry {
  method: string;
  fullPath: string;
  authMiddlewares: string[];
  source: string;
}

function classifyAuthMiddleware(fn: Function): string | null {
  if (fn === optionalAuth || fn.name === 'optionalAuth') return 'optionalAuth';
  if (fn === requireAuth || fn.name === 'requireAuth') return 'requireAuth';
  if (fn === requireAdmin || fn.name === 'requireAdmin') return 'requireAdmin';
  return null;
}

const ROUTER_SOURCE_MAP = new Map<any, string>([
  [apiRouter, 'server/routes/api.ts'],
  [authRouter, 'server/routes/auth.ts'],
  [userRouter, 'server/routes/user.ts'],
  [productsRouter, 'server/routes/products.ts'],
  [cartRouter, 'server/routes/cart.ts'],
  [wishlistRouter, 'server/routes/wishlist.ts'],
  [vouchersRouter, 'server/routes/vouchers.ts'],
  [ordersRouter, 'server/routes/orders.ts'],
  [paymentsRouter, 'server/routes/orders.ts'],
  [returnsRouter, 'server/routes/returns.ts'],
  [reviewsRouter, 'server/routes/reviews.ts'],
  [chatRouter, 'server/routes/chat.ts'],
  [visualSearchRouter, 'server/routes/visualSearch.ts'],
  [adminRouter, 'server/routes/admin.ts'],
  [adminStage8cRouter, 'server/routes/adminStage8c.ts'],
  [adminStage8dRouter, 'server/routes/adminStage8d.ts'],
]);

function extractMountPrefixFromLayer(layer: any): string {
  if (!layer?.regexp || layer.regexp.fast_slash) return '';
  const src = String(layer.regexp.source || '');
  const match = src.match(/^\^\\\/([a-zA-Z0-9_\\/-]+?)\\\/\?\(\?=\\\/\|\$\)/);
  if (match && match[1]) {
    return '/' + match[1].replace(/\\\//g, '/');
  }
  return '';
}

function joinRoutePaths(prefix: string, subPath: string): string {
  const cleanPrefix = prefix === '/' ? '' : prefix.replace(/\/+$/, '');
  const cleanSub = !subPath || subPath === '/' ? '' : subPath.startsWith('/') ? subPath : `/${subPath}`;
  return `${cleanPrefix}${cleanSub}` || '/';
}

export function extractRouterRoutes(
  router: any,
  prefix: string,
  source: string,
  inheritedAuthMws: string[] = []
): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const stack = router?._router?.stack || router?.stack || [];
  const routerLevelAuthMws: string[] = [...inheritedAuthMws];
  const prefixScopedAuthMws = new Map<string, string[]>();
  const prefixWildcardEmitted = new Set<string>();

  for (const layer of stack) {
    if (!layer.route && layer.handle && !layer.handle.stack) {
      const mountSeg = extractMountPrefixFromLayer(layer);
      const mwName = classifyAuthMiddleware(layer.handle);
      if (!mountSeg) {
        if (mwName && !routerLevelAuthMws.includes(mwName)) {
          routerLevelAuthMws.push(mwName);
        }
      } else {
        const scopedPath = joinRoutePaths(prefix, mountSeg);
        const list = prefixScopedAuthMws.get(scopedPath) || [...routerLevelAuthMws];
        if (mwName && !list.includes(mwName)) {
          list.push(mwName);
          prefixScopedAuthMws.set(scopedPath, list);
        } else if (
          !mwName &&
          layer.handle.length < 4 &&
          scopedPath.startsWith('/api/admin') &&
          !prefixWildcardEmitted.has(scopedPath)
        ) {
          prefixWildcardEmitted.add(scopedPath);
          routes.push({
            method: 'ALL',
            fullPath: `${scopedPath}/*`,
            authMiddlewares: list.length > 0 ? list : ['(public)'],
            source,
          });
        }
      }
    } else if (!layer.route && layer.handle?.stack) {
      const mountSeg = extractMountPrefixFromLayer(layer);
      const nextPrefix = joinRoutePaths(prefix, mountSeg);
      const nextSource = ROUTER_SOURCE_MAP.get(layer.handle) || source;
      const scopedMws = prefixScopedAuthMws.get(nextPrefix) || routerLevelAuthMws;
      routes.push(...extractRouterRoutes(layer.handle, nextPrefix, nextSource, scopedMws));
    } else if (layer.route) {
      const fullPath = joinRoutePaths(prefix, layer.route.path || '');
      const methods = Object.keys(layer.route.methods || {})
        .filter((m) => layer.route.methods[m])
        .map((m) => (m.toLowerCase() === '_all' ? 'ALL' : m.toUpperCase()));
      const authMws: string[] = [...routerLevelAuthMws];
      for (const routeLayer of layer.route.stack || []) {
        const mwName = classifyAuthMiddleware(routeLayer.handle);
        if (mwName && !authMws.includes(mwName)) {
          authMws.push(mwName);
        }
      }
      for (const method of methods) {
        routes.push({
          method,
          fullPath,
          authMiddlewares: authMws.length > 0 ? authMws : ['(public)'],
          source,
        });
      }
    }
  }
  return routes;
}

/**
 * Đọc cây router Express THẬT của ứng dụng tạo bằng createApp() (hoặc bản sao app truyền vào).
 * Tuyệt đối không phân tích văn bản mã nguồn bằng regex.
 */
export function collectExpressRoutes(appInstance?: any): RouteEntry[] {
  const app = appInstance || createApp();
  return extractRouterRoutes(app, '', 'server/app.ts');
}

function collectEnvVars(files: { file: string; lines: number }[]): { name: string; files: string[] }[] {
  const envMap = new Map<string, Set<string>>();
  const regex = /\b(?:process\.env|import\.meta\.env|env)\.([A-Z][A-Z0-9_]{2,})\b/g;

  const extraRootFiles = ['server.ts', 'vite.config.ts', 'drizzle.config.ts'].filter((f) =>
    fs.existsSync(path.join(ROOT_DIR, f))
  );
  const scanList = [...extraRootFiles, ...files.map((f) => f.file).filter((f) => /\.(ts|tsx|js|mjs)$/.test(f))];

  for (const rel of scanList) {
    const content = fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');
    for (const match of content.matchAll(regex)) {
      const varName = match[1];
      if (!envMap.has(varName)) {
        envMap.set(varName, new Set());
      }
      envMap.get(varName)!.add(rel);
    }
  }

  return Array.from(envMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, fileSet]) => ({
      name,
      files: Array.from(fileSet).sort(),
    }));
}

function generateProjectStateMarkdown(): string {
  const generatedAt = new Date().toISOString();
  const { files, totalLines } = collectFileLineCounts();
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const scripts: Record<string, string> = pkg.scripts || {};
  const migrations = collectMigrations();
  const routes = collectExpressRoutes();
  const envVars = collectEnvVars(files);

  const testFiles = files
    .map((f) => f.file)
    .filter((f) => f.startsWith('tests/') && (f.endsWith('.test.ts') || f.endsWith('.spec.ts')))
    .sort();

  const md: string[] = [];
  md.push('# PROJECT_STATE.md');
  md.push('');
  md.push('> Tập tin này được sinh tự động hoàn toàn bằng mã qua lệnh `npm run state` (`scripts/project-state.ts`). Không chỉnh sửa thủ công.');
  md.push('');
  md.push(`- **Thời điểm sinh (UTC)**: \`${generatedAt}\``);
  md.push(`- **Tổng số file được quét** (\`migrations\`, \`scripts\`, \`server\`, \`shared\`, \`src\`, \`tests\`): **${files.length}**`);
  md.push(`- **Tổng số dòng (\`wc -l\`)**: **${totalLines}**`);
  md.push('');

  // 1. File Tree & Line Counts
  md.push('## 1. Cây file kèm số dòng (`wc -l`)');
  md.push('');
  md.push('| File | Số dòng (`wc -l`) |');
  md.push('| --- | ---: |');
  for (const f of files) {
    md.push(`| \`${f.file}\` | ${f.lines} |`);
  }
  md.push(`| **Tổng cộng (${files.length} files)** | **${totalLines}** |`);
  md.push('');

  // 2. Tests by File
  md.push('## 2. Danh sách bài kiểm tra (Tests) theo từng file');
  md.push('');
  let unitTestCount = 0;
  let pgTestCount = 0;
  let e2eTestCount = 0;
  const testSections: string[] = [];

  for (const tf of testFiles) {
    const names = extractTestsFromFile(tf);
    if (tf.startsWith('tests/pg/')) {
      pgTestCount += names.length;
    } else if (tf.startsWith('tests/e2e/')) {
      e2eTestCount += names.length;
    } else {
      unitTestCount += names.length;
    }
    testSections.push(`### \`${tf}\` (${names.length} tests)`);
    testSections.push('');
    names.forEach((n, idx) => {
      testSections.push(`${idx + 1}. \`${n}\``);
    });
    testSections.push('');
  }

  md.push(`- **Unit/Integration Tests (\`npm test\`)**: **${unitTestCount}** tests`);
  md.push(`- **PostgreSQL Concurrency/Migration Tests (\`npm run test:pg\`)**: **${pgTestCount}** tests`);
  md.push(`- **E2E Spec (\`tests/e2e/\`)**: **${e2eTestCount}** tests`);
  md.push(`- **Tổng cộng tất cả các test**: **${unitTestCount + pgTestCount + e2eTestCount}** tests`);
  md.push('');
  md.push(...testSections);

  // 3. Migrations
  md.push('## 3. Danh sách Migration theo thứ tự (`migrations/meta/_journal.json`)');
  md.push('');
  md.push('| Thứ tự (`idx`) | File Migration | Số dòng | SHA-256 (12 ký tự đầu) | Bảng tạo mới (`CREATE TABLE`) | Bật RLS (`ENABLE ROW LEVEL SECURITY`) | Bảng sửa (`ALTER TABLE`) | Index tạo / xóa |');
  md.push('| ---: | --- | ---: | --- | --- | --- | --- | --- |');
  for (const m of migrations) {
    const createdStr = m.tablesCreated.length > 0 ? m.tablesCreated.map((t) => `\`${t}\``).join(', ') : '*(không)*';
    const rlsStr =
      m.rlsEnabledTables.length > 0
        ? `${m.rlsEnabledTables.length} bảng (${m.rlsEnabledTables.map((t) => `\`${t}\``).join(', ')})`
        : '*(không)*';
    const alteredOnly = m.tablesAltered.filter((t) => !m.tablesCreated.includes(t));
    const alteredStr =
      alteredOnly.length > 0
        ? `${alteredOnly.length} bảng (${alteredOnly.map((t) => `\`${t}\``).join(', ')})`
        : m.tablesAltered.length > 0
        ? `${m.tablesAltered.map((t) => `\`${t}\``).join(', ')}`
        : '*(không)*';
    const idxParts: string[] = [];
    if (m.extensionsCreated.length > 0) {
      idxParts.push(`Ext: ${m.extensionsCreated.map((e) => `\`${e}\``).join(', ')}`);
    }
    if (m.indexesCreated.length > 0) {
      idxParts.push(`+${m.indexesCreated.length} index`);
    }
    if (m.indexesDropped.length > 0) {
      idxParts.push(`-${m.indexesDropped.length} index`);
    }
    const idxStr = idxParts.length > 0 ? idxParts.join('; ') : '*(không)*';

    md.push(
      `| ${m.idx} | \`migrations/${m.fileName}\` | ${m.lines} | \`${m.sha256.slice(0, 12)}\` | ${createdStr} | ${rlsStr} | ${alteredStr} | ${idxStr} |`
    );
  }
  md.push('');

  // 4. package.json scripts
  md.push('## 4. Các script trong `package.json`');
  md.push('');
  md.push('| Tên script | Lệnh thực thi |');
  md.push('| --- | --- |');
  for (const [name, cmd] of Object.entries(scripts)) {
    md.push(`| \`${name}\` | \`${cmd}\` |`);
  }
  md.push('');

  // 5. Express routes
  const prefixGroupMap = new Map<string, RouteEntry[]>();
  for (const r of routes) {
    const parts = r.fullPath.split('/').filter(Boolean);
    const prefixKey = parts.length >= 2 ? `/${parts[0]}/${parts[1]}` : r.fullPath;
    if (!prefixGroupMap.has(prefixKey)) {
      prefixGroupMap.set(prefixKey, []);
    }
    prefixGroupMap.get(prefixKey)!.push(r);
  }
  const sortedPrefixGroups = Array.from(prefixGroupMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  md.push(`## 5. Danh sách Route Express (\`server/routes/*\` — Tổng cộng: **${routes.length}** routes)`);
  md.push('');
  md.push('### 5.1. Thống kê số lượng Route theo tiền tố');
  md.push('');
  md.push('| Tiền tố (`prefix`) | Số lượng route |');
  md.push('| --- | ---: |');
  for (const [pfx, list] of sortedPrefixGroups) {
    md.push(`| \`${pfx}\` | ${list.length} |`);
  }
  md.push(`| **Tổng cộng** | **${routes.length}** |`);
  md.push('');
  md.push('### 5.2. Danh sách chi tiết từng Route');
  md.push('');
  md.push('| Phương thức | Đường dẫn | Middleware xác thực | File định nghĩa |');
  md.push('| --- | --- | --- | --- |');
  for (const r of routes) {
    md.push(`| \`${r.method}\` | \`${r.fullPath}\` | \`${r.authMiddlewares.join(', ')}\` | \`${r.source}\` |`);
  }
  md.push('');

  // 6. Environment variables
  md.push('## 6. Biến môi trường đang được tham chiếu trong mã (chỉ tên biến, không chứa giá trị)');
  md.push('');
  md.push('| Tên biến môi trường | Các file sử dụng |');
  md.push('| --- | --- |');
  for (const env of envVars) {
    md.push(`| \`${env.name}\` | ${env.files.map((f) => `\`${f}\``).join(', ')} |`);
  }
  md.push('');

  return md.join('\n');
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(ROOT_DIR, 'scripts/project-state.ts')
) {
  const markdown = generateProjectStateMarkdown();
  const outPath = path.join(ROOT_DIR, 'PROJECT_STATE.md');
  fs.writeFileSync(outPath, markdown, 'utf8');
  console.log(`Generated PROJECT_STATE.md (${countNewlines(markdown)} lines)`);
}
