import { describe, expect, it } from "vitest";
import { downsample, medianCut, pixelate } from "./pixelate";
import { autoWeather, daylight, DEFAULT_ENV, formatHour, hourOf, parseEnv, skyColor, sunDirection } from "./sky";

describe("昼夜", () => {
  it("太阳东升西落，正午最高，午夜在地平线下", () => {
    expect(sunDirection(6).y).toBeCloseTo(0, 5);
    expect(sunDirection(12).y).toBeGreaterThan(0.9);
    expect(sunDirection(0).y).toBeLessThan(-0.9);
    expect(sunDirection(8).x).toBeGreaterThan(0);
    expect(sunDirection(16).x).toBeLessThan(0);
  });

  it("日光：正午 1，午夜 0，黄昏介于两者", () => {
    expect(daylight(12)).toBeCloseTo(1);
    expect(daylight(0)).toBe(0);
    const dusk = daylight(18.2);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
  });

  it("天空颜色：白天蓝、夜里暗、雨天偏灰", () => {
    const noon = skyColor(12, "clear");
    expect(noon[2]).toBeGreaterThan(noon[0]);
    const night = skyColor(1, "clear");
    expect(night[0] + night[1] + night[2]).toBeLessThan(120);
    const rain = skyColor(12, "rain");
    expect(Math.abs(rain[0] - rain[2])).toBeLessThan(Math.abs(noon[0] - noon[2]));
  });

  it("时间模式", () => {
    const now = new Date(2026, 9, 4, 14, 30);
    expect(hourOf({ ...DEFAULT_ENV, timeMode: "real" }, now, 0)).toBeCloseTo(14.5);
    expect(hourOf({ ...DEFAULT_ENV, timeMode: "fixed", fixedHour: 21 }, now, 99999)).toBe(21);
    // 20 分钟一天：过了 10 分钟就是半天
    expect(hourOf({ ...DEFAULT_ENV, timeMode: "cycle" }, now, 10 * 60000)).toBeCloseTo(2.5);
    expect(formatHour(9.75)).toBe("09:45");
  });

  it("自动天气：同一时段结果稳定，冬天下雪不下雨", () => {
    const a = autoWeather(new Date(2026, 9, 4, 10));
    expect(autoWeather(new Date(2026, 9, 4, 11))).toBe(a);
    for (let d = 1; d < 60; d++) {
      expect(autoWeather(new Date(2026, 0, d, 12))).not.toBe("rain");
      expect(autoWeather(new Date(2026, 6, d, 12))).not.toBe("snow");
    }
  });

  it("解析设置：非法值回到默认", () => {
    expect(parseEnv({ timeMode: "bogus", weather: "storm", fixedHour: 99, scenery: "javascript:x" })).toEqual(DEFAULT_ENV);
    expect(parseEnv({ timeMode: "fixed", fixedHour: 20, weather: "snow" })).toMatchObject({ timeMode: "fixed", fixedHour: 20, weather: "snow" });
  });
});

describe("像素化", () => {
  it("区域平均缩小", () => {
    // 2×2 → 1×1：平均值
    const src = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255]);
    expect(Array.from(downsample(src, 2, 2, 1, 1))).toEqual([128, 64, 128, 255]);
  });

  it("中位切分得到指定数量的颜色", () => {
    const data = new Uint8ClampedArray(64 * 4);
    for (let i = 0; i < 64; i++) data.set([i * 4, 255 - i * 4, (i * 37) % 256, 255], i * 4);
    expect(medianCut(data, 8)).toHaveLength(8);
    // 单色图不会切出重复颜色
    expect(medianCut(new Uint8ClampedArray([9, 9, 9, 255, 9, 9, 9, 255]), 8)).toEqual([[9, 9, 9]]);
  });

  it("输出尺寸按比例，颜色不超过调色板", () => {
    const sw = 200,
      sh = 100;
    const src = new Uint8ClampedArray(sw * sh * 4);
    for (let i = 0; i < sw * sh; i++) src.set([(i % sw) % 256, (i / sw) * 2, 120, 255], i * 4);
    const art = pixelate(src, sw, sh, 64, 12);
    expect(art.width).toBe(64);
    expect(art.height).toBe(32);
    const colors = new Set<string>();
    for (let i = 0; i < art.data.length; i += 4) colors.add(`${art.data[i]},${art.data[i + 1]},${art.data[i + 2]}`);
    expect(colors.size).toBeLessThanOrEqual(12);
  });
});

describe("窗景抠天空", () => {
  it("只抠与上边缘相连的天空，山和湖保留", async () => {
    const { keySky } = await import("./pixelate");
    const w = 10;
    const h = 8;
    const d = new Uint8ClampedArray(w * h * 4);
    const put = (x: number, y: number, c: [number, number, number]) => d.set([...c, 255], (y * w + x) * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (y < 4) put(x, y, [122, 176, 232]); // 天空
        else if (y < 6) put(x, y, [70, 130, 60]); // 草地
        else put(x, y, [60, 110, 200]); // 湖（不与天空相连）
      }
    put(4, 1, [245, 245, 248]); // 云
    put(2, 3, [128, 132, 140]); // 山尖
    put(2, 2, [128, 132, 140]);
    const n = keySky(d, w, h);
    const a = (x: number, y: number) => d[(y * w + x) * 4 + 3];
    expect(a(0, 0)).toBe(0);
    expect(a(4, 1)).toBe(0);
    expect(a(2, 2)).toBe(255);
    expect(a(5, 4)).toBe(255);
    expect(a(5, 7)).toBe(255);
    expect(n).toBe(4 * w - 2);
  });
});

describe("远景来源", () => {
  it("单独设置 > 全部 > 内置；四面都有画，全景切四段，南面跟着换过的窗", async () => {
    const { resolveScenery } = await import("./scenerySources");
    const art = (p: string) => ({ url: `preset:${p}`, lights: `lights:${p}` });
    const base = { scenery: null, sceneryPanorama: false, scenerySides: {}, sceneryPreset: null };
    expect(resolveScenery(base, "forest", art).south).toEqual({ url: "preset:forest", slice: null, lights: "lights:forest" });
    expect(resolveScenery(base, "sea", art).north).toEqual({ url: "preset:sea", slice: null, lights: "lights:sea" });
    expect(resolveScenery({ ...base, sceneryPreset: "city" }, "sea", art).east?.url).toBe("preset:city");
    const pano = resolveScenery({ ...base, scenery: "img", sceneryPanorama: true, scenerySides: { east: "mine" } }, "sea", art);
    expect(pano.west).toEqual({ url: "img", slice: 0 });
    expect(pano.north).toEqual({ url: "img", slice: 1 });
    expect(pano.east).toEqual({ url: "mine", slice: null });
    expect(pano.south).toEqual({ url: "img", slice: 3 });
    const one = resolveScenery({ ...base, scenerySides: { east: "mine" } }, "forest", art);
    expect(one.north?.url).toBe("preset:forest");
    expect(one.south?.url).toBe("mine");
  });
});
