export type TargetGender = 'men' | 'women' | 'unisex';

export type SortOption = 'newest' | 'bestseller' | 'price_asc' | 'price_desc' | 'rating' | 'relevance';

export interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id?: string | null;
  display_order: number;
}

export interface ColorSwatch {
  color_name: string;
  color_code: string;
}

export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  target_gender: TargetGender;
  base_price: number;
  initial_price?: number;
  effective_price?: number;
  max_effective_price?: number;
  discount_percent?: number;
  promotion_title?: string | null;
  is_on_sale?: boolean;
  category_id?: string;
  category_name: string;
  category_slug: string;
  primary_image: string;
  colors: ColorSwatch[];
  sizes?: string[];
  total_stock: number;
  rating_avg?: number;
  review_count?: number;
  sold_count?: number;
}

export interface ProductVariantDetail {
  id: string;
  sku: string;
  colorName: string;
  colorCode: string;
  size: string;
  stockQuantity: number;
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock';
  stockLabel: string;
  isAvailable: boolean;
  priceOverride: number | null;
  basePrice: number;
  initialPrice: number;
  effectivePrice: number;
  discountPercent: number;
  isOnSale: boolean;
}

export interface ProductImageDetail {
  id: string;
  imageUrl: string;
  isPrimary: boolean;
  displayOrder: number;
}

export interface ProductReviewItem {
  id: string;
  rating: number;
  comment: string;
  sellerReply?: string | null;
  sellerRepliedAt?: string | null;
  createdAt: string;
  userName: string;
  userAvatar?: string | null;
}

export interface SizeRecommendation {
  recommendedSize: string;
  fitAdvice: string;
  chartType: 'men' | 'women' | 'unisex' | 'pants';
}

export interface ProductDetail {
  id: string;
  name: string;
  slug: string;
  targetGender: TargetGender;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  description: string;
  material: string;
  careInstructions: string;
  basePrice: number;
  initialPrice: number;
  effectivePrice: number;
  maxEffectivePrice: number;
  discountPercent: number;
  isOnSale: boolean;
  activePromotion?: {
    id: string;
    title: string;
    discountPercent: number;
    startTime: string;
    endTime: string;
  } | null;
  totalStock: number;
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock';
  ratingAvg: number;
  reviewCount: number;
  images: ProductImageDetail[];
  colors: { colorName: string; colorCode: string; hasStock: boolean }[];
  sizes: string[];
  variants: ProductVariantDetail[];
  attributes: { key: string; value: string }[];
  reviews: ProductReviewItem[];
  sizeChart: {
    type: string;
    targetGender: TargetGender;
    rows: any[];
    genderChart: any[];
    pantsChart?: any[];
    allCharts?: Record<string, any[]>;
  };
  sizeRecommendation?: SizeRecommendation | null;
  relatedProducts: ProductSummary[];
}

export interface ProductFilterState {
  q: string;
  gender: TargetGender | 'all';
  includeUnisex: boolean;
  category: string;
  minPrice: string;
  maxPrice: string;
  size: string;
  color: string;
  onSale: boolean;
  inStock: boolean;
  minRating: string;
  sort: SortOption;
  page: number;
  pageSize: number;
}

export interface User {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: 'customer' | 'admin';
  avatarUrl?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
}

export interface Address {
  id: string;
  receiverName: string;
  phone: string;
  province: string;
  district?: string | null;
  ward: string;
  streetAddress: string;
  isDefault: boolean;
  createdAt?: string;
}

export interface CartItemState {
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
  isOutOfStock: boolean;
  exceedsStock: boolean;
}

export interface CartSummaryState {
  totalItems: number;
  distinctItems: number;
  subtotal: number;
  estimatedShippingFee: number;
  freeShippingThreshold: number;
  estimatedTotal: number;
}

export interface AvailableVoucher {
  id: string;
  code: string;
  discountType: 'percent' | 'fixed' | 'free_shipping';
  discountValue: number;
  maxDiscount: number | null;
  minOrderValue: number;
  usageLimit: number;
  perUserLimit: number;
  usedCount: number;
  userUsedCount: number;
  applicableCategoryId: string | null;
  applicableCategoryName?: string | null;
  startDate: string;
  endDate: string;
  isEligible: boolean;
  estimatedDiscount: number;
  ineligibleReason?: string | null;
}

export interface VietQRInfo {
  bankId: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  amount: number;
  transferContent: string;
  qrImageUrl: string;
  expiresAt: string;
}

export interface OrderRecord {
  id: string;
  orderId: string;
  userId: string;
  receiverName: string;
  receiverPhone: string;
  shippingAddress: string;
  shippingMethod: string;
  shippingFee: number;
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  status: string;
  cancelReason?: string | null;
  trackingCode?: string | null;
  deliveredAt?: string | null;
  completedAt?: string | null;
  paymentMethod: string;
  paymentStatus: string;
  transactionId?: string | null;
  paidAt?: string | null;
  createdAt: string;
  items: {
    id?: string;
    variantId: string;
    productName: string;
    color: string;
    size: string;
    unitPrice: number;
    quantity: number;
    totalPrice: number;
    imageUrl?: string;
    productSlug?: string;
  }[];
  statusHistory?: {
    id: string;
    status: string;
    note: string;
    changedBy: string;
    createdAt: string;
  }[];
  vietqr?: VietQRInfo | null;
}

