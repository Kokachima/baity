# PROJECT_STATE.md

> Tập tin này được sinh tự động hoàn toàn bằng mã qua lệnh `npm run state` (`scripts/project-state.ts`). Không chỉnh sửa thủ công.

- **Thời điểm sinh (UTC)**: `2026-11-05T10:25:26.192Z`
- **Tổng số file được quét** (`migrations`, `scripts`, `server`, `shared`, `src`, `tests`): **156**
- **Tổng số dòng (`wc -l`)**: **118483**

## 1. Cây file kèm số dòng (`wc -l`)

| File | Số dòng (`wc -l`) |
| --- | ---: |
| `migrations/0000_supreme_changeling.sql` | 350 |
| `migrations/0001_phase2_constraints.sql` | 1 |
| `migrations/0002_glossy_mystique.sql` | 7 |
| `migrations/0003_lovely_iron_monger.sql` | 2 |
| `migrations/0004_tiresome_lucky_pierre.sql` | 0 |
| `migrations/0005_clammy_randall_flagg.sql` | 4 |
| `migrations/0006_icy_scarlet_spider.sql` | 12 |
| `migrations/0007_loving_alex_power.sql` | 135 |
| `migrations/0008_chunky_runaways.sql` | 4 |
| `migrations/0009_cold_joshua_kane.sql` | 33 |
| `migrations/0010_brief_winter_soldier.sql` | 10 |
| `migrations/0011_free_hercules.sql` | 13 |
| `migrations/0012_perfect_wolverine.sql` | 7 |
| `migrations/0013_wide_lightspeed.sql` | 22 |
| `migrations/0014_smiling_ender_wiggin.sql` | 36 |
| `migrations/meta/0000_snapshot.json` | 2428 |
| `migrations/meta/0001_snapshot.json` | 2460 |
| `migrations/meta/0002_snapshot.json` | 2504 |
| `migrations/meta/0003_snapshot.json` | 2523 |
| `migrations/meta/0004_snapshot.json` | 2523 |
| `migrations/meta/0005_snapshot.json` | 2540 |
| `migrations/meta/0006_snapshot.json` | 2627 |
| `migrations/meta/0007_snapshot.json` | 2755 |
| `migrations/meta/0008_snapshot.json` | 2784 |
| `migrations/meta/0009_snapshot.json` | 3013 |
| `migrations/meta/0010_snapshot.json` | 3068 |
| `migrations/meta/0011_snapshot.json` | 3154 |
| `migrations/meta/0012_snapshot.json` | 3207 |
| `migrations/meta/0013_snapshot.json` | 3327 |
| `migrations/meta/0014_snapshot.json` | 3465 |
| `migrations/meta/_journal.json` | 110 |
| `scripts/chat-smoke.ts` | 73 |
| `scripts/check-schema-drift.ts` | 51 |
| `scripts/dev-set-order-status.ts` | 216 |
| `scripts/export-check.ts` | 561 |
| `scripts/load-container-env.ts` | 80 |
| `scripts/prod-rehearsal.ts` | 455 |
| `scripts/project-state.ts` | 492 |
| `scripts/secure-dev-accounts.ts` | 163 |
| `scripts/seed-apply-demo-catalog.ts` | 422 |
| `scripts/seed-images-check.ts` | 246 |
| `scripts/seed-images-fetch.ts` | 226 |
| `scripts/seed-images-plan.ts` | 775 |
| `scripts/seed-images-report.ts` | 224 |
| `scripts/visual-audit-seed.ts` | 655 |
| `scripts/visual-eval.ts` | 579 |
| `scripts/visual-smoke.ts` | 93 |
| `scripts/visual-stability.ts` | 428 |
| `server/app.ts` | 798 |
| `server/config/runtimeMode.ts` | 192 |
| `server/db/index.ts` | 376 |
| `server/db/init.ts` | 50 |
| `server/db/schema.ts` | 695 |
| `server/db/seed.ts` | 1025 |
| `server/routes/admin.ts` | 3762 |
| `server/routes/adminStage8c.ts` | 2004 |
| `server/routes/adminStage8d.ts` | 1870 |
| `server/routes/api.ts` | 865 |
| `server/routes/auth.ts` | 386 |
| `server/routes/cart.ts` | 825 |
| `server/routes/chat.ts` | 867 |
| `server/routes/orders.ts` | 1758 |
| `server/routes/products.ts` | 1186 |
| `server/routes/publicRouteAllowlist.ts` | 149 |
| `server/routes/returns.ts` | 478 |
| `server/routes/reviews.ts` | 1136 |
| `server/routes/user.ts` | 408 |
| `server/routes/visualSearch.ts` | 173 |
| `server/routes/vouchers.ts` | 638 |
| `server/routes/wishlist.ts` | 300 |
| `server/services/auth.ts` | 497 |
| `server/services/chatbot.ts` | 1511 |
| `server/services/email.ts` | 228 |
| `server/services/lazyCleanup.ts` | 140 |
| `server/services/orderStateMachine.ts` | 598 |
| `server/services/policyFaq.ts` | 652 |
| `server/services/pricing.ts` | 494 |
| `server/services/productImageAuditStatus.ts` | 673 |
| `server/services/search.ts` | 109 |
| `server/services/upload.ts` | 246 |
| `server/services/vietqr.ts` | 269 |
| `server/services/visualSearch.ts` | 1631 |
| `shared/contracts.ts` | 902 |
| `shared/safeMarkdown.ts` | 240 |
| `src/App.tsx` | 1487 |
| `src/components/account/AccountModal.tsx` | 871 |
| `src/components/admin/AdminDashboardView.tsx` | 249 |
| `src/components/admin/AdminLayout.tsx` | 267 |
| `src/components/admin/AuditLogPage.tsx` | 152 |
| `src/components/admin/CategoriesPage.tsx` | 290 |
| `src/components/admin/InventoryPage.tsx` | 349 |
| `src/components/admin/OperationsOverviewPage.tsx` | 252 |
| `src/components/admin/OrderDetailPanel.tsx` | 354 |
| `src/components/admin/OrdersPage.tsx` | 276 |
| `src/components/admin/PaymentIssuesPage.tsx` | 225 |
| `src/components/admin/PoliciesFaqPage.tsx` | 541 |
| `src/components/admin/ProductsPage.tsx` | 511 |
| `src/components/admin/PromotionsPage.tsx` | 554 |
| `src/components/admin/QuickProductImagesPage.tsx` | 721 |
| `src/components/admin/ReturnsPage.tsx` | 341 |
| `src/components/admin/ReviewsAdminPage.tsx` | 627 |
| `src/components/admin/SellerChatsAdminPage.tsx` | 527 |
| `src/components/admin/StatsDashboardPage.tsx` | 414 |
| `src/components/admin/StoreSettingsPage.tsx` | 389 |
| `src/components/admin/VouchersPage.tsx` | 606 |
| `src/components/admin/stats/StatsProductsAndInventorySection.tsx` | 174 |
| `src/components/admin/stats/StatsRevenueChart.tsx` | 166 |
| `src/components/admin/stats/StatsVouchersAndVisualSearchSection.tsx` | 162 |
| `src/components/auth/AuthModal.tsx` | 391 |
| `src/components/auth/ResetPasswordModal.tsx` | 191 |
| `src/components/cart/CartDrawer.tsx` | 284 |
| `src/components/checkout/CancelOrderModal.tsx` | 154 |
| `src/components/checkout/CheckoutModal.tsx` | 853 |
| `src/components/checkout/OrderDetail.tsx` | 312 |
| `src/components/checkout/OrderHistory.tsx` | 327 |
| `src/components/checkout/OrderTimeline.tsx` | 206 |
| `src/components/checkout/ReturnRequestModal.tsx` | 344 |
| `src/components/common/ImageWithFallback.tsx` | 53 |
| `src/components/common/SafeMarkdown.tsx` | 139 |
| `src/components/layout/Footer.tsx` | 298 |
| `src/components/layout/MobileDrawer.tsx` | 187 |
| `src/components/layout/Navbar.tsx` | 392 |
| `src/components/product/ProductCard.tsx` | 156 |
| `src/components/product/ProductDetailView.tsx` | 751 |
| `src/components/product/ProductFilterPanel.tsx` | 389 |
| `src/components/product/ReviewSection.tsx` | 725 |
| `src/components/product/SizeGuideModal.tsx` | 307 |
| `src/components/search/VisualSearchPage.tsx` | 1275 |
| `src/components/support/ChatbotWidget.tsx` | 413 |
| `src/components/support/PolicyFaqView.tsx` | 531 |
| `src/components/support/SellerChatPanel.tsx` | 508 |
| `src/components/wishlist/WishlistDrawer.tsx` | 141 |
| `src/index.css` | 38 |
| `src/lib/api.ts` | 141 |
| `src/main.tsx` | 5 |
| `src/types/index.ts` | 281 |
| `tests/auth_profile.test.ts` | 206 |
| `tests/e2e/cross_origin_iframe.spec.ts` | 84 |
| `tests/http_endpoints.test.ts` | 966 |
| `tests/pg/stage4_concurrency_pg.test.ts` | 2278 |
| `tests/pricing.test.ts` | 194 |
| `tests/search.test.ts` | 21 |
| `tests/stage3_catalog.test.ts` | 997 |
| `tests/stage4_checkout.test.ts` | 1397 |
| `tests/stage5_orders_returns.test.ts` | 1284 |
| `tests/stage5_ui_bugs_flow.test.ts` | 2746 |
| `tests/stage6a_reviews.test.ts` | 1144 |
| `tests/stage6b_policies_faq.test.ts` | 522 |
| `tests/stage6c_chatbot.test.ts` | 935 |
| `tests/stage6d_seller_chat.test.ts` | 902 |
| `tests/stage7_visual_search.test.ts` | 872 |
| `tests/stage8a_admin.test.ts` | 820 |
| `tests/stage8b_catalog_inventory.test.ts` | 976 |
| `tests/stage8c_vouchers_promotions_settings_policies.test.ts` | 1151 |
| `tests/stage8d_reviews_overview_stats.test.ts` | 1146 |
| `tests/stage9_production_readiness.test.ts` | 2551 |
| **Tổng cộng (156 files)** | **118483** |

## 2. Danh sách bài kiểm tra (Tests) theo từng file

- **Unit/Integration Tests (`npm test`)**: **304** tests
- **PostgreSQL Concurrency/Migration Tests (`npm run test:pg`)**: **20** tests
- **E2E Spec (`tests/e2e/`)**: **0** tests
- **Tổng cộng tất cả các test**: **324** tests

### `tests/auth_profile.test.ts` (10 tests)

1. `hashToken: generates deterministic SHA-256 hex string from raw token`
2. `generateRandomToken: generates 64-character secure hex string`
3. `rate limit: enforces lockout after 5 consecutive failed login attempts`
4. `registration security: always forces role=customer regardless of request payload`
5. `reset token: expires after 15 minutes and is strictly single-use`
6. `session invalidation: revokes older sessions but permits fresh logins within the same second`
7. `address ownership: restricts address modification strictly to the owning user`
8. `upload magic bytes: accurately validates real JPEG, PNG, WEBP and rejects disguised files`
9. `voucher discount: BAITYFREESHIP waives full shipping fee regardless of shipping tier`
10. `profile validation: validates height (100-230cm) and weight (30-200kg) ranges`

### `tests/e2e/cross_origin_iframe.spec.ts` (0 tests)


### `tests/http_endpoints.test.ts` (19 tests)

1. `HTTP POST /api/auth/register: forces role=customer even when payload sends role=admin`
2. `HTTP POST /api/auth/login: returns identical generic error message for wrong email vs wrong password`
3. `HTTP POST /api/auth/login: locks out with HTTP 429 after 5 failed login attempts`
4. `HTTP POST /api/auth/forgot-password: returns identical response for existing and non-existing emails`
5. `HTTP /api/user/addresses: enforces address ownership and single default address per user`
6. `HTTP GET /api/upload/signed-url: validates path, rejects .., rejects invalid characters, non-return paths, enforces ownership (403) and allows admin`
7. `PII Redaction (không lộ password_hash): auth and profile endpoints never expose password_hash or reset_token_hash`
8. `Role isolation (khách không vào được /api/admin/*): customer receives HTTP 403 on /api/admin/* while admin succeeds`
9. `Token Tampering (JWT bị sửa): rejects modified JWT payload or signature with HTTP 401`
10. `Password Complexity: rejects passwords shorter than 8 characters on register, reset-password, and change-password`
11. `Phone Format & Security: rejects invalid phone formats and SQL injection payloads`
12. `Cross-User Profile Isolation: User A cannot view or overwrite User B profile fields`
13. `Email uniqueness (409): duplicate email registration (case-insensitive) returns HTTP 409 Conflict`
14. `Single active reset token: requesting forgot-password multiple times keeps only the latest token hash active`
15. `Address Cascade Deletion: deleting default address promotes next address, and deleting user cascades to addresses`
16. `Profile Partial Updates: updating only heightCm/weightKg preserves existing fullName and phone`
17. `Concurrent Address Operations: parallel default address creations maintain exactly one default address without DB error`
18. `Profile Change Auditing: changing password updates password_changed_at and invalidates older tokens`
19. `Two-Level Address (Tỉnh/Thành phố, Phường/Xã): allows creating and updating address with district=null while preserving backward compatibility`

### `tests/pg/stage4_concurrency_pg.test.ts` (20 tests)

1. `Real PG Concurrency - Guard TEST_DATABASE_URL: Từ chối khi NODE_ENV=production, trùng DATABASE_URL hoặc thiếu "test" trong tên schema; xác nhận đang chạy trên schema riêng test_<ngẫu nhiên>`
2. `Real PG Concurrency - Chống âm kho: Đặt hàng vượt tồn kho song song (Promise.all) không làm âm kho và rollback toàn bộ`
3. `Real PG Concurrency - Voucher còn 1 lượt dùng: Hai đơn gửi đồng thời (Promise.all) chỉ 1 đơn dùng được`
4. `Real PG Concurrency - Idempotency-Key song song (Promise.all) chỉ ra 1 đơn duy nhất và trừ tồn kho 1 lần`
5. `Real PG Concurrency - Hai lần cleanup chạy song song (Promise.all) hoàn kho và voucher đúng 1 lần duy nhất`
6. `PG Concurrency 6 (Migration Schema Parity vs Public Dev DB & Original 0000 Integrity): Tệp 0000_supreme_changeling.sql nguyên bản 100%; search_path = <schema_test>, public; cấu trúc tạo từ migrations trong schema mới khớp hoàn toàn với schema public về bảng, cột, kiểu, ràng buộc, index và extension`
7. `PG Concurrency 7 (RLS Enabled on All Tables in Public & Test Schema): Tất cả bảng ứng dụng trong cả public và schema test đều bật pg_class.relrowsecurity = true; bất kỳ bảng mới nào thiếu RLS sẽ làm test hỏng ngay`
8. `PG Concurrency 8 (Foreign Key ON DELETE & ON UPDATE Integrity vs schema.ts & 0000): Quy tắc ON DELETE và ON UPDATE (pg_constraint confdeltype, confupdtype) của mọi khóa ngoại trong cấu trúc cuối cùng khớp 100% với khai báo trong server/db/schema.ts và 0000_supreme_changeling.sql (không mất CASCADE, RESTRICT hay SET NULL)`
9. `PG Concurrency 9 (Hardcoded Critical Constraints & Real Behavioral Enforcement): Đối chiếu pg_constraint và pg_indexes với danh sách kỳ vọng viết cứng (PK mọi bảng, CHECK stock >= 0, 7 CHECK tiền/số lượng >= 0, CHECK enum, UNIQUE idempotency_key/cart/reviews/wishlist/voucher/payment/email/slug, partial unique địa chỉ mặc định) và kiểm thử hành vi thật từ chối tồn kho âm, tiền âm, số lượng < 1, trùng idempotency_key, trùng giỏ hàng, trùng đánh giá`
10. `PG Concurrency 10 (Two Admins Cancelling Same Order Concurrently on Real PostgreSQL): Hai Admin cùng hủy một đơn song song chỉ hoàn kho và hoàn voucher đúng 1 lần duy nhất, người thứ hai nhận 409 Conflict`
11. `PG Concurrency 11 (Two Admins Confirming Payment Concurrently on Real PostgreSQL): Hai Admin cùng xác nhận thanh toán thủ công song song chỉ ghi nhận chuyển trạng thái và lịch sử đúng 1 lần`
12. `PG Concurrency 12 (Two Admins Refunding Same Return Request Concurrently on Real PostgreSQL): Hai Admin cùng hoàn tiền một yêu cầu đổi trả song song chỉ ghi nhận hoàn tiền đúng 1 lần`
13. `PG Concurrency 13 (Two Admins Deducting Stock Concurrently via stock-adjust on Real PostgreSQL): Khi tồn kho chỉ đủ cho một người, hai Admin cùng trừ kho song song chỉ 1 người thành công (200) và 1 người bị từ chối (409), tồn kho không âm`
14. `PG Concurrency 14 (Two Admins Updating Same Product Concurrently with expectedUpdatedAt on Real PostgreSQL): Hai Admin cùng cập nhật một sản phẩm song song với cùng expectedUpdatedAt thì 1 người thành công (200) và 1 người nhận 409 Conflict`
15. `PG Concurrency 15 (Migration 0010 Legacy Payment Status Sanitization & CHECK Constraint): Tạo dòng payments với status = "success" ở trạng thái trước 0010, chạy 0010, xác nhận dòng đổi thành "paid" và CHECK từ chối "success"`
16. `PG Concurrency 16 (Two Admins Updating Same Voucher Concurrently & Rejecting usageLimit < usedCount on Real PostgreSQL): Hai Admin cùng sửa một voucher song song với cùng expectedUpdatedAt thì 1 người 200 và 1 người 409; giảm usageLimit xuống dưới usedCount bị từ chối 400`
17. `PG Concurrency 17 (Two Admins Updating Store Settings Concurrently on Real PostgreSQL): Hai Admin cùng PUT /api/admin/settings song song với cùng expectedUpdatedAt thì 1 người 200 và 1 người 409`
18. `PG Concurrency 18 (Stage 8d Real PostgreSQL Stats Net Revenue, Asia/Ho_Chi_Minh Timezone Boundary & Review Visibility): Trên PostgreSQL thật, thống kê tách đúng doanh thu thực (đơn đã giao trừ hoàn tiền hoàn tất), giá trị đơn đặt, biên ngày 23:30 UTC sang ngày hôm sau ở GMT+7, và ẩn đánh giá loại khỏi rating_avg`
19. `PG Concurrency 19 (Stage 6d Single Open Conversation Under Parallel Creation & Stage 8d refunded_at Immutability): Trên PostgreSQL thật, tạo song song 6 yêu cầu POST /api/chat/conversations (Promise.all) cho cùng một khách hàng vẫn chỉ có đúng 1 hội thoại mở nhờ partial unique index idx_chat_conv_single_open_user, chèn trực tiếp hội thoại mở thứ 2 bị chặn 23505, và sửa return_requests.updated_at sau khi hoàn tất không làm lệch kỳ thống kê hoàn tiền nhờ refunded_at`
20. `Real PG Concurrency 20 - Concurrent Primary Image Update: Hai admin cùng cập nhật ảnh chính một sản phẩm với cùng expectedUpdatedAt trên PostgreSQL thật -> đúng một 200 và một 409`

### `tests/pricing.test.ts` (13 tests)

1. `calculateEffectivePrice: returns base price when no promotions are active`
2. `calculateEffectivePrice: picks highest discount percent when multiple promos match`
3. `calculateEffectivePrice: prioritizes priceOverride before applying discount`
4. `calculateVoucherDiscount: applies percentage discount with cap`
5. `calculateVoucherDiscount: rejects when minimum order value is not met`
6. `calculateVoucherDiscount: applies free shipping discount up to shipping fee`
7. `calculateRefundAmount: hoàn một phần số lượng (mua 3 cái hoàn 1 cái)`
8. `calculateRefundAmount: đơn có voucher phân bổ chiết khấu theo tỷ lệ giá trị dòng sản phẩm`
9. `calculateRefundAmount: làm tròn số tiền VNĐ chuẩn xác (Math.round)`
10. `calculateRefundAmount: tổng các lần hoàn tiền tích lũy không vượt quá số đã thanh toán thực tế`
11. `calculateRefundAmount: chính sách phí ship - không hoàn phí ship khi đổi trả hàng`
12. `calculateRefundAmount: khi voucher là free_shipping thì phần giảm đó thuộc phí ship, KHÔNG chia vào tiền hoàn của sản phẩm`
13. `calculateRefundAmount: chính sách phí ship - hoàn lại phí ship khi lỗi thuộc về cửa hàng (hàng lỗi, giao sai)`

### `tests/search.test.ts` (3 tests)

1. `normalizeVietnameseText: strips diacritics and converts to lowercase`
2. `normalizeVietnameseText: correctly maps đ and Đ to d`
3. `normalizeVietnameseText: handles special characters and collapses whitespace`

### `tests/stage3_catalog.test.ts` (22 tests)

1. `Stage 3 - GET /api/products: returns HTTP 400 for invalid sort, page, pageSize, minPrice/maxPrice, gender`
2. `Stage 3 - GET /api/products: pagination with secondary key (id) has zero duplicates and zero missing items`
3. `Stage 3 - GET /api/products: filtering by men or women includes unisex products by default and supports excluding unisex`
4. `Stage 3 - GET /api/products: accurately filters by category, effective price range, size, color, onSale, inStock`
5. `Stage 3 - Effective price calculation: matches pricing.ts with price_override and respects promotion start/end time window`
6. `Stage 3 - Search & Ranking: supports unaccented Vietnamese, ranks name matches before description matches, and escapes % _ \\`
7. `Stage 3 - GET /api/products/suggest: returns max 8 suggestions and enforces rate limit`
8. `Stage 3 - GET /api/products/:slug: returns full detail, variant stock statuses, size recommendation, related products, and 404 for hidden/missing products`
9. `Stage 3 - EXPLAIN query plan: confirms search query uses pg_trgm GIN index idx_products_search_trgm`
10. `Stage 3 - Pricing: compares SQL effective_price against calculateEffectivePrice on ALL seeded products, handles multiple promotions taking MAX discount, and verifies outside promo window`
11. `Stage 3 - Search sort=relevance: prioritizes name > desc > cat > attr, defaults to relevance when q is provided, and keeps secondary key id`
12. `Stage 3 - Size Recommendation validation: enforces height (100-230) and weight (30-200), returns HTTP 400 when invalid or missing`
13. `Stage 3 - Metrics Accuracy: verifies total_stock, rating_avg, and review_count in list and detail match direct SQL calculations`
14. `Stage 3 - No N+1: verifies database query count of GET /api/products is constant O(1) regardless of pageSize`
15. `Stage 3 - Search equivalence ("ao so mi", "so mi", "áo sơ mi") & price_override onSale consistency`
16. `Stage 3 - Seed integrity: verifies categories, products, variants, images, and store_settings are populated and valid`
17. `Stage 3 - Category slug and UUID filter: filtering by category slug or category UUID returns identical product sets`
18. `Stage 3 - Rating filter: minRating filters only products meeting minimum average rating threshold`
19. `Stage 3 - Sorting options: supports newest, price_asc, price_desc, rating, and bestseller accurately`
20. `Stage 3 - Facets: GET /api/products/facets returns available colors, ordered sizes, and effective min/max prices`
21. `Stage 3 - Fuzzy matching (gõ sai chính tả): pg_trgm finds products even when user types minor spelling mistakes`
22. `Stage 3 - Product Detail: supports lookup by both slug and UUID and returns complete attributes, variants, reviews, and sizeChart`

### `tests/stage4_checkout.test.ts` (27 tests)

1. `Stage 4 - Quy tắc 8: Giỏ hàng khách vãng lai quản lý qua httpOnly cookie và tự động gộp khi đăng nhập`
2. `Stage 4 - Quy tắc 8: Giới hạn số lượng 1-10 mỗi dòng sản phẩm và tối đa 50 dòng trong giỏ hàng`
3. `Stage 4 - Quy tắc 8: API giỏ hàng trả cờ price_changed, out_of_stock, insufficient_stock khi có biến động`
4. `Stage 4 - Quy tắc 8: Wishlist bắt buộc đăng nhập và chống trùng lặp qua UNIQUE(user_id, product_id)`
5. `Stage 4 - Quy tắc 8: Wishlist có endpoint chuyển nhanh sang giỏ (POST /api/wishlist/:id/move-to-cart)`
6. `Stage 4 - Quy tắc 4: GET /api/vouchers/available trả danh sách voucher đang kích hoạt`
7. `Stage 4 - Quy tắc 4: Rate limit cho POST /api/vouchers/validate (chặn lạm dụng brute-force)`
8. `Stage 4 - Quy tắc 4: Xác thực voucher percent có trần, fixed, free_shipping và min_order_value tính trên giá sau khuyến mãi`
9. `Stage 4 - Quy tắc 4 Đồng thời: Voucher còn đúng 1 lượt dùng, gửi đồng thời (Promise.all) chỉ 1 đơn thành công`
10. `Stage 4 - Quy tắc 9: Đặt hàng bắt buộc đăng nhập (401 nếu chưa xác thực)`
11. `Stage 4 - Quy tắc 9: Bỏ qua giá client gửi lên; order_items lưu snapshot tên sản phẩm, biến thể, đơn giá thực tế`
12. `Stage 4 - Quy tắc 9: Phí ship và ngưỡng miễn phí ship đọc động từ store_settings, tính trên tổng sau giảm`
13. `Stage 4 - Quy tắc 3: Idempotency-Key song song (Promise.all) chỉ ra 1 đơn duy nhất và trừ tồn kho 1 lần`
14. `Stage 4 - Quy tắc 3: Cùng Idempotency-Key nhưng nội dung khác trả về HTTP 422 Unprocessable Entity`
15. `Stage 4 - Chống âm kho: Đặt hàng vượt tồn kho hoặc tranh chấp song song (Promise.all) không làm âm kho và rollback toàn bộ đơn`
16. `Stage 4 - Quy tắc 6: Phương thức thanh toán COD không bị tự hủy sau 30 phút, VietQR có hạn thanh toán 30 phút`
17. `Stage 4 - Quy tắc 5: Webhook từ chối 401 khi sai chữ ký bí mật hoặc sai secret`
18. `Stage 4 - Quy tắc 5: Webhook từ chối 400 khi số tiền thanh toán không khớp với tổng đơn hàng`
19. `Stage 4 - Quy tắc 5: Webhook idempotent theo transaction_id khi gọi lặp lại`
20. `Stage 4 - Quy tắc 5: Tiền về muộn khi đơn đã bị hủy/hết hạn ghi nhận thanh toán ở trạng thái refund_needed`
21. `Stage 4 - Quy tắc 9: Hủy đơn hàng yêu cầu lý do, chỉ chủ đơn được hủy và không cho hủy khi đã giao hàng`
22. `Stage 4 - Quy tắc 9: Đơn VietQR đã thanh toán khi hủy tự động tạo yêu cầu hoàn tiền (return_requests)`
23. `Stage 4 - Quy tắc 7 Đồng thời: Hai lần cleanup chạy song song (Promise.all) hoàn kho và voucher đúng 1 lần duy nhất`
24. `Stage 4 - Mục A.5: Khi ENABLE_DEMO_PAYMENT_WEBHOOK không phải "true" thì webhook bị tắt (403) và dữ liệu không đổi`
25. `Stage 4 - Mục A.6: Phí vận chuyển Hỏa tốc đọc động từ store_settings (không cố định trong code)`
26. `Stage 4 - Mục A.7: Đặt hàng bằng addressId của địa chỉ hai cấp (district = null) tạo chuỗi shippingAddress chuẩn xác`
27. `Stage 4 - Mục ƯU TIÊN 2.6: Idempotency-Key chỉ gắn với yêu cầu đặt hàng thành công; khi gặp lỗi nghiệp vụ (hết hàng / voucher sai) thì sau khi sửa vẫn dùng lại khóa đó đặt hàng thành công`

### `tests/stage5_orders_returns.test.ts` (19 tests)

1. `Stage 5 - Quy tắc 1: Chủ đơn mới xem được đơn hàng, người khác nhận HTTP 404 (không lộ mã đơn)`
2. `Stage 5 - Quy tắc 2: Chuyển trạng thái đơn hàng trái luồng bị từ chối với HTTP 400`
3. `Stage 5 - Quy tắc 3: Ranh giới đổi trả 7 ngày - ngày thứ 7 được đổi trả, ngày thứ 8 bị chặn (HTTP 400)`
4. `Stage 5 - Quy tắc 4: Vượt số lượng đã mua bị từ chối và mỗi dòng sản phẩm chỉ có tối đa 1 yêu cầu đang xử lý`
5. `Stage 5 - Quy tắc 5: Tự hoàn tất lazy - đơn delivered quá 7 ngày tự động chuyển completed khi truy vấn`
6. `Stage 5 - Quy tắc 6: Mua lại (POST /api/orders/:id/reorder) thêm vào giỏ, thông báo rõ món hết hàng`
7. `Stage 5 - Quy tắc 7: Hoàn tiền tính đúng khi đơn có voucher (phân bổ giảm giá theo tỷ lệ giá trị)`
8. `Stage 5 - Quy tắc 8a: Server hoàn toàn bỏ qua refundAmount do client giả mạo gửi lên`
9. `Stage 5 - Quy tắc 8b: GET /api/orders hỗ trợ lọc theo trạng thái và phân trang chính xác`
10. `Stage 5 - Quy tắc 8c: GET /api/orders/:id/payment-status trả về thông tin QR và thời gian đếm ngược để tiếp tục thanh toán VietQR`
11. `Stage 5 - Mục A.2: PUT /api/admin/orders/:id/status chỉ admin được gọi; tài khoản khách gọi nhận 403 và dữ liệu không đổi; route cũ PUT /api/orders/:id/status đã được gỡ bỏ`
12. `Stage 5 - Mục A.3: Hủy đơn chỉ được phép ở pending, confirmed, processing; từ shipping trở đi bị chặn 400 (test từng trạng thái)`
13. `Stage 5 - Mục A.9: Khi đơn dùng voucher free_shipping thì phần giảm phí ship KHÔNG bị trừ vào tiền hoàn sản phẩm`
14. `Stage 5 - Mục A.11: POST /api/tasks/cron-cleanup đúng CRON_SECRET_KEY thì chạy (tự hoàn tất đơn delivered > 7 ngày), sai hoặc thiếu nhận 401`
15. `Stage 5 - Mục A.11a: POST /api/returns chỉ cho phép tạo yêu cầu đổi trả khi đơn hàng ở trạng thái delivered (đơn chưa delivered nhận 400)`
16. `Stage 5 - Mục A.11b: POST /api/returns chỉ cho phép chủ đơn thực hiện; người dùng khác gọi trên đơn không thuộc mình nhận 404`
17. `Stage 5 - Mục A.11c: POST /api/returns giới hạn tối đa 3 ảnh minh chứng (gửi 4 ảnh bị từ chối 400)`
18. `Stage 5 - Mục A.11d: POST /api/returns bắt buộc path ảnh minh chứng phải thuộc thư mục của chính người dùng (<userId>/return/...)`
19. `Stage 5 - Mục ƯU TIÊN 2.5: Lý do khách chọn chỉ là đề xuất (ban đầu chưa cộng phí ship); khi Admin duyệt (POST /api/admin/returns/:id/decision) và xác nhận refundShippingFee=true thì server tự tính lại số tiền hoàn kèm phí ship`

### `tests/stage5_ui_bugs_flow.test.ts` (33 tests)

1. `UI Bug L1 & H1: Đăng nhập trong cross-site iframe giữ được cookie baity_token (SameSite=None; Secure), đặt hàng thành công và chặn CSRF từ Origin lạ`
2. `CSRF/Origin Check: Origin trùng với Host hoặc X-Forwarded-Host của chính server được phép; Origin lạ bị từ chối với 403 kèm ghi log địa chỉ Origin bị từ chối; không chấp nhận "*"`
3. `UI Bug L3: Thêm liên tiếp 2 mặt hàng khác nhau và thêm trùng biến thể trong iframe không làm mất món cũ và tăng đúng số lượng`
4. `UI Bug L4: Tăng/giảm số lượng (PUT /api/cart/:id) và xóa mặt hàng (DELETE /api/cart/:id) hoạt động chính xác trong iframe`
5. `UI Bug L2: Áp dụng mã giảm giá BAITYWELCOME trong iframe hoạt động đúng với giỏ hàng hiện tại và trả lỗi chuẩn { error: { code, message } } khi không đủ điều kiện`
6. `Requirement C - Luồng trình duyệt đầy đủ qua CookieJar: Khách (session_id) -> Thêm 2 sản phẩm -> Thêm trùng biến thể (tăng số lượng, trần 10) -> Tăng/giảm & Xóa -> Đăng nhập gộp giỏ -> Áp BAITYWELCOME -> Đặt hàng COD`
7. `Security 1 (TRUST_PROXY_HOPS): Gửi X-Forwarded-For giả liên tiếp ở đầu chuỗi vẫn bị khóa rate limit theo IP thật`
8. `Security 2 (Body Size Limits): Route thường từ chối payload > 100kb với 413; chỉ route upload và tìm bằng ảnh cho phép > 100kb (tối đa 8MB)`
9. `Security 3 (Helmet & CSP): Phản hồi có đầy đủ CSP (Google Fonts, đúng host trong SUPABASE_URL không dùng *.supabase.co, VietQR), X-XSS-Protection=0, frame-ancestors theo môi trường và HSTS ở production`
10. `Security 4 (Strict Origin & Protocol when COOKIE_CROSS_SITE=true): Thiếu Origin hoặc lệch giao thức (http vs https) bị chặn 403; khi tắt COOKIE_CROSS_SITE giữ như hiện tại`
11. `Security 5 (Production Config Guard): Khi RENDER=true hoặc PRODUCTION_STRICT=true mà COOKIE_CROSS_SITE=true thì server từ chối khởi động và báo rõ lý do`
12. `Security 6 (Dual-Mode Protocol Resolution: Preview Cross-Site vs Production Strict): Suy luận https từ APP_URL/*.run.app chỉ chạy khi COOKIE_CROSS_SITE=true và !isProd; ở Production (RENDER=true / PRODUCTION_STRICT=true) chỉ dùng X-Forwarded-Proto theo số hop, lệch giao thức thì chặn 403`
13. `Security 7 (Non-JSON HTML Error Handling & db:secure-dev-accounts): Giao diện hiển thị đúng thông báo theo HTTP status khi nhận HTML 403/500; script secureDevAccounts đổi mật khẩu mẫu, giữ nguyên dữ liệu và từ chối chạy ở Production`
14. `Hardening 1 (Multi-Item Order Deadlock Prevention): Hai đơn song song có thứ tự món đảo ngược ([varA, varB] vs [varB, varA]) được sắp xếp theo variantId trước khi UPDATE, không deadlock và trừ kho chính xác`
15. `Hardening 2a (Voucher Row Locking for per_user_limit): Khóa dòng voucher trong transaction trước khi kiểm tra per_user_limit chặn 2 đơn song song của cùng 1 người vượt giới hạn`
16. `Hardening 2b (Voucher usage_limit IS NULL Support): Voucher có usage_limit IS NULL hoạt động đúng ở cả /api/vouchers/validate và POST /api/orders`
17. `Hardening 3 (Order Zod Input Validation & Idempotency Address Mismatch): Kiểm tra số lượng 1-10, tối đa 50 dòng, regex SĐT VN, shippingAddress <= 300, Idempotency-Key <= 64, 422 khi tái dùng khóa khác địa chỉ và thông báo phương thức thanh toán đầy đủ`
18. `Hardening 4 & Phần 1.5 (Scoped Lazy Cleanup Before Pending Limit & Order Rate Limit): Trước khi đếm 3 đơn chờ thanh toán, tự động dọn dẹp đơn quá hạn 30 phút của chính user đó (hoàn kho & voucher 1 lần) để khách không bị chặn oan; chặn đơn chờ thứ 4 còn hạn và chặn vượt 10 đơn/giờ`
19. `Hardening 5 (Shared Server Shipping Fee Calculation): Đổi store_settings thì cả 3 nơi (GET /api/cart, POST /api/vouchers/validate, POST /api/orders) cùng đổi; validate voucher không nhận subtotal/shippingFee từ client`
20. `Hardening 6 (Voucher Validate Input Limits & Public Fields Only): POST /api/vouchers/validate kiểm tra items tối đa 50 dòng, quantity 1-10 và chỉ trả các trường công khai (không lộ id, used_count, usage_limit, per_user_limit)`
21. `Hardening 7 (Merge Guest Cart Cap 10 & Stock Limit): Sau khi gộp giỏ khách vãng lai vào giỏ người dùng, mỗi dòng không vượt 10 và không vượt tồn kho (LEAST(..., 10, stock))`
22. `Hardening 8 (Concurrent Cart Upsert via ON CONFLICT): Hai hoặc nhiều request POST /api/cart song song không tạo dòng trùng và không vượt trần 10`
23. `Hardening 9 & Phần 1.3 & Phần 1.4 (Webhook RawBody HMAC Only, VietQR-Only & Admin-Only payment_events): Webhook chỉ nhận chữ ký HMAC trên rawBody kèm timestamp 5 phút (bỏ secret thô), chặn đơn COD, và khi lệch tiền ghi vào bảng riêng payment_events (chỉ Admin đọc được, không ghi order_status_history)`
24. `Hardening 10 (500 Error Sanitization on Orders, Payments, Cart & Vouchers): Khi xảy ra lỗi 500 hệ thống/SQL, phản hồi chỉ trả thông báo chung kèm mã INTERNAL_SERVER_ERROR, tuyệt đối không lộ err.message hay tên bảng SQL`
25. `Hardening 11 & Phần 1.8 (optionalAuth 503 DB_UNAVAILABLE & UI Preserves Session/Cart): optionalAuth trả 503 DB_UNAVAILABLE khi DB lỗi; giao diện hiện "Hệ thống đang bận, vui lòng thử lại" và không đăng xuất người dùng hay xóa giỏ`
26. `Hardening 12 (JWT Ephemeral Dev Secret, PRODUCTION_STRICT Guard, HS256 & 12h/7d Expiry): JWT không dùng khóa cố định, chặn thiếu JWT_SECRET ở PRODUCTION_STRICT=true, chỉ nhận HS256, thời hạn Admin 12h và Khách 7d`
27. `Hardening 13 (Bounded In-Memory Rate Limiters with Pruning & FIFO Eviction): Bộ đếm rate limit tự dọn mục hết hạn và cắt giảm kích thước về đúng trần maxEntries, kèm ẩn token khôi phục trong log`
28. `Phần 1.3 (RLS Enabled on All Application Tables & New Migrations): Tất cả bảng ứng dụng đều có pg_class.relrowsecurity = true và các migration tạo bảng mới (payment_events, uploads) đều có ALTER TABLE ... ENABLE ROW LEVEL SECURITY ngay trong migration`
29. `Phần 1.4 (GET /api/orders/:id/payment-events Router Middleware requireAdmin & Zero Extra PII): Endpoint dùng requireAdmin ở tầng router; chưa đăng nhập trả 401, khách trả 403, admin trả 200 và không trả dữ liệu cá nhân thừa`
30. `Phần 1.5 & Mục 7 (Dev-Only CLI dev:set-order-status): Bắt buộc ALLOW_DEV_TOOLS=true, in cảnh báo rõ host database, chuyển trạng thái đơn theo máy trạng thái kèm order_status_history và delivered_at; từ chối chạy ở Production; không lộ PII`
31. `Phần 2.3 (Single Auth Middleware & Route Security Audit): Chỉ tồn tại duy nhất server/services/auth.ts; mọi route POST/PUT/PATCH/DELETE đều có requireAuth/requireAdmin hoặc nằm trong PUBLIC_MUTATING_ROUTE_ALLOWLIST kèm lý do; /api/admin/*, payment-events, cập nhật trạng thái đổi trả và trả lời đánh giá đều có requireAdmin; thêm route mới thiếu middleware sẽ làm test hỏng`
32. `Canary Route Coverage (Every Router & Stage 8c/8d/6d): collectExpressRoutes thu thập đầy đủ ít nhất 26 route đại diện từ MỌI router (bao gồm 8c, 8d, 6d) và báo lỗi ngay nếu thiếu bất kỳ route nào`
33. `Two-Level Nested Router Security Audit Self-Check: Gắn router lồng 2 tầng chứa route POST thiếu xác thực vào createApp(), chứng minh collectExpressRoutes và bộ kiểm toán phát hiện ngay`

### `tests/stage6a_reviews.test.ts` (12 tests)

1. `Step 6a.1: Chỉ người đã mua sản phẩm trong đơn delivered hoặc completed mới được đánh giá`
2. `Step 6a.2: Mỗi (user_id, product_id, order_id) chỉ được tối đa 1 đánh giá`
3. `Step 6a.3: Nội dung lưu & trả dạng văn bản thuần và kiểm tra chặt rating/comment bằng Zod`
4. `Step 6a.4 (Mục 7a): Đường dẫn ảnh đánh giá trong bucket công khai KHÔNG chứa userId; xác minh quyền sở hữu qua bảng uploads và giới hạn tối đa 3 ảnh`
5. `Step 6a.5: Tên người đánh giá được rút gọn (maskReviewerName), không lộ email hay số điện thoại`
6. `Step 6a.6: Rate limit chặn 429 khi gửi vượt 5 đánh giá/10 phút và giới hạn kích thước bộ đếm trong RAM`
7. `Step 6a.7: Lỗi 500 tại reviews không lộ chi tiết SQL hay thông báo lỗi nội bộ`
8. `Step 6a.8 (Mục 6a): PUT /api/reviews/:id và DELETE /api/reviews/:id chỉ cho phép chủ đánh giá (kể cả Admin cũng nhận 403 ở 6a); sửa không được đổi đơn hay sản phẩm`
9. `Step 6a.9 (Mục 6b): GET /api/products/:slug/reviews hỗ trợ phân trang, lọc theo sao, sắp xếp (newest, rating_desc, rating_asc), trả điểm TB, tổng đánh giá, phân bố sao, cờ Đã mua hàng và phản hồi người bán`
10. `Step 6a.10 (Mục 7b): Server tái mã hóa ảnh bằng sharp xóa sạch metadata EXIF/GPS và kiểm tra file thật sự tồn tại trong Storage trước khi lưu đánh giá`
11. `Step 6a.11 (Mục 8): PUT /api/reviews/:id/reply dùng middleware requireAdmin ở tầng router; chỉ nhận văn bản thuần tối đa 1000 ký tự`
12. `Step 6a.12 (Mục 5 & 6): Đối chiếu ratingAvg và reviewCount sau khi thêm, sửa, xóa đánh giá khớp tuyệt đối với SQL; giao diện tách riêng ReviewSection.tsx`

### `tests/stage6b_policies_faq.test.ts` (9 tests)

1. `Bước 6b.1: GET /api/policies, GET /api/policies/:slug và GET /api/faq truy cập công khai (200) không cần đăng nhập, có Cache-Control ngắn và không lộ trường nội bộ`
2. `Bước 6b.2: GET /api/policies/:slug với slug không tồn tại trả 404 gọn gàng`
3. `Bước 6b.3: Chống XSS — nội dung có <script>, <iframe>, onerror hoặc javascript: trong DB không bao giờ được thực thi hay render thành HTML thô, liên kết ngoài tự gắn rel="noopener noreferrer" target="_blank"`
4. `Bước 6b.4: Nội dung chính sách và FAQ tự động cập nhật số liệu khi thay đổi cấu hình store_settings (không lệch lời hứa với quy tắc chạy thật)`
5. `Bước 6b.5: Khi DB gặp sự cố bất ngờ, các API /api/policies và /api/faq trả 500 kèm thông báo chung an toàn (không lộ chi tiết SQL hay err.message)`
6. `Bước 6b.6: interpolatePolicyContent() không bao giờ để lộ chuỗi thô {{...}} ra giao diện; biến thiếu tự dùng giá trị mặc định và ghi cảnh báo log`
7. `Bước 6b.7: Seed chính sách và FAQ theo slug độc lập với ENABLE_SEED_DEMO_DATA, chèn khi slug chưa có và KHÔNG ghi đè nội dung đã chỉnh sửa của slug đã tồn tại`
8. `Bước 6b.8 (Phần 1 Mục 1a-1f): Chính sách & FAQ không chứa thông tin giả (1900 8888, cskh@baity.vn), ánh xạ đúng tên ngân hàng từ VIETQR_BANK_ID, sửa chủ đề faq-ai-features, nêu rõ ví/thẻ thử nghiệm và đơn vị xử lý dữ liệu kỹ thuật`
9. `Bước 6b.9 (Phần 1 Mục 4 & 5): Không lặp 2 lần cụm "Cửa hàng chưa cập nhật thông tin liên hệ" trong cùng một câu, và cập nhật store_settings đổi cả dữ liệu Banner (/api/settings/general) lẫn Chính sách (/api/policies/shipping)`

### `tests/stage6c_chatbot.test.ts` (17 tests)

1. `Bước 6c.1 (Mục 7 - Độ dài tin nhắn): Từ chối tin nhắn vượt quá 500 ký tự với mã 400 MESSAGE_TOO_LONG mà không gọi Gemini`
2. `Bước 6c.2 (Mục 7 - Giới hạn lịch sử hội thoại): Tự động cắt lịch sử hội thoại chỉ giữ tối đa 10 tin nhắn gần nhất gửi lên mô hình`
3. `Bước 6c.3 (Mục 7 - Rate limit theo người dùng / IP): Chặn yêu cầu vượt ngưỡng giới hạn tần suất (429 CHAT_RATE_LIMIT_EXCEEDED)`
4. `Bước 6c.4 (Mục 7 - Trần số lần gọi Gemini toàn hệ thống trong ngày): Khi vượt trần ngày, trả thông báo tạm nghỉ lịch sự và không gọi Gemini`
5. `Bước 6c.5 (Mục 7 - Timeout khi gọi Gemini): Ngắt yêu cầu và trả 504 CHAT_TIMEOUT thân thiện khi Gemini phản hồi quá thời gian quy định`
6. `Bước 6c.6 (Mục 7 - Xử lý lỗi Gemini an toàn): Khi Gemini gặp lỗi bất ngờ, trả 503 thân thiện, không làm sập server và không lộ chi tiết lỗi nội bộ hay khóa API`
7. `Bước 6c.7 (Mục 8 - Coi đầu vào người dùng là dữ liệu, chống Prompt Injection): Đóng gói input trong thẻ dữ liệu tách biệt và từ chối yêu cầu vượt quyền/bỏ qua chỉ dẫn`
8. `Bước 6c.8 (Mục 8 - Không tiết lộ System Prompt, khóa bí mật hoặc dữ liệu nhạy cảm): Bộ lọc hậu kiểm chặn ngay cả khi mô hình cố tình in ra marker hoặc khóa bí mật`
9. `Bước 6c.9 (Mục 8 - Cô lập tra cứu đơn hàng theo đúng phiên đăng nhập): Chỉ tra cứu đơn của chính người đang đăng nhập; từ chối khách chưa đăng nhập và từ chối tra cứu mã đơn của người khác`
10. `Bước 6c.10 (Mục 8 - Đối chiếu sản phẩm gợi ý với Database): Giữ lại sản phẩm có thật trong DB và tự động gỡ bỏ đường dẫn sản phẩm do AI tự bịa`
11. `Bước 6c.11 (Mục 8 - Chính sách và FAQ lấy trực tiếp từ bảng faq_policies): Ngữ cảnh chính sách cung cấp cho Chatbot phản ánh đúng dữ liệu thực trong bảng faq_policies và store_settings`
12. `Bước 6c.12 (Phần 1 Mục 1 - Không lộ khóa bí mật trong bản build dist/): Chạy npm run build và quét toàn bộ thư mục dist không chứa chuỗi AIza... hay giá trị thật của GEMINI_API_KEY, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, DATABASE_URL`
13. `Bước 6c.13 (Phần 1 Mục 3 - Bộ đếm trần ngày và trần theo người dùng/IP nguyên tử trong Database chạy song song): Lưu trong bảng chatbot_daily_counters, cấu hình qua store_settings và chặn chính xác khi gửi song song`
14. `Bước 6c.14 (Phần 1 Mục 4 - Chống thoát khỏi dấu phân cách </du_lieu_khach_hang_khong_tin_cay>): Vô hiệu hóa thẻ đóng giả mạo trong tin nhắn và lịch sử hội thoại, đảm bảo system prompt không chứa bí mật`
15. `Bước 6c.15 (Phần 1 Mục 5a, 5b, 5d, 5e - Tư vấn bảng size từ store_settings, từ chối câu hỏi ngoài phạm vi, SafeMarkdown chống XSS và gợi ý liên hệ cửa hàng)`
16. `Bước 6c.16 (Phần 1 Mục 6a & 6b - Băm IP bằng HMAC-SHA256 và tự động xóa các dòng chatbot_daily_counters cũ hơn 2 ngày): Không lưu IP thô trong DB và xóa chính xác các dòng quá 2 ngày`
17. `Bước 6c.17 (Phần 1 Mục 1 - Chọn ngữ cảnh theo từng câu hỏi, không kèm đơn hàng khi hỏi chính sách/chung, dưới trần ký tự và chỉ hạ timeout xuống console.warn)`

### `tests/stage6d_seller_chat.test.ts` (14 tests)

1. `Stage 6d.1: Chưa đăng nhập gọi các API chat với người bán (/api/chat/conversations*) nhận 401 UNAUTHORIZED`
2. `Stage 6d.2: Khách A không đọc hoặc gửi được tin nhắn vào hội thoại của khách B (trả 404 CHAT_CONVERSATION_NOT_FOUND ở mọi đường dẫn và tham số)`
3. `Stage 6d.3: Khách hàng thường gọi các API quản trị hỏi đáp (/api/admin/chats*) nhận 403 FORBIDDEN`
4. `Stage 6d.4: Từ chối tin nhắn rỗng hoặc chỉ chứa khoảng trắng (400 EMPTY_CHAT_MESSAGE) và từ chối đính kèm tệp/ảnh (400 CHAT_ATTACHMENT_FORBIDDEN)`
5. `Stage 6d.5: Từ chối tin nhắn dài quá 1000 ký tự (400 CHAT_MESSAGE_TOO_LONG)`
6. `Stage 6d.6: Từ chối gửi thêm tin nhắn khi hội thoại đã đạt trần 500 tin nhắn (400 CHAT_CONVERSATION_MESSAGE_LIMIT), tự động đóng hội thoại cũ và cho phép bắt đầu hội thoại mới không mang theo tin cũ`
7. `Stage 6d.7: Giới hạn tần suất gửi tin nhắn (20 tin / 10 phút / người dùng) — tin thứ 21 trả 429 SELLER_CHAT_RATE_LIMIT_EXCEEDED kèm header Retry-After`
8. `Stage 6d.8: Tạo hội thoại đồng thời bằng Promise.all vẫn chỉ sinh duy nhất 1 hội thoại mở cho mỗi khách hàng`
9. `Stage 6d.9: Admin trả lời qua POST /api/admin/chats/:id/messages và khách nhận được tin nhắn mới qua polling GET /api/chat/conversations/me?after=<id>, kèm đánh dấu đã đọc POST /api/chat/conversations/me/read`
10. `Stage 6d.10: Admin đóng hội thoại (PATCH /api/admin/chats/:id/status ghi audit log trong cùng giao dịch); khách nhắn tin mới vào hội thoại đã đóng sẽ tự động mở lại (status = open, closed_at = null)`
11. `Stage 6d.11: Chat với người bán tuyệt đối KHÔNG gọi Gemini và KHÔNG ghi nội dung tin nhắn ra console log`
12. `Stage 6d.12: Tác vụ dọn dẹp định kỳ (POST /api/tasks/cron-cleanup) tự động xóa hội thoại đã đóng quá 180 ngày (giữ nguyên hội thoại đang mở và hội thoại đóng chưa tới 180 ngày); xóa tài khoản khách hàng tự động xóa hội thoại theo ON DELETE CASCADE`
13. `Stage 6d.13: Danh sách hội thoại Admin (GET /api/admin/chats) chỉ trả tên hiển thị rút gọn, tuyệt đối KHÔNG chứa email, số điện thoại hay địa chỉ của khách hàng`
14. `Stage 6d.14: Nội dung chứa thẻ <script> được lưu nguyên bản (chỉ cắt khoảng trắng hai đầu, không cắt thẻ HTML) và luôn hiển thị dưới dạng văn bản thuần (escaped trong giao diện SellerChatPanel & SellerChatsAdminPage, không thực thi mã độc); cảnh báo nhạy cảm hiển thị rõ ràng`

### `tests/stage7_visual_search.test.ts` (14 tests)

1. `1. Gemini trả JSON sai schema hoặc giá trị ngoài bộ từ vựng: giá trị lạ bị loại bỏ, confidence được kẹp trong 0..1 và lỗi JSON xử lý êm`
2. `2. Ảnh không phải quần áo (isApparel=false): trả thông báo rõ ràng và 0 sản phẩm`
3. `3. Sản phẩm Unisex khớp khi tìm đồ Nam hoặc Nữ; sản phẩm khác giới bị trừ điểm xếp dưới`
4. `4. Sản phẩm ẩn (is_active=false) hoặc hết sạch tồn kho (stock_quantity=0) không bao giờ xuất hiện trong kết quả`
5. `5. Vượt giới hạn tần suất (nhiều yêu cầu song song): chặn đúng bằng bộ đếm nguyên tử trong DB trước khi gọi Gemini`
6. `6. Sai loại file (.pdf/.svg), đổi đuôi giả (.jpg chứa nội dung văn bản) và vượt dung lượng (>5MB) bị từ chối HTTP 400`
7. `7. Sau khi gọi POST /api/visual-search, bảng uploads có 0 dòng mới và Storage có 0 đối tượng mới`
8. `8. ai_search_logs không chứa ảnh hay văn bản tự do và tự xóa bản ghi quá 90 ngày`
9. `9. POST /api/visual-search/refine cập nhật kết quả theo bộ lọc đã sửa và KHÔNG gọi Gemini`
10. `10. Quét bản build dist: không lộ khóa AIza... hoặc giá trị bí mật ra mã trình duyệt`
11. `11. Ngưỡng độ tin cậy (confidence < 0.5): coi như không nhận diện được (LOW_CONFIDENCE), trả thông báo thân thiện và lưu cột confidence dạng số vào ai_search_logs`
12. `12. Giới hạn theo phút cho POST /api/visual-search/refine: vượt ngưỡng trả HTTP 429 REFINE_RATE_LIMIT`
13. `13. Giao diện /visual-search (VisualSearchPage component & client flow): chọn file sai định dạng hiện lỗi; chọn ảnh hợp lệ hiện thẻ thuộc tính & lưới kết quả; sửa thẻ thuộc tính gọi refine (0 lần gọi Gemini); hết lượt (429) hiện thông báo; nội dung hiển thị được thoát chuỗi thuần (plain text)`
14. `14. Kiểm tra tự động ảnh chính sản phẩm (không gọi Gemini): không có hai sản phẩm KHÁC loại dùng chung một URL ảnh chính`

### `tests/stage8a_admin.test.ts` (21 tests)

1. `Bước 8a.1a: Khách chưa đăng nhập gọi bất kỳ route /api/admin/* nào đều nhận HTTP 401`
2. `Bước 8a.1b: Khách hàng thường (role=customer) gọi bất kỳ route /api/admin/* nào đều nhận HTTP 403`
3. `Bước 8a.1c: Tài khoản Admin (role=admin) gọi GET /api/admin/me nhận HTTP 200 kèm số liệu tổng quan`
4. `Bước 8a.2a: Toàn bộ file route trong server/routes/*.ts không có câu lệnh UPDATE users thay đổi cột role`
5. `Bước 8a.2b: Người dùng gửi role="admin" qua PUT /api/user/profile không thể tự nâng quyền trong DB`
6. `Bước 8a.3a: GET /api/admin/orders ẩn PII (receiverName, receiverPhone) trên danh sách nhưng GET /api/admin/orders/:id hiển thị đầy đủ trong chi tiết đơn`
7. `Bước 8a.3b (Mục 5b): GET /api/admin/orders hỗ trợ lọc theo khoảng ngày (fromDate, toDate) và tìm kiếm theo 4 số cuối SĐT hoặc tên người nhận mà vẫn giữ ẩn PII`
8. `Bước 8a.3c: PUT /api/admin/orders/:id/status kiểm tra expectedStatus và trả HTTP 409 Conflict khi trạng thái hiện tại không khớp`
9. `Bước 8a.3d: Chuyển trạng thái đơn sang shipping bắt buộc phải có trackingCode hợp lệ (thiếu trả 400, đủ trả 200)`
10. `Bước 8a.3e: Chuyển trạng thái đơn sang delivered tự động ghi nhận delivered_at`
11. `Bước 8a.5a: POST /api/admin/orders/:id/confirm-payment xác nhận thanh toán VietQR thủ công đặt payments.status = "paid" và hoạt động Idempotent khi gọi lặp`
12. `Bước 8a.5b: POST /api/admin/orders/:id/confirm-payment từ chối đơn đã hủy hoặc quá hạn với HTTP 400 ORDER_EXPIRED_OR_CANCELLED`
13. `Bước 8a.5c (Phần 1 Mục 2.i): Đơn VietQR được Admin xác nhận thanh toán thủ công rồi bị hủy thì tạo đúng yêu cầu hoàn tiền và đặt payments.status = "refund_needed"`
14. `Bước 8a.5d (Phần 1 Mục 2.ii): Webhook gọi lặp sau khi Admin đã xác nhận thanh toán thủ công không tạo bản ghi hay lịch sử trùng`
15. `Bước 8a.5e (Phần 1 Mục 2.iii): Đơn VietQR đã được Admin xác nhận thủ công không bị hủy tự động sau 30 phút`
16. `Bước 8a.6a: Từ chối yêu cầu đổi trả bắt buộc phải có lý do từ chối (thiếu trả HTTP 400)`
17. `Bước 8a.6b: Duyệt đổi trả do Server tự tính lại số tiền hoàn kèm phí vận chuyển, bỏ qua số tiền giả mạo từ client`
18. `Bước 8a.6c: Xác nhận đã nhận hàng trả về kho (POST /api/admin/returns/:id/receive) chỉ cộng hoàn kho đúng 1 lần duy nhất`
19. `Bước 8a.6d: Đánh dấu hoàn tiền (POST /api/admin/returns/:id/refund) hoạt động Idempotent và tổng tiền hoàn tích lũy của đơn không vượt tổng tiền đã trả`
20. `Bước 8a.7a (Mục 5c): GET /api/admin/payment-issues và POST /api/admin/payment-issues/:type/:id/resolve đánh dấu sự cố đã xử lý và ghi admin_audit_logs trong cùng giao dịch`
21. `Bước 8a.7b: Nhật ký admin_audit_logs bị rollback hoàn toàn nếu giao dịch thất bại và không lộ PII khách hàng`

### `tests/stage8b_catalog_inventory.test.ts` (19 tests)

1. `Bước 8b.1a: Khách chưa đăng nhập gọi mọi route 8b đều bị chặn với HTTP 401`
2. `Bước 8b.1b: Khách thường (role=customer) gọi mọi route 8b đều bị chặn với HTTP 403`
3. `Bước 8b.2a: Tạo danh mục cha (Cấp 1) và danh mục con (Cấp 2) thành công, tự sinh slug và chặn trùng slug (409)`
4. `Bước 8b.2b: Chặn tạo danh mục cấp 3 (tối đa 2 cấp cha -> con)`
5. `Bước 8b.2c: Chặn tự trỏ parent_id vào chính mình và chặn tạo vòng lặp A -> B -> A`
6. `Bước 8b.2d: Chặn xóa cứng danh mục đang có danh mục con hoặc đang có sản phẩm (400)`
7. `Bước 8b.3a: Tạo sản phẩm mới trong 1 giao dịch nguyên tử (sản phẩm + biến thể + ảnh + thuộc tính + stock_movements khởi tạo + audit log)`
8. `Bước 8b.3b: Chặn tạo sản phẩm có salePrice > basePrice (400), trùng SKU (409) hoặc trùng cặp (màu, kích cỡ) trong cùng sản phẩm (400)`
9. `Bước 8b.3c: Rollback giao dịch tạo sản phẩm nếu bước giữa chừng gặp lỗi (không để lại sản phẩm mồ côi)`
10. `Bước 8b.3d: Tải ảnh sản phẩm qua POST /api/upload với purpose="product": chỉ Admin được phép (khách thường nhận 403), đường dẫn lưu products/<16-hex>/<uuid>.jpg không chứa userId và xóa sạch EXIF`
11. `Bước 8b.3e: Chặn xóa biến thể (400) hoặc xóa cứng sản phẩm đã phát sinh trong order_items (409 PRODUCT_HAS_ORDERS); sản phẩm chưa bán được xóa cứng kèm ảnh, thuộc tính, stock_movements và biến thể trong cùng giao dịch kèm audit log`
12. `Bước 8b.3f (Mục 6): POST/PUT /api/admin/products từ chối URL ảnh ngoài hoặc đường dẫn tùy ý không có trong bảng uploads (purpose="product") với HTTP 400 INVALID_PRODUCT_IMAGE_SOURCE; loại bỏ thẻ <script> và <img onerror> trong tên danh mục, tên/mô tả/thuộc tính sản phẩm`
13. `Bước 8b.3g (Mục 7): Quét mã nguồn server đảm bảo không có bất kỳ file nào ngoài server/services/orderStateMachine.ts tự ý cập nhật cột status của bảng orders`
14. `Bước 8b.4a: Điều chỉnh tồn kho bắt buộc ghi chú khi reason="other" và khớp tổng biến động trong stock_movements`
15. `Bước 8b.4b (Mục 8): Lý do điều chỉnh kho ngoài danh sách cho phép bị từ chối (400) và delta = 0 bị từ chối (400)`
16. `Bước 8b.4c (Mục 8): Trừ vượt tồn hiện tại trả HTTP 409 (INSUFFICIENT_STOCK_FOR_ADJUSTMENT) và không tạo dòng stock_movements mới`
17. `Bước 8b.4d (Mục 8): Phân trang GET /api/admin/variants/:id/stock-movements hoạt động chính xác`
18. `Bước 8b.4e (Mục 8): GET /api/admin/inventory?lowStockOnly=true lọc đúng theo ngưỡng lowStockThreshold trong store_settings`
19. `Bước 8b.4f (Mục 8): Ghi nhận admin_audit_logs (VARIANT_STOCK_ADJUST) trong cùng giao dịch khi điều chỉnh tồn kho`

### `tests/stage8c_vouchers_promotions_settings_policies.test.ts` (18 tests)

1. `Bước 8c.1a: Khách chưa đăng nhập (401) bị từ chối ở toàn bộ route /api/admin/* của Giai đoạn 8c`
2. `Bước 8c.1b: Khách hàng thường role=customer (403) bị từ chối ở toàn bộ route /api/admin/* của Giai đoạn 8c và kiểm toán route toàn hệ thống xanh`
3. `Bước 8c.2a: Kiểm thử biên table-driven cho Voucher (percent 0 và 101, fixed 0, code 2 và 33 ký tự, ký tự đặc biệt, startDate >= endDate)`
4. `Bước 8c.2b: Tạo Voucher hợp lệ (chuẩn hóa uppercase, lọc HTML, múi giờ GMT+7 -> UTC, chống trùng 409, từ chối DELETE 400)`
5. `Bước 8c.2c: Voucher đã có lượt sử dụng KHÔNG được sửa code, discountType, discountValue; usageLimit không nhỏ hơn usedCount; xung đột cập nhật trả 409`
6. `Bước 8c.3a: Xem trước phạm vi khuyến mãi (POST /api/admin/promotions/preview) tính đúng số sản phẩm ảnh hưởng và giá trước/sau`
7. `Bước 8c.3b: Kiểm thử biên table-driven cho Promotion (discountPercent 0 và 81, thời lượng 91 ngày, startTime sau endTime)`
8. `Bước 8c.3c: Tạo Flash Sale đang diễn ra có hiệu lực tức thì trên cửa hàng, giỏ hàng và đơn đặt hàng`
9. `Bước 8c.3d: Kết thúc sớm chương trình khuyến mãi cập nhật ngay giá giỏ hàng về giá gốc nhưng giữ nguyên giá snapshot của đơn đã đặt`
10. `Bước 8c.4a: Cài đặt cửa hàng từ chối lưu số tài khoản ngân hàng, khóa API hoặc bí mật hệ thống (400 FORBIDDEN_SENSITIVE_SETTING) và VietQR chỉ hiển thị 4 số cuối`
11. `Bước 8c.4b: Kiểm thử biên table-driven cho Cài đặt cửa hàng (phí ship -1 và 500001, ngưỡng miễn phí 10000001, hạn đổi trả 0 và 31, mã số thuế 9 chữ số, SĐT sai, email sai, banner 121 ký tự)`
12. `Bước 8c.4c: Cập nhật cài đặt cửa hàng có hiệu lực tức thì ở /api/settings/general, /api/cart và nội suy chính sách /api/policies/return`
13. `Bước 8c.4d: Đơn hàng đã giao trước thời điểm giảm returnDaysLimit vẫn được bảo lưu thời hạn đổi trả cũ`
14. `Bước 8c.5a: Kiểm thử biên table-driven cho Chính sách (biến lạ {{...}}, nội dung 20001 ký tự, DELETE chính sách rơi vào 404 mặc định)`
15. `Bước 8c.5b: Cập nhật chính sách với SafeMarkdown (loại bỏ HTML thô), nội suy biến hợp lệ và khôi phục mặc định từ seed`
16. `Bước 8c.5c: Tạo mới, lọc HTML và ẩn/hiện câu hỏi FAQ trên trang công khai GET /api/faq`
17. `Bước 8c.6a: Sửa một voucher, một promotion, một cài đặt, gọi lại seedDatabase() và xác nhận giá trị đã sửa vẫn còn nguyên; REFRESH_DEMO_SALE bị từ chối ở production`
18. `Bước 8c.7: Các component giao diện quản trị Giai đoạn 8c (AdminLayout, VouchersPage, PromotionsPage, StoreSettingsPage, PoliciesFaqPage) tách riêng và render đầy đủ các tab/trạng thái`

### `tests/stage8d_reviews_overview_stats.test.ts` (19 tests)

1. `Stage 8d.1a: Chưa đăng nhập (401) bị từ chối ở toàn bộ route /api/admin/* của Giai đoạn 8d`
2. `Stage 8d.1b: Khách hàng thường (role=customer) bị từ chối (403) ở toàn bộ route /api/admin/* của Giai đoạn 8d`
3. `Stage 8d.2a: Chuẩn bị 2 đánh giá hợp lệ (5 sao và 1 sao) và kiểm tra GET /api/admin/reviews lọc theo sao, sản phẩm, phản hồi, hiển thị`
4. `Stage 8d.2b: Admin phản hồi đánh giá (PUT /api/reviews/:id/reply) lưu sellerReply và ghi admin_audit_logs`
5. `Stage 8d.2c: Admin ẩn đánh giá vi phạm (PATCH /api/admin/reviews/:id/visibility) bắt buộc có lý do, loại khỏi trang sản phẩm, tính lại rating_avg và ghi audit log`
6. `Stage 8d.2d: Admin cố sửa nội dung hoặc số sao (PUT /api/reviews/:id) hay xóa (DELETE /api/reviews/:id) đánh giá của khách bị từ chối 403`
7. `Stage 8d.3: GET /api/admin/overview trả đúng 6 số đếm vận hành và tuyệt đối không chứa thông tin cá nhân (PII)`
8. `Stage 8d.4a: Thống kê doanh thu thực (đơn đã giao trừ hoàn tiền hoàn tất), giá trị đơn đặt (đơn không hủy) và biên ngày theo múi giờ Asia/Ho_Chi_Minh (23:30 UTC sang ngày hôm sau ở GMT+7)`
9. `Stage 8d.5a: Từ chối khoảng ngày không hợp lệ (from > to, vượt quá 366 ngày, granularity sai)`
10. `Stage 8d.5b: Số câu truy vấn SQL của GET /api/admin/stats/overview là hằng số, không tăng theo độ dài khoảng ngày (không N+1)`
11. `Stage 8d.6: Các endpoint /api/admin/stats/products, /api/admin/stats/vouchers, /api/admin/stats/visual-search trả đúng cấu trúc tổng hợp SQL`
12. `Stage 8d.7a: Xuất CSV đơn hàng (type=orders) không chứa tên, SĐT, email, địa chỉ người nhận và ghi nhận EXPORT_STATS_CSV vào admin_audit_logs`
13. `Stage 8d.7b: Xuất CSV sản phẩm (type=products) tự động thêm dấu nháy đơn (\') trước mọi ô bắt đầu bằng =, +, -, @, tab hoặc xuống dòng (chống CSV Formula Injection)`
14. `Stage 8d.4b: Cột cố định return_requests.refunded_at — ghi một lần khi chuyển sang completed; sửa mô tả/ghi chú sau khi hoàn tiền (updated_at thay đổi) KHÔNG làm lệch kỳ thống kê doanh thu thực; định nghĩa nêu rõ phí vận chuyển`
15. `Stage 8d.7c: Kiểm tra riêng UTF-8 BOM (0xEF, 0xBB, 0xBF) ở đầu file CSV cho cả type=orders và type=products`
16. `Stage 8d.7d: Kiểm tra riêng chống Formula Injection với type=orders (ô bắt đầu bằng =, +, -, @ được tiền tố bằng dấu nháy đơn \')`
17. `Stage 8d.7e: Kiểm tra riêng giới hạn 50.000 dòng (MAX_CSV_EXPORT_ROWS = 50000) và cắt đúng số dòng tối đa khi xuất CSV`
18. `Stage 8d.7f: Kiểm tra riêng giới hạn tần suất (rate limit) xuất CSV trả 429 CSV_EXPORT_RATE_LIMIT khi vượt quá 10 lần/phút`
19. `Stage 8d.8: Các component giao diện Admin Giai đoạn 8d (OperationsOverviewPage, ReviewsAdminPage, StatsDashboardPage) render sạch không lỗi`

### `tests/stage9_production_readiness.test.ts` (15 tests)

1. `Stage 9.1a (RuntimeMode Single Source of Truth Scan — Item 1): Quét mã nguồn xác nhận process.env.RENDER, PRODUCTION_STRICT và APP_MODE chỉ xuất hiện duy nhất trong server/config/runtimeMode.ts`
2. `Stage 9.1b (RuntimeMode Exhaustive 108-Combination Matrix & Preview Warning — Item 1): Kiểm tra toàn bộ 108 tổ hợp NODE_ENV x RENDER x PRODUCTION_STRICT x APP_MODE x COOKIE_CROSS_SITE; xác nhận RENDER=false và COOKIE_CROSS_SITE=true không làm yếu strict, RENDER=true luôn thắng APP_MODE=preview, và kiểm tra thông báo AI Studio APP_MODE=preview`
3. `Stage 9.1c (Strict Startup Conditions & Universal USE_PGLITE Block — Item 2): Kiểm tra từng điều kiện chặn khởi động ở strict (chỉ nêu tên biến, không lộ giá trị) và xác nhận server/db/index.ts chặn USE_PGLITE ở mọi chế độ strict`
4. `Stage 9.1d (Admin Password Policy Across Modes — Item 3): Mật khẩu Admin bắt buộc >= 12 ký tự, có chữ và số, không thuộc danh sách cấm; nếu yếu ở preview/dev thì không tạo/cập nhật admin, ghi lỗi không lộ giá trị và không làm sập preview`
5. `Stage 9.2 (Strict Empty-DB Production Rehearsal Parts A & B — Item 4): Chạy prod:rehearsal ở chế độ strict thật (NODE_ENV=production, PRODUCTION_STRICT=true, không bật USE_PGLITE trong env), kiểm tra đủ Phần (a) và Phần (b) với PGlite tiêm qua hook test`
6. `Stage 9.3 (HTTPS Email Provider Brevo/Resend, No Default EMAIL_FROM & Production Zero-Log — Item 5): EMAIL_FROM không có mặc định; ở strict khi EMAIL_PROVIDER=brevo/resend thiếu EMAIL_FROM thì dừng khởi động, EMAIL_PROVIDER=log thì khởi động kèm cảnh báo không lộ token; timeout 8s`
7. `Stage 9.4 (Cron Cleanup 5 Tasks, Idempotency & 5,000 Orders Benchmark — Item 9): Thực hiện đủ 5 việc, chạy 2 lần liên tiếp bất biến (lần 2 trả toàn bộ số đếm = 0), và chạy nhanh trên 5.000 đơn mẫu (chỉ log số đếm)`
8. `Stage 9.5 (Admin Bootstrap Create-Only & Password Change Preservation — Item 1): ADMIN_INITIAL_PASSWORD chỉ tạo Admin khi CSDL chưa có Admin; đổi mật khẩu qua API rồi chạy lại seedDatabase() vẫn giữ mật khẩu mới và từ chối mật khẩu cũ; ở strict chỉ bắt buộc biến khi CSDL chưa có Admin`
9. `Stage 9.6 (loadContainerSecretsIfMissing Moved to scripts/ & Blocked in Strict — Item 2): Hàm loadContainerSecretsIfMissing đã xóa hoàn toàn khỏi server/, chỉ nằm trong scripts/load-container-env.ts, không chạy ở strict và không in giá trị bí mật`
10. `Stage 9.7 (Strict Production CSP vs Preview CSP & CSP_EXTRA_IMG_HOSTS — Item 3): CSP_EXTRA_IMG_HOSTS tùy chọn (để trống/không đặt, 1 tên miền, nhiều tên miền, sai định dạng bỏ qua kèm cảnh báo không in giá trị lạ và không dừng khởi động)`
11. `Stage 9.8 (Quick Product Images Admin API — Item 4): Kiểm tra 401/403, từ chối URL ngoài/sai định dạng/>5MB, tước bỏ EXIF, 409 khi expectedUpdatedAt lệch, bảo toàn ảnh cũ (is_primary=false), thêm ảnh mới (is_primary=true) và ghi admin_audit_logs trong cùng giao dịch`
12. `Stage 9.9 (Visual Search Neighboring Category Groups — Item 5): Khi nhận diện quan-jean-denim thì quan-tay-kaki vẫn được đưa vào nhưng xếp sau quan-jean-denim; khác nhóm không được điểm loại; giữ quy tắc unisex`
13. `Stage 9.10 (Canonical 29-Product Demo Seed & ENABLE_SEED_DEMO_DATA=true on Empty DB — Item 7): seed.ts có đúng 29 sản phẩm, đủ 9 danh mục (>= 3 mỗi danh mục), có áo khoác và quần short, không trùng ảnh chính khác loại, mọi ảnh trỏ tới public/seed-images và file tồn tại; ENABLE_SEED_DEMO_DATA=true trên CSDL trống tạo 29 sản phẩm và 0 tài khoản mẫu`
14. `Stage 9.11 (Source Code Export Check, Prompt Spec & Render Start Config — Items 3, 4, 5): export:check đạt toàn bộ tiêu chí (không lộ 7 mẫu khóa thật, không có .env, .gitignore không chặn public/seed-images hay *.svg, không có file > 5MB); prompt trong seed:images-plan bỏ "vải trơn", dùng "không logo thương hiệu, không chữ lạ", <= 60 từ; tsx nằm trong dependencies`
15. `Stage 9.12 (Strict Dev-DB & ADMIN_EMAIL Guard, Strict [PRODUCTION] Logs, Unified /api/health 200/503 & Hoodie #31 Material — Items 1, 2, 4, 6): ADMIN_EMAIL trùng email mẫu báo "ADMIN_EMAIL không được dùng email mẫu của dữ liệu thử"; CSDL có tài khoản/đơn mẫu nêu rõ nguyên nhân và không lộ giá trị; log strict không có [DEV/PREVIEW]/[DEV/TEST]; /api/health trả 200/503; Hoodie #31 giữ chất liệu "100% Cotton nỉ chân cua cao cấp"`

## 3. Danh sách Migration theo thứ tự (`migrations/meta/_journal.json`)

| Thứ tự (`idx`) | File Migration | Số dòng | SHA-256 (12 ký tự đầu) | Bảng tạo mới (`CREATE TABLE`) | Bật RLS (`ENABLE ROW LEVEL SECURITY`) | Bảng sửa (`ALTER TABLE`) | Index tạo / xóa |
| ---: | --- | ---: | --- | --- | --- | --- | --- |
| 0 | `migrations/0000_supreme_changeling.sql` | 350 | `ec2da5c5fa47` | `addresses`, `cart_items`, `categories`, `chat_conversations`, `chat_messages`, `faq_policies`, `order_items`, `order_status_history`, `orders`, `payments`, `product_attributes`, `product_images`, `product_variants`, `products`, `promotion_targets`, `promotions`, `return_requests`, `review_images`, `reviews`, `stock_movements`, `store_settings`, `users`, `voucher_usages`, `vouchers`, `wishlist_items` | 25 bảng (`users`, `addresses`, `categories`, `products`, `product_images`, `product_variants`, `product_attributes`, `cart_items`, `wishlist_items`, `vouchers`, `voucher_usages`, `promotions`, `promotion_targets`, `orders`, `order_items`, `order_status_history`, `payments`, `return_requests`, `stock_movements`, `reviews`, `review_images`, `chat_conversations`, `chat_messages`, `faq_policies`, `store_settings`) | `addresses`, `cart_items`, `chat_conversations`, `chat_messages`, `order_items`, `order_status_history`, `orders`, `payments`, `product_attributes`, `product_images`, `product_variants`, `products`, `promotion_targets`, `return_requests`, `review_images`, `reviews`, `stock_movements`, `voucher_usages`, `vouchers`, `wishlist_items`, `users`, `categories`, `promotions`, `faq_policies`, `store_settings` | Ext: `pg_trgm`; +26 index |
| 1 | `migrations/0001_phase2_constraints.sql` | 1 | `8c975954e663` | *(không)* | *(không)* | *(không)* | +2 index |
| 2 | `migrations/0002_glossy_mystique.sql` | 7 | `474887d7afdc` | *(không)* | *(không)* | 1 bảng (`orders`) | +3 index |
| 3 | `migrations/0003_lovely_iron_monger.sql` | 2 | `192f80baf070` | *(không)* | *(không)* | 1 bảng (`return_requests`) | *(không)* |
| 4 | `migrations/0004_tiresome_lucky_pierre.sql` | 0 | `dd7b77a7aa34` | *(không)* | *(không)* | 1 bảng (`addresses`) | *(không)* |
| 5 | `migrations/0005_clammy_randall_flagg.sql` | 4 | `b1ac9d8c038e` | *(không)* | *(không)* | 2 bảng (`vouchers`, `cart_items`) | *(không)* |
| 6 | `migrations/0006_icy_scarlet_spider.sql` | 12 | `d0d7a754d862` | `payment_events` | 1 bảng (`payment_events`) | `payment_events` | +1 index |
| 7 | `migrations/0007_loving_alex_power.sql` | 135 | `27b7d3ea9b60` | `uploads` | 1 bảng (`uploads`) | 22 bảng (`addresses`, `cart_items`, `chat_conversations`, `chat_messages`, `order_items`, `order_status_history`, `orders`, `payments`, `product_attributes`, `product_images`, `product_variants`, `products`, `promotion_targets`, `return_requests`, `review_images`, `reviews`, `stock_movements`, `voucher_usages`, `vouchers`, `wishlist_items`, `categories`, `users`) | +2 index; -10 index |
| 8 | `migrations/0008_chunky_runaways.sql` | 4 | `f8a7b2b40c70` | *(không)* | *(không)* | 4 bảng (`faq_policies`, `products`, `promotion_targets`, `vouchers`) | *(không)* |
| 9 | `migrations/0009_cold_joshua_kane.sql` | 33 | `f1d2a5e21914` | `admin_audit_logs`, `chatbot_daily_counters` | 2 bảng (`admin_audit_logs`, `chatbot_daily_counters`) | 5 bảng (`order_items`, `orders`, `product_variants`, `products`, `vouchers`) | +4 index |
| 10 | `migrations/0010_brief_winter_soldier.sql` | 10 | `246c02dfb5c1` | *(không)* | *(không)* | 5 bảng (`categories`, `payment_events`, `products`, `payments`, `uploads`) | *(không)* |
| 11 | `migrations/0011_free_hercules.sql` | 13 | `7619b636a8fb` | `ai_search_logs` | 1 bảng (`ai_search_logs`) | `ai_search_logs` | +1 index |
| 12 | `migrations/0012_perfect_wolverine.sql` | 7 | `a3b3f1df2c5e` | *(không)* | *(không)* | 5 bảng (`ai_search_logs`, `faq_policies`, `promotions`, `store_settings`, `vouchers`) | *(không)* |
| 13 | `migrations/0013_wide_lightspeed.sql` | 22 | `3ecf812395e1` | *(không)* | *(không)* | 2 bảng (`return_requests`, `reviews`) | +5 index |
| 14 | `migrations/0014_smiling_ender_wiggin.sql` | 36 | `0a5e64432f54` | *(không)* | 3 bảng (`return_requests`, `chat_conversations`, `chat_messages`) | 3 bảng (`chat_conversations`, `return_requests`, `chat_messages`) | +4 index |

## 4. Các script trong `package.json`

| Tên script | Lệnh thực thi |
| --- | --- |
| `dev` | `tsx server.ts` |
| `start` | `tsx server.ts` |
| `build` | `vite build` |
| `preview` | `vite preview` |
| `clean` | `rm -rf dist server.js` |
| `lint` | `tsc --noEmit` |
| `test` | `tsx scripts/check-schema-drift.ts && tsx scripts/export-check.ts && tsc --noEmit && node --import tsx --test tests/*.test.ts` |
| `test:pg` | `tsx scripts/check-schema-drift.ts && node --import tsx --test tests/pg/stage4_concurrency_pg.test.ts` |
| `db:generate` | `drizzle-kit generate` |
| `db:check` | `tsx scripts/check-schema-drift.ts` |
| `db:secure-dev-accounts` | `tsx scripts/secure-dev-accounts.ts` |
| `dev:set-order-status` | `tsx scripts/dev-set-order-status.ts` |
| `chat:smoke` | `tsx scripts/chat-smoke.ts` |
| `visual:smoke` | `tsx scripts/visual-smoke.ts` |
| `visual:eval` | `tsx scripts/visual-eval.ts` |
| `visual:audit-seed` | `tsx scripts/visual-audit-seed.ts` |
| `seed:images-report` | `tsx scripts/seed-images-report.ts` |
| `seed:images-check` | `tsx scripts/seed-images-check.ts` |
| `seed:images-plan` | `tsx scripts/seed-images-plan.ts` |
| `seed:images-fetch` | `tsx scripts/seed-images-fetch.ts` |
| `seed:apply-demo-catalog` | `tsx scripts/seed-apply-demo-catalog.ts` |
| `visual:stability` | `tsx scripts/visual-stability.ts` |
| `export:check` | `tsx scripts/export-check.ts` |
| `prod:rehearsal` | `tsx scripts/prod-rehearsal.ts` |
| `state` | `tsx scripts/project-state.ts` |

## 5. Danh sách Route Express (`server/routes/*` — Tổng cộng: **132** routes)

### 5.1. Thống kê số lượng Route theo tiền tố

| Tiền tố (`prefix`) | Số lượng route |
| --- | ---: |
| `/api/admin` | 60 |
| `/api/auth` | 7 |
| `/api/cart` | 7 |
| `/api/categories` | 1 |
| `/api/chat` | 5 |
| `/api/faq` | 1 |
| `/api/faq-policies` | 1 |
| `/api/health` | 1 |
| `/api/orders` | 8 |
| `/api/payments` | 1 |
| `/api/policies` | 2 |
| `/api/products` | 6 |
| `/api/returns` | 3 |
| `/api/reviews` | 5 |
| `/api/settings` | 2 |
| `/api/tasks` | 1 |
| `/api/upload` | 3 |
| `/api/user` | 7 |
| `/api/visual-search` | 3 |
| `/api/vouchers` | 4 |
| `/api/wishlist` | 4 |
| **Tổng cộng** | **132** |

### 5.2. Danh sách chi tiết từng Route

| Phương thức | Đường dẫn | Middleware xác thực | File định nghĩa |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | `(public)` | `server/routes/auth.ts` |
| `POST` | `/api/auth/login` | `(public)` | `server/routes/auth.ts` |
| `POST` | `/api/auth/logout` | `(public)` | `server/routes/auth.ts` |
| `GET` | `/api/auth/me` | `optionalAuth` | `server/routes/auth.ts` |
| `POST` | `/api/auth/forgot-password` | `(public)` | `server/routes/auth.ts` |
| `POST` | `/api/auth/reset-password` | `(public)` | `server/routes/auth.ts` |
| `POST` | `/api/auth/change-password` | `requireAuth` | `server/routes/auth.ts` |
| `GET` | `/api/user/profile` | `requireAuth` | `server/routes/user.ts` |
| `PUT` | `/api/user/profile` | `requireAuth` | `server/routes/user.ts` |
| `GET` | `/api/user/addresses` | `requireAuth` | `server/routes/user.ts` |
| `POST` | `/api/user/addresses` | `requireAuth` | `server/routes/user.ts` |
| `PUT` | `/api/user/addresses/:id` | `requireAuth` | `server/routes/user.ts` |
| `DELETE` | `/api/user/addresses/:id` | `requireAuth` | `server/routes/user.ts` |
| `PUT` | `/api/user/addresses/:id/set-default` | `requireAuth` | `server/routes/user.ts` |
| `GET` | `/api/products/featured` | `(public)` | `server/routes/products.ts` |
| `GET` | `/api/products/suggest` | `(public)` | `server/routes/products.ts` |
| `GET` | `/api/products/facets` | `(public)` | `server/routes/products.ts` |
| `GET` | `/api/products` | `(public)` | `server/routes/products.ts` |
| `GET` | `/api/products/:slug/reviews` | `optionalAuth` | `server/routes/products.ts` |
| `GET` | `/api/products/:slug` | `optionalAuth` | `server/routes/products.ts` |
| `GET` | `/api/cart` | `optionalAuth` | `server/routes/cart.ts` |
| `POST` | `/api/cart` | `optionalAuth` | `server/routes/cart.ts` |
| `PUT` | `/api/cart/:id` | `optionalAuth` | `server/routes/cart.ts` |
| `PUT` | `/api/cart` | `optionalAuth` | `server/routes/cart.ts` |
| `DELETE` | `/api/cart/:id` | `optionalAuth` | `server/routes/cart.ts` |
| `DELETE` | `/api/cart` | `optionalAuth` | `server/routes/cart.ts` |
| `POST` | `/api/cart/sync` | `requireAuth` | `server/routes/cart.ts` |
| `GET` | `/api/wishlist` | `requireAuth` | `server/routes/wishlist.ts` |
| `POST` | `/api/wishlist` | `requireAuth` | `server/routes/wishlist.ts` |
| `DELETE` | `/api/wishlist/:productId` | `requireAuth` | `server/routes/wishlist.ts` |
| `POST` | `/api/wishlist/:productId/move-to-cart` | `requireAuth` | `server/routes/wishlist.ts` |
| `GET` | `/api/vouchers/available` | `optionalAuth` | `server/routes/vouchers.ts` |
| `GET` | `/api/vouchers` | `optionalAuth` | `server/routes/vouchers.ts` |
| `POST` | `/api/vouchers/validate` | `optionalAuth` | `server/routes/vouchers.ts` |
| `POST` | `/api/vouchers/apply` | `optionalAuth` | `server/routes/vouchers.ts` |
| `POST` | `/api/orders` | `requireAuth` | `server/routes/orders.ts` |
| `GET` | `/api/orders` | `requireAuth` | `server/routes/orders.ts` |
| `GET` | `/api/orders/:id` | `requireAuth` | `server/routes/orders.ts` |
| `POST` | `/api/orders/:id/reorder` | `requireAuth` | `server/routes/orders.ts` |
| `GET` | `/api/orders/:id/payment-status` | `requireAuth` | `server/routes/orders.ts` |
| `GET` | `/api/orders/:id/payment-events` | `requireAuth, requireAdmin` | `server/routes/orders.ts` |
| `POST` | `/api/orders/:id/cancel` | `requireAuth` | `server/routes/orders.ts` |
| `PUT` | `/api/orders/:id/cancel` | `requireAuth` | `server/routes/orders.ts` |
| `POST` | `/api/payments/webhook` | `(public)` | `server/routes/orders.ts` |
| `POST` | `/api/returns` | `requireAuth` | `server/routes/returns.ts` |
| `GET` | `/api/returns` | `requireAuth` | `server/routes/returns.ts` |
| `GET` | `/api/returns/:id` | `requireAuth` | `server/routes/returns.ts` |
| `GET` | `/api/reviews` | `optionalAuth` | `server/routes/reviews.ts` |
| `POST` | `/api/reviews` | `requireAuth` | `server/routes/reviews.ts` |
| `PUT` | `/api/reviews/:id` | `requireAuth` | `server/routes/reviews.ts` |
| `DELETE` | `/api/reviews/:id` | `requireAuth` | `server/routes/reviews.ts` |
| `PUT` | `/api/reviews/:id/reply` | `requireAuth, requireAdmin` | `server/routes/reviews.ts` |
| `POST` | `/api/chat` | `optionalAuth` | `server/routes/chat.ts` |
| `POST` | `/api/chat/conversations` | `requireAuth` | `server/routes/chat.ts` |
| `GET` | `/api/chat/conversations/me` | `requireAuth` | `server/routes/chat.ts` |
| `POST` | `/api/chat/conversations/me/messages` | `requireAuth` | `server/routes/chat.ts` |
| `POST` | `/api/chat/conversations/me/read` | `requireAuth` | `server/routes/chat.ts` |
| `GET` | `/api/visual-search/vocabulary` | `(public)` | `server/routes/visualSearch.ts` |
| `POST` | `/api/visual-search` | `optionalAuth` | `server/routes/visualSearch.ts` |
| `POST` | `/api/visual-search/refine` | `optionalAuth` | `server/routes/visualSearch.ts` |
| `GET` | `/api/admin/dashboard` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `GET` | `/api/admin/me` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `GET` | `/api/admin/audit-logs` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `GET` | `/api/admin/orders` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `GET` | `/api/admin/orders/:id` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `PUT` | `/api/admin/orders/:id/status` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `POST` | `/api/admin/orders/:id/confirm-payment` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `GET` | `/api/admin/returns` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `GET` | `/api/admin/payment-issues` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `POST` | `/api/admin/payment-issues/:type/:id/resolve` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `PUT` | `/api/admin/returns/:id/decision` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `POST` | `/api/admin/returns/:id/receive` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `POST` | `/api/admin/returns/:id/refund` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `GET` | `/api/admin/categories` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `POST` | `/api/admin/categories` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `PUT` | `/api/admin/categories/:id` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `DELETE` | `/api/admin/categories/:id` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `GET` | `/api/admin/products` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `GET` | `/api/admin/products/quick-images` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `PUT` | `/api/admin/products/:id/primary-image` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `GET` | `/api/admin/products/:id` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `POST` | `/api/admin/products` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `PUT` | `/api/admin/products/:id` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `PATCH` | `/api/admin/products/:id/visibility` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `DELETE` | `/api/admin/products/:id` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `GET` | `/api/admin/inventory` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `POST` | `/api/admin/variants/:id/stock-adjust` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `GET` | `/api/admin/variants/:id/stock-movements` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `GET` | `/api/admin/vouchers` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `POST` | `/api/admin/vouchers` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `PUT` | `/api/admin/vouchers/:id` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `GET` | `/api/admin/promotions` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `POST` | `/api/admin/promotions/preview` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `POST` | `/api/admin/promotions` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `PUT` | `/api/admin/promotions/:id` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `POST` | `/api/admin/promotions/:id/end-early` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `GET` | `/api/admin/settings` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `PUT` | `/api/admin/settings` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `GET` | `/api/admin/policies` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `GET` | `/api/admin/policies/:slug` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `POST` | `/api/admin/policies/preview` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `PUT` | `/api/admin/policies/:slug` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `POST` | `/api/admin/policies/:slug/restore` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `GET` | `/api/admin/faqs` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `POST` | `/api/admin/faqs` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `PUT` | `/api/admin/faqs/:id` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `PATCH` | `/api/admin/faqs/:id/visibility` | `requireAuth, requireAdmin` | `server/routes/adminStage8c.ts` |
| `GET` | `/api/admin/overview` | `requireAuth, requireAdmin` | `server/routes/adminStage8d.ts` |
| `GET` | `/api/admin/reviews` | `requireAuth, requireAdmin` | `server/routes/adminStage8d.ts` |
| `PATCH` | `/api/admin/reviews/:id/visibility` | `requireAuth, requireAdmin` | `server/routes/adminStage8d.ts` |
| `GET` | `/api/admin/stats/overview` | `requireAuth, requireAdmin` | `server/routes/adminStage8d.ts` |
| `GET` | `/api/admin/stats/products` | `requireAuth, requireAdmin` | `server/routes/adminStage8d.ts` |
| `GET` | `/api/admin/stats/vouchers` | `requireAuth, requireAdmin` | `server/routes/adminStage8d.ts` |
| `GET` | `/api/admin/stats/visual-search` | `requireAuth, requireAdmin` | `server/routes/adminStage8d.ts` |
| `GET` | `/api/admin/stats/export.csv` | `requireAuth, requireAdmin` | `server/routes/adminStage8d.ts` |
| `GET` | `/api/admin/chats` | `requireAuth, requireAdmin` | `server/routes/adminStage8d.ts` |
| `GET` | `/api/admin/chats/:id/messages` | `requireAuth, requireAdmin` | `server/routes/adminStage8d.ts` |
| `POST` | `/api/admin/chats/:id/messages` | `requireAuth, requireAdmin` | `server/routes/adminStage8d.ts` |
| `PATCH` | `/api/admin/chats/:id/status` | `requireAuth, requireAdmin` | `server/routes/adminStage8d.ts` |
| `ALL` | `/api/admin/*` | `requireAuth, requireAdmin` | `server/routes/admin.ts` |
| `POST` | `/api/upload` | `requireAuth` | `server/routes/api.ts` |
| `GET` | `/api/upload/public/*` | `(public)` | `server/routes/api.ts` |
| `GET` | `/api/upload/signed-url` | `requireAuth` | `server/routes/api.ts` |
| `GET` | `/api/health` | `(public)` | `server/routes/api.ts` |
| `GET` | `/api/categories` | `(public)` | `server/routes/api.ts` |
| `GET` | `/api/settings/size-charts` | `(public)` | `server/routes/api.ts` |
| `GET` | `/api/settings/general` | `(public)` | `server/routes/api.ts` |
| `GET` | `/api/policies` | `(public)` | `server/routes/api.ts` |
| `GET` | `/api/policies/:slug` | `(public)` | `server/routes/api.ts` |
| `GET` | `/api/faq` | `(public)` | `server/routes/api.ts` |
| `GET` | `/api/faq-policies` | `(public)` | `server/routes/api.ts` |
| `POST` | `/api/tasks/cron-cleanup` | `(public)` | `server/routes/api.ts` |

## 6. Biến môi trường đang được tham chiếu trong mã (chỉ tên biến, không chứa giá trị)

| Tên biến môi trường | Các file sử dụng |
| --- | --- |
| `ADMIN_EMAIL` | `scripts/prod-rehearsal.ts`, `scripts/secure-dev-accounts.ts`, `server/app.ts`, `server/db/seed.ts`, `tests/stage9_production_readiness.test.ts` |
| `ADMIN_INITIAL_PASSWORD` | `scripts/prod-rehearsal.ts`, `scripts/secure-dev-accounts.ts`, `server/app.ts`, `server/db/seed.ts`, `tests/stage9_production_readiness.test.ts` |
| `ALLOW_DEV_TOOLS` | `scripts/dev-set-order-status.ts` |
| `ALLOWED_ORIGINS` | `scripts/prod-rehearsal.ts`, `server/app.ts`, `tests/stage5_ui_bugs_flow.test.ts` |
| `API_KEY` | `scripts/visual-stability.ts` |
| `APP_MODE` | `server/config/runtimeMode.ts`, `tests/stage9_production_readiness.test.ts` |
| `APP_URL` | `scripts/prod-rehearsal.ts`, `server/app.ts`, `server/routes/auth.ts`, `tests/e2e/cross_origin_iframe.spec.ts`, `tests/stage5_ui_bugs_flow.test.ts` |
| `BREVO_API_KEY` | `server/services/email.ts` |
| `CHATBOT_DAILY_SYSTEM_LIMIT` | `server/services/chatbot.ts` |
| `CHATBOT_DAILY_USER_LIMIT` | `server/services/chatbot.ts` |
| `CHATBOT_MODEL` | `server/services/chatbot.ts` |
| `CHATBOT_RATE_LIMIT_MAX` | `server/services/chatbot.ts` |
| `CHATBOT_TIMEOUT_MS` | `server/services/chatbot.ts` |
| `COOKIE_CROSS_SITE` | `scripts/prod-rehearsal.ts`, `server.ts`, `server/app.ts`, `server/config/runtimeMode.ts`, `server/db/index.ts`, `server/services/auth.ts`, `tests/http_endpoints.test.ts`, `tests/pg/stage4_concurrency_pg.test.ts`, `tests/stage3_catalog.test.ts`, `tests/stage4_checkout.test.ts`, `tests/stage5_orders_returns.test.ts`, `tests/stage5_ui_bugs_flow.test.ts`, `tests/stage6c_chatbot.test.ts`, `tests/stage6d_seller_chat.test.ts`, `tests/stage7_visual_search.test.ts`, `tests/stage8a_admin.test.ts`, `tests/stage8b_catalog_inventory.test.ts`, `tests/stage8c_vouchers_promotions_settings_policies.test.ts`, `tests/stage8d_reviews_overview_stats.test.ts`, `tests/stage9_production_readiness.test.ts` |
| `CRON_SECRET_KEY` | `scripts/prod-rehearsal.ts`, `server/app.ts`, `server/routes/api.ts`, `server/services/chatbot.ts`, `tests/stage5_orders_returns.test.ts`, `tests/stage6d_seller_chat.test.ts`, `tests/stage9_production_readiness.test.ts` |
| `CSP_EXTRA_IMG_HOSTS` | `server/app.ts`, `tests/stage9_production_readiness.test.ts` |
| `DATABASE_URL` | `drizzle.config.ts`, `scripts/dev-set-order-status.ts`, `scripts/prod-rehearsal.ts`, `server/app.ts`, `server/db/index.ts`, `server/services/chatbot.ts`, `tests/pg/stage4_concurrency_pg.test.ts`, `tests/stage6a_reviews.test.ts`, `tests/stage6b_policies_faq.test.ts`, `tests/stage6c_chatbot.test.ts`, `tests/stage6d_seller_chat.test.ts`, `tests/stage7_visual_search.test.ts`, `tests/stage8a_admin.test.ts`, `tests/stage8b_catalog_inventory.test.ts`, `tests/stage8c_vouchers_promotions_settings_policies.test.ts`, `tests/stage8d_reviews_overview_stats.test.ts`, `tests/stage9_production_readiness.test.ts` |
| `DISABLE_HMR` | `vite.config.ts` |
| `EMAIL_FROM` | `scripts/prod-rehearsal.ts`, `server/app.ts`, `server/services/email.ts` |
| `EMAIL_PROVIDER` | `scripts/prod-rehearsal.ts`, `server/app.ts`, `server/services/email.ts`, `tests/stage9_production_readiness.test.ts` |
| `ENABLE_DEMO_EMAIL_LOG` | `server/services/email.ts`, `tests/stage9_production_readiness.test.ts` |
| `ENABLE_DEMO_PAYMENT_WEBHOOK` | `scripts/prod-rehearsal.ts`, `server/app.ts`, `server/routes/orders.ts`, `tests/pg/stage4_concurrency_pg.test.ts`, `tests/stage4_checkout.test.ts`, `tests/stage5_orders_returns.test.ts`, `tests/stage5_ui_bugs_flow.test.ts`, `tests/stage8a_admin.test.ts`, `tests/stage9_production_readiness.test.ts` |
| `ENABLE_SEED_DEMO_DATA` | `scripts/prod-rehearsal.ts`, `server/db/seed.ts`, `tests/stage6b_policies_faq.test.ts`, `tests/stage9_production_readiness.test.ts` |
| `FRAME_ANCESTORS` | `server/app.ts` |
| `GEMINI_API_KEY` | `scripts/chat-smoke.ts`, `scripts/visual-audit-seed.ts`, `scripts/visual-eval.ts`, `scripts/visual-smoke.ts`, `scripts/visual-stability.ts`, `server/services/chatbot.ts`, `server/services/visualSearch.ts`, `tests/stage6c_chatbot.test.ts`, `tests/stage7_visual_search.test.ts` |
| `JWT_SECRET` | `scripts/prod-rehearsal.ts`, `server/app.ts`, `server/services/auth.ts`, `server/services/chatbot.ts`, `tests/pg/stage4_concurrency_pg.test.ts`, `tests/stage4_checkout.test.ts`, `tests/stage5_orders_returns.test.ts`, `tests/stage5_ui_bugs_flow.test.ts`, `tests/stage6a_reviews.test.ts`, `tests/stage6b_policies_faq.test.ts`, `tests/stage6c_chatbot.test.ts`, `tests/stage6d_seller_chat.test.ts`, `tests/stage7_visual_search.test.ts`, `tests/stage8a_admin.test.ts`, `tests/stage8b_catalog_inventory.test.ts`, `tests/stage8c_vouchers_promotions_settings_policies.test.ts`, `tests/stage8d_reviews_overview_stats.test.ts`, `tests/stage9_production_readiness.test.ts` |
| `NODE_ENV` | `scripts/dev-set-order-status.ts`, `scripts/load-container-env.ts`, `server/config/runtimeMode.ts`, `server/db/seed.ts`, `server/routes/api.ts`, `server/services/chatbot.ts`, `server/services/upload.ts`, `tests/stage5_ui_bugs_flow.test.ts`, `tests/stage6a_reviews.test.ts`, `tests/stage6b_policies_faq.test.ts`, `tests/stage6c_chatbot.test.ts`, `tests/stage6d_seller_chat.test.ts`, `tests/stage7_visual_search.test.ts`, `tests/stage8a_admin.test.ts`, `tests/stage8b_catalog_inventory.test.ts`, `tests/stage8c_vouchers_promotions_settings_policies.test.ts`, `tests/stage8d_reviews_overview_stats.test.ts`, `tests/stage9_production_readiness.test.ts` |
| `PAYMENT_WEBHOOK_SECRET` | `scripts/prod-rehearsal.ts`, `server/app.ts`, `server/services/chatbot.ts`, `server/services/vietqr.ts`, `tests/pg/stage4_concurrency_pg.test.ts`, `tests/stage4_checkout.test.ts`, `tests/stage5_ui_bugs_flow.test.ts`, `tests/stage8a_admin.test.ts`, `tests/stage9_production_readiness.test.ts` |
| `PGLITE_DATA_DIR` | `server/db/index.ts`, `tests/http_endpoints.test.ts`, `tests/stage3_catalog.test.ts`, `tests/stage4_checkout.test.ts`, `tests/stage5_orders_returns.test.ts`, `tests/stage5_ui_bugs_flow.test.ts`, `tests/stage6a_reviews.test.ts`, `tests/stage6b_policies_faq.test.ts`, `tests/stage6c_chatbot.test.ts`, `tests/stage6d_seller_chat.test.ts`, `tests/stage7_visual_search.test.ts`, `tests/stage8a_admin.test.ts`, `tests/stage8b_catalog_inventory.test.ts`, `tests/stage8c_vouchers_promotions_settings_policies.test.ts`, `tests/stage8d_reviews_overview_stats.test.ts`, `tests/stage9_production_readiness.test.ts` |
| `PORT` | `server.ts` |
| `PRODUCTION_STRICT` | `server/config/runtimeMode.ts`, `tests/stage5_ui_bugs_flow.test.ts`, `tests/stage8c_vouchers_promotions_settings_policies.test.ts`, `tests/stage9_production_readiness.test.ts` |
| `REFRESH_DEMO_SALE` | `server/db/seed.ts`, `tests/stage8c_vouchers_promotions_settings_policies.test.ts` |
| `RENDER` | `server/config/runtimeMode.ts`, `tests/stage5_ui_bugs_flow.test.ts`, `tests/stage9_production_readiness.test.ts` |
| `RESEND_API_KEY` | `server/services/email.ts` |
| `SEED_DEV_ACCOUNTS` | `scripts/prod-rehearsal.ts`, `server/app.ts`, `server/config/runtimeMode.ts`, `server/db/seed.ts`, `tests/stage4_checkout.test.ts`, `tests/stage9_production_readiness.test.ts` |
| `SUPABASE_PUBLIC_BUCKET` | `server/services/upload.ts` |
| `SUPABASE_RETURNS_BUCKET` | `server/services/upload.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | `server/services/chatbot.ts`, `server/services/upload.ts`, `tests/stage7_visual_search.test.ts` |
| `SUPABASE_URL` | `server/app.ts`, `server/routes/admin.ts`, `server/routes/api.ts`, `server/services/upload.ts`, `tests/stage5_ui_bugs_flow.test.ts`, `tests/stage9_production_readiness.test.ts` |
| `TEST_DATABASE_URL` | `server/db/index.ts`, `tests/pg/stage4_concurrency_pg.test.ts` |
| `TRUST_PROXY_HOPS` | `scripts/prod-rehearsal.ts`, `server/app.ts`, `server/config/runtimeMode.ts`, `tests/http_endpoints.test.ts`, `tests/stage5_ui_bugs_flow.test.ts` |
| `USE_PGLITE` | `scripts/prod-rehearsal.ts`, `server/app.ts`, `server/db/index.ts`, `tests/http_endpoints.test.ts`, `tests/pg/stage4_concurrency_pg.test.ts`, `tests/stage3_catalog.test.ts`, `tests/stage4_checkout.test.ts`, `tests/stage5_orders_returns.test.ts`, `tests/stage5_ui_bugs_flow.test.ts`, `tests/stage9_production_readiness.test.ts` |
| `USE_TEST_DATABASE_URL` | `scripts/load-container-env.ts`, `server/db/index.ts`, `tests/pg/stage4_concurrency_pg.test.ts` |
| `VIETQR_ACCOUNT_NAME` | `server/routes/adminStage8c.ts`, `server/services/vietqr.ts`, `tests/stage8c_vouchers_promotions_settings_policies.test.ts` |
| `VIETQR_ACCOUNT_NO` | `server/routes/adminStage8c.ts`, `server/services/vietqr.ts`, `tests/stage8c_vouchers_promotions_settings_policies.test.ts` |
| `VIETQR_BANK_ID` | `server/routes/adminStage8c.ts`, `server/services/policyFaq.ts`, `server/services/vietqr.ts`, `tests/stage6b_policies_faq.test.ts`, `tests/stage8c_vouchers_promotions_settings_policies.test.ts` |
| `VISUAL_SEARCH_BURST_PER_MIN_CAP` | `server/services/visualSearch.ts` |
| `VISUAL_SEARCH_DAILY_GLOBAL_CAP` | `server/services/visualSearch.ts` |
| `VISUAL_SEARCH_DAILY_USER_CAP` | `server/services/visualSearch.ts` |
| `VISUAL_SEARCH_MODEL` | `server/services/visualSearch.ts` |
| `VISUAL_SEARCH_REFINE_PER_MIN_CAP` | `server/services/visualSearch.ts`, `tests/stage7_visual_search.test.ts` |
| `WEBHOOK_SECRET` | `server/services/chatbot.ts`, `server/services/vietqr.ts`, `tests/stage9_production_readiness.test.ts` |
