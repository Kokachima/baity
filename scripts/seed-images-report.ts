import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { initDatabase } from '../server/db/init.ts';
import { queryRows, closeDb } from '../server/db/index.ts';
import { seedDatabase } from '../server/db/seed.ts';
import { isStrictRuntimeMode } from '../server/config/runtimeMode.ts';
import { loadContainerSecretsIfMissing } from './load-container-env.ts';

async function runSeedImagesReport() {
  loadContainerSecretsIfMissing();
  if (isStrictRuntimeMode()) {
    console.error(
      '❌ Từ chối thực thi: seed:images-report là công cụ kiểm tra dữ liệu dev, không chạy ở môi trường Production.'
    );
    process.exit(1);
  }

  try {
    await initDatabase();
    await seedDatabase();

    const categoryRows = await queryRows<{
      slug: string;
      name: string;
      display_order: number;
      product_count: number;
      active_product_count: number;
    }>(sql`
      SELECT
        c.slug,
        c.name,
        c.display_order,
        COUNT(p.id)::int AS product_count,
        COUNT(p.id) FILTER (WHERE p.is_active = true)::int AS active_product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id, c.slug, c.name, c.display_order
      ORDER BY c.display_order ASC, c.slug ASC;
    `);

    const productRows = await queryRows<{
      id: string;
      name: string;
      slug: string;
      category_slug: string;
      target_gender: string;
      is_active: boolean;
      primary_color: string | null;
      image_url: string | null;
    }>(sql`
      SELECT
        p.id,
        p.name,
        p.slug,
        c.slug AS category_slug,
        p.target_gender,
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
        ) AS image_url
      FROM products p
      JOIN categories c ON c.id = p.category_id
      ORDER BY p.created_at ASC, p.id ASC;
    `);

    const urlGroupMap = new Map<
      string,
      {
        name: string;
        slug: string;
        categorySlug: string;
        targetGender: string;
        primaryColor: string;
      }[]
    >();

    for (const p of productRows) {
      const url = p.image_url || '(none)';
      const list = urlGroupMap.get(url) || [];
      list.push({
        name: p.name,
        slug: p.slug,
        categorySlug: p.category_slug,
        targetGender: p.target_gender,
        primaryColor: p.primary_color || 'N/A',
      });
      urlGroupMap.set(url, list);
    }

    console.log('=== 1. DANH SÁCH DANH MỤC TRONG CSDL (CATEGORIES) ===');
    console.log('| # | Slug danh mục | Tên danh mục | Tổng số SP | Số SP đang hiển thị |');
    console.log('|---|---|---|---|---|');
    for (let i = 0; i < categoryRows.length; i++) {
      const c = categoryRows[i];
      console.log(
        `| ${i + 1} | ${c.slug} | ${c.name} | ${c.product_count} | ${c.active_product_count} |`
      );
    }

    console.log('');
    console.log(
      `=== 2. DANH SÁCH ĐẦY ĐỦ ${productRows.length} SẢN PHẨM TRONG CSDL & CỜ DÙNG CHUNG URL ẢNH CHÍNH ===`
    );
    console.log(
      '| # | Tên sản phẩm | Slug | Danh mục | Đối tượng | Màu biến thể chính | URL ảnh chính | Cờ URL dùng chung |'
    );
    console.log('|---|---|---|---|---|---|---|---|');

    for (let i = 0; i < productRows.length; i++) {
      const p = productRows[i];
      const url = p.image_url || '(none)';
      const group = urlGroupMap.get(url) || [];
      let sharedFlag = 'UNIQUE (1 SP)';
      if (group.length > 1) {
        const distinctCats = Array.from(new Set(group.map((g) => g.categorySlug)));
        if (distinctCats.length > 1) {
          sharedFlag = `SHARED_CROSS_CATEGORY (${group.length} SP: ${distinctCats.join(', ')})`;
        } else {
          sharedFlag = `SHARED_SAME_CATEGORY (${group.length} SP cùng loại ${distinctCats[0]})`;
        }
      }
      console.log(
        `| ${i + 1} | ${p.name} | ${p.slug} | ${p.category_slug} | ${p.target_gender} | ${
          p.primary_color || 'N/A'
        } | ${url} | ${sharedFlag} |`
      );
    }

    console.log('');
    console.log('=== 3. CÁC NHÓM SẢN PHẨM DÙNG CHUNG CÙNG MỘT URL ẢNH CHÍNH ===');
    let sharedUrlGroupIndex = 0;
    for (const [url, list] of urlGroupMap.entries()) {
      if (list.length > 1) {
        sharedUrlGroupIndex += 1;
        const distinctCats = Array.from(new Set(list.map((g) => g.categorySlug)));
        const crossLabel =
          distinctCats.length > 1
            ? `KHÁC LOẠI [${distinctCats.join(' + ')}]`
            : `CÙNG LOẠI [${distinctCats[0]}]`;
        console.log(
          `${sharedUrlGroupIndex}. URL: ${url} — Dùng chung bởi ${list.length} sản phẩm (${crossLabel}):`
        );
        for (const item of list) {
          console.log(
            `   - [${item.categorySlug}] ${item.name} (slug=${item.slug}, gender=${item.targetGender}, màu=${item.primaryColor})`
          );
        }
      }
    }

    console.log('');
    console.log('=== 4. CẢNH BÁO KIỂM TRA BỔ SUNG (CHỈ CẢNH BÁO — KHÔNG LÀM ĐỎ NPM TEST) ===');
    const allSharedUrls = Array.from(urlGroupMap.entries()).filter(([, list]) => list.length > 1);
    if (allSharedUrls.length > 0) {
      const totalSharedProducts = allSharedUrls.reduce((acc, [, list]) => acc + list.length, 0);
      console.log(
        `⚠️ [CẢNH BÁO 4.1 - DÙNG CHUNG PRIMARY_IMAGE_URL]: Có ${allSharedUrls.length} URL ảnh chính đang được dùng chung bởi ${totalSharedProducts} sản phẩm (bao gồm cả cùng danh mục và khác danh mục).`
      );
      for (const [url, list] of allSharedUrls) {
        const slugs = list.map((g) => `${g.slug} (${g.categorySlug})`).join(', ');
        console.log(`   - ${url} -> [${slugs}]`);
      }
    } else {
      console.log('✅ [4.1] Không có sản phẩm nào dùng chung primary_image_url.');
    }

    const genderCoverageRows = await queryRows<{
      slug: string;
      name: string;
      men_count: number;
      women_count: number;
      unisex_count: number;
      total_active: number;
    }>(sql`
      SELECT
        c.slug,
        c.name,
        COUNT(p.id) FILTER (WHERE p.is_active = true AND p.target_gender = 'men')::int AS men_count,
        COUNT(p.id) FILTER (WHERE p.is_active = true AND p.target_gender = 'women')::int AS women_count,
        COUNT(p.id) FILTER (WHERE p.is_active = true AND p.target_gender = 'unisex')::int AS unisex_count,
        COUNT(p.id) FILTER (WHERE p.is_active = true)::int AS total_active
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id, c.slug, c.name, c.display_order
      ORDER BY c.display_order ASC, c.slug ASC;
    `);

    const missingGenderCategories = genderCoverageRows.filter(
      (c) => c.men_count === 0 || c.women_count === 0
    );
    if (missingGenderCategories.length > 0) {
      console.log(
        `⚠️ [CẢNH BÁO 4.2 - ĐỘ PHỦ NAM/NỮ THEO DANH MỤC CHÍNH]: Có ${missingGenderCategories.length}/${genderCoverageRows.length} danh mục chưa có đủ cả sản phẩm nam (men) và nữ (women):`
      );
      for (const c of missingGenderCategories) {
        console.log(
          `   - [${c.slug}] (${c.name}): tổng=${c.total_active} SP hiển thị (men=${c.men_count}, women=${c.women_count}, unisex=${c.unisex_count})`
        );
      }
    } else {
      console.log('✅ [4.2] Mọi danh mục chính đều có đủ sản phẩm nam (men) và nữ (women).');
    }

    await closeDb().catch(() => {});
    process.exit(0);
  } catch (err: any) {
    console.error('[SEED_IMAGES_REPORT_ERROR]', err?.message || err);
    await closeDb().catch(() => {});
    process.exit(1);
  }
}

runSeedImagesReport();
