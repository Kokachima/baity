import React from 'react';
import {
  X,
  ShoppingBag,
  Trash2,
  Plus,
  Minus,
  ArrowRight,
  Truck,
  Package,
} from 'lucide-react';
import { ImageWithFallback } from '../common/ImageWithFallback.tsx';
import type { CartItemState, CartSummaryState } from '../../types/index.ts';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  items: CartItemState[];
  summary: CartSummaryState;
  isUpdating: boolean;
  onUpdateQuantity: (itemId: string, newQty: number) => void;
  onRemoveItem: (itemId: string) => void;
  onSelectProductSlug: (slug: string) => void;
  onProceedToCheckout: () => void;
  onOpenMyOrders: () => void;
  isAuthenticated: boolean;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  items,
  summary,
  isUpdating,
  onUpdateQuantity,
  onRemoveItem,
  onSelectProductSlug,
  onProceedToCheckout,
  onOpenMyOrders,
  isAuthenticated,
}) => {
  if (!isOpen) return null;

  const freeShipProgress = Math.min(
    100,
    Math.round((summary.subtotal / (summary.freeShippingThreshold || 499000)) * 100)
  );
  const amountNeededForFreeShip = Math.max(
    (summary.freeShippingThreshold || 499000) - summary.subtotal,
    0
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Giỏ hàng">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md bg-[#FAF8F5] h-full flex flex-col shadow-2xl z-10 border-l border-[#E0DCD3]">
        {/* Header */}
        <div className="px-5 py-4 bg-white border-b border-[#E8E4DA] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShoppingBag className="w-5 h-5 text-[#2D4A3E]" />
            <h2 className="font-display text-base font-bold text-[#1A1C19]">
              Giỏ Hàng Của Bạn ({summary.totalItems})
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {isAuthenticated && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenMyOrders();
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#2D4A3E] bg-[#F0ECE1] hover:bg-[#E5DFD0] rounded-lg transition-colors"
              >
                <Package className="w-3.5 h-3.5" />
                <span>Đơn mua</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-[#6B665C] hover:text-[#1A1C19] rounded-lg hover:bg-[#F2EFE9]"
              aria-label="Đóng giỏ hàng"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Thanh tiến trình miễn phí vận chuyển 499K */}
        <div className="px-5 py-3 bg-[#F2EFE9] border-b border-[#E5E0D5] space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-[#2D4A3E] font-medium">
            <Truck className="w-4 h-4 shrink-0 text-[#C27D56]" />
            {amountNeededForFreeShip === 0 && summary.subtotal > 0 ? (
              <span>
                Đơn hàng đã đủ điều kiện <strong>Miễn phí vận chuyển tiêu chuẩn!</strong>
              </span>
            ) : (
              <span>
                Mua thêm{' '}
                <strong className="tabular-nums">
                  {amountNeededForFreeShip.toLocaleString('vi-VN')}₫
                </strong>{' '}
                để được <strong>Miễn phí vận chuyển</strong>
              </span>
            )}
          </div>
          <div className="w-full h-1.5 bg-[#E0DCD3] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#2D4A3E] transition-all duration-300"
              style={{ width: `${summary.subtotal > 0 ? freeShipProgress : 0}%` }}
            />
          </div>
        </div>

        {/* Danh sách món trong giỏ */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12 space-y-4">
              <div className="w-14 h-14 rounded-full bg-[#EFECE6] text-[#7A7569] flex items-center justify-center">
                <ShoppingBag className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-display text-base font-bold text-[#1A1C19]">
                  Giỏ hàng đang trống
                </h3>
                <p className="text-xs text-[#6B665C] max-w-xs">
                  Hãy khám phá các thiết kế thời trang Nam, Nữ & Unisex của Baity và thêm vào giỏ hàng nhé.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 bg-[#2D4A3E] text-white text-xs font-semibold rounded-lg hover:bg-[#233B31] transition-colors"
              >
                Tiếp tục mua sắm
              </button>
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                data-testid={`cart-item-${item.sku}`}
                className="p-3.5 bg-white rounded-xl border border-[#EAE6DE] flex gap-3.5 shadow-2xs"
              >
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onSelectProductSlug(item.productSlug);
                  }}
                  className="w-20 h-24 rounded-lg overflow-hidden bg-[#F5F2EB] shrink-0 border border-[#EFECE6]"
                >
                  <ImageWithFallback
                    src={item.imageUrl}
                    alt={item.productName}
                    className="w-full h-full object-cover"
                  />
                </button>

                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onSelectProductSlug(item.productSlug);
                        }}
                        className="text-xs font-bold text-[#1A1C19] hover:text-[#2D4A3E] text-left line-clamp-2"
                      >
                        {item.productName}
                      </button>
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() => onRemoveItem(item.id)}
                        className="p-1 text-[#8C877B] hover:text-red-600 transition-colors shrink-0"
                        aria-label={`Xóa ${item.productName}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#6B665C]">
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-black/15 inline-block"
                        style={{ backgroundColor: item.colorCode }}
                      />
                      <span>{item.colorName}</span>
                      <span aria-hidden="true">·</span>
                      <span>Size {item.size}</span>
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-between gap-2">
                    {/* Bộ tăng giảm số lượng (PUT /api/cart/:id) */}
                    <div className="inline-flex items-center border border-[#D5D0C5] rounded-lg bg-[#FAF8F5]">
                      <button
                        type="button"
                        disabled={isUpdating || item.quantity <= 1}
                        onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                        className="p-1.5 text-[#4A4740] hover:text-[#1A1C19] disabled:opacity-40"
                        aria-label="Giảm số lượng"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="px-2.5 text-xs font-bold tabular-nums text-[#1A1C19]">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        disabled={isUpdating || item.quantity >= item.stockQuantity}
                        onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                        className="p-1.5 text-[#4A4740] hover:text-[#1A1C19] disabled:opacity-40"
                        aria-label="Tăng số lượng"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Đơn giá hiệu lực & Thành tiền */}
                    <div className="text-right tabular-nums">
                      <div className="text-xs font-bold text-[#2D4A3E]">
                        {item.lineTotal.toLocaleString('vi-VN')}₫
                      </div>
                      {item.isOnSale && item.effectivePrice < Math.max(item.initialPrice, item.basePrice) && (
                        <div className="text-[10px] text-[#8C877B] line-through">
                          {(Math.max(item.initialPrice, item.basePrice) * item.quantity).toLocaleString('vi-VN')}₫
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer Tổng kết & Nút Thanh Toán */}
        {items.length > 0 && (
          <div className="p-5 bg-white border-t border-[#E8E4DA] space-y-4">
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-[#5C584F]">
                <span>Tạm tính ({summary.totalItems} sản phẩm)</span>
                <span className="font-semibold text-[#1A1C19] tabular-nums">
                  {summary.subtotal.toLocaleString('vi-VN')}₫
                </span>
              </div>
              <div className="flex items-center justify-between text-[#5C584F]">
                <span>Phí vận chuyển dự kiến</span>
                <span className="font-semibold text-[#2D4A3E] tabular-nums">
                  {summary.estimatedShippingFee === 0
                    ? 'Miễn phí'
                    : `${summary.estimatedShippingFee.toLocaleString('vi-VN')}₫`}
                </span>
              </div>
              <div className="pt-2 border-t border-[#F2EFE9] flex items-center justify-between text-sm font-bold text-[#1A1C19]">
                <span>Tổng cộng</span>
                <span className="text-base text-[#2D4A3E] tabular-nums">
                  {summary.estimatedTotal.toLocaleString('vi-VN')}₫
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={onProceedToCheckout}
              className="w-full py-3.5 px-5 bg-[#2D4A3E] hover:bg-[#233B31] text-white text-xs font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 shadow-sm transition-colors"
            >
              <span>Tiến hành đặt hàng & Thanh toán</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
