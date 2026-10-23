import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import type { PeriodExtras } from "./period";

// Read-only. The pieces the period summaries need that the daily engines do not carry:
// priced egg sales with grade/buyer, eggs taken out of stock that were not sold, bird sales.
export async function loadPeriodExtras(): Promise<PeriodExtras> {
  const [sales, ded, birds] = await Promise.all([
    pool.query(
      `SELECT date, eggs_quantity, amount, grade, transaction_type, buyer_or_recipient FROM sales WHERE farm_code = $1`,
      [ACTIVE_FARM]
    ),
    pool.query(
      `SELECT s.date, e.category, sum(-e.amount_eggs)::int AS eggs
         FROM daily_egg_stock_entries e JOIN daily_egg_stock_summary s ON s.id = e.egg_stock_summary_id
        WHERE s.farm_code = $1 AND s.deleted_at IS NULL AND e.amount_eggs IS NOT NULL
          AND e.category NOT IN ('sale','local_sale','production_addition')
        GROUP BY s.date, e.category`,
      [ACTIVE_FARM]
    ),
    pool.query(
      `SELECT date, birds_change, price_per_bird, buyer FROM flock_movements WHERE farm_code = $1 AND movement_type = 'sale'`,
      [ACTIVE_FARM]
    ),
  ]);
  return {
    sales: sales.rows.map((r) => ({
      date: String(r.date).slice(0, 10),
      eggs: r.eggs_quantity ?? 0,
      amount: r.amount != null ? Number(r.amount) : null,
      grade: r.grade ?? "big",
      channel: r.transaction_type === "sale_farmfresh" ? ("farmfresh" as const) : ("local" as const),
      buyer: r.buyer_or_recipient,
    })),
    deductions: ded.rows.map((r) => ({ date: String(r.date).slice(0, 10), category: String(r.category), eggs: Number(r.eggs) })),
    birdSales: birds.rows.map((r) => {
      const b = Math.abs(r.birds_change);
      return { date: String(r.date).slice(0, 10), birds: b, amount: r.price_per_bird != null ? b * Number(r.price_per_bird) : null, buyer: r.buyer ?? null };
    }),
  };
}
