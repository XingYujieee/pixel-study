import { create } from "zustand";
import type { Target } from "../world/engine";
import type { Layout } from "../world/layout";

/**
 * 书房模式：
 * - idle：显示"点击进入书房"，鼠标未锁定
 * - explore：第一人称行走
 * - paused：暂停菜单（Esc）
 * - gui：书架 / 工作台 / 资料箱等界面
 * - writing：坐在书桌前写作
 * - focus：全屏专注写作（原平面界面）
 */
export type WorldMode = "idle" | "explore" | "paused" | "gui" | "writing" | "focus";

export type Gui =
  | { kind: "shelf"; fid: string }
  | { kind: "workbench"; shelfId?: string }
  | { kind: "chest" }
  | { kind: "remove"; fid: string }
  | { kind: "help" }
  | { kind: "window" }
  | { kind: "ai" }
  | { kind: "pond" }
  | { kind: "carpet"; fid: string }
  | { kind: "presets" }
  | { kind: "theme" }
  | { kind: "wall"; id: string }
  | { kind: "wallpick" }
  | { kind: "pets"; id?: string }
  | { kind: "sound" }
  | { kind: "jukebox" }
  | { kind: "records" }
  | { kind: "floors" }
  | { kind: "butler"; settings?: boolean }
  | null;

interface WorldStore {
  mode: WorldMode;
  gui: Gui;
  layout: Layout | null;
  /** 每次布局变化 +1 */
  layoutVersion: number;
  slot: number;
  target: Target;
  /** 正在使用的书桌 */
  deskId: string | null;
  lookFallback: boolean;
  /** 在院子里（物品栏换成园艺工具） */
  outside: boolean;
  /** 院子里物品栏选中的格子 */
  gslot: number;
  /** 手上拿着的东西（唱片） */
  carry: { kind: "record"; id: string } | null;
  /** F 细看手上的东西 */
  inspect: boolean;
  /** 留声机上的唱片（与 layout.deck 同步，界面订阅这个） */
  deck: string | null;
  setDeck(id: string | null): void;
  setOutside(v: boolean): void;
  setGslot(i: number): void;
  setCarry(c: WorldStore["carry"]): void;
  setInspect(v: boolean): void;
  setMode(m: WorldMode): void;
  openGui(g: Exclude<Gui, null>): void;
  closeGui(): void;
  setLayout(l: Layout | null): void;
  touchLayout(): void;
  setSlot(i: number): void;
  setTarget(t: Target): void;
  setDesk(id: string | null): void;
  setLookFallback(v: boolean): void;
}

export const useWorld = create<WorldStore>((set, get) => ({
  mode: "idle",
  gui: null,
  layout: null,
  layoutVersion: 0,
  slot: 0,
  target: null,
  deskId: null,
  lookFallback: false,
  outside: false,
  gslot: 0,
  carry: null,
  inspect: false,
  deck: null,
  setDeck: (deck) => {
    const l = get().layout;
    if (l) {
      if (deck) l.deck = deck;
      else delete l.deck;
    }
    set({ deck });
  },
  setOutside: (outside) => set({ outside }),
  setGslot: (gslot) => set({ gslot }),
  setCarry: (carry) => set({ carry, inspect: false }),
  setInspect: (inspect) => set({ inspect }),
  setMode: (mode) => set({ mode, gui: mode === "gui" ? get().gui : null }),
  openGui: (gui) => set({ gui, mode: "gui" }),
  closeGui: () => set({ gui: null, mode: "idle" }),
  setLayout: (layout) => set({ layout, layoutVersion: get().layoutVersion + 1 }),
  touchLayout: () => set({ layoutVersion: get().layoutVersion + 1 }),
  setSlot: (slot) => set({ slot }),
  setTarget: (target) => set({ target }),
  setDesk: (deskId) => set({ deskId }),
  setLookFallback: (lookFallback) => set({ lookFallback }),
}));
