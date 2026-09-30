import type { PoolClient } from "pg";

// Thin persistence layer — every piece of extraction business logic (digit
// evidence, disagreement resolution, chain corrections, page checksums)
// lives in pipeline.ts and is already fully resolved by the time it
// reaches this function (owner request, 2026-09-29: "an explicit ordering
// guarantee in the code" — see pipeline.ts's own header comment for the
// full stage sequence). This function's only jobs are: write the row,
// run the SQL structural validation, apply low-confidence flagging, and
// merge in whatever reasons/notes the caller already decided on.
export interface DailyProductionRowInput {
  displayLabelAsWritten: string;
  shedCode: string | null;
  mortality: number | null;
  // Set alongside mortalityOriginal when pipeline.ts's mortality/feed_bags
  // column-swap check auto-corrected this value — see mortalityFeedSwap.ts.
  mortalityOriginal?: number | null;
  feedBags: number | null;
  eggsTotal: number | null;
  // Set alongside eggsTotalOriginal when pipeline.ts's page-checksum stage
  // auto-corrected this value (the only place eggs_total is ever
  // auto-corrected — exact section-sum match, divisible by 30, AND
  // HD-corroborated, all three, per the owner's rule).
  eggsTotalOriginal?: number | null;
  birdPopulation: number | null;
  // Set alongside birdPopulationOriginal when the day-to-day bal-bird
  // chain (balBirdChain.ts) auto-corrected this value.
  birdPopulationOriginal?: number | null;
  // The register's own written "%" figure — NOT the official hd_percent,
  // which is a GENERATED ALWAYS column (eggs_total / bird_population * 100)
  // and cannot be written to directly; Postgres rejects any INSERT/UPDATE
  // that tries.
  hdPercentWritten: number | null;
  // Set alongside hdPercentWrittenOriginal when pipeline.ts's written-HD
  // digit-accuracy check (writtenHdCheck.ts) auto-corrected this value —
  // reference-only field, never affects hd_percent (the GENERATED column).
  hdPercentWrittenOriginal?: number | null;
  // Null for a row written outside the extraction flow (e.g. the manual
  // "resolve this unmatched label" form re-uses this same helper, but with
  // whatever confidence was originally stored on unresolved_extractions —
  // which may itself be null for very old rows).
  confidence: Record<string, number> | null;
  sourcePhotoUrl: string | null;
  sectionsFound: number | null;
  pageNotes: string | null;
  // Human-readable explanation of whatever auto-correction(s) applied
  // (mortality, bird_population, and/or eggs_total can each contribute a
  // sentence here) — shown as a quiet, non-flagging note on the record,
  // the same way hd_percent_note already works. Multiple corrections on
  // one row are joined by the caller before reaching here.
  autoCorrectionNote?: string | null;
  // Set by the caller when the day-to-day chain check has already
  // determined TODAY's bird_population is the corroborated-correct one
  // and the PREVIOUS day's row is the likely misread (flagged separately,
  // on that other row) — suppresses fn_validate_daily_production's own
  // "bird_population increased" reason, which would otherwise blame
  // today's row for a discrepancy that's actually yesterday's.
  suppressBirdPopulationIncreaseFlag?: boolean;
  // Every reason pipeline.ts's stages already decided this row should be
  // flagged for (disagreeing readings, tray-of-30, chain mismatches, ...)
  // — fn_validate_daily_production has no way to reproduce any of these,
  // since they're not SQL-side rules.
  extraReasons?: string[];
}

/**
 * Single insert-and-validate path for a Daily Production flock row, shared
 * by the upload flow (a matched flock) and the manual "resolve unmatched
 * label" action on /flagged — both need the exact same INSERT shape,
 * structural validation, and confidence-based flagging, and drift between
 * two copies of this would be its own bug.
 */
export async function insertDailyProductionRow(
  client: PoolClient,
  farmCode: string,
  date: string,
  flockInternalId: string,
  data: DailyProductionRowInput
): Promise<{ rowId: number; reasons: string[]; hdPercentNote: string | null; stableReasons: string[] }> {
  const { rows } = await client.query(
    `INSERT INTO daily_production
         (date, farm_code, flock_internal_id, display_label_as_written,
          shed_code, mortality, feed_bags, eggs_total, bird_population,
          hd_percent_written, ocr_confidence, source_photo_url, sections_found, page_notes,
          mortality_original, eggs_total_original, bird_population_original,
          hd_percent_written_original, auto_correction_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (flock_internal_id, date) WHERE deleted_at IS NULL DO UPDATE SET
         display_label_as_written = EXCLUDED.display_label_as_written,
         shed_code       = EXCLUDED.shed_code,
         mortality       = EXCLUDED.mortality,
         feed_bags       = EXCLUDED.feed_bags,
         eggs_total      = EXCLUDED.eggs_total,
         bird_population = EXCLUDED.bird_population,
         hd_percent_written = EXCLUDED.hd_percent_written,
         ocr_confidence  = EXCLUDED.ocr_confidence,
         source_photo_url = EXCLUDED.source_photo_url,
         sections_found  = EXCLUDED.sections_found,
         page_notes      = EXCLUDED.page_notes,
         mortality_original = EXCLUDED.mortality_original,
         eggs_total_original = EXCLUDED.eggs_total_original,
         bird_population_original = EXCLUDED.bird_population_original,
         hd_percent_written_original = EXCLUDED.hd_percent_written_original,
         auto_correction_note = EXCLUDED.auto_correction_note,
         reviewed_by_owner = false
     RETURNING id`,
    [
      date,
      farmCode,
      flockInternalId,
      data.displayLabelAsWritten,
      data.shedCode,
      data.mortality,
      data.feedBags,
      data.eggsTotal,
      data.birdPopulation,
      data.hdPercentWritten,
      data.confidence ? JSON.stringify(data.confidence) : null,
      data.sourcePhotoUrl,
      data.sectionsFound,
      data.pageNotes,
      data.mortalityOriginal ?? null,
      data.eggsTotalOriginal ?? null,
      data.birdPopulationOriginal ?? null,
      data.hdPercentWrittenOriginal ?? null,
      data.autoCorrectionNote ?? null,
    ]
  );
  const rowId: number = rows[0].id;

  // Same structural validation the manual entry screen uses — runs
  // independent of the model's own confidence score, per the extraction
  // spec ("independent of OCR confidence"). Also returns hd_percent_note,
  // the quiet (non-flagging) note for a small written-vs-calculated HD% gap.
  const { rows: valRows } = await client.query(
    `SELECT * FROM fn_validate_daily_production($1)`,
    [rowId]
  );
  let reasons: string[] = valRows[0].reasons;
  const hdPercentNote: string | null = valRows[0].hd_percent_note;

  if (data.suppressBirdPopulationIncreaseFlag) {
    reasons = reasons.filter((r) => !r.startsWith("bird_population increased"));
  }

  // Low self-reported confidence on any field is itself a flag trigger, per
  // the extraction spec's flag-triggers list.
  if (data.confidence) {
    const lowConfidence = Object.entries(data.confidence).filter(([, v]) => v < 0.6);
    for (const [field] of lowConfidence) {
      reasons.push(`low OCR confidence on ${field}`);
    }
  }

  // Everything pipeline.ts's stages already decided (disagreement,
  // tray-of-30, chain mismatches, ...) — tracked separately in
  // `stableReasons` (returned to the caller) rather than making the
  // caller recompute the same text independently to re-merge it after a
  // second-pass reval — two copies of this logic drifting apart would be
  // its own bug, the same lesson this file's own docstring already draws
  // about the INSERT shape.
  const stableReasons = data.extraReasons ? [...data.extraReasons] : [];
  reasons.push(...stableReasons);

  await client.query(
    `UPDATE daily_production SET flagged = $2, flag_reason = $3, hd_percent_note = $4 WHERE id = $1`,
    [rowId, reasons.length > 0, reasons.length > 0 ? reasons.join("; ") : null, hdPercentNote]
  );

  return { rowId, reasons, hdPercentNote, stableReasons };
}
