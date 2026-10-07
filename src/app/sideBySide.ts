// 与访达并排：书房缩到屏幕左边约六成，访达在右边打开库文件夹，方便直接把文件拖进来。
import { api, errorMessage } from "../ipc";
import { useApp } from "./store";

export async function sideBySideWithFinder() {
  const toast = useApp.getState().toast;
  try {
    const { getCurrentWindow, currentMonitor, LogicalPosition, LogicalSize } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    const mon = await currentMonitor();
    if (!mon) throw new Error("读不到屏幕信息");
    const sf = mon.scaleFactor || 1;
    const area = mon.workArea ?? { position: mon.position, size: mon.size };
    const x = area.position.x / sf;
    const y = area.position.y / sf;
    const w = area.size.width / sf;
    const h = area.size.height / sf;
    const left = Math.round(w * 0.58);
    await win.unmaximize().catch(() => {});
    await win.setPosition(new LogicalPosition(Math.round(x), Math.round(y)));
    await win.setSize(new LogicalSize(left, Math.round(h)));
    const placed = await api.finderBeside(Math.round(x + left), Math.round(y), Math.round(x + w), Math.round(y + h));
    toast(placed ? "访达在右边，把文件直接拖到书房里的家具上就能导入。" : "已在访达里打开库文件夹，把它放到旁边，再把文件拖进书房。");
  } catch (e) {
    toast(`没能并排：${errorMessage(e)}`, "error");
  }
}
