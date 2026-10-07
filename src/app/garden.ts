// 花园的操作：种、拔、除草、杂草每天长一点。改动可以撤销（花园不是文件，直接生效）。
import type { GardenBlock } from "../world/garden";
import { gardenOf, growWeeds, KIND_NAMES, nearest, plant, PLANT_NAMES, removeAt, spotNear, weed, type PlantKind } from "../world/gardenEdit";
import { saveLayoutSoon } from "./actions";
import { getEngine } from "./worldActions";
import { useWorld } from "./worldStore";

export type Where = "looking" | "near_me" | { x: number; z: number };

function items(): GardenBlock[] {
  return gardenOf(useWorld.getState().layout?.garden).items;
}

function commit(next: GardenBlock[]) {
  const l = useWorld.getState().layout;
  if (!l) return;
  l.garden = { items: next, grownAt: l.garden?.grownAt ?? Date.now() };
  getEngine()?.setGarden(next);
  saveLayoutSoon(300);
}

/** 让引擎显示当前花园；顺便按日子长出杂草 */
export function syncGarden() {
  const l = useWorld.getState().layout;
  if (!l) return;
  if (l.garden) {
    const grown = growWeeds(l.garden, Date.now());
    if (grown !== l.garden) {
      l.garden = grown;
      saveLayoutSoon(1000);
    }
  }
  getEngine()?.setGarden(l.garden?.items);
}

/** 返回撤销函数 */
function snapshot(): () => void {
  const before = items().map((b) => ({ ...b }));
  return () => commit(before);
}

function anchor(where: Where): { x: number; z: number } | null {
  const eng = getEngine();
  if (!eng) return null;
  if (where === "looking") {
    const c = eng.lookCell();
    if (c) return c;
  }
  if (typeof where === "object") return where;
  const p = eng.player();
  // 站在屋里时，默认在门前的花园里
  if (!eng.isOutside) return { x: 3, z: 20 };
  // 面前一两步
  return { x: p.x - Math.sin(p.yaw) * 2, z: p.z - Math.cos(p.yaw) * 2 };
}

export type GardenResult = { ok: true; text: string; undo?: () => void; at?: { x: number; z: number } } | { ok: false; text: string };

export function gardenPlant(kind: PlantKind, where: Where = "looking", count = 1, variant?: number): GardenResult {
  const a = anchor(where);
  if (!a) return { ok: false, text: "书房还没准备好" };
  const undo = snapshot();
  let list = items();
  let done = 0;
  let first: { x: number; z: number } | undefined;
  for (let i = 0; i < Math.min(12, Math.max(1, count)); i++) {
    const spot = spotNear(list, kind, a.x, a.z, kind === "tree" ? 14 : 8);
    if (!spot) break;
    const r = plant(list, kind, spot.x, spot.z, variant ?? Math.floor(Math.random() * 4));
    if ("error" in r) break;
    list = r.items;
    first ??= spot;
    done++;
  }
  if (!done) return { ok: false, text: `附近没有能种${PLANT_NAMES[kind]}的地方（树要离屋子和别的树远一点，小路上不能种）` };
  commit(list);
  void import("./sound").then((m) => m.sfx("place"));
  return { ok: true, text: `种好了 ${done} ${kind === "tree" ? "棵" : kind === "hay" ? "个" : "处"}${PLANT_NAMES[kind]}`, undo, at: first };
}

const KIND_OF: Record<string, GardenBlock["kind"][]> = {
  tree: ["trunk"],
  flower: ["flower"],
  bush: ["bush"],
  hay: ["hay"],
  weed: ["weed"],
  bed: ["bed"],
  farmland: ["farmland"],
  any: ["trunk", "flower", "bush", "hay", "weed", "bench", "table", "woodpile", "well", "bed", "farmland"],
};

/** 拿掉一样东西：看着的那个，或者离你最近的那个 */
export function gardenRemove(kind: keyof typeof KIND_OF | string = "any", where: Where = "looking"): GardenResult {
  const eng = getEngine();
  if (!eng) return { ok: false, text: "书房还没准备好" };
  const kinds = KIND_OF[kind] ?? KIND_OF.any;
  const list = items();
  let target: GardenBlock | null = null;
  if (where === "looking") {
    const c = eng.lookCell();
    if (c) target = list.find((b) => b.x === c.x && b.z === c.z && kinds.includes(b.kind)) ?? nearest(list, kinds, c.x + 0.5, c.z + 0.5, 3);
  } else if (typeof where === "object") target = list.find((b) => b.x === where.x && b.z === where.z) ?? null;
  if (!target) {
    const p = eng.player();
    target = nearest(list, kinds, p.x, p.z, eng.isOutside ? 14 : 40);
  }
  if (!target) return { ok: false, text: "附近没找到要拿掉的东西" };
  const undo = snapshot();
  const r = removeAt(list, target.x, target.z)!;
  commit(r.items);
  void import("./sound").then((m) => m.sfx("pop"));
  return { ok: true, text: `拿掉了${KIND_NAMES[target.kind] ?? "东西"}（${target.x}, ${target.z}）`, undo, at: { x: target.x, z: target.z } };
}

export function gardenWeed(): GardenResult {
  const r = weed(items());
  if (!r.count) return { ok: true, text: "花园里没有杂草" };
  const undo = snapshot();
  commit(r.items);
  void import("./sound").then((m) => m.sfx("page"));
  return { ok: true, text: `拔了 ${r.count} 棵杂草`, undo };
}

/** 空手点一棵杂草：直接拔掉 */
export function pullWeed(x: number, z: number): boolean {
  const list = items();
  const b = list.find((it) => it.x === x && it.z === z);
  if (!b || (b.kind !== "weed" && b.kind !== "flower")) return false;
  commit(removeAt(list, x, z)!.items);
  void import("./sound").then((m) => m.sfx("pop"));
  return true;
}

export function gardenItemAt(x: number, z: number): GardenBlock | undefined {
  return items().find((b) => b.x === x && b.z === z);
}

export { gardenSummary } from "../world/gardenEdit";
