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
import {
  assertAutoCorrectionNotesConsistent,
  reconcileManualEdit,
} from "@/lib/extraction/pipeline";
import { checkNextDayChainStillHolds, stripNextDayChainFlag } from "@/lib/extraction/nextDayRecheck";

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

        // Owner report, 2026-10-12, production: BAB-2, 2026-08-07 (id 243)
        // — the owner edited bird_population back to 15557 on this screen;
        // the save below only ever touched the plain field columns, so
        // bird_population_original (15557) and auto_correction_note
        // ("...15557 corrected to 15536...") from the earlier automatic
        // correction were left completely untouched, producing a saved
        // row whose own note describes a correction that was never
        // applied. A manual save here is the owner asserting ground truth
        // directly — fetch whatever was saved before so any field being
        // CHANGED away from it can have its now-stale `*_original`/note
        // pairing cleared rather than left to contradict the new value
        // (see pipeline.ts's reconcileManualEdit).
        const { rows: existingRows } = await client.query(
          `SELECT mortality, mortality_original, eggs_total, eggs_total_original,
                  bird_population, bird_population_original,
                  hd_percent_written, hd_percent_written_original, auto_correction_note
             FROM daily_production
            WHERE flock_internal_id = $1 AND date = $2 AND deleted_at IS NULL`,
          [flockId, date]
        );
        const existing = existingRows[0] as
          | {
              mortality: number | null;
              mortality_original: number | null;
              eggs_total: number | null;
              eggs_total_original: number | null;
              bird_population: number | null;
              bird_population_original: number | null;
              hd_percent_written: string | null;
              hd_percent_written_original: string | null;
              auto_correction_note: string | null;
            }
          | undefined;

        let note: string | null = existing?.auto_correction_note ?? null;
        let mortalityOriginal = existing?.mortality_original ?? null;
        let eggsTotalOriginal = existing?.eggs_total_original ?? null;
        let birdPopulationOriginal = existing?.bird_population_original ?? null;
        let hdPercentWrittenOriginal =
          existing?.hd_percent_written_original != null ? Number(existing.hd_percent_written_original) : null;
        const existingHdPercentWritten =
          existing?.hd_percent_written != null ? Number(existing.hd_percent_written) : null;

        ({ original: mortalityOriginal, note } = reconcileManualEdit(
          mortalityOriginal, existing?.mortality ?? null, mortality, note
        ));
        ({ original: eggsTotalOriginal, note } = reconcileManualEdit(
          eggsTotalOriginal, existing?.eggs_total ?? null, eggsTotal, note
        ));
        ({ original: birdPopulationOriginal, note } = reconcileManualEdit(
          birdPopulationOriginal, existing?.bird_population ?? null, birdPopulation, note
        ));
        ({ original: hdPercentWrittenOriginal, note } = reconcileManualEdit(
          hdPercentWrittenOriginal, existingHdPercentWritten, hdPercent, note
        ));

        // Same backstop as the upload path (pipeline.ts's own doc comment
        // on this function) — refuse to save rather than let a note and
        // the value it's paired with diverge again.
        assertAutoCorrectionNotesConsistent({
          displayLabelAsWritten: optStr(formData, `label_${flockId}`) ?? flockId,
          mortality, mortalityOriginal,
          birdPopulation, birdPopulationOriginal,
          eggsTotal, eggsTotalOriginal,
          hdPercentWritten: hdPercent, hdPercentWrittenOriginal,
          autoCorrectionNotes: note ? [note] : [],
        });

        const { rows } = await client.query(
          `INSERT INTO daily_production
               (date, farm_code, flock_internal_id, display_label_as_written,
                shed_code, mortality, feed_bags, eggs_total, bird_population,
                hd_percent_written, mortality_original, eggs_total_original,
                bird_population_original, hd_percent_written_original, auto_correction_note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (flock_internal_id, date) WHERE deleted_at IS NULL DO UPDATE SET
               display_label_as_written = EXCLUDED.display_label_as_written,
               shed_code       = EXCLUDED.shed_code,
               mortality       = EXCLUDED.mortality,
               feed_bags       = EXCLUDED.feed_bags,
               eggs_total      = EXCLUDED.eggs_total,
               bird_population = EXCLUDED.bird_population,
               hd_percent_written = EXCLUDED.hd_percent_written,
               mortality_original = EXCLUDED.mortality_original,
               eggs_total_original = EXCLUDED.eggs_total_original,
               bird_population_original = EXCLUDED.bird_population_original,
               hd_percent_written_original = EXCLUDED.hd_percent_written_original,
               auto_correction_note = EXCLUDED.auto_correction_note,
               reviewed_by_owner = false
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
            mortalityOriginal,
            eggsTotalOriginal,
            birdPopulationOriginal,
            hdPercentWrittenOriginal,
            note,
          ]
        );

        // Run the spec's flag rules; record saved either way. hd_percent_note
        // holds the quiet (non-flagging) note for a small written-vs-
        // calculated HD% gap — see fn_validate_daily_production Rule 1.
        await client.query(
          `UPDATE daily_production
              SET flagged = cardinality(v.reasons) > 0,
                  flag_reason = nullif(array_to_string(v.reasons, '; '), ''),
                  hd_percent_note = v.hd_percent_note
             FROM fn_validate_daily_production($1) v
            WHERE id = $1`,
          [rows[0].id]
        );
        savedCount += 1;

        // Owner request, 2026-10-19 (deferred from the "Round 2 accuracy
        // fixes" PR): mortality/eggs_total/bird_population just changed
        // (either edited away from what was saved, or saved for the first
        // time) — the day-to-day bal-bird chain the NEXT day's already-
        // saved row was checked against may no longer hold. Re-run that
        // check now and flag the NEXT day's row if so — NEVER auto-edit it,
        // same rule as every other chain check in this codebase.
        const changed =
          !existing ||
          existing.mortality !== mortality ||
          existing.eggs_total !== eggsTotal ||
          existing.bird_population !== birdPopulation;
        if (changed) {
          const { rows: nextRows } = await client.query(
            `SELECT id, mortality, eggs_total, bird_population, hd_percent_written, flag_reason
               FROM daily_production
              WHERE flock_internal_id = $1 AND date = $2::date + 1 AND deleted_at IS NULL`,
            [flockId, date]
          );
          const nextRow = nextRows[0] as
            | {
                id: number;
                mortality: number | null;
                eggs_total: number | null;
                bird_population: number | null;
                hd_percent_written: string | null;
                flag_reason: string | null;
              }
            | undefined;
          if (nextRow) {
            const flagText = checkNextDayChainStillHolds(
              {
                mortality: nextRow.mortality,
                eggsTotal: nextRow.eggs_total,
                birdPopulation: nextRow.bird_population,
                hdPercentWritten: nextRow.hd_percent_written != null ? Number(nextRow.hd_percent_written) : null,
              },
              birdPopulation
            );
            const keptReasons = stripNextDayChainFlag(nextRow.flag_reason);
            const newReasons = flagText ? [...keptReasons, flagText] : keptReasons;
            const newFlagReason = newReasons.length > 0 ? newReasons.join("; ") : null;
            if (newFlagReason !== nextRow.flag_reason) {
              await client.query(
                `UPDATE daily_production SET flagged = $2, flag_reason = $3, reviewed_by_owner = false WHERE id = $1`,
                [nextRow.id, newFlagReason !== null, newFlagReason]
              );
            }
          }
        }
      }

      if (savedCount === 0)
        throw new Error("Nothing to save — all flock cards are blank");

      // Also update each saved flock's latest known population (mirrors the
      // schema note: current_bird_count is the latest daily figure).
      // Flagged and soft-deleted rows are excluded both as the source AND
      // from the "later reading exists" check — an unreviewed flagged entry
      // (this screen's own validation can flag a manual entry too, e.g. an
      // HD% mismatch that suggests a typo) or wrong/duplicate data marked
      // deleted must not push a wrong number into the live flock register
      // before the owner has reviewed it.
      await client.query(
        `UPDATE flocks f
            SET current_bird_count = dp.bird_population
           FROM daily_production dp
          WHERE dp.flock_internal_id = f.flock_internal_id
            AND dp.date = $1
            AND dp.bird_population IS NOT NULL
            AND dp.flagged = false
            AND dp.deleted_at IS NULL
            AND NOT EXISTS (
                SELECT 1 FROM daily_production later
                 WHERE later.flock_internal_id = f.flock_internal_id
                   AND later.date > $1 AND later.bird_population IS NOT NULL
                   AND later.flagged = false
                   AND later.deleted_at IS NULL
            )`,
        [date]
      );
    });
  } catch (err) {
    return { error: errorMessage(err), values: formValues(formData) };
  }
  revalidatePath("/production");
  revalidatePath("/flagged");
  redirect(`/production?date=${date}&saved=1`);
}
