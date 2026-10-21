// Shared types for the region-cropped reader rebuild (owner's "V4 build
// prompt", Phase 1). Kept in its own file since several modules need the
// same shape.

// Normalized to whichever image it's reported relative to (a half-page
// image, for the first-pass calls; a half-page image again, for a retry
// crop), 0.0-1.0 of width/height, origin top-left — matches how vision
// models are generally most reliable at reporting bounding boxes
// (fractional, not pixel-exact).
export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
