// 像 Notion 那样写 Markdown：
// - 行首或空格后输入「/」（中文输入法下是「、」）弹出命令菜单：标题、待办、表格、提示框……可以打字筛选
// - 选中文字时上方出现格式工具条：字号、粗体、斜体、下划线、删除线、高亮、代码、双链、颜色
// - 光标在表格里时出现表格工具条：加行加列、删行删列、对齐；Tab 跳到下一格并自动对齐
import { Prec, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, showTooltip, ViewPlugin, type Tooltip, type TooltipView, type ViewUpdate } from "@codemirror/view";
import { blockCmd, colorCmd, filterSlash, insertTable, tableAt, tableOpCmd, tableTab, TEXT_COLORS, todoToggleCmd, wrapCmd, type SlashItem } from "./mdCommands";
import { blockOf, type BlockKind, type TableOp } from "./mdFormat";
import { isLiteralMarkdown } from "./mdContext";

// ───────────── 斜杠菜单 ─────────────

interface SlashState {
  /** 「/」所在位置 */
  from: number;
  query: string;
  sel: number;
  /** 选了「表格」后显示行列选择 */
  table: boolean;
}

const setSlash = StateEffect.define<SlashState | null>();

const slashField = StateField.define<SlashState | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setSlash)) return e.value;
    if (!v) return v;
    if (v.table) return tr.docChanged || tr.selection ? null : v;
    const from = tr.changes.mapPos(v.from);
    const head = tr.state.selection.main.head;
    const c = tr.state.sliceDoc(from, from + 1);
    if (c !== "/" && c !== "、") return null;
    if (head <= from || tr.state.doc.lineAt(head).number !== tr.state.doc.lineAt(from).number) return null;
    const q = tr.state.sliceDoc(from + 1, head);
    if (q.length > 16 || /\s{2}|^\s/.test(q)) return null;
    // 打了两个字还对不上任何命令：大概不是在找命令，收起来
    if (q.length >= 2 && !filterSlash(q).length) return null;
    if (q !== v.query) return { ...v, from, query: q, sel: 0, table: false };
    return from === v.from ? v : { ...v, from };
  },
  provide: (f) =>
    showTooltip.from(f, (v): Tooltip | null =>
      v
        ? {
            pos: v.from,
            above: false,
            strictSide: false,
            create: (view) => slashMenu(view),
          }
        : null,
    ),
});

/** 刚输入了「/」或「、」，而且在行首或空格后面：打开菜单 */
const slashTrigger = ViewPlugin.fromClass(
  class {
    update(u: ViewUpdate) {
      if (!u.docChanged || u.state.field(slashField)) return;
      if (!u.transactions.some((tr) => tr.isUserEvent("input.type") || tr.isUserEvent("input.type.compose"))) return;
      let hit = -1;
      let ch = "";
      u.changes.iterChanges((_fa, _ta, fromB, _tb, ins) => {
        const s = ins.toString();
        if (s === "/" || s === "、") {
          hit = fromB;
          ch = s;
        }
      });
      if (hit < 0) return;
      const before = hit > 0 ? u.state.sliceDoc(hit - 1, hit) : "\n";
      const atStart = hit === u.state.doc.lineAt(hit).from || /\s/.test(before);
      // 「/」：行首、空格后、中文后面都能弹，英文和数字后面不弹（a/b、网址、日期）
      // 「、」是中文顿号，只在行首或空格后才当成命令（「苹果、香蕉」不弹）
      if (ch === "、" ? !atStart : !atStart && /[A-Za-z0-9:/._\-~]/.test(before)) return;
      // 代码块里不弹
      const line = u.state.doc.lineAt(hit).text;
      if (/^\s*(```|~~~)/.test(line) || isLiteralMarkdown(u.state, hit)) return;
      const view = u.view;
      queueMicrotask(() => view.dispatch({ effects: setSlash.of({ from: hit, query: "", sel: 0, table: false }) }));
    }
  },
);

function runSlash(view: EditorView, item: SlashItem) {
  const st = view.state.field(slashField);
  if (!st) return;
  const head = view.state.selection.main.head;
  // 先删掉「/查询」
  view.dispatch({ changes: { from: st.from, to: Math.max(head, st.from + 1) }, effects: setSlash.of(null) });
  if (item.id === "table") {
    view.dispatch({ effects: setSlash.of({ from: view.state.selection.main.head, query: "", sel: 0, table: true }) });
    // 占位：表格选择器挂在一个看不见的位置上
    return;
  }
  item.run(view);
  view.focus();
}

function slashMenu(view: EditorView): TooltipView {
  const dom = document.createElement("div");
  dom.className = "md-pop md-slash";
  dom.addEventListener("mousedown", (e) => e.preventDefault());
  let last = "";
  const render = () => {
    const st = view.state.field(slashField);
    if (!st) return;
    const key = JSON.stringify(st);
    if (key === last) return;
    last = key;
    dom.textContent = "";
    if (st.table) {
      dom.appendChild(tablePicker(view, (c, r) => {
        view.dispatch({ effects: setSlash.of(null) });
        insertTable(view, c, r);
      }));
      return;
    }
    const items = filterSlash(st.query);
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "md-slash-empty";
      empty.textContent = "没有这个命令（Esc 关掉）";
      dom.appendChild(empty);
      return;
    }
    const head = document.createElement("div");
    head.className = "md-pop-head";
    head.textContent = st.query ? `「${st.query}」` : "插入 · 打字筛选（拼音首字母也行）";
    dom.appendChild(head);
    items.forEach((it, i) => {
      const row = document.createElement("button");
      row.className = `md-slash-item ${i === st.sel % items.length ? "on" : ""}`;
      row.innerHTML = `<span class="md-ic"></span><span class="md-nm"></span><span class="md-ht"></span>`;
      (row.children[0] as HTMLElement).textContent = it.icon;
      (row.children[1] as HTMLElement).textContent = it.name;
      (row.children[2] as HTMLElement).textContent = it.hint;
      row.addEventListener("click", () => runSlash(view, it));
      dom.appendChild(row);
      if (i === st.sel % items.length) requestAnimationFrame(() => row.scrollIntoView({ block: "nearest" }));
    });
  };
  render();
  return { dom, update: () => render() };
}

/** 表格大小：鼠标划过选几行几列 */
function tablePicker(view: EditorView, done: (cols: number, rows: number) => void): HTMLElement {
  const box = document.createElement("div");
  box.className = "md-table-pick";
  const label = document.createElement("div");
  label.className = "md-pop-head";
  label.textContent = "表格：划过选择大小（回车 3 × 3）";
  box.appendChild(label);
  const grid = document.createElement("div");
  grid.className = "md-grid";
  const N = 8;
  const cells: HTMLElement[] = [];
  const mark = (c: number, r: number) => {
    cells.forEach((el, i) => el.classList.toggle("on", i % N < c && Math.floor(i / N) < r));
    label.textContent = `${c} 列 × ${r} 行（含表头）`;
  };
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const el = document.createElement("i");
      el.addEventListener("mouseenter", () => mark(c + 1, r + 1));
      el.addEventListener("click", () => done(c + 1, Math.max(1, r)));
      grid.appendChild(el);
      cells.push(el);
    }
  box.appendChild(grid);
  void view;
  return box;
}

const slashKeys = Prec.highest(
  keymap.of([
    { key: "ArrowDown", run: (v) => moveSel(v, 1) },
    { key: "ArrowUp", run: (v) => moveSel(v, -1) },
    { key: "Enter", run: (v) => pick(v) },
    { key: "Tab", run: (v) => pick(v) },
    {
      key: "Escape",
      run: (v) => {
        if (!v.state.field(slashField)) return false;
        v.dispatch({ effects: setSlash.of(null) });
        return true;
      },
    },
  ]),
);

function moveSel(v: EditorView, d: number): boolean {
  const st = v.state.field(slashField);
  if (!st || st.table) return false;
  const n = filterSlash(st.query).length || 1;
  v.dispatch({ effects: setSlash.of({ ...st, sel: (st.sel + d + n) % n }) });
  return true;
}

function pick(v: EditorView): boolean {
  const st = v.state.field(slashField);
  if (!st) return false;
  if (st.table) {
    v.dispatch({ effects: setSlash.of(null) });
    insertTable(v, 3, 2);
    return true;
  }
  const items = filterSlash(st.query);
  if (!items.length) {
    v.dispatch({ effects: setSlash.of(null) });
    return false;
  }
  runSlash(v, items[st.sel % items.length]);
  return true;
}

// ───────────── 选中工具条 ─────────────

const SIZES: { name: string; kind: BlockKind | "small" }[] = [
  { name: "大标题", kind: "h1" },
  { name: "标题", kind: "h2" },
  { name: "小标题", kind: "h3" },
  { name: "正文", kind: "p" },
  { name: "小字", kind: "small" },
];

function bubbleTooltip(state: EditorState): Tooltip | null {
  const r = state.selection.main;
  if (r.empty || state.field(slashField, false)) return null;
  if (state.sliceDoc(r.from, r.to).includes("\n") && r.to - r.from > 2000) return null;
  return { pos: r.from, above: true, strictSide: false, arrow: false, create: (view) => bubbleView(view) };
}

function btn(label: string, title: string, run: () => void, cls = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = `md-tb ${cls}`;
  b.textContent = label;
  b.title = title;
  b.addEventListener("mousedown", (e) => {
    e.preventDefault();
    run();
  });
  return b;
}

function bubbleView(view: EditorView): TooltipView {
  const dom = document.createElement("div");
  dom.className = "md-pop md-bubble";
  dom.addEventListener("mousedown", (e) => e.preventDefault());
  // 字号（标题级别 / 小字）
  const size = document.createElement("select");
  size.className = "md-size";
  size.title = "字号：Markdown 用标题级别表示大小";
  for (const s of SIZES) {
    const o = document.createElement("option");
    o.value = s.kind;
    o.textContent = s.name;
    size.appendChild(o);
  }
  const syncSize = () => {
    const k = blockOf(view.state.doc.lineAt(view.state.selection.main.from).text);
    size.value = ["h1", "h2", "h3"].includes(k) ? k : "p";
  };
  syncSize();
  size.addEventListener("change", () => {
    const k = size.value as BlockKind | "small";
    if (k === "small") wrapCmd("small")(view);
    else if (k === "p") {
      const cur = blockOf(view.state.doc.lineAt(view.state.selection.main.from).text);
      if (cur.startsWith("h")) blockCmd(cur)(view);
    } else {
      const cur = blockOf(view.state.doc.lineAt(view.state.selection.main.from).text);
      if (cur !== k) blockCmd(k)(view);
    }
    view.focus();
  });
  dom.appendChild(size);
  dom.appendChild(btn("B", "粗体 ⌘B", () => wrapCmd("bold")(view), "b"));
  dom.appendChild(btn("I", "斜体 ⌘I", () => wrapCmd("italic")(view), "i"));
  dom.appendChild(btn("U", "下划线 ⌘U", () => wrapCmd("underline")(view), "u"));
  dom.appendChild(btn("S", "删除线 ⌘⇧X", () => wrapCmd("strike")(view), "s"));
  dom.appendChild(btn("高亮", "高亮 ⌘⇧H", () => wrapCmd("highlight")(view), "hl"));
  dom.appendChild(btn("</>", "行内代码 ⌘⇧E", () => wrapCmd("code")(view), "code"));
  dom.appendChild(
    btn("[[ ]]", "变成双链（链到同名笔记）", () => {
      const r = view.state.selection.main;
      const t = view.state.sliceDoc(r.from, r.to);
      view.dispatch({ changes: { from: r.from, to: r.to, insert: `[[${t}]]` } });
    }),
  );
  // 颜色
  const colors = document.createElement("span");
  colors.className = "md-colors";
  for (const c of TEXT_COLORS) {
    const b = btn("", `文字颜色：${c.name}`, () => colorCmd(c.color)(view), "sw");
    b.style.setProperty("--sw", c.color ?? "transparent");
    if (!c.color) b.textContent = "⌀";
    colors.appendChild(b);
  }
  dom.appendChild(colors);
  return { dom, update: (u) => u.selectionSet && syncSize() };
}

const bubble = showTooltip.compute(["selection"], bubbleTooltip);

// ───────────── 表格工具条 ─────────────

const TABLE_BTNS: [string, string, TableOp][] = [
  ["＋行", "在下面加一行", "addRowBelow"],
  ["＋列", "在右边加一列", "addColRight"],
  ["－行", "删掉这一行", "delRow"],
  ["－列", "删掉这一列", "delCol"],
  ["⇤", "这一列靠左", "alignLeft"],
  ["⇔", "这一列居中", "alignCenter"],
  ["⇥", "这一列靠右", "alignRight"],
  ["整理", "对齐整张表", "format"],
];

const tableBar = showTooltip.compute(["selection", "doc"], (state): Tooltip | null => {
  const r = state.selection.main;
  if (!r.empty) return null;
  const line = state.doc.lineAt(r.head).text;
  if (!line.trim().startsWith("|")) return null;
  // 找到表格的第一行
  let n = state.doc.lineAt(r.head).number;
  while (n > 1 && state.doc.line(n - 1).text.trim().startsWith("|")) n--;
  return {
    pos: state.doc.line(n).from,
    above: true,
    strictSide: false,
    create: (view) => {
      const dom = document.createElement("div");
      dom.className = "md-pop md-tablebar";
      dom.addEventListener("mousedown", (e) => e.preventDefault());
      if (!tableAt(view)) dom.style.display = "none";
      for (const [label, title, op] of TABLE_BTNS) dom.appendChild(btn(label, title, () => tableOpCmd(op)(view)));
      const tip = document.createElement("span");
      tip.className = "md-tb-tip";
      tip.textContent = "Tab 下一格";
      dom.appendChild(tip);
      return { dom };
    },
  };
});

// ───────────── 快捷键 ─────────────

const formatKeys = keymap.of([
  { key: "Mod-b", run: wrapCmd("bold") },
  { key: "Mod-i", run: wrapCmd("italic") },
  { key: "Mod-u", run: wrapCmd("underline") },
  { key: "Mod-Shift-x", run: wrapCmd("strike") },
  { key: "Mod-Shift-h", run: wrapCmd("highlight") },
  { key: "Mod-Shift-e", run: wrapCmd("code") },
  { key: "Mod-Alt-1", run: blockCmd("h1") },
  { key: "Mod-Alt-2", run: blockCmd("h2") },
  { key: "Mod-Alt-3", run: blockCmd("h3") },
  { key: "Mod-Alt-0", run: (v) => blockCmd(blockOf(v.state.doc.lineAt(v.state.selection.main.head).text))(v) },
  { key: "Mod-Shift-7", run: blockCmd("number") },
  { key: "Mod-Shift-8", run: blockCmd("bullet") },
  { key: "Mod-Shift-9", run: blockCmd("todo") },
  { key: "Mod-Enter", run: todoToggleCmd },
  { key: "Tab", run: tableTab(1) },
  { key: "Shift-Tab", run: tableTab(-1) },
]);

/** Markdown 编辑增强（纯文本文件不加） */
export function markdownTools(): Extension[] {
  return [slashField, slashTrigger, slashKeys, Prec.high(formatKeys), bubble, tableBar];
}

export { setSlash, slashField };
