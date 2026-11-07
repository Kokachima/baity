import React, { useState, useEffect } from 'react';
import {
  Star,
  Camera,
  Send,
  X,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import type { ProductDetail, User } from '../../types/index.ts';

export interface ReviewSectionProps {
  product: ProductDetail;
  currentUser?: User | null;
}

export const ReviewSection: React.FC<ReviewSectionProps> = ({ product, currentUser }) => {
  const [reviewsList, setReviewsList] = useState<any[]>(
    Array.isArray(product.reviews) ? product.reviews : []
  );
  const [reviewsRatingAvg, setReviewsRatingAvg] = useState<number>(Number(product.ratingAvg || 0));
  const [reviewsTotalCount, setReviewsTotalCount] = useState<number>(
    Number(product.reviewCount || 0)
  );
  const [ratingBreakdown, setRatingBreakdown] = useState<Record<number, number>>({
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  });
  const [ratingFilter, setRatingFilter] = useState<number | null>(null);
  const [reviewSort, setReviewSort] = useState<'newest' | 'rating_desc' | 'rating_asc'>('newest');
  const [reviewsPage, setReviewsPage] = useState<number>(1);
  const [reviewsTotalPages, setReviewsTotalPages] = useState<number>(0);
  const [isLoadingReviews, setIsLoadingReviews] = useState<boolean>(false);
  const [reviewsLoadError, setReviewsLoadError] = useState<string | null>(null);
  const [reviewsReloadTick, setReviewsReloadTick] = useState<number>(0);

  const [eligibleOrders, setEligibleOrders] = useState<{ orderId: string; status: string }[]>([]);
  const [showWriteReviewForm, setShowWriteReviewForm] = useState<boolean>(false);
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [newRating, setNewRating] = useState<number>(5);
  const [newComment, setNewComment] = useState<string>('');
  const [uploadedReviewImages, setUploadedReviewImages] = useState<
    { path: string; previewUrl: string }[]
  >([]);
  const [isUploadingImage, setIsUploadingImage] = useState<boolean>(false);
  const [isSubmittingReview, setIsSubmittingReview] = useState<boolean>(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);

  // Đồng bộ giá trị khởi tạo khi chuyển sang sản phẩm khác
  useEffect(() => {
    setReviewsList(Array.isArray(product.reviews) ? product.reviews : []);
    setReviewsRatingAvg(Number(product.ratingAvg || 0));
    setReviewsTotalCount(Number(product.reviewCount || 0));
    setRatingFilter(null);
    setReviewSort('newest');
    setReviewsPage(1);
    setShowWriteReviewForm(false);
    setEditingReviewId(null);
    setReviewError(null);
    setReviewSuccess(null);
  }, [product.id]);

  // Tải danh sách đánh giá (phân trang, lọc theo sao, sắp xếp, phân bố sao) từ GET /api/products/:slug/reviews
  useEffect(() => {
    if (!product?.slug) return;
    let isMounted = true;
    setIsLoadingReviews(true);
    setReviewsLoadError(null);

    const qs = new URLSearchParams({
      page: String(reviewsPage),
      pageSize: '6',
      sort: reviewSort,
    });
    if (ratingFilter) {
      qs.set('rating', String(ratingFilter));
    }

    apiRequest(`/api/products/${encodeURIComponent(product.slug)}/reviews?${qs.toString()}`)
      .then((res) => {
        if (!isMounted) return;
        if (!res.ok || !res.data?.success) {
          setReviewsLoadError(res.errorMessage || 'Không thể tải danh sách đánh giá');
          return;
        }
        const data = res.data.data || res.data;
        if (Array.isArray(data.items)) {
          setReviewsList(data.items);
        }
        if (typeof data.ratingAvg === 'number') {
          setReviewsRatingAvg(data.ratingAvg);
        }
        if (typeof data.reviewCount === 'number') {
          setReviewsTotalCount(data.reviewCount);
        }
        if (data.ratingBreakdown) {
          setRatingBreakdown({
            1: Number(data.ratingBreakdown[1] || 0),
            2: Number(data.ratingBreakdown[2] || 0),
            3: Number(data.ratingBreakdown[3] || 0),
            4: Number(data.ratingBreakdown[4] || 0),
            5: Number(data.ratingBreakdown[5] || 0),
          });
        }
        setReviewsTotalPages(Number(data.totalPages || 0));
        if (Array.isArray(data.eligibleOrders)) {
          setEligibleOrders(data.eligibleOrders);
          setSelectedOrderId((prev) => prev || data.eligibleOrders[0]?.orderId || '');
        } else {
          setEligibleOrders([]);
        }
      })
      .catch(() => {
        if (isMounted) {
          setReviewsLoadError('Lỗi kết nối khi tải danh sách đánh giá sản phẩm');
        }
      })
      .finally(() => {
        if (isMounted) setIsLoadingReviews(false);
      });

    return () => {
      isMounted = false;
    };
  }, [product?.slug, ratingFilter, reviewSort, reviewsPage, currentUser?.id, reviewsReloadTick]);

  // Tải ảnh đánh giá lên /api/upload (tối đa 3 ảnh, server tái mã hóa xóa EXIF và lưu path ngẫu nhiên không chứa userId)
  const handleUploadReviewImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (uploadedReviewImages.length >= 3) {
      setReviewError('Mỗi đánh giá chỉ đính kèm tối đa 3 hình ảnh');
      return;
    }
    setReviewError(null);
    setIsUploadingImage(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Lỗi đọc file'));
        reader.readAsDataURL(file);
      });

      const res = await apiRequest('/api/upload', {
        method: 'POST',
        body: JSON.stringify({ image: dataUrl, purpose: 'review' }),
      });

      if (!res.ok || !res.data?.path) {
        setReviewError(res.errorMessage || 'Không thể tải ảnh đánh giá lên');
        return;
      }

      setUploadedReviewImages((prev) => [
        ...prev,
        {
          path: res.data.path,
          previewUrl: res.data.url || dataUrl,
        },
      ]);
    } catch {
      setReviewError('Lỗi kết nối khi tải ảnh đánh giá');
    } finally {
      setIsUploadingImage(false);
      e.target.value = '';
    }
  };

  // Gửi đánh giá mới (POST /api/reviews) hoặc cập nhật đánh giá chính chủ (PUT /api/reviews/:id)
  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;
    setReviewError(null);
    setReviewSuccess(null);

    const trimmedComment = newComment.trim();
    if (trimmedComment.length < 2) {
      setReviewError('Nội dung nhận xét phải có ít nhất 2 ký tự');
      return;
    }

    if (uploadedReviewImages.length > 3) {
      setReviewError('Mỗi đánh giá chỉ đính kèm tối đa 3 hình ảnh');
      return;
    }

    setIsSubmittingReview(true);
    try {
      if (editingReviewId) {
        const res = await apiRequest(`/api/reviews/${encodeURIComponent(editingReviewId)}`, {
          method: 'PUT',
          body: JSON.stringify({
            rating: newRating,
            comment: trimmedComment,
            imageUrls: uploadedReviewImages.map((img) => img.path),
          }),
        });

        if (!res.ok) {
          setReviewError(res.errorMessage || 'Không thể cập nhật đánh giá');
          return;
        }

        setEditingReviewId(null);
        setShowWriteReviewForm(false);
        setNewComment('');
        setUploadedReviewImages([]);
        setReviewSuccess('Đã cập nhật đánh giá của bạn thành công!');
        setReviewsReloadTick((t) => t + 1);
        return;
      }

      const res = await apiRequest('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({
          productId: product.id,
          orderId: selectedOrderId || undefined,
          rating: newRating,
          comment: trimmedComment,
          imageUrls: uploadedReviewImages.map((img) => img.path),
        }),
      });

      if (!res.ok) {
        setReviewError(res.errorMessage || 'Không thể gửi đánh giá');
        return;
      }

      setNewComment('');
      setUploadedReviewImages([]);
      setShowWriteReviewForm(false);
      setReviewSuccess('Cảm ơn bạn đã gửi đánh giá sản phẩm!');
      setReviewsPage(1);
      setReviewsReloadTick((t) => t + 1);
    } catch {
      setReviewError('Lỗi kết nối khi gửi đánh giá');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  // Bắt đầu sửa đánh giá của chính mình
  const handleStartEditReview = (rv: any) => {
    setReviewError(null);
    setReviewSuccess(null);
    setEditingReviewId(rv.id);
    setNewRating(Number(rv.rating) || 5);
    setNewComment(String(rv.comment || ''));
    setUploadedReviewImages(
      Array.isArray(rv.images)
        ? rv.images.slice(0, 3).map((p: string) => ({ path: p, previewUrl: p }))
        : []
    );
    setShowWriteReviewForm(true);
  };

  // Xóa đánh giá của chính mình (DELETE /api/reviews/:id)
  const handleDeleteReview = async (reviewId: string) => {
    setReviewError(null);
    setReviewSuccess(null);
    const res = await apiRequest(`/api/reviews/${encodeURIComponent(reviewId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      setReviewError(res.errorMessage || 'Không thể xóa đánh giá');
      return;
    }
    if (editingReviewId === reviewId) {
      setEditingReviewId(null);
      setShowWriteReviewForm(false);
    }
    setReviewSuccess('Đã xóa đánh giá của bạn thành công.');
    setReviewsReloadTick((t) => t + 1);
  };

  return (
    <section
      data-testid="product-reviews-section"
      className="border-t border-[#E8E4DA] pt-12 space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-[#1A1C19]">
            Đánh Giá Từ Khách Hàng ({reviewsTotalCount})
          </h2>
          <p className="text-xs text-[#6B665C] mt-0.5">
            Nhận xét xác thực từ khách hàng đã mua và nhận hàng thành công
          </p>
        </div>

        {/* Nút "Viết đánh giá" CHỈ HIỆN KHI ĐỦ ĐIỀU KIỆN (đã mua sản phẩm trong đơn delivered / completed chưa đánh giá) */}
        {currentUser && eligibleOrders.length > 0 && !editingReviewId && (
          <button
            type="button"
            data-testid="btn-write-review"
            onClick={() => {
              setReviewError(null);
              setReviewSuccess(null);
              setShowWriteReviewForm((prev) => !prev);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#2D4A3E] text-white text-xs font-bold rounded-lg hover:bg-[#233B31] transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>{showWriteReviewForm ? 'Đóng biểu mẫu' : 'Viết đánh giá'}</span>
          </button>
        )}
      </div>

      {/* Khối tổng quan điểm trung bình & biểu đồ phân bố 5..1 sao */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 p-5 bg-white rounded-xl border border-[#EAE6DE] items-center">
        <div className="md:col-span-4 flex flex-col items-center justify-center text-center border-b md:border-b-0 md:border-r border-[#EAE6DE] pb-4 md:pb-0 md:pr-6">
          <div className="text-3xl font-extrabold text-[#1A1C19] tabular-nums">
            {reviewsRatingAvg.toFixed(1)}{' '}
            <span className="text-base font-normal text-[#7A7569]">/ 5.0</span>
          </div>
          <div className="flex items-center gap-1 my-1.5">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={`w-4 h-4 ${
                  star <= Math.round(reviewsRatingAvg)
                    ? 'fill-[#D99B26] text-[#D99B26]'
                    : 'text-[#D5D0C5]'
                }`}
              />
            ))}
          </div>
          <div className="text-xs text-[#6B665C]">{reviewsTotalCount} đánh giá xác thực</div>
        </div>

        {/* Biểu đồ phân bố từng sao */}
        <div className="md:col-span-8 space-y-2">
          {[5, 4, 3, 2, 1].map((star) => {
            const count = Number(ratingBreakdown[star] || 0);
            const percent =
              reviewsTotalCount > 0 ? Math.round((count / reviewsTotalCount) * 100) : 0;
            return (
              <div key={star} className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setRatingFilter(ratingFilter === star ? null : star);
                    setReviewsPage(1);
                  }}
                  className="w-14 flex items-center gap-1 font-medium text-[#4A4740] hover:text-[#2D4A3E]"
                >
                  <span>{star}</span>
                  <Star className="w-3 h-3 fill-[#D99B26] text-[#D99B26]" />
                </button>
                <div className="flex-1 h-2 bg-[#F0ECE1] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#D99B26] rounded-full transition-all"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <span className="w-16 text-right text-[11px] text-[#7A7569] tabular-nums">
                  {count} ({percent}%)
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bộ lọc theo số sao & Sắp xếp (mới nhất, sao cao, sao thấp) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setRatingFilter(null);
              setReviewsPage(1);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              ratingFilter === null
                ? 'bg-[#2D4A3E] text-white border-[#2D4A3E]'
                : 'bg-white text-[#5C584F] border-[#E0DCD3] hover:border-[#2D4A3E]'
            }`}
          >
            Tất cả ({reviewsTotalCount})
          </button>
          {[5, 4, 3, 2, 1].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => {
                setRatingFilter(star);
                setReviewsPage(1);
              }}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1 ${
                ratingFilter === star
                  ? 'bg-[#2D4A3E] text-white border-[#2D4A3E]'
                  : 'bg-white text-[#5C584F] border-[#E0DCD3] hover:border-[#2D4A3E]'
              }`}
            >
              <span>{star}</span>
              <Star className="w-3 h-3 fill-[#D99B26] text-[#D99B26]" />
              <span className="text-[10px] opacity-80">({ratingBreakdown[star] || 0})</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-[#6B665C]">Sắp xếp:</span>
          <select
            aria-label="Sắp xếp đánh giá"
            value={reviewSort}
            onChange={(e) => {
              setReviewSort(e.target.value as 'newest' | 'rating_desc' | 'rating_asc');
              setReviewsPage(1);
            }}
            className="px-3 py-1.5 rounded-lg border border-[#D5D0C5] bg-white text-xs text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E]"
          >
            <option value="newest">Mới nhất</option>
            <option value="rating_desc">Sao cao nhất</option>
            <option value="rating_asc">Sao thấp nhất</option>
          </select>
        </div>
      </div>

      {reviewError && !showWriteReviewForm && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          {reviewError}
        </div>
      )}
      {reviewSuccess && (
        <div className="p-3 rounded-lg bg-[#EEF4F0] border border-[#2D4A3E]/20 text-xs text-[#2D4A3E]">
          {reviewSuccess}
        </div>
      )}

      {/* Form viết hoặc sửa đánh giá: chỉ hiện khi đủ điều kiện bấm "Viết đánh giá" hoặc khi chủ đánh giá bấm "Sửa" */}
      {currentUser &&
        (showWriteReviewForm || editingReviewId) &&
        (eligibleOrders.length > 0 || editingReviewId) && (
          <form
            onSubmit={handleSubmitReview}
            className="p-5 bg-white rounded-xl border border-[#EAE6DE] space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-[#2D4A3E] uppercase tracking-wider">
                {editingReviewId
                  ? 'Chỉnh sửa đánh giá của bạn'
                  : 'Viết đánh giá từ đơn hàng đã nhận'}
              </div>
              {!editingReviewId &&
                (eligibleOrders.length > 1 ? (
                  <select
                    value={selectedOrderId}
                    onChange={(e) => setSelectedOrderId(e.target.value)}
                    className="text-xs px-2.5 py-1.5 border border-[#D5D0C5] rounded-lg bg-[#FAF8F5]"
                  >
                    {eligibleOrders.map((o) => (
                      <option key={o.orderId} value={o.orderId}>
                        Đơn hàng #{o.orderId}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-[#6B665C]">
                    Đơn hàng: <strong>#{eligibleOrders[0]?.orderId}</strong>
                  </span>
                ))}
            </div>

            {reviewError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {reviewError}
              </div>
            )}

            <div className="flex items-center gap-3">
              <span className="text-xs text-[#5C584F]">Chất lượng sản phẩm:</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setNewRating(star)}
                    className="p-0.5"
                    aria-label={`${star} sao`}
                  >
                    <Star
                      className={`w-5 h-5 ${
                        star <= newRating ? 'fill-[#D99B26] text-[#D99B26]' : 'text-[#D5D0C5]'
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <textarea
                rows={3}
                maxLength={1000}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Chia sẻ cảm nhận thực tế của bạn về chất liệu, phom dáng sản phẩm..."
                className="w-full p-3 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg focus:outline-none focus:border-[#2D4A3E]"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D5D0C5] bg-[#FAF8F5] text-xs font-medium text-[#4A4740] hover:border-[#2D4A3E]">
                  <Camera className="w-3.5 h-3.5 text-[#2D4A3E]" />
                  <span>
                    {isUploadingImage
                      ? 'Đang tải ảnh...'
                      : `Thêm ảnh thực tế (${uploadedReviewImages.length}/3)`}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={isUploadingImage || uploadedReviewImages.length >= 3}
                    onChange={handleUploadReviewImage}
                    className="hidden"
                  />
                </label>
                {uploadedReviewImages.map((img, i) => (
                  <div
                    key={img.path}
                    className="relative w-10 h-10 rounded-lg overflow-hidden border border-[#D5D0C5]"
                  >
                    <img
                      src={img.previewUrl}
                      alt={`Ảnh ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setUploadedReviewImages((prev) =>
                          prev.filter((item) => item.path !== img.path)
                        )
                      }
                      className="absolute top-0 right-0 bg-black/60 text-white p-0.5"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                {editingReviewId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingReviewId(null);
                      setShowWriteReviewForm(false);
                      setNewComment('');
                      setUploadedReviewImages([]);
                    }}
                    className="px-3 py-2 text-xs font-medium text-[#5C584F] border border-[#D5D0C5] rounded-lg hover:bg-[#FAF8F5]"
                  >
                    Hủy
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSubmittingReview}
                  className="inline-flex items-center gap-1.5 px-5 py-2 bg-[#2D4A3E] text-white text-xs font-bold rounded-lg hover:bg-[#233B31] transition-colors disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {isSubmittingReview
                      ? 'Đang lưu...'
                      : editingReviewId
                      ? 'Lưu thay đổi'
                      : 'Gửi đánh giá'}
                  </span>
                </button>
              </div>
            </div>
          </form>
        )}

      {/* Trạng thái Loading / Lỗi / Rỗng / Danh sách đánh giá có phân trang */}
      {isLoadingReviews ? (
        <div className="p-8 bg-white rounded-xl border border-[#EAE6DE] text-center text-xs text-[#6B665C]">
          Đang tải danh sách đánh giá sản phẩm...
        </div>
      ) : reviewsLoadError ? (
        <div className="p-6 bg-red-50 rounded-xl border border-red-200 text-center space-y-2">
          <div className="text-xs font-semibold text-red-700">{reviewsLoadError}</div>
          <button
            type="button"
            onClick={() => setReviewsReloadTick((t) => t + 1)}
            className="px-3 py-1.5 bg-white border border-red-300 rounded-lg text-xs text-red-700 font-medium hover:bg-red-100"
          >
            Thử lại
          </button>
        </div>
      ) : reviewsList && reviewsList.length > 0 ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reviewsList.map((rv) => (
              <div
                key={rv.id}
                className="p-5 bg-white rounded-xl border border-[#EAE6DE] space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-[#1A1C19]">{rv.userName}</span>
                      {rv.verifiedPurchase !== false && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#EEF4F0] text-[#2D4A3E] text-[10px] font-semibold">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Đã mua hàng</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5">
                      {[...Array(5)].map((_, idx) => (
                        <Star
                          key={idx}
                          className={`w-3.5 h-3.5 ${
                            idx < rv.rating
                              ? 'fill-[#D99B26] text-[#D99B26]'
                              : 'text-[#D5D0C5]'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Nút Sửa / Xóa chỉ hiển thị cho chính chủ đánh giá */}
                  {rv.isOwner && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleStartEditReview(rv)}
                        className="p-1.5 text-[#5C584F] hover:text-[#2D4A3E] rounded border border-[#E5E0D5]"
                        title="Chỉnh sửa đánh giá"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteReview(rv.id)}
                        className="p-1.5 text-[#5C584F] hover:text-red-600 rounded border border-[#E5E0D5]"
                        title="Xóa đánh giá"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Hiển thị văn bản thuần (plain text), tuyệt đối không render HTML */}
                <p className="text-xs text-[#4A4740] leading-relaxed whitespace-pre-line">
                  {rv.comment}
                </p>

                {Array.isArray(rv.images) && rv.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {rv.images.map((imgPath: string, idx: number) => (
                      <span
                        key={`${rv.id}-img-${idx}`}
                        className="px-2 py-1 rounded bg-[#F5F2EB] border border-[#E2DDD2] text-[10px] text-[#5C584F] font-mono"
                      >
                        {imgPath}
                      </span>
                    ))}
                  </div>
                )}

                {rv.sellerReply && (
                  <div className="p-3 bg-[#FAF8F5] rounded-lg border-l-2 border-[#2D4A3E] text-[11px] text-[#5C584F]">
                    <strong className="text-[#2D4A3E]">Phản hồi từ Baity Fashion:</strong>{' '}
                    {rv.sellerReply}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Phân trang danh sách đánh giá */}
          {reviewsTotalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                disabled={reviewsPage <= 1}
                onClick={() => setReviewsPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#D5D0C5] bg-white text-xs font-medium text-[#1A1C19] disabled:opacity-40"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Trang trước</span>
              </button>
              <span className="text-xs text-[#5C584F] tabular-nums">
                Trang {reviewsPage} / {reviewsTotalPages}
              </span>
              <button
                type="button"
                disabled={reviewsPage >= reviewsTotalPages}
                onClick={() => setReviewsPage((p) => Math.min(reviewsTotalPages, p + 1))}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#D5D0C5] bg-white text-xs font-medium text-[#1A1C19] disabled:opacity-40"
              >
                <span>Trang sau</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="p-8 bg-white rounded-xl border border-[#EAE6DE] text-center text-xs text-[#7A7569]">
          Sản phẩm hiện chưa có nhận xét nào phù hợp bộ lọc. Hãy là người đầu tiên sở hữu và đánh giá
          sản phẩm này!
        </div>
      )}
    </section>
  );
};
