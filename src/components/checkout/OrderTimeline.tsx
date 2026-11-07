import React from 'react';
import {
  Clock,
  CheckCircle2,
  Package,
  Truck,
  CheckCheck,
  XCircle,
  RotateCcw,
} from 'lucide-react';
import type { OrderRecord } from '../../types/index.ts';

interface OrderTimelineProps {
  order: OrderRecord;
}

const MAIN_TIMELINE_STEPS = [
  { key: 'pending', label: 'Chờ xác nhận', icon: Clock },
  { key: 'confirmed', label: 'Đã xác nhận', icon: CheckCircle2 },
  { key: 'processing', label: 'Đang chuẩn bị hàng', icon: Package },
  { key: 'shipping', label: 'Đang giao', icon: Truck },
  { key: 'delivered', label: 'Đã giao', icon: CheckCircle2 },
  { key: 'completed', label: 'Hoàn thành', icon: CheckCheck },
] as const;

const STATUS_RANK: Record<string, number> = {
  pending: 0,
  confirmed: 1,
  processing: 2,
  shipping: 3,
  delivered: 4,
  return_requested: 4,
  completed: 5,
  cancelled: -1,
};

const STATUS_VI_LABEL: Record<string, string> = {
  pending: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  processing: 'Đang chuẩn bị hàng',
  shipping: 'Đang giao',
  delivered: 'Đã giao',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
  return_requested: 'Đổi trả',
};

export const OrderTimeline: React.FC<OrderTimelineProps> = ({ order }) => {
  const history = order.statusHistory || [];

  const getStepTimestamp = (statusKey: string): string | null => {
    const matched = [...history].reverse().find((h) => h.status === statusKey);
    if (matched?.createdAt) return matched.createdAt;
    if (statusKey === 'pending' && order.createdAt) return order.createdAt;
    if (statusKey === 'delivered' && order.deliveredAt) return order.deliveredAt;
    if (statusKey === 'completed' && order.completedAt) return order.completedAt;
    return null;
  };

  const currentRank = STATUS_RANK[order.status] ?? 0;
  const isCancelled = order.status === 'cancelled';
  const isReturnRequested =
    order.status === 'return_requested' ||
    history.some((h) => h.status === 'return_requested');

  const cancelledTimestamp = getStepTimestamp('cancelled');
  const returnTimestamp = getStepTimestamp('return_requested');

  return (
    <div className="p-4 bg-white rounded-xl border border-[#EAE6DE] space-y-4">
      <div className="text-xs font-bold text-[#1A1C19] uppercase tracking-wider">
        Tiến Độ & Lịch Sử Trạng Thái Đơn Hàng
      </div>

      {/* 6 bước chính: Chờ xác nhận -> Đã xác nhận -> Đang chuẩn bị hàng -> Đang giao -> Đã giao -> Hoàn thành */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-center">
        {MAIN_TIMELINE_STEPS.map((step, idx) => {
          const Icon = step.icon;
          const stepTime = getStepTimestamp(step.key);
          const isReached = !isCancelled ? currentRank >= idx : Boolean(stepTime);
          const isCurrent = order.status === step.key;

          return (
            <div
              key={step.key}
              className={`p-2.5 rounded-xl border flex flex-col items-center justify-between gap-1.5 transition-colors ${
                isCurrent
                  ? 'bg-[#2D4A3E] text-white border-[#2D4A3E] shadow-xs'
                  : isReached
                  ? 'bg-[#F0ECE1] text-[#2D4A3E] border-[#C5D1C8]'
                  : 'bg-[#FAF8F5] text-[#8C877B] border-[#E5E0D5]'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <div className="text-[11px] font-bold leading-tight">{step.label}</div>
              <div
                className={`text-[10px] tabular-nums ${
                  isCurrent ? 'text-[#E4DEC9]' : 'text-[#7A7569]'
                }`}
              >
                {stepTime
                  ? new Date(stepTime).toLocaleString('vi-VN', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '—'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Nhánh Đã hủy hoặc Đổi trả (luôn hiển thị nhánh trạng thái đặc biệt kèm mốc thời gian) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
        <div
          className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
            isCancelled
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-[#FAF8F5] border-[#EAE6DE] text-[#8C877B]'
          }`}
        >
          <XCircle
            className={`w-4 h-4 shrink-0 mt-0.5 ${
              isCancelled ? 'text-red-600' : 'text-[#8C877B]'
            }`}
          />
          <div className="flex-1">
            <div className="font-bold">Nhánh: Đã hủy</div>
            {isCancelled ? (
              <>
                <div className="text-[11px] mt-0.5">
                  Lý do: {order.cancelReason || 'Theo yêu cầu hủy đơn'}
                </div>
                {cancelledTimestamp && (
                  <div className="text-[10px] tabular-nums mt-0.5 opacity-80">
                    Mốc thời gian: {new Date(cancelledTimestamp).toLocaleString('vi-VN')}
                  </div>
                )}
              </>
            ) : (
              <div className="text-[11px] mt-0.5">Đơn hàng không bị hủy</div>
            )}
          </div>
        </div>

        <div
          className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs ${
            isReturnRequested
              ? 'bg-[#FAF3EA] border-[#E8DFC8] text-[#7A5C43]'
              : 'bg-[#FAF8F5] border-[#EAE6DE] text-[#8C877B]'
          }`}
        >
          <RotateCcw
            className={`w-4 h-4 shrink-0 mt-0.5 ${
              isReturnRequested ? 'text-[#C27D56]' : 'text-[#8C877B]'
            }`}
          />
          <div className="flex-1">
            <div className="font-bold">Nhánh: Đổi trả / Hoàn tiền</div>
            {isReturnRequested ? (
              <>
                <div className="text-[11px] mt-0.5">
                  Đang có yêu cầu đổi trả / hoàn tiền trên đơn hàng này
                </div>
                {returnTimestamp && (
                  <div className="text-[10px] tabular-nums mt-0.5 opacity-80">
                    Mốc thời gian: {new Date(returnTimestamp).toLocaleString('vi-VN')}
                  </div>
                )}
              </>
            ) : (
              <div className="text-[11px] mt-0.5">Chưa phát sinh yêu cầu đổi trả</div>
            )}
          </div>
        </div>
      </div>

      {/* Chi tiết lịch sử các mốc thời gian */}
      {history.length > 0 && (
        <div className="space-y-2 text-xs pt-3 border-t border-[#F2EFE9]">
          <div className="text-[11px] font-bold text-[#4A4740] uppercase tracking-wider">
            Nhật ký mốc thời gian chi tiết
          </div>
          {history.map((h) => (
            <div
              key={h.id}
              className="flex items-start justify-between gap-2 text-[#5C584F] border-b border-[#F2EFE9] pb-1.5 last:border-none"
            >
              <div>
                <strong className="text-[#1A1C19]">
                  {STATUS_VI_LABEL[h.status] || h.status}:
                </strong>{' '}
                <span>{h.note}</span>
              </div>
              <span className="text-[11px] text-[#8C877B] tabular-nums shrink-0">
                {new Date(h.createdAt).toLocaleString('vi-VN')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
