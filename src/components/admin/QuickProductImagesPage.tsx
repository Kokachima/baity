import React, { useEffect, useState, useRef } from 'react';
import {
  Search,
  Upload,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Image as ImageIcon,
  X,
  Layers,
} from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';

export type QuickImageStatus =
  | 'OK'
  | 'CHƯA_CÓ_ẢNH_THẬT'
  | 'MÀU_LỆCH'
  | 'LOẠI_LỆCH'
  | 'HỎNG'
  | 'DÙNG_CHUNG';

export interface QuickProductImageItem {
  id: string;
  name: string;
  slug: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  targetGender: string;
  isActive: boolean;
  updatedAt: string;
  primaryVariantColor: string;
  primaryImageUrl: string | null;
  imageCount: number;
  sharedPrimaryUrlCount: number;
  status: QuickImageStatus;
  recognizedCategory: string | null;
  recognizedColors: string[];
  variantColorFamilies: string[];
  recognizedColorFamilies: string[];
}

interface BatchPairPreview {
  file: File;
  previewDataUrl: string;
  product: QuickProductImageItem;
}

interface QuickProductImagesPageProps {
  onShowToast?: (msg: string) => void;
}

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function resolveDisplayImageUrl(rawUrl: string | null): string {
  if (!rawUrl) return '';
  if (
    rawUrl.startsWith('http://') ||
    rawUrl.startsWith('https://') ||
    rawUrl.startsWith('data:') ||
    rawUrl.startsWith('/')
  ) {
    return rawUrl;
  }
  return `/api/upload/public/${rawUrl}`;
}

function getStatusBadgeStyle(status: QuickImageStatus): string {
  switch (status) {
    case 'OK':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'CHƯA_CÓ_ẢNH_THẬT':
      return 'bg-sky-50 text-sky-800 border-sky-200';
    case 'MÀU_LỆCH':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'LOẠI_LỆCH':
      return 'bg-orange-50 text-orange-800 border-orange-200';
    case 'HỎNG':
      return 'bg-red-50 text-red-800 border-red-200';
    case 'DÙNG_CHUNG':
      return 'bg-purple-50 text-purple-800 border-purple-200';
    default:
      return 'bg-stone-100 text-stone-700 border-stone-200';
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Không thể đọc tệp "${file.name}"`));
    reader.readAsDataURL(file);
  });
}

export const QuickProductImagesPage: React.FC<QuickProductImagesPageProps> = ({
  onShowToast,
}) => {
  const [items, setItems] = useState<QuickProductImageItem[]>([]);
  const [categories, setCategories] = useState<
    Array<{ id: string; name: string; slug: string }>
  >([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({
    ALL: 0,
    OK: 0,
    CHƯA_CÓ_ẢNH_THẬT: 0,
    MÀU_LỆCH: 0,
    LOẠI_LỆCH: 0,
    HỎNG: 0,
    DÙNG_CHUNG: 0,
  });

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const [uploadingProductId, setUploadingProductId] = useState<string | null>(null);
  const [rowFeedback, setRowFeedback] = useState<
    Record<string, { type: 'success' | 'error'; message: string }>
  >({});

  // Chế độ chọn nhiều file có bước xem trước cặp (file -> sản phẩm)
  const [batchPairs, setBatchPairs] = useState<BatchPairPreview[]>([]);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchProgressText, setBatchProgressText] = useState<string | null>(null);
  const batchInputRef = useRef<HTMLInputElement | null>(null);

  const loadQuickImages = async () => {
    setLoading(true);
    setPageError(null);
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (categoryFilter !== 'all') params.set('categorySlug', categoryFilter);
    if (statusFilter !== 'ALL') params.set('status', statusFilter);

    const res = await apiRequest(`/api/admin/products/quick-images?${params.toString()}`);
    setLoading(false);

    if (!res.ok) {
      setPageError(res.errorMessage || 'Không thể tải danh sách ảnh sản phẩm nhanh');
      return;
    }

    setItems(Array.isArray(res.data?.items) ? res.data.items : []);
    if (Array.isArray(res.data?.categories)) {
      setCategories(res.data.categories);
    }
    if (res.data?.statusCounts && typeof res.data.statusCounts === 'object') {
      setStatusCounts(res.data.statusCounts);
    }
  };

  useEffect(() => {
    loadQuickImages();
  }, [categoryFilter, statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadQuickImages();
  };

  const validateSelectedFile = (file: File): string | null => {
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return `Tệp "${file.name}" không đúng định dạng (chỉ chấp nhận JPG, PNG, WEBP).`;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `Tệp "${file.name}" vượt quá dung lượng tối đa 5MB.`;
    }
    return null;
  };

  const uploadAndSetPrimaryImage = async (
    product: QuickProductImageItem,
    file: File,
    preloadedDataUrl?: string
  ): Promise<{ ok: boolean; message: string }> => {
    const fileError = validateSelectedFile(file);
    if (fileError) {
      return { ok: false, message: fileError };
    }

    const dataUrl = preloadedDataUrl || (await readFileAsDataUrl(file));
    const uploadRes = await apiRequest('/api/upload', {
      method: 'POST',
      body: JSON.stringify({
        image: dataUrl,
        purpose: 'product',
      }),
    });

    if (!uploadRes.ok || !uploadRes.data?.path) {
      return {
        ok: false,
        message: uploadRes.errorMessage || 'Không thể tải ảnh lên kho lưu trữ',
      };
    }

    const objectPath = String(uploadRes.data.path);
    const updateRes = await apiRequest(
      `/api/admin/products/${encodeURIComponent(product.id)}/primary-image`,
      {
        method: 'PUT',
        body: JSON.stringify({
          imageUrl: objectPath,
          objectPath,
          expectedUpdatedAt: product.updatedAt,
        }),
      }
    );

    if (!updateRes.ok) {
      return {
        ok: false,
        message: updateRes.errorMessage || 'Không thể cập nhật ảnh chính sản phẩm',
      };
    }

    return {
      ok: true,
      message: `Đã thay ảnh chính cho "${product.name}" (${objectPath})`,
    };
  };

  const handleSingleFileChange = async (
    product: QuickProductImageItem,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploadingProductId(product.id);
    setSuccessBanner(null);
    setRowFeedback((prev) => {
      const next = { ...prev };
      delete next[product.id];
      return next;
    });

    try {
      const result = await uploadAndSetPrimaryImage(product, file);
      if (!result.ok) {
        setRowFeedback((prev) => ({
          ...prev,
          [product.id]: { type: 'error', message: result.message },
        }));
        onShowToast?.(result.message);
      } else {
        setRowFeedback((prev) => ({
          ...prev,
          [product.id]: { type: 'success', message: 'Đã thay ảnh chính thành công' },
        }));
        setSuccessBanner(result.message);
        onShowToast?.('Đã thay ảnh chính thành công');
        await loadQuickImages();
      }
    } catch (err: any) {
      const msg = err?.message || 'Lỗi khi thay ảnh chính';
      setRowFeedback((prev) => ({
        ...prev,
        [product.id]: { type: 'error', message: msg },
      }));
    } finally {
      setUploadingProductId(null);
    }
  };

  const handleBatchFilesSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files: File[] = Array.from(fileList);
    e.target.value = '';

    setPageError(null);
    setSuccessBanner(null);

    if (items.length === 0) {
      setPageError('Không có dòng sản phẩm nào đang hiển thị để ghép xem trước.');
      return;
    }

    const pairCount = Math.min(files.length, items.length);
    const previews: BatchPairPreview[] = [];

    for (let i = 0; i < pairCount; i++) {
      const file = files[i];
      const validationErr = validateSelectedFile(file);
      if (validationErr) {
        setPageError(validationErr);
        return;
      }
      const dataUrl = await readFileAsDataUrl(file);
      previews.push({
        file,
        previewDataUrl: dataUrl,
        product: items[i],
      });
    }

    setBatchPairs(previews);
  };

  const handleRemoveBatchPair = (productId: string) => {
    setBatchPairs((prev) => prev.filter((p) => p.product.id !== productId));
  };

  const handleConfirmBatchUpload = async () => {
    if (batchPairs.length === 0) return;
    setBatchSubmitting(true);
    setPageError(null);
    setSuccessBanner(null);

    let successCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < batchPairs.length; i++) {
      const pair = batchPairs[i];
      setBatchProgressText(
        `Đang xử lý ${i + 1}/${batchPairs.length}: ${pair.product.name}...`
      );
      try {
        const res = await uploadAndSetPrimaryImage(
          pair.product,
          pair.file,
          pair.previewDataUrl
        );
        if (res.ok) {
          successCount += 1;
          setRowFeedback((prev) => ({
            ...prev,
            [pair.product.id]: { type: 'success', message: 'Đã cập nhật ảnh chính' },
          }));
        } else {
          errors.push(`${pair.product.name}: ${res.message}`);
          setRowFeedback((prev) => ({
            ...prev,
            [pair.product.id]: { type: 'error', message: res.message },
          }));
        }
      } catch (err: any) {
        const msg = err?.message || 'Lỗi tải ảnh';
        errors.push(`${pair.product.name}: ${msg}`);
      }
    }

    setBatchSubmitting(false);
    setBatchProgressText(null);
    setBatchPairs([]);
    await loadQuickImages();

    if (errors.length > 0) {
      setPageError(
        `Hoàn tất ${successCount}/${successCount + errors.length} sản phẩm. Lỗi: ${errors.join(' | ')}`
      );
    } else {
      const msg = `Đã thay ảnh chính thành công cho ${successCount} sản phẩm.`;
      setSuccessBanner(msg);
      onShowToast?.(msg);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Thanh công cụ */}
      <div className="bg-white rounded-2xl border border-[#E0DCD3] p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg sm:text-xl font-bold text-[#1A1C19]">
                Ảnh sản phẩm nhanh
              </h2>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-50 text-sky-800 border border-sky-200">
                Còn {statusCounts.CHƯA_CÓ_ẢNH_THẬT ?? 0} sản phẩm CHƯA_CÓ_ẢNH_THẬT
              </span>
            </div>
            <p className="text-xs text-[#6B665C] mt-0.5">
              Trạng thái ảnh đọc trực tiếp từ CSDL và bộ nhớ đệm kiểm toán (không gọi Gemini). Ảnh mới tải lên được kiểm tra magic bytes, xóa EXIF và lưu nguyên tử kèm nhật ký quản trị.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={batchInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              onChange={handleBatchFilesSelect}
              className="hidden"
            />
            <button
              type="button"
              disabled={loading || items.length === 0 || batchSubmitting}
              onClick={() => batchInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#2D4A3E] text-white text-xs font-semibold hover:bg-[#22382F] disabled:opacity-50 cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5" />
              Chọn nhiều file cho các dòng đang hiển thị
            </button>
            <button
              type="button"
              onClick={loadQuickImages}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#D5D0C5] bg-white text-xs font-semibold text-[#1A1C19] hover:bg-[#F5F2EB] cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Làm mới
            </button>
          </div>
        </div>

        {/* Bộ lọc nhanh theo trạng thái */}
        <div className="flex flex-wrap gap-2">
          {(
            [
              { key: 'ALL', label: 'Tất cả' },
              { key: 'OK', label: 'OK' },
              { key: 'CHƯA_CÓ_ẢNH_THẬT', label: 'CHƯA_CÓ_ẢNH_THẬT' },
              { key: 'MÀU_LỆCH', label: 'MÀU_LỆCH' },
              { key: 'LOẠI_LỆCH', label: 'LOẠI_LỆCH' },
              { key: 'HỎNG', label: 'HỎNG' },
              { key: 'DÙNG_CHUNG', label: 'DÙNG_CHUNG' },
            ] as const
          ).map((st) => {
            const active = statusFilter === st.key;
            const count = statusCounts[st.key] ?? 0;
            return (
              <button
                key={st.key}
                type="button"
                onClick={() => setStatusFilter(st.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#1A1C19] text-white border-[#1A1C19]'
                    : 'bg-[#FAF8F5] text-[#4A473E] border-[#E0DCD3] hover:bg-[#EFECE4]'
                }`}
              >
                {st.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Tìm kiếm & Lọc danh mục */}
        <form
          onSubmit={handleSearchSubmit}
          className="grid grid-cols-1 sm:grid-cols-12 gap-2.5"
        >
          <div className="sm:col-span-6 relative">
            <Search className="w-4 h-4 text-[#6B665C] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo tên sản phẩm, slug, màu biến thể chính..."
              className="w-full pl-9 pr-3 py-2 text-xs border border-[#D5D0C5] rounded-xl bg-white"
            />
          </div>

          <div className="sm:col-span-4">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-[#D5D0C5] rounded-xl bg-white"
            >
              <option value="all">Tất cả danh mục</option>
              {categories.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name} ({c.slug})
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <button
              type="submit"
              className="w-full px-3 py-2 rounded-xl bg-[#1A1C19] text-white text-xs font-semibold hover:bg-[#323530] cursor-pointer"
            >
              Tìm kiếm
            </button>
          </div>
        </form>

        {pageError && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{pageError}</span>
          </div>
        )}

        {successBanner && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{successBanner}</span>
          </div>
        )}
      </div>

      {/* Bước Xem Trước & Xác Nhận khi chọn nhiều file (KHÔNG tự ghép mù) */}
      {batchPairs.length > 0 && (
        <div className="bg-amber-50/90 border-2 border-amber-300 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-[#1A1C19]">
                Xem trước cặp ghép (File tải lên → Sản phẩm) trước khi lưu ({batchPairs.length} cặp)
              </h3>
              <p className="text-xs text-[#5C584F] mt-0.5">
                Vui lòng kiểm tra kỹ từng tệp ảnh và sản phẩm tương ứng bên dưới. Hệ thống chỉ tải lên và thay ảnh chính sau khi bạn bấm nút xác nhận.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={batchSubmitting}
                onClick={() => setBatchPairs([])}
                className="px-3 py-1.5 rounded-xl border border-[#D5D0C5] bg-white text-xs font-semibold text-[#4A473E] hover:bg-stone-100 cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={batchSubmitting}
                onClick={handleConfirmBatchUpload}
                className="px-4 py-1.5 rounded-xl bg-[#2D4A3E] text-white text-xs font-semibold hover:bg-[#22382F] disabled:opacity-50 cursor-pointer"
              >
                {batchSubmitting
                  ? batchProgressText || 'Đang tải lên...'
                  : `Xác nhận thay ${batchPairs.length} ảnh chính`}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {batchPairs.map((pair, idx) => (
              <div
                key={pair.product.id}
                className="bg-white rounded-xl border border-[#E0DCD3] p-3 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-bold text-[#6B665C] shrink-0">
                    #{idx + 1}
                  </span>
                  <img
                    src={pair.previewDataUrl}
                    alt={pair.file.name}
                    className="w-14 h-14 rounded-lg object-cover border border-[#E0DCD3] shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#1A1C19] truncate">
                      {pair.product.name}
                    </p>
                    <p className="text-[11px] text-[#6B665C] truncate">
                      Danh mục: {pair.product.categoryName} · Màu: {pair.product.primaryVariantColor}
                    </p>
                    <p className="text-[11px] text-emerald-700 font-medium truncate">
                      Tệp mới: {pair.file.name} ({Math.round(pair.file.size / 1024)} KB)
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={batchSubmitting}
                  onClick={() => handleRemoveBatchPair(pair.product.id)}
                  className="p-1.5 rounded-lg text-[#6B665C] hover:text-red-600 hover:bg-red-50 cursor-pointer shrink-0"
                  title="Bỏ cặp ghép này"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Danh sách sản phẩm (hỗ trợ cả bảng desktop và thẻ màn hình hẹp) */}
      <div className="bg-white rounded-2xl border border-[#E0DCD3] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-[#6B665C]">
            Đang tải danh sách sản phẩm và trạng thái ảnh...
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#6B665C]">
            Không có sản phẩm nào khớp với bộ lọc hiện tại.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#FAF8F5] border-b border-[#E0DCD3] text-[#4A473E]">
                  <th className="py-3 px-3 sm:px-4 font-semibold">Ảnh hiện tại</th>
                  <th className="py-3 px-3 sm:px-4 font-semibold">Tên sản phẩm</th>
                  <th className="py-3 px-3 sm:px-4 font-semibold hidden md:table-cell">
                    Danh mục
                  </th>
                  <th className="py-3 px-3 sm:px-4 font-semibold">
                    Màu biến thể chính
                  </th>
                  <th className="py-3 px-3 sm:px-4 font-semibold">Trạng thái</th>
                  <th className="py-3 px-3 sm:px-4 font-semibold text-right">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EBE7DF]">
                {items.map((row) => {
                  const isRowUploading = uploadingProductId === row.id;
                  const fb = rowFeedback[row.id];
                  const imgSrc = resolveDisplayImageUrl(row.primaryImageUrl);

                  return (
                    <tr
                      key={row.id}
                      className="hover:bg-[#FAF8F5]/60 transition-colors align-middle"
                    >
                      <td className="py-3 px-3 sm:px-4">
                        <div className="w-14 h-14 rounded-xl border border-[#E0DCD3] bg-[#F5F2EB] overflow-hidden flex items-center justify-center shrink-0">
                          {imgSrc ? (
                            <img
                              src={imgSrc}
                              alt={row.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <ImageIcon className="w-5 h-5 text-[#9B9589]" />
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-3 sm:px-4 max-w-[220px] sm:max-w-xs">
                        <div className="font-semibold text-[#1A1C19] line-clamp-2">
                          {row.name}
                        </div>
                        <div className="text-[11px] text-[#6B665C] font-mono truncate mt-0.5">
                          {row.slug}
                        </div>
                        <div className="md:hidden text-[11px] text-[#6B665C] mt-0.5">
                          Danh mục: {row.categoryName}
                        </div>
                        {fb && (
                          <div
                            className={`mt-1 text-[11px] font-medium ${
                              fb.type === 'error' ? 'text-red-600' : 'text-emerald-700'
                            }`}
                          >
                            {fb.message}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 sm:px-4 hidden md:table-cell">
                        <span className="font-medium text-[#1A1C19]">
                          {row.categoryName}
                        </span>
                        <div className="text-[11px] text-[#6B665C]">
                          {row.categorySlug} · {row.targetGender}
                        </div>
                      </td>

                      <td className="py-3 px-3 sm:px-4">
                        <div className="font-medium text-[#1A1C19]">
                          {row.primaryVariantColor}
                        </div>
                        {row.variantColorFamilies.length > 0 && (
                          <div className="text-[11px] text-[#6B665C]">
                            Họ màu: {row.variantColorFamilies.join(', ')}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 sm:px-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-[11px] font-bold ${getStatusBadgeStyle(
                            row.status
                          )}`}
                        >
                          {row.status}
                        </span>
                        {row.recognizedColors.length > 0 && (
                          <div className="text-[10px] text-[#6B665C] mt-1">
                            Cache: {row.recognizedColors.join(', ')}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3 sm:px-4 text-right">
                        <label
                          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                            isRowUploading
                              ? 'bg-stone-100 text-stone-500 border-stone-200 cursor-wait'
                              : 'bg-[#1A1C19] text-white border-[#1A1C19] hover:bg-[#2D4A3E] hover:border-[#2D4A3E] cursor-pointer'
                          }`}
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>
                            {isRowUploading ? 'Đang tải...' : 'Thay ảnh chính'}
                          </span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            disabled={isRowUploading || batchSubmitting}
                            onChange={(e) => handleSingleFileChange(row, e)}
                            className="hidden"
                          />
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
