// 物品栏图标：16×16 像素画，运行时用 canvas 绘制为 data URL（原创图案）。
import type { FurnitureType } from "./layout";

type Px = [number, number, number, number, string];

function draw(rects: Px[]): string {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const g = c.getContext("2d")!;
  for (const [x, y, w, h, color] of rects) {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  }
  return c.toDataURL();
}

const WOOD = "#9a6a3a";
const WOOD_D = "#5e3c20";
const WOOD_L = "#c48f55";

const ICONS: Record<FurnitureType | "hand", () => string> = {
  stairs: () =>
    draw([
      [10, 2, 4, 12, WOOD],
      [7, 5, 7, 9, WOOD],
      [4, 8, 10, 6, WOOD],
      [1, 11, 13, 3, WOOD],
      [10, 2, 4, 1, WOOD_L],
      [7, 5, 3, 1, WOOD_L],
      [4, 8, 3, 1, WOOD_L],
      [1, 11, 3, 1, WOOD_L],
      [1, 14, 13, 1, WOOD_D],
    ]),
  hand: () =>
    draw([
      [5, 3, 2, 7, "#e7b98f"],
      [7, 2, 2, 8, "#e7b98f"],
      [9, 3, 2, 7, "#e7b98f"],
      [11, 5, 2, 5, "#e7b98f"],
      [3, 8, 2, 3, "#e7b98f"],
      [4, 9, 9, 4, "#e7b98f"],
      [5, 13, 7, 2, "#d19a72"],
      [5, 3, 1, 7, "#c98d66"],
    ]),
  bookshelf: () =>
    draw([
      [1, 1, 14, 14, WOOD_D],
      [2, 2, 12, 5, "#2e2016"],
      [2, 9, 12, 5, "#2e2016"],
      [1, 7, 14, 2, WOOD],
      [2, 2, 2, 5, "#b9483a"],
      [4, 3, 2, 4, "#d9a640"],
      [6, 2, 1, 5, "#4f7a45"],
      [7, 3, 2, 4, "#3d5f8f"],
      [10, 2, 2, 5, "#7c4a7a"],
      [12, 4, 2, 3, "#e8dcc2"],
      [2, 10, 2, 4, "#3d5f8f"],
      [4, 9, 1, 5, "#c27a28"],
      [5, 10, 2, 4, "#a83a32"],
      [8, 9, 2, 5, "#e8dcc2"],
      [10, 10, 2, 4, "#4f7a45"],
      [12, 9, 2, 5, "#8f3a52"],
    ]),
  desk: () =>
    draw([
      [1, 6, 14, 2, WOOD_L],
      [1, 8, 14, 1, WOOD_D],
      [2, 9, 2, 6, WOOD_D],
      [12, 9, 2, 6, WOOD_D],
      [9, 9, 4, 4, WOOD],
      [4, 4, 6, 2, "#f3e9d2"],
      [7, 4, 1, 2, "#8a6a4a"],
      [12, 1, 1, 5, "#f0f0f0"],
      [11, 2, 1, 2, "#dcdcdc"],
    ]),
  workbench: () =>
    draw([
      [1, 1, 14, 14, WOOD],
      [1, 1, 14, 4, WOOD_L],
      [1, 5, 14, 1, WOOD_D],
      [5, 1, 1, 4, WOOD_D],
      [10, 1, 1, 4, WOOD_D],
      [3, 7, 4, 2, "#b9b9b4"],
      [4, 9, 1, 5, "#4a2f18"],
      [9, 7, 5, 4, "#b9b9b4"],
      [12, 6, 2, 2, "#4a2f18"],
    ]),
  aibench: () =>
    draw([
      [2, 9, 12, 6, "#2f2b3a"],
      [2, 9, 12, 1, "#4a4458"],
      [4, 11, 6, 1, "#1f7d77"],
      [4, 11, 1, 3, "#1f7d77"],
      [6, 2, 4, 4, "#5fe3d6"],
      [7, 3, 2, 2, "#ffffff"],
      [5, 3, 1, 2, "#2aa69b"],
      [10, 3, 1, 2, "#2aa69b"],
      [7, 1, 2, 1, "#2aa69b"],
      [7, 6, 2, 1, "#2aa69b"],
    ]),
  chest: () =>
    draw([
      [1, 2, 14, 13, "#8f5d2e"],
      [1, 2, 14, 1, "#3a2a1c"],
      [1, 7, 14, 1, "#3a2a1c"],
      [1, 14, 14, 1, "#3a2a1c"],
      [1, 2, 1, 13, "#3a2a1c"],
      [14, 2, 1, 13, "#3a2a1c"],
      [7, 6, 2, 3, "#d9c27a"],
      [2, 3, 12, 1, "#a8743f"],
    ]),
  lantern: () =>
    draw([
      [7, 0, 2, 2, "#34302c"],
      [5, 2, 6, 2, "#34302c"],
      [5, 4, 6, 8, "#34302c"],
      [6, 5, 4, 6, "#ffcf6e"],
      [7, 6, 2, 3, "#fff1c4"],
      [4, 12, 8, 2, "#34302c"],
    ]),
  plant: () =>
    draw([
      [4, 10, 8, 5, "#b5653f"],
      [4, 10, 8, 1, "#d0835a"],
      [3, 4, 5, 6, "#4f8a3c"],
      [7, 2, 6, 7, "#5e9c46"],
      [6, 6, 3, 4, "#2f5e26"],
      [9, 3, 2, 2, "#7dbb5a"],
    ]),
  pond: () =>
    draw([
      [1, 6, 14, 9, "#7d7d78"],
      [2, 7, 12, 7, "#2f6fb0"],
      [3, 8, 4, 1, "#5b9bd8"],
      [8, 11, 5, 1, "#5b9bd8"],
      [3, 11, 3, 2, "#4f9a3c"],
      [12, 1, 1, 9, "#c8a070"],
      [11, 2, 1, 1, "#c8a070"],
      [9, 9, 1, 1, "#d8423a"],
      [10, 3, 1, 6, "#eeeeee"],
    ]),
  jukebox: () =>
    draw([
      [2, 9, 12, 6, "#9a6a3a"],
      [2, 8, 12, 1, "#5e3c20"],
      [3, 7, 7, 1, "#1c1c22"],
      [5, 7, 2, 1, "#c8423a"],
      [10, 4, 2, 4, "#d9a84a"],
      [9, 2, 4, 2, "#d9a84a"],
      [8, 1, 6, 1, "#e8c070"],
      [7, 11, 2, 1, "#d9a84a"],
    ]),
  carpet: () =>
    draw([
      [1, 5, 14, 7, "#8c2f2a"],
      [1, 5, 14, 1, "#d8a64a"],
      [1, 11, 14, 1, "#d8a64a"],
      [7, 7, 2, 3, "#d8a64a"],
      [5, 8, 6, 1, "#d8a64a"],
    ]),
};

const cache = new Map<string, string>();

export function iconUrl(type: FurnitureType | "hand"): string {
  let u = cache.get(type);
  if (!u) {
    u = ICONS[type]();
    cache.set(type, u);
  }
  return u;
}
