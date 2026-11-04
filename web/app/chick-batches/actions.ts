"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { type ActionState, errorMessage, formValues, optDate, optInt, optStr } from "@/lib/forms";

// Holding place only — nothing here links to flocks. Once a batch gets a
// BAB number, the owner creates it in flocks via the normal "New flock"
// form and (not yet built) removes/marks this row done manually.
export async function createChickBatch(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const date = optDate(formData, "date");
    const shedCode = optStr(formData, "shed_code");
    if (!date) throw new Error("Date is required");
    if (!shedCode) throw new Error("Shed is required");

    const { rows } = await pool.query(
      `INSERT INTO chick_batch_log (farm_code, date, shed_code, total_birds,
                                    source_hatchery, notes)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [
        ACTIVE_FARM,
        date,
        shedCode,
        optInt(formData, "total_birds"),
        optStr(formData, "source_hatchery"),
        optStr(formData, "notes"),
      ]
    );

    await pool.query(
      `UPDATE chick_batch_log
          SET flagged = cardinality(v.reasons) > 0,
              flag_reason = nullif(array_to_string(v.reasons, '; '), '')
         FROM (SELECT fn_validate_chick_batch_log($1) AS reasons) v
        WHERE id = $1`,
      [rows[0].id]
    );
  } catch (err) {
    return { error: errorMessage(err), values: formValues(formData) };
  }
  revalidatePath("/chick-batches");
  redirect("/chick-batches?saved=1");
}
