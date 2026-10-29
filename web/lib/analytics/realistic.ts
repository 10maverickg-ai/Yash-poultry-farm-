// The REALISTIC TARGET (V10; seasons and the death rate in V11): what this farm can reasonably do, learned from its OWN
// records, shown next to the breeder's book (BV300) and never instead of it. Pure functions (no database): the same code
// runs in the pages and in scripts/realistic-check.mts, scripts/realistic-report.mts and scripts/farm-reference-report.mts.
//
// How it is learned (docs/DECISIONS.md, and the "How is this learned?" and "Farm reference" screens):
//   1. Every flock-day gets a "ratio to book" = what the flock did / what the breeder's table says for its age.
//        HD:        eggs ÷ birds × 100  ÷  book HD %            (all groups)
//        feed:      bags × 45 kg ÷ birds  ÷  book feed g/bird   (main group only: the left page has no feed column)
//      DEATHS are NOT a ratio to the book (V11). The book assumes a modern controlled-environment house, so the
//      death target is the farm's own weekly death rate: deaths in 7 days ÷ the week's average birds × 100.
//   2. Only HEALTHY days count (see prepare below): not flagged for a data problem, not in a moult, not in the first
//      14 days of lay, nothing missing, and not the last 7 days of a flock that left. (HD and feed also leave out
//      mortality-spike days. Deaths keep spike days — they are real deaths — but a WEEK above the starting red limit is a "bad week":
//      it alerts, and it is left out of what counts as "usual".)
//   3. Healthy days are averaged over 7-day rolling windows (at least 4 healthy days; deaths at least 5) and grouped into
//      5-week AGE BANDS, separately for the main and the young group, AND separately for each Punjab SEASON.
//   4. Band value = the 70th percentile of those rolling values ("a reasonable good week on this farm"; for deaths:
//      the weekly rate that 70% of weeks stay under). A band-and-season needs at least 28 healthy flock-days from at
//      least 2 different flocks, otherwise it falls back to the all-season value ("all seasons"), and for deaths
//      finally to the starting values below. HD and feed are NEVER above the book.
//   5. Realistic target for a flock today = the book value at its age × its band's ratio. An owner override wins.
import { breedKey, diffDays, addDays, firstLayDate, lastDayOfData, moultOn, segmentOn, stdFor, type Ctx, type FlockRef, type ProdRow, type RealisticDeathTarget, type RealisticHdTarget } from "./engine";
import type { RealisticBand, RealisticModel, RealisticOverride, RGroup, RMetric, Season, SeasonKey } from "./realisticTypes";

/** Every threshold in one place. Nothing about the learning is hidden anywhere else. */
export const REALISTIC_CONFIG = {
  /** A "good week on this farm" = this percentile of the 7-day rolling healthy-day values (confirmed by the owner, 29 Oct 2026). */
  percentile: 70,
  /** Deaths: the weekly death rate that this share of the farm's own weeks stay under ("our usual"). */
  deathPercentile: 70,
  /** A band (and a band-and-season) needs at least this many healthy flock-days ... */
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
  /** A weekly death rate needs at least this many healthy days in its 7-day window (a window with 5 or 6 is scaled up to 7). */
  minDeathDaysInWindow: 5,
  /** The last days of a flock that has left the register are left out (it was being sold or moved). */
  departedTrailingDays: 7,
  /** For flocks whose placement date is the CHICK ARRIVAL date, laying age = age − this many weeks (used only to choose the band). */
  chickToLayingWeeks: 18,
  /** Traffic light against the realistic target (same cut-offs as before, now relative to the realistic target, not the book). */
  greenMinRatio: 0.9,
  amberMinRatio: 0.8,
  /** An amber "slipping" warning when a band's learned ratio moves the wrong way by more than this many points between two monthly computations. */
  slipPoints: 3,

  // ---- Punjab seasons (V11) -------------------------------------------------------------------------------------
  /** Month (1-12) → season, for Dandrala / Mohali. Change a letter here and the whole app follows.
   *  HOT     Apr–Jun: dry heat, up to 45 °C.
   *  MONSOON Jul–Sep: hot and humid.
   *  COOL    Oct–Nov: the comfortable months.
   *  COLD    Dec–Feb: fog, down to 2–5 °C.
   *  SPRING  Mar: warming up, mild. */
  seasonByMonth: { 1: "COLD", 2: "COLD", 3: "SPRING", 4: "HOT", 5: "HOT", 6: "HOT", 7: "MONSOON", 8: "MONSOON", 9: "MONSOON", 10: "COOL", 11: "COOL", 12: "COLD" } as Record<number, Season>,
  /** Which death-limit family a season uses. */
  deathClass: { HOT: "hot", MONSOON: "hot", COOL: "cool", COLD: "cool", SPRING: "cool" } as Record<Season, "cool" | "hot">,
  /** STARTING death limits (% of birds per week) used until a band has enough data of its own. They come from the farm's own
   *  2026 data (cool-month median about 0.19, hot/humid median about 0.38) and are NOT a published standard: confirm with the vet. */
  deathStart: { cool: { amber: 0.35, red: 0.6 }, hot: { amber: 0.55, red: 0.9 } } as Record<"cool" | "hot", { amber: number; red: number }>,
  /** Once "our usual" death rate is learned (or set by the owner), a week is amber above usual × this, red above usual × the second. */
  deathAmberMultiple: 1.5,
  deathRedMultiple: 2.5,
  /** Guard rail: learning may relax the limits, but a week above the STARTING red limit is always at least amber, and the learned red
   *  limit is never above this multiple of the starting red limit. So a bad month in a thin band cannot silence its own alert. */
  deathRedCapMultiple: 2,
  /** A week whose death rate is above the STARTING red limit of its season is a bad week: it still alerts, but it is not used to learn
   *  what is "usual" (otherwise a bad month in a band with only two flocks would redefine normal and silence its own alert). */
  deathLearnSkipsBadWeeks: true,

  // ---- Heat and cold (V11 M4) ---------------------------------------------------------------------------------
  /** A hot day: max temperature above this, or above the second with humidity above the third (percent). */
  hotMaxC: 35,
  humidHotMaxC: 30,
  humidPct: 70,
  /** Forecast alert: max temperature at or above this, or min temperature below the second. */
  forecastHotC: 38,
  forecastColdC: 4,
};

export const SEASON_NAME: Record<Season, string> = { HOT: "Hot (Apr–Jun)", MONSOON: "Monsoon (Jul–Sep)", COOL: "Cool (Oct–Nov)", COLD: "Cold (Dec–Feb)", SPRING: "Spring (Mar)" };
export const SEASONS: Season[] = ["HOT", "MONSOON", "COOL", "COLD", "SPRING"];
export const seasonLabel = (k: SeasonKey) => (k === "all" ? "all seasons" : SEASON_NAME[k].split(" ")[0].toLowerCase());

export function seasonOf(date: string, cfg = REALISTIC_CONFIG): Season {
  return cfg.seasonByMonth[Number(date.slice(5, 7))];
}

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
 * Weekly death rate, percent of birds: deaths in the window ÷ the window's average birds × 100. A window with fewer than
 * 7 days is scaled up to 7; fewer than `minDays` rows with both numbers gives null (not enough to say).
 */
export function weeklyDeathRate(rows: { mort: number | null; pop: number | null }[], minDays = REALISTIC_CONFIG.minDeathDaysInWindow, days = REALISTIC_CONFIG.rollingDays): number | null {
  const ok = rows.filter((r) => r.mort != null && r.pop != null && r.pop > 0);
  if (ok.length < minDays) return null;
  const deaths = ok.reduce((s, r) => s + r.mort!, 0) * (days / ok.length);
  const pop = ok.reduce((s, r) => s + r.pop!, 0) / ok.length;
  return (deaths / pop) * 100;
}

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
  season: Season;
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
}

function prepare(ctx: Ctx, asOf: string, cfg: typeof REALISTIC_CONFIG): Day[] {
  const days: Day[] = [];
  const std = ctx.input.std;
  const feedBook = new Map<number, number>();
  for (const s of std) if (s.feedG != null) feedBook.set(s.age, s.feedG);
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
        !moultOn(ctx, flockId, r.date) && // never mix a flock's moult days
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
      const healthyMort = common && r.mort != null && r.pop != null && r.pop > 0; // spikes are real deaths: kept
      days.push({ date: r.date, season: seasonOf(r.date, cfg), flockId, group, band, healthyHd, ratioHd, healthyFeed, ratioFeed, healthyMort, mort: r.mort, pop: r.pop });
    }
  }
  return days;
}

type Acc = { daysSeen: number; healthy: number; flocks: Set<string>; from: string | null; to: string | null; values: number[] };
const keyOf = (g: RGroup, m: RMetric, b: number, s: SeasonKey) => `${g}|${m}|${b}|${s}`;

/** Learn the realistic bands from everything recorded up to `asOf`. */
export function learnRealistic(ctx: Ctx, asOf: string, overrides: RealisticOverride[] = ctx.input.realisticOverrides ?? [], cfg = REALISTIC_CONFIG): RealisticModel {
  const days = prepare(ctx, asOf, cfg);
  const acc = new Map<string, Acc>();
  const get = (g: RGroup, m: RMetric, b: number, s: SeasonKey) => {
    const k = keyOf(g, m, b, s);
    let a = acc.get(k);
    if (!a) acc.set(k, (a = { daysSeen: 0, healthy: 0, flocks: new Set(), from: null, to: null, values: [] }));
    return a;
  };
  // every day counts toward the all-season band and toward its own season's band
  const both = (g: RGroup, m: RMetric, b: number, season: Season, fn: (a: Acc) => void) => {
    fn(get(g, m, b, "all"));
    fn(get(g, m, b, season));
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
    both(d.group, "hd", d.band, d.season, (a) => a.daysSeen++);
    if (d.group === "main") both(d.group, "feed", d.band, d.season, (a) => a.daysSeen++);
    both(d.group, "mortality", d.band, d.season, (a) => a.daysSeen++);
  }
  for (const list of byFlock.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (d.band == null) continue;
      const win = list.filter((x) => diffDays(d.date, x.date) >= 0 && diffDays(d.date, x.date) < cfg.rollingDays);
      if (d.healthyHd) {
        const w = win.filter((x) => x.healthyHd);
        const v = w.length >= cfg.minHealthyInWindow ? w.reduce((s, x) => s + x.ratioHd!, 0) / w.length : null;
        both(d.group, "hd", d.band, d.season, (a) => { touch(a, d); if (v != null) a.values.push(v); });
      }
      if (d.healthyFeed) {
        const w = win.filter((x) => x.healthyFeed);
        const v = w.length >= cfg.minHealthyInWindow ? w.reduce((s, x) => s + x.ratioFeed!, 0) / w.length : null;
        both(d.group, "feed", d.band, d.season, (a) => { touch(a, d); if (v != null) a.values.push(v); });
      }
      if (d.healthyMort) {
        const v = weeklyDeathRate(win.filter((x) => x.healthyMort));
        const bad = cfg.deathLearnSkipsBadWeeks && v != null && v > cfg.deathStart[cfg.deathClass[d.season]].red;
        if (!bad) both(d.group, "mortality", d.band, d.season, (a) => { touch(a, d); if (v != null) a.values.push(v); });
      }
    }
  }

  const over = new Map(overrides.map((o) => [`${o.group}|${o.metric}|${Math.floor(o.bandStart / cfg.bandWeeks)}`, o]));
  const capHd = (m: RMetric, r: number) => (m === "hd" || m === "feed" ? Math.min(r, 1) : r);
  const mk = (group: RGroup, metric: RMetric, band: number, season: SeasonKey, a: Acc | undefined): RealisticBand => {
    const x = a ?? { daysSeen: 0, healthy: 0, flocks: new Set<string>(), from: null, to: null, values: [] };
    let learned: number | null = null;
    let why: string | null = null;
    if (x.healthy < cfg.minHealthyDays) why = `only ${x.healthy} healthy flock-days (needs ${cfg.minHealthyDays})`;
    else if (x.flocks.size < cfg.minFlocks) why = `only ${x.flocks.size} flock (needs ${cfg.minFlocks})`;
    else if (x.values.length === 0) why = "no 7-day window with enough healthy days";
    else learned = percentile(x.values, metric === "mortality" ? cfg.deathPercentile : cfg.percentile)!;
    const o = over.get(`${group}|${metric}|${band}`);
    const isRate = metric === "mortality";
    const learnedRatio = !isRate && learned != null ? capHd(metric, learned) : null;
    const learnedRate = isRate ? learned : null;
    const ovRatio = o && !isRate ? capHd(metric, o.ratioPct / 100) : null;
    const ovRate = o && isRate ? o.ratioPct : null;
    const ratio = ovRatio ?? learnedRatio;
    const rate = ovRate ?? learnedRate;
    return {
      group,
      metric,
      season,
      band,
      fromWeek: band * cfg.bandWeeks,
      toWeek: band * cfg.bandWeeks + cfg.bandWeeks - 1,
      daysSeen: x.daysSeen,
      healthyDays: x.healthy,
      flocks: x.flocks.size,
      dateFrom: x.from,
      dateTo: x.to,
      samples: x.values.length,
      learnedRatio,
      override: ovRatio,
      ratio,
      learnedRate,
      overrideRate: ovRate,
      rate,
      notLearnedReason: learned == null ? why ?? "no data" : null,
      source: ovRatio != null || ovRate != null ? "owner" : learned != null ? "learned" : "none",
    };
  };
  const bands: RealisticBand[] = [];
  const seen = new Set<string>();
  for (const [k, a] of acc) {
    const [group, metric, bs, season] = k.split("|") as [RGroup, RMetric, string, SeasonKey];
    seen.add(k);
    bands.push(mk(group, metric, Number(bs), season, a));
  }
  // an override for a band that has no data at all is still honoured (in the all-season row)
  for (const [k, o] of over) {
    const [group, metric, bs] = k.split("|") as [RGroup, RMetric, string];
    if (seen.has(`${k}|all`)) continue;
    bands.push(mk(group, metric, Number(bs), "all", undefined));
    void o;
  }
  const sOrder = (s: SeasonKey) => (s === "all" ? -1 : SEASONS.indexOf(s));
  bands.sort((a, b) =>
    a.group !== b.group ? (a.group < b.group ? -1 : 1) : a.metric !== b.metric ? (a.metric < b.metric ? -1 : 1) : a.band !== b.band ? a.band - b.band : sOrder(a.season) - sOrder(b.season),
  );
  return { asOf, bands };
}

/**
 * The band to use for a group, measure, age and date: the owner's override if there is one, else the learned value for the
 * date's season, else the all-season value. `seasonUsed` says which ("all" = all seasons).
 */
export function findBand(model: RealisticModel, group: RGroup, metric: RMetric, ageWeeks: number, season?: Season, cfg = REALISTIC_CONFIG): RealisticBand | null {
  const b = bandIndex(ageWeeks, cfg);
  const mine = model.bands.filter((x) => x.group === group && x.metric === metric && x.band === b);
  const used = (x: RealisticBand) => (metric === "mortality" ? x.rate : x.ratio) != null;
  const owner = mine.find((x) => x.source === "owner");
  if (owner) return mine.find((x) => x.season === "all" && x.source === "owner") ?? owner;
  const seasonal = season ? mine.find((x) => x.season === season && used(x)) : undefined;
  if (seasonal) return seasonal;
  return mine.find((x) => x.season === "all") ?? null;
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
  const band = findBand(model, group, "hd", age, seasonOf(date, cfg), cfg);
  if (!band || band.ratio == null) return none("realistic target not learned yet for this age", book.std, band);
  return { value: round1(book.std * band.ratio), book: book.std, ratio: band.ratio, band, source: band.source === "owner" ? "owner" : "learned", reason: null };
}

/** Which death limits apply, with plain words saying where they come from. */
export interface DeathLimits {
  usual: number | null; // our usual weekly death rate, % of birds (null = starting values still in use)
  amber: number;
  red: number;
  source: "learned" | "owner" | "starting";
  seasonUsed: SeasonKey; // which season's data the value comes from ("all" = all seasons together)
  band: RealisticBand | null;
}

export function deathLimits(model: RealisticModel | undefined, group: RGroup, ageWeeks: number | null, date: string, cfg = REALISTIC_CONFIG): DeathLimits {
  const season = seasonOf(date, cfg);
  const start = cfg.deathStart[cfg.deathClass[season]];
  const band = model && ageWeeks != null && ageWeeks >= 0 ? findBand(model, group, "mortality", ageWeeks, season, cfg) : null;
  if (band && band.rate != null) {
    const amber = Math.min(band.rate * cfg.deathAmberMultiple, start.red);
    const red = Math.max(Math.min(band.rate * cfg.deathRedMultiple, start.red * cfg.deathRedCapMultiple), amber * 1.2);
    return { usual: band.rate, amber, red, source: band.source === "owner" ? "owner" : "learned", seasonUsed: band.season, band };
  }
  return { usual: null, amber: start.amber, red: start.red, source: "starting", seasonUsed: season, band };
}

/** Deaths this week for a flock on a date and how it compares with our usual and the book (null when there are too few rows). */
export function deathTargetFor(ctx: Ctx, flockId: string, date: string, model: RealisticModel | undefined = ctx.realistic, cfg = REALISTIC_CONFIG): RealisticDeathTarget {
  const flock = ctx.flockById.get(flockId);
  const rows = (ctx.byFlock.get(flockId) ?? []).filter((r) => r.date <= date && diffDays(date, r.date) < cfg.rollingDays);
  const weekPct = weeklyDeathRate(rows);
  const group = segmentOn(ctx, flockId, date);
  const age = flock ? bandAgeWeeks(flock, date, cfg) : null;
  // the book: weekly depletion at the flock's age (book age = age from placement date, as everywhere else)
  const bookAge = flock ? stdFor(ctx, flock, date).age : null;
  const cum = new Map(ctx.input.std.filter((s) => s.cumDepl != null).map((s) => [s.age, s.cumDepl!]));
  const bookPct = flock && breedKey(flock.breed) === "BV300" && bookAge != null && cum.has(bookAge) && cum.has(bookAge - 1) ? cum.get(bookAge)! - cum.get(bookAge - 1)! : null;
  if (!group) return { weekPct, usual: null, amber: null, red: null, source: "starting", seasonLabel: "", bookPct, status: "none" };
  const lim = deathLimits(model, group, age, date, cfg);
  const status = weekPct == null ? "none" : weekPct > lim.red ? "red" : weekPct > lim.amber ? "amber" : "green";
  return { weekPct, usual: lim.usual, amber: lim.amber, red: lim.red, source: lim.source, seasonLabel: lim.source === "starting" ? `${seasonLabel(lim.seasonUsed)} starting value` : lim.source === "owner" ? "set by owner" : seasonLabel(lim.seasonUsed), bookPct, status };
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

/** Egg-production (HD) all-season bands whose LEARNED ratio fell by more than cfg.slipPoints between two consecutive computations. */
export function findSlips(history: RealisticModel[], cfg = REALISTIC_CONFIG): Slip[] {
  const out: Slip[] = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const now = history[i];
    for (const b of now.bands) {
      if (b.metric !== "hd" || b.season !== "all" || b.learnedRatio == null) continue; // egg production only; seasons are compared with themselves later
      const p = prev.bands.find((x) => x.group === b.group && x.metric === b.metric && x.band === b.band && x.season === "all");
      if (!p || p.learnedRatio == null) continue;
      const wrong = (p.learnedRatio - b.learnedRatio) * 100; // a fall in the learned level
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
  ctx.realisticHistory = cache.history;
  const model = cache.model;
  ctx.realisticHd = (flockId, date): RealisticHdTarget => {
    const t = realisticFor(ctx, flockId, date, model);
    return {
      value: t.value,
      book: t.book,
      ratio: t.ratio,
      source: t.source,
      reason: t.reason,
      bandLabel: t.band ? `weeks ${t.band.fromWeek}-${t.band.toWeek}` : null,
      seasonLabel: t.band ? (t.source === "owner" ? "set by owner" : seasonLabel(t.band.season)) : null,
    };
  };
  ctx.realisticDeath = (flockId, date) => deathTargetFor(ctx, flockId, date, model);
  return { model, history: cache.history };
}

const METRIC_WORDS: Record<RMetric, string> = { hd: "eggs per 100 birds", feed: "feed per bird", mortality: "deaths" };
/** Amber "slipping" items for Today / Analytics: the farm's realistic level fell between two monthly computations. */
export function slipItems(ctx: Ctx): { id: string; group: RGroup; title: string; detail: string }[] {
  if (!ctx.realisticHistory) return [];
  // only the latest pair matters for an alert: older slips are history on the "How is this learned?" page
  const h = ctx.realisticHistory;
  if (h.length < 2) return [];
  return findSlips(h.slice(-2)).map((s) => ({
    id: `slip-${s.group}-${s.metric}-${s.band.band}`,
    group: s.group,
    title: `Our realistic level is slipping: ${s.group === "main" ? "main" : "young"} flocks aged ${s.band.fromWeek}–${s.band.toWeek} weeks (${METRIC_WORDS[s.metric]}).`,
    detail: `Learned level was ${(s.from.ratio * 100).toFixed(1)}% of the book at ${s.from.asOf} and is ${(s.to.ratio * 100).toFixed(1)}% at ${s.to.asOf} (${s.points.toFixed(1)} points). Check housing, feed and ventilation.`,
  }));
}
