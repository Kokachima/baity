import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  BookOpen,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
  Truck,
  CreditCard,
  Search,
} from 'lucide-react';
import { SafeMarkdown } from '../common/SafeMarkdown.tsx';
import { apiRequest } from '../../lib/api.ts';

interface PolicySummary {
  slug: string;
  title: string;
  displayOrder: number;
}

interface PolicyDetail {
  slug: string;
  title: string;
  content: string;
  displayOrder: number;
}

interface FaqItem {
  question: string;
  title: string;
  answer: string;
  content: string;
  topic: string;
  displayOrder: number;
}

interface FaqGroup {
  topic: string;
  category: string;
  title: string;
  items: FaqItem[];
}

interface PolicyFaqViewProps {
  mode: 'policy' | 'faq';
  activePolicySlug?: string | null;
  onSelectPolicySlug: (slug: string) => void;
  onSwitchToFaq: () => void;
  onBackToCatalog: () => void;
  onOpenVisualSearch?: () => void;
}

export const PolicyFaqView: React.FC<PolicyFaqViewProps> = ({
  mode,
  activePolicySlug,
  onSelectPolicySlug,
  onSwitchToFaq,
  onBackToCatalog,
  onOpenVisualSearch,
}) => {
  const [policyList, setPolicyList] = useState<PolicySummary[]>([]);
  const [policyDetail, setPolicyDetail] = useState<PolicyDetail | null>(null);
  const [isPolicyLoading, setIsPolicyLoading] = useState<boolean>(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [isNotFound, setIsNotFound] = useState<boolean>(false);

  const [faqGroups, setFaqGroups] = useState<FaqGroup[]>([]);
  const [isFaqLoading, setIsFaqLoading] = useState<boolean>(false);
  const [faqError, setFaqError] = useState<string | null>(null);
  const [activeTopic, setActiveTopic] = useState<string>('all');
  const [faqSearch, setFaqSearch] = useState<string>('');
  const [openQuestionKeys, setOpenQuestionKeys] = useState<Record<string, boolean>>({});

  // Nạp danh sách các chính sách
  const fetchPolicyList = useCallback(async () => {
    try {
      const res = await apiRequest('/api/policies');
      if (res.ok && Array.isArray(res.data?.items)) {
        setPolicyList(res.data.items);
      }
    } catch {
      // Bỏ qua lỗi phụ ở sidebar
    }
  }, []);

  // Nạp chi tiết một chính sách theo slug
  const fetchPolicyDetail = useCallback(async (slug: string) => {
    setIsPolicyLoading(true);
    setPolicyError(null);
    setIsNotFound(false);
    try {
      const res = await apiRequest(`/api/policies/${encodeURIComponent(slug)}`);
      if (res.status === 404) {
        setPolicyDetail(null);
        setIsNotFound(true);
        setPolicyError(res.errorMessage || 'Không tìm thấy chính sách yêu cầu.');
        return;
      }
      if (!res.ok || !res.data?.policy) {
        setPolicyDetail(null);
        setPolicyError(
          res.errorMessage || 'Không thể tải nội dung chính sách lúc này. Vui lòng thử lại sau.'
        );
        return;
      }
      setPolicyDetail(res.data.policy);
    } catch {
      setPolicyError('Lỗi kết nối khi tải nội dung chính sách.');
    } finally {
      setIsPolicyLoading(false);
    }
  }, []);

  // Nạp danh sách FAQ nhóm theo chủ đề
  const fetchFaqData = useCallback(async () => {
    setIsFaqLoading(true);
    setFaqError(null);
    try {
      const res = await apiRequest('/api/faq');
      if (!res.ok || !Array.isArray(res.data?.categories)) {
        setFaqError(
          res.errorMessage ||
            'Không thể tải danh sách câu hỏi thường gặp lúc này. Vui lòng thử lại sau.'
        );
        return;
      }
      const cats: FaqGroup[] = res.data.categories;
      setFaqGroups(cats);
      if (cats.length > 0 && cats[0].items.length > 0) {
        setOpenQuestionKeys({ [`${cats[0].topic}__0`]: true });
      }
    } catch {
      setFaqError('Lỗi kết nối khi tải câu hỏi thường gặp.');
    } finally {
      setIsFaqLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPolicyList();
  }, [fetchPolicyList]);

  useEffect(() => {
    if (mode === 'policy') {
      const targetSlug = activePolicySlug || 'return';
      fetchPolicyDetail(targetSlug);
    } else {
      fetchFaqData();
    }
  }, [mode, activePolicySlug, fetchPolicyDetail, fetchFaqData]);

  // Cập nhật document.title riêng cho từng trang Chính sách hoặc trang FAQ
  useEffect(() => {
    const prevTitle = document.title;
    if (mode === 'faq') {
      document.title = 'Câu hỏi thường gặp (FAQ) | Baity Fashion';
    } else if (policyDetail?.title) {
      document.title = `${policyDetail.title} | Baity Fashion`;
    } else if (isNotFound) {
      document.title = 'Không tìm thấy chính sách | Baity Fashion';
    } else {
      document.title = 'Chính sách cửa hàng | Baity Fashion';
    }
    return () => {
      document.title = prevTitle;
    };
  }, [mode, policyDetail, isNotFound]);

  const handleInternalLink = (href: string) => {
    if (href.startsWith('/policies/')) {
      const slug = href.replace('/policies/', '').trim();
      if (slug) onSelectPolicySlug(slug);
    } else if (href === '/faq') {
      onSwitchToFaq();
    } else if (href === '/visual-search' || href.startsWith('/visual-search')) {
      if (onOpenVisualSearch) {
        onOpenVisualSearch();
      }
    } else if (href === '/') {
      onBackToCatalog();
    }
  };

  const toggleAccordion = (key: string) => {
    setOpenQuestionKeys((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const getPolicyIcon = (slug: string) => {
    if (slug === 'shipping') return <Truck className="w-4 h-4 shrink-0" />;
    if (slug === 'payment') return <CreditCard className="w-4 h-4 shrink-0" />;
    if (slug === 'privacy') return <ShieldCheck className="w-4 h-4 shrink-0" />;
    return <RefreshCw className="w-4 h-4 shrink-0" />;
  };

  const filteredFaqGroups = React.useMemo(() => {
    const q = faqSearch.trim().toLowerCase();
    return faqGroups
      .filter((g) => activeTopic === 'all' || g.topic === activeTopic)
      .map((g) => ({
        ...g,
        items: q
          ? g.items.filter(
              (item) =>
                item.question.toLowerCase().includes(q) ||
                item.answer.toLowerCase().includes(q)
            )
          : g.items,
      }))
      .filter((g) => g.items.length > 0);
  }, [faqGroups, activeTopic, faqSearch]);

  return (
    <section
      data-testid={mode === 'faq' ? 'faq-page-view' : 'policy-page-view'}
      className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10"
    >
      {/* Thanh điều hướng quay lại cửa hàng */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-[#E8E4DA]">
        <button
          type="button"
          onClick={onBackToCatalog}
          className="inline-flex items-center gap-2 text-xs font-semibold text-[#2D4A3E] hover:text-[#1A1C19] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Quay lại danh mục sản phẩm</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSelectPolicySlug(activePolicySlug || 'return')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
              mode === 'policy'
                ? 'bg-[#2D4A3E] text-white'
                : 'bg-white border border-[#D5D0C5] text-[#4A4740] hover:border-[#2D4A3E]'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Chính sách cửa hàng</span>
          </button>
          <button
            type="button"
            onClick={onSwitchToFaq}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
              mode === 'faq'
                ? 'bg-[#2D4A3E] text-white'
                : 'bg-white border border-[#D5D0C5] text-[#4A4740] hover:border-[#2D4A3E]'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Câu hỏi thường gặp (FAQ)</span>
          </button>
        </div>
      </div>

      {/* NỘI DUNG TRANG CHÍNH SÁCH */}
      {mode === 'policy' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-8 items-start">
          {/* Cột Trái: Danh mục 4 Chính sách */}
          <aside className="lg:col-span-4 bg-white rounded-2xl border border-[#EAE6DE] p-5 space-y-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#7A5C43]">
                Trung tâm hỗ trợ Baity
              </div>
              <h2 className="font-display text-lg font-bold text-[#1A1C19] mt-0.5">
                Danh mục Chính sách
              </h2>
            </div>

            <nav aria-label="Danh sách chính sách" className="space-y-1.5">
              {(policyList.length > 0
                ? policyList
                : [
                    { slug: 'return', title: 'Chính sách đổi trả & hoàn tiền', displayOrder: 1 },
                    { slug: 'shipping', title: 'Chính sách vận chuyển & giao nhận', displayOrder: 2 },
                    { slug: 'payment', title: 'Chính sách thanh toán & an toàn giao dịch', displayOrder: 3 },
                    { slug: 'privacy', title: 'Chính sách bảo mật thông tin', displayOrder: 4 },
                  ]
              ).map((item) => {
                const isSelected =
                  (policyDetail?.slug || activePolicySlug || 'return') === item.slug;
                return (
                  <button
                    key={item.slug}
                    type="button"
                    onClick={() => onSelectPolicySlug(item.slug)}
                    className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-colors ${
                      isSelected
                        ? 'bg-[#2D4A3E] text-white'
                        : 'text-[#3D3A34] hover:bg-[#F5F2EB]'
                    }`}
                  >
                    {getPolicyIcon(item.slug)}
                    <span className="line-clamp-2">{item.title}</span>
                  </button>
                );
              })}
            </nav>

            <div className="pt-3 border-t border-[#EAE6DE]">
              <button
                type="button"
                onClick={onSwitchToFaq}
                className="w-full px-3.5 py-2.5 bg-[#FAF8F5] hover:bg-[#F2EFE9] border border-[#E0DCD3] rounded-xl text-xs font-semibold text-[#2D4A3E] flex items-center justify-between transition-colors"
              >
                <span>Xem Câu hỏi thường gặp (FAQ)</span>
                <HelpCircle className="w-4 h-4 text-[#C27D56]" />
              </button>
            </div>
          </aside>

          {/* Cột Phải: Nội dung chi tiết Chính sách */}
          <div className="lg:col-span-8 bg-white rounded-2xl border border-[#EAE6DE] p-6 sm:p-8">
            {isPolicyLoading ? (
              <div data-testid="policy-loading" className="space-y-4 animate-pulse">
                <div className="h-7 bg-[#EFECE6] rounded w-2/3" />
                <div className="h-4 bg-[#EFECE6] rounded w-full" />
                <div className="h-4 bg-[#EFECE6] rounded w-5/6" />
                <div className="h-4 bg-[#EFECE6] rounded w-4/5" />
              </div>
            ) : policyError ? (
              <div
                data-testid="policy-error"
                className="text-center py-10 space-y-4"
              >
                <div className="w-12 h-12 rounded-full bg-[#FDF2F2] text-[#B91C1C] flex items-center justify-center mx-auto">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-display text-lg font-bold text-[#1A1C19]">
                    {isNotFound ? 'Không tìm thấy chính sách (404)' : 'Không thể tải chính sách'}
                  </h3>
                  <p className="text-xs text-[#6B665C] max-w-md mx-auto">{policyError}</p>
                </div>
                <div className="flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => onSelectPolicySlug('return')}
                    className="px-4 py-2 bg-[#2D4A3E] text-white text-xs font-semibold rounded-lg hover:bg-[#233B31]"
                  >
                    Về Chính sách đổi trả
                  </button>
                  {!isNotFound && (
                    <button
                      type="button"
                      onClick={() => fetchPolicyDetail(activePolicySlug || 'return')}
                      className="px-4 py-2 bg-white border border-[#D5D0C5] text-[#1A1C19] text-xs font-semibold rounded-lg hover:border-[#2D4A3E]"
                    >
                      Thử lại
                    </button>
                  )}
                </div>
              </div>
            ) : policyDetail ? (
              <article className="space-y-6">
                <header className="border-b border-[#EAE6DE] pb-4">
                  <div className="text-xs font-bold uppercase tracking-wider text-[#C27D56]">
                    Chính sách chính thức · Baity Fashion
                  </div>
                  <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1A1C19] mt-1">
                    {policyDetail.title}
                  </h1>
                </header>

                <SafeMarkdown
                  content={policyDetail.content}
                  onInternalLinkClick={handleInternalLink}
                />
              </article>
            ) : null}
          </div>
        </div>
      ) : (
        /* NỘI DUNG TRANG CÂU HỎI THƯỜNG GẶP (FAQ ACCORDION) */
        <div className="pt-8 space-y-8">
          <div className="bg-white rounded-2xl border border-[#EAE6DE] p-6 sm:p-8 space-y-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-[#C27D56]">
                  Giải đáp nhanh theo quy tắc hệ thống
                </div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#1A1C19] mt-1">
                  Câu Hỏi Thường Gặp (FAQ)
                </h1>
              </div>

              {/* Ô lọc nhanh câu hỏi */}
              <div className="relative w-full md:w-72">
                <input
                  type="search"
                  value={faqSearch}
                  onChange={(e) => setFaqSearch(e.target.value)}
                  placeholder="Tìm nhanh câu hỏi (VD: VietQR, đổi trả)..."
                  aria-label="Tìm kiếm câu hỏi thường gặp"
                  className="w-full pl-9 pr-4 py-2 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-xl text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E]"
                />
                <Search className="w-4 h-4 text-[#7A7569] absolute left-3 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            {/* Bộ chọn chủ đề FAQ */}
            {faqGroups.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#F0ECE1]">
                <button
                  type="button"
                  onClick={() => setActiveTopic('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    activeTopic === 'all'
                      ? 'bg-[#2D4A3E] text-white'
                      : 'bg-[#FAF8F5] text-[#4A4740] hover:bg-[#EFECE6]'
                  }`}
                >
                  Tất cả chủ đề
                </button>
                {faqGroups.map((g) => (
                  <button
                    key={g.topic}
                    type="button"
                    onClick={() => setActiveTopic(g.topic)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      activeTopic === g.topic
                        ? 'bg-[#2D4A3E] text-white'
                        : 'bg-[#FAF8F5] text-[#4A4740] hover:bg-[#EFECE6]'
                    }`}
                  >
                    {g.topic} ({g.items.length})
                  </button>
                ))}
              </div>
            )}
          </div>

          {isFaqLoading ? (
            <div data-testid="faq-loading" className="space-y-4">
              {[...Array(4)].map((_, idx) => (
                <div
                  key={idx}
                  className="bg-white rounded-2xl border border-[#EAE6DE] p-5 space-y-3 animate-pulse"
                >
                  <div className="h-5 bg-[#EFECE6] rounded w-1/3" />
                  <div className="h-4 bg-[#EFECE6] rounded w-3/4" />
                </div>
              ))}
            </div>
          ) : faqError ? (
            <div
              data-testid="faq-error"
              className="bg-white rounded-2xl border border-[#EAE6DE] p-8 text-center space-y-4"
            >
              <div className="w-12 h-12 rounded-full bg-[#FDF2F2] text-[#B91C1C] flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-display text-lg font-bold text-[#1A1C19]">
                  Không thể tải câu hỏi thường gặp
                </h3>
                <p className="text-xs text-[#6B665C]">{faqError}</p>
              </div>
              <button
                type="button"
                onClick={fetchFaqData}
                className="px-4 py-2 bg-[#2D4A3E] text-white text-xs font-semibold rounded-lg hover:bg-[#233B31]"
              >
                Thử lại
              </button>
            </div>
          ) : filteredFaqGroups.length > 0 ? (
            <div className="space-y-6">
              {filteredFaqGroups.map((group) => (
                <div
                  key={group.topic}
                  className="bg-white rounded-2xl border border-[#EAE6DE] p-6 space-y-4"
                >
                  <h2 className="font-display text-lg font-bold text-[#2D4A3E] border-b border-[#EAE6DE] pb-2.5">
                    {group.topic}
                  </h2>

                  <div className="divide-y divide-[#EAE6DE]">
                    {group.items.map((item, idx) => {
                      const qKey = `${group.topic}__${idx}`;
                      const isOpen = Boolean(openQuestionKeys[qKey]);
                      return (
                        <div
                          key={qKey}
                          data-testid="faq-accordion-item"
                          className="py-3.5 first:pt-1 last:pb-1"
                        >
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() => toggleAccordion(qKey)}
                            className="w-full flex items-center justify-between gap-4 text-left font-semibold text-sm text-[#1A1C19] hover:text-[#2D4A3E] transition-colors"
                          >
                            <span>{item.question}</span>
                            {isOpen ? (
                              <ChevronUp className="w-4 h-4 text-[#2D4A3E] shrink-0" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-[#7A7569] shrink-0" />
                            )}
                          </button>
                          {isOpen && (
                            <div className="mt-3 pt-3 border-t border-[#F5F2EB] text-xs text-[#4A4740]">
                              <SafeMarkdown
                                content={item.answer}
                                onInternalLinkClick={handleInternalLink}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-[#EAE6DE] p-8 text-center text-xs text-[#6B665C]">
              Không tìm thấy câu hỏi nào khớp với từ khóa "{faqSearch}".
            </div>
          )}
        </div>
      )}
    </section>
  );
};
