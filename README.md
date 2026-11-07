# Baity Fashion E-Commerce

Hệ thống thương mại điện tử thời trang bền vững **Baity Fashion** (React 19 + TypeScript + Express + Drizzle ORM + PostgreSQL / Supabase).

---

## 1. Kiến trúc Cơ sở dữ liệu & Migration (Single Source of Truth)

- **Nguồn định nghĩa Schema duy nhất**: `server/db/schema.ts` (25 bảng, khóa ngoại, check constraints, unique indexes).
- **Thư mục Migration chuẩn**: `migrations/*.sql` kèm `migrations/meta/_journal.json`.
- **Khởi tạo lúc chạy (`server/db/init.ts`)**: Chỉ gọi `migrate(db, { migrationsFolder })` của Drizzle ORM để áp dụng các file trong `migrations/` (dùng chung cho cả PostgreSQL/Supabase và PGlite), **không chứa DDL viết tay riêng**.
- **Quy trình thay đổi Schema**:
  1. Cập nhật `server/db/schema.ts`
  2. Chạy `npm run db:generate` để sinh file migration SQL mới trong `migrations/`
  3. Chạy `npm test` (hoặc `npm run db:check`): script `scripts/check-schema-drift.ts` sẽ thực thi lệnh `drizzle-kit generate` thật sự; nếu phát hiện bất kỳ thay đổi nào giữa `schema.ts` và `migrations/` chưa được sinh migration, script sẽ dọn dẹp file tạm, báo lỗi và dừng tiến trình kiểm thử ngay lập tức (phát hiện 100% schema drift).

---

## 2. Ba Môi Trường Vận Hành (Environments)

Hệ thống hỗ trợ 3 môi trường vận hành độc lập, phân định ranh giới an toàn tuyệt đối:

### Môi trường 1: Preview AI Studio
- **Cơ sở dữ liệu**: PostgreSQL nhúng PGlite (lưu tại `.data/pglite` hoặc in-memory `memory://`), tích hợp extension `pg_trgm`.
- **Cấu hình**: `USE_PGLITE=true`, `NODE_ENV=development`.
- **Tài khoản mẫu**: Bật cờ `SEED_DEV_ACCOUNTS=true` để tự động tạo `admin@baity.vn` (Pass: `Admin@123`), `khach1@baity.vn` và `khach2@baity.vn` (Pass: `Khach@123`) phục vụ kiểm thử nhanh.

### Môi trường 2: Supabase Dev (Staging / Development)
- **Cơ sở dữ liệu**: PostgreSQL đám mây (dự án Supabase Dev riêng biệt, Session/Transaction Pooler port 6543 / 5432).
- **Cấu hình**: `DATABASE_URL=postgresql://...`, `USE_PGLITE=false`, `NODE_ENV=development`.
- **Tài khoản mẫu**: Chỉ nạp tài khoản mẫu khi quản trị viên bật rõ cờ tường minh `SEED_DEV_ACCOUNTS=true` (mặc định là `false`).

### Môi trường 3: Production trên Render với Supabase riêng biệt
- **Nền tảng máy chủ**: Render Web Service (`RENDER=true`, `NODE_ENV=production`).
- **Cơ sở dữ liệu**: Dự án Supabase Production hoàn toàn riêng biệt (không dùng chung CSDL hay Storage với Dev).
- **Ràng buộc an toàn cốt lõi**:
  1. **Cấm PGlite**: `USE_PGLITE` TUYỆT ĐỐI KHÔNG ĐƯỢC có hiệu lực khi `RENDER=true` (nếu vô tình bật `USE_PGLITE=true` trên Render, server sẽ lập tức từ chối khởi động và báo lỗi rõ ràng).
  2. **Chặn CSDL thử & Tài khoản mẫu**: Cờ `SEED_DEV_ACCOUNTS` bị vô hiệu hóa hoàn toàn ở Production. Khi khởi động ở chế độ strict, server kiểm tra bảng `users` (`admin@baity.vn`, `khach1@baity.vn`, `khach2@baity.vn`) và bảng `orders` (`BAITY-1001`..`BAITY-1004`); nếu phát hiện sẽ dừng khởi động ngay với thông báo rõ nguyên nhân: `"CSDL chứa dữ liệu mẫu (phát hiện tài khoản mẫu / phát hiện đơn hàng mẫu), không dùng CSDL thử cho bản thật"` (tuyệt đối không in giá trị email hay mã đơn ra log).
  3. **Khởi tạo Admin**: Khi CSDL chưa có tài khoản Admin, bắt buộc cung cấp `ADMIN_EMAIL` và `ADMIN_INITIAL_PASSWORD` (>= 12 ký tự, có chữ và số, cấm mật khẩu mẫu). Nếu `ADMIN_EMAIL` trùng email mẫu (`admin@baity.vn`, `khach1@baity.vn`, `khach2@baity.vn`), server sẽ dừng khởi động ngay với thông báo `"ADMIN_EMAIL không được dùng email mẫu của dữ liệu thử"` (không in giá trị).

### 2.1. Bảng So Sánh Cấu Hình Bảo Mật Giữa Hai Môi Trường (Preview AI Studio vs Production Render)

| Biến môi trường | Môi trường Preview AI Studio (Chạy trong Cross-Site Iframe) | Môi trường Production trên Render (`RENDER=true` / `PRODUCTION_STRICT=true`) |
|---|---|---|
| `COOKIE_CROSS_SITE` | `true` *(đặt cookie `SameSite=None; Secure; Partitioned`; bắt buộc mọi request thay đổi dữ liệu phải có `Origin` hợp lệ và khớp giao thức `https`)* | `false` *(hoặc không đặt — giữ `SameSite=Lax; Secure`; nếu đặt `true` khi `RENDER=true` hoặc `PRODUCTION_STRICT=true`, server sẽ **từ chối khởi động**)* |
| `ALLOWED_ORIGINS` | Danh sách Origin bổ sung phân cách bởi dấu phẩy (ví dụ: `https://aistudio.google.com`) ngoài Host/`X-Forwarded-Host` của chính server (cấm dùng `*`) | Rỗng hoặc danh sách tên miền phụ tin cậy bổ sung (ví dụ: `https://www.baity.vn`); Origin trùng với Host của chính server luôn được phép tự động |
| `APP_URL` | `https://<ten-mien-preview>.run.app` (hoặc `http://localhost:3000` khi chạy local) | `https://baity.vn` (tên miền chính thức dùng cho liên kết email và kiểm tra Origin) |
| `TRUST_PROXY_HOPS` | `2` *(đặc thù riêng của AI Studio Preview do đi qua 2 lớp proxy: Cloud Run GFE + Nginx nội bộ `localhost:3000`; **phải xác minh lại và đặt về `1` khi triển khai lên Render**)* | `1` *(1 bước load balancer của Render; chống giả mạo `X-Forwarded-For` để vượt rate limit)* |
| `FRAME_ANCESTORS` | `'self' https://aistudio.google.com https://*.google.com https://*.googleusercontent.com` *(cho phép nhúng trong khung preview AI Studio)* | Bị khóa cứng thành `'self'` trong CSP *(bỏ qua biến môi trường ở Production để chống Clickjacking)* |

---

## 3. Danh sách Biến Môi Trường (`.env`)

Xem file mẫu đầy đủ tại `.env.example` (không chứa khóa bí mật). Khi khởi động ở Production (`NODE_ENV=production`, `RENDER=true`, hoặc `PRODUCTION_STRICT=true`), hàm `validateProductionStartupEnv()` trong `server/app.ts` kiểm tra toàn bộ các biến bắt buộc và báo lỗi rõ tên biến thiếu/sai định dạng (tuyệt đối không in giá trị bí mật ra log).

| Tên biến | Bắt buộc ở Production? | Ví dụ định dạng chuẩn | Do ai cung cấp / thiết lập | Giá trị mặc định an toàn (Dev) |
|---|:---:|---|---|---|
| `NODE_ENV` | **Bắt buộc** (`production`) | `production` | Quản trị viên / Render | `development` |
| `APP_MODE` | **CẤM (`preview`) ở Production** | Để trống ở Production (`preview` chỉ dành cho AI Studio Preview) | Quản trị viên đặt `preview` trên AI Studio | Trống |
| `PORT` | Tự động / Tùy chọn | `10000` (Render) hoặc `3000` | Render tự cấp (server đọc `process.env.PORT`) | `3000` |
| `RENDER` | Tự động trên Render | `true` | Nền tảng Render tự đặt | `false` |
| `PRODUCTION_STRICT` | **Khuyến nghị (`true`)** | `true` | Quản trị viên đặt trên Render | `false` |
| `USE_PGLITE` | **CẤM (`false`)** | `false` | Quản trị viên (nếu đặt `true` ở mọi chế độ strict sẽ từ chối chạy) | `false` |
| `SEED_DEV_ACCOUNTS` | **CẤM (`false`)** | `false` | Chỉ dùng ở Dev cục bộ | `false` |
| `DATABASE_URL` | **Bắt buộc** | `postgresql://postgres.[ref]:[pass]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require` | Lấy từ Supabase Session Pooler | PGlite cục bộ (`.data/pglite`) |
| `JWT_SECRET` | **Bắt buộc** | Chuỗi ngẫu nhiên >= 32 ký tự (`openssl rand -hex 32`) | Quản trị viên tự sinh | Khóa nội bộ chỉ dùng ở Dev |
| `ADMIN_EMAIL` | **Bắt buộc khi CSDL chưa có Admin** | `quanly@baity.vn` *(cấm dùng email mẫu `admin@baity.vn`, `khach1@baity.vn`, `khach2@baity.vn` — nếu vi phạm sẽ dừng khởi động với thông báo `"ADMIN_EMAIL không được dùng email mẫu của dữ liệu thử"`, không in giá trị)* | Quản trị viên (chỉ dùng tạo Admin lần đầu khi CSDL trống) | Trống |
| `ADMIN_INITIAL_PASSWORD` | **Bắt buộc khi CSDL chưa có Admin** | Mật khẩu >= 12 ký tự, có chữ và số, không thuộc danh sách cấm (`Admin@123`, `Khach@123`, `Baity2026Shop9xK`...) | Quản trị viên (chỉ dùng tạo Admin lần đầu; không ghi đè mật khẩu Admin đã tồn tại lúc khởi động; có thể xóa sau khi đã tạo và đổi mật khẩu) | Trống |
| `APP_URL` | **Bắt buộc** | `https://baity.vn` (phải bắt đầu bằng `https://`) | Quản trị viên (tên miền thật của web) | `http://localhost:3000` |
| `ALLOWED_ORIGINS` | **Bắt buộc** | `https://baity.vn,https://www.baity.vn` (cấm `*`) | Quản trị viên (tên miền thật của web) | `http://localhost:3000` |
| `COOKIE_CROSS_SITE` | **CẤM (`false`)** | `false` | Quản trị viên đặt `false` trên Render | `true` (chỉ ở AI Studio Preview) |
| `TRUST_PROXY_HOPS` | **Bắt buộc (`1`)** | `1` (trên Render) | Quản trị viên đặt `1` trên Render | `1` (`2` trên AI Studio Preview) |
| `FRAME_ANCESTORS` | Để trống ở Production | `""` (trống — CSP tự khóa cứng `'self'`) | Quản trị viên để trống trên Render | `'self' https://aistudio.google.com ...` |
| `CSP_EXTRA_IMG_HOSTS` | Tùy chọn *(để trống hoặc không đặt vẫn hợp lệ kể cả ở strict)* | `images.unsplash.com,picsum.photos` *(danh sách tên miền ngăn cách bằng dấu phẩy, **không có `https://`**; giá trị sai định dạng bị bỏ qua kèm cảnh báo, không in giá trị lạ ra log và không làm dừng khởi động)* | Quản trị viên | Trống / Không đặt |
| `SUPABASE_URL` | **Bắt buộc** | `https://[project-ref].supabase.co` | Lấy từ Supabase Project Settings -> API | Trống (fallback RAM ở Dev) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Bắt buộc** | `eyJhbGciOiJIUzI1NiIsInR5cCI6...` | Lấy từ Supabase Project Settings -> API (`service_role`) | Trống |
| `SUPABASE_PUBLIC_BUCKET` | Tùy chọn | `baity-media` | Quản trị viên tạo trên Supabase Storage (Public) | `baity-media` |
| `SUPABASE_RETURNS_BUCKET` | Tùy chọn | `baity-returns` | Quản trị viên tạo trên Supabase Storage (Private) | `baity-returns` |
| `EMAIL_PROVIDER` | **Bắt buộc (`brevo` / `resend`)** | `brevo` hoặc `resend` (Dev dùng `log`) | Quản trị viên chọn nhà cung cấp email | `log` |
| `EMAIL_FROM` | **Bắt buộc** *(khi `EMAIL_PROVIDER` là `brevo` hoặc `resend`)* | `Baity Fashion <ops@baity.vn>` | Quản trị viên (địa chỉ/miền đã xác minh) | Trống *(không có mặc định)* |
| `BREVO_API_KEY` | **Bắt buộc** *(chỉ đọc khi `EMAIL_PROVIDER=brevo`)* | `xkeysib-...` | Lấy từ Brevo SMTP & API (bỏ qua khi `EMAIL_PROVIDER=log`) | Trống |
| `RESEND_API_KEY` | **Bắt buộc** *(chỉ đọc khi `EMAIL_PROVIDER=resend`)* | `re_...` | Lấy từ Resend API Keys (bỏ qua khi `EMAIL_PROVIDER=log`) | Trống |
| `ENABLE_DEMO_EMAIL_LOG` | **CẤM (`false`)** | `false` | Quản trị viên để `false` ở Production | `false` |
| `ENABLE_SEED_DEMO_DATA` | Tùy chọn (`false`) | `false` (CSDL trống chỉ tạo danh mục/chính sách/cài đặt) | Quản trị viên | `false` |
| `GEMINI_API_KEY` | **Bắt buộc** *(cho AI)* | `AIzaSy...` | Lấy từ Google AI Studio | Tiêm tự động ở Preview |
| `CHATBOT_MODEL` | Tùy chọn | `gemini-3-flash-preview` | Quản trị viên | `gemini-3-flash-preview` |
| `VISUAL_SEARCH_MODEL` | Tùy chọn | `gemini-3-flash-preview` | Quản trị viên | `gemini-3-flash-preview` |
| `VISUAL_SEARCH_DAILY_GLOBAL_CAP` | Tùy chọn | `300` | Quản trị viên | `300` |
| `VISUAL_SEARCH_DAILY_USER_CAP` | Tùy chọn | `15` | Quản trị viên | `15` |
| `VISUAL_SEARCH_BURST_PER_MIN_CAP` | Tùy chọn | `5` | Quản trị viên | `5` |
| `VISUAL_SEARCH_REFINE_PER_MIN_CAP` | Tùy chọn | `30` | Quản trị viên | `30` |
| `CRON_SECRET_KEY` | **Bắt buộc** | Chuỗi ngẫu nhiên >= 24 ký tự | Quản trị viên tự sinh cho Cron Job | Khóa nội bộ Dev |
| `PAYMENT_WEBHOOK_SECRET` | **Bắt buộc** *(tên biến chính; hỗ trợ alias `WEBHOOK_SECRET` để tương thích ngược)* | Chuỗi bí mật HMAC-SHA256 | Quản trị viên / Cổng thanh toán | Khóa nội bộ Dev |
| `ENABLE_DEMO_PAYMENT_WEBHOOK` | **CẤM (`false`)** | `false` | Quản trị viên để `false` ở Production | `false` |
| `VIETQR_BANK_ID` | Tùy chọn | `MB` | Quản trị viên | `MB` |
| `VIETQR_ACCOUNT_NO` | Tùy chọn | `0987654321` | Quản trị viên | `0987654321` |
| `VIETQR_ACCOUNT_NAME` | Tùy chọn | `CONG TY THOI TRANG BAITY` | Quản trị viên | `CONG TY THOI TRANG BAITY` |

### 3.1. Cấu hình Model Chatbot (`CHATBOT_MODEL`) & Lưu ý Model Preview
- **Model mặc định hiện tại**: `gemini-3-flash-preview` (khai báo tại `CHATBOT_MODEL_NAME` trong `server/services/chatbot.ts`).
- **Lưu ý vận hành**: Các model có hậu tố `-preview` là bản xem trước của Google Gemini và **có thể bị ngừng hỗ trợ hoặc đổi tên bất cứ lúc nào**. Khi đó chỉ cần đổi biến môi trường `CHATBOT_MODEL=<tên-model-mới>` trên Render mà không cần sửa mã nguồn.

### 3.2. Giới hạn Chi phí, Timeout, Thử lại & Độ trễ Tìm kiếm Hình ảnh AI (`/api/visual-search` & `/api/visual-search/refine`)
Tất cả các bộ đếm đều được kiểm tra và tăng nguyên tử trong bảng `chatbot_daily_counters` **trước khi** gọi Google Gemini:

| Loại giới hạn / Cấu hình | Giá trị mặc định hiện tại | Biến môi trường cấu hình (`.env`) | Khóa cấu hình động trong `store_settings` (`key = 'visual_search'` hoặc `'general'`) |
|---|:---:|---|---|
| **Trần toàn hệ thống / ngày** (`POST /api/visual-search`) | **300 lượt / ngày** | `VISUAL_SEARCH_DAILY_GLOBAL_CAP` | `visualSearchDailyGlobalCap` |
| **Giới hạn mỗi người dùng hoặc IP / ngày** (`POST /api/visual-search`) | **15 lượt / ngày** | `VISUAL_SEARCH_DAILY_USER_CAP` | `visualSearchDailyUserCap` |
| **Giới hạn tốc độ theo phút** (`POST /api/visual-search`) | **5 lượt / phút** | `VISUAL_SEARCH_BURST_PER_MIN_CAP` | `visualSearchBurstPerMinCap` |
| **Giới hạn tốc độ theo phút cho Tìm lại** (`POST /api/visual-search/refine`, không gọi Gemini) | **30 lượt / phút** | `VISUAL_SEARCH_REFINE_PER_MIN_CAP` | `visualSearchRefinePerMinCap` |
| **Ngưỡng độ tin cậy tối thiểu** (`confidence`) | **0.50** | Hằng số `VISUAL_SEARCH_MIN_CONFIDENCE = 0.5` tại `server/services/visualSearch.ts` | Dưới `0.5` tự động coi như không nhận diện được trang phục (`LOW_CONFIDENCE`) |
| **Thời gian chờ tối đa (Timeout)** (`POST /api/visual-search`) | **15.000 ms (15 giây)** | Hằng số `VISUAL_SEARCH_TIMEOUT_MS = 15000` tại `server/services/visualSearch.ts` | Quá 15 giây tự động hủy lệnh gọi và trả mã lỗi `504 AI_TIMEOUT` |
| **Chính sách thử lại (Retry Policy)** (`POST /api/visual-search`) | **Tối đa 1 lần thử lại** (`VISUAL_SEARCH_MAX_RETRIES = 1`) | Tại `analyzeImageWithGemini` (`server/services/visualSearch.ts`) | Chỉ thử lại **1 lần duy nhất** (sau 800ms) trên cùng model khi gặp lỗi tạm thời phía máy chủ Gemini (`429 Rate Limit` / `503 Service Unavailable`) nếu tổng thời gian chưa vượt quá 15 giây. **Không thử lại (0 retry)** khi đã timeout hoặc lỗi dữ liệu đầu vào (`400`/`404`) |

- **Đề xuất giảm độ trễ khi phát hiện ca gọi Gemini > 8 giây**:
  1. Thu nhỏ kích thước cạnh dài nhất của ảnh chuẩn hóa bằng `sharp` từ `768px` xuống `512px` và chất lượng JPEG từ `82` xuống `75` trước khi mã hóa base64 gửi Gemini.
  2. Cấu hình `thinkingConfig: { thinkingBudget: 0 }` (hoặc `thinkingLevel: 'MINIMAL'`) trong lệnh gọi `ai.models.generateContent` của `gemini-3-flash-preview` vì bài toán phân loại danh mục + màu sắc + kiểu dáng theo JSON Schema cố định không cần bước suy luận dài.
  3. Rút gọn system instruction của prompt nhận diện, chỉ giữ bảng mã `category` và bảng màu chuẩn.

### 3.3. Cấu hình Dịch vụ Email Giao dịch (`EMAIL_PROVIDER`) — Quên mật khẩu thật
Hệ thống gửi email khôi phục mật khẩu qua HTTPS API tại `server/services/email.ts` với timeout cứng **8.000 ms (8 giây)** (`AbortSignal.timeout(8000)`):
- **`EMAIL_PROVIDER=log`** *(chỉ dùng ở môi trường Dev)*: Không gửi email ra ngoài mạng; chỉ ghi thông báo giả lập vào console khi không phải Production và bật `ENABLE_DEMO_EMAIL_LOG=true`.
- **`EMAIL_PROVIDER=brevo`**: Gửi qua `POST https://api.brevo.com/v3/smtp/email` sử dụng biến `BREVO_API_KEY` và `EMAIL_FROM`.
  - **Lưu ý xác minh Brevo**: Tài khoản Brevo mới bắt buộc phải xác minh địa chỉ người gửi (**Sender Verification** trong mục *Senders & IP*) khớp với địa chỉ trong `EMAIL_FROM` (ví dụ `no-reply@baity.vn`). Để vào hộp thư chính ổn định và bỏ giới hạn ngày, cần cấu hình bản ghi DNS (`SPF`, `DKIM`, `DMARC`) cho tên miền trên Brevo.
- **`EMAIL_PROVIDER=resend`**: Gửi qua `POST https://api.resend.com/emails` sử dụng biến `RESEND_API_KEY` và `EMAIL_FROM`.
  - **Lưu ý xác minh Resend**: Ở gói miễn phí/chưa xác minh tên miền (dùng `onboarding@resend.dev`), Resend **chỉ cho phép gửi thử tới chính địa chỉ email của chủ tài khoản Resend**. Để gửi email khôi phục mật khẩu tới mọi khách hàng bất kỳ, quản trị viên **bắt buộc phải thêm tên miền riêng (Domains -> Add Domain) và xác minh các bản ghi DNS (`DKIM`, `SPF`)** trên Resend, sau đó đặt `EMAIL_FROM` thuộc tên miền đã xác minh đó.
- **Bảo mật log ở Production**: Ở môi trường Production, hệ thống **tuyệt đối không bao giờ in liên kết đặt lại mật khẩu, token hay nội dung email ra log** trong mọi trường hợp. Nếu quản trị viên quên cấu hình `EMAIL_PROVIDER` / API key ở Production, server chỉ ghi `console.warn` báo thiếu cấu hình (không lộ token) và API `POST /api/auth/forgot-password` vẫn trả thông báo chung an toàn để chống dò tài khoản.

### 3.4. Tác vụ Dọn dẹp Định kỳ (`POST /api/tasks/cron-cleanup`) & Cơ chế Bù Lazy Evaluation
Endpoint `POST /api/tasks/cron-cleanup` (định nghĩa tại `apiRouter.post('/tasks/cron-cleanup', ...)` trong `server/routes/api.ts`) được bảo vệ bằng header `x-cron-secret: <CRON_SECRET_KEY>`. Mỗi lần chạy, hệ thống thực thi trọn vẹn **5 tác vụ dọn dẹp độc lập** (qua `runScopedLazyCleanup({ all: true })` trong `server/services/lazyCleanup.ts`, `cleanupOldChatbotDailyCounters` trong `server/services/chatbot.ts`, `cleanupOldAiSearchLogs` trong `server/services/visualSearch.ts`, và `cleanupOldClosedSellerChats` trong `server/routes/chat.ts`) và trả về số bản ghi đã xử lý kèm thời gian thực thi (`elapsedMs`), chỉ ghi log số lượng (không log dữ liệu nhạy cảm):

| STT | Tác vụ trong `POST /api/tasks/cron-cleanup` (`server/routes/api.ts`) | Ngưỡng thời gian | Hành vi chi tiết & Tính lũy đẳng (Idempotency) | Cơ chế bù khi Cron trễ (Lazy Evaluation) |
|:---:|---|---|---|---|
| 1 | `cancelledOrders` (`lazyCleanupExpiredOrders` trong `server/services/lazyCleanup.ts`) | Đơn `pending` quá hạn giữ chỗ (`reserved_until < NOW()`, mặc định **30 phút**) | Chuyển trạng thái đơn sang `cancelled` (`WHERE status = 'pending' RETURNING id`), hoàn lại tồn kho `stock_quantity` cho từng `product_variants` (sắp xếp `variantId` tăng dần chống deadlock), giảm `used_count` của `vouchers`, ghi log hủy tự động. Chạy 2 lần liên tiếp lần 2 trả `0`. | `lazyCleanupExpiredOrders()` tự động chạy ngầm (mỗi 30 giây tối đa 1 lần hoặc theo người dùng) ngay khi khách xem sản phẩm, thêm giỏ hàng, đặt hàng hoặc xem đơn hàng. |
| 2 | `completedOrders` (`lazyCompleteDeliveredOrders` trong `server/services/lazyCleanup.ts`) | Đơn `delivered` đã giao quá **7 ngày** (`delivered_at <= NOW() - 7 days`) và không có yêu cầu đổi trả đang mở (`pending`/`approved`) | Tự động chuyển trạng thái đơn sang `completed` và cập nhật `completed_at = NOW()`. | Hàm `lazyCompleteDeliveredOrders()` cũng được gọi tự động khi khách hoặc Admin truy vấn danh sách/chi tiết đơn hàng. |
| 3 | `deletedClosedSellerChats` (`cleanupOldClosedSellerChats` trong `server/routes/chat.ts`) | Hội thoại chat với người bán đã đóng (`mode = 'human' AND status = 'closed'`) quá **180 ngày** (`COALESCE(closed_at, updated_at) < NOW() - 180 days`) | Xóa vĩnh viễn các hội thoại `chat_conversations` đã đóng quá 180 ngày (cascade xóa `chat_messages` đi kèm). | Dọn dẹp định kỳ qua Cron; không ảnh hưởng luồng mở hội thoại mới của khách. |
| 4 | `deletedAiSearchLogs` (`cleanupOldAiSearchLogs` trong `server/services/visualSearch.ts`) | Nhật ký tìm kiếm ảnh AI (`ai_search_logs`) cũ hơn **90 ngày** (`created_at < NOW() - 90 days`) | Xóa các bản ghi thống kê nhận diện ảnh cũ hơn 90 ngày để giữ bảng gọn nhẹ. | Dọn dẹp định kỳ qua Cron. |
| 5 | `deletedChatbotCounters` (`cleanupOldChatbotDailyCounters` trong `server/services/chatbot.ts`) | Bộ đếm giới hạn AI/chat theo ngày/phút (`chatbot_daily_counters`) cũ hơn **2 ngày** (`date_key < YYYY-MM-DD - 2 days`) | Xóa toàn bộ các bộ đếm ngày và bộ đếm phút (`m:...`) của các ngày trước hôm qua. | Bộ đếm mới luôn dùng khóa ngày hiện tại (`YYYY-MM-DD`), nên dù Cron trễ vẫn không ảnh hưởng chính xác giới hạn ngày mới. |

- **Lịch gọi khuyến nghị**: Thiết lập Cron Job (Render Cron Job / Cloudflare Worker / GitHub Actions / cron-job.org) gọi mỗi **10 phút**:
  ```bash
  curl -X POST https://baity.vn/api/tasks/cron-cleanup \
    -H "x-cron-secret: ${CRON_SECRET_KEY}" \
    -H "Content-Type: application/json"
  ```

### 3.5. Danh sách các Script Công cụ Phát triển (Dev-Only Scripts — Tự động từ chối chạy ở Production)
Tất cả các script kiểm thử/chẩn đoán dưới đây đều có chốt chặn an toàn ở đầu file: nếu `NODE_ENV=production`, `RENDER=true` hoặc `PRODUCTION_STRICT=true`, script lập tức in lỗi và thoát với mã `process.exit(1)`:
- `npm run chat:smoke -- --live`: Kiểm tra kết nối thật tới model Chatbot Gemini, đo độ trễ và kiểm tra kích thước ngữ cảnh.
- `npm run visual:smoke -- --live`: Kiểm tra nhanh pipeline nhận diện ảnh sản phẩm với Gemini.
- `npm run visual:eval -- --live`: Đánh giá chất lượng nhận diện ảnh đối chứng (ảnh trơn, ảnh nhiễu, ảnh prompt injection) và 6 ảnh sản phẩm lấy ngẫu nhiên với hạt giống cố định; báo cáo `p50`, `max`, số lần thử lại và tách riêng ca `LỖI (ERROR)`.
- `npm run visual:audit-seed -- --live --confirm [--only-errors] [--confirm-cost]`: Kiểm toán ảnh chính của sản phẩm seed đang hoạt động so với danh mục trong CSDL (tự động bỏ qua ảnh giữ chỗ SVG `placeholder-*.svg`, hỗ trợ backoff tự động và lưu cache nhận diện).
- `npm run visual:stability`: Chạy hoặc đọc kết quả kiểm tra độ ổn định nhận diện Gemini (3 lần lặp cho 6 ảnh đại diện) và đối chiếu theo nhóm loại lân cận `VISUAL_SEARCH_NEIGHBOR_GROUPS` (so sánh `expectedCategory` với `recognizedCategory`).
- `npm run seed:images-report`: Script chỉ đọc (không gọi Gemini), in thống kê danh mục, danh sách sản phẩm và các nhóm URL ảnh chính bị dùng chung.
- `npm run seed:images-check`: Script chỉ đọc (không gọi Gemini), kiểm tra trạng thái phản hồi (200 OK), `content-type` và kích thước byte của toàn bộ ảnh sản phẩm đang hoạt động (hỗ trợ cả tệp cục bộ `public/seed-images/*` và URL HTTP/HTTPS).
- `npm run seed:images-plan`: Script chỉ đọc (không gọi Gemini), kết hợp dữ liệu CSDL, `.data/visual-audit-cache.json` và bảng họ màu hẹp/lân cận để sinh bảng kiểm toán màu + loại và kế hoạch bộ sản phẩm demo 29 sản phẩm.
- `npm run seed:images-fetch`: Tải 12 ảnh thật đã kiểm chứng về `public/seed-images/<slug>.jpg` và tạo 9 ảnh giữ chỗ SVG tự vẽ `public/seed-images/placeholder-<category>.svg` ("Ảnh đang cập nhật").
- `npm run seed:apply-demo-catalog -- --confirm`: Áp dụng bộ danh mục demo 29 sản phẩm vào CSDL Dev một cách lũy đẳng (ẩn 17 sản phẩm ngoài danh sách demo bằng `is_active = false`, trỏ 12 sản phẩm đã đạt sang `/seed-images/<slug>.jpg`, trỏ 17 sản phẩm cần ảnh mới sang `/seed-images/placeholder-<category>.svg`, không xóa dữ liệu, không đụng đơn hàng, ghi 1 dòng tóm tắt vào `admin_audit_logs`).
- `npm run dev:set-order-status`: Công cụ dòng lệnh chuyển nhanh trạng thái đơn hàng phục vụ kiểm thử luồng giao hàng/đổi trả ở Dev.
- `npm run db:secure-dev-accounts -- --confirm`: Đổi mật khẩu ngẫu nhiên cho các tài khoản mẫu (`admin@baity.vn`, `khach1@baity.vn`, `khach2@baity.vn`), thu hồi phiên JWT cũ và đặt lại mật khẩu Admin trên CSDL Dev (bắt buộc cờ `--confirm`, từ chối chạy ở strict).
- `npm run prod:rehearsal`: Diễn tập khởi tạo Production trên một PGlite hoàn toàn trống (chạy toàn bộ migrations `0000`–`0011`, khởi tạo 1 Admin duy nhất từ biến môi trường, nạp chính sách/FAQ/cài đặt/9 danh mục gốc, xác minh 0 sản phẩm mẫu và 0 tài khoản khách mẫu).

### 3.6. Nguồn ảnh mẫu (`public/seed-images/`)
Toàn bộ 29 sản phẩm trong bộ danh mục demo (`server/db/seed.ts`) sử dụng đường dẫn nội bộ `/seed-images/...` phục vụ trực tiếp từ thư mục tĩnh `public/seed-images/` (cùng tên miền `'self'`, không phụ thuộc mạng ngoài và không cần mở `CSP_EXTRA_IMG_HOSTS` ở chế độ strict):
1. **12 ảnh chụp sản phẩm thật (`public/seed-images/<slug>.jpg`)**:
   - Được tải về cục bộ qua `npm run seed:images-fetch` từ **Unsplash** theo giấy phép **[Unsplash License](https://unsplash.com/license)** (cho phép tải xuống, sao chép, chỉnh sửa và sử dụng miễn phí cho mục đích thương mại và phi thương mại mà không bắt buộc ghi công, không bán lại nguyên bản ảnh thô):
     - `ao-so-mi-oxford-dai-tay-phom-regular-nam.jpg` — Nguồn: Unsplash Photo `photo-1596755094514-f87e34085b2c` (`https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=800&q=80`)
     - `ao-so-mi-nam-co-tau-vai-dui-linen-mat-me.jpg` — Nguồn: Unsplash Photo `photo-1598033129183-c4f50c736f10` (`https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=800&q=80`)
     - `quan-kaki-nam-dang-slimfit-ton-chieu-cao.jpg` — Nguồn: Unsplash Photo `photo-1473966968600-fa801b869a1a` (`https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=800&q=80`)
     - `ao-len-nam-co-lo-vai-cashmere-pha-am-ap.jpg` — Nguồn: Unsplash Photo `photo-1614975058789-41316d0e2e9c` (`https://images.unsplash.com/photo-1614975058789-41316d0e2e9c?auto=format&fit=crop&w=800&q=80`)
     - `that-lung-da-bo-nam-mat-khoa-kim-loai-nguyen-khoi.jpg` — Nguồn: Unsplash Photo `photo-1624222247344-550fb60583dc` (`https://images.unsplash.com/photo-1624222247344-550fb60583dc?auto=format&fit=crop&w=800&q=80`)
     - `quan-jean-nu-ong-loe-lung-sieu-cao-hack-dang.jpg` — Nguồn: Unsplash Photo `photo-1584370848010-d7fe6bc767ec` (`https://images.unsplash.com/photo-1584370848010-d7fe6bc767ec?auto=format&fit=crop&w=800&q=80`)
     - `ao-blazer-nu-phom-rong-cropped-thanh-lich.jpg` — Nguồn: Unsplash Photo `photo-1591047139829-d91aecb6caea` (`https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=800&q=80`)
     - `ao-cardigan-nu-det-kim-cuc-go-mua-thu.jpg` — Nguồn: Unsplash Photo `photo-1434389677669-e08b4cac3105` (`https://images.unsplash.com/photo-1434389677669-e08b4cac3105?auto=format&fit=crop&w=800&q=80`)
     - `tui-xach-nu-tote-canvas-quai-da-phoi-dung-laptop.jpg` — Nguồn: Unsplash Photo `photo-1544816155-12df9643f363` (`https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=800&q=80`)
     - `ao-thun-unisex-oversized-graphic-minimalist.jpg` — Nguồn: Unsplash Photo `photo-1576566588028-4147f3842f27` (`https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=800&q=80`)
     - `quan-jean-unisex-ong-suong-rong-rai-baggy-denim.jpg` — Nguồn: Unsplash Photo `photo-1541099649105-f69ad21f3246` (`https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=800&q=80`)
     - `tat-vo-unisex-co-cao-det-gan-cotton-khang-khuan-set-3-doi.jpg` — Nguồn: Unsplash Photo `photo-1586350977771-b3b0abd50c82` (`https://images.unsplash.com/photo-1586350977771-b3b0abd50c82?auto=format&fit=crop&w=800&q=80`)
2. **9 ảnh giữ chỗ SVG tự vẽ theo danh mục (`public/seed-images/placeholder-<category>.svg`)**:
   - Do dự án tự khởi tạo bằng vector SVG tối giản (hiển thị tên danh mục tiếng Việt và dòng chữ **"Ảnh đang cập nhật"**) dùng tạm cho 17 sản phẩm cần cập nhật ảnh mới, giúp trung thực với người mua và cho phép quản trị viên theo dõi trạng thái `CHƯA_CÓ_ẢNH_THẬT` trong tab **"Ảnh sản phẩm nhanh"** để thay dần bằng ảnh chụp thật.
3. **Lưu ý về thông tin chất liệu trong dữ liệu mẫu**:
   - Chất liệu, định lượng, thành phần trong dữ liệu mẫu do AI soạn chỉ để trình diễn; chủ cửa hàng phải thay bằng thông tin thật.

---

## 4. Hạn chế Đã Biết (Known Limitations) & Lộ Trình Nâng Cấp Sau Triển Khai

1. **Bộ đếm Rate Limit xác thực/đặt hàng/voucher lưu trong bộ nhớ tiến trình (In-Memory RAM)**:
   - Các bộ đếm `loginAttempts`, `orderCreateRateMap`, `voucherValidateRateMap`, `sellerChatRateMap` được giữ trong bộ nhớ của tiến trình Node.js (có giới hạn trần 10.000 mục và tự dọn dẹp chống tràn RAM). Khi khởi động lại server hoặc chạy nhiều instance song song, trạng thái bộ đếm RAM không chia sẻ giữa các instance (riêng giới hạn chi phí AI `/api/visual-search` và `/api/chat` đã lưu bền vững trong bảng PostgreSQL `chatbot_daily_counters`).
   - **Rủi ro khóa tài khoản theo Email (Account Lockout DoS)**: Kẻ tấn công biết email của một người dùng có thể cố tình gửi sai mật khẩu 5 lần để kích hoạt khóa tạm thời 15 phút đối với email đó. Hướng nâng cấp tiếp theo là tích hợp Cloudflare Turnstile / CAPTCHA sau 3 lần sai và chuyển bộ đếm sang Redis.
2. **Tài khoản Admin chưa có xác thực 2 lớp (2FA / TOTP)**:
   - Hiện tại Admin đăng nhập bằng Email + Mật khẩu mạnh (được bảo vệ bởi rate limit, cookie `httpOnly; Secure; SameSite=Lax`, thu hồi phiên tức thì qua `password_changed_at` và ghi nhật ký `admin_audit_logs`). Cần đặt mật khẩu Admin dài tối thiểu 16 ký tự ngẫu nhiên và xoay vòng định kỳ.
3. **Thanh toán Ví điện tử (MoMo / ZaloPay) và Thẻ tín dụng đang ở chế độ mô phỏng luồng chuyển hướng**:
   - Phương thức **COD** và **Chuyển khoản ngân hàng VietQR** (kèm đối soát Webhook HMAC-SHA256 tại `POST /api/payments/webhook` và duyệt thủ công các ca lệch tiền/trễ hạn tại trang Admin) hoạt động đầy đủ. Các cổng MoMo / ZaloPay / Thẻ quốc tế hiện dùng trang xác nhận giả lập nội bộ và cần đăng ký Merchant doanh nghiệp thật khi mở rộng.
4. **Hoàn tiền đổi trả và Vận chuyển xử lý bán tự động**:
   - Hệ thống quản lý đầy đủ luồng yêu cầu đổi trả, tải ảnh minh chứng riêng tư (Signed URL 15 phút), Admin duyệt/từ chối và hoàn kho khi nhận hàng trả (`POST /api/admin/returns/:id/receive`), nhưng thao tác chuyển khoản trả lại tiền cho khách và tạo vận đơn bên thứ ba (GHN/GHTK) được nhân viên thực hiện ngoài hệ thống rồi cập nhật mã vận đơn/trạng thái trên trang Admin.

---

## 5. Cẩm nang Triển khai & Vận hành Production (Render + Supabase Runbook)

### 5.1. Bước 1: Khởi tạo Dự án Supabase Production Mới (Tách biệt hoàn toàn với Dev)
1. Đăng nhập [Supabase Dashboard](https://supabase.com/dashboard) và tạo project mới (ví dụ: `baity-fashion-production`, chọn Region **Southeast Asia (Singapore)** `ap-southeast-1` để có độ trễ thấp nhất tại Việt Nam).
2. **Tạo 2 Storage Buckets** trong mục **Storage -> Buckets**:
   - Bucket 1: Đặt tên chính xác **`baity-media`** (hoặc giá trị bạn đặt cho `SUPABASE_PUBLIC_BUCKET`) -> Bật **Public bucket = ON** (dùng lưu ảnh sản phẩm, ảnh đại diện, ảnh đánh giá).
   - Bucket 2: Đặt tên chính xác **`baity-returns`** (hoặc giá trị bạn đặt cho `SUPABASE_RETURNS_BUCKET`) -> Giữ **Public bucket = OFF (Private)** (dùng lưu ảnh minh chứng đổi trả, chỉ truy cập qua Signed URL 15 phút).
3. **Lấy chuỗi kết nối CSDL (`DATABASE_URL`)**:
   - Vào **Project Settings -> Database -> Connection string -> URI**.
   - Chọn chế độ **Session pooler** (cổng `5432`, hỗ trợ đầy đủ prepared statements và khóa giao dịch `SELECT ... FOR UPDATE` của Drizzle ORM):
     ```text
     postgresql://postgres.[project-ref]:[MAT_KHAU_DB]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require
     ```
4. **Lấy khóa kết nối Supabase API**:
   - Vào **Project Settings -> API**: sao chép **Project URL** (`SUPABASE_URL`) và khóa bí mật **`service_role` secret** (`SUPABASE_SERVICE_ROLE_KEY`).

### 5.2. Bước 2: Cấu hình Dịch vụ Web trên Render
1. Tạo một **Web Service** mới trên [Render](https://dashboard.render.com/) kết nối tới kho mã nguồn Git của dự án.
2. Thiết lập thông số Build & Runtime trên Render:
   - **Runtime / Environment**: `Node` (phiên bản Node.js **>= 22.x**, khuyến nghị `22.14.0`).
   - **Build Command**: `npm ci --include=dev && npm run build` *(sử dụng `npm ci --include=dev` để cài đặt chính xác theo `package-lock.json` bao gồm cả `devDependencies` phục vụ đóng gói Vite/TypeScript ngay cả khi Render đặt `NODE_ENV=production` trong bước Build)*.
   - **Start Command**: `npm start` *(chạy `tsx server.ts`, tự động lắng nghe trên cổng `process.env.PORT` do Render cấp và phục vụ cả giao diện tĩnh đã đóng gói trong `dist/` lẫn toàn bộ nhánh `/api/*`)*.
   - **Health Check Path**: `/api/health` *(trả về HTTP `200` kèm `{"status":"ok","database":"connected"}` khi CSDL hoạt động bình thường, hoặc HTTP `503` kèm `{"status":"error"}` khi lỗi kết nối CSDL)*.
3. Khai báo **Environment Variables** trên Render:
   ```env
   NODE_ENV=production
   PRODUCTION_STRICT=true
   USE_PGLITE=false
   SEED_DEV_ACCOUNTS=false
   COOKIE_CROSS_SITE=false
   TRUST_PROXY_HOPS=1
   FRAME_ANCESTORS=
   APP_URL=https://ten-mien-cua-ban.onrender.com
   ALLOWED_ORIGINS=https://ten-mien-cua-ban.onrender.com
   DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require
   JWT_SECRET=<chuoi-ngau-nhien-64-ky-tu-hex>
   ADMIN_EMAIL=quanly@baity.vn
   ADMIN_INITIAL_PASSWORD=<mat-khau-admin-manh-tren-12-ky-tu>
   SUPABASE_URL=https://[project-ref].supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key-cua-supabase-prod>
   SUPABASE_PUBLIC_BUCKET=baity-media
   SUPABASE_RETURNS_BUCKET=baity-returns
   EMAIL_PROVIDER=brevo
   EMAIL_FROM=Baity Fashion <ops@baity.vn>
   BREVO_API_KEY=<khoa-api-brevo-cua-ban>
   ENABLE_DEMO_EMAIL_LOG=false
   ENABLE_SEED_DEMO_DATA=false
   GEMINI_API_KEY=<khoa-api-gemini-cua-ban>
   CHATBOT_MODEL=gemini-3-flash-preview
   VISUAL_SEARCH_MODEL=gemini-3-flash-preview
   CRON_SECRET_KEY=<khoa-bi-mat-cho-cron-cleanup>
   PAYMENT_WEBHOOK_SECRET=<khoa-bi-mat-hmac-webhook-thanh-toan>
   ENABLE_DEMO_PAYMENT_WEBHOOK=false
   ```

### 5.3. Bước 3: Chạy Migration & Khởi tạo Lần đầu trên CSDL Trống
- Khi Web Service trên Render khởi động lần đầu tiên kết nối vào Supabase Production trống:
  1. `initDatabase()` tự động chạy toàn bộ chuỗi Drizzle migrations (`0000` đến `0011`) từ thư mục `migrations/`.
  2. `seedDatabase()` và `ensureBaselineStoreDataSeeded()` tự động tạo **1 tài khoản Admin duy nhất** từ `ADMIN_EMAIL` + `ADMIN_INITIAL_PASSWORD` **chỉ khi CSDL chưa có tài khoản Admin nào** (không bao giờ ghi đè mật khẩu hay quyền của Admin đã tồn tại ở các lần khởi động sau), đồng thời nạp **4 trang chính sách** (vận chuyển, đổi trả, bảo mật, điều khoản), **16 câu hỏi FAQ**, **cài đặt cửa hàng mặc định (`store_settings`)** và **9 danh mục sản phẩm gốc (`categories`)**.
  3. Vì `ENABLE_SEED_DEMO_DATA=false`, hệ thống **không nạp bất kỳ sản phẩm mẫu, đơn hàng mẫu, đánh giá mẫu hay tài khoản khách mẫu nào**.
- Bạn có thể kiểm tra diễn tập toàn bộ quy trình này trước khi deploy bằng lệnh:
  ```bash
  npm run prod:rehearsal
  ```

### 5.4. Danh mục Kiểm tra Sau Triển khai (15-Item Post-Deployment Checklist)
Ngay sau khi Render báo trạng thái **Live**, thực hiện kiểm tra lần lượt 15 mục sau:
1. [ ] **Healthcheck**: Truy cập `GET https://<domain>/api/health` trả về HTTP `200` và `"status": "ok"`, `"database": "connected"`.
2. [ ] **Giao diện trang chủ & tài nguyên tĩnh**: Mở `https://<domain>/` trên trình duyệt, trang chủ tải nhanh, font chữ Google Fonts và CSS hiển thị đúng, không có lỗi CSP trong DevTools Console.
3. [ ] **Điều hướng SPA trực tiếp**: Truy cập trực tiếp `https://<domain>/products` và F5 làm mới trang — server trả về giao diện React (HTTP `200`), không bị lỗi 404.
4. [ ] **Kiểm tra Header bảo mật**: Kiểm tra Response Headers của `/` có `Content-Security-Policy` chứa `frame-ancestors 'self'`, `script-src 'self'` (không có `'unsafe-inline'` hay `'unsafe-eval'`) và không có route `/api/auth/diag` (truy cập `/api/auth/diag` trả `404`).
5. [ ] **Đăng nhập Admin lần đầu**: Đăng nhập tại `/login` bằng `ADMIN_EMAIL` và `ADMIN_INITIAL_PASSWORD` (được tạo tự động một lần duy nhất khi CSDL trống), truy cập được `/admin` và xem được bảng tổng quan.
6. [ ] **Đổi mật khẩu Admin ngay lần đầu & xóa biến khởi tạo**: Vào hồ sơ tài khoản đổi mật khẩu Admin mới qua giao diện/API, sau đó xóa biến `ADMIN_INITIAL_PASSWORD` trên Render (ở strict mode, khi CSDL đã có Admin thì không bắt buộc biến này và các lần khởi động lại tiếp theo sẽ giữ nguyên mật khẩu mới trong CSDL).
7. [ ] **Xác minh không có tài khoản mẫu**: Thử đăng nhập bằng `khach1@baity.vn` / `Khach@123` — hệ thống phải từ chối (`401`).
8. [ ] **Kiểm tra Danh mục & Chính sách nền**: Truy cập `/api/categories` (có đủ 9 danh mục gốc) và mở các trang Chính sách bảo mật, Chính sách đổi trả, FAQ dưới chân trang hiển thị đầy đủ nội dung.
9. [ ] **Tải ảnh lên Supabase Storage**: Trong trang Admin (`/admin`), tạo thử 1 sản phẩm mới và tải ảnh từ máy tính lên — ảnh phải trả về URL thuộc `https://<project-ref>.supabase.co/storage/v1/object/public/baity-media/...` và hiển thị rõ nét.
10. [ ] **Đăng ký khách hàng & Đặt hàng thử**: Tạo 1 tài khoản khách hàng thật, thêm sản phẩm vào giỏ, đặt thử 1 đơn COD và kiểm tra đơn xuất hiện trong `/admin` -> Quản lý đơn hàng.
11. [ ] **Kiểm tra Quên mật khẩu thật**: Thực hiện "Quên mật khẩu" với email thật của bạn, kiểm tra nhận được email từ Brevo/Resend chứa liên kết `https://<domain>/reset-password?token=...` và kiểm tra log Render **không in link hay token**.
12. [ ] **Kiểm tra Trợ lý tư vấn AI (`/api/chat`)**: Mở khung chat AI ở góc phải, hỏi thử *"Chính sách đổi trả của shop như thế nào?"*, nhận được câu trả lời tiếng Việt tự nhiên.
13. [ ] **Kiểm tra Tìm kiếm bằng hình ảnh (`/api/visual-search`)**: Tải thử 1 ảnh áo/quần lên thanh tìm kiếm bằng hình ảnh, kiểm tra trả về loại trang phục và độ tin cậy `>= 0.50`.
14. [ ] **Kiểm tra Chat với người bán**: Từ tài khoản khách, gửi 1 tin nhắn trong mục "Chat với người bán", sau đó vào trang Admin tab **"Hỏi đáp"** phản hồi lại thành công.
15. [ ] **Kích hoạt thử & đặt lịch Cron Cleanup**: Gọi thử `curl -X POST https://<domain>/api/tasks/cron-cleanup -H "x-cron-secret: <CRON_SECRET_KEY>"` trả về HTTP `200` kèm `{"success":true,"cancelledOrders":0,...}`, và đặt lịch gọi `cron-cleanup` mỗi 10 phút bằng dịch vụ cron bên ngoài, header `x-cron-secret`.

### 5.5. Sao lưu & Khôi phục Dữ liệu (Backup & Restore)
1. **Sao lưu tự động trên Supabase**:
   - Trên gói Supabase Pro, bật **Daily Automated Backups** và **Point-in-Time Recovery (PITR)** trong mục *Database -> Backups*.
2. **Sao lưu thủ công bằng `pg_dump` (khuyến nghị chạy trước mỗi đợt nâng cấp lớn)**:
   ```bash
   # Sao lưu toàn bộ cấu trúc và dữ liệu ra file nén định dạng custom (.dump)
   pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="baity_prod_$(date +%Y%m%d_%H%M%S).dump"
   ```
3. **Khôi phục từ bản sao lưu (`pg_restore`)**:
   ```bash
   # Khôi phục vào database đích (chỉ thực hiện khi đã tạm dừng Web Service trên Render)
   pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$TARGET_DATABASE_URL" baity_prod_YYYYMMDD_HHMMSS.dump
   ```
4. **Sao lưu Supabase Storage**: Các tệp trong bucket `baity-media` và `baity-returns` độc lập với PostgreSQL dump; sử dụng Supabase Storage CLI hoặc script đồng bộ S3-compatible endpoint của Supabase Storage để sao lưu định kỳ.

### 5.6. Quy trình Xoay vòng Khóa Bí mật (Secret Key Rotation)
Khi nghi ngờ lộ khóa hoặc định kỳ mỗi 90 ngày, thực hiện xoay vòng theo thứ tự sau:
1. **`JWT_SECRET`**:
   - Sinh khóa mới (`openssl rand -hex 32`), cập nhật `JWT_SECRET` trên Render và khởi động lại dịch vụ.
   - **Hệ quả**: Toàn bộ phiên đăng nhập hiện tại của khách hàng và Admin sẽ tự động đăng xuất và yêu cầu đăng nhập lại (an toàn 100%, không mất dữ liệu).
2. **`SUPABASE_SERVICE_ROLE_KEY`**:
   - Trên Supabase Dashboard (*Project Settings -> API*), thực hiện tạo API key mới / roll key, cập nhật ngay `SUPABASE_SERVICE_ROLE_KEY` trên Render và redeploy.
3. **`GEMINI_API_KEY`, `BREVO_API_KEY` / `RESEND_API_KEY`**:
   - Tạo khóa mới trên bảng điều khiển Google AI Studio / Brevo / Resend, cập nhật biến môi trường tương ứng trên Render, kiểm tra hoạt động rồi thu hồi (revoke) khóa cũ.
4. **`CRON_SECRET_KEY` & `PAYMENT_WEBHOOK_SECRET`**:
   - Cập nhật đồng thời trên Render và trên trình lập lịch Cron / cấu hình Webhook của đối tác thanh toán.

---

## 6. Lệnh Chạy & Kiểm Thử

```bash
# Chạy môi trường phát triển (Express + Vite port 3000)
npm run dev

# Kiểm tra đồng bộ Drizzle Schema + export:check + tsc --noEmit + Chạy toàn bộ Unit & HTTP Endpoint Tests
npm test

# Kiểm tra an toàn xuất mã nguồn lên Git (chỉ đọc: quét khóa bí mật, .env, .gitignore, dung lượng <= 5MB)
npm run export:check

# Chạy riêng bộ test tranh chấp đồng thời trên PostgreSQL thật của Supabase:
TEST_DATABASE_URL="${DATABASE_URL}?schema=test_pg" npm run test:pg

# Diễn tập khởi tạo Production trên CSDL trống
npm run prod:rehearsal

# Kiểm tra kiểu TypeScript
npm run lint

# Build bản Production
npm run build
```

### 6.1. Chạy test trên máy mới (Clean Clone)
- Ngay sau khi `git clone` dự án về một máy mới (chưa có thư mục `.data`, chưa tạo tệp `.env`, không có kết nối tới CSDL Supabase thử hay khóa `GEMINI_API_KEY`), chỉ cần chạy:
  ```bash
  npm ci && npm test
  ```
- Quy trình `npm test` hoàn toàn tự chủ:
  1. Kiểm tra đồng bộ Drizzle Schema (`scripts/check-schema-drift.ts`), kiểm tra an toàn xuất mã nguồn (`npm run export:check`) và kiểm tra kiểu TypeScript (`npx tsc --noEmit`).
  2. Tự động khởi tạo PostgreSQL nhúng PGlite trong bộ nhớ (`USE_PGLITE=true`, `NODE_ENV=test`), áp dụng toàn bộ migrations từ `migrations/` và nạp dữ liệu mẫu nội bộ (`public/seed-images/*`).
  3. Mọi bài kiểm thử tính năng AI (Chatbot, Tìm kiếm hình ảnh), lưu trữ ảnh (`Storage`) và gửi email đều sử dụng dữ liệu/client kiểm thử cô lập nội bộ, không gọi mạng ngoài (Gemini, Unsplash, Supabase, Brevo/Resend) và không phụ thuộc vào tệp cache trong `.data/`.





