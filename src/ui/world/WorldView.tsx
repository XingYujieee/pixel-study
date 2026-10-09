import { useEffect, useRef } from "react";
import { saveLayoutNow, setPlayerSource } from "../../app/actions";
import { useApp } from "../../app/store";
import * as worldActions from "../../app/worldActions";
import * as studyModule from "../../app/study";
import { interact, placeFurniture, setEngine, standUp } from "../../app/worldActions";
import { useWorld } from "../../app/worldStore";
import { WorldEngine } from "../../world/engine";
import { themeOf } from "../../world/themes";
import { ThemeGui } from "./ThemeGui";
import { WallGui, WallPickGui } from "./WallGui";
import { PetsGui } from "./PetsGui";
import { ButlerGui } from "./ButlerGui";
import { FloorsGui } from "./FloorsGui";
import { isGroundFloor } from "../../world/floors";
import { syncGarden } from "../../app/garden";
import { applyToolHand, placeGarden } from "../../app/gardenTools";
import { ejectDeck, putBack, restoreDeck, stopInspect, toggleInspect } from "../../app/records";
import { releaseHold, startHold } from "../../app/hold";
import { useJukebox } from "../../app/jukebox";
import { GARDEN_HOTBAR } from "../../world/held";
import { InspectCard, RecordsGui } from "./RecordsGui";
import { JukeboxGui, SoundGui } from "./SoundGuis";
import { sfx, stepSound } from "../../app/sound";
import { syncPets } from "../../app/pets";
import { placeWall, refreshWallContents, syncWall } from "../../app/wall";
import { refreshRealWeather } from "../../app/realWeather";
import { WALL_SIZES } from "../../world/wall";
import { HOTBAR, shelfBooks } from "../../world/layout";
import { openCapture, pendingCount, setStandingCarpet, startStudy, useStudy } from "../../app/study";
import { dustLevel, glowLevel, lastTouched } from "../../study/bookState";
import { PondGui } from "./PondGui";
import { CarpetGui, PresetsGui } from "./StudyGuis";
import { AiGui } from "./AiGui";
import { ChestGui } from "./ChestGui";
import { WindowGui } from "./WindowGui";
import { Help, RemoveConfirm } from "./Misc";
import { Hud } from "./Hud";
import { PauseMenu } from "./PauseMenu";
import { ShelfGui } from "./ShelfGui";
import { WorkbenchGui } from "./WorkbenchGui";
import { WritingDesk } from "./WritingDesk";

/** 书房：三维场景 + 叠加界面。整个库打开期间保持挂载，专注模式时只是隐藏并暂停渲染。 */
export function WorldView({ hidden }: { hidden: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const engineRef = useRef<WorldEngine | null>(null);
  const layout = useWorld((s) => s.layout);
  const layoutVersion = useWorld((s) => s.layoutVersion);
  const mode = useWorld((s) => s.mode);
  const gui = useWorld((s) => s.gui);
  const slot = useWorld((s) => s.slot);
  const filesVersion = useApp((s) => s.filesVersion);

  const layoutRef = useRef<ReturnType<typeof useWorld.getState>["layout"]>(null);

  // 创建引擎
  useEffect(() => {
    if (!host.current) return;
    const e = new WorldEngine(
      host.current,
      {
        onTarget: (t) => useWorld.getState().setTarget(t),
        onInteract: (t) => interact(t),
        onPlace: (f) => placeFurniture(f),
        onPlaceRejected: (reason) => useApp.getState().toast(`放不下：${reason}`),
        onGardenPlace: (tool, x, z) => placeGarden(tool, x, z),
        onOutside: (out) => {
          useWorld.getState().setOutside(out);
          applyToolHand();
        },
        onPlaceWall: (spot) => placeWall(spot),
        onPause: () => {
          engineRef.current?.cancelWallPlacing();
          const w = useWorld.getState();
          if (w.mode === "explore") w.setMode("paused");
        },
        nativeGrab: async (on) => {
          try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            const win = getCurrentWindow();
            await win.setCursorGrab(on);
            await win.setCursorVisible(!on);
            return true;
          } catch {
            return false;
          }
        },
        onCarpet: (fid) => setStandingCarpet(fid),
        onStep: () => stepSound(),
        onDropArrive: () => sfx("pop", 0.8),
        onDoor: (open) => sfx(open ? "doorOpen" : "doorClose", 0.9),
        onLand: (h) => h > 0.4 && sfx("land", Math.min(1, 0.4 + h * 0.3)),
        onLookFallback: () => {
          useWorld.getState().setLookFallback(true);
          useApp.getState().toast("这台设备不支持锁定鼠标：按住鼠标拖动来转动视角，单击交互。");
        },
      },
      (f) => {
        const files = useApp.getState().files;
        if (!f.shelf) return [];
        const st = useStudy.getState();
        const now = Date.now();
        return shelfBooks(f.shelf, files)
          .filter((b) => b.entry)
          .map((b) => ({
            path: b.path,
            kind: b.entry!.kind,
            dust: st.bookStatus ? dustLevel(lastTouched(b.entry!, st.opened[b.path]), now) : 0,
            glow: st.bookStatus ? glowLevel(st.backlinks[b.path]) : 0,
          }));
      },
    );
    engineRef.current = e;
    setEngine(e);
    // 闪电之后过一会儿打雷（光比声音快）
    e.env.onLightning = () => setTimeout(() => sfx("thunder"), 400 + Math.random() * 1400);
    startStudy();
    void refreshRealWeather();
    e.setPondBubble(!!useStudy.getState().bubble);
    e.env.setPending(pendingCount());
    if (import.meta.env.DEV) (window as unknown as { __world: unknown }).__world = { engine: e, useWorld, useApp, actions: worldActions, study: studyModule };
    const current = useWorld.getState().layout;
    if (current) {
      e.setGroundFloor(isGroundFloor(current));
      e.bird.setKind(current.butler?.kind ?? "owl");
      syncGarden();
      e.setTheme(themeOf(current.theme));
      e.setLayout(current);
      e.setEnv(current.env);
      syncWall();
      syncPets();
      layoutRef.current = current;
    }
    restoreDeck();
    applyToolHand();
    setPlayerSource(() => e.player());
    // 名牌用像素字体：字体加载完后重画一次
    void document.fonts?.load('12px "Fusion Pixel"', "书架名牌").then(() => engineRef.current?.refreshBooks()).catch(() => {});
    const onUnload = () => void saveLayoutNow();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      setPlayerSource(null);
      setEngine(null);
      e.dispose();
      engineRef.current = null;
      layoutRef.current = null;
    };
  }, []);

  // 布局：首次设置；之后家具的增删由动作函数直接重建
  useEffect(() => {
    const e = engineRef.current;
    if (!e || !layout || layoutRef.current === layout) return;
    layoutRef.current = layout;
    e.setGroundFloor(isGroundFloor(layout));
    e.bird.setKind(layout.butler?.kind ?? "owl");
    syncGarden();
    e.setTheme(themeOf(layout.theme));
    e.setLayout(layout);
    e.setEnv(layout.env);
    syncWall();
    syncPets();
  }, [layout]);

  // 文件变化、书脊状态变化 → 刷新书；灵感池数量 → 天气
  const studyVersion = useStudy((s) => s.version);
  useEffect(() => {
    engineRef.current?.refreshBooks();
  }, [filesVersion, layoutVersion, studyVersion]);
  useEffect(() => {
    engineRef.current?.env.setPending(pendingCount());
    refreshWallContents();
  }, [filesVersion]);

  // 模式 → 引擎状态
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setHidden(hidden);
    e.setExplore(mode === "explore" && !hidden);
  }, [mode, hidden]);

  // 手上拿什么：屋里是物品栏的家具，院子里是园艺工具，拿着唱片时是唱片
  const gslot = useWorld((s) => s.gslot);
  const outside = useWorld((s) => s.outside);
  const carry = useWorld((s) => s.carry);
  useEffect(() => {
    applyToolHand();
  }, [slot, gslot, outside, carry]);

  // 唱片：歌单或布局变了就重新摆
  const tracks = useJukebox((s) => s.tracks);
  useEffect(() => {
    restoreDeck();
  }, [tracks]);
  useEffect(() => {
    restoreDeck();
  }, [layoutVersion, layout]);

  // 书房快捷键（探索模式）
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.isComposing || ev.keyCode === 229 || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      // 编辑器已经处理了（比如 Esc 关掉斜杠菜单）
      if (ev.defaultPrevented) return;
      const w = useWorld.getState();
      const tgt = ev.target as HTMLElement | null;
      const typing = !!tgt && (tgt.isContentEditable || tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA");
      if (ev.key === "Escape") {
        if (w.inspect) {
          ev.preventDefault();
          stopInspect();
          return;
        }
        if (w.mode === "gui") {
          ev.preventDefault();
          w.closeGui();
        } else if (w.mode === "writing") {
          ev.preventDefault();
          void standUp();
        } else if (w.mode === "explore") {
          // 浏览器 Pointer Lock 会自行退出并触发暂停；原生锁定与拖动模式在这里处理
          engineRef.current?.releaseLock();
          w.setMode("paused");
        } else if (w.mode === "paused") {
          w.setMode("idle");
        }
        return;
      }
      if (typing || w.mode !== "explore") return;
      const e = engineRef.current;
      if (/^Digit[0-9]$/.test(ev.code) && w.outside) {
        const n = Number(ev.code.slice(5));
        if (n >= 1 && n <= GARDEN_HOTBAR.length) w.setGslot(n - 1);
      } else if (/^Digit[0-9]$/.test(ev.code)) {
        const n = Number(ev.code.slice(5));
        if (n === 0 || n <= HOTBAR.length) w.setSlot(n === 0 ? 9 : n - 1);
      } else if (ev.code === "Minus" && HOTBAR.length > 10) {
        w.setSlot(10);
      } else if (ev.code === "Equal" && HOTBAR.length > 11) {
        w.setSlot(11);
      } else if (ev.code === "KeyC") {
        ev.preventDefault();
        openCapture();
      } else if (ev.code === "KeyF" && w.carry) {
        toggleInspect();
      } else if (ev.code === "KeyE" || ev.code === "KeyF") {
        if (ev.repeat) return;
        const t = w.target;
        if (!t || t.kind === "floor" || t.kind === "wallspot" || t.kind === "gardenspot") return;
        if (w.inspect) stopInspect();
        // 留声机上有唱片、手上空着：短按打开播放面板，按住取下唱片
        if (t.kind === "furniture" && t.type === "jukebox" && !w.carry && w.deck) {
          startHold("取下唱片", 550, () => void ejectDeck(true), () => interact(t));
          return;
        }
        interact(t);
      } else if (ev.code === "KeyR") {
        // 挂画框时：R 换尺寸
        const pl = e?.isWallPlacing;
        if (pl && pl.type === "frame") {
          const sizes = WALL_SIZES.frame;
          const i = sizes.findIndex((z) => z.w === pl.w && z.h === pl.h);
          const nx = sizes[(i + 1) % sizes.length];
          e!.setWallPlacingSize(nx.w, nx.h);
        } else e?.rotateGhost();
      } else if (ev.code === "KeyX" || ev.code === "Delete" || ev.code === "Backspace") {
        const t = w.target;
        if (t && (t.kind === "furniture" || t.kind === "book")) {
          e?.releaseLock();
          w.openGui({ kind: "remove", fid: t.fid });
        } else if (t?.kind === "wall") {
          e?.releaseLock();
          w.openGui({ kind: "wall", id: t.id });
        } else if (t?.kind === "pet") {
          e?.releaseLock();
          w.openGui({ kind: "pets", id: t.id });
        }
      } else if (ev.code === "KeyH") {
        e?.releaseLock();
        w.openGui({ kind: "help" });
      } else if (ev.code === "KeyQ") {
        if (w.carry) putBack();
        else if (w.outside) w.setGslot(0);
        else w.setSlot(0);
      } else if (ev.code === "KeyT") {
        e?.releaseLock();
        w.openGui({ kind: "theme" });
      } else if (ev.code === "KeyP") {
        e?.releaseLock();
        w.openGui({ kind: "pets" });
      } else if (ev.code === "KeyG") {
        ev.preventDefault();
        void import("../../app/butler").then((m) => m.summonButler());
      } else if (ev.code === "KeyM") {
        e?.releaseLock();
        w.openGui({ kind: "sound" });
      }
    };
    const onWheel = (ev: WheelEvent) => {
      const w = useWorld.getState();
      if (w.mode !== "explore") return;
      if (w.outside) {
        const g = GARDEN_HOTBAR.length;
        w.setGslot((w.gslot + (ev.deltaY > 0 ? 1 : -1) + g) % g);
        return;
      }
      const n = HOTBAR.length;
      w.setSlot((w.slot + (ev.deltaY > 0 ? 1 : -1) + n) % n);
    };
    // 松开 E 或鼠标：没按满的"按住"取消
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.code === "KeyE" || ev.code === "KeyF") releaseHold();
    };
    const onMouseUp = (ev: MouseEvent) => {
      if (ev.button === 0) releaseHold();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("wheel", onWheel);
    };
  }, []);

  /** 点击画面进入探索（需要用户手势才能锁定鼠标） */
  const enter = () => {
    const w = useWorld.getState();
    if (w.mode !== "idle" && w.mode !== "paused") return;
    w.setMode("explore");
    void engineRef.current?.lock();
  };

  return (
    <div className={`world ${hidden ? "is-hidden" : ""} m-${mode}`}>
      <div className="world-host" ref={host} onMouseDown={mode === "idle" ? enter : undefined} />
      {!hidden && (
        <>
          {(mode === "explore" || mode === "idle") && <Hud />}
          {mode === "idle" && layout && (
            <button className="enter-hint mc-text" onClick={enter}>
              点击画面进入书房
            </button>
          )}
          {mode === "paused" && <PauseMenu onResume={enter} />}
          {mode === "writing" && <WritingDesk />}
          {gui?.kind === "shelf" && <ShelfGui fid={gui.fid} />}
          {gui?.kind === "workbench" && <WorkbenchGui shelfId={gui.shelfId} />}
          {gui?.kind === "chest" && <ChestGui />}
          {gui?.kind === "remove" && <RemoveConfirm fid={gui.fid} />}
          {gui?.kind === "help" && <Help />}
          {gui?.kind === "window" && <WindowGui />}
          {gui?.kind === "ai" && <AiGui />}
          {gui?.kind === "pond" && <PondGui />}
          {gui?.kind === "carpet" && <CarpetGui fid={gui.fid} />}
          {gui?.kind === "presets" && <PresetsGui />}
          {gui?.kind === "theme" && <ThemeGui />}
          {gui?.kind === "wall" && <WallGui id={gui.id} />}
          {gui?.kind === "wallpick" && <WallPickGui />}
          {gui?.kind === "pets" && <PetsGui focus={gui.id} />}
          {gui?.kind === "sound" && <SoundGui />}
          {gui?.kind === "jukebox" && <JukeboxGui />}
          {gui?.kind === "records" && <RecordsGui />}
          {mode === "explore" && <InspectCard />}
          {gui?.kind === "floors" && <FloorsGui />}
          {gui?.kind === "butler" && <ButlerGui settings={gui.settings} />}
          {!layout && <div className="world-loading mc-text">正在整理书房…</div>}
        </>
      )}
    </div>
  );
}
