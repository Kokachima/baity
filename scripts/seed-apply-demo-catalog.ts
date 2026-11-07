import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { initDatabase } from '../server/db/init.ts';
import { withTransaction, closeDb } from '../server/db/index.ts';
import { seedDatabase, normalizeVietnameseText } from '../server/db/seed.ts';
import { isStrictRuntimeMode } from '../server/config/runtimeMode.ts';
import {
  DEMO_CATALOG_SELECTED_SLUGS,
  DEMO_KEEP_REAL_IMAGE_SLUGS,
} from './seed-images-plan.ts';
import { loadContainerSecretsIfMissing } from './load-container-env.ts';

async function runSeedApplyDemoCatalog() {
  loadContainerSecretsIfMissing();

  if (isStrictRuntimeMode()) {
    console.error(
      '❌ Từ chối thực thi: seed:apply-demo-catalog chỉ dành cho môi trường phát triển (dev), tuyệt đối không chạy ở chế độ Production / Strict.'
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  if (!args.includes('--confirm')) {
    console.error(
      '❌ Thiếu cờ xác nhận: vui lòng chạy `npm run seed:apply-demo-catalog -- --confirm` để áp dụng bộ sản phẩm demo 29 sản phẩm vào CSDL Dev.'
    );
    process.exit(1);
  }

  try {
    await initDatabase();
    await seedDatabase();

    const result = await withTransaction(async (txQueryRows) => {
      // Mục 7 (Phương án 2 cho #31): Đồng bộ tên, slug, mô tả (bỏ chữ/logo "Baity", bỏ "380gsm") và giữ nguyên chất liệu "100% Cotton nỉ chân cua cao cấp"
      const newHoodieName = 'Áo Hoodie Unisex Nỉ Chân Cua Thêu Hình Nhỏ Tối Giản';
      const newHoodieSlug = 'ao-hoodie-unisex-ni-chan-cua-theu-hinh-nho-toi-gian';
      const newHoodieDesc =
        'Áo hoodie phom rộng phong cách đường phố, mũ 2 lớp đứng phom, chi tiết thêu hình nhỏ tối giản tinh tế trước ngực, chất nỉ bông chân cua dày dặn giữ ấm hoàn hảo cho cả bạn nam và nữ.';
      const newHoodieMaterial = '100% Cotton nỉ chân cua cao cấp';
      const newHoodieSearchText = normalizeVietnameseText(
        `${newHoodieName} Áo len & Hoodie ${newHoodieDesc} ${newHoodieMaterial} unisex streetwear theu-nho oversized hang-ngay dai-tay`
      );

      const hoodieTargetRows = await txQueryRows<{
        id: string;
        name: string;
        slug: string;
        description: string;
        material: string;
        search_text: string;
      }>(sql`
        SELECT
          id,
          name,
          slug,
          COALESCE(description, '') AS description,
          COALESCE(material, '') AS material,
          COALESCE(search_text, '') AS search_text
        FROM products
        WHERE slug IN (
          'ao-hoodie-unisex-ni-chan-cua-theu-logo-baity',
          'ao-hoodie-unisex-ni-chan-cua-theu-hinh-nho-toi-gian'
        )
        LIMIT 1;
      `);

      let hoodieRenamed = false;
      let hoodieAfterRow: {
        name: string;
        slug: string;
        description: string;
        material: string;
        care_instructions: string;
        base_price: number;
        target_gender: string;
        is_active: boolean;
        search_text: string;
        first_color_name: string;
        pattern_attr: string;
        primary_image_url: string;
      } | null = null;

      if (hoodieTargetRows.length > 0) {
        const hRow = hoodieTargetRows[0];
        if (
          hRow.name !== newHoodieName ||
          hRow.slug !== newHoodieSlug ||
          hRow.description !== newHoodieDesc ||
          hRow.material !== newHoodieMaterial ||
          hRow.search_text !== newHoodieSearchText
        ) {
          await txQueryRows(sql`
            UPDATE products
            SET name = ${newHoodieName},
                slug = ${newHoodieSlug},
                description = ${newHoodieDesc},
                material = ${newHoodieMaterial},
                search_text = ${newHoodieSearchText},
                updated_at = NOW()
            WHERE id = ${hRow.id}::uuid;
          `);
          await txQueryRows(sql`
            UPDATE product_variants
            SET color_name = 'Xanh rêu olive'
            WHERE product_id = ${hRow.id}::uuid
              AND color_name = 'Xanh rêu olive Baity';
          `);
          await txQueryRows(sql`
            UPDATE product_attributes
            SET attr_value = 'theu-nho'
            WHERE product_id = ${hRow.id}::uuid
              AND attr_key = 'pattern'
              AND attr_value = 'theu-logo';
          `);
          hoodieRenamed = true;
        }

        const verifyRows = await txQueryRows<{
          name: string;
          slug: string;
          description: string;
          material: string;
          care_instructions: string;
          base_price: number;
          target_gender: string;
          is_active: boolean;
          search_text: string;
          first_color_name: string;
          pattern_attr: string;
          primary_image_url: string;
        }>(sql`
          SELECT
            p.name,
            p.slug,
            COALESCE(p.description, '') AS description,
            COALESCE(p.material, '') AS material,
            COALESCE(p.care_instructions, '') AS care_instructions,
            p.base_price,
            p.target_gender,
            p.is_active,
            COALESCE(p.search_text, '') AS search_text,
            COALESCE((SELECT pv.color_name FROM product_variants pv WHERE pv.product_id = p.id ORDER BY pv.sku ASC LIMIT 1), '') AS first_color_name,
            COALESCE((SELECT pa.attr_value FROM product_attributes pa WHERE pa.product_id = p.id AND pa.attr_key = 'pattern' LIMIT 1), '') AS pattern_attr,
            COALESCE((SELECT pi.image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1), '') AS primary_image_url
          FROM products p
          WHERE p.id = ${hRow.id}::uuid
          LIMIT 1;
        `);
        hoodieAfterRow = verifyRows[0] || null;
      }

      const products = await txQueryRows<{
        id: string;
        name: string;
        slug: string;
        category_slug: string;
        target_gender: string;
        is_active: boolean;
        primary_image_id: string | null;
        primary_image_url: string | null;
      }>(sql`
        SELECT
          p.id,
          p.name,
          p.slug,
          c.slug AS category_slug,
          p.target_gender,
          p.is_active,
          (
            SELECT pi.id
            FROM product_images pi
            WHERE pi.product_id = p.id
            ORDER BY pi.is_primary DESC, pi.display_order ASC
            LIMIT 1
          ) AS primary_image_id,
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

      const deactivatedSlugs: string[] = [];
      const alreadyHiddenSlugs: string[] = [];
      const updatedRealImageSlugs: Array<{ slug: string; oldUrl: string; newUrl: string }> = [];
      const unchangedRealImageSlugs: string[] = [];
      const updatedPlaceholderSlugs: Array<{ slug: string; oldUrl: string; newUrl: string }> = [];
      const unchangedPlaceholderSlugs: string[] = [];

      for (const p of products) {
        const isSelectedDemo = DEMO_CATALOG_SELECTED_SLUGS.has(p.slug);

        if (!isSelectedDemo) {
          // 17 sản phẩm ngoài bộ demo -> đặt is_active = false (KHÔNG xóa dữ liệu, KHÔNG đụng đơn hàng)
          if (p.is_active) {
            await txQueryRows(sql`
              UPDATE products
              SET is_active = false,
                  updated_at = NOW()
              WHERE id = ${p.id}::uuid;
            `);
            deactivatedSlugs.push(p.slug);
          } else {
            alreadyHiddenSlugs.push(p.slug);
          }
          continue;
        }

        // Sản phẩm thuộc bộ 29 sản phẩm demo -> đảm bảo is_active = true
        if (!p.is_active) {
          await txQueryRows(sql`
            UPDATE products
            SET is_active = true,
                updated_at = NOW()
            WHERE id = ${p.id}::uuid;
          `);
        }

        const isKeepReal = DEMO_KEEP_REAL_IMAGE_SLUGS.has(p.slug);
        const targetPrimaryUrl = isKeepReal
          ? `/seed-images/${p.slug}.jpg`
          : `/seed-images/placeholder-${p.category_slug}.svg`;

        const currentUrl = String(p.primary_image_url || '').trim();
        const isAlreadyAdminUploaded = /^products\/[a-f0-9]{8,64}\/[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$/i.test(
          currentUrl
        );

        // Nếu sản phẩm đã được Admin tải ảnh thật lên qua /api/upload thì giữ nguyên ảnh Admin đã tải
        if (isAlreadyAdminUploaded) {
          if (isKeepReal) {
            unchangedRealImageSlugs.push(p.slug);
          } else {
            unchangedPlaceholderSlugs.push(p.slug);
          }
          continue;
        }

        if (currentUrl !== targetPrimaryUrl) {
          if (p.primary_image_id) {
            await txQueryRows(sql`
              UPDATE product_images
              SET image_url = ${targetPrimaryUrl},
                  is_primary = true,
                  display_order = 0
              WHERE id = ${p.primary_image_id}::uuid;
            `);
          } else {
            await txQueryRows(sql`
              INSERT INTO product_images (product_id, image_url, is_primary, display_order)
              VALUES (${p.id}::uuid, ${targetPrimaryUrl}, true, 0);
            `);
          }

          await txQueryRows(sql`
            UPDATE products
            SET updated_at = NOW()
            WHERE id = ${p.id}::uuid;
          `);

          if (isKeepReal) {
            updatedRealImageSlugs.push({
              slug: p.slug,
              oldUrl: currentUrl || '(none)',
              newUrl: targetPrimaryUrl,
            });
          } else {
            updatedPlaceholderSlugs.push({
              slug: p.slug,
              oldUrl: currentUrl || '(none)',
              newUrl: targetPrimaryUrl,
            });
          }
        } else {
          if (isKeepReal) {
            unchangedRealImageSlugs.push(p.slug);
          } else {
            unchangedPlaceholderSlugs.push(p.slug);
          }
        }

        // Gỡ các ảnh phụ (is_primary = false) trỏ ra URL ngoài (https://images.unsplash.com/...) trên 29 sản phẩm demo
        // để toàn bộ ảnh của sản phẩm đang hoạt động đều là tệp cục bộ /seed-images/...
        await txQueryRows(sql`
          DELETE FROM product_images
          WHERE product_id = ${p.id}::uuid
            AND is_primary = false
            AND image_url LIKE 'http%';
        `);
      }

      const adminRows = await txQueryRows<{ id: string }>(sql`
        SELECT id
        FROM users
        WHERE role = 'admin'
        ORDER BY created_at ASC
        LIMIT 1;
      `);

      const totalChanged =
        deactivatedSlugs.length +
        updatedRealImageSlugs.length +
        updatedPlaceholderSlugs.length +
        (hoodieRenamed ? 1 : 0);

      const summaryText = `seed:apply-demo-catalog: totalChanged=${totalChanged}, deactivated=${deactivatedSlugs.length} (alreadyHidden=${alreadyHiddenSlugs.length}), localRealUpdated=${updatedRealImageSlugs.length} (unchanged=${unchangedRealImageSlugs.length}), placeholderUpdated=${updatedPlaceholderSlugs.length} (unchanged=${unchangedPlaceholderSlugs.length}), hoodieRenamedOption2=${hoodieRenamed ? 1 : 0}`;

      let auditLogId: string | null = null;
      if (adminRows.length > 0) {
        const logInsert = await txQueryRows<{ id: string }>(sql`
          INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, summary)
          VALUES (
            ${adminRows[0].id}::uuid,
            'seed_apply_demo_catalog',
            'catalog',
            'demo_29_products',
            ${summaryText}
          )
          RETURNING id;
        `);
        auditLogId = logInsert[0]?.id || null;
      }

      return {
        totalProductsInDb: products.length,
        deactivatedSlugs,
        alreadyHiddenSlugs,
        updatedRealImageSlugs,
        unchangedRealImageSlugs,
        updatedPlaceholderSlugs,
        unchangedPlaceholderSlugs,
        hoodieRenamed,
        hoodieAfterRow,
        totalChanged,
        auditLogId,
        summaryText,
      };
    });

    console.log('=== KẾT QUẢ ÁP DỤNG BỘ SẢN PHẨM DEMO 29 SẢN PHẨM (SEED:APPLY-DEMO-CATALOG) ===');
    console.log(`- Tổng số sản phẩm trong CSDL: ${result.totalProductsInDb}`);
    console.log(`- Tổng số sản phẩm có thay đổi trong lần chạy này: ${result.totalChanged}`);
    console.log(`- Đồng bộ Phương án 2 cho #31 (Áo Hoodie Unisex Nỉ Chân Cua Thêu Hình Nhỏ Tối Giản): ${result.hoodieRenamed ? 'MỚI CẬP NHẬT' : 'ĐÃ ĐỒNG BỘ SẴN'}`);
    console.log(`- Bản ghi admin_audit_logs (1 dòng tóm tắt, không PII): id=${result.auditLogId || 'N/A'}`);
    console.log(`  + Nội dung summary: "${result.summaryText}"`);

    console.log('');
    console.log(
      `1. Sản phẩm chuyển sang ẩn (is_active = false): ${result.deactivatedSlugs.length} mới ẩn, ${result.alreadyHiddenSlugs.length} đã ẩn sẵn`
    );
    if (result.deactivatedSlugs.length > 0) {
      console.log(`   - Danh sách slug vừa chuyển sang is_active = false (${result.deactivatedSlugs.length}):`);
      for (const s of result.deactivatedSlugs) {
        console.log(`     * ${s}`);
      }
    }
    if (result.alreadyHiddenSlugs.length > 0) {
      console.log(`   - Danh sách slug đã ở trạng thái is_active = false (${result.alreadyHiddenSlugs.length}):`);
      for (const s of result.alreadyHiddenSlugs) {
        console.log(`     * ${s}`);
      }
    }

    console.log('');
    console.log(
      `2. Sản phẩm giữ ảnh thật cập nhật sang /seed-images/<slug>.jpg: ${result.updatedRealImageSlugs.length} mới cập nhật, ${result.unchangedRealImageSlugs.length} giữ nguyên`
    );
    for (const item of result.updatedRealImageSlugs) {
      console.log(`   - ${item.slug}: ${item.oldUrl} -> ${item.newUrl}`);
    }
    if (result.unchangedRealImageSlugs.length > 0) {
      console.log(`   - Đã ở sẵn đường dẫn chuẩn (${result.unchangedRealImageSlugs.length}): ${result.unchangedRealImageSlugs.join(', ')}`);
    }

    console.log('');
    console.log(
      `3. Sản phẩm cần ảnh mới cập nhật sang /seed-images/placeholder-<category>.svg: ${result.updatedPlaceholderSlugs.length} mới cập nhật, ${result.unchangedPlaceholderSlugs.length} giữ nguyên`
    );
    for (const item of result.updatedPlaceholderSlugs) {
      console.log(`   - ${item.slug}: ${item.oldUrl} -> ${item.newUrl}`);
    }
    if (result.unchangedPlaceholderSlugs.length > 0) {
      console.log(`   - Đã ở sẵn đường dẫn chuẩn (${result.unchangedPlaceholderSlugs.length}): ${result.unchangedPlaceholderSlugs.join(', ')}`);
    }

    if (result.hoodieAfterRow) {
      const h = result.hoodieAfterRow;
      console.log('');
      console.log('4. BẢNG DIFF THEO TỪNG CỘT CỦA SẢN PHẨM #31 (TRƯỚC PHƯƠNG ÁN 2 vs SAU KHI HOÀN NGUYÊN CHẤT LIỆU):');
      console.log('| Bảng.Cột | Giá trị gốc ban đầu (Trước Phương án 2) | Giá trị hiện tại trong CSDL & seed.ts (Sau khi chuẩn hóa) | Có thay đổi so với bản gốc? |');
      console.log('|---|---|---|---|');
      console.log(`| \`products.name\` | \`Áo Hoodie Unisex Nỉ Chân Cua Thêu Logo Baity\` | \`${h.name}\` | **CÓ** (bỏ chữ/logo "Baity") |`);
      console.log(`| \`products.slug\` | \`ao-hoodie-unisex-ni-chan-cua-theu-logo-baity\` | \`${h.slug}\` | **CÓ** (đổi theo tên mới) |`);
      console.log(`| \`products.description\` | \`Áo hoodie phom rộng phong cách đường phố, mũ 2 lớp đứng phom, chi tiết thêu nổi logo Baity tinh tế trước ngực, chất nỉ bông chân cua dày dặn giữ ấm hoàn hảo cho cả bạn nam và nữ.\` | \`${h.description}\` | **CÓ** (bỏ chữ/logo "Baity", không có "380gsm") |`);
      console.log(`| \`products.material\` | \`100% Cotton nỉ chân cua cao cấp\` | \`${h.material}\` | **KHÔNG** (giữ nguyên giá trị cũ \`100% Cotton nỉ chân cua cao cấp\`) |`);
      console.log(`| \`products.care_instructions\` | \`Giặt mặt trái, phơi khô tự nhiên.\` | \`${h.care_instructions}\` | **KHÔNG** |`);
      console.log(`| \`products.base_price\` | \`449000\` | \`${h.base_price}\` | **KHÔNG** |`);
      console.log(`| \`products.target_gender\` | \`unisex\` | \`${h.target_gender}\` | **KHÔNG** |`);
      console.log(`| \`products.is_active\` | \`true\` | \`${h.is_active}\` | **KHÔNG** |`);
      console.log(`| \`products.search_text\` | \`ao hoodie unisex ni chan cua theu logo baity ao len hoodie ao hoodie phom rong phong cach duong pho mu 2 lop dung phom chi tiet theu noi logo baity tinh te truoc nguc chat ni bong chan cua day dan giu am hoan hao cho ca ban nam va nu 100 cotton ni chan cua cao cap unisex streetwear theu logo oversized hang ngay dai tay\` | \`${h.search_text}\` | **CÓ** (tự động cập nhật từ name + description + material + pattern) |`);
      console.log(`| \`product_variants.color_name\` (màu 1) | \`Xanh rêu olive Baity\` | \`${h.first_color_name}\` | **CÓ** (bỏ chữ "Baity" ở tên màu biến thể đầu tiên) |`);
      console.log(`| \`product_attributes.attr_value\` (\`pattern\`) | \`theu-logo\` | \`${h.pattern_attr}\` | **CÓ** (\`theu-logo\` -> \`theu-nho\`) |`);
      console.log(`| \`product_images.image_url\` (ảnh chính) | \`https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=800&q=80\` | \`${h.primary_image_url}\` | **CÓ** (chuyển sang ảnh giữ chỗ nội bộ theo bộ Demo 29 SP) |`);
    }

    await closeDb().catch(() => {});
    process.exit(0);
  } catch (err: any) {
    console.error('[SEED_APPLY_DEMO_CATALOG_ERROR]', err?.message || err);
    await closeDb().catch(() => {});
    process.exit(1);
  }
}

runSeedApplyDemoCatalog();
