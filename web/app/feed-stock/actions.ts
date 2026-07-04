"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import {
  type ActionState,
  errorMessage,
  formValues,
  optInt,
  optNum,
  optStr,
} from "@/lib/forms";

// Saves the day's feed stock in one transaction. The form fields mirror the
// paper columns and units: Opening/Purchase/Closing arrive in QUINTALS
// (×100 to kg here — the schema stores kg only), Consumed arrives in kg as
// written. That same-page unit split is confirmed on the real register and
// is exactly why fn_validate_feed_stock's balance check exists; a mismatch
// flags the row, it never blocks the save.
export async function saveFeedStock(
  date: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date");
    const count = optInt(formData, "material_count") ?? 0;

    let savedCount = 0;
    await withTransaction(async (client) => {
      for (let i = 0; i < count; i++) {
        const material = optStr(formData, `material_${i}`);
        if (!material) continue;
        const openingQ = optNum(formData, `opening_q_${i}`);
        const purchaseQ = optNum(formData, `purchase_q_${i}`);
        const consumedKg = optNum(formData, `consumed_kg_${i}`);
        const closingQ = optNum(formData, `closing_q_${i}`);

        // Untouched material: no row for this date.
        if (
          openingQ === null &&
          purchaseQ === null &&
          consumedKg === null &&
          closingQ === null
        )
          continue;

        const { rows } = await client.query(
          `INSERT INTO feed_stock
               (date, farm_code, material_name, opening_balance_kg, purchase_kg,
                consumed_kg, closing_balance_kg)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (farm_code, material_name, date) DO UPDATE SET
               opening_balance_kg = EXCLUDED.opening_balance_kg,
               purchase_kg        = EXCLUDED.purchase_kg,
               consumed_kg        = EXCLUDED.consumed_kg,
               closing_balance_kg = EXCLUDED.closing_balance_kg,
               reviewed_by_owner  = false
           RETURNING id`,
          [
            date,
            ACTIVE_FARM,
            material,
            openingQ === null ? null : openingQ * 100,
            purchaseQ === null ? null : purchaseQ * 100,
            consumedKg,
            closingQ === null ? null : closingQ * 100,
          ]
        );

        await client.query(
          `UPDATE feed_stock
              SET flagged = cardinality(v.reasons) > 0,
                  flag_reason = nullif(array_to_string(v.reasons, '; '), '')
             FROM (SELECT fn_validate_feed_stock($1) AS reasons) v
            WHERE id = $1`,
          [rows[0].id]
        );
        savedCount += 1;
      }

      if (savedCount === 0)
        throw new Error("Nothing to save — every material row is blank");
    });
  } catch (err) {
    return { error: errorMessage(err), values: formValues(formData) };
  }
  revalidatePath("/feed-stock");
  redirect(`/feed-stock?date=${date}&saved=1`);
}
