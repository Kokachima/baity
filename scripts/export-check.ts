import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export type SecretPatternName =
  | 'sb_secret'
  | 'AIza'
  | 'eyJ'
  | 'postgresql://'
  | 'Bearer'
  | 'password='
  | 'API_KEY=';

export interface SecretFinding {
  file: string;
  pattern: SecretPatternName;
}

export interface ExportCheckReport {
  ok: boolean;
  scannedFilesCount: number;
  realSecretFindings: SecretFinding[];
  safePlaceholderOccurrences: SecretFinding[];
  envFileExists: boolean;
  envExampleExists: boolean;
  forbiddenEnvFiles: string[];
  gitignoreBlocksSeedImages: boolean;
  gitignoreBlocksSvg: boolean;
  totalGitExportBytes: number;
  directorySizes: { name: string; bytes: number; fileCount: number }[];
  filesOver5MB: { file: string; bytes: number }[];
  maxFileBytes: number;
  maxFilePath: string;
}

const EXCLUDED_SCAN_DIRS = new Set([
  'node_modules',
  'dist',
  '.data',
  '.git',
  'build',
  'coverage',
  '.playwright-cli',
  '.aistudio',
]);

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const SAFE_TOKEN_KEYWORDS = [
  'placeholder',
  'mock',
  'fake',
  'test',
  'canary',
  'dummy',
  'example',
  'sample',
  'chua-dung',
  'replace-with-',
  'your-',
  'my_gemini_api_key',
  'rehearsal',
  'localhost',
  '127.0.0.1',
  '[db-password]',
  '[pass]',
  '[project-ref]',
  '[ref]',
  '<password>',
  '<user>',
  'user:pass@',
  'postgres:postgres@',
  'postgres.ref:pass@',
  'u:p@',
  'topsecretpwd@',
];

function isSafePlaceholderValue(rawVal: string, relativeFile: string): boolean {
  const lower = rawVal.toLowerCase().trim();
  if (!lower || lower === '""' || lower === "''" || lower.startsWith('${') || lower.startsWith('$')) {
    return true;
  }
  for (const kw of SAFE_TOKEN_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  // Trong tests/* hoặc scripts/prod-rehearsal.ts, các chuỗi kiểm thử có hậu tố/tiền tố cố định
  if (
    (relativeFile.startsWith('tests/') || relativeFile === 'scripts/prod-rehearsal.ts') &&
    (lower.includes('123456') || lower.includes('invalid') || lower.includes('expired'))
  ) {
    return true;
  }
  return false;
}

/**
 * Quét nội dung 1 tệp để tìm 7 mẫu khóa bí mật có giá trị thật:
 * sb_secret, AIza, eyJ, postgresql://, Bearer, password=, API_KEY=
 * TUYỆT ĐỐI chỉ trả về { file, pattern }, không bao giờ lưu hay in giá trị chuỗi khớp.
 */
export function scanTextForSecretPatterns(
  content: string,
  relativeFile: string
): {
  realFindings: SecretFinding[];
  safeOccurrences: SecretFinding[];
} {
  return scanTextForSecretPatternsInternal(content, relativeFile);
}

function scanTextForSecretPatternsInternal(
  content: string,
  relativeFile: string
): {
  realFindings: SecretFinding[];
  safeOccurrences: SecretFinding[];
} {
  const realFindings: SecretFinding[] = [];
  const safeOccurrences: SecretFinding[] = [];
  const recordedReal = new Set<SecretPatternName>();
  const recordedSafe = new Set<SecretPatternName>();

  const recordReal = (pattern: SecretPatternName) => {
    if (!recordedReal.has(pattern)) {
      recordedReal.add(pattern);
      realFindings.push({ file: relativeFile, pattern });
    }
  };
  const recordSafe = (pattern: SecretPatternName) => {
    if (!recordedSafe.has(pattern)) {
      recordedSafe.add(pattern);
      safeOccurrences.push({ file: relativeFile, pattern });
    }
  };

  // 1. sb_secret (ví dụ: sb_secret_<chuỗi thật>)
  const sbMatches = content.match(/sb_secret(?:_[A-Za-z0-9_-]{8,})?/g) || [];
  for (const m of sbMatches) {
    if (/^sb_secret_[A-Za-z0-9_-]{12,}$/.test(m) && !isSafePlaceholderValue(m, relativeFile)) {
      recordReal('sb_secret');
    } else {
      recordSafe('sb_secret');
    }
  }

  // 2. AIza (Google / Gemini API Key: AIza + >= 20 ký tự)
  const aizaMatches = content.match(/AIza[A-Za-z0-9_-]*/g) || [];
  for (const m of aizaMatches) {
    if (m.length >= 25 && !isSafePlaceholderValue(m, relativeFile)) {
      recordReal('AIza');
    } else {
      recordSafe('AIza');
    }
  }

  // 3. eyJ (JWT token: eyJ<header>.eyJ<payload>.<sig> hoặc eyJ dài trong biến cấu hình)
  const eyjMatches = content.match(/eyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,2}/g) || [];
  for (const m of eyjMatches) {
    // Bỏ qua các chuỗi băm toàn vẹn sha512-...eyJ... trong bun.lock / package-lock.json
    if (relativeFile === 'bun.lock' || relativeFile === 'package-lock.json') {
      recordSafe('eyJ');
      continue;
    }
    const isThreePartJwt = /^eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(m);
    if (isThreePartJwt && !isSafePlaceholderValue(m, relativeFile)) {
      recordReal('eyJ');
    } else {
      recordSafe('eyJ');
    }
  }

  // 4. postgresql:// (Chuỗi kết nối PostgreSQL có thông tin xác thực thật)
  const pgMatches = content.match(/postgresql:\/\/[^\s"'`)>]+/g) || [];
  for (const m of pgMatches) {
    if (m.length > 'postgresql://...'.length && !isSafePlaceholderValue(m, relativeFile)) {
      recordReal('postgresql://');
    } else {
      recordSafe('postgresql://');
    }
  }

  // 5. Bearer (Header Authorization: Bearer <token thật>)
  const bearerMatches = content.match(/Bearer(?:\s+[^\s"'`,;)]+)?/g) || [];
  for (const m of bearerMatches) {
    const tokenPart = m.replace(/^Bearer\s*/, '').trim();
    if (
      tokenPart.length >= 16 &&
      !tokenPart.startsWith('${') &&
      !tokenPart.startsWith('$') &&
      !tokenPart.startsWith('<') &&
      !isSafePlaceholderValue(tokenPart, relativeFile)
    ) {
      recordReal('Bearer');
    } else {
      recordSafe('Bearer');
    }
  }

  // 6. password= (Gán password=<giá trị thật> trong chuỗi cấu hình/URL/env)
  const pwdMatches = content.match(/password=[^\s"'`&;)]*/gi) || [];
  for (const m of pwdMatches) {
    const rhs = m.slice(m.indexOf('=') + 1).trim();
    if (
      rhs.length >= 6 &&
      !rhs.startsWith('${') &&
      !rhs.startsWith('$') &&
      !rhs.startsWith('<') &&
      !rhs.startsWith('[') &&
      !isSafePlaceholderValue(rhs, relativeFile)
    ) {
      recordReal('password=');
    } else {
      recordSafe('password=');
    }
  }

  // 7. API_KEY= (Ví dụ GEMINI_API_KEY=..., BREVO_API_KEY=..., RESEND_API_KEY=...)
  const apiKeyMatches = content.match(/[A-Z0-9_]*API_KEY=[^\s#]*/g) || [];
  for (const m of apiKeyMatches) {
    const rhs = m
      .slice(m.indexOf('=') + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (
      rhs.length >= 8 &&
      !rhs.startsWith('${') &&
      !rhs.startsWith('$') &&
      !rhs.startsWith('<') &&
      !rhs.startsWith('[') &&
      !isSafePlaceholderValue(rhs, relativeFile)
    ) {
      recordReal('API_KEY=');
    } else {
      recordSafe('API_KEY=');
    }
  }

  return { realFindings, safeOccurrences };
}

function walkFilesExcluding(rootDir: string, excludedDirs: ReadonlySet<string>): string[] {
  const results: string[] = [];
  const walk = (currentDir: string) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (excludedDirs.has(entry.name) || excludedDirs.has(relPath)) {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  };
  walk(rootDir);
  return results.sort();
}

/**
 * Kiểm tra một đường dẫn tương đối (`relPath`, phân cách bằng `/`) có bị loại bởi các dòng quy tắc trong `.gitignore` hay không.
 * Hỗ trợ đầy đủ:
 * - Quy tắc thư mục kết thúc bằng `/` (ví dụ `node_modules/`, `.data/`, `dist/`)
 * - Quy tắc ký tự đại diện `*` và `?` (ví dụ `*.log`, `.env*`)
 * - Quy tắc phủ định bắt đầu bằng `!` (ví dụ `!.env.example`)
 */
export function isPathIgnoredByGitignore(relPath: string, gitignoreLines: string[]): boolean {
  const cleanRel = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleanRel || cleanRel === '.git' || cleanRel.startsWith('.git/')) {
    return true;
  }

  const segments = cleanRel.split('/');
  const baseName = segments[segments.length - 1];
  let ignored = false;

  const globToRegExp = (globPattern: string): RegExp => {
    const escaped = globPattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]');
    return new RegExp(`^${escaped}$`);
  };

  for (const rawLine of gitignoreLines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const isNegation = line.startsWith('!');
    const patternRaw = (isNegation ? line.slice(1) : line).trim();
    if (!patternRaw) continue;

    const isDirRule = patternRaw.endsWith('/');
    const normPattern = patternRaw.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!normPattern) continue;

    let matched = false;
    if (isDirRule) {
      if (normPattern.includes('/')) {
        matched = cleanRel === normPattern || cleanRel.startsWith(`${normPattern}/`);
      } else {
        matched =
          cleanRel === normPattern ||
          cleanRel.startsWith(`${normPattern}/`) ||
          segments.slice(0, -1).includes(normPattern);
      }
    } else if (normPattern.includes('/')) {
      const regex = globToRegExp(normPattern);
      matched = regex.test(cleanRel) || cleanRel.startsWith(`${normPattern}/`);
    } else {
      const regex = globToRegExp(normPattern);
      matched = regex.test(baseName) || segments.some((seg) => regex.test(seg));
    }

    if (matched) {
      ignored = !isNegation;
    }
  }

  return ignored;
}

/**
 * Liệt kê danh sách tệp sẽ đưa lên Git:
 * - Nếu có thư mục `.git`: ưu tiên gọi `git ls-files -z --cached --others --exclude-standard` kết hợp lọc theo `.gitignore` thật.
 * - Nếu không có `.git`: duyệt cây thư mục và loại bỏ mọi đường dẫn khớp quy tắc đọc trực tiếp từ tệp `.gitignore` thật.
 */
export function listGitExportFiles(rootDir: string, gitignoreLines: string[]): string[] {
  const dotGitDir = path.join(rootDir, '.git');
  if (fs.existsSync(dotGitDir)) {
    try {
      const rawOut = execFileSync(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      );
      const relFiles = rawOut
        .split('\0')
        .map((s) => s.trim())
        .filter((rel) => rel.length > 0 && !isPathIgnoredByGitignore(rel, gitignoreLines));
      const absFiles = relFiles
        .map((rel) => path.resolve(rootDir, rel))
        .filter((abs) => fs.existsSync(abs) && fs.statSync(abs).isFile());
      return Array.from(new Set(absFiles)).sort();
    } catch {
      // Fallback sang bộ lọc đọc trực tiếp từ .gitignore nếu môi trường không gọi được git CLI
    }
  }

  const results: string[] = [];
  const walk = (currentDir: string) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (entry.name === '.git' || isPathIgnoredByGitignore(`${relPath}/`, gitignoreLines)) {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        if (!isPathIgnoredByGitignore(relPath, gitignoreLines)) {
          results.push(fullPath);
        }
      }
    }
  };
  walk(rootDir);
  return results.sort();
}

export function runExportCheck(rootDir: string = process.cwd()): ExportCheckReport {
  // 1. Kiểm tra file .env và .env.example
  const rootEntries = fs.readdirSync(rootDir, { withFileTypes: true });
  const forbiddenEnvFiles: string[] = [];
  let envFileExists = false;
  let envExampleExists = false;

  for (const entry of rootEntries) {
    if (!entry.isFile()) continue;
    if (entry.name === '.env.example') {
      envExampleExists = true;
    } else if (entry.name === '.env' || entry.name.startsWith('.env.')) {
      forbiddenEnvFiles.push(entry.name);
      if (entry.name === '.env') {
        envFileExists = true;
      }
    }
  }

  // 2. Kiểm tra .gitignore không chặn public/seed-images hoặc *.svg
  const gitignorePath = path.join(rootDir, '.gitignore');
  const gitignoreContent = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf8')
    : '';
  const gitignoreLines = gitignoreContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  const gitignoreBlocksSeedImages = gitignoreLines.some(
    (line) =>
      !line.startsWith('!') &&
      (line.includes('seed-images') || line === 'public' || line === 'public/' || line === '/public/')
  );
  const gitignoreBlocksSvg = gitignoreLines.some(
    (line) => !line.startsWith('!') && (line === '*.svg' || line.endsWith('/*.svg') || line === '**/*.svg')
  );

  // 3. Quét toàn bộ file (trừ node_modules, dist, .data, .git) tìm mẫu khóa bí mật có giá trị thật
  const scannedFiles = walkFilesExcluding(rootDir, EXCLUDED_SCAN_DIRS);
  const realSecretFindings: SecretFinding[] = [];
  const safePlaceholderOccurrences: SecretFinding[] = [];

  for (const absFile of scannedFiles) {
    const relFile = path.relative(rootDir, absFile).replace(/\\/g, '/');
    // Bỏ qua các file ảnh nhị phân (.jpg, .png, .webp, .ico, .woff, .woff2)
    if (/\.(jpg|jpeg|png|webp|gif|ico|woff|woff2|ttf|eot)$/i.test(relFile)) {
      continue;
    }
    const content = fs.readFileSync(absFile, 'utf8');
    const { realFindings, safeOccurrences } = scanTextForSecretPatterns(content, relFile);
    realSecretFindings.push(...realFindings);
    safePlaceholderOccurrences.push(...safeOccurrences);
  }

  // 4. Tính dung lượng các thư mục và file sẽ đưa lên Git (loại các đường dẫn bị .gitignore bằng git ls-files hoặc quy tắc đọc từ .gitignore thật)
  const gitFiles = listGitExportFiles(rootDir, gitignoreLines);

  const dirMap = new Map<string, { bytes: number; fileCount: number }>();
  const filesOver5MB: { file: string; bytes: number }[] = [];
  let totalGitExportBytes = 0;
  let maxFileBytes = 0;
  let maxFilePath = '';

  for (const absFile of gitFiles) {
    const rel = path.relative(rootDir, absFile).replace(/\\/g, '/');
    const stat = fs.statSync(absFile);
    const size = stat.size;
    totalGitExportBytes += size;

    if (size > maxFileBytes) {
      maxFileBytes = size;
      maxFilePath = rel;
    }
    if (size > MAX_FILE_SIZE_BYTES) {
      filesOver5MB.push({ file: rel, bytes: size });
    }

    const parts = rel.split('/');
    const topKey = parts.length > 1 ? `${parts[0]}/` : '(root files)';
    const cur = dirMap.get(topKey) || { bytes: 0, fileCount: 0 };
    cur.bytes += size;
    cur.fileCount += 1;
    dirMap.set(topKey, cur);
  }

  const directorySizes = Array.from(dirMap.entries())
    .map(([name, info]) => ({ name, bytes: info.bytes, fileCount: info.fileCount }))
    .sort((a, b) => b.bytes - a.bytes);

  const ok =
    realSecretFindings.length === 0 &&
    !envFileExists &&
    forbiddenEnvFiles.length === 0 &&
    envExampleExists &&
    !gitignoreBlocksSeedImages &&
    !gitignoreBlocksSvg &&
    filesOver5MB.length === 0;

  return {
    ok,
    scannedFilesCount: scannedFiles.length,
    realSecretFindings,
    safePlaceholderOccurrences,
    envFileExists,
    envExampleExists,
    forbiddenEnvFiles,
    gitignoreBlocksSeedImages,
    gitignoreBlocksSvg,
    totalGitExportBytes,
    directorySizes,
    filesOver5MB,
    maxFileBytes,
    maxFilePath,
  };
}

function formatKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = runExportCheck(process.cwd());

  console.log('=== KIỂM TRA SẴN SÀNG XUẤT MÃ NGUỒN LÊN GIT (npm run export:check — CHỈ ĐỌC) ===');
  console.log(`1. Quét mẫu khóa bí mật có giá trị thật (trừ node_modules, dist, .data, .git):`);
  console.log(`   - Các mẫu kiểm tra: sb_secret, AIza, eyJ, postgresql://, Bearer, password=, API_KEY=`);
  console.log(`   - Tổng số tệp đã quét: ${report.scannedFilesCount} tệp`);
  console.log(
    `   - Số phát hiện khóa bí mật thật bị lộ: ${report.realSecretFindings.length} (${report.realSecretFindings.length === 0 ? 'ĐẠT' : 'KHÔNG ĐẠT'})`
  );
  if (report.realSecretFindings.length > 0) {
    for (const f of report.realSecretFindings) {
      console.log(`     ❌ [VI PHẠM] file=${f.file} | pattern=${f.pattern}`);
    }
  }
  console.log(
    `   - Các vị trí chứa từ khóa mẫu nhưng là biến/placeholder/mock an toàn (chỉ in tên file và tên mẫu, KHÔNG in giá trị): ${report.safePlaceholderOccurrences.length} vị trí`
  );
  for (const s of report.safePlaceholderOccurrences) {
    console.log(`     • file=${s.file} | pattern=${s.pattern}`);
  }

  console.log('');
  console.log('2. Kiểm tra tệp môi trường (.env):');
  console.log(`   - Có tệp .env.example: ${report.envExampleExists ? 'CÓ (ĐẠT)' : 'KHÔNG (LỖI)'}`);
  console.log(
    `   - Có tệp .env (hoặc .env.* chứa cấu hình): ${report.forbiddenEnvFiles.length === 0 ? 'KHÔNG CÓ (ĐẠT)' : `CÓ (${report.forbiddenEnvFiles.join(', ')}) — LỖI`}`
  );

  console.log('');
  console.log('3. Kiểm tra quy tắc .gitignore:');
  console.log(
    `   - .gitignore có chặn public/seed-images không?: ${report.gitignoreBlocksSeedImages ? 'CÓ (LỖI)' : 'KHÔNG CHẶN (ĐẠT)'}`
  );
  console.log(
    `   - .gitignore có chặn *.svg không?: ${report.gitignoreBlocksSvg ? 'CÓ (LỖI)' : 'KHÔNG CHẶN (ĐẠT)'}`
  );

  console.log('');
  console.log('4. Thống kê dung lượng các thư mục sẽ đưa lên Git & kiểm tra giới hạn 5MB/file:');
  console.log('| # | Thư mục / Nhóm tệp | Số lượng tệp | Dung lượng (Bytes) | Dung lượng (KB / MB) |');
  console.log('|---|---|---:|---:|---:|');
  report.directorySizes.forEach((d, idx) => {
    console.log(
      `| ${idx + 1} | \`${d.name}\` | ${d.fileCount} | ${d.bytes} | ${formatKB(d.bytes)} (${formatMB(d.bytes)}) |`
    );
  });
  console.log(
    `| **TỔNG** | **Toàn bộ kho mã nguồn đưa lên Git** | **${report.directorySizes.reduce((s, d) => s + d.fileCount, 0)}** | **${report.totalGitExportBytes}** | **${formatKB(report.totalGitExportBytes)} (${formatMB(report.totalGitExportBytes)})** |`
  );
  console.log(
    `   - Tệp lớn nhất sẽ đưa lên Git: \`${report.maxFilePath}\` (${report.maxFileBytes} bytes = ${formatKB(report.maxFileBytes)})`
  );
  console.log(
    `   - Số tệp vượt 5MB (5,242,880 bytes): ${report.filesOver5MB.length} (${report.filesOver5MB.length === 0 ? 'ĐẠT' : 'KHÔNG ĐẠT'})`
  );

  if (!report.ok) {
    console.error('❌ export:check KHÔNG ĐẠT.');
    process.exit(1);
  }
  console.log('✅ export:check ĐẠT TOÀN BỘ TIÊU CHÍ AN TOÀN XUẤT MÃ NGUỒN.');
}
