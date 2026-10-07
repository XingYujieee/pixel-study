// 书房布局：纯数据与规则，不依赖 Three.js，可单独测试。
// 坐标以方块为单位：房间内部 x ∈ [0, ROOM.w)，z ∈ [0, ROOM.d)，地面 y = 0。
// 家具 rot：0 正面朝 +z（朝向房间南侧），1 朝 +x，2 朝 -z，3 朝 -x。

import type { FileEntry, VaultEvent } from "../ipc";
import { DEFAULT_ENV, parseEnv, type EnvSettings } from "./sky";
import { THEMES, type RoomThemeId } from "./themes";
import { parseWallItems, type WallItem } from "./wall";
import type { Pet, PetKind } from "./pets";
import { parseGarden, type GardenState } from "./garden";

export const ROOM = { w: 14, d: 12, h: 6 } as const;
export const LAYOUT_VERSION = 5;

export type FurnitureType = "bookshelf" | "desk" | "workbench" | "aibench" | "pond" | "chest" | "lantern" | "plant" | "carpet" | "jukebox" | "stairs";

/** 地毯氛围：站上去时的背景声与光线（只在站着的时候生效，不改任何设置） */
export type Ambience = "none" | "rain" | "fire" | "night" | "waves" | "wind" | "birds" | "track";

export const AMBIENCES: { id: Ambience; name: string; desc: string }[] = [
  { id: "none", name: "普通", desc: "没有特别的氛围" },
  { id: "rain", name: "雨声", desc: "轻轻的雨声" },
  { id: "fire", name: "炉火", desc: "低低的柴火噼啪声" },
  { id: "night", name: "夜读", desc: "光线变成深夜，灯笼更亮，有虫鸣" },
  { id: "waves", name: "海浪", desc: "远处一阵一阵的浪声" },
  { id: "wind", name: "风声", desc: "窗外的风" },
  { id: "birds", name: "鸟鸣", desc: "早晨的林子" },
  { id: "track", name: "我的音频", desc: "留声机歌单里的一首，循环播放" },
];
export type Rot = 0 | 1 | 2 | 3;

export interface ShelfData {
  name: string;
  /** virtual：保存文件引用；folder：绑定库内真实文件夹 */
  mode: "virtual" | "folder";
  refs: string[];
  folder: string;
  /** 文件夹书架只放这一层的文件（子文件夹另有书架时用） */
  flat?: boolean;
}

export interface Furniture {
  id: string;
  type: FurnitureType;
  x: number;
  z: number;
  rot: Rot;
  shelf?: ShelfData;
  /** 材质配色序号 */
  tint?: number;
  /** 地毯氛围 */
  ambience?: Ambience;
  /** 地毯氛围为「我的音频」时的歌单编号 */
  track?: string;
}

export interface Layout {
  version: number;
  furniture: Furniture[];
  player: { x: number; z: number; yaw: number; pitch: number };
  /** 时间、天气、窗景 */
  env: EnvSettings;
  /** 屋子主题 */
  theme?: RoomThemeId;
  /** 墙上的东西（黑板、画框） */
  wall?: WallItem[];
  /** 宠物 */
  pets?: Pet[];
  /** 楼层：每层一套家具、墙上挂件和屋子主题；当前这层的内容就是上面的 furniture / wall / theme */
  floors?: FloorData[];
  /** 当前楼层编号 */
  floor?: string;
  /** 院子里的花园（种的树、花、草垛、杂草……）；没有时用默认花园 */
  garden?: GardenState;
  /** 管家（小鸟） */
  butler?: { name: string; kind: BirdKind; perch?: { x: number; z: number } };
}

export type BirdKind = "owl" | "parrot" | "sparrow";

export interface FloorData {
  id: string;
  name: string;
  theme?: RoomThemeId;
  furniture: Furniture[];
  wall?: WallItem[];
  player?: { x: number; z: number; yaw: number; pitch: number };
}

export interface FurnitureSpec {
  name: string;
  /** rot = 0 时 x 方向宽度、z 方向深度、高度（方块） */
  w: number;
  d: number;
  h: number;
  /** 是否阻挡行走 */
  solid: boolean;
  /** 可以放在其他家具占用的格子上（地毯） */
  flat?: boolean;
  hint: string;
}

export const SPECS: Record<FurnitureType, FurnitureSpec> = {
  bookshelf: { name: "书架", w: 2, d: 1, h: 3, solid: true, hint: "左键打开书架 · 选一本书带到书桌" },
  desk: { name: "书桌", w: 2, d: 1, h: 1, solid: true, hint: "左键坐下写作" },
  workbench: { name: "工作台", w: 1, d: 1, h: 1, solid: true, hint: "左键制作新的书（Markdown / Word / TXT）" },
  aibench: { name: "AI 工作台", w: 1, d: 1, h: 1, solid: true, hint: "左键向 AI 提问（Claude / OpenAI / 其他接口）" },
  pond: { name: "鱼塘", w: 2, d: 2, h: 0.5, solid: true, hint: "左键打开灵感池 · C 随手记一句" },
  jukebox: { name: "留声机", w: 1, d: 1, h: 1.3, solid: true, hint: "左键打开歌单 · 把音频文件拖到上面加歌" },
  chest: { name: "资料箱", w: 1, d: 1, h: 1, solid: true, hint: "左键打开：导入文件、查看 PDF 等资料" },
  lantern: { name: "灯笼", w: 1, d: 1, h: 1, solid: true, hint: "装饰照明" },
  plant: { name: "盆栽", w: 1, d: 1, h: 1, solid: true, hint: "装饰" },
  carpet: { name: "地毯", w: 2, d: 2, h: 0, solid: false, flat: true, hint: "空手左键设置氛围 · 站上去生效" },
  stairs: { name: "楼梯", w: 1, d: 2, h: 3, solid: true, hint: "左键上下楼：书多了可以再加一层" },
};

/** 物品栏：1–9 与 0 共十格，第一格是空手 */
export const HOTBAR: (FurnitureType | null)[] = [null, "bookshelf", "desk", "workbench", "aibench", "pond", "chest", "lantern", "plant", "carpet", "jukebox", "stairs"];

/** 旋转后的占地尺寸 */
export function footprint(f: Pick<Furniture, "type" | "rot">): { w: number; d: number } {
  const s = SPECS[f.type];
  return f.rot % 2 === 0 ? { w: s.w, d: s.d } : { w: s.d, d: s.w };
}

/** 家具占用的格子 */
export function cellsOf(f: Pick<Furniture, "type" | "rot" | "x" | "z">): [number, number][] {
  const { w, d } = footprint(f);
  const out: [number, number][] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push([f.x + i, f.z + j]);
  return out;
}

/** 家具中心（世界坐标） */
export function centerOf(f: Pick<Furniture, "type" | "rot" | "x" | "z">): { x: number; z: number } {
  const { w, d } = footprint(f);
  return { x: f.x + w / 2, z: f.z + d / 2 };
}

/** 正面朝向的单位向量 */
export function facing(rot: Rot): { x: number; z: number } {
  return [
    { x: 0, z: 1 },
    { x: 1, z: 0 },
    { x: 0, z: -1 },
    { x: -1, z: 0 },
  ][rot];
}

export type PlaceCheck = { ok: true } | { ok: false; reason: string };

/** 放置检查：在房间内、不与其他实体家具重叠、不压住玩家。地毯只与地毯冲突。 */
export function canPlace(
  layout: Layout,
  f: Pick<Furniture, "type" | "rot" | "x" | "z">,
  ignoreId?: string,
  player?: { x: number; z: number },
): PlaceCheck {
  const spec = SPECS[f.type];
  const cells = cellsOf(f);
  for (const [x, z] of cells) {
    if (x < 0 || z < 0 || x >= ROOM.w || z >= ROOM.d) return { ok: false, reason: "超出房间" };
  }
  const key = (x: number, z: number) => `${x},${z}`;
  const mine = new Set(cells.map(([x, z]) => key(x, z)));
  for (const other of layout.furniture) {
    if (other.id === ignoreId) continue;
    const otherFlat = !!SPECS[other.type].flat;
    if (!!spec.flat !== otherFlat) continue;
    for (const [x, z] of cellsOf(other)) {
      if (mine.has(key(x, z))) return { ok: false, reason: `与${SPECS[other.type].name}重叠` };
    }
  }
  if (player && spec.solid) {
    const px = Math.floor(player.x);
    const pz = Math.floor(player.z);
    for (const [x, z] of cells) {
      if (Math.abs(x + 0.5 - player.x) < 0.8 && Math.abs(z + 0.5 - player.z) < 0.8) return { ok: false, reason: "不能放在自己脚下" };
      if (x === px && z === pz) return { ok: false, reason: "不能放在自己脚下" };
    }
  }
  return { ok: true };
}

/** 阻挡行走的格子集合（房间外一圈视为墙） */
export function solidCells(layout: Layout): Set<string> {
  const s = new Set<string>();
  for (const f of layout.furniture) {
    if (!SPECS[f.type].solid) continue;
    for (const [x, z] of cellsOf(f)) s.add(`${x},${z}`);
  }
  return s;
}

export function isSolid(solid: Set<string>, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= ROOM.w || z >= ROOM.d) return true;
  return solid.has(`${x},${z}`);
}

/**
 * 圆形玩家与格子的碰撞：按 x、z 分轴移动，碰到阻挡格就停在边缘。
 * 返回修正后的位置。
 */
export function moveWithCollision(
  solid: Set<string>,
  pos: { x: number; z: number },
  dx: number,
  dz: number,
  radius = 0.3,
): { x: number; z: number } {
  const blocked = (x: number, z: number) => {
    for (let cx = Math.floor(x - radius); cx <= Math.floor(x + radius); cx++)
      for (let cz = Math.floor(z - radius); cz <= Math.floor(z + radius); cz++) if (isSolid(solid, cx, cz)) return true;
    return false;
  };
  let { x, z } = pos;
  if (!blocked(x + dx, z)) x += dx;
  else if (dx > 0) x = Math.min(x + dx, Math.floor(x + radius) + 1 - radius - 1e-4);
  else if (dx < 0) x = Math.max(x + dx, Math.floor(x - radius) + radius + 1e-4);
  if (!blocked(x, z + dz)) z += dz;
  else if (dz > 0) z = Math.min(z + dz, Math.floor(z + radius) + 1 - radius - 1e-4);
  else if (dz < 0) z = Math.max(z + dz, Math.floor(z - radius) + radius + 1e-4);
  // 再次确认（贴边修正后仍可能压线）
  if (blocked(x, z)) return pos;
  return { x, z };
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter++;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/** 首次打开库时的默认书房：北墙一排书架（按顶层文件夹），东侧书桌靠窗，西侧工作台与资料箱。 */
export function defaultLayout(files: Iterable<FileEntry>): Layout {
  const topDirs = new Map<string, number>();
  let rootFiles = 0;
  for (const f of files) {
    const i = f.path.indexOf("/");
    if (i === -1) rootFiles++;
    else topDirs.set(f.path.slice(0, i), (topDirs.get(f.path.slice(0, i)) ?? 0) + 1);
  }
  const dirs = [...topDirs.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
  const shelves: ShelfData[] = [];
  for (const d of dirs.slice(0, 4)) shelves.push({ name: d, mode: "folder", refs: [], folder: d });
  if (rootFiles > 0 && shelves.length < 5) shelves.push({ name: "库根目录", mode: "folder", refs: [], folder: "" });
  shelves.push({ name: "收藏", mode: "virtual", refs: [], folder: "" });

  const furniture: Furniture[] = [];
  // 北墙：x = 1, 4, 7, 10 …（每个 2 宽，间隔 1）；放不下的放到西墙
  const northSlots = [1, 4, 7, 10];
  shelves.forEach((shelf, i) => {
    if (i < northSlots.length) furniture.push({ id: newId("shelf"), type: "bookshelf", x: northSlots[i], z: 0, rot: 0, shelf, tint: i % 3 });
    else furniture.push({ id: newId("shelf"), type: "bookshelf", x: 0, z: 2 + (i - northSlots.length) * 3, rot: 1, shelf, tint: i % 3 });
  });
  furniture.push(
    { id: newId("desk"), type: "desk", x: 12, z: 5, rot: 3 },
    { id: newId("wb"), type: "workbench", x: 0, z: 9, rot: 1 },
    { id: newId("ai"), type: "aibench", x: 13, z: 9, rot: 3 },
    { id: newId("pond"), type: "pond", x: 12, z: 7, rot: 3 },
    { id: newId("jukebox"), type: "jukebox", x: 1, z: 11, rot: 2 },
    { id: newId("chest"), type: "chest", x: 0, z: 10, rot: 1 },
    { id: newId("lamp"), type: "lantern", x: 13, z: 3, rot: 0 },
    { id: newId("lamp"), type: "lantern", x: 0, z: 0, rot: 0 },
    { id: newId("plant"), type: "plant", x: 13, z: 0, rot: 0 },
    { id: newId("plant"), type: "plant", x: 13, z: 11, rot: 0 },
    { id: newId("carpet"), type: "carpet", x: 6, z: 5, rot: 0 },
    { id: newId("carpet"), type: "carpet", x: 6, z: 7, rot: 0 },
  );
  return { version: LAYOUT_VERSION, furniture, player: { x: 7, z: 9.5, yaw: 0, pitch: -0.05 }, env: { ...DEFAULT_ENV }, pets: [firstPet()] };
}

/** 读入保存的布局：校验结构，丢弃非法家具，重叠的后者丢弃。 */
export function parseLayout(raw: unknown): Layout | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Layout>;
  if (typeof r.version !== "number" || !Array.isArray(r.furniture)) return null;
  const out: Layout = {
    version: LAYOUT_VERSION,
    furniture: [],
    player: { x: 7, z: 9.5, yaw: 0, pitch: 0 },
    env: parseEnv((r as { env?: unknown }).env),
  };
  const th = (r as { theme?: unknown }).theme;
  if (typeof th === "string" && th in THEMES) out.theme = th as RoomThemeId;
  const wall = parseWallItems((r as { wall?: unknown }).wall);
  if (wall.length) out.wall = wall;
  const pets = parsePets((r as { pets?: unknown }).pets);
  if (pets.length) out.pets = pets;
  const garden = parseGarden((r as { garden?: unknown }).garden);
  if (garden) out.garden = garden;
  const bt = (r as { butler?: Partial<NonNullable<Layout["butler"]>> }).butler;
  if (bt && typeof bt.name === "string") {
    out.butler = { name: bt.name.slice(0, 16) || "咕咕", kind: (["owl", "parrot", "sparrow"] as BirdKind[]).includes(bt.kind as BirdKind) ? (bt.kind as BirdKind) : "owl" };
    if (bt.perch && typeof bt.perch.x === "number" && typeof bt.perch.z === "number") out.butler.perch = { x: bt.perch.x, z: bt.perch.z };
  }
  if (r.player && typeof r.player.x === "number" && typeof r.player.z === "number") {
    out.player = { x: r.player.x, z: r.player.z, yaw: Number(r.player.yaw) || 0, pitch: Number(r.player.pitch) || 0 };
  }
  for (const f of r.furniture as Furniture[]) {
    if (!f || !(f.type in SPECS) || typeof f.x !== "number" || typeof f.z !== "number") continue;
    const item: Furniture = { id: String(f.id || newId(f.type)), type: f.type, x: Math.round(f.x), z: Math.round(f.z), rot: ((Number(f.rot) || 0) & 3) as Rot };
    if (typeof f.tint === "number") item.tint = f.tint;
    if (f.type === "carpet" && AMBIENCES.some((a) => a.id === f.ambience)) item.ambience = f.ambience;
    if (f.type === "carpet" && typeof f.track === "string") item.track = f.track;
    if (f.type === "bookshelf") {
      const s = f.shelf;
      item.shelf = {
        name: String(s?.name ?? "书架"),
        mode: s?.mode === "folder" ? "folder" : "virtual",
        refs: Array.isArray(s?.refs) ? s!.refs.filter((x) => typeof x === "string") : [],
        folder: typeof s?.folder === "string" ? s.folder : "",
      };
      if (s?.flat === true) item.shelf.flat = true;
    }
    if (canPlace(out, item).ok) out.furniture.push(item);
  }
  // 版本 1 → 2：新增 AI 工作台，找一个空位放下
  if (r.version < 2 && !out.furniture.some((f) => f.type === "aibench")) {
    const spots: [number, number][] = [
      [13, 9],
      [13, 8],
      [13, 10],
      [12, 11],
      [1, 11],
    ];
    for (const [x, z] of spots) {
      const f: Furniture = { id: newId("ai"), type: "aibench", x, z, rot: 3 };
      if (canPlace(out, f).ok) {
        out.furniture.push(f);
        break;
      }
    }
  }
  // 版本 2 → 3：新增鱼塘（灵感池），优先放在东窗下
  if (r.version < 3 && !out.furniture.some((f) => f.type === "pond")) {
    const spots: [number, number][] = [
      [12, 7],
      [12, 2],
      [11, 9],
      [1, 6],
      [3, 9],
      [8, 9],
    ];
    for (const [x, z] of spots) {
      const f: Furniture = { id: newId("pond"), type: "pond", x, z, rot: 3 };
      if (canPlace(out, f).ok) {
        out.furniture.push(f);
        break;
      }
    }
  }
  // 版本 3 → 4：新增留声机
  if (r.version < 4 && !out.furniture.some((f) => f.type === "jukebox")) {
    for (const [x, z] of [
      [1, 11],
      [2, 11],
      [3, 11],
      [12, 11],
      [11, 11],
      [4, 9],
    ] as [number, number][]) {
      const f: Furniture = { id: newId("jukebox"), type: "jukebox", x, z, rot: 2 };
      if (canPlace(out, f).ok) {
        out.furniture.push(f);
        break;
      }
    }
  }
  // 版本 4 → 5：书房里来了一只猫（还没养过宠物的话）
  if (r.version < 5 && !out.pets?.length) out.pets = [firstPet()];
  // 楼层：其他楼层的家具同样逐件校验
  const rf = (r as { floors?: unknown }).floors;
  if (Array.isArray(rf) && rf.length) {
    const floors: FloorData[] = [];
    for (const fl of rf as Partial<FloorData>[]) {
      if (!fl || typeof fl.id !== "string" || !Array.isArray(fl.furniture)) continue;
      const sub = parseLayout({ version: LAYOUT_VERSION, furniture: fl.furniture, player: fl.player ?? out.player, env: {} });
      const item: FloorData = { id: fl.id, name: typeof fl.name === "string" && fl.name ? fl.name.slice(0, 20) : `${floors.length + 1} 楼`, furniture: sub?.furniture ?? [] };
      if (typeof fl.theme === "string" && fl.theme in THEMES) item.theme = fl.theme as RoomThemeId;
      const w = parseWallItems(fl.wall);
      if (w.length) item.wall = w;
      if (sub) item.player = sub.player;
      floors.push(item);
    }
    const active = (r as { floor?: unknown }).floor;
    if (floors.length && typeof active === "string" && floors.some((f) => f.id === active)) {
      out.floors = floors;
      out.floor = active;
    }
  }
  fixPlayer(out);
  return out;
}

/** 第一只宠物：一只橘猫，在屋子中间转悠 */
export function firstPet(): Pet {
  return { id: newId("pet"), kind: "cat", name: "团子", coat: 0, x: 8.5, z: 9.2 };
}

function fixPlayer(l: Layout) {
  if (isSolid(solidCells(l), Math.floor(l.player.x), Math.floor(l.player.z))) {
    l.player = { ...l.player, x: ROOM.w / 2, z: ROOM.d - 1.5 };
    // 中间也被占了：找第一个空格
    if (isSolid(solidCells(l), Math.floor(l.player.x), Math.floor(l.player.z))) {
      const solid = solidCells(l);
      outer: for (let z = ROOM.d - 1; z >= 0; z--)
        for (let x = 0; x < ROOM.w; x++)
          if (!isSolid(solid, x, z)) {
            l.player = { ...l.player, x: x + 0.5, z: z + 0.5 };
            break outer;
          }
    }
  }
}

const PET_KINDS_LIST: PetKind[] = ["cat", "dog", "rabbit", "chick", "fox"];

export function parsePets(raw: unknown): Pet[] {
  if (!Array.isArray(raw)) return [];
  const out: Pet[] = [];
  for (const r of raw as Partial<Pet>[]) {
    if (!r || !PET_KINDS_LIST.includes(r.kind as PetKind)) continue;
    const x = Number(r.x);
    const z = Number(r.z);
    out.push({
      id: String(r.id || `pet-${out.length}`),
      kind: r.kind as PetKind,
      name: typeof r.name === "string" && r.name.trim() ? r.name.slice(0, 20) : "小家伙",
      coat: Math.max(0, Math.floor(Number(r.coat) || 0)),
      x: Number.isFinite(x) ? Math.min(ROOM.w - 0.5, Math.max(0.5, x)) : ROOM.w / 2,
      z: Number.isFinite(z) ? Math.min(ROOM.d - 0.5, Math.max(0.5, z)) : ROOM.d / 2,
    });
    if (out.length >= 3) break;
  }
  return out;
}

/** 玩家脚下的地毯 */
export function carpetAt(layout: Layout, x: number, z: number): Furniture | null {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  for (const f of layout.furniture) {
    if (f.type !== "carpet") continue;
    if (cellsOf(f).some(([a, b]) => a === cx && b === cz)) return f;
  }
  return null;
}

// ───────────── 布局预设 ─────────────

/** 一套家具摆法。书架的名字和绑定也一起保存（书本身是文件，不受影响）。 */
export interface LayoutPreset {
  name: string;
  savedAt: number;
  furniture: Furniture[];
}

export function makePreset(layout: Layout, name: string, now = Date.now()): LayoutPreset {
  return { name, savedAt: now, furniture: JSON.parse(JSON.stringify(layout.furniture)) as Furniture[] };
}

export function parsePresets(raw: unknown): LayoutPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: LayoutPreset[] = [];
  for (const p of raw as Partial<LayoutPreset>[]) {
    if (!p || typeof p.name !== "string" || !Array.isArray(p.furniture)) continue;
    out.push({ name: p.name, savedAt: Number(p.savedAt) || 0, furniture: p.furniture });
  }
  return out;
}

/**
 * 换成预设里的摆法：逐件校验，放不下的丢弃（返回数量）。
 * 玩家被压住时移到空地。时间、天气、窗景保持不变。
 */
export function applyPreset(layout: Layout, preset: LayoutPreset): { layout: Layout; dropped: number } {
  const parsed = parseLayout({ version: LAYOUT_VERSION, furniture: preset.furniture, player: layout.player, env: layout.env });
  if (!parsed) return { layout, dropped: preset.furniture.length };
  // parseLayout 会重置不合法的玩家位置；合法时保留原位置
  fixPlayer(parsed);
  return { layout: { ...layout, furniture: parsed.furniture, player: parsed.player }, dropped: preset.furniture.length - parsed.furniture.length };
}

/** 所有楼层的家具（当前楼层用 layout.furniture，其他楼层用保存的数据） */
export function allFurniture(layout: Layout): Furniture[] {
  const out = [...layout.furniture];
  for (const fl of layout.floors ?? []) if (fl.id !== layout.floor) out.push(...fl.furniture);
  return out;
}

/** 文件改名 / 删除后更新虚拟书架引用与目录书架绑定。返回是否有变化。 */
export function applyFileEvents(layout: Layout, events: VaultEvent[]): boolean {
  let changed = false;
  for (const ev of events) {
    if (ev.kind !== "renamed") continue;
    for (const f of allFurniture(layout)) {
      const s = f.shelf;
      if (!s) continue;
      const i = s.refs.indexOf(ev.from);
      if (i !== -1) {
        s.refs[i] = ev.entry.path;
        changed = true;
      }
    }
  }
  return changed;
}

/** 书架上的书（按路径自然排序）。文件夹书架包含子文件夹中的文件。 */
export function shelfBooks(shelf: ShelfData, files: Map<string, FileEntry>): { path: string; entry: FileEntry | null }[] {
  if (shelf.mode === "virtual") {
    return shelf.refs.map((p) => ({ path: p, entry: files.get(p) ?? null }));
  }
  return folderBooks(shelf.folder, files, !!shelf.flat);
}

/** 某个文件夹里的书（flat 为只要这一层）：文件夹自身的文件在前，子文件夹的按文件夹分组 */
export function folderBooks(folder: string, files: Map<string, FileEntry>, flat = false): { path: string; entry: FileEntry | null }[] {
  const prefix = folder ? `${folder}/` : "";
  const out: { path: string; entry: FileEntry | null }[] = [];
  for (const [p, e] of files) {
    if (!p.startsWith(prefix)) continue;
    if (flat && p.slice(prefix.length).includes("/")) continue;
    out.push({ path: p, entry: e });
  }
  // 文件夹自身的文件在前，子文件夹的按文件夹分组
  const collator = new Intl.Collator("zh-Hans-CN", { numeric: true });
  const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));
  out.sort((a, b) => {
    const da = dirOf(a.path);
    const db = dirOf(b.path);
    if (da !== db) {
      if (da === folder) return -1;
      if (db === folder) return 1;
      return collator.compare(da, db);
    }
    return collator.compare(a.path, b.path);
  });
  return out;
}

/** 目录书架中的直接子文件夹 */
export function shelfSubfolders(shelf: ShelfData, files: Map<string, FileEntry>): string[] {
  if (shelf.mode !== "folder") return [];
  const prefix = shelf.folder ? `${shelf.folder}/` : "";
  const dirs = new Set<string>();
  for (const p of files.keys()) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    const i = rest.indexOf("/");
    if (i > 0) dirs.add(prefix + rest.slice(0, i));
  }
  return [...dirs].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

/** 稳定的书脊颜色序号 */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
