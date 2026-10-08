// 书房里的交互流程：拿书、坐下写作、站起、制作新书、放置与拆除家具、整理书架。
import { api, errorMessage, type FileEntry } from "../ipc";
import { basename, isEditablePath } from "../lib/paths";
import type { Target, WorldEngine } from "../world/engine";
import { centerOf, newId, SPECS, type Furniture, type ShelfData } from "../world/layout";
import type { EnvSettings } from "../world/sky";
import { themeOf, type RoomThemeId } from "../world/themes";
import { templateBytes } from "./study";
import { openExternal, openPath, saveLayoutNow, saveLayoutSoon } from "./actions";
import { saveEverything } from "./editor";
import { useApp } from "./store";
import { useWorld } from "./worldStore";

let engine: WorldEngine | null = null;

export function setEngine(e: WorldEngine | null) {
  engine = e;
}

export function getEngine() {
  return engine;
}

function toast(text: string, tone: "info" | "error" = "info") {
  useApp.getState().toast(text, tone);
}

function layout() {
  return useWorld.getState().layout;
}

export function furniture(fid: string): Furniture | undefined {
  return layout()?.furniture.find((f) => f.id === fid);
}

/** 左键交互 */
export function interact(t: Exclude<Target, null | { kind: "floor" } | { kind: "wallspot" }>) {
  if (t.kind === "book") {
    void takeBook(t.path);
    return;
  }
  if (t.kind === "window") {
    useWorld.getState().openGui({ kind: "window" });
    return;
  }
  if (t.kind === "pet") {
    void import("./pets").then((m) => m.patPet(t.id));
    return;
  }
  if (t.kind === "wall") {
    useWorld.getState().openGui({ kind: "wall", id: t.id });
    return;
  }
  if (t.kind === "door") {
    if (!engine?.toggleDoor()) toast("先从门口让开一点再关门。");
    return;
  }
  if (t.kind === "bird") {
    void import("./butler").then((m) => m.summonButler());
    return;
  }
  if (t.kind === "garden") {
    void import("./garden").then((m) => {
      if (!m.pullWeed(t.x, t.z)) toast("想移走它或者种点什么，按 G 叫管家帮忙。");
    });
    return;
  }
  const f = furniture(t.fid);
  if (!f) return;
  switch (f.type) {
    case "bookshelf":
      useWorld.getState().openGui({ kind: "shelf", fid: f.id });
      break;
    case "desk":
      void sitAtDesk(f.id);
      break;
    case "workbench":
      useWorld.getState().openGui({ kind: "workbench" });
      break;
    case "chest":
      useWorld.getState().openGui({ kind: "chest" });
      break;
    case "aibench":
      useWorld.getState().openGui({ kind: "ai" });
      break;
    case "pond":
      useWorld.getState().openGui({ kind: "pond" });
      break;
    case "jukebox":
      useWorld.getState().openGui({ kind: "jukebox" });
      break;
    case "carpet":
      useWorld.getState().openGui({ kind: "carpet", fid: f.id });
      break;
    case "stairs":
      useWorld.getState().openGui({ kind: "floors" });
      break;
    default:
      toast(`${SPECS[f.type].name}：${SPECS[f.type].hint}`);
  }
}

/** 拿起一本书：可编辑的带到书桌，其他文件用系统应用打开 */
export async function takeBook(path: string, preferDesk?: string) {
  if (!isEditablePath(path) || useApp.getState().unreadable.has(path)) {
    await openExternal(path);
    return;
  }
  const desk = preferDesk ?? nearestDesk();
  if (!desk) {
    // 没有书桌：直接进入专注写作
    if (await openPath(path)) enterFocus();
    toast("书房里还没有书桌，已在专注模式中打开。放一张书桌就能坐下写作。");
    return;
  }
  await sitAtDesk(desk, path);
}

export function nearestDesk(): string | null {
  const l = layout();
  if (!l || !engine) return null;
  const p = engine.player();
  let best: { id: string; d: number } | null = null;
  for (const f of l.furniture) {
    if (f.type !== "desk") continue;
    const c = centerOf(f);
    const d = Math.hypot(c.x - p.x, c.z - p.z);
    if (!best || d < best.d) best = { id: f.id, d };
  }
  return best?.id ?? null;
}

/** 坐到书桌前；指定 path 时打开那本书，否则继续上一次的书 */
export async function sitAtDesk(deskId: string, path?: string) {
  const w = useWorld.getState();
  w.setDesk(deskId);
  w.setMode("writing");
  saveLayoutSoon(0);
  const sitting = engine?.sitAt(deskId) ?? Promise.resolve();
  if (path) {
    void import("./sound").then((m) => m.sfx("page"));
    await openPath(path, { focus: false });
  }
  await sitting;
}

/** 起身：保存当前内容，镜头回到书桌前 */
export async function standUp() {
  const w = useWorld.getState();
  await saveEverything();
  const desk = w.deskId;
  w.setMode("idle");
  await engine?.standUp(desk ?? undefined);
  saveLayoutSoon(0);
}

export function enterFocus() {
  engine?.setExplore(false);
  useWorld.getState().setMode("focus");
}

/** 从专注模式回到书房（坐在书桌前时回到书桌） */
export function exitFocus() {
  const w = useWorld.getState();
  if (w.deskId && useApp.getState().selected) w.setMode("writing");
  else w.setMode("idle");
}

// ───────────── 制作新书（工作台） ─────────────

export type BookType = "md" | "docx" | "txt";

/** 用工作台做一本新书。template 为模板（鱼饵）编号，默认空白。 */
export async function craftBook(type: BookType, name: string, shelfId: string | null, template = "builtin:blank"): Promise<string | null> {
  const shelf = shelfId ? furniture(shelfId)?.shelf : undefined;
  const dir = shelf?.mode === "folder" ? shelf.folder ?? "" : null;
  try {
    let entry: FileEntry;
    if (type === "txt" && template === "builtin:blank") entry = await api.fileCreate(dir ?? null, name, "txt", new Uint8Array());
    else entry = await api.fileCreate(dir ?? null, name, type, await templateBytes(template, type, name));
    useApp.getState().applyEvents([{ kind: "created", entry }]);
    if (shelf && shelf.mode === "virtual" && !shelf.refs.includes(entry.path)) {
      shelf.refs.push(entry.path);
      changed();
    }
    engine?.refreshBooks();
    toast(`制作完成：${basename(entry.path)}`);
    return entry.path;
  } catch (e) {
    toast(`制作失败：${errorMessage(e)}`, "error");
    return null;
  }
}

// ───────────── 书架 ─────────────

function changed(rebuild = false) {
  useWorld.getState().touchLayout();
  if (rebuild) engine?.rebuildFurniture();
  else engine?.refreshBooks();
  saveLayoutSoon();
}

export function updateShelf(fid: string, patch: Partial<ShelfData>) {
  const f = furniture(fid);
  if (!f?.shelf) return;
  Object.assign(f.shelf, patch);
  changed();
}

export function addToShelf(fid: string, paths: string[]) {
  const s = furniture(fid)?.shelf;
  if (!s) return;
  let n = 0;
  for (const p of paths)
    if (!s.refs.includes(p)) {
      s.refs.push(p);
      n++;
    }
  if (n) changed();
}

export function removeFromShelf(fid: string, path: string) {
  const s = furniture(fid)?.shelf;
  if (!s) return;
  s.refs = s.refs.filter((p) => p !== path);
  changed();
}

export function moveRef(fid: string, path: string, delta: number) {
  const s = furniture(fid)?.shelf;
  if (!s) return;
  const i = s.refs.indexOf(path);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= s.refs.length) return;
  [s.refs[i], s.refs[j]] = [s.refs[j], s.refs[i]];
  changed();
}

// ───────────── 家具 ─────────────

export function placeFurniture(f: Omit<Furniture, "id">) {
  const l = layout();
  if (!l) return;
  const item: Furniture = { ...f, id: newId(f.type) };
  if (f.type === "bookshelf") {
    const n = l.furniture.filter((x) => x.type === "bookshelf").length + 1;
    item.shelf = { name: `书架 ${n}`, mode: "virtual", refs: [], folder: "" };
    item.tint = n % 3;
  }
  l.furniture.push(item);
  changed(true);
  void import("./sound").then((m) => m.sfx("place"));
}

export function removeFurniture(fid: string) {
  const l = layout();
  if (!l) return;
  l.furniture = l.furniture.filter((f) => f.id !== fid);
  if (useWorld.getState().deskId === fid) useWorld.getState().setDesk(null);
  changed(true);
  void saveLayoutNow();
}

/** 修改时间 / 天气 / 窗景 */
export function updateEnv(patch: Partial<EnvSettings>) {
  const l = layout();
  if (!l) return;
  l.env = { ...l.env, ...patch };
  engine?.setEnv(l.env);
  useWorld.getState().touchLayout();
  saveLayoutSoon(300);
}

/** ⌘K 带路：走到书所在的书架前，书闪几下 */
export async function locateInRoom(path: string): Promise<boolean> {
  const w = useWorld.getState();
  if (w.mode === "focus" || w.mode === "writing" || w.mode === "gui") w.setMode("idle");
  if (!engine) return false;
  const ok = await engine.locateBook(path);
  if (!ok) toast("这本书还没有放上书架。在书架面板里可以放上去，或者按 Enter 直接带到书桌。");
  else saveLayoutSoon();
  return ok;
}

/** 换屋子主题（只换墙、地板、窗户和灯光） */
export function setRoomTheme(id: RoomThemeId) {
  const l = layout();
  if (!l) return;
  l.theme = id;
  engine?.setTheme(themeOf(id));
  useWorld.getState().touchLayout();
  saveLayoutSoon(200);
}

export function cycleTint(fid: string) {
  const f = furniture(fid);
  if (!f) return;
  f.tint = ((f.tint ?? 0) + 1) % 3;
  changed(true);
}
