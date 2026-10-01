// The resolution pipeline (owner request, 2026-09-29: "stop finding a new
// bug every time a new photo is uploaded" — audit the whole path, not just
// today's bug, and make the ordering an explicit guarantee in the code).
//
// Every correction and every checksum in this system now runs as one of
// three strictly ordered stages, each reading ONLY the previous stage's
// output — never raw extraction data once stage 2 has run, and never a
// page checksum computed from anything but stage 3's fully-corrected
// numbers (the bug that motivated this: the page checksum used to run on
// pre-correction values, so a flock corrected earlier in the row loop
// still counted its OLD number in the section sum, producing a residual
// false mismatch equal to the correction itself).
//
//   STAGE 2 — resolveFieldsLocally: fixes that need only THIS flock's own
//     raw reading (no other row, no database). Bogus-reading collision
//     guard, eggs II-vs-Total disagreement, bal-bird two-line disagreement,
//     the standalone tray-of-30 check.
//
//   STAGE 3 — applyMortalityChecksum (owner report, 2026-10-03, added
//     between the original stages 2 and 3 without changing either of
//     them): mortality's OWN digit-accuracy check against the page's
//     written section-mortality subtotal, needing EVERY OTHER flock in
//     the section (same page-wide evidence class as stage 5's eggs
//     check) — but it must run BEFORE stage 4 (the day-to-day bal-bird
//     chain), not after, or the chain would consume an unvalidated
//     mortality value as if it were ground truth. Real case this exists
//     for: a mortality misread (8 for true 3) fed a wrong "expected"
//     bal_bird into the chain, which then "succeeded" only because
//     mortality itself was wrong, and overwrote an already-CORRECT
//     bal_bird reading with a wrong one. See mortalityChecksum.ts.
//
//   STAGE 4 — applyChainCorrections: fixes that need the PREVIOUS DAY's
//     saved row for this same flock, using whatever mortality stage 3
//     has already settled on. Mortality/feed_bags column-swap detection
//     runs FIRST — if mortality is STILL wrong at this point (stage 3
//     only catches a section-sum-traceable misread, not every possible
//     error), the bal-bird chain's own "expected = previous − mortality"
//     would itself be computed from a wrong mortality and could misfire
//     — then the bal-bird day-to-day chain runs using whatever mortality
//     is left.
//
//   STAGE 5 — applyPageChecksum: the only stage that needs EVERY OTHER
//     flock on the page — section sums can only be computed once every
//     flock's own numbers are final. Reads the full array of stage-4
//     output, never raw extraction data. May auto-correct ONE flock's
//     eggs_total when a checksum mismatch traces to a single candidate
//     that's simultaneously exact (closes the section sum precisely),
//     divisible by 30, and HD-corroborated — the only place eggs is ever
//     auto-corrected, and still never without three-way corroboration.
//     (Mortality's own section-sum finding here is unaffected — it still
//     runs, but by this point stage 3 has already fixed what it could, so
//     this mainly re-confirms a clean page or surfaces what stage 3
//     couldn't isolate to one flock.)
//
//   STAGE 6 — applyWrittenHdCheck (owner request, 2026-10-01): a
//     lighter-touch digit-accuracy pass on hd_percent_written
//     specifically, since it's reference-only (never feeds hd_percent,
//     the GENERATED column every analytics query actually reads). Reads
//     stage 5's fully-resolved eggs_total/bird_population (the ONLY point
//     the true calculated HD can be known, since eggs_total may still
//     have changed in stage 5 itself) and proposes a correction only when
//     exactly one digit-substitution/decimal-shift candidate would bring
//     a large written/calculated gap back into the SAME quiet-note band
//     fn_validate_daily_production already treats as ordinary rounding.
//
// Each stage is a pure function — no database, no network — so every one
// of them (and the pipeline as a whole) can be exercised with synthetic
// fixtures with no live dependency. See the test fixtures shipped
// alongside this increment.

import {
  isMultipleOf30,
  calcHd,
  hdWithinTolerance,
  pickBestReading,
  suggestEggsCandidate,
} from "./digitEvidence";
import { checkMortalityFeedSwap } from "./mortalityFeedSwap";
import { checkBalBirdChain } from "./balBirdChain";
import { checkWrittenHdDigitAccuracy } from "./writtenHdCheck";
import { checkMortalitySectionChecksums } from "./mortalityChecksum";
import type { RecheckableField } from "./dailyProduction";
import {
  checkPageChecksums,
  buildPageIssueText,
  type Section,
  type SectionSubtotal,
  type SectionFlock,
  type ChecksumFinding,
} from "./pageChecksum";

export interface RawFlockInput {
  displayLabelAsWritten: string;
  section: Section;
  mortality: number | null;
  feedBags: number | null;
  eggsTotal: number | null;
  eggsIi: number | null;
  birdPopulation: number | null;
  birdPopulationReadings: (number | null)[];
  hdPercentWritten: number | null;
  confidence: Record<string, number>;
}

export interface PreviousDayData {
  birdPopulation: number | null;
  eggsTotal: number | null;
  hdPercentWritten: number | null;
}

export interface PreviousDayFlag {
  displayLabelAsWritten: string;
  note: string;
}

export interface ResolvedFlock {
  displayLabelAsWritten: string;
  section: Section;
  mortality: number | null;
  mortalityOriginal: number | null;
  feedBags: number | null;
  eggsTotal: number | null;
  eggsTotalOriginal: number | null;
  birdPopulation: number | null;
  birdPopulationOriginal: number | null;
  hdPercentWritten: number | null;
  hdPercentWrittenOriginal: number | null;
  confidence: Record<string, number>;
  autoCorrectionNotes: string[];
  extraFlagReasons: string[];
  suppressBirdPopulationIncreaseFlag: boolean;
}

// ===================== STAGE 2 =====================

export interface LocallyResolvedFlock {
  displayLabelAsWritten: string;
  section: Section;
  mortality: number | null;
  feedBags: number | null;
  eggsTotal: number | null;
  birdPopulation: number | null;
  hdPercentWritten: number | null;
  confidence: Record<string, number>;
  extraFlagReasons: string[];
  // Owner report, 2026-09-30, production: a collision guard successfully
  // discarding a bad extra reading and leaving a clean, correct row behind
  // was still landing in extraFlagReasons — flagged: true for a row with
  // nothing actually wrong with it. flagged must mean "a human should
  // look", the same bar every other flag in this file is held to; a
  // successful self-correction is informational, exactly like
  // hd_percent_note or the swap/chain auto-correction notes below, which
  // is why this lives in its own array (merged into autoCorrectionNotes in
  // stage 4) instead of extraFlagReasons.
  collisionNotes: string[];
  // Set by stage 3 (applyMortalityChecksum) when it corrects mortality via
  // the section-sum checksum — carried here (not just in the eventual
  // ResolvedFlock) so stage 4's own mortality-swap check sees the ALREADY-
  // corrected value as its input, and so stage 4 preserves the TRUE
  // original (the raw extraction) rather than treating stage 3's output as
  // if it were the original.
  mortalityOriginal: number | null;
  mortalityChecksumNotes: string[];
}

export function resolveFieldsLocally(raw: RawFlockInput): LocallyResolvedFlock {
  const extraFlagReasons: string[] = [];
  const collisionNotes: string[] = [];

  // Collision guard (Part B.2 audit): a reading that coincidentally equals
  // this SAME row's own mortality/feed_bags/bird_population is much more
  // likely a copy-from-the-wrong-cell error than genuine corroborating
  // data — discard it before using it for anything. Root cause on Aug 4
  // was the eggs schema itself asking for a 3rd, nonexistent "I" column
  // reading, which the model filled with the row's own Bal Bird value on
  // 4 separate flocks — the schema no longer asks for that slot at all
  // (see dailyProduction.ts), so this is belt-and-suspenders for whatever
  // the schema fix doesn't catch, not the primary defense.
  const suspectValues = new Set(
    [raw.mortality, raw.feedBags, raw.birdPopulation].filter((n): n is number => n !== null)
  );
  let eggsIi = raw.eggsIi;
  if (eggsIi !== null && suspectValues.has(eggsIi)) {
    collisionNotes.push(
      `eggs_ii reading (${eggsIi}) equals this row's own mortality, feed_bags, or bird_population — treated as a likely copy from the wrong column and not used.`
    );
    eggsIi = null;
  }

  // Eggs II vs Total disagreement.
  if (eggsIi !== null && raw.eggsTotal !== null && eggsIi !== raw.eggsTotal) {
    const scorer = (n: number) => (isMultipleOf30(n) ? 1 : 0);
    const best = pickBestReading([eggsIi, raw.eggsTotal], scorer);
    extraFlagReasons.push(
      best && best.uniquelyBest && !best.allAgree
        ? `eggs_total readings disagree: II=${eggsIi}, Total=${raw.eggsTotal} — ${best.value} looks right (divisible by 30)`
        : `eggs_total readings disagree: II=${eggsIi}, Total=${raw.eggsTotal}`
    );
  }

  // Bal-bird two-line disagreement — same collision guard as eggs_ii above,
  // mirrored (owner report, 2026-09-30, production: BAB-8/9/10 on a fresh
  // Aug 1 upload each got a false "bird_population readings disagree"
  // flag where BOTH numbers were individually correct — they just belonged
  // to two DIFFERENT fields (eggs_total and bird_population), not two
  // readings of the same field. The eggs_ii guard above only ever
  // protected ONE direction of this exact failure mode (a value from
  // another column bleeding into a multi-reading array slot); this is the
  // mirror direction, never guarded until now. A genuine second Bal Bird
  // line never coincides with a DIFFERENT field on the same row — only
  // (legitimately) with the other Bal Bird line or the authoritative
  // bird_population value itself — so discard any reading that matches
  // mortality/feed_bags/eggs_total/eggs_ii before ever comparing readings
  // against each other.
  const balBirdSuspectValues = new Set(
    [raw.mortality, raw.feedBags, raw.eggsTotal, raw.eggsIi].filter((n): n is number => n !== null)
  );
  // Defensive, not the confirmed cause of the 2026-09-30 production crash
  // (that one traced to dedupeByNormalizedLabel on extraction.flocks,
  // upstream of this function ever running) — but raw.birdPopulationReadings
  // is the same class of unchecked model-controlled input, so a missing or
  // non-array value here must not throw either.
  const rawBirdPopulationReadings = Array.isArray(raw.birdPopulationReadings) ? raw.birdPopulationReadings : [];
  const balBirdPresent = rawBirdPopulationReadings.filter((n): n is number => {
    if (n === null) return false;
    if (n !== raw.birdPopulation && balBirdSuspectValues.has(n)) {
      collisionNotes.push(
        `bird_population_readings entry (${n}) equals this row's own mortality, feed_bags, or eggs figure — treated as a likely copy from the wrong column and not used.`
      );
      return false;
    }
    return true;
  });
  if (balBirdPresent.length >= 2 && !balBirdPresent.every((n) => n === balBirdPresent[0])) {
    const scorer = (n: number) => {
      if (raw.eggsTotal !== null && n > 0 && raw.hdPercentWritten !== null) {
        const hd = calcHd(raw.eggsTotal, n);
        if (hd !== null && hdWithinTolerance(hd, raw.hdPercentWritten)) return 1;
      }
      return 0;
    };
    const best = pickBestReading(balBirdPresent, scorer);
    extraFlagReasons.push(
      best && best.uniquelyBest && !best.allAgree
        ? `bird_population readings disagree: ${balBirdPresent.join(", ")} — ${best.value} looks right (matches written HD)`
        : `bird_population readings disagree: ${balBirdPresent.join(", ")}`
    );
  }

  // Standalone tray-of-30 check (owner-confirmed, 2026-09-28) — catches a
  // consistently-misread eggs figure that has nothing to disagree with
  // (every copy agrees on the same wrong number).
  if (raw.eggsTotal !== null && !isMultipleOf30(raw.eggsTotal)) {
    const suggestion = suggestEggsCandidate(raw.eggsTotal, raw.birdPopulation, raw.hdPercentWritten);
    extraFlagReasons.push(
      suggestion !== null
        ? `eggs_total ${raw.eggsTotal} is not a multiple of 30 (this farm counts eggs in trays of 30) — suggested: ${suggestion}`
        : `eggs_total ${raw.eggsTotal} is not a multiple of 30 (this farm counts eggs in trays of 30)`
    );
  }

  return {
    displayLabelAsWritten: raw.displayLabelAsWritten,
    section: raw.section,
    mortality: raw.mortality,
    feedBags: raw.feedBags,
    eggsTotal: raw.eggsTotal,
    birdPopulation: raw.birdPopulation,
    hdPercentWritten: raw.hdPercentWritten,
    confidence: raw.confidence,
    extraFlagReasons,
    collisionNotes,
    mortalityOriginal: null, // stage 3 (applyMortalityChecksum) may still set this
    mortalityChecksumNotes: [],
  };
}

// ===================== STAGE 3 =====================

export interface MortalityChecksumInput {
  label: string;
  section: Section;
  // Chain-implied mortality for this flock (previous day's bal bird minus
  // today's EXTRACTED bal bird) — used only to rank between multiple
  // section-sum-closing candidates (see mortalityChecksum.ts); the day-to-
  // day chain itself is validated-by, not the source of truth for, this
  // stage. Null when there's no previous-day data.
  chainImpliedMortality: number | null;
}

/**
 * Page-wide: validates mortality against the section's own written
 * subtotal BEFORE stage 4's day-to-day chain ever consumes it (see this
 * file's header comment for why the ordering matters). `chainInputByLabel`
 * carries each flock's chain-implied mortality purely as a disambiguation
 * signal when the section-sum evidence alone doesn't uniquely identify one
 * flock — never as the primary gate, since that would make this stage
 * trust the very thing it exists to validate.
 */
export function applyMortalityChecksum(
  flocks: LocallyResolvedFlock[],
  sectionSubtotals: SectionSubtotal[],
  chainInputByLabel: Map<string, MortalityChecksumInput>
): LocallyResolvedFlock[] {
  const checksumInput = flocks.map((f) => ({
    label: f.displayLabelAsWritten,
    section: f.section,
    mortality: f.mortality,
    chainImpliedMortality: chainInputByLabel.get(f.displayLabelAsWritten)?.chainImpliedMortality ?? null,
  }));
  const { corrections, flags } = checkMortalitySectionChecksums(checksumInput, sectionSubtotals);

  const correctionByLabel = new Map(corrections.map((c) => [c.label, c]));
  const flagByLabel = new Map(flags.map((f) => [f.label, f]));

  return flocks.map((f) => {
    const correction = correctionByLabel.get(f.displayLabelAsWritten);
    const flag = flagByLabel.get(f.displayLabelAsWritten);
    if (!correction && !flag) return f;
    return {
      ...f,
      mortality: correction ? correction.to : f.mortality,
      mortalityOriginal: correction ? correction.from : f.mortalityOriginal,
      mortalityChecksumNotes: correction ? [...f.mortalityChecksumNotes, correction.note] : f.mortalityChecksumNotes,
      extraFlagReasons: flag ? [...f.extraFlagReasons, flag.note] : f.extraFlagReasons,
    };
  });
}

// ===================== STAGE 4 =====================

export function applyChainCorrections(
  local: LocallyResolvedFlock,
  previousDay: PreviousDayData | null
): { resolved: ResolvedFlock; previousDayFlag: PreviousDayFlag | null } {
  // Seeded with stage 2's collision-guard notes AND stage 3's mortality-
  // checksum notes (see LocallyResolvedFlock's doc comments) — a
  // successful discard-and-keep-clean, or a section-sum-corroborated
  // mortality fix, are both informational, same bucket as the swap/chain
  // corrections pushed below, never extraFlagReasons.
  const autoCorrectionNotes: string[] = [...local.collisionNotes, ...local.mortalityChecksumNotes];
  const extraFlagReasons = [...local.extraFlagReasons];
  let mortality = local.mortality;
  // May already be set by stage 3 (applyMortalityChecksum) — preserved
  // here rather than reset to null, since mortalityOriginal must always be
  // the value the MODEL actually extracted, never an intermediate stage's
  // output.
  let mortalityOriginal: number | null = local.mortalityOriginal;
  let birdPopulation = local.birdPopulation;
  let birdPopulationOriginal: number | null = null;
  let suppressBirdPopulationIncreaseFlag = false;
  let previousDayFlag: PreviousDayFlag | null = null;

  // Mortality/feed_bags column swap — runs FIRST, since a wrong mortality
  // would otherwise feed a wrong "expected" bal_bird into the chain check
  // below.
  const swap = checkMortalityFeedSwap({
    mortality: local.mortality,
    feedBags: local.feedBags,
    birdPopulation: local.birdPopulation,
    previousBalBird: previousDay?.birdPopulation ?? null,
  });
  if (swap.kind === "auto_correct") {
    // local.mortality here may ALREADY be stage 3's corrected value (not
    // the model's raw extraction) — only capture it as the original if
    // stage 3 didn't already set one, so mortalityOriginal never ends up
    // holding an intermediate value instead of the true raw extraction.
    mortalityOriginal = mortalityOriginal ?? local.mortality;
    mortality = swap.correctedMortality;
    autoCorrectionNotes.push(swap.note);
  } else if (swap.kind === "flag") {
    extraFlagReasons.push(swap.note);
  }

  // Bal-bird day-to-day chain, using whatever mortality the swap check
  // above has already settled on.
  const chain = checkBalBirdChain({
    eggsTotal: local.eggsTotal,
    todayMortality: mortality,
    todayExtractedBalBird: local.birdPopulation,
    todayWrittenHd: local.hdPercentWritten,
    previousBalBird: previousDay?.birdPopulation ?? null,
    previousEggs: previousDay?.eggsTotal ?? null,
    previousWrittenHd: previousDay?.hdPercentWritten ?? null,
  });
  if (chain.kind === "auto_correct") {
    birdPopulationOriginal = local.birdPopulation;
    birdPopulation = chain.correctedBalBird;
    autoCorrectionNotes.push(chain.note);
  } else if (chain.kind === "flag_previous") {
    suppressBirdPopulationIncreaseFlag = true;
    previousDayFlag = { displayLabelAsWritten: local.displayLabelAsWritten, note: chain.note };
  } else if (chain.kind === "flag_today") {
    extraFlagReasons.push(chain.note);
  }

  return {
    resolved: {
      displayLabelAsWritten: local.displayLabelAsWritten,
      section: local.section,
      mortality,
      mortalityOriginal,
      feedBags: local.feedBags,
      eggsTotal: local.eggsTotal,
      eggsTotalOriginal: null, // stage 5 (applyPageChecksum) may still set this
      birdPopulation,
      birdPopulationOriginal,
      hdPercentWritten: local.hdPercentWritten,
      hdPercentWrittenOriginal: null, // stage 6 (applyWrittenHdCheck) may still set this
      confidence: local.confidence,
      autoCorrectionNotes,
      extraFlagReasons,
      suppressBirdPopulationIncreaseFlag,
    },
    previousDayFlag,
  };
}

// ===================== STAGE 5 =====================

export interface PageChecksumResult {
  resolved: ResolvedFlock[];
  pageIssueText: string | null;
}

export function applyPageChecksum(
  flocks: ResolvedFlock[],
  sectionSubtotals: SectionSubtotal[]
): PageChecksumResult {
  const sectionFlocks: SectionFlock[] = flocks.map((f) => ({
    label: f.displayLabelAsWritten,
    section: f.section,
    mortality: f.mortality,
    feed_bags: f.feedBags,
    eggs_total: f.eggsTotal,
    bird_population: f.birdPopulation,
    hd_percent_written: f.hdPercentWritten,
  }));
  const findings = checkPageChecksums(sectionFlocks, sectionSubtotals);

  // Shallow-copy each flock (and its notes array) before this stage
  // potentially mutates one — a pure function must never mutate its own
  // input, or a caller that reuses `flocks` afterward would see surprise
  // changes it never asked for.
  const byLabel = new Map(
    flocks.map((f) => [f.displayLabelAsWritten, { ...f, autoCorrectionNotes: [...f.autoCorrectionNotes] }])
  );
  const remainingFindings: ChecksumFinding[] = [];

  for (const finding of findings) {
    // traceEggsMismatch (pageChecksum.ts) already establishes all three
    // conditions before setting corroborated: true — exact fix, divisible
    // by 30, HD-corroborated, and uniquely so among every candidate that
    // would close the gap. Nothing left to re-derive here; this is the
    // only place eggs_total is ever auto-corrected.
    if (finding.field === "eggs" && finding.suspectFlock?.corroborated) {
      const suspect = finding.suspectFlock;
      const flock = byLabel.get(suspect.label);
      if (flock) {
        const hd = calcHd(suspect.to, flock.birdPopulation as number);
        flock.eggsTotalOriginal = suspect.from;
        flock.eggsTotal = suspect.to;
        flock.autoCorrectionNotes.push(
          `eggs_total ${suspect.from} corrected to ${suspect.to}: makes the ${finding.section} section's eggs sum match the page's own subtotal exactly, is divisible by 30, and eggs/bird_population (${suspect.to}/${flock.birdPopulation} = ${hd?.toFixed(2)}%) matches written HD ${flock.hdPercentWritten}%.`
        );
        continue; // resolved — doesn't go into the page banner
      }
    }
    remainingFindings.push(finding);
  }

  return { resolved: [...byLabel.values()], pageIssueText: buildPageIssueText(remainingFindings) };
}

// ===================== STAGE 6 =====================

/**
 * Runs strictly after stage 5 (never before — eggs_total may itself have
 * just been auto-corrected there, and the true calculated HD depends on
 * the FINAL eggs_total/bird_population, not an earlier stage's). Per-flock,
 * no other row's data needed. Pure and non-mutating, same discipline as
 * every other stage — shallow-copies rather than editing `flocks` in
 * place.
 */
export function applyWrittenHdCheck(flocks: ResolvedFlock[]): ResolvedFlock[] {
  return flocks.map((f) => {
    const calculatedHd = f.eggsTotal !== null && f.birdPopulation !== null ? calcHd(f.eggsTotal, f.birdPopulation) : null;
    const result = checkWrittenHdDigitAccuracy(f.hdPercentWritten, calculatedHd);
    if (result.kind !== "auto_correct") return f;
    return {
      ...f,
      hdPercentWritten: result.correctedWrittenHd,
      hdPercentWrittenOriginal: f.hdPercentWritten,
      autoCorrectionNotes: [...f.autoCorrectionNotes, result.note],
    };
  });
}

// ===================== SAFETY NET =====================

/**
 * Owner report, 2026-10-03, production: BAB-2, 2026-08-05 —
 * auto_correction_note said "15579 corrected to 15572", but the actually
 * saved bird_population was 15551, a THIRD, different number, unexplained
 * anywhere. Traced to the second-pass recheck (reextractFlaggedFlocks,
 * wired in app/upload/actions.ts): a field the chain/swap/checksum logic
 * had already corrected with real corroborating evidence could ALSO be
 * independently re-extracted by the second pass (if some OTHER reason
 * flagged the row) and silently overwritten by a fresh, uncorroborated
 * re-read — an entirely different code path than the one that wrote the
 * note, touching the same column. The real fix is in upload/actions.ts
 * (an already-auto-corrected field is excluded from what the second pass
 * is even asked to recheck) — this is the backstop: called right before a
 * flock's resolved values are persisted, it throws if any field with a
 * recorded "original" value doesn't have a matching note, so a FUTURE
 * version of this same class of bug fails loudly instead of silently
 * saving a value its own note doesn't describe.
 */
export function assertAutoCorrectionNotesConsistent(flock: ResolvedFlock): void {
  const checks: [number | null, number | null, string][] = [
    [flock.mortalityOriginal, flock.mortality, "mortality"],
    [flock.birdPopulationOriginal, flock.birdPopulation, "bird_population"],
    [flock.eggsTotalOriginal, flock.eggsTotal, "eggs_total"],
    [flock.hdPercentWrittenOriginal, flock.hdPercentWritten, "hd_percent_written"],
  ];
  for (const [original, current, fieldName] of checks) {
    if (original === null) continue;
    const marker = `${original} corrected to ${current}`;
    if (!flock.autoCorrectionNotes.some((n) => n.includes(marker))) {
      throw new Error(
        `${fieldName} on "${flock.displayLabelAsWritten}" has an original value (${original}) recorded but no note says "${marker}" — the note and the value to be saved have diverged. Refusing to save (see docs/DECISIONS.md, 2026-10-03 production incident).`
      );
    }
  }
}

/**
 * The actual fix for the same 2026-10-03 incident (see
 * assertAutoCorrectionNotesConsistent above for the backstop): a field
 * already auto-corrected with real corroborating evidence (a section
 * checksum, a day-to-day chain) must never be handed to the second-pass
 * recheck, which would re-extract it blind and, if accepted, silently
 * overwrite the corrected value via a completely different code path that
 * never touches the note describing the first correction. The field's
 * original flag reason (if any) still stands — only the RECHECK TARGET is
 * narrowed, not the flag itself, so the row can still visibly need a
 * human's attention without risking its already-corroborated field being
 * clobbered by a weaker, uncorroborated second guess.
 */
export function excludeAlreadyAutoCorrectedFields(
  fields: RecheckableField[],
  flock: ResolvedFlock
): RecheckableField[] {
  const alreadyAutoCorrected = new Set<RecheckableField>();
  if (flock.mortalityOriginal !== null) alreadyAutoCorrected.add("mortality");
  if (flock.birdPopulationOriginal !== null) alreadyAutoCorrected.add("bird_population");
  if (flock.eggsTotalOriginal !== null) alreadyAutoCorrected.add("eggs_total");
  if (flock.hdPercentWrittenOriginal !== null) alreadyAutoCorrected.add("hd_percent");
  return fields.filter((f) => !alreadyAutoCorrected.has(f));
}
