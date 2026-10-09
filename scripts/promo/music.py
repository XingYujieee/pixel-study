"""宣传片配乐：96 BPM，17 小节（42.5 秒）+ 尾音。全部用 numpy 现场合成（原创），外加几个音效点。
用法：python3 music.py out.wav
"""
import sys
import numpy as np
import wave

SR = 44100
BPM = 96
BEAT = 60 / BPM
BAR = BEAT * 4
BARS = 17
DUR = BARS * BAR + 3.0
N = int(DUR * SR)
rng = np.random.default_rng(7)

mix_l = np.zeros(N)
mix_r = np.zeros(N)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def env_adsr(n, a, d, s, r, sustain_len):
    """n：总采样；a/d/r 秒；s 为保持电平；sustain_len 秒"""
    out = np.zeros(n)
    ia, id_, isus, ir = int(a * SR), int(d * SR), int(sustain_len * SR), int(r * SR)
    i = 0
    seg = min(ia, n - i)
    out[i:i + seg] = np.linspace(0, 1, ia, endpoint=False)[:seg]
    i += seg
    seg = min(id_, n - i)
    if seg > 0:
        out[i:i + seg] = np.linspace(1, s, id_, endpoint=False)[:seg]
        i += seg
    seg = min(isus, n - i)
    if seg > 0:
        out[i:i + seg] = s
        i += seg
    seg = min(ir, n - i)
    if seg > 0:
        out[i:i + seg] = np.linspace(s, 0, ir, endpoint=False)[:seg]
    return out


from scipy.signal import lfilter


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    return lfilter([1 - a], [1, -a], x)


def add(sig, t0, pan=0.0, gain=1.0):
    i0 = int(t0 * SR)
    if i0 >= N:
        return
    sig = sig[: N - i0]
    l = np.cos((pan + 1) * np.pi / 4) * gain
    r = np.sin((pan + 1) * np.pi / 4) * gain
    mix_l[i0:i0 + len(sig)] += sig * l
    mix_r[i0:i0 + len(sig)] += sig * r


def tbar(bar, beat=0.0):
    return bar * BAR + beat * BEAT


# 和弦：Fmaj7 – G6 – Em7 – Am7（循环），结尾 Fmaj7 → Cmaj9
CHORDS = [
    [53, 57, 60, 64],  # Fmaj7
    [55, 59, 62, 64],  # G6
    [52, 55, 59, 62],  # Em7
    [57, 60, 64, 67],  # Am7
]
END_CHORDS = {15: [53, 57, 60, 64, 67], 16: [48, 55, 59, 62, 64]}  # Fmaj9, Cmaj9


def chord_at(bar):
    return END_CHORDS.get(bar, CHORDS[bar % 4])


# ───── 音色 ─────
def pad(notes, dur):
    n = int((dur + 1.2) * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for k, m in enumerate(notes):
        f = midi(m)
        for det in (-0.12, 0.0, 0.12):
            ph = rng.random() * 2 * np.pi
            # 三角波，柔和
            s += (2 / np.pi) * np.arcsin(np.sin(2 * np.pi * f * (1 + det / 100) * t + ph))
    s /= len(notes) * 3
    s *= env_adsr(n, 0.6, 0.4, 0.8, 1.2, dur - 1.0)
    s *= 0.85 + 0.15 * np.sin(2 * np.pi * 0.3 * t)
    return lowpass(s, 1400)


def pulse(f, dur, duty=0.25, vol=1.0):
    n = int((dur + 0.25) * SR)
    t = np.arange(n) / SR
    ph = (f * t) % 1.0
    s = np.where(ph < duty, 1.0, -1.0) * 0.6
    s *= env_adsr(n, 0.004, 0.08, 0.35, 0.18, max(0.0, dur - 0.08))
    return lowpass(s, 3200) * vol


def bell(f, dur=1.6, vol=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t * 6) + 0.18 * np.sin(2 * np.pi * f * 3.01 * t) * np.exp(-t * 9)
    s *= np.exp(-t * 2.6) * np.minimum(1, t / 0.003)
    return s * vol * 0.5


def tri_bass(f, dur):
    n = int((dur + 0.15) * SR)
    t = np.arange(n) / SR
    s = (2 / np.pi) * np.arcsin(np.sin(2 * np.pi * f * t))
    s *= env_adsr(n, 0.005, 0.12, 0.7, 0.12, max(0, dur - 0.12))
    return s * 0.9


def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 45 + 95 * np.exp(-t * 30)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 9) * 1.0


def snare():
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    nz = rng.standard_normal(n)
    nz = nz - lowpass(nz, 900)  # 高通一点
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 25) * 0.4
    return (nz * np.exp(-t * 16) * 0.45 + body) * 0.8


def hat(open_=False):
    n = int((0.18 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    nz = rng.standard_normal(n)
    nz = nz - lowpass(nz, 6000)
    return nz * np.exp(-t * (14 if open_ else 70)) * 0.22


def noise_burst(dur, cut_lo, cut_hi, decay):
    n = int(dur * SR)
    t = np.arange(n) / SR
    nz = rng.standard_normal(n)
    nz = lowpass(nz, cut_hi) - lowpass(nz, cut_lo)
    return nz * np.exp(-t * decay)


# ───── 编曲 ─────
# 1–2 小节（冷开场）：只有铺底和唱片底噪；3 小节起（标题）琶音、贝斯、钟声；5–14 小节加鼓；15–17 收尾
for bar in range(BARS):
    ch = chord_at(min(bar, 16))
    vol = 0.22 if bar < 2 else (0.4 if bar >= 15 else 0.3)
    if bar < 16:
        add(pad(ch, BAR), tbar(bar), gain=vol)
    # 琶音：十六分音符，上下行
    if 2 <= bar <= 14:
        seq = ch + [ch[1] + 12, ch[2] + 12] + list(reversed(ch[1:]))
        for k in range(16):
            m = seq[k % len(seq)] + 12
            add(pulse(midi(m), BEAT / 4 * 0.9, duty=0.25 if bar % 2 else 0.125, vol=0.16 if bar < 4 else 0.13), tbar(bar, k / 4), pan=-0.35 if k % 2 else 0.35)
    # 贝斯
    if 2 <= bar <= 14:
        root = ch[0] - 12
        for beat, m in ((0, root), (1.5, root), (2, root + 7), (3.5, root)):
            add(tri_bass(midi(m), BEAT * 0.45), tbar(bar, beat), gain=0.45)
    # 鼓
    if 4 <= bar <= 13:
        for beat in (0, 2.5):
            add(kick(), tbar(bar, beat), gain=0.75)
        for beat in (1, 3):
            add(snare(), tbar(bar, beat), gain=0.38)
        for k in range(8):
            add(hat(open_=(k == 7)), tbar(bar, k / 2 + 0.0), pan=0.25, gain=0.5 if k % 2 else 0.8)
    if bar == 14:
        # 换屋子那段：只有琶音和轻拍，制造期待
        for beat in (0, 1, 2, 3):
            add(hat(), tbar(bar, beat), gain=0.6)
        for k in range(4):
            add(snare(), tbar(bar, 3 + k / 4), gain=0.12 + k * 0.08)

# 钟声旋律（原创动机）：小节号 → [(拍, MIDI)]
MELODY = {
    2: [(0, 76), (1.5, 79), (3, 77)],
    3: [(0, 76), (2, 74), (3, 72)],
    4: [(0, 72), (1, 74), (1.5, 76), (3, 79)],
    5: [(0, 81), (2, 79), (3, 76)],
    6: [(0, 76), (1, 79), (2, 83), (3, 81)],
    7: [(0, 79), (2, 76), (3, 74)],
    8: [(0, 72), (1.5, 76), (3, 79)],
    9: [(0, 81), (1, 79), (2, 76), (3, 79)],
    10: [(0, 76), (2, 79), (3, 84)],
    11: [(0, 83), (2, 79), (3, 76)],
    12: [(0, 74), (1, 76), (2, 79), (3, 81)],
    13: [(0, 79), (2.5, 76)],
    15: [(0, 76), (1, 79), (2, 81), (3, 84)],
    16: [(0, 83), (1, 79), (2, 76), (3, 72)],
}
for bar, notes in MELODY.items():
    for beat, m in notes:
        add(bell(midi(m), vol=0.5 if bar < 15 else 0.6), tbar(bar, beat), pan=0.15)
        # 回声
        add(bell(midi(m), vol=0.16), tbar(bar, beat + 0.75), pan=-0.4)

# 结尾长音
add(bell(midi(60), dur=3.5, vol=0.5), tbar(16, 4.0))
add(bell(midi(67), dur=3.5, vol=0.35), tbar(16, 4.0), pan=0.3)
add(pad([48, 55, 59, 62, 64], 3.0), tbar(16), gain=0.3)

# ───── 音效 ─────
# 冷开场的打字声（与画面的字一个个出现对齐）：两句话
def type_ticks(t0, n, step):
    for k in range(n):
        add(noise_burst(0.03, 1500, 5000, 120) * 0.35, t0 + k * step, pan=rng.uniform(-0.3, 0.3))


type_ticks(0.6, 11, 0.09)
type_ticks(2.6, 11, 0.09)
# 标题出现：一声闪亮
add(bell(midi(84), 2.0, 0.5), 5.0)
add(bell(midi(91), 2.0, 0.25), 5.05, pan=0.4)
# 抽出唱片（records 镜头第 36 帧）、唱针落下（第 88 帧）
t_rec = 20.0
add(noise_burst(0.3, 800, 3000, 9) * 0.5, t_rec + 36 / 24, pan=-0.2)
needle_t = t_rec + 88 / 24
add(noise_burst(0.05, 100, 600, 60) * 0.9, needle_t)
for k in range(40):
    add(noise_burst(0.012, 3000, 9000, 300) * 0.25, needle_t + 0.1 + k * 0.035 + rng.uniform(0, 0.02))
# 封面一张张弹出（25–27.5 秒）
for k in range(16):
    add(bell(midi(84 + [0, 2, 4, 7, 9, 12][k % 6]), 0.4, 0.18), 25.15 + k * 0.1, pan=rng.uniform(-0.6, 0.6))
# 种树（garden 第 96 帧）
plant_t = 27.5 + 96 / 24
add(noise_burst(0.15, 80, 600, 20) * 0.9, plant_t)
add(bell(midi(79), 0.6, 0.25), plant_t + 0.05)
# 延时镜头里下起雨（33.9 秒起）
rain_t0, rain_t1 = 33.9, 37.5
n = int((rain_t1 - rain_t0) * SR)
nz = rng.standard_normal(n)
nz = lowpass(nz, 3200) - lowpass(nz, 500)
envr = np.minimum(1, np.arange(n) / (0.8 * SR)) * np.minimum(1, (n - np.arange(n)) / (0.8 * SR))
add(nz * envr * 0.07, rain_t0)

# 唱片底噪贯穿全片
n = N
crackle = np.zeros(n)
pos = rng.integers(0, n, size=int(DUR * 25))
crackle[pos] = rng.uniform(-0.25, 0.25, size=len(pos))
hiss = (rng.standard_normal(n) * 0.006)
add(lowpass(crackle, 4000) * 0.6 + hiss, 0.0)

# ───── 母带：淡入淡出、限幅 ─────
fade_in = np.minimum(1, np.arange(N) / (0.4 * SR))
fade_out = np.clip((DUR - np.arange(N) / SR) / 2.5, 0, 1)
L = mix_l * fade_in * fade_out
R = mix_r * fade_in * fade_out
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = L / peak * 0.89, R / peak * 0.89
L, R = np.tanh(L * 1.2) / np.tanh(1.2), np.tanh(R * 1.2) / np.tanh(1.2)
data = (np.stack([L, R], axis=1) * 32767 * 0.92).astype(np.int16)
w = wave.open(sys.argv[1], "w")
w.setnchannels(2)
w.setsampwidth(2)
w.setframerate(SR)
w.writeframes(data.tobytes())
w.close()
print("ok", DUR)
