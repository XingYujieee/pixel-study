#!/usr/bin/env node
// 生成中文测试库：多级目录、YAML 属性、Wikilink、标签、图片引用、CRLF 文件、同名笔记。
// 用法：node scripts/gen-test-vault.mjs [目标目录=test-vault] [篇数=1000]
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "test-vault";
const count = Number(process.argv[3] ?? 1000);
if (existsSync(join(root, ".generated"))) {
  console.error(`${root} 已存在测试库，先删除再生成`);
  process.exit(1);
}

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const topics = ["读书", "工作", "日记", "学习/机器学习", "学习/可持续发展", "项目/像素书房", "旅行", "随笔", "资料/论文"];
const words = "今天 我们 讨论 了 关于 能源 消耗 与 模型 训练 的 问题 数据 中心 碳排放 估算 方法 需要 进一步 验证 书房 窗户 灯光 木头 书架 笔记 阅读 写作 思考 记录 整理 计划 回顾 实验 结果 参数 效率 城市 雨天 咖啡 散步".split(" ");
const tags = ["#读书", "#待办", "#想法", "#论文", "#AI/能耗", "#生活"];

const sentence = () => {
  const n = 8 + Math.floor(rand() * 18);
  return Array.from({ length: n }, () => pick(words)).join("") + "。";
};

// 1×1 PNG
const png = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360f8cfc0f01f0005000201e2c2d2e30000000049454e44ae426082",
  "hex",
);

mkdirSync(join(root, ".obsidian"), { recursive: true });
writeFileSync(join(root, ".obsidian", "app.json"), JSON.stringify({ newFileFolderPath: "Notes" }, null, 2));
mkdirSync(join(root, "附件"), { recursive: true });
writeFileSync(join(root, "附件", "封面 图.png"), png);

const titles = [];
for (let i = 0; i < count; i++) {
  const dir = topics[i % topics.length];
  const title = `${dir.split("/").pop()}笔记 ${String(i + 1).padStart(4, "0")}`;
  titles.push({ dir, title });
}

titles.forEach(({ dir, title }, i) => {
  mkdirSync(join(root, dir), { recursive: true });
  const linkA = pick(titles).title;
  const linkB = pick(titles).title;
  const paras = Array.from({ length: 3 + Math.floor(rand() * 6) }, () =>
    Array.from({ length: 2 + Math.floor(rand() * 4) }, sentence).join(""),
  );
  const depth = dir.split("/").length;
  const up = "../".repeat(depth);
  let body =
    `---\ntitle: ${title}\ntags: [${pick(tags).slice(1)}]\ncreated: 2026-0${1 + (i % 9)}-1${i % 10}\n---\n\n` +
    `# ${title}\n\n${paras[0]} 参见 [[${linkA}]] 和 [[${linkB}|另一篇]]。${pick(tags)}\n\n` +
    `## 要点\n\n- [ ] ${sentence()}\n- [x] ${sentence()}\n- ${sentence()}\n\n` +
    paras.slice(1).join("\n\n") +
    `\n\n> ${sentence()}\n\n`;
  if (i % 25 === 0) body += `![封面](${up}附件/封面%20图.png)\n\n![[封面 图.png]]\n\n`;
  if (i % 40 === 0) body += "```python\nprint('训练耗能估算')\n```\n\n| 模型 | 能耗 |\n| --- | --- |\n| A | 12 kWh |\n";
  if (i % 50 === 0) body += `\n块引用 ^b${i}\n`;
  if (i % 97 === 0) body = body.replace(/\n/g, "\r\n"); // 部分 CRLF 文件
  writeFileSync(join(root, dir, `${title}.md`), body);
});

// 同名笔记（测试链接歧义）、纯文本、其他文件
mkdirSync(join(root, "重名A"), { recursive: true });
mkdirSync(join(root, "重名B"), { recursive: true });
writeFileSync(join(root, "重名A", "索引.md"), "# 索引 A\n\n[[索引]]\n");
writeFileSync(join(root, "重名B", "索引.md"), "# 索引 B\n");
writeFileSync(join(root, "待办.txt"), "买咖啡豆\n整理书架\n");
writeFileSync(join(root, "资料", "示例.pdf"), "%PDF-1.4\n%占位\n");
writeFileSync(join(root, ".generated"), new Date().toISOString());
console.log(`已在 ${root} 生成 ${count} 篇笔记`);
