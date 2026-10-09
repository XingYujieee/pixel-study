// 宣传片的字幕卡、标题卡、片尾卡：用书房里的像素字体在浏览器里排版，截成透明 PNG；顺便导出几张唱片封面。
// 用法：node scripts/promo/cards.mjs <输出目录>（开发服务器要在 1430 端口）
import fs from "node:fs";
import path from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await page.goto("http://localhost:1430/src/assets/fonts/fusion-pixel/OFL.txt");

const CSS = `
  @import url("http://localhost:1430/src/assets/fonts/fusion-pixel/font.css");
  html, body { margin: 0; background: transparent; width: 1280px; height: 720px; overflow: hidden; }
  * { box-sizing: border-box; -webkit-font-smoothing: none; font-smooth: never; }
  .px { font-family: "Fusion Pixel", monospace; color: #fff7e6; }
  .shadow { text-shadow: 3px 3px 0 #2a1a10; }
  .cap { position: absolute; left: 56px; bottom: 136px; display: flex; flex-direction: column; gap: 10px; }
  .cap .zh { font-size: 36px; line-height: 1; letter-spacing: 1px; }
  .cap .en { font-size: 20px; color: #ffd98a; line-height: 1; letter-spacing: 1px; }
  .cap .box { padding: 18px 26px 18px 22px; background: rgba(20, 12, 6, 0.72); border-left: 8px solid #ffd27a; box-shadow: 6px 6px 0 rgba(0,0,0,0.35); display: flex; flex-direction: column; gap: 12px; }
  .center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .tag { position: absolute; right: 56px; top: 48px; padding: 10px 18px; background: rgba(20,12,6,0.75); font-size: 26px; border: 3px solid #ffd27a; box-shadow: 4px 4px 0 rgba(0,0,0,0.4); }
`;

async function shot(name, html, opts = {}) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}</body></html>`);
  await page.evaluate(async () => {
    await document.fonts.load('36px "Fusion Pixel"', "像素书房笔记 Pixel Study");
    await document.fonts.ready;
  });
  await page.waitForTimeout(150);
  let extra = null;
  if (opts.measure) extra = await page.evaluate(opts.measure);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), omitBackground: true });
  return extra;
}

const meta = {};

// 冷开场：两行字，量出每个字的右边界（后期按字显示，做打字机效果）
const measure = () =>
  [...document.querySelectorAll(".line")].map((l) => ({
    top: Math.floor(l.getBoundingClientRect().top),
    bottom: Math.ceil(l.getBoundingClientRect().bottom),
    left: Math.floor(l.querySelector("span").getBoundingClientRect().left),
    chars: [...l.querySelectorAll("span")].map((s) => Math.ceil(s.getBoundingClientRect().right)),
  }));
const spans = (t) => [...t].map((c) => `<span>${c}</span>`).join("");
meta.cold = await shot(
  "cold",
  `<div class="center px" style="gap:12px">
     <div class="line" style="font-size:48px">${spans("笔记越写越多，")}</div>
     <div class="line" style="font-size:22px;color:#ffd98a">${spans("Notes keep piling up,")}</div>
     <div style="height:28px"></div>
     <div class="line" style="font-size:48px">${spans("它们住在哪里？")}</div>
     <div class="line" style="font-size:22px;color:#ffd98a">${spans("but where do they actually live?")}</div>
   </div>`,
  { measure },
);

// 标题卡
const icon = fs.readFileSync(path.join(ROOT, "src-tauri/icons/128x128.png")).toString("base64");
await shot(
  "title",
  `<div class="center px shadow" style="gap:18px">
     <img src="data:image/png;base64,${icon}" style="width:96px;height:96px;image-rendering:pixelated;filter:drop-shadow(4px 4px 0 #2a1a10)" />
     <div style="font-size:96px;letter-spacing:8px;line-height:1">像素书房</div>
     <div style="font-size:30px;letter-spacing:10px;color:#ffd98a">PIXEL · STUDY</div>
     <div style="font-size:24px;margin-top:10px;padding:10px 22px;background:rgba(20,12,6,.6)">把笔记放进一间可以走进去的书房</div>
   </div>`,
);

const CAPS = {
  shelf: ["每个书架，都是一个真实的文件夹", "Every shelf is a real folder on your disk"],
  write: ["像 Notion 一样写，存成普通 Markdown", "Write like Notion. Save as plain, Obsidian-friendly Markdown"],
  butler: ["管家小鸟：找书、带路、整理书架", "A butler bird that finds, guides and tidies"],
  records: ["你的音乐变成唱片，放上留声机", "Your music becomes vinyl. Drop the needle."],
  covers: ["封面按专辑名，画成像素画", "Every cover is pixel art drawn from the album name"],
  garden: ["推开门是花园，自己种一棵树", "Step outside and plant your own garden"],
  timelapse: ["昼夜、天气、音乐，都是现场生成的", "Day, night, weather and music, all generated live"],
  themes: ["七种屋子，随时换", "Seven rooms, swap any time"],
};
for (const [k, [zh, en]] of Object.entries(CAPS)) {
  meta[`cap_${k}`] = await shot(`cap_${k}`, `<div class="cap px"><div class="box shadow"><div class="zh">${zh}</div><div class="en">${en}</div></div></div>`, {
    measure: () => {
      const r = document.querySelector(".box").getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    },
  });
}

const THEMES = [
  ["书房", "Study"],
  ["林间木屋", "Cabin"],
  ["塔楼图书馆", "Tower"],
  ["海边灯塔", "Lighthouse"],
  ["和室", "Washitsu"],
  ["极简白屋", "Minimal"],
  ["地下书库", "Cellar"],
];
for (let i = 0; i < THEMES.length; i++) await shot(`theme_${i}`, `<div class="tag px shadow">${THEMES[i][0]} <span style="color:#ffd98a;font-size:18px">${THEMES[i][1]}</span></div>`);

// 片尾
await shot(
  "end",
  `<div class="center px shadow" style="gap:16px">
     <img src="data:image/png;base64,${icon}" style="width:80px;height:80px;image-rendering:pixelated;filter:drop-shadow(4px 4px 0 #2a1a10)" />
     <div style="font-size:72px;letter-spacing:6px;line-height:1">像素书房</div>
     <div style="font-size:24px;letter-spacing:8px;color:#ffd98a">PIXEL · STUDY</div>
     <div style="font-size:22px;margin-top:18px;line-height:1.8">本地优先 · 与 Obsidian 共用笔记库 · MIT 开源<br/><span style="color:#ffd98a;font-size:18px">Local-first · Obsidian-compatible · MIT licensed</span></div>
     <div style="font-size:22px;margin-top:20px;padding:10px 20px;background:rgba(20,12,6,.7);border:3px solid #ffd27a">github.com/XingYujieee/pixel-study</div>
   </div>`,
);

// 唱片封面
await page.goto("http://localhost:1430/");
await page.waitForTimeout(2500);
const names = [
  ["夏夜晚风", "鹿野"], ["雨天的书店", "小林"], ["星河漫游", "Orbit Kid"], ["海边的夏天", "潮汐乐队"],
  ["森林咖啡馆", "Lo-fi 小屋"], ["冬天的雪", "北岛"], ["城市霓虹", "Night Drive"], ["钢琴小品集", "木木"],
  ["猫咪午睡", "喵喵"], ["Golden Hour", "Sunny"], ["远山", "旅人"], ["花园里的春天", "小满"],
  ["我爱你", "某某"], ["篝火", "营地"], ["Midnight Tape", "Lo"], ["无题", "匿名"],
];
const urls = await page.evaluate(async (names) => {
  const m = await import("/src/world/cover.ts");
  return names.map(([t, a]) => m.coverDataUrl(t, a, 0));
}, names);
fs.mkdirSync(path.join(OUT, "covers"), { recursive: true });
urls.forEach((u, i) => fs.writeFileSync(path.join(OUT, "covers", `${i}.png`), Buffer.from(u.split(",")[1], "base64")));
meta.covers = names;
fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 1));
await browser.close();
console.log("cards ok");
