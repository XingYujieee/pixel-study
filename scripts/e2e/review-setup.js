// 在新的 playwright-cli 会话里执行，注入仅用于 UI 测试的后端。
async (page) => {
  const response = await page.request.get("http://127.0.0.1:1427/scripts/e2e/mock-tauri.js");
  if (!response.ok()) throw new Error("请先在 1427 启动 Vite");
  const files = {
    "读书/三体.md": "---\ntags: [科幻]\n---\n# 三体\n正文与 [[活着]]\n- [ ] 待办",
    "读书/活着.md": "# 活着\n中文笔记",
    "工作/计划.txt": "本周计划",
    "Inbox/灵感.md": "# 一条灵感",
    "根目录.md": "# 根目录笔记",
  };
  await page.addInitScript({ content: `window.__MOCK_FILES__ = ${JSON.stringify(files)}; window.__AI_HASKEY__ = false;\n${await response.text()}` });
  await page.goto("http://127.0.0.1:1427/");
  await page.getByRole("button", { name: "点击画面进入书房" }).waitFor();
}
