import React, { useState, useEffect } from 'react';
import { X, RotateCcw, SlidersHorizontal, Check, Star, Tag } from 'lucide-react';
import type { Category, ProductFilterState, TargetGender, ColorSwatch } from '../../types/index.ts';

interface ProductFilterPanelProps {
  filters: ProductFilterState;
  categories: Category[];
  availableColors: ColorSwatch[];
  availableSizes: string[];
  onUpdateFilters: (partial: Partial<ProductFilterState>) => void;
  onResetFilters: () => void;
  isMobileDrawer?: boolean;
  onCloseMobileDrawer?: () => void;
}

export const ProductFilterPanel: React.FC<ProductFilterPanelProps> = ({
  filters,
  categories,
  availableColors,
  availableSizes,
  onUpdateFilters,
  onResetFilters,
  isMobileDrawer = false,
  onCloseMobileDrawer,
}) => {
  const [localMinPrice, setLocalMinPrice] = useState(filters.minPrice);
  const [localMaxPrice, setLocalMaxPrice] = useState(filters.maxPrice);

  useEffect(() => {
    setLocalMinPrice(filters.minPrice);
    setLocalMaxPrice(filters.maxPrice);
  }, [filters.minPrice, filters.maxPrice]);

  const handleApplyPriceRange = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateFilters({
      minPrice: localMinPrice.trim(),
      maxPrice: localMaxPrice.trim(),
      page: 1,
    });
  };

  const handlePresetPrice = (min: string, max: string) => {
    setLocalMinPrice(min);
    setLocalMaxPrice(max);
    onUpdateFilters({ minPrice: min, maxPrice: max, page: 1 });
  };

  const hasActiveFilters =
    filters.q !== '' ||
    filters.gender !== 'all' ||
    !filters.includeUnisex ||
    filters.category !== '' ||
    filters.minPrice !== '' ||
    filters.maxPrice !== '' ||
    filters.size !== '' ||
    filters.color !== '' ||
    filters.onSale ||
    filters.inStock ||
    filters.minRating !== '';

  return (
    <div className="space-y-6 text-xs text-[#1A1C19]">
      {/* Header bộ lọc */}
      <div className="flex items-center justify-between pb-3 border-b border-[#E8E4DA]">
        <div className="flex items-center gap-2 font-bold text-sm text-[#1A1C19]">
          <SlidersHorizontal className="w-4 h-4 text-[#2D4A3E]" />
          <span>Bộ Lọc Sản Phẩm</span>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="flex items-center gap-1 text-[11px] font-semibold text-[#C27D56] hover:underline"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Đặt lại</span>
            </button>
          )}
          {isMobileDrawer && onCloseMobileDrawer && (
            <button
              type="button"
              onClick={onCloseMobileDrawer}
              className="p-1.5 text-[#6B665C] hover:text-[#1A1C19] rounded-md"
              aria-label="Đóng bộ lọc"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* 1. LỌC ĐỐI TƯỢNG & TÙY CHỌN BAO GỒM UNISEX */}
      <div className="space-y-2.5">
        <div className="font-bold text-[#1A1C19] uppercase tracking-wider text-[11px]">
          Đối tượng
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: 'all', label: 'Tất cả' },
              { value: 'men', label: 'Nam' },
              { value: 'women', label: 'Nữ' },
              { value: 'unisex', label: 'Unisex' },
            ] as { value: TargetGender | 'all'; label: string }[]
          ).map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() => onUpdateFilters({ gender: g.value, page: 1 })}
              className={`py-2 px-3 rounded-lg border font-semibold transition-all text-left flex items-center justify-between ${
                filters.gender === g.value
                  ? 'border-[#2D4A3E] bg-[#2D4A3E] text-white'
                  : 'border-[#E0DCD3] bg-white text-[#4A4740] hover:border-[#2D4A3E]'
              }`}
            >
              <span>{g.label}</span>
              {filters.gender === g.value && <Check className="w-3.5 h-3.5" />}
            </button>
          ))}
        </div>

        {/* Tùy chọn hiển thị kèm sản phẩm Unisex khi đang lọc Nam hoặc Nữ */}
        {(filters.gender === 'men' || filters.gender === 'women') && (
          <label className="flex items-center gap-2 pt-1 cursor-pointer select-none text-[#4A4740]">
            <input
              type="checkbox"
              checked={filters.includeUnisex}
              onChange={(e) =>
                onUpdateFilters({ includeUnisex: e.target.checked, page: 1 })
              }
              className="w-4 h-4 rounded border-[#C5BFB3] text-[#2D4A3E] focus:ring-[#2D4A3E]"
            />
            <span>Hiển thị cả sản phẩm Unisex</span>
          </label>
        )}
      </div>

      {/* 2. LỌC DANH MỤC */}
      <div className="space-y-2.5 pt-4 border-t border-[#EFECE6]">
        <div className="font-bold text-[#1A1C19] uppercase tracking-wider text-[11px]">
          Danh mục trang phục
        </div>
        <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
          <button
            type="button"
            onClick={() => onUpdateFilters({ category: '', page: 1 })}
            className={`w-full py-1.5 px-2.5 rounded-lg text-left transition-colors flex items-center justify-between ${
              filters.category === ''
                ? 'bg-[#F0ECE1] text-[#2D4A3E] font-bold'
                : 'text-[#4A4740] hover:bg-[#F5F2EB]'
            }`}
          >
            <span>Tất cả danh mục</span>
            {filters.category === '' && <Check className="w-3.5 h-3.5" />}
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() =>
                onUpdateFilters({
                  category: filters.category === cat.slug ? '' : cat.slug,
                  page: 1,
                })
              }
              className={`w-full py-1.5 px-2.5 rounded-lg text-left transition-colors flex items-center justify-between ${
                filters.category === cat.slug
                  ? 'bg-[#F0ECE1] text-[#2D4A3E] font-bold'
                  : 'text-[#4A4740] hover:bg-[#F5F2EB]'
              }`}
            >
              <span>{cat.name}</span>
              {filters.category === cat.slug && <Check className="w-3.5 h-3.5" />}
            </button>
          ))}
        </div>
      </div>

      {/* 3. TRẠNG THÁI KHUYẾN MÃI & TỒN KHO */}
      <div className="space-y-2.5 pt-4 border-t border-[#EFECE6]">
        <div className="font-bold text-[#1A1C19] uppercase tracking-wider text-[11px]">
          Ưu đãi & Tình trạng
        </div>
        <label className="flex items-center gap-2.5 cursor-pointer select-none py-1">
          <input
            type="checkbox"
            checked={filters.onSale}
            onChange={(e) => onUpdateFilters({ onSale: e.target.checked, page: 1 })}
            className="w-4 h-4 rounded border-[#C5BFB3] text-[#2D4A3E] focus:ring-[#2D4A3E]"
          />
          <span className="flex items-center gap-1.5 font-medium text-[#1A1C19]">
            <Tag className="w-3.5 h-3.5 text-[#C27D56]" />
            <span>Đang giảm giá (Flash Sale)</span>
          </span>
        </label>

        <label className="flex items-center gap-2.5 cursor-pointer select-none py-1">
          <input
            type="checkbox"
            checked={filters.inStock}
            onChange={(e) => onUpdateFilters({ inStock: e.target.checked, page: 1 })}
            className="w-4 h-4 rounded border-[#C5BFB3] text-[#2D4A3E] focus:ring-[#2D4A3E]"
          />
          <span className="font-medium text-[#1A1C19]">Chỉ hiện sản phẩm còn hàng</span>
        </label>
      </div>

      {/* 4. LỌC KHOẢNG GIÁ HIỆU LỰC */}
      <div className="space-y-2.5 pt-4 border-t border-[#EFECE6]">
        <div className="font-bold text-[#1A1C19] uppercase tracking-wider text-[11px]">
          Khoảng giá (VNĐ)
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: 'Tất cả', min: '', max: '' },
            { label: 'Dưới 300K', min: '', max: '300000' },
            { label: '300K - 500K', min: '300000', max: '500000' },
            { label: 'Trên 500K', min: '500000', max: '' },
          ].map((preset) => {
            const active =
              filters.minPrice === preset.min && filters.maxPrice === preset.max;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => handlePresetPrice(preset.min, preset.max)}
                className={`px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors ${
                  active
                    ? 'border-[#2D4A3E] bg-[#2D4A3E] text-white'
                    : 'border-[#E0DCD3] bg-white text-[#4A4740] hover:border-[#2D4A3E]'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <form onSubmit={handleApplyPriceRange} className="space-y-2 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="number"
              min={0}
              step={10000}
              placeholder="Từ (₫)"
              value={localMinPrice}
              onChange={(e) => setLocalMinPrice(e.target.value)}
              aria-label="Giá tối thiểu"
              className="w-full px-2.5 py-1.5 bg-white border border-[#D5D0C5] rounded-lg text-xs tabular-nums focus:outline-none focus:border-[#2D4A3E]"
            />
            <input
              type="number"
              min={0}
              step={10000}
              placeholder="Đến (₫)"
              value={localMaxPrice}
              onChange={(e) => setLocalMaxPrice(e.target.value)}
              aria-label="Giá tối đa"
              className="w-full px-2.5 py-1.5 bg-white border border-[#D5D0C5] rounded-lg text-xs tabular-nums focus:outline-none focus:border-[#2D4A3E]"
            />
          </div>
          <button
            type="submit"
            className="w-full py-1.5 bg-[#F0ECE1] hover:bg-[#E5DFD0] text-[#2D4A3E] font-semibold rounded-lg transition-colors"
          >
            Áp dụng khoảng giá
          </button>
        </form>
      </div>

      {/* 5. LỌC KÍCH CỠ (SIZE) */}
      {availableSizes.length > 0 && (
        <div className="space-y-2.5 pt-4 border-t border-[#EFECE6]">
          <div className="font-bold text-[#1A1C19] uppercase tracking-wider text-[11px]">
            Kích cỡ (Size)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {availableSizes.map((s) => {
              const isSelected = filters.size === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() =>
                    onUpdateFilters({ size: isSelected ? '' : s, page: 1 })
                  }
                  className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                    isSelected
                      ? 'border-[#2D4A3E] bg-[#2D4A3E] text-white'
                      : 'border-[#E0DCD3] bg-white text-[#4A4740] hover:border-[#2D4A3E]'
                  }`}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 6. LỌC MÀU SẮC */}
      {availableColors.length > 0 && (
        <div className="space-y-2.5 pt-4 border-t border-[#EFECE6]">
          <div className="font-bold text-[#1A1C19] uppercase tracking-wider text-[11px]">
            Màu sắc
          </div>
          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto pr-1">
            {availableColors.slice(0, 18).map((c, idx) => {
              const isSelected = filters.color === c.color_name;
              return (
                <button
                  key={`${c.color_name}-${c.color_code}-${idx}`}
                  type="button"
                  onClick={() =>
                    onUpdateFilters({
                      color: isSelected ? '' : c.color_name,
                      page: 1,
                    })
                  }
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] transition-all ${
                    isSelected
                      ? 'border-[#2D4A3E] bg-[#F0ECE1] text-[#1A1C19] font-semibold'
                      : 'border-[#E0DCD3] bg-white text-[#5C584F] hover:border-[#B5AFA2]'
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full border border-black/15 shrink-0"
                    style={{ backgroundColor: c.color_code }}
                  />
                  <span className="truncate max-w-[90px]">{c.color_name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 7. LỌC ĐÁNH GIÁ TỐI THIỂU */}
      <div className="space-y-2 pt-4 border-t border-[#EFECE6]">
        <div className="font-bold text-[#1A1C19] uppercase tracking-wider text-[11px]">
          Đánh giá khách hàng
        </div>
        <div className="space-y-1">
          {[
            { val: '', label: 'Tất cả mức đánh giá' },
            { val: '4', label: 'Từ 4 sao trở lên' },
            { val: '5', label: '5 sao tuyệt đối' },
          ].map((r) => (
            <button
              key={r.val}
              type="button"
              onClick={() =>
                onUpdateFilters({
                  minRating: filters.minRating === r.val ? '' : r.val,
                  page: 1,
                })
              }
              className={`w-full py-1.5 px-2.5 rounded-lg text-left flex items-center justify-between transition-colors ${
                filters.minRating === r.val
                  ? 'bg-[#F0ECE1] text-[#2D4A3E] font-bold'
                  : 'text-[#4A4740] hover:bg-[#F5F2EB]'
              }`}
            >
              <span className="flex items-center gap-1.5">
                {r.val && <Star className="w-3.5 h-3.5 fill-[#D99B26] text-[#D99B26]" />}
                <span>{r.label}</span>
              </span>
              {filters.minRating === r.val && <Check className="w-3.5 h-3.5" />}
            </button>
          ))}
        </div>
      </div>

      {isMobileDrawer && onCloseMobileDrawer && (
        <div className="pt-4 border-t border-[#E8E4DA]">
          <button
            type="button"
            onClick={onCloseMobileDrawer}
            className="w-full py-3 bg-[#2D4A3E] text-white text-xs font-bold uppercase tracking-wider rounded-xl"
          >
            Xem kết quả lọc
          </button>
        </div>
      )}
    </div>
  );
};
