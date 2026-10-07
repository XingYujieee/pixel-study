// 书房管家：一只方块小鸟（猫头鹰 / 鹦鹉 / 麻雀，原创造型）。
// 平时停在书架顶上；叫它出来就飞到你肩膀旁边跟着；带路时先飞过去，在目标上方盘旋。
import * as THREE from "three";
import type { BirdKind } from "./layout";

const PALETTES: Record<BirdKind, { body: number; belly: number; wing: number; head: number; beak: number; eye: number; tail: number }> = {
  owl: { body: 0x8a6440, belly: 0xe2c9a0, wing: 0x6b4a2e, head: 0x8a6440, beak: 0xe0a030, eye: 0xffd23a, tail: 0x6b4a2e },
  parrot: { body: 0x3fae4a, belly: 0x7fd36a, wing: 0x2f6fd0, head: 0xd8402e, beak: 0xf4e4a0, eye: 0xffffff, tail: 0x2f6fd0 },
  sparrow: { body: 0xa07850, belly: 0xeadbc4, wing: 0x6e4c30, head: 0x7a5a3a, beak: 0x4a3a2a, eye: 0x1a1a1a, tail: 0x6e4c30 },
};

export const BIRD_NAMES: Record<BirdKind, string> = { owl: "猫头鹰", parrot: "鹦鹉", sparrow: "麻雀" };

function cube(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  return m;
}

export function buildBird(kind: BirdKind): THREE.Group {
  const p = PALETTES[kind];
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = "body";
  g.add(body);
  const s = kind === "sparrow" ? 0.8 : kind === "parrot" ? 0.95 : 1;
  // 身体与肚子
  body.add(cube(0.24 * s, 0.26 * s, 0.22 * s, p.body, 0, 0.17 * s, 0));
  body.add(cube(0.16 * s, 0.18 * s, 0.02, p.belly, 0, 0.15 * s, 0.115 * s));
  // 头
  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, 0.36 * s, 0.01);
  head.add(cube(0.24 * s, 0.2 * s, 0.22 * s, p.head, 0, 0, 0));
  if (kind === "owl") {
    // 脸盘、耳羽
    head.add(cube(0.2, 0.14, 0.02, p.belly, 0, -0.005, 0.115));
    head.add(cube(0.05, 0.07, 0.05, p.body, -0.09, 0.12, 0));
    head.add(cube(0.05, 0.07, 0.05, p.body, 0.09, 0.12, 0));
  }
  if (kind === "parrot") head.add(cube(0.06, 0.06, 0.12, 0x3fae4a, 0, 0.11, -0.02));
  const eyes = new THREE.Group();
  eyes.name = "eyes";
  const eyeSize = kind === "owl" ? 0.065 : 0.04;
  for (const x of [-0.055, 0.055]) {
    eyes.add(cube(eyeSize, eyeSize, 0.02, p.eye, x * s, 0.01, 0.125 * s));
    eyes.add(cube(eyeSize * 0.5, eyeSize * 0.5, 0.02, 0x111111, x * s, 0.01, 0.135 * s));
  }
  head.add(eyes);
  head.add(cube(0.05 * s, 0.05 * s, 0.06 * s, p.beak, 0, -0.04 * s, 0.13 * s));
  body.add(head);
  // 翅膀（绕肩膀转）
  for (const side of [-1, 1]) {
    const w = new THREE.Group();
    w.name = side < 0 ? "wingL" : "wingR";
    w.position.set(side * 0.125 * s, 0.26 * s, 0);
    w.add(cube(0.03, 0.2 * s, 0.18 * s, p.wing, side * 0.015, -0.09 * s, 0));
    body.add(w);
  }
  // 尾巴与脚
  const tailLen = kind === "parrot" ? 0.26 : 0.1;
  const tail = cube(0.1 * s, 0.03, tailLen, p.tail, 0, 0.08 * s, -0.12 * s - tailLen / 2);
  tail.rotation.x = 0.35;
  body.add(tail);
  for (const x of [-0.05, 0.05]) body.add(cube(0.03, 0.04, 0.05, 0xd8a040, x * s, 0.02, 0.02));
  g.traverse((o) => (o.userData.bird = true));
  return g;
}

/** 说话气泡：白底黑字的像素气泡，最多三行 */
function bubbleTexture(text: string): { tex: THREE.CanvasTexture; aspect: number } {
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const font = '14px "Fusion Pixel", "PingFang SC", sans-serif';
  g.font = font;
  const lines: string[] = [];
  let cur = "";
  for (const ch of text.replace(/\s+/g, " ")) {
    if (g.measureText(cur + ch).width > 168) {
      lines.push(cur);
      cur = ch;
      if (lines.length === 3) break;
    } else cur += ch;
  }
  if (lines.length < 3 && cur) lines.push(cur);
  else if (lines.length === 3) lines[2] = lines[2].slice(0, -1) + "…";
  const w = Math.max(48, Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width))) + 16);
  const h = lines.length * 18 + 14;
  c.width = w;
  c.height = h + 8;
  g.font = font;
  g.fillStyle = "#2a2a2a";
  g.fillRect(1, 0, w - 2, h);
  g.fillRect(0, 1, w, h - 2);
  g.fillStyle = "#ffffff";
  g.fillRect(2, 1, w - 4, h - 2);
  g.fillRect(1, 2, w - 2, h - 4);
  // 小尾巴
  g.fillStyle = "#2a2a2a";
  g.fillRect(w / 2 - 4, h - 1, 8, 3);
  g.fillRect(w / 2 - 2, h + 2, 4, 3);
  g.fillStyle = "#ffffff";
  g.fillRect(w / 2 - 3, h - 2, 6, 3);
  g.fillRect(w / 2 - 1, h + 1, 2, 3);
  g.fillStyle = "#1e1e1e";
  g.textBaseline = "top";
  lines.forEach((l, i) => g.fillText(l, 8, 8 + i * 18));
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: c.width / c.height };
}

export type BirdMode = "perch" | "follow" | "fly" | "hover";

export interface BirdWorld {
  player: { x: number; y: number; z: number; yaw: number };
  /** 停的地方（书架顶上） */
  perch: THREE.Vector3;
}

export class BirdSystem {
  readonly root = new THREE.Group();
  private model: THREE.Group | null = null;
  private kind: BirdKind | null = null;
  mode: BirdMode = "perch";
  private pos = new THREE.Vector3(7, 3.05, 1);
  private vel = new THREE.Vector3();
  private target = new THREE.Vector3();
  private arrive: (() => void) | null = null;
  private flap = 0;
  private bubble: THREE.Sprite | null = null;
  private bubbleUntil = 0;
  private reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  /** 隐藏（在专注模式等） */
  hidden = false;

  setKind(kind: BirdKind) {
    if (kind === this.kind && this.model) return;
    if (this.model) this.root.remove(this.model);
    this.kind = kind;
    this.model = buildBird(kind);
    this.root.add(this.model);
  }

  get position() {
    return this.pos;
  }

  /** 叫出来：飞到肩膀旁边跟着 */
  follow() {
    this.mode = "follow";
    this.arrive = null;
  }

  /** 回去停着 */
  rest() {
    this.mode = "perch";
    this.arrive = null;
  }

  /** 飞到某处（带路），到了以后在那里盘旋 */
  flyTo(p: THREE.Vector3): Promise<void> {
    this.mode = "fly";
    this.target.copy(p);
    return new Promise((resolve) => {
      this.arrive = resolve;
    });
  }

  /** 立刻出现在某处（换楼层时） */
  teleport(p: THREE.Vector3) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
  }

  /** 头顶冒一个说话气泡 */
  say(text: string, ms = 5000) {
    this.clearBubble();
    if (!text.trim()) return;
    const { tex, aspect } = bubbleTexture(text);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    const h = 0.32 * Math.min(1.6, (tex.image as HTMLCanvasElement).height / 40);
    s.scale.set(h * aspect, h, 1);
    s.renderOrder = 10;
    s.userData.ghost = true;
    this.root.add(s);
    this.bubble = s;
    this.bubbleUntil = performance.now() + ms;
  }

  private clearBubble() {
    if (!this.bubble) return;
    this.root.remove(this.bubble);
    this.bubble.material.map?.dispose();
    this.bubble.material.dispose();
    this.bubble = null;
  }

  /** 屏幕射线可以命中的物体（跟着你时不挡准星） */
  get objects(): THREE.Object3D[] {
    return this.model && this.mode !== "follow" && !this.hidden ? [this.model] : [];
  }

  /** 每帧更新；返回是否在动（需要重画） */
  update(dt: number, w: BirdWorld): boolean {
    if (!this.model) return false;
    this.root.visible = !this.hidden;
    const now = performance.now();
    let goal: THREE.Vector3;
    const yaw = w.player.yaw;
    if (this.mode === "follow") {
      // 右肩前方一点，高一点，慢慢跟上
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      goal = new THREE.Vector3(w.player.x, w.player.y + 1.95, w.player.z).addScaledVector(right, 0.75).addScaledVector(fwd, 0.9);
      goal.y += Math.sin(now / 600) * 0.05;
    } else if (this.mode === "perch") goal = w.perch;
    else goal = this.target.clone().add(new THREE.Vector3(Math.sin(now / 700) * 0.25, Math.sin(now / 500) * 0.08, Math.cos(now / 700) * 0.25));
    const d = goal.clone().sub(this.pos);
    const dist = d.length();
    const moving = dist > 0.03;
    if (this.reduceMotion) this.pos.copy(goal);
    else {
      // 弹簧式追随：远时快，近时柔和
      const speed = this.mode === "fly" ? 6 : this.mode === "follow" ? 7 : 4;
      const want = d.clone().multiplyScalar(Math.min(speed, 2.2 + dist * 2.4) / Math.max(dist, 0.001));
      if (dist < 0.02) want.set(0, 0, 0);
      this.vel.lerp(want, Math.min(1, dt * 5));
      this.pos.addScaledVector(this.vel, dt);
    }
    if (this.mode === "fly" && dist < 0.25) {
      this.mode = "hover";
      const a = this.arrive;
      this.arrive = null;
      a?.();
    }
    const g = this.model;
    g.position.copy(this.pos);
    // 朝向：飞的时候朝前，停着时朝向玩家
    const face = moving && this.vel.lengthSq() > 0.04 ? Math.atan2(this.vel.x, this.vel.z) : Math.atan2(w.player.x - this.pos.x, w.player.z - this.pos.z);
    let dy = face - g.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    g.rotation.y += dy * Math.min(1, dt * 6);
    // 扇翅膀：在空中扇，停着偶尔扑一下
    const airborne = this.mode !== "perch" || dist > 0.08;
    this.flap += dt * (airborne ? 22 : 2);
    const wingA = airborne && !this.reduceMotion ? Math.sin(this.flap) * 0.9 : now % 5000 < 200 ? 0.5 : 0;
    const wl = g.getObjectByName("wingL");
    const wr = g.getObjectByName("wingR");
    if (wl && wr) {
      wl.rotation.z = -wingA;
      wr.rotation.z = wingA;
    }
    const head = g.getObjectByName("head");
    if (head && !this.reduceMotion) head.rotation.z = this.mode === "perch" ? Math.sin(now / 1500) * 0.15 : 0;
    const eyes = g.getObjectByName("eyes");
    if (eyes) eyes.scale.y = now % 3800 < 130 ? 0.2 : 1;
    if (this.bubble) {
      this.bubble.position.copy(this.pos).add(new THREE.Vector3(0, 0.62 + this.bubble.scale.y / 2, 0));
      if (now > this.bubbleUntil) this.clearBubble();
    }
    return moving || airborne || !!this.bubble;
  }
}
