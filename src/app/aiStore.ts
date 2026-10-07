// AI 工作台的对话状态（本次运行内保留；可保存为笔记）。
import { create } from "zustand";
import { api, errorMessage, type AiConfig, type ChatMessage } from "../ipc";

export interface UiMessage extends ChatMessage {
  id: number;
  /** 发送时附上的笔记（仅显示用） */
  attached?: string;
  /** 实际发给模型的内容（附件展开后） */
  sent?: string;
  error?: string;
  streaming?: boolean;
}

interface AiStore {
  config: AiConfig | null;
  hasKey: boolean;
  messages: UiMessage[];
  busy: boolean;
  requestId: string | null;
  /** 拖到 AI 工作台上的文件：下一次提问时附上 */
  dropped: { name: string; content: string } | null;
  load(): Promise<void>;
  saveConfig(c: AiConfig): Promise<void>;
  setKey(k: string | null): Promise<void>;
  send(text: string, attachment?: { name: string; content: string }): Promise<void>;
  stop(): void;
  reset(): void;
}

let mid = 0;
const MAX_ATTACH = 40000;

/** 附件拼进用户消息：给模型的内容 */
export function withAttachment(text: string, a?: { name: string; content: string }): string {
  if (!a) return text;
  const body = a.content.length > MAX_ATTACH ? `${a.content.slice(0, MAX_ATTACH)}\n…（后面还有 ${a.content.length - MAX_ATTACH} 字，已省略）` : a.content;
  return `下面是我的笔记《${a.name}》：\n\n<note>\n${body}\n</note>\n\n${text}`;
}

export const useAi = create<AiStore>((set, get) => ({
  config: null,
  hasKey: false,
  messages: [],
  busy: false,
  requestId: null,
  dropped: null,

  load: async () => {
    const r = await api.aiConfigGet();
    set({ config: r.config, hasKey: r.hasKey });
  },

  saveConfig: async (c) => {
    const r = await api.aiConfigSet(c);
    set({ config: r.config, hasKey: r.hasKey });
  },

  setKey: async (k) => {
    const has = await api.aiKeySet(k);
    set({ hasKey: has });
  },

  send: async (text, attachment) => {
    if (get().busy || !text.trim()) return;
    const user: UiMessage = { id: ++mid, role: "user", content: text, attached: attachment?.name, sent: withAttachment(text, attachment) };
    const reply: UiMessage = { id: ++mid, role: "assistant", content: "", streaming: true };
    const history = [...get().messages.filter((m) => !m.error), user];
    const requestId = `ai-${Date.now()}-${mid}`;
    set({ messages: [...get().messages, user, reply], busy: true, requestId });
    // 流式文字先攒起来，每 50ms 刷新一次界面
    let pending = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      if (!pending) return;
      const add = pending;
      pending = "";
      set({ messages: get().messages.map((m) => (m.id === reply.id ? { ...m, content: m.content + add } : m)) });
    };
    const finish = (error?: string) => {
      if (timer) clearTimeout(timer);
      flush();
      set({
        busy: false,
        requestId: null,
        messages: get().messages.map((m) => (m.id === reply.id ? { ...m, streaming: false, error } : m)),
      });
    };
    try {
      await api.aiChat(
        requestId,
        history.map((m) => ({ role: m.role, content: m.sent ?? m.content })),
        (e) => {
          if (e.kind === "delta") {
            pending += e.text;
            timer ??= setTimeout(flush, 50);
          } else if (e.kind === "error") finish(e.message);
          else finish();
        },
      );
    } catch (e) {
      finish(errorMessage(e));
    }
    if (get().busy) finish();
  },

  stop: () => {
    const id = get().requestId;
    if (id) void api.aiCancel(id);
  },

  reset: () => {
    get().stop();
    set({ messages: [], busy: false, requestId: null });
  },
}));

/** 对话导出为 Markdown */
export function conversationMarkdown(messages: UiMessage[], model: string): string {
  const d = new Date();
  const lines = [`# AI 对话 ${d.toLocaleDateString("zh-CN")} ${d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`, "", `> 模型：${model}`, ""];
  for (const m of messages) {
    if (m.error) continue;
    lines.push(m.role === "user" ? "## 我" : "## AI", "");
    if (m.attached) lines.push(`*附上了笔记《${m.attached}》*`, "");
    lines.push(m.content.trim(), "");
  }
  return lines.join("\n");
}
