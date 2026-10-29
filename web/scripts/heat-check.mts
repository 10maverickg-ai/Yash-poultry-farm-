// Tests the heat sentence rule, the forecast alerts and how a hot spell is attached to a flock card (never changes the colour).
//   npx tsx scripts/heat-check.mts
import { buildCtx, flockCards, addDays, type EngineInput, type ProdRow, type FlockRef } from "../lib/analytics/engine.ts";
import { attachRealistic } from "../lib/analytics/realistic.ts";
import { attachHeat, isHotDay, heatSentence, heatNoteFor, forecastAlerts } from "../lib/analytics/heat.ts";
import type { WeatherDay } from "../lib/analytics/weatherTypes.ts";

let failed = 0;
const ok = (n: string, c: boolean, x = "") => { if (!c) failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : "  " + x}`); };
const w = (date: string, tempMax: number | null, humidity: number | null = 50, tempMin: number | null = 25): WeatherDay => ({ date, tempMax, tempMin, humidity, rainMm: 0, source: "test" });

ok("hot: 35.1 is hot, 35.0 is not", isHotDay(w("d", 35.1)) && !isHotDay(w("d", 35)));
ok("hot and humid: 31 °C with 75% is hot; 31 with 70% is not (needs above 70); 29 with 95% is not", isHotDay(w("d", 31, 75)) && !isHotDay(w("d", 31, 70)) && !isHotDay(w("d", 29, 95)));
ok("hot: no temperature, no verdict", !isHotDay(w("d", null, 99)));
ok("sentence: the exact words", heatSentence(w("2026-10-23", 38)) === "hot day: 38 °C, feed intake and eggs usually drop on such days", String(heatSentence(w("2026-10-23", 38))));
ok("sentence: humid wording names the humidity", /hot and humid day: 33 °C with 78% humidity/.test(heatSentence(w("2026-07-23", 33, 78)) ?? ""));
ok("sentence: a mild day gives nothing", heatSentence(w("2026-10-23", 28)) === null && heatSentence(undefined) === null);
{
  const by = new Map([w("2026-07-20", 30), w("2026-07-21", 39), w("2026-07-22", 36), w("2026-07-23", 31)].map((x) => [x.date, x]));
  const n = heatNoteFor(by, "2026-07-23");
  ok("week note: names the number of hot days and the hottest day", /hot week: 2 hot days in the last 7, up to 39 °C on 21 Jul/.test(n ?? ""), String(n));
  ok("week note: nothing when the week was not hot", heatNoteFor(by, "2026-07-20") === null);
  ok("a hot day itself gets the single-day sentence", heatNoteFor(by, "2026-07-21")?.startsWith("hot day: 39 °C") === true);
}
// forecast alerts
const fc = (rows: WeatherDay[]) => forecastAlerts(rows, "2026-10-29");
ok("forecast: 38 °C in the next 3 days alerts with action words", (() => { const a = fc([w("2026-10-30", 38)]); return a.length === 1 && a[0].kind === "hot" && /water/.test(a[0].detail) && /ventilat/.test(a[0].detail) && /shade/.test(a[0].detail); })());
ok("forecast: 37.9 °C does not alert", fc([w("2026-10-30", 37.9)]).length === 0);
ok("forecast: min below 4 °C alerts, with curtains", (() => { const a = fc([w("2026-10-31", 20, 50, 3.9)]); return a.length === 1 && a[0].kind === "cold" && /curtains/.test(a[0].detail); })());
ok("forecast: exactly 4.0 °C does not alert", fc([w("2026-10-31", 20, 50, 4)]).length === 0);
ok("forecast: only today and the next 2 days count (a hot day 3 days away, or yesterday, is ignored)", fc([w("2026-11-01", 40), w("2026-10-28", 40)]).length === 0);
ok("forecast: hot and cold together give two alerts", fc([w("2026-10-29", 39), w("2026-10-30", 20, 50, 2)]).length === 2);
ok("forecast: no weather, no alert, no exception", fc([]).length === 0);

// a flock card: a hot week is an explanation next to a low HD, never a change of colour
const std = Array.from({ length: 50 }, (_, i) => ({ age: 20 + i, hdp: 90, feedG: 100, cumDepl: 0.1 * (i + 1) }));
const flock: FlockRef = { id: "A", label: "BAB-A", breed: "BV300", placementDate: "2026-01-01", placementConfirmed: true, segment: "main" };
let id = 0;
const make = (eggs: (i: number) => number, weather: WeatherDay[], mort = 1): EngineInput => {
  const prod: ProdRow[] = [];
  for (let i = 0; i < 60; i++) prod.push({ id: ++id, date: addDays("2026-07-30", i), flockId: "A", label: "BAB-A", mort, feed: 20, eggs: eggs(i), pop: 1000, hd: eggs(i) / 10, flagged: false, reviewed: false });
  return { flocks: [flock], prod, movements: [], egg: [], feedBoxes: [], chick: [], farmfreshDates: [], moulting: [], std, realisticOverrides: [], weather };
};
const last = addDays("2026-07-30", 59);
const hotWeek = Array.from({ length: 60 }, (_, i) => w(addDays("2026-07-30", i), 38));
const card = (eggs: (i: number) => number, weather: WeatherDay[], mort = 1) => { const c = buildCtx(make(eggs, weather, mort)); attachRealistic(c); attachHeat(c); return flockCards(c, last)[0]; };
// 40 days at 80%, then the last 20 days at 60% (a bad stretch)
const drop = (i: number) => (i < 40 ? 800 : 600);
const hotDrop = card(drop, hotWeek), coolDrop = card(drop, hotWeek.map((x) => ({ ...x, tempMax: 28 }))), noWeather = card(drop, []);
ok("card: a low HD in a hot week carries the hot sentence", hotDrop.status !== "green" && /hot day: 38 °C/.test(hotDrop.heatNote ?? ""), JSON.stringify([hotDrop.status, hotDrop.heatNote]));
ok("card: the colour is the same with and without the weather", hotDrop.status === noWeather.status && hotDrop.status === coolDrop.status, `${hotDrop.status} ${noWeather.status} ${coolDrop.status}`);
ok("card: no hot weather -> no sentence; no weather at all -> no sentence", coolDrop.heatNote === null && noWeather.heatNote === null);
const fine = card(() => 800, hotWeek, 0);
ok("card: a healthy flock on a hot day gets no explanation (nothing to explain: not low, deaths fine)", fine.status !== "red" && fine.status !== "amber" && fine.death?.status === "green" && fine.heatNote === null, JSON.stringify([fine.status, fine.death?.status, fine.heatNote]));
const deaths = card(() => 800, hotWeek, 3);
ok("card: high deaths in a hot week also carry the sentence", deaths.death?.status === "red" && /hot day/.test(deaths.heatNote ?? ""), JSON.stringify([deaths.death, deaths.heatNote]));
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
