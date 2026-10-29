// Heat and cold (V11 M4): plain sentences that EXPLAIN a low HD or high deaths, and alerts from the 3-day forecast.
// Explanations, not excuses: nothing here changes a colour. Pure functions over the weather rows.
import type { Ctx } from "./engine";
import { REALISTIC_CONFIG as C } from "./realistic";
import type { WeatherDay } from "./weatherTypes";

/** A hot day: max temperature above 35 °C, or above 30 °C with humidity above 70 %. */
export function isHotDay(w: Pick<WeatherDay, "tempMax" | "humidity">, cfg = C): boolean {
  if (w.tempMax == null) return false;
  return w.tempMax > cfg.hotMaxC || (w.tempMax > cfg.humidHotMaxC && w.humidity != null && w.humidity > cfg.humidPct);
}

const deg = (x: number) => `${Math.round(x)} °C`;
const dm = (d: string) => `${Number(d.slice(8, 10))} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(d.slice(5, 7)) - 1]}`;
const WHY = "feed intake and eggs usually drop on such days";

/** The sentence for a single day, or null when the day was not hot. */
export function heatSentence(w: WeatherDay | undefined, cfg = C): string | null {
  if (!w || !isHotDay(w, cfg) || w.tempMax == null) return null;
  const humid = w.humidity != null && w.humidity > cfg.humidPct && w.tempMax <= cfg.hotMaxC;
  return humid ? `hot and humid day: ${deg(w.tempMax)} with ${Math.round(w.humidity!)}% humidity, ${WHY}` : `hot day: ${deg(w.tempMax)}, ${WHY}`;
}

/** The last `days` days up to `date`: today's sentence if `date` itself was hot, else a week sentence naming the hottest day. */
export function heatNoteFor(byDate: Map<string, WeatherDay>, date: string, days = 7, cfg = C): string | null {
  const today = heatSentence(byDate.get(date), cfg);
  if (today) return today;
  const hot: WeatherDay[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.parse(date + "T00:00:00Z") - i * 86400000).toISOString().slice(0, 10);
    const w = byDate.get(d);
    if (w && isHotDay(w, cfg)) hot.push(w);
  }
  if (hot.length === 0) return null;
  const top = hot.reduce((a, b) => ((b.tempMax ?? 0) > (a.tempMax ?? 0) ? b : a));
  return `hot week: ${hot.length} hot day${hot.length === 1 ? "" : "s"} in the last ${days}, up to ${deg(top.tempMax!)} on ${dm(top.date)}; ${WHY}`;
}

/** Give the context its heat sentence (needs the weather rows in ctx.weatherByDate; does nothing without them). */
export function attachHeat(ctx: Ctx): void {
  if (ctx.weatherByDate.size === 0) return;
  ctx.heatNote = (date) => heatNoteFor(ctx.weatherByDate, date);
}

export interface ForecastAlert {
  id: string;
  kind: "hot" | "cold";
  date: string;
  title: string;
  detail: string;
}

/**
 * "What may go wrong soon" from the 3-day forecast: max temperature 38 °C or more, or min temperature below 4 °C.
 * `today` is the farm's own date. Only forecast days (today and the next 2) count. One alert per kind, naming the worst day.
 */
export function forecastAlerts(weather: WeatherDay[], today: string, cfg = C): ForecastAlert[] {
  const days = weather.filter((w) => w.date >= today && w.date <= new Date(Date.parse(today + "T00:00:00Z") + 2 * 86400000).toISOString().slice(0, 10));
  const out: ForecastAlert[] = [];
  const hot = days.filter((w) => w.tempMax != null && w.tempMax >= cfg.forecastHotC);
  if (hot.length) {
    const top = hot.reduce((a, b) => (b.tempMax! > a.tempMax! ? b : a));
    out.push({
      id: "forecast-hot",
      kind: "hot",
      date: top.date,
      title: `Very hot weather coming: up to ${deg(top.tempMax!)} on ${dm(top.date)}.`,
      detail: "Give more water (check every drinker and the tank), open the ventilation and run all fans, shade the roof or sprinkle it, and avoid handling birds in the afternoon.",
    });
  }
  const cold = days.filter((w) => w.tempMin != null && w.tempMin < cfg.forecastColdC);
  if (cold.length) {
    const low = cold.reduce((a, b) => (b.tempMin! < a.tempMin! ? b : a));
    out.push({
      id: "forecast-cold",
      kind: "cold",
      date: low.date,
      title: `Very cold night coming: down to ${deg(low.tempMin!)} on ${dm(low.date)}.`,
      detail: "Cover the curtains at night, close gaps and keep birds out of draughts, check that water is not cold or frozen, and watch feed intake (birds eat more in the cold).",
    });
  }
  return out;
}
