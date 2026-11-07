import { Router, type Response } from 'express';
import { queryRows } from '../db/index.ts';
import { sql } from 'drizzle-orm';
import { requireAuth, type AuthRequest } from '../services/auth.ts';
import { sqlProductPricingCte } from '../services/pricing.ts';

export const wishlistRouter = Router();

/**
 * 1. XEM DANH SÁCH YÊU THÍCH (GET /api/wishlist)
 * - Yêu cầu đăng nhập
 * - Trả về danh sách sản phẩm kèm giá hiệu lực (effective_price), khuyến mãi, ảnh đại diện và tồn kho
 */
wishlistRouter.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const items = await queryRows<any>(sql`
      WITH ${sqlProductPricingCte()}
      SELECT
        wi.id AS wishlist_item_id,
        wi.product_id,
        wi.created_at AS added_at,
        p.id,
        p.name,
        p.slug,
        p.target_gender,
        p.base_price,
        pp.initial_price,
        pp.discount_percent,
        pp.promotion_title,
        pp.effective_price,
        pp.max_effective_price,
        pp.is_on_sale,
        pp.total_stock,
        pp.rating_avg,
        pp.review_count,
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
          ) colors
        ), '[]'::json) AS colors
      FROM wishlist_items wi
      JOIN products p ON p.id = wi.product_id
      JOIN categories c ON c.id = p.category_id
      JOIN product_pricing pp ON pp.product_id = p.id
      WHERE wi.user_id = ${userId}::uuid
        AND p.is_active = true
      ORDER BY wi.created_at DESC, wi.id ASC;
    `);

    res.json({
      success: true,
      total: items.length,
      items,
      data: items,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Lỗi tải danh sách yêu thích',
      error: err.message,
    });
  }
});

/**
 * 2. THÊM SẢN PHẨM VÀO DANH SÁCH YÊU THÍCH (POST /api/wishlist)
 * - Yêu cầu đăng nhập
 * - Chống trùng lặp bằng UNIQUE(user_id, product_id)
 */
wishlistRouter.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { productId } = req.body || {};

    if (!productId || typeof productId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp mã sản phẩm (productId)',
      });
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(productId)) {
      return res.status(400).json({
        success: false,
        message: 'Mã sản phẩm (productId) không đúng định dạng UUID',
      });
    }

    const prodRows = await queryRows<{ id: string; name: string; is_active: boolean }>(sql`
      SELECT id, name, is_active FROM products WHERE id = ${productId}::uuid LIMIT 1;
    `);

    if (prodRows.length === 0 || !prodRows[0].is_active) {
      return res.status(404).json({
        success: false,
        message: 'Sản phẩm không tồn tại hoặc đã ngừng kinh doanh',
      });
    }

    const inserted = await queryRows<{ id: string }>(sql`
      INSERT INTO wishlist_items (user_id, product_id)
      VALUES (${userId}::uuid, ${productId}::uuid)
      ON CONFLICT (user_id, product_id) DO NOTHING
      RETURNING id;
    `);

    const items = await queryRows<any>(sql`
      SELECT
        wi.id AS wishlist_item_id,
        wi.product_id,
        wi.created_at AS added_at,
        p.id,
        p.name,
        p.slug,
        p.target_gender,
        p.base_price
      FROM wishlist_items wi
      JOIN products p ON p.id = wi.product_id
      WHERE wi.user_id = ${userId}::uuid
      ORDER BY wi.created_at DESC;
    `);

    res.status(inserted.length > 0 ? 201 : 200).json({
      success: true,
      alreadyExists: inserted.length === 0,
      message:
        inserted.length > 0
          ? 'Đã thêm sản phẩm vào danh sách yêu thích'
          : 'Sản phẩm đã có sẵn trong danh sách yêu thích',
      total: items.length,
      items,
      data: items,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Lỗi thêm vào danh sách yêu thích',
      error: err.message,
    });
  }
});

/**
 * 3. XÓA SẢN PHẨM KHỎI DANH SÁCH YÊU THÍCH (DELETE /api/wishlist/:productId)
 */
wishlistRouter.delete('/:productId', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const targetId = req.params.productId;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(targetId)) {
      return res.status(400).json({
        success: false,
        message: 'Mã sản phẩm không hợp lệ',
      });
    }

    const deleted = await queryRows<{ id: string }>(sql`
      DELETE FROM wishlist_items
      WHERE user_id = ${userId}::uuid
        AND (product_id = ${targetId}::uuid OR id = ${targetId}::uuid)
      RETURNING id;
    `);

    if (deleted.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Sản phẩm không có trong danh sách yêu thích của bạn',
      });
    }

    const items = await queryRows<any>(sql`
      SELECT
        wi.id AS wishlist_item_id,
        wi.product_id,
        wi.created_at AS added_at,
        p.id,
        p.name,
        p.slug,
        p.target_gender,
        p.base_price
      FROM wishlist_items wi
      JOIN products p ON p.id = wi.product_id
      WHERE wi.user_id = ${userId}::uuid
      ORDER BY wi.created_at DESC;
    `);

    res.json({
      success: true,
      message: 'Đã xóa sản phẩm khỏi danh sách yêu thích',
      total: items.length,
      items,
      data: items,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Lỗi xóa khỏi danh sách yêu thích',
      error: err.message,
    });
  }
});

/**
 * 4. CHUYỂN NHANH SẢN PHẨM TỪ WISHLIST SANG GIỎ HÀNG (POST /api/wishlist/:productId/move-to-cart)
 * - Tự động chọn biến thể khả dụng còn hàng (hoặc theo variantId người dùng gửi)
 * - Thêm vào giỏ hàng của user và xóa khỏi danh sách yêu thích
 */
wishlistRouter.post('/:productId/move-to-cart', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const targetId = req.params.productId;
    const { variantId: reqVariantId, quantity = 1 } = req.body || {};

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(targetId)) {
      return res.status(400).json({
        success: false,
        message: 'Mã sản phẩm không đúng định dạng UUID',
      });
    }

    // Tìm biến thể còn hàng
    let variantId = reqVariantId;
    if (!variantId) {
      const vRows = await queryRows<{ id: string; stock_quantity: number }>(sql`
        SELECT pv.id, pv.stock_quantity
        FROM product_variants pv
        JOIN products p ON p.id = pv.product_id
        WHERE p.id = ${targetId}::uuid AND pv.stock_quantity > 0 AND p.is_active = true
        ORDER BY pv.stock_quantity DESC, pv.sku ASC
        LIMIT 1;
      `);
      if (vRows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Sản phẩm hiện đã hết hàng mọi biến thể',
        });
      }
      variantId = vRows[0].id;
    }

    // Thêm vào giỏ hàng của user
    const existingCart = await queryRows<{ id: string; quantity: number }>(sql`
      SELECT id, quantity FROM cart_items
      WHERE user_id = ${userId}::uuid AND variant_id = ${variantId}::uuid
      LIMIT 1;
    `);

    const qtyToAdd = Math.max(1, Math.min(10, Number(quantity) || 1));
    if (existingCart.length > 0) {
      const newQty = Math.min(10, existingCart[0].quantity + qtyToAdd);
      await queryRows(sql`
        UPDATE cart_items
        SET quantity = ${newQty}
        WHERE id = ${existingCart[0].id}::uuid;
      `);
    } else {
      await queryRows(sql`
        INSERT INTO cart_items (user_id, variant_id, quantity)
        VALUES (${userId}::uuid, ${variantId}::uuid, ${qtyToAdd});
      `);
    }

    // Xóa khỏi wishlist
    await queryRows(sql`
      DELETE FROM wishlist_items
      WHERE user_id = ${userId}::uuid AND product_id = ${targetId}::uuid;
    `);

    res.json({
      success: true,
      message: 'Đã chuyển nhanh sản phẩm vào giỏ hàng thành công',
      variantId,
      quantity: qtyToAdd,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: 'Lỗi chuyển sản phẩm sang giỏ hàng',
      error: err.message,
    });
  }
});
