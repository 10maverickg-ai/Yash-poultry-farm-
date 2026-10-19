import type { NormalizedBox, OrientationAndRegions, RegionKind } from "./types";
import { loadSharp } from "./sharpLoader";

// Reader rebuild, the pure-image half of stage 1→2 (owner's "V4 build
// prompt", Phase 1): takes the ORIGINAL photo plus the orientation/region
// call's answer (orientationAndRegions.ts) and turns it into one upright,
// full-resolution JPEG crop per detected region. No API call here at all —
// this is why it's the one part of the reader rebuild this sandbox can
// actually exercise end to end (see
// scripts/regression-reader-v2-crop.ts).

export interface CroppedRegion {
  kind: RegionKind;
  base64: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
}

export interface FullPageImage {
  base64: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
}

export interface RotateAndCropResult {
  crops: CroppedRegion[];
  // The whole UPRIGHT (post-orientation) page, at full resolution — same
  // coordinate space every crop and every region box is relative to.
  // Exists for two reasons (owner request, 2026-10-19): (1) a fallback
  // source when a detected region's own box looks too small/untrustworthy
  // (see readerV2/index.ts's MIN_TABLE_AREA_FRACTION), and (2) so the
  // benchmark page can draw the detected boxes on top of it and show the
  // owner exactly what the model was shown.
  fullPage: FullPageImage;
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

export async function rotateAndCropRegions(
  imageBuffer: Buffer,
  layout: OrientationAndRegions
): Promise<RotateAndCropResult> {
  const sharp = await loadSharp();
  // Owner report, 2026-10-19 (Aug 8 benchmark — garbled labels, wrong
  // date, "only one flock block visible"): callers are expected to have
  // already run the buffer through autoOrient.ts before it ever reaches
  // the detection call OR here, so both see the exact same pixels. The
  // leading, argument-less .rotate() below is defense in depth, not the
  // primary fix — it re-applies (or, if already applied, harmlessly
  // no-ops on) the EXIF correction immediately before the explicit
  // rotationDegrees rotation, so this function can never silently misread
  // a stale orientation tag even if some future caller forgets the
  // upstream step.
  const rotatedBuffer = await sharp(imageBuffer).rotate().rotate(layout.rotationDegrees).toBuffer();
  const rotatedMeta = await sharp(rotatedBuffer).metadata();
  const imageWidth = rotatedMeta.width ?? 0;
  const imageHeight = rotatedMeta.height ?? 0;

  const crops: CroppedRegion[] = [];
  for (const region of layout.regions) {
    const { left, top, width, height } = clamp(region.box, imageWidth, imageHeight);
    const cropped = await sharp(rotatedBuffer)
      .extract({ left, top, width, height })
      .jpeg({ quality: 92 })
      .toBuffer();
    crops.push({
      kind: region.kind,
      base64: cropped.toString("base64"),
      mediaType: "image/jpeg",
      width,
      height,
    });
  }

  const fullPageBuffer = await sharp(rotatedBuffer).jpeg({ quality: 90 }).toBuffer();
  const fullPage: FullPageImage = {
    base64: fullPageBuffer.toString("base64"),
    mediaType: "image/jpeg",
    width: imageWidth,
    height: imageHeight,
  };

  return { crops, fullPage };
}

// Checksum-driven retry: zoom into one flock's own row box (reported
// relative to the region crop it came from, not the original photo) and
// upscale it so the model is looking at a far larger, sharper version of
// just that figure — never a blind re-ask of the whole section.
export async function recropForRetry(
  regionBase64: string,
  box: NormalizedBox,
  targetLongEdgePx = 1200
): Promise<RetryCrop> {
  const sharp = await loadSharp();
  const regionBuffer = Buffer.from(regionBase64, "base64");
  const meta = await sharp(regionBuffer).metadata();
  const imageWidth = meta.width ?? 0;
  const imageHeight = meta.height ?? 0;
  const { left, top, width, height } = clamp(box, imageWidth, imageHeight);

  const cropped = await sharp(regionBuffer).extract({ left, top, width, height }).toBuffer();
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
