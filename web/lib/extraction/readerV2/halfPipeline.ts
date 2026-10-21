import { rotateUpright, type FullPageImage } from "./crop";
import { splitPageIntoHalves, type PageSplitResult } from "./pageSplit";
import {
  detectPageOrientation,
  makeOrientationThumbnail,
  type PageOrientation,
  type Rotation,
} from "./pageOrientation";
import { extractPageHalf, type HalfSide, type PageHalfExtraction } from "./pageHalfRegion";
import { halfContentCount, isHalfEmpty } from "./contentMapping";

// The shared front half of the reader (used by both the real upload path,
// index.ts, and the benchmark page, benchmark.ts), written 2026-10-21 after
// the Aug 8 run came back 0% because the page was upside down inside the
// pipeline:
//
//   1. a cheap, LOW-RESOLUTION vision call decides the rotation
//      (pageOrientation.ts) — never EXIF/heuristics alone;
//   2. the photo is turned upright, split at its crease into two halves,
//      and each half is read in full by one content-agnostic call;
//   3. SELF-CHECK: if either half comes back with no flocks AND no ledger
//      AND no feed box, the photo is turned a further 180° and read once
//      more (the usual cause of an empty half is a wrong-way-up page — a
//      90°/270° mix-up is exactly 180° apart); the better of the two
//      attempts is kept;
//   4. if the best attempt still has BOTH halves empty, the photo is
//      reported unreadable — callers must ask for a retake, never present
//      empty fields as if they were a reading.
//
// The two vision functions are injectable so the whole flow (including the
// real image rotation, splitting and cropping) can be regression-tested
// with fakes — see scripts/regression-orientation-selfcheck.ts.

export interface PipelineDeps {
  detectOrientation: (imageBase64: string, mediaType: string) => Promise<PageOrientation>;
  extractHalf: (imageBase64: string, mediaType: string, side: HalfSide) => Promise<PageHalfExtraction>;
}

const DEFAULT_DEPS: PipelineDeps = {
  detectOrientation: detectPageOrientation,
  extractHalf: (imageBase64, mediaType, side) => extractPageHalf(imageBase64, mediaType, side),
};

export interface PageAttempt {
  rotationApplied: Rotation;
  fullPage: FullPageImage;
  split: PageSplitResult;
  left: PageHalfExtraction;
  right: PageHalfExtraction;
}

export interface AttemptSummary {
  rotationApplied: Rotation;
  spineX: number;
  spineConfidence: "detected" | "fallback_midpoint";
  leftItems: number;
  rightItems: number;
  emptyHalves: HalfSide[];
}

export interface PageReadResult {
  orientation: PageOrientation;
  attempts: AttemptSummary[];
  retriedWith180: boolean;
  chosen: PageAttempt;
  // True when even the best attempt had both halves empty — the caller
  // must ask for a retake.
  unreadable: boolean;
  // Plain-language lines for the debug page / logs.
  notes: string[];
}

export const UNREADABLE_MESSAGE =
  "This photo couldn't be read — neither page showed anything the reader could recognise, even after turning it around. Please retake it: both pages flat and fully in the frame, with the writing reading the right way up, then upload again.";

function emptyHalvesOf(a: { left: PageHalfExtraction; right: PageHalfExtraction }): HalfSide[] {
  const out: HalfSide[] = [];
  if (isHalfEmpty(a.left)) out.push("left");
  if (isHalfEmpty(a.right)) out.push("right");
  return out;
}

function summarize(a: PageAttempt): AttemptSummary {
  return {
    rotationApplied: a.rotationApplied,
    spineX: a.split.spineX,
    spineConfidence: a.split.spineConfidence,
    leftItems: halfContentCount(a.left),
    rightItems: halfContentCount(a.right),
    emptyHalves: emptyHalvesOf(a),
  };
}

async function runAttempt(
  oriented: Buffer,
  rotation: Rotation,
  deps: PipelineDeps
): Promise<PageAttempt> {
  const fullPage = await rotateUpright(oriented, rotation);
  const split = await splitPageIntoHalves(Buffer.from(fullPage.base64, "base64"));
  const [left, right] = await Promise.all([
    deps.extractHalf(split.left.base64, split.left.mediaType, "left"),
    deps.extractHalf(split.right.base64, split.right.mediaType, "right"),
  ]);
  return { rotationApplied: rotation, fullPage, split, left, right };
}

// Strictly better = more non-empty halves, then more recognised items.
function isBetter(candidate: PageAttempt, current: PageAttempt): boolean {
  const cEmpty = emptyHalvesOf(candidate).length;
  const bEmpty = emptyHalvesOf(current).length;
  if (cEmpty !== bEmpty) return cEmpty < bEmpty;
  return (
    halfContentCount(candidate.left) + halfContentCount(candidate.right) >
    halfContentCount(current.left) + halfContentCount(current.right)
  );
}

export async function readPageHalves(
  // The EXIF-corrected photo (autoOrientPhoto already applied).
  oriented: Buffer,
  deps: PipelineDeps = DEFAULT_DEPS
): Promise<PageReadResult> {
  const thumb = await makeOrientationThumbnail(oriented);
  const orientation = await deps.detectOrientation(thumb.base64, thumb.mediaType);

  const notes: string[] = [];
  if (orientation.disagreementNote) notes.push(orientation.disagreementNote);

  const first = await runAttempt(oriented, orientation.rotationDegrees, deps);
  const attempts: AttemptSummary[] = [summarize(first)];
  let chosen = first;
  let retriedWith180 = false;

  const firstEmpty = emptyHalvesOf(first);
  if (firstEmpty.length > 0) {
    retriedWith180 = true;
    const flipped = ((orientation.rotationDegrees + 180) % 360) as Rotation;
    notes.push(
      `The ${firstEmpty.join(" and ")} half returned nothing recognisable at ${orientation.rotationDegrees}° — turned the photo a further 180° (now ${flipped}°) and read it once more.`
    );
    const second = await runAttempt(oriented, flipped, deps);
    attempts.push(summarize(second));
    if (isBetter(second, first)) {
      chosen = second;
      notes.push(`The ${flipped}° reading was better, so it was used.`);
    } else {
      notes.push(`The ${flipped}° reading was no better, so the original ${orientation.rotationDegrees}° reading was kept.`);
    }
  }

  const stillEmpty = emptyHalvesOf(chosen);
  const unreadable = stillEmpty.length === 2;
  if (unreadable) {
    notes.push("Both halves are still empty — the photo is unreadable and should be retaken.");
  } else if (stillEmpty.length === 1) {
    notes.push(`The ${stillEmpty[0]} half still returned no flocks, ledger or feed box.`);
  }

  return { orientation, attempts, retriedWith180, chosen, unreadable, notes };
}
