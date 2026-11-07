import React, { useState, useEffect, useCallback } from 'react';
import { Flame, Plus, Edit3, StopCircle, Eye, RefreshCw, AlertCircle, Trash2 } from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import { formatCurrency, formatDateTime } from './AdminLayout.tsx';
import { utcIsoToGmt7Input } from './VouchersPage.tsx';

interface PromotionsPageProps {
  onShowToast?: (msg: string) => void;
}

export const PromotionsPage: React.FC<PromotionsPageProps> = ({ onShowToast }) => {
  const [promotions, setPromotions] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const [editingPromo, setEditingPromo] = useState<any | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [confirmEndEarlyPromo, setConfirmEndEarlyPromo] = useState<any | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<any | null>(null);

  const [formState, setFormState] = useState({
    title: '',
    startTime: '',
    endTime: '',
    isActive: true,
    expectedUpdatedAt: '',
    targets: [
      {
        targetType: 'category' as 'product' | 'category',
        targetId: '',
        discountPercent: 15,
      },
    ],
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [promoRes, prodRes, catRes] = await Promise.all([
      apiRequest(`/api/admin/promotions?status=${statusFilter}`),
      apiRequest('/api/admin/products?limit=50'),
      apiRequest('/api/admin/categories'),
    ]);

    if (!promoRes.ok) {
      setError(promoRes.errorMessage || 'Không thể tải danh sách khuyến mãi');
    } else {
      setPromotions(promoRes.data?.items || []);
    }
    if (prodRes.ok) setProducts(prodRes.data?.items || []);
    if (catRes.ok) setCategories(catRes.data?.items || []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreateModal = () => {
    const nowGmt7 = utcIsoToGmt7Input(new Date().toISOString());
    const nextWeekGmt7 = utcIsoToGmt7Input(
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    );
    setEditingPromo(null);
    setFormError(null);
    setPreviewResult(null);
    setFormState({
      title: '',
      startTime: nowGmt7,
      endTime: nextWeekGmt7,
      isActive: true,
      expectedUpdatedAt: '',
      targets: [
        {
          targetType: 'category',
          targetId: categories[0]?.id || '',
          discountPercent: 15,
        },
      ],
    });
    setIsFormOpen(true);
  };

  const openEditModal = (p: any) => {
    setEditingPromo(p);
    setFormError(null);
    setPreviewResult(null);
    setFormState({
      title: p.title || '',
      startTime: utcIsoToGmt7Input(p.startTime),
      endTime: utcIsoToGmt7Input(p.endTime),
      isActive: Boolean(p.isActive),
      expectedUpdatedAt: p.updatedAt || '',
      targets:
        Array.isArray(p.targets) && p.targets.length > 0
          ? p.targets.map((t: any) => ({
              targetType: t.targetType,
              targetId: t.targetId,
              discountPercent: Number(t.discountPercent || 10),
            }))
          : [
              {
                targetType: 'category',
                targetId: categories[0]?.id || '',
                discountPercent: 15,
              },
            ],
    });
    setIsFormOpen(true);
  };

  const handlePreviewTargets = async () => {
    setFormError(null);
    const res = await apiRequest('/api/admin/promotions/preview', {
      method: 'POST',
      body: JSON.stringify({ targets: formState.targets }),
    });
    if (!res.ok) {
      setFormError(res.errorMessage || 'Không thể xem trước phạm vi khuyến mãi');
      return;
    }
    setPreviewResult(res.data);
  };

  const handleSavePromotion = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);

    const payload = {
      title: formState.title.trim(),
      startTime: formState.startTime,
      endTime: formState.endTime,
      isActive: formState.isActive,
      targets: formState.targets.map((t) => ({
        targetType: t.targetType,
        targetId: t.targetId,
        discountPercent: Number(t.discountPercent),
      })),
      expectedUpdatedAt: formState.expectedUpdatedAt || undefined,
    };

    const res = editingPromo
      ? await apiRequest(`/api/admin/promotions/${editingPromo.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      : await apiRequest('/api/admin/promotions', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

    setSubmitting(false);
    if (!res.ok) {
      setFormError(res.errorMessage || 'Lỗi lưu chương trình khuyến mãi');
      return;
    }

    setIsFormOpen(false);
    onShowToast?.(
      editingPromo ? 'Đã cập nhật chương trình khuyến mãi' : 'Đã tạo chương trình khuyến mãi'
    );
    loadData();
  };

  const handleConfirmEndEarly = async () => {
    if (!confirmEndEarlyPromo) return;
    setSubmitting(true);
    const res = await apiRequest(`/api/admin/promotions/${confirmEndEarlyPromo.id}/end-early`, {
      method: 'POST',
    });
    setSubmitting(false);
    setConfirmEndEarlyPromo(null);

    if (!res.ok) {
      setError(res.errorMessage || 'Không thể kết thúc sớm chương trình khuyến mãi');
      return;
    }
    onShowToast?.(`Đã kết thúc sớm chương trình "${confirmEndEarlyPromo.title}"`);
    loadData();
  };

  return (
    <div className="space-y-6" data-testid="admin-promotions-page">
      <div className="bg-white rounded-2xl border border-[#E0DCD3] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-[#1A1C19] flex items-center gap-2">
              <Flame className="w-5 h-5 text-[#C27D56]" />
              <span>Chương trình Khuyến mãi & Flash Sale</span>
            </h2>
            <p className="text-xs text-[#6B665C] mt-0.5">
              Hiệu lực tức thì trên cửa hàng, giỏ hàng, thanh toán, chatbot và tìm kiếm bằng ảnh. Thời gian nhập theo <strong>GMT+7</strong> (tối đa 90 ngày).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-[#D8D3C8] rounded-lg bg-[#FAF8F5]"
            >
              <option value="all">Tất cả chương trình</option>
              <option value="active">Đang diễn ra</option>
              <option value="upcoming">Sắp diễn ra</option>
              <option value="ended">Đã kết thúc / Đã tắt</option>
            </select>
            <button
              type="button"
              onClick={loadData}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-[#F5F2EB] hover:bg-[#EAE5DC] rounded-lg"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Làm mới</span>
            </button>
            <button
              type="button"
              data-testid="btn-create-promotion"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#2D4A3E] text-white hover:bg-[#233B31] rounded-lg"
            >
              <Plus className="w-4 h-4" />
              <span>Tạo khuyến mãi</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-xs text-[#6B665C]">
            Đang tải danh sách khuyến mãi...
          </div>
        ) : promotions.length === 0 ? (
          <div className="py-12 text-center text-xs text-[#6B665C] bg-[#FAF8F5] rounded-xl border border-dashed border-[#D8D3C8]">
            Chưa có chương trình khuyến mãi nào.
          </div>
        ) : (
          <div className="space-y-3">
            {promotions.map((p) => (
              <div
                key={p.id}
                className="p-4 rounded-xl border border-[#E8E4DA] bg-[#FAF8F5] flex flex-wrap items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-[#1A1C19]">{p.title}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        p.isActive
                          ? 'bg-emerald-50 text-emerald-800'
                          : 'bg-stone-200 text-stone-700'
                      }`}
                    >
                      {p.isActive ? 'Đang kích hoạt' : 'Đã kết thúc / Tắt'}
                    </span>
                  </div>
                  <div className="text-xs text-[#6B665C]">
                    Thời gian (GMT+7): {formatDateTime(p.startTime)} → {formatDateTime(p.endTime)}
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(p.targets || []).map((t: any, idx: number) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded bg-white border border-[#E0DCD3] text-[11px]"
                      >
                        {t.targetType === 'category' ? 'Danh mục' : 'Sản phẩm'}:{' '}
                        <strong>{t.targetName || t.targetId}</strong> (-{t.discountPercent}%)
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openEditModal(p)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-[#D8D3C8] text-xs font-semibold"
                  >
                    <Edit3 className="w-3.5 h-3.5" /> Sửa
                  </button>
                  {p.isActive && (
                    <button
                      type="button"
                      onClick={() => setConfirmEndEarlyPromo(p)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-semibold"
                    >
                      <StopCircle className="w-3.5 h-3.5" /> Kết thúc sớm
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Xác nhận kết thúc sớm */}
      {confirmEndEarlyPromo && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 border border-[#E0DCD3]">
            <h3 className="font-display text-lg font-bold text-[#1A1C19]">
              Xác nhận kết thúc sớm chương trình khuyến mãi
            </h3>
            <p className="text-xs text-[#6B665C] leading-relaxed">
              Bạn có chắc chắn muốn kết thúc sớm chương trình{' '}
              <strong>{confirmEndEarlyPromo.title}</strong>? Giá khuyến mãi sẽ ngừng áp dụng ngay lập tức cho các lượt mua mới (các đơn hàng đã đặt trước đó giữ nguyên giá đã chốt).
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmEndEarlyPromo(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#F5F2EB]"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmEndEarly}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-700 text-white"
              >
                {submitting ? 'Đang xử lý...' : 'Kết thúc ngay'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal tạo / sửa khuyến mãi */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSavePromotion}
            className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-4 border border-[#E0DCD3] my-8"
          >
            <h3 className="font-display text-lg font-bold text-[#1A1C19]">
              {editingPromo ? 'Cập nhật Chương trình Khuyến mãi' : 'Tạo Chương trình Khuyến mãi mới'}
            </h3>

            {formError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-semibold mb-1">
                  Tên chương trình (&lt;= 120 ký tự, văn bản thuần)
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={formState.title}
                  onChange={(e) => setFormState({ ...formState, title: e.target.value })}
                  className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Thời gian bắt đầu (GMT+7)</label>
                <input
                  type="datetime-local"
                  required
                  value={formState.startTime}
                  onChange={(e) => setFormState({ ...formState, startTime: e.target.value })}
                  className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">
                  Thời gian kết thúc (GMT+7, tối đa 90 ngày)
                </label>
                <input
                  type="datetime-local"
                  required
                  value={formState.endTime}
                  onChange={(e) => setFormState({ ...formState, endTime: e.target.value })}
                  className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
                />
              </div>
            </div>

            {/* Mục tiêu khuyến mãi */}
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <label className="font-semibold">Mục tiêu áp dụng (1% – 80%, số nguyên)</label>
                <button
                  type="button"
                  onClick={() =>
                    setFormState({
                      ...formState,
                      targets: [
                        ...formState.targets,
                        {
                          targetType: 'product',
                          targetId: products[0]?.id || '',
                          discountPercent: 10,
                        },
                      ],
                    })
                  }
                  className="text-[#2D4A3E] font-semibold hover:underline"
                >
                  + Thêm mục tiêu
                </button>
              </div>

              {formState.targets.map((t, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-center">
                  <select
                    value={t.targetType}
                    onChange={(e) => {
                      const nextType = e.target.value as 'product' | 'category';
                      const nextTargets = [...formState.targets];
                      nextTargets[index] = {
                        ...t,
                        targetType: nextType,
                        targetId:
                          nextType === 'category'
                            ? categories[0]?.id || ''
                            : products[0]?.id || '',
                      };
                      setFormState({ ...formState, targets: nextTargets });
                    }}
                    className="col-span-3 px-2 py-2 border border-[#D8D3C8] rounded-lg"
                  >
                    <option value="category">Danh mục</option>
                    <option value="product">Sản phẩm</option>
                  </select>

                  <select
                    value={t.targetId}
                    onChange={(e) => {
                      const nextTargets = [...formState.targets];
                      nextTargets[index] = { ...t, targetId: e.target.value };
                      setFormState({ ...formState, targets: nextTargets });
                    }}
                    className="col-span-6 px-2 py-2 border border-[#D8D3C8] rounded-lg"
                  >
                    <option value="">-- Chọn mục tiêu --</option>
                    {t.targetType === 'category'
                      ? categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))
                      : products.map((pr) => (
                          <option key={pr.id} value={pr.id}>
                            {pr.name}
                          </option>
                        ))}
                  </select>

                  <input
                    type="number"
                    min={1}
                    max={80}
                    required
                    value={t.discountPercent}
                    onChange={(e) => {
                      const nextTargets = [...formState.targets];
                      nextTargets[index] = { ...t, discountPercent: Number(e.target.value) };
                      setFormState({ ...formState, targets: nextTargets });
                    }}
                    className="col-span-2 px-2 py-2 border border-[#D8D3C8] rounded-lg"
                  />

                  {formState.targets.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setFormState({
                          ...formState,
                          targets: formState.targets.filter((_, i) => i !== index),
                        })
                      }
                      className="col-span-1 text-red-600 hover:text-red-800 flex justify-center"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Xem trước phạm vi ảnh hưởng */}
            <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E8E4DA] space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#1A1C19]">
                  Xem trước phạm vi ảnh hưởng trước khi lưu
                </span>
                <button
                  type="button"
                  onClick={handlePreviewTargets}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded bg-[#2D4A3E] text-white font-semibold"
                >
                  <Eye className="w-3.5 h-3.5" /> Tính thử phạm vi
                </button>
              </div>
              {previewResult && (
                <div className="pt-1 text-[#4A4740] space-y-1">
                  <div>
                    Số sản phẩm bị ảnh hưởng:{' '}
                    <strong>{previewResult.affectedProductCount} sản phẩm</strong>
                  </div>
                  {previewResult.exampleProduct && (
                    <div>
                      Ví dụ sản phẩm: <strong>{previewResult.exampleProduct.name}</strong> — Giá gốc{' '}
                      {formatCurrency(previewResult.exampleProduct.priceBefore)} → Giá sau giảm (-
                      {previewResult.exampleProduct.discountPercent}%):{' '}
                      <strong className="text-[#2D4A3E]">
                        {formatCurrency(previewResult.exampleProduct.priceAfter)}
                      </strong>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[#E8E4DA]">
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#F5F2EB]"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#2D4A3E] text-white"
              >
                {submitting ? 'Đang lưu...' : 'Lưu Khuyến mãi'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
