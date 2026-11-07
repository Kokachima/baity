import React, { useState, useEffect, useCallback } from 'react';
import {
  MessagesSquare,
  Send,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { SELLER_CHAT_MESSAGE_MAX_LENGTH } from '../../../shared/contracts.ts';
import { formatDateTime } from './AdminLayout.tsx';

export type AdminChatFilterStatus = 'unreplied' | 'open' | 'closed' | 'all';

export interface AdminSellerChatSummaryItem {
  id: string;
  status: 'open' | 'closed';
  customerDisplayName: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  closedAt: string | null;
  unreadAdmin: number;
  unreadUser: number;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSellerChatMessage {
  id: string;
  conversationId: string;
  senderType: 'user' | 'admin';
  content: string;
  createdAt: string;
}

export interface SellerChatsAdminPageProps {
  initialFilter?: AdminChatFilterStatus;
  onDataChanged?: () => void;
  onShowToast?: (msg: string) => void;
}

export const SellerChatsAdminPage: React.FC<SellerChatsAdminPageProps> = ({
  initialFilter = 'unreplied',
  onDataChanged,
  onShowToast,
}) => {
  const [filter, setFilter] = useState<AdminChatFilterStatus>(initialFilter);
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [total, setTotal] = useState<number>(0);
  const [summaryCounts, setSummaryCounts] = useState({
    totalConversations: 0,
    unrepliedCount: 0,
    openCount: 0,
    closedCount: 0,
  });

  const [conversations, setConversations] = useState<AdminSellerChatSummaryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] =
    useState<AdminSellerChatSummaryItem | null>(null);
  const [messages, setMessages] = useState<AdminSellerChatMessage[]>([]);
  const [replyText, setReplyText] = useState<string>('');

  const [loadingList, setLoadingList] = useState<boolean>(true);
  const [loadingThread, setLoadingThread] = useState<boolean>(false);
  const [sendingReply, setSendingReply] = useState<boolean>(false);
  const [updatingStatus, setUpdatingStatus] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setFilter(initialFilter);
    setPage(1);
  }, [initialFilter]);

  const loadConversations = useCallback(async () => {
    setLoadingList(true);
    setErrorMessage(null);
    try {
      const qs = new URLSearchParams({
        status: filter,
        page: String(page),
        limit: '20',
      }).toString();
      const res = await fetch(`/api/admin/chats?${qs}`, { credentials: 'include' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        throw new Error(body?.message || 'Không thể tải danh sách hội thoại hỏi đáp');
      }
      const list: AdminSellerChatSummaryItem[] = Array.isArray(body.items) ? body.items : [];
      setConversations(list);
      setTotal(Number(body.total || 0));
      setTotalPages(Math.max(1, Number(body.totalPages || 1)));
      if (body.summary) {
        setSummaryCounts(body.summary);
      }
      if (!selectedId && list.length > 0) {
        setSelectedId(list[0].id);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Lỗi tải danh sách hội thoại');
    } finally {
      setLoadingList(false);
    }
  }, [filter, page, selectedId]);

  const loadThreadMessages = useCallback(
    async (convId: string) => {
      setLoadingThread(true);
      setErrorMessage(null);
      try {
        const res = await fetch(`/api/admin/chats/${encodeURIComponent(convId)}/messages`, {
          credentials: 'include',
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.success) {
          throw new Error(body?.message || 'Không thể tải nội dung tin nhắn hội thoại');
        }
        if (body.conversation) {
          setSelectedConversation(body.conversation);
          setConversations((prev) =>
            prev.map((c) => (c.id === convId ? { ...c, ...body.conversation, unreadAdmin: 0 } : c))
          );
        }
        setMessages(Array.isArray(body.messages) ? body.messages : []);
        onDataChanged?.();
      } catch (err: any) {
        setErrorMessage(err?.message || 'Lỗi tải luồng tin nhắn');
      } finally {
        setLoadingThread(false);
      }
    },
    [onDataChanged]
  );

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (selectedId) {
      loadThreadMessages(selectedId);
    } else {
      setSelectedConversation(null);
      setMessages([]);
    }
  }, [selectedId, loadThreadMessages]);

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId || sendingReply) return;
    const trimmed = replyText.trim();
    if (!trimmed) return;
    if (trimmed.length > SELLER_CHAT_MESSAGE_MAX_LENGTH) {
      setErrorMessage(
        `Nội dung phản hồi không được vượt quá ${SELLER_CHAT_MESSAGE_MAX_LENGTH} ký tự.`
      );
      return;
    }

    setSendingReply(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/admin/chats/${encodeURIComponent(selectedId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: trimmed }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        throw new Error(body?.message || 'Không thể gửi phản hồi');
      }
      setReplyText('');
      if (body.message) {
        setMessages((prev) => [...prev, body.message]);
      }
      if (body.conversation) {
        setSelectedConversation((prev) => (prev ? { ...prev, ...body.conversation } : prev));
      }
      onShowToast?.('Đã gửi phản hồi cho khách hàng');
      await loadConversations();
      onDataChanged?.();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Lỗi gửi phản hồi');
    } finally {
      setSendingReply(false);
    }
  };

  const handleToggleStatus = async (nextStatus: 'open' | 'closed') => {
    if (!selectedId || updatingStatus) return;
    setUpdatingStatus(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/admin/chats/${encodeURIComponent(selectedId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: nextStatus }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        throw new Error(body?.message || 'Không thể cập nhật trạng thái hội thoại');
      }
      if (body.conversation) {
        setSelectedConversation((prev) => (prev ? { ...prev, ...body.conversation } : prev));
      }
      onShowToast?.(
        nextStatus === 'closed' ? 'Đã đóng hội thoại hỏi đáp' : 'Đã mở lại hội thoại hỏi đáp'
      );
      await loadConversations();
      onDataChanged?.();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Lỗi cập nhật trạng thái hội thoại');
    } finally {
      setUpdatingStatus(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="seller-chats-admin-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E5E0D8] pb-4">
        <div>
          <h2 className="text-xl font-bold text-[#1A1C19] flex items-center gap-2">
            <MessagesSquare className="w-5 h-5 text-[#2D4A3E]" />
            Hỏi đáp với Khách hàng (Chat với Người bán)
          </h2>
          <p className="text-xs text-[#5C5F58] mt-1">
            Chỉ hiển thị tên hiển thị rút gọn của khách hàng (không hiển thị email, SĐT, địa chỉ). Tự động xóa hội thoại đã đóng quá 180 ngày.
          </p>
        </div>
        <button
          type="button"
          onClick={loadConversations}
          data-testid="refresh-admin-chats-btn"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#D5CFC4] bg-white text-xs font-medium text-[#1A1C19] hover:bg-[#F5F2EB]"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Làm mới danh sách
        </button>
      </div>

      {/* Bộ lọc trạng thái */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-[#E5E0D8] rounded-xl p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            {
              key: 'unreplied' as const,
              label: `Chưa trả lời (${summaryCounts.unrepliedCount})`,
            },
            {
              key: 'open' as const,
              label: `Đang mở (${summaryCounts.openCount})`,
            },
            {
              key: 'closed' as const,
              label: `Đã đóng (${summaryCounts.closedCount})`,
            },
            {
              key: 'all' as const,
              label: `Tất cả (${summaryCounts.totalConversations})`,
            },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              data-testid={`admin-chat-filter-${tab.key}`}
              onClick={() => {
                setFilter(tab.key);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                filter === tab.key
                  ? 'bg-[#2D4A3E] text-white'
                  : 'bg-[#F5F2EB] text-[#5C5F58] hover:text-[#1A1C19]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs text-[#5C5F58]">
          <span>Tổng: {total} hội thoại</span>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1 rounded border border-[#D5CFC4] disabled:opacity-40"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="px-1.5 font-semibold">
                {page}/{totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1 rounded border border-[#D5CFC4] disabled:opacity-40"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {errorMessage && (
        <div
          data-testid="admin-chat-error"
          className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Bố cục 2 cột: Danh sách hội thoại & Luồng tin nhắn */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Cột trái: Danh sách hội thoại */}
        <div className="lg:col-span-5 bg-white border border-[#E5E0D8] rounded-2xl overflow-hidden flex flex-col max-h-[600px]">
          <div className="px-4 py-3 bg-[#FAF8F5] border-b border-[#E5E0D8] text-xs font-bold text-[#1A1C19]">
            Danh sách cuộc trò chuyện
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-[#F0ECE1]">
            {loadingList ? (
              <div className="p-8 text-center text-xs text-[#5C5F58]">
                Đang tải danh sách hội thoại...
              </div>
            ) : conversations.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#5C5F58]">
                Không có hội thoại nào trong bộ lọc hiện tại.
              </div>
            ) : (
              conversations.map((conv) => {
                const isSelected = conv.id === selectedId;
                return (
                  <button
                    key={conv.id}
                    type="button"
                    data-testid={`admin-chat-row-${conv.id}`}
                    onClick={() => setSelectedId(conv.id)}
                    className={`w-full text-left p-4 transition-colors ${
                      isSelected ? 'bg-[#F5F2EB]' : 'hover:bg-[#FAF8F5]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[#1A1C19]">
                        {conv.customerDisplayName}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {conv.unreadAdmin > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-[#C27D56] text-white text-[10px] font-bold">
                            {conv.unreadAdmin} mới
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            conv.status === 'open'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-stone-100 text-stone-600 border border-stone-200'
                          }`}
                        >
                          {conv.status === 'open' ? 'Đang mở' : 'Đã đóng'}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-[#5C5F58] truncate mt-1">
                      {conv.lastMessage || '(Chưa có tin nhắn)'}
                    </p>
                    <div className="text-[10px] text-[#7A7569] mt-1.5 flex items-center justify-between">
                      <span>{conv.messageCount || 0} tin nhắn</span>
                      <span>{formatDateTime(conv.lastMessageAt)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Cột phải: Luồng tin nhắn & Trả lời */}
        <div className="lg:col-span-7 bg-white border border-[#E5E0D8] rounded-2xl overflow-hidden flex flex-col h-[600px]">
          {selectedConversation ? (
            <>
              <div className="px-4 py-3 bg-[#FAF8F5] border-b border-[#E5E0D8] flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-[#1A1C19]">
                    Khách hàng: {selectedConversation.customerDisplayName}
                  </div>
                  <div className="text-[11px] text-[#5C5F58] flex items-center gap-2 mt-0.5">
                    {selectedConversation.status === 'open' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-800 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Đang mở
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-stone-600 font-medium">
                        <Clock className="w-3.5 h-3.5" />
                        Đã đóng ({formatDateTime(selectedConversation.closedAt)})
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  {selectedConversation.status === 'open' ? (
                    <button
                      type="button"
                      data-testid="admin-chat-close-btn"
                      disabled={updatingStatus}
                      onClick={() => handleToggleStatus('closed')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-xs font-semibold text-stone-700 disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Đóng hội thoại
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid="admin-chat-reopen-btn"
                      disabled={updatingStatus}
                      onClick={() => handleToggleStatus('open')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2D4A3E] bg-white hover:bg-[#F5F2EB] text-xs font-semibold text-[#2D4A3E] disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Mở lại hội thoại
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[#FAF8F5]">
                {loadingThread ? (
                  <div className="text-center py-10 text-xs text-[#5C5F58]">
                    Đang tải nội dung cuộc trò chuyện...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-10 text-xs text-[#5C5F58]">
                    Chưa có tin nhắn nào trong hội thoại này.
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isAdmin = msg.senderType === 'admin';
                    return (
                      <div
                        key={msg.id}
                        data-testid={`admin-thread-msg-${msg.senderType}`}
                        className={`flex flex-col ${isAdmin ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[82%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                            isAdmin
                              ? 'bg-[#2D4A3E] text-white'
                              : 'bg-white text-[#1A1C19] border border-[#E5E0D8]'
                          }`}
                        >
                          <div
                            className={`text-[10px] font-bold mb-1 ${
                              isAdmin ? 'text-white/80' : 'text-[#2D4A3E]'
                            }`}
                          >
                            {isAdmin
                              ? 'Cửa hàng Baity (Admin)'
                              : selectedConversation.customerDisplayName}{' '}
                            · {formatDateTime(msg.createdAt)}
                          </div>
                          {/* Hiển thị văn bản thuần 100% */}
                          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <form
                onSubmit={handleSendReply}
                className="p-3 bg-white border-t border-[#E5E0D8] flex items-center gap-2"
              >
                <input
                  type="text"
                  data-testid="admin-chat-reply-input"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  maxLength={SELLER_CHAT_MESSAGE_MAX_LENGTH}
                  placeholder="Nhập phản hồi cho khách hàng (văn bản thuần, tối đa 1000 ký tự)..."
                  className="flex-1 px-3.5 py-2 text-xs bg-[#FAF8F5] border border-[#D5CFC4] rounded-lg text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E]"
                />
                <button
                  type="submit"
                  data-testid="admin-chat-reply-send-btn"
                  disabled={sendingReply || !replyText.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#2D4A3E] hover:bg-[#233B31] text-white text-xs font-semibold rounded-lg disabled:opacity-40 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Gửi trả lời</span>
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-xs text-[#5C5F58]">
              Chọn một cuộc trò chuyện ở danh sách bên trái để xem nội dung và phản hồi khách hàng.
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border border-[#E5E0D8] rounded-xl p-4 flex items-center gap-3 text-xs text-[#5C5F58]">
        <ShieldCheck className="w-4 h-4 text-[#2D4A3E] shrink-0" />
        <span>
          Quyền riêng tư & An toàn dữ liệu: Nội dung hỏi đáp với người bán chỉ lưu trong cơ sở dữ liệu cửa hàng, không gửi tới Google Gemini và không ghi vào nhật ký hệ thống (log).
        </span>
      </div>
    </div>
  );
};
