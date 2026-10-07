//! 书房管家用的"会用工具"的对话：把统一格式的消息与工具定义翻译成 Claude（Messages API）或
//! OpenAI 兼容接口（chat/completions + tools）的请求，再把回答翻译回统一格式。
//! 不流式：管家一次想好再说，期间界面上显示"在想"。工具由网页一侧执行。

use crate::{error_message, http_error, AiConfig, AiError, Provider};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub input: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    /// user / assistant / tool
    pub role: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub tool_calls: Vec<ToolCall>,
    /// role 为 tool 时：对应的调用
    #[serde(default)]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    /// JSON Schema（object）
    pub parameters: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentReply {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
}

/// 构造请求。`system` 为管家自己的提示词（覆盖设置里的系统提示）。
pub fn build_agent_request(cfg: &AiConfig, key: &str, system: &str, messages: &[AgentMessage], tools: &[ToolSpec]) -> (String, Vec<(String, String)>, Value) {
    let base = cfg.effective_base();
    let max_tokens = cfg.max_tokens.clamp(256, 8192);
    match cfg.provider {
        Provider::Anthropic => {
            // 连续的工具结果要合并到同一条 user 消息里
            let mut msgs: Vec<Value> = vec![];
            for m in messages {
                match m.role.as_str() {
                    "assistant" => {
                        let mut blocks: Vec<Value> = vec![];
                        if !m.text.trim().is_empty() {
                            blocks.push(json!({ "type": "text", "text": m.text }));
                        }
                        for c in &m.tool_calls {
                            let input = if c.input.is_object() { c.input.clone() } else { json!({}) };
                            blocks.push(json!({ "type": "tool_use", "id": c.id, "name": c.name, "input": input }));
                        }
                        if blocks.is_empty() {
                            continue;
                        }
                        msgs.push(json!({ "role": "assistant", "content": blocks }));
                    }
                    "tool" => {
                        let block = json!({ "type": "tool_result", "tool_use_id": m.tool_call_id.clone().unwrap_or_default(), "content": m.text });
                        let merge = msgs
                            .last()
                            .map(|l| l["role"] == "user" && l["content"].as_array().is_some_and(|a| a.iter().all(|b| b["type"] == "tool_result")))
                            .unwrap_or(false);
                        if merge {
                            msgs.last_mut().unwrap()["content"].as_array_mut().unwrap().push(block);
                        } else {
                            msgs.push(json!({ "role": "user", "content": [block] }));
                        }
                    }
                    _ => {
                        if m.text.trim().is_empty() {
                            continue;
                        }
                        msgs.push(json!({ "role": "user", "content": m.text }));
                    }
                }
            }
            let mut body = json!({ "model": cfg.model, "max_tokens": max_tokens, "messages": msgs });
            if !system.trim().is_empty() {
                body["system"] = json!(system);
            }
            if !tools.is_empty() {
                body["tools"] = Value::Array(tools.iter().map(|t| json!({ "name": t.name, "description": t.description, "input_schema": t.parameters })).collect());
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
            let mut msgs: Vec<Value> = vec![];
            if !system.trim().is_empty() {
                msgs.push(json!({ "role": "system", "content": system }));
            }
            for m in messages {
                match m.role.as_str() {
                    "assistant" => {
                        let mut v = json!({ "role": "assistant", "content": if m.text.is_empty() { Value::Null } else { json!(m.text) } });
                        if !m.tool_calls.is_empty() {
                            v["tool_calls"] = Value::Array(
                                m.tool_calls
                                    .iter()
                                    .map(|c| json!({ "id": c.id, "type": "function", "function": { "name": c.name, "arguments": c.input.to_string() } }))
                                    .collect(),
                            );
                        } else if m.text.trim().is_empty() {
                            continue;
                        }
                        msgs.push(v);
                    }
                    "tool" => msgs.push(json!({ "role": "tool", "tool_call_id": m.tool_call_id.clone().unwrap_or_default(), "content": m.text })),
                    _ => {
                        if !m.text.trim().is_empty() {
                            msgs.push(json!({ "role": "user", "content": m.text }));
                        }
                    }
                }
            }
            let mut body = json!({ "model": cfg.model, "messages": msgs, "max_tokens": max_tokens });
            if !tools.is_empty() {
                body["tools"] = Value::Array(
                    tools.iter().map(|t| json!({ "type": "function", "function": { "name": t.name, "description": t.description, "parameters": t.parameters } })).collect(),
                );
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

/// 把回答翻译成统一格式
pub fn parse_agent_response(provider: Provider, v: &Value) -> Result<AgentReply, String> {
    if v.get("error").is_some() {
        return Err(error_message(v));
    }
    let mut text = String::new();
    let mut tool_calls = vec![];
    match provider {
        Provider::Anthropic => {
            for b in v["content"].as_array().ok_or("回答格式不对：没有 content")? {
                match b["type"].as_str() {
                    Some("text") => text.push_str(b["text"].as_str().unwrap_or("")),
                    Some("tool_use") => tool_calls.push(ToolCall {
                        id: b["id"].as_str().unwrap_or("").to_string(),
                        name: b["name"].as_str().unwrap_or("").to_string(),
                        input: b["input"].clone(),
                    }),
                    _ => {}
                }
            }
        }
        Provider::Openai | Provider::Compatible => {
            let m = &v["choices"][0]["message"];
            if m.is_null() {
                return Err("回答格式不对：没有 choices".into());
            }
            text = m["content"].as_str().unwrap_or("").to_string();
            if let Some(calls) = m["tool_calls"].as_array() {
                for (i, c) in calls.iter().enumerate() {
                    let args = c["function"]["arguments"].as_str().unwrap_or("{}");
                    let input = serde_json::from_str::<Value>(args).unwrap_or_else(|_| json!({}));
                    tool_calls.push(ToolCall {
                        id: c["id"].as_str().map(str::to_string).unwrap_or_else(|| format!("call_{i}")),
                        name: c["function"]["name"].as_str().unwrap_or("").to_string(),
                        input,
                    });
                }
            }
        }
    }
    Ok(AgentReply { text, tool_calls })
}

/// 发一轮请求
pub async fn agent_turn(cfg: &AiConfig, key: &str, system: &str, messages: &[AgentMessage], tools: &[ToolSpec]) -> Result<AgentReply, String> {
    if key.is_empty() && cfg.provider != Provider::Compatible {
        return Err(AiError::NoKey.to_string());
    }
    let (url, headers, body) = build_agent_request(cfg, key, system, messages, tools);
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| AiError::Http(e.to_string()).to_string())?;
    let mut req = client.post(&url).json(&body);
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| AiError::Http(e.to_string()).to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| AiError::Http(e.to_string()).to_string())?;
    if !status.is_success() {
        return Err(AiError::Api(http_error(status.as_u16(), &text)).to_string());
    }
    let v: Value = serde_json::from_str(&text).map_err(|_| format!("回答不是 JSON：{}", text.chars().take(160).collect::<String>()))?;
    parse_agent_response(cfg.provider, &v)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn convo() -> Vec<AgentMessage> {
        vec![
            AgentMessage { role: "user".into(), text: "三体在哪".into(), tool_calls: vec![], tool_call_id: None },
            AgentMessage {
                role: "assistant".into(),
                text: "我找找".into(),
                tool_calls: vec![
                    ToolCall { id: "t1".into(), name: "search_notes".into(), input: json!({ "query": "三体" }) },
                    ToolCall { id: "t2".into(), name: "library_overview".into(), input: json!({}) },
                ],
                tool_call_id: None,
            },
            AgentMessage { role: "tool".into(), text: "读书/三体.md".into(), tool_calls: vec![], tool_call_id: Some("t1".into()) },
            AgentMessage { role: "tool".into(), text: "1 层".into(), tool_calls: vec![], tool_call_id: Some("t2".into()) },
        ]
    }

    fn tools() -> Vec<ToolSpec> {
        vec![ToolSpec { name: "search_notes".into(), description: "搜索".into(), parameters: json!({ "type": "object", "properties": { "query": { "type": "string" } }, "required": ["query"] }) }]
    }

    #[test]
    fn anthropic_request_merges_tool_results() {
        let (url, _, body) = build_agent_request(&AiConfig::default(), "k", "你是管家", &convo(), &tools());
        assert_eq!(url, "https://api.anthropic.com/v1/messages");
        let m = body["messages"].as_array().unwrap();
        assert_eq!(m.len(), 3);
        assert_eq!(m[1]["content"][1]["type"], "tool_use");
        assert_eq!(m[2]["content"].as_array().unwrap().len(), 2);
        assert_eq!(m[2]["content"][1]["tool_use_id"], "t2");
        assert_eq!(body["tools"][0]["input_schema"]["type"], "object");
        assert_eq!(body["system"], "你是管家");
        assert!(body.get("stream").is_none());
    }

    #[test]
    fn openai_request_uses_function_tools() {
        let cfg = AiConfig { provider: Provider::Compatible, base_url: "https://api.deepseek.com/v1".into(), model: "deepseek-chat".into(), ..Default::default() };
        let (url, _, body) = build_agent_request(&cfg, "", "你是管家", &convo(), &tools());
        assert_eq!(url, "https://api.deepseek.com/v1/chat/completions");
        let m = body["messages"].as_array().unwrap();
        assert_eq!(m[0]["role"], "system");
        assert_eq!(m[2]["tool_calls"][0]["function"]["arguments"], "{\"query\":\"三体\"}");
        assert_eq!(m[3]["role"], "tool");
        assert_eq!(m[4]["tool_call_id"], "t2");
        assert_eq!(body["tools"][0]["type"], "function");
    }

    #[test]
    fn parses_both_formats() {
        let a = json!({ "content": [ { "type": "text", "text": "好的" }, { "type": "tool_use", "id": "x", "name": "guide_to", "input": { "path": "a.md" } } ] });
        let r = parse_agent_response(Provider::Anthropic, &a).unwrap();
        assert_eq!(r.text, "好的");
        assert_eq!(r.tool_calls[0].input["path"], "a.md");
        let o = json!({ "choices": [ { "message": { "content": null, "tool_calls": [ { "id": "c1", "type": "function", "function": { "name": "garden", "arguments": "{\"action\":\"weed\"}" } } ] } } ] });
        let r = parse_agent_response(Provider::Openai, &o).unwrap();
        assert_eq!(r.text, "");
        assert_eq!(r.tool_calls[0].name, "garden");
        assert_eq!(r.tool_calls[0].input["action"], "weed");
        assert!(parse_agent_response(Provider::Openai, &json!({ "error": { "message": "bad" } })).is_err());
    }
}
