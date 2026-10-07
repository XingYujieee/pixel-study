import { useState } from "react";
import { controller } from "../app/editor";
import { livePreviewOn, setLivePreview } from "../notes/livePreview";

/** 所见即所得 / 源码 切换（Markdown） */
export function LiveToggle({ className }: { className: string }) {
  const [on, setOn] = useState(livePreviewOn());
  return (
    <button
      className={`${className} ${on ? "on" : ""}`}
      title={on ? "所见即所得：光标不在的行直接显示效果（点一下看源码）。输入 / 插入标题、表格、待办；选中文字出现格式工具条" : "源码：显示全部 Markdown 标记（点一下换回所见即所得）"}
      onClick={() => {
        setLivePreview(controller.view, !on);
        setOn(!on);
      }}
    >
      {on ? "所见即所得" : "源码"}
    </button>
  );
}
