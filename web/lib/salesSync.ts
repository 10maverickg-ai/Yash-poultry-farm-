import type { PoolClient } from "pg";
import type { EntryCategory, EggStockSection } from "./eggstock-types";
import { ACTIVE_FARM } from "./farm";
import { rateFor } from "./rates/lookup";

// Shared between the manual Egg Stock entry screen (app/egg-stock/actions.ts)
// and the photo-upload pipeline (lib/extraction/writeLedgerFeed.ts) — owner
// request, 2026-10-19: "keep new sales rows auto-created from future ledger
// lines". Before this, that logic lived only in the manual screen — the
// real photo-upload path (what every real upload actually uses) never
// created a `sales` row at all, a gap that hadn't yet bitten only because
// no real upload has happened since August. It also only recognized the
// 'sale' category (Farmfresh) — a 'local_sale' deduction (a named local
// buyer) never got a sales row either, even on the manual screen, which is
// why the August backfill (which does cover local sales) used its own,
// separate logic rather than this code.
//
// A deduction categorized 'sale' or 'local_sale' gets a sales row, kept in
// sync on every re-save; anything else that previously had one loses the
// link and that row is deleted — driven by the entry's CURRENT category,
// never whatever it used to be.

function buyerFromLabel(label: string): string {
  return label.replace(/\(\s*[+-]\s*\)\s*$/, "").trim() || label;
}

// Phase 2 stopgap inference (spec: AI classifies in Phase 3). 'sale' is
// specifically defined (see the extraction prompt) as a sale TO Farmfresh;
// a label that doesn't actually say so is still presumed a wholesaler
// rather than mislabeled. sales.transaction_type is a Postgres ENUM
// (sale_farmfresh | sale_wholesaler | gift | staff_allocation | other) —
// there is no 'local_sale' member, so a 'local_sale' ledger category maps
// to 'other', exactly matching the convention the August backfill already
// used for the same case (verified against the live enum and the real
// backfilled rows before writing this).
function inferTransactionType(category: EntryCategory | null, label: string): string {
  if (category === "sale") return /farm\s*fresh/i.test(label) ? "sale_farmfresh" : "sale_wholesaler";
  return "other";
}

export interface LedgerEntryForSalesSync {
  id: number;
  category: EntryCategory | null;
  labelAsWritten: string;
  // Signed, as stored in daily_egg_stock_entries.amount_eggs (deductions
  // negative) — this function takes the absolute value itself.
  amountEggsSigned: number;
  linkedSaleId: number | null;
}

export async function syncSaleForEntry(
  client: PoolClient,
  entry: LedgerEntryForSalesSync,
  date: string,
  section: EggStockSection,
  farmCode: string = ACTIVE_FARM
): Promise<void> {
  const isSale = entry.category === "sale" || entry.category === "local_sale";
  if (isSale) {
    const buyer = buyerFromLabel(entry.labelAsWritten);
    const qty = Math.abs(entry.amountEggsSigned);
    const transactionType = inferTransactionType(entry.category, entry.labelAsWritten);
    if (entry.linkedSaleId) {
      await client.query(
        `UPDATE sales SET date = $2, buyer_or_recipient = $3, eggs_quantity = $4, transaction_type = $5, grade = $6,
                amount = CASE WHEN price_per_unit IS NOT NULL THEN round($4::numeric * price_per_unit, 2) ELSE amount END
          WHERE id = $1`,
        [entry.linkedSaleId, date, buyer, qty, transactionType, section]
      );
    } else {
      // Price from that day's BAFTA rate (big/small grade); a day without its
      // own rate reuses the previous day's for up to 3 days ("rate not
      // updated" on the Sales page); beyond that the row is created unpriced
      // rather than guessed.
      const rate = await rateFor(client, date);
      const price = rate ? (section === "big" ? rate.big : rate.small) : null;
      const { rows } = await client.query(
        `INSERT INTO sales (date, farm_code, source_ledger_entry_id, transaction_type, buyer_or_recipient, eggs_quantity, grade, price_per_unit, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [date, farmCode, entry.id, transactionType, buyer, qty, section, price, price != null ? Math.round(qty * price * 100) / 100 : null]
      );
      await client.query(`UPDATE daily_egg_stock_entries SET linked_sale_id = $2 WHERE id = $1`, [entry.id, rows[0].id]);
    }
  } else if (entry.linkedSaleId) {
    await client.query(`UPDATE daily_egg_stock_entries SET linked_sale_id = NULL WHERE id = $1`, [entry.id]);
    await client.query(`DELETE FROM sales WHERE id = $1`, [entry.linkedSaleId]);
  }
}
