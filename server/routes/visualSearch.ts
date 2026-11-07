import express, { Router, type Response } from 'express';
import { optionalAuth, type AuthRequest } from '../services/auth.ts';
import {
  performVisualSearch,
  refineVisualSearchByAttributes,
  loadVisualSearchVocabulary,
} from '../services/visualSearch.ts';

export const visualSearchRouter = Router();

// Giới hạn kích thước body riêng cho nhánh /api/visual-search (cho phép chuỗi base64 của ảnh 5MB ~ 7.5MB JSON)
const visualSearchBodyParser = express.json({ limit: '8mb' });

function extractClientIp(req: AuthRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '0.0.0.0';
}

/**
 * GET /api/visual-search/vocabulary — Lấy danh sách từ vựng chuẩn (danh mục, màu sắc, phong cách, họa tiết, độ ôm) từ CSDL
 */
visualSearchRouter.get('/vocabulary', async (_req: AuthRequest, res: Response) => {
  try {
    const vocab = await loadVisualSearchVocabulary();
    return res.json({
      success: true,
      vocabulary: {
        categories: vocab.categories.map((c) => ({ slug: c.slug, name: c.name })),
        colors: vocab.colors,
        styles: vocab.styles,
        patterns: vocab.patterns,
        fits: vocab.fits,
        targetGenders: vocab.targetGenders,
      },
    });
  } catch (err: any) {
    console.error('[GET /api/visual-search/vocabulary ERROR]', err?.code || err?.name || 'ERROR');
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Không thể tải danh sách bộ lọc tìm kiếm bằng ảnh lúc này.',
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Không thể tải danh sách bộ lọc tìm kiếm bằng ảnh lúc này.',
      },
    });
  }
});

/**
 * POST /api/visual-search — Nhận đúng 1 ảnh (JPEG, PNG, WEBP <= 5MB), xử lý trong bộ nhớ bằng sharp,
 * kiểm tra giới hạn tần suất trong CSDL, gọi Gemini với Structured Output và chấm điểm SQL.
 * Không bao giờ lưu ảnh vào Storage hay bảng uploads.
 */
visualSearchRouter.post(
  '/',
  visualSearchBodyParser,
  optionalAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const body = req.body || {};

      // Chỉ chấp nhận đúng 1 ảnh mỗi yêu cầu
      if (Array.isArray(body.images) && body.images.length > 1) {
        return res.status(400).json({
          success: false,
          code: 'MULTIPLE_IMAGES_NOT_ALLOWED',
          message: 'Mỗi lần tìm kiếm chỉ chấp nhận đúng 1 hình ảnh.',
          error: {
            code: 'MULTIPLE_IMAGES_NOT_ALLOWED',
            message: 'Mỗi lần tìm kiếm chỉ chấp nhận đúng 1 hình ảnh.',
          },
        });
      }

      const rawImage =
        typeof body.image === 'string'
          ? body.image
          : Array.isArray(body.images) && typeof body.images[0] === 'string'
          ? body.images[0]
          : '';

      const result = await performVisualSearch({
        rawImage,
        userId: req.user?.id || null,
        clientIp: extractClientIp(req),
      });

      if (result.statusCode >= 400) {
        return res.status(result.statusCode).json({
          ...result.body,
          code: result.body.fallbackCode || `HTTP_${result.statusCode}`,
          error: {
            code: result.body.fallbackCode || `HTTP_${result.statusCode}`,
            message: result.body.message,
          },
        });
      }

      return res.status(result.statusCode).json(result.body);
    } catch (err: any) {
      const status =
        typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500
          ? err.statusCode
          : 500;
      const code = err?.code || (status < 500 ? `HTTP_${status}` : 'INTERNAL_SERVER_ERROR');
      const message =
        status < 500
          ? err?.message || 'Dữ liệu hình ảnh không hợp lệ.'
          : 'Đã xảy ra lỗi khi xử lý tìm kiếm bằng hình ảnh.';

      if (status >= 500) {
        console.error('[POST /api/visual-search ERROR]', code);
      }

      return res.status(status).json({
        success: false,
        code,
        message,
        error: {
          code,
          message,
        },
      });
    }
  }
);

/**
 * POST /api/visual-search/refine — Nhận các thuộc tính đã chỉnh sửa từ người dùng (không nhận ảnh),
 * KHÔNG gọi lại Gemini, kiểm tra với cùng bộ từ vựng CSDL và chấm điểm SQL.
 */
visualSearchRouter.post(
  '/refine',
  optionalAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const rawAttributes = req.body?.attributes ?? req.body ?? {};
      const result = await refineVisualSearchByAttributes({
        rawAttributes,
        userId: req.user?.id || null,
        clientIp: extractClientIp(req),
      });

      if (result.statusCode >= 400) {
        return res.status(result.statusCode).json({
          ...result.body,
          code: result.body.fallbackCode || `HTTP_${result.statusCode}`,
          error: {
            code: result.body.fallbackCode || `HTTP_${result.statusCode}`,
            message: result.body.message,
          },
        });
      }

      return res.status(result.statusCode).json(result.body);
    } catch (err: any) {
      console.error('[POST /api/visual-search/refine ERROR]', err?.code || err?.name || 'ERROR');
      return res.status(500).json({
        success: false,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Không thể lọc lại danh sách sản phẩm lúc này.',
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Không thể lọc lại danh sách sản phẩm lúc này.',
        },
      });
    }
  }
);
