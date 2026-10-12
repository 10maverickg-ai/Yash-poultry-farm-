import { checkBalBirdChain } from "./balBirdChain";

// Next-day chain re-check (owner request, 2026-10-19 — deferred from the
// "Round 2 accuracy fixes" PR): when a PAST row's mortality, eggs_total, or
// bird_population changes (a human edit on the entry screen, reached either
// directly or via /flagged), the day-to-day bal-bird chain
// (bird_population[next day] = bird_population[this day] - mortality[next
// day]) that the NEXT day's already-saved row was checked against may no
// longer hold. The next day's row is NEVER auto-edited from here — only
// flagged, for a human to look at, naming the mismatch plainly. Pure, no
// database — the caller (app/production/actions.ts) fetches the next day's
// row and applies whatever this returns.

export interface NextDayRow {
  mortality: number | null;
  eggsTotal: number | null;
  birdPopulation: number | null;
  hdPercentWritten: number | null;
}

// Prefix used to find-and-replace this SPECIFIC flag across re-saves,
// without disturbing any other flag reason already on the next day's row
// (same "one marker, substring-matched" convention as this codebase's
// auto-correction notes).
export const NEXT_DAY_CHAIN_FLAG_PREFIX = "next-day chain check:";

/**
 * Returns the flag text to attach to the NEXT day's row, or null if the
 * chain holds cleanly (or there's nothing to check — e.g. the next day's
 * own bird_population/mortality is missing).
 */
export function checkNextDayChainStillHolds(
  nextDay: NextDayRow,
  updatedPreviousBalBird: number | null
): string | null {
  const result = checkBalBirdChain({
    eggsTotal: nextDay.eggsTotal,
    todayMortality: nextDay.mortality,
    todayExtractedBalBird: nextDay.birdPopulation,
    todayWrittenHd: nextDay.hdPercentWritten,
    previousBalBird: updatedPreviousBalBird,
  });

  switch (result.kind) {
    case "match":
    case "no_previous":
      return null;
    case "auto_correct":
      // The chain finds A number that would reconcile it — never applied
      // automatically to an already-saved future row; surfaced as a flag
      // naming the suggestion instead.
      return `${NEXT_DAY_CHAIN_FLAG_PREFIX} bird_population (${nextDay.birdPopulation}) no longer matches the chain after this edit — expected ${result.correctedBalBird} (matches written HD). Confirm and fix if needed.`;
    case "flag_previous":
      return `${NEXT_DAY_CHAIN_FLAG_PREFIX} bird_population (${nextDay.birdPopulation}) no longer matches the chain after this edit (unexplained change of ${result.unexplainedDelta >= 0 ? "+" : ""}${result.unexplainedDelta}). Confirm and fix if needed.`;
    case "flag_today":
      return `${NEXT_DAY_CHAIN_FLAG_PREFIX} ${result.note}`;
  }
}

/**
 * Strips any PRIOR occurrence of this check's own flag (by its fixed
 * prefix) out of an existing flag_reason string, so a re-save that fixes
 * the chain doesn't leave a stale flag behind, and a re-save that changes
 * the specific wording doesn't just pile up duplicates.
 */
export function stripNextDayChainFlag(flagReason: string | null): string[] {
  if (!flagReason) return [];
  return flagReason
    .split("; ")
    .filter((part) => !part.startsWith(NEXT_DAY_CHAIN_FLAG_PREFIX));
}
