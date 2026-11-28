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
}

/** The weight of one feed bag in kg: the ONE place the app sets it (g/bird, eggs per kg, FCR and feed cost all use it). */
export const BAG_KG = 45;
/** The average price of a chick is a setting (cost_settings.chick_cost_per_chick), never a guess. */
export const CHICK_COST_TYPE = "chick_cost_per_chick";

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
    total: number;
  };
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

export function dayEconomics(input: CostInput, date: string): DayEconomics {
  const prod = input.prod.filter((p) => p.date === date);
  const eggsProduced = prod.reduce((s, p) => s + p.eggs, 0);
  const bags = prod.reduce((s, p) => s + p.feedBags, 0);
  const sold = input.sales.filter((s) => s.date === date);
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
  const elecMonth = monthlyOn(input, "electricity_month", date);
  if (elecMonth == null) missing.push(`electricity for ${date.slice(0, 7)}`);
  const labMonth = monthlyOn(input, "labour_month", date);
  if (labMonth == null) missing.push("labour");
  const packPer = settingOn(input, "packing_per_tray", date);
  if (packPer == null && eggsSold > 0) missing.push("packing price per tray");
  // monthly inputs that were never entered are MISSING (not zero) unless the owner said "none this month"
  const ym = date.slice(0, 7);
  const said = (key: string) => (input.statuses ?? []).some((x) => x.month === ym && x.key === key && x.status === "none");
  const inMonth = (d: string) => d.startsWith(ym);
  if (!input.diesel.some((d) => inMonth(d.date)) && !input.purchases.some((p) => inMonth(p.date) && p.category === "diesel") && !said("diesel")) missing.push(`diesel for ${ym}`);
  if (!input.purchases.some((p) => inMonth(p.date) && (p.category === "medicine" || p.category === "vaccine")) && !said("medicines")) missing.push(`medicines for ${ym}`);
  if (!input.purchases.some((p) => inMonth(p.date) && ["feed_ingredient", "packing", "electricity", "labour", "other"].includes(p.category)) && !said("other")) missing.push(`other costs for ${ym}`);

  const sumP = (cats: string[]) => input.purchases.filter((p) => p.date === date && cats.includes(p.category)).reduce((s, p) => s + p.amount, 0);
  const feedBy = [...groups.values()].map((g) => ({ ...g, cost: g.bags * BAG_KG * g.perKg }));
  const feed = feedBy.reduce((t, g) => t + g.cost, 0);
  const electricity = (elecMonth ?? 0) / dim;
  const labour = (labMonth ?? 0) / dim;
  const packing = (eggsSold / 30) * (packPer ?? 0);
  const diesel = input.diesel.filter((d) => d.date === date).reduce((s, d) => s + d.amount, 0) + sumP(["diesel"]);
  const medicine = sumP(["medicine", "vaccine"]);
  const other = sumP(["feed_ingredient", "packing", "electricity", "labour", "other"]);
  // chick purchase: batch count x the average price, counted on the arrival day (so it lands in the month of arrival).
  // A batch is skipped when a chick purchase was entered by hand within a week of arrival (never counted twice).
  const chickPrice = settingOn(input, CHICK_COST_TYPE, date);
  const chicks = (input.chickBatches ?? [])
    .filter((b) => b.arrival === date && chickPrice != null && !input.purchases.some((p) => p.category === "chicks" && Math.abs(Date.parse(p.date) - Date.parse(b.arrival)) <= 7 * 86400000))
    .reduce((t, b) => t + b.count * (chickPrice ?? 0), 0) + sumP(["chicks"]);
  const total = feed + electricity + labour + packing + diesel + medicine + other + chicks;
  return {
    date,
    eggsProduced,
    eggsSold,
    unpricedEggsSold,
    revenue,
    birdSaleRevenue: input.birdSales.filter((b) => b.date === date).reduce((s, b) => s + (b.amount ?? 0), 0),
    cost: { feed, electricity, labour, packing, diesel, medicine, other, chicks, total },
    chickPurchases: sumP(["chicks"]),
    profit: revenue - total,
    revenuePerEgg: eggsSold > 0 && revenue > 0 && unpricedEggsSold === 0 ? revenue / eggsSold : null,
    costPerEgg: eggsProduced > 0 ? total / eggsProduced : null,
    missing,
    feedBy,
    feedNotPriced,
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
}

export function monthEconomics(input: CostInput, month: string): MonthEconomics {
  const dates = [...new Set(input.prod.filter((p) => p.date.startsWith(month)).map((p) => p.date))].sort();
  const days = dates.map((d) => dayEconomics(input, d));
  const sum = (f: (d: DayEconomics) => number) => days.reduce((s, d) => s + f(d), 0);
  const cost = {
    feed: sum((d) => d.cost.feed),
    electricity: sum((d) => d.cost.electricity),
    labour: sum((d) => d.cost.labour),
    packing: sum((d) => d.cost.packing),
    diesel: sum((d) => d.cost.diesel),
    medicine: sum((d) => d.cost.medicine),
    other: sum((d) => d.cost.other),
    chicks: sum((d) => d.cost.chicks),
    total: sum((d) => d.cost.total),
  };
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
  const days = dates.map((d) => dayEconomics(input, d));
  const sum = (f: (d: DayEconomics) => number) => days.reduce((s, d) => s + f(d), 0);
  const eggsSold = sum((d) => d.eggsSold);
  const unpriced = sum((d) => d.unpricedEggsSold);
  const revenue = sum((d) => d.revenue);
  const cost = sum((d) => d.cost.total);
  const eggsProduced = sum((d) => d.eggsProduced);
  return {
    days: dates.length,
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
