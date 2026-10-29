import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import type { CostInput } from "./engine";

const num = (x: unknown) => (x == null ? null : Number(x));

export async function loadCostInput(): Promise<CostInput> {
  const [settings, purchases, medLines, diesel, prod, sales, birds, batches, statuses] = await Promise.all([
    pool.query(`SELECT cost_type, value, effective_from, month FROM cost_settings WHERE farm_code = $1`, [ACTIVE_FARM]),
    pool.query(`SELECT date, category, amount_inr FROM purchases WHERE farm_code = $1`, [ACTIVE_FARM]),
    // V12: medicine and vaccine register lines WITH a cost count as medicine / vaccine cost; a line with no cost is "not entered", never zero
    pool.query(`SELECT date, kind AS category, amount_inr FROM medicine_lines WHERE farm_code = $1 AND amount_inr IS NOT NULL`, [ACTIVE_FARM]),
    pool.query(`SELECT date, amount_inr FROM diesel_purchases WHERE farm_code = $1`, [ACTIVE_FARM]),
    pool.query(
      `SELECT date, flock_internal_id, eggs_total, feed_bags, bird_population
         FROM daily_production WHERE farm_code = $1 AND deleted_at IS NULL`,
      [ACTIVE_FARM]
    ),
    pool.query(`SELECT date, eggs_quantity, amount FROM sales WHERE farm_code = $1`, [ACTIVE_FARM]),
    pool.query(
      `SELECT date, birds_change, price_per_bird FROM flock_movements
        WHERE farm_code = $1 AND movement_type = 'sale'`,
      [ACTIVE_FARM]
    ),
    pool.query(`SELECT arrival_date, starting_count, coalesce(to_anil_farm_count, 0) AS to_anil FROM chick_batches WHERE farm_code = $1`, [ACTIVE_FARM]),
    pool.query(`SELECT month, input_key, status FROM monthly_input_status WHERE farm_code = $1`, [ACTIVE_FARM]),
  ]);
  return {
    settings: settings.rows.map((r) => ({
      type: r.cost_type,
      value: Number(r.value),
      effectiveFrom: String(r.effective_from).slice(0, 10),
      month: r.month,
    })),
    purchases: [...purchases.rows, ...medLines.rows].map((r) => ({ date: r.date, category: r.category, amount: Number(r.amount_inr) })),
    diesel: diesel.rows.map((r) => ({ date: r.date, amount: Number(r.amount_inr) })),
    prod: prod.rows.map((r) => ({
      date: r.date,
      flockId: r.flock_internal_id,
      eggs: r.eggs_total ?? 0,
      feedBags: r.feed_bags ?? 0,
      birds: r.bird_population ?? 0,
    })),
    sales: sales.rows.map((r) => ({ date: r.date, eggs: r.eggs_quantity ?? 0, amount: num(r.amount) })),
    chickBatches: batches.rows.map((r) => ({ arrival: String(r.arrival_date).slice(0, 10), count: Math.max(0, Number(r.starting_count) - Number(r.to_anil)) })),
    statuses: statuses.rows.map((r) => ({ month: r.month, key: r.input_key, status: r.status })),
    birdSales: birds.rows.map((r) => ({
      date: r.date,
      amount: r.price_per_bird != null ? Math.abs(r.birds_change) * Number(r.price_per_bird) : null,
    })),
  };
}
