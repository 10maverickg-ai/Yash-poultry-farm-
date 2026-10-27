// Runs the analytics engine over exported copies of the real rows and prints
// every alert per day, so a rule can be checked against what actually
// happened. Fixtures are JSON dumps of the live tables (never committed:
// operational data) — see the PR description for the exact export queries.
//
//   node scripts/analytics-check.mts <fixture-dir> [from] [to]
//
// Needs Node >= 22.18 (runs the TypeScript engine directly, no build step).
import { loadInput } from "./fixtureInput.mts";
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
const INCLUDE_CLEARED = process.argv.includes("--include-cleared");
if (!dir) throw new Error("usage: analytics-check.mts <fixture-dir> [from] [to]");

const input = loadInput(dir);

if (process.argv.includes("--selftest")) {
  // Negative tests: break a copy of the real data in one specific way and
  // confirm the matching alert fires (and that suppressions hold).
  const run = (name: string, mutate: (i: EngineInput) => void, date: string, kind: string, expectLabel?: string) => {
    const i: EngineInput = structuredClone(input);
    mutate(i);
    const hits = alertsFor(buildCtx(i), date, { includeCleared: true }).filter((a) => a.kind === kind && (!expectLabel || a.flockLabel === expectLabel));
    console.log(`${hits.length > 0 ? "PASS" : "FAIL"}  ${name}${hits[0] ? "\n        " + hits[0].reason : ""}`);
    if (!hits.length) process.exitCode = 1;
  };
  const absent = (name: string, mutate: (i: EngineInput) => void, date: string, kind: string, flockId?: string) => {
    const i: EngineInput = structuredClone(input);
    mutate(i);
    const hits = alertsFor(buildCtx(i), date, { includeCleared: true }).filter((a) => a.kind === kind && (!flockId || a.flockId === flockId));
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
  const setClosing = (i: EngineInput, date: string, total: number) => { for (const e of i.egg.filter((x) => x.date === date)) e.closing = e.section === "big" ? total : 0; };
  run("egg build-up: stock above 5 days (400k eggs vs ~50k/day)", (i) => setClosing(i, "2026-09-30", 400000), "2026-09-30", "egg_buildup");
  absent("egg build-up: 4.8 days of stock is normal for this farm (Sep 30, 242k eggs, a Farmfresh sale that day)", () => {}, "2026-09-30", "egg_buildup");
  run("egg build-up: 4 days with no Farmfresh sale (last sale Sep 26, today Sep 30)", (i) => { i.farmfreshDates = i.farmfreshDates.filter((d) => d < "2026-09-27"); if (i.farmfreshBySection) i.farmfreshBySection = { big: i.farmfreshBySection.big.filter((d) => d < "2026-09-27"), small: i.farmfreshBySection.small.filter((d) => d < "2026-09-27") }; }, "2026-09-30", "egg_buildup");
  absent("egg build-up: only 3 days since the last Farmfresh sale is fine", (i) => { i.farmfreshDates = i.farmfreshDates.filter((d) => d !== "2026-09-30"); if (i.farmfreshBySection) i.farmfreshBySection = { big: i.farmfreshBySection.big.filter((d) => d !== "2026-09-30"), small: i.farmfreshBySection.small.filter((d) => d !== "2026-09-30") }; }, "2026-09-30", "egg_buildup");
  absent("egg build-up: reviewed ledger rows never alert", (i) => { for (const e of i.egg.filter((x) => x.date === "2026-09-30")) { e.closing = 400000; e.reviewed = true; } }, "2026-09-30", "egg_buildup");
  absent("missing day: Sep 3 has BOTH a big and a small ledger row (small = 31,440 in and out, no entries) -> not missing", () => {}, "2026-09-03", "missing_day");
  run("missing day: a day with only the big ledger section", (i) => { i.egg = i.egg.filter((e) => !(e.date === "2026-09-12" && e.section === "small")); }, "2026-09-12", "missing_day");
  absent("never-flag: Sep 9 feed cell rows never alert even when zero feed", (i) => { const r = row(i, "5cccebde-31c1-43b0-936c-11feac54b986", "2026-09-09"); r.feed = 0; }, "2026-09-09", "feed_anomaly", "5cccebde-31c1-43b0-936c-11feac54b986");
  {
    const n = alertsFor(buildCtx(input), "2026-08-13").length;
    const m = alertsFor(buildCtx(input), "2026-08-13", { includeCleared: true }).length;
    console.log(`${n === 0 && m > 0 ? "PASS" : "FAIL"}  never-flag: August (cleared) gives no alerts by default (${n}); the same day evaluated for rule testing gives ${m}`);
    if (!(n === 0 && m > 0)) process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}

const ctx = buildCtx(input);
const from = process.argv[3] ?? ctx.dates[0];
const to = process.argv[4] ?? ctx.dates[ctx.dates.length - 1];

const counts: Record<string, number> = {};
for (let d = from; d <= to; d = addDays(d, 1)) {
  for (const a of alertsFor(ctx, d, { includeCleared: INCLUDE_CLEARED })) {
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
