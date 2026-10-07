// 书房外的环境：天空颜色、方形太阳与月亮、星星、方块云、雨雪、窗景、随时间变化的光照。
import * as THREE from "three";
import { hashString, ROOM } from "./layout";
import { lightsFor, presetArt } from "./sceneryArt";
import { BACKDROPS, resolveScenery, SLICES, type Backdrop } from "./scenerySources";
import type { SceneryPreset } from "./themes";
import {
  currentWeather,
  daylight,
  DEFAULT_ENV,
  hourOf,
  skyColor,
  sunColor,
  sunDirection,
  weatherDim,
  type EnvSettings,
  type Weather,
} from "./sky";

const SKY_RADIUS = 150;
/** 远景画离屋子的距离（立体地形在它以内） */
export const BACKDROP_DISTANCE = 104;
const RAIN_COUNT = 1400;
const SNOW_COUNT = 1100;

function pixelTexture(draw: (g: CanvasRenderingContext2D) => void, size = 16): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 方形太阳：亮黄中心 + 外圈光晕（原创图案） */
function sunTexture() {
  return pixelTexture((g) => {
    g.fillStyle = "rgba(255,230,120,0.35)";
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = "#ffe98a";
    g.fillRect(3, 3, 10, 10);
    g.fillStyle = "#fff8d2";
    g.fillRect(5, 5, 6, 6);
  });
}

/** 方形月亮：灰白底与几个陨石坑 */
function moonTexture() {
  return pixelTexture((g) => {
    g.fillStyle = "rgba(200,210,255,0.18)";
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = "#dfe3ee";
    g.fillRect(4, 4, 8, 8);
    g.fillStyle = "#b8bdcc";
    g.fillRect(5, 5, 2, 2);
    g.fillRect(9, 8, 2, 2);
    g.fillRect(6, 10, 1, 1);
  });
}

export class Environment {
  readonly group = new THREE.Group();
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  readonly sun: THREE.DirectionalLight;
  private settings: EnvSettings = DEFAULT_ENV;
  private startMs = performance.now();
  private sunMesh: THREE.Mesh;
  private moonMesh: THREE.Mesh;
  private stars: THREE.Points;
  private clouds: THREE.InstancedMesh;
  private cloudMat: THREE.MeshBasicMaterial;
  private cloudOffset = 0;
  private rain: THREE.LineSegments;
  private snow: THREE.Points;
  private sceneryGroup = new THREE.Group();
  private sceneryMats: THREE.MeshBasicMaterial[] = [];
  private lightMats: THREE.MeshBasicMaterial[] = [];
  private sceneryKey = "";
  private skyCol = new THREE.Color();
  private reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  /** 灵感池待处理数量（天气跟随灵感池时使用） */
  private pending = 0;
  /** 夜读地毯：临时把光线换成深夜（不改设置） */
  private nightOverride = false;
  private flashT = 0;
  private nextFlash = 4;

  /** 当前状态（界面显示用） */
  hour = 12;
  weather: Weather = "clear";
  /** 0 夜 – 1 昼，已计入天气 */
  light = 1;

  /** 屋子主题：室外光照进屋的比例、室内底光、默认窗景 */
  private daylightScale = 1;
  private indoorAmbient = 0;
  presetScenery: string = "forest";

  constructor(
    private scene: THREE.Scene,
    public outdoor: THREE.Object3D,
  ) {
    this.hemi = new THREE.HemisphereLight(0xdcecff, 0x6b5440, 1.35);
    this.ambient = new THREE.AmbientLight(0xfff0dc, 0.35);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
    this.sun.target.position.set(ROOM.w / 2, 0, ROOM.d / 2);
    scene.add(this.hemi, this.ambient, this.sun, this.sun.target, this.group);
    scene.background = this.skyCol;
    scene.fog = new THREE.Fog(0xb9d6ef, 40, 120);

    const sky = (tex: THREE.Texture) =>
      new THREE.Mesh(new THREE.PlaneGeometry(22, 22), new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, depthWrite: false }));
    this.sunMesh = sky(sunTexture());
    this.moonMesh = sky(moonTexture());
    this.group.add(this.sunMesh, this.moonMesh);

    // 星星：上半球随机点
    const pos: number[] = [];
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i++) {
      const th = r() * Math.PI * 2;
      const ph = Math.acos(r() * 0.95);
      pos.push(Math.sin(ph) * Math.cos(th) * SKY_RADIUS, Math.cos(ph) * SKY_RADIUS * 0.9 + 5, Math.sin(ph) * Math.sin(th) * SKY_RADIUS);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
    this.group.add(this.stars);

    // 方块云：在 160×160 的范围里按噪声挑格子
    const cloudCells: [number, number][] = [];
    for (let gx = -10; gx < 10; gx++)
      for (let gz = -10; gz < 10; gz++) {
        const n = Math.sin(gx * 1.7 + gz * 0.9) + Math.cos(gx * 0.6 - gz * 1.3) + Math.sin((gx + gz) * 0.45);
        if (n > 0.9) cloudCells.push([gx, gz]);
      }
    this.cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.82, fog: false, depthWrite: false });
    this.clouds = new THREE.InstancedMesh(new THREE.BoxGeometry(8, 2, 8), this.cloudMat, cloudCells.length);
    const m = new THREE.Matrix4();
    cloudCells.forEach(([gx, gz], i) => this.clouds.setMatrixAt(i, m.makeTranslation(gx * 8, 0, gz * 8)));
    this.clouds.position.set(ROOM.w / 2, 44, ROOM.d / 2);
    this.group.add(this.clouds);

    // 雨：竖直短线
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(RAIN_COUNT * 6), 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x9fb6d8, transparent: true, opacity: 0.55 }));
    this.rain.frustumCulled = false;
    for (let i = 0; i < RAIN_COUNT; i++) this.respawn(rg.attributes.position as THREE.BufferAttribute, i, true, true);
    // 雪：方形白点
    const snowG = new THREE.BufferGeometry();
    snowG.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(SNOW_COUNT * 3), 3));
    this.snow = new THREE.Points(snowG, new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, transparent: true, opacity: 0.9 }));
    this.snow.frustumCulled = false;
    for (let i = 0; i < SNOW_COUNT; i++) this.respawn(snowG.attributes.position as THREE.BufferAttribute, i, false, true);
    this.group.add(this.rain, this.snow);

    this.group.add(this.sceneryGroup);
    this.apply(true);
  }

  /** 在房间外随机放一个雨滴 / 雪花（房间里不下雨） */
  private respawn(attr: THREE.BufferAttribute, i: number, line: boolean, anyHeight: boolean) {
    let x = 0,
      z = 0;
    do {
      x = ROOM.w / 2 + (Math.random() - 0.5) * 48;
      z = ROOM.d / 2 + (Math.random() - 0.5) * 48;
    } while (x > -1.5 && x < ROOM.w + 1.5 && z > -1.5 && z < ROOM.d + 1.5);
    const y = anyHeight ? Math.random() * 24 : 22 + Math.random() * 4;
    if (line) {
      attr.setXYZ(i * 2, x, y, z);
      attr.setXYZ(i * 2 + 1, x, y - 0.6, z);
    } else attr.setXYZ(i, x, y, z);
  }

  /** 闪电（雷声由声音模块在稍后播放） */
  onLightning?: () => void;

  /** 0 在屋里 – 1 在屋外：屋外不受屋子采光的影响 */
  private outside = 0;

  /** 屋里实际的亮度（地下书库白天也是暗的）；在屋外就是天光 */
  get roomLight() {
    return Math.min(1, this.light * this.dayScale + this.ambientNow);
  }

  private get dayScale() {
    return this.daylightScale + (1 - this.daylightScale) * this.outside;
  }

  private get ambientNow() {
    return this.indoorAmbient * (1 - this.outside);
  }

  setOutside(k: number) {
    this.outside = Math.max(0, Math.min(1, k));
    this.apply(true);
  }

  setOutdoor(o: THREE.Object3D) {
    this.outdoor = o;
    this.sceneryKey = "";
    this.refreshScenery();
  }

  setIndoor(daylight: number, ambient: number, scenery: string) {
    this.daylightScale = daylight;
    this.indoorAmbient = ambient;
    const changed = scenery !== this.presetScenery;
    this.presetScenery = scenery;
    if (changed) this.refreshScenery();
    this.apply(true);
  }

  private realWeather: Weather | null = null;

  /** 现实天气（跟随现实时使用） */
  setRealWeather(w: Weather | null) {
    if (w === this.realWeather) return;
    this.realWeather = w;
    this.apply(true);
  }

  setPending(n: number) {
    if (n === this.pending) return;
    this.pending = n;
    this.apply(true);
  }

  setNightOverride(on: boolean) {
    if (on === this.nightOverride) return;
    this.nightOverride = on;
    this.apply(true);
  }

  get isNightOverride() {
    return this.nightOverride;
  }

  setSettings(s: EnvSettings) {
    if (s.timeMode !== this.settings.timeMode || s.cycleMinutes !== this.settings.cycleMinutes) this.startMs = performance.now();
    this.settings = s;
    this.refreshScenery();
    this.apply(true);
  }

  /** 远景：四周很远处围一圈画（天空透明），夜里叠一层灯光；近处是立体地形，雾和一层"远景霾"把两者接起来 */
  private refreshScenery() {
    const sources = resolveScenery(this.settings, this.presetScenery as SceneryPreset, presetArt);
    const key = JSON.stringify(BACKDROPS.map((sd) => sources[sd] && [hashString(sources[sd]!.url), sources[sd]!.url.length, sources[sd]!.slice]));
    if (key === this.sceneryKey) return;
    this.sceneryKey = key;
    for (const o of [...this.sceneryGroup.children]) {
      const m = o as THREE.Mesh;
      this.sceneryGroup.remove(m);
      m.geometry.dispose();
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    this.sceneryMats = [];
    this.lightMats = [];
    this.hazeUniforms = [];
    const R = BACKDROP_DISTANCE;
    const W = R * 2;
    const cx = ROOM.w / 2,
      cz = ROOM.d / 2;
    const placement: Record<Backdrop, [number, number, number]> = {
      west: [cx - R, cz, Math.PI / 2],
      north: [cx, cz - R, 0],
      east: [cx + R, cz, -Math.PI / 2],
      south: [cx, cz + R, Math.PI],
    };
    const loader = new THREE.TextureLoader();
    const setup = (tex: THREE.Texture, slice: number | null) => {
      tex.magFilter = THREE.NearestFilter;
      // 远处缩小时用 mipmap，避免像素闪烁
      tex.minFilter = THREE.NearestMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.colorSpace = THREE.SRGBColorSpace;
      if (slice !== null) {
        tex.repeat.set(1 / SLICES, 1);
        tex.offset.set(slice / SLICES, 0);
      }
      return tex;
    };
    for (const side of BACKDROPS) {
      const src = sources[side];
      if (!src) continue;
      const [x, z, ry] = placement[side];
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), null as unknown as THREE.Material);
      // 按图片比例定高度：下面约五分之一埋在地平线以下
      const fit = (img: { width: number; height: number } | undefined) => {
        const aspect = img && img.width ? img.height / (img.width / (src.slice !== null ? SLICES : 1)) : 9 / 16;
        const H = Math.max(60, Math.min(140, W * aspect));
        plane.scale.set(W, H, 1);
        plane.position.set(x, H * 0.3 - 2, z);
        for (const c of plane.children) c.position.set(0, 0, 0.002);
      };
      const tex = loader.load(src.url, (t) => {
        fit(t.image as HTMLImageElement);
        this.apply(true);
      });
      const mat = this.hazeMaterial({ map: setup(tex, src.slice), fog: false, transparent: true, alphaTest: 0.5, depthWrite: true });
      plane.material = mat;
      plane.rotation.y = ry;
      fit(undefined);
      plane.renderOrder = -1;
      this.sceneryGroup.add(plane);
      this.sceneryMats.push(mat);
      // 夜灯层：内置远景自带；用户图片从画面里挑暗处生成
      const lightsTex = src.lights ? Promise.resolve(loader.load(src.lights)) : this.lightsFromImage(src.url);
      void lightsTex.then((lt) => {
        if (!lt || this.sceneryKey !== key) return;
        const lm = new THREE.MeshBasicMaterial({ map: setup(lt, src.slice), fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
        const lp = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), lm);
        lp.position.set(0, 0, 0.002);
        plane.add(lp);
        this.lightMats.push(lm);
        this.apply(true);
      });
    }
    this.apply(true);
  }

  /** 远景霾：把远景画往天空颜色里混一些，看起来更远（像方块游戏的远处） */
  private hazeColor = new THREE.Color();
  private hazeUniforms: { value: number }[] = [];
  private hazeMaterial(params: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial(params);
    const amt = { value: 0.3 };
    this.hazeUniforms.push(amt);
    m.onBeforeCompile = (shader) => {
      shader.uniforms.hazeColor = { value: this.hazeColor };
      shader.uniforms.hazeAmt = amt;
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "uniform vec3 hazeColor;\nuniform float hazeAmt;\nvoid main() {")
        .replace("#include <opaque_fragment>", "outgoingLight = mix(outgoingLight, hazeColor, hazeAmt);\n#include <opaque_fragment>");
    };
    return m;
  }

  private lightsFromImage(url: string): Promise<THREE.Texture | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext("2d")!;
          g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height);
          d.data.set(lightsFor(d.data, c.width, c.height));
          g.putImageData(d, 0, 0);
          resolve(new THREE.CanvasTexture(c));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  /** 每帧更新：时间、颜色、光照、云和雨雪 */
  update(dt: number) {
    this.apply(false);
    // 雷雨：偶尔一道闪电（减少动态效果时不闪）
    if (this.weather === "storm" && !this.reduceMotion) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.flashT = 0.16;
        this.onLightning?.();
        this.nextFlash = 5 + Math.random() * 9;
      }
      if (this.flashT > 0) {
        this.flashT -= dt;
        const k = this.flashT > 0.08 ? 1 : 0.45;
        if (this.flashT <= 0) this.apply(true);
        else {
          this.skyCol.setRGB(0.55 + 0.4 * k, 0.58 + 0.4 * k, 0.7 + 0.3 * k, THREE.SRGBColorSpace);
          this.hemi.intensity = 0.6 + 1.6 * k;
        }
      }
    }
    if (!this.reduceMotion) {
      this.cloudOffset = (this.cloudOffset + dt * 0.6) % 160;
      this.clouds.position.x = ROOM.w / 2 + this.cloudOffset - 80;
    }
    if (this.rain.visible) {
      const a = this.rain.geometry.attributes.position as THREE.BufferAttribute;
      const fall = dt * (this.weather === "storm" ? 30 : 22);
      for (let i = 0; i < RAIN_COUNT; i++) {
        const y = a.getY(i * 2) - fall;
        if (y < 0) this.respawn(a, i, true, false);
        else {
          a.setY(i * 2, y);
          a.setY(i * 2 + 1, y - 0.6);
        }
      }
      a.needsUpdate = true;
    }
    if (this.snow.visible) {
      const a = this.snow.geometry.attributes.position as THREE.BufferAttribute;
      const t = performance.now() / 1000;
      for (let i = 0; i < SNOW_COUNT; i++) {
        const y = a.getY(i) - dt * 1.6;
        if (y < 0) this.respawn(a, i, false, false);
        else {
          a.setY(i, y);
          a.setX(i, a.getX(i) + Math.sin(t + i) * dt * 0.3);
        }
      }
      a.needsUpdate = true;
    }
  }

  private lastApply = 0;

  /** 根据时间和天气设置颜色与光照（每 0.5 秒一次即可） */
  private apply(force: boolean) {
    const now = performance.now();
    if (!force && now - this.lastApply < 500) return;
    this.lastApply = now;
    const s = this.settings;
    this.hour = this.nightOverride ? 22.5 : hourOf(s, new Date(), now - this.startMs);
    this.weather = currentWeather(s, new Date(), this.pending, this.realWeather);
    const day = daylight(this.hour);
    const dim = weatherDim(this.weather);
    this.light = day * dim;

    const sky = skyColor(this.hour, this.weather);
    this.skyCol.setRGB(sky[0] / 255, sky[1] / 255, sky[2] / 255, THREE.SRGBColorSpace);
    (this.scene.fog as THREE.Fog).color.copy(this.skyCol);
    const wet = this.weather === "rain" || this.weather === "snow" || this.weather === "storm";
    // 近处清楚，地形外缘淡进天空
    (this.scene.fog as THREE.Fog).near = wet ? 14 : 30;
    (this.scene.fog as THREE.Fog).far = wet ? 70 : 105;

    const dir = sunDirection(this.hour);
    const c = new THREE.Vector3(ROOM.w / 2, 0, ROOM.d / 2);
    this.sun.position.set(c.x + dir.x * 40, Math.max(2, dir.y * 40), c.z + dir.z * 40);
    const sc = sunColor(this.hour);
    this.sun.color.setRGB(sc[0] / 255, sc[1] / 255, sc[2] / 255, THREE.SRGBColorSpace);
    const k = this.dayScale;
    this.sun.intensity = 1.7 * this.light * k;
    this.hemi.intensity = (0.14 + 1.26 * this.light) * Math.min(1, k) + this.ambientNow * 0.6;
    this.hemi.color.copy(this.skyCol).lerp(new THREE.Color(0xdcecff), 0.5);
    this.ambient.intensity = (0.16 + 0.24 * this.light) * Math.min(1, k) + this.ambientNow;

    this.sunMesh.position.set(c.x + dir.x * SKY_RADIUS, dir.y * SKY_RADIUS, c.z + dir.z * SKY_RADIUS);
    this.moonMesh.position.set(c.x - dir.x * SKY_RADIUS, -dir.y * SKY_RADIUS, c.z - dir.z * SKY_RADIUS);
    this.sunMesh.lookAt(c);
    this.moonMesh.lookAt(c);
    const clearSky = this.weather === "clear" ? 1 : this.weather === "cloudy" ? 0.5 : 0.1;
    (this.sunMesh.material as THREE.MeshBasicMaterial).opacity = clearSky;
    (this.moonMesh.material as THREE.MeshBasicMaterial).opacity = clearSky;
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - day * 1.6) * clearSky;
    this.stars.visible = day < 0.6;

    this.cloudMat.color.setRGB(0.35 + 0.65 * this.light, 0.35 + 0.65 * this.light, 0.4 + 0.6 * this.light);
    if (wet) this.cloudMat.color.multiplyScalar(0.75);
    this.clouds.count = this.weather === "clear" ? Math.floor(this.clouds.instanceMatrix.count * 0.45) : this.clouds.instanceMatrix.count;
    this.rain.visible = this.weather === "rain" || this.weather === "storm";
    (this.rain.material as THREE.LineBasicMaterial).opacity = this.weather === "storm" ? 0.75 : 0.55;
    this.snow.visible = this.weather === "snow";

    this.hazeColor.copy(this.skyCol);
    const hz = wet ? 0.55 : 0.32;
    for (const u of this.hazeUniforms) u.value = hz;
    if (this.sceneryMats.length) {
      const k = 0.22 + 0.78 * this.light;
      const warm = sunColor(this.hour);
      for (const m of this.sceneryMats) m.color.setRGB((k * warm[0]) / 255, (k * warm[1]) / 255, (k * (warm[2] + 30)) / 285);
      const night = Math.max(0, 1 - daylight(this.hour) * 1.4);
      for (const m of this.lightMats) m.opacity = night;
    }
  }
}
