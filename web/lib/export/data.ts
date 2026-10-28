import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { compareLabels } from "@/lib/naturalSort";
import { loadCostInput } from "@/lib/costs/load";
import { dayEconomics, monthEconomics } from "@/lib/costs/engine";
import type { Dataset } from "./types";

// Read-only datasets for the Excel / CSV export. Same sources the screens use;
// soft-deleted rows are excluded; flocks are shown by REAL name with the
// register label beside them.
const bounds = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
};
export const validMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

export async function productionDataset(month: string): Promise<Dataset> {
  const { from, to } = bounds(month);
  const { rows } = await pool.query(
    `SELECT dp.date, f.display_label AS flock, f.segment, dp.display_label_as_written AS reg, dp.bird_population AS birds,
            dp.mortality, dp.feed_bags, dp.eggs_total
       FROM daily_production dp JOIN flocks f USING (flock_internal_id)
      WHERE dp.farm_code = $1 AND dp.deleted_at IS NULL AND dp.date BETWEEN $2 AND $3
      ORDER BY dp.date`,
    [ACTIVE_FARM, from, to]
  );
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : compareLabels(a.flock, b.flock)));
  return {
    name: "Daily production",
    title: `Daily production ${month}`,
    columns: [
      { key: "date", header: "Date", type: "date", width: 12 },
      { key: "flock", header: "Flock", type: "text", width: 10 },
      { key: "segment", header: "Group", type: "text", width: 10 },
      { key: "reg", header: "Register label", type: "text", width: 14 },
      { key: "birds", header: "Birds (end of day)", type: "int", width: 16 },
      { key: "mortality", header: "Deaths", type: "int", width: 9, total: true },
      { key: "feed", header: "Feed (bags)", type: "int", width: 12, total: true },
      { key: "eggs", header: "Eggs", type: "int", width: 10, total: true },
      { key: "hd", header: "HD % (eggs ÷ birds)", type: "pct", width: 18 },
    ],
    rows: rows.map((r) => ({
      date: String(r.date).slice(0, 10), flock: r.flock, segment: r.segment === "main" ? "Main" : r.segment === "young" ? "Young" : "not set", reg: r.reg, birds: r.birds, mortality: r.mortality, feed: r.feed_bags, eggs: r.eggs_total,
      hd: r.birds ? Math.round(((r.eggs_total ?? 0) / r.birds) * 10000) / 100 : null,
    })),
    notes: ["HD % is calculated as eggs ÷ birds × 100 (not the supervisor's written %).", "Group = Main (big eggs, right page) or Young (small eggs, left page). The totals row adds every flock; filter the Group column for per-group numbers.", "Birds are the end-of-day count from the register."],
    formulas: { hd: (row) => `IF(E${row}>0,ROUND(H${row}/E${row}*100,2),"")` },
  };
}

export async function ledgerDataset(month: string): Promise<Dataset> {
  const { from, to } = bounds(month);
  const { rows } = await pool.query(
    `SELECT s.date, s.section, s.opening_balance_eggs AS opening, s.total_eggs_produced AS produced, s.closing_balance_eggs AS closing,
            coalesce(sum(-e.amount_eggs) FILTER (WHERE e.category IN ('sale','local_sale')), 0)::int AS sales,
            coalesce(sum(-e.amount_eggs) FILTER (WHERE e.category = 'breakage'), 0)::int AS breakage,
            coalesce(sum(e.amount_eggs) FILTER (WHERE e.category = 'production_addition'), 0)::int AS additions,
            coalesce(sum(-e.amount_eggs) FILTER (WHERE e.category NOT IN ('sale','local_sale','breakage','production_addition') OR e.category IS NULL), 0)::int AS other
       FROM daily_egg_stock_summary s LEFT JOIN daily_egg_stock_entries e ON e.egg_stock_summary_id = s.id
      WHERE s.farm_code = $1 AND s.deleted_at IS NULL AND s.date BETWEEN $2 AND $3
      GROUP BY s.id ORDER BY s.date, s.section`,
    [ACTIVE_FARM, from, to]
  );
  return {
    name: "Egg ledger",
    title: `Egg ledger ${month}`,
    columns: [
      { key: "date", header: "Date", type: "date", width: 12 },
      { key: "section", header: "Ledger", type: "text", width: 8 },
      { key: "opening", header: "Opening", type: "int", width: 11 },
      { key: "produced", header: "Produced", type: "int", width: 11, total: true },
      { key: "additions", header: "Late additions", type: "int", width: 12, total: true },
      { key: "sales", header: "Sales", type: "int", width: 11, total: true },
      { key: "breakage", header: "Breakage", type: "int", width: 11, total: true },
      { key: "other", header: "Other (net)", type: "int", width: 11, total: true },
      { key: "closing", header: "Closing", type: "int", width: 11 },
      { key: "check", header: "Closing check (0 = ties)", type: "int", width: 14 },
    ],
    rows: rows.map((r) => ({ date: String(r.date).slice(0, 10), section: r.section, opening: r.opening, produced: r.produced, additions: r.additions, sales: r.sales, breakage: r.breakage, other: r.other, closing: r.closing })),
    formulas: { check: (row) => `IF(OR(C${row}="",I${row}=""),"",I${row}-(C${row}+IF(AND(E${row}>0,E${row}=D${row}),0,D${row})+E${row}-F${row}-G${row}-H${row}))` },
    notes: [
      "All figures are eggs. Sales = Farmfresh + local sale lines; Late additions = eggs added to the ledger after the day's total (production_addition lines, e.g. 8 Oct big +60, 21 Oct small +600); Other = labour take, gifts, cross-farm and unlabelled lines (net, deductions positive).",
      "From 5 to 30 Sep the small ledger wrote the day's production as addition lines, so Produced repeats Late additions; the check ignores Produced on those days. A non-zero check means the register's closing differs from the arithmetic (a correction or a mis-read) — it is shown, not hidden.",
    ],
  };
}

export async function salesDataset(month: string): Promise<Dataset> {
  const { from, to } = bounds(month);
  const { rows } = await pool.query(
    `SELECT date, buyer_or_recipient AS buyer, grade, transaction_type::text AS type, eggs_quantity AS eggs, price_per_unit AS price, amount
       FROM sales WHERE farm_code = $1 AND date BETWEEN $2 AND $3 ORDER BY date, id`,
    [ACTIVE_FARM, from, to]
  );
  return {
    name: "Sales",
    title: `Egg sales ${month}`,
    columns: [
      { key: "date", header: "Date", type: "date", width: 12 },
      { key: "buyer", header: "Buyer", type: "text", width: 14 },
      { key: "grade", header: "Grade", type: "text", width: 8 },
      { key: "type", header: "Type", type: "text", width: 14 },
      { key: "eggs", header: "Eggs", type: "int", width: 11, total: true },
      { key: "price", header: "Price per egg (₹)", type: "num", width: 16 },
      { key: "amount", header: "Amount (₹)", type: "num", width: 14, total: true },
    ],
    rows: rows.map((r) => ({ date: String(r.date).slice(0, 10), buyer: r.buyer, grade: r.grade, type: r.type, eggs: r.eggs, price: r.price != null ? Number(r.price) : null, amount: r.amount != null ? Number(r.amount) : null })),
    notes: ["Farmfresh (big or small) is paid the BAFTA rate − ₹0.03 per egg; local sales the rate + ₹0.01.", "A row with no price had no BAFTA rate entered for its day."],
    formulas: { amount: (row) => `IF(F${row}="","",ROUND(E${row}*F${row},2))` },
  };
}

export async function costsDataset(month: string): Promise<Dataset> {
  const input = await loadCostInput();
  const dates = [...new Set(input.prod.filter((p) => p.date.startsWith(month)).map((p) => p.date))].sort();
  const m = monthEconomics(input, month);
  const miss = (what: string) => m.missing.some((x) => x.startsWith(what));
  const rows = dates.map((d) => {
    const e = dayEconomics(input, d);
    const r = (x: number) => Math.round(x * 100) / 100;
    return {
      date: d, produced: e.eggsProduced, sold: e.eggsSold, revenue: r(e.revenue), feed: r(e.cost.feed), electricity: r(e.cost.electricity), labour: r(e.cost.labour),
      packing: r(e.cost.packing), diesel: miss("diesel") ? null : r(e.cost.diesel), medicine: miss("medicines") ? null : r(e.cost.medicine), other: miss("other costs") ? null : r(e.cost.other), chicks: r(e.cost.chicks), total: r(e.cost.total), profit: r(e.profit),
    };
  });
  const notes = [
    "ALL COST AND PROFIT FIGURES ARE ESTIMATES. Feed is exact (bags × 45 kg × price per kg). Electricity and labour are the month's amount spread evenly over its days; packing is per tray sold; diesel and medicines count on the day bought.",
    "Revenue is eggs SOLD that day at the saved sale prices, not eggs laid. Bird sales are not included. Chick purchase = chicks that arrived × the average price per chick (a setting, about ₹52), counted on the arrival day, i.e. in the month of arrival — it is NOT spread over the laying months.",
  ];
  if (m.missing.length) notes.push(`NOT ENTERED (blank above where it is a whole column; the cost total is 'so far', understated, and the profit overstated): ${m.missing.join(", ")}.`);
  if (m.days < new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()) notes.push(`TO DATE, not the full month: ${m.days} days have data; monthly bills (electricity, labour) are counted for those days only.`);
  if (m.unpricedEggsSold > 0) notes.push(`${m.unpricedEggsSold} eggs were sold without a BAFTA rate, so revenue is incomplete.`);
  return {
    name: "Costs and profit",
    title: `Costs and profit ${month} (estimate)`,
    columns: [
      { key: "date", header: "Date", type: "date", width: 12 },
      { key: "produced", header: "Eggs laid", type: "int", width: 11, total: true },
      { key: "sold", header: "Eggs sold", type: "int", width: 11, total: true },
      { key: "revenue", header: "Egg revenue ₹", type: "num", width: 14, total: true },
      { key: "feed", header: "Feed ₹", type: "num", width: 12, total: true },
      { key: "electricity", header: "Electricity ₹", type: "num", width: 13, total: true },
      { key: "labour", header: "Labour ₹", type: "num", width: 12, total: true },
      { key: "packing", header: "Packing ₹", type: "num", width: 12, total: true },
      { key: "diesel", header: "Diesel ₹", type: "num", width: 11, total: true },
      { key: "medicine", header: "Medicines ₹", type: "num", width: 12, total: true },
      { key: "other", header: "Other ₹", type: "num", width: 11, total: true },
      { key: "chicks", header: "Chick purchase ₹ (avg 52)", type: "num", width: 16, total: true },
      { key: "total", header: "Total cost ₹", type: "num", width: 13, total: true },
      { key: "profit", header: "Estimated profit ₹", type: "num", width: 16, total: true },
    ],
    rows,
    notes,
    formulas: { total: (row) => `SUM(E${row}:L${row})`, profit: (row) => `D${row}-M${row}` },
  };
}

export const DATASETS = {
  production: productionDataset,
  ledger: ledgerDataset,
  sales: salesDataset,
  costs: costsDataset,
} as const;
export type DatasetKind = keyof typeof DATASETS;
