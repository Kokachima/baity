import { Router, type Response } from 'express';
import { sql } from 'drizzle-orm';
import { queryRows, withTransaction } from '../db/index.ts';
import { type AuthRequest } from '../services/auth.ts';
import { insertAdminAuditLogInTx } from '../services/orderStateMachine.ts';
import { stripRawHtmlFromMarkdown, parseSafeMarkdownBlocks } from '../../shared/safeMarkdown.ts';
import {
  ALLOWED_FAQ_TOPICS,
  ALLOWED_POLICY_TEMPLATE_VARIABLES,
  adminFaqInputSchema,
  adminPolicyUpdateSchema,
  adminPromotionInputSchema,
  adminPromotionPreviewSchema,
  adminStoreSettingsUpdateSchema,
  adminVoucherInputSchema,
  findUnknownPolicyTemplateVariables,
  parseGmt7InputToUtcDate,
} from '../../shared/contracts.ts';
import {
  DEFAULT_POLICY_SLUGS,
  SEED_POLICIES_AND_FAQ_ITEMS,
  buildPolicyTemplateVariables,
  getStoreContactSettings,
  interpolatePolicyContent,
  resolveVietQrBankName,
} from '../services/policyFaq.ts';
import { getStoreShippingSettings } from '../services/pricing.ts';
import { normalizeVietnameseText } from '../db/seed.ts';

function sendStage8cError(res: Response, err: any, fallbackMessage: string) {
  const status =
    typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500
      ? err.statusCode
      : 500;

  if (status < 500) {
    const code = err.code || `HTTP_${status}`;
    const message = err.message || fallbackMessage;
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

  console.error('[ADMIN 8C API ERROR]', err?.code || err?.name || 'INTERNAL_SERVER_ERROR');
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_SERVER_ERROR',
    message: fallbackMessage,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: fallbackMessage,
    },
  });
}

function isSameTimestamp(expectedIso: string | undefined, actualDbValue: string | Date | null | undefined): boolean {
  if (!expectedIso) return true;
  if (!actualDbValue) return false;
  const expectedMs = new Date(expectedIso).getTime();
  const actualMs = new Date(actualDbValue).getTime();
  if (!Number.isFinite(expectedMs) || !Number.isFinite(actualMs)) {
    return String(expectedIso).trim() === String(actualDbValue).trim();
  }
  return expectedMs === actualMs;
}

function throwConcurrentModification(): never {
  const err: any = new Error('Dữ liệu đã được quản trị viên khác cập nhật, vui lòng tải lại');
  err.statusCode = 409;
  err.code = 'CONCURRENT_MODIFICATION';
  throw err;
}

const FORBIDDEN_SETTING_KEY_PATTERNS = [
  /^bank_?account/i,
  /^account_?number$/i,
  /^account_?no$/i,
  /^bank_?no$/i,
  /^bank_?id$/i,
  /^bank_?bin$/i,
  /^vietqr/i,
  /api_?key/i,
  /gemini_?api_?key/i,
  /jwt_?secret/i,
  /service_?role/i,
  /supabase_?key/i,
  /database_?url/i,
  /webhook_?secret/i,
  /private_?key/i,
  /^secret$/i,
  /^password$/i,
  /^token$/i,
];

function findForbiddenSensitiveSettingKey(obj: unknown, pathPrefix = ''): string | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = pathPrefix ? `${pathPrefix}.${k}` : k;
    if (FORBIDDEN_SETTING_KEY_PATTERNS.some((re) => re.test(k))) {
      return fullKey;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = findForbiddenSensitiveSettingKey(v, fullKey);
      if (nested) return nested;
    }
  }
  return null;
}

function extractFaqTopicAndCleanBody(rawContent: string): { topic: string; body: string } {
  const match = String(rawContent || '').match(/^\[Chủ đề:\s*([^\]]+)\]\s*\n?/i);
  if (match) {
    return {
      topic: match[1].trim(),
      body: String(rawContent || '').slice(match[0].length).trim(),
    };
  }
  return {
    topic: 'Đơn hàng & Thanh toán',
    body: String(rawContent || '').trim(),
  };
}

function slugifyFaqTitle(title: string): string {
  const normalized = normalizeVietnameseText(title || '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `faq-${normalized || 'item'}-${Date.now().toString(36)}`;
}

export const adminStage8cRouter = Router();
let stage8cRoutesInitialized = false;

export function registerAdminStage8cRoutes(parentRouter: Router) {
  parentRouter.use(adminStage8cRouter);
  if (stage8cRoutesInitialized) return;
  stage8cRoutesInitialized = true;
  const adminRouter = adminStage8cRouter;

  // ============================================================================
  // MỤC 5 — QUẢN LÝ VOUCHER (/api/admin/vouchers)
  // ============================================================================

  adminRouter.get('/vouchers', async (req: AuthRequest, res: Response) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const rawLimit = parseInt(String(req.query.limit || '20'), 10) || 20;
      const limit = Math.min(50, Math.max(1, rawLimit));
      const offset = (page - 1) * limit;

      const status = typeof req.query.status === 'string' ? req.query.status.trim() : 'all';
      const discountType =
        typeof req.query.discountType === 'string' ? req.query.discountType.trim() : 'all';
      const searchRaw =
        typeof (req.query.q || req.query.search) === 'string'
          ? String(req.query.q || req.query.search).trim()
          : '';

      const conditions = [];
      if (status === 'active') {
        conditions.push(sql`(v.is_active = true AND v.start_date <= NOW() AND v.end_date >= NOW())`);
      } else if (status === 'upcoming') {
        conditions.push(sql`(v.is_active = true AND v.start_date > NOW())`);
      } else if (status === 'expired') {
        conditions.push(sql`(v.end_date < NOW())`);
      } else if (status === 'inactive') {
        conditions.push(sql`(v.is_active = false)`);
      }

      if (discountType && discountType !== 'all') {
        conditions.push(sql`v.discount_type = ${discountType}`);
      }

      if (searchRaw) {
        const likePattern = `%${searchRaw}%`;
        conditions.push(sql`(v.code ILIKE ${likePattern} OR COALESCE(v.description, '') ILIKE ${likePattern})`);
      }

      const whereSql =
        conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

      const [countRows, rows] = await Promise.all([
        queryRows<{ total: number }>(sql`
          SELECT COUNT(*)::int AS total
          FROM vouchers v
          ${whereSql};
        `),
        queryRows<any>(sql`
          SELECT
            v.id,
            v.code,
            v.description,
            v.discount_type AS "discountType",
            v.discount_value AS "discountValue",
            v.min_order_value AS "minOrderValue",
            v.max_discount AS "maxDiscount",
            v.start_date AS "startDate",
            v.end_date AS "endDate",
            v.usage_limit AS "usageLimit",
            v.per_user_limit AS "perUserLimit",
            v.used_count AS "rawUsedCount",
            (SELECT COUNT(*)::int FROM voucher_usages vu WHERE vu.voucher_id = v.id) AS "usageRowCount",
            v.applicable_category_id AS "applicableCategoryId",
            c.name AS "applicableCategoryName",
            v.is_active AS "isActive",
            v.updated_at AS "updatedAt"
          FROM vouchers v
          LEFT JOIN categories c ON c.id = v.applicable_category_id
          ${whereSql}
          ORDER BY v.end_date DESC, v.code ASC
          LIMIT ${limit} OFFSET ${offset};
        `),
      ]);

      const total = Number(countRows[0]?.total || 0);
      const items = rows.map((r) => {
        const usedCount = Math.max(Number(r.rawUsedCount || 0), Number(r.usageRowCount || 0));
        return {
          id: r.id,
          code: r.code,
          description: r.description || null,
          discountType: r.discountType,
          discountValue: Number(r.discountValue || 0),
          minOrderValue: Number(r.minOrderValue || 0),
          maxDiscount: r.maxDiscount !== null && r.maxDiscount !== undefined ? Number(r.maxDiscount) : null,
          startDate: r.startDate,
          endDate: r.endDate,
          usageLimit: r.usageLimit !== null && r.usageLimit !== undefined ? Number(r.usageLimit) : null,
          perUserLimit: Number(r.perUserLimit ?? 1),
          usedCount,
          applicableCategoryId: r.applicableCategoryId || null,
          applicableCategoryName: r.applicableCategoryName || null,
          isActive: Boolean(r.isActive),
          updatedAt: r.updatedAt,
        };
      });

      return res.json({
        success: true,
        items,
        data: items,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi tải danh sách mã giảm giá');
    }
  });

  adminRouter.post('/vouchers', async (req: AuthRequest, res: Response) => {
    try {
      const adminId = req.user!.id;
      const parsed = adminVoucherInputSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Dữ liệu mã giảm giá không hợp lệ',
        });
      }

      const data = parsed.data;
      const normalizedCode = data.code.trim().toUpperCase();
      const cleanDescription = data.description
        ? stripRawHtmlFromMarkdown(data.description).replace(/[<>]/g, '').trim()
        : null;
      const startUtc = parseGmt7InputToUtcDate(data.startDate)!;
      const endUtc = parseGmt7InputToUtcDate(data.endDate)!;
      const effectiveDiscountValue = data.discountType === 'free_shipping' ? 0 : data.discountValue;

      const created = await withTransaction(async (txQueryRows) => {
        const dupRows = await txQueryRows<{ id: string }>(sql`
          SELECT id FROM vouchers WHERE UPPER(code) = ${normalizedCode} LIMIT 1;
        `);
        if (dupRows.length > 0) {
          const err: any = new Error(`Mã voucher "${normalizedCode}" đã tồn tại`);
          err.statusCode = 409;
          err.code = 'DUPLICATE_VOUCHER_CODE';
          throw err;
        }

        if (data.applicableCategoryId) {
          const catRows = await txQueryRows<{ id: string }>(sql`
            SELECT id FROM categories WHERE id = ${data.applicableCategoryId}::uuid LIMIT 1;
          `);
          if (catRows.length === 0) {
            const err: any = new Error('Danh mục áp dụng cho voucher không tồn tại');
            err.statusCode = 400;
            err.code = 'CATEGORY_NOT_FOUND';
            throw err;
          }
        }

        const insertedRows = await txQueryRows<any>(sql`
          INSERT INTO vouchers (
            code,
            description,
            discount_type,
            discount_value,
            min_order_value,
            max_discount,
            start_date,
            end_date,
            usage_limit,
            per_user_limit,
            used_count,
            applicable_category_id,
            is_active,
            updated_at
          ) VALUES (
            ${normalizedCode},
            ${cleanDescription},
            ${data.discountType},
            ${effectiveDiscountValue},
            ${data.minOrderValue},
            ${data.maxDiscount ?? null},
            ${startUtc.toISOString()}::timestamptz,
            ${endUtc.toISOString()}::timestamptz,
            ${data.usageLimit ?? null},
            ${data.perUserLimit},
            0,
            ${data.applicableCategoryId ? sql`${data.applicableCategoryId}::uuid` : sql`NULL`},
            ${data.isActive},
            NOW()
          )
          RETURNING
            id,
            code,
            description,
            discount_type AS "discountType",
            discount_value AS "discountValue",
            min_order_value AS "minOrderValue",
            max_discount AS "maxDiscount",
            start_date AS "startDate",
            end_date AS "endDate",
            usage_limit AS "usageLimit",
            per_user_limit AS "perUserLimit",
            used_count AS "usedCount",
            applicable_category_id AS "applicableCategoryId",
            is_active AS "isActive",
            updated_at AS "updatedAt";
        `);

        const row = insertedRows[0];
        await insertAdminAuditLogInTx(txQueryRows, {
          adminId,
          action: 'VOUCHER_CREATE',
          targetType: 'voucher',
          targetId: row.id,
          summary: `Tạo voucher ${row.code} (${row.discountType}: ${row.discountValue}, đơn tối thiểu: ${row.minOrderValue})`,
        });

        return {
          ...row,
          discountValue: Number(row.discountValue || 0),
          minOrderValue: Number(row.minOrderValue || 0),
          maxDiscount: row.maxDiscount !== null && row.maxDiscount !== undefined ? Number(row.maxDiscount) : null,
          usageLimit: row.usageLimit !== null && row.usageLimit !== undefined ? Number(row.usageLimit) : null,
          perUserLimit: Number(row.perUserLimit ?? 1),
          usedCount: Number(row.usedCount || 0),
          isActive: Boolean(row.isActive),
        };
      });

      return res.status(201).json({
        success: true,
        message: 'Tạo mã giảm giá thành công',
        voucher: created,
        data: created,
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi tạo mã giảm giá');
    }
  });

  adminRouter.put('/vouchers/:id', async (req: AuthRequest, res: Response) => {
    try {
      const voucherId = String(req.params.id || '').trim();
      const adminId = req.user!.id;

      const parsed = adminVoucherInputSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Dữ liệu cập nhật mã giảm giá không hợp lệ',
        });
      }

      const data = parsed.data;
      const expectedUpdatedAt =
        data.expectedUpdatedAt ||
        data.updatedAt ||
        (typeof req.body?.expectedUpdatedAt === 'string' ? req.body.expectedUpdatedAt : undefined);

      const normalizedCode = data.code.trim().toUpperCase();
      const cleanDescription = data.description
        ? stripRawHtmlFromMarkdown(data.description).replace(/[<>]/g, '').trim()
        : null;
      const startUtc = parseGmt7InputToUtcDate(data.startDate)!;
      const endUtc = parseGmt7InputToUtcDate(data.endDate)!;
      const effectiveDiscountValue = data.discountType === 'free_shipping' ? 0 : data.discountValue;

      const updated = await withTransaction(async (txQueryRows) => {
        const existingRows = await txQueryRows<any>(sql`
          SELECT
            v.id,
            v.code,
            v.discount_type,
            v.discount_value,
            v.used_count,
            v.updated_at,
            (SELECT COUNT(*)::int FROM voucher_usages vu WHERE vu.voucher_id = v.id) AS usage_row_count
          FROM vouchers v
          WHERE v.id = ${voucherId}::uuid
          FOR UPDATE;
        `);

        if (existingRows.length === 0) {
          const err: any = new Error('Không tìm thấy mã giảm giá');
          err.statusCode = 404;
          err.code = 'VOUCHER_NOT_FOUND';
          throw err;
        }

        const current = existingRows[0];
        if (!isSameTimestamp(expectedUpdatedAt, current.updated_at)) {
          throwConcurrentModification();
        }

        const currentUsedCount = Math.max(
          Number(current.used_count || 0),
          Number(current.usage_row_count || 0)
        );

        if (currentUsedCount > 0) {
          const codeChanged = String(current.code).toUpperCase() !== normalizedCode;
          const typeChanged = String(current.discount_type) !== data.discountType;
          const valueChanged = Number(current.discount_value || 0) !== Number(effectiveDiscountValue);
          if (codeChanged || typeChanged || valueChanged) {
            const err: any = new Error(
              'Voucher đã có lượt sử dụng nên không được sửa mã (code), loại giảm giá (discountType) hoặc mức giảm (discountValue)'
            );
            err.statusCode = 400;
            err.code = 'USED_VOUCHER_IMMUTABLE_FIELDS';
            throw err;
          }
        }

        if (
          data.usageLimit !== null &&
          data.usageLimit !== undefined &&
          Number(data.usageLimit) < currentUsedCount
        ) {
          const err: any = new Error(
            `Tổng lượt sử dụng tối đa (${data.usageLimit}) không được nhỏ hơn số lượt đã dùng (${currentUsedCount})`
          );
          err.statusCode = 400;
          err.code = 'USAGE_LIMIT_BELOW_USED_COUNT';
          throw err;
        }

        const dupRows = await txQueryRows<{ id: string }>(sql`
          SELECT id FROM vouchers
          WHERE UPPER(code) = ${normalizedCode}
            AND id <> ${voucherId}::uuid
          LIMIT 1;
        `);
        if (dupRows.length > 0) {
          const err: any = new Error(`Mã voucher "${normalizedCode}" đã tồn tại`);
          err.statusCode = 409;
          err.code = 'DUPLICATE_VOUCHER_CODE';
          throw err;
        }

        if (data.applicableCategoryId) {
          const catRows = await txQueryRows<{ id: string }>(sql`
            SELECT id FROM categories WHERE id = ${data.applicableCategoryId}::uuid LIMIT 1;
          `);
          if (catRows.length === 0) {
            const err: any = new Error('Danh mục áp dụng cho voucher không tồn tại');
            err.statusCode = 400;
            err.code = 'CATEGORY_NOT_FOUND';
            throw err;
          }
        }

        const updatedRows = await txQueryRows<any>(sql`
          UPDATE vouchers
          SET
            code = ${normalizedCode},
            description = ${cleanDescription},
            discount_type = ${data.discountType},
            discount_value = ${effectiveDiscountValue},
            min_order_value = ${data.minOrderValue},
            max_discount = ${data.maxDiscount ?? null},
            start_date = ${startUtc.toISOString()}::timestamptz,
            end_date = ${endUtc.toISOString()}::timestamptz,
            usage_limit = ${data.usageLimit ?? null},
            per_user_limit = ${data.perUserLimit},
            applicable_category_id = ${
              data.applicableCategoryId ? sql`${data.applicableCategoryId}::uuid` : sql`NULL`
            },
            is_active = ${data.isActive},
            updated_at = clock_timestamp()
          WHERE id = ${voucherId}::uuid
          RETURNING
            id,
            code,
            description,
            discount_type AS "discountType",
            discount_value AS "discountValue",
            min_order_value AS "minOrderValue",
            max_discount AS "maxDiscount",
            start_date AS "startDate",
            end_date AS "endDate",
            usage_limit AS "usageLimit",
            per_user_limit AS "perUserLimit",
            used_count AS "usedCount",
            applicable_category_id AS "applicableCategoryId",
            is_active AS "isActive",
            updated_at AS "updatedAt";
        `);

        const row = updatedRows[0];
        await insertAdminAuditLogInTx(txQueryRows, {
          adminId,
          action: 'VOUCHER_UPDATE',
          targetType: 'voucher',
          targetId: row.id,
          summary: `Cập nhật voucher ${row.code} (isActive=${row.isActive}, usageLimit=${row.usageLimit ?? 'unlimited'})`,
        });

        return {
          ...row,
          discountValue: Number(row.discountValue || 0),
          minOrderValue: Number(row.minOrderValue || 0),
          maxDiscount: row.maxDiscount !== null && row.maxDiscount !== undefined ? Number(row.maxDiscount) : null,
          usageLimit: row.usageLimit !== null && row.usageLimit !== undefined ? Number(row.usageLimit) : null,
          perUserLimit: Number(row.perUserLimit ?? 1),
          usedCount: currentUsedCount,
          isActive: Boolean(row.isActive),
        };
      });

      return res.json({
        success: true,
        message: 'Cập nhật mã giảm giá thành công',
        voucher: updated,
        data: updated,
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi cập nhật mã giảm giá');
    }
  });

  // ============================================================================
  // MỤC 6 — QUẢN LÝ KHUYẾN MÃI / FLASH SALE (/api/admin/promotions)
  // ============================================================================

  adminRouter.get('/promotions', async (req: AuthRequest, res: Response) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const rawLimit = parseInt(String(req.query.limit || '20'), 10) || 20;
      const limit = Math.min(50, Math.max(1, rawLimit));
      const offset = (page - 1) * limit;

      const status = typeof req.query.status === 'string' ? req.query.status.trim() : 'all';
      const searchRaw =
        typeof (req.query.q || req.query.search) === 'string'
          ? String(req.query.q || req.query.search).trim()
          : '';

      const conditions = [];
      if (status === 'active') {
        conditions.push(sql`(p.is_active = true AND p.start_time <= NOW() AND p.end_time >= NOW())`);
      } else if (status === 'upcoming') {
        conditions.push(sql`(p.is_active = true AND p.start_time > NOW())`);
      } else if (status === 'ended') {
        conditions.push(sql`(p.end_time < NOW() OR p.is_active = false)`);
      }

      if (searchRaw) {
        conditions.push(sql`p.title ILIKE ${`%${searchRaw}%`}`);
      }

      const whereSql =
        conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

      const [countRows, promoRows] = await Promise.all([
        queryRows<{ total: number }>(sql`
          SELECT COUNT(*)::int AS total
          FROM promotions p
          ${whereSql};
        `),
        queryRows<any>(sql`
          SELECT
            p.id,
            p.title,
            p.start_time AS "startTime",
            p.end_time AS "endTime",
            p.is_active AS "isActive",
            p.updated_at AS "updatedAt"
          FROM promotions p
          ${whereSql}
          ORDER BY p.start_time DESC, p.id DESC
          LIMIT ${limit} OFFSET ${offset};
        `),
      ]);

      const promoIds = promoRows.map((r) => r.id);
      let targetRows: any[] = [];
      if (promoIds.length > 0) {
        const idFragments = promoIds.map((id) => sql`${id}::uuid`);
        targetRows = await queryRows<any>(sql`
          SELECT
            pt.id,
            pt.promotion_id AS "promotionId",
            pt.target_type AS "targetType",
            pt.target_id AS "targetId",
            pt.discount_percent AS "discountPercent",
            CASE
              WHEN pt.target_type = 'product' THEN (SELECT pr.name FROM products pr WHERE pr.id = pt.target_id)
              WHEN pt.target_type = 'category' THEN (SELECT c.name FROM categories c WHERE c.id = pt.target_id)
              ELSE NULL
            END AS "targetName"
          FROM promotion_targets pt
          WHERE pt.promotion_id IN (${sql.join(idFragments, sql`, `)})
          ORDER BY pt.discount_percent DESC, pt.id ASC;
        `);
      }

      const targetsByPromo = new Map<string, any[]>();
      for (const t of targetRows) {
        const list = targetsByPromo.get(t.promotionId) || [];
        list.push({
          id: t.id,
          targetType: t.targetType,
          targetId: t.targetId,
          targetName: t.targetName || null,
          discountPercent: Number(t.discountPercent || 0),
        });
        targetsByPromo.set(t.promotionId, list);
      }

      const total = Number(countRows[0]?.total || 0);
      const items = promoRows.map((p) => ({
        id: p.id,
        title: p.title,
        startTime: p.startTime,
        endTime: p.endTime,
        isActive: Boolean(p.isActive),
        updatedAt: p.updatedAt,
        targets: targetsByPromo.get(p.id) || [],
      }));

      return res.json({
        success: true,
        items,
        data: items,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi tải danh sách chương trình khuyến mãi');
    }
  });

  async function verifyAndSummarizePromotionTargets(
    txOrQuery: typeof queryRows,
    targets: Array<{ targetType: 'product' | 'category'; targetId: string; discountPercent: number }>
  ) {
    const productTargets = targets.filter((t) => t.targetType === 'product');
    const categoryTargets = targets.filter((t) => t.targetType === 'category');

    if (productTargets.length > 0) {
      const pIds = productTargets.map((t) => sql`${t.targetId}::uuid`);
      const foundProducts = await txOrQuery<{ id: string }>(sql`
        SELECT id FROM products WHERE id IN (${sql.join(pIds, sql`, `)});
      `);
      if (foundProducts.length !== productTargets.length) {
        const err: any = new Error('Có sản phẩm mục tiêu trong chương trình khuyến mãi không tồn tại');
        err.statusCode = 400;
        err.code = 'PROMOTION_TARGET_PRODUCT_NOT_FOUND';
        throw err;
      }
    }

    if (categoryTargets.length > 0) {
      const cIds = categoryTargets.map((t) => sql`${t.targetId}::uuid`);
      const foundCategories = await txOrQuery<{ id: string }>(sql`
        SELECT id FROM categories WHERE id IN (${sql.join(cIds, sql`, `)});
      `);
      if (foundCategories.length !== categoryTargets.length) {
        const err: any = new Error('Có danh mục mục tiêu trong chương trình khuyến mãi không tồn tại');
        err.statusCode = 400;
        err.code = 'PROMOTION_TARGET_CATEGORY_NOT_FOUND';
        throw err;
      }
    }

    // Tìm toàn bộ sản phẩm bị ảnh hưởng để tính preview
    const matchClauses = [];
    if (productTargets.length > 0) {
      matchClauses.push(
        sql`p.id IN (${sql.join(
          productTargets.map((t) => sql`${t.targetId}::uuid`),
          sql`, `
        )})`
      );
    }
    if (categoryTargets.length > 0) {
      matchClauses.push(
        sql`p.category_id IN (${sql.join(
          categoryTargets.map((t) => sql`${t.targetId}::uuid`),
          sql`, `
        )})`
      );
    }

    const affectedProducts = await txOrQuery<{
      id: string;
      name: string;
      slug: string;
      category_id: string | null;
      base_price: number;
    }>(sql`
      SELECT id, name, slug, category_id, base_price
      FROM products p
      WHERE ${sql.join(matchClauses, sql` OR `)}
      ORDER BY p.name ASC;
    `);

    const productDiscountMap = new Map(productTargets.map((t) => [t.targetId, t.discountPercent]));
    const categoryDiscountMap = new Map(categoryTargets.map((t) => [t.targetId, t.discountPercent]));

    let exampleProduct: {
      id: string;
      name: string;
      slug: string;
      priceBefore: number;
      discountPercent: number;
      priceAfter: number;
      savings: number;
    } | null = null;

    if (affectedProducts.length > 0) {
      const sample = affectedProducts[0];
      const pPct = productDiscountMap.get(sample.id) || 0;
      const cPct = sample.category_id ? categoryDiscountMap.get(sample.category_id) || 0 : 0;
      const bestPct = Math.max(pPct, cPct);
      const basePrice = Number(sample.base_price || 0);
      const priceAfter = Math.max(0, Math.round((basePrice * (100 - bestPct)) / 100));
      exampleProduct = {
        id: sample.id,
        name: sample.name,
        slug: sample.slug,
        priceBefore: basePrice,
        discountPercent: bestPct,
        priceAfter,
        savings: Math.max(0, basePrice - priceAfter),
      };
    }

    return {
      affectedProductCount: affectedProducts.length,
      exampleProduct,
    };
  }

  adminRouter.post('/promotions/preview', async (req: AuthRequest, res: Response) => {
    try {
      const parsed = adminPromotionPreviewSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Dữ liệu xem trước khuyến mãi không hợp lệ',
        });
      }

      const preview = await verifyAndSummarizePromotionTargets(queryRows, parsed.data.targets);
      return res.json({
        success: true,
        ...preview,
        data: preview,
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi xem trước phạm vi khuyến mãi');
    }
  });

  adminRouter.post('/promotions', async (req: AuthRequest, res: Response) => {
    try {
      const adminId = req.user!.id;
      const parsed = adminPromotionInputSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Dữ liệu chương trình khuyến mãi không hợp lệ',
        });
      }

      const data = parsed.data;
      const cleanTitle = stripRawHtmlFromMarkdown(data.title).replace(/[<>]/g, '').trim();
      const startUtc = parseGmt7InputToUtcDate(data.startTime)!;
      const endUtc = parseGmt7InputToUtcDate(data.endTime)!;

      const created = await withTransaction(async (txQueryRows) => {
        const preview = await verifyAndSummarizePromotionTargets(txQueryRows, data.targets);

        const promoRows = await txQueryRows<any>(sql`
          INSERT INTO promotions (
            title,
            start_time,
            end_time,
            is_active,
            updated_at
          ) VALUES (
            ${cleanTitle},
            ${startUtc.toISOString()}::timestamptz,
            ${endUtc.toISOString()}::timestamptz,
            ${data.isActive},
            NOW()
          )
          RETURNING
            id,
            title,
            start_time AS "startTime",
            end_time AS "endTime",
            is_active AS "isActive",
            updated_at AS "updatedAt";
        `);

        const promo = promoRows[0];
        const insertedTargets = [];
        for (const t of data.targets) {
          const targetRows = await txQueryRows<any>(sql`
            INSERT INTO promotion_targets (
              promotion_id,
              target_type,
              target_id,
              discount_percent
            ) VALUES (
              ${promo.id}::uuid,
              ${t.targetType},
              ${t.targetId}::uuid,
              ${t.discountPercent}
            )
            RETURNING
              id,
              target_type AS "targetType",
              target_id AS "targetId",
              discount_percent AS "discountPercent";
          `);
          insertedTargets.push({
            ...targetRows[0],
            discountPercent: Number(targetRows[0].discountPercent || 0),
          });
        }

        await insertAdminAuditLogInTx(txQueryRows, {
          adminId,
          action: 'PROMOTION_CREATE',
          targetType: 'promotion',
          targetId: promo.id,
          summary: `Tạo khuyến mãi "${cleanTitle}" (${insertedTargets.length} mục tiêu, ảnh hưởng ${preview.affectedProductCount} sản phẩm)`,
        });

        return {
          ...promo,
          isActive: Boolean(promo.isActive),
          targets: insertedTargets,
          preview,
        };
      });

      return res.status(201).json({
        success: true,
        message: 'Tạo chương trình khuyến mãi thành công',
        promotion: created,
        data: created,
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi tạo chương trình khuyến mãi');
    }
  });

  adminRouter.put('/promotions/:id', async (req: AuthRequest, res: Response) => {
    try {
      const promotionId = String(req.params.id || '').trim();
      const adminId = req.user!.id;

      const parsed = adminPromotionInputSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Dữ liệu cập nhật chương trình khuyến mãi không hợp lệ',
        });
      }

      const data = parsed.data;
      const expectedUpdatedAt =
        data.expectedUpdatedAt ||
        data.updatedAt ||
        (typeof req.body?.expectedUpdatedAt === 'string' ? req.body.expectedUpdatedAt : undefined);

      const cleanTitle = stripRawHtmlFromMarkdown(data.title).replace(/[<>]/g, '').trim();
      const startUtc = parseGmt7InputToUtcDate(data.startTime)!;
      const endUtc = parseGmt7InputToUtcDate(data.endTime)!;

      const updated = await withTransaction(async (txQueryRows) => {
        const existingRows = await txQueryRows<any>(sql`
          SELECT id, title, updated_at
          FROM promotions
          WHERE id = ${promotionId}::uuid
          FOR UPDATE;
        `);
        if (existingRows.length === 0) {
          const err: any = new Error('Không tìm thấy chương trình khuyến mãi');
          err.statusCode = 404;
          err.code = 'PROMOTION_NOT_FOUND';
          throw err;
        }

        if (!isSameTimestamp(expectedUpdatedAt, existingRows[0].updated_at)) {
          throwConcurrentModification();
        }

        const preview = await verifyAndSummarizePromotionTargets(txQueryRows, data.targets);

        const promoRows = await txQueryRows<any>(sql`
          UPDATE promotions
          SET
            title = ${cleanTitle},
            start_time = ${startUtc.toISOString()}::timestamptz,
            end_time = ${endUtc.toISOString()}::timestamptz,
            is_active = ${data.isActive},
            updated_at = clock_timestamp()
          WHERE id = ${promotionId}::uuid
          RETURNING
            id,
            title,
            start_time AS "startTime",
            end_time AS "endTime",
            is_active AS "isActive",
            updated_at AS "updatedAt";
        `);

        await txQueryRows(sql`
          DELETE FROM promotion_targets WHERE promotion_id = ${promotionId}::uuid;
        `);

        const insertedTargets = [];
        for (const t of data.targets) {
          const targetRows = await txQueryRows<any>(sql`
            INSERT INTO promotion_targets (
              promotion_id,
              target_type,
              target_id,
              discount_percent
            ) VALUES (
              ${promotionId}::uuid,
              ${t.targetType},
              ${t.targetId}::uuid,
              ${t.discountPercent}
            )
            RETURNING
              id,
              target_type AS "targetType",
              target_id AS "targetId",
              discount_percent AS "discountPercent";
          `);
          insertedTargets.push({
            ...targetRows[0],
            discountPercent: Number(targetRows[0].discountPercent || 0),
          });
        }

        const promo = promoRows[0];
        await insertAdminAuditLogInTx(txQueryRows, {
          adminId,
          action: 'PROMOTION_UPDATE',
          targetType: 'promotion',
          targetId: promo.id,
          summary: `Cập nhật khuyến mãi "${cleanTitle}" (isActive=${promo.isActive}, ${insertedTargets.length} mục tiêu)`,
        });

        return {
          ...promo,
          isActive: Boolean(promo.isActive),
          targets: insertedTargets,
          preview,
        };
      });

      return res.json({
        success: true,
        message: 'Cập nhật chương trình khuyến mãi thành công',
        promotion: updated,
        data: updated,
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi cập nhật chương trình khuyến mãi');
    }
  });

  adminRouter.post('/promotions/:id/end-early', async (req: AuthRequest, res: Response) => {
    try {
      const promotionId = String(req.params.id || '').trim();
      const adminId = req.user!.id;

      const ended = await withTransaction(async (txQueryRows) => {
        const existingRows = await txQueryRows<any>(sql`
          SELECT id, title, is_active, end_time
          FROM promotions
          WHERE id = ${promotionId}::uuid
          FOR UPDATE;
        `);
        if (existingRows.length === 0) {
          const err: any = new Error('Không tìm thấy chương trình khuyến mãi');
          err.statusCode = 404;
          err.code = 'PROMOTION_NOT_FOUND';
          throw err;
        }

        const updatedRows = await txQueryRows<any>(sql`
          UPDATE promotions
          SET
            is_active = false,
            end_time = LEAST(end_time, NOW()),
            updated_at = clock_timestamp()
          WHERE id = ${promotionId}::uuid
          RETURNING
            id,
            title,
            start_time AS "startTime",
            end_time AS "endTime",
            is_active AS "isActive",
            updated_at AS "updatedAt";
        `);

        const row = updatedRows[0];
        await insertAdminAuditLogInTx(txQueryRows, {
          adminId,
          action: 'PROMOTION_END_EARLY',
          targetType: 'promotion',
          targetId: row.id,
          summary: `Kết thúc sớm chương trình khuyến mãi "${row.title}"`,
        });

        return {
          ...row,
          isActive: Boolean(row.isActive),
        };
      });

      return res.json({
        success: true,
        message: 'Đã kết thúc sớm chương trình khuyến mãi',
        promotion: ended,
        data: ended,
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi kết thúc sớm chương trình khuyến mãi');
    }
  });

  // ============================================================================
  // MỤC 7 — CÀI ĐẶT CỬA HÀNG (/api/admin/settings)
  // ============================================================================

  function getVietQrReadOnlyStatus() {
    const bankId = String(process.env.VIETQR_BANK_ID || '').trim();
    const accountNo = String(process.env.VIETQR_ACCOUNT_NO || '').trim();
    const accountName = String(process.env.VIETQR_ACCOUNT_NAME || '').trim();
    const bankName = resolveVietQrBankName(bankId);
    const last4 = accountNo.length >= 4 ? accountNo.slice(-4) : null;
    return {
      isConfigured: Boolean(bankId && accountNo),
      bankId: bankId || null,
      bankName: bankName || null,
      accountNumberLast4: last4,
      accountNumberMasked: last4 ? `****${last4}` : null,
      accountName: accountName || null,
    };
  }

  adminRouter.get('/settings', async (_req: AuthRequest, res: Response) => {
    try {
      await queryRows(sql`
        INSERT INTO store_settings (key, value)
        VALUES ('general', '{}'::jsonb)
        ON CONFLICT (key) DO NOTHING;
      `);

      const [contact, shipping, rawRows] = await Promise.all([
        getStoreContactSettings(),
        getStoreShippingSettings(),
        queryRows<{ key: string; value: any; updated_at: string }>(sql`
          SELECT key, value, updated_at
          FROM store_settings
          WHERE key IN ('general', 'contact', 'shipping', 'returns', 'inventory')
          ORDER BY updated_at DESC;
        `),
      ]);

      const generalRow = rawRows.find((r: any) => r.key === 'general') || rawRows[0];
      const updatedAt = generalRow?.updated_at || new Date().toISOString();

      return res.json({
        success: true,
        contact: {
          storeName: contact.storeName || shipping.storeName || 'BAITY',
          hotline: contact.hotline || '',
          email: contact.email || '',
          address: contact.address || '',
          workingHours: contact.workingHours || '',
          legalEntityName: contact.legalEntityName || '',
          taxId: contact.taxId || '',
          returnAddress: contact.returnAddress || '',
        },
        shipping: {
          standardShippingFee: shipping.standardShippingFee,
          expressShippingFee: shipping.expressShippingFee,
          freeShippingThreshold: shipping.freeShippingThreshold,
        },
        returns: {
          returnDaysLimit: shipping.returnDaysLimit,
          previousReturnDaysLimit: shipping.previousReturnDaysLimit,
          returnPolicyChangedAt: shipping.returnPolicyChangedAt,
        },
        inventory: {
          lowStockThreshold: shipping.lowStockThreshold,
        },
        bannerText: shipping.bannerText || '',
        vietqrReadOnly: getVietQrReadOnlyStatus(),
        updatedAt,
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi tải cài đặt cửa hàng');
    }
  });

  adminRouter.put('/settings', async (req: AuthRequest, res: Response) => {
    try {
      const adminId = req.user!.id;
      const rawBody = req.body || {};

      // Kiểm tra nghiêm ngặt: tuyệt đối không cho phép lưu tài khoản ngân hàng, khóa API, mật khẩu hay bí mật vào store_settings
      const forbiddenKey = findForbiddenSensitiveSettingKey(rawBody);
      if (forbiddenKey) {
        return res.status(400).json({
          success: false,
          code: 'FORBIDDEN_SENSITIVE_SETTING',
          message: `Trường "${forbiddenKey}" chứa thông tin nhạy cảm (tài khoản ngân hàng, khóa API hoặc bí mật hệ thống) và bị cấm lưu vào store_settings.`,
          error: {
            code: 'FORBIDDEN_SENSITIVE_SETTING',
            message: `Trường "${forbiddenKey}" bị cấm lưu vào store_settings.`,
          },
        });
      }

      const parsed = adminStoreSettingsUpdateSchema.safeParse(rawBody);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Dữ liệu cài đặt cửa hàng không hợp lệ',
        });
      }

      const data = parsed.data;
      const expectedUpdatedAt =
        data.expectedUpdatedAt ||
        data.updatedAt ||
        (typeof rawBody.expectedUpdatedAt === 'string' ? rawBody.expectedUpdatedAt : undefined);

      const cleanText = (val: string | null | undefined) =>
        val ? stripRawHtmlFromMarkdown(val).replace(/[<>]/g, '').trim() : '';

      const cleanContact = {
        storeName: cleanText(data.contact.storeName) || 'BAITY',
        hotline: cleanText(data.contact.hotline) || null,
        email: cleanText(data.contact.email) || null,
        address: cleanText(data.contact.address) || null,
        workingHours: cleanText(data.contact.workingHours) || null,
        legalEntityName: cleanText(data.contact.legalEntityName) || null,
        taxId: cleanText(data.contact.taxId) || null,
        returnAddress: cleanText(data.contact.returnAddress) || null,
      };

      const cleanShipping = {
        standardShippingFee: data.shipping.standardShippingFee,
        defaultShippingFee: data.shipping.standardShippingFee,
        expressShippingFee: data.shipping.expressShippingFee,
        freeShippingThreshold: data.shipping.freeShippingThreshold,
      };

      const cleanInventory = {
        lowStockThreshold: data.inventory.lowStockThreshold,
      };

      const cleanBannerText = cleanText(data.bannerText);

      const result = await withTransaction(async (txQueryRows) => {
        await txQueryRows(sql`
          INSERT INTO store_settings (key, value)
          VALUES ('general', '{}'::jsonb)
          ON CONFLICT (key) DO NOTHING;
        `);

        const existingRows = await txQueryRows<{ key: string; value: any; updated_at: string }>(sql`
          SELECT key, value, updated_at
          FROM store_settings
          WHERE key IN ('general', 'contact', 'shipping', 'returns', 'inventory')
          ORDER BY key ASC
          FOR UPDATE;
        `);

        const generalRow = existingRows.find((r) => r.key === 'general') || existingRows[0];
        if (generalRow && !isSameTimestamp(expectedUpdatedAt, generalRow.updated_at)) {
          throwConcurrentModification();
        }

        const oldReturnsRow = existingRows.find((r) => r.key === 'returns');
        const oldGeneralRow = existingRows.find((r) => r.key === 'general');
        const oldReturnDays = Number(
          oldReturnsRow?.value?.returnDaysLimit ??
            oldGeneralRow?.value?.returnDaysLimit ??
            7
        );

        let previousReturnDaysLimit: number | null =
          oldReturnsRow?.value?.previousReturnDaysLimit ?? null;
        let returnPolicyChangedAt: string | null =
          oldReturnsRow?.value?.returnPolicyChangedAt ?? null;

        if (data.returns.returnDaysLimit < oldReturnDays) {
          previousReturnDaysLimit = oldReturnDays;
          returnPolicyChangedAt = new Date().toISOString();
        }

        const cleanReturns = {
          returnDaysLimit: data.returns.returnDaysLimit,
          previousReturnDaysLimit,
          returnPolicyChangedAt,
        };

        const cleanGeneral = {
          storeName: cleanContact.storeName,
          supportEmail: cleanContact.email,
          supportPhone: cleanContact.hotline,
          address: cleanContact.address,
          workingHours: cleanContact.workingHours,
          legalEntityName: cleanContact.legalEntityName,
          taxId: cleanContact.taxId,
          returnAddress: cleanContact.returnAddress,
          standardShippingFee: cleanShipping.standardShippingFee,
          defaultShippingFee: cleanShipping.standardShippingFee,
          expressShippingFee: cleanShipping.expressShippingFee,
          freeShippingThreshold: cleanShipping.freeShippingThreshold,
          returnDaysLimit: cleanReturns.returnDaysLimit,
          lowStockThreshold: cleanInventory.lowStockThreshold,
          bannerText: cleanBannerText || null,
        };

        const oldSummary = {
          contact: existingRows.find((r) => r.key === 'contact')?.value || null,
          shipping: existingRows.find((r) => r.key === 'shipping')?.value || null,
          returns: existingRows.find((r) => r.key === 'returns')?.value || null,
          inventory: existingRows.find((r) => r.key === 'inventory')?.value || null,
        };

        const upsertedGeneralRows = await txQueryRows<{ updated_at: string }>(sql`
          INSERT INTO store_settings (key, value, updated_at)
          VALUES ('general', ${JSON.stringify(cleanGeneral)}::jsonb, clock_timestamp())
          ON CONFLICT (key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = EXCLUDED.updated_at
          RETURNING updated_at;
        `);
        const newTimestamp = upsertedGeneralRows[0].updated_at;

        const subGroups: Array<{ key: string; value: any }> = [
          { key: 'contact', value: cleanContact },
          { key: 'shipping', value: cleanShipping },
          { key: 'returns', value: cleanReturns },
          { key: 'inventory', value: cleanInventory },
        ];

        for (const grp of subGroups) {
          await txQueryRows(sql`
            INSERT INTO store_settings (key, value, updated_at)
            VALUES (${grp.key}, ${JSON.stringify(grp.value)}::jsonb, ${newTimestamp}::timestamptz)
            ON CONFLICT (key) DO UPDATE SET
              value = EXCLUDED.value,
              updated_at = EXCLUDED.updated_at;
          `);
        }

        const newSummary = {
          contact: cleanContact,
          shipping: cleanShipping,
          returns: cleanReturns,
          inventory: cleanInventory,
          bannerText: cleanBannerText || null,
        };

        await insertAdminAuditLogInTx(txQueryRows, {
          adminId,
          action: 'STORE_SETTINGS_UPDATE',
          targetType: 'store_settings',
          targetId: 'general',
          summary: `Cập nhật cài đặt cửa hàng: old=${JSON.stringify(oldSummary)} -> new=${JSON.stringify(newSummary)}`.slice(
            0,
            950
          ),
        });

        return {
          contact: cleanContact,
          shipping: cleanShipping,
          returns: cleanReturns,
          inventory: cleanInventory,
          bannerText: cleanBannerText,
          vietqrReadOnly: getVietQrReadOnlyStatus(),
          updatedAt: newTimestamp,
        };
      });

      return res.json({
        success: true,
        message: 'Cập nhật cài đặt cửa hàng thành công',
        ...result,
        data: result,
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi cập nhật cài đặt cửa hàng');
    }
  });

  // ============================================================================
  // MỤC 8 — QUẢN LÝ NỘI DUNG CHÍNH SÁCH & FAQ (/api/admin/policies & /api/admin/faqs)
  // ============================================================================

  adminRouter.get('/policies', async (_req: AuthRequest, res: Response) => {
    try {
      const [rows, vars] = await Promise.all([
        queryRows<{
          id: string;
          slug: string | null;
          type: string;
          title: string;
          content: string;
          display_order: number | null;
          is_active: boolean;
          updated_at: string;
        }>(sql`
          SELECT id, slug, type, title, content, display_order, is_active, updated_at
          FROM faq_policies
          WHERE type <> 'faq' AND type NOT LIKE 'faq:%'
          ORDER BY display_order ASC NULLS LAST, slug ASC;
        `),
        buildPolicyTemplateVariables(),
      ]);

      const items = rows.map((r) => {
        const cleanSlug = (r.slug || r.type).replace(/^policy:/i, '');
        return {
          id: r.id,
          slug: cleanSlug,
          title: r.title,
          content: r.content,
          interpolatedTitle: interpolatePolicyContent(r.title, vars),
          interpolatedContent: interpolatePolicyContent(r.content, vars),
          displayOrder: r.display_order ?? 1,
          isActive: Boolean(r.is_active),
          updatedAt: r.updated_at,
          canDelete: !DEFAULT_POLICY_SLUGS.includes(cleanSlug as any),
        };
      });

      return res.json({
        success: true,
        items,
        data: items,
        allowedVariables: ALLOWED_POLICY_TEMPLATE_VARIABLES,
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi tải danh sách chính sách');
    }
  });

  adminRouter.get('/policies/:slug', async (req: AuthRequest, res: Response) => {
    try {
      const slug = String(req.params.slug || '').trim().toLowerCase();
      const [rows, vars] = await Promise.all([
        queryRows<{
          id: string;
          slug: string | null;
          type: string;
          title: string;
          content: string;
          display_order: number | null;
          is_active: boolean;
          updated_at: string;
        }>(sql`
          SELECT id, slug, type, title, content, display_order, is_active, updated_at
          FROM faq_policies
          WHERE type <> 'faq' AND (LOWER(COALESCE(slug, '')) = ${slug} OR LOWER(type) = ${slug})
          LIMIT 1;
        `),
        buildPolicyTemplateVariables(),
      ]);

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          code: 'POLICY_NOT_FOUND',
          message: 'Không tìm thấy trang chính sách',
        });
      }

      const r = rows[0];
      const cleanSlug = (r.slug || r.type).replace(/^policy:/i, '');
      const policy = {
        id: r.id,
        slug: cleanSlug,
        title: r.title,
        content: r.content,
        interpolatedTitle: interpolatePolicyContent(r.title, vars),
        interpolatedContent: interpolatePolicyContent(r.content, vars),
        displayOrder: r.display_order ?? 1,
        isActive: Boolean(r.is_active),
        updatedAt: r.updated_at,
        canDelete: !DEFAULT_POLICY_SLUGS.includes(cleanSlug as any),
        allowedVariables: ALLOWED_POLICY_TEMPLATE_VARIABLES,
      };

      return res.json({
        success: true,
        policy,
        data: policy,
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi tải chi tiết chính sách');
    }
  });

  adminRouter.post('/policies/preview', async (req: AuthRequest, res: Response) => {
    try {
      const rawTitle = typeof req.body?.title === 'string' ? req.body.title : '';
      const rawContent = typeof req.body?.content === 'string' ? req.body.content : '';

      const unknownInTitle = findUnknownPolicyTemplateVariables(rawTitle);
      const unknownInContent = findUnknownPolicyTemplateVariables(rawContent);
      const unknownVars = Array.from(new Set([...unknownInTitle, ...unknownInContent]));
      if (unknownVars.length > 0) {
        return res.status(400).json({
          success: false,
          code: 'UNKNOWN_TEMPLATE_VARIABLE',
          message: `Biến mẫu không hợp lệ: ${unknownVars.map((v) => `{{${v}}}`).join(', ')}`,
          unknownVariables: unknownVars,
          allowedVariables: ALLOWED_POLICY_TEMPLATE_VARIABLES,
        });
      }

      const cleanTitle = stripRawHtmlFromMarkdown(rawTitle).replace(/[<>]/g, '').trim();
      const cleanContent = stripRawHtmlFromMarkdown(rawContent);
      const vars = await buildPolicyTemplateVariables();

      const interpolatedTitle = interpolatePolicyContent(cleanTitle, vars);
      const interpolatedContent = interpolatePolicyContent(cleanContent, vars);
      const blocks = parseSafeMarkdownBlocks(interpolatedContent);

      return res.json({
        success: true,
        title: interpolatedTitle,
        content: interpolatedContent,
        blocks,
        variables: vars,
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi xem trước nội dung chính sách');
    }
  });

  adminRouter.put('/policies/:slug', async (req: AuthRequest, res: Response) => {
    try {
      const slug = String(req.params.slug || '').trim().toLowerCase();
      const adminId = req.user!.id;

      const unknownVars = Array.from(
        new Set([
          ...findUnknownPolicyTemplateVariables(String(req.body?.title || '')),
          ...findUnknownPolicyTemplateVariables(String(req.body?.content || '')),
        ])
      );
      if (unknownVars.length > 0) {
        return res.status(400).json({
          success: false,
          code: 'UNKNOWN_TEMPLATE_VARIABLE',
          message: `Biến mẫu không nằm trong danh sách cho phép: ${unknownVars.map((v) => `{{${v}}}`).join(', ')}`,
        });
      }

      const parsed = adminPolicyUpdateSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Dữ liệu chính sách không hợp lệ',
        });
      }

      const data = parsed.data;
      const expectedUpdatedAt =
        data.expectedUpdatedAt ||
        data.updatedAt ||
        (typeof req.body?.expectedUpdatedAt === 'string' ? req.body.expectedUpdatedAt : undefined);

      const cleanTitle = stripRawHtmlFromMarkdown(data.title).replace(/[<>]/g, '').trim();
      const cleanContent = stripRawHtmlFromMarkdown(data.content).trim();

      if (!cleanTitle || !cleanContent) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: 'Tiêu đề và nội dung chính sách không được rỗng sau khi loại bỏ thẻ HTML không hợp lệ',
        });
      }

      const updated = await withTransaction(async (txQueryRows) => {
        const existingRows = await txQueryRows<{
          id: string;
          slug: string | null;
          type: string;
          title: string;
          updated_at: string;
        }>(sql`
          SELECT id, slug, type, title, updated_at
          FROM faq_policies
          WHERE type <> 'faq' AND (LOWER(COALESCE(slug, '')) = ${slug} OR LOWER(type) = ${slug})
          FOR UPDATE;
        `);

        if (existingRows.length === 0) {
          const err: any = new Error('Không tìm thấy trang chính sách');
          err.statusCode = 404;
          err.code = 'POLICY_NOT_FOUND';
          throw err;
        }

        if (!isSameTimestamp(expectedUpdatedAt, existingRows[0].updated_at)) {
          throwConcurrentModification();
        }

        const updatedRows = await txQueryRows<any>(sql`
          UPDATE faq_policies
          SET
            title = ${cleanTitle},
            content = ${cleanContent},
            updated_at = clock_timestamp()
          WHERE id = ${existingRows[0].id}::uuid
          RETURNING
            id,
            slug,
            type,
            title,
            content,
            display_order AS "displayOrder",
            is_active AS "isActive",
            updated_at AS "updatedAt";
        `);

        const row = updatedRows[0];
        const cleanSlug = (row.slug || row.type).replace(/^policy:/i, '');
        await insertAdminAuditLogInTx(txQueryRows, {
          adminId,
          action: 'POLICY_UPDATE',
          targetType: 'faq_policy',
          targetId: row.id,
          summary: `Cập nhật chính sách [${cleanSlug}] "${row.title}" (${cleanContent.length} ký tự)`,
        });

        return { ...row, slug: cleanSlug };
      });

      const vars = await buildPolicyTemplateVariables();
      const responseData = {
        ...updated,
        interpolatedTitle: interpolatePolicyContent(updated.title, vars),
        interpolatedContent: interpolatePolicyContent(updated.content, vars),
      };

      return res.json({
        success: true,
        message: 'Cập nhật nội dung chính sách thành công',
        policy: responseData,
        data: responseData,
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi cập nhật nội dung chính sách');
    }
  });

  adminRouter.post('/policies/:slug/restore', async (req: AuthRequest, res: Response) => {
    try {
      const slug = String(req.params.slug || '').trim().toLowerCase();
      const adminId = req.user!.id;

      const seedItem = SEED_POLICIES_AND_FAQ_ITEMS.find(
        (item) => item.type !== 'faq' && item.slug === slug
      );
      if (!seedItem) {
        return res.status(404).json({
          success: false,
          code: 'SEED_POLICY_NOT_FOUND',
          message: 'Không tìm thấy mẫu chính sách mặc định cho đường dẫn này',
        });
      }

      const restored = await withTransaction(async (txQueryRows) => {
        const updatedRows = await txQueryRows<any>(sql`
          UPDATE faq_policies
          SET
            title = ${seedItem.title},
            content = ${seedItem.content},
            is_active = true,
            updated_at = clock_timestamp()
          WHERE type <> 'faq' AND (LOWER(COALESCE(slug, '')) = ${slug} OR LOWER(type) = ${slug})
          RETURNING
            id,
            slug,
            type,
            title,
            content,
            display_order AS "displayOrder",
            is_active AS "isActive",
            updated_at AS "updatedAt";
        `);

        if (updatedRows.length === 0) {
          const err: any = new Error('Không tìm thấy trang chính sách để khôi phục');
          err.statusCode = 404;
          err.code = 'POLICY_NOT_FOUND';
          throw err;
        }

        const row = updatedRows[0];
        const cleanSlug = (row.slug || row.type).replace(/^policy:/i, '');
        await insertAdminAuditLogInTx(txQueryRows, {
          adminId,
          action: 'POLICY_RESTORE_DEFAULT',
          targetType: 'faq_policy',
          targetId: row.id,
          summary: `Khôi phục nội dung mặc định từ seed cho chính sách [${cleanSlug}]`,
        });

        return { ...row, slug: cleanSlug };
      });

      const vars = await buildPolicyTemplateVariables();
      const responseData = {
        ...restored,
        interpolatedTitle: interpolatePolicyContent(restored.title, vars),
        interpolatedContent: interpolatePolicyContent(restored.content, vars),
      };

      return res.json({
        success: true,
        message: 'Đã khôi phục nội dung mặc định cho chính sách',
        policy: responseData,
        data: responseData,
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi khôi phục nội dung chính sách mặc định');
    }
  });

  // FAQ Management
  adminRouter.get('/faqs', async (_req: AuthRequest, res: Response) => {
    try {
      const [rows, vars] = await Promise.all([
        queryRows<{
          id: string;
          slug: string | null;
          title: string;
          content: string;
          display_order: number | null;
          is_active: boolean;
          updated_at: string;
        }>(sql`
          SELECT id, slug, title, content, display_order, is_active, updated_at
          FROM faq_policies
          WHERE type = 'faq' OR type LIKE 'faq:%'
          ORDER BY display_order ASC NULLS LAST, slug ASC;
        `),
        buildPolicyTemplateVariables(),
      ]);

      const items = rows.map((r) => {
        const parsed = extractFaqTopicAndCleanBody(r.content);
        return {
          id: r.id,
          slug: r.slug,
          title: r.title,
          question: r.title,
          topic: parsed.topic,
          content: parsed.body,
          interpolatedAnswer: interpolatePolicyContent(parsed.body, vars),
          displayOrder: r.display_order ?? 1,
          isActive: Boolean(r.is_active),
          updatedAt: r.updated_at,
        };
      });

      return res.json({
        success: true,
        items,
        data: items,
        allowedTopics: ALLOWED_FAQ_TOPICS,
        allowedVariables: ALLOWED_POLICY_TEMPLATE_VARIABLES,
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi tải danh sách câu hỏi thường gặp');
    }
  });

  adminRouter.post('/faqs', async (req: AuthRequest, res: Response) => {
    try {
      const adminId = req.user!.id;

      const unknownVars = Array.from(
        new Set([
          ...findUnknownPolicyTemplateVariables(String(req.body?.title || '')),
          ...findUnknownPolicyTemplateVariables(String(req.body?.content || '')),
        ])
      );
      if (unknownVars.length > 0) {
        return res.status(400).json({
          success: false,
          code: 'UNKNOWN_TEMPLATE_VARIABLE',
          message: `Biến mẫu không nằm trong danh sách cho phép: ${unknownVars.map((v) => `{{${v}}}`).join(', ')}`,
        });
      }

      const parsed = adminFaqInputSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Dữ liệu câu hỏi FAQ không hợp lệ',
        });
      }

      const data = parsed.data;
      const cleanTitle = stripRawHtmlFromMarkdown(data.title).replace(/[<>]/g, '').trim();
      const cleanBody = stripRawHtmlFromMarkdown(data.content).trim();
      const fullContent = `[Chủ đề: ${data.topic}]\n${cleanBody}`;
      const slug = slugifyFaqTitle(cleanTitle);

      const created = await withTransaction(async (txQueryRows) => {
        const insertedRows = await txQueryRows<any>(sql`
          INSERT INTO faq_policies (
            slug,
            title,
            type,
            content,
            display_order,
            is_active,
            updated_at
          ) VALUES (
            ${slug},
            ${cleanTitle},
            'faq',
            ${fullContent},
            ${data.displayOrder ?? 10},
            ${data.isActive},
            clock_timestamp()
          )
          RETURNING
            id,
            slug,
            title,
            content,
            display_order AS "displayOrder",
            is_active AS "isActive",
            updated_at AS "updatedAt";
        `);

        const row = insertedRows[0];
        await insertAdminAuditLogInTx(txQueryRows, {
          adminId,
          action: 'FAQ_CREATE',
          targetType: 'faq_policy',
          targetId: row.id,
          summary: `Tạo câu hỏi FAQ [${data.topic}] "${cleanTitle}"`,
        });

        return {
          id: row.id,
          slug: row.slug,
          title: row.title,
          question: row.title,
          topic: data.topic,
          content: cleanBody,
          displayOrder: Number(row.displayOrder ?? 10),
          isActive: Boolean(row.isActive),
          updatedAt: row.updatedAt,
        };
      });

      return res.status(201).json({
        success: true,
        message: 'Tạo câu hỏi thường gặp thành công',
        faq: created,
        data: created,
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi tạo câu hỏi thường gặp');
    }
  });

  adminRouter.put('/faqs/:id', async (req: AuthRequest, res: Response) => {
    try {
      const faqId = String(req.params.id || '').trim();
      const adminId = req.user!.id;

      const unknownVars = Array.from(
        new Set([
          ...findUnknownPolicyTemplateVariables(String(req.body?.title || '')),
          ...findUnknownPolicyTemplateVariables(String(req.body?.content || '')),
        ])
      );
      if (unknownVars.length > 0) {
        return res.status(400).json({
          success: false,
          code: 'UNKNOWN_TEMPLATE_VARIABLE',
          message: `Biến mẫu không nằm trong danh sách cho phép: ${unknownVars.map((v) => `{{${v}}}`).join(', ')}`,
        });
      }

      const parsed = adminFaqInputSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message || 'Dữ liệu cập nhật câu hỏi FAQ không hợp lệ',
        });
      }

      const data = parsed.data;
      const expectedUpdatedAt =
        data.expectedUpdatedAt ||
        data.updatedAt ||
        (typeof req.body?.expectedUpdatedAt === 'string' ? req.body.expectedUpdatedAt : undefined);

      const cleanTitle = stripRawHtmlFromMarkdown(data.title).replace(/[<>]/g, '').trim();
      const cleanBody = stripRawHtmlFromMarkdown(data.content).trim();
      const fullContent = `[Chủ đề: ${data.topic}]\n${cleanBody}`;

      const updated = await withTransaction(async (txQueryRows) => {
        const existingRows = await txQueryRows<{ id: string; updated_at: string }>(sql`
          SELECT id, updated_at
          FROM faq_policies
          WHERE id = ${faqId}::uuid AND (type = 'faq' OR type LIKE 'faq:%')
          FOR UPDATE;
        `);

        if (existingRows.length === 0) {
          const err: any = new Error('Không tìm thấy câu hỏi FAQ');
          err.statusCode = 404;
          err.code = 'FAQ_NOT_FOUND';
          throw err;
        }

        if (!isSameTimestamp(expectedUpdatedAt, existingRows[0].updated_at)) {
          throwConcurrentModification();
        }

        const updatedRows = await txQueryRows<any>(sql`
          UPDATE faq_policies
          SET
            title = ${cleanTitle},
            content = ${fullContent},
            display_order = COALESCE(${data.displayOrder ?? null}, display_order),
            is_active = ${data.isActive},
            updated_at = clock_timestamp()
          WHERE id = ${faqId}::uuid
          RETURNING
            id,
            slug,
            title,
            content,
            display_order AS "displayOrder",
            is_active AS "isActive",
            updated_at AS "updatedAt";
        `);

        const row = updatedRows[0];
        await insertAdminAuditLogInTx(txQueryRows, {
          adminId,
          action: 'FAQ_UPDATE',
          targetType: 'faq_policy',
          targetId: row.id,
          summary: `Cập nhật FAQ [${data.topic}] "${cleanTitle}" (isActive=${row.isActive})`,
        });

        return {
          id: row.id,
          slug: row.slug,
          title: row.title,
          question: row.title,
          topic: data.topic,
          content: cleanBody,
          displayOrder: Number(row.displayOrder ?? 10),
          isActive: Boolean(row.isActive),
          updatedAt: row.updatedAt,
        };
      });

      return res.json({
        success: true,
        message: 'Cập nhật câu hỏi thường gặp thành công',
        faq: updated,
        data: updated,
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi cập nhật câu hỏi thường gặp');
    }
  });

  adminRouter.patch('/faqs/:id/visibility', async (req: AuthRequest, res: Response) => {
    try {
      const faqId = String(req.params.id || '').trim();
      const adminId = req.user!.id;
      const isActive = Boolean(req.body?.isActive);

      const updated = await withTransaction(async (txQueryRows) => {
        const updatedRows = await txQueryRows<any>(sql`
          UPDATE faq_policies
          SET
            is_active = ${isActive},
            updated_at = clock_timestamp()
          WHERE id = ${faqId}::uuid AND (type = 'faq' OR type LIKE 'faq:%')
          RETURNING
            id,
            slug,
            title,
            is_active AS "isActive",
            updated_at AS "updatedAt";
        `);

        if (updatedRows.length === 0) {
          const err: any = new Error('Không tìm thấy câu hỏi FAQ');
          err.statusCode = 404;
          err.code = 'FAQ_NOT_FOUND';
          throw err;
        }

        const row = updatedRows[0];
        await insertAdminAuditLogInTx(txQueryRows, {
          adminId,
          action: 'FAQ_VISIBILITY_TOGGLE',
          targetType: 'faq_policy',
          targetId: row.id,
          summary: `${row.isActive ? 'Hiện' : 'Ẩn'} câu hỏi FAQ "${row.title}"`,
        });

        return {
          ...row,
          isActive: Boolean(row.isActive),
        };
      });

      return res.json({
        success: true,
        message: updated.isActive ? 'Đã hiển thị câu hỏi FAQ' : 'Đã ẩn câu hỏi FAQ',
        faq: updated,
        data: updated,
      });
    } catch (err: any) {
      return sendStage8cError(res, err, 'Lỗi cập nhật trạng thái hiển thị FAQ');
    }
  });
}
