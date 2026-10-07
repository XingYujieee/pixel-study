// 书架上的书：每个书架一个 InstancedMesh，实例编号对应文件路径。
import * as THREE from "three";
import type { FileKind } from "../ipc";
import { hashString } from "./layout";
import { SHELF_INNER_X, SHELF_ROWS } from "./models";
import { BOOK_COLORS, textures } from "./textures";

export interface BookItem {
  path: string;
  kind: FileKind;
  /** 蒙灰程度 0–1（久没碰） */
  dust?: number;
  /** 发亮程度 0–1（常被引用） */
  glow?: number;
}

export interface BookSlot {
  path: string;
  /** 局部坐标中的包围盒 */
  min: THREE.Vector3;
  max: THREE.Vector3;
}

/** 计算书的摆放：按行从左到右，厚度与高度由路径哈希决定，偶尔斜靠一本。 */
export function arrangeBooks(items: BookItem[]): { slots: (BookSlot & { tilt: number; color: string })[]; overflow: number } {
  const slots: (BookSlot & { tilt: number; color: string })[] = [];
  let row = 0;
  let x = -SHELF_INNER_X;
  let i = 0;
  for (; i < items.length; i++) {
    const it = items[i];
    const h = hashString(it.path);
    const thick = 0.09 + ((h >>> 3) % 6) * 0.012;
    const r = SHELF_ROWS[row];
    const height = r.h * (0.7 + ((h >>> 9) % 25) / 100);
    const depth = 0.6 + ((h >>> 14) % 12) / 100;
    if (x + thick > SHELF_INNER_X) {
      row++;
      if (row >= SHELF_ROWS.length) break;
      x = -SHELF_INNER_X;
    }
    const rr = SHELF_ROWS[row];
    const palette = BOOK_COLORS[it.kind] ?? BOOK_COLORS.other;
    const color = palette[(h >>> 20) % palette.length];
    const tilt = (h >>> 5) % 17 === 0 && x > -SHELF_INNER_X + 0.3 ? 0.18 : 0;
    const zFront = 0.4;
    slots.push({
      path: it.path,
      color,
      tilt,
      min: new THREE.Vector3(x, rr.y, zFront - depth),
      max: new THREE.Vector3(x + thick, rr.y + height, zFront),
    });
    x += thick + 0.006 + (tilt ? 0.08 : 0);
  }
  return { slots, overflow: items.length - i };
}

let geo: THREE.BoxGeometry | null = null;
let mats: THREE.Material[] | null = null;
let dustMat: THREE.MeshLambertMaterial | null = null;
let glintMat: THREE.MeshBasicMaterial | null = null;

function bookMaterials(): THREE.Material[] {
  if (mats) return mats;
  const t = textures();
  const cover = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const spine = new THREE.MeshLambertMaterial({ map: t.bookSpine });
  const pages = new THREE.MeshLambertMaterial({ map: t.pages });
  // +x, -x, +y, -y, +z(书脊朝外), -z
  mats = [cover, cover, pages, cover, spine, cover];
  return mats;
}

const DUST = new THREE.Color("#9c978c");
/** 放书动画时长（毫秒） */
const DROP_MS = 520;

/** 落下回弹：0 → 1 */
function bounce(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

interface Placed {
  pos: THREE.Vector3;
  q: THREE.Quaternion;
  scale: THREE.Vector3;
}

export class ShelfBooks {
  readonly mesh: THREE.InstancedMesh;
  readonly slots: BookSlot[];
  readonly overflow: number;
  /** 书顶上的灰（不参与瞄准） */
  readonly dust: THREE.InstancedMesh | null = null;
  /** 发亮的书前面一闪一闪的小光点 */
  readonly glints: THREE.InstancedMesh | null = null;
  private placed: Placed[] = [];
  private drops = new Map<number, number>();
  private glintIdx: number[] = [];

  /** fresh：刚放上来的书 → 落下动画的开始时间（重建时接着播放未完成的动画） */
  constructor(items: BookItem[], fid: string, fresh: Map<string, number> = new Map()) {
    geo ??= new THREE.BoxGeometry(1, 1, 1);
    const { slots, overflow } = arrangeBooks(items);
    this.slots = slots;
    this.overflow = overflow;
    this.mesh = new THREE.InstancedMesh(geo, bookMaterials(), Math.max(1, slots.length));
    this.mesh.count = slots.length;
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    const dusty: { i: number; level: number }[] = [];
    const now = performance.now();
    slots.forEach((s, i) => {
      const scale = new THREE.Vector3().subVectors(s.max, s.min);
      const pos = new THREE.Vector3().addVectors(s.min, s.max).multiplyScalar(0.5);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -s.tilt);
      if (s.tilt) pos.x += Math.sin(s.tilt) * scale.y * 0.5;
      this.placed.push({ pos, q, scale });
      m.compose(pos, q, scale);
      this.mesh.setMatrixAt(i, m);
      const it = items[i];
      color.set(s.color);
      const dust = it.dust ?? 0;
      const glow = it.glow ?? 0;
      if (dust > 0) {
        color.lerp(DUST, dust * 0.55);
        dusty.push({ i, level: dust });
      }
      if (glow > 0) {
        color.multiplyScalar(1 + glow * 0.6);
        this.glintIdx.push(i);
      }
      this.mesh.setColorAt(i, color);
      const t0 = fresh.get(s.path);
      if (t0 !== undefined && now - t0 < DROP_MS) this.drops.set(i, t0);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.userData.fid = fid;
    this.mesh.userData.books = this;
    this.mesh.computeBoundingSphere();

    if (dusty.length) {
      dustMat ??= new THREE.MeshLambertMaterial({ color: 0xd8d2c4 });
      const d = new THREE.InstancedMesh(geo, dustMat, dusty.length);
      dusty.forEach(({ i, level }, k) => {
        const s = slots[i];
        const p = this.placed[i];
        const thick = 0.012 + level * 0.02;
        m.compose(
          new THREE.Vector3(p.pos.x, s.max.y + thick / 2, p.pos.z),
          p.q,
          new THREE.Vector3(p.scale.x + 0.004, thick, p.scale.z * (0.6 + level * 0.4)),
        );
        d.setMatrixAt(k, m);
      });
      d.userData.ghost = true;
      d.computeBoundingSphere();
      this.dust = d;
      this.mesh.add(d);
    }
    if (this.glintIdx.length) {
      glintMat ??= new THREE.MeshBasicMaterial({ color: 0xfff1a8 });
      const gm = new THREE.InstancedMesh(geo, glintMat, this.glintIdx.length);
      gm.userData.ghost = true;
      gm.frustumCulled = false;
      this.glints = gm;
      this.mesh.add(gm);
      this.updateGlints(now);
    }
    // 落下动画的书先放在起点
    if (this.drops.size) this.animate(now);
  }

  private updateGlints(now: number) {
    if (!this.glints) return;
    const m = new THREE.Matrix4();
    this.glintIdx.forEach((i, k) => {
      const s = this.slots[i];
      const p = this.placed[i];
      // 每本书的闪烁相位不同；沿书脊上下缓慢移动
      const phase = (i * 0.37) % 1;
      const t = (now / 1600 + phase) % 1;
      const size = Math.max(0, Math.sin(t * Math.PI)) * 0.055;
      const y = s.min.y + (s.max.y - s.min.y) * (0.2 + 0.6 * ((t + phase) % 1));
      m.compose(new THREE.Vector3(p.pos.x, y, s.max.z + 0.03), new THREE.Quaternion(), new THREE.Vector3(size, size, size));
      this.glints!.setMatrixAt(k, m);
    });
    this.glints.instanceMatrix.needsUpdate = true;
  }

  /** 每帧调用：放书动画与光点。返回是否有放书动画在播放（需要每帧重绘）。 */
  animate(now: number): boolean {
    let active = false;
    if (this.drops.size) {
      const m = new THREE.Matrix4();
      const wobble = new THREE.Quaternion();
      for (const [i, t0] of this.drops) {
        const k = Math.min(1, (now - t0) / DROP_MS);
        const p = this.placed[i];
        const lift = (1 - bounce(k)) * 0.45;
        wobble.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(k * Math.PI * 3) * 0.12 * (1 - k));
        m.compose(new THREE.Vector3(p.pos.x, p.pos.y + lift, p.pos.z), wobble.multiply(p.q), p.scale);
        this.mesh.setMatrixAt(i, m);
        if (k >= 1) this.drops.delete(i);
      }
      this.mesh.instanceMatrix.needsUpdate = true;
      active = true;
    }
    // 光点随空闲时的低帧率刷新即可，不要求每帧重绘
    if (this.glints) this.updateGlints(now);
    return active;
  }

  /** 还在播放落下动画的书 → 开始时间 */
  get dropping(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [i, t0] of this.drops) out.set(this.slots[i].path, t0);
    return out;
  }

  dispose() {
    this.dust?.dispose();
    this.glints?.dispose();
    this.mesh.dispose();
  }
}
