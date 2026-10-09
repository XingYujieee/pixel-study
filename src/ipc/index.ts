// 前端唯一调用 invoke 的地方。命令与事件的类型与 src-tauri/src/commands.rs 一一对应。
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type FileKind = "markdown" | "text" | "word" | "other";

export interface FileEntry {
  path: string;
  name: string;
  kind: FileKind;
  size: number;
  mtime: number;
}

export interface VaultInfo {
  id: string;
  name: string;
  root: string;
}

export interface NoteContent {
  content: string;
  hash: string;
}

export type SaveOutcome =
  | { status: "saved"; hash: string }
  | { status: "conflict"; diskContent: string; diskHash: string }
  | { status: "missing" };

export type BytesSaveOutcome =
  | { status: "saved"; hash: string }
  | { status: "conflict"; diskHash: string }
  | { status: "missing" };

export interface Track {
  id: string;
  name: string;
  file: string;
  size: number;
  title?: string;
  artist?: string;
  album?: string;
  trackNo?: number;
  cover?: number;
}

export type AiProvider = "anthropic" | "openai" | "compatible";

export interface AiConfig {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  system: string;
  maxTokens: number;
  temperature: number | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type AiEvent = { kind: "delta"; text: string } | { kind: "done" } | { kind: "error"; message: string };

export interface SearchHit {
  path: string;
  line: number;
  snippet: string;
  start: number;
  end: number;
}

export type ImportOutcome = { status: "done"; imported: string[] } | { status: "conflicts"; names: string[] };

export interface Draft {
  path: string;
  content: string;
  baseHash: string | null;
  savedAt: number;
}

export type VaultEvent =
  | { kind: "created"; entry: FileEntry }
  | { kind: "modified"; entry: FileEntry; hash: string | null }
  | { kind: "removed"; path: string }
  | { kind: "renamed"; from: string; entry: FileEntry };

/** Rust 侧 VaultError 的序列化形式 */
export interface VaultError {
  kind: string;
  message: string;
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as VaultError).message);
  return String(e);
}

export function errorKind(e: unknown): string | undefined {
  if (e && typeof e === "object" && "kind" in e) return String((e as VaultError).kind);
  return undefined;
}

/** 书房管家：统一格式的消息、工具调用与回答 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface AgentMessage {
  role: "user" | "assistant" | "tool";
  text: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface AgentReply {
  text: string;
  toolCalls: ToolCall[];
}

export const api = {
  vaultOpen: (path: string) => invoke<VaultInfo>("vault_open", { path }),
  vaultCurrent: () => invoke<VaultInfo | null>("vault_current"),
  vaultScan: (onBatch: (batch: FileEntry[]) => void) => {
    const ch = new Channel<FileEntry[]>();
    ch.onmessage = onBatch;
    return invoke<number>("vault_scan", { onBatch: ch });
  },
  noteRead: (path: string) => invoke<NoteContent>("note_read", { path }),
  noteSave: (path: string, content: string, baseHash: string | null) =>
    invoke<SaveOutcome>("note_save", { path, content, baseHash }),
  fileReadBytes: async (path: string): Promise<{ bytes: Uint8Array; hash: string }> => {
    const buf = await invoke<ArrayBuffer>("file_read_bytes", { path });
    const all = new Uint8Array(buf);
    return { hash: new TextDecoder().decode(all.subarray(0, 64)), bytes: all.subarray(64) };
  },
  fileSaveBytes: (path: string, bytes: Uint8Array, baseHash: string | null, backup: boolean) =>
    invoke<BytesSaveOutcome>("file_save_bytes", { path, data: toBase64(bytes), baseHash, backup }),
  fileCreate: (dir: string | null, name: string, ext: "md" | "txt" | "docx", bytes?: Uint8Array) =>
    invoke<FileEntry>("file_create", { dir, name, ext, data: bytes ? toBase64(bytes) : null }),
  layoutLoad: () => invoke<unknown | null>("layout_load"),
  layoutSave: (layout: unknown) => invoke<void>("layout_save", { layout }),
  noteCreate: (dir: string | null, name: string) => invoke<FileEntry>("note_create", { dir, name }),
  search: (query: string, limit = 60) => invoke<SearchHit[]>("search", { query, limit }),
  fileImport: (sources: string[], targetDir: string, keepBoth: boolean) =>
    invoke<ImportOutcome>("file_import", { sources, targetDir, keepBoth }),
  openExternal: (path: string) => invoke<void>("open_external", { path }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  revealInFinder: (path: string) => invoke<void>("reveal_in_finder", { path }),
  draftWrite: (path: string, content: string, baseHash: string | null) =>
    invoke<void>("draft_write", { path, content, baseHash }),
  draftClear: (path: string) => invoke<void>("draft_clear", { path }),
  draftList: () => invoke<Draft[]>("draft_list"),
  recentList: () => invoke<string[]>("recent_list"),
  recentPush: (path: string) => invoke<string[]>("recent_push", { path }),
  aiConfigGet: () => invoke<{ config: AiConfig; hasKey: boolean }>("ai_config_get"),
  aiConfigSet: (config: AiConfig) => invoke<{ config: AiConfig; hasKey: boolean }>("ai_config_set", { config }),
  aiKeySet: (key: string | null) => invoke<boolean>("ai_key_set", { key }),
  aiChat: (requestId: string, messages: ChatMessage[], onEvent: (e: AiEvent) => void) => {
    const ch = new Channel<AiEvent>();
    ch.onmessage = onEvent;
    return invoke<void>("ai_chat", { requestId, messages, onEvent: ch });
  },
  aiCancel: (requestId: string) => invoke<void>("ai_cancel", { requestId }),
  aiAgent: (system: string, messages: AgentMessage[], tools: ToolSpec[]) => invoke<AgentReply>("ai_agent", { system, messages, tools }),
  linkIndex: () => invoke<Record<string, string[]>>("link_index"),
  /** 移动文件；entry 为 null 表示移到了隐藏目录（.trash） */
  fileMove: (path: string, toDir: string) => invoke<{ from: string; to: string; entry: FileEntry | null }>("file_move", { path, toDir }),
  /** 拖放导入（文件或文件夹），同名自动保留两份 */
  fileImportDrop: (sources: string[], targetDir: string) =>
    invoke<{ entries: FileEntry[]; inVault: string[]; renamed: number; skipped: number }>("file_import_drop", { sources, targetDir }),
  readExternalImage: async (path: string) => new Uint8Array(await invoke<ArrayBuffer>("read_external_image", { path })),
  weatherSearch: (query: string) => invoke<{ name: string; detail: string; lat: number; lon: number }[]>("weather_search", { query }),
  weatherNow: (lat: number, lon: number) =>
    invoke<{ weather: "clear" | "cloudy" | "rain" | "snow" | "storm"; temperature: number; isDay: boolean; code: number }>("weather_now", { lat, lon }),
  finderBeside: (left: number, top: number, right: number, bottom: number) => invoke<boolean>("finder_beside", { left, top, right, bottom }),
  audioList: () => invoke<Track[]>("audio_list"),
  audioImport: (sources: string[]) => invoke<{ added: Track[]; rejected: string[] }>("audio_import", { sources }),
  audioRemove: (id: string) => invoke<void>("audio_remove", { id }),
  audioRename: (id: string, name: string) => invoke<void>("audio_rename", { id, name }),
  audioUpdate: (ids: string[], patch: { album?: string; artist?: string; title?: string; cover?: number }) => invoke<void>("audio_update", { ids, patch }),
  audioPath: (id: string) => invoke<string>("audio_path", { id }),
  backlinkCounts: () => invoke<Record<string, number>>("backlink_counts"),
  obsidianTemplatesFolder: () => invoke<string | null>("obsidian_templates_folder"),
  vaultJsonLoad: (name: "meta.json" | "presets.json") => invoke<unknown | null>("vault_json_load", { name }),
  vaultJsonSave: (name: "meta.json" | "presets.json", value: unknown) => invoke<void>("vault_json_save", { name, value }),
};

export function onVaultChanged(cb: (events: VaultEvent[]) => void): Promise<UnlistenFn> {
  return listen<VaultEvent[]>("vault://changed", (e) => cb(e.payload));
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
