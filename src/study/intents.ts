// 管家听得懂的固定说法：没接大模型时也能用。把一句中文变成一个工具调用。纯函数。

export type Intent =
  | { tool: "search_notes"; input: { query: string } }
  | { tool: "guide_to"; input: { query: string } }
  | { tool: "organize_shelves"; input: Record<string, never> }
  | { tool: "garden"; input: { action: "plant" | "remove" | "weed"; kind?: string; count?: number; where?: "looking" | "near_me" } }
  | { tool: "floors"; input: { action: "go" | "add" | "list"; floor?: string } }
  | { tool: "capture_idea"; input: { text: string } }
  | { tool: "music"; input: { action: "play" | "stop" } }
  | { tool: "record"; input: { action: "play" | "stop" | "list"; query?: string } }
  | { tool: "scene"; input: { hour?: number; weather?: string } }
  | { tool: "library_overview"; input: Record<string, never> }
  | { tool: "time"; input: Record<string, never> }
  | { tool: "help"; input: Record<string, never> }
  | { tool: "dismiss"; input: Record<string, never> };

const CN_NUM: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 几: 3 };

function count(s: string): number {
  const m = /(\d+|[一两二三四五六七八九十几])\s*(?:棵|颗|株|朵|个|堆|捆|块|片|丛)/.exec(s);
  if (!m) return 1;
  return Number(m[1]) || CN_NUM[m[1]] || 1;
}

/** 去掉句子里的客气话和标点，取出要找的东西 */
function cleanQuery(s: string): string {
  let q = s.replace(/[《》「」"'“”？?。！!，,\s]/g, "").replace(/(在哪儿?|在哪里|放哪了?|放在哪|去哪了|呢|吗|吧|啊|呀|的位置)/g, "");
  const prefixes = /^(请|麻烦|帮我|帮忙|你|给我|我想|我要|能不能|可以|找一下|找找|找|搜一下|搜索|搜|查一下|查找|查|我的|我|那篇|那本|这篇|这本|一篇|一本|关于)/;
  for (let i = 0; i < 6 && prefixes.test(q); i++) q = q.replace(prefixes, "");
  q = q.replace(/(的)?(笔记|文档|文件|资料)$/g, "").replace(/的$/, "");
  return q.trim();
}

export function parseIntent(raw: string): Intent | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^(你能做什么|你会什么|帮助|help|怎么用|能干嘛)/i.test(s)) return { tool: "help", input: {} };
  if (/^(回去吧?|你去休息|休息吧|拜拜|再见|没事了)/.test(s)) return { tool: "dismiss", input: {} };
  if (/几点|什么时间|现在时间/.test(s)) return { tool: "time", input: {} };
  if (/整理(一下)?(所有的?|全部)?书架|重新(排|摆|整理)(一下)?书架|书架(太乱|整理)/.test(s)) return { tool: "organize_shelves", input: {} };
  if (/(书房|书架|库)(里)?(有什么|概况|情况|有多少)|多少(本|篇)/.test(s)) return { tool: "library_overview", input: {} };
  // 花园
  if (/除草|拔草|拔(掉)?杂草|清(理)?杂草/.test(s)) return { tool: "garden", input: { action: "weed" } };
  const where = /这|那|看着|前面/.test(s) ? "looking" : "near_me";
  const plantM = /(种|栽|堆|放)(上|下|一?些|点)?.*?(树|花|灌木|草垛|花坛|菜地|菜)/.exec(s);
  const removeM = /(砍|拔|移除|移走|去掉|拿掉|挖掉|铲掉|拆掉|不要)(掉|了)?(这|那|最近的)?(棵|颗|个|丛|堆)?(树|花|灌木|草垛|花坛|菜地)/.exec(s);
  const kindOf = (k: string) => ({ 树: "tree", 花: "flower", 灌木: "bush", 草垛: "hay", 花坛: "bed", 菜地: "farmland", 菜: "farmland" })[k] ?? "tree";
  const removeM2 = /把(这|那|最近的)?(棵|颗|个|丛|堆)?(树|花|灌木|草垛|花坛|菜地)(给)?(砍|拔|移|去|拿|挖|铲|拆)(掉|走)/.exec(s);
  if (removeM2) return { tool: "garden", input: { action: "remove", kind: kindOf(removeM2[3]), where } };
  if (removeM) return { tool: "garden", input: { action: "remove", kind: kindOf(removeM[5]), where } };
  if (plantM && !/书/.test(s)) return { tool: "garden", input: { action: "plant", kind: kindOf(plantM[3]), count: count(s), where } };
  // 楼层
  if (/(再)?(加|盖|建|多)(一|1)?层|新(的)?楼层/.test(s)) return { tool: "floors", input: { action: "add" } };
  const fl = /(去|到|上|下)\s*([一二三四五六七八九\d])\s*楼/.exec(s);
  if (fl) return { tool: "floors", input: { action: "go", floor: `${fl[2]}楼` } };
  if (/^上楼/.test(s)) return { tool: "floors", input: { action: "go", floor: "up" } };
  if (/^下楼/.test(s)) return { tool: "floors", input: { action: "go", floor: "down" } };
  if (/有几层|楼层/.test(s)) return { tool: "floors", input: { action: "list" } };
  // 随手记
  const cap = /^(帮我)?(记一下|记下来|记一笔|记住|备忘)[:：,，\s]*(.+)$/.exec(s);
  if (cap) return { tool: "capture_idea", input: { text: cap[3].trim() } };
  // 音乐与天气
  const rec = /(放|听|来)(一?张|一下)?《(.+?)》/.exec(s);
  if (rec) return { tool: "record", input: { action: "play", query: rec[3] } };
  if (/(有|有哪些|有什么|看看)(的)?唱片|唱片(有哪些|都有什么)/.test(s)) return { tool: "record", input: { action: "list" } };
  if (/(放|换|来)(一?张|张)?唱片/.test(s)) return { tool: "record", input: { action: "play" } };
  if (/(停|关)(掉|下|了)?(唱片|留声机)/.test(s)) return { tool: "record", input: { action: "stop" } };
  if (/(停|关)(掉|下|了)?(音乐|歌)|安静/.test(s)) return { tool: "music", input: { action: "stop" } };
  if (/(放|来)(一?首|点|些)?(音乐|歌|曲子)/.test(s)) return { tool: "music", input: { action: "play" } };
  if (/下雨/.test(s)) return { tool: "scene", input: { weather: "rain" } };
  if (/下雪/.test(s)) return { tool: "scene", input: { weather: "snow" } };
  if (/晴天|天晴|放晴/.test(s)) return { tool: "scene", input: { weather: "clear" } };
  if (/(变成|调到|切到)?(晚上|夜里|天黑)/.test(s)) return { tool: "scene", input: { hour: 22 } };
  if (/(变成|调到|切到)?(白天|天亮|早上)/.test(s)) return { tool: "scene", input: { hour: 10 } };
  // 找东西 / 带路
  const guide = /^(带我去|带我到|领我去|去)(.+)$/.exec(s);
  if (guide) {
    const q = cleanQuery(guide[2]);
    if (q) return { tool: "guide_to", input: { query: q } };
  }
  if (/在哪|放哪|去哪了|找|搜|查/.test(s)) {
    const q = cleanQuery(s);
    if (q) return { tool: "search_notes", input: { query: q } };
  }
  return null;
}

export const OFFLINE_HELP = [
  "「三体在哪」「找一下周报」：找书，告诉你在哪个书架",
  "「带我去 三体」：飞过去带路",
  "「整理书架」：按文件夹重新排书架，放不下就加楼层",
  "「种三棵树」「在这种点花」「砍掉这棵树」「除草」：打理花园",
  "「去二楼」「再加一层」：楼层",
  "「记一下：……」：随手记进鱼塘",
  "「放张唱片」「放《叶惠美》」「有哪些唱片」：唱片架和留声机",
  "「放首音乐」「下雨」「变成晚上」",
];
