import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import {
  resolveVisualSearchModelName,
  VISUAL_SEARCH_NEIGHBOR_GROUPS,
} from '../server/services/visualSearch.ts';
import { isStrictRuntimeMode } from '../server/config/runtimeMode.ts';
import { loadContainerSecretsIfMissing } from './load-container-env.ts';

const VISUAL_SEARCH_MODEL_NAME = resolveVisualSearchModelName();
const FALLBACK_MODEL_NAME = 'gemini-3.1-flash-lite-preview';
const MAX_GEMINI_CALLS = 18;
const RUNS_PER_IMAGE = 3;
const DELAY_BETWEEN_CALLS_MS = 800;
const BACKOFF_DELAYS_MS = [1200, 2500, 5000];
const STABILITY_CACHE_PATH = path.resolve(process.cwd(), '.data/visual-stability-cache.json');

let useStickyFallbackModel = false;

interface StabilityTargetImage {
  groupType: 'KHỚP_ỔN_ĐỊNH' | 'TỪNG_LỆCH';
  shortId: string;
  productSlug: string;
  expectedCategory: string;
  url: string;
  note: string;
}

interface StabilityRunRecord {
  category: string;
  colors: string[];
  confidence: number;
}

interface StabilityCacheFile {
  savedAt: string;
  modelName: string;
  totalGeminiCalls: number;
  items: Array<{
    shortId: string;
    productSlug: string;
    expectedCategory: string;
    url: string;
    runs: StabilityRunRecord[];
  }>;
}

const TARGET_IMAGES: readonly StabilityTargetImage[] = [
  {
    groupType: 'KHỚP_ỔN_ĐỊNH',
    shortId: 'photo-1598033129183',
    productSlug: 'ao-so-mi-nam-co-tau-vai-dui-linen-mat-me',
    expectedCategory: 'ao-so-mi',
    url: 'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=800&q=80',
    note: 'Ảnh sản phẩm khớp (Áo sơ mi cổ tàu trắng)',
  },
  {
    groupType: 'KHỚP_ỔN_ĐỊNH',
    shortId: 'photo-1584370848010',
    productSlug: 'quan-jean-nu-ong-loe-lung-sieu-cao-hack-dang',
    expectedCategory: 'quan-jean-denim',
    url: 'https://images.unsplash.com/photo-1584370848010-d7fe6bc767ec?auto=format&fit=crop&w=800&q=80',
    note: 'Ảnh sản phẩm khớp (Quần jean nữ xanh)',
  },
  {
    groupType: 'KHỚP_ỔN_ĐỊNH',
    shortId: 'photo-1591047139829',
    productSlug: 'ao-blazer-nu-phom-rong-cropped-thanh-lich',
    expectedCategory: 'ao-khoac-blazer',
    url: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=800&q=80',
    note: 'Ảnh sản phẩm khớp (Áo khoác/blazer nâu)',
  },
  {
    groupType: 'TỪNG_LỆCH',
    shortId: 'photo-1548883354',
    productSlug: 'ao-khoac-bomber-nam-kaki-2-lop-chong-gio',
    expectedCategory: 'ao-khoac-blazer',
    url: 'https://images.unsplash.com/photo-1548883354-7622d03aca27?auto=format&fit=crop&w=800&q=80',
    note: 'Ảnh từng lệch (lần trước ra ao-khoac-blazer, lần sau ra quan-tay-kaki)',
  },
  {
    groupType: 'TỪNG_LỆCH',
    shortId: 'photo-1578632767115',
    productSlug: 'ao-sweater-unisex-co-tron-ni-bong-basic',
    expectedCategory: 'ao-len-hoodie',
    url: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=800&q=80',
    note: 'Ảnh từng lệch (lần trước ra ao-len-hoodie, lần sau ra ao-khoac-blazer)',
  },
  {
    groupType: 'TỪNG_LỆCH',
    shortId: 'photo-1544441893',
    productSlug: 'ao-khoac-nam-gio-parachute-co-mu-truot-nuoc',
    expectedCategory: 'ao-khoac-blazer',
    url: 'https://images.unsplash.com/photo-1544441893-675973e31985?auto=format&fit=crop&w=800&q=80',
    note: 'Ảnh từng lệch (gắn cho áo khoác nhưng nhận diện ra ao-thun)',
  },
] as const;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function findNeighborGroupLabel(cat: string): string {
  const idx = VISUAL_SEARCH_NEIGHBOR_GROUPS.findIndex((g) => g.includes(cat));
  if (idx === -1) return `[${cat}]`;
  return `[${VISUAL_SEARCH_NEIGHBOR_GROUPS[idx].join(', ')}]`;
}

export function areCategoriesInSameNeighborGroup(
  expectedCategory: string,
  recognizedCategory: string
): boolean {
  if (!expectedCategory || !recognizedCategory) return false;
  if (expectedCategory === recognizedCategory) return true;
  return VISUAL_SEARCH_NEIGHBOR_GROUPS.some(
    (group) => group.includes(expectedCategory) && group.includes(recognizedCategory)
  );
}

async function fetchAndNormalizeImage(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'BaityFashionVisualStability/1.0',
      Accept: 'image/*,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`HTTP_${res.status} for ${url}`);
  }
  const raw = Buffer.from(await res.arrayBuffer());
  return sharp(raw)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
}

async function recognizeSingleRun(
  buffer: Buffer,
  apiKey: string,
  runIndex: number
): Promise<{
  category: string;
  colors: string[];
  confidence: number;
  modelUsed: string;
}> {
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  const base64Data = buffer.toString('base64');

  const prompt = `Bạn là chuyên gia phân loại sản phẩm thời trang của thương hiệu Baity Fashion tại Việt Nam (Lần đo #${runIndex}).
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
2. "colors": Mảng tối đa 3 màu sắc chủ đạo bằng tiếng Việt ngắn gọn.
3. "confidence": Độ tự tin từ 0.0 đến 1.0.`;

  const maxAttempts = BACKOFF_DELAYS_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const targetModel =
        useStickyFallbackModel || attempt >= 2 ? FALLBACK_MODEL_NAME : VISUAL_SEARCH_MODEL_NAME;
      const supportsThinkingLevel = /^gemini-[34]/i.test(targetModel);

      const response = await ai.models.generateContent({
        model: targetModel,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
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
              colors: { type: Type.ARRAY, items: { type: Type.STRING } },
              confidence: { type: Type.NUMBER },
            },
            required: ['category', 'colors', 'confidence'],
          },
        },
      });

      const parsed = JSON.parse((response.text || '{}').trim());
      return {
        category: String(parsed.category || 'khong-xac-dinh').trim(),
        colors: Array.isArray(parsed.colors)
          ? parsed.colors.map((c: unknown) => String(c).trim()).filter(Boolean)
          : [],
        confidence: Number(parsed.confidence ?? 0),
        modelUsed: targetModel,
      };
    } catch (err: any) {
      const msg = String(err?.message || '').toUpperCase();
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('QUOTA')) {
        useStickyFallbackModel = true;
      }
      if (attempt < maxAttempts) {
        await sleep(BACKOFF_DELAYS_MS[attempt - 1] || 3000);
        continue;
      }
      throw err;
    }
  }

  throw new Error('UNEXPECTED_STABILITY_RETRY_EXHAUSTED');
}

async function runVisualStability() {
  loadContainerSecretsIfMissing();
  if (isStrictRuntimeMode()) {
    console.error('❌ Từ chối thực thi: visual:stability không chạy ở chế độ strict production.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const hasLive = args.includes('--live');
  const hasConfirmCost = args.includes('--confirm-cost');

  let totalGeminiCalls = 0;
  let cachedRunsByShortId = new Map<string, StabilityRunRecord[]>();
  let usingSavedCache = false;

  if (!hasLive) {
    if (!fs.existsSync(STABILITY_CACHE_PATH)) {
      console.error(
        '❌ Chưa có tệp cache .data/visual-stability-cache.json. Để gọi Gemini mới, chạy `npm run visual:stability -- --live --confirm-cost`.'
      );
      process.exit(1);
    }
    const rawCache = JSON.parse(fs.readFileSync(STABILITY_CACHE_PATH, 'utf8')) as StabilityCacheFile & {
      rows?: StabilityCacheFile['items'];
    };
    for (const item of rawCache.items || rawCache.rows || []) {
      cachedRunsByShortId.set(item.shortId, item.runs);
    }
    usingSavedCache = true;
  } else {
    if (!hasConfirmCost) {
      console.error(
        '❌ Thiếu cờ xác nhận chi phí: Vui lòng chạy `npm run visual:stability -- --live --confirm-cost` (tối đa 18 lượt gọi Gemini cho 6 ảnh x 3 lần).'
      );
      process.exit(1);
    }
  }

  console.log('=== KIỂM TRA ĐỘ ỔN ĐỊNH NHẬN DIỆN GEMINI (6 ẢNH x 3 LẦN = 18 LƯỢT ĐO) ===');
  console.log(
    usingSavedCache
      ? `- Chế độ: ĐỌC KẾT QUẢ ĐÃ LƯU từ .data/visual-stability-cache.json (0 lượt gọi Gemini mới)`
      : `- Ngưỡng cứng số lượt gọi tối đa: ${MAX_GEMINI_CALLS} lượt | Giãn cách giữa các lượt: ${DELAY_BETWEEN_CALLS_MS}ms`
  );

  const summaryRows: Array<{
    idx: number;
    target: StabilityTargetImage;
    runs: StabilityRunRecord[];
    dominantCategory: string;
    sameCategoryCount: number;
    expectedNeighborGroup: string;
    recognizedNeighborGroups: string[];
    matchedNeighborRunCount: number;
    sameNeighborGroupWithExpected: boolean;
  }> = [];

  for (let i = 0; i < TARGET_IMAGES.length; i++) {
    const target = TARGET_IMAGES[i];
    let runs: StabilityRunRecord[] = [];

    if (usingSavedCache) {
      const saved = cachedRunsByShortId.get(target.shortId);
      if (!saved || saved.length < RUNS_PER_IMAGE) {
        throw new Error(`Thiếu dữ liệu đã lưu cho ảnh ${target.shortId}`);
      }
      runs = saved.slice(0, RUNS_PER_IMAGE);
    } else {
      const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || '').trim();
      if (!apiKey) {
        console.error('❌ Thiếu GEMINI_API_KEY trong môi trường.');
        process.exit(1);
      }
      const normalizedBuf = await fetchAndNormalizeImage(target.url);
      for (let r = 1; r <= RUNS_PER_IMAGE; r++) {
        if (totalGeminiCalls >= MAX_GEMINI_CALLS) {
          throw new Error(`Vượt ngưỡng cứng ${MAX_GEMINI_CALLS} lượt gọi Gemini`);
        }
        if (totalGeminiCalls > 0) {
          await sleep(DELAY_BETWEEN_CALLS_MS);
        }
        totalGeminiCalls += 1;
        const res = await recognizeSingleRun(normalizedBuf, apiKey, r);
        runs.push({
          category: res.category,
          colors: res.colors,
          confidence: res.confidence,
        });
      }
    }

    const catFreq = new Map<string, number>();
    for (const run of runs) {
      catFreq.set(run.category, (catFreq.get(run.category) || 0) + 1);
    }

    let dominantCategory = runs[0].category;
    let sameCategoryCount = 0;
    for (const [cat, count] of catFreq.entries()) {
      if (count > sameCategoryCount) {
        sameCategoryCount = count;
        dominantCategory = cat;
      }
    }

    const expectedNeighborGroup = findNeighborGroupLabel(target.expectedCategory);
    const recognizedNeighborGroups = Array.from(
      new Set(runs.map((run) => findNeighborGroupLabel(run.category)))
    );
    const matchedNeighborRunCount = runs.filter((run) =>
      areCategoriesInSameNeighborGroup(target.expectedCategory, run.category)
    ).length;
    const sameNeighborGroupWithExpected = matchedNeighborRunCount === RUNS_PER_IMAGE;

    summaryRows.push({
      idx: i + 1,
      target,
      runs,
      dominantCategory,
      sameCategoryCount,
      expectedNeighborGroup,
      recognizedNeighborGroups,
      matchedNeighborRunCount,
      sameNeighborGroupWithExpected,
    });
  }

  if (!usingSavedCache) {
    fs.mkdirSync(path.dirname(STABILITY_CACHE_PATH), { recursive: true });
    const cacheData: StabilityCacheFile = {
      savedAt: new Date().toISOString(),
      modelName: VISUAL_SEARCH_MODEL_NAME,
      totalGeminiCalls,
      items: summaryRows.map((r) => ({
        shortId: r.target.shortId,
        productSlug: r.target.productSlug,
        expectedCategory: r.target.expectedCategory,
        url: r.target.url,
        runs: r.runs,
      })),
    };
    fs.writeFileSync(STABILITY_CACHE_PATH, JSON.stringify(cacheData, null, 2), 'utf8');
  }

  console.log('');
  console.log('=== 1. BẢNG KẾT QUẢ CHI TIẾT 6 ẢNH x 3 LẦN CHẠY (DO SCRIPT SINH) ===');
  console.log(
    '| # | Nhóm ảnh | Ảnh (`shortId`) | Sản phẩm gắn trong Seed (`expectedCategory`) | Lần 1 (`category` / màu) | Lần 2 (`category` / màu) | Lần 3 (`category` / màu) | Số lần ra cùng category | Cùng nhóm loại lân cận? (`expectedCategory` vs `recognizedCategory`) |'
  );
  console.log('|---|---|---|---|---|---|---|---|---|');

  for (const row of summaryRows) {
    const r1 = `\`${row.runs[0].category}\` (${row.runs[0].colors.join(', ')})`;
    const r2 = `\`${row.runs[1].category}\` (${row.runs[1].colors.join(', ')})`;
    const r3 = `\`${row.runs[2].category}\` (${row.runs[2].colors.join(', ')})`;
    const sameCatStr = `**${row.sameCategoryCount}/${RUNS_PER_IMAGE}** (\`${row.dominantCategory}\`)`;
    const groupStr = row.sameNeighborGroupWithExpected
      ? `**CÓ** (${row.matchedNeighborRunCount}/${RUNS_PER_IMAGE} cùng nhóm ${row.expectedNeighborGroup})`
      : `**KHÔNG** (${row.matchedNeighborRunCount}/${RUNS_PER_IMAGE}: kỳ vọng \`${row.target.expectedCategory}\` ${row.expectedNeighborGroup} != nhận diện \`${row.dominantCategory}\` ${row.recognizedNeighborGroups.join(' / ')})`;

    console.log(
      `| ${row.idx} | ${row.target.groupType} | \`${row.target.shortId}\` | \`${row.target.productSlug}\` (\`${row.target.expectedCategory}\`) | ${r1} | ${r2} | ${r3} | ${sameCatStr} | ${groupStr} |`
    );
  }

  const count3of3 = summaryRows.filter((r) => r.sameCategoryCount === 3).length;
  const count2of3 = summaryRows.filter((r) => r.sameCategoryCount === 2).length;
  const count1of3 = summaryRows.filter((r) => r.sameCategoryCount === 1).length;
  const countSameNeighborWithExpected = summaryRows.filter(
    (r) => r.sameNeighborGroupWithExpected
  ).length;

  console.log('');
  console.log('=== 2. TỔNG KẾT ĐỘ ỔN ĐỊNH NHẬN DIỆN (DO SCRIPT TÍNH) ===');
  console.log(`- Tổng số ảnh kiểm tra: ${summaryRows.length} ảnh (3 ảnh khớp + 3 ảnh từng lệch)`);
  console.log(`- Tổng số lượt gọi Gemini mới trong lần chạy này: ${totalGeminiCalls}/${MAX_GEMINI_CALLS}`);
  console.log(`- Số ảnh ra cùng category cả 3/3 lần: ${count3of3}/${summaryRows.length} ảnh`);
  console.log(`- Số ảnh ra cùng category 2/3 lần: ${count2of3}/${summaryRows.length} ảnh`);
  console.log(`- Số ảnh ra 3 category khác nhau (1/3): ${count1of3}/${summaryRows.length} ảnh`);
  console.log(
    `- Số ảnh có loại nhận diện cùng nhóm lân cận với expectedCategory (3/3 lần): ${countSameNeighborWithExpected}/${summaryRows.length} ảnh`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runVisualStability().catch((err) => {
    console.error('[VISUAL_STABILITY_ERROR]', err?.message || err);
    process.exit(1);
  });
}

