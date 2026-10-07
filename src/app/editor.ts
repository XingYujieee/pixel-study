import { useSyncExternalStore } from "react";
import { api } from "../ipc";
import { isWordPath } from "../lib/paths";
import { EditorController, type DocInfo } from "../notes/session";
import { WordController, type WordInfo } from "../word/session";

/** 整个应用唯一的 Markdown / TXT 编辑器控制器 */
export const controller = new EditorController({
  read: api.noteRead,
  save: api.noteSave,
  draftWrite: api.draftWrite,
  draftClear: api.draftClear,
});

/** 整个应用唯一的 Word 编辑器控制器 */
export const word = new WordController({
  read: api.fileReadBytes,
  save: api.fileSaveBytes,
  draftWrite: api.draftWrite,
  draftClear: api.draftClear,
});

let version = 0;
const bump = () => {
  version++;
};
controller.subscribe(bump);
word.subscribe(bump);

function useVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      const a = controller.subscribe(cb);
      const b = word.subscribe(cb);
      return () => {
        a();
        b();
      };
    },
    () => version,
  );
}

export type AnyInfo = (DocInfo & { kind: "text" }) | (WordInfo & { kind: "word" });

export function docInfo(path: string | null): AnyInfo | undefined {
  if (!path) return undefined;
  if (isWordPath(path)) {
    const i = word.info(path);
    return i ? { ...i, kind: "word" } : undefined;
  }
  const i = controller.info(path);
  return i ? { ...i, kind: "text" } : undefined;
}

export function useDocInfo(path: string | null): AnyInfo | undefined {
  useVersion();
  return docInfo(path);
}

/** 当前文档文本，随编辑变化（预览、字数）。 */
export function useActiveText(path: string | null): string {
  useVersion();
  if (!path) return "";
  if (isWordPath(path)) return word.activePath === path ? word.activeText() : "";
  return controller.activePath === path ? controller.activeText() : "";
}

export async function saveEverything() {
  await Promise.all([controller.saveAll(), word.saveAll()]);
}

export function saveCurrent(path: string | null) {
  if (path && isWordPath(path)) return word.saveNow(path);
  return controller.saveNow(path);
}

/** 把一段文字追加到当前打开的文档末尾（AI 回答插入笔记用）。返回是否成功。 */
export function appendToActive(path: string | null, markdownText: string): boolean {
  if (!path) return false;
  if (isWordPath(path)) {
    if (word.activePath !== path || word.info(path)?.readOnly) return false;
    word.appendText(markdownText);
    return true;
  }
  if (controller.activePath !== path) return false;
  controller.appendText(markdownText);
  return true;
}
