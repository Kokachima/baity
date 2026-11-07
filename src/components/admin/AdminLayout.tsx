import React from 'react';
import {
  LayoutDashboard,
  Package,
  RotateCcw,
  AlertTriangle,
  FolderTree,
  ShoppingBag,
  Boxes,
  Ticket,
  Flame,
  Settings,
  BookOpen,
  MessageSquare,
  MessagesSquare,
  BarChart3,
  FileText,
  ArrowLeft,
  RefreshCw,
  Image as ImageIcon,
} from 'lucide-react';

export type AdminTabKey =
  | 'overview'
  | 'orders'
  | 'returns'
  | 'payment_issues'
  | 'categories'
  | 'products'
  | 'quick_images'
  | 'inventory'
  | 'vouchers'
  | 'promotions'
  | 'settings'
  | 'policies'
  | 'reviews'
  | 'chats'
  | 'stats'
  | 'audit';

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  processing: 'Đang chuẩn bị hàng',
  shipping: 'Đang giao hàng',
  delivered: 'Đã giao hàng',
  return_requested: 'Yêu cầu đổi trả',
  completed: 'Hoàn tất',
  cancelled: 'Đã hủy',
};

export const RETURN_STATUS_LABELS: Record<string, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  receiving: 'Đã nhận hàng trả',
  completed: 'Đã hoàn tiền',
  rejected: 'Đã từ chối',
};

export const STOCK_REASON_LABELS: Record<string, string> = {
  manual_import: 'Nhập kho thủ công',
  inventory_audit: 'Kiểm kê kho',
  damaged: 'Hàng lỗi / Hư hỏng',
  other: 'Lý do khác',
  order_created: 'Khách đặt đơn hàng',
  order_cancelled: 'Hoàn kho do hủy đơn',
  return_restock: 'Hoàn kho từ đơn đổi trả',
};

export function formatCurrency(val: number): string {
  return `${Math.round(Number(val || 0)).toLocaleString('vi-VN')}₫`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('vi-VN');
  } catch {
    return String(iso);
  }
}

interface AdminLayoutProps {
  activeTab: AdminTabKey;
  onSelectTab: (tab: AdminTabKey) => void;
  overview: any;
  adminEmail?: string;
  onRefreshOverview: () => void;
  onBackToStore: () => void;
  children: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  activeTab,
  onSelectTab,
  overview,
  adminEmail,
  onRefreshOverview,
  onBackToStore,
  children,
}) => {
  const navItems: {
    key: AdminTabKey;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }[] = [
    {
      key: 'overview',
      label: 'Tổng quan',
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      key: 'orders',
      label: 'Đơn hàng',
      icon: <Package className="w-4 h-4" />,
      badge: overview?.pendingOrders || 0,
    },
    {
      key: 'returns',
      label: 'Đổi trả & Hoàn tiền',
      icon: <RotateCcw className="w-4 h-4" />,
      badge: overview?.pendingReturns || 0,
    },
    {
      key: 'payment_issues',
      label: 'Đối soát thanh toán',
      icon: <AlertTriangle className="w-4 h-4" />,
      badge: (overview?.refundNeededCount || 0) + (overview?.paymentMismatchCount || 0),
    },
    {
      key: 'categories',
      label: 'Danh mục',
      icon: <FolderTree className="w-4 h-4" />,
    },
    {
      key: 'products',
      label: 'Sản phẩm',
      icon: <ShoppingBag className="w-4 h-4" />,
    },
    {
      key: 'quick_images',
      label: 'Ảnh sản phẩm nhanh',
      icon: <ImageIcon className="w-4 h-4" />,
    },
    {
      key: 'inventory',
      label: 'Tồn kho',
      icon: <Boxes className="w-4 h-4" />,
      badge: overview?.lowStockVariants || 0,
    },
    {
      key: 'vouchers',
      label: 'Voucher',
      icon: <Ticket className="w-4 h-4" />,
    },
    {
      key: 'promotions',
      label: 'Khuyến mãi',
      icon: <Flame className="w-4 h-4" />,
    },
    {
      key: 'settings',
      label: 'Cài đặt',
      icon: <Settings className="w-4 h-4" />,
    },
    {
      key: 'policies',
      label: 'Chính sách & FAQ',
      icon: <BookOpen className="w-4 h-4" />,
    },
    {
      key: 'reviews',
      label: 'Đánh giá',
      icon: <MessageSquare className="w-4 h-4" />,
      badge: overview?.unrepliedReviews || 0,
    },
    {
      key: 'chats',
      label: 'Hỏi đáp',
      icon: <MessagesSquare className="w-4 h-4" />,
      badge: overview?.unrepliedChats || 0,
    },
    {
      key: 'stats',
      label: 'Thống kê',
      icon: <BarChart3 className="w-4 h-4" />,
    },
    {
      key: 'audit',
      label: 'Nhật ký Admin',
      icon: <FileText className="w-4 h-4" />,
    },
  ];

  return (
    <div className="min-h-screen bg-[#F5F2EB] text-[#1A1C19]">
      {/* Header Quản trị */}
      <header className="bg-[#1A1C19] text-[#EAE6DE] border-b border-[#2D302B] sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="font-display text-lg font-extrabold tracking-widest text-white">
              BAITY ADMIN
            </span>
            <span className="hidden sm:inline-block text-xs px-2.5 py-0.5 rounded bg-[#2D4A3E] text-[#EAE6DE] font-medium">
              Vận hành, Danh mục, Cấu hình & Thống kê (8a–8d)
            </span>
          </div>

          <div className="flex items-center gap-3">
            {adminEmail && (
              <span className="hidden md:inline text-xs text-[#A8A49A] font-mono">
                {adminEmail}
              </span>
            )}
            <button
              type="button"
              onClick={onRefreshOverview}
              className="p-2 rounded-lg bg-[#2A2D27] hover:bg-[#383C34] text-[#EAE6DE] transition-colors"
              title="Làm mới số liệu"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onBackToStore}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2D4A3E] hover:bg-[#385B4C] text-xs font-semibold text-white transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Về cửa hàng</span>
            </button>
          </div>
        </div>

        {/* Thanh điều hướng Tab */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center gap-1 overflow-x-auto no-scrollbar border-t border-[#2A2D27]">
          {navItems.map((item) => {
            const isActive = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                data-testid={`admin-tab-${item.key}`}
                onClick={() => onSelectTab(item.key)}
                className={`flex items-center gap-2 px-3.5 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  isActive
                    ? 'border-[#A3B899] text-white bg-white/5'
                    : 'border-transparent text-[#A8A49A] hover:text-white'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] rounded bg-[#C27D56] text-white font-bold">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">{children}</main>
    </div>
  );
};
