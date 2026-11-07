import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { isStrictRuntimeMode } from '../server/config/runtimeMode.ts';

export interface KeptDemoImageSource {
  slug: string;
  productName: string;
  categorySlug: string;
  unsplashPhotoId: string;
  sourceUrl: string;
  localPublicPath: string;
}

export const KEPT_DEMO_IMAGE_SOURCES: readonly KeptDemoImageSource[] = [
  {
    slug: 'ao-so-mi-oxford-dai-tay-phom-regular-nam',
    productName: 'Áo Sơ Mi Oxford Dài Tay Phom Regular Nam',
    categorySlug: 'ao-so-mi',
    unsplashPhotoId: 'photo-1596755094514-f87e34085b2c',
    sourceUrl: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=800&q=80',
    localPublicPath: '/seed-images/ao-so-mi-oxford-dai-tay-phom-regular-nam.jpg',
  },
  {
    slug: 'ao-so-mi-nam-co-tau-vai-dui-linen-mat-me',
    productName: 'Áo Sơ Mi Nam Cổ Tàu Vải Đũi Linen Mát Mẻ',
    categorySlug: 'ao-so-mi',
    unsplashPhotoId: 'photo-1598033129183-c4f50c736f10',
    sourceUrl: 'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=800&q=80',
    localPublicPath: '/seed-images/ao-so-mi-nam-co-tau-vai-dui-linen-mat-me.jpg',
  },
  {
    slug: 'quan-kaki-nam-dang-slimfit-ton-chieu-cao',
    productName: 'Quần Kaki Nam Dáng Slimfit Tôn Chiều Cao',
    categorySlug: 'quan-tay-kaki',
    unsplashPhotoId: 'photo-1473966968600-fa801b869a1a',
    sourceUrl: 'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=800&q=80',
    localPublicPath: '/seed-images/quan-kaki-nam-dang-slimfit-ton-chieu-cao.jpg',
  },
  {
    slug: 'ao-len-nam-co-lo-vai-cashmere-pha-am-ap',
    productName: 'Áo Len Nam Cổ Lọ Vải Cashmere Pha Ấm Áp',
    categorySlug: 'ao-len-hoodie',
    unsplashPhotoId: 'photo-1614975058789-41316d0e2e9c',
    sourceUrl: 'https://images.unsplash.com/photo-1614975058789-41316d0e2e9c?auto=format&fit=crop&w=800&q=80',
    localPublicPath: '/seed-images/ao-len-nam-co-lo-vai-cashmere-pha-am-ap.jpg',
  },
  {
    slug: 'that-lung-da-bo-nam-mat-khoa-kim-loai-nguyen-khoi',
    productName: 'Thắt Lưng Da Bò Nam Mặt Khóa Kim Loại Nguyên Khối',
    categorySlug: 'phu-kien-thoi-trang',
    unsplashPhotoId: 'photo-1624222247344-550fb60583dc',
    sourceUrl: 'https://images.unsplash.com/photo-1624222247344-550fb60583dc?auto=format&fit=crop&w=800&q=80',
    localPublicPath: '/seed-images/that-lung-da-bo-nam-mat-khoa-kim-loai-nguyen-khoi.jpg',
  },
  {
    slug: 'quan-jean-nu-ong-loe-lung-sieu-cao-hack-dang',
    productName: 'Quần Jean Nữ Ống Loe Lưng Siêu Cao Hack Dáng',
    categorySlug: 'quan-jean-denim',
    unsplashPhotoId: 'photo-1584370848010-d7fe6bc767ec',
    sourceUrl: 'https://images.unsplash.com/photo-1584370848010-d7fe6bc767ec?auto=format&fit=crop&w=800&q=80',
    localPublicPath: '/seed-images/quan-jean-nu-ong-loe-lung-sieu-cao-hack-dang.jpg',
  },
  {
    slug: 'ao-blazer-nu-phom-rong-cropped-thanh-lich',
    productName: 'Áo Blazer Nữ Phom Rộng Cropped Thanh Lịch',
    categorySlug: 'ao-khoac-blazer',
    unsplashPhotoId: 'photo-1591047139829-d91aecb6caea',
    sourceUrl: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=800&q=80',
    localPublicPath: '/seed-images/ao-blazer-nu-phom-rong-cropped-thanh-lich.jpg',
  },
  {
    slug: 'ao-cardigan-nu-det-kim-cuc-go-mua-thu',
    productName: 'Áo Cardigan Nữ Dệt Kim Cúc Gỗ Mùa Thu',
    categorySlug: 'ao-len-hoodie',
    unsplashPhotoId: 'photo-1434389677669-e08b4cac3105',
    sourceUrl: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?auto=format&fit=crop&w=800&q=80',
    localPublicPath: '/seed-images/ao-cardigan-nu-det-kim-cuc-go-mua-thu.jpg',
  },
  {
    slug: 'tui-xach-nu-tote-canvas-quai-da-phoi-dung-laptop',
    productName: 'Túi Xách Nữ Tote Canvas Quai Da Phối Đựng Laptop',
    categorySlug: 'phu-kien-thoi-trang',
    unsplashPhotoId: 'photo-1544816155-12df9643f363',
    sourceUrl: 'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=800&q=80',
    localPublicPath: '/seed-images/tui-xach-nu-tote-canvas-quai-da-phoi-dung-laptop.jpg',
  },
  {
    slug: 'ao-thun-unisex-oversized-graphic-minimalist',
    productName: 'Áo Thun Unisex Oversized Graphic Minimalist',
    categorySlug: 'ao-thun',
    unsplashPhotoId: 'photo-1576566588028-4147f3842f27',
    sourceUrl: 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=800&q=80',
    localPublicPath: '/seed-images/ao-thun-unisex-oversized-graphic-minimalist.jpg',
  },
  {
    slug: 'quan-jean-unisex-ong-suong-rong-rai-baggy-denim',
    productName: 'Quần Jean Unisex Ống Suông Rộng Rãi Baggy Denim',
    categorySlug: 'quan-jean-denim',
    unsplashPhotoId: 'photo-1541099649105-f69ad21f3246',
    sourceUrl: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=800&q=80',
    localPublicPath: '/seed-images/quan-jean-unisex-ong-suong-rong-rai-baggy-denim.jpg',
  },
  {
    slug: 'tat-vo-unisex-co-cao-det-gan-cotton-khang-khuan-set-3-doi',
    productName: 'Tất Vớ Unisex Cổ Cao Dệt Gân Cotton Kháng Khuẩn (Set 3 đôi)',
    categorySlug: 'phu-kien-thoi-trang',
    unsplashPhotoId: 'photo-1586350977771-b3b0abd50c82',
    sourceUrl: 'https://images.unsplash.com/photo-1586350977771-b3b0abd50c82?auto=format&fit=crop&w=800&q=80',
    localPublicPath: '/seed-images/tat-vo-unisex-co-cao-det-gan-cotton-khang-khuan-set-3-doi.jpg',
  },
] as const;

export const PLACEHOLDER_CATEGORIES: readonly {
  slug: string;
  labelVi: string;
}[] = [
  { slug: 'ao-thun', labelVi: 'Áo thun' },
  { slug: 'ao-so-mi', labelVi: 'Áo sơ mi' },
  { slug: 'ao-khoac-blazer', labelVi: 'Áo khoác & Blazer' },
  { slug: 'quan-jean-denim', labelVi: 'Quần jean & Denim' },
  { slug: 'quan-tay-kaki', labelVi: 'Quần tây & Kaki' },
  { slug: 'quan-short', labelVi: 'Quần short' },
  { slug: 'vay-dam', labelVi: 'Váy & Đầm' },
  { slug: 'ao-len-hoodie', labelVi: 'Áo len & Hoodie' },
  { slug: 'phu-kien-thoi-trang', labelVi: 'Phụ kiện thời trang' },
] as const;

export function buildCategoryPlaceholderSvg(categorySlug: string, categoryLabelVi: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000" width="800" height="1000" role="img" aria-label="Ảnh đang cập nhật - ${categoryLabelVi}">
  <rect width="800" height="1000" fill="#F5F3EF"/>
  <rect x="48" y="48" width="704" height="904" rx="16" fill="none" stroke="#D6CFC2" stroke-width="2" stroke-dasharray="10 8"/>
  <g transform="translate(400, 410)" fill="none" stroke="#8C8270" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M-40 -50 L0 -85 L40 -50"/>
    <circle cx="0" cy="-100" r="14"/>
    <rect x="-90" y="-50" width="180" height="150" rx="12" stroke="#ABA190" stroke-width="2.5"/>
  </g>
  <text x="400" y="575" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="600" fill="#4A453C">Ảnh đang cập nhật</text>
  <text x="400" y="620" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="400" fill="#7A7264">Danh mục: ${categoryLabelVi} (${categorySlug})</text>
  <text x="400" y="660" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="15" fill="#9A9182">Ảnh giữ chỗ tạm thời — không phải ảnh chụp sản phẩm thật</text>
</svg>
`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSeedImagesFetch() {
  if (isStrictRuntimeMode()) {
    console.error(
      '❌ Từ chối thực thi: seed:images-fetch là công cụ chuẩn bị dữ liệu mẫu dev, không chạy ở chế độ strict production.'
    );
    process.exit(1);
  }

  const outDir = path.resolve(process.cwd(), 'public/seed-images');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('=== 1. TẠO 9 ẢNH GIỮ CHỖ SVG THEO DANH MỤC (public/seed-images/placeholder-<category>.svg) ===');
  for (const cat of PLACEHOLDER_CATEGORIES) {
    const fileName = `placeholder-${cat.slug}.svg`;
    const filePath = path.join(outDir, fileName);
    const svgContent = buildCategoryPlaceholderSvg(cat.slug, cat.labelVi);
    fs.writeFileSync(filePath, svgContent, 'utf8');
    const stat = fs.statSync(filePath);
    console.log(`- Đã tạo: /seed-images/${fileName} (${stat.size} bytes)`);
  }

  console.log('');
  console.log('=== 2. TẢI 12 ẢNH THẬT CỦA BỘ DEMO VỀ public/seed-images/<slug>.jpg ===');
  console.log('| # | Slug (`<slug>.jpg`) | Unsplash Photo ID | HTTP Status | Content-Type | Dung lượng (bytes) | Kết quả |');
  console.log('|---|---|---|---:|---|---:|---|');

  let successCount = 0;
  for (let i = 0; i < KEPT_DEMO_IMAGE_SOURCES.length; i++) {
    const item = KEPT_DEMO_IMAGE_SOURCES[i];
    const targetFile = path.join(outDir, `${item.slug}.jpg`);

    if (i > 0) await sleep(150);

    const res = await fetch(item.sourceUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'BaityFashionSeedImagesFetch/1.0',
        Accept: 'image/jpeg,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(12000),
    });

    const contentType = (res.headers.get('content-type') || 'unknown')
      .split(';')[0]
      .trim()
      .toLowerCase();

    if (!res.ok || !contentType.startsWith('image/')) {
      console.error(`❌ Lỗi tải ảnh cho ${item.slug}: HTTP ${res.status} (${contentType})`);
      process.exit(1);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) {
      console.error(`❌ Ảnh rỗng (0 byte) cho ${item.slug}`);
      process.exit(1);
    }

    fs.writeFileSync(targetFile, buf);
    successCount += 1;

    console.log(
      `| ${i + 1} | \`${item.slug}.jpg\` | \`${item.unsplashPhotoId}\` | ${res.status} | \`${contentType}\` | ${buf.length} | **OK** |`
    );
  }

  console.log('');
  console.log(
    `✅ Hoàn tất seed:images-fetch: Đã tải ${successCount}/${KEPT_DEMO_IMAGE_SOURCES.length} ảnh thật (.jpg) và tạo ${PLACEHOLDER_CATEGORIES.length} ảnh giữ chỗ (.svg) trong public/seed-images/.`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSeedImagesFetch().catch((err) => {
    console.error('[SEED_IMAGES_FETCH_ERROR]', err?.message || err);
    process.exit(1);
  });
}
