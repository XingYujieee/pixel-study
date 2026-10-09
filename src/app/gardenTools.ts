// 院子里的物品栏：树苗、花种、灌木、草垛、花坛、菜地、铲子。右键种，铲子按住左键挖。
import { buildTool, GARDEN_HOTBAR, TOOL_NAMES } from "../world/held";
import { HOTBAR } from "../world/layout";
import { KIND_NAMES, type PlantKind } from "../world/gardenEdit";
import { digAt, digTime, gardenItemAt, plantAt, pullWeed } from "./garden";
import { startHold } from "./hold";
import { useApp } from "./store";
import { getEngine } from "./worldActions";
import { useWorld } from "./worldStore";

const toast = (t: string, tone: "info" | "error" = "info") => useApp.getState().toast(t, tone);

export function currentTool() {
  const w = useWorld.getState();
  return w.outside && !w.carry ? GARDEN_HOTBAR[w.gslot] ?? null : null;
}

/** 根据在哪、拿着什么，换手上的东西 */
export function applyToolHand() {
  const w = useWorld.getState();
  const eng = getEngine();
  if (!eng) return;
  eng.setSelected(w.outside || w.carry ? null : (HOTBAR[w.slot] ?? null));
  const tool = currentTool();
  eng.setGardenTool(tool);
  if (w.carry) return;
  if (tool) eng.setHeld(`tool:${tool}`, () => buildTool(tool));
  else eng.setHeld(null, null);
}

/** 右键：种下 */
export function placeGarden(kind: PlantKind, x: number, z: number) {
  const err = plantAt(kind, x, z);
  if (err) toast(`种不了：${err}`);
}

/** 对准花园里的东西按左键 / E */
export function useGardenTarget(x: number, z: number) {
  const tool = currentTool();
  const b = gardenItemAt(x, z);
  if (!b) return;
  if (tool === "shovel") {
    const name = KIND_NAMES[b.kind] ?? "它";
    startHold(`挖掉${name}`, digTime(b.kind), () => {
      const got = digAt(x, z);
      if (!got) toast("这个挖不动。");
    });
    return;
  }
  if (!tool && pullWeed(x, z)) return;
  if (tool) toast(`右键用${TOOL_NAMES[tool]}种在地上；想挖掉东西，换铲子（8）按住左键。`);
  else toast("空手只能拔草、摘花；换铲子（8）按住左键可以挖掉它，或按 G 叫管家。");
}
