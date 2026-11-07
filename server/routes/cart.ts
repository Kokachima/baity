import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { queryRows, withTransaction } from '../db/index.ts';
import { sql } from 'drizzle-orm';
import {
  optionalAuth,
  requireAuth,
  parseCookies,
  buildSessionCookieOptions,
  type AuthRequest,
} from '../services/auth.ts';
import {
  calculateEffectivePrice,
  calculateServerShippingFee,
  getStoreShippingSettings,
  type PromotionInfo,
} from '../services/pricing.ts';

export const cartRouter = Router();

export const CART_SESSION_COOKIE = 'session_id';

// Khóa tuần tự hóa thao tác giỏ hàng theo chủ sở hữu (user_id hoặc session_id) kết hợp với DB Transaction + UNIQUE constraint
const cartOwnerLocks = new Map<string, Promise<any>>();
async function withCartOwnerLock<T>(ownerKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = cartOwnerLocks.get(ownerKey) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => {
    release = r;
  });
  cartOwnerLocks.set(ownerKey, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (cartOwnerLocks.get(ownerKey) === next) {
      cartOwnerLocks.delete(ownerKey);
    }
  }
}

function sendCartError(res: Response, err: any, fallbackMessage: string) {
  const status =
    typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500
      ? err.statusCode
      : 500;

  if (status < 500) {
    return res.status(status).json({
      success: false,
      message: err.message || fallbackMessage,
    });
  }

  console.error('[CART INTERNAL ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_SERVER_ERROR',
    message: fallbackMessage,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: fallbackMessage,
    },
  });
}

/**
 * Đọc session_id của khách vãng lai từ cookie
 */
export function getGuestSessionIdFromReq(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies[CART_SESSION_COOKIE] || cookies['baity_session_id'];
  if (sid && typeof sid === 'string' && sid.trim().length >= 8) {
    return sid.trim();
  }
  return null;
}

/**
 * Đảm bảo khách vãng lai có session_id ngẫu nhiên trong cookie httpOnly.
 * Khi bật COOKIE_CROSS_SITE=true (bản chạy thử trong iframe AI Studio), tự động dùng SameSite=None; Secure; Partitioned.
 */
export function ensureGuestSessionCookie(req: Request, res: Response): string {
  const existing = getGuestSessionIdFromReq(req);
  if (existing) {
    return existing;
  }
  const newSessionId = crypto.randomBytes(24).toString('hex');
  const cookieOptions = buildSessionCookieOptions(30 * 24 * 60 * 60 * 1000); // 30 ngày
  res.cookie(CART_SESSION_COOKIE, newSessionId, cookieOptions);
  res.cookie('baity_session_id', newSessionId, cookieOptions);
  return newSessionId;
}

/**
 * Gộp giỏ hàng khách vãng lai (session_id) vào tài khoản người dùng (user_id)
 * - Cộng dồn số lượng nếu biến thể đã có trong giỏ của user
 * - Giới hạn tối đa theo LEAST(..., 10, stock_quantity) thực tế của biến thể
 * - Xóa các dòng giỏ hàng tạm của session_id sau khi gộp xong
 */
export async function mergeGuestCartIntoUserCart(
  sessionId: string | null | undefined,
  userId: string | null | undefined
): Promise<void> {
  if (!sessionId || !userId) return;

  await withCartOwnerLock(`user:${userId}`, async () => {
    await withTransaction(async (txQueryRows) => {
      const guestItems = await txQueryRows<{
        id: string;
        variant_id: string;
        quantity: number;
      }>(sql`
        SELECT id, variant_id, quantity
        FROM cart_items
        WHERE session_id = ${sessionId} AND user_id IS NULL
        FOR UPDATE;
      `);

      if (guestItems.length === 0) return;

      for (const gItem of guestItems) {
        const variantRows = await txQueryRows<{
          id: string;
          stock_quantity: number;
          is_active: boolean;
        }>(sql`
          SELECT pv.id, pv.stock_quantity, p.is_active
          FROM product_variants pv
          JOIN products p ON p.id = pv.product_id
          WHERE pv.id = ${gItem.variant_id}::uuid
          LIMIT 1;
        `);

        // Nếu biến thể không tồn tại, sản phẩm bị ẩn hoặc hết hàng hoàn toàn -> xóa dòng tạm
        if (
          variantRows.length === 0 ||
          !variantRows[0].is_active ||
          variantRows[0].stock_quantity <= 0
        ) {
          await txQueryRows(sql`DELETE FROM cart_items WHERE id = ${gItem.id}::uuid;`);
          continue;
        }

        const maxStock = Number(variantRows[0].stock_quantity);

        // Kiểm tra xem user đã có biến thể này trong giỏ chưa (khóa FOR UPDATE)
        const existingUserItem = await txQueryRows<{ id: string; quantity: number }>(sql`
          SELECT id, quantity
          FROM cart_items
          WHERE user_id = ${userId}::uuid AND variant_id = ${gItem.variant_id}::uuid
          FOR UPDATE;
        `);

        if (existingUserItem.length > 0) {
          const mergedQty = Math.min(
            Number(existingUserItem[0].quantity) + Number(gItem.quantity),
            10,
            maxStock
          );
          await txQueryRows(sql`
            UPDATE cart_items
            SET quantity = ${mergedQty}
            WHERE id = ${existingUserItem[0].id}::uuid;
          `);
          await txQueryRows(sql`
            DELETE FROM cart_items WHERE id = ${gItem.id}::uuid;
          `);
        } else {
          // Kiểm tra giới hạn tối đa 50 dòng trong giỏ của user trước khi chuyển sang
          const countRows = await txQueryRows<{ count: number }>(sql`
            SELECT COUNT(*)::int AS count FROM cart_items WHERE user_id = ${userId}::uuid;
          `);
          if (Number(countRows[0]?.count || 0) >= 50) {
            await txQueryRows(sql`DELETE FROM cart_items WHERE id = ${gItem.id}::uuid;`);
            continue;
          }

          const clampedQty = Math.min(Number(gItem.quantity), 10, maxStock);
          await txQueryRows(sql`
            UPDATE cart_items
            SET user_id = ${userId}::uuid,
                session_id = NULL,
                quantity = ${clampedQty}
            WHERE id = ${gItem.id}::uuid;
          `);
        }
      }
    });
  });
}

export interface EnrichedCartItem {
  id: string;
  variantId: string;
  productId: string;
  productName: string;
  productSlug: string;
  categoryId: string;
  categoryName: string;
  colorName: string;
  colorCode: string;
  size: string;
  sku: string;
  imageUrl: string;
  quantity: number;
  stockQuantity: number;
  basePrice: number;
  priceOverride: number | null;
  initialPrice: number;
  effectivePrice: number;
  unitPrice: number;
  discountPercent: number;
  isOnSale: boolean;
  promotionTitle?: string;
  lineTotal: number;
  out_of_stock: boolean;
  isOutOfStock: boolean;
  insufficient_stock: boolean;
  exceedsStock: boolean;
  price_changed: boolean;
  isPriceChanged: boolean;
}

export interface EnrichedCartResponse {
  items: EnrichedCartItem[];
  summary: {
    totalItems: number;
    distinctItems: number;
    subtotal: number;
    estimatedShippingFee: number;
    freeShippingThreshold: number;
    estimatedTotal: number;
    hasOutOfStock: boolean;
    hasInsufficientStock: boolean;
    hasPriceChanged: boolean;
  };
}

/**
 * Truy vấn và tính toán toàn bộ giỏ hàng từ CSDL (Giá, phí ship & tồn kho 100% do server quyết định qua calculateServerShippingFee)
 */
export async function getEnrichedCart(
  userId: string | null,
  sessionId: string | null
): Promise<EnrichedCartResponse> {
  const shippingSettings = await getStoreShippingSettings();

  if (!userId && !sessionId) {
    return {
      items: [],
      summary: {
        totalItems: 0,
        distinctItems: 0,
        subtotal: 0,
        estimatedShippingFee: 0,
        freeShippingThreshold: shippingSettings.freeShippingThreshold,
        estimatedTotal: 0,
        hasOutOfStock: false,
        hasInsufficientStock: false,
        hasPriceChanged: false,
      },
    };
  }

  const ownerCondition = userId
    ? sql`ci.user_id = ${userId}::uuid`
    : sql`ci.session_id = ${sessionId} AND ci.user_id IS NULL`;

  const rawRows = await queryRows<any>(sql`
    SELECT
      ci.id AS cart_item_id,
      ci.variant_id,
      ci.quantity,
      ci.created_at,
      pv.color_name,
      pv.color_code,
      pv.size,
      pv.sku,
      pv.stock_quantity,
      pv.price_override,
      p.id AS product_id,
      p.name AS product_name,
      p.slug AS product_slug,
      p.base_price,
      p.is_active,
      p.category_id,
      c.name AS category_name,
      COALESCE((
        SELECT pi.image_url
        FROM product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.is_primary DESC, pi.display_order ASC
        LIMIT 1
      ), '') AS image_url,
      COALESCE((
        SELECT json_agg(
          json_build_object(
            'id', pr.id,
            'title', pr.title,
            'discountPercent', pt.discount_percent
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
      ), '[]'::json) AS active_promotions
    FROM cart_items ci
    JOIN product_variants pv ON pv.id = ci.variant_id
    JOIN products p ON p.id = pv.product_id
    JOIN categories c ON c.id = p.category_id
    WHERE ${ownerCondition}
      AND p.is_active = true
    ORDER BY ci.created_at ASC, ci.id ASC;
  `);

  const items: EnrichedCartItem[] = rawRows.map((row: any) => {
    const promos: PromotionInfo[] = Array.isArray(row.active_promotions)
      ? row.active_promotions
      : [];
    const priceCalc = calculateEffectivePrice(
      Number(row.base_price),
      row.price_override !== null && row.price_override !== undefined
        ? Number(row.price_override)
        : null,
      promos
    );
    const quantity = Number(row.quantity);
    const stockQuantity = Number(row.stock_quantity);
    const lineTotal = priceCalc.effectivePrice * quantity;
    const isOutOfStock = stockQuantity <= 0;
    const exceedsStock = !isOutOfStock && quantity > stockQuantity;
    const priceChanged = priceCalc.effectivePrice !== priceCalc.initialPrice;

    return {
      id: row.cart_item_id,
      variantId: row.variant_id,
      productId: row.product_id,
      productName: row.product_name,
      productSlug: row.product_slug,
      categoryId: row.category_id,
      categoryName: row.category_name,
      colorName: row.color_name,
      colorCode: row.color_code,
      size: row.size,
      sku: row.sku,
      imageUrl: row.image_url,
      quantity,
      stockQuantity,
      basePrice: priceCalc.basePrice,
      priceOverride: priceCalc.priceOverride,
      initialPrice: priceCalc.initialPrice,
      effectivePrice: priceCalc.effectivePrice,
      unitPrice: priceCalc.effectivePrice,
      discountPercent: priceCalc.discountPercent,
      isOnSale: priceCalc.isOnSale,
      promotionTitle: priceCalc.promotionTitle,
      lineTotal,
      out_of_stock: isOutOfStock,
      isOutOfStock,
      insufficient_stock: exceedsStock,
      exceedsStock,
      price_changed: priceChanged,
      isPriceChanged: priceChanged,
    };
  });

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const freeShippingThreshold = shippingSettings.freeShippingThreshold;
  const estimatedShippingFee =
    subtotal > 0 ? await calculateServerShippingFee('standard', subtotal) : 0;

  return {
    items,
    subtotal,
    totalItems,
    summary: {
      totalItems,
      distinctItems: items.length,
      subtotal,
      shippingFee: estimatedShippingFee,
      estimatedShippingFee,
      freeShippingThreshold,
      estimatedTotal: subtotal + estimatedShippingFee,
      hasOutOfStock: items.some((i) => i.out_of_stock),
      hasInsufficientStock: items.some((i) => i.insufficient_stock),
      hasPriceChanged: items.some((i) => i.price_changed),
    },
  } as any;
}

/**
 * 1. XEM GIỎ HÀNG (GET /api/cart)
 * - Tự động gộp giỏ khách vãng lai (session_id) nếu đã đăng nhập
 * - Cấp cookie session_id httpOnly nếu là khách vãng lai chưa có session
 */
cartRouter.get('/', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const guestSessionId = getGuestSessionIdFromReq(req);

    if (req.user) {
      if (guestSessionId) {
        await mergeGuestCartIntoUserCart(guestSessionId, req.user.id);
      }
      const cart = await getEnrichedCart(req.user.id, null);
      return res.json({
        success: true,
        ...cart,
        data: cart,
      });
    }

    const sessionId = ensureGuestSessionCookie(req, res);
    const cart = await getEnrichedCart(null, sessionId);
    res.json({
      success: true,
      ...cart,
      data: cart,
    });
  } catch (err: any) {
    return sendCartError(res, err, 'Đã xảy ra lỗi hệ thống khi tải giỏ hàng');
  }
});

/**
 * 2. THÊM SẢN PHẨM VÀO GIỎ HÀNG (POST /api/cart)
 * - Bỏ qua hoàn toàn mọi giá tiền gửi từ client; giá luôn do server tính từ DB
 * - Thực thi nguyên tử trong Transaction + UNIQUE constraint + ON CONFLICT DO UPDATE
 *   để 2 request song song không tạo trùng dòng, không vượt 10 món/dòng và không vượt 50 dòng
 */
cartRouter.post('/', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { variantId, quantity = 1 } = req.body || {};

    if (!variantId || typeof variantId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng chọn biến thể sản phẩm (màu sắc và kích cỡ) hợp lệ',
      });
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(variantId)) {
      return res.status(400).json({
        success: false,
        message: 'Mã biến thể (variantId) không đúng định dạng UUID',
      });
    }

    const parsedQty = Number(quantity);
    if (!Number.isInteger(parsedQty) || parsedQty < 1 || parsedQty > 10) {
      return res.status(400).json({
        success: false,
        message: 'Số lượng cho mỗi dòng sản phẩm phải là số nguyên từ 1 đến 10',
      });
    }

    let userId: string | null = null;
    let sessionId: string | null = null;

    if (req.user) {
      userId = req.user.id;
      const guestSid = getGuestSessionIdFromReq(req);
      if (guestSid) {
        await mergeGuestCartIntoUserCart(guestSid, userId);
      }
    } else {
      sessionId = ensureGuestSessionCookie(req, res);
    }

    const ownerLockKey = userId ? `user:${userId}` : `session:${sessionId}`;

    await withCartOwnerLock(ownerLockKey, async () => {
      await withTransaction(async (txQueryRows) => {
        // Kiểm tra biến thể và khóa dòng biến thể để đọc tồn kho chính xác
        const variantRows = await txQueryRows<{
          id: string;
          stock_quantity: number;
          color_name: string;
          size: string;
          product_name: string;
          is_active: boolean;
        }>(sql`
          SELECT pv.id, pv.stock_quantity, pv.color_name, pv.size, p.name AS product_name, p.is_active
          FROM product_variants pv
          JOIN products p ON p.id = pv.product_id
          WHERE pv.id = ${variantId}::uuid
          LIMIT 1;
        `);

        if (variantRows.length === 0 || !variantRows[0].is_active) {
          const err: any = new Error('Biến thể sản phẩm không tồn tại hoặc đã ngừng kinh doanh');
          err.statusCode = 404;
          throw err;
        }

        const variant = variantRows[0];
        const availableStock = Number(variant.stock_quantity);

        if (availableStock <= 0) {
          const err: any = new Error(
            `Sản phẩm "${variant.product_name}" (${variant.color_name} - Size ${variant.size}) hiện đã hết hàng`
          );
          err.statusCode = 400;
          throw err;
        }

        const ownerCond = userId
          ? sql`user_id = ${userId}::uuid`
          : sql`session_id = ${sessionId} AND user_id IS NULL`;

        const existingRows = await txQueryRows<{ id: string; quantity: number }>(sql`
          SELECT id, quantity
          FROM cart_items
          WHERE ${ownerCond} AND variant_id = ${variantId}::uuid
          FOR UPDATE;
        `);

        if (existingRows.length === 0) {
          const lineCountRows = await txQueryRows<{ count: number }>(sql`
            SELECT COUNT(*)::int AS count FROM cart_items WHERE ${ownerCond};
          `);
          if (Number(lineCountRows[0]?.count || 0) >= 50) {
            const err: any = new Error('Giỏ hàng đã đạt giới hạn tối đa 50 dòng sản phẩm');
            err.statusCode = 400;
            throw err;
          }
        }

        const currentQtyInCart = existingRows.length > 0 ? Number(existingRows[0].quantity) : 0;
        const targetQuantity = currentQtyInCart + parsedQty;

        if (targetQuantity > 10) {
          const err: any = new Error('Số lượng tối đa cho mỗi dòng sản phẩm trong giỏ hàng là 10');
          err.statusCode = 400;
          throw err;
        }

        if (targetQuantity > availableStock) {
          const err: any = new Error(
            `Số lượng yêu cầu (${targetQuantity}) vượt quá số lượng tồn kho hiện có (${availableStock}) của sản phẩm`
          );
          err.statusCode = 400;
          throw err;
        }

        if (userId) {
          await txQueryRows(sql`
            INSERT INTO cart_items (user_id, session_id, variant_id, quantity)
            VALUES (${userId}::uuid, NULL, ${variantId}::uuid, ${parsedQty})
            ON CONFLICT (user_id, variant_id)
            DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity;
          `);
        } else {
          await txQueryRows(sql`
            INSERT INTO cart_items (user_id, session_id, variant_id, quantity)
            VALUES (NULL, ${sessionId}, ${variantId}::uuid, ${parsedQty})
            ON CONFLICT (session_id, variant_id)
            DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity;
          `);
        }
      });
    });

    const cart = await getEnrichedCart(userId, sessionId);
    res.status(200).json({
      success: true,
      message: 'Đã thêm sản phẩm vào giỏ hàng',
      ...cart,
      data: cart,
    });
  } catch (err: any) {
    return sendCartError(res, err, 'Đã xảy ra lỗi hệ thống khi thêm sản phẩm vào giỏ hàng');
  }
});

/**
 * Helper xử lý cập nhật số lượng món trong giỏ hàng
 */
async function handleUpdateCartItem(req: AuthRequest, res: Response, targetIdRaw?: string) {
  try {
    const idOrVariantId = targetIdRaw || req.body?.id || req.body?.itemId || req.body?.variantId;
    const { quantity } = req.body || {};

    if (!idOrVariantId || typeof idOrVariantId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Thiếu mã dòng giỏ hàng (id) hoặc biến thể (variantId)',
      });
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(idOrVariantId)) {
      return res.status(400).json({
        success: false,
        message: 'Mã dòng giỏ hàng không hợp lệ',
      });
    }

    const parsedQty = Number(quantity);
    if (!Number.isInteger(parsedQty) || parsedQty < 1 || parsedQty > 10) {
      return res.status(400).json({
        success: false,
        message: 'Số lượng cho mỗi dòng sản phẩm phải là số nguyên từ 1 đến 10',
      });
    }

    let userId: string | null = null;
    let sessionId: string | null = null;

    if (req.user) {
      userId = req.user.id;
      const guestSid = getGuestSessionIdFromReq(req);
      if (guestSid) {
        await mergeGuestCartIntoUserCart(guestSid, userId);
      }
    } else {
      sessionId = getGuestSessionIdFromReq(req);
      if (!sessionId) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy giỏ hàng của phiên hiện tại',
        });
      }
    }

    const ownerCond = userId
      ? sql`ci.user_id = ${userId}::uuid`
      : sql`ci.session_id = ${sessionId} AND ci.user_id IS NULL`;

    const itemRows = await queryRows<{
      id: string;
      variant_id: string;
      stock_quantity: number;
      product_name: string;
      is_active: boolean;
    }>(sql`
      SELECT
        ci.id,
        ci.variant_id,
        pv.stock_quantity,
        p.name AS product_name,
        p.is_active
      FROM cart_items ci
      JOIN product_variants pv ON pv.id = ci.variant_id
      JOIN products p ON p.id = pv.product_id
      WHERE ${ownerCond}
        AND (ci.id = ${idOrVariantId}::uuid OR ci.variant_id = ${idOrVariantId}::uuid)
      LIMIT 1;
    `);

    if (itemRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy sản phẩm này trong giỏ hàng của bạn',
      });
    }

    const cartItem = itemRows[0];
    const availableStock = Number(cartItem.stock_quantity);

    if (!cartItem.is_active || availableStock <= 0) {
      return res.status(400).json({
        success: false,
        message: `Sản phẩm "${cartItem.product_name}" hiện đã hết hàng`,
      });
    }

    if (parsedQty > availableStock) {
      return res.status(400).json({
        success: false,
        message: `Số lượng yêu cầu (${parsedQty}) vượt quá số lượng tồn kho còn lại (${availableStock})`,
      });
    }

    await queryRows(sql`
      UPDATE cart_items
      SET quantity = ${parsedQty}
      WHERE id = ${cartItem.id}::uuid;
    `);

    const cart = await getEnrichedCart(userId, sessionId);
    res.json({
      success: true,
      message: 'Đã cập nhật số lượng sản phẩm',
      ...cart,
      data: cart,
    });
  } catch (err: any) {
    return sendCartError(res, err, 'Đã xảy ra lỗi hệ thống khi cập nhật số lượng giỏ hàng');
  }
}

/**
 * 3. SỬA SỐ LƯỢNG TRONG GIỎ HÀNG BẰNG PUT (PUT /api/cart/:id & PUT /api/cart)
 */
cartRouter.put('/:id', optionalAuth, (req: AuthRequest, res: Response) =>
  handleUpdateCartItem(req, res, req.params.id)
);

cartRouter.put('/', optionalAuth, (req: AuthRequest, res: Response) =>
  handleUpdateCartItem(req, res)
);

/**
 * 4. XÓA MỘT MÓN KHỎI GIỎ HÀNG (DELETE /api/cart/:id)
 */
cartRouter.delete('/:id', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const targetId = req.params.id;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(targetId)) {
      return res.status(400).json({
        success: false,
        message: 'Mã dòng giỏ hàng không hợp lệ',
      });
    }

    let userId: string | null = null;
    let sessionId: string | null = null;

    if (req.user) {
      userId = req.user.id;
      const guestSid = getGuestSessionIdFromReq(req);
      if (guestSid) {
        await mergeGuestCartIntoUserCart(guestSid, userId);
      }
    } else {
      sessionId = getGuestSessionIdFromReq(req);
      if (!sessionId) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy giỏ hàng',
        });
      }
    }

    const ownerCond = userId
      ? sql`user_id = ${userId}::uuid`
      : sql`session_id = ${sessionId} AND user_id IS NULL`;

    const deleted = await queryRows<{ id: string }>(sql`
      DELETE FROM cart_items
      WHERE ${ownerCond}
        AND (id = ${targetId}::uuid OR variant_id = ${targetId}::uuid)
      RETURNING id;
    `);

    if (deleted.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy sản phẩm cần xóa trong giỏ hàng của bạn',
      });
    }

    const cart = await getEnrichedCart(userId, sessionId);
    res.json({
      success: true,
      message: 'Đã xóa sản phẩm khỏi giỏ hàng',
      ...cart,
      data: cart,
    });
  } catch (err: any) {
    return sendCartError(res, err, 'Đã xảy ra lỗi hệ thống khi xóa sản phẩm khỏi giỏ hàng');
  }
});

/**
 * 5. XÓA TOÀN BỘ GIỎ HÀNG HIỆN TẠI (DELETE /api/cart)
 */
cartRouter.delete('/', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user) {
      await queryRows(sql`DELETE FROM cart_items WHERE user_id = ${req.user.id}::uuid;`);
    } else {
      const sessionId = getGuestSessionIdFromReq(req);
      if (sessionId) {
        await queryRows(sql`
          DELETE FROM cart_items WHERE session_id = ${sessionId} AND user_id IS NULL;
        `);
      }
    }

    const cart = await getEnrichedCart(req.user?.id || null, null);
    res.json({
      success: true,
      message: 'Đã làm trống giỏ hàng',
      ...cart,
      data: cart,
    });
  } catch (err: any) {
    return sendCartError(res, err, 'Đã xảy ra lỗi hệ thống khi làm trống giỏ hàng');
  }
});

/**
 * 6. ĐỒNG BỘ / GỘP GIỎ HÀNG SAU KHI ĐĂNG NHẬP (POST /api/cart/sync)
 */
cartRouter.post('/sync', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const sessionId = req.body?.sessionId || getGuestSessionIdFromReq(req);
    if (sessionId) {
      await mergeGuestCartIntoUserCart(sessionId, userId);
    }
    const cart = await getEnrichedCart(userId, null);
    res.json({
      success: true,
      message: 'Đã đồng bộ giỏ hàng vào tài khoản thành công',
      ...cart,
      data: cart,
    });
  } catch (err: any) {
    return sendCartError(res, err, 'Đã xảy ra lỗi hệ thống khi đồng bộ giỏ hàng');
  }
});

