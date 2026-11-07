import React, { useState, useEffect, useCallback } from 'react';
import {
  Camera,
  ArrowRight,
  Sparkles,
  SlidersHorizontal,
  ChevronRight,
  ChevronLeft,
  TrendingUp,
  Search,
  X,
  RotateCcw,
} from 'lucide-react';
import { Navbar } from './components/layout/Navbar.tsx';
import { Footer } from './components/layout/Footer.tsx';
import { MobileDrawer } from './components/layout/MobileDrawer.tsx';
import { ProductCard } from './components/product/ProductCard.tsx';
import { ProductFilterPanel } from './components/product/ProductFilterPanel.tsx';
import { ProductDetailView } from './components/product/ProductDetailView.tsx';
import { SizeGuideModal } from './components/product/SizeGuideModal.tsx';
import { AuthModal } from './components/auth/AuthModal.tsx';
import { ResetPasswordModal } from './components/auth/ResetPasswordModal.tsx';
import { AccountModal } from './components/account/AccountModal.tsx';
import { CartDrawer } from './components/cart/CartDrawer.tsx';
import { WishlistDrawer } from './components/wishlist/WishlistDrawer.tsx';
import { CheckoutModal } from './components/checkout/CheckoutModal.tsx';
import { PolicyFaqView } from './components/support/PolicyFaqView.tsx';
import { ChatbotWidget } from './components/support/ChatbotWidget.tsx';
import { AdminDashboardView } from './components/admin/AdminDashboardView.tsx';
import { VisualSearchPage } from './components/search/VisualSearchPage.tsx';
import { ImageWithFallback } from './components/common/ImageWithFallback.tsx';
import { apiRequest, isDbUnavailableError, DB_UNAVAILABLE_UI_MESSAGE } from './lib/api.ts';
import type {
  TargetGender,
  Category,
  ProductSummary,
  ProductFilterState,
  SortOption,
  ColorSwatch,
  User,
  CartItemState,
  CartSummaryState,
} from './types/index.ts';

const DEFAULT_FILTERS: ProductFilterState = {
  q: '',
  gender: 'all',
  includeUnisex: true,
  category: '',
  minPrice: '',
  maxPrice: '',
  size: '',
  color: '',
  onSale: false,
  inStock: false,
  minRating: '',
  sort: 'newest',
  page: 1,
  pageSize: 12,
};

/**
 * Đọc trạng thái bộ lọc, sắp xếp, phân trang và trang chi tiết sản phẩm trực tiếp từ URL hiện tại
 */
function parseStateFromLocation(): {
  filters: ProductFilterState;
  productSlug: string | null;
  supportView: { mode: 'policy' | 'faq'; policySlug: string } | null;
  isAdminView: boolean;
  isVisualSearchView: boolean;
} {
  try {
    const url = new URL(window.location.href);
    const sp = url.searchParams;

    const isAdminView =
      url.pathname === '/admin' ||
      url.pathname.startsWith('/admin/') ||
      sp.get('view') === 'admin';

    const isVisualSearchView =
      url.pathname === '/visual-search' ||
      url.pathname.startsWith('/visual-search/') ||
      sp.get('view') === 'visual-search';

    // Hỗ trợ mở chi tiết sản phẩm qua /products/:slug hoặc ?product=:slug
    let productSlug: string | null = sp.get('product');
    const pathMatch = url.pathname.match(/^\/products\/([^/]+)$/);
    if (pathMatch && pathMatch[1]) {
      productSlug = decodeURIComponent(pathMatch[1]);
    }

    // Hỗ trợ mở trang Chính sách (/policies/:slug hoặc ?policy=:slug) và FAQ (/faq hoặc ?view=faq)
    let supportView: { mode: 'policy' | 'faq'; policySlug: string } | null = null;
    const policyMatch = url.pathname.match(/^\/policies\/([^/]+)$/);
    if (policyMatch && policyMatch[1]) {
      supportView = { mode: 'policy', policySlug: decodeURIComponent(policyMatch[1]) };
    } else if (url.pathname === '/policies') {
      supportView = { mode: 'policy', policySlug: sp.get('policy') || 'return' };
    } else if (url.pathname === '/faq' || sp.get('view') === 'faq') {
      supportView = { mode: 'faq', policySlug: 'return' };
    } else if (sp.get('policy')) {
      supportView = { mode: 'policy', policySlug: sp.get('policy') || 'return' };
    }

    const rawGender = sp.get('gender');
    const gender: TargetGender | 'all' =
      rawGender === 'men' || rawGender === 'women' || rawGender === 'unisex'
        ? rawGender
        : 'all';

    const rawQ = sp.get('q') || '';
    const rawSort = sp.get('sort');
    const sort: SortOption =
      rawSort === 'newest' ||
      rawSort === 'bestseller' ||
      rawSort === 'price_asc' ||
      rawSort === 'price_desc' ||
      rawSort === 'rating' ||
      rawSort === 'relevance'
        ? rawSort
        : rawQ.trim()
        ? 'relevance'
        : 'newest';

    const rawPage = Number(sp.get('page') || '1');
    const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;

    const rawPageSize = Number(sp.get('pageSize') || '12');
    const pageSize =
      Number.isInteger(rawPageSize) && rawPageSize >= 1 && rawPageSize <= 24
        ? rawPageSize
        : 12;

    const includeUnisexParam = sp.get('includeUnisex');
    const includeUnisex = includeUnisexParam !== 'false' && includeUnisexParam !== '0';

    return {
      productSlug,
      supportView,
      isAdminView,
      isVisualSearchView,
      filters: {
        q: sp.get('q') || '',
        gender,
        includeUnisex,
        category: sp.get('category') || '',
        minPrice: sp.get('minPrice') || '',
        maxPrice: sp.get('maxPrice') || '',
        size: sp.get('size') || '',
        color: sp.get('color') || '',
        onSale: sp.get('onSale') === 'true' || sp.get('onSale') === '1',
        inStock: sp.get('inStock') === 'true' || sp.get('inStock') === '1',
        minRating: sp.get('minRating') || '',
        sort,
        page,
        pageSize,
      },
    };
  } catch {
    return {
      filters: { ...DEFAULT_FILTERS },
      productSlug: null,
      supportView: null,
      isAdminView: false,
      isVisualSearchView: false,
    };
  }
}

/**
 * Xây dựng chuỗi URL query string sạch từ bộ lọc và productSlug
 */
function buildUrlFromState(
  filters: ProductFilterState,
  productSlug: string | null,
  supportView: { mode: 'policy' | 'faq'; policySlug: string } | null = null
): string {
  if (supportView) {
    if (supportView.mode === 'faq') {
      return '/?view=faq';
    }
    return `/?policy=${encodeURIComponent(supportView.policySlug || 'return')}`;
  }
  const sp = new URLSearchParams();
  if (productSlug) {
    sp.set('product', productSlug);
  }
  if (filters.q.trim()) sp.set('q', filters.q.trim());
  if (filters.gender !== 'all') sp.set('gender', filters.gender);
  if (!filters.includeUnisex && (filters.gender === 'men' || filters.gender === 'women')) {
    sp.set('includeUnisex', 'false');
  }
  if (filters.category) sp.set('category', filters.category);
  if (filters.minPrice) sp.set('minPrice', filters.minPrice);
  if (filters.maxPrice) sp.set('maxPrice', filters.maxPrice);
  if (filters.size) sp.set('size', filters.size);
  if (filters.color) sp.set('color', filters.color);
  if (filters.onSale) sp.set('onSale', 'true');
  if (filters.inStock) sp.set('inStock', 'true');
  if (filters.minRating) sp.set('minRating', filters.minRating);
  if (filters.sort !== 'newest') sp.set('sort', filters.sort);
  if (filters.page > 1) sp.set('page', String(filters.page));
  if (filters.pageSize !== 12) sp.set('pageSize', String(filters.pageSize));

  const qs = sp.toString();
  return qs ? `/?${qs}` : '/';
}

export default function App() {
  const initialParsed = parseStateFromLocation();
  const [filters, setFilters] = useState<ProductFilterState>(initialParsed.filters);
  const [selectedProductSlug, setSelectedProductSlug] = useState<string | null>(
    initialParsed.productSlug
  );
  const [activeSupportView, setActiveSupportView] = useState<{
    mode: 'policy' | 'faq';
    policySlug: string;
  } | null>(initialParsed.supportView);
  const [isAdminView, setIsAdminView] = useState<boolean>(initialParsed.isAdminView);
  const [isVisualSearchView, setIsVisualSearchView] = useState<boolean>(
    initialParsed.isVisualSearchView
  );

  // Dữ liệu Danh mục, Facets & Danh sách sản phẩm phân trang
  const [categories, setCategories] = useState<Category[]>([]);
  const [availableColors, setAvailableColors] = useState<ColorSwatch[]>([]);
  const [availableSizes, setAvailableSizes] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [totalProducts, setTotalProducts] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Input tìm kiếm trực tiếp tại thanh công cụ danh mục
  const [catalogSearchInput, setCatalogSearchInput] = useState<string>(initialParsed.filters.q);

  // Người dùng đăng nhập
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // Modals & Drawers
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const [isSizeGuideOpen, setIsSizeGuideOpen] = useState(false);
  const [sizeGuideGender, setSizeGuideGender] = useState<TargetGender>('men');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [resetPasswordToken, setResetPasswordToken] = useState<string | null>(null);
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);

  // Giỏ hàng, Yêu thích & Thanh toán (Giai đoạn 4)
  const [cartItems, setCartItems] = useState<CartItemState[]>([]);
  const [cartSummary, setCartSummary] = useState<CartSummaryState>({
    totalItems: 0,
    distinctItems: 0,
    subtotal: 0,
    estimatedShippingFee: 30000,
    freeShippingThreshold: 499000,
    estimatedTotal: 0,
  });
  const [isUpdatingCart, setIsUpdatingCart] = useState<boolean>(false);
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState<boolean>(false);

  const [wishlistItems, setWishlistItems] = useState<ProductSummary[]>([]);
  const [isWishlistDrawerOpen, setIsWishlistDrawerOpen] = useState<boolean>(false);

  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState<boolean>(false);
  const [checkoutInitialMode, setCheckoutInitialMode] = useState<'checkout' | 'orders'>('checkout');
  const [catalogRefreshTick, setCatalogRefreshTick] = useState<number>(0);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Nạp giỏ hàng hiện tại (khách vãng lai qua cookie session_id hoặc người dùng đã đăng nhập)
  // Khi API trả 503 DB_UNAVAILABLE: hiển thị "Hệ thống đang bận, vui lòng thử lại" và TUYỆT ĐỐI KHÔNG xóa giỏ hàng hiện có
  const fetchCart = useCallback(async () => {
    try {
      const res = await apiRequest('/api/cart');
      if (isDbUnavailableError(res.status, res.errorCode)) {
        showToast(res.errorMessage || DB_UNAVAILABLE_UI_MESSAGE);
        return;
      }
      if (res.ok && res.data?.success) {
        setCartItems(res.data.items || []);
        if (res.data.summary) setCartSummary(res.data.summary);
      }
    } catch (err) {
      console.error('Lỗi tải giỏ hàng:', err);
    }
  }, []);

  // Nạp danh sách yêu thích của người dùng đã đăng nhập
  const fetchWishlist = useCallback(async () => {
    if (!currentUser) {
      setWishlistItems([]);
      return;
    }
    try {
      const res = await apiRequest('/api/wishlist');
      if (isDbUnavailableError(res.status, res.errorCode)) {
        showToast(res.errorMessage || DB_UNAVAILABLE_UI_MESSAGE);
        return;
      }
      if (res.ok && res.data?.success && Array.isArray(res.data.items)) {
        setWishlistItems(res.data.items);
      }
    } catch (err) {
      console.error('Lỗi tải danh sách yêu thích:', err);
    }
  }, [currentUser]);

  // Đồng bộ trạng thái vào URL History (pushState)
  const syncStateToUrl = useCallback(
    (
      nextFilters: ProductFilterState,
      nextProductSlug: string | null,
      replace = false,
      nextSupportView: { mode: 'policy' | 'faq'; policySlug: string } | null = null
    ) => {
      const targetUrl = buildUrlFromState(nextFilters, nextProductSlug, nextSupportView);
      const currentUrl = window.location.pathname + window.location.search;
      if (targetUrl !== currentUrl) {
        if (replace) {
          window.history.replaceState({}, document.title, targetUrl);
        } else {
          window.history.pushState({}, document.title, targetUrl);
        }
      }
    },
    []
  );

  // Lắng nghe sự kiện Back / Forward của trình duyệt (popstate)
  useEffect(() => {
    const handlePopState = () => {
      const parsed = parseStateFromLocation();
      setFilters(parsed.filters);
      setCatalogSearchInput(parsed.filters.q);
      setSelectedProductSlug(parsed.productSlug);
      setActiveSupportView(parsed.supportView);
      setIsAdminView(parsed.isAdminView);
      setIsVisualSearchView(parsed.isVisualSearchView);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Kiểm tra token đặt lại mật khẩu từ URL khi mở trang (?token=... hoặc /reset-password?token=...)
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const token = url.searchParams.get('token');
      if (token && (url.pathname.includes('reset-password') || url.searchParams.has('token'))) {
        setResetPasswordToken(token);
        setIsResetPasswordOpen(true);
        window.history.replaceState({}, document.title, '/');
      }
    } catch (e) {
      console.error('Lỗi phân tích URL:', e);
    }
  }, []);

  // Kiểm tra phiên đăng nhập hiện tại từ cookie httpOnly & nạp giỏ hàng
  // Khi API trả 503 DB_UNAVAILABLE: hiển thị "Hệ thống đang bận, vui lòng thử lại" và TUYỆT ĐỐI KHÔNG đăng xuất người dùng hay xóa giỏ
  useEffect(() => {
    apiRequest('/api/auth/me')
      .then((res) => {
        if (isDbUnavailableError(res.status, res.errorCode)) {
          showToast(res.errorMessage || DB_UNAVAILABLE_UI_MESSAGE);
          return;
        }
        if (res.ok && res.data?.success && res.data?.authenticated && res.data?.user) {
          setCurrentUser(res.data.user);
        }
      })
      .catch((err) => console.error('Lỗi kiểm tra phiên:', err))
      .finally(() => {
        fetchCart();
      });
  }, [fetchCart]);

  useEffect(() => {
    fetchWishlist();
    fetchCart();
  }, [currentUser, fetchWishlist, fetchCart]);

  // Nạp danh mục & facets (màu sắc, kích cỡ) từ API server
  useEffect(() => {
    fetch('/api/categories')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.data)) {
          setCategories(data.data);
        }
      })
      .catch(() => {});

    fetch('/api/products/facets')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          setAvailableColors(data.data.colors || []);
          setAvailableSizes(data.data.sizes || []);
        }
      })
      .catch(() => {});
  }, []);

  // Nạp danh sách sản phẩm phân trang từ GET /api/products theo đúng trạng thái bộ lọc
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    const apiParams = new URLSearchParams();
    if (filters.q.trim()) apiParams.set('q', filters.q.trim());
    if (filters.gender !== 'all') apiParams.set('gender', filters.gender);
    if (!filters.includeUnisex && (filters.gender === 'men' || filters.gender === 'women')) {
      apiParams.set('includeUnisex', 'false');
    }
    if (filters.category) apiParams.set('category', filters.category);
    if (filters.minPrice) apiParams.set('minPrice', filters.minPrice);
    if (filters.maxPrice) apiParams.set('maxPrice', filters.maxPrice);
    if (filters.size) apiParams.set('size', filters.size);
    if (filters.color) apiParams.set('color', filters.color);
    if (filters.onSale) apiParams.set('onSale', 'true');
    if (filters.inStock) apiParams.set('inStock', 'true');
    if (filters.minRating) apiParams.set('minRating', filters.minRating);
    apiParams.set('sort', filters.sort);
    apiParams.set('page', String(filters.page));
    apiParams.set('pageSize', String(filters.pageSize));

    fetch(`/api/products?${apiParams.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (!isMounted) return;
        if (data.success && Array.isArray(data.items)) {
          setProducts(data.items);
          setTotalProducts(data.total ?? data.items.length);
          setTotalPages(data.totalPages ?? 1);
        }
      })
      .catch((err) => console.error('Lỗi tải danh sách sản phẩm:', err))
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [filters, catalogRefreshTick]);

  // Hàm cập nhật bộ lọc và đẩy vào URL
  const handleUpdateFilters = (partial: Partial<ProductFilterState>) => {
    const next: ProductFilterState = {
      ...filters,
      ...partial,
    };
    if (partial.q !== undefined) {
      setCatalogSearchInput(partial.q);
      if (partial.sort === undefined) {
        next.sort = partial.q.trim() ? 'relevance' : 'newest';
      }
    }
    setFilters(next);
    setSelectedProductSlug(null);
    setActiveSupportView(null);
    setIsVisualSearchView(false);
    syncStateToUrl(next, null, false, null);
  };

  // Hàm đặt lại toàn bộ bộ lọc
  const handleResetFilters = () => {
    const resetState = { ...DEFAULT_FILTERS };
    setFilters(resetState);
    setCatalogSearchInput('');
    setSelectedProductSlug(null);
    setActiveSupportView(null);
    setIsVisualSearchView(false);
    syncStateToUrl(resetState, null, false, null);
  };

  // Chọn đối tượng từ Navbar / Hero
  const handleSelectGender = (gender: TargetGender | 'all') => {
    const next: ProductFilterState = {
      ...filters,
      gender,
      page: 1,
    };
    setFilters(next);
    setSelectedProductSlug(null);
    setActiveSupportView(null);
    setIsVisualSearchView(false);
    syncStateToUrl(next, null, false, null);
  };

  // Mở trang chi tiết sản phẩm
  const handleOpenProductDetail = (slug: string) => {
    setSelectedProductSlug(slug);
    setActiveSupportView(null);
    setIsVisualSearchView(false);
    syncStateToUrl(filters, slug, false, null);
  };

  // Quay lại danh mục từ trang chi tiết
  const handleCloseProductDetail = () => {
    setSelectedProductSlug(null);
    syncStateToUrl(filters, null, false, null);
  };

  // Mở trang Tìm kiếm bằng ảnh AI (/visual-search)
  const handleOpenVisualSearch = () => {
    setSelectedProductSlug(null);
    setActiveSupportView(null);
    setIsAdminView(false);
    setIsVisualSearchView(true);
    window.history.pushState({}, 'Tìm kiếm sản phẩm bằng ảnh AI | Baity Fashion', '/visual-search');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Mở trang Chính sách hoặc FAQ
  const handleOpenPolicy = (slug: string) => {
    const nextSupport = { mode: 'policy' as const, policySlug: slug || 'return' };
    setSelectedProductSlug(null);
    setIsVisualSearchView(false);
    setActiveSupportView(nextSupport);
    syncStateToUrl(filters, null, false, nextSupport);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenFaq = () => {
    const nextSupport = { mode: 'faq' as const, policySlug: 'return' };
    setSelectedProductSlug(null);
    setIsVisualSearchView(false);
    setActiveSupportView(nextSupport);
    syncStateToUrl(filters, null, false, nextSupport);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCloseSupportView = () => {
    setActiveSupportView(null);
    setIsVisualSearchView(false);
    document.title = 'VAULT Minimalist Menswear & Womenswear — Thời trang tối giản';
    syncStateToUrl(filters, null, false, null);
  };

  // Xử lý đăng xuất
  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
      setCurrentUser(null);
      setWishlistItems([]);
      setIsAccountModalOpen(false);
      await fetchCart();
      showToast('Đã đăng xuất tài khoản thành công');
    } catch {
      showToast('Lỗi khi đăng xuất');
    }
  };

  // Thêm sản phẩm vào giỏ hàng qua API
  const handleAddToCart = async (
    product: { name: string },
    variant: { id: string; colorName: string; size: string },
    quantity: number
  ) => {
    setIsUpdatingCart(true);
    try {
      const res = await apiRequest('/api/cart', {
        method: 'POST',
        body: JSON.stringify({
          variantId: variant.id,
          quantity,
        }),
      });
      if (!res.ok) {
        showToast(res.errorMessage || 'Không thể thêm vào giỏ hàng');
        return;
      }
      if (res.data?.items) setCartItems(res.data.items);
      if (res.data?.summary) setCartSummary(res.data.summary);
      setIsCartDrawerOpen(true);
      showToast(
        res.data?.message ||
          `Đã thêm "${product.name}" (${variant.colorName} - Size ${variant.size}) vào giỏ hàng`
      );
    } catch {
      showToast('Lỗi kết nối khi thêm vào giỏ hàng');
    } finally {
      setIsUpdatingCart(false);
    }
  };

  // Cập nhật số lượng trong giỏ hàng
  const handleUpdateCartQuantity = async (itemId: string, newQty: number) => {
    setIsUpdatingCart(true);
    try {
      const res = await apiRequest(`/api/cart/${encodeURIComponent(itemId)}`, {
        method: 'PUT',
        body: JSON.stringify({ quantity: newQty }),
      });
      if (!res.ok) {
        showToast(res.errorMessage || 'Không thể cập nhật số lượng');
        return;
      }
      if (res.data?.items) setCartItems(res.data.items);
      if (res.data?.summary) setCartSummary(res.data.summary);
    } catch {
      showToast('Lỗi kết nối khi cập nhật giỏ hàng');
    } finally {
      setIsUpdatingCart(false);
    }
  };

  // Xóa sản phẩm khỏi giỏ hàng
  const handleRemoveCartItem = async (itemId: string) => {
    setIsUpdatingCart(true);
    try {
      const res = await apiRequest(`/api/cart/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        showToast(res.errorMessage || 'Không thể xóa sản phẩm khỏi giỏ hàng');
        return;
      }
      if (res.data?.items) setCartItems(res.data.items);
      if (res.data?.summary) setCartSummary(res.data.summary);
      showToast('Đã xóa sản phẩm khỏi giỏ hàng');
    } catch {
      showToast('Lỗi khi xóa sản phẩm khỏi giỏ hàng');
    } finally {
      setIsUpdatingCart(false);
    }
  };

  // Thêm / xóa yêu thích qua API
  const handleToggleWishlist = async (product: ProductSummary) => {
    if (!currentUser) {
      showToast('Vui lòng đăng nhập để lưu sản phẩm vào danh sách yêu thích');
      setIsAuthModalOpen(true);
      return;
    }

    const alreadyLiked = wishlistItems.some((w) => w.id === product.id);
    try {
      if (alreadyLiked) {
        const res = await apiRequest(`/api/wishlist/${encodeURIComponent(product.id)}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          setWishlistItems((prev) => prev.filter((w) => w.id !== product.id));
          showToast(`Đã xóa "${product.name}" khỏi danh sách yêu thích`);
        } else {
          showToast(res.errorMessage || 'Không thể xóa khỏi yêu thích');
        }
      } else {
        const res = await apiRequest('/api/wishlist', {
          method: 'POST',
          body: JSON.stringify({ productId: product.id }),
        });
        if (res.ok) {
          await fetchWishlist();
          showToast(`Đã lưu "${product.name}" vào danh sách yêu thích`);
        } else {
          showToast(res.errorMessage || 'Không thể thêm vào yêu thích');
        }
      }
    } catch {
      showToast('Lỗi kết nối khi cập nhật yêu thích');
    }
  };

  const handleRemoveWishlistById = async (productId: string) => {
    try {
      const res = await apiRequest(`/api/wishlist/${encodeURIComponent(productId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setWishlistItems((prev) => prev.filter((w) => w.id !== productId));
        showToast('Đã xóa sản phẩm khỏi danh sách yêu thích');
      } else {
        showToast(res.errorMessage || 'Không thể xóa khỏi yêu thích');
      }
    } catch {
      showToast('Lỗi khi xóa khỏi yêu thích');
    }
  };

  // Đếm số bộ lọc đang bật để hiển thị trên nút Lọc Mobile
  const activeFilterCount = [
    filters.q !== '',
    filters.gender !== 'all',
    !filters.includeUnisex,
    filters.category !== '',
    filters.minPrice !== '' || filters.maxPrice !== '',
    filters.size !== '',
    filters.color !== '',
    filters.onSale,
    filters.inStock,
    filters.minRating !== '',
  ].filter(Boolean).length;

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8F5] text-[#1A1C19]">
      {/* Toast thông báo */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#1A1C19] text-white text-xs px-4 py-3 rounded-lg shadow-xl flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#A3B899]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Navbar chuẩn Top Bar Contract */}
      <Navbar
        activeTab={filters.gender}
        searchQuery={filters.q}
        onSelectGender={handleSelectGender}
        onSearchSubmit={(q) => handleUpdateFilters({ q, page: 1 })}
        onSelectProductSlug={handleOpenProductDetail}
        onOpenImageSearch={handleOpenVisualSearch}
        onOpenCart={() => {
          fetchCart();
          setIsCartDrawerOpen(true);
        }}
        onOpenWishlist={() => {
          if (!currentUser) {
            showToast('Vui lòng đăng nhập để xem danh sách yêu thích');
            setIsAuthModalOpen(true);
            return;
          }
          fetchWishlist();
          setIsWishlistDrawerOpen(true);
        }}
        onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
        onOpenSizeGuide={() => {
          setSizeGuideGender(filters.gender === 'all' ? 'men' : filters.gender);
          setIsSizeGuideOpen(true);
        }}
        onNavigateHome={handleResetFilters}
        currentUser={currentUser}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onOpenAccount={() => setIsAccountModalOpen(true)}
        cartCount={cartSummary.totalItems}
        wishlistCount={wishlistItems.length}
      />

      {/* Ngăn kéo Giỏ Hàng (CartDrawer) */}
      <CartDrawer
        isOpen={isCartDrawerOpen}
        onClose={() => setIsCartDrawerOpen(false)}
        items={cartItems}
        summary={cartSummary}
        isUpdating={isUpdatingCart}
        onUpdateQuantity={handleUpdateCartQuantity}
        onRemoveItem={handleRemoveCartItem}
        onSelectProductSlug={handleOpenProductDetail}
        onProceedToCheckout={() => {
          setIsCartDrawerOpen(false);
          if (!currentUser) {
            showToast('Vui lòng đăng nhập tài khoản để tiến hành đặt hàng');
            setIsAuthModalOpen(true);
            return;
          }
          setCheckoutInitialMode('checkout');
          setIsCheckoutModalOpen(true);
        }}
        onOpenMyOrders={() => {
          setIsCartDrawerOpen(false);
          setCheckoutInitialMode('orders');
          setIsCheckoutModalOpen(true);
        }}
        isAuthenticated={Boolean(currentUser)}
      />

      {/* Ngăn kéo Danh sách Yêu thích (WishlistDrawer) */}
      <WishlistDrawer
        isOpen={isWishlistDrawerOpen}
        onClose={() => setIsWishlistDrawerOpen(false)}
        items={wishlistItems}
        onRemoveItem={handleRemoveWishlistById}
        onSelectProductSlug={handleOpenProductDetail}
      />

      {/* Modal Thanh Toán, Voucher, VietQR & Đơn hàng của tôi */}
      <CheckoutModal
        isOpen={isCheckoutModalOpen}
        initialMode={checkoutInitialMode}
        onClose={() => setIsCheckoutModalOpen(false)}
        currentUser={currentUser}
        cartItems={cartItems}
        cartSummary={cartSummary}
        onOrderCreated={() => {
          fetchCart();
          setCatalogRefreshTick((t) => t + 1);
        }}
        onCartRefresh={() => {
          fetchCart();
          setCatalogRefreshTick((t) => t + 1);
        }}
        showToast={showToast}
      />

      {/* Mobile Drawer Menu */}
      <MobileDrawer
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        categories={categories}
        onSelectGender={handleSelectGender}
        onOpenImageSearch={handleOpenVisualSearch}
        onOpenSizeGuide={() => setIsSizeGuideOpen(true)}
        currentUser={currentUser}
        onOpenAuth={() => setIsAuthModalOpen(true)}
        onOpenAccount={() => setIsAccountModalOpen(true)}
      />

      {/* Mobile Filter Drawer (Cho phép lọc đầy đủ trên di động) */}
      {isMobileFilterOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs"
            onClick={() => setIsMobileFilterOpen(false)}
          />
          <div className="relative ml-auto w-full max-w-xs bg-[#FAF8F5] h-full overflow-y-auto p-5 shadow-2xl z-10">
            <ProductFilterPanel
              filters={filters}
              categories={categories}
              availableColors={availableColors}
              availableSizes={availableSizes}
              onUpdateFilters={handleUpdateFilters}
              onResetFilters={handleResetFilters}
              isMobileDrawer={true}
              onCloseMobileDrawer={() => setIsMobileFilterOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Modal Đăng nhập / Đăng ký / Quên mật khẩu */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={(user) => {
          setCurrentUser(user);
          fetchCart();
          showToast(`Xin chào ${user.fullName}! Đã đồng bộ giỏ hàng của bạn.`);
        }}
      />

      {/* Modal Đặt lại mật khẩu từ liên kết khôi phục email */}
      {resetPasswordToken && (
        <ResetPasswordModal
          isOpen={isResetPasswordOpen}
          token={resetPasswordToken}
          onClose={() => setIsResetPasswordOpen(false)}
          onSuccessLoginOpen={() => {
            setIsResetPasswordOpen(false);
            setIsAuthModalOpen(true);
          }}
        />
      )}

      {/* Modal Quản lý Tài khoản & Sổ địa chỉ */}
      {currentUser && (
        <AccountModal
          isOpen={isAccountModalOpen}
          onClose={() => setIsAccountModalOpen(false)}
          currentUser={currentUser}
          onUpdateUser={(updated) => {
            setCurrentUser(updated);
            showToast('Đã lưu thông tin hồ sơ');
          }}
          onLogout={handleLogout}
        />
      )}

      {/* Modal Bảng Size */}
      <SizeGuideModal
        isOpen={isSizeGuideOpen}
        onClose={() => setIsSizeGuideOpen(false)}
        initialGender={sizeGuideGender}
      />

      {/* Thanh truy cập nhanh khu vực Quản trị khi đăng nhập bằng tài khoản Admin */}
      {currentUser?.role === 'admin' && !isAdminView && (
        <div className="bg-[#1A1C19] text-white text-xs py-2 px-4 flex items-center justify-between">
          <span>Bạn đang đăng nhập với quyền Quản trị viên (Admin).</span>
          <button
            type="button"
            onClick={() => {
              setIsAdminView(true);
              setIsVisualSearchView(false);
              window.history.pushState({}, 'Khu vực Quản trị — Baity', '/admin');
            }}
            className="px-3 py-1 bg-[#C27D56] text-white font-semibold rounded hover:opacity-95"
          >
            Mở Khu vực Quản trị (/admin)
          </button>
        </div>
      )}

      {/* NỘI DUNG CHÍNH: HIỂN THỊ TRANG ADMIN, TÌM BẰNG ẢNH AI, CHÍNH SÁCH/FAQ, CHI TIẾT SẢN PHẨM HOẶC DANH MỤC */}
      <main className="flex-1">
        {isAdminView ? (
          <AdminDashboardView
            currentUser={currentUser}
            onBackToStore={() => {
              setIsAdminView(false);
              syncStateToUrl(filters, null, false, null);
            }}
            onShowToast={showToast}
          />
        ) : isVisualSearchView ? (
          <VisualSearchPage
            onBackToCatalog={() => {
              setIsVisualSearchView(false);
              syncStateToUrl(filters, null, false, null);
            }}
            onSelectProductSlug={handleOpenProductDetail}
            onAddToCart={handleAddToCart}
            onToggleWishlist={handleToggleWishlist}
            wishlistItems={wishlistItems}
            onApplyManualCatalogFilter={({ category, color }) => {
              setIsVisualSearchView(false);
              handleUpdateFilters({
                ...(category !== undefined ? { category } : {}),
                ...(color !== undefined ? { color } : {}),
                page: 1,
              });
            }}
          />
        ) : activeSupportView ? (
          <PolicyFaqView
            mode={activeSupportView.mode}
            activePolicySlug={activeSupportView.policySlug}
            onSelectPolicySlug={handleOpenPolicy}
            onSwitchToFaq={handleOpenFaq}
            onBackToCatalog={handleCloseSupportView}
            onOpenVisualSearch={handleOpenVisualSearch}
          />
        ) : selectedProductSlug ? (
          <ProductDetailView
            slug={selectedProductSlug}
            currentUser={currentUser}
            onBack={handleCloseProductDetail}
            onSelectProduct={(p) => handleOpenProductDetail(p.slug)}
            onOpenSizeGuide={(g) => {
              setSizeGuideGender(g);
              setIsSizeGuideOpen(true);
            }}
            onAddToCart={handleAddToCart}
            onToggleWishlist={handleToggleWishlist}
          />
        ) : (
          <>
            {/* 1. HERO CAMPAIGN SECTION */}
            <section className="relative bg-[#2D4A3E] text-white overflow-hidden">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
                <div className="space-y-5 max-w-xl">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-[#E6B89C] font-semibold">
                    <span>Bộ sưu tập Thu – Đông 2026</span>
                    <span aria-hidden="true">·</span>
                    <span>Flash Sale Giảm Đến 20%</span>
                  </div>

                  <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-tight text-balance">
                    Vẻ đẹp tối giản, định hình phong cách sống hiện đại.
                  </h1>

                  <p className="text-sm sm:text-base text-white/80 leading-relaxed font-light">
                    Trang phục may đo theo vóc dáng người Việt trên nền chất liệu tự nhiên bền vững. Phân chia rõ ràng cho <strong>Nam</strong>, <strong>Nữ</strong> và bộ sưu tập <strong>Unisex</strong> phóng khoáng.
                  </p>

                  <div className="flex flex-wrap items-center gap-4 pt-1">
                    <button
                      onClick={() => handleUpdateFilters({ onSale: true, page: 1 })}
                      className="px-6 py-3 bg-[#FAF8F5] text-[#2D4A3E] hover:bg-white text-xs font-bold tracking-wider uppercase rounded-lg shadow-sm transition-all flex items-center gap-2 whitespace-nowrap shrink-0"
                    >
                      <span>Săn Flash Sale (-20%)</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>

                    <button
                      onClick={handleOpenVisualSearch}
                      data-testid="hero-visual-search-btn"
                      className="px-5 py-3 bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
                    >
                      <Camera className="w-4 h-4 text-[#E6B89C]" />
                      <span>Tìm đồ bằng ảnh AI</span>
                    </button>
                  </div>
                </div>

                <div className="relative hidden lg:block">
                  <div className="relative aspect-16/10 rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-[#233B31]">
                    <ImageWithFallback
                      src="https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1200&q=80"
                      alt="Không gian thời trang Baity"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end p-6">
                      <div className="text-white text-xs font-medium">
                        Showroom Baity Flagship · 108 Nguyễn Huệ, Quận 1, TP.HCM
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* 2. BA LỐI VÀO DANH MỤC TRỌNG TÂM: NAM - NỮ - UNISEX */}
            <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-6 relative z-20">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button
                  type="button"
                  onClick={() => handleSelectGender('men')}
                  className={`group relative h-44 sm:h-52 rounded-2xl overflow-hidden shadow-md cursor-pointer border-2 text-left transition-all duration-300 ${
                    filters.gender === 'men'
                      ? 'border-[#2D4A3E] ring-4 ring-[#2D4A3E]/20'
                      : 'border-white'
                  }`}
                >
                  <ImageWithFallback
                    src="https://images.unsplash.com/photo-1617137984095-74e4e5e3613f?auto=format&fit=crop&w=800&q=80"
                    alt="Thời trang Nam Baity"
                    className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent flex flex-col justify-end p-5 text-white">
                    <div className="text-[11px] font-bold text-[#A3B899] uppercase tracking-wider">
                      Bộ sưu tập
                    </div>
                    <div className="font-display text-xl font-bold">Thời Trang Nam</div>
                    <div className="text-xs text-white/80 mt-1 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      <span>Áo sơ mi, polo, quần jean (+Unisex)</span>
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectGender('women')}
                  className={`group relative h-44 sm:h-52 rounded-2xl overflow-hidden shadow-md cursor-pointer border-2 text-left transition-all duration-300 ${
                    filters.gender === 'women'
                      ? 'border-[#2D4A3E] ring-4 ring-[#2D4A3E]/20'
                      : 'border-white'
                  }`}
                >
                  <ImageWithFallback
                    src="https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80"
                    alt="Thời trang Nữ Baity"
                    className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent flex flex-col justify-end p-5 text-white">
                    <div className="text-[11px] font-bold text-[#E6B89C] uppercase tracking-wider">
                      Bộ sưu tập
                    </div>
                    <div className="font-display text-xl font-bold">Thời Trang Nữ</div>
                    <div className="text-xs text-white/80 mt-1 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      <span>Váy đầm midi, blazer cropped (+Unisex)</span>
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectGender('unisex')}
                  className={`group relative h-44 sm:h-52 rounded-2xl overflow-hidden shadow-md cursor-pointer border-2 text-left transition-all duration-300 ${
                    filters.gender === 'unisex'
                      ? 'border-[#2D4A3E] ring-4 ring-[#2D4A3E]/20'
                      : 'border-white'
                  }`}
                >
                  <ImageWithFallback
                    src="https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=600&q=80"
                    alt="Thời trang Unisex Baity"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent flex flex-col justify-end p-5 text-white">
                    <div className="text-[11px] font-bold text-[#C27D56] uppercase tracking-wider">
                      Phom rộng tự do
                    </div>
                    <div className="font-display text-xl font-bold">Bộ Sưu Tập Unisex</div>
                    <div className="text-xs text-white/80 mt-1 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      <span>Hoodie nỉ, áo thun oversize, quần cargo</span>
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </button>
              </div>
            </section>

            {/* 3. KHU VỰC DANH MỤC, TÌM KIẾM, BỘ LỌC, SẮP XẾP & PHÂN TRANG */}
            <section
              id="catalog-section"
              className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12"
            >
              {/* Thanh công cụ phía trên: Tiêu đề + Ô tìm kiếm không dấu + Sắp xếp + Nút Lọc Mobile */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-[#E8E4DA]">
                <div>
                  <div className="text-xs font-bold text-[#7A5C43] uppercase tracking-wider flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4" />
                    <span>Danh mục sản phẩm ({totalProducts} sản phẩm)</span>
                  </div>
                  <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#1A1C19] mt-1">
                    {filters.q
                      ? `Kết quả tìm kiếm: "${filters.q}"`
                      : filters.gender === 'men'
                      ? filters.includeUnisex
                        ? 'Trang Phục Nam & Unisex'
                        : 'Trang Phục Nam (Thuần Nam)'
                      : filters.gender === 'women'
                      ? filters.includeUnisex
                        ? 'Trang Phục Nữ & Unisex'
                        : 'Trang Phục Nữ (Thuần Nữ)'
                      : filters.gender === 'unisex'
                      ? 'Trang Phục Unisex Phom Rộng'
                      : 'Tất Cả Sản Phẩm Baity'}
                  </h2>
                </div>

                {/* Cụm Tìm kiếm nhanh, Sắp xếp & Nút mở Drawer Bộ lọc trên Mobile */}
                <div className="flex flex-wrap items-center gap-3">
                  {/* Ô tìm kiếm từ khóa không dấu */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleUpdateFilters({ q: catalogSearchInput.trim(), page: 1 });
                    }}
                    className="relative flex-1 sm:flex-initial"
                  >
                    <input
                      type="search"
                      value={catalogSearchInput}
                      onChange={(e) => setCatalogSearchInput(e.target.value)}
                      placeholder="Tìm kiếm không dấu (VD: ao so mi)..."
                      aria-label="Tìm kiếm trong danh mục"
                      className="w-full sm:w-64 pl-9 pr-8 py-2 text-xs bg-white border border-[#D5D0C5] rounded-xl text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E]"
                    />
                    <Search className="w-4 h-4 text-[#7A7569] absolute left-3 top-1/2 -translate-y-1/2" />
                    {catalogSearchInput && (
                      <button
                        type="button"
                        onClick={() => {
                          setCatalogSearchInput('');
                          handleUpdateFilters({ q: '', page: 1 });
                        }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7A7569] hover:text-[#1A1C19]"
                        aria-label="Xóa từ khóa tìm kiếm"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </form>

                  {/* Chọn thứ tự Sắp xếp */}
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="sort-select"
                      className="text-xs font-medium text-[#5C584F] whitespace-nowrap"
                    >
                      Sắp xếp:
                    </label>
                    <select
                      id="sort-select"
                      value={filters.sort}
                      onChange={(e) =>
                        handleUpdateFilters({
                          sort: e.target.value as SortOption,
                          page: 1,
                        })
                      }
                      className="px-3 py-2 text-xs font-semibold bg-white border border-[#D5D0C5] rounded-xl text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E]"
                    >
                      <option value="relevance">Độ phù hợp (Relevance)</option>
                      <option value="newest">Mới nhất</option>
                      <option value="bestseller">Bán chạy nhất</option>
                      <option value="price_asc">Giá: Thấp đến Cao</option>
                      <option value="price_desc">Giá: Cao đến Thấp</option>
                      <option value="rating">Đánh giá cao nhất</option>
                    </select>
                  </div>

                  {/* Nút mở Drawer Bộ lọc trên Mobile */}
                  <button
                    type="button"
                    onClick={() => setIsMobileFilterOpen(true)}
                    className="lg:hidden flex items-center gap-2 px-3.5 py-2 bg-[#2D4A3E] text-white text-xs font-semibold rounded-xl shadow-xs"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    <span>Bộ lọc</span>
                    {activeFilterCount > 0 && (
                      <span className="w-4 h-4 rounded-full bg-[#C27D56] text-white text-[10px] font-bold flex items-center justify-center">
                        {activeFilterCount}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Layout 2 cột: Sidebar Bộ lọc (Desktop) + Lưới Sản phẩm */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-8 items-start">
                {/* Cột Trái: Bộ lọc trên Desktop */}
                <aside className="hidden lg:block lg:col-span-3 bg-white p-5 rounded-2xl border border-[#EAE6DE] sticky top-24">
                  <ProductFilterPanel
                    filters={filters}
                    categories={categories}
                    availableColors={availableColors}
                    availableSizes={availableSizes}
                    onUpdateFilters={handleUpdateFilters}
                    onResetFilters={handleResetFilters}
                  />
                </aside>

                {/* Cột Phải: Lưới sản phẩm & Phân trang */}
                <div className="lg:col-span-9 space-y-8">
                  {/* Thanh hiển thị các điều kiện lọc đang áp dụng */}
                  {activeFilterCount > 0 && (
                    <div className="flex flex-wrap items-center gap-2 p-3 bg-[#F2EFE9] rounded-xl text-xs">
                      <span className="font-semibold text-[#5C584F]">Đang lọc theo:</span>
                      {filters.gender !== 'all' && (
                        <button
                          type="button"
                          onClick={() => handleUpdateFilters({ gender: 'all', page: 1 })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-md border border-[#D5D0C5] text-[#1A1C19] font-medium"
                        >
                          <span>
                            Đối tượng:{' '}
                            {filters.gender === 'men'
                              ? 'Nam'
                              : filters.gender === 'women'
                              ? 'Nữ'
                              : 'Unisex'}
                          </span>
                          <X className="w-3 h-3" />
                        </button>
                      )}
                      {!filters.includeUnisex &&
                        (filters.gender === 'men' || filters.gender === 'women') && (
                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateFilters({ includeUnisex: true, page: 1 })
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-md border border-[#D5D0C5] text-[#1A1C19] font-medium"
                          >
                            <span>Đã ẩn Unisex</span>
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      {filters.category && (
                        <button
                          type="button"
                          onClick={() => handleUpdateFilters({ category: '', page: 1 })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-md border border-[#D5D0C5] text-[#1A1C19] font-medium"
                        >
                          <span>
                            Danh mục:{' '}
                            {categories.find((c) => c.slug === filters.category)?.name ||
                              filters.category}
                          </span>
                          <X className="w-3 h-3" />
                        </button>
                      )}
                      {filters.onSale && (
                        <button
                          type="button"
                          onClick={() => handleUpdateFilters({ onSale: false, page: 1 })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-md border border-[#D5D0C5] text-[#C27D56] font-semibold"
                        >
                          <span>Đang giảm giá</span>
                          <X className="w-3 h-3" />
                        </button>
                      )}
                      {filters.inStock && (
                        <button
                          type="button"
                          onClick={() => handleUpdateFilters({ inStock: false, page: 1 })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-md border border-[#D5D0C5] text-[#1A1C19] font-medium"
                        >
                          <span>Còn hàng</span>
                          <X className="w-3 h-3" />
                        </button>
                      )}
                      {filters.size && (
                        <button
                          type="button"
                          onClick={() => handleUpdateFilters({ size: '', page: 1 })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-md border border-[#D5D0C5] text-[#1A1C19] font-medium"
                        >
                          <span>Size: {filters.size}</span>
                          <X className="w-3 h-3" />
                        </button>
                      )}
                      {filters.color && (
                        <button
                          type="button"
                          onClick={() => handleUpdateFilters({ color: '', page: 1 })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-md border border-[#D5D0C5] text-[#1A1C19] font-medium"
                        >
                          <span>Màu: {filters.color}</span>
                          <X className="w-3 h-3" />
                        </button>
                      )}
                      {(filters.minPrice || filters.maxPrice) && (
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateFilters({ minPrice: '', maxPrice: '', page: 1 })
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-md border border-[#D5D0C5] text-[#1A1C19] font-medium tabular-nums"
                        >
                          <span>
                            Giá: {filters.minPrice ? `${Number(filters.minPrice).toLocaleString('vi-VN')}₫` : '0₫'} –{' '}
                            {filters.maxPrice ? `${Number(filters.maxPrice).toLocaleString('vi-VN')}₫` : 'Max'}
                          </span>
                          <X className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleResetFilters}
                        className="ml-auto text-[#C27D56] font-semibold hover:underline flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Xóa tất cả</span>
                      </button>
                    </div>
                  )}

                  {/* Skeleton Loading State */}
                  {isLoading ? (
                    <div
                      data-testid="catalog-skeleton"
                      className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6"
                    >
                      {[...Array(6)].map((_, i) => (
                        <div
                          key={i}
                          className="bg-white rounded-xl border border-[#EAE6DE] p-3 space-y-3 animate-pulse"
                        >
                          <div className="aspect-4/5 bg-[#EFECE6] rounded-lg" />
                          <div className="h-3.5 bg-[#EFECE6] rounded w-1/3" />
                          <div className="h-4 bg-[#EFECE6] rounded w-3/4" />
                          <div className="h-4 bg-[#EFECE6] rounded w-1/2" />
                        </div>
                      ))}
                    </div>
                  ) : products.length > 0 ? (
                    <>
                      {/* Lưới thẻ sản phẩm */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-6">
                        {products.map((prod) => (
                          <ProductCard
                            key={prod.id}
                            product={prod}
                            onSelect={(p) => handleOpenProductDetail(p.slug)}
                            onToggleWishlist={handleToggleWishlist}
                            isWishlisted={wishlistItems.some((w) => w.id === prod.id)}
                          />
                        ))}
                      </div>

                      {/* Thanh Phân Trang (Pagination) */}
                      {totalPages > 1 && (
                        <nav
                          aria-label="Phân trang sản phẩm"
                          className="flex items-center justify-between border-t border-[#E8E4DA] pt-6"
                        >
                          <div className="text-xs text-[#6B665C] tabular-nums">
                            Trang <strong>{filters.page}</strong> / <strong>{totalPages}</strong> (Tổng{' '}
                            <strong>{totalProducts}</strong> sản phẩm)
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={filters.page <= 1}
                              onClick={() =>
                                handleUpdateFilters({ page: Math.max(1, filters.page - 1) })
                              }
                              className="p-2 rounded-lg border border-[#D5D0C5] bg-white text-[#1A1C19] disabled:opacity-40 disabled:cursor-not-allowed hover:border-[#2D4A3E]"
                              aria-label="Trang trước"
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </button>

                            {[...Array(totalPages)].map((_, idx) => {
                              const pageNum = idx + 1;
                              const isCurrent = filters.page === pageNum;
                              return (
                                <button
                                  key={pageNum}
                                  type="button"
                                  onClick={() => handleUpdateFilters({ page: pageNum })}
                                  className={`w-9 h-9 rounded-lg text-xs font-bold tabular-nums transition-colors ${
                                    isCurrent
                                      ? 'bg-[#2D4A3E] text-white'
                                      : 'bg-white border border-[#D5D0C5] text-[#4A4740] hover:border-[#2D4A3E]'
                                  }`}
                                >
                                  {pageNum}
                                </button>
                              );
                            })}

                            <button
                              type="button"
                              disabled={filters.page >= totalPages}
                              onClick={() =>
                                handleUpdateFilters({
                                  page: Math.min(totalPages, filters.page + 1),
                                })
                              }
                              className="p-2 rounded-lg border border-[#D5D0C5] bg-white text-[#1A1C19] disabled:opacity-40 disabled:cursor-not-allowed hover:border-[#2D4A3E]"
                              aria-label="Trang tiếp theo"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>
                        </nav>
                      )}
                    </>
                  ) : (
                    /* Trạng thái rỗng (Empty State) */
                    <div
                      data-testid="catalog-empty-state"
                      className="text-center py-16 bg-white rounded-2xl border border-[#EAE6DE] p-8 space-y-4"
                    >
                      <div className="w-12 h-12 rounded-full bg-[#F5F2EB] text-[#7A7569] flex items-center justify-center mx-auto">
                        <Search className="w-6 h-6" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="font-display text-lg font-bold text-[#1A1C19]">
                          Không tìm thấy sản phẩm phù hợp
                        </h3>
                        <p className="text-xs text-[#6B665C] max-w-md mx-auto">
                          Không có sản phẩm nào khớp với điều kiện lọc hiện tại. Hãy thử điều chỉnh khoảng giá, kích cỡ hoặc xóa bớt bộ lọc.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleResetFilters}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#2D4A3E] text-white text-xs font-semibold rounded-lg hover:bg-[#233B31] transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Xóa tất cả bộ lọc</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      {/* TRỢ LÝ TƯ VẤN TRỰC TUYẾN (CHATBOT 6c) & CHAT VỚI NGƯỜI BÁN (6d) */}
      <ChatbotWidget
        onSelectProductSlug={handleOpenProductDetail}
        isAuthenticated={Boolean(currentUser)}
        onRequireLogin={() => setIsAuthModalOpen(true)}
        onNavigateInternal={(href) => {
          if (href.startsWith('/policies/')) {
            const slug = href.replace('/policies/', '').split('?')[0];
            handleOpenPolicy(slug || 'return');
          } else if (href === '/faq' || href.includes('view=faq')) {
            handleOpenFaq();
          } else if (href === '/visual-search' || href.startsWith('/visual-search')) {
            handleOpenVisualSearch();
          }
        }}
      />

      {/* FOOTER */}
      <Footer
        onSelectGender={handleSelectGender}
        onOpenSizeGuide={() => setIsSizeGuideOpen(true)}
        onOpenImageSearch={handleOpenVisualSearch}
        onOpenPolicy={handleOpenPolicy}
        onOpenFaq={handleOpenFaq}
      />
    </div>
  );
}
