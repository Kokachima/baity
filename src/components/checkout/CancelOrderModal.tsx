import React, { useState, useEffect } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';

interface CancelOrderModalProps {
  isOpen: boolean;
  orderId: string | null;
  onClose: () => void;
  onSuccess: (cancelledOrderId: string) => void;
  showToast: (msg: string) => void;
}

const PRESET_CANCEL_REASONS = [
  'Thay đổi ý định mua hàng / Đặt nhầm size',
  'Muốn đổi địa chỉ nhận hàng hoặc số điện thoại',
  'Quên áp dụng mã giảm giá Voucher',
  'Muốn đổi phương thức thanh toán khác',
];

export const CancelOrderModal: React.FC<CancelOrderModalProps> = ({
  isOpen,
  orderId,
  onClose,
  onSuccess,
  showToast,
}) => {
  const [reasonInput, setReasonInput] = useState<string>(PRESET_CANCEL_REASONS[0]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setReasonInput(PRESET_CANCEL_REASONS[0]);
      setErrorMsg('');
    }
  }, [isOpen, orderId]);

  if (!isOpen || !orderId) return null;

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    const reason = reasonInput.trim();
    if (reason.length < 3) {
      setErrorMsg('Vui lòng nhập lý do hủy đơn hàng (tối thiểu 3 ký tự)');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg('');
    try {
      const res = await apiRequest(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        setErrorMsg(res.errorMessage || 'Không thể hủy đơn hàng');
        return;
      }

      showToast(`Đã hủy đơn hàng ${orderId}, hoàn tồn kho và mã giảm giá thành công`);
      onSuccess(orderId);
      onClose();
    } catch {
      setErrorMsg('Lỗi kết nối máy chủ khi hủy đơn hàng');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs"
      role="dialog"
      aria-label={`Hủy đơn hàng ${orderId}`}
    >
      <div className="bg-white rounded-2xl border border-[#E0DCD3] max-w-md w-full p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#F0ECE1] pb-3">
          <h3 className="font-display text-sm font-bold text-[#1A1C19]">
            Xác Nhận Hủy Đơn Hàng {orderId}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#6B665C] hover:text-[#1A1C19] rounded-lg hover:bg-[#F2EFE9]"
            aria-label="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleConfirmCancel} className="space-y-3 text-xs">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <p className="text-[#5C584F]">
            Chỉ áp dụng hủy đơn khi đơn hàng ở trạng thái <strong>Chờ xác nhận</strong>,{' '}
            <strong>Đã xác nhận</strong> hoặc <strong>Đang chuẩn bị hàng</strong>. Tồn kho và lượt dùng
            Voucher (nếu có) sẽ được hoàn lại ngay lập tức.
          </p>

          <div className="space-y-2">
            <label className="block font-semibold text-[#4A4740]">
              Chọn hoặc nhập lý do hủy đơn:
            </label>
            <select
              value={
                PRESET_CANCEL_REASONS.includes(reasonInput)
                  ? reasonInput
                  : PRESET_CANCEL_REASONS[0]
              }
              onChange={(e) => setReasonInput(e.target.value)}
              className="w-full px-3 py-2 bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-xs text-[#1A1C19]"
            >
              {PRESET_CANCEL_REASONS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
            <textarea
              rows={2}
              value={reasonInput}
              onChange={(e) => setReasonInput(e.target.value)}
              placeholder="Nhập chi tiết lý do hủy đơn..."
              className="w-full px-3 py-2 bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-xs text-[#1A1C19]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-4 py-2 border border-[#D5D0C5] rounded-lg text-xs font-semibold text-[#4A4740] hover:bg-[#FAF8F5]"
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold disabled:opacity-50"
            >
              {isSubmitting ? 'Đang hủy...' : 'Xác nhận Hủy đơn'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
