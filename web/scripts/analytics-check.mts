// Runs the analytics engine over exported copies of the real rows and prints
// every alert per day, so a rule can be checked against what actually
// happened. Fixtures are JSON dumps of the live tables (never committed:
// operational data) — see the PR description for the exact export queries.
//
//   node scripts/analytics-check.mts <fixture-dir> [from] [to]
//
// Needs Node >= 22.18 (runs the TypeScript engine directly, no build step).
/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows are untyped JSON dumps */
import { readFileSync, existsSync } from "node:fs";
import {
  buildCtx,
  alertsFor,
  farmToday,
  flockCards,
  watchList,
  monthView,
  moultOn,
  addDays,
  type EngineInput,
} from "../lib/analytics/engine.ts";

const dir = process.argv[2];
if (!dir) throw new Error("usage: analytics-check.mts <fixture-dir> [from] [to]");
const j = (n: string) => JSON.parse(readFileSync(`${dir}/${n}.json`, "utf8"));
const num = (x: unknown) => (x == null ? null : Number(x));

const junction: { feed_bag_stock_id: number; flock_internal_id: string }[] = j("junction");
const input: EngineInput = {
  flocks: j("flocks").map((f: any) => ({
    id: f.flock_internal_id,
    label: f.display_label,
    breed: f.breed,
    placementDate: f.placement_date,
    placementConfirmed: false,
  })),
  prod: j("dp").map((r: any) => ({
    id: r.id,
    date: r.date,
    flockId: r.flock_internal_id,
    label: r.lbl,
    mort: num(r.mortality),
    feed: num(r.feed_bags),
    eggs: num(r.eggs_total),
    pop: num(r.bird_population),
    hd: num(r.hd_percent),
    flagged: r.flagged,
    reviewed: r.reviewed_by_owner,
  })),
  movements: j("movements").map((m: any) => ({
    id: m.id,
    date: m.date,
    flockId: m.flock_internal_id,
    change: m.birds_change,
    type: m.movement_type,
    needsReview: m.needs_review,
    reviewed: m.reviewed_by_owner,
  })),
  egg: j("egg").map((e: any) => ({
    id: e.id,
    date: e.date,
    section: e.section,
    produced: num(e.tp),
    opening: num(e.ob),
    closing: num(e.cb),
    reviewed: e.reviewed_by_owner,
  })),
  feedBoxes: j("feedbox").map((b: any) => ({
    id: b.id,
    date: b.date,
    group: b.g,
    opening: num(b.ob),
    produced: num(b.prod),
    consumed: num(b.cons),
    closing: num(b.cb),
    reviewed: b.reviewed_by_owner,
    flockIds: junction.filter((x) => x.feed_bag_stock_id === b.id).map((x) => x.flock_internal_id),
  })),
  moulting: existsSync(`${dir}/moulting.json`) ? j("moulting").map((m: any) => ({ flockId: m.flock_internal_id, start: m.start_date, end: m.end_date, confirmed: m.confirmed_by_owner })) : [],
  chick: j("chick").map((c: any) => ({ date: c.date, deaths: Number(c.d) })),
  std: j("bv").map((b: any) => ({ age: b.age_weeks, hdp: Number(b.std_hdp_percent) })),
};

if (process.argv.includes("--selftest")) {
  // Negative tests: break a copy of the real data in one specific way and
  // confirm the matching alert fires (and that suppressions hold).
  const run = (name: string, mutate: (i: EngineInput) => void, date: string, kind: string, expectLabel?: string) => {
    const i: EngineInput = structuredClone(input);
    mutate(i);
    const hits = alertsFor(buildCtx(i), date).filter((a) => a.kind === kind && (!expectLabel || a.flockLabel === expectLabel));
    console.log(`${hits.length > 0 ? "PASS" : "FAIL"}  ${name}${hits[0] ? "\n        " + hits[0].reason : ""}`);
    if (!hits.length) process.exitCode = 1;
  };
  const absent = (name: string, mutate: (i: EngineInput) => void, date: string, kind: string, flockId?: string) => {
    const i: EngineInput = structuredClone(input);
    mutate(i);
    const hits = alertsFor(buildCtx(i), date).filter((a) => a.kind === kind && (!flockId || a.flockId === flockId));
    console.log(`${hits.length === 0 ? "PASS" : "FAIL"}  ${name}`);
    if (hits.length) process.exitCode = 1;
  };
  const BAB2OLD = "1aa49f29-795e-4983-864a-16265a5cfa21";
  const MOULTER = "d6b2f7b4-6821-4e6a-8e22-3709f6944eb2";
  const row = (i: EngineInput, flock: string, date: string) => i.prod.find((r) => r.flockId === flock && r.date === date)!;
  run("bird-count anomaly: drop the Aug 28 sale record (-2,967)", (i) => { i.movements = i.movements.filter((m) => !(m.flockId === BAB2OLD && m.date === "2026-08-28")); }, "2026-08-28", "bird_count_anomaly");
  run("bird-count anomaly: change a count by 40 with no movement", (i) => { row(i, "0d0bedaf-f96a-49fa-ac15-d711483d700f", "2026-09-20").pop! -= 40; }, "2026-09-20", "bird_count_anomaly");
  run("high mortality: 40 deaths on a 0.1%+ flock (>= 5 deaths)", (i) => { row(i, "0d0bedaf-f96a-49fa-ac15-d711483d700f", "2026-09-20").mort = 40; }, "2026-09-20", "high_mortality");
  absent("high mortality: same spike suppressed once reviewed_by_owner", (i) => { const r = row(i, "0d0bedaf-f96a-49fa-ac15-d711483d700f", "2026-09-20"); r.mort = 40; r.reviewed = true; }, "2026-09-20", "high_mortality");
  absent("high mortality: 4 deaths on a tiny flock is under the 5-death floor (BAB-9 flock 2.8x)", (i) => { row(i, "a5ad04ae-0b5b-4a7b-aa55-4f334394c625", "2026-08-30").mort = 4; }, "2026-08-30", "high_mortality", "a5ad04ae-0b5b-4a7b-aa55-4f334394c625");
  absent("high mortality: 2.3x own average but only 0.06% of an 11,000-bird flock (7 deaths)", (i) => { row(i, "0d0bedaf-f96a-49fa-ac15-d711483d700f", "2026-09-20").mort = 7; }, "2026-09-20", "high_mortality");
  run("feed anomaly: 0 bags with live birds, not moulting", (i) => { row(i, "0d0bedaf-f96a-49fa-ac15-d711483d700f", "2026-09-12").feed = 0; }, "2026-09-12", "feed_anomaly");
  absent("feed anomaly: 0 bags suppressed while the flock is moulting (d6b2, Sep 12)", (i) => { row(i, MOULTER, "2026-09-12").feed = 0; }, "2026-09-12", "feed_anomaly", MOULTER);
  run("feed anomaly: feed box consumed vs flock rows", (i) => { const b = i.feedBoxes.find((x) => x.date === "2026-09-12")!; b.consumed! += 9; }, "2026-09-12", "feed_anomaly");
  run("production drop: 3 points on 2 consecutive days", (i) => { for (const d of ["2026-09-19", "2026-09-20"]) { const r = row(i, "0d0bedaf-f96a-49fa-ac15-d711483d700f", d); r.hd = r.hd! - 4; } }, "2026-09-20", "production_drop");
  absent("production drop: a single 3.5-point dip is not an alert", (i) => { const r = row(i, "0d0bedaf-f96a-49fa-ac15-d711483d700f", "2026-09-20"); r.hd = r.hd! - 3.5; }, "2026-09-20", "production_drop", "0d0bedaf-f96a-49fa-ac15-d711483d700f");
  run("production drop: HD down 10 points", (i) => { const r = row(i, "0d0bedaf-f96a-49fa-ac15-d711483d700f", "2026-09-20"); r.hd = r.hd! - 10; }, "2026-09-20", "production_drop");
  absent("production drop: BAB-5's flock during its moult (Aug 18-26)", () => {}, "2026-08-18", "production_drop", MOULTER);
  run("missing day: a live flock has no row on Sep 12", (i) => { i.prod = i.prod.filter((r) => !(r.flockId === "0d0bedaf-f96a-49fa-ac15-d711483d700f" && r.date === "2026-09-12")); }, "2026-09-12", "missing_day");
  run("missing day: no rows at all on Sep 12", (i) => { i.prod = i.prod.filter((r) => r.date !== "2026-09-12"); }, "2026-09-12", "missing_day");
  absent("missing day: a flock that left (movement to zero) is not 'missing' (BAB-2 old flock, Sep 4)", () => {}, "2026-09-04", "missing_day", BAB2OLD);
  run("low feed stock: 60 bags at 157/day is < 0.5 day", (i) => { for (const b of i.feedBoxes.filter((x) => x.date === "2026-09-30")) b.closing = 60; }, "2026-09-30", "low_feed_stock");
  absent("low feed stock: ~1 day of stock (169 bags at 157/day) is normal for this farm", () => {}, "2026-09-30", "low_feed_stock");
  run("low feed stock: feed received below consumption 3 days running", (i) => { for (const b of i.feedBoxes.filter((x) => ["2026-09-28", "2026-09-29", "2026-09-30"].includes(x.date))) b.produced = 50; }, "2026-09-30", "low_feed_stock");
  run("egg build-up: 242k eggs vs 50k/day", () => {}, "2026-09-30", "egg_buildup");
  absent("egg build-up: 80k eggs in stock is fine", (i) => { for (const e of i.egg.filter((x) => x.date === "2026-09-30")) e.closing = 40000; }, "2026-09-30", "egg_buildup");
  process.exit(process.exitCode ?? 0);
}

const ctx = buildCtx(input);
const from = process.argv[3] ?? ctx.dates[0];
const to = process.argv[4] ?? ctx.dates[ctx.dates.length - 1];

const counts: Record<string, number> = {};
for (let d = from; d <= to; d = addDays(d, 1)) {
  for (const a of alertsFor(ctx, d)) {
    counts[a.kind] = (counts[a.kind] ?? 0) + 1;
    console.log(`${d} ${a.kind.padEnd(18)} ${(a.flockLabel ?? "farm").padEnd(7)} ${a.reason}`);
  }
}
console.log("\nALERT COUNTS", from, "→", to, counts);

if (process.env.CARDS) {
  const asOf = to;
  console.log("\nFARM TODAY", JSON.stringify(farmToday(ctx, asOf), null, 1));
  for (const c of flockCards(ctx, asOf)) console.log(c.status.padEnd(12), c.label.padEnd(7), c.flockId.slice(0, 4), c.statusNote);
  console.log("\nWATCH", watchList(ctx, asOf));
  console.log("\nMONTH", JSON.stringify(monthView(ctx, asOf.slice(0, 7)), null, 1));
  for (const [id] of ctx.byFlock) {
    const firstMoult = ctx.dates.filter((d) => moultOn(ctx, id, d));
    if (firstMoult.length) console.log("MOULT", id.slice(0, 4), firstMoult[0], "→", firstMoult[firstMoult.length - 1], firstMoult.length, "days");
  }
}
