import type { PoolClient } from "pg";
import { pool, withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { rateNumbers } from "./parse";
import { syncSaleForEntry } from "@/lib/salesSync";
import type { EntryCategory, EggStockSection } from "@/lib/eggstock-types";

export interface StoredRate {
  date: string;
  bafta: number; // effective per-egg rate as stored (after subsidy)
  big: number | null;
  small: number | null;
  per100: number | null;
  subsidyPaise: number;
  original: string | null;
  source: string | null;
}

export { rateFor, CARRY_DAYS } from "./lookup";
export type { RateForDay } from "./lookup";

export async function listRates(limit = 60): Promise<StoredRate[]> {
  const { rows } = await pool.query(
    `SELECT date, bafta_rate, big_rate, small_rate, rate_per_100, subsidy_paise, original_text, source
       FROM daily_egg_rates ORDER BY date DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    date: r.date,
    bafta: Number(r.bafta_rate),
    big: r.big_rate != null ? Number(r.big_rate) : null,
    small: r.small_rate != null ? Number(r.small_rate) : null,
    per100: r.rate_per_100 != null ? Number(r.rate_per_100) : null,
    subsidyPaise: r.subsidy_paise ?? 0,
    original: r.original_text,
    source: r.source,
  }));
}

export async function existingRateDates(dates: string[]): Promise<Map<string, number>> {
  if (dates.length === 0) return new Map();
  const { rows } = await pool.query(`SELECT date, bafta_rate FROM daily_egg_rates WHERE date = ANY($1::date[])`, [dates]);
  return new Map(rows.map((r) => [r.date, Number(r.bafta_rate)]));
}

export interface RateToSave {
  date: string;
  per100: number;
  subsidyPaise: number;
  original: string;
  dateInMessage: string | null;
}

/**
 * Saves rates (replacing the same day's rate if there is one) and then
 * creates the missing sales rows for those days from the ledger lines.
 * Existing sales rows are never duplicated or repriced here.
 */
export async function saveRates(entries: RateToSave[]): Promise<{ saved: number; salesCreated: number }> {
  let salesCreated = 0;
  await withTransaction(async (client) => {
    for (const e of entries) {
      const n = rateNumbers(e.per100, e.subsidyPaise);
      await client.query(
        `INSERT INTO daily_egg_rates
           (date, bafta_rate, big_rate, small_rate, source, rate_per_100, subsidy_paise, original_text, date_in_message, carried_forward)
         VALUES ($1,$2,$3,$4,'pasted rate message',$5,$6,$7,$8,false)
         ON CONFLICT (date) DO UPDATE SET
           bafta_rate = EXCLUDED.bafta_rate, big_rate = EXCLUDED.big_rate, small_rate = EXCLUDED.small_rate,
           source = EXCLUDED.source, rate_per_100 = EXCLUDED.rate_per_100, subsidy_paise = EXCLUDED.subsidy_paise,
           original_text = EXCLUDED.original_text, date_in_message = EXCLUDED.date_in_message, carried_forward = false`,
        [e.date, n.effective, n.big, n.small, e.per100, e.subsidyPaise, e.original, e.dateInMessage]
      );
    }
    for (const e of entries) salesCreated += await createMissingSalesForDate(client, e.date);
  });
  return { saved: entries.length, salesCreated };
}

/** Creates a sales row for every ledger sale/local_sale line of `date` that has none yet. */
export async function createMissingSalesForDate(client: PoolClient, date: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT e.id, e.category, e.label_as_written, e.amount_eggs, e.linked_sale_id, s.section
       FROM daily_egg_stock_entries e
       JOIN daily_egg_stock_summary s ON s.id = e.egg_stock_summary_id
      WHERE s.farm_code = $1 AND s.date = $2 AND s.deleted_at IS NULL
        AND e.category IN ('sale','local_sale') AND e.linked_sale_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM sales x WHERE x.source_ledger_entry_id = e.id)
      ORDER BY e.id`,
    [ACTIVE_FARM, date]
  );
  for (const r of rows) {
    await syncSaleForEntry(
      client,
      { id: Number(r.id), category: r.category as EntryCategory, labelAsWritten: r.label_as_written, amountEggsSigned: r.amount_eggs, linkedSaleId: null },
      date,
      r.section as EggStockSection
    );
  }
  return rows.length;
}
