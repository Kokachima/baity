import { z } from 'zod';

/**
 * HỢP ĐỒNG DỮ LIỆU DÙNG CHUNG GIỮA CLIENT VÀ SERVER (SHARED CONTRACTS)
 * Đảm bảo thống nhất tuyệt đối tên trường (camelCase), kiểu dữ liệu và cấu trúc lỗi API.
 */

// 1. Cấu trúc lỗi API thống nhất: { error: { code, message } }
export interface ApiErrorDetail {
  code: string;
  message: string;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  code?: string;
  error: ApiErrorDetail;
}

// 2. Hợp đồng Giỏ hàng (Cart)
export const cartAddRequestSchema = z.object({
  variantId: z.string().uuid('Mã biến thể sản phẩm (variantId) không đúng định dạng UUID'),
  quantity: z
    .number()
    .int('Số lượng phải là số nguyên')
    .min(1, 'Số lượng mỗi dòng sản phẩm phải từ 1 đến 10')
    .max(10, 'Số lượng tối đa cho mỗi sản phẩm trong giỏ là 10'),
  lastKnownPrice: z.number().nonnegative().optional(),
});

export const cartUpdateQuantitySchema = z.object({
  quantity: z
    .number()
    .int('Số lượng phải là số nguyên')
    .min(1, 'Số lượng mỗi dòng sản phẩm phải từ 1 đến 10')
    .max(10, 'Số lượng tối đa cho mỗi sản phẩm trong giỏ là 10'),
});

export type CartAddRequest = z.infer<typeof cartAddRequestSchema>;
export type CartUpdateQuantityRequest = z.infer<typeof cartUpdateQuantitySchema>;

export interface SharedCartItem {
  id: string;
  cartItemId: string;
  variantId: string;
  productId: string;
  productName: string;
  slug: string;
  color: string;
  colorCode: string;
  size: string;
  sku: string;
  quantity: number;
  stockQuantity: number;
  basePrice: number;
  initialPrice: number;
  discountPercent: number;
  promotionTitle: string | null;
  effectivePrice: number;
  lineTotal: number;
  imageUrl: string | null;
  outOfStock: boolean;
  insufficientStock: boolean;
  priceChanged: boolean;
}

export interface SharedCartData {
  items: SharedCartItem[];
  itemCount: number;
  totalQuantity: number;
  subtotal: number;
  shippingFee: number;
  freeShippingThreshold: number;
  amountToFreeShipping: number;
  hasOutOfStock: boolean;
  hasInsufficientStock: boolean;
  hasPriceChanged: boolean;
}

// 3. Hợp đồng Kiểm tra Mã giảm giá (Voucher Validate)
export const voucherValidateRequestSchema = z.object({
  code: z.string().trim().min(1, 'Vui lòng nhập mã giảm giá'),
  shippingMethod: z.enum(['standard', 'express']).optional().default('standard'),
  shippingFee: z.number().nonnegative().optional(),
  subtotal: z.number().nonnegative().optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        quantity: z.number().int().min(1).max(10),
      })
    )
    .optional(),
});

export type VoucherValidateRequest = z.infer<typeof voucherValidateRequestSchema>;

export interface SharedVoucherValidationResult {
  code: string;
  discountType: 'percent' | 'fixed' | 'free_shipping';
  discountValue: number;
  maxDiscount: number | null;
  minOrderValue: number;
  subtotal: number;
  shippingFee: number;
  discountAmount: number;
  finalTotal: number;
}

// 4. Hợp đồng Đặt hàng (Create Order)
export const createOrderRequestSchema = z.object({
  items: z
    .array(
      z.object({
        variantId: z.string().uuid('Mã biến thể sản phẩm không hợp lệ'),
        quantity: z.number().int().min(1).max(10),
      })
    )
    .optional(),
  receiverName: z.string().trim().min(2, 'Họ tên người nhận phải có ít nhất 2 ký tự').max(100),
  receiverPhone: z
    .string()
    .trim()
    .regex(/^(0|\+84)[0-9]{8,10}$/, 'Số điện thoại người nhận không đúng định dạng Việt Nam'),
  shippingAddress: z.string().trim().min(5, 'Vui lòng cung cấp địa chỉ giao hàng đầy đủ'),
  shippingMethod: z.enum(['standard', 'express']).optional().default('standard'),
  paymentMethod: z.enum(['cod', 'vietqr']).optional().default('cod'),
  voucherCode: z.string().trim().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

// 5. Hợp đồng Địa chỉ giao hàng 2 cấp (Tỉnh/Thành phố + Phường/Xã; district nullable)
export const sharedAddressSchema = z.object({
  receiverName: z.string().trim().min(2, 'Tên người nhận phải có ít nhất 2 ký tự').max(100),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s()]{9,15}$/, 'Số điện thoại không hợp lệ'),
  province: z.string().trim().min(1, 'Vui lòng chọn Tỉnh/Thành phố'),
  district: z.string().trim().nullable().optional(),
  ward: z.string().trim().min(1, 'Vui lòng chọn Phường/Xã'),
  streetAddress: z.string().trim().min(5, 'Địa chỉ chi tiết phải có ít nhất 5 ký tự'),
  isDefault: z.boolean().optional(),
});

export type SharedAddressInput = z.infer<typeof sharedAddressSchema>;

// 6. Hằng số trạng thái thanh toán thống nhất (Payment Status Single Source of Truth)
export const PAYMENT_STATUSES = [
  'pending',
  'paid',
  'failed',
  'refunded',
  'refund_needed',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  REFUND_NEEDED: 'refund_needed',
} as const;

export const MISSING_CONTACT_INFO_TEXT = 'Cửa hàng chưa cập nhật thông tin liên hệ';

export const DEFAULT_SHIPPING_CONFIG = {
  defaultShippingFee: 30000,
  expressShippingFee: 45000,
  freeShippingThreshold: 499000,
  returnDaysLimit: 7,
} as const;

// 7. Hợp đồng Giai đoạn 8b: Danh mục, Sản phẩm, Biến thể & Điều chỉnh Tồn kho
export const STOCK_ADJUST_REASONS = [
  'manual_import',
  'inventory_audit',
  'damaged',
  'other',
] as const;

export type StockAdjustReason = (typeof STOCK_ADJUST_REASONS)[number];

export const adminCategoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Tên danh mục không được để trống').max(100, 'Tên danh mục tối đa 100 ký tự'),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug danh mục chỉ gồm chữ thường, chữ số và dấu gạch ngang')
    .max(120)
    .optional(),
  parentId: z.string().uuid('Mã danh mục cha (parentId) phải là UUID hợp lệ').nullable().optional(),
  displayOrder: z.number().int('Thứ tự hiển thị phải là số nguyên').min(0).max(10000).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const adminProductVariantInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    colorName: z.string().trim().max(60).optional(),
    color: z.string().trim().max(60).optional(),
    colorCode: z
      .string()
      .trim()
      .regex(
        /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/,
        'Mã màu (colorCode) phải đúng định dạng mã màu hex (#RGB hoặc #RRGGBB)'
      )
      .optional(),
    colorHex: z
      .string()
      .trim()
      .regex(
        /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/,
        'Mã màu (colorHex) phải đúng định dạng mã màu hex (#RGB hoặc #RRGGBB)'
      )
      .optional(),
    size: z.string().trim().min(1, 'Kích cỡ (size) không được để trống').max(30),
    sku: z
      .string()
      .trim()
      .min(2, 'Mã SKU phải có ít nhất 2 ký tự')
      .max(80, 'Mã SKU tối đa 80 ký tự')
      .regex(/^[A-Za-z0-9._-]+$/, 'Mã SKU chỉ gồm chữ, số, dấu chấm, gạch dưới hoặc gạch ngang'),
    priceOverride: z
      .number()
      .int('Giá riêng biến thể phải là số nguyên')
      .min(0, 'Giá riêng biến thể phải là số nguyên không âm (>= 0)')
      .nullable()
      .optional(),
    stockQuantity: z
      .number()
      .int('Tồn kho phải là số nguyên')
      .min(0, 'Tồn kho biến thể phải là số nguyên không âm (>= 0)')
      .optional()
      .default(0),
  })
  .refine((v) => Boolean((v.colorName && v.colorName.trim()) || (v.color && v.color.trim())), {
    message: 'Tên màu không được để trống',
  })
  .transform((v) => ({
    id: v.id,
    colorName: (v.colorName || v.color || '').trim(),
    colorCode: (v.colorCode || v.colorHex || '#1A1C19').trim(),
    size: v.size.trim(),
    sku: v.sku.trim(),
    priceOverride: v.priceOverride ?? null,
    stockQuantity: v.stockQuantity ?? 0,
  }));

export const adminProductImageInputSchema = z
  .object({
    imageUrl: z.string().trim().optional(),
    url: z.string().trim().optional(),
    altText: z.string().trim().optional(),
    objectPath: z.string().trim().optional(),
    isPrimary: z.boolean().optional().default(false),
    displayOrder: z.number().int().min(0).max(100).optional().default(0),
  })
  .refine(
    (img) =>
      Boolean(
        (img.imageUrl && img.imageUrl.trim()) ||
          (img.url && img.url.trim()) ||
          (img.objectPath && img.objectPath.trim())
      ),
    {
      message: 'Đường dẫn ảnh sản phẩm không được để trống',
    }
  )
  .transform((img) => {
    const rawPath = (img.objectPath || img.imageUrl || img.url || '').trim();
    const rawUrl = (img.imageUrl || img.url || img.objectPath || '').trim();
    return {
      imageUrl: rawUrl,
      objectPath: img.objectPath ? img.objectPath.trim() : rawPath,
      isPrimary: Boolean(img.isPrimary),
      displayOrder: img.displayOrder ?? 0,
    };
  });

export const adminProductAttributeInputSchema = z
  .object({
    key: z.string().trim().max(60).optional(),
    name: z.string().trim().max(60).optional(),
    value: z.string().trim().min(1).max(120),
  })
  .refine((a) => Boolean((a.key && a.key.trim()) || (a.name && a.name.trim())), {
    message: 'Tên thuộc tính không được để trống',
  })
  .transform((a) => ({
    key: (a.key || a.name || '').trim(),
    value: a.value.trim(),
  }));

export const adminProductInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Tên sản phẩm phải có ít nhất 2 ký tự')
      .max(200, 'Tên sản phẩm tối đa 200 ký tự'),
    slug: z
      .string()
      .trim()
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'Slug sản phẩm chỉ gồm chữ thường, chữ số và dấu gạch ngang'
      )
      .max(200)
      .optional(),
    categoryId: z.string().uuid('Mã danh mục (categoryId) không hợp lệ'),
    targetGender: z
      .enum(['men', 'women', 'unisex'], {
        message: 'Đối tượng (targetGender) chỉ chấp nhận men, women hoặc unisex',
      })
      .optional()
      .default('unisex'),
    basePrice: z
      .number()
      .int('Giá gốc phải là số nguyên')
      .min(0, 'Giá gốc (basePrice) phải là số nguyên không âm (>= 0)'),
    salePrice: z
      .number()
      .int('Giá khuyến mãi phải là số nguyên')
      .min(0, 'Giá khuyến mãi phải là số nguyên không âm (>= 0)')
      .nullable()
      .optional(),
    description: z
      .string()
      .trim()
      .max(10000)
      .optional()
      .default('Thiết kế tối giản chuẩn mực'),
    material: z.string().trim().max(500).optional().default('Cotton cao cấp'),
    careInstructions: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .default('Giặt nhẹ ở nhiệt độ thường'),
    isActive: z.boolean().optional().default(true),
    images: z
      .array(adminProductImageInputSchema)
      .max(8, 'Mỗi sản phẩm tối đa 8 hình ảnh')
      .optional()
      .default([]),
    variants: z
      .array(adminProductVariantInputSchema)
      .min(1, 'Sản phẩm phải có ít nhất 1 biến thể (màu sắc / kích cỡ)')
      .max(100),
    attributes: z.array(adminProductAttributeInputSchema).max(30).optional().default([]),
    updatedAt: z.string().trim().optional(),
    expectedUpdatedAt: z.string().trim().optional(),
  })
  .refine(
    (d) => d.salePrice === undefined || d.salePrice === null || d.salePrice <= d.basePrice,
    {
      message: 'Giá khuyến mãi (salePrice) không được lớn hơn giá gốc (basePrice)',
    }
  );

export const adminStockAdjustSchema = z
  .object({
    delta: z
      .number()
      .int('Số lượng điều chỉnh (delta) phải là số nguyên')
      .refine((v) => v !== 0, 'Số lượng điều chỉnh (delta) phải khác 0'),
    reason: z.enum(STOCK_ADJUST_REASONS, {
      message: 'Lý do điều chỉnh kho chỉ chấp nhận: manual_import, inventory_audit, damaged, other',
    }),
    note: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.reason !== 'other' || Boolean(d.note && d.note.trim().length > 0), {
    message: 'Bắt buộc nhập ghi chú (note) khi lý do điều chỉnh kho là "other"',
  });

// ==========================================
// 8. HỢP ĐỒNG GIAI ĐOẠN 8C: VOUCHER, KHUYẾN MÃI, CÀI ĐẶT CỬA HÀNG, CHÍNH SÁCH & FAQ
// ==========================================

/**
 * Chuyển chuỗi ngày giờ từ form Admin (mặc định hiểu là múi giờ Việt Nam GMT+7 nếu không có hậu tố múi giờ Z / +HH:MM)
 * sang đối tượng Date chuẩn UTC.
 */
export function parseGmt7InputToUtcDate(raw: string | Date): Date | null {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Nếu chuỗi đã có chỉ định múi giờ (Z hoặc +07:00 / -05:00 ở cuối)
  if (/([Zz]|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Nếu chuỗi dạng YYYY-MM-DD (không có giờ) -> coi là 00:00:00 GMT+7
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(`${trimmed}T00:00:00+07:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Nếu chuỗi dạng YYYY-MM-DDTHH:mm hoặc YYYY-MM-DDTHH:mm:ss (từ <input type="datetime-local">) -> gắn +07:00
  const normalizedIso = trimmed.replace(' ', 'T');
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalizedIso)
    ? `${normalizedIso}:00+07:00`
    : `${normalizedIso}+07:00`;
  const d = new Date(withSeconds);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const adminVoucherInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .transform((val) => val.toUpperCase())
      .refine(
        (val) => val.length >= 3 && val.length <= 32 && /^[A-Z0-9_-]+$/.test(val),
        'Mã voucher phải dài từ 3 đến 32 ký tự và chỉ gồm chữ in hoa A–Z, chữ số 0–9, dấu gạch ngang (-) hoặc gạch dưới (_)'
      ),
    description: z
      .string()
      .trim()
      .max(200, 'Mô tả voucher tối đa 200 ký tự')
      .optional()
      .default(''),
    discountType: z.enum(['percent', 'fixed', 'free_shipping'], {
      message: 'Loại giảm giá chỉ chấp nhận: percent, fixed, hoặc free_shipping',
    }),
    discountValue: z
      .number()
      .int('Giá trị giảm phải là số nguyên')
      .min(0, 'Giá trị giảm không được âm')
      .optional()
      .default(0),
    maxDiscount: z
      .number()
      .int('Mức giảm tối đa phải là số nguyên')
      .positive('Mức giảm tối đa (maxDiscount) phải lớn hơn 0')
      .nullable()
      .optional()
      .default(null),
    minOrderValue: z
      .number()
      .int('Giá trị đơn tối thiểu phải là số nguyên')
      .min(0, 'Giá trị đơn hàng tối thiểu phải >= 0')
      .optional()
      .default(0),
    usageLimit: z
      .number()
      .int('Tổng lượt dùng phải là số nguyên')
      .min(1, 'Tổng lượt dùng tối đa phải >= 1 (hoặc để trống / null cho không giới hạn)')
      .nullable()
      .optional()
      .default(null),
    perUserLimit: z
      .number()
      .int('Giới hạn mỗi người dùng phải là số nguyên')
      .min(1, 'Giới hạn mỗi tài khoản (perUserLimit) phải >= 1')
      .optional()
      .default(1),
    applicableCategoryId: z
      .string()
      .uuid('Danh mục áp dụng phải là UUID hợp lệ')
      .nullable()
      .optional()
      .default(null),
    startDate: z.string().trim().min(1, 'Vui lòng chọn thời điểm bắt đầu'),
    endDate: z.string().trim().min(1, 'Vui lòng chọn thời điểm kết thúc'),
    isActive: z.boolean().optional().default(true),
    updatedAt: z.string().trim().optional(),
    expectedUpdatedAt: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.discountType === 'percent') {
      if (data.discountValue < 1 || data.discountValue > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['discountValue'],
          message: 'Voucher giảm theo phần trăm (percent) phải có giá trị từ 1 đến 100%',
        });
      }
    } else if (data.discountType === 'fixed') {
      if (data.discountValue <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['discountValue'],
          message: 'Voucher giảm tiền cố định (fixed) phải có giá trị lớn hơn 0',
        });
      }
    }

    const start = parseGmt7InputToUtcDate(data.startDate);
    const end = parseGmt7InputToUtcDate(data.endDate);
    if (!start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startDate'],
        message: 'Thời điểm bắt đầu không hợp lệ',
      });
    }
    if (!end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'Thời điểm kết thúc không hợp lệ',
      });
    }
    if (start && end && start.getTime() >= end.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'Thời điểm bắt đầu (startDate) phải nhỏ hơn thời điểm kết thúc (endDate)',
      });
    }
  });

export const adminPromotionTargetInputSchema = z.object({
  targetType: z.enum(['product', 'category'], {
    message: 'Loại mục tiêu khuyến mãi chỉ chấp nhận product hoặc category',
  }),
  targetId: z.string().uuid('Mã mục tiêu (targetId) phải là UUID hợp lệ'),
  discountPercent: z
    .number()
    .int('Phần trăm giảm giá phải là số nguyên')
    .min(1, 'Phần trăm giảm giá phải từ 1% đến 80%')
    .max(80, 'Phần trăm giảm giá tối đa là 80%'),
});

export const MAX_PROMOTION_DURATION_DAYS = 90;

export const adminPromotionInputSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(2, 'Tiêu đề chương trình khuyến mãi phải có ít nhất 2 ký tự')
      .max(120, 'Tiêu đề chương trình khuyến mãi tối đa 120 ký tự'),
    startTime: z.string().trim().min(1, 'Vui lòng nhập thời điểm bắt đầu'),
    endTime: z.string().trim().min(1, 'Vui lòng nhập thời điểm kết thúc'),
    isActive: z.boolean().optional().default(true),
    targets: z
      .array(adminPromotionTargetInputSchema)
      .min(1, 'Chương trình khuyến mãi phải có ít nhất 1 mục tiêu (sản phẩm hoặc danh mục)')
      .max(100, 'Tối đa 100 mục tiêu trong một chương trình khuyến mãi'),
    updatedAt: z.string().trim().optional(),
    expectedUpdatedAt: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    const start = parseGmt7InputToUtcDate(data.startTime);
    const end = parseGmt7InputToUtcDate(data.endTime);
    if (!start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startTime'],
        message: 'Thời điểm bắt đầu (startTime) không hợp lệ',
      });
    }
    if (!end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endTime'],
        message: 'Thời điểm kết thúc (endTime) không hợp lệ',
      });
    }
    if (start && end) {
      if (start.getTime() >= end.getTime()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endTime'],
          message: 'Thời điểm bắt đầu (startTime) phải nhỏ hơn thời điểm kết thúc (endTime)',
        });
      }
      const maxDurationMs = MAX_PROMOTION_DURATION_DAYS * 24 * 60 * 60 * 1000;
      if (end.getTime() - start.getTime() > maxDurationMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endTime'],
          message: `Thời lượng chương trình khuyến mãi không được vượt quá ${MAX_PROMOTION_DURATION_DAYS} ngày`,
        });
      }
    }

    const seenTargets = new Set<string>();
    for (let i = 0; i < data.targets.length; i++) {
      const t = data.targets[i];
      const key = `${t.targetType}:${t.targetId.toLowerCase()}`;
      if (seenTargets.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['targets', i, 'targetId'],
          message: `Mục tiêu khuyến mãi bị trùng lặp (${t.targetType}: ${t.targetId}) trong cùng chương trình`,
        });
      }
      seenTargets.add(key);
    }
  });

export const adminPromotionPreviewSchema = z
  .object({
    targets: z
      .array(adminPromotionTargetInputSchema)
      .min(1, 'Chương trình khuyến mãi phải có ít nhất 1 mục tiêu (sản phẩm hoặc danh mục)')
      .max(100, 'Tối đa 100 mục tiêu trong một chương trình khuyến mãi'),
  })
  .superRefine((data, ctx) => {
    const seenTargets = new Set<string>();
    for (let i = 0; i < data.targets.length; i++) {
      const t = data.targets[i];
      const key = `${t.targetType}:${t.targetId.toLowerCase()}`;
      if (seenTargets.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['targets', i, 'targetId'],
          message: `Mục tiêu khuyến mãi bị trùng lặp (${t.targetType}: ${t.targetId}) trong cùng chương trình`,
        });
      }
      seenTargets.add(key);
    }
  });

export const adminStoreSettingsContactSchema = z.object({
  storeName: z
    .string()
    .trim()
    .min(1, 'Tên cửa hàng không được để trống')
    .max(80, 'Tên cửa hàng tối đa 80 ký tự'),
  hotline: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^(0|\+84)[0-9]{8,10}$|^1[89]00[0-9]{4,6}$/.test(v),
      'Hotline không đúng định dạng số điện thoại Việt Nam (ví dụ: 0912345678, +84912345678 hoặc 1900xxxx)'
    )
    .optional()
    .default(''),
  email: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'Địa chỉ email liên hệ không hợp lệ'
    )
    .optional()
    .default(''),
  address: z.string().trim().max(200, 'Địa chỉ cửa hàng tối đa 200 ký tự').optional().default(''),
  workingHours: z.string().trim().max(100, 'Giờ làm việc tối đa 100 ký tự').optional().default(''),
  legalEntityName: z
    .string()
    .trim()
    .max(150, 'Tên pháp nhân / hộ kinh doanh tối đa 150 ký tự')
    .optional()
    .default(''),
  taxId: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^[0-9]{10}([0-9]{3})?$/.test(v),
      'Mã số thuế phải gồm đúng 10 hoặc 13 chữ số'
    )
    .optional()
    .default(''),
  returnAddress: z
    .string()
    .trim()
    .max(200, 'Địa chỉ nhận hàng hoàn trả tối đa 200 ký tự')
    .optional()
    .default(''),
  bannerText: z
    .string()
    .trim()
    .max(120, 'Nội dung thanh thông báo đầu trang (bannerText) tối đa 120 ký tự')
    .optional()
    .default(''),
});

export const adminStoreSettingsShippingSchema = z
  .preprocess((raw: any) => {
    if (raw && typeof raw === 'object') {
      const std = raw.standardShippingFee ?? raw.defaultShippingFee;
      return {
        ...raw,
        standardShippingFee: std,
        defaultShippingFee: std,
      };
    }
    return raw;
  }, z.object({
    standardShippingFee: z
      .number()
      .int('Phí giao hàng tiêu chuẩn phải là số nguyên')
      .min(0, 'Phí giao hàng tiêu chuẩn phải từ 0 đến 500.000₫')
      .max(500000, 'Phí giao hàng tiêu chuẩn tối đa 500.000₫'),
    defaultShippingFee: z
      .number()
      .int('Phí giao hàng tiêu chuẩn phải là số nguyên')
      .min(0, 'Phí giao hàng tiêu chuẩn phải từ 0 đến 500.000₫')
      .max(500000, 'Phí giao hàng tiêu chuẩn tối đa 500.000₫'),
    expressShippingFee: z
      .number()
      .int('Phí giao hàng hỏa tốc phải là số nguyên')
      .min(0, 'Phí giao hàng hỏa tốc phải từ 0 đến 500.000₫')
      .max(500000, 'Phí giao hàng hỏa tốc tối đa 500.000₫'),
    freeShippingThreshold: z
      .number()
      .int('Ngưỡng miễn phí vận chuyển phải là số nguyên')
      .min(0, 'Ngưỡng miễn phí vận chuyển phải từ 0 đến 10.000.000₫')
      .max(10000000, 'Ngưỡng miễn phí vận chuyển tối đa 10.000.000₫'),
  }));

export const adminStoreSettingsReturnsSchema = z.object({
  returnDaysLimit: z
    .number()
    .int('Số ngày đổi trả phải là số nguyên')
    .min(1, 'Thời hạn đổi trả phải từ 1 đến 30 ngày')
    .max(30, 'Thời hạn đổi trả tối đa 30 ngày'),
  returnAddress: z
    .string()
    .trim()
    .max(200, 'Địa chỉ nhận hàng hoàn trả tối đa 200 ký tự')
    .optional()
    .default(''),
});

export const adminStoreSettingsInventorySchema = z.object({
  lowStockThreshold: z
    .number()
    .int('Ngưỡng cảnh báo sắp hết hàng phải là số nguyên')
    .min(0, 'Ngưỡng cảnh báo sắp hết hàng phải từ 0 đến 1.000')
    .max(1000, 'Ngưỡng cảnh báo sắp hết hàng tối đa 1.000'),
});

export const adminStoreSettingsUpdateSchema = z.object({
  contact: adminStoreSettingsContactSchema,
  shipping: adminStoreSettingsShippingSchema,
  returns: adminStoreSettingsReturnsSchema,
  inventory: adminStoreSettingsInventorySchema,
  bannerText: z
    .string()
    .trim()
    .max(120, 'Nội dung thanh thông báo đầu trang tối đa 120 ký tự')
    .nullable()
    .optional(),
  updatedAt: z.string().trim().optional(),
  expectedUpdatedAt: z.string().trim().optional(),
});

export const ALLOWED_FAQ_TOPICS = [
  'Chọn kích cỡ & Sản phẩm',
  'Vận chuyển & Theo dõi đơn hàng',
  'Thanh toán & VietQR',
  'Mã giảm giá (Voucher) & Giỏ hàng',
  'Hủy đơn, Đổi trả & Đánh giá sản phẩm',
  'Câu hỏi chung',
] as const;

export const ALLOWED_POLICY_TEMPLATE_VARIABLES = [
  'store_name',
  'storeName',
  'store_phone',
  'phone',
  'hotline',
  'store_email',
  'email',
  'store_address',
  'address',
  'return_address',
  'returnAddress',
  'working_hours',
  'workingHours',
  'store_contact_channels',
  'vietqr_bank_name',
  'shipping_fee_standard',
  'default_shipping_fee',
  'defaultShippingFee',
  'shipping_fee_standard_raw',
  'shipping_fee_express',
  'express_shipping_fee',
  'expressShippingFee',
  'shipping_fee_express_raw',
  'free_shipping_threshold',
  'freeShippingThreshold',
  'free_shipping_threshold_raw',
  'return_window_days',
  'return_days',
  'return_days_limit',
  'returnDaysLimit',
  'payment_timeout_minutes',
  'order_payment_timeout_minutes',
  'max_pending_online_orders',
  'cart_max_qty_per_item',
  'cart_max_distinct_items',
  'max_upload_size_mb',
  'max_review_images',
  'max_return_proof_images',
  'signed_url_expires_minutes',
  'voucher_validate_max_attempts',
  'voucher_validate_window_minutes',
  'chatbot_counter_retention_days',
  'visual_search_log_retention_days',
  'seller_chat_retention_days',
] as const;

export function findUnknownPolicyTemplateVariables(text: string): string[] {
  const allowedSet = new Set<string>(ALLOWED_POLICY_TEMPLATE_VARIABLES);
  const unknown = new Set<string>();
  const regex = /\{\{\s*([^}]*?)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text || '')) !== null) {
    const varName = match[1].trim();
    if (!varName || !allowedSet.has(varName)) {
      unknown.add(varName || '(rỗng)');
    }
  }
  return Array.from(unknown);
}

export const adminPolicyUpdateSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(2, 'Tiêu đề chính sách phải có ít nhất 2 ký tự')
      .max(150, 'Tiêu đề chính sách tối đa 150 ký tự'),
    content: z
      .string()
      .trim()
      .min(10, 'Nội dung chính sách phải có ít nhất 10 ký tự')
      .max(20000, 'Nội dung chính sách tối đa 20.000 ký tự'),
    updatedAt: z.string().trim().optional(),
    expectedUpdatedAt: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    const unknownInTitle = findUnknownPolicyTemplateVariables(data.title);
    const unknownInContent = findUnknownPolicyTemplateVariables(data.content);
    const allUnknown = Array.from(new Set([...unknownInTitle, ...unknownInContent]));
    if (allUnknown.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: `Biến mẫu không nằm trong danh sách cho phép: ${allUnknown
          .map((v) => `{{${v}}}`)
          .join(', ')}`,
      });
    }
  });

export const adminFaqInputSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, 'Câu hỏi (title) phải có ít nhất 3 ký tự')
      .max(150, 'Câu hỏi (title) tối đa 150 ký tự'),
    topic: z.enum(ALLOWED_FAQ_TOPICS, {
      message: `Chủ đề FAQ phải thuộc một trong các chủ đề: ${ALLOWED_FAQ_TOPICS.join(', ')}`,
    }),
    content: z
      .string()
      .trim()
      .min(5, 'Nội dung câu trả lời phải có ít nhất 5 ký tự')
      .max(20000, 'Nội dung câu trả lời tối đa 20.000 ký tự'),
    displayOrder: z.number().int().min(0).max(10000).optional().default(50),
    isActive: z.boolean().optional().default(true),
    updatedAt: z.string().trim().optional(),
    expectedUpdatedAt: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    const unknownInTitle = findUnknownPolicyTemplateVariables(data.title);
    const unknownInContent = findUnknownPolicyTemplateVariables(data.content);
    const allUnknown = Array.from(new Set([...unknownInTitle, ...unknownInContent]));
    if (allUnknown.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: `Biến mẫu không nằm trong danh sách cho phép: ${allUnknown
          .map((v) => `{{${v}}}`)
          .join(', ')}`,
      });
    }
  });

// ==========================================
// 9. HỢP ĐỒNG GIAI ĐOẠN 6D: CHAT VỚI NGƯỜI BÁN (HỎI ĐÁP)
// ==========================================

export const SELLER_CHAT_MESSAGE_MAX_LENGTH = 1000;
export const SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION = 500;
export const SELLER_CHAT_RATE_LIMIT_MAX_MESSAGES = 20;
export const SELLER_CHAT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 phút
export const SELLER_CHAT_RETENTION_DAYS = 180;
export const SELLER_CHAT_SENSITIVE_WARNING_TEXT =
  'Lưu ý bảo mật: Tuyệt đối không nhập mật khẩu, mã OTP, số thẻ ngân hàng, mã CVV hoặc số CCCD trong khung chat.';
