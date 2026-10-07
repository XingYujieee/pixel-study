import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { HighlightStyle, indentOnInput, syntaxHighlighting, bracketMatching } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder, type ViewUpdate, highlightActiveLine } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { zhPhrases } from "./phrases";
import { markdownTools } from "./mdUi";
import { livePreview, tableField } from "./livePreview";

const proseHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.6em", fontWeight: "700", color: "var(--ink-strong)" },
  { tag: t.heading2, fontSize: "1.35em", fontWeight: "700", color: "var(--ink-strong)" },
  { tag: t.heading3, fontSize: "1.15em", fontWeight: "700", color: "var(--ink-strong)" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "700", color: "var(--ink-strong)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--ink-muted)" },
  { tag: t.link, color: "var(--accent-ink)", textDecoration: "underline" },
  { tag: t.url, color: "var(--accent-ink)" },
  { tag: t.monospace, fontFamily: "var(--font-mono)", color: "var(--code-ink)" },
  { tag: t.quote, color: "var(--ink-muted)", fontStyle: "italic" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--ink-faint)" },
  { tag: t.definition(t.propertyName), color: "var(--syn-func)" },
  { tag: [t.keyword, t.operator], color: "var(--syn-keyword)" },
  { tag: [t.string, t.special(t.string)], color: "var(--syn-string)" },
  { tag: [t.number, t.bool, t.null], color: "var(--syn-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--ink-faint)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.propertyName], color: "var(--syn-func)" },
  { tag: [t.typeName, t.className], color: "var(--syn-type)" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--editor-size)", color: "var(--ink)", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-text)", lineHeight: "1.75", overflow: "auto" },
  ".cm-content": {
    maxWidth: "var(--measure)",
    margin: "0 auto",
    padding: "40px 32px 40vh",
    caretColor: "var(--accent)",
  },
  ".cm-line": { padding: "0 2px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection)",
  },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
  ".cm-placeholder": { color: "var(--ink-faint)" },
  ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--ink)", borderColor: "var(--rule)" },
  ".cm-searchMatch": { backgroundColor: "var(--search-match)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--search-match-strong)" },
  ".cm-selectionMatch": { backgroundColor: "var(--selection-match)" },
  ".cm-textfield, .cm-button": { fontFamily: "var(--font-ui)" },
});

export interface SetupOptions {
  kind: "markdown" | "text";
  lineSeparator: "\n" | "\r\n";
  onUpdate: (u: ViewUpdate) => void;
  extraKeys?: Extension;
}

export function editorExtensions(o: SetupOptions): Extension[] {
  const ext: Extension[] = [
    history(),
    drawSelection(),
    highlightActiveLine(),
    indentOnInput(),
    bracketMatching(),
    highlightSelectionMatches(),
    search({ top: true }),
    EditorView.lineWrapping,
    EditorState.allowMultipleSelections.of(true),
    placeholder(o.kind === "markdown" ? "从这里开始写…" : "纯文本"),
    o.extraKeys ?? [],
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    theme,
    zhPhrases,
    EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off", lang: "zh-CN" }),
    EditorView.updateListener.of(o.onUpdate),
  ];
  if (o.lineSeparator === "\r\n") ext.push(EditorState.lineSeparator.of("\r\n"));
  if (o.kind === "markdown") {
    // YAML 属性块按 YAML 高亮，不会被误认为 Setext 标题
    ext.push(
      yamlFrontmatter({ content: markdown({ base: markdownLanguage, codeLanguages: languages }) }),
      syntaxHighlighting(proseHighlight),
      markdownTools(),
      livePreview,
      tableField,
    );
  }
  return ext;
}
