import React, { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Truck,
  CreditCard,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import {
  ORDER_STATUS_LABELS,
  formatCurrency,
  formatDateTime,
} from './AdminLayout.tsx';

interface OrderDetailPanelProps {
  order: any;
  loading: boolean;
  onRefreshOrder: (orderId: string) => Promise<void>;
  onRefreshList: () => Promise<void>;
  onShowToast?: (msg: string) => void;
}

export const OrderDetailPanel: React.FC<OrderDetailPanelProps> = ({
  order,
  loading,
  onRefreshOrder,
  onRefreshList,
  onShowToast,
}) => {
  const [trackingCodeInput, setTrackingCodeInput] = useState('');
  const [cancelReasonInput, setCancelReasonInput] = useState('');
  const [manualTxIdInput, setManualTxIdInput] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-[#E5E0D5] p-6 text-xs text-[#6B665C]">
        Đang tải chi tiết đơn hàng...
      </div>
    );
  }

  if (!order) {
    return (
      <div className="bg-white rounded-xl border border-[#E5E0D5] p-6 text-xs text-[#6B665C]">
        Chọn một đơn hàng ở danh sách bên trái để xem chi tiết và xử lý trạng thái.
      </div>
    );
  }

  const allowedTargets: string[] = Array.isArray(order.allowedNextStatuses)
    ? order.allowedNextStatuses
    : [];

  const handleTransitionStatus = async (nextStatus: string) => {
    setActionError(null);
    if (nextStatus === 'cancelled') {
      setShowCancelModal(true);
      return;
    }

    if (nextStatus === 'shipping' && !trackingCodeInput.trim()) {
      setActionError('Vui lòng nhập mã vận đơn (trackingCode) trước khi chuyển sang Đang giao hàng.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiRequest(`/api/admin/orders/${order.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          status: nextStatus,
          expectedStatus: order.status,
          trackingCode: nextStatus === 'shipping' ? trackingCodeInput.trim() : undefined,
        }),
      });
      if (!res.ok) {
        setActionError(res.data?.message || 'Không thể cập nhật trạng thái đơn hàng');
        return;
      }
      setTrackingCodeInput('');
      onShowToast?.(`Đã chuyển đơn ${order.id} sang "${ORDER_STATUS_LABELS[nextStatus] || nextStatus}"`);
      await Promise.all([onRefreshOrder(order.id), onRefreshList()]);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    if (cancelReasonInput.trim().length < 2) {
      setActionError('Vui lòng nhập lý do hủy đơn (tối thiểu 2 ký tự)');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest(`/api/admin/orders/${order.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          status: 'cancelled',
          expectedStatus: order.status,
          reason: cancelReasonInput.trim(),
        }),
      });
      if (!res.ok) {
        setActionError(res.data?.message || 'Lỗi khi hủy đơn hàng');
        return;
      }
      setShowCancelModal(false);
      setCancelReasonInput('');
      onShowToast?.(`Đã hủy đơn ${order.id} và hoàn kho/voucher thành công`);
      await Promise.all([onRefreshOrder(order.id), onRefreshList()]);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmVietQrPayment = async () => {
    setActionError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest(`/api/admin/orders/${order.id}/confirm-payment`, {
        method: 'POST',
        body: JSON.stringify({
          transactionId: manualTxIdInput.trim() || undefined,
        }),
      });
      if (!res.ok) {
        setActionError(res.data?.message || 'Không thể xác nhận thanh toán VietQR');
        return;
      }
      setManualTxIdInput('');
      onShowToast?.(`Đã xác nhận thanh toán VietQR cho đơn ${order.id}`);
      await Promise.all([onRefreshOrder(order.id), onRefreshList()]);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-[#E5E0D5] p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E0D5] pb-3">
        <div>
          <div className="text-sm font-bold text-[#1A1C19]">Chi tiết đơn #{order.id}</div>
          <div className="text-xs text-[#6B665C]">Đặt lúc: {formatDateTime(order.createdAt)}</div>
        </div>
        <span className="px-2.5 py-1 rounded text-xs font-bold bg-[#2D4A3E] text-white">
          {ORDER_STATUS_LABELS[order.status] || order.status}
        </span>
      </div>

      {actionError && (
        <div className="p-3 rounded-lg bg-[#FDF3F2] border border-[#F5C6C6] text-xs text-[#9E2A2B] flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Thông tin người nhận (chỉ hiển thị ở chi tiết đơn) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#FAF8F5] p-3.5 rounded-lg border border-[#E5E0D5] text-xs">
        <div>
          <div className="font-semibold text-[#6B665C]">Người nhận</div>
          <div className="font-bold text-[#1A1C19] mt-0.5">{order.receiverName}</div>
          <div className="text-[#2D4A3E] font-mono">{order.receiverPhone}</div>
          {order.customerEmail && <div className="text-[#6B665C]">{order.customerEmail}</div>}
        </div>
        <div>
          <div className="font-semibold text-[#6B665C]">Địa chỉ giao hàng</div>
          <div className="text-[#1A1C19] mt-0.5">{order.shippingAddress}</div>
          {order.trackingCode && (
            <div className="mt-1 font-mono text-[11px] text-[#2D4A3E]">
              Mã vận đơn: <strong>{order.trackingCode}</strong>
            </div>
          )}
        </div>
      </div>

      {/* Xác nhận thanh toán VietQR thủ công */}
      {order.paymentMethod === 'vietqr' && order.paymentStatus !== 'paid' && order.status === 'pending' && (
        <div className="p-3.5 rounded-lg bg-[#F4F7F4] border border-[#C5D6C8] space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-bold text-[#2D4A3E]">
            <CreditCard className="w-4 h-4" />
            <span>Xác nhận thanh toán VietQR thủ công</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={manualTxIdInput}
              onChange={(e) => setManualTxIdInput(e.target.value)}
              placeholder="Mã tham chiếu ngân hàng (tùy chọn)..."
              className="flex-1 px-3 py-1.5 text-xs bg-white border border-[#D5D0C5] rounded-lg"
            />
            <button
              type="button"
              disabled={submitting}
              onClick={handleConfirmVietQrPayment}
              className="px-3.5 py-1.5 bg-[#2D4A3E] hover:bg-[#233B31] text-white text-xs font-semibold rounded-lg disabled:opacity-50"
            >
              Xác nhận đã nhận tiền
            </button>
          </div>
        </div>
      )}

      {/* Chuyển trạng thái đơn hàng */}
      {allowedTargets.length > 0 && (
        <div className="space-y-2.5 pt-1">
          <div className="text-xs font-bold text-[#1A1C19]">Thao tác chuyển trạng thái (expectedStatus: {order.status})</div>
          {allowedTargets.includes('shipping') && (
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-[#2D4A3E] shrink-0" />
              <input
                type="text"
                value={trackingCodeInput}
                onChange={(e) => setTrackingCodeInput(e.target.value)}
                maxLength={64}
                placeholder="Nhập mã vận đơn (chữ, số, gạch ngang, <= 64 ký tự)..."
                className="flex-1 px-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg font-mono"
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {allowedTargets.map((target) => (
              <button
                key={target}
                type="button"
                disabled={submitting}
                onClick={() => handleTransitionStatus(target)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
                  target === 'cancelled'
                    ? 'bg-[#FDF3F2] text-[#9E2A2B] border border-[#F5C6C6] hover:bg-[#F9E2E0]'
                    : 'bg-[#2D4A3E] text-white hover:bg-[#233B31]'
                }`}
              >
                {target === 'cancelled' ? (
                  <XCircle className="w-3.5 h-3.5" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                <span>Chuyển sang: {ORDER_STATUS_LABELS[target] || target}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Danh sách sản phẩm trong đơn */}
      <div className="space-y-2">
        <div className="text-xs font-bold text-[#1A1C19]">Sản phẩm trong đơn ({order.items?.length || 0})</div>
        <div className="divide-y divide-[#E5E0D5] border border-[#E5E0D5] rounded-lg">
          {(order.items || []).map((it: any) => (
            <div key={it.id} className="p-2.5 flex items-center justify-between text-xs">
              <div>
                <div className="font-semibold text-[#1A1C19]">{it.productName}</div>
                <div className="text-[11px] text-[#6B665C]">
                  Phân loại: {it.color} / {it.size} · SL: x{it.quantity}
                  {it.sku ? ` · SKU: ${it.sku}` : ''}
                </div>
              </div>
              <div className="font-bold text-[#2D4A3E] tabular-nums">
                {formatCurrency(it.totalPrice)}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-between items-center pt-1 text-xs">
          <span className="text-[#6B665C]">
            Thanh toán: <strong>{(order.paymentMethod || 'cod').toUpperCase()}</strong> ({order.paymentStatus || 'pending'})
          </span>
          <span className="text-sm font-extrabold text-[#2D4A3E]">
            Tổng cộng: {formatCurrency(order.totalAmount)}
          </span>
        </div>
      </div>

      {/* Lịch sử trạng thái */}
      {Array.isArray(order.statusHistory) && order.statusHistory.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-[#1A1C19] flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-[#6B665C]" />
            <span>Lịch sử trạng thái đơn hàng</span>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {order.statusHistory.map((h: any) => (
              <div
                key={h.id}
                className="p-2 rounded bg-[#FAF8F5] border border-[#E5E0D5] text-[11px] flex justify-between gap-2"
              >
                <div>
                  <span className="font-bold text-[#2D4A3E]">
                    [{ORDER_STATUS_LABELS[h.status] || h.status}]
                  </span>{' '}
                  <span className="text-[#1A1C19]">{h.note}</span>
                </div>
                <span className="text-[#6B665C] shrink-0">{formatDateTime(h.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal xác nhận hủy đơn hàng */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleConfirmCancel}
            className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 border border-[#E5E0D5] shadow-xl"
          >
            <div className="text-sm font-bold text-[#9E2A2B]">
              Xác nhận hủy đơn hàng #{order.id}
            </div>
            <p className="text-xs text-[#6B665C]">
              Hệ thống sẽ hoàn lại tồn kho và lượt dùng mã giảm giá trong cùng giao dịch. Nếu đơn đã thanh toán, hệ thống sẽ tự tạo yêu cầu hoàn tiền.
            </p>
            <div>
              <label className="block text-xs font-semibold text-[#1A1C19] mb-1">
                Lý do hủy đơn (bắt buộc) *
              </label>
              <textarea
                rows={3}
                required
                value={cancelReasonInput}
                onChange={(e) => setCancelReasonInput(e.target.value)}
                placeholder="Nhập lý do hủy đơn..."
                className="w-full px-3 py-2 text-xs border border-[#D5D0C5] rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#D5D0C5]"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-[#9E2A2B] text-white hover:bg-[#7D2021] disabled:opacity-50"
              >
                Xác nhận hủy đơn
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
