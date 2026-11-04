"use server";

import { requireOwner } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { type ActionState, errorMessage, formValues, optInt, optStr } from "@/lib/forms";
import { reconcileManualEdit } from "@/lib/extraction/pipeline";

// Same backstop as egg-stock/actions.ts's assertNoteConsistent and
// pipeline.ts's assertAutoCorrectionNotesConsistent (2026-10-12 reason: a
// manual save must never leave a note contradicting the value it's paired
// with) — written against this table's own seven auto-correctable fields.
function assertNoteConsistent(
  groupName: string,
  checks: [number | null, number | null, string][],
  note: string | null
): void {
  for (const [original, current, fieldName] of checks) {
    if (original === null) continue;
    const marker = `${original} corrected to ${current}`;
    if (!note || !note.includes(marker)) {
      throw new Error(
        `${fieldName} on feed group "${groupName}" has an original value (${original}) recorded but no note says "${marker}" — refusing to save.`
      );
    }
  }
}

// Saves the day's group cards in one transaction: upsert each named group
// (blank group name = not entered, skipped), sync its linked-flock set
// (drives the consumed_bags cross-check — see migration 0008's design
// note), then run fn_validate_feed_bag_stock and store flagged/flag_reason.
// Records always save; a rule violation only flags, never blocks. A manual
// edit that changes a field away from whatever an earlier auto-correction
// saved for it clears that field's stale *_original/note pairing
// (reconcileManualEdit) — this screen can now show rows the new
// egg-ledger/feed-box auto-extraction already corrected.
export async function saveFeedBagStock(
  date: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireOwner();
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date");
    const groupCount = optInt(formData, "group_count") ?? 0;

    const namesInThisSubmission: string[] = [];
    for (let i = 0; i < groupCount; i++) {
      const name = optStr(formData, `group_${i}`);
      if (name) namesInThisSubmission.push(name);
    }
    const dupes = namesInThisSubmission.filter(
      (name, idx) => namesInThisSubmission.indexOf(name) !== idx
    );
    if (dupes.length > 0)
      throw new Error(
        `Two group cards are both named "${dupes[0]}" — each group can only appear once per day`
      );

    let savedCount = 0;
    await withTransaction(async (client) => {
      for (let i = 0; i < groupCount; i++) {
        const groupName = optStr(formData, `group_${i}`);
        if (!groupName) continue; // no name entered for this card yet

        const linkedFlockIds: string[] = [];
        const prefix = `flock_${i}_`;
        for (const key of formData.keys()) {
          if (key.startsWith(prefix)) linkedFlockIds.push(key.slice(prefix.length));
        }

        const opening = optInt(formData, `opening_${i}`);
        const produced = optInt(formData, `produced_${i}`);
        const total = optInt(formData, `total_${i}`);
        const consumed = optInt(formData, `consumed_${i}`);
        const mill = optInt(formData, `mill_${i}`);
        const shed = optInt(formData, `shed_${i}`);
        const closing = optInt(formData, `closing_${i}`);

        const { rows: existingRows } = await client.query(
          `SELECT opening_balance_bags, opening_balance_bags_original,
                  produced_bags, produced_bags_original,
                  total_bags, total_bags_original,
                  consumed_bags, consumed_bags_original,
                  mill_inventory_bags, mill_inventory_bags_original,
                  shed_inventory_bags, shed_inventory_bags_original,
                  closing_balance_bags, closing_balance_bags_original,
                  auto_correction_note
             FROM daily_feed_bag_stock
            WHERE farm_code = $1 AND flock_group = $2 AND date = $3 AND deleted_at IS NULL`,
          [ACTIVE_FARM, groupName, date]
        );
        const existing = existingRows[0] as
          | {
              opening_balance_bags: number | null; opening_balance_bags_original: number | null;
              produced_bags: number | null; produced_bags_original: number | null;
              total_bags: number | null; total_bags_original: number | null;
              consumed_bags: number | null; consumed_bags_original: number | null;
              mill_inventory_bags: number | null; mill_inventory_bags_original: number | null;
              shed_inventory_bags: number | null; shed_inventory_bags_original: number | null;
              closing_balance_bags: number | null; closing_balance_bags_original: number | null;
              auto_correction_note: string | null;
            }
          | undefined;

        let note: string | null = existing?.auto_correction_note ?? null;
        let openingOriginal = existing?.opening_balance_bags_original ?? null;
        let producedOriginal = existing?.produced_bags_original ?? null;
        let totalOriginal = existing?.total_bags_original ?? null;
        let consumedOriginal = existing?.consumed_bags_original ?? null;
        let millOriginal = existing?.mill_inventory_bags_original ?? null;
        let shedOriginal = existing?.shed_inventory_bags_original ?? null;
        let closingOriginal = existing?.closing_balance_bags_original ?? null;

        ({ original: openingOriginal, note } = reconcileManualEdit(openingOriginal, existing?.opening_balance_bags ?? null, opening, note));
        ({ original: producedOriginal, note } = reconcileManualEdit(producedOriginal, existing?.produced_bags ?? null, produced, note));
        ({ original: totalOriginal, note } = reconcileManualEdit(totalOriginal, existing?.total_bags ?? null, total, note));
        ({ original: consumedOriginal, note } = reconcileManualEdit(consumedOriginal, existing?.consumed_bags ?? null, consumed, note));
        ({ original: millOriginal, note } = reconcileManualEdit(millOriginal, existing?.mill_inventory_bags ?? null, mill, note));
        ({ original: shedOriginal, note } = reconcileManualEdit(shedOriginal, existing?.shed_inventory_bags ?? null, shed, note));
        ({ original: closingOriginal, note } = reconcileManualEdit(closingOriginal, existing?.closing_balance_bags ?? null, closing, note));

        assertNoteConsistent(
          groupName,
          [
            [openingOriginal, opening, "opening_balance_bags"],
            [producedOriginal, produced, "produced_bags"],
            [totalOriginal, total, "total_bags"],
            [consumedOriginal, consumed, "consumed_bags"],
            [millOriginal, mill, "mill_inventory_bags"],
            [shedOriginal, shed, "shed_inventory_bags"],
            [closingOriginal, closing, "closing_balance_bags"],
          ],
          note
        );

        const { rows } = await client.query(
          `INSERT INTO daily_feed_bag_stock
               (date, farm_code, flock_group,
                opening_balance_bags, opening_balance_bags_original,
                produced_bags, produced_bags_original,
                total_bags, total_bags_original,
                consumed_bags, consumed_bags_original,
                mill_inventory_bags, mill_inventory_bags_original,
                shed_inventory_bags, shed_inventory_bags_original,
                closing_balance_bags, closing_balance_bags_original,
                auto_correction_note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           ON CONFLICT (farm_code, flock_group, date) WHERE deleted_at IS NULL DO UPDATE SET
               opening_balance_bags = EXCLUDED.opening_balance_bags,
               opening_balance_bags_original = EXCLUDED.opening_balance_bags_original,
               produced_bags        = EXCLUDED.produced_bags,
               produced_bags_original = EXCLUDED.produced_bags_original,
               total_bags           = EXCLUDED.total_bags,
               total_bags_original  = EXCLUDED.total_bags_original,
               consumed_bags        = EXCLUDED.consumed_bags,
               consumed_bags_original = EXCLUDED.consumed_bags_original,
               mill_inventory_bags  = EXCLUDED.mill_inventory_bags,
               mill_inventory_bags_original = EXCLUDED.mill_inventory_bags_original,
               shed_inventory_bags  = EXCLUDED.shed_inventory_bags,
               shed_inventory_bags_original = EXCLUDED.shed_inventory_bags_original,
               closing_balance_bags = EXCLUDED.closing_balance_bags,
               closing_balance_bags_original = EXCLUDED.closing_balance_bags_original,
               auto_correction_note = EXCLUDED.auto_correction_note,
               reviewed_by_owner    = false
           RETURNING id`,
          [
            date, ACTIVE_FARM, groupName,
            opening, openingOriginal,
            produced, producedOriginal,
            total, totalOriginal,
            consumed, consumedOriginal,
            mill, millOriginal,
            shed, shedOriginal,
            closing, closingOriginal,
            note,
          ]
        );
        const groupId: number = rows[0].id;

        await client.query(
          `DELETE FROM daily_feed_bag_stock_flocks WHERE feed_bag_stock_id = $1`,
          [groupId]
        );
        for (const flockId of linkedFlockIds) {
          await client.query(
            `INSERT INTO daily_feed_bag_stock_flocks (feed_bag_stock_id, flock_internal_id)
             VALUES ($1, $2)`,
            [groupId, flockId]
          );
        }

        await client.query(
          `UPDATE daily_feed_bag_stock
              SET flagged = cardinality(v.reasons) > 0,
                  flag_reason = nullif(array_to_string(v.reasons, '; '), '')
             FROM (SELECT fn_validate_feed_bag_stock($1) AS reasons) v
            WHERE id = $1`,
          [groupId]
        );
        savedCount += 1;
      }

      if (savedCount === 0)
        throw new Error("Nothing to save — every group card is unnamed");
    });
  } catch (err) {
    return { error: errorMessage(err), values: formValues(formData) };
  }
  revalidatePath("/feed-bag-stock");
  redirect(`/feed-bag-stock?date=${date}&saved=1`);
}
