import { useEffect, useRef, useState } from "react";
import { api } from "../../ipc";
import { useRealWeather } from "../../app/realWeather";
import { useImeSafeKeys } from "./useImeSafeKeys";
import { getEngine, updateEnv } from "../../app/worldActions";
import { useWorld } from "../../app/worldStore";
import { pixelateFile } from "../../world/pixelate";
import { formatHour, WEATHER_NAMES, type EnvSettings, type TimeMode, type WeatherSetting } from "../../world/sky";
import { presetArt, SCENERY_NAMES } from "../../world/sceneryArt";
import { PANORAMA_RATIO } from "../../world/scenerySources";
import { themeOf, type SceneryPreset, type Side } from "../../world/themes";

type Tab = "scenery" | "time" | "weather";

/** 窗台：换窗景（上传图片转像素画）、调时间与天气 */
export function WindowGui() {
  const layout = useWorld((s) => s.layout);
  useWorld((s) => s.layoutVersion);
  const [tab, setTab] = useState<Tab>("scenery");
  const close = () => useWorld.getState().closeGui();
  if (!layout) return null;
  const env = layout.env;
  return (
    <div className="mc-overlay" onMouseDown={close}>
      <div className="mc-panel window-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2 className="mc-title">窗台</h2>
          <Now />
        </div>
        <div className="seg tabs">
          {(
            [
              ["scenery", "窗外风景"],
              ["time", "时间"],
              ["weather", "天气"],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} className={`mc-btn small ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        {tab === "scenery" && <SceneryTab env={env} />}
        {tab === "time" && <TimeTab mode={env.timeMode} fixedHour={env.fixedHour} cycleMinutes={env.cycleMinutes} />}
        {tab === "weather" && <WeatherTab value={env.weather} threshold={env.inboxThreshold} />}
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

function Now() {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const env = getEngine()?.env;
  if (!env) return null;
  return (
    <span className="mc-text small now">
      {formatHour(env.hour)} · {WEATHER_NAMES[env.weather]}
    </span>
  );
}

/** 远景画在很远处铺满一整面，像素要细一些才不糊 */
const WIDTHS = [
  [160, "粗"],
  [256, "中"],
  [384, "细"],
] as const;
const COLORS = [24, 32, 48] as const;
const SIDE_NAMES: Record<Side, string> = { north: "北窗", east: "东窗", west: "西窗" };
type Target = "all" | Side;

function SceneryTab({ env }: { env: EnvSettings }) {
  const themeId = useWorld((s) => s.layout?.theme);
  const theme = themeOf(themeId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [width, setWidth] = useState<number>(256);
  const [colors, setColors] = useState<number>(32);
  const [sky, setSky] = useState(true);
  const [pano, setPano] = useState(false);
  const [wide, setWide] = useState(false);
  const [target, setTarget] = useState<Target>("all");
  const [preview, setPreview] = useState<string | null>(null);
  const [keyed, setKeyed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    pixelateFile(file, width * (pano ? 3 : 1), colors, sky)
      .then((r) => {
        if (cancelled) return;
        setPreview(r.url);
        setKeyed(r.keyed / (r.art.width * r.art.height));
        const isWide = r.art.width / r.art.height >= PANORAMA_RATIO;
        setWide(isWide);
      })
      .catch(() => !cancelled && setError("这张图片读不了，换一张试试（JPG、PNG、WebP、GIF 都可以）。"))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [file, width, colors, sky, pano]);

  const custom = !!env.scenery || Object.keys(env.scenerySides).length > 0;
  const activePreset = env.sceneryPreset ?? theme.scenery;
  const apply = () => {
    if (!preview) return;
    if (target === "all") updateEnv({ scenery: preview, sceneryPanorama: pano && wide, scenerySides: {} });
    else updateEnv({ scenerySides: { ...env.scenerySides, [target]: preview } });
    setFile(null);
    setPreview(null);
  };

  return (
    <div className="scenery">
      <div className="scenery-left">
        <div className="scenery-preview">
          {preview ? (
            <img src={preview} alt="像素化预览" />
          ) : env.scenery ? (
            <img src={env.scenery} alt="当前窗景" />
          ) : presetArt(activePreset) ? (
            <img src={presetArt(activePreset)!.url} alt="当前内置窗景" />
          ) : (
            <div className="scenery-empty mc-text small">现在是树林草地。</div>
          )}
          {busy && <div className="scenery-busy mc-text small">正在画像素画…</div>}
        </div>
        <p className="mc-text small panel-note">内置风景{custom ? "（现在用的是你的图片，选一个会替换掉）" : ""}</p>
        <div className="preset-grid">
          <button
            className={`preset ${!custom && !env.sceneryPreset ? "on" : ""}`}
            onClick={() => updateEnv({ sceneryPreset: null, scenery: null, scenerySides: {} })}
            title="跟随屋子主题的默认风景"
          >
            <PresetThumb p={theme.scenery} />
            <span className="mc-text small">跟随屋子</span>
          </button>
          {(Object.keys(SCENERY_NAMES) as SceneryPreset[]).map((p) => (
            <button key={p} className={`preset ${!custom && env.sceneryPreset === p ? "on" : ""}`} onClick={() => updateEnv({ sceneryPreset: p, scenery: null, scenerySides: {} })}>
              <PresetThumb p={p} />
              <span className="mc-text small">{SCENERY_NAMES[p]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="scenery-controls">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setFile(f);
            e.target.value = "";
          }}
        />
        <button className="mc-btn" onClick={() => fileRef.current?.click()}>
          用自己的图片…
        </button>
        <p className="recipe-desc">图片会画成像素画，挂在很远的地方当远景，近处是立体的方块草地。也可以直接把图片从访达拖到某扇窗户上。图片只在本机处理，不会上传。</p>
        <div className="opt-row">
          <span className="mc-text small">像素</span>
          {WIDTHS.map(([w, label]) => (
            <button key={w} className={`mc-btn small ${width === w ? "on" : ""}`} onClick={() => setWidth(w)} disabled={!file}>
              {label}
            </button>
          ))}
        </div>
        <div className="opt-row">
          <span className="mc-text small">颜色</span>
          {COLORS.map((c) => (
            <button key={c} className={`mc-btn small ${colors === c ? "on" : ""}`} onClick={() => setColors(c)} disabled={!file}>
              {c} 色
            </button>
          ))}
        </div>
        <label className="mc-check" title="把图片里的天空变透明，露出书房真实的天空：日出日落、星星、雨雪都会出现">
          <input type="checkbox" checked={sky} onChange={(e) => setSky(e.target.checked)} disabled={!file} /> 换成真实天空
          {file && sky && preview && <span className="recipe-desc">（抠掉 {Math.round(keyed * 100)}%）</span>}
        </label>
        <label className="mc-check" title="宽幅全景图切成四段，绕屋子一圈：西、北、东、南（出门往南看）">
          <input type="checkbox" checked={pano} onChange={(e) => setPano(e.target.checked)} disabled={!file || target !== "all"} /> 全景绕屋子一圈
          {file && !wide && pano && <span className="recipe-desc">（这张不够宽，会整张显示）</span>}
        </label>
        <div className="opt-row">
          <span className="mc-text small">装到</span>
          {(["all", "north", "east", "west"] as Target[]).map((t) => (
            <button key={t} className={`mc-btn small ${target === t ? "on" : ""}`} onClick={() => setTarget(t)}>
              {t === "all" ? "全部窗户" : SIDE_NAMES[t]}
            </button>
          ))}
        </div>
        {error && <p className="mc-text small panel-note err">{error}</p>}
        <div className="opt-row">
          <button className="mc-btn on" disabled={!preview || busy} onClick={apply}>
            装到窗外
          </button>
        </div>
        {(Object.keys(env.scenerySides) as Side[]).length > 0 && (
          <div className="opt-row">
            {(Object.keys(env.scenerySides) as Side[]).map((sd) => (
              <button
                key={sd}
                className="mc-btn small"
                onClick={() => {
                  const next = { ...env.scenerySides };
                  delete next[sd];
                  updateEnv({ scenerySides: next });
                }}
              >
                {SIDE_NAMES[sd]}恢复
              </button>
            ))}
          </div>
        )}
        {env.scenery && (
          <button className="mc-btn small" onClick={() => updateEnv({ scenery: null, sceneryPanorama: false })}>
            去掉我的图片
          </button>
        )}
      </div>
    </div>
  );
}

/** 天气跟随现实：搜索城市 */
function RealPlacePicker() {
  const place = useWorld((s) => s.layout?.env.realPlace ?? null);
  const real = useRealWeather();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ name: string; detail: string; lat: number; lon: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.weatherSearch(q.trim());
      setResults(r);
      if (!r.length) setErr("没有找到这个地方，换个写法试试（中文或英文城市名都可以）。");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };
  const keys = useImeSafeKeys({ onEnter: () => void search() });
  return (
    <div className="real-place">
      <p className="mc-text small panel-note">
        {place
          ? `现在跟随：${place.name}${real.temperature !== null ? ` · ${Math.round(real.temperature)}° ${real.weather ? WEATHER_NAMES[real.weather] : ""}` : ""}`
          : "选一个城市。只会把城市坐标发给 Open-Meteo 天气服务，不会发送任何笔记内容。"}
        {real.error && place ? `（上次更新失败：${real.error}）` : ""}
      </p>
      <div className="cast-row">
        <input className="mc-input" placeholder="城市名，例如 伦敦 / London / 上海" value={q} onChange={(e) => setQ(e.target.value)} {...keys} />
        <button className="mc-btn" disabled={busy || !q.trim()} onClick={() => void search()}>
          {busy ? "查找中…" : "查找"}
        </button>
      </div>
      {err && <p className="mc-text small panel-note err">{err}</p>}
      {results.length > 0 && (
        <div className="picker-list">
          {results.map((r) => (
            <button
              key={`${r.lat},${r.lon}`}
              className="picker-row"
              onClick={() => {
                updateEnv({ realPlace: { name: r.name, lat: r.lat, lon: r.lon } });
                setResults([]);
                setQ("");
              }}
            >
              <span>{r.name}</span>
              <span className="hint">{r.detail}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PresetThumb({ p }: { p: SceneryPreset }) {
  const art = presetArt(p);
  return art ? <img className="preset-img" src={art.url} alt="" /> : <span className="preset-img forest" />;
}

function TimeTab({ mode, fixedHour, cycleMinutes }: { mode: TimeMode; fixedHour: number; cycleMinutes: number }) {
  const opts: [TimeMode, string, string][] = [
    ["real", "跟随现实", "窗外的时间与你电脑的时钟一致"],
    ["cycle", "快速昼夜", "像方块游戏一样，几十分钟走完一天"],
    ["fixed", "固定时间", "永远停在你喜欢的时刻"],
  ];
  return (
    <div className="env-tab">
      {opts.map(([k, name, desc]) => (
        <button key={k} className={`env-opt ${mode === k ? "on" : ""}`} onClick={() => updateEnv({ timeMode: k })}>
          <span className="mc-text">{name}</span>
          <span className="recipe-desc">{desc}</span>
        </button>
      ))}
      {mode === "cycle" && (
        <label className="field-row wide">
          <span className="mc-text small">一天</span>
          <input
            type="range"
            min={5}
            max={120}
            step={5}
            value={cycleMinutes}
            onChange={(e) => updateEnv({ cycleMinutes: Number(e.target.value) })}
          />
          <span className="mc-text small">{cycleMinutes} 分钟</span>
        </label>
      )}
      {mode === "fixed" && (
        <label className="field-row wide">
          <span className="mc-text small">时刻</span>
          <input type="range" min={0} max={23.75} step={0.25} value={fixedHour} onChange={(e) => updateEnv({ fixedHour: Number(e.target.value) })} />
          <span className="mc-text small">{formatHour(fixedHour)}</span>
        </label>
      )}
    </div>
  );
}

function WeatherTab({ value, threshold }: { value: WeatherSetting; threshold: number }) {
  const opts: [WeatherSetting, string][] = [
    ["auto", "每几个小时自动变化，冬天会下雪"],
    ["inbox", "跟随鱼塘：待整理的灵感越多天越阴，清空就放晴"],
    ["real", "跟随现实：按你选的城市查实时天气，每 20 分钟更新（需要联网）"],
    ["clear", "晴朗，云很少"],
    ["cloudy", "多云，光线柔和"],
    ["rain", "窗外下雨，天色偏暗"],
    ["snow", "窗外下雪"],
  ];
  return (
    <div className="env-tab">
      {opts.map(([k, desc]) => (
        <button key={k} className={`env-opt ${value === k ? "on" : ""}`} onClick={() => updateEnv({ weather: k })}>
          <span className="mc-text">{WEATHER_NAMES[k]}</span>
          <span className="recipe-desc">{desc}</span>
        </button>
      ))}
      {value === "real" && <RealPlacePicker />}
      {value === "inbox" && (
        <label className="field-row wide">
          <span className="mc-text">下雨</span>
          <input type="range" min={2} max={30} value={threshold} onChange={(e) => updateEnv({ inboxThreshold: Number(e.target.value) })} />
          <span className="mc-text small">{threshold} 条起</span>
        </label>
      )}
    </div>
  );
}
