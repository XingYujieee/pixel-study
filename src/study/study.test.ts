import { describe, expect, it } from "vitest";
import type { FileEntry } from "../ipc";
import { dustLevel, glowLevel, lastTouched, parseOpened, recordOpened, renameOpened, MAX_OPENED } from "./bookState";
import { ideaContent, ideaFileName, ideaPreview, inboxItems, pendingWeather, relativeAge, stripFrontmatter } from "./inbox";
import { applyTemplate, BUILTIN_TEMPLATES, formatDate, vaultTemplates } from "./templates";
import { currentWeather, DEFAULT_ENV, parseEnv } from "../world/sky";

const f = (path: string, mtime = 0, kind: FileEntry["kind"] = "markdown"): FileEntry => ({ path, name: path.split("/").pop()!, kind, size: 1, mtime });
const NOW = new Date(2026, 9, 5, 9, 7);

describe("灵感池", () => {
  it("用第一行做文件名，去掉符号与非法字符", () => {
    expect(ideaFileName("## 像素书房：加一个鱼塘？\n第二行", NOW)).toBe("像素书房：加一个鱼塘？");
    expect(ideaFileName("a/b:c?d", NOW)).toBe("a b c d");
    expect(ideaFileName("- [[渔力全开]] 的 *抛竿* 手感", NOW)).toBe("渔力全开 的 抛竿 手感");
    expect(ideaFileName("...隐藏", NOW)).toBe("隐藏");
    expect(ideaFileName("   \n\n", NOW)).toBe("灵感 2026-10-05 0907");
    const long = ideaFileName("这是一句非常非常非常非常非常非常非常非常长的灵感需要截断才行", NOW);
    expect([...long].length).toBe(25);
    expect(long.endsWith("…")).toBe(true);
  });

  it("内容带 frontmatter，预览时去掉", () => {
    const c = ideaContent("  试试把天气和待办挂钩 \n", NOW);
    expect(c).toBe("---\ncreated: 2026-10-05T09:07\ntags:\n  - 灵感\n---\n\n试试把天气和待办挂钩\n");
    expect(stripFrontmatter(c).trim()).toBe("试试把天气和待办挂钩");
    expect(ideaPreview(c)).toBe("试试把天气和待办挂钩");
    expect(ideaPreview("a".repeat(200), 10)).toBe("aaaaaaaaaa…");
    expect(stripFrontmatter("--- 不是 frontmatter")).toBe("--- 不是 frontmatter");
  });

  it("只列出 Inbox 下的直接文件，新的在前", () => {
    const items = inboxItems([f("Inbox/a.md", 1), f("Inbox/b.md", 3), f("Inbox/子/c.md", 9), f("Inboxx/d.md", 9), f("Inbox/e.png", 9, "other"), f("Inbox/t.txt", 2, "text")]);
    expect(items.map((x) => x.path)).toEqual(["Inbox/b.md", "Inbox/t.txt", "Inbox/a.md"]);
  });

  it("待处理越多天越阴", () => {
    expect([0, 3, 4, 7, 8, 15, 16].map((n) => pendingWeather(n, 8, false))).toEqual(["clear", "clear", "cloudy", "cloudy", "rain", "rain", "storm"]);
    expect(pendingWeather(9, 8, true)).toBe("snow");
    // 阈值过小时按 2 处理
    expect(pendingWeather(0, 0, false)).toBe("clear");
    expect(pendingWeather(1, 0, false)).toBe("cloudy");
  });

  it("天气设置为跟随灵感池", () => {
    const env = parseEnv({ weather: "inbox", inboxThreshold: 4 });
    expect(env.weather).toBe("inbox");
    expect(env.inboxThreshold).toBe(4);
    expect(currentWeather(env, new Date(2026, 6, 1), 0)).toBe("clear");
    expect(currentWeather(env, new Date(2026, 6, 1), 5)).toBe("rain");
    expect(currentWeather(env, new Date(2026, 6, 1), 9)).toBe("storm");
    expect(parseEnv({ inboxThreshold: 1000 }).inboxThreshold).toBe(DEFAULT_ENV.inboxThreshold);
  });

  it("相对时间", () => {
    const n = NOW.getTime();
    expect(relativeAge(n - 20000, n)).toBe("刚刚");
    expect(relativeAge(n - 5 * 60000, n)).toBe("5 分钟前");
    expect(relativeAge(n - 3 * 86400000, n)).toBe("3 天前");
    expect(relativeAge(n - 400 * 86400000, n)).toBe("1 年前");
  });
});

describe("模板", () => {
  it("替换 Obsidian 风格的变量", () => {
    expect(applyTemplate("# {{title}}\n{{date}} {{time}} {{ date:YYYY年M月D日 }} {{time:HH[点]mm}}", { title: "论文 A", now: NOW })).toBe(
      "# 论文 A\n2026-10-05 09:07 2026年10月5日 09点07",
    );
    expect(formatDate(NOW, "YY/MM/DD H:mm:ss")).toBe("26/10/05 9:07:00");
    // 未知变量保持原样
    expect(applyTemplate("{{author}}", { title: "x", now: NOW })).toBe("{{author}}");
  });

  it("内置模板保留 Obsidian 待办与引用需要的行尾空格", () => {
    const body = (id: string) => BUILTIN_TEMPLATES.find((t) => t.id === id)!.body!;
    expect(body("builtin:meeting")).toContain("- [ ] \n");
    expect(body("builtin:literature")).toContain("\n> \n");
  });

  it("内置模板都能展开", () => {
    for (const t of BUILTIN_TEMPLATES) {
      const out = applyTemplate(t.body!, { title: "标题", now: NOW });
      expect(out).not.toMatch(/\{\{/);
    }
  });

  it("库内模板文件夹", () => {
    const list = vaultTemplates([f("Templates/读书.md"), f("Templates/会议.txt", 0, "text"), f("Templates/图.png", 0, "other"), f("Notes/x.md")], "Templates/");
    // 按拼音排序：读（du）在会（hui）之前
    expect(list.map((t) => t.name)).toEqual(["读书", "会议"]);
    expect(list[0].id).toBe("Templates/读书.md");
  });
});

describe("书脊状态", () => {
  const DAY = 86400000;
  const now = NOW.getTime();
  it("久没碰的书蒙灰", () => {
    expect(dustLevel(now - 10 * DAY, now)).toBe(0);
    expect(dustLevel(now - 60 * DAY, now)).toBe(0.35);
    expect(dustLevel(now - 400 * DAY, now)).toBe(1);
    expect(dustLevel(0, now)).toBe(0);
    expect(lastTouched({ mtime: 5 }, 9)).toBe(9);
    expect(lastTouched({ mtime: 5 }, undefined)).toBe(5);
  });

  it("常被引用的书发亮", () => {
    expect(glowLevel(undefined)).toBe(0);
    expect(glowLevel(2)).toBe(0);
    expect(glowLevel(3)).toBe(0.4);
    expect(glowLevel(20)).toBe(1);
  });

  it("打开记录：改名跟随、条数有上限", () => {
    let m = recordOpened({}, "a.md", 1);
    m = renameOpened(m, "a.md", "b.md");
    expect(m).toEqual({ "b.md": 1 });
    expect(renameOpened(m, "b.md", null)).toEqual({});
    const big: Record<string, number> = {};
    for (let i = 0; i < MAX_OPENED; i++) big[`f${i}`] = i + 10;
    const trimmed = recordOpened(big, "new", 1);
    expect(Object.keys(trimmed).length).toBe(MAX_OPENED);
    expect(trimmed.new).toBeUndefined();
    expect(parseOpened({ a: 3, b: "x", c: -1 })).toEqual({ a: 3 });
  });
});

describe("鱼塘冒泡", () => {
  const DAY = 86400000;
  const now = NOW.getTime();
  it("只浮上放了几天的灵感或蒙灰的书，排除模板与刚看过的", async () => {
    const { pickSurfacing, nextBubbleDelay } = await import("./bubble");
    const files = [
      f("Inbox/新.md", now - DAY),
      f("Inbox/旧.md", now - 5 * DAY),
      f("读书/新书.md", now - 10 * DAY),
      f("读书/旧书.md", now - 100 * DAY),
      f("Templates/模板.md", now - 300 * DAY),
      f("图/旧图.png", now - 300 * DAY, "other"),
    ];
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const r = pickSurfacing(files, {}, now, { templateDir: "Templates" });
      seen.add(`${r!.kind}:${r!.path}`);
    }
    expect([...seen].sort()).toEqual(["book:读书/旧书.md", "idea:Inbox/旧.md"]);
    // 在书房里最近打开过的旧书不算沉睡
    expect(pickSurfacing(files, { "读书/旧书.md": now - DAY, "Inbox/旧.md": now }, now, { templateDir: "Templates" })).toBeNull();
    expect(pickSurfacing(files, {}, now, { exclude: new Set(["Inbox/旧.md", "读书/旧书.md"]), templateDir: "Templates" })).toBeNull();
    const d = nextBubbleDelay(() => 0.5);
    expect(d).toBe(6.5 * 60000);
  });
});

describe("拖放导入的落点", () => {
  it("按家具决定去处", async () => {
    const { planDrop, dropCountText } = await import("./dropPlan");
    const shelf = (mode: "folder" | "virtual", folder = "") => ({ id: "s", type: "bookshelf" as const, x: 0, z: 0, rot: 0 as const, shelf: { name: "读书", mode, refs: [], folder } });
    expect(planDrop(shelf("folder", "读书"))).toMatchObject({ dir: "读书", fid: "s" });
    expect(planDrop(shelf("folder", "")).label).toContain("库根目录");
    expect(planDrop(shelf("virtual"))).toMatchObject({ dir: "Imports", shelfRef: "s" });
    const f = (type: "desk" | "pond" | "aibench" | "chest" | "plant") => ({ id: type, type, x: 0, z: 0, rot: 0 as const });
    expect(planDrop(f("desk"))).toMatchObject({ dir: "Imports", then: "desk" });
    expect(planDrop(f("pond"))).toMatchObject({ dir: "Inbox" });
    expect(planDrop(f("aibench"))).toMatchObject({ then: "ai" });
    expect(planDrop(f("chest"))).toMatchObject({ dir: "Imports", fid: "chest" });
    expect(planDrop(f("plant"), { chestId: "c1" })).toMatchObject({ dir: "Imports", fid: "c1" });
    expect(planDrop(null, { chestId: null }).fid).toBeNull();
    expect(planDrop(f("desk"), { focus: true })).toMatchObject({ dir: "Imports", fid: null });
    expect(planDrop(f("desk"), { focus: true }).then).toBeUndefined();
    expect(dropCountText(["/Users/a/论文.pdf"])).toBe("「论文.pdf」");
    expect(dropCountText(["/a/x.pdf", "/a/y"])).toBe("「x.pdf」等 2 项");
  });
});
