import React, { useState, useEffect, useCallback } from 'react';
import {
  Star,
  MessageSquare,
  Eye,
  EyeOff,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Filter,
  Send,
  ShieldAlert,
} from 'lucide-react';

export interface AdminReviewItem {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  orderId: string;
  rating: number;
  comment: string;
  sellerReply: string | null;
  sellerRepliedAt: string | null;
  isVisible: boolean;
  hiddenReason: string | null;
  createdAt: string;
  updatedAt: string;
  reviewerName: string;
  images: string[];
}

export interface ReviewsAdminPageProps {
  initialRepliedFilter?: 'all' | 'replied' | 'unreplied';
  initialVisibilityFilter?: 'all' | 'visible' | 'hidden';
  onDataChanged?: () => void;
}

export const ReviewsAdminPage: React.FC<ReviewsAdminPageProps> = ({
  initialRepliedFilter = 'all',
  initialVisibilityFilter = 'all',
  onDataChanged,
}) => {
  const [reviews, setReviews] = useState<AdminReviewItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [ratingFilter, setRatingFilter] = useState<string>('all');
  const [productFilter, setProductFilter] = useState<string>('all');
  const [repliedFilter, setRepliedFilter] = useState<'all' | 'replied' | 'unreplied'>(
    initialRepliedFilter
  );
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'visible' | 'hidden'>(
    initialVisibilityFilter
  );
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [total, setTotal] = useState<number>(0);
  const [summary, setSummary] = useState<{
    totalReviews: number;
    unrepliedVisibleReviews: number;
    hiddenReviews: number;
  }>({
    totalReviews: 0,
    unrepliedVisibleReviews: 0,
    hiddenReviews: 0,
  });

  const [productsList, setProductsList] = useState<Array<{ id: string; name: string }>>([]);

  // State cho phản hồi đánh giá
  const [replyingReviewId, setReplyingReviewId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<string>('');
  const [replySubmitting, setReplySubmitting] = useState<boolean>(false);

  // State cho ẩn/hiện đánh giá vi phạm
  const [visibilityTarget, setVisibilityTarget] = useState<{
    review: AdminReviewItem;
    nextVisible: boolean;
  } | null>(null);
  const [visibilityReason, setVisibilityReason] = useState<string>('');
  const [visibilitySubmitting, setVisibilitySubmitting] = useState<boolean>(false);

  useEffect(() => {
    setRepliedFilter(initialRepliedFilter);
  }, [initialRepliedFilter]);

  useEffect(() => {
    setVisibilityFilter(initialVisibilityFilter);
  }, [initialVisibilityFilter]);

  const fetchProductsList = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/products?limit=100', { credentials: 'include' });
      if (!res.ok) return;
      const body = await res.json();
      const items = Array.isArray(body.items) ? body.items : [];
      setProductsList(items.map((p: any) => ({ id: p.id, name: p.name })));
    } catch {
      // Bỏ qua lỗi danh sách sản phẩm phụ
    }
  }, []);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (ratingFilter !== 'all') params.set('rating', ratingFilter);
      if (productFilter !== 'all') params.set('productId', productFilter);
      params.set('replied', repliedFilter);
      params.set('visibility', visibilityFilter);
      params.set('page', String(page));
      params.set('limit', '15');

      const res = await fetch(`/api/admin/reviews?${params.toString()}`, {
        credentials: 'include',
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message || 'Không thể tải danh sách đánh giá');
      }

      setReviews(Array.isArray(body.items) ? body.items : []);
      setTotal(Number(body.total || 0));
      setTotalPages(Number(body.totalPages || 1));
      if (body.summary) {
        setSummary({
          totalReviews: Number(body.summary.totalReviews || 0),
          unrepliedVisibleReviews: Number(body.summary.unrepliedVisibleReviews || 0),
          hiddenReviews: Number(body.summary.hiddenReviews || 0),
        });
      }
    } catch (err: any) {
      setError(err.message || 'Lỗi kết nối máy chủ khi tải đánh giá');
    } finally {
      setLoading(false);
    }
  }, [ratingFilter, productFilter, repliedFilter, visibilityFilter, page]);

  useEffect(() => {
    fetchProductsList();
  }, [fetchProductsList]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  const handleOpenReply = (rv: AdminReviewItem) => {
    setReplyingReviewId(rv.id);
    setReplyText(rv.sellerReply || '');
    setError(null);
    setNotice(null);
  };

  const handleSubmitReply = async (reviewId: string) => {
    const trimmed = replyText.trim();
    if (trimmed.length < 2 || trimmed.length > 1000) {
      setError('Nội dung phản hồi phải từ 2 đến 1000 ký tự.');
      return;
    }
    setReplySubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/${reviewId}/reply`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sellerReply: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message || 'Lỗi lưu phản hồi đánh giá');
      }
      setNotice('Đã lưu phản hồi đánh giá thành công.');
      setReplyingReviewId(null);
      setReplyText('');
      await fetchReviews();
      onDataChanged?.();
    } catch (err: any) {
      setError(err.message || 'Không thể gửi phản hồi');
    } finally {
      setReplySubmitting(false);
    }
  };

  const handleConfirmVisibility = async () => {
    if (!visibilityTarget) return;
    const trimmedReason = visibilityReason.trim();
    if (trimmedReason.length < 2 || trimmedReason.length > 500) {
      setError('Vui lòng nhập lý do ẩn/hiện đánh giá (từ 2 đến 500 ký tự).');
      return;
    }
    setVisibilitySubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reviews/${visibilityTarget.review.id}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          isVisible: visibilityTarget.nextVisible,
          reason: trimmedReason,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message || 'Không thể cập nhật trạng thái hiển thị');
      }
      setNotice(
        visibilityTarget.nextVisible
          ? 'Đã hiển thị lại đánh giá trên trang sản phẩm.'
          : 'Đã ẩn đánh giá vi phạm và loại khỏi điểm trung bình sản phẩm.'
      );
      setVisibilityTarget(null);
      setVisibilityReason('');
      await fetchReviews();
      onDataChanged?.();
    } catch (err: any) {
      setError(err.message || 'Lỗi cập nhật trạng thái hiển thị đánh giá');
    } finally {
      setVisibilitySubmitting(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="admin-reviews-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E5E0D8] pb-4">
        <div>
          <h2 className="text-xl font-bold text-[#1A1C19]">
            Quản lý Đánh giá Sản phẩm & Phản hồi Khách hàng
          </h2>
          <p className="text-xs text-[#5C5F58] mt-1">
            Phản hồi nhận xét của khách mua hàng và ẩn đánh giá vi phạm tiêu chuẩn cộng đồng (không sửa nội dung/số sao của khách).
          </p>
        </div>
        <button
          type="button"
          onClick={fetchReviews}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#D5CFC4] bg-white text-xs font-medium text-[#1A1C19] hover:bg-[#F5F2EB]"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Làm mới
        </button>
      </div>

      {/* Thẻ tóm tắt nhanh */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#E5E0D8] rounded-xl p-4">
          <p className="text-xs text-[#5C5F58]">Tổng đánh giá hệ thống</p>
          <p className="text-2xl font-bold text-[#1A1C19] mt-1">{summary.totalReviews}</p>
        </div>
        <div className="bg-white border border-[#E5E0D8] rounded-xl p-4">
          <p className="text-xs text-[#5C5F58]">Đánh giá hiển thị chưa phản hồi</p>
          <p className="text-2xl font-bold text-[#9A3412] mt-1">{summary.unrepliedVisibleReviews}</p>
        </div>
        <div className="bg-white border border-[#E5E0D8] rounded-xl p-4">
          <p className="text-xs text-[#5C5F58]">Đánh giá đã ẩn do vi phạm</p>
          <p className="text-2xl font-bold text-[#5C5F58] mt-1">{summary.hiddenReviews}</p>
        </div>
      </div>

      {/* Bộ lọc */}
      <div className="bg-white border border-[#E5E0D8] rounded-xl p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#1A1C19] mb-3">
          <Filter className="w-4 h-4 text-[#2D4A3E]" />
          Bộ lọc đánh giá
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-[#5C5F58] mb-1">Số sao</label>
            <select
              value={ratingFilter}
              onChange={(e) => {
                setRatingFilter(e.target.value);
                setPage(1);
              }}
              data-testid="filter-review-rating"
              className="w-full px-3 py-2 text-xs border border-[#D5CFC4] rounded-lg bg-white text-[#1A1C19]"
            >
              <option value="all">Tất cả số sao (1–5 ★)</option>
              <option value="5">5 sao (★★★★★)</option>
              <option value="4">4 sao (★★★★☆)</option>
              <option value="3">3 sao (★★★☆☆)</option>
              <option value="2">2 sao (★★☆☆☆)</option>
              <option value="1">1 sao (★☆☆☆☆)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[#5C5F58] mb-1">Sản phẩm</label>
            <select
              value={productFilter}
              onChange={(e) => {
                setProductFilter(e.target.value);
                setPage(1);
              }}
              data-testid="filter-review-product"
              className="w-full px-3 py-2 text-xs border border-[#D5CFC4] rounded-lg bg-white text-[#1A1C19]"
            >
              <option value="all">Tất cả sản phẩm</option>
              {productsList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[#5C5F58] mb-1">
              Trạng thái phản hồi
            </label>
            <select
              value={repliedFilter}
              onChange={(e) => {
                setRepliedFilter(e.target.value as 'all' | 'replied' | 'unreplied');
                setPage(1);
              }}
              data-testid="filter-review-replied"
              className="w-full px-3 py-2 text-xs border border-[#D5CFC4] rounded-lg bg-white text-[#1A1C19]"
            >
              <option value="all">Tất cả</option>
              <option value="unreplied">Chưa phản hồi</option>
              <option value="replied">Đã phản hồi</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[#5C5F58] mb-1">
              Trạng thái hiển thị
            </label>
            <select
              value={visibilityFilter}
              onChange={(e) => {
                setVisibilityFilter(e.target.value as 'all' | 'visible' | 'hidden');
                setPage(1);
              }}
              data-testid="filter-review-visibility"
              className="w-full px-3 py-2 text-xs border border-[#D5CFC4] rounded-lg bg-white text-[#1A1C19]"
            >
              <option value="all">Tất cả (Hiển thị & Đã ẩn)</option>
              <option value="visible">Đang hiển thị trên cửa hàng</option>
              <option value="hidden">Đã ẩn do vi phạm</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Danh sách đánh giá */}
      {loading ? (
        <div className="bg-white border border-[#E5E0D8] rounded-xl p-8 text-center text-xs text-[#5C5F58]">
          Đang tải danh sách đánh giá sản phẩm...
        </div>
      ) : reviews.length === 0 ? (
        <div className="bg-white border border-[#E5E0D8] rounded-xl p-8 text-center text-xs text-[#5C5F58]">
          Không có đánh giá nào khớp với bộ lọc hiện tại.
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((rv) => (
            <div
              key={rv.id}
              data-testid={`admin-review-row-${rv.id}`}
              className={`bg-white border rounded-xl p-4 transition-colors ${
                rv.isVisible ? 'border-[#E5E0D8]' : 'border-amber-300 bg-amber-50/30'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-[#1A1C19]">{rv.productName}</span>
                    <span className="text-[11px] text-[#5C5F58] font-mono">
                      Đơn #{rv.orderId}
                    </span>
                    <span className="text-[11px] text-[#5C5F58]">· Khách: {rv.reviewerName}</span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
                        rv.isVisible
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-red-50 text-red-800 border border-red-200'
                      }`}
                    >
                      {rv.isVisible ? (
                        <>
                          <Eye className="w-3 h-3" /> Đang hiển thị
                        </>
                      ) : (
                        <>
                          <EyeOff className="w-3 h-3" /> Đã ẩn khỏi cửa hàng
                        </>
                      )}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 text-amber-500">
                    {Array.from({ length: 5 }).map((_, idx) => (
                      <Star
                        key={idx}
                        className={`w-3.5 h-3.5 ${
                          idx < rv.rating ? 'fill-amber-400 text-amber-500' : 'text-stone-300'
                        }`}
                      />
                    ))}
                    <span className="text-xs font-semibold text-[#1A1C19] ml-1">
                      {rv.rating}/5
                    </span>
                    <span className="text-[11px] text-[#5C5F58] ml-2">
                      {new Date(rv.createdAt).toLocaleString('vi-VN')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleOpenReply(rv)}
                    data-testid={`btn-reply-review-${rv.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2D4A3E] text-xs font-medium text-[#2D4A3E] hover:bg-[#2D4A3E] hover:text-white transition-colors"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    {rv.sellerReply ? 'Sửa phản hồi' : 'Phản hồi'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setVisibilityTarget({ review: rv, nextVisible: !rv.isVisible });
                      setVisibilityReason(rv.hiddenReason || '');
                      setError(null);
                    }}
                    data-testid={`btn-toggle-visibility-${rv.id}`}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      rv.isVisible
                        ? 'border-red-300 text-red-700 hover:bg-red-50'
                        : 'border-emerald-300 text-emerald-800 hover:bg-emerald-50'
                    }`}
                  >
                    {rv.isVisible ? (
                      <>
                        <EyeOff className="w-3.5 h-3.5" />
                        Ẩn vi phạm
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5" />
                        Hiển thị lại
                      </>
                    )}
                  </button>
                </div>
              </div>

              <p className="mt-2.5 text-sm text-[#1A1C19] whitespace-pre-line">{rv.comment}</p>

              {!rv.isVisible && rv.hiddenReason && (
                <div className="mt-2.5 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900 flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-red-700" />
                  <div>
                    <span className="font-semibold">Lý do ẩn đánh giá: </span>
                    <span>{rv.hiddenReason}</span>
                  </div>
                </div>
              )}

              {rv.sellerReply && replyingReviewId !== rv.id && (
                <div className="mt-3 p-3 rounded-lg bg-[#F5F2EB] border border-[#E5E0D8] text-xs">
                  <div className="font-semibold text-[#2D4A3E] mb-1">
                    Phản hồi của Baity Fashion
                    {rv.sellerRepliedAt && (
                      <span className="font-normal text-[#5C5F58] ml-2">
                        ({new Date(rv.sellerRepliedAt).toLocaleString('vi-VN')})
                      </span>
                    )}
                  </div>
                  <p className="text-[#1A1C19] whitespace-pre-line">{rv.sellerReply}</p>
                </div>
              )}

              {replyingReviewId === rv.id && (
                <div className="mt-3 p-3.5 rounded-xl bg-[#FAF8F5] border border-[#D5CFC4] space-y-2.5">
                  <label className="block text-xs font-semibold text-[#1A1C19]">
                    Nội dung phản hồi khách hàng (văn bản thuần, tối đa 1.000 ký tự)
                  </label>
                  <textarea
                    rows={3}
                    maxLength={1000}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Nhập phản hồi lịch sự, rõ ràng từ cửa hàng..."
                    className="w-full p-2.5 text-xs border border-[#D5CFC4] rounded-lg bg-white text-[#1A1C19]"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#5C5F58]">{replyText.length}/1000 ký tự</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setReplyingReviewId(null);
                          setReplyText('');
                        }}
                        className="px-3 py-1.5 rounded-lg border border-[#D5CFC4] bg-white text-xs text-[#5C5F58]"
                      >
                        Hủy
                      </button>
                      <button
                        type="button"
                        disabled={replySubmitting}
                        onClick={() => handleSubmitReply(rv.id)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#2D4A3E] text-white text-xs font-medium hover:bg-[#22382F] disabled:opacity-50"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {replySubmitting ? 'Đang lưu...' : 'Gửi phản hồi'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Phân trang */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-[#5C5F58]">
            Tổng cộng {total} đánh giá · Trang {page}/{totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-lg border border-[#D5CFC4] bg-white text-xs disabled:opacity-40"
            >
              Trang trước
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1.5 rounded-lg border border-[#D5CFC4] bg-white text-xs disabled:opacity-40"
            >
              Trang sau
            </button>
          </div>
        </div>
      )}

      {/* Hộp thoại xác nhận ẩn/hiện kèm lý do */}
      {visibilityTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl border border-[#E5E0D8] max-w-md w-full p-5 space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-[#1A1C19]">
              {visibilityTarget.nextVisible
                ? 'Hiển thị lại đánh giá trên cửa hàng'
                : 'Ẩn đánh giá vi phạm khỏi cửa hàng'}
            </h3>
            <p className="text-xs text-[#5C5F58]">
              {visibilityTarget.nextVisible
                ? 'Đánh giá này sẽ xuất hiện trở lại trên trang chi tiết sản phẩm và được tính vào điểm đánh giá trung bình.'
                : 'Đánh giá bị ẩn sẽ không hiển thị ngoài cửa hàng và không tính vào điểm trung bình sản phẩm. Thao tác được ghi vào nhật ký kiểm toán.'}
            </p>
            <div>
              <label className="block text-xs font-semibold text-[#1A1C19] mb-1">
                Lý do thực hiện (bắt buộc, 2–500 ký tự)
              </label>
              <textarea
                rows={3}
                maxLength={500}
                value={visibilityReason}
                onChange={(e) => setVisibilityReason(e.target.value)}
                placeholder={
                  visibilityTarget.nextVisible
                    ? 'Ví dụ: Đã đối soát lại với khách hàng, nội dung hợp lệ...'
                    : 'Ví dụ: Ngôn từ không phù hợp / spam quảng cáo ngoài sản phẩm...'
                }
                className="w-full p-2.5 text-xs border border-[#D5CFC4] rounded-lg bg-white text-[#1A1C19]"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setVisibilityTarget(null);
                  setVisibilityReason('');
                }}
                className="px-3.5 py-2 rounded-lg border border-[#D5CFC4] text-xs font-medium text-[#5C5F58]"
              >
                Đóng
              </button>
              <button
                type="button"
                disabled={visibilitySubmitting}
                onClick={handleConfirmVisibility}
                data-testid="confirm-review-visibility-btn"
                className={`px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 ${
                  visibilityTarget.nextVisible
                    ? 'bg-[#2D4A3E] hover:bg-[#22382F]'
                    : 'bg-red-700 hover:bg-red-800'
                }`}
              >
                {visibilitySubmitting ? 'Đang xử lý...' : 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
