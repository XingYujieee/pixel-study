// 按住才能做的事（像《渔力全开》里按住收线）：挖树、从留声机上取下唱片。
// 准星离开目标或松开按键就取消；进度给界面画圆环。
import { create } from "zustand";
import { useWorld } from "./worldStore";

interface HoldState {
  label: string | null;
  /** 0–1 */
  progress: number;
}

export const useHold = create<HoldState>(() => ({ label: null, progress: 0 }));

let raf = 0;
let unsub: (() => void) | null = null;
let onRelease: (() => void) | null = null;

const targetKey = () => JSON.stringify(useWorld.getState().target);

function stop() {
  cancelAnimationFrame(raf);
  unsub?.();
  unsub = null;
  onRelease = null;
  useHold.setState({ label: null, progress: 0 });
}

/**
 * 开始按住：ms 毫秒后执行 done。
 * released：没按满就松开时执行（比如短按 E 打开面板）。
 */
export function startHold(label: string, ms: number, done: () => void, released?: () => void) {
  stop();
  const key = targetKey();
  const t0 = performance.now();
  onRelease = released ?? null;
  useHold.setState({ label, progress: 0 });
  unsub = useWorld.subscribe((s, p) => {
    if (s.target !== p.target && targetKey() !== key) {
      onRelease = null;
      stop();
    }
  });
  const tick = (now: number) => {
    const p = Math.min(1, (now - t0) / ms);
    useHold.setState({ progress: p });
    if (p >= 1) {
      onRelease = null;
      stop();
      done();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

/** 切出窗口：按键松开的事件收不到，直接取消（不执行短按动作） */
export function cancelHold() {
  if (useHold.getState().label) stop();
}
window.addEventListener("blur", cancelHold);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) cancelHold();
});

/** 松开：没按满就取消（并执行短按动作） */
export function releaseHold() {
  if (!useHold.getState().label) return;
  const r = onRelease;
  stop();
  r?.();
}

export const holding = () => !!useHold.getState().label;
