// 内置窗景：程序生成的像素画（全部原创）。天空部分透明，露出书房真实的天空；
// 另外生成一张"夜灯"图层，天黑后叠加，远处会亮起灯光。
import type { SceneryPreset } from "./themes";

export const SCENERY_W = 192;
export const SCENERY_H = 108;

export interface SceneryArt {
  /** 风景（PNG data URL，天空透明） */
  url: string;
  /** 夜间灯光层（PNG data URL，只有亮点） */
  lights: string;
}

export const SCENERY_NAMES: Record<SceneryPreset, string> = {
  forest: "树林草地",
  sea: "海边",
  mountains: "雪山",
  bamboo: "竹林",
  fields: "田野",
  city: "城市",
};

type RGB = [number, number, number];
const hex = (c: string): RGB => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

class Canvas {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly w = SCENERY_W,
    readonly h = SCENERY_H,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  set(x: number, y: number, c: RGB, a = 255) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
  }
  rect(x: number, y: number, w: number, h: number, c: RGB) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  /** 从 y 一直填到底 */
  column(x: number, y: number, c: RGB, to = this.h) {
    for (let j = Math.max(0, Math.round(y)); j < to; j++) this.set(x, j, c);
  }
  alpha(x: number, y: number) {
    return this.data[(y * this.w + x) * 4 + 3];
  }
  toUrl(): string {
    const c = document.createElement("canvas");
    c.width = this.w;
    c.height = this.h;
    const g = c.getContext("2d")!;
    const img = g.createImageData(this.w, this.h);
    img.data.set(this.data);
    g.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  }
}

const shade = (c: RGB, k: number): RGB => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))) as RGB;
const WARM: RGB = [255, 214, 120];

/** 起伏的山脊线 */
function ridge(x: number, base: number, amp: number, seed: number, freq = 1) {
  return base - amp * (0.5 + 0.5 * Math.sin(x * 0.045 * freq + seed) * Math.cos(x * 0.021 * freq + seed * 1.7) + 0.25 * Math.sin(x * 0.13 * freq + seed * 3.1));
}

function sea(): [Canvas, Canvas] {
  const a = new Canvas();
  const l = new Canvas();
  const r = rng(11);
  const horizon = 54;
  // 远处小岛
  for (let x = 20; x < 62; x++) {
    const top = horizon - Math.max(0, 7 * Math.sin(((x - 20) / 42) * Math.PI)) - (x > 36 && x < 40 ? 4 : 0);
    a.column(x, top, hex("#5d7f62"), horizon);
  }
  a.rect(37, horizon - 15, 2, 5, hex("#e9e6df"));
  a.set(37, horizon - 16, hex("#c8423a"));
  a.set(38, horizon - 16, hex("#c8423a"));
  l.set(37, horizon - 15, WARM);
  l.set(38, horizon - 15, WARM);
  // 海面：越远越浅
  for (let y = horizon; y < 88; y++) {
    const k = (y - horizon) / 34;
    const c = shade(hex("#4a82b4"), 1 - k * 0.3);
    for (let x = 0; x < a.w; x++) a.set(x, y, c);
  }
  for (let i = 0; i < 160; i++) {
    const y = horizon + 2 + Math.floor(r() * 32);
    const x = Math.floor(r() * a.w);
    const len = 2 + Math.floor(r() * (2 + (y - horizon) / 6));
    for (let k = 0; k < len; k++) a.set(x + k, y, hex("#9cc7e6"));
  }
  // 浪花与沙滩
  for (let x = 0; x < a.w; x++) {
    const shore = 88 + Math.round(2 * Math.sin(x * 0.08));
    a.set(x, shore - 1, hex("#f2f6f8"));
    a.column(x, shore, hex("#dcc690"));
    if (r() < 0.12) a.set(x, shore + 2 + Math.floor(r() * 14), hex("#c4ad78"));
  }
  for (const [x, w] of [
    [140, 9],
    [160, 5],
    [12, 6],
  ])
    for (let i = 0; i < w; i++) a.column(x + i, 96 - Math.round(3 * Math.sin((i / w) * Math.PI)), hex("#7e7a74"), 99);
  // 远处的船灯
  for (const x of [90, 122, 170]) l.set(x, horizon + 3, WARM);
  return [a, l];
}

function mountains(): [Canvas, Canvas] {
  const a = new Canvas();
  const l = new Canvas();
  const r = rng(21);
  for (let x = 0; x < a.w; x++) {
    const far = ridge(x, 62, 34, 0.7, 0.8);
    for (let y = Math.round(far); y < a.h; y++) a.set(x, y, y < far + 6 && far < 42 ? hex("#f4f7fa") : hex("#8ea4bc"));
    const mid = ridge(x, 76, 18, 2.3, 1.3);
    for (let y = Math.round(mid); y < a.h; y++) a.set(x, y, y < mid + 3 && mid < 64 ? hex("#e8eef2") : hex("#5f7d77"));
  }
  // 近处松林
  for (let x = 0; x < a.w; x++) a.column(x, 88 + Math.round(2 * Math.sin(x * 0.1)), hex("#2f5a3a"));
  for (let i = 0; i < 46; i++) {
    const cx = Math.floor(r() * a.w);
    const hgt = 10 + Math.floor(r() * 10);
    const base = 92;
    for (let j = 0; j < hgt; j++) {
      const half = Math.floor((j / hgt) * 4) + (j % 3 === 0 ? 1 : 0);
      for (let k = -half; k <= half; k++) a.set(cx + k, base - hgt + j, j % 3 === 0 ? hex("#3d6e48") : hex("#29503a"));
    }
  }
  // 木屋灯光
  for (const [x, y] of [
    [48, 90],
    [50, 90],
    [133, 93],
  ])
    l.set(x, y, WARM);
  a.rect(46, 89, 7, 4, hex("#6b4a2e"));
  a.rect(45, 87, 9, 2, hex("#8a3a2e"));
  return [a, l];
}

function bamboo(): [Canvas, Canvas] {
  const a = new Canvas();
  const l = new Canvas();
  const r = rng(31);
  // 远处的竹影
  for (let x = 0; x < a.w; x += 3 + Math.floor(r() * 4)) a.column(x, 10 + r() * 30, hex("#6f9a72"), 96);
  // 近处的竹子：竹节
  let x = 2;
  while (x < a.w) {
    const w = 2 + Math.floor(r() * 2);
    const top = Math.floor(r() * 10);
    const c = r() < 0.5 ? hex("#5f9a45") : hex("#4c8a3a");
    for (let y = top; y < a.h; y++) for (let k = 0; k < w; k++) a.set(x + k, y, (y + x) % 13 === 0 ? shade(c, 0.6) : k === 0 ? shade(c, 1.2) : c);
    // 竹叶
    for (let n = 0; n < 4; n++) {
      const ly = top + 4 + Math.floor(r() * 40);
      const dir = r() < 0.5 ? -1 : 1;
      for (let k = 1; k < 6; k++) a.set(x + (dir > 0 ? w - 1 + k : -k), ly + Math.floor(k / 2), hex("#3f7a35"));
    }
    x += w + 4 + Math.floor(r() * 9);
  }
  // 地面与石灯笼
  for (let x2 = 0; x2 < a.w; x2++) a.column(x2, 96 + Math.round(Math.sin(x2 * 0.07)), hex("#4a5a36"));
  for (const sx of [36, 150]) {
    a.rect(sx, 88, 5, 8, hex("#9a968c"));
    a.rect(sx - 1, 86, 7, 2, hex("#7e7a72"));
    a.rect(sx + 1, 90, 3, 2, hex("#5a5650"));
    l.set(sx + 2, 90, WARM);
    l.set(sx + 2, 91, WARM);
  }
  return [a, l];
}

function fields(): [Canvas, Canvas] {
  const a = new Canvas();
  const l = new Canvas();
  const r = rng(41);
  for (let x = 0; x < a.w; x++) {
    const far = ridge(x, 60, 8, 1.2, 0.6);
    a.column(x, far, hex("#8fb37a"));
    const near = ridge(x, 72, 6, 4.1, 0.9);
    for (let y = Math.round(near); y < a.h; y++) {
      // 条纹田地：黄绿交替
      const band = Math.floor((x + (y - near) * 2.2) / 14) % 3;
      const c = band === 0 ? hex("#d8b85a") : band === 1 ? hex("#7db35a") : hex("#a8c060");
      a.set(x, y, (y + x) % 5 === 0 ? shade(c, 0.86) : c);
    }
  }
  // 远处的树
  for (let i = 0; i < 14; i++) {
    const cx = Math.floor(r() * a.w);
    const cy = Math.round(ridge(cx, 60, 8, 1.2, 0.6)) - 2;
    for (let k = -3; k <= 3; k++) for (let j = -3; j <= 2; j++) if (k * k + j * j < 10) a.set(cx + k, cy + j, hex("#4f7a45"));
  }
  // 农舍
  const hx = 128;
  const hy = 60;
  a.rect(hx, hy, 12, 7, hex("#e8dcc2"));
  for (let j = 0; j < 5; j++) a.rect(hx - 1 + j, hy - 1 - j, 14 - j * 2, 1, hex("#a83a32"));
  a.rect(hx + 2, hy + 2, 2, 2, hex("#5a4a3a"));
  a.rect(hx + 8, hy + 2, 2, 2, hex("#5a4a3a"));
  l.rect(hx + 2, hy + 2, 2, 2, WARM);
  l.rect(hx + 8, hy + 2, 2, 2, WARM);
  return [a, l];
}

function city(): [Canvas, Canvas] {
  const a = new Canvas();
  const l = new Canvas();
  const r = rng(51);
  // 远处一排浅色楼
  let x = 0;
  while (x < a.w) {
    const w = 8 + Math.floor(r() * 12);
    const top = 40 + Math.floor(r() * 26);
    for (let i = 0; i < w; i++) a.column(x + i, top, hex("#9aa8b8"), 96);
    x += w;
  }
  // 近处的楼：窗格
  x = -4;
  while (x < a.w) {
    const w = 12 + Math.floor(r() * 16);
    const top = 30 + Math.floor(r() * 40);
    const base = [hex("#5d6a7a"), hex("#6f6a66"), hex("#4f5f70"), hex("#7a6e62")][Math.floor(r() * 4)];
    for (let i = 0; i < w; i++) a.column(x + i, top, base, 96);
    for (let i = 0; i < w; i++) a.set(x + i, top, shade(base, 1.25));
    for (let wy = top + 3; wy < 92; wy += 4)
      for (let wx = x + 2; wx < x + w - 2; wx += 3) {
        a.set(wx, wy, hex("#a9c4d8"));
        a.set(wx, wy + 1, hex("#8fb0c8"));
        if (r() < 0.38) {
          l.set(wx, wy, WARM);
          l.set(wx, wy + 1, WARM);
        }
      }
    x += w + 1;
  }
  // 街道与路灯
  a.rect(0, 96, a.w, 12, hex("#3a3d42"));
  for (let sx = 6; sx < a.w; sx += 24) {
    a.rect(sx, 86, 1, 10, hex("#2a2a2e"));
    a.set(sx + 1, 86, hex("#d8d0b0"));
    l.set(sx + 1, 86, [255, 236, 170]);
  }
  for (let sx = 0; sx < a.w; sx += 8) a.rect(sx, 101, 4, 1, hex("#c8c0a0"));
  return [a, l];
}

function forest(): [Canvas, Canvas] {
  const a = new Canvas();
  const l = new Canvas();
  const r = rng(61);
  // 远山
  for (let x = 0; x < a.w; x++) a.column(x, ridge(x, 70, 14, 0.4, 0.7), hex("#7fae6a"));
  // 草地
  for (let x = 0; x < a.w; x++) a.column(x, 84 + Math.round(Math.sin(x * 0.05) * 2), hex("#6aa84f"));
  // 方块树：树干 + 叶冠
  for (let i = 0; i < 9; i++) {
    const cx = 8 + Math.floor((i / 9) * a.w + r() * 12);
    const base = 86;
    const hgt = 16 + Math.floor(r() * 14);
    a.rect(cx - 1, base - hgt, 3, hgt, hex("#5e4128"));
    const cw = 9 + Math.floor(r() * 5);
    for (let y = base - hgt - 9; y < base - hgt + 5; y++)
      for (let x = cx - cw; x <= cx + cw; x++) if (!((x === cx - cw || x === cx + cw) && (y < base - hgt - 6 || y > base - hgt + 2))) a.set(x, y, r() < 0.15 ? hex("#2f5e26") : r() < 0.3 ? hex("#7dbb5a") : hex("#4f8a3c"));
  }
  for (let i = 0; i < 40; i++) a.set(Math.floor(r() * a.w), 88 + Math.floor(r() * 20), hex("#4f8a3c"));
  // 萤火虫
  for (let i = 0; i < 10; i++) l.set(Math.floor(r() * a.w), 76 + Math.floor(r() * 24), [220, 255, 140]);
  return [a, l];
}

const GENERATORS: Partial<Record<SceneryPreset, () => [Canvas, Canvas]>> = { forest, sea, mountains, bamboo, fields, city };

const cache = new Map<SceneryPreset, SceneryArt>();

/** 内置窗景（树林也有一张平面画，在其他窗户换了图片时使用） */
export function presetArt(p: SceneryPreset): SceneryArt | null {
  const gen = GENERATORS[p];
  if (!gen) return null;
  let art = cache.get(p);
  if (!art) {
    const [a, l] = gen();
    art = { url: a.toUrl(), lights: l.toUrl() };
    cache.set(p, art);
  }
  return art;
}

/**
 * 从像素画生成夜灯层：在下半部、较暗的非天空像素里稀疏地挑一些点亮（同一张图结果固定）。
 */
export function lightsFor(data: Uint8ClampedArray, w: number, h: number, density = 0.006): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  const r = rng(w * 7919 + h);
  for (let y = Math.floor(h * 0.35); y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 128) continue;
      const lum = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
      if (lum > 120) continue;
      if (r() < density) {
        out[i] = WARM[0];
        out[i + 1] = WARM[1];
        out[i + 2] = WARM[2];
        out[i + 3] = 255;
      }
    }
  return out;
}
