// 屋外的立体场景：院子（草地、小路、花坛、菜地、草垛、树、围栏、路灯、井）、屋顶，
// 以及围栏外按主题生成的方块地形（树林、雪山、海边……），远处由雾衔接远景画。
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { blockTextures } from "./blocks";
import { ROOM } from "./layout";
import { roomTextures, textures } from "./textures";
import { exposedDepth, insideFence, type BlockKind, type Terrain } from "./terrain";
import type { RoomTheme } from "./themes";
import { DOOR, gardenBlocks, YARD, type GardenBlock } from "./yard";

export interface OutdoorBuild {
  group: THREE.Group;
  /** 夜里发光的材质（路灯、楼的窗户）：emissiveIntensity 随天黑变化 */
  glow: THREE.MeshLambertMaterial[];
  dispose(): void;
}

const matCache = new Map<string, THREE.Material>();
const cached = new Set<THREE.Material>();
function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = matCache.get(key);
  if (!m) {
    m = make();
    matCache.set(key, m);
    cached.add(m);
  }
  return m;
}
const lam = (key: string, map: THREE.Texture, opts: THREE.MeshLambertMaterialParameters = {}) =>
  mat(key, () => new THREE.MeshLambertMaterial({ map, ...opts })) as THREE.MeshLambertMaterial;

/** 一种方块：六个面的材质（+x, -x, +y, -y, +z, -z） */
function blockMats(kind: BlockKind | "hay" | "log" | "leaves" | "spruce" | "cobble" | "roof" | "planks" | "stoneBricks" | "lantern"): THREE.Material | THREE.Material[] {
  const b = blockTextures();
  const t = textures();
  const six = (side: THREE.Material, top: THREE.Material, bottom: THREE.Material) => [side, side, top, bottom, side, side];
  switch (kind) {
    case "grass":
      return six(lam("b-grassSide", b.grassSide), lam("b-grassTop", b.grassTop), lam("b-dirt", b.dirt));
    case "dirt":
      return lam("b-dirt", b.dirt);
    case "stone":
      return lam("b-stone", b.stone);
    case "sand":
      return lam("b-sand", b.sand);
    case "snow":
      return six(lam("b-snowSide", b.snowSide), lam("b-snowTop", b.snowTop), lam("b-stone", b.stone));
    case "gravel":
      return lam("b-gravel", b.gravel);
    case "farmland":
      return six(lam("b-dirt", b.dirt), lam("b-farmland", b.farmland), lam("b-dirt", b.dirt));
    case "asphalt":
      return lam("b-asphalt", b.asphalt);
    case "moss":
      return six(lam("b-grassSide", b.grassSide, { color: 0xc8d8b0 }), lam("b-moss", b.moss), lam("b-dirt", b.dirt));
    case "hay":
      return six(lam("b-haySide", b.haySide), lam("b-hayTop", b.hayTop), lam("b-hayTop", b.hayTop));
    case "log":
      return six(lam("b-bark", t.bark), lam("b-logTop", b.logTop), lam("b-logTop", b.logTop));
    case "leaves":
      return lam("b-leaves", t.leaves);
    case "spruce":
      return lam("b-spruce", b.spruceLeaves);
    case "cobble":
      return lam("b-cobble", b.cobble);
    case "roof":
      return lam("b-roof", b.roof);
    case "planks":
      return lam("b-planks", t.planks);
    case "stoneBricks":
      return lam("b-stoneBricks", t.stoneBricks);
    case "lantern":
      return mat("b-lantern", () => new THREE.MeshLambertMaterial({ map: b.lantern, emissive: 0xffc070, emissiveMap: b.lantern, emissiveIntensity: 0 })) as THREE.MeshLambertMaterial;
  }
}

const unit = new THREE.BoxGeometry(1, 1, 1);

/** 按方块种类收集位置，最后合成实例网格 */
class Blocks {
  private lists = new Map<string, { mats: THREE.Material | THREE.Material[]; geo: THREE.BufferGeometry; m: THREE.Matrix4[]; colors: THREE.Color[] | null }>();
  add(key: string, mats: THREE.Material | THREE.Material[], x: number, y: number, z: number, opts: { geo?: THREE.BufferGeometry; sx?: number; sy?: number; sz?: number; ry?: number; color?: THREE.Color } = {}) {
    let l = this.lists.get(key);
    if (!l) {
      l = { mats, geo: opts.geo ?? unit, m: [], colors: opts.color ? [] : null };
      this.lists.set(key, l);
    }
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), opts.ry ?? 0),
      new THREE.Vector3(opts.sx ?? 1, opts.sy ?? 1, opts.sz ?? 1),
    );
    l.m.push(m);
    if (l.colors) l.colors.push(opts.color ?? new THREE.Color(1, 1, 1));
  }
  /** 方块：占 [x, x+1] × [y-1, y] × [z, z+1] */
  cube(key: string, mats: THREE.Material | THREE.Material[], x: number, top: number, z: number, color?: THREE.Color) {
    this.add(key, mats, x + 0.5, top - 0.5, z + 0.5, { color });
  }
  build(into: THREE.Group) {
    for (const l of this.lists.values()) {
      const im = new THREE.InstancedMesh(l.geo, l.mats, l.m.length);
      l.m.forEach((m, i) => im.setMatrixAt(i, m));
      if (l.colors) l.colors.forEach((c, i) => im.setColorAt(i, c));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      into.add(im);
    }
  }
}

/** 十字交叉的两片（花、草、庄稼） */
let crossGeo: THREE.BufferGeometry | null = null;
function cross(): THREE.BufferGeometry {
  if (crossGeo) return crossGeo;
  const a = new THREE.PlaneGeometry(0.9, 0.9);
  a.rotateY(Math.PI / 4);
  const b = new THREE.PlaneGeometry(0.9, 0.9);
  b.rotateY(-Math.PI / 4);
  crossGeo = mergeGeometries([a, b])!;
  crossGeo.translate(0, 0.45, 0);
  return crossGeo;
}
const plantMat = (key: string, map: THREE.Texture) => lam(key, map, { alphaTest: 0.5, side: THREE.DoubleSide, transparent: false });

const jitter = (seed: number, k = 0.12) => {
  const v = 1 - k / 2 + ((Math.sin(seed * 12.9898) * 43758.5453) % 1 + 1) % 1 * k;
  return new THREE.Color(v, v, v);
};

function tree(b: Blocks, x: number, y: number, z: number, h: number, kind: "oak" | "spruce") {
  for (let k = 0; k < h; k++) b.cube("log", blockMats("log"), x, y + k + 1, z);
  const leaf = kind === "oak" ? "leaves" : "spruce";
  const put = (dx: number, dy: number, dz: number) => b.cube(leaf, blockMats(leaf), x + dx, y + dy, z + dz, jitter(x * 31 + z * 17 + dx * 7 + dy * 3 + dz));
  if (kind === "oak") {
    for (const dy of [h - 1, h])
      for (let dx = -2; dx <= 2; dx++)
        for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
          if (dx === 0 && dz === 0) continue;
          put(dx, dy, dz);
        }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) put(dx, h + 1, dz);
    for (const [dx, dz] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      put(dx, h + 2, dz);
  } else {
    const radii = [2, 1, 2, 1, 1, 0];
    for (let i = 0; i < radii.length; i++) {
      const dy = h - radii.length + 2 + i;
      const r = radii[i];
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (r > 1 && Math.abs(dx) === r && Math.abs(dz) === r) continue;
          if (dx === 0 && dz === 0 && dy <= h) continue;
          put(dx, dy, dz);
        }
    }
    put(0, h + 2, 0);
  }
}

// ───────────────────────── 院子 ─────────────────────────

/** 各屋子的屋顶：材质与颜色 */
function roofStyle(theme: RoomTheme): { key: string; mats: THREE.Material | THREE.Material[] } {
  const t = textures();
  switch (theme.id) {
    case "minimal":
      return { key: "roof-min", mats: lam("roof-min", t.planks, { color: 0xe8e4dc }) };
    case "cabin":
      return { key: "roof-cabin", mats: lam("roof-cabin", t.darkPlanks) };
    case "tower":
      return { key: "roof-tower", mats: lam("roof-tower", blockTextures().roof, { color: 0x8aa0c8 }) };
    case "cellar":
      // 地下书库：屋顶是长满草的土丘
      return { key: "roof-cellar", mats: blockMats("grass") };
    case "washitsu":
      return { key: "roof-wa", mats: lam("roof-wa", blockTextures().roof, { color: 0x6a6e78 }) };
    default:
      return { key: "roof", mats: blockMats("roof") };
  }
}

export function buildYard(theme: RoomTheme, items?: GardenBlock[]): OutdoorBuild {
  const group = new THREE.Group();
  const b = new Blocks();
  const bt = blockTextures();
  const t = textures();
  const garden = gardenBlocks({ fireplace: theme.fireplace, items });
  const at = new Map<string, GardenBlock>();
  for (const g of garden) if (!at.has(`${g.x},${g.z}`) || g.h > 0) at.set(`${g.x},${g.z}`, g);
  const house = (x: number, z: number) => x >= -1 && x <= ROOM.w && z >= -1 && z <= ROOM.d;

  // 地面：院子和围栏下面一层草方块；小路是碎石，菜地是耕地
  for (let x = YARD.x0 - 1; x <= YARD.x1; x++)
    for (let z = YARD.z0 - 1; z <= YARD.z1; z++) {
      if (house(x, z)) continue;
      const g = at.get(`${x},${z}`);
      if (g?.kind === "path") b.cube("gravel", blockMats("gravel"), x, 0, z);
      else if (g?.kind === "farmland") b.cube("farmland", blockMats("farmland"), x, 0, z);
      else b.cube("grass", blockMats("grass"), x, 0, z);
    }
  // 门槛
  for (let x = DOOR.x0; x < DOOR.x1; x++) b.cube("threshold", lam("threshold", t.stoneBricks), x, 0.02, DOOR.z);

  // 花园里的东西
  const flowerMats = bt.flowers.map((f, i) => plantMat(`flower${i}`, f));
  const wheatMats = bt.wheat.map((f, i) => plantMat(`wheat${i}`, f));
  // 杂草：发黄一点的草，和野花区分开
  const weedMat = lam("weed", bt.tallgrass, { alphaTest: 0.5, side: THREE.DoubleSide, color: 0xd8c878 });
  for (const g of garden) {
    const { x, z } = g;
    switch (g.kind) {
      case "bed": {
        // 木框花坛，里面是土和花
        b.add("bedrim", lam("bedrim", t.planks), x + 0.5, 0.25, z + 0.5, { sy: 0.5 });
        b.add("bedsoil", lam("b-dirt-top", bt.dirt, { color: 0x9a8070 }), x + 0.5, 0.505, z + 0.5, { sx: 0.84, sy: 0.02, sz: 0.84 });
        const v = (g.variant ?? x * 7 + z * 3) % 4;
        b.add(`flower${v}`, flowerMats[v], x + 0.5, 0.5, z + 0.5, { geo: cross(), ry: (x + z) * 0.7 });
        break;
      }
      case "flower": {
        const v = (g.variant ?? 0) % 4;
        b.add(`flower${v}`, flowerMats[v], x + 0.5, 0, z + 0.5, { geo: cross(), ry: (x * 3 + z) * 0.37 });
        break;
      }
      case "weed":
        b.add("weed", weedMat, x + 0.5, 0, z + 0.5, { geo: cross(), ry: (x + z * 3) * 0.41 });
        break;
      case "farmland": {
        const v = (g.variant ?? x + z) % 3;
        b.add(`wheat${v}`, wheatMats[v], x + 0.5, 0, z + 0.5, { geo: cross() });
        break;
      }
      case "hay":
        for (let k = 1; k <= g.h; k++) b.cube("hay", blockMats("hay"), x, k, z);
        break;
      case "bench":
        b.add("benchtop", lam("benchtop", t.planks), x + 0.5, 0.42, z + 0.5, { sy: 0.16 });
        b.add("benchleg", lam("benchleg", t.darkPlanks), x + 0.5, 0.17, z + 0.5, { sx: 0.2, sy: 0.34, sz: 0.8 });
        break;
      case "table":
        b.add("tabletop", lam("tabletop", t.planks), x + 0.5, 0.92, z + 0.5, { sy: 0.16 });
        b.add("tableleg", lam("benchleg", t.darkPlanks), x + 0.5, 0.42, z + 0.5, { sx: 0.2, sy: 0.84, sz: 0.2 });
        break;
      case "woodpile":
        for (let k = 1; k <= g.h; k++) b.add("woodpile", [lam("b-bark", t.bark), lam("b-bark", t.bark), lam("b-bark", t.bark), lam("b-bark", t.bark), lam("b-logTop", bt.logTop), lam("b-logTop", bt.logTop)], x + 0.5, k - 0.5, z + 0.5);
        break;
      case "trunk":
        tree(b, x, 0, z, 5, "oak");
        break;
      case "bush":
        b.cube("leaves", blockMats("leaves"), x, 1, z, jitter(x * 13 + z));
        break;
      case "post":
        b.add("post", lam("b-fence", bt.fence), x + 0.5, 0.75, z + 0.5, { sx: 0.22, sy: 1.5, sz: 0.22 });
        b.add("lantern", blockMats("lantern"), x + 0.5, 1.75, z + 0.5, { sx: 0.5, sy: 0.5, sz: 0.5 });
        b.add("lanterncap", lam("lanterncap", t.darkPlanks), x + 0.5, 2.05, z + 0.5, { sx: 0.6, sy: 0.1, sz: 0.6 });
        break;
      case "well":
        b.cube("cobble", blockMats("cobble"), x, 1, z);
        b.add("wellwater", lam("wellwater", t.water), x + 0.5, 1.005, z + 0.5, { sx: 0.7, sy: 0.02, sz: 0.7 });
        for (const dx of [-0.42, 0.42]) b.add("post", lam("b-fence", bt.fence), x + 0.5 + dx, 1.6, z + 0.5, { sx: 0.12, sy: 1.2, sz: 0.12 });
        b.add("wellroof", blockMats("roof"), x + 0.5, 2.25, z + 0.5, { sx: 1.2, sy: 0.14, sz: 1 });
        break;
      case "chimney":
        for (let k = 1; k <= 10; k++) b.cube("chimney", blockMats("stoneBricks"), x, k, z);
        break;
      case "path":
        break;
    }
  }
  // 围栏：每格一根柱子，相邻柱子之间两道横杆；南边正对小路的是院门
  const fenceM = lam("b-fence", bt.fence);
  const ring: [number, number][] = [];
  for (let x = YARD.x0 - 1; x <= YARD.x1; x++) ring.push([x, YARD.z0 - 1], [x, YARD.z1]);
  for (let z = YARD.z0; z < YARD.z1; z++) ring.push([YARD.x0 - 1, z], [YARD.x1, z]);
  const isRing = new Set(ring.map(([x, z]) => `${x},${z}`));
  for (const [x, z] of ring) {
    const gate = z === YARD.z1 && x >= DOOR.x0 && x < DOOR.x1;
    if (!gate) b.add("fencepost", fenceM, x + 0.5, 0.75, z + 0.5, { sx: 0.25, sy: 1.5, sz: 0.25 });
    for (const [dx, dz] of [
      [1, 0],
      [0, 1],
    ]) {
      if (!isRing.has(`${x + dx},${z + dz}`)) continue;
      for (const y of [0.55, 1.15]) b.add(gate ? "gate" : "fencerail", gate ? lam("gate", t.planks) : fenceM, x + 0.5 + dx / 2, y, z + 0.5 + dz / 2, { sx: dx ? 1 : 0.12, sy: gate ? 0.3 : 0.16, sz: dz ? 1 : 0.12 });
    }
  }

  // 屋顶：沿 x 方向的人字形，一层层往里收
  const roof = roofStyle(theme);
  const texOf = (n: string) => (textures() as unknown as Record<string, THREE.Texture>)[n] ?? (roomTextures() as unknown as Record<string, THREE.Texture>)[n] ?? t.planks;
  const gable = lam(`gable-${theme.upper}`, texOf(theme.upper));
  for (let k = 0; k <= 7; k++) {
    const y = ROOM.h + k + 1;
    for (let x = -2; x <= ROOM.w + 1; x++) {
      if (theme.fireplace && x === -2 && ROOM.d + 1 - k >= 4 && ROOM.d + 1 - k <= 6) continue;
      if (theme.fireplace && x === -2 && -2 + k >= 4 && -2 + k <= 6) continue;
      b.cube(roof.key, roof.mats, x, y, -2 + k);
      b.cube(roof.key, roof.mats, x, y, ROOM.d + 1 - k);
    }
    // 山墙
    for (let z = -1 + k; z <= ROOM.d - k; z++) {
      b.cube("gable", gable, -1, y, z);
      b.cube("gable", gable, ROOM.w, y, z);
    }
  }

  b.build(group);
  group.traverse((o) => {
    o.userData.occluder = true;
    o.userData.yard = true;
  });
  return {
    group,
    glow: [blockMats("lantern") as THREE.MeshLambertMaterial],
    dispose: () => group.traverse((o) => (o as THREE.InstancedMesh).dispose?.()),
  };
}

// ───────────────────────── 远景地形 ─────────────────────────

export function buildTerrain(tr: Terrain): OutdoorBuild {
  const group = new THREE.Group();
  const b = new Blocks();
  const bt = blockTextures();
  const depth = exposedDepth(tr);
  for (const c of tr.columns) {
    const d = depth.get(`${c.x},${c.z}`) ?? 1;
    for (let k = 0; k < d; k++) {
      const top = c.h - k;
      // 顶上一格用表层材质，下面是泥土 / 石头
      const kind: BlockKind = k === 0 ? c.top : c.top === "snow" || c.top === "stone" || k > 3 ? "stone" : c.top === "sand" ? "sand" : c.top === "asphalt" || c.top === "gravel" ? "stone" : "dirt";
      b.cube(kind, blockMats(kind), c.x, top, c.z, k === 0 && (kind === "grass" || kind === "moss") ? jitter(c.x * 7 + c.z * 13, 0.08) : undefined);
    }
  }
  const glow: THREE.MeshLambertMaterial[] = [];
  const buildings: Record<number, THREE.BufferGeometry[]> = {};
  const flowerMats = bt.flowers.map((f, i) => plantMat(`flower${i}`, f));
  const wheatMats = bt.wheat.map((f, i) => plantMat(`wheat${i}`, f));
  const grassMat = plantMat("tallgrass", bt.tallgrass);
  const bambooM = lam("b-bamboo", bt.bamboo);
  for (const f of tr.features) {
    switch (f.kind) {
      case "oak":
      case "spruce":
        tree(b, f.x, f.y, f.z, f.h ?? 5, f.kind);
        break;
      case "bamboo": {
        const h = f.h ?? 8;
        const ox = ((f.x * 37) % 5) / 10 - 0.2;
        const oz = ((f.z * 53) % 5) / 10 - 0.2;
        for (let k = 0; k < h; k++) b.add("bamboo", bambooM, f.x + 0.5 + ox, f.y + k + 0.5, f.z + 0.5 + oz, { sx: 0.24, sz: 0.24 });
        for (let k = 0; k < 3; k++) b.add("bambooleaf", blockMats("leaves"), f.x + 0.5 + ox + (k - 1) * 0.35, f.y + h - k * 1.4, f.z + 0.5 + oz + ((k % 2) - 0.5) * 0.4, { sx: 0.7, sy: 0.35, sz: 0.7, color: jitter(f.x + k) });
        break;
      }
      case "flower":
        b.add(`flower${f.variant ?? 0}`, flowerMats[(f.variant ?? 0) % 4], f.x + 0.5, f.y, f.z + 0.5, { geo: cross(), ry: f.x * 0.37 });
        break;
      case "tallgrass":
        b.add("tallgrass", grassMat, f.x + 0.5, f.y, f.z + 0.5, { geo: cross(), ry: f.z * 0.41 });
        break;
      case "crop":
        b.add(`wheat${f.variant ?? 0}`, wheatMats[(f.variant ?? 0) % 3], f.x + 0.5, f.y, f.z + 0.5, { geo: cross() });
        break;
      case "hay":
        b.cube("hay", blockMats("hay"), f.x, f.y + 1, f.z);
        break;
      case "rock":
        b.cube("cobble", blockMats("cobble"), f.x, f.y + 1, f.z);
        break;
      case "lamp":
        b.add("post", lam("b-fence", bt.fence), f.x + 0.5, f.y + 1.5, f.z + 0.5, { sx: 0.2, sy: 3, sz: 0.2 });
        b.add("lantern", blockMats("lantern"), f.x + 0.5, f.y + 3.2, f.z + 0.5, { sx: 0.5, sy: 0.5, sz: 0.5 });
        break;
      case "building": {
        const w = f.w ?? 5,
          d = f.d ?? 5,
          h = f.h ?? 10;
        const g = new THREE.BoxGeometry(w, h, d);
        const uv = g.attributes.uv as THREE.BufferAttribute;
        const dims: [number, number][] = [
          [d, h],
          [d, h],
          [w, d],
          [w, d],
          [w, h],
          [w, h],
        ];
        for (let face = 0; face < 6; face++) for (let v = 0; v < 4; v++) uv.setXY(face * 4 + v, uv.getX(face * 4 + v) * dims[face][0], uv.getY(face * 4 + v) * dims[face][1] / 1);
        g.translate(f.x + w / 2, f.y + h / 2, f.z + d / 2);
        (buildings[f.variant ?? 0] ??= []).push(g);
        break;
      }
    }
  }
  for (const [v, geos] of Object.entries(buildings)) {
    const i = Number(v);
    const m = new THREE.MeshLambertMaterial({ map: bt.facades[i], emissive: 0xffd27a, emissiveMap: bt.facadeLights[i], emissiveIntensity: 0 });
    const roofM = lam("bldg-roof", bt.asphalt, { color: 0x9a9a9a });
    glow.push(m);
    const merged = mergeGeometries(geos, true);
    if (!merged) continue;
    // 顶面换成屋顶材质：每个盒子 6 组面，按组号分配
    const mats: THREE.Material[] = [m, roofM];
    merged.clearGroups();
    const per = geos[0].index!.count / 6;
    geos.forEach((_, gi) => {
      for (let face = 0; face < 6; face++) merged.addGroup((gi * 6 + face) * per, per, face === 2 || face === 3 ? 1 : 0);
    });
    group.add(new THREE.Mesh(merged, mats));
  }
  b.build(group);
  glow.push(blockMats("lantern") as THREE.MeshLambertMaterial);

  // 远处的大地面：地形范围外四块，与最外圈衔接，雾会把它们淡进天空
  const B = tr.bounds;
  const farKind = tr.far;
  const farTex = (farKind === "water" ? blockTextures().sand : farKind === "asphalt" ? bt.asphalt : bt.grassTop).clone();
  farTex.wrapS = farTex.wrapT = THREE.RepeatWrapping;
  farTex.needsUpdate = true;
  const farY = farKind === "water" ? -4 : 0;
  const S = 400;
  const cx = (B.x0 + B.x1) / 2,
    cz = (B.z0 + B.z1) / 2;
  const strips: [number, number, number, number][] = [
    [cx, B.z0 - S / 2, S * 2 + (B.x1 - B.x0), S],
    [cx, B.z1 + S / 2, S * 2 + (B.x1 - B.x0), S],
    [B.x0 - S / 2, cz, S, B.z1 - B.z0],
    [B.x1 + S / 2, cz, S, B.z1 - B.z0],
  ];
  for (const [x, z, w, d] of strips) {
    const tex = farTex.clone();
    tex.repeat.set(w, d);
    tex.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: tex }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, farY, z);
    group.add(m);
  }
  // 海面
  if (tr.water !== null) {
    const wt = textures().water.clone();
    wt.wrapS = wt.wrapT = THREE.RepeatWrapping;
    wt.repeat.set(600, 600);
    wt.needsUpdate = true;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ map: wt, transparent: true, opacity: 0.82, depthWrite: false }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(cx, tr.water, cz);
    water.renderOrder = 1;
    water.name = "sea";
    group.add(water);
  }
  group.traverse((o) => (o.userData.occluder = true));
  void insideFence;
  return {
    group,
    glow,
    dispose: () =>
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if ((m as THREE.InstancedMesh).isInstancedMesh) (m as THREE.InstancedMesh).dispose();
        else if (m.isMesh) {
          m.geometry.dispose();
          for (const mm of Array.isArray(m.material) ? m.material : [m.material]) if (!cached.has(mm)) {
            (mm as THREE.MeshLambertMaterial).map?.dispose();
            mm.dispose();
          }
        }
      }),
  };
}
