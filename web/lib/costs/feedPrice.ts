// V19 A1: the feed price per kg for one flock on one day. PURE (no database), so every screen, the cost engine, the
// downloads and the tests use the same rule:
//   1. the nutritionist's formula whose shed list names the flock (by its real name, e.g. "BAB-1") and whose
//      effective_from is on or before the day; when several do, the latest effective_from wins (a later formula
//      added to the table is picked up with no code change);
//   2. otherwise the farm default, cost_settings.feed_per_kg in force that day (₹33.33, own mill, since 1 Aug 2026);
//   3. otherwise nothing: "not entered", never 0.
// The bag size is BAG_KG in lib/costs/engine.ts (45 kg), the one place it is set. The formula PDFs print a per-50-kg
// column for display only; the app never uses it.

export interface FormulaIngredient {
  ingredient: string;
  percent: number;
  kgPerBatch: number; // kg in a 1,000 kg batch
  rupeesPerKg: number;
}

export interface Formulation {
  id: number;
  code: string;
  name: string;
  effectiveFrom: string; // YYYY-MM-DD
  batchKg: number;
  formulaCostPerKg: number; // the ingredients
  lossPct: number; // production loss, % (delivered = formula ÷ (1 − loss) + production + bagging)
  productionCostPerKg: number;
  baggingCostPerKg: number;
  deliveredCostPerKg: number; // what a kg costs the farm: the price the app uses
  ameKcalPerKg: number | null;
  targetIntakeNote: string | null;
  source: string | null;
  note: string | null;
  sheds: string[]; // flock names, e.g. ["BAB-1", "BAB-4"]
  ingredients: FormulaIngredient[];
}

/** The settings the default comes from (the same shape as the cost engine's settings). */
export interface PriceSetting {
  type: string;
  value: number;
  effectiveFrom: string;
  month: string | null;
}

export type FeedPriceSource = "formula" | "default" | "missing";

export interface FeedPrice {
  perKg: number | null; // null = not entered (never 0)
  source: FeedPriceSource;
  label: string; // "Formula: BV-300 Phase IV shed 1 & 4" / "Farm default 33.33" / "not entered"
  formulation: Formulation | null;
  since: string | null; // the day this price started (the formula's or the setting's effective date)
}

export const FEED_PRICE_TYPE = "feed_per_kg";
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The farm default feed price in force on a day (the latest feed_per_kg setting on or before it), or null. */
export function defaultFeedPrice(settings: readonly PriceSetting[], date: string): { value: number; since: string } | null {
  let best: PriceSetting | null = null;
  for (const s of settings) {
    if (s.type !== FEED_PRICE_TYPE || s.month) continue;
    if (s.effectiveFrom <= date && (!best || s.effectiveFrom > best.effectiveFrom)) best = s;
  }
  return best ? { value: best.value, since: best.effectiveFrom } : null;
}

/** The formula a flock eats on a day: the latest effective_from on or before the day among those naming the flock. */
export function formulationFor(formulations: readonly Formulation[], flockLabel: string | null | undefined, date: string): Formulation | null {
  if (!flockLabel) return null;
  let best: Formulation | null = null;
  for (const f of formulations) {
    if (f.effectiveFrom > date || !f.sheds.some((s) => same(s, flockLabel))) continue;
    if (!best || f.effectiveFrom > best.effectiveFrom || (f.effectiveFrom === best.effectiveFrom && f.id > best.id)) best = f;
  }
  return best;
}

/** A1: the feed price per kg for (flock, day) and where it came from. */
export function feedPriceFor(settings: readonly PriceSetting[], formulations: readonly Formulation[], flockLabel: string | null | undefined, date: string): FeedPrice {
  const f = formulationFor(formulations, flockLabel, date);
  if (f) return { perKg: f.deliveredCostPerKg, source: "formula", label: `Formula: ${f.name}`, formulation: f, since: f.effectiveFrom };
  const d = defaultFeedPrice(settings, date);
  if (d) return { perKg: d.value, source: "default", label: `Farm default ${d.value.toFixed(2)}`, formulation: null, since: d.since };
  return { perKg: null, source: "missing", label: "not entered", formulation: null, since: null };
}

/** The next formula for a flock that starts after a day (to say "from 28 Nov: …" on a screen dated before it). */
export function nextFormulationFor(formulations: readonly Formulation[], flockLabel: string | null | undefined, date: string): Formulation | null {
  if (!flockLabel) return null;
  let best: Formulation | null = null;
  for (const f of formulations) if (f.effectiveFrom > date && f.sheds.some((s) => same(s, flockLabel)) && (!best || f.effectiveFrom < best.effectiveFrom)) best = f;
  return best;
}

/** The days inside a period on which some formula starts (the price changed): from < day ≤ to. */
export function feedPriceChanges(formulations: readonly Formulation[], from: string, to: string): string[] {
  return [...new Set(formulations.map((f) => f.effectiveFrom).filter((d) => d > from && d <= to))].sort();
}

/** The cost breakdown of a formula, in lines that add up to its delivered cost exactly (the loss line takes the rest). */
export function costLines(f: Formulation): { label: string; perKg: number }[] {
  const loss = f.deliveredCostPerKg - f.formulaCostPerKg - f.productionCostPerKg - f.baggingCostPerKg;
  return [
    { label: "Ingredients (formula cost)", perKg: f.formulaCostPerKg },
    { label: `${f.lossPct}% production loss`, perKg: loss },
    { label: "Production", perKg: f.productionCostPerKg },
    { label: "Bagging", perKg: f.baggingCostPerKg },
  ];
}
