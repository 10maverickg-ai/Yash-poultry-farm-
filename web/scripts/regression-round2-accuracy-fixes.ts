// Permanent regression fixture (owner request, 2026-10-12 — "Add
// regression fixtures with the real numbers above ... and show them
// passing"). Run with
// `npx tsx scripts/regression-round2-accuracy-fixes.ts` from `web/`.
//
// Covers all five items from the owner's "Round 2 accuracy fixes" report,
// each verified against real production numbers (queried directly from
// Supabase, 2026-10-12) rather than invented ones.

import {
  resolveFieldsLocally,
  applyChainCorrections,
  applyBirdTransferDetection,
  reconcileManualEdit,
  assertAutoCorrectionNotesConsistent,
  dedupeNotes,
  type RawFlockInput,
} from "../lib/extraction/pipeline";
import { checkBalBirdChain } from "../lib/extraction/balBirdChain";
import { checkWrittenHdDigitAccuracy } from "../lib/extraction/writtenHdCheck";
import { calcHd } from "../lib/extraction/digitEvidence";

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

// =============================================================================
// Item 1 — bird transfers must not be flagged as "previous day misread"
//
// Real production data (ids 236, 246, 237, 247): BAB-5 dropped from 10908
// (2026-08-06) to 10419 (2026-08-07, mortality 4, eggs 8370, written HD
// 80.30); BAB-6 rose from 9680 (2026-08-06) to 10160 (2026-08-07, mortality
// 5, eggs 7500, written HD 73.80). Both are a real ~485-bird transfer.
// =============================================================================
{
  const bab5Chain = checkBalBirdChain({
    eggsTotal: 8370,
    todayMortality: 4,
    todayExtractedBalBird: 10419,
    todayWrittenHd: 80.3,
    previousBalBird: 10908,
  });
  check(
    "item1: BAB-5 Aug7 — chain breaks but today's own reading corroborates written HD (flag_previous, not auto_correct)",
    bab5Chain.kind === "flag_previous",
    bab5Chain
  );
  const bab5Delta = bab5Chain.kind === "flag_previous" ? bab5Chain.unexplainedDelta : NaN;
  check("item1: BAB-5's unexplained delta is -485 (10419 - (10908 - 4))", bab5Delta === -485, bab5Delta);

  const bab6Chain = checkBalBirdChain({
    eggsTotal: 7500,
    todayMortality: 5,
    todayExtractedBalBird: 10160,
    todayWrittenHd: 73.8,
    previousBalBird: 9680,
  });
  check("item1: BAB-6 Aug7 — also flag_previous, not auto_correct", bab6Chain.kind === "flag_previous", bab6Chain);
  const bab6Delta = bab6Chain.kind === "flag_previous" ? bab6Chain.unexplainedDelta : NaN;
  check("item1: BAB-6's unexplained delta is +485 (10160 - (9680 - 5))", bab6Delta === 485, bab6Delta);

  // Full stage 4 -> stage 5 wiring, both flocks on the same page.
  const bab5Raw: RawFlockInput = {
    displayLabelAsWritten: "BAB-5", section: "main", mortality: 4, feedBags: 22,
    eggsTotal: 8370, eggsIi: 8370, birdPopulation: 10419, birdPopulationReadings: [10419, 10419],
    hdPercentWritten: 80.3, confidence: {},
  };
  const bab6Raw: RawFlockInput = {
    displayLabelAsWritten: "BAB-6", section: "main", mortality: 5, feedBags: 20,
    eggsTotal: 7500, eggsIi: 7500, birdPopulation: 10160, birdPopulationReadings: [10160, 10160],
    hdPercentWritten: 73.8, confidence: {},
  };
  const { resolved: bab5Resolved } = applyChainCorrections(resolveFieldsLocally(bab5Raw), { birdPopulation: 10908 });
  const { resolved: bab6Resolved } = applyChainCorrections(resolveFieldsLocally(bab6Raw), { birdPopulation: 9680 });
  const [bab5Final, bab6Final] = applyBirdTransferDetection([bab5Resolved, bab6Resolved]);

  check("item1: BAB-5 bird_population is NEVER changed (stays 10419)", bab5Final.birdPopulation === 10419, bab5Final);
  check("item1: BAB-6 bird_population is NEVER changed (stays 10160)", bab6Final.birdPopulation === 10160, bab6Final);
  check(
    "item1: BAB-5 gets ONE clear paired-transfer flag, not 'previous day misread'",
    bab5Final.extraFlagReasons.length === 1 &&
      bab5Final.extraFlagReasons[0].startsWith("Likely bird transfer") &&
      !bab5Final.extraFlagReasons[0].includes("misread"),
    bab5Final.extraFlagReasons
  );
  check(
    "item1: BAB-6 gets the SAME transfer message as BAB-5 (one shared pair)",
    bab6Final.extraFlagReasons[0] === bab5Final.extraFlagReasons[0],
    [bab5Final.extraFlagReasons, bab6Final.extraFlagReasons]
  );
  check("item1: message names both flocks and ~485 birds", /BAB-5.*BAB-6.*~485 birds/.test(bab5Final.extraFlagReasons[0]), bab5Final.extraFlagReasons[0]);
  check(
    "item1: message says to confirm, not that anything needs fixing",
    bab5Final.extraFlagReasons[0].includes("Confirm and no correction needed"),
    bab5Final.extraFlagReasons[0]
  );

  // Solo case — no matching partner on the page.
  const [soloFinal] = applyBirdTransferDetection([bab5Resolved]);
  check(
    "item1 solo: with no partner, BAB-5 gets the generic 'no matching transfer' flag instead",
    soloFinal.extraFlagReasons[0] === "bird count changed by -485, no matching transfer found, please check",
    soloFinal.extraFlagReasons
  );
}

// =============================================================================
// Item 2 — a stale previous-day value must not cascade over a better-
// matching extracted reading.
//
// Real production incident: BAB-2, 2026-08-05 was wrong in the database
// (15551) when 2026-08-06 was uploaded. The chain computed 15551 - 6 =
// 15545 and overwrote the correctly-extracted 15566 with it, because
// 15545 (73.72%) happened to pass the OLD rule's "within tolerance of
// written HD (73.6%)" bar — even though the actually-extracted 15566
// (73.62%) matched written HD far better.
// =============================================================================
{
  const result = checkBalBirdChain({
    eggsTotal: 11460,
    todayMortality: 6,
    todayExtractedBalBird: 15566, // the TRUE extracted figure
    todayWrittenHd: 73.6,
    previousBalBird: 15551, // the STALE, wrong previous-day value
  });
  check(
    "item2: chain no longer auto-corrects 15566 -> 15545 (extracted matches written HD better)",
    result.kind !== "auto_correct",
    result
  );
  check("item2: instead flags as a transfer-candidate, never silently rewritten", result.kind === "flag_previous", result);

  // Control: reproduces the OLD rule (corroborated-at-all, no comparison
  // against the extracted reading) directly, to prove this exact
  // production case really did satisfy it — i.e. the bug was real, not
  // hypothetical.
  const oldRuleExpected = 15551 - 6; // 15545
  const oldRuleCandidateHd = calcHd(11460, oldRuleExpected) as number;
  check(
    "item2 control: the OLD rule's bar (candidate corroborates written HD at all) really was satisfied",
    Math.abs(oldRuleCandidateHd - 73.6) <= 0.15,
    oldRuleCandidateHd
  );
  const extractedHd = calcHd(11460, 15566) as number;
  check(
    "item2 control: but the extracted figure matched written HD MUCH better than the chain's candidate",
    Math.abs(extractedHd - 73.6) < Math.abs(oldRuleCandidateHd - 73.6),
    { extractedGap: Math.abs(extractedHd - 73.6), candidateGap: Math.abs(oldRuleCandidateHd - 73.6) }
  );
}

// =============================================================================
// Item 3 — written-HD clean tolerance tightened to 0.3; three real rows
// that used to save as fully clean must now be flagged, not auto-corrected.
// =============================================================================
{
  const rows: { label: string; written: number; eggs: number; birds: number }[] = [
    { label: "BAB-10 2026-08-07", written: 65.1, eggs: 4140, birds: 6317 },
    { label: "BAB-1 2026-08-06", written: 69.4, eggs: 5910, birds: 8570 },
    { label: "BAB-8 2026-08-05", written: 70.5, eggs: 6840, birds: 9770 },
  ];
  for (const row of rows) {
    const calculated = calcHd(row.eggs, row.birds) as number;
    const result = checkWrittenHdDigitAccuracy(row.written, calculated);
    check(`item3: ${row.label} is no longer silently clean (ambiguous, not defer)`, result.kind === "ambiguous", result);
    if (result.kind === "ambiguous") {
      const expectedNote = `Written HD ${row.written.toFixed(2)} differs from calculated ${calculated.toFixed(2)} by ${Math.abs(row.written - calculated).toFixed(2)}. Check eggs, bird count and written HD.`;
      check(`item3: ${row.label} flag message is exactly the required wording`, result.note === expectedNote, result.note);
    }
  }

  // Control: a genuinely tiny, ordinary-rounding gap still defers entirely.
  const clean = checkWrittenHdDigitAccuracy(78.7, 78.65);
  check("item3 control: a 0.05pt gap still fully defers (clean tolerance unaffected)", clean.kind === "defer", clean);

  // Control: BAB-4's real digit-misread (88.1 vs calculated 83.0) must
  // still auto-correct under the tightened 0.1 acceptance band.
  const bab4 = checkWrittenHdDigitAccuracy(88.1, 83.0);
  check(
    "item3 control: BAB-4's real misread (88.1 -> 83.1) still auto-corrects under the tighter 0.1 band",
    bab4.kind === "auto_correct" && bab4.correctedWrittenHd === 83.1,
    bab4
  );
}

// =============================================================================
// Item 4 — a manual save on the entry screen must never leave
// auto_correction_note contradicting the saved value.
//
// Real incident: BAB-2, 2026-08-07 (id 243) — auto_correction_note said
// "15557 corrected to 15536", but bird_population AND
// bird_population_original were both saved as 15557 (the owner restored
// the original value; the save path never cleared the stale provenance).
// =============================================================================
{
  const originalNote = "bird_population_readings entry (11640) equals this row's own mortality, feed_bags, or eggs figure — treated as a likely copy from the wrong column and not used. 15557 corrected to 15536: equals previous day's bal bird minus today's mortality (15545 − 9) and matches written HD (11640/15536 = 74.92% vs written 74.8%).";

  // Reproduces the OLD bug directly: no reconciliation at all, saved value
  // restored to 15557 but *_original/note left exactly as they were.
  const buggyFlock = {
    displayLabelAsWritten: "BAB-2",
    mortality: 9, mortalityOriginal: null,
    birdPopulation: 15557, birdPopulationOriginal: 15557,
    eggsTotal: 11640, eggsTotalOriginal: null,
    hdPercentWritten: 74.8, hdPercentWrittenOriginal: null,
    autoCorrectionNotes: [originalNote],
  };
  let threw = false;
  try {
    assertAutoCorrectionNotesConsistent(buggyFlock);
  } catch {
    threw = true;
  }
  check("item4 control: the backstop WOULD have caught this exact divergence if it had been wired in", threw);

  // The actual fix: reconcileManualEdit, called with what was actually
  // saved before (15536, the auto-corrected value) vs. the owner's new
  // entry (15557, restoring the original).
  const { original: fixedOriginal, note: fixedNote } = reconcileManualEdit(15557, 15536, 15557, originalNote);
  check("item4: bird_population_original is cleared to null", fixedOriginal === null, fixedOriginal);
  check(
    "item4: the stale 'corrected to 15536' sentence is stripped from the note",
    fixedNote === null || !fixedNote.includes("15557 corrected to 15536"),
    fixedNote
  );
  check(
    "item4: the unrelated collision-guard sentence survives the strip",
    fixedNote !== null && fixedNote.includes("bird_population_readings entry (11640)"),
    fixedNote
  );

  const reconciledFlock = {
    ...buggyFlock,
    birdPopulationOriginal: fixedOriginal,
    autoCorrectionNotes: fixedNote ? [fixedNote] : [],
  };
  let reconciledThrew = false;
  try {
    assertAutoCorrectionNotesConsistent(reconciledFlock);
  } catch (err) {
    reconciledThrew = true;
    console.log("  unexpected throw:", err);
  }
  check("item4: after reconciliation, the backstop is satisfied (no throw)", !reconciledThrew);

  // A third-value case: the owner types something that's neither the
  // original extraction NOR the auto-corrected value — must still clear,
  // never leave the stale pairing behind just because it's not a simple
  // revert.
  const thirdValue = reconcileManualEdit(15557, 15536, 15590, originalNote);
  check("item4: an unrelated third value also clears the stale original", thirdValue.original === null, thirdValue);

  // No-op case: the owner saves without touching this field at all.
  const untouched = reconcileManualEdit(15557, 15536, 15536, originalNote);
  check("item4: saving the SAME value leaves original/note untouched (no information lost)", untouched.original === 15557 && untouched.note === originalNote, untouched);
}

// =============================================================================
// Item 5 — dedupe repeated notes; never count a guard-only rescue as an
// auto-corrected row.
//
// Real incident: BAB-10, 2026-08-06 (id 241) — a two-line Bal Bird block
// BOTH misread as the eggs figure (4200) produced the exact same
// collision-guard sentence twice in one row's auto_correction_note.
// =============================================================================
{
  const raw: RawFlockInput = {
    displayLabelAsWritten: "BAB-10", section: "main", mortality: 2, feedBags: 15,
    eggsTotal: 4200, eggsIi: 4200,
    birdPopulation: 6318, birdPopulationReadings: [4200, 4200],
    hdPercentWritten: 66.4, confidence: {},
  };
  const local = resolveFieldsLocally(raw);
  check(
    "item5a: both discarded Bal Bird readings produce the collision note (reproduces the real duplicate)",
    local.collisionNotes.filter((n) => n.includes("bird_population_readings entry (4200)")).length === 1,
    local.collisionNotes
  );
  check("item5a: resolveFieldsLocally itself already dedupes (exactly one note, not two)", local.collisionNotes.length === 1, local.collisionNotes);
  check("item5a: bird_population is untouched by the guard (stays the real 6318)", local.birdPopulation === 6318, local.birdPopulation);

  // Defensive dedupe at the final join point too (belt-and-suspenders —
  // proves dedupeNotes collapses an exact duplicate regardless of source).
  check(
    "item5a: dedupeNotes collapses an exact duplicate pair",
    dedupeNotes(["same note", "same note", "different note"]).length === 2,
    dedupeNotes(["same note", "same note", "different note"])
  );

  // Item 5b: a guard-only rescue (nothing actually changed) must never
  // populate any *_original field — which is exactly what upload/
  // actions.ts's autoCorrections array gates on. Verified here by running
  // the SAME gating condition it uses against this guard-only flock.
  const { resolved } = applyChainCorrections(local, null);
  const wouldCountAsAutoCorrected =
    resolved.mortalityOriginal !== null ||
    resolved.birdPopulationOriginal !== null ||
    resolved.eggsTotalOriginal !== null ||
    resolved.hdPercentWrittenOriginal !== null;
  check(
    "item5b: a guard-only rescue never counts as an 'auto-corrected' row (every *Original stays null)",
    !wouldCountAsAutoCorrected,
    resolved
  );
  check(
    "item5b: the row is NOT flagged either (collision notes are informational, not a flag reason)",
    resolved.extraFlagReasons.length === 0,
    resolved.extraFlagReasons
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
