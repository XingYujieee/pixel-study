// 把一张照片变成像素画：区域平均缩小 → 中位切分得到调色板 → 每个像素映射到最近颜色。
// 纯函数处理 RGBA 数组；canvas 相关的读写在最后两个函数里。

export interface PixelArt {
  width: number;
  height: number;
  /** RGBA */
  data: Uint8ClampedArray;
  palette: [number, number, number][];
}

/** 区域平均缩小到 w × h（不透明） */
export function downsample(src: Uint8ClampedArray, sw: number, sh: number, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * sh) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * sw) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / w));
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * sw + xx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          n++;
        }
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** 中位切分调色板 */
export function medianCut(data: Uint8ClampedArray, k: number): [number, number, number][] {
  const pixels: [number, number, number][] = [];
  for (let i = 0; i < data.length; i += 4) pixels.push([data[i], data[i + 1], data[i + 2]]);
  if (pixels.length === 0) return [[0, 0, 0]];
  let boxes: [number, number, number][][] = [pixels];
  while (boxes.length < k) {
    // 选范围最大的盒子切分
    let best = -1;
    let bestRange = -1;
    let bestCh = 0;
    boxes.forEach((box, bi) => {
      if (box.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255,
          hi = 0;
        for (const p of box) {
          if (p[ch] < lo) lo = p[ch];
          if (p[ch] > hi) hi = p[ch];
        }
        if (hi - lo > bestRange) {
          bestRange = hi - lo;
          best = bi;
          bestCh = ch;
        }
      }
    });
    if (best === -1 || bestRange <= 0) break;
    const box = boxes[best].sort((a, b) => a[bestCh] - b[bestCh]);
    const mid = box.length >> 1;
    boxes = [...boxes.slice(0, best), box.slice(0, mid), box.slice(mid), ...boxes.slice(best + 1)];
  }
  return boxes.map((box) => {
    const s = box.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
    return [Math.round(s[0] / box.length), Math.round(s[1] / box.length), Math.round(s[2] / box.length)] as [number, number, number];
  });
}

/** 提高饱和度与对比度，让像素画更鲜明 */
export function punch(data: Uint8ClampedArray, saturation = 1.2, contrast = 1.06): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    for (let c = 0; c < 3; c++) {
      const v = data[i + c];
      const sat = l + (v - l) * saturation;
      data[i + c] = (sat - 128) * contrast + 128;
    }
  }
}

export function nearest(palette: [number, number, number][], r: number, g: number, b: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    // 按人眼敏感度加权
    const d = 2 * (p[0] - r) ** 2 + 4 * (p[1] - g) ** 2 + 3 * (p[2] - b) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

export function pixelate(src: Uint8ClampedArray, sw: number, sh: number, targetWidth: number, colors: number): PixelArt {
  const width = Math.max(8, Math.min(targetWidth, sw));
  const height = Math.max(4, Math.round((sh / sw) * width));
  const small = downsample(src, sw, sh, width, height);
  punch(small);
  const palette = medianCut(small, colors);
  const data = new Uint8ClampedArray(small.length);
  for (let i = 0; i < small.length; i += 4) {
    const p = palette[nearest(palette, small[i], small[i + 1], small[i + 2])];
    data[i] = p[0];
    data[i + 1] = p[1];
    data[i + 2] = p[2];
    data[i + 3] = 255;
  }
  return { width, height, data, palette };
}

/** 像天空的颜色：偏蓝，或很亮且不饱和（白云、阴天），或日落时的暖亮色 */
function skyLike(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  if (b > r + 8 && b >= g - 10 && lum > 70) return true;
  if (lum > 175 && sat < 0.22) return true;
  if (lum > 150 && r > b && sat < 0.55 && g > 110) return true;
  return false;
}

/**
 * 把与上边缘相连、看起来像天空的像素变透明（洪水填充，相邻颜色差不大才继续）。
 * 只处理上面 75% 的高度，避免把湖面当成天空。返回变透明的像素数。
 */
export function keySky(data: Uint8ClampedArray, w: number, h: number): number {
  const limit = Math.floor(h * 0.75);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) {
    const i = x * 4;
    if (skyLike(data[i], data[i + 1], data[i + 2])) {
      stack.push(x);
      seen[x] = 1;
    }
  }
  let n = 0;
  const near = (a: number, b: number) =>
    Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2]) < 75;
  const lum = (a: number) => 0.3 * data[a] + 0.59 * data[a + 1] + 0.11 * data[a + 2];
  // 天空最暗也就顶上那一行那么暗；比它暗得多的（远山、树影）不算天空
  let skyMin = 255;
  for (const p of stack) skyMin = Math.min(skyMin, lum(p * 4));
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    const i = p * 4;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= limit) continue;
      const q = ny * w + nx;
      if (seen[q]) continue;
      const j = q * 4;
      if (!skyLike(data[j], data[j + 1], data[j + 2]) || !near(i, j)) continue;
      // 往下走时天空一般越来越亮；突然变暗多半是远山、楼顶，停下
      if (dy === 1 && lum(j) < lum(i) - 14) continue;
      if (lum(j) < skyMin - 16) continue;
      seen[q] = 1;
      stack.push(q);
    }
  }
  // 第二遍：完全被天空包围、颜色也像天空的小块（白云）一并抠掉；碰到地面或下边界的不算
  const visited = new Uint8Array(w * h);
  for (let start = 0; start < w * limit; start++) {
    if (seen[start] || visited[start]) continue;
    const si = start * 4;
    if (!skyLike(data[si], data[si + 1], data[si + 2])) continue;
    const comp: number[] = [];
    const st = [start];
    visited[start] = 1;
    let enclosed = true;
    while (st.length) {
      const p = st.pop()!;
      comp.push(p);
      const x = p % w;
      const y = (p - x) / w;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0) continue;
        if (ny >= limit) {
          enclosed = false;
          continue;
        }
        const q = ny * w + nx;
        if (seen[q] || visited[q]) continue;
        const j = q * 4;
        if (skyLike(data[j], data[j + 1], data[j + 2])) {
          visited[q] = 1;
          st.push(q);
        } else enclosed = false;
      }
    }
    if (enclosed && comp.length <= w * h * 0.15) for (const p of comp) seen[p] = 1;
  }
  for (let p = 0; p < w * h; p++)
    if (seen[p]) {
      data[p * 4 + 3] = 0;
      n++;
    }
  return n;
}

/** 从用户选择的图片文件生成像素画 PNG（data URL）。sky 为 true 时把天空抠成透明 */
export async function pixelateFile(file: Blob, targetWidth: number, colors: number, sky = false): Promise<{ url: string; art: PixelArt; keyed: number }> {
  const bmp = await createImageBitmap(file);
  // 先缩到不超过 1024 宽，加快处理
  const scale = Math.min(1, 2048 / bmp.width);
  const sw = Math.max(1, Math.round(bmp.width * scale));
  const sh = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  const g = c.getContext("2d")!;
  g.drawImage(bmp, 0, 0, sw, sh);
  const src = g.getImageData(0, 0, sw, sh).data;
  const art = pixelate(src, sw, sh, targetWidth, colors);
  const keyed = sky ? keySky(art.data, art.width, art.height) : 0;
  return { url: artToDataUrl(art), art, keyed };
}

export function artToDataUrl(art: PixelArt): string {
  const c = document.createElement("canvas");
  c.width = art.width;
  c.height = art.height;
  const g = c.getContext("2d")!;
  const img = g.createImageData(art.width, art.height);
  img.data.set(art.data);
  g.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}
