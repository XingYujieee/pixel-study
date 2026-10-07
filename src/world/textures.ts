// 程序生成的 16×16 像素纹理（全部原创绘制，不使用任何游戏素材）。
import * as THREE from "three";

const N = 16;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

type RGB = [number, number, number];
const hex = (c: string): RGB => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k].map((v) => Math.max(0, Math.min(255, Math.round(v)))) as RGB;

class Pix {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  constructor(
    readonly w = N,
    readonly h = N,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext("2d")!;
  }
  set(x: number, y: number, c: RGB, a = 1) {
    this.ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    this.ctx.fillRect(x, y, 1, 1);
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1) {
    this.ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    this.ctx.fillRect(x, y, w, h);
  }
  noise(base: RGB, amount: number, seed: number) {
    const r = rng(seed);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, shade(base, 1 + (r() - 0.5) * amount));
  }
}

function toTexture(p: Pix, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(p.canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 木板：横向四条，带纹理与钉眼 */
function planks(base: RGB, seed: number): Pix {
  const p = new Pix();
  const r = rng(seed);
  p.noise(base, 0.12, seed);
  for (let row = 0; row < 4; row++) {
    const y0 = row * 4;
    const offset = row % 2 === 0 ? 0 : 8;
    for (let x = 0; x < N; x++) {
      p.set(x, y0 + 3, shade(base, 0.62));
      if (r() < 0.25) p.set(x, y0 + 1, shade(base, 0.88));
    }
    p.set((offset + 15) % N, y0, shade(base, 0.62));
    p.set((offset + 15) % N, y0 + 1, shade(base, 0.62));
    p.set((offset + 15) % N, y0 + 2, shade(base, 0.62));
    p.set((offset + 1) % N, y0 + 1, shade(base, 0.7));
  }
  return p;
}

function stoneBricks(): Pix {
  const p = new Pix();
  const base = hex("#8b8780");
  p.noise(base, 0.14, 7);
  for (let x = 0; x < N; x++) {
    p.set(x, 7, shade(base, 0.6));
    p.set(x, 15, shade(base, 0.6));
    p.set(x, 0, shade(base, 1.12));
    p.set(x, 8, shade(base, 1.12));
  }
  for (let y = 0; y < 7; y++) p.set(7, y, shade(base, 0.6));
  for (let y = 8; y < 15; y++) p.set(15, y, shade(base, 0.6));
  return p;
}

function plaster(): Pix {
  const p = new Pix();
  p.noise(hex("#e6dac4"), 0.05, 11);
  const r = rng(12);
  for (let i = 0; i < 6; i++) p.set(Math.floor(r() * N), Math.floor(r() * N), hex("#d4c6ac"));
  return p;
}

function log(): Pix {
  const p = new Pix();
  const base = hex("#5e4128");
  p.noise(base, 0.15, 21);
  const r = rng(22);
  for (let x = 0; x < N; x += 3) for (let y = 0; y < N; y++) if (r() < 0.7) p.set(x, y, shade(base, 0.7));
  for (let x = 0; x < N; x++) {
    if (r() < 0.3) p.set(x, Math.floor(r() * N), shade(base, 1.25));
  }
  return p;
}

function glass(): Pix {
  const p = new Pix();
  p.rect(0, 0, N, N, hex("#cfe8f2"), 0.18);
  const frame = hex("#f2f2ee");
  for (let i = 0; i < N; i++) {
    p.set(i, 0, frame);
    p.set(i, N - 1, frame);
    p.set(0, i, frame);
    p.set(N - 1, i, frame);
  }
  for (let i = 3; i < 7; i++) p.set(i, i - 1, hex("#ffffff"), 0.7);
  p.set(4, 2, hex("#ffffff"), 0.7);
  return p;
}

function windowFrame(): Pix {
  const p = new Pix();
  p.noise(hex("#6b4a2e"), 0.1, 31);
  return p;
}

/** 书架侧板（深色木框） */
function shelfWood(): Pix {
  return planks(hex("#7a5434"), 41);
}

/** 书桌桌面：深色木纹 + 皮革垫 */
function deskTop(): Pix {
  const p = planks(hex("#6e4a2c"), 51);
  p.rect(3, 3, 10, 9, hex("#3f5b4a"));
  p.rect(4, 4, 8, 7, hex("#4a6a56"));
  for (let x = 3; x < 13; x++) p.set(x, 3, hex("#c9a45a"));
  return p;
}

/** 工作台顶：九宫格纹样，原创图案 */
function workbenchTop(): Pix {
  const p = planks(hex("#a8743f"), 61);
  const line = hex("#5c3b1d");
  for (let i = 1; i < 15; i++) {
    p.set(i, 1, line);
    p.set(i, 14, line);
    p.set(1, i, line);
    p.set(14, i, line);
    p.set(i, 5, line);
    p.set(i, 10, line);
    p.set(5, i, line);
    p.set(10, i, line);
  }
  return p;
}

/** 工作台侧面：挂着的锯子与锤子剪影 */
function workbenchSide(): Pix {
  const p = planks(hex("#9a6a3a"), 62);
  const iron = hex("#b9b9b4");
  const handle = hex("#4a2f18");
  // 锤子
  p.rect(2, 3, 5, 2, iron);
  p.rect(4, 5, 1, 7, handle);
  // 锯子
  p.rect(9, 4, 5, 5, iron);
  for (let x = 9; x < 14; x += 2) p.set(x, 9, iron);
  p.rect(13, 3, 2, 3, handle);
  return p;
}

/** AI 工作台侧面：深色石材与青色电路纹（原创图案） */
function aiSide(): Pix {
  const p = new Pix();
  p.noise(hex("#2f2b3a"), 0.18, 141);
  const line = hex("#3fd6c9");
  const dim = hex("#1f7d77");
  for (let x = 2; x < 14; x++) p.set(x, 4, dim);
  for (let y = 4; y < 12; y++) p.set(3, y, dim);
  for (let x = 3; x < 12; x++) p.set(x, 11, dim);
  for (let y = 7; y < 12; y++) p.set(11, y, dim);
  p.set(3, 4, line);
  p.set(11, 7, line);
  p.set(7, 11, line);
  p.set(13, 4, line);
  for (let x = 0; x < N; x++) {
    p.set(x, 0, hex("#4a4458"));
    p.set(x, 15, hex("#1a1822"));
  }
  return p;
}

function aiTop(): Pix {
  const p = new Pix();
  p.noise(hex("#3a3548"), 0.12, 142);
  const ring = hex("#3fd6c9");
  for (let i = 4; i < 12; i++) {
    p.set(i, 4, ring);
    p.set(i, 11, ring);
    p.set(4, i, ring);
    p.set(11, i, ring);
  }
  p.rect(6, 6, 4, 4, hex("#9ff5ec"));
  return p;
}

/** 悬浮晶体 */
function crystal(): Pix {
  const p = new Pix();
  p.noise(hex("#5fe3d6"), 0.25, 143);
  p.rect(3, 3, 10, 10, hex("#a9fff6"));
  p.rect(6, 6, 4, 4, hex("#ffffff"));
  for (let i = 0; i < N; i++) {
    p.set(i, 0, hex("#2aa69b"));
    p.set(0, i, hex("#2aa69b"));
  }
  return p;
}

function chestFront(): Pix {
  const p = planks(hex("#8f5d2e"), 71);
  const band = hex("#3a2a1c");
  for (let x = 0; x < N; x++) {
    p.set(x, 0, band);
    p.set(x, 15, band);
    p.set(x, 6, band);
  }
  for (let y = 0; y < N; y++) {
    p.set(0, y, band);
    p.set(15, y, band);
  }
  p.rect(7, 5, 2, 4, hex("#d9c27a"));
  p.set(7, 7, hex("#3a2a1c"));
  return p;
}

function chestTop(): Pix {
  const p = planks(hex("#8f5d2e"), 72);
  const band = hex("#3a2a1c");
  for (let i = 0; i < N; i++) {
    p.set(i, 0, band);
    p.set(i, 15, band);
    p.set(0, i, band);
    p.set(15, i, band);
  }
  return p;
}

function lantern(): Pix {
  const p = new Pix();
  const iron = hex("#34302c");
  p.rect(0, 0, N, N, iron);
  p.rect(3, 3, 10, 10, hex("#ffcf6e"));
  p.rect(5, 5, 6, 6, hex("#fff1c4"));
  for (let i = 3; i < 13; i++) {
    p.set(7, i, iron);
    p.set(i, 7, iron);
  }
  return p;
}

function leaves(): Pix {
  const p = new Pix();
  p.noise(hex("#4f8a3c"), 0.3, 81);
  const r = rng(82);
  for (let i = 0; i < 30; i++) p.set(Math.floor(r() * N), Math.floor(r() * N), hex("#2f5e26"));
  for (let i = 0; i < 12; i++) p.set(Math.floor(r() * N), Math.floor(r() * N), hex("#7dbb5a"));
  return p;
}

function terracotta(): Pix {
  const p = new Pix();
  p.noise(hex("#b5653f"), 0.1, 91);
  for (let x = 0; x < N; x++) {
    p.set(x, 0, hex("#d0835a"));
    p.set(x, 1, hex("#d0835a"));
  }
  return p;
}

/** 水面：深浅蓝色波纹（可平铺，运行时平移做流动） */
function water(): Pix {
  const p = new Pix();
  p.noise(hex("#2f6fb0"), 0.1, 141);
  const light = hex("#5b9bd8");
  const dark = hex("#245a94");
  for (let y = 0; y < N; y += 4)
    for (let x = 0; x < N; x++) {
      const k = (x + (y >> 2) * 5) % 8;
      if (k < 3) p.set(x, y + ((x >> 2) % 2), light);
      if (k === 5) p.set(x, (y + 2) % N, dark);
    }
  return p;
}

/** 睡莲叶：圆形绿叶，缺一个口（透明背景） */
function lilyPad(): Pix {
  const p = new Pix();
  const g = hex("#4f9a3c");
  const d = hex("#3a7a2c");
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = x - 7.5,
        dy = y - 7.5;
      if (dx * dx + dy * dy > 49) continue;
      if (x >= 8 && y >= 6 && y <= 9 && x - 8 >= Math.abs(y - 7.5) * 1.6) continue;
      p.set(x, y, (x + y) % 5 === 0 ? d : g);
    }
  return p;
}

/** 地毯：按氛围换底色，金色边与菱形 */
function carpet(base = "#8c2f2a", trim = "#d8a64a"): Pix {
  const p = new Pix();
  p.noise(hex(base), 0.08, 101);
  const gold = hex(trim);
  for (let i = 0; i < N; i++) {
    p.set(i, 1, gold);
    p.set(i, 14, gold);
    p.set(1, i, gold);
    p.set(14, i, gold);
  }
  for (let i = 0; i < 4; i++) {
    p.set(7 - i, 4 + i, gold);
    p.set(8 + i, 4 + i, gold);
    p.set(7 - i, 11 - i, gold);
    p.set(8 + i, 11 - i, gold);
  }
  return p;
}

function grassTop(): Pix {
  const p = new Pix();
  p.noise(hex("#6aa84f"), 0.22, 111);
  return p;
}

function bark(): Pix {
  return log();
}

/** 书脊：白底（实例颜色相乘），上下烫金线 */
function bookSpine(): Pix {
  const p = new Pix(8, 16);
  p.noise(hex("#ffffff"), 0.08, 121);
  const band = hex("#e8d8a0");
  for (let x = 0; x < 8; x++) {
    p.set(x, 2, band);
    p.set(x, 13, band);
  }
  for (let y = 0; y < 16; y++) {
    p.set(0, y, hex("#cccccc"));
  }
  return p;
}

/** 书页（书的顶部与侧面） */
function pages(): Pix {
  const p = new Pix();
  p.noise(hex("#efe4c8"), 0.05, 131);
  for (let y = 0; y < N; y += 2) for (let x = 0; x < N; x++) p.set(x, y, hex("#ddd0b0"));
  return p;
}

/** 摊开的书（书桌上） */
function openBook(): Pix {
  const p = new Pix(32, 16);
  p.rect(0, 0, 32, 16, hex("#6b3a26"));
  p.rect(1, 1, 14, 14, hex("#f3e9d2"));
  p.rect(17, 1, 14, 14, hex("#f3e9d2"));
  const ink = hex("#8a7a60");
  for (let y = 3; y < 14; y += 2) {
    for (let x = 3; x < 13; x++) if ((x + y) % 7 !== 0) p.set(x, y, ink);
    for (let x = 19; x < 29; x++) if ((x * 3 + y) % 9 !== 0) p.set(x, y, ink);
  }
  return p;
}

/** 窗外天空：竖向渐变 + 几朵方块云 */
export function skyTexture(): THREE.CanvasTexture {
  const p = new Pix(64, 64);
  for (let y = 0; y < 64; y++) {
    const t = y / 63;
    const c: RGB = [Math.round(120 + 90 * t), Math.round(170 + 60 * t), Math.round(235 - 10 * t)];
    p.rect(0, y, 64, 1, c);
  }
  const white = hex("#ffffff");
  p.rect(6, 14, 14, 3, white, 0.9);
  p.rect(9, 12, 8, 2, white, 0.9);
  p.rect(36, 22, 18, 3, white, 0.85);
  p.rect(40, 20, 9, 2, white, 0.85);
  const t = toTexture(p);
  t.magFilter = THREE.LinearFilter;
  return t;
}

// ───────────── 屋子主题用的纹理 ─────────────

/** 刷白的墙 */
function whiteWall(): Pix {
  const p = new Pix();
  p.noise(hex("#f1efe9"), 0.03, 201);
  const r = rng(202);
  for (let i = 0; i < 4; i++) p.set(Math.floor(r() * N), Math.floor(r() * N), hex("#e3e0d8"));
  return p;
}

/** 横向圆木墙：每 4 像素一根原木，上下有暗缝 */
function logWall(): Pix {
  const p = new Pix();
  const base = hex("#8a5a32");
  p.noise(base, 0.12, 211);
  for (let row = 0; row < 4; row++) {
    const y0 = row * 4;
    for (let x = 0; x < N; x++) {
      p.set(x, y0, shade(base, 1.18));
      p.set(x, y0 + 3, shade(base, 0.55));
    }
    p.set((row * 5 + 3) % N, y0 + 1, shade(base, 0.7));
    p.set((row * 5 + 4) % N, y0 + 2, shade(base, 0.7));
  }
  return p;
}

/** 碎石地面 */
function cobble(base: RGB, seed: number): Pix {
  const p = new Pix();
  p.noise(base, 0.1, seed);
  const r = rng(seed + 1);
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(r() * 13);
    const y = Math.floor(r() * 13);
    const w = 3 + Math.floor(r() * 3);
    const h = 2 + Math.floor(r() * 3);
    p.rect(x, y, w, h, shade(base, 0.85 + r() * 0.35));
    for (let k = 0; k < w; k++) p.set(x + k, y + h, shade(base, 0.55));
  }
  return p;
}

/** 深色地窖砖墙 */
function cellarBricks(): Pix {
  const p = new Pix();
  const base = hex("#5a4a42");
  p.noise(base, 0.16, 221);
  for (let row = 0; row < 4; row++) {
    const y0 = row * 4;
    for (let x = 0; x < N; x++) p.set(x, y0 + 3, shade(base, 0.5));
    const off = row % 2 ? 4 : 0;
    for (let x = off; x < N; x += 8) for (let y = y0; y < y0 + 3; y++) p.set(x, y, shade(base, 0.5));
  }
  return p;
}

/** 灯塔墙：刷白石块，底部一条蓝 */
function lighthouseWall(): Pix {
  const p = new Pix();
  const base = hex("#e9e6df");
  p.noise(base, 0.05, 231);
  for (let x = 0; x < N; x++) {
    p.set(x, 7, shade(base, 0.86));
    p.set(x, 15, shade(base, 0.86));
  }
  for (let y = 0; y < 7; y++) p.set(5, y, shade(base, 0.86));
  for (let y = 8; y < 15; y++) p.set(12, y, shade(base, 0.86));
  return p;
}

function lighthouseLower(): Pix {
  const p = new Pix();
  const base = hex("#3d6c94");
  p.noise(base, 0.08, 232);
  for (let x = 0; x < N; x++) p.set(x, 0, hex("#e9e6df"));
  for (let x = 0; x < N; x += 4) p.set(x, 8, shade(base, 0.8));
  return p;
}

/** 甲板式木地板（偏灰） */
function deckPlanks(): Pix {
  return planks(hex("#a48f74"), 241);
}

/** 榻榻米：草绿编织纹 + 深色包边 */
function tatami(): Pix {
  const p = new Pix();
  const base = hex("#b9b878");
  p.noise(base, 0.06, 251);
  for (let y = 0; y < N; y += 2) for (let x = 0; x < N; x++) p.set(x, y, shade(base, 0.92));
  for (let x = 0; x < N; x++) {
    p.set(x, 0, hex("#3a3a2a"));
    p.set(x, 1, hex("#4a4a36"));
  }
  return p;
}

/** 和室墙：浅土色 */
function clayWall(): Pix {
  const p = new Pix();
  p.noise(hex("#d9c9a8"), 0.06, 261);
  return p;
}

/** 障子纸窗：白纸 + 木格（半透明） */
function shoji(): Pix {
  const p = new Pix();
  p.rect(0, 0, N, N, hex("#f6f1e4"), 0.42);
  const wood = hex("#6b4c30");
  for (let i = 0; i < N; i++) {
    p.set(i, 0, wood);
    p.set(i, 15, wood);
    p.set(0, i, wood);
    p.set(15, i, wood);
    p.set(i, 7, wood);
    p.set(7, i, wood);
  }
  return p;
}

/** 浅色橡木地板 */
function lightOak(): Pix {
  return planks(hex("#d2b48a"), 271);
}

/** 火焰（壁炉）：橙黄交错 */
function fire(): Pix {
  const p = new Pix();
  const r = rng(281);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const k = y / N + (r() - 0.5) * 0.35;
      const c = k > 0.75 ? "#ffe9a0" : k > 0.5 ? "#ffb347" : k > 0.28 ? "#e8622c" : null;
      if (c) p.set(x, y, hex(c));
    }
  return p;
}

/** 黑板 */
function chalkboard(): Pix {
  const p = new Pix();
  p.noise(hex("#2f4a3a"), 0.08, 291);
  return p;
}

export interface RoomTextureSet {
  whiteWall: THREE.Texture;
  logWall: THREE.Texture;
  stoneFloor: THREE.Texture;
  darkCobble: THREE.Texture;
  cellarBricks: THREE.Texture;
  lighthouseWall: THREE.Texture;
  lighthouseLower: THREE.Texture;
  deckPlanks: THREE.Texture;
  tatami: THREE.Texture;
  clayWall: THREE.Texture;
  shoji: THREE.Texture;
  lightOak: THREE.Texture;
  whitePlanks: THREE.Texture;
  fire: THREE.Texture;
  chalkboard: THREE.Texture;
}

let roomCache: RoomTextureSet | null = null;

export function roomTextures(): RoomTextureSet {
  if (roomCache) return roomCache;
  roomCache = {
    whiteWall: toTexture(whiteWall(), true),
    logWall: toTexture(logWall(), true),
    stoneFloor: toTexture(cobble(hex("#8a8680"), 301), true),
    darkCobble: toTexture(cobble(hex("#4e4642"), 302), true),
    cellarBricks: toTexture(cellarBricks(), true),
    lighthouseWall: toTexture(lighthouseWall(), true),
    lighthouseLower: toTexture(lighthouseLower(), true),
    deckPlanks: toTexture(deckPlanks(), true),
    tatami: toTexture(tatami(), true),
    clayWall: toTexture(clayWall(), true),
    shoji: toTexture(shoji()),
    lightOak: toTexture(lightOak(), true),
    whitePlanks: toTexture(planks(hex("#e6e2da"), 311), true),
    fire: toTexture(fire(), true),
    chalkboard: toTexture(chalkboard(), true),
  };
  return roomCache;
}

export interface TextureSet {
  planks: THREE.Texture;
  darkPlanks: THREE.Texture;
  stoneBricks: THREE.Texture;
  plaster: THREE.Texture;
  log: THREE.Texture;
  glass: THREE.Texture;
  windowFrame: THREE.Texture;
  shelfWood: THREE.Texture;
  shelfWoodLight: THREE.Texture;
  shelfWoodDark: THREE.Texture;
  deskTop: THREE.Texture;
  workbenchTop: THREE.Texture;
  workbenchSide: THREE.Texture;
  chestFront: THREE.Texture;
  aiSide: THREE.Texture;
  aiTop: THREE.Texture;
  crystal: THREE.Texture;
  chestTop: THREE.Texture;
  lantern: THREE.Texture;
  leaves: THREE.Texture;
  terracotta: THREE.Texture;
  carpet: THREE.Texture;
  carpetRain: THREE.Texture;
  carpetFire: THREE.Texture;
  carpetNight: THREE.Texture;
  water: THREE.Texture;
  lilyPad: THREE.Texture;
  grass: THREE.Texture;
  bark: THREE.Texture;
  bookSpine: THREE.Texture;
  pages: THREE.Texture;
  openBook: THREE.Texture;
}

let cache: TextureSet | null = null;

export function textures(): TextureSet {
  if (cache) return cache;
  cache = {
    planks: toTexture(planks(hex("#b4834e"), 1), true),
    darkPlanks: toTexture(planks(hex("#5a3c24"), 2), true),
    stoneBricks: toTexture(stoneBricks(), true),
    plaster: toTexture(plaster(), true),
    log: toTexture(log(), true),
    glass: toTexture(glass()),
    windowFrame: toTexture(windowFrame()),
    shelfWood: toTexture(shelfWood()),
    shelfWoodLight: toTexture(planks(hex("#b98a55"), 42)),
    shelfWoodDark: toTexture(planks(hex("#4e3421"), 43)),
    deskTop: toTexture(deskTop()),
    workbenchTop: toTexture(workbenchTop()),
    workbenchSide: toTexture(workbenchSide()),
    chestFront: toTexture(chestFront()),
    aiSide: toTexture(aiSide()),
    aiTop: toTexture(aiTop()),
    crystal: toTexture(crystal()),
    chestTop: toTexture(chestTop()),
    lantern: toTexture(lantern()),
    leaves: toTexture(leaves()),
    terracotta: toTexture(terracotta()),
    carpet: toTexture(carpet()),
    carpetRain: toTexture(carpet("#2f5a7a", "#9fc6dc")),
    carpetFire: toTexture(carpet("#a4532a", "#f0c060")),
    carpetNight: toTexture(carpet("#2a2d55", "#c8b8f0")),
    water: toTexture(water(), true),
    lilyPad: toTexture(lilyPad()),
    grass: toTexture(grassTop(), true),
    bark: toTexture(bark()),
    bookSpine: toTexture(bookSpine()),
    pages: toTexture(pages()),
    openBook: toTexture(openBook()),
  };
  return cache;
}

/** 书脊配色：按文件类型分组的暖色调 */
export const BOOK_COLORS: Record<"markdown" | "text" | "word" | "other", string[]> = {
  markdown: ["#a83a32", "#c27a28", "#4f7a45", "#3d5f8f", "#7c4a7a", "#a85a32", "#5f6b2e", "#8f3a52", "#2f6b6b"],
  text: ["#d9ccb0", "#c9bb98", "#e2d6bc"],
  word: ["#2c5a9e", "#23497f", "#3a6db5"],
  other: ["#6e6e72", "#80665a", "#5d6670"],
};
