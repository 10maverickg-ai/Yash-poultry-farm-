// Permanent regression fixture for debugImage.ts (owner report, 2026-10-21):
// a real Aug 8 photo threw "Image to composite must have same dimensions or
// smaller" from drawRegionBoxes — a real-photo-only sharp/librsvg rounding
// quirk that the project's original 400x300 synthetic fixture never had
// enough room to expose. This fixture deliberately builds images at the
// EXACT real phone-photo dimensions the owner asked for: 4032x3024
// (landscape), 3024x4032 (portrait), and a 3024x4032 image carrying a real
// EXIF orientation-6 tag (so sharp's internal auto-rotate during metadata
// reads is exercised too, not just a physically-rotated buffer). It also
// exercises clampBoxToPixels with boxes that run off every edge, including
// a full x=[0,1] y=[0,1] box, since those are exactly the kind of
// model-reported box that produced the original crash at scale.
//
// Run with `npx tsx scripts/regression-debug-image.ts` from `web/`.

import sharp from "sharp";
import { drawRegionBoxes, downscaleForDisplay } from "../lib/extraction/readerV2/debugImage";
import type { DetectedRegion } from "../lib/extraction/readerV2/types";

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

async function buildRealSizeImage(width: number, height: number): Promise<Buffer> {
  // A plain-colored real-dimension JPEG is enough to exercise the sharp
  // pipeline at the dimensions where the bug manifested — the bug is about
  // pixel-dimension agreement between the SVG overlay and the base image,
  // not about pixel content.
  return sharp({
    create: { width, height, channels: 3, background: { r: 230, g: 230, b: 220 } },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
}

// Regions deliberately including edge cases: a box flush with the top-left
// corner, a box that runs past the right/bottom edge, a box with a negative
// origin, and a box covering the entire page (0..1 on both axes) — all of
// which a real model response can produce.
function edgeCaseRegions(): DetectedRegion[] {
  return [
    { kind: "main_table_block", box: { x: 0, y: 0, width: 0.5, height: 0.3 } },
    { kind: "continuation_table_block", box: { x: 0.6, y: 0.1, width: 0.5, height: 0.3 } }, // runs past right edge
    { kind: "big_egg_ledger", box: { x: -0.05, y: 0.5, width: 0.3, height: 0.2 } }, // negative origin
    { kind: "feed_box_single", box: { x: 0.5, y: 0.85, width: 0.3, height: 0.3 } }, // runs past bottom edge
    { kind: "chick_rows", box: { x: 0, y: 0, width: 1, height: 1 } }, // whole page
  ];
}

async function run() {
  // 1) Landscape at real phone-photo size: 4032x3024.
  {
    const base = await buildRealSizeImage(4032, 3024);
    const base64 = base.toString("base64");
    try {
      const result = await drawRegionBoxes(base64, edgeCaseRegions());
      check("4032x3024 landscape: drawRegionBoxes does not throw", true);
      const meta = await sharp(Buffer.from(result.base64, "base64")).metadata();
      check(
        "4032x3024 landscape: output has valid dimensions",
        (meta.width ?? 0) > 0 && (meta.height ?? 0) > 0,
        meta
      );
    } catch (err) {
      check("4032x3024 landscape: drawRegionBoxes does not throw", false, err);
    }
  }

  // 2) Portrait at real phone-photo size: 3024x4032.
  {
    const base = await buildRealSizeImage(3024, 4032);
    const base64 = base.toString("base64");
    try {
      const result = await drawRegionBoxes(base64, edgeCaseRegions());
      check("3024x4032 portrait: drawRegionBoxes does not throw", true);
      const meta = await sharp(Buffer.from(result.base64, "base64")).metadata();
      check(
        "3024x4032 portrait: output has valid dimensions",
        (meta.width ?? 0) > 0 && (meta.height ?? 0) > 0,
        meta
      );
    } catch (err) {
      check("3024x4032 portrait: drawRegionBoxes does not throw", false, err);
    }
  }

  // 3) A real EXIF orientation-6 tag at real size — drawRegionBoxes receives
  // the ALREADY-upright full page (as readerV2's pipeline always calls it,
  // after autoOrientPhoto), but sharp's own metadata() read on an
  // EXIF-tagged buffer is exactly the kind of path that can disagree with
  // a naive width/height assumption, so this is included directly.
  {
    const upright = await buildRealSizeImage(3024, 4032);
    const tagged = await sharp(upright).withMetadata({ orientation: 6 }).toBuffer();
    const base64 = tagged.toString("base64");
    try {
      const result = await drawRegionBoxes(base64, edgeCaseRegions());
      check("EXIF orientation-6 tagged image: drawRegionBoxes does not throw", true);
      const meta = await sharp(Buffer.from(result.base64, "base64")).metadata();
      check(
        "EXIF orientation-6 tagged image: output has valid dimensions",
        (meta.width ?? 0) > 0 && (meta.height ?? 0) > 0,
        meta
      );
    } catch (err) {
      check("EXIF orientation-6 tagged image: drawRegionBoxes does not throw", false, err);
    }
  }

  // 4) downscaleForDisplay at real crop sizes too (a crop can itself be
  // large, e.g. half the page).
  {
    const crop = await buildRealSizeImage(2016, 3024);
    const base64 = crop.toString("base64");
    try {
      const downscaled = await downscaleForDisplay(base64);
      const meta = await sharp(Buffer.from(downscaled, "base64")).metadata();
      check(
        "downscaleForDisplay at real crop size does not throw and shrinks width",
        (meta.width ?? 0) > 0 && (meta.width ?? 0) <= 900,
        meta
      );
    } catch (err) {
      check("downscaleForDisplay at real crop size does not throw", false, err);
    }
  }

  // 5) No regions at all (an orientation call that found nothing) — the SVG
  // overlay is then just an empty rect list, still must not throw.
  {
    const base = await buildRealSizeImage(4032, 3024);
    const base64 = base.toString("base64");
    try {
      await drawRegionBoxes(base64, []);
      check("4032x3024 with zero regions: drawRegionBoxes does not throw", true);
    } catch (err) {
      check("4032x3024 with zero regions: drawRegionBoxes does not throw", false, err);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run();
