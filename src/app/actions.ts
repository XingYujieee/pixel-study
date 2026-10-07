import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, errorKind, errorMessage, onVaultChanged, type VaultEvent, type VaultInfo } from "../ipc";
import { isTextPath, isWordPath } from "../lib/paths";
import { applyFileEvents, defaultLayout, parseLayout, type Layout } from "../world/layout";
import { floorsOf } from "../world/floors";
import { controller, saveEverything, word } from "./editor";
import { useApp } from "./store";
import { useWorld } from "./worldStore";

let unlisten: (() => void) | null = null;

/** 文件变化（监听器报告的，或自己移动 / 新建后本地补发的）同步到各处 */
export function handleVaultEvents(events: VaultEvent[]) {
  useApp.getState().applyEvents(events);
  void controller.handleEvents(events);
  void word.handleEvents(events);
  const layout = useWorld.getState().layout;
  if (layout && applyFileEvents(layout, events)) saveLayoutSoon();
  if (layout) useWorld.getState().touchLayout();
  for (const fn of eventListeners) fn(events);
}

const eventListeners = new Set<(events: VaultEvent[]) => void>();

/** 订阅文件变化（灵感池、书脊状态用） */
export function onFileEvents(fn: (events: VaultEvent[]) => void): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

const vaultLoadedListeners = new Set<() => void>();

/** 库加载完成（布局已就绪）后调用 */
export function onVaultLoaded(fn: () => void): () => void {
  vaultLoadedListeners.add(fn);
  return () => vaultLoadedListeners.delete(fn);
}

/** 打开库：开始监听事件、扫描、读取最近、草稿与书房布局。 */
export async function loadVault(info: VaultInfo) {
  const s = useApp.getState();
  await saveEverything();
  s.setVault(info);
  useWorld.getState().setLayout(null);
  useWorld.getState().setMode("idle");
  unlisten?.();
  unlisten = await onVaultChanged(handleVaultEvents);
  s.beginScan();
  try {
    const total = await api.vaultScan((batch) => useApp.getState().addBatch(batch));
    // Channel 的批次可能在命令返回后才到达：等全部到齐（最多 5 秒）
    const t0 = Date.now();
    while (useApp.getState().files.size < total && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 30));
  } catch (e) {
    s.toast(`扫描失败：${errorMessage(e)}`, "error");
  } finally {
    useApp.getState().endScan();
  }
  const [recent, drafts, rawLayout] = await Promise.all([api.recentList(), api.draftList(), api.layoutLoad().catch(() => null)]);
  useApp.getState().setRecent(recent);
  useApp.getState().setDrafts(drafts);
  let layout = parseLayout(rawLayout);
  if (!layout) {
    layout = defaultLayout(useApp.getState().files.values());
    await api.layoutSave(layout).catch(() => {});
  }
  useWorld.getState().setLayout(layout);
  for (const fn of vaultLoadedListeners) fn();
}

let started = false;

export async function startup() {
  // React 开发模式下 effect 会执行两次
  if (started) return;
  started = true;
  try {
    const info = await api.vaultCurrent();
    if (info) await loadVault(info);
  } catch (e) {
    useApp.getState().toast(errorMessage(e), "error");
  }
}

export async function chooseVault() {
  const picked = await openDialog({ directory: true, multiple: false, title: "选择笔记库文件夹（可以是现有的 Obsidian 库或文稿里的文件夹）" });
  if (typeof picked !== "string") return;
  try {
    await loadVault(await api.vaultOpen(picked));
  } catch (e) {
    useApp.getState().toast(errorMessage(e), "error");
  }
}

let layoutTimer: ReturnType<typeof setTimeout> | undefined;
let playerSource: (() => { x: number; z: number; yaw: number; pitch: number }) | null = null;

export function setPlayerSource(fn: typeof playerSource) {
  playerSource = fn;
}

/** 布局变化后稍后保存（家具、书架、玩家位置） */
export function saveLayoutSoon(delay = 800) {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(saveLayoutNow, delay);
}

let saveHook: ((layout: Layout) => void) | null = null;

/** 保存布局前调用（宠物位置等运行时状态写回布局） */
export function setLayoutSaveHook(fn: (layout: Layout) => void) {
  saveHook = fn;
}

export async function saveLayoutNow() {
  clearTimeout(layoutTimer);
  const layout = useWorld.getState().layout;
  if (!layout || !useApp.getState().vault) return;
  if (playerSource) layout.player = playerSource();
  saveHook?.(layout);
  // 多层时把当前这层存回楼层列表
  if (layout.floors?.length) layout.floors = floorsOf(layout);
  await api.layoutSave(layout).catch((e) => useApp.getState().toast(`书房布局保存失败：${errorMessage(e)}`, "error"));
}

/**
 * 打开文件到编辑器（不改变界面模式）。返回是否成功进入编辑。
 * Markdown / TXT / Word 可编辑；其他文件只选中（显示文件卡片或用系统应用打开）。
 */
export async function openPath(path: string, opts: { remember?: boolean; line?: number; focus?: boolean } = {}): Promise<boolean> {
  const s = useApp.getState();
  let editable = false;
  if (isTextPath(path) && !s.unreadable.has(path)) {
    try {
      await controller.open(path);
      s.select(path);
      editable = true;
      if (opts.line) controller.revealLine(opts.line);
      else if (opts.focus !== false) controller.focus();
    } catch (e) {
      if (errorKind(e) === "not_utf8") {
        s.markUnreadable(path);
        s.select(path);
        s.toast("这个文件不是 UTF-8 编码，暂时无法编辑，可以用系统应用打开。", "error");
      } else {
        s.toast(errorMessage(e), "error");
        return false;
      }
    }
  } else if (isWordPath(path)) {
    try {
      await word.open(path);
      s.select(path);
      editable = true;
      if (opts.focus !== false) word.focus();
    } catch (e) {
      s.toast(`无法打开 Word 文档：${errorMessage(e)}`, "error");
      s.markUnreadable(path);
      s.select(path);
    }
  } else {
    s.select(path);
  }
  if (opts.remember !== false) {
    api.recentPush(path).then(useApp.getState().setRecent).catch(() => {});
  }
  for (const fn of openedListeners) fn(path);
  return editable;
}

const openedListeners = new Set<(path: string) => void>();

/** 每次在书房里打开文件时调用（书脊蒙灰用） */
export function onPathOpened(fn: (path: string) => void): () => void {
  openedListeners.add(fn);
  return () => openedListeners.delete(fn);
}

export async function openExternal(path: string) {
  try {
    await api.openExternal(path);
  } catch (e) {
    useApp.getState().toast(errorMessage(e), "error");
  }
}

export async function revealInFinder(path: string) {
  try {
    await api.revealInFinder(path);
  } catch (e) {
    useApp.getState().toast(errorMessage(e), "error");
  }
}

export async function refreshDrafts() {
  useApp.getState().setDrafts(await api.draftList().catch(() => []));
}
