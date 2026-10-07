// 屋子主题：只换墙、地板、窗型、灯光和默认窗景。房间尺寸不变，所以家具摆法、书和文件都不受影响。

export type RoomThemeId = "study" | "minimal" | "cabin" | "tower" | "lighthouse" | "cellar" | "washitsu";

/** 内置窗景（程序生成的像素画，天空透明，露出真实天空） */
export type SceneryPreset = "forest" | "sea" | "mountains" | "bamboo" | "fields" | "city";

export type WindowStyle = "rect" | "round" | "arch" | "shoji";

/** 一面墙上的窗洞（以方块为单位，含两端）。北墙用 x，东西墙用 z。 */
export interface Opening {
  from: number;
  to: number;
  y0: number;
  y1: number;
}

export interface WindowSet {
  north?: Opening;
  east?: Opening;
  west?: Opening;
}

/** 纹理名：来自 textures()（基础）或 roomTextures()（主题） */
export type TexName =
  | "planks"
  | "darkPlanks"
  | "stoneBricks"
  | "plaster"
  | "log"
  | "windowFrame"
  | "whiteWall"
  | "logWall"
  | "stoneFloor"
  | "darkCobble"
  | "cellarBricks"
  | "lighthouseWall"
  | "lighthouseLower"
  | "deckPlanks"
  | "tatami"
  | "clayWall"
  | "lightOak"
  | "whitePlanks";

export interface RoomTheme {
  id: RoomThemeId;
  name: string;
  desc: string;
  floor: TexName;
  ceiling: TexName;
  /** 天花板横梁，null 为没有 */
  beams: TexName | null;
  /** 墙下部（高 lowerRows 格）与上部 */
  lower: TexName;
  upper: TexName;
  lowerRows: number;
  corner: TexName;
  door: TexName;
  frame: TexName;
  windows: WindowSet;
  windowStyle: WindowStyle;
  /** 西墙壁炉（占 z 4–6，高 2 格） */
  fireplace?: boolean;
  /** 室外光照进屋里的比例（地下书库很低） */
  daylight: number;
  /** 室内常亮的底光（0–1），没有窗的屋子靠它和灯笼 */
  ambient: number;
  /** 没有自定义窗景时用的风景 */
  scenery: SceneryPreset;
  /** 圆窗 / 拱窗遮罩用的墙色 */
  wallColor: string;
}

export const THEMES: Record<RoomThemeId, RoomTheme> = {
  study: {
    id: "study",
    name: "书房",
    desc: "木地板、石墙裙，最初的样子",
    floor: "planks",
    ceiling: "darkPlanks",
    beams: "log",
    lower: "stoneBricks",
    upper: "plaster",
    lowerRows: 2,
    corner: "log",
    door: "darkPlanks",
    frame: "windowFrame",
    windows: { north: { from: 5, to: 8, y0: 3, y1: 4 }, east: { from: 4, to: 7, y0: 1, y1: 3 }, west: { from: 4, to: 6, y0: 2, y1: 3 } },
    windowStyle: "rect",
    daylight: 1,
    ambient: 0,
    scenery: "forest",
    wallColor: "#e6dac4",
  },
  minimal: {
    id: "minimal",
    name: "极简白屋",
    desc: "浅色墙、大窗，光线干净，适合长时间写作",
    floor: "lightOak",
    ceiling: "whiteWall",
    beams: null,
    lower: "whiteWall",
    upper: "whiteWall",
    lowerRows: 0,
    corner: "whiteWall",
    door: "lightOak",
    frame: "whitePlanks",
    windows: { north: { from: 3, to: 10, y0: 1, y1: 4 }, east: { from: 2, to: 9, y0: 1, y1: 4 }, west: { from: 3, to: 8, y0: 1, y1: 4 } },
    windowStyle: "rect",
    daylight: 1.15,
    ambient: 0.05,
    scenery: "city",
    wallColor: "#f1efe9",
  },
  cabin: {
    id: "cabin",
    name: "林间木屋",
    desc: "原木墙、壁炉、暖光",
    floor: "darkPlanks",
    ceiling: "darkPlanks",
    beams: "log",
    lower: "logWall",
    upper: "logWall",
    lowerRows: 0,
    corner: "log",
    door: "darkPlanks",
    frame: "log",
    windows: { north: { from: 5, to: 8, y0: 2, y1: 3 }, east: { from: 4, to: 7, y0: 1, y1: 2 } },
    windowStyle: "rect",
    fireplace: true,
    daylight: 0.85,
    ambient: 0.04,
    scenery: "mountains",
    wallColor: "#8a5a32",
  },
  tower: {
    id: "tower",
    name: "塔楼图书馆",
    desc: "石墙、拱窗、高高的天花板",
    floor: "stoneFloor",
    ceiling: "darkPlanks",
    beams: "darkPlanks",
    lower: "stoneBricks",
    upper: "stoneBricks",
    lowerRows: 0,
    corner: "stoneBricks",
    door: "darkPlanks",
    frame: "darkPlanks",
    windows: { north: { from: 6, to: 7, y0: 2, y1: 4 }, east: { from: 5, to: 6, y0: 1, y1: 4 }, west: { from: 5, to: 6, y0: 1, y1: 4 } },
    windowStyle: "arch",
    daylight: 0.8,
    ambient: 0.03,
    scenery: "fields",
    wallColor: "#8b8780",
  },
  lighthouse: {
    id: "lighthouse",
    name: "海边灯塔",
    desc: "圆窗、白墙蓝边，窗外是海",
    floor: "deckPlanks",
    ceiling: "whitePlanks",
    beams: null,
    lower: "lighthouseLower",
    upper: "lighthouseWall",
    lowerRows: 1,
    corner: "lighthouseWall",
    door: "deckPlanks",
    frame: "deckPlanks",
    windows: { north: { from: 5, to: 8, y0: 2, y1: 3 }, east: { from: 4, to: 7, y0: 1, y1: 2 }, west: { from: 4, to: 5, y0: 2, y1: 3 } },
    windowStyle: "round",
    daylight: 1,
    ambient: 0.02,
    scenery: "sea",
    wallColor: "#e9e6df",
  },
  cellar: {
    id: "cellar",
    name: "地下书库",
    desc: "没有窗，只有灯笼，最安静",
    floor: "darkCobble",
    ceiling: "cellarBricks",
    beams: "darkPlanks",
    lower: "cellarBricks",
    upper: "cellarBricks",
    lowerRows: 0,
    corner: "cellarBricks",
    door: "darkPlanks",
    frame: "darkPlanks",
    windows: {},
    windowStyle: "rect",
    daylight: 0.06,
    ambient: 0.22,
    scenery: "forest",
    wallColor: "#5a4a42",
  },
  washitsu: {
    id: "washitsu",
    name: "和室",
    desc: "纸拉窗、榻榻米，窗外是竹林",
    floor: "tatami",
    ceiling: "lightOak",
    beams: "darkPlanks",
    lower: "clayWall",
    upper: "clayWall",
    lowerRows: 0,
    corner: "darkPlanks",
    door: "lightOak",
    frame: "darkPlanks",
    windows: { north: { from: 4, to: 9, y0: 1, y1: 3 }, east: { from: 3, to: 8, y0: 1, y1: 3 }, west: { from: 4, to: 7, y0: 1, y1: 3 } },
    windowStyle: "shoji",
    daylight: 0.95,
    ambient: 0.04,
    scenery: "bamboo",
    wallColor: "#d9c9a8",
  },
};

export const THEME_ORDER: RoomThemeId[] = ["study", "minimal", "cabin", "tower", "lighthouse", "cellar", "washitsu"];

export function themeOf(id: unknown): RoomTheme {
  return THEMES[(typeof id === "string" && id in THEMES ? id : "study") as RoomThemeId];
}

export type Side = "north" | "east" | "west";

/** 窗洞在世界坐标中的包围盒（瞄准与拖放判定用） */
export function openingBox(side: Side, o: Opening, room: { w: number; d: number }): { min: [number, number, number]; max: [number, number, number] } {
  const y0 = o.y0 - 0.15;
  const y1 = o.y1 + 1;
  if (side === "north") return { min: [o.from, y0, -0.6], max: [o.to + 1, y1, 0.3] };
  if (side === "east") return { min: [room.w - 0.3, y0, o.from], max: [room.w + 0.6, y1, o.to + 1] };
  return { min: [-0.6, y0, o.from], max: [0.3, y1, o.to + 1] };
}

/** 墙上某格是否是窗洞 */
export function isOpening(ws: WindowSet, side: Side, a: number, y: number): boolean {
  const o = ws[side];
  return !!o && a >= o.from && a <= o.to && y >= o.y0 && y <= o.y1;
}
