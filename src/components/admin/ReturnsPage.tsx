import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle2, XCircle, PackageCheck, CreditCard } from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import {
  RETURN_STATUS_LABELS,
  formatCurrency,
  formatDateTime,
} from './AdminLayout.tsx';

interface ReturnsPageProps {
  onRefreshOverview: () => void;
  onShowToast?: (msg: string) => void;
  initialStatusFilter?: string;
}

export const ReturnsPage: React.FC<ReturnsPageProps> = ({
  onRefreshOverview,
  onShowToast,
  initialStatusFilter = 'all',
}) => {
  const [returnItems, setReturnItems] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatusFilter(initialStatusFilter);
  }, [initialStatusFilter]);

  const [decisionModal, setDecisionModal] = useState<{
    returnId: string;
    orderId: string;
    mode: 'approve' | 'reject' | 'receive';
  } | null>(null);
  const [refundShippingFeeChoice, setRefundShippingFeeChoice] = useState(false);
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');
  const [restoreStockChoice, setRestoreStockChoice] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadReturns = useCallback(async () => {
    setLoading(true);
    setError(null);
    const sp = new URLSearchParams();
    if (statusFilter !== 'all') sp.set('status', statusFilter);
    const res = await apiRequest(`/api/admin/returns?${sp.toString()}`);
    setLoading(false);
    if (!res.ok) {
      setError(res.errorMessage || 'Không thể tải danh sách đổi trả');
      return;
    }
    setReturnItems(Array.isArray(res.data?.items) ? res.data.items : []);
  }, [statusFilter]);

  useEffect(() => {
    loadReturns();
  }, [loadReturns]);

  const handleSubmitModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!decisionModal) return;
    setModalError(null);
    setSubmitting(true);

    const { returnId, mode } = decisionModal;
    let res;
    if (mode === 'approve' || mode === 'reject') {
      res = await apiRequest(`/api/admin/returns/${encodeURIComponent(returnId)}/decision`, {
        method: 'PUT',
        body: JSON.stringify({
          decision: mode,
          refundShippingFee: mode === 'approve' ? refundShippingFeeChoice : false,
          rejectionReason: mode === 'reject' ? rejectionReasonInput.trim() : undefined,
        }),
      });
    } else {
      res = await apiRequest(`/api/admin/returns/${encodeURIComponent(returnId)}/receive`, {
        method: 'POST',
        body: JSON.stringify({
          restoreStock: restoreStockChoice,
        }),
      });
    }

    setSubmitting(false);
    if (!res.ok) {
      setModalError(res.errorMessage || 'Không thể thực hiện thao tác');
      return;
    }

    onShowToast?.(res.data?.message || 'Đã cập nhật yêu cầu đổi trả');
    setDecisionModal(null);
    setRejectionReasonInput('');
    await loadReturns();
    onRefreshOverview();
  };

  const handleMarkRefunded = async (returnId: string) => {
    const res = await apiRequest(`/api/admin/returns/${encodeURIComponent(returnId)}/refund`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      onShowToast?.(res.errorMessage || 'Không thể xác nhận hoàn tiền');
      return;
    }
    onShowToast?.(res.data?.message || 'Đã đánh dấu hoàn tiền thành công');
    await loadReturns();
    onRefreshOverview();
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E0DCD3] p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-[#1A1C19]">
            Quản lý Đổi trả & Hoàn tiền ({returnItems.length})
          </h2>
          <p className="text-xs text-[#6B665C]">
            Số tiền hoàn trả do Server tự động tính theo công thức phân bổ giảm giá và tùy chọn hoàn phí vận chuyển.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 text-xs border border-[#D5D0C5] rounded-lg bg-white"
          >
            <option value="all">Tất cả trạng thái</option>
            {Object.entries(RETURN_STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={loadReturns}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#F5F2EB] hover:bg-[#EAE5DC] rounded-lg"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-xs text-[#6B665C]">Đang tải danh sách...</div>
      ) : error ? (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
          {error}
        </div>
      ) : returnItems.length === 0 ? (
        <div className="py-10 text-center text-xs text-[#6B665C]">
          Chưa có yêu cầu đổi trả / hoàn tiền nào.
        </div>
      ) : (
        <div className="space-y-3">
          {returnItems.map((ret) => (
            <div
              key={ret.id}
              className="p-4 rounded-xl border border-[#EAE6DE] bg-[#FAF8F5] flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-[#1A1C19]">{ret.id}</span>
                  <span className="text-[#6B665C]">· Đơn #{ret.orderId}</span>
                  <span className="px-2 py-0.5 rounded bg-[#2D4A3E] text-white font-semibold">
                    {RETURN_STATUS_LABELS[ret.status] || ret.status}
                  </span>
                </div>
                <div>
                  <strong>Lý do:</strong> {ret.reason}
                </div>
                <div>
                  <strong>Số tiền hoàn dự kiến (Server tính):</strong>{' '}
                  <span className="font-bold text-[#2D4A3E]">
                    {formatCurrency(ret.refundAmount)}
                  </span>{' '}
                  · Tạo lúc: {formatDateTime(ret.createdAt)}
                </div>
                {ret.rejectionReason && (
                  <div className="text-red-700">
                    <strong>Lý do từ chối:</strong> {ret.rejectionReason}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {ret.status === 'pending' && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setModalError(null);
                        setRefundShippingFeeChoice(false);
                        setDecisionModal({
                          returnId: ret.id,
                          orderId: ret.orderId,
                          mode: 'approve',
                        });
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#2D4A3E] text-white font-semibold rounded-lg"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Duyệt đổi trả</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setModalError(null);
                        setRejectionReasonInput('');
                        setDecisionModal({
                          returnId: ret.id,
                          orderId: ret.orderId,
                          mode: 'reject',
                        });
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white font-semibold rounded-lg"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Từ chối</span>
                    </button>
                  </>
                )}

                {ret.status === 'approved' && (
                  <button
                    type="button"
                    onClick={() => {
                      setModalError(null);
                      setRestoreStockChoice(true);
                      setDecisionModal({
                        returnId: ret.id,
                        orderId: ret.orderId,
                        mode: 'receive',
                      });
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#2D4A3E] text-white font-semibold rounded-lg"
                  >
                    <PackageCheck className="w-3.5 h-3.5" />
                    <span>Đã nhận hàng trả</span>
                  </button>
                )}

                {(ret.status === 'approved' || ret.status === 'receiving') && (
                  <button
                    type="button"
                    onClick={() => handleMarkRefunded(ret.id)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#C27D56] text-white font-semibold rounded-lg"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>Đánh dấu Đã hoàn tiền</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {decisionModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitModal}
            className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 border border-[#E0DCD3] shadow-xl text-xs"
          >
            <div className="font-bold text-sm text-[#1A1C19]">
              {decisionModal.mode === 'approve'
                ? 'Duyệt yêu cầu đổi trả'
                : decisionModal.mode === 'reject'
                ? 'Từ chối yêu cầu đổi trả'
                : 'Xác nhận đã nhận hàng trả về kho'}
            </div>

            {modalError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {modalError}
              </div>
            )}

            {decisionModal.mode === 'approve' && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={refundShippingFeeChoice}
                  onChange={(e) => setRefundShippingFeeChoice(e.target.checked)}
                />
                <span>Hoàn cả phí vận chuyển (lỗi từ phía cửa hàng / nhà sản xuất)</span>
              </label>
            )}

            {decisionModal.mode === 'reject' && (
              <div>
                <label className="block font-semibold mb-1">
                  Lý do từ chối (bắt buộc) *
                </label>
                <textarea
                  rows={3}
                  required
                  value={rejectionReasonInput}
                  onChange={(e) => setRejectionReasonInput(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D5D0C5] rounded-lg"
                  placeholder="Nhập lý do từ chối yêu cầu đổi trả..."
                />
              </div>
            )}

            {decisionModal.mode === 'receive' && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={restoreStockChoice}
                  onChange={(e) => setRestoreStockChoice(e.target.checked)}
                />
                <span>Cộng lại số lượng vào tồn kho (hàng còn nguyên vẹn)</span>
              </label>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDecisionModal(null)}
                className="px-3 py-1.5 rounded-lg border border-[#D5D0C5] font-semibold"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-3.5 py-1.5 rounded-lg bg-[#2D4A3E] text-white font-semibold disabled:opacity-50"
              >
                Xác nhận
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
