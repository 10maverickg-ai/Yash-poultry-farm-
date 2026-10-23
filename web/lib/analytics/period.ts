// Period aggregation: PURE functions (no DB, no framework) that turn the daily
// rows into a week / month / year summary. Used by the Analytics pages and the
// Excel export, and tested by scripts/period-check.mts on the real rows.
//
// Rules (docs/DECISIONS.md):
//   - Week = Monday..Sunday. Month and year are calendar periods.
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
  moultOn,
  RULES,
  stdFor,
  type AlertKind,
  type CardStatus,
  type Ctx,
} from "./engine";
import { BAG_KG, dayEconomics, type CostInput } from "../costs/engine";

export type PeriodKind = "week" | "month" | "year";

export interface PeriodRange {
  kind: PeriodKind;
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

/** The period `steps` before (negative) or after (positive) this one. */
export function shiftRange(r: PeriodRange, steps: number): PeriodRange {
  if (r.kind === "week") return rangeOf("week", addDays(r.from, 7 * steps));
  if (r.kind === "month") {
    const t = Number(r.from.slice(0, 4)) * 12 + Number(r.from.slice(5, 7)) - 1 + steps;
    return rangeOf("month", `${Math.floor(t / 12)}-${pad((t % 12) + 1)}-01`);
  }
  return rangeOf("year", `${Number(r.from.slice(0, 4)) + steps}-01-01`);
}

/** Same period one year earlier (a week is shifted by 52 weeks, so it stays Monday..Sunday). */
export function lastYearRange(r: PeriodRange): PeriodRange {
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
}
export interface PeriodExtras {
  sales: PeriodSale[];
  /** Eggs taken out of stock that were not sold: positive numbers. category: breakage | labour_take | gift | other */
  deductions: { date: string; category: string; eggs: number }[];
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
  status: CardStatus;
  statusNote: string;
  deaths: number;
  deathsPct: number | null; // of the flock's first-day bird count
  feedGPerBird: number | null;
  birdsAtEnd: number | null;
}

export interface PeriodSummary {
  range: PeriodRange;
  firstDate: string | null;
  lastDate: string | null;
  daysWithData: number;
  partial: boolean; // fewer days with data than days in the period
  dataNote: string; // "7 of 7 days have data" / "so far, 3 days" etc.
  series: DayPoint[];
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
    avgPricePerEgg: number | null; // revenue / priced eggs
    birdSaleRevenue: number;
    cost: { feed: number; electricity: number; labour: number; packing: number; diesel: number; medicine: number; other: number; total: number };
    chickPurchases: number;
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

export function summarizePeriod(ctx: Ctx, cost: CostInput, extras: PeriodExtras, range: PeriodRange): PeriodSummary {
  const { from, to } = range;
  const dates = ctx.dates.filter((d) => d >= from && d <= to);
  const series: DayPoint[] = dates.map((d) => {
    const t = dayTotals(ctx, d)!;
    return { date: d, eggs: t.eggs, hd: t.hd, deaths: t.mort, feedBags: t.feed, birds: t.birds };
  });
  const rows = ctx.input.prod.filter((r) => r.date >= from && r.date <= to);
  const eggsTotal = sum(rows.map((r) => r.eggs ?? 0));
  const birdDays = sum(rows.map((r) => r.pop ?? 0));
  const deaths = sum(rows.map((r) => r.mort ?? 0));
  const bags = sum(rows.map((r) => r.feed ?? 0));
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
  const ded = extras.deductions.filter((d) => d.date >= from && d.date <= to);
  const breakage = sum(ded.filter((d) => d.category === "breakage").map((d) => d.eggs));
  const otherOut = sum(ded.filter((d) => d.category !== "breakage").map((d) => d.eggs));

  // birds: opening = day-before closing when known, else first day's end count rebuilt
  const popOn = (d: string) => sum(ctx.input.prod.filter((r) => r.date === d).map((r) => r.pop ?? 0));
  const prevDate = [...ctx.dates].reverse().find((d) => d < from) ?? null;
  const mv = ctx.input.movements.filter((m) => m.date >= from && m.date <= to);
  const isAnil = (m: { type: string }) => m.type === "transfer_in" || m.type === "transfer_out";
  let opening: number | null = null;
  if (firstDate) {
    if (prevDate && diffDays(firstDate, prevDate) <= 3) opening = popOn(prevDate);
    else {
      const firstMort = sum(series[0] ? [series[0].deaths] : [0]);
      const firstMoves = sum(ctx.input.movements.filter((m) => m.date === firstDate).map((m) => m.change));
      opening = popOn(firstDate) + firstMort - firstMoves;
    }
  }
  const closing = lastDate ? popOn(lastDate) : null;

  // money
  const econ = dates.map((d) => dayEconomics(cost, d));
  const cs = (f: (e: (typeof econ)[number]) => number) => sum(econ.map(f));
  const costObj = {
    feed: cs((e) => e.cost.feed),
    electricity: cs((e) => e.cost.electricity),
    labour: cs((e) => e.cost.labour),
    packing: cs((e) => e.cost.packing),
    diesel: cs((e) => e.cost.diesel),
    medicine: cs((e) => e.cost.medicine),
    other: cs((e) => e.cost.other),
    total: cs((e) => e.cost.total),
  };
  const sales = extras.sales.filter((s) => s.date >= from && s.date <= to);
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
    avgPricePerEgg: pricedEggs > 0 ? revenue / pricedEggs : null,
    birdSaleRevenue: sum(extras.birdSales.filter((b) => b.date >= from && b.date <= to).map((b) => b.amount ?? 0)),
    cost: costObj,
    chickPurchases: cs((e) => e.chickPurchases),
    missing,
    costComplete: missing.length === 0,
    profit: revenue > 0 ? revenue - costObj.total : null,
    revenuePerEgg: eggsSold > 0 && revenue > 0 && unpricedEggs === 0 ? revenue / eggsSold : null,
    costPerEgg: eggsTotal > 0 ? costObj.total / eggsTotal : null,
    profitPerTray: revenue > 0 && eggsSold > 0 ? (revenue - costObj.total) / (eggsSold / 30) : null,
  };

  // per flock
  const flocks: FlockPeriod[] = [];
  for (const [flockId, all] of ctx.byFlock) {
    const rs = all.filter((r) => r.date >= from && r.date <= to);
    if (rs.length === 0) continue;
    const flock = ctx.flockById.get(flockId);
    const last = rs[rs.length - 1];
    const eggs = sum(rs.map((r) => r.eggs ?? 0));
    const bd = sum(rs.map((r) => r.pop ?? 0));
    const hd = bd > 0 ? (eggs / bd) * 100 : null;
    const { std, why } = stdFor(ctx, flock, last.date);
    const moultDays = rs.filter((r) => moultOn(ctx, flockId, r.date)).length;
    const gap = std != null && hd != null ? std - hd : null;
    let status: CardStatus;
    let note: string;
    if (moultDays * 2 > rs.length) {
      status = "moult";
      note = `Moulting on ${moultDays} of ${rs.length} days; not judged against the standard.`;
    } else if (std == null || hd == null) {
      status = "no_reference";
      note = why || "No HD% in this period.";
    } else {
      const ratio = hd / std;
      status = ratio >= RULES.greenMinRatio ? "green" : ratio >= RULES.amberMinRatio ? "amber" : "red";
      note = `HD ${hd.toFixed(1)}% vs ${breedName(flock?.breed)} standard ${std.toFixed(1)}% (${Math.round(ratio * 100)}% of standard).`;
    }
    const fd = sum(rs.map((r) => r.feed ?? 0));
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
      status,
      statusNote: note,
      deaths: d,
      deathsPct: first.pop != null ? pct(d, first.pop + (first.mort ?? 0)) : null,
      feedGPerBird: bd > 0 ? (fd * BAG_KG * 1000) / bd : null,
      birdsAtEnd: last.pop,
    });
  }
  const order: Record<CardStatus, number> = { red: 0, amber: 1, moult: 2, green: 3, no_reference: 4, left: 5 };
  flocks.sort((a, b) => order[a.status] - order[b.status] || a.label.localeCompare(b.label, undefined, { numeric: true }));

  // alerts raised in the period (alertsFor already drops August, reviewed rows and the never-flag list)
  const byKind: Partial<Record<AlertKind, number>> = {};
  let total = 0;
  for (const d of dates) {
    for (const a of alertsFor(ctx, d)) {
      byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
      total++;
    }
  }

  return {
    range,
    firstDate,
    lastDate,
    daysWithData: n,
    partial: n < range.days,
    dataNote,
    series,
    eggs: {
      total: eggsTotal,
      trays: eggsTotal / 30,
      perDay: n ? eggsTotal / n : null,
      hdPooled: birdDays > 0 ? (eggsTotal / birdDays) * 100 : null,
      hdMeanOfDaily: meanOf(withHd.map((s) => s.hd)),
      best: best ? { date: best.date, hd: best.hd } : null,
      worst: worst ? { date: worst.date, hd: worst.hd } : null,
      breakage,
      breakagePct: pct(breakage, eggsTotal),
      otherOut,
      otherOutPct: pct(otherOut, eggsTotal),
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
      gPerBirdDay: birdDays > 0 ? (kg * 1000) / birdDays : null,
      kgPer100Eggs: eggsTotal > 0 ? (kg / eggsTotal) * 100 : null,
      daysLeftAtEnd: lastDate ? (feedDaysLeft(ctx, lastDate)?.days ?? null) : null,
      eggStockDaysAtEnd: lastDate ? (eggStockDays(ctx, lastDate)?.days ?? null) : null,
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
  { key: "costDay", label: "Cost per day (so far)", unit: "", higherIsBetter: false, get: (s) => (s.daysWithData ? s.money.cost.total / s.daysWithData : null) },
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
