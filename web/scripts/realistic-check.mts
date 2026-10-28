// Tests the realistic-target learning (V10): clean data, a moult, a mortality spike, too little data, never above book.
//   npx tsx scripts/realistic-check.mts
import { buildCtx, addDays, type EngineInput, type ProdRow, type FlockRef } from "../lib/analytics/engine.ts";
import { learnRealistic, realisticFor, bandAgeWeeks, findSlips, percentile, REALISTIC_CONFIG } from "../lib/analytics/realistic.ts";

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
const hd30 = (m: ReturnType<typeof learnRealistic>) => m.bands.find((b) => b.group === "main" && b.metric === "hd" && b.band === 6)!;

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
// percentile and slip
ok("percentile 70 of 1..11 is 8", percentile([1,2,3,4,5,6,7,8,9,10,11], 70) === 8);
{
  const mk = (asOf: string, r: number) => ({ asOf, bands: [{ group: "main", metric: "hd", band: 6, fromWeek: 30, toWeek: 34, daysSeen: 40, healthyDays: 40, flocks: 3, dateFrom: null, dateTo: null, samples: 30, learnedRatio: r, notLearnedReason: null, override: null, ratio: r, source: "learned" }] }) as never;
  ok("slip: 4-point fall raises one item", findSlips([mk("2026-08-31", 0.9), mk("2026-09-30", 0.86)]).length === 1);
  ok("slip: 2-point fall does not", findSlips([mk("2026-08-31", 0.9), mk("2026-09-30", 0.88)]).length === 0);
  ok("slip: a rise does not", findSlips([mk("2026-08-31", 0.85), mk("2026-09-30", 0.9)]).length === 0);
}
ok("config is one object with the owner's thresholds", REALISTIC_CONFIG.percentile === 70 && REALISTIC_CONFIG.minHealthyDays === 28 && REALISTIC_CONFIG.minFlocks === 2 && REALISTIC_CONFIG.rampDays === 14 && REALISTIC_CONFIG.bandWeeks === 5);
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
