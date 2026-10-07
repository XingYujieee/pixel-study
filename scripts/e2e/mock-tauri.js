// 浏览器中模拟 Tauri 后端（仅用于开发截图与界面测试，不进入应用包）。
// 文件数据来自 window.__MOCK_FILES__：{ path: content }
(() => {
  const files = window.__MOCK_FILES__ || {};
  const binary = {};
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const enc = new TextEncoder();
  let layout = null;
  let cbId = 1;
  const callbacks = new Map();
  const hash = (s) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(64, "0");
  };
  const kind = (p) => (/\.(md|markdown)$/i.test(p) ? "markdown" : /\.txt$/i.test(p) ? "text" : /\.docx$/i.test(p) ? "word" : "other");
  const mtimes = window.__MOCK_MTIME__ || {};
  const json = {};
  const entry = (p) => ({ path: p, name: p.split("/").pop(), kind: kind(p), size: (files[p] || "").length, mtime: mtimes[p] ?? Date.now() });
  window.__MOCK_LOG__ = [];
  const listeners = {};
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(event, id) {
      listeners[event] = (listeners[event] || []).filter((x) => x !== id);
    },
  };
  window.__emitTauri = (event, payload) => {
    for (const id of listeners[event] || []) window[`_${id}`]?.({ event, id: 1, payload });
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback(cb, once) {
      const id = cbId++;
      callbacks.set(id, cb);
      window[`_${id}`] = cb;
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
    convertFileSrc: (p) => (window.__MOCK_DATAURL__ || {})[p] || p,
    async invoke(cmd, args) {
      window.__MOCK_LOG__.push(cmd);
      switch (cmd) {
        case "vault_current":
        case "vault_open":
          return { id: "mock", name: "我的笔记库", root: "/mock/vault" };
        case "vault_scan": {
          const ch = args.onBatch;
          const list = Object.keys(files).map(entry);
          const cb = callbacks.get(ch.id ?? ch);
          // Channel 消息格式：{ index, message }
          if (cb) cb({ index: 0, message: list });
          if (cb) cb({ index: 1, end: true });
          return list.length;
        }
        case "note_read":
          return { content: files[args.path] ?? "", hash: hash(files[args.path] ?? "") };
        case "note_save":
          files[args.path] = args.content;
          return { status: "saved", hash: hash(args.content) };
        case "recent_list":
        case "draft_list":
          return [];
        case "recent_push":
          return [args.path];
        case "layout_load":
          return layout;
        case "layout_save":
          layout = args.layout;
          return null;
        case "search":
          return [];
        case "file_create": {
          const p = `${args.dir || "Notes"}/${args.name}.${args.ext}`;
          const bytes = args.data ? b64(args.data) : new Uint8Array();
          if (args.ext === "docx") binary[p] = bytes;
          files[p] = args.ext === "docx" ? "" : new TextDecoder().decode(bytes);
          return entry(p);
        }
        case "file_read_bytes": {
          const bytes = binary[args.path] || new Uint8Array();
          const h = enc.encode(hash(String(bytes.length) + bytes.slice(0, 64).join(",")));
          const out = new Uint8Array(64 + bytes.length);
          out.set(h.subarray(0, 64));
          out.set(bytes, 64);
          return out.buffer;
        }
        case "file_save_bytes": {
          const bytes = b64(args.data);
          binary[args.path] = bytes;
          window.__MOCK_SAVED__ = (window.__MOCK_SAVED__ || 0) + 1;
          return { status: "saved", hash: hash(String(bytes.length) + bytes.slice(0, 64).join(",")) };
        }
        case "ai_config_get":
        case "ai_config_set":
          if (args && args.config) window.__AI_CFG__ = args.config;
          return {
            config: window.__AI_CFG__ || { provider: "anthropic", baseUrl: "", model: "claude-sonnet-5-5", system: "你是写作助手。", maxTokens: 4096, temperature: null },
            hasKey: window.__AI_HASKEY__ !== false,
          };
        case "ai_agent": {
          // 假的大模型：按关键字调用工具，拿到结果后说一句话
          window.__AGENT_CALLS__ = (window.__AGENT_CALLS__ || []).concat([args]);
          const msgs = args.messages;
          const last = msgs[msgs.length - 1];
          if (last.role === "tool") return { text: "搞定：" + last.text.split("\n")[0], toolCalls: [] };
          const t = last.text;
          if (t.includes("种")) return { text: "我去种。", toolCalls: [{ id: "c1", name: "garden", input: { action: "plant", kind: "tree", count: 2, where: "near_me" } }] };
          if (t.includes("整理")) return { text: "", toolCalls: [{ id: "c2", name: "organize_shelves", input: {} }] };
          if (t.includes("在哪")) return { text: "", toolCalls: [{ id: "c3", name: "search_notes", input: { query: "三体" } }] };
          if (t.includes("新建")) return { text: "", toolCalls: [{ id: "c4", name: "create_note", input: { folder: "读书", title: "测试", content: "# 测试" } }] };
          return { text: "好的，我在。", toolCalls: [] };
        }
        case "ai_key_set":
          return true;
        case "ai_chat": {
          const cb = callbacks.get(args.onEvent.id ?? args.onEvent);
          const parts = ["这篇笔记主要讲了三件事：", "\n\n1. **书房原型**已经完成；", "\n2. 需要验证输入法；", "\n3. 下一步做家具布置。"];
          let i = 0;
          for (const p of parts) cb({ index: i++, message: { kind: "delta", text: p } });
          cb({ index: i++, message: { kind: "done" } });
          cb({ index: i, end: true });
          return null;
        }
        case "file_move": {
          const name = args.path.split("/").pop();
          const to = `${args.toDir ? args.toDir + "/" : ""}${name}`;
          files[to] = files[args.path];
          if (binary[args.path]) binary[to] = binary[args.path];
          delete files[args.path];
          mtimes[to] = mtimes[args.path];
          return { from: args.path, to, entry: to.split("/").some((x) => x.startsWith(".")) ? null : entry(to) };
        }
        case "backlink_counts": {
          const out = {};
          const byName = {};
          for (const p of Object.keys(files)) byName[p.split("/").pop().replace(/\.md$/, "")] = p;
          for (const [p, text] of Object.entries(files)) {
            if (!p.endsWith(".md")) continue;
            const seen = new Set();
            for (const m of String(text).matchAll(/\[\[([^\]|#]+)/g)) {
              const t = byName[m[1].trim()];
              if (t && t !== p && !seen.has(t)) {
                seen.add(t);
                out[t] = (out[t] || 0) + 1;
              }
            }
          }
          return out;
        }
        case "read_external_image": {
          const b = (window.__MOCK_IMAGES__ || {})[args.path];
          if (!b) throw { kind: "not_found", message: "没有这个文件" };
          return b.buffer.slice(0);
        }
        case "audio_list":
          return window.__MOCK_TRACKS__ || [];
        case "audio_path":
          return `/mock/audio/${args.id}`;
        case "audio_import": {
          const added = args.sources.filter((p) => /\.(mp3|m4a|wav)$/i.test(p)).map((p, i) => ({ id: `t${Date.now()}${i}`, name: p.split("/").pop().replace(/\.[^.]+$/, ""), file: "x", size: 1 }));
          window.__MOCK_TRACKS__ = [...(window.__MOCK_TRACKS__ || []), ...added];
          return { added, rejected: args.sources.filter((p) => !/\.(mp3|m4a|wav)$/i.test(p)).map((p) => p.split("/").pop()) };
        }
        case "audio_remove":
          window.__MOCK_TRACKS__ = (window.__MOCK_TRACKS__ || []).filter((t) => t.id !== args.id);
          return null;
        case "obsidian_templates_folder":
          return null;
        case "vault_json_load":
          return json[args.name] ?? null;
        case "vault_json_save":
          json[args.name] = args.value;
          return null;
        case "plugin:event|listen": {
          const id = typeof args.handler === "number" ? args.handler : args.handler?.id;
          (listeners[args.event] ||= []).push(id);
          return id;
        }
        case "file_import_drop": {
          const ext = window.__MOCK_EXTERNAL__ || {};
          const out = { entries: [], inVault: [], renamed: 0, skipped: 0 };
          const put = (rel, content) => {
            let p = rel;
            if (files[p] !== undefined) {
              const m = /^(.*?)(\.[^./]*)?$/.exec(p);
              let i = 1;
              while (files[`${m[1]} (${i})${m[2] || ""}`] !== undefined) i++;
              p = `${m[1]} (${i})${m[2] || ""}`;
              out.renamed++;
            }
            files[p] = content;
            out.entries.push(entry(p));
          };
          const base = args.targetDir ? args.targetDir + "/" : "";
          for (const src of args.sources) {
            if (src.startsWith("/mock/vault/")) {
              out.inVault.push(src.slice("/mock/vault/".length));
              continue;
            }
            if (ext[src] !== undefined) {
              put(base + src.split("/").pop(), ext[src]);
              continue;
            }
            const name = src.split("/").pop();
            for (const k of Object.keys(ext)) if (k.startsWith(src + "/")) put(base + name + "/" + k.slice(src.length + 1), ext[k]);
          }
          return out;
        }
        default:
          return null;
      }
    },
  };
})();
