// Markdown → 安全 HTML。支持基础 Wikilink、图片嵌入；YAML 属性单独显示；本地图片转为 asset 协议地址。
import { safeHtml } from "../lib/sanitize";
import { Marked, type TokenizerAndRendererExtension } from "marked";
import { resolveRelative } from "../lib/paths";
import { parseWikilink, type LinkResolution } from "../lib/links";

export interface RenderContext {
  notePath: string;
  resolveLink: (target: string) => LinkResolution;
  assetUrl: (relPath: string) => string;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

/** 拆出开头的 YAML 属性块（原样显示，不解析也不修改） */
export function splitFrontmatter(md: string): { frontmatter: string | null; body: string } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n?/.exec(md);
  if (!m) return { frontmatter: null, body: md };
  return { frontmatter: m[1], body: md.slice(m[0].length) };
}

const CALLOUT_ICONS: Record<string, string> = { note: "📝", tip: "💡", info: "ℹ️", warning: "⚠️", danger: "⛔", success: "✅", question: "❓", quote: "❝", todo: "☑️", abstract: "📋", example: "🔎" };

/** Obsidian 提示块：> [!note] 标题 → 带图标的框 */
export function calloutHtml(html: string): string {
  return html.replace(/<blockquote>\s*<p>\[!([a-zA-Z]+)\][-+]?[ \t]*([^\n<]*)(?:\n|<br>)?/g, (_m, type: string, title: string) => {
    const t = type.toLowerCase();
    return `<blockquote class="callout callout-${escapeHtml(t)}"><p class="callout-title">${CALLOUT_ICONS[t] ?? "📌"} ${escapeHtml(title.trim() || type)}</p><p>`;
  });
}

export function renderMarkdown(md: string, ctx: RenderContext): string {
  const wikilink: TokenizerAndRendererExtension = {
    name: "wikilink",
    level: "inline",
    start: (src) => src.match(/!?\[\[/)?.index,
    tokenizer(src) {
      const m = /^(!?)\[\[([^\]\n]+?)\]\]/.exec(src);
      if (!m) return undefined;
      return { type: "wikilink", raw: m[0], embed: m[1] === "!", inner: m[2] };
    },
    renderer(token) {
      const { target, alias, heading } = parseWikilink(token.inner as string);
      const res = ctx.resolveLink(target);
      const label = escapeHtml(alias ?? (heading ? `${target} › ${heading}` : target));
      if (token.embed && res.path && IMAGE_EXT.test(res.path)) {
        return `<img src="${escapeHtml(ctx.assetUrl(res.path))}" alt="${label}" />`;
      }
      const cls = ["wikilink", res.path ? "" : "unresolved", res.ambiguous ? "ambiguous" : ""].filter(Boolean).join(" ");
      const title = res.ambiguous ? `有多个同名文件，指向：${res.path}` : (res.path ?? "未找到笔记");
      return `<a class="${cls}" data-path="${escapeHtml(res.path ?? "")}" data-target="${escapeHtml(target)}" title="${escapeHtml(title)}">${label}</a>`;
    },
  };

  const tag: TokenizerAndRendererExtension = {
    name: "tag",
    level: "inline",
    start: (src) => src.match(/(^|\s)#[^\s#]/)?.index,
    tokenizer(src) {
      const m = /^(\s?)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/u.exec(src);
      if (!m) return undefined;
      return { type: "tag", raw: m[0], lead: m[1], name: m[2] };
    },
    renderer: (token) => `${token.lead}<span class="tag">#${escapeHtml(token.name as string)}</span>`,
  };

  // ==高亮==（Obsidian 写法）
  const highlight: TokenizerAndRendererExtension = {
    name: "highlight",
    level: "inline",
    start: (src) => src.indexOf("=="),
    tokenizer(src) {
      const m = /^==([^=\n]+)==/.exec(src);
      if (!m) return undefined;
      return { type: "highlight", raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
    },
    renderer(token) {
      return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`;
    },
  };

  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    extensions: [wikilink, tag, highlight],
    renderer: {
      image({ href, title, text }) {
        let src = href;
        if (!/^(https?:|data:)/i.test(href)) {
          const rel = resolveRelative(ctx.notePath, href);
          src = rel ? ctx.assetUrl(rel) : "";
        }
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ""} />`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const external = /^[a-z][a-z0-9+.-]*:/i.test(href);
        const rel = external ? null : resolveRelative(ctx.notePath, href);
        const attrs = external ? `data-external="${escapeHtml(href)}"` : `data-path="${escapeHtml(rel ?? "")}"`;
        return `<a ${attrs}${title ? ` title="${escapeHtml(title)}"` : ""}>${text}</a>`;
      },
    },
  });

  const { frontmatter, body } = splitFrontmatter(md);
  let html = "";
  if (frontmatter !== null) {
    html += `<details class="frontmatter"><summary>属性</summary><pre>${escapeHtml(frontmatter)}</pre></details>`;
  }
  html += calloutHtml(marked.parse(body, { async: false }) as string);
  return safeHtml(html, {
    addAttr: ["data-path", "data-target", "data-external", "target"],
    uriRegexp: /^(?:(?:https?|asset|data):|http:\/\/asset\.localhost|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}
