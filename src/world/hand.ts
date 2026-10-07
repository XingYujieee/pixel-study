// 第一人称手持：屏幕右下角的方块手臂，手里拿着物品栏里选中的家具（缩小模型）。
// 单独的场景与相机，叠加在主画面之上渲染，所以不会穿进墙里。
import * as THREE from "three";
import type { FurnitureType } from "./layout";
import { buildFurniture } from "./models";

function pixelCanvas(w: number, h: number, draw: (set: (x: number, y: number, c: string) => void) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  draw((x, y, col) => {
    g.fillStyle = col;
    g.fillRect(x, y, 1, 1);
  });
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SKIN = [226, 178, 140];
const skin = (k: number) => `rgb(${Math.round(SKIN[0] * k)},${Math.round(SKIN[1] * k)},${Math.round(SKIN[2] * k)})`;

/** 手臂侧面：4×12 像素，上面 4 行是袖子（带一条袖口），下面是皮肤 */
function armSide(seed: number): THREE.CanvasTexture {
  return pixelCanvas(4, 12, (set) => {
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < 4; x++) {
        const n = ((x * 7 + y * 13 + seed * 5) % 5) * 0.02;
        if (y < 4) set(x, y, y === 3 ? "#2f5470" : (x + y) % 3 === 0 ? "#45779c" : "#3e6b8f");
        else set(x, y, skin(0.95 + n - (y > 9 ? 0.03 : 0)));
      }
  });
}

/** 手掌那一端：4×4，指节一点高光 */
function armEnd(): THREE.CanvasTexture {
  return pixelCanvas(4, 4, (set) => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) set(x, y, skin(y === 0 ? 1.04 : 0.97));
    set(0, 0, skin(1.08));
    set(2, 0, skin(1.08));
  });
}

/** 袖口那一端（基本看不到） */
function sleeveEnd(): THREE.CanvasTexture {
  return pixelCanvas(4, 4, (set) => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) set(x, y, "#2f5470");
  });
}

export class HandView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
  private rig = new THREE.Group();
  private arm: THREE.Mesh;
  private item: THREE.Object3D | null = null;
  private itemType: FurnitureType | null | undefined = undefined;
  private swingT = 1;
  private useT = 1;
  private time = 0;
  private equipT = 1;
  private pendingType: FurnitureType | null = null;
  private bob = 0;
  private hemi: THREE.HemisphereLight;
  private reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  visible = true;

  constructor() {
    this.hemi = new THREE.HemisphereLight(0xfff4e0, 0x6b5440, 2.2);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(-1, 2, 1);
    this.scene.add(this.hemi, key);
    // 4×12×4 像素比例的方块手臂。BoxGeometry 面顺序：+x, -x, +y, -y, +z, -z。
    // 长边先沿 y（袖子在 +y 一端），再转到 z：袖子朝向镜头，手掌朝前
    const side = (sd: number) => new THREE.MeshLambertMaterial({ map: armSide(sd) });
    const mats = [side(1), side(2), new THREE.MeshLambertMaterial({ map: sleeveEnd() }), new THREE.MeshLambertMaterial({ map: armEnd() }), side(3), side(4)];
    const geo = new THREE.BoxGeometry(0.19, 0.62, 0.19);
    geo.rotateX(Math.PI / 2);
    this.arm = new THREE.Mesh(geo, mats);
    this.rig.add(this.arm);
    this.scene.add(this.rig);
    this.layout();
  }

  private layout() {
    // 空手时手臂斜着从右下伸出；拿着东西时更靠前、稍微抬起来展示
    if (this.itemType) {
      this.rig.position.set(0.4, -0.4, -0.72);
      this.rig.rotation.set(0.5, 0.22, 0.05);
    } else {
      this.rig.position.set(0.44, -0.44, -0.66);
      this.rig.rotation.set(0.62, 0.3, 0.08);
    }
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** 切换手持物品：手先放下再举起 */
  setItem(type: FurnitureType | null) {
    if (type === this.itemType) return;
    if (this.itemType === undefined || this.reduceMotion) {
      this.applyItem(type);
      return;
    }
    this.pendingType = type;
    this.equipT = 0;
  }

  private applyItem(type: FurnitureType | null) {
    this.itemType = type;
    if (this.item) this.rig.remove(this.item);
    this.item = null;
    this.arm.visible = true;
    if (!type) return;
    const model = buildFurniture({ id: "held", type, x: 0, z: 0, rot: 0 });
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    // 去掉椅子等附属物，缩放到手掌大小
    const chair = model.getObjectByName("chair");
    if (chair) chair.removeFromParent();
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = 0.34 / Math.max(size.x, size.y, size.z, 0.01);
    const holder = new THREE.Group();
    model.scale.setScalar(scale);
    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
    model.position.sub(center);
    holder.add(model);
    holder.position.set(-0.02, 0.2, -0.36);
    holder.rotation.set(0.15, 0.7, 0);
    this.item = holder;
    this.rig.add(holder);
  }

  /** 左键：像方块游戏那样挥一下（先快后慢的弧线） */
  swing() {
    if (!this.reduceMotion) this.swingT = 0;
  }

  /** 右键放东西：往前一推 */
  use() {
    if (!this.reduceMotion) this.useT = 0;
  }

  /** 每帧更新：walking 为本帧移动距离，light 为环境明暗（0–1） */
  update(dt: number, walking: number, light: number) {
    this.hemi.intensity = 0.9 + 1.3 * light;
    this.layout();
    this.time += dt;
    // 站着时轻微呼吸
    if (!this.reduceMotion) {
      this.rig.position.y += Math.sin(this.time * 1.6) * 0.006;
      this.rig.rotation.x += Math.sin(this.time * 1.6) * 0.008;
    }
    if (!this.reduceMotion && walking > 0) this.bob += walking * 2.2;
    const bobX = Math.sin(this.bob) * 0.025;
    const bobY = Math.abs(Math.cos(this.bob)) * 0.03;
    this.rig.position.x += bobX;
    this.rig.position.y -= bobY;
    if (this.equipT < 1) {
      this.equipT = Math.min(1, this.equipT + dt * 4.5);
      if (this.equipT >= 0.5 && this.pendingType !== undefined && this.itemType !== this.pendingType) this.applyItem(this.pendingType);
      const down = this.equipT < 0.5 ? this.equipT * 2 : (1 - this.equipT) * 2;
      this.rig.position.y -= down * 0.5;
    }
    if (this.swingT < 1) {
      this.swingT = Math.min(1, this.swingT + dt * 4.2);
      // 方块游戏式挥手：前半程快、后半程慢，同时向内转
      const k = this.swingT;
      const a = Math.sin(Math.sqrt(k) * Math.PI);
      const b = Math.sin(k * k * Math.PI);
      this.rig.rotation.x -= a * 0.9;
      this.rig.rotation.y += b * 0.45;
      this.rig.rotation.z -= b * 0.25;
      this.rig.position.x -= a * 0.16;
      this.rig.position.y += Math.sin(Math.sqrt(k) * Math.PI * 2) * 0.05;
      this.rig.position.z -= a * 0.1;
    }
    if (this.useT < 1) {
      this.useT = Math.min(1, this.useT + dt * 6);
      const u = Math.sin(this.useT * Math.PI);
      this.rig.position.z -= u * 0.16;
      this.rig.position.y += u * 0.04;
      this.rig.rotation.x -= u * 0.25;
    }
  }

  render(renderer: THREE.WebGLRenderer) {
    if (!this.visible) return;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }
}
