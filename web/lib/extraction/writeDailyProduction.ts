import type { PoolClient } from "pg";
import { pickBestReading, isMultipleOf30, calcHd, hdWithinTolerance, suggestEggsCandidate } from "./digitEvidence";

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
  // check. When the readings disagree, flags the row with every reading
  // spelled out in flag_reason, and — if exactly one reading is uniquely
  // supported by the available evidence (eggs: divisible by 30 and/or its
  // implied HD corroborates the written HD; bird_population: implied HD
  // corroborates) — names which one looks right. Never silently picks
  // between them: eggsTotal/birdPopulation above still decide what's saved.
  eggsTotalReadings?: (number | null)[];
  birdPopulationReadings?: (number | null)[];
  // Set (with birdPopulationOriginal) when the day-to-day bal-bird chain
  // check (app/upload/actions.ts, lib/extraction/balBirdChain.ts) has
  // already auto-corrected birdPopulation above — the ONLY value this pass
  // ever auto-applies, and only when corroborated by written HD%. The
  // original extracted figure is preserved, never discarded, and the row
  // is saved CLEAN (not flagged) with this as a quiet note, the same way
  // hd_percent_note already works.
  birdPopulationOriginal?: number | null;
  autoCorrectionNote?: string | null;
  // When true, suppresses fn_validate_daily_production's own "bird_population
  // increased" reason — set by the caller when the day-to-day chain check
  // has already determined TODAY's reading is the corroborated-correct one
  // and the PREVIOUS day's row is the likely misread (flagged separately,
  // on that other row) — the old, undifferentiated "increased" message on
  // TODAY's row would blame the wrong row (owner report, 2026-09-28).
  suppressBirdPopulationIncreaseFlag?: boolean;
  // Externally-computed reasons to merge into this row's flag_reason — e.g.
  // the bal-bird chain check's own "flag_today" note, when neither
  // candidate could be corroborated against written HD.
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

/** Builds the "readings disagree" flag text for eggs_total, naming a
 * preferred reading when the tray-of-30 signal and/or HD corroboration
 * uniquely picks one out of the readings actually written on the page
 * (never a digit-substitution guess — those are a different, separate
 * suggestion path, see digitEvidence.suggestEggsCandidate). */
function eggsDisagreementReason(
  readings: (number | null)[],
  birdPopulation: number | null,
  writtenHd: number | null
): string {
  const present = readings.filter((n): n is number => n !== null);
  const scorer = (n: number) => {
    let score = 0;
    if (isMultipleOf30(n)) score += 2;
    if (birdPopulation !== null && birdPopulation > 0 && writtenHd !== null) {
      const hd = calcHd(n, birdPopulation);
      if (hd !== null && hdWithinTolerance(hd, writtenHd)) score += 1;
    }
    return score;
  };
  const best = pickBestReading(readings, scorer);
  const readingsText = present.join(", ");
  if (best && best.uniquelyBest && !best.allAgree) {
    return `eggs_total readings disagree: ${readingsText} — ${best.value} looks right (divisible by 30${birdPopulation !== null && writtenHd !== null ? " and/or matches written HD" : ""})`;
  }
  return `eggs_total readings disagree: ${readingsText}`;
}

/** Same idea for bird_population, using only HD-proximity as evidence
 * (the day-to-day chain check is a separate, stronger mechanism that runs
 * before this function is even called — see balBirdChain.ts — this is
 * just a same-page corroboration signal for when the two lines of a
 * two-line block disagree with each other). */
function birdPopulationDisagreementReason(
  readings: (number | null)[],
  eggsTotal: number | null,
  writtenHd: number | null
): string {
  const present = readings.filter((n): n is number => n !== null);
  const scorer = (n: number) => {
    if (eggsTotal !== null && n > 0 && writtenHd !== null) {
      const hd = calcHd(eggsTotal, n);
      if (hd !== null && hdWithinTolerance(hd, writtenHd)) return 1;
    }
    return 0;
  };
  const best = pickBestReading(readings, scorer);
  const readingsText = present.join(", ");
  if (best && best.uniquelyBest && !best.allAgree) {
    return `bird_population readings disagree: ${readingsText} — ${best.value} looks right (matches written HD)`;
  }
  return `bird_population readings disagree: ${readingsText}`;
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
          bird_population_original, auto_correction_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
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
         bird_population_original = EXCLUDED.bird_population_original,
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
      data.birdPopulationOriginal ?? null,
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

  // Digit-accuracy pass: a value written more than once on the page that
  // doesn't agree with itself is worth a human look even if OCR confidence
  // came back high on each individual read — high confidence on two
  // different numbers just means the model was sure each time, not that it
  // was right. Every reading goes straight into flag_reason, plus a
  // preferred reading when the evidence uniquely supports one. Tracked
  // separately in `stableReasons` (returned to the caller) rather than
  // making the caller recompute the same text independently to re-merge it
  // after a second-pass reval — two copies of this logic drifting apart
  // would be its own bug, the same lesson writeDailyProduction.ts's own
  // docstring already draws about the INSERT shape.
  const stableReasons: string[] = [];
  if (readingsDisagree(data.eggsTotalReadings)) {
    stableReasons.push(eggsDisagreementReason(data.eggsTotalReadings!, data.birdPopulation, data.hdPercentWritten));
  }
  if (readingsDisagree(data.birdPopulationReadings)) {
    stableReasons.push(birdPopulationDisagreementReason(data.birdPopulationReadings!, data.eggsTotal, data.hdPercentWritten));
  }
  // Owner-confirmed, 2026-09-28: eggs on this register are always counted
  // in whole trays of 30 — a saved eggs_total that isn't a multiple of 30
  // is worth a flag on its own, even when every reading of it agreed with
  // itself (readingsDisagree above only catches the case where the page's
  // own repeated copies disagree with EACH OTHER; a value that's
  // consistently misread the same wrong way every time needs this separate
  // check). Never auto-corrected — only ever a flag with a suggestion, per
  // the same "eggs are suggestion-only" rule as the digit-substitution
  // search itself.
  if (data.eggsTotal !== null && !isMultipleOf30(data.eggsTotal)) {
    const suggestion = suggestEggsCandidate(data.eggsTotal, data.birdPopulation, data.hdPercentWritten);
    stableReasons.push(
      suggestion !== null
        ? `eggs_total ${data.eggsTotal} is not a multiple of 30 (this farm counts eggs in trays of 30) — suggested: ${suggestion}`
        : `eggs_total ${data.eggsTotal} is not a multiple of 30 (this farm counts eggs in trays of 30)`
    );
  }
  if (data.extraReasons) {
    stableReasons.push(...data.extraReasons);
  }
  reasons.push(...stableReasons);

  await client.query(
    `UPDATE daily_production SET flagged = $2, flag_reason = $3, hd_percent_note = $4 WHERE id = $1`,
    [rowId, reasons.length > 0, reasons.length > 0 ? reasons.join("; ") : null, hdPercentNote]
  );

  return { rowId, reasons, hdPercentNote, stableReasons };
}
