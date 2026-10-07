// Markdown 格式化的纯函数：行的块类型（标题、列表、待办、引用）、行内包裹（粗体、下划线、高亮……）、表格。
// 只操作字符串，编辑器命令在 mdCommands.ts 里把结果变成一次可撤销的修改。
// 写出来的都是 Obsidian 认得的写法：下划线用 <u>，高亮用 ==，颜色用 <span style="color:…">，小字用 <small>。

// ───────────── 块（整行） ─────────────

export type BlockKind = "p" | "h1" | "h2" | "h3" | "bullet" | "number" | "todo" | "quote";

const PREFIX = /^(\s*)(#{1,6}[ \t]+|[-*+][ \t]+\[[ xX]\][ \t]+|[-*+][ \t]+|\d+[.)][ \t]+|>[ \t]?)?/;

/** 行首的标记（缩进 + 标记），以及其余文字 */
export function splitLine(line: string): { indent: string; marker: string; rest: string } {
  const m = PREFIX.exec(line)!;
  return { indent: m[1], marker: m[2] ?? "", rest: line.slice(m[0].length) };
}

export function blockOf(line: string): BlockKind {
  const { marker } = splitLine(line);
  if (/^#[ \t]/.test(marker)) return "h1";
  if (/^##[ \t]/.test(marker)) return "h2";
  if (/^#{3,6}[ \t]/.test(marker)) return "h3";
  if (/\[[ xX]\]/.test(marker)) return "todo";
  if (/^[-*+]/.test(marker)) return "bullet";
  if (/^\d/.test(marker)) return "number";
  if (marker.startsWith(">")) return "quote";
  return "p";
}

const MARK: Record<BlockKind, string> = { p: "", h1: "# ", h2: "## ", h3: "### ", bullet: "- ", number: "1. ", todo: "- [ ] ", quote: "> " };

/** 把一行换成某种块（已经是这种块时变回正文） */
export function setBlock(line: string, kind: BlockKind, toggle = true): string {
  const { indent, rest } = splitLine(line);
  const k = toggle && blockOf(line) === kind ? "p" : kind;
  // 标题不缩进
  const ind = k.startsWith("h") ? "" : indent;
  return ind + MARK[k] + rest;
}

/** 有序列表：多行时依次编号 */
export function setBlocks(lines: string[], kind: BlockKind): string[] {
  const allSame = lines.every((l) => blockOf(l) === kind || !l.trim());
  return lines.map((l, i) => {
    if (!l.trim() && lines.length > 1) return l;
    const out = setBlock(l, kind, allSame);
    return kind === "number" && !allSame ? out.replace(/^(\s*)1\. /, `$1${i + 1}. `) : out;
  });
}

/** 待办勾选 / 取消 */
export function toggleTodo(line: string): string {
  return line.replace(/^(\s*[-*+][ \t]+\[)([ xX])(\])/, (_, a, x, b) => a + (x === " " ? "x" : " ") + b);
}

// ───────────── 行内包裹 ─────────────

export type InlineKind = "bold" | "italic" | "underline" | "strike" | "highlight" | "code" | "small";

export const WRAP: Record<InlineKind, [string, string]> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  underline: ["<u>", "</u>"],
  strike: ["~~", "~~"],
  highlight: ["==", "=="],
  code: ["`", "`"],
  small: ["<small>", "</small>"],
};

export interface Edit {
  from: number;
  to: number;
  insert: string;
}

/**
 * 包裹或取消包裹：doc 为全文，[from, to) 为选区。
 * 已经被包住（标记在选区外侧或选区两端）就去掉；否则包上。返回修改与新选区。
 */
export function toggleWrap(doc: string, from: number, to: number, open: string, close: string): { edits: Edit[]; anchor: number; head: number } {
  const sel = doc.slice(from, to);
  // 标记在选区外侧
  if (doc.slice(from - open.length, from) === open && doc.slice(to, to + close.length) === close && !(open === "*" && doc.slice(from - 2, from) === "**" && doc.slice(to, to + 2) === "**" && doc.slice(from - 3, from) !== "***")) {
    return {
      edits: [
        { from: from - open.length, to: from, insert: "" },
        { from: to, to: to + close.length, insert: "" },
      ],
      anchor: from - open.length,
      head: to - open.length,
    };
  }
  // 标记在选区里面的两端
  if (sel.length >= open.length + close.length && sel.startsWith(open) && sel.endsWith(close)) {
    return { edits: [{ from, to, insert: sel.slice(open.length, sel.length - close.length) }], anchor: from, head: to - open.length - close.length };
  }
  // 选区两端的空格留在外面（**foo ** 不是粗体）
  const lead = /^\s*/.exec(sel)![0].length;
  const trail = /\s*$/.exec(sel)![0].length;
  const a = from + lead;
  const b = Math.max(a, to - trail);
  return {
    edits: [
      { from: a, to: a, insert: open },
      { from: b, to: b, insert: close },
    ],
    anchor: a + open.length,
    head: b + open.length,
  };
}

/** 文字颜色：<span style="color:…">；color 为空时去掉颜色 */
export function setColor(doc: string, from: number, to: number, color: string | null): { edits: Edit[]; anchor: number; head: number } {
  const sel = doc.slice(from, to);
  const inner = /^<span style="color:\s*[^"]*">([\s\S]*)<\/span>$/.exec(sel);
  // 选区外侧已有颜色标签
  const before = doc.slice(0, from);
  const outer = /<span style="color:\s*[^"]*">$/.exec(before);
  if (outer && doc.slice(to, to + 7) === "</span>") {
    const start = from - outer[0].length;
    const text = sel;
    const insert = color ? `<span style="color:${color}">${text}</span>` : text;
    const shift = color ? `<span style="color:${color}">`.length : 0;
    return { edits: [{ from: start, to: to + 7, insert }], anchor: start + shift, head: start + shift + text.length };
  }
  const text = inner ? inner[1] : sel;
  const insert = color ? `<span style="color:${color}">${text}</span>` : text;
  const shift = color ? `<span style="color:${color}">`.length : 0;
  return { edits: [{ from, to, insert }], anchor: from + shift, head: from + shift + text.length };
}

// ───────────── 表格 ─────────────

export function isTableLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.length > 1;
}

export function isDelimiterRow(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes("-");
}

/** 一行拆成单元格（支持 \| 转义） */
export function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "|") {
      cur += "\\|";
      i++;
    } else if (t[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
}

export type Align = "left" | "center" | "right" | null;

/** 显示宽度：中文、全角字符算 2 */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1faff}]/u.test(ch) ? 2 : 1;
  return w;
}

export interface Table {
  header: string[];
  align: Align[];
  rows: string[][];
}

export function parseTable(lines: string[]): Table | null {
  if (lines.length < 2 || !isDelimiterRow(lines[1])) return null;
  const header = splitRow(lines[0]);
  const aligns = splitRow(lines[1]).map((c): Align => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
  const rows = lines.slice(2).map((l) => splitRow(l));
  const n = Math.max(header.length, ...rows.map((r) => r.length));
  const fit = (r: string[]) => [...r, ...Array(Math.max(0, n - r.length)).fill("")].slice(0, n);
  return { header: fit(header), align: Array.from({ length: n }, (_, i) => aligns[i] ?? null), rows: rows.map(fit) };
}

/** 对齐排版：每列一样宽，中文按两格算 */
export function formatTable(t: Table): string[] {
  const n = t.header.length;
  const widths = Array.from({ length: n }, (_, i) => Math.max(3, displayWidth(t.header[i] ?? ""), ...t.rows.map((r) => displayWidth(r[i] ?? ""))));
  const cell = (s: string, i: number) => {
    const gap = widths[i] - displayWidth(s);
    const a = t.align[i];
    if (a === "right") return " ".repeat(gap) + s;
    if (a === "center") return " ".repeat(Math.floor(gap / 2)) + s + " ".repeat(Math.ceil(gap / 2));
    return s + " ".repeat(gap);
  };
  const row = (r: string[]) => `| ${r.map((c, i) => cell(c ?? "", i)).join(" | ")} |`;
  const delim = `| ${widths
    .map((w, i) => {
      const a = t.align[i];
      const dashes = "-".repeat(Math.max(3, w - (a === "center" ? 2 : a ? 1 : 0)));
      return a === "center" ? `:${dashes}:` : a === "left" ? `:${dashes}` : a === "right" ? `${dashes}:` : dashes;
    })
    .join(" | ")} |`;
  return [row(t.header), delim, ...t.rows.map(row)];
}

/** 新表格：rows 不含表头 */
export function makeTable(cols: number, rows: number): string[] {
  const t: Table = {
    header: Array.from({ length: cols }, (_, i) => `列 ${i + 1}`),
    align: Array(cols).fill(null),
    rows: Array.from({ length: rows }, () => Array(cols).fill("")),
  };
  return formatTable(t);
}

/** 光标所在的表格范围（行号，含两端）；不在表格里返回 null */
export function tableAround(lines: string[], i: number): { start: number; end: number } | null {
  if (!isTableLine(lines[i] ?? "")) return null;
  let s = i;
  while (s > 0 && isTableLine(lines[s - 1])) s--;
  let e = i;
  while (e < lines.length - 1 && isTableLine(lines[e + 1])) e++;
  if (e - s < 1 || !isDelimiterRow(lines[s + 1])) return null;
  return { start: s, end: e };
}

/** 光标在这一行的第几个单元格（0 起） */
export function cellIndex(line: string, col: number): number {
  const before = line.slice(0, col);
  let n = 0;
  for (let i = 0; i < before.length; i++) if (before[i] === "|" && before[i - 1] !== "\\") n++;
  const lead = line.trimStart().startsWith("|") ? 1 : 0;
  return Math.max(0, n - lead);
}

/** 第 k 个单元格文字的开始位置（行内偏移），用于把光标放进去 */
export function cellStart(line: string, k: number): number {
  let n = line.trimStart().startsWith("|") ? -1 : 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "|" && line[i - 1] !== "\\") {
      n++;
      if (n === k) {
        let j = i + 1;
        while (line[j] === " ") j++;
        // 空单元格：光标放在左边留一个空格的位置
        if (j >= line.length || (line[j] === "|" && line[j - 1] !== "\\")) return Math.min(line.length, i + 2);
        return j;
      }
    }
  }
  return line.length;
}

/** 单元格文字的结束位置（不含后面的空格） */
export function cellEnd(line: string, k: number): number {
  const s = cellStart(line, k);
  let j = s;
  while (j < line.length && !(line[j] === "|" && line[j - 1] !== "\\")) j++;
  while (j > s && line[j - 1] === " ") j--;
  return Math.max(s, j);
}

export type TableOp = "addRowBelow" | "addRowAbove" | "addColRight" | "addColLeft" | "delRow" | "delCol" | "alignLeft" | "alignCenter" | "alignRight" | "format";

/** 对表格做一次操作；row 为表格内的行（0 是表头，1 是分隔行，2 起是数据），col 为单元格序号 */
export function tableOp(t: Table, op: TableOp, row: number, col: number): { table: Table; row: number; col: number } {
  const T: Table = { header: [...t.header], align: [...t.align], rows: t.rows.map((r) => [...r]) };
  const n = T.header.length;
  const dataRow = Math.max(0, row - 2);
  switch (op) {
    case "addRowBelow": {
      const at = row <= 1 ? 0 : dataRow + 1;
      T.rows.splice(at, 0, Array(n).fill(""));
      return { table: T, row: at + 2, col };
    }
    case "addRowAbove": {
      const at = row <= 1 ? 0 : dataRow;
      T.rows.splice(at, 0, Array(n).fill(""));
      return { table: T, row: at + 2, col };
    }
    case "addColRight":
    case "addColLeft": {
      const at = op === "addColRight" ? col + 1 : col;
      T.header.splice(at, 0, `列 ${n + 1}`);
      T.align.splice(at, 0, null);
      for (const r of T.rows) r.splice(at, 0, "");
      return { table: T, row, col: at };
    }
    case "delRow":
      if (row >= 2 && T.rows.length) T.rows.splice(dataRow, 1);
      return { table: T, row: Math.min(row, T.rows.length + 1), col };
    case "delCol":
      if (n > 1) {
        T.header.splice(col, 1);
        T.align.splice(col, 1);
        for (const r of T.rows) r.splice(col, 1);
      }
      return { table: T, row, col: Math.min(col, T.header.length - 1) };
    case "alignLeft":
    case "alignCenter":
    case "alignRight":
      T.align[col] = op === "alignLeft" ? "left" : op === "alignCenter" ? "center" : "right";
      return { table: T, row, col };
    default:
      return { table: T, row, col };
  }
}
