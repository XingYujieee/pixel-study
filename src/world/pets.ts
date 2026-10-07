// 宠物：原创的方块小动物（猫、狗、兔子、小鸡、狐狸）。会在书房里溜达、偶尔跟着你、
// 晚上或无聊时趴在你最近看的那本书附近睡觉；左键摸摸头会冒爱心。纯装饰，不碰任何文件。
import * as THREE from "three";
import { ROOM } from "./layout";
import { indoors, YARD, type Ground } from "./yard";

export type PetKind = "cat" | "dog" | "rabbit" | "chick" | "fox";

export interface Pet {
  id: string;
  kind: PetKind;
  name: string;
  /** 毛色序号 */
  coat: number;
  x: number;
  z: number;
}

export const PET_KINDS: { kind: PetKind; name: string; coats: string[] }[] = [
  { kind: "cat", name: "猫", coats: ["橘猫", "灰猫", "奶牛猫"] },
  { kind: "dog", name: "狗", coats: ["柴色", "奶油色", "黑白"] },
  { kind: "rabbit", name: "兔子", coats: ["白兔", "棕兔", "灰兔"] },
  { kind: "chick", name: "小鸡", coats: ["黄色", "白色"] },
  { kind: "fox", name: "狐狸", coats: ["赤狐", "雪狐"] },
];

export const MAX_PETS = 3;

const COATS: Record<PetKind, { main: number; light: number; dark: number }[]> = {
  cat: [
    { main: 0xe8913a, light: 0xf8d9a8, dark: 0xb8632a },
    { main: 0x8a8d96, light: 0xd8dade, dark: 0x5a5d66 },
    { main: 0xf4f2ee, light: 0xffffff, dark: 0x2a2a2e },
  ],
  dog: [
    { main: 0xc98a4a, light: 0xf6e6cc, dark: 0x8a5a2a },
    { main: 0xf0dcb4, light: 0xfff6e6, dark: 0xc8a878 },
    { main: 0x2e2e32, light: 0xf2f2f2, dark: 0x1a1a1e },
  ],
  rabbit: [
    { main: 0xf6f4f0, light: 0xffd6de, dark: 0xd8d4cc },
    { main: 0xa87a52, light: 0xf2e2cc, dark: 0x7a5434 },
    { main: 0x9a9aa2, light: 0xe6e6ea, dark: 0x6a6a72 },
  ],
  chick: [
    { main: 0xffd84a, light: 0xfff2a8, dark: 0xe8a830 },
    { main: 0xf6f6f2, light: 0xffffff, dark: 0xd8d8d0 },
  ],
  fox: [
    { main: 0xe0682a, light: 0xfaf4ee, dark: 0x3a2a24 },
    { main: 0xeef0f4, light: 0xffffff, dark: 0x8a8e9a },
  ],
};

const matCache = new Map<number, THREE.MeshLambertMaterial>();
function mat(color: number) {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    matCache.set(color, m);
  }
  return m;
}

function cube(w: number, h: number, d: number, color: number, x: number, y: number, z: number, name?: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  if (name) m.name = name;
  return m;
}

/** 一只宠物的模型。正面朝 +z；部件按名字取出做动画（head、legN、tail、earL/earR、eyes） */
export function buildPet(p: Pick<Pet, "kind" | "coat">): THREE.Group {
  const c = COATS[p.kind][p.coat % COATS[p.kind].length];
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = "body";
  g.add(body);
  const head = new THREE.Group();
  head.name = "head";
  const eyes = new THREE.Group();
  eyes.name = "eyes";
  const legs: [number, number][] = [];
  let legH = 0.12;
  let bodyY = 0;
  // 眼睛：黑色方块 + 一点高光；脸颊一点粉
  const face = (hw: number, hy: number, hz: number, gap: number) => {
    for (const sx of [-1, 1]) {
      eyes.add(cube(0.045, 0.055, 0.01, 0x1e1a1a, sx * gap, hy, hz));
      eyes.add(cube(0.016, 0.016, 0.012, 0xffffff, sx * gap - 0.01, hy + 0.012, hz + 0.001));
      head.add(cube(0.04, 0.025, 0.01, 0xf2a0a8, sx * (gap + 0.045), hy - 0.045, hz));
    }
    head.add(eyes);
    void hw;
  };
  switch (p.kind) {
    case "cat":
    case "fox": {
      const fox = p.kind === "fox";
      bodyY = 0.12;
      body.add(cube(0.24, 0.2, 0.42, c.main, 0, bodyY + 0.1, 0));
      body.add(cube(0.2, 0.1, 0.3, c.light, 0, bodyY + 0.03, 0.02));
      head.position.set(0, bodyY + 0.26, 0.24);
      head.add(cube(0.26, 0.22, 0.22, c.main, 0, 0, 0));
      head.add(cube(0.14, 0.08, 0.06, c.light, 0, -0.06, 0.12));
      head.add(cube(0.03, 0.02, 0.01, 0x3a2a2a, 0, -0.035, 0.155));
      const earL = cube(0.07, 0.09, 0.04, fox ? c.dark : c.main, -0.08, 0.14, -0.02, "earL");
      const earR = cube(0.07, 0.09, 0.04, fox ? c.dark : c.main, 0.08, 0.14, -0.02, "earR");
      head.add(earL, earR);
      face(0.26, 0.02, 0.112, 0.055);
      body.add(head);
      const tail = new THREE.Group();
      tail.name = "tail";
      tail.position.set(0, bodyY + 0.16, -0.21);
      tail.add(cube(0.06, 0.06, fox ? 0.3 : 0.32, c.main, 0, 0.06, -0.14));
      if (fox) tail.add(cube(0.08, 0.08, 0.1, c.light, 0, 0.07, -0.3));
      else if (p.coat === 0) tail.add(cube(0.065, 0.065, 0.05, c.dark, 0, 0.06, -0.2));
      tail.rotation.x = -0.6;
      body.add(tail);
      legs.push([-0.08, 0.14], [0.08, 0.14], [-0.08, -0.14], [0.08, -0.14]);
      legH = 0.12;
      break;
    }
    case "dog": {
      bodyY = 0.14;
      body.add(cube(0.28, 0.22, 0.46, c.main, 0, bodyY + 0.11, 0));
      body.add(cube(0.22, 0.08, 0.3, c.light, 0, bodyY + 0.02, 0.04));
      head.position.set(0, bodyY + 0.3, 0.26);
      head.add(cube(0.28, 0.24, 0.24, c.main, 0, 0, 0));
      head.add(cube(0.16, 0.1, 0.1, c.light, 0, -0.06, 0.15));
      head.add(cube(0.05, 0.035, 0.02, 0x1e1a1a, 0, -0.03, 0.2));
      // 垂耳
      head.add(cube(0.06, 0.14, 0.08, c.dark, -0.16, -0.01, -0.01, "earL"));
      head.add(cube(0.06, 0.14, 0.08, c.dark, 0.16, -0.01, -0.01, "earR"));
      face(0.28, 0.035, 0.122, 0.06);
      body.add(head);
      const tail = new THREE.Group();
      tail.name = "tail";
      tail.position.set(0, bodyY + 0.2, -0.23);
      tail.add(cube(0.06, 0.06, 0.18, c.main, 0, 0.04, -0.08));
      tail.rotation.x = -0.9;
      body.add(tail);
      legs.push([-0.09, 0.16], [0.09, 0.16], [-0.09, -0.16], [0.09, -0.16]);
      legH = 0.14;
      break;
    }
    case "rabbit": {
      bodyY = 0.06;
      body.add(cube(0.24, 0.22, 0.3, c.main, 0, bodyY + 0.11, -0.02));
      head.position.set(0, bodyY + 0.26, 0.14);
      head.add(cube(0.22, 0.2, 0.2, c.main, 0, 0, 0));
      head.add(cube(0.025, 0.02, 0.01, 0xe88a9a, 0, -0.04, 0.102));
      head.add(cube(0.06, 0.2, 0.03, c.main, -0.05, 0.19, -0.02, "earL"));
      head.add(cube(0.06, 0.2, 0.03, c.main, 0.05, 0.19, -0.02, "earR"));
      head.add(cube(0.03, 0.14, 0.01, c.light, -0.05, 0.19, -0.003));
      head.add(cube(0.03, 0.14, 0.01, c.light, 0.05, 0.19, -0.003));
      face(0.22, 0.02, 0.102, 0.05);
      body.add(head);
      const tail = new THREE.Group();
      tail.name = "tail";
      tail.position.set(0, bodyY + 0.12, -0.18);
      tail.add(cube(0.08, 0.08, 0.06, 0xffffff, 0, 0, 0));
      body.add(tail);
      legs.push([-0.07, 0.08], [0.07, 0.08], [-0.08, -0.1], [0.08, -0.1]);
      legH = 0.06;
      break;
    }
    case "chick": {
      bodyY = 0.06;
      body.add(cube(0.24, 0.22, 0.26, c.main, 0, bodyY + 0.11, 0));
      body.add(cube(0.04, 0.12, 0.16, c.dark, -0.14, bodyY + 0.12, -0.01, "wingL"));
      body.add(cube(0.04, 0.12, 0.16, c.dark, 0.14, bodyY + 0.12, -0.01, "wingR"));
      head.position.set(0, bodyY + 0.28, 0.06);
      head.add(cube(0.18, 0.16, 0.16, c.main, 0, 0, 0));
      head.add(cube(0.07, 0.04, 0.06, 0xf08a2a, 0, -0.02, 0.1));
      head.add(cube(0.04, 0.05, 0.04, c.dark, 0, 0.1, 0, "earL"));
      face(0.18, 0.025, 0.082, 0.045);
      body.add(head);
      const tail = new THREE.Group();
      tail.name = "tail";
      tail.position.set(0, bodyY + 0.16, -0.14);
      tail.add(cube(0.1, 0.06, 0.05, c.dark, 0, 0, 0));
      body.add(tail);
      legs.push([-0.05, 0], [0.05, 0]);
      legH = 0.06;
      break;
    }
  }
  legs.forEach(([x, z], i) => {
    const leg = new THREE.Group();
    leg.name = `leg${i}`;
    leg.position.set(x, legH + bodyY - legH, z);
    leg.add(cube(p.kind === "chick" ? 0.03 : 0.07, legH, p.kind === "chick" ? 0.03 : 0.07, p.kind === "chick" ? 0xf08a2a : c.dark === 0x1a1a1e ? c.light : c.main, 0, -legH / 2, 0));
    leg.position.y = bodyY;
    body.add(leg);
  });
  g.userData.kind = p.kind;
  return g;
}

// ───────────── 行为 ─────────────

type Mode = "idle" | "walk" | "follow" | "sleep" | "pat";

interface PetState {
  pet: Pet;
  group: THREE.Group;
  mode: Mode;
  until: number;
  target: { x: number; z: number } | null;
  yaw: number;
  phase: number;
  zzz: number;
}

function spriteTexture(draw: (g: CanvasRenderingContext2D) => void, w = 16, h = 16): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let heartTex: THREE.Texture | null = null;
let zTex: THREE.Texture | null = null;

function heart() {
  heartTex ??= spriteTexture((g) => {
    g.fillStyle = "#e8344a";
    for (const [x, y, w] of [
      [2, 3, 4],
      [10, 3, 4],
      [1, 4, 14],
      [1, 5, 14],
      [1, 6, 14],
      [2, 7, 12],
      [3, 8, 10],
      [4, 9, 8],
      [5, 10, 6],
      [6, 11, 4],
      [7, 12, 2],
    ])
      g.fillRect(x, y, w, 1);
    g.fillStyle = "#ffb0bc";
    g.fillRect(3, 4, 2, 2);
  });
  return heartTex;
}

function zLetter() {
  zTex ??= spriteTexture((g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(3, 3, 10, 2);
    g.fillRect(3, 11, 10, 2);
    for (let i = 0; i < 6; i++) g.fillRect(10 - i * 1.4, 5 + i, 2, 1);
  });
  return zTex;
}

export interface PetWorld {
  /** 地面高度；宠物不爬高 */
  ground: Ground;
  player: { x: number; z: number };
  /** 屋里亮度 0–1（晚上宠物更爱睡觉） */
  light: number;
  /** 睡觉的地方（最近看的书所在书架前、书桌旁） */
  napSpot: { x: number; z: number } | null;
}

export class PetSystem {
  readonly root = new THREE.Group();
  private pets = new Map<string, PetState>();
  private particles: { s: THREE.Sprite; vy: number; t0: number; life: number }[] = [];
  private reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  setPets(list: Pet[]) {
    const keep = new Set(list.map((p) => p.id));
    for (const [id, st] of this.pets)
      if (!keep.has(id)) {
        this.root.remove(st.group);
        this.pets.delete(id);
      }
    for (const p of list) {
      const st = this.pets.get(p.id);
      if (st && st.pet.kind === p.kind && st.pet.coat === p.coat) {
        st.pet = { ...p, x: st.pet.x, z: st.pet.z };
        continue;
      }
      if (st) this.root.remove(st.group);
      const group = buildPet(p);
      group.position.set(p.x, 0, p.z);
      group.traverse((o) => (o.userData.petId = p.id));
      this.root.add(group);
      this.pets.set(p.id, { pet: { ...p }, group, mode: "idle", until: performance.now() + 1500, target: null, yaw: Math.random() * 6, phase: Math.random() * 10, zzz: 0 });
    }
  }

  /** 当前位置（保存布局时用） */
  positions(): Map<string, { x: number; z: number }> {
    const m = new Map<string, { x: number; z: number }>();
    for (const [id, st] of this.pets) m.set(id, { x: st.group.position.x, z: st.group.position.z });
    return m;
  }

  /** 摸摸头：坐下看着你，冒爱心 */
  pat(id: string, player: { x: number; z: number }) {
    const st = this.pets.get(id);
    if (!st) return;
    st.mode = "pat";
    st.until = performance.now() + 2200;
    st.yaw = Math.atan2(player.x - st.group.position.x, player.z - st.group.position.z);
    for (let i = 0; i < 4; i++) this.emit(heart(), st.group.position, 0.25 + i * 0.12, i * 120);
  }

  private emit(tex: THREE.Texture, at: THREE.Vector3, size: number, delay: number) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    s.scale.setScalar(size * 0.6);
    s.position.set(at.x + (Math.random() - 0.5) * 0.3, 0.6, at.z + (Math.random() - 0.5) * 0.3);
    s.userData.ghost = true;
    s.visible = false;
    this.root.add(s);
    this.particles.push({ s, vy: 0.5 + Math.random() * 0.3, t0: performance.now() + delay, life: 1400 });
  }

  /** 每帧更新；返回是否有东西在动（需要重绘） */
  update(dt: number, w: PetWorld): boolean {
    const now = performance.now();
    let moving = false;
    for (const st of this.pets.values()) {
      moving = this.step(st, dt, now, w) || moving;
    }
    // 粒子：爱心与 Z
    this.particles = this.particles.filter((p) => {
      const t = now - p.t0;
      if (t < 0) return true;
      p.s.visible = true;
      p.s.position.y += p.vy * dt;
      (p.s.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - t / p.life);
      if (t > p.life) {
        this.root.remove(p.s);
        (p.s.material as THREE.SpriteMaterial).dispose();
        return false;
      }
      return true;
    });
    return moving || this.particles.length > 0;
  }

  /** 随便走走：在屋里就在屋里逛，在院子里就在院子里逛 */
  private pickTarget(st: PetState, w: PetWorld): { x: number; z: number } | null {
    const inside = indoors(st.group.position.x, st.group.position.z);
    for (let i = 0; i < 16; i++) {
      const x = inside ? 0.6 + Math.random() * (ROOM.w - 1.2) : YARD.x0 + 0.6 + Math.random() * (YARD.x1 - YARD.x0 - 1.2);
      const z = inside ? 0.6 + Math.random() * (ROOM.d - 1.2) : ROOM.d + 1.6 + Math.random() * (YARD.z1 - ROOM.d - 2.2);
      if (!w.ground.blocked(Math.floor(x), Math.floor(z))) return { x, z };
    }
    return null;
  }

  private step(st: PetState, dt: number, now: number, w: PetWorld): boolean {
    const g = st.group;
    const pos = g.position;
    const distPlayer = Math.hypot(w.player.x - pos.x, w.player.z - pos.z);
    // 换状态
    if (now > st.until) {
      const sleepy = w.light < 0.35 ? 0.45 : 0.12;
      const r = Math.random();
      if (st.mode === "sleep" && r < 0.5) st.until = now + 8000 + Math.random() * 12000;
      else if (r < sleepy && w.napSpot) {
        st.mode = "walk";
        st.target = { x: w.napSpot.x + (Math.random() - 0.5) * 0.8, z: w.napSpot.z + (Math.random() - 0.5) * 0.8 };
        st.until = now + 15000;
        st.zzz = 1; // 到了就睡
      } else if (r < sleepy + 0.25 && distPlayer < 7) {
        st.mode = "follow";
        st.until = now + 6000 + Math.random() * 6000;
        st.zzz = 0;
      } else if (r < sleepy + 0.65) {
        st.mode = "walk";
        st.target = this.pickTarget(st, w);
        st.until = now + 9000;
        st.zzz = 0;
      } else {
        st.mode = "idle";
        st.until = now + 2500 + Math.random() * 5000;
        st.zzz = 0;
      }
    }
    let speed = 0;
    let goal: { x: number; z: number } | null = null;
    if (st.mode === "walk") goal = st.target;
    if (st.mode === "follow" && distPlayer > 1.4) goal = w.player;
    if (goal) {
      const dx = goal.x - pos.x;
      const dz = goal.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) {
        if (st.mode === "walk" && st.zzz === 1) {
          st.mode = "sleep";
          st.until = now + 15000 + Math.random() * 20000;
        } else {
          st.mode = "idle";
          st.until = now + 2000 + Math.random() * 3000;
        }
      } else {
        speed = (st.mode === "follow" ? 1.5 : 0.9) * (g.userData.kind === "chick" ? 0.8 : 1);
        const step = Math.min(d, speed * dt);
        const nx = pos.x + (dx / d) * step;
        const nz = pos.z + (dz / d) * step;
        if (!w.ground.blocked(Math.floor(nx), Math.floor(nz))) {
          pos.x = nx;
          pos.z = nz;
        } else if (st.mode === "follow" && indoors(pos.x, pos.z) !== indoors(w.player.x, w.player.z)) {
          // 主人出门 / 进门了：像方块游戏里的宠物那样一下子跟过去
          const ang = Math.random() * Math.PI * 2;
          for (const r of [1.2, 1.6, 2]) {
            const tx = w.player.x + Math.cos(ang) * r;
            const tz = w.player.z + Math.sin(ang) * r;
            if (!w.ground.blocked(Math.floor(tx), Math.floor(tz)) && indoors(tx, tz) === indoors(w.player.x, w.player.z)) {
              this.emit(heart(), pos, 0.2, 0);
              pos.x = tx;
              pos.z = tz;
              break;
            }
          }
        } else {
          // 被挡住：换个方向
          st.target = this.pickTarget(st, w);
          if (st.mode === "follow") {
            st.mode = "idle";
            st.until = now + 1500;
          }
        }
        st.yaw = Math.atan2(dx, dz);
      }
    }
    // 朝向平滑转动
    let dy = st.yaw - g.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    g.rotation.y += dy * Math.min(1, dt * 8);
    // 动作
    st.phase += dt * (speed > 0 ? 10 : 2);
    const body = g.getObjectByName("body")!;
    const head = g.getObjectByName("head");
    const tail = g.getObjectByName("tail");
    const eyes = g.getObjectByName("eyes");
    const kind = g.userData.kind as PetKind;
    const hop = kind === "rabbit" || kind === "chick";
    body.position.y = speed > 0 ? (hop ? Math.abs(Math.sin(st.phase * 0.8)) * 0.08 : Math.abs(Math.sin(st.phase)) * 0.015) : 0;
    for (let i = 0; i < 4; i++) {
      const leg = body.getObjectByName(`leg${i}`);
      if (leg) leg.rotation.x = speed > 0 && !hop ? Math.sin(st.phase + (i % 2 === 0 ? 0 : Math.PI) + (i > 1 ? Math.PI : 0)) * 0.6 : 0;
    }
    const sleeping = st.mode === "sleep";
    body.rotation.z = 0;
    body.scale.y = sleeping ? 0.75 : 1;
    if (eyes) eyes.scale.y = sleeping ? 0.25 : now % 4200 < 140 ? 0.2 : 1;
    if (head) {
      // 靠近时看你；摸头时抬头
      const look = distPlayer < 3 && !sleeping ? Math.atan2(w.player.x - pos.x, w.player.z - pos.z) - g.rotation.y : 0;
      head.rotation.y = Math.max(-0.7, Math.min(0.7, Math.atan2(Math.sin(look), Math.cos(look)))) * 0.8;
      head.rotation.x = st.mode === "pat" ? -0.25 : sleeping ? 0.3 : 0;
      const earL = head.getObjectByName("earL");
      if (earL && !this.reduceMotion) earL.rotation.z = Math.sin(now / 900 + st.phase) > 0.97 ? 0.3 : 0;
    }
    if (tail && !this.reduceMotion) {
      const wag = st.mode === "pat" || (kind === "dog" && distPlayer < 2.5) ? 14 : 3;
      tail.rotation.y = Math.sin(now / 1000 * wag) * (st.mode === "pat" ? 0.6 : 0.25);
    }
    const wingL = body.getObjectByName("wingL");
    const wingR = body.getObjectByName("wingR");
    if (wingL && wingR) {
      const f = st.mode === "pat" || speed > 0 ? Math.sin(now / 60) * 0.5 : 0;
      wingL.rotation.z = f;
      wingR.rotation.z = -f;
    }
    // 睡觉冒 Z
    if (sleeping && !this.reduceMotion && Math.random() < dt * 0.7) this.emit(zLetter(), pos, 0.22, 0);
    return true;
  }

  /** 屏幕射线命中的宠物 */
  get objects(): THREE.Object3D[] {
    return this.root.children.filter((c) => !(c as THREE.Sprite).isSprite);
  }
}
