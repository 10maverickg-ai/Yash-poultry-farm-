// V18: FCR = kg of feed ÷ kg of eggs on the exported real rows.   npx tsx scripts/fcr-check.mts <fixture-dir>
// Expected values are worked out straight from the raw rows and the BV300 table (no engine).
/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows are untyped JSON dumps */
import { readFileSync } from "node:fs";
import { loadInput } from "./fixtureInput.mts";
import { alertsFor, buildCtx, diffDays, RULES, type EngineInput } from "../lib/analytics/engine";
import { boardFcr, eggWeightFor, fcrLabel, fcrOf, fcrOn, fcrTrend, flockFcr, ACTUAL_WEIGHT_DAYS } from "../lib/analytics/fcr";
import { effOn } from "../lib/analytics/feedEfficiency";
import { makeRange, rangeOf, summarizePeriod, summarizeRange, type PeriodExtras } from "../lib/analytics/period";
import { BAG_KG, type CostInput } from "../lib/costs/engine";

const dir = process.argv[2];
const j = (n: string) => JSON.parse(readFileSync(`${dir}/${n}.json`, "utf8"));
const input = loadInput(dir);
const ctx = buildCtx(input);
const dp: any[] = j("dp");
const bv: any[] = j("bv");
const flocks: any[] = j("flocks");
const segOf = new Map<string, string>(flocks.map((f) => [f.flock_internal_id, f.segment]));
const placed = new Map<string, string>(flocks.map((f) => [f.flock_internal_id, f.placement_date]));
const idOf = (label: string) => flocks.find((f) => f.display_label === label)?.flock_internal_id as string;
const extras: PeriodExtras = { sales: [], deductions: [], birdSales: [] };
const cost: CostInput = { settings: [], purchases: [], diesel: [], prod: [], sales: [], birdSales: [] };

let bad = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (!cond) bad++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); };
const near = (name: string, got: number | null | undefined, want: number | null, tol = 1e-9) => ok(name, got != null && want != null && Math.abs(got - want) <= tol, `got ${got} want ${want}`);
const has = (d: string) => ctx.dates.includes(d);

/** By hand: feed kg ÷ Σ(eggs × book egg weight of the flock's week) over rows with feed and a book weight; standard FCR the same way. */
const byHand = (pred: (r: any) => boolean) => {
  let feedKgAll = 0, eggsAll = 0, feedKg = 0, eggKg = 0, sFeed = 0, sEgg = 0, left = 0;
  for (const r of dp.filter((x) => pred(x) && x.feed_bags != null)) {
    feedKgAll += r.feed_bags * 45;
    eggsAll += r.eggs_total ?? 0;
    const week = Math.floor(diffDays(r.date, placed.get(r.flock_internal_id)!) / 7);
    const b = bv.find((x) => x.age_weeks === week);
    if (!b || b.egg_weight_g == null) { left++; continue; }
    feedKg += r.feed_bags * 45;
    eggKg += ((r.eggs_total ?? 0) * Number(b.egg_weight_g)) / 1000;
    sFeed += ((r.eggs_total ?? 0) * Number(b.current_feed_per_egg_g)) / 1000;
    sEgg += ((r.eggs_total ?? 0) * Number(b.egg_weight_g)) / 1000;
  }
  return { fcr: eggKg > 0 ? feedKg / eggKg : null, std: sEgg > 0 ? sFeed / sEgg : null, feedPerEgg: eggsAll > 0 ? (feedKgAll * 1000) / eggsAll : null, left };
};
const mainOn = (from: string, to: string) => (r: any) => r.date >= from && r.date <= to && segOf.get(r.flock_internal_id) === "main";

ok("the bag weight is the existing constant (45 kg)", BAG_KG === 45);

// ---- main flocks, 13-19 Nov (the by-hand week check) ----
if (has("2026-11-13") && has("2026-11-19")) {
  const h = byHand(mainOn("2026-11-13", "2026-11-19"));
  const b = boardFcr(ctx, "2026-11-19", "main");
  near("13-19 Nov main: FCR = feed kg ÷ (eggs × standard egg weight of each flock's week), by hand", b.week.fcr, h.fcr);
  near("13-19 Nov main: standard FCR = Σ eggs × book feed per egg ÷ Σ eggs × book egg weight, by hand", b.week.standardFcr, h.std);
  near("13-19 Nov main: feed g per egg = feed kg × 1000 ÷ eggs (exact, all flock-days with feed)", b.week.feedPerEggG, h.feedPerEgg);
  ok("13-19 Nov main: BAB-4 (week 118) has no book egg weight: its 7 flock-days are left out and the reason is given", h.left === 7 && /past the end of the breeder's egg-weight table/.test(b.week.leftOut ?? ""), b.week.leftOut ?? "");
  const wk = summarizeRange(ctx, cost, extras, makeRange("2026-11-13", "2026-11-19"), { segment: "main" });
  near("the period engine (custom range) gives the same FCR", wk.feed.fcrEstimated, h.fcr);
  near("the period engine's gap = FCR − standard", wk.feed.fcrGap, h.fcr! - h.std!);
  ok("feed g per egg × eggs per kg of feed (V17) = 1000: the two always agree", Math.abs(wk.feed.feedPerEggG! * wk.feed.eggsPerKg! - 1000) < 1e-9);
  ok("eggs per kg of feed from V17 and from the FCR module agree", Math.abs((effOn(ctx, ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"], "main").eggsPerKg ?? 0) - (b.week.eggsPerKg ?? -1)) < 1e-9);
  ok("labelled 'FCR (estimated from standard egg weight)'", fcrLabel(b.week) === "FCR (estimated from standard egg weight)" && wk.feed.fcrLabel === "FCR (estimated from standard egg weight)");
  const daily = Array.from({ length: 7 }, (_, i) => byHand(mainOn(`2026-11-${13 + i}`, `2026-11-${13 + i}`)).fcr!);
  const mean = daily.reduce((s, x) => s + x, 0) / 7;
  ok("pooled FCR is not the average of the daily FCRs", Math.abs(mean - h.fcr!) > 1e-6, `pooled ${h.fcr!.toFixed(5)} vs mean ${mean.toFixed(5)}`);
  near("19 Nov main, the day: by hand", b.day.fcr, byHand(mainOn("2026-11-19", "2026-11-19")).fcr);
  ok("the change against the 7 days before: lower FCR = good", b.change != null && b.change.good === (b.week.fcr! < b.prevWeek.fcr!));
}

// ---- week / month / year wrappers ----
const nov = summarizePeriod(ctx, cost, extras, rangeOf("month", "2026-11-01"), "main");
near("November (month view) main = by hand", nov.feed.fcrEstimated, byHand(mainOn("2026-11-01", "2026-11-30")).fcr);
const yr = summarizePeriod(ctx, cost, extras, rangeOf("year", "2026-01-01"), "main");
near("year 2026 main = by hand", yr.feed.fcrEstimated, byHand(mainOn("2026-01-01", "2026-12-31")).fcr);

// ---- one flock ----
const b5 = idOf("BAB-5");
const f5 = summarizeRange(ctx, cost, extras, makeRange("2026-11-13", "2026-11-19"), { flocks: [b5] });
const h5 = byHand((r) => r.flock_internal_id === b5 && r.date >= "2026-11-13" && r.date <= "2026-11-19");
near("one flock (BAB-5, 13-19 Nov) = by hand", f5.feed.fcrEstimated, h5.fcr);
near("the per-flock table row = the same", f5.flocks[0]?.fcrEstimated, h5.fcr);
near("the flock card (last 7 rows to 19 Nov) = the same", flockFcr(ctx, b5, "2026-11-19").week.fcr, h5.fcr);
near("standard FCR of one flock = by hand", f5.flocks[0]?.standardFcr, h5.std);

// ---- a flock with a missing-feed day: BAB-9, 13-19 Nov (no feed on 19 Nov) ----
const b9 = idOf("BAB-9");
const f9 = summarizeRange(ctx, cost, extras, makeRange("2026-11-13", "2026-11-19"), { flocks: [b9] });
near("BAB-9 13-19 Nov: 19 Nov (no feed) is left out of both sides", f9.feed.fcrEstimated, byHand((r) => r.flock_internal_id === b9 && r.date >= "2026-11-13" && r.date <= "2026-11-19").fcr);
ok("BAB-9 13-19 Nov: 6 of 7 days with feed", f9.feed.daysRecorded === 6 && f9.daysWithData === 7);
ok("BAB-9 on 19 Nov alone: no FCR, the reason is 'feed not recorded'", flockFcr(ctx, b9, "2026-11-19").day.fcr === null && /feed not recorded/.test(flockFcr(ctx, b9, "2026-11-19").day.why ?? ""));

// ---- a range with no feed at all ----
const none = summarizeRange(ctx, cost, extras, makeRange("2026-10-05", "2026-10-15"), { flocks: [b9] });
ok("a range with no feed (BAB-9, 5-15 Oct): FCR, feed per egg and standard are empty, with the reason", none.feed.fcrEstimated === null && none.feed.feedPerEggG === null && /feed not recorded/.test(none.feed.fcrWhy ?? ""), none.feed.fcrWhy ?? "");

// ---- a breed with no egg-weight reference (made-up Bovans White copy of BAB-6) ----
const b6 = idOf("BAB-6");
const bovans: EngineInput = { ...input, flocks: input.flocks.map((f) => (f.id === b6 ? { ...f, breed: "Bovans White" } : f)) };
const cb = buildCtx(bovans);
const fb = flockFcr(cb, b6, "2026-11-19").week;
ok("a Bovans White flock: no FCR number, the reason 'no egg-weight reference loaded for Bovans White'", fb.fcr === null && /no egg-weight reference loaded for Bovans White/.test(fb.why ?? ""), fb.why ?? "");
ok("…but its feed per egg (no egg weight needed) is still exact", fb.feedPerEggG != null);
ok("(in the real data BAB-6 is BV300, so it gets a number)", flockFcr(ctx, b6, "2026-11-19").week.fcr != null && ctx.flockById.get(b6)?.breed === "BV300");

// ---- an actual egg weight is preferred over the standard (B3) ----
if (has("2026-11-19")) {
  const withActual: EngineInput = { ...input, eggWeights: [{ flockId: b5, date: "2026-11-15", grams: 62 }] };
  const ca = buildCtx(withActual);
  ok(`an actual weight is used on that day and the ${ACTUAL_WEIGHT_DAYS - 1} days after, then the standard again`, eggWeightFor(ca, b5, "2026-11-15").source === "actual" && eggWeightFor(ca, b5, "2026-11-21").source === "actual" && eggWeightFor(ca, b5, "2026-11-22").source === "standard" && eggWeightFor(ca, b5, "2026-11-14").source === "standard");
  const rows = (ca.byFlock.get(b5) ?? []).filter((r) => r.date >= "2026-11-15" && r.date <= "2026-11-19");
  const fa = fcrOf(ca, rows);
  const feedKg = rows.reduce((s, r) => s + (r.feed ?? 0), 0) * 45;
  const eggKg = rows.reduce((s, r) => s + (r.eggs ?? 0), 0) * 0.062;
  near("FCR with the actual weight = feed kg ÷ (eggs × 62 g)", fa.fcr, feedKg / eggKg);
  ok("the label says 'actual egg weight'", fcrLabel(fa) === "FCR (actual egg weight)");
  ok("a period mixing actual and standard says so", /actual egg weight on \d+ flock-days, standard on \d+/.test(fcrLabel(fcrOf(ca, (ca.byFlock.get(b5) ?? []).filter((r) => r.date >= "2026-11-10" && r.date <= "2026-11-19")))));
}

// ---- trend and the empty cases ----
if (has("2026-11-19")) {
  const t = fcrTrend(ctx, "2026-11-19", "main", 30);
  ok("trend: 30 days to 19 Nov, the last point = the day, the dashed line = the 7-day value", t.length === 30 && Math.abs(t[29].value! - boardFcr(ctx, "2026-11-19", "main").day.fcr!) < 1e-9 && Math.abs(t[29].avg7! - boardFcr(ctx, "2026-11-19", "main").week.fcr!) < 1e-9);
}
ok("no rows = null with a reason", fcrOn(ctx, [], "main").fcr === null && !!fcrOn(ctx, [], "main").why);
ok("zero eggs on the days with feed = null, not infinity", fcrOf(ctx, [{ date: "2026-11-19", flockId: b5, eggs: 0, feed: 10 }]).fcr === null);

// ---- B4 alert: "Feed is giving fewer egg kilos than normal" ----
ok("the alert rule: 5% worse than the 7 days before, or 10% worse than the book, at least 5 of 7 days with feed, repeated at most every 7 days", RULES.fcrTrendPct === 5 && RULES.fcrStdPct === 10 && RULES.effMinFeedDays === 5 && RULES.fcrRepeatDays === 7);
const fa = (c: typeof ctx, d: string) => alertsFor(c, d).filter((a) => a.kind === "fcr");
const all: { date: string; seg: string | null; reason: string }[] = [];
for (const d of ctx.dates) for (const a of fa(ctx, d)) all.push({ date: a.date, seg: a.segment, reason: a.reason });
ok("never before 1 Sep, never for the young group (ramping-up flocks are not compared with the book)", all.every((a) => a.date >= "2026-09-01" && a.seg === "main"), all.map((a) => a.date).join(", "));
let gapOk = true;
for (let i = 1; i < all.length; i++) if (diffDays(all[i].date, all[i - 1].date) < RULES.fcrRepeatDays) gapOk = false;
ok("not a daily alert: never twice within 7 days for the same group", gapOk, `${all.length} alerts`);
if (has("2026-11-13")) {
  const a13 = fa(ctx, "2026-11-13");
  ok("13 Nov: raised again (the problem started 6 Nov and is still there): it says how long", a13.length === 1 && /It has lasted 8 days/.test(a13[0].reason) && /FCR \d\.\d\d in the last 7 days/.test(a13[0].reason), a13[0]?.reason.slice(0, 120));
  ok("…and on the days in between it stays quiet (7-12 Nov)", ["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"].every((d) => fa(ctx, d).length === 0));
  ok("the words name the likely checks and that FCR is estimated", /Likely checks: feed waste/.test(a13[0].reason) && /weigh a sample of eggs/.test(a13[0].reason) && /estimated from the standard egg weight/.test(a13[0].reason));
}
if (has("2026-09-19")) {
  const s19 = fa(ctx, "2026-09-19");
  ok("19 Sep: raised for being more than 10% worse than the book, BAB-3 (moulting) left out", s19.length === 1 && /vs the book's/.test(s19[0].reason) && /BAB-3 \(moulting\) left out/.test(s19[0].reason), s19[0]?.reason.slice(0, 140));
}
// a made-up farm where the feed stays the same but the main flocks lay 20% fewer eggs from 13 Nov: the alert starts on 13 Nov
const quiet: EngineInput = { ...input, prod: input.prod.filter((r) => r.date <= "2026-11-19") };
const cut: EngineInput = { ...quiet, prod: quiet.prod.map((r) => (r.date >= "2026-11-13" && segOf.get(r.flockId) === "main" && r.eggs != null ? { ...r, eggs: Math.round(r.eggs * 0.8) } : r)) };
const cc = buildCtx(cut);
ok("a made-up 20% egg drop from 13 Nov raises the FCR alert within the week", ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"].some((d) => fa(cc, d).length > 0));

process.exit(bad ? 1 : 0);
