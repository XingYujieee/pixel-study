import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  order: [] as string[], dirty: false,
  reload: vi.fn(), open: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => "/test/vault-b" }));
vi.mock("./editor", () => ({
  saveEverything: async () => { mocks.order.push("save-old-notes"); },
  controller: { hasUnsaved: () => mocks.dirty, reset: () => mocks.order.push("reset-text") },
  word: { hasUnsaved: () => false, reset: () => mocks.order.push("reset-word") },
}));
vi.mock("../ipc", () => ({
  api: {
    vaultOpen: async (path: string) => { mocks.order.push("open-new-vault"); mocks.open(path); },
    layoutSave: async () => { mocks.order.push("save-old-layout"); },
  },
  onVaultChanged: vi.fn(), errorMessage: (e: Error) => e.message, errorKind: vi.fn(),
}));
import { chooseVault, onBeforeVaultChange } from "./actions";
import { useApp } from "./store";
import { useWorld } from "./worldStore";
import { defaultLayout } from "../world/layout";

describe("切换笔记库", () => {
  beforeEach(() => {
    mocks.order.length = 0;
    mocks.dirty = false;
    mocks.open.mockClear();
    mocks.reload.mockClear();
    vi.stubGlobal("window", { location: { reload: mocks.reload } });
    useApp.setState({ vault: { id: "a", name: "A", root: "/test/vault-a" }, switchingVault: false, selected: null });
    useWorld.getState().setLayout(defaultLayout([]));
  });
  it("先保存旧库的正文、布局和附加数据，再清空会话并切换库", async () => {
    const off = onBeforeVaultChange(async () => { mocks.order.push("flush-old-meta"); });
    try { await chooseVault(); } finally { off(); }
    expect(mocks.order).toEqual(["save-old-notes", "save-old-layout", "flush-old-meta", "reset-text", "reset-word", "open-new-vault"]);
    expect(mocks.reload).toHaveBeenCalledOnce();
  });
  it("仍有冲突或保存错误时留在原库", async () => {
    mocks.dirty = true;
    await chooseVault();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(useApp.getState().switchingVault).toBe(false);
  });
});
