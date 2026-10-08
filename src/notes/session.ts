// 编辑会话（风险 3、4）：
// - 整个应用只有一个 EditorView；每个打开的文件一份 EditorState（包含撤销历史），切换文件用 setState。
// - 沉浸 / 专注切换时用 moveTo() 移动 view.dom，不重建实例。
// - 自动保存、写前校验、冲突、外部修改刷新、恢复草稿都在这里。
import { Annotation, EditorState, type StateEffect, Text, Transaction } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import type { Draft, NoteContent, SaveOutcome, VaultEvent } from "../ipc";
import { basename, extname } from "../lib/paths";
import { detectLineSeparator, minimalChange } from "../lib/text";
import { editorExtensions } from "./editorSetup";

export type DocStatus = "clean" | "dirty" | "saving" | "error" | "conflict" | "missing";

export interface DocInfo {
  path: string;
  status: DocStatus;
  error?: string;
  /** 冲突时磁盘上的版本 */
  conflict?: { diskContent: string; diskHash: string };
  lastSavedAt?: number;
  lineSeparator: "\n" | "\r\n";
}

export interface NotesApi {
  read(path: string): Promise<NoteContent>;
  save(path: string, content: string, baseHash: string | null): Promise<SaveOutcome>;
  draftWrite(path: string, content: string, baseHash: string | null): Promise<void>;
  draftClear(path: string): Promise<void>;
}

export interface ControllerOptions {
  autosaveMs?: number;
  draftMs?: number;
  retryMs?: number;
}

interface DocSession {
  path: string;
  state: EditorState;
  savedDoc: Text;
  baseHash: string | null;
  info: DocInfo;
  saving: Promise<void> | null;
  saveAgain: boolean;
  autosaveTimer?: ReturnType<typeof setTimeout>;
  draftTimer?: ReturnType<typeof setTimeout>;
  hasDraft: boolean;
  /** 离开时的滚动快照，切换回来时恢复 */
  scroll: StateEffect<unknown> | null;
}

/** 外部刷新、程序化替换产生的事务，不触发自动保存逻辑之外的副作用 */
const external = Annotation.define<boolean>();

type Listener = () => void;

export class EditorController {
  readonly view: EditorView;
  private docs = new Map<string, DocSession>();
  private active: string | null = null;
  private listeners = new Set<Listener>();
  private opts: Required<ControllerOptions>;

  constructor(
    private api: NotesApi,
    opts: ControllerOptions = {},
  ) {
    this.opts = { autosaveMs: 1000, draftMs: 5000, retryMs: 5000, ...opts };
    this.view = new EditorView({ state: EditorState.create({ doc: "" }) });
    this.view.dom.classList.add("ps-editor");
  }

  // ───────────── 订阅 ─────────────

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }

  get activePath(): string | null {
    return this.active;
  }

  info(path: string): DocInfo | undefined {
    return this.docs.get(path)?.info;
  }

  allInfo(): DocInfo[] {
    return [...this.docs.values()].map((d) => d.info);
  }

  /** 当前文档文本（用于预览、字数） */
  activeText(): string {
    return this.active ? this.view.state.doc.toString() : "";
  }

  hasUnsaved(): boolean {
    return [...this.docs.values()].some((d) => !this.stateOf(d).doc.eq(d.savedDoc));
  }

  // ───────────── 挂载（风险 3） ─────────────

  /** 把唯一的编辑器移动到另一个容器（沉浸 / 专注切换），保留选区、撤销历史与滚动位置。 */
  moveTo(parent: HTMLElement) {
    if (this.view.dom.parentElement === parent) return;
    const snapshot = this.view.scrollSnapshot();
    parent.replaceChildren(this.view.dom);
    this.view.dispatch({ effects: snapshot });
  }

  focus() {
    this.view.focus();
  }

  // ───────────── 打开 / 切换 / 关闭 ─────────────

  private stateOf(d: DocSession): EditorState {
    return d.path === this.active ? this.view.state : d.state;
  }

  private makeState(path: string, content: string): EditorState {
    const sep = detectLineSeparator(content);
    const docText = EditorState.create({ doc: content, extensions: sep === "\r\n" ? [EditorState.lineSeparator.of("\r\n")] : [] }).doc;
    return EditorState.create({
      doc: content,
      // 新打开的书：光标放在末尾，接着写
      selection: { anchor: docText.length },
      extensions: editorExtensions({
        kind: extname(path) === "txt" ? "text" : "markdown",
        lineSeparator: sep,
        onUpdate: (u) => this.onUpdate(u),
      }),
    });
  }

  private newSession(path: string, content: string, hash: string | null, status: DocStatus = "clean"): DocSession {
    const state = this.makeState(path, content);
    const d: DocSession = {
      path,
      state,
      savedDoc: state.doc,
      baseHash: hash,
      info: { path, status, lineSeparator: detectLineSeparator(content) },
      saving: null,
      saveAgain: false,
      hasDraft: false,
      scroll: null,
    };
    this.docs.set(path, d);
    return d;
  }

  async open(path: string): Promise<void> {
    let d = this.docs.get(path);
    if (!d) {
      const n = await this.api.read(path);
      // 读取期间可能已被另一次 open 创建
      d = this.docs.get(path) ?? this.newSession(path, n.content, n.hash);
    }
    this.activate(d);
  }

  private activate(d: DocSession) {
    if (this.active === d.path) {
      this.notify();
      return;
    }
    const prev = this.active ? this.docs.get(this.active) : undefined;
    if (prev) {
      prev.state = this.view.state;
      prev.scroll = this.view.scrollSnapshot();
      // 离开时立即保存，不等计时器
      if (prev.info.status === "dirty") void this.save(prev.path);
    }
    this.active = d.path;
    this.view.setState(d.state);
    this.view.dispatch({ effects: d.scroll ?? EditorView.scrollIntoView(0, { y: "start", yMargin: 400 }) });
    this.notify();
  }

  /** 关闭文件：有未保存内容时先保存。 */
  async close(path: string) {
    const d = this.docs.get(path);
    if (!d) return;
    if (d.info.status === "dirty") await this.save(path);
    clearTimeout(d.autosaveTimer);
    clearTimeout(d.draftTimer);
    if (this.active === path) {
      d.state = this.view.state;
      d.scroll = this.view.scrollSnapshot();
      this.active = null;
      this.view.setState(EditorState.create({ doc: "" }));
    }
    if (d.info.status === "clean") this.docs.delete(path);
    this.notify();
  }

  /** 在文档末尾追加文字（作为一次可撤销的编辑） */
  appendText(text: string) {
    const doc = this.view.state.doc;
    const sep = this.view.state.lineBreak;
    const lead = doc.length === 0 ? "" : doc.sliceString(doc.length - 1) === sep.slice(-1) ? sep : sep + sep;
    const insert = this.view.state.toText((lead + text.replace(/\r?\n/g, sep)).replace(/\s*$/, "") + sep);
    this.view.dispatch({ changes: { from: doc.length, insert }, selection: { anchor: doc.length + insert.length }, scrollIntoView: true });
  }

  /** 跳到某行（全文搜索结果） */
  revealLine(line: number) {
    const doc = this.view.state.doc;
    const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
    this.view.dispatch({ selection: { anchor: l.from, head: l.to }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
    this.view.focus();
  }

  // ───────────── 编辑与自动保存 ─────────────

  private onUpdate(u: ViewUpdate) {
    if (!u.docChanged || !this.active) return;
    const d = this.docs.get(this.active);
    if (!d) return;
    const isExternal = u.transactions.some((tr) => tr.annotation(external));
    const dirty = !u.state.doc.eq(d.savedDoc);
    if (d.info.status === "conflict" || d.info.status === "missing") {
      // 冲突 / 已删除时只记草稿，不自动写盘
      if (dirty) this.scheduleDraft(d);
      this.notify();
      return;
    }
    if (isExternal && !dirty) {
      this.setStatus(d, "clean");
      return;
    }
    if (dirty) {
      if (d.info.status !== "saving") this.setStatus(d, "dirty");
      this.scheduleAutosave(d);
      this.scheduleDraft(d);
    } else if (d.info.status === "dirty") {
      // 撤销回到已保存内容
      clearTimeout(d.autosaveTimer);
      this.setStatus(d, "clean");
      void this.clearDraft(d);
    }
    this.notify();
  }

  private setStatus(d: DocSession, status: DocStatus, extra: Partial<DocInfo> = {}) {
    d.info = { ...d.info, status, error: undefined, ...extra };
    if (status !== "conflict") d.info.conflict = extra.conflict;
    this.notify();
  }

  private scheduleAutosave(d: DocSession) {
    clearTimeout(d.autosaveTimer);
    d.autosaveTimer = setTimeout(() => void this.save(d.path), this.opts.autosaveMs);
  }

  private scheduleDraft(d: DocSession) {
    if (d.draftTimer) return;
    d.draftTimer = setTimeout(() => {
      d.draftTimer = undefined;
      const st = this.stateOf(d);
      if (st.doc.eq(d.savedDoc)) return;
      d.hasDraft = true;
      this.api.draftWrite(d.path, st.sliceDoc(), d.baseHash).catch(() => {});
    }, this.opts.draftMs);
  }

  private async clearDraft(d: DocSession) {
    clearTimeout(d.draftTimer);
    d.draftTimer = undefined;
    if (!d.hasDraft) return;
    d.hasDraft = false;
    await this.api.draftClear(d.path).catch(() => {});
  }

  /** 立即保存（Cmd+S）。不传路径时保存当前文件。 */
  saveNow(path?: string | null): Promise<void> {
    const p = path ?? this.active;
    return p ? this.save(p) : Promise.resolve();
  }

  async saveAll(): Promise<void> {
    await Promise.all([...this.docs.keys()].map((p) => this.save(p)));
  }

  private save(path: string): Promise<void> {
    const d = this.docs.get(path);
    if (!d) return Promise.resolve();
    clearTimeout(d.autosaveTimer);
    if (d.info.status === "conflict" || d.info.status === "missing") return Promise.resolve();
    if (d.saving) {
      d.saveAgain = true;
      return d.saving;
    }
    const st = this.stateOf(d);
    if (st.doc.eq(d.savedDoc) && d.baseHash !== null) {
      if (d.info.status !== "clean") this.setStatus(d, "clean");
      return Promise.resolve();
    }
    const docAtSave = st.doc;
    const content = st.sliceDoc();
    this.setStatus(d, "saving");
    d.saving = (async () => {
      try {
        const out = await this.api.save(path, content, d.baseHash);
        if (out.status === "saved") {
          d.baseHash = out.hash;
          d.savedDoc = docAtSave;
          const stillDirty = !this.stateOf(d).doc.eq(d.savedDoc);
          this.setStatus(d, stillDirty ? "dirty" : "clean", { lastSavedAt: Date.now() });
          if (!stillDirty) await this.clearDraft(d);
        } else if (out.status === "conflict") {
          this.setStatus(d, "conflict", { conflict: { diskContent: out.diskContent, diskHash: out.diskHash } });
          this.forceDraft(d);
        } else {
          this.setStatus(d, "missing");
          this.forceDraft(d);
        }
      } catch (e) {
        this.setStatus(d, "error", { error: e && typeof e === "object" && "message" in e ? String(e.message) : String(e) });
        d.autosaveTimer = setTimeout(() => void this.save(path), this.opts.retryMs);
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

  private forceDraft(d: DocSession) {
    d.hasDraft = true;
    this.api.draftWrite(d.path, this.stateOf(d).sliceDoc(), d.baseHash).catch(() => {});
  }

  // ───────────── 外部修改（风险 4） ─────────────

  /** 用新内容替换文档，只改变真正不同的部分；不进入撤销历史。 */
  private replaceContent(d: DocSession, content: string, addToHistory: boolean) {
    const st = this.stateOf(d);
    const next = st.toText(content);
    const ch = minimalChange(st.doc.toString(), next.toString());
    if (!ch) return;
    const spec = {
      changes: { from: ch.from, to: ch.to, insert: next.slice(ch.insertFrom, ch.insertTo) },
      annotations: [external.of(true), Transaction.addToHistory.of(addToHistory)],
    };
    if (d.path === this.active) this.view.dispatch(spec);
    else d.state = st.update(spec).state;
  }

  async handleEvents(events: VaultEvent[]): Promise<void> {
    for (const ev of events) {
      if (ev.kind === "renamed") this.rename(ev.from, ev.entry.path);
      else if (ev.kind === "removed") {
        const d = this.docs.get(ev.path);
        if (d && d.info.status !== "conflict") {
          clearTimeout(d.autosaveTimer);
          this.setStatus(d, "missing");
          if (!this.stateOf(d).doc.eq(d.savedDoc)) this.forceDraft(d);
        }
      } else {
        const path = ev.entry.path;
        const d = this.docs.get(path);
        if (!d) continue;
        const hash = ev.kind === "modified" ? ev.hash : null;
        if (hash && hash === d.baseHash && d.info.status !== "missing") continue;
        await this.reloadFromDisk(d);
      }
    }
  }

  private async reloadFromDisk(d: DocSession) {
    if (d.saving) await d.saving;
    let n: NoteContent;
    try {
      n = await this.api.read(d.path);
    } catch {
      return;
    }
    if (n.hash === d.baseHash && d.info.status !== "missing") return;
    const dirty = !this.stateOf(d).doc.eq(d.savedDoc);
    if (!dirty) {
      // 没有未保存内容：静默刷新，保持光标
      this.replaceContent(d, n.content, false);
      d.baseHash = n.hash;
      d.savedDoc = this.stateOf(d).doc;
      clearTimeout(d.autosaveTimer);
      this.setStatus(d, "clean");
    } else {
      clearTimeout(d.autosaveTimer);
      this.setStatus(d, "conflict", { conflict: { diskContent: n.content, diskHash: n.hash } });
      this.forceDraft(d);
    }
  }

  private rename(from: string, to: string) {
    const d = this.docs.get(from);
    if (!d) return;
    this.docs.delete(from);
    void this.api.draftClear(from).catch(() => {});
    d.path = to;
    d.info = { ...d.info, path: to };
    this.docs.set(to, d);
    if (this.active === from) this.active = to;
    if (d.hasDraft) this.forceDraft(d);
    this.notify();
  }

  // ───────────── 冲突与恢复 ─────────────

  /**
   * 处理冲突：
   * - mine：用编辑器内容覆盖磁盘（以磁盘当前哈希为基准写入）
   * - disk：放弃本地修改，采用磁盘版本
   * - merged：采用合并结果（文本以 \n 分行，按文件原换行符写回）
   */
  async resolveConflict(path: string, choice: "mine" | "disk" | "merged", merged?: string) {
    const d = this.docs.get(path);
    if (!d?.info.conflict) return;
    const { diskContent, diskHash } = d.info.conflict;
    if (choice === "disk") {
      this.replaceContent(d, diskContent, true);
      d.baseHash = diskHash;
      d.savedDoc = this.stateOf(d).doc;
      this.setStatus(d, "clean");
      await this.clearDraft(d);
      return;
    }
    if (choice === "merged" && merged !== undefined) {
      const sep = d.info.lineSeparator;
      this.replaceContent(d, sep === "\r\n" ? merged.replace(/\r?\n/g, "\r\n") : merged, true);
    }
    d.baseHash = diskHash;
    // 让保存流程认为有变化
    d.savedDoc = this.stateOf(d).toText(diskContent);
    this.setStatus(d, "dirty");
    await this.save(path);
  }

  /** 文件被外部删除后，用户选择按当前内容重新创建。 */
  async recreate(path: string) {
    const d = this.docs.get(path);
    if (!d || d.info.status !== "missing") return;
    d.baseHash = null;
    d.savedDoc = Text.empty;
    this.setStatus(d, "dirty");
    await this.save(path);
  }

  /** 丢弃已删除文件的会话 */
  discard(path: string) {
    const d = this.docs.get(path);
    if (!d) return;
    clearTimeout(d.autosaveTimer);
    clearTimeout(d.draftTimer);
    void this.clearDraft(d);
    this.docs.delete(path);
    if (this.active === path) {
      this.active = null;
      this.view.setState(EditorState.create({ doc: "" }));
    }
    this.notify();
  }

  /**
   * 恢复草稿：打开文件后把草稿内容作为普通编辑放入编辑器（可撤销），由自动保存写盘。
   * 若磁盘在草稿之后被修改过，直接进入冲突比较；文件已不存在则进入"已删除"状态。
   */
  async restoreDraft(draft: Draft) {
    let d = this.docs.get(draft.path);
    if (!d) {
      try {
        const n = await this.api.read(draft.path);
        d = this.newSession(draft.path, n.content, n.hash);
      } catch {
        d = this.newSession(draft.path, draft.content, null, "missing");
        d.savedDoc = Text.empty;
        d.hasDraft = true;
        this.activate(d);
        return;
      }
    }
    this.activate(d);
    const diskChanged = draft.baseHash !== null && draft.baseHash !== d.baseHash;
    d.hasDraft = true;
    if (diskChanged) {
      const disk = this.stateOf(d).sliceDoc();
      const diskHash = d.baseHash ?? "";
      this.replaceContent(d, draft.content, true);
      this.setStatus(d, "conflict", { conflict: { diskContent: disk, diskHash } });
    } else {
      // 普通编辑：进入撤销历史，触发自动保存
      const st = this.stateOf(d);
      const next = st.toText(draft.content);
      const ch = minimalChange(st.doc.toString(), next.toString());
      if (ch) this.view.dispatch({ changes: { from: ch.from, to: ch.to, insert: next.slice(ch.insertFrom, ch.insertTo) } });
    }
  }

  async discardDraft(draft: Draft) {
    await this.api.draftClear(draft.path).catch(() => {});
  }

  title(path: string | null): string {
    return path ? basename(path) : "";
  }

  destroy() {
    this.reset();
    this.view.destroy();
  }

  /** 已保存后切换库：取消旧会话计时器，不能让相同相对路径复用旧库正文。 */
  reset() {
    for (const d of this.docs.values()) {
      clearTimeout(d.autosaveTimer);
      clearTimeout(d.draftTimer);
    }
    this.docs.clear();
    this.active = null;
    this.view.setState(EditorState.create({ doc: "" }));
    this.notify();
  }
}
