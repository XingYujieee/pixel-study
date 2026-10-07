// 拖放导入：文件丢在哪件家具上，就进哪里。纯函数，便于测试。
import type { Furniture } from "../world/layout";
import { INBOX_DIR } from "./inbox";

export const IMPORT_DIR = "Imports";

export interface DropPlan {
  /** 复制到的库内目录（空字符串为库根目录） */
  dir: string;
  /** 拖动时显示的提示 */
  label: string;
  /** 吸入动画飞向的家具；null 表示没有可去的家具 */
  fid: string | null;
  /** 收藏书架：导入后把文件放上这个书架（只加引用） */
  shelfRef?: string;
  /** 导入后：带到书桌打开 / 附进 AI 对话 */
  then?: "desk" | "ai";
  /** 丢在留声机上的音频：加进歌单 */
  audio?: boolean;
  /** 丢在窗户上的图片：换成这扇窗的窗景 */
  scenery?: "north" | "east" | "west";
}

/** f 为松手处的家具（指着书时传书架）；focus 为专注写作模式（书房不可见） */
export function planDrop(f: Furniture | null, opts: { focus?: boolean; chestId?: string | null; label?: string } = {}): DropPlan {
  const chest = opts.chestId ?? null;
  if (opts.focus) return { dir: IMPORT_DIR, label: `松手导入到 ${IMPORT_DIR}/`, fid: null };
  if (f?.type === "bookshelf" && f.shelf) {
    const s = f.shelf;
    if (s.mode === "folder") return { dir: s.folder, label: `放进「${s.name}」书架 → 复制到 ${s.folder ? `${s.folder}/` : "库根目录"}`, fid: f.id };
    return { dir: IMPORT_DIR, label: `放上「${s.name}」书架（文件复制到 ${IMPORT_DIR}/）`, fid: f.id, shelfRef: f.id };
  }
  switch (f?.type) {
    case "desk":
      return { dir: IMPORT_DIR, label: "放到书桌上 → 导入后直接打开", fid: f.id, then: "desk" };
    case "pond":
      return { dir: INBOX_DIR, label: `扔进鱼塘 → ${INBOX_DIR}/，之后再整理`, fid: f.id };
    case "aibench":
      return { dir: IMPORT_DIR, label: "交给 AI 工作台 → 导入后附进对话", fid: f.id, then: "ai" };
    case "jukebox":
      return { dir: "", label: "放到留声机上 → 加进歌单（复制到应用里，不进笔记库）", fid: f.id, audio: true };
    case "chest":
      return { dir: IMPORT_DIR, label: `放进资料箱 → ${IMPORT_DIR}/，稍后分拣`, fid: f.id };
    default:
      return { dir: IMPORT_DIR, label: opts.label ?? `丢在地上 → 收进资料箱（${IMPORT_DIR}/）`, fid: chest };
  }
}

/** 拖动的提示里带上数量 */
export function dropCountText(paths: string[]): string {
  if (paths.length === 0) return "";
  const name = paths[0].split(/[/\\]/).filter(Boolean).pop() ?? paths[0];
  return paths.length === 1 ? `「${name}」` : `「${name}」等 ${paths.length} 项`;
}
