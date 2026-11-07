import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { sql } from 'drizzle-orm';
import { initDatabase } from '../server/db/init.ts';
import { queryRows, closeDb } from '../server/db/index.ts';
import { seedDatabase } from '../server/db/seed.ts';
import {
  resolveVisualSearchModelName,
  VISUAL_SEARCH_MIN_CONFIDENCE,
} from '../server/services/visualSearch.ts';
import { isStrictRuntimeMode } from '../server/config/runtimeMode.ts';
import { loadContainerSecretsIfMissing } from './load-container-env.ts';

interface GeminiVisualAnalysisResult {
  category: string;
  gender: 'men' | 'women' | 'unisex' | 'unknown';
  colors: string[];
  styleTags: string[];
  description: string;
  confidence: number;
}

const VISUAL_SEARCH_MODEL_NAME = resolveVisualSearchModelName();
const FALLBACK_AUDIT_MODEL_NAME = 'gemini-3.1-flash-lite-preview';
const MAX_GEMINI_CALLS_DEFAULT = 60;
const MAX_GEMINI_CALLS_EXTENDED = 120;
const DELAY_BETWEEN_CALLS_MS = 800;
const BACKOFF_DELAYS_MS = [1200, 2500, 5000];
const AUDIT_CACHE_PATH = path.resolve(process.cwd(), '.data/visual-audit-cache.json');
let useStickyFallbackModel = false;

interface CachedRecognitionEntry {
  url: string;
  recognizedCategory: string;
  confidence: number;
  colors: string[];
  styleTags: string[];
  updatedAt: string;
}

type AuditCacheMap = Record<string, CachedRecognitionEntry>;

function loadAuditCache(): AuditCacheMap {
  try {
    if (fs.existsSync(AUDIT_CACHE_PATH)) {
      const raw = fs.readFileSync(AUDIT_CACHE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as AuditCacheMap;
      }
    }
  } catch {
    // Bỏ qua nếu cache chưa tồn tại hoặc hỏng
  }
  return {};
}

function saveAuditCache(cache: AuditCacheMap): void {
  try {
    const dir = path.dirname(AUDIT_CACHE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(AUDIT_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    // Không làm gián đoạn script nếu không ghi được cache
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyGeminiErrorCode(err: any): { code: string; retryable: boolean; detail: string } {
  const status = Number(err?.status || err?.statusCode || err?.code || 0);
  const msg = String(err?.message || err || '');
  const upper = msg.toUpperCase();

  if (status === 429 || upper.includes('429') || upper.includes('RESOURCE_EXHAUSTED') || upper.includes('QUOTA') || upper.includes('RATE LIMIT')) {
    return { code: 'GEMINI_429_RESOURCE_EXHAUSTED', retryable: true, detail: msg.slice(0, 160) };
  }
  if (status === 503 || upper.includes('503') || upper.includes('UNAVAILABLE') || upper.includes('OVERLOADED')) {
    return { code: 'GEMINI_503_UNAVAILABLE', retryable: true, detail: msg.slice(0, 160) };
  }
  if (status === 504 || upper.includes('TIMEOUT') || upper.includes('ABORT') || upper.includes('DEADLINE_EXCEEDED')) {
    return { code: 'GEMINI_TIMEOUT', retryable: true, detail: msg.slice(0, 160) };
  }
  if (status >= 500 || upper.includes('500') || upper.includes('INTERNAL') || upper.includes('FETCH FAILED') || upper.includes('ECONNRESET')) {
    return { code: `GEMINI_${status || 500}_INTERNAL`, retryable: true, detail: msg.slice(0, 160) };
  }
  if (status === 400 || upper.includes('400') || upper.includes('INVALID_ARGUMENT')) {
    return { code: 'GEMINI_400_INVALID_ARGUMENT', retryable: false, detail: msg.slice(0, 160) };
  }
  if (status === 401 || status === 403 || upper.includes('API_KEY') || upper.includes('PERMISSION_DENIED')) {
    return { code: `GEMINI_${status || 403}_AUTH_ERROR`, retryable: false, detail: msg.slice(0, 160) };
  }
  return {
    code: `GEMINI_ERROR_${status || 'UNKNOWN'}`,
    retryable: false,
    detail: msg.slice(0, 160),
  };
}

async function analyzeBufferWithBackoff(
  normalizedBuffer: Buffer,
  apiKey: string
): Promise<{
  ok: boolean;
  analysis?: GeminiVisualAnalysisResult;
  errorCode?: string;
  errorDetail?: string;
  attempts: number;
}> {
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  const base64Data = normalizedBuffer.toString('base64');

  const prompt = `Bạn là chuyên gia phân loại sản phẩm thời trang của thương hiệu Baity Fashion tại Việt Nam.
Hãy quan sát bức ảnh này và trích xuất thông tin trang phục chính trong ảnh theo đúng cấu trúc JSON yêu cầu:
1. "category": Mã danh mục gần đúng nhất trong 9 giá trị sau (nếu ảnh hoàn toàn KHÔNG có quần áo/giày dép/phụ kiện thời trang hoặc ảnh quá mờ/tối không nhận diện được, trả về "khong-xac-dinh"):
   - "ao-thun" (Áo thun, T-shirt, áo polo, áo phông, áo ba lỗ, tanktop)
   - "ao-so-mi" (Áo sơ mi tay dài, tay ngắn, áo kiểu công sở)
   - "ao-khoac-blazer" (Áo khoác, blazer, jacket, cardigan khoác ngoài, trench coat, áo gió, áo dạ)
   - "quan-jean-denim" (Quần jean, quần bò, trang phục chất liệu denim)
   - "quan-tay-kaki" (Quần tây, quần âu, quần kaki dài, quần ống rộng, quần ống suông dài, quần chinos, quần jogger dài)
   - "quan-short" (Quần short, quần đùi, quần lửng ngang gối)
   - "vay-dam" (Váy, đầm liền, chân váy chữ A, chân váy xếp ly, đầm dự tiệc, đầm maxi)
   - "ao-len-hoodie" (Áo len, sweater, áo nỉ, áo hoodie, sweatshirt)
   - "phu-kien-thoi-trang" (Túi xách, ví, thắt lưng, mũ nón, khăn choàng, kính mát, tất vớ, giày dép, phụ kiện)
   - "khong-xac-dinh" (Không phải sản phẩm thời trang hoặc ảnh lỗi/trống)
2. "gender": Giới tính phù hợp ("men", "women", "unisex", "unknown").
3. "colors": Mảng tối đa 3 màu sắc chủ đạo bằng tiếng Việt ngắn gọn (ví dụ: ["Đen", "Trắng", "Xanh navy", "Be", "Nâu", "Xám", "Hồng", "Đỏ", "Xanh rêu", "Kem", "Vàng", "Tím"]).
4. "styleTags": Mảng từ 2 đến 5 từ khóa mô tả kiểu dáng/chất liệu bằng tiếng Việt (ví dụ: ["cổ tròn", "tay ngắn", "form rộng", "cotton", "tối giản", "công sở", "dạo phố", "kẻ sọc"]).
5. "description": 1 câu ngắn tiếng Việt mô tả sản phẩm được nhận diện trong ảnh.
6. "confidence": Độ tự tin từ 0.0 đến 1.0 (nếu ảnh không phải thời trang hoặc ảnh trơn/nhiễu, đặt <= 0.2).`;

  const maxAttempts = BACKOFF_DELAYS_MS.length + 1;
  let lastErrorCode = 'GEMINI_UNKNOWN_ERROR';
  let lastErrorDetail = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      const targetModel =
        useStickyFallbackModel || (attempt >= 2 && lastErrorCode === 'GEMINI_429_RESOURCE_EXHAUSTED')
          ? FALLBACK_AUDIT_MODEL_NAME
          : VISUAL_SEARCH_MODEL_NAME;
      const supportsThinkingLevel = /^gemini-[34]/i.test(targetModel);

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('VISUAL_SEARCH_TIMEOUT_15S')), 15000);
      });

      const response = await Promise.race([
        ai.models.generateContent({
          model: targetModel,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Data,
                  },
                },
                { text: prompt },
              ],
            },
          ],
          config: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            ...(supportsThinkingLevel ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                category: { type: Type.STRING },
                gender: { type: Type.STRING },
                colors: { type: Type.ARRAY, items: { type: Type.STRING } },
                styleTags: { type: Type.ARRAY, items: { type: Type.STRING } },
                description: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
              },
              required: ['category', 'gender', 'colors', 'styleTags', 'description', 'confidence'],
            },
          },
        }),
        timeoutPromise,
      ]);
      if (timeoutHandle) clearTimeout(timeoutHandle);

      const rawText = (response.text || '{}').trim();
      const parsed = JSON.parse(rawText);
      const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));
      const category = String(parsed.category || 'khong-xac-dinh').trim();

      return {
        ok: true,
        attempts: attempt,
        analysis: {
          category,
          gender: ['men', 'women', 'unisex'].includes(parsed.gender) ? parsed.gender : 'unknown',
          colors: Array.isArray(parsed.colors)
            ? parsed.colors.map((c: unknown) => String(c).trim()).filter(Boolean).slice(0, 4)
            : [],
          styleTags: Array.isArray(parsed.styleTags)
            ? parsed.styleTags.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 6)
            : [],
          description: String(parsed.description || '').trim(),
          confidence,
        },
      };
    } catch (err: any) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const classified = classifyGeminiErrorCode(err);
      lastErrorCode = classified.code;
      lastErrorDetail = classified.detail;
      if (classified.code === 'GEMINI_429_RESOURCE_EXHAUSTED') {
        useStickyFallbackModel = true;
      }

      if (classified.retryable && attempt < maxAttempts) {
        const waitMs = BACKOFF_DELAYS_MS[attempt - 1] || 5000;
        await sleep(waitMs);
        continue;
      }
      break;
    }
  }

  return {
    ok: false,
    errorCode: lastErrorCode,
    errorDetail: lastErrorDetail,
    attempts: maxAttempts,
  };
}

async function fetchAndNormalizeUrl(url: string): Promise<{
  ok: boolean;
  buffer?: Buffer;
  errorReason?: string;
}> {
  try {
    if (url.startsWith('/seed-images/')) {
      const fullPath = path.resolve(process.cwd(), 'public', url.replace(/^\/+/, ''));
      if (!fs.existsSync(fullPath)) {
        return { ok: false, errorReason: 'LOCAL_FILE_NOT_FOUND' };
      }
      const rawBuf = fs.readFileSync(fullPath);
      const normalized = await sharp(rawBuf)
        .rotate()
        .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      return { ok: true, buffer: normalized };
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'BaityFashionVisualAudit/1.0',
        Accept: 'image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return { ok: false, errorReason: `HTTP_${res.status}` };
    }
    const arrayBuf = await res.arrayBuffer();
    const rawBuf = Buffer.from(arrayBuf);
    const normalized = await sharp(rawBuf)
      .rotate()
      .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { ok: true, buffer: normalized };
  } catch (err: any) {
    return { ok: false, errorReason: err?.name === 'TimeoutError' ? 'FETCH_TIMEOUT' : 'FETCH_OR_SHARP_ERROR' };
  }
}

async function runAuditSeed() {
  loadContainerSecretsIfMissing();
  if (isStrictRuntimeMode()) {
    console.error('❌ Từ chối thực thi: visual:audit-seed là công cụ kiểm thử dev, không chạy ở môi trường Production.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const isLive = args.includes('--live');
  const isConfirmed = args.includes('--confirm');
  const onlyErrors = args.includes('--only-errors');
  const confirmCost = args.includes('--confirm-cost');
  const isFresh = args.includes('--fresh');
  const maxGeminiCalls = isFresh
    ? 12
    : confirmCost
    ? MAX_GEMINI_CALLS_EXTENDED
    : MAX_GEMINI_CALLS_DEFAULT;

  if (!isLive || !isConfirmed) {
    console.log('ℹ️ Script visual:audit-seed yêu cầu cả hai cờ --live và --confirm để xác nhận gọi Gemini thật trên toàn bộ sản phẩm seed.');
    console.log('   Cách chạy: npm run visual:audit-seed -- --live --confirm [--fresh] [--only-errors] [--confirm-cost]');
    process.exit(0);
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'your-gemini-api-key') {
    console.error('❌ Thiếu GEMINI_API_KEY hợp lệ trong môi trường.');
    process.exit(1);
  }

  console.log(`=== AUDIT ẢNH SẢN PHẨM SEED BẰNG GEMINI (${VISUAL_SEARCH_MODEL_NAME}) ===`);
  console.log(
    `- Trần cứng số lệnh gọi Gemini mới: ${maxGeminiCalls} calls | Giãn cách: ${DELAY_BETWEEN_CALLS_MS}ms/call | Backoff: [${BACKOFF_DELAYS_MS.join(', ')}]ms | Chế độ: ${
      isFresh
        ? '--fresh (chỉ 12 sản phẩm /seed-images/*.jpg, bỏ qua cache cũ)'
        : onlyErrors
        ? '--only-errors (tái sử dụng cache cho ảnh đã đạt)'
        : 'full-audit'
    }`
  );

  try {
    await initDatabase();
    await seedDatabase();

    const allProducts = await queryRows<{
      id: string;
      name: string;
      slug: string;
      category_slug: string;
      category_name: string;
      image_url: string | null;
    }>(sql`
      SELECT
        p.id,
        p.name,
        p.slug,
        c.slug AS category_slug,
        c.name AS category_name,
        (
          SELECT pi.image_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          ORDER BY pi.is_primary DESC, pi.display_order ASC
          LIMIT 1
        ) AS image_url
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.is_active = true
      ORDER BY p.created_at ASC, p.id ASC;
    `);

    const products = isFresh
      ? allProducts.filter((p) => /^\/seed-images\/[a-z0-9-]+\.jpg$/i.test(p.image_url || ''))
      : allProducts;

    const auditCache = loadAuditCache();

    // Thống kê URL dùng chung
    const urlToProducts = new Map<string, { name: string; slug: string; categorySlug: string }[]>();
    for (const p of products) {
      const url = p.image_url || '(none)';
      const list = urlToProducts.get(url) || [];
      list.push({ name: p.name, slug: p.slug, categorySlug: p.category_slug });
      urlToProducts.set(url, list);
    }

    let geminiCallsUsed = 0;
    let cachedReusedCount = 0;
    let totalRetriesUsed = 0;

    interface AuditRow {
      index: number;
      name: string;
      slug: string;
      dbCategory: string;
      imageUrl: string;
      sharedCount: number;
      recognizedCategory: string;
      confidence: number;
      colors: string;
      updatedAt: string;
      status: 'MATCH' | 'MISMATCH' | 'LOW_CONF' | 'ERROR' | 'SKIPPED_CAP';
      note: string;
    }

    const auditRows: AuditRow[] = [];
    // Cache trong cùng lượt chạy theo URL để 2 sản phẩm dùng chung 1 URL không tốn 2 lần gọi Gemini trùng lặp
    const inRunUrlCache = new Map<
      string,
      {
        ok: boolean;
        recognizedCategory: string;
        confidence: number;
        colors: string[];
        updatedAt: string;
        errorCode?: string;
        source: 'LIVE' | 'CACHE';
      }
    >();

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const url = p.image_url || '';
      const sharedGroup = urlToProducts.get(url || '(none)') || [];

      if (!url) {
        auditRows.push({
          index: i + 1,
          name: p.name,
          slug: p.slug,
          dbCategory: p.category_slug,
          imageUrl: '(none)',
          sharedCount: sharedGroup.length,
          recognizedCategory: 'N/A',
          confidence: 0,
          colors: '-',
          updatedAt: '-',
          status: 'ERROR',
          note: 'NO_PRIMARY_IMAGE',
        });
        continue;
      }

      // Bỏ qua ảnh giữ chỗ SVG (placeholder-*.svg), không gọi Gemini trên ảnh giữ chỗ
      if (/^\/seed-images\/placeholder-[a-z0-9-]+\.svg$/i.test(url)) {
        auditRows.push({
          index: i + 1,
          name: p.name,
          slug: p.slug,
          dbCategory: p.category_slug,
          imageUrl: url,
          sharedCount: 1,
          recognizedCategory: 'PLACEHOLDER_SVG',
          confidence: 0,
          colors: '-',
          updatedAt: '-',
          status: 'SKIPPED_CAP',
          note: 'CHƯA_CÓ_ẢNH_THẬT (Bỏ qua ảnh giữ chỗ SVG, không gọi Gemini)',
        });
        continue;
      }

      // 1. Kiểm tra nếu URL này vừa được đánh giá trong cùng lượt chạy
      let urlEval = inRunUrlCache.get(url);

      // 2. Nếu bật --only-errors (và không có --fresh) và URL đã có kết quả thành công trong cache đĩa
      if (!isFresh && !urlEval && onlyErrors && auditCache[url] && auditCache[url].recognizedCategory !== 'ERROR') {
        const cached = auditCache[url];
        cachedReusedCount += 1;
        urlEval = {
          ok: true,
          recognizedCategory: cached.recognizedCategory,
          confidence: cached.confidence,
          colors: cached.colors,
          updatedAt: cached.updatedAt,
          source: 'CACHE',
        };
        inRunUrlCache.set(url, urlEval);
      }

      // 3. Nếu chưa có kết quả cho URL này, tải ảnh và gọi Gemini
      if (!urlEval) {
        const fetched = await fetchAndNormalizeUrl(url);
        if (!fetched.ok || !fetched.buffer) {
          urlEval = {
            ok: false,
            recognizedCategory: 'ERROR',
            confidence: 0,
            colors: [],
            updatedAt: new Date().toISOString(),
            errorCode: fetched.errorReason || 'FETCH_ERROR',
            source: 'LIVE',
          };
          inRunUrlCache.set(url, urlEval);
        } else if (geminiCallsUsed >= maxGeminiCalls) {
          auditRows.push({
            index: i + 1,
            name: p.name,
            slug: p.slug,
            dbCategory: p.category_slug,
            imageUrl: url,
            sharedCount: sharedGroup.length,
            recognizedCategory: 'SKIPPED',
            confidence: 0,
            colors: '-',
            updatedAt: '-',
            status: 'SKIPPED_CAP',
            note: `Chạm trần ${maxGeminiCalls} lệnh gọi Gemini`,
          });
          continue;
        } else {
          if (geminiCallsUsed > 0) {
            await sleep(DELAY_BETWEEN_CALLS_MS);
          }
          geminiCallsUsed += 1;
          const geminiRes = await analyzeBufferWithBackoff(fetched.buffer, apiKey);
          if (geminiRes.attempts > 1) {
            totalRetriesUsed += geminiRes.attempts - 1;
          }

          if (!geminiRes.ok || !geminiRes.analysis) {
            urlEval = {
              ok: false,
              recognizedCategory: 'ERROR',
              confidence: 0,
              colors: [],
              updatedAt: new Date().toISOString(),
              errorCode: geminiRes.errorCode || 'GEMINI_UNKNOWN_ERROR',
              source: 'LIVE',
            };
          } else {
            const analysis = geminiRes.analysis;
            const liveTimestamp = new Date().toISOString();
            urlEval = {
              ok: true,
              recognizedCategory: analysis.category,
              confidence: analysis.confidence,
              colors: analysis.colors,
              updatedAt: liveTimestamp,
              source: 'LIVE',
            };
            auditCache[url] = {
              url,
              recognizedCategory: analysis.category,
              confidence: analysis.confidence,
              colors: analysis.colors,
              styleTags: analysis.styleTags,
              updatedAt: liveTimestamp,
            };
            saveAuditCache(auditCache);
          }
          inRunUrlCache.set(url, urlEval);
        }
      }

      if (!urlEval.ok) {
        auditRows.push({
          index: i + 1,
          name: p.name,
          slug: p.slug,
          dbCategory: p.category_slug,
          imageUrl: url,
          sharedCount: sharedGroup.length,
          recognizedCategory: 'ERROR',
          confidence: 0,
          colors: '-',
          updatedAt: urlEval.updatedAt,
          status: 'ERROR',
          note: urlEval.errorCode || 'FETCH_OR_GEMINI_ERROR',
        });
        continue;
      }

      const isLowConf =
        urlEval.confidence < VISUAL_SEARCH_MIN_CONFIDENCE ||
        urlEval.recognizedCategory === 'khong-xac-dinh';
      const isMatch = !isLowConf && urlEval.recognizedCategory === p.category_slug;
      const status: AuditRow['status'] = isLowConf
        ? 'LOW_CONF'
        : isMatch
        ? 'MATCH'
        : 'MISMATCH';

      const sharedCats = Array.from(new Set(sharedGroup.map((g) => g.categorySlug)));
      let note = status === 'MATCH' ? 'Khớp danh mục' : `Lệch (${p.category_slug} != ${urlEval.recognizedCategory})`;
      if (sharedGroup.length > 1) {
        note += ` | Dùng chung URL (${sharedGroup.length} SP: ${sharedCats.join(', ')})`;
      }

      auditRows.push({
        index: i + 1,
        name: p.name,
        slug: p.slug,
        dbCategory: p.category_slug,
        imageUrl: url,
        sharedCount: sharedGroup.length,
        recognizedCategory: urlEval.recognizedCategory,
        confidence: urlEval.confidence,
        colors: urlEval.colors.join(', ') || '-',
        updatedAt: urlEval.updatedAt,
        status,
        note,
      });
    }

    console.log('');
    console.log('=== BẢNG KẾT QUẢ AUDIT TOÀN BỘ SẢN PHẨM SEED ===');
    console.log('| # | Tên sản phẩm | Danh mục DB | Gemini nhận diện | Độ tin cậy | Màu nhận diện | `updatedAt` (ISO) | Trạng thái | Ghi chú |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const r of auditRows) {
      console.log(
        `| ${r.index} | ${r.name} (\`${r.slug}\`) | \`${r.dbCategory}\` | \`${r.recognizedCategory}\` | ${r.confidence.toFixed(2)} | ${r.colors} | \`${r.updatedAt}\` | **${r.status}** | ${r.note} |`
      );
    }

    console.log('');
    console.log('=== DANH SÁCH URL ẢNH ĐANG BỊ DÙNG CHUNG GIỮA NHIỀU SẢN PHẨM ===');
    let sharedUrlGroups = 0;
    for (const [url, list] of urlToProducts.entries()) {
      if (list.length > 1) {
        sharedUrlGroups += 1;
        const distinctCats = Array.from(new Set(list.map((x) => x.categorySlug)));
        console.log(
          `- URL: ${url} (${list.length} sản phẩm, danh mục: [${distinctCats.join(', ')}]): ${list
            .map((x) => `${x.name} [${x.categorySlug}]`)
            .join('; ')}`
        );
      }
    }
    if (sharedUrlGroups === 0) {
      console.log('- Không có URL ảnh chính nào bị dùng chung.');
    }

    const matchCount = auditRows.filter((r) => r.status === 'MATCH').length;
    const mismatchCount = auditRows.filter((r) => r.status === 'MISMATCH').length;
    const lowConfCount = auditRows.filter((r) => r.status === 'LOW_CONF').length;
    const errorCount = auditRows.filter((r) => r.status === 'ERROR').length;
    const skippedCount = auditRows.filter((r) => r.status === 'SKIPPED_CAP').length;

    console.log('');
    console.log('=== TỔNG KẾT AUDIT SEED ===');
    console.log(`- Tổng số sản phẩm đang hiển thị (is_active=true): ${products.length}`);
    console.log(
      `- Số lệnh gọi Gemini mới đã dùng: ${geminiCallsUsed}/${maxGeminiCalls} (số lần retry backoff: ${totalRetriesUsed}, tái sử dụng cache URL: ${cachedReusedCount})`
    );
    console.log(`- Khớp đúng danh mục (MATCH): ${matchCount}`);
    console.log(`- Lệch danh mục (MISMATCH): ${mismatchCount}`);
    console.log(`- Độ tin cậy thấp / không xác định (LOW_CONF): ${lowConfCount}`);
    console.log(`- Lỗi tải ảnh hoặc gọi API (ERROR): ${errorCount}`);
    console.log(`- Bỏ qua do chạm trần (SKIPPED_CAP): ${skippedCount}`);
    console.log(`- Số nhóm URL ảnh bị dùng chung bởi >= 2 sản phẩm: ${sharedUrlGroups}`);

    await closeDb().catch(() => {});
    process.exit(0);
  } catch (err: any) {
    console.error('[VISUAL_AUDIT_SEED_ERROR]', err?.message || err);
    await closeDb().catch(() => {});
    process.exit(1);
  }
}

runAuditSeed();
