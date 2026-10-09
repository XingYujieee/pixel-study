// 唱片架与留声机：导入的歌按专辑变成唱片，摆在唱片架上；拿起一张、放上留声机就开始放。
// 交互参考《渔力全开》：准星对准 → [E] 拿起 → 拿在手上（F 细看、Q 放回）→ 对着留声机 [E] 放上去。
import { api, errorMessage } from "../ipc";
import { coverCanvas } from "../world/cover";
import { recordSleeve } from "../world/held";
import { assignRecords, groupRecords, type RecordInfo } from "../world/records";
import { saveLayoutSoon } from "./actions";
import { importAudioFromDialog, loadRecord, loadTracks, pause, toggle, useJukebox } from "./jukebox";
import { sfx } from "./sound";
import { useApp } from "./store";
import { getEngine } from "./worldActions";
import { useWorld } from "./worldStore";

const toast = (t: string, tone: "info" | "error" = "info") => useApp.getState().toast(t, tone);

/** 当前所有唱片（按导入顺序） */
export function allRecords(): RecordInfo[] {
  return groupRecords(useJukebox.getState().tracks);
}

export function recordById(id: string | null | undefined): RecordInfo | undefined {
  return id ? allRecords().find((r) => r.id === id) : undefined;
}

export const coverOf = (r: Pick<RecordInfo, "title" | "artist" | "cover">) => coverCanvas(r.title, r.artist, r.cover);

export function deckId(): string | null {
  return useWorld.getState().layout?.deck ?? null;
}

/** 换唱盘上的唱片：写进布局（下次打开还在）并通知界面 */
function setDeck(id: string | null) {
  useWorld.getState().setDeck(id);
  saveLayoutSoon(500);
}

/** 这一层的唱片架（按摆放顺序） */
function shelves(): string[] {
  return (useWorld.getState().layout?.furniture ?? []).filter((f) => f.type === "recordshelf").map((f) => f.id);
}

/** 唱片架上一共放得下几张 / 有几张没地方放 */
export function shelfCapacity(): { shelves: number; overflow: number } {
  const n = shelves().length;
  const total = allRecords().length;
  return { shelves: n, overflow: Math.max(0, total - n * 10) };
}

/** 把唱片摆到架子上、留声机上的那张放到唱盘上（数据变了就调用） */
export function syncRecords() {
  const eng = getEngine();
  if (!eng) return;
  const recs = allRecords();
  const carry = useWorld.getState().carry;
  const deck = deckId();
  const where = assignRecords(
    recs.map((r) => r.id),
    shelves(),
  );
  eng.setRecordSleeves(
    recs
      .filter((r) => r.id !== deck && r.id !== carry?.id && where.has(r.id))
      .map((r) => ({ id: r.id, fid: where.get(r.id)![0], slot: where.get(r.id)![1], cover: coverOf(r) })),
  );
  const d = recordById(deck);
  eng.setDeck(d ? coverOf(d) : null);
}

/** 打开书房 / 歌单变化后：恢复留声机上的唱片（不自动播放），歌单跟着唱片里的歌更新 */
export function restoreDeck() {
  const id = deckId();
  const d = recordById(id);
  if (useWorld.getState().deck !== id) useWorld.getState().setDeck(id);
  if (d) {
    const ids = d.tracks.map((t) => t.id);
    const q = useJukebox.getState().queue;
    if (!q || q.join() !== ids.join()) useJukebox.setState({ queue: ids });
  } else if (id && useJukebox.getState().tracks.length) {
    // 那张唱片被删掉了
    setDeck(null);
  }
  syncRecords();
}

function setHand(id: string | null) {
  const eng = getEngine();
  const r = recordById(id);
  useWorld.getState().setCarry(id && r ? { kind: "record", id } : null);
  eng?.setInspect(false);
  if (r) {
    const cover = coverOf(r);
    eng?.setHeld(`record:${r.id}:${r.cover}`, () => {
      const g = recordSleeve(cover);
      g.scale.setScalar(0.95);
      return g;
    });
  } else applyHand();
}

/** 手上没唱片时：院子里拿园艺工具，屋里拿物品栏选中的家具 */
export function applyHand() {
  void import("./gardenTools").then((m) => m.applyToolHand());
}

/** E：从唱片架上拿起一张（手上已经有一张就先放回去） */
export function pickRecord(id: string) {
  const r = recordById(id);
  if (!r) return;
  setHand(id);
  syncRecords();
  sfx("sleeve");
}

/** Q：放回唱片架 */
export function putBack() {
  const c = useWorld.getState().carry;
  if (!c) return;
  setHand(null);
  syncRecords();
  sfx("place", 0.7);
}

/** 对着留声机按 E：换上手里这张，原来那张放回唱片架，从第一首开始放 */
export async function putOnDeck() {
  const c = useWorld.getState().carry;
  const r = recordById(c?.id);
  const l = useWorld.getState().layout;
  if (!r || !l) return;
  setDeck(r.id);
  setHand(null);
  syncRecords();
  sfx("needle");
  await loadRecord(
    r.tracks.map((t) => t.id),
    true,
  );
  toast(`♪ ${r.title}${r.artist ? ` · ${r.artist}` : ""}`);
}

/** 从留声机上取下唱片：toHand 时拿在手上，否则放回唱片架 */
export async function ejectDeck(toHand: boolean) {
  const id = deckId();
  if (!id) return;
  setDeck(null);
  await loadRecord(null, false);
  if (toHand) {
    // 手上原来那张先放回去
    setHand(id);
    sfx("sleeve");
  } else sfx("place", 0.7);
  syncRecords();
}

/** 对着留声机按 E 或左键 */
export function useJukeboxTarget(): void {
  const c = useWorld.getState().carry;
  if (c) {
    void putOnDeck();
    return;
  }
  useWorld.getState().openGui({ kind: "jukebox" });
}

/** F：拿到眼前细看 / 放下 */
export function toggleInspect() {
  const w = useWorld.getState();
  if (!w.carry) return;
  const on = !w.inspect;
  w.setInspect(on);
  getEngine()?.setInspect(on);
  if (on) sfx("page", 0.6);
}

export function stopInspect() {
  const w = useWorld.getState();
  if (!w.inspect) return;
  w.setInspect(false);
  getEngine()?.setInspect(false);
}

// ───────────── 整理唱片 ─────────────

export async function importMusic() {
  await importAudioFromDialog();
  restoreDeck();
}

/** 改唱片名、歌手：专辑改全部歌的专辑名；单曲改歌名。artist 为 undefined 时不动（合辑里每首歌手不同） */
export async function editRecord(r: RecordInfo, title: string, artist?: string) {
  const ids = r.tracks.map((t) => t.id);
  const patch: { title?: string; album?: string; artist?: string } = r.single ? { title } : { album: title };
  if (artist !== undefined) patch.artist = artist;
  try {
    await api.audioUpdate(ids, patch);
  } catch (e) {
    toast(`改不了：${errorMessage(e)}`, "error");
    return;
  }
  await afterEdit(r);
}

/** 换一张封面（同样的名字换配色和细节） */
export async function rerollCover(r: RecordInfo) {
  await api.audioUpdate(
    r.tracks.map((t) => t.id),
    { cover: (r.cover + 1) % 1000 },
  );
  await afterEdit(r);
  sfx("page", 0.6);
}

/** 唱片编号可能因为改名而变（专辑名就是编号）：按其中一首歌找回改名后的唱片，手上、唱盘上的那张跟着换 */
async function afterEdit(before: RecordInfo) {
  await loadTracks();
  const first = before.tracks[0]?.id;
  const after = allRecords().find((x) => x.tracks.some((t) => t.id === first));
  const w = useWorld.getState();
  if (deckId() === before.id) setDeck(after?.id ?? null);
  if (w.carry?.id === before.id) setHand(after?.id ?? null);
  restoreDeck();
}

/** 删掉一张唱片（应用里的音频副本，原文件不受影响） */
export async function deleteRecord(r: RecordInfo) {
  const w = useWorld.getState();
  if (deckId() === r.id) await ejectDeck(false);
  if (w.carry?.id === r.id) setHand(null);
  for (const t of r.tracks) await api.audioRemove(t.id).catch(() => {});
  await loadTracks();
  syncRecords();
}

export { toggle as togglePlay, pause };
