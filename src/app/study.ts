// 书房里的"渔力"玩法：灵感池（鱼塘）、冒泡、模板、书脊状态、布局预设、地毯氛围。
// 原则：好玩的效果只改变画面；会动到文件的操作都由用户明确触发，并且能撤销（放生 = 移到 .trash/）。
import DOMPurify from "dompurify";
import { marked } from "marked";
import { create } from "zustand";
import { api, errorMessage, type FileEntry, type VaultEvent } from "../ipc";
import { basename } from "../lib/paths";
import { parseOpened, recordOpened, renameOpened, type OpenedMap } from "../study/bookState";
import { BUBBLE_MS, nextBubbleDelay, pickSurfacing, type Surfacing } from "../study/bubble";
import { ideaContent, ideaFileName, inboxItems, INBOX_DIR, stripFrontmatter, TRASH_DIR } from "../study/inbox";
import { applyTemplate, BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_DIR, type Template } from "../study/templates";
import { DEFAULT_VOLUMES, type Volumes } from "../world/audio";
import { ALL_STYLES, type BgmFrequency, type Style } from "../world/compose";
import { applyPreset, makePreset, parsePresets, type Ambience, type LayoutPreset } from "../world/layout";
import { emptyDocx, writeDocx } from "../word/docx";
import { handleVaultEvents, onFileEvents, onPathOpened, onVaultLoaded, saveLayoutNow } from "./actions";
import { useApp } from "./store";
import { furniture, getEngine } from "./worldActions";
import { useWorld } from "./worldStore";

interface StudyStore {
  /** 在书房里打开过的时间 */
  opened: OpenedMap;
  /** 每个文件被多少篇笔记引用 */
  backlinks: Record<string, number>;
  /** 显示书脊蒙灰 / 发亮 */
  bookStatus: boolean;
  /** 各轨音量 */
  volumes: Volumes;
  /** 环境声跟随屋子、天气与时间（下雨听到雨声、木屋壁炉、灯塔海浪……） */
  envAmbience: boolean;
  /** 背景音乐（程序生成的钢琴小曲）多久响一次 */
  bgm: BgmFrequency;
  /** 背景音乐的风格（可多选） */
  bgmStyles: Style[];
  /** 正在冒泡的那一条 */
  bubble: (Surfacing & { until: number }) | null;
  /** 随手记对话框 */
  capture: boolean;
  templateDir: string;
  presets: LayoutPreset[];
  /** 玩家正站着的地毯 */
  carpetId: string | null;
  /** 每次需要刷新书脊时 +1 */
  version: number;
}

export const useStudy = create<StudyStore>(() => ({
  opened: {},
  backlinks: {},
  bookStatus: true,
  volumes: { ...DEFAULT_VOLUMES },
  envAmbience: true,
  bgm: "rare",
  bgmStyles: [...ALL_STYLES],
  bubble: null,
  capture: false,
  templateDir: DEFAULT_TEMPLATE_DIR,
  presets: [],
  carpetId: null,
  version: 0,
}));

const set = useStudy.setState;
const get = useStudy.getState;
const toast = (t: string, tone: "info" | "error" = "info") => useApp.getState().toast(t, tone);
const bump = () => set({ version: get().version + 1 });

// ───────────── 保存附加数据 ─────────────

let metaTimer: ReturnType<typeof setTimeout> | undefined;
function saveMetaSoon() {
  clearTimeout(metaTimer);
  metaTimer = setTimeout(() => {
    const { opened, bookStatus, volumes, envAmbience, bgm, bgmStyles } = get();
    void api.vaultJsonSave("meta.json", { opened, bookStatus, volumes, envAmbience, bgm, bgmStyles }).catch(() => {});
  }, 1500);
}

async function savePresets() {
  await api.vaultJsonSave("presets.json", get().presets).catch((e) => toast(`预设保存失败：${errorMessage(e)}`, "error"));
}

// ───────────── 加载 ─────────────

let backlinkTimer: ReturnType<typeof setTimeout> | undefined;
function refreshBacklinksSoon(delay = 1500) {
  clearTimeout(backlinkTimer);
  backlinkTimer = setTimeout(async () => {
    try {
      set({ backlinks: await api.backlinkCounts() });
      bump();
    } catch {
      // 没有打开的库等情况：忽略
    }
  }, delay);
}

export async function loadStudy() {
  set({ bubble: null, carpetId: null, opened: {}, backlinks: {}, presets: [] });
  const [meta, presets, tplDir] = await Promise.all([
    api.vaultJsonLoad("meta.json").catch(() => null),
    api.vaultJsonLoad("presets.json").catch(() => null),
    api.obsidianTemplatesFolder().catch(() => null),
  ]);
  const m = (meta ?? {}) as { opened?: unknown; bookStatus?: unknown; sound?: unknown; volumes?: Partial<Volumes>; envAmbience?: unknown; bgm?: unknown; bgmStyles?: unknown };
  const v = m.volumes && typeof m.volumes === "object" ? m.volumes : {};
  const num = (x: unknown, d: number) => (typeof x === "number" && x >= 0 && x <= 1 ? x : d);
  const volumes: Volumes = {
    master: num(v.master, DEFAULT_VOLUMES.master),
    sfx: num(v.sfx, DEFAULT_VOLUMES.sfx),
    ambience: num(v.ambience, DEFAULT_VOLUMES.ambience),
    music: num(v.music, DEFAULT_VOLUMES.music),
    // 旧版本的「地毯背景声」关掉时视为静音
    muted: typeof v.muted === "boolean" ? v.muted : m.sound === false,
  };
  set({
    opened: parseOpened(m.opened),
    bookStatus: m.bookStatus !== false,
    volumes,
    envAmbience: m.envAmbience !== false,
    bgm: (["off", "rare", "often", "always"] as const).includes(m.bgm as BgmFrequency) ? (m.bgm as BgmFrequency) : "rare",
    bgmStyles: Array.isArray(m.bgmStyles) && m.bgmStyles.some((x) => ALL_STYLES.includes(x as Style)) ? ALL_STYLES.filter((x) => (m.bgmStyles as unknown[]).includes(x)) : [...ALL_STYLES],
    presets: parsePresets(presets),
    templateDir: tplDir || DEFAULT_TEMPLATE_DIR,
  });
  nextBubbleAt = Date.now() + nextBubbleDelay();
  bump();
  refreshBacklinksSoon(800);
}

// 文件变化：打开记录跟着改名，反向链接稍后重算
function onEvents(events: VaultEvent[]) {
  let opened = get().opened;
  let relink = false;
  for (const ev of events) {
    if (ev.kind === "renamed") opened = renameOpened(opened, ev.from, ev.entry.path);
    else if (ev.kind === "removed") opened = renameOpened(opened, ev.path, null);
    if (/\.(md|markdown)$/i.test(ev.kind === "removed" ? ev.path : ev.entry.path) || ev.kind !== "modified") relink = true;
  }
  if (opened !== get().opened) {
    set({ opened });
    saveMetaSoon();
  }
  const b = get().bubble;
  if (b && events.some((e) => (e.kind === "removed" && e.path === b.path) || (e.kind === "renamed" && e.from === b.path))) clearBubble();
  if (relink) refreshBacklinksSoon();
}

let started = false;
/** 启动：订阅事件、冒泡计时器 */
export function startStudy() {
  if (started) return;
  started = true;
  onVaultLoaded(() => void loadStudy());
  onFileEvents(onEvents);
  onPathOpened((path) => {
    set({ opened: recordOpened(get().opened, path, Date.now()) });
    if (get().bubble?.path === path) clearBubble();
    saveMetaSoon();
    bump();
  });
  setInterval(bubbleTick, 15_000);
}

// ───────────── 灵感池 ─────────────

export function pendingCount(): number {
  return inboxItems(useApp.getState().files.values()).length;
}

export function openCapture() {
  if (!useApp.getState().vault) return;
  const w = useWorld.getState();
  if (w.mode === "explore" || w.mode === "paused") {
    getEngine()?.releaseLock();
    w.setMode("idle");
  }
  set({ capture: true });
}

export function closeCapture() {
  set({ capture: false });
}

/** 抛竿：把一句灵感存成 Inbox/ 下的 Markdown */
export async function castIdea(text: string): Promise<string | null> {
  const t = text.trim();
  if (!t) return null;
  const now = new Date();
  try {
    const entry = await api.fileCreate(INBOX_DIR, ideaFileName(t, now), "md", new TextEncoder().encode(ideaContent(t, now)));
    handleVaultEvents([{ kind: "created", entry }]);
    getEngine()?.hand.swing();
    getEngine()?.pondSplash();
    void import("./sound").then((m) => m.sfx("splash"));
    toast(`扑通！灵感进了鱼塘：${basename(entry.path)}`);
    return entry.path;
  } catch (e) {
    toast(`没能放进鱼塘：${errorMessage(e)}`, "error");
    return null;
  }
}

/** 归档：移到书架对应的文件夹；收藏书架则移到 Notes/ 并放上书架 */
export async function archiveIdea(path: string, shelfId: string): Promise<string | null> {
  const shelf = furniture(shelfId)?.shelf;
  if (!shelf) return null;
  const dir = shelf.mode === "folder" ? shelf.folder : "Notes";
  try {
    const r = await api.fileMove(path, dir);
    if (r.entry) handleVaultEvents([{ kind: "renamed", from: r.from, entry: r.entry }]);
    if (shelf.mode === "virtual" && !shelf.refs.includes(r.to)) {
      shelf.refs.push(r.to);
      useWorld.getState().touchLayout();
      void saveLayoutNow();
    }
    toast(`放上了「${shelf.name}」：${basename(r.to)}`);
    return r.to;
  } catch (e) {
    toast(`归档失败：${errorMessage(e)}`, "error");
    return null;
  }
}

/** 放生：移到 .trash/（Obsidian 的回收站），返回新路径以便撤销 */
export async function releaseIdea(path: string): Promise<string | null> {
  try {
    const r = await api.fileMove(path, TRASH_DIR);
    handleVaultEvents([{ kind: "removed", path }]);
    return r.to;
  } catch (e) {
    toast(`放生失败：${errorMessage(e)}`, "error");
    return null;
  }
}

/** 撤销放生：从 .trash/ 移回原来的目录 */
export async function restoreIdea(trashPath: string, originalDir = INBOX_DIR): Promise<string | null> {
  try {
    const r = await api.fileMove(trashPath, originalDir);
    if (r.entry) handleVaultEvents([{ kind: "created", entry: r.entry }]);
    return r.to;
  } catch (e) {
    toast(`没能找回：${errorMessage(e)}`, "error");
    return null;
  }
}

// ───────────── 冒泡 ─────────────

let nextBubbleAt = Date.now() + nextBubbleDelay();
const recentlySurfaced: string[] = [];

function clearBubble() {
  set({ bubble: null });
  getEngine()?.setPondBubble(false);
}

/** 打开鱼塘时取走正在冒泡的那一条 */
export function takeBubble(): Surfacing | null {
  const b = get().bubble;
  if (b) clearBubble();
  return b;
}

function bubbleTick() {
  const now = Date.now();
  const b = get().bubble;
  if (b && now > b.until) clearBubble();
  if (get().bubble || now < nextBubbleAt) return;
  const app = useApp.getState();
  const mode = useWorld.getState().mode;
  // 只在书房里走动或站着时冒泡（看得见才有意义）；没有鱼塘不冒泡
  if (!app.vault || !(mode === "explore" || mode === "idle")) return;
  if (!useWorld.getState().layout?.furniture.some((f) => f.type === "pond")) return;
  surfaceNow(now);
}

/** 立即挑一条浮上来（调试用，也供计时器调用） */
export function surfaceNow(now = Date.now()): Surfacing | null {
  nextBubbleAt = now + nextBubbleDelay();
  const pick = pickSurfacing(useApp.getState().files.values(), get().opened, now, {
    exclude: new Set(recentlySurfaced),
    templateDir: get().templateDir,
  });
  if (!pick) return null;
  recentlySurfaced.push(pick.path);
  if (recentlySurfaced.length > 20) recentlySurfaced.shift();
  set({ bubble: { ...pick, until: now + BUBBLE_MS } });
  getEngine()?.setPondBubble(true);
  return pick;
}

// ───────────── 书脊状态与设置 ─────────────

export function setBookStatus(on: boolean) {
  set({ bookStatus: on });
  saveMetaSoon();
  bump();
}

export function setVolumes(v: Partial<Volumes>) {
  set({ volumes: { ...get().volumes, ...v } });
  saveMetaSoon();
}

export function setBgm(bgm: BgmFrequency) {
  set({ bgm });
  saveMetaSoon();
}

/** 打开 / 关掉一种背景音乐风格（至少留一种） */
export function toggleBgmStyle(st: Style) {
  const cur = get().bgmStyles;
  const next = cur.includes(st) ? cur.filter((x) => x !== st) : ALL_STYLES.filter((x) => x === st || cur.includes(x));
  if (!next.length) return;
  set({ bgmStyles: next });
  saveMetaSoon();
}

export function setEnvAmbience(on: boolean) {
  set({ envAmbience: on });
  saveMetaSoon();
}

// ───────────── 模板（鱼饵） ─────────────

export function allTemplates(): Template[] {
  const dir = `${get().templateDir}/`;
  const files: FileEntry[] = [];
  for (const f of useApp.getState().files.values()) if (f.path.startsWith(dir) && (f.kind === "markdown" || f.kind === "text")) files.push(f);
  files.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true }));
  const mine = files.map((f) => ({ id: f.path, name: f.name.replace(/\.(md|markdown|txt)$/i, ""), desc: f.path, body: null }));
  // 库里有同名模板（例如从内置模板导出后改过）时，用库里的
  const names = new Set(mine.map((t) => t.name));
  return [...BUILTIN_TEMPLATES.filter((t) => t.id === "builtin:blank" || !names.has(t.name)), ...mine];
}

async function templateBody(id: string): Promise<string> {
  const b = BUILTIN_TEMPLATES.find((t) => t.id === id);
  if (b) return b.body!;
  return (await api.noteRead(id)).content;
}

/** 按模板生成新书的内容 */
export async function templateBytes(id: string, type: "md" | "txt" | "docx", title: string): Promise<Uint8Array> {
  const body = applyTemplate(await templateBody(id), { title, now: new Date() });
  if (type === "md") return new TextEncoder().encode(body);
  if (type === "txt") return new TextEncoder().encode(stripFrontmatter(body).replace(/^\s+/, ""));
  if (id === "builtin:blank") return emptyDocx(title);
  const div = document.createElement("div");
  div.innerHTML = DOMPurify.sanitize(marked.parse(stripFrontmatter(body), { async: false }) as string);
  // 标题下面紧跟标题或在末尾时，补一个空段落，方便直接点进去写
  for (const h of [...div.querySelectorAll("h1,h2,h3,h4,h5,h6")]) {
    const next = h.nextElementSibling;
    if (!next || /^H[1-6]$/.test(next.tagName)) h.after(document.createElement("p"));
  }
  return writeDocx(div);
}

/** 把内置模板写进模板文件夹，方便自己修改（已有同名文件不覆盖） */
export async function exportBuiltinTemplates(): Promise<number> {
  const dir = get().templateDir;
  const files = useApp.getState().files;
  let n = 0;
  for (const t of BUILTIN_TEMPLATES) {
    if (t.id === "builtin:blank") continue;
    if (files.has(`${dir}/${t.name}.md`)) continue;
    try {
      const entry = await api.fileCreate(dir, t.name, "md", new TextEncoder().encode(t.body!));
      handleVaultEvents([{ kind: "created", entry }]);
      n++;
    } catch (e) {
      toast(`写入模板失败：${errorMessage(e)}`, "error");
      break;
    }
  }
  toast(n ? `已放进「${dir}」${n} 个模板，可以自己改` : `「${dir}」里已经有这些模板了`);
  return n;
}

// ───────────── 布局预设 ─────────────

export async function savePreset(name: string) {
  const layout = useWorld.getState().layout;
  const n = name.trim();
  if (!layout || !n) return;
  const presets = get().presets.filter((p) => p.name !== n);
  presets.unshift(makePreset(layout, n));
  set({ presets });
  await savePresets();
  toast(`已保存摆法「${n}」`);
}

export const BACKUP_PRESET = "（载入前的摆法）";

/** 换成预设的摆法；换之前自动把当前摆法存为"载入前的摆法"，可以随时换回来（p 在备份前已取出，所以载入备份本身也安全） */
export async function loadPreset(name: string) {
  const w = useWorld.getState();
  const layout = w.layout;
  const p = get().presets.find((x) => x.name === name);
  if (!layout || !p) return;
  // 总是先备份当前摆法；载入的就是备份时，相当于两者互换
  const backup = makePreset(layout, BACKUP_PRESET);
  set({ presets: [...get().presets.filter((x) => x.name !== BACKUP_PRESET), backup] });
  const eng = getEngine();
  if (eng) layout.player = eng.player();
  const { layout: next, dropped } = applyPreset(layout, p);
  w.setDesk(null);
  w.setLayout(next);
  await Promise.all([saveLayoutNow(), savePresets()]);
  toast(dropped ? `已换成「${name}」，有 ${dropped} 件家具放不下，没有摆出来` : `已换成「${name}」`);
}

export async function deletePreset(name: string) {
  set({ presets: get().presets.filter((p) => p.name !== name) });
  await savePresets();
}

// ───────────── 地毯氛围 ─────────────

export function setCarpetAmbience(fid: string, a: Ambience, track?: string) {
  const f = furniture(fid);
  if (!f || f.type !== "carpet") return;
  if (a === "none") delete f.ambience;
  else f.ambience = a;
  if (a === "track" && track) f.track = track;
  useWorld.getState().touchLayout();
  getEngine()?.rebuildFurniture();
  void saveLayoutNow();
  applyAmbience();
}

export function setStandingCarpet(fid: string | null) {
  if (get().carpetId === fid) return;
  set({ carpetId: fid });
  applyAmbience();
}

/** 脚下地毯的氛围（不在书房里时为 none） */
export function standingAmbience(): { a: Ambience; track?: string } {
  const mode = useWorld.getState().mode;
  const inRoom = mode === "explore" || mode === "idle" || mode === "paused" || mode === "gui";
  const fid = get().carpetId;
  const f = inRoom && fid ? furniture(fid) : undefined;
  return { a: f?.ambience ?? "none", track: f?.track };
}

/** 夜读地毯：光线换成深夜（声音由 sound 模块按同一个状态处理） */
export function applyAmbience() {
  getEngine()?.env.setNightOverride(standingAmbience().a === "night");
}

useWorld.subscribe((s, prev) => {
  if (s.mode !== prev.mode) applyAmbience();
});
