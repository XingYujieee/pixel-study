// 唱片封面：按专辑名 / 歌手生成 32×32 的像素画（原创图案，不联网、不读取文件里的封面）。
// 同样的名字永远画出同一张；名字里有「雨、夜、海、星、山、花……」会画对应的景，其他的画抽象图案。
// 纯函数部分（coverPixels）可在测试里直接跑；coverCanvas 才用到 DOM。

export const COVER_SIZE = 32;

/** FNV-1a 32 位哈希 */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32：确定的伪随机数 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RGB = number; // 0xRRGGBB

/** 调好的几组配色：背景深、背景浅、主色、点缀、高光 */
const PALETTES: RGB[][] = [
  [0x1d2b53, 0x3b4a7a, 0xff77a8, 0xffccaa, 0xfff1e8],
  [0x2b1b2e, 0x5a3550, 0xf2a65a, 0xeec170, 0xfff4d6],
  [0x0f3b3a, 0x1f6f5c, 0x8fd694, 0xf4e285, 0xfdfcdc],
  [0x3a1f12, 0x7a3b1f, 0xe07a3f, 0xf6c177, 0xfff3d1],
  [0x14213d, 0x274c77, 0x6096ba, 0xa3cef1, 0xe7ecef],
  [0x2d1e3e, 0x5c3d7a, 0xc77dff, 0xffd166, 0xfdf0ff],
  [0x1b1b1b, 0x3d3d3d, 0xe63946, 0xf1faee, 0xa8dadc],
  [0x223127, 0x4a6b4f, 0xc9a66b, 0xe8d8a8, 0xf7f3e3],
  [0x3d0c11, 0x7b1e2b, 0xd65a5a, 0xf2b880, 0xfbe7c6],
  [0x0b2545, 0x13315c, 0xeef4ed, 0x8da9c4, 0xffd23f],
];

export type Motif = "rain" | "night" | "stars" | "sea" | "sun" | "mountain" | "forest" | "snow" | "flower" | "heart" | "city" | "fire" | "cat" | "piano" | "coffee" | "abstract";

const KEYWORDS: [Motif, RegExp][] = [
  ["rain", /雨|rain|storm|雷|thunder|阴|cloud|云/i],
  ["snow", /雪|冬|snow|winter|ice|冰|christmas|圣诞|frost/i],
  ["stars", /星|star|galaxy|宇宙|space|cosmic|银河|orbit|planet/i],
  ["night", /夜|晚|月|night|moon|midnight|dream|梦|sleep|眠|lullaby/i],
  ["sea", /海|sea|ocean|wave|浪|beach|岛|island|湖|lake|river|河|水|water|tide|surf/i],
  ["sun", /夏|日|阳|sun|summer|morning|dawn|晨|光|light|黄昏|sunset|dusk/i],
  ["mountain", /山|mountain|hill|旅|travel|road|路|journey|远方|wander|walk/i],
  ["forest", /林|森|树|tree|forest|wood|green|叶|leaf|garden|园/i],
  ["flower", /花|春|flower|spring|bloom|rose|樱|blossom|petal/i],
  ["heart", /爱|心|恋|love|heart|kiss|吻|sweet|甜|喜欢/i],
  ["city", /城|街|city|street|town|霓虹|neon|tokyo|东京|上海|london|伦敦|paris|metro|地铁|drive/i],
  ["fire", /火|fire|burn|热|hot|flame|焰|燃/i],
  ["cat", /猫|cat|kitty|meow|喵/i],
  ["piano", /琴|piano|jazz|爵士|classical|古典|sonata|奏鸣|nocturne|夜曲|etude|keys/i],
  ["coffee", /咖啡|coffee|cafe|café|茶|tea|latte|lofi|lo-fi|chill/i],
];

/** 按名字挑图案：先看关键词，没有就画抽象图 */
export function motifFor(title: string, artist = ""): Motif {
  const text = `${title} ${artist}`;
  for (const [m, re] of KEYWORDS) if (re.test(title)) return m;
  for (const [m, re] of KEYWORDS) if (re.test(text)) return m;
  return "abstract";
}

/** 画布：整数坐标的像素格 */
class Raster {
  readonly px: RGB[];
  constructor(readonly n: number, bg: RGB) {
    this.px = new Array(n * n).fill(bg);
  }
  set(x: number, y: number, c: RGB) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.n && y < this.n) this.px[y * this.n + x] = c;
  }
  get(x: number, y: number): RGB {
    return this.px[y * this.n + x];
  }
  rect(x: number, y: number, w: number, h: number, c: RGB) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  disc(cx: number, cy: number, r: number, c: RGB) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, c);
  }
  ring(cx: number, cy: number, r: number, w: number, c: RGB) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (d <= r && d > r - w) this.set(x, y, c);
      }
  }
  /** 竖直方向的分段渐变（像素风：几条色带） */
  bands(y0: number, y1: number, colors: RGB[]) {
    const h = y1 - y0;
    for (let y = y0; y < y1; y++) {
      const k = Math.min(colors.length - 1, Math.floor(((y - y0) / h) * colors.length));
      this.rect(0, y, this.n, 1, colors[k]);
    }
  }
}

/** 两色之间取插值 */
export function mix(a: RGB, b: RGB, t: number): RGB {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/**
 * 生成封面像素：返回 32×32 个颜色（行优先）。
 * `seed` 是"换一张封面"的次数，改变它会换配色和细节，图案类型不变。
 */
export function coverPixels(title: string, artist = "", seed = 0): { px: RGB[]; motif: Motif; palette: RGB[] } {
  const N = COVER_SIZE;
  const h = hashString(`${title}\u0000${artist}\u0000${seed}`);
  const r = rng(h);
  const pal = PALETTES[h % PALETTES.length];
  const [dark, mid, main, accent, light] = pal;
  const motif = motifFor(title, artist);
  const g = new Raster(N, dark);
  const ri = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));

  switch (motif) {
    case "rain": {
      g.bands(0, N, [mix(dark, 0x2a3440, 0.6), mix(mid, 0x3a4a5a, 0.6), mix(mid, 0x50606e, 0.5)]);
      // 云
      for (let i = 0; i < 4; i++) g.disc(ri(4, 28), ri(4, 9), ri(3, 5), mix(0x9aa6b2, light, 0.2));
      g.rect(0, 0, N, 4, mix(0x8a96a2, dark, 0.3));
      // 斜雨丝
      for (let i = 0; i < 26; i++) {
        const x = ri(0, N), y = ri(10, N - 4);
        for (let k = 0; k < 3; k++) g.set(x - k, y + k, mix(0xa8c8e8, light, 0.3));
      }
      // 地上的水洼
      g.rect(0, N - 3, N, 3, mix(dark, 0x1a2430, 0.5));
      for (let i = 0; i < 4; i++) g.rect(ri(0, 26), N - 2, ri(3, 6), 1, mix(0x6a8aaa, main, 0.25));
      break;
    }
    case "night": {
      g.bands(0, N, [mix(dark, 0x0a1030, 0.6), mix(dark, 0x141c48, 0.5), mix(mid, 0x22306a, 0.5)]);
      for (let i = 0; i < 22; i++) g.set(ri(0, N - 1), ri(0, 20), r() < 0.3 ? light : mix(light, mid, 0.5));
      // 月牙
      const mx = ri(18, 24), my = ri(7, 11);
      const sky = g.get(mx, my);
      g.disc(mx, my, 6, 0xf6e7a8);
      g.disc(mx + 3, my - 2, 5.2, sky);
      // 远处的屋顶和一扇亮着的窗
      g.rect(0, N - 6, N, 6, 0x0b0d1c);
      g.rect(ri(3, 8), N - 10, 7, 4, 0x0b0d1c);
      g.rect(ri(16, 22), N - 9, 6, 3, 0x0b0d1c);
      g.rect(ri(4, 26), N - 4, 2, 2, 0xf6c86a);
      break;
    }
    case "stars": {
      g.bands(0, N, [0x070818, mix(dark, 0x0d0f2a, 0.5), mix(mid, 0x1b1340, 0.5)]);
      for (let i = 0; i < 40; i++) g.set(ri(0, N - 1), ri(0, N - 1), r() < 0.25 ? light : mix(light, dark, 0.55));
      // 一颗带环的行星
      const px = ri(10, 20), py = ri(12, 20);
      g.disc(px, py, 7, main);
      g.disc(px - 2, py - 2, 4, mix(main, light, 0.35));
      for (let x = -12; x <= 12; x++) g.set(px + x, py + Math.round(x * 0.25), accent);
      // 十字星
      const sx = ri(24, 29), sy = ri(3, 8);
      g.rect(sx - 2, sy, 5, 1, light);
      g.rect(sx, sy - 2, 1, 5, light);
      break;
    }
    case "sea": {
      const horizon = ri(14, 18);
      g.bands(0, horizon, [mix(main, 0x87b8e0, 0.5), mix(light, 0xbfe0f4, 0.5)]);
      g.disc(ri(8, 24), horizon - 3, 4, mix(accent, 0xffe08a, 0.4));
      g.bands(horizon, N, [0x2f6fb0, 0x24578f, 0x1a426e]);
      for (let y = horizon + 2; y < N; y += 3) for (let x = (y * 3) % 6; x < N; x += 6) g.rect(x, y, 3, 1, 0x8fc7ef);
      // 小帆船
      const bx = ri(4, 24);
      g.rect(bx, horizon - 1, 6, 2, 0x5e3c20);
      g.rect(bx + 3, horizon - 7, 1, 6, 0x5e3c20);
      g.rect(bx + 4, horizon - 6, 3, 4, light);
      break;
    }
    case "sun": {
      g.bands(0, N, [mix(dark, 0x6a2c5a, 0.5), mix(main, 0xe8604a, 0.4), mix(accent, 0xf6a04a, 0.4), mix(accent, 0xffd27a, 0.5)]);
      const cx = N / 2 + ri(-4, 4), cy = ri(14, 18);
      g.disc(cx, cy, 9, mix(0xffe08a, light, 0.3));
      // 合成器风格的横条切口
      for (let k = 0; k < 4; k++) g.rect(0, cy + 2 + k * 2, N, 1, mix(accent, 0xf6a04a, 0.4));
      g.rect(0, N - 8, N, 8, mix(dark, 0x2a1630, 0.4));
      for (let x = 0; x < N; x += 4) g.set(x, N - 8, main);
      break;
    }
    case "mountain": {
      g.bands(0, N, [mix(light, 0xcfe4f0, 0.4), mix(main, 0x9cc2dc, 0.4), mix(mid, 0x7aa0c0, 0.3)]);
      // 一层层的山：几座三角形的峰，近处的更暗
      const layer = (base: number, amp: number, c: RGB, snow: boolean) => {
        const peaks = Array.from({ length: 3 }, () => ({ x: ri(-2, N + 2), hgt: ri(Math.floor(amp * 0.6), amp) }));
        for (let x = 0; x < N; x++) {
          let top = base;
          for (const pk of peaks) top = Math.min(top, base - pk.hgt + Math.abs(x - pk.x));
          g.rect(x, top, 1, N - top, c);
          if (snow) for (const pk of peaks) if (top <= base - pk.hgt + 2 && top < base - 3) g.rect(x, top, 1, 2, light);
        }
      };
      layer(18, 10, mix(mid, 0x5a6e8a, 0.4), true);
      layer(24, 6, mix(dark, 0x3a4e5a, 0.4), false);
      layer(29, 3, mix(dark, 0x223127, 0.5), false);
      g.disc(ri(4, 10), ri(4, 7), 2.5, accent);
      break;
    }
    case "forest": {
      g.bands(0, N, [mix(light, 0xe8f0d0, 0.4), mix(accent, 0xd8e8b0, 0.4)]);
      const tree = (x: number, base: number, size: number, c: RGB) => {
        for (let k = 0; k < size; k++) g.rect(x - Math.floor(k / 2), base - size + k, 1 + 2 * Math.floor(k / 2), 1, c);
        g.rect(x, base, 1, 2, 0x5e3c20);
      };
      for (let i = 0; i < 6; i++) tree(ri(1, 30), ri(16, 20), ri(8, 12), mix(0x4f9a3c, mid, 0.4));
      for (let i = 0; i < 5; i++) tree(ri(1, 30), ri(24, 28), ri(10, 14), mix(0x2e6b2a, dark, 0.3));
      g.rect(0, N - 3, N, 3, mix(0x2e6b2a, dark, 0.5));
      break;
    }
    case "snow": {
      g.bands(0, N, [mix(mid, 0x8fb0d0, 0.5), mix(light, 0xd8e8f4, 0.5)]);
      g.rect(0, N - 8, N, 8, 0xf4f8fc);
      for (let x = 0; x < N; x++) if (r() < 0.4) g.set(x, N - 9, 0xf4f8fc);
      // 小屋
      const hx = ri(4, 18);
      g.rect(hx, N - 14, 10, 6, mix(main, 0x9a5a3a, 0.4));
      for (let k = 0; k < 6; k++) g.rect(hx - 1 + k, N - 15 - k, 12 - 2 * k, 1, 0xf4f8fc);
      g.rect(hx + 4, N - 12, 2, 2, 0xf6c86a);
      for (let i = 0; i < 30; i++) g.set(ri(0, N - 1), ri(0, N - 10), 0xffffff);
      break;
    }
    case "flower": {
      g.bands(0, N, [mix(light, 0xfbe7ef, 0.4), mix(accent, 0xf6d8e0, 0.4)]);
      g.rect(0, N - 6, N, 6, mix(0x6ab04c, mid, 0.2));
      const colors = [main, accent, 0xf48fb1, 0xffffff, 0xffd166];
      for (let i = 0; i < 7; i++) {
        const x = ri(3, 28), y = ri(8, 22), c = colors[ri(0, colors.length - 1)];
        g.rect(x, y, 1, N - 6 - y, 0x4f9a3c);
        g.rect(x - 2, y - 1, 5, 3, c);
        g.rect(x - 1, y - 2, 3, 5, c);
        g.set(x, y, 0xffd166);
      }
      break;
    }
    case "heart": {
      g.bands(0, N, [mix(dark, 0x4a1030, 0.4), mix(mid, 0x7a2050, 0.4)]);
      for (let y = 0; y < N; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < N; x += 4) g.set(x, y, mix(mid, main, 0.4));
      const cx = 16, cy = 15;
      for (let y = -10; y <= 10; y++)
        for (let x = -11; x <= 11; x++) {
          const X = x / 8, Y = -y / 8 + 0.15;
          if ((X * X + Y * Y - 1) ** 3 - X * X * Y * Y * Y <= 0) g.set(cx + x, cy + y, mix(main, 0xe83a5a, 0.4));
        }
      g.rect(cx - 6, cy - 4, 2, 2, light);
      break;
    }
    case "city": {
      g.bands(0, N, [mix(dark, 0x1a1040, 0.5), mix(main, 0x8a3a8a, 0.4), mix(accent, 0xf08a5a, 0.4)]);
      let x = 0;
      while (x < N) {
        const w = ri(3, 6), hgt = ri(8, 20);
        const c = mix(0x14142a, dark, r() * 0.4);
        g.rect(x, N - hgt, w, hgt, c);
        for (let wy = N - hgt + 2; wy < N - 2; wy += 3) for (let wx = x + 1; wx < x + w - 1; wx += 2) if (r() < 0.45) g.set(wx, wy, r() < 0.5 ? 0xf6c86a : accent);
        x += w + (r() < 0.3 ? 1 : 0);
      }
      break;
    }
    case "fire": {
      g.bands(0, N, [0x1a0a08, mix(dark, 0x3a1008, 0.5)]);
      for (let x = 0; x < N; x++) {
        const hgt = 8 + Math.round(8 * Math.abs(Math.sin(x * 0.45 + r() * 0.6)) + r() * 4);
        for (let y = 0; y < hgt; y++) {
          const t = y / hgt;
          g.set(x, N - 1 - y, t < 0.35 ? 0xffe08a : t < 0.7 ? 0xf6893a : 0xc8322a);
        }
      }
      for (let i = 0; i < 12; i++) g.set(ri(0, N - 1), ri(2, 12), 0xf6c86a);
      break;
    }
    case "cat": {
      g.bands(0, N, [mix(light, 0xf4e4c8, 0.3), mix(accent, 0xf0d0a0, 0.3)]);
      const fur = mix(main, 0xe8913a, 0.5);
      g.disc(16, 18, 10, fur);
      // 尖耳朵
      for (let k = 0; k < 7; k++) {
        g.rect(9 - Math.floor(k / 3), 3 + k, 1 + k, 1, fur);
        g.rect(23 - k + Math.floor(k / 3), 3 + k, 1 + k, 1, fur);
      }
      g.rect(11, 15, 3, 3, 0x1c1c22);
      g.rect(18, 15, 3, 3, 0x1c1c22);
      g.set(12, 15, 0xffffff);
      g.set(19, 15, 0xffffff);
      g.rect(15, 20, 2, 1, 0xd86a7a);
      g.rect(4, 21, 7, 1, 0x5e3c20);
      g.rect(21, 21, 7, 1, 0x5e3c20);
      break;
    }
    case "piano": {
      g.bands(0, N, [dark, mix(dark, mid, 0.5)]);
      const top = ri(14, 18);
      g.rect(0, top, N, N - top, 0xf4f0e8);
      for (let x = 3; x < N; x += 4) g.rect(x, top, 1, N - top, 0x9a9a98);
      for (let x = 2; x < N; x += 4) if (x % 28 !== 14) g.rect(x, top, 2, Math.floor((N - top) * 0.6), 0x1c1c22);
      // 音符
      const nx = ri(6, 22);
      g.rect(nx, 3, 1, 7, light);
      g.rect(nx + 6, 2, 1, 7, light);
      g.rect(nx, 2, 7, 2, light);
      g.disc(nx - 1, 10, 1.6, light);
      g.disc(nx + 5, 9, 1.6, light);
      break;
    }
    case "coffee": {
      g.bands(0, N, [mix(light, 0xf0e0c8, 0.3), mix(accent, 0xe0c8a0, 0.3)]);
      g.rect(0, N - 6, N, 6, mix(0x7a4a2a, dark, 0.3));
      g.rect(8, 13, 14, 12, mix(main, 0xf4f0e8, 0.6));
      g.rect(9, 14, 12, 2, 0x4a2a14);
      g.ring(23, 18, 4, 2, mix(main, 0xf4f0e8, 0.6));
      g.rect(6, 25, 18, 2, mix(main, 0xf4f0e8, 0.4));
      for (let k = 0; k < 3; k++) for (let y = 4; y < 11; y++) g.set(11 + k * 4 + (y % 3 === 0 ? 1 : 0), y, 0xffffff);
      break;
    }
    default: {
      // 抽象：几种几何构图
      const style = ri(0, 4);
      if (style === 0) {
        for (let k = 6; k >= 1; k--) g.disc(16, 16, k * 2.6, [dark, mid, main, accent, light, main][k % 5]);
      } else if (style === 1) {
        for (let y = 0; y < N; y++) g.rect(0, y, N, 1, [dark, mid, main, accent][Math.floor(y / 4) % 4]);
        g.disc(ri(8, 24), ri(8, 24), 7, light);
      } else if (style === 2) {
        for (let y = 0; y < N; y += 8) for (let x = 0; x < N; x += 8) g.rect(x, y, 8, 8, [mid, main, accent, dark][ri(0, 3)]);
        g.ring(16, 16, 10, 2, light);
      } else if (style === 3) {
        g.bands(0, N, [dark, mid]);
        for (let i = 0; i < 5; i++) {
          const x = ri(0, 24), y = ri(0, 24), s = ri(5, 10);
          for (let k = 0; k < s; k++) g.rect(x + k, y + s - k, s - k, 1, [main, accent, light][i % 3]);
        }
      } else {
        g.bands(0, N, [mid, dark]);
        for (let i = 0; i < 6; i++) g.rect(ri(0, 28), 0, ri(1, 4), N, [main, accent, light][i % 3]);
        g.rect(0, ri(18, 24), N, 3, dark);
      }
    }
  }
  // 唱片封套边：左上一点磨损高光、右下一点阴影
  for (let i = 0; i < N; i++) {
    g.set(i, N - 1, mix(g.get(i, N - 1), 0x000000, 0.35));
    g.set(N - 1, i, mix(g.get(N - 1, i), 0x000000, 0.35));
    g.set(i, 0, mix(g.get(i, 0), 0xffffff, 0.15));
    g.set(0, i, mix(g.get(0, i), 0xffffff, 0.15));
  }
  return { px: g.px, motif, palette: pal };
}

const canvasCache = new Map<string, HTMLCanvasElement>();

/** 画到 canvas（缓存）。放大时用最近邻，保持像素感 */
export function coverCanvas(title: string, artist = "", seed = 0): HTMLCanvasElement {
  const key = `${title}\u0000${artist}\u0000${seed}`;
  let c = canvasCache.get(key);
  if (c) return c;
  const { px } = coverPixels(title, artist, seed);
  c = document.createElement("canvas");
  c.width = c.height = COVER_SIZE;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(COVER_SIZE, COVER_SIZE);
  px.forEach((rgb, i) => {
    img.data[i * 4] = (rgb >> 16) & 255;
    img.data[i * 4 + 1] = (rgb >> 8) & 255;
    img.data[i * 4 + 2] = rgb & 255;
    img.data[i * 4 + 3] = 255;
  });
  ctx.putImageData(img, 0, 0);
  if (canvasCache.size > 400) canvasCache.clear();
  canvasCache.set(key, c);
  return c;
}

/** 给界面用的图片地址 */
export function coverDataUrl(title: string, artist = "", seed = 0): string {
  return coverCanvas(title, artist, seed).toDataURL();
}
