import type { PoolClient } from "pg";

export interface DailyProductionRowInput {
  displayLabelAsWritten: string;
  shedCode: string | null;
  mortality: number | null;
  feedBags: number | null;
  eggsTotal: number | null;
  birdPopulation: number | null;
  // The register's own written "%" figure — NOT the official hd_percent,
  // which is a GENERATED ALWAYS column (eggs_total / bird_population * 100)
  // and cannot be written to directly; Postgres rejects any INSERT/UPDATE
  // that tries.
  hdPercentWritten: number | null;
  // Null for a row written outside the extraction flow (e.g. the manual
  // "resolve this unmatched label" form re-uses this same helper, but with
  // whatever confidence was originally stored on unresolved_extractions —
  // which may itself be null for very old rows).
  confidence: Record<string, number> | null;
  sourcePhotoUrl: string | null;
  sectionsFound: number | null;
  pageNotes: string | null;
  // Digit-accuracy pass (owner report, 2026-09-28): independent readings of
  // a value that's written more than once on the page (eggs_total: the
  // "I"/"II"/"Total" columns; bird_population: both lines of a two-line
  // flock block). Optional — the manual "resolve unmatched label" path that
  // shares this function doesn't have these, and undefined simply skips the
  // check. When present and the readings disagree, flags the row with both
  // readings spelled out in flag_reason rather than silently picking one.
  eggsTotalReadings?: (number | null)[];
  birdPopulationReadings?: (number | null)[];
  // Externally-computed reasons to merge into this row's flag_reason — e.g.
  // a page-level checksum mismatch computed once per upload, not per row.
  extraReasons?: string[];
}

/** True if two or more non-null readings of what's supposed to be the same
 * figure disagree — a single reading, or all-null, can't disagree. */
function readingsDisagree(readings: (number | null)[] | undefined): boolean {
  if (!readings) return false;
  const present = readings.filter((n): n is number => n !== null);
  if (present.length < 2) return false;
  return !present.every((n) => n === present[0]);
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
): Promise<{ rowId: number; reasons: string[]; hdPercentNote: string | null }> {
  const { rows } = await client.query(
    `INSERT INTO daily_production
         (date, farm_code, flock_internal_id, display_label_as_written,
          shed_code, mortality, feed_bags, eggs_total, bird_population,
          hd_percent_written, ocr_confidence, source_photo_url, sections_found, page_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
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
  const reasons: string[] = valRows[0].reasons;
  const hdPercentNote: string | null = valRows[0].hd_percent_note;

  // Low self-reported confidence on any field is itself a flag trigger, per
  // the extraction spec's flag-triggers list.
  if (data.confidence) {
    const lowConfidence = Object.entries(data.confidence).filter(([, v]) => v < 0.6);
    for (const [field] of lowConfidence) {
      reasons.push(`low OCR confidence on ${field}`);
    }
  }

  // Digit-accuracy pass: a value written more than once on the page that
  // doesn't agree with itself is worth a human look even if OCR confidence
  // came back high on each individual read — high confidence on two
  // different numbers just means the model was sure each time, not that it
  // was right. Both readings go straight into flag_reason so the owner sees
  // exactly what disagreed without opening the source photo first.
  if (readingsDisagree(data.eggsTotalReadings)) {
    reasons.push(`eggs_total readings disagree: ${data.eggsTotalReadings!.filter((n) => n !== null).join(", ")}`);
  }
  if (readingsDisagree(data.birdPopulationReadings)) {
    reasons.push(`bird_population readings disagree: ${data.birdPopulationReadings!.filter((n) => n !== null).join(", ")}`);
  }
  if (data.extraReasons) {
    reasons.push(...data.extraReasons);
  }

  await client.query(
    `UPDATE daily_production SET flagged = $2, flag_reason = $3, hd_percent_note = $4 WHERE id = $1`,
    [rowId, reasons.length > 0, reasons.length > 0 ? reasons.join("; ") : null, hdPercentNote]
  );

  return { rowId, reasons, hdPercentNote };
}
