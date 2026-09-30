// Promotion script (owner request, 2026-10-02) — moves one confirmed
// correction from extraction_corrections into the live extraction
// prompt's few-shot example set. Run MANUALLY, only when the owner and
// Claude have reviewed a batch of candidates together and picked one to
// promote — never invoked automatically, never part of the deployed app
// (only imported here, in a standalone script).
//
// What this does NOT do, and why: it does not locate where a given
// flock's row sits on a register photo. No automated row-detection
// (OCR/bounding-box) exists anywhere in this codebase — the two original
// few-shot examples were cropped by hand, outside any script, and no
// per-upload bounding-box metadata is ever stored. The curator (owner or
// Claude, looking at the actual photo) supplies either an
// already-cropped image file (--crop) or a pixel rectangle on the
// original photo (--photo-url + --rect) — this script automates
// everything AFTER that point: fetching, cropping to the given
// rectangle, encoding, updating the few-shot data file, enforcing the
// example-count cap, and updating extraction_corrections' status.
//
// Usage (from web/):
//   npx tsx scripts/promote-correction.ts \
//     --id 1 \
//     --crop /path/to/already-cropped-row.jpg \
//     --caption "Reference example — ..." \
//     [--replace <existing-example-name>] \
//     [--dry-run]
// or, to crop from the original photo directly:
//   npx tsx scripts/promote-correction.ts \
//     --id 1 \
//     --photo-url https://.../original.jpg \
//     --rect 120,860,1350,246 \
//     --caption "..." \
//     [--replace <name>] [--dry-run]
//
// --dry-run performs the real fetch/crop/encode and prints exactly what
// WOULD change (the data file's new contents, which DB rows would be
// updated) without writing the file or touching the database — this is
// how a new mechanism gets proven correct before anything is actually
// promoted (see docs/DECISIONS.md).

import fs from "fs";
import path from "path";
import sharp from "sharp";
import { pool } from "../lib/db";
import { MAX_FEW_SHOT_EXAMPLES, type FewShotExample } from "../lib/extraction/fewShotExamples";

interface Args {
  id: number;
  photoUrl?: string;
  rect?: [number, number, number, number];
  crop?: string;
  caption: string;
  replace?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const has = (flag: string): boolean => argv.includes(flag);

  const idStr = get("--id");
  if (!idStr) throw new Error("--id <extraction_corrections.id> is required");
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`--id must be a positive integer, got '${idStr}'`);

  const caption = get("--caption");
  if (!caption) throw new Error('--caption "<calibration text>" is required');

  const crop = get("--crop");
  const photoUrl = get("--photo-url");
  const rectStr = get("--rect");
  let rect: [number, number, number, number] | undefined;
  if (rectStr) {
    const parts = rectStr.split(",").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error(`--rect must be "x,y,w,h" (four numbers), got '${rectStr}'`);
    }
    rect = parts as [number, number, number, number];
  }
  if (!crop && !photoUrl) {
    throw new Error("supply either --crop <local file> or --photo-url <url> --rect x,y,w,h");
  }
  if (photoUrl && !rect) {
    throw new Error("--rect x,y,w,h is required alongside --photo-url — this script never guesses where a row is on the page");
  }

  return { id, photoUrl, rect, crop, caption, replace: get("--replace"), dryRun: has("--dry-run") };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const { rows } = await pool.query(
    `SELECT id, farm_code, date, flock_label, field_name, extracted_value, correct_value, status, source_photo_url
       FROM extraction_corrections WHERE id = $1`,
    [args.id]
  );
  if (rows.length === 0) throw new Error(`extraction_corrections id ${args.id} not found`);
  const correction = rows[0];
  if (correction.status !== "candidate") {
    throw new Error(
      `id ${args.id} has status '${correction.status}', not 'candidate' — refusing to promote a row that's already active or retired`
    );
  }

  let cropBuffer: Buffer;
  if (args.crop) {
    cropBuffer = fs.readFileSync(args.crop);
  } else {
    const photoUrl = args.photoUrl ?? correction.source_photo_url;
    if (!photoUrl) {
      throw new Error("no --photo-url given and this row has no source_photo_url on file — supply --crop or --photo-url");
    }
    const res = await fetch(photoUrl);
    if (!res.ok) throw new Error(`fetching ${photoUrl} failed: ${res.status} ${res.statusText}`);
    const original = Buffer.from(await res.arrayBuffer());
    const [left, top, width, height] = args.rect!;
    cropBuffer = await sharp(original).extract({ left, top, width, height }).jpeg({ quality: 90 }).toBuffer();
  }

  const imageBase64 = cropBuffer.toString("base64");
  const dataPath = path.join(__dirname, "../lib/extraction/fewShotExamples.data.json");
  const data: { examples: FewShotExample[] } = JSON.parse(fs.readFileSync(dataPath, "utf8"));

  const newExample: FewShotExample = {
    name: `correction_${correction.id}`,
    source: "promoted",
    caption: args.caption,
    mediaType: "image/jpeg",
    imageBase64,
    // pg returns bigint columns as strings by default (avoids silent
    // precision loss on values beyond Number.MAX_SAFE_INTEGER) — this
    // table will never get remotely close to that range, so a plain
    // Number() cast is safe and keeps correctionId genuinely numeric,
    // matching FewShotExample's own type.
    correctionId: Number(correction.id),
  };

  let retiredCorrectionId: number | null = null;
  if (args.replace) {
    const idx = data.examples.findIndex((e) => e.name === args.replace);
    if (idx === -1) {
      throw new Error(`--replace ${args.replace}: no example with that name exists. Current: ${data.examples.map((e) => e.name).join(", ")}`);
    }
    retiredCorrectionId = data.examples[idx].correctionId ?? null;
    data.examples.splice(idx, 1, newExample);
  } else {
    if (data.examples.length >= MAX_FEW_SHOT_EXAMPLES) {
      throw new Error(
        `already at the cap (${MAX_FEW_SHOT_EXAMPLES}) — pick which existing example to retire with --replace <name>. This is a curation judgment call, not something this script infers. Current: ${data.examples.map((e) => e.name).join(", ")}`
      );
    }
    data.examples.push(newExample);
  }

  const prefix = args.dryRun ? "[DRY RUN] " : "";
  console.log(
    `\n${prefix}Promoting correction id ${correction.id} (${correction.flock_label ?? "page-level"}, ` +
      `${correction.field_name}: ${correction.extracted_value} -> ${correction.correct_value}, ${correction.date})`
  );
  console.log(`  New example: name=${newExample.name}, caption="${newExample.caption}"`);
  console.log(`  Image: ${cropBuffer.length} bytes, base64 ${imageBase64.length} chars`);
  console.log(
    `  fewShotExamples.data.json would then have ${data.examples.length}/${MAX_FEW_SHOT_EXAMPLES} example(s): ` +
      data.examples.map((e) => e.name).join(", ")
  );
  if (retiredCorrectionId !== null) {
    console.log(`  Replacing example "${args.replace}" — its source correction id ${retiredCorrectionId} would be marked 'retired'`);
  }

  if (args.dryRun) {
    console.log("\n[DRY RUN] No file written, no database row changed.");
    await pool.end();
    return;
  }

  fs.writeFileSync(dataPath, JSON.stringify(data));
  await pool.query(`UPDATE extraction_corrections SET status = 'active', promoted_at = now() WHERE id = $1`, [correction.id]);
  if (retiredCorrectionId !== null) {
    await pool.query(`UPDATE extraction_corrections SET status = 'retired' WHERE id = $1`, [retiredCorrectionId]);
  }

  console.log(
    "\nDone. lib/extraction/fewShotExamples.data.json was updated on disk — commit it and deploy for this to " +
      "take effect on live extraction calls; nothing here deploys automatically."
  );
  await pool.end();
}

main().catch((err) => {
  console.error("promote-correction failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
