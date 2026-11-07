import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, History, PlusCircle } from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import { STOCK_REASON_LABELS, formatDateTime } from './AdminLayout.tsx';

interface InventoryPageProps {
  onRefreshOverview: () => void;
  onShowToast?: (msg: string) => void;
  initialFilterMode?: 'all' | 'low' | 'out';
}

export const InventoryPage: React.FC<InventoryPageProps> = ({
  onRefreshOverview,
  onShowToast,
  initialFilterMode = 'all',
}) => {
  const [variants, setVariants] = useState<any[]>([]);
  const [filterMode, setFilterMode] = useState<'all' | 'low' | 'out'>(initialFilterMode);
  const [threshold, setThreshold] = useState('5');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFilterMode(initialFilterMode);
  }, [initialFilterMode]);

  const [selectedVariant, setSelectedVariant] = useState<any | null>(null);
  const [deltaInput, setDeltaInput] = useState('5');
  const [reasonInput, setReasonInput] = useState('manual_import');
  const [noteInput, setNoteInput] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const [movementsVariant, setMovementsVariant] = useState<any | null>(null);
  const [movements, setMovements] = useState<any[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setError(null);
    const sp = new URLSearchParams();
    if (filterMode !== 'all') sp.set('stockFilter', filterMode);
    sp.set('lowStockThreshold', threshold || '5');
    sp.set('limit', '100');

    const res = await apiRequest(`/api/admin/inventory?${sp.toString()}`);
    setLoading(false);
    if (!res.ok) {
      setError(res.errorMessage || 'Không thể tải danh sách tồn kho');
      return;
    }
    setVariants(Array.isArray(res.data?.items) ? res.data.items : []);
  }, [filterMode, threshold]);

  useEffect(() => {
    loadInventory();
  }, [loadInventory]);

  const loadMovements = async (variant: any) => {
    setMovementsVariant(variant);
    setMovementsLoading(true);
    const res = await apiRequest(
      `/api/admin/variants/${encodeURIComponent(variant.id)}/stock-movements`
    );
    setMovementsLoading(false);
    if (res.ok) {
      setMovements(Array.isArray(res.data?.items) ? res.data.items : []);
    }
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVariant) return;
    setAdjustError(null);
    const delta = Number(deltaInput);
    if (!Number.isInteger(delta) || delta === 0) {
      setAdjustError('Số lượng điều chỉnh (delta) phải là số nguyên khác 0');
      return;
    }

    setAdjusting(true);
    const res = await apiRequest(
      `/api/admin/variants/${encodeURIComponent(selectedVariant.id)}/stock-adjust`,
      {
        method: 'POST',
        body: JSON.stringify({
          delta,
          reason: reasonInput,
          note: noteInput.trim() || undefined,
        }),
      }
    );
    setAdjusting(false);

    if (!res.ok) {
      setAdjustError(res.errorMessage || 'Không thể điều chỉnh tồn kho');
      return;
    }

    onShowToast?.(res.data?.message || 'Đã điều chỉnh tồn kho thành công');
    setSelectedVariant(null);
    setNoteInput('');
    await loadInventory();
    onRefreshOverview();
    if (movementsVariant && movementsVariant.id === selectedVariant.id) {
      await loadMovements(selectedVariant);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-8 bg-white rounded-2xl border border-[#E0DCD3] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A1C19]">
              Quản lý Tồn kho Biến thể ({variants.length})
            </h2>
            <p className="text-xs text-[#6B665C]">
              Mọi thay đổi số lượng tồn kho đều thực hiện qua `stock-adjust` nguyên tử (`stock_quantity + delta &gt;= 0`) và ghi `stock_movements`.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as any)}
              className="px-3 py-1.5 text-xs border border-[#D5D0C5] rounded-lg bg-white"
            >
              <option value="all">Tất cả biến thể</option>
              <option value="low">Sắp hết hàng (&lt;= ngưỡng)</option>
              <option value="out">Hết hàng (= 0)</option>
            </select>
            <input
              type="number"
              min={1}
              max={100}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-16 px-2 py-1.5 text-xs border border-[#D5D0C5] rounded-lg"
              title="Ngưỡng sắp hết hàng"
            />
            <button
              type="button"
              onClick={loadInventory}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#F5F2EB] hover:bg-[#EAE5DC] rounded-lg"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Làm mới</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-10 text-center text-xs text-[#6B665C]">Đang tải tồn kho...</div>
        ) : error ? (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {error}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#EAE6DE] text-[#6B665C]">
                  <th className="py-2 px-2.5 font-semibold">SKU</th>
                  <th className="py-2 px-2.5 font-semibold">Sản phẩm & Phân loại</th>
                  <th className="py-2 px-2.5 font-semibold">Tồn kho</th>
                  <th className="py-2 px-2.5 font-semibold text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2EFE9]">
                {variants.map((v) => (
                  <tr key={v.id} className="hover:bg-[#FAF8F5]">
                    <td className="py-2.5 px-2.5 font-mono font-bold text-[#1A1C19]">
                      {v.sku}
                    </td>
                    <td className="py-2.5 px-2.5">
                      <div className="font-semibold text-[#1A1C19]">{v.productName}</div>
                      <div className="text-[11px] text-[#6B665C]">
                        Màu: {v.color} · Size: {v.size}
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5">
                      <span
                        className={`px-2 py-0.5 rounded font-bold ${
                          v.stockQuantity === 0
                            ? 'bg-red-100 text-red-800'
                            : v.stockQuantity <= Number(threshold || 5)
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-emerald-50 text-emerald-800'
                        }`}
                      >
                        {v.stockQuantity}
                      </span>
                    </td>
                    <td className="py-2.5 px-2.5 text-right space-x-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedVariant(v);
                          setAdjustError(null);
                          setDeltaInput('5');
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#2D4A3E] text-white font-semibold rounded-md"
                      >
                        <PlusCircle className="w-3 h-3" />
                        <span>Điều chỉnh</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => loadMovements(v)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#F5F2EB] hover:bg-[#EAE5DC] font-semibold rounded-md"
                      >
                        <History className="w-3 h-3" />
                        <span>Lịch sử</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cột phải: Form điều chỉnh & Lịch sử biến động */}
      <div className="lg:col-span-4 space-y-6">
        {selectedVariant && (
          <form
            onSubmit={handleAdjustStock}
            className="bg-white rounded-2xl border border-[#2D4A3E] p-5 space-y-3 text-xs shadow-sm"
          >
            <div className="font-bold text-sm text-[#1A1C19]">
              Điều chỉnh kho: {selectedVariant.sku}
            </div>
            <div className="text-[#6B665C]">
              {selectedVariant.productName} ({selectedVariant.color} / {selectedVariant.size}) — Tồn hiện tại:{' '}
              <strong>{selectedVariant.stockQuantity}</strong>
            </div>

            {adjustError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {adjustError}
              </div>
            )}

            <div>
              <label className="block font-semibold mb-1">
                Số lượng thay đổi (`delta`, dương để nhập, âm để xuất) *
              </label>
              <input
                type="number"
                required
                value={deltaInput}
                onChange={(e) => setDeltaInput(e.target.value)}
                className="w-full px-3 py-2 border border-[#D5D0C5] rounded-lg font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Lý do điều chỉnh *</label>
              <select
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                className="w-full px-3 py-2 border border-[#D5D0C5] rounded-lg bg-white"
              >
                <option value="manual_import">Nhập kho thủ công (manual_import)</option>
                <option value="inventory_audit">Kiểm kê kho (inventory_audit)</option>
                <option value="damaged">Hàng lỗi / Hư hỏng (damaged)</option>
                <option value="other">Lý do khác (other - bắt buộc ghi chú)</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold mb-1">
                Ghi chú {reasonInput === 'other' ? '(bắt buộc) *' : '(tùy chọn)'}
              </label>
              <input
                type="text"
                required={reasonInput === 'other'}
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                className="w-full px-3 py-2 border border-[#D5D0C5] rounded-lg"
                placeholder="Nhập ghi chú phiếu kho..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedVariant(null)}
                className="px-3 py-1.5 border border-[#D5D0C5] rounded-lg font-semibold"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={adjusting}
                className="px-3.5 py-1.5 bg-[#2D4A3E] text-white rounded-lg font-semibold disabled:opacity-50"
              >
                Xác nhận điều chỉnh
              </button>
            </div>
          </form>
        )}

        <div className="bg-white rounded-2xl border border-[#E0DCD3] p-5 space-y-3 text-xs">
          <div className="font-bold text-sm text-[#1A1C19]">
            Lịch sử biến động kho (`stock_movements`)
          </div>
          {!movementsVariant ? (
            <div className="text-[#6B665C]">
              Nhấn nút &ldquo;Lịch sử&rdquo; ở một biến thể để xem chi tiết biến động kho.
            </div>
          ) : movementsLoading ? (
            <div className="text-[#6B665C]">Đang tải lịch sử...</div>
          ) : movements.length === 0 ? (
            <div className="text-[#6B665C]">Chưa có biến động kho nào cho {movementsVariant.sku}.</div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {movements.map((m) => (
                <div
                  key={m.id}
                  className="p-2.5 rounded-lg bg-[#FAF8F5] border border-[#EAE6DE] space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`font-mono font-bold ${
                        m.delta > 0 ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {m.delta > 0 ? `+${m.delta}` : m.delta} (Tồn: {m.previousQuantity} →{' '}
                      {m.newQuantity})
                    </span>
                    <span className="text-[11px] text-[#6B665C]">
                      {formatDateTime(m.createdAt)}
                    </span>
                  </div>
                  <div className="font-semibold text-[#2D4A3E]">
                    {STOCK_REASON_LABELS[m.reason] || m.reason}
                  </div>
                  {m.note && <div className="text-[#4A4740]">{m.note}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
