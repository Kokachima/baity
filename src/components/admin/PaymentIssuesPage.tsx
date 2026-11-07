import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import { formatCurrency, formatDateTime } from './AdminLayout.tsx';

interface PaymentIssuesPageProps {
  onRefreshOverview: () => void;
  onShowToast?: (msg: string) => void;
}

export const PaymentIssuesPage: React.FC<PaymentIssuesPageProps> = ({
  onRefreshOverview,
  onShowToast,
}) => {
  const [refundNeededPayments, setRefundNeededPayments] = useState<any[]>([]);
  const [mismatchEvents, setMismatchEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteByKey, setNoteByKey] = useState<Record<string, string>>({});
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);

  const loadIssues = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiRequest('/api/admin/payment-issues');
    setLoading(false);
    if (!res.ok) {
      setError(res.errorMessage || 'Không thể tải danh sách sự cố đối soát thanh toán');
      return;
    }
    setRefundNeededPayments(
      Array.isArray(res.data?.refundNeededPayments) ? res.data.refundNeededPayments : []
    );
    setMismatchEvents(
      Array.isArray(res.data?.paymentMismatchEvents) ? res.data.paymentMismatchEvents : []
    );
  }, []);

  useEffect(() => {
    loadIssues();
  }, [loadIssues]);

  const handleResolveIssue = async (
    issueType: 'payment_event' | 'refund_needed_payment',
    id: string | number
  ) => {
    const key = `${issueType}:${id}`;
    const note = (noteByKey[key] || 'Đã đối soát và xử lý thủ công').trim();
    if (note.length < 2) {
      onShowToast?.('Vui lòng nhập ghi chú xử lý tối thiểu 2 ký tự');
      return;
    }
    setResolvingKey(key);
    const res = await apiRequest(
      `/api/admin/payment-issues/${encodeURIComponent(issueType)}/${encodeURIComponent(String(id))}/resolve`,
      {
        method: 'POST',
        body: JSON.stringify({
          note,
        }),
      }
    );
    setResolvingKey(null);
    if (!res.ok) {
      onShowToast?.(res.errorMessage || 'Không thể đánh dấu đã xử lý');
      return;
    }
    onShowToast?.(res.data?.message || 'Đã đánh dấu sự cố thanh toán là đã xử lý');
    await loadIssues();
    onRefreshOverview();
  };

  return (
    <div className="space-y-6">
      {/* 1. Sự kiện lệch tiền hoặc tiền về sau khi đơn đã hủy */}
      <div className="bg-white rounded-2xl border border-[#E0DCD3] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A1C19] flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <span>Sự kiện Webhook lệch tiền / Tiền về sau khi hủy ({mismatchEvents.length})</span>
            </h2>
            <p className="text-xs text-[#6B665C]">
              Khi đánh dấu Đã xử lý, hệ thống cập nhật trạng thái xử lý và ghi admin_audit_logs trong cùng giao dịch.
            </p>
          </div>
          <button
            type="button"
            onClick={loadIssues}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#F5F2EB] hover:bg-[#EAE5DC] rounded-lg"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Tải lại</span>
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-xs text-[#6B665C]">Đang tải dữ liệu...</div>
        ) : error ? (
          <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {error}
          </div>
        ) : mismatchEvents.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#6B665C]">
            Không có sự kiện lệch tiền nào chưa xử lý.
          </div>
        ) : (
          <div className="space-y-3">
            {mismatchEvents.map((ev) => {
              const key = `payment_event:${ev.id}`;
              return (
                <div
                  key={ev.id}
                  className="p-4 rounded-xl border border-amber-200 bg-amber-50/60 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs"
                >
                  <div className="space-y-1">
                    <div className="font-bold text-amber-900">
                      Sự kiện #{ev.id} · Đơn #{ev.orderId} · Loại: {ev.eventType}
                    </div>
                    <div>
                      Mã giao dịch: <span className="font-mono">{ev.transactionId}</span> · Cần thu:{' '}
                      <strong>{formatCurrency(ev.expectedAmount)}</strong> · Nhận được:{' '}
                      <strong>{formatCurrency(ev.receivedAmount)}</strong>
                    </div>
                    <div className="text-[#6B665C]">
                      Thời gian: {formatDateTime(ev.createdAt)}
                      {ev.resolvedAt ? ` · Đã xử lý lúc ${formatDateTime(ev.resolvedAt)}` : ''}
                    </div>
                  </div>

                  {!ev.resolvedAt && (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                      <input
                        type="text"
                        value={noteByKey[key] || ''}
                        onChange={(e) =>
                          setNoteByKey((prev) => ({ ...prev, [key]: e.target.value }))
                        }
                        placeholder="Ghi chú đối soát..."
                        className="px-3 py-1.5 bg-white border border-[#D5D0C5] rounded-lg text-xs"
                      />
                      <button
                        type="button"
                        disabled={resolvingKey === key}
                        onClick={() => handleResolveIssue('payment_event', ev.id)}
                        className="inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-[#2D4A3E] text-white font-semibold rounded-lg disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Đánh dấu đã xử lý</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. Giao dịch cần hoàn tiền (refund_needed) */}
      <div className="bg-white rounded-2xl border border-[#E0DCD3] p-6 space-y-4">
        <div>
          <h2 className="font-display text-lg font-bold text-[#1A1C19]">
            Giao dịch chờ hoàn tiền (`payments.status = refund_needed`) ({refundNeededPayments.length})
          </h2>
          <p className="text-xs text-[#6B665C]">
            Các khoản thanh toán đã thu tiền nhưng đơn hàng bị hủy hoặc cần hoàn lại cho khách.
          </p>
        </div>

        {refundNeededPayments.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#6B665C]">
            Không có giao dịch nào đang ở trạng thái chờ hoàn tiền.
          </div>
        ) : (
          <div className="space-y-3">
            {refundNeededPayments.map((pmt) => {
              const key = `refund_needed_payment:${pmt.id}`;
              return (
                <div
                  key={pmt.id}
                  className="p-4 rounded-xl border border-red-200 bg-red-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs"
                >
                  <div className="space-y-1">
                    <div className="font-bold text-red-900">
                      Thanh toán #{pmt.id} · Đơn #{pmt.orderId} · {pmt.method?.toUpperCase()}
                    </div>
                    <div>
                      Số tiền: <strong>{formatCurrency(pmt.amount)}</strong> · Mã GD:{' '}
                      <span className="font-mono">{pmt.transactionId || '—'}</span>
                    </div>
                    <div className="text-[#6B665C]">
                      Tạo lúc: {formatDateTime(pmt.createdAt)}
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                    <input
                      type="text"
                      value={noteByKey[key] || ''}
                      onChange={(e) =>
                        setNoteByKey((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      placeholder="Ghi chú hoàn tiền..."
                      className="px-3 py-1.5 bg-white border border-[#D5D0C5] rounded-lg text-xs"
                    />
                    <button
                      type="button"
                      disabled={resolvingKey === key}
                      onClick={() => handleResolveIssue('refund_needed_payment', pmt.id)}
                      className="inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-[#2D4A3E] text-white font-semibold rounded-lg disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Đánh dấu đã xử lý</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
