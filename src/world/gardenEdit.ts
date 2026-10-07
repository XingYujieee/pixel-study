// 花园的编辑规则：种树、种花、堆草垛、拔掉东西、除草、杂草慢慢长出来。纯函数。
import type { GardenBlock, GardenKind, GardenState } from "./garden";
import { defaultGarden, inHouse, inYard, isPath, WALL } from "./yard";

/** 管家能种 / 放的东西 */
export type PlantKind = "tree" | "flower" | "bush" | "hay" | "bed" | "farmland";

export const PLANT_NAMES: Record<PlantKind, string> = { tree: "树", flower: "花", bush: "灌木", hay: "草垛", bed: "花坛", farmland: "菜地" };

export const KIND_NAMES: Partial<Record<GardenKind, string>> = {
  trunk: "树",
  flower: "花",
  bush: "灌木",
  hay: "草垛",
  bed: "花坛",
  farmland: "菜地",
  weed: "杂草",
  bench: "长椅",
  table: "野餐桌",
  woodpile: "柴堆",
  post: "路灯",
  well: "井",
};

export const MAX_WEEDS = 40;

export function gardenOf(state: GardenState | undefined, now = Date.now()): GardenState {
  return state ?? { items: defaultGarden(), grownAt: now };
}

const at = (items: GardenBlock[], x: number, z: number) => items.find((b) => b.x === x && b.z === z);

/** 这一格能不能放东西 */
export function canPlant(items: GardenBlock[], kind: PlantKind, x: number, z: number): { ok: true } | { ok: false; reason: string } {
  if (!inYard(x, z)) return { ok: false, reason: "在围栏外面" };
  if (inHouse(x, z)) return { ok: false, reason: "那里是屋子" };
  if (isPath(x, z) || (x >= 5 && x <= 8 && z === 13)) return { ok: false, reason: "会挡住门口的路" };
  const here = at(items, x, z);
  if (here && here.kind !== "weed" && !(kind === "hay" && here.kind === "hay" && here.h < 3)) return { ok: false, reason: `那里已经有${KIND_NAMES[here.kind] ?? "东西"}了` };
  if (kind === "tree") {
    // 树冠有 5 格宽：离屋子和别的树远一点
    for (const b of items) if (b.kind === "trunk" && Math.abs(b.x - x) <= 3 && Math.abs(b.z - z) <= 3) return { ok: false, reason: "离另一棵树太近了" };
    if (x >= -4 && x <= 17 && z >= -4 && z <= 15) return { ok: false, reason: "离屋子太近，树冠会碰到屋顶" };
  }
  return { ok: true };
}

/** 种 / 放一样东西（返回新的列表） */
export function plant(items: GardenBlock[], kind: PlantKind, x: number, z: number, variant = 0): { items: GardenBlock[] } | { error: string } {
  const c = canPlant(items, kind, x, z);
  if (!c.ok) return { error: c.reason };
  const rest = items.filter((b) => !(b.x === x && b.z === z && (b.kind === "weed" || (kind === "hay" && b.kind === "hay"))));
  const old = at(items, x, z);
  const block: GardenBlock =
    kind === "tree"
      ? { kind: "trunk", x, z, h: WALL }
      : kind === "flower"
        ? { kind: "flower", x, z, h: 0, variant: variant % 4 }
        : kind === "bush"
          ? { kind: "bush", x, z, h: 1 }
          : kind === "hay"
            ? { kind: "hay", x, z, h: old?.kind === "hay" ? old.h + 1 : 1 }
            : kind === "bed"
              ? { kind: "bed", x, z, h: 0.5, variant: variant % 4 }
              : { kind: "farmland", x, z, h: 0, variant: variant % 3 };
  return { items: [...rest, block] };
}

/** 在 (x, z) 附近找一块能放的地方（由近到远） */
export function spotNear(items: GardenBlock[], kind: PlantKind, x: number, z: number, maxR = 8): { x: number; z: number } | null {
  const cx = Math.floor(x),
    cz = Math.floor(z);
  for (let r = 0; r <= maxR; r++)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (canPlant(items, kind, cx + dx, cz + dz).ok) return { x: cx + dx, z: cz + dz };
      }
  return null;
}

/** 离 (x, z) 最近的某种东西 */
export function nearest(items: GardenBlock[], kinds: GardenKind[], x: number, z: number, maxD = 12): GardenBlock | null {
  let best: GardenBlock | null = null;
  let bd = maxD;
  for (const b of items) {
    if (!kinds.includes(b.kind)) continue;
    const d = Math.hypot(b.x + 0.5 - x, b.z + 0.5 - z);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** 拿掉一格上的东西（草垛一层层拿） */
export function removeAt(items: GardenBlock[], x: number, z: number): { items: GardenBlock[]; removed: GardenBlock } | null {
  const b = at(items, x, z);
  if (!b) return null;
  if (b.kind === "hay" && b.h > 1) return { items: items.map((it) => (it === b ? { ...b, h: b.h - 1 } : it)), removed: b };
  return { items: items.filter((it) => it !== b), removed: b };
}

/** 除草：拔掉所有杂草 */
export function weed(items: GardenBlock[]): { items: GardenBlock[]; count: number } {
  const rest = items.filter((b) => b.kind !== "weed");
  return { items: rest, count: items.length - rest.length };
}

/** 杂草慢慢长：每过一天在空草地上长出几棵（最多 MAX_WEEDS 棵） */
export function growWeeds(state: GardenState, now: number, rand: () => number = Math.random): GardenState {
  const days = Math.floor((now - state.grownAt) / 86400000);
  if (days < 1) return state;
  const items = [...state.items];
  let weeds = items.filter((b) => b.kind === "weed").length;
  const want = Math.min(MAX_WEEDS - weeds, days * 3);
  for (let i = 0, tries = 0; i < want && tries < 400; tries++) {
    const x = -6 + Math.floor(rand() * 26);
    const z = -5 + Math.floor(rand() * 32);
    if (!inYard(x, z) || inHouse(x, z) || isPath(x, z) || at(items, x, z)) continue;
    items.push({ kind: "weed", x, z, h: 0 });
    weeds++;
    i++;
  }
  return { items, grownAt: state.grownAt + days * 86400000 };
}

/** 花园概况（给管家看） */
export function gardenSummary(items: GardenBlock[]): string {
  const count = new Map<string, number>();
  for (const b of items) {
    const n = KIND_NAMES[b.kind];
    if (n) count.set(n, (count.get(n) ?? 0) + 1);
  }
  return [...count].map(([n, c]) => `${n} ${c}`).join("、") || "空的";
}
