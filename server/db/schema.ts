import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  uuid,
  jsonb,
  check,
  unique,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ==========================================
// 1. NGƯỜI DÙNG & TÀI KHOẢN (users)
// ==========================================
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fullName: text('full_name').notNull(),
    email: text('email').notNull().unique(),
    phone: text('phone').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['customer', 'admin'] }).default('customer').notNull(),
    avatarUrl: text('avatar_url'),
    heightCm: integer('height_cm'),
    weightKg: integer('weight_kg'),
    resetTokenHash: text('reset_token_hash'),
    resetTokenExpiry: timestamp('reset_token_expiry', { withTimezone: true }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('idx_users_lower_email').on(sql`LOWER(${table.email})`),
    index('idx_users_created_at').on(table.createdAt),
  ]
);

// ==========================================
// 2. SỔ ĐỊA CHỈ (addresses)
// ==========================================
export const addresses = pgTable(
  'addresses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    receiverName: text('receiver_name').notNull(),
    phone: text('phone').notNull(),
    province: text('province').notNull(),
    district: text('district'),
    ward: text('ward').notNull(),
    streetAddress: text('street_address').notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_addresses_user_id').on(table.userId),
    uniqueIndex('idx_addresses_single_default')
      .on(table.userId)
      .where(sql`${table.isDefault} = true`),
  ]
);

// ==========================================
// 3. DANH MỤC SẢN PHẨM (categories)
// ==========================================
export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  parentId: uuid('parent_id'),
  displayOrder: integer('display_order').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
});

// ==========================================
// 4. SẢN PHẨM (products)
// ==========================================
export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'restrict' }).notNull(),
    targetGender: text('target_gender', { enum: ['men', 'women', 'unisex'] }).notNull(),
    description: text('description').notNull(),
    material: text('material').notNull(),
    careInstructions: text('care_instructions').notNull(),
    basePrice: integer('base_price').notNull(), // Lưu theo VNĐ
    searchText: text('search_text').notNull(), // Chuỗi tiếng Việt chuẩn hóa không dấu
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'products_target_gender_check',
      sql`${table.targetGender} IN ('men', 'women', 'unisex')`
    ),
    check('check_products_base_price_non_negative', sql`${table.basePrice} >= 0`),
    index('idx_products_filter').on(table.categoryId, table.targetGender, table.isActive),
    index('idx_products_created_at').on(table.createdAt),
  ]
);

// ==========================================
// 5. HÌNH ẢNH SẢN PHẨM (product_images)
// ==========================================
export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
    imageUrl: text('image_url').notNull(),
    isPrimary: boolean('is_primary').default(false).notNull(),
    displayOrder: integer('display_order').default(0).notNull(),
  },
  (table) => [
    index('idx_product_images_product_id').on(table.productId),
  ]
);

// ==========================================
// 6. BIẾN THỂ SẢN PHẨM (product_variants)
// ==========================================
export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
    colorName: text('color_name').notNull(),
    colorCode: text('color_code').notNull(), // Hex color e.g. #2D4A3E
    size: text('size').notNull(), // 'XS'..'XXL', '28'..'34', 'Free Size'
    sku: text('sku').notNull().unique(),
    stockQuantity: integer('stock_quantity').notNull().default(0),
    priceOverride: integer('price_override'), // Giá riêng cho biến thể nếu có (VNĐ)
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('check_stock_non_negative', sql`${table.stockQuantity} >= 0`),
    check(
      'check_variants_price_override_non_negative',
      sql`${table.priceOverride} >= 0 OR ${table.priceOverride} IS NULL`
    ),
    index('idx_product_variants_product_id').on(table.productId),
  ]
);

// ==========================================
// 7. THUỘC TÍNH SẢN PHẨM CHO AI (product_attributes)
// ==========================================
export const productAttributes = pgTable(
  'product_attributes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
    attrKey: text('attr_key').notNull(), // style, pattern, fit, occasion, sleeve...
    attrValue: text('attr_value').notNull(), // basic, streetwear, oversized, striped...
  },
  (table) => [
    index('idx_product_attrs_product_id_key').on(table.productId, table.attrKey),
  ]
);

// ==========================================
// 8. GIỎ HÀNG (cart_items)
// ==========================================
export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    sessionId: text('session_id'), // Hỗ trợ khách vãng lai
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'cascade' }).notNull(),
    quantity: integer('quantity').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('check_cart_quantity_positive', sql`${table.quantity} > 0`),
    index('idx_cart_items_user_id').on(table.userId),
    index('idx_cart_items_session_id').on(table.sessionId),
    unique('uniq_cart_items_user_variant').on(table.userId, table.variantId),
    unique('uniq_cart_items_session_variant').on(table.sessionId, table.variantId),
  ]
);

// ==========================================
// 9. DANH SÁCH YÊU THÍCH (wishlist_items)
// ==========================================
export const wishlistItems = pgTable(
  'wishlist_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('uniq_wishlist_user_product').on(table.userId, table.productId),
    index('idx_wishlist_user_id').on(table.userId),
  ]
);

// ==========================================
// 10. MÃ GIẢM GIÁ (vouchers)
// ==========================================
export const vouchers = pgTable(
  'vouchers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: text('code').notNull().unique(),
    description: text('description').default('').notNull(),
    discountType: text('discount_type', { enum: ['percent', 'fixed', 'free_shipping'] }).notNull(),
    discountValue: integer('discount_value').notNull(), // % hoặc số tiền VNĐ
    maxDiscount: integer('max_discount'), // Số tiền giảm tối đa nếu là percent
    minOrderValue: integer('min_order_value').notNull().default(0),
    usageLimit: integer('usage_limit').default(100),
    perUserLimit: integer('per_user_limit').notNull().default(1),
    usedCount: integer('used_count').notNull().default(0),
    applicableCategoryId: uuid('applicable_category_id').references(() => categories.id, { onDelete: 'set null' }),
    startDate: timestamp('start_date', { withTimezone: true }).notNull(),
    endDate: timestamp('end_date', { withTimezone: true }).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'vouchers_discount_type_check',
      sql`${table.discountType} IN ('percent', 'fixed', 'free_shipping')`
    ),
    check('check_vouchers_used_count_non_negative', sql`${table.usedCount} >= 0`),
  ]
);

// ==========================================
// 11. LỊCH SỬ DÙNG VOUCHER (voucher_usages)
// ==========================================
export const voucherUsages = pgTable(
  'voucher_usages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    voucherId: uuid('voucher_id').references(() => vouchers.id, { onDelete: 'cascade' }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
    orderId: text('order_id').notNull(), // Tham chiếu orders.id
    usedAt: timestamp('used_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_voucher_usages_user_voucher').on(table.userId, table.voucherId),
    index('idx_voucher_usages_order_id').on(table.orderId),
  ]
);

// ==========================================
// 12. CHƯƠNG TRÌNH KHUYẾN MÃI (promotions)
// ==========================================
export const promotions = pgTable(
  'promotions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: text('title').notNull(),
    bannerUrl: text('banner_url'),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_promotions_active_time').on(table.isActive, table.startTime, table.endTime),
  ]
);

// ==========================================
// 13. LIÊN KẾT KHUYẾN MÃI (promotion_targets)
// ==========================================
export const promotionTargets = pgTable(
  'promotion_targets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    promotionId: uuid('promotion_id').references(() => promotions.id, { onDelete: 'cascade' }).notNull(),
    targetType: text('target_type', { enum: ['product', 'category'] }).notNull(),
    targetId: uuid('target_id').notNull(),
    discountPercent: integer('discount_percent').notNull(), // % giảm giá
  },
  (table) => [
    check(
      'promotion_targets_target_type_check',
      sql`${table.targetType} IN ('product', 'category')`
    ),
    index('idx_promotion_targets_promo_id').on(table.promotionId),
    index('idx_promotion_targets_target').on(table.targetType, table.targetId),
  ]
);

// ==========================================
// 14. ĐƠN HÀNG (orders)
// ==========================================
export const orders = pgTable(
  'orders',
  {
    id: text('id').primaryKey(), // BAITY-XXXX sinh từ PostgreSQL sequence
    userId: uuid('user_id').references(() => users.id).notNull(),
    idempotencyKey: text('idempotency_key').unique(),
    receiverName: text('receiver_name').notNull(),
    receiverPhone: text('receiver_phone').notNull(),
    shippingAddress: text('shipping_address').notNull(),
    shippingMethod: text('shipping_method').notNull().default('standard'),
    shippingFee: integer('shipping_fee').notNull().default(0),
    subtotal: integer('subtotal').notNull(),
    discountAmount: integer('discount_amount').notNull().default(0),
    totalAmount: integer('total_amount').notNull(),
    status: text('status', {
      enum: [
        'pending', // Chờ thanh toán / Chờ xác nhận
        'confirmed', // Đã xác nhận
        'processing', // Đang chuẩn bị hàng
        'shipping', // Đang giao hàng
        'delivered', // Đã giao hàng
        'completed', // Hoàn tất (sau 7 ngày hoặc khách bấm nhận)
        'cancelled', // Đã hủy
        'return_requested', // Yêu cầu đổi trả/hoàn tiền
      ],
    }).notNull().default('pending'),
    cancelReason: text('cancel_reason'),
    trackingCode: text('tracking_code'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('check_orders_total_amount_non_negative', sql`${table.totalAmount} >= 0`),
    check('check_orders_discount_amount_non_negative', sql`${table.discountAmount} >= 0`),
    index('idx_orders_user_status_created').on(table.userId, table.status, table.createdAt),
    index('idx_orders_status').on(table.status),
    index('idx_orders_created_at').on(table.createdAt),
    index('idx_orders_delivered_at').on(table.deliveredAt),
  ]
);

// ==========================================
// 15. CHI TIẾT ĐƠN HÀNG (order_items)
// ==========================================
export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: text('order_id').references(() => orders.id, { onDelete: 'cascade' }).notNull(),
    variantId: uuid('variant_id').references(() => productVariants.id).notNull(),
    productName: text('product_name').notNull(),
    color: text('color').notNull(),
    size: text('size').notNull(),
    unitPrice: integer('unit_price').notNull(),
    quantity: integer('quantity').notNull(),
    totalPrice: integer('total_price').notNull(),
  },
  (table) => [
    check('check_order_items_quantity_positive', sql`${table.quantity} >= 1`),
    check('check_order_items_unit_price_non_negative', sql`${table.unitPrice} >= 0`),
    index('idx_order_items_order_id').on(table.orderId),
    index('idx_order_items_variant_id').on(table.variantId),
  ]
);

// ==========================================
// 16. LỊCH SỬ TRẠNG THÁI ĐƠN (order_status_history)
// ==========================================
export const orderStatusHistory = pgTable(
  'order_status_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: text('order_id').references(() => orders.id, { onDelete: 'cascade' }).notNull(),
    status: text('status').notNull(),
    note: text('note'),
    changedBy: text('changed_by').notNull().default('system'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_order_status_history_order_id').on(table.orderId),
  ]
);

// ==========================================
// 17. THANH TOÁN (payments)
// ==========================================
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: text('order_id').references(() => orders.id, { onDelete: 'cascade' }).notNull(),
    method: text('method', { enum: ['cod', 'vietqr', 'card', 'wallet'] }).notNull(),
    status: text('status', { enum: ['pending', 'paid', 'failed', 'refunded', 'refund_needed'] }).notNull().default('pending'),
    transactionId: text('transaction_id').unique(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'payments_status_check',
      sql`${table.status} IN ('pending', 'paid', 'failed', 'refunded', 'refund_needed')`
    ),
    index('idx_payments_order_id').on(table.orderId),
  ]
);

// ==========================================
// 17b. SỰ KIỆN ĐỐI SOÁT THANH TOÁN (payment_events) - CHỈ ADMIN ĐỌC ĐƯỢC
// ==========================================
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: text('order_id').references(() => orders.id, { onDelete: 'cascade' }).notNull(),
    eventType: text('event_type').notNull(), // ví dụ: 'amount_mismatch'
    expectedAmount: integer('expected_amount').notNull(),
    receivedAmount: integer('received_amount').notNull(),
    transactionId: text('transaction_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolutionNote: text('resolution_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_payment_events_order_id').on(table.orderId),
  ]
);


// ==========================================
// 18. ĐỔI TRẢ & HOÀN TIỀN (return_requests)
// ==========================================
export const returnRequests = pgTable(
  'return_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: text('order_id').references(() => orders.id, { onDelete: 'cascade' }).notNull(),
    userId: uuid('user_id').references(() => users.id).notNull(),
    orderItemId: uuid('order_item_id').references(() => orderItems.id).notNull(),
    reason: text('reason').notNull(),
    type: text('type', { enum: ['exchange', 'refund'] }).notNull(),
    quantity: integer('quantity').notNull().default(1),
    refundAmount: integer('refund_amount'),
    description: text('description'),
    newVariantId: uuid('new_variant_id'), // Nếu chọn đổi size/màu khác
    imageProofUrls: jsonb('image_proof_urls').default('[]').notNull(), // Mảng url ảnh lưu trong bucket private
    status: text('status', {
      enum: ['pending', 'approved', 'receiving', 'completed', 'rejected'],
    }).notNull().default('pending'),
    rejectionReason: text('rejection_reason'),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_return_requests_user_order').on(table.userId, table.orderId),
    index('idx_return_requests_status_updated').on(table.status, table.updatedAt),
    index('idx_return_requests_status_refunded').on(table.status, table.refundedAt),
  ]
);

// ==========================================
// 19. LỊCH SỬ KHO HÀNG (stock_movements)
// ==========================================
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    variantId: uuid('variant_id').references(() => productVariants.id).notNull(),
    deltaQuantity: integer('delta_quantity').notNull(), // + nhập thêm, - xuất bán/hủy
    reason: text('reason').notNull(), // 'order_placed', 'order_cancelled', 'manual_import', 'return_restock'
    referenceId: text('reference_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_stock_movements_variant_id').on(table.variantId),
  ]
);

// ==========================================
// 20. ĐÁNH GIÁ SẢN PHẨM (reviews)
// ==========================================
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
    userId: uuid('user_id').references(() => users.id).notNull(),
    orderId: text('order_id').references(() => orders.id, { onDelete: 'cascade' }).notNull(),
    rating: integer('rating').notNull(),
    comment: text('comment').notNull(),
    sellerReply: text('seller_reply'),
    sellerRepliedAt: timestamp('seller_replied_at', { withTimezone: true }),
    isVisible: boolean('is_visible').default(true).notNull(),
    hiddenReason: text('hidden_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('check_review_rating_range', sql`${table.rating} >= 1 AND ${table.rating} <= 5`),
    unique('uniq_user_product_order_review').on(table.userId, table.productId, table.orderId),
    index('idx_reviews_product_rating').on(table.productId, table.rating),
    index('idx_reviews_visible_reply').on(table.isVisible, table.sellerRepliedAt, table.createdAt),
  ]
);

// ==========================================
// 21. HÌNH ẢNH ĐÁNH GIÁ (review_images)
// ==========================================
export const reviewImages = pgTable(
  'review_images',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reviewId: uuid('review_id').references(() => reviews.id, { onDelete: 'cascade' }).notNull(),
    imageUrl: text('image_url').notNull(),
  },
  (table) => [
    index('idx_review_images_review_id').on(table.reviewId),
  ]
);

// ==========================================
// 22. HỘI THOẠI TRÒ CHUYỆN (chat_conversations)
// ==========================================
export const chatConversations = pgTable(
  'chat_conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    sessionId: text('session_id'), // Hỗ trợ khách vãng lai
    mode: text('mode', { enum: ['bot', 'human'] }).notNull().default('bot'),
    status: text('status', { enum: ['open', 'closed'] }).notNull().default('open'),
    lastMessage: text('last_message'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    unreadAdmin: integer('unread_admin').notNull().default(0),
    unreadUser: integer('unread_user').notNull().default(0),
    userLastReadAt: timestamp('user_last_read_at', { withTimezone: true }),
    adminLastReadAt: timestamp('admin_last_read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('chat_conversations_status_check', sql`${table.status} IN ('open', 'closed')`),
    check(
      'check_chat_conv_unread_non_negative',
      sql`${table.unreadAdmin} >= 0 AND ${table.unreadUser} >= 0`
    ),
    index('idx_chat_conv_user_mode').on(table.userId, table.mode),
    index('idx_chat_conv_status_last_msg').on(table.status, table.lastMessageAt),
    uniqueIndex('idx_chat_conv_single_open_user')
      .on(table.userId)
      .where(sql`${table.status} = 'open'`),
  ]
);

// ==========================================
// 23. TIN NHẮN (chat_messages)
// ==========================================
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id').references(() => chatConversations.id, { onDelete: 'cascade' }).notNull(),
    senderType: text('sender_type', { enum: ['user', 'admin', 'bot'] }).notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'chat_messages_content_length_check',
      sql`char_length(${table.content}) >= 1 AND char_length(${table.content}) <= 1000`
    ),
    index('idx_chat_messages_conv_id').on(table.conversationId),
    index('idx_chat_messages_conv_created').on(table.conversationId, table.createdAt),
  ]
);

// ==========================================
// 24. FAQ VÀ CHÍNH SÁCH (faq_policies)
// ==========================================
export const faqPolicies = pgTable('faq_policies', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').unique(),
  type: text('type', { enum: ['faq', 'shipping', 'return', 'privacy', 'payment'] }).notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  displayOrder: integer('display_order').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ==========================================
// 25. CÀI ĐẶT CỬA HÀNG (store_settings)
// ==========================================
export const storeSettings = pgTable('store_settings', {
  key: text('key').primaryKey(), // 'size_charts', 'vietqr_config', 'general', 'contact', 'shipping', 'returns', 'inventory'
  value: jsonb('value').notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ==========================================
// 26. QUẢN LÝ FILE TẢI LÊN & QUYỀN SỞ HỮU (uploads)
// ==========================================
export const uploads = pgTable(
  'uploads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    bucket: text('bucket').notNull(),
    objectPath: text('object_path').notNull().unique(),
    purpose: text('purpose', { enum: ['avatar', 'review', 'return', 'product'] }).notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'uploads_purpose_check',
      sql`${table.purpose} IN ('avatar', 'review', 'return', 'product')`
    ),
    index('idx_uploads_user_purpose').on(table.userId, table.purpose),
    index('idx_uploads_object_path').on(table.objectPath),
  ]
);

// ==========================================
// 27. BỘ ĐẾM TRẦN GỌI CHATBOT THEO NGÀY & RATE LIMIT (chatbot_daily_counters)
// ==========================================
export const chatbotDailyCounters = pgTable(
  'chatbot_daily_counters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    dateKey: text('date_key').notNull(), // 'YYYY-MM-DD' hoặc 'minute:<epochMinute>'
    scopeKey: text('scope_key').notNull(), // 'global', 'actor_daily:<actorKey>', 'burst:<actorKey>'
    callCount: integer('call_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('uniq_chatbot_daily_counters_date_scope').on(table.dateKey, table.scopeKey),
    check('check_chatbot_call_count_non_negative', sql`${table.callCount} >= 0`),
    index('idx_chatbot_daily_counters_date').on(table.dateKey),
  ]
);

// ==========================================
// 28. NHẬT KÝ THAO TÁC QUẢN TRỊ VIÊN (admin_audit_logs)
// ==========================================
export const adminAuditLogs = pgTable(
  'admin_audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    adminId: uuid('admin_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    summary: text('summary').notNull(), // Không chứa PII
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_admin_audit_logs_admin_id').on(table.adminId),
    index('idx_admin_audit_logs_target').on(table.targetType, table.targetId),
    index('idx_admin_audit_logs_created_at').on(table.createdAt),
  ]
);

// ==========================================
// 29. NHẬT KÝ TÌM KIẾM BẰNG HÌNH ẢNH AI (ai_search_logs) - CHỈ ADMIN ĐỌC ĐƯỢC, TỰ ĐỘNG XÓA SAU 90 NGÀY
// ==========================================
export const aiSearchLogs = pgTable(
  'ai_search_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recognizedAttributes: jsonb('recognized_attributes').notNull().default('{}'),
    confidence: doublePrecision('confidence').notNull().default(0),
    resultCount: integer('result_count').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    isSuccess: boolean('is_success').notNull().default(true),
    actorHmac: text('actor_hmac').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('check_ai_search_logs_confidence_range', sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
    check('check_ai_search_logs_result_count_non_negative', sql`${table.resultCount} >= 0`),
    check('check_ai_search_logs_latency_non_negative', sql`${table.latencyMs} >= 0`),
    index('idx_ai_search_logs_created_at').on(table.createdAt),
  ]
);
