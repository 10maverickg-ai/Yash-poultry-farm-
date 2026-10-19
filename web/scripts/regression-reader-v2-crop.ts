// Permanent regression fixture for the reader rebuild's image pipeline
// (owner's "V4 build prompt", Phase 1) — the one part of readerV2 that
// needs NO live API access at all: pure sharp rotate/crop math. Run with
// `npx tsx scripts/regression-reader-v2-crop.ts` from `web/`.
//
// Builds a synthetic 400x300 test image with four distinctly-colored
// corner markers (red=top-left, green=top-right, blue=bottom-left,
// yellow=bottom-right) and a single, uniquely-colored 40x40 marker square
// at a KNOWN position — then verifies: rotation actually rotates in the
// documented direction (clockwise), each region box crops the correct
// sub-area after rotation, a box at the image edge doesn't crash, and the
// retry zoom actually upscales. This is the only genuinely live-testable
// part of the reader rebuild in this sandbox (no ANTHROPIC_API_KEY here) —
// everything else (the vision calls themselves) cannot be exercised
// without a real API call on a real deployment.

import sharp from "sharp";
import { rotateAndCropRegions, recropForRetry } from "../lib/extraction/readerV2/crop";
import { autoOrientPhoto } from "../lib/extraction/readerV2/autoOrient";
import type { OrientationAndRegions } from "../lib/extraction/readerV2/types";

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

// 400 wide x 300 tall. White background, four corner markers (30x30), and
// one uniquely-colored "needle" marker at (200,20)-(240,60) — near the TOP
// edge, horizontally centered — so after a 90° clockwise rotation it
// should land near the RIGHT edge, vertically centered (a 90°-CW rotation
// maps a point near the top-middle of the original to the right-middle of
// the result).
async function buildTestImage(): Promise<Buffer> {
  const width = 400;
  const height = 300;
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="white"/>
      <rect x="0" y="0" width="30" height="30" fill="red"/>
      <rect x="${width - 30}" y="0" width="30" height="30" fill="green"/>
      <rect x="0" y="${height - 30}" width="30" height="30" fill="blue"/>
      <rect x="${width - 30}" y="${height - 30}" width="30" height="30" fill="yellow"/>
      <rect x="200" y="20" width="40" height="40" fill="purple"/>
    </svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

// Average RGB of a small sample box, to check "is this region roughly
// color X" without needing exact-pixel JPEG-compression-tolerant matching.
async function averageColor(buffer: Buffer, left: number, top: number, size: number): Promise<[number, number, number]> {
  const region = await sharp(buffer).extract({ left, top, width: size, height: size }).raw().toBuffer({ resolveWithObject: true });
  const { data, info } = region;
  let r = 0, g = 0, b = 0;
  const pixelCount = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return [r / pixelCount, g / pixelCount, b / pixelCount];
}

function closeTo(actual: [number, number, number], expected: [number, number, number], tolerance = 40): boolean {
  return actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);
}

const RED: [number, number, number] = [255, 0, 0];
const GREEN: [number, number, number] = [0, 128, 0];
const BLUE: [number, number, number] = [0, 0, 255];
const YELLOW: [number, number, number] = [255, 255, 0];
const PURPLE: [number, number, number] = [128, 0, 128];
const WHITE: [number, number, number] = [255, 255, 255];

async function main() {
  const original = await buildTestImage();
  const meta0 = await sharp(original).metadata();
  console.log(`Test image: ${meta0.width}x${meta0.height}`);

  // === Rotation direction: 90° clockwise should move the red (top-left)
  // marker to the top-right, and the purple top-middle needle marker to
  // the right-middle. ===
  {
    const layout: OrientationAndRegions = {
      rotationDegrees: 90,
      pageNotes: null,
      date: "2026-08-15",
      dateConfidence: 0.9,
      regions: [{ kind: "main_table_block", box: { x: 0, y: 0, width: 1, height: 1 } }], // whole image, just to get the rotated buffer back
    };
    const { crops, fullPage } = await rotateAndCropRegions(original, layout);
    check("90°: produces exactly 1 crop for 1 region", crops.length === 1, crops.length);
    const buf = Buffer.from(crops[0].base64, "base64");
    const rotatedMeta = await sharp(buf).metadata();
    console.log(`After 90° rotation + full crop: ${rotatedMeta.width}x${rotatedMeta.height}`);
    check(
      "90° rotation swaps width/height (400x300 -> ~300x400)",
      Math.abs((rotatedMeta.width ?? 0) - 300) < 5 && Math.abs((rotatedMeta.height ?? 0) - 400) < 5,
      rotatedMeta
    );

    const topRight = await averageColor(buf, (rotatedMeta.width ?? 300) - 30, 0, 25);
    const topLeft = await averageColor(buf, 0, 0, 25);
    check("90° CW: the ORIGINAL top-left (red) marker is now at the TOP-RIGHT", closeTo(topRight, RED), topRight);
    check("90° CW: the ORIGINAL top-right (green) marker is now at the BOTTOM-RIGHT", closeTo(await averageColor(buf, (rotatedMeta.width ?? 300) - 30, (rotatedMeta.height ?? 400) - 30, 25), GREEN));
    check("90° CW: top-left corner is no longer red (something else rotated into it)", !closeTo(topLeft, RED));

    // fullPage must be the SAME coordinate space every crop/box is
    // relative to — same dimensions as the rotated crop above, and its
    // own pixels must show the same rotated content (owner report,
    // 2026-10-19: a coordinate-space mismatch here is exactly what
    // produced garbled labels/wrong date on a real photo).
    check(
      "fullPage reports the same dimensions as the rotated crop",
      fullPage.width === rotatedMeta.width && fullPage.height === rotatedMeta.height,
      fullPage
    );
    const fullPageBuf = Buffer.from(fullPage.base64, "base64");
    check(
      "fullPage's own top-right is red too (same rotation as the crop)",
      closeTo(await averageColor(fullPageBuf, fullPage.width - 30, 0, 25), RED)
    );
  }

  // === Region cropping after rotation: crop just the purple needle marker,
  // using a box expressed relative to the UPRIGHT (rotated) image, and
  // confirm the crop is actually purple, not some other part of the page. ===
  {
    // After 90° CW rotation (400x300 -> ~300x400), the purple marker
    // (originally x:200-240,y:20-60 out of 400x300) lands at roughly
    // x: (300-60)=240..(300-20)=280, y: 200..240 out of ~300x400 — i.e.
    // normalized ~ (0.8, 0.5) to (0.93, 0.625).
    const layout: OrientationAndRegions = {
      rotationDegrees: 90,
      pageNotes: null,
      date: "2026-08-15",
      dateConfidence: 0.9,
      regions: [{ kind: "chick_rows", box: { x: 0.75, y: 0.45, width: 0.25, height: 0.25 } }],
    };
    const { crops } = await rotateAndCropRegions(original, layout);
    const buf = Buffer.from(crops[0].base64, "base64");
    const meta = await sharp(buf).metadata();
    const center = await averageColor(buf, Math.floor((meta.width ?? 10) / 2) - 5, Math.floor((meta.height ?? 10) / 2) - 5, 10);
    check("region crop at the purple marker's expected post-rotation position is purple", closeTo(center, PURPLE, 60), center);
  }

  // === Edge case: a box that would overflow the image (x+width > 1) must
  // not crash sharp's extract() — clamped to stay inside. ===
  {
    const layout: OrientationAndRegions = {
      rotationDegrees: 0,
      pageNotes: null,
      date: "2026-08-15",
      dateConfidence: 0.9,
      regions: [{ kind: "feed_box_single", box: { x: 0.9, y: 0.9, width: 0.5, height: 0.5 } }],
    };
    let threw = false;
    try {
      const { crops } = await rotateAndCropRegions(original, layout);
      check("overflowing box still produces a crop (clamped, no crash)", crops.length === 1, crops);
    } catch {
      threw = true;
    }
    check("overflowing box does not throw", !threw);
  }

  // === Edge case: a degenerate (zero-size) box must not crash either. ===
  {
    const layout: OrientationAndRegions = {
      rotationDegrees: 0,
      pageNotes: null,
      date: "2026-08-15",
      dateConfidence: 0.9,
      regions: [{ kind: "chick_rows", box: { x: 0.5, y: 0.5, width: 0, height: 0 } }],
    };
    let threw = false;
    try {
      await rotateAndCropRegions(original, layout);
    } catch {
      threw = true;
    }
    check("zero-size box does not throw (clamped to the minimum crop size)", !threw);
  }

  // === No rotation (0°) must leave the image exactly as it was — the
  // red/green/blue/yellow corners stay where they are. ===
  {
    const layout: OrientationAndRegions = {
      rotationDegrees: 0,
      pageNotes: null,
      date: "2026-08-15",
      dateConfidence: 0.9,
      regions: [{ kind: "main_table_block", box: { x: 0, y: 0, width: 1, height: 1 } }],
    };
    const { crops, fullPage } = await rotateAndCropRegions(original, layout);
    const buf = Buffer.from(crops[0].base64, "base64");
    const meta = await sharp(buf).metadata();
    check("0° rotation keeps the original 400x300 dimensions", meta.width === 400 && meta.height === 300, meta);
    check("0° rotation: top-left stays red", closeTo(await averageColor(buf, 0, 0, 25), RED));
    check("0° rotation: bottom-right stays yellow", closeTo(await averageColor(buf, 370, 270, 25), YELLOW));
    check(
      "fullPage also keeps the original 400x300 dimensions at 0° (the defense-in-depth leading .rotate() is a no-op on an un-EXIF-tagged buffer)",
      fullPage.width === 400 && fullPage.height === 300,
      fullPage
    );
  }

  // === Retry zoom: recropForRetry must actually upscale (more pixels than
  // the sub-box's own raw pixel size), never downscale. ===
  {
    const layout: OrientationAndRegions = {
      rotationDegrees: 0,
      pageNotes: null,
      date: "2026-08-15",
      dateConfidence: 0.9,
      regions: [{ kind: "main_table_block", box: { x: 0, y: 0, width: 1, height: 1 } }],
    };
    const { crops: [wholeCrop] } = await rotateAndCropRegions(original, layout);
    const zoomed = await recropForRetry(wholeCrop.base64, { x: 0.5, y: 0.0, width: 0.1, height: 0.1 }, 1200);
    const zoomedMeta = await sharp(Buffer.from(zoomed.base64, "base64")).metadata();
    console.log(`Retry zoom of a 40x30px sub-area -> ${zoomedMeta.width}x${zoomedMeta.height}`);
    check(
      "retry zoom upscales a small sub-area to roughly the target long edge",
      Math.max(zoomedMeta.width ?? 0, zoomedMeta.height ?? 0) >= 1100,
      zoomedMeta
    );
  }

  // === EXIF orientation (owner report, 2026-10-19, Aug 8 benchmark:
  // garbled labels, wrong date, "only one flock block visible" — traced to
  // a coordinate-space mismatch between what the detection call saw and
  // what crop.ts actually rotated/cropped). Tags the SAME 400x300 test
  // image with real EXIF orientation 6 (phones commonly store sideways
  // sensor data with a tag saying "rotate to display"), WITHOUT physically
  // rotating its pixels — simulating exactly the kind of photo a phone
  // produces — and confirms autoOrientPhoto bakes the correction in and
  // strips the tag, landing on the SAME pixel layout our own
  // rotationDegrees:90 convention already produces (both move the
  // original top-left red marker to the top-right). ===
  {
    const tagged = await sharp(original).withMetadata({ orientation: 6 }).toBuffer();
    const taggedMeta = await sharp(tagged).metadata();
    check(
      "EXIF orientation 6 was actually set on the test fixture, pixels NOT physically rotated",
      taggedMeta.orientation === 6 && taggedMeta.width === 400 && taggedMeta.height === 300,
      taggedMeta
    );

    const oriented = await autoOrientPhoto(tagged);
    const orientedMeta = await sharp(oriented).metadata();
    check(
      "autoOrientPhoto strips the EXIF orientation tag",
      orientedMeta.orientation === undefined,
      orientedMeta
    );
    check(
      "autoOrientPhoto bakes in the EXIF rotation (400x300 -> ~300x400, matching our own 90° convention)",
      Math.abs((orientedMeta.width ?? 0) - 300) < 5 && Math.abs((orientedMeta.height ?? 0) - 400) < 5,
      orientedMeta
    );
    const orientedTopRight = await averageColor(oriented, (orientedMeta.width ?? 300) - 30, 0, 25);
    check(
      "autoOrientPhoto's result matches rotationDegrees:90's own convention (red marker lands top-right)",
      closeTo(orientedTopRight, RED),
      orientedTopRight
    );

    // Defense in depth: even if a caller forgot to pre-orient and handed
    // rotateAndCropRegions a STILL-TAGGED buffer with rotationDegrees:0
    // (as if the detection call had already seen an EXIF-corrected,
    // already-upright view and reasonably said "no further rotation
    // needed"), the function's own leading .rotate() must still correct
    // for the tag rather than silently cropping a sideways image.
    const layout: OrientationAndRegions = {
      rotationDegrees: 0,
      pageNotes: null,
      date: "2026-08-15",
      dateConfidence: 0.9,
      regions: [{ kind: "main_table_block", box: { x: 0, y: 0, width: 1, height: 1 } }],
    };
    const { fullPage } = await rotateAndCropRegions(tagged, layout);
    check(
      "defense in depth: rotateAndCropRegions corrects a still-EXIF-tagged buffer even with rotationDegrees:0",
      Math.abs(fullPage.width - 300) < 5 && Math.abs(fullPage.height - 400) < 5,
      fullPage
    );
    const fallbackTopRight = await averageColor(Buffer.from(fullPage.base64, "base64"), fullPage.width - 30, 0, 25);
    check(
      "defense in depth: the corrected image's red marker is where it should be (top-right)",
      closeTo(fallbackTopRight, RED),
      fallbackTopRight
    );
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
