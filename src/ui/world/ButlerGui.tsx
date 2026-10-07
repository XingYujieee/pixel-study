import { useEffect, useRef, useState } from "react";
import { useAi } from "../../app/aiStore";
import { answerConfirm, butlerKind, butlerName, dismissButler, resetButlerChat, sendToButler, setButler, useButler } from "../../app/butler";
import { useWorld } from "../../app/worldStore";
import { BIRD_NAMES } from "../../world/bird";
import type { BirdKind } from "../../world/layout";
import { AiSettings } from "./AiGui";
import { useImeSafeKeys } from "./useImeSafeKeys";

/** 管家聊天：停在屏幕右边，书房还看得见；Esc 收起，小鸟继续跟着你 */
export function ButlerGui({ settings }: { settings?: boolean }) {
  const messages = useButler((s) => s.messages);
  const busy = useButler((s) => s.busy);
  const { config, hasKey, load } = useAi();
  useWorld((s) => s.layoutVersion);
  const [text, setText] = useState("");
  const [tab, setTab] = useState<"chat" | "settings">(settings ? "settings" : "chat");
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const close = () => useWorld.getState().closeGui();
  useEffect(() => {
    if (!config) void load().catch(() => {});
  }, [config, load]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);
  useEffect(() => {
    if (tab === "chat") setTimeout(() => input.current?.focus(), 50);
  }, [tab]);
  const send = () => {
    if (!text.trim() || busy) return;
    void sendToButler(text);
    setText("");
  };
  const keys = useImeSafeKeys({
    onEnter: (e) => {
      if ((e as React.KeyboardEvent).shiftKey) return;
      send();
    },
    onEscape: close,
  });
  const model = hasKey || config?.provider === "compatible";

  return (
    <div className="butler-dock" onMouseDown={(e) => e.stopPropagation()}>
      <div className="mc-panel butler-panel">
        <div className="butler-head">
          <span className={`butler-avatar k-${butlerKind()}`} />
          <span className="mc-text butler-title">{butlerName()}</span>
          <span className={`butler-status ${model ? "on" : ""}`} title={model ? `用 ${config?.model} 思考` : "没接大模型：只听得懂固定说法"}>
            {model ? config?.model : "离线"}
          </span>
          <span className="spacer" />
          <button className={`mc-btn small ${tab === "settings" ? "on" : ""}`} onClick={() => setTab(tab === "settings" ? "chat" : "settings")}>
            设置
          </button>
          <button className="mc-btn small" onClick={dismissButler} title="让它回书架上停着">
            回去吧
          </button>
          <button className="mc-btn small" onClick={close} title="收起聊天（Esc），它还跟着你">
            ×
          </button>
        </div>
        {tab === "settings" ? (
          <ButlerSettings onDone={() => setTab("chat")} />
        ) : (
          <>
            <div className="butler-list" ref={list}>
              {messages.map((m) => (
                <div key={m.id} className={`bmsg from-${m.from} ${m.error ? "err" : ""}`}>
                  <div className="bmsg-text">{m.text}</div>
                  {m.confirm && (
                    <div className="bmsg-confirm">
                      <p>{m.confirm.detail}</p>
                      {m.confirm.state === "ask" ? (
                        <div className="opt-row">
                          <button className="mc-btn small on" onClick={() => answerConfirm(m.id, true)}>
                            好
                          </button>
                          <button className="mc-btn small" onClick={() => answerConfirm(m.id, false)}>
                            不要
                          </button>
                        </div>
                      ) : (
                        <span className="mc-text small">{m.confirm.state === "yes" ? "✓ 已同意" : "✗ 没同意"}</span>
                      )}
                    </div>
                  )}
                  {(m.actions?.length || m.undo) && (
                    <div className="bmsg-actions">
                      {m.actions?.map((a) => (
                        <button key={a.label} className="mc-chip" onClick={a.run}>
                          {a.label}
                        </button>
                      ))}
                      {m.undo && <UndoChip undo={m.undo} />}
                    </div>
                  )}
                </div>
              ))}
              {busy && <div className="bmsg from-bird thinking">{butlerName()}在想…</div>}
            </div>
            <div className="butler-input">
              <textarea
                ref={input}
                className="mc-input"
                rows={2}
                value={text}
                placeholder={model ? "跟它说点什么：三体在哪？整理一下书架，在这种棵树……" : "试试：三体在哪 / 整理书架 / 种三棵树 / 除草"}
                onChange={(e) => setText(e.target.value)}
                {...keys}
              />
              <button className="mc-btn on" disabled={busy || !text.trim()} onClick={send}>
                说
              </button>
            </div>
            <div className="butler-foot mc-text small">
              G 叫它 · Enter 发送 · Esc 收起
              <span className="spacer" />
              {messages.length > 0 && (
                <button className="link-btn" onClick={resetButlerChat}>
                  清空对话
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function UndoChip({ undo }: { undo: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="mc-chip"
      disabled={done}
      onClick={() => {
        undo();
        setDone(true);
      }}
    >
      {done ? "已撤销" : "撤销"}
    </button>
  );
}

function ButlerSettings({ onDone }: { onDone: () => void }) {
  const { config } = useAi();
  const [name, setName] = useState(butlerName());
  const keys = useImeSafeKeys({});
  return (
    <div className="butler-settings">
      <div className="field-row">
        <span className="mc-text small">名字</span>
        <input className="mc-input" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && setButler({ name: name.trim() })} {...keys} />
      </div>
      <div className="field-row">
        <span className="mc-text small">样子</span>
        <div className="seg">
          {(Object.keys(BIRD_NAMES) as BirdKind[]).map((k) => (
            <button key={k} className={`mc-btn small ${butlerKind() === k ? "on" : ""}`} onClick={() => setButler({ kind: k })}>
              {BIRD_NAMES[k]}
            </button>
          ))}
        </div>
      </div>
      <p className="mc-text small panel-note">
        大模型设置（和 AI 工作台共用一套）：填好服务商、模型和 API 密钥，管家就能听懂随便说的话，并自己决定去找书、带路、整理、种树。没填的时候它只听得懂固定说法。密钥保存在 macOS 钥匙串。
      </p>
      {config ? <AiSettings config={config} onDone={onDone} /> : <p className="mc-text small">正在读取设置…</p>}
    </div>
  );
}
