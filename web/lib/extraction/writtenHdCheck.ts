import { decimalDigitSubstitutionCandidates } from "./digitEvidence";

// Written-HD% digit-accuracy check (owner report, 2026-10-01, confirmed
// against the register directly: BAB-4, 2026-08-01 — hd_percent_written
// extracted as 88.10, the register actually reads 83.1; eggs_total
// (6150), bird_population (7410), mortality, and feed were all
// independently confirmed correct — only this one field was misread).
//
// hd_percent_written is reference-only: the GENERATED hd_percent column
// (eggs_total / bird_population * 100) is what every analytics query
// actually reads, so a lighter touch than the bal-bird/mortality/eggs
// auto-corrections is appropriate here, per the owner's own instruction —
// this still only ever proposes a correction when exactly one digit-
// substitution or decimal-shift candidate would bring the written/
// calculated gap back to within WRITTEN_HD_AUTO_CORRECT_MAX_GAP of the
// calculated figure.
//
// Owner report, 2026-10-12, production: three real rows (BAB-10 2026-08-07,
// BAB-1 2026-08-06, BAB-8 2026-08-05) saved as fully clean with a written/
// calculated gap of 0.44-0.49 points, while every other row on this farm's
// register sits within about 0.1 — the old 1.0pt "clean" ceiling (split
// across this file's 3.0pt engagement threshold and the SQL-side
// fn_validate_daily_production's own 0.2/1.0 bands) was simply too loose.
// This is now ONE named constant, WRITTEN_HD_CLEAN_TOLERANCE, used as the
// single boundary between "ordinary rounding, nothing to do" and "worth
// running the digit-evidence search" — see migration 0019 for the matching
// change on the SQL side, which now defers to this check entirely above
// that boundary instead of applying its own, looser thresholds.

// The single clean-tolerance boundary (owner request, 2026-10-12): a
// written/calculated gap at or below this is ordinary rounding on a
// hand-filled register, not worth a note or a flag. Anything above it is
// handed to the digit-evidence search below.
export const WRITTEN_HD_CLEAN_TOLERANCE = 0.3;

// A digit-substitution/decimal-shift candidate only counts as "found the
// true written figure" if it brings the gap to the calculated HD down to
// within this many points — tightened from the old 1.0pt band (owner
// report, 2026-10-12: "if one candidate fix matches within 0.1,
// auto-correct") specifically so this check never settles for a candidate
// that's merely "closer", only one that's actually convincing.
export const WRITTEN_HD_AUTO_CORRECT_MAX_GAP = 0.1;

// Owner report, 2026-10-02: with 4<->8 added to the shared confusion-pair
// list, a written value can plausibly have MORE THAN ONE candidate land
// close to the calculated figure at once. When more than one candidate
// qualifies (see WRITTEN_HD_AUTO_CORRECT_MAX_GAP), the closest one is
// preferred, but only when it clearly beats the second-closest by this
// margin — a near-tie still refuses to guess.
export const WRITTEN_HD_MIN_MARGIN = 0.3;

export type WrittenHdCheckResult =
  | { kind: "no_check" } // missing data to check against
  | { kind: "defer" } // gap is within WRITTEN_HD_CLEAN_TOLERANCE — nothing for this check to add
  | { kind: "auto_correct"; correctedWrittenHd: number; note: string }
  // Gap exceeds the clean tolerance but no candidate resolves it
  // convincingly — a real flag (owner request, 2026-10-12), not silence:
  // `note` is the exact message to surface, naming the written, calculated,
  // and gap figures so the owner knows what to go check.
  | { kind: "ambiguous"; note: string };

export function checkWrittenHdDigitAccuracy(
  writtenHd: number | null,
  calculatedHd: number | null
): WrittenHdCheckResult {
  if (writtenHd === null || calculatedHd === null) return { kind: "no_check" };

  const gap = Math.abs(writtenHd - calculatedHd);
  if (gap <= WRITTEN_HD_CLEAN_TOLERANCE) return { kind: "defer" };

  const ambiguousNote = `Written HD ${writtenHd.toFixed(2)} differs from calculated ${calculatedHd.toFixed(2)} by ${gap.toFixed(2)}. Check eggs, bird count and written HD.`;

  const inBand = decimalDigitSubstitutionCandidates(writtenHd)
    .map((value) => ({ value, gap: Math.abs(value - calculatedHd) }))
    .filter((c) => c.gap <= WRITTEN_HD_AUTO_CORRECT_MAX_GAP)
    .sort((a, b) => a.gap - b.gap);

  if (inBand.length === 0) return { kind: "ambiguous", note: ambiguousNote };

  const [best, secondBest] = inBand;
  // A second candidate close enough to the best one's own gap means the
  // evidence doesn't clearly favor either — refuse to guess, same as
  // every other correction in this codebase requiring real corroboration
  // before applying anything.
  if (secondBest && secondBest.gap - best.gap < WRITTEN_HD_MIN_MARGIN) {
    return { kind: "ambiguous", note: ambiguousNote };
  }

  return {
    kind: "auto_correct",
    correctedWrittenHd: best.value,
    note: `hd_percent_written ${writtenHd} corrected to ${best.value}: a single-digit misread or decimal-shift of the written figure, and ${best.value} is the closest candidate to the calculated HD (${calculatedHd.toFixed(2)}%), within ${WRITTEN_HD_AUTO_CORRECT_MAX_GAP} points — the original extracted figure is preserved.`,
  };
}
