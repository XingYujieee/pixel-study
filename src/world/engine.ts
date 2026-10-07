// 书房引擎：渲染、第一人称移动、准星瞄准、放置家具、坐到书桌前。
// 不直接读写笔记文件；通过回调把交互交给界面层。
import * as THREE from "three";
import { ShelfBooks, type BookItem } from "./books";
import {
  canPlace,
  carpetAt,
  centerOf,
  facing,
  footprint,
  SPECS,
  type Furniture,
  type FurnitureType,
  type Layout,
  type Rot,
} from "./layout";
import { buildFurniture, buildGhost, buildRoom, buildWallItem, outlineFor, placeGroup, setSand, type RoomBuild } from "./models";
import { THEMES, type RoomTheme, type Side } from "./themes";
import { canPlaceWall, snapWall, wallTransform, type WallItem, type WallItemType, type WallSide } from "./wall";
import { PetSystem } from "./pets";
import { BirdSystem } from "./bird";
import { Environment } from "./environment";
import { HandView } from "./hand";
import type { EnvSettings } from "./sky";
import { textures } from "./textures";
import { defaultGarden, DOOR, fallBody, gardenBlocks, Ground, indoors, moveBody, nearestFree, type Body, type GardenBlock, type GardenKind } from "./yard";
import { buildTerrain, buildYard, type OutdoorBuild } from "./outdoor";
import { generateTerrain, type TerrainStyle } from "./terrain";

export type Target =
  | { kind: "book"; fid: string; path: string }
  | { kind: "furniture"; fid: string; type: FurnitureType }
  | { kind: "window"; side: "north" | "east" | "west" }
  | { kind: "door"; open: boolean }
  | { kind: "bird" }
  | { kind: "garden"; x: number; z: number; item: GardenKind }
  | { kind: "wall"; id: string }
  | { kind: "pet"; id: string }
  | { kind: "wallspot"; side: WallSide; a: number; y: number; valid: boolean; reason?: string }
  | { kind: "floor"; x: number; z: number; valid: boolean; reason?: string }
  | null;

export interface EngineCallbacks {
  /** 准星目标变化 */
  onTarget(t: Target): void;
  /** 左键：与目标交互 */
  onInteract(t: Exclude<Target, null | { kind: "floor" } | { kind: "wallspot" }>): void;
  /** 右键：在地面放置（已通过检查） */
  onPlace(f: Omit<Furniture, "id">): void;
  /** 左键：把黑板 / 画框挂到墙上（已通过检查） */
  onPlaceWall?(spot: { side: WallSide; a: number; y: number; w: number; h: number }): void;
  /** 挂墙模式结束（挂好或取消） */
  onWallPlacingEnd?(): void;
  /** 放置失败的原因 */
  onPlaceRejected(reason: string): void;
  /** 鼠标锁定丢失（按了 Esc 或切出窗口） */
  onPause(): void;
  /** 鼠标锁定不可用，改为拖动视角 */
  onLookFallback(): void;
  /** 原生光标锁定（Tauri：隐藏光标并与鼠标移动脱钩）。返回是否成功。 */
  nativeGrab?(on: boolean): Promise<boolean>;
  /** 走上 / 离开地毯（null 为不在地毯上） */
  onCarpet?(fid: string | null): void;
  /** 走一步（脚步声） */
  onStep?(): void;
  /** 导入的掉落物飞进家具 */
  onDropArrive?(): void;
  /** 开门 / 关门 */
  onDoor?(open: boolean): void;
  /** 走出门 / 回到屋里 */
  onOutside?(outside: boolean): void;
  /** 落地（跳下来） */
  onLand?(height: number): void;
}

const EYE = 1.62;
const WALK = 4.3;
const REACH = 6;
const MAX_POINT_LIGHTS = 5;

const ROOM_W = 14;
const ROOM_D = 12;
const ROOM_H = 6;

const NOTE_COLORS = ["#5fe3d6", "#ffd84a", "#ff8ac0", "#9ad870"];
const noteTex = new Map<number, THREE.CanvasTexture>();

/** 音符精灵：像素画的八分音符，几种颜色轮换 */
function noteTexture(i: number): THREE.CanvasTexture {
  let t = noteTex.get(i);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = 12;
  c.height = 12;
  const g = c.getContext("2d")!;
  g.fillStyle = NOTE_COLORS[i];
  g.fillRect(6, 1, 1, 8);
  g.fillRect(7, 1, 3, 1);
  g.fillRect(9, 2, 1, 2);
  g.fillRect(3, 7, 4, 3);
  g.fillStyle = "#1a1a1a";
  g.fillRect(3, 10, 4, 1);
  t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  noteTex.set(i, t);
  return t;
}

let signWoodMat: THREE.MeshLambertMaterial | null = null;
function signWood() {
  signWoodMat ??= new THREE.MeshLambertMaterial({ map: textures().shelfWoodLight });
  return signWoodMat;
}

/** 名牌上的字：像素字体，白字黑边，太长时截断 */
function signTexture(name: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 104;
  c.height = 19;
  const g = c.getContext("2d")!;
  g.font = '12px "Fusion Pixel", "PingFang SC", sans-serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  let text = name;
  while (g.measureText(text).width > 98 && text.length > 1) text = text.slice(0, -1);
  if (text !== name) text = text.slice(0, -1) + "…";
  g.fillStyle = "#2a1a0c";
  g.fillText(text, 53, 11);
  g.fillStyle = "#fff6dc";
  g.fillText(text, 52, 10);
  // 去掉抗锯齿，保持像素感
  const d = g.getImageData(0, 0, c.width, c.height);
  for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] > 110 ? 255 : 0;
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class WorldEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private furnitureRoot = new THREE.Group();
  private groups = new Map<string, THREE.Group>();
  private shelfBooks = new Map<string, ShelfBooks>();
  private lights: THREE.PointLight[] = [];
  readonly env: Environment;
  readonly hand = new HandView();
  private windowTargets = new THREE.Group();
  private theme: RoomTheme = THEMES.study;
  private room!: RoomBuild;
  private fireLight: THREE.PointLight | null = null;
  private spinners: THREE.Object3D[] = [];
  private hidden = false;
  private lastIdleRender = 0;
  private walked = 0;
  private layout: Layout | null = null;
  /** 每个格子的高度（墙、家具、花园），用来走路、跳上桌子 */
  private ground = new Ground(null, [], false);
  private doorOpen = false;
  /** 门的开合动画 0 关 – 1 开 */
  private doorT = 0;
  private yard: OutdoorBuild | null = null;
  private terrain: OutdoorBuild | null = null;
  private terrainStyle: TerrainStyle | null = null;
  private outsideT = 0;
  private wasOutside = false;
  /** 每个书架上一次显示的书，用来找出"刚放上来"的书播放落下动画 */
  private shelfPaths = new Map<string, Set<string>>();
  private ponds: THREE.Object3D[] = [];
  private bubbling = false;
  private splashUntil = 0;
  private carpetId: string | null = null;
  private wallRoot = new THREE.Group();
  readonly pets = new PetSystem();
  /** 管家小鸟 */
  readonly bird = new BirdSystem();
  private napSpot: { x: number; z: number } | null = null;
  private wallGroups = new Map<string, THREE.Group>();
  /** 挂墙模式：手上拿着要挂的东西 */
  private wallPlacing: { type: WallItemType; w: number; h: number } | null = null;
  private wallGhost: THREE.Mesh | null = null;
  private wallSpot: { side: WallSide; a: number; y: number; valid: boolean; reason?: string } | null = null;
  /** 拖放导入的掉落物 */
  private flying: { mesh: THREE.Mesh; from: THREE.Vector3; mid: THREE.Vector3; to: THREE.Vector3 | null; fid: string | null; t0: number; spin: number }[] = [];
  private gulps = new Map<string, number>();

  // 玩家（pos.y 是脚的高度）
  private pos = new THREE.Vector3(7, 0, 9);
  private body: Body = { x: 7, y: 0, z: 9, vy: 0, grounded: true };
  /** 迈上台阶时镜头平滑跟上 */
  private eyeLag = 0;
  private yaw = 0;
  private pitch = 0;
  private keys = new Set<string>();

  // 状态
  private explore = false;
  private locked = false;
  private dragLook = false;
  private lockUnavailable = false;
  /** 原生光标锁定生效中（浏览器 Pointer Lock 不可用时的第二级方案） */
  private grabbed = false;
  private grabUnavailable = false;
  private releasing = false;
  private running = false;
  private seated = false;
  private raf = 0;
  private last = 0;
  private needsRender = true;
  private reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  // 瞄准与放置
  private raycaster = new THREE.Raycaster();
  private target: Target = null;
  private outline: THREE.LineSegments | null = null;
  private ghost: THREE.Group | null = null;
  private ghostType: FurnitureType | null = null;
  private ghostRot: Rot = 0;
  private ghostSpot: { x: number; z: number; valid: boolean; reason?: string } | null = null;
  private selected: FurnitureType | null = null;

  // 拖动视角
  private dragStart: { x: number; y: number; button: number; moved: boolean } | null = null;

  private cleanup: (() => void)[] = [];

  constructor(
    private host: HTMLElement,
    private cb: EngineCallbacks,
    private books: (f: Furniture) => BookItem[],
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "world-canvas";
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 220);
    this.camera.rotation.order = "YXZ";

    const room = buildRoom(textures(), this.theme);
    this.room = room;
    this.scene.add(room.group, room.outdoor);
    this.env = new Environment(this.scene, room.outdoor);
    this.buildWindowTargets();
    this.applyThemeLight();
    this.rebuildYard();
    this.setTerrainStyle(this.theme.scenery);
    this.scene.add(this.furnitureRoot);
    this.scene.add(this.wallRoot);
    this.scene.add(this.pets.root);
    this.scene.add(this.bird.root);

    this.bindInput();
    this.resize();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.cleanup.push(() => ro.disconnect());
    this.start();
  }

  // ───────────── 布局 ─────────────

  setLayout(layout: Layout, keepPlayer = false) {
    if (layout !== this.layout) this.shelfPaths.clear();
    this.layout = layout;
    if (!keepPlayer) {
      this.pos.set(layout.player.x, 0, layout.player.z);
      this.yaw = layout.player.yaw;
      this.pitch = layout.player.pitch;
    }
    this.rebuildFurniture();
    if (!keepPlayer) this.placeBody(this.pos.x, this.pos.z);
  }

  /** 家具增删改后重建（数量很少，直接全量） */
  rebuildFurniture() {
    if (!this.layout) return;
    this.hideDropGlow();
    for (const g of this.groups.values()) this.furnitureRoot.remove(g);
    for (const b of this.shelfBooks.values()) b.dispose();
    for (const l of this.lights) this.scene.remove(l);
    this.groups.clear();
    this.shelfBooks.clear();
    this.lights = [];
    for (const f of this.layout.furniture) {
      const g = buildFurniture(f);
      this.groups.set(f.id, g);
      this.furnitureRoot.add(g);
      if (f.type === "bookshelf") this.attachBooks(f, g);
      if ((f.type === "lantern" || f.type === "desk" || f.type === "aibench") && this.lights.length < MAX_POINT_LIGHTS) {
        const base = f.type === "lantern" ? 9 : f.type === "aibench" ? 3 : 4;
        const light = new THREE.PointLight(f.type === "aibench" ? 0x5fe3d6 : 0xffc477, base, f.type === "aibench" ? 5 : 9, 1.6);
        light.userData.base = base;
        const glow = g.getObjectByName("lampglow");
        const p = new THREE.Vector3();
        (glow ?? g).getWorldPosition(p);
        light.position.copy(p);
        this.scene.add(light);
        this.lights.push(light);
      }
    }
    this.rebuildGround();
    this.furnitureRoot.traverse((o) => {
      if (o.name === "hourglass") setSand(o, this.hourglassProgress);
    });
    this.spinners = [];
    this.ponds = [];
    this.furnitureRoot.traverse((o) => {
      if (o.name === "spin") this.spinners.push(o);
      if (o.name === "bubbles") this.ponds.push(o);
    });
    this.updateCarpet(true);
    this.clearOutline();
    this.invalidate();
  }

  /** 窗户的可交互区域（不可见），来自当前屋子主题的窗洞 */
  private buildWindowTargets() {
    for (const c of [...this.windowTargets.children]) {
      this.windowTargets.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    for (const o of this.room.openings) {
      const size = new THREE.Vector3().subVectors(o.max, o.min);
      const m = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), mat);
      m.position.copy(o.min).add(o.max).multiplyScalar(0.5);
      m.userData.window = o.side;
      m.userData.min = o.min.clone();
      m.userData.max = o.max.clone();
      this.windowTargets.add(m);
    }
    if (!this.windowTargets.parent) this.scene.add(this.windowTargets);
  }

  /** 换屋子主题：重建墙、地板、窗户；家具与书不动 */
  setTheme(theme: RoomTheme, force = false) {
    if (theme.id === this.theme.id && !force) return;
    this.theme = theme;
    const old = this.room;
    this.scene.remove(old.group, old.outdoor);
    old.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    old.outdoor.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.room = buildRoom(textures(), theme, this.groundFloor);
    this.scene.add(this.room.group, this.room.outdoor);
    this.env.setOutdoor(this.room.outdoor);
    this.buildWindowTargets();
    this.applyThemeLight();
    this.rebuildYard();
    this.applyDoor();
    if (this.envSettings) this.setEnv(this.envSettings);
    this.clearOutline();
    this.invalidate();
  }

  get themeId() {
    return this.theme.id;
  }

  private applyThemeLight() {
    this.env.setIndoor(this.theme.daylight, this.theme.ambient, this.theme.scenery);
    if (this.fireLight) this.scene.remove(this.fireLight);
    this.fireLight = null;
    if (this.room.fireLight) {
      this.fireLight = new THREE.PointLight(0xff9a4a, 7, 10, 1.5);
      this.fireLight.position.copy(this.room.fireLight);
      this.scene.add(this.fireLight);
    }
  }

  private envSettings: EnvSettings | null = null;

  /** 环境设置（时间、天气、窗景）。远景地形跟着窗景主题换；用了自己的图片时换成平坦草地，不挡住图片。 */
  setEnv(s: EnvSettings) {
    this.envSettings = s;
    this.env.setSettings(s);
    const custom = !!s.scenery || Object.keys(s.scenerySides).length > 0;
    this.setTerrainStyle(custom ? "meadow" : (s.sceneryPreset ?? this.theme.scenery));
    this.invalidate();
  }

  // ───────────── 屋外 ─────────────

  private rebuildYard() {
    if (this.yard) {
      this.scene.remove(this.yard.group);
      this.yard.dispose();
    }
    this.yard = buildYard(this.theme, this.gardenItems);
    this.scene.add(this.yard.group);
    this.rebuildGround();
  }

  private setTerrainStyle(style: TerrainStyle) {
    if (style === this.terrainStyle) return;
    this.terrainStyle = style;
    if (this.terrain) {
      this.scene.remove(this.terrain.group);
      this.terrain.dispose();
    }
    this.terrain = buildTerrain(generateTerrain(style));
    this.scene.add(this.terrain.group);
    this.needsRender = true;
  }

  get terrainName() {
    return this.terrainStyle;
  }

  private rebuildGround() {
    this.ground = new Ground(this.layout, gardenBlocks({ fireplace: this.theme.fireplace, items: this.gardenItems }), this.doorOpen && this.groundFloor);
  }

  /** 一楼才有通往院子的门 */
  private groundFloor = true;

  setGroundFloor(on: boolean) {
    if (on === this.groundFloor) return;
    this.groundFloor = on;
    if (!on) {
      this.doorOpen = false;
      this.doorT = 0;
    }
    this.setTheme(this.theme, true);
    this.rebuildGround();
  }

  get isGroundFloor() {
    return this.groundFloor;
  }

  // ───────────── 花园 ─────────────

  private gardenItems: GardenBlock[] | undefined;
  private defaultItems: GardenBlock[] | null = null;

  /** 换花园内容（种树、除草后） */
  setGarden(items: GardenBlock[] | undefined) {
    this.gardenItems = items;
    this.rebuildYard();
  }

  /** 准星指着的院子格子（看着地面或花园里的东西） */
  lookCell(reach = 9): { x: number; z: number } | null {
    if (!this.yard) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.raycaster.far = reach;
    const hits = this.raycaster.intersectObject(this.yard.group, true);
    for (const h of hits) {
      const im = h.object as THREE.InstancedMesh;
      if (im.isInstancedMesh && h.instanceId !== undefined) {
        const m = new THREE.Matrix4();
        im.getMatrixAt(h.instanceId, m);
        const p = new THREE.Vector3().setFromMatrixPosition(m);
        return { x: Math.floor(p.x), z: Math.floor(p.z) };
      }
      return { x: Math.floor(h.point.x - h.face!.normal.x * 0.01), z: Math.floor(h.point.z - h.face!.normal.z * 0.01) };
    }
    return null;
  }

  /** 把玩家放到 (x, z) 附近能站的地方，脚落在地面上 */
  private placeBody(x: number, z: number) {
    const p = nearestFree(this.ground, x, z);
    this.body = { x: p.x, y: 0, z: p.z, vy: 0, grounded: true };
    this.pos.set(p.x, 0, p.z);
  }

  get isDoorOpen() {
    return this.doorOpen;
  }

  /** 开门 / 关门。站在门口时不关（会夹到人） */
  toggleDoor(): boolean {
    if (!this.groundFloor) return false;
    if (this.doorOpen) {
      const inDoorway = this.pos.z > DOOR.z - 0.35 && this.pos.z < DOOR.z + 1.35 && this.pos.x > DOOR.x0 - 0.3 && this.pos.x < DOOR.x1 + 0.3;
      if (inDoorway) return false;
    }
    this.doorOpen = !this.doorOpen;
    this.rebuildGround();
    this.cb.onDoor?.(this.doorOpen);
    this.needsRender = true;
    if (this.target?.kind === "door") this.setTarget({ kind: "door", open: this.doorOpen });
    return true;
  }

  /** 门的开合（动画在 animate 里） */
  private applyDoor() {
    const k = this.doorT;
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const l = this.room.door.getObjectByName("doorL");
    const r = this.room.door.getObjectByName("doorR");
    if (l) l.rotation.y = -e * Math.PI * 0.5;
    if (r) r.rotation.y = e * Math.PI * 0.5;
  }

  /** 小鸟平时停的地方：这层第一个书架的顶上，没有书架就在屋子中间的高处 */
  private perchCache: { key: string; p: THREE.Vector3 } | null = null;
  perchPoint(): THREE.Vector3 {
    const shelf = this.layout?.furniture.find((f) => f.type === "bookshelf");
    const key = shelf ? `${shelf.id}:${shelf.x}:${shelf.z}:${shelf.rot}` : "none";
    if (this.perchCache?.key === key) return this.perchCache.p;
    let p = new THREE.Vector3(ROOM_W / 2, 3.2, ROOM_D / 2);
    if (shelf) {
      const c = centerOf(shelf);
      p = new THREE.Vector3(c.x, SPECS.bookshelf.h + 0.02, c.z);
    }
    this.perchCache = { key, p };
    return p;
  }

  /** 书在世界里的位置（带路用）；不在这层的书架上返回 null */
  bookPoint(path: string): THREE.Vector3 | null {
    for (const [fid, sb] of this.shelfBooks) {
      const slot = sb.slots.find((sl) => sl.path === path);
      const g = this.groups.get(fid);
      if (!slot || !g) continue;
      g.updateMatrixWorld(true);
      return slot.min.clone().add(slot.max).multiplyScalar(0.5).applyMatrix4(g.matrixWorld);
    }
    return null;
  }

  /** 书架正前方上空（书没摆出来时带路到书架） */
  shelfPoint(fid: string): THREE.Vector3 | null {
    const f = this.layout?.furniture.find((x) => x.id === fid);
    if (!f) return null;
    const c = centerOf(f);
    const d = facing(f.rot);
    return new THREE.Vector3(c.x + d.x * 0.6, 2.4, c.z + d.z * 0.6);
  }

  /** 走到书架前面看着它 */
  walkToShelf(fid: string): Promise<boolean> {
    const f = this.layout?.furniture.find((x) => x.id === fid);
    if (!f) return Promise.resolve(false);
    const c = centerOf(f);
    const dir = facing(f.rot);
    const stand = nearestFree(this.ground, c.x + dir.x * 2.6, c.z + dir.z * 2.6);
    return this.walkTo(stand, Math.atan2(-(c.x - stand.x), -(c.z - stand.z)), -0.05);
  }

  /** 平滑走到某处并转向（带路、出门看花园） */
  walkTo(stand: { x: number; z: number }, yaw: number, pitch = 0): Promise<boolean> {
    this.seated = false;
    const from = { x: this.pos.x, z: this.pos.z, yaw: this.yaw, pitch: this.pitch };
    let dyaw = yaw - from.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const dur = this.reduceMotion ? 0 : Math.min(1600, 450 + Math.hypot(stand.x - from.x, stand.z - from.z) * 110);
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = () => {
        const k = dur === 0 ? 1 : Math.min(1, (performance.now() - t0) / dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        this.pos.set(from.x + (stand.x - from.x) * e, 0, from.z + (stand.z - from.z) * e);
        this.body = { x: this.pos.x, y: 0, z: this.pos.z, vy: 0, grounded: true };
        this.yaw = from.yaw + dyaw * e;
        this.pitch = from.pitch + (pitch - from.pitch) * e;
        this.applyCamera();
        this.render();
        if (k < 1) requestAnimationFrame(step);
        else resolve(true);
      };
      step();
    });
  }

  /** 脚下是什么（脚步声）：屋里的地面返回 null，交给地毯和屋子主题决定 */
  surface(): "grass" | "stone" | "wood" | null {
    const { x, y, z } = this.pos;
    if (y > 0.05) return "wood";
    if (indoors(x, z)) return null;
    if (x >= DOOR.x0 && x < DOOR.x1) return "stone";
    return "grass";
  }

  /** 在屋外吗（门口算一半） */
  get isOutside() {
    return !indoors(this.pos.x, this.pos.z);
  }

  /** 专注模式时整个书房隐藏，停止渲染 */
  setHidden(h: boolean) {
    this.hidden = h;
    if (!h) this.invalidate();
  }

  /** 非探索状态下立即重绘一帧（不依赖动画循环） */
  private invalidate() {
    this.needsRender = true;
    if (!this.explore) {
      if (!this.seated) this.applyCamera();
      this.render();
    }
  }

  /** 只刷新书（文件增删时） */
  refreshBooks() {
    if (!this.layout) return;
    for (const f of this.layout.furniture) {
      if (f.type !== "bookshelf") continue;
      const g = this.groups.get(f.id);
      if (!g) continue;
      const old = this.shelfBooks.get(f.id);
      if (old) {
        g.remove(old.mesh);
        old.dispose();
      }
      this.attachBooks(f, g);
    }
    if (this.target?.kind === "book") this.clearOutline();
    this.invalidate();
  }

  private attachBooks(f: Furniture, g: THREE.Group) {
    const items = this.books(f);
    const prev = this.shelfPaths.get(f.id);
    // 接着播放上一次重建时还没播完的
    const fresh = new Map(this.shelfBooks.get(f.id)?.dropping ?? []);
    if (prev && !this.reduceMotion) {
      const now = performance.now();
      const added = items.filter((it) => !prev.has(it.path));
      // 一次出现很多本（例如重新扫描、换了文件夹）不播放动画
      if (added.length <= 6) for (const it of added) fresh.set(it.path, now);
    }
    this.shelfPaths.set(f.id, new Set(items.map((i) => i.path)));
    const sb = new ShelfBooks(items, f.id, fresh);
    g.add(sb.mesh);
    this.shelfBooks.set(f.id, sb);
    this.attachSign(f, g);
  }

  /** 书架顶上的名牌：木板 + 像素字 */
  private attachSign(f: Furniture, g: THREE.Group) {
    const old = g.getObjectByName("sign");
    if (old) {
      g.remove(old);
      old.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.MeshBasicMaterial | undefined;
        if (mat && mat.map && o.name === "signtext") mat.map.dispose();
      });
    }
    const name = f.shelf?.name?.trim();
    if (!name) return;
    const sign = new THREE.Group();
    sign.name = "sign";
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.42, 0.06), signWood());
    sign.add(plank);
    const text = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.31), new THREE.MeshBasicMaterial({ map: signTexture(name), transparent: true }));
    text.position.z = 0.032;
    text.name = "signtext";
    sign.add(text);
    sign.position.set(0, 3.21, 0.44);
    sign.traverse((o) => {
      o.userData.fid = f.id;
    });
    g.add(sign);
  }

  /**
   * 在书房里找到一本书：走到它所在的书架前、看向它，书闪几下。
   * 书不在任何书架上时返回 false。
   */
  locateBook(path: string): Promise<boolean> {
    let found: { fid: string; slot: { min: THREE.Vector3; max: THREE.Vector3 } } | null = null;
    for (const [fid, sb] of this.shelfBooks) {
      const slot = sb.slots.find((sl) => sl.path === path);
      if (slot) {
        found = { fid, slot };
        break;
      }
    }
    const f = found ? this.layout?.furniture.find((x) => x.id === found!.fid) : undefined;
    const g = found ? this.groups.get(found.fid) : undefined;
    if (!found || !f || !g) return Promise.resolve(false);
    g.updateMatrixWorld(true);
    const target = found.slot.min.clone().add(found.slot.max).multiplyScalar(0.5).applyMatrix4(g.matrixWorld);
    // 站在书架正前方，离得远一点能看到整个书架；被挡住就换个距离
    const c = centerOf(f);
    const dir = facing(f.rot);
    let stand: { x: number; z: number } | null = null;
    for (const d of [2.8, 2.2, 3.4, 1.6, 1.2]) {
      const p = { x: c.x + dir.x * d, z: c.z + dir.z * d };
      const inside = p.x > 0.4 && p.z > 0.4 && p.x < ROOM_W - 0.4 && p.z < ROOM_D - 0.4;
      if (inside && this.ground.fits(p.x, p.z)) {
        stand = p;
        break;
      }
    }
    stand ??= { x: this.pos.x, z: this.pos.z };
    const dx = target.x - stand.x;
    const dz = target.z - stand.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(target.y - EYE, Math.hypot(dx, dz));
    this.seated = false;
    const from = { x: this.pos.x, z: this.pos.z, yaw: this.yaw, pitch: this.pitch };
    // 走最短的转向
    let dyaw = yaw - from.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const dist = Math.hypot(stand.x - from.x, stand.z - from.z);
    const dur = this.reduceMotion ? 0 : Math.min(1400, 450 + dist * 110);
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = () => {
        const k = dur === 0 ? 1 : Math.min(1, (performance.now() - t0) / dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        this.pos.x = from.x + (stand!.x - from.x) * e;
        this.pos.z = from.z + (stand!.z - from.z) * e;
        this.pos.y = 0;
        this.body = { x: this.pos.x, y: 0, z: this.pos.z, vy: 0, grounded: true };
        this.yaw = from.yaw + dyaw * e;
        this.pitch = from.pitch + (pitch - from.pitch) * e;
        this.applyCamera();
        this.render();
        if (k < 1) requestAnimationFrame(step);
        else {
          this.flashBook(g, found!.slot.min, found!.slot.max);
          resolve(true);
        }
      };
      step();
    });
  }

  private beacon: THREE.Mesh | null = null;

  /** 书闪几下（黄色光框忽明忽暗，约 6 秒） */
  private flashBook(parent: THREE.Object3D, min: THREE.Vector3, max: THREE.Vector3) {
    if (this.beacon) {
      this.beacon.parent?.remove(this.beacon);
      this.beacon.geometry.dispose();
    }
    const size = new THREE.Vector3().subVectors(max, min).addScalar(0.05);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshBasicMaterial({ color: 0xfff07a, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0xffffff })));
    m.position.copy(min).add(max).multiplyScalar(0.5);
    // 书上方一个上下跳动的箭头
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 4), new THREE.MeshBasicMaterial({ color: 0xffd84a }));
    arrow.rotation.x = Math.PI;
    arrow.position.set(0, size.y / 2 - 0.05, size.z / 2 + 0.25);
    arrow.name = "arrow";
    arrow.userData.ghost = true;
    m.add(arrow);
    m.userData.ghost = true;
    m.userData.t0 = performance.now();
    parent.add(m);
    this.beacon = m;
    this.needsRender = true;
  }

  /** 屏幕坐标处的家具或窗户（拖放导入时判断落点）；指着书时返回书架。会显示高亮。 */
  probeAt(clientX: number, clientY: number): { kind: "furniture"; fid: string } | { kind: "window"; side: Side } | null {
    if (this.hidden) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    if (!this.explore && !this.seated) this.applyCamera();
    this.raycaster.setFromCamera(p, this.camera);
    this.raycaster.far = 40;
    const hits = this.raycaster.intersectObjects([...this.furnitureRoot.children, ...this.windowTargets.children], true);
    for (const h of hits) {
      if (h.object.userData.ghost) continue;
      if (h.object.userData.window) {
        const side = h.object.userData.window as Side;
        const min = h.object.userData.min as THREE.Vector3;
        const max = h.object.userData.max as THREE.Vector3;
        this.showDropGlow(`window:${side}`, this.windowTargets, min, max);
        this.needsRender = true;
        if (!this.explore) this.render();
        return { kind: "window", side };
      }
      const fid = h.object.userData.fid as string | undefined;
      const f = fid ? this.layout?.furniture.find((x) => x.id === fid) : undefined;
      if (!f || f.type === "carpet") continue;
      const s = SPECS[f.type];
      const min = new THREE.Vector3(-s.w / 2, 0, -s.d / 2);
      const max = new THREE.Vector3(s.w / 2, s.h || 0.02, s.d / 2);
      this.showDropGlow(f.id, this.groups.get(f.id)!, min, max);
      this.needsRender = true;
      if (!this.explore) this.render();
      return { kind: "furniture", fid: f.id };
    }
    this.clearProbe();
    return null;
  }

  private dropGlow: THREE.Mesh | null = null;
  private dropGlowFid = "";

  /** 拖放目标的高亮：半透明的暖黄色方块罩住家具，黑色描边在深色家具上看不清 */
  private showDropGlow(fid: string, parent: THREE.Object3D, min: THREE.Vector3, max: THREE.Vector3) {
    if (this.dropGlowFid === fid && this.dropGlow) return;
    this.hideDropGlow();
    const size = new THREE.Vector3().subVectors(max, min).addScalar(0.08);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshBasicMaterial({ color: 0xffe98a, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    m.position.copy(min).add(max).multiplyScalar(0.5);
    m.userData.ghost = true;
    m.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(m.geometry),
        new THREE.LineBasicMaterial({ color: 0xfff1a8 }),
      ),
    );
    m.children[0].userData.ghost = true;
    parent.add(m);
    this.dropGlow = m;
    this.dropGlowFid = fid;
  }

  private hideDropGlow() {
    if (!this.dropGlow) return;
    this.dropGlow.parent?.remove(this.dropGlow);
    this.dropGlow.geometry.dispose();
    (this.dropGlow.material as THREE.Material).dispose();
    this.dropGlow = null;
    this.dropGlowFid = "";
  }

  clearProbe() {
    if (this.dropGlow) {
      this.hideDropGlow();
      this.needsRender = true;
      if (!this.explore) this.render();
    }
  }

  /**
   * 拖放导入的动画：每个文件变成一个旋转的小方块，从落点弹出，悬停一下，再飞进目标家具。
   * 只是画面效果，文件早已复制完成。
   */
  spawnDrops(clientX: number, clientY: number, fid: string | null, colors: string[]) {
    if (this.hidden || this.reduceMotion || colors.length === 0) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(p, this.camera);
    this.raycaster.far = 40;
    const hit = this.raycaster.intersectObjects(this.furnitureRoot.children, true).find((h) => !h.object.userData.ghost);
    const ray = this.raycaster.ray;
    let from: THREE.Vector3;
    if (hit && hit.distance < 8) from = hit.point.clone();
    else if (ray.direction.y < -0.01) from = ray.origin.clone().addScaledVector(ray.direction, Math.min(8, -ray.origin.y / ray.direction.y));
    else from = ray.origin.clone().addScaledVector(ray.direction, 2.5);
    // 从落点朝玩家方向弹出一段，停在视线附近，看得清
    const toCam = ray.origin.clone().sub(from);
    const back = Math.min(toCam.length() * 0.3, 1.6);
    from.addScaledVector(toCam.normalize(), back);
    from.y = Math.min(Math.max(0.6, from.y), 1.4);
    let to: THREE.Vector3 | null = null;
    const f = fid ? this.layout?.furniture.find((x) => x.id === fid) : undefined;
    if (f) {
      const c = centerOf(f);
      to = new THREE.Vector3(c.x, Math.max(0.3, SPECS[f.type].h * 0.55), c.z);
    }
    const now = performance.now();
    const n = Math.min(colors.length, 14);
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.21, 0.06),
        [
          new THREE.MeshLambertMaterial({ color: colors[i] }),
          new THREE.MeshLambertMaterial({ color: colors[i] }),
          new THREE.MeshLambertMaterial({ map: textures().pages }),
          new THREE.MeshLambertMaterial({ map: textures().pages }),
          new THREE.MeshLambertMaterial({ map: textures().bookSpine, color: colors[i] }),
          new THREE.MeshLambertMaterial({ color: colors[i] }),
        ],
      );
      mesh.position.copy(from);
      mesh.userData.ghost = true;
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      const spread = 0.25 + Math.random() * 0.35;
      const mid = from.clone().add(new THREE.Vector3(Math.cos(ang) * spread, 0.3 + Math.random() * 0.3, Math.sin(ang) * spread));
      mid.y = Math.min(mid.y, 1.75);
      this.scene.add(mesh);
      this.flying.push({ mesh, from, mid, to, fid: to ? fid : null, t0: now + i * 70, spin: (Math.random() - 0.5) * 6 });
    }
    this.needsRender = true;
  }

  private disposeDrop(m: THREE.Mesh) {
    this.scene.remove(m);
    m.geometry.dispose();
    for (const mat of m.material as THREE.Material[]) mat.dispose();
  }

  /** 掉落物与家具"吞下"的动画；返回是否还有动画在播放 */
  private animateFlying(now: number): boolean {
    if (!this.flying.length && !this.gulps.size) return false;
    const POP = 420;
    const HOVER = 380;
    const FLY = 460;
    const keep: typeof this.flying = [];
    for (const d of this.flying) {
      const t = now - d.t0;
      const m = d.mesh;
      m.visible = t >= 0;
      if (t < 0) {
        keep.push(d);
        continue;
      }
      m.rotation.y = (t / 1000) * (2.4 + d.spin);
      if (t < POP) {
        // 抛物线弹出
        const k = t / POP;
        m.position.lerpVectors(d.from, d.mid, k);
        m.position.y = d.from.y + (d.mid.y - d.from.y) * (1 - (1 - k) * (1 - k)) + Math.sin(k * Math.PI) * 0.15;
        keep.push(d);
      } else if (t < POP + HOVER || !d.to) {
        // 悬浮上下浮动；没有目标时多停一会儿再缩小消失
        const k = (t - POP) / 1000;
        m.position.copy(d.mid);
        m.position.y += Math.sin(k * Math.PI * 3) * 0.05;
        if (!d.to) {
          const fade = Math.max(0, 1 - Math.max(0, t - POP - 1200) / 400);
          m.scale.setScalar(fade);
          if (fade <= 0) {
            this.disposeDrop(m);
            continue;
          }
        }
        keep.push(d);
      } else {
        const k = Math.min(1, (t - POP - HOVER) / FLY);
        const e = k * k * k;
        m.position.lerpVectors(d.mid, d.to, e);
        m.position.y += Math.sin(k * Math.PI) * 0.25;
        m.scale.setScalar(1 - 0.75 * e);
        if (k >= 1) {
          this.disposeDrop(m);
          if (d.fid) this.gulps.set(d.fid, now);
          this.cb.onDropArrive?.();
          continue;
        }
        keep.push(d);
      }
    }
    this.flying = keep;
    // 家具收下一件时轻轻一缩一弹
    for (const [fid, t0] of this.gulps) {
      const g = this.groups.get(fid);
      const k = (now - t0) / 220;
      if (!g || k >= 1) {
        g?.scale.set(1, 1, 1);
        this.gulps.delete(fid);
        continue;
      }
      const s = 1 + Math.sin(k * Math.PI) * 0.06;
      g.scale.set(s, 1 / s, s);
    }
    return true;
  }

  // ───────────── 墙上的东西 ─────────────

  /** 重建墙上的黑板与画框；surface(it) 提供画面贴图 */
  setWallItems(items: WallItem[], surface: (it: WallItem) => THREE.Texture) {
    for (const g of this.wallGroups.values()) {
      this.wallRoot.remove(g);
      g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    this.wallGroups.clear();
    for (const it of items) {
      const g = buildWallItem(it, surface(it));
      this.wallGroups.set(it.id, g);
      this.wallRoot.add(g);
    }
    this.clearOutline();
    this.invalidate();
  }

  /** 换某个挂件的画面（笔记改了、图片加载完） */
  setWallSurface(id: string, tex: THREE.Texture) {
    const face = this.wallGroups.get(id)?.getObjectByName("surface") as THREE.Mesh | undefined;
    if (!face) return;
    const mat = face.material as THREE.MeshLambertMaterial;
    if (mat.map && mat.map !== tex) mat.map.dispose();
    mat.map = tex;
    mat.needsUpdate = true;
    this.invalidate();
  }

  /** 进入挂墙模式：准星对准墙面左键挂上，右键取消 */
  startWallPlacing(type: WallItemType, w: number, h: number) {
    this.wallPlacing = { type, w, h };
    this.setSelected(null);
    this.needsRender = true;
  }

  setWallPlacingSize(w: number, h: number) {
    if (!this.wallPlacing) return;
    this.wallPlacing = { ...this.wallPlacing, w, h };
    this.hideWallGhost();
  }

  get isWallPlacing() {
    return this.wallPlacing;
  }

  cancelWallPlacing() {
    if (!this.wallPlacing) return;
    this.wallPlacing = null;
    this.wallSpot = null;
    this.hideWallGhost();
    this.cb.onWallPlacingEnd?.();
    this.needsRender = true;
  }

  private hideWallGhost() {
    if (!this.wallGhost) return;
    this.scene.remove(this.wallGhost);
    this.wallGhost.geometry.dispose();
    this.wallGhost = null;
  }

  /** 视线与四面墙内侧的交点（最近的一面） */
  private wallHit(): { side: WallSide; a: number; y: number } | null {
    const o = this.raycaster.ray.origin;
    const d = this.raycaster.ray.direction;
    let best: { side: WallSide; a: number; y: number; t: number } | null = null;
    const consider = (side: WallSide, t: number) => {
      if (!(t > 0) || t > REACH + 2) return;
      const p = o.clone().addScaledVector(d, t);
      if (p.y < 0 || p.y > ROOM_H) return;
      const a = side === "north" || side === "south" ? p.x : p.z;
      const len = side === "north" || side === "south" ? ROOM_W : ROOM_D;
      if (a < 0 || a > len) return;
      if (!best || t < best.t) best = { side, a, y: p.y, t };
    };
    if (d.z < 0) consider("north", -o.z / d.z);
    if (d.z > 0) consider("south", (ROOM_D - o.z) / d.z);
    if (d.x < 0) consider("west", -o.x / d.x);
    if (d.x > 0) consider("east", (ROOM_W - o.x) / d.x);
    const b = best as { side: WallSide; a: number; y: number; t: number } | null;
    return b ? { side: b.side, a: b.a, y: b.y } : null;
  }

  private updateWallSpot(): Target {
    const pl = this.wallPlacing!;
    const hit = this.wallHit();
    if (!hit || !this.layout) {
      this.wallSpot = null;
      this.hideWallGhost();
      return null;
    }
    const a = snapWall(hit.a);
    const y = snapWall(hit.y);
    const check = canPlaceWall(
      { side: hit.side, a, y, w: pl.w, h: pl.h },
      { windows: this.theme.windows, fireplace: this.theme.fireplace, items: this.layout.wall ?? [], furniture: this.layout.furniture },
    );
    this.wallSpot = { side: hit.side, a, y, valid: check.ok, reason: check.ok ? undefined : check.reason };
    if (!this.wallGhost) {
      this.wallGhost = new THREE.Mesh(new THREE.BoxGeometry(pl.w, pl.h, 0.06), new THREE.MeshBasicMaterial({ color: 0x8ff07a, transparent: true, opacity: 0.45, depthWrite: false }));
      this.wallGhost.userData.ghost = true;
      this.scene.add(this.wallGhost);
    }
    const tr = wallTransform({ side: hit.side, a, y }, 0.06);
    this.wallGhost.position.set(tr.x, tr.y, tr.z);
    this.wallGhost.rotation.y = tr.ry;
    (this.wallGhost.material as THREE.MeshBasicMaterial).color.set(check.ok ? 0x8ff07a : 0xff6a5a);
    return { kind: "wallspot", ...this.wallSpot };
  }

  /** 宠物睡觉的地方（最近看的书所在书架前） */
  setNapSpot(p: { x: number; z: number } | null) {
    this.napSpot = p;
  }

  /** 书架正前方一步的位置（宠物睡觉、带路用） */
  frontOf(fid: string, dist = 1.2): { x: number; z: number } | null {
    const f = this.layout?.furniture.find((x) => x.id === fid);
    if (!f) return null;
    const c = centerOf(f);
    const d = facing(f.rot);
    return { x: c.x + d.x * dist, z: c.z + d.z * dist };
  }

  private jukeboxPlaying = false;
  private noteSprites: { s: THREE.Sprite; t0: number }[] = [];
  private lastNote = 0;

  /** 留声机：播放时唱片转、冒音符 */
  setJukeboxPlaying(on: boolean) {
    this.jukeboxPlaying = on;
    this.needsRender = true;
  }

  private animateJukebox(dt: number, now: number) {
    if (this.jukeboxPlaying) {
      this.furnitureRoot.traverse((o) => {
        if (o.name === "disc") o.rotation.y += dt * 3.5;
      });
      if (!this.reduceMotion && now - this.lastNote > 700) {
        this.lastNote = now;
        this.furnitureRoot.traverse((o) => {
          if (o.name !== "notesAnchor") return;
          const p = new THREE.Vector3();
          o.getWorldPosition(p);
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTexture(Math.floor(Math.random() * NOTE_COLORS.length)), transparent: true, depthWrite: false }));
          s.scale.setScalar(0.22);
          s.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3));
          s.userData.ghost = true;
          this.scene.add(s);
          this.noteSprites.push({ s, t0: now });
        });
      }
    }
    this.noteSprites = this.noteSprites.filter(({ s, t0 }) => {
      const t = (now - t0) / 1800;
      if (t >= 1) {
        this.scene.remove(s);
        s.material.dispose();
        return false;
      }
      s.position.y += dt * 0.35;
      s.position.x += Math.sin(now / 300 + t0) * dt * 0.1;
      s.material.opacity = 1 - t;
      return true;
    });
  }

  /** 书桌上的沙漏：progress 0–1，null 为静置 */
  private hourglassProgress: number | null = null;

  setHourglass(progress: number | null) {
    this.hourglassProgress = progress;
    this.furnitureRoot.traverse((o) => {
      if (o.name === "hourglass") setSand(o, progress);
    });
    this.invalidate();
  }

  /** 鱼塘冒泡（有一条旧灵感或沉睡的书浮上来） */
  setPondBubble(on: boolean) {
    this.bubbling = on;
    this.needsRender = true;
  }

  /** 抛竿入水：水花气泡持续一会儿 */
  pondSplash() {
    this.splashUntil = performance.now() + 1800;
    this.needsRender = true;
  }

  /** 玩家站在哪块地毯上（位置变化或家具变化时检查） */
  private updateCarpet(force = false) {
    const c = this.layout ? carpetAt(this.layout, this.pos.x, this.pos.z) : null;
    const id = c?.id ?? null;
    if (id !== this.carpetId || force) {
      const changed = id !== this.carpetId;
      this.carpetId = id;
      if (changed || force) this.cb.onCarpet?.(id);
    }
  }

  /** 调试：瞬移并朝向某处（开发测试用） */
  debugTeleport(x: number, z: number, yaw: number, pitch = 0, y = 0) {
    this.pos.set(x, y, z);
    this.body = { x, y, z, vy: 0, grounded: true };
    this.yaw = yaw;
    this.pitch = pitch;
    this.applyCamera();
    this.updateTarget();
    this.updateCarpet();
    this.render();
    return this.target;
  }

  player() {
    return { x: this.pos.x, z: this.pos.z, yaw: this.yaw, pitch: this.pitch };
  }

  // ───────────── 模式 ─────────────

  /** 进入 / 离开探索模式。离开时释放鼠标并清空按键。 */
  setExplore(on: boolean) {
    this.explore = on;
    this.keys.clear();
    if (!on) {
      this.releaseLock();
      this.setTarget(null);
      this.hideGhost();
    }
    this.invalidate();
  }

  get isLocked() {
    return this.locked || this.grabbed;
  }

  get usesDragLook() {
    return this.dragLook;
  }

  /**
   * 请求鼠标锁定（必须在用户点击中调用）。三级降级：
   * 1. 浏览器 Pointer Lock；2. 原生光标锁定（Tauri）；3. 按住拖动转视角。
   */
  async lock() {
    if (this.lockUnavailable) {
      await this.fallbackLock();
      return;
    }
    const el = this.renderer.domElement;
    try {
      const r = el.requestPointerLock?.() as unknown;
      if (r && typeof (r as Promise<void>).then === "function") await r;
      // 某些 WebView 不报错也不锁定：稍后检查
      setTimeout(() => {
        if (!this.locked && this.explore && document.pointerLockElement !== el) {
          this.lockUnavailable = true;
          void this.fallbackLock();
        }
      }, 350);
    } catch {
      this.lockUnavailable = true;
      await this.fallbackLock();
    }
  }

  private async fallbackLock() {
    if (!this.grabUnavailable && this.cb.nativeGrab) {
      const ok = await this.cb.nativeGrab(true).catch(() => false);
      if (ok && this.explore) {
        this.grabbed = true;
        this.dragLook = false;
        return;
      }
      if (!ok) this.grabUnavailable = true;
    }
    this.enableDragLook();
  }

  private enableDragLook() {
    if (!this.dragLook) {
      this.dragLook = true;
      this.cb.onLookFallback();
    }
  }

  releaseLock() {
    if (document.pointerLockElement) {
      this.releasing = true;
      document.exitPointerLock();
    }
    if (this.grabbed) {
      this.grabbed = false;
      void this.cb.nativeGrab?.(false);
    }
  }

  setSelected(type: FurnitureType | null) {
    this.selected = type;
    this.hand.setItem(type);
    if (!type) this.hideGhost();
    this.needsRender = true;
  }

  rotateGhost() {
    this.ghostRot = ((this.ghostRot + 1) % 4) as Rot;
    this.needsRender = true;
  }

  get ghostRotation(): Rot {
    return this.ghostRot;
  }

  // ───────────── 书桌 ─────────────

  /** 坐到书桌前：镜头移到椅子上方看向摊开的书 */
  sitAt(deskId: string): Promise<void> {
    const g = this.groups.get(deskId);
    if (!g) return Promise.resolve();
    this.setExplore(false);
    this.seated = true;
    const chair = g.getObjectByName("chair")!;
    const book = g.getObjectByName("openbook")!;
    const seat = new THREE.Vector3();
    chair.getWorldPosition(seat);
    const look = new THREE.Vector3();
    book.getWorldPosition(look);
    seat.y = 1.32;
    const toPos = seat;
    const toQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(toPos, look, new THREE.Vector3(0, 1, 0)));
    return this.animateCamera(toPos, toQuat, 650);
  }

  /** 站起来回到书桌前方 */
  standUp(deskId?: string): Promise<void> {
    if (!this.seated) return Promise.resolve();
    this.seated = false;
    const f = deskId ? this.layout?.furniture.find((x) => x.id === deskId) : undefined;
    if (f) {
      const c = centerOf(f);
      const dir = facing(f.rot);
      this.placeBody(c.x + dir.x * 1.6, c.z + dir.z * 1.6);
      this.yaw = Math.atan2(dir.x, dir.z);
      this.pitch = -0.35;
    }
    const toPos = new THREE.Vector3(this.pos.x, EYE, this.pos.z);
    const toQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
    return this.animateCamera(toPos, toQuat, 450);
  }

  private animateCamera(toPos: THREE.Vector3, toQuat: THREE.Quaternion, ms: number): Promise<void> {
    const fromPos = this.camera.position.clone();
    const fromQuat = this.camera.quaternion.clone();
    const dur = this.reduceMotion ? 0 : ms;
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = () => {
        const k = dur === 0 ? 1 : Math.min(1, (performance.now() - t0) / dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        this.camera.position.lerpVectors(fromPos, toPos, e);
        this.camera.quaternion.slerpQuaternions(fromQuat, toQuat, e);
        this.renderOnce();
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      step();
    });
  }

  // ───────────── 输入 ─────────────

  private bindInput() {
    const el = this.renderer.domElement;
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };

    on(document, "pointerlockchange", () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === el;
      if (this.locked) this.dragLook = false;
      if (was && !this.locked) {
        this.keys.clear();
        if (!this.releasing && this.explore) this.cb.onPause();
        this.releasing = false;
      }
    });
    on(document, "pointerlockerror", () => this.enableDragLook());

    on(el, "mousemove", (e: MouseEvent) => {
      if (!this.explore) return;
      if (this.locked || this.grabbed) this.look(e.movementX, e.movementY);
      else if (this.dragLook && this.dragStart) {
        if (Math.abs(e.clientX - this.dragStart.x) + Math.abs(e.clientY - this.dragStart.y) > 4) this.dragStart.moved = true;
        if (this.dragStart.moved) this.look(e.movementX, e.movementY);
      }
    });
    on(el, "mousedown", (e: MouseEvent) => {
      if (!this.explore) return;
      if (this.locked || this.grabbed) {
        if (e.button === 0) this.primary();
        else if (e.button === 2) this.secondary();
        return;
      }
      if (this.dragLook) this.dragStart = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
    });
    on(window, "mouseup", (e: MouseEvent) => {
      if (!this.dragStart) return;
      const d = this.dragStart;
      this.dragStart = null;
      if (!this.explore || d.moved) return;
      // 拖动模式下，点击位置作为准星
      this.aimAtScreen(e.clientX, e.clientY);
      if (d.button === 0) this.primary();
      else if (d.button === 2) this.secondary();
    });
    on(el, "contextmenu", (e: MouseEvent) => e.preventDefault());
    on(window, "blur", () => {
      this.keys.clear();
      // 切出窗口时释放原生光标锁定，回到暂停菜单
      if (this.grabbed) {
        this.releaseLock();
        if (this.explore) this.cb.onPause();
      }
    });

    on(window, "keydown", (e: KeyboardEvent) => {
      if (!this.explore || e.isComposing || e.keyCode === 229 || e.metaKey || e.ctrlKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft"].includes(e.code)) {
        this.keys.add(e.code);
        e.preventDefault();
      }
    });
    on(window, "keyup", (e: KeyboardEvent) => this.keys.delete(e.code));
  }

  private look(dx: number, dy: number) {
    const s = 0.0024;
    this.yaw -= dx * s;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * s));
  }

  private aimPoint: THREE.Vector2 | null = null;

  private aimAtScreen(cx: number, cy: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.aimPoint = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.updateTarget();
    this.aimPoint = null;
  }

  private primary() {
    this.hand.swing();
    if (this.wallPlacing) {
      const s = this.wallSpot;
      if (!s) return;
      if (!s.valid) {
        this.cb.onPlaceRejected(s.reason ?? "挂不上去");
        return;
      }
      const pl = this.wallPlacing;
      this.wallPlacing = null;
      this.wallSpot = null;
      this.hideWallGhost();
      this.cb.onPlaceWall?.({ side: s.side, a: s.a, y: s.y, w: pl.w, h: pl.h });
      this.cb.onWallPlacingEnd?.();
      return;
    }
    const t = this.target;
    if (t?.kind === "door") {
      this.toggleDoor();
      return;
    }
    if (t && t.kind !== "floor" && t.kind !== "wallspot") this.cb.onInteract(t);
  }

  private secondary() {
    this.hand.use();
    if (this.wallPlacing) {
      this.cancelWallPlacing();
      return;
    }
    if (!this.selected || !this.ghostSpot) return;
    if (!this.ghostSpot.valid) {
      this.cb.onPlaceRejected(this.ghostSpot.reason ?? "这里放不下");
      return;
    }
    this.cb.onPlace({ type: this.selected, x: this.ghostSpot.x, z: this.ghostSpot.z, rot: this.ghostRot });
  }

  // ───────────── 循环 ─────────────

  private start() {
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (this.hidden) return;
      this.animate(dt);
      if (this.explore) {
        this.step(dt);
        this.updateCarpet();
        this.applyCamera();
        this.updateTarget();
        this.hand.update(dt, this.walked, this.env.roomLight);
        this.walked = 0;
        this.render(true);
      } else if (this.needsRender || now - this.lastIdleRender > 100) {
        // 非探索状态：约 10 帧/秒，让窗外的天气与时间继续变化
        this.lastIdleRender = now;
        this.render();
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** 走路、跳跃、落地：像方块游戏那样，脚下的格子有高度，半格自动迈上，一格要跳 */
  private step(dt: number) {
    const f = (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) - (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0);
    const r = (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) - (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
    const b = this.body;
    b.x = this.pos.x;
    b.z = this.pos.z;
    const wasGrounded = b.grounded;
    const fromY = b.y;
    if (f || r) {
      const len = Math.hypot(f, r);
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // 空中稍慢一点，落点更好控制
      const sp = ((b.grounded ? WALK : WALK * 0.85) * dt) / len;
      const dx = (-sin * f + cos * r) * sp;
      const dz = (-cos * f - sin * r) * sp;
      const x0 = b.x,
        z0 = b.z;
      const { stepped } = moveBody(this.ground, b, dx, dz);
      if (stepped) this.eyeLag = Math.min(0.5, this.eyeLag + (b.y - fromY));
      if (b.grounded) {
        const d = Math.hypot(b.x - x0, b.z - z0);
        this.walked += d;
        const before = Math.floor(this.headBob / Math.PI);
        this.headBob += d * 2.2;
        if (Math.floor(this.headBob / Math.PI) !== before) this.cb.onStep?.();
      }
    }
    fallBody(this.ground, b, dt, this.keys.has("Space"));
    if (!wasGrounded && b.grounded) this.cb.onLand?.(Math.max(0, this.fallFrom - b.y));
    if (b.grounded) this.fallFrom = b.y;
    else this.fallFrom = Math.max(this.fallFrom, b.y);
    this.pos.set(b.x, b.y, b.z);
    this.eyeLag = Math.max(0, this.eyeLag - dt * 4);
  }

  private fallFrom = 0;

  private headBob = 0;

  private applyCamera() {
    const bob = this.reduceMotion || !this.explore ? 0 : Math.abs(Math.sin(this.headBob)) * 0.035;
    this.camera.position.set(this.pos.x, this.pos.y + EYE + bob - this.eyeLag, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    this.camera.updateMatrixWorld();
  }

  /** 环境、灯光、旋转物体 */
  private animate(dt: number) {
    this.env.update(dt);
    const night = 1 - this.env.roomLight;
    for (const l of this.lights) l.intensity = (l.userData.base as number) * (1 + night * 0.9);
    for (const o of this.spinners) o.rotation.y += dt * 0.9;
    // 壁炉火焰跳动
    if (this.room.fire && !this.reduceMotion) {
      const t = performance.now() / 1000;
      this.room.fire.scale.y = 0.85 + Math.sin(t * 9) * 0.08 + Math.sin(t * 23) * 0.05;
      if (this.fireLight) this.fireLight.intensity = 6 + Math.sin(t * 11) * 0.8 + Math.sin(t * 29) * 0.5;
    }
    const now = performance.now();
    if (!this.reduceMotion) {
      const water = textures().water;
      water.offset.x = (water.offset.x + dt * 0.04) % 1;
      water.offset.y = (water.offset.y + dt * 0.015) % 1;
    }
    // 鱼塘气泡：冒泡或刚抛竿时显示，方块小气泡上升、变小、再从水面出现
    const showBubbles = this.bubbling || now < this.splashUntil;
    const speed = now < this.splashUntil ? 1.6 : 0.5;
    for (const b of this.ponds) {
      b.visible = showBubbles;
      if (!showBubbles) continue;
      for (const c of b.children) {
        const t = (now / 1000 * speed + (c.userData.phase as number)) % 1;
        c.position.y = 0.42 + t * 0.55;
        c.scale.setScalar(Math.max(0.05, 1 - t));
      }
      const bob = b.parent?.getObjectByName("bobber");
      if (bob) bob.position.y = 0.39 + Math.sin(now / 220) * 0.025;
    }
    let books = false;
    for (const sb of this.shelfBooks.values()) if (sb.animate(now)) books = true;
    if (this.animateFlying(now)) books = true;
    this.animateJukebox(dt, now);
    if (this.noteSprites.length && !this.explore) this.needsRender = true;
    this.pets.update(dt, { ground: this.ground, player: { x: this.pos.x, z: this.pos.z }, light: this.env.roomLight, napSpot: this.napSpot });
    if (this.bird.update(dt, { player: { x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw }, perch: this.perchPoint() })) books = true;
    // 门的开合
    const doorGoal = this.doorOpen ? 1 : 0;
    if (this.doorT !== doorGoal) {
      this.doorT = doorGoal > this.doorT ? Math.min(1, this.doorT + dt * 3.2) : Math.max(0, this.doorT - dt * 3.2);
      if (this.reduceMotion) this.doorT = doorGoal;
      this.applyDoor();
      books = true;
    }
    // 走出门：光线从屋里的亮度换成屋外的天光
    const out = this.isOutside;
    if (out !== this.wasOutside) {
      this.wasOutside = out;
      this.cb.onOutside?.(out);
    }
    const goal = out ? 1 : 0;
    if (Math.abs(this.outsideT - goal) > 0.001) {
      this.outsideT += (goal - this.outsideT) * Math.min(1, dt * 2.5);
      this.env.setOutside(this.outsideT);
    }
    // 路灯和远处的窗户天黑后亮起来
    const glow = Math.max(0, 1 - this.env.light * 1.6);
    for (const m of [...(this.yard?.glow ?? []), ...(this.terrain?.glow ?? [])]) m.emissiveIntensity = glow;
    if (this.beacon) {
      const t = now - (this.beacon.userData.t0 as number);
      if (t > 6000) {
        this.beacon.parent?.remove(this.beacon);
        this.beacon.geometry.dispose();
        this.beacon = null;
      } else {
        (this.beacon.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.4 * Math.abs(Math.sin(t / 260));
        const arrow = this.beacon.getObjectByName("arrow");
        const hy = (this.beacon.geometry as THREE.BoxGeometry).parameters.height;
        if (arrow) {
          arrow.position.y = hy / 2 - 0.05 + Math.abs(Math.sin(t / 220)) * 0.12;
          arrow.rotation.y = t / 400;
        }
      }
      books = true;
    }
    if (books && !this.explore) this.needsRender = true;
  }

  private render(withHand = false) {
    this.renderer.render(this.scene, this.camera);
    if (withHand) this.hand.render(this.renderer);
    this.needsRender = false;
  }

  renderOnce() {
    this.render();
  }

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hand.resize(w / h);
    if (!this.explore && !this.seated) this.applyCamera();
    this.render();
  }

  // ───────────── 瞄准 ─────────────

  private updateTarget() {
    this.raycaster.setFromCamera(this.aimPoint ?? new THREE.Vector2(0, 0), this.camera);
    this.raycaster.far = REACH;
    if (this.wallPlacing) {
      this.clearOutline();
      this.hideGhost();
      this.setTarget(this.updateWallSpot());
      return;
    }
    const hits = this.raycaster.intersectObjects(
      [...this.furnitureRoot.children, ...this.windowTargets.children, ...this.wallRoot.children, ...this.pets.objects, ...this.bird.objects, this.room.group, ...(this.yard ? [this.yard.group] : [])],
      true,
    );
    let next: Target = null;
    let hitFloor: THREE.Vector3 | null = null;
    for (const h of hits) {
      const obj = h.object;
      if (obj.userData.ghost) continue;
      if (obj.userData.bird) {
        next = { kind: "bird" };
        this.clearOutline();
        break;
      }
      if (obj.userData.door) {
        next = { kind: "door", open: this.doorOpen };
        this.showOutline("door", this.room.group, new THREE.Vector3(DOOR.x0, 0, DOOR.z - 0.02), new THREE.Vector3(DOOR.x1, DOOR.h, DOOR.z + 0.25));
        break;
      }
      // 院子里的花草：空手可以拔杂草、摘花
      if (obj.userData.yard && (obj as THREE.InstancedMesh).isInstancedMesh && h.instanceId !== undefined && h.distance < 5) {
        const m = new THREE.Matrix4();
        (obj as THREE.InstancedMesh).getMatrixAt(h.instanceId, m);
        const p = new THREE.Vector3().setFromMatrixPosition(m);
        const cx = Math.floor(p.x),
          cz = Math.floor(p.z);
        const item = (this.gardenItems ?? (this.defaultItems ??= defaultGarden())).find((b) => b.x === cx && b.z === cz);
        if (item && item.kind !== "post") {
          next = { kind: "garden", x: cx, z: cz, item: item.kind };
          this.clearOutline();
        }
        break;
      }
      // 墙、地板、院子里的东西挡住视线
      if (obj.userData.occluder) break;
      if (obj.userData.petId) {
        next = { kind: "pet", id: obj.userData.petId as string };
        this.clearOutline();
        break;
      }
      if (obj.userData.wallId) {
        const id = obj.userData.wallId as string;
        const it = this.layout?.wall?.find((x) => x.id === id);
        if (it) {
          next = { kind: "wall", id };
          this.showOutline(`wall:${id}`, this.wallGroups.get(id)!, new THREE.Vector3(-it.w / 2 - 0.06, -it.h / 2 - 0.06, -0.03), new THREE.Vector3(it.w / 2 + 0.06, it.h / 2 + 0.06, 0.06));
          break;
        }
      }
      if (obj.userData.window) {
        next = { kind: "window", side: obj.userData.window };
        this.showOutline(`w:${obj.userData.window}`, this.windowTargets as unknown as THREE.Group, obj.userData.min, obj.userData.max);
        break;
      }
      const sb = obj.userData.books as ShelfBooks | undefined;
      if (sb && h.instanceId !== undefined) {
        const slot = sb.slots[h.instanceId];
        if (slot) {
          next = { kind: "book", fid: obj.userData.fid, path: slot.path };
          this.showOutline(`book:${slot.path}`, this.groups.get(obj.userData.fid)!, slot.min, slot.max);
          break;
        }
      }
      const fid = obj.userData.fid as string | undefined;
      const f = fid ? this.layout?.furniture.find((x) => x.id === fid) : undefined;
      if (f) {
        // 手上拿着家具时地毯当作地面（可以在上面放东西）；空手时可以选中地毯
        if (f.type === "carpet" && this.selected) {
          hitFloor = h.point;
          break;
        }
        next = { kind: "furniture", fid: f.id, type: f.type };
        const s = SPECS[f.type];
        this.showOutline(`f:${f.id}`, this.groups.get(f.id)!, new THREE.Vector3(-s.w / 2, 0, -s.d / 2), new THREE.Vector3(s.w / 2, s.h || 0.02, s.d / 2));
        break;
      }
    }
    if (!next && !hitFloor && this.raycaster.ray.direction.y < -0.01) {
      // 与地面 y = 0 求交
      const t = -this.raycaster.ray.origin.y / this.raycaster.ray.direction.y;
      if (t > 0 && t < REACH) hitFloor = this.raycaster.ray.origin.clone().addScaledVector(this.raycaster.ray.direction, t);
    }
    if (!next) this.clearOutline();
    if (!next && hitFloor && this.selected) {
      const { w, d } = footprint({ type: this.selected, rot: this.ghostRot });
      const x = Math.round(hitFloor.x - w / 2);
      const z = Math.round(hitFloor.z - d / 2);
      const check = this.layout ? canPlace(this.layout, { type: this.selected, x, z, rot: this.ghostRot }, undefined, this.pos) : { ok: false as const, reason: "" };
      this.ghostSpot = { x, z, valid: check.ok, reason: check.ok ? undefined : check.reason };
      this.showGhost(this.selected, { x, z, rot: this.ghostRot }, check.ok);
      next = { kind: "floor", x, z, valid: check.ok, reason: check.ok ? undefined : check.reason };
    } else {
      this.ghostSpot = null;
      this.hideGhost();
    }
    this.setTarget(next);
  }

  private setTarget(t: Target) {
    const same =
      (t === null && this.target === null) ||
      (t &&
        this.target &&
        t.kind === this.target.kind &&
        JSON.stringify(t) === JSON.stringify(this.target));
    this.target = t;
    if (!same) this.cb.onTarget(t);
  }

  private outlineKey = "";

  private showOutline(key: string, parent: THREE.Group, min: THREE.Vector3, max: THREE.Vector3) {
    if (this.outlineKey === key && this.outline) return;
    this.clearOutline();
    this.outline = outlineFor(min, max);
    this.outline.userData.ghost = true;
    parent.add(this.outline);
    this.outlineKey = key;
  }

  private clearOutline() {
    if (this.outline) {
      this.outline.parent?.remove(this.outline);
      this.outline.geometry.dispose();
    }
    this.outline = null;
    this.outlineKey = "";
  }

  private showGhost(type: FurnitureType, at: Pick<Furniture, "x" | "z" | "rot">, valid: boolean) {
    if (this.ghostType !== type) {
      this.hideGhost();
      this.ghost = buildGhost(type);
      this.ghost.traverse((o) => (o.userData.ghost = true));
      this.ghostType = type;
      this.scene.add(this.ghost);
    }
    placeGroup(this.ghost!, { type, ...at });
    if (type === "carpet") this.ghost!.position.y = 0.01;
    (this.ghost!.userData.setValid as (v: boolean) => void)(valid);
  }

  private hideGhost() {
    if (this.ghost) this.scene.remove(this.ghost);
    this.ghost = null;
    this.ghostType = null;
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.releaseLock();
    for (const c of this.cleanup) c();
    for (const b of this.shelfBooks.values()) b.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
