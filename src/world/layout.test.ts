import { describe, expect, it } from "vitest";
import type { FileEntry } from "../ipc";
import { DEFAULT_ENV } from "./sky";
import {
  applyFileEvents,
  applyPreset,
  carpetAt,
  makePreset,
  parsePresets,
  canPlace,
  cellsOf,
  defaultLayout,
  footprint,
  moveWithCollision,
  parseLayout,
  ROOM,
  shelfBooks,
  shelfSubfolders,
  solidCells,
  type Layout,
} from "./layout";

const e = (path: string): FileEntry => ({ path, name: path.split("/").pop()!, kind: "markdown", size: 1, mtime: 1 });
const files = [e("读书/a.md"), e("读书/b.md"), e("读书/小说/c.md"), e("工作/d.md"), e("根.md")];
const fileMap = new Map(files.map((f) => [f.path, f]));

describe("布局", () => {
  it("默认布局：每个顶层文件夹一个目录书架，外加收藏与根目录，互不重叠", () => {
    const l = defaultLayout(files);
    const shelves = l.furniture.filter((f) => f.type === "bookshelf");
    expect(shelves.map((s) => s.shelf!.name)).toEqual(["读书", "工作", "库根目录", "收藏"]);
    expect(l.furniture.filter((f) => f.type === "desk")).toHaveLength(1);
    // 逐个检查放置合法
    const check: Layout = { ...l, furniture: [] };
    for (const f of l.furniture) {
      expect(canPlace(check, f), f.type).toEqual({ ok: true });
      check.furniture.push(f);
    }
    // 玩家起点不在阻挡格
    const solid = solidCells(l);
    expect(solid.has(`${Math.floor(l.player.x)},${Math.floor(l.player.z)}`)).toBe(false);
  });

  it("旋转改变占地", () => {
    expect(footprint({ type: "bookshelf", rot: 0 })).toEqual({ w: 2, d: 1 });
    expect(footprint({ type: "bookshelf", rot: 1 })).toEqual({ w: 1, d: 2 });
    expect(cellsOf({ type: "desk", rot: 1, x: 3, z: 4 })).toEqual([
      [3, 4],
      [3, 5],
    ]);
  });

  it("放置检查：越界、重叠、地毯可与家具共存、不能放在脚下", () => {
    const l: Layout = { version: 1, furniture: [{ id: "a", type: "bookshelf", x: 2, z: 2, rot: 0 }], player: { x: 7, z: 7, yaw: 0, pitch: 0 }, env: DEFAULT_ENV };
    expect(canPlace(l, { type: "desk", x: ROOM.w - 1, z: 0, rot: 0 }).ok).toBe(false);
    expect(canPlace(l, { type: "chest", x: 3, z: 2, rot: 0 })).toEqual({ ok: false, reason: "与书架重叠" });
    expect(canPlace(l, { type: "carpet", x: 2, z: 1, rot: 0 }).ok).toBe(true);
    expect(canPlace(l, { type: "chest", x: 7, z: 7, rot: 0 }, undefined, { x: 7.5, z: 7.5 }).ok).toBe(false);
    // 移动自己时忽略自身
    expect(canPlace(l, { type: "bookshelf", x: 3, z: 2, rot: 0 }, "a").ok).toBe(true);
  });

  it("碰撞：不能穿墙、不能穿过家具，可以贴着滑动", () => {
    const solid = solidCells({ version: 1, furniture: [{ id: "a", type: "chest", x: 5, z: 5, rot: 0 }], player: { x: 0, z: 0, yaw: 0, pitch: 0 }, env: DEFAULT_ENV });
    // 撞墙
    const p1 = moveWithCollision(solid, { x: 0.5, z: 5.5 }, -1, 0);
    expect(p1.x).toBeGreaterThanOrEqual(0.3);
    // 撞箱子
    const p2 = moveWithCollision(solid, { x: 4.5, z: 5.5 }, 0.5, 0);
    expect(p2.x).toBeLessThanOrEqual(4.7);
    // 斜向贴墙滑动：x 被挡、z 继续
    const p3 = moveWithCollision(solid, { x: 0.31, z: 2 }, -0.2, 0.3);
    expect(p3.z).toBeCloseTo(2.3);
  });

  it("解析保存的布局：丢弃非法与重叠，玩家在墙内时复位", () => {
    const l = parseLayout({
      version: 1,
      furniture: [
        { id: "a", type: "bookshelf", x: 1, z: 0, rot: 0, shelf: { name: "x", mode: "virtual", refs: ["a.md", 3] } },
        { id: "b", type: "chest", x: 1, z: 0, rot: 0 },
        { id: "c", type: "dragon", x: 3, z: 3 },
        { id: "d", type: "desk", x: 99, z: 0, rot: 0 },
      ],
      player: { x: 1.5, z: 0.5, yaw: 1, pitch: 0 },
    })!;
    // 旧版本布局会补上 AI 工作台
    expect(l.furniture.map((f) => f.type)).toEqual(["bookshelf", "aibench", "pond", "jukebox"]);
    expect(l.env).toEqual(DEFAULT_ENV);
    expect(l.furniture[0].shelf!.refs).toEqual(["a.md"]);
    expect(l.player.z).toBeGreaterThan(5);
    expect(parseLayout(null)).toBeNull();
  });

  it("书架内容：文件夹书架包含子文件夹，虚拟书架跟随改名", () => {
    const folder = { name: "读书", mode: "folder" as const, refs: [], folder: "读书" };
    expect(shelfBooks(folder, fileMap).map((b) => b.path)).toEqual(["读书/a.md", "读书/b.md", "读书/小说/c.md"]);
    expect(shelfSubfolders(folder, fileMap)).toEqual(["读书/小说"]);
    const root = { name: "根", mode: "folder" as const, refs: [], folder: "" };
    expect(shelfBooks(root, fileMap)).toHaveLength(5);

    const l: Layout = {
      version: 1,
      furniture: [{ id: "s", type: "bookshelf", x: 0, z: 0, rot: 0, shelf: { name: "收藏", mode: "virtual", refs: ["读书/a.md", "丢失.md"], folder: "" } }],
      player: { x: 5, z: 5, yaw: 0, pitch: 0 },
      env: DEFAULT_ENV,
    };
    expect(applyFileEvents(l, [{ kind: "renamed", from: "读书/a.md", entry: e("读书/新名.md") }])).toBe(true);
    const books = shelfBooks(l.furniture[0].shelf!, fileMap);
    expect(books.map((b) => b.path)).toEqual(["读书/新名.md", "丢失.md"]);
    expect(books[1].entry).toBeNull();
  });
});

describe("鱼塘、地毯氛围、布局预设", () => {
  it("默认布局有鱼塘；旧布局升级时补上鱼塘", () => {
    const l = defaultLayout(files);
    expect(l.furniture.filter((f) => f.type === "pond")).toHaveLength(1);
    const old = { ...l, version: 2, furniture: l.furniture.filter((f) => f.type !== "pond") };
    const up = parseLayout(JSON.parse(JSON.stringify(old)))!;
    const pond = up.furniture.find((f) => f.type === "pond");
    expect(pond).toBeTruthy();
    // 已是新版本的布局不会被再加一个
    const again = parseLayout({ ...up, furniture: up.furniture.filter((f) => f.type !== "pond") })!;
    expect(again.furniture.some((f) => f.type === "pond")).toBe(false);
  });

  it("地毯氛围保存与读取，非法值丢弃；脚下地毯", () => {
    const l = defaultLayout(files);
    const c = l.furniture.find((f) => f.type === "carpet")!;
    c.ambience = "rain";
    const back = parseLayout(JSON.parse(JSON.stringify({ ...l, furniture: [...l.furniture, { ...c, id: "bad", x: 2, z: 5, ambience: "disco" }] })))!;
    expect(back.furniture.find((f) => f.id === c.id)!.ambience).toBe("rain");
    expect(back.furniture.find((f) => f.id === "bad")!.ambience).toBeUndefined();
    expect(carpetAt(l, c.x + 0.5, c.z + 1.9)?.id).toBe(c.id);
    expect(carpetAt(l, 0.5, 11.5)).toBeNull();
  });

  it("预设：保存后改动，再载入恢复原样；放不下的丢弃；时间天气不变", () => {
    const l = defaultLayout(files);
    const p = makePreset(l, "写论文");
    const changed: Layout = { ...l, furniture: l.furniture.filter((f) => f.type !== "desk"), env: { ...l.env, weather: "rain" } };
    const { layout: restored, dropped } = applyPreset(changed, JSON.parse(JSON.stringify(p)));
    expect(dropped).toBe(0);
    expect(restored.furniture.map((f) => f.id)).toEqual(l.furniture.map((f) => f.id));
    expect(restored.env.weather).toBe("rain");
    // 预设里互相重叠的家具：后者丢弃
    const bad = { ...p, furniture: [...p.furniture, { ...p.furniture[0], id: "dup" }] };
    expect(applyPreset(l, bad).dropped).toBe(1);
    // 玩家站在预设家具的位置上：移到空地
    const stand: Layout = { ...l, player: { x: 12.5, z: 7.5, yaw: 0, pitch: 0 } };
    const r = applyPreset(stand, p).layout;
    expect(solidCells(r).has(`${Math.floor(r.player.x)},${Math.floor(r.player.z)}`)).toBe(false);
    expect(parsePresets([{ name: "a", furniture: [] }, { bad: 1 }, null])).toHaveLength(1);
  });
});
