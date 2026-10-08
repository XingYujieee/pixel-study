import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { blockCmd, colorCmd, insertBlock, insertTable, tableTab, wrapCmd } from "./mdCommands";

let view: EditorView;
afterEach(() => view?.destroy());
function editor(doc: string, br: string) {
  view = new EditorView({ state: EditorState.create({doc, extensions: [EditorState.lineSeparator.of(br), history()]}), parent: document.body });
  return view;
}

describe.each(["\n", "\r\n"])("Markdown commands with %j line endings", (br) => {
  it("keeps multiline color replacements as real document lines", () => {
    editor(["第一行", "第二行"].join(br), br);
    view.dispatch({selection: {anchor: 0, head: view.state.doc.length}});
    colorCmd("#ff0000")(view);
    expect(view.state.doc.lines).toBe(2);
    expect(view.state.sliceDoc()).toBe(`<span style="color:#ff0000">第一行${br}第二行</span>`);
    colorCmd(null)(view);
    expect(view.state.sliceDoc()).toBe(`第一行${br}第二行`);
  });
  it("unwraps a multiline selection without embedding raw LF in a CRLF line", () => {
    editor(`**第一行${br}第二行**`, br);
    view.dispatch({selection: {anchor: 0, head: view.state.doc.length}});
    wrapCmd("bold")(view);
    expect(view.state.doc.lines).toBe(2);
    expect(view.state.sliceDoc()).toBe(`第一行${br}第二行`);
  });
  it("formats multiple selected lines and undoes without changing line endings", () => {
    editor(["第一行", "第二行", "第三行"].join(br), br);
    view.dispatch({selection: {anchor: 0, head: view.state.doc.length}});
    expect(() => blockCmd("bullet")(view)).not.toThrow();
    expect(view.state.sliceDoc()).toBe(["- 第一行", "- 第二行", "- 第三行"].join(br));
    expect(undo(view)).toBe(true);
    expect(view.state.sliceDoc()).toBe(["第一行", "第二行", "第三行"].join(br));
  });
  it("inserts multiline snippets with the caret on the intended line", () => {
    editor("已有正文", br);
    insertBlock(view, "```\n\n```", 4);
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("");
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(4);
    expect(view.state.sliceDoc()).toBe(["已有正文", "", "```", "", "```"].join(br));
  });
  it("inserts a callout at EOF without an invalid cursor", () => {
    editor("", br);
    expect(() => insertBlock(view, "> [!note] 提示\n> ")).not.toThrow();
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });
  it("selects the intended table cell across rows and appends a last row", () => {
    editor("", br);
    insertTable(view, 2, 1);
    tableTab(1)(view);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("列 2");
    tableTab(1)(view);
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(3);
    const line = view.state.doc.line(3);
    expect(view.state.selection.main.head - line.from).toBe(2);
    tableTab(1)(view);
    expect(() => tableTab(1)(view)).not.toThrow();
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(4);
    expect(view.state.selection.main.head - view.state.doc.line(4).from).toBe(2);
  });
});
