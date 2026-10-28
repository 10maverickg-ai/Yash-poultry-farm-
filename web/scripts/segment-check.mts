// Segment engine on the exported live rows (V8 S0): tsx scripts/segment-check.mts <fixture-dir>
import { loadInput } from "./fixtureInput.mts";
import { buildCtx, dayTotals, alertsFor, flockCards, eggStockDays, feedDaysLeft, rampingUp, segmentOn, ledgerSegment, firstYoungDate, SEGMENTS, EGG_LIMITS, addDays, type Segment } from "../lib/analytics/engine";

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
const oct = { all: 0, main: 0, young: 0, birdsAll: 0, birdsMain: 0, birdsYoung: 0, mAll: 0, mMain: 0, mYoung: 0 };
for (let d = "2026-10-01"; d <= D; d = addDays(d, 1)) {
  const a = dayTotals(ctx, d), m = dayTotals(ctx, d, "main"), y = dayTotals(ctx, d, "young");
  if (a) { oct.all += a.eggs; oct.birdsAll += a.birds; oct.mAll += a.mort; }
  if (m) { oct.main += m.eggs; oct.birdsMain += m.birds; oct.mMain += m.mort; }
  if (y) { oct.young += y.eggs; oct.birdsYoung += y.birds; oct.mYoung += y.mort; }
}
console.log(`\nOctober 1–26: main ${n(oct.main, 0)} eggs HD ${n(oct.main / oct.birdsMain * 100)}% | young ${n(oct.young, 0)} eggs HD ${n(oct.young / oct.birdsYoung * 100)}% | whole farm ${n(oct.all, 0)} eggs HD ${n(oct.all / oct.birdsAll * 100)}%`);
ok("October: segment eggs add to the whole farm", oct.main + oct.young === oct.all);
// the same numbers from a direct SQL sum on the live database (V8 S0.7)
ok("October SQL: main 1,426,830 / young 223,800 / total 1,650,630 eggs", oct.main === 1426830 && oct.young === 223800 && oct.all === 1650630, `${oct.main}/${oct.young}/${oct.all}`);
ok("October SQL: bird-days 1,740,898 / 639,023 / 2,379,921; deaths 601 / 173 / 774", oct.birdsMain === 1740898 && oct.birdsYoung === 639023 && oct.birdsAll === 2379921 && oct.mMain === 601 && oct.mYoung === 173 && oct.mAll === 774);
ok("26 Oct SQL: main 52,860 eggs 66,663 birds 29 deaths 137 bags; young 15,930 / 27,708 / 11; total 68,790 / 94,371 / 40", main.eggs === 52860 && main.birds === 66663 && main.mort === 29 && main.feed === 137 && young.eggs === 15930 && young.birds === 27708 && young.mort === 11 && all.eggs === 68790 && all.birds === 94371 && all.mort === 40);
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

// departed flocks: no alert, card or standard comparison after their last day (I2)
{
  const gone = input.flocks.filter((f) => /^Old BAB/.test(f.label));
  let hits = 0;
  for (let d = "2026-09-09"; d <= D; d = addDays(d, 1)) for (const a of alertsFor(ctx, d, { includeCleared: true })) if (gone.some((g) => g.id === a.flockId)) hits++;
  ok("no alert on a departed flock after its last day (Old BAB-1 left 8 Sep, Old BAB-2 left 3 Sep)", hits === 0, `${hits} alerts`);
  ok("departed flocks keep their history rows (69 and 64 days) for totals and sales", gone.every((g) => (ctx.byFlock.get(g.id) ?? []).length >= 64));
}
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

// J1: young small-egg limit is 6 days without a sale (main stays 4); October build-up alerts 7 -> 5
{
  const oct = (seg: "main" | "young") => { const out: string[] = []; for (let d = "2026-10-01"; d <= D; d = addDays(d, 1)) for (const a of alertsFor(ctx, d, { segment: seg })) if (a.kind === "egg_buildup") out.push(d); return out; };
  const y = oct("young");
  ok("young: 4 days without a sale (7 and 20 Oct) no longer alerts", !y.includes("2026-10-07") && !y.includes("2026-10-20"), y.join(","));
  ok("young: 6 days without a sale (9 Oct) alerts with 'alert at 6+'", alertsFor(ctx, "2026-10-09", { segment: "young" }).some((a) => a.kind === "egg_buildup" && /alert at 6\+/.test(a.reason)));
  ok("young October egg build-up alerts: 5 (was 7 with the 4-day limit)", y.length === 5, String(y.length));
  ok("main keeps the 4-day limit", EGG_LIMITS.main.noSaleDays === 4 && EGG_LIMITS.young.noSaleDays === 6);
}

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

// ledger arithmetic (I4): the opening of a day ties to the previous day's closing, per ledger
{
  const gaps: string[] = [];
  const by = new Map(input.egg.map((e) => [`${e.date}|${e.section}`, e]));
  for (const e of input.egg) {
    const prev = by.get(`${addDays(e.date, -1)}|${e.section}`);
    if (prev && prev.closing != null && e.opening != null && prev.closing !== e.opening) gaps.push(`${e.date} ${e.section} ${e.opening - prev.closing > 0 ? "+" : ""}${e.opening - prev.closing}`);
  }
  console.log("Ledger opening gaps:", gaps.join(", "));
  ok("only two opening gaps in Jul-Oct: 30 Jul big +30 and 25 Sep big -30 (the known one)", [...gaps].sort().join(",") === "2026-07-30 big +30,2026-09-25 big -30");
  const t = (d: string, sec: string) => by.get(`${d}|${sec}`);
  ok("28 Jul big opening ties to 27 Jul closing (176,190) after the 134,790-egg sale", t("2026-07-28", "big")?.opening === 176190 && t("2026-07-27", "big")?.closing === 176190);
  ok("22 Oct small opening 2,520 ties to the 21 Oct closing 2,520 (the +600 late addition)", t("2026-10-22", "small")?.opening === 2520 && t("2026-10-21", "small")?.closing === 2520);
}

process.exit(bad ? 1 : 0);
