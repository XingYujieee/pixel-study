// 用无头 Chromium 打开开发服务器并截图：node scripts/e2e/shot.mjs <输出.png> [动作脚本.js]
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";
const out = process.argv[2] ?? "shot.png";
const actions = process.argv[3] ? readFileSync(process.argv[3], "utf8") : "";
const files = {
  "读书/三体.md": "# 三体\n\n读书笔记。",
  "读书/活着.md": "# 活着\n",
  "读书/百年孤独.md": "# 百年孤独\n",
  "读书/小说/围城.md": "# 围城\n",
  "工作/周报.docx": "",
  "工作/会议记录.md": "# 会议\n",
  "工作/计划.txt": "计划",
  "学习/机器学习/笔记.md": "# ML\n",
  "论文/能耗综述.pdf": "%PDF",
  "根目录笔记.md": "# hi",
};
for (let i = 0; i < 40; i++) files[`读书/书目 ${i}.md`] = `# 书 ${i}`;
// 引用关系：很多笔记链接到《三体》《活着》→ 书脊发亮
for (let i = 0; i < 10; i++) files[`读书/书目 ${i}.md`] += "\n\n参见 [[三体]]" + (i < 4 ? " 和 [[活着]]" : "");
// 灵感池
files["Inbox/把天气和待办挂钩.md"] = "---\ncreated: 2026-09-20T10:00\ntags:\n  - 灵感\n---\n\n把天气和待办挂钩：待处理多了就下雨。";
files["Inbox/鱼塘冒泡.md"] = "---\ntags:\n  - 灵感\n---\n\n旧灵感偶尔浮上来，不打扰。";
files["Inbox/文献卡片模板.md"] = "文献卡片要有作者、年份、方法、与我的研究的关系。";
const DAY = 86400000;
const mtime = {
  "Inbox/把天气和待办挂钩.md": Date.now() - 15 * DAY,
  "Inbox/鱼塘冒泡.md": Date.now() - 2 * 3600000,
  "Inbox/文献卡片模板.md": Date.now() - 6 * DAY,
};
// 很久没碰的书 → 蒙灰
for (let i = 10; i < 40; i += 2) mtime[`读书/书目 ${i}.md`] = Date.now() - (80 + i * 6) * DAY;
mtime["读书/百年孤独.md"] = Date.now() - 400 * DAY;
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
await page.addInitScript(`window.__MOCK_FILES__ = ${JSON.stringify(files)}; window.__MOCK_MTIME__ = ${JSON.stringify(mtime)};`);
await page.addInitScript({ path: new URL("./mock-tauri.js", import.meta.url).pathname });
await page.goto("http://localhost:1420/", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
if (actions) await eval(`(async () => { ${actions} })()`);
if (!process.env.NOSHOT) await page.screenshot({ path: out, timeout: 300000 });
console.log(logs.filter((l) => !l.includes("[vite]")).slice(-25).join("\n"));
await browser.close();
