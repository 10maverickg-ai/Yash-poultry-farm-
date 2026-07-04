import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

import type { EggStockDay, EggStockEntry, SaleRow } from "@/lib/eggstock-types";

export type { EggStockDay, EggStockEntry, SaleRow };

export async function getEggStockDay(date: string): Promise<EggStockDay> {
  const [summaryRes, prodRes, prevRes] = await Promise.all([
    pool.query(
      `SELECT * FROM daily_egg_stock_summary WHERE farm_code = $1 AND date = $2`,
      [ACTIVE_FARM, date]
    ),
    pool.query(
      `SELECT sum(eggs_total)::int AS s FROM daily_production
        WHERE farm_code = $1 AND date = $2`,
      [ACTIVE_FARM, date]
    ),
    pool.query(
      `SELECT closing_balance_eggs FROM daily_egg_stock_summary
        WHERE farm_code = $1 AND date < $2 AND closing_balance_eggs IS NOT NULL
        ORDER BY date DESC LIMIT 1`,
      [ACTIVE_FARM, date]
    ),
  ]);

  const summary = summaryRes.rows[0] ?? null;
  let entries: EggStockEntry[] = [];
  if (summary) {
    const { rows } = await pool.query(
      `SELECT id, sequence_order, label_as_written, category, amount_eggs,
              running_balance_after, linked_sale_id
         FROM daily_egg_stock_entries
        WHERE egg_stock_summary_id = $1
        ORDER BY sequence_order`,
      [summary.id]
    );
    entries = rows;
  }

  return {
    summary: summary && {
      id: summary.id,
      total_eggs_produced: summary.total_eggs_produced,
      grade_13_eggs: summary.grade_13_eggs,
      grade_14_eggs: summary.grade_14_eggs,
      grade_15_eggs: summary.grade_15_eggs,
      grade_15plus_eggs: summary.grade_15plus_eggs,
      closing_balance_eggs: summary.closing_balance_eggs,
      closing_balance_trays: summary.closing_balance_trays,
      flagged: summary.flagged,
      flag_reason: summary.flag_reason,
    },
    entries,
    productionSum: prodRes.rows[0].s,
    previousClosing: prevRes.rows[0]?.closing_balance_eggs ?? null,
  };
}

export async function listSales(limit = 60): Promise<SaleRow[]> {
  const { rows } = await pool.query(
    `SELECT id, date, transaction_type, buyer_or_recipient, grade,
            eggs_quantity, trays_quantity, price_per_unit, amount
       FROM sales
      WHERE farm_code = $1
      ORDER BY date DESC, id DESC
      LIMIT $2`,
    [ACTIVE_FARM, limit]
  );
  return rows;
}

export async function getSale(id: number): Promise<SaleRow | null> {
  const { rows } = await pool.query(
    `SELECT id, date, transaction_type, buyer_or_recipient, grade,
            eggs_quantity, trays_quantity, price_per_unit, amount
       FROM sales
      WHERE id = $1 AND farm_code = $2`,
    [id, ACTIVE_FARM]
  );
  return rows[0] ?? null;
}
