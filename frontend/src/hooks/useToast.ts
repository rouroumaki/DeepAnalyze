// =============================================================================
// DeepAnalyze - Toast Notification Hook
// =============================================================================

import { useCallback } from "react";

type ToastType = "success" | "error" | "warning" | "info";

interface ToastOptions {
  duration?: number;
}

function showToast(
  message: string,
  type: ToastType = "info",
  options: ToastOptions = {},
) {
  const duration = options.duration ?? 3000;
  const container = document.getElementById("toast-container") || (() => {
    const el = document.createElement("div");
    el.id = "toast-container";
    el.style.cssText = "position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;";
    document.body.appendChild(el);
    return el;
  })();

  const toast = document.createElement("div");
  toast.className = `da-toast da-toast-${type}`;
  toast.textContent = message;
  toast.style.pointerEvents = "auto";
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(20px)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

export function useToast() {
  const success = useCallback((msg: string) => showToast(msg, "success"), []);
  const error = useCallback((msg: string) => showToast(msg, "error"), []);
  const warning = useCallback((msg: string) => showToast(msg, "warning"), []);
  const info = useCallback((msg: string) => showToast(msg, "info"), []);

  return { success, error, warning, info };
}
