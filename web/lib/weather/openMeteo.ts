// Daily weather for the farm from Open-Meteo (free, no key): the archive API for past days, the forecast API for the last
// week and the next 3 days. Pure apart from the injected fetch function, so it is unit-tested with mocked responses
// (including failures). Nothing here may ever throw into a page: a failure comes back as { days: [], error }.
import type { WeatherDay } from "@/lib/analytics/weatherTypes";

/** Dandrala / Mohali, Punjab. */
export const FARM_LAT = 30.7;
export const FARM_LON = 76.72;
export const WEATHER_START = "2026-07-02"; // first day of the farm's records
const DAILY = "temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean,precipitation_sum";
const TZ = "Asia%2FKolkata";
/** The archive trails real time by a few days; the forecast API covers the gap (past_days). */
export const ARCHIVE_LAG_DAYS = 7;

export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export const addDaysISO = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
/** Today's date in India (the farm's calendar), not the server's. */
export const todayIST = (now: number = Date.now()) => new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export const archiveUrl = (from: string, to: string) =>
  `https://archive-api.open-meteo.com/v1/archive?latitude=${FARM_LAT}&longitude=${FARM_LON}&start_date=${from}&end_date=${to}&daily=${DAILY}&timezone=${TZ}`;
export const forecastUrl = (pastDays: number, forecastDays: number) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${FARM_LAT}&longitude=${FARM_LON}&daily=${DAILY}&past_days=${pastDays}&forecast_days=${forecastDays}&timezone=${TZ}`;

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** Open-Meteo "daily" block (parallel arrays) -> one row per day. Anything malformed gives no rows, never an exception. */
export function parseDaily(json: unknown, source: string): WeatherDay[] {
  const d = (json as { daily?: Record<string, unknown> } | null)?.daily;
  const times = d?.time;
  if (!d || !Array.isArray(times)) return [];
  const col = (k: string): unknown[] => (Array.isArray(d[k]) ? (d[k] as unknown[]) : []);
  const tmax = col("temperature_2m_max"), tmin = col("temperature_2m_min"), hum = col("relative_humidity_2m_mean"), rain = col("precipitation_sum");
  const out: WeatherDay[] = [];
  times.forEach((t, i) => {
    if (typeof t !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return;
    const row: WeatherDay = { date: t, tempMax: num(tmax[i]), tempMin: num(tmin[i]), humidity: num(hum[i]), rainMm: num(rain[i]), source };
    if (row.tempMax == null && row.tempMin == null) return; // a day with no temperature at all is no use
    out.push(row);
  });
  return out;
}

async function getJson(fetchFn: FetchFn, url: string, timeoutMs: number): Promise<unknown> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // race against a timer too: a service that never answers must not hold the app, even if fetch ignores the abort signal
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort();
      reject(new Error("weather service did not answer in time"));
    }, timeoutMs);
  });
  try {
    const r = await Promise.race([fetchFn(url, { signal: ctl.signal }), timeout]);
    if (!r.ok) throw new Error(`weather service answered ${r.status}`);
    return await Promise.race([r.json(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Weather from `from` to 3 days after `today`: archive for the old days, forecast API (7 days back, 3 ahead) for the rest.
 * The forecast rows win for the overlapping days only where the archive has nothing. Never throws.
 */
export async function fetchWeather(fetchFn: FetchFn, from: string, today: string, timeoutMs = 10000): Promise<{ days: WeatherDay[]; error?: string }> {
  const days = new Map<string, WeatherDay>();
  const errors: string[] = [];
  const archiveTo = addDaysISO(today, -ARCHIVE_LAG_DAYS);
  if (from <= archiveTo) {
    try {
      for (const d of parseDaily(await getJson(fetchFn, archiveUrl(from, archiveTo), timeoutMs), "open-meteo archive")) days.set(d.date, d);
    } catch (e) {
      errors.push(`archive: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  try {
    for (const d of parseDaily(await getJson(fetchFn, forecastUrl(ARCHIVE_LAG_DAYS, 3), timeoutMs), "open-meteo forecast")) if (!days.has(d.date)) days.set(d.date, d);
  } catch (e) {
    errors.push(`forecast: ${e instanceof Error ? e.message : "failed"}`);
  }
  const list = [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  return errors.length ? { days: list, error: errors.join("; ") } : { days: list };
}
