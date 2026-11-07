export const EMAIL_TIMEOUT_MS = 8000;

export type EmailProviderType = 'log' | 'brevo' | 'resend';

export interface OrderEmailData {
  orderId: string;
  customerName: string;
  email: string;
  totalAmount: number;
  items: Array<{
    name: string;
    variant: string;
    quantity: number;
    price: number;
  }>;
  paymentMethod: string;
}

export type EmailHttpFetch = (
  url: string,
  init: RequestInit
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

let customEmailHttpFetchForTest: EmailHttpFetch | null = null;

export function setEmailHttpFetchForTest(fn: EmailHttpFetch | null): void {
  customEmailHttpFetchForTest = fn;
}

import { isStrictRuntimeMode } from '../config/runtimeMode.ts';

function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return isStrictRuntimeMode(env);
}

export function parseSenderAddress(rawFrom: string): { name: string; email: string; formatted: string } {
  const trimmed = String(rawFrom || '').trim();
  const angleMatch = trimmed.match(/^(.*?)<([^<>@\s]+@[^<>@\s]+)>\s*$/);
  if (angleMatch) {
    const name = angleMatch[1].trim().replace(/^["']|["']$/g, '') || 'Baity Fashion';
    const email = angleMatch[2].trim();
    return { name, email, formatted: `${name} <${email}>` };
  }
  return {
    name: 'Baity Fashion',
    email: trimmed,
    formatted: trimmed ? `Baity Fashion <${trimmed}>` : '',
  };
}

/**
 * Che giấu giá trị token thô trên URL khôi phục mật khẩu trước khi ghi ra console log (chỉ dùng ở Dev/Test)
 */
export function maskResetUrlForLog(resetUrl: string): string {
  return String(resetUrl || '').replace(/([?&]token=)[^&#\s]+/gi, '$1***REDACTED***');
}

/**
 * Gửi email xác nhận đặt hàng (chỉ ghi console log ở môi trường dev khi bật ENABLE_DEMO_EMAIL_LOG=true)
 */
export async function sendOrderConfirmationEmail(data: OrderEmailData): Promise<boolean> {
  if (!isProductionEnv() && process.env.ENABLE_DEMO_EMAIL_LOG === 'true') {
    console.log('====================================================');
    console.log(`✉️ [EMAIL SERVICE] GỬI EMAIL XÁC NHẬN ĐƠN HÀNG: ${data.orderId}`);
    console.log(`Phương thức thanh toán: ${data.paymentMethod}`);
    console.log(`Tổng thanh toán: ${data.totalAmount.toLocaleString('vi-VN')}₫`);
    console.log('====================================================');
  }
  return true;
}

/**
 * Gửi email đặt lại mật khẩu theo cấu hình EMAIL_PROVIDER ('log' | 'brevo' | 'resend'):
 * - Gọi HTTPS API trực tiếp tới Brevo (https://api.brevo.com/v3/smtp/email) hoặc Resend (https://api.resend.com/emails), không dùng SMTP.
 * - Khóa lấy từ BREVO_API_KEY hoặc RESEND_API_KEY, địa chỉ gửi từ EMAIL_FROM, timeout cứng 8 giây (8000ms).
 * - Ở Production: TUYỆT ĐỐI KHÔNG BAO GIỜ ghi liên kết đặt lại mật khẩu, token hay nội dung email ra console log.
 * - Nếu chưa cấu hình nhà cung cấp ở Production: không ném lỗi ra ngoài (để forgot-password vẫn trả thông báo chung cho khách),
 *   chỉ ghi cảnh báo cấu hình vào log server (không kèm token hay email).
 */
export async function sendPasswordResetEmail(
  recipientEmail: string,
  resetUrl: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const isProd = isProductionEnv(env);
  const rawProvider = String(env.EMAIL_PROVIDER || 'log')
    .trim()
    .toLowerCase();

  // 1. Chế độ 'log' (hoặc chưa cấu hình nhà cung cấp thật)
  if (!rawProvider || rawProvider === 'log') {
    if (isProd) {
      console.warn(
        '[EMAIL CONFIG WARNING] EMAIL_PROVIDER chưa được cấu hình cho môi trường Production (hiện tại: log). Vui lòng đặt EMAIL_PROVIDER=brevo hoặc EMAIL_PROVIDER=resend kèm khóa API và EMAIL_FROM. Bỏ qua gửi email khôi phục mật khẩu.'
      );
      return false;
    }

    if (env.ENABLE_DEMO_EMAIL_LOG === 'true') {
      const safeMaskedUrl = maskResetUrlForLog(resetUrl);
      console.log('====================================================');
      console.log(`🔑 [EMAIL DEMO] GỬI EMAIL ĐẶT LẠI MẬT KHẨU CHO: ${recipientEmail}`);
      console.log(`Liên kết xác thực (đã ẩn token): ${safeMaskedUrl}`);
      console.log('Hiệu lực trong vòng 15 phút.');
      console.log('====================================================');
    }
    return true;
  }

  if (rawProvider !== 'brevo' && rawProvider !== 'resend') {
    console.warn(
      `[EMAIL CONFIG WARNING] Giá trị EMAIL_PROVIDER="${rawProvider}" không hợp lệ (chỉ hỗ trợ: log, brevo, resend).`
    );
    return false;
  }

  const emailFromRaw = String(env.EMAIL_FROM || '').trim();
  const sender = parseSenderAddress(emailFromRaw);
  if (!sender.email || !sender.email.includes('@')) {
    console.warn(
      `[EMAIL CONFIG WARNING] Thiếu hoặc sai định dạng biến môi trường EMAIL_FROM khi dùng EMAIL_PROVIDER=${rawProvider}.`
    );
    return false;
  }

  const apiKey =
    rawProvider === 'brevo'
      ? String(env.BREVO_API_KEY || '').trim()
      : String(env.RESEND_API_KEY || '').trim();

  if (!apiKey) {
    const keyVarName = rawProvider === 'brevo' ? 'BREVO_API_KEY' : 'RESEND_API_KEY';
    console.warn(
      `[EMAIL CONFIG WARNING] Thiếu biến môi trường ${keyVarName} khi dùng EMAIL_PROVIDER=${rawProvider}. Bỏ qua gửi email khôi phục mật khẩu.`
    );
    return false;
  }

  const subject = '[Baity Fashion] Hướng dẫn đặt lại mật khẩu tài khoản của bạn';
  const textContent = [
    'Xin chào,',
    '',
    'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản Baity Fashion của bạn.',
    `Vui lòng truy cập liên kết sau để đặt mật khẩu mới (có hiệu lực trong 15 phút): ${resetUrl}`,
    '',
    'Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email này.',
  ].join('\n');

  const htmlContent = [
    '<div style="font-family:sans-serif;color:#1A1C19;line-height:1.6;max-width:560px;margin:0 auto;padding:24px;border:1px solid #E5E0D5;border-radius:12px;">',
    '<h2 style="color:#2D4A3E;margin-top:0;">Đặt lại mật khẩu Baity Fashion</h2>',
    '<p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.</p>',
    '<p>Liên kết đặt lại mật khẩu bên dưới chỉ có hiệu lực trong vòng <strong>15 phút</strong> và chỉ sử dụng được một lần:</p>',
    `<p style="margin:24px 0;"><a href="${resetUrl}" style="background:#2D4A3E;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">Đặt lại mật khẩu ngay</a></p>`,
    '<p style="font-size:12px;color:#5C5F58;">Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này. Tài khoản của bạn vẫn an toàn.</p>',
    '</div>',
  ].join('');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);
  const httpFetch: EmailHttpFetch = customEmailHttpFetchForTest || (fetch as unknown as EmailHttpFetch);

  try {
    let endpoint = '';
    let headers: Record<string, string> = {};
    let payload: Record<string, unknown> = {};

    if (rawProvider === 'brevo') {
      endpoint = 'https://api.brevo.com/v3/smtp/email';
      headers = {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey,
      };
      payload = {
        sender: {
          name: sender.name,
          email: sender.email,
        },
        to: [{ email: recipientEmail }],
        subject,
        htmlContent,
        textContent,
      };
    } else {
      endpoint = 'https://api.resend.com/emails';
      headers = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };
      payload = {
        from: sender.formatted,
        to: [recipientEmail],
        subject,
        html: htmlContent,
        text: textContent,
      };
    }

    const response = await httpFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(
        `[EMAIL SEND ERROR] provider=${rawProvider} status=${response.status}`
      );
      return false;
    }

    return true;
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError' || String(err?.message || '').includes('abort');
    console.error(
      `[EMAIL SEND ERROR] provider=${rawProvider} code=${isAbort ? 'EMAIL_TIMEOUT_8S' : err?.code || err?.name || 'NETWORK_ERROR'}`
    );
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
