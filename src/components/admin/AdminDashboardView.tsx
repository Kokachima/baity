import React, { useState, useEffect, useCallback } from 'react';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import type { User } from '../../types/index.ts';
import { AdminLayout, type AdminTabKey } from './AdminLayout.tsx';
import {
  OperationsOverviewPage,
  type OverviewNavigationTarget,
} from './OperationsOverviewPage.tsx';
import { OrdersPage } from './OrdersPage.tsx';
import { ReturnsPage } from './ReturnsPage.tsx';
import { PaymentIssuesPage } from './PaymentIssuesPage.tsx';
import { CategoriesPage } from './CategoriesPage.tsx';
import { ProductsPage } from './ProductsPage.tsx';
import { QuickProductImagesPage } from './QuickProductImagesPage.tsx';
import { InventoryPage } from './InventoryPage.tsx';
import { VouchersPage } from './VouchersPage.tsx';
import { PromotionsPage } from './PromotionsPage.tsx';
import { StoreSettingsPage } from './StoreSettingsPage.tsx';
import { PoliciesFaqPage } from './PoliciesFaqPage.tsx';
import { ReviewsAdminPage } from './ReviewsAdminPage.tsx';
import {
  SellerChatsAdminPage,
  type AdminChatFilterStatus,
} from './SellerChatsAdminPage.tsx';
import { StatsDashboardPage } from './StatsDashboardPage.tsx';
import { AuditLogPage } from './AuditLogPage.tsx';

interface AdminDashboardViewProps {
  currentUser: User | null;
  onBackToStore: () => void;
  onShowToast?: (msg: string) => void;
}

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  currentUser,
  onBackToStore,
  onShowToast,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTabKey>('overview');
  const [authStatus, setAuthStatus] = useState<'checking' | 'authorized' | 'forbidden'>('checking');
  const [overview, setOverview] = useState<any>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // State lọc sẵn khi điều hướng từ trang Tổng quan vận hành (OperationsOverviewPage)
  const [orderStatusPreset, setOrderStatusPreset] = useState<string>('all');
  const [orderPaymentPreset, setOrderPaymentPreset] = useState<string>('all');
  const [returnStatusPreset, setReturnStatusPreset] = useState<string>('all');
  const [inventoryFilterPreset, setInventoryFilterPreset] = useState<'all' | 'low' | 'out'>('all');
  const [reviewRepliedPreset, setReviewRepliedPreset] = useState<'all' | 'replied' | 'unreplied'>(
    'all'
  );
  const [reviewVisibilityPreset, setReviewVisibilityPreset] = useState<
    'all' | 'visible' | 'hidden'
  >('all');
  const [chatStatusPreset, setChatStatusPreset] = useState<AdminChatFilterStatus>('unreplied');

  const loadAdminMe = useCallback(async () => {
    if (!currentUser || currentUser.role !== 'admin') {
      setAuthStatus('forbidden');
      return;
    }
    setOverviewError(null);
    const res = await apiRequest('/api/admin/me');
    if (res.status === 401 || res.status === 403) {
      setAuthStatus('forbidden');
      return;
    }
    if (!res.ok) {
      setOverviewError(res.errorMessage || 'Không thể tải dữ liệu tổng quan quản trị');
      setAuthStatus('authorized');
      return;
    }
    setOverview(res.data?.overview || null);
    setAuthStatus('authorized');
  }, [currentUser]);

  useEffect(() => {
    loadAdminMe();
  }, [loadAdminMe]);

  const handleNavigateFromOverview = (target: OverviewNavigationTarget) => {
    if (target.focusPaymentIssues) {
      setActiveTab('payment_issues');
      return;
    }
    if (target.orderStatus) {
      setOrderStatusPreset(target.orderStatus);
    } else {
      setOrderStatusPreset('all');
    }
    if (target.orderPaymentMethod) {
      setOrderPaymentPreset(target.orderPaymentMethod);
    } else {
      setOrderPaymentPreset('all');
    }
    if (target.returnStatus) {
      setReturnStatusPreset(target.returnStatus);
    } else {
      setReturnStatusPreset('all');
    }
    if (target.inventoryLowStockOnly) {
      setInventoryFilterPreset('low');
    } else {
      setInventoryFilterPreset('all');
    }
    if (target.reviewReplied) {
      setReviewRepliedPreset(target.reviewReplied);
    } else {
      setReviewRepliedPreset('all');
    }
    if (target.reviewVisibility) {
      setReviewVisibilityPreset(target.reviewVisibility);
    } else {
      setReviewVisibilityPreset('all');
    }
    if (target.chatStatus) {
      setChatStatusPreset(target.chatStatus);
    } else {
      setChatStatusPreset('unreplied');
    }
    setActiveTab(target.tab);
  };

  if (authStatus === 'forbidden') {
    return (
      <div className="max-w-xl mx-auto my-16 px-6 py-12 bg-white rounded-2xl border border-[#E0DCD3] shadow-sm text-center space-y-4">
        <div className="w-14 h-14 rounded-full bg-red-50 text-red-700 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <h1 className="font-display text-2xl font-bold text-[#1A1C19]">
          403 — Từ chối truy cập khu vực Quản trị
        </h1>
        <p className="text-sm text-[#6B665C] leading-relaxed">
          Khu vực <strong>/admin</strong> chỉ dành cho tài khoản Quản trị viên (
          <code>role === 'admin'</code>). Mọi yêu cầu API tới <code>/api/admin/*</code> đều được kiểm soát nghiêm ngặt ở phía Server.
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={onBackToStore}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#2D4A3E] text-white text-xs font-semibold rounded-lg hover:bg-[#233B31]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Quay lại cửa hàng</span>
          </button>
        </div>
      </div>
    );
  }

  if (authStatus === 'checking') {
    return (
      <div className="max-w-7xl mx-auto py-16 px-4 text-center text-sm text-[#6B665C]">
        Đang xác thực quyền Quản trị viên...
      </div>
    );
  }

  return (
    <AdminLayout
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      overview={overview}
      adminEmail={currentUser?.email}
      onRefreshOverview={loadAdminMe}
      onBackToStore={onBackToStore}
    >
      {overviewError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
          {overviewError}
        </div>
      )}

      {activeTab === 'overview' && (
        <OperationsOverviewPage
          overview={overview || {}}
          onRefresh={loadAdminMe}
          onNavigateWithFilter={handleNavigateFromOverview}
        />
      )}

      {activeTab === 'orders' && (
        <OrdersPage
          onRefreshOverview={loadAdminMe}
          onShowToast={onShowToast}
          initialStatusFilter={orderStatusPreset}
          initialPaymentMethodFilter={orderPaymentPreset}
        />
      )}

      {activeTab === 'returns' && (
        <ReturnsPage
          onRefreshOverview={loadAdminMe}
          onShowToast={onShowToast}
          initialStatusFilter={returnStatusPreset}
        />
      )}

      {activeTab === 'payment_issues' && (
        <PaymentIssuesPage onRefreshOverview={loadAdminMe} onShowToast={onShowToast} />
      )}

      {activeTab === 'categories' && <CategoriesPage onShowToast={onShowToast} />}

      {activeTab === 'products' && <ProductsPage onShowToast={onShowToast} />}

      {activeTab === 'quick_images' && <QuickProductImagesPage onShowToast={onShowToast} />}

      {activeTab === 'inventory' && (
        <InventoryPage
          onRefreshOverview={loadAdminMe}
          onShowToast={onShowToast}
          initialFilterMode={inventoryFilterPreset}
        />
      )}

      {activeTab === 'vouchers' && <VouchersPage onShowToast={onShowToast} />}

      {activeTab === 'promotions' && <PromotionsPage onShowToast={onShowToast} />}

      {activeTab === 'settings' && (
        <StoreSettingsPage onShowToast={onShowToast} onRefreshOverview={loadAdminMe} />
      )}

      {activeTab === 'policies' && <PoliciesFaqPage onShowToast={onShowToast} />}

      {activeTab === 'reviews' && (
        <ReviewsAdminPage
          initialRepliedFilter={reviewRepliedPreset}
          initialVisibilityFilter={reviewVisibilityPreset}
          onDataChanged={loadAdminMe}
        />
      )}

      {activeTab === 'chats' && (
        <SellerChatsAdminPage
          initialFilter={chatStatusPreset}
          onDataChanged={loadAdminMe}
          onShowToast={onShowToast}
        />
      )}

      {activeTab === 'stats' && <StatsDashboardPage />}

      {activeTab === 'audit' && <AuditLogPage />}
    </AdminLayout>
  );
};
