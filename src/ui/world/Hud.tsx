import { useApp } from "../../app/store";
import { furniture } from "../../app/worldActions";
import { useWorld } from "../../app/worldStore";
import { basename } from "../../lib/paths";
import { iconUrl } from "../../world/icons";
import { AMBIENCES, HOTBAR, SPECS } from "../../world/layout";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../ipc";
import { stripFrontmatter } from "../../study/inbox";
import { pendingCount, useStudy } from "../../app/study";
import { formatLeft, remainingMs, useHourglass } from "../../app/hourglass";
import { useRealWeather } from "../../app/realWeather";
import { Clocks } from "./Clocks";


export function Hud() {
  const target = useWorld((s) => s.target);
  const slot = useWorld((s) => s.slot);
  const mode = useWorld((s) => s.mode);
  const fallback = useWorld((s) => s.lookFallback);
  const filesVersion = useApp((s) => s.filesVersion);
  const pending = useMemo(() => pendingCount(), [filesVersion]);
  const bubble = useStudy((s) => s.bubble);
  const selected = HOTBAR[slot];

  const preview = useBookPreview(target?.kind === "book" && mode === "explore" ? target.path : null);
  let label: string | null = null;
  let hint: string | null = null;
  if (target?.kind === "book") {
    label = basename(target.path).replace(/\.(md|markdown)$/i, "");
    hint = /\.(md|markdown|txt|docx)$/i.test(target.path) ? "左键 / E：带到书桌写作" : "左键 / E：用系统应用打开";
  } else if (target?.kind === "furniture") {
    const f = furniture(target.fid);
    label =
      f?.type === "bookshelf"
        ? `书架 · ${f.shelf?.name ?? ""}`
        : f?.type === "carpet"
          ? `地毯 · ${AMBIENCES.find((a) => a.id === (f.ambience ?? "none"))!.name}`
          : f?.type === "pond"
            ? `鱼塘 · ${pending} 条灵感${bubble ? " · 在冒泡" : ""}`
            : SPECS[target.type].name;
    hint = `${SPECS[target.type].hint} · X 拆除`;
  } else if (target?.kind === "wall") {
    const it = useWorld.getState().layout?.wall?.find((x) => x.id === target.id);
    label = it ? `${it.type === "board" ? "黑板" : "画框"}${it.note || it.image ? ` · ${basename((it.note ?? it.image)!)}` : ""}` : null;
    hint = "左键 / E：换内容 · X 取下";
  } else if (target?.kind === "pet") {
    const pet = useWorld.getState().layout?.pets?.find((x) => x.id === target.id);
    label = pet?.name ?? null;
    hint = "左键 / E：摸摸头 · X 改名或送回家";
  } else if (target?.kind === "bird") {
    label = useWorld.getState().layout?.butler?.name ?? "咕咕";
    hint = "左键 / G：叫它过来说话";
  } else if (target?.kind === "garden") {
    const names: Record<string, string> = { weed: "杂草", flower: "野花", trunk: "树", bush: "灌木", hay: "草垛", bed: "花坛", farmland: "菜地", bench: "长椅", table: "野餐桌", woodpile: "柴堆", well: "井" };
    label = names[target.item] ?? "花园";
    hint = target.item === "weed" ? "左键：拔掉" : target.item === "flower" ? "左键：摘掉" : "G 叫管家：可以让它移走、在旁边种点什么";
  } else if (target?.kind === "door") {
    label = target.open ? "门 · 开着" : "门";
    hint = target.open ? "左键 / E：关门" : "左键 / E：开门，出去是花园";
  } else if (target?.kind === "wallspot") {
    label = "挂到这里";
    hint = target.valid ? "左键挂上 · 右键取消 · R 换尺寸（画框）" : `挂不上：${target.reason}`;
  } else if (target?.kind === "floor" && selected) {
    label = SPECS[selected].name;
    hint = target.valid ? "右键放置 · R 旋转" : `放不下：${target.reason}`;
  }

  return (
    <div className="hud">
      {mode === "explore" && !fallback && <div className="crosshair" />}
      <div className="hud-top mc-text">
        <span>
          <Clock />
          <span className="hud-env" title="鱼塘里待整理的灵感（Inbox/）">鱼塘 {pending}</span>
          <HudHourglass />
        </span>
        <span className="hud-keys">WASD 移动 · 空格 跳 · G 管家 · T 换屋子 · P 宠物 · C 随手记 · H 帮助 · Esc 菜单 · ⌘K 搜索</span>
      </div>
      {label && mode === "explore" && (
        <div className="target-label">
          <div className="mc-text big">{label}</div>
          {preview && <div className="book-peek">{preview}</div>}
          {hint && <div className="mc-text small">{hint}</div>}
        </div>
      )}
      <div className="hotbar" role="toolbar" aria-label="物品栏">
        {HOTBAR.map((t, i) => (
          <button
            key={i}
            className={`hot-slot ${i === slot ? "sel" : ""}`}
            onClick={() => useWorld.getState().setSlot(i)}
            title={t ? `${SPECS[t].name}（右键放置）` : "空手（左键交互）"}
          >
            <img className="hot-icon" src={iconUrl(t ?? "hand")} alt="" draggable={false} />
            <span className="hot-num mc-text">{i < 9 ? i + 1 : i === 9 ? 0 : i === 10 ? "-" : "="}</span>
          </button>
        ))}
      </div>
      <div className="hot-name mc-text">{selected ? `${SPECS[selected].name} · 右键放到地上` : "空手 · 左键与家具和书交互"}</div>
    </div>
  );
}

/** 天气跟随现实时显示气温 */
function RealTemp() {
  const t = useRealWeather((s) => s.temperature);
  const following = useWorld((s) => s.layout?.env.weather === "real" && !!s.layout.env.realPlace);
  if (!following || t === null) return null;
  return <> · {Math.round(t)}°</>;
}

/** 沙漏计时中：顶栏显示剩余时间 */
function HudHourglass() {
  const running = useHourglass((s) => s.running);
  if (!running) return null;
  return <span className="hud-env">⏳ {formatLeft(remainingMs())}</span>;
}

const peekCache = new Map<string, string>();

/** 准星对准一本书时显示开头两行（Markdown / TXT），结果缓存 */
function useBookPreview(path: string | null): string | null {
  const [, force] = useState(0);
  const filesVersion = useApp((s) => s.filesVersion);
  const entry = path ? useApp.getState().files.get(path) : undefined;
  const key = path && entry ? `${path}@${entry.mtime}` : null;
  useEffect(() => {
    if (!path || !key || peekCache.has(key) || !/\.(md|markdown|txt)$/i.test(path)) return;
    const t = setTimeout(() => {
      api
        .noteRead(path)
        .then((n) => {
          peekCache.set(key, peekText(n.content));
          force((x) => x + 1);
        })
        .catch(() => peekCache.set(key, ""));
    }, 120);
    return () => clearTimeout(t);
  }, [path, key, filesVersion]);
  if (!path) return null;
  if (/\.docx$/i.test(path)) return "Word 文档";
  return (key && peekCache.get(key)) || null;
}

/** 开头几行：去掉属性区、标题与列表符号 */
export function peekText(md: string): string {
  const lines = stripFrontmatter(md)
    .split("\n")
    .map((l) => l.replace(/^\s*(#+|[-*+]\s+\[[ xX]\]|[-*+>]|\d+\.)\s*/, "").replace(/[*_`]/g, "").trim())
    .filter(Boolean);
  const out = lines.slice(0, 3).join(" · ");
  return out.length > 90 ? `${out.slice(0, 90)}…` : out;
}

function Clock() {
  return <Clocks extra={<RealTemp />} />;
}
