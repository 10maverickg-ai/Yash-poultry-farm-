import { pool } from "../../db";
import { ACTIVE_FARM } from "../../farm";
import { extractDailyProductionSafely, type ExtractedFlockRow } from "../dailyProduction";
import { extractLedgerAndFeed, type LedgerFeedExtractionResult } from "../ledgerFeedExtraction";
import { getActiveLabels, matchFlockLabel, type ActiveLabel } from "../flockMatch";
import { BAL_BIRD_TOLERANCE, type Section, type SectionSubtotal } from "../pageChecksum";
import { calcHd } from "../digitEvidence";
import type { EggStockSection } from "../../eggstock-types";
import { autoOrientPhoto } from "./autoOrient";
import { readPageHalves, UNREADABLE_MESSAGE, type AttemptSummary } from "./halfPipeline";
import type { LeftPageContent, Rotation, TextTop } from "./pageOrientation";
import { mergeTableBlocksFromHalves, type HalfPageSource } from "./index";
import type { HalfSide } from "./pageHalfRegion";
import {
  assignTableSections,
  assignLedgerSections,
  collectFeedBoxes,
  pickChickRows,
  pickDate,
  type HalfResult,
} from "./contentMapping";
import { extractEggLedgerRegion } from "./ledgerRegion";
import { extractFeedBoxRegion, type FeedBoxGroupLabel } from "./feedBoxRegion";
import { checkEggLedgerArithmetic, checkFeedBoxArithmetic } from "./ledgerFeedChecksum";
import { drawSpineLine, downscaleForDisplay } from "./debugImage";

// Reader rebuild benchmark (owner's "V4 build prompt", Phase 1; revised
// 2026-10-21 after the Aug 3 photo filed under Aug 8 showed every
// model-drawn region box wrong — see pageSplit.ts's header comment). Runs
// the NEW deterministic-split reader against a photo this app already has
// stored (or one uploaded just for this purpose — see listBenchmarkDates),
// and compares its reads against whatever is currently SAVED — the
// owner's own trusted record, not a separate "ground truth" table —
// across every item kind a half-page call can find: the flock tables
// (plus their subtotal rows), the egg ledger(s), the feed box(es), the
// chick rows, and each flock's margin note. This is deliberately
// read-only: it never writes anything, and every extraction call here
// runs completely independent of the READER_V2_ENABLED switch that gates
// real uploads — running this benchmark can never affect what a real
// upload saves.
//
// Comparison is against the CURRENT saved values (post pipeline.ts
// correction / post hand-entry review), not the *_original columns —
// that's deliberately what the owner already trusts as correct for a
// reviewed day. A flagged row's saved value is still used as the
// comparison target, but dbFlagged is surfaced so a mismatch against an
// already-uncertain row reads differently from one against an
// everybody-agrees-this-is-right row.
//
// The chick-rows reader has no prior art anywhere in this app —
// chick_daily_mortality has always been filled in by hand. Its results
// are reported the same way as everything else, but it's worth
// remembering this one part is genuinely new and unproven, not an
// existing prompt just asked of a smaller crop.

export interface BenchmarkDateSummary {
  date: string;
  // Null means this date has saved, verified rows but no photo of any kind
  // yet — the benchmark can't run until one is attached via the
  // "Add a photo for the benchmark" form (reader_benchmark_photos),
  // which never touches daily_production or any other production table.
  photoUrl: string | null;
  flockCount: number;
}

export async function listBenchmarkDates(
  farmCode: string = ACTIVE_FARM
): Promise<BenchmarkDateSummary[]> {
  // Every date with saved, verified daily_production rows is listed,
  // whether or not a real upload photo exists for it (owner request,
  // 2026-10-19: most of August was entered by hand with no photo at all) —
  // photoUrl falls back to a benchmark-only upload (reader_benchmark_photos)
  // when the production rows themselves have none.
  const { rows } = await pool.query(
    `SELECT dp.date::text AS date,
            count(*) AS flock_count,
            (array_agg(dp.source_photo_url ORDER BY dp.id) FILTER (WHERE dp.source_photo_url IS NOT NULL))[1] AS production_photo_url,
            bp.photo_url AS benchmark_photo_url
       FROM daily_production dp
       LEFT JOIN reader_benchmark_photos bp
              ON bp.farm_code = dp.farm_code AND bp.date = dp.date
      WHERE dp.farm_code = $1 AND dp.deleted_at IS NULL
      GROUP BY dp.date, bp.photo_url
      ORDER BY dp.date DESC
      LIMIT 90`,
    [farmCode]
  );
  return rows.map((r) => ({
    date: r.date as string,
    photoUrl: (r.production_photo_url as string | null) ?? (r.benchmark_photo_url as string | null) ?? null,
    flockCount: Number(r.flock_count),
  }));
}

export interface FieldComparison {
  expected: number | null;
  actual: number | null;
  match: boolean;
}

function fieldComparison(expected: number | null, actual: number | null, tolerance = 0): FieldComparison {
  const match =
    expected === null || actual === null
      ? expected === actual
      : Math.abs(expected - actual) <= tolerance;
  return { expected, actual, match };
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function firstIntInText(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function firstNumberToken(label: string): string | null {
  const m = label.match(/\d+/);
  return m ? m[0] : null;
}

// ===================== Flock tables (+ subtotal + margin notes) =====================

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
  if (field === "hd_percent") return numOrNull(row.hd_percent_written);
  return row[field];
}

// hd_percent is stored to 2 decimal places and the model reads it as
// written, so a tiny float-parsing difference (e.g. "68.70" -> 68.7) must
// never register as a mismatch — every other compared field is a plain
// integer column, where exact equality is the correct (and only) test.
function tableFieldComparison(field: ComparedField, expected: number | null, actual: number | null): FieldComparison {
  return fieldComparison(expected, actual, field === "hd_percent" ? 0.01 : 0);
}

export interface MarginNoteComparison {
  // Sum of |birds_change| across every flock_movements row for this
  // flock/date — 0 when none exist, meaning "no movement expected".
  expectedMagnitude: number;
  actualText: string | null;
  actualMagnitude: number | null;
  match: boolean;
}

export interface FlockComparison {
  label: string;
  dbFlagged: boolean;
  dbFlagReason: string | null;
  fields: Record<ComparedField, FieldComparison>;
  marginNote: MarginNoteComparison;
}

// ===================== Subtotal rows =====================

const SUBTOTAL_FIELDS = ["mortality", "feed_bags", "eggs_total", "bird_population", "hd_percent"] as const;
type SubtotalField = (typeof SUBTOTAL_FIELDS)[number];

export interface SubtotalComparison {
  section: Section;
  // How many of this section's matched flocks actually contributed to the
  // expected sums below (fewer than the section's full flock count means
  // the expected figure is incomplete, not necessarily wrong).
  flocksUsedForExpected: number;
  fields: Record<SubtotalField, FieldComparison>;
}

// ===================== Egg ledger =====================

const LEDGER_FIELDS = ["opening_balance_eggs", "total_eggs_produced", "total_line_eggs", "closing_balance_eggs"] as const;
type LedgerField = (typeof LEDGER_FIELDS)[number];

export interface DeductionComparison {
  position: number;
  expectedLabel: string | null;
  expectedAmount: number | null;
  actualLabel: string | null;
  actualAmount: number | null;
  match: boolean;
}

export interface LedgerComparison {
  section: EggStockSection;
  fields: Record<LedgerField, FieldComparison>;
  deductions: DeductionComparison[];
  note: string | null;
  // Owner request, 2026-10-19: "never accept ledger values that are not
  // multiples of 30; never accept ledger arithmetic that fails after
  // retries — save as needs review with the failing check". The retry
  // loop already re-asks up to MAX_LEDGER_FEED_RETRIES times; this is
  // what's STILL wrong after the last attempt, surfaced plainly rather
  // than silently presenting the final try as if it were a clean read.
  stillFailingChecks: string[];
  // What the OLD reader (ledgerFeedExtraction.ts, what a real upload uses
  // today) read for this same section, for the same cross-day context —
  // see below for the egg-ledger-specific "opening vs previous day's
  // closing" cross-day note.
  crossDayNote: string | null;
}

// ===================== Feed box =====================

const FEED_BOX_FIELDS = [
  "opening_balance_bags", "produced_bags", "total_bags", "closing_balance_bags",
  "consumed_bags", "mill_inventory_bags", "shed_inventory_bags",
] as const;
type FeedBoxField = (typeof FEED_BOX_FIELDS)[number];

export interface FeedBoxComparison {
  groupLabel: FeedBoxGroupLabel;
  fields: Record<FeedBoxField, FieldComparison>;
  note: string | null;
  // See LedgerComparison.stillFailingChecks — same rule, same reasoning.
  stillFailingChecks: string[];
}

// ===================== Chick rows =====================

export interface ChickRowComparison {
  label: string;
  expectedDeaths: number | null;
  actualDeaths: number | null;
  match: boolean;
}

export interface ChickRowsResult {
  rows: ChickRowComparison[];
  unmatchedExtracted: string[];
  note: string | null;
}

// ===================== Old reader (for side-by-side comparison) =====================

// Owner request, 2026-10-19: "so we know whether the new reader is
// actually better than what is live" — the SAME photo is also run through
// the existing readers (dailyProduction.ts for the flock tables,
// ledgerFeedExtraction.ts for the ledger/feed box — exactly what every
// real upload uses today) and scored against the SAME ground truth, with
// the SAME field comparison logic, so the numbers are directly
// comparable. The old reader has never read chick rows at all (its own
// prompt explicitly tells the model to ignore them), so there is no
// accuracy number to show for that — chickNote says so plainly instead of
// a misleading 0%.
export interface OldReaderComparison {
  summary: Record<ComparedField, { comparable: number; correct: number }>;
  marginNoteSummary: { comparable: number; correct: number };
  subtotalSummary: Record<SubtotalField, { comparable: number; correct: number }>;
  missingFromExtraction: string[];
  unmatchedExtractedLabels: string[];
  ledgerSummary: Record<LedgerField, { comparable: number; correct: number }>;
  feedBoxSummary: Record<FeedBoxField, { comparable: number; correct: number }>;
  chickNote: string;
  // Set instead of the above if the old reader itself failed outright
  // (e.g. its own runaway-count rejection) — still worth showing, since
  // "the old reader also can't read this photo" is itself a useful answer.
  error: string | null;
}

// ===================== Debug images =====================

// Owner request, 2026-10-21: "keep the debug page showing exactly what
// each call received" — now that there are no more model-drawn region
// boxes, this is: the whole upright page with the detected spine line
// drawn on it (so the split itself can be sanity-checked at a glance),
// the LEFT half exactly as sent to its extraction call, the RIGHT half
// exactly as sent to ITS call, and any crop sent for a checksum-guided
// retry. All downscaled for display only — the model itself always gets
// the full-resolution version these are derived from.
export interface DebugHalfImage {
  side: HalfSide;
  base64: string | null;
}

export interface DebugRetryImage {
  label: string; // e.g. "BAB-4 (flock row retry)" or "small ledger retry"
  base64: string | null;
}

// Owner request, 2026-10-21: "store the rotation chosen in the debug
// output" — what the orientation call said, what was actually applied,
// and whether the empty-half self-check had to turn the photo around.
export interface RotationDebug {
  textTopPointsTo: TextTop | null;
  modelRotationDegrees: Rotation | null;
  leftPageContentSaid: LeftPageContent;
  derivedRotationDegrees: Rotation;
  appliedRotationDegrees: Rotation;
  retriedWith180: boolean;
  attempts: AttemptSummary[];
  notes: string[];
}

export interface DebugImages {
  fullPageWithSpine: string | null; // base64 jpeg, spine line drawn; null if generation failed
  spineX: number;
  overlapPx: number;
  spineConfidence: "detected" | "fallback_midpoint";
  halves: DebugHalfImage[];
  retries: DebugRetryImage[];
  unavailableNote: string | null; // set when any debug image failed to generate
}

// ===================== Overall result =====================

export interface BenchmarkResult {
  // The date whose SAVED daily_production rows are being used as ground
  // truth (the route's own date).
  date: string;
  // The date whose STORED PHOTO was actually read — normally the same as
  // `date`, but can differ when comparing a misfiled photo against the
  // date it actually reads (see runBenchmarkForDate's photoDateOverride).
  photoDateUsed: string;
  photoUrl: string;
  v2DateRead: string | null;
  // True when the photo's own read date disagrees with `date` (the ground
  // truth being compared against) — the benchmark page shows this as a
  // red banner with a button to compare against the read date instead.
  dateMismatch: boolean;
  v2PageNotes: string | null;
  retryRoundsRun: number;
  retriedLabels: string[];
  rows: FlockComparison[];
  unmatchedExtractedLabels: string[];
  missingFromExtraction: string[];
  summary: Record<ComparedField, { comparable: number; correct: number }>;
  marginNoteSummary: { comparable: number; correct: number };

  subtotals: SubtotalComparison[];
  subtotalSummary: Record<SubtotalField, { comparable: number; correct: number }>;

  ledgers: LedgerComparison[];
  ledgerSummary: Record<LedgerField, { comparable: number; correct: number }>;
  ledgerRetryRounds: Record<EggStockSection, number>;

  feedBoxes: FeedBoxComparison[];
  feedBoxSummary: Record<FeedBoxField, { comparable: number; correct: number }>;
  feedBoxRetryRounds: Record<string, number>;

  chickRows: ChickRowsResult;

  oldReader: OldReaderComparison;
  debugImages: DebugImages;
  rotation: RotationDebug;
  // Non-null when both halves stayed empty even after the 180° retry — the
  // photo should be retaken; every table below is then empty by design.
  unreadable: string | null;
}

// Shared between the new reader's own detailed comparison and the old
// reader's side-by-side summary — same matching, same fields, same
// subtotal-sum-from-ground-truth logic, so the two numbers mean exactly
// the same thing and are safe to put next to each other.
function compareFlockTables(
  extractedFlocks: ExtractedFlockRow[],
  sectionSubtotals: Record<Section, SectionSubtotal | null>,
  dbRows: DbProductionRow[],
  activeLabels: ActiveLabel[],
  movementMagnitudeByFlock: Map<string, number>
): {
  rows: FlockComparison[];
  unmatchedExtractedLabels: string[];
  missingFromExtraction: string[];
  summary: Record<ComparedField, { comparable: number; correct: number }>;
  marginNoteSummary: { comparable: number; correct: number };
  subtotals: SubtotalComparison[];
  subtotalSummary: Record<SubtotalField, { comparable: number; correct: number }>;
} {
  const dbByFlockId = new Map(dbRows.map((r) => [r.flock_internal_id, r]));
  const matchedFlockIds = new Set<string>();
  const unmatchedExtractedLabels: string[] = [];
  const rows: FlockComparison[] = [];

  interface SectionAcc {
    mortality: number | null;
    feedBags: number | null;
    eggsTotal: number | null;
    birdPopulation: number | null;
    flockCount: number;
  }
  const sectionAcc: Record<Section, SectionAcc> = {
    main: { mortality: 0, feedBags: 0, eggsTotal: 0, birdPopulation: 0, flockCount: 0 },
    continuation: { mortality: 0, feedBags: 0, eggsTotal: 0, birdPopulation: 0, flockCount: 0 },
  };
  function addToSum(current: number | null, value: number | null): number | null {
    if (current === null || value === null) return null;
    return current + value;
  }

  for (const flock of extractedFlocks) {
    const match = matchFlockLabel(flock.display_label_as_written, activeLabels);
    const dbRow = match.flockInternalId ? dbByFlockId.get(match.flockInternalId) : undefined;
    if (!dbRow) {
      unmatchedExtractedLabels.push(flock.display_label_as_written);
      continue;
    }
    matchedFlockIds.add(dbRow.flock_internal_id);

    const fields = {} as Record<ComparedField, FieldComparison>;
    for (const field of COMPARED_FIELDS) {
      fields[field] = tableFieldComparison(field, dbValueFor(dbRow, field), flock[field]);
    }

    const expectedMagnitude = movementMagnitudeByFlock.get(dbRow.flock_internal_id) ?? 0;
    const actualMagnitude = firstIntInText(flock.margin_note);
    rows.push({
      label: flock.display_label_as_written,
      dbFlagged: dbRow.flagged,
      dbFlagReason: dbRow.flag_reason,
      fields,
      marginNote: {
        expectedMagnitude,
        actualText: flock.margin_note,
        actualMagnitude,
        match:
          (expectedMagnitude === 0 && actualMagnitude === null) ||
          (expectedMagnitude !== 0 && actualMagnitude === expectedMagnitude),
      },
    });

    const acc = sectionAcc[flock.section];
    acc.flockCount++;
    acc.mortality = addToSum(acc.mortality, dbRow.mortality);
    acc.feedBags = addToSum(acc.feedBags, dbRow.feed_bags);
    acc.eggsTotal = addToSum(acc.eggsTotal, dbRow.eggs_total);
    acc.birdPopulation = addToSum(acc.birdPopulation, dbRow.bird_population);
  }

  const missingFromExtraction = dbRows
    .filter((r) => !matchedFlockIds.has(r.flock_internal_id))
    .map((r) => r.display_label_as_written);

  const summary = {} as Record<ComparedField, { comparable: number; correct: number }>;
  for (const field of COMPARED_FIELDS) {
    const comparable = rows.filter((r) => r.fields[field].expected !== null || r.fields[field].actual !== null);
    summary[field] = { comparable: comparable.length, correct: comparable.filter((r) => r.fields[field].match).length };
  }
  const marginNoteSummary = {
    comparable: rows.length,
    correct: rows.filter((r) => r.marginNote.match).length,
  };

  const subtotals: SubtotalComparison[] = [];
  for (const section of ["main", "continuation"] as const) {
    const v2Subtotal = sectionSubtotals[section];
    const acc = sectionAcc[section];
    if (!v2Subtotal && acc.flockCount === 0) continue;

    const expectedHd =
      acc.eggsTotal !== null && acc.birdPopulation !== null && acc.birdPopulation > 0
        ? calcHd(acc.eggsTotal, acc.birdPopulation)
        : null;

    const fields = {
      mortality: fieldComparison(acc.mortality, v2Subtotal?.mortality ?? null),
      feed_bags: fieldComparison(acc.feedBags, v2Subtotal?.feed_bags ?? null),
      eggs_total: fieldComparison(acc.eggsTotal, v2Subtotal?.eggs ?? null),
      bird_population: fieldComparison(acc.birdPopulation, v2Subtotal?.bal_bird ?? null, BAL_BIRD_TOLERANCE),
      hd_percent: fieldComparison(expectedHd, v2Subtotal?.hd_percent ?? null, 0.5),
    };
    subtotals.push({ section, flocksUsedForExpected: acc.flockCount, fields });
  }
  const subtotalSummary = {} as Record<SubtotalField, { comparable: number; correct: number }>;
  for (const field of SUBTOTAL_FIELDS) {
    const comparable = subtotals.filter((s) => s.fields[field].expected !== null || s.fields[field].actual !== null);
    subtotalSummary[field] = { comparable: comparable.length, correct: comparable.filter((s) => s.fields[field].match).length };
  }

  return { rows, unmatchedExtractedLabels, missingFromExtraction, summary, marginNoteSummary, subtotals, subtotalSummary };
}

function sectionSubtotalsFromArray(arr: SectionSubtotal[]): Record<Section, SectionSubtotal | null> {
  return {
    main: arr.find((s) => s.section === "main") ?? null,
    continuation: arr.find((s) => s.section === "continuation") ?? null,
  };
}

// Owner request, 2026-10-19: the egg ledger and feed box now get the same
// checksum-guided retry the flock tables already had — up to this many
// rounds of "re-ask with a hint describing what didn't add up" before
// accepting whatever the last attempt produced. Revised 2026-10-21: the
// retry re-sends the WHOLE half-page image (the only image this stage has
// — see this file's own notes below), not a further sub-crop; with no
// real photo available to calibrate a tighter fixed-proportion crop
// against, resending the whole half can never miss the target, at the
// cost of a less-zoomed retry than a flock row-box retry gets.
const MAX_LEDGER_FEED_RETRIES = 2;

export async function runBenchmarkForDate(
  date: string,
  farmCode: string = ACTIVE_FARM,
  // Owner request, 2026-10-21: "offer a button to compare against the read
  // date instead" of the date a photo was mistakenly filed under. When
  // set, the STORED PHOTO is pulled from this date, but every comparison
  // still runs against `date`'s own saved rows.
  photoDateOverride?: string
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

  const photoDateUsed = photoDateOverride ?? date;

  async function findPhotoUrlFor(lookupDate: string): Promise<string | null> {
    if (lookupDate === date) {
      const own = dbRows.find((r) => r.source_photo_url)?.source_photo_url ?? null;
      if (own) return own;
    } else {
      const { rows: otherRows } = await pool.query(
        `SELECT source_photo_url FROM daily_production
          WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL AND source_photo_url IS NOT NULL
          LIMIT 1`,
        [farmCode, lookupDate]
      );
      if (otherRows[0]?.source_photo_url) return otherRows[0].source_photo_url as string;
    }
    const { rows: benchmarkPhotoRows } = await pool.query(
      `SELECT photo_url FROM reader_benchmark_photos WHERE farm_code = $1 AND date = $2`,
      [farmCode, lookupDate]
    );
    return (benchmarkPhotoRows[0]?.photo_url as string | undefined) ?? null;
  }

  const photoUrl = await findPhotoUrlFor(photoDateUsed);
  if (!photoUrl) {
    throw new Error(
      `${photoDateUsed} has no stored photo — use "Add a photo for the benchmark" on the list page first.`
    );
  }

  const photoResponse = await fetch(photoUrl);
  if (!photoResponse.ok) {
    throw new Error(`Couldn't download the stored photo for ${photoDateUsed} (HTTP ${photoResponse.status}).`);
  }
  const rawPhotoBuffer = Buffer.from(await photoResponse.arrayBuffer());
  const contentType = photoResponse.headers.get("content-type") || "image/jpeg";

  // Owner report, 2026-10-19: done ONCE, before anything else sees the
  // photo, so every subsequent step agrees on orientation — see
  // autoOrient.ts.
  const photoBuffer = await autoOrientPhoto(rawPhotoBuffer);

  // Orientation (low-res vision call) -> upright -> split -> read both
  // halves -> self-check (retry 180° if a half is empty) — the same shared
  // front half the real upload path uses (halfPipeline.ts).
  const read = await readPageHalves(photoBuffer);
  const { orientation, chosen } = read;
  const fullPage = chosen.fullPage;
  const split = chosen.split;
  const leftExtraction = chosen.left;
  const rightExtraction = chosen.right;
  const imageBySide: Record<HalfSide, { base64: string; mediaType: "image/jpeg" }> = {
    left: { base64: split.left.base64, mediaType: split.left.mediaType },
    right: { base64: split.right.base64, mediaType: split.right.mediaType },
  };

  const halves: HalfPageSource[] = [
    { side: "left", extraction: leftExtraction, imageBase64: split.left.base64, mediaType: "image/jpeg" },
    { side: "right", extraction: rightExtraction, imageBase64: split.right.base64, mediaType: "image/jpeg" },
  ];
  const halfResults: HalfResult[] = halves.map((h) => ({ side: h.side, extraction: h.extraction }));
  const tableSectionBySide = assignTableSections(halfResults);
  const ledgerBySection = assignLedgerSections(halfResults, tableSectionBySide);
  const feedBoxesFound = collectFeedBoxes(halfResults);
  const pageDate = pickDate(halfResults);
  const tableBlocks = await mergeTableBlocksFromHalves(halves);
  const activeLabels = await getActiveLabels(pool, farmCode, date);

  // Ground truth for margin notes: every real movement this farm recorded
  // for a flock on this date (any source — a margin note is the usual
  // origin, but this is deliberately not scoped to just that source so a
  // movement resolved to a different type still counts as "something was
  // really there").
  const { rows: movementRows } = await pool.query(
    `SELECT flock_internal_id, sum(abs(birds_change))::int AS total_magnitude
       FROM flock_movements
      WHERE farm_code = $1 AND date = $2
      GROUP BY flock_internal_id`,
    [farmCode, date]
  );
  const movementMagnitudeByFlock = new Map<string, number>(
    movementRows.map((r) => [r.flock_internal_id as string, Number(r.total_magnitude)])
  );

  const {
    rows,
    unmatchedExtractedLabels,
    missingFromExtraction,
    summary,
    marginNoteSummary,
    subtotals,
    subtotalSummary,
  } = compareFlockTables(tableBlocks.flocks, tableBlocks.subtotals, dbRows, activeLabels, movementMagnitudeByFlock);

  // ---- Old reader, same photo, same ground truth — see OldReaderComparison's own doc comment ----
  let oldFlockPart: {
    summary: Record<ComparedField, { comparable: number; correct: number }>;
    marginNoteSummary: { comparable: number; correct: number };
    subtotalSummary: Record<SubtotalField, { comparable: number; correct: number }>;
    missingFromExtraction: string[];
    unmatchedExtractedLabels: string[];
  } | null = null;
  let oldReaderError: string | null = null;
  try {
    const oldResult = await extractDailyProductionSafely(photoBuffer.toString("base64"), contentType, dbRows.length);
    const oldCompared = compareFlockTables(
      oldResult.flocks,
      sectionSubtotalsFromArray(oldResult.extraction.section_subtotals ?? []),
      dbRows,
      activeLabels,
      movementMagnitudeByFlock
    );
    oldFlockPart = {
      summary: oldCompared.summary,
      marginNoteSummary: oldCompared.marginNoteSummary,
      subtotalSummary: oldCompared.subtotalSummary,
      missingFromExtraction: oldCompared.missingFromExtraction,
      unmatchedExtractedLabels: oldCompared.unmatchedExtractedLabels,
    };
  } catch (err) {
    oldReaderError = err instanceof Error ? err.message : String(err);
  }

  // Owner request, 2026-10-19: extend old-vs-new to the ledger/feed box
  // too. Best-effort and independent of the flock-table call above — same
  // split the real upload flow itself uses (app/upload/actions.ts runs
  // this as a separate step; a failure here never affects the flock-table
  // result). Matched against ledgerDbRows/feedDbRows further down, once
  // those are fetched.
  let oldLedgerFeed: LedgerFeedExtractionResult | null = null;
  try {
    oldLedgerFeed = await extractLedgerAndFeed(photoBuffer.toString("base64"), contentType);
  } catch {
    oldLedgerFeed = null; // reported per-section as "not available" below, not a hard error
  }

  // ---- Egg ledger ----
  const { rows: ledgerDbRows } = await pool.query(
    `SELECT id, section, opening_balance_eggs, total_eggs_produced, total_line_eggs, closing_balance_eggs
       FROM daily_egg_stock_summary
      WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL`,
    [farmCode, date]
  );
  const ledgerDeductionsBySummaryId = new Map<number, { sequence_order: number; label_as_written: string; amount_eggs: number }[]>();
  if (ledgerDbRows.length > 0) {
    const { rows: deductionRows } = await pool.query(
      `SELECT egg_stock_summary_id, sequence_order, label_as_written, amount_eggs
         FROM daily_egg_stock_entries
        WHERE egg_stock_summary_id = ANY($1)
        ORDER BY egg_stock_summary_id, sequence_order`,
      [ledgerDbRows.map((r) => r.id)]
    );
    for (const d of deductionRows) {
      const list = ledgerDeductionsBySummaryId.get(d.egg_stock_summary_id) ?? [];
      list.push(d);
      ledgerDeductionsBySummaryId.set(d.egg_stock_summary_id, list);
    }
  }

  const ledgers: LedgerComparison[] = [];
  const ledgerRetryRounds = {} as Record<EggStockSection, number>;
  const oldLedgerComparisons: Record<LedgerField, FieldComparison>[] = [];
  const retryDebugImages: DebugRetryImage[] = [];

  for (const dbLedger of ledgerDbRows) {
    const section = dbLedger.section as EggStockSection;

    // Cross-day note (owner request, 2026-10-19): "keep opening = previous
    // closing as a cross-day warning only, never a retry trigger" — no
    // single photo can know yesterday's figure, and the owner has
    // confirmed real supervisor habits can legitimately break this chain.
    // Informational only; never affects any match/accuracy number above.
    const { rows: prevLedgerRows } = await pool.query(
      `SELECT closing_balance_eggs FROM daily_egg_stock_summary
        WHERE farm_code = $1 AND section = $2 AND date < $3 AND deleted_at IS NULL
        ORDER BY date DESC LIMIT 1`,
      [farmCode, section, date]
    );
    const prevClosing = prevLedgerRows[0]?.closing_balance_eggs ?? null;
    const crossDayNote =
      prevClosing !== null && dbLedger.opening_balance_eggs !== null && prevClosing !== dbLedger.opening_balance_eggs
        ? `Saved opening (${dbLedger.opening_balance_eggs}) doesn't match the previous day's saved closing (${prevClosing}) — may be a genuine re-count, not an error.`
        : null;

    // Same photo, old reader's own reading of this section, for the
    // side-by-side comparison — never affects anything the new reader is
    // scored on above.
    const oldLedgerRaw = oldLedgerFeed?.egg_ledgers.find((l) => l.section === section) ?? null;
    oldLedgerComparisons.push({
      opening_balance_eggs: fieldComparison(dbLedger.opening_balance_eggs, oldLedgerRaw?.opening_balance_eggs ?? null),
      total_eggs_produced: fieldComparison(dbLedger.total_eggs_produced, oldLedgerRaw?.total_eggs_produced ?? null),
      total_line_eggs: fieldComparison(dbLedger.total_line_eggs, oldLedgerRaw?.total_line_eggs ?? null),
      closing_balance_eggs: fieldComparison(dbLedger.closing_balance_eggs, oldLedgerRaw?.closing_balance_eggs ?? null),
    });

    // Owner request, 2026-10-21: mapped by CONTENT — the ledger under the
    // main table is the big one, under the continuation table the small
    // one, whichever half either sits on (contentMapping.ts).
    const mapped = ledgerBySection.get(section);
    const side: HalfSide = mapped?.side ?? "left";
    let v2Ledger = mapped?.ledger ?? null;
    if (!v2Ledger) {
      ledgers.push({
        section,
        fields: {
          opening_balance_eggs: fieldComparison(dbLedger.opening_balance_eggs, null),
          total_eggs_produced: fieldComparison(dbLedger.total_eggs_produced, null),
          total_line_eggs: fieldComparison(dbLedger.total_line_eggs, null),
          closing_balance_eggs: fieldComparison(dbLedger.closing_balance_eggs, null),
        },
        deductions: [],
        note: `The reader didn't find a ${section === "big" ? "big" : "small"} egg ledger on either half of this photo.`,
        stillFailingChecks: [],
        crossDayNote,
      });
      continue;
    }

    let ledgerRetries = 0;
    let finalFindings = checkEggLedgerArithmetic(v2Ledger);
    for (; ledgerRetries < MAX_LEDGER_FEED_RETRIES; ledgerRetries++) {
      if (finalFindings.length === 0) break;
      const hint =
        finalFindings.map((f) => f.message).join("; ") +
        `. You're looking at the WHOLE ${side} half of the page, not just the ledger — focus only on the ${section === "big" ? "big" : "small"} egg-stock ledger.`;
      v2Ledger = await extractEggLedgerRegion(imageBySide[side].base64, imageBySide[side].mediaType, section, { confusionHint: hint });
      finalFindings = checkEggLedgerArithmetic(v2Ledger);
      retryDebugImages.push({
        label: `${section} ledger retry round ${ledgerRetries + 1}`,
        base64: await safeDownscale(imageBySide[side].base64),
      });
    }
    ledgerRetryRounds[section] = ledgerRetries;
    const expectedDeductions = ledgerDeductionsBySummaryId.get(dbLedger.id) ?? [];
    const maxLen = Math.max(expectedDeductions.length, v2Ledger.deductions.length);
    const deductions: DeductionComparison[] = [];
    for (let i = 0; i < maxLen; i++) {
      const exp = expectedDeductions[i];
      const act = v2Ledger.deductions[i];
      const expAmount = exp ? Math.abs(exp.amount_eggs) : null; // stored signed (negative); magnitude is what's comparable
      const actAmount = act ? act.amount_eggs : null;
      deductions.push({
        position: i + 1,
        expectedLabel: exp?.label_as_written ?? null,
        expectedAmount: expAmount,
        actualLabel: act?.label_as_written ?? null,
        actualAmount: actAmount,
        match: expAmount !== null && actAmount !== null && expAmount === actAmount,
      });
    }

    ledgers.push({
      section,
      fields: {
        opening_balance_eggs: fieldComparison(dbLedger.opening_balance_eggs, v2Ledger.opening_balance_eggs),
        total_eggs_produced: fieldComparison(dbLedger.total_eggs_produced, v2Ledger.total_eggs_produced),
        total_line_eggs: fieldComparison(dbLedger.total_line_eggs, v2Ledger.total_line_eggs),
        closing_balance_eggs: fieldComparison(dbLedger.closing_balance_eggs, v2Ledger.closing_balance_eggs),
      },
      deductions,
      stillFailingChecks: finalFindings.map((f) => f.message),
      crossDayNote,
      note: v2Ledger.region_notes,
    });
  }
  const ledgerSummary = {} as BenchmarkResult["ledgerSummary"];
  for (const field of LEDGER_FIELDS) {
    const comparable = ledgers.filter((l) => l.fields[field].expected !== null || l.fields[field].actual !== null);
    ledgerSummary[field] = { comparable: comparable.length, correct: comparable.filter((l) => l.fields[field].match).length };
  }
  const oldLedgerSummary = {} as Record<LedgerField, { comparable: number; correct: number }>;
  for (const field of LEDGER_FIELDS) {
    const comparable = oldLedgerComparisons.filter((c) => c[field].expected !== null || c[field].actual !== null);
    oldLedgerSummary[field] = { comparable: comparable.length, correct: comparable.filter((c) => c[field].match).length };
  }

  // ---- Feed box ----
  const { rows: feedDbRows } = await pool.query(
    `SELECT flock_group, opening_balance_bags, produced_bags, total_bags, closing_balance_bags,
            consumed_bags, mill_inventory_bags, shed_inventory_bags
       FROM daily_feed_bag_stock
      WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL`,
    [farmCode, date]
  );
  const feedBoxes: FeedBoxComparison[] = [];
  const feedBoxRetryRounds: Record<string, number> = {};
  const oldFeedBoxComparisons: Record<FeedBoxField, FieldComparison>[] = [];
  // Old reader's own schema only ever asks for "BAB-1-7"/"BAB-8-10" — it
  // has no concept of a single box covering everyone. On an "ALL" day
  // there's genuinely only one real box, so if the old reader found
  // exactly one, that IS its reading of it, whatever label it guessed.
  function findOldFeedBox(groupLabel: FeedBoxGroupLabel) {
    const boxes = oldLedgerFeed?.feed_boxes ?? [];
    if (groupLabel === "ALL") return boxes.length === 1 ? boxes[0] : null;
    return boxes.find((b) => b.flock_group === groupLabel) ?? null;
  }
  // Owner request, 2026-10-21: feed boxes are collected from BOTH halves
  // and matched by the group each box says it covers — never by side.
  const v2FeedBoxes = feedBoxesFound.map((f) => f.box);
  for (const dbFeed of feedDbRows) {
    const groupLabel = dbFeed.flock_group as FeedBoxGroupLabel;

    const oldFeedRaw = findOldFeedBox(groupLabel);
    oldFeedBoxComparisons.push({
      opening_balance_bags: fieldComparison(dbFeed.opening_balance_bags, oldFeedRaw?.opening_balance_bags ?? null),
      produced_bags: fieldComparison(dbFeed.produced_bags, oldFeedRaw?.produced_bags ?? null),
      total_bags: fieldComparison(dbFeed.total_bags, oldFeedRaw?.total_bags ?? null),
      closing_balance_bags: fieldComparison(dbFeed.closing_balance_bags, oldFeedRaw?.closing_balance_bags ?? null),
      consumed_bags: fieldComparison(dbFeed.consumed_bags, oldFeedRaw?.consumed_bags ?? null),
      mill_inventory_bags: fieldComparison(dbFeed.mill_inventory_bags, oldFeedRaw?.mill_inventory_bags ?? null),
      shed_inventory_bags: fieldComparison(dbFeed.shed_inventory_bags, oldFeedRaw?.shed_inventory_bags ?? null),
    });

    const matching =
      groupLabel === "ALL"
        ? v2FeedBoxes.length === 1 ? v2FeedBoxes[0] : null
        : v2FeedBoxes.find((b) => b.coverage === groupLabel) ?? null;
    const emptyFields = (): Record<FeedBoxField, FieldComparison> => ({
      opening_balance_bags: fieldComparison(dbFeed.opening_balance_bags, null),
      produced_bags: fieldComparison(dbFeed.produced_bags, null),
      total_bags: fieldComparison(dbFeed.total_bags, null),
      closing_balance_bags: fieldComparison(dbFeed.closing_balance_bags, null),
      consumed_bags: fieldComparison(dbFeed.consumed_bags, null),
      mill_inventory_bags: fieldComparison(dbFeed.mill_inventory_bags, null),
      shed_inventory_bags: fieldComparison(dbFeed.shed_inventory_bags, null),
    });
    if (!matching) {
      feedBoxes.push({
        groupLabel,
        fields: emptyFields(),
        note: `The reader didn't find a feed box matching "${groupLabel}" on either half of this photo.`,
        stillFailingChecks: [],
      });
      continue;
    }

    const feedSide: HalfSide = feedBoxesFound.find((f) => f.box === matching)?.side ?? "left";
    let v2Feed = matching;
    let feedRetries = 0;
    let finalFeedFindings = checkFeedBoxArithmetic(v2Feed);
    for (; feedRetries < MAX_LEDGER_FEED_RETRIES; feedRetries++) {
      if (finalFeedFindings.length === 0) break;
      const hint =
        finalFeedFindings.map((f) => f.message).join("; ") +
        `. You're looking at the WHOLE ${feedSide} half of the page, not just one feed box — focus only on the box covering ${groupLabel}.`;
      v2Feed = { ...(await extractFeedBoxRegion(imageBySide[feedSide].base64, imageBySide[feedSide].mediaType, groupLabel, { confusionHint: hint })), coverage: groupLabel };
      finalFeedFindings = checkFeedBoxArithmetic(v2Feed);
      retryDebugImages.push({
        label: `${groupLabel} feed box retry round ${feedRetries + 1}`,
        base64: await safeDownscale(imageBySide[feedSide].base64),
      });
    }
    feedBoxRetryRounds[groupLabel] = feedRetries;
    feedBoxes.push({
      groupLabel,
      fields: {
        opening_balance_bags: fieldComparison(dbFeed.opening_balance_bags, v2Feed.opening_balance_bags),
        produced_bags: fieldComparison(dbFeed.produced_bags, v2Feed.produced_bags),
        total_bags: fieldComparison(dbFeed.total_bags, v2Feed.total_bags),
        closing_balance_bags: fieldComparison(dbFeed.closing_balance_bags, v2Feed.closing_balance_bags),
        consumed_bags: fieldComparison(dbFeed.consumed_bags, v2Feed.consumed_bags),
        mill_inventory_bags: fieldComparison(dbFeed.mill_inventory_bags, v2Feed.mill_inventory_bags),
        shed_inventory_bags: fieldComparison(dbFeed.shed_inventory_bags, v2Feed.shed_inventory_bags),
      },
      note: v2Feed.region_notes,
      stillFailingChecks: finalFeedFindings.map((f) => f.message),
    });
  }
  const feedBoxSummary = {} as BenchmarkResult["feedBoxSummary"];
  for (const field of FEED_BOX_FIELDS) {
    const comparable = feedBoxes.filter((f) => f.fields[field].expected !== null || f.fields[field].actual !== null);
    feedBoxSummary[field] = { comparable: comparable.length, correct: comparable.filter((f) => f.fields[field].match).length };
  }
  const oldFeedBoxSummary = {} as Record<FeedBoxField, { comparable: number; correct: number }>;
  for (const field of FEED_BOX_FIELDS) {
    const comparable = oldFeedBoxComparisons.filter((c) => c[field].expected !== null || c[field].actual !== null);
    oldFeedBoxSummary[field] = { comparable: comparable.length, correct: comparable.filter((c) => c[field].match).length };
  }

  // ---- Chick rows ----
  const { rows: chickDbRows } = await pool.query(
    `SELECT label_as_written, deaths FROM chick_daily_mortality WHERE farm_code = $1 AND date = $2 ORDER BY row_position`,
    [farmCode, date]
  );
  let chickRows: ChickRowsResult;
  // Chick rows are taken from whichever half actually returned them.
  const v2Chick = pickChickRows(halfResults);
  if (chickDbRows.length === 0) {
    chickRows = { rows: [], unmatchedExtracted: [], note: "No saved chick-row data for this date." };
  } else if (!v2Chick) {
    chickRows = {
      rows: chickDbRows.map((r) => ({ label: r.label_as_written, expectedDeaths: r.deaths, actualDeaths: null, match: false })),
      unmatchedExtracted: [],
      note: "The reader didn't find a chick-rows block on either half of this photo.",
    };
  } else {
    const usedActual = new Set<number>();
    const chickComparisons: ChickRowComparison[] = chickDbRows.map((dbRow) => {
      const dbToken = firstNumberToken(dbRow.label_as_written);
      const idx = v2Chick.rows.findIndex((r, i) => !usedActual.has(i) && firstNumberToken(r.label_as_written) === dbToken);
      if (idx === -1) {
        return { label: dbRow.label_as_written, expectedDeaths: dbRow.deaths, actualDeaths: null, match: false };
      }
      usedActual.add(idx);
      const actual = v2Chick.rows[idx];
      return {
        label: dbRow.label_as_written,
        expectedDeaths: dbRow.deaths,
        actualDeaths: actual.deaths,
        match: dbRow.deaths !== null && actual.deaths !== null && dbRow.deaths === actual.deaths,
      };
    });
    const unmatchedExtracted = v2Chick.rows
      .filter((_, i) => !usedActual.has(i))
      .map((r) => r.label_as_written);
    chickRows = { rows: chickComparisons, unmatchedExtracted, note: v2Chick.region_notes };
  }

  // ---- Debug images (owner request, 2026-10-19, revised 2026-10-21) ----
  // These are diagnostic extras, never load-bearing for the benchmark's
  // actual accuracy numbers — any failure here degrades to "debug picture
  // unavailable" rather than failing the whole page.
  let fullPageWithSpine: string | null = null;
  let debugImagesUnavailableNote: string | null = null;
  try {
    fullPageWithSpine = (await drawSpineLine(fullPage.base64, split.spineX)).base64;
  } catch (err) {
    debugImagesUnavailableNote = `Full-page debug image unavailable: ${err instanceof Error ? err.message : String(err)}`;
  }
  const debugHalves: DebugHalfImage[] = await Promise.all(
    (["left", "right"] as const).map(async (side) => {
      try {
        return { side, base64: await downscaleForDisplay(imageBySide[side].base64) };
      } catch (err) {
        if (!debugImagesUnavailableNote) {
          debugImagesUnavailableNote = `Some half-page debug images unavailable: ${err instanceof Error ? err.message : String(err)}`;
        }
        return { side, base64: null };
      }
    })
  );

  const emptyFieldSummary = { comparable: 0, correct: 0 };
  const oldReader: OldReaderComparison = oldFlockPart
    ? {
        ...oldFlockPart,
        ledgerSummary: oldLedgerSummary,
        feedBoxSummary: oldFeedBoxSummary,
        chickNote: "The old reader doesn't read chick rows at all — there is nothing to compare here.",
        error: null,
      }
    : {
        summary: {
          mortality: emptyFieldSummary, feed_bags: emptyFieldSummary, eggs_total: emptyFieldSummary,
          bird_population: emptyFieldSummary, hd_percent: emptyFieldSummary,
        },
        marginNoteSummary: emptyFieldSummary,
        subtotalSummary: {
          mortality: emptyFieldSummary, feed_bags: emptyFieldSummary, eggs_total: emptyFieldSummary,
          bird_population: emptyFieldSummary, hd_percent: emptyFieldSummary,
        },
        missingFromExtraction: [],
        unmatchedExtractedLabels: [],
        ledgerSummary: oldLedgerSummary,
        feedBoxSummary: oldFeedBoxSummary,
        chickNote: "The old reader doesn't read chick rows at all — there is nothing to compare here.",
        error: oldReaderError,
      };

  return {
    date,
    photoDateUsed,
    photoUrl,
    v2DateRead: pageDate.date,
    dateMismatch: pageDate.date !== null && pageDate.date !== date,
    v2PageNotes: [orientation.pageNotes, ...read.notes, ...tableBlocks.regionNotes].filter((n): n is string => !!n).join(" ") || null,
    retryRoundsRun: tableBlocks.retryRoundsRun,
    retriedLabels: tableBlocks.retriedLabels,
    rows,
    unmatchedExtractedLabels,
    missingFromExtraction,
    summary,
    marginNoteSummary,
    subtotals,
    subtotalSummary,
    ledgers,
    ledgerSummary,
    ledgerRetryRounds,
    feedBoxes,
    feedBoxSummary,
    feedBoxRetryRounds,
    chickRows,
    oldReader,
    debugImages: {
      fullPageWithSpine,
      spineX: split.spineX,
      overlapPx: split.overlapPx,
      spineConfidence: split.spineConfidence,
      halves: debugHalves,
      retries: retryDebugImages,
      unavailableNote: debugImagesUnavailableNote,
    },
    rotation: {
      textTopPointsTo: orientation.textTopPointsTo,
      modelRotationDegrees: orientation.modelRotationDegrees,
      leftPageContentSaid: orientation.leftPageContent,
      derivedRotationDegrees: orientation.rotationDegrees,
      appliedRotationDegrees: chosen.rotationApplied,
      retriedWith180: read.retriedWith180,
      attempts: read.attempts,
      notes: read.notes,
    },
    unreadable: read.unreadable ? UNREADABLE_MESSAGE : null,
  };
}

async function safeDownscale(base64: string): Promise<string | null> {
  try {
    return await downscaleForDisplay(base64);
  } catch {
    return null;
  }
}

export { COMPARED_FIELDS, FIELD_LABELS, SUBTOTAL_FIELDS, LEDGER_FIELDS, FEED_BOX_FIELDS };
export type { ComparedField, SubtotalField, LedgerField, FeedBoxField };
