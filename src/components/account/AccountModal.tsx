import React, { useState, useEffect } from 'react';
import {
  X,
  User as UserIcon,
  MapPin,
  Lock,
  LogOut,
  Camera,
  Plus,
  Trash2,
  Edit2,
  AlertCircle,
  CheckCircle,
  Sparkles,
  Package,
} from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import { OrderHistory } from '../checkout/OrderHistory.tsx';
import { OrderDetail } from '../checkout/OrderDetail.tsx';
import type { User, Address, OrderRecord } from '../../types/index.ts';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onUpdateUser: (user: User) => void;
  onLogout: () => void;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUpdateUser,
  onLogout,
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'addresses' | 'orders' | 'security'>('profile');
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<OrderRecord | null>(null);

  // Profile Form State
  const [fullName, setFullName] = useState(currentUser.fullName || '');
  const [phone, setPhone] = useState(currentUser.phone || '');
  const [heightCm, setHeightCm] = useState<string>(currentUser.heightCm ? String(currentUser.heightCm) : '');
  const [weightKg, setWeightKg] = useState<string>(currentUser.weightKg ? String(currentUser.weightKg) : '');
  const [avatarUrl, setAvatarUrl] = useState<string>(currentUser.avatarUrl || '');

  // Address Book State
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [isLoadingAddresses, setIsLoadingAddresses] = useState(false);
  const [isAddingAddress, setIsAddingAddress] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);

  // Address Form State (Địa chỉ hành chính 2 cấp: Tỉnh/Thành phố + Phường/Xã)
  const [addrReceiverName, setAddrReceiverName] = useState('');
  const [addrPhone, setAddrPhone] = useState('');
  const [addrProvince, setAddrProvince] = useState('TP. Hồ Chí Minh');
  const [addrWard, setAddrWard] = useState('Phường Bến Nghé');
  const [addrStreet, setAddrStreet] = useState('');
  const [addrIsDefault, setAddrIsDefault] = useState(false);

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFullName(currentUser.fullName || '');
      setPhone(currentUser.phone || '');
      setHeightCm(currentUser.heightCm ? String(currentUser.heightCm) : '');
      setWeightKg(currentUser.weightKg ? String(currentUser.weightKg) : '');
      setAvatarUrl(currentUser.avatarUrl || '');
      fetchAddresses();
    }
  }, [isOpen, currentUser]);

  const showStatus = (type: 'success' | 'error', text: string) => {
    setStatusMessage({ type, text });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const fetchAddresses = async () => {
    setIsLoadingAddresses(true);
    try {
      const res = await apiRequest('/api/user/addresses');
      if (res.ok && res.data?.data) {
        setAddresses(res.data.data);
      }
    } catch (err) {
      console.error('Lỗi tải sổ địa chỉ:', err);
    } finally {
      setIsLoadingAddresses(false);
    }
  };

  // Tính gợi ý size nhanh theo chiều cao cân nặng
  const getSuggestedSize = (): string | null => {
    const h = parseInt(heightCm, 10);
    const w = parseInt(weightKg, 10);
    if (!h || !w) return null;
    if (h < 165 && w < 58) return 'S';
    if (h <= 170 && w <= 66) return 'M';
    if (h <= 176 && w <= 75) return 'L';
    if (h <= 182 && w <= 83) return 'XL';
    return 'XXL';
  };

  // 1. Cập nhật hồ sơ cá nhân
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const parsedH = heightCm ? parseInt(heightCm, 10) : null;
    const parsedW = weightKg ? parseInt(weightKg, 10) : null;

    if (parsedH !== null && (parsedH < 100 || parsedH > 230)) {
      showStatus('error', 'Chiều cao phải nằm trong khoảng từ 100cm đến 230cm');
      setIsLoading(false);
      return;
    }

    if (parsedW !== null && (parsedW < 30 || parsedW > 200)) {
      showStatus('error', 'Cân nặng phải nằm trong khoảng từ 30kg đến 200kg');
      setIsLoading(false);
      return;
    }

    try {
      const res = await apiRequest('/api/user/profile', {
        method: 'PUT',
        body: JSON.stringify({
          fullName,
          phone,
          avatarUrl,
          heightCm: parsedH,
          weightKg: parsedW,
        }),
      });

      if (!res.ok) {
        showStatus('error', res.errorMessage || 'Cập nhật hồ sơ thất bại');
        return;
      }

      onUpdateUser(res.data.data);
      showStatus('success', 'Đã lưu thông tin hồ sơ thành công!');
    } catch {
      showStatus('error', 'Không thể kết nối đến máy chủ.');
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Upload ảnh đại diện qua /api/upload
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      showStatus('error', 'Chỉ hỗ trợ file ảnh định dạng JPG, PNG hoặc WEBP');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showStatus('error', 'Dung lượng ảnh không được vượt quá 5MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = reader.result as string;
      try {
        const res = await apiRequest('/api/upload', {
          method: 'POST',
          body: JSON.stringify({ image: base64Data, filename: file.name }),
        });
        if (res.ok && res.data?.url) {
          setAvatarUrl(res.data.url);
          showStatus('success', 'Đã tải ảnh đại diện lên! Nhấn "Lưu hồ sơ" để hoàn tất.');
        } else {
          showStatus('error', res.errorMessage || 'Lỗi tải ảnh lên');
        }
      } catch {
        showStatus('error', 'Lỗi kết nối khi tải ảnh');
      }
    };
    reader.readAsDataURL(file);
  };

  // 3. Lưu hoặc sửa địa chỉ
  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const payload = {
      receiverName: addrReceiverName,
      phone: addrPhone,
      province: addrProvince,
      district: null,
      ward: addrWard,
      streetAddress: addrStreet,
      isDefault: addrIsDefault,
    };

    try {
      const url = editingAddressId ? `/api/user/addresses/${editingAddressId}` : '/api/user/addresses';
      const method = editingAddressId ? 'PUT' : 'POST';

      const res = await apiRequest(url, {
        method,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        showStatus('error', res.errorMessage || 'Không thể lưu địa chỉ');
        return;
      }

      showStatus('success', res.data?.message || 'Đã lưu địa chỉ');
      setIsAddingAddress(false);
      setEditingAddressId(null);
      resetAddressForm();
      fetchAddresses();
    } catch {
      showStatus('error', 'Lỗi kết nối khi lưu địa chỉ');
    } finally {
      setIsLoading(false);
    }
  };

  const resetAddressForm = () => {
    setAddrReceiverName('');
    setAddrPhone('');
    setAddrStreet('');
    setAddrIsDefault(false);
  };

  const handleEditAddress = (addr: Address) => {
    setEditingAddressId(addr.id);
    setAddrReceiverName(addr.receiverName);
    setAddrPhone(addr.phone);
    setAddrProvince(addr.province);
    setAddrWard(addr.ward);
    setAddrStreet(addr.streetAddress);
    setAddrIsDefault(addr.isDefault);
    setIsAddingAddress(true);
  };

  const handleDeleteAddress = async (id: string) => {
    try {
      const res = await apiRequest(`/api/user/addresses/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showStatus('success', 'Đã xóa địa chỉ');
        fetchAddresses();
      } else {
        showStatus('error', res.errorMessage || 'Lỗi xóa địa chỉ');
      }
    } catch {
      showStatus('error', 'Lỗi xóa địa chỉ');
    }
  };

  const handleSetDefaultAddress = async (id: string) => {
    try {
      const res = await apiRequest(`/api/user/addresses/${id}/set-default`, { method: 'PUT' });
      if (res.ok) {
        showStatus('success', 'Đã đặt làm địa chỉ mặc định');
        fetchAddresses();
      } else {
        showStatus('error', res.errorMessage || 'Lỗi thiết lập địa chỉ mặc định');
      }
    } catch {
      showStatus('error', 'Lỗi thiết lập địa chỉ mặc định');
    }
  };

  // 4. Đổi mật khẩu
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      showStatus('error', 'Mật khẩu mới và xác nhận mật khẩu không khớp');
      return;
    }
    if (newPassword.length < 8) {
      showStatus('error', 'Mật khẩu mới phải có tối thiểu 8 ký tự');
      return;
    }

    setIsLoading(true);
    try {
      const res = await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!res.ok) {
        showStatus('error', res.errorMessage || 'Đổi mật khẩu thất bại');
        return;
      }

      showStatus('success', res.data?.message || 'Đã đổi mật khẩu');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      showStatus('error', 'Lỗi kết nối khi đổi mật khẩu');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const suggestedSize = getSuggestedSize();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-xs" onClick={onClose} />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-[#E0DCD3] overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#F0ECE1] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#2D4A3E] text-white flex items-center justify-center font-bold text-sm">
              {currentUser.fullName ? currentUser.fullName.slice(0, 1).toUpperCase() : 'U'}
            </div>
            <div>
              <div className="font-display text-base font-bold text-[#1A1C19] flex items-center gap-2">
                <span>{currentUser.fullName}</span>
                <span className="text-[10px] px-2 py-0.5 bg-[#FAF3EA] text-[#C27D56] font-semibold border border-[#E8DFC8] rounded-xs uppercase">
                  {currentUser.role === 'admin' ? 'Người bán (Admin)' : 'Khách hàng'}
                </span>
              </div>
              <div className="text-xs text-[#7A7569]">{currentUser.email}</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#8C877B] hover:text-[#1A1C19] hover:bg-[#F0ECE1] rounded-full transition-colors"
            aria-label="Đóng cửa sổ"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-[#F0ECE1] px-6 gap-6 text-xs font-semibold shrink-0 overflow-x-auto">
          <button
            onClick={() => setActiveTab('profile')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'profile'
                ? 'border-[#2D4A3E] text-[#2D4A3E]'
                : 'border-transparent text-[#6B665C] hover:text-[#1A1C19]'
            }`}
          >
            <UserIcon className="w-4 h-4" />
            <span>Hồ sơ & Số đo</span>
          </button>
          <button
            onClick={() => setActiveTab('addresses')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'addresses'
                ? 'border-[#2D4A3E] text-[#2D4A3E]'
                : 'border-transparent text-[#6B665C] hover:text-[#1A1C19]'
            }`}
          >
            <MapPin className="w-4 h-4" />
            <span>Sổ địa chỉ ({addresses.length})</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('orders');
              setSelectedOrderDetail(null);
            }}
            className={`py-3 flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'orders'
                ? 'border-[#2D4A3E] text-[#2D4A3E]'
                : 'border-transparent text-[#6B665C] hover:text-[#1A1C19]'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>Đơn hàng của tôi</span>
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'security'
                ? 'border-[#2D4A3E] text-[#2D4A3E]'
                : 'border-transparent text-[#6B665C] hover:text-[#1A1C19]'
            }`}
          >
            <Lock className="w-4 h-4" />
            <span>Đổi mật khẩu</span>
          </button>
        </div>

        {/* Status Toast */}
        {statusMessage && (
          <div
            className={`mx-6 mt-4 p-3 rounded-xl border flex items-center gap-2.5 text-xs ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Scrollable Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* TAB 1: HỒ SƠ & SỐ ĐO */}
          {activeTab === 'profile' && (
            <form onSubmit={handleSaveProfile} className="space-y-5">
              {/* Ảnh đại diện & Upload */}
              <div className="flex items-center gap-4">
                <div className="relative w-16 h-16 rounded-full overflow-hidden bg-[#F0ECE1] border-2 border-[#2D4A3E]/20">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={fullName} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#2D4A3E] font-bold text-xl">
                      {fullName ? fullName.slice(0, 1).toUpperCase() : 'U'}
                    </div>
                  )}
                  <label
                    htmlFor="avatar-upload"
                    className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 flex items-center justify-center text-white cursor-pointer transition-opacity"
                    title="Đổi ảnh đại diện"
                  >
                    <Camera className="w-5 h-5" />
                  </label>
                  <input
                    id="avatar-upload"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleAvatarChange}
                  />
                </div>
                <div>
                  <label
                    htmlFor="avatar-upload"
                    className="cursor-pointer text-xs font-semibold text-[#2D4A3E] hover:underline"
                  >
                    Tải ảnh mới lên (JPG, PNG, WebP &lt; 5MB)
                  </label>
                  <p className="text-[11px] text-[#7A7569] mt-0.5">
                    Hình ảnh đại diện cho tài khoản của bạn tại Baity
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#4A4740] mb-1">Họ và tên</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-3 py-2 bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-xs text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E] focus:bg-white transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#4A4740] mb-1">Số điện thoại</label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-xs text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E] focus:bg-white transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#4A4740] mb-1">Email (Cố định)</label>
                  <input
                    type="email"
                    disabled
                    value={currentUser.email}
                    className="w-full px-3 py-2 bg-[#F0ECE1] border border-[#E0DCD3] rounded-lg text-xs text-[#7A7569] cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#4A4740] mb-1">Vai trò tài khoản</label>
                  <div className="px-3 py-2 bg-[#F0ECE1] border border-[#E0DCD3] rounded-lg text-xs font-semibold text-[#2D4A3E]">
                    {currentUser.role === 'admin' ? 'Quản trị viên (Người bán)' : 'Khách hàng thành viên'}
                  </div>
                </div>
              </div>

              {/* Mục Số Đo Cá Nhân để AI gợi ý size */}
              <div className="p-4 bg-[#FAF8F5] rounded-xl border border-[#E5E0D5] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-[#2D4A3E] flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-[#C27D56]" />
                    <span>Số đo vóc dáng cá nhân (Tự động gợi ý size)</span>
                  </div>
                  {suggestedSize && (
                    <span className="px-2.5 py-1 bg-[#2D4A3E] text-white text-[11px] font-bold rounded-md">
                      Size vừa vặn: {suggestedSize}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-medium text-[#6B665C] mb-1">
                      Chiều cao (100 – 230 cm)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min={100}
                        max={230}
                        value={heightCm}
                        onChange={(e) => setHeightCm(e.target.value)}
                        placeholder="172"
                        className="w-full px-3 py-2 bg-white border border-[#D5D0C5] rounded-lg text-xs text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E]"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#8C877B]">cm</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-[#6B665C] mb-1">
                      Cân nặng (30 – 200 kg)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min={30}
                        max={200}
                        value={weightKg}
                        onChange={(e) => setWeightKg(e.target.value)}
                        placeholder="65"
                        className="w-full px-3 py-2 bg-white border border-[#D5D0C5] rounded-lg text-xs text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E]"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#8C877B]">kg</span>
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-[#7A7569]">
                  Lưu số đo để hệ thống tự động chọn size chuẩn nhất cho bạn khi xem từng sản phẩm thời trang.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-6 py-2.5 bg-[#2D4A3E] hover:bg-[#233B31] disabled:bg-[#7A8A82] text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-sm transition-colors"
                >
                  {isLoading ? 'Đang lưu...' : 'Lưu thay đổi hồ sơ'}
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: SỔ ĐỊA CHỈ */}
          {activeTab === 'addresses' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-[#1A1C19]">Địa chỉ nhận hàng</h3>
                  <p className="text-[11px] text-[#7A7569]">Quản lý các địa chỉ giao hàng khi đặt sắm tại Baity</p>
                </div>
                {!isAddingAddress && (
                  <button
                    onClick={() => {
                      resetAddressForm();
                      setEditingAddressId(null);
                      setIsAddingAddress(true);
                    }}
                    className="px-3 py-1.5 bg-[#2D4A3E] text-white hover:bg-[#233B31] text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm địa chỉ</span>
                  </button>
                )}
              </div>

              {/* Form Thêm/Sửa địa chỉ */}
              {isAddingAddress && (
                <form onSubmit={handleSaveAddress} className="p-4 bg-[#FAF8F5] rounded-xl border border-[#D5D0C5] space-y-3">
                  <div className="text-xs font-bold text-[#2D4A3E]">
                    {editingAddressId ? 'Chỉnh sửa địa chỉ' : 'Thêm địa chỉ giao hàng mới'}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-[#4A4740] mb-1">Họ tên người nhận</label>
                      <input
                        type="text"
                        required
                        value={addrReceiverName}
                        onChange={(e) => setAddrReceiverName(e.target.value)}
                        placeholder="Trần Hoàng Nam"
                        className="w-full px-3 py-2 bg-white border border-[#D5D0C5] rounded-lg text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#4A4740] mb-1">Số điện thoại</label>
                      <input
                        type="tel"
                        required
                        value={addrPhone}
                        onChange={(e) => setAddrPhone(e.target.value)}
                        placeholder="0912345678"
                        className="w-full px-3 py-2 bg-white border border-[#D5D0C5] rounded-lg text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-[#4A4740] mb-1">Tỉnh / Thành phố</label>
                      <input
                        type="text"
                        required
                        value={addrProvince}
                        onChange={(e) => setAddrProvince(e.target.value)}
                        placeholder="TP. Hồ Chí Minh"
                        className="w-full px-3 py-2 bg-white border border-[#D5D0C5] rounded-lg text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#4A4740] mb-1">Phường / Xã</label>
                      <input
                        type="text"
                        required
                        value={addrWard}
                        onChange={(e) => setAddrWard(e.target.value)}
                        placeholder="Phường Bến Nghé"
                        className="w-full px-3 py-2 bg-white border border-[#D5D0C5] rounded-lg text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-[#4A4740] mb-1">Địa chỉ chi tiết (Số nhà, tên đường)</label>
                    <input
                      type="text"
                      required
                      value={addrStreet}
                      onChange={(e) => setAddrStreet(e.target.value)}
                      placeholder="123 Đường Lê Lợi"
                      className="w-full px-3 py-2 bg-white border border-[#D5D0C5] rounded-lg text-xs"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="default-addr"
                      checked={addrIsDefault}
                      onChange={(e) => setAddrIsDefault(e.target.checked)}
                      className="w-4 h-4 text-[#2D4A3E] rounded border-gray-300 focus:ring-[#2D4A3E]"
                    />
                    <label htmlFor="default-addr" className="text-xs text-[#4A4740]">
                      Đặt làm địa chỉ giao hàng mặc định
                    </label>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingAddress(false);
                        setEditingAddressId(null);
                      }}
                      className="px-4 py-2 border border-[#D5D0C5] text-xs font-semibold rounded-lg hover:bg-white"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="px-5 py-2 bg-[#2D4A3E] hover:bg-[#233B31] text-white text-xs font-bold rounded-lg"
                    >
                      {editingAddressId ? 'Lưu cập nhật' : 'Thêm địa chỉ'}
                    </button>
                  </div>
                </form>
              )}

              {/* Danh sách địa chỉ đã lưu */}
              {isLoadingAddresses ? (
                <div className="text-center py-6 text-xs text-[#7A7569]">Đang nạp sổ địa chỉ...</div>
              ) : addresses.length === 0 ? (
                <div className="text-center py-8 bg-[#FAF8F5] rounded-xl border border-dashed border-[#D5D0C5] text-xs text-[#7A7569]">
                  Chưa có địa chỉ giao hàng nào. Vui lòng bấm "Thêm địa chỉ".
                </div>
              ) : (
                <div className="space-y-3">
                  {addresses.map((addr) => (
                    <div
                      key={addr.id}
                      className={`p-4 rounded-xl border transition-all ${
                        addr.isDefault
                          ? 'bg-[#FAF8F5] border-[#2D4A3E] ring-1 ring-[#2D4A3E]/30'
                          : 'bg-white border-[#E0DCD3] hover:border-[#D0C9BC]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[#1A1C19]">{addr.receiverName}</span>
                            <span className="text-xs text-[#7A7569]">·</span>
                            <span className="text-xs text-[#7A7569]">{addr.phone}</span>
                            {addr.isDefault && (
                              <span className="px-2 py-0.5 bg-[#2D4A3E] text-white text-[10px] font-bold rounded-xs tracking-wide">
                                Mặc định
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[#4A4740]">
                            {[addr.streetAddress, addr.ward, addr.district, addr.province]
                              .filter(Boolean)
                              .join(', ')}
                          </div>
                        </div>

                        {/* Các nút thao tác */}
                        <div className="flex items-center gap-2 shrink-0">
                          {!addr.isDefault && (
                            <button
                              onClick={() => handleSetDefaultAddress(addr.id)}
                              className="px-2.5 py-1 text-[11px] font-semibold text-[#2D4A3E] hover:bg-[#F0ECE1] rounded border border-[#D5D0C5] transition-colors"
                            >
                              Đặt mặc định
                            </button>
                          )}
                          <button
                            onClick={() => handleEditAddress(addr)}
                            className="p-1.5 text-[#6B665C] hover:text-[#2D4A3E] hover:bg-[#F0ECE1] rounded transition-colors"
                            title="Sửa địa chỉ"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteAddress(addr.id)}
                            className="p-1.5 text-[#6B665C] hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Xóa địa chỉ"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2.5: LỊCH SỬ & CHI TIẾT ĐƠN HÀNG (GIAI ĐOẠN 5) */}
          {activeTab === 'orders' && (
            <div className="space-y-4">
              {selectedOrderDetail ? (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setSelectedOrderDetail(null)}
                    className="text-xs font-semibold text-[#2D4A3E] hover:underline"
                  >
                    ← Quay lại danh sách đơn hàng
                  </button>
                  <OrderDetail
                    order={selectedOrderDetail}
                    onOrderUpdated={(updated) => setSelectedOrderDetail(updated)}
                    onCartRefresh={() => {}}
                    showToast={(msg) => showStatus('success', msg)}
                  />
                </div>
              ) : (
                <OrderHistory
                  onSelectOrder={(ord) => setSelectedOrderDetail(ord)}
                  onCartRefresh={() => {}}
                  showToast={(msg) => showStatus('success', msg)}
                />
              )}
            </div>
          )}

          {/* TAB 3: BẢO MẬT & ĐỔI MẬT KHẨU */}
          {activeTab === 'security' && (
            <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
              <div>
                <label className="block text-xs font-semibold text-[#4A4740] mb-1">Mật khẩu hiện tại</label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-xs text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4A4740] mb-1">
                  Mật khẩu mới (tối thiểu 8 ký tự)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-xs text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4A4740] mb-1">Xác nhận mật khẩu mới</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-xs text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E]"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-2.5 bg-[#2D4A3E] hover:bg-[#233B31] disabled:bg-[#7A8A82] text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-sm transition-colors"
                >
                  {isLoading ? 'Đang cập nhật...' : 'Cập nhật mật khẩu mới'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Footer with Logout */}
        <div className="px-6 py-3.5 bg-[#FAF8F5] border-t border-[#F0ECE1] flex items-center justify-between shrink-0">
          <div className="text-[11px] text-[#7A7569]">
            Phiên đăng nhập an toàn với cookie httpOnly SameSite=lax
          </div>
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Đăng xuất</span>
          </button>
        </div>
      </div>
    </div>
  );
};
