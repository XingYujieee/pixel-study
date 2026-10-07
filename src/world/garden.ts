// 花园的数据：院子里种的东西（树、花、草垛、花坛、菜地……）和会慢慢长出来的杂草。
// 只放类型与读档校验，不依赖其他模块（避免循环引用）；编辑规则在 gardenEdit.ts。

export type GardenKind =
  | "path"
  | "bed"
  | "farmland"
  | "hay"
  | "bench"
  | "table"
  | "woodpile"
  | "trunk"
  | "bush"
  | "post"
  | "chimney"
  | "well"
  | "flower"
  | "weed";

export interface GardenBlock {
  kind: GardenKind;
  x: number;
  z: number;
  /** 顶面高度（0 为地面齐平，不挡路） */
  h: number;
  /** 花的颜色等 */
  variant?: number;
}

export interface GardenState {
  items: GardenBlock[];
  /** 上次长杂草的时间（毫秒） */
  grownAt: number;
}

const KINDS: GardenKind[] = ["bed", "farmland", "hay", "bench", "table", "woodpile", "trunk", "bush", "post", "well", "flower", "weed"];

export function parseGarden(raw: unknown): GardenState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<GardenState>;
  if (!Array.isArray(r.items)) return null;
  const items: GardenBlock[] = [];
  const seen = new Set<string>();
  for (const it of r.items as Partial<GardenBlock>[]) {
    if (!it || !KINDS.includes(it.kind as GardenKind)) continue;
    const x = Math.round(Number(it.x));
    const z = Math.round(Number(it.z));
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 60 || Math.abs(z) > 60) continue;
    // 同一格只留一个（草垛可以叠高，用 h 表示）
    const k = `${x},${z}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const h = Math.max(0, Math.min(99, Number(it.h) || 0));
    const b: GardenBlock = { kind: it.kind as GardenKind, x, z, h };
    if (typeof it.variant === "number") b.variant = it.variant;
    items.push(b);
    if (items.length > 2000) break;
  }
  return { items, grownAt: Number(r.grownAt) || Date.now() };
}
