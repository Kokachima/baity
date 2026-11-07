import React from 'react';
import {
  ShoppingBag,
  QrCode,
  RotateCcw,
  AlertTriangle,
  Warehouse,
  MessageSquare,
  MessagesSquare,
  ArrowRight,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { AdminTabKey } from './AdminLayout';

export interface OperationsOverviewCounts {
  pendingOrders?: number;
  pendingConfirmationOrders?: number;
  awaitingVietQrOrders?: number;
  pendingReturns?: number;
  pendingReturnRequests?: number;
  activeReturnRequests?: number;
  refundNeededCount?: number;
  paymentMismatchCount?: number;
  unresolvedPaymentIssues?: number;
  lowStockVariants?: number;
  lowStockThreshold?: number;
  unrepliedReviews?: number;
  unrepliedChats?: number;
}

export interface OverviewNavigationTarget {
  tab: AdminTabKey;
  orderStatus?: string;
  orderPaymentMethod?: string;
  returnStatus?: string;
  focusPaymentIssues?: boolean;
  inventoryLowStockOnly?: boolean;
  reviewReplied?: 'all' | 'replied' | 'unreplied';
  reviewVisibility?: 'all' | 'visible' | 'hidden';
  chatStatus?: 'unreplied' | 'open' | 'closed' | 'all';
}

export interface OperationsOverviewPageProps {
  overview: OperationsOverviewCounts;
  onRefresh: () => void;
  onNavigateWithFilter: (target: OverviewNavigationTarget) => void;
}

export const OperationsOverviewPage: React.FC<OperationsOverviewPageProps> = ({
  overview,
  onRefresh,
  onNavigateWithFilter,
}) => {
  const pendingConfirmation = Number(
    overview.pendingConfirmationOrders ?? overview.pendingOrders ?? 0
  );
  const awaitingVietQr = Number(overview.awaitingVietQrOrders ?? 0);
  const pendingReturnApprovals = Number(
    overview.pendingReturnRequests ?? overview.pendingReturns ?? 0
  );
  const refundNeeded = Number(overview.refundNeededCount ?? 0);
  const mismatchEvents = Number(overview.paymentMismatchCount ?? 0);
  const unresolvedPaymentIssues = Number(
    overview.unresolvedPaymentIssues ?? refundNeeded + mismatchEvents
  );
  const lowStockVariants = Number(overview.lowStockVariants ?? 0);
  const lowStockThreshold = Number(overview.lowStockThreshold ?? 5);
  const unrepliedReviews = Number(overview.unrepliedReviews ?? 0);
  const unrepliedChats = Number(overview.unrepliedChats ?? 0);

  const cards = [
    {
      id: 'pending-confirmation-orders',
      title: 'Đơn hàng chờ xác nhận',
      count: pendingConfirmation,
      unit: 'đơn chờ xử lý',
      description: 'Đơn hàng mới ở trạng thái pending cần kiểm tra và xác nhận xuất kho.',
      badgeColor: pendingConfirmation > 0 ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-[#5C5F58] bg-[#F5F2EB] border-[#E5E0D8]',
      icon: <ShoppingBag className="w-5 h-5 text-[#2D4A3E]" />,
      ctaLabel: 'Mở danh sách đơn chờ xác nhận',
      target: {
        tab: 'orders' as AdminTabKey,
        orderStatus: 'pending',
        orderPaymentMethod: 'all',
      },
    },
    {
      id: 'awaiting-vietqr-orders',
      title: 'Đơn VietQR chờ thanh toán',
      count: awaitingVietQr,
      unit: 'đơn VietQR đang giữ hàng',
      description: 'Đơn hàng chọn chuyển khoản VietQR đang trong thời hạn chờ thanh toán.',
      badgeColor: awaitingVietQr > 0 ? 'text-blue-800 bg-blue-50 border-blue-200' : 'text-[#5C5F58] bg-[#F5F2EB] border-[#E5E0D8]',
      icon: <QrCode className="w-5 h-5 text-[#2D4A3E]" />,
      ctaLabel: 'Lọc đơn VietQR chờ thanh toán',
      target: {
        tab: 'orders' as AdminTabKey,
        orderStatus: 'pending',
        orderPaymentMethod: 'vietqr',
      },
    },
    {
      id: 'pending-return-requests',
      title: 'Yêu cầu đổi trả chờ duyệt',
      count: pendingReturnApprovals,
      unit: 'yêu cầu chờ phê duyệt',
      description: 'Yêu cầu đổi kích cỡ/màu sắc hoặc hoàn tiền của khách đang chờ quyết định.',
      badgeColor: pendingReturnApprovals > 0 ? 'text-orange-800 bg-orange-50 border-orange-200' : 'text-[#5C5F58] bg-[#F5F2EB] border-[#E5E0D8]',
      icon: <RotateCcw className="w-5 h-5 text-[#2D4A3E]" />,
      ctaLabel: 'Duyệt yêu cầu đổi trả',
      target: {
        tab: 'returns' as AdminTabKey,
        returnStatus: 'pending',
        focusPaymentIssues: false,
      },
    },
    {
      id: 'unresolved-payment-issues',
      title: 'Sự kiện thanh toán cần xử lý',
      count: unresolvedPaymentIssues,
      unit: `cần hoàn (${refundNeeded}) · lệch tiền (${mismatchEvents})`,
      description: 'Giao dịch chuyển khoản muộn sau khi đơn hủy (refund_needed) hoặc lệch số tiền.',
      badgeColor: unresolvedPaymentIssues > 0 ? 'text-red-800 bg-red-50 border-red-200' : 'text-[#5C5F58] bg-[#F5F2EB] border-[#E5E0D8]',
      icon: <AlertTriangle className="w-5 h-5 text-red-700" />,
      ctaLabel: 'Đối soát sự kiện thanh toán',
      target: {
        tab: 'returns' as AdminTabKey,
        returnStatus: 'all',
        focusPaymentIssues: true,
      },
    },
    {
      id: 'low-stock-variants',
      title: 'Biến thể sắp hết / hết hàng',
      count: lowStockVariants,
      unit: `tồn kho ≤ ${lowStockThreshold} sản phẩm`,
      description: 'Các biến thể Màu × Size chạm ngưỡng cảnh báo tồn kho cần nhập bổ sung.',
      badgeColor: lowStockVariants > 0 ? 'text-amber-900 bg-amber-50 border-amber-200' : 'text-[#5C5F58] bg-[#F5F2EB] border-[#E5E0D8]',
      icon: <Warehouse className="w-5 h-5 text-[#2D4A3E]" />,
      ctaLabel: 'Kiểm tra biến thể sắp hết hàng',
      target: {
        tab: 'inventory' as AdminTabKey,
        inventoryLowStockOnly: true,
      },
    },
    {
      id: 'unreplied-reviews',
      title: 'Đánh giá chưa phản hồi',
      count: unrepliedReviews,
      unit: 'đánh giá hiển thị chờ trả lời',
      description: 'Nhận xét của khách đã mua hàng đang hiển thị trên cửa hàng nhưng chưa có phản hồi.',
      badgeColor: unrepliedReviews > 0 ? 'text-emerald-900 bg-emerald-50 border-emerald-200' : 'text-[#5C5F58] bg-[#F5F2EB] border-[#E5E0D8]',
      icon: <MessageSquare className="w-5 h-5 text-[#2D4A3E]" />,
      ctaLabel: 'Phản hồi đánh giá khách hàng',
      target: {
        tab: 'reviews' as AdminTabKey,
        reviewReplied: 'unreplied' as const,
        reviewVisibility: 'visible' as const,
      },
    },
    {
      id: 'unreplied-chats',
      title: 'Chat chưa trả lời',
      count: unrepliedChats,
      unit: 'hội thoại đang mở chờ phản hồi',
      description: 'Hội thoại hỏi đáp trực tiếp của khách hàng với người bán đang chờ nhân viên trả lời.',
      badgeColor: unrepliedChats > 0 ? 'text-amber-900 bg-amber-50 border-amber-200' : 'text-[#5C5F58] bg-[#F5F2EB] border-[#E5E0D8]',
      icon: <MessagesSquare className="w-5 h-5 text-[#2D4A3E]" />,
      ctaLabel: 'Mở danh sách chat chưa trả lời',
      target: {
        tab: 'chats' as AdminTabKey,
        chatStatus: 'unreplied' as const,
      },
    },
  ];

  return (
    <div className="space-y-6" data-testid="operations-overview-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E5E0D8] pb-4">
        <div>
          <h2 className="text-xl font-bold text-[#1A1C19]">
            Tổng quan Vận hành Cửa hàng
          </h2>
          <p className="text-xs text-[#5C5F58] mt-1">
            Bảng điều phối các đầu việc cần xử lý trong ngày. Chỉ hiển thị số đếm tổng hợp (không hiển thị thông tin cá nhân).
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          data-testid="refresh-operations-overview-btn"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#D5CFC4] bg-white text-xs font-medium text-[#1A1C19] hover:bg-[#F5F2EB]"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Cập nhật số đếm
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => (
          <div
            key={card.id}
            data-testid={`overview-card-${card.id}`}
            className="bg-white border border-[#E5E0D8] rounded-2xl p-5 flex flex-col justify-between hover:border-[#2D4A3E] transition-colors shadow-xs"
          >
            <div>
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-[#F5F2EB] flex items-center justify-center">
                  {card.icon}
                </div>
                <span
                  className={`px-2.5 py-1 rounded-md border text-[11px] font-semibold ${card.badgeColor}`}
                >
                  {card.unit}
                </span>
              </div>

              <h3 className="text-sm font-bold text-[#1A1C19]">{card.title}</h3>
              <p
                data-testid={`overview-count-${card.id}`}
                className="text-3xl font-extrabold text-[#1A1C19] mt-2 tracking-tight"
              >
                {card.count.toLocaleString('vi-VN')}
              </p>
              <p className="text-xs text-[#5C5F58] mt-2 leading-relaxed">{card.description}</p>
            </div>

            <div className="mt-5 pt-3.5 border-t border-[#F0ECE1]">
              <button
                type="button"
                onClick={() => onNavigateWithFilter(card.target)}
                data-testid={`overview-link-${card.id}`}
                className="w-full inline-flex items-center justify-between text-xs font-semibold text-[#2D4A3E] hover:text-[#1A1C19] group"
              >
                <span>{card.ctaLabel}</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-[#E5E0D8] rounded-xl p-4 flex items-center gap-3 text-xs text-[#5C5F58]">
        <ShieldCheck className="w-4 h-4 text-[#2D4A3E] shrink-0" />
        <span>
          Chế độ bảo vệ quyền riêng tư: Trang tổng quan vận hành chỉ hiển thị số lượng công việc tồn đọng và dẫn trực tiếp tới màn hình nghiệp vụ đã lọc sẵn trạng thái tương ứng.
        </span>
      </div>
    </div>
  );
};
