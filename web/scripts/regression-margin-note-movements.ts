// Permanent regression fixture (owner request, 2026-10-15 — margin notes
// next to a flock label mark a bird movement; the reader must transcribe
// the note verbatim and the app must turn it into a flock_movements
// candidate row, without ever deriving sign or meaning from the note text
// itself — see pipeline.ts's RawFlockInput doc comment and
// lib/extraction/birdTransfer.ts). Run with
// `npx tsx scripts/regression-margin-note-movements.ts` from `web/`.
//
// Covers: a paired transfer where both flocks carry a margin note (the
// SAME text can legitimately appear on both sides — real production
// example: BAB-5 -485 "Margin note 485" / BAB-6 +485 "Margin note 485"); a
// solo unexplained delta WITH a margin note; a solo unexplained delta with
// NO margin note; a clean match (no transfer candidate at all) correctly
// never gets a movementCandidate even when it happens to carry a margin
// note (a note on a flock whose own chain already holds is not this
// stage's problem — same "only ever flag/decide from real evidence" rule
// as everywhere else in this pipeline). This is pure-function coverage
// only — the actual flock_movements INSERT in app/upload/actions.ts (and
// the re-upload delete-and-replace of still-pending candidates) was
// verified directly against a real local Postgres instance running the
// real schema (db/migrations/0001-0023) in this session; not re-asserted
// here since it needs a live database.

import {
  resolveFieldsLocally,
  applyChainCorrections,
  applyBirdTransferDetection,
  type RawFlockInput,
  type ResolvedFlock,
} from "../lib/extraction/pipeline";

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

function makeRaw(label: string, marginNote: string | null): RawFlockInput {
  return {
    displayLabelAsWritten: label,
    section: "main",
    mortality: 5,
    feedBags: 20,
    eggsTotal: 6000,
    eggsIi: 6000,
    birdPopulation: 9000,
    birdPopulationReadings: [9000, 9000],
    hdPercentWritten: 70,
    confidence: {},
    marginNote,
  };
}

// --- Stage 2 + 4: a margin note survives untouched through resolveFieldsLocally
// and applyChainCorrections, regardless of whether the chain actually finds
// a transfer candidate on this row. ---
{
  const local = resolveFieldsLocally(makeRaw("BAB-9", "(-)2967"));
  check("stage 2 passes marginNote through unchanged", local.marginNote === "(-)2967", local.marginNote);

  const { resolved } = applyChainCorrections(local, null); // no previous day -> chain can't even run
  check("stage 4 passes marginNote through unchanged", resolved.marginNote === "(-)2967", resolved.marginNote);
  check("stage 4 never sets movementCandidate itself (stage 5's job)", resolved.movementCandidate === null, resolved.movementCandidate);
}

// --- Stage 5: build two flocks with opposite-signed, roughly-equal
// unexplained deltas (as stage 4's chain check would produce) and margin
// notes on both — mirrors the real BAB-5/BAB-6 production case where the
// SAME note text appeared on both sides. ---
function fakeResolved(label: string, transferCandidateDelta: number | null, marginNote: string | null): ResolvedFlock {
  return {
    displayLabelAsWritten: label,
    section: "main",
    mortality: 5,
    mortalityOriginal: null,
    feedBags: 20,
    eggsTotal: 6000,
    eggsTotalOriginal: null,
    birdPopulation: 9000,
    birdPopulationOriginal: null,
    hdPercentWritten: 70,
    hdPercentWrittenOriginal: null,
    confidence: {},
    autoCorrectionNotes: [],
    extraFlagReasons: [],
    suppressBirdPopulationIncreaseFlag: transferCandidateDelta !== null,
    transferCandidateDelta,
    marginNote,
    movementCandidate: null,
  };
}

{
  const flocks = [
    fakeResolved("BAB-5", -485, "485"),
    fakeResolved("BAB-6", 485, "485"),
  ];
  const result = applyBirdTransferDetection(flocks);
  const bab5 = result.find((f) => f.displayLabelAsWritten === "BAB-5")!;
  const bab6 = result.find((f) => f.displayLabelAsWritten === "BAB-6")!;

  check("paired transfer: BAB-5's transferCandidateDelta is cleared", bab5.transferCandidateDelta === null, bab5);
  check("paired transfer: BAB-5 gets a movementCandidate", bab5.movementCandidate !== null, bab5);
  check("paired transfer: BAB-5's movementCandidate.unexplainedDelta is -485", bab5.movementCandidate?.unexplainedDelta === -485, bab5.movementCandidate);
  check("paired transfer: BAB-5's counterpartLabel is BAB-6", bab5.movementCandidate?.counterpartLabel === "BAB-6", bab5.movementCandidate);
  check("paired transfer: BAB-5's own margin note text is preserved", bab5.movementCandidate?.marginNote === "485", bab5.movementCandidate);

  check("paired transfer: BAB-6's counterpartLabel is BAB-5 (reciprocal)", bab6.movementCandidate?.counterpartLabel === "BAB-5", bab6.movementCandidate);
  check("paired transfer: BAB-6's unexplainedDelta is +485", bab6.movementCandidate?.unexplainedDelta === 485, bab6.movementCandidate);
  check("paired transfer: BAB-6's own margin note text is ALSO '485' (same text, both sides — real production case)", bab6.movementCandidate?.marginNote === "485", bab6.movementCandidate);

  check("paired transfer: both still get the existing flag message too (no behavior removed)", bab5.extraFlagReasons.length === 1 && bab6.extraFlagReasons.length === 1, { bab5, bab6 });
}

// --- Solo unexplained delta WITH a margin note — no pairing partner on
// this page, but the note still gets carried so upload/actions.ts can
// quote it instead of saying "source not known" for no reason. ---
{
  const flocks = [fakeResolved("BAB-9", -740, "740")];
  const result = applyBirdTransferDetection(flocks);
  const bab9 = result[0];
  check("solo unexplained: movementCandidate set", bab9.movementCandidate !== null, bab9);
  check("solo unexplained: counterpartLabel is null (nothing to pair with)", bab9.movementCandidate?.counterpartLabel === null, bab9.movementCandidate);
  check("solo unexplained: margin note text carried through", bab9.movementCandidate?.marginNote === "740", bab9.movementCandidate);
}

// --- Solo unexplained delta with NO margin note at all — the real
// "genuinely no clue" case (e.g. BAB-4 +800, 2026-08-17, already in
// production before this feature existed). ---
{
  const flocks = [fakeResolved("BAB-4", 800, null)];
  const result = applyBirdTransferDetection(flocks);
  const bab4 = result[0];
  check("no-note unexplained: movementCandidate still set (chain evidence alone is enough)", bab4.movementCandidate !== null, bab4);
  check("no-note unexplained: marginNote is null, not a fabricated string", bab4.movementCandidate?.marginNote === null, bab4.movementCandidate);
}

// --- Clean match: no transferCandidateDelta at all, even if a margin note
// happens to be present (e.g. a note about something this stage doesn't
// handle) — never invent a movementCandidate from a note alone. ---
{
  const flocks = [fakeResolved("BAB-1", null, "something else entirely")];
  const result = applyBirdTransferDetection(flocks);
  const bab1 = result[0];
  check("clean match: no movementCandidate even with a margin note present", bab1.movementCandidate === null, bab1);
  check("clean match: row is otherwise untouched", bab1.extraFlagReasons.length === 0, bab1);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
