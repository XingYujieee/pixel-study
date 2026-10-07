import type { FileEntry } from "../ipc";

export interface TreeDir {
  type: "dir";
  name: string;
  path: string;
  dirs: TreeDir[];
  files: FileEntry[];
  /** 子树中的文件总数 */
  count: number;
}

const collator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });

/** 由扁平文件列表构建目录树；目录在前，按中文自然顺序排序。 */
export function buildTree(entries: Iterable<FileEntry>): TreeDir {
  const root: TreeDir = { type: "dir", name: "", path: "", dirs: [], files: [], count: 0 };
  const dirMap = new Map<string, TreeDir>([["", root]]);
  const ensure = (path: string): TreeDir => {
    const hit = dirMap.get(path);
    if (hit) return hit;
    const i = path.lastIndexOf("/");
    const parent = ensure(i === -1 ? "" : path.slice(0, i));
    const d: TreeDir = { type: "dir", name: path.slice(i + 1), path, dirs: [], files: [], count: 0 };
    parent.dirs.push(d);
    dirMap.set(path, d);
    return d;
  };
  for (const e of entries) {
    const i = e.path.lastIndexOf("/");
    ensure(i === -1 ? "" : e.path.slice(0, i)).files.push(e);
  }
  const finish = (d: TreeDir): number => {
    d.dirs.sort((a, b) => collator.compare(a.name, b.name));
    d.files.sort((a, b) => collator.compare(a.name, b.name));
    d.count = d.files.length + d.dirs.reduce((s, c) => s + finish(c), 0);
    return d.count;
  };
  finish(root);
  return root;
}

/** 某路径的所有祖先目录（用于展开到当前文件）。 */
export function ancestors(path: string): string[] {
  const parts = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}
