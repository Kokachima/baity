import React from 'react';
import { Package, TrendingUp, AlertCircle } from 'lucide-react';

export interface TopProductStatItem {
  productId: string;
  productName: string;
  productSlug: string;
  categoryName: string;
  basePrice: number;
  soldQuantity: number;
  deliveredRevenue: number;
  placedQuantity: number;
  currentStock: number;
}

export interface CategoryBreakdownItem {
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  soldQuantity: number;
  deliveredRevenue: number;
}

export interface SlowMovingProductItem {
  productId: string;
  productName: string;
  productSlug: string;
  categoryName: string;
  totalStock: number;
  periodSoldQty: number;
}

export interface StatsProductsAndInventorySectionProps {
  topProducts: TopProductStatItem[];
  categoryBreakdown: CategoryBreakdownItem[];
  slowMovingProducts: SlowMovingProductItem[];
}

export const StatsProductsAndInventorySection: React.FC<StatsProductsAndInventorySectionProps> = ({
  topProducts,
  categoryBreakdown,
  slowMovingProducts,
}) => {
  return (
    <div className="space-y-6" data-testid="stats-products-inventory-section">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top sản phẩm bán chạy */}
        <div className="lg:col-span-2 bg-white border border-[#E5E0D8] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-[#2D4A3E]" />
            <h3 className="text-sm font-bold text-[#1A1C19]">
              Top Sản phẩm Bán chạy (theo số lượng & doanh thu đã giao)
            </h3>
          </div>
          {topProducts.length === 0 ? (
            <p className="text-xs text-[#5C5F58] py-6 text-center">
              Chưa có dữ liệu sản phẩm trong kỳ.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E5E0D8] text-[#5C5F58]">
                    <th className="py-2 pr-3 font-semibold">Sản phẩm</th>
                    <th className="py-2 px-3 font-semibold">Danh mục</th>
                    <th className="py-2 px-3 font-semibold text-right">SL đã giao</th>
                    <th className="py-2 px-3 font-semibold text-right">SL đặt</th>
                    <th className="py-2 px-3 font-semibold text-right">Doanh thu giao</th>
                    <th className="py-2 pl-3 font-semibold text-right">Tồn kho</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0ECE1]">
                  {topProducts.slice(0, 10).map((item) => (
                    <tr key={item.productId} className="hover:bg-[#FAF8F5]">
                      <td className="py-2.5 pr-3 font-medium text-[#1A1C19]">{item.productName}</td>
                      <td className="py-2.5 px-3 text-[#5C5F58]">{item.categoryName}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-[#2D4A3E]">
                        {item.soldQuantity.toLocaleString('vi-VN')}
                      </td>
                      <td className="py-2.5 px-3 text-right text-[#5C5F58]">
                        {item.placedQuantity.toLocaleString('vi-VN')}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-[#1A1C19]">
                        {item.deliveredRevenue.toLocaleString('vi-VN')}₫
                      </td>
                      <td className="py-2.5 pl-3 text-right text-[#5C5F58]">
                        {item.currentStock.toLocaleString('vi-VN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Doanh thu theo danh mục */}
        <div className="bg-white border border-[#E5E0D8] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Package className="w-4 h-4 text-[#2D4A3E]" />
            <h3 className="text-sm font-bold text-[#1A1C19]">Doanh thu theo Danh mục</h3>
          </div>
          {categoryBreakdown.length === 0 ? (
            <p className="text-xs text-[#5C5F58] py-6 text-center">Chưa có dữ liệu danh mục.</p>
          ) : (
            <div className="space-y-3">
              {categoryBreakdown.map((cat) => (
                <div
                  key={cat.categoryId}
                  className="flex items-center justify-between py-2 border-b border-[#F0ECE1] last:border-0 text-xs"
                >
                  <div>
                    <p className="font-semibold text-[#1A1C19]">{cat.categoryName}</p>
                    <p className="text-[11px] text-[#5C5F58]">
                      Đã giao: {cat.soldQuantity.toLocaleString('vi-VN')} sản phẩm
                    </p>
                  </div>
                  <span className="font-bold text-[#2D4A3E]">
                    {cat.deliveredRevenue.toLocaleString('vi-VN')}₫
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tồn kho chậm luân chuyển */}
      <div className="bg-white border border-[#E5E0D8] rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-2">
          <AlertCircle className="w-4 h-4 text-amber-700" />
          <h3 className="text-sm font-bold text-[#1A1C19]">
            Tồn kho Chậm luân chuyển (Còn tồn kho lớn nhưng ít hoặc chưa phát sinh đơn trong kỳ)
          </h3>
        </div>
        <p className="text-xs text-[#5C5F58] mb-3">
          Gợi ý các mặt hàng nên đưa vào chương trình Flash Sale hoặc Mã giảm giá theo danh mục để giải phóng tồn kho.
        </p>
        {slowMovingProducts.length === 0 ? (
          <p className="text-xs text-[#5C5F58] py-4 text-center">
            Không có sản phẩm tồn kho chậm luân chuyển.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E5E0D8] text-[#5C5F58]">
                  <th className="py-2 pr-3 font-semibold">Sản phẩm</th>
                  <th className="py-2 px-3 font-semibold">Danh mục</th>
                  <th className="py-2 px-3 font-semibold text-right">Tồn kho hiện tại</th>
                  <th className="py-2 pl-3 font-semibold text-right">Số lượng đặt trong kỳ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0ECE1]">
                {slowMovingProducts.slice(0, 10).map((item) => (
                  <tr key={item.productId} className="hover:bg-[#FAF8F5]">
                    <td className="py-2 pr-3 font-medium text-[#1A1C19]">{item.productName}</td>
                    <td className="py-2 px-3 text-[#5C5F58]">{item.categoryName}</td>
                    <td className="py-2 px-3 text-right font-semibold text-amber-800">
                      {item.totalStock.toLocaleString('vi-VN')}
                    </td>
                    <td className="py-2 pl-3 text-right text-[#5C5F58]">
                      {item.periodSoldQty.toLocaleString('vi-VN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
