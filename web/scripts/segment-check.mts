// Segment engine on the exported live rows (V8 S0): tsx scripts/segment-check.mts <fixture-dir>
import { loadInput } from "./fixtureInput.mts";
import { buildCtx, dayTotals, alertsFor, flockCards, eggStockDays, feedDaysLeft, rampingUp, segmentOn, ledgerSegment, firstYoungDate, SEGMENTS, addDays, type Segment } from "../lib/analytics/engine";

const dir = process.argv[2];
const input = loadInput(dir);
const ctx = buildCtx(input);
let bad = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (!cond) bad++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); };
const n = (x: number | null | undefined, d = 1) => (x == null ? "–" : x.toLocaleString("en-IN", { maximumFractionDigits: d }));

const D = "2026-10-26";
const all = dayTotals(ctx, D)!;
const main = dayTotals(ctx, D, "main")!;
const young = dayTotals(ctx, D, "young")!;
console.log(`\n26 Oct   | eggs | birds | HD% | deaths | feed bags`);
for (const [nm, t] of [["main", main], ["young", young], ["WHOLE FARM", all]] as const) console.log(`${nm.padEnd(10)}| ${n(t.eggs, 0)} | ${n(t.birds, 0)} | ${n(t.hd)} | ${n(t.mort, 0)} | ${t.feedRecorded ? n(t.feed, 0) : "not recorded"}`);
ok("26 Oct: eggs main + young = whole farm", main.eggs + young.eggs === all.eggs);
ok("26 Oct: birds main + young = whole farm", main.birds + young.birds === all.birds);
ok("26 Oct: deaths main + young = whole farm", main.mort + young.mort === all.mort);
ok("26 Oct: main eggs = big ledger produced (52,860), young eggs = small ledger produced (15,930)", main.eggs === 52860 && young.eggs === 15930, `${main.eggs} / ${young.eggs}`);
ok("whole-farm HD is pooled, not the mean of the segment HDs", Math.abs(all.hd! - (main.eggs + young.eggs) / (main.birds + young.birds) * 100) < 1e-9 && Math.abs(all.hd! - (main.hd! + young.hd!) / 2) > 0.1, `${n(all.hd, 2)} vs mean ${n((main.hd! + young.hd!) / 2, 2)}`);
ok("main HD ≠ whole-farm HD (whole farm mixes mature and young birds)", Math.abs(main.hd! - all.hd!) > 0.5);
ok("young feed: not recorded; main feed recorded", !young.feedRecorded && main.feedRecorded);
ok("main feed per bird uses only the rows that record feed", main.feedBirds <= main.birds && main.feedBirds > 0);

// October to date
let oct = { all: 0, main: 0, young: 0, birdsAll: 0, birdsMain: 0, birdsYoung: 0, mAll: 0, mMain: 0, mYoung: 0 };
for (let d = "2026-10-01"; d <= D; d = addDays(d, 1)) {
  const a = dayTotals(ctx, d), m = dayTotals(ctx, d, "main"), y = dayTotals(ctx, d, "young");
  if (a) { oct.all += a.eggs; oct.birdsAll += a.birds; oct.mAll += a.mort; }
  if (m) { oct.main += m.eggs; oct.birdsMain += m.birds; oct.mMain += m.mort; }
  if (y) { oct.young += y.eggs; oct.birdsYoung += y.birds; oct.mYoung += y.mort; }
}
console.log(`\nOctober 1–26: main ${n(oct.main, 0)} eggs HD ${n(oct.main / oct.birdsMain * 100)}% | young ${n(oct.young, 0)} eggs HD ${n(oct.young / oct.birdsYoung * 100)}% | whole farm ${n(oct.all, 0)} eggs HD ${n(oct.all / oct.birdsAll * 100)}%`);
ok("October: segment eggs add to the whole farm", oct.main + oct.young === oct.all);
ok("October: segment bird-days add to the whole farm", oct.birdsMain + oct.birdsYoung === oct.birdsAll);
ok("October: segment deaths add to the whole farm", oct.mMain + oct.mYoung === oct.mAll);

// segments
ok("11 flocks active on 26 Oct, 8 main + 3 young", ctx.byDate.get(D)!.length === 11 && SEGMENTS.every((s) => ctx.byDate.get(D)!.filter((r) => segmentOn(ctx, r.flockId, D) === s).length === (s === "main" ? 8 : 3)));
ok("departed flocks count as main in history", ["Old BAB-1 (sold Sep)", "Old BAB-2 (to Anil farm)"].every((l) => { const f = input.flocks.find((x) => x.label === l)!; return segmentOn(ctx, f.id, "2026-08-01") === "main"; }));
ok("young flocks first report 4 Oct", firstYoungDate(ctx) === "2026-10-04");
ok("small ledger is main before 4 Oct and young from 4 Oct", ledgerSegment(ctx, "small", "2026-09-10") === "main" && ledgerSegment(ctx, "small", "2026-10-10") === "young" && ledgerSegment(ctx, "big", "2026-10-10") === "main");

// ramping + cards
const cards = flockCards(ctx, D);
const young3 = cards.filter((c) => c.segment === "young");
ok("BAB-9, 10, 11 are ramping up (day 23 of lay on 26 Oct) with no standard check", young3.length === 3 && young3.every((c) => c.status === "ramping" && c.rampDay === 23 && c.stdHd == null), young3.map((c) => `${c.label}:${c.status}:${c.rampDay}`).join(" "));
ok("ramping note shows the trend against its own previous 7 days", young3.every((c) => /vs [\d.]+% the 7 days before/.test(c.statusNote)), young3[0]?.statusNote);
ok("ramping ends after 60 days (day 61 = 3 Dec)", rampingUp(ctx, young3[0].flockId, "2026-12-02") != null && rampingUp(ctx, young3[0].flockId, "2026-12-03") == null);
const departed = cards.filter((c) => /^Old BAB/.test(c.label));
ok("departed flocks are 'left', not active cards", departed.length === 2 && departed.every((c) => c.status === "left"));
const unknownAge = cards.filter((c) => ["BAB-6", "BAB-7", "BAB-8"].includes(c.label));
ok("placeholder-age flocks: no standard check, no green/amber/red", unknownAge.length === 3 && unknownAge.every((c) => c.status === "no_reference" && /age unknown, no standard check/.test(c.statusNote)));

// alerts October
const counts: Record<string, Record<string, number>> = { main: {}, young: {}, none: {} };
let youngDrop = 0, nullFeedAlerts = 0;
for (let d = "2026-10-01"; d <= D; d = addDays(d, 1)) for (const a of alertsFor(ctx, d)) {
  const k = a.segment ?? "none";
  counts[k][a.kind] = (counts[k][a.kind] ?? 0) + 1;
  if (a.segment === "young" && a.kind === "production_drop") youngDrop++;
  if (a.kind === "feed_anomaly" && a.segment === "young") nullFeedAlerts++;
}
console.log("\nOctober alerts by segment:", JSON.stringify(counts));
ok("no production-drop alerts for young flocks while ramping", youngDrop === 0);
ok("no feed alerts for young flocks (feed not recorded)", nullFeedAlerts === 0);
ok("every alert carries a segment or is a flock with no segment", alertsFor(ctx, D).every((a) => a.segment === null || SEGMENTS.includes(a.segment as Segment)));

// stock
const es = { main: eggStockDays(ctx, D, "main"), young: eggStockDays(ctx, D, "young"), all: eggStockDays(ctx, D) };
console.log("\nEgg stock days 26 Oct:", n(es.main?.days, 2), n(es.young?.days, 2), "whole", n(es.all?.days, 2), "| closing", es.main?.closing, es.young?.closing, es.all?.closing);
ok("egg stock: main (big ledger) + young (small ledger) closing = whole farm", es.main!.closing + es.young!.closing === es.all!.closing);
ok("feed days left is the main flocks' box", feedDaysLeft(ctx, D) != null);

// moving a flock between segments re-evaluates from that date
const mv = structuredClone(input);
const f9 = mv.flocks.find((f) => f.label === "BAB-9")!;
f9.segmentHistory = [{ from: "1900-01-01", segment: "young" }, { from: "2026-10-15", segment: "main" }];
const ctx2 = buildCtx(mv);
ok("moved flock: young before 15 Oct, main from 15 Oct", segmentOn(ctx2, f9.id, "2026-10-14") === "young" && segmentOn(ctx2, f9.id, "2026-10-15") === "main");
ok("moved flock: history keeps the old segment in old totals", dayTotals(ctx2, "2026-10-10", "young")!.flocks === 3 && dayTotals(ctx2, "2026-10-16", "young")!.flocks === 2);
ok("moved flock: not ramping once main", rampingUp(ctx2, f9.id, "2026-10-16") == null);

process.exit(bad ? 1 : 0);
