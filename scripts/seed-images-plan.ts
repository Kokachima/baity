import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { initDatabase } from '../server/db/init.ts';
import { queryRows, closeDb } from '../server/db/index.ts';
import { seedDatabase } from '../server/db/seed.ts';
import { isStrictRuntimeMode } from '../server/config/runtimeMode.ts';
import { loadContainerSecretsIfMissing } from './load-container-env.ts';
import {
  NARROW_COLOR_FAMILY_TABLE,
  COLOR_FAMILY_NEIGHBOR_TABLE,
  KNOWN_BROKEN_SEED_URLS,
  loadVisualAuditCacheFromDisk,
  computeProductImageAuditStatus,
  extractVariantMainColorFamilies,
  isPlaceholderSeedImageUrl,
  isLocalSeedImageUrl,
  doesLocalPublicFileExist,
  type ProductImageAuditStatus,
} from '../server/services/productImageAuditStatus.ts';

const REQUEST_TIMEOUT_MS = 8000;
const REQUEST_SPACING_MS = 120;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkImageResourceStatus(url: string): Promise<{
  ok: boolean;
  httpStatus: number | string;
  contentType: string;
  byteSize: number;
}> {
  const clean = (url || '').trim();
  if (clean.startsWith('/')) {
    if (!doesLocalPublicFileExist(clean)) {
      return {
        ok: false,
        httpStatus: 'LOCAL_404',
        contentType: 'none',
        byteSize: 0,
      };
    }
    const absPath = path.resolve(process.cwd(), 'public', clean.replace(/^\/+/, ''));
    const stat = fs.statSync(absPath);
    const ext = path.extname(absPath).toLowerCase();
    const contentType =
      ext === '.svg'
        ? 'image/svg+xml'
        : ext === '.png'
        ? 'image/png'
        : ext === '.webp'
        ? 'image/webp'
        : 'image/jpeg';
    return {
      ok: stat.size > 0,
      httpStatus: 200,
      contentType,
      byteSize: stat.size,
    };
  }

  try {
    const res = await fetch(clean, {
      method: 'GET',
      headers: {
        'User-Agent': 'BaityFashionSeedImagesPlan/1.0',
        Accept: 'image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const contentType = (res.headers.get('content-type') || 'unknown')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const buf = await res.arrayBuffer();
    const byteSize = buf.byteLength;
    const ok = res.ok && contentType.startsWith('image/') && byteSize > 0;
    return {
      ok,
      httpStatus: res.status,
      contentType,
      byteSize,
    };
  } catch {
    return {
      ok: false,
      httpStatus: 'ERR',
      contentType: 'none',
      byteSize: 0,
    };
  }
}

/**
 * 12 sản phẩm giữ ảnh thật trong bộ Demo 29 sản phẩm (đã chốt ở Mục 5b).
 */
export const DEMO_KEEP_REAL_IMAGE_SLUGS = new Set<string>([
  'ao-thun-unisex-oversized-graphic-minimalist',
  'ao-so-mi-oxford-dai-tay-phom-regular-nam',
  'ao-so-mi-nam-co-tau-vai-dui-linen-mat-me',
  'ao-blazer-nu-phom-rong-cropped-thanh-lich',
  'quan-jean-nu-ong-loe-lung-sieu-cao-hack-dang',
  'quan-jean-unisex-ong-suong-rong-rai-baggy-denim',
  'quan-kaki-nam-dang-slimfit-ton-chieu-cao',
  'ao-len-nam-co-lo-vai-cashmere-pha-am-ap',
  'ao-cardigan-nu-det-kim-cuc-go-mua-thu',
  'that-lung-da-bo-nam-mat-khoa-kim-loai-nguyen-khoi',
  'tui-xach-nu-tote-canvas-quai-da-phoi-dung-laptop',
  'tat-vo-unisex-co-cao-det-gan-cotton-khang-khuan-set-3-doi',
]);

/**
 * Danh sách 29 slug cố định cho bộ sản phẩm demo tinh gọn (3-4 sản phẩm mỗi danh mục chính).
 */
export const DEMO_CATALOG_SELECTED_SLUGS = new Set<string>([
  // 1. ao-thun (3 SP: 1 men, 1 women, 1 unisex)
  'ao-thun-nam-co-tron-cotton-pima-sieu-min', // men
  'ao-thun-nu-baby-tee-om-nhe-hoa-tiet-theu-nho', // women
  'ao-thun-unisex-oversized-graphic-minimalist', // unisex (Giữ ảnh thật)

  // 2. ao-so-mi (4 SP: 2 men, 1 women, 1 unisex)
  'ao-so-mi-oxford-dai-tay-phom-regular-nam', // men (Giữ ảnh thật)
  'ao-so-mi-nam-co-tau-vai-dui-linen-mat-me', // men (Giữ ảnh thật)
  'ao-so-mi-lua-satin-nu-co-no-dieu-da-cong-so', // women
  'ao-so-mi-unisex-phom-rong-ke-caro-flannel-am-ap', // unisex

  // 3. ao-khoac-blazer (4 SP: 2 men [1 blazer + 1 áo khoác bomber], 1 women, 1 unisex [áo khoác gió])
  'ao-khoac-blazer-nam-cong-so-2-khuy-hien-dai', // men (blazer)
  'ao-khoac-bomber-nam-kaki-2-lop-chong-gio', // men (áo khoác bomber)
  'ao-blazer-nu-phom-rong-cropped-thanh-lich', // women (Giữ ảnh thật)
  'ao-khoac-gio-unisex-windbreaker-phoi-mau-vintage', // unisex (áo khoác gió)

  // 4. quan-jean-denim (3 SP: 1 men, 1 women, 1 unisex)
  'quan-jean-nam-ong-dung-regular-selvedge-denim', // men
  'quan-jean-nu-ong-loe-lung-sieu-cao-hack-dang', // women (Giữ ảnh thật)
  'quan-jean-unisex-ong-suong-rong-rai-baggy-denim', // unisex (Giữ ảnh thật)

  // 5. quan-tay-kaki (3 SP: 1 men, 1 women, 1 unisex)
  'quan-kaki-nam-dang-slimfit-ton-chieu-cao', // men (Giữ ảnh thật)
  'quan-tay-nu-cap-cao-ong-rong-hack-chan', // women
  'quan-kaki-unisex-ong-suong-cargo-nhieu-tui', // unisex

  // 6. quan-short (3 SP: 1 men, 1 women, 1 unisex)
  'quan-short-kaki-nam-co-gian-thoang-mat', // men
  'quan-short-nu-lung-thun-ong-rong-vai-linen', // women
  'quan-short-ni-unisex-the-thao-dang-thoai-mai', // unisex

  // 7. vay-dam (3 SP: 3 women — danh mục vay-dam trong CSDL chỉ có đối tượng women)
  'dam-midi-nu-co-vuong-xe-ta-dang-chu-a-tinh-khoi', // women
  'vay-hoa-nhi-vintage-nu-co-v-that-no-eo', // women
  'chan-vay-xep-ly-dai-nu-phom-xoe-vintage', // women

  // 8. ao-len-hoodie (3 SP: 1 men, 1 women, 1 unisex)
  'ao-len-nam-co-lo-vai-cashmere-pha-am-ap', // men (Giữ ảnh thật)
  'ao-cardigan-nu-det-kim-cuc-go-mua-thu', // women (Giữ ảnh thật)
  'ao-hoodie-unisex-ni-chan-cua-theu-hinh-nho-toi-gian', // unisex

  // 9. phu-kien-thoi-trang (3 SP: 1 men, 1 women, 1 unisex)
  'that-lung-da-bo-nam-mat-khoa-kim-loai-nguyen-khoi', // men (Giữ ảnh thật)
  'tui-xach-nu-tote-canvas-quai-da-phoi-dung-laptop', // women (Giữ ảnh thật)
  'tat-vo-unisex-co-cao-det-gan-cotton-khang-khuan-set-3-doi', // unisex (Giữ ảnh thật)
]);

function genderLabelVi(gender: string): string {
  if (gender === 'men') return 'nam';
  if (gender === 'women') return 'nữ';
  return 'nam và nữ';
}

/**
 * Làm sạch tên sản phẩm khi đưa vào prompt tiếng Việt tạo ảnh để:
 * 1. Với sản phẩm có "Thêu Logo Baity" / "Thêu Chữ Baity" / "Họa Tiết Thêu Nhỏ": chuyển thành mô tả chi tiết hình/họa tiết thêu nhỏ tinh tế (không chứa chữ/logo thương hiệu).
 * 2. Giữ nguyên đầy đủ họa tiết và phối màu của sản phẩm (kẻ caro flannel, hoa nhí vintage, tay raglan phối màu, phối màu vintage...).
 * 3. Loại bỏ từ tiếng Anh chỉ giới tính (unisex) để tránh lặp/lẫn tiếng Anh trong prompt tiếng Việt.
 */
export function sanitizeProductNameForNoLogoPrompt(rawName: string): string {
  return rawName
    .replace(/thêu\s+logo\s+baity/gi, 'thêu hình nhỏ tối giản')
    .replace(/thêu\s+chữ\s+baity(\s+originals)?/gi, 'thêu họa tiết nhỏ tối giản')
    .replace(/\bwindbreaker\b/gi, 'chống gió')
    .replace(/\boversized\s+graphic\s+minimalist\b/gi, 'dáng rộng tối giản')
    .replace(/\bunisex\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countVietnameseWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function buildImageSpecAndPrompt(product: {
  name: string;
  slug: string;
  categorySlug: string;
  categoryName: string;
  targetGender: string;
  primaryColor: string;
  material: string;
}): {
  imageDescription: string;
  sampleViPrompt: string;
  promptWordCount: number;
  hasSmallEmbroidery: boolean;
} {
  const colorFam = extractVariantMainColorFamilies(product.primaryColor);
  const famText = colorFam.families.join(' / ') || product.primaryColor;
  const gText = genderLabelVi(product.targetGender);
  const cleanVisualName = sanitizeProductNameForNoLogoPrompt(product.name);
  const hasSmallEmbroidery =
    /thêu\s+logo\s+baity|thêu\s+chữ\s+baity|họa\s+tiết\s+thêu\s+nhỏ|thêu\s+hình\s+nhỏ\s+tối\s+giản/i.test(
      product.name
    );

  const cleanColorForPrompt = product.primaryColor
    .replace(/\bbaity\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const colorOrPatternPhrase = colorFam.isPatternedOrMulti
    ? `họa tiết/phối màu ${cleanColorForPrompt}`
    : `màu ${cleanColorForPrompt}`;

  const detailClause = hasSmallEmbroidery
    ? 'có chi tiết hình thêu nhỏ tinh tế, không người mẫu, không logo thương hiệu, không chữ lạ'
    : 'không người mẫu, không logo thương hiệu, không chữ lạ';

  const imageDescription =
    `Loại: ${product.categoryName} (${cleanVisualName}); Màu/họa tiết biến thể chính: ${product.primaryColor} (họ ${famText}); ` +
    `Chất liệu (từ cột products.material): ${product.material}; Đối tượng: ${gText}; ` +
    `Nền: trắng (#FFFFFF); Góc chụp: chính diện thẳng; Yêu cầu: ${detailClause}.`;

  const sampleViPrompt =
    `Ảnh studio: 01 ${cleanVisualName.toLowerCase()} (${gText}), ` +
    `${colorOrPatternPhrase}, ` +
    `chất liệu ${product.material.toLowerCase()}. ` +
    `Nền trắng #FFFFFF, góc chụp chính diện, ánh sáng đều, ${detailClause}, khung 1:1.`;

  const promptWordCount = countVietnameseWords(sampleViPrompt);
  return { imageDescription, sampleViPrompt, promptWordCount, hasSmallEmbroidery };
}

async function runSeedImagesPlan() {
  loadContainerSecretsIfMissing();
  if (isStrictRuntimeMode()) {
    console.error(
      '❌ Từ chối thực thi: seed:images-plan là công cụ kiểm tra kế hoạch dữ liệu dev, không chạy ở môi trường Production.'
    );
    process.exit(1);
  }

  const cachePath = path.resolve(process.cwd(), '.data/visual-audit-cache.json');
  if (!fs.existsSync(cachePath)) {
    console.error(
      '❌ Thiếu tệp cache .data/visual-audit-cache.json. Script seed:images-plan chỉ đọc (không tự tạo lại cache); vui lòng chạy npm run visual:audit-seed -- --live --confirm trước.'
    );
    process.exit(1);
  }

  try {
    await initDatabase();
    await seedDatabase();

    const auditCache = loadVisualAuditCacheFromDisk();
    if (Object.keys(auditCache).length === 0) {
      console.error(
        '❌ Tệp cache .data/visual-audit-cache.json đang trống hoặc không hợp lệ. Vui lòng chạy npm run visual:audit-seed -- --live --confirm trước.'
      );
      await closeDb().catch(() => {});
      process.exit(1);
    }

    const categories = await queryRows<{
      slug: string;
      name: string;
      display_order: number;
    }>(sql`
      SELECT slug, name, display_order
      FROM categories
      ORDER BY display_order ASC, slug ASC;
    `);

    const products = await queryRows<{
      id: string;
      name: string;
      slug: string;
      category_slug: string;
      category_name: string;
      target_gender: string;
      material: string;
      is_active: boolean;
      primary_color: string | null;
      primary_image_url: string | null;
    }>(sql`
      SELECT
        p.id,
        p.name,
        p.slug,
        c.slug AS category_slug,
        c.name AS category_name,
        p.target_gender,
        COALESCE(p.material, 'Cotton cao cấp') AS material,
        p.is_active,
        (
          SELECT pv.color_name
          FROM product_variants pv
          WHERE pv.product_id = p.id
          ORDER BY pv.created_at ASC, pv.id ASC
          LIMIT 1
        ) AS primary_color,
        (
          SELECT pi.image_url
          FROM product_images pi
          WHERE pi.product_id = p.id
          ORDER BY pi.is_primary DESC, pi.display_order ASC
          LIMIT 1
        ) AS primary_image_url
      FROM products p
      JOIN categories c ON c.id = p.category_id
      ORDER BY p.created_at ASC, p.id ASC;
    `);

    const secondaryImages = await queryRows<{
      product_name: string;
      product_slug: string;
      category_slug: string;
      primary_color: string | null;
      image_url: string;
      display_order: number;
    }>(sql`
      SELECT
        p.name AS product_name,
        p.slug AS product_slug,
        c.slug AS category_slug,
        (
          SELECT pv.color_name
          FROM product_variants pv
          WHERE pv.product_id = p.id
          ORDER BY pv.created_at ASC, pv.id ASC
          LIMIT 1
        ) AS primary_color,
        pi.image_url,
        pi.display_order
      FROM product_images pi
      JOIN products p ON p.id = pi.product_id
      JOIN categories c ON c.id = p.category_id
      WHERE pi.is_primary = false
      ORDER BY p.created_at ASC, pi.display_order ASC;
    `);

    const brokenUrlSet = new Set<string>(KNOWN_BROKEN_SEED_URLS);
    const allDistinctUrls = Array.from(
      new Set([
        ...products.map((p) => p.primary_image_url || '').filter(Boolean),
        ...secondaryImages.map((s) => s.image_url).filter(Boolean),
      ])
    );

    const httpResultMap = new Map<
      string,
      { ok: boolean; httpStatus: number | string; contentType: string; byteSize: number }
    >();
    for (let i = 0; i < allDistinctUrls.length; i++) {
      const u = allDistinctUrls[i];
      if (i > 0 && !u.startsWith('/')) await sleep(REQUEST_SPACING_MS);
      const res = await checkImageResourceStatus(u);
      httpResultMap.set(u, res);
      if (!res.ok) {
        brokenUrlSet.add(u);
      }
    }

    // Đếm số sản phẩm dùng chung cùng 1 primary_image_url (không tính ảnh placeholder SVG theo danh mục)
    const primaryUrlCounts = new Map<string, number>();
    for (const p of products) {
      const u = (p.primary_image_url || '').trim();
      if (u && !isPlaceholderSeedImageUrl(u)) {
        primaryUrlCounts.set(u, (primaryUrlCounts.get(u) || 0) + 1);
      }
    }

    const evaluatedProducts = products.map((p, idx) => {
      const url = (p.primary_image_url || '').trim();
      const sharedCount = isPlaceholderSeedImageUrl(url) ? 1 : primaryUrlCounts.get(url) || 0;
      const evalResult = computeProductImageAuditStatus({
        imageUrl: url,
        categorySlug: p.category_slug,
        primaryVariantColor: p.primary_color || '',
        sharedPrimaryUrlCount: sharedCount,
        auditCache,
        brokenUrlSet,
      });

      return {
        rowNumber: idx + 1,
        ...p,
        primaryColor: p.primary_color || 'N/A',
        primaryImageUrl: url,
        sharedCount,
        ...evalResult,
      };
    });

    console.log('=== 1. BẢNG HỌ MÀU HẸP & BẢNG QUY TẮC HỌ MÀU LÂN CẬN ===');
    console.log('| # | Họ màu hẹp (`familyLabel`) | Từ khóa chuẩn hóa nhận diện | Mô tả phạm vi màu |');
    console.log('|---|---|---|---|');
    NARROW_COLOR_FAMILY_TABLE.forEach((fam, idx) => {
      console.log(
        `| ${idx + 1} | **${fam.familyLabel}** | \`${fam.keywordsNormalized.join(', ')}\` | ${fam.descriptionVi} |`
      );
    });
    console.log('');
    console.log('#### 1.1. Bảng quy tắc họ màu lân cận (`COLOR_FAMILY_NEIGHBOR_TABLE`)');
    console.log('| # | Cặp họ màu đối chiếu | Có lân cận không? | Quy tắc áp dụng trong `evaluateColorMatchWithCache` |');
    console.log('|---|---|---|---|');
    COLOR_FAMILY_NEIGHBOR_TABLE.forEach((rule, idx) => {
      console.log(
        `| ${idx + 1} | **${rule.pairLabel}** | **${rule.isNeighbor ? 'CÓ (LÂN CẬN)' : 'KHÔNG LÂN CẬN'}** | ${rule.noteVi} |`
      );
    });

    console.log('');
    console.log('=== 2. KIỂM TRA ẢNH PHỤ (SECONDARY IMAGES) TRONG CSDL & CACHE ===');
    console.log(
      '| # | Sản phẩm (`slug`) | Danh mục | Màu biến thể chính | URL ảnh phụ | HTTP Status | Có trong `.data/visual-audit-cache.json`? | Ghi chú kiểm chứng |'
    );
    console.log('|---|---|---|---|---|---|---|---|');
    secondaryImages.forEach((sec, idx) => {
      const httpInfo = httpResultMap.get(sec.image_url);
      const inCache = Boolean(auditCache[sec.image_url]);
      const cacheEntry = auditCache[sec.image_url];
      const note = inCache
        ? `Đã có trong cache: loại=${cacheEntry.recognizedCategory}, màu=[${cacheEntry.colors.join(', ')}]`
        : isLocalSeedImageUrl(sec.image_url)
        ? 'Ảnh nội bộ trong public/seed-images'
        : 'CHƯA ĐO BẰNG GEMINI (visual:audit-seed chỉ quét ảnh chính is_primary=true; không được tự khẳng định loại/màu nếu chưa có lệnh đo)';
      console.log(
        `| ${idx + 1} | ${sec.product_name} (\`${sec.product_slug}\`) | \`${sec.category_slug}\` | ${sec.primary_color || 'N/A'} | ${sec.image_url} | ${httpInfo?.httpStatus ?? 'N/A'} (${httpInfo?.contentType ?? 'N/A'}) | **${inCache ? 'CÓ' : 'KHÔNG'}** | ${note} |`
      );
    });

    console.log('');
    console.log(
      `=== 3. BẢNG TRẠNG THÁI ẢNH HIỆN TẠI CỦA TOÀN BỘ ${evaluatedProducts.length} SẢN PHẨM TRONG CSDL ===`
    );
    console.log(
      '| # | Tên sản phẩm | Slug | Danh mục | Đối tượng | Màu biến thể chính (Họ màu) | Màu nhận diện Cache (Họ màu) | Loại nhận diện Cache | URL ảnh chính | Trạng thái ảnh hiện tại |'
    );
    console.log('|---|---|---|---|---|---|---|---|---|---|');
    for (const ep of evaluatedProducts) {
      const varFamStr = ep.variantColorFamilies.join(', ') || 'Chưa phân nhóm';
      const recColorsStr =
        ep.recognizedColors.length > 0
          ? `${ep.recognizedColors.join(', ')} (${ep.recognizedColorFamilies.join(', ')})`
          : 'N/A';
      const recCatStr = ep.recognizedCategory || (ep.status === 'CHƯA_CÓ_ẢNH_THẬT' ? 'placeholder-svg' : 'N/A (HTTP 404)');
      console.log(
        `| ${ep.rowNumber} | ${ep.name} | \`${ep.slug}\` | \`${ep.category_slug}\` | \`${ep.target_gender}\` | ${ep.primaryColor} (\`${varFamStr}\`) | ${recColorsStr} | \`${recCatStr}\` | ${ep.primaryImageUrl} | **${ep.status}** |`
      );
    }

    console.log('');
    console.log('=== 4. BẢNG ĐẾM THEO DANH MỤC x ĐỐI TƯỢNG x TRẠNG THÁI (DO SCRIPT TÍNH) ===');
    const hasPlaceholder = evaluatedProducts.some((p) => p.status === 'CHƯA_CÓ_ẢNH_THẬT');
    if (hasPlaceholder) {
      console.log(
        '| Danh mục (`category_slug`) | Đối tượng (`target_gender`) | OK | CHƯA_CÓ_ẢNH_THẬT | MÀU_LỆCH | LOẠI_LỆCH | HỎNG | DÙNG_CHUNG | Tổng |'
      );
      console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|');
    } else {
      console.log(
        '| Danh mục (`category_slug`) | Đối tượng (`target_gender`) | OK | MÀU_LỆCH | LOẠI_LỆCH | HỎNG | DÙNG_CHUNG | Tổng |'
      );
      console.log('|---|---|---:|---:|---:|---:|---:|---:|');
    }

    const grandTotals: Record<ProductImageAuditStatus, number> = {
      OK: 0,
      MÀU_LỆCH: 0,
      LOẠI_LỆCH: 0,
      HỎNG: 0,
      DÙNG_CHUNG: 0,
      CHƯA_CÓ_ẢNH_THẬT: 0,
    };

    for (const cat of categories) {
      const catProducts = evaluatedProducts.filter((p) => p.category_slug === cat.slug);
      const genders: Array<'men' | 'women' | 'unisex'> = ['men', 'women', 'unisex'];
      for (const g of genders) {
        const subset = catProducts.filter((p) => p.target_gender === g);
        if (subset.length === 0) continue;
        const counts: Record<ProductImageAuditStatus, number> = {
          OK: 0,
          MÀU_LỆCH: 0,
          LOẠI_LỆCH: 0,
          HỎNG: 0,
          DÙNG_CHUNG: 0,
          CHƯA_CÓ_ẢNH_THẬT: 0,
        };
        for (const item of subset) {
          counts[item.status] += 1;
          grandTotals[item.status] += 1;
        }
        if (hasPlaceholder) {
          console.log(
            `| \`${cat.slug}\` | \`${g}\` | ${counts.OK} | ${counts.CHƯA_CÓ_ẢNH_THẬT} | ${counts.MÀU_LỆCH} | ${counts.LOẠI_LỆCH} | ${counts.HỎNG} | ${counts.DÙNG_CHUNG} | **${subset.length}** |`
          );
        } else {
          console.log(
            `| \`${cat.slug}\` | \`${g}\` | ${counts.OK} | ${counts.MÀU_LỆCH} | ${counts.LOẠI_LỆCH} | ${counts.HỎNG} | ${counts.DÙNG_CHUNG} | **${subset.length}** |`
          );
        }
      }
      const catCounts: Record<ProductImageAuditStatus, number> = {
        OK: 0,
        MÀU_LỆCH: 0,
        LOẠI_LỆCH: 0,
        HỎNG: 0,
        DÙNG_CHUNG: 0,
        CHƯA_CÓ_ẢNH_THẬT: 0,
      };
      for (const item of catProducts) {
        catCounts[item.status] += 1;
      }
      if (hasPlaceholder) {
        console.log(
          `| **Tổng \`${cat.slug}\`** | **Tất cả** | **${catCounts.OK}** | **${catCounts.CHƯA_CÓ_ẢNH_THẬT}** | **${catCounts.MÀU_LỆCH}** | **${catCounts.LOẠI_LỆCH}** | **${catCounts.HỎNG}** | **${catCounts.DÙNG_CHUNG}** | **${catProducts.length}** |`
        );
      } else {
        console.log(
          `| **Tổng \`${cat.slug}\`** | **Tất cả** | **${catCounts.OK}** | **${catCounts.MÀU_LỆCH}** | **${catCounts.LOẠI_LỆCH}** | **${catCounts.HỎNG}** | **${catCounts.DÙNG_CHUNG}** | **${catProducts.length}** |`
        );
      }
    }

    if (hasPlaceholder) {
      console.log(
        `| **TỔNG CỘNG TOÀN BỘ CSDL** | **men=${evaluatedProducts.filter((p) => p.target_gender === 'men').length}, women=${evaluatedProducts.filter((p) => p.target_gender === 'women').length}, unisex=${evaluatedProducts.filter((p) => p.target_gender === 'unisex').length}** | **${grandTotals.OK}** | **${grandTotals.CHƯA_CÓ_ẢNH_THẬT}** | **${grandTotals.MÀU_LỆCH}** | **${grandTotals.LOẠI_LỆCH}** | **${grandTotals.HỎNG}** | **${grandTotals.DÙNG_CHUNG}** | **${evaluatedProducts.length}** |`
      );
    } else {
      console.log(
        `| **TỔNG CỘNG TOÀN BỘ CSDL** | **men=${evaluatedProducts.filter((p) => p.target_gender === 'men').length}, women=${evaluatedProducts.filter((p) => p.target_gender === 'women').length}, unisex=${evaluatedProducts.filter((p) => p.target_gender === 'unisex').length}** | **${grandTotals.OK}** | **${grandTotals.MÀU_LỆCH}** | **${grandTotals.LOẠI_LỆCH}** | **${grandTotals.HỎNG}** | **${grandTotals.DÙNG_CHUNG}** | **${evaluatedProducts.length}** |`
      );
    }

    console.log('');
    console.log('=== 5. DANH SÁCH SẢN PHẨM MÀU_LỆCH DO SCRIPT SINH (SAU KHI ÁP DỤNG HỌ MÀU LÂN CẬN) ===');
    const mauLechProducts = evaluatedProducts.filter((p) => p.status === 'MÀU_LỆCH');
    console.log(
      `- Số sản phẩm có trạng thái chính là MÀU_LỆCH (URL riêng, loại khớp, màu lệch cả sau khi xét nhóm lân cận): ${mauLechProducts.length} sản phẩm`
    );
    console.log(
      '| # | Dòng CSDL | Tên sản phẩm | Slug | Danh mục | Đối tượng | Màu biến thể chính (Họ màu) | Màu nhận diện trong Cache (Họ màu) | URL ảnh chính |'
    );
    console.log('|---|---|---|---|---|---|---|---|---|');
    mauLechProducts.forEach((p, idx) => {
      console.log(
        `| ${idx + 1} | #${p.rowNumber} | ${p.name} | \`${p.slug}\` | \`${p.category_slug}\` | \`${p.target_gender}\` | ${p.primaryColor} (\`${p.variantColorFamilies.join(', ')}\`) | ${p.recognizedColors.join(', ')} (\`${p.recognizedColorFamilies.join(', ')}\`) | ${p.primaryImageUrl} |`
      );
    });

    const neighborMatchedProducts = evaluatedProducts.filter(
      (p) => p.status === 'OK' && p.colorMatchType === 'NEIGHBOR'
    );
    if (neighborMatchedProducts.length > 0) {
      console.log(
        `- Sản phẩm chuyển từ MÀU_LỆCH sang OK nhờ quy tắc họ màu lân cận (Trắng <-> Be/Kem; Đen <-> Xám): ${neighborMatchedProducts.length} sản phẩm (${neighborMatchedProducts.map((p) => `#${p.rowNumber} \`${p.slug}\`: biến thể "${p.primaryColor}" [${p.variantColorFamilies.join(', ')}] <-> cache [${p.recognizedColors.join(', ')}] [${p.recognizedColorFamilies.join(', ')}]`).join('; ')}).`
      );
    }

    const sharedButAlsoColorMismatch = evaluatedProducts.filter(
      (p) => p.status === 'DÙNG_CHUNG' && p.categoryMatched === true && p.colorMatched === false
    );
    console.log(
      `- Ghi chú bổ sung: Trong ${grandTotals.DÙNG_CHUNG} sản phẩm DÙNG_CHUNG, có ${sharedButAlsoColorMismatch.length} sản phẩm cùng loại nhưng cũng lệch màu nếu xét riêng (${sharedButAlsoColorMismatch.map((p) => `#${p.rowNumber} ${p.slug}: biến thể "${p.primaryColor}" [${p.variantColorFamilies.join(', ')}] vs cache [${p.recognizedColors.join(', ')}]`).join('; ')}).`
    );

    console.log('');
    console.log(
      '=== 6. BẢNG KẾ HOẠCH BỘ SẢN PHẨM DEMO TINH GỌN (29 SẢN PHẨM: 12 GIỮ ẢNH THẬT + 17 CẦN ẢNH MỚI) ==='
    );
    console.log(
      '- Nguồn chi tiết chất liệu (ví dụ `220gsm`, `98% Cotton Denim`, `350gsm`, ...): đọc trực tiếp từ cột `products.material` trong CSDL PostgreSQL (được khởi tạo từ trường `material` của từng sản phẩm trong `server/db/seed.ts`).'
    );
    const demoProducts = evaluatedProducts.filter((p) => DEMO_CATALOG_SELECTED_SLUGS.has(p.slug));
    const hiddenProducts = evaluatedProducts.filter(
      (p) => !DEMO_CATALOG_SELECTED_SLUGS.has(p.slug)
    );

    const demoMenCount = demoProducts.filter((p) => p.target_gender === 'men').length;
    const demoWomenCount = demoProducts.filter((p) => p.target_gender === 'women').length;
    const demoUnisexCount = demoProducts.filter((p) => p.target_gender === 'unisex').length;
    const demoKeepProducts = demoProducts.filter((p) => DEMO_KEEP_REAL_IMAGE_SLUGS.has(p.slug));
    const demoNeedNewProducts = demoProducts.filter((p) => !DEMO_KEEP_REAL_IMAGE_SLUGS.has(p.slug));

    console.log(
      `- Tổng số sản phẩm trong bộ demo tinh gọn (do script tính): ${demoProducts.length} sản phẩm (Nam: ${demoMenCount}, Nữ: ${demoWomenCount}, Unisex: ${demoUnisexCount}).`
    );
    console.log(
      `- Trong đó: Giữ ảnh thật (\`/seed-images/<slug>.jpg\`): ${demoKeepProducts.length} sản phẩm | Cần ảnh mới (dùng tạm \`/seed-images/placeholder-<category>.svg\`): ${demoNeedNewProducts.length} sản phẩm | Ẩn khỏi bộ demo: ${hiddenProducts.length} sản phẩm.`
    );

    console.log('');
    console.log(
      '#### 6.1. Bảng kiểm tra độ phủ bộ Demo theo Danh mục chính x Đối tượng (do script tính)'
    );
    console.log(
      '| # | Danh mục (`category_slug`) | Tên danh mục | Tổng SP Demo | Nam (`men`) | Nữ (`women`) | Unisex (`unisex`) | Số SP giữ ảnh thật (12) | Số SP cần ảnh mới (17) | Ghi chú độ phủ |'
    );
    console.log('|---|---|---|---:|---:|---:|---:|---:|---:|---|');
    categories.forEach((cat, idx) => {
      const sub = demoProducts.filter((p) => p.category_slug === cat.slug);
      const m = sub.filter((p) => p.target_gender === 'men').length;
      const w = sub.filter((p) => p.target_gender === 'women').length;
      const u = sub.filter((p) => p.target_gender === 'unisex').length;
      const okCount = sub.filter((p) => DEMO_KEEP_REAL_IMAGE_SLUGS.has(p.slug)).length;
      const newCount = sub.filter((p) => !DEMO_KEEP_REAL_IMAGE_SLUGS.has(p.slug)).length;
      const note =
        cat.slug === 'vay-dam'
          ? 'Đạt (>=3 SP; vay-dam trong CSDL chỉ có women)'
          : m > 0 && w > 0 && u > 0 && sub.length >= 3
          ? 'Đạt (>=3 SP, đủ men/women/unisex)'
          : 'Cần kiểm tra';
      console.log(
        `| ${idx + 1} | \`${cat.slug}\` | ${cat.name} | **${sub.length}** | ${m} | ${w} | ${u} | ${okCount} | ${newCount} | ${note} |`
      );
    });
    console.log(
      `| **TỔNG** | **9 danh mục chính** | **Toàn bộ Demo** | **${demoProducts.length}** | **${demoMenCount}** | **${demoWomenCount}** | **${demoUnisexCount}** | **${demoKeepProducts.length}** | **${demoNeedNewProducts.length}** | **Đạt độ phủ 9/9 danh mục** |`
    );

    console.log('');
    console.log(
      `#### 6.2. Bảng trạng thái 12 sản phẩm trong bộ Demo dùng ảnh \`/seed-images/*.jpg\` (đối chiếu từ \`.data/visual-audit-cache.json\`)`
    );
    console.log(
      '| # | Dòng CSDL | Danh mục | Đối tượng | Tên sản phẩm (`slug`) | Màu biến thể chính (Họ màu) | Màu nhận diện Cache (Họ màu) | Loại nhận diện Cache | Ảnh chính hiện tại | `updatedAt` trong Cache | Trạng thái |'
    );
    console.log('|---|---|---|---|---|---|---|---|---|---|---|');
    demoKeepProducts.forEach((p, idx) => {
      const varFamStr = p.variantColorFamilies.join(', ') || 'Chưa phân nhóm';
      const recColorsStr =
        p.recognizedColors.length > 0
          ? `${p.recognizedColors.join(', ')} (${p.recognizedColorFamilies.join(', ')})`
          : 'N/A';
      const recCatStr = p.recognizedCategory || 'N/A';
      const cacheTs = auditCache[p.primaryImageUrl]?.updatedAt || 'N/A';
      console.log(
        `| ${idx + 1} | #${p.rowNumber} | \`${p.category_slug}\` | \`${p.target_gender}\` | ${p.name} (\`${p.slug}\`) | ${p.primaryColor} (\`${varFamStr}\`) | ${recColorsStr} | \`${recCatStr}\` | ${p.primaryImageUrl} | \`${cacheTs}\` | **${p.status}** |`
      );
    });

    console.log('');
    console.log(
      `#### 6.3. Danh sách ${demoNeedNewProducts.length} sản phẩm trong bộ Demo CẦN ẢNH MỚI kèm (a) Mô tả ảnh cần có và (b) Prompt tiếng Việt mẫu (<= 60 từ, bỏ "vải trơn", giữ đúng họa tiết/phối màu, dùng "không logo thương hiệu, không chữ lạ")`
    );
    console.log(
      '| # | Dòng CSDL | Danh mục | Đối tượng | Tên sản phẩm (`slug`) | Màu/họa tiết biến thể chính | Chất liệu (`products.material`) | (a) Mô tả ảnh cần có | (b) Prompt tiếng Việt mẫu (kèm số từ) |'
    );
    console.log('|---|---|---|---|---|---|---|---|---|');
    demoNeedNewProducts.forEach((p, idx) => {
      const { imageDescription, sampleViPrompt, promptWordCount } = buildImageSpecAndPrompt({
        name: p.name,
        slug: p.slug,
        categorySlug: p.category_slug,
        categoryName: p.category_name,
        targetGender: p.target_gender,
        primaryColor: p.primaryColor,
        material: p.material,
      });
      console.log(
        `| ${idx + 1} | #${p.rowNumber} | \`${p.category_slug}\` | \`${p.target_gender}\` | ${p.name} (\`${p.slug}\`) | ${p.primaryColor} | ${p.material} | ${imageDescription} | ${sampleViPrompt} *(${promptWordCount} từ)* |`
      );
    });

    const extraPatternedOrEmbroideredHidden = hiddenProducts.filter((p) => {
      const cFam = extractVariantMainColorFamilies(p.primaryColor);
      const hasEmb = /thêu\s+logo\s+baity|thêu\s+chữ\s+baity|họa\s+tiết\s+thêu\s+nhỏ|raglan|phối\s+màu/i.test(
        p.name
      );
      return cFam.isPatternedOrMulti || hasEmb;
    });

    if (extraPatternedOrEmbroideredHidden.length > 0) {
      console.log('');
      console.log(
        `#### 6.3b. Prompt đã sửa cho các sản phẩm có họa tiết / phối màu / thêu trong nhóm ẩn ngoài 29 SP Demo (${extraPatternedOrEmbroideredHidden.length} sản phẩm)`
      );
      console.log(
        '| # | Dòng CSDL | Danh mục | Đối tượng | Tên sản phẩm (`slug`) | Màu/họa tiết biến thể chính | Chất liệu (`products.material`) | (a) Mô tả ảnh cần có | (b) Prompt tiếng Việt mẫu (kèm số từ) |'
      );
      console.log('|---|---|---|---|---|---|---|---|---|');
      extraPatternedOrEmbroideredHidden.forEach((p, idx) => {
        const { imageDescription, sampleViPrompt, promptWordCount } = buildImageSpecAndPrompt({
          name: p.name,
          slug: p.slug,
          categorySlug: p.category_slug,
          categoryName: p.category_name,
          targetGender: p.target_gender,
          primaryColor: p.primaryColor,
          material: p.material,
        });
        console.log(
          `| ${idx + 1} | #${p.rowNumber} | \`${p.category_slug}\` | \`${p.target_gender}\` | ${p.name} (\`${p.slug}\`) | ${p.primaryColor} | ${p.material} | ${imageDescription} | ${sampleViPrompt} *(${promptWordCount} từ)* |`
        );
      });
    }

    const embroideredCatalogProducts = evaluatedProducts.filter((p) =>
      /thêu\s+logo\s+baity|thêu\s+chữ\s+baity|họa\s+tiết\s+thêu\s+nhỏ|thêu\s+hình\s+nhỏ\s+tối\s+giản/i.test(
        p.name
      )
    );
    console.log('');
    console.log(
      `#### 6.3c. Danh sách sản phẩm có chi tiết thêu nhỏ (${embroideredCatalogProducts.length} sản phẩm) & trạng thái đồng bộ tên/mô tả`
    );
    console.log(
      '| # | Dòng CSDL | Slug | Tên hiện tại trong CSDL | Thuộc bộ Demo 29 SP? | Phương án 1 (Khi công cụ tạo ảnh vẽ được chi tiết thêu nhỏ) | Phương án 2 (Đồng bộ tên/mô tả không có logo/chữ thương hiệu) |'
    );
    console.log('|---|---|---|---|---|---|---|');
    embroideredCatalogProducts.forEach((p, idx) => {
      const inDemo = DEMO_CATALOG_SELECTED_SLUGS.has(p.slug);
      const renamedProposal = p.name
        .replace(/Thêu\s+Logo\s+Baity/gi, 'Thêu Hình Nhỏ Tối Giản')
        .replace(/Thêu\s+Chữ\s+Baity(\s+Originals)?/gi, 'Thêu Họa Tiết Nhỏ Tối Giản');
      const descProposal = /thêu\s+hình\s+nhỏ\s+tối\s+giản/i.test(p.name)
        ? `ĐÃ ÁP DỤNG PHƯƠNG ÁN 2: Đổi tên thành "${p.name}", slug \`${p.slug}\`, biến thể màu "${p.primaryColor}" và mô tả bỏ hoàn toàn chữ/logo "Baity".`
        : /họa\s+tiết\s+thêu\s+nhỏ/i.test(p.name)
        ? `Giữ nguyên tên "${p.name}"; mô tả ghi rõ chi tiết hình thêu nhỏ tinh tế không kèm chữ hay logo thương hiệu.`
        : `Đổi tên thành "${renamedProposal}" và chỉnh mô tả bỏ chữ/logo "Baity" để tên/mô tả khớp tuyệt đối với ảnh không có logo/chữ thương hiệu.`;
      console.log(
        `| ${idx + 1} | #${p.rowNumber} | \`${p.slug}\` | ${p.name} | **${inDemo ? 'CÓ (Trong 29 SP Demo)' : 'KHÔNG (Đang ẩn)'}** | Cho phép chi tiết hình/họa tiết thêu nhỏ tinh tế trên sản phẩm (\`có chi tiết hình thêu nhỏ tinh tế, không logo thương hiệu, không chữ lạ\`) | ${descProposal} |`
      );
    });

    console.log('');
    console.log(
      `#### 6.4. Danh sách ${hiddenProducts.length} sản phẩm ngoài bộ Demo 29 sản phẩm`
    );
    const hiddenMen = hiddenProducts.filter((p) => p.target_gender === 'men').length;
    const hiddenWomen = hiddenProducts.filter((p) => p.target_gender === 'women').length;
    const hiddenUnisex = hiddenProducts.filter((p) => p.target_gender === 'unisex').length;
    console.log(
      `- Tổng số sản phẩm ngoài bộ Demo 29 sản phẩm: ${hiddenProducts.length} sản phẩm (Nam: ${hiddenMen}, Nữ: ${hiddenWomen}, Unisex: ${hiddenUnisex}).`
    );
    console.log(
      '| # | Dòng CSDL | Danh mục | Đối tượng | Tên sản phẩm | Slug | Màu biến thể chính | Trạng thái ảnh |'
    );
    console.log('|---|---|---|---|---|---|---|---|');
    hiddenProducts.forEach((p, idx) => {
      console.log(
        `| ${idx + 1} | #${p.rowNumber} | \`${p.category_slug}\` | \`${p.target_gender}\` | ${p.name} | \`${p.slug}\` | ${p.primaryColor} | **${p.status}** |`
      );
    });

    await closeDb().catch(() => {});
    process.exit(0);
  } catch (err: any) {
    console.error('[SEED_IMAGES_PLAN_ERROR]', err?.message || err);
    await closeDb().catch(() => {});
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSeedImagesPlan();
}

