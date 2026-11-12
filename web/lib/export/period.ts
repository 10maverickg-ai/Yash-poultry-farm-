import { buildFarmCtx } from "@/lib/analytics/ctx";
import { loadEngineInput } from "@/lib/analytics/load";
import { loadPeriodExtras } from "@/lib/analytics/periodLoad";
import { loadCostInput } from "@/lib/costs/load";
import { ledgerSegment, rowsOn, segmentOn, type Ctx } from "@/lib/analytics/engine";
import { monthsWithin, rangeCoverage, rangeOf, summarizeRange, summarizePeriod, type PeriodExtras, type PeriodKind, type PeriodRange, type RangeFilter } from "@/lib/analytics/period";
import { readRange, type Param } from "@/lib/analytics/rangeParams";
import { compareRows, compareSide, readCompare, type CompareRow } from "@/lib/analytics/compare";
import { SEGMENT_NAME, type SegFilter } from "@/lib/analytics/engine";
import { dayEconomics, type CostInput } from "@/lib/costs/engine";
import type { Dataset } from "./types";

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

const HD_NOTE = "HD % = eggs ÷ bird-days × 100. The totals row pools it (total eggs ÷ total bird-days); it is not an average of daily percentages.";
const MONEY_NOTE = "Revenue = priced egg sales only. Cost and profit are ESTIMATES (feed exact; electricity, labour and packing spread; diesel and medicines on the day bought).";

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
  return { name: head.name, title: head.title, columns, rows, notes, formulas };
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
  return {
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
  };
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
  const rows = compareRows(A, B);
  const numeric = (r: CompareRow) => typeof r.a === "number" && typeof r.b === "number" && r.fmt !== "date" && r.fmt !== "text";
  const name = (x: typeof A) => `${x.side.key.toUpperCase()}: ${x.side.flockLabel}, ${x.side.range.label}`;
  const unit = (r: CompareRow) => (r.fmt === "pct1" || r.fmt === "pct2" ? "%" : r.fmt === "inr" || r.fmt === "inr2" ? "₹" : r.fmt === "age" ? "days" : "");
  const first = 4;
  const ds: Dataset = {
    name: "Compare",
    title: `Compare — ${name(A)} against ${name(B)}${st.age && st.weeks ? ` (weeks ${st.weeks.from}–${st.weeks.to} of age)` : ""}`,
    columns: [
      { key: "group", header: "Group", type: "text", width: 16 },
      { key: "measure", header: "Measure", type: "text", width: 40 },
      { key: "a", header: name(A), type: "auto", width: 22 },
      { key: "b", header: name(B), type: "auto", width: 22 },
      { key: "diff", header: "Difference (B − A)", type: "num", width: 16 },
      { key: "diffPct", header: "Difference % of A", type: "num", width: 14 },
      { key: "unit", header: "Unit", type: "text", width: 7 },
      { key: "verdict", header: "B is", type: "text", width: 14 },
      { key: "why", header: "Why blank / note", type: "text", width: 50 },
    ],
    rows: rows.map((r) => ({
      group: r.group,
      measure: r.label,
      a: r.a,
      b: r.b,
      diff: r.diff,
      diffPct: r.diffPct,
      unit: unit(r),
      verdict: r.diff == null ? "" : Math.abs(r.diff) < 1e-9 ? "the same" : r.good == null ? (r.diff > 0 ? "higher" : "lower") : r.good ? "better" : "worse",
      why: [r.aNote ? `A: ${r.aNote}` : "", r.bNote ? `B: ${r.bNote}` : "", r.note ?? ""].filter(Boolean).join(" "),
    })),
    notes: [
      `${name(A)}: ${A.s.dataNote}.${A.coverageNote ? ` ${A.coverageNote}` : ""}`,
      `${name(B)}: ${B.s.dataNote}.${B.coverageNote ? ` ${B.coverageNote}` : ""}`,
      ...st.notes,
      ...st.a.notes.map((x) => `A: ${x}`),
      ...st.b.notes.map((x) => `B: ${x}`),
      "Each column is worked out on its own (its own flock and dates). Difference = B − A, written as a formula; % = difference ÷ A.",
      HD_NOTE.replace(" The totals row pools it (total eggs ÷ total bird-days);", ";"),
      "One flock: its own birds and eggs only. Sales, costs, profit and the egg-ledger breakage are farm-level, not split by flock (blank). Profit is an estimate; missing costs are missing, not zero.",
    ],
    formulas: {
      diff: (row) => (numeric(rows[row - first]) ? `IF(AND(ISNUMBER(C${row}),ISNUMBER(D${row})),D${row}-C${row},"")` : null),
      diffPct: (row) => (numeric(rows[row - first]) ? `IF(AND(ISNUMBER(C${row}),ISNUMBER(D${row}),C${row}<>0),(D${row}-C${row})/ABS(C${row})*100,"")` : null),
    },
  };
  const tag = (x: typeof A) => `${x.side.flockId ? x.side.flockLabel.replace(/[^A-Za-z0-9-]+/g, "") : "all"}-${x.side.range.from}`;
  return { ds, stem: `yash-farm-compare-${tag(A)}-vs-${tag(B)}` };
}
