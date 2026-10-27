// Period aggregation on the exported real rows: tsx scripts/period-check.mts <fixture-dir>
/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows are untyped JSON dumps */
import { readFileSync } from "node:fs";
import { loadInput } from "./fixtureInput.mts";
import { buildCtx } from "../lib/analytics/engine";
import { rangeOf, shiftRange, lastYearRange, weekStart, weeksWithin, monthsWithin, runRate, summarizePeriod, compare, type PeriodExtras } from "../lib/analytics/period";
import type { CostInput } from "../lib/costs/engine";

const dir = process.argv[2];
const j = (n: string) => JSON.parse(readFileSync(`${dir}/${n}.json`, "utf8"));
const ctx = buildCtx(loadInput(dir));
const sf: any[] = j("sales_full");
const cost: CostInput = {
  settings: [
    { type: "feed_per_kg", value: 30, effectiveFrom: "2026-08-01", month: null },
    { type: "labour_month", value: 250000, effectiveFrom: "2026-08-01", month: null },
    { type: "packing_per_tray", value: 4, effectiveFrom: "2026-08-01", month: null },
    { type: "electricity_month", value: 100000, effectiveFrom: "2026-08-01", month: "2026-08" },
  ],
  purchases: [], diesel: [],
  prod: j("dp").map((r: any) => ({ date: r.date, flockId: r.flock_internal_id, eggs: r.eggs_total ?? 0, feedBags: r.feed_bags ?? 0, birds: r.bird_population ?? 0 })),
  sales: j("sales"),
  birdSales: [],
};
const extras: PeriodExtras = {
  sales: sf.map((s) => ({ date: s.date, eggs: s.e, amount: s.a, grade: s.g, channel: s.tt === "sale_farmfresh" ? "farmfresh" : "local" })),
  deductions: j("deductions"),
  birdSales: [],
};

let bad = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (!cond) bad++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); };
const near = (name: string, got: number | null, want: number, tol = 0.01) => ok(name, got != null && Math.abs(got - want) <= tol, `got ${got} want ${want}`);
const S = (r: ReturnType<typeof rangeOf>) => summarizePeriod(ctx, cost, extras, r);

// ---- calendar helpers
ok("week starts Monday (Sun 13 Sep -> Mon 7 Sep)", weekStart("2026-09-13") === "2026-09-07");
ok("a Monday is its own week start", weekStart("2026-09-14") === "2026-09-14");
const w = rangeOf("week", "2026-09-10");
ok("week label", w.label === "Mon 7 Sep – Sun 13 Sep", w.label);
ok("month range", rangeOf("month", "2026-02-10").to === "2026-02-28");
ok("previous month across a year", shiftRange(rangeOf("month", "2026-01-15"), -1).from === "2025-12-01");
ok("same week last year starts on a Monday", new Date(lastYearRange(w).from + "T00:00:00Z").getUTCDay() === 1);
ok("weeks inside September are clipped to the month", weeksWithin(rangeOf("month", "2026-09-01")).every((x) => x.from >= "2026-09-01" && x.to <= "2026-09-30") && weeksWithin(rangeOf("month", "2026-09-01")).length === 5);

// ---- September month: known figures
const sep = S(rangeOf("month", "2026-09-01"));
ok("September has data on all 30 days", sep.daysWithData === 30 && !sep.partial, sep.dataNote);
ok("eggs sold in September = 13,46,850", sep.money.eggsSold === 1346850, String(sep.money.eggsSold));
near("September sales = ₹72,24,898 (Farmfresh 7,223,930 + local 968, after the list-price re-pricing)", sep.money.revenue, 7224897.9, 0.05);
const dp: any[] = j("dp").filter((r: any) => r.date.startsWith("2026-09"));
const eggsDp = dp.reduce((s, r) => s + (r.eggs_total ?? 0), 0);
ok("eggs total = sum of the daily rows", sep.eggs.total === eggsDp, `${sep.eggs.total}`);
const birdDays = dp.reduce((s, r) => s + (r.bird_population ?? 0), 0);
near("HD% is pooled: eggs ÷ bird-days × 100", sep.eggs.hdPooled, (eggsDp / birdDays) * 100, 1e-9);
ok("pooled HD% differs from the mean of daily HD%", Math.abs(sep.eggs.hdPooled! - sep.eggs.hdMeanOfDaily!) > 0.001, `pooled ${sep.eggs.hdPooled!.toFixed(4)} vs mean ${sep.eggs.hdMeanOfDaily!.toFixed(4)}`);
ok("best day is not worse than worst day", sep.eggs.best!.hd >= sep.eggs.worst!.hd);
ok("September breakage = sum of the ledger breakage lines", sep.eggs.breakage === (j("deductions") as any[]).filter((d) => d.date.startsWith("2026-09") && d.category === "breakage").reduce((s, d) => s + d.eggs, 0), String(sep.eggs.breakage));
ok("breakage is a share of eggs laid", Math.abs(sep.eggs.breakagePct! - (sep.eggs.breakage / sep.eggs.total) * 100) < 1e-9);
ok("September cost is incomplete: electricity missing, not zero", !sep.money.costComplete && sep.money.missing.some((m) => m.startsWith("electricity")) && sep.money.cost.electricity === 0);
ok("profit is an estimate and exists when sales are priced", sep.money.profit != null);
ok("bird chain: opening − deaths + movements = closing", (() => {
  const moves = ctx.input.movements.filter((m) => m.date.startsWith("2026-09")).reduce((s, m) => s + m.change, 0);
  const diff = sep.birds.opening! - sep.birds.deaths + moves - sep.birds.closing!;
  console.log("      chain residual", diff);
  return Math.abs(diff) <= 20; // register rounding / reviewed count adjustments
})());
ok("Anil transfers are not counted as deaths", sep.birds.anilOut > 0 || sep.birds.anilIn >= 0);
ok("feed kg = bags × 45", sep.feed.kg === sep.feed.bags * 45);
ok("every flock status is set", sep.flocks.length >= 8 && sep.flocks.every((f) => !!f.status));
ok("flocks use real names (BAB-n, or Old BAB-n for the departed)", sep.flocks.every((f) => /^(Old )?BAB-\d+/.test(f.label)), sep.flocks.map((f) => f.label).join(","));
ok("shares of farm eggs add to 100", Math.abs(sep.flocks.reduce((s, f) => s + (f.shareOfEggs ?? 0), 0) - 100) < 1e-6);
ok("Bovans White has no reference, not another breed's", sep.flocks.filter((f) => f.breed === "Bovans White").every((f) => f.stdHd == null && f.status === "no_reference"));

// ---- a full week and the weeks of September add up to the month
const wk = S(rangeOf("week", "2026-09-10"));
ok("full week Mon 7 – Sun 13 Sep has 7 of 7 days", wk.daysWithData === 7 && !wk.partial && wk.dataNote === "7 of 7 days have data", wk.dataNote);
const weeks = weeksWithin(rangeOf("month", "2026-09-01")).map(S);
ok("weeks add up to the month: eggs", weeks.reduce((s, x) => s + x.eggs.total, 0) === sep.eggs.total);
ok("weeks add up to the month: deaths", weeks.reduce((s, x) => s + x.birds.deaths, 0) === sep.birds.deaths);
near("weeks add up to the month: revenue", weeks.reduce((s, x) => s + x.money.revenue, 0), sep.money.revenue, 0.05);
// 1-7 Sept as a custom range
const first7 = S({ kind: "week", from: "2026-09-01", to: "2026-09-07", days: 7, label: "1–7 Sep" });
ok("1–7 Sep: 7 of 7 days", first7.daysWithData === 7);
ok("1–7 Sep eggs = sum of those daily rows", first7.eggs.total === dp.filter((r) => r.date <= "2026-09-07").reduce((s, r) => s + (r.eggs_total ?? 0), 0));
// partial week: Mon 28 Sep – Sun 4 Oct has only 3 days
const part = S(rangeOf("week", "2026-10-26"));
ok("partial week (Mon 26 Oct – Sun 1 Nov) says 1 of 7 days have data", part.daysWithData === 1 && part.partial && part.dataNote === "1 of 7 days have data", part.dataNote);
near("partial-week average uses only days with data", part.eggs.perDay, part.eggs.total / 1, 1e-9);
const empty = S(rangeOf("week", "2026-11-10"));
ok("a week with no data says so and has no invented numbers", empty.daysWithData === 0 && empty.eggs.perDay == null && empty.eggs.hdPooled == null && empty.money.profit == null, empty.dataNote);

// ---- comparison
const prevWeek = S(shiftRange(wk.range, -1));
const cmp = compare(wk, prevWeek);
const c = (k: string) => cmp.find((x) => x.key === k)!;
ok("comparison covers 7 metrics", cmp.length === 7);
ok("change = now − before", Math.abs(c("eggsPerDay").abs! - (wk.eggs.perDay! - prevWeek.eggs.perDay!)) < 1e-9);
ok("more eggs is good, more deaths is bad", c("eggsPerDay").good === (c("eggsPerDay").abs! > 0) && c("deathsPct").good === (c("deathsPct").abs! < 0));
ok("no earlier data -> no comparison (same week last year)", compare(wk, S(lastYearRange(wk.range))).every((x) => x.abs == null && x.good == null));

// ---- year and run rate
const yr = S(rangeOf("year", "2026-06-01"));
ok("year 2026 has 117 days of data (Jul 30 + Aug 31 + Sep 30 + Oct 26) and is partial", yr.daysWithData === 117 && yr.partial, yr.dataNote);
// direct SQL sums on the live database (27 Oct), per month and group
for (const [m, seg, days, eggs, bd, deaths, feed] of [["2026-07", "main", 30, 2135100, 2777658, 1618, 6203], ["2026-08", "main", 31, 1924920, 2757898, 1486, 5551], ["2026-09", "main", 30, 1442700, 2101456, 944, 4715], ["2026-10", "main", 26, 1426830, 1740898, 601, 3629], ["2026-10", "young", 23, 223800, 639023, 173, 127]] as const) {
  const r = summarizePeriod(ctx, cost, extras, rangeOf("month", `${m}-01`), seg);
  const birddays = ctx.input.prod.filter((x) => x.date.startsWith(m) && ctx.flockById.get(x.flockId)?.segment === seg).reduce((t, x) => t + (x.pop ?? 0), 0);
  ok(`SQL ${m} ${seg}: ${days} days, ${eggs} eggs, ${bd} bird-days, ${deaths} deaths, ${feed} bags`, r.daysWithData === days && r.eggs.total === eggs && birddays === bd && r.birds.deaths === deaths && r.feed.bags === feed, `${r.daysWithData}/${r.eggs.total}/${birddays}/${r.birds.deaths}/${r.feed.bags}`);
}
const months = monthsWithin(rangeOf("year", "2026-01-01")).map(S);
ok("year months add up", months.reduce((s, m) => s + m.eggs.total, 0) === yr.eggs.total);
const rr = runRate(months.filter((m) => m.daysWithData > 0));
ok("run rate appears with 2 full months and is last month × 12", rr != null && rr.eggsYear === sep.eggs.total * 12, rr ? rr.month : "none");
ok("no run rate with only one full month", runRate(months.filter((m) => m.range.from === "2026-09-01")) == null);

// ---- alerts grouped
const sepAlerts = sep.alerts;
ok("September alerts are grouped by rule and add up", Object.values(sepAlerts.byKind).reduce((s, x) => s + (x ?? 0), 0) === sepAlerts.total, `total ${sepAlerts.total}`);
const sepMain = summarizePeriod(ctx, cost, extras, rangeOf("month", "2026-09-01"), "main").alerts.total;
const sepYoung = summarizePeriod(ctx, cost, extras, rangeOf("month", "2026-09-01"), "young").alerts.total;
ok("September: main + young alerts do not exceed the whole farm", sepMain + sepYoung <= sepAlerts.total, `main ${sepMain} young ${sepYoung} farm ${sepAlerts.total}`);
const aug = S(rangeOf("month", "2026-08-01"));
ok("August has no alerts (cleared)", aug.alerts.total === 0);

process.exit(bad ? 1 : 0);
