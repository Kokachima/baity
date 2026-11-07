import React from 'react';
import { X, Heart, Trash2, ArrowRight } from 'lucide-react';
import { ImageWithFallback } from '../common/ImageWithFallback.tsx';
import type { ProductSummary } from '../../types/index.ts';

interface WishlistDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: ProductSummary[];
  onRemoveItem: (productId: string) => void;
  onSelectProductSlug: (slug: string) => void;
}

export const WishlistDrawer: React.FC<WishlistDrawerProps> = ({
  isOpen,
  onClose,
  items,
  onRemoveItem,
  onSelectProductSlug,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Danh sách yêu thích">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md bg-[#FAF8F5] h-full flex flex-col shadow-2xl z-10 border-l border-[#E0DCD3]">
        <div className="px-5 py-4 bg-white border-b border-[#E8E4DA] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Heart className="w-5 h-5 text-[#C27D56] fill-[#C27D56]" />
            <h2 className="font-display text-base font-bold text-[#1A1C19]">
              Danh Sách Yêu Thích ({items.length})
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#6B665C] hover:text-[#1A1C19] rounded-lg hover:bg-[#F2EFE9]"
            aria-label="Đóng danh sách yêu thích"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12 space-y-4">
              <div className="w-14 h-14 rounded-full bg-[#EFECE6] text-[#7A7569] flex items-center justify-center">
                <Heart className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-display text-base font-bold text-[#1A1C19]">
                  Chưa có sản phẩm yêu thích
                </h3>
                <p className="text-xs text-[#6B665C] max-w-xs">
                  Nhấn biểu tượng trái tim trên sản phẩm bạn yêu thích để lưu lại xem sau.
                </p>
              </div>
            </div>
          ) : (
            items.map((prod) => {
              const effPrice = prod.effective_price ?? prod.base_price;
              return (
                <div
                  key={prod.id}
                  className="p-3 bg-white rounded-xl border border-[#EAE6DE] flex items-center gap-3.5 shadow-2xs"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSelectProductSlug(prod.slug);
                    }}
                    className="w-16 h-20 rounded-lg overflow-hidden bg-[#F5F2EB] shrink-0"
                  >
                    <ImageWithFallback
                      src={prod.primary_image}
                      alt={prod.name}
                      className="w-full h-full object-cover"
                    />
                  </button>

                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onSelectProductSlug(prod.slug);
                      }}
                      className="text-xs font-bold text-[#1A1C19] hover:text-[#2D4A3E] text-left line-clamp-2"
                    >
                      {prod.name}
                    </button>
                    <div className="text-[11px] text-[#7A7569] mt-0.5">
                      {prod.category_name}
                    </div>
                    <div className="mt-1 flex items-center gap-2 tabular-nums">
                      <span className="text-xs font-bold text-[#2D4A3E]">
                        Từ {effPrice.toLocaleString('vi-VN')}₫
                      </span>
                      {prod.is_on_sale && effPrice < prod.base_price && (
                        <span className="text-[10px] text-[#8C877B] line-through">
                          {prod.base_price.toLocaleString('vi-VN')}₫
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <button
                      type="button"
                      onClick={() => onRemoveItem(prod.id)}
                      className="p-1.5 text-[#8C877B] hover:text-red-600 transition-colors"
                      aria-label={`Bỏ yêu thích ${prod.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onSelectProductSlug(prod.slug);
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2D4A3E] hover:underline"
                    >
                      <span>Xem</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
