import { loadSharp } from "./sharpLoader";

// Reader rebuild, replacing model-drawn region boxes (owner report,
// 2026-10-21, Aug 3 photo filed under Aug 8): every box the page-layout
// call drew was wrong — feed_box_single landed on a wine bottle,
// small_egg_ledger landed on the big-egg flock table, big_egg_ledger was
// mostly background, main_table_block cut through the small-egg table.
// Letting a vision call guess arbitrary bounding boxes on a two-page
// spread turned out to be unreliable as the PRIMARY crop method.
//
// This replaces that first cut with a deterministic, non-LLM split: the
// photographed register is always two paper pages side by side (section
// A of the owner's "CURRENT STATUS" message — one day = one photo with
// both pages), and the join between them shows up as a sustained dark
// band running the full height of the UPRIGHT image — the shadow of the
// physical page fold. Ordinary handwriting is sparse ink on a light
// background and barely moves a column's average brightness; a page fold
// is dark in every row, so simply averaging brightness per pixel column
// and finding the darkest one in the middle of the page finds the spine
// far more reliably than asking a model to draw a box around it.

export interface PageHalfImage {
  base64: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
}

export interface PageSplitResult {
  left: PageHalfImage;
  right: PageHalfImage;
  // The pixel column (in the UPRIGHT full-page image) where the split
  // happened — surfaced so the benchmark's debug page can draw it and a
  // human can sanity-check the split at a glance.
  spineX: number;
  // "detected" means a genuine dark band was found; "fallback_midpoint"
  // means no convincing dip was found (e.g. a single already-cropped page,
  // or unusually even lighting) and the image was simply split down its
  // exact middle instead — never refused outright, since a near-middle
  // split is still a reasonable guess for a two-page spread.
  spineConfidence: "detected" | "fallback_midpoint";
}

// Search only the central portion of the page for the spine — keeps a
// stray dark table border or margin far from center from being mistaken
// for the fold, without assuming the fold is EXACTLY at the midpoint
// (real photos are rarely framed perfectly square).
const CANDIDATE_WINDOW_FRACTION = { min: 0.3, max: 0.7 };

// The darkest column in the search window must be at least this much
// darker than the window's own average to count as a real fold rather
// than ordinary brightness noise — below this, fall back to the exact
// midpoint rather than trust a weak signal.
const MIN_DIP_RATIO = 0.85;

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

  const windowStart = Math.round(width * CANDIDATE_WINDOW_FRACTION.min);
  const windowEnd = Math.round(width * CANDIDATE_WINDOW_FRACTION.max);
  let minX = windowStart;
  let minVal = Infinity;
  let windowSum = 0;
  let windowCount = 0;
  for (let x = windowStart; x < windowEnd; x++) {
    windowSum += colAvg[x];
    windowCount++;
    if (colAvg[x] < minVal) {
      minVal = colAvg[x];
      minX = x;
    }
  }
  const windowAvg = windowCount > 0 ? windowSum / windowCount : 255;

  const midpoint = Math.round(width / 2);
  const spineDetected = windowAvg > 0 && minVal <= windowAvg * MIN_DIP_RATIO;
  const spineX = spineDetected ? minX : midpoint;

  const leftBuffer = await sharp(uprightBuffer)
    .extract({ left: 0, top: 0, width: spineX, height })
    .jpeg({ quality: 92 })
    .toBuffer();
  const rightBuffer = await sharp(uprightBuffer)
    .extract({ left: spineX, top: 0, width: width - spineX, height })
    .jpeg({ quality: 92 })
    .toBuffer();

  return {
    left: { base64: leftBuffer.toString("base64"), mediaType: "image/jpeg", width: spineX, height },
    right: { base64: rightBuffer.toString("base64"), mediaType: "image/jpeg", width: width - spineX, height },
    spineX,
    spineConfidence: spineDetected ? "detected" : "fallback_midpoint",
  };
}
