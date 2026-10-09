// 宣传片拍摄脚本：在无头 Chromium 里打开开发服务器（模拟后端），按分镜一帧一帧拍。
// 3D 画面用 canvas.toDataURL 取（640×360，后期放大两倍保持像素感），界面（HUD、面板）只在变化时截一张透明图叠上去。
// 用法：先 pnpm dev --port 1430，再 node scripts/promo/director.mjs <输出目录> [镜头名...]   PREVIEW=1 只存每个镜头的首、中、尾三帧
// 需要 Playwright（PLAYWRIGHT 环境变量可指定 playwright 的 index.mjs 路径）
const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
import fs from "node:fs";
import path from "node:path";

const OUT = process.argv[2];
const ONLY = process.argv.slice(3);
const PREVIEW = !!process.env.PREVIEW;
const FPS = 24;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const MOCK = path.join(ROOT, "scripts/e2e/mock-tauri.js");

/** 模拟的音频：3 秒 440Hz 正弦波（留声机要"在放"才会冒音符） */
function toneWav() {
  const sr = 22050, n = sr * 3;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / sr)), 44 + i * 2);
  return buf;
}

// ───────── 模拟的笔记库 ─────────
const files = {};
const books = ["三体", "活着", "百年孤独", "人类简史", "小王子", "围城", "红楼梦", "一九八四", "挪威的森林", "平凡的世界", "解忧杂货店", "月亮与六便士", "追风筝的人", "白夜行", "瓦尔登湖", "局外人", "边城", "呼兰河传", "沉默的大多数", "万历十五年", "苏菲的世界", "牧羊少年奇幻之旅"];
books.forEach((b, i) => (files[`读书笔记/${b}.md`] = `# ${b}\n\n读书笔记。${i < 8 ? "\n\n参见 [[三体]] 与 [[活着]]" : ""}`));
files["读书笔记/三体.md"] = "# 三体 · 读书笔记\n\n人类文明的命运，被一次不经意的回应改变。\n\n> [!tip] 读后\n> 黑暗森林法则是全书最锋利的设定。";
["文献综述", "实验记录 01", "实验记录 02", "实验记录 03", "数据分析", "组会汇报", "论文大纲", "参考文献", "方法笔记", "开题报告", "问卷设计", "访谈整理", "图表草稿", "投稿清单"].forEach((n) => (files[`研究/${n}.md`] = `# ${n}`));
files["研究/论文草稿.docx"] = "";
["线性代数", "机器学习", "宏观经济", "设计思维", "写作课", "统计学", "心理学导论", "城市规划", "日语 N3", "摄影基础"].forEach((n) => (files[`课程/${n}.md`] = `# ${n}`));
for (let d = 1; d <= 12; d++) files[`日记/2026-09-${String(d * 2).padStart(2, "0")}.md`] = `# 九月 ${d * 2} 日`;
files["Inbox/把天气和待办挂钩.md"] = "---\ntags:\n  - 灵感\n---\n\n把天气和待办挂钩：待处理多了就下雨。";
files["Inbox/书架会落灰.md"] = "很久没翻的书会落灰。";
files["Inbox/给猫起名.md"] = "团子、年糕、汤圆。";
const DAY = 86400000;
const mtime = {};
books.forEach((b, i) => {
  if (i % 3 === 2) mtime[`读书笔记/${b}.md`] = Date.now() - (90 + i * 9) * DAY;
});
const tracks = [
  ["夏夜晚风", "鹿野", 3],
  ["雨天的书店", "小林", 2],
  ["星河漫游", "Orbit Kid", 2],
  ["海边的夏天", "潮汐乐队", 2],
  ["森林咖啡馆", "Lo-fi 小屋", 3],
  ["冬天的雪", "北岛", 1],
  ["城市霓虹", "Night Drive", 2],
  ["钢琴小品集", "木木", 4],
  ["猫咪午睡", "喵喵", 1],
  ["Golden Hour", "Sunny", 2],
].flatMap(([album, artist, n], ai) => Array.from({ length: n }, (_, k) => ({ id: `t${ai}_${k}`, name: `${album} ${k + 1}`, file: "a", size: 1, title: `${album} · ${["序曲", "回声", "慢慢走", "晚安"][k]}`, artist, album, trackNo: k + 1 })));

// ───────── 工具 ─────────
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const lerpPose = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y ?? 0, b.y ?? 0, t), z: lerp(a.z, b.z, t), yaw: lerp(a.yaw, b.yaw, t), pitch: lerp(a.pitch, b.pitch, t) });

async function boot(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  page.on("console", (m) => m.type() === "error" && console.log("console", m.text().slice(0, 200)));
  const tone = toneWav();
  await page.route("**/mock/audio/**", (r) => r.fulfill({ body: tone, contentType: "audio/wav" }));
  await page.addInitScript(`window.__MOCK_FILES__ = ${JSON.stringify(files)}; window.__MOCK_MTIME__ = ${JSON.stringify(mtime)}; window.__MOCK_TRACKS__ = ${JSON.stringify(tracks)};`);
  await page.addInitScript({ path: MOCK });
  await page.goto("http://localhost:1430/", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.addStyleTag({
    content: `
      .enter-hint, .toasts, .toast-stack { display: none !important; }
      html.nohud .hud { display: none !important; }
      html.cap, html.cap body, html.cap #root, html.cap .world, html.cap .app { background: transparent !important; }
      html.cap .world-canvas, html.cap canvas { visibility: hidden !important; }
      html.cap .mc-overlay { background: rgba(16, 10, 6, 0.35) !important; }
    `,
  });
  await page.evaluate(async () => {
    const w = window.__world;
    w.actions.updateEnv({ timeMode: "fixed", fixedHour: 16.8, weather: "clear" });
    w.useWorld.getState().setMode("explore");
    w.engine.setManualClock(true);
    w.engine.setRenderScale(0.5);
    // 管家先停在书架上
  });
  return page;
}

class Shot {
  constructor(page, name, frames) {
    this.page = page;
    this.name = name;
    this.frames = frames;
    this.dir = path.join(OUT, name);
    fs.mkdirSync(this.dir, { recursive: true });
    this.overlays = new Array(frames).fill(null);
    this.current = null;
    this.ovCount = 0;
    this.hand = ["shelf", "write", "records", "garden"].includes(name);
  }
  wanted(i) {
    if (!PREVIEW) return true;
    return i === 0 || i === Math.floor(this.frames / 2) || i === this.frames - 1;
  }
  /** 拍一帧 3D 画面（会推进 dt） */
  async grab(i, physics = false) {
    const url = await this.page.evaluate(
      ([dt, physics, skip, hand]) => {
        const e = window.__world.engine;
        e.captureFrame(dt, { physics, hand });
        return skip ? null : document.querySelector("canvas").toDataURL("image/jpeg", 0.95);
      },
      [1 / FPS, physics, !this.wanted(i), this.hand],
    );
    if (url) fs.writeFileSync(path.join(this.dir, `f${String(i).padStart(4, "0")}.jpg`), Buffer.from(url.split(",")[1], "base64"));
    this.overlays[i] = this.current;
  }
  /** 界面变了：截一张透明的界面图，之后的帧都叠这张 */
  async overlay(hud = true) {
    const name = `o${this.ovCount++}.png`;
    await this.page.evaluate((hud) => {
      document.documentElement.classList.add("cap");
      document.documentElement.classList.toggle("nohud", !hud);
    }, hud);
    await this.page.waitForTimeout(250);
    await this.page.screenshot({ path: path.join(this.dir, name), omitBackground: true, timeout: 120000 });
    await this.page.evaluate(() => document.documentElement.classList.remove("cap"));
    this.current = name;
  }
  noOverlay() {
    this.current = null;
  }
  pose(p) {
    return this.page.evaluate((p) => window.__world.engine.setPose(p.x, p.y ?? 0, p.z, p.yaw, p.pitch), p);
  }
  save() {
    fs.writeFileSync(path.join(this.dir, "overlay.json"), JSON.stringify(this.overlays));
  }
}

const ev = (page, fn, arg) => page.evaluate(fn, arg);

// ───────── 分镜 ─────────
const SHOTS = {
  // 标题：黄昏的书房，镜头慢慢推进、微微升起
  async title(page) {
    const s = new Shot(page, "title", 120);
    await ev(page, () => {
      const w = window.__world;
      w.actions.updateEnv({ timeMode: "fixed", fixedHour: 17.3, weather: "clear" });
    });
    const a = { x: 7, y: 0, z: 11.3, yaw: 0, pitch: -0.02 };
    const b = { x: 7, y: 0.5, z: 7.6, yaw: 0, pitch: -0.08 };
    for (let i = 0; i < s.frames; i++) {
      await s.pose(lerpPose(a, b, ease(i / (s.frames - 1))));
      await s.grab(i);
    }
    s.save();
  },

  // 书架：准星扫过书脊，停在一本发亮的书上，显示开头几行
  async shelf(page) {
    const s = new Shot(page, "shelf", 60);
    const a = { x: 0.95, z: 4.4, yaw: 0.28, pitch: -0.12 };
    const b = { x: 1.75, z: 3.6, yaw: -0.1, pitch: -0.32 };
    for (let i = 0; i < s.frames; i++) {
      await s.pose(lerpPose(a, b, ease(Math.min(1, i / 34))));
      await s.grab(i);
      if (i === 0) await s.overlay(true);
      if (i === 35) {
        await page.waitForTimeout(700);
        await s.overlay(true);
      }
    }
    s.save();
  },

  // 写作：坐到书桌前，Notion 式编辑：斜杠菜单、提示框
  async write(page) {
    const s = new Shot(page, "write", 120);
    await ev(page, async () => {
      const w = window.__world;
      w.engine.setManualClock(false);
      w.engine.setPose(10.8, 0, 5.5, -Math.PI / 2, -0.1);
      await w.actions.takeBook("读书笔记/三体.md");
      await new Promise((r) => setTimeout(r, 2500));
      w.engine.setManualClock(true);
    });
    await page.click(".cm-content");
    await page.keyboard.press("Control+End");
    const lines = ["\n\n", "/"];
    let typed = 0;
    const script = [
      [0, async () => {}],
      [20, async () => page.keyboard.insertText("\n\n读后感：")],
      [40, async () => page.keyboard.insertText("给岁月以文明")],
      [58, async () => page.keyboard.press("Enter")],
      [62, async () => page.keyboard.press("Enter")],
      [66, async () => page.keyboard.type("/")],
      [84, async () => page.keyboard.type("bg")],
      [100, async () => page.keyboard.press("Escape")],
    ];
    void lines;
    void typed;
    for (let i = 0; i < s.frames; i++) {
      const step = script.find(([at]) => at === i);
      if (step) {
        await step[1]();
        await s.grab(i);
        await s.overlay(true);
        continue;
      }
      await s.grab(i);
    }
    s.save();
    await ev(page, async () => {
      const w = window.__world;
      w.engine.setManualClock(false);
      await w.actions.standUp();
      await new Promise((r) => setTimeout(r, 1500));
      w.engine.setManualClock(true);
    });
  },

  // 管家：小鸟从书架顶上飞下来，冒个气泡，再飞回书架带路
  async butler(page) {
    const s = new Shot(page, "butler", 60);
    const a = { x: 5.5, y: 0, z: 8.6, yaw: -0.12, pitch: 0.2 };
    const b = { x: 5.5, y: 0, z: 8.6, yaw: 0.45, pitch: 0.26 };
    await s.pose(a);
    await ev(page, () => {
      const e = window.__world.engine;
      e.bird.teleport(e.bird.position.clone().set(7.6, 3.0, 3.2));
      e.bird.flyTo(e.bird.position.clone().set(5.9, 2.15, 6.6));
    });
    s.noOverlay();
    for (let i = 0; i < s.frames; i++) {
      if (i === 12) await ev(page, () => window.__world.engine.bird.say("《活着》在「读书笔记」书架，跟我来！", 600000));
      if (i === 40) await ev(page, () => { const e = window.__world.engine; e.bird.flyTo(e.bird.position.clone().set(2, 3.4, 1.6)); });
      await s.pose(i < 38 ? a : lerpPose(a, b, ease((i - 38) / 22)));
      await s.grab(i);
    }
    s.save();
  },

  // 唱片：从唱片架拿起一张，走到留声机放上去
  async records(page) {
    const s = new Shot(page, "records", 120);
    await ev(page, () => window.__world.useWorld.getState().setMode("explore"));
    const a = { x: 2.85, z: 9.35, yaw: Math.PI, pitch: -0.3 };
    const b = { x: 2.3, z: 9.8, yaw: Math.PI - 0.42, pitch: -0.55 };
    await s.pose(a);
    for (let i = 0; i < s.frames; i++) {
      if (i < 40) await s.pose({ ...a, z: a.z - i * 0.004 });
      else if (i >= 52 && i <= 80) await s.pose(lerpPose({ ...a, z: a.z - 0.16 }, b, ease((i - 52) / 28)));
      if (i === 36) {
        await page.keyboard.press("e");
        await page.waitForTimeout(300);
      }
      if (i === 88) {
        await page.keyboard.press("e");
        await page.waitForTimeout(500);
      }
      await s.grab(i);
      if (i === 0 || i === 38 || i === 82 || i === 90) await s.overlay(true);
    }
    s.save();
  },

  // 院子：开门走出去，拿树苗种一棵树
  async garden(page) {
    const s = new Shot(page, "garden", 120);
    await ev(page, () => {
      const w = window.__world;
      w.actions.updateEnv({ timeMode: "fixed", fixedHour: 15.5, weather: "clear" });
      w.useWorld.getState().setCarry(null);
      if (!w.engine.isDoorOpen) w.engine.toggleDoor();
    });
    const a = { x: 6.95, z: 9.5, yaw: Math.PI, pitch: -0.05 };
    const b = { x: 6.95, z: 16.5, yaw: Math.PI, pitch: -0.12 };
    const c = { x: 6.95, z: 16.5, yaw: Math.PI + 0.75, pitch: -0.25 };
    for (let i = 0; i < s.frames; i++) {
      if (i <= 60) await s.pose(lerpPose(a, b, ease(i / 60)));
      else if (i <= 78) await s.pose(lerpPose(b, c, ease((i - 60) / 18)));
      if (i === 70) await page.keyboard.press("2");
      if (i === 96) await ev(page, () => window.__world.engine["secondary"]());
      await s.grab(i);
      if (i === 0 || i === 26 || i === 50 || i === 66 || i === 79 || i === 98) await s.overlay(true);
    }
    s.save();
  },

  // 延时：院子里看屋子，从下午到入夜，下起雨
  async timelapse(page) {
    const s = new Shot(page, "timelapse", 60);
    await ev(page, () => window.__world.useWorld.getState().setGslot(0));
    const a = { x: 2.5, y: 1.2, z: 25.5, yaw: -0.18, pitch: -0.1 };
    const b = { x: 3.5, y: 2.6, z: 26.5, yaw: -0.22, pitch: -0.16 };
    s.noOverlay();
    for (let i = 0; i < s.frames; i++) {
      const t = i / (s.frames - 1);
      await ev(page, (t) => {
        const w = window.__world;
        w.actions.updateEnv({ timeMode: "fixed", fixedHour: 16 + t * 5.6, weather: t > 0.55 ? "rain" : "clear" });
      }, t);
      await s.pose(lerpPose(a, b, ease(t)));
      await s.grab(i);
    }
    s.save();
  },

  // 屋子主题：同一个角度，七种屋子快速切换
  async themes(page) {
    const s = new Shot(page, "themes", 60);
    await ev(page, () => {
      const w = window.__world;
      w.actions.updateEnv({ timeMode: "fixed", fixedHour: 14, weather: "clear" });
      if (w.engine.isDoorOpen) w.engine.toggleDoor();
    });
    const themes = ["study", "cabin", "tower", "lighthouse", "washitsu", "minimal", "cellar"];
    const p = { x: 11.6, y: 0.6, z: 10.6, yaw: Math.PI / 4 + 0.15, pitch: -0.14 };
    s.noOverlay();
    for (let i = 0; i < s.frames; i++) {
      const k = Math.floor((i * themes.length) / s.frames);
      if (k !== Math.floor(((i - 1) * themes.length) / s.frames) || i === 0) await ev(page, (id) => window.__world.actions.setRoomTheme(id), themes[k]);
      await s.pose({ ...p, yaw: p.yaw - i * 0.002 });
      await s.grab(i);
    }
    s.save();
  },

  // 结尾：夜里的书房，镜头慢慢后退
  async ending(page) {
    const s = new Shot(page, "ending", 120);
    await ev(page, () => {
      const w = window.__world;
      w.actions.setRoomTheme("study");
      w.actions.updateEnv({ timeMode: "fixed", fixedHour: 21.5, weather: "rain" });
    });
    const a = { x: 7, y: 0.2, z: 5.2, yaw: 0, pitch: -0.02 };
    const b = { x: 7, y: 0.9, z: 10.6, yaw: 0, pitch: -0.08 };
    s.noOverlay();
    for (let i = 0; i < s.frames; i++) {
      await s.pose(lerpPose(a, b, ease(i / (s.frames - 1))));
      await s.grab(i);
    }
    s.save();
  },
};

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await boot(browser);
await page.evaluate(() => document.documentElement.classList.add("nohud"));
for (const [name, fn] of Object.entries(SHOTS)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const t0 = Date.now();
  await page.evaluate((hud) => document.documentElement.classList.toggle("nohud", !hud), ["shelf", "write", "butler", "records", "garden"].includes(name));
  await fn(page);
  console.log(name, "done", Math.round((Date.now() - t0) / 1000), "s");
}
await browser.close();
