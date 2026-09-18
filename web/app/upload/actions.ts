"use server";

import { revalidatePath } from "next/cache";
import { withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { uploadRegisterPhoto } from "@/lib/storage";
import { extractDailyProduction } from "@/lib/extraction/dailyProduction";
import { getReferenceExamples } from "@/lib/extraction/references";
import { reextractFlaggedFlocks, impliedFields, type FlockRecheckRequest } from "@/lib/extraction/reextract";
import type { RecheckableField } from "@/lib/extraction/dailyProduction";
import { getActiveLabels, matchFlockLabel } from "@/lib/extraction/flockMatch";
import { insertDailyProductionRow } from "@/lib/extraction/writeDailyProduction";

export interface UploadOutcome {
  error: string | null;
  photoUrl: string | null;
  date: string | null;
  pageNotes: string | null;
  written: {
    label: string;
    flagged: boolean;
    flagReason: string | null;
    // True if a first-pass flag triggered an automatic second-pass recheck
    // (whether or not that recheck actually resolved it) — surfaced so the
    // owner knows a row was already double-checked by the AI before it
    // reached them, not just flagged and left alone.
    autoRechecked: boolean;
  }[];
  // Labels the model read that don't match any flock active on that date,
  // even after forgiving-formatting matching (see lib/extraction/flockMatch.ts).
  // These are NOT discarded — their raw numbers are saved to
  // unresolved_extractions (visible on /flagged, "Unmatched flock labels")
  // so the owner can manually point them at the right flock without ever
  // having to re-read the photo or re-type the numbers. This array is just
  // the as-written labels, for the immediate on-screen summary.
  unresolved: string[];
}

const EMPTY: UploadOutcome = {
  error: null, photoUrl: null, date: null, pageNotes: null, written: [], unresolved: [],
};

// Every error shown to the end user must be plain, non-technical text —
// this app is used daily by a farm manager, not a developer. Full technical
// detail (SDK error text, stack traces) is logged server-side via
// console.error, visible in Vercel's function logs, and never returned to
// the client.
function logAndFriendly(context: string, err: unknown, friendly: string): string {
  console.error(`[upload] ${context}:`, err);
  return friendly;
}

export async function uploadAndExtractDailyProduction(
  _prev: UploadOutcome | null,
  formData: FormData
): Promise<UploadOutcome> {
  const file = formData.get("photo");
  const dateHint = formData.get("date");
  if (!(file instanceof File) || file.size === 0) {
    return { ...EMPTY, error: "Choose a photo first" };
  }
  if (typeof dateHint !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateHint)) {
    return { ...EMPTY, error: "Pick the date shown on the register page" };
  }

  let photoUrl: string;
  try {
    photoUrl = await uploadRegisterPhoto(file, "production", dateHint);
  } catch (err) {
    return {
      ...EMPTY,
      error: logAndFriendly(
        "storage upload failed",
        err,
        "Photo couldn't be uploaded — please try again."
      ),
    };
  }

  const photoMediaType = file.type || "image/jpeg";
  let extraction;
  let photoBase64: string;
  try {
    photoBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    extraction = await extractDailyProduction(photoBase64, photoMediaType);
  } catch (err) {
    // Photo is already stored even though extraction failed — matches the
    // spec's rule 1 (store the photo regardless of downstream outcome).
    return {
      ...EMPTY,
      photoUrl,
      error: logAndFriendly(
        "extraction call failed",
        err,
        "Couldn't read the register from that photo — please try again, or enter this page manually on the Daily Production screen."
      ),
    };
  }

  // The date on the page is authoritative if legible; the date the
  // supervisor picked at upload time is the fallback.
  const date = extraction.date && extraction.date_confidence > 0.5 ? extraction.date : dateHint;

  // Diagnostic only — sections_found doesn't gate anything, but is worth
  // having in the logs while we build confidence in the multi-section fix.
  console.log(`[upload] extraction found ${extraction.flocks.length} flock(s) across ${extraction.sections_found} table section(s) for ${date}`);

  const written: UploadOutcome["written"] = [];
  const unresolved: string[] = [];

  // First-pass results that ended up flagged with at least one recheckable
  // field, collected across the whole photo so the second pass can batch
  // every flagged flock from this upload into ONE call — re-sending the
  // full reference set once per flagged flock (instead of once per upload)
  // would multiply the expensive part of that call for no benefit, since a
  // single handwriting-heavy page can flag several flocks at once.
  interface PendingRecheck {
    rowId: number;
    flockLabel: string;
    fields: RecheckableField[];
    confidence: Record<string, number>;
    reasons: string[];
  }
  const pendingRechecks: PendingRecheck[] = [];

  try {
    await withTransaction(async (client) => {
      // Fetched once per upload (every flock on this photo shares the same
      // date) rather than resolved one label at a time — needed anyway so
      // fuzzy matching has the full candidate list to normalize against.
      const activeLabels = await getActiveLabels(client, ACTIVE_FARM, date);

      for (const flock of extraction.flocks) {
        const match = matchFlockLabel(flock.display_label_as_written, activeLabels);

        if (!match.flockInternalId) {
          // No flock matches this label, even after forgiving-formatting
          // normalization — genuinely don't know which flock this is. The
          // raw numbers are never discarded: they're saved here so the
          // owner can manually match them on /flagged without re-reading
          // the photo. daily_production.flock_internal_id is NOT NULL
          // (Phase 1, owner-approved), so this table is the only place a
          // row like this CAN live until it's resolved.
          await client.query(
            `INSERT INTO unresolved_extractions
                 (farm_code, register_type, date, display_label_as_written, shed_code,
                  mortality, feed_bags, eggs_total, bird_population, hd_percent,
                  ocr_confidence, source_photo_url, sections_found, page_notes)
             VALUES ($1,'daily_production',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              ACTIVE_FARM,
              date,
              flock.display_label_as_written,
              flock.shed_code,
              flock.mortality,
              flock.feed_bags,
              flock.eggs_total,
              flock.bird_population,
              flock.hd_percent,
              JSON.stringify(flock.confidence),
              photoUrl,
              extraction.sections_found,
              extraction.page_notes,
            ]
          );
          unresolved.push(flock.display_label_as_written);
          continue;
        }

        const { rowId, reasons } = await insertDailyProductionRow(
          client,
          ACTIVE_FARM,
          date,
          match.flockInternalId,
          {
            displayLabelAsWritten: flock.display_label_as_written,
            shedCode: flock.shed_code,
            mortality: flock.mortality,
            feedBags: flock.feed_bags,
            eggsTotal: flock.eggs_total,
            birdPopulation: flock.bird_population,
            hdPercent: flock.hd_percent,
            confidence: flock.confidence,
            sourcePhotoUrl: photoUrl,
            sectionsFound: extraction.sections_found,
            pageNotes: extraction.page_notes,
          }
        );

        if (reasons.length > 0) {
          const fields = impliedFields(reasons);
          if (fields.length > 0) {
            pendingRechecks.push({
              rowId,
              flockLabel: flock.display_label_as_written,
              fields,
              confidence: { ...flock.confidence },
              reasons,
            });
            // Finalized below, after the batched second pass — the row is
            // already saved with its first-pass flagged/flag_reason from
            // insertDailyProductionRow, which the second pass may overwrite.
            continue;
          }
        }

        written.push({
          label: flock.display_label_as_written,
          flagged: reasons.length > 0,
          flagReason: reasons.length > 0 ? reasons.join("; ") : null,
          autoRechecked: false,
        });
      }

      // Second pass — one batched call covering every flagged flock from
      // this photo, only if at least one confirmed reference photo is
      // available. Most uploads never reach this at all: references are
      // expensive (multiple extra images per call), so they're attached
      // only to the recheck, never to the first pass.
      if (pendingRechecks.length > 0) {
        const references = await getReferenceExamples(client, ACTIVE_FARM);
        let resultsByLabel = new Map<string, Awaited<ReturnType<typeof reextractFlaggedFlocks>>[number]>();
        if (references.length > 0) {
          try {
            const requests: FlockRecheckRequest[] = pendingRechecks.map((p) => ({
              flockLabel: p.flockLabel,
              fields: p.fields,
            }));
            const results = await reextractFlaggedFlocks(photoBase64, photoMediaType, requests, references);
            resultsByLabel = new Map(results.map((r) => [r.flockLabel, r]));
          } catch (err) {
            // A failed recheck call leaves every pending row flagged with
            // its original first-pass reasons — same end state as if no
            // recheck had been attempted, just logged for diagnostics.
            console.error("[upload] second-pass recheck failed:", err);
          }
        }

        for (const pending of pendingRechecks) {
          let reasons = pending.reasons;
          const recheck = resultsByLabel.get(pending.flockLabel);
          const autoRechecked = references.length > 0;

          if (recheck) {
            const confidence = pending.confidence;
            const acceptedFields: string[] = [];
            const acceptedValues: (number | null)[] = [];
            for (const f of pending.fields) {
              const newVal = recheck.values[f];
              const newConf = recheck.confidence[f] ?? 0;
              const oldConf = confidence[f] ?? 0;
              // Only accept the recheck's value if it actually resolved to
              // reasonable confidence AND is at least as confident as the
              // original read — a recheck that comes back just as unsure
              // shouldn't silently overwrite the original value.
              if (newVal !== undefined && newConf >= 0.6 && newConf >= oldConf) {
                acceptedFields.push(f);
                acceptedValues.push(newVal);
                confidence[f] = newConf;
              }
            }

            if (acceptedFields.length > 0) {
              const setClause = acceptedFields.map((f, i) => `${f} = $${i + 2}`).join(", ");
              await client.query(
                `UPDATE daily_production SET ${setClause}, ocr_confidence = $${acceptedFields.length + 2} WHERE id = $1`,
                [pending.rowId, ...acceptedValues, JSON.stringify(confidence)]
              );

              const { rows: revalRows } = await client.query(
                `SELECT fn_validate_daily_production($1) AS reasons`,
                [pending.rowId]
              );
              reasons = revalRows[0].reasons;
              const stillLow = Object.entries(confidence).filter(([, v]) => v < 0.6);
              for (const [field] of stillLow) reasons.push(`low OCR confidence on ${field}`);
            }
          }

          await client.query(
            `UPDATE daily_production SET flagged = $2, flag_reason = $3 WHERE id = $1`,
            [pending.rowId, reasons.length > 0, reasons.length > 0 ? reasons.join("; ") : null]
          );
          written.push({
            label: pending.flockLabel,
            flagged: reasons.length > 0,
            flagReason: reasons.length > 0 ? reasons.join("; ") : null,
            autoRechecked,
          });
        }
      }

      if (written.length > 0) {
        // Flagged rows never feed this mirror — an unreviewed OCR read
        // (e.g. a misread digit) must not silently push a wrong number into
        // the live flock register before the owner has had a chance to
        // catch it on /flagged. A flagged row is excluded both as the
        // source of the update AND from the "is there a later reading"
        // check below, since an unreviewed later row shouldn't be able to
        // block an earlier CONFIRMED-clean reading from applying either.
        await client.query(
          `UPDATE flocks f
              SET current_bird_count = dp.bird_population
             FROM daily_production dp
            WHERE dp.flock_internal_id = f.flock_internal_id
              AND dp.date = $1
              AND dp.bird_population IS NOT NULL
              AND dp.flagged = false
              AND NOT EXISTS (
                  SELECT 1 FROM daily_production later
                   WHERE later.flock_internal_id = f.flock_internal_id
                     AND later.date > $1 AND later.bird_population IS NOT NULL
                     AND later.flagged = false
              )`,
          [date]
        );
      }
    });
  } catch (err) {
    return {
      ...EMPTY,
      photoUrl,
      error: logAndFriendly(
        "database write failed",
        err,
        "Photo was read, but something went wrong saving the results — please try again."
      ),
    };
  }

  revalidatePath("/production");
  revalidatePath("/flagged");
  revalidatePath("/records");

  return {
    error: null,
    photoUrl,
    date,
    pageNotes: extraction.page_notes,
    written,
    unresolved,
  };
}
