"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { type ActionState, errorMessage, formValues, optInt, optStr } from "@/lib/forms";

// Saves the day's group cards in one transaction: upsert each named group
// (blank group name = not entered, skipped), sync its linked-flock set
// (drives the consumed_bags cross-check — see migration 0008's design
// note), then run fn_validate_feed_bag_stock and store flagged/flag_reason.
// Records always save; a rule violation only flags, never blocks.
export async function saveFeedBagStock(
  date: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
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

        const { rows } = await client.query(
          `INSERT INTO daily_feed_bag_stock
               (date, farm_code, flock_group, opening_balance_bags, produced_bags,
                total_bags, consumed_bags, mill_inventory_bags, shed_inventory_bags,
                closing_balance_bags)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (farm_code, flock_group, date) DO UPDATE SET
               opening_balance_bags = EXCLUDED.opening_balance_bags,
               produced_bags        = EXCLUDED.produced_bags,
               total_bags           = EXCLUDED.total_bags,
               consumed_bags        = EXCLUDED.consumed_bags,
               mill_inventory_bags  = EXCLUDED.mill_inventory_bags,
               shed_inventory_bags  = EXCLUDED.shed_inventory_bags,
               closing_balance_bags = EXCLUDED.closing_balance_bags,
               reviewed_by_owner    = false
           RETURNING id`,
          [
            date,
            ACTIVE_FARM,
            groupName,
            optInt(formData, `opening_${i}`),
            optInt(formData, `produced_${i}`),
            optInt(formData, `total_${i}`),
            optInt(formData, `consumed_${i}`),
            optInt(formData, `mill_${i}`),
            optInt(formData, `shed_${i}`),
            optInt(formData, `closing_${i}`),
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
