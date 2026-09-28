import { calcHd, hdWithinTolerance } from "./digitEvidence";

// Day-to-day bal-bird chain check (owner-verified, 2026-09-28: held EXACTLY
// for all 10 flocks across the Aug 2 -> Aug 3 fixtures):
//
//   bird_population[today] = bird_population[previous day] - mortality[today]
//
// This gives an independent check on every bal_bird reading — and, crucially,
// a way to fix a 3<->8-style misread WITH EVIDENCE (written HD corroborates
// one specific candidate) rather than guessing. The chain only applies when
// the previous row is for the IMMEDIATELY PRECEDING calendar day — a gap
// (e.g. a skipped upload) breaks the chain, so callers must not use this
// when the previous entry isn't exactly one day earlier.

export interface ChainCheckInput {
  eggsTotal: number | null;
  todayMortality: number | null;
  todayExtractedBalBird: number | null;
  todayWrittenHd: number | null;
  // null => no chain to check (no previous-day row, or it wasn't for the
  // immediately preceding calendar day — caller decides that, not this
  // function, since it needs a DB lookup this module deliberately has no
  // access to, staying a pure function).
  previousBalBird: number | null;
  // Only used to build the corroboration sentence in the flag_previous
  // case — not a gating condition.
  previousEggs: number | null;
  previousWrittenHd: number | null;
}

export type ChainCheckResult =
  | { kind: "no_previous" }
  | { kind: "match" }
  | { kind: "auto_correct"; correctedBalBird: number; note: string }
  | { kind: "flag_previous"; suggestedPreviousValue: number; note: string }
  | { kind: "flag_today"; note: string };

export function checkBalBirdChain(input: ChainCheckInput): ChainCheckResult {
  const {
    eggsTotal, todayMortality, todayExtractedBalBird, todayWrittenHd,
    previousBalBird, previousEggs, previousWrittenHd,
  } = input;

  if (previousBalBird === null || todayMortality === null || todayExtractedBalBird === null) {
    return { kind: "no_previous" };
  }

  const expected = previousBalBird - todayMortality;

  if (todayExtractedBalBird === expected) {
    return { kind: "match" };
  }

  // Candidate 1: the chain-expected value. If eggs/expected corroborates
  // today's written HD, the extracted figure was the misread one — safe to
  // auto-correct (the only place this pass ever auto-applies a value).
  if (eggsTotal !== null && todayWrittenHd !== null && expected > 0) {
    const candidateHd = calcHd(eggsTotal, expected);
    if (candidateHd !== null && hdWithinTolerance(candidateHd, todayWrittenHd)) {
      return {
        kind: "auto_correct",
        correctedBalBird: expected,
        note: `${todayExtractedBalBird} corrected to ${expected}: equals previous day's bal bird minus today's mortality (${previousBalBird} − ${todayMortality}) and matches written HD (${eggsTotal}/${expected} = ${candidateHd.toFixed(2)}% vs written ${todayWrittenHd}%).`,
      };
    }
  }

  // Candidate 2 (reverse): if eggs/extracted corroborates today's written
  // HD, today's own reading is probably right — the PREVIOUS day's saved
  // value is the misread one. Never rewritten automatically; flagged with
  // a suggestion for the owner to confirm.
  if (eggsTotal !== null && todayWrittenHd !== null) {
    const extractedHd = calcHd(eggsTotal, todayExtractedBalBird);
    if (extractedHd !== null && hdWithinTolerance(extractedHd, todayWrittenHd)) {
      const suggestedPrevious = todayExtractedBalBird + todayMortality;
      let note =
        `Previous day's saved bird_population (${previousBalBird}) looks misread: ` +
        `today's bird_population (${todayExtractedBalBird}) matches today's written HD ` +
        `(${eggsTotal}/${todayExtractedBalBird} = ${extractedHd.toFixed(2)}% vs written ${todayWrittenHd}%). ` +
        `Suggested value for this row: ${suggestedPrevious} (today's ${todayExtractedBalBird} + today's mortality ${todayMortality}).`;
      if (previousEggs !== null && previousWrittenHd !== null) {
        const corroborationHd = calcHd(previousEggs, suggestedPrevious);
        if (corroborationHd !== null) {
          note += ` Corroboration: ${previousEggs}/${suggestedPrevious} = ${corroborationHd.toFixed(2)}% vs this row's own written HD ${previousWrittenHd}%.`;
        }
      }
      return { kind: "flag_previous", suggestedPreviousValue: suggestedPrevious, note };
    }
  }

  // Neither candidate is corroborated — surface both numbers and whatever
  // HD evidence exists, and let a human decide. Deliberately does NOT say
  // just "increased" (the old, misleading message per the owner report) —
  // it names the previous day's value as the likely source of the
  // discrepancy, without asserting which side is actually wrong.
  const parts = [
    `bird_population may not match the previous day's chain: extracted ${todayExtractedBalBird}, ` +
      `but previous day's bal bird (${previousBalBird}) minus today's mortality (${todayMortality}) expects ${expected} — ` +
      `the previous day's entry may be the misread one.`,
  ];
  if (eggsTotal !== null) {
    const extractedHd = calcHd(eggsTotal, todayExtractedBalBird);
    const expectedHd = expected > 0 ? calcHd(eggsTotal, expected) : null;
    const hdBits: string[] = [];
    if (extractedHd !== null) hdBits.push(`extracted implies ${extractedHd.toFixed(2)}%`);
    if (expectedHd !== null) hdBits.push(`expected implies ${expectedHd.toFixed(2)}%`);
    if (todayWrittenHd !== null) hdBits.push(`written HD is ${todayWrittenHd}%`);
    if (hdBits.length > 0) parts.push(hdBits.join(", "));
  }
  return { kind: "flag_today", note: parts.join(" ") };
}
