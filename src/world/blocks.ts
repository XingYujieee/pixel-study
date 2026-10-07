// 屋外方块的 16×16 像素纹理（程序生成、全部原创）：草方块、泥土、石头、沙子、雪、田地、庄稼、花草、楼房……
import * as THREE from "three";

const N = 16;
type RGB = [number, number, number];
const hex = (c: string): RGB => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const shade = (c: RGB, k: number): RGB => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))) as RGB;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

class Pix {
  readonly canvas = document.createElement("canvas");
  readonly g: CanvasRenderingContext2D;
  constructor(
    readonly w = N,
    readonly h = N,
  ) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = this.canvas.getContext("2d")!;
  }
  set(x: number, y: number, c: RGB, a = 1) {
    this.g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    this.g.fillRect(x, y, 1, 1);
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1) {
    this.g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    this.g.fillRect(x, y, w, h);
  }
  noise(base: RGB, amount: number, seed: number, y0 = 0, y1 = this.h) {
    const r = rng(seed);
    for (let y = y0; y < y1; y++) for (let x = 0; x < this.w; x++) this.set(x, y, shade(base, 1 + (r() - 0.5) * amount));
  }
  tex(repeat = true): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(this.canvas);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapNearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
}

const GRASS = hex("#6aa84f");
const DIRT = hex("#866043");

function grassTop() {
  const p = new Pix();
  p.noise(GRASS, 0.26, 201);
  const r = rng(202);
  for (let i = 0; i < 18; i++) p.set(Math.floor(r() * N), Math.floor(r() * N), hex("#88c063"));
  return p;
}
function dirt(seed = 211) {
  const p = new Pix();
  p.noise(DIRT, 0.25, seed);
  const r = rng(seed + 1);
  for (let i = 0; i < 10; i++) p.set(Math.floor(r() * N), Math.floor(r() * N), hex("#5e4330"));
  for (let i = 0; i < 6; i++) p.set(Math.floor(r() * N), Math.floor(r() * N), hex("#a07a58"));
  return p;
}
function grassSide() {
  const p = dirt(221);
  const r = rng(222);
  p.noise(GRASS, 0.25, 223, 0, 3);
  for (let x = 0; x < N; x++) if (r() < 0.55) p.rect(x, 3, 1, 1 + Math.floor(r() * 2), shade(GRASS, 0.9 + r() * 0.2));
  return p;
}
function stone(seed = 231) {
  const p = new Pix();
  p.noise(hex("#8a8a88"), 0.18, seed);
  const r = rng(seed + 1);
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(r() * 13),
      y = Math.floor(r() * 14);
    p.rect(x, y, 2 + Math.floor(r() * 3), 1, hex("#6e6e6c"));
  }
  return p;
}
function sand() {
  const p = new Pix();
  p.noise(hex("#dccb93"), 0.12, 241);
  const r = rng(242);
  for (let i = 0; i < 14; i++) p.set(Math.floor(r() * N), Math.floor(r() * N), hex("#c4b07a"));
  return p;
}
function snowTop() {
  const p = new Pix();
  p.noise(hex("#f2f6fa"), 0.06, 251);
  return p;
}
function snowSide() {
  const p = stone(261);
  p.noise(hex("#f2f6fa"), 0.06, 262, 0, 4);
  const r = rng(263);
  for (let x = 0; x < N; x++) if (r() < 0.5) p.set(x, 4, hex("#e2e8ee"));
  return p;
}
function gravel() {
  const p = new Pix();
  p.noise(hex("#a29a8c"), 0.22, 271);
  const r = rng(272);
  for (let i = 0; i < 26; i++) p.rect(Math.floor(r() * 15), Math.floor(r() * 15), 2, 1 + Math.floor(r() * 2), shade(hex("#8e877a"), 0.8 + r() * 0.5));
  return p;
}
function farmland() {
  const p = new Pix();
  p.noise(hex("#5b3d27"), 0.18, 281);
  for (let y = 1; y < N; y += 4) for (let x = 0; x < N; x++) p.set(x, y, hex("#3f2a1b"));
  return p;
}
function asphalt() {
  const p = new Pix();
  p.noise(hex("#45474c"), 0.14, 291);
  return p;
}
function moss() {
  const p = new Pix();
  p.noise(hex("#4f7a3a"), 0.3, 301);
  const r = rng(302);
  for (let i = 0; i < 14; i++) p.set(Math.floor(r() * N), Math.floor(r() * N), hex("#6f9a4a"));
  return p;
}
function hayTop() {
  const p = new Pix();
  p.noise(hex("#c9a63a"), 0.2, 311);
  for (let i = 0; i < N; i++) {
    p.set(i, 7, hex("#8a5a2a"));
    p.set(7, i, hex("#8a5a2a"));
  }
  return p;
}
function haySide() {
  const p = new Pix();
  p.noise(hex("#c9a63a"), 0.2, 321);
  const r = rng(322);
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (r() < 0.12) p.set(x, y, hex("#a8862a"));
  for (const y of [3, 12]) for (let x = 0; x < N; x++) p.set(x, y, hex("#8a3a2a"));
  return p;
}
function logTop() {
  const p = new Pix();
  p.noise(hex("#6b4a2e"), 0.1, 331);
  for (let k = 0; k < 3; k++) {
    const r = 6 - k * 2;
    for (let a = 0; a < 40; a++) p.set(Math.round(7.5 + Math.cos(a / 6.4) * r), Math.round(7.5 + Math.sin(a / 6.4) * r), hex("#a07a4a"));
  }
  for (let i = 0; i < N; i++) {
    p.set(i, 0, hex("#4a3220"));
    p.set(i, 15, hex("#4a3220"));
    p.set(0, i, hex("#4a3220"));
    p.set(15, i, hex("#4a3220"));
  }
  return p;
}
function spruceLeaves() {
  const p = new Pix();
  p.noise(hex("#2f5236"), 0.3, 341);
  const r = rng(342);
  for (let i = 0; i < 20; i++) p.set(Math.floor(r() * N), Math.floor(r() * N), hex("#1e3a26"));
  return p;
}
function bamboo() {
  const p = new Pix();
  p.noise(hex("#5f9a45"), 0.12, 351);
  for (let y = 0; y < N; y++) p.set(2, y, hex("#7fbb5a"));
  for (let x = 0; x < N; x++) p.set(x, 11, hex("#3f6a2c"));
  return p;
}
function roof() {
  const p = new Pix();
  p.noise(hex("#7a3b2e"), 0.14, 361);
  for (let y = 3; y < N; y += 4) for (let x = 0; x < N; x++) p.set(x, y, hex("#552820"));
  for (let y = 0; y < N; y += 4) for (let x = (y / 4) % 2 === 0 ? 3 : 7; x < N; x += 8) p.rect(x, y, 1, 3, hex("#552820"));
  return p;
}
function fenceWood() {
  const p = new Pix();
  p.noise(hex("#9c7448"), 0.14, 371);
  for (let y = 0; y < N; y += 5) for (let x = 0; x < N; x++) p.set(x, y, hex("#7a5634"));
  return p;
}
function cobble() {
  const p = new Pix();
  p.noise(hex("#7d7b78"), 0.1, 381);
  const r = rng(382);
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(r() * 13),
      y = Math.floor(r() * 13);
    const w = 3 + Math.floor(r() * 3),
      h = 2 + Math.floor(r() * 3);
    p.rect(x, y, w, h, shade(hex("#8f8d8a"), 0.85 + r() * 0.35));
    for (let k = 0; k < w; k++) p.set(x + k, y + h, hex("#545250"));
  }
  return p;
}
/** 楼房外墙：窗格 + 对应的夜间亮灯层 */
function facade(base: RGB, seed: number): [Pix, Pix] {
  const p = new Pix();
  const l = new Pix();
  p.noise(base, 0.08, seed);
  const r = rng(seed + 1);
  for (const [x, y] of [
    [2, 2],
    [9, 2],
    [2, 9],
    [9, 9],
  ]) {
    p.rect(x, y, 5, 5, hex("#2c3a48"));
    p.rect(x + 1, y + 1, 3, 3, hex("#7da0bc"));
    p.set(x + 1, y + 1, hex("#c8dcea"));
    if (r() < 0.55) l.rect(x + 1, y + 1, 3, 3, hex("#ffd27a"));
  }
  return [p, l];
}
function lanternBlock() {
  const p = new Pix();
  p.rect(0, 0, N, N, hex("#3a3330"));
  p.rect(3, 3, 10, 10, hex("#ffcf6a"));
  p.rect(5, 5, 6, 6, hex("#fff1c4"));
  for (let i = 3; i < 13; i++) {
    p.set(7, i, hex("#3a3330"));
    p.set(i, 7, hex("#3a3330"));
  }
  return p;
}

/** 十字形的植物贴图（透明背景） */
function plant(kind: "tallgrass" | "flower" | "wheat", variant = 0) {
  const p = new Pix();
  const r = rng(400 + variant * 13 + kind.length);
  if (kind === "tallgrass") {
    for (let i = 0; i < 9; i++) {
      const x = 1 + Math.floor(r() * 14);
      const top = 3 + Math.floor(r() * 8);
      for (let y = top; y < N; y++) p.set(x + (y < top + 3 && r() < 0.4 ? 1 : 0), y, shade(GRASS, 0.8 + r() * 0.4));
    }
  } else if (kind === "wheat") {
    const ripe = [hex("#d8b850"), hex("#b7c24a"), hex("#8ab048")][variant % 3];
    for (const x of [2, 5, 8, 11, 13]) {
      const top = 3 + Math.floor(r() * 4);
      for (let y = top; y < N; y++) p.set(x, y, y < top + 4 ? ripe : hex("#7a9a3a"));
      p.set(x - 1, top + 1, ripe);
      p.set(x + 1, top + 2, ripe);
    }
  } else {
    const petals = [hex("#e04848"), hex("#f2d040"), hex("#6a8af0"), hex("#f4f4f4")][variant % 4];
    for (let y = 7; y < N; y++) p.set(7, y, hex("#3f7a35"));
    p.set(6, 11, hex("#4f9a3c"));
    p.set(8, 12, hex("#4f9a3c"));
    p.rect(6, 3, 3, 3, petals);
    p.set(7, 2, petals);
    p.set(5, 4, petals);
    p.set(9, 4, petals);
    p.set(7, 6, petals);
    p.set(7, 4, hex("#f8e070"));
  }
  return p;
}

export interface BlockTextures {
  grassTop: THREE.Texture;
  grassSide: THREE.Texture;
  dirt: THREE.Texture;
  stone: THREE.Texture;
  sand: THREE.Texture;
  snowTop: THREE.Texture;
  snowSide: THREE.Texture;
  gravel: THREE.Texture;
  farmland: THREE.Texture;
  asphalt: THREE.Texture;
  moss: THREE.Texture;
  hayTop: THREE.Texture;
  haySide: THREE.Texture;
  logTop: THREE.Texture;
  spruceLeaves: THREE.Texture;
  bamboo: THREE.Texture;
  roof: THREE.Texture;
  fence: THREE.Texture;
  cobble: THREE.Texture;
  lantern: THREE.Texture;
  facades: THREE.Texture[];
  facadeLights: THREE.Texture[];
  tallgrass: THREE.Texture;
  flowers: THREE.Texture[];
  wheat: THREE.Texture[];
}

let cache: BlockTextures | null = null;

export function blockTextures(): BlockTextures {
  if (cache) return cache;
  const fac = [
    facade(hex("#b8a890"), 501),
    facade(hex("#8f9aa8"), 502),
    facade(hex("#a07a62"), 503),
    facade(hex("#c8c4bc"), 504),
  ];
  cache = {
    grassTop: grassTop().tex(),
    grassSide: grassSide().tex(),
    dirt: dirt().tex(),
    stone: stone().tex(),
    sand: sand().tex(),
    snowTop: snowTop().tex(),
    snowSide: snowSide().tex(),
    gravel: gravel().tex(),
    farmland: farmland().tex(),
    asphalt: asphalt().tex(),
    moss: moss().tex(),
    hayTop: hayTop().tex(),
    haySide: haySide().tex(),
    logTop: logTop().tex(),
    spruceLeaves: spruceLeaves().tex(),
    bamboo: bamboo().tex(),
    roof: roof().tex(),
    fence: fenceWood().tex(),
    cobble: cobble().tex(),
    lantern: lanternBlock().tex(),
    facades: fac.map(([p]) => p.tex()),
    facadeLights: fac.map(([, l]) => l.tex()),
    tallgrass: plant("tallgrass").tex(false),
    flowers: [0, 1, 2, 3].map((v) => plant("flower", v).tex(false)),
    wheat: [0, 1, 2].map((v) => plant("wheat", v).tex(false)),
  };
  return cache;
}
