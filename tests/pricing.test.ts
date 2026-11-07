import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEffectivePrice, calculateVoucherDiscount, calculateRefundAmount } from '../server/services/pricing.ts';

test('calculateEffectivePrice: returns base price when no promotions are active', () => {
  const result = calculateEffectivePrice(300000, null, []);
  assert.equal(result.effectivePrice, 300000);
  assert.equal(result.discountPercent, 0);
  assert.equal(result.isOnSale, false);
});

test('calculateEffectivePrice: picks highest discount percent when multiple promos match', () => {
  const promos = [
    { id: '1', title: 'Sale 10%', discountPercent: 10 },
    { id: '2', title: 'Flash Sale 25%', discountPercent: 25 },
    { id: '3', title: 'Sale 15%', discountPercent: 15 },
  ];
  const result = calculateEffectivePrice(400000, null, promos);
  assert.equal(result.discountPercent, 25);
  assert.equal(result.effectivePrice, 300000); // 400.000 - 25% (100.000) = 300.000
  assert.equal(result.isOnSale, true);
  assert.equal(result.promotionTitle, 'Flash Sale 25%');
});

test('calculateEffectivePrice: prioritizes priceOverride before applying discount', () => {
  const promos = [{ id: '1', title: 'Sale 20%', discountPercent: 20 }];
  const result = calculateEffectivePrice(500000, 600000, promos);
  assert.equal(result.priceOverride, 600000);
  assert.equal(result.effectivePrice, 480000); // 600.000 - 20% (120.000) = 480.000
});

test('calculateVoucherDiscount: applies percentage discount with cap', () => {
  const voucher = {
    discountType: 'percent' as const,
    discountValue: 15,
    maxDiscount: 50000,
    minOrderValue: 200000,
  };
  // 500.000 * 15% = 75.000 -> capped at 50.000
  const result = calculateVoucherDiscount(500000, 30000, voucher);
  assert.equal(result.isValid, true);
  assert.equal(result.discountAmount, 50000);
});

test('calculateVoucherDiscount: rejects when minimum order value is not met', () => {
  const voucher = {
    discountType: 'fixed' as const,
    discountValue: 50000,
    minOrderValue: 500000,
  };
  const result = calculateVoucherDiscount(300000, 30000, voucher);
  assert.equal(result.isValid, false);
  assert.equal(result.discountAmount, 0);
});

test('calculateVoucherDiscount: applies free shipping discount up to shipping fee', () => {
  const voucher = {
    discountType: 'free_shipping' as const,
    discountValue: 30000,
    minOrderValue: 400000,
  };
  const result = calculateVoucherDiscount(450000, 25000, voucher);
  assert.equal(result.isValid, true);
  assert.equal(result.discountAmount, 25000); // limited by actual 25.000 shipping fee
});

// ==========================================
// CÁC BÀI KIỂM THỬ SỐ HỌC HOÀN TIỀN (REFUND ARITHMETIC)
// ==========================================

test('calculateRefundAmount: hoàn một phần số lượng (mua 3 cái hoàn 1 cái)', () => {
  // Đơn hàng: mua 3 áo giá 300.000₫/cái = subtotal 900.000₫, không có voucher
  // Hoàn 1 cái -> lineTotal = 300.000₫, refundAmount = 300.000₫
  const res = calculateRefundAmount({
    itemUnitPrice: 300000,
    returnQty: 1,
    orderSubtotal: 900000,
    orderDiscountAmount: 0,
    orderTotalAmount: 930000, // gồm 30.000₫ phí ship
    totalPreviouslyRefunded: 0,
  });

  assert.equal(res.lineTotal, 300000);
  assert.equal(res.voucherProportion, 0);
  assert.equal(res.refundAmount, 300000);
});

test('calculateRefundAmount: đơn có voucher phân bổ chiết khấu theo tỷ lệ giá trị dòng sản phẩm', () => {
  // Đơn hàng: Áo 300.000₫ (1 cái) + Quần 700.000₫ (1 cái) => subtotal 1.000.000₫
  // Áp dụng voucher giảm 100.000₫ => discount_amount = 100.000₫
  // Khách hoàn áo (300.000₫)
  // Tỷ lệ phân bổ: (300.000 / 1.000.000) * 100.000 = 30.000₫
  // Tiền hoàn thực tế = 300.000 - 30.000 = 270.000₫
  const res = calculateRefundAmount({
    itemUnitPrice: 300000,
    returnQty: 1,
    orderSubtotal: 1000000,
    orderDiscountAmount: 100000,
    orderTotalAmount: 930000, // 900.000 + 30.000 ship
    totalPreviouslyRefunded: 0,
  });

  assert.equal(res.lineTotal, 300000);
  assert.equal(res.voucherProportion, 30000);
  assert.equal(res.refundAmount, 270000, 'Số tiền hoàn sau khi trừ voucher phân bổ tỷ lệ phải là 270.000₫');
});

test('calculateRefundAmount: làm tròn số tiền VNĐ chuẩn xác (Math.round)', () => {
  // Đơn hàng: Áo giá 333.333₫, tổng subtotal 1.000.000₫, voucher giảm 100.000₫
  // voucherProportion = ROUND((333.333 / 1.000.000) * 100.000) = ROUND(33.333,3) = 33.333₫
  // refundAmount = 333.333 - 33.333 = 300.000₫
  const res = calculateRefundAmount({
    itemUnitPrice: 333333,
    returnQty: 1,
    orderSubtotal: 1000000,
    orderDiscountAmount: 100000,
    orderTotalAmount: 930000,
    totalPreviouslyRefunded: 0,
  });

  assert.equal(Number.isInteger(res.refundAmount), true, 'Số tiền hoàn phải là số nguyên VNĐ');
  assert.equal(res.voucherProportion, 33333);
  assert.equal(res.refundAmount, 300000);
});

test('calculateRefundAmount: tổng các lần hoàn tiền tích lũy không vượt quá số đã thanh toán thực tế', () => {
  // Đơn hàng khách thực tế đã thanh toán 500.000₫
  // Lần 1: Đã hoàn 400.000₫
  // Lần 2: Yêu cầu hoàn món khác có giá sau voucher là 200.000₫
  // Nhưng trần cho phép còn lại chỉ là 500.000 - 400.000 = 100.000₫
  // => Số tiền hoàn chỉ được tối đa 100.000₫
  const res = calculateRefundAmount({
    itemUnitPrice: 200000,
    returnQty: 1,
    orderSubtotal: 600000,
    orderDiscountAmount: 0,
    orderTotalAmount: 500000,
    totalPreviouslyRefunded: 400000,
  });

  assert.equal(res.maxAllowableRefund, 100000);
  assert.equal(res.refundAmount, 100000, 'Tiền hoàn lần 2 bị chặn ở trần 100.000₫ để không vượt tổng thanh toán');
});

test('calculateRefundAmount: chính sách phí ship - không hoàn phí ship khi đổi trả hàng', () => {
  // Đơn hàng: Sản phẩm 200.000₫ + Phí ship 30.000₫ = Khách trả 230.000₫
  // Khi hoàn trả sản phẩm, khách nhận lại đúng 200.000₫ (phí giao hàng đã thực hiện dịch vụ không hoàn)
  const res = calculateRefundAmount({
    itemUnitPrice: 200000,
    returnQty: 1,
    orderSubtotal: 200000,
    orderDiscountAmount: 0,
    orderTotalAmount: 230000,
    totalPreviouslyRefunded: 0,
    includeShippingFee: false,
  });

  assert.equal(res.refundAmount, 200000, 'Phí ship 30.000₫ không được cộng vào tiền hoàn khi trả hàng');
});

test('calculateRefundAmount: khi voucher là free_shipping thì phần giảm đó thuộc phí ship, KHÔNG chia vào tiền hoàn của sản phẩm', () => {
  // Đơn hàng: Áo 300.000₫ + Quần 200.000₫ = subtotal 500.000₫
  // Chọn giao Hỏa tốc phí ship 45.000₫, áp dụng voucher free_shipping giảm 45.000₫ => khách trả 500.000₫
  // Khi hoàn trả Áo (300.000₫), vì voucher là free_shipping nên giảm giá thuộc về phí ship, KHÔNG trừ vào tiền sản phẩm
  const res = calculateRefundAmount({
    itemUnitPrice: 300000,
    returnQty: 1,
    orderSubtotal: 500000,
    orderDiscountAmount: 45000,
    voucherDiscountType: 'free_shipping',
    orderTotalAmount: 500000,
    totalPreviouslyRefunded: 0,
  });

  assert.equal(res.lineTotal, 300000);
  assert.equal(res.voucherProportion, 0, 'Voucher free_shipping không được khấu trừ vào tiền hoàn sản phẩm');
  assert.equal(res.refundAmount, 300000, 'Khách được hoàn đủ 300.000₫ tiền sản phẩm');
});

test('calculateRefundAmount: chính sách phí ship - hoàn lại phí ship khi lỗi thuộc về cửa hàng (hàng lỗi, giao sai)', () => {
  const res = calculateRefundAmount({
    itemUnitPrice: 200000,
    returnQty: 1,
    orderSubtotal: 200000,
    orderDiscountAmount: 0,
    orderTotalAmount: 230000,
    totalPreviouslyRefunded: 0,
    includeShippingFee: true,
    shippingFee: 30000,
  });

  assert.equal(res.refundAmount, 230000, 'Khi lỗi cửa hàng (includeShippingFee=true), khách được hoàn cả phí ship');
});

