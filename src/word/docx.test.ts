import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readDocx, writeDocx } from "./docx";

function dom(html: string): HTMLElement {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d;
}

describe("Word 往返", () => {
  it("标题、粗斜体、列表、引用、表格保留", async () => {
    const bytes = await writeDocx(
      dom(
        "<h1>读书笔记</h1><p>正文 <b>粗体</b> <i>斜体</i> <u>下划线</u></p>" +
          "<ul><li>第一项<ul><li>子项</li></ul></li><li>第二项</li></ul><ol><li>步骤</li></ol>" +
          "<blockquote><p>引用一句</p></blockquote><table><tr><th>模型</th><th>能耗</th></tr><tr><td>A</td><td>12</td></tr></table>",
      ),
    );
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file("word/document.xml")).toBeTruthy();
    const { html, lossy } = await readDocx(bytes);
    expect(lossy).toEqual([]);
    expect(html).toContain("<h1>读书笔记</h1>");
    expect(html).toMatch(/<strong>粗体<\/strong>/);
    expect(html).toMatch(/<em>斜体<\/em>/);
    expect(html).toContain("<li>子项</li>");
    expect(html).toContain("<ol><li>步骤</li></ol>");
    expect(html).toContain("<blockquote>引用一句</blockquote>");
    expect(html).toContain("<table>");
    expect(html).toContain("能耗");
  });

  it("第二次往返内容不变", async () => {
    const first = await readDocx(await writeDocx(dom("<h2>标题</h2><p>一段 <strong>文字</strong></p><ul><li>x</li></ul>")));
    const second = await readDocx(await writeDocx(dom(first.html)));
    expect(second.html).toBe(first.html);
  });
});
