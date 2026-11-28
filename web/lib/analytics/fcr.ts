// V18: FCR (feed conversion ratio) = kg of feed eaten ÷ kg of eggs laid, for the same flocks and the same days. PURE.
// Rules (docs/DECISIONS.md, V18):
//   - Feed kg = feed bags × BAG_KG (the existing 45 kg). Only flock-days with a feed figure count, on both sides.
//   - Egg kg = eggs × egg weight. The farm does not weigh eggs yet, so the egg weight is the BV300 standard for the flock's
//     age in weeks (bv300_standard_laying.egg_weight_g): "FCR (estimated from standard egg weight)". When an actual
//     average egg weight was weighed for that flock (egg_weight_samples, V18 B3) on that day or in the 6 days before,
//     the actual weight is used instead and the label says so.
//   - A flock-day with no egg-weight reference (another breed, an age outside the book's table, no real placement date)
//     is left out of the FCR on both sides and the reason is given; a flock with none at all shows the reason, never a number.
//   - Pooled over a period: total feed kg ÷ total egg kg, never an average of daily ratios.
//   - Feed g per egg = feed kg × 1000 ÷ eggs (needs no egg weight, so it is exact) = 1000 ÷ eggs per kg of feed (V17).
//   - Standard FCR for the same flock-days = Σ eggs × book feed per egg of that week ÷ Σ eggs × book egg weight of that week
//     (book feed per egg = the week's "current" figure; the table's cumulative feed_per_egg_g is the cycle goal).
import { BAG_KG } from "../costs/engine";
import { addDays, breedKey, breedName, diffDays, isPlaceholderAge, rowsOn, type Ctx, type ProdRow, type Segment, type SegFilter } from "./engine";
import { lastDatesWithRows } from "./feedEfficiency";

/** How many days an actual egg weight stays valid (the day it was weighed and the 6 days after). */
export const ACTUAL_WEIGHT_DAYS = 7;

export type WeightSource = "actual" | "standard";

export interface EggWeight {
  grams: number | null;
  source: WeightSource | null;
  why: string | null; // plain reason when grams is null
}

/** The book row of the flock's age on a day, or the reason there is none. */
function bookRow(ctx: Ctx, flockId: string, date: string): { row: NonNullable<Ctx["input"]["std"]>[number] | null; why: string | null } {
  const f = ctx.flockById.get(flockId);
  if (!f) return { row: null, why: "flock not known" };
  if (breedKey(f.breed) !== "BV300") return { row: null, why: `no egg-weight reference loaded for ${breedName(f.breed)}` };
  if (!f.placementDate || isPlaceholderAge(f)) return { row: null, why: "age unknown (placement date not set), so no standard egg weight" };
  const week = Math.floor(diffDays(date, f.placementDate) / 7);
  const row = ctx.input.std.find((s) => s.age === week) ?? null;
  if (!row || row.eggWeightG == null) {
    const ages = ctx.input.std.filter((s) => s.eggWeightG != null).map((s) => s.age);
    const hi = ages.length ? Math.max(...ages) : null;
    return { row: null, why: hi != null && week > hi ? `past the end of the breeder's egg-weight table (week ${week}; the table stops at week ${hi})` : `no standard egg weight for week ${week}` };
  }
  return { row, why: null };
}

/** The egg weight used for a flock-day: an actual weighing (that day or the 6 days before) first, else the BV300 standard. */
export function eggWeightFor(ctx: Ctx, flockId: string, date: string): EggWeight {
  const from = addDays(date, -(ACTUAL_WEIGHT_DAYS - 1));
  let best: { date: string; grams: number } | null = null;
  for (const w of ctx.input.eggWeights ?? []) if (w.flockId === flockId && w.date <= date && w.date >= from && w.grams > 0 && (!best || w.date > best.date)) best = w;
  if (best) return { grams: best.grams, source: "actual", why: null };
  const b = bookRow(ctx, flockId, date);
  return b.row ? { grams: b.row.eggWeightG!, source: "standard", why: null } : { grams: null, source: null, why: b.why };
}

export interface FcrResult {
  fcr: number | null; // pooled feed kg ÷ egg kg (flock-days with feed AND an egg weight)
  feedPerEggG: number | null; // exact: feed kg × 1000 ÷ eggs (all flock-days with feed)
  eggsPerKg: number | null; // 1000 ÷ feedPerEggG (the V17 figure)
  standardFcr: number | null; // the book for the same flock-days (weighted by their eggs)
  standardFeedPerEggG: number | null;
  gap: number | null; // fcr − standardFcr (positive = worse: more feed for each kg of eggs)
  gapPct: number | null;
  feedKg: number; // all flock-days with feed
  eggs: number; // their eggs
  eggKg: number; // egg kg of the flock-days that have an egg weight
  days: number;
  daysWithFeed: number;
  weight: { actualRows: number; standardRows: number; label: string }; // which egg weight was used
  leftOut: string | null; // flock-days with feed but no egg weight, left out of the FCR on both sides
  why: string | null; // plain reason when fcr is null
}

/** The reasons for missing egg weights in one sentence: "past the end of the table (week 114 to 115 …)" is said once. */
function reasons(missing: Map<string, number>): string {
  const out: string[] = [];
  const past: number[] = [];
  let stop = "";
  for (const k of missing.keys()) {
    const m = /^past the end of the breeder's egg-weight table \(week (\d+); the table stops at week (\d+)\)$/.exec(k);
    if (m) { past.push(Number(m[1])); stop = m[2]; } else out.push(k);
  }
  if (past.length) {
    const lo = Math.min(...past);
    const hi = Math.max(...past);
    out.unshift(`past the end of the breeder's egg-weight table (week ${lo === hi ? lo : `${lo} to ${hi}`}; the table stops at week ${stop})`);
  }
  return out.join("; ");
}

/** Pooled FCR over flock-day rows (any mix of flocks and days). */
export function fcrOf(ctx: Ctx, rows: Pick<ProdRow, "date" | "flockId" | "eggs" | "feed">[]): FcrResult {
  const fed = rows.filter((r) => r.feed != null);
  const feedKg = fed.reduce((s, r) => s + (r.feed ?? 0), 0) * BAG_KG;
  const eggs = fed.reduce((s, r) => s + (r.eggs ?? 0), 0);
  let fcrFeedKg = 0;
  let eggKg = 0;
  let actualRows = 0;
  let standardRows = 0;
  let stdFeedKg = 0;
  let stdEggKg = 0;
  let stdEggs = 0;
  const missing = new Map<string, number>(); // reason -> flock-days
  for (const r of fed) {
    const w = eggWeightFor(ctx, r.flockId, r.date);
    if (w.grams == null) {
      missing.set(w.why ?? "no egg weight", (missing.get(w.why ?? "no egg weight") ?? 0) + 1);
      continue;
    }
    const e = r.eggs ?? 0;
    fcrFeedKg += (r.feed ?? 0) * BAG_KG;
    eggKg += (e * w.grams) / 1000;
    if (w.source === "actual") actualRows++;
    else standardRows++;
    const b = bookRow(ctx, r.flockId, r.date).row;
    if (b?.feedPerEggWeekG != null && b.eggWeightG != null && e > 0) {
      stdFeedKg += (e * b.feedPerEggWeekG) / 1000;
      stdEggKg += (e * b.eggWeightG) / 1000;
      stdEggs += e;
    }
  }
  const days = new Set(rows.map((r) => r.date)).size;
  const daysWithFeed = new Set(fed.map((r) => r.date)).size;
  let why: string | null = null;
  if (rows.length === 0) why = "no data on these days";
  else if (fed.length === 0) why = "feed not recorded on these days";
  else if (eggKg <= 0) why = missing.size ? reasons(missing) : "no eggs laid on the days with feed";
  const fcr = why ? null : fcrFeedKg / eggKg;
  const standardFcr = stdEggKg > 0 ? stdFeedKg / stdEggKg : null;
  const leftRows = [...missing.values()].reduce((s, n) => s + n, 0);
  return {
    fcr,
    feedPerEggG: eggs > 0 && fed.length ? (feedKg * 1000) / eggs : null,
    eggsPerKg: feedKg > 0 ? eggs / feedKg : null,
    standardFcr,
    standardFeedPerEggG: stdEggs > 0 ? (stdFeedKg * 1000) / stdEggs : null,
    gap: fcr != null && standardFcr != null ? fcr - standardFcr : null,
    gapPct: fcr != null && standardFcr ? ((fcr - standardFcr) / standardFcr) * 100 : null,
    feedKg,
    eggs,
    eggKg,
    days,
    daysWithFeed,
    weight: {
      actualRows,
      standardRows,
      label: actualRows && standardRows ? `actual egg weight on ${actualRows} flock-days, standard on ${standardRows}` : actualRows ? "actual egg weight" : "standard egg weight",
    },
    leftOut: why == null && leftRows ? `${leftRows} flock-day${leftRows === 1 ? "" : "s"} with feed left out of the FCR: ${reasons(missing)}` : null,
    why,
  };
}

/** A group (or chosen flocks) over a list of dates. */
export function fcrOn(ctx: Ctx, dates: string[], seg: SegFilter = "all", only?: ReadonlySet<string>): FcrResult {
  return fcrOf(ctx, dates.flatMap((d) => rowsOn(ctx, d, seg, only)));
}

/** "FCR (estimated from standard egg weight)" / "(actual egg weight)" / mixed: the label every FCR number carries. */
export function fcrLabel(r: Pick<FcrResult, "weight">): string {
  return r.weight.actualRows && !r.weight.standardRows ? "FCR (actual egg weight)" : r.weight.actualRows ? `FCR (${r.weight.label})` : "FCR (estimated from standard egg weight)";
}

export interface BoardFcr {
  date: string;
  day: FcrResult;
  week: FcrResult & { from: string | null; to: string | null };
  prevWeek: FcrResult & { from: string | null; to: string | null };
  change: { abs: number; pct: number; good: boolean | null } | null; // lower FCR = good
}

/** The board tile: the day, the last 7 days with rows and the 7 days before, for one group. */
export function boardFcr(ctx: Ctx, asOf: string, seg: Segment): BoardFcr {
  const last7 = lastDatesWithRows(ctx, asOf, seg, 7);
  const prev7 = last7.length ? lastDatesWithRows(ctx, last7[last7.length - 1], seg, 7, true) : [];
  const week = fcrOn(ctx, last7, seg);
  const prevWeek = fcrOn(ctx, prev7, seg);
  const change = week.fcr != null && prevWeek.fcr != null && prevWeek.fcr > 0 ? { abs: week.fcr - prevWeek.fcr, pct: ((week.fcr - prevWeek.fcr) / prevWeek.fcr) * 100, good: Math.abs(week.fcr - prevWeek.fcr) < 1e-9 ? null : week.fcr < prevWeek.fcr } : null;
  return {
    date: asOf,
    day: fcrOn(ctx, rowsOn(ctx, asOf, seg).length ? [asOf] : [], seg),
    week: { ...week, from: last7[last7.length - 1] ?? null, to: last7[0] ?? null },
    prevWeek: { ...prevWeek, from: prev7[prev7.length - 1] ?? null, to: prev7[0] ?? null },
    change,
  };
}

/** One flock: its own row on the day and its own last 7 rows. */
export function flockFcr(ctx: Ctx, flockId: string, asOf: string): { day: FcrResult; week: FcrResult } {
  const rows = (ctx.byFlock.get(flockId) ?? []).filter((r) => r.date <= asOf);
  return { day: fcrOf(ctx, rows.filter((r) => r.date === asOf)), week: fcrOf(ctx, rows.slice(Math.max(0, rows.length - 7))) };
}

/** FCR by day for the last `days` calendar days (null = no feed or no egg weight) and the 7-day pooled line. */
export function fcrTrend(ctx: Ctx, asOf: string, seg: Segment, days = 30): { date: string; value: number | null; avg7: number | null }[] {
  const out: { date: string; value: number | null; avg7: number | null }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(asOf, -i);
    const has = rowsOn(ctx, d, seg).length > 0;
    out.push({ date: d, value: has ? fcrOn(ctx, [d], seg).fcr : null, avg7: has ? fcrOn(ctx, lastDatesWithRows(ctx, d, seg, 7), seg).fcr : null });
  }
  return out;
}
