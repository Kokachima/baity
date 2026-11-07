import { VOUCHER_VALIDATE_MAX_REQUESTS, VOUCHER_VALIDATE_WINDOW_MS } from './vouchers.ts';

export interface PublicMutatingRouteEntry {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  fullPath: string;
  category:
    | 'register'
    | 'login'
    | 'logout'
    | 'forgot_reset_password'
    | 'guest_cart'
    | 'voucher_validate'
    | 'webhook_hmac'
    | 'cron_secret'
    | 'chatbot'
    | 'visual_search';
  authMiddleware: '(public)' | 'optionalAuth';
  reason: string;
}

const VOUCHER_VALIDATE_WINDOW_MINUTES = Math.round(VOUCHER_VALIDATE_WINDOW_MS / 60000);

/**
 * Danh sách công khai tường minh cho các route thay đổi dữ liệu (POST/PUT/PATCH/DELETE)
 * không bắt buộc requireAuth / requireAdmin ở tầng router.
 * Mọi route thay đổi dữ liệu mới nếu không gắn requireAuth/requireAdmin và không nằm trong
 * danh sách này sẽ làm bài kiểm tra kiểm toán bảo mật route thất bại ngay lập tức.
 */
export const PUBLIC_MUTATING_ROUTE_ALLOWLIST: readonly PublicMutatingRouteEntry[] = [
  {
    method: 'POST',
    fullPath: '/api/auth/register',
    category: 'register',
    authMiddleware: '(public)',
    reason: 'Đăng ký tài khoản khách hàng mới (ép cứng role=customer phía server, giới hạn 10 lần/15 phút/IP)',
  },
  {
    method: 'POST',
    fullPath: '/api/auth/login',
    category: 'login',
    authMiddleware: '(public)',
    reason: 'Đăng nhập tài khoản để nhận cookie xác thực httpOnly (giới hạn 10 lần/15 phút/IP, khóa tạm 15 phút khi sai 5 lần)',
  },
  {
    method: 'POST',
    fullPath: '/api/auth/logout',
    category: 'logout',
    authMiddleware: '(public)',
    reason: 'Đăng xuất xóa cookie phiên đăng nhập (cho phép gọi ngay cả khi token đã hết hạn)',
  },
  {
    method: 'POST',
    fullPath: '/api/auth/forgot-password',
    category: 'forgot_reset_password',
    authMiddleware: '(public)',
    reason: 'Quên mật khẩu: gửi yêu cầu tạo token khôi phục một lần qua email (giới hạn 5 lần/15 phút/IP)',
  },
  {
    method: 'POST',
    fullPath: '/api/auth/reset-password',
    category: 'forgot_reset_password',
    authMiddleware: '(public)',
    reason: 'Đặt lại mật khẩu mới bằng token khôi phục một lần (băm SHA-256, hết hạn sau 15 phút, giới hạn 5 lần/15 phút/IP)',
  },
  {
    method: 'POST',
    fullPath: '/api/cart',
    category: 'guest_cart',
    authMiddleware: 'optionalAuth',
    reason: 'Giỏ hàng khách: thêm sản phẩm vào giỏ hàng của khách vãng lai (cookie session_id) hoặc người dùng đã đăng nhập (tối đa 10 chiếc/món, 50 dòng/giỏ)',
  },
  {
    method: 'PUT',
    fullPath: '/api/cart/:id',
    category: 'guest_cart',
    authMiddleware: 'optionalAuth',
    reason: 'Giỏ hàng khách: cập nhật số lượng dòng sản phẩm trong giỏ của khách vãng lai hoặc người dùng đã đăng nhập (1–10 chiếc/món)',
  },
  {
    method: 'PUT',
    fullPath: '/api/cart',
    category: 'guest_cart',
    authMiddleware: 'optionalAuth',
    reason: 'Giỏ hàng khách: cập nhật số lượng sản phẩm trong giỏ của khách vãng lai hoặc người dùng đã đăng nhập (1–10 chiếc/món)',
  },
  {
    method: 'DELETE',
    fullPath: '/api/cart/:id',
    category: 'guest_cart',
    authMiddleware: 'optionalAuth',
    reason: 'Giỏ hàng khách: xóa một dòng sản phẩm khỏi giỏ của khách vãng lai hoặc người dùng đã đăng nhập',
  },
  {
    method: 'DELETE',
    fullPath: '/api/cart',
    category: 'guest_cart',
    authMiddleware: 'optionalAuth',
    reason: 'Giỏ hàng khách: xóa sản phẩm hoặc làm trống giỏ hàng của khách vãng lai hoặc người dùng đã đăng nhập',
  },
  {
    method: 'POST',
    fullPath: '/api/vouchers/validate',
    category: 'voucher_validate',
    authMiddleware: 'optionalAuth',
    reason: `Kiểm tra voucher: tính thử mức giảm giá trên giỏ hàng (giới hạn tốc độ ${VOUCHER_VALIDATE_MAX_REQUESTS} lần/${VOUCHER_VALIDATE_WINDOW_MINUTES} phút)`,
  },
  {
    method: 'POST',
    fullPath: '/api/vouchers/apply',
    category: 'voucher_validate',
    authMiddleware: 'optionalAuth',
    reason: `Kiểm tra voucher (alias apply): tính thử mức giảm giá voucher cho giỏ hàng hiện tại (giới hạn tốc độ ${VOUCHER_VALIDATE_MAX_REQUESTS} lần/${VOUCHER_VALIDATE_WINDOW_MINUTES} phút)`,
  },
  {
    method: 'POST',
    fullPath: '/api/payments/webhook',
    category: 'webhook_hmac',
    authMiddleware: '(public)',
    reason: 'Webhook có HMAC: xác nhận thanh toán VietQR tự động, bắt buộc chữ ký HMAC-SHA256 trên rawBody kèm x-webhook-timestamp 5 phút',
  },
  {
    method: 'POST',
    fullPath: '/api/tasks/cron-cleanup',
    category: 'cron_secret',
    authMiddleware: '(public)',
    reason: 'Cron có khóa bí mật: dọn dẹp đơn hàng hết hạn 30 phút và hoàn tất đơn sau 7 ngày, bắt buộc khớp header x-cron-secret (CRON_SECRET_KEY)',
  },
  {
    method: 'POST',
    fullPath: '/api/chat',
    category: 'chatbot',
    authMiddleware: 'optionalAuth',
    reason: 'Trợ lý tư vấn trực tuyến: hỗ trợ khách vãng lai và khách đã đăng nhập hỏi sản phẩm/chính sách (giới hạn 500 ký tự, bộ đếm nguyên tử trong DB, chỉ tra cứu đơn của chính req.user)',
  },
  {
    method: 'POST',
    fullPath: '/api/visual-search',
    category: 'visual_search',
    authMiddleware: 'optionalAuth',
    reason: 'Tìm sản phẩm bằng ảnh AI: cho phép cả khách chưa đăng nhập tìm kiếm bằng 1 ảnh (<=5MB, xử lý trong bộ nhớ bằng sharp, không lưu ảnh vào Storage/uploads, bộ đếm nguyên tử trong DB)',
  },
  {
    method: 'POST',
    fullPath: '/api/visual-search/refine',
    category: 'visual_search',
    authMiddleware: 'optionalAuth',
    reason: 'Lọc lại kết quả tìm kiếm bằng ảnh theo thuộc tính đã chỉnh sửa (không nhận ảnh, không gọi Gemini, chỉ chấm điểm SQL trên sản phẩm công khai)',
  },
] as const;
