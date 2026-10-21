// Permanent regression fixture for pageSplit.ts (owner report,
// 2026-10-21): the Aug 3 photo's model-drawn region boxes were all wrong,
// so this replaces region-box detection with a deterministic, non-LLM
// split at the page's physical spine — found by averaging pixel-column
// brightness and locating the sustained dark band a page fold produces.
// Run with `npx tsx scripts/regression-page-split.ts` from `web/`.
//
// Builds synthetic two-page-spread mockups at REAL phone-photo dimensions
// (4032x3024 landscape, 3024x4032 portrait) with a dark vertical band at a
// KNOWN column, plus a flat, bandless image to prove the midpoint
// fallback actually triggers rather than mis-firing on noise.

import sharp from "sharp";
import { splitPageIntoHalves, findSpineColumn } from "../lib/extraction/readerV2/pageSplit";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`PASS: ${name}`);
  } else {
    fail++;
    console.log(`FAIL: ${name}`, detail ?? "");
  }
}

// A light page with a dark vertical band (the simulated spine shadow) at
// a known column, plus sparse "text" (small dark marks) scattered
// elsewhere — proving the column-brightness method finds the SUSTAINED
// band, not just any locally dark pixel.
async function buildSpreadWithSpine(width: number, height: number, spineX: number, bandWidth = 14): Promise<Buffer> {
  const textMarks: string[] = [];
  for (let i = 0; i < 40; i++) {
    const x = Math.round((i * 97) % width);
    const y = Math.round((i * 53) % height);
    if (Math.abs(x - spineX) < bandWidth * 3) continue; // keep the band itself clean for a crisp test
    textMarks.push(`<rect x="${x}" y="${y}" width="6" height="2" fill="#333"/>`);
  }
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f2f0e9"/>
    <rect x="${spineX - bandWidth / 2}" y="0" width="${bandWidth}" height="${height}" fill="#1a1a1a"/>
    ${textMarks.join("\n")}
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

async function buildFlatSpread(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 245, g: 243, b: 236 } } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function run() {
  // 1) Landscape at real phone-photo size, spine left of center (4032x3024,
  // spine at x=1900 — deliberately NOT the exact midpoint, to prove this
  // isn't just always splitting down the middle).
  {
    const width = 4032;
    const height = 3024;
    const spineX = 1900;
    const buf = await buildSpreadWithSpine(width, height, spineX);
    const result = await splitPageIntoHalves(buf);
    check("4032x3024: spine detected (not a fallback)", result.spineConfidence === "detected", result.spineConfidence);
    check(
      `4032x3024: detected spine (${result.spineX}) is within 20px of the real one (${spineX})`,
      Math.abs(result.spineX - spineX) <= 20,
      result.spineX
    );
    check(
      "4032x3024: halves overlap by ~4% of the width on each side of the split (nothing is cut)",
      result.overlapPx === Math.round(width * 0.04) &&
        result.left.width === result.spineX + result.overlapPx &&
        result.right.width === width - (result.spineX - result.overlapPx),
      { overlap: result.overlapPx, left: result.left.width, right: result.right.width }
    );
    check(
      "4032x3024: the two halves together cover the whole page (left+right >= width)",
      result.left.width + result.right.width >= width
    );
    check("4032x3024: both halves keep the full height", result.left.height === height && result.right.height === height);
  }

  // 2) Portrait at real phone-photo size (3024x4032), spine right of
  // center this time.
  {
    const width = 3024;
    const height = 4032;
    const spineX = 1700;
    const buf = await buildSpreadWithSpine(width, height, spineX);
    const result = await splitPageIntoHalves(buf);
    check("3024x4032: spine detected (not a fallback)", result.spineConfidence === "detected", result.spineConfidence);
    check(
      `3024x4032: detected spine (${result.spineX}) is within 20px of the real one (${spineX})`,
      Math.abs(result.spineX - spineX) <= 20,
      result.spineX
    );
  }

  // 3) A real EXIF orientation-6 tag at real size — splitPageIntoHalves is
  // always called on an ALREADY-upright buffer in the real pipeline (after
  // autoOrientPhoto + rotateUpright), but sharp's own greyscale/raw read
  // on a still-tagged buffer is exactly the kind of path that could
  // silently disagree with the visible pixels, so this is included
  // directly as a defensive check.
  {
    const width = 3024;
    const height = 4032;
    const spineX = 1500;
    const upright = await buildSpreadWithSpine(width, height, spineX);
    const tagged = await sharp(upright).withMetadata({ orientation: 6 }).toBuffer();
    const result = await splitPageIntoHalves(tagged);
    check("EXIF-tagged input: splitPageIntoHalves does not throw and returns both halves", result.left.width > 0 && result.right.width > 0, result);
  }

  // 4) No real spine at all (flat image) — must fall back to the exact
  // midpoint rather than mis-fire on brightness noise.
  {
    const width = 4032;
    const height = 3024;
    const buf = await buildFlatSpread(width, height);
    const result = await splitPageIntoHalves(buf);
    check("flat image: falls back to midpoint split", result.spineConfidence === "fallback_midpoint", result.spineConfidence);
    check(
      "flat image: fallback spine is the exact midpoint",
      result.spineX === Math.round(width / 2),
      result.spineX
    );
  }

  // 5) Crease vs. broad shadow (owner report: the line landed ~70px right
  // of the real fold). A narrow dark crease at x=1900 PLUS a broad,
  // asymmetric page-curl shadow that darkens toward the crease from the
  // right and ends abruptly ~140px past it. The split must sit on the
  // narrow crease, not be dragged toward the shadow.
  {
    const width = 4032;
    const height = 3024;
    const creaseX = 1900;
    const shadowBands: string[] = [];
    // gradient: 0 -> ~28% darkening across 240px to the right of the crease
    for (let i = 0; i < 24; i++) {
      const x = creaseX + 7 + i * 10;
      const alpha = (0.28 * (24 - i)) / 24;
      shadowBands.push(`<rect x="${x}" y="0" width="10" height="${height}" fill="#000" fill-opacity="${alpha.toFixed(3)}"/>`);
    }
    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f2f0e9"/>
      ${shadowBands.join("\n")}
      <rect x="${creaseX - 6}" y="0" width="12" height="${height}" fill="#262626"/>
    </svg>`;
    const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
    const result = await splitPageIntoHalves(buf);
    check("crease+shadow: crease detected", result.spineConfidence === "detected", result.spineConfidence);
    check(
      `crease+shadow: split (${result.spineX}) is within 15px of the narrow crease (${creaseX}), not dragged toward the shadow`,
      Math.abs(result.spineX - creaseX) <= 15,
      result.spineX
    );
  }

  // 6) A dark column OUTSIDE the central 35-65% window (e.g. a page edge
  // or table border) must not be mistaken for the crease.
  {
    const width = 4000;
    const profile = new Float64Array(width).fill(230);
    for (let x = 700; x < 740; x++) profile[x] = 20; // far-left dark band (outside the window)
    const r = findSpineColumn(profile);
    check("dark band outside the central window is ignored (falls back to midpoint)", !r.detected && r.spineX === 2000, r);
  }

  // 7) Pure profile test: narrow deep crease beats a wide shallower curl
  // inside the window.
  {
    const width = 4000;
    const profile = new Float64Array(width).fill(230);
    for (let x = 1700; x < 1900; x++) profile[x] = 175; // wide curl
    for (let x = 2000; x < 2012; x++) profile[x] = 60; // narrow crease, centre 2005
    const r = findSpineColumn(profile);
    check("narrow dark crease beats a broad shallower shadow", r.detected && Math.abs(r.spineX - 2005) <= 12, r);
  }

  // 8) Degenerate input (zero dimensions) must throw a clear error, not a
  // cryptic sharp exception.
  {
    let threw = false;
    try {
      await splitPageIntoHalves(Buffer.from(""));
    } catch {
      threw = true;
    }
    check("empty buffer throws (not a silent wrong split)", threw);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run();
