// Few-shot digit-style reference crops for the Daily Production extraction
// prompt (owner report, 2026-09-28: digit accuracy, especially 3-vs-8 and
// 1-vs-7 confusion in this scribe's handwriting; extended 2026-10-02 into a
// growing, periodically-curated library — see extraction_corrections in the
// DB and scripts/promote-correction.ts). The original two examples were
// cropped from a real, already-reviewed page
// (docs/sample-registers/sample-3-single-page-7-7-26.jpg, the BAB-2/4/5
// rows) — not synthetic, and not from the farm's live data (this sample
// predates any owner-specific figures being treated as confidential).
//
// Data lives in fewShotExamples.data.json, not inline in this file, so
// scripts/promote-correction.ts can safely add/replace/remove entries by
// reading and writing plain JSON rather than doing text surgery on
// hand-written TypeScript (a base64 image blob is 50-80KB — a regex
// mistake editing that inline would be easy to make and hard to notice).
// Still statically imported, not read from disk at runtime: this module
// runs in a Vercel serverless function, and a JSON import is resolved and
// bundled at BUILD time by Next.js like any other import (unlike
// fs.readFileSync, which would depend on Next.js's file tracing correctly
// including a bundled asset — an untested assumption this project has
// never otherwise depended on).

import fewShotData from "./fewShotExamples.data.json";

export interface FewShotExample {
  name: string;
  source: "core" | "promoted";
  caption: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  imageBase64: string;
  // Present only for a "promoted" example — the extraction_corrections.id
  // it was promoted from, so scripts/promote-correction.ts can mark that
  // row retired if this example is later replaced.
  correctionId?: number;
}

// Total examples (core + promoted) ever sent in one extraction call.
// Measured, not guessed: the two existing core examples are 1290x270 and
// 1350x246px, ~450 tokens each by Anthropic's image-token formula
// (width*height/750), ~500-550 tokens per example once its caption text is
// included. At this cap (8), the few-shot material adds roughly 4000-4400
// tokens to every extraction call — small next to the actual register
// photo itself, but it repeats on every single upload, so scripts/
// promote-correction.ts enforces this rather than letting the set grow
// unbounded. Picking WHICH example to retire when at cap is a curation
// judgment call (owner request: "weakest/least-representative"), not
// something this script infers automatically — see its --replace flag.
export const MAX_FEW_SHOT_EXAMPLES = 8;

export const FEW_SHOT_EXAMPLES: FewShotExample[] = fewShotData.examples as FewShotExample[];

export const FEW_SHOT_DIGIT_EXAMPLES = FEW_SHOT_EXAMPLES.flatMap((ex) => [
  {
    type: "text" as const,
    text: ex.caption,
  },
  {
    type: "image" as const,
    source: { type: "base64" as const, media_type: ex.mediaType, data: ex.imageBase64 },
  },
]);
