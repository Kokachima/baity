import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Trash2, RefreshCw } from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';

interface CategoriesPageProps {
  onShowToast?: (msg: string) => void;
}

export const CategoriesPage: React.FC<CategoriesPageProps> = ({ onShowToast }) => {
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiRequest('/api/admin/categories');
    setLoading(false);
    if (!res.ok) {
      setError(res.errorMessage || 'Không thể tải danh sách danh mục');
      return;
    }
    setCategories(Array.isArray(res.data?.items) ? res.data.items : []);
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setSlug('');
    setDescription('');
    setParentId('');
    setIsActive(true);
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);

    const payload = {
      name: name.trim(),
      slug: slug.trim() || undefined,
      description: description.trim() || null,
      parentId: parentId || null,
      isActive,
    };

    const res = await apiRequest(
      editingId
        ? `/api/admin/categories/${encodeURIComponent(editingId)}`
        : '/api/admin/categories',
      {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      }
    );
    setSubmitting(false);

    if (!res.ok) {
      setFormError(res.errorMessage || 'Không thể lưu danh mục');
      return;
    }

    onShowToast?.(editingId ? 'Đã cập nhật danh mục' : 'Đã tạo danh mục mới');
    resetForm();
    await loadCategories();
  };

  const handleDelete = async (cat: any) => {
    const res = await apiRequest(`/api/admin/categories/${encodeURIComponent(cat.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      onShowToast?.(res.errorMessage || 'Không thể xóa danh mục');
      return;
    }
    onShowToast?.(res.data?.message || 'Đã xóa danh mục');
    await loadCategories();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-5 bg-white rounded-2xl border border-[#E0DCD3] p-6 space-y-4 self-start">
        <h2 className="font-display text-lg font-bold text-[#1A1C19]">
          {editingId ? `Sửa danh mục (${editingId})` : 'Thêm danh mục mới'}
        </h2>
        <p className="text-xs text-[#6B665C]">
          Hỗ trợ tối đa 2 cấp (danh mục cha → danh mục con). Chặn tự trỏ vào chính mình hoặc tạo vòng lặp.
        </p>

        {formError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label className="block font-semibold mb-1">Tên danh mục *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-[#D5D0C5] rounded-lg"
              placeholder="Ví dụ: Áo Khoác Linen"
            />
          </div>

          <div>
            <label className="block font-semibold mb-1">Slug (tự sinh nếu để trống)</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="w-full px-3 py-2 border border-[#D5D0C5] rounded-lg font-mono"
              placeholder="ao-khoac-linen"
            />
          </div>

          <div>
            <label className="block font-semibold mb-1">Danh mục cha (tối đa 2 cấp)</label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full px-3 py-2 border border-[#D5D0C5] rounded-lg bg-white"
            >
              <option value="">— Danh mục gốc (Cấp 1) —</option>
              {categories
                .filter((c) => !c.parentId && c.id !== editingId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.slug})
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold mb-1">Mô tả</label>
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
            <span>Hiển thị ngoài cửa hàng (`is_active = true`)</span>
          </label>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#2D4A3E] text-white font-semibold rounded-lg disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>{editingId ? 'Lưu cập nhật' : 'Tạo danh mục'}</span>
            </button>
            {editingId && (
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
              Danh sách Danh mục ({categories.length})
            </h2>
            <p className="text-xs text-[#6B665C]">
              Không cho xóa cứng danh mục đang có sản phẩm hoặc danh mục con (khuyến nghị chuyển sang ẩn).
            </p>
          </div>
          <button
            type="button"
            onClick={loadCategories}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#F5F2EB] hover:bg-[#EAE5DC] rounded-lg"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Làm mới</span>
          </button>
        </div>

        {loading ? (
          <div className="py-10 text-center text-xs text-[#6B665C]">Đang tải danh mục...</div>
        ) : error ? (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {error}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#EAE6DE] text-[#6B665C]">
                  <th className="py-2 px-3 font-semibold">Tên & Slug</th>
                  <th className="py-2 px-3 font-semibold">Cấp</th>
                  <th className="py-2 px-3 font-semibold">SP / Con</th>
                  <th className="py-2 px-3 font-semibold">Trạng thái</th>
                  <th className="py-2 px-3 font-semibold text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F2EFE9]">
                {categories.map((cat) => (
                  <tr key={cat.id} className="hover:bg-[#FAF8F5]">
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-[#1A1C19]">{cat.name}</div>
                      <div className="font-mono text-[11px] text-[#6B665C]">{cat.slug}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      {cat.parentId ? `Con của ${cat.parentId}` : 'Gốc (Cấp 1)'}
                    </td>
                    <td className="py-2.5 px-3">
                      {cat.productCount || 0} SP · {cat.childCount || 0} con
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded font-semibold ${
                          cat.isActive !== false
                            ? 'bg-emerald-50 text-emerald-800'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {cat.isActive !== false ? 'Hiển thị' : 'Đang ẩn'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right space-x-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(cat.id);
                          setName(cat.name || '');
                          setSlug(cat.slug || '');
                          setDescription(cat.description || '');
                          setParentId(cat.parentId || '');
                          setIsActive(cat.isActive !== false);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-[#F5F2EB] hover:bg-[#EAE5DC] rounded-md font-semibold"
                      >
                        <Edit2 className="w-3 h-3" />
                        <span>Sửa</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(cat)}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 text-red-700 hover:bg-red-100 rounded-md font-semibold"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Xóa</span>
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
