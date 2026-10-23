import { ExtractionRejected, type ExtractedFlockRow, type ExtractionResult } from "../dailyProduction";
import { dedupeByNormalizedLabel } from "../flockMatch";
import { checkPageChecksums, type Section, type SectionFlock, type SectionSubtotal } from "../pageChecksum";
import { autoOrientPhoto } from "./autoOrient";
import { recropForRetry } from "./crop";
import { type HalfSide, type PageHalfExtraction } from "./pageHalfRegion";
import { readPageHalves, UNREADABLE_MESSAGE } from "./halfPipeline";
import { assignTableSections, pickDate } from "./contentMapping";
import { extractDailyProductionRegion } from "./dailyProductionRegion";
import type { NormalizedBox } from "./types";

// Reader rebuild orchestrator — Daily Production side only (the egg
// ledger/feed box/chick-rows extraction this same half-page call also
// returns is a benchmark-only extension so far; see benchmark.ts). Revised
// 2026-10-21 (owner report — Aug 3 photo filed under Aug 8, every
// model-drawn region box wrong): the page-layout call no longer guesses
// bounding boxes at all. Instead the photo is rotated upright, split at
// its physical spine into two full-resolution halves by pageSplit.ts
// (pure image math, no model guessing), and each half is read in full by
// ONE call (pageHalfRegion.ts). Checksum-guided retries still zoom into a
// single flock's own row — just from the half image now, not a
// region crop.
//
// Produces the EXACT SAME `ExtractionResult` shape app/upload/actions.ts
// already knows how to save through pipeline.ts, writeDailyProduction.ts,
// etc. — none of that downstream code changes.
//
// Gated entirely behind READER_V2_ENABLED (app/upload/actions.ts) — the
// existing single-call reader (dailyProduction.ts) stays the production
// default until the benchmark page proves this one's accuracy and the
// owner approves it.

const MAX_RETRY_ROUNDS = 3;

interface WorkingFlock extends ExtractedFlockRow {
  rowBox: NormalizedBox; // relative to the HALF image named by `side`
  ambiguousDigits: string | null;
  side: HalfSide;
}

// Structural shape shared by both HalfFlockRow (pageHalfRegion.ts, the
// first pass) and RegionFlockRow (dailyProductionRegion.ts, the retry
// call) — intentionally identical field-for-field, so a retry's result
// converts the same way the first pass's did, with no cast needed.
interface FlockLikeRow {
  display_label_as_written: string;
  mortality: number | null;
  feed_bags: number | null;
  eggs_total: number | null;
  eggs_ii: number | null;
  bird_population: number | null;
  bird_population_readings: (number | null)[];
  hd_percent: number | null;
  margin_note: string | null;
  confidence: {
    display_label: number;
    mortality: number;
    feed_bags: number;
    eggs_total: number;
    bird_population: number;
    hd_percent: number;
  };
  ambiguous_digits: string | null;
  row_box: NormalizedBox;
}

export interface ReaderV2Result {
  extraction: ExtractionResult;
  flocks: ExtractedFlockRow[];
  // Diagnostic-only: how many checksum-driven retry rounds actually ran,
  // and which flocks got re-asked — surfaced so the benchmark page and
  // Vercel logs can show this without guessing.
  retryRoundsRun: number;
  retriedLabels: string[];
}

function halfFlockToWorking(f: FlockLikeRow, section: Section, side: HalfSide): WorkingFlock {
  return {
    display_label_as_written: f.display_label_as_written,
    section,
    mortality: f.mortality,
    feed_bags: f.feed_bags,
    eggs_total: f.eggs_total,
    eggs_ii: f.eggs_ii,
    bird_population: f.bird_population,
    bird_population_readings: Array.isArray(f.bird_population_readings) ? f.bird_population_readings : [],
    hd_percent: f.hd_percent,
    margin_note: f.margin_note,
    confidence: f.confidence,
    rowBox: f.row_box,
    ambiguousDigits: f.ambiguous_digits,
    side,
  };
}

function toSectionFlocks(flocks: WorkingFlock[]): SectionFlock[] {
  return flocks.map((f) => ({
    label: f.display_label_as_written,
    section: f.section,
    mortality: f.mortality,
    feed_bags: f.feed_bags,
    eggs_total: f.eggs_total,
    bird_population: f.bird_population,
    hd_percent_written: f.hd_percent,
  }));
}

function isSectionSubtotal(s: SectionSubtotal | null): s is SectionSubtotal {
  return s !== null;
}

const CONFUSION_PAIRS_TEXT = "3↔8, 1↔7, 1↔4, 9↔0, 5↔6, 2↔7, 9↔4";

export interface TableBlocksResult {
  flocks: ExtractedFlockRow[];
  subtotals: Record<Section, SectionSubtotal | null>;
  regionNotes: string[];
  retryRoundsRun: number;
  retriedLabels: string[];
}

export interface HalfPageSource {
  side: HalfSide;
  extraction: PageHalfExtraction;
  // The half-page image itself, kept only so a checksum-guided retry can
  // zoom into one flock's own row_box without re-fetching anything.
  imageBase64: string;
  mediaType: "image/jpeg";
}

// The flock-table merge + checksum-guided retry logic, shared between the
// real upload path (extractDailyProductionV2 below) and the benchmark
// page, which runs its own two half-page extractions and just wants the
// same merge+retry behavior applied to them (so it never pays for a
// second pair of half-page vision calls just to get back to this step).
export async function mergeTableBlocksFromHalves(halves: HalfPageSource[]): Promise<TableBlocksResult> {
  let flocks: WorkingFlock[] = [];
  const subtotals: Record<Section, SectionSubtotal | null> = { main: null, continuation: null };
  const regionNotes: string[] = [];
  const imageBySide = new Map<HalfSide, { base64: string; mediaType: "image/jpeg" }>();
  // Owner request, 2026-10-21: roles are decided by what each table
  // CONTAINS (assignTableSections), never by which half it came from.
  const sectionBySide = assignTableSections(halves);

  for (const half of halves) {
    imageBySide.set(half.side, { base64: half.imageBase64, mediaType: half.mediaType });
    const section = sectionBySide.get(half.side);
    if (!section) continue;
    const table = half.extraction.table;
    if (!table) continue;
    if (table.region_notes) regionNotes.push(table.region_notes);
    if (table.subtotal) subtotals[section] = { section, ...table.subtotal };
    flocks = flocks.concat(table.flocks.map((f) => halfFlockToWorking(f, section, half.side)));
  }

  const retriedLabels: string[] = [];
  let retryRoundsRun = 0;

  for (let round = 0; round < MAX_RETRY_ROUNDS; round++) {
    const subtotalList = [subtotals.main, subtotals.continuation].filter(isSectionSubtotal);
    const findings = checkPageChecksums(toSectionFlocks(flocks), subtotalList);
    const toRetry = findings.filter((f) => f.severity === "mismatch" && f.suspectFlock !== null);
    if (toRetry.length === 0) break;

    retryRoundsRun++;
    let madeAnyChange = false;

    for (const finding of toRetry) {
      const label = finding.suspectFlock!.label;
      const idx = flocks.findIndex((f) => f.display_label_as_written === label);
      if (idx === -1) continue;
      const flock = flocks[idx];
      const image = imageBySide.get(flock.side);
      if (!image) continue;

      // Same mechanism as before this rewrite: zoom into exactly this
      // flock's own row (never a blind re-ask of the whole half), reusing
      // the proven single-row extraction prompt — a tight, zoomed crop is
      // exactly the shape that prompt already expects.
      const zoomed = await recropForRetry(image.base64, flock.rowBox, 1400);
      const hint = `${finding.field} for ${label}: ${finding.message}. Likely digit confusions in this handwriting: ${CONFUSION_PAIRS_TEXT}.`;
      const retryResult = await extractDailyProductionRegion(zoomed.base64, zoomed.mediaType, flock.section, {
        confusionHint: hint,
      });
      const retried = retryResult.flocks.find((f) => f.display_label_as_written === label) ?? retryResult.flocks[0];
      if (!retried) continue;

      const updated = halfFlockToWorking(retried, flock.section, flock.side);
      // Only accept the retry's answer if it actually changed something —
      // an identical re-read isn't a new candidate, and re-looping on it
      // for 3 rounds burns retries for nothing.
      if (JSON.stringify({ ...updated, rowBox: null }) !== JSON.stringify({ ...flock, rowBox: null })) {
        flocks[idx] = updated;
        madeAnyChange = true;
      }
      if (!retriedLabels.includes(label)) retriedLabels.push(label);
    }

    if (!madeAnyChange) break; // nothing new to try — stop instead of burning remaining rounds
  }

  const extractedFlocks: ExtractedFlockRow[] = flocks.map(({ rowBox, ambiguousDigits, side, ...rest }) => {
    void rowBox;
    void ambiguousDigits;
    void side;
    return rest;
  });

  return { flocks: extractedFlocks, subtotals, regionNotes, retryRoundsRun, retriedLabels };
}

export async function extractDailyProductionV2(
  photoBuffer: Buffer,
  photoMediaType: string
): Promise<ReaderV2Result> {
  void photoMediaType; // the pipeline re-encodes everything it sends as JPEG
  // Owner report, 2026-10-19: done ONCE, before anything else sees the
  // photo, so every subsequent step agrees on orientation — see
  // autoOrient.ts's own header comment.
  const oriented = await autoOrientPhoto(photoBuffer);

  // Orientation (low-res vision call) -> upright -> split -> read both
  // halves -> self-check (retry 180° if a half is empty). See
  // halfPipeline.ts.
  const read = await readPageHalves(oriented);
  console.log(
    `[readerV2] rotation ${read.orientation.rotationDegrees}° (text tops point ${read.orientation.textTopPointsTo ?? "?"}); attempts: ${read.attempts
      .map((a) => `${a.rotationApplied}° => left ${a.leftItems} / right ${a.rightItems} items`)
      .join("; ")}${read.notes.length ? ` | ${read.notes.join(" ")}` : ""}`
  );

  // Owner request, 2026-10-21: an unreadable photo is reported as such —
  // never turned into empty fields that look like a reading.
  if (read.unreadable) throw new ExtractionRejected(UNREADABLE_MESSAGE);

  const { chosen } = read;
  const halves: HalfPageSource[] = [
    { side: "left", extraction: chosen.left, imageBase64: chosen.split.left.base64, mediaType: "image/jpeg" },
    { side: "right", extraction: chosen.right, imageBase64: chosen.split.right.base64, mediaType: "image/jpeg" },
  ];

  const { flocks, subtotals, regionNotes, retryRoundsRun, retriedLabels } = await mergeTableBlocksFromHalves(halves);
  const sectionsFound = [chosen.left.table, chosen.right.table].filter((t) => t !== null && t.flocks.length > 0).length;
  const pageDate = pickDate(halves);

  const extraction: ExtractionResult = {
    date: pageDate.date,
    date_confidence: pageDate.confidence,
    flocks,
    section_subtotals: [subtotals.main, subtotals.continuation].filter(isSectionSubtotal),
    page_notes:
      [read.orientation.pageNotes, chosen.left.half_notes, chosen.right.half_notes, ...regionNotes]
        .filter((n): n is string => !!n)
        .join(" ") || null,
    sections_found: sectionsFound,
  };

  return { extraction, flocks, retryRoundsRun, retriedLabels };
}

// Same app-level backstop extractDailyProductionSafely() applies to the old
// reader (dailyProduction.ts) — a schema's maxItems is only a hint to the
// model, never a guarantee, so this dedupes an exact-label repeat and
// rejects outright if the page still has implausibly many distinct flocks
// for this farm. Reuses the SAME ExtractionRejected class the old reader
// throws, so app/upload/actions.ts's existing catch (never attempts to
// save a rejected extraction) handles both readers identically. Unlike the
// old reader, there's no separate "stricter retry" here — each half call
// already caps at 15 flocks on its own, and the checksum-guided retry loop
// above already re-asks about specific rows; a second whole-page attempt
// would not address a runaway-count failure differently.
export async function extractDailyProductionV2Safely(
  photoBuffer: Buffer,
  photoMediaType: string,
  activeFlockCount: number
): Promise<ReaderV2Result> {
  const maxSane = activeFlockCount + 2;
  const result = await extractDailyProductionV2(photoBuffer, photoMediaType);
  const flocks = dedupeByNormalizedLabel(result.flocks, (f) => f.display_label_as_written);
  if (flocks.length > maxSane) {
    throw new ExtractionRejected(
      `Extraction returned an implausible number of rows for a page with ~${activeFlockCount} flocks — please retry the upload.`
    );
  }
  return {
    ...result,
    flocks,
    extraction: { ...result.extraction, flocks },
  };
}
