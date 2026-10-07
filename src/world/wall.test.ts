import { describe, expect, it } from "vitest";
import { defaultLayout } from "./layout";
import { THEMES } from "./themes";
import { boardLines, canPlaceWall, parseWallItems, snapWall, wallTransform, type WallItem } from "./wall";

const layout = defaultLayout([]);
const ctx = (items: WallItem[] = [], theme = THEMES.study) => ({ windows: theme.windows, fireplace: theme.fireplace, items, furniture: layout.furniture });

describe("墙上的东西", () => {
  it("不压窗户、门、壁炉、其他挂件，不被高家具挡住", () => {
    // 南墙门左边的空墙
    expect(canPlaceWall({ side: "south", a: 3, y: 2.5, w: 2.4, h: 1.5 }, ctx())).toEqual({ ok: true });
    expect(canPlaceWall({ side: "south", a: 7, y: 2, w: 2.4, h: 1.5 }, ctx())).toMatchObject({ ok: false, reason: "会挡住门" });
    // 北窗 x 5–8、y 3–4
    expect(canPlaceWall({ side: "north", a: 7, y: 3.5, w: 1, h: 1 }, ctx())).toMatchObject({ reason: "会挡住窗户" });
    // 北墙书架高 3：挂在书架后面会被挡住，挂在书架上方可以
    expect(canPlaceWall({ side: "north", a: 2, y: 2, w: 1, h: 1 }, ctx())).toMatchObject({ reason: "被书架挡住" });
    expect(canPlaceWall({ side: "north", a: 2, y: 4.2, w: 1, h: 1 }, ctx())).toEqual({ ok: true });
    expect(canPlaceWall({ side: "north", a: 0.3, y: 4.2, w: 1, h: 1 }, ctx())).toMatchObject({ reason: "超出墙面" });
    const board: WallItem = { id: "b", type: "board", side: "south", a: 3, y: 2.5, w: 2.4, h: 1.5 };
    expect(canPlaceWall({ side: "south", a: 4, y: 2.5, w: 1, h: 1 }, ctx([board]))).toMatchObject({ reason: "与黑板重叠" });
    expect(canPlaceWall({ side: "south", a: 4, y: 2.5, w: 1, h: 1 }, { ...ctx([board]), ignoreId: "b" })).toEqual({ ok: true });
    // 木屋的壁炉在西墙
    expect(canPlaceWall({ side: "west", a: 5.5, y: 1.5, w: 1, h: 1 }, { ...ctx([], THEMES.cabin), furniture: [] })).toMatchObject({ reason: "会挡住壁炉" });
  });

  it("位置换算与吸附", () => {
    expect(wallTransform({ side: "east", a: 5, y: 2 })).toMatchObject({ x: 14 - 0.04, z: 5, ry: -Math.PI / 2 });
    expect(snapWall(2.37)).toBe(2.25);
    expect(parseWallItems([{ id: "x", type: "frame", side: "west", a: 3, y: 2, w: 1, h: 1, image: "a.png" }, { type: "tv" }, null])).toHaveLength(1);
  });

  it("黑板文字", () => {
    const lines = boardLines("---\ntags: [x]\n---\n# 本周\n\n- [ ] 写综述\n- [x] 读 Strubell\n- 普通 **加粗** [[链接]]\n> 引用");
    expect(lines).toEqual([
      { text: "本周", kind: "h" },
      { text: "写综述", kind: "todo" },
      { text: "读 Strubell", kind: "done" },
      { text: "普通 加粗 链接", kind: "li" },
      { text: "引用", kind: "p" },
    ]);
  });
});
