import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WordController, type WordApi } from "./session";
import type { VaultEvent } from "../ipc";

// 会话测试隔离 DOCX 编解码，实际往返由 docx.test.ts 验证。
vi.mock("./docx", () => ({
  readDocx: async (bytes: Uint8Array) => ({ html: new TextDecoder().decode(bytes), lossy: new TextDecoder().decode(bytes).includes("复杂格式") ? ["公式"] : [] }),
  writeDocx: async (el: HTMLElement) => new TextEncoder().encode(el.innerHTML),
}));
const modified = (hash: string): VaultEvent[] => [{ kind: "modified", entry: { path: "a.docx", name: "a.docx", kind: "word", size: 1, mtime: 1 }, hash }];
describe("Word 编辑会话", () => {
  let c: WordController;
  let api: WordApi;
  const enc = new TextEncoder();
  beforeEach(() => {
    api = {
      read: vi.fn(async () => ({ bytes: enc.encode("<p>原文</p>"), hash: "initial" })),
      save: vi.fn(async () => ({ status: "saved" as const, hash: "saved" })),
      draftWrite: vi.fn(async () => {}), draftClear: vi.fn(async () => {}),
    };
    c = new WordController(api, { autosaveMs: 60000, draftMs: 60000, retryMs: 60000 });
  });
  afterEach(() => c.reset());
  it("自动刷新读取期间输入，不覆盖本地修改", async () => {
    await c.open("a.docx");
    let resolve!: (v: { bytes: Uint8Array; hash: string }) => void;
    vi.mocked(api.read).mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const pending = c.handleEvents(modified("external"));
    c.appendText("读取时输入");
    resolve({ bytes: enc.encode("<p>外部版本</p>"), hash: "external" });
    await pending;
    expect(c.page.textContent).toContain("读取时输入");
    expect(c.info("a.docx")!.status).toBe("conflict");
    expect(api.draftWrite).toHaveBeenCalled();
  });
  it("外部换成复杂格式时重新要求编辑确认", async () => {
    await c.open("a.docx");
    vi.mocked(api.read).mockResolvedValue({ bytes: enc.encode("<p>复杂格式</p>"), hash: "complex" });
    await c.handleEvents(modified("complex"));
    expect(c.info("a.docx")!.readOnly).toBe(true);
    expect(c.page.contentEditable).toBe("false");
  });
  it("外部删除未保存 Word 后立即保留草稿", async () => {
    await c.open("a.docx");
    c.appendText("本地内容");
    await c.handleEvents([{ kind: "removed", path: "a.docx" }]);
    expect(api.draftWrite).toHaveBeenCalledWith("a.docx", expect.stringContaining("本地内容"), "initial");
    expect(api.save).not.toHaveBeenCalled();
  });
  it("原文件已删除时仍可打开恢复草稿，明确重建后才保存", async () => {
    vi.mocked(api.read).mockRejectedValue({ kind: "not_found", message: "不存在" });
    await c.restoreDraft({ path: "a.docx", content: "<p>恢复的草稿</p>", baseHash: "initial", savedAt: 1 });
    expect(c.page.textContent).toBe("恢复的草稿");
    expect(c.info("a.docx")!.status).toBe("missing");
    expect(api.save).not.toHaveBeenCalled();
    await c.recreate("a.docx");
    const [path, bytes, baseHash, backup] = vi.mocked(api.save).mock.calls[0];
    expect([path, baseHash, backup]).toEqual(["a.docx", null, false]);
    expect(new TextDecoder().decode(bytes)).toContain("恢复的草稿");
  });
  it("首次保存备份，后续保存不重复备份", async () => {
    await c.open("a.docx");
    c.appendText("一");
    await c.saveNow();
    c.appendText("二");
    await c.saveNow();
    expect(vi.mocked(api.save).mock.calls.map((a) => a[3])).toEqual([true, false]);
  });
  it("切库清空会话后同名 Word 重新读取", async () => {
    await c.open("a.docx");
    c.reset();
    vi.mocked(api.read).mockResolvedValue({ bytes: enc.encode("<p>另一库的 Word</p>"), hash: "other" });
    await c.open("a.docx");
    expect(c.page.textContent).toBe("另一库的 Word");
    expect(c.hasUnsaved()).toBe(false);
  });

  it("从文本切换到 Word 时替换旧编辑器，防止正文被挤出书页", async () => {
    await c.open("a.docx");
    const host = document.createElement("div");
    host.appendChild(document.createElement("div"));
    c.moveTo(host);
    expect([...host.children]).toEqual([c.scroller]);
    expect(c.page.textContent).toBe("原文");
  });
});
