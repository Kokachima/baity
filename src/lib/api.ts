import type { ApiErrorDetail } from '../../shared/contracts.ts';

export interface ApiResult<T = any> {
  ok: boolean;
  status: number;
  data: T;
  errorCode?: string;
  errorMessage?: string;
}

export const DB_UNAVAILABLE_UI_MESSAGE = 'Hệ thống đang bận, vui lòng thử lại';

/**
 * Kiểm tra xem phản hồi lỗi có phải là lỗi tạm thời 503 / DB_UNAVAILABLE hay không.
 * Khi gặp lỗi này, giao diện phải hiện "Hệ thống đang bận, vui lòng thử lại" và TUYỆT ĐỐI KHÔNG đăng xuất người dùng hay xóa giỏ hàng.
 */
export function isDbUnavailableError(status?: number, errorCode?: string): boolean {
  return status === 503 || errorCode === 'DB_UNAVAILABLE' || errorCode === 'HTTP_503';
}

/**
 * Tạo thông báo lỗi tiếng Việt rõ ràng theo mã HTTP status khi phản hồi không phải JSON
 * (ví dụ trang HTML 403 do Nginx nội bộ của AI Studio trả về, hoặc lỗi 500/502/503 từ proxy).
 * Tuyệt đối không báo "chưa đăng nhập" chung chung.
 */
export function getHttpStatusDefaultMessage(status: number, fallbackMessage?: string): string {
  if (status === 400) return 'Dữ liệu yêu cầu không hợp lệ (400)';
  if (status === 401) return 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn (401)';
  if (status === 403) return 'Yêu cầu bị chặn (403)';
  if (status === 404) return 'Không tìm thấy tài nguyên yêu cầu (404)';
  if (status === 413) return 'Dữ liệu gửi lên vượt quá giới hạn cho phép (413)';
  if (status === 429) return 'Quá nhiều yêu cầu, vui lòng thử lại sau (429)';
  if (status === 503) return DB_UNAVAILABLE_UI_MESSAGE;
  if (status >= 500) return `Máy chủ lỗi (${status})`;
  return fallbackMessage || `Yêu cầu thất bại (${status})`;
}

/**
 * Trích xuất thông báo lỗi thật từ phản hồi của server theo chuẩn { error: { code, message } }
 * hoặc tạo thông báo chuẩn xác theo HTTP status nếu phản hồi không phải JSON (ví dụ HTML 403/500).
 * Khi API trả 503 hoặc mã lỗi DB_UNAVAILABLE, luôn chuẩn hóa thông báo hiển thị thành "Hệ thống đang bận, vui lòng thử lại".
 */
export function extractApiError(
  payload: any,
  fallbackMessage = 'Đã xảy ra lỗi kết nối máy chủ',
  status?: number
): ApiErrorDetail {
  const rawCode =
    payload && typeof payload === 'object'
      ? String(payload.error?.code || payload.code || '')
      : '';

  if (status === 503 || rawCode === 'DB_UNAVAILABLE') {
    return {
      code: rawCode || 'DB_UNAVAILABLE',
      message: DB_UNAVAILABLE_UI_MESSAGE,
    };
  }

  if (payload && typeof payload === 'object') {
    if (payload.error && typeof payload.error === 'object') {
      return {
        code: String(payload.error.code || payload.code || 'API_ERROR'),
        message: String(payload.error.message || payload.message || fallbackMessage),
      };
    }
    if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
      return {
        code: String(payload.code || 'API_ERROR'),
        message: payload.message,
      };
    }
    if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
      return {
        code: String(payload.code || 'API_ERROR'),
        message: payload.error,
      };
    }
  }
  const resolvedMessage =
    typeof status === 'number' && status >= 400
      ? getHttpStatusDefaultMessage(status, fallbackMessage)
      : fallbackMessage;
  return {
    code: typeof status === 'number' && status >= 400 ? `HTTP_${status}` : 'UNKNOWN_ERROR',
    message: resolvedMessage,
  };
}

/**
 * Helper gọi API dùng chung phía giao diện:
 * - Luôn đính kèm `credentials: 'include'` để gửi/nhận cookie phiên (`baity_token`, `baity_session_id`) kể cả trong cross-site iframe.
 * - Tự động đặt `Content-Type: application/json` khi có body JSON.
 * - Chuẩn hóa đọc JSON và bóc tách chính xác `{ error: { code, message } }`.
 * - Khi nhận 503 DB_UNAVAILABLE, trả về thông báo chuẩn "Hệ thống đang bận, vui lòng thử lại".
 */
export async function apiRequest<T = any>(
  url: string,
  options: RequestInit = {}
): Promise<ApiResult<T>> {
  const headers = new Headers(options.headers || {});
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });

  let payload: any = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
  }

  if (!res.ok || (payload && payload.success === false)) {
    const defaultMsg = getHttpStatusDefaultMessage(res.status);
    const errDetail = extractApiError(payload, defaultMsg, res.status);
    return {
      ok: false,
      status: res.status,
      data: payload as T,
      errorCode: errDetail.code,
      errorMessage: errDetail.message,
    };
  }

  return {
    ok: true,
    status: res.status,
    data: payload as T,
  };
}


