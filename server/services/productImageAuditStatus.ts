import fs from 'node:fs';
import path from 'node:path';
import { normalizeVietnameseText } from '../db/seed.ts';

export type ProductImageAuditStatus =
  | 'OK'
  | 'MÀU_LỆCH'
  | 'LOẠI_LỆCH'
  | 'HỎNG'
  | 'DÙNG_CHUNG'
  | 'CHƯA_CÓ_ẢNH_THẬT';

export interface CachedVisualAuditEntry {
  url: string;
  recognizedCategory: string;
  confidence: number;
  colors: string[];
  styleTags: string[];
  updatedAt: string;
}

export interface ColorFamilyDefinition {
  familyId: string;
  familyLabel: string;
  keywordsNormalized: string[];
  descriptionVi: string;
}

export interface NeighborColorRule {
  pairLabel: string;
  families: readonly [string, string];
  isNeighbor: boolean;
  noteVi: string;
}

/**
 * Bảng quy tắc họ màu lân cận:
 * - Trắng và Be/Kem: LÂN CẬN (ví dụ "Trắng kem" thuộc Be/Kem được coi là khớp lân cận khi Gemini nhận "Trắng")
 * - Đen và Xám: LÂN CẬN (ví dụ "Đen" / "Xám than chì" dưới ánh sáng studio)
 * - Xanh dương/Navy/Denim và Xanh rêu/Olive: KHÔNG LÂN CẬN
 */
export const COLOR_FAMILY_NEIGHBOR_TABLE: readonly NeighborColorRule[] = [
  {
    pairLabel: 'Trắng <-> Be/Kem',
    families: ['Trắng', 'Be/Kem'],
    isNeighbor: true,
    noteVi: 'LÂN CẬN: Trắng tinh / trắng gạo và Trắng kem / kem ngà / be sáng được coi là khớp màu lân cận',
  },
  {
    pairLabel: 'Đen <-> Xám',
    families: ['Đen', 'Xám'],
    isNeighbor: true,
    noteVi: 'LÂN CẬN: Đen than / đen mờ và Xám than chì / xám đậm được coi là khớp màu lân cận',
  },
  {
    pairLabel: 'Xanh dương/Navy/Denim <-> Xanh rêu/Olive',
    families: ['Xanh dương/Navy/Denim', 'Xanh rêu/Olive'],
    isNeighbor: false,
    noteVi: 'KHÔNG LÂN CẬN: Xanh dương / navy / denim và Xanh rêu / olive là hai tông màu tách biệt, coi là MÀU_LỆCH',
  },
] as const;

export function areColorFamiliesNeighbor(familyA: string, familyB: string): boolean {
  if (!familyA || !familyB) return false;
  if (familyA === familyB) return true;
  return COLOR_FAMILY_NEIGHBOR_TABLE.some(
    (rule) =>
      rule.isNeighbor &&
      ((rule.families[0] === familyA && rule.families[1] === familyB) ||
        (rule.families[0] === familyB && rule.families[1] === familyA))
  );
}

/**
 * Bảng họ màu hẹp (11 họ màu chuẩn) dùng để đối chiếu giữa:
 * - Màu biến thể chính của sản phẩm trong CSDL (`product_variants.color_name`)
 * - Màu nhận diện trong `.data/visual-audit-cache.json` (`colors`)
 *
 * Quy tắc xử lý màu họa tiết ("Kẻ caro...", "Hoa...", "Phối...", "Sọc...", "Thân ... tay ...", "...viền..."):
 * - Trích xuất màu nền chính (màu chủ đạo của thân/nền trang phục) để đối chiếu theo bảng họ màu hẹp.
 */
export const NARROW_COLOR_FAMILY_TABLE: readonly ColorFamilyDefinition[] = [
  {
    familyId: 'be-kem',
    familyLabel: 'Be/Kem',
    keywordsNormalized: [
      'be',
      'kem',
      'khaki',
      'cat',
      'sand',
      'yen mach',
      'bo sua',
      'moc',
      'sua',
      'nga',
    ],
    descriptionVi:
      'Màu be, kem, trắng kem / kem ngà, cát (sand), vàng khaki nhạt, yến mạch, bơ sữa, be mộc',
  },
  {
    familyId: 'trang',
    familyLabel: 'Trắng',
    keywordsNormalized: ['trang tinh khoi', 'trang gao', 'trang anh ngoc trai', 'trang'],
    descriptionVi: 'Màu trắng tinh khôi, trắng gạo, trắng ngọc trai (lân cận với họ Be/Kem)',
  },
  {
    familyId: 'den',
    familyLabel: 'Đen',
    keywordsNormalized: ['den', 'black', 'than chi den', 'huyen bi'],
    descriptionVi: 'Màu đen tuyền, đen than, đen nhung, đen mờ (lân cận với họ Xám)',
  },
  {
    familyId: 'xam',
    familyLabel: 'Xám',
    keywordsNormalized: ['xam', 'ghi', 'tro', 'melange', 'heather', 'khoi'],
    descriptionVi: 'Màu xám than chì, xám tro, xám ghi, xám tiêu melange, xám khói (lân cận với họ Đen)',
  },
  {
    familyId: 'xanh-duong-navy-denim',
    familyLabel: 'Xanh dương/Navy/Denim',
    keywordsNormalized: [
      'xanh duong',
      'xanh navy',
      'navy',
      'denim',
      'indigo',
      'cham',
      'xanh nhat',
      'xanh dam',
      'xanh den',
      'xanh bien',
      'xanh lo',
      'xanh retro',
      'xanh blue',
      'bleached wash',
      'blue',
    ],
    descriptionVi:
      'Xanh dương, xanh navy, xanh chàm indigo, xanh denim wash, xanh biển (KHÔNG lân cận Xanh rêu/Olive)',
  },
  {
    familyId: 'xanh-reu-olive',
    familyLabel: 'Xanh rêu/Olive',
    keywordsNormalized: [
      'xanh reu',
      'reu',
      'olive',
      'xanh la',
      'xanh xo thom',
      'xanh ngoc bich',
      'quan doi',
      'safari',
    ],
    descriptionVi:
      'Xanh rêu, xanh olive, rêu quân đội, rêu safari, xanh lá/xô thơm (KHÔNG lân cận Xanh dương/Navy/Denim)',
  },
  {
    familyId: 'nau-camel',
    familyLabel: 'Nâu/Camel',
    keywordsNormalized: [
      'nau',
      'camel',
      'lac da',
      'caramel',
      'ca phe',
      'so-co-la',
      'socola',
      'hat de',
      'mocha',
      'que',
      'da bo',
      'dat',
      'terracotta',
      'cam dat',
    ],
    descriptionVi: 'Nâu da bò, nâu đất, camel (lạc đà), caramel, cà phê, sô-cô-la, hạt dẻ, mocha, quế',
  },
  {
    familyId: 'do',
    familyLabel: 'Đỏ',
    keywordsNormalized: ['do', 'do do', 'burgundy', 'ruou vang'],
    descriptionVi: 'Đỏ tươi, đỏ đô, đỏ rượu vang',
  },
  {
    familyId: 'vang',
    familyLabel: 'Vàng',
    keywordsNormalized: ['vang bo', 'vang tuoi', 'vang nghe', 'vang'],
    descriptionVi: 'Vàng tươi, vàng bơ, vàng nghệ (không tính vàng khaki thuộc nhóm Be/Kem)',
  },
  {
    familyId: 'hong',
    familyLabel: 'Hồng',
    keywordsNormalized: ['hong', 'pastel hong', 'hong phan', 'hong do'],
    descriptionVi: 'Hồng phấn, hồng đỗ pastel, hồng đất',
  },
  {
    familyId: 'tim',
    familyLabel: 'Tím',
    keywordsNormalized: ['tim', 'lavender', 'oai huong'],
    descriptionVi: 'Tím, tím pastel, tím hoa cà',
  },
] as const;

export const KNOWN_BROKEN_SEED_URLS = new Set<string>([
  'https://images.unsplash.com/photo-1542272604-780c96856592?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1625910513413-7e5b66f28424?auto=format&fit=crop&w=800&q=80',
]);

const AUDIT_CACHE_PATH = path.resolve(process.cwd(), '.data/visual-audit-cache.json');

export function isPlaceholderSeedImageUrl(url: string | null | undefined): boolean {
  const clean = (url || '').trim();
  return /^\/seed-images\/placeholder-[a-z0-9-]+\.svg$/i.test(clean);
}

export function isLocalSeedImageUrl(url: string | null | undefined): boolean {
  const clean = (url || '').trim();
  return /^\/seed-images\/[a-z0-9_.-]+\.(jpg|jpeg|png|webp|svg)$/i.test(clean);
}

export function doesLocalPublicFileExist(urlPath: string): boolean {
  const clean = (urlPath || '').trim();
  if (!clean.startsWith('/') || clean.includes('..')) return false;
  const absPath = path.resolve(process.cwd(), 'public', clean.replace(/^\/+/, ''));
  const publicRoot = path.resolve(process.cwd(), 'public');
  if (!absPath.startsWith(publicRoot + path.sep)) return false;
  try {
    const stat = fs.statSync(absPath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export function loadVisualAuditCacheFromDisk(): Record<string, CachedVisualAuditEntry> {
  try {
    if (fs.existsSync(AUDIT_CACHE_PATH)) {
      const raw = fs.readFileSync(AUDIT_CACHE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, CachedVisualAuditEntry>;
      }
    }
  } catch {
    // Ignore cache read error
  }
  return {};
}

/**
 * Phân loại 1 chuỗi màu đơn lẻ sang danh sách họ màu hẹp (`familyLabel`).
 */
export function classifySingleColorPhraseToFamilies(rawPhrase: string): string[] {
  const norm = normalizeVietnameseText(rawPhrase || '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!norm) return [];

  // Đặc thù "trắng kem", "trắng kem ngà", "trắng kem sữa", "trắng cát sand" -> thuộc họ Be/Kem
  if (
    norm.includes('trang kem') ||
    norm.includes('trang cat') ||
    norm.includes('vang khaki') ||
    norm.includes('nau be')
  ) {
    if (norm.includes('nau be')) {
      return ['Nâu/Camel', 'Be/Kem'];
    }
    return ['Be/Kem'];
  }

  const matched: string[] = [];
  const words = norm.split(' ');

  const hasWordOrPhrase = (kw: string) => {
    if (kw.includes(' ')) {
      return norm.includes(kw);
    }
    return words.includes(kw);
  };

  for (const fam of NARROW_COLOR_FAMILY_TABLE) {
    if (fam.familyId === 'trang') {
      if (hasWordOrPhrase('trang') && !norm.includes('trang kem') && !norm.includes('trang cat')) {
        matched.push(fam.familyLabel);
      }
      continue;
    }
    if (fam.familyId === 'vang') {
      if (hasWordOrPhrase('vang') && !norm.includes('vang khaki')) {
        matched.push(fam.familyLabel);
      }
      continue;
    }
    for (const kw of fam.keywordsNormalized) {
      if (hasWordOrPhrase(kw)) {
        matched.push(fam.familyLabel);
        break;
      }
    }
  }

  return Array.from(new Set(matched));
}

/**
 * Trích xuất họ màu nền chính từ tên màu biến thể chính của sản phẩm (`product_variants.color_name`).
 */
export function extractVariantMainColorFamilies(variantColorName: string): {
  isPatternedOrMulti: boolean;
  extractedBaseText: string;
  families: string[];
} {
  const raw = (variantColorName || '').trim();
  const norm = normalizeVietnameseText(raw).replace(/\s+/g, ' ').trim();

  // 1. "Hoa nền ..."
  const hoaNenMatch = norm.match(/^hoa nen\s+(.+)$/);
  if (hoaNenMatch) {
    const baseText = hoaNenMatch[1];
    return {
      isPatternedOrMulti: true,
      extractedBaseText: baseText,
      families: classifySingleColorPhraseToFamilies(baseText),
    };
  }

  // 2. "Họa tiết ..."
  if (norm.startsWith('hoa tiet ')) {
    const baseText = norm.replace(/^hoa tiet\s+(tho cam\s+)?/, '').trim();
    return {
      isPatternedOrMulti: true,
      extractedBaseText: baseText,
      families: classifySingleColorPhraseToFamilies(baseText),
    };
  }

  // 3. "<Màu nền> viền <Màu viền>"
  if (norm.includes(' vien ')) {
    const baseText = norm.split(' vien ')[0].trim();
    return {
      isPatternedOrMulti: true,
      extractedBaseText: baseText,
      families: classifySingleColorPhraseToFamilies(baseText),
    };
  }

  // 4. "Thân <Màu thân> tay <Màu tay>"
  const thanTayMatch = norm.match(/^than\s+(.+?)\s+tay\s+(.+)$/);
  if (thanTayMatch) {
    const bodyColorText = thanTayMatch[1].trim();
    return {
      isPatternedOrMulti: true,
      extractedBaseText: bodyColorText,
      families: classifySingleColorPhraseToFamilies(bodyColorText),
    };
  }

  // 5. "Kẻ caro ...", "Phối ...", "Sọc ...", "Bộ 3 màu ..."
  if (
    norm.startsWith('ke caro ') ||
    norm.startsWith('phoi ') ||
    norm.startsWith('soc ') ||
    norm.startsWith('bo 3 mau ')
  ) {
    const cleaned = norm
      .replace(/^(ke caro|phoi|soc|bo 3 mau)\s+/, '')
      .trim();
    const parts = cleaned.split(/\s*(?:&|-|va)\s*/);
    const families = new Set<string>();
    for (const part of parts) {
      if (part === 'xanh trang') {
        families.add('Xanh dương/Navy/Denim');
        families.add('Trắng');
      } else {
        for (const f of classifySingleColorPhraseToFamilies(part)) {
          families.add(f);
        }
      }
    }
    return {
      isPatternedOrMulti: true,
      extractedBaseText: cleaned,
      families: Array.from(families),
    };
  }

  return {
    isPatternedOrMulti: false,
    extractedBaseText: raw,
    families: classifySingleColorPhraseToFamilies(raw),
  };
}

/**
 * Đối chiếu danh sách màu nhận diện trong cache (`cacheColors`) với màu biến thể chính (`variantColorName`),
 * có áp dụng quy tắc họ màu lân cận (Trắng <-> Be/Kem; Đen <-> Xám; Xanh dương != Xanh rêu).
 */
export function evaluateColorMatchWithCache(
  variantColorName: string,
  cacheColors: string[]
): {
  matched: boolean;
  matchType: 'EXACT' | 'NEIGHBOR' | 'NONE';
  variantFamilies: string[];
  recognizedFamilies: string[];
  isPatternedOrMulti: boolean;
} {
  const variantInfo = extractVariantMainColorFamilies(variantColorName);
  const recognizedSet = new Set<string>();
  for (const c of cacheColors || []) {
    for (const fam of classifySingleColorPhraseToFamilies(c)) {
      recognizedSet.add(fam);
    }
  }
  const recognizedFamilies = Array.from(recognizedSet);

  const exactMatch = variantInfo.families.some((vf) => recognizedSet.has(vf));
  if (exactMatch) {
    return {
      matched: true,
      matchType: 'EXACT',
      variantFamilies: variantInfo.families,
      recognizedFamilies,
      isPatternedOrMulti: variantInfo.isPatternedOrMulti,
    };
  }

  const neighborMatch = variantInfo.families.some((vf) =>
    recognizedFamilies.some((rf) => areColorFamiliesNeighbor(vf, rf))
  );

  return {
    matched: neighborMatch,
    matchType: neighborMatch ? 'NEIGHBOR' : 'NONE',
    variantFamilies: variantInfo.families,
    recognizedFamilies,
    isPatternedOrMulti: variantInfo.isPatternedOrMulti,
  };
}

/**
 * Tính trạng thái ảnh hiện tại của sản phẩm (CHỈ ĐỌC từ CSDL + cache, KHÔNG gọi Gemini):
 * - CHƯA_CÓ_ẢNH_THẬT: Đang dùng ảnh giữ chỗ SVG theo danh mục (`/seed-images/placeholder-<category>.svg`)
 * - HỎNG: HTTP không 200 hoặc tệp nội bộ không tồn tại
 * - DÙNG_CHUNG: URL ảnh chính (không phải placeholder) đang được dùng làm ảnh chính cho > 1 sản phẩm
 * - LOẠI_LỆCH: Danh mục nhận diện trong cache khác `categorySlug`
 * - MÀU_LỆCH: Danh mục nhận diện khớp `categorySlug`, nhưng họ màu nhận diện lệch với họ màu biến thể chính (kể cả khi đã tính nhóm lân cận)
 * - OK: Không hỏng, không dùng chung, loại khớp và màu khớp (hoặc ảnh thật `/seed-images/<slug>.jpg` / ảnh tải lên hợp lệ)
 */
export function computeProductImageAuditStatus(params: {
  imageUrl: string | null;
  categorySlug: string;
  primaryVariantColor: string;
  sharedPrimaryUrlCount: number;
  auditCache: Record<string, CachedVisualAuditEntry>;
  brokenUrlSet?: ReadonlySet<string>;
  isRegisteredProductUpload?: boolean;
}): {
  status: ProductImageAuditStatus;
  recognizedCategory: string | null;
  recognizedColors: string[];
  variantColorFamilies: string[];
  recognizedColorFamilies: string[];
  categoryMatched: boolean | null;
  colorMatched: boolean | null;
  colorMatchType: 'EXACT' | 'NEIGHBOR' | 'NONE' | null;
  httpOk: boolean;
} {
  const url = (params.imageUrl || '').trim();
  const brokenSet = params.brokenUrlSet || KNOWN_BROKEN_SEED_URLS;
  const variantInfo = extractVariantMainColorFamilies(params.primaryVariantColor || '');

  if (!url || brokenSet.has(url)) {
    return {
      status: 'HỎNG',
      recognizedCategory: null,
      recognizedColors: [],
      variantColorFamilies: variantInfo.families,
      recognizedColorFamilies: [],
      categoryMatched: null,
      colorMatched: null,
      colorMatchType: null,
      httpOk: false,
    };
  }

  // 1. Kiểm tra nếu là ảnh placeholder SVG theo danh mục
  if (isPlaceholderSeedImageUrl(url)) {
    const exists = doesLocalPublicFileExist(url);
    return {
      status: exists ? 'CHƯA_CÓ_ẢNH_THẬT' : 'HỎNG',
      recognizedCategory: null,
      recognizedColors: [],
      variantColorFamilies: variantInfo.families,
      recognizedColorFamilies: [],
      categoryMatched: null,
      colorMatched: null,
      colorMatchType: null,
      httpOk: exists,
    };
  }

  // 2. Kiểm tra nếu là ảnh thật nội bộ trong public/seed-images/<slug>.jpg
  if (isLocalSeedImageUrl(url)) {
    const exists = doesLocalPublicFileExist(url);
    if (!exists) {
      return {
        status: 'HỎNG',
        recognizedCategory: null,
        recognizedColors: [],
        variantColorFamilies: variantInfo.families,
        recognizedColorFamilies: [],
        categoryMatched: null,
        colorMatched: null,
        colorMatchType: null,
        httpOk: false,
      };
    }
    const cacheEntry = params.auditCache[url];
    const colorEval = cacheEntry
      ? evaluateColorMatchWithCache(params.primaryVariantColor || '', cacheEntry.colors || [])
      : null;
    const catMatched = cacheEntry ? cacheEntry.recognizedCategory === params.categorySlug : true;
    if (params.sharedPrimaryUrlCount > 1) {
      return {
        status: 'DÙNG_CHUNG',
        recognizedCategory: cacheEntry?.recognizedCategory ?? params.categorySlug,
        recognizedColors: cacheEntry?.colors ?? [params.primaryVariantColor].filter(Boolean),
        variantColorFamilies: variantInfo.families,
        recognizedColorFamilies: colorEval?.recognizedFamilies ?? variantInfo.families,
        categoryMatched: catMatched,
        colorMatched: colorEval?.matched ?? true,
        colorMatchType: colorEval?.matchType ?? 'EXACT',
        httpOk: true,
      };
    }
    if (cacheEntry && !catMatched) {
      return {
        status: 'LOẠI_LỆCH',
        recognizedCategory: cacheEntry.recognizedCategory,
        recognizedColors: cacheEntry.colors || [],
        variantColorFamilies: variantInfo.families,
        recognizedColorFamilies: colorEval?.recognizedFamilies ?? [],
        categoryMatched: false,
        colorMatched: colorEval?.matched ?? false,
        colorMatchType: colorEval?.matchType ?? 'NONE',
        httpOk: true,
      };
    }
    if (cacheEntry && !colorEval?.matched) {
      return {
        status: 'MÀU_LỆCH',
        recognizedCategory: cacheEntry.recognizedCategory,
        recognizedColors: cacheEntry.colors || [],
        variantColorFamilies: variantInfo.families,
        recognizedColorFamilies: colorEval?.recognizedFamilies ?? [],
        categoryMatched: true,
        colorMatched: false,
        colorMatchType: colorEval?.matchType ?? 'NONE',
        httpOk: true,
      };
    }
    return {
      status: 'OK',
      recognizedCategory: cacheEntry?.recognizedCategory ?? params.categorySlug,
      recognizedColors: cacheEntry?.colors ?? [params.primaryVariantColor].filter(Boolean),
      variantColorFamilies: variantInfo.families,
      recognizedColorFamilies: colorEval?.recognizedFamilies ?? variantInfo.families,
      categoryMatched: true,
      colorMatched: true,
      colorMatchType: colorEval?.matchType ?? 'EXACT',
      httpOk: true,
    };
  }

  // 3. Nếu ảnh đã được thay mới qua /api/upload (purpose = 'product')
  const isUploadedProductPath =
    params.isRegisteredProductUpload ||
    /^products\/[a-f0-9]{8,64}\/[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$/i.test(url) ||
    url.includes('/storage/v1/object/public/baity-public/products/');

  const cacheEntry = params.auditCache[url];
  const colorEval = cacheEntry
    ? evaluateColorMatchWithCache(params.primaryVariantColor || '', cacheEntry.colors || [])
    : null;
  const catMatched = cacheEntry ? cacheEntry.recognizedCategory === params.categorySlug : null;

  if (params.sharedPrimaryUrlCount > 1) {
    return {
      status: 'DÙNG_CHUNG',
      recognizedCategory: cacheEntry?.recognizedCategory ?? null,
      recognizedColors: cacheEntry?.colors ?? [],
      variantColorFamilies: variantInfo.families,
      recognizedColorFamilies: colorEval?.recognizedFamilies ?? [],
      categoryMatched: catMatched,
      colorMatched: colorEval?.matched ?? null,
      colorMatchType: colorEval?.matchType ?? null,
      httpOk: true,
    };
  }

  if (isUploadedProductPath && !cacheEntry) {
    return {
      status: 'OK',
      recognizedCategory: params.categorySlug,
      recognizedColors: [params.primaryVariantColor].filter(Boolean),
      variantColorFamilies: variantInfo.families,
      recognizedColorFamilies: variantInfo.families,
      categoryMatched: true,
      colorMatched: true,
      colorMatchType: 'EXACT',
      httpOk: true,
    };
  }

  if (!cacheEntry) {
    return {
      status: 'HỎNG',
      recognizedCategory: null,
      recognizedColors: [],
      variantColorFamilies: variantInfo.families,
      recognizedColorFamilies: [],
      categoryMatched: null,
      colorMatched: null,
      colorMatchType: null,
      httpOk: false,
    };
  }

  if (!catMatched) {
    return {
      status: 'LOẠI_LỆCH',
      recognizedCategory: cacheEntry.recognizedCategory,
      recognizedColors: cacheEntry.colors || [],
      variantColorFamilies: variantInfo.families,
      recognizedColorFamilies: colorEval?.recognizedFamilies ?? [],
      categoryMatched: false,
      colorMatched: colorEval?.matched ?? false,
      colorMatchType: colorEval?.matchType ?? 'NONE',
      httpOk: true,
    };
  }

  if (!colorEval?.matched) {
    return {
      status: 'MÀU_LỆCH',
      recognizedCategory: cacheEntry.recognizedCategory,
      recognizedColors: cacheEntry.colors || [],
      variantColorFamilies: variantInfo.families,
      recognizedColorFamilies: colorEval?.recognizedFamilies ?? [],
      categoryMatched: true,
      colorMatched: false,
      colorMatchType: colorEval?.matchType ?? 'NONE',
      httpOk: true,
    };
  }

  return {
    status: 'OK',
    recognizedCategory: cacheEntry.recognizedCategory,
    recognizedColors: cacheEntry.colors || [],
    variantColorFamilies: variantInfo.families,
    recognizedColorFamilies: colorEval.recognizedFamilies,
    categoryMatched: true,
    colorMatched: true,
    colorMatchType: colorEval.matchType,
    httpOk: true,
  };
}

