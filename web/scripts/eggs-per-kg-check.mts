// V17: eggs per kg of feed on the exported real rows.   npx tsx scripts/eggs-per-kg-check.mts <fixture-dir>
// Expected values are worked out straight from the raw rows (no engine): eggs of the flock-days with a feed figure
// ÷ (their bags × 45 kg). Pooled, never the average of daily ratios.
/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows are untyped JSON dumps */
import { readFileSync } from "node:fs";
import { loadInput } from "./fixtureInput.mts";
import { buildCtx, addDays, alertsFor, RULES, type EngineInput } from "../lib/analytics/engine";
import { boardEff, compareEff, effOn, effTrend, feedEfficiency, flockEff } from "../lib/analytics/feedEfficiency";
import { makeRange, rangeOf, summarizePeriod, summarizeRange, type PeriodExtras } from "../lib/analytics/period";
import { BAG_KG, type CostInput } from "../lib/costs/engine";

const dir = process.argv[2];
const j = (n: string) => JSON.parse(readFileSync(`${dir}/${n}.json`, "utf8"));
const input = loadInput(dir);
const ctx = buildCtx(input);
const dp: any[] = j("dp");
const flocks: any[] = j("flocks");
const segOf = new Map<string, string>(flocks.map((f) => [f.flock_internal_id, f.segment]));
const idOf = (label: string) => flocks.find((f) => f.display_label === label)?.flock_internal_id as string;
const extras: PeriodExtras = { sales: [], deductions: [], birdSales: [] };
const cost: CostInput = { settings: [], purchases: [], diesel: [], prod: [], sales: [], birdSales: [] };

let bad = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (!cond) bad++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); };
const near = (name: string, got: number | null | undefined, want: number | null, tol = 1e-9) => ok(name, got != null && want != null && Math.abs(got - want) <= tol, `got ${got} want ${want}`);
const has = (d: string) => ctx.dates.includes(d);

/** By hand from the raw rows: eggs of rows with feed ÷ (bags × 45). */
const byHand = (pred: (r: any) => boolean) => {
  const rs = dp.filter((r) => pred(r) && r.feed_bags != null);
  const eggs = rs.reduce((s, r) => s + (r.eggs_total ?? 0), 0);
  const kg = rs.reduce((s, r) => s + r.feed_bags, 0) * 45;
  return { eggs, kg, value: kg > 0 ? eggs / kg : null, days: new Set(rs.map((r) => r.date)).size };
};
const mainOn = (from: string, to: string) => (r: any) => r.date >= from && r.date <= to && segOf.get(r.flock_internal_id) === "main";

ok("the bag weight is the existing constant (45 kg)", BAG_KG === 45);

// ---- the day: 18 and 19 Nov, main flocks ----
for (const d of ["2026-11-18", "2026-11-19"].filter(has)) {
  const h = byHand(mainOn(d, d));
  const b = boardEff(ctx, d, "main");
  near(`${d} main: eggs per kg = ${h.eggs} eggs ÷ ${h.kg} kg`, b.day.eggsPerKg, h.value);
  near(`${d} main: kg per 100 eggs is the same totals the other way round`, b.day.kgPer100Eggs, (h.kg / h.eggs) * 100);
  ok(`${d} main: 1 of 1 day with feed`, b.day.days === 1 && b.day.daysWithFeed === 1);
}

// ---- a 7-day period: 13-19 Nov main flocks ----
if (has("2026-11-19") && has("2026-11-13")) {
  const h = byHand(mainOn("2026-11-13", "2026-11-19"));
  const b = boardEff(ctx, "2026-11-19", "main");
  ok("19 Nov board: the 7 days are 13-19 Nov", b.week.from === "2026-11-13" && b.week.to === "2026-11-19");
  near(`13-19 Nov main: pooled ${h.eggs} eggs ÷ ${h.kg} kg`, b.week.eggsPerKg, h.value);
  const wk = summarizeRange(ctx, cost, extras, makeRange("2026-11-13", "2026-11-19"), { segment: "main" });
  near("13-19 Nov main through the period engine (custom range) = by hand", wk.feed.eggsPerKg, h.value);
  ok("the period engine's kg per 100 eggs × eggs per kg = 100 (they always agree)", wk.feed.kgPer100Eggs != null && Math.abs(wk.feed.kgPer100Eggs * wk.feed.eggsPerKg! - 100) < 1e-9);
  const daily = Array.from({ length: 7 }, (_, i) => byHand(mainOn(addDays("2026-11-13", i), addDays("2026-11-13", i))).value!);
  const meanDaily = daily.reduce((s, x) => s + x, 0) / 7;
  ok("pooled is not the average of the daily ratios", Math.abs(meanDaily - h.value!) > 1e-6, `pooled ${h.value!.toFixed(5)} vs mean of days ${meanDaily.toFixed(5)}`);
  const prev = byHand(mainOn("2026-11-06", "2026-11-12"));
  near("the 7 days before (6-12 Nov) by hand", b.prevWeek.eggsPerKg, prev.value);
  ok("change vs the 7 days before: more eggs per kg = good", b.change != null && b.change.good === (h.value! > prev.value!) && Math.abs(b.change.abs - (h.value! - prev.value!)) < 1e-9);
}

// ---- week, month, year wrappers carry it ----
const nov = summarizePeriod(ctx, cost, extras, rangeOf("month", "2026-11-01"), "main");
near("November (month view), main = by hand over the November rows", nov.feed.eggsPerKg, byHand(mainOn("2026-11-01", "2026-11-30")).value);
const wkv = summarizePeriod(ctx, cost, extras, rangeOf("week", "2026-11-16"), "main");
near("week of 16 Nov (week view), main = by hand", wkv.feed.eggsPerKg, byHand(mainOn("2026-11-16", "2026-11-22")).value);
const yr = summarizePeriod(ctx, cost, extras, rangeOf("year", "2026-01-01"), "main");
near("year 2026, main = by hand over every main row with feed", yr.feed.eggsPerKg, byHand(mainOn("2026-01-01", "2026-12-31")).value);

// ---- one flock ----
const b5 = idOf("BAB-5");
const f5 = summarizeRange(ctx, cost, extras, makeRange("2026-11-13", "2026-11-19"), { flocks: [b5] });
const h5 = byHand((r) => r.flock_internal_id === b5 && r.date >= "2026-11-13" && r.date <= "2026-11-19");
near("one flock (BAB-5, 13-19 Nov) = its own eggs ÷ its own feed kg", f5.feed.eggsPerKg, h5.value);
near("one flock in the per-flock table = the same", f5.flocks[0]?.eggsPerKgFeed, h5.value);
near("one flock card (last 7 rows up to 19 Nov) = the same", flockEff(ctx, b5, "2026-11-19").week.eggsPerKg, h5.value);

// ---- a flock with a missing-feed day: BAB-9, 13-19 Nov (no feed on 19 Nov) ----
const b9 = idOf("BAB-9");
const f9 = summarizeRange(ctx, cost, extras, makeRange("2026-11-13", "2026-11-19"), { flocks: [b9] });
const h9 = byHand((r) => r.flock_internal_id === b9 && r.date >= "2026-11-13" && r.date <= "2026-11-19");
near("BAB-9 13-19 Nov: the eggs of 19 Nov (no feed) are left out of both sides", f9.feed.eggsPerKg, h9.value);
ok("BAB-9 13-19 Nov: 6 of 7 days with feed", f9.feed.daysWithFeed === 6 && f9.daysWithData === 7, `${f9.feed.daysWithFeed} of ${f9.daysWithData}`);
const d9 = flockEff(ctx, b9, "2026-11-19").day;
ok("BAB-9 on 19 Nov alone: null with the reason 'feed not recorded', never 0", d9.eggsPerKg === null && /feed not recorded/.test(d9.why ?? ""));
const y19 = boardEff(ctx, "2026-11-19", "young");
ok("Young group board 19 Nov: the day is 'feed not recorded'; the 7 days use the 6 days with feed", y19.day.eggsPerKg === null && /feed not recorded/.test(y19.day.why ?? "") && y19.week.daysWithFeed === 6 && y19.week.eggsPerKg != null);

// ---- a range with no feed at all ----
const none = summarizeRange(ctx, cost, extras, makeRange("2026-10-05", "2026-10-15"), { flocks: [b9] });
ok("a range with no feed at all (BAB-9, 5-15 Oct): null with a reason", none.feed.eggsPerKg === null && /feed not recorded/.test(none.feed.eggsPerKgWhy ?? "") && none.feed.daysWithFeed === 0 && none.daysWithData > 0, none.feed.eggsPerKgWhy ?? "");
ok("a range before the data: null with a reason", summarizeRange(ctx, cost, extras, makeRange("2026-06-01", "2026-06-10")).feed.eggsPerKg === null);

// ---- the pure function ----
const e = feedEfficiency([{ date: "a", eggs: 900, feed: 2 }, { date: "a", eggs: 500, feed: null }, { date: "b", eggs: 1000, feed: 3 }]);
ok("pure: eggs of a row without feed are left out of both sides; pooled 1,900 ÷ 225 kg", Math.abs(e.eggsPerKg! - 1900 / 225) < 1e-12 && e.daysWithFeed === 2 && e.days === 2 && e.eggs === 1900 && e.kg === 225);
ok("pure: zero bags written = null with a reason, not infinity", feedEfficiency([{ date: "a", eggs: 100, feed: 0 }]).eggsPerKg === null && /0 bags/.test(feedEfficiency([{ date: "a", eggs: 100, feed: 0 }]).why ?? ""));
ok("pure: no rows = null with a reason", feedEfficiency([]).eggsPerKg === null && !!feedEfficiency([]).why);
ok("compare: no value on either side = no arrow", compareEff(feedEfficiency([]), e) === null);

// ---- the 30-day trend ----
if (has("2026-11-19")) {
  const t = effTrend(ctx, "2026-11-19", "main", 30);
  ok("trend: 30 days ending 19 Nov, each day = that day's own value", t.length === 30 && t[29].date === "2026-11-19" && Math.abs(t[29].value! - byHand(mainOn("2026-11-19", "2026-11-19")).value!) < 1e-9);
  near("trend: the dashed line on 19 Nov = the 7-day value", t[29].avg7, boardEff(ctx, "2026-11-19", "main").week.eggsPerKg);
  const ty = effTrend(ctx, "2026-11-19", "young", 30);
  ok("trend for the young group: a gap (null) on days without feed", ty[29].value === null && ty.some((x) => x.value != null));
}
ok("effOn over no dates = null", effOn(ctx, [], "main").eggsPerKg === null);

// ---- E5 alert: 7-day eggs per kg more than 8% below the 7 days before ----
ok("the alert threshold is 8% and needs feed on at least 5 of 7 days in both windows", RULES.effDropPct === 8 && RULES.effMinFeedDays === 5);
const effAlerts = (c: typeof ctx, d: string) => alertsFor(c, d).filter((a) => a.kind === "feed_efficiency");
if (has("2026-11-18") && has("2026-11-19")) {
  const a18 = effAlerts(ctx, "2026-11-18");
  const b18 = boardEff(ctx, "2026-11-18", "main");
  ok("18 Nov: main raises 'feed is giving fewer eggs' (−8.9%); the numbers in the words are the board's 7-day values", a18.length === 1 && a18[0].segment === "main" && a18[0].reason.includes(b18.week.eggsPerKg!.toFixed(2)) && a18[0].reason.includes(b18.prevWeek.eggsPerKg!.toFixed(2)) && /Likely checks: feed waste/.test(a18[0].reason), a18[0]?.reason.slice(0, 90));
  ok("19 Nov: no alert (−7.8% is within 8%)", effAlerts(ctx, "2026-11-19").length === 0 && Math.abs(boardEff(ctx, "2026-11-19", "main").change!.pct + 7.79) < 0.05);
}
let youngAlerts = 0;
for (const d of ctx.dates) youngAlerts += effAlerts(ctx, d).filter((a) => a.segment === "young").length;
ok("young group: no alert (its feed is recorded on too few days, or it did not drop)", youngAlerts === 0);
const all: string[] = [];
for (const d of ctx.dates) for (const a of effAlerts(ctx, d)) all.push(a.date);
ok("never before 1 Sep (the cleared August register) and at most one alert a day per group", all.every((d) => d >= "2026-09-01") && new Set(all).size === all.length, `${all.length} alerts: ${all.join(", ")}`);
if (has("2026-09-07")) {
  const s7 = effAlerts(ctx, "2026-09-07");
  ok("7 Sep: BAB-3 (moulting) is left out of both windows and the words say so", s7.length === 0 || /BAB-3 \(moulting\) left out/.test(s7[0].reason), s7[0]?.reason.slice(0, 160));
}
// a made-up drop: the main flocks' eggs on 13-19 Nov cut by 20% -> the alert fires on 19 Nov
if (has("2026-11-19")) {
  const cut: EngineInput = { ...input, prod: input.prod.map((r) => (r.date >= "2026-11-13" && r.date <= "2026-11-19" && segOf.get(r.flockId) === "main" && r.eggs != null ? { ...r, eggs: Math.round(r.eggs * 0.8) } : r)) };
  ok("a made-up 20% egg cut on 13-19 Nov makes the 19 Nov alert fire", effAlerts(buildCtx(cut), "2026-11-19").some((a) => a.segment === "main"));
  const thin: EngineInput = { ...input, prod: input.prod.map((r) => (r.date >= "2026-11-13" && r.date <= "2026-11-17" && segOf.get(r.flockId) === "main" ? { ...r, feed: null } : r)) };
  ok("fewer than 5 days with feed in the window: no alert, even after a drop", effAlerts(buildCtx({ ...thin, prod: thin.prod.map((r) => (r.date >= "2026-11-18" && segOf.get(r.flockId) === "main" && r.eggs != null ? { ...r, eggs: Math.round(r.eggs * 0.5) } : r)) }), "2026-11-19").length === 0);
}

process.exit(bad ? 1 : 0);
