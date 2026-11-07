/**
 * Bộ xử lý Markdown giới hạn & làm sạch HTML thô (Safe Restricted Markdown).
 * - Chỉ hỗ trợ: tiêu đề (#, ##, ###), đoạn văn, danh sách (-, *, 1.), in đậm (**...**),
 *   in nghiêng (*...*), mã nội tuyến (`...`), và liên kết [text](url).
 * - Loại bỏ / vô hiệu hóa hoàn toàn mọi thẻ HTML thô (<script>, <iframe>, <img onerror=...>, <svg>, <style>, v.v.).
 * - Chặn mọi liên kết có giao thức nguy hiểm (javascript:, data:, vbscript:).
 * - Đánh dấu rõ liên kết ngoài (http://, https://) để mở kèm rel="noopener noreferrer" target="_blank".
 */

export interface SafeInlineToken {
  type: 'text' | 'bold' | 'code' | 'link';
  text: string;
  href?: string;
  isExternal?: boolean;
}

export interface SafeMarkdownBlock {
  type: 'heading' | 'paragraph' | 'unordered-list' | 'ordered-list';
  level?: 1 | 2 | 3;
  tokens?: SafeInlineToken[];
  items?: SafeInlineToken[][];
}

/**
 * Loại bỏ hoàn toàn các thẻ HTML nguy hiểm có nội dung (<script>...</script>, <style>...</style>, <iframe>...</iframe>, <object>...</object>)
 * và xóa tất cả các thẻ HTML thô còn lại (<tag ...>) khỏi chuỗi văn bản để đảm bảo không bao giờ thực thi HTML thô.
 */
export function stripRawHtmlFromMarkdown(input: string): string {
  if (!input || typeof input !== 'string') return '';
  return input
    // Xóa toàn bộ khối thẻ thực thi nguy hiểm cùng nội dung bên trong
    .replace(/<\s*(script|style|iframe|object|embed|applet|meta|link)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    // Xóa các thẻ tự đóng hoặc mở lẻ của nhóm nguy hiểm
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|applet|meta|link)\b[^>]*\/?>/gi, '')
    // Xóa mọi thẻ HTML thô khác (ví dụ <div>, <span>, <img onerror=...>, <svg onload=...>, <a href=...>)
    .replace(/<\/?[a-zA-Z][a-zA-Z0-9:-]*(?:\s+[^<>]*)?>/g, '');
}

/**
 * Kiểm tra và chuẩn hóa URL an toàn cho liên kết Markdown.
 * Chỉ chấp nhận đường dẫn nội bộ (/..., #..., ?...) hoặc http://, https://, mailto:, tel:.
 * Từ chối tuyệt đối javascript:, data:, vbscript:, file:.
 */
export function sanitizeMarkdownUrl(rawUrl: string): {
  safeHref: string | null;
  isExternal: boolean;
} {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { safeHref: null, isExternal: false };
  }
  const trimmed = rawUrl.trim().replace(/[\u0000-\u001F\u007F]/g, '');
  if (!trimmed) {
    return { safeHref: null, isExternal: false };
  }

  // Đường dẫn nội bộ
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return { safeHref: trimmed, isExternal: false };
  }
  if (trimmed.startsWith('#') || trimmed.startsWith('?')) {
    return { safeHref: trimmed, isExternal: false };
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('file:')
  ) {
    return { safeHref: null, isExternal: false };
  }

  if (lower.startsWith('https://') || lower.startsWith('http://')) {
    return { safeHref: trimmed, isExternal: true };
  }

  if (lower.startsWith('mailto:') || lower.startsWith('tel:')) {
    return { safeHref: trimmed, isExternal: false };
  }

  return { safeHref: null, isExternal: false };
}

/**
 * Phân tích cú pháp dòng văn bản thành mảng token an toàn (text, bold, code, link).
 */
export function parseSafeInlineTokens(rawLine: string): SafeInlineToken[] {
  const cleanLine = stripRawHtmlFromMarkdown(rawLine);
  if (!cleanLine) return [];

  const tokens: SafeInlineToken[] = [];
  // Hỗ trợ: [label](url), **bold**, `code`
  const pattern = /(\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(cleanLine)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        type: 'text',
        text: cleanLine.slice(lastIndex, match.index),
      });
    }

    if (match[2] !== undefined && match[3] !== undefined) {
      const label = stripRawHtmlFromMarkdown(match[2]).trim();
      const { safeHref, isExternal } = sanitizeMarkdownUrl(match[3]);
      if (safeHref && label) {
        tokens.push({
          type: 'link',
          text: label,
          href: safeHref,
          isExternal,
        });
      } else {
        tokens.push({
          type: 'text',
          text: label || '',
        });
      }
    } else if (match[4] !== undefined) {
      tokens.push({
        type: 'bold',
        text: stripRawHtmlFromMarkdown(match[4]),
      });
    } else if (match[5] !== undefined) {
      tokens.push({
        type: 'code',
        text: stripRawHtmlFromMarkdown(match[5]),
      });
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < cleanLine.length) {
    tokens.push({
      type: 'text',
      text: cleanLine.slice(lastIndex),
    });
  }

  return tokens;
}

/**
 * Phân tích văn bản Markdown giới hạn thành danh sách khối cấu trúc an toàn (SafeMarkdownBlock[]).
 * Không bao giờ sinh hay giữ lại HTML thô.
 */
export function parseSafeMarkdownBlocks(markdown: string): SafeMarkdownBlock[] {
  const cleaned = stripRawHtmlFromMarkdown(markdown);
  const lines = cleaned.split(/\r?\n/);
  const blocks: SafeMarkdownBlock[] = [];

  let currentParagraphLines: string[] = [];
  let currentListType: 'unordered-list' | 'ordered-list' | null = null;
  let currentListItems: SafeInlineToken[][] = [];

  const flushParagraph = () => {
    if (currentParagraphLines.length > 0) {
      const joined = currentParagraphLines.join(' ').trim();
      if (joined) {
        blocks.push({
          type: 'paragraph',
          tokens: parseSafeInlineTokens(joined),
        });
      }
      currentParagraphLines = [];
    }
  };

  const flushList = () => {
    if (currentListType && currentListItems.length > 0) {
      blocks.push({
        type: currentListType,
        items: currentListItems,
      });
    }
    currentListType = null;
    currentListItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    // Kiểm tra tiêu đề #, ##, ###
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = Math.min(Math.max(headingMatch[1].length, 1), 3) as 1 | 2 | 3;
      blocks.push({
        type: 'heading',
        level,
        tokens: parseSafeInlineTokens(headingMatch[2].trim()),
      });
      continue;
    }

    // Kiểm tra danh sách không thứ tự (- hoặc *)
    const ulMatch = line.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      if (currentListType !== 'unordered-list') {
        flushList();
        currentListType = 'unordered-list';
      }
      currentListItems.push(parseSafeInlineTokens(ulMatch[1].trim()));
      continue;
    }

    // Kiểm tra danh sách có thứ tự (1. 2. ...)
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      if (currentListType !== 'ordered-list') {
        flushList();
        currentListType = 'ordered-list';
      }
      currentListItems.push(parseSafeInlineTokens(olMatch[1].trim()));
      continue;
    }

    // Đoạn văn thường
    flushList();
    currentParagraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}
