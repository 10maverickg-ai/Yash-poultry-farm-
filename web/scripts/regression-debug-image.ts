// Permanent regression fixture for debugImage.ts. Originally written for
// an "Image to composite must have same dimensions or smaller" crash
// (owner report, 2026-10-21) that only showed up at real phone-photo
// dimensions — the project's original 400x300 synthetic fixture never had
// enough room to expose it. Kept at those same real dimensions after
// region boxes were replaced with a single spine line (2026-10-21, same
// day — see pageSplit.ts's header comment) since the underlying sharp
// compositing bug this guards against is about PIXEL DIMENSIONS, not
// about what's drawn: 4032x3024 (landscape), 3024x4032 (portrait), and a
// 3024x4032 image carrying a real EXIF orientation-6 tag (so sharp's
// internal auto-rotate during metadata reads is exercised too, not just a
// physically-rotated buffer).
//
// Run with `npx tsx scripts/regression-debug-image.ts` from `web/`.

import sharp from "sharp";
import { drawSpineLine, downscaleForDisplay } from "../lib/extraction/readerV2/debugImage";

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

async function run() {
  // 1) Landscape at real phone-photo size: 4032x3024.
  {
    const base = await buildRealSizeImage(4032, 3024);
    const base64 = base.toString("base64");
    try {
      const result = await drawSpineLine(base64, 2016);
      check("4032x3024 landscape: drawSpineLine does not throw", true);
      const meta = await sharp(Buffer.from(result.base64, "base64")).metadata();
      check(
        "4032x3024 landscape: output has valid dimensions",
        (meta.width ?? 0) > 0 && (meta.height ?? 0) > 0,
        meta
      );
    } catch (err) {
      check("4032x3024 landscape: drawSpineLine does not throw", false, err);
    }
  }

  // 2) Portrait at real phone-photo size: 3024x4032.
  {
    const base = await buildRealSizeImage(3024, 4032);
    const base64 = base.toString("base64");
    try {
      const result = await drawSpineLine(base64, 1500);
      check("3024x4032 portrait: drawSpineLine does not throw", true);
      const meta = await sharp(Buffer.from(result.base64, "base64")).metadata();
      check(
        "3024x4032 portrait: output has valid dimensions",
        (meta.width ?? 0) > 0 && (meta.height ?? 0) > 0,
        meta
      );
    } catch (err) {
      check("3024x4032 portrait: drawSpineLine does not throw", false, err);
    }
  }

  // 3) A real EXIF orientation-6 tag at real size — drawSpineLine receives
  // the ALREADY-upright full page (as readerV2's pipeline always calls it,
  // after autoOrientPhoto), but sharp's own metadata() read on an
  // EXIF-tagged buffer is exactly the kind of path that can disagree with
  // a naive width/height assumption, so this is included directly.
  {
    const upright = await buildRealSizeImage(3024, 4032);
    const tagged = await sharp(upright).withMetadata({ orientation: 6 }).toBuffer();
    const base64 = tagged.toString("base64");
    try {
      const result = await drawSpineLine(base64, 1500);
      check("EXIF orientation-6 tagged image: drawSpineLine does not throw", true);
      const meta = await sharp(Buffer.from(result.base64, "base64")).metadata();
      check(
        "EXIF orientation-6 tagged image: output has valid dimensions",
        (meta.width ?? 0) > 0 && (meta.height ?? 0) > 0,
        meta
      );
    } catch (err) {
      check("EXIF orientation-6 tagged image: drawSpineLine does not throw", false, err);
    }
  }

  // 4) downscaleForDisplay at real half-page sizes too.
  {
    const half = await buildRealSizeImage(2016, 3024);
    const base64 = half.toString("base64");
    try {
      const downscaled = await downscaleForDisplay(base64);
      const meta = await sharp(Buffer.from(downscaled, "base64")).metadata();
      check(
        "downscaleForDisplay at real half-page size does not throw and shrinks width",
        (meta.width ?? 0) > 0 && (meta.width ?? 0) <= 900,
        meta
      );
    } catch (err) {
      check("downscaleForDisplay at real half-page size does not throw", false, err);
    }
  }

  // 5) Spine line at/near the image edges — must still not throw.
  {
    const base = await buildRealSizeImage(4032, 3024);
    const base64 = base.toString("base64");
    try {
      await drawSpineLine(base64, 0);
      await drawSpineLine(base64, 4032);
      await drawSpineLine(base64, -50);
      await drawSpineLine(base64, 999999);
      check("drawSpineLine at/past the image edges does not throw", true);
    } catch (err) {
      check("drawSpineLine at/past the image edges does not throw", false, err);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run();
