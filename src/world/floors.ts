// 楼层：书多了一间屋子放不下，就往上加一层。每层有自己的家具、墙上挂件和屋子主题，
// 用楼梯上下楼。当前楼层的内容放在 layout.furniture / wall / theme 里（引擎只看这一层），
// 其他楼层存在 layout.floors。纯函数，不依赖 Three.js。
import { canPlace, facing, newId, type FloorData, type Furniture, type Layout, type Rot } from "./layout";

export const MAX_FLOORS = 9;

const NAMES = ["一楼", "二楼", "三楼", "四楼", "五楼", "六楼", "七楼", "八楼", "九楼"];

/** 当前楼层的快照 */
function snapshot(layout: Layout, id: string, name: string): FloorData {
  const f: FloorData = { id, name, furniture: layout.furniture, player: layout.player };
  if (layout.theme) f.theme = layout.theme;
  if (layout.wall?.length) f.wall = layout.wall;
  return f;
}

/** 所有楼层（当前楼层用最新的数据）；没有楼层信息的布局视为只有一楼 */
export function floorsOf(layout: Layout): FloorData[] {
  if (!layout.floors?.length || !layout.floor) return [snapshot(layout, "f1", NAMES[0])];
  return layout.floors.map((f) => (f.id === layout.floor ? snapshot(layout, f.id, f.name) : f));
}

export function currentFloor(layout: Layout): FloorData {
  const all = floorsOf(layout);
  return all.find((f) => f.id === (layout.floor ?? "f1")) ?? all[0];
}

/** 是不是一楼（只有一楼有通往院子的门） */
export function isGroundFloor(layout: Layout): boolean {
  const all = floorsOf(layout);
  return all[0].id === (layout.floor ?? all[0].id);
}

export function floorIndex(layout: Layout): number {
  const all = floorsOf(layout);
  return Math.max(0, all.findIndex((f) => f.id === (layout.floor ?? all[0].id)));
}

/** 换到另一层：返回新的布局对象（当前层存回 floors） */
export function switchFloor(layout: Layout, id: string): Layout {
  const all = floorsOf(layout);
  const target = all.find((f) => f.id === id);
  if (!target || id === (layout.floor ?? all[0].id)) return layout;
  const next: Layout = { ...layout, floors: all, floor: id, furniture: target.furniture, wall: target.wall, theme: target.theme };
  if (!target.wall) delete next.wall;
  if (!target.theme) delete next.theme;
  // 从楼梯出来：站在这层楼梯的正前方；没有楼梯时用这层上次的位置
  const st = target.furniture.find((f) => f.type === "stairs");
  if (st) {
    const front = stairsFront(st);
    const d = facing(st.rot);
    // 背对楼梯，朝着屋子
    next.player = { x: front.x, z: front.z, yaw: Math.atan2(-d.x, -d.z), pitch: 0 };
  } else if (target.player) next.player = target.player;
  return next;
}

/** 楼梯正前方一步 */
export function stairsFront(st: Pick<Furniture, "x" | "z" | "rot">): { x: number; z: number } {
  const r = st.rot % 4;
  // 楼梯占 1×2（转 90° 后 2×1），正面朝 +z（rot 0）
  if (r === 0) return { x: st.x + 0.5, z: st.z + 2.6 };
  if (r === 2) return { x: st.x + 0.5, z: st.z - 0.6 };
  if (r === 1) return { x: st.x + 2.6, z: st.z + 0.5 };
  return { x: st.x - 0.6, z: st.z + 0.5 };
}

const STAIR_SPOTS: [number, number, Rot][] = [
  [13, 8, 2],
  [0, 3, 2],
  [13, 3, 2],
  [0, 8, 2],
  [12, 8, 2],
  [1, 8, 2],
];

/** 给布局找一个放楼梯的位置 */
export function stairsSpot(layout: Pick<Layout, "furniture">, prefer?: Pick<Furniture, "x" | "z" | "rot">): Furniture | null {
  const cands: [number, number, Rot][] = prefer ? [[prefer.x, prefer.z, prefer.rot], ...STAIR_SPOTS] : STAIR_SPOTS;
  for (const [x, z, rot] of cands) {
    const f: Furniture = { id: newId("stairs"), type: "stairs", x, z, rot };
    if (canPlace(layout as Layout, f).ok) return f;
  }
  return null;
}

/**
 * 加一层：新楼层有一架楼梯（和当前楼层的楼梯在同一个位置）和两盏灯。
 * 当前楼层没有楼梯时也放一架。返回新的布局（仍停在当前楼层）和新楼层编号。
 */
export function addFloor(layout: Layout, name?: string, furniture: Furniture[] = []): { layout: Layout; id: string } | { error: string } {
  const all = floorsOf(layout);
  if (all.length >= MAX_FLOORS) return { error: `最多 ${MAX_FLOORS} 层` };
  let cur = layout.furniture;
  let st = cur.find((f) => f.type === "stairs");
  if (!st) {
    const spot = stairsSpot(layout);
    if (!spot) return { error: "这层放不下楼梯，先腾出一块 1×2 的地方" };
    st = spot;
    cur = [...cur, spot];
  }
  const id = newId("floor");
  const fresh: Furniture[] = [{ id: newId("stairs"), type: "stairs", x: st.x, z: st.z, rot: st.rot }];
  const base = { furniture: fresh } as Layout;
  for (const lamp of [
    { x: 0, z: 0 },
    { x: 13, z: 0 },
  ]) {
    const f: Furniture = { id: newId("lamp"), type: "lantern", x: lamp.x, z: lamp.z, rot: 0 };
    if (canPlace(base, f).ok) fresh.push(f);
  }
  for (const f of furniture) if (canPlace(base, f).ok) fresh.push(f);
  const floor: FloorData = { id, name: name?.trim() || NAMES[all.length] || `${all.length + 1} 楼`, furniture: fresh, theme: layout.theme };
  const curId = layout.floor ?? all[0].id;
  const floors = all.map((f) => (f.id === curId ? { ...f, furniture: cur } : f));
  floors.push(floor);
  return { layout: { ...layout, furniture: cur, floors, floor: curId }, id };
}

export function renameFloor(layout: Layout, id: string, name: string): Layout {
  const all = floorsOf(layout);
  const n = name.trim().slice(0, 20);
  if (!n) return layout;
  return { ...layout, floors: all.map((f) => (f.id === id ? { ...f, name: n } : f)), floor: layout.floor ?? all[0].id };
}

/** 拆掉一层：只能拆没有书架的、不是一楼、不是当前所在的楼层 */
export function removeFloor(layout: Layout, id: string): Layout | { error: string } {
  const all = floorsOf(layout);
  const i = all.findIndex((f) => f.id === id);
  if (i <= 0) return { error: "一楼不能拆" };
  if (id === layout.floor) return { error: "先去别的楼层再拆这一层" };
  if (all[i].furniture.some((f) => f.type === "bookshelf")) return { error: "这层还有书架，先把书架搬走或拆掉" };
  return { ...layout, floors: all.filter((f) => f.id !== id) };
}

/** 所有楼层的书架（找书、带路用） */
export function allShelves(layout: Layout): { floorId: string; floorName: string; f: Furniture }[] {
  const out: { floorId: string; floorName: string; f: Furniture }[] = [];
  for (const fl of floorsOf(layout)) for (const f of fl.furniture) if (f.type === "bookshelf" && f.shelf) out.push({ floorId: fl.id, floorName: fl.name, f });
  return out;
}
