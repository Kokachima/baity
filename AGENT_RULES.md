# AGENT_RULES.md — Quy Tắc Làm Việc Bền Vững

Tài liệu này quy định các nguyên tắc bắt buộc đối với Agent trong mọi lượt làm việc nhằm chống sai lệch thông tin khi cuộc trò chuyện bị nén ngữ cảnh.

## Quy tắc cố định (a – i)

- **(a) Nguồn dữ liệu thực tế trong lượt hiện tại**: Mọi tên file, số dòng, số lượng bài test, đoạn mã, tên migration và kết quả lệnh trong báo cáo **chỉ được lấy trực tiếp từ lệnh vừa chạy trong chính lượt đó** (tuyệt đối không viết từ trí nhớ hay bản tóm tắt cũ). Đầu mỗi báo cáo phải liệt kê rõ toàn bộ các lệnh đã chạy; nếu không chạy được lệnh nào thì nói rõ, không bịa kết quả.
- **(b) Đồng bộ trạng thái đầu và cuối tác vụ**: Đầu mỗi tác vụ phải đọc `AGENT_RULES.md` và chạy `npm run state`; cuối tác vụ sau khi hoàn tất mọi thay đổi phải chạy lại `npm run state` để cập nhật `PROJECT_STATE.md`.
- **(c) Bất biến Migration**: Không bao giờ chỉnh sửa bất kỳ file migration nào đã được tạo (`migrations/*.sql`), và không bao giờ tạo migration mới chỉ để phục vụ bài test.
- **(d) Bảo mật thông tin nhạy cảm**: Tuyệt đối không in ra màn hình, phản hồi API hay ghi log mật khẩu (dạng rõ hoặc băm), token xác thực, khóa bí mật (`JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYMENT_WEBHOOK_SECRET`, `CRON_SECRET_KEY`, `DATABASE_URL` chứa mật khẩu).
- **(e) Kiểm soát truy cập mọi Route thay đổi dữ liệu**: Mọi route thay đổi dữ liệu (`POST`, `PUT`, `PATCH`, `DELETE`) bắt buộc phải gắn middleware xác thực (`requireAuth` hoặc `requireAdmin`) ở tầng router, hoặc phải được khai báo tường minh kèm lý do chính đáng trong danh sách cho phép công khai (`server/routes/publicRouteAllowlist.ts`).
- **(f) Toàn vẹn giá, tồn kho và hoàn tiền phía Server**: Đơn giá sản phẩm, phí vận chuyển, chiết khấu khuyến mãi/voucher, số lượng tồn kho và số tiền hoàn trả (`refund_amount`) luôn do Server tự tính toán từ cơ sở dữ liệu; bỏ qua mọi giá trị tiền hoặc trạng thái do Client tự gửi lên.
- **(g) Điều kiện báo cáo "Hoàn tất"**: Chỉ được báo "hoàn tất" khi `npm test` và `npx tsc --noEmit` (cùng `npm run test:pg` khi tác vụ có liên quan đến PostgreSQL/migration/đồng thời) đã được chạy thật trong lượt đó và vượt qua 100%.
- **(h) Công cụ chỉ dành cho Dev**: Các công cụ can thiệp dữ liệu dev (như `npm run dev:set-order-status`) chỉ được phép chạy khi người dùng yêu cầu rõ ràng và cung cấp mã đơn thực tế (không chạy với mã giữ chỗ/placeholder).
- **(i) Định dạng báo cáo ngắn gọn, trung thực**: Báo cáo chỉ nêu dòng tổng kết kết quả test, các dòng `"not ok"` (nếu có), kết quả `tsc --noEmit` và bảng đối chiếu `Mục | File đã sửa | Tên bài test`. Mục nào không có bài test tự động thì ghi rõ `"không có test"`, tuyệt đối không gán ghép bài test không liên quan.
