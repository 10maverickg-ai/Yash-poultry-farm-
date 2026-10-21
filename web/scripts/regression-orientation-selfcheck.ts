// Permanent regression fixture for the orientation pipeline (owner report,
// 2026-10-21, Aug 8 run): the page was UPSIDE DOWN inside the pipeline, so
// every half came back empty and the whole benchmark scored 0%. This runs
// the REAL image flow (autoOrient -> low-res thumbnail -> rotate -> crease
// split -> half crops) with FAKE vision calls, so the rotation logic and
// the empty-half self-check are exercised end to end without an API key.
// Run with `npx tsx scripts/regression-orientation-selfcheck.ts` from `web/`.
//
// The test "register" is a 2000x1500 spread with a dark crease at x=1000.
// Its LEFT page has a red square in its top-left corner; its RIGHT page has
// a green square in its bottom-right corner. The fake extractor only
// "finds" content when it sees those markers in their upright positions —
// so a wrong-way-up half returns nothing, exactly like the real failure.

import sharp from "sharp";
import { readPageHalves, type PipelineDeps } from "../lib/extraction/readerV2/halfPipeline";
import { autoOrientPhoto } from "../lib/extraction/readerV2/autoOrient";
import { rotateUpright } from "../lib/extraction/readerV2/crop";
import {
  rotationFromTextTop,
  makeOrientationThumbnail,
  type PageOrientation,
  type Rotation,
  type TextTop,
} from "../lib/extraction/readerV2/pageOrientation";
import type { HalfFlockRow, HalfSide, PageHalfExtraction } from "../lib/extraction/readerV2/pageHalfRegion";
import {
  assignTableSections,
  assignLedgerSections,
  isHalfEmpty,
  type HalfResult,
} from "../lib/extraction/readerV2/contentMapping";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`PASS: ${name}`);
  } else {
    fail++;
    console.log(`FAIL: ${name}`, detail ?? "");
  }
}

async function buildUpright(width: number, height: number): Promise<Buffer> {
  const spine = Math.round(width / 2);
  const m = Math.round(width * 0.06);
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f2f0e9"/>
    <rect x="${spine - 6}" y="0" width="12" height="${height}" fill="#262626"/>
    <rect x="0" y="0" width="${m}" height="${m}" fill="#ff0000"/>
    <rect x="${width - m}" y="${height - m}" width="${m}" height="${m}" fill="#00a000"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

async function avgColor(base64: string, corner: "top-left" | "bottom-right"): Promise<[number, number, number]> {
  const buf = Buffer.from(base64, "base64");
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const size = Math.max(10, Math.round(w * 0.03));
  const left = corner === "top-left" ? 2 : w - size - 2;
  const top = corner === "top-left" ? 2 : h - size - 2;
  const { data, info } = await sharp(buf).extract({ left, top, width: size, height: size }).raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0;
  const n = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return [r / n, g / n, b / n];
}
const near = (c: [number, number, number], e: [number, number, number], tol = 60) => c.every((v, i) => Math.abs(v - e[i]) <= tol);

function flock(label: string): HalfFlockRow {
  return {
    display_label_as_written: label,
    mortality: 1, feed_bags: 2, eggs_total: 300, eggs_ii: 300, bird_population: 1000,
    bird_population_readings: [1000], hd_percent: 30, margin_note: null,
    confidence: { display_label: 1, mortality: 1, feed_bags: 1, eggs_total: 1, bird_population: 1, hd_percent: 1 },
    ambiguous_digits: null,
    row_box: { x: 0, y: 0, width: 1, height: 0.1 },
  };
}
function emptyHalf(): PageHalfExtraction {
  return { table: null, ledger: null, feedBoxes: [], chickRows: null, half_notes: null, page_date: null, page_date_confidence: 0 };
}
function contentHalf(): PageHalfExtraction {
  return { ...emptyHalf(), table: { flocks: [flock("BAB-1")], subtotal: null, region_notes: null } };
}

// Fake vision: finds content only when its half is upright (marker check).
const fakeExtract: PipelineDeps["extractHalf"] = async (base64, _mt, side: HalfSide) => {
  const upright =
    side === "left"
      ? near(await avgColor(base64, "top-left"), [255, 0, 0])
      : near(await avgColor(base64, "bottom-right"), [0, 160, 0]);
  return upright ? contentHalf() : emptyHalf();
};

function fakeOrientation(rotation: Rotation): PipelineDeps["detectOrientation"] {
  return async (): Promise<PageOrientation> => ({
    rotationDegrees: rotation,
    textTopPointsTo: null,
    modelRotationDegrees: rotation,
    leftPageContent: "unknown",
    disagreementNote: null,
    pageNotes: null,
  });
}

async function run() {
  const W = 2000;
  const H = 1500;
  const upright = await buildUpright(W, H);

  // The photo as physically captured at P degrees clockwise; the correct
  // fix is therefore (360 - P) % 360.
  for (const P of [0, 90, 180, 270] as const) {
    const photo = await sharp(upright).rotate(P).jpeg({ quality: 92 }).toBuffer();
    const correct = ((360 - P) % 360) as Rotation;

    // (a) orientation call answers correctly
    {
      const r = await readPageHalves(photo, { detectOrientation: fakeOrientation(correct), extractHalf: fakeExtract });
      check(`photo turned ${P}°, correct orientation answer: no retry needed`, !r.retriedWith180 && !r.unreadable, r.notes);
      check(`photo turned ${P}°, correct orientation answer: applied ${correct}°`, r.chosen.rotationApplied === correct, r.chosen.rotationApplied);
      check(`photo turned ${P}°: both halves have content`, !isHalfEmpty(r.chosen.left) && !isHalfEmpty(r.chosen.right));
    }

    // (b) orientation call is 180° WRONG (the Aug 8 failure) -> self-check recovers
    {
      const wrong = ((correct + 180) % 360) as Rotation;
      const r = await readPageHalves(photo, { detectOrientation: fakeOrientation(wrong), extractHalf: fakeExtract });
      check(`photo turned ${P}°, orientation 180° wrong: self-check retried`, r.retriedWith180 && r.attempts.length === 2, r.attempts);
      check(`photo turned ${P}°, orientation 180° wrong: recovered to ${correct}°`, r.chosen.rotationApplied === correct && !r.unreadable, {
        applied: r.chosen.rotationApplied,
        unreadable: r.unreadable,
      });
      check(`photo turned ${P}°, orientation 180° wrong: first attempt really was empty`, r.attempts[0].emptyHalves.length > 0, r.attempts[0]);
    }
  }

  // (c) orientation call 90° wrong on an upright photo: sideways, nothing
  // readable either way -> reported UNREADABLE, never empty fields.
  {
    const r = await readPageHalves(upright, { detectOrientation: fakeOrientation(90), extractHalf: fakeExtract });
    check("90° wrong answer (sideways): reported unreadable, not a fake empty reading", r.unreadable === true, r.attempts);
    check("90° wrong answer: the 180° retry was still attempted first", r.retriedWith180 && r.attempts.length === 2);
  }

  // (d) nothing readable at all
  {
    const blank: PipelineDeps["extractHalf"] = async () => emptyHalf();
    const r = await readPageHalves(upright, { detectOrientation: fakeOrientation(0), extractHalf: blank });
    check("two empty halves after the retry: unreadable (ask for a retake)", r.unreadable === true);
  }

  // (e) EXIF-tagged phone photo: sideways pixels + orientation tag 6,
  // run through the real autoOrientPhoto first (as production does).
  {
    const sideways = await sharp(upright).rotate(270).withMetadata({ orientation: 6 }).jpeg({ quality: 92 }).toBuffer();
    const tagged = await sharp(sideways).metadata();
    check("EXIF fixture really carries orientation 6", tagged.orientation === 6, tagged.orientation);
    const oriented = await autoOrientPhoto(sideways);
    const r = await readPageHalves(oriented, { detectOrientation: fakeOrientation(0), extractHalf: fakeExtract });
    check("EXIF-rotated (90°) photo: readable after autoOrient with no further rotation", !r.unreadable && r.chosen.rotationApplied === 0, r);
  }

  // (f) real-size phone photo, upside down, orientation 180° wrong
  {
    const big = await buildUpright(4032, 3024);
    const photo = await sharp(big).rotate(180).jpeg({ quality: 90 }).toBuffer();
    const r = await readPageHalves(photo, { detectOrientation: fakeOrientation(0), extractHalf: fakeExtract });
    check("4032x3024 upside-down photo, orientation said 0°: recovered by the self-check", r.retriedWith180 && !r.unreadable && r.chosen.rotationApplied === 180, r.attempts);
  }

  // (g) text-direction -> rotation, verified against real pixels: build the
  // photo the way a camera would have to be turned for the tops of the
  // text to point up/left/down/right, then confirm the derived rotation
  // restores the upright layout (red top-left).
  {
    const physical: Record<TextTop, number> = { up: 0, left: 270, down: 180, right: 90 };
    for (const top of ["up", "left", "down", "right"] as const) {
      check(`rotationFromTextTop(${top}) = ${{ up: 0, left: 90, down: 180, right: 270 }[top]}`, rotationFromTextTop(top) === ({ up: 0, left: 90, down: 180, right: 270 } as const)[top]);
      const photo = await sharp(upright).rotate(physical[top]).jpeg({ quality: 92 }).toBuffer();
      const fixed = await rotateUpright(photo, rotationFromTextTop(top));
      check(`text tops pointing ${top}: derived rotation restores red top-left`, near(await avgColor(fixed.base64, "top-left"), [255, 0, 0]));
    }
  }

  // (h) low-resolution orientation copy
  {
    const big = await buildUpright(4032, 3024);
    const thumb = await makeOrientationThumbnail(big);
    const meta = await sharp(Buffer.from(thumb.base64, "base64")).metadata();
    check("orientation thumbnail is low-res (long edge <= 1280px)", Math.max(meta.width ?? 0, meta.height ?? 0) <= 1280, meta);
  }

  // (i) mapping by CONTENT, not by side
  {
    const bigTable: PageHalfExtraction = {
      ...emptyHalf(),
      table: { flocks: ["BAB-1", "BAB-2", "BAB-3", "BAB-4", "BAB-5", "BAB-6", "BAB-7"].map(flock), subtotal: null, region_notes: null },
      ledger: { opening_balance_eggs: 30, total_eggs_produced: 30, total_line_eggs: 60, deductions: [], closing_balance_eggs: 60, region_notes: null, confidence: { opening_balance_eggs: 1, total_eggs_produced: 1, total_line_eggs: 1, closing_balance_eggs: 1 } },
    };
    const smallTable: PageHalfExtraction = {
      ...emptyHalf(),
      table: { flocks: ["BAB-8", "BAB-9", "BAB-10"].map(flock), subtotal: null, region_notes: null },
      ledger: { opening_balance_eggs: 90, total_eggs_produced: 30, total_line_eggs: 120, deductions: [], closing_balance_eggs: 120, region_notes: null, confidence: { opening_balance_eggs: 1, total_eggs_produced: 1, total_line_eggs: 1, closing_balance_eggs: 1 } },
    };
    for (const [bigSide, smallSide] of [["right", "left"], ["left", "right"]] as const) {
      const halves: HalfResult[] = [
        { side: bigSide, extraction: bigTable },
        { side: smallSide, extraction: smallTable },
      ];
      const roles = assignTableSections(halves);
      check(`7-flock table is "main" wherever it sits (on the ${bigSide})`, roles.get(bigSide) === "main" && roles.get(smallSide) === "continuation", [...roles]);
      const ledgers = assignLedgerSections(halves, roles);
      check(`ledger under the main table is "big" (${bigSide} side)`, ledgers.get("big")?.side === bigSide && ledgers.get("small")?.side === smallSide, [...ledgers].map(([k, v]) => [k, v.side]));
    }
    const only = assignTableSections([{ side: "left", extraction: bigTable }, { side: "right", extraction: emptyHalf() }]);
    check("a single table on a page is the main table", only.get("left") === "main" && only.size === 1);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
