import { describe, expect, it } from "vitest";
import { buildLinkIndex, resolveWikilink } from "../lib/links";
import { renderMarkdown, splitFrontmatter } from "./markdown";

const paths = ["读书/三体.md", "附件/图.png", "读书/笔记.md"];
const idx = buildLinkIndex(paths);
const ctx = {
  notePath: "读书/笔记.md",
  resolveLink: (t: string) => resolveWikilink(t, "读书/笔记.md", idx, (p) => paths.includes(p)),
  assetUrl: (rel: string) => `asset://localhost/vault/${encodeURIComponent(rel)}`,
};

describe("markdown", () => {
  it("YAML 属性单独显示，不进入正文", () => {
    const { frontmatter, body } = splitFrontmatter("---\ntags: [a]\n---\n# 标题\n");
    expect(frontmatter).toBe("tags: [a]");
    expect(body).toBe("# 标题\n");
    const html = renderMarkdown("---\ntags: [a]\n---\n# 标题\n", ctx);
    expect(html).toContain('class="frontmatter"');
    expect(html).toContain("<h1");
  });

  it("Wikilink、嵌入图片、标签、相对图片", () => {
    const html = renderMarkdown("见 [[三体|那本书]] 和 [[没有]] #读书\n\n![[图.png]]\n\n![x](../附件/图.png)", ctx);
    expect(html).toContain('data-path="读书/三体.md"');
    expect(html).toContain(">那本书</a>");
    expect(html).toContain('class="wikilink unresolved"');
    expect(html).toContain('<span class="tag">#读书</span>');
    expect(html.match(/<img src="asset:\/\/localhost\/vault\/%E9%99%84%E4%BB%B6%2F%E5%9B%BE.png"/g)?.length).toBe(2);
  });

  it("清除脚本", () => {
    const html = renderMarkdown('<script>alert(1)</script><img src=x onerror="alert(1)">', ctx);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
  });
});

import { calloutHtml, renderMarkdown as render2 } from "./markdown";
describe("高亮与提示框", () => {
  const ctx = { notePath: "a.md", resolveLink: () => ({ path: null, ambiguous: false }), assetUrl: (p: string) => p };
  it("==高亮== 变成 mark，<u> 保留", () => {
    const h = render2("这是 ==重点== 和 <u>下划线</u>", ctx as never);
    expect(h).toContain("<mark>重点</mark>");
    expect(h).toContain("<u>下划线</u>");
  });
  it("Obsidian 提示块", () => {
    const h = render2("> [!tip] 小技巧\n> 内容", ctx as never);
    expect(h).toContain('class="callout callout-tip"');
    expect(h).toContain("小技巧");
    expect(calloutHtml("<p>x</p>")).toBe("<p>x</p>");
  });
});
