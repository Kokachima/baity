import React, { useState, useEffect, useCallback } from 'react';
import {
  BookOpen,
  HelpCircle,
  Eye,
  RotateCcw,
  Save,
  Plus,
  Edit3,
  EyeOff,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import { SafeMarkdown } from '../common/SafeMarkdown.tsx';

interface PoliciesFaqPageProps {
  onShowToast?: (msg: string) => void;
}

export const PoliciesFaqPage: React.FC<PoliciesFaqPageProps> = ({ onShowToast }) => {
  const [subTab, setSubTab] = useState<'policies' | 'faqs'>('policies');
  const [policies, setPolicies] = useState<any[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>('return');
  const [policyTitle, setPolicyTitle] = useState('');
  const [policyContent, setPolicyContent] = useState('');
  const [policyUpdatedAt, setPolicyUpdatedAt] = useState('');
  const [allowedVariables, setAllowedVariables] = useState<string[]>([]);
  const [previewData, setPreviewData] = useState<any | null>(null);
  const [confirmRestoreSlug, setConfirmRestoreSlug] = useState<string | null>(null);

  const [faqs, setFaqs] = useState<any[]>([]);
  const [allowedTopics, setAllowedTopics] = useState<string[]>([]);
  const [editingFaq, setEditingFaq] = useState<any | null>(null);
  const [isFaqModalOpen, setIsFaqModalOpen] = useState(false);
  const [faqForm, setFaqForm] = useState({
    title: '',
    topic: 'Đơn hàng & Thanh toán',
    content: '',
    displayOrder: 10,
    isActive: true,
    expectedUpdatedAt: '',
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [pRes, fRes] = await Promise.all([
      apiRequest('/api/admin/policies'),
      apiRequest('/api/admin/faqs'),
    ]);

    if (pRes.ok) {
      const list = pRes.data?.items || [];
      setPolicies(list);
      setAllowedVariables(pRes.data?.allowedVariables || []);
      const current = list.find((item: any) => item.slug === selectedSlug) || list[0];
      if (current) {
        setSelectedSlug(current.slug);
        setPolicyTitle(current.title);
        setPolicyContent(current.content);
        setPolicyUpdatedAt(current.updatedAt || '');
      }
    } else {
      setError(pRes.errorMessage || 'Không thể tải danh sách chính sách');
    }

    if (fRes.ok) {
      setFaqs(fRes.data?.items || []);
      setAllowedTopics(fRes.data?.allowedTopics || []);
    }
    setLoading(false);
  }, [selectedSlug]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleSelectPolicy = (p: any) => {
    setSelectedSlug(p.slug);
    setPolicyTitle(p.title);
    setPolicyContent(p.content);
    setPolicyUpdatedAt(p.updatedAt || '');
    setPreviewData(null);
    setError(null);
    setSuccessMsg(null);
  };

  const handlePreviewPolicy = async () => {
    setError(null);
    const res = await apiRequest('/api/admin/policies/preview', {
      method: 'POST',
      body: JSON.stringify({
        title: policyTitle,
        content: policyContent,
      }),
    });
    if (!res.ok) {
      setError(res.errorMessage || 'Lỗi xem trước chính sách');
      return;
    }
    setPreviewData(res.data);
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    const res = await apiRequest(`/api/admin/policies/${selectedSlug}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: policyTitle,
        content: policyContent,
        expectedUpdatedAt: policyUpdatedAt || undefined,
      }),
    });

    setSaving(false);
    if (!res.ok) {
      setError(res.errorMessage || 'Không thể lưu nội dung chính sách');
      return;
    }

    setSuccessMsg('Đã cập nhật chính sách thành công.');
    onShowToast?.('Đã lưu chính sách');
    loadAll();
  };

  const handleConfirmRestore = async () => {
    if (!confirmRestoreSlug) return;
    setSaving(true);
    const res = await apiRequest(`/api/admin/policies/${confirmRestoreSlug}/restore`, {
      method: 'POST',
    });
    setSaving(false);
    setConfirmRestoreSlug(null);

    if (!res.ok) {
      setError(res.errorMessage || 'Không thể khôi phục mặc định');
      return;
    }
    setSuccessMsg('Đã khôi phục nội dung chính sách mặc định từ seed.');
    onShowToast?.('Đã khôi phục chính sách mặc định');
    loadAll();
  };

  const openCreateFaq = () => {
    setEditingFaq(null);
    setFaqForm({
      title: '',
      topic: allowedTopics[0] || 'Đơn hàng & Thanh toán',
      content: '',
      displayOrder: 10,
      isActive: true,
      expectedUpdatedAt: '',
    });
    setIsFaqModalOpen(true);
  };

  const openEditFaq = (f: any) => {
    setEditingFaq(f);
    setFaqForm({
      title: f.title || '',
      topic: f.topic || allowedTopics[0] || 'Đơn hàng & Thanh toán',
      content: f.content || '',
      displayOrder: Number(f.displayOrder ?? 10),
      isActive: Boolean(f.isActive),
      expectedUpdatedAt: f.updatedAt || '',
    });
    setIsFaqModalOpen(true);
  };

  const handleSaveFaq = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const res = editingFaq
      ? await apiRequest(`/api/admin/faqs/${editingFaq.id}`, {
          method: 'PUT',
          body: JSON.stringify(faqForm),
        })
      : await apiRequest('/api/admin/faqs', {
          method: 'POST',
          body: JSON.stringify(faqForm),
        });

    setSaving(false);
    if (!res.ok) {
      setError(res.errorMessage || 'Lỗi lưu câu hỏi FAQ');
      return;
    }

    setIsFaqModalOpen(false);
    onShowToast?.(editingFaq ? 'Đã cập nhật FAQ' : 'Đã tạo FAQ mới');
    loadAll();
  };

  const handleToggleFaqVisibility = async (f: any) => {
    const res = await apiRequest(`/api/admin/faqs/${f.id}/visibility`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !f.isActive }),
    });
    if (!res.ok) {
      setError(res.errorMessage || 'Không thể đổi trạng thái hiển thị FAQ');
      return;
    }
    onShowToast?.(f.isActive ? 'Đã ẩn câu hỏi FAQ' : 'Đã hiện câu hỏi FAQ');
    loadAll();
  };

  return (
    <div className="space-y-6" data-testid="admin-policies-faq-page">
      <div className="bg-white rounded-2xl border border-[#E0DCD3] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSubTab('policies')}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold ${
                subTab === 'policies'
                  ? 'bg-[#2D4A3E] text-white'
                  : 'bg-[#F5F2EB] text-[#1A1C19]'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>Chính sách Cửa hàng ({policies.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('faqs')}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold ${
                subTab === 'faqs'
                  ? 'bg-[#2D4A3E] text-white'
                  : 'bg-[#F5F2EB] text-[#1A1C19]'
              }`}
            >
              <HelpCircle className="w-4 h-4" />
              <span>Câu hỏi thường gặp FAQ ({faqs.length})</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-xs text-[#6B665C]">
            Đang tải nội dung chính sách & FAQ...
          </div>
        ) : subTab === 'policies' ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-3 space-y-2">
              <div className="text-xs font-bold text-[#6B665C] uppercase">
                Trang Chính sách Mặc định
              </div>
              {policies.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  onClick={() => handleSelectPolicy(p)}
                  className={`w-full text-left p-3 rounded-xl border text-xs transition-colors ${
                    selectedSlug === p.slug
                      ? 'bg-[#2D4A3E] text-white border-[#2D4A3E]'
                      : 'bg-[#FAF8F5] text-[#1A1C19] border-[#E8E4DA]'
                  }`}
                >
                  <div className="font-bold">{p.title}</div>
                  <div className="text-[10px] opacity-80 font-mono">/policies/{p.slug}</div>
                </button>
              ))}

              <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#E8E4DA] text-[11px] space-y-1">
                <div className="font-bold text-[#1A1C19]">Biến mẫu hợp lệ:</div>
                <div className="flex flex-wrap gap-1">
                  {allowedVariables.map((v) => (
                    <code
                      key={v}
                      className="px-1.5 py-0.5 bg-white border border-[#E0DCD3] rounded text-[10px]"
                    >
                      {`{{${v}}}`}
                    </code>
                  ))}
                </div>
              </div>
            </div>

            <form onSubmit={handleSavePolicy} className="lg:col-span-9 space-y-4 text-xs">
              <div>
                <label className="block font-semibold mb-1">Tiêu đề chính sách (&lt;= 150 ký tự)</label>
                <input
                  type="text"
                  maxLength={150}
                  required
                  value={policyTitle}
                  onChange={(e) => setPolicyTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">
                  Nội dung SafeMarkdown (&lt;= 20.000 ký tự, tự động loại bỏ thẻ HTML thô)
                </label>
                <textarea
                  rows={12}
                  maxLength={20000}
                  required
                  value={policyContent}
                  onChange={(e) => setPolicyContent(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg font-mono text-xs"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePreviewPolicy}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#F5F2EB] font-semibold"
                  >
                    <Eye className="w-3.5 h-3.5" /> Xem trước (Storefront Renderer)
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRestoreSlug(selectedSlug)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 font-semibold"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Khôi phục mặc định
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#2D4A3E] text-white font-semibold"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'Đang lưu...' : 'Lưu Chính sách'}</span>
                </button>
              </div>

              {previewData && (
                <div className="p-5 rounded-2xl bg-[#FAF8F5] border border-[#E0DCD3] space-y-3">
                  <div className="text-[11px] font-bold uppercase text-[#2D4A3E]">
                    Bản xem trước bằng bộ hiển thị thật (SafeMarkdown):
                  </div>
                  <h4 className="font-display text-lg font-bold text-[#1A1C19]">
                    {previewData.title}
                  </h4>
                  <SafeMarkdown content={previewData.content} />
                </div>
              )}
            </form>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-xs text-[#6B665C]">
                Quản lý danh sách câu hỏi thường gặp theo chủ đề chuẩn. Có thể tạo mới, sửa hoặc ẩn/hiện.
              </div>
              <button
                type="button"
                onClick={openCreateFaq}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2D4A3E] text-white text-xs font-semibold"
              >
                <Plus className="w-4 h-4" /> Thêm câu hỏi FAQ
              </button>
            </div>

            {faqs.length === 0 ? (
              <div className="py-10 text-center text-xs text-[#6B665C]">
                Chưa có câu hỏi FAQ nào.
              </div>
            ) : (
              <div className="space-y-2.5">
                {faqs.map((f) => (
                  <div
                    key={f.id}
                    className="p-4 rounded-xl border border-[#E8E4DA] bg-[#FAF8F5] flex flex-wrap items-start justify-between gap-4 text-xs"
                  >
                    <div className="space-y-1 max-w-2xl">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-[#2D4A3E]/10 text-[#2D4A3E] font-semibold text-[10px]">
                          {f.topic}
                        </span>
                        <span className="font-bold text-[#1A1C19]">{f.title}</span>
                        {!f.isActive && (
                          <span className="px-2 py-0.5 rounded bg-stone-200 text-stone-700 text-[10px] font-semibold">
                            Đang ẩn
                          </span>
                        )}
                      </div>
                      <div className="text-[#4A4740] whitespace-pre-line">{f.interpolatedAnswer || f.content}</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEditFaq(f)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-white border border-[#D8D3C8] font-semibold"
                      >
                        <Edit3 className="w-3 h-3" /> Sửa
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleFaqVisibility(f)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-amber-50 text-amber-800 font-semibold"
                      >
                        <EyeOff className="w-3 h-3" /> {f.isActive ? 'Ẩn' : 'Hiện'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Xác nhận khôi phục mặc định */}
      {confirmRestoreSlug && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 border border-[#E0DCD3]">
            <h3 className="font-display text-lg font-bold text-[#1A1C19]">
              Khôi phục nội dung mặc định từ Seed
            </h3>
            <p className="text-xs text-[#6B665C]">
              Bạn có chắc chắn muốn khôi phục chính sách <strong>{confirmRestoreSlug}</strong> về nội dung chuẩn mặc định ban đầu?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmRestoreSlug(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#F5F2EB]"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleConfirmRestore}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#2D4A3E] text-white"
              >
                Khôi phục ngay
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal tạo / sửa FAQ */}
      {isFaqModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveFaq}
            className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 border border-[#E0DCD3] text-xs"
          >
            <h3 className="font-display text-lg font-bold text-[#1A1C19]">
              {editingFaq ? 'Cập nhật Câu hỏi FAQ' : 'Thêm Câu hỏi FAQ mới'}
            </h3>

            <div>
              <label className="block font-semibold mb-1">Chủ đề chuẩn</label>
              <select
                value={faqForm.topic}
                onChange={(e) => setFaqForm({ ...faqForm, topic: e.target.value })}
                className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
              >
                {allowedTopics.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold mb-1">Câu hỏi (&lt;= 150 ký tự)</label>
              <input
                type="text"
                maxLength={150}
                required
                value={faqForm.title}
                onChange={(e) => setFaqForm({ ...faqForm, title: e.target.value })}
                className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1">Câu trả lời (SafeMarkdown, &lt;= 20.000 ký tự)</label>
              <textarea
                rows={5}
                maxLength={20000}
                required
                value={faqForm.content}
                onChange={(e) => setFaqForm({ ...faqForm, content: e.target.value })}
                className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsFaqModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-[#F5F2EB] font-semibold"
              >
                Đóng
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-[#2D4A3E] text-white font-semibold"
              >
                {saving ? 'Đang lưu...' : 'Lưu FAQ'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
