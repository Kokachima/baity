import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, ShieldAlert, Clock, CheckCircle2, AlertCircle, RefreshCw, Lock } from 'lucide-react';
import {
  SELLER_CHAT_MESSAGE_MAX_LENGTH,
  SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION,
  SELLER_CHAT_SENSITIVE_WARNING_TEXT,
} from '../../../shared/contracts.ts';

export interface SellerChatMessageItem {
  id: string;
  conversationId: string;
  senderType: 'user' | 'admin';
  content: string;
  createdAt: string;
}

export interface SellerChatConversationState {
  id: string;
  status: 'open' | 'closed';
  waitingForReply?: boolean;
  lastMessage: string | null;
  lastMessageAt: string | null;
  closedAt: string | null;
  unreadAdmin: number;
  unreadUser: number;
}

export interface SellerChatPanelProps {
  isOpen: boolean;
  isAuthenticated: boolean;
  onRequireLogin?: () => void;
  onUnreadCountChange?: (unreadCount: number) => void;
  pollIntervalMs?: number;
}

export const SELLER_CHAT_POLL_INTERVAL_MS = 6000;

export const SellerChatPanel: React.FC<SellerChatPanelProps> = ({
  isOpen,
  isAuthenticated,
  onRequireLogin,
  onUnreadCountChange,
  pollIntervalMs = SELLER_CHAT_POLL_INTERVAL_MS,
}) => {
  const [conversation, setConversation] = useState<SellerChatConversationState | null>(null);
  const [messages, setMessages] = useState<SellerChatMessageItem[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [limitReachedNotice, setLimitReachedNotice] = useState<string | null>(null);
  const [isTabVisible, setIsTabVisible] = useState<boolean>(() =>
    typeof document !== 'undefined' ? document.visibilityState === 'visible' : true
  );

  const lastMessageIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length > 0) {
      lastMessageIdRef.current = messages[messages.length - 1].id;
    } else {
      lastMessageIdRef.current = null;
    }
  }, [messages]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibilityChange = () => {
      setIsTabVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const markAsReadIfNeeded = useCallback(
    async (conv: SellerChatConversationState | null) => {
      if (!conv || conv.unreadUser <= 0 || !isOpen || !isTabVisible) return;
      try {
        const res = await fetch('/api/chat/conversations/me/read', {
          method: 'POST',
          credentials: 'include',
        });
        if (res.ok) {
          const body = await res.json().catch(() => null);
          if (body?.conversation) {
            setConversation(body.conversation);
          } else {
            setConversation((prev) => (prev ? { ...prev, unreadUser: 0 } : prev));
          }
          onUnreadCountChange?.(0);
        }
      } catch {
        // Bỏ qua lỗi mạng tạm thời khi đánh dấu đã đọc
      }
    },
    [isOpen, isTabVisible, onUnreadCountChange]
  );

  const initOrFetchConversation = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    setErrorBanner(null);
    try {
      const meRes = await fetch('/api/chat/conversations/me', {
        method: 'GET',
        credentials: 'include',
      });
      if (meRes.status === 401) {
        onRequireLogin?.();
        return;
      }
      const meBody = await meRes.json().catch(() => null);
      if (!meRes.ok || !meBody?.success) {
        setErrorBanner(meBody?.message || 'Không thể tải hội thoại với cửa hàng.');
        return;
      }

      if (meBody.conversation) {
        const conv: SellerChatConversationState = meBody.conversation;
        const msgList: SellerChatMessageItem[] = Array.isArray(meBody.messages)
          ? meBody.messages
          : [];
        setConversation(conv);
        setMessages(msgList);
        onUnreadCountChange?.(Number(conv.unreadUser || 0));
        await markAsReadIfNeeded(conv);
      } else {
        // Khởi tạo hội thoại mở cho người dùng đã đăng nhập
        const createRes = await fetch('/api/chat/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        });
        const createBody = await createRes.json().catch(() => null);
        if (createRes.ok && createBody?.conversation) {
          setConversation(createBody.conversation);
          setMessages(Array.isArray(createBody.messages) ? createBody.messages : []);
          onUnreadCountChange?.(Number(createBody.conversation.unreadUser || 0));
        }
      }
    } catch {
      setErrorBanner('Mất kết nối mạng khi tải cuộc trò chuyện. Vui lòng thử lại.');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, markAsReadIfNeeded, onRequireLogin, onUnreadCountChange]);

  const pollNewMessages = useCallback(async () => {
    if (!isAuthenticated || !isOpen || !isTabVisible) return;
    try {
      const afterCursor = lastMessageIdRef.current;
      const qs = afterCursor ? `?after=${encodeURIComponent(afterCursor)}` : '';
      const res = await fetch(`/api/chat/conversations/me${qs}`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) return;
      const body = await res.json().catch(() => null);
      if (!body?.success || !body.conversation) return;

      const nextConv: SellerChatConversationState = body.conversation;
      const incoming: SellerChatMessageItem[] = Array.isArray(body.messages) ? body.messages : [];

      setConversation(nextConv);
      if (incoming.length > 0) {
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const merged = [...prev];
          for (const item of incoming) {
            if (!existingIds.has(item.id)) {
              merged.push(item);
              existingIds.add(item.id);
            }
          }
          return merged;
        });
      }

      if (nextConv.unreadUser > 0) {
        await markAsReadIfNeeded(nextConv);
      } else {
        onUnreadCountChange?.(0);
      }
    } catch {
      // Giữ nguyên giao diện khi polling tạm gián đoạn
    }
  }, [isAuthenticated, isOpen, isTabVisible, markAsReadIfNeeded, onUnreadCountChange]);

  useEffect(() => {
    if (isOpen && isAuthenticated) {
      initOrFetchConversation();
    }
  }, [isOpen, isAuthenticated, initOrFetchConversation]);

  // Chỉ chạy bộ hẹn giờ polling khi khung chat đang mở VÀ tab trình duyệt đang hiển thị
  useEffect(() => {
    if (!isOpen || !isAuthenticated || !isTabVisible) return;
    const timer = setInterval(() => {
      pollNewMessages();
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [isOpen, isAuthenticated, isTabVisible, pollIntervalMs, pollNewMessages]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleStartNewConversation = async () => {
    if (!isAuthenticated || isLoading) return;
    setIsLoading(true);
    setErrorBanner(null);
    setLimitReachedNotice(null);
    try {
      const createRes = await fetch('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const createBody = await createRes.json().catch(() => null);
      if (createRes.ok && createBody?.conversation) {
        setConversation(createBody.conversation);
        setMessages(Array.isArray(createBody.messages) ? createBody.messages : []);
        onUnreadCountChange?.(Number(createBody.conversation.unreadUser || 0));
      } else {
        setErrorBanner(createBody?.message || 'Không thể bắt đầu hội thoại mới lúc này.');
      }
    } catch {
      setErrorBanner('Mất kết nối mạng khi bắt đầu hội thoại mới. Vui lòng thử lại.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      onRequireLogin?.();
      return;
    }

    const trimmed = input.trim();
    if (!trimmed || isSending) return;

    if (trimmed.length > SELLER_CHAT_MESSAGE_MAX_LENGTH) {
      setErrorBanner(
        `Tin nhắn không được vượt quá ${SELLER_CHAT_MESSAGE_MAX_LENGTH} ký tự (hiện tại: ${trimmed.length}).`
      );
      return;
    }

    setIsSending(true);
    setErrorBanner(null);

    try {
      const res = await fetch('/api/chat/conversations/me/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ content: trimmed }),
      });

      const body = await res.json().catch(() => null);

      if (res.status === 401) {
        onRequireLogin?.();
        return;
      }

      if (res.status === 429) {
        setErrorBanner(
          body?.message ||
            'Bạn đang gửi tin nhắn quá nhanh (tối đa 20 tin / 10 phút). Vui lòng đợi ít phút rồi thử lại.'
        );
        return;
      }

      if (res.status === 400 && body?.code === 'CHAT_CONVERSATION_MESSAGE_LIMIT') {
        setLimitReachedNotice(
          body?.message ||
            `Hội thoại này đã đạt giới hạn tối đa ${SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION} tin nhắn và đã được đóng tự động. Nhấn "Bắt đầu hội thoại mới" hoặc gửi lại để tiếp tục trong hội thoại mới.`
        );
        setConversation((prev) => (prev ? { ...prev, status: 'closed' } : prev));
        return;
      }

      if (!res.ok || !body?.success) {
        setErrorBanner(body?.message || 'Không thể gửi tin nhắn lúc này. Vui lòng thử lại.');
        return;
      }

      setInput('');
      setLimitReachedNotice(null);
      if (body.conversation) {
        const isBrandNewConv = conversation && body.conversation.id !== conversation.id;
        setConversation(body.conversation);
        if (isBrandNewConv && body.message) {
          setMessages([body.message]);
          onUnreadCountChange?.(0);
          return;
        }
      }
      if (body.message) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === body.message.id)) return prev;
          return [...prev, body.message];
        });
      }
      onUnreadCountChange?.(0);
    } catch {
      setErrorBanner('Mất kết nối mạng khi gửi tin nhắn. Vui lòng kiểm tra kết nối và thử lại.');
    } finally {
      setIsSending(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div
        data-testid="seller-chat-unauthenticated"
        className="flex-1 p-5 flex flex-col items-center justify-center text-center space-y-3 bg-[#FAF8F5]"
      >
        <div className="w-11 h-11 rounded-full bg-[#2D4A3E]/10 text-[#2D4A3E] flex items-center justify-center">
          <Lock className="w-5 h-5" />
        </div>
        <h3 className="text-sm font-bold text-[#1A1C19]">
          Đăng nhập để chat trực tiếp với người bán
        </h3>
        <p className="text-xs text-[#5C5F58] leading-relaxed">
          Tính năng Hỏi đáp với cửa hàng dành riêng cho khách hàng đã đăng nhập để lưu lịch sử phản hồi và bảo mật thông tin tài khoản.
        </p>
        <button
          type="button"
          data-testid="seller-chat-login-btn"
          onClick={onRequireLogin}
          className="px-4 py-2 bg-[#2D4A3E] hover:bg-[#233B31] text-white text-xs font-semibold rounded-lg transition-colors"
        >
          Đăng nhập ngay
        </button>
      </div>
    );
  }

  const isWaitingForReply = Boolean(
    conversation && conversation.status === 'open' && conversation.unreadAdmin > 0
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#FAF8F5]" data-testid="seller-chat-panel">
      {/* Cảnh báo bảo mật thông tin nhạy cảm */}
      <div
        data-testid="seller-chat-security-warning"
        className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-900 flex items-start gap-2"
      >
        <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
        <span>{SELLER_CHAT_SENSITIVE_WARNING_TEXT}</span>
      </div>

      {/* Thanh trạng thái hội thoại */}
      <div className="px-3 py-1.5 bg-[#F2EFE9] border-b border-[#E5E0D5] flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5">
          {conversation?.status === 'closed' ? (
            <>
              <span className="w-2 h-2 rounded-full bg-stone-400" />
              <span className="font-medium text-[#5C5F58]" data-testid="seller-chat-status-text">
                {messages.length >= SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION || limitReachedNotice
                  ? `Đã đạt trần ${SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION} tin · Nhấn hoặc gửi tin để mở hội thoại mới`
                  : 'Hội thoại đã đóng · Gửi tin nhắn để tự động mở lại'}
              </span>
            </>
          ) : isWaitingForReply ? (
            <>
              <Clock className="w-3.5 h-3.5 text-amber-700" />
              <span className="font-medium text-amber-800" data-testid="seller-chat-status-text">
                Đang chờ cửa hàng phản hồi...
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-[#2D4A3E]" />
              <span className="font-medium text-[#2D4A3E]" data-testid="seller-chat-status-text">
                Hội thoại đang mở với nhân viên cửa hàng
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={pollNewMessages}
          title="Cập nhật tin nhắn mới"
          className="p-1 text-[#5C5F58] hover:text-[#1A1C19] rounded"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* Thông báo khi hội thoại đạt trần 500 tin nhắn */}
      {(limitReachedNotice || messages.length >= SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION) && (
        <div
          data-testid="seller-chat-limit-banner"
          className="mx-3 mt-2 px-3 py-2 bg-amber-50 border border-amber-300 rounded-lg text-[11px] text-amber-900 flex items-center justify-between gap-2"
        >
          <span>
            {limitReachedNotice ||
              `Hội thoại đã đạt giới hạn ${SELLER_CHAT_MAX_MESSAGES_PER_CONVERSATION} tin nhắn.`}
          </span>
          <button
            type="button"
            data-testid="seller-chat-start-new-btn"
            onClick={handleStartNewConversation}
            className="shrink-0 px-2.5 py-1 bg-[#2D4A3E] text-white font-semibold rounded hover:bg-[#233B31] transition-colors"
          >
            Bắt đầu hội thoại mới
          </button>
        </div>
      )}

      {/* Thông báo lỗi mạng / giới hạn tần suất */}
      {errorBanner && (
        <div
          data-testid="seller-chat-error-banner"
          className="mx-3 mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-800 flex items-start gap-2"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-red-700" />
          <span>{errorBanner}</span>
        </div>
      )}

      {/* Danh sách tin nhắn văn bản thuần */}
      <div className="flex-1 p-3.5 overflow-y-auto space-y-2.5">
        {isLoading && messages.length === 0 ? (
          <div className="text-center py-8 text-xs text-[#6B665C]">
            Đang tải lịch sử hội thoại...
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8 px-4 space-y-1">
            <p className="text-xs font-semibold text-[#1A1C19]">
              Bắt đầu trò chuyện trực tiếp với chủ cửa hàng Baity
            </p>
            <p className="text-[11px] text-[#6B665C]">
              Để lại câu hỏi về số đo sản phẩm, tình trạng đơn hàng hoặc hỗ trợ đổi trả. Nhân viên cửa hàng sẽ phản hồi sớm nhất.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.senderType === 'user';
            return (
              <div
                key={msg.id}
                data-testid={`seller-chat-msg-${msg.senderType}`}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-3.5 py-2 text-xs leading-relaxed ${
                    isUser
                      ? 'bg-[#2D4A3E] text-white'
                      : 'bg-white text-[#1A1C19] border border-[#E5E0D5]'
                  }`}
                >
                  {!isUser && (
                    <div className="text-[10px] font-bold text-[#2D4A3E] mb-0.5">
                      Cửa hàng Baity
                    </div>
                  )}
                  {/* Hiển thị văn bản thuần 100%, không phân tích HTML */}
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Ô nhập tin nhắn văn bản thuần (1..1000 ký tự, không đính kèm tệp) */}
      <form
        onSubmit={handleSendMessage}
        className="p-2.5 bg-white border-t border-[#E5E0D5] flex items-center gap-2"
      >
        <input
          type="text"
          data-testid="seller-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={SELLER_CHAT_MESSAGE_MAX_LENGTH}
          placeholder="Nhập tin nhắn cho người bán (tối đa 1000 ký tự)..."
          aria-label="Nhập tin nhắn cho người bán"
          className="flex-1 px-3 py-2 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E]"
        />
        <button
          type="submit"
          data-testid="seller-chat-send-btn"
          disabled={isSending || !input.trim()}
          aria-label="Gửi tin nhắn cho người bán"
          className="p-2 bg-[#2D4A3E] text-white rounded-lg hover:bg-[#233B31] disabled:opacity-40 transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
