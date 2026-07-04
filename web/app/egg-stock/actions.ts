"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { ENTRY_CATEGORIES } from "@/lib/eggstock-types";
import {
  type ActionState,
  errorMessage,
  formValues,
  optInt,
  optStr,
} from "@/lib/forms";

// "Name(-)" / "Name(+)" -> "Name": the buyer is the label minus its +/-
// marker (the sign already lives in amount_eggs).
function buyerFromLabel(label: string): string {
  return label.replace(/\(\s*[+-]\s*\)\s*$/, "").trim() || label;
}

// Phase 2 stopgap inference (spec: AI classifies in Phase 3). Farm Fresh is
// the main QC channel; every other named buyer is a wholesaler. The owner can
// change it on the sale's edit screen.
function inferTransactionType(label: string): string {
  return /farm\s*fresh/i.test(label) ? "sale_farmfresh" : "sale_wholesaler";
}

// Saves the day's ledger in one transaction:
//   1. upsert the summary (one per farm per day)
//   2. sync entries by sequence_order — updates in place so a linked sale
//      (and any manually entered price on it) survives edits to other lines
//   3. sale-category lines auto-generate/refresh their sales row; a line that
//      stops being a sale drops its sales row
//   4. recompute running balances (system-owned, never read from paper)
//   5. run fn_validate_egg_stock_summary and store flagged/flag_reason —
//      the record saves either way, mismatches go to the flag banner
export async function saveEggStock(
  date: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date");

    const lineCount = optInt(formData, "line_count") ?? 0;
    const lines: { label: string; category: string; amount: number }[] = [];
    for (let i = 0; i < lineCount; i++) {
      const label = optStr(formData, `label_${i}`);
      const amount = optInt(formData, `amount_${i}`);
      const category = optStr(formData, `category_${i}`);
      if (label === null && amount === null) continue; // blank line, ignore
      if (label === null || amount === null)
        throw new Error(`Ledger line ${i + 1} needs both a label and an amount`);
      if (!category || !(ENTRY_CATEGORIES as readonly string[]).includes(category))
        throw new Error(`Ledger line ${i + 1} ("${label}") needs a category`);
      lines.push({ label, category, amount });
    }

    const summaryValues = {
      total: optInt(formData, "total_eggs_produced"),
      g13: optInt(formData, "grade_13_eggs"),
      g14: optInt(formData, "grade_14_eggs"),
      g15: optInt(formData, "grade_15_eggs"),
      g15p: optInt(formData, "grade_15plus_eggs"),
      closing: optInt(formData, "closing_balance_eggs"),
    };
    if (
      Object.values(summaryValues).every((v) => v === null) &&
      lines.length === 0
    )
      throw new Error("Nothing to save — the ledger is blank");

    await withTransaction(async (client) => {
      const { rows: sumRows } = await client.query(
        `INSERT INTO daily_egg_stock_summary
             (date, farm_code, total_eggs_produced, grade_13_eggs, grade_14_eggs,
              grade_15_eggs, grade_15plus_eggs, closing_balance_eggs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (farm_code, date) DO UPDATE SET
             total_eggs_produced = EXCLUDED.total_eggs_produced,
             grade_13_eggs       = EXCLUDED.grade_13_eggs,
             grade_14_eggs       = EXCLUDED.grade_14_eggs,
             grade_15_eggs       = EXCLUDED.grade_15_eggs,
             grade_15plus_eggs   = EXCLUDED.grade_15plus_eggs,
             closing_balance_eggs = EXCLUDED.closing_balance_eggs
         RETURNING id`,
        [
          date,
          ACTIVE_FARM,
          summaryValues.total,
          summaryValues.g13,
          summaryValues.g14,
          summaryValues.g15,
          summaryValues.g15p,
          summaryValues.closing,
        ]
      );
      const summaryId: number = sumRows[0].id;

      // --- sync entries by sequence_order -------------------------------
      const { rows: existing } = await client.query(
        `SELECT id, sequence_order, linked_sale_id
           FROM daily_egg_stock_entries
          WHERE egg_stock_summary_id = $1
          ORDER BY sequence_order`,
        [summaryId]
      );

      for (let i = 0; i < lines.length; i++) {
        const seq = i + 1;
        const line = lines[i];
        const old = existing.find((e) => e.sequence_order === seq);
        if (old) {
          await client.query(
            `UPDATE daily_egg_stock_entries
                SET label_as_written = $2, category = $3, amount_eggs = $4
              WHERE id = $1`,
            [old.id, line.label, line.category, line.amount]
          );
        } else {
          await client.query(
            `INSERT INTO daily_egg_stock_entries
                 (egg_stock_summary_id, sequence_order, label_as_written,
                  category, amount_eggs)
             VALUES ($1, $2, $3, $4, $5)`,
            [summaryId, seq, line.label, line.category, line.amount]
          );
        }
      }

      // Drop trailing entries beyond the new line count (and their sales).
      const doomed = existing.filter((e) => e.sequence_order > lines.length);
      if (doomed.length > 0) {
        const doomedIds = doomed.map((e) => e.id);
        await client.query(
          `UPDATE daily_egg_stock_entries SET linked_sale_id = NULL
            WHERE id = ANY($1)`,
          [doomedIds]
        );
        await client.query(
          `DELETE FROM sales WHERE source_ledger_entry_id = ANY($1)`,
          [doomedIds]
        );
        await client.query(
          `DELETE FROM daily_egg_stock_entries WHERE id = ANY($1)`,
          [doomedIds]
        );
      }

      // --- sales sync per surviving entry --------------------------------
      const { rows: current } = await client.query(
        `SELECT id, label_as_written, category, amount_eggs, linked_sale_id
           FROM daily_egg_stock_entries
          WHERE egg_stock_summary_id = $1
          ORDER BY sequence_order`,
        [summaryId]
      );
      for (const entry of current) {
        if (entry.category === "sale") {
          const buyer = buyerFromLabel(entry.label_as_written);
          const qty = Math.abs(entry.amount_eggs);
          if (entry.linked_sale_id) {
            // Refresh derived fields; keep owner-edited type/grade/price.
            await client.query(
              `UPDATE sales SET date = $2, buyer_or_recipient = $3, eggs_quantity = $4
                WHERE id = $1`,
              [entry.linked_sale_id, date, buyer, qty]
            );
          } else {
            const { rows: saleRows } = await client.query(
              `INSERT INTO sales (date, farm_code, source_ledger_entry_id,
                                  transaction_type, buyer_or_recipient, eggs_quantity)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING id`,
              [
                date,
                ACTIVE_FARM,
                entry.id,
                inferTransactionType(entry.label_as_written),
                buyer,
                qty,
              ]
            );
            await client.query(
              `UPDATE daily_egg_stock_entries SET linked_sale_id = $2 WHERE id = $1`,
              [entry.id, saleRows[0].id]
            );
          }
        } else if (entry.linked_sale_id) {
          // No longer a sale — drop the derived row.
          await client.query(
            `UPDATE daily_egg_stock_entries SET linked_sale_id = NULL WHERE id = $1`,
            [entry.id]
          );
          await client.query(`DELETE FROM sales WHERE id = $1`, [
            entry.linked_sale_id,
          ]);
        }
      }

      // --- system-owned running balances + flag rules ---------------------
      await client.query(`SELECT fn_recompute_egg_stock_running_balances($1)`, [
        summaryId,
      ]);
      await client.query(
        `UPDATE daily_egg_stock_summary
            SET flagged = cardinality(v.reasons) > 0,
                flag_reason = nullif(array_to_string(v.reasons, '; '), '')
           FROM (SELECT fn_validate_egg_stock_summary($1) AS reasons) v
          WHERE id = $1`,
        [summaryId]
      );
    });
  } catch (err) {
    return { error: errorMessage(err), values: formValues(formData) };
  }
  revalidatePath("/egg-stock");
  revalidatePath("/sales");
  redirect(`/egg-stock?date=${date}&saved=1`);
}
