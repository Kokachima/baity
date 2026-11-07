import React from 'react';
import { X, Camera, ChevronRight, User as UserIcon, Ruler, HelpCircle } from 'lucide-react';
import type { TargetGender, Category, User } from '../../types/index.ts';

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  onSelectGender: (gender: TargetGender | 'all') => void;
  onOpenImageSearch: () => void;
  onOpenSizeGuide: () => void;
  currentUser?: User | null;
  onOpenAuth: () => void;
  onOpenAccount: () => void;
}

export const MobileDrawer: React.FC<MobileDrawerProps> = ({
  isOpen,
  onClose,
  categories,
  onSelectGender,
  onOpenImageSearch,
  onOpenSizeGuide,
  currentUser,
  onOpenAuth,
  onOpenAccount,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden flex">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Container */}
      <div className="relative w-4/5 max-w-sm bg-[#FAF8F5] h-full shadow-2xl flex flex-col z-10 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#E8E4DA]">
          <span className="font-display text-xl font-bold tracking-widest text-[#2D4A3E]">
            BAITY
          </span>
          <button
            onClick={onClose}
            className="p-1.5 text-[#4A4740] hover:text-[#1A1C19] rounded-md"
            aria-label="Đóng menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Khối tài khoản người dùng */}
        <div className="p-4 bg-white border-b border-[#E8E4DA]">
          {currentUser ? (
            <div
              onClick={() => {
                onClose();
                onOpenAccount();
              }}
              className="flex items-center gap-3 cursor-pointer p-2 rounded-xl hover:bg-[#FAF8F5] transition-colors"
            >
              <div className="w-9 h-9 rounded-full bg-[#2D4A3E] text-white flex items-center justify-center font-bold text-xs shrink-0">
                {currentUser.fullName ? currentUser.fullName.slice(0, 1).toUpperCase() : 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-[#1A1C19] truncate">{currentUser.fullName}</div>
                <div className="text-[11px] text-[#7A7569] truncate">Hồ sơ, sổ địa chỉ & bảo mật</div>
              </div>
              <ChevronRight className="w-4 h-4 text-[#8C877B] shrink-0" />
            </div>
          ) : (
            <button
              onClick={() => {
                onClose();
                onOpenAuth();
              }}
              className="w-full py-2.5 px-4 bg-[#2D4A3E] text-white text-xs font-bold rounded-lg flex items-center justify-center gap-2 shadow-2xs hover:bg-[#233B31] transition-colors"
            >
              <UserIcon className="w-4 h-4" />
              <span>Đăng nhập / Đăng ký</span>
            </button>
          )}
        </div>

        {/* Nút hành động nổi bật: Tìm bằng ảnh AI */}
        <div className="p-4 bg-[#F2EFE9] border-b border-[#E8E4DA]">
          <button
            onClick={() => {
              onClose();
              onOpenImageSearch();
            }}
            className="w-full flex items-center justify-between p-3 bg-[#2D4A3E] text-white rounded-xl shadow-xs hover:bg-[#233B31] transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <Camera className="w-5 h-5 text-[#E6B89C]" />
              <div className="text-left">
                <div className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span>Tìm kiếm bằng ảnh AI</span>
                </div>
                <div className="text-[11px] text-white/80">Tải ảnh hoặc chụp camera để tìm mẫu tương tự</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-white/60" />
          </button>
        </div>

        {/* Menu Đối tượng */}
        <div className="p-5 border-b border-[#E8E4DA]">
          <div className="text-[11px] font-bold text-[#8C877B] uppercase tracking-wider mb-3">
            Đối tượng mua sắm
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => {
                onSelectGender('men');
                onClose();
              }}
              className="py-2.5 px-3 text-center text-xs font-semibold rounded-lg bg-white border border-[#E0DCD3] hover:border-[#2D4A3E] hover:text-[#2D4A3E] transition-colors"
            >
              Nam
            </button>
            <button
              onClick={() => {
                onSelectGender('women');
                onClose();
              }}
              className="py-2.5 px-3 text-center text-xs font-semibold rounded-lg bg-white border border-[#E0DCD3] hover:border-[#2D4A3E] hover:text-[#2D4A3E] transition-colors"
            >
              Nữ
            </button>
            <button
              onClick={() => {
                onSelectGender('unisex');
                onClose();
              }}
              className="py-2.5 px-3 text-center text-xs font-semibold rounded-lg bg-white border border-[#E0DCD3] hover:border-[#2D4A3E] hover:text-[#2D4A3E] transition-colors"
            >
              Unisex
            </button>
          </div>
        </div>

        {/* Danh mục sản phẩm */}
        <div className="p-5 flex-1">
          <div className="text-[11px] font-bold text-[#8C877B] uppercase tracking-wider mb-3">
            Danh mục thời trang
          </div>
          <div className="space-y-1">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  onSelectGender('all');
                  onClose();
                }}
                className="w-full flex items-center justify-between py-2.5 px-2 text-sm text-[#2A2825] hover:text-[#2D4A3E] hover:bg-white rounded-md transition-colors"
              >
                <span>{cat.name}</span>
                <ChevronRight className="w-4 h-4 text-[#A8A49A]" />
              </button>
            ))}
          </div>
        </div>

        {/* Tiện ích dưới cùng */}
        <div className="p-4 border-t border-[#E8E4DA] bg-[#FAF8F5] space-y-2 text-xs text-[#5C584F]">
          <button
            onClick={() => {
              onClose();
              onOpenSizeGuide();
            }}
            className="w-full flex items-center gap-2.5 py-2 px-2 hover:text-[#2D4A3E]"
          >
            <Ruler className="w-4 h-4 text-[#7A5C43]" />
            <span>Bảng quy đổi & Gợi ý size</span>
          </button>
          <div className="w-full flex items-center gap-2.5 py-2 px-2 hover:text-[#2D4A3E]">
            <HelpCircle className="w-4 h-4 text-[#7A5C43]" />
            <span>Chính sách đổi trả 7 ngày</span>
          </div>
        </div>
      </div>
    </div>
  );
};
