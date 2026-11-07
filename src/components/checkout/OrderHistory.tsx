import React, { useState, useEffect, useCallback } from 'react';
import {
  Package,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { CancelOrderModal } from './CancelOrderModal.tsx';
import { ReturnRequestModal } from './ReturnRequestModal.tsx';
import { apiRequest } from '../../lib/api.ts';
import type { OrderRecord } from '../../types/index.ts';

interface OrderHistoryProps {
  onSelectOrder: (order: OrderRecord) => void;
  onCartRefresh: () => void;
  showToast: (msg: string) => void;
}

const ORDER_STATUS_TABS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'pending', label: 'Chờ xác nhận' },
  { key: 'confirmed', label: 'Đã xác nhận' },
  { key: 'processing', label: 'Đang chuẩn bị hàng' },
  { key: 'shipping', label: 'Đang giao' },
  { key: 'delivered', label: 'Đã giao' },
  { key: 'completed', label: 'Hoàn thành' },
  { key: 'return_requested', label: 'Đổi trả' },
  { key: 'cancelled', label: 'Đã hủy' },
] as const;

const STATUS_LABEL_MAP: Record<string, string> = {
  pending: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  processing: 'Đang chuẩn bị hàng',
  shipping: 'Đang giao',
  delivered: 'Đã giao',
  completed: 'Hoàn thành',
  return_requested: 'Đổi trả',
  cancelled: 'Đã hủy',
};

export const OrderHistory: React.FC<OrderHistoryProps> = ({
  onSelectOrder,
  onCartRefresh,
  showToast,
}) => {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState<number>(1);
  const pageSize = 5;

  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalOrders, setTotalOrders] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [cancelOrderIdTarget, setCancelOrderIdTarget] = useState<string | null>(null);
  const [returnTargetOrder, setReturnTargetOrder] = useState<OrderRecord | null>(null);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState<boolean>(false);
  const [isReorderingId, setIsReorderingId] = useState<string | null>(null);

  const fetchOrders = useCallback(
    async (targetStatus = statusFilter, targetPage = page) => {
      setIsLoading(true);
      setErrorMsg(null);
      try {
        const sp = new URLSearchParams();
        if (targetStatus && targetStatus !== 'all') {
          sp.set('status', targetStatus);
        }
        sp.set('page', String(targetPage));
        sp.set('pageSize', String(pageSize));

        const res = await apiRequest(`/api/orders?${sp.toString()}`);
        if (!res.ok) {
          setErrorMsg(res.errorMessage || 'Không thể tải danh sách đơn hàng');
          return;
        }
        const body = res.data || {};
        setOrders(Array.isArray(body.items) ? body.items : []);
        setTotalPages(Math.max(1, Number(body.totalPages || 1)));
        setTotalOrders(Number(body.total || 0));
      } catch {
        setErrorMsg('Lỗi kết nối máy chủ khi tải lịch sử đơn hàng');
      } finally {
        setIsLoading(false);
      }
    },
    [statusFilter, page]
  );

  useEffect(() => {
    fetchOrders(statusFilter, page);
  }, [statusFilter, page, fetchOrders]);

  const handleOpenDetail = async (orderId: string) => {
    try {
      const res = await apiRequest(`/api/orders/${encodeURIComponent(orderId)}`);
      if (res.ok && res.data?.data) {
        onSelectOrder(res.data.data);
      } else {
        showToast(res.errorMessage || 'Không thể tải chi tiết đơn hàng');
      }
    } catch {
      showToast('Không thể tải chi tiết đơn hàng');
    }
  };

  const handleReorder = async (orderId: string) => {
    setIsReorderingId(orderId);
    try {
      const res = await apiRequest(`/api/orders/${encodeURIComponent(orderId)}/reorder`, {
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
      setIsReorderingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Tab theo trạng thái */}
      <div className="flex flex-wrap gap-1.5 pb-2 border-b border-[#EAE6DE]">
        {ORDER_STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setStatusFilter(tab.key);
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              statusFilter === tab.key
                ? 'bg-[#2D4A3E] text-white'
                : 'bg-white border border-[#E0DCD3] text-[#5C584F] hover:bg-[#F0ECE1]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Trạng thái Loading / Lỗi / Rỗng / Danh sách */}
      {isLoading ? (
        <div className="text-center py-12 text-xs text-[#6B665C] flex flex-col items-center gap-2">
          <RefreshCw className="w-5 h-5 text-[#2D4A3E] animate-spin" />
          <span>Đang tải danh sách đơn hàng...</span>
        </div>
      ) : errorMsg ? (
        <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-center space-y-3">
          <AlertCircle className="w-6 h-6 text-red-600 mx-auto" />
          <div className="text-xs font-semibold text-red-800">{errorMsg}</div>
          <button
            type="button"
            onClick={() => fetchOrders(statusFilter, page)}
            className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg"
          >
            Thử tải lại
          </button>
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12 space-y-2 bg-white rounded-xl border border-dashed border-[#E0DCD3]">
          <Package className="w-8 h-8 text-[#8C877B] mx-auto" />
          <div className="text-sm font-bold text-[#1A1C19]">
            Bạn chưa có đơn hàng nào trong mục này
          </div>
          <p className="text-xs text-[#7A7569]">
            Các đơn hàng bạn đã đặt tại Baity sẽ được hiển thị tại đây.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((ord: any) => (
            <div
              key={ord.id}
              className="p-4 bg-white rounded-xl border border-[#EAE6DE] flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2.5">
                  <span className="font-bold text-sm text-[#1A1C19]">{ord.id}</span>
                  <span className="text-[#2D4A3E] font-semibold">
                    · {STATUS_LABEL_MAP[ord.status] || ord.status}
                  </span>
                  <span className="text-[#7A7569] tabular-nums">
                    · {new Date(ord.created_at || ord.createdAt).toLocaleDateString('vi-VN')}
                  </span>
                </div>
                <div className="text-[#5C584F]">
                  Người nhận: {ord.receiver_name || ord.receiverName} · Thanh toán:{' '}
                  {(ord.payment_method || ord.paymentMethod || 'cod').toUpperCase()} (
                  {ord.payment_status || ord.paymentStatus})
                </div>
                <div className="font-bold text-[#2D4A3E] tabular-nums">
                  Tổng tiền: {Number(ord.total_amount ?? ord.totalAmount).toLocaleString('vi-VN')}₫
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {ord.status === 'pending' &&
                  (ord.payment_method || ord.paymentMethod) === 'vietqr' &&
                  (ord.payment_status || ord.paymentStatus) === 'pending' && (
                    <button
                      type="button"
                      onClick={() => handleOpenDetail(ord.id)}
                      className="px-3.5 py-2 bg-[#2D4A3E] hover:bg-[#233B31] text-white text-xs font-semibold rounded-lg"
                    >
                      Tiếp tục thanh toán
                    </button>
                  )}

                <button
                  type="button"
                  onClick={() => handleOpenDetail(ord.id)}
                  className="px-3.5 py-2 bg-[#F0ECE1] hover:bg-[#E4DEC9] text-[#2D4A3E] text-xs font-semibold rounded-lg"
                >
                  Xem chi tiết
                </button>

                <button
                  type="button"
                  disabled={isReorderingId === ord.id}
                  onClick={() => handleReorder(ord.id)}
                  className="px-3.5 py-2 border border-[#D5D0C5] text-[#1A1C19] hover:bg-[#FAF8F5] text-xs font-semibold rounded-lg"
                >
                  {isReorderingId === ord.id ? 'Đang thêm...' : 'Mua lại'}
                </button>

                {ord.status === 'delivered' && (
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await apiRequest(`/api/orders/${encodeURIComponent(ord.id)}`);
                      if (res.ok && res.data?.data) {
                        setReturnTargetOrder(res.data.data);
                        setIsReturnModalOpen(true);
                      } else {
                        showToast(res.errorMessage || 'Không thể tải thông tin đơn hàng');
                      }
                    }}
                    className="px-3.5 py-2 bg-[#7A5C43] hover:bg-[#634A36] text-white text-xs font-semibold rounded-lg"
                  >
                    Đổi trả
                  </button>
                )}

                {['pending', 'confirmed', 'processing'].includes(ord.status) && (
                  <button
                    type="button"
                    onClick={() => setCancelOrderIdTarget(ord.id)}
                    className="px-3.5 py-2 border border-red-300 text-red-700 hover:bg-red-50 text-xs font-semibold rounded-lg"
                  >
                    Hủy đơn
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Phân trang lịch sử đơn hàng */}
          <div className="pt-3 border-t border-[#EAE6DE] flex items-center justify-between text-xs text-[#5C584F]">
            <span>
              Tổng cộng <strong>{totalOrders}</strong> đơn hàng · Trang <strong>{page}</strong> /{' '}
              <strong>{totalPages}</strong>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#D5D0C5] bg-white hover:bg-[#FAF8F5] disabled:opacity-40"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Trước</span>
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#D5D0C5] bg-white hover:bg-[#FAF8F5] disabled:opacity-40"
              >
                <span>Sau</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hộp hủy đơn */}
      <CancelOrderModal
        isOpen={Boolean(cancelOrderIdTarget)}
        orderId={cancelOrderIdTarget}
        onClose={() => setCancelOrderIdTarget(null)}
        onSuccess={() => fetchOrders(statusFilter, page)}
        showToast={showToast}
      />

      {/* Biểu mẫu đổi trả */}
      <ReturnRequestModal
        isOpen={isReturnModalOpen}
        onClose={() => {
          setIsReturnModalOpen(false);
          setReturnTargetOrder(null);
        }}
        order={returnTargetOrder}
        onSuccess={() => fetchOrders(statusFilter, page)}
        showToast={showToast}
      />
    </div>
  );
};
