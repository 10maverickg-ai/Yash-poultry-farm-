import { buildFarmCtx } from "@/lib/analytics/ctx";
import { loadEngineInput } from "@/lib/analytics/load";
import { loadPeriodExtras } from "@/lib/analytics/periodLoad";
import { loadCostInput } from "@/lib/costs/load";
import { ledgerSegment, rowsOn, segmentOn, type Ctx } from "@/lib/analytics/engine";
import { fcrOf, type FcrResult } from "@/lib/analytics/fcr";
import { monthsWithin, rangeCoverage, rangeOf, summarizeRange, summarizePeriod, type PeriodExtras, type PeriodKind, type PeriodRange, type RangeFilter } from "@/lib/analytics/period";
import { readRange, type Param } from "@/lib/analytics/rangeParams";
import { compareRows, compareSide, readCompare } from "@/lib/analytics/compare";
import { SEGMENT_NAME, type SegFilter } from "@/lib/analytics/engine";
import { BAG_KG, dayEconomics, periodEconomics, type CostInput } from "@/lib/costs/engine";
import type { Dataset } from "./types";
import { compareSheet, HD_NOTE } from "./compareSheet";

// Read-only week / month / year / custom-range summaries and the Compare table for Excel and CSV.
// A week, month or range is one row per day; a year is one row per month. HD% is a formula (eggs ÷ bird-days)
// and the totals row pools it (sum of eggs ÷ sum of bird-days), never an average of percentages.
export function validPeriod(kind: string, p: string): boolean {
  if (kind === "year") return /^\d{4}$/.test(p);
  if (kind === "month") return /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
  return /^\d{4}-\d{2}-\d{2}$/.test(p) && !Number.isNaN(Date.parse(p));
}

async function loadAll() {
  const [input, cost, extras] = await Promise.all([loadEngineInput(), loadCostInput(), loadPeriodExtras()]);
  const { ctx } = buildFarmCtx(input);
  return { ctx, cost, extras };
}

const MONEY_NOTE = "Revenue = priced egg sales only. Cost and profit are ESTIMATES: feed exact (each shed's own price that day); labour and electricity spread over the month (a month without a bill: the electricity average); diesel as entered, or the diesel average for a month without any; miscellaneous average ₹30,000 a month; packing per tray sold; medicines inside the feed price from 28 Nov 2026. Interest and top dressing: not entered. No rent.";

const letter = (i: number) => String.fromCharCode(65 + i);
/**
 * V17: "Eggs of flocks with feed" and "Eggs per kg feed" as the last two columns. Eggs per kg is a formula
 * (eggs of the flocks with a feed figure ÷ (feed bags × the bag weight)); the totals row pools it, never an
 * average of the rows. A row without a feed figure stays empty ("feed not recorded"), never 0.
 * V18 B5: then "Feed g per egg" (exact), the feed kg and egg kg of the FCR, and the FCR (estimated from the standard
 * egg weight) as formulas, pooled in the totals row the same way (all feed kg ÷ all egg kg).
 */
function withEggsPerKg(ds: Dataset, eggsFed: (number | null)[], fcr: FcrResult[]): Dataset {
  const n = ds.columns.length;
  const feedCol = letter(ds.columns.findIndex((c) => c.key === "feed"));
  const fedCol = letter(n);
  const [fkCol, ekCol] = [letter(n + 3), letter(n + 4)]; // n: eggs fed, n+1: eggs per kg, n+2: g per egg
  const sumOf = (c: string, f: number, l: number) => `SUM(${c}${f}:${c}${l})`;
  const columns: Dataset["columns"] = [
    ...ds.columns,
    { key: "eggsFed", header: "Eggs of flocks with feed", type: "int", width: 14, total: true },
    { key: "eggsPerKg", header: `Eggs per kg feed (bags × ${BAG_KG} kg)`, type: "num", width: 15, totalFormula: (f, l) => `IF(SUM(${feedCol}${f}:${feedCol}${l})>0,SUM(${fedCol}${f}:${fedCol}${l})/(SUM(${feedCol}${f}:${feedCol}${l})*${BAG_KG}),"")` },
    { key: "gPerEgg", header: "Feed g per egg (exact)", type: "num", width: 12, totalFormula: (f, l) => `IF(${sumOf(fedCol, f, l)}>0,${sumOf(feedCol, f, l)}*${BAG_KG}*1000/${sumOf(fedCol, f, l)},"")` },
    { key: "fcrKg", header: "Feed kg in the FCR (rows with an egg weight)", type: "num", width: 14, total: true },
    { key: "eggKg", header: "Egg kg (eggs × standard egg weight)", type: "num", width: 14, total: true },
    { key: "fcr", header: "FCR (estimated from standard egg weight)", type: "num", width: 14, totalFormula: (f, l) => `IF(${sumOf(ekCol, f, l)}>0,${sumOf(fkCol, f, l)}/${sumOf(ekCol, f, l)},"")` },
  ];
  const rows = ds.rows.map((r, i) => {
    const feed = typeof r.feed === "number" ? r.feed : null;
    const fed = eggsFed[i];
    const x = fcr[i];
    return { ...r, eggsFed: feed != null ? fed : null, eggsPerKg: feed != null && feed > 0 && fed != null ? fed / (feed * BAG_KG) : null, gPerEgg: x.feedPerEggG, fcrKg: x.eggKg > 0 ? x.fcrFeedKg : null, eggKg: x.eggKg > 0 ? x.eggKg : null, fcr: x.fcr };
  });
  const leftOut = [...new Set(fcr.map((x) => x.leftOut).filter(Boolean))];
  return {
    ...ds,
    columns,
    rows,
    notes: [
      ...ds.notes,
      `Eggs per kg feed = eggs of the flocks that have a feed figure ÷ (feed bags × ${BAG_KG} kg); the totals row pools it (all those eggs ÷ all that feed). A row with no feed figure is left empty: feed not recorded.`,
      "Feed g per egg = feed kg × 1000 ÷ those eggs (exact). FCR = feed kg ÷ egg kg, ESTIMATED: egg kg = eggs × the BV300 standard egg weight for the flock's age (unless a real weighing is stored); flock-days with no egg-weight reference are left out on both sides. The totals row pools it (all feed kg ÷ all egg kg).",
      ...(leftOut.length ? [`FCR: ${leftOut[0]}.`] : []),
    ],
    formulas: {
      ...(ds.formulas ?? {}),
      eggsPerKg: (row) => `IF(AND(ISNUMBER(${feedCol}${row}),${feedCol}${row}>0),${fedCol}${row}/(${feedCol}${row}*${BAG_KG}),"")`,
      gPerEgg: (row) => `IF(AND(ISNUMBER(${feedCol}${row}),ISNUMBER(${fedCol}${row}),${fedCol}${row}>0),${feedCol}${row}*${BAG_KG}*1000/${fedCol}${row},"")`,
      fcr: (row) => `IF(AND(ISNUMBER(${fkCol}${row}),ISNUMBER(${ekCol}${row}),${ekCol}${row}>0),${fkCol}${row}/${ekCol}${row},"")`,
    },
  };
}

/** Day-by-day rows of any range (week, month or custom), for a segment or chosen flocks. One builder for all of them. */
function dayRowsDataset(ctx: Ctx, cost: CostInput, extras: PeriodExtras, range: PeriodRange, filter: RangeFilter, head: { name: string; title: string; who: string; extraNotes?: string[] }): Dataset {
  const seg: SegFilter = filter.segment ?? "all";
  const s = summarizeRange(ctx, cost, extras, range, filter);
  const only = s.flockFilter ? new Set(s.flockFilter) : undefined;
  const farm = s.farmLevel;
  const notes = [
    farm
      ? `Group: ${head.who}.${seg === "all" ? " It mixes mature and young birds; use the Main and Young files for per-group HD %." : " Numerator and denominator are this group's flocks only; cost and profit are not split by group (blank here, see the whole-farm file)."}`
      : `${head.who}: their own rows only (their birds, eggs, deaths and feed). Sales, revenue, cost and profit are farm-level, not split by flock, so they are not in this file; download "All flocks" for them.`,
    `${range.label}: ${s.dataNote}. Averages use only days with data.`,
    ...(head.extraNotes ?? []),
    HD_NOTE,
    ...(farm ? [MONEY_NOTE] : []),
  ];
  if (s.money.missing.length) notes.push(`MISSING, not zero: ${s.money.missing.join(", ")}. Cost is understated and profit overstated until these are entered.`);
  const columns: Dataset["columns"] = [
    { key: "date", header: "Date", type: "date", width: 13 },
    { key: "eggs", header: "Eggs", type: "int", width: 11, total: true },
    { key: "birddays", header: "Bird-days", type: "int", width: 11, total: true },
    { key: "hd", header: "HD % (eggs ÷ bird-days)", type: "pct", width: 14, totalFormula: (f, l, L) => `SUM(${L.eggs}${f}:${L.eggs}${l})/SUM(${L.birddays}${f}:${L.birddays}${l})*100` },
    { key: "deaths", header: "Deaths", type: "int", width: 9, total: true },
    { key: "feed", header: "Feed (bags)", type: "int", width: 11, total: true },
  ];
  if (farm) {
    columns.push(
      { key: "revenue", header: "Egg revenue ₹", type: "num", width: 14, total: true },
      { key: "cost", header: "Cost so far ₹ (estimate)", type: "num", width: 16, ...(seg === "all" ? { total: true } : {}) },
      { key: "profit", header: "Profit ₹ (estimate)", type: "num", width: 15, ...(seg !== "all" ? {} : { totalFormula: (f: number, l: number, L: Record<string, string>) => `SUM(${L.revenue}${f}:${L.revenue}${l})-SUM(${L.cost}${f}:${L.cost}${l})` }) }
    );
  }
  const formulas: Record<string, (r: number) => string> = {
    hd: (r: number) => `IF(C${r}>0,B${r}/C${r}*100,"")`,
    ...(seg === "all" && farm ? { profit: (r: number) => `IF(G${r}>0,G${r}-H${r},"")` } : {}),
  };
  const dayRevenue = (d: string) => extras.sales.filter((x) => x.date === d && (seg === "all" || ledgerSegment(ctx, x.grade === "small" ? "small" : "big", d) === seg)).reduce((t, x) => t + (x.amount ?? 0), 0);
  const rows = s.series.map((d) => {
    const fed = rowsOn(ctx, d.date, seg, only).some((r) => r.feed != null);
    const base = { date: d.date, eggs: d.eggs, birddays: d.birds, hd: d.hd, deaths: d.deaths, feed: fed ? d.feedBags : null };
    if (!farm) return base;
    const split = seg === "all";
    const e = split ? dayEconomics(cost, d.date) : null;
    const revenue = split ? e!.revenue : dayRevenue(d.date);
    return { ...base, revenue, cost: e ? e.cost.total : null, profit: e && e.revenue ? e.revenue - e.cost.total : null };
  });
  const eggsFed = s.series.map((d) => {
    const fed = rowsOn(ctx, d.date, seg, only).filter((r) => r.feed != null);
    return fed.length ? fed.reduce((t, r) => t + (r.eggs ?? 0), 0) : null;
  });
  // V19 D3: a day the register missed (up to today) still carries its share of the monthly costs; say how much
  if (farm && seg === "all") {
    const extra = periodEconomics(cost, range.from, range.to, s.series.map((d) => d.date)).filter((e) => e.overheadOnly);
    if (extra.length) notes.push(`${extra.length} day${extra.length === 1 ? "" : "s"} without register rows (${extra.map((e) => e.date).join(", ")}): their share of the monthly costs, ₹${Math.round(extra.reduce((t, e) => t + e.cost.total, 0)).toLocaleString("en-IN")}, is in the period's cost but not in the rows above.`);
  }
  return withEggsPerKg({ name: head.name, title: head.title, columns, rows, notes, formulas }, eggsFed, s.series.map((d) => fcrOf(ctx, rowsOn(ctx, d.date, seg, only))));
}

export async function periodDataset(kind: PeriodKind, p: string, seg: SegFilter = "all"): Promise<Dataset> {
  const { ctx, cost, extras } = await loadAll();
  const anchor = kind === "year" ? `${p}-01-01` : kind === "month" ? `${p}-01` : p;
  const range = rangeOf(kind, anchor);
  const who = seg === "all" ? "Whole farm (sum of the groups)" : SEGMENT_NAME[seg];
  if (kind !== "year") {
    return dayRowsDataset(ctx, cost, extras, range, { segment: seg }, { name: kind === "week" ? "Week summary" : "Month summary", title: `${kind === "week" ? "Week" : "Month"} ${range.label} — day by day — ${who}`, who });
  }
  const s = summarizePeriod(ctx, cost, extras, range, seg);
  const notes = [
    `Group: ${who}.${seg === "all" ? " It mixes mature and young birds; use the Main and Young files for per-group HD %." : " Numerator and denominator are this group's flocks only; cost and profit are not split by group (blank here, see the whole-farm file)."}`,
    `${range.label}: ${s.dataNote}. Averages use only days with data.`,
    HD_NOTE,
    MONEY_NOTE,
  ];
  if (s.money.missing.length) notes.push(`MISSING, not zero: ${s.money.missing.join(", ")}. Cost is understated and profit overstated until these are entered.`);
  const common = [
    { key: "eggs", header: "Eggs", type: "int" as const, width: 11, total: true },
    { key: "birddays", header: "Bird-days", type: "int" as const, width: 11, total: true },
    { key: "hd", header: "HD % (eggs ÷ bird-days)", type: "pct" as const, width: 14, totalFormula: (f: number, l: number, L: Record<string, string>) => `SUM(${L.eggs}${f}:${L.eggs}${l})/SUM(${L.birddays}${f}:${L.birddays}${l})*100` },
    { key: "deaths", header: "Deaths", type: "int" as const, width: 9, total: true },
    { key: "feed", header: "Feed (bags)", type: "int" as const, width: 11, total: true },
    { key: "revenue", header: "Egg revenue ₹", type: "num" as const, width: 14, total: true },
    { key: "cost", header: "Cost so far ₹ (estimate)", type: "num" as const, width: 16, ...(seg === "all" ? { total: true } : {}) },
    { key: "profit", header: "Profit ₹ (estimate)", type: "num" as const, width: 15, ...(seg !== "all" ? {} : { totalFormula: (f: number, l: number, L: Record<string, string>) => `SUM(${L.revenue}${f}:${L.revenue}${l})-SUM(${L.cost}${f}:${L.cost}${l})` }) },
  ];
  const rows = monthsWithin(range).map((m) => summarizePeriod(ctx, cost, extras, m, seg)).filter((m) => m.daysWithData > 0).map((m) => ({
    month: m.range.from,
    days: m.daysWithData,
    eggs: m.eggs.total,
    birddays: ctx.input.prod.filter((r) => r.date >= m.range.from && r.date <= m.range.to && (seg === "all" || segmentOn(ctx, r.flockId, r.date) === seg)).reduce((t, r) => t + (r.pop ?? 0), 0),
    hd: m.eggs.hdPooled,
    deaths: m.birds.deaths,
    feed: m.feed.recorded ? m.feed.bags : null,
    revenue: m.money.revenue,
    cost: m.money.costSplit ? m.money.cost.total : null,
    profit: m.money.costSplit ? m.money.profit : null,
  }));
  // year columns: month, days, then the common ones (letters shift by one)
  const monthEggsFed = rows.map((r) => {
    const m = String(r.month).slice(0, 7);
    const fed = ctx.input.prod.filter((x) => x.date.startsWith(m) && x.feed != null && (seg === "all" || segmentOn(ctx, x.flockId, x.date) === seg));
    return fed.length ? fed.reduce((t, x) => t + (x.eggs ?? 0), 0) : null;
  });
  return withEggsPerKg({
    name: "Year summary",
    title: `Year ${p} — month by month — ${who}`,
    columns: [
      { key: "month", header: "Month (first day)", type: "date", width: 16 },
      { key: "days", header: "Days with data", type: "int", width: 14, total: true },
      ...common.map((c) => ({ ...c })),
    ],
    rows,
    notes,
    formulas: {
      hd: (r) => `IF(D${r}>0,C${r}/D${r}*100,"")`,
      ...(seg === "all" ? { profit: (r: number) => `IF(H${r}>0,H${r}-I${r},"")` } : {}),
    },
  }, monthEggsFed, rows.map((r) => fcrOf(ctx, ctx.input.prod.filter((x) => x.date.startsWith(String(r.month).slice(0, 7)) && (seg === "all" || segmentOn(ctx, x.flockId, x.date) === seg)))));
}

/** V15: the Custom range exactly as the screen shows it (same address: from, to, f). */
export async function rangeDataset(sp: { from?: Param; to?: Param; f?: Param }, seg: SegFilter, today: string): Promise<{ ds: Dataset; stem: string }> {
  const { ctx, cost, extras } = await loadAll();
  const ch = readRange(ctx, sp, today);
  const chosen = ch.flockIds.length > 0;
  const filter: RangeFilter = chosen ? { flocks: ch.flockIds } : { segment: seg };
  const who = chosen ? `Flocks ${ch.flockLabels.join(", ")}` : seg === "all" ? "Whole farm (sum of the groups)" : SEGMENT_NAME[seg];
  const cov = rangeCoverage(ctx, ch.range);
  const ds = dayRowsDataset(ctx, cost, extras, ch.range, filter, { name: "Range summary", title: `${ch.range.label} (${ch.range.days} days) — day by day — ${who}`, who, extraNotes: [...ch.notes, ...(cov.note ? [cov.note] : [])] });
  const stem = `yash-farm-range-${ch.range.from}-to-${ch.range.to}-${chosen ? ch.flockLabels.join("-").replace(/[^A-Za-z0-9-]+/g, "") : seg === "all" ? "whole-farm" : seg}`;
  return { ds, stem };
}

/** V15: the Compare table: one row per measure, A and B as numbers or dates, the difference as a formula (B − A). */
export async function compareDataset(sp: Record<string, Param>, today: string): Promise<{ ds: Dataset; stem: string }> {
  const { ctx, cost, extras } = await loadAll();
  const st = readCompare(ctx, sp, today);
  const A = compareSide(ctx, cost, extras, st.a);
  const B = compareSide(ctx, cost, extras, st.b);
  const tag = (x: typeof A) => `${x.side.flockId ? x.side.flockLabel.replace(/[^A-Za-z0-9-]+/g, "") : "all"}-${x.side.range.from}`;
  return { ds: compareSheet(A, B, st, compareRows(A, B)), stem: `yash-farm-compare-${tag(A)}-vs-${tag(B)}` };
}
