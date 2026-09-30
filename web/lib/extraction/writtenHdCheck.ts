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

export type WrittenHdCheckResult =
  | { kind: "no_check" } // missing data to check against
  | { kind: "defer" } // gap is within the existing rule's own domain — nothing for this check to add
  | { kind: "auto_correct"; correctedWrittenHd: number; note: string }
  | { kind: "ambiguous" }; // large gap, but no single candidate resolves it — leave to the existing flag

export function checkWrittenHdDigitAccuracy(
  writtenHd: number | null,
  calculatedHd: number | null
): WrittenHdCheckResult {
  if (writtenHd === null || calculatedHd === null) return { kind: "no_check" };

  const gap = Math.abs(writtenHd - calculatedHd);
  if (gap <= WRITTEN_HD_LARGE_GAP_THRESHOLD) return { kind: "defer" };

  const candidates = decimalDigitSubstitutionCandidates(writtenHd);
  const inBand = candidates.filter((c) => Math.abs(c - calculatedHd) <= WRITTEN_HD_QUIET_BAND_MAX);

  if (inBand.length === 1) {
    const corrected = inBand[0];
    return {
      kind: "auto_correct",
      correctedWrittenHd: corrected,
      note: `hd_percent_written ${writtenHd} corrected to ${corrected}: a single-digit misread or decimal-shift of the written figure, and ${corrected} matches the calculated HD (${calculatedHd.toFixed(2)}%) within the normal rounding band — the original extracted figure is preserved.`,
    };
  }
  return { kind: "ambiguous" };
}
