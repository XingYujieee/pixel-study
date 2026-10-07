import { describe, expect, it } from "vitest";
import { compose, gapSeconds, midiToHz, STYLE_NAMES, type Style } from "./compose";

describe("背景音乐作曲", () => {
  it("同一个种子结果相同；音在合理范围；结尾落在主音", () => {
    const a = compose(42, "day");
    expect(compose(42, "day")).toEqual(a);
    expect(compose(43, "day")).not.toEqual(a);
    expect(a.notes.length).toBeGreaterThan(20);
    for (const n of a.notes) {
      expect(n.pitch).toBeGreaterThanOrEqual(24);
      expect(n.pitch).toBeLessThanOrEqual(100);
      expect(n.at).toBeGreaterThanOrEqual(0);
      expect(n.at + n.dur).toBeLessThanOrEqual(a.beats + 0.01);
      expect(n.vel).toBeGreaterThan(0);
      expect(n.vel).toBeLessThanOrEqual(1);
    }
    // 最后一个旋律音是主音
    const lastBar = (a.beats - a.meter / 2) - a.meter;
    const finals = a.notes.filter((n) => n.at === lastBar);
    const tonicPc = finals.reduce((m, n) => (n.pitch < m.pitch ? n : m)).pitch % 12;
    expect(finals.some((n) => n.pitch % 12 === tonicPc)).toBe(true);
    expect(a.title).toContain(STYLE_NAMES[a.style]);
  });

  it("六种风格都能写出来，各用各的乐器；圆舞曲是三拍子", () => {
    const styles: Style[] = ["piano", "musicbox", "ambient", "waltz", "lofi", "folk"];
    const seen = new Set<string>();
    for (const st of styles) {
      const p = compose(11, "day", st);
      expect(p.style).toBe(st);
      for (const n of p.notes) seen.add(n.inst);
      if (st === "waltz") expect(p.meter).toBe(3);
    }
    for (const inst of ["piano", "musicbox", "pad", "harp", "flute", "epiano", "bass", "guitar", "ocarina"]) expect(seen.has(inst)).toBe(true);
  });

  it("随机挑风格时白天和夜里都有好几种", () => {
    const day = new Set<string>();
    const night = new Set<string>();
    for (let s = 1; s < 80; s++) {
      day.add(compose(s, "day").style);
      night.add(compose(s, "night").style);
    }
    expect(day.size).toBeGreaterThanOrEqual(4);
    expect(night.size).toBeGreaterThanOrEqual(3);
  });

  it("每首半分钟到两分钟", () => {
    for (let s = 1; s < 60; s++) {
      const p = compose(s, s % 2 ? "day" : "night");
      const sec = (p.beats * 60) / p.tempo;
      expect(sec).toBeGreaterThan(25);
      expect(sec).toBeLessThan(120);
    }
  });

  it("间隔与音高换算", () => {
    expect(midiToHz(69)).toBe(440);
    expect(gapSeconds("rare", () => 0)).toBe(150);
    expect(gapSeconds("always", () => 1)).toBe(16);
  });
});
