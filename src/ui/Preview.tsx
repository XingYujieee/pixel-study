import { convertFileSrc } from "@tauri-apps/api/core";
import { useDeferredValue, useMemo } from "react";
import { openPath } from "../app/actions";
import { api, errorMessage } from "../ipc";
import { useApp } from "../app/store";
import { buildLinkIndex, resolveWikilink } from "../lib/links";
import { joinAbs } from "../lib/paths";
import { renderMarkdown } from "../notes/markdown";

export function Preview({ text, notePath }: { text: string; notePath: string }) {
  const deferred = useDeferredValue(text);
  const files = useApp((s) => s.files);
  const version = useApp((s) => s.filesVersion);
  const root = useApp((s) => s.vault?.root ?? "");

  const index = useMemo(() => buildLinkIndex(files.keys()), [files, version]);

  const html = useMemo(
    () =>
      renderMarkdown(deferred, {
        notePath,
        resolveLink: (t) => resolveWikilink(t, notePath, index, (p) => files.has(p)),
        assetUrl: (rel) => convertFileSrc(joinAbs(root, rel)),
      }),
    [deferred, notePath, index, files, root],
  );

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const path = a.getAttribute("data-path");
    const ext = a.getAttribute("data-external");
    if (path) void openPath(path);
    else if (ext) api.openUrl(ext).catch((err) => useApp.getState().toast(errorMessage(err), "error"));
  };

  return <article className="preview" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
