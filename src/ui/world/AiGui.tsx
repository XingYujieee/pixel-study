import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import { conversationMarkdown, useAi, type UiMessage } from "../../app/aiStore";
import { appendToActive, controller, word } from "../../app/editor";
import { useApp } from "../../app/store";
import { craftBook } from "../../app/worldActions";
import { useWorld } from "../../app/worldStore";
import { api, errorMessage, type AiConfig, type AiProvider } from "../../ipc";
import { basename, isEditablePath, isWordPath } from "../../lib/paths";
import { useImeSafeKeys } from "./useImeSafeKeys";

/** AI 工作台：接入 Claude / OpenAI / 兼容接口，可附上当前笔记提问，把回答写回笔记 */
export function AiGui() {
  const { config, load } = useAi();
  const [settings, setSettings] = useState(false);
  const close = () => useWorld.getState().closeGui();

  useEffect(() => {
    load().catch((e) => useApp.getState().toast(errorMessage(e), "error"));
  }, [load]);

  return (
    <div className="mc-overlay" onMouseDown={close}>
      <div className="mc-panel ai-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2 className="mc-title">AI 工作台</h2>
          {config && (
            <span className="ai-model mc-text small" title={config.model}>
              {PROVIDERS[config.provider].name} · {config.model}
            </span>
          )}
          <span className="spacer" />
          {!settings && (
            <button className="mc-btn small" onClick={() => useAi.getState().reset()}>
              新对话
            </button>
          )}
          <button className={`mc-btn small ${settings ? "on" : ""}`} onClick={() => setSettings(!settings)}>
            {settings ? "回到对话" : "接入设置"}
          </button>
          <button className="mc-btn small" onClick={close}>
            关闭
          </button>
        </div>
        {config && (settings ? <AiSettings config={config} onDone={() => setSettings(false)} /> : <Chat onSetup={() => setSettings(true)} />)}
      </div>
    </div>
  );
}

// ───────────── 对话 ─────────────

function Chat({ onSetup }: { onSetup: () => void }) {
  const { messages, busy, hasKey, config, send, stop, dropped } = useAi();
  const selected = useApp((s) => s.selected);
  const [text, setText] = useState("");
  const [attach, setAttach] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const note = selected && isEditablePath(selected) ? selected : null;
  const needsKey = !hasKey && config?.provider !== "compatible";

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const submit = () => {
    if (!text.trim() || busy) return;
    let attachment: { name: string; content: string } | undefined;
    if (dropped) {
      attachment = dropped;
      useAi.setState({ dropped: null });
    } else if (attach && note && messages.length === 0) {
      const content = isWordPath(note) ? (word.activePath === note ? word.activeText() : "") : controller.activePath === note ? controller.activeText() : "";
      if (content.trim()) attachment = { name: basename(note), content };
    }
    void send(text.trim(), attachment);
    setText("");
  };
  const keys = useImeSafeKeys({});

  return (
    <div className="ai-chat">
      <div className="ai-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="ai-empty">
            {needsKey ? (
              <>
                <p className="mc-text small">还没有接入模型。先在「接入设置」里选择服务商并填写 API 密钥。</p>
                <button className="mc-btn" onClick={onSetup}>
                  去设置
                </button>
              </>
            ) : (
              <>
                <p className="mc-text small">问点什么吧。可以附上当前打开的笔记，让 AI 帮你总结、改写、找问题。</p>
                <div className="ai-suggest">
                  {["帮我总结这篇笔记的要点", "检查这段文字的语法和表达", "根据笔记列出下一步要做的事"].map((s) => (
                    <button key={s} className="mc-chip" onClick={() => setText(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {messages.map((m) => (
          <MessageView key={m.id} m={m} />
        ))}
      </div>
      <div className="ai-input">
        {dropped && (
          <div className="mc-check ai-dropped">
            附上拖进来的《{dropped.name}》（{dropped.content.length} 字）
            <button className="mc-btn small" onClick={() => useAi.setState({ dropped: null })}>
              不附
            </button>
          </div>
        )}
        {!dropped && note && messages.length === 0 && (
          <label className="mc-check">
            <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> 附上当前笔记《{basename(note)}》
          </label>
        )}
        <div className="ai-input-row">
          <textarea
            className="mc-input ai-textarea"
            placeholder={needsKey ? "先在接入设置里填写密钥" : "输入问题，Enter 发送，Shift+Enter 换行"}
            value={text}
            disabled={needsKey}
            onChange={(e) => setText(e.target.value)}
            {...keys}
            onKeyDown={(e) => {
              keys.onKeyDown(e);
              if (e.isPropagationStopped() || e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {busy ? (
            <button className="mc-btn danger" onClick={stop}>
              停止
            </button>
          ) : (
            <button className="mc-btn on" disabled={!text.trim() || needsKey} onClick={submit}>
              发送
            </button>
          )}
        </div>
        <ConversationActions />
      </div>
    </div>
  );
}

function MessageView({ m }: { m: UiMessage }) {
  const html = useMemo(() => (m.role === "assistant" ? DOMPurify.sanitize(marked.parse(m.content || "", { async: false }) as string) : ""), [m.content, m.role]);
  const selected = useApp((s) => s.selected);
  return (
    <div className={`ai-msg ${m.role}`}>
      <div className="ai-who mc-text small">{m.role === "user" ? "我" : "AI"}</div>
      <div className="ai-bubble">
        {m.attached && <div className="ai-attached">附上了《{m.attached}》</div>}
        {m.role === "user" ? <div className="ai-text">{m.content}</div> : <div className="ai-text md" dangerouslySetInnerHTML={{ __html: html }} />}
        {m.streaming && <span className="ai-caret" />}
        {m.error && <div className="ai-error">出错了：{m.error}</div>}
      </div>
      {m.role === "assistant" && !m.streaming && m.content && (
        <div className="ai-actions">
          <button
            className="mc-chip"
            onClick={() => {
              void navigator.clipboard.writeText(m.content).then(() => useApp.getState().toast("已复制"));
            }}
          >
            复制
          </button>
          <button
            className="mc-chip"
            onClick={() => {
              if (appendToActive(selected, m.content)) useApp.getState().toast(`已追加到《${basename(selected!)}》末尾`);
              else useApp.getState().toast("先在书桌前打开一本可编辑的书，再插入。", "error");
            }}
          >
            插入到当前笔记
          </button>
        </div>
      )}
    </div>
  );
}

function ConversationActions() {
  const { messages, config, busy } = useAi();
  const [saving, setSaving] = useState(false);
  if (messages.length === 0 || busy) return null;
  const save = async () => {
    setSaving(true);
    const d = new Date();
    const name = `AI 对话 ${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
    const path = await craftBook("md", name, null);
    setSaving(false);
    if (!path) return;
    try {
      const n = await api.noteRead(path);
      await api.noteSave(path, conversationMarkdown(messages, config?.model ?? ""), n.hash);
      useApp.getState().toast(`对话已保存为《${basename(path)}》`);
    } catch (e) {
      useApp.getState().toast(errorMessage(e), "error");
    }
  };
  return (
    <div className="ai-convo-actions">
      <button className="mc-chip" disabled={saving} onClick={() => void save()}>
        把整段对话存为笔记
      </button>
    </div>
  );
}

// ───────────── 设置 ─────────────

const PROVIDERS: Record<AiProvider, { name: string; models: string[]; keyUrl?: string }> = {
  anthropic: { name: "Claude", models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"], keyUrl: "console.anthropic.com" },
  openai: { name: "OpenAI", models: ["gpt-4o", "gpt-4o-mini"], keyUrl: "platform.openai.com" },
  compatible: { name: "兼容接口", models: [] },
};

const PRESETS: { name: string; baseUrl: string; model: string }[] = [
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { name: "Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { name: "智谱", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  { name: "Ollama 本机", baseUrl: "http://localhost:11434/v1", model: "qwen2.5" },
];

export function AiSettings({ config, onDone }: { config: AiConfig; onDone: () => void }) {
  const { hasKey, saveConfig, setKey } = useAi();
  const [c, setC] = useState<AiConfig>(config);
  const [key, setKeyText] = useState("");
  const [busy, setBusy] = useState(false);
  const keys = useImeSafeKeys({});
  const p = PROVIDERS[c.provider];

  const switchProvider = (provider: AiProvider) => {
    const next: AiConfig = { ...c, provider, baseUrl: provider === "compatible" ? c.baseUrl || PRESETS[0].baseUrl : "" };
    if (provider === "anthropic") next.model = PROVIDERS.anthropic.models[0];
    else if (provider === "openai") next.model = PROVIDERS.openai.models[0];
    else if (!c.baseUrl) next.model = PRESETS[0].model;
    setC(next);
  };

  const save = async () => {
    setBusy(true);
    try {
      await saveConfig(c);
      if (key.trim()) await setKey(key.trim());
      setKeyText("");
      useApp.getState().toast("AI 设置已保存");
      onDone();
    } catch (e) {
      useApp.getState().toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-settings">
      <div className="field-row">
        <span className="mc-text small">服务商</span>
        <div className="seg">
          {(Object.keys(PROVIDERS) as AiProvider[]).map((k) => (
            <button key={k} className={`mc-btn small ${c.provider === k ? "on" : ""}`} onClick={() => switchProvider(k)}>
              {PROVIDERS[k].name}
            </button>
          ))}
        </div>
      </div>
      {c.provider === "compatible" && (
        <div className="field-row">
          <span className="mc-text small">常用</span>
          <div className="opt-row">
            {PRESETS.map((pr) => (
              <button key={pr.name} className={`mc-chip ${c.baseUrl === pr.baseUrl ? "on" : ""}`} onClick={() => setC({ ...c, baseUrl: pr.baseUrl, model: pr.model })}>
                {pr.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {c.provider !== "anthropic" && (
        <label className="field-row">
          <span className="mc-text small">接口地址</span>
          <input className="mc-input" value={c.baseUrl} placeholder={c.provider === "openai" ? "https://api.openai.com/v1（默认）" : "https://…/v1"} onChange={(e) => setC({ ...c, baseUrl: e.target.value })} {...keys} />
        </label>
      )}
      <label className="field-row">
        <span className="mc-text small">模型</span>
        <input className="mc-input" list="ai-models" value={c.model} onChange={(e) => setC({ ...c, model: e.target.value })} {...keys} />
        <datalist id="ai-models">
          {p.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <label className="field-row">
        <span className="mc-text small">API 密钥</span>
        <div className="key-row">
          <input
            className="mc-input"
            type="password"
            autoComplete="off"
            value={key}
            placeholder={hasKey ? "已保存在钥匙串（留空则不修改）" : c.provider === "compatible" ? "本机 Ollama 可以留空" : `在 ${p.keyUrl ?? "服务商控制台"} 创建`}
            onChange={(e) => setKeyText(e.target.value)}
          />
          {hasKey && (
            <button className="mc-btn small" onClick={() => void setKey(null).then(() => useApp.getState().toast("已从钥匙串删除密钥"))}>
              删除密钥
            </button>
          )}
        </div>
      </label>
      <label className="field-row top">
        <span className="mc-text small">系统提示</span>
        <textarea className="mc-input ai-system" value={c.system} onChange={(e) => setC({ ...c, system: e.target.value })} {...keys} />
      </label>
      <label className="field-row">
        <span className="mc-text small">最长回答</span>
        <input
          className="mc-input short"
          type="number"
          min={256}
          max={64000}
          step={256}
          value={c.maxTokens}
          onChange={(e) => setC({ ...c, maxTokens: Number(e.target.value) || 4096 })}
        />
      </label>
      <p className="recipe-desc">
        密钥保存在 macOS 钥匙串，只在发请求时由应用本身读取。对话内容会发送到你选择的服务商；只有勾选「附上当前笔记」时才会带上笔记全文。
      </p>
      <div className="panel-foot">
        <span className="spacer" />
        <button className="mc-btn" onClick={onDone}>
          取消
        </button>
        <button className="mc-btn on" disabled={busy || !c.model.trim()} onClick={() => void save()}>
          保存
        </button>
      </div>
    </div>
  );
}
