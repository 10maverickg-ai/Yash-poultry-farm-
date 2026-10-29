// Tests the realistic-target learning (V10): clean data, a moult, a mortality spike, too little data, never above book.
//   npx tsx scripts/realistic-check.mts
import { buildCtx, flockCards, addDays, type EngineInput, type ProdRow, type FlockRef } from "../lib/analytics/engine.ts";
import { attachRealistic, learnRealistic, realisticFor, bandAgeWeeks, findSlips, percentile, seasonOf, weeklyDeathRate, deathTargetFor, deathLimits, findBand, REALISTIC_CONFIG } from "../lib/analytics/realistic.ts";

let failed = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (!cond) failed++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };

const std = Array.from({ length: 50 }, (_, i) => ({ age: 20 + i, hdp: 90, feedG: 100, cumDepl: 0.1 * (i + 1) }));
const flocks: FlockRef[] = ["A", "B", "C"].map((n) => ({ id: n, label: "BAB-" + n, breed: "BV300", placementDate: "2026-01-01", placementConfirmed: true, segment: "main" }));
const START = "2026-07-30"; // age 30 weeks
let id = 0;
function build(opts: { days?: number; ids?: string[]; eggsPct?: number; edit?: (r: ProdRow) => void; moult?: boolean } = {}): EngineInput {
  const prod: ProdRow[] = [];
  for (const f of opts.ids ?? ["A", "B", "C"])
    for (let i = 0; i < (opts.days ?? 40); i++) {
      const r: ProdRow = { id: ++id, date: addDays(START, i), flockId: f, label: "BAB-" + f, mort: 1, feed: 20, eggs: Math.round(1000 * (opts.eggsPct ?? 0.8)), pop: 1000, hd: (opts.eggsPct ?? 0.8) * 100, flagged: false, reviewed: false };
      opts.edit?.(r);
      prod.push(r);
    }
  return { flocks, prod, movements: [], egg: [], feedBoxes: [], chick: [], farmfreshDates: [], moulting: opts.moult ? [{ flockId: "A", start: addDays(START, 20), end: addDays(START, 30), confirmed: true }] : [], std, realisticOverrides: [] };
}
const learn = (i: EngineInput, over = []) => { const c = buildCtx(i); const asOf = addDays(START, 45); return { c, m: learnRealistic(c, asOf, over) }; };
const hd30 = (m: ReturnType<typeof learnRealistic>) => m.bands.find((b) => b.group === "main" && b.metric === "hd" && b.band === 6 && b.season === "all")!;

// clean: 80 eggs per 100 birds against a book of 90 = 88.9 %
{
  const { m } = learn(build());
  const b = hd30(m);
  ok("clean: band 30-34 learned", b.learnedRatio != null && Math.abs(b.learnedRatio - 80 / 90) < 0.005, JSON.stringify(b));
  ok("clean: healthy days and flocks counted", b.healthyDays >= 28 && b.flocks === 3, `${b.healthyDays}/${b.flocks}`);
  const f = m.bands.find((x) => x.metric === "feed" && x.band === 6)!;
  ok("clean: feed ratio = 20 bags x 45 kg / 1000 birds = 900 g vs 100 g book is flagged as ratio 9 -> capped at 1", f.learnedRatio === 1);
}
// moult: low-egg days inside a recorded moult must not pull the level down
{
  const noisy = build({ moult: true, edit: (r) => { if (r.flockId === "A" && r.date >= addDays(START, 20) && r.date <= addDays(START, 30)) { r.eggs = 100; r.feed = 5; } } });
  const { m } = learn(noisy);
  ok("moult: moult days are left out", Math.abs(hd30(m).learnedRatio! - 80 / 90) < 0.005, String(hd30(m).learnedRatio));
  const { m: m2 } = learn({ ...noisy, moulting: [] });
  ok("moult: without the record the same days WOULD lower it", hd30(m2).learnedRatio! <= hd30(m).learnedRatio!);
}
// mortality spike: day with > 3x median deaths is left out of HD
{
  const spiky = build({ edit: (r) => { if (r.flockId === "B" && r.date === addDays(START, 25)) { r.mort = 40; r.eggs = 100; } } });
  const clean = learn(build()).m;
  const { m } = learn(spiky);
  ok("spike: spike day not counted as healthy", hd30(m).healthyDays === hd30(clean).healthyDays - 1, `${hd30(m).healthyDays} vs ${hd30(clean).healthyDays}`);
  ok("spike: level unchanged", Math.abs(hd30(m).learnedRatio! - hd30(clean).learnedRatio!) < 0.005);
}
// flagged / missing data
{
  const { m } = learn(build({ edit: (r) => { if (r.flockId === "C" && r.date < addDays(START, 10)) r.flagged = true; if (r.flockId === "B" && r.date < addDays(START, 5)) r.feed = null; } }));
  const clean = learn(build()).m;
  ok("flagged and missing-feed days are left out", hd30(m).healthyDays === hd30(clean).healthyDays - 15, `${hd30(m).healthyDays}`);
}
// too little data
{
  const { m, c } = learn(build({ ids: ["A"] }));
  const b = hd30(m);
  ok("too little: one flock -> not learned", b.learnedRatio == null && b.source === "none" && /flock/.test(b.notLearnedReason ?? ""), JSON.stringify(b));
  const t = realisticFor(c, "A", addDays(START, 40), m);
  ok("too little: realisticFor gives no value and says why", t.value == null && /not learned yet/.test(t.reason ?? ""), JSON.stringify(t));
  const { m: m2 } = learn(build({ days: 6 }));
  ok("too little: 6 days x 3 flocks (and ramp-up) -> not learned", hd30(m2).learnedRatio == null);
}
// never above book
{
  const { m } = learn(build({ eggsPct: 0.95 }));
  ok("never above book: 95 vs book 90 -> ratio capped at 1", hd30(m).learnedRatio === 1);
}
// override wins, and is also capped
{
  const ov = [{ group: "main" as const, metric: "hd" as const, bandStart: 30, ratioPct: 70 }];
  const { m, c } = learn(build(), ov as never);
  const b = hd30(m);
  ok("override wins and is marked owner", b.ratio === 0.7 && b.source === "owner" && Math.abs(b.learnedRatio! - 80 / 90) < 0.005);
  const t = realisticFor(c, "A", addDays(START, 20), m);
  ok("override: realistic HD = 90 x 0.7 = 63", t.value === 63 && t.source === "owner", JSON.stringify(t));
  const { m: m3 } = learn(build(), [{ group: "main", metric: "hd", bandStart: 30, ratioPct: 130 }] as never);
  ok("override above book is capped at the book", hd30(m3).ratio === 1);
}
// age rule: chick-arrival flocks use laying age = age - 18 weeks
{
  const f = { placementDate: "2026-01-01", placementIsChickDate: true };
  ok("band age: chick-date flock 30 weeks after arrival -> laying age 12", bandAgeWeeks(f, "2026-07-30") === 12);
  ok("band age: normal flock", bandAgeWeeks({ placementDate: "2026-01-01" }, "2026-07-30") === 30);
}
// the traffic light is judged against the realistic target, never silently against the book
{
  const asOf = addDays(START, 33);
  const c = buildCtx(build());
  const bookCard = flockCards(c, asOf).find((x) => x.flockId === "A")!;
  ok("without a model the card is judged against the book (80 of 90 = 89% -> amber)", bookCard.status === "amber", bookCard.status);
  attachRealistic(c);
  const rc = flockCards(c, asOf).find((x) => x.flockId === "A")!;
  ok("with the model: 80 against realistic 80 -> green, book still shown", rc.status === "green" && rc.stdHd === 90 && Math.abs(rc.realisticHd! - 80) < 0.2 && Math.abs(rc.gap! - 10) < 0.2, JSON.stringify([rc.status, rc.stdHd, rc.realisticHd, rc.gap]));
  const c1 = buildCtx(build({ ids: ["A"] }));
  attachRealistic(c1);
  const g = flockCards(c1, asOf)[0];
  ok("not learned: grey, reason realistic_not_learned, no colour, book line kept", g.status === "no_reference" && g.refReason === "realistic_not_learned" && g.realisticHd == null && g.stdHd === 90 && /not learned yet/.test(g.statusNote), g.statusNote);
}
// percentile and slip
ok("percentile 70 of 1..11 is 8", percentile([1,2,3,4,5,6,7,8,9,10,11], 70) === 8);
{
  const mk = (asOf: string, r: number) => ({ asOf, bands: [{ group: "main", metric: "hd", band: 6, fromWeek: 30, toWeek: 34, daysSeen: 40, healthyDays: 40, flocks: 3, dateFrom: null, dateTo: null, samples: 30, season: "all", learnedRatio: r, notLearnedReason: null, override: null, ratio: r, learnedRate: null, overrideRate: null, rate: null, source: "learned" }] }) as never;
  ok("slip: 4-point fall raises one item", findSlips([mk("2026-08-31", 0.9), mk("2026-09-30", 0.86)]).length === 1);
  ok("slip: 2-point fall does not", findSlips([mk("2026-08-31", 0.9), mk("2026-09-30", 0.88)]).length === 0);
  ok("slip: a rise does not", findSlips([mk("2026-08-31", 0.85), mk("2026-09-30", 0.9)]).length === 0);
}
ok("config is one object with the owner's thresholds", REALISTIC_CONFIG.percentile === 70 && REALISTIC_CONFIG.minHealthyDays === 28 && REALISTIC_CONFIG.minFlocks === 2 && REALISTIC_CONFIG.rampDays === 14 && REALISTIC_CONFIG.bandWeeks === 5);
// ---- V11: seasons -------------------------------------------------------------------------------------
const seasonInput = (start: string, days: number, ids: string[], edit?: (r: ProdRow) => void): EngineInput => {
  const placed = addDays(start, -210); // 30 weeks old on `start`, so the band is 30-34 weeks for the next 5 weeks
  const fl: FlockRef[] = ids.map((n) => ({ id: n, label: "BAB-" + n, breed: "BV300", placementDate: placed, placementConfirmed: true, segment: "main" }));
  const prod: ProdRow[] = [];
  for (const f of ids) for (let i = 0; i < days; i++) {
    const r: ProdRow = { id: ++id, date: addDays(start, i), flockId: f, label: "BAB-" + f, mort: 1, feed: 20, eggs: 800, pop: 1000, hd: 80, flagged: false, reviewed: false };
    edit?.(r);
    prod.push(r);
  }
  return { flocks: fl, prod, movements: [], egg: [], feedBoxes: [], chick: [], farmfreshDates: [], moulting: [], std, realisticOverrides: [] };
};
const seasonModel = (i: EngineInput, asOf: string) => { const c = buildCtx(i); return { c, m: learnRealistic(c, asOf, []) }; };
ok("season map: Jul-Sep monsoon, Oct-Nov cool, Dec-Feb cold, Mar spring, Apr-Jun hot", [seasonOf("2026-07-01"), seasonOf("2026-09-30"), seasonOf("2026-10-01"), seasonOf("2026-11-30"), seasonOf("2026-12-01"), seasonOf("2027-02-28"), seasonOf("2027-03-15"), seasonOf("2027-04-01"), seasonOf("2027-06-30")].join() === "MONSOON,MONSOON,COOL,COOL,COLD,COLD,SPRING,HOT,HOT");
{
  // enough data: 3 flocks, 40 days in MONSOON -> a monsoon band is learned on its own
  const { c, m } = seasonModel(seasonInput("2026-07-30", 40, ["A", "B", "C"]), "2026-09-08");
  const b = m.bands.find((x) => x.group === "main" && x.metric === "hd" && x.band === 6 && x.season === "MONSOON")!;
  ok("season: enough data -> the monsoon band is learned on its own", b && b.learnedRatio != null && Math.abs(b.learnedRatio - 80 / 90) < 0.005 && b.flocks === 3 && b.healthyDays >= 28, JSON.stringify(b));
  const f = findBand(m, "main", "hd", 31, "MONSOON")!;
  ok("season: the lookup for a monsoon date uses the monsoon band", f.season === "MONSOON");
  const t = realisticFor(c, "A", "2026-08-25", m);
  ok("season: realisticFor works on the seasonal band", t.band?.season === "MONSOON" && Math.abs(t.value! - 80) < 0.2, JSON.stringify(t.band?.season));
  ok("season: no other season exists in the data, so none is invented", !m.bands.some((x) => x.season === "COOL" || x.season === "HOT" || x.season === "COLD"));
}
{
  // too little in the season, enough overall: 2 flocks across Sep 10 - Oct 12 -> COOL has only ~24 healthy flock-days, the all-season band is learned
  const { c, m } = seasonModel(seasonInput("2026-09-10", 33, ["A", "B"]), "2026-10-12");
  const cool = m.bands.find((x) => x.group === "main" && x.metric === "hd" && x.band === 6 && x.season === "COOL")!;
  const all = m.bands.find((x) => x.group === "main" && x.metric === "hd" && x.band === 6 && x.season === "all")!;
  ok("season fall-back: the cool band alone is NOT learned (too few days)", cool.learnedRatio == null && /healthy flock-days/.test(cool.notLearnedReason ?? ""), JSON.stringify([cool.healthyDays, cool.learnedRatio]));
  ok("season fall-back: the all-season band is learned", all.learnedRatio != null && all.healthyDays >= 28, String(all.healthyDays));
  const t = realisticFor(c, "A", "2026-10-10", m);
  ok("season fall-back: realisticFor uses the all-season value", t.band?.season === "all" && t.value != null);
  const h = deathLimits(m, "main", 31, "2026-10-10");
  ok("season fall-back: deaths with 1 death a day over 1000 birds (0.7% a week) are learned all-season", h.source === "learned" && h.seasonUsed === "all" && Math.abs(h.usual! - 0.7) < 0.05, JSON.stringify(h));
  const card = flockCards(c, "2026-10-10").find((x) => x.flockId === "A")!;
  ok("season fall-back: the card still says which data was used (here nothing is attached, so no label)", card.realisticBand == null);
  attachRealistic(c);
  const card2 = flockCards(c, "2026-10-10").find((x) => x.flockId === "A")!;
  ok("season fall-back: the card carries 'all seasons' next to the number", card2.realisticSeason === "all seasons", String(card2.realisticSeason));
}
// ---- V11: death rate -------------------------------------------------------------------------------------
ok("death rate: 7 deaths in a week over 1000 birds is 0.7%", Math.abs(weeklyDeathRate(Array.from({ length: 7 }, () => ({ mort: 1, pop: 1000 })))! - 0.7) < 1e-9);
ok("death rate: 5 days are scaled up to a week (5 deaths -> 7)", Math.abs(weeklyDeathRate(Array.from({ length: 5 }, () => ({ mort: 1, pop: 1000 })))! - 0.7) < 1e-9);
ok("death rate: 4 days are not enough", weeklyDeathRate(Array.from({ length: 4 }, () => ({ mort: 1, pop: 1000 }))) == null);
ok("death rate: uses the week's AVERAGE birds", Math.abs(weeklyDeathRate([2, 2, 2, 2, 2, 2, 2].map((m, i) => ({ mort: m, pop: 1000 - i * 10 })))! - (14 / 970) * 100) < 1e-9);
{
  // starting values (no model): cool 0.35 / 0.6, hot 0.55 / 0.9
  const mk2 = (start: string, mort: number, pop: number) => { const c = buildCtx(seasonInput(start, 20, ["A"], (r) => { r.mort = mort; r.pop = pop; })); return c; };
  const cool = deathTargetFor(mk2("2026-10-05", 7, 10000), "A", "2026-10-20"); // 49 / 10000 = 0.49% in October
  ok("deaths: starting values, cool month: 0.49% is amber (limits 0.35 / 0.6)", cool.status === "amber" && cool.source === "starting" && cool.amber === 0.35 && cool.red === 0.6, JSON.stringify(cool));
  const hot = deathTargetFor(mk2("2026-07-05", 7, 10000), "A", "2026-07-20"); // same 0.49% in July
  ok("deaths: starting values, monsoon: the same 0.49% is green (limits 0.55 / 0.9)", hot.status === "green" && hot.amber === 0.55 && hot.red === 0.9, JSON.stringify(hot));
  const red = deathTargetFor(mk2("2026-07-05", 14, 10000), "A", "2026-07-20"); // 0.98%
  ok("deaths: starting values, monsoon: 0.98% is red", red.status === "red");
  const few = deathTargetFor(buildCtx(seasonInput("2026-07-05", 3, ["A"])), "A", "2026-07-07");
  ok("deaths: 3 days of rows give no verdict", few.status === "none" && few.weekPct == null);
}
{
  // learned usual: 2 deaths/day over 2000 birds = 0.7%/week usual; amber would be 1.5x = 1.05 but is capped at the starting red 0.9
  // (a week above the starting red is always at least amber); red 2.5x = 1.75 (cap 2x0.9 = 1.8)
  const i = seasonInput("2026-07-30", 40, ["A", "B", "C"], (r) => { r.mort = 2; r.pop = 2000; r.eggs = 1600; });
  const c = buildCtx(i);
  attachRealistic(c);
  const d = c.realisticDeath!("A", "2026-08-25");
  ok("deaths: usual level learned from the farm's own weeks (0.7%); amber capped at the starting red 0.9; red 1.75", d.source === "learned" && Math.abs(d.usual! - 0.7) < 0.03 && Math.abs(d.amber! - 0.9) < 1e-9 && Math.abs(d.red! - 1.75) < 0.1, JSON.stringify(d));
  ok("deaths: a normal week is green against our usual (0.7%, above the starting amber 0.55 and far above the book)", d.status === "green" && d.bookPct != null && d.weekPct! > d.bookPct * 4 && d.weekPct! > 0.55, JSON.stringify(d));
  // a bad week: 5 deaths a day over 2000 birds = 1.75%/week -> red; 3.5 a day = 1.2% -> amber... check the guard rail with a bad week in the same flock
  const cBad = buildCtx(seasonInput("2026-07-30", 40, ["A", "B", "C"], (r) => { r.pop = 2000; r.eggs = 1600; r.mort = r.flockId === "A" && r.date >= "2026-08-20" && r.date <= "2026-08-26" ? 4 : 2; }));
  attachRealistic(cBad);
  const bad = cBad.realisticDeath!("A", "2026-08-26");
  ok("deaths guard rail: a week of 1.4% (above the starting red 0.9) is at least amber even though 0.7% is usual", bad.status === "amber" && Math.abs(bad.weekPct! - 1.4) < 0.01, JSON.stringify(bad));
  // the owner's override wins, and sets the usual directly (percent a week)
  const m2 = learnRealistic(c, "2026-09-08", [{ group: "main", metric: "mortality", bandStart: 30, ratioPct: 0.4 }]);
  const lim = deathLimits(m2, "main", 31, "2026-08-25");
  ok("deaths: owner override of 0.4% a week wins (amber 0.6, red 1.0)", lim.source === "owner" && lim.usual === 0.4 && Math.abs(lim.amber - 0.6) < 1e-9 && Math.abs(lim.red - 1.0) < 1e-9, JSON.stringify(lim));
}
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
