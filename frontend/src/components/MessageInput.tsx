import { useState, useRef, useCallback } from "react";
import { useChatStore } from "../store/chat";

export function MessageInput() {
  const [input, setInput] = useState("");
  const isSending = useChatStore((s) => s.isSending);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending || !currentSessionId) return;

    setInput("");
    await sendMessage(trimmed);

    // Refocus the textarea after sending
    textareaRef.current?.focus();
  }, [input, isSending, currentSessionId, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      // Auto-resize textarea
      const textarea = e.target;
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
    },
    []
  );

  const canSend = input.trim().length > 0 && !isSending && currentSessionId;

  return (
    <div className="border-t border-gray-200 bg-white px-6 py-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-end gap-3 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all duration-150">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            rows={1}
            disabled={isSending}
            className="flex-1 resize-none bg-transparent outline-none text-sm text-gray-800 placeholder-gray-400 py-1.5 max-h-[200px]"
          />
          <button
            onClick={handleSubmit}
            disabled={!canSend}
            className={`p-2 rounded-xl transition-all duration-150 shrink-0 ${
              canSend
                ? "bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            {isSending ? (
              <svg
                className="w-4 h-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            ) : (
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                />
              </svg>
            )}
          </button>
        </div>
        <div className="mt-1.5 text-xs text-gray-400 text-center">
          Enter 发送 / Shift+Enter 换行
        </div>
      </div>
    </div>
  );
}
