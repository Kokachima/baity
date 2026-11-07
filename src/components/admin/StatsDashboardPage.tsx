import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  Download,
  RefreshCw,
  Info,
  AlertCircle,
  Calendar,
} from 'lucide-react';
import {
  StatsRevenueChart,
  type StatsTimeSeriesBucket,
} from './stats/StatsRevenueChart';
import {
  StatsProductsAndInventorySection,
  type TopProductStatItem,
  type CategoryBreakdownItem,
  type SlowMovingProductItem,
} from './stats/StatsProductsAndInventorySection';
import {
  StatsVouchersAndVisualSearchSection,
  type VoucherStatItem,
  type VisualSearchStatsData,
} from './stats/StatsVouchersAndVisualSearchSection';

function getVnDateString(daysOffset = 0): string {
  const vnTime = new Date(Date.now() + 7 * 3600 * 1000 + daysOffset * 86400 * 1000);
  return vnTime.toISOString().slice(0, 10);
}

function getVnStartOfMonthString(): string {
  const vnDate = getVnDateString(0);
  return `${vnDate.slice(0, 7)}-01`;
}

export const StatsDashboardPage: React.FC = () => {
  const [preset, setPreset] = useState<'today' | '7d' | '30d' | 'month' | 'custom'>('30d');
  const [fromDate, setFromDate] = useState<string>(() => getVnDateString(-29));
  const [toDate, setToDate] = useState<string>(() => getVnDateString(0));
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [definitions, setDefinitions] = useState<{
    netRevenue: string;
    placedOrderValue: string;
    shippingFeePolicy?: string;
  }>({
    netRevenue:
      'Doanh thu thực = Tổng thanh toán đơn hàng đã giao hoặc hoàn tất (orders.total_amount — ĐÃ BAO GỒM phí vận chuyển khách trả, status IN (delivered, completed)) tính theo ngày giao hàng (delivered_at, múi giờ Asia/Ho_Chi_Minh) TRỪ tổng tiền hoàn đã hoàn tất (return_requests.refund_amount, có type = refund và status = completed; chỉ gồm phí vận chuyển khi hoàn toàn bộ đơn do lỗi cửa hàng) tính theo cột cố định ngày hoàn tất hoàn tiền (COALESCE(refunded_at, updated_at), múi giờ Asia/Ho_Chi_Minh).',
    placedOrderValue:
      'Giá trị đơn đặt = Tổng thanh toán (orders.total_amount — ĐÃ BAO GỒM phí vận chuyển) của các đơn hàng chưa hủy (status <> cancelled) tính theo ngày tạo đơn (created_at, múi giờ Asia/Ho_Chi_Minh).',
  });

  const [summary, setSummary] = useState({
    netRevenue: 0,
    grossDeliveredRevenue: 0,
    completedRefundAmount: 0,
    completedRefundCount: 0,
    placedOrderValue: 0,
    placedOrderCount: 0,
    deliveredOrderCount: 0,
    totalCreatedOrders: 0,
    cancelledOrderCount: 0,
    cancellationRatePercent: 0,
    averageOrderValue: 0,
    newCustomersCount: 0,
    returningCustomersCount: 0,
  });

  const [statusBreakdown, setStatusBreakdown] = useState<Record<string, number>>({});
  const [series, setSeries] = useState<StatsTimeSeriesBucket[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductStatItem[]>([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryBreakdownItem[]>([]);
  const [slowMovingProducts, setSlowMovingProducts] = useState<SlowMovingProductItem[]>([]);
  const [vouchers, setVouchers] = useState<VoucherStatItem[]>([]);
  const [visualSearch, setVisualSearch] = useState<VisualSearchStatsData | null>(null);

  const applyPreset = (nextPreset: 'today' | '7d' | '30d' | 'month' | 'custom') => {
    setPreset(nextPreset);
    const today = getVnDateString(0);
    if (nextPreset === 'today') {
      setFromDate(today);
      setToDate(today);
    } else if (nextPreset === '7d') {
      setFromDate(getVnDateString(-6));
      setToDate(today);
    } else if (nextPreset === '30d') {
      setFromDate(getVnDateString(-29));
      setToDate(today);
    } else if (nextPreset === 'month') {
      setFromDate(getVnStartOfMonthString());
      setToDate(today);
    }
  };

  const fetchAllStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        from: fromDate,
        to: toDate,
        granularity,
      }).toString();

      const [overviewRes, productsRes, vouchersRes, visualRes] = await Promise.all([
        fetch(`/api/admin/stats/overview?${qs}`, { credentials: 'include' }),
        fetch(`/api/admin/stats/products?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`, {
          credentials: 'include',
        }),
        fetch(`/api/admin/stats/vouchers?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`, {
          credentials: 'include',
        }),
        fetch(`/api/admin/stats/visual-search?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`, {
          credentials: 'include',
        }),
      ]);

      const overviewBody = await overviewRes.json();
      if (!overviewRes.ok) {
        throw new Error(overviewBody.message || 'Lỗi tải dữ liệu thống kê tổng quan');
      }

      const [productsBody, vouchersBody, visualBody] = await Promise.all([
        productsRes.json(),
        vouchersRes.json(),
        visualRes.json(),
      ]);

      if (overviewBody.definitions) {
        setDefinitions(overviewBody.definitions);
      }
      if (overviewBody.summary) {
        setSummary(overviewBody.summary);
      }
      setStatusBreakdown(overviewBody.statusBreakdown || {});
      setSeries(Array.isArray(overviewBody.series) ? overviewBody.series : []);

      setTopProducts(Array.isArray(productsBody.topProducts) ? productsBody.topProducts : []);
      setCategoryBreakdown(
        Array.isArray(productsBody.categoryBreakdown) ? productsBody.categoryBreakdown : []
      );
      setSlowMovingProducts(
        Array.isArray(productsBody.slowMovingProducts) ? productsBody.slowMovingProducts : []
      );

      setVouchers(Array.isArray(vouchersBody.items) ? vouchersBody.items : []);
      setVisualSearch(visualBody.summary ? visualBody : null);
    } catch (err: any) {
      setError(err.message || 'Không thể tải báo cáo thống kê');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, granularity]);

  useEffect(() => {
    fetchAllStats();
  }, [fetchAllStats]);

  const handleDownloadCsv = (type: 'orders' | 'products') => {
    const url = `/api/admin/stats/export.csv?type=${type}&from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`;
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `baity-stats-${type}-${fromDate}-to-${toDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6" data-testid="stats-dashboard-page">
      {/* Header & Nút xuất CSV */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-[#E5E0D8] pb-4">
        <div>
          <h2 className="text-xl font-bold text-[#1A1C19] flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[#2D4A3E]" />
            Báo cáo Thống kê Doanh thu & Kinh doanh (Múi giờ GMT+7)
          </h2>
          <p className="text-xs text-[#5C5F58] mt-1">
            Tổng hợp trực tiếp từ cơ sở dữ liệu theo múi giờ Asia/Ho_Chi_Minh (tối đa 366 ngày/lần truy vấn).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleDownloadCsv('orders')}
            data-testid="export-orders-csv-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#2D4A3E] bg-white text-xs font-semibold text-[#2D4A3E] hover:bg-[#F5F2EB]"
          >
            <Download className="w-3.5 h-3.5" />
            Xuất CSV Đơn hàng
          </button>
          <button
            type="button"
            onClick={() => handleDownloadCsv('products')}
            data-testid="export-products-csv-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#2D4A3E] bg-white text-xs font-semibold text-[#2D4A3E] hover:bg-[#F5F2EB]"
          >
            <Download className="w-3.5 h-3.5" />
            Xuất CSV Sản phẩm
          </button>
          <button
            type="button"
            onClick={fetchAllStats}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#2D4A3E] text-white text-xs font-semibold hover:bg-[#22382F]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Làm mới
          </button>
        </div>
      </div>

      {/* Bộ chọn khoảng thời gian & độ chi tiết */}
      <div className="bg-white border border-[#E5E0D8] rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#1A1C19] mr-1">
              <Calendar className="w-3.5 h-3.5 text-[#2D4A3E]" />
              Kỳ báo cáo:
            </span>
            {[
              { id: 'today', label: 'Hôm nay' },
              { id: '7d', label: '7 ngày qua' },
              { id: '30d', label: '30 ngày qua' },
              { id: 'month', label: 'Tháng này' },
              { id: 'custom', label: 'Tùy chọn' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => applyPreset(item.id as any)}
                data-testid={`stats-preset-${item.id}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  preset === item.id
                    ? 'bg-[#2D4A3E] text-white'
                    : 'bg-[#F5F2EB] text-[#5C5F58] hover:text-[#1A1C19]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setPreset('custom');
                setFromDate(e.target.value);
              }}
              data-testid="stats-from-input"
              className="px-2.5 py-1.5 text-xs border border-[#D5CFC4] rounded-lg bg-white text-[#1A1C19]"
            />
            <span className="text-xs text-[#5C5F58]">đến</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setPreset('custom');
                setToDate(e.target.value);
              }}
              data-testid="stats-to-input"
              className="px-2.5 py-1.5 text-xs border border-[#D5CFC4] rounded-lg bg-white text-[#1A1C19]"
            />

            <select
              value={granularity}
              onChange={(e) => setGranularity(e.target.value as 'day' | 'week' | 'month')}
              data-testid="stats-granularity-select"
              className="px-3 py-1.5 text-xs border border-[#D5CFC4] rounded-lg bg-white text-[#1A1C19] font-medium"
            >
              <option value="day">Theo ngày</option>
              <option value="week">Theo tuần</option>
              <option value="month">Theo tháng</option>
            </select>
          </div>
        </div>
      </div>

      {/* Hộp định nghĩa tường minh 2 chỉ số cốt lõi */}
      <div
        className="bg-[#FAF8F5] border border-[#D5CFC4] rounded-xl p-4 space-y-2 text-xs text-[#1A1C19]"
        data-testid="stats-metric-definitions"
      >
        <div className="flex items-center gap-1.5 font-bold text-[#2D4A3E]">
          <Info className="w-4 h-4 shrink-0" />
          <span>Quy chuẩn định nghĩa chỉ số tài chính (Múi giờ Asia/Ho_Chi_Minh)</span>
        </div>
        <p>
          <strong>1. Doanh thu thực:</strong> {definitions.netRevenue}
        </p>
        <p>
          <strong>2. Giá trị đơn đặt:</strong> {definitions.placedOrderValue}
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-[#E5E0D8] rounded-xl p-10 text-center text-xs text-[#5C5F58]">
          Đang tổng hợp số liệu thống kê từ cơ sở dữ liệu...
        </div>
      ) : (
        <>
          {/* Thẻ KPI chính */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-[#E5E0D8] rounded-2xl p-4">
              <p className="text-xs font-medium text-[#5C5F58]">Doanh thu thực (Đã trừ hoàn tiền)</p>
              <p
                data-testid="kpi-net-revenue"
                className="text-2xl font-extrabold text-[#2D4A3E] mt-1.5"
              >
                {summary.netRevenue.toLocaleString('vi-VN')}₫
              </p>
              <p className="text-[11px] text-[#5C5F58] mt-1">
                Giao thành công: {summary.grossDeliveredRevenue.toLocaleString('vi-VN')}₫ · Đã hoàn:{' '}
                {summary.completedRefundAmount.toLocaleString('vi-VN')}₫
              </p>
            </div>

            <div className="bg-white border border-[#E5E0D8] rounded-2xl p-4">
              <p className="text-xs font-medium text-[#5C5F58]">Giá trị đơn đặt (Chưa hủy)</p>
              <p
                data-testid="kpi-placed-order-value"
                className="text-2xl font-extrabold text-[#1A1C19] mt-1.5"
              >
                {summary.placedOrderValue.toLocaleString('vi-VN')}₫
              </p>
              <p className="text-[11px] text-[#5C5F58] mt-1">
                {summary.placedOrderCount.toLocaleString('vi-VN')} đơn đặt hợp lệ · AOV:{' '}
                {summary.averageOrderValue.toLocaleString('vi-VN')}₫
              </p>
            </div>

            <div className="bg-white border border-[#E5E0D8] rounded-2xl p-4">
              <p className="text-xs font-medium text-[#5C5F58]">Tỉ lệ hủy đơn & Đơn đã giao</p>
              <p className="text-2xl font-extrabold text-[#1A1C19] mt-1.5">
                {summary.cancellationRatePercent}%
              </p>
              <p className="text-[11px] text-[#5C5F58] mt-1">
                Đã hủy: {summary.cancelledOrderCount}/{summary.totalCreatedOrders} đơn · Đã giao:{' '}
                {summary.deliveredOrderCount} đơn
              </p>
            </div>

            <div className="bg-white border border-[#E5E0D8] rounded-2xl p-4">
              <p className="text-xs font-medium text-[#5C5F58]">Khách hàng mới & Quay lại</p>
              <p className="text-2xl font-extrabold text-[#1A1C19] mt-1.5">
                {summary.newCustomersCount} mới · {summary.returningCustomersCount} quay lại
              </p>
              <p className="text-[11px] text-[#5C5F58] mt-1">
                Khách quay lại có từ ≥ 2 đơn hàng không hủy
              </p>
            </div>
          </div>

          {/* Phân bố đơn hàng theo trạng thái */}
          <div className="bg-white border border-[#E5E0D8] rounded-2xl p-4">
            <h3 className="text-xs font-bold text-[#1A1C19] mb-3">
              Số đơn phát sinh trong kỳ theo trạng thái hiện tại
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 text-xs">
              {[
                { key: 'pending', label: 'Chờ xác nhận' },
                { key: 'confirmed', label: 'Đã xác nhận' },
                { key: 'processing', label: 'Đang chuẩn bị' },
                { key: 'shipping', label: 'Đang giao' },
                { key: 'delivered', label: 'Đã giao' },
                { key: 'completed', label: 'Hoàn tất' },
                { key: 'return_requested', label: 'Yêu cầu đổi trả' },
                { key: 'cancelled', label: 'Đã hủy' },
              ].map((st) => (
                <div
                  key={st.key}
                  className="p-2.5 rounded-xl bg-[#FAF8F5] border border-[#E5E0D8] text-center"
                >
                  <p className="text-[11px] text-[#5C5F58]">{st.label}</p>
                  <p className="text-base font-bold text-[#1A1C19] mt-0.5">
                    {Number(statusBreakdown[st.key] || 0).toLocaleString('vi-VN')}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Biểu đồ SVG Doanh thu & Đơn hàng */}
          <StatsRevenueChart series={series} granularity={granularity} />

          {/* Khối Sản phẩm bán chạy, Danh mục & Tồn kho chậm luân chuyển */}
          <StatsProductsAndInventorySection
            topProducts={topProducts}
            categoryBreakdown={categoryBreakdown}
            slowMovingProducts={slowMovingProducts}
          />

          {/* Khối Voucher & Tìm kiếm bằng hình ảnh AI */}
          <StatsVouchersAndVisualSearchSection
            vouchers={vouchers}
            visualSearch={visualSearch}
          />
        </>
      )}
    </div>
  );
};
