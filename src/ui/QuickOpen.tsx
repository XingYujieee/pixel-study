import { useEffect, useMemo, useRef, useState } from "react";
import { openPath } from "../app/actions";
import { locateInRoom, takeBook } from "../app/worldActions";
import { useWorld } from "../app/worldStore";
import { useApp } from "../app/store";
import { api, type SearchHit } from "../ipc";
import { fuzzyFiles } from "../lib/fuzzy";
import { basename, dirname } from "../lib/paths";

type Item = { type: "file"; path: string; hits: number[] } | { type: "text"; hit: SearchHit };

/** 全局搜索：文件名在内存中模糊匹配，正文搜索交给 Rust。空输入显示最近打开。 */
export function QuickOpen() {
  const open = useApp((s) => s.quickOpen);
  if (!open) return null;
  return <QuickOpenInner />;
}

function QuickOpenInner() {
  const files = useApp((s) => s.files);
  const version = useApp((s) => s.filesVersion);
  const recent = useApp((s) => s.recent);
  const [q, setQ] = useState("");
  const [textHits, setTextHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState(0);
  const composing = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => useApp.getState().setQuickOpen(false);

  const fileItems: Item[] = useMemo(() => {
    if (!q.trim()) {
      return recent.filter((p) => files.has(p)).slice(0, 12).map((path) => ({ type: "file", path, hits: [] }));
    }
    return fuzzyFiles(q, files.values(), 8).map((m) => ({ type: "file", path: m.entry.path, hits: m.hits }));
  }, [q, files, version, recent]);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setTextHits([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      api
        .search(query, 40)
        .then(setTextHits)
        .catch(() => setTextHits([]))
        .finally(() => setSearching(false));
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const items: Item[] = [...fileItems, ...textHits.map((hit) => ({ type: "text" as const, hit }))];

  useEffect(() => setCursor(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(".qo-item.cur")?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const inWorld = useWorld((s) => s.mode !== "focus");
  /** 在书房里找到它（带路） */
  const locate = (it: Item | undefined) => {
    if (!it) return;
    close();
    void locateInRoom(it.type === "file" ? it.path : it.hit.path);
  };

  const choose = (it: Item | undefined) => {
    if (!it) return;
    close();
    const path = it.type === "file" ? it.path : it.hit.path;
    const line = it.type === "file" ? undefined : it.hit.line;
    // 书房中：把书带到书桌；专注模式：直接打开
    if (useWorld.getState().mode !== "focus") {
      void takeBook(path).then(() => line && void openPath(path, { line, remember: false }));
    } else void openPath(path, { line });
  };

  const onKey = (e: React.KeyboardEvent) => {
    // 输入法选字期间的按键全部交给输入法
    if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(items.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.altKey && inWorld) locate(items[cursor]);
      else choose(items[cursor]);
    }
  };

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="quickopen" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="qo-input"
          placeholder="搜索文件名或正文…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => setTimeout(() => (composing.current = false), 0)}
        />
        <div className="qo-list" ref={listRef}>
          {!q.trim() && fileItems.length > 0 && <div className="qo-group">最近打开</div>}
          {q.trim() && fileItems.length > 0 && <div className="qo-group">文件</div>}
          {items.map((it, i) => {
            const first = it.type === "text" && i === fileItems.length;
            return (
              <div key={it.type === "file" ? `f:${it.path}` : `t:${it.hit.path}:${it.hit.line}:${i}`}>
                {first && <div className="qo-group">正文</div>}
                <button
                  className={`qo-item ${i === cursor ? "cur" : ""}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={(e) => (e.altKey && inWorld ? locate(it) : choose(it))}
                >
                  {it.type === "file" ? (
                    <>
                      <span className="qo-title">
                        <Highlight text={basename(it.path)} hits={it.hits} />
                      </span>
                      <span className="qo-path">{dirname(it.path)}</span>
                    </>
                  ) : (
                    <>
                      <span className="qo-snippet">
                        {it.hit.snippet.slice(0, it.hit.start)}
                        <mark>{it.hit.snippet.slice(it.hit.start, it.hit.end)}</mark>
                        {it.hit.snippet.slice(it.hit.end)}
                      </span>
                      <span className="qo-path">
                        {it.hit.path}:{it.hit.line}
                      </span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
          {q.trim() && items.length === 0 && <div className="qo-empty">{searching ? "搜索中…" : "没有找到匹配的笔记"}</div>}
        </div>
        {inWorld && items.length > 0 && (
          <div className="qo-foot">
            <span>Enter 带到书桌</span>
            <span>⌥ Enter 在书房里找到它</span>
            <button className="qo-locate" onClick={() => locate(items[cursor])}>
              带我去
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Highlight({ text, hits }: { text: string; hits: number[] }) {
  if (hits.length === 0) return <>{text}</>;
  const set = new Set(hits);
  return (
    <>
      {text.split("").map((ch, i) => (set.has(i) ? <mark key={i}>{ch}</mark> : <span key={i}>{ch}</span>))}
    </>
  );
}
