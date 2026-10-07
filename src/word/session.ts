// Word 编辑会话：一个 contenteditable 编辑区（整个应用只有一个），按文件切换内容。
// 保存流程与 Markdown 相同：输入停止后自动保存、写前校验哈希、冲突不覆盖、外部修改刷新、草稿。
// 首次覆盖一个不是本应用写出的 .docx 之前，先把原文件备份到应用数据目录。
import DOMPurify from "dompurify";
import type { BytesSaveOutcome, Draft, VaultEvent } from "../ipc";
import type { DocStatus } from "../notes/session";
import { readDocx, writeDocx } from "./docx";

export interface WordApi {
  read(path: string): Promise<{ bytes: Uint8Array; hash: string }>;
  save(path: string, bytes: Uint8Array, baseHash: string | null, backup: boolean): Promise<BytesSaveOutcome>;
  draftWrite(path: string, content: string, baseHash: string | null): Promise<void>;
  draftClear(path: string): Promise<void>;
}

export interface WordInfo {
  path: string;
  status: DocStatus;
  error?: string;
  /** 含有无法完整保留的格式；未确认前只读 */
  lossy: string[];
  readOnly: boolean;
  lastSavedAt?: number;
  conflict?: { diskHash: string };
}

interface WordDoc {
  path: string;
  html: string;
  savedHtml: string;
  baseHash: string | null;
  info: WordInfo;
  backedUp: boolean;
  saving: Promise<void> | null;
  saveAgain: boolean;
  timer?: ReturnType<typeof setTimeout>;
  draftTimer?: ReturnType<typeof setTimeout>;
  scrollTop: number;
}

const ALLOWED = {
  ALLOWED_TAGS: ["p", "h1", "h2", "h3", "h4", "h5", "h6", "b", "strong", "i", "em", "u", "s", "strike", "del", "ul", "ol", "li", "blockquote", "pre", "code", "br", "a", "img", "table", "thead", "tbody", "tr", "td", "th", "hr", "span", "div"],
  ALLOWED_ATTR: ["href", "src", "alt", "width", "height", "colspan", "rowspan", "style"],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/)/i,
};

export class WordController {
  /** 编辑区（滚动容器内的页面） */
  readonly page: HTMLDivElement;
  readonly scroller: HTMLDivElement;
  private docs = new Map<string, WordDoc>();
  private active: string | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private api: WordApi,
    private opts = { autosaveMs: 1500, draftMs: 5000, retryMs: 5000 },
  ) {
    this.scroller = document.createElement("div");
    this.scroller.className = "word-scroller";
    this.page = document.createElement("div");
    this.page.className = "word-page";
    this.page.contentEditable = "true";
    this.page.spellcheck = false;
    this.page.lang = "zh-CN";
    this.scroller.appendChild(this.page);
    this.page.addEventListener("input", () => this.onInput());
    this.page.addEventListener("paste", (e) => this.onPaste(e));
    this.page.addEventListener("keydown", (e) => {
      // Tab 缩进列表，而不是移走焦点
      if (e.key === "Tab" && !e.isComposing) {
        e.preventDefault();
        document.execCommand(e.shiftKey ? "outdent" : "indent");
      }
    });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify() {
    for (const fn of this.listeners) fn();
  }

  get activePath() {
    return this.active;
  }
  info(path: string): WordInfo | undefined {
    return this.docs.get(path)?.info;
  }
  hasUnsaved(): boolean {
    this.capture();
    return [...this.docs.values()].some((d) => d.html !== d.savedHtml);
  }
  activeText(): string {
    return this.active ? this.page.innerText : "";
  }

  moveTo(parent: HTMLElement) {
    if (this.scroller.parentElement === parent) return;
    const top = this.scroller.scrollTop;
    parent.appendChild(this.scroller);
    this.scroller.scrollTop = top;
  }

  private caretToEnd = false;

  focus() {
    if (this.docs.get(this.active ?? "")?.info.readOnly) return;
    this.page.focus();
    if (this.caretToEnd) {
      // 新打开的文档：光标放在末尾，接着写
      this.caretToEnd = false;
      const sel = window.getSelection();
      const range = document.createRange();
      const last = this.page.lastElementChild ?? this.page;
      range.selectNodeContents(last);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }

  /** 把编辑区当前内容写回会话 */
  private capture() {
    const d = this.active ? this.docs.get(this.active) : undefined;
    if (d) d.html = this.page.innerHTML;
  }

  async open(path: string) {
    let d = this.docs.get(path);
    if (!d) {
      const { bytes, hash } = await this.api.read(path);
      const { html, lossy } = await readDocx(bytes);
      let clean = DOMPurify.sanitize(html, ALLOWED);
      // 以标题结尾时补一个空段落，光标落在正文而不是标题里
      if (/<\/h[1-6]>\s*$/.test(clean) || !clean.trim()) clean += "<p><br></p>";
      d = this.docs.get(path) ?? {
        path,
        html: clean,
        savedHtml: clean,
        baseHash: hash,
        info: { path, status: "clean", lossy, readOnly: lossy.length > 0 },
        backedUp: false,
        saving: null,
        saveAgain: false,
        scrollTop: 0,
      };
      this.docs.set(path, d);
    }
    this.activate(d);
  }

  private activate(d: WordDoc) {
    if (this.active === d.path) {
      this.notify();
      return;
    }
    const prev = this.active ? this.docs.get(this.active) : undefined;
    if (prev) {
      prev.html = this.page.innerHTML;
      prev.scrollTop = this.scroller.scrollTop;
      if (prev.html !== prev.savedHtml) void this.save(prev.path);
    }
    this.active = d.path;
    this.caretToEnd = true;
    this.page.innerHTML = d.html;
    this.page.contentEditable = d.info.readOnly ? "false" : "true";
    this.scroller.scrollTop = d.scrollTop;
    this.notify();
  }

  /** 用户确认编辑含复杂格式的文档（保存前会自动备份原文件） */
  allowEditing(path: string) {
    const d = this.docs.get(path);
    if (!d) return;
    d.info = { ...d.info, readOnly: false };
    if (this.active === path) this.page.contentEditable = "true";
    this.notify();
  }

  private onPaste(e: ClipboardEvent) {
    const dt = e.clipboardData;
    if (!dt) return;
    e.preventDefault();
    const html = dt.getData("text/html");
    if (html) {
      const clean = DOMPurify.sanitize(html, { ...ALLOWED, ALLOWED_ATTR: ["href", "src", "alt", "colspan", "rowspan"] });
      document.execCommand("insertHTML", false, clean);
    } else {
      document.execCommand("insertText", false, dt.getData("text/plain"));
    }
  }

  private onInput() {
    const d = this.active ? this.docs.get(this.active) : undefined;
    if (!d) return;
    d.html = this.page.innerHTML;
    const dirty = d.html !== d.savedHtml;
    if (d.info.status === "conflict" || d.info.status === "missing") {
      if (dirty) this.scheduleDraft(d);
      this.notify();
      return;
    }
    if (dirty) {
      if (d.info.status !== "saving") this.setStatus(d, "dirty");
      clearTimeout(d.timer);
      d.timer = setTimeout(() => void this.save(d.path), this.opts.autosaveMs);
      this.scheduleDraft(d);
    } else if (d.info.status === "dirty") {
      clearTimeout(d.timer);
      this.setStatus(d, "clean");
    }
    this.notify();
  }

  private setStatus(d: WordDoc, status: DocStatus, extra: Partial<WordInfo> = {}) {
    d.info = { ...d.info, status, error: undefined, conflict: undefined, ...extra };
    this.notify();
  }

  private scheduleDraft(d: WordDoc) {
    if (d.draftTimer) return;
    d.draftTimer = setTimeout(() => {
      d.draftTimer = undefined;
      if (d.html !== d.savedHtml) this.api.draftWrite(d.path, d.html, d.baseHash).catch(() => {});
    }, this.opts.draftMs);
  }

  saveNow(path?: string | null) {
    const p = path ?? this.active;
    return p ? this.save(p) : Promise.resolve();
  }

  async saveAll() {
    this.capture();
    await Promise.all([...this.docs.keys()].map((p) => this.save(p)));
  }

  private save(path: string): Promise<void> {
    const d = this.docs.get(path);
    if (!d) return Promise.resolve();
    clearTimeout(d.timer);
    if (path === this.active) d.html = this.page.innerHTML;
    if (d.info.status === "conflict" || d.info.status === "missing" || d.info.readOnly) return Promise.resolve();
    if (d.saving) {
      d.saveAgain = true;
      return d.saving;
    }
    if (d.html === d.savedHtml) {
      if (d.info.status !== "clean") this.setStatus(d, "clean");
      return Promise.resolve();
    }
    const html = d.html;
    this.setStatus(d, "saving");
    d.saving = (async () => {
      try {
        const holder = document.createElement("div");
        holder.innerHTML = html;
        const bytes = await writeDocx(holder);
        const backup = !d.backedUp && d.baseHash !== null;
        const out = await this.api.save(path, bytes, d.baseHash, backup);
        if (out.status === "saved") {
          d.backedUp = true;
          d.baseHash = out.hash;
          d.savedHtml = html;
          const still = d.html !== d.savedHtml;
          this.setStatus(d, still ? "dirty" : "clean", { lastSavedAt: Date.now() });
          if (!still) await this.api.draftClear(path).catch(() => {});
        } else if (out.status === "conflict") {
          this.setStatus(d, "conflict", { conflict: { diskHash: out.diskHash } });
          this.api.draftWrite(path, d.html, d.baseHash).catch(() => {});
        } else {
          this.setStatus(d, "missing");
          this.api.draftWrite(path, d.html, d.baseHash).catch(() => {});
        }
      } catch (e) {
        this.setStatus(d, "error", { error: e && typeof e === "object" && "message" in e ? String(e.message) : String(e) });
        d.timer = setTimeout(() => void this.save(path), this.opts.retryMs);
      } finally {
        d.saving = null;
      }
      if (d.saveAgain) {
        d.saveAgain = false;
        await this.save(path);
      }
    })();
    return d.saving;
  }

  async handleEvents(events: VaultEvent[]) {
    for (const ev of events) {
      if (ev.kind === "renamed") {
        const d = this.docs.get(ev.from);
        if (!d) continue;
        this.docs.delete(ev.from);
        d.path = ev.entry.path;
        d.info = { ...d.info, path: d.path };
        this.docs.set(d.path, d);
        if (this.active === ev.from) this.active = d.path;
        this.notify();
      } else if (ev.kind === "removed") {
        const d = this.docs.get(ev.path);
        if (d && d.info.status !== "conflict") {
          clearTimeout(d.timer);
          this.setStatus(d, "missing");
        }
      } else {
        const d = this.docs.get(ev.entry.path);
        if (!d) continue;
        const hash = ev.kind === "modified" ? ev.hash : null;
        if (hash && hash === d.baseHash) continue;
        if (d.saving) await d.saving;
        if (path_is_active(this, d)) d.html = this.page.innerHTML;
        if (d.html === d.savedHtml) await this.reload(d);
        else if (hash) {
          clearTimeout(d.timer);
          this.setStatus(d, "conflict", { conflict: { diskHash: hash } });
        }
      }
    }
  }

  private async reload(d: WordDoc) {
    const { bytes, hash } = await this.api.read(d.path);
    const { html, lossy } = await readDocx(bytes);
    const clean = DOMPurify.sanitize(html, ALLOWED);
    d.html = d.savedHtml = clean;
    d.baseHash = hash;
    d.backedUp = false;
    d.info = { ...d.info, lossy, readOnly: d.info.readOnly && lossy.length > 0 };
    if (this.active === d.path) {
      const top = this.scroller.scrollTop;
      this.page.innerHTML = clean;
      this.scroller.scrollTop = top;
    }
    this.setStatus(d, "clean");
  }

  /** 冲突：mine 覆盖磁盘（先备份），disk 重新载入磁盘版本 */
  async resolveConflict(path: string, choice: "mine" | "disk") {
    const d = this.docs.get(path);
    if (!d?.info.conflict) return;
    if (choice === "disk") {
      await this.reload(d);
      await this.api.draftClear(path).catch(() => {});
      return;
    }
    d.baseHash = d.info.conflict.diskHash;
    d.backedUp = false;
    d.savedHtml = "\u0000";
    this.setStatus(d, "dirty");
    await this.save(path);
  }

  async recreate(path: string) {
    const d = this.docs.get(path);
    if (!d || d.info.status !== "missing") return;
    d.baseHash = null;
    d.savedHtml = "\u0000";
    this.setStatus(d, "dirty");
    await this.save(path);
  }

  discard(path: string) {
    const d = this.docs.get(path);
    if (!d) return;
    clearTimeout(d.timer);
    clearTimeout(d.draftTimer);
    void this.api.draftClear(path).catch(() => {});
    this.docs.delete(path);
    if (this.active === path) {
      this.active = null;
      this.page.innerHTML = "";
    }
    this.notify();
  }

  async restoreDraft(draft: Draft) {
    try {
      await this.open(draft.path);
    } catch {
      return;
    }
    const d = this.docs.get(draft.path)!;
    d.info = { ...d.info, readOnly: false };
    this.page.contentEditable = "true";
    this.page.innerHTML = DOMPurify.sanitize(draft.content, ALLOWED);
    if (draft.baseHash && draft.baseHash !== d.baseHash) {
      d.html = this.page.innerHTML;
      this.setStatus(d, "conflict", { conflict: { diskHash: d.baseHash ?? "" } });
    } else this.onInput();
  }

  /** 在文档末尾追加文字：每段一个段落 */
  appendText(text: string) {
    for (const para of text.split(/\n{2,}/)) {
      const p = document.createElement("p");
      p.textContent = para.trim();
      if (p.textContent) this.page.appendChild(p);
    }
    this.onInput();
  }

  /** 格式命令（工具栏） */
  exec(cmd: "bold" | "italic" | "underline" | "strikeThrough" | "insertUnorderedList" | "insertOrderedList" | "removeFormat" | "undo" | "redo") {
    this.page.focus();
    document.execCommand(cmd);
    this.onInput();
  }

  block(tag: "p" | "h1" | "h2" | "h3" | "blockquote") {
    this.page.focus();
    document.execCommand("formatBlock", false, `<${tag}>`);
    this.onInput();
  }
}

function path_is_active(c: WordController, d: WordDoc) {
  return c.activePath === d.path;
}
