import { useEffect, useCallback } from "react";

type KeyCombo = {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
};

type KeyHandler = (e: KeyboardEvent) => void;

/**
 * Register a global keyboard shortcut.
 * Automatically cleans up on unmount.
 *
 * Usage:
 *   useKeyboard({ key: "n", ctrl: true }, () => createSession());
 *   useKeyboard({ key: "Escape" }, () => closePanel());
 */
export function useKeyboard(combo: KeyCombo, handler: KeyHandler) {
  const memoHandler = useCallback(
    (e: KeyboardEvent) => {
      const ctrlRequired = combo.ctrl ?? false;
      const shiftRequired = combo.shift ?? false;
      const altRequired = combo.alt ?? false;

      const ctrlMatch = ctrlRequired
        ? e.ctrlKey || e.metaKey
        : !e.ctrlKey && !e.metaKey;
      const shiftMatch = shiftRequired ? e.shiftKey : !e.shiftKey;
      const altMatch = altRequired ? e.altKey : !e.altKey;

      if (
        e.key.toLowerCase() === combo.key.toLowerCase() &&
        ctrlMatch &&
        shiftMatch &&
        altMatch
      ) {
        e.preventDefault();
        handler(e);
      }
    },
    [combo.key, combo.ctrl, combo.shift, combo.alt, handler],
  );

  useEffect(() => {
    window.addEventListener("keydown", memoHandler);
    return () => window.removeEventListener("keydown", memoHandler);
  }, [memoHandler]);
}
