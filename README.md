<div align="center">

<img src="src-tauri/icons/128x128.png" width="76" alt="像素书房图标" />

# 像素书房

**把笔记放进一间可以走进去的书房。**

第一人称探索 · 本地文件写作 · 与 Obsidian 共用笔记库

![macOS](https://img.shields.io/badge/macOS-11%2B-27362B?style=flat-square) ![Tauri](https://img.shields.io/badge/Tauri-2-6B805D?style=flat-square) ![React](https://img.shields.io/badge/React-19-BF8A54?style=flat-square) ![Local first](https://img.shields.io/badge/Local--first-你的文件属于你-8A6850?style=flat-square)

[开始使用](#开始使用) · [探索书房](#一间真正能用的书房) · [文件与 Obsidian](#文件与-obsidian) · [开发与测试](#开发与测试)

</div>

![像素书房实机画面](docs/assets/study-room.png)

> 走近书架，抽出一本笔记；坐到书桌前，继续写下去。空间负责让整理变得有趣，正文始终是你熟悉的本地文件。

## 一间真正能用的书房

| 走进空间 | 坐下写作 | 整理资料 |
| :--- | :--- | :--- |
| WASD 行走、鼠标观察，布置家具，切换房间主题与窗景。 | Markdown、TXT 和 Word 在书桌前编辑；随时切到专注模式。 | 收藏书架整理引用，文件夹书架映射真实目录；搜索让你直接找到笔记。 |

书房还有灵感鱼塘、模板工作台、资料箱、AI 工作台、会带路的方块小鸟、花园与宠物。氛围由昼夜、天气、环境音和现场生成的音乐组成。完整功能清单见[功能导览](docs/功能导览.md)。

### 写作像翻开一本书

Markdown 默认提供接近 Notion 的编辑体验：输入 `/` 打开命令菜单，选中文字显示格式工具条，表格可插入、增删行列并用 Tab 跳格。未编辑的行直接显示标题、列表、待办、高亮等排版；需要精确控制时可以切回源码。正文保存在原始 Markdown 中，Obsidian 也能读取。

<p align="center"><img src="docs/assets/word-editor.png" width="900" alt="书桌上的 Word 编辑器实机画面" /></p>

## 文件与 Obsidian

```text
你的 Vault /
├── Notes/          ← 新建笔记默认写在这里
├── Inbox/          ← 灵感鱼塘里的速记
├── Templates/      ← 自定义模板
└── Attachments/    ← 图片与其他资料
```

- **直接打开现有 Vault**：Markdown、TXT 和附件仍是普通文件；书房布局等附加数据保存在应用数据目录，不改写 `.obsidian` 配置。
- **基础链接互通**：支持 `[[笔记]]`、`[[笔记|显示名称]]`、相对 Markdown 链接、标签与本地图片；保存时保留 YAML 属性和未识别语法。
- **两种书架**：收藏书架保存引用，一个文件可以出现在多个位置；文件夹书架展示真实目录。移除家具不会删除正文。
- **保存有退路**：自动保存、手动 `⌘S`、恢复草稿和外部修改冲突处理；导入采用复制方式。Word 编辑涉及可能丢失的格式时会提示并备份。

Word 提供内置页面式编辑；PDF 等其他文件可以归档并交给系统应用打开。高级 Obsidian 插件语法（如 Dataview、Canvas）不在当前渲染范围内。与 Obsidian 同时编辑同一篇笔记时，请先确认冲突提示再决定保留哪个版本。

## 开始使用

目前优先支持 **macOS 11+**。需要 Node.js 22、pnpm 10、Rust stable 和 Xcode Command Line Tools。

```bash
pnpm install
pnpm tauri dev
```

启动后选择已有 Obsidian Vault，或选择一个空文件夹作为新库。建议首次使用时先备份重要笔记。

要打包本机应用：

```bash
pnpm tauri build
```

也可以双击仓库里的 `构建像素书房.command`。构建结果位于 `src-tauri/target/release/bundle/`。本地构建未做公开发行签名与公证；首次打开时可在 Finder 中右键应用并选择“打开”。

## 常用操作

| 操作 | 快捷键 |
| :--- | :--- |
| 行走 / 跳跃 | `W A S D` / `空格` |
| 与准星指向的物件交互 | `左键` 或 `E` |
| 搜索笔记 | `⌘K` |
| 随手记录灵感 | `C`；任何界面可用 `⌘⇧I` |
| 书房与专注编辑切换 | `⌘J` |
| 立即保存 | `⌘S` |
| 打开或退出界面 | `Esc` |

更多操作见[功能导览](docs/功能导览.md)。

## 开发与测试

前端使用 React、TypeScript、Three.js 与 CodeMirror；桌面壳由 Tauri 2 提供，文件层与 AI 接口使用 Rust。

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml --workspace
pnpm gen:vault test-vault 1000
```

最后一条命令会生成 1,000 篇笔记的本地测试库。手动验收项目见[检查清单](docs/manual-checklist.md)，产品目标与边界见[PRD](docs/像素书房产品需求文档.md)。

---

<p align="center">在自己的世界里，给每一个想法留一个位置。 ✦</p>
