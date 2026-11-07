import React, { useState, useEffect, useCallback } from 'react';
import { Settings, Save, RefreshCw, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';

interface StoreSettingsPageProps {
  onShowToast?: (msg: string) => void;
  onRefreshOverview?: () => void;
}

export const StoreSettingsPage: React.FC<StoreSettingsPageProps> = ({
  onShowToast,
  onRefreshOverview,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string>('');
  const [vietqrReadOnly, setVietqrReadOnly] = useState<any>(null);

  const [contact, setContact] = useState({
    storeName: 'BAITY',
    hotline: '',
    email: '',
    address: '',
    workingHours: '',
    legalEntityName: '',
    taxId: '',
    returnAddress: '',
  });

  const [shipping, setShipping] = useState({
    standardShippingFee: 30000,
    expressShippingFee: 50000,
    freeShippingThreshold: 500000,
  });

  const [returns, setReturns] = useState({
    returnDaysLimit: 7,
  });

  const [inventory, setInventory] = useState({
    lowStockThreshold: 5,
  });

  const [bannerText, setBannerText] = useState('');

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiRequest('/api/admin/settings');
    if (!res.ok) {
      setError(res.errorMessage || 'Không thể tải cài đặt cửa hàng');
      setLoading(false);
      return;
    }

    const d = res.data;
    setContact({
      storeName: d?.contact?.storeName || 'BAITY',
      hotline: d?.contact?.hotline || '',
      email: d?.contact?.email || '',
      address: d?.contact?.address || '',
      workingHours: d?.contact?.workingHours || '',
      legalEntityName: d?.contact?.legalEntityName || '',
      taxId: d?.contact?.taxId || '',
      returnAddress: d?.contact?.returnAddress || '',
    });
    setShipping({
      standardShippingFee: Number(d?.shipping?.standardShippingFee ?? 30000),
      expressShippingFee: Number(d?.shipping?.expressShippingFee ?? 50000),
      freeShippingThreshold: Number(d?.shipping?.freeShippingThreshold ?? 500000),
    });
    setReturns({
      returnDaysLimit: Number(d?.returns?.returnDaysLimit ?? 7),
    });
    setInventory({
      lowStockThreshold: Number(d?.inventory?.lowStockThreshold ?? 5),
    });
    setBannerText(d?.bannerText || '');
    setVietqrReadOnly(d?.vietqrReadOnly || null);
    setExpectedUpdatedAt(d?.updatedAt || '');
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    const res = await apiRequest('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        contact,
        shipping: {
          standardShippingFee: Number(shipping.standardShippingFee),
          expressShippingFee: Number(shipping.expressShippingFee),
          freeShippingThreshold: Number(shipping.freeShippingThreshold),
        },
        returns: {
          returnDaysLimit: Number(returns.returnDaysLimit),
        },
        inventory: {
          lowStockThreshold: Number(inventory.lowStockThreshold),
        },
        bannerText: bannerText.trim() || null,
        expectedUpdatedAt: expectedUpdatedAt || undefined,
      }),
    });

    setSaving(false);
    if (!res.ok) {
      setError(res.errorMessage || 'Lỗi cập nhật cài đặt cửa hàng');
      return;
    }

    setExpectedUpdatedAt(res.data?.updatedAt || '');
    setSuccessMsg('Đã lưu cài đặt cửa hàng thành công. Hiệu lực tức thì trên toàn hệ thống.');
    onShowToast?.('Đã lưu cài đặt cửa hàng');
    onRefreshOverview?.();
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-xs text-[#6B665C] bg-white rounded-2xl border border-[#E0DCD3]">
        Đang tải cài đặt cửa hàng...
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSave}
      className="space-y-6"
      data-testid="admin-store-settings-page"
    >
      <div className="bg-white rounded-2xl border border-[#E0DCD3] p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-[#1A1C19] flex items-center gap-2">
              <Settings className="w-5 h-5 text-[#2D4A3E]" />
              <span>Cài đặt Cửa hàng (Store Settings)</span>
            </h2>
            <p className="text-xs text-[#6B665C] mt-0.5">
              Cấu hình liên hệ, phí vận chuyển, thời hạn đổi trả, ngưỡng tồn kho và thanh thông báo đầu trang.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadSettings}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-[#F5F2EB] rounded-lg"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Tải lại</span>
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#2D4A3E] text-white rounded-lg"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Đang lưu...' : 'Lưu cài đặt'}</span>
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

        {/* 1. Nhóm thông tin liên hệ & pháp nhân */}
        <div className="space-y-3">
          <h3 className="font-bold text-sm text-[#1A1C19] border-b border-[#E8E4DA] pb-1.5">
            1. Thông tin Liên hệ & Pháp nhân (contact)
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-semibold mb-1">Tên cửa hàng (&lt;= 80 ký tự)</label>
              <input
                type="text"
                maxLength={80}
                required
                value={contact.storeName}
                onChange={(e) => setContact({ ...contact, storeName: e.target.value })}
                className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Số điện thoại / Hotline (định dạng VN)</label>
              <input
                type="text"
                value={contact.hotline}
                onChange={(e) => setContact({ ...contact, hotline: e.target.value })}
                placeholder="VD: 0901234567 hoặc 19001234"
                className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Email hỗ trợ khách hàng</label>
              <input
                type="email"
                value={contact.email}
                onChange={(e) => setContact({ ...contact, email: e.target.value })}
                placeholder="VD: support@ten-cua-hang.vn"
                className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Giờ làm việc (&lt;= 100 ký tự)</label>
              <input
                type="text"
                maxLength={100}
                value={contact.workingHours}
                onChange={(e) => setContact({ ...contact, workingHours: e.target.value })}
                placeholder="VD: 08:30 - 21:30 (Thứ 2 - Chủ Nhật)"
                className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-semibold mb-1">Địa chỉ cửa hàng (&lt;= 200 ký tự)</label>
              <input
                type="text"
                maxLength={200}
                value={contact.address}
                onChange={(e) => setContact({ ...contact, address: e.target.value })}
                className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Tên đơn vị / Pháp nhân (&lt;= 150 ký tự)</label>
              <input
                type="text"
                maxLength={150}
                value={contact.legalEntityName}
                onChange={(e) => setContact({ ...contact, legalEntityName: e.target.value })}
                className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Mã số thuế (10 hoặc 13 chữ số)</label>
              <input
                type="text"
                value={contact.taxId}
                onChange={(e) => setContact({ ...contact, taxId: e.target.value })}
                placeholder="VD: 0101234567"
                className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-semibold mb-1">Địa chỉ kho nhận hàng đổi trả (&lt;= 200 ký tự)</label>
              <input
                type="text"
                maxLength={200}
                value={contact.returnAddress}
                onChange={(e) => setContact({ ...contact, returnAddress: e.target.value })}
                className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
              />
            </div>
          </div>
        </div>

        {/* 2. Vận chuyển, Đổi trả & Tồn kho */}
        <div className="space-y-3">
          <h3 className="font-bold text-sm text-[#1A1C19] border-b border-[#E8E4DA] pb-1.5">
            2. Vận chuyển (shipping), Đổi trả (returns), Tồn kho (inventory) & Banner
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block font-semibold mb-1">Phí giao tiêu chuẩn (0 – 500.000₫)</label>
              <input
                type="number"
                min={0}
                max={500000}
                required
                value={shipping.standardShippingFee}
                onChange={(e) =>
                  setShipping({ ...shipping, standardShippingFee: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Phí giao hỏa tốc (0 – 500.000₫)</label>
              <input
                type="number"
                min={0}
                max={500000}
                required
                value={shipping.expressShippingFee}
                onChange={(e) =>
                  setShipping({ ...shipping, expressShippingFee: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Ngưỡng miễn phí ship (0 – 10.000.000₫)</label>
              <input
                type="number"
                min={0}
                max={10000000}
                required
                value={shipping.freeShippingThreshold}
                onChange={(e) =>
                  setShipping({ ...shipping, freeShippingThreshold: Number(e.target.value) })
                }
                className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Thời hạn đổi trả (1 – 30 ngày)</label>
              <input
                type="number"
                min={1}
                max={30}
                required
                value={returns.returnDaysLimit}
                onChange={(e) => setReturns({ returnDaysLimit: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
              />
              <span className="text-[10px] text-[#6B665C]">
                Đơn đã giao trước thời điểm giảm số ngày đổi trả vẫn được giữ số ngày cũ cao hơn.
              </span>
            </div>
            <div>
              <label className="block font-semibold mb-1">Ngưỡng cảnh báo sắp hết hàng (0 – 1.000)</label>
              <input
                type="number"
                min={0}
                max={1000}
                required
                value={inventory.lowStockThreshold}
                onChange={(e) => setInventory({ lowStockThreshold: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Thanh thông báo đầu trang (&lt;= 120 ký tự)</label>
              <input
                type="text"
                maxLength={120}
                value={bannerText}
                onChange={(e) => setBannerText(e.target.value)}
                placeholder="VD: BST Thu Đông mới đã lên kệ"
                className="w-full px-3 py-2 border border-[#D8D3C8] rounded-lg"
              />
            </div>
          </div>
        </div>

        {/* 3. Trạng thái VietQR chỉ đọc từ biến môi trường */}
        <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[#E8E4DA] space-y-1.5 text-xs">
          <div className="font-bold text-[#1A1C19] flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-[#2D4A3E]" />
            <span>Thông tin thụ hưởng VietQR (Chỉ đọc từ biến môi trường Server)</span>
          </div>
          <p className="text-[11px] text-[#6B665C]">
            Để đảm bảo an toàn tuyệt đối, hệ thống <strong>không lưu và không cho sửa</strong> số tài khoản nhận tiền, khóa API hay bí mật trong CSDL.
          </p>
          {vietqrReadOnly?.isConfigured ? (
            <div className="pt-1 text-[#1A1C19]">
              Ngân hàng: <strong>{vietqrReadOnly.bankName || vietqrReadOnly.bankId}</strong> · Số tài khoản:{' '}
              <strong className="font-mono">{vietqrReadOnly.accountNumberMasked}</strong>
            </div>
          ) : (
            <div className="pt-1 text-amber-800">Chưa cấu hình biến môi trường VietQR.</div>
          )}
        </div>
      </div>
    </form>
  );
};
