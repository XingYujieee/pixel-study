"""宣传片后期：拼镜头、叠界面和字幕、像素化转场、打字机开场、封面墙、片尾，输出原始帧给 ffmpeg。
用法：python3 compose.py <shots目录> <cards目录> | ffmpeg -f rawvideo ...
环境变量 ONLY_FRAMES=a:b 只输出一段（预览用）；STILLS=dir 另存几张关键帧。
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

SHOTS, CARDS = sys.argv[1], sys.argv[2]
W, H, FPS = 1280, 720, 24
meta = json.load(open(os.path.join(CARDS, "meta.json")))
rng = np.random.default_rng(3)

# 时间线：(镜头名, 帧数)。cold、covers 是后期画的，没有 3D 画面
TIMELINE = [
    ("cold", 120),
    ("title", 120),
    ("shelf", 60),
    ("write", 120),
    ("butler", 60),
    ("records", 120),
    ("covers", 60),
    ("garden", 120),
    ("timelapse", 60),
    ("themes", 60),
    ("ending", 192),
]
CAPTIONS = {"shelf", "write", "butler", "records", "covers", "garden", "timelapse", "themes"}

_cache = {}


def rgba(name):
    if name not in _cache:
        _cache[name] = Image.open(os.path.join(CARDS, name)).convert("RGBA")
    return _cache[name]


def ease_out(t):
    t = min(1.0, max(0.0, t))
    return 1 - (1 - t) ** 3


def ease_in_out(t):
    t = min(1.0, max(0.0, t))
    return 4 * t * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


# 暗角
yy, xx = np.mgrid[0:H, 0:W]
d = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
VIGNETTE = np.clip(1.0 - 0.38 * np.clip(d - 0.55, 0, None) ** 1.6, 0.55, 1.0)[..., None]


def shot_frame(name, i):
    folder = os.path.join(SHOTS, name)
    n = len([f for f in os.listdir(folder) if f.endswith(".jpg")])
    i = min(i, n - 1)
    im = Image.open(os.path.join(folder, f"f{i:04d}.jpg")).convert("RGB").resize((W, H), Image.NEAREST)
    ovs = json.load(open(os.path.join(folder, "overlay.json")))
    ov = ovs[min(i, len(ovs) - 1)]
    im = im.convert("RGBA")
    if ov:
        im.alpha_composite(Image.open(os.path.join(folder, ov)).convert("RGBA"))
    return im


def pixel_in(img, k, frames=7):
    """转场：新镜头从大马赛克慢慢变清楚"""
    if k >= frames:
        return img
    block = [40, 24, 16, 10, 6, 4, 2][k]
    small = img.resize((max(1, W // block), max(1, H // block)), Image.BILINEAR)
    return small.resize((W, H), Image.NEAREST)


def caption(img, name, k, total):
    cap = rgba(f"cap_{name}.png")
    t_in = ease_out(k / 10)
    t_out = 1 - ease_in_out((k - (total - 9)) / 8) if k > total - 9 else 1
    alpha = min(t_in, t_out)
    if alpha <= 0:
        return img
    dx = int((1 - t_in) * -60)
    layer = Image.new("RGBA", (W, H))
    layer.alpha_composite(cap, (dx, 0))
    if alpha < 1:
        a = np.array(layer)
        a[..., 3] = (a[..., 3] * alpha).astype(np.uint8)
        layer = Image.fromarray(a)
    img.alpha_composite(layer)
    return img


def fade_layer(img, layer, alpha, dy=0):
    if alpha <= 0:
        return img
    l2 = Image.new("RGBA", (W, H))
    l2.alpha_composite(layer, (0, dy))
    if alpha < 1:
        a = np.array(l2)
        a[..., 3] = (a[..., 3] * alpha).astype(np.uint8)
        l2 = Image.fromarray(a)
    img.alpha_composite(l2)
    return img


# 冷开场的漂浮灰尘
DUST = [(rng.uniform(0, W), rng.uniform(0, H), rng.uniform(4, 16), rng.uniform(-6, 6), rng.choice([2, 3, 4]), rng.uniform(0.25, 0.8)) for _ in range(70)]


def cold(k):
    img = Image.new("RGBA", (W, H), (14, 10, 8, 255))
    dr = ImageDraw.Draw(img)
    t = k / FPS
    for x, y, vy, vx, s, a in DUST:
        px = (x + vx * t) % W
        py = (y - vy * t) % H
        c = int(200 * a)
        dr.rectangle([px, py, px + s, py + s], fill=(c, int(c * 0.8), int(c * 0.55), 255))
    full = rgba("cold.png")
    lines = meta["cold"]
    starts = [0.6, None, 2.6, None]  # 中文一字一字打出来；英文在中文打完后淡入
    STEP = 0.09
    layer = Image.new("RGBA", (W, H))
    cursor = None
    for li, ln in enumerate(lines):
        top, bottom = ln["top"] - 4, ln["bottom"] + 6
        if li % 2 == 0:
            n = int((t - starts[li]) / STEP) + 1 if t >= starts[li] else 0
            n = min(n, len(ln["chars"]))
            if n <= 0:
                continue
            right = ln["chars"][n - 1] + 4
            layer.alpha_composite(full.crop((0, top, right, bottom)), (0, top))
            if n < len(ln["chars"]) or (t - starts[li]) < len(ln["chars"]) * STEP + 0.5:
                cursor = (right + 6, top + 8, right + 22, bottom - 8)
        else:
            zh_start = starts[li - 1]
            done = zh_start + len(lines[li - 1]["chars"]) * STEP + 0.15
            a = ease_out((t - done) / 0.4)
            if a > 0:
                part = full.crop((0, top, W, bottom))
                arr = np.array(part)
                arr[..., 3] = (arr[..., 3] * a).astype(np.uint8)
                layer.alpha_composite(Image.fromarray(arr), (0, top))
    img.alpha_composite(layer)
    if cursor and int(t * 4) % 2 == 0:
        ImageDraw.Draw(img).rectangle(cursor, fill=(255, 210, 122, 255))
    # 结尾淡出到黑
    if t > 4.3:
        a = ease_in_out((t - 4.3) / 0.7)
        black = Image.new("RGBA", (W, H), (0, 0, 0, int(255 * a)))
        img.alpha_composite(black)
    return img


COVERS = [Image.open(os.path.join(CARDS, "covers", f"{i}.png")).convert("RGBA") for i in range(16)]


def covers(k):
    img = Image.new("RGBA", (W, H), (34, 24, 18, 255))
    dr = ImageDraw.Draw(img)
    # 淡淡的格子
    for x in range(0, W, 32):
        dr.line([(x, 0), (x, H)], fill=(44, 32, 24, 255))
    for y in range(0, H, 32):
        dr.line([(0, y), (W, y)], fill=(44, 32, 24, 255))
    size, gap = 128, 22
    cols, rows = 8, 2
    total_w = cols * size + (cols - 1) * gap
    x0 = (W - total_w) // 2
    y0 = 120
    for i, cv in enumerate(COVERS):
        start = 3.6 + i * 2.4
        u = (k - start) / 7
        if u <= 0:
            continue
        # 弹一下：0 → 1.15 → 1
        s = 1.15 * ease_out(min(1, u / 0.6)) if u < 0.6 else 1.15 - 0.15 * ease_in_out((u - 0.6) / 0.4)
        s = max(0.05, s)
        bob = math.sin((k / FPS) * 2.2 + i) * 3
        sz = int(size * s)
        im = cv.resize((sz, sz), Image.NEAREST)
        cx = x0 + (i % cols) * (size + gap) + size // 2
        cy = y0 + (i // cols) * (size + gap + 26) + size // 2 + int(bob)
        shadow = Image.new("RGBA", (sz, sz), (0, 0, 0, 110))
        img.alpha_composite(shadow, (cx - sz // 2 + 6, cy - sz // 2 + 6))
        img.alpha_composite(im, (cx - sz // 2, cy - sz // 2))
    return img


def ending_overlay(img, k, total):
    # 画面压暗，片尾卡淡入，最后淡出到黑
    arr = np.array(img).astype(np.float32)
    dim = 1 - 0.5 * ease_in_out((k - 6) / 30)
    arr[..., :3] *= dim
    img = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
    a = ease_out((k - 18) / 20)
    img = fade_layer(img, rgba("end.png"), a, dy=int((1 - a) * 14))
    if k > total - 30:
        b = ease_in_out((k - (total - 30)) / 30)
        img.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, int(255 * b))))
    return img


THEME_ORDER = 7


def render():
    out = sys.stdout.buffer
    only = os.environ.get("ONLY_FRAMES")
    lo, hi = (int(x) for x in only.split(":")) if only else (0, 10**9)
    stills = os.environ.get("STILLS")
    g = 0
    for name, frames in TIMELINE:
        for k in range(frames):
            if not (lo <= g < hi):
                g += 1
                continue
            if name == "cold":
                img = cold(k)
            elif name == "covers":
                img = covers(k)
            else:
                src = k
                if name == "ending":
                    src = min(k, 119)  # 镜头拍了 120 帧，之后停在最后一帧上
                img = shot_frame(name, src)
            if name not in ("cold",):
                img = pixel_in(img, k)
            if name == "title":
                a_in = ease_out((k - 10) / 16)
                a_out0 = 1 - ease_in_out((k - 100) / 14) if k > 100 else 1
                scrim = (np.clip(1 - d, 0, 1) ** 0.8 * 150 * min(a_in, a_out0)).astype(np.uint8)
                sl = np.zeros((H, W, 4), np.uint8)
                sl[..., 0], sl[..., 1], sl[..., 2] = 12, 8, 6
                sl[..., 3] = scrim
                img.alpha_composite(Image.fromarray(sl))
                a_out = 1 - ease_in_out((k - 100) / 14) if k > 100 else 1
                img = fade_layer(img, rgba("title.png"), min(a_in, a_out), dy=int((1 - a_in) * 16))
                if k < 10:
                    img.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, int(255 * (1 - k / 10)))))
            if name == "themes":
                idx = min(THEME_ORDER - 1, (k * THEME_ORDER) // frames)
                img.alpha_composite(rgba(f"theme_{idx}.png"))
            if name in CAPTIONS:
                img = caption(img, name, k, frames)
            if name == "ending":
                img = ending_overlay(img, k, frames)
            rgb = np.array(img.convert("RGB")).astype(np.float32)
            if name not in ("cold", "covers"):
                rgb *= VIGNETTE
            frame = rgb.clip(0, 255).astype(np.uint8)
            if stills and k == frames // 2:
                Image.fromarray(frame).save(os.path.join(stills, f"{g:04d}_{name}.png"))
            out.write(frame.tobytes())
            g += 1
    sys.stderr.write(f"frames {g}\n")


render()
