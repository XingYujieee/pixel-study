import { useRef } from "react";

/**
 * 输入框按键处理：输入法选字期间的 Enter / Esc 全部交给输入法。
 * Safari / WKWebView 中确认选字的 Enter 可能在 compositionend 之后才到达，所以延迟一拍清除标记。
 */
export function useImeSafeKeys(h: { onEnter?: (e: React.KeyboardEvent) => void; onEscape?: (e: React.KeyboardEvent) => void }) {
  const composing = useRef(false);
  return {
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: () => {
      setTimeout(() => (composing.current = false), 0);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) {
        e.stopPropagation();
        return;
      }
      if (e.key === "Enter" && h.onEnter) {
        e.preventDefault();
        h.onEnter(e);
      } else if (e.key === "Escape" && h.onEscape) {
        e.preventDefault();
        e.stopPropagation();
        h.onEscape(e);
      }
    },
  };
}
