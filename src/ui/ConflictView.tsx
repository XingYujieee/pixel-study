import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { controller } from "../app/editor";
import { zhPhrases } from "../notes/phrases";
import type { DocInfo } from "../notes/session";

/** 冲突比较：左侧为我的版本（可编辑，用于手动合并），右侧为磁盘上的版本。 */
export function ConflictView({ info }: { info: DocInfo }) {
  const host = useRef<HTMLDivElement>(null);
  const merge = useRef<MergeView | null>(null);
  const disk = info.conflict!.diskContent;

  useEffect(() => {
    if (!host.current) return;
    const mine = controller.view.state.doc.toString();
    const base = [zhPhrases, EditorView.lineWrapping, EditorView.theme({ "&": { height: "100%" }, ".cm-scroller": { fontFamily: "var(--font-text)" } })];
    merge.current = new MergeView({
      parent: host.current,
      a: { doc: mine, extensions: base },
      b: { doc: disk, extensions: [...base, EditorState.readOnly.of(true), EditorView.editable.of(false)] },
      collapseUnchanged: { margin: 3, minSize: 6 },
      gutter: true,
    });
    return () => {
      merge.current?.destroy();
      merge.current = null;
    };
    // 冲突内容变化时重建
  }, [disk, info.path]);

  const useMerged = () => {
    const text = merge.current?.a.state.doc.toString();
    if (text !== undefined) void controller.resolveConflict(info.path, "merged", text);
  };

  return (
    <div className="conflict">
      <div className="conflict-head">
        <div>
          <strong>这篇笔记在别处被修改了</strong>
          <p>你的修改尚未写入磁盘，两个版本都已保留。可以直接选一个版本，或在左侧编辑出合并结果。</p>
        </div>
        <div className="conflict-actions">
          <button className="btn" onClick={() => void controller.resolveConflict(info.path, "disk")}>
            采用磁盘版本
          </button>
          <button className="btn" onClick={() => void controller.resolveConflict(info.path, "mine")}>
            保留我的版本
          </button>
          <button className="btn primary" onClick={useMerged}>
            使用左侧合并结果
          </button>
        </div>
      </div>
      <div className="conflict-labels">
        <span>我的版本（可编辑）</span>
        <span>磁盘上的版本</span>
      </div>
      <div className="conflict-body" ref={host} />
    </div>
  );
}
