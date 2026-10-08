import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { saveLayoutNow, startup } from "./app/actions";
import { controller, word, saveCurrent, saveEverything } from "./app/editor";
import { useApp } from "./app/store";
import { enterFocus, exitFocus, getEngine } from "./app/worldActions";
import { useWorld } from "./app/worldStore";
import { openCapture, startStudy } from "./app/study";
import { startRealWeather } from "./app/realWeather";
import { startSound } from "./app/sound";
import { loadTracks } from "./app/jukebox";
import { CaptureDialog } from "./ui/world/PondGui";
import { importFromDialog, listenDragDrop } from "./app/importer";
import { DropHint, ImportReceiptCard } from "./ui/ImportOverlay";
import { DraftBanner, NewNoteDialog, Toasts } from "./ui/Dialogs";
import { EditorPane } from "./ui/EditorPane";
import { QuickOpen } from "./ui/QuickOpen";
import { Sidebar } from "./ui/Sidebar";
import { Welcome } from "./ui/Welcome";
import { WorldView } from "./ui/world/WorldView";

export function App() {
  const vault = useApp((s) => s.vault);
  const switchingVault = useApp((s) => s.switchingVault);
  const mode = useWorld((s) => s.mode);
  const focus = mode === "focus";

  useEffect(() => {
    startStudy();
    startRealWeather();
    startSound();
    void loadTracks();
    void startup();

    // 全局快捷键。输入法选字期间不处理任何快捷键。
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;
      const s = useApp.getState();
      if (s.switchingVault) return;
      if (!s.vault) return;
      const k = e.key.toLowerCase();
      const w = useWorld.getState();
      if (k === "o" && !e.shiftKey) {
        e.preventDefault();
        if (w.mode === "explore") getEngine()?.releaseLock();
        if (w.mode === "explore" || w.mode === "paused") w.setMode("idle");
        void importFromDialog();
      } else if (k === "i" && e.shiftKey) {
        e.preventDefault();
        openCapture();
      } else if (k === "s") {
        e.preventDefault();
        void saveCurrent(s.selected);
      } else if (k === "k" || k === "p") {
        e.preventDefault();
        if (w.mode === "explore") getEngine()?.releaseLock();
        if (w.mode === "explore" || w.mode === "paused") w.setMode("idle");
        s.setQuickOpen(!s.quickOpen);
      } else if (k === "n" && w.mode === "focus") {
        e.preventDefault();
        s.setNewNote(true);
      } else if (k === "e") {
        e.preventDefault();
        s.togglePreview();
      } else if (k === "j") {
        e.preventDefault();
        if (w.mode === "focus") exitFocus();
        else enterFocus();
      }
    };
    window.addEventListener("keydown", onKey, true);

    // 关闭窗口前写完所有未保存内容和书房布局
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        await Promise.all([saveEverything(), saveLayoutNow()]);
        if (controller.hasUnsaved() || word.hasUnsaved()) {
          event.preventDefault();
          useApp.getState().toast("仍有未保存内容，请先处理保存错误或冲突后再关闭。", "error");
        }
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      })
      .catch(() => {});

    // 从 Finder 拖文件进窗口（整个应用只注册一次）
    void listenDragDrop();

    return () => {
      disposed = true;
      window.removeEventListener("keydown", onKey, true);
      unlisten?.();
    };
  }, []);

  if (!vault) {
    return (
      <div className="app">
        <Welcome />
        <Toasts />
      </div>
    );
  }

  return (
    <div className="app" inert={switchingVault} aria-busy={switchingVault}>
      <WorldView hidden={focus} />
      {focus && (
        <div className="focus-layer">
          <Sidebar />
          <main className="main">
            <DraftBanner />
            <EditorPane />
          </main>
        </div>
      )}
      {!focus && (
        <div className="world-banner">
          <DraftBanner />
        </div>
      )}
      <QuickOpen />
      <CaptureDialog />
      <DropHint />
      <ImportReceiptCard />
      <NewNoteDialog />
      <Toasts />
    </div>
  );
}
