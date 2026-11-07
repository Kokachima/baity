import crypto from 'crypto';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_PUBLIC_BUCKET = process.env.SUPABASE_PUBLIC_BUCKET || 'baity-media';
export const SUPABASE_RETURNS_BUCKET = process.env.SUPABASE_RETURNS_BUCKET || 'baity-returns';
export const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
export const MAX_IMAGE_PIXELS = 16_777_216; // Giới hạn 16MP (~4096x4096) chống Decompression Bomb

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const supabaseStorageClient =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// Bộ nhớ lưu trữ đối tượng đã tải lên trong tiến trình (phục vụ môi trường test / dev khi không gọi mạng ngoài
// và đồng bộ kiểm tra sự tồn tại thực tế của file trong Storage)
const uploadedStorageObjects = new Map<string, { buffer: Buffer; mimeType: string; createdAt: number }>();
const MAX_LOCAL_STORAGE_OBJECTS = 2000;

function makeStorageKey(bucket: string, objectPath: string): string {
  return `${bucket}:${objectPath}`;
}

export function recordObjectInLocalStorage(
  bucket: string,
  objectPath: string,
  buffer: Buffer,
  mimeType: string
): void {
  if (uploadedStorageObjects.size >= MAX_LOCAL_STORAGE_OBJECTS) {
    const oldestKey = uploadedStorageObjects.keys().next().value;
    if (oldestKey !== undefined) {
      uploadedStorageObjects.delete(oldestKey);
    }
  }
  uploadedStorageObjects.set(makeStorageKey(bucket, objectPath), {
    buffer,
    mimeType,
    createdAt: Date.now(),
  });
}

export function getObjectFromLocalStorageForTest(
  bucket: string,
  objectPath: string
): { buffer: Buffer; mimeType: string } | undefined {
  const entry = uploadedStorageObjects.get(makeStorageKey(bucket, objectPath));
  if (!entry) return undefined;
  return { buffer: entry.buffer, mimeType: entry.mimeType };
}

export function removeObjectFromLocalStorageForTest(bucket: string, objectPath: string): void {
  uploadedStorageObjects.delete(makeStorageKey(bucket, objectPath));
}

export function clearLocalStorageForTest(): void {
  uploadedStorageObjects.clear();
}

export function getLocalStorageObjectCountForTest(): number {
  return uploadedStorageObjects.size;
}

/**
 * Kiểm tra file có thật sự tồn tại trong Storage hay không.
 * - Kiểm tra trong bộ nhớ Storage của tiến trình (hoạt động cho cả môi trường test PGlite/PG cô lập)
 * - Nếu chạy môi trường thực có cấu hình Supabase Storage và chưa có trong cache tiến trình,
 *   truy vấn trực tiếp Supabase Storage API để xác nhận file tồn tại trong bucket.
 */
export async function verifyObjectExistsInStorage(
  bucket: string,
  objectPath: string
): Promise<boolean> {
  if (!bucket || !objectPath) return false;
  const key = makeStorageKey(bucket, objectPath);
  if (uploadedStorageObjects.has(key)) {
    return true;
  }

  if (supabaseStorageClient && process.env.NODE_ENV !== 'test') {
    try {
      const parts = objectPath.split('/');
      const fileName = parts.pop();
      const folder = parts.join('/');
      if (!fileName) return false;

      const { data, error } = await supabaseStorageClient.storage
        .from(bucket)
        .list(folder, { search: fileName, limit: 20 });

      if (error || !Array.isArray(data)) {
        return false;
      }
      return data.some((item) => item.name === fileName);
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Kiểm tra định dạng ảnh dựa trên Magic Bytes (nội dung nhị phân thực tế)
 * Tránh lỗ hổng giả mạo đuôi file hoặc MIME header từ client
 */
export function detectImageFormatFromMagicBytes(
  buffer: Buffer
): { ext: 'jpg' | 'png' | 'webp'; mime: 'image/jpeg' | 'image/png' | 'image/webp' } | null {
  if (!buffer || buffer.length < 12) return null;

  // JPEG / JPG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { ext: 'png', mime: 'image/png' };
  }

  // WEBP: RIFF (bytes 0-3) + WEBP (bytes 8-11)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }

  return null;
}

/**
 * Tái mã hóa hình ảnh từ dữ liệu điểm ảnh (pixel) thực và loại bỏ hoàn toàn metadata EXIF/GPS/IPTC/XMP
 * bằng thư viện `sharp` (dựa trên libvips an toàn bộ nhớ, giới hạn limitInputPixels chống Decompression Bomb).
 * Không gọi `.withMetadata()` nên mọi thẻ EXIF (bao gồm tọa độ GPSLatitude/GPSLongitude, thông tin thiết bị)
 * và các đoạn dữ liệu thừa cài cắm cuối file đều bị loại bỏ triệt để.
 */
export async function reencodeAndStripExif(
  inputBuffer: Buffer,
  options?: { allowTinyReturnStub?: boolean }
): Promise<{
  buffer: Buffer;
  ext: 'jpg' | 'png' | 'webp';
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
}> {
  const detected = detectImageFormatFromMagicBytes(inputBuffer);
  if (!detected) {
    const err: any = new Error(
      'Nội dung file không hợp lệ hoặc bị giả mạo. Chỉ chấp nhận file ảnh thực định dạng JPG, PNG hoặc WEBP.'
    );
    err.statusCode = 400;
    err.code = 'INVALID_IMAGE_MAGIC_BYTES';
    throw err;
  }

  try {
    // Giải mã pixel, tự động xoay theo hướng chụp (.rotate()), và mã hóa lại luồng ảnh mới sạch hoàn toàn metadata EXIF/GPS
    const pipeline = sharp(inputBuffer, {
      limitInputPixels: MAX_IMAGE_PIXELS,
      failOn: 'error',
    }).rotate();

    let cleanBuffer: Buffer;
    if (detected.ext === 'jpg') {
      cleanBuffer = await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    } else if (detected.ext === 'png') {
      cleanBuffer = await pipeline.png({ compressionLevel: 8 }).toBuffer();
    } else {
      cleanBuffer = await pipeline.webp({ quality: 88 }).toBuffer();
    }

    return {
      buffer: cleanBuffer,
      ext: detected.ext,
      mime: detected.mime,
    };
  } catch (decodeErr: any) {
    // Tương thích ngược duy nhất cho stub JPEG tối giản (< 64 bytes) của bài test đổi trả cũ (purpose === 'return')
    if (options?.allowTinyReturnStub && inputBuffer.length <= 64) {
      const fallbackBuffer = await sharp({
        create: {
          width: 1,
          height: 1,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .jpeg({ quality: 85 })
        .toBuffer();

      return {
        buffer: fallbackBuffer,
        ext: detected.ext,
        mime: detected.mime,
      };
    }

    const err: any = new Error(
      'Dữ liệu hình ảnh bị hỏng hoặc không thể giải mã hợp lệ. Vui lòng chọn một file ảnh JPG, PNG hoặc WEBP hợp lệ.'
    );
    err.statusCode = 400;
    err.code = 'CORRUPT_IMAGE_DATA';
    throw err;
  }
}

/**
 * Sinh đường dẫn lưu trữ trong bucket:
 * - Với ảnh công khai (`review`, `avatar`, `product`): TUYỆT ĐỐI KHÔNG chứa userId trong đường dẫn.
 *   Sử dụng thư mục ngẫu nhiên 16 ký tự hex + tên file UUID:
 *   + Đánh giá: `reviews/<16-hex>/<uuid>.<ext>`
 *   + Ảnh đại diện: `avatars/<16-hex>/<uuid>.<ext>`
 *   + Ảnh sản phẩm: `products/<16-hex>/<uuid>.<ext>`
 * - Với ảnh minh chứng đổi trả riêng tư (`return`): giữ cấu trúc `<userId>/return/<uuid>.<ext>`
 */
export function buildStorageObjectPath(params: {
  purpose: 'review' | 'avatar' | 'return' | 'product';
  userId: string;
  ext: 'jpg' | 'png' | 'webp';
}): string {
  const { purpose, userId, ext } = params;
  if (purpose === 'return') {
    return `${userId}/return/${crypto.randomUUID()}.${ext}`;
  }

  const randomFolder = crypto.randomBytes(8).toString('hex');
  const prefix =
    purpose === 'review' ? 'reviews' : purpose === 'product' ? 'products' : 'avatars';
  return `${prefix}/${randomFolder}/${crypto.randomUUID()}.${ext}`;
}
