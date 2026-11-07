import { sql, type SQL } from 'drizzle-orm';
import { queryRows } from '../db/index.ts';
import { DEFAULT_SHIPPING_CONFIG } from '../../shared/contracts.ts';

export interface PromotionInfo {
  id: string;
  title: string;
  discountPercent: number;
}

export interface EffectivePriceResult {
  basePrice: number;
  priceOverride: number | null;
  initialPrice: number;
  effectivePrice: number;
  discountPercent: number;
  isOnSale: boolean;
  promotionTitle?: string;
}

/**
 * Tính giá hiệu lực của sản phẩm/biến thể dựa trên giá gốc, priceOverride và các chương trình khuyến mãi đang hoạt động.
 * Công thức chuẩn:
 *   initialPrice = priceOverride ?? basePrice
 *   discountAmount = ROUND(initialPrice * discountPercent / 100)
 *   effectivePrice = GREATEST(initialPrice - discountAmount, 0)
 */
export function calculateEffectivePrice(
  basePrice: number,
  priceOverride: number | null = null,
  activePromotions: PromotionInfo[] = []
): EffectivePriceResult {
  const initialPrice = priceOverride !== null && priceOverride !== undefined ? priceOverride : basePrice;

  if (!activePromotions || activePromotions.length === 0) {
    return {
      basePrice,
      priceOverride,
      initialPrice,
      effectivePrice: initialPrice,
      discountPercent: 0,
      isOnSale: initialPrice < basePrice,
    };
  }

  // Lấy chiết khấu cao nhất nếu có nhiều chương trình khuyến mãi trùng lặp
  const bestPromo = activePromotions.reduce((prev, current) => {
    return current.discountPercent > prev.discountPercent ? current : prev;
  });

  const discountPercent = Math.min(Math.max(bestPromo.discountPercent, 0), 100);
  const discountAmount = Math.round((initialPrice * discountPercent) / 100);
  const effectivePrice = Math.max(initialPrice - discountAmount, 0);

  return {
    basePrice,
    priceOverride,
    initialPrice,
    effectivePrice,
    discountPercent,
    isOnSale: discountPercent > 0 || effectivePrice < basePrice,
    promotionTitle: bestPromo.title,
  };
}

/**
 * Biểu thức SQL tính giá hiệu lực dùng chung một nguồn công thức với calculateEffectivePrice:
 * GREATEST(initialPrice - ROUND((initialPrice * discountPercent) / 100.0)::int, 0)
 */
export function sqlEffectivePriceFormula(initialPriceExpr: SQL, discountPercentExpr: SQL): SQL {
  return sql`GREATEST((${initialPriceExpr}) - ROUND(((${initialPriceExpr}) * (${discountPercentExpr})) / 100.0)::int, 0)`;
}

/**
 * CTE SQL dùng chung để tính giá hiệu lực (bao gồm cả price_override của biến thể và khuyến mãi đang chạy),
 * tồn kho, điểm đánh giá và số lượng bán cho danh sách sản phẩm.
 */
export function sqlProductPricingCte(): SQL {
  const minInitialExpr = sql`COALESCE(v_agg.min_initial_price, p.base_price)`;
  const maxInitialExpr = sql`COALESCE(v_agg.max_initial_price, p.base_price)`;
  const discountExpr = sql`COALESCE(pr_agg.discount_percent, 0)`;

  return sql`
    product_pricing AS (
      SELECT
        p.id AS product_id,
        p.base_price,
        (${minInitialExpr})::int AS initial_price,
        (${maxInitialExpr})::int AS max_initial_price,
        (${discountExpr})::int AS discount_percent,
        pr_agg.promotion_title,
        ${sqlEffectivePriceFormula(minInitialExpr, discountExpr)}::int AS effective_price,
        ${sqlEffectivePriceFormula(maxInitialExpr, discountExpr)}::int AS max_effective_price,
        ((${discountExpr}) > 0 OR (${minInitialExpr}) < p.base_price) AS is_on_sale,
        COALESCE(v_agg.total_stock, 0)::int AS total_stock,
        COALESCE(rv_agg.rating_avg, 0)::float AS rating_avg,
        COALESCE(rv_agg.review_count, 0)::int AS review_count,
        COALESCE(v_agg.sold_count, 0)::int AS sold_count
      FROM products p
      LEFT JOIN LATERAL (
        SELECT
          MIN(COALESCE(pv.price_override, p.base_price))::int AS min_initial_price,
          MAX(COALESCE(pv.price_override, p.base_price))::int AS max_initial_price,
          COALESCE(SUM(pv.stock_quantity), 0)::int AS total_stock,
          COALESCE((
            SELECT SUM(oi.quantity)::int
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            JOIN product_variants pv2 ON pv2.id = oi.variant_id
            WHERE pv2.product_id = p.id AND o.status NOT IN ('cancelled')
          ), 0)::int AS sold_count
        FROM product_variants pv
        WHERE pv.product_id = p.id
      ) v_agg ON true
      LEFT JOIN LATERAL (
        SELECT
          pt.discount_percent::int AS discount_percent,
          pr.title AS promotion_title
        FROM promotion_targets pt
        JOIN promotions pr ON pr.id = pt.promotion_id
        WHERE pr.is_active = true
          AND NOW() BETWEEN pr.start_time AND pr.end_time
          AND (
            (pt.target_type = 'product' AND pt.target_id = p.id)
            OR (pt.target_type = 'category' AND pt.target_id = p.category_id)
          )
        ORDER BY pt.discount_percent DESC, pr.start_time DESC
        LIMIT 1
      ) pr_agg ON true
      LEFT JOIN LATERAL (
        SELECT
          ROUND(AVG(rv.rating)::numeric, 1)::float AS rating_avg,
          COUNT(rv.id)::int AS review_count
        FROM reviews rv
        WHERE rv.product_id = p.id
          AND rv.is_visible = true
      ) rv_agg ON true
    )
  `;
}

/**
 * Tính số tiền giảm giá của Voucher dựa trên loại voucher và tổng tiền sau khi đã trừ khuyến mãi
 */
export function calculateVoucherDiscount(
  subtotal: number,
  shippingFee: number,
  voucher: {
    discountType: 'percent' | 'fixed' | 'free_shipping';
    discountValue: number;
    maxDiscount?: number | null;
    minOrderValue: number;
  }
): { discountAmount: number; isValid: boolean; message?: string } {
  if (subtotal < voucher.minOrderValue) {
    return {
      discountAmount: 0,
      isValid: false,
      message: `Đơn hàng tối thiểu phải từ ${voucher.minOrderValue.toLocaleString('vi-VN')}₫ để áp dụng mã này`,
    };
  }

  let discount = 0;

  if (voucher.discountType === 'percent') {
    discount = Math.round((subtotal * voucher.discountValue) / 100);
    if (voucher.maxDiscount && discount > voucher.maxDiscount) {
      discount = voucher.maxDiscount;
    }
  } else if (voucher.discountType === 'fixed') {
    discount = Math.min(voucher.discountValue, subtotal);
  } else if (voucher.discountType === 'free_shipping') {
    // Loại miễn phí vận chuyển: đưa toàn bộ phí vận chuyển về 0 (nếu có trần maxDiscount thì giới hạn theo trần)
    discount = voucher.maxDiscount ? Math.min(voucher.maxDiscount, shippingFee) : shippingFee;
  }

  return {
    discountAmount: Math.max(discount, 0),
    isValid: true,
  };
}

/**
 * Gợi ý size thông minh theo chiều cao (cm), cân nặng (kg), đối tượng sản phẩm và danh mục
 */
export function recommendProductSize(params: {
  heightCm: number;
  weightKg: number;
  targetGender: 'men' | 'women' | 'unisex';
  categorySlug?: string;
  availableSizes?: string[];
}): {
  recommendedSize: string;
  fitAdvice: string;
  chartType: 'men' | 'women' | 'unisex' | 'pants';
} {
  const { heightCm, weightKg, targetGender, categorySlug = '', availableSizes = [] } = params;

  // Nếu sản phẩm là Free Size
  if (availableSizes.length === 1 && availableSizes[0].toLowerCase().includes('free')) {
    return {
      recommendedSize: availableSizes[0],
      fitAdvice: 'Sản phẩm thiết kế Free Size phù hợp mọi vóc dáng.',
      chartType: targetGender,
    };
  }

  // Kiểm tra nếu sản phẩm sử dụng bảng size quần số (28..34)
  const usesNumericPantsSize =
    availableSizes.some((s) => ['28', '29', '30', '31', '32', '33', '34'].includes(s)) ||
    (['quan-jean-denim', 'quan-tay-kaki'].includes(categorySlug) &&
      !availableSizes.some((s) => ['XS', 'S', 'M', 'L', 'XL', 'XXL'].includes(s)));

  if (usesNumericPantsSize) {
    let size = '31';
    if (weightKg < 52 && heightCm < 165) size = '28';
    else if (weightKg < 57) size = '29';
    else if (weightKg <= 62) size = '30';
    else if (weightKg <= 68) size = '31';
    else if (weightKg <= 74) size = '32';
    else if (weightKg <= 81) size = '33';
    else size = '34';

    if (availableSizes.length > 0 && !availableSizes.includes(size)) {
      size = availableSizes[Math.min(Math.floor(availableSizes.length / 2), availableSizes.length - 1)];
    }

    return {
      recommendedSize: size,
      fitAdvice: `Với chiều cao ${heightCm}cm và cân nặng ${weightKg}kg, size quần ${size} sẽ ôm vừa vặn vùng eo và chiều dài ống chuẩn.`,
      chartType: 'pants',
    };
  }

  if (targetGender === 'women') {
    let size = 'M';
    if (weightKg < 45 && heightCm < 158) size = 'XS';
    else if (weightKg <= 50 && heightCm <= 162) size = 'S';
    else if (weightKg <= 56 && heightCm <= 167) size = 'M';
    else if (weightKg <= 63 && heightCm <= 172) size = 'L';
    else size = 'XL';

    if (availableSizes.length > 0 && !availableSizes.includes(size)) {
      const order = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
      const targetIdx = order.indexOf(size);
      const closest = availableSizes.reduce((prev, curr) =>
        Math.abs(order.indexOf(curr) - targetIdx) < Math.abs(order.indexOf(prev) - targetIdx) ? curr : prev
      );
      size = closest;
    }

    return {
      recommendedSize: size,
      fitAdvice: `Dựa trên số đo ${heightCm}cm · ${weightKg}kg (Bảng size Nữ), size ${size} giúp tôn dáng tự nhiên và thoải mái khi vận động.`,
      chartType: 'women',
    };
  }

  if (targetGender === 'unisex') {
    let size = 'M';
    if (weightKg < 56 && heightCm < 166) size = 'S';
    else if (weightKg <= 68 && heightCm <= 173) size = 'M';
    else if (weightKg <= 78 && heightCm <= 179) size = 'L';
    else size = 'XL';

    if (availableSizes.length > 0 && !availableSizes.includes(size)) {
      const order = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
      const targetIdx = order.indexOf(size);
      const closest = availableSizes.reduce((prev, curr) =>
        Math.abs(order.indexOf(curr) - targetIdx) < Math.abs(order.indexOf(prev) - targetIdx) ? curr : prev
      );
      size = closest;
    }

    return {
      recommendedSize: size,
      fitAdvice: `Phom Unisex thiết kế rộng suông (Relaxed Fit). Với ${heightCm}cm · ${weightKg}kg, size ${size} lên phom chuẩn thời thượng.`,
      chartType: 'unisex',
    };
  }

  // Nam (men)
  let size = 'L';
  if (weightKg < 58 && heightCm < 166) size = 'S';
  else if (weightKg <= 66 && heightCm <= 171) size = 'M';
  else if (weightKg <= 74 && heightCm <= 177) size = 'L';
  else if (weightKg <= 82 && heightCm <= 183) size = 'XL';
  else size = 'XXL';

  if (availableSizes.length > 0 && !availableSizes.includes(size)) {
    const order = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
    const targetIdx = order.indexOf(size);
    const closest = availableSizes.reduce((prev, curr) =>
      Math.abs(order.indexOf(curr) - targetIdx) < Math.abs(order.indexOf(prev) - targetIdx) ? curr : prev
    );
    size = closest;
  }

  return {
    recommendedSize: size,
    fitAdvice: `Dựa trên số đo ${heightCm}cm · ${weightKg}kg (Bảng size Nam), size ${size} vừa vặn phần vai và ngực.`,
    chartType: 'men',
  };
}

export interface RefundCalculationParams {
  itemUnitPrice: number;
  returnQty: number;
  orderSubtotal: number;
  orderDiscountAmount: number;
  orderTotalAmount: number;
  voucherDiscountType?: 'percent' | 'fixed' | 'free_shipping' | string | null;
  totalPreviouslyRefunded?: number;
  includeShippingFee?: boolean;
  shippingFee?: number;
}

export interface RefundCalculationResult {
  lineTotal: number;
  voucherProportion: number;
  refundAmount: number;
  maxAllowableRefund: number;
}

/**
 * Tính số tiền hoàn trả cho yêu cầu đổi trả / hoàn tiền.
 * Quy tắc kinh doanh chuẩn thương mại điện tử Baity:
 * 1. Hoàn một phần số lượng: lineTotal = itemUnitPrice * returnQty.
 * 2. Phân bổ chiết khấu voucher theo tỷ lệ giá trị:
 *    - Nếu voucher là 'free_shipping', phần giảm giá đó thuộc về phí vận chuyển, KHÔNG trừ vào tiền hoàn của sản phẩm (voucherProportion = 0).
 *    - Nếu voucher là 'percent' hoặc 'fixed', voucherProportion = ROUND((lineTotal / subtotal) * orderDiscountAmount).
 * 3. Làm tròn VNĐ: Sử dụng Math.round() đảm bảo số tiền là số nguyên VNĐ chính xác.
 * 4. Chính sách phí ship khi đổi trả: Mặc định không hoàn phí ship, trừ khi lý do thuộc lỗi cửa hàng (hàng lỗi, giao sai) và được bật includeShippingFee.
 * 5. Tổng các lần hoàn tiền tích lũy không bao giờ vượt quá số tiền khách đã thanh toán thực tế (orderTotalAmount).
 * 6. Số tiền hoàn do Server tính toán độc lập, hoàn toàn bỏ qua mọi giá trị do Client gửi lên.
 */
export function calculateRefundAmount(params: RefundCalculationParams): RefundCalculationResult {
  const {
    itemUnitPrice,
    returnQty,
    orderSubtotal,
    orderDiscountAmount,
    orderTotalAmount,
    voucherDiscountType = null,
    totalPreviouslyRefunded = 0,
    includeShippingFee = false,
    shippingFee = 0,
  } = params;

  const lineTotal = Math.max(0, Math.round(itemUnitPrice * returnQty));
  const subtotal = Math.max(orderSubtotal, 1);

  // Khi voucher là free_shipping, phần giảm thuộc phí vận chuyển, KHÔNG chia vào tiền hoàn của sản phẩm
  const isFreeShippingVoucher = voucherDiscountType === 'free_shipping';
  const productDiscountPool = isFreeShippingVoucher ? 0 : Math.max(0, orderDiscountAmount);

  // Tỷ lệ phân bổ voucher trên dòng sản phẩm được hoàn
  const voucherProportion = Math.round((lineTotal / subtotal) * productDiscountPool);

  // Số tiền hoàn lý thuyết cho dòng sản phẩm sau trừ chiết khấu voucher (cộng phí ship nếu được hoàn phí ship)
  const refundableShipping = includeShippingFee ? Math.max(0, Math.round(shippingFee)) : 0;
  const theoreticalRefund = Math.max(0, lineTotal - voucherProportion + refundableShipping);

  // Giới hạn trần hoàn tiền: không vượt quá số tiền còn lại có thể hoàn của đơn hàng
  const maxAllowableRefund = Math.max(0, orderTotalAmount - totalPreviouslyRefunded);
  const finalRefundAmount = Math.min(theoreticalRefund, maxAllowableRefund);

  return {
    lineTotal,
    voucherProportion,
    refundAmount: finalRefundAmount,
    maxAllowableRefund,
  };
}

export interface StoreShippingSettings {
  storeName: string;
  bannerText: string;
  freeShippingThreshold: number;
  standardShippingFee: number;
  defaultShippingFee: number;
  expressShippingFee: number;
  returnDaysLimit: number;
  previousReturnDaysLimit?: number;
  returnPolicyChangedAt?: string | null;
  lowStockThreshold: number;
}

/**
 * Đọc cấu hình vận chuyển, đổi trả và cảnh báo tồn kho động từ bảng store_settings
 * (ưu tiên khóa nhóm 'shipping', 'returns', 'inventory', 'contact', fallback sang 'general')
 */
export async function getStoreShippingSettings(
  runQuery: <R = any>(q: any) => Promise<R[]> = queryRows
): Promise<StoreShippingSettings> {
  const rows = await runQuery<{ key: string; value: any }>(sql`
    SELECT key, value FROM store_settings WHERE key IN ('general', 'contact', 'shipping', 'returns', 'inventory');
  `);
  const generalVal = rows.find((r) => r.key === 'general')?.value || {};
  const contactVal = rows.find((r) => r.key === 'contact')?.value || {};
  const shippingVal = rows.find((r) => r.key === 'shipping')?.value || {};
  const returnsVal = rows.find((r) => r.key === 'returns')?.value || {};
  const inventoryVal = rows.find((r) => r.key === 'inventory')?.value || {};

  const storeName = String(contactVal.storeName || generalVal.storeName || 'BAITY').trim();
  const bannerText = String(generalVal.bannerText || contactVal.bannerText || '').trim();

  const freeShippingThreshold =
    typeof shippingVal.freeShippingThreshold === 'number'
      ? shippingVal.freeShippingThreshold
      : typeof generalVal.freeShippingThreshold === 'number'
      ? generalVal.freeShippingThreshold
      : DEFAULT_SHIPPING_CONFIG.freeShippingThreshold;

  const defaultShippingFee =
    typeof shippingVal.standardShippingFee === 'number'
      ? shippingVal.standardShippingFee
      : typeof shippingVal.defaultShippingFee === 'number'
      ? shippingVal.defaultShippingFee
      : typeof generalVal.standardShippingFee === 'number'
      ? generalVal.standardShippingFee
      : typeof generalVal.defaultShippingFee === 'number'
      ? generalVal.defaultShippingFee
      : DEFAULT_SHIPPING_CONFIG.defaultShippingFee;

  const expressShippingFee =
    typeof shippingVal.expressShippingFee === 'number'
      ? shippingVal.expressShippingFee
      : typeof generalVal.expressShippingFee === 'number'
      ? generalVal.expressShippingFee
      : DEFAULT_SHIPPING_CONFIG.expressShippingFee;

  const returnDaysLimit =
    typeof returnsVal.returnDaysLimit === 'number'
      ? returnsVal.returnDaysLimit
      : typeof generalVal.returnDaysLimit === 'number'
      ? generalVal.returnDaysLimit
      : DEFAULT_SHIPPING_CONFIG.returnDaysLimit;

  const previousReturnDaysLimit =
    typeof returnsVal.previousReturnDaysLimit === 'number'
      ? returnsVal.previousReturnDaysLimit
      : DEFAULT_SHIPPING_CONFIG.returnDaysLimit;

  const returnPolicyChangedAt =
    typeof returnsVal.returnPolicyChangedAt === 'string'
      ? returnsVal.returnPolicyChangedAt
      : null;

  const lowStockThreshold =
    typeof inventoryVal.lowStockThreshold === 'number'
      ? inventoryVal.lowStockThreshold
      : typeof generalVal.lowStockThreshold === 'number'
      ? generalVal.lowStockThreshold
      : 5;

  return {
    storeName,
    bannerText,
    freeShippingThreshold,
    standardShippingFee: defaultShippingFee,
    defaultShippingFee,
    expressShippingFee,
    returnDaysLimit,
    previousReturnDaysLimit,
    returnPolicyChangedAt,
    lowStockThreshold,
  };
}


/**
 * Hàm dùng chung duy nhất tính phí vận chuyển chuẩn trên Server cho cả Giỏ hàng, Kiểm tra Voucher và Đặt hàng.
 * - Tuyệt đối không nhận shippingFee từ client.
 * - Ngưỡng miễn phí vận chuyển (freeShippingThreshold), phí tiêu chuẩn (defaultShippingFee)
 *   và phí hỏa tốc (expressShippingFee) đều đọc động từ bảng store_settings.
 */
export async function calculateServerShippingFee(
  shippingMethod: 'standard' | 'express',
  subtotalAfterProductPromos: number,
  runQuery: <R = any>(q: any) => Promise<R[]> = queryRows
): Promise<number> {
  const settings = await getStoreShippingSettings(runQuery);

  if (shippingMethod === 'express') {
    return settings.expressShippingFee;
  }

  if (subtotalAfterProductPromos >= settings.freeShippingThreshold) {
    return 0;
  }

  return settings.defaultShippingFee;
}
