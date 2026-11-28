import { recipientLabel } from "@/lib/sales/recipients";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { compareLabels } from "@/lib/naturalSort";
import { loadCostInput } from "@/lib/costs/load";
import { BAG_KG, monthEconomics, periodEconomics } from "@/lib/costs/engine";
import { partialMonthWords } from "@/lib/costs/costWords";
import { loadEngineInput } from "@/lib/analytics/load";
import { buildCtx } from "@/lib/analytics/engine";
import { hensHoused, housedOn } from "@/lib/analytics/henHoused";
import { fcrOf } from "@/lib/analytics/fcr";
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
    `SELECT dp.date, dp.flock_internal_id AS fid, f.display_label AS flock, f.segment, dp.display_label_as_written AS reg, dp.bird_population AS birds,
            dp.mortality, dp.feed_bags, dp.eggs_total
       FROM daily_production dp JOIN flocks f USING (flock_internal_id)
      WHERE dp.farm_code = $1 AND dp.deleted_at IS NULL AND dp.date BETWEEN $2 AND $3
      ORDER BY dp.date`,
    [ACTIVE_FARM, from, to]
  );
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : compareLabels(a.flock, b.flock)));
  // V17: hens housed per flock-day (the breeder's definition; birds moved in or out counted, deaths, culls and sales not)
  const ctx = buildCtx(await loadEngineInput());
  const housed = new Map<string, ReturnType<typeof hensHoused>>();
  const housedFor = (fid: string, d: string) => {
    if (!housed.has(fid)) housed.set(fid, hensHoused(ctx, fid));
    const h = housed.get(fid);
    return h && d >= h.date ? { n: housedOn(ctx, h, d), standin: h.source === "standin" } : null;
  };
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
      // V17: eggs per kg of feed for the row; the totals row pools only the rows that have a feed figure
      { key: "eggsPerKg", header: `Eggs per kg feed (bags × ${BAG_KG} kg)`, type: "num", width: 16, totalFormula: (f, l) => `IF(SUM(G${f}:G${l})>0,SUMIFS(H${f}:H${l},G${f}:G${l},"<>")/(SUM(G${f}:G${l})*${BAG_KG}),"")` },
      { key: "housed", header: "Hens housed (that day)", type: "int", width: 14 },
      { key: "hh", header: "Hen-housed % (eggs ÷ hens housed)", type: "pct", width: 18, totalFormula: (f, l) => `IF(SUM(K${f}:K${l})>0,SUMIFS(H${f}:H${l},K${f}:K${l},"<>")/SUM(K${f}:K${l})*100,"")` },
      { key: "housedFrom", header: "Hens housed from", type: "text", width: 22 },
      // V18 B5: feed per egg (exact) and the FCR (estimated from the standard egg weight); the totals row pools both
      { key: "gPerEgg", header: "Feed g per egg (exact)", type: "num", width: 12, totalFormula: (f, l) => `IF(SUMIFS(H${f}:H${l},G${f}:G${l},"<>")>0,SUM(G${f}:G${l})*${BAG_KG}*1000/SUMIFS(H${f}:H${l},G${f}:G${l},"<>"),"")` },
      { key: "eggKg", header: "Egg kg (eggs × standard egg weight)", type: "num", width: 14, total: true },
      { key: "fcr", header: "FCR (estimated from standard egg weight)", type: "num", width: 14, totalFormula: (f, l) => `IF(SUM(O${f}:O${l})>0,SUMIFS(G${f}:G${l},O${f}:O${l},"<>")*${BAG_KG}/SUM(O${f}:O${l}),"")` },
      { key: "fcrStd", header: "Breeder's FCR (BV300, that week)", type: "num", width: 13 },
    ],
    rows: rows.map((r) => ({
      date: String(r.date).slice(0, 10), flock: r.flock, segment: r.segment === "main" ? "Main" : r.segment === "young" ? "Young" : "not set", reg: r.reg, birds: r.birds, mortality: r.mortality, feed: r.feed_bags, eggs: r.eggs_total,
      hd: r.birds ? Math.round(((r.eggs_total ?? 0) / r.birds) * 10000) / 100 : null,
      eggsPerKg: r.feed_bags != null && r.feed_bags > 0 ? Math.round(((r.eggs_total ?? 0) / (r.feed_bags * BAG_KG)) * 100) / 100 : null,
      ...(() => {
        const h = housedFor(r.fid, String(r.date).slice(0, 10));
        return { housed: h?.n ?? null, hh: h && h.n > 0 ? Math.round(((r.eggs_total ?? 0) / h.n) * 10000) / 100 : null, housedFrom: h ? (h.standin ? "stand-in: birds on 2 Jul 2026" : "register / owner") : "" };
      })(),
      ...(() => {
        const x = fcrOf(ctx, [{ date: String(r.date).slice(0, 10), flockId: r.fid, eggs: r.eggs_total, feed: r.feed_bags }]);
        return { gPerEgg: x.feedPerEggG, eggKg: x.eggKg > 0 ? x.eggKg : null, fcr: x.fcr, fcrStd: x.standardFcr };
      })(),
    })),
    notes: ["HD % is calculated as eggs ÷ birds × 100 (not the supervisor's written %).", "Group = Main (big eggs, right page) or Young (small eggs, left page). The totals row adds every flock; filter the Group column for per-group numbers.", "Birds are the end-of-day count from the register.", `Eggs per kg feed = eggs ÷ (feed bags × ${BAG_KG} kg) for that flock and day; empty when the register has no feed figure (feed not recorded). The totals row pools the rows with feed: their eggs ÷ their feed, never an average of the rows.`, "Hen-housed % = eggs ÷ hens housed × 100 (the breeder's definition): hens housed are counted on the flock's first day in the register (BAB-9, 10, 11) or given by the owner; for flocks already laying when the app's data starts, the birds on 2 Jul 2026 are a stand-in. Birds moved in or out change the number from that day; deaths, culls and sales do not.", "Feed g per egg = feed kg × 1000 ÷ eggs (exact). FCR = feed kg ÷ egg kg, ESTIMATED: egg kg = eggs × the BV300 standard egg weight for the flock's age (unless a real weighing is stored); empty when there is no feed figure or no egg-weight reference (another breed, or past week 100 of the breeder's table). The totals row pools both (all feed ÷ all eggs or egg kg of the rows with feed)."],
    formulas: { hd: (row) => `IF(E${row}>0,ROUND(H${row}/E${row}*100,2),"")`, eggsPerKg: (row) => `IF(AND(ISNUMBER(G${row}),G${row}>0),ROUND(H${row}/(G${row}*${BAG_KG}),2),"")`, hh: (row) => `IF(AND(ISNUMBER(K${row}),K${row}>0),ROUND(H${row}/K${row}*100,2),"")`, gPerEgg: (row) => `IF(AND(ISNUMBER(G${row}),G${row}>0,H${row}>0),G${row}*${BAG_KG}*1000/H${row},"")`, fcr: (row) => `IF(AND(ISNUMBER(G${row}),ISNUMBER(O${row}),O${row}>0),G${row}*${BAG_KG}/O${row},"")` },
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
    `SELECT date, buyer_or_recipient AS buyer, grade, CASE transaction_type::text WHEN 'sale_farmfresh' THEN 'Farmfresh' WHEN 'other' THEN 'Local' WHEN 'local' THEN 'Local' ELSE transaction_type::text END AS type, eggs_quantity AS eggs, price_per_unit AS price, amount, recipient
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
      { key: "recipient", header: "Who got the eggs", type: "text", width: 26 },
    ],
    rows: rows.map((r) => ({ date: String(r.date).slice(0, 10), buyer: r.buyer, grade: r.grade, type: r.type, eggs: r.eggs, price: r.price != null ? Number(r.price) : null, amount: r.amount != null ? Number(r.amount) : null, recipient: recipientLabel(r.recipient) })),
    notes: ["Farmfresh (big or small) is paid the BAFTA rate − ₹0.03 per egg; local sales the rate + ₹0.01.", "A row with no price had no BAFTA rate entered for its day."],
    formulas: { amount: (row) => `IF(F${row}="","",ROUND(E${row}*F${row},2))` },
  };
}

export async function costsDataset(month: string): Promise<Dataset> {
  const input = await loadCostInput();
  const dates = [...new Set(input.prod.filter((p) => p.date.startsWith(month)).map((p) => p.date))].sort();
  const m = monthEconomics(input, month);
  const miss = (what: string) => m.missing.some((x) => x.startsWith(what));
  // V19 D3: every day whose costs are counted: days with rows, plus the other days so far (their share of the monthly costs)
  const dim = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const rows = periodEconomics(input, `${month}-01`, `${month}-${String(dim).padStart(2, "0")}`, dates).map((e) => {
    const r = (x: number) => Math.round(x * 100) / 100;
    return {
      date: e.date, produced: e.overheadOnly ? null : e.eggsProduced, sold: e.overheadOnly ? null : e.eggsSold, revenue: r(e.revenue), feed: r(e.cost.feed),
      electricity: e.sources.electricity.source === "missing" ? null : r(e.cost.electricity), labour: r(e.cost.labour), packing: r(e.cost.packing),
      diesel: e.sources.diesel.source === "missing" ? null : r(e.cost.diesel), miscellaneous: e.sources.miscellaneous.source === "average" ? r(e.cost.miscellaneous) : null,
      medicine: e.sources.medicine.source === "in_feed" && e.cost.medicine === 0 ? null : miss("medicines") && e.sources.medicine.source === "missing" ? null : r(e.cost.medicine),
      other: miss("other costs") ? null : r(e.cost.other), chicks: r(e.cost.chicks),
      extras: e.sources.topDressing.source === "entered" || e.sources.interest.source === "entered" || e.sources.rent.source === "entered" ? r(e.cost.topDressing + e.cost.interest + e.cost.rent) : null,
      total: r(e.cost.total), profit: r(e.profit),
      note: [e.overheadOnly ? "no register rows: monthly costs only" : "", e.sources.electricity.source === "average" ? "electricity average" : "", e.sources.diesel.source === "average" ? "diesel average" : "", e.sources.miscellaneous.source === "average" ? "miscellaneous average" : "", e.sources.medicine.source === "in_feed" ? "medicines included in feed price" : ""].filter(Boolean).join("; ") || null,
    };
  });
  const notes = [
    `ALL COST AND PROFIT FIGURES ARE ESTIMATES. Feed is exact: each shed's bags × ${BAG_KG} kg × its own price per kg that day (from 28 Nov 2026 the nutritionist's formula for the shed; before that, and for a shed without a formula, the farm default).`,
    "Labour and electricity are the month's amount spread evenly over its days (a month without a bill uses the electricity average ₹40,000 from Nov 2026). Diesel entered counts on the day bought; a month without any diesel entry uses the diesel average ₹10,000. Miscellaneous (vaccines, repairs, transport, vet, anything else) is the average ₹30,000 a month. Each average is marked in the Note column. Packing is ₹ per tray sold (big and small eggs). Medicines and vaccines are inside the feed price from 28 Nov 2026. Interest, rent and top dressing: not entered.",
    "Revenue is eggs SOLD that day at the saved sale prices, not eggs laid. Bird sales are not included. Chick purchase = chicks that arrived × the average price per chick (a setting, about ₹52), counted on the arrival day, i.e. in the month of arrival — it is NOT spread over the laying months.",
  ];
  if (m.missing.length) notes.push(`NOT ENTERED (blank above where it is a whole column; the cost total is 'so far', understated, and the profit overstated): ${m.missing.join(", ")}.`);
  if (m.costDays < m.daysInMonth) notes.push(`TO DATE, not the full month: ${m.days} days have register rows. ${partialMonthWords(m.sources, input.today ?? null).join(" ")}`);
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
      { key: "miscellaneous", header: "Miscellaneous ₹ (average)", type: "num", width: 14, total: true },
      { key: "medicine", header: "Medicines ₹", type: "num", width: 12, total: true },
      { key: "other", header: "Other ₹", type: "num", width: 11, total: true },
      { key: "chicks", header: "Chick purchase ₹ (avg 52)", type: "num", width: 16, total: true },
      { key: "extras", header: "Top dressing, interest, rent ₹ (empty = not entered)", type: "num", width: 16, total: true },
      { key: "total", header: "Total cost ₹", type: "num", width: 13, total: true },
      { key: "profit", header: "Estimated profit ₹", type: "num", width: 16, total: true },
      { key: "note", header: "Note (averages, no register rows)", type: "text", width: 50 },
    ],
    rows,
    notes,
    // columns: D revenue, E feed … M chicks, N top dressing/interest/rent, O total, P profit
    formulas: { total: (row) => `SUM(E${row}:N${row})`, profit: (row) => `D${row}-O${row}` },
  };
}

export const DATASETS = {
  production: productionDataset,
  ledger: ledgerDataset,
  sales: salesDataset,
  costs: costsDataset,
} as const;
export type DatasetKind = keyof typeof DATASETS;
