// 所见即所得（像 Obsidian 的实时预览）：光标不在的那几行，隐藏 Markdown 标记，直接显示效果。
// 待办变成能点的方块，列表符号变成圆点，分割线变成一条线，<u>、==、<small>、颜色直接显示样式。
// 光标所在的行恢复原样，方便改；文件内容一个字也不变。
import { syntaxTree } from "@codemirror/language";
import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { cellEnd, parseTable, toggleTodo } from "./mdFormat";
import { isLiteralMarkdown } from "./mdContext";

const KEY = "ps.livePreview";

let enabled = (() => {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
})();

const refresh = StateEffect.define<null>();

export function livePreviewOn(): boolean {
  return enabled;
}

/** 切换所见即所得 / 源码 */
export function setLivePreview(view: EditorView | null, on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* 存不了就算了 */
  }
  view?.dispatch({ effects: refresh.of(null) });
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly lineFrom: number,
  ) {
    super();
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked && o.lineFrom === this.lineFrom;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = `md-check ${this.checked ? "on" : ""}`;
    el.setAttribute("role", "checkbox");
    el.setAttribute("aria-checked", String(this.checked));
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const line = view.state.doc.lineAt(this.lineFrom);
      const next = toggleTodo(line.text);
      if (next !== line.text) view.dispatch({ changes: { from: line.from, to: line.to, insert: next }, userEvent: "input.format" });
    });
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super();
  }
  eq(o: BulletWidget) {
    return o.depth === this.depth;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "md-bullet";
    el.textContent = ["•", "◦", "▪"][this.depth % 3];
    return el;
  }
}

const CALLOUT_LABELS: Record<string, string> = { note: "📝 笔记", tip: "💡 提示", info: "ℹ️ 信息", warning: "⚠️ 注意", danger: "⛔ 危险", success: "✅ 完成", question: "❓ 问题", quote: "❝ 引述", todo: "☑️ 待办", abstract: "📋 摘要", example: "🔎 例子" };

/** Obsidian 提示块的标头：[!tip] → 💡 提示 */
class CalloutWidget extends WidgetType {
  constructor(readonly type: string) {
    super();
  }
  eq(o: CalloutWidget) {
    return o.type === this.type;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = `md-callout-tag t-${this.type}`;
    el.textContent = CALLOUT_LABELS[this.type] ?? `📌 ${this.type}`;
    return el;
  }
}

class RuleWidget extends WidgetType {
  toDOM() {
    const el = document.createElement("span");
    el.className = "md-hr";
    return el;
  }
}

const hide = Decoration.replace({});
const lineQuote = Decoration.line({ class: "md-quote-line" });
const lineTodoDone = Decoration.line({ class: "md-todo-done" });

/** 光标、选区碰到的行（这些行显示原文） */
function activeLines(state: EditorState): Set<number> {
  const s = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) s.add(n);
  }
  return s;
}

const INLINE: { re: RegExp; cls: (m: RegExpExecArray) => string; style?: (m: RegExpExecArray) => string; open: (m: RegExpExecArray) => number; close: number }[] = [
  { re: /==([^=\n]+)==/g, cls: () => "md-hl", open: () => 2, close: 2 },
  { re: /<u>([^<\n]+)<\/u>/g, cls: () => "md-u", open: () => 3, close: 4 },
  { re: /<small>([^<\n]+)<\/small>/g, cls: () => "md-small", open: () => 7, close: 8 },
  { re: /<span style="color:\s*([^";]+);?">([^<\n]*)<\/span>/g, cls: () => "md-color", style: (m) => `color:${m[1]}`, open: (m) => m[0].indexOf(">") + 1, close: 7 },
];

function build(view: EditorView): DecorationSet {
  if (!enabled) return Decoration.none;
  const { state } = view;
  const active = activeLines(state);
  const out: Range<Decoration>[] = [];
  const lineOf = (pos: number) => state.doc.lineAt(pos);
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        if (name === "FencedCode" || name === "CodeBlock" || name === "Frontmatter") return false;
        const ln = lineOf(node.from);
        const off = !active.has(ln.number);
        switch (name) {
          case "HeaderMark":
            if (off) {
              // 带上后面的空格
              const end = Math.min(ln.to, node.to + (state.sliceDoc(node.to, node.to + 1) === " " ? 1 : 0));
              if (node.from === ln.from || state.sliceDoc(ln.from, node.from).trim() === "") out.push(hide.range(node.from, end));
            }
            break;
          case "EmphasisMark":
          case "StrikethroughMark":
            if (off) out.push(hide.range(node.from, node.to));
            break;
          case "CodeMark":
            if (off && node.node.parent?.name === "InlineCode") out.push(hide.range(node.from, node.to));
            break;
          case "QuoteMark": {
            out.push(lineQuote.range(ln.from));
            const after = Math.min(ln.to, node.to + (state.sliceDoc(node.to, node.to + 1) === " " ? 1 : 0));
            if (off) out.push(hide.range(node.from, after));
            // 提示块标头：> [!tip] 标题
            const m = /^\[!([A-Za-z]+)\][-+]?/.exec(state.sliceDoc(after, ln.to));
            if (off && m) out.push(Decoration.replace({ widget: new CalloutWidget(m[1].toLowerCase()) }).range(after, after + m[0].length));
            break;
          }
          case "TaskMarker": {
            const checked = /x/i.test(state.sliceDoc(node.from, node.to));
            if (checked) out.push(lineTodoDone.range(ln.from));
            // 待办的方块总是能点（光标在方块里时显示原文）
            const head = state.selection.main.head;
            if (!(head >= node.from && head <= node.to)) out.push(Decoration.replace({ widget: new CheckboxWidget(checked, ln.from) }).range(node.from, node.to));
            break;
          }
          case "ListMark": {
            if (!off) break;
            const parent = node.node.parent;
            const isTask = !!parent?.getChild("Task");
            const ordered = parent?.parent?.name === "OrderedList";
            if (isTask) out.push(hide.range(node.from, Math.min(ln.to, node.to + 1)));
            else if (!ordered) {
              let depth = 0;
              for (let p = parent?.parent; p; p = p.parent) if (p.name === "BulletList") depth++;
              out.push(Decoration.replace({ widget: new BulletWidget(Math.max(0, depth - 1)) }).range(node.from, node.to));
            }
            break;
          }
          case "HorizontalRule":
            if (off) out.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to));
            break;
          case "Link": {
            // [文字](网址)：光标不在时只显示文字
            if (!off) break;
            const marks = node.node.getChildren("LinkMark");
            const url = node.node.getChild("URL");
            if (marks.length >= 2 && state.sliceDoc(node.from, node.from + 1) === "[" && state.sliceDoc(node.from, node.from + 2) !== "[!") {
              out.push(hide.range(marks[0].from, marks[0].to));
              out.push(Decoration.mark({ class: "md-link" }).range(marks[0].to, marks[1].from));
              out.push(hide.range(marks[1].from, node.to));
              void url;
            }
            return false;
          }
        }
        return undefined;
      },
    });
    // 行内 HTML 与高亮（语法树不认识 ==）
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      const off = !active.has(line.number);
      for (const rule of INLINE) {
        rule.re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = rule.re.exec(line.text))) {
          const s = line.from + m.index;
          if (isLiteralMarkdown(state, s)) continue;
          const e = s + m[0].length;
          const o = rule.open(m);
          const style = rule.style?.(m);
          out.push(Decoration.mark({ class: rule.cls(m), attributes: style ? { style } : undefined }).range(s + o, e - rule.close));
          if (off) {
            out.push(hide.range(s, s + o));
            out.push(hide.range(e - rule.close, e));
          }
        }
      }
      // 双链 [[ ]]
      const wl = /\[\[([^\]\n]+)\]\]/g;
      let w: RegExpExecArray | null;
      while ((w = wl.exec(line.text))) {
        const s = line.from + w.index;
        if (isLiteralMarkdown(state, s)) continue;
        out.push(Decoration.mark({ class: "md-wikilink" }).range(s + 2, s + w[0].length - 2));
        if (off) {
          out.push(hide.range(s, s + 2));
          out.push(hide.range(s + w[0].length - 2, s + w[0].length));
        }
      }
      pos = line.to + 1;
    }
  }
  // 去掉空的范围（行装饰除外），按位置排序
  const lines = new Set([lineQuote, lineTodoDone]);
  return Decoration.set(
    out.filter((r) => lines.has(r.value) || r.from < r.to || (r.from === r.to && (r.value.spec as { widget?: unknown }).widget)),
    true,
  );
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.transactions.some((t) => t.effects.some((e) => e.is(refresh))) || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ───────────── 表格：光标不在表格里时显示成真正的表格 ─────────────

class TableWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly from: number,
  ) {
    super();
  }
  eq(o: TableWidget) {
    return o.src === this.src && o.from === this.from;
  }
  toDOM(view: EditorView) {
    const lines = this.src.split(/\r?\n/);
    const t = parseTable(lines);
    const wrap = document.createElement("div");
    wrap.className = "md-table-wrap";
    if (!t) {
      wrap.textContent = this.src;
      return wrap;
    }
    const table = document.createElement("table");
    table.className = "md-table";
    const row = (cells: string[], tag: "th" | "td", r: number) => {
      const tr = document.createElement("tr");
      cells.forEach((c, i) => {
        const el = document.createElement(tag);
        el.textContent = c.replace(/\\\|/g, "|").replace(/\*\*|__|`|==|<\/?u>|<\/?small>/g, "");
        if (t.align[i]) el.style.textAlign = t.align[i]!;
        // 点哪一格，光标就放进那一格
        el.addEventListener("mousedown", (e) => {
          e.preventDefault();
          const lineNo = view.state.doc.lineAt(this.from).number + r;
          const line = view.state.doc.line(Math.min(view.state.doc.lines, lineNo));
          view.dispatch({ selection: { anchor: line.from + cellEnd(line.text, i) } });
          view.focus();
        });
        tr.appendChild(el);
      });
      return tr;
    };
    const thead = document.createElement("thead");
    thead.appendChild(row(t.header, "th", 0));
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    t.rows.forEach((r, i) => tbody.appendChild(row(r, "td", i + 2)));
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

function tableDecos(state: EditorState): DecorationSet {
  if (!enabled) return Decoration.none;
  const out: Range<Decoration>[] = [];
  const sel = state.selection.main;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "Table") return node.name === "Document" || node.name === "Blockquote" ? undefined : false;
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      // 光标在表格里：显示原文（等宽字体对齐）
      if (sel.from <= to && sel.to >= from) {
        for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) out.push(tableLine.range(state.doc.line(n).from));
        return false;
      }
      out.push(Decoration.replace({ widget: new TableWidget(state.sliceDoc(from, to), from), block: true }).range(from, to));
      return false;
    },
  });
  return Decoration.set(out, true);
}

const tableLine = Decoration.line({ class: "md-table-src" });

export const tableField = StateField.define<DecorationSet>({
  create: (s) => tableDecos(s),
  update(v, tr) {
    if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(refresh)) || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return tableDecos(tr.state);
    return v;
  },
  provide: (f) => EditorView.decorations.from(f),
});
