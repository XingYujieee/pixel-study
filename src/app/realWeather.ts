// 天气跟随现实：选一个城市，每 20 分钟查一次当前天气（Open-Meteo，免费、不需要密钥）。
import { create } from "zustand";
import { api } from "../ipc";
import type { RealPlace } from "../world/sky";
import { getEngine } from "./worldActions";
import { useWorld } from "./worldStore";

interface RealWeatherStore {
  temperature: number | null;
  weather: "clear" | "cloudy" | "rain" | "snow" | "storm" | null;
  updatedAt: number | null;
  error: string | null;
}

export const useRealWeather = create<RealWeatherStore>(() => ({ temperature: null, weather: null, updatedAt: null, error: null }));

const EVERY = 20 * 60_000;
let lastKey = "";
let timer: ReturnType<typeof setInterval> | null = null;

function place(): RealPlace | null {
  const env = useWorld.getState().layout?.env;
  return env?.weather === "real" ? env.realPlace : null;
}

export async function refreshRealWeather(force = false) {
  const p = place();
  if (!p) {
    getEngine()?.env.setRealWeather(null);
    return;
  }
  const key = `${p.lat},${p.lon}`;
  const st = useRealWeather.getState();
  if (!force && key === lastKey && st.updatedAt && Date.now() - st.updatedAt < EVERY - 5000) {
    getEngine()?.env.setRealWeather(st.weather);
    return;
  }
  lastKey = key;
  try {
    const now = await api.weatherNow(p.lat, p.lon);
    useRealWeather.setState({ temperature: now.temperature, weather: now.weather, updatedAt: Date.now(), error: null });
    getEngine()?.env.setRealWeather(now.weather);
  } catch (e) {
    useRealWeather.setState({ error: String(e) });
  }
}

/** 启动定时查询；布局里天气设置变化时也检查一次 */
export function startRealWeather() {
  if (timer) return;
  timer = setInterval(() => void refreshRealWeather(), 60_000);
  let prev = "";
  useWorld.subscribe((s) => {
    const env = s.layout?.env;
    const k = env ? `${env.weather}|${env.realPlace?.lat},${env.realPlace?.lon}` : "";
    if (k !== prev) {
      prev = k;
      void refreshRealWeather();
    }
  });
}
