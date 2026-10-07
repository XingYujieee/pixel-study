import { describe, expect, it } from "vitest";
import { distToYard, exposedDepth, generateTerrain, insideFence, type TerrainStyle } from "./terrain";

const STYLES: TerrainStyle[] = ["forest", "meadow", "fields", "mountains", "sea", "bamboo", "city"];

describe("远景地形", () => {
  it("只在围栏外面，结果固定", () => {
    for (const st of STYLES) {
      const t = generateTerrain(st);
      expect(t.columns.length).toBeGreaterThan(5000);
      for (const c of t.columns) expect(insideFence(c.x, c.z)).toBe(false);
      for (const f of t.features) expect(insideFence(f.x, f.z)).toBe(false);
      expect(generateTerrain(st).columns.slice(0, 50)).toEqual(t.columns.slice(0, 50));
    }
  });

  it("围栏边上是平的（院子接得上），越远越有起伏", () => {
    for (const st of STYLES) {
      const t = generateTerrain(st);
      const near = t.columns.filter((c) => distToYard(c.x, c.z) < 1.5);
      for (const c of near) expect(Math.abs(c.h)).toBeLessThanOrEqual(1);
    }
    const m = generateTerrain("mountains");
    expect(Math.max(...m.columns.map((c) => c.h))).toBeGreaterThan(14);
    expect(m.columns.some((c) => c.top === "snow")).toBe(true);
  });

  it("每种地形有自己的东西", () => {
    const kinds = (st: TerrainStyle) => new Set(generateTerrain(st).features.map((f) => f.kind));
    expect(kinds("forest").has("oak")).toBe(true);
    expect(kinds("mountains").has("spruce")).toBe(true);
    expect(kinds("bamboo").has("bamboo")).toBe(true);
    expect(kinds("fields").has("crop")).toBe(true);
    expect(kinds("city").has("building")).toBe(true);
    expect(generateTerrain("sea").water).not.toBeNull();
    // 楼离院子有一段距离，不会贴着围栏
    for (const f of generateTerrain("city").features.filter((f) => f.kind === "building")) expect(distToYard(f.x, f.z)).toBeGreaterThanOrEqual(8);
  });

  it("被挡住的方块不画", () => {
    const t = generateTerrain("forest");
    const d = exposedDepth(t);
    let total = 0;
    for (const v of d.values()) {
      expect(v).toBeGreaterThanOrEqual(1);
      total += v;
    }
    expect(total).toBeLessThan(t.columns.length * 2.5);
  });
});
