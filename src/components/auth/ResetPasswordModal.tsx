import React, { useState } from 'react';
import { X, Lock, AlertCircle, CheckCircle, Eye, EyeOff } from 'lucide-react';

interface ResetPasswordModalProps {
  isOpen: boolean;
  token: string;
  onClose: () => void;
  onSuccessLoginOpen: () => void;
}

export const ResetPasswordModal: React.FC<ResetPasswordModalProps> = ({
  isOpen,
  token,
  onClose,
  onSuccessLoginOpen,
}) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (newPassword.length < 8) {
      setErrorMessage('Mật khẩu mới phải có tối thiểu 8 ký tự');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('Mật khẩu mới và xác nhận mật khẩu không khớp');
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMessage(data.message || 'Đặt lại mật khẩu không thành công');
        return;
      }

      setIsSuccess(true);
      // Xóa query param token trên URL để không lộ token cũ
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch {
      setErrorMessage('Lỗi kết nối máy chủ. Vui lòng thử lại sau.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-xs" onClick={onClose} />

      {/* Modal Dialog */}
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-[#E0DCD3] overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-[#F0ECE1] flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-[#C27D56] uppercase tracking-wider">
              Bảo mật tài khoản
            </div>
            <h2 className="font-display text-xl font-bold text-[#1A1C19] mt-0.5">
              Đặt lại mật khẩu mới
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#8C877B] hover:text-[#1A1C19] hover:bg-[#F0ECE1] rounded-full transition-colors"
            aria-label="Đóng cửa sổ"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {isSuccess ? (
            <div className="text-center py-4 space-y-4">
              <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mx-auto text-emerald-600">
                <CheckCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="font-display text-base font-bold text-[#1A1C19]">
                  Đổi mật khẩu thành công!
                </h3>
                <p className="text-xs text-[#6B665C] leading-relaxed">
                  Tất cả các phiên đăng nhập cũ trên các thiết bị khác đã được vô hiệu hóa an toàn. Vui lòng đăng nhập bằng mật khẩu mới của bạn.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onSuccessLoginOpen();
                }}
                className="w-full py-2.5 bg-[#2D4A3E] text-white text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-[#233B31] transition-colors"
              >
                Đăng nhập ngay
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-xs text-[#6B665C]">
                Nhập mật khẩu mới cho tài khoản của bạn. Mật khẩu phải có tối thiểu 8 ký tự.
              </p>

              <div>
                <label className="block text-xs font-semibold text-[#4A4740] mb-1.5">
                  Mật khẩu mới
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#8C877B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Tối thiểu 8 ký tự"
                    className="w-full pl-9 pr-10 py-2.5 bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-xs text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8C877B] hover:text-[#1A1C19]"
                    aria-label="Hiện/Ẩn mật khẩu"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4A4740] mb-1.5">
                  Xác nhận mật khẩu mới
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#8C877B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Nhập lại mật khẩu mới"
                    className="w-full pl-9 pr-10 py-2.5 bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-xs text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E]"
                  />
                </div>
              </div>

              <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#E0DCD3] text-[11px] text-[#7A7569]">
                🔒 Sau khi cập nhật, tất cả các phiên đăng nhập trước đó sẽ tự động bị đăng xuất nhằm bảo đảm an toàn.
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 bg-[#2D4A3E] hover:bg-[#233B31] disabled:bg-[#7A8A82] text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-sm transition-colors"
              >
                {isLoading ? 'Đang cập nhật...' : 'Xác nhận đổi mật khẩu'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
