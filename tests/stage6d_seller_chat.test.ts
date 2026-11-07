import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from 'drizzle-orm';

// Chạy trên PGlite in-memory cô lập
process.env.DATABASE_URL = '';
process.env.PGLITE_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.COOKIE_CROSS_SITE = 'false';
process.env.JWT_SECRET = 'test-secret-stage6d-seller-chat';

import { createApp } from '../server/app.ts';
import { initDatabase } from '../server/db/init.ts';
import { queryRows, closeDb } from '../server/db/index.ts';
import { seedDatabase } from '../server/db/seed.ts';
import { generateToken, AUTH_COOKIE_NAME } from '../server/services/auth.ts';
import { resetSellerChatRateLimitForTest } from '../server/routes/chat.ts';
import { setChatbotGeminiGeneratorForTest } from '../server/services/chatbot.ts';
import { SellerChatPanel } from '../src/components/support/SellerChatPanel.tsx';
import { ChatbotWidget } from '../src/components/support/ChatbotWidget.tsx';
import { SellerChatsAdminPage } from '../src/components/admin/SellerChatsAdminPage.tsx';

let server: http.Server;
let baseUrl = '';
let adminCookie = '';
let customerACookie = '';
let customerBCookie = '';
let adminUserId = '';
let customerAId = '';
let customerBId = '';

before(async () => {
  await initDatabase();
  await seedDatabase();
  const app = createApp();

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });

  // Tài khoản Admin
  const adminRows = await queryRows<{ id: string; email: string; role: string }>(sql`
    INSERT INTO users (email, password_hash, full_name, phone, role)
    VALUES ('admin_stage6d@baity.vn', 'hashed', 'Quản trị Hỏi Đáp 6d', '0909000600', 'admin')
    ON CONFLICT (email) DO UPDATE SET role = 'admin'
    RETURNING id, email, role;
  `);
  adminUserId = adminRows[0].id;
  adminCookie = `${AUTH_COOKIE_NAME}=${generateToken({
    id: adminUserId,
    email: adminRows[0].email,
    role: 'admin',
  })}`;

  // Khách hàng A
  const custARows = await queryRows<{ id: string; email: string; role: string }>(sql`
    INSERT INTO users (email, password_hash, full_name, phone, role)
    VALUES ('customer_a_6d_secret@baity.vn', 'hashed', 'Nguyễn Văn An', '0911222333', 'customer')
    ON CONFLICT (email) DO UPDATE SET full_name = 'Nguyễn Văn An', phone = '0911222333'
    RETURNING id, email, role;
  `);
  customerAId = custARows[0].id;
  customerACookie = `${AUTH_COOKIE_NAME}=${generateToken({
    id: customerAId,
    email: custARows[0].email,
    role: 'customer',
  })}`;

  // Thêm địa chỉ cho Khách A để kiểm chứng API Admin không làm lộ địa chỉ
  await queryRows(sql`
    INSERT INTO addresses (user_id, receiver_name, phone, province, ward, street_address, is_default)
    VALUES (${customerAId}::uuid, 'Nguyễn Văn An', '0911222333', 'TP. Hồ Chí Minh', 'Phường Bến Nghé', '999 Đường Bí Mật Tuyệt Đối', true);
  `);

  // Khách hàng B
  const custBRows = await queryRows<{ id: string; email: string; role: string }>(sql`
    INSERT INTO users (email, password_hash, full_name, phone, role)
    VALUES ('customer_b_6d_secret@baity.vn', 'hashed', 'Trần Thị Bình', '0944555666', 'customer')
    ON CONFLICT (email) DO UPDATE SET full_name = 'Trần Thị Bình', phone = '0944555666'
    RETURNING id, email, role;
  `);
  customerBId = custBRows[0].id;
  customerBCookie = `${AUTH_COOKIE_NAME}=${generateToken({
    id: customerBId,
    email: custBRows[0].email,
    role: 'customer',
  })}`;
});

after(async () => {
  setChatbotGeminiGeneratorForTest(null);
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await closeDb();
});

// ============================================================================
// 1. CHƯA ĐĂNG NHẬP TRẢ 401
// ============================================================================
test('Stage 6d.1: Chưa đăng nhập gọi các API chat với người bán (/api/chat/conversations*) nhận 401 UNAUTHORIZED', async () => {
  const endpoints: { method: string; path: string; body?: any }[] = [
    { method: 'POST', path: '/api/chat/conversations', body: {} },
    { method: 'GET', path: '/api/chat/conversations/me' },
    { method: 'POST', path: '/api/chat/conversations/me/messages', body: { content: 'Xin chào' } },
    { method: 'POST', path: '/api/chat/conversations/me/read', body: {} },
  ];

  for (const ep of endpoints) {
    const res = await fetch(`${baseUrl}${ep.path}`, {
      method: ep.method,
      headers: ep.body ? { 'Content-Type': 'application/json' } : undefined,
      body: ep.body ? JSON.stringify(ep.body) : undefined,
    });
    assert.equal(
      res.status,
      401,
      `Chưa đăng nhập gọi ${ep.method} ${ep.path} phải nhận 401 (thực tế: ${res.status})`
    );
  }
});

// ============================================================================
// 2. KHÁCH A KHÔNG ĐỌC / GỬI ĐƯỢC VÀO HỘI THOẠI CỦA KHÁCH B (404)
// ============================================================================
test('Stage 6d.2: Khách A không đọc hoặc gửi được tin nhắn vào hội thoại của khách B (trả 404 CHAT_CONVERSATION_NOT_FOUND ở mọi đường dẫn và tham số)', async () => {
  resetSellerChatRateLimitForTest();

  // Khách B tạo hội thoại và gửi 1 tin nhắn riêng tư
  const sendBRes = await fetch(`${baseUrl}/api/chat/conversations/me/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: customerBCookie,
    },
    body: JSON.stringify({ content: 'Tin nhắn riêng tư của Khách B' }),
  });
  assert.equal(sendBRes.status, 201);
  const sendBBody = await sendBRes.json();
  const convBId = sendBBody.conversation.id as string;
  const msgBId = sendBBody.message.id as string;

  // Khách A tạo hội thoại của riêng mình
  const createARes = await fetch(`${baseUrl}/api/chat/conversations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: customerACookie,
    },
    body: JSON.stringify({}),
  });
  assert.equal(createARes.status, 200);

  // 1. Khách A cố đọc hội thoại của Khách B qua URL /api/chat/conversations/:convBId
  const readByPathRes = await fetch(`${baseUrl}/api/chat/conversations/${convBId}`, {
    headers: { Cookie: customerACookie },
  });
  assert.equal(readByPathRes.status, 404, 'Khách A đọc /conversations/:convBId phải nhận 404');

  // 2. Khách A cố đọc qua query ?conversationId=convBId
  const readByQueryRes = await fetch(
    `${baseUrl}/api/chat/conversations/me?conversationId=${convBId}`,
    { headers: { Cookie: customerACookie } }
  );
  assert.equal(readByQueryRes.status, 404, 'Khách A đọc ?conversationId=convBId phải nhận 404');

  // 3. Khách A cố đọc qua cursor ?after=msgBId (tin nhắn thuộc hội thoại của Khách B)
  const readByCursorRes = await fetch(`${baseUrl}/api/chat/conversations/me?after=${msgBId}`, {
    headers: { Cookie: customerACookie },
  });
  assert.equal(readByCursorRes.status, 404, 'Khách A truyền ?after=msgBId của Khách B phải nhận 404');

  // 4. Khách A cố gửi tin nhắn vào hội thoại của Khách B qua URL /api/chat/conversations/:convBId/messages
  const postByPathRes = await fetch(`${baseUrl}/api/chat/conversations/${convBId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: customerACookie,
    },
    body: JSON.stringify({ content: 'Khách A cố chèn tin vào hội thoại B' }),
  });
  assert.equal(postByPathRes.status, 404, 'Khách A gửi tin vào /conversations/:convBId/messages phải nhận 404');

  // 5. Khách A cố gửi tin nhắn vào hội thoại của Khách B qua body { conversationId: convBId }
  const postByBodyRes = await fetch(`${baseUrl}/api/chat/conversations/me/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: customerACookie,
    },
    body: JSON.stringify({
      conversationId: convBId,
      content: 'Khách A truyền conversationId của Khách B trong body',
    }),
  });
  assert.equal(postByBodyRes.status, 404, 'Khách A gửi conversationId của Khách B trong body phải nhận 404');

  // 6. Khách A cố đánh dấu đã đọc hội thoại của Khách B
  const markReadRes = await fetch(`${baseUrl}/api/chat/conversations/${convBId}/read`, {
    method: 'POST',
    headers: { Cookie: customerACookie },
  });
  assert.equal(markReadRes.status, 404, 'Khách A gọi /conversations/:convBId/read phải nhận 404');
});

// ============================================================================
// 3. KHÁCH GỌI API ADMIN TRẢ 403
// ============================================================================
test('Stage 6d.3: Khách hàng thường gọi các API quản trị hỏi đáp (/api/admin/chats*) nhận 403 FORBIDDEN', async () => {
  const fakeId = '00000000-0000-4000-8000-000000000001';
  const adminEndpoints: { method: string; path: string; body?: any }[] = [
    { method: 'GET', path: '/api/admin/chats' },
    { method: 'GET', path: `/api/admin/chats/${fakeId}/messages` },
    { method: 'POST', path: `/api/admin/chats/${fakeId}/messages`, body: { content: 'Hack reply' } },
    { method: 'PATCH', path: `/api/admin/chats/${fakeId}/status`, body: { status: 'closed' } },
  ];

  for (const ep of adminEndpoints) {
    const res = await fetch(`${baseUrl}${ep.path}`, {
      method: ep.method,
      headers: {
        Cookie: customerACookie,
        ...(ep.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: ep.body ? JSON.stringify(ep.body) : undefined,
    });
    assert.equal(
      res.status,
      403,
      `Khách hàng thường gọi ${ep.method} ${ep.path} phải nhận 403 (thực tế: ${res.status})`
    );
  }
});

// ============================================================================
// 4. TỪ CHỐI TIN RỖNG & ĐÍNH KÈM TỆP
// ============================================================================
test('Stage 6d.4: Từ chối tin nhắn rỗng hoặc chỉ chứa khoảng trắng (400 EMPTY_CHAT_MESSAGE) và từ chối đính kèm tệp/ảnh (400 CHAT_ATTACHMENT_FORBIDDEN)', async () => {
  resetSellerChatRateLimitForTest();

  const emptyRes = await fetch(`${baseUrl}/api/chat/conversations/me/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: customerACookie,
    },
    body: JSON.stringify({ content: '    \n\t   ' }),
  });
  assert.equal(emptyRes.status, 400);
  const emptyBody = await emptyRes.json();
  assert.equal(emptyBody.code, 'EMPTY_CHAT_MESSAGE');

  const attachmentRes = await fetch(`${baseUrl}/api/chat/conversations/me/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: customerACookie,
    },
    body: JSON.stringify({
      content: 'Đính kèm ảnh',
      attachments: ['https://example.com/file.png'],
    }),
  });
  assert.equal(attachmentRes.status, 400);
  const attachmentBody = await attachmentRes.json();
  assert.equal(attachmentBody.code, 'CHAT_ATTACHMENT_FORBIDDEN');
});

// ============================================================================
// 5. TỪ CHỐI TIN DÀI QUÁ 1000 KÝ TỰ
// ============================================================================
test('Stage 6d.5: Từ chối tin nhắn dài quá 1000 ký tự (400 CHAT_MESSAGE_TOO_LONG)', async () => {
  resetSellerChatRateLimitForTest();

  const over1000 = 'A'.repeat(1001);
  const res = await fetch(`${baseUrl}/api/chat/conversations/me/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: customerACookie,
    },
    body: JSON.stringify({ content: over1000 }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'CHAT_MESSAGE_TOO_LONG');
});

// ============================================================================
// 6. TỪ CHỐI VƯỢT TRẦN 500 TIN MỖI HỘI THOẠI
// ============================================================================
test('Stage 6d.6: Từ chối gửi thêm tin nhắn khi hội thoại đã đạt trần 500 tin nhắn (400 CHAT_CONVERSATION_MESSAGE_LIMIT), tự động đóng hội thoại cũ và cho phép bắt đầu hội thoại mới không mang theo tin cũ', async () => {
  resetSellerChatRateLimitForTest();

  // Tạo một khách hàng tạm để kiểm tra trần 500 tin nhắn
  const limitUserRows = await queryRows<{ id: string; email: string }>(sql`
    INSERT INTO users (email, password_hash, full_name, phone, role)
    VALUES ('customer_limit500_6d@baity.vn', 'hashed', 'Khách Trần 500 Tin', '0977000500', 'customer')
    ON CONFLICT (email) DO UPDATE SET full_name = 'Khách Trần 500 Tin'
    RETURNING id, email;
  `);
  const limitUserId = limitUserRows[0].id;
  const limitCookie = `${AUTH_COOKIE_NAME}=${generateToken({
    id: limitUserId,
    email: limitUserRows[0].email,
    role: 'customer',
  })}`;

  const createRes = await fetch(`${baseUrl}/api/chat/conversations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: limitCookie,
    },
    body: JSON.stringify({}),
  });
  assert.equal(createRes.status, 200);
  const convId = (await createRes.json()).conversation.id;

  // Chèn đủ 500 tin nhắn vào hội thoại này trong CSDL
  await queryRows(sql`
    INSERT INTO chat_messages (conversation_id, sender_type, content, created_at)
    SELECT
      ${convId}::uuid,
      'user',
      'Tin nhắn thứ ' || gs::text,
      NOW() + (gs * INTERVAL '1 millisecond')
    FROM generate_series(1, 500) AS gs;
  `);

  // 1. Gửi tin nhắn thứ 501 qua API -> phải nhận 400 CHAT_CONVERSATION_MESSAGE_LIMIT và tự động đóng hội thoại cũ
  const msg501Res = await fetch(`${baseUrl}/api/chat/conversations/me/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: limitCookie,
    },
    body: JSON.stringify({ content: 'Tin nhắn thứ 501 vượt trần' }),
  });
  assert.equal(msg501Res.status, 400);
  const msg501Body = await msg501Res.json();
  assert.equal(msg501Body.code, 'CHAT_CONVERSATION_MESSAGE_LIMIT');
  assert.equal(msg501Body.conversationAutoClosed, true);

  // Kiểm tra hội thoại cũ đã được tự động chuyển sang status = 'closed'
  const oldConvCheck = await queryRows<{ status: string; closed_at: string | null }>(sql`
    SELECT status, closed_at FROM chat_conversations WHERE id = ${convId}::uuid;
  `);
  assert.equal(oldConvCheck[0]?.status, 'closed', 'Hội thoại chạm trần 500 tin nhắn phải tự động chuyển sang closed');
  assert.ok(oldConvCheck[0]?.closed_at, 'Hội thoại tự đóng khi chạm trần phải có closed_at');

  // Admin gửi tin nhắn thứ 501 vào hội thoại cũ này cũng bị chặn 400
  const admin501Res = await fetch(`${baseUrl}/api/admin/chats/${convId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie,
    },
    body: JSON.stringify({ content: 'Admin trả lời tin thứ 501' }),
  });
  assert.equal(admin501Res.status, 400);

  // 2. Khách hàng gửi tin nhắn tiếp theo (hoặc bắt đầu hội thoại mới) -> tạo hội thoại mới tinh, tin đầu tiên KHÔNG mang theo 500 tin cũ
  const freshMsgRes = await fetch(`${baseUrl}/api/chat/conversations/me/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: limitCookie,
    },
    body: JSON.stringify({ content: 'Tin nhắn đầu tiên ở hội thoại mới' }),
  });
  assert.equal(freshMsgRes.status, 201);
  const freshMsgBody = await freshMsgRes.json();
  const newConvId = freshMsgBody.conversation.id as string;
  assert.notEqual(newConvId, convId, 'Phải tạo một hội thoại mở mới có ID khác hội thoại cũ đã chạm trần 500 tin');
  assert.equal(freshMsgBody.conversation.status, 'open');

  // Kiểm tra GET /api/chat/conversations/me chỉ trả về hội thoại mới với đúng 1 tin nhắn mới (không mang theo 500 tin cũ)
  const meAfterNewRes = await fetch(`${baseUrl}/api/chat/conversations/me`, {
    headers: { Cookie: limitCookie },
  });
  assert.equal(meAfterNewRes.status, 200);
  const meAfterNewBody = await meAfterNewRes.json();
  assert.equal(meAfterNewBody.conversation.id, newConvId);
  assert.equal(meAfterNewBody.messages.length, 1, 'Hội thoại mới chỉ được chứa đúng 1 tin nhắn đầu tiên, không mang theo 500 tin cũ');
  assert.equal(meAfterNewBody.messages[0].content, 'Tin nhắn đầu tiên ở hội thoại mới');
});

// ============================================================================
// 7. GIỚI HẠN TẦN SUẤT 20 TIN / 10 PHÚT / NGƯỜI DÙNG
// ============================================================================
test('Stage 6d.7: Giới hạn tần suất gửi tin nhắn (20 tin / 10 phút / người dùng) — tin thứ 21 trả 429 SELLER_CHAT_RATE_LIMIT_EXCEEDED kèm header Retry-After', async () => {
  resetSellerChatRateLimitForTest();

  for (let i = 1; i <= 20; i++) {
    const okRes = await fetch(`${baseUrl}/api/chat/conversations/me/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: customerBCookie,
      },
      body: JSON.stringify({ content: `Tin nhắn kiểm tra tốc độ thứ ${i}/20` }),
    });
    assert.equal(okRes.status, 201, `Tin nhắn thứ ${i}/20 phải thành công 201`);
  }

  const rateLimitedRes = await fetch(`${baseUrl}/api/chat/conversations/me/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: customerBCookie,
    },
    body: JSON.stringify({ content: 'Tin nhắn thứ 21 vượt giới hạn 10 phút' }),
  });
  assert.equal(rateLimitedRes.status, 429, 'Tin nhắn thứ 21 trong 10 phút phải trả 429');
  assert.ok(
    Number(rateLimitedRes.headers.get('retry-after') || 0) >= 1,
    'Phản hồi 429 phải có header Retry-After >= 1 giây'
  );
  const errBody = await rateLimitedRes.json();
  assert.equal(errBody.code, 'SELLER_CHAT_RATE_LIMIT_EXCEEDED');

  resetSellerChatRateLimitForTest();
});

// ============================================================================
// 8. MỘT HỘI THOẠI MỞ DUY NHẤT KHI TẠO ĐỒNG THỜI BẰNG PROMISE.ALL
// ============================================================================
test('Stage 6d.8: Tạo hội thoại đồng thời bằng Promise.all vẫn chỉ sinh duy nhất 1 hội thoại mở cho mỗi khách hàng', async () => {
  const parallelUserRows = await queryRows<{ id: string; email: string }>(sql`
    INSERT INTO users (email, password_hash, full_name, phone, role)
    VALUES ('customer_parallel_6d@baity.vn', 'hashed', 'Khách Tạo Song Song', '0988777666', 'customer')
    ON CONFLICT (email) DO UPDATE SET full_name = 'Khách Tạo Song Song'
    RETURNING id, email;
  `);
  const parallelUserId = parallelUserRows[0].id;
  const parallelCookie = `${AUTH_COOKIE_NAME}=${generateToken({
    id: parallelUserId,
    email: parallelUserRows[0].email,
    role: 'customer',
  })}`;

  await queryRows(sql`DELETE FROM chat_conversations WHERE user_id = ${parallelUserId}::uuid;`);

  const responses = await Promise.all(
    Array.from({ length: 6 }, () =>
      fetch(`${baseUrl}/api/chat/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: parallelCookie,
        },
        body: JSON.stringify({}),
      })
    )
  );

  const ids = new Set<string>();
  for (const r of responses) {
    assert.equal(r.status, 200);
    const b = await r.json();
    ids.add(b.conversation.id);
  }
  assert.equal(ids.size, 1, '6 lệnh POST /api/chat/conversations song song chỉ được trả về đúng 1 ID hội thoại mở');

  const dbOpenRows = await queryRows<{ cnt: number }>(sql`
    SELECT COUNT(*)::int AS cnt
    FROM chat_conversations
    WHERE user_id = ${parallelUserId}::uuid AND status = 'open';
  `);
  assert.equal(dbOpenRows[0].cnt, 1, 'Trong CSDL chỉ được có đúng 1 dòng status = open cho khách hàng');
});

// ============================================================================
// 9. ADMIN TRẢ LỜI & KHÁCH NHẬN ĐƯỢC QUA POLLING (?after=<id>) & ĐÁNH DẤU ĐÃ ĐỌC
// ============================================================================
test('Stage 6d.9: Admin trả lời qua POST /api/admin/chats/:id/messages và khách nhận được tin nhắn mới qua polling GET /api/chat/conversations/me?after=<id>, kèm đánh dấu đã đọc POST /api/chat/conversations/me/read', async () => {
  resetSellerChatRateLimitForTest();

  // 1. Khách A gửi tin nhắn hỏi sản phẩm
  const custMsgRes = await fetch(`${baseUrl}/api/chat/conversations/me/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: customerACookie,
    },
    body: JSON.stringify({ content: 'Shop ơi áo blazer đen còn size L không ạ?' }),
  });
  assert.equal(custMsgRes.status, 201);
  const custMsgBody = await custMsgRes.json();
  const convAId = custMsgBody.conversation.id as string;
  const firstMsgId = custMsgBody.message.id as string;
  assert.equal(custMsgBody.conversation.unreadAdmin, 1);
  assert.equal(custMsgBody.conversation.waitingForReply, true);

  // 2. Kiểm tra GET /api/admin/overview phản ánh số hội thoại chưa trả lời (unrepliedChats >= 1)
  const overviewRes = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(overviewRes.status, 200);
  const overviewBody = await overviewRes.json();
  assert.ok(
    Number(overviewBody.overview.unrepliedChats) >= 1,
    'Tổng quan vận hành phải đếm được hội thoại chưa trả lời (unrepliedChats >= 1)'
  );

  // 3. Admin trả lời vào hội thoại của Khách A
  const adminReplyRes = await fetch(`${baseUrl}/api/admin/chats/${convAId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie,
    },
    body: JSON.stringify({ content: 'Dạ chào bạn, mẫu Blazer đen hiện còn sẵn 5 chiếc size L ạ!' }),
  });
  assert.equal(adminReplyRes.status, 201);
  const adminReplyBody = await adminReplyRes.json();
  assert.equal(adminReplyBody.message.senderType, 'admin');
  assert.equal(adminReplyBody.conversation.unreadAdmin, 0);
  assert.equal(adminReplyBody.conversation.unreadUser, 1);

  // 4. Khách A gọi polling GET /api/chat/conversations/me?after=<firstMsgId>
  const pollRes = await fetch(
    `${baseUrl}/api/chat/conversations/me?after=${encodeURIComponent(firstMsgId)}`,
    { headers: { Cookie: customerACookie } }
  );
  assert.equal(pollRes.status, 200);
  const pollBody = await pollRes.json();
  assert.equal(
    pollBody.messages.length,
    1,
    'Polling với ?after=<firstMsgId> phải trả về đúng 1 tin nhắn phản hồi mới từ Admin'
  );
  assert.equal(pollBody.messages[0].id, adminReplyBody.message.id);
  assert.equal(pollBody.messages[0].senderType, 'admin');
  assert.equal(
    pollBody.messages[0].content,
    'Dạ chào bạn, mẫu Blazer đen hiện còn sẵn 5 chiếc size L ạ!'
  );
  assert.equal(pollBody.conversation.unreadUser, 1);

  // 5. Khách A đánh dấu đã đọc qua POST /api/chat/conversations/me/read
  const readRes = await fetch(`${baseUrl}/api/chat/conversations/me/read`, {
    method: 'POST',
    headers: { Cookie: customerACookie },
  });
  assert.equal(readRes.status, 200);
  const readBody = await readRes.json();
  assert.equal(readBody.conversation.unreadUser, 0);
  assert.ok(readBody.conversation.userLastReadAt);
});

// ============================================================================
// 10. HỘI THOẠI ĐÃ ĐÓNG TỰ MỞ LẠI KHI KHÁCH NHẮN TIN MỚI + AUDIT LOG
// ============================================================================
test('Stage 6d.10: Admin đóng hội thoại (PATCH /api/admin/chats/:id/status ghi audit log trong cùng giao dịch); khách nhắn tin mới vào hội thoại đã đóng sẽ tự động mở lại (status = open, closed_at = null)', async () => {
  resetSellerChatRateLimitForTest();

  const meRes = await fetch(`${baseUrl}/api/chat/conversations/me`, {
    headers: { Cookie: customerACookie },
  });
  const convAId = (await meRes.json()).conversation.id as string;

  // 1. Admin đóng hội thoại
  const closeRes = await fetch(`${baseUrl}/api/admin/chats/${convAId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie,
    },
    body: JSON.stringify({ status: 'closed' }),
  });
  assert.equal(closeRes.status, 200);
  const closeBody = await closeRes.json();
  assert.equal(closeBody.conversation.status, 'closed');
  assert.ok(closeBody.conversation.closedAt, 'Khi đóng hội thoại phải ghi nhận closedAt');
  assert.ok(closeBody.auditLogId, 'Đóng hội thoại phải ghi nhận admin_audit_logs trong cùng giao dịch');

  const auditRows = await queryRows<{ action: string; target_id: string }>(sql`
    SELECT action, target_id FROM admin_audit_logs WHERE id = ${closeBody.auditLogId}::uuid;
  `);
  assert.equal(auditRows[0]?.action, 'SELLER_CHAT_CLOSE');
  assert.equal(auditRows[0]?.target_id, convAId);

  // 2. Khách A gửi tin nhắn mới vào hội thoại đã đóng -> tự động mở lại
  const reopenByMsgRes = await fetch(`${baseUrl}/api/chat/conversations/me/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: customerACookie,
    },
    body: JSON.stringify({ content: 'Cho mình hỏi thêm về cách giặt áo blazer nhé!' }),
  });
  assert.equal(reopenByMsgRes.status, 201);
  const reopenBody = await reopenByMsgRes.json();
  assert.equal(reopenBody.conversation.id, convAId, 'Phải mở lại chính hội thoại cũ');
  assert.equal(
    reopenBody.conversation.status,
    'open',
    'Khách nhắn tin vào hội thoại đã đóng phải tự động chuyển status về open'
  );
  assert.equal(
    reopenBody.conversation.closedAt,
    null,
    'Khi tự động mở lại hội thoại, closedAt phải về null'
  );
});

// ============================================================================
// 11. CHAT VỚI NGƯỜI BÁN KHÔNG GỌI GEMINI VÀ KHÔNG LOG NỘI DUNG TIN NHẮN
// ============================================================================
test('Stage 6d.11: Chat với người bán tuyệt đối KHÔNG gọi Gemini và KHÔNG ghi nội dung tin nhắn ra console log', async () => {
  resetSellerChatRateLimitForTest();

  let geminiCalls = 0;
  setChatbotGeminiGeneratorForTest(async () => {
    geminiCalls += 1;
    return { text: 'Không bao giờ được gọi' };
  });

  const capturedLogs: string[] = [];
  const origLog = console.log;
  const origInfo = console.info;
  const origWarn = console.warn;
  const origError = console.error;

  const intercept = (...args: any[]) => {
    capturedLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  console.log = intercept;
  console.info = intercept;
  console.warn = intercept;
  console.error = intercept;

  const secretCanaryMessage = 'CANARY_SELLER_CHAT_DO_NOT_LOG_99887766';
  const secretAdminReply = 'CANARY_ADMIN_REPLY_DO_NOT_LOG_11223344';

  try {
    const sendRes = await fetch(`${baseUrl}/api/chat/conversations/me/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: customerACookie,
      },
      body: JSON.stringify({ content: secretCanaryMessage }),
    });
    assert.equal(sendRes.status, 201);
    const sendBody = await sendRes.json();
    const convId = sendBody.conversation.id;

    const replyRes = await fetch(`${baseUrl}/api/admin/chats/${convId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie,
      },
      body: JSON.stringify({ content: secretAdminReply }),
    });
    assert.equal(replyRes.status, 201);
  } finally {
    console.log = origLog;
    console.info = origInfo;
    console.warn = origWarn;
    console.error = origError;
    setChatbotGeminiGeneratorForTest(null);
  }

  assert.equal(geminiCalls, 0, 'Chat với người bán tuyệt đối KHÔNG được gọi Gemini API');
  const combinedLogs = capturedLogs.join('\n');
  assert.equal(
    combinedLogs.includes(secretCanaryMessage),
    false,
    'Console log tuyệt đối không được chứa nội dung tin nhắn của khách hàng'
  );
  assert.equal(
    combinedLogs.includes(secretAdminReply),
    false,
    'Console log tuyệt đối không được chứa nội dung tin nhắn trả lời của Admin'
  );
});

// ============================================================================
// 12. CRON XÓA HỘI THOẠI ĐÃ ĐÓNG QUÁ 180 NGÀY & CASCADE KHI XÓA TÀI KHOẢN
// ============================================================================
test('Stage 6d.12: Tác vụ dọn dẹp định kỳ (POST /api/tasks/cron-cleanup) tự động xóa hội thoại đã đóng quá 180 ngày (giữ nguyên hội thoại đang mở và hội thoại đóng chưa tới 180 ngày); xóa tài khoản khách hàng tự động xóa hội thoại theo ON DELETE CASCADE', async () => {
  // 1. Tạo 2 khách tạm: 1 khách có hội thoại đã đóng 185 ngày trước, 1 khách có hội thoại đã đóng 30 ngày trước
  const oldUserRows = await queryRows<{ id: string }>(sql`
    INSERT INTO users (email, password_hash, full_name, phone, role)
    VALUES ('old_closed_chat_185d@baity.vn', 'hashed', 'Khách Đóng 185 Ngày', '0900185185', 'customer')
    RETURNING id;
  `);
  const recentUserRows = await queryRows<{ id: string }>(sql`
    INSERT INTO users (email, password_hash, full_name, phone, role)
    VALUES ('recent_closed_chat_30d@baity.vn', 'hashed', 'Khách Đóng 30 Ngày', '0900030030', 'customer')
    RETURNING id;
  `);

  const oldConvRows = await queryRows<{ id: string }>(sql`
    INSERT INTO chat_conversations (user_id, mode, status, closed_at, updated_at)
    VALUES (
      ${oldUserRows[0].id}::uuid,
      'human',
      'closed',
      NOW() - INTERVAL '185 days',
      NOW() - INTERVAL '185 days'
    )
    RETURNING id;
  `);
  const oldConvId = oldConvRows[0].id;
  await queryRows(sql`
    INSERT INTO chat_messages (conversation_id, sender_type, content)
    VALUES (${oldConvId}::uuid, 'user', 'Tin nhắn cũ hơn 180 ngày');
  `);

  const recentConvRows = await queryRows<{ id: string }>(sql`
    INSERT INTO chat_conversations (user_id, mode, status, closed_at, updated_at)
    VALUES (
      ${recentUserRows[0].id}::uuid,
      'human',
      'closed',
      NOW() - INTERVAL '30 days',
      NOW() - INTERVAL '30 days'
    )
    RETURNING id;
  `);
  const recentConvId = recentConvRows[0].id;

  // 2. Gọi POST /api/tasks/cron-cleanup
  const cronSecret = process.env.CRON_SECRET_KEY || 'baity-cron-secret-token-key-2026';
  const cronRes = await fetch(`${baseUrl}/api/tasks/cron-cleanup`, {
    method: 'POST',
    headers: { 'x-cron-secret': cronSecret },
  });
  assert.equal(cronRes.status, 200);
  const cronBody = await cronRes.json();
  assert.ok(
    Number(cronBody.deletedClosedSellerChatsCount) >= 1,
    'Cron cleanup phải xóa ít nhất 1 hội thoại đã đóng quá 180 ngày'
  );

  // Kiểm tra hội thoại 185 ngày cùng tin nhắn của nó đã bị xóa
  const checkOldConv = await queryRows(sql`
    SELECT id FROM chat_conversations WHERE id = ${oldConvId}::uuid;
  `);
  assert.equal(checkOldConv.length, 0, 'Hội thoại đóng 185 ngày trước phải bị xóa');

  const checkOldMsg = await queryRows(sql`
    SELECT id FROM chat_messages WHERE conversation_id = ${oldConvId}::uuid;
  `);
  assert.equal(checkOldMsg.length, 0, 'Tin nhắn thuộc hội thoại đóng > 180 ngày phải bị xóa theo CASCADE');

  // Kiểm tra hội thoại đóng 30 ngày trước vẫn được giữ nguyên
  const checkRecentConv = await queryRows(sql`
    SELECT id FROM chat_conversations WHERE id = ${recentConvId}::uuid;
  `);
  assert.equal(checkRecentConv.length, 1, 'Hội thoại đóng 30 ngày trước chưa tới hạn 180 ngày phải được giữ nguyên');

  // 3. Kiểm tra xóa tài khoản người dùng sẽ xóa hội thoại theo ON DELETE CASCADE
  await queryRows(sql`DELETE FROM users WHERE id = ${recentUserRows[0].id}::uuid;`);
  const checkAfterUserDelete = await queryRows(sql`
    SELECT id FROM chat_conversations WHERE id = ${recentConvId}::uuid;
  `);
  assert.equal(
    checkAfterUserDelete.length,
    0,
    'Khi xóa tài khoản người dùng, hội thoại của người đó phải tự động xóa theo ON DELETE CASCADE'
  );
});

// ============================================================================
// 13. KHÔNG CÓ PII TRONG DANH SÁCH CHAT ADMIN
// ============================================================================
test('Stage 6d.13: Danh sách hội thoại Admin (GET /api/admin/chats) chỉ trả tên hiển thị rút gọn, tuyệt đối KHÔNG chứa email, số điện thoại hay địa chỉ của khách hàng', async () => {
  const res = await fetch(`${baseUrl}/api/admin/chats?status=all`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(res.status, 200);
  const rawText = await res.text();
  const body = JSON.parse(rawText);

  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.items) && body.items.length >= 1);

  // Kiểm tra tên hiển thị đã được rút gọn (ví dụ "Nguyễn Văn An" -> "Nguyễn *** An")
  const itemA = body.items.find((it: any) => it.customerDisplayName === 'Nguyễn *** An');
  assert.ok(itemA, 'Danh sách hội thoại Admin phải hiển thị tên rút gọn Nguyễn *** An');

  // Tuyệt đối không chứa họ tên đầy đủ, email, SĐT, địa chỉ
  assert.equal(
    rawText.includes('customer_a_6d_secret@baity.vn'),
    false,
    'Phản hồi GET /api/admin/chats tuyệt đối không được chứa email khách hàng'
  );
  assert.equal(
    rawText.includes('0911222333'),
    false,
    'Phản hồi GET /api/admin/chats tuyệt đối không được chứa số điện thoại khách hàng'
  );
  assert.equal(
    rawText.includes('999 Đường Bí Mật Tuyệt Đối'),
    false,
    'Phản hồi GET /api/admin/chats tuyệt đối không được chứa địa chỉ khách hàng'
  );
  assert.equal(
    rawText.includes('Nguyễn Văn An'),
    false,
    'Phản hồi GET /api/admin/chats không được trả họ tên đầy đủ chưa rút gọn'
  );
});

// ============================================================================
// 14. HIỂN THỊ VĂN BẢN THUẦN CHỐNG XSS (<script>) & CẢNH BÁO TRONG KHUNG CHAT
// ============================================================================
test('Stage 6d.14: Nội dung chứa thẻ <script> được lưu nguyên bản (chỉ cắt khoảng trắng hai đầu, không cắt thẻ HTML) và luôn hiển thị dưới dạng văn bản thuần (escaped trong giao diện SellerChatPanel & SellerChatsAdminPage, không thực thi mã độc); cảnh báo nhạy cảm hiển thị rõ ràng', async () => {
  resetSellerChatRateLimitForTest();

  const xssPayload = '<script>window.__xssExecuted = true;</script><img src=x onerror=alert(1)>';
  const sendRes = await fetch(`${baseUrl}/api/chat/conversations/me/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: customerACookie,
    },
    body: JSON.stringify({ content: `   ${xssPayload}   ` }),
  });
  assert.equal(sendRes.status, 201);
  const sendBody = await sendRes.json();

  // Xác minh nội dung lưu nguyên bản đã cắt khoảng trắng hai đầu (KHÔNG cắt thẻ HTML khi lưu)
  assert.equal(
    sendBody.message.content,
    xssPayload,
    'API phải trả về đúng chuỗi văn bản thô đã cắt khoảng trắng hai đầu (không tự ý xóa thẻ HTML khi lưu)'
  );
  const dbRows = await queryRows<{ content: string }>(sql`
    SELECT content FROM chat_messages WHERE id = ${sendBody.message.id}::uuid;
  `);
  assert.equal(
    dbRows[0]?.content,
    xssPayload,
    'Cột chat_messages.content trong CSDL phải lưu nguyên văn chuỗi đã cắt khoảng trắng hai đầu'
  );

  // Kiểm tra render React component: ChatbotWidget (mở tab seller), SellerChatPanel, SellerChatsAdminPage
  const widgetUnauthHtml = renderToStaticMarkup(
    React.createElement(ChatbotWidget, {
      onSelectProductSlug: () => {},
      isAuthenticated: false,
      initialOpen: true,
      initialMode: 'seller',
    })
  );
  assert.ok(
    widgetUnauthHtml.includes('Đăng nhập để chat trực tiếp với người bán'),
    'Khi chưa đăng nhập mở tab Chat với người bán phải hiện lời nhắc đăng nhập'
  );

  const panelAuthHtml = renderToStaticMarkup(
    React.createElement(SellerChatPanel, {
      isOpen: true,
      isAuthenticated: true,
    })
  );
  assert.ok(
    panelAuthHtml.includes('Tuyệt đối không nhập mật khẩu, mã OTP, số thẻ ngân hàng'),
    'Khung chat của khách hàng phải hiển thị cảnh báo không nhập mật khẩu, OTP, số thẻ, CCCD'
  );

  const adminPageHtml = renderToStaticMarkup(
    React.createElement(SellerChatsAdminPage, {
      initialFilter: 'unreplied',
    })
  );
  assert.ok(
    adminPageHtml.includes('Hỏi đáp với Khách hàng'),
    'Trang SellerChatsAdminPage phải render tiêu đề Hỏi đáp với Khách hàng'
  );

  // Kiểm tra render một phần tử tin nhắn chứa chuỗi <script> bằng cùng cấu trúc JSX văn bản thuần của SellerChatPanel
  const msgBubbleHtml = renderToStaticMarkup(
    React.createElement('p', { className: 'whitespace-pre-wrap break-words' }, xssPayload)
  );
  assert.equal(
    msgBubbleHtml.includes('<script>'),
    false,
    'Chuỗi <script> phải được React escape thành &lt;script&gt;, tuyệt đối không sinh thẻ <script> thật'
  );
  assert.equal(
    msgBubbleHtml.includes('&lt;script&gt;window.__xssExecuted = true;&lt;/script&gt;'),
    true,
    'Chuỗi <script> phải hiển thị nguyên văn dưới dạng văn bản thuần đã escape'
  );
});
