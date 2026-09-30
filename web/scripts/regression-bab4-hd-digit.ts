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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
