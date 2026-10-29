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

export type FetchTrigger = "daily job" | "button" | "page";

// Best effort: the log is for the Settings page only, so a missing table or a hiccup here never matters.
async function logFetch(query: Query, trigger: FetchTrigger, outcome: "ok" | "partial" | "failed", rows: number | null, message: string | null): Promise<void> {
  try {
    await query(`INSERT INTO weather_fetch_log (farm_code, trigger, outcome, rows_written, message) VALUES ($1,$2,$3,$4,$5)`, [ACTIVE_FARM, trigger, outcome, rows, message]);
  } catch {
    /* ignore */
  }
}

export interface WeatherStatus {
  available: boolean; // false when the database could not be read
  rows: number;
  firstDate: string | null;
  lastDate: string | null;
  fetchedAt: string | null; // when the newest row was fetched (ISO)
  lastAttempt: { at: string; trigger: string; outcome: string; rows: number | null; message: string | null } | null;
  lastGood: string | null; // last attempt that worked, ISO
}

/** What the Settings page shows. Never throws; works with either table missing. */
export async function loadWeatherStatus(query: Query = defaultQuery): Promise<WeatherStatus> {
  const none: WeatherStatus = { available: false, rows: 0, firstDate: null, lastDate: null, fetchedAt: null, lastAttempt: null, lastGood: null };
  try {
    const { rows } = await query(`SELECT count(*)::int AS n, to_char(min(date),'YYYY-MM-DD') AS first, to_char(max(date),'YYYY-MM-DD') AS last, max(fetched_at) AS at FROM weather_daily WHERE farm_code = $1`, [ACTIVE_FARM]);
    const r = rows[0] ?? {};
    const out: WeatherStatus = { available: true, rows: Number(r.n ?? 0), firstDate: (r.first as string) ?? null, lastDate: (r.last as string) ?? null, fetchedAt: r.at ? new Date(String(r.at)).toISOString() : null, lastAttempt: null, lastGood: null };
    try {
      const a = await query(`SELECT attempted_at, trigger, outcome, rows_written, message FROM weather_fetch_log WHERE farm_code = $1 ORDER BY attempted_at DESC LIMIT 1`, [ACTIVE_FARM]);
      if (a.rows[0]) out.lastAttempt = { at: new Date(String(a.rows[0].attempted_at)).toISOString(), trigger: String(a.rows[0].trigger), outcome: String(a.rows[0].outcome), rows: n(a.rows[0].rows_written), message: (a.rows[0].message as string) ?? null };
      const g = await query(`SELECT max(attempted_at) AS at FROM weather_fetch_log WHERE farm_code = $1 AND outcome IN ('ok','partial')`, [ACTIVE_FARM]);
      if (g.rows[0]?.at) out.lastGood = new Date(String(g.rows[0].at)).toISOString();
    } catch {
      /* log table not there yet */
    }
    return out;
  } catch {
    return none;
  }
}

export type RefreshStatus = { status: "refreshed"; rows: number; error?: string } | { status: "fresh" } | { status: "unavailable"; error: string };

/**
 * Fill the cache. Skips when it was refreshed within `maxAgeHours` (cached daily; a page load can call this freely).
 * First fill reaches back to the first day of the farm's records; later runs only re-fetch the last 2 weeks.
 */
export async function refreshWeather(opts: { force?: boolean; maxAgeHours?: number; fetchFn?: FetchFn; query?: Query; now?: number; trigger?: FetchTrigger } = {}): Promise<RefreshStatus> {
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
    const trigger = opts.trigger ?? "page";
    if (days.length === 0) {
      await logFetch(query, trigger, "failed", 0, error ?? "no weather returned");
      return { status: "unavailable", error: error ?? "no weather returned" };
    }
    for (const d of days) {
      await query(
        `INSERT INTO weather_daily (farm_code, date, temp_max_c, temp_min_c, humidity_mean, rain_mm, source, fetched_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (farm_code, date) DO UPDATE SET temp_max_c = EXCLUDED.temp_max_c, temp_min_c = EXCLUDED.temp_min_c,
           humidity_mean = EXCLUDED.humidity_mean, rain_mm = EXCLUDED.rain_mm, source = EXCLUDED.source, fetched_at = now()`,
        [ACTIVE_FARM, d.date, d.tempMax, d.tempMin, d.humidity, d.rainMm, d.source],
      );
    }
    await logFetch(query, trigger, error ? "partial" : "ok", days.length, error ?? null);
    return error ? { status: "refreshed", rows: days.length, error } : { status: "refreshed", rows: days.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed";
    await logFetch(query, opts.trigger ?? "page", "failed", null, msg);
    return { status: "unavailable", error: msg };
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
