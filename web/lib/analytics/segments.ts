// Per-segment panels (V8 S0.3): one block of numbers per segment, computed only from that
// segment's own flocks (numerator AND denominator). The whole farm is the sum of the segments,
// never an average of percentages. Pure functions; used by Analytics, Today and the checks.
import {
  addDays,
  alertsFor,
  dayTotals,
  eggStockDays,
  farmToday,
  feedDaysLeft,
  ledgerSegment,
  rowsOn,
  rampingUp,
  SEGMENTS,
  type Alert,
  type Ctx,
  type DayTotals,
  type Segment,
} from "./engine";
import { BAG_KG } from "../costs/engine";
import type { PeriodExtras } from "./period";

export interface SegmentPanel {
  segment: Segment;
  asOf: string;
  hasData: boolean;
  today: DayTotals | null;
  eggsAvg7: number | null; // eggs per day, average of the previous 7 days that have data
  hd7: number | null; // pooled over the last 7 days with data (this segment's eggs / this segment's bird-days)
  hdPrev7: number | null; // the 7 days before those
  deathsPerDay7: number | null;
  mortPct7: number | null; // deaths over the 7 days / average birds
  feed: { recorded: boolean; daysRecorded: number; daysInWindow: number; bagsPerDay7: number | null; gPerBird7: number | null; daysLeft: number | null };
  stock: { days: number; closing: number; perDay: number } | null;
  revenue: { dayBig: number; daySmall: number; day: number; weekBig: number; weekSmall: number; week: number; pricedEggsWeek: number; unpricedEggsWeek: number };
  alerts: Alert[];
  flocks: number;
  ramping: number;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Last `n` days (up to and including `asOf`) on which the segment has rows. */
function lastDates(ctx: Ctx, asOf: string, seg: Segment, n: number, before = false): string[] {
  const out: string[] = [];
  for (let i = before ? 1 : 0, g = 0; out.length < n && g < 40; i++, g++) {
    const d = addDays(asOf, -i);
    if (d < ctx.dates[0]) break;
    if (dayTotals(ctx, d, seg)) out.push(d);
  }
  return out;
}

function pooledHd(ctx: Ctx, dates: string[], seg: Segment): number | null {
  const eggs = sum(dates.map((d) => dayTotals(ctx, d, seg)?.eggs ?? 0));
  const birds = sum(dates.map((d) => dayTotals(ctx, d, seg)?.birds ?? 0));
  return birds > 0 ? (eggs / birds) * 100 : null;
}

export function segmentPanel(ctx: Ctx, extras: PeriodExtras, asOf: string, seg: Segment): SegmentPanel {
  const today = dayTotals(ctx, asOf, seg);
  const last7 = lastDates(ctx, asOf, seg, 7);
  const prev7 = last7.length ? lastDates(ctx, addDays(last7[last7.length - 1], 0), seg, 7, true) : [];
  const t7 = last7.map((d) => dayTotals(ctx, d, seg)!);
  const birds7 = t7.length ? sum(t7.map((t) => t.birds)) / t7.length : null;
  const deaths7 = sum(t7.map((t) => t.mort));
  const feedDays = t7.filter((t) => t.feedRecorded);
  const feedBags = sum(feedDays.map((t) => t.feed));
  const feedBirdDays = sum(feedDays.map((t) => t.feedBirds));
  const week = (d: string) => d <= asOf && d > addDays(asOf, -7);
  const sale = (grade: string, onDay: boolean) =>
    sum(extras.sales.filter((x) => (onDay ? x.date === asOf : week(x.date)) && x.grade === grade && ledgerSegment(ctx, grade === "small" ? "small" : "big", x.date) === seg).map((x) => x.amount ?? 0));
  const weekSales = extras.sales.filter((x) => week(x.date) && ledgerSegment(ctx, x.grade === "small" ? "small" : "big", x.date) === seg);
  const rows = rowsOn(ctx, asOf, seg);
  const stock = eggStockDays(ctx, asOf, seg);
  return {
    segment: seg,
    asOf,
    hasData: today != null,
    today,
    eggsAvg7: prev7.length ? sum(prev7.map((d) => dayTotals(ctx, d, seg)!.eggs)) / prev7.length : null,
    hd7: pooledHd(ctx, last7, seg),
    hdPrev7: pooledHd(ctx, prev7, seg),
    deathsPerDay7: t7.length ? deaths7 / t7.length : null,
    mortPct7: birds7 ? (deaths7 / birds7) * 100 : null,
    feed: {
      recorded: feedDays.length > 0,
      daysRecorded: feedDays.length,
      daysInWindow: t7.length,
      bagsPerDay7: feedDays.length ? feedBags / feedDays.length : null,
      gPerBird7: feedBirdDays > 0 ? (feedBags * BAG_KG * 1000) / feedBirdDays : null,
      daysLeft: seg === "main" ? (feedDaysLeft(ctx, asOf)?.days ?? null) : null,
    },
    stock: stock ? { days: stock.days, closing: stock.closing, perDay: stock.perDay } : null,
    revenue: {
      dayBig: sale("big", true),
      daySmall: sale("small", true),
      day: sale("big", true) + sale("small", true),
      weekBig: sale("big", false),
      weekSmall: sale("small", false),
      week: sale("big", false) + sale("small", false),
      pricedEggsWeek: sum(weekSales.filter((x) => x.amount != null).map((x) => x.eggs)),
      unpricedEggsWeek: sum(weekSales.filter((x) => x.amount == null).map((x) => x.eggs)),
    },
    alerts: alertsFor(ctx, asOf, { segment: seg }),
    flocks: rows.length,
    ramping: rows.filter((r) => rampingUp(ctx, r.flockId, asOf)).length,
  };
}

export function allSegmentPanels(ctx: Ctx, extras: PeriodExtras, asOf: string): SegmentPanel[] {
  return SEGMENTS.map((s) => segmentPanel(ctx, extras, asOf, s));
}

/** Rows of flocks with no segment on the day: they appear in the whole-farm total only. */
export function unassignedOn(ctx: Ctx, asOf: string): number {
  return (ctx.byDate.get(asOf) ?? []).length - SEGMENTS.reduce((s, g) => s + rowsOn(ctx, asOf, g).length, 0);
}

/** The whole farm for the same day, with a check that it equals the sum of the segments. */
export function farmCheck(ctx: Ctx, asOf: string) {
  const all = farmToday(ctx, asOf).today;
  const parts = SEGMENTS.map((s) => dayTotals(ctx, asOf, s));
  const eggs = sum(parts.map((p) => p?.eggs ?? 0));
  const birds = sum(parts.map((p) => p?.birds ?? 0));
  const unassigned = unassignedOn(ctx, asOf);
  return { all, eggs, birds, unassigned, ok: !!all && unassigned === 0 && all.eggs === eggs && all.birds === birds };
}
