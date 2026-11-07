import React, { useState, useEffect, useRef } from 'react';
import { Search, Camera, Heart, ShoppingBag, User as UserIcon, Menu, X, ArrowRight } from 'lucide-react';
import { ImageWithFallback } from '../common/ImageWithFallback.tsx';
import { DEFAULT_SHIPPING_CONFIG } from '../../../shared/contracts.ts';
import type { TargetGender, User, ProductSummary } from '../../types/index.ts';

interface NavbarProps {
  activeTab: string;
  searchQuery?: string;
  onSelectGender: (gender: TargetGender | 'all') => void;
  onSearchSubmit?: (query: string) => void;
  onSelectProductSlug?: (slug: string) => void;
  onOpenImageSearch: () => void;
  onOpenCart: () => void;
  onOpenWishlist?: () => void;
  onOpenMobileMenu: () => void;
  onOpenSizeGuide: () => void;
  onNavigateHome: () => void;
  currentUser?: User | null;
  onOpenAuth: () => void;
  onOpenAccount: () => void;
  cartCount?: number;
  wishlistCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  searchQuery = '',
  onSelectGender,
  onSearchSubmit,
  onSelectProductSlug,
  onOpenImageSearch,
  onOpenCart,
  onOpenWishlist,
  onOpenMobileMenu,
  onNavigateHome,
  currentUser,
  onOpenAuth,
  onOpenAccount,
  cartCount = 0,
  wishlistCount = 0,
}) => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [inputVal, setInputVal] = useState(searchQuery);
  const [suggestions, setSuggestions] = useState<ProductSummary[]>([]);
  const [isSuggestLoading, setIsSuggestLoading] = useState(false);
  const [freeShippingThreshold, setFreeShippingThreshold] = useState<number>(
    DEFAULT_SHIPPING_CONFIG.freeShippingThreshold
  );
  const [returnDaysLimit, setReturnDaysLimit] = useState<number>(
    DEFAULT_SHIPPING_CONFIG.returnDaysLimit
  );
  const [bannerText, setBannerText] = useState<string>('');
  const [storeName, setStoreName] = useState<string>('BAITY');
  const searchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputVal(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    let mounted = true;
    fetch('/api/settings/general')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!mounted || !body) return;
        const data = body.data || body;
        if (typeof data?.freeShippingThreshold === 'number' && data.freeShippingThreshold >= 0) {
          setFreeShippingThreshold(data.freeShippingThreshold);
        }
        if (typeof data?.returnDaysLimit === 'number' && data.returnDaysLimit > 0) {
          setReturnDaysLimit(data.returnDaysLimit);
        }
        if (typeof data?.bannerText === 'string') {
          setBannerText(data.bannerText.trim());
        }
        if (typeof data?.storeName === 'string' && data.storeName.trim()) {
          setStoreName(data.storeName.trim());
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // Đóng dropdown khi click ra ngoài
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Gọi API gợi ý tìm kiếm tự động (GET /api/products/suggest?q=)
  useEffect(() => {
    const trimmed = inputVal.trim();
    if (!isSearchOpen || trimmed.length < 1) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(() => {
      setIsSuggestLoading(true);
      fetch(`/api/products/suggest?q=${encodeURIComponent(trimmed)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && Array.isArray(data.suggestions)) {
            setSuggestions(data.suggestions.slice(0, 8));
          }
        })
        .catch(() => {})
        .finally(() => setIsSuggestLoading(false));
    }, 200);

    return () => clearTimeout(timer);
  }, [inputVal, isSearchOpen]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchSubmit?.(inputVal.trim());
    setIsSearchOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-[#FAF8F5]/95 backdrop-blur-md border-b border-[#E8E4DA] transition-all">
      {/* Thanh thông báo tiện ích trên cùng (đọc bannerText, ngưỡng freeship và thời hạn đổi trả từ store_settings) */}
      <div className="bg-[#2D4A3E] text-white text-[11px] font-medium py-1.5 px-4 text-center tracking-wide">
        <span>
          {bannerText
            ? `${bannerText} · Miễn phí vận chuyển từ ${freeShippingThreshold.toLocaleString('vi-VN')}₫ · Đổi trả ${returnDaysLimit} ngày`
            : `Miễn phí vận chuyển toàn quốc cho đơn hàng từ ${freeShippingThreshold.toLocaleString('vi-VN')}₫ · Đổi trả ${returnDaysLimit} ngày`}
        </span>
      </div>

      {/* Top Bar Contract (Đúng 3 khu vực cách nhau gap-8) */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between gap-6">
        {/* KHU VỰC 1: Wordmark thương hiệu BAITY */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={onOpenMobileMenu}
            className="md:hidden p-2 -ml-2 text-[#1A1C19] hover:text-[#2D4A3E] focus:outline-none"
            aria-label="Mở menu điều hướng"
          >
            <Menu className="w-5 h-5" />
          </button>
          <button
            onClick={onNavigateHome}
            className="font-display text-2xl font-extrabold tracking-widest text-[#2D4A3E] hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
          >
            {storeName}
          </button>
        </div>

        {/* KHU VỰC 2: Nav links sạch sẽ, 1 dòng */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#4A4740]">
          <button
            onClick={() => onSelectGender('men')}
            className={`whitespace-nowrap transition-colors hover:text-[#2D4A3E] pb-1 border-b-2 ${
              activeTab === 'men'
                ? 'border-[#2D4A3E] text-[#2D4A3E] font-semibold'
                : 'border-transparent'
            }`}
          >
            Nam
          </button>
          <button
            onClick={() => onSelectGender('women')}
            className={`whitespace-nowrap transition-colors hover:text-[#2D4A3E] pb-1 border-b-2 ${
              activeTab === 'women'
                ? 'border-[#2D4A3E] text-[#2D4A3E] font-semibold'
                : 'border-transparent'
            }`}
          >
            Nữ
          </button>
          <button
            onClick={() => onSelectGender('unisex')}
            className={`whitespace-nowrap transition-colors hover:text-[#2D4A3E] pb-1 border-b-2 ${
              activeTab === 'unisex'
                ? 'border-[#2D4A3E] text-[#2D4A3E] font-semibold'
                : 'border-transparent'
            }`}
          >
            Unisex
          </button>
          <button
            onClick={() => onSelectGender('all')}
            className={`whitespace-nowrap transition-colors hover:text-[#2D4A3E] pb-1 border-b-2 ${
              activeTab === 'all'
                ? 'border-[#2D4A3E] text-[#2D4A3E] font-semibold'
                : 'border-transparent'
            }`}
          >
            Tất cả sản phẩm
          </button>
          <button
            onClick={onOpenImageSearch}
            className="flex items-center gap-1.5 text-[#2D4A3E] hover:text-[#233B31] font-semibold whitespace-nowrap transition-colors"
            title="Tìm sản phẩm bằng hình ảnh AI"
          >
            <Camera className="w-4 h-4 text-[#C27D56]" />
            <span>Tìm bằng ảnh AI</span>
          </button>
        </nav>

        {/* KHU VỰC 3: Các hành động người dùng & Tìm kiếm nhanh */}
        <div className="flex items-center gap-2.5 sm:gap-3.5 shrink-0" ref={searchContainerRef}>
          {/* Ô tìm kiếm thông minh kèm gợi ý Autocomplete */}
          <div className="relative">
            {isSearchOpen ? (
              <form onSubmit={handleFormSubmit} className="flex items-center">
                <input
                  type="search"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  placeholder="Tìm áo sơ mi, blazer, jean..."
                  autoFocus
                  aria-label="Tìm kiếm sản phẩm"
                  className="w-44 sm:w-64 pl-3 pr-8 py-1.5 text-xs bg-white border border-[#2D4A3E] rounded-full text-[#1A1C19] focus:outline-none shadow-xs"
                />
                {inputVal && (
                  <button
                    type="button"
                    onClick={() => {
                      setInputVal('');
                      onSearchSubmit?.('');
                    }}
                    className=" -ml-6 p-1 text-[#7A7569] hover:text-[#1A1C19]"
                    aria-label="Xóa từ khóa"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </form>
            ) : (
              <button
                onClick={() => setIsSearchOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[#4A4740] hover:text-[#2D4A3E] bg-[#F2EFE9] hover:bg-[#EAE5DC] rounded-full transition-colors"
                title="Tìm kiếm"
                aria-label="Tìm kiếm sản phẩm"
              >
                <Search className="w-4 h-4" />
                <span className="hidden lg:inline text-[#6B665C]">
                  {searchQuery ? `"${searchQuery}"` : 'Tìm kiếm...'}
                </span>
              </button>
            )}

            {/* Dropdown 8 gợi ý tìm kiếm nhanh (GET /api/products/suggest) */}
            {isSearchOpen && inputVal.trim().length > 0 && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-2xl border border-[#E0DCD3] overflow-hidden z-50">
                <div className="px-3.5 py-2 bg-[#FAF8F5] border-b border-[#EAE6DE] flex items-center justify-between text-[11px] text-[#6B665C]">
                  <span>Gợi ý sản phẩm phù hợp</span>
                  {isSuggestLoading && <span>Đang tìm...</span>}
                </div>
                {suggestions.length > 0 ? (
                  <div className="divide-y divide-[#F2EFE9] max-h-96 overflow-y-auto">
                    {suggestions.map((item) => {
                      const effPrice = item.effective_price ?? item.base_price;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setIsSearchOpen(false);
                            onSelectProductSlug?.(item.slug);
                          }}
                          className="w-full p-2.5 flex items-center gap-3 hover:bg-[#FAF8F5] text-left transition-colors"
                        >
                          <div className="w-11 h-14 rounded-md overflow-hidden bg-[#F5F2EB] shrink-0">
                            <ImageWithFallback
                              src={item.primary_image}
                              alt={item.name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-[#1A1C19] truncate">
                              {item.name}
                            </div>
                            <div className="text-[11px] text-[#7A7569] mt-0.5">
                              {item.category_name} ·{' '}
                              {item.target_gender === 'men'
                                ? 'Nam'
                                : item.target_gender === 'women'
                                ? 'Nữ'
                                : 'Unisex'}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 tabular-nums">
                              <span className="text-xs font-bold text-[#2D4A3E]">
                                {effPrice.toLocaleString('vi-VN')}₫
                              </span>
                              {item.is_on_sale && effPrice < item.base_price && (
                                <span className="text-[10px] text-[#8C877B] line-through">
                                  {item.base_price.toLocaleString('vi-VN')}₫
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={handleFormSubmit}
                      className="w-full py-2.5 px-4 bg-[#F5F2EB] hover:bg-[#ECE7DC] text-xs font-semibold text-[#2D4A3E] flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <span>Xem tất cả kết quả cho "{inputVal.trim()}"</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : !isSuggestLoading ? (
                  <div className="p-4 text-center text-xs text-[#7A7569]">
                    Không tìm thấy sản phẩm khớp với "{inputVal.trim()}"
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <button
            onClick={onOpenImageSearch}
            className="md:hidden flex items-center justify-center p-2 text-[#2D4A3E] hover:bg-[#F0ECE1] rounded-full transition-colors"
            title="Tìm đồ bằng ảnh AI (Sắp ra mắt)"
            aria-label="Tìm bằng ảnh AI (Sắp ra mắt)"
          >
            <Camera className="w-5 h-5 text-[#C27D56]" />
          </button>

          <button
            type="button"
            onClick={onOpenWishlist}
            className="relative flex items-center justify-center p-2 text-[#4A4740] hover:text-[#2D4A3E] hover:bg-[#F0ECE1] rounded-full transition-colors"
            title="Danh sách yêu thích"
            aria-label="Danh sách yêu thích"
          >
            <Heart className="w-5 h-5" />
            {wishlistCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-[#C27D56] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {wishlistCount}
              </span>
            )}
          </button>

          <button
            onClick={onOpenCart}
            className="relative flex items-center justify-center p-2 text-[#4A4740] hover:text-[#2D4A3E] hover:bg-[#F0ECE1] rounded-full transition-colors"
            title="Giỏ hàng"
            aria-label="Giỏ hàng"
          >
            <ShoppingBag className="w-5 h-5" />
            {cartCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-[#2D4A3E] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </button>

          {currentUser ? (
            <button
              onClick={onOpenAccount}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-[#1A1C19] border border-[#2D4A3E]/30 bg-[#F0ECE1] rounded-full hover:bg-[#E8E2D5] transition-colors whitespace-nowrap shrink-0"
              aria-label="Quản lý tài khoản"
            >
              {currentUser.avatarUrl ? (
                <img src={currentUser.avatarUrl} alt="" className="w-4 h-4 rounded-full object-cover" />
              ) : (
                <div className="w-4 h-4 rounded-full bg-[#2D4A3E] text-white flex items-center justify-center text-[9px] font-bold">
                  {currentUser.fullName ? currentUser.fullName.slice(0, 1).toUpperCase() : 'U'}
                </div>
              )}
              <span className="max-w-[100px] truncate">{currentUser.fullName}</span>
            </button>
          ) : (
            <button
              onClick={onOpenAuth}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#2D4A3E] border border-[#2D4A3E] rounded-full hover:bg-[#2D4A3E] hover:text-white transition-all whitespace-nowrap shrink-0"
              aria-label="Đăng nhập"
            >
              <UserIcon className="w-3.5 h-3.5" />
              <span>Đăng nhập</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
