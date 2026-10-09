// 拿在手上的东西：唱片、园艺工具（树苗、花种、铲子……）的方块模型，以及唱片封套。
import * as THREE from "three";
import type { PlantKind } from "./gardenEdit";
import { RECORD_SLOT } from "./models";

export type GardenTool = PlantKind | "shovel";

/** 走到院子里时物品栏换成这些：1 空手，2–7 种东西，8 铲子 */
export const GARDEN_HOTBAR: (GardenTool | null)[] = [null, "tree", "flower", "bush", "hay", "bed", "farmland", "shovel"];

export const TOOL_NAMES: Record<GardenTool, string> = {
  tree: "树苗",
  flower: "花种",
  bush: "灌木苗",
  hay: "草垛",
  bed: "花坛",
  farmland: "菜地",
  shovel: "铲子",
};

/** 准星对准地面时的提示 */
export const PLACE_LABEL: Record<Exclude<GardenTool, "shovel">, string> = {
  tree: "种一棵树",
  flower: "种花",
  bush: "种灌木",
  hay: "放草垛（可以叠高）",
  bed: "砌花坛",
  farmland: "开一块菜地",
};

const texCache = new WeakMap<HTMLCanvasElement, THREE.CanvasTexture>();

/** 封面画布 → 纹理（最近邻放大，保持像素感） */
export function coverTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  let t = texCache.get(c);
  if (!t) {
    t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    t.userData.shared = true;
    texCache.set(c, t);
  }
  return t;
}

const sleeveSide = new THREE.MeshLambertMaterial({ color: 0xe8dcc4 });
sleeveSide.userData.shared = true;

/** 唱片封套：正面是封面，其余是纸板色；封口处露出一点黑胶 */
export function recordSleeve(cover: HTMLCanvasElement): THREE.Group {
  const g = new THREE.Group();
  const front = new THREE.MeshLambertMaterial({ map: coverTexture(cover) });
  const back = new THREE.MeshLambertMaterial({ map: coverTexture(cover), color: 0x8a8a8a });
  const { w, h, d } = RECORD_SLOT;
  // BoxGeometry 面顺序：+x, -x, +y, -y, +z, -z
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [sleeveSide, sleeveSide, sleeveSide, sleeveSide, front, back]);
  sleeve.name = "sleeve";
  g.add(sleeve);
  const vinyl = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.46, h * 0.46, d * 0.6, 16), vinylMat);
  vinyl.rotation.x = Math.PI / 2;
  vinyl.position.set(w * 0.2, 0, 0);
  vinyl.name = "peek";
  g.add(vinyl);
  sleeve.renderOrder = 1;
  return g;
}

const vinylMat = new THREE.MeshLambertMaterial({ color: 0x15151a });
vinylMat.userData.shared = true;

function lam(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

function cube(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(color));
  m.position.set(x, y, z);
  return m;
}

/** 园艺工具的手持模型（大小约 0.35） */
export function buildTool(tool: GardenTool): THREE.Group {
  const g = new THREE.Group();
  switch (tool) {
    case "tree": {
      // 一小盆树苗
      g.add(cube(0.16, 0.1, 0.16, 0x8a5a3a, 0, -0.1, 0));
      g.add(cube(0.03, 0.16, 0.03, 0x6b4a2a, 0, 0.02, 0));
      g.add(cube(0.14, 0.1, 0.14, 0x4f9a3c, 0, 0.14, 0));
      g.add(cube(0.08, 0.06, 0.08, 0x6fbf55, 0.02, 0.22, 0.02));
      break;
    }
    case "flower": {
      // 一小包种子
      g.add(cube(0.16, 0.22, 0.03, 0xf2e2b8, 0, 0, 0));
      g.add(cube(0.08, 0.08, 0.032, 0xe8604a, 0, 0.03, 0.001));
      g.add(cube(0.03, 0.03, 0.034, 0xffd166, 0, 0.03, 0.002));
      g.add(cube(0.02, 0.06, 0.034, 0x4f9a3c, 0, -0.04, 0.002));
      break;
    }
    case "bush":
      g.add(cube(0.22, 0.2, 0.22, 0x3e8a35, 0, 0, 0));
      g.add(cube(0.1, 0.06, 0.1, 0x5aab48, 0.05, 0.1, 0.05));
      break;
    case "hay":
      g.add(cube(0.24, 0.2, 0.24, 0xd8b04a, 0, 0, 0));
      g.add(cube(0.25, 0.03, 0.25, 0xa8742a, 0, 0.04, 0));
      g.add(cube(0.25, 0.03, 0.25, 0xa8742a, 0, -0.05, 0));
      break;
    case "bed":
      g.add(cube(0.26, 0.1, 0.18, 0x9a6a3a, 0, 0, 0));
      g.add(cube(0.22, 0.03, 0.14, 0x5a3a24, 0, 0.05, 0));
      g.add(cube(0.04, 0.06, 0.04, 0xe86a8a, -0.05, 0.09, 0));
      g.add(cube(0.04, 0.06, 0.04, 0xf6c86a, 0.05, 0.09, 0));
      break;
    case "farmland":
      g.add(cube(0.24, 0.12, 0.24, 0x6b4a2a, 0, 0, 0));
      for (const x of [-0.07, 0, 0.07]) g.add(cube(0.03, 0.03, 0.2, 0x4a3018, x, 0.07, 0));
      g.add(cube(0.03, 0.06, 0.03, 0x6fbf55, 0.0, 0.1, 0.05));
      break;
    case "shovel": {
      // 木柄 + 铁铲头，斜着拿
      g.add(cube(0.03, 0.42, 0.03, 0x9a6a3a, 0, 0.06, 0));
      g.add(cube(0.08, 0.03, 0.03, 0x6b4a2a, 0, 0.28, 0));
      g.add(cube(0.12, 0.13, 0.02, 0xb8bcc4, 0, -0.2, 0));
      g.add(cube(0.08, 0.04, 0.021, 0xd8dce4, 0, -0.27, 0.001));
      g.rotation.z = 0.35;
      break;
    }
  }
  return g;
}
