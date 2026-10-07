// 库内相对路径工具。统一使用 `/`，不以 `/` 开头。

export function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

export function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

export function stem(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(0, i) : b;
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1).toLowerCase() : "";
}

/**
 * 把笔记中的相对链接解析为库内路径。越出库根返回 null。
 * 支持 `./`、`../`、URL 编码（`%20`）、以 `/` 开头表示库根。
 */
export function resolveRelative(fromNote: string, target: string): string | null {
  let t = target.trim();
  if (!t || /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("#")) return null;
  t = t.split("#")[0].split("?")[0];
  try {
    t = decodeURIComponent(t);
  } catch {
    // 保留原样
  }
  const base = t.startsWith("/") ? [] : dirname(fromNote).split("/").filter(Boolean);
  for (const seg of t.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (base.length === 0) return null;
      base.pop();
    } else base.push(seg);
  }
  return base.join("/") || null;
}

export function joinAbs(root: string, rel: string): string {
  return root.replace(/\/+$/, "") + "/" + rel;
}

export function isTextPath(p: string): boolean {
  return ["md", "markdown", "txt"].includes(extname(p));
}

export function isWordPath(p: string): boolean {
  return extname(p) === "docx";
}

/** 可在应用内编辑的文件 */
export function isEditablePath(p: string): boolean {
  return isTextPath(p) || isWordPath(p);
}
