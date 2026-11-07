import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Ruler,
  Sparkles,
  Check,
  ShoppingBag,
  Heart,
  Star,
  ShieldCheck,
  Truck,
  RefreshCw,
  AlertCircle,
  Tag,
} from 'lucide-react';
import { ImageWithFallback } from '../common/ImageWithFallback.tsx';
import { ProductCard } from './ProductCard.tsx';
import { ReviewSection } from './ReviewSection.tsx';
import type {
  ProductDetail,
  ProductVariantDetail,
  ProductSummary,
  User,
  SizeRecommendation,
} from '../../types/index.ts';

interface ProductDetailViewProps {
  slug: string;
  currentUser?: User | null;
  onBack: () => void;
  onSelectProduct: (product: ProductSummary) => void;
  onOpenSizeGuide: (gender: 'men' | 'women' | 'unisex') => void;
  onAddToCart: (product: ProductDetail, variant: ProductVariantDetail, quantity: number) => void;
  onToggleWishlist: (product: ProductSummary) => void;
}

export const ProductDetailView: React.FC<ProductDetailViewProps> = ({
  slug,
  currentUser,
  onBack,
  onSelectProduct,
  onOpenSizeGuide,
  onAddToCart,
  onToggleWishlist,
}) => {
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [notFoundError, setNotFoundError] = useState<string | null>(null);

  // Trạng thái chọn Ảnh, Màu sắc, Kích cỡ & Số lượng
  const [activeImageUrl, setActiveImageUrl] = useState<string>('');
  const [selectedColor, setSelectedColor] = useState<string>('');
  const [selectedSize, setSelectedSize] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);

  // Gợi ý size theo chiều cao / cân nặng
  const [heightInput, setHeightInput] = useState<string>(
    currentUser?.heightCm ? String(currentUser.heightCm) : '170'
  );
  const [weightInput, setWeightInput] = useState<string>(
    currentUser?.weightKg ? String(currentUser.weightKg) : '62'
  );
  const [recommendation, setRecommendation] = useState<SizeRecommendation | null>(null);
  const [isRecommending, setIsRecommending] = useState<boolean>(false);
  const [showInlineSizeChart, setShowInlineSizeChart] = useState<boolean>(false);

  // Tải dữ liệu chi tiết sản phẩm từ GET /api/products/:slug
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setNotFoundError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const queryParams = new URLSearchParams();
    if (currentUser?.heightCm && currentUser?.weightKg) {
      queryParams.set('height', String(currentUser.heightCm));
      queryParams.set('weight', String(currentUser.weightKg));
    }
    const qs = queryParams.toString() ? `?${queryParams.toString()}` : '';

    fetch(`/api/products/${encodeURIComponent(slug)}${qs}`)
      .then(async (res) => {
        const body = await res.json();
        if (!isMounted) return;
        if (!res.ok || !body.success || !body.data) {
          setNotFoundError(body.message || 'Sản phẩm không tồn tại hoặc đã ngừng kinh doanh');
          setProduct(null);
          return;
        }
        const detail: ProductDetail = body.data;
        setProduct(detail);
        setActiveImageUrl(detail.images?.[0]?.imageUrl || '');
        if (detail.sizeRecommendation) {
          setRecommendation(detail.sizeRecommendation);
        }

        // Chọn mặc định màu đầu tiên có hàng (hoặc màu đầu tiên)
        const firstColorWithStock =
          detail.colors.find((c) => c.hasStock)?.colorName || detail.colors[0]?.colorName || '';
        setSelectedColor(firstColorWithStock);

        // Chọn mặc định size đầu tiên còn hàng của màu đó
        const colorVariants = detail.variants.filter((v) => v.colorName === firstColorWithStock);
        const firstAvailableVariant = colorVariants.find((v) => v.stockQuantity > 0);
        setSelectedSize(firstAvailableVariant ? firstAvailableVariant.size : '');
        setQuantity(1);
      })
      .catch(() => {
        if (isMounted) {
          setNotFoundError('Không thể kết nối máy chủ để tải thông tin sản phẩm');
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [slug, currentUser?.heightCm, currentUser?.weightKg]);

  // Khi người dùng đổi màu sắc, tự động chọn size còn hàng tương ứng
  const handleSelectColor = (colorName: string) => {
    setSelectedColor(colorName);
    if (!product) return;
    const colorVariants = product.variants.filter((v) => v.colorName === colorName);
    // Nếu size đang chọn vẫn còn hàng ở màu mới thì giữ nguyên, nếu hết hàng thì chuyển sang size đầu tiên còn hàng
    const currentSizeVariant = colorVariants.find(
      (v) => v.size === selectedSize && v.stockQuantity > 0
    );
    if (currentSizeVariant) {
      setSelectedSize(currentSizeVariant.size);
    } else {
      const firstAvail = colorVariants.find((v) => v.stockQuantity > 0);
      setSelectedSize(firstAvail ? firstAvail.size : '');
    }
    setQuantity(1);
  };

  // Gợi ý size theo chiều cao / cân nặng từ server
  const handleCalculateSize = async (e: React.FormEvent) => {
    e.preventDefault();
    const h = Number(heightInput);
    const w = Number(weightInput);
    if (!h || !w || h < 100 || h > 230 || w < 30 || w > 200) return;

    setIsRecommending(true);
    try {
      const res = await fetch(
        `/api/products/${encodeURIComponent(slug)}?height=${h}&weight=${w}`
      );
      const body = await res.json();
      if (body.success && body.data?.sizeRecommendation) {
        const rec: SizeRecommendation = body.data.sizeRecommendation;
        setRecommendation(rec);
        // Nếu size gợi ý đang còn hàng ở màu hiện tại thì tự động chọn giúp người dùng
        const matchingVariant = product?.variants.find(
          (v) =>
            v.colorName === selectedColor &&
            v.size === rec.recommendedSize &&
            v.stockQuantity > 0
        );
        if (matchingVariant) {
          setSelectedSize(matchingVariant.size);
        }
      }
    } catch {
      // ignore
    } finally {
      setIsRecommending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-pulse">
        <div className="h-5 w-40 bg-[#EAE6DE] rounded mb-8" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-6 space-y-4">
            <div className="aspect-4/5 bg-[#EAE6DE] rounded-2xl" />
            <div className="flex gap-3">
              <div className="w-20 h-24 bg-[#EAE6DE] rounded-lg" />
              <div className="w-20 h-24 bg-[#EAE6DE] rounded-lg" />
            </div>
          </div>
          <div className="lg:col-span-6 space-y-5">
            <div className="h-4 w-32 bg-[#EAE6DE] rounded" />
            <div className="h-8 w-3/4 bg-[#EAE6DE] rounded" />
            <div className="h-6 w-1/3 bg-[#EAE6DE] rounded" />
            <div className="h-24 w-full bg-[#EAE6DE] rounded-xl" />
            <div className="h-12 w-full bg-[#EAE6DE] rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (notFoundError || !product) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center space-y-5">
        <div className="w-14 h-14 rounded-full bg-[#F5EBE6] text-[#C27D56] flex items-center justify-center mx-auto">
          <AlertCircle className="w-7 h-7" />
        </div>
        <h1 className="font-display text-2xl font-bold text-[#1A1C19]">
          Không Tìm Thấy Sản Phẩm (404)
        </h1>
        <p className="text-sm text-[#6B665C] max-w-md mx-auto">
          {notFoundError || 'Sản phẩm bạn đang tìm kiếm không tồn tại hoặc đã tạm ngừng kinh doanh.'}
        </p>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-6 py-3 bg-[#2D4A3E] text-white text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-[#233B31] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Quay lại danh mục sản phẩm</span>
        </button>
      </div>
    );
  }

  const variantsForColor = product.variants.filter((v) => v.colorName === selectedColor);
  const selectedVariant =
    variantsForColor.find((v) => v.size === selectedSize) || variantsForColor[0] || null;

  const displayEffectivePrice = selectedVariant
    ? selectedVariant.effectivePrice
    : product.effectivePrice;
  const displayInitialPrice = selectedVariant
    ? selectedVariant.initialPrice
    : product.initialPrice ?? product.basePrice;
  const displayBasePrice = Math.max(displayInitialPrice, product.basePrice);
  const displayDiscountPercent = selectedVariant
    ? selectedVariant.discountPercent
    : product.discountPercent;
  const isOnSale = selectedVariant
    ? selectedVariant.isOnSale
    : Boolean(product.isOnSale);
  const badgeDiscountPercent =
    displayDiscountPercent > 0
      ? displayDiscountPercent
      : displayEffectivePrice < displayBasePrice
      ? Math.max(1, Math.round(((displayBasePrice - displayEffectivePrice) / displayBasePrice) * 100))
      : 0;

  const genderLabel =
    product.targetGender === 'men'
      ? 'Nam'
      : product.targetGender === 'women'
      ? 'Nữ'
      : 'Unisex';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-16">
      {/* Thanh điều hướng Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center justify-between gap-4">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs font-semibold text-[#2D4A3E] hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Quay lại danh sách sản phẩm</span>
        </button>

        <div className="hidden sm:flex items-center gap-2 text-xs text-[#7A7569]">
          <span>Trang chủ</span>
          <span aria-hidden="true">/</span>
          <span>{genderLabel}</span>
          <span aria-hidden="true">/</span>
          <span>{product.categoryName}</span>
          <span aria-hidden="true">/</span>
          <span className="text-[#1A1C19] font-medium truncate max-w-[240px]">
            {product.name}
          </span>
        </div>
      </nav>

      {/* KHỐI THÔNG TIN CHÍNH: THƯ VIỆN ẢNH & BIẾN THỂ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        {/* Cột Trái: Thư viện Hình ảnh */}
        <div className="lg:col-span-6 space-y-4">
          <div className="relative aspect-4/5 w-full bg-[#F5F2EB] rounded-2xl overflow-hidden border border-[#E8E4DA]">
            <ImageWithFallback
              src={activeImageUrl || product.images[0]?.imageUrl || ''}
              alt={product.name}
              className="w-full h-full object-cover"
            />
            {isOnSale && badgeDiscountPercent > 0 && (
              <div className="absolute top-4 left-4 px-3 py-1 bg-[#C27D56] text-white text-xs font-bold tracking-wide rounded-sm shadow-sm">
                Giảm {badgeDiscountPercent}%
              </div>
            )}
          </div>

          {/* Thumbnails */}
          {product.images.length > 1 && (
            <div className="flex items-center gap-3 overflow-x-auto pb-1">
              {product.images.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setActiveImageUrl(img.imageUrl)}
                  className={`relative w-20 h-24 rounded-xl overflow-hidden border-2 shrink-0 transition-all ${
                    activeImageUrl === img.imageUrl
                      ? 'border-[#2D4A3E] ring-2 ring-[#2D4A3E]/20'
                      : 'border-[#E8E4DA] opacity-75 hover:opacity-100'
                  }`}
                >
                  <ImageWithFallback
                    src={img.imageUrl}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Cột Phải: Thông tin sản phẩm, Giá, Biến thể & Bảng Size */}
        <div className="lg:col-span-6 space-y-6">
          {/* Metadata dòng trên: Danh mục · Đối tượng · Đánh giá */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#6B665C]">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[#2D4A3E] uppercase tracking-wider">
                  {product.categoryName}
                </span>
                <span aria-hidden="true">·</span>
                <span>Thời trang {genderLabel}</span>
                {selectedVariant && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums text-[#8C877B]">SKU: {selectedVariant.sku}</span>
                  </>
                )}
              </div>

              {/* Điểm đánh giá trung bình */}
              <div className="flex items-center gap-1.5 tabular-nums">
                <Star className="w-4 h-4 fill-[#D99B26] text-[#D99B26]" />
                <span className="font-bold text-[#1A1C19]">
                  {product.ratingAvg > 0 ? product.ratingAvg.toFixed(1) : 'Mới'}
                </span>
                <span className="text-[#7A7569]">({product.reviewCount} đánh giá)</span>
              </div>
            </div>

            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1A1C19] leading-tight">
              {product.name}
            </h1>
          </div>

          {/* Khung Giá gốc, Giá giảm & Chương trình Khuyến mãi */}
          <div className="p-4 bg-white rounded-xl border border-[#EAE6DE] space-y-2">
            {product.activePromotion && (
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#C27D56]">
                <Tag className="w-3.5 h-3.5" />
                <span>{product.activePromotion.title}</span>
              </div>
            )}

            <div className="flex items-baseline gap-3 tabular-nums">
              <span
                data-testid="product-effective-price"
                className="text-2xl sm:text-3xl font-extrabold text-[#2D4A3E]"
              >
                {displayEffectivePrice.toLocaleString('vi-VN')}₫
              </span>
              {isOnSale && displayEffectivePrice < displayBasePrice && (
                <>
                  <span
                    data-testid="product-base-price"
                    className="text-sm text-[#8C877B] line-through"
                  >
                    {displayBasePrice.toLocaleString('vi-VN')}₫
                  </span>
                  <span className="text-xs font-bold text-[#C27D56]">
                    Tiết kiệm {(displayBasePrice - displayEffectivePrice).toLocaleString('vi-VN')}₫
                  </span>
                </>
              )}
            </div>
          </div>

          {/* 1. CHỌN MÀU SẮC */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#5C584F]">
                Màu sắc: <strong className="text-[#1A1C19]">{selectedColor}</strong>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {product.colors.map((c, idx) => {
                const isSelected = selectedColor === c.colorName;
                return (
                  <button
                    key={`${c.colorName}-${idx}`}
                    type="button"
                    onClick={() => handleSelectColor(c.colorName)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-[#2D4A3E] bg-[#F0ECE1] text-[#1A1C19] shadow-2xs'
                        : 'border-[#E0DCD3] bg-white text-[#5C584F] hover:border-[#B5AFA2]'
                    }`}
                  >
                    <span
                      className="w-4 h-4 rounded-full border border-black/15 shrink-0"
                      style={{ backgroundColor: c.colorCode }}
                    />
                    <span>{c.colorName}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. CHỌN KÍCH CỠ (SIZE) & TRẠNG THÁI TỪNG BIẾN THỂ */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="text-[#5C584F]">
                  Kích cỡ: <strong className="text-[#1A1C19]">{selectedSize || 'Chưa chọn'}</strong>
                </span>
                {selectedVariant && (
                  <span
                    data-testid="selected-variant-stock-status"
                    className={`font-semibold ${
                      selectedVariant.stockStatus === 'out_of_stock'
                        ? 'text-red-600'
                        : selectedVariant.stockStatus === 'low_stock'
                        ? 'text-[#C27D56]'
                        : 'text-[#2D4A3E]'
                    }`}
                  >
                    · {selectedVariant.stockLabel}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowInlineSizeChart((prev) => !prev)}
                  className="text-[#2D4A3E] font-semibold hover:underline flex items-center gap-1"
                >
                  <Ruler className="w-3.5 h-3.5" />
                  <span>{showInlineSizeChart ? 'Ẩn bảng size' : 'Xem bảng size'}</span>
                </button>
              </div>
            </div>

            {/* Danh sách nút chọn Size — Biến thể hết hàng bị làm mờ và disabled không chọn được */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
              {variantsForColor.map((variant) => {
                const isOut = variant.stockQuantity <= 0;
                const isLow = variant.stockStatus === 'low_stock';
                const isSelected = selectedSize === variant.size && !isOut;

                return (
                  <button
                    key={variant.id}
                    type="button"
                    disabled={isOut}
                    aria-disabled={isOut}
                    onClick={() => {
                      if (!isOut) {
                        setSelectedSize(variant.size);
                      }
                    }}
                    data-testid={`variant-size-${variant.size}`}
                    className={`relative py-2.5 px-3 rounded-lg border text-xs font-semibold transition-all flex flex-col items-center justify-center ${
                      isOut
                        ? 'border-[#E5E0D5] bg-[#F5F2EB] text-[#9E988C] opacity-45 line-through cursor-not-allowed'
                        : isSelected
                        ? 'border-[#2D4A3E] bg-[#2D4A3E] text-white shadow-xs'
                        : 'border-[#D5D0C5] bg-white text-[#1A1C19] hover:border-[#2D4A3E]'
                    }`}
                  >
                    <span>Size {variant.size}</span>
                    <span
                      className={`text-[10px] font-normal mt-0.5 ${
                        isOut
                          ? 'text-[#9E988C] no-underline'
                          : isSelected
                          ? 'text-white/85'
                          : isLow
                          ? 'text-[#C27D56] font-medium'
                          : 'text-[#6B665C]'
                      }`}
                    >
                      {isOut
                        ? 'Hết hàng'
                        : isLow
                        ? `Sắp hết (${variant.stockQuantity})`
                        : 'Còn hàng'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. GỢI Ý SIZE THEO CHIỀU CAO / CÂN NẶNG & BẢNG SIZE THEO ĐỐI TƯỢNG */}
          <div className="p-4 bg-[#F5F2EB] rounded-xl border border-[#E2DDD2] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#2D4A3E]">
                <Sparkles className="w-4 h-4 text-[#C27D56]" />
                <span>Gợi ý size theo chiều cao & cân nặng ({genderLabel})</span>
              </div>
              <button
                type="button"
                onClick={() => onOpenSizeGuide(product.targetGender)}
                className="text-[11px] font-semibold text-[#2D4A3E] hover:underline"
              >
                Mở bảng quy đổi đầy đủ
              </button>
            </div>

            <form onSubmit={handleCalculateSize} className="grid grid-cols-3 gap-2.5 items-end">
              <div>
                <label className="block text-[11px] font-medium text-[#5C584F] mb-1">
                  Chiều cao (cm)
                </label>
                <input
                  type="number"
                  min={100}
                  max={230}
                  value={heightInput}
                  onChange={(e) => setHeightInput(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#D5D0C5] rounded-lg focus:outline-none focus:border-[#2D4A3E] tabular-nums"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#5C584F] mb-1">
                  Cân nặng (kg)
                </label>
                <input
                  type="number"
                  min={30}
                  max={200}
                  value={weightInput}
                  onChange={(e) => setWeightInput(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#D5D0C5] rounded-lg focus:outline-none focus:border-[#2D4A3E] tabular-nums"
                />
              </div>
              <button
                type="submit"
                disabled={isRecommending}
                className="py-1.5 px-3 bg-[#2D4A3E] text-white text-xs font-semibold rounded-lg hover:bg-[#233B31] transition-colors"
              >
                {isRecommending ? 'Đang tính...' : 'Gợi ý size'}
              </button>
            </form>

            {recommendation && (
              <div
                data-testid="size-recommendation-box"
                className="p-2.5 bg-white rounded-lg border border-[#D5D0C5] flex items-center justify-between gap-2 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 font-semibold text-[#2D4A3E]">
                    <Check className="w-4 h-4 text-[#2D4A3E]" />
                    <span>Size phù hợp với bạn: {recommendation.recommendedSize}</span>
                  </div>
                  <p className="text-[11px] text-[#6B665C]">{recommendation.fitAdvice}</p>
                </div>
              </div>
            )}

            {/* Bảng size theo đối tượng sản phẩm hiển thị trực tiếp */}
            {showInlineSizeChart && product.sizeChart?.rows && product.sizeChart.rows.length > 0 && (
              <div className="pt-2 overflow-x-auto">
                <table className="w-full text-[11px] text-left bg-white border border-[#E0DCD3] border-collapse">
                  <thead>
                    <tr className="bg-[#EFECE6] text-[#1A1C19]">
                      <th className="p-2 border border-[#E0DCD3]">Size</th>
                      {product.sizeChart.type === 'pants' ? (
                        <>
                          <th className="p-2 border border-[#E0DCD3]">Vòng eo</th>
                          <th className="p-2 border border-[#E0DCD3]">Vòng mông</th>
                          <th className="p-2 border border-[#E0DCD3]">Dài quần</th>
                        </>
                      ) : product.sizeChart.type === 'unisex' ? (
                        <>
                          <th className="p-2 border border-[#E0DCD3]">Chiều cao</th>
                          <th className="p-2 border border-[#E0DCD3]">Cân nặng</th>
                          <th className="p-2 border border-[#E0DCD3]">Ghi chú phom</th>
                        </>
                      ) : (
                        <>
                          <th className="p-2 border border-[#E0DCD3]">Chiều cao</th>
                          <th className="p-2 border border-[#E0DCD3]">Cân nặng</th>
                          <th className="p-2 border border-[#E0DCD3]">Vòng ngực</th>
                          <th className="p-2 border border-[#E0DCD3]">Vòng eo</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {product.sizeChart.rows.map((r: any, idx: number) => (
                      <tr key={idx} className="border-t border-[#E0DCD3]">
                        <td className="p-2 border border-[#E0DCD3] font-bold">{r.size}</td>
                        {product.sizeChart.type === 'pants' ? (
                          <>
                            <td className="p-2 border border-[#E0DCD3]">{r.waist}</td>
                            <td className="p-2 border border-[#E0DCD3]">{r.hip}</td>
                            <td className="p-2 border border-[#E0DCD3]">{r.length}</td>
                          </>
                        ) : product.sizeChart.type === 'unisex' ? (
                          <>
                            <td className="p-2 border border-[#E0DCD3]">{r.height}</td>
                            <td className="p-2 border border-[#E0DCD3]">{r.weight}</td>
                            <td className="p-2 border border-[#E0DCD3]">{r.fitNote}</td>
                          </>
                        ) : (
                          <>
                            <td className="p-2 border border-[#E0DCD3]">{r.height}</td>
                            <td className="p-2 border border-[#E0DCD3]">{r.weight}</td>
                            <td className="p-2 border border-[#E0DCD3]">{r.chest}</td>
                            <td className="p-2 border border-[#E0DCD3]">{r.waist}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 4. NÚT HÀNH ĐỘNG (Thêm vào giỏ hàng sẽ hoàn thiện luồng lưu DB ở Giai đoạn 4) */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              disabled={!selectedVariant || selectedVariant.stockQuantity <= 0}
              onClick={() => {
                if (selectedVariant && selectedVariant.stockQuantity > 0) {
                  onAddToCart(product, selectedVariant, quantity);
                }
              }}
              className={`flex-1 py-3.5 px-6 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
                !selectedVariant || selectedVariant.stockQuantity <= 0
                  ? 'bg-[#D5D0C5] text-[#7A7569] cursor-not-allowed'
                  : 'bg-[#2D4A3E] text-white hover:bg-[#233B31] shadow-sm'
              }`}
            >
              <ShoppingBag className="w-4 h-4" />
              <span>
                {!selectedVariant || selectedVariant.stockQuantity <= 0
                  ? 'Biến thể tạm hết hàng'
                  : `Thêm vào giỏ · ${displayEffectivePrice.toLocaleString('vi-VN')}₫`}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                onToggleWishlist({
                  id: product.id,
                  name: product.name,
                  slug: product.slug,
                  target_gender: product.targetGender,
                  base_price: product.basePrice,
                  effective_price: product.effectivePrice,
                  discount_percent: product.discountPercent,
                  is_on_sale: product.isOnSale,
                  category_name: product.categoryName,
                  category_slug: product.categorySlug,
                  primary_image: product.images[0]?.imageUrl || '',
                  colors: product.colors.map((c) => ({
                    color_name: c.colorName,
                    color_code: c.colorCode,
                  })),
                  total_stock: product.totalStock,
                })
              }
              className="p-3.5 rounded-xl border border-[#D5D0C5] bg-white text-[#4A4740] hover:text-[#C27D56] hover:border-[#C27D56] transition-colors"
              aria-label="Yêu thích sản phẩm"
            >
              <Heart className="w-5 h-5" />
            </button>
          </div>

          {/* 5. MÔ TẢ CHI TIẾT, CHẤT LIỆU & HƯỚNG DẪN BẢO QUẢN */}
          <div className="pt-4 border-t border-[#E8E4DA] space-y-4 text-xs text-[#4A4740] leading-relaxed">
            <div>
              <h3 className="font-bold text-[#1A1C19] uppercase tracking-wider mb-1">
                Mô tả thiết kế
              </h3>
              <p>{product.description}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white p-4 rounded-xl border border-[#EAE6DE]">
              <div>
                <div className="font-bold text-[#1A1C19] mb-1">Chất liệu vải</div>
                <p className="text-[#6B665C]">{product.material}</p>
              </div>
              <div>
                <div className="font-bold text-[#1A1C19] mb-1">Hướng dẫn bảo quản</div>
                <p className="text-[#6B665C]">{product.careInstructions}</p>
              </div>
            </div>

            {/* Cam kết dịch vụ */}
            <div className="grid grid-cols-3 gap-3 pt-1 text-[11px] text-[#5C584F]">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-[#2D4A3E] shrink-0" />
                <span>Freeship đơn từ 499K</span>
              </div>
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-[#2D4A3E] shrink-0" />
                <span>Đổi trả dễ dàng 7 ngày</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#2D4A3E] shrink-0" />
                <span>Kiểm định chất lượng</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ĐÁNH GIÁ TỪ KHÁCH HÀNG (BƯỚC 6a — Nhúng component ReviewSection) */}
      <ReviewSection product={product} currentUser={currentUser} />

      {/* SẢN PHẨM LIÊN QUAN (Cùng danh mục hoặc cùng đối tượng, loại trừ chính nó, còn hàng, tối đa 8) */}
      {product.relatedProducts && product.relatedProducts.length > 0 && (
        <section className="border-t border-[#E8E4DA] pt-12 space-y-6">
          <div>
            <div className="text-xs font-bold text-[#7A5C43] uppercase tracking-wider">
              Gợi ý phối đồ
            </div>
            <h2 className="font-display text-2xl font-bold text-[#1A1C19] mt-1">
              Sản Phẩm Liên Quan
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {product.relatedProducts.slice(0, 8).map((rel) => (
              <ProductCard
                key={rel.id}
                product={rel}
                onSelect={onSelectProduct}
                onToggleWishlist={onToggleWishlist}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
