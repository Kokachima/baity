import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, EyeOff, Eye, Trash2, RefreshCw } from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import { formatCurrency } from './AdminLayout.tsx';

interface ProductsPageProps {
  onShowToast?: (msg: string) => void;
}

export const ProductsPage: React.FC<ProductsPageProps> = ({ onShowToast }) => {
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [basePrice, setBasePrice] = useState('450000');
  const [salePrice, setSalePrice] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [sku, setSku] = useState('SKU-NEW-01');
  const [color, setColor] = useState('Kem');
  const [size, setSize] = useState('M');
  const [stockQuantity, setStockQuantity] = useState('10');
  const [imageObjectPath, setImageObjectPath] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [prodRes, catRes] = await Promise.all([
      apiRequest('/api/admin/products?limit=50'),
      apiRequest('/api/admin/categories'),
    ]);
    setLoading(false);
    if (!prodRes.ok) {
      setError(prodRes.errorMessage || 'Không thể tải danh sách sản phẩm');
      return;
    }
    setProducts(Array.isArray(prodRes.data?.items) ? prodRes.data.items : []);
    const cats = Array.isArray(catRes.data?.items) ? catRes.data.items : [];
    setCategories(cats);
    if (!categoryId && cats.length > 0) {
      setCategoryId(cats[0].id);
    }
  }, [categoryId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const resetForm = () => {
    setEditingProduct(null);
    setName('');
    setBasePrice('450000');
    setSalePrice('');
    setDescription('');
    setIsActive(true);
    setSku(`SKU-${Date.now().toString().slice(-5)}`);
    setColor('Kem');
    setSize('M');
    setStockQuantity('10');
    setFormError(null);
  };

  const handleEdit = async (prodId: string) => {
    const res = await apiRequest(`/api/admin/products/${encodeURIComponent(prodId)}`);
    if (!res.ok || !res.data?.product) {
      onShowToast?.(res.errorMessage || 'Không thể tải chi tiết sản phẩm');
      return;
    }
    const p = res.data.product;
    setEditingProduct(p);
    setName(p.name || '');
    setCategoryId(p.categoryId || '');
    setBasePrice(String(p.basePrice || 0));
    setSalePrice(p.salePrice != null ? String(p.salePrice) : '');
    setDescription(p.description || '');
    setIsActive(Boolean(p.isActive));
    if (Array.isArray(p.variants) && p.variants.length > 0) {
      setSku(p.variants[0].sku || '');
      setColor(p.variants[0].color || 'Kem');
      setSize(p.variants[0].size || 'M');
      setStockQuantity(String(p.variants[0].stockQuantity ?? 0));
    }
    if (Array.isArray(p.images) && p.images.length > 0) {
      setImageObjectPath(p.images[0].imageUrl || p.images[0].url || '');
    } else {
      setImageObjectPath('');
    }
    setFormError(null);
  };

  const handleUploadProductImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFormError(null);
    setUploadingImage(true);
    try {
      const reader = new FileReader();
      const dataUrl: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh'));
        reader.readAsDataURL(file);
      });
      const res = await apiRequest('/api/upload', {
        method: 'POST',
        body: JSON.stringify({
          image: dataUrl,
          purpose: 'product',
        }),
      });
      if (!res.ok || !res.data?.path) {
        setFormError(res.errorMessage || 'Không thể tải ảnh sản phẩm lên kho lưu trữ');
      } else {
        setImageObjectPath(res.data.path);
        onShowToast?.('Đã tải ảnh sản phẩm lên thành công');
      }
    } catch (err: any) {
      setFormError(err?.message || 'Lỗi tải ảnh sản phẩm');
    } finally {
      setUploadingImage(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);

    const cleanImagePath = imageObjectPath.trim();
    const payload: any = {
      name: name.trim(),
      categoryId,
      basePrice: Number(basePrice),
      salePrice: salePrice.trim() ? Number(salePrice) : null,
      description: description.trim() || 'Sản phẩm thiết kế Baity',
      isActive,
      variants: editingProduct?.variants?.length
        ? editingProduct.variants.map((v: any, idx: number) =>
            idx === 0
              ? { ...v, sku: sku.trim(), color: color.trim(), size: size.trim() }
              : v
          )
        : [
            {
              sku: sku.trim(),
              color: color.trim(),
              size: size.trim(),
              stockQuantity: Number(stockQuantity || 0),
            },
          ],
      images: cleanImagePath
        ? [
            {
              imageUrl: cleanImagePath,
              objectPath: cleanImagePath,
              altText: name.trim(),
              isPrimary: true,
              displayOrder: 0,
            },
          ]
        : [],
      attributes: editingProduct?.attributes || [{ name: 'Chất liệu', value: 'Linen tự nhiên' }],
    };

    if (editingProduct?.updatedAt) {
      payload.expectedUpdatedAt = editingProduct.updatedAt;
    }

    const res = await apiRequest(
      editingProduct
        ? `/api/admin/products/${encodeURIComponent(editingProduct.id)}`
        : '/api/admin/products',
      {
        method: editingProduct ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      }
    );
    setSubmitting(false);

    if (!res.ok) {
      setFormError(res.errorMessage || 'Không thể lưu sản phẩm');
      return;
    }

    onShowToast?.(editingProduct ? 'Đã cập nhật sản phẩm' : 'Đã tạo sản phẩm mới');
    resetForm();
    await loadData();
  };

  const handleToggleVisibility = async (prod: any) => {
    const res = await apiRequest(
      `/api/admin/products/${encodeURIComponent(prod.id)}/visibility`,
      {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !prod.isActive }),
      }
    );
    if (!res.ok) {
      onShowToast?.(res.errorMessage || 'Không thể đổi trạng thái hiển thị');
      return;
    }
    onShowToast?.(res.data?.message || 'Đã cập nhật trạng thái hiển thị');
    await loadData();
  };

  const handleDelete = async (prod: any) => {
    const res = await apiRequest(`/api/admin/products/${encodeURIComponent(prod.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      onShowToast?.(res.errorMessage || 'Không thể xóa sản phẩm');
      return;
    }
    onShowToast?.(res.data?.message || 'Đã xóa sản phẩm');
    await loadData();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-5 bg-white rounded-2xl border border-[#E0DCD3] p-6 space-y-4 self-start">
        <h2 className="font-display text-lg font-bold text-[#1A1C19]">
          {editingProduct ? `Cập nhật SP (${editingProduct.id})` : 'Tạo sản phẩm mới'}
        </h2>
        <p className="text-xs text-[#6B665C]">
          Lưu sản phẩm, biến thể, ảnh và thuộc tính trong 1 giao dịch nguyên tử; kiểm tra chống ghi đè bằng `updated_at`.
        </p>

        {formError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label className="block font-semibold mb-1">Tên sản phẩm *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-[#D5D0C5] rounded-lg"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block font-semibold mb-1">Danh mục *</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3 py-2 border border-[#D5D0C5] rounded-lg bg-white"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">Giá gốc (VND) *</label>
              <input
                type="number"
                required
                min={0}
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                className="w-full px-3 py-2 border border-[#D5D0C5] rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block font-semibold mb-1">Giá khuyến mãi (&lt;= Giá gốc)</label>
              <input
                type="number"
                min={0}
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                className="w-full px-3 py-2 border border-[#D5D0C5] rounded-lg"
                placeholder="Để trống nếu không giảm"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Mã SKU biến thể chính *</label>
              <input
                type="text"
                required
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="w-full px-3 py-2 border border-[#D5D0C5] rounded-lg font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block font-semibold mb-1">Màu sắc</label>
              <input
                type="text"
                required
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-[#D5D0C5] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Kích cỡ</label>
              <input
                type="text"
                required
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-[#D5D0C5] rounded-lg"
              />
            </div>
            {!editingProduct && (
              <div>
                <label className="block font-semibold mb-1">Tồn đầu</label>
                <input
                  type="number"
                  min={0}
                  value={stockQuantity}
                  onChange={(e) => setStockQuantity(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-[#D5D0C5] rounded-lg"
                />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block font-semibold">
              Ảnh sản phẩm (chỉ nhận từ kho tải lên `purpose=product`)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleUploadProductImage}
                disabled={uploadingImage}
                className="text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[#2D4A3E] file:text-white hover:file:bg-[#233B31]"
              />
              {uploadingImage && (
                <span className="text-[11px] text-[#6B665C]">Đang tải ảnh...</span>
              )}
            </div>
            <input
              type="text"
              value={imageObjectPath}
              onChange={(e) => setImageObjectPath(e.target.value)}
              placeholder="Đường dẫn kho lưu trữ (products/<folder>/<file>.jpg)"
              className="w-full px-3 py-2 border border-[#D5D0C5] rounded-lg font-mono text-[11px]"
            />
          </div>

          <div>
            <label className="block font-semibold mb-1">Mô tả sản phẩm</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-[#D5D0C5] rounded-lg"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span>Đang mở bán (`is_active = true`)</span>
          </label>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#2D4A3E] text-white font-semibold rounded-lg disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>{editingProduct ? 'Lưu thay đổi' : 'Tạo sản phẩm'}</span>
            </button>
            {editingProduct && (
              <button
                type="button"
                onClick={resetForm}
                className="px-3 py-2 border border-[#D5D0C5] rounded-lg font-semibold"
              >
                Hủy
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="lg:col-span-7 bg-white rounded-2xl border border-[#E0DCD3] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A1C19]">
              Danh sách Sản phẩm ({products.length})
            </h2>
            <p className="text-xs text-[#6B665C]">
              Sản phẩm đã có đơn hàng được bảo vệ không cho xóa cứng (dùng Ẩn/Hiện).
            </p>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#F5F2EB] hover:bg-[#EAE5DC] rounded-lg"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Làm mới</span>
          </button>
        </div>

        {loading ? (
          <div className="py-10 text-center text-xs text-[#6B665C]">Đang tải sản phẩm...</div>
        ) : error ? (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {error}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#EAE6DE] text-[#6B665C]">
                  <th className="py-2 px-2.5 font-semibold">Sản phẩm</th>
                  <th className="py-2 px-2.5 font-semibold">Giá</th>
                  <th className="py-2 px-2.5 font-semibold">Biến thể / Tồn</th>
                  <th className="py-2 px-2.5 font-semibold">Trạng thái</th>
                  <th className="py-2 px-2.5 font-semibold text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2EFE9]">
                {products.map((prod) => (
                  <tr key={prod.id} className="hover:bg-[#FAF8F5]">
                    <td className="py-2.5 px-2.5">
                      <div className="font-bold text-[#1A1C19]">{prod.name}</div>
                      <div className="font-mono text-[11px] text-[#6B665C]">{prod.slug}</div>
                    </td>
                    <td className="py-2.5 px-2.5">
                      <div className="font-semibold">{formatCurrency(prod.basePrice)}</div>
                      {prod.salePrice != null && (
                        <div className="text-[11px] text-[#C27D56]">
                          KM: {formatCurrency(prod.salePrice)}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-2.5">
                      {prod.variantCount || 0} biến thể · Tồn: <strong>{prod.totalStock ?? 0}</strong>
                    </td>
                    <td className="py-2.5 px-2.5">
                      <span
                        className={`px-2 py-0.5 rounded font-semibold ${
                          prod.isActive
                            ? 'bg-emerald-50 text-emerald-800'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {prod.isActive ? 'Đang bán' : 'Đang ẩn'}
                      </span>
                    </td>
                    <td className="py-2.5 px-2.5 text-right space-x-1">
                      <button
                        type="button"
                        onClick={() => handleEdit(prod.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-[#F5F2EB] hover:bg-[#EAE5DC] rounded font-semibold"
                      >
                        <Edit2 className="w-3 h-3" />
                        <span>Sửa</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleVisibility(prod)}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-[#F5F2EB] hover:bg-[#EAE5DC] rounded font-semibold"
                      >
                        {prod.isActive ? (
                          <EyeOff className="w-3 h-3" />
                        ) : (
                          <Eye className="w-3 h-3" />
                        )}
                        <span>{prod.isActive ? 'Ẩn' : 'Hiện'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(prod)}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 text-red-700 hover:bg-red-100 rounded font-semibold"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
