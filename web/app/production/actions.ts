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

// Saves the whole day's sheet in one transaction: one upsert per flock that
// has any data entered (a fully blank flock card = not entered yet, skipped —
// distinct from a PARTIALLY blank card, whose empty fields the validation
// function flags as missing, mirroring the spec's blank-in-photo rule).
// After each upsert the spec's flag rules run via fn_validate_daily_production
// and the row is marked flagged/flag_reason — saved either way, never rejected.
export async function saveProduction(
  date: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date");

    // Collect flock ids present on the sheet from the hidden label fields.
    const flockIds: string[] = [];
    for (const key of formData.keys()) {
      if (key.startsWith("label_")) flockIds.push(key.slice("label_".length));
    }
    if (flockIds.length === 0) throw new Error("No flocks on this sheet");

    let savedCount = 0;
    await withTransaction(async (client) => {
      for (const flockId of flockIds) {
        const mortality = optInt(formData, `mortality_${flockId}`);
        const feedBags = optInt(formData, `feed_bags_${flockId}`);
        const eggsTotal = optInt(formData, `eggs_total_${flockId}`);
        const birdPopulation = optInt(formData, `bird_population_${flockId}`);
        const hdPercent = optNum(formData, `hd_percent_${flockId}`);

        // Fully blank card: nothing entered for this flock — skip.
        if (
          mortality === null &&
          feedBags === null &&
          eggsTotal === null &&
          birdPopulation === null &&
          hdPercent === null
        )
          continue;

        const { rows } = await client.query(
          `INSERT INTO daily_production
               (date, farm_code, flock_internal_id, display_label_as_written,
                shed_code, mortality, feed_bags, eggs_total, bird_population,
                hd_percent)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (flock_internal_id, date) DO UPDATE SET
               display_label_as_written = EXCLUDED.display_label_as_written,
               shed_code       = EXCLUDED.shed_code,
               mortality       = EXCLUDED.mortality,
               feed_bags       = EXCLUDED.feed_bags,
               eggs_total      = EXCLUDED.eggs_total,
               bird_population = EXCLUDED.bird_population,
               hd_percent      = EXCLUDED.hd_percent
           RETURNING id`,
          [
            date,
            ACTIVE_FARM,
            flockId,
            optStr(formData, `label_${flockId}`),
            optStr(formData, `shed_${flockId}`),
            mortality,
            feedBags,
            eggsTotal,
            birdPopulation,
            hdPercent,
          ]
        );

        // Run the spec's flag rules; record saved either way.
        await client.query(
          `UPDATE daily_production
              SET flagged = cardinality(v.reasons) > 0,
                  flag_reason = nullif(array_to_string(v.reasons, '; '), '')
             FROM (SELECT fn_validate_daily_production($1) AS reasons) v
            WHERE id = $1`,
          [rows[0].id]
        );
        savedCount += 1;
      }

      if (savedCount === 0)
        throw new Error("Nothing to save — all flock cards are blank");

      // Also update each saved flock's latest known population (mirrors the
      // schema note: current_bird_count is the latest daily figure).
      await client.query(
        `UPDATE flocks f
            SET current_bird_count = dp.bird_population
           FROM daily_production dp
          WHERE dp.flock_internal_id = f.flock_internal_id
            AND dp.date = $1
            AND dp.bird_population IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM daily_production later
                 WHERE later.flock_internal_id = f.flock_internal_id
                   AND later.date > $1 AND later.bird_population IS NOT NULL
            )`,
        [date]
      );
    });
  } catch (err) {
    return { error: errorMessage(err), values: formValues(formData) };
  }
  revalidatePath("/production");
  redirect(`/production?date=${date}&saved=1`);
}
