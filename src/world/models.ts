// 房间与家具的方块模型。所有尺寸以方块为单位。
// 家具模型以占地中心为原点、y 从 0 向上、正面朝 +z；放置时按 rot 绕 y 轴旋转。
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { centerOf, ROOM, SPECS, type Furniture, type FurnitureType } from "./layout";
import { roomTextures, textures, type TextureSet } from "./textures";
import { isOpening, openingBox, THEMES, type RoomTheme, type Side, type TexName } from "./themes";
import { wallTransform, type WallItem } from "./wall";

const matCache = new Map<string, THREE.Material>();

function lambert(key: string, tex: THREE.Texture, opts: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  const k = `l:${key}:${JSON.stringify(opts)}`;
  let m = matCache.get(k) as THREE.MeshLambertMaterial | undefined;
  if (!m) {
    m = new THREE.MeshLambertMaterial({ map: tex, ...opts });
    m.userData.shared = true;
    matCache.set(k, m);
  }
  return m;
}

/**
 * 拆掉家具模型时释放显存：几何体都是每件家具自己的，直接释放；
 * 共用的材质（userData.shared）和纹理不动，只有书架名牌的文字纹理是单独画的。书由 ShelfBooks 自己释放。
 */
export function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o.userData.books) return;
    const m = o as THREE.Mesh;
    if (!m.geometry) return;
    m.geometry.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (!mat || mat.userData?.shared) continue;
      if (o.name === "signtext") (mat as THREE.MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
  });
}

/** 按面尺寸缩放 UV，使可平铺纹理保持每方块一张 */
function tiledBox(w: number, h: number, d: number, scale = 1): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry 面顺序：+x, -x, +y, -y, +z, -z，每面 4 个顶点
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] * scale, uv.getY(i) * dims[f][1] * scale);
    }
  }
  return g;
}

function box(
  w: number,
  h: number,
  d: number,
  material: THREE.Material | THREE.Material[],
  x: number,
  y: number,
  z: number,
  tiled = false,
): THREE.Mesh {
  const geo = tiled ? tiledBox(w, h, d) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y + h / 2, z);
  return m;
}

// ───────────────────────── 房间 ─────────────────────────

export interface RoomBuild {
  group: THREE.Group;
  /** 默认室外风景（草地、树、山丘）；使用自定义窗景时隐藏树和山 */
  outdoor: THREE.Group;
  /** 窗户位置（用于窗光） */
  windows: { x: number; y: number; z: number; normal: THREE.Vector3 }[];
  /** 每扇窗的包围盒（瞄准、拖放判定） */
  openings: { side: Side; min: THREE.Vector3; max: THREE.Vector3 }[];
  /** 壁炉火焰（动画用） */
  fire: THREE.Object3D | null;
  /** 壁炉火光位置 */
  fireLight: THREE.Vector3 | null;
  /** 门（doorL、doorR 两个门轴） */
  door: THREE.Group;
}

type Cell = "lower" | "upper" | "corner" | "glass" | "door" | "hearth";

function texByName(name: TexName, t: TextureSet): THREE.Texture {
  const rt = roomTextures();
  return ((t as unknown as Record<string, THREE.Texture>)[name] ?? (rt as unknown as Record<string, THREE.Texture>)[name])!;
}

/** 圆窗 / 拱窗遮罩：墙色的平面，挖出圆形或拱形的洞，外加一圈窗框 */
function windowCover(style: "round" | "arch", cols: number, rows: number, wallTex: THREE.Texture, frameColor: string): THREE.CanvasTexture {
  const S = 16;
  const c = document.createElement("canvas");
  c.width = cols * S;
  c.height = rows * S;
  const g = c.getContext("2d")!;
  const img = wallTex.image as CanvasImageSource | undefined;
  const pat = img ? g.createPattern(img, "repeat") : null;
  g.fillStyle = pat ?? "#ccc";
  g.fillRect(0, 0, c.width, c.height);
  const holes: { cx: number; cy: number; r: number }[] = [];
  if (style === "round") {
    // 每 2×2 格一个圆窗
    for (let x = 0; x + 2 <= cols; x += 2) for (let y = 0; y + 2 <= rows; y += 2) holes.push({ cx: (x + 1) * S, cy: (y + 1) * S, r: S * 0.82 });
    if (!holes.length) holes.push({ cx: c.width / 2, cy: c.height / 2, r: Math.min(c.width, c.height) * 0.42 });
  }
  g.lineWidth = 3;
  g.strokeStyle = frameColor;
  if (style === "round") {
    for (const h of holes) {
      g.globalCompositeOperation = "destination-out";
      g.beginPath();
      g.arc(h.cx, h.cy, h.r, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = "source-over";
      g.beginPath();
      g.arc(h.cx, h.cy, h.r, 0, Math.PI * 2);
      g.stroke();
      // 十字窗棂
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(h.cx - h.r, h.cy);
      g.lineTo(h.cx + h.r, h.cy);
      g.moveTo(h.cx, h.cy - h.r);
      g.lineTo(h.cx, h.cy + h.r);
      g.stroke();
      g.lineWidth = 3;
    }
  } else {
    // 拱窗：下部矩形 + 上部半圆
    const w = c.width - 6;
    const r = w / 2;
    const x0 = 3;
    const top = 3 + r;
    const path = () => {
      g.beginPath();
      g.moveTo(x0, c.height);
      g.lineTo(x0, top);
      g.arc(x0 + r, top, r, Math.PI, 0);
      g.lineTo(x0 + w, c.height);
      g.closePath();
    };
    g.globalCompositeOperation = "destination-out";
    path();
    g.fill();
    g.globalCompositeOperation = "source-over";
    path();
    g.stroke();
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0 + r, 3);
    g.lineTo(x0 + r, c.height);
    for (let y = top; y < c.height; y += S) {
      g.moveTo(x0, y);
      g.lineTo(x0 + w, y);
    }
    g.stroke();
  }
  // 像素化边缘：alpha 只保留 0 或 1
  const d = g.getImageData(0, 0, c.width, c.height);
  for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] > 100 ? 255 : 0;
  g.putImageData(d, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildRoom(t: TextureSet = textures(), theme: RoomTheme = THEMES.study, hasDoor = true): RoomBuild {
  const group = new THREE.Group();
  const { w: W, d: D, h: H } = ROOM;
  const tex = (n: TexName) => texByName(n, t);

  // 地板
  const floorTex = tex(theme.floor).clone();
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(W, D);
  floorTex.needsUpdate = true;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(W / 2, 0, D / 2);
  floor.name = "floor";
  group.add(floor);

  // 天花板
  const ceilTex = tex(theme.ceiling).clone();
  ceilTex.wrapS = ceilTex.wrapT = THREE.RepeatWrapping;
  ceilTex.repeat.set(W, D);
  ceilTex.needsUpdate = true;
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: ceilTex }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(W / 2, H, D / 2);
  group.add(ceil);
  // 横梁
  if (theme.beams) for (const z of [3, 6, 9]) group.add(box(W, 0.4, 0.5, lambert(`beam-${theme.beams}`, tex(theme.beams)), W / 2, H - 0.4, z, true));

  // 墙体：逐格决定材质
  const ws = theme.windows;
  const windows: RoomBuild["windows"] = [];
  const wallCells: { x: number; y: number; z: number; kind: Cell }[] = [];
  const isDoor = (x: number, y: number) => hasDoor && x >= 6 && x <= 7 && y <= 2;
  const isHearth = (z: number, y: number) => !!theme.fireplace && z >= 4 && z <= 6 && y <= 1;
  const kindAt = (y: number): Cell => (y < theme.lowerRows ? "lower" : "upper");
  for (let y = 0; y < H; y++) {
    for (let x = -1; x <= W; x++) {
      const corner = x === -1 || x === W;
      wallCells.push({ x, y, z: -1, kind: corner ? "corner" : isOpening(ws, "north", x, y) ? "glass" : kindAt(y) });
      if (!isDoor(x, y)) wallCells.push({ x, y, z: D, kind: corner ? "corner" : kindAt(y) });
    }
    for (let z = 0; z < D; z++) {
      wallCells.push({ x: -1, y, z, kind: isOpening(ws, "west", z, y) ? "glass" : isHearth(z, y) ? "hearth" : kindAt(y) });
      wallCells.push({ x: W, y, z, kind: isOpening(ws, "east", z, y) ? "glass" : kindAt(y) });
    }
  }
  const mats: Record<Exclude<Cell, "glass" | "hearth">, THREE.Material> = {
    lower: lambert(`wall-${theme.lower}`, tex(theme.lower)),
    upper: lambert(`wall-${theme.upper}`, tex(theme.upper)),
    corner: lambert(`wall-${theme.corner}`, tex(theme.corner)),
    door: lambert(`door-${theme.door}`, tex(theme.door)),
  };
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const byKind = new Map<Cell, THREE.Matrix4[]>();
  const m4 = new THREE.Matrix4();
  for (const c of wallCells) {
    if (c.kind === "hearth") continue;
    if (c.kind === "glass") {
      const normal =
        c.z === -1 ? new THREE.Vector3(0, 0, 1) : c.z === D ? new THREE.Vector3(0, 0, -1) : c.x === -1 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(-1, 0, 0);
      windows.push({ x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5, normal });
      continue;
    }
    const list = byKind.get(c.kind) ?? [];
    list.push(m4.clone().makeTranslation(c.x + 0.5, c.y + 0.5, c.z + 0.5));
    byKind.set(c.kind, list);
  }
  for (const [kind, list] of byKind) {
    const im = new THREE.InstancedMesh(unit, mats[kind as keyof typeof mats], list.length);
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    group.add(im);
  }

  // 玻璃：每格一块薄板（和室用纸拉窗）
  const glassTex = theme.windowStyle === "shoji" ? roomTextures().shoji : t.glass;
  const glassMat = new THREE.MeshLambertMaterial({ map: glassTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  for (const wdw of windows) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glassMat);
    pane.position.set(wdw.x, wdw.y, wdw.z);
    pane.lookAt(wdw.x + wdw.normal.x, wdw.y, wdw.z + wdw.normal.z);
    pane.renderOrder = 2;
    group.add(pane);
  }

  // 窗台与圆窗 / 拱窗遮罩
  const frameMat = lambert(`frame-${theme.frame}`, tex(theme.frame));
  const openings: RoomBuild["openings"] = [];
  for (const side of ["north", "east", "west"] as Side[]) {
    const o = ws[side];
    if (!o) continue;
    const b = openingBox(side, o, ROOM);
    openings.push({ side, min: new THREE.Vector3(...b.min), max: new THREE.Vector3(...b.max) });
    const len = o.to - o.from + 1;
    const hgt = o.y1 - o.y0 + 1;
    const mid = (o.from + o.to + 1) / 2;
    if (side === "north") group.add(box(len + 0.2, 0.12, 0.3, frameMat, mid, o.y0 - 0.08, 0.12));
    else if (side === "east") group.add(box(0.3, 0.12, len + 0.2, frameMat, W - 0.12, o.y0 - 0.08, mid));
    else group.add(box(0.3, 0.12, len + 0.2, frameMat, 0.12, o.y0 - 0.08, mid));
    if (theme.windowStyle === "round" || theme.windowStyle === "arch") {
      const cover = new THREE.Mesh(
        new THREE.PlaneGeometry(len, hgt),
        new THREE.MeshLambertMaterial({ map: windowCover(theme.windowStyle, len, hgt, tex(theme.upper), "#6b5236"), alphaTest: 0.5, side: THREE.DoubleSide }),
      );
      const cy = o.y0 + hgt / 2;
      if (side === "north") cover.position.set(mid, cy, -0.02);
      else if (side === "east") {
        cover.position.set(W + 0.02, cy, mid);
        cover.rotation.y = -Math.PI / 2;
      } else {
        cover.position.set(-0.02, cy, mid);
        cover.rotation.y = Math.PI / 2;
      }
      cover.renderOrder = 3;
      group.add(cover);
    }
  }
  // 门框
  if (hasDoor) group.add(box(2.3, 0.2, 1.06, frameMat, 7, 3, D + 0.5));

  // 壁炉：西墙凹进去的炉膛 + 火焰 + 壁炉台
  let fire: THREE.Object3D | null = null;
  let fireLight: THREE.Vector3 | null = null;
  if (theme.fireplace) {
    const stone = lambert("hearthstone", t.stoneBricks, { color: 0x8a8580 });
    const soot = new THREE.MeshLambertMaterial({ color: 0x1c1714 });
    group.add(box(0.2, 2, 3, soot, -1.6, 0, 5.5));
    group.add(box(1, 0.2, 3, stone, -1, 0, 5.5));
    group.add(box(1, 0.3, 3, stone, -1, 1.85, 5.5));
    group.add(box(0.4, 0.14, 3.6, frameMat, 0.1, 2.15, 5.5));
    group.add(box(0.25, 2.15, 0.3, stone, 0.05, 0, 3.9));
    group.add(box(0.25, 2.15, 0.3, stone, 0.05, 0, 7.1));
    // 柴火
    const logM = lambert("log", t.log);
    const l1 = box(0.18, 0.18, 1.6, logM, -0.9, 0.2, 5.5);
    group.add(l1);
    const flame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 1.4), new THREE.MeshBasicMaterial({ map: roomTextures().fire, transparent: true, alphaTest: 0.3 }));
    flame.position.set(-0.85, 0.75, 5.5);
    flame.renderOrder = 1;
    flame.name = "fire";
    group.add(flame);
    fire = flame;
    fireLight = new THREE.Vector3(-0.3, 1, 5.5);
  }

  // 室外（院子、地形）由 outdoor.ts 单独生成；这里保留一个空组兼容
  const outdoorGroup = new THREE.Group();

  const merged = mergeStatic(group);
  // 火焰保持独立（要动画），mergeStatic 会把普通网格合并，这里重新挂回去
  if (fire) {
    merged.add(fire);
  }
  // 门：两扇，绕外侧的门轴向外打开（不参与合并，要动画）
  const door = new THREE.Group();
  door.name = "door";
  const doorMat = lambert(`door-${theme.door}`, tex(theme.door));
  for (const side of hasDoor ? ([-1, 1] as const) : []) {
    const pivot = new THREE.Group();
    pivot.name = side < 0 ? "doorL" : "doorR";
    pivot.position.set(side < 0 ? 6 : 8, 0, D + 0.09);
    const leaf = box(1, 3, 0.18, doorMat, -side * 0.5, 0, 0, true);
    leaf.userData.door = true;
    pivot.add(leaf);
    // 小窗与把手
    const win = box(0.5, 0.6, 0.2, new THREE.MeshLambertMaterial({ map: t.glass, transparent: true, opacity: 0.85 }), -side * 0.5, 1.9, 0);
    win.userData.door = true;
    pivot.add(win);
    for (const dz of [-0.13, 0.13]) {
      const knob = box(0.1, 0.1, 0.08, frameMat, -side * 0.85, 1.0, dz);
      knob.userData.door = true;
      pivot.add(knob);
    }
    door.add(pivot);
  }
  merged.add(door);
  merged.traverse((o) => {
    if (!o.userData.door) o.userData.occluder = true;
  });
  return { group: merged, outdoor: outdoorGroup, windows, openings, fire, fireLight, door };
}

/** 把静态网格按材质合并，大幅减少绘制调用（实例网格保持不变） */
export function mergeStatic(group: THREE.Group): THREE.Group {
  group.updateMatrixWorld(true);
  const out = new THREE.Group();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const keep: THREE.Object3D[] = [];
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if ((m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material) || m.renderOrder !== 0) {
      keep.push(m);
      return;
    }
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    const list = buckets.get(m.material) ?? [];
    list.push(g.index ? g : g);
    buckets.set(m.material, list);
  });
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false);
    if (merged) out.add(new THREE.Mesh(merged, mat));
    else geos.forEach((g) => out.add(new THREE.Mesh(g, mat)));
  }
  for (const k of keep) {
    k.removeFromParent();
    k.updateMatrixWorld(true);
    out.add(k);
  }
  return out;
}

// ───────────────────────── 家具 ─────────────────────────

const SHELF_WOODS: (keyof TextureSet)[] = ["shelfWood", "shelfWoodLight", "shelfWoodDark"];

/** 书架内三层的可放书区域（局部坐标）：x 从 -0.88 到 0.88 */
export const SHELF_ROWS = [
  { y: 0.16, h: 0.82 },
  { y: 1.06, h: 0.86 },
  { y: 2.0, h: 0.84 },
];
export const SHELF_INNER_X = 0.88;

function bookshelf(t: TextureSet, tint = 0): THREE.Group {
  const g = new THREE.Group();
  const wood = lambert(`shelf${tint}`, t[SHELF_WOODS[tint % SHELF_WOODS.length]]);
  const back = lambert("shelfback", t.shelfWoodDark, { color: 0x9a8a80 });
  g.add(box(0.12, 3, 1, wood, -0.94, 0, 0, true));
  g.add(box(0.12, 3, 1, wood, 0.94, 0, 0, true));
  g.add(box(2, 0.16, 1, wood, 0, 0, 0, true));
  g.add(box(2, 0.12, 1, wood, 0, 2.88, 0, true));
  g.add(box(1.8, 3, 0.06, back, 0, 0, -0.47, true));
  g.add(box(1.8, 0.08, 0.92, wood, 0, 0.98, 0, true));
  g.add(box(1.8, 0.08, 0.92, wood, 0, 1.92, 0, true));
  // 顶部装饰线
  g.add(box(2.1, 0.08, 1.06, wood, 0, 2.92, 0.02, true));
  return g;
}

function desk(t: TextureSet): THREE.Group {
  const g = new THREE.Group();
  const top = lambert("desktop", t.deskTop);
  const side = lambert("deskside", t.shelfWoodDark);
  const legs = lambert("log", t.log);
  const topMats = [side, side, top, side, side, side];
  g.add(box(2, 0.1, 1, topMats, 0, 0.82, 0));
  for (const [x, z] of [
    [-0.9, -0.4],
    [0.9, -0.4],
    [-0.9, 0.4],
    [0.9, 0.4],
  ])
    g.add(box(0.12, 0.82, 0.12, legs, x, 0, z));
  // 抽屉柜（左侧）
  g.add(box(0.6, 0.5, 0.86, side, -0.6, 0.32, -0.02, true));
  g.add(box(0.14, 0.05, 0.03, lambert("brass", t.lantern, { color: 0xd9b45a }), -0.6, 0.55, 0.42));
  // 摊开的书
  const book = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.36), new THREE.MeshLambertMaterial({ map: t.openBook }));
  book.rotation.x = -Math.PI / 2;
  book.position.set(0.15, 0.925, 0.05);
  book.name = "openbook";
  g.add(book);
  // 墨水瓶与羽毛笔
  g.add(box(0.1, 0.1, 0.1, lambert("ink", t.lantern, { color: 0x222244 }), 0.68, 0.92, -0.25));
  const quill = box(0.03, 0.34, 0.03, lambert("quill", t.pages, { color: 0xffffff }), 0.68, 0.98, -0.25);
  quill.rotation.z = -0.35;
  g.add(quill);
  // 台灯（小灯笼）
  g.add(box(0.06, 0.3, 0.06, legs, -0.75, 0.92, -0.3));
  const lamp = box(0.2, 0.2, 0.2, new THREE.MeshBasicMaterial({ map: t.lantern }), -0.75, 1.2, -0.3);
  lamp.name = "lampglow";
  g.add(lamp);
  // 沙漏（专注计时）：上下两块木板、玻璃、上下两堆沙，计时时由引擎改变沙的高度
  const hg = new THREE.Group();
  hg.name = "hourglass";
  const hw = lambert("hgwood", t.shelfWoodDark);
  hg.add(box(0.2, 0.03, 0.2, hw, 0, 0, 0));
  hg.add(box(0.2, 0.03, 0.2, hw, 0, 0.33, 0));
  for (const [x, z] of [
    [-0.08, -0.08],
    [0.08, -0.08],
    [-0.08, 0.08],
    [0.08, 0.08],
  ])
    hg.add(box(0.02, 0.3, 0.02, hw, x, 0.03, z));
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.12), new THREE.MeshLambertMaterial({ color: 0xdff2fa, transparent: true, opacity: 0.25, depthWrite: false }));
  glass.position.y = 0.18;
  hg.add(glass);
  const sandMat = new THREE.MeshLambertMaterial({ color: 0xe6c27a });
  const sandTop = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), sandMat);
  sandTop.name = "sandTop";
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), sandMat);
  bottom.name = "sandBottom";
  const stream = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.14, 0.015), sandMat);
  stream.name = "sandStream";
  stream.position.y = 0.17;
  stream.visible = false;
  hg.add(sandTop, bottom, stream);
  setSand(hg, null);
  hg.position.set(0.55, 0.87, 0.25);
  g.add(hg);
  // 椅子（在桌前，不阻挡行走）
  const chair = new THREE.Group();
  const cw = lambert("chair", t.shelfWood);
  chair.add(box(0.56, 0.08, 0.5, cw, 0, 0.46, 0, true));
  for (const [x, z] of [
    [-0.23, -0.2],
    [0.23, -0.2],
    [-0.23, 0.2],
    [0.23, 0.2],
  ])
    chair.add(box(0.07, 0.46, 0.07, cw, x, 0, z));
  chair.add(box(0.56, 0.6, 0.07, cw, 0, 0.54, 0.22, true));
  chair.position.set(0.15, 0, 0.95);
  chair.name = "chair";
  g.add(chair);
  return g;
}

/** 沙漏的沙：progress 为 0（刚翻过来，沙都在上面）到 1（漏完）；null 为静置（沙都在下面） */
export function setSand(hg: THREE.Object3D, progress: number | null) {
  const top = hg.getObjectByName("sandTop");
  const bottom = hg.getObjectByName("sandBottom");
  const stream = hg.getObjectByName("sandStream");
  if (!top || !bottom || !stream) return;
  const p = progress === null ? 1 : Math.max(0, Math.min(1, progress));
  const full = 0.12;
  const th = Math.max(0.001, full * (1 - p));
  const bh = Math.max(0.001, full * p);
  top.scale.y = th;
  top.position.y = 0.32 - th / 2;
  top.visible = th > 0.002;
  bottom.scale.y = bh;
  bottom.position.y = 0.03 + bh / 2;
  bottom.visible = bh > 0.002;
  stream.visible = progress !== null && p < 1;
}

function workbench(t: TextureSet): THREE.Group {
  const g = new THREE.Group();
  const sideM = lambert("wbside", t.workbenchSide);
  const topM = lambert("wbtop", t.workbenchTop);
  const bottom = lambert("planks", t.planks);
  g.add(box(0.98, 0.98, 0.98, [sideM, sideM, topM, bottom, sideM, sideM], 0, 0, 0));
  return g;
}

function aibench(t: TextureSet): THREE.Group {
  const g = new THREE.Group();
  const side = lambert("aiside", t.aiSide);
  const top = lambert("aitop", t.aiTop);
  g.add(box(0.98, 0.78, 0.98, [side, side, top, side, side, side], 0, 0, 0));
  // 四角的小立柱
  const post = lambert("aipost", t.aiSide, { color: 0x8a86a0 });
  for (const [x, z] of [
    [-0.4, -0.4],
    [0.4, -0.4],
    [-0.4, 0.4],
    [0.4, 0.4],
  ])
    g.add(box(0.1, 0.18, 0.1, post, x, 0.78, z));
  // 悬浮旋转的晶体（发光）
  const c = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ map: t.crystal }));
  c.rotation.set(Math.PI / 4, 0, Math.PI / 4);
  const holder = new THREE.Group();
  holder.position.set(0, 1.22, 0);
  holder.add(c);
  holder.name = "spin";
  g.add(holder);
  const glow = new THREE.Object3D();
  glow.name = "lampglow";
  glow.position.set(0, 1.22, 0);
  g.add(glow);
  return g;
}

function chest(t: TextureSet): THREE.Group {
  const g = new THREE.Group();
  const front = lambert("chestfront", t.chestFront);
  const top = lambert("chesttop", t.chestTop);
  g.add(box(0.88, 0.84, 0.88, [top, top, top, top, front, top], 0, 0, 0));
  return g;
}

function lantern(t: TextureSet): THREE.Group {
  const g = new THREE.Group();
  const post = lambert("iron", t.lantern, { color: 0x3a3632 });
  g.add(box(0.36, 0.08, 0.36, post, 0, 0, 0));
  g.add(box(0.08, 0.9, 0.08, post, 0, 0.08, 0));
  const glow = box(0.34, 0.4, 0.34, new THREE.MeshBasicMaterial({ map: t.lantern }), 0, 0.98, 0);
  glow.name = "lampglow";
  g.add(glow);
  g.add(box(0.4, 0.06, 0.4, post, 0, 1.38, 0));
  return g;
}

function plant(t: TextureSet): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.5, 0.42, 0.5, lambert("pot", t.terracotta), 0, 0, 0));
  const leaf = lambert("leaves", t.leaves);
  g.add(box(0.44, 0.44, 0.44, leaf, 0, 0.42, 0));
  g.add(box(0.3, 0.3, 0.3, leaf, 0.12, 0.8, -0.05));
  g.add(box(0.26, 0.26, 0.26, leaf, -0.14, 0.7, 0.12));
  return g;
}

function carpet(t: TextureSet, f: Furniture): THREE.Group {
  const g = new THREE.Group();
  const tex = { none: t.carpet, rain: t.carpetRain, fire: t.carpetFire, night: t.carpetNight, waves: t.carpetRain, wind: t.carpetRain, birds: t.carpetFire, track: t.carpetNight }[f.ambience ?? "none"];
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lambert(`carpet-${f.ambience ?? "none"}`, tex));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.012;
  g.add(m);
  return g;
}

/** 鱼塘：石砖围边、流动的水面、一片睡莲叶、斜插的钓竿；冒泡时水面升起小方块气泡 */
function pond(t: TextureSet): THREE.Group {
  const g = new THREE.Group();
  const stone = lambert("pondstone", t.stoneBricks, { color: 0xb8b8b0 });
  const H = 0.5;
  g.add(box(2, H, 0.2, stone, 0, 0, -0.9, true));
  g.add(box(2, H, 0.2, stone, 0, 0, 0.9, true));
  g.add(box(0.2, H, 1.6, stone, -0.9, 0, 0, true));
  g.add(box(0.2, H, 1.6, stone, 0.9, 0, 0, true));
  g.add(box(1.6, 0.1, 1.6, lambert("pondbed", t.darkPlanks, { color: 0x3a4a3a }), 0, 0, 0));
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 1.6),
    new THREE.MeshLambertMaterial({ map: t.water, transparent: true, opacity: 0.88, depthWrite: false }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.4;
  water.name = "water";
  g.add(water);
  const lily = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshLambertMaterial({ map: t.lilyPad, transparent: true, alphaTest: 0.5 }));
  lily.rotation.x = -Math.PI / 2;
  lily.rotation.z = 0.6;
  lily.position.set(-0.35, 0.41, 0.3);
  g.add(lily);
  // 钓竿：插在一角，线垂进水里
  const rod = box(0.05, 1.5, 0.05, lambert("rod", t.log, { color: 0xc8a070 }), 0, 0, 0);
  g.add(rod);
  rod.position.set(0.6, 0.62, 0.6);
  rod.rotation.set(-0.55, 0, 0.55);
  rod.updateMatrix();
  // 竿尖（局部坐标的上端）
  const tip = new THREE.Vector3(0, 0.75, 0).applyMatrix4(rod.matrix);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([tip, new THREE.Vector3(tip.x, 0.4, tip.z)]),
    new THREE.LineBasicMaterial({ color: 0xeeeeee }),
  );
  g.add(line);
  const bobber = box(0.07, 0.06, 0.07, new THREE.MeshLambertMaterial({ color: 0xd8423a }), tip.x, 0.39, tip.z);
  bobber.name = "bobber";
  g.add(bobber);
  // 气泡：平时隐藏
  const bubbles = new THREE.Group();
  bubbles.name = "bubbles";
  bubbles.visible = false;
  const bm = new THREE.MeshBasicMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), bm);
    b.position.set(-0.4 + ((i * 37) % 9) * 0.1, 0.42, -0.4 + ((i * 53) % 9) * 0.1);
    b.userData.phase = i / 7;
    bubbles.add(b);
  }
  g.add(bubbles);
  return g;
}

/** 留声机：木箱底座、黑色唱片（播放时转）、唱臂、黄铜喇叭（原创造型） */
function jukebox(t: TextureSet): THREE.Group {
  const g = new THREE.Group();
  const wood = lambert("jbwood", t.shelfWood);
  const trim = lambert("jbtrim", t.shelfWoodDark);
  const brass = new THREE.MeshLambertMaterial({ color: 0xd9a84a });
  g.add(box(0.82, 0.5, 0.82, wood, 0, 0, 0, true));
  g.add(box(0.86, 0.06, 0.86, trim, 0, 0.5, 0));
  g.add(box(0.12, 0.08, 0.04, brass, 0, 0.22, 0.42));
  const disc = new THREE.Group();
  disc.name = "disc";
  disc.position.set(-0.08, 0.57, 0.05);
  disc.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.025, 16), new THREE.MeshLambertMaterial({ color: 0x1c1c22 })));
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 12), new THREE.MeshLambertMaterial({ color: 0xc8423a }));
  disc.add(label);
  const groove = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.031, 0.22), new THREE.MeshLambertMaterial({ color: 0x3a3a44 }));
  groove.position.z = 0.17;
  disc.add(groove);
  g.add(disc);
  // 唱臂
  g.add(box(0.05, 0.12, 0.05, brass, 0.3, 0.56, -0.28));
  const arm = box(0.03, 0.03, 0.34, brass, 0.2, 0.66, -0.12);
  arm.rotation.y = 0.5;
  g.add(arm);
  // 喇叭：一节节变大的方块，向上向前张开
  const horn = new THREE.Group();
  horn.position.set(0.3, 0.68, -0.28);
  const sizes = [0.07, 0.1, 0.15, 0.22, 0.32];
  sizes.forEach((sz, i) => {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(sz, 0.08, sz), brass);
    seg.position.set(-i * 0.03, i * 0.09, i * 0.035);
    horn.add(seg);
  });
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, 0.26), new THREE.MeshLambertMaterial({ color: 0x5a3a1a }));
  mouth.position.set(-0.12, 0.4, 0.14);
  horn.add(mouth);
  horn.rotation.x = -0.35;
  g.add(horn);
  const notes = new THREE.Object3D();
  notes.name = "notesAnchor";
  notes.position.set(0.15, 1.25, 0);
  g.add(notes);
  return g;
}

/** 楼梯：一级级往后升高的台阶，扶手，顶上一块写着楼层的小木牌 */
function stairs(t: TextureSet): THREE.Group {
  const g = new THREE.Group();
  const step = lambert("stairstep", t.planks);
  const side = lambert("stairside", t.darkPlanks);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const h = (i + 1) * 0.5;
    const z = 1 - (i + 0.5) * (2 / n);
    g.add(box(0.9, h, 2 / n, step, 0, 0, z, true));
  }
  // 两侧扶手
  for (const x of [-0.47, 0.47]) {
    const rail = box(0.06, 0.06, 2.3, side, x, 0, 0);
    rail.position.y = 1.9;
    rail.rotation.x = -Math.atan2(3, 2);
    g.add(rail);
    g.add(box(0.06, 1, 0.06, side, x, 0.5, 0.95));
    g.add(box(0.06, 1, 0.06, side, x, 3, -0.95));
  }
  // 顶上的出口（暗色）与木牌
  g.add(box(1, 0.06, 0.7, new THREE.MeshLambertMaterial({ color: 0x1a1410 }), 0, 3.0, -0.65));
  const sign = box(0.6, 0.3, 0.05, side, 0, 1.2, 1.02);
  sign.name = "stairsign";
  g.add(sign);
  const arrow = box(0.08, 0.18, 0.02, new THREE.MeshBasicMaterial({ color: 0xffe08a }), 0, 1.26, 1.06);
  g.add(arrow);
  g.add(box(0.2, 0.06, 0.02, new THREE.MeshBasicMaterial({ color: 0xffe08a }), 0, 1.4, 1.06));
  return g;
}

const BUILDERS: Record<FurnitureType, (t: TextureSet, f: Furniture) => THREE.Group> = {
  stairs: (t) => stairs(t),
  bookshelf: (t, f) => bookshelf(t, f.tint ?? 0),
  desk: (t) => desk(t),
  workbench: (t) => workbench(t),
  aibench: (t) => aibench(t),
  chest: (t) => chest(t),
  lantern: (t) => lantern(t),
  plant: (t) => plant(t),
  carpet: (t, f) => carpet(t, f),
  pond: (t) => pond(t),
  jukebox: (t) => jukebox(t),
};

/** 生成家具模型并放到世界坐标；userData.fid 标识家具 */
export function buildFurniture(f: Furniture, t: TextureSet = textures()): THREE.Group {
  const g = BUILDERS[f.type](t, f);
  placeGroup(g, f);
  g.userData.fid = f.id;
  g.userData.type = f.type;
  g.traverse((o) => (o.userData.fid = f.id));
  return g;
}

export function placeGroup(g: THREE.Object3D, f: Pick<Furniture, "type" | "rot" | "x" | "z">) {
  const c = centerOf(f);
  g.position.set(c.x, 0, c.z);
  g.rotation.y = (f.rot * Math.PI) / 2;
}

/** 墙上的东西：黑板（木边 + 板面 + 粉笔槽）、画框（木框 + 画面）。画面网格名为 surface，可以换贴图 */
export function buildWallItem(it: WallItem, surface: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const t = textures();
  const wood = lambert(it.type === "board" ? "boardwood" : "framewood", it.type === "board" ? t.shelfWoodLight : t.shelfWoodDark);
  const border = it.type === "board" ? 0.12 : 0.1;
  g.add(box(it.w + border, it.h + border, 0.05, wood, 0, -(it.h + border) / 2, 0));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(it.w, it.h), new THREE.MeshLambertMaterial({ map: surface }));
  face.position.set(0, 0, 0.03);
  face.name = "surface";
  g.add(face);
  if (it.type === "board") g.add(box(it.w * 0.9, 0.05, 0.1, wood, 0, -it.h / 2 - 0.08, 0.06));
  const tr = wallTransform(it);
  g.position.set(tr.x, tr.y, tr.z);
  g.rotation.y = tr.ry;
  g.userData.wallId = it.id;
  g.traverse((o) => (o.userData.wallId = it.id));
  return g;
}

/** 放置预览：半透明，可行时绿色、不可行时红色 */
export function buildGhost(type: FurnitureType, t: TextureSet = textures()): THREE.Group {
  const g = BUILDERS[type](t, { id: "ghost", type, x: 0, z: 0, rot: 0 });
  const ok = new THREE.MeshBasicMaterial({ color: 0x8ff07a, transparent: true, opacity: 0.38, depthWrite: false });
  const bad = new THREE.MeshBasicMaterial({ color: 0xff6a5a, transparent: true, opacity: 0.38, depthWrite: false });
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    // 原来的材质用不到了：不是共用的就释放
    for (const old of Array.isArray(m.material) ? m.material : [m.material]) if (old && !old.userData?.shared) old.dispose();
    m.material = ok;
  });
  ok.userData.shared = bad.userData.shared = true;
  g.userData.ghostMats = [ok, bad];
  g.userData.setValid = (valid: boolean) =>
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = valid ? ok : bad;
    });
  // 地毯预览高一点，避免与地面闪烁
  if (type === "carpet") g.position.y = 0.01;
  return g;
}

/** 选中描边：黑色线框 */
export function outlineFor(min: THREE.Vector3, max: THREE.Vector3): THREE.LineSegments {
  const size = new THREE.Vector3().subVectors(max, min).addScalar(0.02);
  const boxGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
  const geo = new THREE.EdgesGeometry(boxGeo);
  boxGeo.dispose();
  const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.75 }));
  line.position.copy(min).add(max).multiplyScalar(0.5);
  return line;
}

export const FURNITURE_HEIGHT: Record<FurnitureType, number> = Object.fromEntries(
  Object.entries(SPECS).map(([k, s]) => [k, Math.max(s.h, 0.05)]),
) as Record<FurnitureType, number>;
