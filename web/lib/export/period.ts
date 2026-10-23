import { loadEngineInput } from "@/lib/analytics/load";
import { loadPeriodExtras } from "@/lib/analytics/periodLoad";
import { loadCostInput } from "@/lib/costs/load";
import { buildCtx } from "@/lib/analytics/engine";
import { monthsWithin, rangeOf, summarizePeriod, type PeriodKind } from "@/lib/analytics/period";
import { dayEconomics } from "@/lib/costs/engine";
import type { Dataset } from "./types";

// Read-only week / month / year summaries for Excel. A week or month is one row
// per day; a year is one row per month. HD% is a formula (eggs ÷ bird-days) and
// the totals row pools it (sum of eggs ÷ sum of bird-days), never an average of percentages.
export function validPeriod(kind: string, p: string): boolean {
  if (kind === "year") return /^\d{4}$/.test(p);
  if (kind === "month") return /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
  return /^\d{4}-\d{2}-\d{2}$/.test(p) && !Number.isNaN(Date.parse(p));
}

export async function periodDataset(kind: PeriodKind, p: string): Promise<Dataset> {
  const [input, cost, extras] = await Promise.all([loadEngineInput(), loadCostInput(), loadPeriodExtras()]);
  const ctx = buildCtx(input);
  const anchor = kind === "year" ? `${p}-01-01` : kind === "month" ? `${p}-01` : p;
  const range = rangeOf(kind, anchor);
  const s = summarizePeriod(ctx, cost, extras, range);
  const notes = [
    `${range.label}: ${s.dataNote}. Averages use only days with data.`,
    "HD % = eggs ÷ bird-days × 100. The totals row pools it (total eggs ÷ total bird-days); it is not an average of daily percentages.",
    "Revenue = priced egg sales only. Cost and profit are ESTIMATES (feed exact; electricity, labour and packing spread; diesel and medicines on the day bought).",
  ];
  if (s.money.missing.length) notes.push(`MISSING, not zero: ${s.money.missing.join(", ")}. Cost is understated and profit overstated until these are entered.`);
  const common = [
    { key: "eggs", header: "Eggs", type: "int" as const, width: 11, total: true },
    { key: "birddays", header: "Bird-days", type: "int" as const, width: 11, total: true },
    { key: "hd", header: "HD % (eggs ÷ bird-days)", type: "pct" as const, width: 14, totalFormula: (f: number, l: number, L: Record<string, string>) => `SUM(${L.eggs}${f}:${L.eggs}${l})/SUM(${L.birddays}${f}:${L.birddays}${l})*100` },
    { key: "deaths", header: "Deaths", type: "int" as const, width: 9, total: true },
    { key: "feed", header: "Feed (bags)", type: "int" as const, width: 11, total: true },
    { key: "revenue", header: "Egg revenue ₹", type: "num" as const, width: 14, total: true },
    { key: "cost", header: "Cost so far ₹ (estimate)", type: "num" as const, width: 16, total: true },
    { key: "profit", header: "Profit ₹ (estimate)", type: "num" as const, width: 15, totalFormula: (f: number, l: number, L: Record<string, string>) => `SUM(${L.revenue}${f}:${L.revenue}${l})-SUM(${L.cost}${f}:${L.cost}${l})` },
  ];
  const formulas = {
    hd: (r: number) => `IF(C${r}>0,B${r}/C${r}*100,"")`,
    profit: (r: number) => `IF(G${r}>0,G${r}-H${r},"")`,
  };
  if (kind === "year") {
    const rows = monthsWithin(range).map((m) => summarizePeriod(ctx, cost, extras, m)).filter((m) => m.daysWithData > 0).map((m) => ({
      month: m.range.from,
      days: m.daysWithData,
      eggs: m.eggs.total,
      birddays: ctx.input.prod.filter((r) => r.date >= m.range.from && r.date <= m.range.to).reduce((t, r) => t + (r.pop ?? 0), 0),
      hd: m.eggs.hdPooled,
      deaths: m.birds.deaths,
      feed: m.feed.bags,
      revenue: m.money.revenue,
      cost: m.money.cost.total,
      profit: m.money.profit,
    }));
    // year columns: month, days, then the common ones (letters shift by one)
    return {
      name: "Year summary",
      title: `Year ${p} — month by month`,
      columns: [
        { key: "month", header: "Month (first day)", type: "date", width: 16 },
        { key: "days", header: "Days with data", type: "int", width: 14, total: true },
        ...common.map((c) => ({ ...c })),
      ],
      rows,
      notes,
      formulas: {
        hd: (r) => `IF(D${r}>0,C${r}/D${r}*100,"")`,
        profit: (r) => `IF(H${r}>0,H${r}-I${r},"")`,
      },
    };
  }
  const rows = s.series.map((d) => {
    const e = dayEconomics(cost, d.date);
    return { date: d.date, eggs: d.eggs, birddays: d.birds, hd: d.hd, deaths: d.deaths, feed: d.feedBags, revenue: e.revenue, cost: e.cost.total, profit: e.revenue ? e.revenue - e.cost.total : null };
  });
  return {
    name: kind === "week" ? "Week summary" : "Month summary",
    title: `${kind === "week" ? "Week" : "Month"} ${range.label} — day by day`,
    columns: [{ key: "date", header: "Date", type: "date", width: 13 }, ...common.map((c) => ({ ...c }))],
    rows,
    notes,
    formulas,
  };
}
