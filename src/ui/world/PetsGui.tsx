import { useState } from "react";
import { adoptPet, releasePet, renamePet } from "../../app/pets";
import { useWorld } from "../../app/worldStore";
import { MAX_PETS, PET_KINDS, type PetKind } from "../../world/pets";
import { useImeSafeKeys } from "./useImeSafeKeys";

const SWATCH: Record<PetKind, string[]> = {
  cat: ["#e8913a", "#8a8d96", "#f4f2ee"],
  dog: ["#c98a4a", "#f0dcb4", "#2e2e32"],
  rabbit: ["#f6f4f0", "#a87a52", "#9a9aa2"],
  chick: ["#ffd84a", "#f6f6f2"],
  fox: ["#e0682a", "#eef0f4"],
};

/** 宠物：领养（选种类、毛色、名字）、改名、送回家 */
export function PetsGui({ focus }: { focus?: string }) {
  const pets = useWorld((s) => s.layout?.pets ?? []);
  useWorld((s) => s.layoutVersion);
  const [kind, setKind] = useState<PetKind>("cat");
  const [coat, setCoat] = useState(0);
  const [name, setName] = useState("");
  const close = () => useWorld.getState().closeGui();
  const kinfo = PET_KINDS.find((k) => k.kind === kind)!;
  const adopt = () => {
    if (adoptPet(kind, coat, name)) {
      setName("");
      close();
    }
  };
  const keys = useImeSafeKeys({ onEnter: adopt });
  return (
    <div className="mc-overlay" onMouseDown={close}>
      <div className="mc-panel small-panel pets-panel" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="mc-title">宠物</h2>
        {pets.length > 0 && (
          <div className="picker-list">
            {pets.map((p) => (
              <PetRow key={p.id} id={p.id} name={p.name} kind={p.kind} coat={p.coat} focus={focus === p.id} />
            ))}
          </div>
        )}
        {pets.length < MAX_PETS ? (
          <>
            <p className="mc-text small panel-note">领养一只（最多 {MAX_PETS} 只）。它会在书房里溜达、跟着你，晚上趴在你最近看的那本书旁边睡觉。</p>
            <div className="seg pet-kinds">
              {PET_KINDS.map((k) => (
                <button
                  key={k.kind}
                  className={`mc-btn small ${kind === k.kind ? "on" : ""}`}
                  onClick={() => {
                    setKind(k.kind);
                    setCoat(0);
                  }}
                >
                  {k.name}
                </button>
              ))}
            </div>
            <div className="opt-row">
              <span className="mc-text small">毛色</span>
              {kinfo.coats.map((cname, i) => (
                <button key={cname} className={`mc-btn small coat ${coat === i ? "on" : ""}`} onClick={() => setCoat(i)}>
                  <i className="coat-dot" style={{ background: SWATCH[kind][i] }} />
                  {cname}
                </button>
              ))}
            </div>
            <div className="cast-row">
              <input className="mc-input" placeholder={`给它起个名字（默认叫「${kinfo.name}」）`} value={name} maxLength={20} onChange={(e) => setName(e.target.value)} {...keys} />
              <button className="mc-btn on" onClick={adopt}>
                领养
              </button>
            </div>
          </>
        ) : (
          <p className="mc-text small panel-note">书房里已经有 {MAX_PETS} 只了。</p>
        )}
        <div className="panel-foot">
          <span className="spacer" />
          <button className="mc-btn" onClick={close}>
            好
          </button>
        </div>
      </div>
    </div>
  );
}

function PetRow({ id, name, kind, coat, focus }: { id: string; name: string; kind: PetKind; coat: number; focus: boolean }) {
  const [n, setN] = useState(name);
  const k = PET_KINDS.find((x) => x.kind === kind)!;
  const keys = useImeSafeKeys({ onEnter: () => renamePet(id, n) });
  return (
    <div className={`picker-row static ${focus ? "on" : ""}`}>
      <i className="coat-dot" style={{ background: SWATCH[kind][coat % SWATCH[kind].length] }} />
      <input className="mc-input pet-name" value={n} maxLength={20} onChange={(e) => setN(e.target.value)} onBlur={() => renamePet(id, n)} {...keys} autoFocus={focus} />
      <span className="hint">{k.coats[coat % k.coats.length]}</span>
      <button className="mc-btn small" onClick={() => releasePet(id)} title="送回家（之后可以再领养）">
        送回家
      </button>
    </div>
  );
}
