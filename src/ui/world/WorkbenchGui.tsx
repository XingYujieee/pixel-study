import { useMemo, useState } from "react";
import { useApp } from "../../app/store";
import { allTemplates, exportBuiltinTemplates, useStudy } from "../../app/study";
import { useWorld } from "../../app/worldStore";
import { craftBook, takeBook, type BookType } from "../../app/worldActions";
import { useImeSafeKeys } from "./useImeSafeKeys";

const RECIPES: { type: BookType; name: string; desc: string; cls: string }[] = [
  { type: "md", name: "笔记本", desc: "Markdown · 与 Obsidian 互通", cls: "k-markdown" },
  { type: "docx", name: "Word 文档", desc: ".docx · 可用 Word 打开", cls: "k-word" },
  { type: "txt", name: "纸条", desc: "纯文本 .txt", cls: "k-text" },
];

function defaultName() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 工作台：选择配方、命名、放到哪个书架，然后制作并带到书桌 */
export function WorkbenchGui({ shelfId }: { shelfId?: string }) {
  const layout = useWorld((s) => s.layout);
  useWorld((s) => s.layoutVersion);
  const shelves = layout?.furniture.filter((f) => f.type === "bookshelf") ?? [];
  const [type, setType] = useState<BookType>("md");
  const [name, setName] = useState(defaultName);
  const [target, setTarget] = useState<string>(shelfId ?? shelves.find((s) => s.shelf?.mode === "virtual")?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [template, setTemplate] = useState("builtin:blank");
  const filesVersion = useApp((s) => s.filesVersion);
  const templateDir = useStudy((s) => s.templateDir);
  const templates = useMemo(() => allTemplates(), [filesVersion, templateDir]);
  const hasVaultTemplates = templates.some((t) => !t.id.startsWith("builtin:"));
  const tpl = templates.find((t) => t.id === template);
  const close = () => useWorld.getState().closeGui();
  const craft = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const path = await craftBook(type, name.trim(), target || null, template);
    setBusy(false);
    if (path) {
      useWorld.getState().closeGui();
      await takeBook(path);
    }
  };
  const keys = useImeSafeKeys({ onEnter: () => void craft(), onEscape: close });
  const targetShelf = shelves.find((s) => s.id === target)?.shelf;
  const where = targetShelf
    ? targetShelf.mode === "folder"
      ? `保存到文件夹「${targetShelf.folder || "库根目录"}」`
      : `保存到 Notes/，放上「${targetShelf.name}」`
    : "保存到 Notes/";

  return (
    <div className="mc-overlay" onMouseDown={close}>
      <div className="mc-panel bench-panel" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="mc-title">工作台</h2>
        <div className="recipes">
          {RECIPES.map((r) => (
            <button key={r.type} className={`recipe ${type === r.type ? "on" : ""}`} onClick={() => setType(r.type)}>
              <span className="slot big">
                <i className={`book-icon big ${r.cls}`} />
              </span>
              <span className="mc-text">{r.name}</span>
              <span className="recipe-desc">{r.desc}</span>
            </button>
          ))}
        </div>
        <label className="field-row">
          <span className="mc-text">书名</span>
          <input className="mc-input" autoFocus value={name} onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)} {...keys} />
        </label>
        <label className="field-row">
          <span className="mc-text">鱼饵</span>
          <select className="mc-select" value={template} onChange={(e) => setTemplate(e.target.value)}>
            <optgroup label="内置模板">
              {templates
                .filter((t) => t.id.startsWith("builtin:"))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.desc}
                  </option>
                ))}
            </optgroup>
            {hasVaultTemplates && (
              <optgroup label={`库里的模板（${templateDir}/）`}>
                {templates
                  .filter((t) => !t.id.startsWith("builtin:"))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
        </label>
        <label className="field-row">
          <span className="mc-text">放到</span>
          <select className="mc-select" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">不放上书架</option>
            {shelves.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shelf?.name}
                {s.shelf?.mode === "folder" ? `（文件夹：${s.shelf.folder || "根目录"}）` : "（收藏）"}
              </option>
            ))}
          </select>
        </label>
        <p className="recipe-desc where">
          {where}。同名时自动加序号。
          {tpl && tpl.id !== "builtin:blank" && type === "txt" && " 纯文本会去掉模板开头的属性区。"}
        </p>
        <p className="recipe-desc where">
          模板就是「{templateDir}/」里的普通文件，写法与 Obsidian 模板相同（{"{{title}}"}、{"{{date}}"}、{"{{time}}"}）。
          <button className="link-btn" onClick={() => void exportBuiltinTemplates()}>
            把内置模板放进 {templateDir}/ 自己改
          </button>
        </p>
        <div className="panel-foot">
          <span className="spacer" />
          <button className="mc-btn" onClick={close}>
            取消
          </button>
          <button className="mc-btn on" disabled={!name.trim() || busy} onClick={() => void craft()}>
            {busy ? "制作中…" : "制作并开始写"}
          </button>
        </div>
      </div>
    </div>
  );
}
