import { pool } from "../../db";
import { ACTIVE_FARM } from "../../farm";
import { getActiveLabels, matchFlockLabel } from "../flockMatch";
import type { ExtractedFlockRow } from "../dailyProduction";
import { extractDailyProductionV2 } from "./index";

// Reader rebuild benchmark (owner's "V4 build prompt", Phase 1): runs the
// NEW region-cropped reader against a photo this app already has stored,
// and compares its raw reads field-by-field against whatever is currently
// SAVED in daily_production for that date — the owner's own trusted record,
// not a separate "ground truth" table. This is deliberately read-only: it
// never writes anything, and it calls extractDailyProductionV2 directly,
// completely independent of the READER_V2_ENABLED switch that gates real
// uploads — running this benchmark can never affect what a real upload
// saves.
//
// Comparison is against the CURRENT saved values (post pipeline.ts
// correction), not the *_original columns — that's deliberately what the
// owner already trusts as correct for a reviewed day, and it's the number
// the old single-call reader's own accuracy already reflects, so this is
// an apples-to-apples comparison of "would this reader produce the same
// trusted answer". A flagged row's saved value is still used as the
// comparison target, but dbFlagged is surfaced on every row so the owner
// can tell a mismatch against an already-uncertain row apart from one
// against an everybody-agrees-this-is-right row.

export interface BenchmarkDateSummary {
  date: string;
  photoUrl: string;
  flockCount: number;
}

export async function listBenchmarkDates(
  farmCode: string = ACTIVE_FARM
): Promise<BenchmarkDateSummary[]> {
  const { rows } = await pool.query(
    `SELECT date::text AS date,
            (array_agg(source_photo_url ORDER BY id))[1] AS photo_url,
            count(*) AS flock_count
       FROM daily_production
      WHERE farm_code = $1 AND deleted_at IS NULL AND source_photo_url IS NOT NULL
      GROUP BY date
      ORDER BY date DESC
      LIMIT 60`,
    [farmCode]
  );
  return rows.map((r) => ({
    date: r.date as string,
    photoUrl: r.photo_url as string,
    flockCount: Number(r.flock_count),
  }));
}

const COMPARED_FIELDS = ["mortality", "feed_bags", "eggs_total", "bird_population", "hd_percent"] as const;
type ComparedField = (typeof COMPARED_FIELDS)[number];

const FIELD_LABELS: Record<ComparedField, string> = {
  mortality: "Mort",
  feed_bags: "Feed",
  eggs_total: "Total (eggs)",
  bird_population: "Bal Bird",
  hd_percent: "%",
};

interface DbProductionRow {
  display_label_as_written: string;
  flock_internal_id: string;
  mortality: number | null;
  feed_bags: number | null;
  eggs_total: number | null;
  bird_population: number | null;
  // numeric(5,2) — node-postgres returns this as a string, never a number,
  // since no custom type parser is registered for it (lib/db.ts only
  // parses DATE). Must go through Number() before any comparison.
  hd_percent_written: string | null;
  flagged: boolean;
  flag_reason: string | null;
  source_photo_url: string | null;
}

function dbValueFor(row: DbProductionRow, field: ComparedField): number | null {
  if (field === "hd_percent") {
    return row.hd_percent_written === null ? null : Number(row.hd_percent_written);
  }
  return row[field];
}

function extractedValueFor(flock: ExtractedFlockRow, field: ComparedField): number | null {
  return flock[field];
}

// hd_percent is stored to 2 decimal places and the model reads it as
// written, so a tiny float-parsing difference (e.g. "68.70" -> 68.7) must
// never register as a mismatch — every other compared field is a plain
// integer column, where exact equality is the correct (and only) test.
function fieldsMatch(field: ComparedField, expected: number | null, actual: number | null): boolean {
  if (expected === null || actual === null) return expected === actual;
  if (field === "hd_percent") return Math.abs(expected - actual) < 0.01;
  return expected === actual;
}

export interface FieldComparison {
  expected: number | null;
  actual: number | null;
  match: boolean;
}

export interface FlockComparison {
  label: string;
  dbFlagged: boolean;
  dbFlagReason: string | null;
  ambiguousDigits: string | null;
  fields: Record<ComparedField, FieldComparison>;
}

export interface BenchmarkResult {
  date: string;
  photoUrl: string;
  v2DateRead: string | null;
  v2PageNotes: string | null;
  retryRoundsRun: number;
  retriedLabels: string[];
  rows: FlockComparison[];
  // v2 read a label that doesn't match any flock active that day.
  unmatchedExtractedLabels: string[];
  // daily_production has a saved row for this label, but v2 never produced
  // a matching read at all (e.g. it missed the row, or matched it to the
  // wrong label and left this one orphaned) — the most important failure
  // mode to see, since it's invisible in a field-by-field table otherwise.
  missingFromExtraction: string[];
  summary: Record<ComparedField, { comparable: number; correct: number }>;
}

export async function runBenchmarkForDate(
  date: string,
  farmCode: string = ACTIVE_FARM
): Promise<BenchmarkResult> {
  const { rows: dbRowsRaw } = await pool.query(
    `SELECT display_label_as_written, flock_internal_id, mortality, feed_bags, eggs_total,
            bird_population, hd_percent_written, flagged, flag_reason, source_photo_url
       FROM daily_production
      WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL`,
    [farmCode, date]
  );
  const dbRows = dbRowsRaw as DbProductionRow[];
  if (dbRows.length === 0) {
    throw new Error(`No saved daily_production rows for ${date} — nothing to benchmark against.`);
  }
  const photoUrl = dbRows.find((r) => r.source_photo_url)?.source_photo_url ?? null;
  if (!photoUrl) {
    throw new Error(`${date} has no source_photo_url recorded — can't re-run the reader on it.`);
  }

  const photoResponse = await fetch(photoUrl);
  if (!photoResponse.ok) {
    throw new Error(`Couldn't download the stored photo for ${date} (HTTP ${photoResponse.status}).`);
  }
  const photoBuffer = Buffer.from(await photoResponse.arrayBuffer());
  const contentType = photoResponse.headers.get("content-type") || "image/jpeg";

  const v2 = await extractDailyProductionV2(photoBuffer, contentType);
  const activeLabels = await getActiveLabels(pool, farmCode, date);

  const dbByFlockId = new Map(dbRows.map((r) => [r.flock_internal_id, r]));
  const matchedFlockIds = new Set<string>();
  const unmatchedExtractedLabels: string[] = [];
  const rows: FlockComparison[] = [];

  for (const flock of v2.flocks) {
    const match = matchFlockLabel(flock.display_label_as_written, activeLabels);
    const dbRow = match.flockInternalId ? dbByFlockId.get(match.flockInternalId) : undefined;
    if (!dbRow) {
      unmatchedExtractedLabels.push(flock.display_label_as_written);
      continue;
    }
    matchedFlockIds.add(dbRow.flock_internal_id);

    const fields = {} as Record<ComparedField, FieldComparison>;
    for (const field of COMPARED_FIELDS) {
      const expected = dbValueFor(dbRow, field);
      const actual = extractedValueFor(flock, field);
      fields[field] = { expected, actual, match: fieldsMatch(field, expected, actual) };
    }

    rows.push({
      label: flock.display_label_as_written,
      dbFlagged: dbRow.flagged,
      dbFlagReason: dbRow.flag_reason,
      ambiguousDigits: null,
      fields,
    });
  }

  const missingFromExtraction = dbRows
    .filter((r) => !matchedFlockIds.has(r.flock_internal_id))
    .map((r) => r.display_label_as_written);

  const summary = {} as BenchmarkResult["summary"];
  for (const field of COMPARED_FIELDS) {
    const comparable = rows.filter((r) => r.fields[field].expected !== null || r.fields[field].actual !== null);
    summary[field] = {
      comparable: comparable.length,
      correct: comparable.filter((r) => r.fields[field].match).length,
    };
  }

  return {
    date,
    photoUrl,
    v2DateRead: v2.extraction.date,
    v2PageNotes: v2.extraction.page_notes,
    retryRoundsRun: v2.retryRoundsRun,
    retriedLabels: v2.retriedLabels,
    rows,
    unmatchedExtractedLabels,
    missingFromExtraction,
    summary,
  };
}

export { COMPARED_FIELDS, FIELD_LABELS };
export type { ComparedField };
