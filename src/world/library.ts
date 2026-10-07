// 整理书架：按库里的文件夹结构重新安排文件夹书架。
// 一个文件夹一个书架；太大的文件夹拆开（这一层的散页一个书架，子文件夹各一个）；
// 一层楼放不下就往上加楼层。只动书房的摆设，不移动任何文件。纯函数。
import { addFloor, floorsOf, isGroundFloor, stairsSpot, switchFloor } from "./floors";
import { canPlace, newId, type Furniture, type Layout, type Rot, type ShelfData } from "./layout";

/** 一个书架大约摆得下的书（三层） */
export const SHELF_CAP = 40;

export interface ShelfPlanItem {
  folder: string;
  name: string;
  /** 只放这一层的文件 */
  flat: boolean;
  count: number;
}

/** 不放上书架的文件夹：隐藏的、灵感池（鱼塘）、待分拣（资料箱） */
export function skipFolder(name: string): boolean {
  return name.startsWith(".") || name === "Inbox" || name === "Imports" || name === "_resources";
}

interface Node {
  path: string;
  files: number;
  total: number;
  kids: Map<string, Node>;
}

function tree(paths: Iterable<string>): Node {
  const root: Node = { path: "", files: 0, total: 0, kids: new Map() };
  for (const p of paths) {
    const parts = p.split("/");
    if (parts.slice(0, -1).some(skipFolder)) continue;
    let n = root;
    n.total++;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let k = n.kids.get(parts[i]);
      if (!k) {
        k = { path, files: 0, total: 0, kids: new Map() };
        n.kids.set(parts[i], k);
      }
      k.total++;
      n = k;
    }
    n.files++;
  }
  return root;
}

const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** 按文件夹结构算出要哪些书架（大文件夹往下拆，最多拆三层） */
export function planShelves(paths: Iterable<string>, cap = SHELF_CAP): ShelfPlanItem[] {
  const root = tree(paths);
  const out: ShelfPlanItem[] = [];
  const collator = new Intl.Collator("zh-Hans-CN", { numeric: true });
  const visit = (n: Node, depth: number) => {
    const kids = [...n.kids.values()].sort((a, b) => collator.compare(a.path, b.path));
    if (n.total <= cap || !kids.length || depth >= 3) {
      out.push({ folder: n.path, name: n.path ? base(n.path) : "库根目录", flat: false, count: n.total });
      return;
    }
    if (n.files > 0) out.push({ folder: n.path, name: n.path ? `${base(n.path)} · 散页` : "库根目录", flat: true, count: n.files });
    for (const k of kids) visit(k, depth + 1);
  };
  // 库根目录：根上的文件单独一个书架，每个顶层文件夹往下看
  if (root.files > 0) out.push({ folder: "", name: "库根目录", flat: true, count: root.files });
  for (const k of [...root.kids.values()].sort((a, b) => collator.compare(a.path, b.path))) visit(k, 1);
  return out;
}

/** 每层楼放书架的位置：靠墙一圈，避开门口与楼梯 */
const SLOTS: [number, number, Rot][] = [
  [1, 0, 0],
  [4, 0, 0],
  [7, 0, 0],
  [10, 0, 0],
  [0, 2, 1],
  [0, 5, 1],
  [0, 8, 1],
  [13, 1, 3],
  [13, 4, 3],
  [1, 11, 2],
  [10, 11, 2],
  [3, 5, 0],
  [8, 5, 0],
  [3, 8, 2],
  [8, 8, 2],
];

export interface LibraryResult {
  layout: Layout;
  shelves: number;
  floorsAdded: number;
  /** 没地方放的（楼层数到上限了） */
  unplaced: number;
}

/**
 * 按计划重新摆文件夹书架：先拿掉所有文件夹书架（收藏书架和其他家具不动），
 * 再从一楼开始逐层往空位上放，放满了加一层。结束时回到一开始所在的楼层。
 */
export function applyLibraryPlan(layout: Layout, plan: ShelfPlanItem[]): LibraryResult {
  const startFloor = layout.floor ?? floorsOf(layout)[0].id;
  // 旧书架的配色按文件夹保留
  const tints = new Map<string, number>();
  for (const fl of floorsOf(layout)) for (const f of fl.furniture) if (f.shelf?.mode === "folder" && f.tint !== undefined) tints.set(f.shelf.folder, f.tint);
  let l: Layout = { ...layout };
  const floors = floorsOf(l).map((fl) => ({ ...fl, furniture: fl.furniture.filter((f) => !(f.type === "bookshelf" && f.shelf?.mode === "folder")) }));
  l = { ...l, floors, floor: startFloor };
  l.furniture = floors.find((f) => f.id === startFloor)!.furniture;
  let queue = [...plan];
  let floorsAdded = 0;
  let shelves = 0;
  let i = 0;
  while (queue.length) {
    const all = floorsOf(l);
    if (i >= all.length) {
      const r = addFloor(l, all.length >= 1 ? `${["一", "二", "三", "四", "五", "六", "七", "八", "九"][all.length] ?? all.length + 1}楼 · 书库` : undefined);
      if ("error" in r) break;
      l = r.layout;
      floorsAdded++;
      continue;
    }
    const fl = all[i];
    l = switchFloor(l, fl.id);
    // 一楼留出书桌那些家具；楼梯前面也要留路
    const furniture = [...l.furniture];
    const probe = { ...l, furniture } as Layout;
    const st = furniture.find((f) => f.type === "stairs");
    const keepClear = st ? stairsClear(st) : [];
    for (const [x, z, rot] of SLOTS) {
      if (!queue.length) break;
      const item = queue[0];
      const shelf: ShelfData = { name: item.name, mode: "folder", refs: [], folder: item.folder };
      if (item.flat) shelf.flat = true;
      const f: Furniture = { id: newId("shelf"), type: "bookshelf", x, z, rot, shelf, tint: tints.get(item.folder) ?? shelves % 3 };
      if (!canPlace(probe, f).ok) continue;
      if (keepClear.some(([cx, cz]) => cellsHit(f, cx, cz))) continue;
      // 一楼门口一圈不放
      if (isGroundFloor(l) && f.z >= 9 && f.x + 2 > 5 && f.x < 9) continue;
      furniture.push(f);
      queue = queue.slice(1);
      shelves++;
    }
    l = { ...l, furniture };
    // 这层放满了还有剩：确保有楼梯通到下一层
    if (queue.length && !furniture.some((f) => f.type === "stairs")) {
      const spot = stairsSpot(l);
      if (spot) l = { ...l, furniture: [...l.furniture, spot] };
    }
    i++;
    if (i > 12) break;
  }
  l = switchFloor(l, startFloor);
  if ((l.floor ?? startFloor) === startFloor) l.player = layout.player;
  return { layout: l, shelves, floorsAdded, unplaced: queue.length };
}

function cellsHit(f: Furniture, cx: number, cz: number): boolean {
  const w = f.rot % 2 === 0 ? 2 : 1;
  const d = f.rot % 2 === 0 ? 1 : 2;
  return cx >= f.x && cx < f.x + w && cz >= f.z && cz < f.z + d;
}

/** 楼梯前面要空出来的格子 */
function stairsClear(st: Furniture): [number, number][] {
  const out: [number, number][] = [];
  const r = st.rot % 4;
  if (r === 2) for (const dx of [-1, 0, 1]) out.push([st.x + dx, st.z - 1], [st.x + dx, st.z - 2]);
  else if (r === 0) for (const dx of [-1, 0, 1]) out.push([st.x + dx, st.z + 2], [st.x + dx, st.z + 3]);
  else if (r === 1) for (const dz of [-1, 0, 1]) out.push([st.x + 2, st.z + dz], [st.x + 3, st.z + dz]);
  else for (const dz of [-1, 0, 1]) out.push([st.x - 1, st.z + dz], [st.x - 2, st.z + dz]);
  return out;
}

/** 一句话说明计划 */
export function describePlan(plan: ShelfPlanItem[], current: number): string {
  const big = plan.filter((p) => p.flat).length;
  return `按文件夹排 ${plan.length} 个书架（现在有 ${current} 个文件夹书架）${big ? `，其中 ${big} 个大文件夹拆开放` : ""}`;
}

/** 书在哪个书架上（最具体的那个；收藏书架也算） */
export function shelfFor(layout: Layout, path: string): { floorId: string; floorName: string; f: Furniture } | null {
  let best: { floorId: string; floorName: string; f: Furniture; score: number } | null = null;
  for (const fl of floorsOf(layout))
    for (const f of fl.furniture) {
      const s = f.shelf;
      if (f.type !== "bookshelf" || !s) continue;
      let score = -1;
      if (s.mode === "virtual") score = s.refs.includes(path) ? 1000 : -1;
      else {
        const prefix = s.folder ? `${s.folder}/` : "";
        if (path.startsWith(prefix) && (!s.flat || !path.slice(prefix.length).includes("/"))) score = s.folder.length + 1;
      }
      // 当前楼层优先
      if (score >= 0 && fl.id === layout.floor) score += 0.5;
      if (score >= 0 && (!best || score > best.score)) best = { floorId: fl.id, floorName: fl.name, f, score };
    }
  return best && { floorId: best.floorId, floorName: best.floorName, f: best.f };
}
