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
//
// Owner report, 2026-10-12, production: BAB-2, 2026-08-05 was wrong in the
// database (15551) when Aug 6 was uploaded. The chain computed Aug 6 as
// 15551 − 6 = 15545 and OVERWROTE the correctly-extracted 15566 with it,
// because 15545 happened to land within tolerance of written HD (73.72%
// vs written 73.6%) — even though the actually-extracted 15566 matched
// written HD far better (73.62% vs written 73.6%). The old rule only ever
// asked "does the chain's candidate corroborate written HD at all?", never
// "does it corroborate BETTER than the value already extracted?" — so a
// stale previous-day value could cascade forward and clobber a genuinely
// correct reading. Candidate 1 (below) now requires the chain's candidate
// to match written HD at least as well as today's own extracted reading
// before it's allowed to overwrite anything.

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
}

export type ChainCheckResult =
  | { kind: "no_previous" }
  | { kind: "match" }
  | { kind: "auto_correct"; correctedBalBird: number; note: string }
  // Owner report, 2026-10-12: a day-to-day change mortality alone can't
  // explain, where today's OWN reading still corroborates today's OWN
  // written HD, is no longer treated as "the previous day was probably
  // misread" — that framing was flatly wrong whenever the real cause was a
  // genuine bird transfer between flocks (see birdTransfer.ts). Previous
  // day's row is never touched or suggested-at from here any more;
  // `unexplainedDelta` carries the un-mortality-explained change for
  // pipeline.ts's page-wide applyBirdTransferDetection stage to interpret
  // (paired into a transfer, or flagged solo), always on TODAY's row only.
  | { kind: "flag_previous"; unexplainedDelta: number }
  | { kind: "flag_today"; note: string };

export function checkBalBirdChain(input: ChainCheckInput): ChainCheckResult {
  const { eggsTotal, todayMortality, todayExtractedBalBird, todayWrittenHd, previousBalBird } = input;

  if (previousBalBird === null || todayMortality === null || todayExtractedBalBird === null) {
    return { kind: "no_previous" };
  }

  const expected = previousBalBird - todayMortality;

  if (todayExtractedBalBird === expected) {
    return { kind: "match" };
  }

  const candidateHd = eggsTotal !== null && expected > 0 ? calcHd(eggsTotal, expected) : null;
  const extractedHd = eggsTotal !== null ? calcHd(eggsTotal, todayExtractedBalBird) : null;
  const candidateGap = candidateHd !== null && todayWrittenHd !== null ? Math.abs(candidateHd - todayWrittenHd) : null;
  const extractedGap = extractedHd !== null && todayWrittenHd !== null ? Math.abs(extractedHd - todayWrittenHd) : null;
  const candidateCorroborated =
    candidateHd !== null && todayWrittenHd !== null && hdWithinTolerance(candidateHd, todayWrittenHd);
  const extractedCorroborated =
    extractedHd !== null && todayWrittenHd !== null && hdWithinTolerance(extractedHd, todayWrittenHd);

  // Candidate 1: the chain-expected value. Only auto-corrected when it's
  // corroborated by written HD AND it explains written HD at least as well
  // as the value actually extracted today — never overwrite a reading that
  // already matches written HD better than the "fix" would (the 2026-10-12
  // incident above).
  if (candidateCorroborated && (extractedGap === null || (candidateGap as number) <= extractedGap)) {
    return {
      kind: "auto_correct",
      correctedBalBird: expected,
      note: `${todayExtractedBalBird} corrected to ${expected}: equals previous day's bal bird minus today's mortality (${previousBalBird} − ${todayMortality}) and matches written HD (${eggsTotal}/${expected} = ${(candidateHd as number).toFixed(2)}% vs written ${todayWrittenHd}%).`,
    };
  }

  // Candidate 2: today's OWN reading corroborates today's OWN written HD,
  // even though the chain doesn't hold — today's figure looks right on its
  // own evidence, so the discrepancy is a genuine day-to-day CHANGE (a
  // transfer, or something else), never a reason to doubt or rewrite
  // either row from here.
  if (extractedCorroborated) {
    return { kind: "flag_previous", unexplainedDelta: todayExtractedBalBird - expected };
  }

  // Neither candidate corroborates written HD — genuinely ambiguous,
  // surface both numbers and whatever HD evidence exists, and let a human
  // decide. Deliberately does NOT say just "increased" (the old, misleading
  // message per the owner report) — it names the previous day's value as
  // the likely source of the discrepancy, without asserting which side is
  // actually wrong.
  const parts = [
    `bird_population may not match the previous day's chain: extracted ${todayExtractedBalBird}, ` +
      `but previous day's bal bird (${previousBalBird}) minus today's mortality (${todayMortality}) expects ${expected} — ` +
      `the previous day's entry may be the misread one.`,
  ];
  const hdBits: string[] = [];
  if (extractedHd !== null) hdBits.push(`extracted implies ${extractedHd.toFixed(2)}%`);
  if (candidateHd !== null) hdBits.push(`expected implies ${candidateHd.toFixed(2)}%`);
  if (todayWrittenHd !== null) hdBits.push(`written HD is ${todayWrittenHd}%`);
  if (hdBits.length > 0) parts.push(hdBits.join(", "));
  return { kind: "flag_today", note: parts.join(" ") };
}
