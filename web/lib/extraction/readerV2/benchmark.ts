import { pool } from "../../db";
import { ACTIVE_FARM } from "../../farm";
import { extractDailyProductionSafely, type ExtractedFlockRow } from "../dailyProduction";
import { extractLedgerAndFeed, type LedgerFeedExtractionResult } from "../ledgerFeedExtraction";
import { matchFlockLabel, type ActiveLabel } from "../flockMatch";
import { BAL_BIRD_TOLERANCE, type Section, type SectionSubtotal } from "../pageChecksum";
import { calcHd } from "../digitEvidence";
import type { EggStockSection } from "../../eggstock-types";
import { autoOrientPhoto } from "./autoOrient";
import { readPageHalves, UNREADABLE_MESSAGE, type AttemptSummary, type PipelineDeps } from "./halfPipeline";
import type { LeftPageContent, Rotation, TextTop } from "./pageOrientation";
import type { HalfSide } from "./pageHalfRegion";
import { pickChickRows, pickDate, type HalfResult } from "./contentMapping";
import type { ExtractedEggLedgerRegion } from "./ledgerRegion";
import type { ExtractedFeedBoxRegion, FeedBoxGroupLabel } from "./feedBoxRegion";
import {
  buildRawPage,
  runCorrectionStages,
  type CellOutcome,
  type CorrectionDeps,
  type CorrectionReport,
  type FeedBoxEntry,
} from "./corrections";
import {
  dbSavedData,
  type DbProductionRow,
  type SavedDataSource,
  type SavedFeedRow,
  type SavedLedgerRow,
} from "./savedData";
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
  // What the reader's RAW output (before the correction stages) read for
  // this same cell — present on the corrected result only.
  raw?: { actual: number | null; match: boolean };
}

export interface Tally {
  comparable: number;
  correct: number;
}

// Everything scored for one variant of the reader's output (raw, or
// after the correction stages). `overall` counts every compared cell —
// flock fields, subtotal fields, ledger fields, ledger deductions and
// feed-box fields — but not margin notes (reported on their own).
export interface ScoreSummary {
  flocks: Record<ComparedField, Tally>;
  marginNotes: Tally;
  subtotals: Record<SubtotalField, Tally>;
  ledgers: Record<LedgerField, Tally>;
  deductions: Tally;
  feedBoxes: Record<FeedBoxField, Tally>;
  overall: Tally;
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
  // Shown at the top of the benchmark as "Comparing against saved data of
  // <date>" (owner request, 2026-10-21).
  savedDataDate: string;
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
  // Owner request, 2026-10-21: score BOTH the raw reader output and the
  // output after the correction stages. The tables above show the
  // corrected result (with each cell's raw reading attached as `raw`).
  rawScores: ScoreSummary;
  correctedScores: ScoreSummary;
  correction: CorrectionReport;
  // Cells still wrong after correction that were NOT flagged needs-review —
  // the list the "loop until every cell is correct or flagged" rule drives
  // to empty.
  unflaggedWrong: string[];
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

export interface BenchmarkOptions {
  // Where the SAVED values come from. Defaults to the live database; the
  // offline runner passes a JSON export instead (savedData.ts).
  source?: SavedDataSource;
  // Use this photo instead of downloading the saved photo URL.
  photoBuffer?: Buffer;
  photoContentType?: string;
  // The old-reader side-by-side costs two more vision calls per photo.
  skipOldReader?: boolean;
  pipelineDeps?: PipelineDeps;
  correctionDeps?: CorrectionDeps;
}

interface LedgerCells {
  fields: Record<LedgerField, FieldComparison>;
  deductions: DeductionComparison[];
}

function compareLedger(db: SavedLedgerRow, v2: ExtractedEggLedgerRegion | null): LedgerCells {
  const fields = {
    opening_balance_eggs: fieldComparison(db.opening_balance_eggs, v2?.opening_balance_eggs ?? null),
    total_eggs_produced: fieldComparison(db.total_eggs_produced, v2?.total_eggs_produced ?? null),
    total_line_eggs: fieldComparison(db.total_line_eggs, v2?.total_line_eggs ?? null),
    closing_balance_eggs: fieldComparison(db.closing_balance_eggs, v2?.closing_balance_eggs ?? null),
  };
  const actualDeductions = v2?.deductions ?? [];
  const maxLen = Math.max(db.deductions.length, actualDeductions.length);
  const deductions: DeductionComparison[] = [];
  for (let i = 0; i < maxLen; i++) {
    const exp = db.deductions[i];
    const act = actualDeductions[i];
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
  return { fields, deductions };
}

function compareFeed(db: SavedFeedRow, v2: ExtractedFeedBoxRegion | null): Record<FeedBoxField, FieldComparison> {
  return {
    opening_balance_bags: fieldComparison(db.opening_balance_bags, v2?.opening_balance_bags ?? null),
    produced_bags: fieldComparison(db.produced_bags, v2?.produced_bags ?? null),
    total_bags: fieldComparison(db.total_bags, v2?.total_bags ?? null),
    closing_balance_bags: fieldComparison(db.closing_balance_bags, v2?.closing_balance_bags ?? null),
    consumed_bags: fieldComparison(db.consumed_bags, v2?.consumed_bags ?? null),
    mill_inventory_bags: fieldComparison(db.mill_inventory_bags, v2?.mill_inventory_bags ?? null),
    shed_inventory_bags: fieldComparison(db.shed_inventory_bags, v2?.shed_inventory_bags ?? null),
  };
}

function findFeedEntry(entries: FeedBoxEntry[], group: FeedBoxGroupLabel): FeedBoxEntry | null {
  if (group === "ALL") return entries.length === 1 ? entries[0] : null;
  return entries.find((e) => e.group === group) ?? null;
}

function tally<K extends string>(keys: readonly K[], items: Record<K, FieldComparison>[]): Record<K, Tally> {
  const out = {} as Record<K, Tally>;
  for (const k of keys) {
    const comparable = items.filter((i) => i[k].expected !== null || i[k].actual !== null);
    out[k] = { comparable: comparable.length, correct: comparable.filter((i) => i[k].match).length };
  }
  return out;
}

function sumTallies(...ts: Tally[]): Tally {
  return ts.reduce((a, t) => ({ comparable: a.comparable + t.comparable, correct: a.correct + t.correct }), { comparable: 0, correct: 0 });
}

function buildScore(
  flock: ReturnType<typeof compareFlockTables>,
  ledgers: LedgerCells[],
  feeds: Record<FeedBoxField, FieldComparison>[]
): ScoreSummary {
  const deductionItems = ledgers.flatMap((l) => l.deductions);
  const deductions: Tally = { comparable: deductionItems.length, correct: deductionItems.filter((d) => d.match).length };
  const ledgerTally = tally(LEDGER_FIELDS, ledgers.map((l) => l.fields));
  const feedTally = tally(FEED_BOX_FIELDS, feeds);
  return {
    flocks: flock.summary,
    marginNotes: flock.marginNoteSummary,
    subtotals: flock.subtotalSummary,
    ledgers: ledgerTally,
    deductions,
    feedBoxes: feedTally,
    overall: sumTallies(
      ...Object.values(flock.summary),
      ...Object.values(flock.subtotalSummary),
      ...Object.values(ledgerTally),
      deductions,
      ...Object.values(feedTally)
    ),
  };
}

// Which compared cells were flagged "needs review" by the correction stage.
function flaggedCells(outcomes: CellOutcome[], flocks: { display_label_as_written: string; section: Section }[]) {
  const keys = new Set<string>();
  for (const o of outcomes) {
    if (o.status !== "needs_review") continue;
    if (o.item.endsWith(" table") && o.field.startsWith("sum:")) {
      const section = o.item.startsWith("main") ? "main" : "continuation";
      const key = o.field.slice(4);
      if (key === "*") for (const f of SUBTOTAL_FIELDS) keys.add(`sub:${section}|${f}`);
      const flockField: Record<string, ComparedField> = { eggs: "eggs_total", mortality: "mortality", feed_bags: "feed_bags" };
      const subField: Record<string, SubtotalField> = { eggs: "eggs_total", mortality: "mortality", feed_bags: "feed_bags", bal_bird: "bird_population", hd_percent: "hd_percent" };
      if (subField[key]) keys.add(`sub:${section}|${subField[key]}`);
      if (flockField[key]) for (const f of flocks.filter((x) => x.section === section)) keys.add(`${f.display_label_as_written}|${flockField[key]}`);
    } else if (o.item.startsWith("subtotal ")) {
      const section = o.item.split(" ")[1];
      const subField: Record<string, SubtotalField> = { eggs: "eggs_total", mortality: "mortality", feed_bags: "feed_bags", bal_bird: "bird_population", hd_percent: "hd_percent" };
      keys.add(`sub:${section}|${subField[o.field] ?? o.field}`);
    } else if (o.item.endsWith(" ledger")) {
      keys.add(`ledger:${o.item.split(" ")[0]}|*`);
    } else if (o.item.endsWith(" feed box")) {
      keys.add(`feed:${o.item.split(" ")[0]}|*`);
    } else {
      keys.add(`${o.item}|${o.field}`);
    }
  }
  return keys;
}

export async function runBenchmarkForDate(
  date: string,
  farmCode: string = ACTIVE_FARM,
  // Owner request, 2026-10-21: "offer a button to compare against the read
  // date instead" of the date a photo was mistakenly filed under. When
  // set, the STORED PHOTO is pulled from this date, but every comparison
  // still runs against `date`'s own saved rows.
  photoDateOverride?: string,
  opts: BenchmarkOptions = {}
): Promise<BenchmarkResult> {
  const source = opts.source ?? dbSavedData(pool, farmCode);
  const dbRows = await source.production(date);
  if (dbRows.length === 0) {
    throw new Error(`No saved daily_production rows for ${date} — nothing to benchmark against.`);
  }

  const photoDateUsed = photoDateOverride ?? date;
  let photoUrl: string | null = null;
  if (photoDateUsed === date) photoUrl = dbRows.find((r) => r.source_photo_url)?.source_photo_url ?? null;
  photoUrl = photoUrl ?? (await source.photoUrl(photoDateUsed));
  if (!photoUrl && !opts.photoBuffer) {
    throw new Error(
      `${photoDateUsed} has no stored photo — use "Add a photo for the benchmark" on the list page first.`
    );
  }

  let rawPhotoBuffer: Buffer;
  let contentType = opts.photoContentType ?? "image/jpeg";
  if (opts.photoBuffer) {
    rawPhotoBuffer = opts.photoBuffer;
  } else {
    const photoResponse = await fetch(photoUrl as string);
    if (!photoResponse.ok) {
      throw new Error(`Couldn't download the stored photo for ${photoDateUsed} (HTTP ${photoResponse.status}).`);
    }
    rawPhotoBuffer = Buffer.from(await photoResponse.arrayBuffer());
    contentType = photoResponse.headers.get("content-type") || "image/jpeg";
  }

  // Owner report, 2026-10-19: done ONCE, before anything else sees the
  // photo, so every subsequent step agrees on orientation — see
  // autoOrient.ts.
  const photoBuffer = await autoOrientPhoto(rawPhotoBuffer);

  // Orientation (low-res vision call) -> upright -> split -> read both
  // halves -> self-check (retry 180° if a half is empty) — the same shared
  // front half the real upload path uses (halfPipeline.ts).
  const read = await readPageHalves(photoBuffer, opts.pipelineDeps);
  const { orientation, chosen } = read;
  const fullPage = chosen.fullPage;
  const split = chosen.split;
  const imageBySide: Record<HalfSide, { base64: string; mediaType: "image/jpeg" }> = {
    left: { base64: split.left.base64, mediaType: split.left.mediaType },
    right: { base64: split.right.base64, mediaType: split.right.mediaType },
  };

  const halfResults: HalfResult[] = [
    { side: "left", extraction: chosen.left },
    { side: "right", extraction: chosen.right },
  ];
  const pageDate = pickDate(halfResults);
  const activeLabels = await source.activeLabels(date);
  const movementMagnitudeByFlock = await source.movementMagnitudes(date);
  const previousDay = await source.previousDay(date);

  // ---- RAW page, then the correction stages (owner request, 2026-10-21) ----
  const rawPage = buildRawPage(halfResults);
  const { corrected, report } = read.unreadable
    ? { corrected: rawPage, report: { outcomes: [], rereadCalls: 0, warnings: [], log: [] } as CorrectionReport }
    : await runCorrectionStages(
        rawPage,
        {
          prevBird: previousDay.birdByLabel,
          prevLedgerClosing: previousDay.ledgerClosing,
          prevFeedClosing: previousDay.feedClosing as Partial<Record<FeedBoxGroupLabel, number | null>>,
          images: imageBySide,
        },
        opts.correctionDeps
      );

  const rawFlockCompare = compareFlockTables(rawPage.flocks, rawPage.subtotals, dbRows, activeLabels, movementMagnitudeByFlock);
  const flockCompare = compareFlockTables(corrected.flocks, corrected.subtotals, dbRows, activeLabels, movementMagnitudeByFlock);
  const { rows, unmatchedExtractedLabels, missingFromExtraction, summary, marginNoteSummary, subtotals, subtotalSummary } = flockCompare;

  // Attach each cell's RAW reading to the corrected table, so a corrected
  // cell can show what it was before.
  const rawRowByLabel = new Map(rawFlockCompare.rows.map((r) => [r.label, r]));
  for (const row of rows) {
    const rawRow = rawRowByLabel.get(row.label);
    if (!rawRow) continue;
    for (const field of COMPARED_FIELDS) row.fields[field].raw = { actual: rawRow.fields[field].actual, match: rawRow.fields[field].match };
  }
  const rawSubBySection = new Map(rawFlockCompare.subtotals.map((s) => [s.section, s]));
  for (const sub of subtotals) {
    const rawSub = rawSubBySection.get(sub.section);
    if (!rawSub) continue;
    for (const field of SUBTOTAL_FIELDS) sub.fields[field].raw = { actual: rawSub.fields[field].actual, match: rawSub.fields[field].match };
  }

  // ---- Old reader, same photo, same ground truth — see OldReaderComparison's own doc comment ----
  let oldFlockPart: {
    summary: Record<ComparedField, { comparable: number; correct: number }>;
    marginNoteSummary: { comparable: number; correct: number };
    subtotalSummary: Record<SubtotalField, { comparable: number; correct: number }>;
    missingFromExtraction: string[];
    unmatchedExtractedLabels: string[];
  } | null = null;
  let oldReaderError: string | null = opts.skipOldReader ? "Skipped for this run (it costs two more vision calls per photo)." : null;
  let oldLedgerFeed: LedgerFeedExtractionResult | null = null;
  if (!opts.skipOldReader) {
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
    try {
      oldLedgerFeed = await extractLedgerAndFeed(photoBuffer.toString("base64"), contentType);
    } catch {
      oldLedgerFeed = null; // reported per-section as "not available" below, not a hard error
    }
  }

  const outcomesFor = (item: string) => report.outcomes.filter((o) => o.item === item);
  const reviewMessages = (item: string) => outcomesFor(item).filter((o) => o.status === "needs_review").map((o) => o.note);

  // ---- Egg ledger ----
  const ledgerDbRows = await source.ledgers(date);
  const ledgers: LedgerComparison[] = [];
  const ledgerRetryRounds = {} as Record<EggStockSection, number>;
  const oldLedgerComparisons: Record<LedgerField, FieldComparison>[] = [];
  const rawLedgerCells: LedgerCells[] = [];
  const correctedLedgerCells: LedgerCells[] = [];

  for (const dbLedger of ledgerDbRows) {
    const section = dbLedger.section;

    // Cross-day note (owner request, 2026-10-19): "keep opening = previous
    // closing as a cross-day warning only, never a retry trigger".
    const prevClosing = await source.previousLedgerClosing(section, date);
    const crossDayNote =
      prevClosing !== null && dbLedger.opening_balance_eggs !== null && prevClosing !== dbLedger.opening_balance_eggs
        ? `Saved opening (${dbLedger.opening_balance_eggs}) doesn't match the previous day's saved closing (${prevClosing}) — may be a genuine re-count, not an error.`
        : null;

    const oldLedgerRaw = oldLedgerFeed?.egg_ledgers.find((l) => l.section === section) ?? null;
    oldLedgerComparisons.push({
      opening_balance_eggs: fieldComparison(dbLedger.opening_balance_eggs, oldLedgerRaw?.opening_balance_eggs ?? null),
      total_eggs_produced: fieldComparison(dbLedger.total_eggs_produced, oldLedgerRaw?.total_eggs_produced ?? null),
      total_line_eggs: fieldComparison(dbLedger.total_line_eggs, oldLedgerRaw?.total_line_eggs ?? null),
      closing_balance_eggs: fieldComparison(dbLedger.closing_balance_eggs, oldLedgerRaw?.closing_balance_eggs ?? null),
    });

    const rawCells = compareLedger(dbLedger, rawPage.ledgers.get(section)?.ledger ?? null);
    const v2Ledger = corrected.ledgers.get(section)?.ledger ?? null;
    const cells = compareLedger(dbLedger, v2Ledger);
    rawLedgerCells.push(rawCells);
    correctedLedgerCells.push(cells);
    for (const f of LEDGER_FIELDS) cells.fields[f].raw = { actual: rawCells.fields[f].actual, match: rawCells.fields[f].match };

    ledgerRetryRounds[section] = outcomesFor(`${section} ledger`).filter((o) => o.status === "reread").length;
    ledgers.push({
      section,
      fields: cells.fields,
      deductions: cells.deductions,
      stillFailingChecks: reviewMessages(`${section} ledger`),
      crossDayNote,
      note: v2Ledger
        ? v2Ledger.region_notes
        : `The reader didn't find a ${section === "big" ? "big" : "small"} egg ledger on either half of this photo, even after a zoomed re-read.`,
    });
  }
  const ledgerSummary = tally(LEDGER_FIELDS, ledgers.map((l) => l.fields));
  const oldLedgerSummary = tally(LEDGER_FIELDS, oldLedgerComparisons);

  // ---- Feed box ----
  const feedDbRows = await source.feed(date);
  const feedBoxes: FeedBoxComparison[] = [];
  const feedBoxRetryRounds: Record<string, number> = {};
  const oldFeedBoxComparisons: Record<FeedBoxField, FieldComparison>[] = [];
  const rawFeedCells: Record<FeedBoxField, FieldComparison>[] = [];
  const correctedFeedCells: Record<FeedBoxField, FieldComparison>[] = [];
  function findOldFeedBox(groupLabel: FeedBoxGroupLabel) {
    const boxes = oldLedgerFeed?.feed_boxes ?? [];
    if (groupLabel === "ALL") return boxes.length === 1 ? boxes[0] : null;
    return boxes.find((b) => b.flock_group === groupLabel) ?? null;
  }
  for (const dbFeed of feedDbRows) {
    const groupLabel = dbFeed.flock_group as FeedBoxGroupLabel;
    const oldFeedRaw = findOldFeedBox(groupLabel);
    oldFeedBoxComparisons.push(compareFeed(dbFeed, oldFeedRaw as unknown as ExtractedFeedBoxRegion | null));

    const rawEntry = findFeedEntry(rawPage.feedBoxes, groupLabel);
    const entry = findFeedEntry(corrected.feedBoxes, groupLabel);
    const rawCells = compareFeed(dbFeed, rawEntry?.box ?? null);
    const cells = compareFeed(dbFeed, entry?.box ?? null);
    rawFeedCells.push(rawCells);
    correctedFeedCells.push(cells);
    for (const f of FEED_BOX_FIELDS) cells[f].raw = { actual: rawCells[f].actual, match: rawCells[f].match };

    feedBoxRetryRounds[groupLabel] = outcomesFor(`${groupLabel} feed box`).filter((o) => o.status === "reread").length;
    feedBoxes.push({
      groupLabel,
      fields: cells,
      note: entry
        ? [entry.box.region_notes, entry.assignedBy !== "as_read" ? `Identified as ${groupLabel} by ${entry.assignedBy.replace(/_/g, " ")} (box #${entry.index + 1} from the left).` : null].filter(Boolean).join(" ") || null
        : `The reader didn't find a feed box matching "${groupLabel}" on either half of this photo.`,
      stillFailingChecks: reviewMessages(`${groupLabel} feed box`),
    });
  }
  const feedBoxSummary = tally(FEED_BOX_FIELDS, feedBoxes.map((f) => f.fields));
  const oldFeedBoxSummary = tally(FEED_BOX_FIELDS, oldFeedBoxComparisons);

  // ---- Raw vs corrected scores ----
  const rawScores = buildScore(rawFlockCompare, rawLedgerCells, rawFeedCells);
  const correctedScores = buildScore(flockCompare, correctedLedgerCells, correctedFeedCells);

  // Every wrong cell must be either gone or flagged: list the ones that
  // are still wrong WITHOUT a needs-review flag.
  const flagged = flaggedCells(report.outcomes, corrected.flocks);
  const unflaggedWrong: string[] = [];
  for (const r of rows) for (const f of COMPARED_FIELDS) {
    if (!r.fields[f].match && !flagged.has(`${r.label}|${f}`)) unflaggedWrong.push(`${r.label} ${FIELD_LABELS[f]}: read ${r.fields[f].actual ?? "—"}, saved ${r.fields[f].expected ?? "—"}`);
  }
  for (const s of subtotals) for (const f of SUBTOTAL_FIELDS) {
    if (!s.fields[f].match && !flagged.has(`sub:${s.section}|${f}`)) unflaggedWrong.push(`${s.section} subtotal ${FIELD_LABELS[f]}: read ${s.fields[f].actual ?? "—"}, expected ${s.fields[f].expected ?? "—"}`);
  }
  for (const l of ledgers) {
    if (flagged.has(`ledger:${l.section}|*`)) continue;
    for (const f of LEDGER_FIELDS) if (!l.fields[f].match) unflaggedWrong.push(`${l.section} ledger ${f}: read ${l.fields[f].actual ?? "—"}, saved ${l.fields[f].expected ?? "—"}`);
    for (const d of l.deductions) if (!d.match) unflaggedWrong.push(`${l.section} ledger deduction ${d.position}: read ${d.actualAmount ?? "—"}, saved ${d.expectedAmount ?? "—"}`);
  }
  for (const fb of feedBoxes) {
    if (flagged.has(`feed:${fb.groupLabel}|*`)) continue;
    for (const f of FEED_BOX_FIELDS) if (!fb.fields[f].match) unflaggedWrong.push(`${fb.groupLabel} feed box ${f}: read ${fb.fields[f].actual ?? "—"}, saved ${fb.fields[f].expected ?? "—"}`);
  }

  // ---- Chick rows ----
  const chickDbRows = await source.chick(date);
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
    savedDataDate: date,
    photoDateUsed,
    photoUrl: photoUrl ?? "(local file)",
    v2DateRead: pageDate.date,
    dateMismatch: pageDate.date !== null && pageDate.date !== date,
    v2PageNotes: [orientation.pageNotes, ...read.notes].filter((n): n is string => !!n).join(" ") || null,
    retryRoundsRun: report.rereadCalls,
    retriedLabels: [...new Set(report.outcomes.filter((o) => o.status === "reread").map((o) => o.item))],
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
    rawScores,
    correctedScores,
    correction: report,
    unflaggedWrong,
    debugImages: {
      fullPageWithSpine,
      spineX: split.spineX,
      overlapPx: split.overlapPx,
      spineConfidence: split.spineConfidence,
      halves: debugHalves,
      retries: [],
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

export { COMPARED_FIELDS, FIELD_LABELS, SUBTOTAL_FIELDS, LEDGER_FIELDS, FEED_BOX_FIELDS };
export type { ComparedField, SubtotalField, LedgerField, FeedBoxField };
