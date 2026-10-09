# 宣传片制作脚本

`docs/assets/intro.mp4`（45 秒，1280×720，24 帧）和 `intro-teaser.gif` 就是用这几个脚本做出来的：画面全部来自应用本身（浏览器 + 模拟后端），配乐和音效用 numpy 现场合成，没有用任何外部素材。

```bash
pnpm dev --port 1430                                   # 另开一个终端
node scripts/promo/director.mjs out/shots              # 按分镜一帧帧拍 3D 画面和界面（约 25 分钟，软件渲染）
node scripts/promo/cards.mjs out/cards                 # 用像素字体排字幕卡、标题卡、片尾卡，导出唱片封面
python3 scripts/promo/music.py out/music.wav           # 配乐：96 BPM，17 小节
python3 scripts/promo/compose.py out/shots out/cards \
  | ffmpeg -f rawvideo -pix_fmt rgb24 -s 1280x720 -r 24 -i - -i out/music.wav \
      -c:v libx264 -crf 20 -pix_fmt yuv420p -tune animation -c:a aac -b:a 160k -shortest out/intro.mp4
```

- 放进仓库前再压一遍，保证在 10MB 以内（GitHub 网页上传视频的上限）：两遍编码 `-b:v 1350k`，音频 `-b:a 128k`。预览动图 10 帧/秒、560 宽、128 色，约 4MB。
- 依赖：Playwright（Chromium）、Python 3（numpy、scipy、Pillow）、ffmpeg。
- `director.mjs` 用引擎的 `setManualClock / captureFrame / setPose` 一帧一帧推进，画面以 640×360 渲染、后期放大两倍，保持像素感；界面（HUD、面板）只在变化时截一张透明图叠上去。
- 想改分镜，改 `director.mjs` 里的 `SHOTS` 和 `compose.py` 里的 `TIMELINE`；想换字幕，改 `cards.mjs` 里的 `CAPS`。
