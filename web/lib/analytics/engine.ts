// Analytics engine: PURE functions over plain data (no DB, no framework), so
// the same code runs in the page and in scripts/analytics-check.mts against
// exported copies of the real August/September rows.
//
// Conventions (all verified against the real rows, see PR description):
//   - Flock identity is flock_internal_id. The register label
//     (display_label_as_written) shifts when a flock leaves, so it is only
//     ever shown as "the label on that day", never used to join anything.
//   - bird_population is the END-of-day count; the chain is
//       pop(D) = pop(D-1) - mortality(D) + sum(movements on D)
//   - HD% = eggs / bird_population * 100 (the stored hd_percent).
//   - "Own 7-day average" = mean of the flock's previous 7 daily rows (the
//     day itself excluded), rows within the last 14 calendar days only.
//   - Nothing here invents a figure: where a reference or input is missing
//     the result says so ("no reference loaded", null).

import type { RealisticModel, RealisticOverride } from "./realisticTypes";

// The two groups of the farm. MAIN = right page of the register (big eggs, mature flocks);
// YOUNG = left page (small eggs, young flocks still climbing to peak). A flock whose segment
// is not set belongs to neither: it shows up in the whole-farm total only, never guessed.
export type Segment = "main" | "young";
export const SEGMENTS: Segment[] = ["main", "young"];
export const SEGMENT_NAME: Record<Segment, string> = { main: "Main flocks (big eggs)", young: "Young flocks (small eggs)" };
export const SEGMENT_SHORT: Record<Segment, string> = { main: "Main", young: "Young" };
/** A young flock is "ramping up" until this many days after its first laying day. */
export const RAMP_DAYS = 60;

export interface FlockRef {
  id: string;
  label: string; // flocks.display_label: the REAL flock name (register labels shift)
  breed: string | null;
  placementDate: string | null;
  placementConfirmed: boolean; // false for the 2026-01-01 placeholders
  segment?: Segment | null;
  placementIsChickDate?: boolean; // the placement date is the chick arrival date (age counts from day-old)
  // When a flock moved between segments: history keeps the old segment, the new one counts from `from`.
  segmentHistory?: { from: string; segment: Segment | null }[];
}

export interface MoultPeriod {
  flockId: string;
  start: string;
  end: string | null;
  confirmed: boolean;
}

export interface ProdRow {
  id: number;
  date: string;
  flockId: string;
  label: string; // display_label_as_written: the register label that day
  mort: number | null;
  feed: number | null;
  eggs: number | null;
  pop: number | null;
  hd: number | null;
  flagged: boolean;
  reviewed: boolean;
  // Owner-confirmed "never flag" row (V5 section 3: Sep 8/9 feed cells, Sep 15
  // BAB-3 eggs…). Row-level alerts skip it.
  neverFlag?: boolean;
}

export interface Movement {
  id: number;
  date: string;
  flockId: string;
  change: number;
  type: string;
  needsReview: boolean;
  reviewed: boolean;
}

export interface EggSummary {
  id: number;
  date: string;
  section: string; // 'big' | 'small'
  produced: number | null;
  opening: number | null;
  closing: number | null;
  reviewed: boolean;
}

export interface FeedBox {
  id: number;
  date: string;
  group: string;
  opening: number | null;
  produced: number | null;
  consumed: number | null;
  closing: number | null;
  reviewed: boolean;
  flockIds: string[]; // from daily_feed_bag_stock_flocks
}

export interface StdRow {
  age: number;
  hdp: number;
  feedG?: number | null; // book feed per bird per day (g), BV300 table
  cumDepl?: number | null; // book cumulative depletion (%), BV300 table
}

export interface EngineInput {
  flocks: FlockRef[];
  prod: ProdRow[];
  movements: Movement[];
  egg: EggSummary[];
  feedBoxes: FeedBox[];
  chick: { date: string; deaths: number }[];
  farmfreshDates: string[]; // days with a Farmfresh sale line in the egg ledger (category 'sale')
  farmfreshBySection?: { big: string[]; small: string[] }; // the same, per ledger section
  moulting: MoultPeriod[]; // recorded moulting_periods (owner-entered or pre-filled)
  std: StdRow[]; // bv300_standard_laying (guide_version 2023)
  // hen-day standards for other breeds, from the knowledge library (breed key -> rows). Missing = "no reference loaded".
  stdByBreed?: Record<string, StdRow[]>;
  realisticOverrides?: RealisticOverride[]; // owner-typed realistic levels (V10)
}

// ---- tunable rules (the owner's brief, plus the few choices it left open) --
export const RULES = {
  dropPoints: 5, // production drop: >= 5 points below own 7-day average ...
  dropPointsTwoDay: 3, // ... or >= 3 points on 2 consecutive days
  mortMultiple: 2, // high mortality: > 2x own 7-day average ...
  mortMinShare: 0.001, // ... and > 0.1% of the flock
  mortMinDeaths: 5, // ... and at least 5 deaths that day
  feedDaysMin: 0.5, // low feed: closing stock under 0.5 day of consumption (the mill delivers daily; ~1 day is normal)
  feedShortfallDays: 3, // ... or feed received below consumption 3 days in a row
  eggDaysMax: 5, // egg build-up: closing stock (big + small) above 5 days of production (the farm normally holds 3-6 days; Farmfresh collects every 3-4 days)
  eggNoSaleDays: 4, // ... or 4+ days with no Farmfresh sale (main group; the young group's small eggs use EGG_LIMITS below)
  birdTolerance: 2, // bird-count chain: |residual| <= 2 is register rounding
  // Choices the brief did not specify (flagged in the PR description):
  greenMinRatio: 0.9, // flock card green: 7-day HD >= 90% of the BV300 standard for its age
  amberMinRatio: 0.8, // amber: 80-90% of standard; red: under 80%
  moultFeedFraction: 0.25, // moult onset: feed <= 25% of own prior 7-day avg
  moultRecoveredFraction: 0.8, // moult over once HD back to 80% of pre-moult
  moultMaxDays: 60,
  creepRatio: 1.5, // mortality creeping: 7-day avg >= 1.5x prior 14-day avg
  creepMinDeaths: 1, // ... and at least +1 death/day
  trendWorsenPoints: 2, // trending below: gap grew >= 2 points week on week
};

/**
 * Egg-stock alert limits per group, in ONE place. Main (big eggs): Farmfresh collects every 3-4 days, so
 * 4+ days without a sale or more than 5 days of stock is an alert. Young (small eggs): the owner moved the
 * "days without a sale" limit from 4 to 6 on 28 Oct 2026 (small eggs sell less often). The stock-days limit
 * is unchanged (5) for both groups.
 */
export const EGG_LIMITS: Record<Segment, { noSaleDays: number; stockDays: number }> = {
  main: { noSaleDays: RULES.eggNoSaleDays, stockDays: RULES.eggDaysMax },
  young: { noSaleDays: 6, stockDays: RULES.eggDaysMax },
};

export function addDays(d: string, n: number): string {
  const t = Date.parse(d + "T00:00:00Z") + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
}
const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
const round = (x: number, p = 1) => Math.round(x * 10 ** p) / 10 ** p;
const fmt = (x: number) => Math.round(x).toLocaleString("en-IN");

export type AlertKind =
  | "production_drop"
  | "high_mortality"
  | "low_feed_stock"
  | "egg_buildup"
  | "bird_count_anomaly"
  | "feed_anomaly"
  | "missing_day";

export interface Alert {
  segment: Segment | null; // which group the alert is about (null = flock without a segment, or farm-wide)
  key: string; // stable id: '<rule>|<date>|<flock id or "farm">' (what alert_feedback is keyed on)
  kind: AlertKind;
  date: string;
  flockId: string | null;
  flockLabel: string | null; // the real flock name
  registerLabel: string | null; // label written in the register that day (secondary)
  flockTag: string | null; // stable identity, e.g. "placed May 2025" (labels shift)
  reason: string; // plain words WITH the numbers
  // The record this alert is about, when it has a reviewed_by_owner column.
  source: { table: "production" | "feed_bag_stock"; id: number } | null;
}

export interface Ctx {
  input: EngineInput;
  flockById: Map<string, FlockRef>;
  byFlock: Map<string, ProdRow[]>; // sorted by date
  byDate: Map<string, ProdRow[]>;
  dates: string[]; // distinct production dates, sorted
  moveByFlockDate: Map<string, Movement[]>;
  eggByDate: Map<string, EggSummary[]>;
  boxByDate: Map<string, FeedBox[]>;
  stdByAge: Map<number, number>;
  stdByBreed: Map<string, Map<number, number>>;
  realistic?: RealisticModel; // learned from the farm's own records; attached by attachRealistic (V10)
  realisticHistory?: RealisticModel[]; // month-end computations, oldest first (trend chart and slip alert)
  /** Realistic HD target for a flock on a date. Absent = judge against the book (old behaviour; unit tests). */
  realisticHd?: (flockId: string, date: string) => RealisticHdTarget;
}

/** What realisticFor (realistic.ts) hands back; declared here so the engine does not import realistic.ts (no cycle). */
export interface RealisticHdTarget {
  value: number | null;
  book: number | null;
  ratio: number | null;
  source: "learned" | "owner" | "none";
  reason: string | null;
  bandLabel: string | null; // e.g. "weeks 30-34"
}

export function buildCtx(input: EngineInput): Ctx {
  const byFlock = new Map<string, ProdRow[]>();
  const byDate = new Map<string, ProdRow[]>();
  for (const r of input.prod) {
    (byFlock.get(r.flockId) ?? byFlock.set(r.flockId, []).get(r.flockId)!).push(r);
    (byDate.get(r.date) ?? byDate.set(r.date, []).get(r.date)!).push(r);
  }
  for (const rs of byFlock.values()) rs.sort((a, b) => (a.date < b.date ? -1 : 1));
  const moveByFlockDate = new Map<string, Movement[]>();
  for (const m of input.movements) {
    const k = `${m.flockId}|${m.date}`;
    (moveByFlockDate.get(k) ?? moveByFlockDate.set(k, []).get(k)!).push(m);
  }
  const eggByDate = new Map<string, EggSummary[]>();
  for (const e of input.egg) (eggByDate.get(e.date) ?? eggByDate.set(e.date, []).get(e.date)!).push(e);
  const boxByDate = new Map<string, FeedBox[]>();
  for (const b of input.feedBoxes) (boxByDate.get(b.date) ?? boxByDate.set(b.date, []).get(b.date)!).push(b);
  return {
    input,
    flockById: new Map(input.flocks.map((f) => [f.id, f])),
    byFlock,
    byDate,
    dates: [...byDate.keys()].sort(),
    moveByFlockDate,
    eggByDate,
    boxByDate,
    stdByAge: new Map(input.std.map((s) => [s.age, s.hdp])),
    stdByBreed: new Map(Object.entries(input.stdByBreed ?? {}).map(([k, rows]) => [k, new Map(rows.map((r) => [r.age, r.hdp]))])),
  };
}

// --- segments ----------------------------------------------------------------

/** The segment a flock belonged to on `date` (history keeps the old one). null = not set. */
export function segmentOn(ctx: Ctx, flockId: string, date: string): Segment | null {
  const f = ctx.flockById.get(flockId);
  if (!f) return null;
  const h = f.segmentHistory;
  if (h && h.length) {
    let best: { from: string; segment: Segment | null } | null = null;
    for (const x of h) if (x.from <= date && (!best || x.from > best.from)) best = x;
    if (best) return best.segment;
    // before the first recorded change: the earliest known segment
    return [...h].sort((a, b) => (a.from < b.from ? -1 : 1))[0].segment;
  }
  return f.segment ?? null;
}

/** First day any young flock has a row; the small ledger belongs to YOUNG from then on. */
const youngDateCache = new WeakMap<Ctx, string | null>();
export function firstYoungDate(ctx: Ctx): string | null {
  if (youngDateCache.has(ctx)) return youngDateCache.get(ctx)!;
  let found: string | null = null;
  outer: for (const d of ctx.dates) for (const r of ctx.byDate.get(d) ?? []) if (segmentOn(ctx, r.flockId, d) === "young") { found = d; break outer; }
  youngDateCache.set(ctx, found);
  return found;
}

/**
 * Which segment an egg-ledger section belongs to on a date. Big = MAIN always. Small = YOUNG from
 * the day the first young flock reports; before that the small ledger holds graded small eggs of
 * the main flocks, so it belongs to MAIN (documented in docs/DECISIONS.md).
 */
export function ledgerSegment(ctx: Ctx, section: string, date: string): Segment {
  if (section !== "small") return "main";
  const fy = firstYoungDate(ctx);
  return fy != null && date >= fy ? "young" : "main";
}

export type SegFilter = Segment | "all";
const inSeg = (ctx: Ctx, r: { flockId: string; date: string }, seg: SegFilter) => seg === "all" || segmentOn(ctx, r.flockId, r.date) === seg;
export function rowsOn(ctx: Ctx, date: string, seg: SegFilter = "all"): ProdRow[] {
  return (ctx.byDate.get(date) ?? []).filter((r) => inSeg(ctx, r, seg));
}

/** First day with eggs for this flock, or null when it was already laying before the data starts. */
export function firstLayDate(ctx: Ctx, flockId: string): string | null {
  const rs = ctx.byFlock.get(flockId) ?? [];
  const r = rs.find((x) => (x.eggs ?? 0) > 0);
  if (!r || r.date <= ctx.dates[0]) return null;
  return r.date;
}
/** A young flock is ramping up for RAMP_DAYS after its first laying day. */
export function rampingUp(ctx: Ctx, flockId: string, date: string): { day: number; since: string } | null {
  if (segmentOn(ctx, flockId, date) !== "young") return null;
  const first = firstLayDate(ctx, flockId);
  if (!first) return null;
  const day = diffDays(date, first) + 1;
  return day <= RAMP_DAYS ? { day, since: first } : null;
}

// --- small lookups -----------------------------------------------------------

/** The flock's rows strictly before `date`, newest first, at most `n`, none older than 14 days. */
function priorRows(ctx: Ctx, flockId: string, date: string, n: number): ProdRow[] {
  const rs = ctx.byFlock.get(flockId) ?? [];
  const out: ProdRow[] = [];
  for (let i = rs.length - 1; i >= 0 && out.length < n; i--) {
    if (rs[i].date >= date) continue;
    if (diffDays(date, rs[i].date) > 14) break;
    out.push(rs[i]);
  }
  return out;
}
function rowOn(ctx: Ctx, flockId: string, date: string): ProdRow | undefined {
  return (ctx.byFlock.get(flockId) ?? []).find((r) => r.date === date);
}
function movesOn(ctx: Ctx, flockId: string, date: string): Movement[] {
  return ctx.moveByFlockDate.get(`${flockId}|${date}`) ?? [];
}
function labelOn(ctx: Ctx, flockId: string, date: string): string {
  const rs = ctx.byFlock.get(flockId) ?? [];
  let best: ProdRow | undefined;
  for (const r of rs) if (r.date <= date) best = r;
  return best?.label ?? ctx.flockById.get(flockId)?.label ?? "flock";
}
export function flockName(ctx: Ctx, flockId: string, fallback = "flock"): string {
  return ctx.flockById.get(flockId)?.label ?? fallback;
}
/**
 * 2026-01-01 was typed in as a stand-in for flocks whose real placement date was unknown. A date is a
 * placeholder ONLY while the owner has not confirmed it (placement_date_confirmed). Once confirmed, even
 * the literal 2026-01-01 (BAB-6) is a real date. Every screen and the analytics engine use this one rule.
 */
export const PLACEHOLDER_DATE = "2026-01-01";
export function isPlaceholderDate(date: string | Date | null | undefined, confirmed: boolean | null | undefined): boolean {
  return date != null && String(date).slice(0, 10) === PLACEHOLDER_DATE && confirmed !== true;
}

export function isPlaceholderAge(f: FlockRef | undefined): boolean {
  return !!f && isPlaceholderDate(f.placementDate, f.placementConfirmed);
}
export function flockTag(ctx: Ctx, flockId: string): string | null {
  const p = ctx.flockById.get(flockId)?.placementDate;
  if (!p) return null;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(p.slice(5, 7)) - 1];
  return `placed ${mon} ${p.slice(0, 4)}`;
}
export function registerLabel(ctx: Ctx, flockId: string, date: string): string {
  return labelOn(ctx, flockId, date);
}

// --- moulting ---------------------------------------------------------------
//
// 1) RECORDED: a moulting_periods row for the flock (the owner enters the
//    start date; BAB-5's Aug 15 2026 row is pre-filled as "inferred, owner to
//    confirm"). The flock is moulting from the start date until the end date,
//    or - when no end date is set - until HD% is back to 80% of the HD% it
//    had in the 7 rows before the start (and at least 14 days have passed).
// 2) INFERRED (only for a flock with NO recorded period): feed fell to <= 25%
//    of its own prior 7-day average within the last 60 days AND HD% is still
//    below 80% of its pre-withdrawal level.
// No zero-feed or production-drop alerts fire while a flock is moulting.
export interface Moult {
  startedOn: string;
  baselineHd: number;
  recorded: boolean;
  confirmed: boolean; // the owner has confirmed the start date
}
export function moultOn(ctx: Ctx, flockId: string, date: string): Moult | null {
  const rs = ctx.byFlock.get(flockId) ?? [];
  const today = rs.find((r) => r.date === date);
  if (!today) return null;
  const periods = ctx.input.moulting.filter((m) => m.flockId === flockId);
  // Once any moult is recorded, ONLY recorded moults count: the owner has said which flocks moulted (28 Oct 2026: only
  // BAB-3), so no other flock is ever inferred to be moulting from a feed dip.
  if (ctx.input.moulting.length > 0) {
    for (const m of periods) {
      if (date < m.start || (m.end && date > m.end)) continue;
      const prior = priorRowsBefore(ctx, flockId, m.start, 7);
      const baseline = mean(prior.map((p) => p.hd).filter((x): x is number => x != null)) ?? 0;
      if (!m.end) {
        const recovered = today.hd != null && baseline > 0 && today.hd >= RULES.moultRecoveredFraction * baseline && diffDays(date, m.start) >= 14;
        if (recovered) continue;
      }
      return { startedOn: m.start, baselineHd: baseline, recorded: true, confirmed: m.confirmed };
    }
    return null;
  }
  if (today.hd == null) return null;
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    if (r.date > date) break;
    if (diffDays(date, r.date) > RULES.moultMaxDays) continue;
    const prior = priorRows(ctx, flockId, r.date, 7);
    const priorFeed = mean(prior.map((p) => p.feed).filter((x): x is number => x != null));
    if (priorFeed == null || priorFeed < 5 || r.feed == null) continue;
    if (r.feed > RULES.moultFeedFraction * priorFeed) continue;
    const baseline = mean(prior.map((p) => p.hd).filter((x): x is number => x != null));
    if (baseline == null) continue;
    if (today.hd < RULES.moultRecoveredFraction * baseline) {
      return { startedOn: r.date, baselineHd: baseline, recorded: false, confirmed: false };
    }
    return null; // withdrawal happened but production never collapsed / has recovered
  }
  return null;
}

/** The flock's rows strictly before `date` (no 14-day cut-off), newest first, at most n. */
function priorRowsBefore(ctx: Ctx, flockId: string, date: string, n: number): ProdRow[] {
  const rs = ctx.byFlock.get(flockId) ?? [];
  const out: ProdRow[] = [];
  for (let i = rs.length - 1; i >= 0 && out.length < n; i--) if (rs[i].date < date) out.push(rs[i]);
  return out;
}

/** Date of a feed-withdrawal day (feed <= 25% of own prior 7-day average) in the last 60 days, if any. */
export function recentFeedWithdrawal(ctx: Ctx, flockId: string, date: string): string | null {
  for (const r of ctx.byFlock.get(flockId) ?? []) {
    if (r.date > date || diffDays(date, r.date) > RULES.moultMaxDays) continue;
    const prior = priorRows(ctx, flockId, r.date, 7);
    const priorFeed = mean(prior.map((p) => p.feed).filter((x): x is number => x != null));
    if (priorFeed != null && priorFeed >= 5 && r.feed != null && r.feed <= RULES.moultFeedFraction * priorFeed) return r.date;
  }
  return null;
}

// --- farm today --------------------------------------------------------------

export interface DayTotals {
  date: string;
  eggs: number;
  trays: number;
  birds: number;
  hd: number | null;
  mort: number;
  feed: number; // bags, from the rows that record feed
  feedBirds: number; // birds of the rows that record feed (feed per bird uses only these)
  feedRecorded: boolean; // false when no row of this group has a feed figure (left-page flocks)
  flocks: number;
}
export function dayTotals(ctx: Ctx, date: string, seg: SegFilter = "all"): DayTotals | null {
  const rs = rowsOn(ctx, date, seg);
  if (rs.length === 0) return null;
  const eggs = rs.reduce((s, r) => s + (r.eggs ?? 0), 0);
  const birds = rs.reduce((s, r) => s + (r.pop ?? 0), 0);
  const withFeed = rs.filter((r) => r.feed != null);
  return {
    date,
    eggs,
    trays: eggs / 30,
    birds,
    hd: birds > 0 ? (eggs / birds) * 100 : null,
    mort: rs.reduce((s, r) => s + (r.mort ?? 0), 0),
    feed: withFeed.reduce((s, r) => s + (r.feed ?? 0), 0),
    feedBirds: withFeed.reduce((s, r) => s + (r.pop ?? 0), 0),
    feedRecorded: withFeed.length > 0,
    flocks: rs.length,
  };
}
export interface FarmToday {
  asOf: string;
  today: DayTotals | null;
  yesterday: DayTotals | null;
  avg7: { eggs: number; trays: number; hd: number | null; mort: number; feed: number; days: number } | null;
}
export function farmToday(ctx: Ctx, asOf: string, seg: SegFilter = "all"): FarmToday {
  const today = dayTotals(ctx, asOf, seg);
  const yesterday = dayTotals(ctx, addDays(asOf, -1), seg);
  const prev: DayTotals[] = [];
  for (let i = 1; i <= 7; i++) {
    const t = dayTotals(ctx, addDays(asOf, -i), seg);
    if (t) prev.push(t);
  }
  const avg7 = prev.length
    ? {
        eggs: mean(prev.map((p) => p.eggs))!,
        trays: mean(prev.map((p) => p.trays))!,
        hd: mean(prev.map((p) => p.hd).filter((x): x is number => x != null)),
        mort: mean(prev.map((p) => p.mort))!,
        feed: mean(prev.map((p) => p.feed))!,
        days: prev.length,
      }
    : null;
  return { asOf, today, yesterday, avg7 };
}

// --- flock cards -------------------------------------------------------------

export type CardStatus = "green" | "amber" | "red" | "moult" | "ramping" | "no_reference" | "left";

export interface FlockCard {
  refReason: RefReason; // why there is (not) an age-based target
  segment: Segment | null;
  rampDay: number | null; // day of lay (1-60) while a young flock is ramping up
  flockId: string;
  label: string; // the real flock name
  registerLabel: string; // label written in the register on the as-of date (or last reporting day)
  formerLabels: string[]; // earlier register labels in the data window, oldest first
  placementDate: string | null;
  breed: string | null;
  tag: string | null;
  ageWeeks: number | null;
  status: CardStatus;
  statusNote: string; // why this colour, with the numbers
  stdHd: number | null;
  hd7: number | null; // own average over the last 7 rows
  gap: number | null; // stdHd - hd7 (points below the BOOK; neutral, never coloured)
  realisticHd: number | null; // our realistic target (learned or owner-set); null = not learned yet for this age
  realisticSource: "learned" | "owner" | "none";
  realisticReason: string | null; // plain words when realisticHd is null
  realisticBand: string | null;
  birds: number | null;
  mort7: number | null; // deaths/day, last 7 rows
  feed7: number | null; // bags/day, last 7 rows
  hdSeries: number[]; // last 14 rows, for the sparkline
  lastDate: string;
}

/** The flock's `n` rows strictly before `date`, oldest first. */
function rowsBefore(ctx: Ctx, flockId: string, date: string, n: number): ProdRow[] {
  const rs = (ctx.byFlock.get(flockId) ?? []).filter((r) => r.date < date);
  return rs.slice(Math.max(0, rs.length - n));
}

function lastRows(ctx: Ctx, flockId: string, asOf: string, n: number): ProdRow[] {
  const rs = ctx.byFlock.get(flockId) ?? [];
  const out: ProdRow[] = [];
  for (let i = rs.length - 1; i >= 0 && out.length < n; i--) {
    if (rs[i].date > asOf) continue;
    out.push(rs[i]);
  }
  return out.reverse();
}

// Each flock is compared only with the reference for ITS OWN breed (flocks.breed).
// Spellings are normalised: "Bowan" / "Bovans" / "Bovans White" all mean Bovans White
// (the farm's one Bovans flock is white-egg). BV300 is the farm's main breed.
export function breedKey(breed: string | null | undefined): string | null {
  const k = (breed ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!k) return null;
  if (k.startsWith("BV300")) return "BV300";
  if (k.startsWith("BOVAN") || k.startsWith("BOWAN")) return "BOVANS_WHITE";
  return k;
}
export function breedName(breed: string | null | undefined): string {
  const key = breedKey(breed);
  if (key === "BV300") return "BV300";
  if (key === "BOVANS_WHITE") return "Bovans White";
  return (breed ?? "").trim() || "unknown breed";
}

/** Why a flock has (or has no) age-based target: lets the screens say one clear thing instead of a generic chip. */
export type RefReason = "ok" | "realistic_not_learned" | "no_date" | "placeholder_date" | "beyond_table" | "before_table" | "no_breed_ref" | "no_age_row";

export function stdFor(ctx: Ctx, flock: FlockRef | undefined, asOf: string): { std: number | null; age: number | null; why: string; reason: RefReason } {
  if (!flock?.placementDate) return { std: null, age: null, why: "no age-based target yet: placement date missing", reason: "no_date" };
  if (isPlaceholderAge(flock))
    return { std: null, age: null, why: `no age-based target yet: the placement date ${flock.placementDate} is a placeholder — set the real date on the Flocks screen`, reason: "placeholder_date" };
  const age = Math.floor(diffDays(asOf, flock.placementDate) / 7);
  const key = breedKey(flock.breed);
  const name = breedName(flock.breed);
  const table = key === "BV300" ? ctx.stdByAge : key ? ctx.stdByBreed.get(key) : undefined;
  if (!table || table.size === 0)
    return { std: null, age, why: `no target table loaded for ${name}; this flock is not compared with another breed's table (its own 7-day-average alerts still apply)`, reason: "no_breed_ref" };
  const s = table.get(age);
  if (s == null) {
    const ages = [...table.keys()];
    const lo = Math.min(...ages);
    const hi = Math.max(...ages);
    if (age > hi) return { std: null, age, why: `past the end of the breeder's target table (week ${age}; the table stops at week ${hi}), so there is no target to compare with — its own 7-day trend is still watched`, reason: "beyond_table" };
    if (age < lo) return { std: null, age, why: `before the start of the breeder's target table (week ${age}; the table starts at week ${lo})`, reason: "before_table" };
    return { std: null, age, why: `no target for week ${age} in the ${name} table`, reason: "no_age_row" };
  }
  return { std: s, age, why: "", reason: "ok" };
}

export function flockCards(ctx: Ctx, asOf: string): FlockCard[] {
  const cards: FlockCard[] = [];
  for (const [flockId, rs] of ctx.byFlock) {
    const upto = rs.filter((r) => r.date <= asOf);
    if (upto.length === 0) continue;
    const last = upto[upto.length - 1];
    const flock = ctx.flockById.get(flockId);
    const labels: string[] = [];
    for (const r of upto) if (labels[labels.length - 1] !== r.label) labels.push(r.label);
    const win = lastRows(ctx, flockId, asOf, 7);
    const hds = win.map((r) => r.hd).filter((x): x is number => x != null);
    const hd7 = mean(hds);
    const { std, age, why, reason: baseReason } = stdFor(ctx, flock, asOf);
    let refReason: RefReason = baseReason;
    const gap = std != null && hd7 != null ? std - hd7 : null;
    const rt = std != null && ctx.realisticHd ? ctx.realisticHd(flockId, asOf) : null;
    const left = last.date < asOf;
    let status: CardStatus;
    let note: string;
    const moult = left ? null : moultOn(ctx, flockId, asOf);
    const ramp = left ? null : rampingUp(ctx, flockId, asOf);
    if (left) {
      status = "left";
      note = `Last reported ${last.date}; not on the register since.`;
    } else if (ramp && !moult) {
      status = "ramping";
      const prev7 = rowsBefore(ctx, flockId, win.length ? win[0].date : asOf, 7);
      const hdPrev = mean(prev7.map((r) => r.hd).filter((x): x is number => x != null));
      note = `Ramping up: day ${ramp.day} of lay (first eggs ${ramp.since}); judged against the breeder's target only from day ${RAMP_DAYS + 1}${std != null ? ` (for information, the target at week ${age} is ${round(std)} eggs per 100 birds)` : ""}. ` +
        (hd7 != null ? `Last 7 days: ${round(hd7)} eggs per 100 birds` : "No eggs-per-100-birds figure in the last 7 days") +
        (hd7 != null && hdPrev != null ? `, against ${round(hdPrev)} the 7 days before (${hd7 - hdPrev >= 0 ? "up" : "down"} ${round(Math.abs(hd7 - hdPrev))}).` : ".");
    } else if (moult) {
      status = "moult";
      const day = diffDays(asOf, moult.startedOn) + 1;
      note = `Moulting, day ${day} (since ${moult.startedOn}${moult.recorded ? "" : ", inferred"}${moult.confirmed ? "" : "; moult dates not confirmed"}); last 7 days ${hd7 != null ? round(hd7) : "–"} eggs per 100 birds, against ${round(moult.baselineHd)} before. Not compared with the breeder's target while moulting.`;
    } else if (std == null) {
      status = "no_reference";
      note = why;
    } else if (gap == null) {
      status = "no_reference";
      note = "No eggs-per-100-birds figure in the last 7 days.";
    } else if (rt && rt.value == null) {
      // never silently judged against the book: grey, with the book line as reference
      status = "no_reference";
      refReason = "realistic_not_learned";
      note = `Last 7 days: ${round(hd7!)} eggs per 100 birds. Breeder's target ${round(std)} (${round(gap)} points ${gap > 0 ? "below" : "above"} the book). Our realistic target is not learned yet for this age${rt.reason ? ` (${rt.reason})` : ""}, so there is no colour.`;
    } else {
      const target = rt ? rt.value! : std;
      const ratio = hd7! / target;
      status = ratio >= RULES.greenMinRatio ? "green" : ratio >= RULES.amberMinRatio ? "amber" : "red";
      note = rt
        ? `Last 7 days: ${round(hd7!)} eggs per 100 birds. Our realistic target (${rt.source === "owner" ? "set by owner" : "learned from this farm"}, week ${age}) is ${round(target)}, so it is at ${round(ratio * 100, 0)}% of it. The breeder's book says ${round(std)}: ${round(Math.abs(gap))} points ${gap > 0 ? "below" : "above"} the book.`
        : `Last 7 days: ${round(hd7!)} eggs per 100 birds. The breeder's target (${breedName(flock?.breed)}, week ${age}) is ${round(std)}, so it is at ${round(ratio * 100, 0)}% of target (${round(Math.abs(gap))} ${gap > 0 ? "below" : "above"}).`;
      const w = recentFeedWithdrawal(ctx, flockId, asOf);
      if (w) note += ` Feed was withdrawn ${w}, so this flock is recovering from a moult; the target assumes none.`;
    }
    cards.push({
      refReason,
      realisticHd: rt?.value ?? null,
      realisticSource: rt?.source ?? "none",
      realisticReason: rt?.reason ?? null,
      realisticBand: rt?.bandLabel ?? null,
      segment: segmentOn(ctx, flockId, asOf),
      rampDay: ramp ? ramp.day : null,
      flockId,
      label: flockName(ctx, flockId, last.label),
      registerLabel: last.label,
      formerLabels: labels.slice(0, -1),
      placementDate: flock?.placementDate ?? null,
      breed: flock?.breed ?? null,
      tag: flockTag(ctx, flockId),
      ageWeeks: age,
      status,
      statusNote: note,
      stdHd: std,
      hd7,
      gap,
      birds: last.pop,
      mort7: mean(win.map((r) => r.mort).filter((x): x is number => x != null)),
      feed7: mean(win.map((r) => r.feed).filter((x): x is number => x != null)),
      hdSeries: lastRows(ctx, flockId, asOf, 14).map((r) => r.hd ?? 0),
      lastDate: last.date,
    });
  }
  const order: Record<CardStatus, number> = { red: 0, amber: 1, moult: 2, ramping: 3, green: 4, no_reference: 5, left: 6 };
  return cards.sort((a, b) => order[a.status] - order[b.status] || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

// --- month view --------------------------------------------------------------

export interface MonthRow {
  flockId: string | null; // null = farm total
  label: string;
  labels: string[];
  days: number;
  eggs: number;
  feed: number;
  mort: number;
  mortPct: number | null; // deaths / birds at start of the first day
  hd: number | null; // eggs / sum of daily bird counts
  note: string | null;
}
export function monthView(ctx: Ctx, month: string, seg: SegFilter = "all"): { rows: MonthRow[]; total: MonthRow; chickDeaths: number } {
  const inMonth = (d: string) => d.startsWith(month);
  const rows: MonthRow[] = [];
  let popDays = 0;
  for (const [flockId, rs] of ctx.byFlock) {
    const m = rs.filter((r) => inMonth(r.date) && inSeg(ctx, r, seg));
    if (m.length === 0) continue;
    const labels: string[] = [];
    for (const r of m) if (labels[labels.length - 1] !== r.label) labels.push(r.label);
    const eggs = m.reduce((s, r) => s + (r.eggs ?? 0), 0);
    const pops = m.reduce((s, r) => s + (r.pop ?? 0), 0);
    popDays += pops;
    const start = m[0].pop != null ? m[0].pop + (m[0].mort ?? 0) : null;
    const mort = m.reduce((s, r) => s + (r.mort ?? 0), 0);
    const lastAll = rs[rs.length - 1];
    const lastInMonth = m[m.length - 1];
    rows.push({
      flockId,
      label: flockName(ctx, flockId, labels[labels.length - 1]),
      labels,
      days: m.length,
      eggs,
      feed: m.reduce((s, r) => s + (r.feed ?? 0), 0),
      mort,
      mortPct: start ? (mort / start) * 100 : null,
      hd: pops > 0 ? (eggs / pops) * 100 : null,
      note:
        lastInMonth === lastAll && lastInMonth.date < lastDayOfData(ctx)
          ? `left after ${lastInMonth.date}`
          : null,
    });
  }
  rows.sort((a, b) => b.eggs - a.eggs);
  const eggs = rows.reduce((s, r) => s + r.eggs, 0);
  const mort = rows.reduce((s, r) => s + r.mort, 0);
  const total: MonthRow = {
    flockId: null,
    label: seg === "all" ? "Farm total" : `${SEGMENT_SHORT[seg]} total`,
    labels: [],
    days: new Set(ctx.dates.filter((d) => inMonth(d) && rowsOn(ctx, d, seg).length > 0)).size,
    eggs,
    feed: rows.reduce((s, r) => s + r.feed, 0),
    mort,
    mortPct: null,
    hd: popDays > 0 ? (eggs / popDays) * 100 : null,
    note: null,
  };
  const chickDeaths = ctx.input.chick.filter((c) => inMonth(c.date)).reduce((s, c) => s + c.deaths, 0);
  return { rows, total, chickDeaths };
}
export function lastDayOfData(ctx: Ctx): string {
  return ctx.dates[ctx.dates.length - 1];
}

// --- alerts ------------------------------------------------------------------

function boxTotalsFull(ctx: Ctx, date: string) {
  const bs = ctx.boxByDate.get(date) ?? [];
  if (bs.length === 0) return null;
  return {
    received: bs.reduce((s, b) => s + (b.produced ?? 0), 0),
    consumed: bs.reduce((s, b) => s + (b.consumed ?? 0), 0),
  };
}

function boxTotals(ctx: Ctx, date: string) {
  const bs = ctx.boxByDate.get(date) ?? [];
  if (bs.length === 0) return null;
  return {
    closing: bs.reduce((s, b) => s + (b.closing ?? 0), 0),
    consumed: bs.reduce((s, b) => s + (b.consumed ?? 0), 0),
  };
}

/** Closing feed bags / average daily consumption over the last 7 dates with a box row. */
export function feedDaysLeft(ctx: Ctx, date: string): { days: number; closing: number; perDay: number } | null {
  const t = boxTotals(ctx, date);
  if (!t) return null;
  const cons: number[] = [];
  for (let i = 0; i < 7; i++) {
    const x = boxTotals(ctx, addDays(date, -i));
    if (x && x.consumed > 0) cons.push(x.consumed);
  }
  const perDay = mean(cons);
  if (!perDay) return null;
  return { days: t.closing / perDay, closing: t.closing, perDay };
}

/** The latest Farmfresh sale on or before `date`, or null if none is known in the data. */
function lastFarmfreshOnOrBefore(ctx: Ctx, date: string, seg: SegFilter = "all"): string | null {
  let best: string | null = null;
  // per ledger section when the data has it (big = main; small = young once young flocks report, else main)
  const by = ctx.input.farmfreshBySection;
  let list = ctx.input.farmfreshDates;
  if (by && seg !== "all") list = seg === "main" ? (ledgerSegment(ctx, "small", date) === "main" ? [...by.big, ...by.small] : by.big) : by.small;
  for (const d of list) if (d <= date && (best == null || d > best)) best = d;
  // Without any earlier sale in the data we cannot say how long it has been.
  return best;
}

/** Closing egg stock (all sections recorded that day) / average daily eggs laid over the last 7 days. */
export function eggStockDays(ctx: Ctx, date: string, seg: SegFilter = "all"): { days: number; closing: number; perDay: number; sections: number } | null {
  const es = (ctx.eggByDate.get(date) ?? []).filter((e) => seg === "all" || ledgerSegment(ctx, e.section, date) === seg);
  if (es.length === 0) return null;
  const laid: number[] = [];
  for (let i = 0; i < 7; i++) {
    const t = dayTotals(ctx, addDays(date, -i), seg);
    if (t) laid.push(t.eggs);
  }
  const perDay = mean(laid);
  if (!perDay) return null;
  const closing = es.reduce((s, e) => s + (e.closing ?? 0), 0);
  return { days: closing / perDay, closing, perDay, sections: es.length };
}

/** HD points under the flock's own 7-day average on `date` (positive = below), or null if not enough history. */
function hdDrop(ctx: Ctx, flockId: string, date: string): { drop: number; avg: number; hd: number } | null {
  const row = rowOn(ctx, flockId, date);
  if (!row || row.hd == null) return null;
  const prior = priorRows(ctx, flockId, date, 7);
  const avg = mean(prior.map((p) => p.hd).filter((x): x is number => x != null));
  if (avg == null || prior.length < 4) return null;
  return { drop: avg - row.hd, avg, hd: row.hd };
}

/** Rows dated before this are the cleared August register: never flagged for data-quality reasons. */
export const NEVER_FLAG_BEFORE = "2026-09-01";

export function alertKey(a: { kind: AlertKind; date: string; flockId: string | null; segment?: Segment | null }, n = 0): string {
  // farm-wide alerts of the main segment keep the old "farm" key (saved verdicts stay valid); young adds a suffix
  const who = a.flockId ?? (a.segment === "young" ? "farm-young" : "farm");
  return `${a.kind}|${a.date}|${who}${n ? `#${n}` : ""}`;
}

type RawAlert = Omit<Alert, "key" | "segment"> & { segment?: Segment | null };

export function alertsFor(ctx: Ctx, date: string, opts: { includeCleared?: boolean; segment?: SegFilter } = {}): Alert[] {
  const seen = new Map<string, number>();
  const all: Alert[] = alertsForRaw(ctx, date, opts).map((a) => {
    // flock alerts take the flock's segment on that date; farm-wide ones without one are feed alerts (feed is recorded for the main flocks only)
    const segment = a.segment !== undefined ? a.segment : a.flockId ? segmentOn(ctx, a.flockId, date) : a.kind === "low_feed_stock" || a.kind === "feed_anomaly" ? "main" : null;
    const withSeg = { ...a, segment };
    const base = alertKey(withSeg);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...withSeg, key: alertKey(withSeg, n) };
  });
  const want = opts.segment ?? "all";
  return want === "all" ? all : all.filter((a) => a.segment === want);
}

function alertsForRaw(ctx: Ctx, date: string, opts: { includeCleared?: boolean } = {}): RawAlert[] {
  // V5 section 3: all August rows were cleared (2026-10-19) — never alert on them.
  // `includeCleared` exists only so a rule can be evaluated on August in scripts.
  if (date < NEVER_FLAG_BEFORE && !opts.includeCleared) return [];
  const out: RawAlert[] = [];
  const rows = ctx.byDate.get(date) ?? [];

  for (const r of rows) {
    if (r.neverFlag) continue; // owner-confirmed: never alert on this row
    const base = { date, flockId: r.flockId, flockLabel: flockName(ctx, r.flockId, r.label), registerLabel: r.label, flockTag: flockTag(ctx, r.flockId), source: { table: "production" as const, id: r.id } };
    const prior = priorRows(ctx, r.flockId, date, 7);
    const moult = moultOn(ctx, r.flockId, date);

    // production drop: >= 5 points under own 7-day average, or >= 3 points on 2 consecutive days
    // a young flock still climbing to peak (first 60 days of lay) raises no low-HD alert; its trend is shown on its card
    if (r.hd != null && !r.reviewed && !moult && !rampingUp(ctx, r.flockId, date)) {
      const d0 = hdDrop(ctx, r.flockId, date);
      if (d0 && d0.drop >= RULES.dropPointsTwoDay) {
        const yesterday = priorRows(ctx, r.flockId, date, 1)[0];
        const d1 = yesterday && diffDays(date, yesterday.date) === 1 ? hdDrop(ctx, r.flockId, yesterday.date) : null;
        const big = d0.drop >= RULES.dropPoints;
        const twoDays = !!d1 && d1.drop >= RULES.dropPointsTwoDay;
        if (big || twoDays) {
          const mv = movesOn(ctx, r.flockId, date).reduce((s, m) => s + m.change, 0);
          out.push({
            ...base,
            kind: "production_drop",
            reason:
              `Laid ${round(r.hd)} eggs per 100 birds, against its own usual ${round(d0.avg)} over the previous 7 days — ${round(d0.drop)} lower (${fmt(r.eggs ?? 0)} eggs` +
              `${mv ? `; bird count also moved ${mv > 0 ? "+" : "−"}${fmt(Math.abs(mv))} that day` : ""})` +
              `${!big && twoDays ? `, and ${round(d1!.drop)} lower the day before as well` : ""}.`,
          });
        }
      }
    }

    // high mortality: > 2x own average AND > 0.1% of the flock AND >= 5 deaths
    if (r.mort != null && r.pop != null && !r.reviewed) {
      const avg = mean(prior.map((p) => p.mort).filter((x): x is number => x != null));
      const flockSize = r.pop + r.mort;
      if (
        avg != null && prior.length >= 4 && r.mort >= RULES.mortMinDeaths &&
        r.mort > RULES.mortMultiple * avg && r.mort > RULES.mortMinShare * flockSize
      ) {
        out.push({
          ...base,
          kind: "high_mortality",
          reason: `${r.mort} deaths today; its usual is ${round(avg)} a day (${round(r.mort / Math.max(avg, 0.01), 1)} times that), and ${round((r.mort / flockSize) * 100, 2)}% of its ${fmt(flockSize)} birds.`,
        });
      }
    }

    // feed anomaly (a): zero feed with live birds, not moulting
    if (r.feed === 0 && (r.pop ?? 0) > 0 && !moult && !r.reviewed) {
      out.push({
        ...base,
        kind: "feed_anomaly",
        reason: `No feed (0 bags) was written for ${fmt(r.pop!)} live birds; its usual is ${round(mean(prior.map((p) => p.feed).filter((x): x is number => x != null)) ?? 0)} bags a day, and the flock is not moulting.`,
      });
    }

    // bird-count anomaly: change beyond mortality with no movement record
    const prev = prior[0];
    if (prev && diffDays(date, prev.date) === 1 && r.pop != null && prev.pop != null && r.mort != null && !r.reviewed) {
      const mv = movesOn(ctx, r.flockId, date);
      const moved = mv.reduce((s, m) => s + m.change, 0);
      const residual = r.pop - (prev.pop - r.mort) - moved;
      if (Math.abs(residual) > RULES.birdTolerance) {
        out.push({
          ...base,
          kind: "bird_count_anomaly",
          reason:
            mv.length === 0
              ? `Bird count went ${fmt(prev.pop)} → ${fmt(r.pop)} (${residual > 0 ? "+" : "−"}${fmt(Math.abs(residual))} more than the ${r.mort} deaths explain) with no movement record.`
              : `Bird count ${fmt(prev.pop)} → ${fmt(r.pop)}; the recorded movement (${moved > 0 ? "+" : "−"}${fmt(Math.abs(moved))}) and ${r.mort} deaths still leave ${residual > 0 ? "+" : "−"}${fmt(Math.abs(residual))} unexplained.`,
        });
      }
    }
  }

  // feed anomaly (b): feed box consumed vs sum of the flock rows it covers
  for (const b of ctx.boxByDate.get(date) ?? []) {
    if (b.reviewed || b.consumed == null || date < NEVER_FLAG_BEFORE) continue;
    const sum = b.flockIds.reduce((s, id) => s + (rowOn(ctx, id, date)?.feed ?? 0), 0);
    if (b.flockIds.length > 0 && sum !== b.consumed) {
      out.push({
        kind: "feed_anomaly",
        date,
        flockId: null,
        flockLabel: null,
        registerLabel: null,
        flockTag: null,
        source: { table: "feed_bag_stock", id: b.id },
        reason: `Feed box "${b.group}" consumed ${b.consumed} bags but its ${b.flockIds.length} flock rows add up to ${sum} (${b.consumed - sum > 0 ? "+" : "−"}${Math.abs(b.consumed - sum)}).`,
      });
    }
  }

  // low feed stock: closing (mill + shed) under 0.5 day of consumption, or feed
  // received below consumption on 3 days in a row. (The farm's own mill delivers
  // every day, so stock around 1 day is normal and is not an alert.)
  const fd = feedDaysLeft(ctx, date);
  if (fd && fd.days < RULES.feedDaysMin) {
    out.push({
      kind: "low_feed_stock",
      date,
      flockId: null,
      flockLabel: null,
      registerLabel: null,
      flockTag: null,
      source: null,
      reason: `${fmt(fd.closing)} bags in stock at ${round(fd.perDay)} bags/day = ${round(fd.days, 2)} days (alert under ${RULES.feedDaysMin}).`,
    });
  }
  const short: string[] = [];
  for (let i = 0; i < RULES.feedShortfallDays; i++) {
    const t = boxTotalsFull(ctx, addDays(date, -i));
    if (t && t.consumed > 0 && t.received < t.consumed) short.push(`${addDays(date, -i).slice(5)}: ${t.received} in vs ${t.consumed} used`);
  }
  if (short.length === RULES.feedShortfallDays) {
    out.push({
      kind: "low_feed_stock",
      date,
      flockId: null,
      flockLabel: null,
      registerLabel: null,
      flockTag: null,
      source: null,
      reason: `Feed received was below consumption ${RULES.feedShortfallDays} days in a row (${short.reverse().join("; ")}).`,
    });
  }

  // egg stock build-up, per segment (the farm does not pool mature and young birds):
  // closing stock of the segment's own ledger above 5 days of ITS production, OR 4 or more days with
  // no Farmfresh sale of that ledger section. The farm normally holds eggs 3-6 days because
  // Farmfresh collects every 3-4 days, so 3-5 days alone is not an alert.
  for (const seg of SEGMENTS) {
    const es = eggStockDays(ctx, date, seg);
    const eggRows = (ctx.eggByDate.get(date) ?? []).filter((e) => ledgerSegment(ctx, e.section, date) === seg);
    if (!es || eggRows.every((e) => e.reviewed)) continue;
    const last = lastFarmfreshOnOrBefore(ctx, date, seg);
    const gap = last ? diffDays(date, last) : null;
    const lim = EGG_LIMITS[seg];
    const tooMuch = es.days > lim.stockDays;
    const noSale = gap != null && gap >= lim.noSaleDays;
    if (tooMuch || noSale) {
      const parts: string[] = [];
      if (tooMuch) parts.push(`${fmt(es.closing)} eggs (${fmt(es.closing / 30)} trays) in stock vs ${fmt(es.perDay)} laid/day = ${round(es.days, 2)} days (limit ${lim.stockDays})`);
      if (noSale) parts.push(`${gap} days since the last Farmfresh sale of ${seg === "young" ? "small" : "big"} eggs (${last}; limit ${lim.noSaleDays} days)`);
      out.push({
        kind: "egg_buildup",
        segment: seg,
        date,
        flockId: null,
        flockLabel: null,
        registerLabel: null,
        flockTag: null,
        source: null,
        reason: `${SEGMENT_SHORT[seg]} flocks: ${parts.join("; ")}${noSale && !tooMuch ? `; stock is ${fmt(es.closing)} eggs = ${round(es.days)} days` : ""}.`,
      });
    }
  }

  // missing day
  const first = ctx.dates[0];
  if (first && date > first) {
    const hasAny = rows.length > 0;
    if (!hasAny) {
      out.push({ kind: "missing_day", date, flockId: null, flockLabel: null, registerLabel: null, flockTag: null, source: null, reason: `No Daily Production rows at all for ${date}.` });
    } else {
      const prevDate = addDays(date, -1);
      for (const p of ctx.byDate.get(prevDate) ?? []) {
        if (rowOn(ctx, p.flockId, date)) continue;
        const gone = (p.pop ?? 0) + movesOn(ctx, p.flockId, date).reduce((s, m) => s + m.change, 0) <= RULES.birdTolerance * 2;
        if (gone) continue; // the flock left: that is a movement, not a missed day
        out.push({
          kind: "missing_day",
          date,
          flockId: p.flockId,
          flockLabel: flockName(ctx, p.flockId, p.label),
          registerLabel: p.label,
          flockTag: flockTag(ctx, p.flockId),
          source: null,
          reason: `${flockName(ctx, p.flockId, p.label)} reported ${fmt(p.pop ?? 0)} birds on ${prevDate} but has no row on ${date} and no movement record says it left.`,
        });
      }
      // The egg ledger is complete when BOTH a big and a small section exist for the day
      // (a small section with no entries and nothing produced is still a recorded section).
      const eggs = ctx.eggByDate.get(date) ?? [];
      const have = new Set(eggs.map((e) => e.section));
      // the small ledger only matters once a young flock reports (before that it is graded small eggs of the main flocks, recorded or not)
      const lacking = ["big", "small"].filter((sec) => !have.has(sec));
      for (const sec of lacking) {
        out.push({
          kind: "missing_day",
          segment: ledgerSegment(ctx, sec, date),
          date,
          flockId: null,
          flockLabel: null,
          registerLabel: null,
          flockTag: null,
          source: null,
          reason: `Egg stock ledger has no "${sec}" section for ${date}${eggs[0] ? ` (only "${eggs.map((e) => e.section).join('", "')}" was saved)` : " (none saved)"}.`,
        });
      }
      if (!(ctx.boxByDate.get(date) ?? []).length && ctx.boxByDate.size > 0) {
        out.push({ kind: "missing_day", date, flockId: null, flockLabel: null, registerLabel: null, flockTag: null, source: null, reason: `No feed bag box row for ${date}.` });
      }
    }
  }
  return out;
}

// --- "what can go wrong next" -------------------------------------------------

export interface WatchItem {
  kind: "trending_below" | "feed_days" | "mortality_creeping";
  flockId: string | null;
  label: string | null;
  text: string;
}

export function watchList(ctx: Ctx, asOf: string, seg: SegFilter = "all"): WatchItem[] {
  const items: WatchItem[] = [];
  for (const c of flockCards(ctx, asOf)) {
    if (c.status === "left" || c.status === "moult") continue;
    if (seg !== "all" && c.segment !== seg) continue;
    if (c.status === "ramping") {
      // no standard check while ramping; mortality creeping below still applies
      c.stdHd = null;
    }
    const rs = lastRows(ctx, c.flockId, asOf, 14);
    // trending below standard: the gap to standard grew week on week
    if (c.stdHd != null && rs.length >= 10) {
      const recent = mean(rs.slice(-7).map((r) => r.hd).filter((x): x is number => x != null));
      const before = mean(rs.slice(0, rs.length - 7).map((r) => r.hd).filter((x): x is number => x != null));
      if (recent != null && before != null) {
        const worsen = before - recent;
        if (worsen >= RULES.trendWorsenPoints && c.stdHd - recent > 3) {
          items.push({
            kind: "trending_below",
            flockId: c.flockId,
            label: c.label,
            text: `${c.label}: eggs per 100 birds went from ${round(before)} to ${round(recent)} (previous week to this week), now ${round(c.stdHd - recent)} under the breeder's target of ${round(c.stdHd)}.`,
          });
        }
      }
    }
    // mortality creeping: last 7 days vs the 14 before
    const all = lastRows(ctx, c.flockId, asOf, 21);
    if (all.length >= 14) {
      const last7 = mean(all.slice(-7).map((r) => r.mort ?? 0))!;
      const prior = mean(all.slice(0, all.length - 7).map((r) => r.mort ?? 0))!;
      if (prior > 0 && last7 >= RULES.creepRatio * prior && last7 - prior >= RULES.creepMinDeaths) {
        items.push({
          kind: "mortality_creeping",
          flockId: c.flockId,
          label: c.label,
          text: `${c.label}: deaths ${round(prior)}/day → ${round(last7)}/day (last 7 days vs the 14 before).`,
        });
      }
    }
  }
  const fd = seg === "young" ? null : feedDaysLeft(ctx, asOf);
  if (fd) {
    items.push({
      kind: "feed_days",
      flockId: null,
      label: null,
      text: `Feed: ${fmt(fd.closing)} bags = ${round(fd.days)} days at ${round(fd.perDay)} bags/day — runs out about ${addDays(asOf, Math.floor(fd.days))} without a delivery.`,
    });
  }
  return items;
}
