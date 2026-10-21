'use client';

import { useEffect, useRef, useState } from 'react';

const createMessageId = () => globalThis.crypto?.randomUUID?.()
  || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CHAT_IDLE_TIMEOUT_MS = 60000;
const MAX_PAGE_CONTEXT_LENGTH = 12000;

function getCurrentPageContext() {
  const mainContent = document.querySelector('main, [role="main"]');
  const visibleTables = [...document.querySelectorAll('table')]
    .filter((table) => table.getClientRects().length > 0)
    .map((table) => table.innerText.trim())
    .filter(Boolean);
  const visibleSummaries = [...document.querySelectorAll('h1, h2, h3, p, [role="row"]')]
    .filter((element) => element.getClientRects().length > 0)
    .map((element) => element.innerText.trim())
    .filter(Boolean);
  const visibleText = (
    mainContent?.innerText?.trim()
    || visibleTables.join('\n\n')
    || visibleSummaries.join('\n\n')
  ).slice(0, MAX_PAGE_CONTEXT_LENGTH);

  return {
    title: document.title.slice(0, 200),
    path: window.location.pathname.slice(0, 300),
    visibleText,
  };
}

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isLoading]);

  async function sendMessage(event) {
    event.preventDefault();
    const message = input.trim();
    if (!message || isLoading) return;

    const assistantMessageId = createMessageId();
    setError('');
    setInput('');
    setIsLoading(true);
    setMessages((current) => [
      ...current,
      { id: createMessageId(), role: 'user', text: message },
      { id: assistantMessageId, role: 'assistant', text: '' },
    ]);

    const controller = new AbortController();
    let timeoutId;
    const resetIdleTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort(), CHAT_IDLE_TIMEOUT_MS);
    };
    const appendAssistantText = (text) => {
      setMessages((current) => current.map((item) => (
        item.id === assistantMessageId ? { ...item, text: item.text + text } : item
      )));
    };

    try {
      resetIdleTimeout();
      const page = getCurrentPageContext();
      const response = await fetch('/api/chat', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          pageContext: page.visibleText,
          pageTitle: page.title,
          pagePath: page.path,
          history: messages.slice(-5).map(({ role, text }) => ({
            role,
            text: text.slice(-500),
          })),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'تعذر الحصول على رد من المساعد.');
      }
      if (!response.body) {
        throw new Error('المتصفح لا يدعم استقبال الرد المباشر.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamCompleted = false;

      const handleFrame = (frame) => {
        const lines = frame.split(/\r?\n/);
        const eventName = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
        const dataLine = lines.find((line) => line.startsWith('data:'))?.slice(5).trim();
        if (!dataLine) return;

        const payload = JSON.parse(dataLine);
        if (eventName === 'text' && typeof payload.text === 'string') {
          appendAssistantText(payload.text);
        } else if (eventName === 'warning' && payload.message) {
          appendAssistantText(`\n\nتنبيه: ${payload.message}`);
        } else if (eventName === 'error') {
          throw new Error(payload.message || 'حدث خطأ أثناء إنشاء الرد.');
        } else if (eventName === 'done') {
          streamCompleted = true;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        resetIdleTimeout();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || '';
        frames.filter((frame) => frame.trim()).forEach(handleFrame);
        if (done) break;
      }

      if (buffer.trim()) handleFrame(buffer);
      if (!streamCompleted) throw new Error('انقطع البث قبل اكتمال رد المساعد.');
    } catch (requestError) {
      setError(controller.signal.aborted
        ? 'انقطع تدفق الرد بعد دقيقة من دون بيانات جديدة. تحقق من الاتصال قبل إعادة أي طلب مالي.'
        : requestError.message || 'تعذر الاتصال بالمساعد. حاول مرة أخرى.');
      inputRef.current?.focus();
    } finally {
      clearTimeout(timeoutId);
      setIsLoading(false);
    }
  }

  function handleInputKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <section
      aria-label="محادثة مساعد المصنع"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl"
      dir="rtl"
    >
      <header className="flex items-center gap-3 border-b border-slate-100 bg-white px-5 py-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-6 w-6">
            <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.64 5.64l1.42 1.42m9.88 9.88 1.42 1.42m0-12.72-1.42 1.42m-9.88 9.88-1.42 1.42" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M15.5 8.5c-.8-.8-1.9-1.2-3.5-1.2-2.4 0-4 1.1-4 2.8 0 3.8 8 1 8 4.8 0 1.7-1.6 2.8-4 2.8-1.6 0-2.8-.4-3.7-1.3M12 6v1.3m0 11.4V20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-black text-slate-900">مساعد المصنع</h2>
          <p className="mt-0.5 text-xs text-slate-500">اسأل عن بيانات المصنع أو اطلب إجراءً</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          جاهز
        </span>
      </header>

      <div
        aria-live="polite"
        aria-relevant="additions text"
        className="flex-1 space-y-5 overflow-y-auto bg-slate-50/70 px-4 py-5"
      >
        {messages.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-teal-700 shadow-sm ring-1 ring-slate-200">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-7 w-7">
                <path d="M7 10h10M7 14h6m-1 7-4-4H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5l-4 4Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3 className="font-bold text-slate-800">أهلاً بك في مساعد المصنع</h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
              اكتب سؤالك بطريقتك، وسأساعدك في الوصول إلى بيانات النظام.
            </p>
          </div>
        ) : (
          messages.map((item) => {
            const isUser = item.role === 'user';
            return (
              <div
                key={item.id}
                className={`flex items-end gap-2.5 ${isUser ? 'justify-start' : 'justify-end'}`}
              >
                {!isUser && (
                  <div className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-xs font-black text-teal-800">
                    م
                  </div>
                )}
                <div
                  className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
                    isUser
                      ? 'rounded-br-md bg-teal-700 text-white'
                      : 'rounded-bl-md border border-slate-200 bg-white text-slate-800'
                  }`}
                >
                  {item.text || (isLoading && !isUser ? (
                    <span className="flex items-center gap-1.5 py-1" aria-label="المساعد يكتب">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-teal-600 [animation-delay:-0.2s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-teal-600 [animation-delay:-0.1s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-teal-600" />
                    </span>
                  ) : null)}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={sendMessage} className="border-t border-slate-100 bg-white p-4">
        {error && (
          <p role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 transition focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-100">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="اكتب رسالتك هنا..."
            aria-label="رسالتك إلى مساعد المصنع"
            rows={1}
            maxLength={4000}
            disabled={isLoading}
            className="max-h-32 min-h-11 flex-1 resize-y bg-transparent px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            aria-label="إرسال الرسالة"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isLoading ? (
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5 animate-spin">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : (
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                <path d="m5 12 14-7-4 14-3-6-7-1Zm7 1 7-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-slate-400">
          Enter للإرسال · Shift + Enter لسطر جديد
        </p>
      </form>
    </section>
  );
}
