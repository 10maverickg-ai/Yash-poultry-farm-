// V15: the one period engine for any date range, and Compare, on the exported real rows.
//   npx tsx scripts/range-check.mts <fixture-dir>        (run-all dumps fresh fixtures from the database)
// Expected figures are worked out straight from the raw rows (no engine), so the checks hold on any refresh date.
/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows are untyped JSON dumps */
import { readFileSync } from "node:fs";
import { loadInput } from "./fixtureInput.mts";
import { buildFarmCtx } from "../lib/analytics/ctx";
import { buildCtx, addDays, type EngineInput } from "../lib/analytics/engine";
import { customRange, makeRange, precedingRange, quickRanges, rangeCoverage, rangeOf, shiftRange, summarizePeriod, summarizeRange, weeksWithin, partsWithin, lastDaysWithData, MAX_RANGE_DAYS, type PeriodExtras, type PeriodSummary } from "../lib/analytics/period";
import { readRange, resolveFlock, flockOptions, defaultRange } from "../lib/analytics/rangeParams";
import { addMonths, ageOn, compareRows, compareSide, dataWeeks, readCompare, weeksToRange, presets, overlaySeries } from "../lib/analytics/compare";
import type { CostInput } from "../lib/costs/engine";

const dir = process.argv[2];
const j = (n: string) => JSON.parse(readFileSync(`${dir}/${n}.json`, "utf8"));
const input = loadInput(dir);
const { ctx } = buildFarmCtx(input);
const sf: any[] = j("sales_full");
const dpAll: any[] = j("dp");
const ded: any[] = j("deductions");
const mvAll: any[] = j("movements");
const cost: CostInput = {
  settings: [
    { type: "feed_per_kg", value: 30, effectiveFrom: "2026-08-01", month: null },
    { type: "labour_month", value: 250000, effectiveFrom: "2026-08-01", month: null },
    { type: "packing_per_tray", value: 4, effectiveFrom: "2026-08-01", month: null },
    { type: "electricity_month", value: 100000, effectiveFrom: "2026-08-01", month: "2026-08" },
  ],
  purchases: [], diesel: [],
  prod: dpAll.map((r) => ({ date: r.date, flockId: r.flock_internal_id, eggs: r.eggs_total ?? 0, feedBags: r.feed_bags ?? 0, birds: r.bird_population ?? 0 })),
  sales: j("sales"),
  birdSales: [],
};
const extras: PeriodExtras = {
  sales: sf.map((s) => ({ date: s.date, eggs: s.e, amount: s.a, grade: s.g, channel: s.tt === "sale_farmfresh" ? "farmfresh" : "local" })),
  deductions: ded,
  birdSales: [],
};

let bad = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (!cond) bad++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); };
const near = (name: string, got: number | null | undefined, want: number, tol = 1e-6) => ok(name, got != null && Math.abs(got - want) <= tol, `got ${got} want ${want}`);
const R = (from: string, to: string, flocks?: string[]) => summarizeRange(ctx, cost, extras, makeRange(from, to), { flocks: flocks ?? null });
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const rawRows = (from: string, to: string, flock?: string) => dpAll.filter((r) => r.date >= from && r.date <= to && (!flock || r.flock_internal_id === flock));
const id = (name: string) => resolveFlock(ctx, name)!;
const BAB3 = id("BAB-3");
const BAB5 = id("BAB-5");

// ---- 1. Sept 1–15, whole farm, against the raw rows ----
const s15 = R("2026-09-01", "2026-09-15");
const raw15 = rawRows("2026-09-01", "2026-09-15");
ok("1-15 Sep: 15 of 15 days have data", s15.daysWithData === 15 && s15.dataNote === "15 of 15 days have data", s15.dataNote);
ok("1-15 Sep whole farm: eggs = sum of the raw rows", s15.eggs.total === sum(raw15.map((r) => r.eggs_total ?? 0)), String(s15.eggs.total));
ok("1-15 Sep whole farm: deaths = sum of the raw rows", s15.birds.deaths === sum(raw15.map((r) => r.mortality ?? 0)), String(s15.birds.deaths));
ok("1-15 Sep whole farm: feed bags = sum of the raw rows", s15.feed.bags === sum(raw15.map((r) => r.feed_bags ?? 0)), String(s15.feed.bags));
near("1-15 Sep whole farm: HD % pooled = eggs ÷ bird-days", s15.eggs.hdPooled, (sum(raw15.map((r) => r.eggs_total ?? 0)) / sum(raw15.map((r) => r.bird_population ?? 0))) * 100);
near("1-15 Sep whole farm: revenue = the priced sales rows of those days", s15.money.revenue, sum(sf.filter((x) => x.date >= "2026-09-01" && x.date <= "2026-09-15" && x.a != null).map((x) => x.a)), 0.01);
ok("1-15 Sep whole farm: breakage = the ledger breakage lines of those days", s15.eggs.breakage === sum(ded.filter((d) => d.date >= "2026-09-01" && d.date <= "2026-09-15" && d.category === "breakage").map((d) => d.eggs)));
ok("whole farm is farm-level: sales, costs and profit are present", s15.farmLevel && s15.money.costSplit && s15.money.profit != null);
ok("pooled HD % differs from the mean of the daily HD % (1-15 Sep)", s15.eggs.hdMeanOfDaily != null && Math.abs(s15.eggs.hdPooled! - s15.eggs.hdMeanOfDaily) > 0.001, `pooled ${s15.eggs.hdPooled!.toFixed(4)} vs mean ${s15.eggs.hdMeanOfDaily!.toFixed(4)}`);

// ---- 2. one flock, 1-15 Sep ----
const f15 = R("2026-09-01", "2026-09-15", [BAB3]);
const rawF = rawRows("2026-09-01", "2026-09-15", BAB3);
ok("BAB-3 1-15 Sep: eggs = its own raw rows only", f15.eggs.total === sum(rawF.map((r) => r.eggs_total ?? 0)), String(f15.eggs.total));
near("BAB-3 1-15 Sep: HD % = its own eggs ÷ its own bird-days", f15.eggs.hdPooled, (sum(rawF.map((r) => r.eggs_total ?? 0)) / sum(rawF.map((r) => r.bird_population ?? 0))) * 100);
ok("BAB-3 1-15 Sep: deaths and feed are its own", f15.birds.deaths === sum(rawF.map((r) => r.mortality ?? 0)) && f15.feed.bags === sum(rawF.map((r) => r.feed_bags ?? 0)));
ok("one flock: sales, costs, profit, ledger breakage left out (not split by flock), never zero-filled as a number to show", !f15.farmLevel && !f15.money.costSplit && f15.money.profit == null && f15.money.eggsSold === 0 && f15.eggs.breakagePct == null && f15.eggs.otherOutPct == null && f15.feed.daysLeftAtEnd == null && f15.feed.eggStockDaysAtEnd == null);
ok("one flock: the per-flock table has only that flock", f15.flocks.length === 1 && f15.flocks[0].flockId === BAB3);
ok("one flock: every alert counted is about that flock", (() => {
  const s = summarizeRange(ctx, cost, extras, makeRange("2026-09-01", "2026-10-28"), { flocks: [BAB3] });
  const all = summarizeRange(ctx, cost, extras, makeRange("2026-09-01", "2026-10-28"));
  return s.alerts.total <= all.alerts.total;
})());
const two = R("2026-09-01", "2026-09-15", [BAB3, BAB5]);
ok("two flocks = the sum of each flock (eggs, deaths, bird-days)", two.eggs.total === f15.eggs.total + R("2026-09-01", "2026-09-15", [BAB5]).eggs.total && two.birds.deaths === f15.birds.deaths + R("2026-09-01", "2026-09-15", [BAB5]).birds.deaths);
const mainIds = flockOptions(ctx).filter((o) => o.segment === "main").map((o) => o.id);
const mainSeg = summarizeRange(ctx, cost, extras, makeRange("2026-10-01", "2026-10-15"), { segment: "main" });
const mainFl = summarizeRange(ctx, cost, extras, makeRange("2026-10-01", "2026-10-15"), { flocks: mainIds });
ok("all main flocks ticked = the Main group (eggs, deaths, HD %) for 1-15 Oct", mainSeg.eggs.total === mainFl.eggs.total && mainSeg.birds.deaths === mainFl.birds.deaths && Math.abs((mainSeg.eggs.hdPooled ?? 0) - (mainFl.eggs.hdPooled ?? 0)) < 1e-9);

// ---- 3. a range = the sum of its single days ----
const days = Array.from({ length: 15 }, (_, i) => addDays("2026-09-01", i));
const singles = days.map((d) => R(d, d));
ok("range eggs = sum of the same days queried one by one", s15.eggs.total === sum(singles.map((x) => x.eggs.total)));
ok("range deaths = sum of single days", s15.birds.deaths === sum(singles.map((x) => x.birds.deaths)));
ok("range feed bags = sum of single days", s15.feed.bags === sum(singles.map((x) => x.feed.bags)));
near("range revenue = sum of single days", s15.money.revenue, sum(singles.map((x) => x.money.revenue)), 0.01);
near("range cost (so far) = sum of single days", s15.money.cost.total, sum(singles.map((x) => x.money.cost.total)), 0.01);
ok("range breakage = sum of single days", s15.eggs.breakage === sum(singles.map((x) => x.eggs.breakage)));
ok("range alerts = sum of single days", s15.alerts.total === sum(singles.map((x) => x.alerts.total)), `${s15.alerts.total}`);
const fSingles = days.map((d) => R(d, d, [BAB3]));
ok("one flock: range eggs and deaths = sum of its single days", f15.eggs.total === sum(fSingles.map((x) => x.eggs.total)) && f15.birds.deaths === sum(fSingles.map((x) => x.birds.deaths)));
ok("single-day HD % is that day's eggs ÷ birds (pooled of one day)", singles.every((x, i) => { const rs = rawRows(days[i], days[i]); const b = sum(rs.map((r) => r.bird_population ?? 0)); return Math.abs((x.eggs.hdPooled ?? 0) - (sum(rs.map((r) => r.eggs_total ?? 0)) / b) * 100) < 1e-9; }));

// ---- 4. week / month / year wrappers give exactly the V7 figures ----
const strip = (s: PeriodSummary) => JSON.stringify({ ...s, range: { from: s.range.from, to: s.range.to, days: s.range.days } });
const sep = rangeOf("month", "2026-09-01");
ok("September as a month = 1-30 Sep as a custom range (every number)", strip(summarizePeriod(ctx, cost, extras, sep)) === strip(summarizeRange(ctx, cost, extras, makeRange("2026-09-01", "2026-09-30"))));
for (const seg of ["main", "young"] as const) {
  const oct = rangeOf("month", "2026-10-01");
  ok(`October ${seg}: month wrapper = custom range with the same segment`, strip(summarizePeriod(ctx, cost, extras, oct, seg)) === strip(summarizeRange(ctx, cost, extras, makeRange(oct.from, oct.to), { segment: seg })));
}
ok("every week of September: week wrapper = custom range", weeksWithin(sep).every((w) => { const full = rangeOf("week", w.from); return strip(summarizePeriod(ctx, cost, extras, full)) === strip(summarizeRange(ctx, cost, extras, makeRange(full.from, full.to))); }));
ok("year 2026: year wrapper = 1 Jan - 31 Dec custom range", strip(summarizePeriod(ctx, cost, extras, rangeOf("year", "2026-01-01"))) === strip(summarizeRange(ctx, cost, extras, makeRange("2026-01-01", "2026-12-31"))));
const sepC = summarizeRange(ctx, cost, extras, makeRange("2026-09-01", "2026-09-30"));
ok("V7 figure through the custom range: September eggs sold 13,54,350", sepC.money.eggsSold === 1354350, String(sepC.money.eggsSold));
near("V7 figure through the custom range: September sales ₹72,67,620.30", sepC.money.revenue, 7267620.3, 0.05);
ok("summaries carry the filter: whole farm has none", sepC.flockFilter === null && f15.flockFilter?.length === 1);

// ---- 5. edge cases ----
const sw = customRange("2026-09-15", "2026-09-01");
ok("From after To: swapped, with a sentence", sw.swapped && sw.range.from === "2026-09-01" && sw.range.to === "2026-09-15" && /swapped/.test(sw.notes.join(" ")));
const one = R("2026-09-10", "2026-09-10");
ok("single-day range: 1 of 1 day, eggs per day = the day's eggs", one.daysWithData === 1 && one.range.days === 1 && one.eggs.perDay === one.eggs.total && one.dataNote === "1 of 1 day has data", one.dataNote);
ok("single-day label is one date", makeRange("2026-09-10", "2026-09-10").label === "10 Sep 2026");
ok("label across a year end names both years", makeRange("2026-12-25", "2027-01-05").label === "25 Dec 2026 – 5 Jan 2027");
// missing days: drop 10 Sep from a copy of the rows
const holed: EngineInput = { ...input, prod: input.prod.filter((r) => r.date !== "2026-09-10") };
const hctx = buildCtx(holed);
const h = summarizeRange(hctx, cost, extras, makeRange("2026-09-01", "2026-09-15"));
ok("a missing day: 14 of 15 days have data, partial", h.daysWithData === 14 && h.partial && h.dataNote === "14 of 15 days have data", h.dataNote);
near("a missing day: eggs per day uses only the 14 days with data", h.eggs.perDay, h.eggs.total / 14, 1e-9);
ok("a missing day is not filled in: total = 15-day total minus that day", h.eggs.total === s15.eggs.total - singles[9].eggs.total);
const young = R("2026-10-01", "2026-10-10", [id("BAB-10")]);
const yDays = new Set(rawRows("2026-10-01", "2026-10-10", id("BAB-10")).map((r) => r.date)).size;
ok(`a flock placed inside the range (BAB-10 from 4 Oct): ${yDays} of 10 days, averages over those only`, young.daysWithData === yDays && young.range.days === 10 && Math.abs((young.eggs.perDay ?? 0) - young.eggs.total / yDays) < 1e-9, young.dataNote);
ok("left-page flock: feed is 'not recorded', not zero", !young.feed.recorded && young.feed.gPerBirdDay == null);
const before = R("2026-06-01", "2026-06-30");
const covB = rangeCoverage(ctx, makeRange("2026-06-01", "2026-06-30"));
ok("range entirely before the data: no data, no invented numbers", before.daysWithData === 0 && before.eggs.perDay == null && before.eggs.hdPooled == null && before.money.profit == null && before.birds.opening == null, before.dataNote);
ok("range before the data says when the data starts", covB.before === 30 && /data starts on 2 Jul 2026/i.test(covB.note ?? ""), covB.note ?? "");
const last = ctx.dates[ctx.dates.length - 1];
const after = makeRange(addDays(last, -4), addDays(last, 5));
const covA = rangeCoverage(ctx, after);
ok("range past the last entered day: 5 of 10 days have data and the sentence says so", R(after.from, after.to).daysWithData === 5 && covA.after === 5 && /last entered day/.test(covA.note ?? ""), covA.note ?? "");
const cut = customRange("2026-10-01", "2026-12-31", { today: "2026-11-12" });
ok("dates after today are left out, with a sentence", cut.range.to === "2026-11-12" && /after today/.test(cut.notes.join(" ")));
const cap = customRange("2025-01-01", "2026-10-28");
ok(`more than ${MAX_RANGE_DAYS} days: the last ${MAX_RANGE_DAYS} days up to To`, cap.range.days === MAX_RANGE_DAYS && cap.range.to === "2026-10-28" && cap.range.from === addDays("2026-10-28", -(MAX_RANGE_DAYS - 1)) && /at most 366/.test(cap.notes.join(" ")));
ok("366 days exactly is allowed", customRange("2025-10-28", "2026-10-28").range.days === 366 && customRange("2025-10-28", "2026-10-28").notes.length === 0);

// ---- 6. placement / depletion inside the range ----
const old1 = id("Old BAB-1 (sold Sep)");
const o1 = R("2026-09-01", "2026-09-15", [old1]);
const o1raw = rawRows("2026-09-01", "2026-09-15", old1);
const o1sold = -sum(mvAll.filter((m) => m.flock_internal_id === old1 && m.movement_type === "sale" && m.date >= "2026-09-01" && m.date <= "2026-09-15").map((m) => m.birds_change));
ok(`a flock sold inside the range (Old BAB-1): ${o1raw.length} days with data, the 2 sales (${o1sold} birds) are movements, not deaths`, o1.daysWithData === o1raw.length && o1.birds.soldOut === o1sold && o1sold === 8399 && o1.birds.deaths === sum(o1raw.map((r) => r.mortality ?? 0)), `${o1.daysWithData} days, sold ${o1.birds.soldOut}`);
ok("Old BAB-1: birds at end = the count on its last day with data", o1.birds.closing === o1raw[o1raw.length - 1].bird_population && o1.lastDate === o1raw[o1raw.length - 1].date);
const old2 = id("Old BAB-2 (to Anil farm)");
const o2 = R("2026-09-01", "2026-09-15", [old2]);
ok("a flock moved to Anil farm inside the range (Old BAB-2): transfers are movements, not deaths", o2.birds.anilOut === 2926 + 2404 && o2.birds.deaths === sum(rawRows("2026-09-01", "2026-09-15", old2).map((r) => r.mortality ?? 0)), `anilOut ${o2.birds.anilOut}`);
const b10 = R("2026-09-25", "2026-10-10", [id("BAB-10")]);
const b10first = rawRows("2026-09-25", "2026-10-10", id("BAB-10"))[0];
ok("a flock that starts inside the range: birds at start rebuilt from its first day (count + deaths − moves)", b10.birds.opening === b10first.bird_population + (b10first.mortality ?? 0) - sum(mvAll.filter((m) => m.flock_internal_id === id("BAB-10") && m.date === b10first.date).map((m) => m.birds_change)), `${b10.birds.opening}`);

// ---- 7. a flock with a moult period (BAB-3 from 15 Aug, recorded) ----
const moult = R("2026-08-15", "2026-09-15", [BAB3]);
ok("BAB-3 15 Aug - 15 Sep is shown as moulting, not judged against the book", moult.flocks[0]?.status === "moult", moult.flocks[0]?.statusNote);
const mA = compareSide(ctx, cost, extras, { key: "a", flockId: BAB3, flockLabel: "BAB-3", range: makeRange("2026-09-01", "2026-09-15"), notes: [] });
ok("Compare names the moult days (the book assumes no moult)", mA.book.moultDays > 0 && compareRows(mA, mA).find((r) => r.key === "book")!.note?.includes("Moulting") === true, `moult days ${mA.book.moultDays}`);

// ---- 8. Compare ----
const st = readCompare(ctx, { a: "BAB-3", af: "2026-09-01", at: "2026-09-15", b: "BAB-5", bf: "2026-10-01", bt: "2026-10-15", age: "0" }, "2026-11-12");
ok("compare reads the address: BAB-3 1-15 Sep against BAB-5 1-15 Oct", st.a.flockId === BAB3 && st.b.flockId === BAB5 && st.a.range.from === "2026-09-01" && st.b.range.to === "2026-10-15" && !st.age);
const A = compareSide(ctx, cost, extras, st.a);
const B = compareSide(ctx, cost, extras, st.b);
ok("each column is its own engine call: A = summarizeRange(BAB-3, its dates), B = summarizeRange(BAB-5, its dates)", strip(A.s) === strip(R("2026-09-01", "2026-09-15", [BAB3])) && strip(B.s) === strip(R("2026-10-01", "2026-10-15", [BAB5])));
const rows = compareRows(A, B);
const row = (k: string) => rows.find((r) => r.key === k)!;
ok("difference = B − A", Math.abs(row("eggsDay").diff! - (B.s.eggs.perDay! - A.s.eggs.perDay!)) < 1e-9 && Math.abs(row("hd").diff! - (B.s.eggs.hdPooled! - A.s.eggs.hdPooled!)) < 1e-9);
ok("difference % = (B − A) ÷ A", Math.abs(row("eggsDay").diffPct! - ((B.s.eggs.perDay! - A.s.eggs.perDay!) / A.s.eggs.perDay!) * 100) < 1e-9);
ok("more eggs is better, more deaths is worse", row("eggsDay").good === (row("eggsDay").diff! > 0) && row("deathsPct").good === (row("deathsPct").diff! < 0));
ok("days, ages and bird counts have no better or worse", ["days", "daysData", "ageStart", "ageEnd", "birdsStart", "birdsEnd", "feedG", "book"].every((k) => row(k).good === null && row(k).direction === "none"));
ok("one flock: breakage, revenue per egg and profit are 'not split by flock'", ["breakPct", "otherPct", "rpe", "profit", "profitDay"].every((k) => row(k).a == null && row(k).b == null && row(k).aNote === "not split by flock"));
const Aall = compareSide(ctx, cost, extras, { key: "a", flockId: null, flockLabel: "All flocks", range: makeRange("2026-09-01", "2026-09-15"), notes: [] });
ok("All flocks: revenue per egg, profit and breakage are shown", compareRows(Aall, Aall).find((r) => r.key === "rpe")!.a != null && compareRows(Aall, Aall).find((r) => r.key === "breakPct")!.a != null && compareRows(Aall, Aall).find((r) => r.key === "book")!.a == null);
const same = compareRows(A, compareSide(ctx, cost, extras, { ...st.a, key: "b" }));
ok("two identical selections: every difference is 0 (or blank) and nothing is better or worse", same.every((r) => (r.diff == null || r.diff === 0) && r.good === null));
const Bshort = compareSide(ctx, cost, extras, { key: "b", flockId: BAB5, flockLabel: "BAB-5", range: makeRange("2026-10-01", "2026-10-10"), notes: [] });
const uneq = compareRows(A, Bshort);
ok("different number of days: totals get no better/worse and a sentence; per-day rows still do", uneq.find((r) => r.key === "eggs")!.good === null && /different number of days/.test(uneq.find((r) => r.key === "eggs")!.note ?? "") && uneq.find((r) => r.key === "eggsDay")!.good !== null);
const oa = overlaySeries(A), ob = overlaySeries(Bshort);
ok("chart series are day 1..N of each range (15 and 10); the chart draws the shorter length", oa.length === 15 && ob.length === 10 && oa[0].date === "2026-09-01" && ob[9].date === "2026-10-10");
const bk = A.book;
ok("breeder's standard over the range is weighted by birds over the same rows", bk.hd != null && bk.days > 0 && (() => {
  const rs = (ctx.byFlock.get(BAB3) ?? []).filter((r) => r.date >= "2026-09-01" && r.date <= "2026-09-15");
  let w = 0, sw2 = 0;
  for (const r of rs) { const age = Math.floor((Date.parse(r.date) - Date.parse(ctx.flockById.get(BAB3)!.placementDate!)) / 86400000 / 7); const s = ctx.stdByAge.get(age); if (s != null) { w += r.pop!; sw2 += s * r.pop!; } }
  return Math.abs(sw2 / w - bk.hd!) < 1e-9;
})());
const age7 = ageOn(ctx, id("BAB-7"), "2026-10-01")!;
ok("age = days since placement, week = whole weeks (the age the book is read at)", age7.days === Math.round((Date.parse("2026-10-01") - Date.parse(ctx.flockById.get(id("BAB-7"))!.placementDate!)) / 86400000) && age7.weeks === Math.floor(age7.days / 7));
const wr = weeksToRange(ctx, id("BAB-7"), 34, 39)!;
ok("weeks 34-39 of age = 42 days starting on day 238 after placement", wr.days === 42 && ageOn(ctx, id("BAB-7"), wr.from)!.days === 238 && ageOn(ctx, id("BAB-7"), wr.to)!.weeks === 39 && ageOn(ctx, id("BAB-7"), addDays(wr.to, 1))!.weeks === 40);
const ag = readCompare(ctx, { a: "BAB-7", b: "BAB-8", age: "1" }, "2026-11-12");
const span = dataWeeks(ctx, id("BAB-8"))!;
ok("align by age: default = the last 6 weeks both flocks have data for, same weeks in both columns", ag.age && ag.weeks!.to - ag.weeks!.from === 5 && ag.weeks!.to <= Math.min(dataWeeks(ctx, id("BAB-7"))!.to, span.to) && ageOn(ctx, id("BAB-7"), ag.a.range.from)!.weeks === ag.weeks!.from && ageOn(ctx, id("BAB-8"), ag.b.range.from)!.weeks === ag.weeks!.from);
const noCommon = readCompare(ctx, { a: "BAB-4", b: "BAB-6", age: "1", wf: "60", wt: "62" }, "2026-11-12");
ok("align by age with no week in common says so", /no week of age in common/.test(noCommon.notes.join(" ")));
ok("presets: 'Same flock, two periods' puts the days just before in A", (() => { const p = presets(ctx, st)[0]; const q = new URLSearchParams(p.href.split("?")[1]); return q.get("a") === "BAB-3" && q.get("b") === "BAB-3" && q.get("at") === "2026-08-31" && q.get("af") === "2026-08-17"; })());
ok("presets: 'Two flocks, different dates' = A one month earlier", (() => { const p = presets(ctx, st)[2]; const q = new URLSearchParams(p.href.split("?")[1]); return q.get("af") === "2026-08-01" && q.get("at") === "2026-08-15" && q.get("bf") === "2026-09-01"; })());
ok("addMonths clamps at the month end", addMonths("2026-10-31", -1) === "2026-09-30" && addMonths("2026-03-31", -1) === "2026-02-28" && addMonths("2026-01-15", -1) === "2025-12-15");

// ---- 9. the address and the chips ----
const rr = readRange(ctx, { from: "2026-09-15", to: "2026-09-01", f: ["BAB-3,BAB-5", "nobody"] }, "2026-11-12");
ok("address: dates swapped with a sentence, flocks by name (comma or repeated), unknown name left out with a sentence", rr.range.from === "2026-09-01" && rr.flockIds.length === 2 && rr.notes.some((n) => /swapped/.test(n)) && rr.notes.some((n) => /nobody/.test(n)));
const d = readRange(ctx, {}, "2026-11-12");
const last14 = lastDaysWithData(ctx, 14)!;
ok("no dates = the last 14 days with data", d.isDefault && d.range.from === last14.from && d.range.to === last && defaultRange(ctx, "2026-11-12").to === last && new Set(ctx.dates.filter((x) => x >= d.range.from && x <= d.range.to)).size === 14);
const chips = quickRanges(ctx, "2026-11-12");
const chip = (k: string) => chips.find((c) => c.key === k)!.range;
ok("chips: Last 7 days ends on the last entered day and has 7 days of data", chip("last7").to === last && ctx.dates.filter((x) => x >= chip("last7").from && x <= chip("last7").to).length === 7);
ok("chips: This month = 1 Nov to today, Last month = all of October, Since 1 Aug to the last entered day", chip("thismonth").from === "2026-11-01" && chip("thismonth").to === "2026-11-12" && chip("lastmonth").from === "2026-10-01" && chip("lastmonth").to === "2026-10-31" && chip("sinceaug").from === "2026-08-01" && chip("sinceaug").to === last);
ok("preceding range has the same length and ends the day before", (() => { const p = precedingRange(makeRange("2026-09-01", "2026-09-15")); return p.from === "2026-08-17" && p.to === "2026-08-31" && p.days === 15; })());
ok("custom ranges shift by their own length", shiftRange(makeRange("2026-09-01", "2026-09-15"), 1).from === "2026-09-16");
ok("ranges over 120 days are cut into months, shorter ones into weeks", partsWithin(makeRange("2026-06-01", "2026-10-31")).unit === "month" && partsWithin(makeRange("2026-07-02", "2026-10-28")).unit === "week" && partsWithin(makeRange("2026-09-01", "2026-09-30")).unit === "week");
ok("month pieces of a long range add up to the range (eggs)", (() => { const r = makeRange("2026-06-01", "2026-10-31"); return sum(partsWithin(r).parts.map((p) => summarizeRange(ctx, cost, extras, p).eggs.total)) === summarizeRange(ctx, cost, extras, r).eggs.total; })());

process.exit(bad ? 1 : 0);
