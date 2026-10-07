// 屋外的院子：围栏围起来的一块地（不是无限世界），南边是花园。
// 这里是纯数据与规则：院子范围、花园里的方块、每个格子的高度（能不能走上去、跳上去），以及玩家的移动与落地。
import { ROOM, SPECS, cellsOf, type Layout } from "./layout";
import type { GardenBlock, GardenKind } from "./garden";

/** 院子里能走的范围：x ∈ [x0, x1)、z ∈ [z0, z1)。外面一圈是围栏。屋子占 x -1..14、z -1..12（含墙）。 */
export const YARD = { x0: -6, x1: 20, z0: -5, z1: 27 } as const;

/** 门：南墙 x = 6、7 两格，3 格高 */
export const DOOR = { x0: 6, x1: 8, z: ROOM.d, h: 3 } as const;

/** 墙、围栏、树干这类不能翻越的高度 */
export const WALL = 99;

/** 自动迈上去的高度（台阶、花坛） */
export const STEP = 0.55;

/** 起跳速度与重力：最高能跳约 1.2 格，刚好跳上一格高的桌子 */
export const JUMP_V = 7.6;
export const GRAVITY = 24;

export const PLAYER_RADIUS = 0.3;
export const PLAYER_HEIGHT = 1.8;

export type { GardenBlock, GardenKind } from "./garden";

/** 家具的碰撞高度（与模型高度一致；鱼塘做成能踩的矮台） */
export function furnitureTop(type: keyof typeof SPECS): number {
  if (type === "pond") return 0.45;
  if (type === "plant") return 0.9;
  return SPECS[type].h;
}

/** 门前的小路（不能在上面种东西） */
export function isPath(x: number, z: number): boolean {
  return x >= DOOR.x0 && x < DOOR.x1 && z > ROOM.d && z < YARD.z1;
}

/** 屋子（含墙）占的格子 */
export function inHouse(x: number, z: number): boolean {
  return x >= -1 && x <= ROOM.w && z >= -1 && z <= ROOM.d;
}

/**
 * 默认花园：花坛、菜地、草垛（可以跳上去）、长椅、野餐桌、树、柴堆、灌木、路灯、井，
 * 再撒一些野花和杂草（都可以让管家除掉）。
 */
export function defaultGarden(): GardenBlock[] {
  const out: GardenBlock[] = [];
  const add = (kind: GardenKind, x: number, z: number, h: number, variant?: number) => out.push(variant === undefined ? { kind, x, z, h } : { kind, x, z, h, variant });
  // 两块抬高的花坛（半格高，直接走上去）
  for (let x = 1; x <= 3; x++) for (let z = 15; z <= 17; z++) add("bed", x, z, 0.5, (x * 7 + z * 3) % 4);
  for (let x = 10; x <= 12; x++) for (let z = 15; z <= 17; z++) add("bed", x, z, 0.5, (x * 7 + z * 3) % 4);
  // 菜地：齐平，可以穿过
  for (let x = 13; x <= 17; x++) for (let z = 20; z <= 24; z++) add("farmland", x, z, 0, (x + z) % 3);
  // 草垛：一格、两格高，可以一级级跳上去
  add("hay", -2, 21, 1);
  add("hay", -1, 21, 1);
  add("hay", -2, 22, 2);
  add("hay", -1, 22, 1);
  add("hay", -2, 23, 1);
  // 长椅（半格）与野餐桌（一格）
  add("bench", 9, 22, 0.5);
  add("bench", 10, 22, 0.5);
  add("table", 2, 21, 1);
  add("table", 3, 21, 1);
  // 树干（树冠在上面，不挡路）
  add("trunk", -3, 16, WALL);
  add("trunk", 17, 15, WALL);
  add("trunk", 16, -3, WALL);
  // 屋后的柴堆
  for (let x = 4; x <= 6; x++) add("woodpile", x, -4, 1);
  add("woodpile", 7, -4, 2);
  // 灌木（一格高的叶子方块）
  for (const [x, z] of [
    [-5, 1],
    [-5, 2],
    [-5, 9],
    [19, 5],
    [19, 6],
    [-4, -4],
    [19, 11],
    [-5, 25],
    [19, 25],
  ])
    add("bush", x, z, 1);
  // 路灯（两格高的柱子）
  for (const [x, z] of [
    [5, 19],
    [8, 19],
    [5, 25],
    [8, 25],
  ])
    add("post", x, z, 2);
  // 一口小井
  add("well", 15, 17, 1);
  // 野花与杂草：按位置算出来的固定图案
  const taken = new Set(out.map((b) => `${b.x},${b.z}`));
  for (let x = YARD.x0; x < YARD.x1; x++)
    for (let z = YARD.z0; z < YARD.z1; z++) {
      if (inHouse(x, z) || isPath(x, z) || taken.has(`${x},${z}`)) continue;
      const n = Math.abs(Math.sin(x * 12.99 + z * 78.23) * 43758.5) % 1;
      if (n < 0.05) add("flower", x, z, 0, Math.floor(n * 80) % 4);
      else if (n < 0.1 && Math.abs(x - 7) > 2) add("weed", x, z, 0);
    }
  return out;
}

/** 花园里所有的方块：小路 + 种的东西 + 烟囱（有壁炉的屋子） */
export function gardenBlocks(opts: { fireplace?: boolean; items?: GardenBlock[] } = {}): GardenBlock[] {
  const out: GardenBlock[] = [];
  for (let z = ROOM.d + 1; z < YARD.z1; z++) for (let x = DOOR.x0; x < DOOR.x1; x++) out.push({ kind: "path", x, z, h: 0 });
  out.push(...(opts.items ?? defaultGarden()));
  if (opts.fireplace) for (let z = 4; z <= 6; z++) out.push({ kind: "chimney", x: -2, z, h: WALL });
  return out;
}

/** 在院子里（围栏以内）且不在屋子的墙体范围 */
export function inYard(x: number, z: number): boolean {
  return x >= YARD.x0 && x < YARD.x1 && z >= YARD.z0 && z < YARD.z1;
}

/** 在屋子里（墙以内） */
export function indoors(x: number, z: number): boolean {
  return x >= 0 && x < ROOM.w && z >= 0 && z < ROOM.d;
}

const key = (x: number, z: number) => `${x},${z}`;

/** 每个格子的顶面高度：地面 0，家具、花园方块按高度，墙和围栏不能翻越 */
export class Ground {
  private tops = new Map<string, number>();

  constructor(
    layout: Pick<Layout, "furniture"> | null,
    garden: GardenBlock[],
    private doorOpen: boolean,
  ) {
    // 屋子的墙（含四角）
    for (let x = -1; x <= ROOM.w; x++) {
      this.tops.set(key(x, -1), WALL);
      this.tops.set(key(x, ROOM.d), WALL);
    }
    for (let z = -1; z <= ROOM.d; z++) {
      this.tops.set(key(-1, z), WALL);
      this.tops.set(key(ROOM.w, z), WALL);
    }
    if (doorOpen) for (let x = DOOR.x0; x < DOOR.x1; x++) this.tops.delete(key(x, DOOR.z));
    for (const f of layout?.furniture ?? []) {
      if (!SPECS[f.type].solid) continue;
      const h = furnitureTop(f.type);
      for (const [x, z] of cellsOf(f)) this.tops.set(key(x, z), Math.max(this.tops.get(key(x, z)) ?? 0, h));
    }
    for (const b of garden) if (b.h > 0) this.tops.set(key(b.x, b.z), Math.max(this.tops.get(key(b.x, b.z)) ?? 0, b.h));
  }

  get isDoorOpen() {
    return this.doorOpen;
  }

  /** 格子的顶面高度；院子外面（围栏）视为墙 */
  top(cx: number, cz: number): number {
    if (!inYard(cx, cz)) return WALL;
    return this.tops.get(key(cx, cz)) ?? 0;
  }

  /** 宠物不爬高：有东西（高于台阶）就算挡路 */
  blocked(cx: number, cz: number): boolean {
    return this.top(cx, cz) > 0.3;
  }

  /** 圆形范围内最高的顶面（站在哪里） */
  heightUnder(x: number, z: number, radius = PLAYER_RADIUS): number {
    let h = 0;
    for (let cx = Math.floor(x - radius); cx <= Math.floor(x + radius); cx++)
      for (let cz = Math.floor(z - radius); cz <= Math.floor(z + radius); cz++) h = Math.max(h, this.top(cx, cz));
    return h;
  }

  /** 这个位置能不能站一个人（脚在 y 高度） */
  fits(x: number, z: number, y = 0, radius = PLAYER_RADIUS): boolean {
    return this.heightUnder(x, z, radius) <= y + 1e-3 && !this.hitsCeiling(x, z, y);
  }

  /** 屋里有天花板，门洞只有 3 格高 */
  hitsCeiling(x: number, z: number, y: number): boolean {
    const head = y + PLAYER_HEIGHT;
    if (indoors(x, z)) return head > ROOM.h;
    if (Math.floor(z) === DOOR.z && x >= DOOR.x0 && x < DOOR.x1) return head > DOOR.h;
    return false;
  }
}

export interface Body {
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
}

/**
 * 水平移动：按 x、z 分轴。脚下能迈上去的（≤ STEP）在地面上时自动迈上；
 * 空中只能越过比脚低的东西。返回新的位置与是否迈了台阶。
 */
export function moveBody(g: Ground, b: Body, dx: number, dz: number, radius = PLAYER_RADIUS): { stepped: boolean } {
  const allow = b.y + (b.grounded ? STEP : 1e-3);
  const ok = (x: number, z: number) => g.heightUnder(x, z, radius) <= allow && !g.hitsCeiling(x, z, Math.max(b.y, g.heightUnder(x, z, radius)));
  let stepped = false;
  const tryAxis = (nx: number, nz: number, along: "x" | "z", d: number) => {
    if (ok(nx, nz)) {
      b.x = nx;
      b.z = nz;
      return;
    }
    // 贴到格子边缘
    const v = along === "x" ? b.x : b.z;
    const edge = d > 0 ? Math.floor(v + radius) + 1 - radius - 1e-4 : Math.floor(v - radius) + radius + 1e-4;
    const target = d > 0 ? Math.min(v + d, edge) : Math.max(v + d, edge);
    const tx = along === "x" ? target : b.x;
    const tz = along === "z" ? target : b.z;
    if (ok(tx, tz)) {
      b.x = tx;
      b.z = tz;
    }
  };
  if (dx) tryAxis(b.x + dx, b.z, "x", dx);
  if (dz) tryAxis(b.x, b.z + dz, "z", dz);
  if (b.grounded) {
    const h = g.heightUnder(b.x, b.z, radius);
    if (h > b.y && h <= b.y + STEP) {
      b.y = h;
      stepped = true;
    }
  }
  return { stepped };
}

/** 竖直方向：重力、落地、顶到天花板 */
export function fallBody(g: Ground, b: Body, dt: number, jump: boolean, radius = PLAYER_RADIUS) {
  if (jump && b.grounded) {
    b.vy = JUMP_V;
    b.grounded = false;
  }
  b.vy -= GRAVITY * dt;
  let y = b.y + b.vy * dt;
  const floor = g.heightUnder(b.x, b.z, radius);
  if (y <= floor) {
    y = floor;
    b.vy = 0;
    b.grounded = true;
  } else b.grounded = false;
  if (b.vy > 0 && g.hitsCeiling(b.x, b.z, y)) {
    y = b.y;
    b.vy = 0;
  }
  b.y = y;
}

/** 找一个离 (x, z) 最近、能站人的地面位置 */
export function nearestFree(g: Ground, x: number, z: number): { x: number; z: number } {
  if (g.fits(x, z)) return { x, z };
  for (let r = 0.5; r <= 6; r += 0.5)
    for (let a = 0; a < 16; a++) {
      const px = x + Math.cos((a / 16) * Math.PI * 2) * r;
      const pz = z + Math.sin((a / 16) * Math.PI * 2) * r;
      if (g.fits(px, pz)) return { x: px, z: pz };
    }
  return { x: ROOM.w / 2, z: ROOM.d - 1.5 };
}
