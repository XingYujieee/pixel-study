// 文件导入：从 Finder 拖进窗口，丢在哪件家具上就进哪里；或在资料箱里点「导入文件」。
// 原文件只复制、不移动；同名自动保留两份；导入后有回执可以撤销（副本移到 .trash/）。
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { api, errorMessage, type FileEntry } from "../ipc";
import { basename, isEditablePath } from "../lib/paths";
import { dropCountText, IMPORT_DIR, planDrop, type DropPlan } from "../study/dropPlan";
import { TRASH_DIR } from "../study/inbox";
import { hashString } from "../world/layout";
import { BOOK_COLORS } from "../world/textures";
import { readDocx } from "../word/docx";
import { handleVaultEvents, saveLayoutNow } from "./actions";
import { useAi } from "./aiStore";
import { useApp } from "./store";
import { furniture, getEngine, takeBook, updateEnv } from "./worldActions";
import { pixelateFile } from "../world/pixelate";
import { PANORAMA_RATIO } from "../world/scenerySources";
import type { Side } from "../world/themes";
import { useWorld } from "./worldStore";

export interface ImportReceipt {
  id: number;
  /** 新复制进库的文件 */
  imported: string[];
  /** 本来就在库里、没有复制的文件数 */
  inVault: number;
  renamed: number;
  /** 去处的说明，例如「读书/」「收藏书架」 */
  where: string;
  /** 放上收藏书架时新增的引用（撤销时去掉） */
  shelf?: { fid: string; added: string[] };
  /** 不是文件导入的回执（例如换窗景）：自定义文字与撤销 */
  custom?: { text: string; undo: () => void | Promise<void> };
  undone?: boolean;
}

interface ImportStore {
  /** 正在从 Finder 拖进来 */
  drag: { count: string; label: string; x: number; y: number } | null;
  receipt: ImportReceipt | null;
}

export const useImport = create<ImportStore>(() => ({ drag: null, receipt: null }));

const toast = (t: string, tone: "info" | "error" = "info") => useApp.getState().toast(t, tone);
let receiptId = 0;

function chestId(): string | null {
  return useWorld.getState().layout?.furniture.find((f) => f.type === "chest")?.id ?? null;
}

/** 屏幕坐标处的导入去处（同时在书房里给那件家具描边） */
export function planAt(x: number, y: number, paths: string[] = dragPaths): DropPlan {
  const w = useWorld.getState();
  if (w.mode === "focus" || !w.layout) return planDrop(null, { focus: true });
  const hit = getEngine()?.probeAt(x, y) ?? null;
  if (hit?.kind === "window") {
    if (paths.some(isImagePath)) return { dir: "", label: `放到${SIDE_NAMES[hit.side]}上 → 换成像素窗景（真实天空）`, fid: null, scenery: hit.side };
    return planDrop(null, { chestId: chestId(), label: "窗户只接受图片；松手会收进资料箱（Imports/）" });
  }
  return planDrop(hit ? (furniture(hit.fid) ?? null) : null, { chestId: chestId() });
}

const SIDE_NAMES: Record<Side, string> = { north: "北窗", east: "东窗", west: "西窗" };

export function isImagePath(p: string): boolean {
  return /\.(png|jpe?g|webp|gif|bmp|heic|heif|tiff?)$/i.test(p);
}

/** 图片丢到窗户上：像素化（抠掉天空）后装到这扇窗；宽幅全景图铺满三扇窗。可以撤销。 */
export async function sceneryFromDrop(paths: string[], side: Side) {
  const path = paths.find(isImagePath);
  const layout = useWorld.getState().layout;
  if (!path || !layout) return;
  try {
    const bytes = await api.readExternalImage(path);
    const r = await pixelateFile(new Blob([bytes as BlobPart]), 256, 32, true);
    const prev = { scenery: layout.env.scenery, sceneryPanorama: layout.env.sceneryPanorama, scenerySides: { ...layout.env.scenerySides } };
    const wide = r.art.width / r.art.height >= PANORAMA_RATIO;
    if (wide) {
      // 全景图：重新按三倍宽度处理，绕屋子切四段后每一面仍然清晰
      const big = await pixelateFile(new Blob([bytes as BlobPart]), 768, 32, true);
      updateEnv({ scenery: big.url, sceneryPanorama: true, scenerySides: {} });
    } else updateEnv({ scenerySides: { ...layout.env.scenerySides, [side]: r.url } });
    const name = path.split(/[/\\]/).pop();
    useImport.setState({
      receipt: {
        id: ++receiptId,
        imported: [],
        inVault: 0,
        renamed: 0,
        where: "",
        custom: {
          text: wide ? `「${name}」是全景图，已经绕屋子铺了一圈` : `「${name}」装到了${SIDE_NAMES[side]}（在窗台面板里可以调粗细、装到全部窗户）`,
          undo: () => updateEnv(prev),
        },
      },
    });
  } catch (e) {
    toast(`这张图片读不了：${errorMessage(e)}`, "error");
  }
}

function colorOf(e: FileEntry): string {
  const palette = BOOK_COLORS[e.kind] ?? BOOK_COLORS.other;
  return palette[(hashString(e.path) >>> 20) % palette.length];
}

function whereText(plan: DropPlan): string {
  if (plan.shelfRef) return `「${furniture(plan.shelfRef)?.shelf?.name ?? "书架"}」书架`;
  return plan.dir ? `${plan.dir}/` : "库根目录";
}

/** 读出文字内容（AI 附件用）：Markdown / TXT 原文，Word 取纯文字 */
async function textOf(path: string): Promise<string> {
  if (/\.docx$/i.test(path)) {
    const { bytes } = await api.fileReadBytes(path);
    const { html } = await readDocx(bytes);
    const div = document.createElement("div");
    div.innerHTML = html;
    for (const b of div.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,tr")) b.append("\n");
    return (div.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
  }
  return (await api.noteRead(path)).content;
}

/**
 * 导入一批外部路径（文件或文件夹）。at 为松手的屏幕位置，用来播放掉落物动画。
 * 返回新导入的路径。
 */
export async function importPaths(paths: string[], plan: DropPlan, at?: { x: number; y: number }): Promise<string[]> {
  if (!paths.length || !useApp.getState().vault) return [];
  let r: Awaited<ReturnType<typeof api.fileImportDrop>>;
  try {
    r = await api.fileImportDrop(paths, plan.dir);
  } catch (e) {
    toast(`导入失败：${errorMessage(e)}`, "error");
    return [];
  }
  if (r.entries.length) handleVaultEvents(r.entries.map((entry) => ({ kind: "created" as const, entry })));
  const imported = r.entries.map((e) => e.path);
  const all = [...imported, ...r.inVault];

  // 放上收藏书架：只加引用
  let shelf: ImportReceipt["shelf"];
  if (plan.shelfRef) {
    const s = furniture(plan.shelfRef)?.shelf;
    if (s) {
      const added = all.filter((p) => !s.refs.includes(p));
      s.refs.push(...added);
      shelf = { fid: plan.shelfRef, added };
      useWorld.getState().touchLayout();
      getEngine()?.refreshBooks();
      void saveLayoutNow();
    }
  }

  // 掉落物动画（库里已有的文件也飞一下，表示"收到了"）
  if (at && all.length) {
    const files = useApp.getState().files;
    const colors = all.map((p) => {
      const e = files.get(p);
      return e ? colorOf(e) : "#8a8a8a";
    });
    getEngine()?.spawnDrops(at.x, at.y, plan.fid, colors);
  }

  if (!imported.length && !shelf?.added.length) {
    if (r.inVault.length) toast("这些文件已经在库里了，没有重复复制。拖到收藏书架上可以直接放上去。");
    else if (r.skipped) toast("没有可导入的文件（隐藏文件和快捷方式会跳过）。");
    return [];
  }

  useImport.setState({
    receipt: { id: ++receiptId, imported, inVault: r.inVault.length, renamed: r.renamed, where: whereText(plan), shelf },
  });

  // 接下来：带到书桌 / 附进 AI 对话
  const firstText = all.find((p) => isEditablePath(p));
  if (plan.then === "desk") {
    if (firstText) await takeBook(firstText, plan.fid ?? undefined);
    else toast("导入的文件不能在书桌上编辑，已放进 Imports/，可以在资料箱里打开。");
  } else if (plan.then === "ai") {
    if (firstText) {
      try {
        const content = await textOf(firstText);
        useAi.setState({ dropped: { name: basename(firstText), content } });
        useWorld.getState().openGui({ kind: "ai" });
      } catch (e) {
        toast(`没能读取「${basename(firstText)}」：${errorMessage(e)}`, "error");
      }
    } else toast("AI 工作台只能读文字（Markdown / TXT / Word），文件已放进 Imports/。");
  }
  return imported;
}

/** 撤销一次导入：副本移到 .trash/，去掉新增的书架引用。原文件从未被改动。 */
export async function undoImport(receipt: ImportReceipt) {
  if (receipt.custom) {
    await receipt.custom.undo();
    useImport.setState({ receipt: { ...receipt, undone: true } });
    return;
  }
  let failed = 0;
  for (const p of receipt.imported) {
    try {
      await api.fileMove(p, TRASH_DIR);
      handleVaultEvents([{ kind: "removed", path: p }]);
    } catch {
      failed++;
    }
  }
  if (receipt.shelf) {
    const s = furniture(receipt.shelf.fid)?.shelf;
    if (s) {
      const drop = new Set(receipt.shelf.added);
      s.refs = s.refs.filter((p) => !drop.has(p));
      useWorld.getState().touchLayout();
      getEngine()?.refreshBooks();
      void saveLayoutNow();
    }
  }
  const cur = useImport.getState().receipt;
  if (cur?.id === receipt.id) useImport.setState({ receipt: { ...cur, undone: true } });
  if (failed) toast(`有 ${failed} 个文件没能撤回（可能已被移动或删除）`, "error");
}

/** 资料箱分拣：未上架的导入文件（Imports/ 下、没有放在任何收藏书架上） */
export function unsortedImports(files: Iterable<FileEntry>, shelvedRefs: Set<string>): FileEntry[] {
  const out: FileEntry[] = [];
  for (const f of files) if (f.path.startsWith(`${IMPORT_DIR}/`) && !shelvedRefs.has(f.path)) out.push(f);
  return out.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
}

/** 分拣上架：文件夹书架 → 移到那个文件夹（不覆盖）；收藏书架 → 只加引用 */
export async function shelveFiles(paths: string[], shelfId: string): Promise<number> {
  const s = furniture(shelfId)?.shelf;
  if (!s || !paths.length) return 0;
  let n = 0;
  if (s.mode === "virtual") {
    for (const p of paths)
      if (!s.refs.includes(p)) {
        s.refs.push(p);
        n++;
      }
    useWorld.getState().touchLayout();
    getEngine()?.refreshBooks();
    void saveLayoutNow();
  } else {
    for (const p of paths) {
      try {
        const r = await api.fileMove(p, s.folder);
        if (r.entry) handleVaultEvents([{ kind: "renamed", from: r.from, entry: r.entry }]);
        n++;
      } catch (e) {
        toast(`「${basename(p)}」没能移动：${errorMessage(e)}`, "error");
      }
    }
  }
  if (n) toast(`放上了「${s.name}」${n} 个${s.mode === "folder" ? `（移到 ${s.folder || "库根目录"}/）` : ""}`);
  return n;
}

/** 资料箱「导入文件…」与 ⌘O：选择文件后按资料箱的规则导入 */
export async function importFromDialog() {
  const picked = await openDialog({ multiple: true, directory: false, title: "导入文件（复制到库内，原文件不变）" });
  const sources = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
  if (!sources.length) return;
  const chest = chestId();
  const plan = useWorld.getState().mode === "focus" ? planDrop(null, { focus: true }) : planDrop(chest ? (furniture(chest) ?? null) : null, { chestId: chest });
  await importPaths(sources, plan, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
}

// ───────────── 拖放事件 ─────────────

type DragEvent =
  | { type: "enter"; paths: string[]; position: { x: number; y: number } }
  | { type: "over"; position: { x: number; y: number } }
  | { type: "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "leave" };

let dragPaths: string[] = [];

function toLogical(p: { x: number; y: number }) {
  const r = window.devicePixelRatio || 1;
  return { x: p.x / r, y: p.y / r };
}

export function handleDragDrop(ev: DragEvent) {
  if (!useApp.getState().vault) return;
  if (ev.type === "leave") {
    dragPaths = [];
    useImport.setState({ drag: null });
    getEngine()?.clearProbe();
    return;
  }
  const { x, y } = toLogical(ev.position);
  if (ev.type === "enter") dragPaths = ev.paths;
  const plan = planAt(x, y);
  if (ev.type === "drop") {
    const paths = ev.paths.length ? ev.paths : dragPaths;
    dragPaths = [];
    useImport.setState({ drag: null });
    getEngine()?.clearProbe();
    if (plan.scenery) void sceneryFromDrop(paths, plan.scenery);
    else if (plan.audio) {
      void import("./jukebox").then(async (m) => {
        const n = await m.importAudio(paths);
        if (n) getEngine()?.spawnDrops(x, y, plan.fid, Array(Math.min(n, 8)).fill("#d9a84a"));
      });
    } else void importPaths(paths, plan, { x, y });
    return;
  }
  useImport.setState({ drag: { count: dropCountText(dragPaths), label: plan.label, x, y } });
}

/** 注册窗口拖放监听（只在桌面应用中可用）。整个应用只注册一次，避免重复监听导致一次拖放导入两遍。 */
let dragListening = false;
export async function listenDragDrop(): Promise<void> {
  if (dragListening) return;
  dragListening = true;
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().onDragDropEvent((e) => handleDragDrop(e.payload as DragEvent));
  } catch {
    // 浏览器预览等非桌面环境
  }
}
