// Period aggregation: PURE functions (no DB, no framework) that turn the daily
// rows into a summary of ANY date range [from, to] (V15), optionally for chosen
// flocks only. Week / month / year are thin wrappers: they only pick the dates
// (rangeOf) and call the same summarizeRange. Used by the Analytics pages, the
// Compare screen and the Excel export; tested by scripts/period-check.mts and
// scripts/range-check.mts on the real rows.
//
// Rules (docs/DECISIONS.md):
//   - Week = Monday..Sunday. Month and year are calendar periods. A custom range
//     is any from..to (inclusive, plain IST dates, at most 366 days).
//   - With chosen flocks every number uses those flocks' own rows only (their
//     own birds and eggs). Sales, ledger breakage and costs are farm-level: they
//     are not split by flock, so they are left out (farmLevel = false), never zero.
//   - HD% for a period is POOLED: total eggs / total bird-days x 100, never the
//     mean of daily percentages (a day with few birds must not weigh the same
//     as a day with many).
//   - A period with missing days says "N of M days have data"; every average
//     uses only days that have data.
//   - A cost that was not entered is MISSING, never zero: totals are labelled
//     "so far" and the profit "incomplete".
//   - Bird sales and Anil-farm transfers are bird MOVEMENTS, never mortality.
import {
  addDays,
  alertsFor,
  breedName,
  dayTotals,
  diffDays,
  eggStockDays,
  feedDaysLeft,
  ledgerSegment,
  moultOn,
  rampingUp,
  RAMP_DAYS,
  RULES,
  segmentOn,
  stdFor,
  type AlertKind,
  type CardStatus,
  type Ctx,
  type RefReason,
  type SegFilter,
} from "./engine";
import { BAG_KG, dayEconomics, type CostInput } from "../costs/engine";

export type PeriodKind = "week" | "month" | "year";
/** A week / month / year, or any from..to the owner picked (V15). */
export type RangeKind = PeriodKind | "custom";
export const MAX_RANGE_DAYS = 366;

export interface PeriodRange {
  kind: RangeKind;
  from: string;
  to: string;
  days: number; // calendar days in the full period
  label: string;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dow = (d: string) => new Date(d + "T00:00:00Z").getUTCDay();
const dm = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;
const lastOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");

/** Monday on or before `d`. */
export function weekStart(d: string): string {
  return addDays(d, -((dow(d) + 6) % 7));
}

export function rangeOf(kind: PeriodKind, anchor: string): PeriodRange {
  if (kind === "week") {
    const from = weekStart(anchor);
    const to = addDays(from, 6);
    return { kind, from, to, days: 7, label: `${DOW[dow(from)]} ${dm(from)} – ${DOW[dow(to)]} ${dm(to)}` };
  }
  if (kind === "month") {
    const y = Number(anchor.slice(0, 4));
    const m = Number(anchor.slice(5, 7));
    const n = lastOfMonth(y, m);
    return { kind, from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(n)}`, days: n, label: `${MON[m - 1]} ${y}` };
  }
  const y = Number(anchor.slice(0, 4));
  return { kind, from: `${y}-01-01`, to: `${y}-12-31`, days: (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365, label: String(y) };
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (d: string | null | undefined): d is string => !!d && isoDay.test(d) && !Number.isNaN(Date.parse(d + "T00:00:00Z")) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;

/** "1 Sep – 15 Sep 2026", "15 Sep 2026" (one day), "25 Dec 2026 – 5 Jan 2027". */
export function rangeLabel(from: string, to: string): string {
  const y1 = from.slice(0, 4);
  const y2 = to.slice(0, 4);
  if (from === to) return `${dm(from)} ${y1}`;
  return y1 === y2 ? `${dm(from)} – ${dm(to)} ${y2}` : `${dm(from)} ${y1} – ${dm(to)} ${y2}`;
}

/** Any from..to as a range (dates already valid and from <= to). */
export function makeRange(from: string, to: string): PeriodRange {
  return { kind: "custom", from, to, days: diffDays(to, from) + 1, label: rangeLabel(from, to) };
}

/**
 * The range the owner asked for, made safe, with a plain sentence for every change:
 * from after to = swapped; dates after `today` are left out; more than 366 days = the last 366 days up to `to`.
 */
export function customRange(fromIn: string, toIn: string, opts: { today?: string } = {}): { range: PeriodRange; notes: string[]; swapped: boolean } {
  const notes: string[] = [];
  let from = fromIn;
  let to = toIn;
  const swapped = from > to;
  if (swapped) {
    [from, to] = [to, from];
    notes.push(`"From" (${dm(fromIn)} ${fromIn.slice(0, 4)}) was after "To" (${dm(toIn)} ${toIn.slice(0, 4)}), so the two dates were swapped.`);
  }
  if (opts.today && to > opts.today) {
    notes.push(`Dates after today (${dm(opts.today)} ${opts.today.slice(0, 4)}) are left out.`);
    to = opts.today;
    if (from > to) from = to;
  }
  if (diffDays(to, from) + 1 > MAX_RANGE_DAYS) {
    from = addDays(to, -(MAX_RANGE_DAYS - 1));
    notes.push(`A range can be at most ${MAX_RANGE_DAYS} days, so it starts on ${dm(from)} ${from.slice(0, 4)} (${MAX_RANGE_DAYS} days up to ${dm(to)} ${to.slice(0, 4)}).`);
  }
  return { range: makeRange(from, to), notes, swapped };
}

/** How the range sits against the data: days before the first entered day and after the last one (they are empty, never filled in). */
export function rangeCoverage(ctx: Ctx, r: PeriodRange): { firstData: string | null; lastData: string | null; before: number; after: number; note: string | null } {
  const firstData = ctx.dates[0] ?? null;
  const lastData = ctx.dates[ctx.dates.length - 1] ?? null;
  if (!firstData || !lastData) return { firstData, lastData, before: r.days, after: 0, note: "No daily rows are entered yet." };
  const before = r.from < firstData ? Math.min(r.days, diffDays(firstData, r.from)) : 0;
  const after = r.to > lastData ? Math.min(r.days, diffDays(r.to, lastData)) : 0;
  const parts: string[] = [];
  if (before > 0) parts.push(`data starts on ${dm(firstData)} ${firstData.slice(0, 4)}, so the ${before} day${before === 1 ? "" : "s"} before ${before === r.days ? "(the whole range) are" : "it are"} empty`);
  if (after > 0) parts.push(`the last entered day is ${dm(lastData)} ${lastData.slice(0, 4)}, so the ${after} day${after === 1 ? "" : "s"} after it ${after === 1 ? "is" : "are"} empty`);
  return { firstData, lastData, before, after, note: parts.length ? parts.join("; ").replace(/^./, (c) => c.toUpperCase()) + "." : null };
}

/** The range of the same length just before this one (custom), or the previous week / month / year. */
export function precedingRange(r: PeriodRange): PeriodRange {
  return shiftRange(r, -1);
}

/** The period `steps` before (negative) or after (positive) this one. A custom range moves by its own length. */
export function shiftRange(r: PeriodRange, steps: number): PeriodRange {
  if (r.kind === "custom") return makeRange(addDays(r.from, r.days * steps), addDays(r.to, r.days * steps));
  if (r.kind === "week") return rangeOf("week", addDays(r.from, 7 * steps));
  if (r.kind === "month") {
    const t = Number(r.from.slice(0, 4)) * 12 + Number(r.from.slice(5, 7)) - 1 + steps;
    return rangeOf("month", `${Math.floor(t / 12)}-${pad((t % 12) + 1)}-01`);
  }
  return rangeOf("year", `${Number(r.from.slice(0, 4)) + steps}-01-01`);
}

/** Same period one year earlier (a week is shifted by 52 weeks, so it stays Monday..Sunday). */
export function lastYearRange(r: PeriodRange): PeriodRange {
  if (r.kind === "custom") {
    const back = (d: string) => { const y = Number(d.slice(0, 4)) - 1; const m = Number(d.slice(5, 7)); return `${y}-${pad(m)}-${pad(Math.min(Number(d.slice(8, 10)), lastOfMonth(y, m)))}`; };
    return makeRange(back(r.from), back(r.to));
  }
  if (r.kind === "week") return shiftRange(r, -52);
  if (r.kind === "month") return shiftRange(r, -12);
  return shiftRange(r, -1);
}

// ---- extra inputs the engines do not carry ----------------------------------
export interface PeriodSale {
  date: string;
  eggs: number;
  amount: number | null; // null = unpriced
  grade: string; // 'big' | 'small' | other
  channel: "farmfresh" | "local";
  buyer?: string | null;
}
export interface PeriodExtras {
  sales: PeriodSale[];
  /** Eggs taken out of stock that were not sold: positive numbers. category: breakage | labour_take | gift | other */
  deductions: { date: string; category: string; eggs: number; section?: string }[];
  /** Bird sales (movement_type 'sale'). birds is positive. */
  birdSales: { date: string; birds: number; amount: number | null; buyer: string | null }[];
}

// ---- summary ----------------------------------------------------------------
export interface DayPoint {
  date: string;
  eggs: number;
  hd: number | null;
  deaths: number;
  feedBags: number;
  birds: number;
}

export interface FlockPeriod {
  flockId: string;
  label: string;
  registerLabel: string;
  breed: string;
  days: number;
  eggs: number;
  shareOfEggs: number | null; // % of the farm's eggs
  hd: number | null; // pooled
  stdHd: number | null; // standard for the flock's age/breed at the end of its period
  gap: number | null; // std - hd (points; positive = below)
  realisticHd: number | null; // our realistic target at the end of the period (null = not learned yet)
  status: CardStatus;
  refReason: RefReason;
  statusNote: string;
  deaths: number;
  deathsPct: number | null; // of the flock's first-day bird count
  feedGPerBird: number | null;
  birdsAtEnd: number | null;
}

export interface PeriodSummary {
  segment: SegFilter; // which group these numbers are for; "all" = the whole farm (sum of the segments)
  /** V15: the flocks chosen (flock ids), or null = every flock of the segment. */
  flockFilter: string[] | null;
  /** V15: false when flocks are chosen: sales, ledger breakage and costs are farm-level and are not split by flock (left out, never zero). */
  farmLevel: boolean;
  range: PeriodRange;
  firstDate: string | null;
  lastDate: string | null;
  daysWithData: number;
  partial: boolean; // fewer days with data than days in the period
  dataNote: string; // "7 of 7 days have data" / "so far, 3 days" etc.
  series: DayPoint[];
  maxTemps: Record<string, number>; // max temperature (°C) per day of the period that has weather; {} = weather not available
  eggs: {
    total: number;
    trays: number;
    perDay: number | null;
    hdPooled: number | null;
    hdMeanOfDaily: number | null; // shown only to prove the two differ; never the headline
    best: { date: string; hd: number } | null;
    worst: { date: string; hd: number } | null;
    breakage: number;
    breakagePct: number | null; // of eggs laid
    otherOut: number; // labour take, gifts, other (not sales, not breakage)
    otherOutPct: number | null;
  };
  birds: {
    opening: number | null;
    closing: number | null;
    deaths: number;
    deathsPct: number | null; // of opening birds
    deathsPer1000: number | null;
    soldOut: number;
    anilOut: number;
    anilIn: number;
    otherAdjust: number;
  };
  feed: {
    bags: number;
    kg: number;
    recorded: boolean; // false when no row of this group records feed (left-page flocks)
    gPerBirdDay: number | null;
    kgPer100Eggs: number | null;
    daysLeftAtEnd: number | null;
    eggStockDaysAtEnd: number | null;
  };
  money: {
    eggsSold: number;
    unpricedEggs: number;
    revenue: number; // priced egg sales only
    revenueByGrade: Record<string, number>;
    revenueByChannel: Record<string, number>;
    eggsByChannel: Record<string, number>;
    eggsByGrade: Record<string, number>;
    byBuyer: { buyer: string; eggs: number; revenue: number }[]; // largest first; "(not recorded)" when blank
    avgPricePerEgg: number | null; // revenue / priced eggs
    birdSaleRevenue: number;
    cost: { feed: number; electricity: number; labour: number; packing: number; diesel: number; medicine: number; other: number; chicks: number; total: number };
    chickPurchases: number;
    chickPrice: number | null; // average price per chick in force (settings), for the label
    feedPerKg: number | null; // feed price per kg in force at the end of the period
    costSplit: boolean; // false for one segment: shared costs are not split between segments, so cost and profit are shown for the whole farm only
    missing: string[]; // inputs not entered; the cost total is "so far", not complete
    costComplete: boolean;
    profit: number | null; // an ESTIMATE; null when no priced sales
    revenuePerEgg: number | null;
    costPerEgg: number | null;
    profitPerTray: number | null; // per tray sold
  };
  flocks: FlockPeriod[];
  alerts: { total: number; byKind: Partial<Record<AlertKind, number>> };
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const meanOf = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);

/** Week / month / year (V7): the same engine as any range, for one segment. */
export function summarizePeriod(ctx: Ctx, cost: CostInput, extras: PeriodExtras, range: PeriodRange, seg: SegFilter = "all"): PeriodSummary {
  return summarizeRange(ctx, cost, extras, range, { segment: seg });
}

export interface RangeFilter {
  segment?: SegFilter;
  /** Flock ids; null / empty = every flock of the segment. */
  flocks?: readonly string[] | null;
}

/** THE period engine (V15): every number for the days from..to (inclusive), for a segment and/or chosen flocks. */
export function summarizeRange(ctx: Ctx, cost: CostInput, extras: PeriodExtras, range: PeriodRange, filter: RangeFilter = {}): PeriodSummary {
  const seg: SegFilter = filter.segment ?? "all";
  const only = filter.flocks && filter.flocks.length ? new Set(filter.flocks) : undefined;
  const { from, to } = range;
  const dates = ctx.dates.filter((d) => d >= from && d <= to && dayTotals(ctx, d, seg, only) != null);
  const series: DayPoint[] = dates.map((d) => {
    const t = dayTotals(ctx, d, seg, only)!;
    return { date: d, eggs: t.eggs, hd: t.hd, deaths: t.mort, feedBags: t.feed, birds: t.birds };
  });
  const maxTemps: Record<string, number> = {};
  for (const [d, w] of ctx.weatherByDate) if (d >= from && d <= to && w.tempMax != null) maxTemps[d] = w.tempMax;
  const inScope = (r: { flockId: string; date: string }) => (seg === "all" || segmentOn(ctx, r.flockId, r.date) === seg) && (!only || only.has(r.flockId));
  const farmLevel = !only;
  const rows = ctx.input.prod.filter((r) => r.date >= from && r.date <= to && inScope(r));
  const feedRows = rows.filter((r) => r.feed != null);
  const eggsTotal = sum(rows.map((r) => r.eggs ?? 0));
  const birdDays = sum(rows.map((r) => r.pop ?? 0));
  const deaths = sum(rows.map((r) => r.mort ?? 0));
  const bags = sum(feedRows.map((r) => r.feed ?? 0));
  const feedBirdDays = sum(feedRows.map((r) => r.pop ?? 0));
  const kg = bags * BAG_KG;
  const firstDate = dates[0] ?? null;
  const lastDate = dates[dates.length - 1] ?? null;
  const n = dates.length;
  const dataNote =
    n === 0 ? "no data in this period" : `${n} of ${range.days} day${range.days === 1 ? "" : "s"} have data`;

  // best / worst day by farm HD%
  const withHd = series.filter((s): s is DayPoint & { hd: number } => s.hd != null);
  const best = withHd.length ? withHd.reduce((a, b) => (b.hd > a.hd ? b : a)) : null;
  const worst = withHd.length ? withHd.reduce((a, b) => (b.hd < a.hd ? b : a)) : null;

  // deductions
  const ded = farmLevel ? extras.deductions.filter((d) => d.date >= from && d.date <= to && (seg === "all" || ledgerSegment(ctx, d.section ?? "big", d.date) === seg)) : [];
  const breakage = sum(ded.filter((d) => d.category === "breakage").map((d) => d.eggs));
  const otherOut = sum(ded.filter((d) => d.category !== "breakage").map((d) => d.eggs));

  // birds: opening = day-before closing when known, else first day's end count rebuilt
  const popOn = (d: string) => sum(ctx.input.prod.filter((r) => r.date === d && inScope(r)).map((r) => r.pop ?? 0));
  const prevDate = [...ctx.dates].reverse().find((d) => d < from && dayTotals(ctx, d, seg, only) != null) ?? null;
  const mv = ctx.input.movements.filter((m) => m.date >= from && m.date <= to && inScope(m));
  const isAnil = (m: { type: string }) => m.type === "transfer_in" || m.type === "transfer_out";
  let opening: number | null = null;
  if (firstDate) {
    if (prevDate && diffDays(firstDate, prevDate) <= 3) opening = popOn(prevDate);
    else {
      const firstMort = sum(series[0] ? [series[0].deaths] : [0]);
      const firstMoves = sum(ctx.input.movements.filter((m) => m.date === firstDate && inScope(m)).map((m) => m.change));
      opening = popOn(firstDate) + firstMort - firstMoves;
    }
  }
  const closing = lastDate ? popOn(lastDate) : null;

  // money
  const split = seg === "all" && farmLevel;
  const priceOn = (type: string): number | null => {
    let best: { v: number; from: string } | null = null;
    for (const x of cost.settings) if (x.type === type && !x.month && x.effectiveFrom <= to && (!best || x.effectiveFrom > best.from)) best = { v: x.value, from: x.effectiveFrom };
    return best ? best.v : null;
  };
  const econ = split ? dates.map((d) => dayEconomics(cost, d)) : [];
  const cs = (f: (e: (typeof econ)[number]) => number) => sum(econ.map(f));
  const costObj = {
    feed: cs((e) => e.cost.feed),
    electricity: cs((e) => e.cost.electricity),
    labour: cs((e) => e.cost.labour),
    packing: cs((e) => e.cost.packing),
    diesel: cs((e) => e.cost.diesel),
    medicine: cs((e) => e.cost.medicine),
    other: cs((e) => e.cost.other),
    chicks: cs((e) => e.cost.chicks),
    total: cs((e) => e.cost.total),
  };
  const saleSeg = (x: PeriodSale) => ledgerSegment(ctx, x.grade === "small" ? "small" : "big", x.date);
  const sales = farmLevel ? extras.sales.filter((s) => s.date >= from && s.date <= to && (seg === "all" || saleSeg(s) === seg)) : [];
  const eggsSold = sum(sales.map((s) => s.eggs));
  const priced = sales.filter((s) => s.amount != null);
  const unpricedEggs = sum(sales.filter((s) => s.amount == null).map((s) => s.eggs));
  const revenue = sum(priced.map((s) => s.amount!));
  const by = <K extends string>(rowsIn: PeriodSale[], key: (s: PeriodSale) => K, val: (s: PeriodSale) => number) => {
    const o: Record<string, number> = {};
    for (const s of rowsIn) o[key(s)] = (o[key(s)] ?? 0) + val(s);
    return o;
  };
  const missing = [...new Set(econ.flatMap((e) => e.missing))];
  const pricedEggs = sum(priced.map((s) => s.eggs));
  const money: PeriodSummary["money"] = {
    eggsSold,
    unpricedEggs,
    revenue,
    revenueByGrade: by(priced, (s) => s.grade, (s) => s.amount!),
    revenueByChannel: by(priced, (s) => s.channel, (s) => s.amount!),
    eggsByChannel: by(sales, (s) => s.channel, (s) => s.eggs),
    eggsByGrade: by(sales, (s) => s.grade, (s) => s.eggs),
    byBuyer: Object.values(
      sales.reduce<Record<string, { buyer: string; eggs: number; revenue: number }>>((o, x) => {
        const k = (x.buyer ?? "").trim() || "(not recorded)";
        const e = (o[k] ??= { buyer: k, eggs: 0, revenue: 0 });
        e.eggs += x.eggs;
        e.revenue += x.amount ?? 0;
        return o;
      }, {})
    ).sort((a, b) => b.revenue - a.revenue),
    avgPricePerEgg: pricedEggs > 0 ? revenue / pricedEggs : null,
    birdSaleRevenue: split ? sum(extras.birdSales.filter((b) => b.date >= from && b.date <= to).map((b) => b.amount ?? 0)) : 0,
    costSplit: split,
    chickPrice: priceOn("chick_cost_per_chick"),
    feedPerKg: priceOn("feed_per_kg"),
    cost: costObj,
    chickPurchases: cs((e) => e.chickPurchases),
    missing,
    costComplete: missing.length === 0,
    profit: split && revenue > 0 ? revenue - costObj.total : null,
    revenuePerEgg: eggsSold > 0 && revenue > 0 && unpricedEggs === 0 ? revenue / eggsSold : null,
    costPerEgg: split && eggsTotal > 0 ? costObj.total / eggsTotal : null,
    profitPerTray: split && revenue > 0 && eggsSold > 0 ? (revenue - costObj.total) / (eggsSold / 30) : null,
  };

  // per flock
  const flocks: FlockPeriod[] = [];
  for (const [flockId, all] of ctx.byFlock) {
    const rs = all.filter((r) => r.date >= from && r.date <= to && inScope(r));
    if (rs.length === 0) continue;
    const flock = ctx.flockById.get(flockId);
    const last = rs[rs.length - 1];
    const eggs = sum(rs.map((r) => r.eggs ?? 0));
    const bd = sum(rs.map((r) => r.pop ?? 0));
    const hd = bd > 0 ? (eggs / bd) * 100 : null;
    const { std, why, reason: baseReason } = stdFor(ctx, flock, last.date);
    let reason: RefReason = baseReason;
    const rt = std != null && ctx.realisticHd ? ctx.realisticHd(flockId, last.date) : null;
    const moultDays = rs.filter((r) => moultOn(ctx, flockId, r.date)).length;
    const gap = std != null && hd != null ? std - hd : null;
    let status: CardStatus;
    let note: string;
    const ramp = rampingUp(ctx, flockId, last.date);
    if (ramp && moultDays === 0) {
      status = "ramping";
      note = `Ramping up: day ${ramp.day} of lay; no standard check until day ${RAMP_DAYS + 1}.`;
    } else if (moultDays * 2 > rs.length) {
      status = "moult";
      const mo = moultOn(ctx, flockId, last.date) ?? [...rs].reverse().map((r) => moultOn(ctx, flockId, r.date)).find(Boolean);
      note = `Moulting on ${moultDays} of ${rs.length} days${mo && !mo.confirmed ? "; moult dates not confirmed" : ""}; not judged against the breeder's target.`;
    } else if (std == null || hd == null) {
      status = "no_reference";
      note = why || "No HD% in this period.";
    } else if (rt && rt.value == null) {
      status = "no_reference";
      reason = "realistic_not_learned";
      note = `HD ${hd.toFixed(1)}%; breeder's target ${std.toFixed(1)}% (${Math.abs(std - hd).toFixed(1)} points ${std > hd ? "below" : "above"} the book). Our realistic target is not learned yet for this age, so there is no colour.`;
    } else {
      const target = rt ? rt.value! : std;
      const ratio = hd / target;
      status = ratio >= RULES.greenMinRatio ? "green" : ratio >= RULES.amberMinRatio ? "amber" : "red";
      note = rt
        ? `HD ${hd.toFixed(1)}% vs our realistic target ${target.toFixed(1)}% (${Math.round(ratio * 100)}% of it); the breeder's book says ${std.toFixed(1)}%.`
        : `HD ${hd.toFixed(1)}% vs ${breedName(flock?.breed)} standard ${std.toFixed(1)}% (${Math.round(ratio * 100)}% of standard).`;
    }
    const fRows = rs.filter((r) => r.feed != null);
    const fd = sum(fRows.map((r) => r.feed ?? 0));
    const fbd = sum(fRows.map((r) => r.pop ?? 0));
    const d = sum(rs.map((r) => r.mort ?? 0));
    const first = rs[0];
    flocks.push({
      flockId,
      label: flock?.label ?? last.label,
      registerLabel: last.label,
      breed: breedName(flock?.breed),
      days: rs.length,
      eggs,
      shareOfEggs: pct(eggs, eggsTotal),
      hd,
      stdHd: std,
      gap,
      realisticHd: rt?.value ?? null,
      status,
      refReason: reason,
      statusNote: note,
      deaths: d,
      deathsPct: first.pop != null ? pct(d, first.pop + (first.mort ?? 0)) : null,
      feedGPerBird: fbd > 0 ? (fd * BAG_KG * 1000) / fbd : null,
      birdsAtEnd: last.pop,
    });
  }
  const order: Record<CardStatus, number> = { red: 0, amber: 1, moult: 2, ramping: 3, green: 4, no_reference: 5, left: 6 };
  flocks.sort((a, b) => order[a.status] - order[b.status] || a.label.localeCompare(b.label, undefined, { numeric: true }));

  // alerts raised in the period (alertsFor already drops August, reviewed rows and the never-flag list)
  const byKind: Partial<Record<AlertKind, number>> = {};
  let total = 0;
  for (const d of dates) {
    for (const a of alertsFor(ctx, d, { segment: seg })) {
      if (only && !(a.flockId && only.has(a.flockId))) continue; // chosen flocks: only their own alerts
      byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
      total++;
    }
  }

  return {
    segment: seg,
    flockFilter: only ? [...only] : null,
    farmLevel,
    range,
    firstDate,
    lastDate,
    daysWithData: n,
    partial: n < range.days,
    dataNote,
    series,
    maxTemps,
    eggs: {
      total: eggsTotal,
      trays: eggsTotal / 30,
      perDay: n ? eggsTotal / n : null,
      hdPooled: birdDays > 0 ? (eggsTotal / birdDays) * 100 : null,
      hdMeanOfDaily: meanOf(withHd.map((s) => s.hd)),
      best: best ? { date: best.date, hd: best.hd } : null,
      worst: worst ? { date: worst.date, hd: worst.hd } : null,
      breakage,
      breakagePct: farmLevel ? pct(breakage, eggsTotal) : null,
      otherOut,
      otherOutPct: farmLevel ? pct(otherOut, eggsTotal) : null,
    },
    birds: {
      opening,
      closing,
      deaths,
      deathsPct: opening ? pct(deaths, opening) : null,
      deathsPer1000: opening ? (deaths / opening) * 1000 : null,
      soldOut: -sum(mv.filter((m) => m.type === "sale").map((m) => m.change)),
      anilOut: -sum(mv.filter((m) => m.type === "transfer_out").map((m) => m.change)),
      anilIn: sum(mv.filter((m) => m.type === "transfer_in").map((m) => m.change)),
      otherAdjust: sum(mv.filter((m) => !isAnil(m) && m.type !== "sale").map((m) => m.change)),
    },
    feed: {
      bags,
      kg,
      recorded: feedRows.length > 0,
      gPerBirdDay: feedBirdDays > 0 ? (kg * 1000) / feedBirdDays : null,
      kgPer100Eggs: feedRows.length > 0 && eggsTotal > 0 ? (kg / sum(feedRows.map((r) => r.eggs ?? 0))) * 100 : null,
      daysLeftAtEnd: lastDate && seg !== "young" && farmLevel ? (feedDaysLeft(ctx, lastDate)?.days ?? null) : null,
      eggStockDaysAtEnd: lastDate && farmLevel ? (eggStockDays(ctx, lastDate, seg)?.days ?? null) : null,
    },
    money,
    flocks,
    alerts: { total, byKind },
  };
}

// ---- comparison --------------------------------------------------------------
export interface Change {
  key: string;
  label: string;
  now: number | null;
  before: number | null;
  abs: number | null;
  pct: number | null;
  good: boolean | null; // null = no change / not comparable
  unit: string;
}

/** Rate metrics only (per day with data), so a partial period is never compared as a total with a full one. */
const METRICS: { key: string; label: string; unit: string; higherIsBetter: boolean; get: (s: PeriodSummary) => number | null }[] = [
  { key: "eggsPerDay", label: "Eggs per day", unit: "", higherIsBetter: true, get: (s) => s.eggs.perDay },
  { key: "hd", label: "HD % (pooled)", unit: " pts", higherIsBetter: true, get: (s) => s.eggs.hdPooled },
  { key: "deathsPct", label: "Deaths % of opening birds", unit: " pts", higherIsBetter: false, get: (s) => s.birds.deathsPct },
  { key: "feedG", label: "Feed g / bird / day", unit: " g", higherIsBetter: false, get: (s) => s.feed.gPerBirdDay },
  { key: "revenueDay", label: "Revenue per day", unit: "", higherIsBetter: true, get: (s) => (s.daysWithData ? s.money.revenue / s.daysWithData : null) },
  { key: "costDay", label: "Cost per day (so far)", unit: "", higherIsBetter: false, get: (s) => (s.money.costSplit && s.daysWithData ? s.money.cost.total / s.daysWithData : null) },
  { key: "profitDay", label: "Profit per day (estimate)", unit: "", higherIsBetter: true, get: (s) => (s.money.profit != null && s.daysWithData ? s.money.profit / s.daysWithData : null) },
];

export function compare(now: PeriodSummary, before: PeriodSummary | null): Change[] {
  return METRICS.map((m) => {
    const a = m.get(now);
    const b = before && before.daysWithData > 0 ? m.get(before) : null;
    const abs = a != null && b != null ? a - b : null;
    return {
      key: m.key,
      label: m.label,
      unit: m.unit,
      now: a,
      before: b,
      abs,
      pct: abs != null && b != null && b !== 0 ? (abs / Math.abs(b)) * 100 : null,
      good: abs == null || Math.abs(abs) < 1e-9 ? null : m.higherIsBetter ? abs > 0 : abs < 0,
    };
  });
}

// ---- sub-periods -------------------------------------------------------------
/** Monday..Sunday weeks that overlap the range, clipped to the range. */
export function weeksWithin(range: PeriodRange): PeriodRange[] {
  const out: PeriodRange[] = [];
  for (let s = weekStart(range.from); s <= range.to; s = addDays(s, 7)) {
    const w = rangeOf("week", s);
    out.push({ ...w, from: w.from < range.from ? range.from : w.from, to: w.to > range.to ? range.to : w.to, days: 0 });
  }
  for (const w of out) w.days = diffDays(w.to, w.from) + 1;
  return out;
}

export function monthsWithin(range: PeriodRange): PeriodRange[] {
  const out: PeriodRange[] = [];
  for (let m = 0; m < 12; m++) {
    const r = rangeOf("month", `${range.from.slice(0, 4)}-${pad(m + 1)}-01`);
    if (r.from >= range.from && r.to <= range.to) out.push(r);
  }
  return out;
}

/** "Run rate" of the last full month x 12, only with at least two full months of data. */
export function runRate(monthSummaries: PeriodSummary[]): { month: string; eggsYear: number; revenueYear: number | null } | null {
  const full = monthSummaries.filter((s) => s.daysWithData === s.range.days);
  if (full.length < 2) return null;
  const last = full[full.length - 1];
  return { month: last.range.label, eggsYear: last.eggs.total * 12, revenueYear: last.money.revenue > 0 ? last.money.revenue * 12 : null };
}

// ---- custom ranges (V15) -------------------------------------------------------
/** Calendar months that overlap the range, clipped to it (a clipped month is labelled with its real dates). */
export function monthsClipped(range: PeriodRange): PeriodRange[] {
  const out: PeriodRange[] = [];
  for (let m = rangeOf("month", range.from); m.from <= range.to; m = shiftRange(m, 1)) {
    const from = m.from < range.from ? range.from : m.from;
    const to = m.to > range.to ? range.to : m.to;
    out.push(from === m.from && to === m.to ? m : { ...makeRange(from, to), kind: "month" });
  }
  return out;
}

/** The pieces a range table is cut into: weeks for up to 120 days, months beyond. Clipped pieces carry their real dates. */
export function partsWithin(range: PeriodRange): { unit: "week" | "month"; parts: PeriodRange[] } {
  if (range.days <= 120) {
    return { unit: "week", parts: weeksWithin(range).map((w) => (w.days === 7 ? w : { ...w, label: rangeLabel(w.from, w.to) })) };
  }
  return { unit: "month", parts: monthsClipped(range) };
}

/** The last `n` days that have data (the most recent `n` entered dates), as a range ending on the last entered day. */
export function lastDaysWithData(ctx: Ctx, n: number): PeriodRange | null {
  if (ctx.dates.length === 0) return null;
  const to = ctx.dates[ctx.dates.length - 1];
  const from = ctx.dates[Math.max(0, ctx.dates.length - n)];
  return makeRange(from, to);
}

/** The quick chips of the Custom tab. "Last N days" end on the last entered day; "This month" stops at today. */
export function quickRanges(ctx: Ctx, today: string): { key: string; label: string; range: PeriodRange }[] {
  const out: { key: string; label: string; range: PeriodRange }[] = [];
  for (const n of [7, 14, 30]) {
    const r = lastDaysWithData(ctx, n);
    if (r) out.push({ key: `last${n}`, label: n === 7 ? "Last 7 days" : `Last ${n}`, range: r });
  }
  const thisMonth = rangeOf("month", today);
  out.push({ key: "thismonth", label: "This month", range: makeRange(thisMonth.from, today < thisMonth.to ? today : thisMonth.to) });
  const lastMonth = shiftRange(thisMonth, -1);
  out.push({ key: "lastmonth", label: "Last month", range: makeRange(lastMonth.from, lastMonth.to) });
  const last = ctx.dates[ctx.dates.length - 1];
  const aug = "2026-08-01";
  if (last && last >= aug) out.push({ key: "sinceaug", label: "Since 1 Aug", range: makeRange(aug, last) });
  return out;
}
