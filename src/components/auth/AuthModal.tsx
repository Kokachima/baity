import React, { useState } from 'react';
import { X, Mail, Lock, User as UserIcon, Phone, AlertCircle, CheckCircle, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import type { User } from '../../types/index.ts';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: User) => void;
  initialMode?: 'login' | 'register' | 'forgot';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialMode = 'login',
}) => {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(initialMode);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');

  if (!isOpen) return null;

  const resetForm = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleSwitchMode = (newMode: 'login' | 'register' | 'forgot') => {
    resetForm();
    setMode(newMode);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        setErrorMessage(res.errorMessage || 'Đăng nhập không thành công');
        return;
      }

      onSuccess(res.data.user);
      onClose();
    } catch {
      setErrorMessage('Không thể kết nối đến máy chủ. Vui lòng thử lại sau.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (password.length < 8) {
      setErrorMessage('Mật khẩu phải có tối thiểu 8 ký tự');
      return;
    }

    setIsLoading(true);

    try {
      const res = await apiRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          fullName,
          email,
          phone,
          password,
        }),
      });

      if (!res.ok) {
        setErrorMessage(res.errorMessage || 'Đăng ký không thành công');
        return;
      }

      onSuccess(res.data.user);
      onClose();
    } catch {
      setErrorMessage('Không thể kết nối đến máy chủ. Vui lòng thử lại sau.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsLoading(true);

    try {
      const res = await apiRequest('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });

      setSuccessMessage(res.data?.message || 'Đã gửi yêu cầu đặt lại mật khẩu');
    } catch {
      setErrorMessage('Có lỗi xảy ra khi gửi yêu cầu. Vui lòng thử lại.');
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
              {mode === 'login' ? 'Tài khoản Baity' : mode === 'register' ? 'Đăng ký thành viên' : 'Khôi phục mật khẩu'}
            </div>
            <h2 className="font-display text-xl font-bold text-[#1A1C19] mt-0.5">
              {mode === 'login' ? 'Chào mừng bạn quay lại' : mode === 'register' ? 'Tạo tài khoản mới' : 'Quên mật khẩu?'}
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
          {/* Thông báo lỗi */}
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-700">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Thông báo thành công */}
          {successMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5 text-xs text-emerald-800 leading-relaxed">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* 1. FORM ĐĂNG NHẬP */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#4A4740] mb-1.5">Địa chỉ Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#8C877B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full pl-9 pr-3 py-2.5 bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-xs text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E] focus:bg-white transition-colors"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[#4A4740]">Mật khẩu</label>
                  <button
                    type="button"
                    onClick={() => handleSwitchMode('forgot')}
                    className="text-xs text-[#2D4A3E] hover:underline font-medium"
                  >
                    Quên mật khẩu?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#8C877B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-10 py-2.5 bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-xs text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E] focus:bg-white transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8C877B] hover:text-[#1A1C19]"
                    aria-label="Hiện mật khẩu"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 bg-[#2D4A3E] hover:bg-[#233B31] disabled:bg-[#7A8A82] text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <span>Đang đăng nhập...</span>
                ) : (
                  <>
                    <span>Đăng nhập</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              {/* Tài khoản demo gợi ý nhanh cho đồ án */}
              <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#E8E4DA] text-[11px] text-[#6B665C] space-y-1">
                <div className="font-semibold text-[#2D4A3E]">Tài khoản demo sẵn có:</div>
                <div>Admin: <code>admin@baity.vn</code> / <code>Admin@123</code></div>
                <div>Khách: <code>khach1@baity.vn</code> / <code>Khach@123</code></div>
              </div>

              <div className="text-center pt-2 text-xs text-[#6B665C]">
                Chưa có tài khoản?{' '}
                <button
                  type="button"
                  onClick={() => handleSwitchMode('register')}
                  className="text-[#2D4A3E] font-bold hover:underline"
                >
                  Đăng ký ngay
                </button>
              </div>
            </form>
          )}

          {/* 2. FORM ĐĂNG KÝ */}
          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#4A4740] mb-1">Họ và tên</label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-[#8C877B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Nguyễn Văn A"
                    className="w-full pl-9 pr-3 py-2 bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-xs text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E] focus:bg-white transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4A4740] mb-1">Địa chỉ Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#8C877B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full pl-9 pr-3 py-2 bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-xs text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E] focus:bg-white transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4A4740] mb-1">Số điện thoại</label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-[#8C877B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0912345678"
                    className="w-full pl-9 pr-3 py-2 bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-xs text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E] focus:bg-white transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4A4740] mb-1">Mật khẩu (tối thiểu 8 ký tự)</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#8C877B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Ít nhất 8 ký tự"
                    className="w-full pl-9 pr-10 py-2 bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-xs text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E] focus:bg-white transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8C877B] hover:text-[#1A1C19]"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 bg-[#2D4A3E] hover:bg-[#233B31] disabled:bg-[#7A8A82] text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 mt-2"
              >
                {isLoading ? <span>Đang tạo tài khoản...</span> : <span>Tạo tài khoản Baity</span>}
              </button>

              <div className="text-center pt-2 text-xs text-[#6B665C]">
                Đã có tài khoản?{' '}
                <button
                  type="button"
                  onClick={() => handleSwitchMode('login')}
                  className="text-[#2D4A3E] font-bold hover:underline"
                >
                  Đăng nhập
                </button>
              </div>
            </form>
          )}

          {/* 3. FORM QUÊN MẬT KHẨU */}
          {mode === 'forgot' && (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <p className="text-xs text-[#6B665C] leading-relaxed">
                Nhập địa chỉ email tài khoản của bạn. Hệ thống sẽ gửi hướng dẫn khôi phục mật khẩu có hiệu lực trong vòng 15 phút.
              </p>

              <div>
                <label className="block text-xs font-semibold text-[#4A4740] mb-1.5">Địa chỉ Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#8C877B] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full pl-9 pr-3 py-2.5 bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-xs text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E] focus:bg-white transition-colors"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 bg-[#2D4A3E] hover:bg-[#233B31] disabled:bg-[#7A8A82] text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2"
              >
                {isLoading ? <span>Đang gửi yêu cầu...</span> : <span>Gửi link đặt lại mật khẩu</span>}
              </button>

              <div className="text-center pt-2 text-xs text-[#6B665C]">
                Nhớ mật khẩu rồi?{' '}
                <button
                  type="button"
                  onClick={() => handleSwitchMode('login')}
                  className="text-[#2D4A3E] font-bold hover:underline"
                >
                  Quay lại đăng nhập
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
