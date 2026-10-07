import { useState } from "react";
import { formatLeft, HOURGLASS_MINUTES, pauseHourglass, remainingMs, startHourglass, stopHourglass, useHourglass } from "../../app/hourglass";

/** 沙漏按钮：没在计时时选时长翻过来；计时中显示剩余时间，可以暂停或停下 */
export function HourglassChip({ compact }: { compact?: boolean }) {
  const running = useHourglass((s) => s.running);
  const [open, setOpen] = useState(false);
  if (running) {
    return (
      <span className="hg-chip">
        <button className="mc-btn small on" onClick={pauseHourglass} title={running.pausedLeft !== null ? "继续" : "暂停"}>
          ⏳ {formatLeft(remainingMs())}
          {running.pausedLeft !== null ? " · 暂停中" : ""}
        </button>
        {!compact && (
          <button className="mc-btn small" onClick={stopHourglass} title="停下（不算失败，也不记录）">
            停
          </button>
        )}
      </span>
    );
  }
  return (
    <span className="hg-chip">
      <button className="mc-btn small" onClick={() => setOpen(!open)} title="书桌上的沙漏：专注一段时间">
        ⏳ 沙漏
      </button>
      {open && (
        <span className="hg-menu">
          {HOURGLASS_MINUTES.map((m) => (
            <button
              key={m}
              className="mc-btn small"
              onClick={() => {
                setOpen(false);
                startHourglass(m);
              }}
            >
              {m} 分钟
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
