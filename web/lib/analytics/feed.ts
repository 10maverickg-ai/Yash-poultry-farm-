// V16: feed for ONE day and for the last 7 days, always as a labelled pair, so a 7-day average is never
// read as the day's figure. PURE. Built on the existing per-day totals (dayTotals: bags of the rows that
// record feed, and the birds of those rows) and the existing bag weight (BAG_KG). It does not touch the
// "days of feed stock left" calculation (feedDaysLeft), which stays as it was.
import { addDays, dayTotals, type Ctx, type Segment } from "./engine";
import { BAG_KG } from "../costs/engine";

/** One day of feed: bags as written (null = the register has no feed figure that day) and grams per bird. */
export interface FeedDay {
  date: string;
  recorded: boolean;
  bags: number | null;
  birds: number | null; // birds of the rows that record feed (the g/bird denominator)
  gPerBird: number | null;
}

/** The last 7 days that have rows (up to and including the board day). Totals and averages use only the days with feed. */
export interface FeedWeek {
  from: string | null;
  to: string | null;
  days: number; // days with rows in the window (at most 7)
  daysRecorded: number; // of those, days that record feed
  bags: number | null; // total
  bagsPerDay: number | null; // average per day with feed
  gPerBird: number | null; // pooled: total bags × bag weight ÷ total bird-days of the same days
}

export interface FeedPair {
  day: FeedDay;
  week: FeedWeek;
}

/** Grams of feed per bird: bags × the bag weight (BAG_KG) ÷ birds. */
export const gPerBird = (bags: number, birds: number): number | null => (birds > 0 ? (bags * BAG_KG * 1000) / birds : null);

/** One point per day: bags (null = not recorded) and the birds of the rows that record feed. */
export interface FeedPoint {
  date: string;
  bags: number | null;
  birds: number;
}

/** The labelled pair from day points (oldest first, at most the last 7 days with rows, the last one may be the board day). */
export function feedPair(points: FeedPoint[], dayDate: string): FeedPair {
  const today = points.find((p) => p.date === dayDate);
  const fed = points.filter((p) => p.bags != null);
  const bags = fed.reduce((s, p) => s + (p.bags ?? 0), 0);
  const birds = fed.reduce((s, p) => s + p.birds, 0);
  return {
    day: {
      date: dayDate,
      recorded: today?.bags != null,
      bags: today?.bags ?? null,
      birds: today?.bags != null ? today.birds : null,
      gPerBird: today?.bags != null ? gPerBird(today.bags, today.birds) : null,
    },
    week: {
      from: points[0]?.date ?? null,
      to: points[points.length - 1]?.date ?? null,
      days: points.length,
      daysRecorded: fed.length,
      bags: fed.length ? bags : null,
      bagsPerDay: fed.length ? bags / fed.length : null,
      gPerBird: fed.length ? gPerBird(bags, birds) : null,
    },
  };
}

/** A group's feed on the board day and over its last 7 days with rows (the same window as the other 7-day tiles). */
export function segmentFeed(ctx: Ctx, asOf: string, seg: Segment): FeedPair {
  const points: FeedPoint[] = [];
  for (let i = 0, g = 0; points.length < 7 && g < 40 && ctx.dates.length > 0; i++, g++) {
    const d = addDays(asOf, -i);
    if (d < ctx.dates[0]) break;
    const t = dayTotals(ctx, d, seg);
    if (t) points.unshift({ date: d, bags: t.feedRecorded ? t.feed : null, birds: t.feedBirds });
  }
  return feedPair(points, asOf);
}

/** One flock: its own row on the day and its own last 7 rows up to that day. */
export function flockFeed(ctx: Ctx, flockId: string, asOf: string): FeedPair {
  const rows = (ctx.byFlock.get(flockId) ?? []).filter((r) => r.date <= asOf);
  const win = rows.slice(Math.max(0, rows.length - 7));
  return feedPair(win.map((r) => ({ date: r.date, bags: r.feed, birds: r.pop ?? 0 })), asOf);
}
