import { loadSharp } from "./sharpLoader";

// Owner request, 2026-10-19 (Aug 8 benchmark): when the reader goes wrong,
// the benchmark page's numbers alone don't say WHY — these draw on top of
// the actual images the model was shown, so a bad split or an
// unexpectedly empty half is visible at a glance instead of inferred from
// garbled output.
//
// Revised 2026-10-21 (owner report — Aug 3 photo filed under Aug 8, every
// model-drawn region box wrong): region boxes have been removed as the
// primary read method (see pageSplit.ts's header comment) and so has the
// box-drawing this file used to do. All that's left to draw is the single
// spine line pageSplit.ts's deterministic split used — everything else
// the model was shown is just a half-page image, already a "debug
// picture" on its own once downscaled.
//
// Owner report, 2026-10-21 (separate issue, now fixed): on a real Aug 8
// photo, an earlier version of this file's compositing threw "Image to
// composite must have same dimensions or smaller". Two causes, both
// avoided here: (1) never hand sharp's composite() a raw, un-rasterized
// SVG buffer — rasterize it to its own buffer first and force-resize it
// to the base image's EXACT pixel dimensions; (2) never chain .resize()
// directly onto a pipeline with a pending .composite() — sharp's libjpeg
// "shrink-on-load" optimization can decode the base image already
// shrunk toward the pipeline's eventual resize target, so composite()
// then sees a base smaller than the overlay. Composite runs to
// completion in its own sharp call before a separate call does the
// downscale.

export interface BoxedPageImage {
  base64: string;
  mediaType: "image/jpeg";
}

// Draws a single vertical line at the detected (or fallen-back-to)
// spine column, on top of the already-upright full page, downscaled for
// display — this is a diagnostic picture for a human, never anything sent
// back to the model.
export async function drawSpineLine(fullPageBase64: string, spineX: number): Promise<BoxedPageImage> {
  const sharp = await loadSharp();
  const buffer = Buffer.from(fullPageBase64, "base64");
  const meta = await sharp(buffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width <= 0 || height <= 0) {
    throw new Error(`Full page image has no usable dimensions (${width}x${height}) — can't draw its spine line.`);
  }
  const x = Math.min(Math.max(Math.round(spineX), 0), width);

  const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#e11d48" stroke-width="8"/></svg>`;

  // Rasterize the SVG to its own buffer, then force it to the base
  // image's EXACT dimensions — see this file's header comment for why
  // this extra step exists (a real-photo-only bug the original small
  // synthetic test never exposed).
  const overlayBuffer = await sharp(Buffer.from(svg))
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();

  // Composite in its OWN sharp call (see header comment) — never chain a
  // resize onto the same pipeline as a pending composite.
  const composited = await sharp(buffer)
    .composite([{ input: overlayBuffer, top: 0, left: 0 }])
    .png()
    .toBuffer();

  const overlaid = await sharp(composited)
    .resize({ width: 1400, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  return { base64: overlaid.toString("base64"), mediaType: "image/jpeg" };
}

// A plain downscaled copy of an already-cropped/split image, for embedding
// on the benchmark page without bloating the HTML with full-resolution
// images — the model itself still gets the full-resolution base64 these
// are derived from, never this downscaled copy.
export async function downscaleForDisplay(base64: string, maxWidth = 900): Promise<string> {
  const sharp = await loadSharp();
  const buffer = Buffer.from(base64, "base64");
  const resized = await sharp(buffer).resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  return resized.toString("base64");
}
