// 显示笔记、AI 回答时的 HTML 清理：在 DOMPurify 默认规则之上，去掉表单和 <style>，
// style 属性只保留颜色（笔记里的 <span style="color:…"> 还能显示，但不能把整个界面盖住或改样子）。
import DOMPurify from "dompurify";

const purifier = DOMPurify(window);

const SAFE_DECL = /^\s*(color|background-color|background|text-align|text-decoration|font-weight|font-style)\s*:\s*[#a-z0-9(),.%\s-]{1,40}$/i;

purifier.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName !== "style") return;
  const kept = data.attrValue
    .split(";")
    .filter((d) => SAFE_DECL.test(d) && !/url\s*\(|expression|var\s*\(/i.test(d))
    .join(";");
  if (kept) data.attrValue = kept;
  else data.keepAttr = false;
});

const FORBID_TAGS = ["style", "form", "input", "button", "textarea", "select", "option", "iframe", "object", "embed", "link", "meta", "base"];

export function safeHtml(html: string, opts: { addAttr?: string[]; uriRegexp?: RegExp } = {}): string {
  return purifier.sanitize(html, {
    FORBID_TAGS,
    ADD_ATTR: opts.addAttr ?? [],
    ...(opts.uriRegexp ? { ALLOWED_URI_REGEXP: opts.uriRegexp } : {}),
  }) as string;
}
