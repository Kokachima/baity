import 'dotenv/config';
import { initDatabase } from '../server/db/init.ts';
import { closeDb } from '../server/db/index.ts';
import {
  getChatbotModelName,
  generateChatbotResponse,
} from '../server/services/chatbot.ts';
import { isStrictRuntimeMode } from '../server/config/runtimeMode.ts';

async function runChatSmoke() {
  const args = process.argv.slice(2);
  if (!args.includes('--live')) {
    console.error('[chat:smoke] Từ chối thực thi: Bắt buộc truyền cờ --live để gọi Gemini thật (npm run chat:smoke -- --live).');
    process.exit(1);
  }

  if (isStrictRuntimeMode()) {
    console.error('[chat:smoke] Từ chối thực thi: Không được chạy script kiểm thử thủ công trong môi trường production.');
    process.exit(1);
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    console.error('[chat:smoke] THẤT BẠI | code=MISSING_GEMINI_API_KEY | Chưa cấu hình GEMINI_API_KEY hợp lệ.');
    process.exit(1);
  }

  const model = getChatbotModelName();
  const productQuestion =
    'Chào Baity Fashion, tư vấn giúp mình mẫu áo sơ mi Oxford nam đang có tại cửa hàng và chính sách đổi trả ngắn gọn?';

  try {
    await initDatabase();
    const startedAtMs = Date.now();
    const res = await generateChatbotResponse({
      message: productQuestion,
      actorKey: 'ip:127.0.0.1',
    });
    const elapsedMs = res.latencyMs ?? Date.now() - startedAtMs;

    if (!res.ok) {
      console.error(
        `[chat:smoke] THẤT BẠI | model=${model} | code=${res.code || 'ERROR'} | status=${res.status} | latencyMs=${elapsedMs}`
      );
      await closeDb().catch(() => {});
      process.exit(1);
    }

    const text = (res.reply || '').trim();
    if (!text) {
      console.error(`[chat:smoke] THẤT BẠI | model=${model} | code=EMPTY_RESPONSE | latencyMs=${elapsedMs}`);
      await closeDb().catch(() => {});
      process.exit(1);
    }

    console.log(
      `[chat:smoke] THÀNH CÔNG | model=${model} | status=OK | latencyMs=${elapsedMs} | contextChars=${res.contextChars || 0} | recommendedProducts=${res.recommendedProducts.length} | replyLength=${text.length}`
    );
    await closeDb().catch(() => {});
    process.exit(0);
  } catch (err: any) {
    const status = err?.status || err?.statusCode || err?.code || 'UNKNOWN_ERROR';
    const rawMsg = String(err?.message || 'Unknown error');
    const safeMsg = apiKey ? rawMsg.split(apiKey).join('[REDACTED]') : rawMsg;
    console.error(
      `[chat:smoke] THẤT BẠI | model=${model} | code=${status} | reason=${safeMsg.slice(0, 180)}`
    );
    await closeDb().catch(() => {});
    process.exit(1);
  }
}

runChatSmoke();
