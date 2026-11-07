import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import { formatDateTime } from './AdminLayout.tsx';

export const AuditLogPage: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    const sp = new URLSearchParams();
    sp.set('page', String(page));
    sp.set('limit', '20');
    if (actionFilter.trim()) sp.set('action', actionFilter.trim());
    if (targetTypeFilter.trim()) sp.set('targetType', targetTypeFilter.trim());

    const res = await apiRequest(`/api/admin/audit-logs?${sp.toString()}`);
    setLoading(false);
    if (!res.ok) {
      setError(res.errorMessage || 'Không thể tải nhật ký quản trị');
      return;
    }
    setLogs(Array.isArray(res.data?.items) ? res.data.items : []);
    setTotalPages(Number(res.data?.totalPages || 1));
  }, [page, actionFilter, targetTypeFilter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  return (
    <div className="bg-white rounded-2xl border border-[#E0DCD3] p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-[#1A1C19]">
            Nhật ký thao tác Quản trị (`admin_audit_logs`)
          </h2>
          <p className="text-xs text-[#6B665C]">
            Ghi nhận tự động người thực hiện, hành động, đối tượng, trạng thái trước/sau và thời điểm trong cùng giao dịch.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            placeholder="Lọc theo action..."
            className="px-3 py-1.5 text-xs border border-[#D5D0C5] rounded-lg"
          />
          <input
            type="text"
            value={targetTypeFilter}
            onChange={(e) => {
              setTargetTypeFilter(e.target.value);
              setPage(1);
            }}
            placeholder="Lọc theo loại đối tượng..."
            className="px-3 py-1.5 text-xs border border-[#D5D0C5] rounded-lg"
          />
          <button
            type="button"
            onClick={loadLogs}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#F5F2EB] hover:bg-[#EAE5DC] rounded-lg"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Làm mới</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-xs text-[#6B665C]">Đang tải nhật ký...</div>
      ) : error ? (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
          {error}
        </div>
      ) : logs.length === 0 ? (
        <div className="py-10 text-center text-xs text-[#6B665C]">Chưa có bản ghi nhật ký nào.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#EAE6DE] text-[#6B665C]">
                <th className="py-2.5 px-3 font-semibold">Thời gian</th>
                <th className="py-2.5 px-3 font-semibold">Quản trị viên</th>
                <th className="py-2.5 px-3 font-semibold">Hành động</th>
                <th className="py-2.5 px-3 font-semibold">Đối tượng</th>
                <th className="py-2.5 px-3 font-semibold">Ghi chú</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F2EFE9]">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-[#FAF8F5]">
                  <td className="py-2.5 px-3 text-[#6B665C] whitespace-nowrap">
                    {formatDateTime(log.createdAt)}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="font-semibold text-[#1A1C19]">{log.adminName || 'Admin'}</div>
                    <div className="text-[11px] text-[#6B665C] font-mono">{log.adminEmail}</div>
                  </td>
                  <td className="py-2.5 px-3 font-mono font-bold text-[#2D4A3E]">
                    {log.action}
                  </td>
                  <td className="py-2.5 px-3 font-mono">
                    {log.targetType}:{log.targetId}
                  </td>
                  <td className="py-2.5 px-3 text-[#4A4740]">{log.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-3 border-t border-[#EAE6DE] text-xs">
          <span>
            Trang {page} / {totalPages}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1 rounded border border-[#D5D0C5] disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-1 rounded border border-[#D5D0C5] disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
