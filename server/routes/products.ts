import { Router } from 'express';
import { z } from 'zod';
import { sql, type SQL } from 'drizzle-orm';
import { queryRows } from '../db/index.ts';
import {
  calculateEffectivePrice,
  sqlEffectivePriceFormula,
  sqlProductPricingCte,
  recommendProductSize,
  type PromotionInfo,
} from '../services/pricing.ts';
import {
  prepareSearchQuery,
  checkSuggestRateLimit,
  normalizeVietnameseText,
} from '../services/search.ts';
import { optionalAuth, type AuthRequest } from '../services/auth.ts';
import {
  maskReviewerName,
  getProductReviewsData,
  normalizeReviewSort,
  sendReviewRouteError,
} from './reviews.ts';

export const productsRouter = Router();

// ==========================================
// ZOD VALIDATION SCHEMAS
// ==========================================
const ALLOWED_SORTS = ['newest', 'bestseller', 'price_asc', 'price_desc', 'rating', 'relevance'] as const;

const listProductsQuerySchema = z
  .object({
    q: z.string().max(200, 'Từ khóa tìm kiếm tối đa 200 ký tự').optional(),
    gender: z
      .enum(['men', 'women', 'unisex', 'all', ''], {
        message: 'Giới tính (gender) chỉ chấp nhận: men, women, unisex, all',
      })
      .optional(),
    includeUnisex: z
      .enum(['true', 'false', '1', '0', ''], {
        message: 'includeUnisex chỉ chấp nhận true hoặc false',
      })
      .optional(),
    category: z.string().max(120).optional(),
    minPrice: z
      .string()
      .optional()
      .refine((v) => v === undefined || v === '' || (/^\d+$/.test(v) && Number(v) >= 0), {
        message: 'minPrice phải là số nguyên không âm',
      })
      .transform((v) => (v === undefined || v === '' ? undefined : Number(v))),
    maxPrice: z
      .string()
      .optional()
      .refine((v) => v === undefined || v === '' || (/^\d+$/.test(v) && Number(v) >= 0), {
        message: 'maxPrice phải là số nguyên không âm',
      })
      .transform((v) => (v === undefined || v === '' ? undefined : Number(v))),
    size: z.string().max(100).optional(),
    color: z.string().max(100).optional(),
    onSale: z
      .enum(['true', 'false', '1', '0', ''], {
        message: 'onSale chỉ chấp nhận true hoặc false',
      })
      .optional(),
    inStock: z
      .enum(['true', 'false', '1', '0', ''], {
        message: 'inStock chỉ chấp nhận true hoặc false',
      })
      .optional(),
    minRating: z
      .string()
      .optional()
      .refine(
        (v) =>
          v === undefined ||
          v === '' ||
          (!Number.isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 5),
        { message: 'minRating phải là số từ 0 đến 5' }
      )
      .transform((v) => (v === undefined || v === '' ? undefined : Number(v))),
    sort: z
      .enum(ALLOWED_SORTS, {
        message: `sort chỉ nhận một trong các giá trị: ${ALLOWED_SORTS.join(', ')}`,
      })
      .optional(),
    page: z
      .string()
      .optional()
      .default('1')
      .refine((v) => /^\d+$/.test(v) && Number(v) >= 1, {
        message: 'page phải là số nguyên dương (>= 1)',
      })
      .transform((v) => Number(v)),
    pageSize: z
      .string()
      .optional()
      .default('12')
      .refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 24, {
        message: 'pageSize phải từ 1 đến tối đa 24',
      })
      .transform((v) => Number(v)),
  })
  .refine(
    (data) =>
      data.minPrice === undefined ||
      data.maxPrice === undefined ||
      data.maxPrice >= data.minPrice,
    {
      message: 'maxPrice phải lớn hơn hoặc bằng minPrice',
      path: ['maxPrice'],
    }
  );

const suggestQuerySchema = z.object({
  q: z.string().max(200, 'Từ khóa tối đa 200 ký tự').optional().default(''),
});

// ==========================================
// 1. GET /api/products/featured (Sản phẩm nổi bật trang chủ)
// ==========================================
productsRouter.get('/featured', async (req, res) => {
  try {
    const gender = req.query.gender as string;
    const genderClause =
      gender && ['men', 'women'].includes(gender)
        ? sql`AND p.target_gender IN (${gender}, 'unisex')`
        : gender === 'unisex'
        ? sql`AND p.target_gender = 'unisex'`
        : sql``;

    const rows = await queryRows(sql`
      WITH ${sqlProductPricingCte()}
      SELECT
        p.id, p.name, p.slug, p.target_gender, p.base_price,
        pp.initial_price,
        pp.discount_percent,
        pp.promotion_title,
        pp.effective_price,
        pp.is_on_sale,
        pp.total_stock,
        pp.rating_avg,
        pp.review_count,
        c.name AS category_name,
        c.slug AS category_slug,
        (
          SELECT image_url FROM product_images
          WHERE product_id = p.id
          ORDER BY is_primary DESC, display_order ASC
          LIMIT 1
        ) AS primary_image,
        COALESCE((
          SELECT json_agg(json_build_object('color_name', color_name, 'color_code', color_code))
          FROM (
            SELECT DISTINCT color_name, color_code
            FROM product_variants
            WHERE product_id = p.id
          ) colors
        ), '[]'::json) AS colors
      FROM products p
      JOIN categories c ON p.category_id = c.id
      JOIN product_pricing pp ON pp.product_id = p.id
      WHERE p.is_active = true ${genderClause}
      ORDER BY
        CASE WHEN c.slug = 'phu-kien-thoi-trang' THEN 1 ELSE 0 END ASC,
        pp.discount_percent DESC,
        p.created_at DESC,
        p.id ASC
      LIMIT 12;
    `);

    res.json({ success: true, data: rows, items: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 2. GET /api/products/suggest?q= (Gợi ý tìm kiếm nhanh tối đa 8 kết quả, có Rate Limit)
// ==========================================
productsRouter.get('/suggest', async (req, res) => {
  try {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const rateStatus = checkSuggestRateLimit(clientIp);
    if (!rateStatus.allowed) {
      return res.status(429).json({
        success: false,
        message: `Bạn thao tác tìm kiếm quá nhanh. Vui lòng thử lại sau ${rateStatus.retryAfterSeconds} giây.`,
      });
    }

    const parsed = suggestQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message || 'Tham số truy vấn không hợp lệ',
      });
    }

    const rawQ = parsed.data.q.trim();
    if (!rawQ) {
      return res.json({ success: true, suggestions: [], data: [] });
    }

    const prepared = prepareSearchQuery(rawQ);
    if (!prepared.normalizedKeepWildcards && !prepared.rawTrimmed) {
      return res.json({ success: true, suggestions: [], data: [] });
    }

    const useTrgmOperator = !prepared.hasSpecialWildcards && prepared.cleanNormalized.length >= 3;

    const searchMatchConditions: SQL[] = [
      sql`p.search_text LIKE ${prepared.escapedNormLikePattern}`,
    ];
    if (useTrgmOperator) {
      searchMatchConditions.push(sql`p.search_text % ${prepared.cleanNormalized}`);
      searchMatchConditions.push(sql`word_similarity(${prepared.cleanNormalized}, REPLACE(p.slug, '-', ' ')) >= 0.7`);
    }

    const searchMatchSql = sql`(${sql.join(searchMatchConditions, sql` OR `)})`;

    const normSlugName = sql`REPLACE(p.slug, '-', ' ')`;
    const normCatSlug = sql`REPLACE(c.slug, '-', ' ')`;

    const rankExpr = sql`(
      CASE
        WHEN ${normSlugName} LIKE ${prepared.escapedNormLikePattern}
          OR p.name ILIKE ${prepared.escapedRawLikePattern}
        THEN 1000
        ELSE 0
      END
      + CASE
        WHEN p.description ILIKE ${prepared.escapedRawLikePattern}
          OR p.search_text LIKE ${prepared.escapedNormLikePattern}
        THEN 500
        ELSE 0
      END
      + CASE
        WHEN ${normCatSlug} LIKE ${prepared.escapedNormLikePattern}
          OR c.name ILIKE ${prepared.escapedRawLikePattern}
        THEN 300
        ELSE 0
      END
      + CASE
        WHEN EXISTS (
          SELECT 1 FROM product_attributes pa
          WHERE pa.product_id = p.id
            AND (pa.attr_value ILIKE ${prepared.escapedRawLikePattern} OR pa.attr_key ILIKE ${prepared.escapedRawLikePattern})
        )
        THEN 100
        ELSE 0
      END
      + (word_similarity(${prepared.cleanNormalized || prepared.rawTrimmed}, ${normSlugName}) * 200)
      + (word_similarity(${prepared.cleanNormalized || prepared.rawTrimmed}, p.search_text) * 50)
    )`;

    const rows = await queryRows(sql`
      WITH ${sqlProductPricingCte()}
      SELECT
        p.id,
        p.name,
        p.slug,
        p.target_gender,
        p.base_price,
        pp.effective_price,
        pp.discount_percent,
        pp.is_on_sale,
        c.name AS category_name,
        c.slug AS category_slug,
        (
          SELECT image_url FROM product_images
          WHERE product_id = p.id
          ORDER BY is_primary DESC, display_order ASC
          LIMIT 1
        ) AS primary_image,
        ${rankExpr} AS search_rank
      FROM products p
      JOIN categories c ON p.category_id = c.id
      JOIN product_pricing pp ON pp.product_id = p.id
      WHERE COALESCE(p.is_active, false) = true
        AND ${searchMatchSql}
      ORDER BY search_rank DESC, pp.discount_percent DESC, p.id ASC
      LIMIT 8;
    `);

    res.json({ success: true, suggestions: rows, data: rows });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 3. GET /api/products/facets (Lấy thông tin bộ lọc khả dụng: màu sắc, kích cỡ, khoảng giá)
// ==========================================
productsRouter.get('/facets', async (_req, res) => {
  try {
    const [colors, sizes, priceRange] = await Promise.all([
      queryRows<{ color_name: string; color_code: string }>(sql`
        SELECT DISTINCT ON (LOWER(pv.color_name))
          pv.color_name,
          pv.color_code
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        WHERE p.is_active = true
        ORDER BY LOWER(pv.color_name) ASC;
      `),
      queryRows<{ size: string }>(sql`
        SELECT DISTINCT pv.size
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        WHERE p.is_active = true;
      `),
      queryRows<{ min_price: number; max_price: number }>(sql`
        WITH ${sqlProductPricingCte()}
        SELECT
          COALESCE(MIN(pp.effective_price), 0)::int AS min_price,
          COALESCE(MAX(pp.effective_price), 2000000)::int AS max_price
        FROM products p
        JOIN product_pricing pp ON pp.product_id = p.id
        WHERE p.is_active = true;
      `),
    ]);

    const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '28', '29', '30', '31', '32', '33', '34', 'Free Size'];
    const sortedSizes = sizes
      .map((s) => s.size)
      .sort((a, b) => {
        const ia = sizeOrder.indexOf(a);
        const ib = sizeOrder.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });

    res.json({
      success: true,
      data: {
        colors,
        sizes: sortedSizes,
        minPrice: priceRange[0]?.min_price ?? 0,
        maxPrice: priceRange[0]?.max_price ?? 2000000,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 4. GET /api/products (Danh sách sản phẩm: tìm kiếm, lọc, sắp xếp, phân trang chuẩn)
// ==========================================
productsRouter.get('/', async (req, res) => {
  try {
    const parsed = listProductsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message || 'Tham số bộ lọc không hợp lệ',
        errors: parsed.error.issues,
      });
    }

    const {
      q,
      gender,
      includeUnisex,
      category,
      minPrice,
      maxPrice,
      size,
      color,
      onSale,
      inStock,
      minRating,
      sort,
      page,
      pageSize,
    } = parsed.data;

    const conditions: SQL[] = [sql`p.is_active = true`];

    // 1. Lọc theo đối tượng (gender): Chọn Nam hoặc Nữ mặc định vẫn hiển thị Unisex (có tùy chọn tắt qua includeUnisex=false)
    const shouldIncludeUnisex = includeUnisex !== 'false' && includeUnisex !== '0';
    if (gender && gender !== 'all') {
      if (gender === 'men' || gender === 'women') {
        if (shouldIncludeUnisex) {
          conditions.push(sql`p.target_gender IN (${gender}, 'unisex')`);
        } else {
          conditions.push(sql`p.target_gender = ${gender}`);
        }
      } else if (gender === 'unisex') {
        conditions.push(sql`p.target_gender = 'unisex'`);
      }
    }

    // 2. Lọc theo danh mục (slug hoặc id)
    if (category && category.trim() !== '' && category !== 'all') {
      const catList = category
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (catList.length === 1) {
        const singleCat = catList[0];
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(singleCat);
        if (isUuid) {
          conditions.push(sql`(c.id = ${singleCat}::uuid OR c.slug = ${singleCat})`);
        } else {
          conditions.push(sql`c.slug = ${singleCat}`);
        }
      } else if (catList.length > 1) {
        conditions.push(sql`c.slug IN (${sql.join(catList.map((cSlug) => sql`${cSlug}`), sql`, `)})`);
      }
    }

    // 3. Lọc theo khoảng giá hiệu lực (effective_price)
    if (minPrice !== undefined) {
      conditions.push(sql`pp.effective_price >= ${minPrice}`);
    }
    if (maxPrice !== undefined) {
      conditions.push(sql`pp.effective_price <= ${maxPrice}`);
    }

    // 4. Lọc theo trạng thái đang giảm giá (onSale)
    if (onSale === 'true' || onSale === '1') {
      conditions.push(sql`pp.is_on_sale = true`);
    } else if (onSale === 'false' || onSale === '0') {
      conditions.push(sql`pp.is_on_sale = false`);
    }

    // 5. Lọc theo trạng thái còn hàng (inStock)
    const requireInStock = inStock === 'true' || inStock === '1';
    if (requireInStock) {
      conditions.push(sql`pp.total_stock > 0`);
    } else if (inStock === 'false' || inStock === '0') {
      conditions.push(sql`pp.total_stock = 0`);
    }

    // 6. Lọc theo kích cỡ (size)
    if (size && size.trim() !== '') {
      const sizes = size
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (sizes.length > 0) {
        const sizeSqlList = sql.join(sizes.map((s) => sql` LOWER(${s}) `), sql`, `);
        if (requireInStock) {
          conditions.push(sql`
            EXISTS (
              SELECT 1 FROM product_variants pv_s
              WHERE pv_s.product_id = p.id
                AND LOWER(pv_s.size) IN (${sizeSqlList})
                AND pv_s.stock_quantity > 0
            )
          `);
        } else {
          conditions.push(sql`
            EXISTS (
              SELECT 1 FROM product_variants pv_s
              WHERE pv_s.product_id = p.id
                AND LOWER(pv_s.size) IN (${sizeSqlList})
            )
          `);
        }
      }
    }

    // 7. Lọc theo màu sắc (color)
    if (color && color.trim() !== '') {
      const rawColor = color.trim();
      const normColor = normalizeVietnameseText(rawColor);
      conditions.push(sql`
        EXISTS (
          SELECT 1 FROM product_variants pv_c
          WHERE pv_c.product_id = p.id
            AND (
              pv_c.color_name ILIKE ${'%' + rawColor + '%'}
              OR pv_c.color_code ILIKE ${rawColor}
              OR LOWER(pv_c.color_name) LIKE ${'%' + normColor + '%'}
            )
        )
      `);
    }

    // 8. Lọc theo điểm đánh giá tối thiểu (minRating)
    if (minRating !== undefined && minRating > 0) {
      conditions.push(sql`pp.rating_avg >= ${minRating}`);
    }

    // 9. Tìm kiếm từ khóa không dấu + pg_trgm + escape ký tự % _ \
    let searchRankExpr: SQL = sql`0`;
    const hasSearchQuery = Boolean(q && q.trim() !== '');

    if (hasSearchQuery && q) {
      const prepared = prepareSearchQuery(q);
      const useTrgmOperator = !prepared.hasSpecialWildcards && prepared.cleanNormalized.length >= 3;

      const searchConditions: SQL[] = [
        sql`p.search_text LIKE ${prepared.escapedNormLikePattern} ESCAPE '\\'`,
      ];
      if (useTrgmOperator) {
        searchConditions.push(sql`p.search_text % ${prepared.cleanNormalized}`);
        searchConditions.push(sql`word_similarity(${prepared.cleanNormalized}, REPLACE(p.slug, '-', ' ')) >= 0.7`);
      }

      conditions.push(sql`(${sql.join(searchConditions, sql` OR `)})`);

      const normSlugName = sql`REPLACE(p.slug, '-', ' ')`;
      const normCatSlug = sql`REPLACE(c.slug, '-', ' ')`;
      const simTarget = prepared.cleanNormalized || prepared.rawTrimmed;

      // Xếp hạng ưu tiên: Khớp tên sản phẩm trước (+1000), tiếp theo mô tả (+500), tiếp theo danh mục (+300), tiếp theo thuộc tính (+100) + độ tương đồng pg_trgm
      searchRankExpr = sql`(
        CASE
          WHEN ${normSlugName} LIKE ${prepared.escapedNormLikePattern} ESCAPE '\\'
            OR p.name ILIKE ${prepared.escapedRawLikePattern} ESCAPE '\\'
          THEN 1000
          ELSE 0
        END
        + CASE
          WHEN p.description ILIKE ${prepared.escapedRawLikePattern} ESCAPE '\\'
            OR p.search_text LIKE ${prepared.escapedNormLikePattern} ESCAPE '\\'
          THEN 500
          ELSE 0
        END
        + CASE
          WHEN ${normCatSlug} LIKE ${prepared.escapedNormLikePattern} ESCAPE '\\'
            OR c.name ILIKE ${prepared.escapedRawLikePattern} ESCAPE '\\'
          THEN 300
          ELSE 0
        END
        + CASE
          WHEN EXISTS (
            SELECT 1 FROM product_attributes pa
            WHERE pa.product_id = p.id
              AND (pa.attr_value ILIKE ${prepared.escapedRawLikePattern} ESCAPE '\\'
                   OR pa.attr_key ILIKE ${prepared.escapedRawLikePattern} ESCAPE '\\')
          )
          THEN 100
          ELSE 0
        END
        + (word_similarity(${simTarget}, ${normSlugName}) * 250)
        + (word_similarity(${simTarget}, p.search_text) * 50)
      )`;
    }

    const whereClause = sql.join(conditions, sql` AND `);

    // 10. Thứ tự sắp xếp (hỗ trợ sort=relevance, khi có q mà không truyền sort thì mặc định relevance; luôn kèm khóa phụ p.id ASC)
    const effectiveSort = sort || (hasSearchQuery ? 'relevance' : 'newest');
    let orderByClause: SQL;

    switch (effectiveSort) {
      case 'relevance':
        orderByClause = sql`search_rank DESC, p.created_at DESC, p.id ASC`;
        break;
      case 'price_asc':
        orderByClause = hasSearchQuery
          ? sql`pp.effective_price ASC, search_rank DESC, p.id ASC`
          : sql`pp.effective_price ASC, p.id ASC`;
        break;
      case 'price_desc':
        orderByClause = hasSearchQuery
          ? sql`pp.effective_price DESC, search_rank DESC, p.id ASC`
          : sql`pp.effective_price DESC, p.id ASC`;
        break;
      case 'bestseller':
        orderByClause = hasSearchQuery
          ? sql`pp.sold_count DESC, search_rank DESC, p.id ASC`
          : sql`pp.sold_count DESC, pp.rating_avg DESC, p.id ASC`;
        break;
      case 'rating':
        orderByClause = hasSearchQuery
          ? sql`pp.rating_avg DESC, pp.review_count DESC, search_rank DESC, p.id ASC`
          : sql`pp.rating_avg DESC, pp.review_count DESC, p.id ASC`;
        break;
      case 'newest':
      default:
        orderByClause = hasSearchQuery
          ? sql`search_rank DESC, p.created_at DESC, p.id ASC`
          : sql`p.created_at DESC, p.id ASC`;
        break;
    }

    const offset = (page - 1) * pageSize;

    // Thực thi đếm tổng và lấy danh sách trang hiện tại (Không N+1)
    const [countRows, itemRows] = await Promise.all([
      queryRows<{ total: number }>(sql`
        WITH ${sqlProductPricingCte()}
        SELECT COUNT(*)::int AS total
        FROM products p
        JOIN categories c ON p.category_id = c.id
        JOIN product_pricing pp ON pp.product_id = p.id
        WHERE ${whereClause};
      `),
      queryRows(sql`
        WITH ${sqlProductPricingCte()}
        SELECT
          p.id,
          p.name,
          p.slug,
          p.target_gender,
          p.base_price,
          p.material,
          p.created_at,
          pp.initial_price,
          pp.max_initial_price,
          pp.discount_percent,
          pp.promotion_title,
          pp.effective_price,
          pp.max_effective_price,
          pp.is_on_sale,
          pp.total_stock,
          pp.rating_avg,
          pp.review_count,
          pp.sold_count,
          c.id AS category_id,
          c.name AS category_name,
          c.slug AS category_slug,
          (
            SELECT image_url FROM product_images
            WHERE product_id = p.id
            ORDER BY is_primary DESC, display_order ASC
            LIMIT 1
          ) AS primary_image,
          COALESCE((
            SELECT json_agg(json_build_object('color_name', color_name, 'color_code', color_code))
            FROM (
              SELECT DISTINCT color_name, color_code
              FROM product_variants
              WHERE product_id = p.id
              ORDER BY color_name ASC
            ) colors
          ), '[]'::json) AS colors,
          COALESCE((
            SELECT json_agg(size)
            FROM (
              SELECT DISTINCT size
              FROM product_variants
              WHERE product_id = p.id
            ) s
          ), '[]'::json) AS sizes,
          ${searchRankExpr} AS search_rank
        FROM products p
        JOIN categories c ON p.category_id = c.id
        JOIN product_pricing pp ON pp.product_id = p.id
        WHERE ${whereClause}
        ORDER BY ${orderByClause}
        LIMIT ${pageSize}
        OFFSET ${offset};
      `),
    ]);

    const total = countRows[0]?.total ?? 0;
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

    res.json({
      success: true,
      items: itemRows,
      data: itemRows,
      total,
      page,
      pageSize,
      totalPages,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: 'Lỗi truy vấn danh sách sản phẩm', error: err.message });
  }
});

// ==========================================
// 4.1 GET /api/products/:slug/reviews (Danh sách đánh giá của sản phẩm: phân trang, lọc theo sao, sắp xếp, điểm TB, phân bố sao, cờ Đã mua hàng, phản hồi người bán)
// ==========================================
productsRouter.get('/:slug/reviews', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const slug = (req.params.slug || '').trim();
    if (!slug) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PRODUCT_SLUG',
        message: 'Thiếu định danh sản phẩm (slug)',
      });
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
    const identifierWhere = isUuid
      ? sql`(p.slug = ${slug} OR p.id = ${slug}::uuid)`
      : sql`p.slug = ${slug}`;

    const prodRows = await queryRows<{ id: string; is_active: boolean }>(sql`
      SELECT p.id, p.is_active
      FROM products p
      WHERE ${identifierWhere}
      LIMIT 1;
    `);

    if (prodRows.length === 0 || !prodRows[0].is_active) {
      return res.status(404).json({
        success: false,
        code: 'PRODUCT_NOT_FOUND',
        message: 'Sản phẩm không tồn tại hoặc đã ngừng kinh doanh',
      });
    }

    const ratingParam =
      req.query.rating !== undefined && String(req.query.rating).trim() !== ''
        ? Number(req.query.rating)
        : undefined;
    if (
      ratingParam !== undefined &&
      (!Number.isInteger(ratingParam) || ratingParam < 1 || ratingParam > 5)
    ) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_RATING_FILTER',
        message: 'Bộ lọc số sao (rating) phải là số nguyên từ 1 đến 5',
      });
    }

    const normalizedSort = normalizeReviewSort(req.query.sort);
    if (!normalizedSort) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_SORT_OPTION',
        message:
          'Tham số sắp xếp (sort) chỉ chấp nhận: newest, rating_desc (hoặc highest), rating_asc (hoặc lowest)',
      });
    }

    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize || 10)));

    const data = await getProductReviewsData({
      productId: prodRows[0].id,
      userId: req.user?.id,
      ratingFilter: ratingParam,
      sort: normalizedSort,
      page,
      pageSize,
    });

    return res.json({
      success: true,
      ...data,
      data,
    });
  } catch (err: any) {
    return sendReviewRouteError(res, err, 'Lỗi tải danh sách đánh giá của sản phẩm');
  }
});

// ==========================================
// 5. GET /api/products/:slug (Chi tiết sản phẩm, biến thể, trạng thái tồn kho, bảng size, gợi ý size & sản phẩm liên quan)
// ==========================================
productsRouter.get('/:slug', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const slug = (req.params.slug || '').trim();
    if (!slug) {
      return res.status(400).json({ success: false, message: 'Thiếu định danh sản phẩm (slug)' });
    }

    // 1. Lấy thông tin sản phẩm + danh mục + ảnh + biến thể + thuộc tính + đánh giá trong 1 truy vấn (Không N+1)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
    const identifierWhere = isUuid
      ? sql`(p.slug = ${slug} OR p.id = ${slug}::uuid)`
      : sql`p.slug = ${slug}`;

    const productRows = await queryRows<any>(sql`
      SELECT
        p.id,
        p.name,
        p.slug,
        p.category_id,
        p.target_gender,
        p.description,
        p.material,
        p.care_instructions,
        p.base_price,
        p.is_active,
        p.created_at,
        c.name AS category_name,
        c.slug AS category_slug,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'id', pi.id,
              'imageUrl', pi.image_url,
              'isPrimary', pi.is_primary,
              'displayOrder', pi.display_order
            )
            ORDER BY pi.is_primary DESC, pi.display_order ASC
          )
          FROM product_images pi
          WHERE pi.product_id = p.id
        ), '[]'::json) AS images,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'id', pv.id,
              'sku', pv.sku,
              'colorName', pv.color_name,
              'colorCode', pv.color_code,
              'size', pv.size,
              'stockQuantity', pv.stock_quantity,
              'priceOverride', pv.price_override
            )
            ORDER BY pv.color_name ASC,
              CASE pv.size
                WHEN 'XS' THEN 1
                WHEN 'S' THEN 2
                WHEN 'M' THEN 3
                WHEN 'L' THEN 4
                WHEN 'XL' THEN 5
                WHEN 'XXL' THEN 6
                WHEN '28' THEN 7
                WHEN '29' THEN 8
                WHEN '30' THEN 9
                WHEN '31' THEN 10
                WHEN '32' THEN 11
                WHEN '33' THEN 12
                WHEN '34' THEN 13
                ELSE 20
              END ASC
          )
          FROM product_variants pv
          WHERE pv.product_id = p.id
        ), '[]'::json) AS variants,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'key', pa.attr_key,
              'value', pa.attr_value
            )
          )
          FROM product_attributes pa
          WHERE pa.product_id = p.id
        ), '[]'::json) AS attributes,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'id', pr.id,
              'title', pr.title,
              'discountPercent', pt.discount_percent,
              'startTime', pr.start_time,
              'endTime', pr.end_time
            )
            ORDER BY pt.discount_percent DESC
          )
          FROM promotion_targets pt
          JOIN promotions pr ON pr.id = pt.promotion_id
          WHERE pr.is_active = true
            AND NOW() BETWEEN pr.start_time AND pr.end_time
            AND (
              (pt.target_type = 'product' AND pt.target_id = p.id)
              OR (pt.target_type = 'category' AND pt.target_id = p.category_id)
            )
        ), '[]'::json) AS active_promotions,
        COALESCE((
          SELECT ROUND(AVG(rv.rating)::numeric, 1)::float
          FROM reviews rv
          WHERE rv.product_id = p.id
            AND rv.is_visible = true
        ), 0)::float AS rating_avg,
        COALESCE((
          SELECT COUNT(rv.id)::int
          FROM reviews rv
          WHERE rv.product_id = p.id
            AND rv.is_visible = true
        ), 0)::int AS review_count,
        COALESCE((
          SELECT json_agg(
            json_build_object(
              'id', rv.id,
              'orderId', rv.order_id,
              'rating', rv.rating,
              'comment', rv.comment,
              'sellerReply', rv.seller_reply,
              'sellerRepliedAt', rv.seller_replied_at,
              'createdAt', rv.created_at,
              'userName', u.full_name,
              'userAvatar', u.avatar_url,
              'images', COALESCE((
                SELECT json_agg(ri.image_url ORDER BY ri.id ASC)
                FROM review_images ri
                WHERE ri.review_id = rv.id
              ), '[]'::json)
            )
            ORDER BY rv.created_at DESC
          )
          FROM reviews rv
          JOIN users u ON u.id = rv.user_id
          WHERE rv.product_id = p.id
            AND rv.is_visible = true
        ), '[]'::json) AS reviews
      FROM products p
      JOIN categories c ON p.category_id = c.id
      WHERE ${identifierWhere}
      LIMIT 1;
    `);

    const product = productRows[0];
    // Sản phẩm không tồn tại hoặc bị ẩn (is_active = false) -> trả về 404
    if (!product || !product.is_active) {
      return res.status(404).json({
        success: false,
        message: 'Sản phẩm không tồn tại hoặc đã ngừng kinh doanh',
      });
    }

    // 2. Lấy bảng size chuẩn từ store_settings + sản phẩm liên quan (cùng danh mục hoặc cùng đối tượng, loại chính nó, còn hàng, tối đa 8)
    const [settingsRows, relatedProducts] = await Promise.all([
      queryRows<{ key: string; value: any }>(sql`
        SELECT key, value FROM store_settings WHERE key IN ('size_charts', 'general');
      `),
      queryRows(sql`
        WITH ${sqlProductPricingCte()}
        SELECT
          p.id,
          p.name,
          p.slug,
          p.target_gender,
          p.base_price,
          pp.initial_price,
          pp.discount_percent,
          pp.promotion_title,
          pp.effective_price,
          pp.is_on_sale,
          pp.total_stock,
          pp.rating_avg,
          pp.review_count,
          c.name AS category_name,
          c.slug AS category_slug,
          (
            SELECT image_url FROM product_images
            WHERE product_id = p.id
            ORDER BY is_primary DESC, display_order ASC
            LIMIT 1
          ) AS primary_image,
          COALESCE((
            SELECT json_agg(json_build_object('color_name', color_name, 'color_code', color_code))
            FROM (
              SELECT DISTINCT color_name, color_code
              FROM product_variants
              WHERE product_id = p.id
            ) colors
          ), '[]'::json) AS colors
        FROM products p
        JOIN categories c ON p.category_id = c.id
        JOIN product_pricing pp ON pp.product_id = p.id
        WHERE p.is_active = true
          AND p.id <> ${product.id}::uuid
          AND (p.category_id = ${product.category_id}::uuid OR p.target_gender = ${product.target_gender})
          AND pp.total_stock > 0
        ORDER BY
          CASE
            WHEN p.category_id = ${product.category_id}::uuid AND p.target_gender = ${product.target_gender} THEN 0
            WHEN p.category_id = ${product.category_id}::uuid THEN 1
            ELSE 2
          END ASC,
          pp.discount_percent DESC,
          p.id ASC
        LIMIT 8;
      `),
    ]);

    const sizeChartsSetting = settingsRows.find((r) => r.key === 'size_charts')?.value || {};
    const generalSetting = settingsRows.find((r) => r.key === 'general')?.value || {};
    const lowStockThreshold = Number(generalSetting.lowStockThreshold) || 5;

    const activePromotions: PromotionInfo[] = Array.isArray(product.active_promotions)
      ? product.active_promotions
      : [];

    // 3. Tính giá gốc, giá giảm (effectivePrice) và trạng thái tồn kho cho từng biến thể (dùng chung calculateEffectivePrice)
    const rawVariants: any[] = Array.isArray(product.variants) ? product.variants : [];
    const enrichedVariants = rawVariants.map((v) => {
      const priceCalc = calculateEffectivePrice(
        Number(product.base_price),
        v.priceOverride !== null && v.priceOverride !== undefined ? Number(v.priceOverride) : null,
        activePromotions
      );
      const stockQty = Number(v.stockQuantity) || 0;
      const stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock' =
        stockQty <= 0 ? 'out_of_stock' : stockQty <= lowStockThreshold ? 'low_stock' : 'in_stock';
      const stockLabel =
        stockStatus === 'out_of_stock'
          ? 'Hết hàng'
          : stockStatus === 'low_stock'
          ? `Sắp hết (còn ${stockQty})`
          : 'Còn hàng';

      return {
        id: v.id,
        sku: v.sku,
        colorName: v.colorName,
        colorCode: v.colorCode,
        size: v.size,
        stockQuantity: stockQty,
        stockStatus,
        stockLabel,
        isAvailable: stockQty > 0,
        priceOverride: v.priceOverride,
        basePrice: priceCalc.basePrice,
        initialPrice: priceCalc.initialPrice,
        effectivePrice: priceCalc.effectivePrice,
        discountPercent: priceCalc.discountPercent,
        isOnSale: priceCalc.isOnSale,
      };
    });

    // Tính giá hiệu lực cấp độ sản phẩm (từ biến thể có giá thấp nhất hoặc base_price)
    const productPriceCalc =
      enrichedVariants.length > 0
        ? enrichedVariants.reduce((minV, currV) =>
            currV.effectivePrice < minV.effectivePrice ? currV : minV
          )
        : calculateEffectivePrice(Number(product.base_price), null, activePromotions);

    const maxVariantEffectivePrice =
      enrichedVariants.length > 0
        ? Math.max(...enrichedVariants.map((v) => v.effectivePrice))
        : productPriceCalc.effectivePrice;

    const totalStock = enrichedVariants.reduce((acc, v) => acc + v.stockQuantity, 0);

    // 4. Bảng size theo đối tượng sản phẩm (và bảng size quần nếu thuộc danh mục quần)
    const availableSizes = Array.from(new Set(enrichedVariants.map((v) => v.size)));
    const usesPantsChart = availableSizes.some((s) =>
      ['28', '29', '30', '31', '32', '33', '34'].includes(s)
    );
    const primaryChartKey = usesPantsChart ? 'pants' : product.target_gender;
    const productSizeChart = {
      type: primaryChartKey,
      targetGender: product.target_gender,
      rows: sizeChartsSetting[primaryChartKey] || sizeChartsSetting[product.target_gender] || [],
      genderChart: sizeChartsSetting[product.target_gender] || [],
      pantsChart: usesPantsChart ? sizeChartsSetting.pants || [] : undefined,
      allCharts: sizeChartsSetting,
    };

    // 5. Gợi ý size tự động theo chiều cao & cân nặng: kiểm tra height (100-230) và weight (30-200), sai trả 400
    let queryHeight: number | null = null;
    let queryWeight: number | null = null;

    if (req.query.height !== undefined || req.query.weight !== undefined) {
      const rawHeight = req.query.height;
      const rawWeight = req.query.weight;

      if (rawHeight === undefined || rawHeight === '' || rawWeight === undefined || rawWeight === '') {
        return res.status(400).json({
          success: false,
          message: 'Gợi ý size yêu cầu cung cấp đầy đủ cả chiều cao (height) và cân nặng (weight)',
        });
      }

      const hNum = Number(rawHeight);
      const wNum = Number(rawWeight);

      if (Number.isNaN(hNum) || !Number.isFinite(hNum) || hNum < 100 || hNum > 230) {
        return res.status(400).json({
          success: false,
          message: 'Chiều cao (height) phải nằm trong khoảng từ 100cm đến 230cm',
        });
      }

      if (Number.isNaN(wNum) || !Number.isFinite(wNum) || wNum < 30 || wNum > 200) {
        return res.status(400).json({
          success: false,
          message: 'Cân nặng (weight) phải nằm trong khoảng từ 30kg đến 200kg',
        });
      }

      queryHeight = hNum;
      queryWeight = wNum;
    } else if (req.user?.heightCm && req.user?.weightKg) {
      queryHeight = req.user.heightCm;
      queryWeight = req.user.weightKg;
    }

    let sizeRecommendation = null;
    if (queryHeight && queryWeight) {
      sizeRecommendation = recommendProductSize({
        heightCm: queryHeight,
        weightKg: queryWeight,
        targetGender: product.target_gender,
        categorySlug: product.category_slug,
        availableSizes,
      });
    }

    // Tổng hợp danh sách màu sắc duy nhất
    const colorMap = new Map<string, { colorName: string; colorCode: string; hasStock: boolean }>();
    for (const v of enrichedVariants) {
      const existing = colorMap.get(v.colorName);
      if (!existing) {
        colorMap.set(v.colorName, {
          colorName: v.colorName,
          colorCode: v.colorCode,
          hasStock: v.stockQuantity > 0,
        });
      } else if (v.stockQuantity > 0) {
        existing.hasStock = true;
      }
    }

    const sanitizedProductReviews = (Array.isArray(product.reviews) ? product.reviews : []).map(
      (rv: any) => ({
        id: rv.id,
        orderId: rv.orderId,
        rating: Number(rv.rating),
        comment: String(rv.comment ?? ''),
        verifiedPurchase: true,
        verifiedPurchaseLabel: 'Đã mua hàng',
        sellerReply: rv.sellerReply ? String(rv.sellerReply) : null,
        sellerRepliedAt: rv.sellerRepliedAt || null,
        createdAt: rv.createdAt,
        userName: maskReviewerName(rv.userName),
        userAvatar: rv.userAvatar || null,
        images: Array.isArray(rv.images) ? rv.images : [],
      })
    );

    const detailData = {
      id: product.id,
      name: product.name,
      slug: product.slug,
      targetGender: product.target_gender,
      target_gender: product.target_gender,
      categoryId: product.category_id,
      categoryName: product.category_name,
      category_name: product.category_name,
      categorySlug: product.category_slug,
      category_slug: product.category_slug,
      description: product.description,
      material: product.material,
      careInstructions: product.care_instructions,
      basePrice: Number(product.base_price),
      base_price: Number(product.base_price),
      initialPrice: productPriceCalc.initialPrice,
      effectivePrice: productPriceCalc.effectivePrice,
      effective_price: productPriceCalc.effectivePrice,
      maxEffectivePrice: maxVariantEffectivePrice,
      discountPercent: productPriceCalc.discountPercent,
      discount_percent: productPriceCalc.discountPercent,
      isOnSale: productPriceCalc.isOnSale,
      is_on_sale: productPriceCalc.isOnSale,
      activePromotion: activePromotions[0] || null,
      totalStock,
      total_stock: totalStock,
      stockStatus:
        totalStock <= 0
          ? 'out_of_stock'
          : totalStock <= lowStockThreshold
          ? 'low_stock'
          : 'in_stock',
      ratingAvg: Number(product.rating_avg) || 0,
      rating_avg: Number(product.rating_avg) || 0,
      reviewCount: Number(product.review_count) || 0,
      review_count: Number(product.review_count) || 0,
      images: product.images,
      colors: Array.from(colorMap.values()),
      sizes: availableSizes,
      variants: enrichedVariants,
      attributes: product.attributes,
      reviews: sanitizedProductReviews,
      sizeChart: productSizeChart,
      sizeRecommendation,
      relatedProducts,
    };

    res.json({
      success: true,
      data: detailData,
      product: detailData,
    });
  } catch (err: any) {
    console.error('[PRODUCT DETAIL INTERNAL ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
    res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Lỗi tải chi tiết sản phẩm',
    });
  }
});
