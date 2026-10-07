import { chooseVault } from "../app/actions";

export function Welcome() {
  return (
    <main className="welcome" data-tauri-drag-region>
      <div className="welcome-card">
        <div className="shelf-art" aria-hidden>
          <div className="shelf-row">
            {["c1", "c2", "c3", "c4", "c5", "c6", "c7"].map((c, i) => (
              <i key={c} className={c} style={{ height: 52 + ((i * 23) % 22) }} />
            ))}
          </div>
          <div className="shelf-board" />
        </div>
        <h1>像素书房</h1>
        <p className="lede">选一个文件夹作为你的书房。笔记就是里面普通的 Markdown 和文本文件。</p>
        <button className="btn primary big" onClick={() => void chooseVault()}>
          选择笔记库文件夹
        </button>
        <ul className="welcome-notes">
          <li>可以直接选择现有的 Obsidian 库，两边读写同一份文件，不会修改 .obsidian 配置。</li>
          <li>输入停止约一秒后自动保存；在别处修改的内容会自动刷新，冲突时两个版本都会保留。</li>
          <li>Word、PDF 等文件可以导入归档，用系统应用打开。</li>
        </ul>
      </div>
    </main>
  );
}
