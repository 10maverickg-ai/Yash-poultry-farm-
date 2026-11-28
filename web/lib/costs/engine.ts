// Daily and monthly cost + profit. Pure functions (no DB) so they can be
// tested on exported real rows. EVERYTHING here is an estimate and the pages
// say so:
//   feed         each flock's bags x BAG_KG x that flock's feed price per kg that day (exact bag counts; V19: the
//                nutritionist's formula for its shed from the formula's date, else the farm default; see feedPrice.ts).
//                The farm's feed cost is the sum over flocks, never all bags x one price.
//   electricity  the month's bill spread evenly over the days of the month
//   labour       the month's amount spread evenly over the days of the month
//   packing      INR per tray x trays sold that day (eggs sold / 30)
//   diesel, medicines/vaccines, other purchases
//                counted on the day they were bought (cash basis), not spread
//   V19 D (owner, 28 Nov 2026): averages where there is no real figure, each shown as "average", never silently:
//     electricity  a month without a bill uses electricity_month_default (₹40,000 from Nov 2026), spread like a bill
//     diesel       a month without any diesel entry uses diesel_month_default (₹10,000 from Aug 2026), spread
//     miscellaneous miscellaneous_month_default (₹30,000 from Aug 2026): vaccines, repairs, transport, vet, anything else
//     medicines    from medicine_vaccine_in_feed's date (28 Nov 2026) they are inside the feed price: "included in feed
//                  price", no separate cost and not missing (a medicine bought and entered separately is still counted)
//     top dressing / interest / rent: counted when entered (cost_settings top_dressing / interest_month / rent_month,
//                  per month), otherwise "not entered"
//   A month still running counts its monthly amounts for the days so far: each calendar day up to today carries
//   1/(days in the month) of them, also a day without a register row (periodCostDays).
//   chick purchases are shown separately (growing cost, not a daily cost)
// A monthly figure that has not been entered is reported as MISSING and counted
// as 0, never guessed.

export interface CostSetting {
  type: string; // feed_per_kg, labour_month, packing_per_tray, electricity_month
  value: number;
  effectiveFrom: string;
  month: string | null; // 'YYYY-MM' for entries that belong to one month
}
import { feedPriceFor, type FeedPrice, type Formulation } from "./feedPrice";

export interface Purchase {
  date: string;
  category: string; // feed_ingredient, chicks, packing, electricity, labour, medicine, vaccine, diesel, other
  amount: number;
}
export interface DayProd {
  date: string;
  flockId: string;
  eggs: number;
  feedBags: number;
  birds: number;
}
export interface SaleRow {
  date: string;
  eggs: number;
  amount: number | null; // null = unpriced
}
export interface BirdSaleRow {
  date: string;
  amount: number | null;
}
export interface ChickBatch {
  arrival: string; // YYYY-MM-DD the chicks arrived
  count: number; // chicks that stayed on THIS farm (starting count minus those that went to Anil farm)
}
export interface CostInput {
  settings: CostSetting[];
  purchases: Purchase[];
  diesel: { date: string; amount: number }[];
  prod: DayProd[];
  sales: SaleRow[];
  birdSales: BirdSaleRow[];
  chickBatches?: ChickBatch[];
  /** monthly_input_status rows: the owner said "none this month" / "this figure is right" */
  statuses?: { month: string; key: string; status: string }[];
  /** V19: the nutritionist's feed formulas (feed_formulations + ingredients + sheds); none = the farm default for every flock */
  formulations?: Formulation[];
  /** V19: flock id -> its real name ("BAB-1"), which the formulas' shed lists use */
  flockLabels?: Record<string, string>;
  /** V19 D3: today (IST). A period's monthly costs run to today; without it, to the last day with rows. */
  today?: string;
}

/** The weight of one feed bag in kg: the ONE place the app sets it (g/bird, eggs per kg, FCR and feed cost all use it). */
export const BAG_KG = 45;
/** The average price of a chick is a setting (cost_settings.chick_cost_per_chick), never a guess. */
export const CHICK_COST_TYPE = "chick_cost_per_chick";
/** V19 D: the owner's monthly averages and switches (cost_settings.cost_type). */
export const COST_TYPES = {
  electricityDefault: "electricity_month_default",
  dieselDefault: "diesel_month_default",
  miscDefault: "miscellaneous_month_default",
  medicineInFeed: "medicine_vaccine_in_feed",
  topDressing: "top_dressing",
  interest: "interest_month",
  rent: "rent_month",
} as const;

/** Where a cost line's number came from (shown next to it on screen). */
export type CostSource = "bill" | "average" | "entered" | "none" | "missing" | "in_feed" | "not_entered";
export interface DaySources {
  electricity: { source: "bill" | "average" | "missing"; monthly: number | null };
  labour: { source: "entered" | "missing"; monthly: number | null };
  diesel: { source: "entered" | "none" | "average" | "missing"; monthly: number | null }; // monthly = the average, when used
  miscellaneous: { source: "average" | "not_entered"; monthly: number | null };
  medicine: { source: "in_feed" | "entered" | "none" | "missing" };
  topDressing: { source: "entered" | "not_entered"; monthly: number | null };
  interest: { source: "entered" | "not_entered"; monthly: number | null };
  rent: { source: "entered" | "not_entered"; monthly: number | null };
}

const daysInMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

function settingOn(input: CostInput, type: string, date: string): number | null {
  let best: CostSetting | null = null;
  for (const s of input.settings) {
    if (s.type !== type || s.month) continue;
    if (s.effectiveFrom <= date && (!best || s.effectiveFrom > best.effectiveFrom)) best = s;
  }
  return best ? best.value : null;
}
function monthlyOn(input: CostInput, type: string, date: string): number | null {
  const ym = date.slice(0, 7);
  const exact = input.settings.find((s) => s.type === type && s.month === ym);
  if (exact) return exact.value;
  // a monthly setting with no month (labour) applies from its effective date
  return settingOn(input, type, date);
}

export interface DayEconomics {
  date: string;
  eggsProduced: number;
  eggsSold: number;
  unpricedEggsSold: number;
  revenue: number; // priced egg sales only
  birdSaleRevenue: number;
  cost: {
    feed: number;
    electricity: number;
    labour: number;
    packing: number;
    diesel: number;
    medicine: number; // medicine + vaccine purchases
    other: number; // feed ingredients, packing/electricity/labour purchases, other (not chicks)
    chicks: number; // chick purchase: batch count x the average price, on the day the chicks arrive (month of arrival)
    miscellaneous: number; // V19 D: the monthly average, spread over the month's days
    topDressing: number; // V19 D: when entered (none yet)
    interest: number; // V19 D: when entered (none yet)
    rent: number; // V19 D: when entered (none yet)
    total: number;
  };
  /** V19 D: where each overhead came from that day (bill / average / entered / included in feed / not entered) */
  sources: DaySources;
  /** V19 D: true for a calendar day without register rows: only its share of the monthly costs is counted */
  overheadOnly: boolean;
  chickPurchases: number; // chick purchases entered by hand (already counted in cost.chicks)
  profit: number; // revenue - cost.total (egg sales only; bird sales shown separately)
  revenuePerEgg: number | null; // revenue / eggs sold
  costPerEgg: number | null; // cost.total / eggs produced
  missing: string[]; // monthly figures not entered for this day's month
  /** V19: the feed cost of the day by price (one line per price used): bags, kg, rupees */
  feedBy: { label: string; perKg: number; bags: number; cost: number }[];
  /** V19: flocks with feed bags but no price (no formula and no farm default): their feed cost is "not entered" */
  feedNotPriced: string[];
}

/** V19: a flock's feed price on a day (the formula for its shed, else the farm default, else not entered). */
export function flockFeedPrice(input: CostInput, flockId: string, date: string): FeedPrice {
  return feedPriceFor(input.settings, input.formulations ?? [], input.flockLabels?.[flockId], date);
}

/** V19 D: the monthly amount of a cost type for a month: a row for that month, else the standing row in force. */
function monthAmount(input: CostInput, type: string, date: string): number | null {
  return monthlyOn(input, type, date);
}

/** V19 D: where each overhead comes from on a day, and the monthly amount used. */
export function daySources(input: CostInput, date: string): DaySources {
  const ym = date.slice(0, 7);
  const said = (key: string) => (input.statuses ?? []).some((x) => x.month === ym && x.key === key && x.status === "none");
  const inMonth = (d: string) => d.startsWith(ym);
  const bill = input.settings.find((x) => x.type === "electricity_month" && x.month === ym)?.value ?? settingOn(input, "electricity_month", date);
  const elecDefault = settingOn(input, COST_TYPES.electricityDefault, date);
  const dieselEntered = input.diesel.some((d) => inMonth(d.date)) || input.purchases.some((p) => inMonth(p.date) && p.category === "diesel");
  const dieselDefault = settingOn(input, COST_TYPES.dieselDefault, date);
  const misc = settingOn(input, COST_TYPES.miscDefault, date);
  const inFeed = settingOn(input, COST_TYPES.medicineInFeed, date) != null;
  const medEntered = input.purchases.some((p) => inMonth(p.date) && (p.category === "medicine" || p.category === "vaccine"));
  const lab = monthlyOn(input, "labour_month", date);
  const opt = (type: string) => { const v = monthAmount(input, type, date); return v != null ? { source: "entered" as const, monthly: v } : { source: "not_entered" as const, monthly: null }; };
  return {
    electricity: bill != null ? { source: "bill", monthly: bill } : elecDefault != null ? { source: "average", monthly: elecDefault } : { source: "missing", monthly: null },
    labour: lab != null ? { source: "entered", monthly: lab } : { source: "missing", monthly: null },
    diesel: dieselEntered ? { source: "entered", monthly: null } : said("diesel") ? { source: "none", monthly: null } : dieselDefault != null ? { source: "average", monthly: dieselDefault } : { source: "missing", monthly: null },
    miscellaneous: misc != null ? { source: "average", monthly: misc } : { source: "not_entered", monthly: null },
    medicine: { source: inFeed ? "in_feed" : medEntered ? "entered" : said("medicines") ? "none" : "missing" },
    topDressing: opt(COST_TYPES.topDressing),
    interest: opt(COST_TYPES.interest),
    rent: opt(COST_TYPES.rent),
  };
}

/**
 * The economics of one day. `overheadOnly` (V19 D) = a calendar day without register rows inside a period: only its
 * share of the monthly costs (labour, electricity, the diesel and miscellaneous averages, entered monthly costs).
 */
export function dayEconomics(input: CostInput, date: string, opts: { overheadOnly?: boolean } = {}): DayEconomics {
  const only = opts.overheadOnly === true;
  const prod = only ? [] : input.prod.filter((p) => p.date === date);
  const eggsProduced = prod.reduce((s, p) => s + p.eggs, 0);
  const bags = prod.reduce((s, p) => s + p.feedBags, 0);
  const sold = only ? [] : input.sales.filter((s) => s.date === date);
  const eggsSold = sold.reduce((s, x) => s + x.eggs, 0);
  const priced = sold.filter((x) => x.amount != null);
  const revenue = priced.reduce((s, x) => s + (x.amount ?? 0), 0);
  const unpricedEggsSold = sold.filter((x) => x.amount == null).reduce((s, x) => s + x.eggs, 0);
  const missing: string[] = [];
  const dim = daysInMonth(date.slice(0, 7));

  // V19: each flock's bags at that flock's price. Rows are grouped by price, so a day on which every flock has the same
  // price (every day before 28 Nov 2026) is worked out exactly as before: all its bags x 45 kg x that price.
  const groups = new Map<string, { label: string; perKg: number; bags: number }>();
  const feedNotPriced: string[] = [];
  for (const p of prod) {
    if (!(p.feedBags > 0)) continue;
    const pr = flockFeedPrice(input, p.flockId, date);
    if (pr.perKg == null) { feedNotPriced.push(input.flockLabels?.[p.flockId] ?? p.flockId); continue; }
    const k = `${pr.label}|${pr.perKg}`;
    const g = groups.get(k) ?? { label: pr.label, perKg: pr.perKg, bags: 0 };
    g.bags += p.feedBags;
    groups.set(k, g);
  }
  if (feedNotPriced.length && bags > 0) missing.push("feed price per kg");
  const src = daySources(input, date);
  const elecMonth = src.electricity.monthly;
  if (src.electricity.source === "missing") missing.push(`electricity for ${date.slice(0, 7)}`);
  const labMonth = src.labour.monthly;
  if (labMonth == null) missing.push("labour");
  const packPer = settingOn(input, "packing_per_tray", date);
  if (packPer == null && eggsSold > 0) missing.push("packing price per tray");
  // monthly inputs that were never entered are MISSING (not zero) unless the owner said "none this month", or (V19 D)
  // an average covers them (diesel, miscellaneous for "other costs") or medicines are inside the feed price
  const ym = date.slice(0, 7);
  const said = (key: string) => (input.statuses ?? []).some((x) => x.month === ym && x.key === key && x.status === "none");
  const inMonth = (d: string) => d.startsWith(ym);
  if (src.diesel.source === "missing") missing.push(`diesel for ${ym}`);
  if (src.medicine.source === "missing") missing.push(`medicines for ${ym}`);
  if (src.miscellaneous.source !== "average" && !input.purchases.some((p) => inMonth(p.date) && ["feed_ingredient", "packing", "electricity", "labour", "other"].includes(p.category)) && !said("other")) missing.push(`other costs for ${ym}`);

  const sumP = (cats: string[]) => (only ? 0 : input.purchases.filter((p) => p.date === date && cats.includes(p.category)).reduce((s, p) => s + p.amount, 0));
  const feedBy = [...groups.values()].map((g) => ({ ...g, cost: g.bags * BAG_KG * g.perKg }));
  const feed = feedBy.reduce((t, g) => t + g.cost, 0);
  const electricity = (elecMonth ?? 0) / dim;
  const labour = (labMonth ?? 0) / dim;
  const packing = (eggsSold / 30) * (packPer ?? 0);
  const diesel = src.diesel.source === "average" ? (src.diesel.monthly ?? 0) / dim : (only ? 0 : input.diesel.filter((d) => d.date === date).reduce((s, d) => s + d.amount, 0)) + sumP(["diesel"]);
  const medicine = sumP(["medicine", "vaccine"]);
  const other = sumP(["feed_ingredient", "packing", "electricity", "labour", "other"]);
  // chick purchase: batch count x the average price, counted on the arrival day (so it lands in the month of arrival).
  // A batch is skipped when a chick purchase was entered by hand within a week of arrival (never counted twice).
  const chickPrice = settingOn(input, CHICK_COST_TYPE, date);
  const chicks = (only ? [] : input.chickBatches ?? [])
    .filter((b) => b.arrival === date && chickPrice != null && !input.purchases.some((p) => p.category === "chicks" && Math.abs(Date.parse(p.date) - Date.parse(b.arrival)) <= 7 * 86400000))
    .reduce((t, b) => t + b.count * (chickPrice ?? 0), 0) + sumP(["chicks"]);
  const miscellaneous = (src.miscellaneous.monthly ?? 0) / dim;
  const topDressing = (src.topDressing.monthly ?? 0) / dim;
  const interest = (src.interest.monthly ?? 0) / dim;
  const rent = (src.rent.monthly ?? 0) / dim;
  // the new lines are added after the old ones, so a day where they are all 0 has exactly the old total
  const total = feed + electricity + labour + packing + diesel + medicine + other + chicks + miscellaneous + topDressing + interest + rent;
  return {
    date,
    eggsProduced,
    eggsSold,
    unpricedEggsSold,
    revenue,
    birdSaleRevenue: input.birdSales.filter((b) => b.date === date).reduce((s, b) => s + (b.amount ?? 0), 0),
    cost: { feed, electricity, labour, packing, diesel, medicine, other, chicks, miscellaneous, topDressing, interest, rent, total },
    sources: src,
    overheadOnly: only,
    chickPurchases: sumP(["chicks"]),
    profit: revenue - total,
    revenuePerEgg: eggsSold > 0 && revenue > 0 && unpricedEggsSold === 0 ? revenue / eggsSold : null,
    costPerEgg: eggsProduced > 0 ? total / eggsProduced : null,
    missing,
    feedBy,
    feedNotPriced,
  };
}

const addDay = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/** V19 D3: the last day a period's costs run to: today (the loader sets it) or, without it, the last day with rows. */
export function costCap(input: CostInput): string | null {
  if (input.today) return input.today;
  let last: string | null = null;
  for (const p of input.prod) if (!last || p.date > last) last = p.date;
  return last;
}

/**
 * V19 D3: the calendar days of from..to (up to today) WITHOUT register rows. Each still carries its share of the
 * monthly costs (labour, electricity, the averages), so a month that is still running is charged its days so far
 * (monthly × days so far ÷ days in the month), and a day the register missed is not free.
 */
export function overheadOnlyDays(input: CostInput, from: string, to: string, dataDates: ReadonlySet<string>): string[] {
  const cap = costCap(input);
  const end = cap && cap < to ? cap : to;
  // nothing before the app's first day with register rows (2 Jul 2026): there is no farm record to cost
  let first: string | null = null;
  for (const p of input.prod) if (!first || p.date < first) first = p.date;
  if (!first) return [];
  const out: string[] = [];
  for (let d = from < first ? first : from; d <= end; d = addDay(d, 1)) if (!dataDates.has(d)) out.push(d);
  return out;
}

/** The days of a period whose costs are counted: every day with rows, plus the other calendar days up to today (monthly costs only). */
export function periodEconomics(input: CostInput, from: string, to: string, dataDates?: readonly string[]): DayEconomics[] {
  const dates = dataDates ?? [...new Set(input.prod.filter((p) => p.date >= from && p.date <= to).map((p) => p.date))].sort();
  const set = new Set(dates);
  return [...dates.map((d) => dayEconomics(input, d)), ...overheadOnlyDays(input, from, to, set).map((d) => dayEconomics(input, d, { overheadOnly: true }))].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Adds the cost lines of several days. */
export function sumCosts(days: readonly DayEconomics[]): DayEconomics["cost"] {
  const sum = (f: (d: DayEconomics) => number) => days.reduce((s, d) => s + f(d), 0);
  return {
    feed: sum((d) => d.cost.feed),
    electricity: sum((d) => d.cost.electricity),
    labour: sum((d) => d.cost.labour),
    packing: sum((d) => d.cost.packing),
    diesel: sum((d) => d.cost.diesel),
    medicine: sum((d) => d.cost.medicine),
    other: sum((d) => d.cost.other),
    chicks: sum((d) => d.cost.chicks),
    miscellaneous: sum((d) => d.cost.miscellaneous),
    topDressing: sum((d) => d.cost.topDressing),
    interest: sum((d) => d.cost.interest),
    rent: sum((d) => d.cost.rent),
    total: sum((d) => d.cost.total),
  };
}

export interface SourceLine {
  source: CostSource;
  monthly: number | null;
  months: string[]; // YYYY-MM
  days: number; // days counted with this source
  from: string;
  to: string;
}
export interface CostSourceSummary {
  /** each month touched: the days whose costs are counted and the days in the month (a month still running: fewer) */
  months: { month: string; days: number; daysInMonth: number }[];
  electricity: SourceLine[];
  labour: SourceLine[];
  diesel: SourceLine[];
  miscellaneous: SourceLine[];
  medicine: SourceLine[];
  topDressing: SourceLine[];
  interest: SourceLine[];
  rent: SourceLine[];
}

/** V19 D1: where each overhead of a period came from, month by month, so the screen can say "(average)" next to it. */
export function summarizeSources(days: readonly DayEconomics[]): CostSourceSummary {
  const months = new Map<string, number>();
  for (const d of days) months.set(d.date.slice(0, 7), (months.get(d.date.slice(0, 7)) ?? 0) + 1);
  const lines = (pick: (s: DaySources) => { source: string; monthly?: number | null }): SourceLine[] => {
    const m = new Map<string, SourceLine>();
    for (const d of days) {
      const x = pick(d.sources);
      const k = `${x.source}|${x.monthly ?? ""}`;
      const ym = d.date.slice(0, 7);
      const a = m.get(k) ?? { source: x.source as CostSource, monthly: x.monthly ?? null, months: [], days: 0, from: d.date, to: d.date };
      if (!a.months.includes(ym)) a.months.push(ym);
      a.days++;
      if (d.date < a.from) a.from = d.date;
      if (d.date > a.to) a.to = d.date;
      m.set(k, a);
    }
    return [...m.values()];
  };
  return {
    months: [...months].sort().map(([month, n]) => ({ month, days: n, daysInMonth: daysInMonth(month) })),
    electricity: lines((s) => s.electricity),
    labour: lines((s) => s.labour),
    diesel: lines((s) => s.diesel),
    miscellaneous: lines((s) => s.miscellaneous),
    medicine: lines((s) => s.medicine),
    topDressing: lines((s) => s.topDressing),
    interest: lines((s) => s.interest),
    rent: lines((s) => s.rent),
  };
}

export interface MonthEconomics {
  month: string;
  days: number;
  eggsProduced: number;
  eggsSold: number;
  unpricedEggsSold: number;
  revenue: number;
  birdSaleRevenue: number;
  cost: DayEconomics["cost"];
  chickPurchases: number;
  profit: number;
  revenuePerEgg: number | null;
  costPerEgg: number | null;
  missing: string[];
  /** V19 D3: calendar days whose costs are counted (days with rows + the other days so far: monthly costs only) */
  costDays: number;
  daysInMonth: number;
  sources: CostSourceSummary;
}

export function monthEconomics(input: CostInput, month: string): MonthEconomics {
  const dates = [...new Set(input.prod.filter((p) => p.date.startsWith(month)).map((p) => p.date))].sort();
  const dim = daysInMonth(month);
  const days = periodEconomics(input, `${month}-01`, `${month}-${String(dim).padStart(2, "0")}`, dates);
  const sum = (f: (d: DayEconomics) => number) => days.reduce((s, d) => s + f(d), 0);
  const cost = sumCosts(days);
  const eggsProduced = sum((d) => d.eggsProduced);
  const eggsSold = sum((d) => d.eggsSold);
  const unpriced = sum((d) => d.unpricedEggsSold);
  const revenue = sum((d) => d.revenue);
  return {
    month,
    days: dates.length,
    eggsProduced,
    eggsSold,
    unpricedEggsSold: unpriced,
    revenue,
    birdSaleRevenue: sum((d) => d.birdSaleRevenue),
    cost,
    chickPurchases: sum((d) => d.chickPurchases),
    profit: revenue - cost.total,
    revenuePerEgg: eggsSold > 0 && revenue > 0 && unpriced === 0 ? revenue / eggsSold : null,
    costPerEgg: eggsProduced > 0 ? cost.total / eggsProduced : null,
    missing: [...new Set(days.flatMap((d) => d.missing))],
    costDays: days.length,
    daysInMonth: dim,
    sources: summarizeSources(days),
  };
}

/** Per-flock slice of a day: feed is exact (the flock's own bags); every shared cost is split by bird count; revenue by eggs laid. All estimates. */
export function flockEconomics(input: CostInput, date: string) {
  const day = dayEconomics(input, date);
  const rows = input.prod.filter((p) => p.date === date);
  const birds = rows.reduce((s, p) => s + p.birds, 0);
  const eggs = rows.reduce((s, p) => s + p.eggs, 0);
  const shared = day.cost.total - day.cost.feed - day.cost.chicks; // a new batch of chicks is not a cost of today's laying flocks
  return rows.map((p) => {
    const price = flockFeedPrice(input, p.flockId, date); // V19: the flock's own price (formula for its shed, else default)
    const feedMissing = p.feedBags > 0 && price.perKg == null; // "not entered", never a cost of 0
    const feed = p.feedBags * BAG_KG * (price.perKg ?? 0);
    const share = birds > 0 ? p.birds / birds : 0;
    const cost = feed + shared * share;
    const revenue = eggs > 0 ? day.revenue * (p.eggs / eggs) : 0;
    return { flockId: p.flockId, eggs: p.eggs, feed, cost, revenue, profit: revenue - cost, feedBags: p.feedBags, price, feedMissing };
  });
}

/** Several days added up (used for the 7-day revenue-per-egg vs cost-per-egg watch item). */
export function rangeEconomics(input: CostInput, from: string, to: string) {
  const dates = [...new Set(input.prod.filter((p) => p.date >= from && p.date <= to).map((p) => p.date))].sort();
  const days = periodEconomics(input, from, to, dates); // V19 D3: monthly costs for every calendar day so far
  const sum = (f: (d: DayEconomics) => number) => days.reduce((s, d) => s + f(d), 0);
  const eggsSold = sum((d) => d.eggsSold);
  const unpriced = sum((d) => d.unpricedEggsSold);
  const revenue = sum((d) => d.revenue);
  const cost = sum((d) => d.cost.total);
  const eggsProduced = sum((d) => d.eggsProduced);
  return {
    days: dates.length,
    costDays: days.length,
    eggsProduced,
    eggsSold,
    unpricedEggsSold: unpriced,
    revenue,
    cost,
    revenuePerEgg: eggsSold > 0 && unpriced === 0 && revenue > 0 ? revenue / eggsSold : null,
    costPerEgg: eggsProduced > 0 ? cost / eggsProduced : null,
  };
}

/** Per-flock month: feed exact, shared costs by bird count, revenue by eggs laid. Estimate. */
export function flockMonthEconomics(input: CostInput, month: string) {
  const dates = [...new Set(input.prod.filter((p) => p.date.startsWith(month)).map((p) => p.date))].sort();
  const acc = new Map<string, { flockId: string; eggs: number; feed: number; cost: number; revenue: number; profit: number; feedMissing: boolean }>();
  for (const d of dates) {
    for (const f of flockEconomics(input, d)) {
      const a = acc.get(f.flockId) ?? { flockId: f.flockId, eggs: 0, feed: 0, cost: 0, revenue: 0, profit: 0, feedMissing: false };
      a.eggs += f.eggs; a.feed += f.feed; a.cost += f.cost; a.revenue += f.revenue; a.profit += f.profit; a.feedMissing ||= f.feedMissing;
      acc.set(f.flockId, a);
    }
  }
  // V19 D3: a day of the month without rows (up to today) still carries its monthly costs; they are shared by the birds
  // of the last day before it that has rows, so the flocks add up to the farm's month
  if (dates.length) {
    const dim = daysInMonth(month);
    for (const d of overheadOnlyDays(input, `${month}-01`, `${month}-${String(dim).padStart(2, "0")}`, new Set(dates))) {
      const ref = [...dates].reverse().find((x) => x < d) ?? dates[0];
      const rows = input.prod.filter((p) => p.date === ref);
      const birds = rows.reduce((t, p) => t + p.birds, 0);
      const c = dayEconomics(input, d, { overheadOnly: true }).cost.total;
      for (const p of rows) {
        const a = acc.get(p.flockId);
        if (!a || birds <= 0) continue;
        a.cost += (c * p.birds) / birds;
        a.profit -= (c * p.birds) / birds;
      }
    }
  }
  return [...acc.values()];
}

export interface FlockFeedCost {
  flockId: string;
  label: string;
  days: number; // days with a row for the flock
  bags: number;
  kg: number;
  cost: number | null; // null = some bags have no price ("not entered"), never a guess
  eggs: number;
  costPerEgg: number | null; // feed cost ÷ eggs laid
  prices: FeedPrice[]; // the distinct prices used, in date order
  daysWithFeed: number;
}

/** V19 B3: each flock's feed over some days: its bags x BAG_KG x its price on each day, added up (pure). */
export function flockFeedCosts(input: CostInput, dates: readonly string[]): FlockFeedCost[] {
  const set = new Set(dates);
  const by = new Map<string, FlockFeedCost & { _missing: boolean }>();
  for (const p of input.prod) {
    if (!set.has(p.date)) continue;
    const label = input.flockLabels?.[p.flockId] ?? p.flockId;
    const a = by.get(p.flockId) ?? { flockId: p.flockId, label, days: 0, bags: 0, kg: 0, cost: 0, eggs: 0, costPerEgg: null, prices: [], daysWithFeed: 0, _missing: false };
    a.days++;
    a.eggs += p.eggs;
    if (p.feedBags > 0) {
      const pr = flockFeedPrice(input, p.flockId, p.date);
      a.bags += p.feedBags;
      a.kg += p.feedBags * BAG_KG;
      a.daysWithFeed++;
      if (pr.perKg == null) a._missing = true;
      else a.cost = (a.cost ?? 0) + p.feedBags * BAG_KG * pr.perKg;
      if (!a.prices.some((x) => x.label === pr.label && x.perKg === pr.perKg)) a.prices.push(pr);
    }
    by.set(p.flockId, a);
  }
  return [...by.values()].map(({ _missing, ...a }) => {
    const cost = _missing ? null : a.cost;
    return { ...a, cost, costPerEgg: cost != null && a.eggs > 0 ? cost / a.eggs : null };
  });
}
