// Permanent regression fixture (owner request, 2026-10-01 — kept
// checked in, unlike this codebase's usual scratch-and-delete
// verification scripts, specifically because this one was asked to be
// permanent). Run with `npx tsx scripts/regression-bab4-hd-digit.ts`
// from `web/`.
//
// Real production data, BAB-4, 2026-08-01, confirmed directly against
// the register by the owner: hd_percent_written was extracted as 88.10;
// the register actually reads 83.1 (an 8-for-3 digit misread). eggs_total
// (6150), bird_population (7410), mortality, and feed_bags on this row
// were all independently confirmed correct — only hd_percent_written was
// misread. No live API access here, so this exercises the pure
// digit-accuracy/pipeline functions directly against these real numbers,
// not the model's own extraction behavior.
//
// BAB-1, added 2026-10-02, same date/page, also confirmed directly
// against the register: hd_percent_written extracted as 64.7, the
// register actually reads 68.7 (a tens-digit 4-for-8 misread — the
// original list of confusion pairs didn't include 4<->8 at all, so this
// candidate could never have been generated; separately, the FIRST
// version of this check would have picked 69.7 instead — a real but less
// close candidate — since it only required uniqueness within the
// acceptance band rather than ranking by distance to the calculated
// value. Both are fixed together; this fixture exists specifically to
// catch either regressing back.

import { calcHd } from "../lib/extraction/digitEvidence";
import { checkWrittenHdDigitAccuracy } from "../lib/extraction/writtenHdCheck";
import { resolveFieldsLocally, applyChainCorrections, applyWrittenHdCheck, type RawFlockInput } from "../lib/extraction/pipeline";

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

const calculatedHd = calcHd(6150, 7410);
check("calculated hd_percent for BAB-4 is ~83.00%", calculatedHd !== null && Math.abs(calculatedHd - 83.0) < 0.01, calculatedHd);

const directResult = checkWrittenHdDigitAccuracy(88.1, calculatedHd);
check(
  "checkWrittenHdDigitAccuracy(88.10, 83.00) auto-corrects to exactly 83.1",
  directResult.kind === "auto_correct" && directResult.correctedWrittenHd === 83.1,
  directResult
);

// Full pipeline, end to end, using BAB-4's real row.
const raw: RawFlockInput = {
  displayLabelAsWritten: "BAB-4",
  section: "main",
  mortality: 3,
  feedBags: 16,
  eggsTotal: 6150,
  eggsIi: 6150,
  birdPopulation: 7410,
  birdPopulationReadings: [7410, 7410],
  hdPercentWritten: 88.1,
  confidence: {},
};
const local = resolveFieldsLocally(raw);
const { resolved } = applyChainCorrections(local, null);
const [final] = applyWrittenHdCheck([resolved]);

check("end-to-end: hd_percent_written corrected to 83.1", final.hdPercentWritten === 83.1, final);
check("end-to-end: original 88.1 preserved in hdPercentWrittenOriginal", final.hdPercentWrittenOriginal === 88.1, final);
check(
  "end-to-end: correction is an informational note, not a flag (extraFlagReasons empty)",
  final.extraFlagReasons.length === 0,
  final.extraFlagReasons
);
check(
  "end-to-end: eggs_total/mortality/feed_bags/bird_population all untouched (already correct)",
  final.eggsTotal === 6150 && final.mortality === 3 && final.feedBags === 16 && final.birdPopulation === 7410,
  final
);

// Control: a clean row with a small, ordinary written/calculated gap must
// never trigger this check at all (the existing 0.2-1.0pt quiet-note rule
// in fn_validate_daily_production stays untouched and in charge of it).
const cleanResult = checkWrittenHdDigitAccuracy(78.7, 78.65);
check("control: an ordinary small gap defers entirely (untouched by this check)", cleanResult.kind === "defer", cleanResult);

// BAB-1, 2026-08-01, real production data (current row: eggs 5910,
// bird_population 8598). Confirmed by the owner reading the register
// directly: true written HD is 68.7, not 69.7 (the wrong value the first
// version of this check would have picked).
const bab1CalculatedHd = calcHd(5910, 8598);
check("calculated hd_percent for BAB-1 is ~68.74%", bab1CalculatedHd !== null && Math.abs(bab1CalculatedHd - 68.74) < 0.01, bab1CalculatedHd);

const bab1DirectResult = checkWrittenHdDigitAccuracy(64.7, bab1CalculatedHd);
check(
  "checkWrittenHdDigitAccuracy(64.70, 68.74) auto-corrects to 68.7, NOT 69.7",
  bab1DirectResult.kind === "auto_correct" && bab1DirectResult.correctedWrittenHd === 68.7,
  bab1DirectResult
);

const bab1Raw: RawFlockInput = {
  displayLabelAsWritten: "BAB-1",
  section: "main",
  mortality: 2,
  feedBags: 14,
  eggsTotal: 5910,
  eggsIi: 5910,
  birdPopulation: 8598,
  birdPopulationReadings: [8598, 8598],
  hdPercentWritten: 64.7,
  confidence: {},
};
const bab1Local = resolveFieldsLocally(bab1Raw);
const { resolved: bab1Resolved } = applyChainCorrections(bab1Local, null);
const [bab1Final] = applyWrittenHdCheck([bab1Resolved]);

check("BAB-1 end-to-end: hd_percent_written corrected to 68.7", bab1Final.hdPercentWritten === 68.7, bab1Final);
check("BAB-1 end-to-end: original 64.7 preserved", bab1Final.hdPercentWrittenOriginal === 64.7, bab1Final);

// Near-tie control: two candidates close enough to each other must refuse
// to auto-correct rather than guess (this is what a purely
// uniqueness-in-band check, without ranking, would have gotten wrong once
// 4<->8 made near-collisions plausible).
const nearTieResult = checkWrittenHdDigitAccuracy(64.7, 69.2);
check("near-tie: two closely-spaced candidates (68.7 vs 69.7 against 69.2) refuse to auto-correct", nearTieResult.kind === "ambiguous", nearTieResult);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
