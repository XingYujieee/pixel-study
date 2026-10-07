// 鱼饵（模板）：工作台做新书时选一个起手格式。
// 模板就是库里模板文件夹下的普通文件，变量写法与 Obsidian「模板」插件一致：
// {{title}}、{{date}}、{{time}}、{{date:YYYY年M月D日}}、{{time:HH:mm}}。

import type { FileEntry } from "../ipc";

export interface Template {
  /** builtin:xxx 或库内路径 */
  id: string;
  name: string;
  desc: string;
  /** 内置模板的正文；库内模板为 null，用时再读取 */
  body: string | null;
}

export const DEFAULT_TEMPLATE_DIR = "Templates";

export const BUILTIN_TEMPLATES: Template[] = [
  { id: "builtin:blank", name: "空白", desc: "只有书名", body: "# {{title}}\n\n" },
  {
    id: "builtin:literature",
    name: "文献卡片",
    desc: "作者、年份、方法、结论、与我的研究",
    body: `---
type: 文献
authors:
year:
venue:
doi:
tags:
  - 文献
created: {{date}}
---

# {{title}}

## 一句话总结


## 研究问题


## 方法与数据


## 主要结论


## 局限


## 与我的研究的关系


## 摘录
>\u0020

`,
  },
  {
    id: "builtin:reading",
    name: "读书笔记",
    desc: "书目信息、摘录、我的想法",
    body: `---
type: 读书
author:
tags:
  - 读书
created: {{date}}
---

# {{title}}

## 为什么读


## 摘录与页码
-\u0020

## 我的想法


## 还想继续追问的

`,
  },
  {
    id: "builtin:meeting",
    name: "会议记录",
    desc: "参与者、议题、决定、待办",
    body: `# {{title}}

- 时间：{{date}} {{time}}
- 参与者：

## 议题


## 决定


## 待办
- [ ]\u0020
`,
  },
  {
    id: "builtin:journal",
    name: "日记",
    desc: "今天做了什么、想到什么",
    body: `# {{date:YYYY年M月D日}}

## 今天做了


## 想到的


## 明天

`,
  },
];

const pad = (n: number) => String(n).padStart(2, "0");

/** 支持 YYYY YY MM M DD D HH H mm ss，其他字符原样保留（[] 内为字面文字） */
export function formatDate(d: Date, fmt: string): string {
  const tokens: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(-2),
    MM: pad(d.getMonth() + 1),
    M: String(d.getMonth() + 1),
    DD: pad(d.getDate()),
    D: String(d.getDate()),
    HH: pad(d.getHours()),
    H: String(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  };
  return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MM|M|DD|D|HH|H|mm|ss/g, (m, lit: string | undefined) => (lit !== undefined ? lit : tokens[m]));
}

/** 替换模板变量 */
export function applyTemplate(body: string, ctx: { title: string; now: Date }): string {
  return body.replace(/\{\{\s*(title|date|time)\s*(?::([^}]*))?\}\}/gi, (_m, name: string, fmt: string | undefined) => {
    const n = name.toLowerCase();
    if (n === "title") return ctx.title;
    if (n === "date") return formatDate(ctx.now, fmt?.trim() || "YYYY-MM-DD");
    return formatDate(ctx.now, fmt?.trim() || "HH:mm");
  });
}

/** 库内模板文件夹里的模板（Markdown / TXT） */
export function vaultTemplates(files: Iterable<FileEntry>, dir: string): Template[] {
  const prefix = `${dir.replace(/\/+$/, "")}/`;
  const out: Template[] = [];
  for (const f of files) {
    if (!f.path.startsWith(prefix) || (f.kind !== "markdown" && f.kind !== "text")) continue;
    out.push({ id: f.path, name: f.name.replace(/\.(md|markdown|txt)$/i, ""), desc: f.path, body: null });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true }));
}
