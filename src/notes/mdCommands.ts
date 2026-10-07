// 编辑器命令：把 mdFormat 的纯函数变成一次可撤销的修改。快捷键、斜杠菜单、选中工具条、表格工具条都调用这里。
import { EditorSelection, type ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  cellEnd,
  cellIndex,
  cellStart,
  splitRow,
  formatTable,
  makeTable,
  parseTable,
  setBlocks,
  setColor,
  tableAround,
  tableOp,
  toggleTodo,
  toggleWrap,
  WRAP,
  type BlockKind,
  type InlineKind,
  type TableOp,
} from "./mdFormat";

/** 选中的文字包上 / 去掉标记；没选中时插入一对标记，光标放中间 */
export function wrapCmd(kind: InlineKind) {
  return (view: EditorView): boolean => {
    const [open, close] = WRAP[kind];
    const r0 = view.state.selection.main;
    if (r0.empty) {
      view.dispatch({ changes: { from: r0.from, insert: open + close }, selection: EditorSelection.cursor(r0.from + open.length), userEvent: "input.format" });
      return true;
    }
    const r = toggleWrap(view.state.doc.toString(), r0.from, r0.to, open, close);
    view.dispatch({ changes: r.edits, selection: EditorSelection.range(r.anchor, r.head), scrollIntoView: true, userEvent: "input.format" });
    return true;
  };
}

/** 文字颜色（null 去掉颜色） */
export function colorCmd(color: string | null) {
  return (view: EditorView): boolean => {
    const r0 = view.state.selection.main;
    if (r0.empty) return false;
    const r = setColor(view.state.doc.toString(), r0.from, r0.to, color);
    view.dispatch({ changes: r.edits, selection: EditorSelection.range(r.anchor, r.head), userEvent: "input.format" });
    return true;
  };
}

/** 把选中的几行换成某种块（标题、列表、待办、引用；再按一次变回正文） */
export function blockCmd(kind: BlockKind) {
  return (view: EditorView): boolean => {
    const { state } = view;
    const r = state.selection.main;
    const firstL = state.doc.lineAt(r.from);
    const lastL = state.doc.lineAt(r.to);
    const lines: string[] = [];
    for (let n = firstL.number; n <= lastL.number; n++) lines.push(state.doc.line(n).text);
    const next = setBlocks(lines, kind);
    const text = next.join(state.lineBreak);
    // 单行时光标离行尾的距离不变
    const selection =
      lines.length === 1 && r.empty
        ? EditorSelection.cursor(Math.max(firstL.from, firstL.from + text.length - (firstL.to - r.head)))
        : EditorSelection.range(firstL.from, firstL.from + text.length);
    view.dispatch({ changes: { from: firstL.from, to: lastL.to, insert: text }, selection, userEvent: "input.format" });
    return true;
  };
}

/** 待办勾选 / 取消（光标所在的几行） */
export function todoToggleCmd(view: EditorView): boolean {
  const { state } = view;
  const r = state.selection.main;
  const changes: ChangeSpec[] = [];
  for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
    const l = state.doc.line(n);
    const t = toggleTodo(l.text);
    if (t !== l.text) changes.push({ from: l.from, to: l.to, insert: t });
  }
  if (!changes.length) return false;
  view.dispatch({ changes, userEvent: "input.format" });
  return true;
}

/** 在光标处插入一段（独占几行时前后补空行），光标落到 caret 标出的位置 */
export function insertBlock(view: EditorView, text: string, caret = text.length) {
  const { state } = view;
  const r = state.selection.main;
  const line = state.doc.lineAt(r.from);
  const br = state.lineBreak;
  const t = text.replace(/\n/g, br);
  const c = caret + (text.slice(0, caret).match(/\n/g)?.length ?? 0) * (br.length - 1);
  if (!line.text.trim()) {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: t }, selection: EditorSelection.cursor(line.from + c), scrollIntoView: true, userEvent: "input" });
  } else {
    const ins = br + br + t;
    view.dispatch({ changes: { from: line.to, insert: ins }, selection: EditorSelection.cursor(line.to + br.length * 2 + c), scrollIntoView: true, userEvent: "input" });
  }
  view.focus();
}

/** 插入表格，光标放在第一个表头里 */
export function insertTable(view: EditorView, cols: number, rows: number) {
  const lines = makeTable(Math.max(1, Math.min(12, cols)), Math.max(1, Math.min(40, rows)));
  insertBlock(view, lines.join("\n"), cellStart(lines[0], 0));
  // 选中第一个表头文字，直接改名
  const pos = view.state.selection.main.head;
  view.dispatch({ selection: EditorSelection.range(pos, pos + "列 1".length) });
}

/** 光标所在的表格；不在表格里返回 null */
export function tableAt(view: EditorView) {
  const { state } = view;
  const pos = state.selection.main.head;
  const cur = state.doc.lineAt(pos);
  // 只看附近 400 行
  const lo = Math.max(1, cur.number - 200);
  const hi = Math.min(state.doc.lines, cur.number + 200);
  const lines: string[] = [];
  for (let n = lo; n <= hi; n++) lines.push(state.doc.line(n).text);
  const around = tableAround(lines, cur.number - lo);
  if (!around) return null;
  const startLine = state.doc.line(lo + around.start);
  const endLine = state.doc.line(lo + around.end);
  const tl = lines.slice(around.start, around.end + 1);
  const table = parseTable(tl);
  if (!table) return null;
  return { from: startLine.from, to: endLine.to, row: cur.number - lo - around.start, col: cellIndex(cur.text, pos - cur.from), table, lines: tl, startLine: startLine.number };
}

/** 重写表格，把光标放到 (row, col)；select 为 true 时选中那一格的文字（直接打字就替换） */
function rewriteTable(view: EditorView, t: NonNullable<ReturnType<typeof tableAt>>, lines: string[], row: number, col: number, select = false) {
  const br = view.state.lineBreak;
  const text = lines.join(br);
  let pos = t.from;
  const r = Math.max(0, Math.min(lines.length - 1, row === 1 ? 2 : row));
  for (let i = 0; i < r; i++) pos += lines[i].length + br.length;
  const k = Math.max(0, Math.min(col, splitRow(lines[0]).length - 1));
  const a = pos + cellStart(lines[r], k);
  const b = pos + cellEnd(lines[r], k);
  view.dispatch({
    changes: { from: t.from, to: t.to, insert: text },
    selection: select && b > a ? EditorSelection.range(a, b) : EditorSelection.cursor(a),
    scrollIntoView: true,
    userEvent: "input.format",
  });
}

export function tableOpCmd(op: TableOp) {
  return (view: EditorView): boolean => {
    const t = tableAt(view);
    if (!t) return false;
    const r = tableOp(t.table, op, t.row, t.col);
    rewriteTable(view, t, formatTable(r.table), r.row, r.col);
    view.focus();
    return true;
  };
}

/** Tab：整理表格并跳到下一格；最后一格时加一行。Shift-Tab 回到上一格 */
export function tableTab(dir: 1 | -1) {
  return (view: EditorView): boolean => {
    if (!view.state.selection.main.empty && dir === 1 && !tableAt(view)) return false;
    const t = tableAt(view);
    if (!t) return false;
    const n = t.table.header.length;
    let { row, col } = t;
    if (row === 1) row = 2;
    col += dir;
    let table = t.table;
    if (col >= n) {
      col = 0;
      row = row === 0 ? 2 : row + 1;
      if (row - 2 >= table.rows.length) table = tableOp(table, "addRowBelow", row - 1, 0).table;
    } else if (col < 0) {
      col = n - 1;
      row = row === 2 ? 0 : row - 1;
      if (row < 0) row = 0;
    }
    rewriteTable(view, t, formatTable(table), row, col, true);
    return true;
  };
}

// ───────────── 常用片段 ─────────────

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface SlashItem {
  id: string;
  name: string;
  hint: string;
  /** 搜索用：拼音首字母、英文 */
  keys: string;
  icon: string;
  run: (view: EditorView) => void;
}

const block = (k: BlockKind) => (v: EditorView) => void blockCmd(k)(v);

export const SLASH_ITEMS: SlashItem[] = [
  { id: "p", name: "正文", hint: "普通段落", keys: "zw text p body 正文 段落", icon: "¶", run: (v) => void blockCmdForce(v, "p") },
  { id: "h1", name: "大标题", hint: "# 一级标题", keys: "bt dbt h1 heading title 标题 大", icon: "H1", run: block("h1") },
  { id: "h2", name: "标题", hint: "## 二级标题", keys: "bt h2 heading 标题 中", icon: "H2", run: block("h2") },
  { id: "h3", name: "小标题", hint: "### 三级标题", keys: "xbt h3 heading 标题 小", icon: "H3", run: block("h3") },
  { id: "todo", name: "待办", hint: "- [ ] 可以勾选", keys: "db todo task check 待办 任务 清单", icon: "☐", run: block("todo") },
  { id: "bullet", name: "列表", hint: "- 无序列表", keys: "lb wx list bullet ul 列表 无序", icon: "•", run: block("bullet") },
  { id: "number", name: "编号列表", hint: "1. 有序列表", keys: "bh yx number ol 编号 有序 列表", icon: "1.", run: block("number") },
  { id: "quote", name: "引用", hint: "> 引用一段话", keys: "yy quote 引用", icon: "❝", run: block("quote") },
  { id: "table", name: "表格", hint: "选几行几列", keys: "bg table 表格", icon: "▦", run: () => {} },
  { id: "callout", name: "提示框", hint: "> [!note] Obsidian 提示块", keys: "tsk callout note tip 提示 注意 标注", icon: "💡", run: (v) => insertBlock(v, "> [!note] 提示\n> ", "> [!note] 提示\n> ".length) },
  { id: "code", name: "代码块", hint: "``` 代码", keys: "dmk code 代码", icon: "</>", run: (v) => insertBlock(v, "```\n\n```", 4) },
  { id: "hr", name: "分割线", hint: "---", keys: "fgx hr divider line 分割 分隔 横线", icon: "—", run: (v) => insertBlock(v, "---\n", 4) },
  { id: "link", name: "双链", hint: "[[笔记名]] 链到另一篇", keys: "sl lj link wiki 双链 链接 引用笔记", icon: "[[", run: (v) => insertInline(v, "[[]]", 2) },
  { id: "url", name: "网址链接", hint: "[文字](网址)", keys: "wz lj url link 网址 链接", icon: "🔗", run: (v) => insertInline(v, "[]()", 1) },
  { id: "image", name: "图片", hint: "![[图片名]]", keys: "tp image img picture 图片", icon: "🖼", run: (v) => insertInline(v, "![[]]", 3) },
  { id: "math", name: "公式", hint: "$$ LaTeX $$", keys: "gs math latex 公式 数学", icon: "∑", run: (v) => insertBlock(v, "$$\n\n$$", 3) },
  { id: "date", name: "今天日期", hint: "插入今天的日期", keys: "rq jt date today 日期 今天", icon: "📅", run: (v) => insertInline(v, today(), today().length) },
  { id: "underline", name: "下划线", hint: "<u>文字</u>", keys: "xhx underline 下划线", icon: "U", run: (v) => void wrapCmd("underline")(v) },
  { id: "highlight", name: "高亮", hint: "==文字==", keys: "gl highlight mark 高亮 荧光", icon: "🖍", run: (v) => void wrapCmd("highlight")(v) },
  { id: "small", name: "小字", hint: "<small>文字</small>", keys: "xz small 小字 字号", icon: "a", run: (v) => void wrapCmd("small")(v) },
];

function blockCmdForce(v: EditorView, k: BlockKind) {
  const l = v.state.doc.lineAt(v.state.selection.main.head);
  const next = setBlocks([l.text], k)[0];
  const plain = k === "p" ? next.replace(/^(\s*)(#{1,6}[ \t]+|[-*+][ \t]+\[[ xX]\][ \t]+|[-*+][ \t]+|\d+[.)][ \t]+|>[ \t]?)/, "$1") : next;
  v.dispatch({ changes: { from: l.from, to: l.to, insert: plain }, selection: EditorSelection.cursor(l.from + plain.length) });
}

export function insertInline(v: EditorView, text: string, caret: number) {
  const r = v.state.selection.main;
  v.dispatch({ changes: { from: r.from, to: r.to, insert: text }, selection: EditorSelection.cursor(r.from + caret), userEvent: "input" });
  v.focus();
}

/** 斜杠菜单的过滤：中文、拼音首字母、英文都能搜 */
export function filterSlash(q: string): SlashItem[] {
  const s = q.trim().toLowerCase();
  if (!s) return SLASH_ITEMS;
  const score = (it: SlashItem): number => {
    const keys = it.keys.split(" ");
    if (it.name === s || keys.includes(s)) return 0;
    if (it.name.startsWith(s)) return 1;
    if (keys.some((k) => k.startsWith(s))) return 2;
    if (it.name.includes(s) || (s.length > 1 && keys.some((k) => k.includes(s)))) return 3;
    return 9;
  };
  return SLASH_ITEMS.map((it, i) => ({ it, sc: score(it), i }))
    .filter((x) => x.sc < 9)
    .sort((a, b) => a.sc - b.sc || a.i - b.i)
    .map((x) => x.it);
}

export const TEXT_COLORS: { name: string; color: string | null }[] = [
  { name: "默认", color: null },
  { name: "红", color: "#c0392b" },
  { name: "橙", color: "#d35400" },
  { name: "黄", color: "#b7950b" },
  { name: "绿", color: "#1e8449" },
  { name: "蓝", color: "#2471a3" },
  { name: "紫", color: "#7d3c98" },
  { name: "灰", color: "#7f8c8d" },
];
