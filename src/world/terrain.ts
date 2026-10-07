// 院子围栏外的远景地形：按窗景主题生成一圈方块地形（树林、田野、雪山、海边、竹林、城市），
// 再远处由雾和远景画衔接。走不出去，只是看。纯数据，便于测试；渲染在 outdoor.ts。
import { YARD } from "./yard";
import type { SceneryPreset } from "./themes";

/** 远景地形样式：用了自己的图片时是平坦的草地（不挡住图片） */
export type TerrainStyle = SceneryPreset | "meadow";

export type BlockKind = "grass" | "dirt" | "stone" | "sand" | "snow" | "gravel" | "farmland" | "asphalt" | "moss";

export interface Column {
  x: number;
  z: number;
  /** 顶面高度（方块占 [h-1, h]） */
  h: number;
  top: BlockKind;
}

export type FeatureKind = "oak" | "spruce" | "bamboo" | "building" | "flower" | "tallgrass" | "crop" | "hay" | "lamp" | "rock";

export interface Feature {
  kind: FeatureKind;
  x: number;
  z: number;
  /** 底部高度 */
  y: number;
  /** 树高、楼高、竹子高度 */
  h?: number;
  /** 楼的占地 */
  w?: number;
  d?: number;
  /** 花的颜色等 */
  variant?: number;
}

export interface Terrain {
  style: TerrainStyle;
  columns: Column[];
  features: Feature[];
  /** 水面高度（海边），null 为没有水 */
  water: number | null;
  /** 最外圈的地面颜色（与远处的大地面衔接） */
  far: BlockKind | "water";
  /** 范围 */
  bounds: { x0: number; x1: number; z0: number; z1: number };
}

/** 地形范围（含院子）：中心在屋子附近，半径约 56 格 */
export const TERRAIN_BOUNDS = { x0: -50, x1: 64, z0: -48, z1: 62 } as const;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1000000) / 1000000;
  };
}

/** 平滑的值噪声（固定种子） */
function noise2(seed: number) {
  const hash = (x: number, z: number) => {
    let h = (x * 374761393 + z * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, z: number) => {
    const x0 = Math.floor(x),
      z0 = Math.floor(z);
    const fx = smooth(x - x0),
      fz = smooth(z - z0);
    const a = hash(x0, z0),
      b = hash(x0 + 1, z0),
      c = hash(x0, z0 + 1),
      d = hash(x0 + 1, z0 + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
}

/** 到院子围栏的距离（院子内为 0） */
export function distToYard(x: number, z: number): number {
  const dx = Math.max(YARD.x0 - 1 - x, 0, x - YARD.x1);
  const dz = Math.max(YARD.z0 - 1 - z, 0, z - YARD.z1);
  return Math.hypot(dx, dz);
}

export function insideFence(x: number, z: number): boolean {
  return x >= YARD.x0 - 1 && x <= YARD.x1 && z >= YARD.z0 - 1 && z <= YARD.z1;
}

export function generateTerrain(style: TerrainStyle, seed = 7): Terrain {
  const r = rng(seed * 31 + style.length);
  const n1 = noise2(seed);
  const n2 = noise2(seed + 17);
  const B = TERRAIN_BOUNDS;
  const columns: Column[] = [];
  const features: Feature[] = [];
  const heights = new Map<string, number>();
  let water: number | null = null;
  let far: Terrain["far"] = "grass";
  const fbm = (x: number, z: number, s: number) => n1(x / s, z / s) * 0.65 + n2(x / (s * 0.4), z / (s * 0.4)) * 0.35;
  // 边缘渐渐降回地面高度，与远处的大地面接上
  const edgeFade = (x: number, z: number) => {
    const ex = Math.min(x - B.x0, B.x1 - 1 - x);
    const ez = Math.min(z - B.z0, B.z1 - 1 - z);
    return Math.max(0, Math.min(1, Math.min(ex, ez) / 10));
  };

  for (let x = B.x0; x < B.x1; x++)
    for (let z = B.z0; z < B.z1; z++) {
      if (insideFence(x, z)) continue;
      const d = distToYard(x, z);
      const e = edgeFade(x, z);
      let h = 0;
      let top: BlockKind = "grass";
      switch (style) {
        case "forest": {
          h = Math.round((fbm(x, z, 14) * 5 - 1.2) * Math.min(1, d / 6) * e);
          break;
        }
        case "meadow": {
          h = Math.round((fbm(x, z, 22) * 2.2 - 0.8) * Math.min(1, d / 10) * e);
          break;
        }
        case "fields": {
          h = Math.round((fbm(x, z, 26) * 2.4 - 0.9) * Math.min(1, d / 8) * e);
          // 田地：一块块的条田
          const plot = Math.floor((x + 200) / 9) * 7 + Math.floor((z + 200) / 7) * 3;
          if (d > 3 && plot % 3 !== 0 && (x + 200) % 9 !== 0 && (z + 200) % 7 !== 0) top = "farmland";
          break;
        }
        case "mountains": {
          // 山脊在中间一圈最高，边缘降回去
          // 院子外先是一片缓坡草地，再往外山才高起来
          const dd = Math.max(0, d - 8);
          const ring = Math.sin(Math.min(1, dd / 32) * Math.PI);
          const peaks = fbm(x, z, 11);
          h = Math.round((dd * 0.06 + ring * (4 + peaks * 17) + fbm(x, z, 9) * 1.5 * Math.min(1, d / 6)) * e);
          top = h > 15 ? "snow" : h > 9 ? "stone" : "grass";
          break;
        }
        case "sea": {
          water = -0.15;
          far = "water";
          // 小岛：沙滩一圈，然后沉到水下；远处几个小岛
          const island = fbm(x + 300, z, 9);
          if (d < 3) h = 0;
          else h = Math.round(Math.max(-4, -(d - 3) * 0.7 + (island > 0.72 && d > 18 ? (island - 0.72) * 30 : 0)));
          top = h <= 0 ? "sand" : h > 3 ? "grass" : "sand";
          if (h > 4) top = "grass";
          break;
        }
        case "bamboo": {
          h = Math.round((fbm(x, z, 12) * 3.4 - 1) * Math.min(1, d / 5) * e);
          top = n2(x / 3, z / 3) > 0.55 ? "moss" : "grass";
          break;
        }
        case "city": {
          far = "asphalt";
          h = 0;
          top = d > 2 && d < 6 ? "asphalt" : "gravel";
          break;
        }
      }
      heights.set(`${x},${z}`, h);
      columns.push({ x, z, h, top });
    }

  // 树、花、草、楼……：只放在地形上，不压院子，彼此不重叠
  const taken = new Set<string>();
  const free = (x: number, z: number, rad: number) => {
    for (let i = -rad; i <= rad; i++) for (let j = -rad; j <= rad; j++) if (taken.has(`${x + i},${z + j}`) || insideFence(x + i, z + j)) return false;
    return true;
  };
  const claim = (x: number, z: number, rad: number) => {
    for (let i = -rad; i <= rad; i++) for (let j = -rad; j <= rad; j++) taken.add(`${x + i},${z + j}`);
  };

  if (style === "city") {
    // 一圈马路之外是一个个街区的楼
    for (let bx = B.x0 + 2; bx < B.x1 - 4; bx += 8)
      for (let bz = B.z0 + 2; bz < B.z1 - 4; bz += 8) {
        const w = 4 + Math.floor(r() * 3);
        const d = 4 + Math.floor(r() * 3);
        let ok = true;
        for (let i = -2; i < w + 2 && ok; i++) for (let j = -2; j < d + 2 && ok; j++) if (insideFence(bx + i, bz + j) || distToYard(bx + i, bz + j) < 8) ok = false;
        if (!ok) continue;
        const near = distToYard(bx, bz);
        const hgt = Math.round(4 + r() * 7 + Math.min(16, near * 0.4) * r());
        features.push({ kind: "building", x: bx, z: bz, y: 0, w, d, h: hgt, variant: Math.floor(r() * 4) });
        claim(bx, bz, 0);
      }
    for (const c of columns) {
      const dd = distToYard(c.x, c.z);
      if (dd > 1.2 && dd < 2.2 && (c.x + c.z) % 9 === 0) features.push({ kind: "lamp", x: c.x, z: c.z, y: 0 });
    }
  } else {
    for (const c of columns) {
      if (c.h < 0 || c.top === "sand" || c.top === "snow" || c.top === "stone") {
        if (style === "mountains" && c.top === "stone" && r() < 0.02) features.push({ kind: "rock", x: c.x, z: c.z, y: c.h });
        continue;
      }
      const dd = distToYard(c.x, c.z);
      const roll = r();
      if (style === "forest" && dd > 2 && roll < 0.035 && free(c.x, c.z, 2)) {
        features.push({ kind: "oak", x: c.x, z: c.z, y: c.h, h: 4 + Math.floor(r() * 3) });
        claim(c.x, c.z, 2);
      } else if (style === "mountains" && dd > 2 && c.h < 10 && roll < 0.05 && free(c.x, c.z, 1)) {
        features.push({ kind: "spruce", x: c.x, z: c.z, y: c.h, h: 5 + Math.floor(r() * 4) });
        claim(c.x, c.z, 1);
      } else if (style === "bamboo" && dd > 1 && roll < 0.16 && free(c.x, c.z, 0)) {
        features.push({ kind: "bamboo", x: c.x, z: c.z, y: c.h, h: 6 + Math.floor(r() * 7) });
        claim(c.x, c.z, 0);
      } else if (style === "fields" && dd > 3 && roll < 0.006 && free(c.x, c.z, 2)) {
        features.push({ kind: "oak", x: c.x, z: c.z, y: c.h, h: 4 + Math.floor(r() * 2) });
        claim(c.x, c.z, 2);
      } else if (style === "fields" && c.top === "farmland") {
        features.push({ kind: "crop", x: c.x, z: c.z, y: c.h, variant: Math.floor(r() * 3) });
      } else if (style === "fields" && roll < 0.01 && free(c.x, c.z, 0)) {
        features.push({ kind: "hay", x: c.x, z: c.z, y: c.h });
        claim(c.x, c.z, 0);
      } else if (style === "meadow" && dd > 6 && roll < 0.004 && free(c.x, c.z, 2)) {
        // 平地上偶尔一棵矮树，不挡视线
        features.push({ kind: "oak", x: c.x, z: c.z, y: c.h, h: 4 });
        claim(c.x, c.z, 2);
      } else if (roll < (style === "meadow" ? 0.07 : 0.05)) {
        features.push({ kind: r() < 0.35 ? "flower" : "tallgrass", x: c.x, z: c.z, y: c.h, variant: Math.floor(r() * 4) });
      }
    }
    if (style === "sea") water = -0.15;
  }
  return { style, columns, features, water, far, bounds: { ...B } };
}

/** 每一列需要画到多深：被四周挡住的方块不画 */
export function exposedDepth(t: Terrain): Map<string, number> {
  const hmap = new Map<string, number>();
  for (const c of t.columns) hmap.set(`${c.x},${c.z}`, c.h);
  const out = new Map<string, number>();
  for (const c of t.columns) {
    let low = c.h;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const n = hmap.get(`${c.x + dx},${c.z + dz}`);
      // 院子里是 0；地图外缘往下多画几格
      const nh = n ?? (insideFence(c.x + dx, c.z + dz) ? 0 : c.h - 3);
      low = Math.min(low, nh);
    }
    // 顶面方块总要画；侧面露出几格画几格（最多 24 格）
    out.set(`${c.x},${c.z}`, Math.max(1, Math.min(24, c.h - low + 1)));
  }
  return out;
}
