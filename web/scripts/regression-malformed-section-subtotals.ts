// Permanent regression fixture (owner report, 2026-10-12 — production
// crash: "Photo was read, but something went wrong saving the results.
// Technical detail: c.filter is not a function or its return value is not
// iterable", a fresh upload on a live deploy, NOTHING saved — not even one
// daily_production row). Run with
// `npx tsx scripts/regression-malformed-section-subtotals.ts` from `web/`.
//
// Root cause: extraction.section_subtotals (lib/extraction/dailyProduction.ts)
// comes from the same unchecked `toolUse.input as ExtractionResult` cast as
// extraction.flocks — but unlike flocks (which got an explicit
// `Array.isArray` guard after the 2026-09-30 "X is not iterable" incident,
// see extractDailyProductionSafely), section_subtotals never got the same
// guard. app/upload/actions.ts only does `extraction.section_subtotals ??
// []`, which protects against null/undefined but NOT against some OTHER
// non-array value the model's JSON response could contain (a malformed or
// partial tool-call response, same failure class as the flocks incident).
// That value was handed straight to pipeline.ts's applyMortalityChecksum
// (stage 3) and applyPageChecksum (stage 6), both of which called
// mortalityChecksum.ts/pageChecksum.ts's own `subtotals.filter(...)` with
// no defensive check — a non-array `subtotals` threw
// "subtotals.filter is not a function" (minified to "c.filter is not a
// function" on Vercel's build), INSIDE the Daily Production transaction,
// before a single row had been written — hence the full rollback and the
// "nothing was saved at all" symptom.
//
// Confirmed BEFORE the fix (this session, by temporarily reverting it):
// every one of the three malformed values below threw exactly
// "subtotals.filter is not a function" from checkMortalitySectionChecksums,
// checkPageChecksums, and the pipeline.ts wrappers that app/upload/actions.ts
// actually calls (applyMortalityChecksum / applyPageChecksum) — i.e. the
// exact call path a real upload exercises. This has nothing to do with the
// egg-ledger/feed-box step (PR #10) — that step runs in its own,
// completely separate try/catch AFTER the Daily Production transaction has
// already committed, and its own extraction (ledgerFeedExtraction.ts)
// already has an Array.isArray guard on its own two array fields (confirmed
// by reading that file; not re-exercised here since it has no live-API
// access in this sandbox).
//
// The fix (pageChecksum.ts's checkPageChecksums, mortalityChecksum.ts's
// checkMortalitySectionChecksums): guard `subtotals` with the same
// `Array.isArray(...) ? ... : []` pattern already used elsewhere in this
// codebase (e.g. pipeline.ts's resolveFieldsLocally, for
// raw.birdPopulationReadings) — a malformed section_subtotals is now
// treated exactly like the already-handled null/undefined case ("no
// subtotal evidence"), never a crash. The same defensive pattern was also
// added to applyBirdTransferDetection, dedupeNotes, and
// excludeAlreadyAutoCorrectedFields (pipeline.ts) — not the confirmed cause
// of this incident, but named in the bug report and deserving the same
// backstop against the same class of bug.

import {
  resolveFieldsLocally,
  applyMortalityChecksum,
  applyPageChecksum,
  applyBirdTransferDetection,
  dedupeNotes,
  excludeAlreadyAutoCorrectedFields,
  type RawFlockInput,
  type LocallyResolvedFlock,
  type MortalityChecksumInput,
  type ResolvedFlock,
} from "../lib/extraction/pipeline";
import { checkMortalitySectionChecksums } from "../lib/extraction/mortalityChecksum";
import { checkPageChecksums } from "../lib/extraction/pageChecksum";
import type { SectionSubtotal } from "../lib/extraction/pageChecksum";
import type { RecheckableField } from "../lib/extraction/dailyProduction";

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
function doesNotThrow(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log(`PASS (tolerated): ${name}`);
  } catch (err) {
    fail++;
    console.log(`FAIL: ${name} — threw when it should have tolerated the input`, err);
  }
}

// A realistic single-flock main-section page (same shape every real upload
// produces — see regression-bab6-mortality-chain.ts for the full 7-flock
// version; one flock is enough to exercise the crash site).
const rawFlocks: RawFlockInput[] = [
  { displayLabelAsWritten: "BAB-6", section: "main", mortality: 3, feedBags: 18, eggsTotal: 7020, eggsIi: 7020, birdPopulation: 9680, birdPopulationReadings: [9680, 9680], hdPercentWritten: 72.6, confidence: {} },
];
const locals: LocallyResolvedFlock[] = rawFlocks.map(resolveFieldsLocally);
const chainInputByLabel = new Map<string, MortalityChecksumInput>([
  ["BAB-6", { label: "BAB-6", section: "main", chainImpliedMortality: null }],
]);
const sectionFlocksForPageChecksum = locals.map((l) => ({
  label: l.displayLabelAsWritten, section: l.section, mortality: l.mortality,
  feed_bags: l.feedBags, eggs_total: l.eggsTotal, bird_population: l.birdPopulation,
  hd_percent_written: l.hdPercentWritten,
}));
const resolvedForPageChecksum: ResolvedFlock[] = locals.map((l) => ({
  displayLabelAsWritten: l.displayLabelAsWritten,
  section: l.section,
  mortality: l.mortality,
  mortalityOriginal: null,
  feedBags: l.feedBags,
  eggsTotal: l.eggsTotal,
  eggsTotalOriginal: null,
  birdPopulation: l.birdPopulation,
  birdPopulationOriginal: null,
  hdPercentWritten: l.hdPercentWritten,
  hdPercentWrittenOriginal: null,
  confidence: l.confidence,
  autoCorrectionNotes: [],
  extraFlagReasons: l.extraFlagReasons,
  suppressBirdPopulationIncreaseFlag: false,
  transferCandidateDelta: null,
}));

// Model response shapes that a malformed/partial tool-call JSON response
// could realistically produce for a field the schema declares as "array" —
// the exact same failure class the 2026-09-30 incident hit for
// extraction.flocks (see dailyProduction.ts's own Array.isArray guard on
// that field). The `as unknown as SectionSubtotal[]` casts below stand in
// for the unchecked `toolUse.input as ExtractionResult` cast in
// dailyProduction.ts: TypeScript cannot catch this at compile time, only a
// runtime check can — these fixtures simulate exactly what that runtime
// check must handle.
const malformedSectionSubtotals: { label: string; value: SectionSubtotal[] }[] = [
  { label: "an empty object (e.g. a truncated/malformed tool-call response)", value: {} as unknown as SectionSubtotal[] },
  { label: "a single subtotal object, not wrapped in an array", value: { section: "main", eggs: null, bal_bird: null, mortality: null, feed_bags: null, hd_percent: null } as unknown as SectionSubtotal[] },
  { label: "the string 'null' misparsed as text, not the JSON value", value: "null" as unknown as SectionSubtotal[] },
];

console.log("=== Every call site a real upload exercises must tolerate a malformed section_subtotals ===");
for (const { label, value } of malformedSectionSubtotals) {
  doesNotThrow(`checkMortalitySectionChecksums tolerates section_subtotals = ${label}`, () =>
    checkMortalitySectionChecksums(
      locals.map((l) => ({ label: l.displayLabelAsWritten, section: l.section, mortality: l.mortality, chainImpliedMortality: null })),
      value
    )
  );
  doesNotThrow(`checkPageChecksums tolerates section_subtotals = ${label}`, () =>
    checkPageChecksums(sectionFlocksForPageChecksum, value)
  );
  doesNotThrow(`applyMortalityChecksum (stage 3, as called from upload/actions.ts) tolerates section_subtotals = ${label}`, () =>
    applyMortalityChecksum(locals, value, chainInputByLabel)
  );
  doesNotThrow(`applyPageChecksum (stage 6, as called from upload/actions.ts) tolerates section_subtotals = ${label}`, () =>
    applyPageChecksum(resolvedForPageChecksum, value)
  );
}

// Tolerating the bad input must mean "no subtotal evidence" (same as the
// already-correct null/undefined/[] case), not some other silently-wrong
// behavior — i.e. the flock is returned completely untouched / no findings.
{
  const result = applyMortalityChecksum(locals, {} as unknown as SectionSubtotal[], chainInputByLabel);
  const bab6 = result.find((f) => f.displayLabelAsWritten === "BAB-6")!;
  check(
    "tolerated malformed section_subtotals behaves exactly like [] — mortality untouched",
    bab6.mortality === 3 && bab6.mortalityOriginal === null,
    bab6
  );
}
{
  const result = checkPageChecksums(sectionFlocksForPageChecksum, {} as unknown as SectionSubtotal[]);
  check("tolerated malformed section_subtotals behaves exactly like [] — no findings", result.length === 0, result);
}

console.log("\n=== Other PR #9/#10 paths named in the bug report: same defensive discipline ===");
// applyBirdTransferDetection and dedupeNotes are always called with a real
// array at their one call site in upload/actions.ts today — not the
// confirmed cause of the incident above — but the exact same class of bug
// (an unchecked assumption that a value is an array) should not be able to
// hide here either.
doesNotThrow("applyBirdTransferDetection tolerates a non-array input", () => applyBirdTransferDetection(null as unknown as ResolvedFlock[]));
doesNotThrow("applyBirdTransferDetection tolerates undefined", () => applyBirdTransferDetection(undefined as unknown as ResolvedFlock[]));
doesNotThrow("dedupeNotes tolerates a non-array input", () => dedupeNotes(null as unknown as string[]));
doesNotThrow("excludeAlreadyAutoCorrectedFields tolerates a non-array fields input", () =>
  excludeAlreadyAutoCorrectedFields(null as unknown as RecheckableField[], {
    mortalityOriginal: null, birdPopulationOriginal: null, eggsTotalOriginal: null, hdPercentWrittenOriginal: null,
  } as unknown as ResolvedFlock)
);

// Sanity: the realistic clean page (a real, well-formed section_subtotals)
// still works exactly as before — this fix must not change normal-input
// behavior, only tolerate bad input.
{
  const goodSubtotals = [{ section: "main" as const, eggs: 7020, bal_bird: 9680, mortality: 3, feed_bags: 18, hd_percent: 72.6 }];
  const result = applyMortalityChecksum(locals, goodSubtotals, chainInputByLabel);
  const bab6 = result.find((f) => f.displayLabelAsWritten === "BAB-6")!;
  check(
    "a well-formed section_subtotals still works normally (no regression from the fix)",
    bab6.mortality === 3 && bab6.mortalityChecksumNotes.length === 0,
    bab6
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
