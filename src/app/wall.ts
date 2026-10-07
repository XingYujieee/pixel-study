// 墙上的黑板与画框：挂上、换内容、取下。黑板跟着笔记内容自动更新。
import { convertFileSrc } from "@tauri-apps/api/core";
import type * as THREE from "three";
import { api } from "../ipc";
import { basename } from "../lib/paths";
import { newId } from "../world/layout";
import type { WallItem, WallItemType, WallSide } from "../world/wall";
import { boardTexture, emptyFrameTexture, frameTexture } from "../world/wallArt";
import { saveLayoutSoon } from "./actions";
import { useApp } from "./store";
import { getEngine } from "./worldActions";
import { useWorld } from "./worldStore";

const toast = (t: string, tone: "info" | "error" = "info") => useApp.getState().toast(t, tone);

function items(): WallItem[] {
  return useWorld.getState().layout?.wall ?? [];
}

export function wallItem(id: string): WallItem | undefined {
  return items().find((x) => x.id === id);
}

/** 每个挂件当前画面对应的内容版本，避免重复加载 */
const loadedKey = new Map<string, string>();

function contentKey(it: WallItem): string {
  const path = it.type === "board" ? it.note : it.image;
  const e = path ? useApp.getState().files.get(path) : undefined;
  return `${path ?? ""}@${e?.mtime ?? 0}@${it.pixel !== false}@${it.w}x${it.h}`;
}

/** 立即可用的画面（占位），真实内容异步加载后替换 */
function placeholder(it: WallItem): THREE.Texture {
  return it.type === "board" ? boardTexture(it, it.note ? basename(it.note).replace(/\.(md|markdown|txt)$/i, "") : null, null) : emptyFrameTexture();
}

async function loadSurface(it: WallItem) {
  const key = contentKey(it);
  if (loadedKey.get(it.id) === key) return;
  loadedKey.set(it.id, key);
  const eng = getEngine();
  try {
    if (it.type === "board") {
      if (!it.note || !useApp.getState().files.has(it.note)) {
        eng?.setWallSurface(it.id, boardTexture(it, null, null));
        return;
      }
      const { content } = await api.noteRead(it.note);
      if (loadedKey.get(it.id) !== key) return;
      eng?.setWallSurface(it.id, boardTexture(it, basename(it.note).replace(/\.(md|markdown|txt)$/i, ""), content));
    } else {
      if (!it.image || !useApp.getState().files.has(it.image)) {
        eng?.setWallSurface(it.id, emptyFrameTexture());
        return;
      }
      const root = useApp.getState().vault?.root;
      if (!root) return;
      const tex = await frameTexture(it, convertFileSrc(`${root}/${it.image}`));
      if (loadedKey.get(it.id) !== key) return;
      eng?.setWallSurface(it.id, tex);
    }
  } catch {
    loadedKey.delete(it.id);
  }
}

/** 把布局里的挂件重建到书房（布局变化时调用） */
export function syncWall() {
  const eng = getEngine();
  if (!eng) return;
  loadedKey.clear();
  const list = items();
  eng.setWallItems(list, placeholder);
  for (const it of list) void loadSurface(it);
}

/** 文件变化：只刷新内容变了的挂件 */
export function refreshWallContents() {
  for (const it of items()) if (loadedKey.get(it.id) !== contentKey(it)) void loadSurface(it);
}

function changed(rebuild = true) {
  useWorld.getState().touchLayout();
  if (rebuild) syncWall();
  saveLayoutSoon(300);
}

/** 进入挂墙模式（在按钮点击里调用，以便锁定鼠标） */
export function startWallPlacing(type: WallItemType, w: number, h: number) {
  const eng = getEngine();
  if (!eng) return;
  pendingType = type;
  eng.startWallPlacing(type, w, h);
  useWorld.getState().setMode("explore");
  void eng.lock();
  toast(`对准墙面左键挂上${type === "board" ? "黑板" : "画框"}，右键取消`);
}

let pendingType: WallItemType = "board";

/** 引擎回调：挂好了 */
export function placeWall(spot: { side: WallSide; a: number; y: number; w: number; h: number }) {
  const layout = useWorld.getState().layout;
  if (!layout) return;
  const it: WallItem = { id: newId(pendingType), type: pendingType, ...spot };
  layout.wall = [...(layout.wall ?? []), it];
  changed();
  void import("./sound").then((m) => m.sfx("place"));
  // 挂好后直接选内容
  getEngine()?.releaseLock();
  useWorld.getState().openGui({ kind: "wall", id: it.id });
}

export function updateWall(id: string, patch: Partial<WallItem>) {
  const it = wallItem(id);
  if (!it) return;
  Object.assign(it, patch);
  changed(patch.w !== undefined || patch.h !== undefined);
  if (patch.w === undefined && patch.h === undefined) void loadSurface(it);
}

export function removeWall(id: string) {
  const layout = useWorld.getState().layout;
  if (!layout?.wall) return;
  layout.wall = layout.wall.filter((x) => x.id !== id);
  changed();
}
