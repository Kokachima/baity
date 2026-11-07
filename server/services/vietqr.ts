import crypto from 'crypto';
import { queryRows } from '../db/index.ts';
import { sql } from 'drizzle-orm';

export interface VietQRConfig {
  bankId: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  template: string;
}

export interface VietQRPaymentData {
  bankId: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  amount: number;
  transferContent: string;
  qrImageUrl: string;
  expiresAt: string;
}

export const FALLBACK_STORE_BANK_LABEL = 'tài khoản ngân hàng của cửa hàng';

/**
 * Bảng ánh xạ mã BIN ngân hàng Napas / mã viết tắt VietQR sang tên ngân hàng chính thức
 */
export const VIETQR_BANK_BIN_MAP: Readonly<Record<string, string>> = {
  '970407': 'Ngân hàng TMCP Kỹ Thương Việt Nam (Techcombank)',
  TCB: 'Ngân hàng TMCP Kỹ Thương Việt Nam (Techcombank)',
  TECHCOMBANK: 'Ngân hàng TMCP Kỹ Thương Việt Nam (Techcombank)',
  '970422': 'Ngân hàng TMCP Quân Đội (MBBank)',
  MB: 'Ngân hàng TMCP Quân Đội (MBBank)',
  MBBANK: 'Ngân hàng TMCP Quân Đội (MBBank)',
  '970436': 'Ngân hàng TMCP Ngoại Thương Việt Nam (Vietcombank)',
  VCB: 'Ngân hàng TMCP Ngoại Thương Việt Nam (Vietcombank)',
  VIETCOMBANK: 'Ngân hàng TMCP Ngoại Thương Việt Nam (Vietcombank)',
  '970415': 'Ngân hàng TMCP Công Thương Việt Nam (VietinBank)',
  ICB: 'Ngân hàng TMCP Công Thương Việt Nam (VietinBank)',
  VIETINBANK: 'Ngân hàng TMCP Công Thương Việt Nam (VietinBank)',
  '970418': 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam (BIDV)',
  BIDV: 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam (BIDV)',
  '970405': 'Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam (Agribank)',
  VBA: 'Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam (Agribank)',
  AGRIBANK: 'Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam (Agribank)',
  '970416': 'Ngân hàng TMCP Á Châu (ACB)',
  ACB: 'Ngân hàng TMCP Á Châu (ACB)',
  '970423': 'Ngân hàng TMCP Tiên Phong (TPBank)',
  TPB: 'Ngân hàng TMCP Tiên Phong (TPBank)',
  TPBANK: 'Ngân hàng TMCP Tiên Phong (TPBank)',
  '970432': 'Ngân hàng TMCP Việt Nam Thịnh Vượng (VPBank)',
  VPB: 'Ngân hàng TMCP Việt Nam Thịnh Vượng (VPBank)',
  VPBANK: 'Ngân hàng TMCP Việt Nam Thịnh Vượng (VPBank)',
  '970403': 'Ngân hàng TMCP Sài Gòn Thương Tín (Sacombank)',
  STB: 'Ngân hàng TMCP Sài Gòn Thương Tín (Sacombank)',
  '970437': 'Ngân hàng TMCP Phát triển TP. Hồ Chí Minh (HDBank)',
  HDB: 'Ngân hàng TMCP Phát triển TP. Hồ Chí Minh (HDBank)',
  '970441': 'Ngân hàng TMCP Quốc Tế Việt Nam (VIB)',
  VIB: 'Ngân hàng TMCP Quốc Tế Việt Nam (VIB)',
  '970443': 'Ngân hàng TMCP Sài Gòn - Hà Nội (SHB)',
  SHB: 'Ngân hàng TMCP Sài Gòn - Hà Nội (SHB)',
  '970448': 'Ngân hàng TMCP Phương Đông (OCB)',
  OCB: 'Ngân hàng TMCP Phương Đông (OCB)',
  '970426': 'Ngân hàng TMCP Hàng Hải Việt Nam (MSB)',
  MSB: 'Ngân hàng TMCP Hàng Hải Việt Nam (MSB)',
};

/**
 * Tra cứu tên ngân hàng từ mã BIN / mã ngân hàng (VIETQR_BANK_ID).
 * Nếu không có trong bảng ánh xạ hoặc chưa cấu hình thì trả về "tài khoản ngân hàng của cửa hàng".
 */
export function resolveVietQRBankName(bankId?: string | null): string {
  const key = String(bankId || '').trim().toUpperCase();
  if (!key) {
    return FALLBACK_STORE_BANK_LABEL;
  }
  return VIETQR_BANK_BIN_MAP[key] || FALLBACK_STORE_BANK_LABEL;
}

function getDefaultVietQRConfig(): VietQRConfig {
  const envBankId = (process.env.VIETQR_BANK_ID || '').trim();
  const envAccountNo = (process.env.VIETQR_ACCOUNT_NO || '').trim();
  const envAccountName = (process.env.VIETQR_ACCOUNT_NAME || '').trim();

  return {
    bankId: envBankId || '970407',
    bankName: resolveVietQRBankName(envBankId),
    accountNo: envAccountNo || '0000000000',
    accountName: envAccountName || 'BAITY FASHION',
    template: 'compact2',
  };
}

/**
 * Lấy cấu hình ngân hàng thụ hưởng VietQR từ biến môi trường VIETQR_* và bảng store_settings
 */
export async function getVietQRConfig(): Promise<VietQRConfig> {
  const defaults = getDefaultVietQRConfig();
  const envBankId = (process.env.VIETQR_BANK_ID || '').trim();
  const envAccountNo = (process.env.VIETQR_ACCOUNT_NO || '').trim();
  const envAccountName = (process.env.VIETQR_ACCOUNT_NAME || '').trim();

  try {
    const rows = await queryRows<{ value: any }>(sql`
      SELECT value FROM store_settings WHERE key = 'vietqr_config' LIMIT 1;
    `);
    if (rows.length > 0 && rows[0].value) {
      const val = rows[0].value;
      const effectiveBankId = String(envBankId || val.bankId || '').trim();
      return {
        bankId: effectiveBankId || defaults.bankId,
        bankName: resolveVietQRBankName(effectiveBankId),
        accountNo: envAccountNo || val.accountNo || defaults.accountNo,
        accountName: envAccountName || val.accountName || defaults.accountName,
        template: val.template || defaults.template,
      };
    }
  } catch {
    // Fallback to default config
  }
  return defaults;
}

/**
 * Sinh thông tin thanh toán chuyển khoản Napas 24/7 (VietQR) động cho đơn hàng
 * Hạn thanh toán mặc định: 30 phút kể từ lúc tạo đơn
 */
export function generateVietQRPayload(params: {
  orderId: string;
  amount: number;
  config?: VietQRConfig;
  createdAt?: Date | string;
}): VietQRPaymentData {
  const cfg = params.config || getDefaultVietQRConfig();
  const amount = Math.max(Math.round(Number(params.amount) || 0), 0);
  const transferContent = params.orderId.trim().toUpperCase();

  const createdDate = params.createdAt ? new Date(params.createdAt) : new Date();
  const expiresAt = new Date(createdDate.getTime() + 30 * 60 * 1000).toISOString();

  const qrImageUrl = `https://img.vietqr.io/image/${encodeURIComponent(cfg.bankId)}-${encodeURIComponent(
    cfg.accountNo
  )}-${encodeURIComponent(cfg.template)}.png?amount=${amount}&addInfo=${encodeURIComponent(
    transferContent
  )}&accountName=${encodeURIComponent(cfg.accountName)}`;

  return {
    bankId: cfg.bankId,
    bankName: cfg.bankName,
    accountNo: cfg.accountNo,
    accountName: cfg.accountName,
    amount,
    transferContent,
    qrImageUrl,
    expiresAt,
  };
}

export const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 phút

/**
 * Đọc khóa bí mật Webhook thanh toán:
 * - Tên biến chính: PAYMENT_WEBHOOK_SECRET
 * - Alias tương thích ngược: WEBHOOK_SECRET (chỉ dùng khi PAYMENT_WEBHOOK_SECRET trống/chưa đặt)
 */
export function resolvePaymentWebhookSecret(explicitSecret?: string): string {
  if (explicitSecret !== undefined && explicitSecret.trim() !== '') {
    return explicitSecret.trim();
  }
  const primary = (process.env.PAYMENT_WEBHOOK_SECRET || '').trim();
  if (primary) {
    return primary;
  }
  return (process.env.WEBHOOK_SECRET || '').trim();
}

/**
 * Tạo chữ ký HMAC-SHA256 chuẩn cho Webhook thanh toán trên chuỗi `${timestamp}.${rawBody}`
 */
export function createWebhookSignature(
  rawBody: string,
  timestamp: string | number,
  secret?: string
): string {
  const signingSecret = resolvePaymentWebhookSecret(secret);
  if (!signingSecret) {
    throw new Error('Thiếu khóa bí mật PAYMENT_WEBHOOK_SECRET (hoặc alias WEBHOOK_SECRET) để ký Webhook');
  }
  return crypto
    .createHmac('sha256', signingSecret)
    .update(`${String(timestamp).trim()}.${rawBody}`, 'utf8')
    .digest('hex');
}

/**
 * Xác thực chữ ký HMAC-SHA256 của Webhook thanh toán VietQR:
 * - Bắt buộc cấu hình biến môi trường PAYMENT_WEBHOOK_SECRET (hỗ trợ alias tương thích ngược WEBHOOK_SECRET), không dùng khóa mặc định cứng.
 * - Bắt buộc có chuỗi rawBody nguyên bản (lưu từ tùy chọn verify của express.json).
 * - Bắt buộc có header x-webhook-timestamp (hoặc x-timestamp) hợp lệ và không lệch quá 5 phút so với thời gian hiện tại (chống Replay Attack).
 * - Tính HMAC-SHA256 trên `${timestamp}.${rawBody}` và so sánh thời gian hằng định bằng crypto.timingSafeEqual.
 */
export function verifyWebhookSignature(
  headers: Record<string, string | string[] | undefined>,
  rawBody?: string | Buffer
): boolean {
  const expectedSecret = resolvePaymentWebhookSecret();

  if (!expectedSecret || expectedSecret.length < 8) {
    return false;
  }

  if (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody)) {
    return false;
  }

  const rawBodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  if (!rawBodyStr) {
    return false;
  }

  const tsHeaderRaw = headers['x-webhook-timestamp'] ?? headers['x-timestamp'];
  const rawTimestamp = (Array.isArray(tsHeaderRaw) ? tsHeaderRaw[0] : tsHeaderRaw || '').trim();
  if (!rawTimestamp) {
    return false;
  }

  let timestampMs = NaN;
  if (/^\d+$/.test(rawTimestamp)) {
    const num = Number(rawTimestamp);
    // Hỗ trợ cả unix timestamp tính bằng giây (10 chữ số) hoặc mili-giây (13 chữ số)
    timestampMs = rawTimestamp.length <= 10 ? num * 1000 : num;
  } else {
    timestampMs = Date.parse(rawTimestamp);
  }

  if (!Number.isFinite(timestampMs)) {
    return false;
  }

  if (Math.abs(Date.now() - timestampMs) > WEBHOOK_TIMESTAMP_TOLERANCE_MS) {
    return false;
  }

  const sigHeaderRaw = headers['x-webhook-signature'] ?? headers['x-sepay-signature'];
  const providedSigRaw = (Array.isArray(sigHeaderRaw) ? sigHeaderRaw[0] : sigHeaderRaw || '')
    .trim()
    .replace(/^sha256=/i, '');

  if (!providedSigRaw || !/^[0-9a-f]{64}$/i.test(providedSigRaw)) {
    return false;
  }

  const signedPayload = `${rawTimestamp}.${rawBodyStr}`;
  const computedHex = crypto
    .createHmac('sha256', expectedSecret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  const bufSig = Buffer.from(providedSigRaw.toLowerCase(), 'utf8');
  const bufComputed = Buffer.from(computedHex.toLowerCase(), 'utf8');

  if (bufSig.length !== bufComputed.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufSig, bufComputed);
}

