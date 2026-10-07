import { useEffect, useRef, useState } from "react";
import { floorLabel } from "../../app/floors";
import { getEngine } from "../../app/worldActions";
import { formatHour, WEATHER_NAMES } from "../../world/sky";

/** 本机时间的小钟：圆盘 + 时针分针（像素画） */
function drawWatch(g: CanvasRenderingContext2D, d: Date) {
  g.clearRect(0, 0, 16, 16);
  const px = (x: number, y: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(Math.round(x), Math.round(y), 1, 1);
  };
  // 表盘
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x - 7.5, y - 7.5);
      if (r < 6.6) px(x, y, "#f4efe2");
      else if (r < 7.6) px(x, y, "#5a5a62");
    }
  for (let k = 0; k < 12; k += 3) {
    const a = (k / 12) * Math.PI * 2;
    px(7.5 + Math.sin(a) * 5.4 - 0.5, 7.5 - Math.cos(a) * 5.4 - 0.5, "#8a8a92");
  }
  const hand = (a: number, len: number, c: string) => {
    for (let t = 0; t <= len; t += 0.5) px(7.5 + Math.sin(a) * t - 0.5, 7.5 - Math.cos(a) * t - 0.5, c);
  };
  const m = d.getMinutes() + d.getSeconds() / 60;
  const h = (d.getHours() % 12) + m / 60;
  hand((m / 60) * Math.PI * 2, 5, "#2a6ad0");
  hand((h / 12) * Math.PI * 2, 3.4, "#1e1e22");
  px(7, 7, "#c8423a");
}

/** 书房时间：方块游戏那种天空盘，上半边白天下半边夜晚，随时间转 */
function drawDial(g: CanvasRenderingContext2D, hour: number) {
  g.clearRect(0, 0, 16, 16);
  const rot = ((hour - 12) / 24) * Math.PI * 2;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5,
        dy = y - 7.5;
      const r = Math.hypot(dx, dy);
      if (r >= 7.6) continue;
      if (r >= 6.6) {
        g.fillStyle = "#c8a040";
        g.fillRect(x, y, 1, 1);
        continue;
      }
      // 转回去看这个点在盘上是白天还是黑夜
      const a = Math.atan2(dx, -dy) + rot;
      const up = Math.cos(a);
      g.fillStyle = up > 0.08 ? "#7ec0ee" : up < -0.08 ? "#1c2448" : "#d88a50";
      g.fillRect(x, y, 1, 1);
    }
  // 太阳与月亮在盘上
  const sx = 7.5 + Math.sin(-rot) * 3.6,
    sy = 7.5 - Math.cos(-rot) * 3.6;
  g.fillStyle = "#ffe36a";
  g.fillRect(Math.round(sx - 1.5), Math.round(sy - 1.5), 3, 3);
  g.fillStyle = "#e6e8f2";
  g.fillRect(Math.round(15 - sx - 1.5), Math.round(15 - sy - 1.5), 3, 3);
  // 指针：盘顶上一个小三角
  g.fillStyle = "#3a2a1a";
  g.fillRect(7, 0, 2, 2);
}

function Icon({ draw }: { draw: (g: CanvasRenderingContext2D) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = ref.current?.getContext("2d");
    if (g) draw(g);
  });
  return <canvas ref={ref} width={16} height={16} className="hud-clock-icon" />;
}

/** 顶栏左边：本机时间（小钟）和书房里的时间（天空盘），两个不一样 */
export function Clocks({ extra }: { extra?: React.ReactNode }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);
  const env = getEngine()?.env;
  const now = new Date();
  const floor = floorLabel();
  return (
    <span className="hud-clocks">
      <span className="hud-clock" title="本机时间">
        <Icon draw={(g) => drawWatch(g, now)} />
        {String(now.getHours()).padStart(2, "0")}:{String(now.getMinutes()).padStart(2, "0")}
      </span>
      {env && (
        <span className="hud-clock game" title="书房里的时间与天气（在窗台调：跟随现实 / 加速 / 固定）">
          <Icon draw={(g) => drawDial(g, env.isNightOverride ? 22.5 : env.hour)} />
          书房 {env.isNightOverride ? "夜读" : formatHour(env.hour)} · {WEATHER_NAMES[env.weather]}
          {extra}
        </span>
      )}
      {floor && <span className="hud-clock">{floor}</span>}
    </span>
  );
}
