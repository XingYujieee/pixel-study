// 书房管家：一只跟着你的小鸟。和它说话，它会找书、带路、整理书架、管楼层、打理花园、记灵感。
// 接了大模型（设置里填 API）时用工具调用自己决定做什么；没接时听得懂一些固定说法。
// 规则：动到文件的事（新建、移动笔记）一定先问你；书房摆设和花园直接做，但都能撤销。
import * as THREE from "three";
import { create } from "zustand";
import { api, errorMessage, type AgentMessage, type ToolCall, type ToolSpec } from "../ipc";
import { fuzzyFiles } from "../lib/fuzzy";
import { basename, dirname } from "../lib/paths";
import { OFFLINE_HELP, parseIntent, type Intent } from "../study/intents";
import { STYLE_NAMES, type Style } from "../world/compose";
import { allShelves, currentFloor, floorsOf, isGroundFloor } from "../world/floors";
import { gardenOf, type PlantKind } from "../world/gardenEdit";
import { allFurniture, canPlace, newId, type BirdKind, type Furniture } from "../world/layout";
import { applyLibraryPlan, describePlan, planShelves, shelfFor, skipFolder } from "../world/library";
import { formatHour, WEATHER_NAMES, type Weather } from "../world/sky";
import { THEMES, type RoomThemeId } from "../world/themes";
import { saveLayoutNow, saveLayoutSoon } from "./actions";
import { useAi } from "./aiStore";
import { addFloorHere, goToFloor } from "./floors";
import { gardenPlant, gardenRemove, gardenSummary, gardenWeed, syncGarden, type Where } from "./garden";
import { useApp } from "./store";
import { castIdea } from "./study";
import { getEngine, setRoomTheme, takeBook, updateEnv } from "./worldActions";
import { useWorld } from "./worldStore";

// ───────────── 状态 ─────────────

export interface ButlerMsg {
  id: number;
  from: "you" | "bird" | "note";
  text: string;
  /** 可以点的后续动作（带我去、打开……） */
  actions?: { label: string; run: () => void }[];
  /** 需要你点头的事 */
  confirm?: { title: string; detail: string; state: "ask" | "yes" | "no" };
  /** 撤销 */
  undo?: () => void;
  error?: boolean;
}

interface ButlerStore {
  messages: ButlerMsg[];
  busy: boolean;
  /** 给大模型的历史 */
  history: AgentMessage[];
}

export const useButler = create<ButlerStore>(() => ({ messages: [], busy: false, history: [] }));

let mid = 0;
const set = useButler.setState;
const get = useButler.getState;

function push(m: Omit<ButlerMsg, "id">): number {
  const id = ++mid;
  set({ messages: [...get().messages, { ...m, id }].slice(-80) });
  return id;
}

function patch(id: number, p: Partial<ButlerMsg>) {
  set({ messages: get().messages.map((m) => (m.id === id ? { ...m, ...p } : m)) });
}

export function butlerName(): string {
  return useWorld.getState().layout?.butler?.name ?? "咕咕";
}

export function butlerKind(): BirdKind {
  return useWorld.getState().layout?.butler?.kind ?? "owl";
}

/** 小鸟说话：聊天窗里一条，头上冒一个气泡 */
function say(text: string, extra: Partial<ButlerMsg> = {}): number {
  const id = push({ from: "bird", text, ...extra });
  const first = text.split(/(?<=[。！？!?\n])/)[0].slice(0, 42);
  getEngine()?.bird.say(first, 4500);
  void import("./sound").then((m) => m.sfx("chirp", 0.6));
  return id;
}

/** 等你点「好」或「不要」 */
function askConfirm(title: string, detail: string): Promise<boolean> {
  return new Promise((resolve) => {
    const id = push({ from: "bird", text: title, confirm: { title, detail, state: "ask" } });
    pending.set(id, (ok) => {
      const m = get().messages.find((x) => x.id === id);
      if (m?.confirm) patch(id, { confirm: { ...m.confirm, state: ok ? "yes" : "no" } });
      resolve(ok);
    });
  });
}

const pending = new Map<number, (ok: boolean) => void>();

export function answerConfirm(id: number, ok: boolean) {
  const fn = pending.get(id);
  pending.delete(id);
  fn?.(ok);
}

// ───────────── 叫出来 / 回去 ─────────────

export async function summonButler() {
  const eng = getEngine();
  const w = useWorld.getState();
  if (!w.layout) return;
  if (!useAi.getState().config) await useAi.getState().load().catch(() => {});
  eng?.releaseLock();
  eng?.bird.follow();
  w.openGui({ kind: "butler" });
  if (!get().messages.length) {
    const hasAi = useAi.getState().hasKey || useAi.getState().config?.provider === "compatible";
    say(
      `我是${butlerName()}，书房的管家。${hasAi ? "想找什么书、要我整理书架、打理花园，直接跟我说。" : "现在还没接上大模型（右上角「设置」里填 API 就能聊天），不过这些我已经会了：\n" + OFFLINE_HELP.join("\n")}`,
    );
  } else getEngine()?.bird.say("我在！", 1500);
}

export function dismissButler() {
  getEngine()?.bird.rest();
  getEngine()?.bird.say("我回书架上啦", 2000);
  if (useWorld.getState().gui?.kind === "butler") useWorld.getState().closeGui();
}

export function setButler(patchB: Partial<{ name: string; kind: BirdKind }>) {
  const l = useWorld.getState().layout;
  if (!l) return;
  l.butler = { name: l.butler?.name ?? "咕咕", kind: l.butler?.kind ?? "owl", ...patchB };
  getEngine()?.bird.setKind(l.butler.kind);
  useWorld.getState().touchLayout();
  saveLayoutSoon(300);
}

export function resetButlerChat() {
  // 还在等「好 / 不要」的确认一律当作不要，免得对话一直卡在忙
  for (const [id, fn] of [...pending]) {
    pending.delete(id);
    fn(false);
  }
  set({ messages: [], history: [] });
}

// ───────────── 工具 ─────────────

type Result = { text: string; actions?: ButlerMsg["actions"]; undo?: () => void };

function files() {
  return useApp.getState().files;
}

/** 一本书在哪：楼层、书架；没上架就说在哪个文件夹 */
function whereText(path: string): string {
  const l = useWorld.getState().layout;
  if (!l) return path;
  const hit = shelfFor(l, path);
  const many = floorsOf(l).length > 1;
  if (hit) return `${many ? `${hit.floorName}的` : ""}「${hit.f.shelf!.name}」书架`;
  const d = dirname(path);
  return `还没上书架（在 ${d || "库根目录"} 文件夹里）`;
}

async function findFiles(query: string, limit = 8): Promise<string[]> {
  const q = query.trim();
  if (!q) return [];
  const byName = fuzzyFiles(q, files().values(), limit).map((m) => m.entry.path);
  if (byName.length >= limit) return byName;
  const hits = await api.search(q, 30).catch(() => []);
  const seen = new Set(byName);
  for (const h of hits) {
    if (seen.has(h.path)) continue;
    seen.add(h.path);
    byName.push(h.path);
    if (byName.length >= limit) break;
  }
  return byName;
}

/** 带路：换到书所在的楼层，小鸟飞过去，你走到书架前，书闪几下 */
export async function guideTo(path: string): Promise<string> {
  const w = useWorld.getState();
  const l = w.layout;
  const eng = getEngine();
  if (!l || !eng) return "书房还没准备好";
  if (!files().has(path)) return `库里没有 ${path}`;
  const hit = shelfFor(l, path);
  if (!hit) return `《${basename(path)}》还没放上书架（在 ${dirname(path) || "库根目录"}）。可以让我「整理书架」，或者直接打开它。`;
  if (w.gui) w.closeGui();
  if (hit.floorId !== (l.floor ?? floorsOf(l)[0].id)) {
    say(`在${hit.floorName}，跟我上楼～`);
    await goToFloor(hit.floorId);
    await new Promise((r) => setTimeout(r, 450));
  }
  // 屋外：先进门
  if (eng.isOutside && isGroundFloor(useWorld.getState().layout!)) {
    if (!eng.isDoorOpen) eng.toggleDoor();
    await eng.walkTo({ x: 7, z: 10.5 }, 0, 0);
  }
  const book = eng.bookPoint(path);
  const target = book ? book.clone().add(new THREE.Vector3(0, 0.45, 0)) : eng.shelfPoint(hit.f.id);
  if (target) void eng.bird.flyTo(target);
  getEngine()?.bird.say("这边！", 2500);
  const ok = book ? await eng.locateBook(path) : await eng.walkToShelf(hit.f.id);
  setTimeout(() => getEngine()?.bird.follow(), 6000);
  saveLayoutSoon();
  return ok ? `已经带到${whereText(path)}前面${book ? "，书在闪" : ""}` : "没走到，书架好像被挡住了";
}

function overview(): string {
  const l = useWorld.getState().layout;
  if (!l) return "书房还没准备好";
  const all = [...files().keys()];
  const floors = floorsOf(l);
  const shelves = allShelves(l);
  const shelved = new Set<string>();
  for (const s of shelves) for (const p of all) if (shelfFor(l, p)?.f.id === s.f.id) shelved.add(p);
  const loose = new Map<string, number>();
  for (const p of all) {
    if (shelved.has(p)) continue;
    const top = p.includes("/") ? p.slice(0, p.indexOf("/")) : "（库根目录）";
    if (skipFolder(top)) continue;
    loose.set(top, (loose.get(top) ?? 0) + 1);
  }
  const lines = [
    `共 ${all.length} 个文件，${floors.length} 层楼，${shelves.length} 个书架。现在在${currentFloor(l).name}${getEngine()?.isOutside ? "（院子里）" : ""}。`,
    ...floors.map((f) => {
      const ss = f.furniture.filter((x) => x.type === "bookshelf" && x.shelf);
      return `${f.name}：${ss.map((x) => `「${x.shelf!.name}」${x.shelf!.mode === "folder" ? `(${x.shelf!.folder || "/"}${x.shelf!.flat ? "，只这一层" : ""})` : "(收藏)"}`).join("、") || "没有书架"}`;
    }),
  ];
  if (loose.size) lines.push(`还没上架：${[...loose].map(([d, n]) => `${d} ${n} 个`).join("、")}`);
  return lines.join("\n");
}

function listFolder(folder: string): string {
  const prefix = folder ? `${folder.replace(/\/$/, "")}/` : "";
  const dirs = new Map<string, number>();
  const direct: string[] = [];
  for (const p of files().keys()) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    const i = rest.indexOf("/");
    if (i > 0) dirs.set(rest.slice(0, i), (dirs.get(rest.slice(0, i)) ?? 0) + 1);
    else direct.push(rest);
  }
  if (!dirs.size && !direct.length) return `没有 ${folder || "库根目录"} 这个文件夹`;
  return [
    `${folder || "库根目录"}：`,
    dirs.size ? `子文件夹：${[...dirs].map(([d, n]) => `${d}/(${n})`).join("、")}` : "",
    direct.length ? `文件（${direct.length}）：${direct.slice(0, 60).join("、")}${direct.length > 60 ? "……" : ""}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}


async function organizeShelves(): Promise<Result> {
  const w = useWorld.getState();
  const l = w.layout;
  if (!l) return { text: "书房还没准备好" };
  const plan = planShelves(files().keys());
  if (!plan.length) return { text: "库里还没有文件夹可以排" };
  const current = allFurniture(l).filter((f) => f.shelf?.mode === "folder").length;
  const ok = await askConfirm(
    "要我按文件夹重新排书架吗？",
    `${describePlan(plan, current)}。一层放不下会往上加楼层。只动书房摆设，不移动任何文件；收藏书架和其他家具不动，排完可以撤销。`,
  );
  if (!ok) return { text: "用户没同意，书架没动" };
  await saveLayoutNow();
  const backup = JSON.stringify({ ...l, floors: floorsOf(l) });
  const r = applyLibraryPlan(l, plan);
  const here = getEngine()?.player();
  if (here) r.layout.player = here;
  getEngine()?.setGroundFloor(isGroundFloor(r.layout));
  w.setLayout(r.layout);
  getEngine()?.rebuildFurniture();
  saveLayoutSoon(200);
  const undo = () => {
    const prev = JSON.parse(backup);
    const at = getEngine()?.player();
    if (at && prev.floor === useWorld.getState().layout?.floor) prev.player = at;
    useWorld.getState().setLayout(prev);
    getEngine()?.setGroundFloor(isGroundFloor(prev));
    saveLayoutSoon(200);
    say("书架恢复原样了。");
  };
  return {
    text: `排好了：${r.shelves} 个书架${r.floorsAdded ? `，新加了 ${r.floorsAdded} 层（走楼梯上去）` : ""}${r.unplaced ? `，还有 ${r.unplaced} 个放不下（楼层到上限了）` : ""}。`,
    undo,
  };
}

async function createNote(folder: string, title: string, content: string): Promise<Result> {
  // 文件名里不能带别的扩展名（"报告.docx" 会被当成 Word）
  const name = title.trim().replace(/[\\/:*?"<>|]/g, " ").replace(/\.(md|markdown|txt|docx)$/i, "").slice(0, 80) || "新笔记";
  const dir = folder.trim().replace(/^\/+|\/+$/g, "");
  const ok = await askConfirm(`新建笔记《${name}》？`, `放在 ${dir || "库根目录"}，${content.length} 字。`);
  if (!ok) return { text: "用户没同意，没有新建" };
  try {
    // 空串表示库根目录（null 会被当成默认的 Notes/）
    const entry = await api.fileCreate(dir, name, "md", new TextEncoder().encode(content));
    useApp.getState().applyEvents([{ kind: "created", entry }]);
    getEngine()?.refreshBooks();
    return { text: `建好了：${entry.path}（${whereText(entry.path)}）`, actions: [{ label: "打开", run: () => void takeBook(entry.path) }] };
  } catch (e) {
    return { text: `没建成：${errorMessage(e)}` };
  }
}

async function moveNote(path: string, toFolder: string): Promise<Result> {
  if (!files().has(path)) return { text: `库里没有 ${path}` };
  const dir = toFolder.trim().replace(/^\/+|\/+$/g, "");
  const ok = await askConfirm(`把《${basename(path)}》移到 ${dir || "库根目录"}？`, `从 ${dirname(path) || "库根目录"} 移过去。同名时会保留两份，可以撤销。`);
  if (!ok) return { text: "用户没同意，文件没动" };
  try {
    const r = await api.fileMove(path, dir);
    if (r.entry) useApp.getState().applyEvents([{ kind: "renamed", from: r.from, entry: r.entry }]);
    getEngine()?.refreshBooks();
    const undo = () =>
      void api.fileMove(r.to, dirname(path)).then((back) => {
        if (back.entry) useApp.getState().applyEvents([{ kind: "renamed", from: back.from, entry: back.entry }]);
        getEngine()?.refreshBooks();
        say("移回去了。");
      });
    return { text: `移好了：${r.to}`, undo };
  } catch (e) {
    return { text: `没移成：${errorMessage(e)}` };
  }
}

/** 书架面板里「单独放一个书架」 */
export function addShelfFor(folder: string) {
  const r = addShelf(folder);
  useApp.getState().toast(r.text);
}

function addShelf(folder: string): Result {
  const w = useWorld.getState();
  const l = w.layout;
  if (!l) return { text: "书房还没准备好" };
  const dir = folder.replace(/^\/+|\/+$/g, "");
  const spots: [number, number, 0 | 1 | 2 | 3][] = [
    [1, 0, 0],
    [4, 0, 0],
    [7, 0, 0],
    [10, 0, 0],
    [0, 2, 1],
    [0, 5, 1],
    [0, 8, 1],
    [13, 1, 3],
    [13, 4, 3],
    [3, 5, 0],
    [8, 5, 0],
  ];
  for (const [x, z, rot] of spots) {
    const f: Furniture = { id: newId("shelf"), type: "bookshelf", x, z, rot, shelf: { name: basename(dir) || "库根目录", mode: "folder", refs: [], folder: dir } };
    if (!canPlace(l, f, undefined, getEngine()?.player()).ok) continue;
    l.furniture.push(f);
    getEngine()?.rebuildFurniture();
    w.touchLayout();
    saveLayoutSoon(200);
    return {
      text: `在${currentFloor(l).name}放了一个「${f.shelf!.name}」书架`,
      undo: () => {
        l.furniture = l.furniture.filter((x) => x.id !== f.id);
        getEngine()?.rebuildFurniture();
        useWorld.getState().touchLayout();
        saveLayoutSoon(200);
      },
    };
  }
  return { text: "这层靠墙的位置都满了，可以「再加一层」或者「整理书架」" };
}

function gardenTool(input: Record<string, unknown>): Result {
  const action = String(input.action ?? "");
  const whereRaw = input.where;
  const where: Where = whereRaw === "looking" ? "looking" : typeof input.x === "number" && typeof input.z === "number" ? { x: input.x, z: input.z } : "near_me";
  syncGarden();
  if (action === "weed") {
    const r = gardenWeed();
    return { text: r.text, undo: r.ok ? r.undo : undefined };
  }
  if (action === "plant") {
    const kind = (["tree", "flower", "bush", "hay", "bed", "farmland"].includes(String(input.kind)) ? input.kind : "flower") as PlantKind;
    const r = gardenPlant(kind, where, Number(input.count) || 1);
    if (r.ok && r.at) flyOver(r.at);
    return { text: r.text, undo: r.ok ? r.undo : undefined };
  }
  if (action === "remove") {
    const r = gardenRemove(String(input.kind ?? "any"), where);
    if (r.ok && r.at) flyOver(r.at);
    return { text: r.text, undo: r.ok ? r.undo : undefined };
  }
  const l = useWorld.getState().layout;
  return { text: `花园里有：${gardenSummary(gardenOf(l?.garden).items)}。坐标：院子 x 从 -6 到 19，z 从 -5 到 26；屋子占 x -1~14、z -1~12，门在南边 (6~7, 12)，门前小路通到 z 26。` };
}

/** 小鸟飞过去看一眼，再回来 */
function flyOver(at: { x: number; z: number }) {
  const eng = getEngine();
  // 在屋里时不穿墙飞出去
  if (!eng || !eng.isOutside) return;
  void eng.bird.flyTo(new THREE.Vector3(at.x + 0.5, 2.6, at.z + 0.5)).then(() => setTimeout(() => getEngine()?.bird.follow(), 1500));
}

async function floorsTool(input: Record<string, unknown>): Promise<Result> {
  const l = useWorld.getState().layout;
  if (!l) return { text: "书房还没准备好" };
  const all = floorsOf(l);
  const action = String(input.action ?? "list");
  if (action === "add") {
    const id = addFloorHere(typeof input.name === "string" ? input.name : undefined);
    if (!id) return { text: "没加成（最多 9 层，或者这层放不下楼梯）" };
    const nl = useWorld.getState().layout!;
    return { text: `加好了「${floorsOf(nl).find((f) => f.id === id)!.name}」，走楼梯上去就是`, actions: [{ label: "上去看看", run: () => void goToFloor(id) }] };
  }
  if (action === "go") {
    let name = String(input.floor ?? "");
    const idx = all.findIndex((f) => f.id === (l.floor ?? all[0].id));
    if (name === "up") name = all[idx + 1]?.id ?? "";
    if (name === "down") name = all[idx - 1]?.id ?? "";
    const m = /^([一二三四五六七八九\d])楼?$/.exec(name);
    if (m) {
      const n = Number(m[1]) || "一二三四五六七八九".indexOf(m[1]) + 1;
      name = all[n - 1]?.id ?? name;
    }
    if (!name) return { text: "已经到头了" };
    const ok = await goToFloor(name);
    return { text: ok ? `到${currentFloor(useWorld.getState().layout!).name}了` : `没有「${input.floor}」这一层。现在有：${all.map((f) => f.name).join("、")}` };
  }
  return { text: `${all.length} 层：${all.map((f) => `${f.name}（${f.furniture.filter((x) => x.type === "bookshelf").length} 个书架）`).join("、")}；现在在${currentFloor(l).name}` };
}

function sceneTool(input: Record<string, unknown>): Result {
  const patchE: Record<string, unknown> = {};
  const out: string[] = [];
  if (typeof input.hour === "number") {
    patchE.timeMode = "fixed";
    patchE.fixedHour = Math.max(0, Math.min(23.99, input.hour));
    out.push(`时间调到 ${formatHour(input.hour)}`);
  }
  const wt = String(input.weather ?? "");
  if (["clear", "cloudy", "rain", "storm", "snow"].includes(wt)) {
    patchE.weather = wt;
    out.push(`天气：${WEATHER_NAMES[wt as Weather]}`);
  }
  if (Object.keys(patchE).length) updateEnv(patchE);
  const th = String(input.theme ?? "");
  if (th in THEMES) {
    setRoomTheme(th as RoomThemeId);
    out.push(`屋子换成「${THEMES[th as RoomThemeId].name}」`);
  }
  return { text: out.join("，") || "没有要改的" };
}

async function musicTool(input: Record<string, unknown>): Promise<Result> {
  const m = await import("./sound");
  if (input.action === "stop") {
    m.stopBgm();
    (await import("./jukebox")).pause();
    return { text: "音乐停了" };
  }
  const st = String(input.style ?? "");
  const ok = m.playBgmNow(st in STYLE_NAMES ? (st as Style) : undefined);
  return { text: ok ? `放上了：${m.useBgm.getState().title}` : "现在放不了（留声机在放歌，或者还没点过画面解锁声音）" };
}

/** 唱片：列出、放一张（按名字找，没说就随便挑）、停下 */
async function recordTool(input: Record<string, unknown>): Promise<Result> {
  const m = await import("./records");
  const { trackTitle } = await import("../world/records");
  const recs = m.allRecords();
  if (input.action === "list") {
    if (!recs.length) return { text: "唱片架是空的：对着唱片架按 E，点「导入音乐」。" };
    return { text: recs.map((r) => `《${r.title}》${r.artist ? ` · ${r.artist}` : ""}（${r.tracks.length} 首）`).join("\n") };
  }
  if (input.action === "stop") {
    m.pause();
    return { text: "唱针抬起来了" };
  }
  if (!recs.length) return { text: "唱片架是空的，先导入几首音乐吧。" };
  const q = String(input.query ?? "").trim().toLowerCase();
  const pick = q ? recs.find((r) => `${r.title} ${r.artist} ${r.tracks.map(trackTitle).join(" ")}`.toLowerCase().includes(q)) : recs[Math.floor(Math.random() * recs.length)];
  if (!pick) return { text: `唱片架上没找到「${input.query}」` };
  m.pickRecord(pick.id);
  await m.putOnDeck();
  return { text: `放上了《${pick.title}》${pick.artist ? `（${pick.artist}）` : ""}` };
}

// 给大模型的工具说明
const obj = (props: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties: props, required });
const str = (description: string) => ({ type: "string", description });

export const TOOLS: ToolSpec[] = [
  { name: "search_notes", description: "按文件名和全文搜索笔记，返回路径和它在书房里的位置（哪层楼、哪个书架）。用户问「X 在哪」时先用这个。", parameters: obj({ query: str("关键词，尽量短"), limit: { type: "number" } }, ["query"]) },
  { name: "guide_to", description: "带用户走到某本书所在的书架前（会自动上下楼、进门），小鸟先飞过去。", parameters: obj({ path: str("库里的完整路径") }, ["path"]) },
  { name: "open_note", description: "把一本书带到书桌上打开（用户说「打开」「我要看」时）。", parameters: obj({ path: str("完整路径") }, ["path"]) },
  { name: "read_note", description: "读一篇笔记的内容（前 4000 字），用来回答关于内容的问题或做总结。", parameters: obj({ path: str("完整路径") }, ["path"]) },
  { name: "list_folder", description: "列出一个文件夹里的子文件夹和文件。根目录用空字符串。", parameters: obj({ folder: str("文件夹路径") }, ["folder"]) },
  { name: "library_overview", description: "书房概况：文件总数、楼层、每层的书架绑定了哪个文件夹、哪些文件夹还没上架。", parameters: obj({}) },
  { name: "organize_shelves", description: "整理书架：按文件夹结构重新摆文件夹书架，大文件夹拆开，一层放不下自动加楼层。不移动文件。会先问用户。", parameters: obj({}) },
  { name: "add_shelf", description: "在当前楼层靠墙的空位放一个绑定某文件夹的书架。", parameters: obj({ folder: str("文件夹路径") }, ["folder"]) },
  { name: "floors", description: "楼层：list 列出；go 去某层（floor 填名字如「二楼」或 up/down）；add 加一层。", parameters: obj({ action: { type: "string", enum: ["list", "go", "add"] }, floor: str("楼层名或 up/down"), name: str("新楼层的名字") }, ["action"]) },
  { name: "create_note", description: "新建一篇 Markdown 笔记（会先问用户）。", parameters: obj({ folder: str("放在哪个文件夹，根目录为空"), title: str("标题，不含扩展名"), content: str("Markdown 正文") }, ["folder", "title", "content"]) },
  { name: "move_note", description: "把一篇笔记移到另一个文件夹（会先问用户，可撤销）。", parameters: obj({ path: str("完整路径"), to_folder: str("目标文件夹") }, ["path", "to_folder"]) },
  { name: "capture_idea", description: "把一句灵感记进鱼塘（Inbox/），用户说「记一下」时用。", parameters: obj({ text: str("要记的话") }, ["text"]) },
  {
    name: "garden",
    description:
      "打理院子里的花园。plant 种（kind: tree 树 / flower 花 / bush 灌木 / hay 草垛 / bed 花坛 / farmland 菜地，count 数量）；remove 拿掉一样（kind 同上或 weed / any）；weed 除掉所有杂草；look 看看花园里有什么。where: looking=用户准星看着的地方（用户说「这」「那」时），near_me=用户附近；也可以给 x、z 坐标。",
    parameters: obj(
      {
        action: { type: "string", enum: ["plant", "remove", "weed", "look"] },
        kind: { type: "string" },
        count: { type: "number" },
        where: { type: "string", enum: ["looking", "near_me"] },
        x: { type: "number" },
        z: { type: "number" },
      },
      ["action"],
    ),
  },
  {
    name: "scene",
    description: "改书房的时间、天气或屋子主题。hour 0–24；weather: clear/cloudy/rain/storm/snow；theme: study/minimal/cabin/tower/lighthouse/cellar/washitsu。",
    parameters: obj({ hour: { type: "number" }, weather: { type: "string" }, theme: { type: "string" } }),
  },
  { name: "record", description: "唱片架和留声机：list 列出唱片；play 放一张（query 填专辑名、歌名或歌手，不填就随便挑）；stop 停下。用户说「放首歌」「放《X》」时优先用这个。", parameters: obj({ action: { type: "string", enum: ["list", "play", "stop"] }, query: str("专辑名、歌名或歌手") }, ["action"]) },
  { name: "music", description: "背景音乐：play 放一首（style: piano/musicbox/ambient/waltz/lofi/folk 可选），stop 停下。", parameters: obj({ action: { type: "string", enum: ["play", "stop"] }, style: { type: "string" } }, ["action"]) },
];

/** viaModel：是大模型发起的调用（会写文件的一律先问） */
async function runTool(name: string, input: Record<string, unknown>, viaModel = false): Promise<Result> {
  switch (name) {
    case "search_notes": {
      const list = await findFiles(String(input.query ?? ""), Math.min(20, Number(input.limit) || 8));
      if (!list.length) return { text: `没找到和「${input.query}」有关的文件` };
      return {
        text: list.map((p) => `${p} —— ${whereText(p)}`).join("\n"),
        actions: list.slice(0, 4).flatMap((p) => [{ label: `带我去《${basename(p).replace(/\.md$/i, "")}》`, run: () => void guideTo(p).then((t) => say(t)) }]),
      };
    }
    case "guide_to": {
      const path = String(input.path ?? input.query ?? "");
      const real = files().has(path) ? path : (await findFiles(path, 1))[0];
      if (!real) return { text: `没找到 ${path}` };
      return { text: await guideTo(real) };
    }
    case "open_note": {
      const path = String(input.path ?? "");
      if (!files().has(path)) return { text: `库里没有 ${path}` };
      useWorld.getState().closeGui();
      void takeBook(path);
      return { text: `把《${basename(path)}》拿到书桌上了` };
    }
    case "read_note": {
      const path = String(input.path ?? "");
      if (!files().has(path)) return { text: `库里没有 ${path}` };
      if (!/\.(md|markdown|txt)$/i.test(path)) return { text: "这个文件不是文本，读不了内容（可以打开看）" };
      try {
        const n = await api.noteRead(path);
        return { text: n.content.length > 4000 ? `${n.content.slice(0, 4000)}\n…（还有 ${n.content.length - 4000} 字）` : n.content };
      } catch (e) {
        return { text: `读不了：${errorMessage(e)}` };
      }
    }
    case "list_folder":
      return { text: listFolder(String(input.folder ?? "")) };
    case "library_overview":
      return { text: overview() };
    case "organize_shelves":
      return organizeShelves();
    case "add_shelf":
      return addShelf(String(input.folder ?? ""));
    case "floors":
      return floorsTool(input);
    case "create_note":
      return createNote(String(input.folder ?? ""), String(input.title ?? ""), String(input.content ?? ""));
    case "move_note":
      return moveNote(String(input.path ?? ""), String(input.to_folder ?? ""));
    case "capture_idea": {
      const text = String(input.text ?? "");
      if (viaModel && !(await askConfirm("记进鱼塘？", `「${text.slice(0, 60)}${text.length > 60 ? "…" : ""}」会存成 Inbox/ 里的一篇笔记。`))) return { text: "用户没同意，没有记" };
      const p = await castIdea(text);
      return { text: p ? `记进鱼塘了：${p}` : "没记上" };
    }
    case "garden":
      return gardenTool(input);
    case "scene":
      return sceneTool(input);
    case "music":
      return musicTool(input);
    case "record":
      return recordTool(input);
    default:
      return { text: `没有 ${name} 这个工具` };
  }
}

// ───────────── 对话 ─────────────

function systemPrompt(): string {
  const l = useWorld.getState().layout;
  const eng = getEngine();
  const now = new Date();
  const floors = l ? floorsOf(l) : [];
  return [
    `你是「${butlerName()}」，像素书房里的一只${({ owl: "猫头鹰", parrot: "鹦鹉", sparrow: "麻雀" } as const)[butlerKind()]}管家，跟在用户肩膀旁边。用户的笔记是本机的 Markdown / Word / TXT 文件（和 Obsidian 共用），书房里一个书架通常对应一个文件夹。`,
    "说话用简体中文，像个机灵的小管家，简短直接（一般一两句话），不用 Markdown 标题。",
    "能用工具就用工具，不要只描述。用户问东西在哪：先 search_notes，再告诉他在哪层哪个书架，问要不要带路（或直接 guide_to）。用户说「这棵树」「这里」指的是他准星看着的地方，garden 用 where=looking。",
    "新建、移动文件的工具会自己弹出确认，不用再问一遍；被拒绝就算了。不要编造不存在的文件路径。",
    `现在：本机时间 ${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}；书房里 ${eng ? formatHour(eng.env.hour) : "?"}，${eng ? WEATHER_NAMES[eng.env.weather] : ""}。`,
    l ? `用户在${currentFloor(l).name}${eng?.isOutside ? "的院子里" : ""}；共 ${floors.length} 层，${allShelves(l).length} 个书架，${files().size} 个文件。` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 历史太长时从前面截掉，保证从一条用户消息开始 */
function trimHistory(h: AgentMessage[]): AgentMessage[] {
  if (h.length <= 40) return h;
  let i = h.length - 40;
  while (i < h.length && h[i].role !== "user") i++;
  return h.slice(i);
}

function hasModel(): boolean {
  const ai = useAi.getState();
  return ai.hasKey || ai.config?.provider === "compatible";
}

export async function sendToButler(text: string) {
  const t = text.trim();
  if (!t || get().busy) return;
  push({ from: "you", text: t });
  set({ busy: true });
  try {
    if (!useAi.getState().config) await useAi.getState().load().catch(() => {});
    if (hasModel()) await agentLoop(t);
    else await offline(t);
  } finally {
    set({ busy: false });
  }
}

async function offline(t: string) {
  const intent = parseIntent(t);
  if (!intent) {
    say(`这句我还听不懂……接上大模型（右上角「设置」）就能随便聊了。现在我会：\n${OFFLINE_HELP.join("\n")}`);
    return;
  }
  await runIntent(intent);
}

async function runIntent(intent: Intent) {
  switch (intent.tool) {
    case "help":
      say(`我会这些：\n${OFFLINE_HELP.join("\n")}`);
      return;
    case "dismiss":
      dismissButler();
      return;
    case "time": {
      const eng = getEngine();
      const d = new Date();
      say(`你那边 ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}，书房里 ${eng ? formatHour(eng.env.hour) : "?"}。`);
      return;
    }
    case "search_notes": {
      const r = await runTool("search_notes", intent.input);
      say(r.text.startsWith("没找到") ? r.text : `找到这些：\n${r.text}`, { actions: r.actions });
      return;
    }
    case "guide_to": {
      const r = await runTool("guide_to", { path: intent.input.query });
      say(r.text);
      return;
    }
    case "garden": {
      const r = gardenTool(intent.input as Record<string, unknown>);
      say(r.text, { undo: r.undo });
      return;
    }
    default: {
      const r = await runTool(intent.tool, intent.input as Record<string, unknown>);
      say(r.text, { actions: r.actions, undo: r.undo });
    }
  }
}

async function agentLoop(t: string) {
  // 出错时回到这句话之前，不留下没有结果的工具调用（否则之后每次请求都会被服务商拒绝）
  const before = get().history;
  let history = trimHistory([...before, { role: "user", text: t }]);
  for (let round = 0; round < 8; round++) {
    let reply;
    try {
      reply = await api.aiAgent(systemPrompt(), history, TOOLS);
    } catch (e) {
      const msg = errorMessage(e);
      push({ from: "note", text: `大模型没回应：${msg}`, error: true });
      // 接不上时退回到固定说法
      const intent = parseIntent(t);
      if (intent && round === 0) await runIntent(intent);
      set({ history: before });
      return;
    }
    const calls: ToolCall[] = reply.toolCalls ?? [];
    history = [...history, { role: "assistant", text: reply.text, toolCalls: calls }];
    if (reply.text.trim()) say(reply.text.trim());
    if (!calls.length) break;
    for (const c of calls) {
      const note = push({ from: "note", text: `…${toolLabel(c.name)}` });
      let r: Result;
      try {
        r = await runTool(c.name, c.input ?? {}, true);
      } catch (e) {
        r = { text: `出错了：${errorMessage(e)}` };
      }
      patch(note, { text: `${toolLabel(c.name)}：${r.text.split("\n")[0].slice(0, 80)}`, actions: r.actions, undo: r.undo });
      history.push({ role: "tool", toolCallId: c.id, text: r.text });
    }
  }
  set({ history: trimHistory(history) });
}

function toolLabel(name: string): string {
  return (
    {
      search_notes: "翻目录",
      guide_to: "带路",
      open_note: "拿书",
      read_note: "读笔记",
      list_folder: "看文件夹",
      library_overview: "看看书房",
      organize_shelves: "整理书架",
      add_shelf: "放书架",
      floors: "楼层",
      create_note: "写新笔记",
      move_note: "搬笔记",
      capture_idea: "记灵感",
      garden: "打理花园",
      scene: "调书房",
      music: "音乐",
    } as Record<string, string>
  )[name] ?? name;
}
