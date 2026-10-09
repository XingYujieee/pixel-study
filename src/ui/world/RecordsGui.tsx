import { useMemo, useState } from "react";
import { useJukebox } from "../../app/jukebox";
import {
  allRecords,
  coverOf,
  deleteRecord,
  editRecord,
  importMusic,
  pickRecord,
  putOnDeck,
  recordById,
  rerollCover,
  shelfCapacity,
} from "../../app/records";
import { useWorld } from "../../app/worldStore";
import { trackTitle, type RecordInfo } from "../../world/records";
import { useImeSafeKeys } from "./useImeSafeKeys";

const coverUrl = (r: RecordInfo) => coverOf(r).toDataURL();

/** 唱片架：导入音乐、看所有唱片、改名、换封面 */
export function RecordsGui() {
  const tracks = useJukebox((s) => s.tracks);
  const deck = useWorld((s) => s.deck);
  const records = useMemo(() => allRecords(), [tracks]);
  const close = () => useWorld.getState().closeGui();
  const cap = shelfCapacity();
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="mc-overlay" onMouseDown={close}>
      <div className="mc-panel chest-panel records-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2 className="mc-title">唱片架</h2>
          <span className="mc-text small">{records.length} 张唱片</span>
          <span className="spacer" />
          <button className="mc-btn on" onClick={() => void importMusic()} title="复制到应用里，原文件不变">
            导入音乐…
          </button>
        </div>
        <p className="mc-text small panel-note">
          同一张专辑的歌放进一张唱片，封面按唱片名画成像素画。在书房里对准唱片按 <kbd>E</kbd> 拿起来，走到留声机前再按 <kbd>E</kbd> 放上去。也可以直接把音乐文件从访达拖到唱片架上。
        </p>
        {cap.overflow > 0 && (
          <p className="mc-text small panel-note warn">
            唱片架放满了，还有 {cap.overflow} 张没地方摆：再放一个唱片架（物品栏最后一格）。
          </p>
        )}
        <div className="record-grid">
          {records.map((r) =>
            editing === r.id ? (
              <RecordEdit key={r.id} r={r} done={() => setEditing(null)} />
            ) : (
              <div key={r.id} className={`record-card ${deck === r.id ? "on" : ""}`}>
                <img className="record-cover" src={coverUrl(r)} alt="" draggable={false} />
                <div className="record-meta">
                  <span className="mc-text record-title" title={r.title}>
                    {deck === r.id ? "♪ " : ""}
                    {r.title}
                  </span>
                  <span className="mc-text small dim">
                    {r.artist || "未知歌手"} · {r.tracks.length} 首
                  </span>
                </div>
                <div className="record-actions">
                  <button
                    className="mc-btn small on"
                    title="直接放到留声机上"
                    onClick={() => {
                      pickRecord(r.id);
                      void putOnDeck();
                      close();
                    }}
                  >
                    放唱片
                  </button>
                  <button className="mc-btn small" onClick={() => setEditing(r.id)}>
                    改名
                  </button>
                  <button className="mc-btn small" onClick={() => void rerollCover(r)} title="同一个名字换一种配色和画法">
                    换封面
                  </button>
                </div>
              </div>
            ),
          )}
          {records.length === 0 && (
            <p className="mc-text small panel-note">
              唱片架还是空的。点「导入音乐」选几首 mp3、m4a、wav、flac，或者把音乐文件夹拖到唱片架上。音频会复制到应用自己的文件夹，不放进笔记库。
            </p>
          )}
        </div>
        <div className="panel-foot">
          <span className="spacer" />
          <button className="mc-btn" onClick={close}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function RecordEdit({ r, done }: { r: RecordInfo; done: () => void }) {
  const [title, setTitle] = useState(r.title);
  const [artist, setArtist] = useState(r.artist === "群星" ? "" : r.artist);
  const [confirmDel, setConfirmDel] = useState(false);
  const save = () => {
    const before = r.artist === "群星" ? "" : r.artist;
    void editRecord(r, title, artist.trim() === before.trim() ? undefined : artist).then(done);
  };
  const keys = useImeSafeKeys({ onEnter: save, onEscape: done });
  return (
    <div className="record-card editing">
      <img className="record-cover" src={coverOf({ title, artist, cover: r.cover }).toDataURL()} alt="" draggable={false} />
      <div className="record-meta">
        <label className="field-row">
          <span className="mc-text small">{r.single ? "歌名" : "专辑"}</span>
          <input className="mc-input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} {...keys} />
        </label>
        <label className="field-row">
          <span className="mc-text small">歌手</span>
          <input className="mc-input" value={artist} placeholder={r.artist === "群星" ? "群星（每首不同）" : ""} onChange={(e) => setArtist(e.target.value)} {...keys} />
        </label>
      </div>
      <div className="record-actions">
        <button className="mc-btn small on" onClick={save}>
          保存
        </button>
        <button className="mc-btn small" onClick={done}>
          取消
        </button>
        <button
          className={`mc-btn small ${confirmDel ? "danger" : ""}`}
          onClick={() => (confirmDel ? void deleteRecord(r).then(done) : setConfirmDel(true))}
          title="删除应用里的副本，原文件不受影响"
        >
          {confirmDel ? "确定删除？" : "删除"}
        </button>
      </div>
    </div>
  );
}

/** F 细看手上的唱片：大封面 + 歌单 */
export function InspectCard() {
  const inspect = useWorld((s) => s.inspect);
  const carry = useWorld((s) => s.carry);
  useJukebox((s) => s.tracks);
  const r = inspect ? recordById(carry?.id) : undefined;
  if (!r) return null;
  return (
    <div className="inspect-card mc-panel">
      <img className="inspect-cover" src={coverUrl(r)} alt="" draggable={false} />
      <div className="inspect-body">
        <div className="mc-title">{r.title}</div>
        <div className="mc-text small dim">
          {r.artist || "未知歌手"} · {r.tracks.length} 首
        </div>
        <ol className="inspect-tracks mc-text small">
          {r.tracks.slice(0, 12).map((t) => (
            <li key={t.id}>{trackTitle(t)}</li>
          ))}
          {r.tracks.length > 12 && <li className="dim">…还有 {r.tracks.length - 12} 首</li>}
        </ol>
        <div className="mc-text small key-hints">
          <kbd>E</kbd> 对着留声机放上去 · <kbd>Q</kbd> 放回唱片架 · <kbd>F</kbd> 放下
        </div>
      </div>
    </div>
  );
}
