#!/usr/bin/env node
// Real pre-deploy gate (owner report, 2026-10-02, production: every
// upload failed with a 400 from the Anthropic API — "invalid base64
// data" — because a JSON-migration regex had stripped every literal '+'
// character out of two embedded images, indistinguishable to that regex
// from the '+' operators joining the original multi-line string
// literals. Node's own lenient base64 decoder tolerated the corrupted,
// misaligned result and produced a plausible-looking but truncated JPEG;
// Anthropic's stricter API validator correctly rejected it on every
// single call. See lib/extraction/fewShotExamples.ts's
// validateFewShotExample for the same incident from the runtime side.)
//
// Wired as package.json's "prebuild" script — npm runs this
// AUTOMATICALLY before "build" (next build) on every `npm run build`,
// including Vercel's own build step, which is exactly `npm run build`.
// A failure here means `next build` never even starts, so a corrupted
// embed now fails the BUILD, not a silent 400 in production. This was
// verified directly, not assumed: `next build` alone does NOT catch this
// (Turbopack doesn't eagerly evaluate this module at build time — a
// deliberately-corrupted version still built with exit 0), which is
// exactly why this script exists as a separate, explicit gate rather
// than relying on the build step alone.
//
// Run manually with: node scripts/verify-fewshot-images.mjs
// Uses sharp (already a devDependency, present by the time "prebuild"
// runs since npm install always precedes the build command) for a REAL
// image decode — strictly stronger than a magic-byte or base64-shape
// check alone, which is exactly the class of check that would have
// caught this incident before it ever reached `main`.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(__dirname, "../lib/extraction/fewShotExamples.data.json");

const STRICT_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

async function main() {
  const data = JSON.parse(readFileSync(dataPath, "utf8"));
  if (!Array.isArray(data.examples) || data.examples.length === 0) {
    console.error("FAIL: fewShotExamples.data.json has no examples — expected at least the 2 core ones.");
    process.exit(1);
  }

  let failures = 0;
  for (const ex of data.examples) {
    const label = `few-shot example "${ex.name ?? "(unnamed)"}"`;
    const b64 = ex.imageBase64;

    if (typeof b64 !== "string" || b64.length === 0 || b64.length % 4 !== 0 || !STRICT_BASE64_RE.test(b64)) {
      console.error(`FAIL: ${label} — invalid base64 shape (length ${b64 ? b64.length : 0}, not a multiple of 4 or contains invalid characters)`);
      failures++;
      continue;
    }

    const buf = Buffer.from(b64, "base64");
    try {
      const meta = await sharp(buf).metadata();
      console.log(`OK:   ${label} — decodes to a real ${meta.format} image, ${meta.width}x${meta.height}`);
    } catch (err) {
      console.error(`FAIL: ${label} — sharp could not decode this as a real image: ${err instanceof Error ? err.message : err}`);
      failures++;
    }
  }

  if (failures > 0) {
    console.error(`\n${failures}/${data.examples.length} few-shot example(s) failed validation — aborting build.`);
    process.exit(1);
  }
  console.log(`\nAll ${data.examples.length} few-shot example(s) validated OK.`);
}

main();
