import { describe, expect, it } from "vitest";
import type { FileEntry } from "../ipc";
import { fuzzyFiles, fuzzyScore } from "./fuzzy";
import { buildLinkIndex, parseWikilink, resolveWikilink } from "./links";
import { basename, dirname, extname, resolveRelative, stem } from "./paths";
import { countWords, detectLineSeparator, minimalChange } from "./text";
import { ancestors, buildTree } from "./tree";

const e = (path: string): FileEntry => ({ path, name: basename(path), kind: "markdown", size: 1, mtime: 1 });

describe("text", () => {
  it("识别换行符", () => {
    expect(detectLineSeparator("a\r\nb")).toBe("\r\n");
    expect(detectLineSeparator("a\nb\r\nc")).toBe("\n");
    expect(detectLineSeparator("无换行")).toBe("\n");
  });

  it("最小替换区间", () => {
    expect(minimalChange("abc", "abc")).toBeNull();
    expect(minimalChange("开头中间结尾", "开头修改结尾")).toEqual({ from: 2, to: 4, insertFrom: 2, insertTo: 4 });
    expect(minimalChange("abc", "abXYc")).toEqual({ from: 2, to: 2, insertFrom: 2, insertTo: 4 });
    // 不切开 emoji 代理对
    const ch = minimalChange("a😀b", "a😃b")!;
    expect(ch.from).toBe(1);
    expect(ch.to).toBe(3);
  });

  it("中英文字数", () => {
    expect(countWords("今天读了 three body 三体")).toBe(8);
    expect(countWords("")).toBe(0);
  });
});

describe("paths", () => {
  it("基本操作", () => {
    expect(basename("a/b/笔记.md")).toBe("笔记.md");
    expect(dirname("a/b/笔记.md")).toBe("a/b");
    expect(dirname("笔记.md")).toBe("");
    expect(stem("a/v1.2 计划.md")).toBe("v1.2 计划");
    expect(extname("a/B.PDF")).toBe("pdf");
  });

  it("解析相对链接", () => {
    expect(resolveRelative("读书/三体.md", "图片/封面%20图.png")).toBe("读书/图片/封面 图.png");
    expect(resolveRelative("读书/三体.md", "../附件/a.png")).toBe("附件/a.png");
    expect(resolveRelative("读书/三体.md", "/根目录.md")).toBe("根目录.md");
    expect(resolveRelative("三体.md", "../../越界.png")).toBeNull();
    expect(resolveRelative("a.md", "https://example.com/x.png")).toBeNull();
    expect(resolveRelative("a.md", "#标题")).toBeNull();
    expect(resolveRelative("a.md", "b.md#标题")).toBe("b.md");
  });
});

describe("tree", () => {
  it("目录在前、自然排序、计数", () => {
    const t = buildTree([e("b.md"), e("读书/第10章.md"), e("读书/第2章.md"), e("a.md"), e("读书/小说/x.md")]);
    expect(t.files.map((f) => f.name)).toEqual(["a.md", "b.md"]);
    expect(t.dirs[0].name).toBe("读书");
    expect(t.dirs[0].files.map((f) => f.name)).toEqual(["第2章.md", "第10章.md"]);
    expect(t.dirs[0].count).toBe(3);
    expect(t.count).toBe(5);
    expect(ancestors("a/b/c.md")).toEqual(["a", "a/b"]);
  });
});

describe("fuzzy", () => {
  it("子串优先，其次子序列", () => {
    expect(fuzzyScore("三体", "三体读书笔记.md")!.score).toBeGreaterThan(fuzzyScore("三笔", "三体读书笔记.md")!.score);
    expect(fuzzyScore("xyz", "abc")).toBeNull();
    const r = fuzzyFiles("dsbj", [e("读书笔记.md"), e("daily/dsbj.md"), e("other.md")]);
    expect(r[0].entry.path).toBe("daily/dsbj.md");
    const r2 = fuzzyFiles("笔记", [e("x/读书笔记.md"), e("笔记/索引.md"), e("无关.md")]);
    expect(r2.map((m) => m.entry.path)).toEqual(["x/读书笔记.md", "笔记/索引.md"]);
  });
});


describe("links", () => {
  const paths = ["重名A/索引.md", "重名B/索引.md", "深/层/索引.md", "读书/三体.md", "附件/封面 图.png", "Readme.md"];
  const idx = buildLinkIndex(paths);
  const exists = (p: string) => paths.includes(p);

  it("拆分显示名称与标题", () => {
    expect(parseWikilink("三体|我的书")).toEqual({ target: "三体", alias: "我的书", heading: undefined });
    expect(parseWikilink("三体#第一章|x")).toEqual({ target: "三体", alias: "x", heading: "第一章" });
    expect(parseWikilink("三体#^abc")).toEqual({ target: "三体", alias: undefined, heading: "abc" });
  });

  it("按文件名匹配，忽略大小写，同目录优先", () => {
    expect(resolveWikilink("三体", "x.md", idx, exists).path).toBe("读书/三体.md");
    expect(resolveWikilink("README", "x.md", idx, exists).path).toBe("Readme.md");
    expect(resolveWikilink("封面 图.png", "x.md", idx, exists).path).toBe("附件/封面 图.png");
    const r = resolveWikilink("索引", "重名B/其他.md", idx, exists);
    expect(r).toMatchObject({ path: "重名B/索引.md", ambiguous: true });
    expect(resolveWikilink("索引", "根.md", idx, exists).path).toBe("重名A/索引.md");
    expect(resolveWikilink("不存在", "x.md", idx, exists).path).toBeNull();
  });

  it("带路径的链接", () => {
    expect(resolveWikilink("深/层/索引", "x.md", idx, exists).path).toBe("深/层/索引.md");
    expect(resolveWikilink("层/索引", "深/a.md", idx, exists).path).toBe("深/层/索引.md");
  });
});
