// 书房的声音：全部用 Web Audio 现场合成（不带音频文件、没有版权问题）。
// 三条混音轨：音效（脚步、翻书、放东西……）、氛围（雨、炉火、海浪、风、虫鸣、鸟叫）、音乐（留声机，见 jukebox）。
// Mac 的网页内核要求声音必须在一次点击或按键里启动：unlock() 在第一次用户操作时调用。

export type Bus = "sfx" | "ambience" | "music";
export type Layer = "rain" | "fire" | "waves" | "wind" | "crickets" | "birds";
export type Sfx =
  | "click"
  | "stepWood"
  | "stepStone"
  | "stepSoft"
  | "stepGrass"
  | "doorOpen"
  | "doorClose"
  | "land"
  | "page"
  | "place"
  | "pop"
  | "splash"
  | "chime"
  | "thunder"
  | "meow"
  | "bark"
  | "squeak"
  | "chirp"
  | "yip";

export interface Volumes {
  master: number;
  sfx: number;
  ambience: number;
  music: number;
  muted: boolean;
}

export const DEFAULT_VOLUMES: Volumes = { master: 0.8, sfx: 0.7, ambience: 0.6, music: 0.7, muted: false };

const FADE = 1.2;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses = new Map<Bus, GainNode>();
  private layers = new Map<Layer, { gain: GainNode; stop: () => void; level: number }>();
  private noise: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private vol: Volumes = { ...DEFAULT_VOLUMES };
  /** 音乐轨由 HTMLAudioElement 播放，音量跟着这里算 */
  onMusicVolume?: (v: number) => void;

  get ready() {
    return !!this.ctx && this.ctx.state === "running";
  }

  /** 在用户手势里调用：创建或恢复音频上下文 */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      for (const b of ["sfx", "ambience", "music"] as Bus[]) {
        const g = this.ctx.createGain();
        g.connect(this.master);
        this.buses.set(b, g);
      }
      this.applyVolumes();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
  }

  setVolumes(v: Volumes) {
    this.vol = { ...v };
    this.applyVolumes();
  }

  get volumes() {
    return this.vol;
  }

  private applyVolumes() {
    const v = this.vol;
    const m = v.muted ? 0 : v.master;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m, this.ctx.currentTime, 0.05);
    for (const b of ["sfx", "ambience", "music"] as Bus[]) {
      const g = this.buses.get(b);
      if (g && this.ctx) g.gain.setTargetAtTime(b === "sfx" ? v.sfx : b === "ambience" ? v.ambience * 0.9 : v.music, this.ctx.currentTime, 0.05);
    }
    this.onMusicVolume?.(m * v.music);
  }

  private noiseBuf(brown: boolean): AudioBuffer {
    const ctx = this.ctx!;
    const cached = brown ? this.brown : this.noise;
    if (cached) return cached;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    if (brown) this.brown = buf;
    else this.noise = buf;
    return buf;
  }

  // ───────────── 氛围层 ─────────────

  /** 设置某一层氛围的音量（0 关闭，淡入淡出）。没在播放的层在需要时才创建。 */
  setLayer(name: Layer, level: number) {
    if (!this.ctx || !this.ready) return;
    const lv = Math.max(0, Math.min(1, level));
    let l = this.layers.get(name);
    if (!l && lv < 0.01) return;
    if (!l) {
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.buses.get("ambience")!);
      const stop = this.startLayer(name, gain);
      l = { gain, stop, level: 0 };
      this.layers.set(name, l);
    }
    if (Math.abs(l.level - lv) < 0.005) return;
    l.level = lv;
    const t = this.ctx.currentTime;
    l.gain.gain.cancelScheduledValues(t);
    l.gain.gain.setValueAtTime(l.gain.gain.value, t);
    l.gain.gain.linearRampToValueAtTime(lv * LAYER_GAIN[name], t + FADE);
    if (lv < 0.01) {
      const ref = l;
      setTimeout(() => {
        if (ref.level < 0.01 && this.layers.get(name) === ref) {
          ref.stop();
          ref.gain.disconnect();
          this.layers.delete(name);
        }
      }, (FADE + 0.3) * 1000);
    }
  }

  private loopSource(brown: boolean): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf(brown);
    s.loop = true;
    // 每层从噪声的不同位置开始，避免听起来一样
    s.start(0, Math.random() * 1.9);
    return s;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /** 低频起伏：把 0–1 的正弦接到某个参数上 */
  private lfo(param: AudioParam, rate: number, depth: number) {
    const o = this.ctx!.createOscillator();
    o.frequency.value = rate;
    const g = this.ctx!.createGain();
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start();
    return o;
  }

  private startLayer(name: Layer, out: GainNode): () => void {
    const ctx = this.ctx!;
    const nodes: AudioScheduledSourceNode[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const alive = { v: true };
    switch (name) {
      case "rain": {
        const s = this.loopSource(false);
        s.connect(this.filter("bandpass", 1400, 0.5)).connect(this.filter("highpass", 300)).connect(out);
        nodes.push(s);
        // 偶尔一滴落在窗台上
        const drip = () => {
          if (!alive.v) return;
          this.blip(out, 1800 + Math.random() * 1600, 0.03, 0.25);
          timer = setTimeout(drip, 80 + Math.random() * 500);
        };
        drip();
        break;
      }
      case "fire": {
        const s = this.loopSource(true);
        s.connect(this.filter("lowpass", 500)).connect(out);
        nodes.push(s);
        const crackle = () => {
          if (!alive.v) return;
          this.burst(out, 0.03, 1800 + Math.random() * 2000, 0.6 + Math.random() * 1.2, "highpass");
          timer = setTimeout(crackle, 120 + Math.random() * 900);
        };
        crackle();
        break;
      }
      case "waves": {
        const s = this.loopSource(false);
        const lp = this.filter("lowpass", 700);
        const amp = ctx.createGain();
        amp.gain.value = 0.55;
        nodes.push(this.lfo(amp.gain, 0.09, 0.45), this.lfo(lp.frequency, 0.09, 350));
        s.connect(lp).connect(amp).connect(out);
        nodes.push(s);
        break;
      }
      case "wind": {
        const s = this.loopSource(false);
        const bp = this.filter("bandpass", 600, 1.2);
        const amp = ctx.createGain();
        amp.gain.value = 0.6;
        nodes.push(this.lfo(bp.frequency, 0.13, 300), this.lfo(amp.gain, 0.07, 0.35));
        s.connect(bp).connect(amp).connect(out);
        nodes.push(s);
        break;
      }
      case "crickets": {
        const chirp = () => {
          if (!alive.v) return;
          const f = 4200 + Math.random() * 600;
          for (let i = 0; i < 3; i++) this.blip(out, f, 0.025, 0.3, i * 0.06);
          timer = setTimeout(chirp, 350 + Math.random() * 900);
        };
        chirp();
        break;
      }
      case "birds": {
        const sing = () => {
          if (!alive.v) return;
          const base = 2400 + Math.random() * 1400;
          const n = 1 + Math.floor(Math.random() * 4);
          for (let i = 0; i < n; i++) this.sweep(out, base, base * (1.2 + Math.random() * 0.4), 0.09, 0.35, i * 0.13);
          timer = setTimeout(sing, 1200 + Math.random() * 4500);
        };
        timer = setTimeout(sing, 600);
        break;
      }
    }
    return () => {
      alive.v = false;
      if (timer) clearTimeout(timer);
      for (const n of nodes)
        try {
          n.stop();
        } catch {
          /* 已停止 */
        }
    };
  }

  // ───────────── 合成小零件 ─────────────

  /** 短促的正弦 / 方波点 */
  private blip(out: AudioNode, freq: number, dur: number, vol: number, delay = 0, type: OscillatorType = "sine") {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** 滑音 */
  private sweep(out: AudioNode, f0: number, f1: number, dur: number, vol: number, delay = 0, type: OscillatorType = "sine") {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** 一小段滤波噪声 */
  private burst(out: AudioNode, dur: number, freq: number, vol: number, type: BiquadFilterType = "lowpass", delay = 0, brown = false, sweepTo?: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf(brown);
    const f = this.filter(type, freq, 0.8);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.01, dur / 5));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  // ───────────── 音效 ─────────────

  play(name: Sfx, vol = 1) {
    if (!this.ctx || !this.ready) return;
    const out = this.buses.get("sfx")!;
    const r = 0.92 + Math.random() * 0.16;
    switch (name) {
      case "click":
        this.blip(out, 1100 * r, 0.03, 0.12 * vol, 0, "square");
        break;
      case "stepWood":
        this.burst(out, 0.07, 700 * r, 0.35 * vol, "lowpass");
        this.blip(out, 140 * r, 0.05, 0.15 * vol);
        break;
      case "stepStone":
        this.burst(out, 0.06, 2400 * r, 0.25 * vol, "bandpass");
        break;
      case "stepSoft":
        this.burst(out, 0.09, 500 * r, 0.18 * vol, "lowpass");
        break;
      case "stepGrass":
        // 草地：沙沙的高频 + 一点闷响
        this.burst(out, 0.11, 3200 * r, 0.16 * vol, "bandpass");
        this.burst(out, 0.07, 450 * r, 0.14 * vol, "lowpass", 0.01);
        break;
      case "doorOpen":
        // 木门吱呀一声
        this.sweep(out, 210 * r, 300 * r, 0.32, 0.07 * vol, 0, "sawtooth");
        this.sweep(out, 420 * r, 610 * r, 0.28, 0.035 * vol, 0.03, "sawtooth");
        this.burst(out, 0.06, 1200, 0.18 * vol, "bandpass");
        break;
      case "doorClose":
        this.blip(out, 90 * r, 0.18, 0.45 * vol);
        this.burst(out, 0.1, 700, 0.35 * vol, "lowpass");
        this.burst(out, 0.03, 3800, 0.12 * vol, "bandpass", 0.09);
        break;
      case "land":
        this.blip(out, 70 * r, 0.12, 0.35 * vol);
        this.burst(out, 0.08, 600, 0.25 * vol, "lowpass");
        break;
      case "page":
        this.burst(out, 0.2, 2000, 0.3 * vol, "bandpass", 0, false, 5200);
        this.burst(out, 0.12, 3000, 0.15 * vol, "bandpass", 0.12, false, 6000);
        break;
      case "place":
        this.blip(out, 95 * r, 0.14, 0.5 * vol);
        this.burst(out, 0.08, 900, 0.3 * vol, "lowpass");
        break;
      case "pop":
        this.sweep(out, 520 * r, 1250 * r, 0.08, 0.25 * vol);
        break;
      case "splash":
        this.burst(out, 0.45, 2600, 0.45 * vol, "lowpass", 0, false, 400);
        for (let i = 0; i < 5; i++) this.sweep(out, 500 + Math.random() * 500, 900 + Math.random() * 700, 0.05, 0.12 * vol, 0.15 + i * 0.07);
        break;
      case "chime":
        this.blip(out, 880, 1.4, 0.22 * vol);
        this.blip(out, 1320, 1.1, 0.12 * vol, 0.02);
        this.blip(out, 1760, 0.8, 0.06 * vol, 0.04);
        break;
      case "thunder":
        this.burst(out, 2.6, 180, 0.9 * vol, "lowpass", 0, true, 60);
        this.burst(out, 1.4, 400, 0.4 * vol, "lowpass", 0.15, true, 90);
        break;
      case "meow":
        {
          const ctx = this.ctx;
          const t = ctx.currentTime;
          const o = ctx.createOscillator();
          o.type = "triangle";
          o.frequency.setValueAtTime(620 * r, t);
          o.frequency.linearRampToValueAtTime(820 * r, t + 0.12);
          o.frequency.linearRampToValueAtTime(560 * r, t + 0.42);
          const f = this.filter("bandpass", 1400, 1.5);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.28 * vol, t + 0.05);
          g.gain.linearRampToValueAtTime(0.0001, t + 0.45);
          o.connect(f).connect(g).connect(out);
          o.start(t);
          o.stop(t + 0.5);
        }
        break;
      case "bark":
        for (const d of [0, 0.18]) {
          this.sweep(out, 380 * r, 260 * r, 0.1, 0.3 * vol, d, "sawtooth");
          this.burst(out, 0.08, 900, 0.15 * vol, "bandpass", d);
        }
        break;
      case "squeak":
        this.sweep(out, 1700 * r, 2300 * r, 0.07, 0.15 * vol);
        break;
      case "chirp":
        for (const d of [0, 0.12]) this.sweep(out, 3200 * r, 2300 * r, 0.08, 0.18 * vol, d);
        break;
      case "yip":
        this.sweep(out, 950 * r, 620 * r, 0.12, 0.2 * vol, 0, "triangle");
        break;
    }
  }

  // ───────────── 背景音乐（合成乐器） ─────────────

  private reverb: ConvolverNode | null = null;
  private piece: { out: GainNode; send: GainNode; endAt: number; timer: ReturnType<typeof setTimeout>; pump: ReturnType<typeof setInterval> } | null = null;

  /** 一段简单的混响：指数衰减的噪声作为冲激响应 */
  private getReverb(): ConvolverNode {
    if (this.reverb) return this.reverb;
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * 3);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    const c = ctx.createConvolver();
    c.buffer = buf;
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    c.connect(wet).connect(this.buses.get("music")!);
    this.reverb = c;
    return c;
  }

  private osc(type: OscillatorType, hz: number, t: number, end: number, to: AudioNode, gain = 1, detune = 0): OscillatorNode {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    o.detune.value = detune;
    if (gain === 1) o.connect(to);
    else {
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(to);
    }
    o.start(t);
    o.stop(end);
    return o;
  }

  /** 包络：快起、衰减到 sustain、按住 dur 后松开 */
  private envelope(t: number, peak: number, attack: number, decay: number, sustain: number, dur: number, release: number): { node: GainNode; end: number } {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    if (sustain <= 0) {
      // 拨弦、敲击类：自然衰减，不管按多久
      void dur;
      void release;
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      return { node: g, end: t + attack + decay + 0.05 };
    }
    const hold = t + Math.max(dur, attack + 0.02);
    g.gain.setTargetAtTime(peak * sustain, t + attack, decay / 3);
    g.gain.setValueAtTime(peak * sustain, hold);
    g.gain.linearRampToValueAtTime(0.0001, hold + release);
    return { node: g, end: hold + release + 0.02 };
  }

  /** 气声：一小段带通噪声（长笛、陶笛的起音） */
  private breath(to: AudioNode, t: number, hz: number, vol: number) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf(false);
    const f = this.filter("bandpass", Math.min(6000, hz * 3), 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    s.connect(f).connect(g).connect(to);
    s.start(t, Math.random());
    s.stop(t + 0.25);
  }

  /** 颤音：几音分的慢速起伏 */
  private vibrato(o: OscillatorNode, t: number, end: number, cents: number, rate = 5.2) {
    const ctx = this.ctx!;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(cents, t + 0.35);
    lfo.connect(depth).connect(o.detune);
    lfo.start(t);
    lfo.stop(end);
  }

  /** 一个音：按乐器合成 */
  private instNote(inst: string, out: AudioNode, send: AudioNode, hz: number, t: number, dur: number, vel: number) {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.connect(out);
    lp.connect(send);
    switch (inst) {
      case "musicbox": {
        // 八音盒：钢片的基音 + 不谐和的高泛音，很快变暗
        const e = this.envelope(t, vel * 0.24, 0.002, 1.6, 0, dur, 0.1);
        lp.frequency.value = 9000;
        e.node.connect(lp);
        this.osc("sine", hz, t, e.end, e.node);
        this.osc("sine", hz * 2, t, e.end, e.node, 0.18);
        const hi = this.envelope(t, vel * 0.07, 0.001, 0.25, 0, 0.1, 0.05);
        hi.node.connect(lp);
        this.osc("sine", hz * 5.4, t, hi.end, hi.node);
        break;
      }
      case "pad": {
        // 长音：两个略微走音的锯齿波，慢起慢落，滤得很软
        const e = this.envelope(t, vel * 0.07, Math.min(1.2, dur * 0.4), 1, 0.85, dur, 1.6);
        lp.frequency.setValueAtTime(700, t);
        lp.frequency.linearRampToValueAtTime(1400, t + dur * 0.5);
        lp.frequency.linearRampToValueAtTime(800, e.end);
        e.node.connect(lp);
        this.osc("sawtooth", hz, t, e.end, e.node, 1, -7);
        this.osc("sawtooth", hz, t, e.end, e.node, 1, 7);
        this.osc("triangle", hz / 2, t, e.end, e.node, 0.6);
        break;
      }
      case "harp": {
        // 竖琴：拨一下，亮一下再慢慢暗下去
        const e = this.envelope(t, vel * 0.2, 0.003, 2.2, 0, dur, 0.2);
        lp.frequency.setValueAtTime(Math.min(9000, hz * 7), t);
        lp.frequency.exponentialRampToValueAtTime(Math.max(300, hz * 1.6), t + 1.2);
        e.node.connect(lp);
        this.osc("triangle", hz, t, e.end, e.node);
        this.osc("sine", hz * 2, t, e.end, e.node, 0.25);
        break;
      }
      case "flute":
      case "ocarina": {
        // 长笛 / 陶笛：近似正弦，带一点气声和颤音
        const flute = inst === "flute";
        const e = this.envelope(t, vel * (flute ? 0.13 : 0.15), flute ? 0.07 : 0.05, 0.3, 0.8, dur, 0.18);
        lp.frequency.value = Math.min(8000, hz * (flute ? 5 : 3));
        e.node.connect(lp);
        const o = this.osc("sine", hz, t, e.end, e.node);
        this.osc(flute ? "triangle" : "sine", hz * 2, t, e.end, e.node, flute ? 0.12 : 0.06);
        if (dur > 0.5) this.vibrato(o, t + 0.15, e.end, flute ? 9 : 12, flute ? 5 : 5.6);
        this.breath(lp, t, hz, vel * (flute ? 0.05 : 0.035));
        break;
      }
      case "epiano": {
        // 电钢琴：调频合成（载波 + 同频调制，调制量很快变小），加一点"叮"的高音
        const e = this.envelope(t, vel * 0.085, 0.004, 2.6, 0, dur, 0.3);
        lp.frequency.value = 5000;
        e.node.connect(lp);
        const car = this.osc("sine", hz, t, e.end, e.node);
        const mod = ctx.createOscillator();
        mod.frequency.value = hz;
        const idx = ctx.createGain();
        idx.gain.setValueAtTime(hz * 1.4, t);
        idx.gain.exponentialRampToValueAtTime(hz * 0.15, t + 0.9);
        mod.connect(idx).connect(car.frequency);
        mod.start(t);
        mod.stop(e.end);
        const tine = this.envelope(t, vel * 0.025, 0.001, 0.18, 0, 0.05, 0.05);
        tine.node.connect(lp);
        this.osc("sine", hz * 4, t, tine.end, tine.node);
        break;
      }
      case "bass": {
        const e = this.envelope(t, vel * 0.2, 0.01, 0.5, 0.6, dur * 0.9, 0.12);
        lp.frequency.value = 520;
        e.node.connect(lp);
        this.osc("sine", hz, t, e.end, e.node);
        this.osc("triangle", hz, t, e.end, e.node, 0.5);
        break;
      }
      case "guitar": {
        // 尼龙弦吉他：锯齿波拨弦，滤波很快收拢
        const e = this.envelope(t, vel * 0.16, 0.003, 1.4, 0, dur, 0.15);
        lp.frequency.setValueAtTime(Math.min(8000, hz * 9), t);
        lp.frequency.exponentialRampToValueAtTime(Math.max(250, hz * 1.4), t + 0.45);
        e.node.connect(lp);
        this.osc("sawtooth", hz, t, e.end, e.node, 0.7, 3);
        this.osc("triangle", hz, t, e.end, e.node, 0.6);
        break;
      }
      default: {
        // 钢琴：基音 + 两个泛音，快起慢落，高频随时间变暗
        const decay = Math.min(4.5, 1.2 + dur * 0.9 + (hz < 200 ? 1.2 : 0));
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(vel * 0.22, t + 0.006);
        env.gain.exponentialRampToValueAtTime(vel * 0.08, t + 0.35);
        env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        lp.frequency.setValueAtTime(Math.min(9000, hz * 8), t);
        lp.frequency.exponentialRampToValueAtTime(Math.max(300, hz * 1.5), t + decay);
        env.connect(lp);
        for (const [mult, g, type] of [
          [1, 1, "sine"],
          [2, 0.28, "triangle"],
          [3, 0.07, "sine"],
        ] as [number, number, OscillatorType][])
          this.osc(type, hz * mult, t, t + decay + 0.05, env, g, (Math.random() - 0.5) * 4);
      }
    }
  }

  get pieceTimeLeft(): number {
    if (!this.piece || !this.ctx) return 0;
    return Math.max(0, this.piece.endAt - this.ctx.currentTime);
  }

  /**
   * 播放一首曲子（音符以拍为单位），结束时回调。
   * 边播边排：每次只把接下来一秒多的音交给声卡，停下时不会留下一大堆排好的音。
   */
  playPiece(
    p: { notes: { pitch: number; at: number; dur: number; vel: number; inst?: string }[]; tempo: number; beats: number; wet?: number; swing?: number },
    onEnd: () => void,
  ) {
    if (!this.ctx || !this.ready) return false;
    this.stopPiece(0.1);
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.buses.get("music")!);
    const send = ctx.createGain();
    send.gain.value = (p.wet ?? 0.32) / 0.32;
    send.connect(this.getReverb());
    const spb = 60 / p.tempo;
    const t0 = ctx.currentTime + 0.3;
    const swing = p.swing ?? 0;
    let i = 0;
    const pump = () => {
      const horizon = ctx.currentTime + 1.6;
      while (i < p.notes.length) {
        const n = p.notes[i];
        let at = n.at;
        // 摇摆：后半拍的八分音符往后推一点
        if (swing && Math.abs((at % 1) - 0.5) < 0.01) at += swing;
        const t = t0 + at * spb + (Math.random() - 0.5) * 0.02;
        if (t > horizon) break;
        this.instNote(n.inst ?? "piano", out, send, 440 * Math.pow(2, (n.pitch - 69) / 12), Math.max(ctx.currentTime, t), n.dur * spb, n.vel);
        i++;
      }
    };
    pump();
    const timer0 = setInterval(pump, 400);
    const endAt = t0 + p.beats * spb + 3.5;
    const timer = setTimeout(
      () => {
        if (this.piece?.out === out) {
          clearInterval(timer0);
          this.piece = null;
          out.disconnect();
          send.disconnect();
          onEnd();
        }
      },
      (endAt - ctx.currentTime) * 1000,
    );
    this.piece = { out, send, endAt, timer, pump: timer0 };
    return true;
  }

  get pieceActive() {
    return !!this.piece;
  }

  /** 停下正在放的曲子（淡出） */
  stopPiece(fade = 1.5) {
    const p = this.piece;
    if (!p || !this.ctx) return;
    this.piece = null;
    clearTimeout(p.timer);
    clearInterval(p.pump);
    const t = this.ctx.currentTime;
    for (const g of [p.out, p.send]) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0, t + fade);
    }
    setTimeout(() => {
      p.out.disconnect();
      p.send.disconnect();
    }, (fade + 0.2) * 1000);
  }

  dispose() {
    for (const l of this.layers.values()) l.stop();
    this.layers.clear();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

/** 各层的基础音量（层与层之间平衡） */
const LAYER_GAIN: Record<Layer, number> = { rain: 0.08, fire: 0.1, waves: 0.12, wind: 0.07, crickets: 0.05, birds: 0.06 };

export const audio = new AudioEngine();
