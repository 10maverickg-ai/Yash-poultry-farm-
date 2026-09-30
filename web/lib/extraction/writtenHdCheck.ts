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
// calculated gap back into the SAME 0.2-1.0pt quiet-note band
// fn_validate_daily_production already treats as ordinary rounding.
// Never touches anything below the existing large-gap flag threshold
// (gaps under WRITTEN_HD_LARGE_GAP_THRESHOLD are left entirely to that
// existing rule, unchanged).

// "Large" gap worth investigating a digit misread for at all — deliberately
// well above the existing 1.0pt flag threshold, so this never second-
// guesses a real, moderate written/calculated mismatch (that's still a
// genuine flag, unchanged) and only engages for a gap big enough that a
// single mistyped digit is a plausible explanation in the first place.
export const WRITTEN_HD_LARGE_GAP_THRESHOLD = 3.0;

// A candidate only counts as "found the true written figure" if it lands
// back within the SAME band fn_validate_daily_production already treats
// as ordinary rounding, not flag-worthy — this check never invents a
// looser standard than the one already in place.
export const WRITTEN_HD_QUIET_BAND_MAX = 1.0;

// Owner report, 2026-10-02: with 4<->8 added to the shared confusion-pair
// list, a written value can plausibly have MORE THAN ONE candidate land
// inside the (fairly wide, ±1.0pt) quiet-note band at once — e.g. BAB-1's
// 64.7 generates both 68.7 (the true value, gap 0.04 against a calculated
// 68.74) and 69.7 (gap 0.96, only barely inside the band). Requiring exact
// uniqueness-within-the-band (this check's original design) would treat
// that as ambiguous and refuse to correct at all, even though one
// candidate is obviously far closer than the other. The band's WIDTH
// makes near-collisions plausible in a way the eggs/bal-bird corrections'
// EXACT conditions (divisible by 30, sums to an exact total) don't share
// — so closest-candidate ranking belongs here specifically, not as a
// blanket rewrite of every correction function (see docs/DECISIONS.md for
// the audit of the others). The margin below still refuses to guess when
// two candidates are close enough to each other that picking either could
// plausibly be wrong.
export const WRITTEN_HD_MIN_MARGIN = 0.3;

export type WrittenHdCheckResult =
  | { kind: "no_check" } // missing data to check against
  | { kind: "defer" } // gap is within the existing rule's own domain — nothing for this check to add
  | { kind: "auto_correct"; correctedWrittenHd: number; note: string }
  | { kind: "ambiguous" }; // large gap, but no candidate clearly resolves it — leave to the existing flag

export function checkWrittenHdDigitAccuracy(
  writtenHd: number | null,
  calculatedHd: number | null
): WrittenHdCheckResult {
  if (writtenHd === null || calculatedHd === null) return { kind: "no_check" };

  const gap = Math.abs(writtenHd - calculatedHd);
  if (gap <= WRITTEN_HD_LARGE_GAP_THRESHOLD) return { kind: "defer" };

  const inBand = decimalDigitSubstitutionCandidates(writtenHd)
    .map((value) => ({ value, gap: Math.abs(value - calculatedHd) }))
    .filter((c) => c.gap <= WRITTEN_HD_QUIET_BAND_MAX)
    .sort((a, b) => a.gap - b.gap);

  if (inBand.length === 0) return { kind: "ambiguous" };

  const [best, secondBest] = inBand;
  // A second candidate close enough to the best one's own gap means the
  // evidence doesn't clearly favor either — refuse to guess, same as
  // every other correction in this codebase requiring real corroboration
  // before applying anything.
  if (secondBest && secondBest.gap - best.gap < WRITTEN_HD_MIN_MARGIN) {
    return { kind: "ambiguous" };
  }

  return {
    kind: "auto_correct",
    correctedWrittenHd: best.value,
    note: `hd_percent_written ${writtenHd} corrected to ${best.value}: a single-digit misread or decimal-shift of the written figure, and ${best.value} is the closest candidate to the calculated HD (${calculatedHd.toFixed(2)}%), well within the normal rounding band — the original extracted figure is preserved.`,
  };
}
