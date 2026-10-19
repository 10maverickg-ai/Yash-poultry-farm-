import type { ExtractedFlockRow, ExtractionResult } from "../dailyProduction";
import { checkPageChecksums, type Section, type SectionFlock, type SectionSubtotal } from "../pageChecksum";
import { detectOrientationAndRegions } from "./orientationAndRegions";
import { rotateAndCropRegions, recropForRetry, type CroppedRegion } from "./crop";
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

export async function extractDailyProductionV2(
  photoBuffer: Buffer,
  photoMediaType: string
): Promise<ReaderV2Result> {
  const photoBase64 = photoBuffer.toString("base64");
  const layout = await detectOrientationAndRegions(photoBase64, photoMediaType);

  const tableRegionKinds = new Set<string>(TABLE_REGION_KINDS.map(([kind]) => kind));
  if (!layout.regions.some((r) => tableRegionKinds.has(r.kind))) {
    throw new Error("The page-layout call didn't find any flock table on this photo.");
  }

  const crops = await rotateAndCropRegions(photoBuffer, layout);
  const cropByKind = new Map<string, CroppedRegion>(crops.map((c) => [c.kind, c]));

  let flocks: WorkingFlock[] = [];
  const subtotals: Record<Section, SectionSubtotal | null> = { main: null, continuation: null };
  const regionNotes: string[] = [];

  for (const [kind, section] of TABLE_REGION_KINDS) {
    const crop = cropByKind.get(kind);
    if (!crop) continue; // this page genuinely has no continuation table — never forced
    const result = await extractDailyProductionRegion(crop.base64, crop.mediaType, section);
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
      const crop = cropByKind.get(kind);
      if (!crop) continue;

      const zoomed = await recropForRetry(crop.base64, flock.rowBox, 1400);
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
  const sectionsFound = TABLE_REGION_KINDS.filter(([kind]) => cropByKind.has(kind)).length;

  const extraction: ExtractionResult = {
    date: layout.date,
    date_confidence: layout.dateConfidence,
    flocks: extractedFlocks,
    section_subtotals: [subtotals.main, subtotals.continuation].filter(isSectionSubtotal),
    page_notes: [layout.pageNotes, ...regionNotes].filter((n): n is string => !!n).join(" ") || null,
    sections_found: sectionsFound,
  };

  return { extraction, flocks: extractedFlocks, retryRoundsRun, retriedLabels };
}
