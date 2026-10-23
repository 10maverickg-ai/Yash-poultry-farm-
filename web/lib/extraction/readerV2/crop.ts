import type { NormalizedBox } from "./types";
import { loadSharp } from "./sharpLoader";

// Reader rebuild, the pure-image half of the pipeline (owner's "V4 build
// prompt", Phase 1; revised 2026-10-21 — see pageSplit.ts's header comment
// for why model-drawn region boxes were removed as the primary crop
// method). Two jobs left here: rotate the original photo to upright
// (rotateUpright, feeding pageSplit.ts's deterministic spine split), and
// zoom into one small, PRECISELY KNOWN box for a checksum-guided retry
// (recropForRetry) — e.g. a flock's own row_box, reported by the first-pass
// half-page call relative to that half image. No API call in this file at
// all, which is why it's one of the few parts of the reader rebuild this
// sandbox can exercise end to end (see scripts/regression-reader-v2-crop.ts).

export interface FullPageImage {
  base64: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
}

export interface RetryCrop {
  base64: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
}

// A model-reported box can be degenerate (zero-size) or run past the image
// edge — never let that reach sharp's extract() as a raw, untrusted
// rectangle; always resolve it to something extract() can't throw on.
const MIN_CROP_PX = 20;

function clamp(
  box: NormalizedBox,
  imageWidth: number,
  imageHeight: number
): { left: number; top: number; width: number; height: number } {
  let left = Math.round(box.x * imageWidth);
  let top = Math.round(box.y * imageHeight);
  let width = Math.max(Math.round(box.width * imageWidth), MIN_CROP_PX);
  let height = Math.max(Math.round(box.height * imageHeight), MIN_CROP_PX);

  left = Math.min(Math.max(left, 0), Math.max(imageWidth - width, 0));
  top = Math.min(Math.max(top, 0), Math.max(imageHeight - height, 0));
  width = Math.min(width, Math.max(imageWidth - left, MIN_CROP_PX > imageWidth ? imageWidth : MIN_CROP_PX));
  height = Math.min(height, Math.max(imageHeight - top, MIN_CROP_PX > imageHeight ? imageHeight : MIN_CROP_PX));

  return { left, top, width, height };
}

// Rotates the ORIGINAL (already EXIF-corrected, via autoOrient.ts) photo to
// upright using the orientation call's own rotation answer, and returns
// the whole upright page at full resolution — the single image
// pageSplit.ts's deterministic spine-finding and both half-page extraction
// calls are built from.
export async function rotateUpright(
  imageBuffer: Buffer,
  rotationDegrees: 0 | 90 | 180 | 270
): Promise<FullPageImage> {
  const sharp = await loadSharp();
  // Defense in depth (unchanged reasoning from the previous version of
  // this function): a leading, argument-less .rotate() re-applies (or, if
  // already applied, harmlessly no-ops) any EXIF correction immediately
  // before the explicit rotation, so this can never silently misread a
  // stale orientation tag even if some future caller forgets the upstream
  // autoOrientPhoto step.
  const rotatedBuffer = await sharp(imageBuffer).rotate().rotate(rotationDegrees).jpeg({ quality: 92 }).toBuffer();
  const meta = await sharp(rotatedBuffer).metadata();
  return {
    base64: rotatedBuffer.toString("base64"),
    mediaType: "image/jpeg",
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };
}

// Checksum-driven retry: zoom into one small, precisely known box (e.g. a
// flock's own row_box, reported relative to the half-page image it came
// from) and upscale it so the model is looking at a far larger, sharper
// version of just that figure — never a blind re-ask of the whole half.
export async function recropForRetry(
  sourceBase64: string,
  box: NormalizedBox,
  targetLongEdgePx = 1200
): Promise<RetryCrop> {
  const sharp = await loadSharp();
  const sourceBuffer = Buffer.from(sourceBase64, "base64");
  const meta = await sharp(sourceBuffer).metadata();
  const imageWidth = meta.width ?? 0;
  const imageHeight = meta.height ?? 0;
  const { left, top, width, height } = clamp(box, imageWidth, imageHeight);

  const cropped = await sharp(sourceBuffer).extract({ left, top, width, height }).toBuffer();
  const longEdge = Math.max(width, height);
  const scale = longEdge > 0 ? targetLongEdgePx / longEdge : 1;
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));

  const resized = await sharp(cropped)
    .resize(outWidth, outHeight, { kernel: "lanczos3" })
    .jpeg({ quality: 92 })
    .toBuffer();

  return {
    base64: resized.toString("base64"),
    mediaType: "image/jpeg",
    width: outWidth,
    height: outHeight,
  };
}
