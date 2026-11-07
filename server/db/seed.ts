import { queryRows } from './index.ts';
import { sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import {
  SEED_POLICIES_AND_FAQ_ITEMS,
  ensurePoliciesAndFaqSeeded,
} from '../services/policyFaq.ts';
import { DEFAULT_SHIPPING_CONFIG } from '../../shared/contracts.ts';
import {
  isStrictRuntimeMode,
  validateAdminPasswordPolicy,
} from '../config/runtimeMode.ts';

// Hàm chuẩn hóa tiếng Việt không dấu cho search_text
export function normalizeVietnameseText(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const BASE_CATEGORY_DATA = [
  { name: 'Áo thun', slug: 'ao-thun', order: 1 },
  { name: 'Áo sơ mi', slug: 'ao-so-mi', order: 2 },
  { name: 'Áo khoác & Blazer', slug: 'ao-khoac-blazer', order: 3 },
  { name: 'Quần jean & Denim', slug: 'quan-jean-denim', order: 4 },
  { name: 'Quần tây & Kaki', slug: 'quan-tay-kaki', order: 5 },
  { name: 'Quần short', slug: 'quan-short', order: 6 },
  { name: 'Váy & Đầm', slug: 'vay-dam', order: 7 },
  { name: 'Áo len & Hoodie', slug: 'ao-len-hoodie', order: 8 },
  { name: 'Phụ kiện thời trang', slug: 'phu-kien-thoi-trang', order: 9 },
];

export const DEFAULT_SIZE_CHARTS_DATA = {
  men: [
    { size: 'S', height: '160 - 165cm', weight: '50 - 58kg', chest: '86 - 90cm', waist: '72 - 76cm' },
    { size: 'M', height: '165 - 170cm', weight: '59 - 66kg', chest: '90 - 94cm', waist: '76 - 80cm' },
    { size: 'L', height: '170 - 176cm', weight: '67 - 74kg', chest: '94 - 98cm', waist: '80 - 84cm' },
    { size: 'XL', height: '176 - 182cm', weight: '75 - 82kg', chest: '98 - 104cm', waist: '84 - 90cm' },
    { size: 'XXL', height: '180 - 188cm', weight: '83 - 92kg', chest: '104 - 110cm', waist: '90 - 98cm' },
  ],
  women: [
    { size: 'XS', height: '150 - 155cm', weight: '40 - 45kg', chest: '78 - 82cm', waist: '60 - 64cm' },
    { size: 'S', height: '155 - 160cm', weight: '45 - 50kg', chest: '82 - 86cm', waist: '64 - 68cm' },
    { size: 'M', height: '160 - 165cm', weight: '50 - 56kg', chest: '86 - 90cm', waist: '68 - 72cm' },
    { size: 'L', height: '165 - 170cm', weight: '56 - 63kg', chest: '90 - 94cm', waist: '72 - 76cm' },
    { size: 'XL', height: '168 - 175cm', weight: '63 - 70kg', chest: '94 - 100cm', waist: '76 - 82cm' },
  ],
  unisex: [
    { size: 'S', height: '155 - 165cm', weight: '45 - 58kg', fitNote: 'Phom rộng suông, thoải mái' },
    { size: 'M', height: '165 - 172cm', weight: '58 - 68kg', fitNote: 'Phom rộng vừa vặn phong cách streetwear' },
    { size: 'L', height: '172 - 178cm', weight: '68 - 78kg', fitNote: 'Phom rộng rãi, vai thả thời thượng' },
    { size: 'XL', height: '178 - 185cm', weight: '78 - 88kg', fitNote: 'Oversized cá tính' },
  ],
  pants: [
    { size: '28', waist: '71 - 73cm', hip: '86 - 89cm', length: '98cm' },
    { size: '29', waist: '74 - 76cm', hip: '89 - 92cm', length: '99cm' },
    { size: '30', waist: '76 - 79cm', hip: '92 - 95cm', length: '100cm' },
    { size: '31', waist: '79 - 81cm', hip: '95 - 98cm', length: '101cm' },
    { size: '32', waist: '81 - 84cm', hip: '98 - 101cm', length: '102cm' },
    { size: '33', waist: '84 - 87cm', hip: '101 - 104cm', length: '103cm' },
    { size: '34', waist: '87 - 90cm', hip: '104 - 107cm', length: '104cm' },
  ],
};

export const DEFAULT_GENERAL_SETTINGS = {
  storeName: 'Baity Fashion',
  tagline: 'Thời trang bền vững cho phong cách sống hiện đại',
  freeShippingThreshold: DEFAULT_SHIPPING_CONFIG.freeShippingThreshold,
  defaultShippingFee: DEFAULT_SHIPPING_CONFIG.defaultShippingFee,
  expressShippingFee: DEFAULT_SHIPPING_CONFIG.expressShippingFee,
  returnDaysLimit: DEFAULT_SHIPPING_CONFIG.returnDaysLimit,
  lowStockThreshold: 5,
};

export async function ensureBaselineStoreDataSeeded(): Promise<Record<string, string>> {
  await ensurePoliciesAndFaqSeeded(queryRows);

  await queryRows(sql`
    INSERT INTO store_settings (key, value, description)
    VALUES 
    ('size_charts', ${JSON.stringify(DEFAULT_SIZE_CHARTS_DATA)}::jsonb, 'Bảng quy đổi kích thước chuẩn cho Nam, Nữ, Unisex và Quần'),
    ('general', ${JSON.stringify(DEFAULT_GENERAL_SETTINGS)}::jsonb, 'Cấu hình thông tin chung và phí vận chuyển cửa hàng')
    ON CONFLICT (key) DO NOTHING;
  `);

  const catMap: Record<string, string> = {};
  for (const cat of BASE_CATEGORY_DATA) {
    const res = await queryRows<{ id: string }>(sql`
      INSERT INTO categories (name, slug, display_order)
      VALUES (${cat.name}, ${cat.slug}, ${cat.order})
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id;
    `);
    catMap[cat.slug] = res[0].id;
  }
  return catMap;
}

export async function seedDatabase() {
  const isProd = isStrictRuntimeMode();
  const isTestEnv = process.env.NODE_ENV === 'test';

  // 0. Nội dung nền tảng của cửa hàng (Chính sách, FAQ, cài đặt mặc định store_settings, 9 danh mục gốc categories)
  // luôn được khởi tạo an toàn trên cả Production (CSDL trống) và Development mà không ghi đè dữ liệu Admin đã sửa.
  const catMap = await ensureBaselineStoreDataSeeded();

  // 1. Ở chế độ strict production:
  // Kiểm tra nghiêm ngặt tài khoản dev tồn đọng và khởi tạo Admin từ ADMIN_EMAIL & ADMIN_INITIAL_PASSWORD
  if (isProd) {
    if (process.env.REFRESH_DEMO_SALE === 'true') {
      throw new Error(
        'REFRESH_DEMO_SALE_FORBIDDEN_IN_PRODUCTION: Không được phép làm mới khung giờ sale mẫu ở môi trường production.'
      );
    }
    console.log('🔒 [PRODUCTION] Đang kiểm tra an toàn tài khoản trong CSDL...');

    // Kiểm tra xem CSDL production có đang chứa các tài khoản mẫu hoặc đơn hàng mẫu của môi trường dev hay không
    const foundDevUsers = await queryRows<{ cnt: number }>(sql`
      SELECT COUNT(*)::int AS cnt FROM users
      WHERE LOWER(email) IN ('admin@baity.vn', 'khach1@baity.vn', 'khach2@baity.vn');
    `);
    const foundDevOrders = await queryRows<{ cnt: number }>(sql`
      SELECT COUNT(*)::int AS cnt FROM orders
      WHERE id IN ('BAITY-1001', 'BAITY-1002', 'BAITY-1003', 'BAITY-1004');
    `);

    const hasDevUsers = (foundDevUsers[0]?.cnt || 0) > 0;
    const hasDevOrders = (foundDevOrders[0]?.cnt || 0) > 0;
    if (hasDevUsers || hasDevOrders) {
      const reasonDetail =
        hasDevUsers && hasDevOrders
          ? 'phát hiện tài khoản mẫu và đơn hàng mẫu'
          : hasDevUsers
          ? 'phát hiện tài khoản mẫu'
          : 'phát hiện đơn hàng mẫu';
      const msg = `CSDL chứa dữ liệu mẫu (${reasonDetail}), không dùng CSDL thử cho bản thật`;
      console.error(`❌ [PRODUCTION] ${msg}`);
      throw new Error(msg);
    }

    const adminEmailCheck = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
    if (['admin@baity.vn', 'khach1@baity.vn', 'khach2@baity.vn'].includes(adminEmailCheck)) {
      const msg = 'ADMIN_EMAIL không được dùng email mẫu của dữ liệu thử';
      console.error(`❌ [PRODUCTION] ${msg}`);
      throw new Error(`INVALID_PRODUCTION_ADMIN_CREDENTIALS: ${msg}`);
    }

    const existingAdmin = await queryRows<{ id: string }>(
      sql`SELECT id FROM users WHERE role = 'admin' LIMIT 1;`
    );

    if (existingAdmin.length === 0) {
      const adminEmail = adminEmailCheck;
      const adminInitialPassword = process.env.ADMIN_INITIAL_PASSWORD;
      const pwdCheck = validateAdminPasswordPolicy(adminInitialPassword);

      if (!adminEmail || !adminInitialPassword) {
        throw new Error(
          'INVALID_PRODUCTION_ADMIN_CREDENTIALS: Bắt buộc cấu hình ADMIN_EMAIL và ADMIN_INITIAL_PASSWORD khi CSDL Production chưa có tài khoản Admin.'
        );
      } else if (!pwdCheck.valid) {
        throw new Error(
          `INVALID_PRODUCTION_ADMIN_CREDENTIALS: ${pwdCheck.reason || 'Mật khẩu Admin không hợp lệ.'}`
        );
      } else {
        const passwordHash = bcrypt.hashSync(adminInitialPassword.trim(), 10);
        await queryRows(sql`
          INSERT INTO users (full_name, email, phone, password_hash, role, password_changed_at)
          VALUES ('Baity Administrator', ${adminEmail}, '0901234567', ${passwordHash}, 'admin', NOW())
          ON CONFLICT (email) DO NOTHING;
        `);
        console.log(`✅ [PRODUCTION] Đã khởi tạo tài khoản Admin lần đầu từ biến môi trường: ${adminEmail}`);
      }
    } else {
      console.log('ℹ️ [PRODUCTION] Tài khoản Admin đã tồn tại trong CSDL. Không cập nhật mật khẩu hay quyền lúc khởi động.');
    }

    const enableSeedDemo = process.env.ENABLE_SEED_DEMO_DATA === 'true';
    if (!enableSeedDemo) {
      console.log('🛡️ [PRODUCTION] Không seed dữ liệu mẫu (đã nạp chính sách, FAQ, cài đặt mặc định, 9 danh mục gốc; không nạp sản phẩm/đơn hàng/đánh giá/voucher mẫu trừ khi bật ENABLE_SEED_DEMO_DATA=true).');
      return;
    }
    console.log('🚀 [PRODUCTION] ENABLE_SEED_DEMO_DATA=true: Chỉ nạp danh mục, sản phẩm, khuyến mãi và voucher (TUYỆT ĐỐI KHÔNG tạo tài khoản mẫu)...');
  }

  // 1b. Ở chế độ không strict (Dev / Preview) nhưng KHÔNG phải NODE_ENV=test:
  // ADMIN_INITIAL_PASSWORD chỉ dùng để TẠO tài khoản Admin khi CSDL chưa có bất kỳ tài khoản Admin nào.
  // Không bao giờ cập nhật mật khẩu hay quyền của Admin đã tồn tại lúc khởi động (đặt lại mật khẩu chỉ qua npm run db:secure-dev-accounts -- --confirm).
  if (!isProd && !isTestEnv) {
    const existingAdmin = await queryRows<{ id: string }>(
      sql`SELECT id FROM users WHERE role = 'admin' LIMIT 1;`
    );

    if (existingAdmin.length === 0) {
      const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
      const adminInitialPassword = process.env.ADMIN_INITIAL_PASSWORD;
      const pwdCheck = validateAdminPasswordPolicy(adminInitialPassword);

      if (!pwdCheck.valid) {
        console.error(
          `❌ [ADMIN PASSWORD POLICY ERROR] ${pwdCheck.reason} Không tạo tài khoản Admin (bản preview vẫn tiếp tục chạy).`
        );
      } else if (adminEmail && !['khach1@baity.vn', 'khach2@baity.vn'].includes(adminEmail)) {
        const passwordHash = bcrypt.hashSync(adminInitialPassword!.trim(), 10);
        await queryRows(sql`
          INSERT INTO users (full_name, email, phone, password_hash, role, password_changed_at)
          VALUES ('Baity Administrator', ${adminEmail}, '0901234567', ${passwordHash}, 'admin', NOW())
          ON CONFLICT (email) DO NOTHING;
        `);
        console.log(`✅ [DEV/PREVIEW] Đã khởi tạo tài khoản Admin lần đầu đạt chuẩn bảo mật: ${adminEmail}`);
      }
    } else {
      console.log('ℹ️ [DEV/PREVIEW] Tài khoản Admin đã tồn tại trong CSDL. Không cập nhật mật khẩu hay quyền lúc khởi động.');
    }
  }

  // 2. Ở môi trường Development / Test (KHÔNG chạy ở Production):
  // Chỉ tạo tài khoản mẫu khi cờ tường minh SEED_DEV_ACCOUNTS=true (mặc định false và chỉ có hiệu lực khi !isProd).
  const shouldSeedDevAccounts = !isProd && process.env.SEED_DEV_ACCOUNTS === 'true';

  if (shouldSeedDevAccounts) {
    const passwordUser1 = bcrypt.hashSync('Khach@123', 10);
    const passwordUser2 = bcrypt.hashSync('Khach@123', 10);

    // Chỉ tạo admin@baity.vn với mật khẩu mẫu khi NODE_ENV === 'test' (ở mọi chế độ khác áp dụng chính sách mật khẩu Admin >= 12 ký tự)
    if (isTestEnv) {
      const passwordAdmin = bcrypt.hashSync('Admin@123', 10);
      await queryRows(sql`
        INSERT INTO users (full_name, email, phone, password_hash, role, avatar_url, password_changed_at)
        VALUES ('Baity Administrator', 'admin@baity.vn', '0901234567', ${passwordAdmin}, 'admin', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80', NOW())
        ON CONFLICT (email) DO UPDATE SET password_hash = ${passwordAdmin};
      `);
    }

    await queryRows(sql`
      INSERT INTO users (full_name, email, phone, password_hash, role, height_cm, weight_kg, avatar_url, password_changed_at)
      VALUES ('Trần Hoàng Nam', 'khach1@baity.vn', '0912345678', ${passwordUser1}, 'customer', 172, 65, 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80', NOW())
      ON CONFLICT (email) DO NOTHING;
    `);

    await queryRows(sql`
      INSERT INTO users (full_name, email, phone, password_hash, role, height_cm, weight_kg, avatar_url, password_changed_at)
      VALUES ('Lê Thị Mai Chi', 'khach2@baity.vn', '0987654321', ${passwordUser2}, 'customer', 160, 48, 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80', NOW())
      ON CONFLICT (email) DO NOTHING;
    `);

    // Tạo địa chỉ mẫu nếu chưa có
    const sampleUsers = await queryRows<{ id: string; email: string }>(sql`
      SELECT id, email FROM users WHERE email IN ('khach1@baity.vn', 'khach2@baity.vn');
    `);
    for (const u of sampleUsers) {
      const existingAddr = await queryRows<{ count: number }>(sql`
        SELECT count(*)::int as count FROM addresses WHERE user_id = ${u.id};
      `);
      if ((existingAddr[0]?.count || 0) === 0) {
        if (u.email === 'khach1@baity.vn') {
          await queryRows(sql`
            INSERT INTO addresses (user_id, receiver_name, phone, province, district, ward, street_address, is_default)
            VALUES 
            (${u.id}, 'Trần Hoàng Nam', '0912345678', 'TP. Hồ Chí Minh', NULL, 'Phường Bến Nghé', '123 Đường Lê Lợi', true),
            (${u.id}, 'Trần Hoàng Nam (Công ty)', '0912345678', 'TP. Hồ Chí Minh', NULL, 'Phường Võ Thị Sáu', '45 Đường Nam Kỳ Khởi Nghĩa', false);
          `);
        } else {
          await queryRows(sql`
            INSERT INTO addresses (user_id, receiver_name, phone, province, district, ward, street_address, is_default)
            VALUES 
            (${u.id}, 'Lê Thị Mai Chi', '0987654321', 'TP. Hà Nội', NULL, 'Phường Dịch Vọng', '88 Đường Xuân Thủy', true);
          `);
        }
      }
    }
    console.log('✅ [DEV/PREVIEW] SEED_DEV_ACCOUNTS=true: Đã nạp tài khoản kiểm thử.');
  } else if (!isProd) {
    const existingDevAccounts = await queryRows<{ email: string; role: string }>(sql`
      SELECT email, role FROM users WHERE LOWER(email) IN ('admin@baity.vn', 'khach1@baity.vn', 'khach2@baity.vn') ORDER BY email ASC;
    `);
    console.log(
      `ℹ️ [DEV/PREVIEW] SEED_DEV_ACCOUNTS=${process.env.SEED_DEV_ACCOUNTS || 'false'}: Tài khoản mẫu đang có sẵn trong CSDL: [${existingDevAccounts.map((u) => `${u.email} (${u.role})`).join(', ') || 'không có'}]`
    );
  }

  const isProdStrict = isProd;

  if (process.env.REFRESH_DEMO_SALE === 'true' && isProdStrict) {
    throw new Error(
      'REFRESH_DEMO_SALE_FORBIDDEN_IN_PRODUCTION: Không được phép làm mới khung giờ sale mẫu ở môi trường production.'
    );
  }

  const existingProducts = await queryRows<{ count: number }>(
    sql`SELECT count(*)::int as count FROM products;`
  );
  const count = existingProducts[0]?.count || 0;
  if (count > 0) {
    if (process.env.REFRESH_DEMO_SALE === 'true') {
      await queryRows(sql`
        UPDATE promotions
        SET start_time = NOW() - INTERVAL '1 day',
            end_time = NOW() + INTERVAL '60 days',
            is_active = true
        WHERE title LIKE 'Flash Sale Mùa Thu%';
      `);
    }

    // Đồng bộ biến thể XXL của Áo Sơ Mi Oxford về hết hàng (0) nếu bị gán nhầm 15 trước đó
    await queryRows(sql`
      UPDATE product_variants pv
      SET stock_quantity = 0
      FROM products p
      WHERE pv.product_id = p.id
        AND p.slug = 'ao-so-mi-oxford-dai-tay-phom-regular-nam'
        AND pv.size = 'XXL'
        AND pv.stock_quantity = 15;
    `);

    await ensurePoliciesAndFaqSeeded(queryRows);

    await queryRows(sql`
      INSERT INTO vouchers (code, discount_type, discount_value, max_discount, min_order_value, usage_limit, per_user_limit, used_count, start_date, end_date, is_active)
      VALUES 
      ('BAITYWELCOME', 'percent', 15, 100000, 299000, 500, 10, 0, NOW() - INTERVAL '5 days', NOW() + INTERVAL '90 days', true),
      ('BAITYFREESHIP', 'free_shipping', 0, NULL, 499000, 1000, 10, 0, NOW() - INTERVAL '5 days', NOW() + INTERVAL '60 days', true),
      ('BAITYVIP50K', 'fixed', 50000, 50000, 599000, 200, 10, 0, NOW() - INTERVAL '2 days', NOW() + INTERVAL '30 days', true)
      ON CONFLICT (code) DO NOTHING;
    `);

    const modeTag = isProd ? '[PRODUCTION]' : '[DEV/TEST]';
    console.log(`ℹ️ ${modeTag} CSDL đã có ${count} sản phẩm. Đã giữ nguyên dữ liệu quản trị hiện có (vouchers, promotions, store_settings, faq_policies) và bỏ qua seed lại sản phẩm.`);
    return;
  }

  console.log(
    isProd
      ? '🌱 [PRODUCTION] Bắt đầu seed dữ liệu mẫu phong phú cho Baity Fashion...'
      : '🌱 [DEV/TEST] Bắt đầu seed dữ liệu mẫu phong phú cho Baity Fashion...'
  );

  // 5. Seed Vouchers (chỉ chèn khi chưa có mã, không ghi đè dữ liệu admin đã sửa)
  await queryRows(sql`
    INSERT INTO vouchers (code, discount_type, discount_value, max_discount, min_order_value, usage_limit, per_user_limit, used_count, start_date, end_date, is_active)
    VALUES 
    ('BAITYWELCOME', 'percent', 15, 100000, 299000, 500, 1, 12, NOW() - INTERVAL '5 days', NOW() + INTERVAL '90 days', true),
    ('BAITYFREESHIP', 'free_shipping', 0, NULL, 499000, 1000, 3, 45, NOW() - INTERVAL '5 days', NOW() + INTERVAL '60 days', true),
    ('BAITYVIP50K', 'fixed', 50000, 50000, 599000, 200, 1, 8, NOW() - INTERVAL '2 days', NOW() + INTERVAL '30 days', true)
    ON CONFLICT (code) DO NOTHING;
  `);

  // 6. Seed Flash Sale Promotion (chỉ chèn khi bảng promotions đang trống)
  const existingPromoCount = await queryRows<{ count: number }>(
    sql`SELECT count(*)::int as count FROM promotions;`
  );
  if ((existingPromoCount[0]?.count || 0) === 0) {
    const promoRes = await queryRows<{ id: string }>(sql`
      INSERT INTO promotions (title, banner_url, start_time, end_time, is_active)
      VALUES 
      ('Flash Sale Mùa Thu - Giảm đến 20% Bộ Sưu Tập Áo Khoác & Áo Sơ Mi', 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1200&q=80', NOW() - INTERVAL '1 day', NOW() + INTERVAL '60 days', true)
      RETURNING id;
    `);
    const promoId = promoRes[0]?.id;

    if (promoId) {
      await queryRows(sql`
        INSERT INTO promotion_targets (promotion_id, target_type, target_id, discount_percent)
        VALUES 
          (${promoId}, 'category', ${catMap['ao-khoac-blazer']}, 20),
          (${promoId}, 'category', ${catMap['ao-so-mi']}, 15);
      `);
    }
  }

  // 7. Seed 29 Sản Phẩm Bộ Demo Chuẩn Hóa (10 Nam, 11 Nữ, 8 Unisex; 12 ảnh thật /seed-images/<slug>.jpg + 17 ảnh giữ chỗ /seed-images/placeholder-<category>.svg)
  const productsRaw = SEED_PRODUCTS_RAW;

  let skuCounter = 1000;
  let firstVariantIdForOrder = '';
  let firstProductIdForOrder = '';

  for (const p of productsRaw) {
    const slug = normalizeVietnameseText(p.name).replace(/\s+/g, '-');
    const categoryId = catMap[p.cat];
    const catName = BASE_CATEGORY_DATA.find((c) => c.slug === p.cat)?.name || p.cat;
    const searchText = normalizeVietnameseText(
      `${p.name} ${catName} ${p.desc} ${p.mat} ${p.gender} ${Object.values(p.attrs).join(' ')}`
    );

    const prodRes = await queryRows<{ id: string }>(sql`
      INSERT INTO products (name, slug, category_id, target_gender, description, material, care_instructions, base_price, search_text, is_active)
      VALUES (${p.name}, ${slug}, ${categoryId}, ${p.gender}, ${p.desc}, ${p.mat}, ${p.care}, ${p.price}, ${searchText}, true)
      RETURNING id;
    `);
    const prodId = prodRes[0].id;
    if (!firstProductIdForOrder) firstProductIdForOrder = prodId;

    // Insert ảnh
    for (let i = 0; i < p.images.length; i++) {
      await queryRows(sql`
        INSERT INTO product_images (product_id, image_url, is_primary, display_order)
        VALUES (${prodId}, ${p.images[i]}, ${i === 0}, ${i});
      `);
    }

    // Insert thẻ thuộc tính AI
    for (const [key, value] of Object.entries(p.attrs)) {
      await queryRows(sql`
        INSERT INTO product_attributes (product_id, attr_key, attr_value)
        VALUES (${prodId}, ${key}, ${value});
      `);
    }

    // Insert Biến thể Màu x Size
    for (const color of p.colors) {
      for (let sIdx = 0; sIdx < p.sizes.length; sIdx++) {
        const size = p.sizes[sIdx];
        skuCounter++;
        const sku = `BTY-${p.gender.toUpperCase().slice(0, 1)}-${skuCounter}`;
        const stock = p.stocks[sIdx % p.stocks.length] ?? 15;

        const varRes = await queryRows<{ id: string }>(sql`
          INSERT INTO product_variants (product_id, color_name, color_code, size, sku, stock_quantity, price_override)
          VALUES (${prodId}, ${color.name}, ${color.code}, ${size}, ${sku}, ${stock}, null)
          RETURNING id;
        `);
        if (!firstVariantIdForOrder && stock > 0) {
          firstVariantIdForOrder = varRes[0].id;
        }
      }
    }
  }

  // 8. Seed Đơn Hàng & Đánh Giá Mẫu (chỉ khi có tài khoản mẫu ở môi trường Dev/Test)
  if (!isProd) {
    const devUsers = await queryRows<{ id: string; email: string }>(sql`
      SELECT id, email FROM users WHERE email IN ('khach1@baity.vn', 'khach2@baity.vn');
    `);
    const user1Id = devUsers.find((u) => u.email === 'khach1@baity.vn')?.id;
    const user2Id = devUsers.find((u) => u.email === 'khach2@baity.vn')?.id;

    if (user1Id && user2Id && firstVariantIdForOrder && firstProductIdForOrder) {
      await queryRows(sql`
        INSERT INTO orders (id, user_id, receiver_name, receiver_phone, shipping_address, shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status, tracking_code, delivered_at, created_at)
        VALUES ('BAITY-1001', ${user1Id}, 'Trần Hoàng Nam', '0912345678', '123 Đường Lê Lợi, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh', 'standard', 30000, 568000, 50000, 548000, 'delivered', 'VNP9823412', NOW() - INTERVAL '3 days', NOW() - INTERVAL '6 days')
        ON CONFLICT (id) DO NOTHING;
      `);

      await queryRows(sql`
        INSERT INTO order_items (order_id, variant_id, product_name, color, size, unit_price, quantity, total_price)
        VALUES ('BAITY-1001', ${firstVariantIdForOrder}, 'Áo Sơ Mi Oxford Dài Tay Phom Regular Nam', 'Trắng tinh khôi', 'L', 349000, 1, 349000);
      `);

      await queryRows(sql`
        INSERT INTO payments (order_id, method, status, transaction_id, paid_at)
        VALUES ('BAITY-1001', 'vietqr', 'paid', 'VQR-MB-9923841', NOW() - INTERVAL '6 days')
        ON CONFLICT (transaction_id) DO NOTHING;
      `);

      await queryRows(sql`
        INSERT INTO order_status_history (order_id, status, note, changed_by, created_at)
        VALUES 
        ('BAITY-1001', 'pending', 'Khởi tạo đơn hàng VietQR', 'system', NOW() - INTERVAL '6 days'),
        ('BAITY-1001', 'confirmed', 'Đã nhận chuyển khoản VietQR thành công', 'admin', NOW() - INTERVAL '6 days' + INTERVAL '5 minutes'),
        ('BAITY-1001', 'shipping', 'Đơn vị vận chuyển VNPost đã lấy hàng', 'admin', NOW() - INTERVAL '5 days'),
        ('BAITY-1001', 'delivered', 'Giao hàng thành công tới khách hàng', 'system', NOW() - INTERVAL '3 days');
      `);

      await queryRows(sql`
        INSERT INTO orders (id, user_id, receiver_name, receiver_phone, shipping_address, shipping_method, shipping_fee, subtotal, discount_amount, total_amount, status, created_at)
        VALUES ('BAITY-1002', ${user2Id}, 'Lê Thị Mai Chi', '0987654321', '88 Đường Xuân Thủy, Phường Dịch Vọng, Quận Cầu Giấy, TP. Hà Nội', 'standard', 30000, 489000, 0, 519000, 'pending', NOW() - INTERVAL '10 minutes')
        ON CONFLICT (id) DO NOTHING;
      `);

      await queryRows(sql`
        INSERT INTO payments (order_id, method, status)
        VALUES ('BAITY-1002', 'vietqr', 'pending');
      `);

      // 9. Seed Đánh giá sản phẩm mẫu
      await queryRows(sql`
        INSERT INTO reviews (product_id, user_id, order_id, rating, comment, seller_reply, seller_replied_at, created_at)
        VALUES (
          ${firstProductIdForOrder},
          ${user1Id},
          'BAITY-1001',
          5,
          'Chất vải Oxford của Baity dày dặn, phom đứng rất đẹp và mặc đi làm cả ngày không hề bị bí nóng. Đóng gói hộp rất trang trọng và giao nhanh!',
          'Baity chân thành cảm ơn quý khách Hoàng Nam đã tin tưởng ủng hộ! Chúc bạn luôn tự tin và thành công cùng trang phục của Baity ạ ❤️',
          NOW() - INTERVAL '2 days',
          NOW() - INTERVAL '2 days' - INTERVAL '4 hours'
        )
        ON CONFLICT (user_id, product_id, order_id) DO NOTHING;
      `);
    }
  }

  // 10. Đảm bảo 4 Chính sách cửa hàng & 12 Câu hỏi thường gặp (FAQ) theo slug (chèn khi slug chưa tồn tại, không ghi đè)
  await ensurePoliciesAndFaqSeeded(queryRows);

  console.log(
    `🎉 ${isProd ? '[PRODUCTION] ' : ''}Hoàn tất seed dữ liệu: 9 Danh mục, 29 Sản phẩm Demo (10 Nam, 11 Nữ, 8 Unisex), Vouchers, 4 Chính sách và 12 FAQ!`
  );
}

export const SEED_PRODUCTS_RAW = [
  // --- 10 SẢN PHẨM NAM (men) ---
  {
    name: 'Áo Sơ Mi Oxford Dài Tay Phom Regular Nam',
    cat: 'ao-so-mi',
    gender: 'men',
    price: 349000,
    desc: 'Áo sơ mi nam chất liệu vải Oxford 100% cotton dệt chéo dày dặn, thấm hút mồ hôi tốt. Cổ cài nút button-down lịch lãm phù hợp đi làm lẫn dạo phố.',
    mat: '100% Cotton Oxford dệt cao cấp',
    care: 'Giặt máy ở nhiệt độ thường, không dùng thuốc tẩy, ủi ở nhiệt độ trung bình.',
    colors: [
      { name: 'Trắng tinh khôi', code: '#FFFFFF' },
      { name: 'Xanh nhạt pastel', code: '#B0C4DE' },
      { name: 'Xanh Navy trầm', code: '#1B263B' },
    ],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    stocks: [18, 25, 30, 12, 0],
    images: ['/seed-images/ao-so-mi-oxford-dai-tay-phom-regular-nam.jpg'],
    attrs: { style: 'cong-so', pattern: 'tron', fit: 'regular', occasion: 'di-lam', sleeve: 'dai-tay' },
  },
  {
    name: 'Áo Thun Nam Cổ Tròn Cotton Pima Siêu Mịn',
    cat: 'ao-thun',
    gender: 'men',
    price: 219000,
    desc: 'Áo thun nam dệt từ sợi bông Pima quý hiếm, cho cảm giác mềm mịn vượt trội, hạn chế xù lông sau nhiều lần giặt. Phom regular tôn dáng.',
    mat: '100% Cotton Pima định lượng 220gsm',
    care: 'Giặt nước lạnh, phơi ngang trong bóng râm, tránh sấy nhiệt độ cao.',
    colors: [
      { name: 'Đen than', code: '#1A1C19' },
      { name: 'Trắng kem', code: '#F5F2EB' },
      { name: 'Xanh rêu olive', code: '#2D4A3E' },
    ],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    stocks: [20, 35, 40, 15, 3],
    images: ['/seed-images/placeholder-ao-thun.svg'],
    attrs: { style: 'basic', pattern: 'tron', fit: 'regular', occasion: 'hang-ngay', sleeve: 'ngan-tay' },
  },
  {
    name: 'Quần Jean Nam Ống Đứng Regular Selvedge Denim',
    cat: 'quan-jean-denim',
    gender: 'men',
    price: 529000,
    desc: 'Quần bò nam chất liệu Selvedge Denim biên đỏ bền chắc, wash màu cổ điển tự nhiên, tôn vinh phong cách vintage nam tính.',
    mat: '98% Cotton Denim, 2% Spandex co giãn nhẹ',
    care: 'Lộn trái khi giặt, hạn chế giặt với chất tẩy mạnh để giữ màu wash.',
    colors: [
      { name: 'Xanh chàm Indigo', code: '#273C75' },
      { name: 'Xanh đen Vintage', code: '#192A56' },
    ],
    sizes: ['29', '30', '31', '32', '33', '34'],
    stocks: [8, 15, 20, 18, 6, 0],
    images: ['/seed-images/placeholder-quan-jean-denim.svg'],
    attrs: { style: 'casual', pattern: 'wash', fit: 'ong-dung', occasion: 'hang-ngay', length: 'dai' },
  },
  {
    name: 'Áo Khoác Blazer Nam Công Sở 2 Khuy Hiện Đại',
    cat: 'ao-khoac-blazer',
    gender: 'men',
    price: 849000,
    desc: 'Áo vest blazer nam 2 hàng khuy phom may đo chuẩn Hàn Quốc, độn vai nhẹ tự nhiên, tôn dáng quý ông lịch thiệp.',
    mat: '70% Polyester, 28% Rayon, 2% Spandex lót lụa',
    care: 'Giặt khô hoặc giặt hấp, treo bằng móc bản to.',
    colors: [
      { name: 'Xám than chì', code: '#353B48' },
      { name: 'Xanh Navy lịch lãm', code: '#1E272C' },
      { name: 'Be cà phê ấm', code: '#8C7B6B' },
    ],
    sizes: ['S', 'M', 'L', 'XL'],
    stocks: [5, 12, 10, 2],
    images: ['/seed-images/placeholder-ao-khoac-blazer.svg'],
    attrs: { style: 'cong-so', pattern: 'tron', fit: 'tailored', occasion: 'su-kien', sleeve: 'dai-tay' },
  },
  {
    name: 'Quần Short Kaki Nam Co Giãn Thoáng Mát',
    cat: 'quan-short',
    gender: 'men',
    price: 249000,
    desc: 'Quần short kaki lưng chun co giãn nhẹ, túi xẻ hai bên tiện lợi, chiều dài ngang gối năng động ngày hè.',
    mat: '97% Cotton Kaki, 3% Elastane',
    care: 'Giặt máy bình thường, sấy nhẹ.',
    colors: [
      { name: 'Be cát', code: '#C4B5A5' },
      { name: 'Xanh rêu nhạt', code: '#556B2F' },
      { name: 'Đen than', code: '#222222' },
    ],
    sizes: ['29', '30', '31', '32', '33'],
    stocks: [12, 18, 25, 10, 0],
    images: ['/seed-images/placeholder-quan-short.svg'],
    attrs: { style: 'casual', pattern: 'tron', fit: 'regular', occasion: 'du-lich', length: 'ngan' },
  },
  {
    name: 'Áo Khoác Bomber Nam Kaki 2 Lớp Chống Gió',
    cat: 'ao-khoac-blazer',
    gender: 'men',
    price: 589000,
    desc: 'Áo khoác bomber bo gấu cổ dệt sọc thể thao, lớp lót dù cản gió ấm áp, khóa kéo đồng mạ cao cấp không gỉ.',
    mat: 'Vải Kaki dệt mật độ cao kết hợp lót Poly',
    care: 'Giặt nước ấm dưới 30 độ, không vắt xoắn mạnh.',
    colors: [
      { name: 'Xanh rêu quân đội', code: '#3D523C' },
      { name: 'Đen tuyền', code: '#1A1A1A' },
    ],
    sizes: ['M', 'L', 'XL', 'XXL'],
    stocks: [8, 14, 9, 3],
    images: ['/seed-images/placeholder-ao-khoac-blazer.svg'],
    attrs: { style: 'streetwear', pattern: 'tron', fit: 'regular', occasion: 'mua-dong', sleeve: 'dai-tay' },
  },
  {
    name: 'Áo Sơ Mi Nam Cổ Tàu Vải Đũi Linen Mát Mẻ',
    cat: 'ao-so-mi',
    gender: 'men',
    price: 329000,
    desc: 'Sơ mi cổ trụ Trung Hoa phong cách tối giản thanh tịnh, vải Linen đũi tự nhiên thoáng khí, thấm mồ hôi tối đa.',
    mat: '100% Linen tự nhiên giặt mềm',
    care: 'Giặt nhẹ, ủi khi áo còn ẩm để giữ nếp vải đũi tự nhiên.',
    colors: [
      { name: 'Trắng gạo', code: '#FAF0E6' },
      { name: 'Be mộc', code: '#E4D5C7' },
      { name: 'Xanh lơ biển', code: '#7CA1B4' },
    ],
    sizes: ['S', 'M', 'L', 'XL'],
    stocks: [15, 22, 18, 5],
    images: ['/seed-images/ao-so-mi-nam-co-tau-vai-dui-linen-mat-me.jpg'],
    attrs: { style: 'minimalist', pattern: 'tron', fit: 'regular', occasion: 'du-lich', sleeve: 'dai-tay' },
  },
  {
    name: 'Quần Kaki Nam Dáng Slimfit Tôn Chiều Cao',
    cat: 'quan-tay-kaki',
    gender: 'men',
    price: 399000,
    desc: 'Quần kaki ống ôm nhẹ tôn dáng thanh thoát, thiết kế túi sau có khuy cài an toàn, đường may đôi chắc chắn.',
    mat: 'Cotton twill cao cấp chải kỹ',
    care: 'Giặt máy chế độ thường, tránh ngâm lâu.',
    colors: [
      { name: 'Vàng Khaki', code: '#C3B091' },
      { name: 'Xám tro', code: '#808080' },
      { name: 'Xanh rêu đậm', code: '#2D4A3E' },
    ],
    sizes: ['29', '30', '31', '32', '34'],
    stocks: [11, 20, 26, 15, 6],
    images: ['/seed-images/quan-kaki-nam-dang-slimfit-ton-chieu-cao.jpg'],
    attrs: { style: 'basic', pattern: 'tron', fit: 'slimfit', occasion: 'di-lam', length: 'dai' },
  },
  {
    name: 'Áo Len Nam Cổ Lọ Vải Cashmere Pha Ấm Áp',
    cat: 'ao-len-hoodie',
    gender: 'men',
    price: 499000,
    desc: 'Áo len dệt kim cổ lọ ấm áp cho mùa thu đông, sợi mềm không gây ngứa cổ, giữ nhiệt vượt trội khi mặc kèm blazer.',
    mat: '20% Cashmere, 80% Wool len cao cấp',
    care: 'Giặt tay với dầu gội hoặc nước giặt nhẹ, phơi phẳng ngang.',
    colors: [
      { name: 'Đen than', code: '#1A1C19' },
      { name: 'Nâu Caramel', code: '#7A5C43' },
      { name: 'Trắng kem sữa', code: '#F5F2EB' },
    ],
    sizes: ['M', 'L', 'XL'],
    stocks: [8, 16, 10],
    images: ['/seed-images/ao-len-nam-co-lo-vai-cashmere-pha-am-ap.jpg'],
    attrs: { style: 'vintage', pattern: 'tron', fit: 'regular', occasion: 'mua-dong', sleeve: 'dai-tay' },
  },
  {
    name: 'Thắt Lưng Da Bò Nam Mặt Khóa Kim Loại Nguyên Khối',
    cat: 'phu-kien-thoi-trang',
    gender: 'men',
    price: 279000,
    desc: 'Dây nịt da bò sáp nhập khẩu dày 3.8mm bền bỉ theo năm tháng, mặt khóa hợp kim mờ chống xước tinh xảo.',
    mat: 'Da bò thật 100% Top Grain',
    care: 'Bảo quản nơi khô ráo, tránh tiếp xúc nước lâu.',
    colors: [
      { name: 'Nâu da bò cổ điển', code: '#7A5C43' },
      { name: 'Đen nhung', code: '#1A1C19' },
    ],
    sizes: ['Free Size'],
    stocks: [45],
    images: ['/seed-images/that-lung-da-bo-nam-mat-khoa-kim-loai-nguyen-khoi.jpg'],
    attrs: { style: 'cong-so', pattern: 'tron', fit: 'tieu-chuan', occasion: 'hang-ngay' },
  },

  // --- 11 SẢN PHẨM NỮ (women) ---
  {
    name: 'Đầm Midi Nữ Cổ Vuông Xẻ Tà Dáng Chữ A Tinh Khôi',
    cat: 'vay-dam',
    gender: 'women',
    price: 489000,
    desc: 'Thiết kế đầm cổ vuông tôn xương quai xanh quyến rũ, eo may chun co giãn tôn vòng 2 thon gọn, xẻ tà bên bay bổng khi bước đi.',
    mat: 'Vải Linen Tencel thân thiện môi trường',
    care: 'Giặt nhẹ tay, phơi trong bóng mát.',
    colors: [
      { name: 'Trắng kem ngà', code: '#FAF8F5' },
      { name: 'Vàng bơ nhạt', code: '#FFFDD0' },
      { name: 'Xanh xô thơm', code: '#9CAF88' },
    ],
    sizes: ['XS', 'S', 'M', 'L'],
    stocks: [10, 18, 15, 3],
    images: ['/seed-images/placeholder-vay-dam.svg'],
    attrs: { style: 'nu-tinh', pattern: 'tron', fit: 'dang-a', occasion: 'hen-ho', sleeve: 'ngan-tay' },
  },
  {
    name: 'Váy Hoa Nhí Vintage Nữ Cổ V Thắt Nơ Eo',
    cat: 'vay-dam',
    gender: 'women',
    price: 429000,
    desc: 'Váy hoa nhí phong cách lãng mạn nước Pháp, cổ V thanh thoát, hàng cúc bọc vải cùng màu thủ công tỉ mỉ.',
    mat: 'Chiffon tơ lụa có lớp lót kín đáo',
    care: 'Giặt trong túi giặt hoặc giặt tay.',
    colors: [
      { name: 'Hoa nền be', code: '#E6D7C3' },
      { name: 'Hoa nền xanh rêu', code: '#4B6B56' },
    ],
    sizes: ['S', 'M', 'L'],
    stocks: [14, 20, 11],
    images: ['/seed-images/placeholder-vay-dam.svg'],
    attrs: { style: 'vintage', pattern: 'hoa-nhi', fit: 'xoe', occasion: 'du-lich', sleeve: 'tay-lo' },
  },
  {
    name: 'Áo Sơ Mi Lụa Satin Nữ Cổ Nơ Điệu Đà Công Sở',
    cat: 'ao-so-mi',
    gender: 'women',
    price: 369000,
    desc: 'Sơ mi lụa mềm mướt ánh satin nhẹ nhàng, chi tiết nơ cổ sang trọng có thể thắt rủ hoặc thả tự nhiên.',
    mat: 'Lụa Satin nhân tạo chống nhăn',
    care: 'Ủi hơi nước mặt trái ở nhiệt độ thấp.',
    colors: [
      { name: 'Trắng ánh ngọc trai', code: '#F0EAE1' },
      { name: 'Xanh rêu olive bóng', code: '#3A5A40' },
      { name: 'Hồng phấn pastel', code: '#E8C5C8' },
    ],
    sizes: ['S', 'M', 'L', 'XL'],
    stocks: [12, 22, 19, 4],
    images: ['/seed-images/placeholder-ao-so-mi.svg'],
    attrs: { style: 'cong-so', pattern: 'tron', fit: 'regular', occasion: 'di-lam', sleeve: 'dai-tay' },
  },
  {
    name: 'Quần Jean Nữ Ống Loe Lưng Siêu Cao Hack Dáng',
    cat: 'quan-jean-denim',
    gender: 'women',
    price: 499000,
    desc: 'Phom quần jean ống loe nhẹ từ đầu gối, cạp cao ôm trọn vòng eo giúp đôi chân trông dài miên man.',
    mat: 'Cotton Denim co giãn 4 chiều',
    care: 'Lộn trái khi giặt, tránh sấy nóng.',
    colors: [
      { name: 'Xanh Retro Wash', code: '#3B5998' },
      { name: 'Đen tuyền', code: '#1A1C19' },
    ],
    sizes: ['28', '29', '30', '31', '32'],
    stocks: [8, 16, 25, 12, 0],
    images: ['/seed-images/quan-jean-nu-ong-loe-lung-sieu-cao-hack-dang.jpg'],
    attrs: { style: 'retro', pattern: 'wash', fit: 'ong-loe', occasion: 'hang-ngay', length: 'dai' },
  },
  {
    name: 'Áo Blazer Nữ Phom Rộng Cropped Thanh Lịch',
    cat: 'ao-khoac-blazer',
    gender: 'women',
    price: 649000,
    desc: 'Áo blazer dáng ngắn cropped trẻ trung năng động, phối khuy kim loại nổi bật, dễ phối cùng chân váy cạp cao hoặc quần âu.',
    mat: 'Dạ ép mỏng cao cấp',
    care: 'Giặt khô hoặc giặt hấp chuyên dụng.',
    colors: [
      { name: 'Nâu be Tây', code: '#B8977E' },
      { name: 'Đen than', code: '#1A1C19' },
    ],
    sizes: ['S', 'M', 'L'],
    stocks: [6, 12, 8],
    images: ['/seed-images/ao-blazer-nu-phom-rong-cropped-thanh-lich.jpg'],
    attrs: { style: 'thoi-thuong', pattern: 'tron', fit: 'cropped', occasion: 'di-lam', sleeve: 'dai-tay' },
  },
  {
    name: 'Chân Váy Xếp Ly Dài Nữ Phom Xòe Vintage',
    cat: 'vay-dam',
    gender: 'women',
    price: 389000,
    desc: 'Chân váy dập ly nhỏ tinh xảo không mất nếp sau khi giặt, cạp chun thoải mái, độ rủ mềm mại nữ tính.',
    mat: 'Vải tuyết mưa dập ly nhiệt bền màu',
    care: 'Treo móc thẳng đứng để giữ nếp dập ly.',
    colors: [
      { name: 'Be sữa', code: '#E8DCC4' },
      { name: 'Nâu hạt dẻ', code: '#7A5C43' },
      { name: 'Đen huyền bí', code: '#1E1E1E' },
    ],
    sizes: ['S', 'M', 'L'],
    stocks: [15, 24, 18],
    images: ['/seed-images/placeholder-vay-dam.svg'],
    attrs: { style: 'vintage', pattern: 'xep-ly', fit: 'xoe', occasion: 'di-choi', length: 'dai' },
  },
  {
    name: 'Áo Thun Nữ Baby Tee Ôm Nhẹ Họa Tiết Thêu Nhỏ',
    cat: 'ao-thun',
    gender: 'women',
    price: 189000,
    desc: 'Áo thun ôm vừa người phong cách Y2K trẻ trung, chất cotton 100% thấm hút tốt, chi tiết thêu chữ Baity tinh tế giữa ngực.',
    mat: '100% Cotton Compact 2 chiều',
    care: 'Giặt máy nhẹ, ủi mặt trái hình thêu.',
    colors: [
      { name: 'Trắng kem', code: '#FAF8F5' },
      { name: 'Hồng đỗ pastel', code: '#D9A5B3' },
      { name: 'Xanh rêu nhạt', code: '#738678' },
    ],
    sizes: ['XS', 'S', 'M', 'L'],
    stocks: [18, 30, 25, 6],
    images: ['/seed-images/placeholder-ao-thun.svg'],
    attrs: { style: 'y2k', pattern: 'theu-nho', fit: 'om-body', occasion: 'hang-ngay', sleeve: 'ngan-tay' },
  },
  {
    name: 'Quần Tây Nữ Cạp Cao Ống Rộng Hack Chân',
    cat: 'quan-tay-kaki',
    gender: 'women',
    price: 419000,
    desc: 'Quần ống rộng lưng cao chuẩn phong cách Parisian Chic, chi tiết móc cài chìm giấu khóa tinh xảo.',
    mat: 'Chất vải Ruby cao cấp dày dặn rũ tự nhiên',
    care: 'Giặt máy chế độ êm, ủi nhẹ bằng bàn là hơi.',
    colors: [
      { name: 'Trắng kem', code: '#F5F2EB' },
      { name: 'Nâu sẫm Mocha', code: '#4E3629' },
      { name: 'Xanh Navy trầm', code: '#1B263B' },
    ],
    sizes: ['28', '29', '30', '31'],
    stocks: [11, 20, 22, 5],
    images: ['/seed-images/placeholder-quan-tay-kaki.svg'],
    attrs: { style: 'cong-so', pattern: 'tron', fit: 'ong-rong', occasion: 'di-lam', length: 'dai' },
  },
  {
    name: 'Áo Cardigan Nữ Dệt Kim Cúc Gỗ Mùa Thu',
    cat: 'ao-len-hoodie',
    gender: 'women',
    price: 379000,
    desc: 'Cardigan len dệt xốp nhẹ nhàng, đính hàng khuy gỗ tự nhiên mộc mạc, phù hợp khoác ngoài váy đầm hay áo 2 dây.',
    mat: 'Len lông thỏ nhân tạo siêu mềm',
    care: 'Giặt tay nhẹ nhàng, tránh vắt mạnh.',
    colors: [
      { name: 'Be bơ sữa', code: '#F5EBE0' },
      { name: 'Xanh ngọc bích nhạt', code: '#A3B899' },
      { name: 'Nâu quế', code: '#8B5A2B' },
    ],
    sizes: ['S', 'M', 'L'],
    stocks: [14, 25, 16],
    images: ['/seed-images/ao-cardigan-nu-det-kim-cuc-go-mua-thu.jpg'],
    attrs: { style: 'vintage', pattern: 'tron', fit: 'regular', occasion: 'hang-ngay', sleeve: 'dai-tay' },
  },
  {
    name: 'Túi Xách Nữ Tote Canvas Quai Da Phối Đựng Laptop',
    cat: 'phu-kien-thoi-trang',
    gender: 'women',
    price: 299000,
    desc: 'Túi tote vải bố canvas tự nhiên dệt dày, quai đeo bọc da bò êm vai, ngăn chứa rộng đựng vừa laptop 14 inch.',
    mat: 'Canvas 14oz mộc kết hợp da PU cao cấp',
    care: 'Lau khăn ẩm, không giặt ngâm tẩy.',
    colors: [
      { name: 'Màu be mộc tự nhiên', code: '#EDE6D6' },
      { name: 'Xanh rêu olive phối nâu', code: '#2D4A3E' },
    ],
    sizes: ['Free Size'],
    stocks: [35],
    images: ['/seed-images/tui-xach-nu-tote-canvas-quai-da-phoi-dung-laptop.jpg'],
    attrs: { style: 'minimalist', pattern: 'tron', fit: 'tieu-chuan', occasion: 'hang-ngay' },
  },
  {
    name: 'Quần Short Nữ Lưng Thun Ống Rộng Vải Linen',
    cat: 'quan-short',
    gender: 'women',
    price: 229000,
    desc: 'Quần đùi nữ lưng thun bản to ôm êm bụng, túi sâu hai bên, chất vải linen mát rượi cho ngày hè oi bức.',
    mat: '100% Linen tự nhiên wash mềm',
    care: 'Giặt máy chế độ nhẹ, tránh vắt khô kiệt.',
    colors: [
      { name: 'Trắng kem', code: '#FAF8F5' },
      { name: 'Nâu be đất', code: '#9E7E67' },
      { name: 'Xanh rêu nhạt', code: '#5C7461' },
    ],
    sizes: ['S', 'M', 'L'],
    stocks: [16, 24, 18],
    images: ['/seed-images/placeholder-quan-short.svg'],
    attrs: { style: 'casual', pattern: 'tron', fit: 'ong-rong', occasion: 'o-nha', length: 'ngan' },
  },

  // --- 8 SẢN PHẨM UNISEX (unisex) ---
  {
    name: 'Áo Hoodie Unisex Nỉ Chân Cua Thêu Hình Nhỏ Tối Giản',
    cat: 'ao-len-hoodie',
    gender: 'unisex',
    price: 449000,
    desc: 'Áo hoodie phom rộng phong cách đường phố, mũ 2 lớp đứng phom, chi tiết thêu hình nhỏ tối giản tinh tế trước ngực, chất nỉ bông chân cua dày dặn giữ ấm hoàn hảo cho cả bạn nam và nữ.',
    mat: '100% Cotton nỉ chân cua cao cấp',
    care: 'Giặt mặt trái, phơi khô tự nhiên.',
    colors: [
      { name: 'Xanh rêu olive', code: '#2D4A3E' },
      { name: 'Xám khói Heather', code: '#9E9E9E' },
      { name: 'Đen than chì', code: '#1A1C19' },
    ],
    sizes: ['S', 'M', 'L', 'XL'],
    stocks: [22, 38, 45, 16],
    images: ['/seed-images/placeholder-ao-len-hoodie.svg'],
    attrs: { style: 'streetwear', pattern: 'theu-nho', fit: 'oversized', occasion: 'hang-ngay', sleeve: 'dai-tay' },
  },
  {
    name: 'Áo Thun Unisex Oversized Graphic Minimalist',
    cat: 'ao-thun',
    gender: 'unisex',
    price: 239000,
    desc: 'Áo phông dáng thụng unisex, vai thả phóng khoáng, hình in lụa nghệ thuật phong cách tối giản không bong tróc.',
    mat: '100% Cotton 250gsm dệt sợi dẻo',
    care: 'Ủi mặt trái hình in, không giặt nước nóng trên 40 độ.',
    colors: [
      { name: 'Trắng cát Sand', code: '#F5F2EB' },
      { name: 'Đen mờ Matte Black', code: '#18181B' },
      { name: 'Nâu cà phê ấm', code: '#7A5C43' },
    ],
    sizes: ['S', 'M', 'L', 'XL'],
    stocks: [30, 45, 50, 20],
    images: ['/seed-images/ao-thun-unisex-oversized-graphic-minimalist.jpg'],
    attrs: { style: 'streetwear', pattern: 'graphic', fit: 'oversized', occasion: 'hang-ngay', sleeve: 'ngan-tay' },
  },
  {
    name: 'Quần Kaki Unisex Ống Suông Cargo Nhiều Túi',
    cat: 'quan-tay-kaki',
    gender: 'unisex',
    price: 469000,
    desc: 'Quần túi hộp cargo dáng suông rộng thời thượng, cạp chun có đỉa gài thắt lưng, túi hộp nổi hai bên đùi cực chất.',
    mat: 'Kaki Cotton Twill bền chắc',
    care: 'Giặt máy bình thường, ủi nhiệt độ vừa.',
    colors: [
      { name: 'Xanh rêu quân đội', code: '#334834' },
      { name: 'Xám ghi kim loại', code: '#5C636E' },
      { name: 'Đen than', code: '#1A1C19' },
    ],
    sizes: ['S', 'M', 'L', 'XL'],
    stocks: [15, 26, 30, 8],
    images: ['/seed-images/placeholder-quan-tay-kaki.svg'],
    attrs: { style: 'streetwear', pattern: 'cargo-tui-hop', fit: 'ong-suong', occasion: 'dao-pho', length: 'dai' },
  },
  {
    name: 'Áo Khoác Gió Unisex Windbreaker Phối Màu Vintage',
    cat: 'ao-khoac-blazer',
    gender: 'unisex',
    price: 499000,
    desc: 'Áo khoác gió phong cách retro thập niên 90s, phối mảng màu tinh tế, có mũ giấu trong cổ áo tiện dụng.',
    mat: 'Polyester dệt trượt nước 2 lớp',
    care: 'Giũ nước sau khi đi mưa, không là ủi nhiệt cao.',
    colors: [
      { name: 'Phối Xanh rêu & Trắng be', code: '#2D4A3E' },
      { name: 'Phối Đen than & Xám chì', code: '#2B2B2B' },
    ],
    sizes: ['S', 'M', 'L', 'XL'],
    stocks: [12, 24, 20, 5],
    images: ['/seed-images/placeholder-ao-khoac-blazer.svg'],
    attrs: { style: 'retro', pattern: 'color-block', fit: 'regular', occasion: 'du-lich', sleeve: 'dai-tay' },
  },
  {
    name: 'Quần Short Nỉ Unisex Thể Thao Dáng Thoải Mái',
    cat: 'quan-short',
    gender: 'unisex',
    price: 219000,
    desc: 'Quần đùi nỉ thể thao năng động, dây rút dệt cotton thắt nơ chắc chắn, phù hợp mặc tập gym, chạy bộ hoặc mặc nhà.',
    mat: 'Cotton nỉ da cá co giãn',
    care: 'Giặt máy thoải mái, phơi khô ráo.',
    colors: [
      { name: 'Xám tiêu Melange', code: '#B0B0B0' },
      { name: 'Đen than', code: '#1A1C19' },
      { name: 'Xanh rêu Baity', code: '#2D4A3E' },
    ],
    sizes: ['S', 'M', 'L', 'XL'],
    stocks: [20, 35, 30, 14],
    images: ['/seed-images/placeholder-quan-short.svg'],
    attrs: { style: 'the-thao', pattern: 'tron', fit: 'regular', occasion: 'o-nha', length: 'ngan' },
  },
  {
    name: 'Áo Sơ Mi Unisex Phom Rộng Kẻ Caro Flannel Ấm Áp',
    cat: 'ao-so-mi',
    gender: 'unisex',
    price: 379000,
    desc: 'Sơ mi dạ kẻ caro flannel dệt dày dặn, có thể mặc đơn hoặc khoác ngoài áo thun phong cách Grunge bụi bặm.',
    mat: '100% Cotton Flannel cào lông bề mặt',
    care: 'Giặt nước lạnh, tránh thuốc tẩy mạnh.',
    colors: [
      { name: 'Kẻ caro Rêu & Đen', code: '#2D4A3E' },
      { name: 'Kẻ caro Nâu & Trắng be', code: '#8B5A2B' },
    ],
    sizes: ['S', 'M', 'L', 'XL'],
    stocks: [14, 28, 22, 6],
    images: ['/seed-images/placeholder-ao-so-mi.svg'],
    attrs: { style: 'grunge', pattern: 'caro', fit: 'oversized', occasion: 'dao-pho', sleeve: 'dai-tay' },
  },
  {
    name: 'Quần Jean Unisex Ống Suông Rộng Rãi Baggy Denim',
    cat: 'quan-jean-denim',
    gender: 'unisex',
    price: 489000,
    desc: 'Quần bò baggy thụng rộng thoải mái cho cả nam lẫn nữ, chất vải dày dặn đứng form chuẩn streetwear skate.',
    mat: '100% Bông Cotton thô',
    care: 'Giặt máy nhẹ, tránh vắt quá khô.',
    colors: [
      { name: 'Xanh nhạt Bleached Wash', code: '#87CEEB' },
      { name: 'Xanh mực Raw Indigo', code: '#1A2A40' },
    ],
    sizes: ['28', '29', '30', '31', '32', '34'],
    stocks: [8, 16, 22, 18, 10, 0],
    images: ['/seed-images/quan-jean-unisex-ong-suong-rong-rai-baggy-denim.jpg'],
    attrs: { style: 'streetwear', pattern: 'wash', fit: 'baggy', occasion: 'hang-ngay', length: 'dai' },
  },
  {
    name: 'Tất Vớ Unisex Cổ Cao Dệt Gân Cotton Kháng Khuẩn (Set 3 đôi)',
    cat: 'phu-kien-thoi-trang',
    gender: 'unisex',
    price: 119000,
    desc: 'Set 3 đôi tất cotton dệt sợi bạc khử mùi kháng khuẩn, cổ cao co giãn êm ái không hằn bắp chân.',
    mat: '85% Combed Cotton, 12% Spandex, 3% Bạc ion',
    care: 'Giặt máy bình thường.',
    colors: [
      { name: 'Bộ 3 màu Trắng - Be - Đen', code: '#E5E5E5' },
    ],
    sizes: ['Free Size'],
    stocks: [80],
    images: ['/seed-images/tat-vo-unisex-co-cao-det-gan-cotton-khang-khuan-set-3-doi.jpg'],
    attrs: { style: 'basic', pattern: 'tron', fit: 'tieu-chuan', occasion: 'hang-ngay' },
  },
];

