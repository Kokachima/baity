import React, { useEffect, useState } from 'react';
import { ShieldCheck, RefreshCw, Truck, Sparkles, Phone, Mail, MapPin } from 'lucide-react';
import type { TargetGender } from '../../types/index.ts';
import {
  MISSING_CONTACT_INFO_TEXT,
  DEFAULT_SHIPPING_CONFIG,
} from '../../../shared/contracts.ts';

interface FooterProps {
  onSelectGender: (gender: TargetGender) => void;
  onOpenSizeGuide: () => void;
  onOpenImageSearch: () => void;
  onOpenPolicy?: (slug: string) => void;
  onOpenFaq?: () => void;
}

interface StoreContactState {
  address: string;
  phone: string;
  email: string;
}

export const Footer: React.FC<FooterProps> = ({
  onSelectGender,
  onOpenSizeGuide,
  onOpenImageSearch,
  onOpenPolicy,
  onOpenFaq,
}) => {
  const [contact, setContact] = useState<StoreContactState>({
    address: MISSING_CONTACT_INFO_TEXT,
    phone: MISSING_CONTACT_INFO_TEXT,
    email: MISSING_CONTACT_INFO_TEXT,
  });
  const [freeShippingThreshold, setFreeShippingThreshold] = useState<number>(
    DEFAULT_SHIPPING_CONFIG.freeShippingThreshold
  );
  const [returnDaysLimit, setReturnDaysLimit] = useState<number>(
    DEFAULT_SHIPPING_CONFIG.returnDaysLimit
  );

  useEffect(() => {
    let mounted = true;
    fetch('/api/settings/general')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!mounted || !body) return;
        const data = body.data || body;
        const c = data?.contact || data;
        if (typeof data?.freeShippingThreshold === 'number' && data.freeShippingThreshold >= 0) {
          setFreeShippingThreshold(data.freeShippingThreshold);
        }
        if (typeof data?.returnDaysLimit === 'number' && data.returnDaysLimit > 0) {
          setReturnDaysLimit(data.returnDaysLimit);
        }
        setContact({
          address:
            typeof c?.address === 'string' && c.address.trim()
              ? c.address.trim()
              : MISSING_CONTACT_INFO_TEXT,
          phone:
            typeof (c?.phone || c?.hotline) === 'string' && (c.phone || c.hotline).trim()
              ? (c.phone || c.hotline).trim()
              : MISSING_CONTACT_INFO_TEXT,
          email:
            typeof c?.email === 'string' && c.email.trim()
              ? c.email.trim()
              : MISSING_CONTACT_INFO_TEXT,
        });
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <footer className="bg-[#1A1C19] text-[#E5E0D8] border-t border-[#2D302B]">
      {/* 4 Cam kết dịch vụ cốt lõi */}
      <div className="border-b border-[#2A2D27]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
          <div className="flex items-center gap-3">
            <Truck className="w-6 h-6 text-[#A3B899] shrink-0" />
            <div>
              <div className="font-semibold text-white">Miễn phí vận chuyển</div>
              <div className="text-xs text-[#9E9B93]">
                Đơn hàng từ {freeShippingThreshold.toLocaleString('vi-VN')}₫
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <RefreshCw className="w-6 h-6 text-[#A3B899] shrink-0" />
            <div>
              <div className="font-semibold text-white">Đổi trả trong {returnDaysLimit} ngày</div>
              <div className="text-xs text-[#9E9B93]">Thủ tục nhanh, hỗ trợ tận nơi</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-[#A3B899] shrink-0" />
            <div>
              <div className="font-semibold text-white">Thanh toán an toàn</div>
              <div className="text-xs text-[#9E9B93]">VietQR Napas & COD tiện lợi</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-[#C27D56] shrink-0" />
            <div>
              <div className="font-semibold text-white">Gợi ý kích cỡ & Tìm bằng ảnh AI</div>
              <div className="text-xs text-[#9E9B93]">
                Theo chiều cao, cân nặng & nhận diện trang phục từ ảnh
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Nội dung footer chính */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
          {/* Cột 1 & 2: Về Baity */}
          <div className="md:col-span-2 space-y-4">
            <span className="font-display text-2xl font-extrabold tracking-widest text-[#EAE6DE]">
              BAITY
            </span>
            <p className="text-xs text-[#A8A49A] leading-relaxed max-w-sm">
              Thương hiệu thời trang ứng dụng tôn vinh phom dáng người Việt. Thiết kế tập trung vào sự tối giản, chất liệu tự nhiên bền vững và công cụ gợi ý kích cỡ trang phục chuẩn xác.
            </p>
            <div className="space-y-2 text-xs text-[#B5B0A6]">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-[#A3B899] shrink-0" />
                <span>Địa chỉ: {contact.address}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-[#A3B899] shrink-0" />
                <span>Hotline: {contact.phone}</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-[#A3B899] shrink-0" />
                <span>Email: {contact.email}</span>
              </div>
            </div>
          </div>

          {/* Cột 3: Khám phá */}
          <div className="space-y-3">
            <div className="font-semibold text-sm text-white">Khám phá</div>
            <ul className="space-y-2 text-xs text-[#A8A49A]">
              <li>
                <button
                  onClick={() => onSelectGender('men')}
                  className="hover:text-white transition-colors"
                >
                  Thời trang Nam
                </button>
              </li>
              <li>
                <button
                  onClick={() => onSelectGender('women')}
                  className="hover:text-white transition-colors"
                >
                  Thời trang Nữ
                </button>
              </li>
              <li>
                <button
                  onClick={() => onSelectGender('unisex')}
                  className="hover:text-white transition-colors"
                >
                  Bộ sưu tập Unisex
                </button>
              </li>
              <li>
                <button
                  onClick={onOpenImageSearch}
                  className="text-[#E6B89C] hover:underline transition-colors text-left"
                >
                  Tìm kiếm sản phẩm bằng hình ảnh AI
                </button>
              </li>
            </ul>
          </div>

          {/* Cột 4: Hỗ trợ khách hàng & Chính sách */}
          <div className="space-y-3">
            <div className="font-semibold text-sm text-white">Hỗ trợ & Chính sách</div>
            <ul className="space-y-2 text-xs text-[#A8A49A]">
              <li>
                <button
                  onClick={onOpenSizeGuide}
                  className="hover:text-white transition-colors text-left"
                >
                  Bảng quy đổi kích cỡ (Size Guide)
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenPolicy?.('return')}
                  className="hover:text-white transition-colors text-left"
                >
                  Chính sách đổi trả & hoàn tiền 7 ngày
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenPolicy?.('shipping')}
                  className="hover:text-white transition-colors text-left"
                >
                  Chính sách vận chuyển & giao nhận
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenPolicy?.('payment')}
                  className="hover:text-white transition-colors text-left"
                >
                  Chính sách thanh toán & an toàn giao dịch
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenPolicy?.('privacy')}
                  className="hover:text-white transition-colors text-left"
                >
                  Chính sách bảo mật thông tin
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenFaq?.()}
                  className="hover:text-white transition-colors text-left font-medium text-[#A3B899]"
                >
                  Câu hỏi thường gặp (FAQ)
                </button>
              </li>
            </ul>
          </div>

          {/* Cột 5: Phương thức thanh toán */}
          <div className="space-y-3">
            <div className="font-semibold text-sm text-white">Thanh toán & Bảo mật</div>
            <div className="space-y-2 text-xs text-[#A8A49A]">
              <div>Hỗ trợ chuyển khoản nhanh Napas VietQR động theo mã đơn.</div>
              <div>Thanh toán khi nhận hàng (COD toàn quốc).</div>
              <div className="pt-2 flex items-center gap-2">
                <span className="px-2 py-1 bg-[#2D302B] rounded text-[11px] font-mono text-[#EAE6DE]">
                  VietQR
                </span>
                <span className="px-2 py-1 bg-[#2D302B] rounded text-[11px] font-mono text-[#EAE6DE]">
                  COD
                </span>
                <span className="px-2 py-1 bg-[#2D302B] rounded text-[11px] font-mono text-[#EAE6DE]">
                  Visa / Master
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Bản quyền */}
        <div className="mt-12 pt-6 border-t border-[#2A2D27] flex flex-col sm:flex-row items-center justify-between text-[11px] text-[#7A776F]">
          <div>© 2026 Baity Fashion Store. Đồ án xây dựng Website Thương mại Điện tử.</div>
          <div className="mt-2 sm:mt-0 flex gap-4">
            <button
              type="button"
              onClick={() => onOpenPolicy?.('return')}
              className="hover:underline cursor-pointer"
            >
              Chính sách đổi trả
            </button>
            <button
              type="button"
              onClick={() => onOpenPolicy?.('privacy')}
              className="hover:underline cursor-pointer"
            >
              Chính sách bảo mật
            </button>
            <button
              type="button"
              onClick={() => onOpenFaq?.()}
              className="hover:underline cursor-pointer"
            >
              FAQ
            </button>
            <a href="/admin" className="text-[#A3B899] hover:underline font-mono">
              /admin
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

