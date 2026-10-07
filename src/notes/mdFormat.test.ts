import { describe, expect, it } from "vitest";
import { blockOf, displayWidth, cellEnd, cellIndex, cellStart, formatTable, makeTable, parseTable, setBlock, setBlocks, setColor, tableAround, tableOp, toggleTodo, toggleWrap, type Edit } from "./mdFormat";

const apply = (doc: string, edits: Edit[]) => [...edits].sort((a, b) => b.from - a.from).reduce((d, e) => d.slice(0, e.from) + e.insert + d.slice(e.to), doc);

describe("块", () => {
  it("标题、列表、待办、引用互相切换，再按一次变回正文", () => {
    expect(setBlock("你好", "h1")).toBe("# 你好");
    expect(setBlock("# 你好", "h1")).toBe("你好");
    expect(setBlock("# 你好", "h2")).toBe("## 你好");
    expect(setBlock("- 买菜", "todo")).toBe("- [ ] 买菜");
    expect(setBlock("  - [x] 买菜", "bullet")).toBe("  - 买菜");
    expect(setBlock("1. 一", "quote")).toBe("> 一");
    expect(blockOf("### 小标题")).toBe("h3");
    expect(setBlocks(["一", "二", "三"], "number")).toEqual(["1. 一", "2. 二", "3. 三"]);
    expect(setBlocks(["- a", "- b"], "bullet")).toEqual(["a", "b"]);
    expect(toggleTodo("- [ ] 写周报")).toBe("- [x] 写周报");
    expect(toggleTodo("  * [X] 写周报")).toBe("  * [ ] 写周报");
  });
});

describe("行内", () => {
  it("包上与去掉：粗体、下划线、高亮", () => {
    const doc = "我喜欢 读书 和写作";
    const r = toggleWrap(doc, 4, 6, "**", "**");
    const d2 = apply(doc, r.edits);
    expect(d2).toBe("我喜欢 **读书** 和写作");
    expect(d2.slice(r.anchor, r.head)).toBe("读书");
    const back = toggleWrap(d2, r.anchor, r.head, "**", "**");
    expect(apply(d2, back.edits)).toBe(doc);
    // 选中包括标记也能去掉
    expect(apply("a <u>b</u> c", toggleWrap("a <u>b</u> c", 2, 10, "<u>", "</u>").edits)).toBe("a b c");
    // 两端空格留在外面
    expect(apply("x 高亮 y", toggleWrap("x 高亮 y", 1, 5, "==", "==").edits)).toBe("x ==高亮== y");
    // 粗体里面的斜体
    const b = "**加粗**";
    expect(apply(b, toggleWrap(b, 2, 4, "*", "*").edits)).toBe("***加粗***");
  });

  it("颜色：加上、换掉、去掉", () => {
    const doc = "红色的字";
    const r = setColor(doc, 0, 2, "#c0392b");
    const d2 = apply(doc, r.edits);
    expect(d2).toBe('<span style="color:#c0392b">红色</span>的字');
    expect(d2.slice(r.anchor, r.head)).toBe("红色");
    const r2 = setColor(d2, r.anchor, r.head, "#2a6ad0");
    expect(apply(d2, r2.edits)).toBe('<span style="color:#2a6ad0">红色</span>的字');
    expect(apply(d2, setColor(d2, r.anchor, r.head, null).edits)).toBe(doc);
  });
});

describe("表格", () => {
  it("新建、排版（中文两格宽）、解析回来", () => {
    const lines = makeTable(3, 2);
    expect(lines.length).toBe(4);
    const t = parseTable(lines)!;
    t.rows[0][0] = "苹果";
    t.rows[1][2] = "x";
    const out = formatTable(t);
    expect(new Set(out.map((l) => displayWidth(l))).size).toBe(1);
    expect(out[2].startsWith("| 苹果 ")).toBe(true);
    expect(parseTable(out)!.rows[0][0]).toBe("苹果");
  });

  it("找表格、单元格定位、Tab 用到的位置", () => {
    const lines = ["前言", "| 名字 | 数量 |", "| --- | --- |", "| 书 | 3 |", "", "后记"];
    expect(tableAround(lines, 3)).toEqual({ start: 1, end: 3 });
    expect(tableAround(lines, 0)).toBeNull();
    const l = "| 书 | 3 |";
    expect(cellIndex(l, 2)).toBe(0);
    expect(cellIndex(l, 6)).toBe(1);
    expect(l.slice(cellStart(l, 1), cellEnd(l, 1))).toBe("3");
    expect(l.slice(cellStart(l, 0), cellEnd(l, 0))).toBe("书");
  });

  it("加行加列、删行删列、对齐", () => {
    const t = parseTable(["| a | b |", "| - | - |", "| 1 | 2 |"])!;
    let r = tableOp(t, "addRowBelow", 2, 0);
    expect(r.table.rows.length).toBe(2);
    expect(r.row).toBe(3);
    r = tableOp(r.table, "addColRight", 3, 0);
    expect(r.table.header).toEqual(["a", "列 3", "b"]);
    r = tableOp(r.table, "delCol", 3, 1);
    expect(r.table.header).toEqual(["a", "b"]);
    r = tableOp(r.table, "delRow", 3, 0);
    expect(r.table.rows.length).toBe(1);
    r = tableOp(r.table, "alignCenter", 2, 1);
    expect(formatTable(r.table)[1]).toContain(":-");
    expect(parseTable(formatTable(r.table))!.align[1]).toBe("center");
  });
});

import { filterSlash } from "./mdCommands";
describe("斜杠菜单筛选", () => {
  it("拼音首字母、中文、英文；完全对上的排前面", () => {
    expect(filterSlash("db")[0].id).toBe("todo");
    expect(filterSlash("bg")[0].id).toBe("table");
    expect(filterSlash("表格")[0].id).toBe("table");
    expect(filterSlash("todo")[0].id).toBe("todo");
    expect(filterSlash("标题").map((x) => x.id).slice(0, 3).sort()).toEqual(["h1", "h2", "h3"]);
    expect(filterSlash("香蕉")).toEqual([]);
  });
});
