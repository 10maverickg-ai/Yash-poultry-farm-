import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { sortByLabel } from "@/lib/naturalSort";

import type {
  EggStockDay,
  EggStockEntry,
  EggStockSection,
  EggStockSectionDay,
  SaleRow,
} from "@/lib/eggstock-types";
import { EGG_STOCK_SECTIONS } from "@/lib/eggstock-types";

export type { EggStockDay, EggStockEntry, SaleRow };

export async function getEggStockDay(date: string): Promise<EggStockDay> {
  const [summaryRes, flocksRes] = await Promise.all([
    pool.query(
      `SELECT s.*,
              coalesce(
                array_agg(l.flock_internal_id) FILTER (WHERE l.flock_internal_id IS NOT NULL),
                '{}'
              ) AS linked_flock_ids
         FROM daily_egg_stock_summary s
         LEFT JOIN daily_egg_stock_summary_flocks l ON l.egg_stock_summary_id = s.id
        WHERE s.farm_code = $1 AND s.date = $2 AND s.deleted_at IS NULL
        GROUP BY s.id`,
      [ACTIVE_FARM, date]
    ),
    pool.query(
      `SELECT h.display_label, f.flock_internal_id, dp.eggs_total
         FROM flock_label_history h
         JOIN flocks f USING (flock_internal_id)
         LEFT JOIN daily_production dp
           ON dp.flock_internal_id = f.flock_internal_id AND dp.date = $2
          AND dp.deleted_at IS NULL
        WHERE f.farm_code = $1
          AND h.effective_from <= $2
          AND (h.effective_to IS NULL OR h.effective_to >= $2)`,
      [ACTIVE_FARM, date]
    ),
  ]);

  const summariesBySection = new Map(summaryRes.rows.map((r) => [r.section as EggStockSection, r]));

  const sections: EggStockSectionDay[] = await Promise.all(
    EGG_STOCK_SECTIONS.map(async (section) => {
      const summary = summariesBySection.get(section) ?? null;

      let entries: EggStockEntry[] = [];
      let linkedProductionSum: number | null = null;
      if (summary) {
        const { rows } = await pool.query(
          `SELECT id, sequence_order, label_as_written, category, amount_eggs,
                  amount_eggs_original, auto_correction_note, running_balance_after,
                  linked_sale_id
             FROM daily_egg_stock_entries
            WHERE egg_stock_summary_id = $1
            ORDER BY sequence_order`,
          [summary.id]
        );
        entries = rows;

        if (summary.linked_flock_ids.length > 0) {
          const { rows: sumRows } = await pool.query(
            `SELECT sum(dp.eggs_total)::int AS s
               FROM daily_egg_stock_summary_flocks link
               JOIN daily_production dp
                 ON dp.flock_internal_id = link.flock_internal_id AND dp.date = $2
                AND dp.deleted_at IS NULL
              WHERE link.egg_stock_summary_id = $1`,
            [summary.id, date]
          );
          linkedProductionSum = sumRows[0]?.s ?? null;
        }
      }

      const { rows: prevRows } = await pool.query(
        `SELECT closing_balance_eggs FROM daily_egg_stock_summary
          WHERE farm_code = $1 AND section = $2 AND date < $3
            AND closing_balance_eggs IS NOT NULL AND deleted_at IS NULL
          ORDER BY date DESC LIMIT 1`,
        [ACTIVE_FARM, section, date]
      );

      return {
        section,
        summary: summary && {
          id: summary.id,
          section: summary.section,
          opening_balance_eggs: summary.opening_balance_eggs,
          opening_balance_eggs_original: summary.opening_balance_eggs_original,
          total_eggs_produced: summary.total_eggs_produced,
          total_eggs_produced_original: summary.total_eggs_produced_original,
          total_line_eggs: summary.total_line_eggs,
          total_line_eggs_original: summary.total_line_eggs_original,
          grade_13_eggs: summary.grade_13_eggs,
          grade_14_eggs: summary.grade_14_eggs,
          grade_15_eggs: summary.grade_15_eggs,
          grade_15plus_eggs: summary.grade_15plus_eggs,
          closing_balance_eggs: summary.closing_balance_eggs,
          closing_balance_eggs_original: summary.closing_balance_eggs_original,
          closing_balance_trays: summary.closing_balance_trays,
          auto_correction_note: summary.auto_correction_note,
          flagged: summary.flagged,
          flag_reason: summary.flag_reason,
        },
        entries,
        linkedProductionSum,
        previousClosing: prevRows[0]?.closing_balance_eggs ?? null,
        linkedFlockIds: summary?.linked_flock_ids ?? [],
      };
    })
  );

  return {
    sections,
    activeFlocks: sortByLabel(flocksRes.rows, (r) => r.display_label),
  };
}

export async function listSales(limit = 60): Promise<SaleRow[]> {
  const { rows } = await pool.query(
    `SELECT id, date, transaction_type, buyer_or_recipient, grade,
            eggs_quantity, trays_quantity, price_per_unit, amount, recipient
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
            eggs_quantity, trays_quantity, price_per_unit, amount, recipient
       FROM sales
      WHERE id = $1 AND farm_code = $2`,
    [id, ACTIVE_FARM]
  );
  return rows[0] ?? null;
}
