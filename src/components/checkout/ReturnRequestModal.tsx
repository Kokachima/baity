import React, { useState } from 'react';
import { X, Upload, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import type { OrderRecord } from '../../types/index.ts';

interface ReturnRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: OrderRecord | null;
  onSuccess: () => void;
  showToast: (msg: string) => void;
}

const RETURN_REASONS = [
  { value: 'defective_product', label: 'Sản phẩm lỗi, rách hoặc bung chỉ từ nhà sản xuất' },
  { value: 'wrong_item', label: 'Giao sai mẫu mã, sai màu hoặc sai kích thước' },
  { value: 'size_not_fit', label: 'Mặc không vừa size (cần đổi sang kích cỡ khác)' },
  { value: 'not_as_described', label: 'Sản phẩm thực tế khác với hình ảnh hoặc mô tả' },
  { value: 'other', label: 'Lý do khác' },
];

export const ReturnRequestModal: React.FC<ReturnRequestModalProps> = ({
  isOpen,
  onClose,
  order,
  onSuccess,
  showToast,
}) => {
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [quantity, setQuantity] = useState<number>(1);
  const [type, setType] = useState<'refund' | 'exchange'>('refund');
  const [reason, setReason] = useState<string>('defective_product');
  const [description, setDescription] = useState<string>('');
  const [images, setImages] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  if (!isOpen || !order) return null;

  const items = order.items || [];
  const selectedItem = items.find((i: any) => i.id === selectedItemId) || items[0];

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (images.length + files.length > 3) {
      setError('Tối đa 3 ảnh minh chứng cho mỗi yêu cầu đổi trả');
      return;
    }

    setIsUploading(true);
    setError('');

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > 5 * 1024 * 1024) {
          setError(`File ${file.name} vượt quá dung lượng tối đa 5MB`);
          continue;
        }

        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const res = await apiRequest('/api/upload', {
          method: 'POST',
          body: JSON.stringify({ image: base64, purpose: 'return' }),
        });

        if (res.ok && res.data?.url) {
          setImages((prev) => [...prev, res.data.url]);
        } else {
          setError(res.errorMessage || 'Lỗi tải ảnh lên');
        }
      }
    } catch {
      setError('Lỗi kết nối khi tải ảnh minh chứng');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleRemoveImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const targetItemId = selectedItemId || (items[0]?.id as string);
    if (!targetItemId) {
      setError('Vui lòng chọn sản phẩm cần yêu cầu đổi trả');
      return;
    }

    if (!reason) {
      setError('Vui lòng chọn lý do đổi trả');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiRequest('/api/returns', {
        method: 'POST',
        body: JSON.stringify({
          orderId: order.id,
          orderItemId: targetItemId,
          quantity,
          type,
          reason,
          description: description.trim(),
          imageProofUrls: images,
        }),
      });

      if (!res.ok) {
        setError(res.errorMessage || 'Không thể tạo yêu cầu đổi trả');
        return;
      }

      showToast('Đã gửi yêu cầu đổi trả / hoàn tiền thành công! Bộ phận CSKH sẽ xử lý trong 24h.');
      onSuccess();
      onClose();
    } catch {
      setError('Lỗi kết nối máy chủ khi gửi yêu cầu đổi trả');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-xs" onClick={onClose} />

      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-[#E0DCD3] overflow-hidden z-10 my-8">
        <div className="px-6 py-4 bg-[#FAF8F5] border-b border-[#E8E4DA] flex items-center justify-between">
          <div>
            <h3 className="font-display text-base font-bold text-[#1A1C19]">
              Yêu Cầu Đổi Trả / Hoàn Tiền
            </h3>
            <p className="text-xs text-[#7A7569]">
              Đơn hàng: <span className="font-semibold text-[#1A1C19]">{order.id}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#6B665C] hover:text-[#1A1C19] rounded-lg hover:bg-[#F2EFE9]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2.5 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Chọn sản phẩm */}
          <div>
            <label className="block text-xs font-bold text-[#4A4740] mb-1.5 uppercase tracking-wider">
              Chọn sản phẩm cần đổi trả
            </label>
            <select
              value={selectedItemId || items[0]?.id || ''}
              onChange={(e) => {
                setSelectedItemId(e.target.value);
                setQuantity(1);
              }}
              className="w-full px-3.5 py-2.5 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-xl focus:border-[#2D4A3E] focus:bg-white outline-hidden font-medium"
            >
              {items.map((it: any) => (
                <option key={it.id} value={it.id}>
                  {it.productName} ({it.color} / {it.size}) - Mua: {it.quantity} chiếc (
                  {Number(it.unitPrice).toLocaleString('vi-VN')}₫)
                </option>
              ))}
            </select>
          </div>

          {/* Loại yêu cầu & Số lượng */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[#4A4740] mb-1.5 uppercase tracking-wider">
                Hình thức giải quyết
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setType('refund')}
                  className={`py-2 px-3 text-xs font-semibold rounded-xl border text-center transition-all ${
                    type === 'refund'
                      ? 'bg-[#2D4A3E] text-white border-[#2D4A3E]'
                      : 'bg-white text-[#4A4740] border-[#D5D0C5] hover:bg-[#FAF8F5]'
                  }`}
                >
                  Hoàn tiền
                </button>
                <button
                  type="button"
                  onClick={() => setType('exchange')}
                  className={`py-2 px-3 text-xs font-semibold rounded-xl border text-center transition-all ${
                    type === 'exchange'
                      ? 'bg-[#2D4A3E] text-white border-[#2D4A3E]'
                      : 'bg-white text-[#4A4740] border-[#D5D0C5] hover:bg-[#FAF8F5]'
                  }`}
                >
                  Đổi size/màu
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#4A4740] mb-1.5 uppercase tracking-wider">
                Số lượng yêu cầu
              </label>
              <input
                type="number"
                min={1}
                max={selectedItem?.quantity || 1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(Number(e.target.value), selectedItem?.quantity || 1)))}
                className="w-full px-3.5 py-2 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-xl focus:border-[#2D4A3E] focus:bg-white outline-hidden"
              />
            </div>
          </div>

          {/* Lý do đổi trả */}
          <div>
            <label className="block text-xs font-bold text-[#4A4740] mb-1.5 uppercase tracking-wider">
              Lý do đổi trả
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-xl focus:border-[#2D4A3E] focus:bg-white outline-hidden font-medium"
            >
              {RETURN_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-[#7A7569] mt-1.5">
              Chính sách phí vận chuyển khi đổi trả: Mặc định không hoàn phí vận chuyển ban đầu, trừ khi lý do thuộc lỗi cửa hàng (hàng lỗi, giao sai).
            </p>
          </div>

          {/* Mô tả chi tiết */}
          <div>
            <label className="block text-xs font-bold text-[#4A4740] mb-1.5 uppercase tracking-wider">
              Mô tả chi tiết tình trạng
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Vui lòng cung cấp thêm thông tin chi tiết về lỗi sản phẩm hoặc yêu cầu đổi kích cỡ..."
              className="w-full px-3.5 py-2 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-xl focus:border-[#2D4A3E] focus:bg-white outline-hidden resize-none"
            />
          </div>

          {/* Tải ảnh minh chứng */}
          <div>
            <label className="block text-xs font-bold text-[#4A4740] mb-1.5 uppercase tracking-wider flex items-center justify-between">
              <span>Ảnh minh chứng (Tối đa 3 ảnh)</span>
              <span className="text-[11px] font-normal text-[#7A7569]">{images.length}/3 ảnh</span>
            </label>

            <div className="flex flex-wrap gap-2.5 items-center">
              {images.map((imgUrl, idx) => (
                <div key={idx} className="relative w-16 h-16 rounded-lg border border-[#D5D0C5] overflow-hidden group">
                  <img src={imgUrl} alt="Minh chứng" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(idx)}
                    className="absolute inset-0 bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}

              {images.length < 3 && (
                <label className="w-16 h-16 rounded-lg border border-dashed border-[#D5D0C5] hover:border-[#2D4A3E] flex flex-col items-center justify-center cursor-pointer bg-[#FAF8F5] hover:bg-[#F0ECE1] transition-colors">
                  <Upload className="w-4 h-4 text-[#7A7569]" />
                  <span className="text-[9px] text-[#7A7569] mt-1 font-medium">Tải ảnh</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    disabled={isUploading}
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              )}
            </div>
            {isUploading && <p className="text-[11px] text-[#2D4A3E] mt-1 font-medium">Đang tải ảnh lên...</p>}
          </div>

          <div className="pt-2 flex items-center justify-end gap-3 border-t border-[#E8E4DA]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold text-[#5C584F] hover:bg-[#FAF8F5] rounded-xl border border-[#D5D0C5]"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isUploading}
              className="px-5 py-2 text-xs font-bold text-white bg-[#2D4A3E] hover:bg-[#233B31] rounded-xl shadow-xs disabled:opacity-60 flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang gửi...</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Gửi yêu cầu đổi trả</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
