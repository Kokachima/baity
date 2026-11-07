import { Router } from 'express';
import { optionalAuth, type AuthRequest } from '../services/auth.ts';
import {
  checkChatRateLimitPersistent,
  generateChatbotResponse,
  hashIpForChatbotCounter,
  MAX_CHAT_MESSAGE_LENGTH,
} from '../services/chatbot.ts';

export const chatRouter = Router();

/**
 * POST /api/chat
 * Trợ lý tư vấn khách hàng trực tuyến (Gemini phía server):
 * - Giới hạn độ dài tin nhắn <= 500 ký tự
 * - Giới hạn lịch sử hội thoại <= 10 tin gần nhất
 * - Giới hạn tốc độ theo userId (nếu đã đăng nhập) hoặc HMAC-SHA256 IP (lưu trong DB chatbot_daily_counters + L1 RAM)
 * - Trần số lần gọi Gemini theo người dùng/IP mỗi ngày và toàn hệ thống mỗi ngày trong DB
 * - Chỉ tra cứu đơn hàng của chính người dùng đang đăng nhập (từ req.user.id)
 * - Đối chiếu sản phẩm gợi ý với Database, lấy bảng size từ store_settings & lấy chính sách từ faq_policies
 */
chatRouter.post('/', optionalAuth, async (req: AuthRequest, res) => {
  try {
    const actorKey = req.user?.id
      ? `user:${req.user.id}`
      : hashIpForChatbotCounter(req.ip || req.socket?.remoteAddress || 'unknown');

    const rateStatus = await checkChatRateLimitPersistent(actorKey);
    if (!rateStatus.allowed) {
      res.setHeader('Retry-After', String(rateStatus.retryAfterSeconds));
      const rateLimitMsg =
        'Bạn đang gửi tin nhắn quá nhanh. Vui lòng đợi ít giây rồi thử lại hoặc xem mục Câu hỏi thường gặp (FAQ).';
      return res.status(429).json({
        success: false,
        code: 'CHAT_RATE_LIMIT_EXCEEDED',
        message: rateLimitMsg,
        error: {
          code: 'CHAT_RATE_LIMIT_EXCEEDED',
          message: rateLimitMsg,
        },
      });
    }

    const rawMessage = req.body?.message;
    if (typeof rawMessage !== 'string' || rawMessage.trim().length === 0) {
      return res.status(400).json({
        success: false,
        code: 'EMPTY_MESSAGE',
        message: 'Vui lòng nhập nội dung câu hỏi.',
        error: {
          code: 'EMPTY_MESSAGE',
          message: 'Vui lòng nhập nội dung câu hỏi.',
        },
      });
    }

    if (rawMessage.length > MAX_CHAT_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        code: 'MESSAGE_TOO_LONG',
        message: `Tin nhắn không được vượt quá ${MAX_CHAT_MESSAGE_LENGTH} ký tự.`,
        error: {
          code: 'MESSAGE_TOO_LONG',
          message: `Tin nhắn không được vượt quá ${MAX_CHAT_MESSAGE_LENGTH} ký tự.`,
        },
      });
    }

    // Tuyệt đối bỏ qua mọi userId/user_id do client tự gửi lên; chỉ lấy từ phiên xác thực req.user
    const authenticatedUserId = req.user?.id || null;

    const result = await generateChatbotResponse({
      message: rawMessage,
      history: req.body?.history,
      authenticatedUserId,
      actorKey,
    });

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        code: result.code || 'CHAT_SERVICE_ERROR',
        message: result.reply,
        reply: result.reply,
        recommendedProducts: [],
        error: {
          code: result.code || 'CHAT_SERVICE_ERROR',
          message: result.reply,
        },
      });
    }

    return res.status(200).json({
      success: true,
      code: result.code || 'OK',
      temporaryUnavailable: Boolean(result.temporaryUnavailable),
      reply: result.reply,
      message: result.reply,
      recommendedProducts: result.recommendedProducts,
      orders: result.orders,
      historyUsedCount: result.historyUsedCount,
      data: {
        reply: result.reply,
        temporaryUnavailable: Boolean(result.temporaryUnavailable),
        recommendedProducts: result.recommendedProducts,
        orders: result.orders,
        historyUsedCount: result.historyUsedCount,
      },
    });
  } catch (err: any) {
    console.error('[POST /api/chat ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
    const fallbackMsg =
      'Trợ lý tư vấn tạm thời gián đoạn. Quý khách vui lòng thử lại sau hoặc xem mục Chính sách & Câu hỏi thường gặp (FAQ).';
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: fallbackMsg,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: fallbackMsg,
      },
    });
  }
});

// ============================================================================
// GIAI ĐOẠN 6D — CHAT VỚI NGƯỜI BÁN (HỎI ĐÁP TRỰC TIẾP VỚI CỬA HÀNG)
// - Chỉ dành cho người dùng đã đăng nhập (requireAuth)
// - Mỗi khách tối đa 1 hội thoại đang mở (partial unique index idx_chat_conv_single_open_user)
// - Không đính kèm tệp; văn bản thuần 1–1000 ký tự; tối đa 500 tin/hội thoại
// - Giới hạn 20 tin / 10 phút / người dùng
// - Tuyệt đối KHÔNG gửi nội dung cho Gemini và KHÔNG ghi nội dung tin nhắn ra log
// ============================================================================

import { sql } from 'drizzle-orm';
import { queryRows, withTransaction } from '../db/index.ts';
import { requireAuth } from '../services/auth.ts';
import {
  SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION,
  SELLER_CHAT_MESSAGE_MAX_LENGTH,
  SELLER_CHAT_RATE_LIMIT_MAX_MESSAGES,
  SELLER_CHAT_RATE_LIMIT_WINDOW_MS,
  SELLER_CHAT_RETENTION_DAYS,
  SELLER_CHAT_SENSITIVE_WARNING_TEXT,
} from '../../shared/contracts.ts';

const sellerChatUserMessageTimestamps = new Map<string, number[]>();

export function resetSellerChatRateLimitForTest(): void {
  sellerChatUserMessageTimestamps.clear();
}

function checkSellerChatRateLimit(userId: string): {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
} {
  const now = Date.now();
  const cutoff = now - SELLER_CHAT_RATE_LIMIT_WINDOW_MS;
  const history = (sellerChatUserMessageTimestamps.get(userId) || []).filter((ts) => ts > cutoff);

  if (history.length >= SELLER_CHAT_RATE_LIMIT_MAX_MESSAGES) {
    const oldest = history[0] || now;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + SELLER_CHAT_RATE_LIMIT_WINDOW_MS - now) / 1000)
    );
    sellerChatUserMessageTimestamps.set(userId, history);
    return {
      allowed: false,
      retryAfterSeconds,
      remaining: 0,
    };
  }

  history.push(now);
  sellerChatUserMessageTimestamps.set(userId, history);
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: Math.max(0, SELLER_CHAT_RATE_LIMIT_MAX_MESSAGES - history.length),
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Middleware nội bộ chặn truy cập ID hội thoại trực tiếp trên URL (/api/chat/conversations/<id>...)
// bằng cách chuẩn hóa về nhánh /conversations/me kèm kiểm tra quyền sở hữu (trả 404 nếu của người khác)
chatRouter.use((req, _res, next) => {
  const match = req.url.match(
    /^\/conversations\/(?!me(?:\/|\?|$))([^/?#]+)(\/messages|\/read)?(\?.*)?$/
  );
  if (match) {
    (req as any).requestedConversationId = decodeURIComponent(match[1]);
    req.url = `/conversations/me${match[2] || ''}${match[3] || ''}`;
  }
  next();
});

async function assertExplicitConversationOwnership(
  req: AuthRequest,
  userId: string,
  runQuery: typeof queryRows = queryRows
): Promise<{ ok: true } | { ok: false }> {
  const explicitIdRaw =
    (req as any).requestedConversationId ??
    req.query?.conversationId ??
    req.query?.id ??
    req.body?.conversationId ??
    req.body?.id;

  if (explicitIdRaw === undefined || explicitIdRaw === null || explicitIdRaw === '' || explicitIdRaw === 'me') {
    return { ok: true };
  }

  const explicitId = String(explicitIdRaw).trim();
  if (!UUID_REGEX.test(explicitId)) {
    return { ok: false };
  }

  const rows = await runQuery<{ id: string; user_id: string | null }>(sql`
    SELECT id, user_id
    FROM chat_conversations
    WHERE id = ${explicitId}::uuid
      AND mode = 'human'
    LIMIT 1;
  `);

  if (rows.length === 0 || rows[0].user_id !== userId) {
    return { ok: false };
  }

  return { ok: true };
}

function formatConversationRow(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    status: (row.status || 'open') as 'open' | 'closed',
    waitingForReply: Number(row.unreadAdmin ?? row.unread_admin ?? 0) > 0,
    lastMessage: row.lastMessage ?? row.last_message ?? null,
    lastMessageAt: row.lastMessageAt ?? row.last_message_at ?? row.updatedAt ?? row.updated_at,
    closedAt: row.closedAt ?? row.closed_at ?? null,
    unreadAdmin: Number(row.unreadAdmin ?? row.unread_admin ?? 0),
    unreadUser: Number(row.unreadUser ?? row.unread_user ?? 0),
    userLastReadAt: row.userLastReadAt ?? row.user_last_read_at ?? null,
    adminLastReadAt: row.adminLastReadAt ?? row.admin_last_read_at ?? null,
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at,
  };
}

/**
 * POST /api/chat/conversations
 * Lấy hoặc tạo hội thoại đang mở của chính người dùng đang đăng nhập.
 * Đảm bảo an toàn khi gọi đồng thời (Promise.all) nhờ partial unique index (user_id) WHERE status = 'open'.
 */
chatRouter.post('/conversations', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const ownership = await assertExplicitConversationOwnership(req, userId);
    if (!ownership.ok) {
      return res.status(404).json({
        success: false,
        code: 'CHAT_CONVERSATION_NOT_FOUND',
        message: 'Không tìm thấy hội thoại.',
        error: {
          code: 'CHAT_CONVERSATION_NOT_FOUND',
          message: 'Không tìm thấy hội thoại.',
        },
      });
    }

    // Nếu hội thoại đang mở hiện tại đã chạm trần 500 tin nhắn thì tự động đóng trước khi khởi tạo hội thoại mới
    await queryRows(sql`
      UPDATE chat_conversations
      SET status = 'closed',
          closed_at = COALESCE(closed_at, NOW()),
          updated_at = NOW()
      WHERE user_id = ${userId}::uuid
        AND mode = 'human'
        AND status = 'open'
        AND (
          SELECT COUNT(*)::int
          FROM chat_messages cm
          WHERE cm.conversation_id = chat_conversations.id
        ) >= ${SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION};
    `);

    const upsertedRows = await queryRows<any>(sql`
      INSERT INTO chat_conversations (
        user_id,
        mode,
        status,
        unread_admin,
        unread_user,
        last_message_at,
        created_at,
        updated_at
      )
      VALUES (
        ${userId}::uuid,
        'human',
        'open',
        0,
        0,
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT (user_id) WHERE status = 'open'
      DO UPDATE SET updated_at = chat_conversations.updated_at
      RETURNING
        id,
        status,
        last_message AS "lastMessage",
        last_message_at AS "lastMessageAt",
        closed_at AS "closedAt",
        unread_admin AS "unreadAdmin",
        unread_user AS "unreadUser",
        user_last_read_at AS "userLastReadAt",
        admin_last_read_at AS "adminLastReadAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt";
    `);

    const conv = formatConversationRow(upsertedRows[0]);
    const messages = conv
      ? await queryRows<any>(sql`
          SELECT
            id,
            conversation_id AS "conversationId",
            sender_type AS "senderType",
            content,
            created_at AS "createdAt"
          FROM chat_messages
          WHERE conversation_id = ${conv.id}::uuid
          ORDER BY created_at ASC, id ASC
          LIMIT ${SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION};
        `)
      : [];

    return res.status(200).json({
      success: true,
      conversation: conv,
      messages,
      warning: SELLER_CHAT_SENSITIVE_WARNING_TEXT,
      data: {
        conversation: conv,
        messages,
        warning: SELLER_CHAT_SENSITIVE_WARNING_TEXT,
      },
    });
  } catch (err: any) {
    console.error('[POST /api/chat/conversations ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Không thể khởi tạo hội thoại lúc này.',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Không thể khởi tạo hội thoại lúc này.',
      },
    });
  }
});

/**
 * GET /api/chat/conversations/me?after=<id>
 * Lấy hội thoại hiện tại của người dùng đang đăng nhập kèm danh sách tin nhắn (hoặc tin nhắn mới sau ID `after`).
 */
chatRouter.get('/conversations/me', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const ownership = await assertExplicitConversationOwnership(req, userId);
    if (!ownership.ok) {
      return res.status(404).json({
        success: false,
        code: 'CHAT_CONVERSATION_NOT_FOUND',
        message: 'Không tìm thấy hội thoại.',
        error: {
          code: 'CHAT_CONVERSATION_NOT_FOUND',
          message: 'Không tìm thấy hội thoại.',
        },
      });
    }

    const rawAfter = typeof req.query.after === 'string' ? req.query.after.trim() : '';
    if (rawAfter && !UUID_REGEX.test(rawAfter)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_AFTER_CURSOR',
        message: 'Tham số after phải là UUID hợp lệ.',
        error: {
          code: 'INVALID_AFTER_CURSOR',
          message: 'Tham số after phải là UUID hợp lệ.',
        },
      });
    }

    const convRows = await queryRows<any>(sql`
      SELECT
        id,
        status,
        last_message AS "lastMessage",
        last_message_at AS "lastMessageAt",
        closed_at AS "closedAt",
        unread_admin AS "unreadAdmin",
        unread_user AS "unreadUser",
        user_last_read_at AS "userLastReadAt",
        admin_last_read_at AS "adminLastReadAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM chat_conversations
      WHERE user_id = ${userId}::uuid
        AND mode = 'human'
      ORDER BY
        CASE WHEN status = 'open' THEN 0 ELSE 1 END ASC,
        updated_at DESC
      LIMIT 1;
    `);

    if (convRows.length === 0) {
      return res.status(200).json({
        success: true,
        conversation: null,
        messages: [],
        warning: SELLER_CHAT_SENSITIVE_WARNING_TEXT,
        data: {
          conversation: null,
          messages: [],
          warning: SELLER_CHAT_SENSITIVE_WARNING_TEXT,
        },
      });
    }

    const conv = formatConversationRow(convRows[0])!;

    if (rawAfter) {
      const cursorOwnerRows = await queryRows<{ conversation_id: string }>(sql`
        SELECT conversation_id
        FROM chat_messages
        WHERE id = ${rawAfter}::uuid
        LIMIT 1;
      `);
      if (cursorOwnerRows.length > 0 && cursorOwnerRows[0].conversation_id !== conv.id) {
        return res.status(404).json({
          success: false,
          code: 'CHAT_CONVERSATION_NOT_FOUND',
          message: 'Không tìm thấy hội thoại.',
          error: {
            code: 'CHAT_CONVERSATION_NOT_FOUND',
            message: 'Không tìm thấy hội thoại.',
          },
        });
      }
    }

    const allMessages = await queryRows<any>(sql`
      SELECT
        id,
        conversation_id AS "conversationId",
        sender_type AS "senderType",
        content,
        created_at AS "createdAt"
      FROM chat_messages
      WHERE conversation_id = ${conv.id}::uuid
      ORDER BY created_at ASC, id ASC
      LIMIT ${SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION};
    `);

    let messages = allMessages;
    if (rawAfter) {
      const idx = allMessages.findIndex((m) => String(m.id).toLowerCase() === rawAfter.toLowerCase());
      messages = idx >= 0 ? allMessages.slice(idx + 1) : [];
    }

    return res.status(200).json({
      success: true,
      conversation: conv,
      messages,
      warning: SELLER_CHAT_SENSITIVE_WARNING_TEXT,
      data: {
        conversation: conv,
        messages,
        warning: SELLER_CHAT_SENSITIVE_WARNING_TEXT,
      },
    });
  } catch (err: any) {
    console.error('[GET /api/chat/conversations/me ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Không thể tải nội dung hội thoại lúc này.',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Không thể tải nội dung hội thoại lúc này.',
      },
    });
  }
});

/**
 * POST /api/chat/conversations/me/messages
 * Khách gửi tin nhắn cho người bán:
 * - Giới hạn 20 tin / 10 phút / người dùng
 * - Không đính kèm tệp
 * - Văn bản thuần 1..1000 ký tự
 * - Tối đa 500 tin mỗi hội thoại
 * - Hội thoại đã đóng sẽ tự động mở lại (status = 'open')
 */
chatRouter.post('/conversations/me/messages', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const ownership = await assertExplicitConversationOwnership(req, userId);
    if (!ownership.ok) {
      return res.status(404).json({
        success: false,
        code: 'CHAT_CONVERSATION_NOT_FOUND',
        message: 'Không tìm thấy hội thoại.',
        error: {
          code: 'CHAT_CONVERSATION_NOT_FOUND',
          message: 'Không tìm thấy hội thoại.',
        },
      });
    }

    const body = req.body || {};
    if (
      body.attachments !== undefined ||
      body.files !== undefined ||
      body.file !== undefined ||
      body.image !== undefined ||
      body.imageUrl !== undefined ||
      body.fileUrl !== undefined
    ) {
      return res.status(400).json({
        success: false,
        code: 'CHAT_ATTACHMENT_FORBIDDEN',
        message: 'Chat với người bán chỉ hỗ trợ tin nhắn văn bản thuần, không hỗ trợ đính kèm tệp hoặc hình ảnh.',
        error: {
          code: 'CHAT_ATTACHMENT_FORBIDDEN',
          message: 'Chat với người bán chỉ hỗ trợ tin nhắn văn bản thuần, không hỗ trợ đính kèm tệp hoặc hình ảnh.',
        },
      });
    }

    // Lưu nguyên văn văn bản đã cắt khoảng trắng đầu cuối (chỉ bỏ ký tự null \0 cho PostgreSQL text),
    // KHÔNG xóa thẻ HTML khi lưu; giao diện hiển thị luôn ở dạng văn bản thuần (escaped).
    const rawText = typeof body.content === 'string' ? body.content : typeof body.message === 'string' ? body.message : '';
    const cleanContent = rawText.replace(/\0/g, '').trim();

    if (cleanContent.length < 1) {
      return res.status(400).json({
        success: false,
        code: 'EMPTY_CHAT_MESSAGE',
        message: 'Vui lòng nhập nội dung tin nhắn.',
        error: {
          code: 'EMPTY_CHAT_MESSAGE',
          message: 'Vui lòng nhập nội dung tin nhắn.',
        },
      });
    }

    if (cleanContent.length > SELLER_CHAT_MESSAGE_MAX_LENGTH) {
      return res.status(400).json({
        success: false,
        code: 'CHAT_MESSAGE_TOO_LONG',
        message: `Tin nhắn không được vượt quá ${SELLER_CHAT_MESSAGE_MAX_LENGTH} ký tự.`,
        error: {
          code: 'CHAT_MESSAGE_TOO_LONG',
          message: `Tin nhắn không được vượt quá ${SELLER_CHAT_MESSAGE_MAX_LENGTH} ký tự.`,
        },
      });
    }

    const rateStatus = checkSellerChatRateLimit(userId);
    if (!rateStatus.allowed) {
      res.setHeader('Retry-After', String(rateStatus.retryAfterSeconds));
      const msg = `Bạn đã gửi quá ${SELLER_CHAT_RATE_LIMIT_MAX_MESSAGES} tin nhắn trong 10 phút. Vui lòng đợi ít phút rồi thử lại.`;
      return res.status(429).json({
        success: false,
        code: 'SELLER_CHAT_RATE_LIMIT_EXCEEDED',
        message: msg,
        error: {
          code: 'SELLER_CHAT_RATE_LIMIT_EXCEEDED',
          message: msg,
        },
      });
    }

    const txResult = await withTransaction(async (txQueryRows) => {
      // Chỉ lấy hội thoại đang mở (status = 'open') hoặc hội thoại đã đóng nhưng CHƯA chạm trần 500 tin nhắn.
      // Nếu hội thoại cũ đã đóng vì đủ 500 tin nhắn, tự động tạo hội thoại mới tinh (không mang tin cũ).
      const existingRows = await txQueryRows<{ id: string; status: string }>(sql`
        SELECT cc.id, cc.status
        FROM chat_conversations cc
        WHERE cc.user_id = ${userId}::uuid
          AND cc.mode = 'human'
          AND (
            cc.status = 'open'
            OR (
              cc.status = 'closed'
              AND (
                SELECT COUNT(*)::int
                FROM chat_messages cm
                WHERE cm.conversation_id = cc.id
              ) < ${SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION}
            )
          )
        ORDER BY
          CASE WHEN cc.status = 'open' THEN 0 ELSE 1 END ASC,
          cc.updated_at DESC
        LIMIT 1
        FOR UPDATE;
      `);

      let convId: string;
      if (existingRows.length > 0) {
        convId = existingRows[0].id;
      } else {
        const createdRows = await txQueryRows<{ id: string }>(sql`
          INSERT INTO chat_conversations (
            user_id,
            mode,
            status,
            unread_admin,
            unread_user,
            last_message_at,
            created_at,
            updated_at
          )
          VALUES (
            ${userId}::uuid,
            'human',
            'open',
            0,
            0,
            NOW(),
            NOW(),
            NOW()
          )
          ON CONFLICT (user_id) WHERE status = 'open'
          DO UPDATE SET updated_at = chat_conversations.updated_at
          RETURNING id;
        `);
        convId = createdRows[0].id;
      }

      const countRows = await txQueryRows<{ cnt: number }>(sql`
        SELECT COUNT(*)::int AS cnt
        FROM chat_messages
        WHERE conversation_id = ${convId}::uuid;
      `);
      const currentMsgCount = Number(countRows[0]?.cnt || 0);
      if (currentMsgCount >= SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION) {
        // Tự động đóng hội thoại đã chạm trần 500 tin nhắn và commit thay đổi này để khách có thể bắt đầu hội thoại mới
        await txQueryRows(sql`
          UPDATE chat_conversations
          SET status = 'closed',
              closed_at = COALESCE(closed_at, NOW()),
              updated_at = NOW()
          WHERE id = ${convId}::uuid;
        `);
        return {
          limitReached: true as const,
          closedConversationId: convId,
        };
      }

      const insertedMsgRows = await txQueryRows<any>(sql`
        INSERT INTO chat_messages (conversation_id, sender_type, content, created_at)
        VALUES (
          ${convId}::uuid,
          'user',
          ${cleanContent},
          GREATEST(
            NOW(),
            COALESCE(
              (SELECT MAX(created_at) + INTERVAL '1 millisecond' FROM chat_messages WHERE conversation_id = ${convId}::uuid),
              NOW()
            )
          )
        )
        RETURNING
          id,
          conversation_id AS "conversationId",
          sender_type AS "senderType",
          content,
          created_at AS "createdAt";
      `);

      const reachedCapAfterInsert = currentMsgCount + 1 >= SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION;
      const nextStatus = reachedCapAfterInsert ? 'closed' : 'open';

      const updatedConvRows = await txQueryRows<any>(sql`
        UPDATE chat_conversations
        SET status = ${nextStatus},
            closed_at = CASE WHEN ${reachedCapAfterInsert} THEN NOW() ELSE NULL END,
            last_message = ${cleanContent.slice(0, 200)},
            last_message_at = NOW(),
            unread_admin = unread_admin + 1,
            unread_user = 0,
            user_last_read_at = NOW(),
            updated_at = NOW()
        WHERE id = ${convId}::uuid
        RETURNING
          id,
          status,
          last_message AS "lastMessage",
          last_message_at AS "lastMessageAt",
          closed_at AS "closedAt",
          unread_admin AS "unreadAdmin",
          unread_user AS "unreadUser",
          user_last_read_at AS "userLastReadAt",
          admin_last_read_at AS "adminLastReadAt",
          created_at AS "createdAt",
          updated_at AS "updatedAt";
      `);

      return {
        limitReached: false as const,
        message: insertedMsgRows[0],
        conversation: formatConversationRow(updatedConvRows[0]),
        autoClosedAtCap: reachedCapAfterInsert,
      };
    });

    if (txResult.limitReached) {
      const limitMsg = `Hội thoại hiện tại đã đạt giới hạn tối đa ${SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION} tin nhắn và đã được tự động đóng. Bạn có thể gửi lại tin nhắn hoặc bắt đầu hội thoại mới.`;
      return res.status(400).json({
        success: false,
        code: 'CHAT_CONVERSATION_MESSAGE_LIMIT',
        conversationAutoClosed: true,
        closedConversationId: txResult.closedConversationId,
        message: limitMsg,
        error: {
          code: 'CHAT_CONVERSATION_MESSAGE_LIMIT',
          message: limitMsg,
        },
      });
    }

    return res.status(201).json({
      success: true,
      message: txResult.message,
      conversation: txResult.conversation,
      autoClosedAtCap: txResult.autoClosedAtCap,
      data: {
        message: txResult.message,
        conversation: txResult.conversation,
        autoClosedAtCap: txResult.autoClosedAtCap,
      },
    });
  } catch (err: any) {
    if (err?.statusCode === 400 || err?.statusCode === 404) {
      return res.status(err.statusCode).json({
        success: false,
        code: err.code || 'BAD_REQUEST',
        message: err.message,
        error: {
          code: err.code || 'BAD_REQUEST',
          message: err.message,
        },
      });
    }
    console.error('[POST /api/chat/conversations/me/messages ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Không thể gửi tin nhắn lúc này.',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Không thể gửi tin nhắn lúc này.',
      },
    });
  }
});

/**
 * POST /api/chat/conversations/me/read
 * Đánh dấu khách hàng đã đọc toàn bộ phản hồi mới từ cửa hàng trong hội thoại của mình.
 */
chatRouter.post('/conversations/me/read', requireAuth, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const ownership = await assertExplicitConversationOwnership(req, userId);
    if (!ownership.ok) {
      return res.status(404).json({
        success: false,
        code: 'CHAT_CONVERSATION_NOT_FOUND',
        message: 'Không tìm thấy hội thoại.',
        error: {
          code: 'CHAT_CONVERSATION_NOT_FOUND',
          message: 'Không tìm thấy hội thoại.',
        },
      });
    }

    const updatedRows = await queryRows<any>(sql`
      UPDATE chat_conversations
      SET unread_user = 0,
          user_last_read_at = NOW(),
          updated_at = NOW()
      WHERE id = (
        SELECT id
        FROM chat_conversations
        WHERE user_id = ${userId}::uuid
          AND mode = 'human'
        ORDER BY
          CASE WHEN status = 'open' THEN 0 ELSE 1 END ASC,
          updated_at DESC
        LIMIT 1
      )
      RETURNING
        id,
        status,
        last_message AS "lastMessage",
        last_message_at AS "lastMessageAt",
        closed_at AS "closedAt",
        unread_admin AS "unreadAdmin",
        unread_user AS "unreadUser",
        user_last_read_at AS "userLastReadAt",
        admin_last_read_at AS "adminLastReadAt",
        created_at AS "createdAt",
        updated_at AS "updatedAt";
    `);

    const conv = formatConversationRow(updatedRows[0] || null);
    return res.status(200).json({
      success: true,
      conversation: conv,
      data: {
        conversation: conv,
      },
    });
  } catch (err: any) {
    console.error('[POST /api/chat/conversations/me/read ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Không thể cập nhật trạng thái đã đọc.',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Không thể cập nhật trạng thái đã đọc.',
      },
    });
  }
});

/**
 * Dọn dẹp định kỳ các hội thoại hỏi đáp với người bán đã đóng quá 180 ngày (cùng tin nhắn qua ON DELETE CASCADE).
 */
export async function cleanupOldClosedSellerChats(
  runQuery: typeof queryRows = queryRows
): Promise<number> {
  const deletedRows = await runQuery<{ id: string }>(sql`
    DELETE FROM chat_conversations
    WHERE mode = 'human'
      AND status = 'closed'
      AND COALESCE(closed_at, updated_at) < NOW() - (${SELLER_CHAT_RETENTION_DAYS} * INTERVAL '1 day')
    RETURNING id;
  `);
  return deletedRows.length;
}

