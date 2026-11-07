import React, { useState, useEffect, useCallback } from 'react';
import { Ticket, Plus, Edit3, Power, RefreshCw, AlertCircle, CheckCircle2, Search } from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import { formatCurrency, formatDateTime } from './AdminLayout.tsx';

export function utcIsoToGmt7Input(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const gmt7Ms = d.getTime() + 7 * 60 * 60 * 1000;
  return new Date(gmt7Ms).toISOString().slice(0, 16);
}

interface VouchersPageProps {
  onShowToast?: (msg: string) => void;
}

export const VouchersPage: React.FC<VouchersPageProps> = ({ onShowToast }) => {
  const [vouchers, setVouchers] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [editingVoucher, setEditingVoucher] = useState<any | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [confirmToggleVoucher, setConfirmToggleVoucher] = useState<any | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [formState, setFormState] = useState({
    code: '',
    description: '',
    discountType: 'percent' as 'percent' | 'fixed' | 'free_shipping',
    discountValue: 10,
    minOrderValue: 0,
    maxDiscount: '' as string | number,
    usageLimit: '' as string | number,
    perUserLimit: 1,
    startDate: '',
    endDate: '',
    applicableCategoryId: '',
    isActive: true,
    expectedUpdatedAt: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (typeFilter !== 'all') params.set('discountType', typeFilter);
    if (searchQuery.trim()) params.set('q', searchQuery.trim());

    const [vRes, cRes] = await Promise.all([
      apiRequest(`/api/admin/vouchers?${params.toString()}`),
      apiRequest('/api/admin/categories'),
    ]);

    if (!vRes.ok) {
      setError(vRes.errorMessage || 'Không thể tải danh sách mã giảm giá');
    } else {
      setVouchers(vRes.data?.items || []);
    }

    if (cRes.ok) {
      setCategories(cRes.data?.items || []);
    }
    setLoading(false);
  }, [statusFilter, typeFilter, searchQuery]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreateModal = () => {
    const nowGmt7 = utcIsoToGmt7Input(new Date().toISOString());
    const nextMonthGmt7 = utcIsoToGmt7Input(
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    );
    setEditingVoucher(null);
    setFormError(null);
    setFormState({
      code: '',
      description: '',
      discountType: 'percent',
      discountValue: 10,
      minOrderValue: 0,
      maxDiscount: '',
      usageLimit: '',
      perUserLimit: 1,
      startDate: nowGmt7,
      endDate: nextMonthGmt7,
      applicableCategoryId: '',
      isActive: true,
      expectedUpdatedAt: '',
    });
    setIsFormOpen(true);
  };

  const openEditModal = (v: any) => {
    setEditingVoucher(v);
    setFormError(null);
    setFormState({
      code: v.code || '',
      description: v.description || '',
      discountType: v.discountType || 'percent',
      discountValue: Number(v.discountValue || 0),
      minOrderValue: Number(v.minOrderValue || 0),
      maxDiscount: v.maxDiscount !== null && v.maxDiscount !== undefined ? v.maxDiscount : '',
      usageLimit: v.usageLimit !== null && v.usageLimit !== undefined ? v.usageLimit : '',
      perUserLimit: Number(v.perUserLimit ?? 1),
      startDate: utcIsoToGmt7Input(v.startDate),
      endDate: utcIsoToGmt7Input(v.endDate),
      applicableCategoryId: v.applicableCategoryId || '',
      isActive: Boolean(v.isActive),
      expectedUpdatedAt: v.updatedAt || '',
    });
    setIsFormOpen(true);
  };

  const handleSaveVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);

    const payload = {
      code: formState.code.trim().toUpperCase(),
      description: formState.description.trim() || null,
      discountType: formState.discountType,
      discountValue:
        formState.discountType === 'free_shipping' ? 0 : Number(formState.discountValue || 0),
      minOrderValue: Number(formState.minOrderValue || 0),
      maxDiscount:
        formState.maxDiscount === '' || formState.maxDiscount === null
          ? null
          : Number(formState.maxDiscount),
      usageLimit:
        formState.usageLimit === '' || formState.usageLimit === null
          ? null
          : Number(formState.usageLimit),
      perUserLimit: Number(formState.perUserLimit || 1),
      startDate: formState.startDate,
      endDate: formState.endDate,
      applicableCategoryId: formState.applicableCategoryId || null,
      isActive: Boolean(formState.isActive),
      expectedUpdatedAt: formState.expectedUpdatedAt || undefined,
    };

    const res = editingVoucher
      ? await apiRequest(`/api/admin/vouchers/${editingVoucher.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      : await apiRequest('/api/admin/vouchers', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

    setSubmitting(false);
    if (!res.ok) {
      setFormError(res.errorMessage || 'Lỗi lưu mã giảm giá');
      return;
    }

    setIsFormOpen(false);
    onShowToast?.(editingVoucher ? 'Đã cập nhật mã giảm giá' : 'Đã tạo mã giảm giá mới');
    loadData();
  };

  const handleConfirmToggleActive = async () => {
    if (!confirmToggleVoucher) return;
    setSubmitting(true);
    const v = confirmToggleVoucher;
    const res = await apiRequest(`/api/admin/vouchers/${v.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        code: v.code,
        description: v.description || null,
        discountType: v.discountType,
        discountValue: Number(v.discountValue || 0),
        minOrderValue: Number(v.minOrderValue || 0),
        maxDiscount: v.maxDiscount,
        usageLimit: v.usageLimit,
        perUserLimit: Number(v.perUserLimit ?? 1),
        startDate: utcIsoToGmt7Input(v.startDate),
        endDate: utcIsoToGmt7Input(v.endDate),
        applicableCategoryId: v.applicableCategoryId || null,
        isActive: !v.isActive,
        expectedUpdatedAt: v.updatedAt,
      }),
    });
    setSubmitting(false);
    setConfirmToggleVoucher(null);

    if (!res.ok) {
      setError(res.errorMessage || 'Không thể đổi trạng thái voucher');
      return;
    }
    onShowToast?.(v.isActive ? `Đã tắt voucher ${v.code}` : `Đã bật voucher ${v.code}`);
    loadData();
  };

  const isUsed = editingVoucher && Number(editingVoucher.usedCount || 0) > 0;

  return (
    <div className="space-y-6" data-testid="admin-vouchers-page">
      <div className="bg-white rounded-2xl border border-[#E0DCD3] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-[#1A1C19] flex items-center gap-2">
              <Ticket className="w-5 h-5 text-[#2D4A3E]" />
              <span>Quản lý Mã giảm giá (Voucher)</span>
            </h2>
            <p className="text-xs text-[#6B665C] mt-0.5">
              Không xóa cứng voucher (chỉ bật/tắt). Múi giờ nhập liệu: <strong>GMT+7</strong> (lưu chuẩn UTC).
            </p>
          </div>
          <div className="flex items-center gap-2">
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
              data-testid="btn-create-voucher"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#2D4A3E] text-white hover:bg-[#233B31] rounded-lg"
            >
              <Plus className="w-4 h-4" />
              <span>Tạo mã giảm giá</span>
            </button>
          </div>
        </div>

        {/* Bộ lọc */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div className="relative">
            <Search className="w-4 h-4 text-[#8C867A] absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo mã hoặc mô tả..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-[#D8D3C8] rounded-lg bg-[#FAF8F5]"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-xs border border-[#D8D3C8] rounded-lg bg-[#FAF8F5]"
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="active">Đang hiệu lực</option>
            <option value="upcoming">Sắp diễn ra</option>
            <option value="expired">Đã hết hạn</option>
            <option value="inactive">Đang tắt</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 text-xs border border-[#D8D3C8] rounded-lg bg-[#FAF8F5]"
          >
            <option value="all">Tất cả loại giảm giá</option>
            <option value="percent">Giảm theo % (percent)</option>
            <option value="fixed">Giảm tiền cố định (fixed)</option>
            <option value="free_shipping">Miễn phí vận chuyển (free_shipping)</option>
          </select>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-xs text-[#6B665C]">
            Đang tải danh sách mã giảm giá...
          </div>
        ) : vouchers.length === 0 ? (
          <div className="py-12 text-center text-xs text-[#6B665C] bg-[#FAF8F5] rounded-xl border border-dashed border-[#D8D3C8]">
            Chưa có mã giảm giá nào khớp bộ lọc.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E8E4DA] text-[#6B665C]">
                  <th className="py-2.5 px-3">Mã Voucher</th>
                  <th className="py-2.5 px-3">Loại & Mức giảm</th>
                  <th className="py-2.5 px-3">Đơn tối thiểu</th>
                  <th className="py-2.5 px-3">Lượt dùng</th>
                  <th className="py-2.5 px-3">Thời hạn (GMT+7)</th>
                  <th className="py-2.5 px-3">Trạng thái</th>
                  <th className="py-2.5 px-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0ECE1]">
                {vouchers.map((v) => (
                  <tr key={v.id} className="hover:bg-[#FAF8F5]">
                    <td className="py-3 px-3">
                      <div className="font-mono font-bold text-[#1A1C19]">{v.code}</div>
                      {v.description && (
                        <div className="text-[11px] text-[#6B665C] line-clamp-1">{v.description}</div>
                      )}
                      {v.applicableCategoryName && (
                        <div className="text-[10px] text-[#2D4A3E] font-medium">
                          Danh mục: {v.applicableCategoryName}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      {v.discountType === 'percent' && (
                        <span>
                          Giảm {v.discountValue}%
                          {v.maxDiscount ? ` (tối đa ${formatCurrency(v.maxDiscount)})` : ''}
                        </span>
                      )}
                      {v.discountType === 'fixed' && <span>Giảm {formatCurrency(v.discountValue)}</span>}
                      {v.discountType === 'free_shipping' && <span>Miễn phí vận chuyển</span>}
                    </td>
                    <td className="py-3 px-3">{formatCurrency(v.minOrderValue)}</td>
                    <td className="py-3 px-3">
                      <span className="font-semibold">{v.usedCount}</span> /{' '}
                      {v.usageLimit ?? 'Không giới hạn'}
                      <div className="text-[10px] text-[#6B665C]">
                        Tối đa {v.perUserLimit} lượt/người
                      </div>
                    </td>
                    <td className="py-3 px-3 text-[11px]">
                      <div>Từ: {formatDateTime(v.startDate)}</div>
                      <div>Đến: {formatDateTime(v.endDate)}</div>
                    </td>
                    <td className="py-3 px-3">
                      {v.isActive ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 text-[11px] font-semibold">
                          <CheckCircle2 className="w-3 h-3" /> Đang bật
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-stone-100 text-stone-600 text-[11px] font-semibold">
                          Đang tắt
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right space-x-1.5">
                      <button
                        type="button"
                        onClick={() => openEditModal(v)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#F5F2EB] hover:bg-[#EAE5DC] text-[#1A1C19] font-medium"
                      >
                        <Edit3 className="w-3 h-3" /> Sửa
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmToggleVoucher(v)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 font-medium"
                      >
                        <Power className="w-3 h-3" /> {v.isActive ? 'Tắt' : 'Bật'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Hộp thoại xác nhận bật/tắt voucher */}
      {confirmToggleVoucher && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 border border-[#E0DCD3]">
            <h3 className="font-display text-lg font-bold text-[#1A1C19]">
              Xác nhận {confirmToggleVoucher.isActive ? 'tắt' : 'bật'} mã giảm giá
            </h3>
            <p className="text-xs text-[#6B665C] leading-relaxed">
              Bạn có chắc chắn muốn {confirmToggleVoucher.isActive ? 'tắt' : 'kích hoạt lại'} mã{' '}
              <strong>{confirmToggleVoucher.code}</strong>? Thay đổi sẽ có hiệu lực ngay ở trang thanh toán.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmToggleVoucher(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#F5F2EB] text-[#1A1C19]"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmToggleActive}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#2D4A3E] text-white"
              >
                {submitting ? 'Đang xử lý...' : 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal tạo / sửa voucher */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveVoucher}
            className="bg-white rounded-2xl max-w-xl w-full p-6 space-y-4 border border-[#E0DCD3] my-8"
          >
            <h3 className="font-display text-lg font-bold text-[#1A1C19]">
              {editingVoucher ? `Chỉnh sửa Voucher ${editingVoucher.code}` : 'Tạo Mã giảm giá mới'}
            </h3>

            {isUsed && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                Voucher này đã có <strong>{editingVoucher.usedCount}</strong> lượt sử dụng nên hệ thống khóa sửa Mã (code), Loại giảm giá và Mức giảm để bảo toàn lịch sử đối soát.
              </div>
            )}

            {formError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Mã Voucher (A–Z, 0–9, -, _)</label>
                <input
                  type="text"
                  required
                  disabled={Boolean(isUsed)}
                  value={formState.code}
                  onChange={(e) => setFormState({ ...formState, code: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg font-mono uppercase disabled:bg-stone-100"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Loại giảm giá</label>
                <select
                  disabled={Boolean(isUsed)}
                  value={formState.discountType}
                  onChange={(e) =>
                    setFormState({
                      ...formState,
                      discountType: e.target.value as 'percent' | 'fixed' | 'free_shipping',
                    })
                  }
                  className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg disabled:bg-stone-100"
                >
                  <option value="percent">Giảm theo % (1–100)</option>
                  <option value="fixed">Giảm số tiền cố định (VNĐ)</option>
                  <option value="free_shipping">Miễn phí vận chuyển</option>
                </select>
              </div>

              {formState.discountType !== 'free_shipping' && (
                <div>
                  <label className="block font-semibold mb-1">
                    {formState.discountType === 'percent' ? 'Phần trăm giảm (1–100%)' : 'Số tiền giảm (VNĐ)'}
                  </label>
                  <input
                    type="number"
                    required
                    disabled={Boolean(isUsed)}
                    value={formState.discountValue}
                    onChange={(e) => setFormState({ ...formState, discountValue: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg disabled:bg-stone-100"
                  />
                </div>
              )}

              <div>
                <label className="block font-semibold mb-1">Giảm tối đa (VNĐ, tùy chọn)</label>
                <input
                  type="number"
                  value={formState.maxDiscount}
                  onChange={(e) => setFormState({ ...formState, maxDiscount: e.target.value })}
                  placeholder="Để trống nếu không trần"
                  className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Giá trị đơn hàng tối thiểu (VNĐ)</label>
                <input
                  type="number"
                  min={0}
                  value={formState.minOrderValue}
                  onChange={(e) => setFormState({ ...formState, minOrderValue: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Tổng lượt sử dụng tối đa</label>
                <input
                  type="number"
                  min={1}
                  value={formState.usageLimit}
                  onChange={(e) => setFormState({ ...formState, usageLimit: e.target.value })}
                  placeholder="Để trống = Không giới hạn"
                  className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Giới hạn mỗi tài khoản (&gt;= 1)</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={formState.perUserLimit}
                  onChange={(e) => setFormState({ ...formState, perUserLimit: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Danh mục áp dụng (tùy chọn)</label>
                <select
                  value={formState.applicableCategoryId}
                  onChange={(e) => setFormState({ ...formState, applicableCategoryId: e.target.value })}
                  className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
                >
                  <option value="">Toàn bộ cửa hàng</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold mb-1">Thời gian bắt đầu (GMT+7)</label>
                <input
                  type="datetime-local"
                  required
                  value={formState.startDate}
                  onChange={(e) => setFormState({ ...formState, startDate: e.target.value })}
                  className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Thời gian kết thúc (GMT+7)</label>
                <input
                  type="datetime-local"
                  required
                  value={formState.endDate}
                  onChange={(e) => setFormState({ ...formState, endDate: e.target.value })}
                  className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
                />
              </div>
            </div>

            <div className="text-xs">
              <label className="block font-semibold mb-1">Mô tả ngắn (&lt;= 200 ký tự, văn bản thuần)</label>
              <input
                type="text"
                maxLength={200}
                value={formState.description}
                onChange={(e) => setFormState({ ...formState, description: e.target.value })}
                className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
              />
            </div>

            <label className="inline-flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={formState.isActive}
                onChange={(e) => setFormState({ ...formState, isActive: e.target.checked })}
              />
              <span>Kích hoạt mã giảm giá ngay</span>
            </label>

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
                {submitting ? 'Đang lưu...' : 'Lưu Voucher'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
