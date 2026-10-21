import { loadSharp } from "./sharpLoader";
import type { DetectedRegion, NormalizedBox } from "./types";

// Owner request, 2026-10-19 (Aug 8 benchmark): when the reader goes wrong,
// the benchmark page's numbers alone don't say WHY — this draws the
// detected region boxes on top of the actual upright page the model was
// shown, so a bad box (wrong place, wrong size, rotated wrong) is visible
// at a glance instead of inferred from garbled output.
//
// Owner report, 2026-10-21: on a real Aug 8 photo this threw "Image to
// composite must have same dimensions or smaller". Two distinct causes,
// both fixed below:
//
// 1) Handing sharp's composite() a raw, un-rasterized SVG buffer as the
//    overlay lets IT rasterize the SVG internally at composite time, and
//    SVG rasterization (librsvg) can land a pixel or two off the requested
//    width/height. Fixed by rasterizing the SVG to its OWN buffer FIRST,
//    then force-resizing that raster to the base image's EXACT pixel
//    dimensions (fit: "fill", never aspect-preserving — this is a
//    transparent overlay, not a photo) before it ever reaches composite().
//
// 2) The real culprit on real photos, found by a regression test built at
//    actual phone-photo dimensions (4032x3024 / 3024x4032) — a tiny
//    synthetic fixture never triggers this: chaining .resize() AFTER
//    .composite() in a SINGLE sharp pipeline lets sharp's libjpeg
//    "shrink-on-load" optimization decode the base JPEG already shrunk
//    toward the pipeline's eventual resize target (e.g. a 4032-wide photo
//    being resized down to 1400 wide gets fast-decoded at ~2016 wide by
//    libvips, long before composite() ever runs) — so by the time
//    composite() actually executes, the base buffer is SMALLER than the
//    full-size overlay, and it refuses. Fixed by running composite() to
//    completion in its own sharp call, THEN feeding that finished buffer
//    into a SEPARATE sharp() call for the downscale — the shrink-on-load
//    optimization never sees a resize target while composite() is
//    pending, so the base and overlay are always decoded at the same
//    full size when they meet.

const REGION_COLORS: Record<string, string> = {
  main_table_block: "#e11d48",
  continuation_table_block: "#2563eb",
  big_egg_ledger: "#16a34a",
  small_egg_ledger: "#0891b2",
  feed_box_single: "#d97706",
  feed_box_main: "#d97706",
  feed_box_continuation: "#c026d3",
  chick_rows: "#7c3aed",
};
const DEFAULT_COLOR = "#000000";

export interface BoxedPageImage {
  base64: string;
  mediaType: "image/jpeg";
}

// A model-reported box can run past the image edge or go negative — never
// let that reach the SVG as a raw, untrusted rectangle (owner request,
// 2026-10-21: "clamp box coordinates to the image bounds").
function clampBoxToPixels(
  box: NormalizedBox,
  width: number,
  height: number
): { x: number; y: number; w: number; h: number } {
  const x = Math.min(Math.max(Math.round(box.x * width), 0), width);
  const y = Math.min(Math.max(Math.round(box.y * height), 0), height);
  const w = Math.min(Math.max(Math.round(box.width * width), 0), Math.max(width - x, 0));
  const h = Math.min(Math.max(Math.round(box.height * height), 0), Math.max(height - y, 0));
  return { x, y, w, h };
}

// Draws every detected region's box (and kind label) on top of the
// already-upright full page image, downscaled for display — this is a
// diagnostic picture for a human, never anything sent back to the model.
export async function drawRegionBoxes(
  fullPageBase64: string,
  regions: DetectedRegion[]
): Promise<BoxedPageImage> {
  const sharp = await loadSharp();
  const buffer = Buffer.from(fullPageBase64, "base64");
  const meta = await sharp(buffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width <= 0 || height <= 0) {
    throw new Error(`Full page image has no usable dimensions (${width}x${height}) — can't draw boxes on it.`);
  }

  const rects = regions
    .map((r) => {
      const { x, y, w, h } = clampBoxToPixels(r.box, width, height);
      const color = REGION_COLORS[r.kind] ?? DEFAULT_COLOR;
      const labelY = Math.max(y - 10, 24);
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="6"/>
<text x="${x + 4}" y="${labelY}" font-size="30" font-family="sans-serif" font-weight="bold" fill="${color}" stroke="white" stroke-width="4" paint-order="stroke">${escapeXml(r.kind)}</text>`;
    })
    .join("\n");

  const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;

  // Rasterize the SVG to its own buffer, then force it to the base
  // image's EXACT dimensions — see this file's header comment for why
  // this extra step exists (a real-photo-only bug the original small
  // synthetic test never exposed).
  const overlayBuffer = await sharp(Buffer.from(svg))
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();

  // Composite in its OWN sharp call (see header comment, cause #2) — never
  // chain a resize onto the same pipeline as a pending composite.
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

// A plain downscaled copy of an already-cropped region, for embedding on
// the benchmark page without bloating the HTML with full-resolution crops
// — the model itself still gets the full-resolution base64 these are
// derived from, never this downscaled copy.
export async function downscaleForDisplay(base64: string, maxWidth = 900): Promise<string> {
  const sharp = await loadSharp();
  const buffer = Buffer.from(base64, "base64");
  const resized = await sharp(buffer).resize({ width: maxWidth, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  return resized.toString("base64");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
