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

const STRICT_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Safety net (owner report, 2026-10-02, production: every single upload
 * failed with a 400 from the Anthropic API — "invalid base64 data" on one
 * of these exact images). Root cause: the script that first migrated these
 * two images out of hand-written TS into fewShotExamples.data.json used a
 * regex (`.replace(/\+/g, "")`, meant to strip the `+` OPERATORS joining
 * the original multi-line string literal) that couldn't tell those apart
 * from literal `+` CHARACTERS inside the base64 payload itself (`+` is one
 * of the 64 valid base64 alphabet characters) — silently deleting every
 * one of them from both images. Node's own `Buffer.from(str, "base64")`
 * tolerated the resulting misaligned, wrongly-padded string and produced a
 * plausible-looking but truncated JPEG (valid start marker, missing end
 * marker) — nothing in this codebase's own tooling caught it, since the
 * "byte-identical" verification that originally shipped this compared the
 * broken extraction against itself, not against the images' true values.
 * Anthropic's own API validates far more strictly and correctly rejected
 * it outright, on every call.
 *
 * Runs at MODULE LOAD — the moment anything imports this file — as a
 * runtime backstop: it throws on the function's first real invocation
 * rather than sending corrupted data to the Anthropic API silently.
 * Checked directly, not assumed: Next.js's Turbopack build does NOT
 * eagerly evaluate this module's top level during `next build` (traced
 * and confirmed — a deliberately-corrupted version of this file still
 * built successfully, exit 0), so this check alone would NOT have caught
 * the incident before deploy. The actual pre-deploy gate is
 * package.json's "prebuild" script (scripts/verify-fewshot-images.mjs,
 * run automatically by npm before "build" — which is what Vercel's build
 * step invokes) — that's what turns a corruption like this into a failed
 * BUILD. This module-load check is the second, always-on layer under it.
 */
export function validateFewShotExample(ex: FewShotExample): void {
  const b64 = ex.imageBase64;
  if (b64.length === 0 || b64.length % 4 !== 0 || !STRICT_BASE64_RE.test(b64)) {
    throw new Error(
      `few-shot example "${ex.name}" has invalid base64 data (length ${b64.length}) — this would be rejected by the Anthropic API on every extraction call. Regenerate it rather than hand-edit fewShotExamples.data.json.`
    );
  }
  if (ex.mediaType === "image/jpeg") {
    const buf = Buffer.from(b64, "base64");
    const soiOk = buf[0] === 0xff && buf[1] === 0xd8;
    const eoiOk = buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
    if (!soiOk || !eoiOk) {
      throw new Error(
        `few-shot example "${ex.name}" does not decode to a complete JPEG (SOI ok: ${soiOk}, EOI ok: ${eoiOk}) — likely truncated or corrupted base64 data.`
      );
    }
  }
}

export const FEW_SHOT_EXAMPLES: FewShotExample[] = fewShotData.examples as FewShotExample[];
FEW_SHOT_EXAMPLES.forEach(validateFewShotExample);

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
