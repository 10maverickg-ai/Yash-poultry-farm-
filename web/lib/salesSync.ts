import type { PoolClient } from "pg";
import type { EntryCategory, EggStockSection } from "./eggstock-types";
import { ACTIVE_FARM } from "./farm";
import { rateFor } from "./rates/lookup";
import { classifySale, salePrice, type SaleKind } from "./rates/parse";

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

// V5 F3: Farmfresh (big or small) vs local is decided by classifySale() —
// category, a "local" label, or a small lot of up to ~150 eggs (never Farmfresh).
// sales.transaction_type gained the member 'local' for it (migration 0033).
function transactionTypeFor(kind: SaleKind): string {
  return kind === "farmfresh" ? "sale_farmfresh" : "local";
}

// A generic ledger word ("Buy", "Sale", "local") says nothing about WHO bought;
// the buyer then reads "Farmfresh" / "Local", the way the existing rows do.
function buyerFor(kind: SaleKind, label: string): string {
  const b = buyerFromLabel(label);
  if (/^(buy|sale|local|l)$/i.test(b)) return kind === "farmfresh" ? "Farmfresh" : "Local";
  return kind === "farmfresh" && !/farm\s*fresh/i.test(b) ? "Farmfresh" : b;
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
    const qty = Math.abs(entry.amountEggsSigned);
    if (entry.linkedSaleId) {
      // An existing sale row is never repriced or re-typed here (the owner may
      // have set them): only the quantity/date/grade follow the ledger line, and
      // the amount follows the quantity at the row's own price.
      await client.query(
        `UPDATE sales SET date = $2, eggs_quantity = $3, grade = $4,
                amount = CASE WHEN price_per_unit IS NOT NULL THEN round($3::numeric * price_per_unit, 2) ELSE amount END
          WHERE id = $1`,
        [entry.linkedSaleId, date, qty, section]
      );
    } else {
      const kind = classifySale({ category: entry.category, label: entry.labelAsWritten, eggs: qty });
      // Price from that day's BAFTA rate; a day without its own rate reuses the
      // previous day's for up to 3 days ("rate not updated" on the Sales page);
      // beyond that the row is created unpriced rather than guessed.
      const rate = await rateFor(client, date);
      const price = rate ? salePrice(rate.rate, kind) : null;
      const { rows } = await client.query(
        `INSERT INTO sales (date, farm_code, source_ledger_entry_id, transaction_type, buyer_or_recipient, eggs_quantity, grade, price_per_unit, amount)
         VALUES ($1,$2,$3,$4::sales_transaction_type,$5,$6,$7,$8,$9) RETURNING id`,
        [date, farmCode, entry.id, transactionTypeFor(kind), buyerFor(kind, entry.labelAsWritten), qty, section, price, price != null ? Math.round(qty * price * 100) / 100 : null]
      );
      await client.query(`UPDATE daily_egg_stock_entries SET linked_sale_id = $2 WHERE id = $1`, [entry.id, rows[0].id]);
    }
  } else if (entry.linkedSaleId) {
    await client.query(`UPDATE daily_egg_stock_entries SET linked_sale_id = NULL WHERE id = $1`, [entry.id]);
    await client.query(`DELETE FROM sales WHERE id = $1`, [entry.linkedSaleId]);
  }
}
