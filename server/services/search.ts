import { normalizeVietnameseText } from '../db/seed.ts';

export { normalizeVietnameseText };

/**
 * Escape các ký tự đại diện đặc biệt của SQL LIKE / ILIKE: \, %, _
 * Đảm bảo từ khóa chứa %, _, \ không bị hiểu nhầm thành wildcard hoặc gây lỗi cú pháp SQL
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/([\\_%])/g, '\\$1');
}

/**
 * Chuẩn hóa chuỗi tiếng Việt không dấu nhưng GIỮ LẠI các ký tự %, _, \
 * để sau đó escape chính xác trong mệnh đề LIKE ... ESCAPE '\'
 */
export function normalizeForLikeSearch(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9\s%_\-\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PreparedSearchQuery {
  rawTrimmed: string;
  normalizedKeepWildcards: string;
  cleanNormalized: string;
  escapedNormLikePattern: string;
  escapedRawLikePattern: string;
  hasSpecialWildcards: boolean;
  hasDiacritics: boolean;
}

/**
 * Chuẩn bị từ khóa tìm kiếm an toàn cho pg_trgm + LIKE/ILIKE
 */
export function prepareSearchQuery(rawQuery: string): PreparedSearchQuery {
  const rawTrimmed = rawQuery.trim();
  const hasSpecialWildcards = /[%_\\]/.test(rawTrimmed);
  const normalizedKeepWildcards = normalizeForLikeSearch(rawTrimmed);
  const cleanNormalized = normalizeVietnameseText(rawTrimmed);

  const escapedNorm = escapeLikePattern(normalizedKeepWildcards);
  const escapedRaw = escapeLikePattern(rawTrimmed);
  const hasDiacritics = cleanNormalized !== rawTrimmed.toLowerCase();

  return {
    rawTrimmed,
    normalizedKeepWildcards,
    cleanNormalized,
    escapedNormLikePattern: `%${escapedNorm}%`,
    escapedRawLikePattern: `%${escapedRaw}%`,
    hasSpecialWildcards,
    hasDiacritics,
  };
}

// ==========================================
// RATE LIMITER CHO GET /api/products/suggest
// ==========================================
interface SuggestRateEntry {
  count: number;
  windowStart: number;
}

const SUGGEST_WINDOW_MS = 60 * 1000; // 1 phút
const SUGGEST_MAX_REQUESTS = 30; // Tối đa 30 lượt gợi ý / phút / IP
const suggestRateMap = new Map<string, SuggestRateEntry>();

export function checkSuggestRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const key = ip || 'unknown';
  const entry = suggestRateMap.get(key);

  if (!entry || now - entry.windowStart >= SUGGEST_WINDOW_MS) {
    suggestRateMap.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: SUGGEST_MAX_REQUESTS - 1, retryAfterSeconds: 0 };
  }

  if (entry.count >= SUGGEST_MAX_REQUESTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.windowStart + SUGGEST_WINDOW_MS - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }

  entry.count += 1;
  suggestRateMap.set(key, entry);
  return {
    allowed: true,
    remaining: SUGGEST_MAX_REQUESTS - entry.count,
    retryAfterSeconds: 0,
  };
}

export function resetSuggestRateLimit(ip?: string): void {
  if (ip) {
    suggestRateMap.delete(ip);
  } else {
    suggestRateMap.clear();
  }
}
