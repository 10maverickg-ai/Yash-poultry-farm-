// Shared types for the region-cropped reader rebuild (owner's "V4 build
// prompt", Phase 1). Kept in its own file since both the orientation/region
// call and the crop pipeline need the same shape, and the per-region calls
// need it too.

// Normalized to the UPRIGHT image (after rotation), 0.0-1.0 of width/height,
// origin top-left — matches how vision models are generally most reliable
// at reporting bounding boxes (fractional, not pixel-exact).
export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type RegionKind =
  | "main_table_block" // flocks + subtotal row for the main (right-page) table
  | "continuation_table_block" // same, for the facing/continuation table, if present
  | "big_egg_ledger"
  | "small_egg_ledger"
  | "feed_box_single" // one feed box covering all flocks (from 2026-08-21)
  | "feed_box_main" // "BAB-1-7" box, when there are two (until 2026-08-20)
  | "feed_box_continuation" // "BAB-8-10" box, when there are two
  | "chick_rows";

export interface DetectedRegion {
  kind: RegionKind;
  box: NormalizedBox;
}

export interface OrientationAndRegions {
  // Degrees to rotate the ORIGINAL photo clockwise to make the text
  // upright. Always one of these four — never an arbitrary angle, since a
  // photographed register page is square-on, just sometimes captured
  // sideways or upside down.
  rotationDegrees: 0 | 90 | 180 | 270;
  // Only the regions actually present on THIS photo — e.g. a single
  // feed_box_single when the farm has already moved to one box (from
  // 2026-08-21), or no continuation_table_block at all on a single-table
  // day. Never hard-coded, always read from this specific page.
  regions: DetectedRegion[];
  pageNotes: string | null;
  // Read once here (this call already looks at the whole page) rather than
  // asked again by every per-region call — avoids N inconsistent answers
  // for one page-level fact.
  date: string | null;
  dateConfidence: number;
}
