import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  Upload,
  Sparkles,
  ArrowLeft,
  SlidersHorizontal,
  RefreshCw,
  X,
  Heart,
  ShoppingBag,
  AlertCircle,
  ShieldCheck,
  CheckCircle2,
  Image as ImageIcon,
} from 'lucide-react';
import { ImageWithFallback } from '../common/ImageWithFallback.tsx';
import { apiRequest } from '../../lib/api.ts';
import type { ProductSummary } from '../../types/index.ts';

export interface RecognizedApparelAttributes {
  isApparel: boolean;
  categorySlug: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  style: string | null;
  pattern: string | null;
  fit: string | null;
  targetGender: 'men' | 'women' | 'unisex' | null;
  confidence: number;
}

export interface VisualSearchMatchedProduct {
  id: string;
  name: string;
  slug: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  targetGender: 'men' | 'women' | 'unisex';
  basePrice: number;
  initialPrice: number;
  effectivePrice: number;
  discountPercent: number;
  isOnSale: boolean;
  promotionTitle: string | null;
  totalStock: number;
  ratingAvg: number;
  reviewCount: number;
  primaryImage: string | null;
  availableColors: string[];
  defaultVariantId: string | null;
  matchScore: number;
  matchPercent: number;
  matchReason: string;
  matchedFields: string[];
}

interface VocabularyData {
  categories: { slug: string; name: string }[];
  colors: string[];
  styles: string[];
  patterns: string[];
  fits: string[];
  targetGenders: ('men' | 'women' | 'unisex')[];
}

export interface VisualSearchPageProps {
  onBackToCatalog: () => void;
  onSelectProductSlug: (slug: string) => void;
  onAddToCart: (
    product: { name: string },
    variant: { id: string; colorName: string; size: string },
    quantity: number
  ) => void;
  onToggleWishlist: (product: ProductSummary) => void;
  wishlistItems: ProductSummary[];
  onApplyManualCatalogFilter?: (params: { category?: string; color?: string }) => void;
  initialRecognizedAttributes?: RecognizedApparelAttributes | null;
  initialProducts?: VisualSearchMatchedProduct[];
  initialStatusMessage?: string | null;
  initialErrorState?: {
    code: string;
    message: string;
    isRateLimit?: boolean;
    isFallback?: boolean;
  } | null;
}

const GENDER_LABELS: Record<string, string> = {
  men: 'Nam',
  women: 'Nữ',
  unisex: 'Unisex',
};

export function validateVisualSearchFileClient(file: {
  name: string;
  type?: string;
  size: number;
}): { valid: boolean; code?: string; message?: string } {
  const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
  if (file.type && !allowedMime.includes(file.type.toLowerCase())) {
    return {
      valid: false,
      code: 'INVALID_IMAGE_MAGIC_BYTES',
      message: 'Chỉ chấp nhận hình ảnh định dạng JPG, PNG hoặc WEBP (tối đa 5MB).',
    };
  }
  if (file.size > 5 * 1024 * 1024) {
    return {
      valid: false,
      code: 'IMAGE_TOO_LARGE',
      message: 'Kích thước ảnh vượt quá giới hạn 5MB cho phép. Vui lòng chọn ảnh nhỏ hơn.',
    };
  }
  return { valid: true };
}

export function createVisualSearchClientController(
  requestFn: typeof apiRequest = apiRequest
) {
  let state: {
    recognizedAttributes: RecognizedApparelAttributes | null;
    draftAttributes: {
      categorySlug: string;
      primaryColor: string;
      secondaryColor: string;
      style: string;
      pattern: string;
      fit: string;
      targetGender: string;
    };
    products: VisualSearchMatchedProduct[];
    statusMessage: string | null;
    errorState: {
      code: string;
      message: string;
      isRateLimit?: boolean;
      isFallback?: boolean;
    } | null;
  } = {
    recognizedAttributes: null,
    draftAttributes: {
      categorySlug: '',
      primaryColor: '',
      secondaryColor: '',
      style: '',
      pattern: '',
      fit: '',
      targetGender: '',
    },
    products: [],
    statusMessage: null,
    errorState: null,
  };

  const syncDraft = (attrs: RecognizedApparelAttributes | null) => {
    state.draftAttributes = {
      categorySlug: attrs?.categorySlug || '',
      primaryColor: attrs?.primaryColor || '',
      secondaryColor: attrs?.secondaryColor || '',
      style: attrs?.style || '',
      pattern: attrs?.pattern || '',
      fit: attrs?.fit || '',
      targetGender: attrs?.targetGender || '',
    };
  };

  return {
    getState: () => state,
    selectFileAndSearch: async (
      file: { name: string; type?: string; size: number },
      preparedDataUrl: string
    ) => {
      state.errorState = null;
      state.statusMessage = null;
      const check = validateVisualSearchFileClient(file);
      if (!check.valid) {
        state.errorState = {
          code: check.code || 'INVALID_FILE',
          message: check.message || 'Tệp không hợp lệ',
        };
        state.products = [];
        return state;
      }

      const res = await requestFn('/api/visual-search', {
        method: 'POST',
        body: JSON.stringify({ image: preparedDataUrl }),
      });

      if (res.status === 429) {
        state.errorState = {
          code: res.errorCode || 'VISUAL_SEARCH_RATE_LIMIT',
          message:
            res.errorMessage ||
            'Bạn đã đạt giới hạn số lượt tìm kiếm bằng ảnh trong ngày. Vui lòng thử lại sau hoặc dùng bộ lọc danh mục.',
          isRateLimit: true,
        };
        state.products = [];
        return state;
      }

      if (!res.ok && !res.data?.fallback) {
        state.errorState = {
          code: res.errorCode || 'VISUAL_SEARCH_ERROR',
          message:
            res.errorMessage || 'Không thể phân tích hình ảnh này. Vui lòng thử lại với ảnh khác.',
        };
        state.products = [];
        return state;
      }

      const data = res.data || {};
      const recAttrs: RecognizedApparelAttributes | null = data.recognizedAttributes || null;
      state.recognizedAttributes = recAttrs;
      syncDraft(recAttrs);
      state.products = Array.isArray(data.products) ? data.products : [];
      state.statusMessage = data.message || null;
      return state;
    },
    updateDraftAttribute: (
      key: keyof typeof state.draftAttributes,
      value: string
    ) => {
      state.draftAttributes = { ...state.draftAttributes, [key]: value };
    },
    refineByAttributes: async () => {
      state.errorState = null;
      const activeDraft = state.draftAttributes;
      const payloadAttrs = {
        categorySlug: activeDraft.categorySlug || null,
        primaryColor: activeDraft.primaryColor || null,
        secondaryColor: activeDraft.secondaryColor || null,
        style: activeDraft.style || null,
        pattern: activeDraft.pattern || null,
        fit: activeDraft.fit || null,
        targetGender:
          activeDraft.targetGender === 'men' ||
          activeDraft.targetGender === 'women' ||
          activeDraft.targetGender === 'unisex'
            ? activeDraft.targetGender
            : null,
      };

      const res = await requestFn('/api/visual-search/refine', {
        method: 'POST',
        body: JSON.stringify({ attributes: payloadAttrs }),
      });

      if (res.status === 429) {
        state.errorState = {
          code: res.errorCode || 'REFINE_RATE_LIMIT',
          message: res.errorMessage || 'Bạn đang thao tác lọc quá nhanh. Vui lòng đợi vài giây rồi thử lại.',
          isRateLimit: true,
        };
        return state;
      }

      if (!res.ok) {
        state.errorState = {
          code: res.errorCode || 'REFINE_ERROR',
          message: res.errorMessage || 'Vui lòng chọn ít nhất 1 thuộc tính để tìm lại sản phẩm.',
        };
        return state;
      }

      const data = res.data || {};
      if (data.recognizedAttributes) {
        state.recognizedAttributes = data.recognizedAttributes;
        syncDraft(data.recognizedAttributes);
      }
      state.products = Array.isArray(data.products) ? data.products : [];
      state.statusMessage = data.message || null;
      return state;
    },
  };
}

/**
 * Thu nhỏ ảnh phía trình duyệt bằng HTML5 Canvas xuống tối đa 1024px trước khi gửi lên Server
 * (Nếu môi trường không hỗ trợ Canvas hoặc định dạng đặc biệt thì đọc trực tiếp DataURL gốc để Server xử lý bằng sharp)
 */
async function resizeImageClientSide(file: File, maxDimension = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không thể đọc tập tin hình ảnh.'));
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) {
        reject(new Error('Dữ liệu hình ảnh trống.'));
        return;
      }

      // Kiểm tra dung lượng gốc > 5MB thì gửi nguyên để Server trả đúng mã lỗi kiểm tra hoặc báo lỗi sớm
      if (file.size > 5 * 1024 * 1024) {
        reject(new Error('IMAGE_TOO_LARGE_CLIENT'));
        return;
      }

      const img = new Image();
      img.onerror = () => {
        // Fallback gửi chuỗi gốc để Server kiểm tra bằng magic bytes & sharp
        resolve(dataUrl);
      };
      img.onload = () => {
        try {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;
          if (!width || !height || (width <= maxDimension && height <= maxDimension)) {
            resolve(dataUrl);
            return;
          }

          const ratio = Math.min(maxDimension / width, maxDimension / height);
          const targetW = Math.max(1, Math.round(width * ratio));
          const targetH = Math.max(1, Math.round(height * ratio));

          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(dataUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, targetW, targetH);
          const resizedDataUrl = canvas.toDataURL('image/jpeg', 0.88);
          resolve(resizedDataUrl || dataUrl);
        } catch {
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export const VisualSearchPage: React.FC<VisualSearchPageProps> = ({
  onBackToCatalog,
  onSelectProductSlug,
  onAddToCart,
  onToggleWishlist,
  wishlistItems,
  onApplyManualCatalogFilter,
  initialRecognizedAttributes = null,
  initialProducts = [],
  initialStatusMessage = null,
  initialErrorState = null,
}) => {
  const [vocabulary, setVocabulary] = useState<VocabularyData>({
    categories: [],
    colors: [],
    styles: [],
    patterns: [],
    fits: [],
    targetGenders: ['men', 'women', 'unisex'],
  });

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [isRefining, setIsRefining] = useState<boolean>(false);

  const [recognizedAttributes, setRecognizedAttributes] =
    useState<RecognizedApparelAttributes | null>(initialRecognizedAttributes);
  const [draftAttributes, setDraftAttributes] = useState<{
    categorySlug: string;
    primaryColor: string;
    secondaryColor: string;
    style: string;
    pattern: string;
    fit: string;
    targetGender: string;
  }>({
    categorySlug: initialRecognizedAttributes?.categorySlug || '',
    primaryColor: initialRecognizedAttributes?.primaryColor || '',
    secondaryColor: initialRecognizedAttributes?.secondaryColor || '',
    style: initialRecognizedAttributes?.style || '',
    pattern: initialRecognizedAttributes?.pattern || '',
    fit: initialRecognizedAttributes?.fit || '',
    targetGender: initialRecognizedAttributes?.targetGender || '',
  });

  const [products, setProducts] = useState<VisualSearchMatchedProduct[]>(initialProducts);
  const [statusMessage, setStatusMessage] = useState<string | null>(initialStatusMessage);
  const [errorState, setErrorState] = useState<{
    code: string;
    message: string;
    isRateLimit?: boolean;
    isFallback?: boolean;
  } | null>(initialErrorState);
  const [noStrongMatch, setNoStrongMatch] = useState<boolean>(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Tìm kiếm sản phẩm bằng hình ảnh (AI) | Baity Fashion';
    return () => {
      document.title = prevTitle;
    };
  }, []);

  useEffect(() => {
    apiRequest('/api/visual-search/vocabulary')
      .then((res) => {
        if (res.ok && res.data?.vocabulary) {
          setVocabulary(res.data.vocabulary);
        }
      })
      .catch(() => {});
  }, []);

  const syncDraftFromRecognized = (attrs: RecognizedApparelAttributes | null) => {
    setDraftAttributes({
      categorySlug: attrs?.categorySlug || '',
      primaryColor: attrs?.primaryColor || '',
      secondaryColor: attrs?.secondaryColor || '',
      style: attrs?.style || '',
      pattern: attrs?.pattern || '',
      fit: attrs?.fit || '',
      targetGender: attrs?.targetGender || '',
    });
  };

  const handleFilePicked = async (file: File | null) => {
    if (!file) return;
    setErrorState(null);
    setStatusMessage(null);
    setNoStrongMatch(false);
    setSelectedFileName(file.name);

    const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
    if (file.type && !allowedMime.includes(file.type.toLowerCase())) {
      setErrorState({
        code: 'INVALID_IMAGE_MAGIC_BYTES',
        message: 'Chỉ chấp nhận hình ảnh định dạng JPG, PNG hoặc WEBP (tối đa 5MB).',
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setErrorState({
        code: 'IMAGE_TOO_LARGE',
        message: 'Kích thước ảnh vượt quá giới hạn 5MB cho phép. Vui lòng chọn ảnh nhỏ hơn.',
      });
      return;
    }

    setIsAnalyzing(true);
    try {
      const preparedDataUrl = await resizeImageClientSide(file, 1024);
      setPreviewUrl(preparedDataUrl);

      const res = await apiRequest('/api/visual-search', {
        method: 'POST',
        body: JSON.stringify({ image: preparedDataUrl }),
      });

      if (res.status === 429) {
        setErrorState({
          code: res.errorCode || 'VISUAL_SEARCH_RATE_LIMIT',
          message:
            res.errorMessage ||
            'Bạn đã đạt giới hạn số lượt tìm kiếm bằng ảnh trong ngày. Vui lòng thử lại sau hoặc dùng bộ lọc danh mục.',
          isRateLimit: true,
        });
        setProducts([]);
        return;
      }

      if (!res.ok && !res.data?.fallback) {
        setErrorState({
          code: res.errorCode || 'VISUAL_SEARCH_ERROR',
          message:
            res.errorMessage || 'Không thể phân tích hình ảnh này. Vui lòng thử lại với ảnh khác.',
        });
        setProducts([]);
        return;
      }

      const data = res.data || {};
      const recAttrs: RecognizedApparelAttributes | null = data.recognizedAttributes || null;
      setRecognizedAttributes(recAttrs);
      syncDraftFromRecognized(recAttrs);
      setProducts(Array.isArray(data.products) ? data.products : []);
      setStatusMessage(data.message || null);
      setNoStrongMatch(Boolean(data.isFallbackSuggestion));
      setLatencyMs(typeof data.latencyMs === 'number' ? data.latencyMs : null);

      if (data.fallback) {
        setErrorState({
          code: data.fallbackCode || 'VISUAL_SEARCH_AI_UNAVAILABLE',
          message:
            data.message ||
            'Hệ thống nhận diện ảnh đang bận. Bạn có thể chọn trực tiếp các thuộc tính bên dưới để tìm kiếm.',
          isFallback: true,
        });
      }
    } catch (err: any) {
      if (err?.message === 'IMAGE_TOO_LARGE_CLIENT') {
        setErrorState({
          code: 'IMAGE_TOO_LARGE',
          message: 'Kích thước ảnh vượt quá giới hạn 5MB cho phép.',
        });
      } else {
        setErrorState({
          code: 'CLIENT_ERROR',
          message: err?.message || 'Đã xảy ra lỗi khi đọc hoặc tải ảnh lên.',
        });
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Gửi các thuộc tính đã chỉnh sửa sang POST /api/visual-search/refine (không gửi lại ảnh, không gọi Gemini)
  const handleRefineByAttributes = async (overrideDraft?: typeof draftAttributes) => {
    const activeDraft = overrideDraft || draftAttributes;
    setIsRefining(true);
    setErrorState(null);
    try {
      const payloadAttrs = {
        categorySlug: activeDraft.categorySlug || null,
        primaryColor: activeDraft.primaryColor || null,
        secondaryColor: activeDraft.secondaryColor || null,
        style: activeDraft.style || null,
        pattern: activeDraft.pattern || null,
        fit: activeDraft.fit || null,
        targetGender:
          activeDraft.targetGender === 'men' ||
          activeDraft.targetGender === 'women' ||
          activeDraft.targetGender === 'unisex'
            ? activeDraft.targetGender
            : null,
      };

      const res = await apiRequest('/api/visual-search/refine', {
        method: 'POST',
        body: JSON.stringify({ attributes: payloadAttrs }),
      });

      if (!res.ok) {
        setErrorState({
          code: res.errorCode || 'REFINE_ERROR',
          message: res.errorMessage || 'Vui lòng chọn ít nhất 1 thuộc tính để tìm lại sản phẩm.',
        });
        return;
      }

      const data = res.data || {};
      if (data.recognizedAttributes) {
        setRecognizedAttributes(data.recognizedAttributes);
        syncDraftFromRecognized(data.recognizedAttributes);
      }
      setProducts(Array.isArray(data.products) ? data.products : []);
      setStatusMessage(data.message || null);
      setNoStrongMatch(Boolean(data.isFallbackSuggestion));
      setLatencyMs(typeof data.latencyMs === 'number' ? data.latencyMs : null);
    } catch {
      setErrorState({
        code: 'NETWORK_ERROR',
        message: 'Lỗi kết nối khi lọc lại sản phẩm theo thuộc tính.',
      });
    } finally {
      setIsRefining(false);
    }
  };

  const handleRemoveAttributeKey = (key: keyof typeof draftAttributes) => {
    const next = { ...draftAttributes, [key]: '' };
    setDraftAttributes(next);
  };

  const getCategoryLabel = (slug: string) => {
    const found = vocabulary.categories.find((c) => c.slug === slug);
    return found ? found.name : slug;
  };

  const activeAttributeChips: {
    key: keyof typeof draftAttributes;
    label: string;
    value: string;
  }[] = [
    ...(draftAttributes.categorySlug
      ? [
          {
            key: 'categorySlug' as const,
            label: 'Danh mục',
            value: getCategoryLabel(draftAttributes.categorySlug),
          },
        ]
      : []),
    ...(draftAttributes.primaryColor
      ? [
          {
            key: 'primaryColor' as const,
            label: 'Màu chủ đạo',
            value: draftAttributes.primaryColor,
          },
        ]
      : []),
    ...(draftAttributes.secondaryColor
      ? [
          {
            key: 'secondaryColor' as const,
            label: 'Màu phụ',
            value: draftAttributes.secondaryColor,
          },
        ]
      : []),
    ...(draftAttributes.style
      ? [{ key: 'style' as const, label: 'Phong cách', value: draftAttributes.style }]
      : []),
    ...(draftAttributes.pattern
      ? [{ key: 'pattern' as const, label: 'Họa tiết', value: draftAttributes.pattern }]
      : []),
    ...(draftAttributes.fit
      ? [{ key: 'fit' as const, label: 'Phom dáng', value: draftAttributes.fit }]
      : []),
    ...(draftAttributes.targetGender
      ? [
          {
            key: 'targetGender' as const,
            label: 'Đối tượng',
            value: GENDER_LABELS[draftAttributes.targetGender] || draftAttributes.targetGender,
          },
        ]
      : []),
  ];

  return (
    <section
      data-testid="visual-search-page"
      className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8"
    >
      {/* Thanh điều hướng trên cùng */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-[#E8E4DA]">
        <button
          type="button"
          onClick={onBackToCatalog}
          className="inline-flex items-center gap-2 text-xs font-semibold text-[#2D4A3E] hover:text-[#1A1C19] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Quay lại danh mục cửa hàng</span>
        </button>

        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#F0ECE1] text-[#2D4A3E] text-xs font-semibold">
          <Sparkles className="w-3.5 h-3.5 text-[#C27D56]" />
          <span>Tìm kiếm sản phẩm bằng hình ảnh (AI)</span>
        </div>
      </div>

      {/* Khối tiêu đề & Tuyên bố bảo mật quyền riêng tư */}
      <div className="bg-[#2D4A3E] text-white rounded-2xl p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        <div className="lg:col-span-8 space-y-3">
          <div className="text-xs font-bold uppercase tracking-widest text-[#E6B89C]">
            Công nghệ thị giác máy tính · Baity Fashion
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
            Tải ảnh trang phục để tìm mẫu tương tự trong kho
          </h1>
          <p className="text-xs sm:text-sm text-white/85 leading-relaxed max-w-2xl">
            Hệ thống tự động nhận diện loại trang phục, màu sắc chủ đạo, phom dáng và họa tiết để chấm điểm tương đồng với các sản phẩm đang còn hàng tại Baity.
          </p>
        </div>

        <div className="lg:col-span-4 bg-white/10 border border-white/15 rounded-xl p-4 space-y-2 text-xs text-white/90">
          <div className="flex items-center gap-2 font-bold text-[#E6B89C]">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Cam kết quyền riêng tư hình ảnh</span>
          </div>
          <p className="leading-relaxed text-[11px] text-white/80">
            <strong>Baity không lưu ảnh trong hệ thống của cửa hàng</strong> (ảnh chỉ được thu nhỏ và xóa sạch EXIF/GPS trên bộ nhớ tạm); ảnh được gửi tới <strong>Google Gemini</strong> và do Google xử lý theo chính sách của Google. Quý khách không nên tải ảnh có khuôn mặt hoặc thông tin cá nhân.
          </p>
        </div>
      </div>

      {/* Khu vực chính: Cột Trái (Tải ảnh & Chỉnh sửa thuộc tính) + Cột Phải (Kết quả sản phẩm) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* CỘT TRÁI: UPLOAD & BỘ LỌC THUỘC TÍNH */}
        <div className="lg:col-span-4 space-y-6">
          {/* Thẻ tải ảnh / chụp ảnh */}
          <div className="bg-white rounded-2xl border border-[#EAE6DE] p-5 space-y-4 shadow-2xs">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-[#1A1C19]">
                1. Chọn hoặc chụp ảnh trang phục
              </h2>
              <span className="text-[11px] text-[#7A7569]">JPG, PNG, WEBP ≤ 5MB</span>
            </div>

            {/* Khung xem trước ảnh hoặc vùng kéo thả */}
            <div className="relative rounded-xl border-2 border-dashed border-[#D5D0C5] bg-[#FAF8F5] overflow-hidden min-h-56 flex flex-col items-center justify-center p-4 text-center">
              {previewUrl ? (
                <div className="w-full space-y-3">
                  <div className="relative aspect-4/5 max-h-72 mx-auto rounded-lg overflow-hidden bg-white border border-[#E8E4DA]">
                    <img
                      src={previewUrl}
                      alt="Ảnh trang phục tìm kiếm"
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#5C584F] px-1">
                    <span className="truncate max-w-[180px]">{selectedFileName || 'Ảnh đã chọn'}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewUrl(null);
                        setSelectedFileName('');
                        setRecognizedAttributes(null);
                        setProducts([]);
                        setStatusMessage(null);
                        setErrorState(null);
                      }}
                      className="text-[#B91C1C] font-semibold hover:underline"
                    >
                      Xóa ảnh
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 py-6">
                  <div className="w-12 h-12 rounded-full bg-[#F0ECE1] text-[#2D4A3E] flex items-center justify-center mx-auto">
                    <ImageIcon className="w-6 h-6 text-[#C27D56]" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-[#1A1C19]">
                      Tải ảnh mẫu quần áo, váy đầm hoặc áo khoác
                    </p>
                    <p className="text-[11px] text-[#7A7569]">
                      Ảnh rõ nét, chụp chính diện trang phục sẽ cho độ chính xác cao nhất
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Input ẩn cho chọn file & chụp camera điện thoại */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                handleFilePicked(f);
                e.target.value = '';
              }}
              className="hidden"
              data-testid="visual-search-file-input"
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                handleFilePicked(f);
                e.target.value = '';
              }}
              className="hidden"
              data-testid="visual-search-camera-input"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={isAnalyzing}
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2.5 px-3 bg-[#2D4A3E] hover:bg-[#233B31] disabled:opacity-50 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                <Upload className="w-4 h-4" />
                <span>Chọn ảnh từ máy</span>
              </button>

              <button
                type="button"
                disabled={isAnalyzing}
                onClick={() => cameraInputRef.current?.click()}
                className="w-full py-2.5 px-3 bg-[#FAF8F5] hover:bg-[#EFECE6] border border-[#D5D0C5] disabled:opacity-50 text-[#1A1C19] text-xs font-semibold rounded-xl flex items-center justify-center gap-2 transition-colors"
              >
                <Camera className="w-4 h-4 text-[#C27D56]" />
                <span>Chụp bằng Camera</span>
              </button>
            </div>
          </div>

          {/* Thẻ Thuộc tính nhận diện được & Chỉnh sửa tìm lại (POST /api/visual-search/refine) */}
          <div
            data-testid="visual-search-attributes-panel"
            className="bg-white rounded-2xl border border-[#EAE6DE] p-5 space-y-4 shadow-2xs"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-[#2D4A3E]" />
                <h2 className="font-display text-base font-bold text-[#1A1C19]">
                  2. Thuộc tính trang phục
                </h2>
              </div>
              {recognizedAttributes && recognizedAttributes.isApparel && (
                <span className="text-[11px] font-semibold text-[#2D4A3E] bg-[#F0ECE1] px-2 py-0.5 rounded">
                  Độ tin cậy AI: {Math.round((recognizedAttributes.confidence || 0) * 100)}%
                </span>
              )}
            </div>

            <p className="text-xs text-[#6B665C] leading-relaxed">
              Bạn có thể xóa hoặc chỉnh sửa trực tiếp các thuộc tính dưới đây rồi bấm <strong>Tìm lại</strong> để lọc sản phẩm ngay lập tức mà không cần tải lại ảnh.
            </p>

            {/* Các thẻ thuộc tính đang chọn (có nút X để gỡ nhanh) */}
            {activeAttributeChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {activeAttributeChips.map((chip) => (
                  <span
                    key={chip.key}
                    data-testid={`attr-chip-${chip.key}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F5F2EB] border border-[#D5D0C5] text-xs text-[#1A1C19]"
                  >
                    <span className="text-[#6B665C]">{chip.label}:</span>
                    <strong className="font-semibold">{chip.value}</strong>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttributeKey(chip.key)}
                      className="text-[#7A7569] hover:text-[#B91C1C]"
                      aria-label={`Xóa thuộc tính ${chip.label}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Các ô chọn chỉnh sửa thuộc tính từ từ vựng chuẩn trong DB */}
            <div className="space-y-3 pt-2 border-t border-[#F0ECE1]">
              <div>
                <label className="block text-[11px] font-semibold text-[#4A4740] mb-1">
                  Danh mục sản phẩm
                </label>
                <select
                  value={draftAttributes.categorySlug}
                  onChange={(e) =>
                    setDraftAttributes((prev) => ({ ...prev, categorySlug: e.target.value }))
                  }
                  data-testid="select-attr-category"
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-[#1A1C19]"
                >
                  <option value="">-- Tất cả danh mục --</option>
                  {vocabulary.categories.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-[#4A4740] mb-1">
                    Màu chủ đạo
                  </label>
                  <select
                    value={draftAttributes.primaryColor}
                    onChange={(e) =>
                      setDraftAttributes((prev) => ({ ...prev, primaryColor: e.target.value }))
                    }
                    data-testid="select-attr-primary-color"
                    className="w-full px-2.5 py-2 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-[#1A1C19]"
                  >
                    <option value="">-- Bất kỳ --</option>
                    {vocabulary.colors.map((color) => (
                      <option key={color} value={color}>
                        {color}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#4A4740] mb-1">
                    Đối tượng (Phái)
                  </label>
                  <select
                    value={draftAttributes.targetGender}
                    onChange={(e) =>
                      setDraftAttributes((prev) => ({ ...prev, targetGender: e.target.value }))
                    }
                    data-testid="select-attr-gender"
                    className="w-full px-2.5 py-2 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-[#1A1C19]"
                  >
                    <option value="">-- Bất kỳ (+Unisex) --</option>
                    <option value="men">Nam (+Unisex)</option>
                    <option value="women">Nữ (+Unisex)</option>
                    <option value="unisex">Unisex</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-[#4A4740] mb-1">
                    Phong cách
                  </label>
                  <select
                    value={draftAttributes.style}
                    onChange={(e) =>
                      setDraftAttributes((prev) => ({ ...prev, style: e.target.value }))
                    }
                    className="w-full px-2 py-2 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-[#1A1C19]"
                  >
                    <option value="">-- Tất cả --</option>
                    {vocabulary.styles.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#4A4740] mb-1">
                    Họa tiết
                  </label>
                  <select
                    value={draftAttributes.pattern}
                    onChange={(e) =>
                      setDraftAttributes((prev) => ({ ...prev, pattern: e.target.value }))
                    }
                    className="w-full px-2 py-2 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-[#1A1C19]"
                  >
                    <option value="">-- Tất cả --</option>
                    {vocabulary.patterns.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#4A4740] mb-1">
                    Phom dáng
                  </label>
                  <select
                    value={draftAttributes.fit}
                    onChange={(e) =>
                      setDraftAttributes((prev) => ({ ...prev, fit: e.target.value }))
                    }
                    className="w-full px-2 py-2 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-[#1A1C19]"
                  >
                    <option value="">-- Tất cả --</option>
                    {vocabulary.fits.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={isRefining || isAnalyzing}
              onClick={() => handleRefineByAttributes()}
              data-testid="visual-search-refine-button"
              className="w-full py-2.5 px-4 bg-[#C27D56] hover:opacity-95 disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-2 transition-opacity shadow-xs"
            >
              <RefreshCw className={`w-4 h-4 ${isRefining ? 'animate-spin' : ''}`} />
              <span>{isRefining ? 'Đang chấm điểm lại...' : 'Tìm lại theo thuộc tính đã chọn'}</span>
            </button>
          </div>
        </div>

        {/* CỘT PHẢI: KẾT QUẢ TÌM KIẾM SẢN PHẨM */}
        <div className="lg:col-span-8 space-y-6">
          {/* Trạng thái đang phân tích ảnh */}
          {isAnalyzing && (
            <div
              data-testid="visual-search-loading"
              className="bg-white rounded-2xl border border-[#EAE6DE] p-8 space-y-6"
            >
              <div className="flex items-center gap-3 text-[#2D4A3E]">
                <RefreshCw className="w-5 h-5 animate-spin text-[#C27D56]" />
                <div>
                  <h3 className="font-display text-base font-bold">
                    Đang phân tích hình ảnh & đối sánh kho hàng...
                  </h3>
                  <p className="text-xs text-[#6B665C]">
                    Đang xử lý ảnh trong bộ nhớ, nhận diện thuộc tính trang phục và xếp hạng sản phẩm tương đồng.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 animate-pulse">
                {[...Array(6)].map((_, idx) => (
                  <div key={idx} className="p-3 border border-[#EAE6DE] rounded-xl space-y-3">
                    <div className="aspect-4/5 bg-[#EFECE6] rounded-lg" />
                    <div className="h-3.5 bg-[#EFECE6] rounded w-1/2" />
                    <div className="h-4 bg-[#EFECE6] rounded w-3/4" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Thông báo lỗi / Giới hạn lượt dùng / Fallback */}
          {!isAnalyzing && errorState && (
            <div
              data-testid="visual-search-error-banner"
              className={`rounded-2xl border p-5 space-y-3 ${
                errorState.isRateLimit
                  ? 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]'
                  : 'bg-[#FDF2F2] border-[#FECACA] text-[#991B1B]'
              }`}
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="space-y-1 flex-1">
                  <h3 className="font-display text-sm font-bold">
                    {errorState.isRateLimit
                      ? 'Đã đạt giới hạn lượt tìm kiếm bằng ảnh trong ngày'
                      : errorState.isFallback
                      ? 'Hệ thống nhận diện AI tạm thời bận'
                      : 'Không thể xử lý hình ảnh'}
                  </h3>
                  <p className="text-xs leading-relaxed">{errorState.message}</p>
                </div>
              </div>

              {/* Gợi ý lọc nhanh thủ công khi AI lỗi hoặc hết lượt */}
              {vocabulary.categories.length > 0 && (
                <div className="pt-2 border-t border-black/10 space-y-2">
                  <div className="text-[11px] font-semibold">
                    Chọn nhanh danh mục để tìm trực tiếp không cần AI:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {vocabulary.categories.map((cat) => (
                      <button
                        key={cat.slug}
                        type="button"
                        onClick={() => {
                          const next = { ...draftAttributes, categorySlug: cat.slug };
                          setDraftAttributes(next);
                          handleRefineByAttributes(next);
                        }}
                        className="px-2.5 py-1 bg-white border border-[#D5D0C5] rounded-lg text-xs font-semibold text-[#1A1C19] hover:border-[#2D4A3E]"
                      >
                        {cat.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Trường hợp ảnh không phải trang phục */}
          {!isAnalyzing && recognizedAttributes && recognizedAttributes.isApparel === false && (
            <div
              data-testid="visual-search-not-apparel"
              className="bg-white rounded-2xl border border-[#EAE6DE] p-8 text-center space-y-4"
            >
              <div className="w-12 h-12 rounded-full bg-[#FFFBEB] text-[#B45309] flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="font-display text-lg font-bold text-[#1A1C19]">
                  Hình ảnh không phải là trang phục thời trang
                </h3>
                <p className="text-xs text-[#6B665C] leading-relaxed">
                  {statusMessage ||
                    'Hệ thống không nhận diện được quần áo hoặc váy đầm trong bức ảnh này. Vui lòng tải lên hình ảnh trang phục rõ nét hoặc tự chọn bộ lọc thuộc tính ở cột bên trái.'}
                </p>
              </div>
            </div>
          )}

          {/* Thanh thông báo trạng thái kết quả */}
          {!isAnalyzing && statusMessage && (!recognizedAttributes || recognizedAttributes.isApparel) && (
            <div className="bg-white rounded-2xl border border-[#EAE6DE] p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-xs text-[#1A1C19]">
                <CheckCircle2 className="w-4 h-4 text-[#2D4A3E] shrink-0" />
                <span className="font-medium">{statusMessage}</span>
              </div>
              {latencyMs !== null && (
                <span className="text-[11px] text-[#7A7569] tabular-nums">
                  Thời gian xử lý: {latencyMs} ms
                </span>
              )}
            </div>
          )}

          {/* Chú thích khi trả về gợi ý gần nhất */}
          {!isAnalyzing && noStrongMatch && products.length > 0 && (
            <div className="bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] rounded-xl px-4 py-3 text-xs">
              Chưa tìm thấy mẫu trùng khớp hoàn toàn mọi tiêu chí. Dưới đây là các sản phẩm gần nhất đang còn hàng tại Baity.
            </div>
          )}

          {/* Lưới kết quả sản phẩm (tối đa 12 sản phẩm) */}
          {!isAnalyzing && products.length > 0 ? (
            <div
              data-testid="visual-search-results-grid"
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
            >
              {products.map((prod) => {
                const isWishlisted = wishlistItems.some((w) => w.id === prod.id);
                const summaryCompat: ProductSummary = {
                  id: prod.id,
                  name: prod.name,
                  slug: prod.slug,
                  target_gender: prod.targetGender,
                  base_price: prod.basePrice,
                  initial_price: prod.initialPrice,
                  effective_price: prod.effectivePrice,
                  discount_percent: prod.discountPercent,
                  promotion_title: prod.promotionTitle,
                  is_on_sale: prod.isOnSale,
                  category_id: prod.categoryId,
                  category_name: prod.categoryName,
                  category_slug: prod.categorySlug,
                  primary_image: prod.primaryImage || '',
                  colors: (prod.availableColors || []).map((c) => ({
                    color_name: c,
                    color_code: '#1A1C19',
                  })),
                  total_stock: prod.totalStock,
                  rating_avg: prod.ratingAvg,
                  review_count: prod.reviewCount,
                };
                return (
                  <div
                    key={prod.id}
                    data-testid="visual-search-product-card"
                    className="bg-white rounded-2xl border border-[#EAE6DE] overflow-hidden flex flex-col justify-between hover:shadow-md transition-shadow"
                  >
                    <div>
                      {/* Ảnh sản phẩm + Huy hiệu % tương đồng */}
                      <div
                        onClick={() => onSelectProductSlug(prod.slug)}
                        className="relative aspect-4/5 bg-[#F5F2EB] cursor-pointer overflow-hidden group"
                      >
                        <ImageWithFallback
                          src={prod.primaryImage || ''}
                          alt={prod.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                        <div className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-md bg-[#2D4A3E] text-white text-[11px] font-bold shadow-xs">
                          {prod.matchPercent}% tương đồng
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleWishlist(summaryCompat);
                          }}
                          aria-label="Yêu thích"
                          className={`absolute top-2.5 right-2.5 w-8 h-8 rounded-full flex items-center justify-center shadow-xs transition-colors ${
                            isWishlisted
                              ? 'bg-[#C27D56] text-white'
                              : 'bg-white/90 text-[#1A1C19] hover:bg-white'
                          }`}
                        >
                          <Heart className={`w-4 h-4 ${isWishlisted ? 'fill-current' : ''}`} />
                        </button>
                      </div>

                      {/* Thông tin sản phẩm & Lý do khớp do Server tạo */}
                      <div className="p-4 space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-[#7A7569]">
                          <span>{prod.categoryName || 'Baity Collection'}</span>
                          <span className="uppercase font-semibold">
                            {GENDER_LABELS[prod.targetGender] || prod.targetGender}
                          </span>
                        </div>

                        <h3
                          onClick={() => onSelectProductSlug(prod.slug)}
                          className="font-display text-sm font-bold text-[#1A1C19] hover:text-[#2D4A3E] cursor-pointer line-clamp-2"
                        >
                          {prod.name}
                        </h3>

                        {/* Lý do khớp từ Server */}
                        <div className="p-2 rounded-lg bg-[#FAF8F5] border border-[#EAE6DE] text-[11px] text-[#4A4740] leading-snug">
                          {prod.matchReason}
                        </div>

                        {/* Giá bán */}
                        <div className="flex items-baseline gap-2 pt-1 tabular-nums">
                          <span className="text-sm font-bold text-[#2D4A3E]">
                            {Number(prod.effectivePrice).toLocaleString('vi-VN')}₫
                          </span>
                          {prod.isOnSale && prod.effectivePrice < prod.basePrice && (
                            <span className="text-xs text-[#8C877B] line-through">
                              {Number(prod.basePrice).toLocaleString('vi-VN')}₫
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Nút Thêm vào giỏ / Xem chi tiết */}
                    <div className="px-4 pb-4 pt-1 flex items-center gap-2">
                      {prod.defaultVariantId ? (
                        <button
                          type="button"
                          onClick={() =>
                            onAddToCart(
                              { name: prod.name },
                              {
                                id: prod.defaultVariantId!,
                                colorName: prod.availableColors?.[0] || 'Mặc định',
                                size: 'M',
                              },
                              1
                            )
                          }
                          className="flex-1 py-2 px-3 bg-[#2D4A3E] hover:bg-[#233B31] text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <ShoppingBag className="w-3.5 h-3.5" />
                          <span>Thêm nhanh vào giỏ</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelectProductSlug(prod.slug)}
                          className="flex-1 py-2 px-3 bg-[#2D4A3E] hover:bg-[#233B31] text-white text-xs font-semibold rounded-lg transition-colors"
                        >
                          Xem chi tiết
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            !isAnalyzing &&
            !errorState &&
            (!recognizedAttributes || recognizedAttributes.isApparel !== false) && (
              <div className="bg-white rounded-2xl border border-[#EAE6DE] p-10 text-center space-y-4">
                <div className="w-14 h-14 rounded-full bg-[#F0ECE1] text-[#2D4A3E] flex items-center justify-center mx-auto">
                  <Camera className="w-7 h-7 text-[#C27D56]" />
                </div>
                <div className="space-y-1.5 max-w-md mx-auto">
                  <h3 className="font-display text-lg font-bold text-[#1A1C19]">
                    Sẵn sàng tìm kiếm sản phẩm bằng hình ảnh
                  </h3>
                  <p className="text-xs text-[#6B665C] leading-relaxed">
                    Hãy chọn một bức ảnh trang phục từ thiết bị, chụp ảnh trực tiếp bằng camera điện thoại, hoặc chọn các thuộc tính ở bảng bên trái rồi nhấn <strong>Tìm lại</strong>.
                  </p>
                </div>
                {onApplyManualCatalogFilter && (
                  <button
                    type="button"
                    onClick={onBackToCatalog}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#FAF8F5] border border-[#D5D0C5] rounded-xl text-xs font-semibold text-[#1A1C19] hover:border-[#2D4A3E]"
                  >
                    <span>Hoặc duyệt toàn bộ danh mục sản phẩm</span>
                  </button>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </section>
  );
};
