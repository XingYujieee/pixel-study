import { undo } from "@codemirror/commands";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NoteContent, SaveOutcome } from "../ipc";
import { EditorController, type NotesApi } from "./session";

/** 模拟 Rust 文件层：同样的写前校验语义 */
class FakeFs implements NotesApi {
  files = new Map<string, string>();
  saves: { path: string; content: string; base: string | null }[] = [];
  drafts = new Map<string, string>();
  failNext = false;

  static hash(s: string) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return `h${h.toString(16)}_${s.length}`;
  }
  async read(path: string): Promise<NoteContent> {
    const c = this.files.get(path);
    if (c === undefined) throw { kind: "not_found", message: "文件不存在" };
    return { content: c, hash: FakeFs.hash(c) };
  }
  async save(path: string, content: string, base: string | null): Promise<SaveOutcome> {
    this.saves.push({ path, content, base });
    if (this.failNext) {
      this.failNext = false;
      throw { kind: "io", message: "磁盘已满" };
    }
    const cur = this.files.get(path);
    if (base !== null) {
      if (cur === undefined) return { status: "missing" };
      if (FakeFs.hash(cur) !== base) return { status: "conflict", diskContent: cur, diskHash: FakeFs.hash(cur) };
    }
    this.files.set(path, content);
    return { status: "saved", hash: FakeFs.hash(content) };
  }
  async draftWrite(path: string, content: string) {
    this.drafts.set(path, content);
  }
  async draftClear(path: string) {
    this.drafts.delete(path);
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function type(c: EditorController, text: string, at?: number) {
  const pos = at ?? c.view.state.doc.length;
  c.view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length } });
}

describe("EditorController", () => {
  let fs: FakeFs;
  let c: EditorController;
  beforeEach(() => {
    fs = new FakeFs();
    fs.files.set("a.md", "# 标题\n正文");
    fs.files.set("b.md", "第二篇");
    c = new EditorController(fs, { autosaveMs: 20, draftMs: 30, retryMs: 40 });
    document.body.appendChild(c.view.dom);
  });
  afterEach(() => c.destroy());

  it("输入停止后自动保存，并以最新哈希为基准", async () => {
    await c.open("a.md");
    type(c, "一");
    type(c, "二");
    expect(c.info("a.md")!.status).toBe("dirty");
    await wait(60);
    expect(fs.files.get("a.md")).toBe("# 标题\n正文一二");
    expect(fs.saves).toHaveLength(1);
    expect(c.info("a.md")!.status).toBe("clean");
    type(c, "三");
    await wait(60);
    expect(fs.saves[1].base).toBe(FakeFs.hash("# 标题\n正文一二"));
    expect(fs.files.get("a.md")).toBe("# 标题\n正文一二三");
  });

  it("CRLF 文件原样写回换行符", async () => {
    fs.files.set("w.md", "第一行\r\n第二行\r\n");
    await c.open("w.md");
    expect(c.view.state.doc.lines).toBe(3);
    type(c, "第三行");
    await c.saveNow();
    expect(fs.files.get("w.md")).toBe("第一行\r\n第二行\r\n第三行");
  });

  it("切换文件与移动容器后撤销历史保持", async () => {
    await c.open("a.md");
    type(c, "A");
    type(c, "B");
    await c.open("b.md");
    type(c, "X");
    const other = document.createElement("div");
    document.body.appendChild(other);
    for (let i = 0; i < 20; i++) {
      c.moveTo(i % 2 ? document.body : other);
      await c.open(i % 2 ? "a.md" : "b.md");
    }
    await c.open("a.md");
    expect(c.view.state.doc.toString()).toBe("# 标题\n正文AB");
    undo(c.view);
    expect(c.view.state.doc.toString()).toBe("# 标题\n正文");
    await c.open("b.md");
    undo(c.view);
    expect(c.view.state.doc.toString()).toBe("第二篇");
  });

  it("外部修改：无未保存内容时静默刷新并保持光标", async () => {
    fs.files.set("a.md", "开头\n中间\n结尾");
    await c.open("a.md");
    c.view.dispatch({ selection: { anchor: 1 } });
    fs.files.set("a.md", "开头\n中间\n结尾，外部追加");
    await c.handleEvents([{ kind: "modified", entry: entry("a.md"), hash: FakeFs.hash(fs.files.get("a.md")!) }]);
    expect(c.view.state.doc.toString()).toBe("开头\n中间\n结尾，外部追加");
    expect(c.view.state.selection.main.head).toBe(1);
    expect(c.info("a.md")!.status).toBe("clean");
    expect(fs.saves).toHaveLength(0);
  });

  it("外部修改：有未保存内容时进入冲突，不写盘；选择保留我的版本", async () => {
    await c.open("a.md");
    type(c, "我的");
    fs.files.set("a.md", "外部版本");
    await c.handleEvents([{ kind: "modified", entry: entry("a.md"), hash: FakeFs.hash("外部版本") }]);
    const info = c.info("a.md")!;
    expect(info.status).toBe("conflict");
    expect(info.conflict!.diskContent).toBe("外部版本");
    await wait(60);
    expect(fs.files.get("a.md")).toBe("外部版本");
    expect(fs.drafts.get("a.md")).toBe("# 标题\n正文我的");
    await c.resolveConflict("a.md", "mine");
    expect(fs.files.get("a.md")).toBe("# 标题\n正文我的");
    expect(c.info("a.md")!.status).toBe("clean");
    expect(fs.drafts.has("a.md")).toBe(false);
  });

  it("冲突：采用磁盘版本或合并结果", async () => {
    await c.open("a.md");
    type(c, "本地");
    fs.files.set("a.md", "磁盘");
    await c.saveNow(); // 写前校验发现漏掉的外部修改
    expect(c.info("a.md")!.status).toBe("conflict");
    await c.resolveConflict("a.md", "merged", "合并后\n内容");
    expect(fs.files.get("a.md")).toBe("合并后\n内容");

    type(c, "再改");
    fs.files.set("a.md", "又被外部改了");
    await c.saveNow();
    await c.resolveConflict("a.md", "disk");
    expect(c.view.state.doc.toString()).toBe("又被外部改了");
    expect(c.info("a.md")!.status).toBe("clean");
  });

  it("外部删除：标记失效，不自动重新创建；可明确重新创建", async () => {
    await c.open("a.md");
    fs.files.delete("a.md");
    await c.handleEvents([{ kind: "removed", path: "a.md" }]);
    expect(c.info("a.md")!.status).toBe("missing");
    type(c, "继续写");
    await wait(60);
    expect(fs.files.has("a.md")).toBe(false);
    await c.recreate("a.md");
    expect(fs.files.get("a.md")).toBe("# 标题\n正文继续写");
  });

  it("保存失败后显示错误并自动重试", async () => {
    await c.open("a.md");
    fs.failNext = true;
    type(c, "!");
    await wait(30);
    expect(c.info("a.md")!.status).toBe("error");
    expect(c.info("a.md")!.error).toBe("磁盘已满");
    await wait(80);
    expect(fs.files.get("a.md")).toBe("# 标题\n正文!");
    expect(c.info("a.md")!.status).toBe("clean");
  });

  it("外部重命名后会话跟随新路径", async () => {
    await c.open("a.md");
    type(c, "x");
    await c.handleEvents([{ kind: "renamed", from: "a.md", entry: entry("新名字.md") }]);
    expect(c.activePath).toBe("新名字.md");
    fs.files.set("新名字.md", fs.files.get("a.md")!);
    fs.files.delete("a.md");
    await c.saveNow();
    expect(fs.files.get("新名字.md")).toBe("# 标题\n正文x");
  });

  it("恢复草稿：磁盘未变则作为可撤销编辑写回；磁盘已变则进入冲突", async () => {
    await c.restoreDraft({ path: "b.md", content: "第二篇（草稿）", baseHash: FakeFs.hash("第二篇"), savedAt: 1 });
    await wait(60);
    expect(fs.files.get("b.md")).toBe("第二篇（草稿）");

    fs.files.set("a.md", "后来被修改");
    await c.restoreDraft({ path: "a.md", content: "旧草稿", baseHash: FakeFs.hash("# 标题\n正文"), savedAt: 1 });
    expect(c.info("a.md")!.status).toBe("conflict");
    expect(c.info("a.md")!.conflict!.diskContent).toBe("后来被修改");
    expect(c.view.state.doc.toString()).toBe("旧草稿");
  });

  it("撤销回到已保存内容时不再保存", async () => {
    await c.open("a.md");
    type(c, "x");
    undo(c.view);
    expect(c.info("a.md")!.status).toBe("clean");
    await wait(60);
    expect(fs.saves).toHaveLength(0);
  });

  it("关闭冲突文档再打开仍保留本地修改和撤销历史", async () => {
    await c.open("a.md");
    type(c, "未保存的本地修改");
    fs.files.set("a.md", "外部版本");
    await c.saveNow();
    await c.close("a.md");
    await c.open("a.md");
    expect(c.activeText()).toBe("# 标题\n正文未保存的本地修改");
    expect(c.info("a.md")!.status).toBe("conflict");
    undo(c.view);
    expect(c.activeText()).toBe("# 标题\n正文");
  });

  it("向 CRLF 笔记追加多段内容时光标不越界并保留换行", async () => {
    fs.files.set("a.md", "第一行\r\n第二行");
    await c.open("a.md");
    c.appendText("新增一段\n\n新增二段");
    expect(c.view.state.selection.main.head).toBe(c.view.state.doc.length);
    await c.saveNow();
    expect(fs.files.get("a.md")).toBe("第一行\r\n第二行\r\n\r\n新增一段\r\n\r\n新增二段\r\n");
  });

  it("明确重新创建已删除的空文件", async () => {
    fs.files.set("empty.txt", "");
    await c.open("empty.txt");
    fs.files.delete("empty.txt");
    await c.handleEvents([{ kind: "removed", path: "empty.txt" }]);
    await c.recreate("empty.txt");
    expect(fs.files.has("empty.txt")).toBe(true);
    expect(c.info("empty.txt")!.status).toBe("clean");
  });

  it("切库清空会话后同名文件重新读取，不复用上一库正文", async () => {
    await c.open("a.md");
    c.reset();
    fs.files.set("a.md", "另一个库的正文");
    await c.open("a.md");
    expect(c.activeText()).toBe("另一个库的正文");
    expect(c.hasUnsaved()).toBe(false);
  });

  it("切换编辑器类型时移除容器里的旧编辑器，保留自身正文与撤销", async () => {
    await c.open("a.md");
    type(c, "新内容");
    const host = document.createElement("div");
    host.appendChild(document.createElement("div"));
    c.moveTo(host);
    expect([...host.children]).toEqual([c.view.dom]);
    expect(c.activeText()).toContain("新内容");
    undo(c.view);
    expect(c.activeText()).toBe("# 标题\n正文");
  });
});

function entry(path: string) {
  return { path, name: path.split("/").pop()!, kind: "markdown" as const, size: 1, mtime: 1 };
}
