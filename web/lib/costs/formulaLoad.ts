import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import type { Formulation } from "./feedPrice";

// V19: the nutritionist's feed formulas, read as they are (every row, every effective date; the price rule in
// feedPrice.ts picks the right one for a flock and a day, so a new row with a later date needs no code change).
export async function loadFormulations(): Promise<Formulation[]> {
  const [f, ing, sheds] = await Promise.all([
    pool.query(
      `SELECT id, code, name, effective_from, batch_kg, formula_cost_per_kg, production_loss_pct, production_cost_per_kg,
              bagging_cost_per_kg, delivered_cost_per_kg, ame_kcal_per_kg, target_intake_note, source, note
         FROM feed_formulations WHERE farm_code = $1 ORDER BY effective_from DESC, id`,
      [ACTIVE_FARM]
    ),
    pool.query(`SELECT formulation_id, ingredient, percent, kg_per_batch, rupees_per_kg FROM feed_formulation_ingredients ORDER BY formulation_id, percent DESC, ingredient`),
    pool.query(`SELECT formulation_id, flock_label FROM feed_formulation_sheds ORDER BY formulation_id, flock_label`),
  ]);
  const num = (x: unknown) => (x == null ? null : Number(x));
  return f.rows.map((r) => ({
    id: Number(r.id),
    code: r.code,
    name: r.name,
    effectiveFrom: String(r.effective_from instanceof Date ? r.effective_from.toISOString() : r.effective_from).slice(0, 10),
    batchKg: Number(r.batch_kg),
    formulaCostPerKg: Number(r.formula_cost_per_kg),
    lossPct: Number(r.production_loss_pct),
    productionCostPerKg: Number(r.production_cost_per_kg),
    baggingCostPerKg: Number(r.bagging_cost_per_kg),
    deliveredCostPerKg: Number(r.delivered_cost_per_kg),
    ameKcalPerKg: num(r.ame_kcal_per_kg),
    targetIntakeNote: r.target_intake_note,
    source: r.source,
    note: r.note,
    sheds: sheds.rows.filter((s) => s.formulation_id === r.id).map((s) => String(s.flock_label)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    ingredients: ing.rows.filter((i) => i.formulation_id === r.id).map((i) => ({ ingredient: i.ingredient, percent: Number(i.percent), kgPerBatch: Number(i.kg_per_batch), rupeesPerKg: Number(i.rupees_per_kg) })),
  }));
}

/** The two things a feed price needs: the farm's cost settings (the default) and the formulas. For screens that do not load the whole cost input. */
export async function loadFeedPricing(): Promise<{ settings: { type: string; value: number; effectiveFrom: string; month: string | null }[]; formulations: Formulation[] }> {
  const [s, formulations] = await Promise.all([
    pool.query(`SELECT cost_type, value, effective_from, month FROM cost_settings WHERE farm_code = $1 AND cost_type = 'feed_per_kg'`, [ACTIVE_FARM]),
    loadFormulations().catch(() => [] as Formulation[]),
  ]);
  return { settings: s.rows.map((r) => ({ type: r.cost_type, value: Number(r.value), effectiveFrom: String(r.effective_from).slice(0, 10), month: r.month })), formulations };
}
