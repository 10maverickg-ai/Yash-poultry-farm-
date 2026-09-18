import type { PoolClient } from "pg";

export interface DailyProductionRowInput {
  displayLabelAsWritten: string;
  shedCode: string | null;
  mortality: number | null;
  feedBags: number | null;
  eggsTotal: number | null;
  birdPopulation: number | null;
  hdPercent: number | null;
  // Null for a row written outside the extraction flow (e.g. the manual
  // "resolve this unmatched label" form re-uses this same helper, but with
  // whatever confidence was originally stored on unresolved_extractions —
  // which may itself be null for very old rows).
  confidence: Record<string, number> | null;
  sourcePhotoUrl: string | null;
  sectionsFound: number | null;
  pageNotes: string | null;
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
): Promise<{ rowId: number; reasons: string[] }> {
  const { rows } = await client.query(
    `INSERT INTO daily_production
         (date, farm_code, flock_internal_id, display_label_as_written,
          shed_code, mortality, feed_bags, eggs_total, bird_population,
          hd_percent, ocr_confidence, source_photo_url, sections_found, page_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
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
         sections_found  = EXCLUDED.sections_found,
         page_notes      = EXCLUDED.page_notes,
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
      data.hdPercent,
      data.confidence ? JSON.stringify(data.confidence) : null,
      data.sourcePhotoUrl,
      data.sectionsFound,
      data.pageNotes,
    ]
  );
  const rowId: number = rows[0].id;

  // Same structural validation the manual entry screen uses — runs
  // independent of the model's own confidence score, per the extraction
  // spec ("independent of OCR confidence").
  const { rows: valRows } = await client.query(
    `SELECT fn_validate_daily_production($1) AS reasons`,
    [rowId]
  );
  const reasons: string[] = valRows[0].reasons;

  // Low self-reported confidence on any field is itself a flag trigger, per
  // the extraction spec's flag-triggers list.
  if (data.confidence) {
    const lowConfidence = Object.entries(data.confidence).filter(([, v]) => v < 0.6);
    for (const [field] of lowConfidence) {
      reasons.push(`low OCR confidence on ${field}`);
    }
  }

  await client.query(
    `UPDATE daily_production SET flagged = $2, flag_reason = $3 WHERE id = $1`,
    [rowId, reasons.length > 0, reasons.length > 0 ? reasons.join("; ") : null]
  );

  return { rowId, reasons };
}
