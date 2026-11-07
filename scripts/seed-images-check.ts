import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { initDatabase } from '../server/db/init.ts';
import { queryRows, closeDb } from '../server/db/index.ts';
import { seedDatabase } from '../server/db/seed.ts';
import { isStrictRuntimeMode } from '../server/config/runtimeMode.ts';
import { loadContainerSecretsIfMissing } from './load-container-env.ts';

const REQUEST_TIMEOUT_MS = 8000;
const REQUEST_SPACING_MS = 150;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface UrlCheckResult {
  url: string;
  httpStatus: number | string;
  contentType: string;
  byteSize: number;
  ok: boolean;
  errorNote: string;
}

async function checkSingleImageUrl(url: string): Promise<UrlCheckResult> {
  if (url.startsWith('/seed-images/')) {
    const relPath = url.replace(/^\/+/, '');
    const fullPath = path.resolve(process.cwd(), 'public', relPath);
    if (!fs.existsSync(fullPath)) {
      return {
        url,
        httpStatus: 404,
        contentType: 'none',
        byteSize: 0,
        ok: false,
        errorNote: 'LOCAL_FILE_NOT_FOUND',
      };
    }
    const stat = fs.statSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const contentType =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.png'
        ? 'image/png'
        : ext === '.webp'
        ? 'image/webp'
        : ext === '.svg'
        ? 'image/svg+xml'
        : 'application/octet-stream';
    const isImage = contentType.startsWith('image/');
    const ok = isImage && stat.size > 0;
    return {
      url,
      httpStatus: ok ? 200 : 400,
      contentType,
      byteSize: stat.size,
      ok,
      errorNote: ok ? 'OK' : stat.size === 0 ? 'EMPTY_BODY_0_BYTES' : `NON_IMAGE_CONTENT_TYPE(${contentType})`,
    };
  }

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'BaityFashionSeedImagesCheck/1.0',
        Accept: 'image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const contentType = (res.headers.get('content-type') || 'unknown').split(';')[0].trim().toLowerCase();
    const arrayBuf = await res.arrayBuffer();
    const byteSize = arrayBuf.byteLength;
    const isImage = contentType.startsWith('image/');
    const ok = res.ok && isImage && byteSize > 0;

    let errorNote = 'OK';
    if (!res.ok) {
      errorNote = `HTTP_${res.status}`;
    } else if (!isImage) {
      errorNote = `NON_IMAGE_CONTENT_TYPE(${contentType})`;
    } else if (byteSize === 0) {
      errorNote = 'EMPTY_BODY_0_BYTES';
    }

    return {
      url,
      httpStatus: res.status,
      contentType,
      byteSize,
      ok,
      errorNote,
    };
  } catch (err: any) {
    const isTimeout = err?.name === 'TimeoutError' || String(err?.message || '').includes('timeout');
    return {
      url,
      httpStatus: isTimeout ? 'TIMEOUT' : 'NETWORK_ERR',
      contentType: 'none',
      byteSize: 0,
      ok: false,
      errorNote: isTimeout ? `TIMEOUT_${REQUEST_TIMEOUT_MS}MS` : String(err?.message || 'FETCH_FAILED').slice(0, 80),
    };
  }
}

async function runSeedImagesCheck() {
  loadContainerSecretsIfMissing();
  if (isStrictRuntimeMode()) {
    console.error(
      '❌ Từ chối thực thi: seed:images-check là công cụ kiểm tra dữ liệu dev, không chạy ở môi trường Production.'
    );
    process.exit(1);
  }

  try {
    await initDatabase();
    await seedDatabase();

    const imageRows = await queryRows<{
      product_id: string;
      product_name: string;
      product_slug: string;
      category_slug: string;
      target_gender: string;
      image_id: string;
      image_url: string;
      is_primary: boolean;
      display_order: number;
    }>(sql`
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.slug AS product_slug,
        c.slug AS category_slug,
        p.target_gender,
        pi.id AS image_id,
        pi.image_url,
        pi.is_primary,
        pi.display_order
      FROM products p
      JOIN categories c ON c.id = p.category_id
      JOIN product_images pi ON pi.product_id = p.id
      WHERE p.is_active = true
      ORDER BY p.created_at ASC, p.id ASC, pi.is_primary DESC, pi.display_order ASC;
    `);

    const distinctUrls = Array.from(new Set(imageRows.map((r) => r.image_url)));
    const distinctProductCount = new Set(imageRows.map((r) => r.product_id)).size;
    const urlResultMap = new Map<string, UrlCheckResult>();

    console.log('=== KIỂM TRA TOÀN BỘ URL ẢNH SẢN PHẨM ĐANG HOẠT ĐỘNG (CHỈ ĐỌC, KHÔNG GỌI GEMINI) ===');
    console.log(
      `- Tổng số bản ghi product_images: ${imageRows.length} (trên ${distinctProductCount} sản phẩm đang hoạt động) | Số URL phân biệt: ${distinctUrls.length} | Timeout: ${REQUEST_TIMEOUT_MS}ms | Giãn cách: ${REQUEST_SPACING_MS}ms`
    );

    for (let i = 0; i < distinctUrls.length; i++) {
      const url = distinctUrls[i];
      if (i > 0 && !url.startsWith('/seed-images/')) {
        await sleep(REQUEST_SPACING_MS);
      }
      const result = await checkSingleImageUrl(url);
      urlResultMap.set(url, result);
    }

    console.log('');
    console.log('=== 1. BẢNG KẾT QUẢ KIỂM TRA TỪNG BẢN GHI ẢNH (CHÍNH & PHỤ) CỦA 46 SẢN PHẨM ===');
    console.log(
      '| # | Sản phẩm (`slug`) | Danh mục | Loại ảnh | HTTP Status | Content-Type | Kích thước (bytes) | Kết quả | URL |'
    );
    console.log('|---|---|---|---|---|---|---|---|---|');

    const brokenRecords: {
      rowNumber: number;
      productName: string;
      productSlug: string;
      categorySlug: string;
      imageRole: string;
      url: string;
      httpStatus: number | string;
      contentType: string;
      byteSize: number;
      errorNote: string;
    }[] = [];

    for (let i = 0; i < imageRows.length; i++) {
      const row = imageRows[i];
      const check = urlResultMap.get(row.image_url)!;
      const roleLabel = row.is_primary ? 'PRIMARY (Chính)' : `SECONDARY (Phụ #${row.display_order})`;
      const statusLabel = check.ok ? 'OK' : `BROKEN (${check.errorNote})`;

      console.log(
        `| ${i + 1} | ${row.product_name} (\`${row.product_slug}\`) | \`${row.category_slug}\` | ${roleLabel} | ${check.httpStatus} | \`${check.contentType}\` | ${check.byteSize} | **${statusLabel}** | ${row.image_url} |`
      );

      if (!check.ok) {
        brokenRecords.push({
          rowNumber: i + 1,
          productName: row.product_name,
          productSlug: row.product_slug,
          categorySlug: row.category_slug,
          imageRole: roleLabel,
          url: row.image_url,
          httpStatus: check.httpStatus,
          contentType: check.contentType,
          byteSize: check.byteSize,
          errorNote: check.errorNote,
        });
      }
    }

    console.log('');
    console.log('=== 2. DANH SÁCH URL HỎNG (HTTP != 200 HOẶC KHÔNG PHẢI IMAGE/*) ===');
    if (brokenRecords.length === 0) {
      console.log('✅ Tất cả URL ảnh chính và phụ đều phản hồi HTTP 200 và content-type image/*.');
    } else {
      for (const b of brokenRecords) {
        console.log(
          `- [Dòng #${b.rowNumber}] ${b.productName} (slug=${b.productSlug}, danh mục=${b.categorySlug}, loại=${b.imageRole}): status=${b.httpStatus}, content-type=${b.contentType}, size=${b.byteSize} bytes, lỗi=${b.errorNote} | URL: ${b.url}`
        );
      }
    }

    const okUrlsCount = Array.from(urlResultMap.values()).filter((x) => x.ok).length;
    const brokenUrlsCount = distinctUrls.length - okUrlsCount;

    console.log('');
    console.log('=== 3. TỔNG KẾT SEED:IMAGES-CHECK ===');
    console.log(`- Tổng số bản ghi ảnh kiểm tra: ${imageRows.length}`);
    console.log(`- Tổng số URL phân biệt: ${distinctUrls.length} (Hợp lệ: ${okUrlsCount}, Hỏng: ${brokenUrlsCount})`);
    console.log(`- Số bản ghi sản phẩm gắn URL hỏng: ${brokenRecords.length}`);

    await closeDb().catch(() => {});
    process.exit(0);
  } catch (err: any) {
    console.error('[SEED_IMAGES_CHECK_ERROR]', err?.message || err);
    await closeDb().catch(() => {});
    process.exit(1);
  }
}

runSeedImagesCheck();
