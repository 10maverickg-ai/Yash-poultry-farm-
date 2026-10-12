"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { ENTRY_CATEGORIES, EGG_STOCK_SECTIONS, type EggStockSection } from "@/lib/eggstock-types";
import { reconcileManualEdit } from "@/lib/extraction/pipeline";
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

// Same backstop as pipeline.ts's assertAutoCorrectionNotesConsistent (and
// for the same 2026-10-12 reason — a manual save must never leave a note
// contradicting the value it's paired with) written against this table's
// own four auto-correctable summary fields directly, rather than shoehorning
// them into Daily Production's differently-named field shape.
function assertNoteConsistent(
  section: string,
  checks: [number | null, number | null, string][],
  note: string | null
): void {
  for (const [original, current, fieldName] of checks) {
    if (original === null) continue;
    const marker = `${original} corrected to ${current}`;
    if (!note || !note.includes(marker)) {
      throw new Error(
        `${fieldName} on the ${section} egg ledger has an original value (${original}) recorded but no note says "${marker}" — refusing to save.`
      );
    }
  }
}

// Saves BOTH of the day's two parallel ledgers (owner request, 2026-10-19 —
// "big" under BAB-1..7, "small" under BAB-8..10; see migration 0020) in one
// transaction, one section at a time, each independently skippable if left
// entirely blank. Per section:
//   1. upsert the summary row (farm_code, date, section)
//   2. sync entries by sequence_order — updates in place so a linked sale
//      (and any manually entered price on it) survives edits to other lines
//   3. sync which flocks this section covers (drives the production-vs-
//      Daily-Production cross-check, same pattern as feed_bag_stock)
//   4. sale-category lines auto-generate/refresh their sales row; a line that
//      stops being a sale drops its sales row (local_sale/labour_take never
//      do — the owner's instruction not to write to sales from the new
//      auto-extraction path applies here too: only the pre-existing 'sale'
//      category keeps this pre-existing behavior)
//   5. recompute running balances (system-owned, never read from paper)
//   6. run fn_validate_egg_stock_summary and store flagged/flag_reason —
//      the record saves either way, mismatches go to the flag banner
// A manual edit that changes a field away from whatever an earlier
// auto-correction saved for it clears that field's stale *_original/note
// pairing (reconcileManualEdit) — same fix as the 2026-10-12 BAB-2/id-243
// incident on the Daily Production entry screen, applied here too since
// this screen can now also show auto-corrected ledger rows.
export async function saveEggStock(
  date: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date");

    const sectionInputs = new Map<
      EggStockSection,
      {
        lines: { label: string; category: string; amount: number }[];
        opening: number | null;
        production: number | null;
        totalLine: number | null;
        closing: number | null;
        g13: number | null;
        g14: number | null;
        g15: number | null;
        g15p: number | null;
        flockIds: string[];
        blank: boolean;
      }
    >();

    for (const section of EGG_STOCK_SECTIONS) {
      const p = (name: string) => `${section}_${name}`;
      const lineCount = optInt(formData, p("line_count")) ?? 0;
      const lines: { label: string; category: string; amount: number }[] = [];
      for (let i = 0; i < lineCount; i++) {
        const label = optStr(formData, p(`label_${i}`));
        const amount = optInt(formData, p(`amount_${i}`));
        const category = optStr(formData, p(`category_${i}`));
        if (label === null && amount === null) continue; // blank line, ignore
        if (label === null || amount === null)
          throw new Error(`${section} ledger line ${i + 1} needs both a label and an amount`);
        if (!category || !(ENTRY_CATEGORIES as readonly string[]).includes(category))
          throw new Error(`${section} ledger line ${i + 1} ("${label}") needs a category`);
        lines.push({ label, category, amount });
      }

      const opening = optInt(formData, p("opening_balance_eggs"));
      const production = optInt(formData, p("total_eggs_produced"));
      const totalLine = optInt(formData, p("total_line_eggs"));
      const closing = optInt(formData, p("closing_balance_eggs"));
      const g13 = optInt(formData, p("grade_13_eggs"));
      const g14 = optInt(formData, p("grade_14_eggs"));
      const g15 = optInt(formData, p("grade_15_eggs"));
      const g15p = optInt(formData, p("grade_15plus_eggs"));

      const flockIds: string[] = [];
      const prefix = p("flock_");
      for (const key of formData.keys()) {
        if (key.startsWith(prefix)) flockIds.push(key.slice(prefix.length));
      }

      const blank =
        opening === null && production === null && totalLine === null && closing === null &&
        g13 === null && g14 === null && g15 === null && g15p === null && lines.length === 0;

      sectionInputs.set(section, { lines, opening, production, totalLine, closing, g13, g14, g15, g15p, flockIds, blank });
    }

    if ([...sectionInputs.values()].every((s) => s.blank))
      throw new Error("Nothing to save — both ledgers are blank");

    await withTransaction(async (client) => {
      for (const section of EGG_STOCK_SECTIONS) {
        const input = sectionInputs.get(section)!;
        if (input.blank) continue;

        const { rows: existingSummaryRows } = await client.query(
          `SELECT opening_balance_eggs, opening_balance_eggs_original,
                  total_eggs_produced, total_eggs_produced_original,
                  total_line_eggs, total_line_eggs_original,
                  closing_balance_eggs, closing_balance_eggs_original,
                  auto_correction_note
             FROM daily_egg_stock_summary
            WHERE farm_code = $1 AND date = $2 AND section = $3 AND deleted_at IS NULL`,
          [ACTIVE_FARM, date, section]
        );
        const existingSummary = existingSummaryRows[0] as
          | {
              opening_balance_eggs: number | null; opening_balance_eggs_original: number | null;
              total_eggs_produced: number | null; total_eggs_produced_original: number | null;
              total_line_eggs: number | null; total_line_eggs_original: number | null;
              closing_balance_eggs: number | null; closing_balance_eggs_original: number | null;
              auto_correction_note: string | null;
            }
          | undefined;

        let note: string | null = existingSummary?.auto_correction_note ?? null;
        let openingOriginal = existingSummary?.opening_balance_eggs_original ?? null;
        let productionOriginal = existingSummary?.total_eggs_produced_original ?? null;
        let totalLineOriginal = existingSummary?.total_line_eggs_original ?? null;
        let closingOriginal = existingSummary?.closing_balance_eggs_original ?? null;

        ({ original: openingOriginal, note } = reconcileManualEdit(
          openingOriginal, existingSummary?.opening_balance_eggs ?? null, input.opening, note
        ));
        ({ original: productionOriginal, note } = reconcileManualEdit(
          productionOriginal, existingSummary?.total_eggs_produced ?? null, input.production, note
        ));
        ({ original: totalLineOriginal, note } = reconcileManualEdit(
          totalLineOriginal, existingSummary?.total_line_eggs ?? null, input.totalLine, note
        ));
        ({ original: closingOriginal, note } = reconcileManualEdit(
          closingOriginal, existingSummary?.closing_balance_eggs ?? null, input.closing, note
        ));

        assertNoteConsistent(
          section,
          [
            [openingOriginal, input.opening, "opening_balance_eggs"],
            [productionOriginal, input.production, "total_eggs_produced"],
            [totalLineOriginal, input.totalLine, "total_line_eggs"],
            [closingOriginal, input.closing, "closing_balance_eggs"],
          ],
          note
        );

        const { rows: sumRows } = await client.query(
          `INSERT INTO daily_egg_stock_summary
               (date, farm_code, section, opening_balance_eggs, opening_balance_eggs_original,
                total_eggs_produced, total_eggs_produced_original,
                total_line_eggs, total_line_eggs_original,
                grade_13_eggs, grade_14_eggs, grade_15_eggs, grade_15plus_eggs,
                closing_balance_eggs, closing_balance_eggs_original, auto_correction_note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (farm_code, date, section) WHERE deleted_at IS NULL DO UPDATE SET
               opening_balance_eggs = EXCLUDED.opening_balance_eggs,
               opening_balance_eggs_original = EXCLUDED.opening_balance_eggs_original,
               total_eggs_produced  = EXCLUDED.total_eggs_produced,
               total_eggs_produced_original = EXCLUDED.total_eggs_produced_original,
               total_line_eggs      = EXCLUDED.total_line_eggs,
               total_line_eggs_original = EXCLUDED.total_line_eggs_original,
               grade_13_eggs        = EXCLUDED.grade_13_eggs,
               grade_14_eggs        = EXCLUDED.grade_14_eggs,
               grade_15_eggs        = EXCLUDED.grade_15_eggs,
               grade_15plus_eggs    = EXCLUDED.grade_15plus_eggs,
               closing_balance_eggs = EXCLUDED.closing_balance_eggs,
               closing_balance_eggs_original = EXCLUDED.closing_balance_eggs_original,
               auto_correction_note = EXCLUDED.auto_correction_note,
               reviewed_by_owner    = false
           RETURNING id`,
          [
            date, ACTIVE_FARM, section,
            input.opening, openingOriginal,
            input.production, productionOriginal,
            input.totalLine, totalLineOriginal,
            input.g13, input.g14, input.g15, input.g15p,
            input.closing, closingOriginal, note,
          ]
        );
        const summaryId: number = sumRows[0].id;

        // --- sync entries by sequence_order -------------------------------
        const { rows: existingEntries } = await client.query(
          `SELECT id, sequence_order, linked_sale_id, amount_eggs,
                  amount_eggs_original, auto_correction_note
             FROM daily_egg_stock_entries
            WHERE egg_stock_summary_id = $1
            ORDER BY sequence_order`,
          [summaryId]
        );

        for (let i = 0; i < input.lines.length; i++) {
          const seq = i + 1;
          const line = input.lines[i];
          const old = existingEntries.find((e) => e.sequence_order === seq);
          if (old) {
            const { original: amtOriginal, note: entryNote } = reconcileManualEdit(
              old.amount_eggs_original, old.amount_eggs, line.amount, old.auto_correction_note
            );
            await client.query(
              `UPDATE daily_egg_stock_entries
                  SET label_as_written = $2, category = $3, amount_eggs = $4,
                      amount_eggs_original = $5, auto_correction_note = $6
                WHERE id = $1`,
              [old.id, line.label, line.category, line.amount, amtOriginal, entryNote]
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
        const doomed = existingEntries.filter((e) => e.sequence_order > input.lines.length);
        if (doomed.length > 0) {
          const doomedIds = doomed.map((e) => e.id);
          await client.query(`UPDATE daily_egg_stock_entries SET linked_sale_id = NULL WHERE id = ANY($1)`, [doomedIds]);
          await client.query(`DELETE FROM sales WHERE source_ledger_entry_id = ANY($1)`, [doomedIds]);
          await client.query(`DELETE FROM daily_egg_stock_entries WHERE id = ANY($1)`, [doomedIds]);
        }

        // --- which flocks this section covers (drives check 4) -----------
        await client.query(`DELETE FROM daily_egg_stock_summary_flocks WHERE egg_stock_summary_id = $1`, [summaryId]);
        for (const flockId of input.flockIds) {
          await client.query(
            `INSERT INTO daily_egg_stock_summary_flocks (egg_stock_summary_id, flock_internal_id) VALUES ($1, $2)`,
            [summaryId, flockId]
          );
        }

        // --- sales sync per surviving entry (category = 'sale' only, same
        // pre-existing behavior; local_sale/labour_take never generate a
        // sales row) --------------------------------------------------
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
              await client.query(
                `UPDATE sales SET date = $2, buyer_or_recipient = $3, eggs_quantity = $4 WHERE id = $1`,
                [entry.linked_sale_id, date, buyer, qty]
              );
            } else {
              const { rows: saleRows } = await client.query(
                `INSERT INTO sales (date, farm_code, source_ledger_entry_id,
                                    transaction_type, buyer_or_recipient, eggs_quantity)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id`,
                [date, ACTIVE_FARM, entry.id, inferTransactionType(entry.label_as_written), buyer, qty]
              );
              await client.query(`UPDATE daily_egg_stock_entries SET linked_sale_id = $2 WHERE id = $1`, [entry.id, saleRows[0].id]);
            }
          } else if (entry.linked_sale_id) {
            await client.query(`UPDATE daily_egg_stock_entries SET linked_sale_id = NULL WHERE id = $1`, [entry.id]);
            await client.query(`DELETE FROM sales WHERE id = $1`, [entry.linked_sale_id]);
          }
        }

        // --- system-owned running balances + flag rules ---------------------
        await client.query(`SELECT fn_recompute_egg_stock_running_balances($1)`, [summaryId]);
        await client.query(
          `UPDATE daily_egg_stock_summary
              SET flagged = cardinality(v.reasons) > 0,
                  flag_reason = nullif(array_to_string(v.reasons, '; '), '')
             FROM (SELECT fn_validate_egg_stock_summary($1) AS reasons) v
            WHERE id = $1`,
          [summaryId]
        );
      }
    });
  } catch (err) {
    return { error: errorMessage(err), values: formValues(formData) };
  }
  revalidatePath("/egg-stock");
  revalidatePath("/sales");
  redirect(`/egg-stock?date=${date}&saved=1`);
}
