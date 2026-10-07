// 墙上的东西：黑板（钉一篇笔记）、画框（挂库里的图片）。不占地面格子，不挡路。纯数据与规则。
import { cellsOf, ROOM, SPECS, type Furniture } from "./layout";
import type { Opening, WindowSet } from "./themes";

export type WallSide = "north" | "south" | "east" | "west";
export type WallItemType = "board" | "frame";

export interface WallItem {
  id: string;
  type: WallItemType;
  side: WallSide;
  /** 沿墙方向的中心（北 / 南墙为 x，东 / 西墙为 z） */
  a: number;
  /** 中心高度 */
  y: number;
  w: number;
  h: number;
  /** 黑板：钉着的笔记 */
  note?: string;
  /** 画框：库里的图片 */
  image?: string;
  /** 画框：像素化显示 */
  pixel?: boolean;
}

export const WALL_SIZES: Record<WallItemType, { w: number; h: number; name: string }[]> = {
  board: [{ w: 2.4, h: 1.5, name: "标准" }],
  frame: [
    { w: 1, h: 1, name: "小" },
    { w: 2, h: 1.25, name: "横幅" },
    { w: 2, h: 2, name: "大" },
  ],
};

export const WALL_NAMES: Record<WallItemType, string> = { board: "黑板", frame: "画框" };

export function wallLength(side: WallSide): number {
  return side === "north" || side === "south" ? ROOM.w : ROOM.d;
}

/** 墙面中心在世界中的位置与朝向（贴在墙内侧，稍微离开一点避免闪烁） */
export function wallTransform(it: Pick<WallItem, "side" | "a" | "y">, offset = 0.04): { x: number; y: number; z: number; ry: number } {
  switch (it.side) {
    case "north":
      return { x: it.a, y: it.y, z: offset, ry: 0 };
    case "south":
      return { x: it.a, y: it.y, z: ROOM.d - offset, ry: Math.PI };
    case "west":
      return { x: offset, y: it.y, z: it.a, ry: Math.PI / 2 };
    case "east":
      return { x: ROOM.w - offset, y: it.y, z: it.a, ry: -Math.PI / 2 };
  }
}

interface Rect {
  a0: number;
  a1: number;
  y0: number;
  y1: number;
}

const overlap = (p: Rect, q: Rect) => p.a0 < q.a1 && q.a0 < p.a1 && p.y0 < q.y1 && q.y0 < p.y1;

function rectOf(it: Pick<WallItem, "a" | "y" | "w" | "h">): Rect {
  return { a0: it.a - it.w / 2, a1: it.a + it.w / 2, y0: it.y - it.h / 2, y1: it.y + it.h / 2 };
}

function openingRect(o: Opening): Rect {
  return { a0: o.from - 0.1, a1: o.to + 1.1, y0: o.y0 - 0.2, y1: o.y1 + 1.1 };
}

export type WallCheck = { ok: true } | { ok: false; reason: string };

/** 能不能挂在这里：在墙面范围内，不压窗户、门、壁炉、其他墙上的东西，不被贴墙的高家具挡住 */
export function canPlaceWall(
  it: Pick<WallItem, "side" | "a" | "y" | "w" | "h">,
  ctx: { windows: WindowSet; fireplace?: boolean; items: WallItem[]; furniture: Furniture[]; ignoreId?: string },
): WallCheck {
  const r = rectOf(it);
  const len = wallLength(it.side);
  if (r.a0 < 0.1 || r.a1 > len - 0.1 || r.y0 < 0.3 || r.y1 > ROOM.h - 0.15) return { ok: false, reason: "超出墙面" };
  if (it.side !== "south") {
    const o = ctx.windows[it.side];
    if (o && overlap(r, openingRect(o))) return { ok: false, reason: "会挡住窗户" };
  } else if (overlap(r, { a0: 5.9, a1: 8.1, y0: 0, y1: 3.1 })) return { ok: false, reason: "会挡住门" };
  if (ctx.fireplace && it.side === "west" && overlap(r, { a0: 3.8, a1: 7.2, y0: 0, y1: 2.4 })) return { ok: false, reason: "会挡住壁炉" };
  for (const other of ctx.items) {
    if (other.id === ctx.ignoreId || other.side !== it.side) continue;
    if (overlap(r, rectOf(other))) return { ok: false, reason: `与${WALL_NAMES[other.type]}重叠` };
  }
  // 贴着这面墙的家具：占的格子与挂的位置重叠、且家具比挂件下沿高
  for (const f of ctx.furniture) {
    const spec = SPECS[f.type];
    if (!spec.solid || spec.h < 1.2) continue;
    for (const [cx, cz] of cellsOf(f)) {
      const touches =
        (it.side === "north" && cz === 0) || (it.side === "south" && cz === ROOM.d - 1) || (it.side === "west" && cx === 0) || (it.side === "east" && cx === ROOM.w - 1);
      if (!touches) continue;
      const along = it.side === "north" || it.side === "south" ? cx : cz;
      if (along + 1 > r.a0 && along < r.a1 && spec.h > r.y0) return { ok: false, reason: `被${spec.name}挡住` };
    }
  }
  return { ok: true };
}

/** 吸附到 0.25 格 */
export function snapWall(v: number): number {
  return Math.round(v * 4) / 4;
}

export function parseWallItems(raw: unknown): WallItem[] {
  if (!Array.isArray(raw)) return [];
  const out: WallItem[] = [];
  for (const r of raw as Partial<WallItem>[]) {
    if (!r || (r.type !== "board" && r.type !== "frame")) continue;
    if (!["north", "south", "east", "west"].includes(r.side as string)) continue;
    if (![r.a, r.y, r.w, r.h].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    const it: WallItem = { id: String(r.id || `${r.type}-${out.length}`), type: r.type, side: r.side as WallSide, a: r.a!, y: r.y!, w: r.w!, h: r.h! };
    if (typeof r.note === "string") it.note = r.note;
    if (typeof r.image === "string") it.image = r.image;
    if (typeof r.pixel === "boolean") it.pixel = r.pixel;
    out.push(it);
  }
  return out;
}

/** 黑板上显示的文字：去掉属性区，标题、列表、待办转换成简单的符号；最多若干行 */
export function boardLines(md: string, maxLines = 12): { text: string; kind: "h" | "todo" | "done" | "li" | "p" }[] {
  let body = md;
  if (body.startsWith("---")) {
    const m = /^---\r?\n[\s\S]*?\r?\n---\s*(\r?\n|$)/.exec(body);
    if (m) body = body.slice(m[0].length);
  }
  const out: { text: string; kind: "h" | "todo" | "done" | "li" | "p" }[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    let m: RegExpExecArray | null;
    const clean = (s: string) => s.replace(/\*\*|__|`|\[\[|\]\]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
    if ((m = /^\s*#{1,6}\s+(.*)$/.exec(line))) out.push({ text: clean(m[1]), kind: "h" });
    else if ((m = /^\s*[-*+]\s+\[([ xX])\]\s*(.*)$/.exec(line))) out.push({ text: clean(m[2]), kind: m[1] === " " ? "todo" : "done" });
    else if ((m = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(line))) out.push({ text: clean(m[1]), kind: "li" });
    else out.push({ text: clean(line.replace(/^>\s?/, "")), kind: "p" });
    if (out.length >= maxLines) break;
  }
  return out;
}
