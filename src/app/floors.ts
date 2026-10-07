// 楼层的操作：上下楼（黑一下再亮）、加一层、改名、拆掉。
import { addFloor, currentFloor, floorsOf, isGroundFloor, removeFloor, renameFloor, switchFloor } from "../world/floors";
import { themeOf } from "../world/themes";
import { saveLayoutNow, saveLayoutSoon } from "./actions";
import { useApp } from "./store";
import { getEngine } from "./worldActions";
import { useWorld } from "./worldStore";

const toast = (t: string, tone: "info" | "error" = "info") => useApp.getState().toast(t, tone);

/** 换层时的黑屏过渡 */
function fade(): Promise<void> {
  const el = document.createElement("div");
  el.className = "floor-fade";
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("on"));
  setTimeout(() => {
    el.classList.remove("on");
    setTimeout(() => el.remove(), 400);
  }, 520);
  return new Promise((r) => setTimeout(r, 260));
}

/** 去某一层（id 或名字） */
export async function goToFloor(idOrName: string): Promise<boolean> {
  const w = useWorld.getState();
  const l = w.layout;
  if (!l) return false;
  const all = floorsOf(l);
  const target = all.find((f) => f.id === idOrName) ?? all.find((f) => f.name === idOrName || f.name.startsWith(idOrName));
  if (!target) return false;
  if (target.id === (l.floor ?? all[0].id)) return true;
  // 先把宠物位置等写回
  await saveLayoutNow();
  await fade();
  const eng = getEngine();
  const following = eng?.bird.mode === "follow";
  const next = switchFloor(l, target.id);
  eng?.setGroundFloor(isGroundFloor(next));
  eng?.setTheme(themeOf(next.theme));
  w.setLayout(next);
  void import("./sound").then((m) => m.sfx("stepWood"));
  if (eng && following) {
    const p = eng.player();
    eng.bird.teleport(new (await import("three")).Vector3(p.x, 2.2, p.z));
  }
  saveLayoutSoon(300);
  return true;
}

export function addFloorHere(name?: string): string | null {
  const w = useWorld.getState();
  const l = w.layout;
  if (!l) return null;
  const r = addFloor(l, name);
  if ("error" in r) {
    toast(r.error, "error");
    return null;
  }
  // 留在原地（新布局对象会让引擎重设玩家位置）
  const p = getEngine()?.player();
  if (p) r.layout.player = p;
  w.setLayout(r.layout);
  saveLayoutSoon(200);
  return r.id;
}

export function renameFloorAction(id: string, name: string) {
  const w = useWorld.getState();
  if (!w.layout) return;
  const next = renameFloor(w.layout, id, name);
  w.layout.floors = next.floors;
  w.layout.floor = next.floor;
  w.touchLayout();
  saveLayoutSoon(300);
}

export function removeFloorAction(id: string): boolean {
  const w = useWorld.getState();
  if (!w.layout) return false;
  const r = removeFloor(w.layout, id);
  if ("error" in r) {
    toast(r.error, "error");
    return false;
  }
  w.layout.floors = r.floors;
  w.touchLayout();
  saveLayoutSoon(200);
  return true;
}

export function floorLabel(): string {
  const l = useWorld.getState().layout;
  if (!l || !l.floors?.length) return "";
  return currentFloor(l).name;
}
