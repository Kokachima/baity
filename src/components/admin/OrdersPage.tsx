import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  RefreshCw,
  Eye,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import {
  ORDER_STATUS_LABELS,
  formatCurrency,
  formatDateTime,
} from './AdminLayout.tsx';
import { OrderDetailPanel } from './OrderDetailPanel.tsx';

interface OrdersPageProps {
  onRefreshOverview: () => void;
  onShowToast?: (msg: string) => void;
  initialStatusFilter?: string;
  initialPaymentMethodFilter?: string;
}

export const OrdersPage: React.FC<OrdersPageProps> = ({
  onRefreshOverview,
  onShowToast,
  initialStatusFilter = 'all',
  initialPaymentMethodFilter = 'all',
}) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);
  const [paymentMethodFilter, setPaymentMethodFilter] = useState(initialPaymentMethodFilter);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderDetail, setOrderDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    setStatusFilter(initialStatusFilter);
  }, [initialStatusFilter]);

  useEffect(() => {
    setPaymentMethodFilter(initialPaymentMethodFilter);
  }, [initialPaymentMethodFilter]);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    const sp = new URLSearchParams();
    sp.set('page', String(page));
    sp.set('limit', '20');
    if (statusFilter !== 'all') sp.set('status', statusFilter);
    if (paymentMethodFilter !== 'all') sp.set('paymentMethod', paymentMethodFilter);
    if (search.trim()) sp.set('search', search.trim());
    if (fromDate) sp.set('fromDate', fromDate);
    if (toDate) sp.set('toDate', toDate);

    const res = await apiRequest(`/api/admin/orders?${sp.toString()}`);
    setLoading(false);
    if (!res.ok) {
      setError(res.errorMessage || 'Không thể tải danh sách đơn hàng');
      return;
    }
    setOrders(Array.isArray(res.data?.items) ? res.data.items : []);
    setTotal(Number(res.data?.total || 0));
    setTotalPages(Number(res.data?.totalPages || 1));
  }, [page, statusFilter, search, fromDate, toDate]);

  const loadOrderDetail = useCallback(async (orderId: string) => {
    setSelectedOrderId(orderId);
    setDetailLoading(true);
    const res = await apiRequest(`/api/admin/orders/${encodeURIComponent(orderId)}`);
    setDetailLoading(false);
    if (res.ok) {
      setOrderDetail(res.data?.order || res.data?.data || null);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-7 bg-white rounded-2xl border border-[#E0DCD3] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A1C19]">
              Danh sách đơn hàng ({total})
            </h2>
            <p className="text-xs text-[#6B665C]">
              PII (họ tên & SĐT) được ẩn trên bảng danh sách; hỗ trợ tìm theo mã đơn, tên hoặc SĐT (khớp chính xác hoặc 4 số cuối).
            </p>
          </div>
          <button
            type="button"
            onClick={loadOrders}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#F5F2EB] hover:bg-[#EAE5DC] rounded-lg"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Tải lại</span>
          </button>
        </div>

        {/* Bộ lọc ngày, trạng thái và tìm kiếm */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#7A7569] absolute left-2.5 top-2.5" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Mã đơn, tên, SĐT (4 số cuối)..."
              className="w-full pl-8 pr-2.5 py-1.5 text-xs border border-[#D5D0C5] rounded-lg"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-2.5 py-1.5 text-xs border border-[#D5D0C5] rounded-lg bg-white"
          >
            <option value="all">Tất cả trạng thái</option>
            {Object.entries(ORDER_STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
            aria-label="Từ ngày"
            className="px-2.5 py-1.5 text-xs border border-[#D5D0C5] rounded-lg"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
            aria-label="Đến ngày"
            className="px-2.5 py-1.5 text-xs border border-[#D5D0C5] rounded-lg"
          />
        </div>

        {loading ? (
          <div className="py-10 text-center text-xs text-[#6B665C]">
            Đang tải danh sách đơn hàng...
          </div>
        ) : error ? (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {error}
          </div>
        ) : orders.length === 0 ? (
          <div className="py-10 text-center text-xs text-[#6B665C]">
            Không có đơn hàng nào khớp bộ lọc.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#EAE6DE] text-[#6B665C]">
                  <th className="py-2 px-2.5 font-semibold">Mã đơn</th>
                  <th className="py-2 px-2.5 font-semibold">Ngày đặt</th>
                  <th className="py-2 px-2.5 font-semibold">SP</th>
                  <th className="py-2 px-2.5 font-semibold">Tổng tiền</th>
                  <th className="py-2 px-2.5 font-semibold">TT</th>
                  <th className="py-2 px-2.5 font-semibold">Trạng thái</th>
                  <th className="py-2 px-2.5 font-semibold text-right">Xem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2EFE9]">
                {orders.map((ord) => (
                  <tr
                    key={ord.id}
                    className={`hover:bg-[#FAF8F5] ${
                      selectedOrderId === ord.id ? 'bg-[#F0ECE1]/60' : ''
                    }`}
                  >
                    <td className="py-2.5 px-2.5 font-mono font-bold text-[#1A1C19]">
                      {ord.id}
                    </td>
                    <td className="py-2.5 px-2.5 text-[#6B665C]">
                      {formatDateTime(ord.createdAt)}
                    </td>
                    <td className="py-2.5 px-2.5">{ord.itemCount}</td>
                    <td className="py-2.5 px-2.5 font-semibold">
                      {formatCurrency(ord.totalAmount)}
                    </td>
                    <td className="py-2.5 px-2.5">
                      <span className="uppercase font-medium">{ord.paymentMethod}</span>
                      <span className="text-[#6B665C]"> · {ord.paymentStatus}</span>
                    </td>
                    <td className="py-2.5 px-2.5">
                      <span className="inline-block px-2 py-0.5 rounded bg-[#F0ECE1] text-[#2D4A3E] font-semibold">
                        {ORDER_STATUS_LABELS[ord.status] || ord.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => loadOrderDetail(ord.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-[#2D4A3E] text-white font-semibold rounded-md hover:bg-[#233B31]"
                      >
                        <Eye className="w-3 h-3" />
                        <span>Chi tiết</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 border-t border-[#EAE6DE] text-xs">
            <span>
              Trang {page} / {totalPages}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1 rounded border border-[#D5D0C5] disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1 rounded border border-[#D5D0C5] disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="lg:col-span-5">
        <OrderDetailPanel
          order={orderDetail}
          loading={detailLoading}
          onRefreshOrder={loadOrderDetail}
          onRefreshList={async () => {
            await loadOrders();
            onRefreshOverview();
          }}
          onShowToast={onShowToast}
        />
      </div>
    </div>
  );
};
