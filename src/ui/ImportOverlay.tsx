import { useEffect, useState } from "react";
import { undoImport, useImport } from "../app/importer";
import { useWorld } from "../app/worldStore";

/** 拖着文件经过窗口时：顶部提示松手后的去处；专注模式下整屏提示 */
export function DropHint() {
  const drag = useImport((s) => s.drag);
  const focus = useWorld((s) => s.mode === "focus");
  if (!drag) return null;
  return (
    <div className={`drop-hint ${focus ? "full" : ""}`}>
      <div className="drop-hint-card mc-text">
        <span className="drop-what">{drag.count}</span>
        <span className="drop-where">{drag.label}</span>
      </div>
    </div>
  );
}

/** 导入回执：去了哪里、几个文件，可以撤销。鼠标停在上面时不会消失。 */
export function ImportReceiptCard() {
  const receipt = useImport((s) => s.receipt);
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!receipt || hover) return;
    const t = setTimeout(() => {
      if (useImport.getState().receipt?.id === receipt.id) useImport.setState({ receipt: null });
    }, receipt.undone ? 3000 : 10000);
    return () => clearTimeout(t);
  }, [receipt, hover]);
  if (!receipt) return null;
  const n = receipt.imported.length;
  const parts: string[] = [];
  if (n) parts.push(`导入 ${n} 个文件`);
  if (receipt.shelf && receipt.inVault) parts.push(`${receipt.inVault} 个库里已有的直接上架`);
  return (
    <div className="import-receipt mc-panel" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} role="status">
      {receipt.undone ? (
        <span className="mc-text small">{receipt.custom ? "已撤销，换回原来的样子。" : "已撤销：副本移到了 .trash/，原文件一直没动。"}</span>
      ) : receipt.custom ? (
        <>
          <span className="mc-text small">{receipt.custom.text}</span>
          <button className="mc-btn small" onClick={() => void undoImport(receipt)}>
            撤销
          </button>
          <button className="mc-btn small" onClick={() => useImport.setState({ receipt: null })} aria-label="关闭">
            ×
          </button>
        </>
      ) : (
        <>
          <span className="mc-text small">
            {parts.join("，")} → {receipt.where}
            {receipt.renamed ? `（${receipt.renamed} 个同名，已保留两份）` : ""}
          </span>
          <button
            className="mc-btn small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await undoImport(receipt);
              setBusy(false);
            }}
          >
            撤销
          </button>
          <button className="mc-btn small" onClick={() => useImport.setState({ receipt: null })} aria-label="关闭">
            ×
          </button>
        </>
      )}
    </div>
  );
}
