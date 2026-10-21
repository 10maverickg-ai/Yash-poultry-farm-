import { loadSharp } from "./sharpLoader";

// Reader rebuild, replacing model-drawn region boxes (owner report,
// 2026-10-21, Aug 3 photo filed under Aug 8): every box the page-layout
// call drew was wrong. This replaces that with a deterministic, non-LLM
// split: the photographed register is always two paper pages side by side
// (section A of the owner's "CURRENT STATUS" message — one day = one photo
// with both pages), and the join between them shows up as a dark vertical
// crease in the UPRIGHT image.
//
// Revised 2026-10-21 (owner report — Aug 8 run: the line landed ~70px
// right of the real fold, so each half carried a sliver of the other
// page): (1) the search window is the central 35–65% of the width; (2)
// the column-brightness profile is lightly smoothed, then candidates are
// scored by depth AND narrowness (the crease is the darkest, narrowest
// vertical band — a broad page-curl shadow is deeper-looking but wide);
// (3) the split point is the CENTRE of the chosen band at half its depth,
// not the single darkest pixel column, so an asymmetric shadow gradient
// doesn't drag the line to one side; (4) each half now extends ~4% of the
// page width PAST the split, so a crease that's still a little off can
// never cut off a label or a column — the prompts tell the model to
// ignore the sliver of the neighbouring page this brings in.
//
// The page must already be upright for "vertical crease" to mean
// anything — see pageOrientation.ts / halfPipeline.ts.

export interface PageHalfImage {
  base64: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
}

export interface PageSplitResult {
  left: PageHalfImage;
  right: PageHalfImage;
  // The pixel column (in the UPRIGHT full-page image) the split is centred
  // on — surfaced so the debug page can draw it.
  spineX: number;
  // How far (px) each half reaches past spineX toward the other page.
  overlapPx: number;
  // "detected": a genuine dark band was found. "fallback_midpoint": no
  // convincing dip, so the exact middle was used instead.
  spineConfidence: "detected" | "fallback_midpoint";
}

const CANDIDATE_WINDOW_FRACTION = { min: 0.35, max: 0.65 };
// The chosen band must be at least this much darker than the window's
// typical (median) brightness to count as a real crease.
const MIN_DIP_RATIO = 0.9;
const OVERLAP_FRACTION = 0.04;
const SMOOTHING_RADIUS_FRACTION = 0.002;
const CANDIDATE_SUPPRESSION_FRACTION = 0.03;
const MAX_CANDIDATES = 5;

interface SpineCandidate {
  center: number;
  depth: number;
  score: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Pure and exported so it can be exercised without images: given a
// per-column average-brightness profile, return the spine column and
// whether it was a real detection.
export function findSpineColumn(colAvg: ArrayLike<number>): { spineX: number; detected: boolean } {
  const width = colAvg.length;
  const midpoint = Math.round(width / 2);
  const windowStart = Math.round(width * CANDIDATE_WINDOW_FRACTION.min);
  const windowEnd = Math.round(width * CANDIDATE_WINDOW_FRACTION.max);
  if (windowEnd - windowStart < 3) return { spineX: midpoint, detected: false };

  // Light box-filter smoothing so single-column noise (a pen stroke
  // crossing the crease) can't win on its own.
  const radius = Math.max(2, Math.round(width * SMOOTHING_RADIUS_FRACTION));
  const smooth = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    const lo = Math.max(0, x - radius);
    const hi = Math.min(width - 1, x + radius);
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += colAvg[i];
    smooth[x] = sum / (hi - lo + 1);
  }

  const windowValues: number[] = [];
  for (let x = windowStart; x < windowEnd; x++) windowValues.push(smooth[x]);
  const baseline = median(windowValues);
  if (baseline <= 0) return { spineX: midpoint, detected: false };

  const suppression = Math.max(3, Math.round(width * CANDIDATE_SUPPRESSION_FRACTION));
  const taken = new Uint8Array(width);
  const candidates: SpineCandidate[] = [];

  for (let n = 0; n < MAX_CANDIDATES; n++) {
    let minX = -1;
    let minVal = Infinity;
    for (let x = windowStart; x < windowEnd; x++) {
      if (taken[x]) continue;
      if (smooth[x] < minVal) {
        minVal = smooth[x];
        minX = x;
      }
    }
    if (minX < 0) break;
    const depth = baseline - minVal;
    if (depth <= 0) break;

    // Extent of the band at half its depth, contiguous around the minimum.
    const threshold = baseline - depth / 2;
    let left = minX;
    while (left - 1 >= windowStart && smooth[left - 1] <= threshold) left--;
    let right = minX;
    while (right + 1 < windowEnd && smooth[right + 1] <= threshold) right++;
    const bandWidth = right - left + 1;

    candidates.push({
      center: Math.round((left + right) / 2),
      depth,
      // Depth rewards the darkest band; the square root of the width
      // penalises broad shadows so the narrow crease beats a wide curl.
      score: depth / Math.sqrt(bandWidth),
    });

    for (let x = Math.max(0, minX - suppression); x <= Math.min(width - 1, minX + suppression); x++) taken[x] = 1;
  }

  if (candidates.length === 0) return { spineX: midpoint, detected: false };
  const best = candidates.reduce((a, b) => (b.score > a.score ? b : a));
  const minVal = baseline - best.depth;
  if (minVal > baseline * MIN_DIP_RATIO) return { spineX: midpoint, detected: false };
  return { spineX: best.center, detected: true };
}

export async function splitPageIntoHalves(uprightBuffer: Buffer): Promise<PageSplitResult> {
  const sharp = await loadSharp();
  const meta = await sharp(uprightBuffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width <= 0 || height <= 0) {
    throw new Error(`Upright page has no usable dimensions (${width}x${height}) — can't find its spine.`);
  }

  const { data, info } = await sharp(uprightBuffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;

  // Average brightness per column across the FULL height of the page.
  const colAvg = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * channels;
    for (let x = 0; x < width; x++) {
      colAvg[x] += data[rowOffset + x * channels];
    }
  }
  for (let x = 0; x < width; x++) colAvg[x] /= height;

  const { spineX, detected } = findSpineColumn(colAvg);

  const overlapPx = Math.round(width * OVERLAP_FRACTION);
  const leftEnd = Math.min(width, spineX + overlapPx);
  const rightStart = Math.max(0, spineX - overlapPx);

  const leftBuffer = await sharp(uprightBuffer)
    .extract({ left: 0, top: 0, width: leftEnd, height })
    .jpeg({ quality: 92 })
    .toBuffer();
  const rightBuffer = await sharp(uprightBuffer)
    .extract({ left: rightStart, top: 0, width: width - rightStart, height })
    .jpeg({ quality: 92 })
    .toBuffer();

  return {
    left: { base64: leftBuffer.toString("base64"), mediaType: "image/jpeg", width: leftEnd, height },
    right: { base64: rightBuffer.toString("base64"), mediaType: "image/jpeg", width: width - rightStart, height },
    spineX,
    overlapPx,
    spineConfidence: detected ? "detected" : "fallback_midpoint",
  };
}
