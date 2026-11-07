import React from 'react';

export interface StatsTimeSeriesBucket {
  bucketKey: string;
  placedOrderCount: number;
  cancelledOrderCount: number;
  deliveredOrderCount: number;
  placedOrderValue: number;
  grossDeliveredRevenue: number;
  completedRefundAmount: number;
  netRevenue: number;
}

export interface StatsRevenueChartProps {
  series: StatsTimeSeriesBucket[];
  granularity: 'day' | 'week' | 'month';
}

export const StatsRevenueChart: React.FC<StatsRevenueChartProps> = ({ series, granularity }) => {
  if (!series || series.length === 0) {
    return (
      <div className="bg-white border border-[#E5E0D8] rounded-xl p-8 text-center text-xs text-[#5C5F58]">
        Chưa có dữ liệu chuỗi thời gian cho khoảng thời gian đã chọn.
      </div>
    );
  }

  const maxVal = Math.max(
    1,
    ...series.map((b) => Math.max(b.placedOrderValue, Math.max(0, b.netRevenue)))
  );

  const chartWidth = Math.max(680, series.length * 46);
  const chartHeight = 220;
  const padTop = 20;
  const padBottom = 34;
  const plotHeight = chartHeight - padTop - padBottom;

  const granularityLabel =
    granularity === 'week' ? 'theo tuần' : granularity === 'month' ? 'theo tháng' : 'theo ngày';

  return (
    <div className="bg-white border border-[#E5E0D8] rounded-2xl p-5 space-y-4" data-testid="stats-revenue-chart">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-[#1A1C19]">
            Biểu đồ Doanh thu thực & Giá trị đơn đặt ({granularityLabel}, GMT+7)
          </h3>
          <p className="text-xs text-[#5C5F58] mt-0.5">
            So sánh trực quan giữa Giá trị đơn đặt (chưa hủy) và Doanh thu thực (đơn đã giao trừ hoàn tiền đã hoàn tất).
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium text-[#1A1C19]">
            <span className="w-3 h-3 rounded-xs bg-[#2D4A3E] inline-block" />
            Doanh thu thực
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-[#5C5F58]">
            <span className="w-3 h-3 rounded-xs bg-[#C5B9A5] inline-block" />
            Giá trị đơn đặt
          </span>
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full min-w-[640px] h-56 select-none"
          role="img"
          aria-label="Biểu đồ doanh thu và đơn hàng theo thời gian"
        >
          {/* Đường lưới ngang */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padTop + plotHeight * (1 - ratio);
            const val = Math.round(maxVal * ratio);
            return (
              <g key={ratio}>
                <line
                  x1={56}
                  y1={y}
                  x2={chartWidth - 16}
                  y2={y}
                  stroke="#EFECE6"
                  strokeDasharray="3 3"
                />
                <text x={50} y={y + 4} textAnchor="end" className="text-[10px] fill-[#7A7D75]">
                  {val >= 1_000_000
                    ? `${(val / 1_000_000).toFixed(1)}tr`
                    : val >= 1_000
                    ? `${Math.round(val / 1_000)}k`
                    : val}
                </text>
              </g>
            );
          })}

          {/* Các cột theo mốc thời gian */}
          {series.map((bucket, idx) => {
            const usableWidth = chartWidth - 76;
            const slotWidth = usableWidth / Math.max(1, series.length);
            const centerX = 64 + idx * slotWidth + slotWidth / 2;
            const barWidth = Math.min(14, Math.max(5, slotWidth * 0.32));

            const placedH = Math.max(
              0,
              Math.round((Math.max(0, bucket.placedOrderValue) / maxVal) * plotHeight)
            );
            const netH = Math.max(
              0,
              Math.round((Math.max(0, bucket.netRevenue) / maxVal) * plotHeight)
            );

            const placedY = padTop + plotHeight - placedH;
            const netY = padTop + plotHeight - netH;

            const showLabel =
              series.length <= 16 || idx === 0 || idx === series.length - 1 || idx % Math.ceil(series.length / 10) === 0;

            return (
              <g key={bucket.bucketKey}>
                {/* Cột Giá trị đơn đặt */}
                <rect
                  x={centerX - barWidth - 1}
                  y={placedY}
                  width={barWidth}
                  height={Math.max(2, placedH)}
                  rx={2}
                  fill="#C5B9A5"
                >
                  <title>
                    {`${bucket.bucketKey} — Giá trị đơn đặt: ${bucket.placedOrderValue.toLocaleString('vi-VN')}₫ (${bucket.placedOrderCount} đơn)`}
                  </title>
                </rect>

                {/* Cột Doanh thu thực */}
                <rect
                  x={centerX + 1}
                  y={netY}
                  width={barWidth}
                  height={Math.max(2, netH)}
                  rx={2}
                  fill="#2D4A3E"
                >
                  <title>
                    {`${bucket.bucketKey} — Doanh thu thực: ${bucket.netRevenue.toLocaleString('vi-VN')}₫ (${bucket.deliveredOrderCount} đơn giao, hoàn tiền: ${bucket.completedRefundAmount.toLocaleString('vi-VN')}₫)`}
                  </title>
                </rect>

                {showLabel && (
                  <text
                    x={centerX}
                    y={chartHeight - 10}
                    textAnchor="middle"
                    className="text-[10px] fill-[#5C5F58]"
                  >
                    {bucket.bucketKey.slice(5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
