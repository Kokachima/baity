import React from 'react';
import { Ticket, Camera } from 'lucide-react';

export interface VoucherStatItem {
  id: string;
  code: string;
  discountType: string;
  discountValue: number;
  usageLimit: number | null;
  totalUsedCount: number;
  isActive: boolean;
  periodUsageCount: number;
  periodDiscountAmount: number;
  periodOrderRevenue: number;
}

export interface VisualSearchStatsData {
  summary: {
    totalSearches: number;
    successfulSearches: number;
    zeroResultSearches: number;
    successRatePercent: number;
    zeroResultRatePercent: number;
    avgLatencyMs: number;
    avgConfidence: number;
    avgResultCount: number;
  };
  topRecognizedCategories: Array<{
    categorySlug: string;
    searchCount: number;
  }>;
}

export interface StatsVouchersAndVisualSearchSectionProps {
  vouchers: VoucherStatItem[];
  visualSearch: VisualSearchStatsData | null;
}

export const StatsVouchersAndVisualSearchSection: React.FC<
  StatsVouchersAndVisualSearchSectionProps
> = ({ vouchers, visualSearch }) => {
  const vs = visualSearch?.summary || {
    totalSearches: 0,
    successfulSearches: 0,
    zeroResultSearches: 0,
    successRatePercent: 0,
    zeroResultRatePercent: 0,
    avgLatencyMs: 0,
    avgConfidence: 0,
    avgResultCount: 0,
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="stats-vouchers-visual-section">
      {/* Thống kê hiệu quả Voucher */}
      <div className="bg-white border border-[#E5E0D8] rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Ticket className="w-4 h-4 text-[#2D4A3E]" />
          <h3 className="text-sm font-bold text-[#1A1C19]">
            Hiệu quả Mã giảm giá (Voucher) trong kỳ
          </h3>
        </div>
        {vouchers.length === 0 ? (
          <p className="text-xs text-[#5C5F58] py-6 text-center">Chưa có mã giảm giá nào.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E5E0D8] text-[#5C5F58]">
                  <th className="py-2 pr-2 font-semibold">Mã</th>
                  <th className="py-2 px-2 font-semibold text-right">Lượt dùng (kỳ)</th>
                  <th className="py-2 px-2 font-semibold text-right">Tổng giảm (kỳ)</th>
                  <th className="py-2 pl-2 font-semibold text-right">Lũy kế</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0ECE1]">
                {vouchers.map((v) => (
                  <tr key={v.id} className="hover:bg-[#FAF8F5]">
                    <td className="py-2.5 pr-2 font-mono font-bold text-[#1A1C19]">{v.code}</td>
                    <td className="py-2.5 px-2 text-right font-semibold text-[#2D4A3E]">
                      {v.periodUsageCount.toLocaleString('vi-VN')}
                    </td>
                    <td className="py-2.5 px-2 text-right text-[#1A1C19]">
                      {v.periodDiscountAmount.toLocaleString('vi-VN')}₫
                    </td>
                    <td className="py-2.5 pl-2 text-right text-[#5C5F58]">
                      {v.totalUsedCount}
                      {v.usageLimit ? `/${v.usageLimit}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Thống kê Tìm kiếm bằng hình ảnh AI */}
      <div className="bg-white border border-[#E5E0D8] rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-[#2D4A3E]" />
          <h3 className="text-sm font-bold text-[#1A1C19]">
            Thống kê Tìm kiếm bằng Hình ảnh AI (ai_search_logs)
          </h3>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E5E0D8]">
            <p className="text-[11px] text-[#5C5F58]">Tổng lượt tìm ảnh</p>
            <p className="text-lg font-bold text-[#1A1C19] mt-0.5">
              {vs.totalSearches.toLocaleString('vi-VN')}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E5E0D8]">
            <p className="text-[11px] text-[#5C5F58]">Tỉ lệ nhận diện đạt</p>
            <p className="text-lg font-bold text-[#2D4A3E] mt-0.5">{vs.successRatePercent}%</p>
          </div>
          <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E5E0D8]">
            <p className="text-[11px] text-[#5C5F58]">Độ trễ trung bình</p>
            <p className="text-lg font-bold text-[#1A1C19] mt-0.5">
              {vs.avgLatencyMs.toLocaleString('vi-VN')} ms
            </p>
          </div>
          <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E5E0D8]">
            <p className="text-[11px] text-[#5C5F58]">Độ tin cậy TB</p>
            <p className="text-lg font-bold text-[#1A1C19] mt-0.5">{vs.avgConfidence}</p>
          </div>
          <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E5E0D8]">
            <p className="text-[11px] text-[#5C5F58]">Số KQ trung bình</p>
            <p className="text-lg font-bold text-[#1A1C19] mt-0.5">{vs.avgResultCount}</p>
          </div>
          <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E5E0D8]">
            <p className="text-[11px] text-[#5C5F58]">Tỉ lệ 0 kết quả</p>
            <p className="text-lg font-bold text-amber-800 mt-0.5">{vs.zeroResultRatePercent}%</p>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-[#1A1C19] mb-2">
            Danh mục trang phục được nhận diện nhiều nhất
          </p>
          {visualSearch?.topRecognizedCategories &&
          visualSearch.topRecognizedCategories.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {visualSearch.topRecognizedCategories.map((cat) => (
                <span
                  key={cat.categorySlug}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F5F2EB] border border-[#E5E0D8] text-xs text-[#1A1C19]"
                >
                  <span className="font-mono font-semibold">{cat.categorySlug}</span>
                  <span className="text-[#2D4A3E] font-bold">({cat.searchCount})</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#5C5F58]">Chưa có nhật ký tìm kiếm ảnh trong kỳ này.</p>
          )}
        </div>
      </div>
    </div>
  );
};
