import { chooseVault } from "../../app/actions";
import { sideBySideWithFinder } from "../../app/sideBySide";
import { useApp } from "../../app/store";
import { openCapture, setBookStatus, useStudy } from "../../app/study";
import { enterFocus } from "../../app/worldActions";
import { useWorld } from "../../app/worldStore";

export function PauseMenu({ onResume }: { onResume: () => void }) {
  const vault = useApp((s) => s.vault);
  const bookStatus = useStudy((s) => s.bookStatus);
  return (
    <div className="mc-overlay">
      <div className="pause">
        <h2 className="mc-title">游戏菜单</h2>
        <button className="mc-btn wide" onClick={onResume} autoFocus>
          回到书房
        </button>
        <button
          className="mc-btn wide"
          onClick={() => {
            if (!useApp.getState().selected) {
              const recent = useApp.getState().recent.find((p) => useApp.getState().files.has(p));
              if (recent) useApp.getState().select(recent);
            }
            enterFocus();
          }}
        >
          专注写作模式（⌘J）
        </button>
        <div className="row-2">
          <button className="mc-btn" onClick={() => useApp.getState().setQuickOpen(true)}>
            搜索笔记
          </button>
          <button className="mc-btn" onClick={() => useWorld.getState().openGui({ kind: "help" })}>
            操作说明
          </button>
        </div>
        <p className="mc-text small pause-section">装扮书房</p>
        <div className="row-3">
          <button className="mc-btn" onClick={() => useWorld.getState().openGui({ kind: "theme" })}>
            换屋子（T）
          </button>
          <button className="mc-btn" onClick={() => useWorld.getState().openGui({ kind: "pets" })}>
            宠物（P）
          </button>
          <button className="mc-btn" onClick={() => void import("../../app/butler").then((m) => m.summonButler())}>
            管家（G）
          </button>
          <button className="mc-btn" onClick={() => useWorld.getState().openGui({ kind: "sound" })}>
            声音与音乐（M）
          </button>
          <button className="mc-btn" onClick={() => useWorld.getState().openGui({ kind: "floors" })}>
            楼层
          </button>
          <button className="mc-btn" onClick={() => useWorld.getState().openGui({ kind: "wallpick" })}>
            挂到墙上
          </button>
          <button className="mc-btn" onClick={() => useWorld.getState().openGui({ kind: "presets" })}>
            布局预设
          </button>
          <button className="mc-btn" onClick={openCapture}>
            随手记（C）
          </button>
        </div>
        <div className="row-2">
          <button className="mc-btn" onClick={() => void sideBySideWithFinder()} title="书房缩到左边，访达在右边，方便拖文件进来">
            与访达并排
          </button>
          <button className="mc-btn" onClick={() => void chooseVault()}>
            切换笔记库
          </button>
        </div>
        <div className="pause-checks">
          <label className="mc-check light" title="久没碰的书蒙上一层灰，常被其他笔记引用的书发亮。只是外观。">
            <input type="checkbox" checked={bookStatus} onChange={(e) => setBookStatus(e.target.checked)} />
            书脊蒙灰 / 发亮
          </label>
        </div>
        <p className="mc-text small pause-foot">当前库：{vault?.root}</p>
      </div>
    </div>
  );
}
