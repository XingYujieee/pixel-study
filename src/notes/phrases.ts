import { EditorState } from "@codemirror/state";

/** CodeMirror 内置界面文字的中文翻译（搜索面板、合并视图等） */
export const zhPhrases = EditorState.phrases.of({
  Find: "查找",
  Replace: "替换",
  next: "下一个",
  previous: "上一个",
  all: "全部",
  "match case": "区分大小写",
  "by word": "全词匹配",
  regexp: "正则",
  replace: "替换",
  "replace all": "全部替换",
  close: "关闭",
  "current match": "当前匹配",
  "replaced $ matches": "已替换 $ 处",
  "replaced match on line $": "已替换第 $ 行的匹配",
  "on line": "在第",
  "Go to line": "跳到行",
  go: "跳转",
  "Control character": "控制字符",
  "$ unchanged lines": "$ 行未改动",
  "Accept": "接受",
  "Reject": "拒绝",
});
