// 昼夜与天气的纯计算（不依赖 Three.js，可单独测试）。
import { pendingWeather } from "../study/inbox";
import type { SceneryPreset } from "./themes";

// 一天 24 小时：6 点日出、12 点正午、18 点日落、0 点午夜。

export type TimeMode = "real" | "cycle" | "fixed";
export type Weather = "clear" | "cloudy" | "rain" | "snow" | "storm";
/** auto：按时段自动变化；inbox：跟随灵感池里待处理的数量 */
export type WeatherSetting = "clear" | "cloudy" | "rain" | "snow" | "auto" | "inbox" | "real";

export interface EnvSettings {
  timeMode: TimeMode;
  /** fixed 模式的小时（0–24） */
  fixedHour: number;
  /** cycle 模式：现实多少分钟走完一天（方块游戏是 20 分钟） */
  cycleMinutes: number;
  weather: WeatherSetting;
  /** 像素化后的窗景（PNG data URL），为空时用默认风景 */
  scenery: string | null;
  /** 跟随灵感池时：待处理达到多少条转为下雨 */
  inboxThreshold: number;
  /** 宽图切成三段铺满三扇窗（西 | 北 | 东） */
  sceneryPanorama: boolean;
  /** 单独给某扇窗的窗景（优先于 scenery） */
  scenerySides: Partial<Record<"north" | "east" | "west", string>>;
  /** 内置窗景；null 为跟随屋子主题 */
  sceneryPreset: SceneryPreset | null;
  /** 天气跟随现实时的地点 */
  realPlace: RealPlace | null;
}

export interface RealPlace {
  name: string;
  lat: number;
  lon: number;
}

export const DEFAULT_ENV: EnvSettings = {
  timeMode: "real",
  fixedHour: 10,
  cycleMinutes: 20,
  weather: "auto",
  scenery: null,
  inboxThreshold: 8,
  sceneryPanorama: false,
  scenerySides: {},
  sceneryPreset: null,
  realPlace: null,
};

export function parseEnv(raw: unknown): EnvSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<EnvSettings>;
  const timeMode: TimeMode = r.timeMode === "cycle" || r.timeMode === "fixed" ? r.timeMode : "real";
  const weather: WeatherSetting = ["clear", "cloudy", "rain", "snow", "auto", "inbox", "real"].includes(r.weather as string) ? (r.weather as WeatherSetting) : "auto";
  const fixedHour = typeof r.fixedHour === "number" && r.fixedHour >= 0 && r.fixedHour <= 24 ? r.fixedHour : DEFAULT_ENV.fixedHour;
  const cycleMinutes = typeof r.cycleMinutes === "number" && r.cycleMinutes >= 2 && r.cycleMinutes <= 240 ? r.cycleMinutes : DEFAULT_ENV.cycleMinutes;
  const scenery = typeof r.scenery === "string" && r.scenery.startsWith("data:image/") ? r.scenery : null;
  const inboxThreshold =
    typeof r.inboxThreshold === "number" && r.inboxThreshold >= 2 && r.inboxThreshold <= 100 ? Math.round(r.inboxThreshold) : DEFAULT_ENV.inboxThreshold;
  const sides: EnvSettings["scenerySides"] = {};
  const rs = (r.scenerySides ?? {}) as Record<string, unknown>;
  for (const k of ["north", "east", "west"] as const) if (typeof rs[k] === "string" && (rs[k] as string).startsWith("data:image/")) sides[k] = rs[k] as string;
  const presets: SceneryPreset[] = ["forest", "sea", "mountains", "bamboo", "fields", "city"];
  const sceneryPreset = presets.includes(r.sceneryPreset as SceneryPreset) ? (r.sceneryPreset as SceneryPreset) : null;
  const rp = r.realPlace as RealPlace | null | undefined;
  const realPlace =
    rp && typeof rp.name === "string" && Number.isFinite(rp.lat) && Number.isFinite(rp.lon) && Math.abs(rp.lat) <= 90 && Math.abs(rp.lon) <= 180
      ? { name: rp.name, lat: rp.lat, lon: rp.lon }
      : null;
  return {
    timeMode,
    fixedHour,
    cycleMinutes,
    weather,
    scenery,
    inboxThreshold,
    sceneryPanorama: r.sceneryPanorama === true,
    scenerySides: sides,
    sceneryPreset,
    realPlace,
  };
}

/** 当前小时（0–24，含小数） */
export function hourOf(s: EnvSettings, now: Date, sinceStartMs: number): number {
  if (s.timeMode === "fixed") return s.fixedHour % 24;
  if (s.timeMode === "cycle") {
    // 从现实时间出发，按加速比例推进
    const start = now.getHours() + now.getMinutes() / 60;
    const speed = (24 * 60) / s.cycleMinutes; // 每现实分钟走多少游戏分钟
    return (start + (sinceStartMs / 60000) * (speed / 60)) % 24;
  }
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}

/** 太阳方向（单位向量）：东边升起（+x）、西边落下（-x），略微偏南 */
export function sunDirection(hour: number): { x: number; y: number; z: number } {
  const t = ((hour - 6) / 24) * Math.PI * 2;
  const x = Math.cos(t);
  const y = Math.sin(t);
  const z = 0.35;
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 日光强度 0（夜）–1（白天） */
export function daylight(hour: number): number {
  return smooth(-0.12, 0.22, sunDirection(hour).y);
}

/** 天气对光照的削弱 */
export function weatherDim(w: Weather): number {
  return { clear: 1, cloudy: 0.8, rain: 0.6, snow: 0.78, storm: 0.42 }[w];
}

type RGB = [number, number, number];

/** 天空颜色关键帧（小时 → 颜色） */
const SKY_KEYS: [number, RGB][] = [
  [0, [10, 14, 34]],
  [4.6, [14, 20, 46]],
  [5.6, [74, 66, 112]],
  [6.3, [240, 160, 100]],
  [7.3, [150, 196, 238]],
  [12, [126, 186, 250]],
  [16.8, [150, 196, 238]],
  [17.7, [240, 140, 84]],
  [18.5, [96, 64, 112]],
  [19.4, [18, 22, 52]],
  [24, [10, 14, 34]],
];

export function lerpColor(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** 天空颜色（0–255），雨雪天变灰 */
export function skyColor(hour: number, w: Weather): RGB {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1][0] <= h) i++;
  const [h0, c0] = SKY_KEYS[i];
  const [h1, c1] = SKY_KEYS[i + 1];
  let c = lerpColor(c0, c1, (h - h0) / (h1 - h0));
  if (w !== "clear") {
    const gray = (c[0] + c[1] + c[2]) / 3;
    const amount = { cloudy: 0.35, rain: 0.7, snow: 0.55, storm: 0.88 }[w];
    const target: RGB =
      w === "snow"
        ? [gray * 1.05 + 10, gray * 1.05 + 10, gray * 1.1 + 14]
        : w === "storm"
          ? [gray * 0.55, gray * 0.58, gray * 0.68]
          : [gray * 0.85, gray * 0.88, gray * 0.95];
    c = lerpColor(c, target, amount);
  }
  return c.map((v) => Math.max(0, Math.min(255, Math.round(v)))) as RGB;
}

/** 日出日落时阳光偏暖 */
export function sunColor(hour: number): RGB {
  const y = sunDirection(hour).y;
  const warm = 1 - smooth(0.05, 0.45, y);
  return lerpColor([255, 244, 222], [255, 160, 90], warm);
}

/** 简单哈希随机（0–1） */
function rand(seed: number): number {
  let x = seed | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * 自动天气：每 3 小时一段，按日期确定（同一时段每次打开都一样）。
 * 冬季（12–2 月）下雪，其他月份下雨。
 */
export function autoWeather(now: Date): Weather {
  const day = Math.floor(now.getTime() / 86400000);
  const block = Math.floor(now.getHours() / 3);
  const r = rand(day * 8 + block + 17);
  const winter = isWinter(now);
  if (r < 0.55) return "clear";
  if (r < 0.8) return "cloudy";
  return winter ? "snow" : "rain";
}

export function isWinter(now: Date): boolean {
  return [11, 0, 1].includes(now.getMonth());
}

/** pending：灵感池待处理数量（只在跟随灵感池时使用） */
export function currentWeather(s: EnvSettings, now: Date, pending = 0, real: Weather | null = null): Weather {
  if (s.weather === "auto") return autoWeather(now);
  // 跟随现实：还没拿到数据（离线、刚启动）时先按自动天气
  if (s.weather === "real") return real ?? autoWeather(now);
  if (s.weather === "inbox") return pendingWeather(pending, s.inboxThreshold, isWinter(now));
  return s.weather;
}

export const WEATHER_NAMES: Record<WeatherSetting | Weather, string> = {
  auto: "自动",
  inbox: "跟随灵感池",
  real: "跟随现实",
  storm: "雷雨",
  clear: "晴",
  cloudy: "多云",
  rain: "雨",
  snow: "雪",
};

export function formatHour(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
