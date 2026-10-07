// 墙上东西的外观：黑板上的粉笔字、画框里的图。纯画布绘制（原创）。
import * as THREE from "three";
import { pixelate } from "./pixelate";
import { boardLines, type WallItem } from "./wall";

const PX_PER_BLOCK = 96;

function texFrom(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function crisp(g: CanvasRenderingContext2D, w: number, h: number) {
  // 文字去掉抗锯齿，保持像素感
  const d = g.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) {
    if (d.data[i + 3] > 0 && d.data[i + 3] < 255) d.data[i + 3] = d.data[i + 3] > 100 ? 255 : 0;
  }
  g.putImageData(d, 0, 0);
}

/** 黑板：深绿底、木边，粉笔写的笔记开头几行 */
export function boardTexture(it: Pick<WallItem, "w" | "h">, title: string | null, md: string | null): THREE.CanvasTexture {
  const w = Math.round(it.w * PX_PER_BLOCK);
  const h = Math.round(it.h * PX_PER_BLOCK);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2f4a3a";
  g.fillRect(0, 0, w, h);
  // 擦过的痕迹
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.04})`;
    g.fillRect(Math.floor(r() * w), Math.floor(r() * h), 2 + Math.floor(r() * 6), 1);
  }
  g.textBaseline = "top";
  const font = (px: number) => `${px}px "Fusion Pixel", "PingFang SC", sans-serif`;
  const fit = (s: string, max: number) => {
    let t = s;
    while (g.measureText(t).width > max && t.length > 1) t = t.slice(0, -1);
    return t === s ? s : `${t.slice(0, -1)}…`;
  };
  if (!md && !title) {
    g.font = font(12);
    g.fillStyle = "rgba(240,240,230,0.7)";
    g.textAlign = "center";
    g.fillText("空手点一下", w / 2, h / 2 - 16);
    g.fillText("钉一篇笔记上来", w / 2, h / 2 + 2);
    crisp(g, w, h);
    return texFrom(c);
  }
  let y = 8;
  const x0 = 10;
  if (title) {
    g.font = font(12);
    g.fillStyle = "#ffe98a";
    g.fillText(fit(title, w - 20), x0, y);
    y += 18;
    g.fillStyle = "rgba(255,233,138,0.5)";
    g.fillRect(x0, y - 4, w - 20, 1);
    y += 2;
  }
  g.font = font(12);
  for (const line of boardLines(md ?? "", 20)) {
    if (y > h - 16) break;
    let x = x0;
    g.fillStyle = line.kind === "h" ? "#ffe98a" : line.kind === "done" ? "rgba(235,235,225,0.55)" : "#f0f0e6";
    if (line.kind === "todo" || line.kind === "done") {
      g.strokeStyle = g.fillStyle;
      g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 2.5, 8, 8);
      if (line.kind === "done") {
        g.fillRect(x + 2, y + 6, 2, 2);
        g.fillRect(x + 4, y + 7, 2, 2);
        g.fillRect(x + 6, y + 3, 2, 4);
      }
      x += 13;
    } else if (line.kind === "li") {
      g.fillRect(x + 2, y + 6, 3, 3);
      x += 10;
    }
    const text = fit(line.text, w - x - 8);
    g.fillText(text, x, y);
    if (line.kind === "done") g.fillRect(x, y + 7, Math.min(g.measureText(text).width, w - x - 8), 1);
    y += 16;
  }
  crisp(g, w, h);
  return texFrom(c);
}

/** 画框里还没有图时：浅色底上一座小山和太阳 */
export function emptyFrameTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e8e2d0";
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = "#9ab8d0";
  g.fillRect(0, 0, 32, 20);
  g.fillStyle = "#f2d36a";
  g.fillRect(22, 5, 5, 5);
  g.fillStyle = "#6a8a5a";
  for (let x = 0; x < 32; x++) g.fillRect(x, 20 - Math.max(0, 9 - Math.abs(x - 12)), 1, 12);
  return texFrom(c);
}

/** 画框里的图：按画框比例裁切（cover），可选像素化 */
export async function frameTexture(it: Pick<WallItem, "w" | "h" | "pixel">, url: string): Promise<THREE.CanvasTexture> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("图片读取失败"));
    i.src = url;
  });
  const ratio = it.w / it.h;
  // 先裁成画框比例
  let sw = img.width;
  let sh = img.height;
  let sx = 0;
  let sy = 0;
  if (sw / sh > ratio) {
    sw = sh * ratio;
    sx = (img.width - sw) / 2;
  } else {
    sh = sw / ratio;
    sy = (img.height - sh) / 2;
  }
  const outW = it.pixel === false ? Math.min(1024, Math.round(sw)) : Math.round(40 * it.w);
  const outH = Math.round(outW / ratio);
  const c = document.createElement("canvas");
  if (it.pixel === false) {
    c.width = outW;
    c.height = outH;
    c.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  // 像素化：先缩到 4 倍再交给像素化流程
  const tmp = document.createElement("canvas");
  tmp.width = outW * 4;
  tmp.height = outH * 4;
  const tg = tmp.getContext("2d")!;
  tg.drawImage(img, sx, sy, sw, sh, 0, 0, tmp.width, tmp.height);
  const art = pixelate(tg.getImageData(0, 0, tmp.width, tmp.height).data, tmp.width, tmp.height, outW, 24);
  c.width = art.width;
  c.height = art.height;
  const g = c.getContext("2d")!;
  const id = g.createImageData(art.width, art.height);
  id.data.set(art.data);
  g.putImageData(id, 0, 0);
  return texFrom(c);
}
