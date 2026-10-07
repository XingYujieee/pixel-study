// Word（.docx）读写：
// - 读取：mammoth 转为语义 HTML（标题、段落、粗斜体、列表、表格、图片、链接）
// - 写回：把编辑区 DOM 转为 docx（docx 库）
// 复杂排版（页眉页脚、批注、修订、文本框、公式等）无法完整往返，打开时检测并提示。
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import mammoth from "mammoth";
import JSZip from "jszip";

export interface DocxRead {
  html: string;
  /** 无法完整保留的内容（用于提示） */
  lossy: string[];
}

const LOSSY_CHECKS: [RegExp, string][] = [
  [/<w:headerReference|<w:footerReference/, "页眉页脚"],
  [/<w:commentReference/, "批注"],
  [/<w:ins |<w:del /, "修订记录"],
  [/<w:txbxContent/, "文本框"],
  [/<m:oMath/, "公式"],
  [/<w:fldChar|<w:instrText/, "域（目录、页码等）"],
  [/<w:sectPr[\s\S]*<w:sectPr/, "多节排版"],
  [/<w:footnoteReference|<w:endnoteReference/, "脚注尾注"],
  [/<w:jc w:val="(center|right|both)"/, "段落对齐"],
  [/<w:color w:val="(?!000000|auto)/, "文字颜色"],
  [/<w:sz w:val=/, "字号"],
];

export async function readDocx(bytes: Uint8Array): Promise<DocxRead> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const lossy: string[] = [];
  try {
    const zip = await JSZip.loadAsync(buf);
    const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
    for (const [re, label] of LOSSY_CHECKS) if (re.test(xml)) lossy.push(label);
    // 本应用写出的文件带有标记，样式都是我们支持的
    const app = (await zip.file("docProps/app.xml")?.async("string")) ?? "";
    if (app.includes("PixelStudy")) lossy.length = 0;
  } catch {
    // mammoth 会给出更明确的错误
  }
  // 浏览器版 mammoth 接受 arrayBuffer；测试环境（Node）用 buffer
  const NodeBuffer = (globalThis as { Buffer?: { from(b: ArrayBuffer): unknown } }).Buffer;
  const input = (NodeBuffer ? { buffer: NodeBuffer.from(buf) } : { arrayBuffer: buf }) as { arrayBuffer: ArrayBuffer };
  const result = await mammoth.convertToHtml(
    input,
    {
      styleMap: ["p[style-name='Quote'] => blockquote:fresh", "p[style-name='Intense Quote'] => blockquote:fresh", "u => u"],
    },
  );
  return { html: result.value || "<p></p>", lossy };
}

// ───────────────────────── 写出 ─────────────────────────

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
}

const FONT_BODY = { ascii: "Calibri", hAnsi: "Calibri", eastAsia: "PingFang SC" };
const FONT_CODE = { ascii: "Menlo", hAnsi: "Menlo", eastAsia: "PingFang SC" };

function runsOf(node: Node, style: RunStyle, out: ParagraphChild[], images: boolean) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ");
    if (!text) return;
    out.push(new TextRun(runOpts(text, style)));
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  const tag = node.tagName.toLowerCase();
  const s: RunStyle = { ...style };
  if (tag === "b" || tag === "strong") s.bold = true;
  if (tag === "i" || tag === "em") s.italics = true;
  if (tag === "u") s.underline = true;
  if (tag === "s" || tag === "strike" || tag === "del") s.strike = true;
  if (tag === "code") s.code = true;
  if (node.style?.fontWeight === "bold" || Number(node.style?.fontWeight) >= 600) s.bold = true;
  if (node.style?.fontStyle === "italic") s.italics = true;
  if (node.style?.textDecoration?.includes("underline")) s.underline = true;
  if (tag === "br") {
    out.push(new TextRun({ text: "", break: 1 }));
    return;
  }
  if (tag === "img") {
    if (images) {
      const img = imageRun(node as HTMLImageElement);
      if (img) out.push(img);
    }
    return;
  }
  if (tag === "a") {
    const href = node.getAttribute("href") ?? "";
    const children: ParagraphChild[] = [];
    node.childNodes.forEach((c) => runsOf(c, { ...s, underline: true }, children, images));
    if (/^(https?:|mailto:)/i.test(href)) {
      out.push(new ExternalHyperlink({ link: href, children: children as TextRun[] }));
    } else out.push(...children);
    return;
  }
  node.childNodes.forEach((c) => runsOf(c, s, out, images));
}

function runOpts(text: string, s: RunStyle): IRunOptions {
  return {
    text,
    bold: s.bold,
    italics: s.italics,
    underline: s.underline ? {} : undefined,
    strike: s.strike,
    font: s.code ? FONT_CODE : undefined,
    color: undefined,
  };
}

function imageRun(img: HTMLImageElement): ImageRun | null {
  const src = img.getAttribute("src") ?? "";
  const m = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i.exec(src);
  if (!m) return null;
  const type = m[1].toLowerCase().startsWith("jp") ? "jpg" : (m[1].toLowerCase() as "png" | "gif" | "bmp");
  const bin = atob(m[2]);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  const nw = img.naturalWidth || Number(img.getAttribute("width")) || 400;
  const nh = img.naturalHeight || Number(img.getAttribute("height")) || 300;
  const w = Math.min(560, nw);
  return new ImageRun({ type, data, transformation: { width: w, height: Math.round((nh * w) / nw) } });
}

function paragraph(el: Element, extra: Partial<ConstructorParameters<typeof Paragraph>[0] & object> = {}, style: RunStyle = {}): Paragraph {
  const children: ParagraphChild[] = [];
  el.childNodes.forEach((c) => {
    // 嵌套列表单独处理
    if (c instanceof HTMLElement && (c.tagName === "UL" || c.tagName === "OL")) return;
    runsOf(c, style, children, true);
  });
  return new Paragraph({ children, ...extra });
}

function listItems(list: HTMLElement, level: number, out: (Paragraph | Table)[]) {
  const ordered = list.tagName === "OL";
  for (const li of Array.from(list.children)) {
    if (li.tagName !== "LI") continue;
    out.push(
      paragraph(li, ordered ? { numbering: { reference: "ps-ordered", level } } : { bullet: { level } }),
    );
    for (const sub of Array.from(li.children)) {
      if (sub.tagName === "UL" || sub.tagName === "OL") listItems(sub as HTMLElement, Math.min(level + 1, 8), out);
    }
  }
}

function table(el: HTMLTableElement): Table {
  const rows = Array.from(el.rows).map(
    (tr) =>
      new TableRow({
        children: Array.from(tr.cells).map(
          (td) =>
            new TableCell({
              children: [paragraph(td, {}, td.tagName === "TH" ? { bold: true } : {})],
            }),
        ),
      }),
  );
  return new Table({ rows: rows.length ? rows : [new TableRow({ children: [new TableCell({ children: [new Paragraph("")] })] })], width: { size: 100, type: WidthType.PERCENTAGE } });
}

const HEADINGS: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  H1: HeadingLevel.HEADING_1,
  H2: HeadingLevel.HEADING_2,
  H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4,
  H5: HeadingLevel.HEADING_5,
  H6: HeadingLevel.HEADING_6,
};

/** 编辑区 DOM → 文档块 */
export function blocksFromDom(root: HTMLElement): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  const walk = (parent: Element) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        if ((node.textContent ?? "").trim()) out.push(new Paragraph({ children: [new TextRun(node.textContent!)] }));
        continue;
      }
      if (!(node instanceof HTMLElement)) continue;
      const tag = node.tagName;
      if (tag in HEADINGS) out.push(paragraph(node, { heading: HEADINGS[tag] }));
      else if (tag === "P") out.push(paragraph(node, alignOf(node)));
      else if (tag === "UL" || tag === "OL") listItems(node, 0, out);
      else if (tag === "BLOCKQUOTE") {
        const inner = Array.from(node.children);
        if (inner.length && inner.every((c) => c.tagName === "P")) inner.forEach((c) => out.push(paragraph(c, { style: "Quote" })));
        else out.push(paragraph(node, { style: "Quote" }));
      } else if (tag === "PRE") {
        for (const line of (node.textContent ?? "").split("\n")) out.push(new Paragraph({ children: [new TextRun(runOpts(line, { code: true }))] }));
      } else if (tag === "TABLE") out.push(table(node as HTMLTableElement));
      else if (tag === "HR") out.push(new Paragraph({ thematicBreak: true }));
      else if (tag === "DIV" || tag === "SECTION" || tag === "ARTICLE") walk(node);
      else out.push(paragraph(node));
    }
  };
  walk(root);
  if (out.length === 0) out.push(new Paragraph(""));
  return out;
}

function alignOf(el: HTMLElement): { alignment?: (typeof AlignmentType)[keyof typeof AlignmentType] } {
  const a = el.style.textAlign;
  if (a === "center") return { alignment: AlignmentType.CENTER };
  if (a === "right") return { alignment: AlignmentType.RIGHT };
  if (a === "justify") return { alignment: AlignmentType.JUSTIFIED };
  return {};
}

export async function writeDocx(root: HTMLElement): Promise<Uint8Array> {
  const doc = new Document({
    creator: "像素书房",
    description: "PixelStudy",
    styles: {
      default: { document: { run: { font: FONT_BODY, size: 22 }, paragraph: { spacing: { after: 120, line: 300 } } } },
      paragraphStyles: [
        {
          id: "Quote",
          name: "Quote",
          basedOn: "Normal",
          next: "Normal",
          run: { italics: true, color: "666666" },
          paragraph: { indent: { left: 480 } },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "ps-ordered",
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 420 * (level + 1), hanging: 260 } } },
          })),
        },
      ],
    },
    sections: [{ children: blocksFromDom(root) }],
  });
  let bytes: Uint8Array = await JSZip.loadAsync(await Packer.toBase64String(doc), { base64: true }).then((z) =>
    z.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
  );
  // 在 docProps/app.xml 中写入应用标记，下次打开时不再提示格式损失
  try {
    const zip = await JSZip.loadAsync(bytes);
    const app = (await zip.file("docProps/app.xml")?.async("string")) ?? "";
    if (app && !app.includes("PixelStudy")) {
      zip.file("docProps/app.xml", app.replace(/<Application>[^<]*<\/Application>|(<\/Properties>)/, (_m, end) => (end ? `<Application>PixelStudy</Application>${end}` : "<Application>PixelStudy</Application>")));
      bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    }
  } catch {
    // 标记失败不影响内容
  }
  return bytes;
}

/** 新建空白 Word 文档 */
export async function emptyDocx(title: string): Promise<Uint8Array> {
  const div = document.createElement("div");
  const h = document.createElement("h1");
  h.textContent = title;
  div.append(h, document.createElement("p"));
  return writeDocx(div);
}
