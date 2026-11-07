import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Clock,
  QrCode,
  XCircle,
  RotateCcw,
  RefreshCw,
} from 'lucide-react';
import { OrderTimeline } from './OrderTimeline.tsx';
import { CancelOrderModal } from './CancelOrderModal.tsx';
import { ReturnRequestModal } from './ReturnRequestModal.tsx';
import { apiRequest } from '../../lib/api.ts';
import type { OrderRecord } from '../../types/index.ts';

interface OrderDetailProps {
  order: OrderRecord;
  onOrderUpdated: (updatedOrder: OrderRecord) => void;
  onCartRefresh: () => void;
  showToast: (msg: string) => void;
}

const STATUS_BADGE_LABELS: Record<string, string> = {
  pending: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  processing: 'Đang chuẩn bị hàng',
  shipping: 'Đang giao',
  delivered: 'Đã giao',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
  return_requested: 'Đổi trả',
};

export const OrderDetail: React.FC<OrderDetailProps> = ({
  order,
  onOrderUpdated,
  onCartRefresh,
  showToast,
}) => {
  const [currentOrder, setCurrentOrder] = useState<OrderRecord>(order);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState<boolean>(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState<boolean>(false);
  const [isReordering, setIsReordering] = useState<boolean>(false);

  useEffect(() => {
    setCurrentOrder(order);
  }, [order]);

  const refreshOrderDetail = async (orderId = currentOrder.id) => {
    try {
      const res = await apiRequest(`/api/orders/${encodeURIComponent(orderId)}`);
      if (res.ok && res.data?.data) {
        setCurrentOrder(res.data.data);
        onOrderUpdated(res.data.data);
      }
    } catch {
      // ignore
    }
  };

  // Polling 3 giây kiểm tra trạng thái thanh toán VietQR khi đơn đang chờ thanh toán
  useEffect(() => {
    if (currentOrder.paymentMethod !== 'vietqr' || currentOrder.paymentStatus === 'paid') return;
    if (currentOrder.status === 'cancelled') return;

    const timer = setInterval(async () => {
      try {
        const res = await apiRequest(
          `/api/orders/${encodeURIComponent(currentOrder.id)}/payment-status`
        );
        if (res.ok && res.data) {
          const data = res.data;
          if (data.paymentStatus === 'paid' || data.orderStatus === 'confirmed') {
            showToast(`Đơn hàng ${currentOrder.id} đã nhận thanh toán VietQR thành công!`);
            await refreshOrderDetail(currentOrder.id);
          } else if (data.orderStatus === 'cancelled') {
            await refreshOrderDetail(currentOrder.id);
          }
        }
      } catch {
        // ignore network poll errors
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [currentOrder.id, currentOrder.paymentMethod, currentOrder.paymentStatus, currentOrder.status]);

  const handleReorder = async () => {
    setIsReordering(true);
    try {
      const res = await apiRequest(`/api/orders/${encodeURIComponent(currentOrder.id)}/reorder`, {
        method: 'POST',
      });
      if (!res.ok) {
        showToast(res.errorMessage || 'Không thể mua lại đơn hàng');
        return;
      }
      const body = res.data || {};
      onCartRefresh();
      if (body.outOfStockItems && body.outOfStockItems.length > 0) {
        showToast(
          `Đã thêm ${body.addedItems?.length || 0} món vào giỏ. Hết hàng: ${body.outOfStockItems.join(', ')}`
        );
      } else {
        showToast(body.message || 'Đã thêm các sản phẩm của đơn hàng cũ vào giỏ!');
      }
    } catch {
      showToast('Lỗi kết nối khi thực hiện mua lại');
    } finally {
      setIsReordering(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Cột Trái: Thông tin đơn hàng & Timeline đầy đủ các bước */}
      <div className="lg:col-span-7 space-y-4">
        <div className="p-5 bg-white rounded-xl border border-[#EAE6DE] space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-[#2D4A3E]" />
              <span className="font-display text-base font-bold text-[#1A1C19]">
                Mã đơn hàng: {currentOrder.id}
              </span>
            </div>
            <span className="text-xs font-bold text-[#2D4A3E] uppercase">
              {STATUS_BADGE_LABELS[currentOrder.status] || currentOrder.status}
            </span>
          </div>

          <div className="text-xs text-[#5C584F] space-y-1">
            <div>
              <strong>Người nhận:</strong> {currentOrder.receiverName} ·{' '}
              {currentOrder.receiverPhone}
            </div>
            <div>
              <strong>Địa chỉ giao:</strong> {currentOrder.shippingAddress}
            </div>
            <div>
              <strong>Phương thức thanh toán:</strong>{' '}
              {currentOrder.paymentMethod?.toUpperCase()} ({currentOrder.paymentStatus})
            </div>
          </div>

          {/* Danh sách sản phẩm trong đơn */}
          <div className="pt-3 border-t border-[#F2EFE9] space-y-2">
            {currentOrder.items?.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between text-xs text-[#1A1C19]"
              >
                <span>
                  {item.quantity}x {item.productName} ({item.color} - Size {item.size})
                </span>
                <span className="font-semibold tabular-nums">
                  {Number(item.totalPrice).toLocaleString('vi-VN')}₫
                </span>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-[#EAE6DE] flex items-center justify-between text-sm font-bold">
            <span>Tổng thanh toán</span>
            <span className="text-[#2D4A3E] tabular-nums">
              {Number(currentOrder.totalAmount).toLocaleString('vi-VN')}₫
            </span>
          </div>

          <div className="pt-2 flex flex-wrap items-center gap-2">
            {['pending', 'confirmed', 'processing'].includes(currentOrder.status) && (
              <button
                type="button"
                onClick={() => setIsCancelModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 border border-red-300 text-red-700 hover:bg-red-50 rounded-lg text-xs font-semibold transition-colors"
              >
                <XCircle className="w-4 h-4" />
                <span>Hủy đơn hàng (Hoàn kho & Voucher)</span>
              </button>
            )}

            {currentOrder.status === 'delivered' && (
              <button
                type="button"
                onClick={() => setIsReturnModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#7A5C43] hover:bg-[#634A36] text-white rounded-lg text-xs font-semibold transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Yêu cầu Đổi trả / Hoàn tiền (7 ngày)</span>
              </button>
            )}

            <button
              type="button"
              disabled={isReordering}
              onClick={handleReorder}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#F0ECE1] hover:bg-[#E4DEC9] text-[#2D4A3E] rounded-lg text-xs font-semibold transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              <span>{isReordering ? 'Đang thêm...' : 'Mua lại đơn này'}</span>
            </button>
          </div>
        </div>

        {/* Component Timeline tách biệt */}
        <OrderTimeline order={currentOrder} />
      </div>

      {/* Cột Phải: Quét mã VietQR Napas 24/7 động (Tiếp tục thanh toán) */}
      <div className="lg:col-span-5">
        {currentOrder.paymentMethod === 'vietqr' && currentOrder.vietqr ? (
          <div className="p-5 bg-white rounded-xl border border-[#2D4A3E] space-y-4 text-center">
            <div className="flex items-center justify-center gap-2 text-xs font-bold text-[#2D4A3E] uppercase tracking-wider">
              <QrCode className="w-4 h-4" />
              <span>Chuyển khoản nhanh VietQR Napas 24/7</span>
            </div>

            {currentOrder.paymentStatus === 'paid' ? (
              <div className="p-6 bg-[#F0ECE1] rounded-xl space-y-2">
                <CheckCircle2 className="w-10 h-10 text-[#2D4A3E] mx-auto" />
                <div className="text-sm font-bold text-[#2D4A3E]">
                  Đã Nhận Thanh Toán Thành Công
                </div>
                {currentOrder.transactionId && (
                  <div className="text-xs text-[#5C584F]">
                    Mã giao dịch: {currentOrder.transactionId}
                  </div>
                )}
              </div>
            ) : currentOrder.status === 'cancelled' ? (
              <div className="p-6 bg-red-50 rounded-xl space-y-2 text-red-700 text-xs font-semibold">
                Đơn hàng đã hủy ({currentOrder.cancelReason || 'Hết hạn thanh toán'})
              </div>
            ) : (
              <>
                <div className="w-52 h-52 mx-auto bg-[#FAF8F5] p-2 rounded-xl border border-[#E0DCD3]">
                  <img
                    src={currentOrder.vietqr.qrImageUrl}
                    alt={`Mã VietQR đơn hàng ${currentOrder.id}`}
                    className="w-full h-full object-contain"
                  />
                </div>

                <div className="text-left text-xs bg-[#FAF8F5] p-3.5 rounded-xl border border-[#EAE6DE] space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-[#6B665C]">Ngân hàng:</span>
                    <strong className="text-[#1A1C19]">{currentOrder.vietqr.bankName}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B665C]">Số tài khoản:</span>
                    <strong className="text-[#1A1C19] tabular-nums">
                      {currentOrder.vietqr.accountNo}
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B665C]">Chủ tài khoản:</span>
                    <strong className="text-[#1A1C19]">{currentOrder.vietqr.accountName}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B665C]">Số tiền:</span>
                    <strong className="text-[#2D4A3E] tabular-nums">
                      {currentOrder.vietqr.amount.toLocaleString('vi-VN')}₫
                    </strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B665C]">Nội dung CK:</span>
                    <strong className="text-[#C27D56] tabular-nums">
                      {currentOrder.vietqr.transferContent}
                    </strong>
                  </div>
                </div>

                <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#6B665C]">
                  <Clock className="w-3.5 h-3.5 text-[#C27D56]" />
                  <span>Tự động kiểm tra trạng thái mỗi 3 giây (Hạn 30 phút)</span>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="p-5 bg-white rounded-xl border border-[#EAE6DE] space-y-3 text-xs text-[#5C584F]">
            <div className="font-bold text-[#1A1C19]">Thanh toán khi nhận hàng (COD)</div>
            <p>
              Đơn hàng của bạn đang được Baity chuẩn bị. Quý khách vui lòng thanh toán{' '}
              <strong className="text-[#2D4A3E] tabular-nums">
                {Number(currentOrder.totalAmount).toLocaleString('vi-VN')}₫
              </strong>{' '}
              cho nhân viên giao hàng khi nhận kiện hàng.
            </p>
          </div>
        )}
      </div>

      {/* Hộp xác nhận hủy đơn */}
      <CancelOrderModal
        isOpen={isCancelModalOpen}
        orderId={currentOrder.id}
        onClose={() => setIsCancelModalOpen(false)}
        onSuccess={() => refreshOrderDetail(currentOrder.id)}
        showToast={showToast}
      />

      {/* Biểu mẫu Đổi trả / Hoàn tiền */}
      <ReturnRequestModal
        isOpen={isReturnModalOpen}
        onClose={() => setIsReturnModalOpen(false)}
        order={currentOrder}
        onSuccess={() => refreshOrderDetail(currentOrder.id)}
        showToast={showToast}
      />
    </div>
  );
};
