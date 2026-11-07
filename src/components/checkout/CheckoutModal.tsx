import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  MapPin,
  Truck,
  Tag,
  CreditCard,
  QrCode,
  AlertCircle,
  Package,
  ArrowLeft,
} from 'lucide-react';
import { OrderDetail } from './OrderDetail.tsx';
import { OrderHistory } from './OrderHistory.tsx';
import { apiRequest } from '../../lib/api.ts';
import type {
  Address,
  AvailableVoucher,
  CartItemState,
  CartSummaryState,
  OrderRecord,
  User,
} from '../../types/index.ts';

interface CheckoutModalProps {
  isOpen: boolean;
  initialMode: 'checkout' | 'orders';
  onClose: () => void;
  currentUser: User | null;
  cartItems: CartItemState[];
  cartSummary: CartSummaryState;
  onOrderCreated: (order: OrderRecord) => void;
  onCartRefresh: () => void;
  showToast: (msg: string) => void;
}

const IDEMPOTENCY_STORAGE_KEY = 'baity_checkout_idempotency_v1';

function generateClientIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `CHK-${crypto.randomUUID()}`;
  }
  return `CHK-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  initialMode,
  onClose,
  currentUser,
  cartItems,
  cartSummary,
  onOrderCreated,
  onCartRefresh,
  showToast,
}) => {
  const [mode, setMode] = useState<'checkout' | 'detail' | 'orders'>(
    initialMode === 'orders' ? 'orders' : 'checkout'
  );

  // Cấu hình phí vận chuyển đọc động từ store_settings (/api/settings/general)
  const [shippingConfig, setShippingConfig] = useState<{
    freeShippingThreshold: number;
    defaultShippingFee: number;
    expressShippingFee: number;
  }>({
    freeShippingThreshold: cartSummary.freeShippingThreshold || 499000,
    defaultShippingFee: 30000,
    expressShippingFee: 45000,
  });

  // Địa chỉ nhận hàng (hỗ trợ sổ địa chỉ hoặc nhập địa chỉ 2 cấp Tỉnh/Thành phố + Phường/Xã)
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>('');
  const [useCustomAddress, setUseCustomAddress] = useState<boolean>(false);
  const [receiverName, setReceiverName] = useState<string>(currentUser?.fullName || '');
  const [receiverPhone, setReceiverPhone] = useState<string>(currentUser?.phone || '');
  const [customProvince, setCustomProvince] = useState<string>('TP. Hồ Chí Minh');
  const [customWard, setCustomWard] = useState<string>('Phường Bến Nghé');
  const [customStreet, setCustomStreet] = useState<string>('');

  // Vận chuyển, Voucher & Thanh toán
  const [shippingMethod, setShippingMethod] = useState<'standard' | 'express'>('standard');
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'vietqr'>('vietqr');
  const [availableVouchers, setAvailableVouchers] = useState<AvailableVoucher[]>([]);
  const [voucherInput, setVoucherInput] = useState<string>('');
  const [appliedVoucherCode, setAppliedVoucherCode] = useState<string>('');
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [voucherError, setVoucherError] = useState<string>('');
  const [isApplyingVoucher, setIsApplyingVoucher] = useState<boolean>(false);

  // Idempotency-Key cho lượt thanh toán hiện tại (lưu trong sessionStorage)
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  // Đặt hàng & Đơn hàng đang xem
  const [isSubmittingOrder, setIsSubmittingOrder] = useState<boolean>(false);
  const [orderError, setOrderError] = useState<string>('');
  const [activeOrder, setActiveOrder] = useState<OrderRecord | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode === 'orders' ? 'orders' : 'checkout');
      setOrderError('');
      setVoucherError('');
    }
  }, [isOpen, initialMode]);

  // Nạp cấu hình phí vận chuyển từ store_settings (/api/settings/general), sổ địa chỉ và voucher
  useEffect(() => {
    if (!isOpen) return;

    apiRequest('/api/settings/general')
      .then((res) => {
        if (res.ok && res.data?.data) {
          setShippingConfig({
            freeShippingThreshold: Number(res.data.data.freeShippingThreshold ?? 499000),
            defaultShippingFee: Number(res.data.data.defaultShippingFee ?? 30000),
            expressShippingFee: Number(res.data.data.expressShippingFee ?? 45000),
          });
        }
      })
      .catch(() => {});

    if (!currentUser) return;

    apiRequest('/api/user/addresses')
      .then((res) => {
        if (res.ok && Array.isArray(res.data?.data)) {
          const addrList: Address[] = res.data.data;
          setAddresses(addrList);
          const def = addrList.find((a: Address) => a.isDefault) || addrList[0];
          if (def) {
            setSelectedAddressId(def.id);
            setUseCustomAddress(false);
          } else {
            setUseCustomAddress(true);
            setReceiverName(currentUser.fullName || '');
            setReceiverPhone(currentUser.phone || '');
          }
        }
      })
      .catch(() => {});

    apiRequest('/api/vouchers/available')
      .then((res) => {
        if (res.ok && Array.isArray(res.data?.items)) {
          setAvailableVouchers(res.data.items);
        }
      })
      .catch(() => {});
  }, [isOpen, currentUser]);

  // Tạo chữ ký (signature) của phiên thanh toán hiện tại:
  // Chỉ sinh Idempotency-Key mới khi đặt thành công HOẶC khi giỏ hàng, địa chỉ, voucher, phương thức thanh toán/vận chuyển thay đổi.
  const checkoutPayloadSignature = useMemo(() => {
    const itemsSig = cartItems
      .map((i) => `${i.variantId}:${i.quantity}`)
      .sort()
      .join('|');
    const addrSig = !useCustomAddress && selectedAddressId
      ? `addr:${selectedAddressId}`
      : `custom:${receiverName.trim()}:${receiverPhone.trim()}:${customProvince.trim()}:${customWard.trim()}:${customStreet.trim()}`;
    return `${itemsSig}__${addrSig}__${appliedVoucherCode || ''}__${shippingMethod}__${paymentMethod}`;
  }, [
    cartItems,
    useCustomAddress,
    selectedAddressId,
    receiverName,
    receiverPhone,
    customProvince,
    customWard,
    customStreet,
    appliedVoucherCode,
    shippingMethod,
    paymentMethod,
  ]);

  useEffect(() => {
    if (!isOpen || mode !== 'checkout') return;
    try {
      const raw = sessionStorage.getItem(IDEMPOTENCY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.key && parsed.signature === checkoutPayloadSignature) {
          setIdempotencyKey(parsed.key);
          return;
        }
      }
      const nextKey = generateClientIdempotencyKey();
      sessionStorage.setItem(
        IDEMPOTENCY_STORAGE_KEY,
        JSON.stringify({ key: nextKey, signature: checkoutPayloadSignature })
      );
      setIdempotencyKey(nextKey);
    } catch {
      setIdempotencyKey((prev) => prev || generateClientIdempotencyKey());
    }
  }, [isOpen, mode, checkoutPayloadSignature]);

  // Tính phí vận chuyển động theo cấu hình store_settings
  const subtotal = cartSummary.subtotal;
  const standardFee =
    subtotal >= shippingConfig.freeShippingThreshold ? 0 : shippingConfig.defaultShippingFee;
  const rawShippingFee =
    shippingMethod === 'express' ? shippingConfig.expressShippingFee : standardFee;

  // Khi đổi phương thức vận chuyển mà đang áp voucher, kiểm tra lại mức giảm giá
  useEffect(() => {
    if (!appliedVoucherCode) return;
    apiRequest('/api/vouchers/validate', {
      method: 'POST',
      body: JSON.stringify({
        code: appliedVoucherCode,
        shippingMethod,
        items: cartItems.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      }),
    })
      .then((res) => {
        if (res.ok && res.data?.valid) {
          setDiscountAmount(res.data.discountAmount || 0);
        } else {
          setAppliedVoucherCode('');
          setDiscountAmount(0);
        }
      })
      .catch(() => {});
  }, [shippingMethod, appliedVoucherCode, cartItems]);

  const handleApplyVoucher = async (codeToApply?: string) => {
    const code = (codeToApply ?? voucherInput).trim().toUpperCase();
    if (!code) return;

    setVoucherError('');
    setIsApplyingVoucher(true);
    try {
      const res = await apiRequest('/api/vouchers/validate', {
        method: 'POST',
        body: JSON.stringify({
          code,
          shippingMethod,
          items: cartItems.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
        }),
      });
      if (!res.ok || !res.data?.valid) {
        setVoucherError(res.errorMessage || res.data?.message || 'Mã giảm giá không hợp lệ');
        setAppliedVoucherCode('');
        setDiscountAmount(0);
      } else {
        const vCode = res.data.voucher?.code || code;
        const disc = Number(res.data.discountAmount || 0);
        setAppliedVoucherCode(vCode);
        setVoucherInput(vCode);
        setDiscountAmount(disc);
        setVoucherError('');
        showToast(
          `Đã áp dụng mã ${vCode}: Giảm ${disc.toLocaleString('vi-VN')}₫`
        );
      }
    } catch {
      setVoucherError('Lỗi kết nối khi kiểm tra mã giảm giá');
    } finally {
      setIsApplyingVoucher(false);
    }
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrderError('');

    // Đảm bảo dùng lại đúng Idempotency-Key trong sessionStorage cho mọi lần gửi lại của cùng lượt thanh toán
    let currentKey = idempotencyKey;
    try {
      const raw = sessionStorage.getItem(IDEMPOTENCY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.key && parsed?.signature === checkoutPayloadSignature) {
          currentKey = parsed.key;
        }
      }
      if (!currentKey) {
        currentKey = generateClientIdempotencyKey();
        sessionStorage.setItem(
          IDEMPOTENCY_STORAGE_KEY,
          JSON.stringify({ key: currentKey, signature: checkoutPayloadSignature })
        );
        setIdempotencyKey(currentKey);
      }
    } catch {
      if (!currentKey) currentKey = generateClientIdempotencyKey();
    }

    const payload: Record<string, any> = {
      items: cartItems.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      shippingMethod,
      paymentMethod,
      voucherCode: appliedVoucherCode || undefined,
      idempotencyKey: currentKey,
    };

    if (!useCustomAddress && selectedAddressId) {
      payload.addressId = selectedAddressId;
    } else {
      payload.receiverName = receiverName.trim();
      payload.receiverPhone = receiverPhone.trim();
      payload.province = customProvince.trim();
      payload.district = null;
      payload.ward = customWard.trim();
      payload.streetAddress = customStreet.trim();
      payload.shippingAddress = [customStreet.trim(), customWard.trim(), customProvince.trim()]
        .filter(Boolean)
        .join(', ');
    }

    setIsSubmittingOrder(true);
    try {
      const res = await apiRequest('/api/orders', {
        method: 'POST',
        headers: {
          'Idempotency-Key': currentKey,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        // Khi thất bại mạng hoặc lỗi nghiệp vụ, hiển thị đúng thông báo lỗi thật từ { error: { code, message } }
        setOrderError(res.errorMessage || 'Không thể tạo đơn hàng');
        return;
      }

      // Chỉ sau khi đặt đơn hàng thành công mới xóa khóa cũ trong sessionStorage để lượt thanh toán sau tạo khóa mới
      try {
        sessionStorage.removeItem(IDEMPOTENCY_STORAGE_KEY);
      } catch {
        // ignore
      }
      setIdempotencyKey('');

      const created: OrderRecord = res.data.order || res.data.data;
      setActiveOrder(created);
      setMode('detail');
      setAppliedVoucherCode('');
      setDiscountAmount(0);
      onOrderCreated(created);
      onCartRefresh();
    } catch {
      setOrderError('Lỗi kết nối máy chủ khi đặt hàng');
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  if (!isOpen) return null;

  const finalTotal = Math.max(subtotal + rawShippingFee - discountAmount, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-label="Thanh toán và Đơn hàng"
    >
      <div className="fixed inset-0 bg-black/55 backdrop-blur-xs" onClick={onClose} />

      <div className="relative w-full max-w-4xl bg-[#FAF8F5] rounded-2xl shadow-2xl border border-[#E0DCD3] overflow-hidden z-10 my-8 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 bg-white border-b border-[#E8E4DA] flex items-center justify-between">
          <div className="flex items-center gap-3">
            {mode !== 'checkout' && cartItems.length > 0 && (
              <button
                type="button"
                onClick={() => setMode('checkout')}
                className="p-1.5 text-[#5C584F] hover:text-[#1A1C19] rounded-lg hover:bg-[#F2EFE9]"
                aria-label="Quay lại thanh toán"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <h2 className="font-display text-lg font-bold text-[#1A1C19]">
              {mode === 'checkout'
                ? 'Xác Nhận Đặt Hàng & Thanh Toán'
                : mode === 'detail'
                ? `Chi Tiết Đơn Hàng ${activeOrder?.id || ''}`
                : 'Lịch Sử Đơn Hàng Của Tôi'}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode('orders')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                mode === 'orders'
                  ? 'bg-[#2D4A3E] text-white'
                  : 'bg-[#F0ECE1] text-[#2D4A3E] hover:bg-[#E4DEC9]'
              }`}
            >
              Đơn mua của tôi
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-[#6B665C] hover:text-[#1A1C19] rounded-lg hover:bg-[#F2EFE9]"
              aria-label="Đóng cửa sổ"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {mode === 'checkout' && (
            <form onSubmit={handlePlaceOrder} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Cột Trái: Địa chỉ 2 cấp, Vận chuyển động từ store_settings & Phương thức Thanh toán */}
              <div className="lg:col-span-7 space-y-5">
                {orderError && (
                  <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2.5 text-xs text-red-700 font-medium">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{orderError}</span>
                  </div>
                )}

                {/* 1. Địa chỉ nhận hàng (2 cấp: Tỉnh/Thành phố, Phường/Xã; tương thích district cũ nếu có) */}
                <div className="p-4 bg-white rounded-xl border border-[#EAE6DE] space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-[#1A1C19] uppercase tracking-wider">
                      <MapPin className="w-4 h-4 text-[#2D4A3E]" />
                      <span>1. Địa chỉ nhận hàng</span>
                    </div>
                    {addresses.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setUseCustomAddress((prev) => !prev)}
                        className="text-xs font-semibold text-[#2D4A3E] hover:underline"
                      >
                        {useCustomAddress ? 'Chọn từ sổ địa chỉ' : '+ Nhập địa chỉ khác'}
                      </button>
                    )}
                  </div>

                  {!useCustomAddress && addresses.length > 0 ? (
                    <div className="space-y-2">
                      {addresses.map((addr) => (
                        <label
                          key={addr.id}
                          className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors text-xs ${
                            selectedAddressId === addr.id
                              ? 'border-[#2D4A3E] bg-[#F5F2EB]'
                              : 'border-[#E5E0D5] bg-white hover:border-[#C5BFB2]'
                          }`}
                        >
                          <input
                            type="radio"
                            name="addressId"
                            checked={selectedAddressId === addr.id}
                            onChange={() => setSelectedAddressId(addr.id)}
                            className="mt-0.5 accent-[#2D4A3E]"
                          />
                          <div className="flex-1">
                            <div className="font-bold text-[#1A1C19]">
                              {addr.receiverName} · {addr.phone}
                              {addr.isDefault && (
                                <span className="ml-2 text-[10px] font-semibold text-[#2D4A3E]">
                                  (Mặc định)
                                </span>
                              )}
                            </div>
                            <div className="text-[#6B665C] mt-0.5">
                              {[addr.streetAddress, addr.ward, addr.district, addr.province]
                                .filter(Boolean)
                                .join(', ')}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-[#5C584F] mb-1">
                            Họ tên người nhận
                          </label>
                          <input
                            type="text"
                            required
                            value={receiverName}
                            onChange={(e) => setReceiverName(e.target.value)}
                            placeholder="Nguyễn Văn A"
                            className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg focus:outline-none focus:border-[#2D4A3E]"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-[#5C584F] mb-1">
                            Số điện thoại
                          </label>
                          <input
                            type="tel"
                            required
                            value={receiverPhone}
                            onChange={(e) => setReceiverPhone(e.target.value)}
                            placeholder="0912345678"
                            className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg focus:outline-none focus:border-[#2D4A3E]"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-[#5C584F] mb-1">
                            Tỉnh / Thành phố
                          </label>
                          <input
                            type="text"
                            required
                            value={customProvince}
                            onChange={(e) => setCustomProvince(e.target.value)}
                            placeholder="TP. Hồ Chí Minh"
                            className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg focus:outline-none focus:border-[#2D4A3E]"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-[#5C584F] mb-1">
                            Phường / Xã
                          </label>
                          <input
                            type="text"
                            required
                            value={customWard}
                            onChange={(e) => setCustomWard(e.target.value)}
                            placeholder="Phường Bến Nghé"
                            className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg focus:outline-none focus:border-[#2D4A3E]"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-[#5C584F] mb-1">
                          Địa chỉ chi tiết (Số nhà, tên đường)
                        </label>
                        <input
                          type="text"
                          required
                          value={customStreet}
                          onChange={(e) => setCustomStreet(e.target.value)}
                          placeholder="123 Đường Lê Lợi"
                          className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg focus:outline-none focus:border-[#2D4A3E]"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Phương thức vận chuyển (Đọc phí từ store_settings) */}
                <div className="p-4 bg-white rounded-xl border border-[#EAE6DE] space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#1A1C19] uppercase tracking-wider">
                    <Truck className="w-4 h-4 text-[#2D4A3E]" />
                    <span>2. Phương thức vận chuyển</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <label
                      className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between ${
                        shippingMethod === 'standard'
                          ? 'border-[#2D4A3E] bg-[#F5F2EB]'
                          : 'border-[#E5E0D5]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <input
                          type="radio"
                          name="shippingMethod"
                          checked={shippingMethod === 'standard'}
                          onChange={() => setShippingMethod('standard')}
                          className="accent-[#2D4A3E]"
                        />
                        <div>
                          <div className="font-bold text-[#1A1C19]">Giao tiêu chuẩn</div>
                          <div className="text-[11px] text-[#6B665C]">
                            2 - 4 ngày (Freeship từ{' '}
                            {shippingConfig.freeShippingThreshold.toLocaleString('vi-VN')}₫)
                          </div>
                        </div>
                      </div>
                      <span className="font-bold text-[#2D4A3E] tabular-nums">
                        {standardFee.toLocaleString('vi-VN')}₫
                      </span>
                    </label>

                    <label
                      className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between ${
                        shippingMethod === 'express'
                          ? 'border-[#2D4A3E] bg-[#F5F2EB]'
                          : 'border-[#E5E0D5]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <input
                          type="radio"
                          name="shippingMethod"
                          checked={shippingMethod === 'express'}
                          onChange={() => setShippingMethod('express')}
                          className="accent-[#2D4A3E]"
                        />
                        <div>
                          <div className="font-bold text-[#1A1C19]">Giao hỏa tốc</div>
                          <div className="text-[11px] text-[#6B665C]">Nhận trong ngày nội thành</div>
                        </div>
                      </div>
                      <span
                        data-testid="express-shipping-fee"
                        className="font-bold text-[#2D4A3E] tabular-nums"
                      >
                        {shippingConfig.expressShippingFee.toLocaleString('vi-VN')}₫
                      </span>
                    </label>
                  </div>
                </div>

                {/* 3. Phương thức thanh toán */}
                <div className="p-4 bg-white rounded-xl border border-[#EAE6DE] space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#1A1C19] uppercase tracking-wider">
                    <CreditCard className="w-4 h-4 text-[#2D4A3E]" />
                    <span>3. Phương thức thanh toán</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <label
                      className={`p-3 rounded-xl border cursor-pointer flex items-center gap-2.5 ${
                        paymentMethod === 'vietqr'
                          ? 'border-[#2D4A3E] bg-[#F5F2EB]'
                          : 'border-[#E5E0D5]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="paymentMethod"
                        checked={paymentMethod === 'vietqr'}
                        onChange={() => setPaymentMethod('vietqr')}
                        className="accent-[#2D4A3E]"
                      />
                      <QrCode className="w-4 h-4 text-[#2D4A3E] shrink-0" />
                      <div>
                        <div className="font-bold text-[#1A1C19]">Chuyển khoản VietQR 24/7</div>
                        <div className="text-[11px] text-[#6B665C]">Quét mã QR động tự điền số tiền</div>
                      </div>
                    </label>

                    <label
                      className={`p-3 rounded-xl border cursor-pointer flex items-center gap-2.5 ${
                        paymentMethod === 'cod'
                          ? 'border-[#2D4A3E] bg-[#F5F2EB]'
                          : 'border-[#E5E0D5]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="paymentMethod"
                        checked={paymentMethod === 'cod'}
                        onChange={() => setPaymentMethod('cod')}
                        className="accent-[#2D4A3E]"
                      />
                      <Package className="w-4 h-4 text-[#7A5C43] shrink-0" />
                      <div>
                        <div className="font-bold text-[#1A1C19]">Thanh toán khi nhận hàng (COD)</div>
                        <div className="text-[11px] text-[#6B665C]">Kiểm tra hàng trước khi thanh toán</div>
                      </div>
                    </label>
                  </div>
                </div>
              </div>

              {/* Cột Phải: Mã giảm giá Voucher & Tổng kết đơn hàng (Bước Xem lại) */}
              <div className="lg:col-span-5 space-y-5">
                {/* Voucher */}
                <div className="p-4 bg-white rounded-xl border border-[#EAE6DE] space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#1A1C19] uppercase tracking-wider">
                    <Tag className="w-4 h-4 text-[#C27D56]" />
                    <span>Mã Giảm Giá (Voucher)</span>
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={voucherInput}
                      onChange={(e) => setVoucherInput(e.target.value.toUpperCase())}
                      placeholder="Nhập mã (VD: BAITYWELCOME)..."
                      aria-label="Mã giảm giá"
                      className="flex-1 px-3 py-2 text-xs font-semibold uppercase bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg focus:outline-none focus:border-[#2D4A3E]"
                    />
                    <button
                      type="button"
                      disabled={isApplyingVoucher || !voucherInput.trim()}
                      onClick={() => handleApplyVoucher()}
                      className="px-4 py-2 bg-[#2D4A3E] text-white text-xs font-semibold rounded-lg hover:bg-[#233B31] disabled:opacity-50"
                    >
                      Áp dụng
                    </button>
                  </div>

                  {voucherError && (
                    <div className="text-[11px] text-red-600 font-medium">{voucherError}</div>
                  )}

                  {appliedVoucherCode && (
                    <div className="p-2.5 bg-[#F0ECE1] rounded-lg flex items-center justify-between text-xs text-[#2D4A3E]">
                      <span>
                        Đã áp dụng <strong>{appliedVoucherCode}</strong> (-
                        {discountAmount.toLocaleString('vi-VN')}₫)
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setAppliedVoucherCode('');
                          setVoucherInput('');
                          setDiscountAmount(0);
                        }}
                        className="text-[#C27D56] font-semibold hover:underline"
                      >
                        Bỏ dùng
                      </button>
                    </div>
                  )}

                  {availableVouchers.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <div className="text-[11px] text-[#6B665C] font-medium">
                        Voucher có sẵn của Baity:
                      </div>
                      {availableVouchers.map((v) => (
                        <div
                          key={v.code}
                          className="p-2.5 rounded-lg border border-[#EAE6DE] bg-[#FAF8F5] flex items-center justify-between gap-2 text-[11px]"
                        >
                          <div>
                            <div className="font-bold text-[#1A1C19]">{v.code}</div>
                            <div className="text-[#6B665C]">
                              {v.discountType === 'percent'
                                ? `Giảm ${v.discountValue}% (tối đa ${(v.maxDiscount || 0).toLocaleString('vi-VN')}₫)`
                                : v.discountType === 'free_shipping'
                                ? 'Miễn phí 100% phí vận chuyển'
                                : `Giảm trực tiếp ${v.discountValue.toLocaleString('vi-VN')}₫`}{' '}
                              · Đơn từ {v.minOrderValue.toLocaleString('vi-VN')}₫
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={!v.isEligible}
                            onClick={() => handleApplyVoucher(v.code)}
                            className={`px-2.5 py-1 rounded font-semibold shrink-0 ${
                              v.isEligible
                                ? 'bg-[#2D4A3E] text-white hover:bg-[#233B31]'
                                : 'bg-[#E5E0D5] text-[#8C877B] cursor-not-allowed'
                            }`}
                          >
                            {appliedVoucherCode === v.code ? 'Đang dùng' : 'Chọn'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Tóm tắt đơn hàng (Bước Xem lại) */}
                <div className="p-4 bg-white rounded-xl border border-[#EAE6DE] space-y-3">
                  <div className="text-xs font-bold text-[#1A1C19] uppercase tracking-wider">
                    Xem Lại & Tóm Tắt Đơn Hàng ({cartSummary.totalItems} sản phẩm)
                  </div>

                  <div className="max-h-40 overflow-y-auto divide-y divide-[#F2EFE9] text-xs">
                    {cartItems.map((item) => (
                      <div key={item.id} className="py-2 flex items-center justify-between gap-2">
                        <div className="truncate">
                          <span className="font-semibold text-[#1A1C19]">{item.quantity}x</span>{' '}
                          <span>{item.productName}</span>{' '}
                          <span className="text-[#7A7569]">
                            ({item.colorName}, {item.size})
                          </span>
                        </div>
                        <span className="font-semibold tabular-nums shrink-0">
                          {item.lineTotal.toLocaleString('vi-VN')}₫
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="pt-2 border-t border-[#EAE6DE] space-y-1.5 text-xs">
                    <div className="flex justify-between text-[#5C584F]">
                      <span>Tạm tính (sau khuyến mãi)</span>
                      <span className="font-semibold text-[#1A1C19] tabular-nums">
                        {subtotal.toLocaleString('vi-VN')}₫
                      </span>
                    </div>
                    <div className="flex justify-between text-[#5C584F]">
                      <span>Phí vận chuyển</span>
                      <span className="font-semibold text-[#1A1C19] tabular-nums">
                        {rawShippingFee.toLocaleString('vi-VN')}₫
                      </span>
                    </div>
                    {discountAmount > 0 && (
                      <div className="flex justify-between text-[#C27D56] font-semibold">
                        <span>Giảm giá Voucher ({appliedVoucherCode})</span>
                        <span className="tabular-nums">
                          -{discountAmount.toLocaleString('vi-VN')}₫
                        </span>
                      </div>
                    )}
                    <div className="pt-2 border-t border-[#EAE6DE] flex justify-between text-sm font-bold text-[#1A1C19]">
                      <span>Tổng thanh toán</span>
                      <span
                        data-testid="checkout-final-total"
                        className="text-lg text-[#2D4A3E] tabular-nums"
                      >
                        {finalTotal.toLocaleString('vi-VN')}₫
                      </span>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmittingOrder || cartItems.length === 0}
                    className="w-full py-3.5 bg-[#2D4A3E] hover:bg-[#233B31] text-white text-xs font-bold uppercase tracking-wider rounded-xl shadow-sm transition-colors disabled:opacity-50"
                  >
                    {isSubmittingOrder
                      ? 'Đang xử lý đơn hàng...'
                      : `Xác nhận Đặt hàng · ${finalTotal.toLocaleString('vi-VN')}₫`}
                  </button>
                </div>
              </div>
            </form>
          )}

          {mode === 'detail' && activeOrder && (
            <OrderDetail
              order={activeOrder}
              onOrderUpdated={(updated) => setActiveOrder(updated)}
              onCartRefresh={onCartRefresh}
              showToast={showToast}
            />
          )}

          {mode === 'orders' && (
            <OrderHistory
              onSelectOrder={(order) => {
                setActiveOrder(order);
                setMode('detail');
              }}
              onCartRefresh={onCartRefresh}
              showToast={showToast}
            />
          )}
        </div>
      </div>
    </div>
  );
};
