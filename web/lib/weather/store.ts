// Reading and refreshing the weather_daily cache. Every function is safe to call from a page: failures are swallowed into
// a status, never thrown, and a page never waits for the weather service (the refresh runs after the response).
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import type { WeatherDay } from "@/lib/analytics/weatherTypes";
import { WEATHER_START, addDaysISO, fetchWeather, todayIST, type FetchFn } from "./openMeteo";

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
const defaultQuery: Query = (sql, params) => pool.query(sql, params) as unknown as Promise<{ rows: Record<string, unknown>[] }>;

const n = (x: unknown): number | null => (x == null ? null : Number(x));

/** Everything in the cache (a few hundred rows). Returns [] when the table is missing or the database hiccups. */
export async function loadWeather(query: Query = defaultQuery): Promise<WeatherDay[]> {
  try {
    const { rows } = await query(
      `SELECT to_char(date,'YYYY-MM-DD') AS date, temp_max_c, temp_min_c, humidity_mean, rain_mm, source FROM weather_daily WHERE farm_code = $1 ORDER BY date`,
      [ACTIVE_FARM],
    );
    return rows.map((r) => ({ date: String(r.date), tempMax: n(r.temp_max_c), tempMin: n(r.temp_min_c), humidity: n(r.humidity_mean), rainMm: n(r.rain_mm), source: String(r.source) }));
  } catch {
    return [];
  }
}

export type RefreshStatus = { status: "refreshed"; rows: number; error?: string } | { status: "fresh" } | { status: "unavailable"; error: string };

/**
 * Fill the cache. Skips when it was refreshed within `maxAgeHours` (cached daily; a page load can call this freely).
 * First fill reaches back to the first day of the farm's records; later runs only re-fetch the last 2 weeks.
 */
export async function refreshWeather(opts: { force?: boolean; maxAgeHours?: number; fetchFn?: FetchFn; query?: Query; now?: number } = {}): Promise<RefreshStatus> {
  const query = opts.query ?? defaultQuery;
  const fetchFn = opts.fetchFn ?? (globalThis.fetch as unknown as FetchFn);
  const today = todayIST(opts.now);
  try {
    const { rows } = await query(`SELECT count(*)::int AS n, max(fetched_at) AS last FROM weather_daily WHERE farm_code = $1`, [ACTIVE_FARM]);
    const count = Number(rows[0]?.n ?? 0);
    const last = rows[0]?.last ? new Date(String(rows[0].last)).getTime() : 0;
    const age = ((opts.now ?? Date.now()) - last) / 3600000;
    if (!opts.force && count > 0 && age < (opts.maxAgeHours ?? 12)) return { status: "fresh" };
    const wanted = Math.round((Date.parse(addDaysISO(today, -8) + "T00:00:00Z") - Date.parse(WEATHER_START + "T00:00:00Z")) / 86400000) + 1;
    const from = count < wanted ? WEATHER_START : addDaysISO(today, -14);
    const { days, error } = await fetchWeather(fetchFn, from, today);
    if (days.length === 0) return { status: "unavailable", error: error ?? "no weather returned" };
    for (const d of days) {
      await query(
        `INSERT INTO weather_daily (farm_code, date, temp_max_c, temp_min_c, humidity_mean, rain_mm, source, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (farm_code, date) DO UPDATE SET temp_max_c = EXCLUDED.temp_max_c, temp_min_c = EXCLUDED.temp_min_c,
           humidity_mean = EXCLUDED.humidity_mean, rain_mm = EXCLUDED.rain_mm, source = EXCLUDED.source, fetched_at = now()`,
        [ACTIVE_FARM, d.date, d.tempMax, d.tempMin, d.humidity, d.rainMm, d.source],
      );
    }
    return error ? { status: "refreshed", rows: days.length, error } : { status: "refreshed", rows: days.length };
  } catch (e) {
    return { status: "unavailable", error: e instanceof Error ? e.message : "failed" };
  }
}

let lastTry = 0;
/** For pages: at most one attempt every 6 hours per server instance, and always after the response (see next/server `after`). */
export async function refreshWeatherQuietly(): Promise<void> {
  const now = Date.now();
  if (now - lastTry < 6 * 3600 * 1000) return;
  lastTry = now;
  await refreshWeather();
}
