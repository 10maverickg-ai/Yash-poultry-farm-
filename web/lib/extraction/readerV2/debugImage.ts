import { loadSharp } from "./sharpLoader";
import type { DetectedRegion } from "./types";

// Owner request, 2026-10-19 (Aug 8 benchmark): when the reader goes wrong,
// the benchmark page's numbers alone don't say WHY — this draws the
// detected region boxes on top of the actual upright page the model was
// shown, so a bad box (wrong place, wrong size, rotated wrong) is visible
// at a glance instead of inferred from garbled output.

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

  const rects = regions
    .map((r) => {
      const x = Math.round(r.box.x * width);
      const y = Math.round(r.box.y * height);
      const w = Math.round(r.box.width * width);
      const h = Math.round(r.box.height * height);
      const color = REGION_COLORS[r.kind] ?? DEFAULT_COLOR;
      const labelY = Math.max(y - 10, 24);
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="6"/>
<text x="${x + 4}" y="${labelY}" font-size="30" font-family="sans-serif" font-weight="bold" fill="${color}" stroke="white" stroke-width="4" paint-order="stroke">${escapeXml(r.kind)}</text>`;
    })
    .join("\n");

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;

  const overlaid = await sharp(buffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
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
