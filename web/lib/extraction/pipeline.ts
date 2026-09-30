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
//   STAGE 3 — applyChainCorrections: fixes that need the PREVIOUS DAY's
//     saved row for this same flock. Mortality/feed_bags column-swap
//     detection runs FIRST — if mortality is wrong, the bal-bird chain's
//     own "expected = previous − mortality" would itself be computed
//     from a wrong mortality and could misfire — then the bal-bird
//     day-to-day chain runs using whatever mortality stage 3 has already
//     settled on.
//
//   STAGE 4 — applyPageChecksum: the only stage that needs EVERY OTHER
//     flock on the page — section sums can only be computed once every
//     flock's own numbers are final. Reads the full array of stage-3
//     output, never raw extraction data. May auto-correct ONE flock's
//     eggs_total when a checksum mismatch traces to a single candidate
//     that's simultaneously exact (closes the section sum precisely),
//     divisible by 30, and HD-corroborated — the only place eggs is ever
//     auto-corrected, and still never without three-way corroboration.
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
  confidence: Record<string, number>;
  autoCorrectionNotes: string[];
  extraFlagReasons: string[];
  suppressBirdPopulationIncreaseFlag: boolean;
}

// ===================== STAGE 2 =====================

interface LocallyResolvedFlock {
  displayLabelAsWritten: string;
  section: Section;
  mortality: number | null;
  feedBags: number | null;
  eggsTotal: number | null;
  birdPopulation: number | null;
  hdPercentWritten: number | null;
  confidence: Record<string, number>;
  extraFlagReasons: string[];
}

export function resolveFieldsLocally(raw: RawFlockInput): LocallyResolvedFlock {
  const extraFlagReasons: string[] = [];

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
    extraFlagReasons.push(
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
  const balBirdPresent = raw.birdPopulationReadings.filter((n): n is number => {
    if (n === null) return false;
    if (n !== raw.birdPopulation && balBirdSuspectValues.has(n)) {
      extraFlagReasons.push(
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
  };
}

// ===================== STAGE 3 =====================

export function applyChainCorrections(
  local: LocallyResolvedFlock,
  previousDay: PreviousDayData | null
): { resolved: ResolvedFlock; previousDayFlag: PreviousDayFlag | null } {
  const autoCorrectionNotes: string[] = [];
  const extraFlagReasons = [...local.extraFlagReasons];
  let mortality = local.mortality;
  let mortalityOriginal: number | null = null;
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
    mortalityOriginal = local.mortality;
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
      eggsTotalOriginal: null, // stage 4 may still set this
      birdPopulation,
      birdPopulationOriginal,
      hdPercentWritten: local.hdPercentWritten,
      confidence: local.confidence,
      autoCorrectionNotes,
      extraFlagReasons,
      suppressBirdPopulationIncreaseFlag,
    },
    previousDayFlag,
  };
}

// ===================== STAGE 4 =====================

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
