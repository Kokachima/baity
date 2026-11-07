import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Sparkles, ShoppingBag, AlertCircle, Store } from 'lucide-react';
import { SafeMarkdown } from '../common/SafeMarkdown.tsx';
import { ImageWithFallback } from '../common/ImageWithFallback.tsx';
import { SellerChatPanel } from './SellerChatPanel.tsx';

interface GroundedProductItem {
  id: string;
  name: string;
  slug: string;
  targetGender: string;
  basePrice: number;
  salePrice: number | null;
  effectivePrice: number;
  primaryImage: string | null;
  totalStock: number;
}

interface ChatMessageEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  groundedProducts?: GroundedProductItem[];
  isError?: boolean;
}

export interface ChatbotWidgetProps {
  onSelectProductSlug: (slug: string) => void;
  onNavigateInternal?: (href: string) => void;
  isAuthenticated?: boolean;
  onRequireLogin?: () => void;
  initialMode?: 'assistant' | 'seller';
  initialOpen?: boolean;
}

export const ChatbotWidget: React.FC<ChatbotWidgetProps> = ({
  onSelectProductSlug,
  onNavigateInternal,
  isAuthenticated = false,
  onRequireLogin,
  initialMode = 'assistant',
  initialOpen = false,
}) => {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [activeMode, setActiveMode] = useState<'assistant' | 'seller'>(initialMode);
  const [unreadSellerCount, setUnreadSellerCount] = useState<number>(0);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessageEntry[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Xin chào! Mình là trợ lý tư vấn trang phục **BAITY**. Bạn cần gợi ý phối đồ, chọn kích cỡ, hỏi chính sách đổi trả hay kiểm tra trạng thái đơn hàng `BAITY-xxxxx`?',
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && activeMode === 'assistant') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, activeMode]);

  const handleClickSellerChatTab = () => {
    if (!isAuthenticated) {
      onRequireLogin?.();
      setActiveMode('seller');
      return;
    }
    setActiveMode('seller');
  };

  const handleSend = async (e?: React.FormEvent, presetText?: string) => {
    if (e) e.preventDefault();
    const text = (presetText ?? input).trim();
    if (!text || isSending) return;

    if (text.length > 500) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: 'Tin nhắn vượt quá 500 ký tự. Vui lòng rút gọn câu hỏi của bạn.',
          isError: true,
        },
      ]);
      return;
    }

    const userMsg: ChatMessageEntry = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    };

    const historyForRequest = messages
      .filter((m) => m.id !== 'welcome' && !m.isError)
      .slice(-10)
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    setMessages((prev) => [...prev, userMsg]);
    if (!presetText) setInput('');
    setIsSending(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message: text,
          history: historyForRequest,
        }),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok || !body?.success) {
        const errMessage =
          body?.message ||
          'Trợ lý tư vấn trực tuyến hiện đang tạm bận. Vui lòng thử lại sau ít phút hoặc tham khảo mục Chính sách & Câu hỏi thường gặp (FAQ).';
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'assistant',
            content: errMessage,
            isError: true,
          },
        ]);
        return;
      }

      const replyData = body.data || body;
      const productsList = Array.isArray(replyData.recommendedProducts)
        ? replyData.recommendedProducts
        : Array.isArray(replyData.groundedProducts)
        ? replyData.groundedProducts
        : [];
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          role: 'assistant',
          content: replyData.reply || 'Cảm ơn bạn đã liên hệ BAITY.',
          groundedProducts: productsList,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content:
            'Không thể kết nối đến trợ lý tư vấn. Vui lòng kiểm tra mạng, thử lại sau hoặc tham khảo mục Chính sách & Câu hỏi thường gặp (FAQ).',
          isError: true,
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-40">
      {isOpen ? (
        <div
          data-testid="chatbot-panel"
          className="w-[340px] sm:w-[390px] h-[540px] bg-[#FAF8F5] rounded-2xl shadow-2xl border border-[#D5D0C5] flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="px-4 py-3 bg-[#2D4A3E] text-white flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center">
                {activeMode === 'seller' ? (
                  <Store className="w-4 h-4 text-[#E6B89C]" />
                ) : (
                  <Sparkles className="w-4 h-4 text-[#E6B89C]" />
                )}
              </div>
              <div>
                <div className="text-xs font-bold tracking-wide">
                  {activeMode === 'seller' ? 'Chat với Người bán BAITY' : 'Trợ lý Tư vấn BAITY'}
                </div>
                <div className="text-[10px] text-white/80">
                  {activeMode === 'seller'
                    ? 'Hỏi đáp trực tiếp với nhân viên cửa hàng'
                    : 'Tư vấn sản phẩm thật · Chính sách · Đơn hàng'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1.5 text-white/80 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
              aria-label="Đóng khung chat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Thanh chuyển chế độ: Trợ lý tư vấn AI | Chat với người bán */}
          <div className="px-2.5 py-1.5 bg-[#EAE5DC] border-b border-[#D5D0C5] grid grid-cols-2 gap-1.5">
            <button
              type="button"
              data-testid="ai-assistant-tab-btn"
              onClick={() => setActiveMode('assistant')}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                activeMode === 'assistant'
                  ? 'bg-[#2D4A3E] text-white shadow-2xs'
                  : 'bg-white/70 text-[#2D4A3E] hover:bg-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Trợ lý tư vấn</span>
            </button>
            <button
              type="button"
              data-testid="seller-chat-tab-btn"
              onClick={handleClickSellerChatTab}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                activeMode === 'seller'
                  ? 'bg-[#2D4A3E] text-white shadow-2xs'
                  : 'bg-white/70 text-[#2D4A3E] hover:bg-white'
              }`}
            >
              <Store className="w-3.5 h-3.5" />
              <span>Chat với người bán</span>
              {unreadSellerCount > 0 && (
                <span
                  data-testid="seller-chat-unread-badge"
                  className="px-1.5 py-0.2 rounded bg-[#C27D56] text-white text-[10px] font-bold"
                >
                  {unreadSellerCount}
                </span>
              )}
            </button>
          </div>

          {activeMode === 'seller' ? (
            <SellerChatPanel
              isOpen={isOpen && activeMode === 'seller'}
              isAuthenticated={isAuthenticated}
              onRequireLogin={onRequireLogin}
              onUnreadCountChange={setUnreadSellerCount}
            />
          ) : (
            <>
              {/* Gợi ý nhanh */}
              <div className="px-3 py-2 bg-[#F2EFE9] border-b border-[#E5E0D5] flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                {[
                  'Gợi ý áo sơ mi nam công sở',
                  'Chính sách đổi trả 7 ngày',
                  'Phí vận chuyển & Freeship',
                ].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    disabled={isSending}
                    onClick={() => handleSend(undefined, chip)}
                    className="px-2.5 py-1 bg-white hover:bg-[#EAE5DC] text-[#2D4A3E] border border-[#D5D0C5] rounded-md text-[11px] font-medium whitespace-nowrap transition-colors disabled:opacity-50"
                  >
                    {chip}
                  </button>
                ))}
              </div>

              {/* Danh sách tin nhắn */}
              <div className="flex-1 p-3.5 overflow-y-auto space-y-3">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-[#2D4A3E] text-white'
                          : msg.isError
                          ? 'bg-[#FDF3F2] text-[#9E2A2B] border border-[#F5C6C6]'
                          : 'bg-white text-[#1A1C19] border border-[#E5E0D5] shadow-2xs'
                      }`}
                    >
                      {msg.role === 'user' ? (
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      ) : msg.isError ? (
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#9E2A2B]" />
                          <span>{msg.content}</span>
                        </div>
                      ) : (
                        <SafeMarkdown
                          content={msg.content}
                          onInternalLinkClick={(href: string) => {
                            if (href.startsWith('/products/')) {
                              const slug = href.replace('/products/', '').split('?')[0];
                              if (slug) onSelectProductSlug(slug);
                            } else {
                              onNavigateInternal?.(href);
                            }
                          }}
                        />
                      )}
                    </div>

                    {/* Danh sách thẻ sản phẩm đã đối chiếu trong DB */}
                    {msg.groundedProducts && msg.groundedProducts.length > 0 && (
                      <div className="mt-2 w-full max-w-[90%] space-y-1.5">
                        {msg.groundedProducts.map((prod) => (
                          <button
                            key={prod.id}
                            type="button"
                            onClick={() => onSelectProductSlug(prod.slug)}
                            className="w-full p-2 bg-white hover:bg-[#F5F2EB] border border-[#E0DCD3] rounded-lg flex items-center gap-2.5 text-left transition-colors shadow-2xs"
                          >
                            <div className="w-10 h-12 rounded bg-[#F2EFE9] overflow-hidden shrink-0">
                              <ImageWithFallback
                                src={prod.primaryImage || ''}
                                alt={prod.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold text-[#1A1C19] truncate">
                                {prod.name}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 text-[11px]">
                                <span className="font-bold text-[#2D4A3E] tabular-nums">
                                  {prod.effectivePrice.toLocaleString('vi-VN')}₫
                                </span>
                                <span className="text-[#6B665C]">
                                  · Còn {prod.totalStock} sp
                                </span>
                              </div>
                            </div>
                            <ShoppingBag className="w-4 h-4 text-[#2D4A3E] shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {isSending && (
                  <div className="flex items-start">
                    <div className="bg-white border border-[#E5E0D5] rounded-xl px-3.5 py-2 text-xs text-[#6B665C] animate-pulse">
                      Đang tra cứu kho hàng & chính sách...
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Ô nhập tin nhắn (giới hạn 500 ký tự) */}
              <form
                onSubmit={(e) => handleSend(e)}
                className="p-2.5 bg-white border-t border-[#E5E0D5] flex items-center gap-2"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  maxLength={500}
                  placeholder="Hỏi về sản phẩm, chính sách, mã đơn..."
                  aria-label="Nhập câu hỏi tư vấn"
                  className="flex-1 px-3 py-2 text-xs bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg text-[#1A1C19] focus:outline-none focus:border-[#2D4A3E]"
                />
                <button
                  type="submit"
                  disabled={isSending || !input.trim()}
                  aria-label="Gửi tin nhắn"
                  className="p-2 bg-[#2D4A3E] text-white rounded-lg hover:bg-[#233B31] disabled:opacity-40 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </>
          )}
        </div>
      ) : (
        <button
          type="button"
          data-testid="chatbot-trigger"
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-4 py-3 bg-[#2D4A3E] hover:bg-[#233B31] text-white text-xs font-semibold rounded-xl shadow-xl border border-white/15 transition-all"
          aria-label="Mở trợ lý tư vấn trực tuyến"
        >
          <MessageCircle className="w-4 h-4 text-[#E6B89C]" />
          <span>Trợ lý tư vấn</span>
          {unreadSellerCount > 0 && (
            <span
              data-testid="chatbot-trigger-unread-badge"
              className="px-1.5 py-0.5 rounded bg-[#C27D56] text-white text-[10px] font-bold"
            >
              {unreadSellerCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
};

