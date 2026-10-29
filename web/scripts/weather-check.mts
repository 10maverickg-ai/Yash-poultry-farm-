// Tests the weather fetch/parse/refresh with MOCKED responses (the sandbox cannot reach Open-Meteo).  npx tsx scripts/weather-check.mts
import { parseDaily, fetchWeather, archiveUrl, forecastUrl, todayIST, addDaysISO, FARM_LAT, FARM_LON } from "../lib/weather/openMeteo.ts";
import { refreshWeather, loadWeather } from "../lib/weather/store.ts";

let failed = 0;
const ok = (n: string, c: boolean, x = "") => { if (!c) failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : "  " + x}`); };

// a response shaped like Open-Meteo's documented "daily" block (made-up numbers: a FORMAT sample, not weather data)
const sample = (dates: string[], tmax = 36.4) => ({ daily: { time: dates, temperature_2m_max: dates.map(() => tmax), temperature_2m_min: dates.map(() => 27.1), relative_humidity_2m_mean: dates.map(() => 74), precipitation_sum: dates.map(() => 0.2) } });
const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });

const p = parseDaily(sample(["2026-07-02", "2026-07-03"]), "open-meteo archive");
ok("parse: two days, all four values", p.length === 2 && p[0].tempMax === 36.4 && p[0].tempMin === 27.1 && p[0].humidity === 74 && p[0].rainMm === 0.2 && p[0].source === "open-meteo archive");
ok("parse: garbage gives no rows and no exception", parseDaily(null, "x").length === 0 && parseDaily({ daily: { time: "nope" } }, "x").length === 0 && parseDaily("<html>", "x").length === 0);
ok("parse: a day with no temperature is dropped, nulls are kept as null", (() => { const r = parseDaily({ daily: { time: ["2026-07-02", "2026-07-03"], temperature_2m_max: [null, 30], temperature_2m_min: [null, null], relative_humidity_2m_mean: [null, null], precipitation_sum: [null, null] } }, "x"); return r.length === 1 && r[0].date === "2026-07-03" && r[0].humidity === null; })());
ok("urls: Mohali coordinates, Indian time zone, no key", /latitude=30\.7&longitude=76\.72/.test(archiveUrl("2026-07-02", "2026-10-20")) && /Asia%2FKolkata/.test(forecastUrl(7, 3)) && !/apikey|key=/i.test(forecastUrl(7, 3)) && FARM_LAT === 30.7 && FARM_LON === 76.72);
ok("today in India: 23:00 UTC on 28 Oct is already 29 Oct", todayIST(Date.UTC(2026, 9, 28, 23, 0)) === "2026-10-29" && addDaysISO("2026-10-29", -7) === "2026-10-22");

// good run: archive for the old days, forecast for the last week + 3 ahead
const calls: string[] = [];
const good = async (url: string) => { calls.push(url); return resp(url.includes("archive-api") ? sample(["2026-07-02", "2026-07-03"], 38) : sample(["2026-10-22", "2026-10-29", "2026-10-30", "2026-10-31"], 33)); };
const g = await fetchWeather(good, "2026-07-02", "2026-10-29");
ok("fetch: archive (to today - 7) and forecast both called", calls.length === 2 && /end_date=2026-10-22/.test(calls[0]) && /past_days=7&forecast_days=3/.test(calls[1]), calls.join(" | "));
ok("fetch: 6 rows, sorted, labelled by source, no error", g.days.length === 6 && !g.error && g.days[0].date === "2026-07-02" && g.days[0].source === "open-meteo archive" && g.days[5].source === "open-meteo forecast");

// MOCKED FAILURES: nothing may throw
const boom = async () => { throw new Error("network down"); };
const f1 = await fetchWeather(boom, "2026-07-02", "2026-10-29");
ok("failure: network error -> no days, an error message, no exception", f1.days.length === 0 && /network down/.test(f1.error ?? ""), JSON.stringify(f1));
const f2 = await fetchWeather(async () => resp({}, false, 503), "2026-07-02", "2026-10-29");
ok("failure: HTTP 503 -> no days and the status in the message", f2.days.length === 0 && /503/.test(f2.error ?? ""));
const f3 = await fetchWeather(async (u: string) => (u.includes("archive") ? resp({ junk: true }) : resp(sample(["2026-10-29"]))), "2026-07-02", "2026-10-29");
ok("failure: archive junk but forecast fine -> partial rows plus no crash", f3.days.length === 1);
const f4 = await fetchWeather(() => new Promise(() => {}), "2026-07-02", "2026-10-29", 30);
ok("failure: a hanging service times out instead of hanging the app", f4.days.length === 0 && /in time/i.test(f4.error ?? ""), JSON.stringify(f4));

// store with a fake database
const db: { rows: any[]; sql: string[] } = { rows: [], sql: [] };
const query = async (sql: string, params?: unknown[]) => {
  db.sql.push(sql);
  if (/count\(\*\)/.test(sql)) return { rows: [{ n: db.rows.length, last: db.rows.length ? new Date(Date.UTC(2026, 9, 29, 0, 0)).toISOString() : null }] };
  if (/INSERT INTO weather_daily/.test(sql)) { db.rows.push(params); return { rows: [] }; }
  if (/FROM weather_daily/.test(sql)) return { rows: db.rows.map((p: any) => ({ date: p[1], temp_max_c: p[2], temp_min_c: p[3], humidity_mean: p[4], rain_mm: p[5], source: p[6] })) };
  return { rows: [] };
};
const now = Date.UTC(2026, 9, 29, 6, 0); // 29 Oct 11:30 IST
const r1 = await refreshWeather({ fetchFn: good, query, now });
ok("refresh: first run fills the cache", r1.status === "refreshed" && db.rows.length === 6, JSON.stringify(r1));
const callsBefore = calls.length;
const r2 = await refreshWeather({ fetchFn: good, query, now: now + 3600 * 1000 });
ok("refresh: a second call within 12 hours does nothing (cached daily)", r2.status === "fresh" && calls.length === callsBefore);
const r3 = await refreshWeather({ fetchFn: good, query, now: now + 3600 * 1000, force: true });
ok("refresh: force (the daily job) fetches again", r3.status === "refreshed" && calls.length === callsBefore + 2);
const back = await loadWeather(query);
ok("load: rows come back as weather days", back.length >= 6 && back[0].tempMax === 38);
const empty: typeof db = { rows: [], sql: [] };
const r4 = await refreshWeather({ fetchFn: boom, query: async (s: string) => (/count/.test(s) ? { rows: [{ n: 0, last: null }] } : { rows: [] }), now });
ok("refresh with the service DOWN: status unavailable, nothing written, no exception", r4.status === "unavailable" && empty.rows.length === 0, JSON.stringify(r4));
const r5 = await refreshWeather({ fetchFn: good, query: async () => { throw new Error("database offline"); }, now });
ok("refresh with the DATABASE down: unavailable, no exception", r5.status === "unavailable");
ok("load with a missing table: empty list, no exception", (await loadWeather(async () => { throw new Error('relation "weather_daily" does not exist'); })).length === 0);
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
