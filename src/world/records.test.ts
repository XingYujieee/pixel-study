import { describe, expect, it } from "vitest";
import type { Track } from "../ipc";
import { assignRecords, groupRecords, PER_SHELF } from "./records";
import { COVER_SIZE, coverPixels, motifFor } from "./cover";

const t = (id: string, extra: Partial<Track> = {}): Track => ({ id, name: id, file: `${id}.mp3`, size: 1, ...extra });

describe("唱片归组", () => {
  it("同专辑放进一张，按曲序排；没有专辑的单独一张", () => {
    const recs = groupRecords([
      t("1", { album: "夏日", artist: "甲", trackNo: 2, title: "第二首" }),
      t("2", { name: "雨声" }),
      t("3", { album: "夏日", artist: "甲", trackNo: 1, title: "第一首" }),
      t("4", { album: "夏日", artist: "乙", trackNo: 3 }),
    ]);
    expect(recs.map((r) => r.title)).toEqual(["夏日", "雨声"]);
    expect(recs[0].tracks.map((x) => x.id)).toEqual(["3", "1", "4"]);
    expect(recs[0].artist).toBe("群星");
    expect(recs[1].single).toBe(true);
    expect(recs[1].artist).toBe("");
  });

  it("按顺序分到唱片架，放不下的不显示", () => {
    const ids = Array.from({ length: PER_SHELF + 3 }, (_, i) => `r${i}`);
    const m = assignRecords(ids, ["A", "B"]);
    expect(m.get("r0")).toEqual(["A", 0]);
    expect(m.get(`r${PER_SHELF}`)).toEqual(["B", 0]);
    expect(assignRecords(ids, ["A"]).size).toBe(PER_SHELF);
  });
});

describe("像素封面", () => {
  it("名字里的词决定图案", () => {
    expect(motifFor("下雨天")).toBe("rain");
    expect(motifFor("Midnight City")).toBe("night");
    expect(motifFor("海边的卡夫卡")).toBe("sea");
    expect(motifFor("无题", "某某")).toBe("abstract");
  });

  it("同样的名字画出同一张，换种子会变", () => {
    const a = coverPixels("旅行的意义", "陈绮贞");
    const b = coverPixels("旅行的意义", "陈绮贞");
    const c = coverPixels("旅行的意义", "陈绮贞", 1);
    expect(a.px).toHaveLength(COVER_SIZE * COVER_SIZE);
    expect(a.px).toEqual(b.px);
    expect(a.px).not.toEqual(c.px);
    expect(a.motif).toBe(c.motif);
  });

  it("每种图案都能画出来，颜色不止一两种", () => {
    for (const name of ["雨", "夜", "星空", "大海", "夏天", "山", "森林", "雪", "花", "爱", "城市", "火", "猫", "钢琴", "咖啡", "Untitled"]) {
      const { px } = coverPixels(name);
      expect(px.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffffff)).toBe(true);
      expect(new Set(px).size).toBeGreaterThan(4);
    }
  });
});
