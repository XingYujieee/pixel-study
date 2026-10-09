// 唱片：把导入的歌按专辑归成一张张唱片。纯函数，不依赖界面。
import type { Track } from "../ipc";

export interface RecordInfo {
  /** 唱片编号：专辑 = "a:" + 专辑名；单曲 = "t:" + 歌的编号 */
  id: string;
  title: string;
  /** 歌手；一张专辑里歌手不一样时为"群星" */
  artist: string;
  /** 按曲序排好的歌 */
  tracks: Track[];
  /** 封面种子（"换一张封面"） */
  cover: number;
  /** 没有专辑信息、一首歌单独成一张 */
  single: boolean;
}

export const trackTitle = (t: Track) => t.title || t.name;

function albumArtist(tracks: Track[]): string {
  const names = [...new Set(tracks.map((t) => t.artist).filter((a): a is string => !!a))];
  return names.length === 0 ? "" : names.length === 1 ? names[0] : "群星";
}

/** 归组：同一专辑名的歌放在一起（合辑里每首歌手不同，也算一张），其余每首单独一张。顺序按导入顺序。 */
export function groupRecords(tracks: Track[]): RecordInfo[] {
  const byKey = new Map<string, Track[]>();
  const order: string[] = [];
  for (const t of tracks) {
    const album = t.album?.trim();
    const key = album ? `a:${album}` : `t:${t.id}`;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(t);
  }
  return order.map((key) => {
    const list = byKey.get(key)!;
    const single = key.startsWith("t:");
    const sorted = single ? list : [...list].sort((a, b) => (a.trackNo ?? 999) - (b.trackNo ?? 999) || trackTitle(a).localeCompare(trackTitle(b), "zh"));
    return {
      id: key,
      title: single ? trackTitle(list[0]) : list[0].album!.trim(),
      artist: albumArtist(list),
      tracks: sorted,
      cover: list[0].cover ?? 0,
      single,
    };
  });
}

/** 唱片架每层放几张、几层 */
export const SLEEVES_PER_ROW = 5;
export const ROWS_PER_SHELF = 2;
export const PER_SHELF = SLEEVES_PER_ROW * ROWS_PER_SHELF;

/**
 * 把唱片分到各个唱片架：按架子顺序依次放满。放不下的不显示（界面里提示再放一个唱片架）。
 * 返回 唱片编号 → [架子编号, 第几格]。
 */
export function assignRecords(recordIds: string[], shelfIds: string[]): Map<string, [string, number]> {
  const out = new Map<string, [string, number]>();
  recordIds.forEach((id, i) => {
    const s = Math.floor(i / PER_SHELF);
    if (s < shelfIds.length) out.set(id, [shelfIds[s], i % PER_SHELF]);
  });
  return out;
}
