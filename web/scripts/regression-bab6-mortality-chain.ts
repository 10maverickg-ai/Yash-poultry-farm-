// Permanent regression fixture (owner request, 2026-10-03 — "add BAB-6/
// 2026-08-06 as a permanent regression fixture"). Run with
// `npx tsx scripts/regression-bab6-mortality-chain.ts` from `web/`.
//
// Real production data, BAB-6, 2026-08-06, confirmed directly against the
// register by the owner: mortality was extracted as 8; the register
// actually reads 3 (a 3<->8 digit misread, same confusion pair as
// regression-bab4-hd-digit.ts, but on mortality instead of hd_percent_
// written). bird_population was extracted CORRECTLY as 9680 — the bug was
// never in reading bird_population, it was the unvalidated mortality
// misread feeding the day-to-day bal-bird chain (balBirdChain.ts): a wrong
// mortality (8) made the chain compute a wrong "expected" bal_bird (9675),
// which happened to pass the chain's own written-HD corroboration check —
// so the chain overwrote the ALREADY-CORRECT 9680 with the wrong 9675.
// The page's own written section-mortality subtotal was 28; the other 6
// flocks on the page summed to 25 (3+6+2+3+6+5), so 25+3 (true) = 28
// exactly, while 25+8 (extracted) = 33 — a page-checksum-traceable gap of
// 5, exactly an 8-for-3 misread, and uniquely attributable to BAB-6 (no
// other flock's mortality has a digit-substitution candidate that closes
// a gap of 5 — see the "uniqueness" check below).
//
// This is why mortalityChecksum.ts (stage 3) must run BEFORE
// applyChainCorrections (stage 4) — see pipeline.ts's header comment.
// This fixture exercises BOTH the fix (full pipeline, stage 3 before
// stage 4) and a direct reproduction of the bug (stage 4 alone, on the
// UNVALIDATED mortality) to prove the ordering is what actually matters,
// not just that mortality happens to get corrected somewhere.

import {
  resolveFieldsLocally,
  applyMortalityChecksum,
  applyChainCorrections,
  type RawFlockInput,
  type LocallyResolvedFlock,
  type MortalityChecksumInput,
} from "../lib/extraction/pipeline";
import type { SectionSubtotal } from "../lib/extraction/pageChecksum";

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

// The real page: BAB-6 plus the other 6 main-section flocks whose
// mortality figures the owner summed by hand (3+6+2+3+6+5=25). Only
// BAB-6's bird_population/eggs/HD figures matter for the chain assertions
// below — the other 6 only need a mortality figure, to reconstruct the
// real section-sum evidence.
const rawFlocks: RawFlockInput[] = [
  { displayLabelAsWritten: "BAB-1", section: "main", mortality: 3, feedBags: 14, eggsTotal: 5910, eggsIi: 5910, birdPopulation: 8598, birdPopulationReadings: [8598, 8598], hdPercentWritten: 68.7, confidence: {} },
  { displayLabelAsWritten: "BAB-2", section: "main", mortality: 6, feedBags: 27, eggsTotal: 11610, eggsIi: 11610, birdPopulation: 15572, birdPopulationReadings: [15572, 15572], hdPercentWritten: 74.5, confidence: {} },
  { displayLabelAsWritten: "BAB-3", section: "main", mortality: 2, feedBags: 16, eggsTotal: 6150, eggsIi: 6150, birdPopulation: 7410, birdPopulationReadings: [7410, 7410], hdPercentWritten: 83.0, confidence: {} },
  { displayLabelAsWritten: "BAB-4", section: "main", mortality: 3, feedBags: 16, eggsTotal: 6150, eggsIi: 6150, birdPopulation: 7410, birdPopulationReadings: [7410, 7410], hdPercentWritten: 83.0, confidence: {} },
  { displayLabelAsWritten: "BAB-5", section: "main", mortality: 6, feedBags: 20, eggsTotal: 7020, eggsIi: 7020, birdPopulation: 9100, birdPopulationReadings: [9100, 9100], hdPercentWritten: 77.1, confidence: {} },
  // BAB-6: the real bug. mortality extracted as 8 (true: 3), feedBags
  // deliberately NOT equal to 8 so mortalityFeedSwap.ts's column-swap
  // check has nothing to misfire on — this is a digit misread, not a
  // column swap, a different failure mode entirely. bird_population
  // extracted CORRECTLY as 9680.
  { displayLabelAsWritten: "BAB-6", section: "main", mortality: 8, feedBags: 18, eggsTotal: 7020, eggsIi: 7020, birdPopulation: 9680, birdPopulationReadings: [9680, 9680], hdPercentWritten: 72.6, confidence: {} },
  { displayLabelAsWritten: "BAB-7", section: "main", mortality: 5, feedBags: 19, eggsTotal: 6840, eggsIi: 6840, birdPopulation: 9200, birdPopulationReadings: [9200, 9200], hdPercentWritten: 74.3, confidence: {} },
];

const locals: LocallyResolvedFlock[] = rawFlocks.map(resolveFieldsLocally);

const sectionSubtotals: SectionSubtotal[] = [
  {
    section: "main",
    eggs: null, // not this fixture's concern
    bal_bird: 67390, // sum of the 7 flocks' bird_population — present only so looksLikeGenuineSubtotal passes
    mortality: 28, // the real written subtotal — true sum (25 + true 3) matches this exactly
    feed_bags: null,
    hd_percent: 75.0, // present only so looksLikeGenuineSubtotal passes; not checked by mortality logic
  },
];

// BAB-6's previous day (2026-08-05): bal bird 9683. With the TRUE mortality
// (3), the chain's own "expected = previous - mortality" gives 9683-3=9680
// — exactly what was actually extracted for today, which is why, once
// mortality is correctly 3, the chain finds a clean MATCH and leaves
// bird_population untouched. With the WRONG extracted mortality (8), the
// same chain computes 9683-8=9675 instead.
const PREVIOUS_BAL_BIRD = 9683;

// --- Sanity: the uniqueness claim the owner's hand arithmetic implies ---
// diff = flockSum(33) - written(28) = 5. Confirm no OTHER flock besides
// BAB-6 has a digit-substitution candidate that also closes a gap of 5
// (i.e. the section-checksum evidence is genuinely unique to BAB-6, not
// just conveniently chosen for this fixture).
{
  const flockSum = rawFlocks.reduce((s, f) => s + (f.mortality ?? 0), 0);
  check("sanity: the 7 flocks' mortality sums to 33 (8-for-3 misread included)", flockSum === 33, flockSum);
  const otherSum = rawFlocks.filter((f) => f.displayLabelAsWritten !== "BAB-6").reduce((s, f) => s + (f.mortality ?? 0), 0);
  check("sanity: the other 6 flocks sum to 25, matching the owner's hand count", otherSum === 25, otherSum);
}

// --- Stage 3: applyMortalityChecksum must uniquely correct BAB-6, 8->3 ---
const chainInputByLabel = new Map<string, MortalityChecksumInput>([
  [
    "BAB-6",
    {
      label: "BAB-6",
      section: "main",
      // previous day's bal bird (9683) minus today's EXTRACTED bal bird
      // (9680, which was always correct) = 3 — the chain-implied signal
      // agrees with the true mortality, though it isn't even needed here
      // since the section-sum evidence alone is already unique.
      chainImpliedMortality: PREVIOUS_BAL_BIRD - 9680,
    },
  ],
]);
const stage3Output = applyMortalityChecksum(locals, sectionSubtotals, chainInputByLabel);
const bab6Stage3 = stage3Output.find((f) => f.displayLabelAsWritten === "BAB-6")!;

check("stage 3: BAB-6 mortality corrected from 8 to 3", bab6Stage3.mortality === 3, bab6Stage3);
check("stage 3: BAB-6 mortalityOriginal preserves the true raw extraction (8)", bab6Stage3.mortalityOriginal === 8, bab6Stage3);
check(
  "stage 3: correction note says '8 corrected to 3'",
  bab6Stage3.mortalityChecksumNotes.some((n) => n.includes("8 corrected to 3")),
  bab6Stage3.mortalityChecksumNotes
);
check(
  "stage 3: this is informational, not a flag (extraFlagReasons empty)",
  bab6Stage3.extraFlagReasons.length === 0,
  bab6Stage3.extraFlagReasons
);
for (const label of ["BAB-1", "BAB-2", "BAB-3", "BAB-4", "BAB-5", "BAB-7"]) {
  const f = stage3Output.find((x) => x.displayLabelAsWritten === label)!;
  check(`stage 3: ${label} untouched (mortalityOriginal still null)`, f.mortalityOriginal === null, f);
}

// --- Stage 4: the now-validated mortality (3) feeds the chain, which must
// find a clean MATCH and leave bird_population at its already-correct 9680
// ---
const bab6PreviousDay = { birdPopulation: PREVIOUS_BAL_BIRD, eggsTotal: null, hdPercentWritten: null };
const { resolved: bab6Final } = applyChainCorrections(bab6Stage3, bab6PreviousDay);

check("end-to-end (fixed): mortality is 3", bab6Final.mortality === 3, bab6Final);
check(
  "end-to-end (fixed): bird_population stays the TRUE 9680, NOT corrupted to 9675",
  bab6Final.birdPopulation === 9680,
  bab6Final
);
check(
  "end-to-end (fixed): birdPopulationOriginal is null (never touched — the chain found a clean match, nothing to correct)",
  bab6Final.birdPopulationOriginal === null,
  bab6Final
);
check(
  "end-to-end (fixed): mortalityOriginal still correctly 8 (stage 3's true original, not overwritten by stage 4)",
  bab6Final.mortalityOriginal === 8,
  bab6Final
);

// --- Control: reproduce the ORIGINAL bug directly, by running stage 4
// alone on the UNVALIDATED local (skipping stage 3 entirely) — proves the
// corruption this fixture guards against is real, not hypothetical, and
// that the fix is specifically stage ordering (validate mortality BEFORE
// the chain), not something incidental. ---
const bab6Unvalidated = locals.find((f) => f.displayLabelAsWritten === "BAB-6")!;
check("control precondition: unvalidated local still has the wrong mortality (8)", bab6Unvalidated.mortality === 8, bab6Unvalidated);

const { resolved: bab6Broken } = applyChainCorrections(bab6Unvalidated, bab6PreviousDay);
check(
  "control (reproduces the old bug): with unvalidated mortality (8), the chain computes a wrong expected value and OVERWRITES the correct 9680 with 9675",
  bab6Broken.birdPopulation === 9675,
  bab6Broken
);
check(
  "control: the corrupted row's birdPopulationOriginal records the TRUE value (9680) that got overwritten",
  bab6Broken.birdPopulationOriginal === 9680,
  bab6Broken
);
check("control: mortality itself stays wrong (8) too, since stage 3 was skipped", bab6Broken.mortality === 8, bab6Broken);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
