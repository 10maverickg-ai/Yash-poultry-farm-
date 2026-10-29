// Tests the flock-health rule (V12 N5): deaths above usual 2 days running AND eggs down more than 5% in a week -> "call the vet".
//   npx tsx scripts/health-check.mts <fixture-dir>
import { buildCtx, flockHealth, alertsFor, addDays, type EngineInput, type ProdRow, type FlockRef } from "../lib/analytics/engine.ts";
import { attachRealistic } from "../lib/analytics/realistic.ts";
import { loadInput } from "./fixtureInput.mts";

let failed = 0;
const ok = (n: string, c: boolean, x = "") => { if (!c) failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : "  " + x}`); };
const std = Array.from({ length: 80 }, (_, i) => ({ age: 20 + i, hdp: 90, feedG: 100, cumDepl: 0.1 * (i + 1) }));
const flock: FlockRef = { id: "A", label: "BAB-A", breed: "BV300", placementDate: "2025-12-01", placementConfirmed: true, segment: "main" };
const START = "2026-09-01";
let id = 0;
// 30 days: 4 deaths a day on 4,000... flock of 10,000 birds; HD 80 ; then the last `n` days use the override functions
function make(opts: { deaths?: (i: number) => number; hd?: (i: number) => number; days?: number; pop?: number } = {}): EngineInput {
  const days = opts.days ?? 30, pop = opts.pop ?? 10000;
  const prod: ProdRow[] = [];
  for (let i = 0; i < days; i++) {
    const hd = opts.hd?.(i) ?? 80;
    prod.push({ id: ++id, date: addDays(START, i), flockId: "A", label: "BAB-A", mort: opts.deaths?.(i) ?? 4, feed: 40, eggs: Math.round((hd / 100) * pop / 30) * 30, pop, hd, flagged: false, reviewed: false });
  }
  return { flocks: [flock], prod, movements: [], egg: [], feedBoxes: [], chick: [], farmfreshDates: [], moulting: [], std, realisticOverrides: [] };
}
const last = (days = 30) => addDays(START, days - 1);
const ctxOf = (i: EngineInput) => { const c = buildCtx(i); return c; };

// the BAB-2 shape: usual 4 a day, then 12 and 14 on the last two days, HD sliding from 80 to ~72 over the last 7 days
const sick = make({ deaths: (i) => (i === 28 ? 12 : i === 29 ? 14 : 4), hd: (i) => (i >= 23 ? 80 - (i - 22) * 1.2 : 80) });
const h = flockHealth(ctxOf(sick), "A", last());
ok("sick flock: flagged", h != null, "null");
ok("sick flock: sentence has the deaths, the usual, the egg fall and 'call the vet'", !!h && /12 and 14/.test(h.text) && /usual is about \d+ a day/.test(h.text) && /eggs fell \d+% in a week/.test(h.text) && /call the vet/.test(h.text), h?.text);
ok("sick flock: action says to call the vet today", !!h && /^Call the vet today/.test(h.action));
ok("only deaths high (eggs steady): not flagged", flockHealth(ctxOf(make({ deaths: (i) => (i >= 28 ? 14 : 4) })), "A", last()) === null);
ok("only eggs falling (deaths normal): not flagged", flockHealth(ctxOf(make({ hd: (i) => (i >= 23 ? 80 - (i - 22) * 1.2 : 80) })), "A", last()) === null);
ok("one day of high deaths only: not flagged", flockHealth(ctxOf(make({ deaths: (i) => (i === 29 ? 14 : 4), hd: (i) => (i >= 23 ? 80 - (i - 22) * 1.2 : 80) })), "A", last()) === null);
ok("eggs down by less than 5% (80 -> 77): not flagged", flockHealth(ctxOf(make({ deaths: (i) => (i >= 28 ? 14 : 4), hd: (i) => (i >= 23 ? 77 : 80) })), "A", last()) === null);
ok("a small flock is not alarmed by two or three extra deaths (1,000 birds, 2 -> 4)", flockHealth(ctxOf(make({ pop: 1000, deaths: (i) => (i >= 28 ? 4 : 2), hd: (i) => (i >= 23 ? 70 : 80) })), "A", last()) === null);
// a long episode is ONE alert event per 7 days, not one per day
const long = make({ days: 40, deaths: (i) => (i >= 28 ? 14 : 4), hd: (i) => (i >= 23 ? Math.max(30, 80 - (i - 22) * 2) : 80) });
const cl = ctxOf(long);
const events = Array.from({ length: 40 }, (_, i) => addDays(START, i)).filter((d) => alertsFor(cl, d).some((a) => a.kind === "flock_health"));
const asked = Array.from({ length: 40 }, (_, i) => addDays(START, i)).filter((d) => flockHealth(cl, "A", d));
ok(`episode lasts ${asked.length} days but raises only ${events.length} alert events (quiet for 6 days after each)`, asked.length >= 8 && events.length >= 1 && events.length <= Math.ceil(asked.length / 7), `${asked.length} / ${events.length}`);

// the live copy: BAB-2 on 27 and 28 Oct
const dir = process.argv[2];
if (dir) {
  const input = loadInput(dir);
  const ctx = buildCtx(input);
  attachRealistic(ctx);
  const bab2 = input.flocks.find((f) => f.label === "BAB-2")!.id;
  const lastDay = ctx.dates[ctx.dates.length - 1];
  const hb = flockHealth(ctx, bab2, lastDay);
  ok(`live data: BAB-2 on ${lastDay} is flagged (12 and 14 deaths on 27 and 28 Oct, HD down about 10%)`, lastDay < "2026-10-28" || hb != null, hb ? "" : "not flagged");
  if (hb) console.log("      " + hb.text);
  const allEvents: string[] = [];
  for (const d of ctx.dates) for (const a of alertsFor(ctx, d)) if (a.kind === "flock_health") allEvents.push(`${d} ${a.flockLabel}`);
  console.log("      all health alert events in the data: " + (allEvents.join("; ") || "none"));
  ok("live data: no alert storm (at most 2 health alert events per flock across the whole data)", Object.values(allEvents.reduce<Record<string, number>>((m, e) => ({ ...m, [e.split(" ")[1]]: (m[e.split(" ")[1]] ?? 0) + 1 }), {})).every((n) => n <= 2));
  const others = input.flocks.filter((f) => f.id !== bab2 && f.status === "active" && flockHealth(ctx, f.id, lastDay)).map((f) => f.label);
  console.log("      other flocks flagged on the last day: " + (others.join(", ") || "none"));
}
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
