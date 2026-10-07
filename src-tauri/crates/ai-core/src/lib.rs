//! AI 工作台的模型调用：Anthropic Claude（Messages API）与 OpenAI 兼容接口（chat/completions），
//! 均使用 SSE 流式输出。与 Tauri 无关，可单独测试。

pub mod agent;
pub mod weather;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    /// Anthropic Claude
    #[default]
    Anthropic,
    /// OpenAI 官方
    Openai,
    /// 其他 OpenAI 兼容接口：DeepSeek、通义千问、Kimi、智谱、Ollama 等
    Compatible,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AiConfig {
    pub provider: Provider,
    /// 为空时使用各家默认地址
    pub base_url: String,
    pub model: String,
    /// 系统提示词
    pub system: String,
    pub max_tokens: u32,
    pub temperature: Option<f32>,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            provider: Provider::Anthropic,
            base_url: String::new(),
            model: "claude-sonnet-5-5".into(),
            system: "你是像素书房里的写作与研究助手。回答使用简体中文，简洁直接；需要时使用 Markdown。".into(),
            max_tokens: 4096,
            temperature: None,
        }
    }
}

impl AiConfig {
    pub fn effective_base(&self) -> String {
        let b = self.base_url.trim().trim_end_matches('/');
        if !b.is_empty() {
            return b.to_string();
        }
        match self.provider {
            Provider::Anthropic => "https://api.anthropic.com".into(),
            Provider::Openai | Provider::Compatible => "https://api.openai.com/v1".into(),
        }
    }

    /// 钥匙串条目名：同一服务商的不同地址分别保存密钥
    pub fn key_account(&self) -> String {
        let p = match self.provider {
            Provider::Anthropic => "anthropic",
            Provider::Openai => "openai",
            Provider::Compatible => "compatible",
        };
        format!("{p}|{}", self.effective_base())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChatMessage {
    /// user / assistant
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AiEvent {
    Delta { text: String },
    Done,
    Error { message: String },
}

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("还没有设置 API 密钥")]
    NoKey,
    #[error("网络请求失败：{0}")]
    Http(String),
    #[error("{0}")]
    Api(String),
}

// ───────────────────────── SSE 解析 ─────────────────────────

/// 增量 SSE 解析器：字节可能在任意位置被切开（包括 UTF-8 多字节字符中间）。
#[derive(Default)]
pub struct SseParser {
    buf: Vec<u8>,
}

impl SseParser {
    /// 输入一块字节，返回其中完整事件的 data 内容（多行 data 以换行连接）。
    pub fn feed(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buf.extend_from_slice(chunk);
        let mut out = vec![];
        while let Some((end, sep)) = find_event_end(&self.buf) {
            let raw: Vec<u8> = self.buf.drain(..end + sep).collect();
            let text = String::from_utf8_lossy(&raw[..end]);
            let mut data: Vec<&str> = vec![];
            for line in text.split('\n') {
                let line = line.strip_suffix('\r').unwrap_or(line);
                if let Some(rest) = line.strip_prefix("data:") {
                    data.push(rest.strip_prefix(' ').unwrap_or(rest));
                }
            }
            if !data.is_empty() {
                out.push(data.join("\n"));
            }
        }
        out
    }
}

fn find_event_end(buf: &[u8]) -> Option<(usize, usize)> {
    let lf = buf.windows(2).position(|w| w == b"\n\n").map(|i| (i, 2));
    let crlf = buf.windows(4).position(|w| w == b"\r\n\r\n").map(|i| (i, 4));
    match (lf, crlf) {
        (Some(a), Some(b)) => Some(if a.0 <= b.0 { a } else { b }),
        (a, b) => a.or(b),
    }
}

/// 把一条 data 转为事件。返回 None 表示忽略（ping、开始事件等）。
pub fn parse_data(provider: Provider, data: &str) -> Option<AiEvent> {
    if provider != Provider::Anthropic && data.trim() == "[DONE]" {
        return Some(AiEvent::Done);
    }
    let v: Value = serde_json::from_str(data).ok()?;
    match provider {
        Provider::Anthropic => match v["type"].as_str()? {
            "content_block_delta" if v["delta"]["type"] == "text_delta" => {
                Some(AiEvent::Delta { text: v["delta"]["text"].as_str()?.to_string() })
            }
            "message_stop" => Some(AiEvent::Done),
            "error" => Some(AiEvent::Error { message: error_message(&v) }),
            _ => None,
        },
        Provider::Openai | Provider::Compatible => {
            if v.get("error").is_some() {
                return Some(AiEvent::Error { message: error_message(&v) });
            }
            let text = v["choices"][0]["delta"]["content"].as_str()?;
            if text.is_empty() {
                None
            } else {
                Some(AiEvent::Delta { text: text.to_string() })
            }
        }
    }
}

/// 从错误响应中取出可读信息（两种接口的格式都兼容）
pub fn error_message(v: &Value) -> String {
    let e = &v["error"];
    let msg = e["message"].as_str().or_else(|| e.as_str()).or_else(|| v["message"].as_str()).unwrap_or("未知错误");
    match e["type"].as_str().or_else(|| e["code"].as_str()) {
        Some(t) => format!("{msg}（{t}）"),
        None => msg.to_string(),
    }
}

pub(crate) fn http_error(status: u16, body: &str) -> String {
    let detail = serde_json::from_str::<Value>(body).map(|v| error_message(&v)).unwrap_or_else(|_| body.chars().take(200).collect());
    let hint = match status {
        401 | 403 => "，请检查 API 密钥",
        404 => "，请检查接口地址和模型名称",
        429 => "，请求太频繁或额度不足",
        529 | 503 => "，服务繁忙，稍后再试",
        _ => "",
    };
    format!("HTTP {status}：{detail}{hint}")
}

// ───────────────────────── 请求 ─────────────────────────

/// 构造请求（地址、请求头、请求体）。单独拆出便于测试。
pub fn build_request(cfg: &AiConfig, key: &str, messages: &[ChatMessage]) -> (String, Vec<(String, String)>, Value) {
    let base = cfg.effective_base();
    let msgs: Vec<Value> = messages
        .iter()
        .filter(|m| !m.content.trim().is_empty())
        .map(|m| json!({ "role": if m.role == "assistant" { "assistant" } else { "user" }, "content": m.content }))
        .collect();
    match cfg.provider {
        Provider::Anthropic => {
            let mut body = json!({
                "model": cfg.model,
                "max_tokens": cfg.max_tokens.max(1),
                "stream": true,
                "messages": msgs,
            });
            if !cfg.system.trim().is_empty() {
                body["system"] = json!(cfg.system);
            }
            if let Some(t) = cfg.temperature {
                body["temperature"] = json!(t);
            }
            let headers = vec![
                ("x-api-key".into(), key.into()),
                ("anthropic-version".into(), "2023-06-01".into()),
                ("content-type".into(), "application/json".into()),
            ];
            (format!("{base}/v1/messages"), headers, body)
        }
        Provider::Openai | Provider::Compatible => {
            let mut all = vec![];
            if !cfg.system.trim().is_empty() {
                all.push(json!({ "role": "system", "content": cfg.system }));
            }
            all.extend(msgs);
            let mut body = json!({ "model": cfg.model, "stream": true, "messages": all });
            if cfg.max_tokens > 0 {
                body["max_tokens"] = json!(cfg.max_tokens);
            }
            if let Some(t) = cfg.temperature {
                body["temperature"] = json!(t);
            }
            let mut headers = vec![("content-type".into(), "application/json".into())];
            if !key.is_empty() {
                headers.push(("authorization".into(), format!("Bearer {key}")));
            }
            (format!("{base}/chat/completions"), headers, body)
        }
    }
}

/// 发送问答请求并把事件逐个交给 `emit`。`cancel` 置位时尽快停止。
/// 正常结束时总会发出一次 Done；出错时发出 Error。
pub async fn stream_chat(cfg: &AiConfig, key: &str, messages: &[ChatMessage], cancel: &AtomicBool, mut emit: impl FnMut(AiEvent)) {
    if key.is_empty() && cfg.provider != Provider::Compatible {
        emit(AiEvent::Error { message: AiError::NoKey.to_string() });
        return;
    }
    let (url, headers, body) = build_request(cfg, key, messages);
    let client = match reqwest::Client::builder().connect_timeout(Duration::from_secs(15)).build() {
        Ok(c) => c,
        Err(e) => {
            emit(AiEvent::Error { message: AiError::Http(e.to_string()).to_string() });
            return;
        }
    };
    let mut req = client.post(&url).json(&body);
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            emit(AiEvent::Error { message: AiError::Http(e.to_string()).to_string() });
            return;
        }
    };
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        emit(AiEvent::Error { message: AiError::Api(http_error(status.as_u16(), &text)).to_string() });
        return;
    }
    let mut parser = SseParser::default();
    let mut stream = resp.bytes_stream();
    let mut done = false;
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            emit(AiEvent::Done);
            return;
        }
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                emit(AiEvent::Error { message: AiError::Http(e.to_string()).to_string() });
                return;
            }
        };
        for data in parser.feed(&chunk) {
            if let Some(ev) = parse_data(cfg.provider, &data) {
                let stop = matches!(ev, AiEvent::Done | AiEvent::Error { .. });
                emit(ev);
                if stop {
                    done = true;
                    break;
                }
            }
        }
        if done {
            return;
        }
    }
    emit(AiEvent::Done);
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn sse_parser_handles_split_chunks_and_utf8() {
        let stream = "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"你好\"}}\n\nevent: ping\ndata: {\"type\":\"ping\"}\r\n\r\n";
        let bytes = stream.as_bytes();
        let mut p = SseParser::default();
        let mut got = vec![];
        // 每次只喂 3 个字节，必然切开中文字符
        for c in bytes.chunks(3) {
            got.extend(p.feed(c));
        }
        assert_eq!(got.len(), 2);
        assert_eq!(parse_data(Provider::Anthropic, &got[0]), Some(AiEvent::Delta { text: "你好".into() }));
        assert_eq!(parse_data(Provider::Anthropic, &got[1]), None);
    }

    #[test]
    fn anthropic_events() {
        assert_eq!(parse_data(Provider::Anthropic, r#"{"type":"message_stop"}"#), Some(AiEvent::Done));
        assert_eq!(
            parse_data(Provider::Anthropic, r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#),
            Some(AiEvent::Error { message: "Overloaded（overloaded_error）".into() })
        );
        assert_eq!(parse_data(Provider::Anthropic, r#"{"type":"message_start","message":{}}"#), None);
    }

    #[test]
    fn openai_events() {
        let d = r#"{"choices":[{"delta":{"content":"像素"}}]}"#;
        assert_eq!(parse_data(Provider::Compatible, d), Some(AiEvent::Delta { text: "像素".into() }));
        assert_eq!(parse_data(Provider::Openai, "[DONE]"), Some(AiEvent::Done));
        assert_eq!(parse_data(Provider::Openai, r#"{"choices":[{"delta":{"role":"assistant"}}]}"#), None);
    }

    #[test]
    fn builds_requests() {
        let msgs = vec![ChatMessage { role: "user".into(), content: "hi".into() }, ChatMessage { role: "assistant".into(), content: "".into() }];
        let cfg = AiConfig::default();
        let (url, headers, body) = build_request(&cfg, "sk-ant", &msgs);
        assert_eq!(url, "https://api.anthropic.com/v1/messages");
        assert!(headers.contains(&("anthropic-version".into(), "2023-06-01".into())));
        assert_eq!(body["messages"].as_array().unwrap().len(), 1);
        assert!(body["system"].is_string());
        assert_eq!(body["stream"], true);

        let cfg = AiConfig { provider: Provider::Compatible, base_url: "https://api.deepseek.com/v1/".into(), model: "deepseek-chat".into(), ..Default::default() };
        let (url, headers, body) = build_request(&cfg, "", &msgs);
        assert_eq!(url, "https://api.deepseek.com/v1/chat/completions");
        assert!(!headers.iter().any(|(k, _)| k == "authorization"));
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(cfg.key_account(), "compatible|https://api.deepseek.com/v1");
    }

    #[test]
    fn http_errors_are_readable() {
        let m = http_error(401, r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#);
        assert!(m.contains("invalid x-api-key") && m.contains("请检查 API 密钥"), "{m}");
        assert!(http_error(500, "<html>oops</html>").contains("oops"));
    }

    /// 本地假服务器：返回一段 SSE，验证完整的流式请求链路
    async fn serve_once(response: &'static str) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 8192];
            let _ = s.read(&mut buf).await;
            s.write_all(response.as_bytes()).await.unwrap();
            s.shutdown().await.ok();
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn end_to_end_stream_against_local_server() {
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"书\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"房\"}}]}\n\ndata: [DONE]\n\n";
        let resp: &'static str = Box::leak(
            format!("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len())
                .into_boxed_str(),
        );
        let base = serve_once(resp).await;
        let cfg = AiConfig { provider: Provider::Compatible, base_url: base, model: "m".into(), ..Default::default() };
        let mut events = vec![];
        let cancel = AtomicBool::new(false);
        stream_chat(&cfg, "", &[ChatMessage { role: "user".into(), content: "?".into() }], &cancel, |e| events.push(e)).await;
        assert_eq!(
            events,
            vec![AiEvent::Delta { text: "书".into() }, AiEvent::Delta { text: "房".into() }, AiEvent::Done]
        );
    }

    #[tokio::test]
    async fn end_to_end_http_error() {
        let body = r#"{"error":{"message":"bad key","type":"invalid_request_error"}}"#;
        let resp: &'static str = Box::leak(
            format!("HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len())
                .into_boxed_str(),
        );
        let base = serve_once(resp).await;
        let cfg = AiConfig { provider: Provider::Openai, base_url: base, ..Default::default() };
        let mut events = vec![];
        stream_chat(&cfg, "k", &[ChatMessage { role: "user".into(), content: "?".into() }], &AtomicBool::new(false), |e| events.push(e)).await;
        match &events[..] {
            [AiEvent::Error { message }] => assert!(message.contains("bad key") && message.contains("401")),
            e => panic!("{e:?}"),
        }
    }

    #[tokio::test]
    async fn missing_key_is_reported() {
        let mut events = vec![];
        stream_chat(&AiConfig::default(), "", &[], &AtomicBool::new(false), |e| events.push(e)).await;
        assert_eq!(events, vec![AiEvent::Error { message: "还没有设置 API 密钥".into() }]);
    }
}
