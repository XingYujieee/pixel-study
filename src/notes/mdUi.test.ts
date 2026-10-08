import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorExtensions } from "./editorSetup";
import { setLivePreview } from "./livePreview";

Element.prototype.scrollIntoView = () => {};
let view: EditorView;
afterEach(() => view?.destroy());
function editor(doc: string, at: number) {
  view = new EditorView({state: EditorState.create({doc, selection: {anchor: at}, extensions: editorExtensions({kind: "markdown", lineSeparator: "\n", onUpdate: () => {}})}), parent: document.body});
  setLivePreview(view, true);
}
const settle = () => new Promise(resolve => setTimeout(resolve, 50));

describe("Markdown literal contexts", () => {
  it.each(["```js\nHERE\n```", "~~~\nHERE\n~~~", "    HERE", "`HERE`", "---\npath: HERE\n---\n正文"])("does not open slash commands in %s", async template => {
    const at = template.indexOf("HERE");
    const doc = template.replace("HERE", "");
    editor(doc, at);
    view.dispatch({changes: {from: at, insert: "/"}, selection: {anchor: at + 1}, userEvent: "input.type"});
    await settle();
    expect(view.dom.querySelector(".md-slash")).toBeNull();
  });
  it("still opens slash commands in prose", async () => {
    editor("正文 ", 3);
    view.dispatch({changes: {from: 3, insert: "/"}, selection: {anchor: 4}, userEvent: "input.type"});
    await settle();
    expect(view.dom.querySelector(".md-slash")).not.toBeNull();
  });
  it.each(["```\n==literal== [[link]] <u>text</u>\n```\n\n正文", "---\naliases: ['==literal==', '[[link]]', '<u>text</u>']\n---\n\n正文", "`==literal== [[link]] <u>text</u>`\n\n正文"])("leaves literal code and YAML visually intact", template => {
    editor(template, template.length);
    expect(view.dom.querySelector(".md-hl, .md-wikilink, .md-u")).toBeNull();
    expect(view.state.doc.toString()).toBe(template);
  });
});
