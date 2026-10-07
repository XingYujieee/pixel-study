import { create } from "zustand";
import type { Draft, FileEntry, VaultEvent, VaultInfo } from "../ipc";

export type PreviewMode = "off" | "split";

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
}

interface AppStore {
  vault: VaultInfo | null;
  files: Map<string, FileEntry>;
  /** 每次文件列表变化 +1，供 useMemo 依赖 */
  filesVersion: number;
  scanning: boolean;
  scanned: number;
  /** 当前选中的路径（文本笔记或其他文件） */
  selected: string | null;
  recent: string[];
  drafts: Draft[];
  quickOpen: boolean;
  newNote: boolean;
  preview: PreviewMode;
  toasts: Toast[];
  /** 无法作为文本编辑的文件（非 UTF-8），以文件卡片显示 */
  unreadable: Set<string>;

  setVault(v: VaultInfo | null): void;
  beginScan(): void;
  addBatch(batch: FileEntry[]): void;
  endScan(): void;
  applyEvents(events: VaultEvent[]): void;
  select(path: string | null): void;
  setRecent(r: string[]): void;
  setDrafts(d: Draft[]): void;
  setQuickOpen(v: boolean): void;
  setNewNote(v: boolean): void;
  togglePreview(): void;
  toast(text: string, tone?: Toast["tone"]): void;
  dismiss(id: number): void;
  markUnreadable(path: string): void;
}

let toastId = 0;

export const useApp = create<AppStore>((set, get) => ({
  vault: null,
  files: new Map(),
  filesVersion: 0,
  scanning: false,
  scanned: 0,
  selected: null,
  recent: [],
  drafts: [],
  quickOpen: false,
  newNote: false,
  preview: "off",
  toasts: [],
  unreadable: new Set(),

  setVault: (vault) => set({ vault, files: new Map(), filesVersion: get().filesVersion + 1, selected: null, recent: [], drafts: [] }),
  beginScan: () => set({ scanning: true, scanned: 0, files: new Map(), filesVersion: get().filesVersion + 1 }),
  addBatch: (batch) => {
    const files = get().files;
    for (const e of batch) files.set(e.path, e);
    set({ scanned: files.size, filesVersion: get().filesVersion + 1 });
  },
  endScan: () => set({ scanning: false }),
  applyEvents: (events) => {
    const { files, selected, recent } = get();
    let sel = selected;
    let rec = recent;
    for (const ev of events) {
      if (ev.kind === "created" || ev.kind === "modified") files.set(ev.entry.path, ev.entry);
      else if (ev.kind === "removed") {
        files.delete(ev.path);
        rec = rec.filter((p) => p !== ev.path);
      } else {
        files.delete(ev.from);
        files.set(ev.entry.path, ev.entry);
        if (sel === ev.from) sel = ev.entry.path;
        rec = rec.map((p) => (p === ev.from ? ev.entry.path : p));
      }
    }
    set({ filesVersion: get().filesVersion + 1, selected: sel, recent: rec });
  },
  select: (selected) => set({ selected }),
  setRecent: (recent) => set({ recent }),
  setDrafts: (drafts) => set({ drafts }),
  setQuickOpen: (quickOpen) => set({ quickOpen }),
  setNewNote: (newNote) => set({ newNote }),
  togglePreview: () => set({ preview: get().preview === "off" ? "split" : "off" }),
  toast: (text, tone = "info") => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    setTimeout(() => get().dismiss(id), tone === "error" ? 6000 : 3000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  markUnreadable: (path) => set({ unreadable: new Set(get().unreadable).add(path) }),
}));
