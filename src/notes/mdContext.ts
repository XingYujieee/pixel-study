import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/** Code and YAML are literal text, not places for prose formatting or slash commands. */
export function isLiteralMarkdown(state: EditorState, pos: number): boolean {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent!) {
    if (["FencedCode", "CodeBlock", "InlineCode", "Frontmatter"].includes(node.name)) return true;
  }
  return false;
}
