// The REALISTIC TARGET (V10): what this farm can reasonably do, learned from its OWN records, shown next to the
// breeder's book (BV300) and never instead of it. Pure functions (no database): the same code runs in the pages and
// in scripts/realistic-check.mts and scripts/realistic-report.mts.
//
// How it is learned (docs/DECISIONS.md, and the "How is this learned?" screen):
//   1. Every flock-day gets a "ratio to book" = what the flock did / what the breeder's table says for its age.
//        HD:        eggs ÷ birds × 100  ÷  book HD %            (all groups)
//        feed:      bags × 45 kg ÷ birds  ÷  book feed g/bird   (main group only: the left page has no feed column)
//        mortality: deaths in 7 days ÷ average birds × 100  ÷  book weekly depletion
//   2. Only HEALTHY days count (see isHealthy below): not flagged for a data problem, not in a moult, not in the first
//      14 days of lay, not a mortality spike, nothing missing, and not the last 7 days of a flock that left.
//   3. Healthy days are averaged over 7-day rolling windows (at least 4 healthy days in the window) so one lucky day
//      does not count, and grouped into 5-week AGE BANDS, separately for the main and the young group.
//   4. Band ratio = the 70th percentile of those rolling values ("what this farm does on a good week").
//      A band needs at least 28 healthy flock-days from at least 2 different flocks, otherwise it is "not learned yet".
//      It is NEVER above the book (HD, feed) — and for deaths never BETTER than the book.
//   5. Realistic target for a flock today = the book value at its age × its band's ratio. An owner override wins.
import { breedKey, diffDays, addDays, firstLayDate, lastDayOfData, moultOn, segmentOn, stdFor, type Ctx, type FlockRef, type ProdRow } from "./engine";
import type { RealisticHdTarget } from "./engine";
import type { RealisticBand, RealisticModel, RealisticOverride, RGroup, RMetric } from "./realisticTypes";

/** Every threshold in one place. Nothing about the learning is hidden anywhere else. */
export const REALISTIC_CONFIG = {
  /** A "good week on this farm" = this percentile of the 7-day rolling healthy-day ratios (owner/vet may prefer the median = 50). */
  percentile: 70,
  /** Deaths: lower is better, so "a good week" is the mirrored percentile. */
  mortalityPercentile: 30,
  /** A band needs at least this many healthy flock-days ... */
  minHealthyDays: 28,
  /** ... from at least this many different flocks. */
  minFlocks: 2,
  /** The first days of lay of a flock are ramp-up and are left out. */
  rampDays: 14,
  /** A day with more than this multiple of the flock's own median deaths a day is a spike and is left out (HD and feed). */
  spikeMultiple: 3,
  /** The median deaths used for the spike test is never taken below this (a flock with a median of 0 deaths would otherwise call every death a spike). */
  spikeMedianFloor: 1,
  /** Width of an age band, in weeks. */
  bandWeeks: 5,
  /** Rolling window, in days, and the least number of healthy days it must contain. */
  rollingDays: 7,
  minHealthyInWindow: 4,
  /** The last days of a flock that has left the register are left out (it was being sold or moved). */
  departedTrailingDays: 7,
  /** For flocks whose placement date is the CHICK ARRIVAL date, laying age = age − this many weeks (used only to choose the band). */
  chickToLayingWeeks: 18,
  /** Traffic light against the realistic target (same cut-offs as before, now relative to the realistic target, not the book). */
  greenMinRatio: 0.9,
  amberMinRatio: 0.8,
  /** An amber "slipping" warning when a band's learned ratio moves the wrong way by more than this many points between two monthly computations. */
  slipPoints: 3,
};

// ---- small helpers ---------------------------------------------------------
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (v.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}
const median = (xs: number[]): number => {
  const v = [...xs].sort((a, b) => a - b);
  if (v.length === 0) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * The age (in weeks) that decides which 5-week band a flock-day belongs to. THE ONE PLACE this rule lives:
 * age from the placement date; for a flock whose placement date is the chick arrival date, laying age = age − 18 weeks.
 * (The BOOK age used for the target itself is still the age from the placement date, as everywhere else in the app.)
 */
export function bandAgeWeeks(flock: Pick<FlockRef, "placementDate" | "placementIsChickDate">, date: string, cfg = REALISTIC_CONFIG): number | null {
  if (!flock.placementDate) return null;
  const age = Math.floor(diffDays(date, flock.placementDate) / 7);
  return flock.placementIsChickDate ? age - cfg.chickToLayingWeeks : age;
}
export const bandIndex = (ageWeeks: number, cfg = REALISTIC_CONFIG) => Math.floor(ageWeeks / cfg.bandWeeks);

// ---- one flock-day -----------------------------------------------------------
interface Day {
  date: string;
  flockId: string;
  group: RGroup;
  band: number | null;
  healthyHd: boolean;
  ratioHd: number | null;
  healthyFeed: boolean;
  ratioFeed: number | null;
  healthyMort: boolean;
  mort: number | null;
  pop: number | null;
  mortBook: number | null;
}

function prepare(ctx: Ctx, asOf: string, cfg: typeof REALISTIC_CONFIG): Day[] {
  const days: Day[] = [];
  const std = ctx.input.std;
  const feedBook = new Map<number, number>();
  const cum = new Map<number, number>();
  for (const s of std) {
    if (s.feedG != null) feedBook.set(s.age, s.feedG);
    if (s.cumDepl != null) cum.set(s.age, s.cumDepl);
  }
  const lastDay = ctx.dates.filter((d) => d <= asOf).slice(-1)[0] ?? asOf;
  for (const [flockId, all] of ctx.byFlock) {
    const flock = ctx.flockById.get(flockId);
    if (!flock) continue;
    const rows = all.filter((r) => r.date <= asOf);
    if (rows.length === 0) continue;
    const departed = rows[rows.length - 1].date < lastDay;
    const leaving = new Set(departed ? rows.slice(-cfg.departedTrailingDays).map((r) => r.date) : []);
    const med = Math.max(median(rows.map((r) => r.mort).filter((x): x is number => x != null)), cfg.spikeMedianFloor);
    const firstLay = firstLayDate(ctx, flockId);
    const isBV300 = breedKey(flock.breed) === "BV300";
    for (const r of rows) {
      const group = segmentOn(ctx, flockId, r.date);
      if (!group) continue;
      const age = bandAgeWeeks(flock, r.date, cfg);
      const band = age != null && age >= 0 ? bandIndex(age, cfg) : null;
      const book = stdFor(ctx, flock, r.date);
      const bookAge = book.age;
      const common =
        !(r.flagged && !r.reviewed) && // a data problem the owner has not accepted
        !moultOn(ctx, flockId, r.date) &&
        !(firstLay != null && diffDays(r.date, firstLay) < cfg.rampDays) &&
        !leaving.has(r.date) &&
        band != null;
      const spike = r.mort != null && r.mort > cfg.spikeMultiple * med;
      const hasEggs = r.eggs != null && r.pop != null && r.pop > 0;
      const needsFeed = group === "main"; // the left page has no feed column by design
      const healthyHd = common && !spike && hasEggs && (!needsFeed || r.feed != null) && book.std != null;
      const ratioHd = healthyHd ? ((r.eggs! / r.pop!) * 100) / book.std! : null;
      const fBook = isBV300 && bookAge != null ? feedBook.get(bookAge) ?? null : null;
      const healthyFeed = common && !spike && group === "main" && r.feed != null && r.pop != null && r.pop > 0 && fBook != null && fBook > 0;
      const ratioFeed = healthyFeed ? (r.feed! * 45000) / r.pop! / fBook! : null;
      const mBook = isBV300 && bookAge != null && cum.has(bookAge) && cum.has(bookAge - 1) ? cum.get(bookAge)! - cum.get(bookAge - 1)! : null;
      const healthyMort = common && r.mort != null && r.pop != null && r.pop > 0 && mBook != null && mBook > 0; // spikes are real deaths: kept
      days.push({ date: r.date, flockId, group, band, healthyHd, ratioHd, healthyFeed, ratioFeed, healthyMort, mort: r.mort, pop: r.pop, mortBook: mBook });
    }
  }
  return days;
}

type Acc = { daysSeen: number; healthy: number; flocks: Set<string>; from: string | null; to: string | null; values: number[] };
const keyOf = (g: RGroup, m: RMetric, b: number) => `${g}|${m}|${b}`;

/** Learn the realistic bands from everything recorded up to `asOf`. */
export function learnRealistic(ctx: Ctx, asOf: string, overrides: RealisticOverride[] = ctx.input.realisticOverrides ?? [], cfg = REALISTIC_CONFIG): RealisticModel {
  const days = prepare(ctx, asOf, cfg);
  const acc = new Map<string, Acc>();
  const get = (g: RGroup, m: RMetric, b: number) => {
    const k = keyOf(g, m, b);
    let a = acc.get(k);
    if (!a) acc.set(k, (a = { daysSeen: 0, healthy: 0, flocks: new Set(), from: null, to: null, values: [] }));
    return a;
  };
  const touch = (a: Acc, d: Day) => {
    a.healthy++;
    a.flocks.add(d.flockId);
    if (!a.from || d.date < a.from) a.from = d.date;
    if (!a.to || d.date > a.to) a.to = d.date;
  };
  const byFlock = new Map<string, Day[]>();
  for (const d of days) (byFlock.get(d.flockId) ?? byFlock.set(d.flockId, []).get(d.flockId)!).push(d);

  for (const d of days) {
    if (d.band == null) continue;
    get(d.group, "hd", d.band).daysSeen++;
    if (d.group === "main") get(d.group, "feed", d.band).daysSeen++;
    get(d.group, "mortality", d.band).daysSeen++;
  }
  for (const list of byFlock.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (d.band == null) continue;
      const win = list.filter((x) => diffDays(d.date, x.date) >= 0 && diffDays(d.date, x.date) < cfg.rollingDays);
      if (d.healthyHd) {
        touch(get(d.group, "hd", d.band), d);
        const w = win.filter((x) => x.healthyHd);
        if (w.length >= cfg.minHealthyInWindow) get(d.group, "hd", d.band).values.push(w.reduce((s, x) => s + x.ratioHd!, 0) / w.length);
      }
      if (d.healthyFeed) {
        touch(get(d.group, "feed", d.band), d);
        const w = win.filter((x) => x.healthyFeed);
        if (w.length >= cfg.minHealthyInWindow) get(d.group, "feed", d.band).values.push(w.reduce((s, x) => s + x.ratioFeed!, 0) / w.length);
      }
      if (d.healthyMort) {
        touch(get(d.group, "mortality", d.band), d);
        const w = win.filter((x) => x.healthyMort);
        // deaths over the week: scale a window with 5-6 healthy days up to 7; ratio to the book's weekly depletion at that age
        if (w.length >= 5) {
          const deaths = w.reduce((s, x) => s + (x.mort ?? 0), 0) * (cfg.rollingDays / w.length);
          const pop = w.reduce((s, x) => s + (x.pop ?? 0), 0) / w.length;
          get(d.group, "mortality", d.band).values.push(((deaths / pop) * 100) / d.mortBook!);
        }
      }
    }
  }

  const over = new Map(overrides.map((o) => [keyOf(o.group, o.metric, Math.floor(o.bandStart / cfg.bandWeeks)), o]));
  const bands: RealisticBand[] = [];
  for (const [k, a] of acc) {
    const [group, metric, bs] = k.split("|") as [RGroup, RMetric, string];
    const band = Number(bs);
    let learned: number | null = null;
    let why: string | null = null;
    if (a.healthy < cfg.minHealthyDays) why = `only ${a.healthy} healthy flock-days (needs ${cfg.minHealthyDays})`;
    else if (a.flocks.size < cfg.minFlocks) why = `only ${a.flocks.size} flock (needs ${cfg.minFlocks})`;
    else if (a.values.length === 0) why = "no 7-day window with enough healthy days";
    else {
      const p = percentile(a.values, metric === "mortality" ? cfg.mortalityPercentile : cfg.percentile)!;
      learned = metric === "mortality" ? Math.max(p, 1) : Math.min(p, 1); // never above the book; deaths never better than the book
    }
    const o = over.get(k);
    const ov = o ? (metric === "mortality" ? Math.max(o.ratioPct / 100, 1) : Math.min(o.ratioPct / 100, 1)) : null;
    bands.push({
      group,
      metric,
      band,
      fromWeek: band * cfg.bandWeeks,
      toWeek: band * cfg.bandWeeks + cfg.bandWeeks - 1,
      daysSeen: a.daysSeen,
      healthyDays: a.healthy,
      flocks: a.flocks.size,
      dateFrom: a.from,
      dateTo: a.to,
      samples: a.values.length,
      learnedRatio: learned,
      notLearnedReason: learned == null ? why : null,
      override: ov,
      ratio: ov ?? learned,
      source: ov != null ? "owner" : learned != null ? "learned" : "none",
    });
  }
  // an override for a band that has no data at all is still honoured
  for (const [k, o] of over) {
    if (acc.has(k)) continue;
    const [group, metric, bs] = k.split("|") as [RGroup, RMetric, string];
    const band = Number(bs);
    const ov = metric === "mortality" ? Math.max(o.ratioPct / 100, 1) : Math.min(o.ratioPct / 100, 1);
    bands.push({ group, metric, band, fromWeek: band * cfg.bandWeeks, toWeek: band * cfg.bandWeeks + cfg.bandWeeks - 1, daysSeen: 0, healthyDays: 0, flocks: 0, dateFrom: null, dateTo: null, samples: 0, learnedRatio: null, notLearnedReason: "no data", override: ov, ratio: ov, source: "owner" });
  }
  bands.sort((a, b) => (a.group === b.group ? (a.metric === b.metric ? a.band - b.band : a.metric < b.metric ? -1 : 1) : a.group < b.group ? -1 : 1));
  return { asOf, bands };
}

export function findBand(model: RealisticModel, group: RGroup, metric: RMetric, ageWeeks: number, cfg = REALISTIC_CONFIG): RealisticBand | null {
  const b = bandIndex(ageWeeks, cfg);
  return model.bands.find((x) => x.group === group && x.metric === metric && x.band === b) ?? null;
}

export interface RealisticTarget {
  value: number | null; // realistic HD for the flock on that date (eggs per 100 birds)
  book: number | null;
  ratio: number | null;
  band: RealisticBand | null;
  source: "learned" | "owner" | "none";
  reason: string | null; // plain words when value is null
}

/** The realistic HD target for a flock on a date, from the model attached to the context (or the one given). */
export function realisticFor(ctx: Ctx, flockId: string, date: string, model: RealisticModel | undefined = ctx.realistic, cfg = REALISTIC_CONFIG): RealisticTarget {
  const none = (reason: string, book: number | null = null, band: RealisticBand | null = null): RealisticTarget => ({ value: null, book, ratio: null, band, source: "none", reason });
  const flock = ctx.flockById.get(flockId);
  if (!model || !flock) return none("realistic target not learned yet");
  const group = segmentOn(ctx, flockId, date);
  if (!group) return none("this flock has no group (main / young) set");
  const book = stdFor(ctx, flock, date);
  if (book.std == null) return none(book.why, null);
  const age = bandAgeWeeks(flock, date, cfg);
  if (age == null || age < 0) return none("realistic target not learned yet for this age", book.std);
  const band = findBand(model, group, "hd", age, cfg);
  if (!band || band.ratio == null) return none("realistic target not learned yet for this age", book.std, band);
  return { value: round1(book.std * band.ratio), book: book.std, ratio: band.ratio, band, source: band.source === "owner" ? "owner" : "learned", reason: null };
}

// ---- how the learned level has moved ----------------------------------------
/** Month-end computations (and the latest day) so the screen can show how the realistic level moved. */
export function learnHistory(ctx: Ctx, overrides: RealisticOverride[] = ctx.input.realisticOverrides ?? [], cfg = REALISTIC_CONFIG): RealisticModel[] {
  const latest = lastDayOfData(ctx);
  const points = new Set<string>();
  for (const m of new Set(ctx.dates.map((d) => d.slice(0, 7)))) {
    const [y, mo] = m.split("-").map(Number);
    const end = `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
    points.add(end <= latest ? end : latest);
  }
  points.add(latest);
  return [...points].sort().map((d) => learnRealistic(ctx, d, overrides, cfg));
}

export interface Slip {
  group: RGroup;
  metric: RMetric;
  band: RealisticBand;
  from: { asOf: string; ratio: number };
  to: { asOf: string; ratio: number };
  points: number; // percentage points the learned level moved the wrong way
}

/** Bands whose LEARNED ratio moved the wrong way by more than cfg.slipPoints between two consecutive computations. */
export function findSlips(history: RealisticModel[], cfg = REALISTIC_CONFIG): Slip[] {
  const out: Slip[] = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const now = history[i];
    for (const b of now.bands) {
      if (b.learnedRatio == null) continue;
      const p = prev.bands.find((x) => x.group === b.group && x.metric === b.metric && x.band === b.band);
      if (!p || p.learnedRatio == null) continue;
      const wrong = b.metric === "mortality" ? (b.learnedRatio - p.learnedRatio) * 100 : (p.learnedRatio - b.learnedRatio) * 100;
      if (wrong > cfg.slipPoints) out.push({ group: b.group, metric: b.metric, band: b, from: { asOf: prev.asOf, ratio: p.learnedRatio }, to: { asOf: now.asOf, ratio: b.learnedRatio }, points: wrong });
    }
  }
  return out;
}

// ---- the traffic light, against the realistic target --------------------------
export function judge(actual: number, realistic: number, cfg = REALISTIC_CONFIG): "green" | "amber" | "red" {
  const r = actual / realistic;
  return r >= cfg.greenMinRatio ? "green" : r >= cfg.amberMinRatio ? "amber" : "red";
}

// kept for callers that want to look at a row set directly
export type { ProdRow, RealisticModel, RealisticBand, RealisticOverride };
export const addDaysR = addDays;

// ---- attach to a context (cached) ---------------------------------------------
let cache: { key: string; model: RealisticModel; history: RealisticModel[] } | null = null;

/**
 * Learn the model once for this data (cached until the data changes: last day, row count, overrides) and attach it to the
 * context, so flockCards judge against the realistic target. Also returns the month-end history for the trend chart / slip alert.
 */
export function attachRealistic(ctx: Ctx): { model: RealisticModel; history: RealisticModel[] } {
  const ov = ctx.input.realisticOverrides ?? [];
  const asOf = lastDayOfData(ctx);
  const key = `${asOf}|${ctx.input.prod.length}|${JSON.stringify(ov)}|${ctx.input.flocks.map((f) => f.id + (f.segment ?? "") + (f.placementDate ?? "")).join(",")}`;
  if (!cache || cache.key !== key) {
    const history = learnHistory(ctx, ov);
    cache = { key, model: history[history.length - 1], history };
  }
  ctx.realistic = cache.model;
  const model = cache.model;
  ctx.realisticHd = (flockId, date): RealisticHdTarget => {
    const t = realisticFor(ctx, flockId, date, model);
    return { value: t.value, book: t.book, ratio: t.ratio, source: t.source, reason: t.reason, bandLabel: t.band ? `weeks ${t.band.fromWeek}-${t.band.toWeek}` : null };
  };
  return { model, history: cache.history };
}
