"use server";

import { revalidatePath } from "next/cache";
import { withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { uploadRegisterPhoto } from "@/lib/storage";
import { extractDailyProduction } from "@/lib/extraction/dailyProduction";
import { errorMessage } from "@/lib/forms";

export interface UploadOutcome {
  error: string | null;
  photoUrl: string | null;
  date: string | null;
  pageNotes: string | null;
  written: { label: string; flagged: boolean; flagReason: string | null }[];
  // Labels the model read but that don't resolve to any flock active on that
  // date via flock_label_history — daily_production.flock_internal_id is
  // NOT NULL, so these genuinely cannot be written as rows. Surfaced
  // directly here rather than silently dropped: usually means an unlogged
  // renumbering event, or the label was misread.
  unresolved: string[];
}

const EMPTY: UploadOutcome = {
  error: null, photoUrl: null, date: null, pageNotes: null, written: [], unresolved: [],
};

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
    return { ...EMPTY, error: `Photo upload failed: ${errorMessage(err)}` };
  }

  let extraction;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    extraction = await extractDailyProduction(buf.toString("base64"), file.type || "image/jpeg");
  } catch (err) {
    // Photo is already stored even though extraction failed — matches the
    // spec's rule 1 (store the photo regardless of downstream outcome).
    return {
      ...EMPTY,
      photoUrl,
      error: `Extraction failed (photo was saved — try again or enter this page manually): ${errorMessage(err)}`,
    };
  }

  // The date on the page is authoritative if legible; the date the
  // supervisor picked at upload time is the fallback.
  const date = extraction.date && extraction.date_confidence > 0.5 ? extraction.date : dateHint;

  const written: UploadOutcome["written"] = [];
  const unresolved: string[] = [];

  await withTransaction(async (client) => {
    for (const flock of extraction.flocks) {
      const { rows: resolvedRows } = await client.query(
        `SELECT resolve_flock_internal_id($1, $2, $3) AS flock_id`,
        [ACTIVE_FARM, flock.display_label_as_written, date]
      );
      const flockId: string | null = resolvedRows[0].flock_id;
      if (!flockId) {
        unresolved.push(flock.display_label_as_written);
        continue;
      }

      const { rows } = await client.query(
        `INSERT INTO daily_production
             (date, farm_code, flock_internal_id, display_label_as_written,
              shed_code, mortality, feed_bags, eggs_total, bird_population,
              hd_percent, ocr_confidence, source_photo_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (flock_internal_id, date) DO UPDATE SET
             display_label_as_written = EXCLUDED.display_label_as_written,
             shed_code       = EXCLUDED.shed_code,
             mortality       = EXCLUDED.mortality,
             feed_bags       = EXCLUDED.feed_bags,
             eggs_total      = EXCLUDED.eggs_total,
             bird_population = EXCLUDED.bird_population,
             hd_percent      = EXCLUDED.hd_percent,
             ocr_confidence  = EXCLUDED.ocr_confidence,
             source_photo_url = EXCLUDED.source_photo_url,
             reviewed_by_owner = false
         RETURNING id`,
        [
          date,
          ACTIVE_FARM,
          flockId,
          flock.display_label_as_written,
          flock.shed_code,
          flock.mortality,
          flock.feed_bags,
          flock.eggs_total,
          flock.bird_population,
          flock.hd_percent,
          JSON.stringify(flock.confidence),
          photoUrl,
        ]
      );
      const rowId: number = rows[0].id;

      // Same structural validation the manual entry screen uses — runs
      // independent of the model's own confidence score, per the
      // extraction spec ("independent of OCR confidence").
      const { rows: valRows } = await client.query(
        `SELECT fn_validate_daily_production($1) AS reasons`,
        [rowId]
      );
      const reasons: string[] = valRows[0].reasons;
      // Low self-reported confidence on any field is itself a flag trigger,
      // per the extraction spec's flag-triggers list.
      const lowConfidence = Object.entries(flock.confidence).filter(([, v]) => v < 0.6);
      for (const [field] of lowConfidence) {
        reasons.push(`low OCR confidence on ${field}`);
      }

      await client.query(
        `UPDATE daily_production SET flagged = $2, flag_reason = $3 WHERE id = $1`,
        [rowId, reasons.length > 0, reasons.length > 0 ? reasons.join("; ") : null]
      );

      written.push({
        label: flock.display_label_as_written,
        flagged: reasons.length > 0,
        flagReason: reasons.length > 0 ? reasons.join("; ") : null,
      });
    }

    if (written.length > 0) {
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
    }
  });

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
