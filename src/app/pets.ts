// 宠物：领养、取名、摸摸头、送回家。宠物位置随布局一起保存。
import { newId, shelfBooks } from "../world/layout";
import { MAX_PETS, PET_KINDS, type Pet, type PetKind } from "../world/pets";
import { saveLayoutSoon, setLayoutSaveHook } from "./actions";
import { useApp } from "./store";
import { useStudy } from "./study";
import { getEngine } from "./worldActions";
import { useWorld } from "./worldStore";

const toast = (t: string) => useApp.getState().toast(t);

function pets(): Pet[] {
  return useWorld.getState().layout?.pets ?? [];
}

export function syncPets() {
  getEngine()?.pets.setPets(pets());
  updateNapSpot();
}

/** 保存布局前写回宠物当前位置 */
setLayoutSaveHook((layout) => {
  const pos = getEngine()?.pets.positions();
  if (!pos || !layout.pets) return;
  for (const p of layout.pets) {
    const q = pos.get(p.id);
    if (q) {
      p.x = Math.round(q.x * 100) / 100;
      p.z = Math.round(q.z * 100) / 100;
    }
  }
});

export function adoptPet(kind: PetKind, coat: number, name: string): boolean {
  const layout = useWorld.getState().layout;
  if (!layout) return false;
  if ((layout.pets?.length ?? 0) >= MAX_PETS) {
    toast(`书房里最多养 ${MAX_PETS} 只，太多会挤。`);
    return false;
  }
  const eng = getEngine();
  const p = eng?.player() ?? { x: 7, z: 9, yaw: 0, pitch: 0 };
  // 出现在你面前一点
  const x = Math.min(13.5, Math.max(0.5, p.x - Math.sin(p.yaw) * 1.4));
  const z = Math.min(11.5, Math.max(0.5, p.z - Math.cos(p.yaw) * 1.4));
  const kindName = PET_KINDS.find((k) => k.kind === kind)!.name;
  const pet: Pet = { id: newId("pet"), kind, coat, name: name.trim() || kindName, x, z };
  layout.pets = [...(layout.pets ?? []), pet];
  syncPets();
  useWorld.getState().touchLayout();
  saveLayoutSoon(200);
  toast(`${pet.name}来到了书房。左键摸摸它。`);
  return true;
}

export function renamePet(id: string, name: string) {
  const p = pets().find((x) => x.id === id);
  if (!p || !name.trim()) return;
  p.name = name.trim().slice(0, 20);
  useWorld.getState().touchLayout();
  saveLayoutSoon(300);
}

export function releasePet(id: string) {
  const layout = useWorld.getState().layout;
  if (!layout?.pets) return;
  const p = layout.pets.find((x) => x.id === id);
  layout.pets = layout.pets.filter((x) => x.id !== id);
  syncPets();
  useWorld.getState().touchLayout();
  saveLayoutSoon(200);
  if (p) toast(`${p.name}回家了，想它的时候可以再领回来。`);
}

let patListener: ((pet: Pet) => void) | null = null;
/** 摸头时的音效等 */
export function onPat(fn: (pet: Pet) => void) {
  patListener = fn;
}

export function patPet(id: string) {
  const eng = getEngine();
  const p = pets().find((x) => x.id === id);
  if (!eng || !p) return;
  eng.pets.pat(id, eng.player());
  patListener?.(p);
}

/** 宠物睡觉的地方：最近打开的那本书所在书架前；没有就在书桌旁 */
export function updateNapSpot() {
  const eng = getEngine();
  const layout = useWorld.getState().layout;
  if (!eng || !layout) return;
  const opened = useStudy.getState().opened;
  const files = useApp.getState().files;
  const recent = Object.entries(opened)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([p]) => p);
  for (const path of recent) {
    for (const f of layout.furniture) {
      if (!f.shelf) continue;
      if (shelfBooks(f.shelf, files).some((b) => b.path === path)) {
        eng.setNapSpot(eng.frontOf(f.id, 1.1));
        return;
      }
    }
  }
  const desk = layout.furniture.find((f) => f.type === "desk");
  eng.setNapSpot(desk ? eng.frontOf(desk.id, 1.6) : null);
}

useStudy.subscribe((s, prev) => {
  if (s.opened !== prev.opened) updateNapSpot();
});
