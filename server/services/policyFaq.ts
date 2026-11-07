import { sql } from 'drizzle-orm';
import { queryRows } from '../db/index.ts';
import { stripRawHtmlFromMarkdown, parseSafeMarkdownBlocks } from '../../shared/safeMarkdown.ts';
import { MISSING_CONTACT_INFO_TEXT, DEFAULT_SHIPPING_CONFIG } from '../../shared/contracts.ts';
import { resolveVietQRBankName, FALLBACK_STORE_BANK_LABEL } from './vietqr.ts';

export { MISSING_CONTACT_INFO_TEXT, resolveVietQRBankName as resolveVietQrBankName };

export const DEFAULT_POLICY_SLUGS = ['return', 'shipping', 'payment', 'privacy'] as const;

export interface StoreContactSettings {
  storeName: string;
  hotline: string | null;
  email: string | null;
  address: string | null;
  workingHours: string | null;
  legalEntityName: string | null;
  taxId: string | null;
  returnAddress: string | null;
}

export async function getStoreContactSettings(
  runQuery: <R = any>(q: any) => Promise<R[]> = queryRows
): Promise<StoreContactSettings> {
  const rows = await runQuery<{ key: string; value: any }>(sql`
    SELECT key, value FROM store_settings WHERE key IN ('contact', 'general', 'returns');
  `);
  const contactVal = rows.find((r) => r.key === 'contact')?.value || {};
  const generalVal = rows.find((r) => r.key === 'general')?.value || {};
  const returnsVal = rows.find((r) => r.key === 'returns')?.value || {};

  return {
    storeName: String(contactVal.storeName || generalVal.storeName || 'BAITY').trim(),
    hotline:
      cleanConfiguredContactValue(contactVal.hotline ?? contactVal.phone) ||
      cleanConfiguredContactValue(generalVal.supportPhone ?? generalVal.hotline ?? generalVal.phone) ||
      null,
    email:
      cleanConfiguredContactValue(contactVal.email) ||
      cleanConfiguredContactValue(generalVal.supportEmail ?? generalVal.email) ||
      null,
    address:
      cleanConfiguredContactValue(contactVal.address) ||
      cleanConfiguredContactValue(generalVal.address) ||
      null,
    workingHours:
      cleanConfiguredContactValue(contactVal.workingHours) ||
      cleanConfiguredContactValue(generalVal.workingHours) ||
      null,
    legalEntityName:
      cleanConfiguredContactValue(contactVal.legalEntityName) ||
      cleanConfiguredContactValue(generalVal.legalEntityName) ||
      null,
    taxId:
      cleanConfiguredContactValue(contactVal.taxId) ||
      cleanConfiguredContactValue(generalVal.taxId) ||
      null,
    returnAddress:
      cleanConfiguredContactValue(contactVal.returnAddress ?? returnsVal.returnAddress) ||
      cleanConfiguredContactValue(generalVal.returnAddress) ||
      null,
  };
}

// Hằng số nghiệp vụ đối chiếu trực tiếp với hệ thống
export const POLICY_SYSTEM_CONSTANTS = {
  ORDER_PAYMENT_TIMEOUT_MINUTES: 30,
  MAX_PENDING_ONLINE_ORDERS_PER_USER: 3,
  CART_MAX_QTY_PER_ITEM: 10,
  CART_MAX_DISTINCT_ITEMS: 50,
  MAX_UPLOAD_SIZE_MB: 5,
  MAX_REVIEW_IMAGES: 3,
  MAX_RETURN_PROOF_IMAGES: 3,
  SIGNED_URL_EXPIRES_MINUTES: 15,
  VOUCHER_VALIDATE_MAX_ATTEMPTS: 30,
  VOUCHER_VALIDATE_WINDOW_MINUTES: 1,
  CHATBOT_COUNTER_RETENTION_DAYS: 2,
  VISUAL_SEARCH_LOG_RETENTION_DAYS: 90,
  SELLER_CHAT_CLOSED_RETENTION_DAYS: 180,
} as const;

export const POLICY_SLUG_ALIASES: Readonly<Record<string, string>> = {
  return: 'return',
  'chinh-sach-doi-tra': 'return',
  'doi-tra': 'return',
  shipping: 'shipping',
  'chinh-sach-van-chuyen': 'shipping',
  'van-chuyen': 'shipping',
  payment: 'payment',
  'chinh-sach-thanh-toan': 'payment',
  'thanh-toan': 'payment',
  privacy: 'privacy',
  'chinh-sach-bao-mat': 'privacy',
  'bao-mat': 'privacy',
};

function formatVnd(amount: number): string {
  return `${Math.round(amount).toLocaleString('vi-VN')}₫`;
}

function camelToSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export const DEFAULT_POLICY_TEMPLATE_FALLBACKS: Readonly<Record<string, string>> = {
  shipping_fee_standard: formatVnd(DEFAULT_SHIPPING_CONFIG.defaultShippingFee),
  default_shipping_fee: formatVnd(DEFAULT_SHIPPING_CONFIG.defaultShippingFee),
  defaultShippingFee: formatVnd(DEFAULT_SHIPPING_CONFIG.defaultShippingFee),
  shipping_fee_standard_raw: String(DEFAULT_SHIPPING_CONFIG.defaultShippingFee),
  shipping_fee_express: formatVnd(DEFAULT_SHIPPING_CONFIG.expressShippingFee),
  express_shipping_fee: formatVnd(DEFAULT_SHIPPING_CONFIG.expressShippingFee),
  expressShippingFee: formatVnd(DEFAULT_SHIPPING_CONFIG.expressShippingFee),
  shipping_fee_express_raw: String(DEFAULT_SHIPPING_CONFIG.expressShippingFee),
  free_shipping_threshold: formatVnd(DEFAULT_SHIPPING_CONFIG.freeShippingThreshold),
  freeShippingThreshold: formatVnd(DEFAULT_SHIPPING_CONFIG.freeShippingThreshold),
  free_shipping_threshold_raw: String(DEFAULT_SHIPPING_CONFIG.freeShippingThreshold),
  return_window_days: String(DEFAULT_SHIPPING_CONFIG.returnDaysLimit),
  return_days: String(DEFAULT_SHIPPING_CONFIG.returnDaysLimit),
  return_days_limit: String(DEFAULT_SHIPPING_CONFIG.returnDaysLimit),
  returnDaysLimit: String(DEFAULT_SHIPPING_CONFIG.returnDaysLimit),
  payment_timeout_minutes: String(POLICY_SYSTEM_CONSTANTS.ORDER_PAYMENT_TIMEOUT_MINUTES),
  order_payment_timeout_minutes: String(POLICY_SYSTEM_CONSTANTS.ORDER_PAYMENT_TIMEOUT_MINUTES),
  max_pending_online_orders: String(POLICY_SYSTEM_CONSTANTS.MAX_PENDING_ONLINE_ORDERS_PER_USER),
  cart_max_qty_per_item: String(POLICY_SYSTEM_CONSTANTS.CART_MAX_QTY_PER_ITEM),
  cart_max_distinct_items: String(POLICY_SYSTEM_CONSTANTS.CART_MAX_DISTINCT_ITEMS),
  max_upload_size_mb: String(POLICY_SYSTEM_CONSTANTS.MAX_UPLOAD_SIZE_MB),
  max_review_images: String(POLICY_SYSTEM_CONSTANTS.MAX_REVIEW_IMAGES),
  max_return_proof_images: String(POLICY_SYSTEM_CONSTANTS.MAX_RETURN_PROOF_IMAGES),
  signed_url_expires_minutes: String(POLICY_SYSTEM_CONSTANTS.SIGNED_URL_EXPIRES_MINUTES),
  voucher_validate_max_attempts: String(POLICY_SYSTEM_CONSTANTS.VOUCHER_VALIDATE_MAX_ATTEMPTS),
  voucher_validate_window_minutes: String(POLICY_SYSTEM_CONSTANTS.VOUCHER_VALIDATE_WINDOW_MINUTES),
  chatbot_counter_retention_days: String(POLICY_SYSTEM_CONSTANTS.CHATBOT_COUNTER_RETENTION_DAYS),
  visual_search_log_retention_days: String(POLICY_SYSTEM_CONSTANTS.VISUAL_SEARCH_LOG_RETENTION_DAYS),
  seller_chat_retention_days: String(POLICY_SYSTEM_CONSTANTS.SELLER_CHAT_CLOSED_RETENTION_DAYS),
  store_name: 'Baity Fashion',
  storeName: 'Baity Fashion',
  store_phone: MISSING_CONTACT_INFO_TEXT,
  phone: MISSING_CONTACT_INFO_TEXT,
  store_email: MISSING_CONTACT_INFO_TEXT,
  email: MISSING_CONTACT_INFO_TEXT,
  store_address: MISSING_CONTACT_INFO_TEXT,
  address: MISSING_CONTACT_INFO_TEXT,
  return_address: MISSING_CONTACT_INFO_TEXT,
  returnAddress: MISSING_CONTACT_INFO_TEXT,
  store_contact_channels: `(**${MISSING_CONTACT_INFO_TEXT}**)`,
  vietqr_bank_name: FALLBACK_STORE_BANK_LABEL,
};

function cleanConfiguredContactValue(val: unknown): string {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim();
  if (!trimmed) return '';
  return trimmed;
}

export async function buildPolicyTemplateVariables(
  runQuery: <R = any>(q: any) => Promise<R[]> = queryRows
): Promise<Record<string, string>> {
  const rows = await runQuery<{ key: string; value: any }>(sql`
    SELECT key, value FROM store_settings WHERE key IN ('general', 'vietqr_config', 'contact', 'shipping', 'returns', 'inventory');
  `);

  const generalRow = rows.find((r) => r.key === 'general')?.value || {};
  const vietqrRow = rows.find((r) => r.key === 'vietqr_config')?.value || {};
  const contactRow = rows.find((r) => r.key === 'contact')?.value || {};
  const shippingRow = rows.find((r) => r.key === 'shipping')?.value || {};
  const returnsRow = rows.find((r) => r.key === 'returns')?.value || {};
  const inventoryRow = rows.find((r) => r.key === 'inventory')?.value || {};

  const standardFeeNum =
    typeof shippingRow.standardShippingFee === 'number'
      ? shippingRow.standardShippingFee
      : typeof shippingRow.defaultShippingFee === 'number'
      ? shippingRow.defaultShippingFee
      : typeof generalRow.standardShippingFee === 'number'
      ? generalRow.standardShippingFee
      : typeof generalRow.defaultShippingFee === 'number'
      ? generalRow.defaultShippingFee
      : typeof generalRow.shipping_fee_standard === 'number'
      ? generalRow.shipping_fee_standard
      : DEFAULT_SHIPPING_CONFIG.defaultShippingFee;

  const expressFeeNum =
    typeof shippingRow.expressShippingFee === 'number'
      ? shippingRow.expressShippingFee
      : typeof generalRow.expressShippingFee === 'number'
      ? generalRow.expressShippingFee
      : typeof generalRow.shipping_fee_express === 'number'
      ? generalRow.shipping_fee_express
      : DEFAULT_SHIPPING_CONFIG.expressShippingFee;

  const freeShipThresholdNum =
    typeof shippingRow.freeShippingThreshold === 'number'
      ? shippingRow.freeShippingThreshold
      : typeof generalRow.freeShippingThreshold === 'number'
      ? generalRow.freeShippingThreshold
      : typeof generalRow.free_shipping_threshold === 'number'
      ? generalRow.free_shipping_threshold
      : DEFAULT_SHIPPING_CONFIG.freeShippingThreshold;

  const returnDaysNum =
    typeof returnsRow.returnDaysLimit === 'number'
      ? returnsRow.returnDaysLimit
      : typeof generalRow.returnDaysLimit === 'number'
      ? generalRow.returnDaysLimit
      : typeof generalRow.return_window_days === 'number'
      ? generalRow.return_window_days
      : DEFAULT_SHIPPING_CONFIG.returnDaysLimit;

  const storeName = String(contactRow.storeName || generalRow.storeName || 'Baity Fashion');

  // Hotline, email, địa chỉ chỉ lấy từ store_settings (ưu tiên khóa 'contact', hỗ trợ 'general' khi cấu hình);
  // khi chưa có thì hiển thị "Cửa hàng chưa cập nhật thông tin liên hệ"
  const configuredPhone =
    cleanConfiguredContactValue(contactRow.phone ?? contactRow.hotline) ||
    cleanConfiguredContactValue(generalRow.phone ?? generalRow.hotline);
  const configuredEmail =
    cleanConfiguredContactValue(contactRow.email) ||
    cleanConfiguredContactValue(generalRow.email);
  const configuredAddress =
    cleanConfiguredContactValue(contactRow.address) ||
    cleanConfiguredContactValue(generalRow.address);
  const configuredReturnAddress =
    cleanConfiguredContactValue(returnsRow.returnAddress ?? contactRow.returnAddress) ||
    cleanConfiguredContactValue(generalRow.returnAddress) ||
    configuredAddress;
  const configuredWorkingHours =
    cleanConfiguredContactValue(contactRow.workingHours) ||
    cleanConfiguredContactValue(generalRow.workingHours);

  const storePhone = configuredPhone || MISSING_CONTACT_INFO_TEXT;
  const storeEmail = configuredEmail || MISSING_CONTACT_INFO_TEXT;
  const storeAddress = configuredAddress || MISSING_CONTACT_INFO_TEXT;
  const returnAddress = configuredReturnAddress || MISSING_CONTACT_INFO_TEXT;

  const storeContactChannels =
    configuredEmail && configuredPhone
      ? `qua email (**${configuredEmail}**) hoặc số điện thoại (**${configuredPhone}**)`
      : configuredEmail
      ? `qua email (**${configuredEmail}**)`
      : configuredPhone
      ? `qua số điện thoại (**${configuredPhone}**)`
      : `(**${MISSING_CONTACT_INFO_TEXT}**)`;

  // Tên ngân hàng lấy từ bảng ánh xạ BIN sang tên theo VIETQR_BANK_ID (hoặc vietqr_config.bankId);
  // không có thì chỉ ghi "tài khoản ngân hàng của cửa hàng"
  const envBankId = (process.env.VIETQR_BANK_ID || '').trim();
  const effectiveBankId = envBankId || cleanConfiguredContactValue(vietqrRow.bankId);
  const bankName = resolveVietQRBankName(effectiveBankId);

  const vars: Record<string, string> = {
    ...DEFAULT_POLICY_TEMPLATE_FALLBACKS,
    shipping_fee_standard: formatVnd(standardFeeNum),
    default_shipping_fee: formatVnd(standardFeeNum),
    defaultShippingFee: formatVnd(standardFeeNum),
    shipping_fee_standard_raw: String(standardFeeNum),

    shipping_fee_express: formatVnd(expressFeeNum),
    express_shipping_fee: formatVnd(expressFeeNum),
    expressShippingFee: formatVnd(expressFeeNum),
    shipping_fee_express_raw: String(expressFeeNum),

    free_shipping_threshold: formatVnd(freeShipThresholdNum),
    freeShippingThreshold: formatVnd(freeShipThresholdNum),
    free_shipping_threshold_raw: String(freeShipThresholdNum),

    return_window_days: String(returnDaysNum),
    return_days_limit: String(returnDaysNum),
    returnDaysLimit: String(returnDaysNum),

    store_name: storeName,
    storeName: storeName,
    store_phone: storePhone,
    phone: storePhone,
    hotline: storePhone,
    store_email: storeEmail,
    email: storeEmail,
    store_address: storeAddress,
    address: storeAddress,
    return_address: returnAddress,
    returnAddress: returnAddress,
    working_hours: configuredWorkingHours || 'theo giờ hành chính của cửa hàng',
    workingHours: configuredWorkingHours || 'theo giờ hành chính của cửa hàng',
    store_contact_channels: storeContactChannels,
    vietqr_bank_name: bankName,
  };

  for (const sourceObj of [generalRow, contactRow, shippingRow, returnsRow, inventoryRow]) {
    if (sourceObj && typeof sourceObj === 'object') {
      for (const [k, v] of Object.entries(sourceObj)) {
        if (v === null || v === undefined || typeof v === 'object') continue;
        const snakeKey = camelToSnakeCase(k);
        const isCurrencyField = /fee|threshold|price|amount/i.test(k);
        const formattedVal =
          typeof v === 'number' && isCurrencyField ? formatVnd(v) : String(v);
        if (!(k in vars)) vars[k] = formattedVal;
        if (!(snakeKey in vars)) vars[snakeKey] = formattedVal;
        if (typeof v === 'number') {
          vars[`${k}_raw`] = String(v);
          vars[`${snakeKey}_raw`] = String(v);
        }
      }
    }
  }

  return vars;
}

/**
 * Thay thế toàn bộ biến mẫu {{...}} trong nội dung chính sách/FAQ.
 * Đảm bảo KHÔNG BAO GIỜ để sót {{...}} thô ra màn hình:
 * nếu thiếu khóa trong `vars`, tự động lấy giá trị mặc định trong DEFAULT_POLICY_TEMPLATE_FALLBACKS
 * (hoặc chuỗi mặc định an toàn) và ghi cảnh báo console.warn.
 */
export function interpolatePolicyContent(
  rawContent: string,
  vars: Record<string, string> = {}
): string {
  const withoutHtml = stripRawHtmlFromMarkdown(rawContent || '');
  const replaced = withoutHtml.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_fullMatch, varName: string) => {
    if (
      vars &&
      Object.prototype.hasOwnProperty.call(vars, varName) &&
      vars[varName] !== undefined &&
      vars[varName] !== null &&
      String(vars[varName]).trim() !== ''
    ) {
      return stripRawHtmlFromMarkdown(String(vars[varName]));
    }
    const fallbackVal = Object.prototype.hasOwnProperty.call(
      DEFAULT_POLICY_TEMPLATE_FALLBACKS,
      varName
    )
      ? DEFAULT_POLICY_TEMPLATE_FALLBACKS[varName]
      : 'theo quy định cửa hàng';
    console.warn(
      `[policyFaq] Cảnh báo: Thiếu biến mẫu "{{${varName}}}", tự động dùng giá trị mặc định "${fallbackVal}".`
    );
    return stripRawHtmlFromMarkdown(fallbackVal);
  });

  // Lớp bảo vệ thứ 2: nếu còn bất kỳ cặp {{...}} bất thường nào khác, thay bằng giá trị mặc định và ghi cảnh báo
  return replaced.replace(/\{\{[^}]*\}\}/g, (strayMatch) => {
    console.warn(
      `[policyFaq] Cảnh báo: Phát hiện biểu thức mẫu chưa thay thế "${strayMatch}", đã thay bằng giá trị mặc định.`
    );
    return 'theo quy định cửa hàng';
  });
}

export interface SeedPolicyFaqItem {
  slug: string;
  type: string;
  title: string;
  content: string;
  displayOrder: number;
}

export const SEED_POLICIES_AND_FAQ_ITEMS: readonly SeedPolicyFaqItem[] = [
  // ==========================================
  // 4 CHÍNH SÁCH CỬA HÀNG (POLICIES)
  // ==========================================
  {
    slug: 'return',
    type: 'return',
    title: 'Chính sách đổi trả & hoàn tiền trong {{return_window_days}} ngày',
    displayOrder: 1,
    content: `## 1. Thời hạn và điều kiện áp dụng đổi trả
Khách hàng được quyền gửi yêu cầu **đổi kích cỡ/màu sắc** hoặc **hoàn tiền** trong vòng **{{return_window_days}} ngày** kể từ thời điểm đơn hàng được ghi nhận giao thành công.

- Đơn hàng phải đang ở trạng thái **Đã giao hàng**. Quá thời hạn **{{return_window_days}} ngày** kể từ ngày giao thành công, hệ thống tự động chuyển đơn sang trạng thái **Hoàn tất** và ngừng nhận yêu cầu đổi trả mới.
- **Quy tắc bảo vệ quyền lợi khi cửa hàng điều chỉnh số ngày đổi trả**: Nếu cửa hàng rút ngắn thời hạn đổi trả trong cài đặt, các đơn hàng đã giao trước thời điểm thay đổi vẫn được bảo lưu quyền đổi trả tối thiểu theo mốc chuẩn ban đầu (tối thiểu 07 ngày hoặc theo thời hạn đang có lợi hơn cho khách hàng); nếu cửa hàng tăng thời hạn đổi trả, thời hạn mới được áp dụng ngay cho mọi đơn đang ở trạng thái **Đã giao hàng**.
- Tình trạng sản phẩm hoàn trả (tem mác, bao bì, dấu hiệu qua sử dụng hoặc giặt ủi) được kiểm tra khi nhận lại hàng theo quy định của **{{store_name}}**.
- Số lượng yêu cầu đổi trả không được vượt quá số lượng đã mua của sản phẩm đó trong đơn, và mỗi dòng sản phẩm chỉ có tối đa **01 yêu cầu đổi trả** đang xử lý cùng lúc.
- Quý khách có thể đính kèm tối đa **{{max_return_proof_images}} ảnh minh chứng** (định dạng JPG, PNG hoặc WEBP, dung lượng tối đa **{{max_upload_size_mb}}MB**/ảnh).

## 2. Quy tắc tính tiền hoàn và chính sách phí vận chuyển
- **Số tiền hoàn được hệ thống tự động tính toán** dựa trên đơn giá thực tế quý khách đã thanh toán tại thời điểm đặt hàng.
- **Phân bổ ưu đãi từ mã giảm giá (Voucher)**:
  - Nếu đơn hàng áp dụng mã giảm giá theo phần trăm hoặc số tiền cố định, khoản giảm giá được phân bổ theo tỷ lệ giá trị của sản phẩm hoàn trả so với tổng tiền hàng.
  - Nếu đơn hàng áp dụng mã miễn phí vận chuyển, khoản ưu đãi vận chuyển **không bị trừ** vào tiền hoàn của sản phẩm.
- **Chính sách phí vận chuyển khi đổi trả**: Mặc định **không hoàn lại phí vận chuyển ban đầu**, trừ trường hợp lỗi thuộc về cửa hàng (như **sản phẩm bị lỗi từ nhà sản xuất** hoặc **giao sai mẫu/kích cỡ**) và được **cửa hàng xác nhận** khi duyệt yêu cầu đổi trả.
- Tổng số tiền hoàn tích lũy của các lần đổi trả trong một đơn hàng không vượt quá tổng số tiền thực tế quý khách đã thanh toán cho đơn hàng đó.
- Địa chỉ tiếp nhận hàng hoàn trả của cửa hàng: **{{return_address}}**. Ngay sau khi nhận lại sản phẩm hoàn trả và kiểm tra hợp lệ, cửa hàng sẽ thực hiện hoàn tiền cho quý khách **trong thời gian sớm nhất**.
- Mọi thắc mắc cần hỗ trợ về đổi trả, quý khách vui lòng liên hệ trực tiếp **{{store_name}}** {{store_contact_channels}}.`,
  },
  {
    slug: 'shipping',
    type: 'shipping',
    title: 'Chính sách vận chuyển & giao nhận toàn quốc',
    displayOrder: 2,
    content: `## 1. Biểu phí vận chuyển tự động
Hệ thống **{{store_name}}** tính phí vận chuyển tự động dựa trên tổng tiền hàng sau khuyến mãi sản phẩm:

- **Giao hàng Tiêu chuẩn**: Phí vận chuyển là **{{shipping_fee_standard}}** cho đơn hàng có giá trị tạm tính dưới **{{free_shipping_threshold}}**.
- **Ưu đãi Miễn phí vận chuyển**: **Miễn phí 100% phí vận chuyển tiêu chuẩn (0₫)** cho mọi đơn hàng có tổng giá trị sản phẩm sau khuyến mãi đạt từ **{{free_shipping_threshold}}** trở lên (hoặc khi áp dụng mã miễn phí vận chuyển hợp lệ).
- **Giao hàng Hỏa tốc**: Phí vận chuyển cố định là **{{shipping_fee_express}}**, ưu tiên xử lý xuất kho sớm.

## 2. Tiến trình xử lý & Theo dõi hành trình đơn hàng
- Ngay sau khi đơn hàng được xác nhận, bộ phận kho vận của **{{store_name}}** sẽ đóng gói và bàn giao kiện hàng cho đơn vị vận chuyển để giao tới địa chỉ của quý khách **trong thời gian sớm nhất**.
- Mọi thay đổi trạng thái đơn hàng từ **Chờ xác nhận**, **Đã xác nhận**, **Đang chuẩn bị hàng**, **Đang giao hàng** (kèm mã vận đơn) đến **Đã giao hàng** đều được cập nhật chi tiết trong mục **Đơn hàng của tôi**.
- Sau **{{return_window_days}} ngày** kể từ thời điểm giao hàng thành công mà không phát sinh yêu cầu đổi trả, đơn hàng sẽ tự động chuyển sang trạng thái **Hoàn tất**.`,
  },
  {
    slug: 'payment',
    type: 'payment',
    title: 'Chính sách thanh toán & an toàn giao dịch',
    displayOrder: 3,
    content: `## 1. Các phương thức thanh toán được hỗ trợ
Tại **{{store_name}}**, quý khách có thể lựa chọn 04 phương thức thanh toán khi đặt hàng:

1. **Thanh toán tiền mặt khi nhận hàng (COD)**: Quý khách kiểm tra kiện hàng và thanh toán trực tiếp cho nhân viên giao vận. Đơn hàng COD không bị áp dụng thời hạn tự hủy **{{payment_timeout_minutes}} phút**.
2. **Chuyển khoản nhanh bằng mã VietQR (Napas 247)**: Hệ thống tự động tạo mã QR theo tài khoản thụ hưởng tại **{{vietqr_bank_name}}** kèm đúng số tiền cần thanh toán và nội dung chuyển khoản chứa mã đơn hàng **BAITY-XXXX**.
3. **Ví điện tử (MoMo / ZaloPay / VNPay)**: Hiện đang ở **chế độ thử nghiệm, chưa thu tiền thật** (phục vụ kiểm thử luồng đặt hàng).
4. **Thẻ quốc tế (Visa / Mastercard)**: Hiện đang ở **chế độ thử nghiệm, chưa thu tiền thật**; **cửa hàng tuyệt đối không thu thập, không xử lý và không lưu trữ số thẻ, ngày hết hạn hay mã bảo mật CVV của quý khách**.

## 2. Thời hạn giữ đơn chờ thanh toán & Xử lý giao dịch
- **Thời hạn giữ hàng cho đơn thanh toán trực tuyến**: Các đơn hàng chọn phương thức trực tuyến (**VietQR**, **Ví điện tử**, **Thẻ**) được giữ sản phẩm và giữ lượt dùng mã giảm giá trong vòng **{{payment_timeout_minutes}} phút** kể từ lúc đặt hàng.
- **Tự động hủy đơn quá hạn**: Nếu quá **{{payment_timeout_minutes}} phút** mà giao dịch chưa hoàn tất, hệ thống tự động hủy đơn hàng, đồng thời **hoàn lại tồn kho** và **hoàn lại lượt dùng mã giảm giá**.
- **Giới hạn đơn chờ thanh toán**: Mỗi tài khoản được giữ tối đa **{{max_pending_online_orders}} đơn chờ thanh toán trực tuyến** cùng lúc để đảm bảo sản phẩm luôn sẵn sàng cho khách mua thực tế.
- **Chuyển khoản muộn sau khi đơn đã quá hạn tự hủy**: Nếu khoản thanh toán chuyển về sau khi đơn hàng đã bị hủy do quá hạn, hệ thống tự động ghi nhận giao dịch ở trạng thái **Cần hoàn tiền** để bộ phận chăm sóc khách hàng đối soát và hoàn trả tiền cho quý khách **trong thời gian sớm nhất**.
- **Chuyển khoản lệch số tiền so với đơn hàng**: Nếu số tiền chuyển khoản không khớp với tổng tiền cần thanh toán của đơn hàng, hệ thống sẽ từ chối xác nhận tự động, giữ đơn ở trạng thái chờ thanh toán và lưu nhật ký đối soát thanh toán; quý khách vui lòng liên hệ trực tiếp **{{store_name}}** {{store_contact_channels}} để được đối soát và hoàn tiền **trong thời gian sớm nhất**.`,
  },
  {
    slug: 'privacy',
    type: 'privacy',
    title: 'Chính sách bảo mật thông tin & quyền riêng tư',
    displayOrder: 4,
    content: `## 1. Dữ liệu thu thập và mục đích sử dụng
**{{store_name}}** chỉ thu thập các thông tin thực sự cần thiết để phục vụ quá trình mua sắm và hỗ trợ khách hàng:

- **Thông tin tài khoản và giao nhận**: Họ tên, địa chỉ email, số điện thoại và địa chỉ giao hàng dùng để xác nhận đơn hàng, giao nhận và hỗ trợ đổi trả, hoàn tiền.
- **Số đo cơ thể (tùy chọn)**: Chiều cao (100 – 230cm) và cân nặng (30 – 200kg) do quý khách chủ động cung cấp chỉ dùng để tính toán gợi ý kích cỡ trang phục phù hợp.
- **Lịch sử đơn hàng, hình ảnh đánh giá và ảnh minh chứng đổi trả**: Lưu trữ lịch sử mua sắm để phục vụ tra cứu bảo hành/đổi trả, hiển thị đánh giá sản phẩm đã mua và đối soát yêu cầu hoàn tiền.
- **Bảo vệ tài khoản**: Mật khẩu của quý khách được mã hóa bảo mật một chiều; khi quý khách đổi hoặc đặt lại mật khẩu mới, các phiên đăng nhập trước đó sẽ tự động kết thúc để bảo vệ tài khoản.

## 2. Quyền riêng tư đối với hình ảnh tải lên và Cookie
- **Xử lý hình ảnh tải lên**: Mọi ảnh tải lên (ảnh đại diện, ảnh đánh giá sản phẩm, ảnh minh chứng đổi trả, tối đa **{{max_upload_size_mb}}MB**/ảnh) đều được xử lý tự động để **xóa thông tin vị trí và thông tin thiết bị chụp** nhằm bảo vệ quyền riêng tư của quý khách.
- **Hiển thị đánh giá và lưu trữ ảnh đổi trả**: Trên trang sản phẩm, tên người đánh giá được rút gọn để bảo vệ thông tin cá nhân. Ảnh minh chứng đổi trả được lưu trữ trong kho lưu trữ riêng tư (chỉ tạo đường dẫn xem tạm thời có thời hạn **{{signed_url_expires_minutes}} phút**) và chỉ phục vụ chủ đơn hàng cùng bộ phận xử lý đổi trả của cửa hàng.
- **Sử dụng Cookie**: Chúng tôi dùng cookie để giữ trạng thái đăng nhập và lưu giỏ hàng của quý khách (giỏ hàng khi chưa đăng nhập sẽ tự động gộp vào tài khoản khi quý khách đăng nhập). Chúng tôi không bán hoặc chia sẻ dữ liệu cá nhân của quý khách cho bên thứ ba vì mục đích quảng cáo.

## 3. Các bên xử lý kỹ thuật, Trợ lý tư vấn AI, Tìm kiếm bằng hình ảnh AI & Chat với người bán
Để vận hành hệ thống thương mại điện tử ổn định và an toàn, một số tác vụ kỹ thuật được thực hiện thông qua các dịch vụ hạ tầng chuyên dụng:

- **Nhà cung cấp cơ sở dữ liệu và lưu trữ đám mây (Supabase PostgreSQL & Supabase Storage)**: Lưu trữ dữ liệu tài khoản, đơn hàng và các tệp hình ảnh tải lên theo phân quyền bảo mật.
- **Dịch vụ tạo mã QR thanh toán (VietQR — img.vietqr.io)**: Khi quý khách chọn thanh toán chuyển khoản ngân hàng, hệ thống tạo ảnh mã QR thông qua dịch vụ VietQR chỉ chứa thông tin tài khoản nhận của cửa hàng, số tiền đơn hàng và mã đơn **BAITY-XXXX** (không gửi tên, số điện thoại hay địa chỉ của quý khách).
- **Nhà cung cấp mô hình trí tuệ nhân tạo (Google Gemini) — Trợ lý tư vấn trực tuyến**: **Baity không lưu nội dung cuộc trò chuyện trong hệ thống cơ sở dữ liệu của cửa hàng** (lịch sử tin nhắn chỉ giữ tạm trên trình duyệt của quý khách trong lúc mở trang); khi quý khách sử dụng **Trợ lý tư vấn trực tuyến**, nội dung câu hỏi và tối đa 10 tin nhắn gần nhất trong phiên trò chuyện được gửi tới **Google Gemini** và **do Google xử lý theo chính sách của Google** để sinh câu trả lời tư vấn tự động về sản phẩm, kích cỡ, chính sách và đơn hàng của chính quý khách.
- **Tìm kiếm sản phẩm bằng hình ảnh AI**: Khi quý khách tải ảnh lên tính năng **Tìm kiếm bằng hình ảnh**, ảnh được xử lý trên bộ nhớ tạm (thu nhỏ kích thước, xóa dữ liệu EXIF) để nhận diện thuộc tính trang phục (loại trang phục, màu sắc, phong cách, họa tiết, phom dáng). **Baity không lưu ảnh trong hệ thống của cửa hàng; ảnh được gửi tới Google Gemini và do Google xử lý theo chính sách của Google; quý khách không nên tải ảnh có khuôn mặt hoặc thông tin cá nhân.** Nhật ký tìm kiếm ẩn danh của cửa hàng chỉ lưu các thuộc tính chuẩn hóa và chỉ số kỹ thuật (độ tin cậy ` + '`confidence`' + ` dạng số, số lượng kết quả, độ trễ, trạng thái thành công và mã định danh băm một chiều HMAC-SHA256; không chứa ảnh và không chứa văn bản tự do) tối đa **{{visual_search_log_retention_days}} ngày** trước khi tự động xóa.
- **Chat với người bán (Hỏi đáp trực tiếp với chủ cửa hàng)**: Khác với Trợ lý tư vấn AI, khi quý khách đã đăng nhập và sử dụng tính năng **Chat với người bán**, **nội dung tin nhắn KHÔNG bao giờ được gửi tới Google Gemini và không ghi vào nhật ký hệ thống (logs)**. Nội dung chat với người bán được **lưu trong cơ sở dữ liệu của cửa hàng**, **chủ cửa hàng xem được** để phản hồi hỗ trợ quý khách. Các hội thoại đã đóng được **lưu tối đa {{seller_chat_retention_days}} ngày sau khi đóng rồi hệ thống tự động xóa**, hoặc được xóa sớm theo yêu cầu của quý khách thông qua liên hệ của cửa hàng; khi xóa tài khoản khách hàng thì toàn bộ hội thoại của quý khách cũng được xóa tự động.
- **Khuyến cáo bảo mật khi trò chuyện**: Để bảo vệ an toàn thông tin cá nhân, quý khách **không nên nhập mật khẩu, mã xác thực OTP, số thẻ ngân hàng/thẻ tín dụng, số Căn cước công dân (CCCD) hoặc thông tin cá nhân nhạy cảm** vào khung trò chuyện (cả Trợ lý tư vấn AI lẫn Chat với người bán).
- **Không lưu nội dung trò chuyện AI & Lưu bộ đếm giới hạn tối đa {{chatbot_counter_retention_days}} ngày**: **Baity không lưu nội dung hội thoại với Trợ lý tư vấn AI trong hệ thống cơ sở dữ liệu của cửa hàng** (tin nhắn được gửi tới **Google Gemini** và do Google xử lý theo chính sách của Google). Để chống lạm dụng và bảo vệ chi phí vận hành, hệ thống cửa hàng chỉ lưu **bộ đếm số lượt gọi trợ lý** gắn với mã người dùng hoặc mã băm ẩn danh một chiều của địa chỉ kết nối (HMAC-SHA256, không lưu địa chỉ IP thô và không lưu nội dung tin nhắn), và tự động xóa các bản ghi bộ đếm cũ sau tối đa **{{chatbot_counter_retention_days}} ngày**.

## 4. Cách yêu cầu chỉnh sửa hoặc xóa thông tin cá nhân
- Quý khách có thể chủ động xem và chỉnh sửa họ tên, số điện thoại, số đo chiều cao/cân nặng và sổ địa chỉ bất cứ lúc nào trong mục **Tài khoản cá nhân**.
- Nếu quý khách cần hỗ trợ chỉnh sửa thông tin đơn hàng, xóa lịch sử chat với người bán hoặc yêu cầu xóa thông tin cá nhân khỏi hệ thống, vui lòng liên hệ trực tiếp với **{{store_name}}** {{store_contact_channels}} để được tiếp nhận và xử lý **trong thời gian sớm nhất**.`,
  },

  // ==========================================
  // 12 CÂU HỎI THƯỜNG GẶP (FAQ) THEO 5 CHỦ ĐỀ
  // ==========================================
  {
    slug: 'faq-size-guide',
    type: 'faq',
    title: 'Làm thế nào để chọn đúng kích cỡ (size) quần áo tại {{store_name}}?',
    displayOrder: 10,
    content: `[Chủ đề: Chọn kích cỡ & Sản phẩm]
Tại trang chi tiết mỗi sản phẩm, bạn có thể bấm vào mục **Gợi ý size theo chiều cao & cân nặng** và nhập chiều cao (từ **100cm đến 230cm**) cùng cân nặng (từ **30kg đến 200kg**). Hệ thống sẽ tự động đối chiếu với bảng thông số chuẩn riêng cho **Nam**, **Nữ**, **Unisex** hoặc **Quần (size 28 – 34)** để đề xuất kích cỡ vừa vặn nhất trong các size hiện có của sản phẩm.`,
  },
  {
    slug: 'faq-unisex-fit',
    type: 'faq',
    title: 'Trang phục Unisex tại {{store_name}} có phom dáng như thế nào?',
    displayOrder: 11,
    content: `[Chủ đề: Chọn kích cỡ & Sản phẩm]
Các thiết kế **Unisex** của **{{store_name}}** sử dụng phom rộng thoải mái (**Relaxed / Oversized Fit**), phù hợp cho cả Nam và Nữ. Khi lọc danh mục theo **Nam** hoặc **Nữ**, hệ thống mặc định hiển thị kèm các mẫu Unisex để bạn có thêm lựa chọn phối đồ (bạn có thể tắt tùy chọn gộp Unisex trên bộ lọc bất cứ lúc nào).`,
  },
  {
    slug: 'faq-ai-features',
    type: 'faq',
    title: 'Tính năng Tìm kiếm bằng hình ảnh AI, Trợ lý tư vấn trực tuyến và Chat với người bán hoạt động như thế nào?',
    displayOrder: 12,
    content: `[Chủ đề: Chọn kích cỡ & Sản phẩm]
**Trợ lý tư vấn trực tuyến** tại góc phải màn hình luôn sẵn sàng hỗ trợ bạn tìm kiếm sản phẩm trong kho, tư vấn kích cỡ, giải đáp chính sách đổi trả/vận chuyển/thanh toán và tra cứu trạng thái đơn hàng của chính bạn khi đã đăng nhập. **Baity không lưu nội dung cuộc trò chuyện trong hệ thống của cửa hàng; câu hỏi và ngữ cảnh trò chuyện gần nhất được gửi tới Google Gemini và do Google xử lý theo chính sách của Google; khách hàng không nên nhập mật khẩu, mã OTP, số thẻ ngân hàng, số CCCD hoặc thông tin cá nhân nhạy cảm vào khung trò chuyện.** Ngoài ra, khi đã đăng nhập, bạn có thể chuyển sang mục **Chat với người bán** ngay trong hộp chat để nhắn tin hỏi đáp trực tiếp với cửa hàng: **nội dung chat với người bán KHÔNG bao giờ được gửi sang Google Gemini, được lưu trong cơ sở dữ liệu cửa hàng để chủ cửa hàng xem và phản hồi, lưu tối đa {{seller_chat_retention_days}} ngày sau khi đóng hội thoại rồi tự động xóa (hoặc xóa sớm theo yêu cầu qua liên hệ của cửa hàng; xóa tài khoản khách hàng sẽ xóa toàn bộ hội thoại), và bạn tuyệt đối không nhập mật khẩu, mã OTP, số thẻ ngân hàng hay số CCCD vào hộp chat.** Với tính năng **[Tìm kiếm trang phục bằng hình ảnh AI](/visual-search)**, bạn có thể chọn hoặc chụp một bức ảnh trang phục (JPG, PNG, WEBP tối đa **{{max_upload_size_mb}}MB**): ảnh được xử lý trên bộ nhớ tạm (thu nhỏ kích thước, xóa dữ liệu EXIF) để phân tích thuộc tính trang phục (loại sản phẩm, màu sắc, phong cách, họa tiết, phom dáng) nhằm gợi ý các sản phẩm tương đồng còn hàng trong kho và cho phép chỉnh sửa lại các thẻ thuộc tính để lọc lại ngay mà không cần tải lại ảnh. **Baity không lưu ảnh trong hệ thống của cửa hàng; ảnh được gửi tới Google Gemini và do Google xử lý theo chính sách của Google; khách hàng không nên tải ảnh có khuôn mặt hoặc thông tin cá nhân.** Nhật ký tìm kiếm của cửa hàng chỉ lưu các thuộc tính nhận diện và số liệu kỹ thuật (độ tin cậy \`confidence\` dạng số, số lượng kết quả, độ trễ, trạng thái thành công) không có ảnh và không có văn bản tự do trong tối đa **{{visual_search_log_retention_days}} ngày** với mã định danh băm một chiều (HMAC-SHA256).`,
  },
  {
    slug: 'faq-shipping-fee',
    type: 'faq',
    title: 'Phí vận chuyển được tính như thế nào và khi nào được miễn phí giao hàng?',
    displayOrder: 20,
    content: `[Chủ đề: Vận chuyển & Theo dõi đơn hàng]
Phí vận chuyển tiêu chuẩn là **{{shipping_fee_standard}}** và được **miễn phí hoàn toàn (0₫)** khi tổng giá trị sản phẩm sau khuyến mãi đạt từ **{{free_shipping_threshold}}** trở lên. Nếu bạn chọn giao hàng hỏa tốc, phí vận chuyển là **{{shipping_fee_express}}**. Xem chi tiết tại [Chính sách vận chuyển](/policies/shipping).`,
  },
  {
    slug: 'faq-order-tracking',
    type: 'faq',
    title: 'Làm sao để theo dõi trạng thái đơn hàng sau khi đặt mua?',
    displayOrder: 21,
    content: `[Chủ đề: Vận chuyển & Theo dõi đơn hàng]
Sau khi đăng nhập, bạn mở mục **Đơn hàng của tôi** để xem toàn bộ lịch sử đơn hàng, mã vận đơn và tiến trình xử lý đơn hàng từ **Chờ xác nhận**, **Đã xác nhận**, **Đang chuẩn bị hàng**, **Đang giao hàng**, **Đã giao hàng** đến **Hoàn tất**.`,
  },
  {
    slug: 'faq-vietqr-timeout',
    type: 'faq',
    title: 'Đơn hàng thanh toán qua VietQR có thời hạn giữ đơn trong bao lâu?',
    displayOrder: 30,
    content: `[Chủ đề: Thanh toán & VietQR]
Đơn hàng chọn phương thức chuyển khoản **VietQR** có thời hạn thanh toán là **{{payment_timeout_minutes}} phút** kể từ thời điểm đặt hàng. Quá **{{payment_timeout_minutes}} phút** nếu chưa nhận được thanh toán, hệ thống tự động hủy đơn, hoàn lại tồn kho và hoàn lại lượt dùng mã giảm giá. Nếu bạn chuyển khoản muộn sau khi đơn đã hủy, giao dịch được ghi nhận ở trạng thái **Cần hoàn tiền** để cửa hàng đối soát và hoàn tiền cho bạn **trong thời gian sớm nhất**. Trường hợp bạn chuyển khoản nhầm số tiền, đơn hàng vẫn ở trạng thái chờ và bạn vui lòng liên hệ cửa hàng {{store_contact_channels}} để được đối soát và hoàn tiền **trong thời gian sớm nhất**.`,
  },
  {
    slug: 'faq-pending-order-limit',
    type: 'faq',
    title: 'Vì sao tôi nhận được thông báo giới hạn số đơn chờ thanh toán trực tuyến?',
    displayOrder: 31,
    content: `[Chủ đề: Thanh toán & VietQR]
Để đảm bảo hàng hóa luôn sẵn sàng cho khách mua thực tế, mỗi tài khoản chỉ được giữ tối đa **{{max_pending_online_orders}} đơn hàng chờ thanh toán trực tuyến** (VietQR, Ví điện tử, Thẻ) cùng lúc. Bạn chỉ cần hoàn tất thanh toán hoặc hủy bớt đơn chờ hiện tại để đặt đơn mới.`,
  },
  {
    slug: 'faq-voucher-usage',
    type: 'faq',
    title: 'Cách áp dụng mã giảm giá (Voucher) và điều kiện hoàn lại Voucher khi hủy đơn?',
    displayOrder: 40,
    content: `[Chủ đề: Mã giảm giá (Voucher) & Giỏ hàng]
Bạn có thể chọn hoặc nhập mã giảm giá tại bước Thanh toán. Hệ thống kiểm tra giá trị đơn tối thiểu dựa trên **tổng tiền hàng sau khuyến mãi sản phẩm**. Khi đơn hàng bị hủy hợp lệ hoặc hết hạn chờ thanh toán **{{payment_timeout_minutes}} phút**, lượt sử dụng mã giảm giá sẽ được tự động hoàn trả lại cho bạn.`,
  },
  {
    slug: 'faq-guest-cart-limits',
    type: 'faq',
    title: 'Giỏ hàng cho phép đặt tối đa bao nhiêu sản phẩm và có lưu khi chưa đăng nhập không?',
    displayOrder: 41,
    content: `[Chủ đề: Mã giảm giá (Voucher) & Giỏ hàng]
Khách hàng chưa đăng nhập vẫn có thể thêm sản phẩm vào giỏ hàng (chúng tôi dùng cookie để lưu giỏ hàng của bạn). Mỗi biến thể sản phẩm được đặt từ **1 đến {{cart_max_qty_per_item}} chiếc** và mỗi giỏ hàng chứa tối đa **{{cart_max_distinct_items}} dòng sản phẩm** khác nhau. Ngay khi bạn đăng nhập, giỏ hàng sẽ tự động gộp vào tài khoản của bạn.`,
  },
  {
    slug: 'faq-cancel-order',
    type: 'faq',
    title: 'Tôi có thể tự hủy đơn hàng ở những trạng thái nào?',
    displayOrder: 50,
    content: `[Chủ đề: Hủy đơn, Đổi trả & Đánh giá sản phẩm]
Bạn có thể chủ động hủy đơn hàng (kèm nhập lý do hủy) khi đơn đang ở một trong ba trạng thái chưa bàn giao vận chuyển: **Chờ xác nhận**, **Đã xác nhận** hoặc **Đang chuẩn bị hàng**. Khi đơn đã chuyển sang **Đang giao hàng**, tính năng tự hủy sẽ khóa lại. Nếu đơn đã thanh toán trước mà được hủy hợp lệ, hệ thống tự động tạo yêu cầu hoàn tiền cho bạn.`,
  },
  {
    slug: 'faq-return-policy',
    type: 'faq',
    title: 'Điều kiện đổi trả trong {{return_window_days}} ngày và phí vận chuyển đổi trả được tính ra sao?',
    displayOrder: 51,
    content: `[Chủ đề: Hủy đơn, Đổi trả & Đánh giá sản phẩm]
Trong vòng **{{return_window_days}} ngày** kể từ khi đơn hàng chuyển sang trạng thái **Đã giao hàng**, bạn có thể gửi yêu cầu đổi size/màu hoặc hoàn tiền kèm tối đa **{{max_return_proof_images}} ảnh minh chứng**. Mặc định phí vận chuyển ban đầu không được hoàn lại, trừ trường hợp lỗi thuộc về cửa hàng (hàng lỗi hoặc giao sai mẫu/size) và được cửa hàng xác nhận khi duyệt yêu cầu. Xem chi tiết tại [Chính sách đổi trả](/policies/return).`,
  },
  {
    slug: 'faq-review-privacy',
    type: 'faq',
    title: 'Ai có quyền viết đánh giá sản phẩm và ảnh đánh giá có an toàn riêng tư không?',
    displayOrder: 52,
    content: `[Chủ đề: Hủy đơn, Đổi trả & Đánh giá sản phẩm]
Chỉ những khách hàng **đã mua sản phẩm đó trong đơn hàng ở trạng thái Đã giao hoặc Hoàn tất** mới có quyền gửi đánh giá (tối đa 01 đánh giá cho mỗi sản phẩm trên từng đơn hàng, đính kèm tối đa **{{max_review_images}} ảnh**). Ảnh tải lên được xử lý tự động để xóa thông tin vị trí chụp, tên người đánh giá được hiển thị rút gọn, và bạn có thể chỉnh sửa hoặc xóa đánh giá của chính mình bất cứ lúc nào.`,
  },
];

export interface ParsedFaqItem {
  slug: string;
  question: string;
  title: string;
  answer: string;
  content: string;
  topic: string;
  displayOrder: number;
}

export function extractFaqTopicAndAnswer(
  rawContent: string,
  vars: Record<string, string>
): { topic: string; answer: string } {
  const interpolated = interpolatePolicyContent(rawContent, vars);
  const topicMatch = interpolated.match(/^\[Chủ đề:\s*([^\]]+)\]\s*\r?\n?([\s\S]*)$/i);
  if (topicMatch) {
    return {
      topic: stripRawHtmlFromMarkdown(topicMatch[1].trim()) || 'Câu hỏi chung',
      answer: topicMatch[2].trim(),
    };
  }
  return {
    topic: 'Câu hỏi chung',
    answer: interpolated.trim(),
  };
}

/**
 * Đảm bảo bảng faq_policies luôn có đầy đủ 4 chính sách nền tảng (return, shipping, payment, privacy)
 * và 12 câu hỏi FAQ theo đúng cột `slug`.
 * - Không phụ thuộc ENABLE_SEED_DEMO_DATA (luôn chạy trên cả production và dev).
 * - Chỉ chèn mới khi `slug` chưa tồn tại (ON CONFLICT (slug) DO NOTHING), TUYỆT ĐỐI KHÔNG UPDATE bản ghi đã có slug.
 * - Với các bản ghi cũ chưa có `slug` (slug IS NULL từ trước migration 0008), chỉ gán `slug` cho bản ghi đó.
 */
export async function ensurePoliciesAndFaqSeeded(
  runQuery: <R = any>(q: any) => Promise<R[]> = queryRows
): Promise<void> {
  // Xóa câu hỏi FAQ mẫu đơn lẻ thời kỳ đầu nếu chưa có slug
  await runQuery(sql`
    DELETE FROM faq_policies
    WHERE slug IS NULL
      AND type = 'faq'
      AND title = 'Làm thế nào để chọn đúng size trang phục?';
  `);

  const existingRows = await runQuery<{
    id: string;
    slug: string | null;
    type: string;
    display_order: number;
  }>(sql`
    SELECT id, slug, type, display_order
    FROM faq_policies
    ORDER BY display_order ASC;
  `);

  const existingSlugs = new Set<string>(
    existingRows.map((r) => (r.slug ? r.slug.trim() : '')).filter(Boolean)
  );

  for (const seedItem of SEED_POLICIES_AND_FAQ_ITEMS) {
    if (existingSlugs.has(seedItem.slug)) {
      continue;
    }

    // Kiểm tra xem có dòng cũ trước migration 0008 (slug IS NULL) khớp theo type/display_order không
    const legacyMatch = existingRows.find(
      (r) =>
        !r.slug &&
        r.type === seedItem.type &&
        (seedItem.type !== 'faq' || r.display_order === seedItem.displayOrder)
    );

    if (legacyMatch) {
      await runQuery(sql`
        UPDATE faq_policies
        SET slug = ${seedItem.slug}
        WHERE id = ${legacyMatch.id}::uuid AND slug IS NULL;
      `);
      existingSlugs.add(seedItem.slug);
    } else {
      await runQuery(sql`
        INSERT INTO faq_policies (slug, type, title, content, display_order)
        VALUES (${seedItem.slug}, ${seedItem.type}, ${seedItem.title}, ${seedItem.content}, ${seedItem.displayOrder})
        ON CONFLICT (slug) DO NOTHING;
      `);
      existingSlugs.add(seedItem.slug);
    }
  }
}

export { parseSafeMarkdownBlocks, stripRawHtmlFromMarkdown };

