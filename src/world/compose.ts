// 背景音乐的作曲器：按随机种子写一首安静的小曲（原创、每次不同）。纯函数，便于测试。
// 六种风格：钢琴独奏、八音盒、氛围长音、圆舞曲（竖琴 + 长笛）、慵懒电钢（带贝斯）、田园（吉他 + 陶笛）。
// 曲式是 A A' B A：开头的动机会重复、变化，中间换一段，再回来，听起来像"一首曲子"而不是随机音符。
// 旋律的重拍落在和弦音上，弱拍走音阶里的经过音；和弦进行按大调 / 小调挑，晚上和雨天多用小调。

export type Instrument = "piano" | "musicbox" | "pad" | "harp" | "flute" | "epiano" | "bass" | "guitar" | "ocarina";

export interface Note {
  /** MIDI 音高 */
  pitch: number;
  /** 开始时间（拍） */
  at: number;
  /** 时值（拍） */
  dur: number;
  /** 力度 0–1 */
  vel: number;
  inst: Instrument;
}

export type Style = "piano" | "musicbox" | "ambient" | "waltz" | "lofi" | "folk";

export const STYLE_NAMES: Record<Style, string> = {
  piano: "钢琴",
  musicbox: "八音盒",
  ambient: "氛围",
  waltz: "圆舞曲",
  lofi: "电钢琴",
  folk: "田园",
};

export interface Piece {
  tempo: number;
  /** 每小节几拍（圆舞曲 3 拍） */
  meter: number;
  beats: number;
  notes: Note[];
  /** 调名（显示用） */
  key: string;
  mood: "day" | "night";
  style: Style;
  /** 显示用的名字，例如「圆舞曲 · G 大调」 */
  title: string;
  /** 混响多少（氛围类更湿） */
  wet: number;
  /** 摇摆（电钢琴的八分音符后半拍推迟） */
  swing: number;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1000000) / 1000000;
  };
}

const KEYS: [string, number][] = [
  ["C", 60],
  ["D", 62],
  ["E♭", 63],
  ["E", 64],
  ["F", 65],
  ["G", 67],
  ["A", 69],
  ["B♭", 70],
];

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
/** 多利亚调式：小调但六级升高，温暖一点 */
const DORIAN = [0, 2, 3, 5, 7, 9, 10];

/** 和弦进行（音阶级数，从 0 开始），A 段与 B 段分开 */
const PROGS_MAJOR = {
  a: [
    [0, 4, 5, 3],
    [0, 5, 3, 4],
    [0, 3, 0, 4],
    [0, 2, 3, 4],
    [3, 4, 2, 5],
    [0, 3, 5, 4],
  ],
  b: [
    [5, 3, 0, 4],
    [3, 4, 2, 5],
    [1, 4, 0, 5],
    [3, 3, 0, 4],
  ],
};
const PROGS_MINOR = {
  a: [
    [0, 5, 2, 6],
    [0, 3, 4, 0],
    [0, 5, 3, 4],
    [0, 6, 5, 6],
    [0, 3, 6, 2],
  ],
  b: [
    [5, 2, 6, 4],
    [3, 0, 5, 4],
    [5, 6, 0, 4],
  ],
};

/** 和弦（三和弦或七和弦）在音阶里的音（相对主音的半音数） */
function chordTones(scale: number[], degree: number, seventh: boolean): number[] {
  return (seventh ? [0, 2, 4, 6] : [0, 2, 4]).map((k) => {
    const i = degree + k;
    return scale[i % 7] + 12 * Math.floor(i / 7);
  });
}

/** 离目标最近的、属于集合（模 12）的音 */
function snap(pitch: number, pcs: number[], tonic: number): number {
  for (let d = 0; d < 12; d++) {
    for (const s of [pitch - d, pitch + d]) if (pcs.includes((((s - tonic) % 12) + 12) % 12)) return s;
  }
  return pitch;
}

interface StyleSpec {
  tempo: [number, number];
  meter: number;
  lead: Instrument;
  /** 伴奏乐器 */
  comp: Instrument;
  bass: Instrument | null;
  /** 旋律音域（相对主音） */
  leadOct: number;
  /** 伴奏音域 */
  compOct: number;
  seventh: number;
  wet: number;
  swing: number;
  /** 旋律多密：越大音越多 */
  density: number;
}

const SPECS: Record<Style, StyleSpec> = {
  piano: { tempo: [62, 76], meter: 4, lead: "piano", comp: "piano", bass: null, leadOct: 12, compOct: -12, seventh: 0.25, wet: 0.32, swing: 0, density: 0.6 },
  musicbox: { tempo: [76, 92], meter: 4, lead: "musicbox", comp: "musicbox", bass: null, leadOct: 24, compOct: 12, seventh: 0.1, wet: 0.38, swing: 0, density: 0.7 },
  ambient: { tempo: [48, 58], meter: 4, lead: "piano", comp: "pad", bass: null, leadOct: 12, compOct: -12, seventh: 0.7, wet: 0.55, swing: 0, density: 0.3 },
  waltz: { tempo: [92, 116], meter: 3, lead: "flute", comp: "harp", bass: "harp", leadOct: 12, compOct: 0, seventh: 0.2, wet: 0.34, swing: 0, density: 0.65 },
  lofi: { tempo: [68, 80], meter: 4, lead: "epiano", comp: "epiano", bass: "bass", leadOct: 12, compOct: -12, seventh: 0.95, wet: 0.24, swing: 0.16, density: 0.5 },
  folk: { tempo: [84, 100], meter: 4, lead: "ocarina", comp: "guitar", bass: "guitar", leadOct: 12, compOct: -12, seventh: 0.1, wet: 0.28, swing: 0, density: 0.6 },
};

const DAY_STYLES: Style[] = ["piano", "musicbox", "waltz", "folk", "lofi", "piano"];
const NIGHT_STYLES: Style[] = ["piano", "ambient", "musicbox", "lofi", "ambient", "piano"];

/** 一个两小节的旋律动机：节奏 + 走向 */
interface Motif {
  /** 每个音：拍内位置、时值、相对上一音的级进（休止为 null） */
  cells: { at: number; dur: number; step: number | null }[];
}

function makeMotif(r: () => number, meter: number, density: number): Motif {
  const len = meter * 2;
  const cells: Motif["cells"] = [];
  let t = 0;
  const durs = meter === 3 ? [1, 1, 2, 0.5, 1.5, 3] : [1, 1, 2, 0.5, 1.5, 2, 0.5];
  while (t < len - 0.01) {
    let dur = durs[Math.floor(r() * durs.length)];
    // 稀疏的风格用长音
    if (r() > density && dur < 2) dur *= 2;
    dur = Math.min(dur, len - t);
    const rest = t > 0 && r() < 0.18;
    // 小步为主，偶尔跳进
    const step = rest ? null : t === 0 ? 0 : [-2, -1, -1, 1, 1, 2, 0, 3, -3][Math.floor(r() * 9)];
    cells.push({ at: t, dur, step });
    t += dur;
  }
  return { cells };
}

export const ALL_STYLES: Style[] = ["piano", "musicbox", "ambient", "waltz", "lofi", "folk"];

/** only：指定一种风格，或者允许的几种（按白天 / 夜里的偏好从中挑） */
export function compose(seed: number, mood: "day" | "night", only?: Style | Style[]): Piece {
  const r = rng(seed);
  const list = mood === "day" ? DAY_STYLES : NIGHT_STYLES;
  let style: Style;
  if (typeof only === "string") style = only;
  else {
    const allowed = only?.length ? only : ALL_STYLES;
    const pool = list.filter((st) => allowed.includes(st));
    const from = pool.length ? pool : allowed;
    style = from[Math.floor(r() * from.length)];
  }
  const sp = SPECS[style];
  const [keyName, tonic0] = KEYS[Math.floor(r() * KEYS.length)];
  // 音域别太高：主音放在 F3–E4 附近
  const tonic = tonic0 > 66 ? tonic0 - 12 : tonic0;
  const minor = mood === "night" ? r() < 0.8 : r() < 0.15;
  const scale = minor ? (style === "lofi" || style === "folk" ? DORIAN : MINOR) : MAJOR;
  const progs = minor ? PROGS_MINOR : PROGS_MAJOR;
  const progA = progs.a[Math.floor(r() * progs.a.length)];
  const progB = progs.b[Math.floor(r() * progs.b.length)];
  const tempo = Math.round(sp.tempo[0] + r() * (sp.tempo[1] - sp.tempo[0]));
  const meter = sp.meter;
  const sevenths = r() < sp.seventh;
  const notes: Note[] = [];
  const push = (n: Note) => notes.push(n);

  // 曲式：A（4 小节）A'（4）B（4）A（4），氛围曲短一点；偶尔加一个 4 小节的引子（只有伴奏）
  const intro = style !== "musicbox" && r() < 0.45 ? 2 : 0;
  const sections: ("A" | "A2" | "B" | "A3")[] = style === "ambient" ? ["A", "B", "A3"] : ["A", "A2", "B", "A3"];
  const bars = intro + sections.length * 4 + 1;
  const chordAt: number[][] = [];
  const chordPcs: number[][] = [];
  for (let b = 0; b < bars; b++) {
    const sec = b < intro ? "A" : sections[Math.min(sections.length - 1, Math.floor((b - intro) / 4))];
    const prog = sec === "B" ? progB : progA;
    let deg = b === bars - 1 ? 0 : prog[(b - intro + 4 * 16) % 4];
    // A' 和最后一段 A 的结尾落回主和弦（终止）
    if ((sec === "A2" || sec === "A3") && (b - intro) % 4 === 3) deg = 4;
    const tones = chordTones(scale, deg, sevenths && b !== bars - 1);
    chordAt.push(tones);
    chordPcs.push(tones.map((t) => ((t % 12) + 12) % 12));
  }

  // ── 伴奏 ──
  for (let b = 0; b < bars; b++) {
    const t0 = b * meter;
    const last = b === bars - 1;
    const tones = chordAt[b].map((t) => t + tonic + sp.compOct);
    const root = chordAt[b][0] + tonic + sp.compOct;
    const v = 0.3 + (b % 4 === 0 ? 0.06 : 0);
    if (last) {
      // 结尾：一个长长的主和弦
      for (const p of tones) push({ pitch: p, at: t0, dur: meter * 1.5, vel: 0.3, inst: sp.comp === "pad" ? "pad" : sp.comp });
      if (sp.bass) push({ pitch: root - 12, at: t0, dur: meter * 1.5, vel: 0.36, inst: sp.bass });
      continue;
    }
    switch (style) {
      case "piano": {
        // 分解和弦：根音 – 五音 – 三音 – 五音（或往上走）
        const pat = [
          [0, 2, 1, 2],
          [0, 1, 2, 3],
          [0, 2, 3, 2],
        ][seed % 3];
        const arp = [tones[0], tones[1], tones[2], tones[0] + 12];
        pat.forEach((k, i) => push({ pitch: arp[k], at: t0 + i, dur: 1.8, vel: i === 0 ? v + 0.08 : v - 0.04, inst: "piano" }));
        break;
      }
      case "musicbox": {
        // 八音盒：高音区快速分解，叮叮当当
        const arp = [tones[0], tones[1], tones[2], tones[1]];
        for (let i = 0; i < meter * 2; i++) push({ pitch: arp[i % 4], at: t0 + i * 0.5, dur: 0.8, vel: i % 2 === 0 ? 0.26 : 0.18, inst: "musicbox" });
        break;
      }
      case "ambient": {
        // 长音铺底：每小节一个和弦，慢慢起慢慢落
        for (const p of tones) push({ pitch: p, at: t0, dur: meter + 0.6, vel: 0.22, inst: "pad" });
        if (b % 2 === 0) push({ pitch: root - 12, at: t0, dur: meter * 2, vel: 0.2, inst: "pad" });
        break;
      }
      case "waltz": {
        // 圆舞曲：一拍低音，二、三拍和弦
        push({ pitch: root - 12, at: t0, dur: 1.2, vel: 0.4, inst: "harp" });
        for (const k of [1, 2]) for (const p of tones.slice(0, 3)) push({ pitch: p + 12, at: t0 + k, dur: 0.8, vel: 0.2, inst: "harp" });
        break;
      }
      case "lofi": {
        // 电钢琴：第一拍和"二拍半"按和弦，贝斯走根音
        for (const p of tones) push({ pitch: p + 12, at: t0, dur: 1.4, vel: 0.26, inst: "epiano" });
        for (const p of tones) push({ pitch: p + 12, at: t0 + 2.5, dur: 1.2, vel: 0.2, inst: "epiano" });
        push({ pitch: root - 12, at: t0, dur: 1.5, vel: 0.42, inst: "bass" });
        push({ pitch: root - 12 + (r() < 0.5 ? 7 : 12), at: t0 + 2.5, dur: 1, vel: 0.34, inst: "bass" });
        break;
      }
      case "folk": {
        // 吉他：低音交替 + 上面的和弦音（像拨弦的指法）
        const hi = [tones[1] + 12, tones[2] + 12, tones[0] + 24];
        for (let i = 0; i < 4; i++) {
          push({ pitch: i % 2 === 0 ? root - 12 : root - 5, at: t0 + i, dur: 1, vel: 0.32, inst: "guitar" });
          push({ pitch: hi[i % 3], at: t0 + i + 0.5, dur: 0.8, vel: 0.2, inst: "guitar" });
        }
        break;
      }
    }
  }

  // ── 旋律 ──
  const motifA = makeMotif(r, meter, sp.density);
  const motifB = makeMotif(r, meter, sp.density * 0.9);
  const scalePcs = scale.map((s) => s % 12);
  const leadBase = tonic + sp.leadOct;
  const lo = leadBase - 5,
    hi = leadBase + 14;
  let pitch = leadBase + scale[2];
  const playMotif = (m: Motif, startBar: number, variant: number, endOnTonic: boolean) => {
    for (let half = 0; half < 2; half++) {
      const bar0 = startBar + half * 2;
      const cells = m.cells;
      cells.forEach((c, ci) => {
        if (c.step === null) return;
        const at = bar0 * meter + c.at;
        const bar = Math.floor(at / meter);
        if (bar >= bars - 1) return;
        const strong = Math.abs(at % meter) < 0.01 || (meter === 4 && Math.abs((at % meter) - 2) < 0.01);
        // 第二次出现时做点变化：后半句换方向
        let step = c.step;
        if (variant && half === 1 && ci > cells.length / 2) step = -step;
        let target = pitch + step * 2;
        if (target > hi) target -= 5;
        if (target < lo) target += 5;
        // 重拍落在和弦音上，弱拍落在音阶里
        const pcs = strong ? chordPcs[bar] : scalePcs;
        pitch = snap(target, pcs, tonic);
        const lastCell = half === 1 && ci === cells.length - 1;
        if (lastCell && endOnTonic) pitch = snap(leadBase, [0], tonic);
        push({ pitch, at, dur: c.dur * (sp.lead === "piano" || sp.lead === "musicbox" ? 1.2 : 0.95), vel: (strong ? 0.42 : 0.34) + r() * 0.08, inst: sp.lead });
      });
    }
  };
  sections.forEach((sec, i) => {
    const start = intro + i * 4;
    if (sec === "A") playMotif(motifA, start, 0, false);
    else if (sec === "A2") playMotif(motifA, start, 1, true);
    else if (sec === "B") playMotif(motifB, start, 0, false);
    else playMotif(motifA, start, 0, true);
  });
  // 最后一个长音
  push({ pitch: snap(leadBase, [0], tonic), at: (bars - 1) * meter, dur: meter * 1.5, vel: 0.36, inst: sp.lead });

  notes.sort((a, b) => a.at - b.at || a.pitch - b.pitch);
  const key = `${keyName}${minor ? "小调" : "大调"}`;
  return { tempo, meter, beats: bars * meter + meter / 2, notes, key, mood, style, title: `${STYLE_NAMES[style]} · ${key}`, wet: sp.wet, swing: sp.swing };
}

export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** 两段曲子之间的安静时间（秒） */
export type BgmFrequency = "off" | "rare" | "often" | "always";

export function gapSeconds(freq: BgmFrequency, rand: () => number = Math.random): number {
  if (freq === "always") return 6 + rand() * 10;
  if (freq === "often") return 40 + rand() * 80;
  return 150 + rand() * 210;
}
