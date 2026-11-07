import 'dotenv/config';
import sharp from 'sharp';
import { initDatabase } from '../server/db/init.ts';
import { closeDb } from '../server/db/index.ts';
import {
  resolveVisualSearchModelName,
  performVisualSearch,
  setVisualSearchGeminiClientForTest,
} from '../server/services/visualSearch.ts';
import { isStrictRuntimeMode } from '../server/config/runtimeMode.ts';

async function runVisualSmoke() {
  const args = process.argv.slice(2);
  if (!args.includes('--live')) {
    console.error(
      '❌ Lỗi: Script kiểm tra thật (visual:smoke) bắt buộc phải có cờ --live (ví dụ: npm run visual:smoke -- --live).'
    );
    process.exit(1);
  }

  if (isStrictRuntimeMode()) {
    console.error('❌ Từ chối thực thi: Không được chạy visual:smoke ở môi trường Production.');
    process.exit(1);
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    console.error('❌ Thất bại: Biến môi trường GEMINI_API_KEY chưa được cấu hình (code=MISSING_KEY).');
    process.exit(1);
  }

  const model = resolveVisualSearchModelName();
  // Đảm bảo gọi Gemini THẬT (tắt mọi mock)
  setVisualSearchGeminiClientForTest(null);

  try {
    await initDatabase();

    // Tạo ảnh mẫu áo sơ mi màu xanh navy có cổ và tay áo bằng SVG -> JPEG qua sharp
    const sampleClothingSvg = `
      <svg width="400" height="500" viewBox="0 0 400 500" xmlns="http://www.w3.org/2000/svg">
        <rect width="400" height="500" fill="#F5F2EB"/>
        <path d="M110 90 L160 70 L200 105 L240 70 L290 90 L350 180 L300 210 L280 160 L280 430 L120 430 L120 160 L100 210 L50 180 Z" fill="#1E293B" stroke="#0F172A" stroke-width="4"/>
        <line x1="200" y1="105" x2="200" y2="430" stroke="#334155" stroke-width="3"/>
        <circle cx="200" cy="150" r="4" fill="#E2E8F0"/>
        <circle cx="200" cy="210" r="4" fill="#E2E8F0"/>
        <circle cx="200" cy="270" r="4" fill="#E2E8F0"/>
        <circle cx="200" cy="330" r="4" fill="#E2E8F0"/>
      </svg>
    `;

    const jpegBuffer = await sharp(Buffer.from(sampleClothingSvg))
      .jpeg({ quality: 88 })
      .toBuffer();
    const dataUrl = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;

    const startedAt = Date.now();
    const res = await performVisualSearch({
      rawImage: dataUrl,
      userId: null,
      clientIp: '127.0.0.1',
    });
    const elapsedMs = Date.now() - startedAt;

    await closeDb().catch(() => {});

    if (res.statusCode === 200 && res.body.success && !res.body.fallback) {
      const attrs = res.body.recognizedAttributes;
      console.log(
        `[VISUAL_SMOKE] status=SUCCESS model=${model} latencyMs=${res.body.latencyMs ?? elapsedMs} isApparel=${Boolean(
          attrs?.isApparel
        )} confidence=${attrs?.confidence ?? 0} category=${attrs?.categorySlug || 'none'} primaryColor=${
          attrs?.primaryColor || 'none'
        } matchedProducts=${res.body.products.length}`
      );
      process.exit(0);
    } else {
      console.error(
        `[VISUAL_SMOKE] status=FAILED model=${model} latencyMs=${elapsedMs} httpStatus=${res.statusCode} code=${
          res.body.fallbackCode || 'UNKNOWN'
        }`
      );
      process.exit(1);
    }
  } catch (err: any) {
    const code = err?.status || err?.code || err?.name || 'UNKNOWN_ERROR';
    console.error(`[VISUAL_SMOKE] status=ERROR model=${model} code=${code}`);
    await closeDb().catch(() => {});
    process.exit(1);
  }
}

runVisualSmoke();
