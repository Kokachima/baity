import React from 'react';
import { Heart, ShoppingBag, Star } from 'lucide-react';
import { ImageWithFallback } from '../common/ImageWithFallback.tsx';
import type { ProductSummary } from '../../types/index.ts';

interface ProductCardProps {
  product: ProductSummary;
  onSelect: (product: ProductSummary) => void;
  onAddToCart?: (product: ProductSummary) => void;
  onToggleWishlist?: (product: ProductSummary) => void;
  isWishlisted?: boolean;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onSelect,
  onAddToCart,
  onToggleWishlist,
  isWishlisted = false,
}) => {
  const genderLabel =
    product.target_gender === 'men'
      ? 'Nam'
      : product.target_gender === 'women'
      ? 'Nữ'
      : 'Unisex';

  const isLowStock = product.total_stock > 0 && product.total_stock <= 5;
  const isOutOfStock = product.total_stock === 0;
  const discountPercent = product.discount_percent || 0;
  const effectivePrice = product.effective_price || product.base_price;
  const isOnSale =
    Boolean(product.is_on_sale) ||
    discountPercent > 0 ||
    effectivePrice < product.base_price;
  const badgeDiscountPercent =
    discountPercent > 0
      ? discountPercent
      : effectivePrice < product.base_price
      ? Math.max(1, Math.round(((product.base_price - effectivePrice) / product.base_price) * 100))
      : 0;
  const ratingAvg = Number(product.rating_avg || 0);
  const reviewCount = Number(product.review_count || 0);

  return (
    <div
      onClick={() => onSelect(product)}
      className="group relative flex flex-col bg-white rounded-xl overflow-hidden border border-[#EAE6DE] hover:border-[#D0C9BC] hover:shadow-md transition-all duration-200 cursor-pointer"
    >
      {/* Khung ảnh sản phẩm (65%-75% chiều cao card, backdrop trung tính) */}
      <div className="relative aspect-4/5 w-full bg-[#F5F2EB] overflow-hidden">
        <ImageWithFallback
          src={product.primary_image}
          alt={product.name}
          className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-500 ease-out"
        />

        {/* Nhãn giảm giá góc trên trái: hiển thị nhất quán khi thật sự có khuyến mãi hoặc price_override giảm so với giá gốc */}
        {isOnSale && badgeDiscountPercent > 0 && (
          <div className="absolute top-2.5 left-2.5 px-2 py-0.5 bg-[#C27D56] text-white text-[11px] font-bold tracking-wide rounded-xs shadow-2xs">
            -{badgeDiscountPercent}%
          </div>
        )}

        {/* Nút Yêu thích nhanh */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleWishlist?.(product);
          }}
          className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-white/90 backdrop-blur-xs flex items-center justify-center text-[#4A4740] hover:text-[#C27D56] shadow-xs transition-colors"
          aria-label="Thêm vào danh sách yêu thích"
        >
          <Heart
            className={`w-4 h-4 ${
              isWishlisted ? 'fill-[#C27D56] text-[#C27D56]' : ''
            }`}
          />
        </button>

        {/* Nhãn tình trạng kho hàng tinh tế */}
        {isOutOfStock ? (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] flex items-center justify-center">
            <span className="px-3 py-1 bg-[#1A1C19] text-white text-[11px] font-semibold tracking-wider uppercase rounded-sm">
              Hết hàng
            </span>
          </div>
        ) : isLowStock ? (
          <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-[#F5F2EB]/95 border border-[#E0DCD3] text-[10px] font-medium text-[#7A5C43] rounded-xs">
            Còn {product.total_stock} chiếc
          </div>
        ) : null}
      </div>

      {/* Thông tin sản phẩm */}
      <div className="p-3.5 flex flex-col flex-1 justify-between gap-2">
        <div className="space-y-1">
          {/* Metadata: Danh mục · Đối tượng · Đánh giá */}
          <div className="flex items-center justify-between gap-1 text-[11px] text-[#7A7569]">
            <div className="flex items-center gap-1.5 truncate">
              <span className="truncate">{product.category_name}</span>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-[#2D4A3E] shrink-0">{genderLabel}</span>
            </div>
            {reviewCount > 0 && (
              <div className="flex items-center gap-0.5 shrink-0 tabular-nums text-[#1A1C19] font-medium">
                <Star className="w-3 h-3 fill-[#D99B26] text-[#D99B26]" />
                <span>{ratingAvg.toFixed(1)}</span>
                <span className="text-[#8C877B]">({reviewCount})</span>
              </div>
            )}
          </div>

          {/* Tên sản phẩm */}
          <h3 className="text-sm font-semibold text-[#1A1C19] line-clamp-2 leading-snug group-hover:text-[#2D4A3E] transition-colors">
            {product.name}
          </h3>
        </div>

        {/* Hàng dưới: Giá & Color swatches */}
        <div className="pt-2 border-t border-[#F2EFE9] flex items-center justify-between gap-2">
          {/* Giá tiền tabular-nums ("Từ X₫") */}
          <div className="flex items-baseline gap-1.5 tabular-nums">
            <span className="text-sm font-bold text-[#1A1C19]">
              Từ {effectivePrice.toLocaleString('vi-VN')}₫
            </span>
            {isOnSale && (
              <span className="text-[11px] text-[#8C877B] line-through">
                {product.base_price.toLocaleString('vi-VN')}₫
              </span>
            )}
          </div>

          {/* Các chấm màu (Color swatches) */}
          {product.colors && product.colors.length > 0 && (
            <div className="flex items-center gap-1">
              {product.colors.slice(0, 3).map((c, idx) => (
                <span
                  key={idx}
                  title={c.color_name}
                  className="w-3 h-3 rounded-full border border-black/15 shrink-0"
                  style={{ backgroundColor: c.color_code }}
                />
              ))}
              {product.colors.length > 3 && (
                <span className="text-[10px] text-[#8C877B]">
                  +{product.colors.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
