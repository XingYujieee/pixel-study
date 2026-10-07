// 远景画：屋子四周很远的地方围一圈画（西、北、东、南），近处是立体的方块地形。
// 每面显示什么：单独给某扇窗的图 > 全部窗户的图（全景时切四段）> 内置远景。纯函数。
import type { EnvSettings } from "./sky";
import type { SceneryPreset, Side } from "./themes";

export interface SideSource {
  url: string;
  /** 全景切分：0 西、1 北、2 东、3 南；null 为整张 */
  slice: number | null;
  /** 内置窗景自带的夜灯层；用户图片在加载时生成 */
  lights?: string;
}

/** 远景的四面（南面在院子那边，只能出门看到） */
export type Backdrop = Side | "south";

/** 设置里能单独换图的三扇窗 */
export const SIDES: Side[] = ["west", "north", "east"];
export const BACKDROPS: Backdrop[] = ["west", "north", "east", "south"];
export const SLICES = 4;

export function resolveScenery(
  s: Pick<EnvSettings, "scenery" | "sceneryPanorama" | "scenerySides" | "sceneryPreset">,
  themePreset: SceneryPreset,
  presetArt: (p: SceneryPreset) => { url: string; lights: string } | null,
): Record<Backdrop, SideSource | null> {
  const p = s.sceneryPreset ?? themePreset;
  const preset = presetArt(p);
  const out = {} as Record<Backdrop, SideSource | null>;
  const own = (side: Backdrop) => (side === "south" ? undefined : s.scenerySides[side]);
  BACKDROPS.forEach((side, i) => {
    const mine = own(side);
    if (mine) out[side] = { url: mine, slice: null };
    else if (s.scenery) out[side] = { url: s.scenery, slice: s.sceneryPanorama ? i : null };
    else if (preset) out[side] = { url: preset.url, slice: null, lights: preset.lights };
    else out[side] = null;
  });
  // 南面没有窗户：只换了某扇窗时，南面也用那张图（优先北窗），不然出门一看还是内置远景
  if (!s.scenery) {
    const first = s.scenerySides.north ?? s.scenerySides.east ?? s.scenerySides.west;
    if (first) out.south = { url: first, slice: null };
  }
  return out;
}

/** 宽高比超过这个值的图默认按全景切成四段 */
export const PANORAMA_RATIO = 2.4;
