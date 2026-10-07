import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useApp } from "./app/store";
import "./assets/fonts/fusion-pixel/font.css";
import "./styles.css";
import "./world.css";

// 未捕获的错误显示为提示，便于发现问题
window.addEventListener("error", (e) => useApp.getState().toast(`出错了：${e.message}`, "error"));
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason as { message?: string } | undefined;
  useApp.getState().toast(`出错了：${r?.message ?? String(e.reason)}`, "error");
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
