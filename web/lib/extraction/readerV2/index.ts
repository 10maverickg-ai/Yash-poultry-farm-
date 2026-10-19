import { ExtractionRejected, type ExtractedFlockRow, type ExtractionResult } from "../dailyProduction";
import { dedupeByNormalizedLabel } from "../flockMatch";
import { checkPageChecksums, type Section, type SectionFlock, type SectionSubtotal } from "../pageChecksum";
import { autoOrientPhoto } from "./autoOrient";
import { detectOrientationAndRegions } from "./orientationAndRegions";
import { rotateAndCropRegions, recropForRetry, type CroppedRegion, type FullPageImage } from "./crop";
import { extractDailyProductionRegion, type RegionFlockRow } from "./dailyProductionRegion";
import type { NormalizedBox } from "./types";

// Reader rebuild orchestrator — Daily Production side only (the first
// increment; the egg ledger/feed box and chick-rows crops are follow-up
// work, not wired in here yet). Produces the EXACT SAME `ExtractionResult`
// shape app/upload/actions.ts already knows how to save through
// pipeline.ts, writeDailyProduction.ts, etc. — none of that downstream code
// changes. Only HOW the extraction happens is different: orientation +
// region detection, then one full-resolution vision call per cropped flock
// table (+ its own subtotal), then up to 3 rounds of checksum-guided,
// zoomed-crop retries on whichever specific flock a page checksum
// implicates — never a blind re-ask of the whole page.
//
// Gated entirely behind READER_V2_ENABLED (app/upload/actions.ts) — the
// existing single-call reader (dailyProduction.ts) stays the production
// default until the benchmark page proves this one's accuracy and the
// owner approves it.

const MAX_RETRY_ROUNDS = 3;

const TABLE_REGION_KINDS = [
  ["main_table_block", "main"],
  ["continuation_table_block", "continuation"],
] as const satisfies readonly [string, Section][];

interface WorkingFlock extends ExtractedFlockRow {
  rowBox: NormalizedBox;
  ambiguousDigits: string | null;
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

function regionFlockToWorking(f: RegionFlockRow, section: Section): WorkingFlock {
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

// Owner report, 2026-10-19 (Aug 8 benchmark): a table-block region whose
// detected box covers only a sliver of the page is a sign the detection
// call misjudged it, not a real, tightly-cropped table — a genuine flock
// table block (up to 10 rows plus its subtotal) always occupies a
// substantial share of its half of the page. Below this fraction of the
// full upright page's area, the crop is treated as untrustworthy and the
// WHOLE page is sent to that table's own extraction call instead — never
// silently kept and misread.
const MIN_TABLE_AREA_FRACTION = 0.08;

export interface TableBlocksResult {
  flocks: ExtractedFlockRow[];
  subtotals: Record<Section, SectionSubtotal | null>;
  regionNotes: string[];
  retryRoundsRun: number;
  retriedLabels: string[];
  // Which table kinds fell back to the whole page because their own
  // detected box looked too small — surfaced so the benchmark page (and
  // Vercel logs) can show this without guessing.
  fellBackToFullPage: string[];
}

interface UsedCrop {
  base64: string;
  mediaType: "image/jpeg";
}

// The core of the Daily-Production side of the reader rebuild — every
// flock-table crop present, read, then checksum-guided-retried — factored
// out of extractDailyProductionV2 below so the benchmark page's own
// full-page orchestration (lib/extraction/readerV2/benchmark.ts) can reuse
// it against crops it already has, rather than paying for a second
// orientation/region-detection call just to get back to this same step.
export async function extractTableBlocksFromCrops(
  cropByKind: Map<string, CroppedRegion>,
  fullPage: FullPageImage
): Promise<TableBlocksResult> {
  let flocks: WorkingFlock[] = [];
  const subtotals: Record<Section, SectionSubtotal | null> = { main: null, continuation: null };
  const regionNotes: string[] = [];
  const fellBackToFullPage: string[] = [];
  // Whichever image was ACTUALLY sent to the model for each table kind —
  // the small region crop normally, or the whole page when that crop
  // looked too small to trust. A retry below MUST zoom from the same
  // image a flock's own row_box was reported relative to, never the
  // original (possibly bad) crop if a fallback happened.
  const usedCropByKind = new Map<string, UsedCrop>();

  for (const [kind, section] of TABLE_REGION_KINDS) {
    const crop = cropByKind.get(kind);
    if (!crop) continue; // this page genuinely has no continuation table — never forced

    const areaFraction = fullPage.width > 0 && fullPage.height > 0
      ? (crop.width / fullPage.width) * (crop.height / fullPage.height)
      : 1;
    let used: UsedCrop = crop;
    if (areaFraction < MIN_TABLE_AREA_FRACTION) {
      fellBackToFullPage.push(kind);
      regionNotes.push(
        `${kind}'s detected region covered only ${Math.round(areaFraction * 100)}% of the page — too small to trust, so this table was read from the whole page instead.`
      );
      used = fullPage;
    }
    usedCropByKind.set(kind, used);

    const result = await extractDailyProductionRegion(used.base64, used.mediaType, section);
    if (result.region_notes) regionNotes.push(result.region_notes);
    if (result.subtotal) subtotals[section] = result.subtotal;
    flocks = flocks.concat(result.flocks.map((f) => regionFlockToWorking(f, section)));
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
      const kind = flock.section === "main" ? "main_table_block" : "continuation_table_block";
      const used = usedCropByKind.get(kind);
      if (!used) continue;

      const zoomed = await recropForRetry(used.base64, flock.rowBox, 1400);
      const hint = `${finding.field} for ${label}: ${finding.message}. Likely digit confusions in this handwriting: ${CONFUSION_PAIRS_TEXT}.`;
      const retryResult = await extractDailyProductionRegion(zoomed.base64, zoomed.mediaType, flock.section, {
        confusionHint: hint,
      });
      const retried = retryResult.flocks.find((f) => f.display_label_as_written === label) ?? retryResult.flocks[0];
      if (!retried) continue;

      const updated = regionFlockToWorking(retried, flock.section);
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

  const extractedFlocks: ExtractedFlockRow[] = flocks.map(({ rowBox, ambiguousDigits, ...rest }) => {
    void rowBox;
    void ambiguousDigits;
    return rest;
  });

  return { flocks: extractedFlocks, subtotals, regionNotes, retryRoundsRun, retriedLabels, fellBackToFullPage };
}

export async function extractDailyProductionV2(
  photoBuffer: Buffer,
  photoMediaType: string
): Promise<ReaderV2Result> {
  // Owner report, 2026-10-19 (Aug 8 benchmark): done ONCE, before anything
  // else sees the photo, so the detection call and the actual crop always
  // agree on orientation — see autoOrient.ts's own header comment for the
  // full reasoning. sharp preserves the original container format here
  // (no explicit .jpeg()/.png() call), so photoMediaType still correctly
  // describes these bytes.
  const oriented = await autoOrientPhoto(photoBuffer);

  const photoBase64 = oriented.toString("base64");
  const layout = await detectOrientationAndRegions(photoBase64, photoMediaType);

  const tableRegionKinds = new Set<string>(TABLE_REGION_KINDS.map(([kind]) => kind));
  if (!layout.regions.some((r) => tableRegionKinds.has(r.kind))) {
    throw new Error("The page-layout call didn't find any flock table on this photo.");
  }

  const { crops, fullPage } = await rotateAndCropRegions(oriented, layout);
  const cropByKind = new Map<string, CroppedRegion>(crops.map((c) => [c.kind, c]));

  const { flocks, subtotals, regionNotes, retryRoundsRun, retriedLabels } =
    await extractTableBlocksFromCrops(cropByKind, fullPage);
  const sectionsFound = TABLE_REGION_KINDS.filter(([kind]) => cropByKind.has(kind)).length;

  const extraction: ExtractionResult = {
    date: layout.date,
    date_confidence: layout.dateConfidence,
    flocks,
    section_subtotals: [subtotals.main, subtotals.continuation].filter(isSectionSubtotal),
    page_notes: [layout.pageNotes, ...regionNotes].filter((n): n is string => !!n).join(" ") || null,
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
// old reader, there's no separate "stricter retry" here — each region call
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
