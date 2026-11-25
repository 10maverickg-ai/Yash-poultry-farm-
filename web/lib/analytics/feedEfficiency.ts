// V17: eggs per kg of feed. PURE (no DB, no framework).
//   eggs per kg = eggs laid ÷ (feed bags × BAG_KG), for the same flocks and the same days.
// Rules (docs/DECISIONS.md, V17):
//   - Pooled over a period: total eggs ÷ total feed kg, never the average of daily ratios.
//   - Only flock-days whose feed is written count: the eggs of a day without a feed figure are left out of
//     both sides, and the screens say "N of M days with feed".
//   - No feed figure at all = null with a reason ("feed not recorded"), never 0.
//   - "kg of feed per 100 eggs" is the same two totals the other way round, so the two always agree.
// The bag weight is the one the app already uses for g/bird (BAG_KG, 45 kg).
import { BAG_KG } from "../costs/engine";
import { addDays, dayTotals, rowsOn, type Ctx, type Segment } from "./engine";

export interface FeedEff {
  eggsPerKg: number | null;
  kgPer100Eggs: number | null;
  eggs: number; // eggs of the flock-days that have a feed figure
  kg: number; // their feed, kg
  days: number; // days with rows
  daysWithFeed: number; // of those, days on which at least one counted row has a feed figure
  why: string | null; // plain reason when eggsPerKg is null
}

export interface EffRow {
  date: string;
  eggs: number | null;
  feed: number | null; // bags; null = not written
}

/** Pooled eggs per kg over flock-day rows (any mix of flocks and days). */
export function feedEfficiency(rows: EffRow[]): FeedEff {
  const fed = rows.filter((r) => r.feed != null);
  const eggs = fed.reduce((s, r) => s + (r.eggs ?? 0), 0);
  const bags = fed.reduce((s, r) => s + (r.feed ?? 0), 0);
  const kg = bags * BAG_KG;
  const days = new Set(rows.map((r) => r.date)).size;
  const daysWithFeed = new Set(fed.map((r) => r.date)).size;
  let why: string | null = null;
  if (rows.length === 0) why = "no data on these days";
  else if (fed.length === 0) why = "feed not recorded on these days";
  else if (kg <= 0) why = "the feed written is 0 bags on these days (no feed given), so there is nothing to divide by";
  return {
    eggsPerKg: why ? null : eggs / kg,
    kgPer100Eggs: !why && eggs > 0 ? (kg / eggs) * 100 : null,
    eggs,
    kg,
    days,
    daysWithFeed,
    why,
  };
}

/** One group (or chosen flocks) over a list of dates. */
export function effOn(ctx: Ctx, dates: string[], seg: Segment | "all" = "all", only?: ReadonlySet<string>): FeedEff {
  return feedEfficiency(dates.flatMap((d) => rowsOn(ctx, d, seg, only).map((r) => ({ date: r.date, eggs: r.eggs, feed: r.feed }))));
}

/** The last `n` dates (up to and including `asOf`, or strictly before it) on which the group has rows, newest first. */
export function lastDatesWithRows(ctx: Ctx, asOf: string, seg: Segment | "all", n: number, before = false): string[] {
  const out: string[] = [];
  for (let i = before ? 1 : 0, g = 0; out.length < n && g < 60; i++, g++) {
    const d = addDays(asOf, -i);
    if (ctx.dates.length === 0 || d < ctx.dates[0]) break;
    if (dayTotals(ctx, d, seg)) out.push(d);
  }
  return out;
}

export interface EffChange {
  abs: number; // now − before (eggs per kg)
  pct: number; // % of before
  good: boolean | null; // more eggs per kg = good; null = no change
}

export interface BoardEff {
  date: string;
  day: FeedEff; // the board day alone
  week: FeedEff & { from: string | null; to: string | null }; // the last 7 days with rows (the same window as the other 7-day tiles)
  prevWeek: FeedEff & { from: string | null; to: string | null }; // the 7 days with rows before those
  change: EffChange | null; // week against prevWeek (null when either has no value)
}

export function compareEff(now: FeedEff, before: FeedEff): EffChange | null {
  if (now.eggsPerKg == null || before.eggsPerKg == null || before.eggsPerKg === 0) return null;
  const abs = now.eggsPerKg - before.eggsPerKg;
  return { abs, pct: (abs / before.eggsPerKg) * 100, good: Math.abs(abs) < 1e-9 ? null : abs > 0 };
}

/** The board tile: the day, the last 7 days and the 7 days before, for one group. */
export function boardEff(ctx: Ctx, asOf: string, seg: Segment): BoardEff {
  const last7 = lastDatesWithRows(ctx, asOf, seg, 7);
  const prev7 = last7.length ? lastDatesWithRows(ctx, last7[last7.length - 1], seg, 7, true) : [];
  const week = effOn(ctx, last7, seg);
  const prevWeek = effOn(ctx, prev7, seg);
  return {
    date: asOf,
    day: effOn(ctx, dayTotals(ctx, asOf, seg) ? [asOf] : [], seg),
    week: { ...week, from: last7[last7.length - 1] ?? null, to: last7[0] ?? null },
    prevWeek: { ...prevWeek, from: prev7[prev7.length - 1] ?? null, to: prev7[0] ?? null },
    change: compareEff(week, prevWeek),
  };
}

/** One flock: its own row on the day and its own last 7 rows up to that day. */
export function flockEff(ctx: Ctx, flockId: string, asOf: string): { day: FeedEff; week: FeedEff } {
  const rows = (ctx.byFlock.get(flockId) ?? []).filter((r) => r.date <= asOf);
  const win = rows.slice(Math.max(0, rows.length - 7));
  const toRow = (r: { date: string; eggs: number | null; feed: number | null }) => ({ date: r.date, eggs: r.eggs, feed: r.feed });
  return { day: feedEfficiency(rows.filter((r) => r.date === asOf).map(toRow)), week: feedEfficiency(win.map(toRow)) };
}

/** Daily eggs per kg for the last `days` calendar days up to `asOf` (null = no feed that day) and the 7-day pooled line. */
export function effTrend(ctx: Ctx, asOf: string, seg: Segment, days = 30): { date: string; value: number | null; avg7: number | null }[] {
  const out: { date: string; value: number | null; avg7: number | null }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(asOf, -i);
    const has = !!dayTotals(ctx, d, seg);
    out.push({ date: d, value: has ? effOn(ctx, [d], seg).eggsPerKg : null, avg7: has ? effOn(ctx, lastDatesWithRows(ctx, d, seg, 7), seg).eggsPerKg : null });
  }
  return out;
}
