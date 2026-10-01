import { digitSubstitutionCandidates } from "./digitEvidence";
import { looksLikeGenuineSubtotal, type Section, type SectionSubtotal, type EggsSuspect } from "./pageChecksum";

// Mortality digit-accuracy via the page's own section-mortality subtotal
// (owner report, 2026-10-03, confirmed against the physical register:
// BAB-6, 2026-08-06 — mortality extracted as 8, true value 3; the written
// section subtotal is 28, and the other 6 flocks' mortality figures sum to
// 25, so the section sums to 33 against a written 28 — a gap of exactly 5,
// exactly an 8-for-3 misread). Same evidence class as eggs' page-checksum
// correction (pageChecksum.ts's traceEggsMismatch) — a section subtotal
// the register itself writes is independent, external evidence a per-flock
// read can be checked against — but run as ITS OWN, EARLIER pipeline stage
// (see pipeline.ts's applyMortalityChecksum), not folded into
// checkPageChecksums/applyPageChecksum: those run at stage 4/5, AFTER the
// day-to-day bal-bird chain (stage "chain") has already consumed
// mortality — and that's exactly the bug this stage exists to prevent.
// Mortality must be validated BEFORE the chain ever uses it, or the chain
// can "succeed" only because mortality itself is wrong (see
// mortalityFeedSwap.ts / balBirdChain.ts's own docs for the day-to-day
// chain's reasoning — this is a DIFFERENT, independent corroboration
// source, catching exactly the case where mortality is wrong but doesn't
// happen to equal feed_bags, so the column-swap check has nothing to
// catch).

export interface MortalityChecksumFlock {
  label: string;
  section: Section;
  mortality: number | null;
  // Chain-implied mortality for this flock (previous day's bal bird minus
  // today's bal bird) — used ONLY to rank between multiple section-sum-
  // closing candidates when more than one exists (see
  // traceMortalitySectionMismatch); never the primary gate, since it's the
  // same chain this check exists to validate mortality BEFORE trusting.
  // Null when there's no previous-day data to compute it from.
  chainImpliedMortality: number | null;
}

// Same margin-based ranking shape as writtenHdCheck.ts's
// WRITTEN_HD_MIN_MARGIN, reused for the identical reason (owner request,
// 2026-10-03: "same closest-candidate ranking logic from the HD% fix") —
// when multiple digit-substitution candidates would each exactly close the
// section's mortality gap, the one closest to this flock's OWN
// chain-implied mortality is preferred, but only when it clearly beats the
// next-closest by a real margin; a near-tie still refuses to guess.
const MORTALITY_CHAIN_MIN_MARGIN = 1;

/**
 * Traces a section's mortality mismatch to a specific flock's likely
 * misread. Unlike eggs (which has divisible-by-30 as a second exact
 * condition), mortality has no equivalent — so the primary bar is
 * uniqueness itself: exactly one (flock, digit-substitution-candidate)
 * pair across the whole section that exactly closes the gap is already
 * strong evidence on a typically-small section (a handful of single/
 * double-digit mortality figures), since a coincidental second match is
 * rare. When MORE than one such pair exists, the day-to-day chain-implied
 * mortality (when available for the candidate flocks) ranks them — the
 * closest candidate wins, but only with a real margin over the
 * second-closest; otherwise it's ambiguous, named as a lead, never
 * auto-corrected.
 */
export function traceMortalitySectionMismatch(
  inSection: MortalityChecksumFlock[],
  diff: number // flockSum - written; positive means the flocks summed too high
): EggsSuspect | null {
  const exactMatches: { label: string; from: number; to: number; chainImplied: number | null }[] = [];
  for (const f of inSection) {
    if (f.mortality === null) continue;
    for (const c of digitSubstitutionCandidates(f.mortality)) {
      if (c < 0) continue; // mortality can't be negative
      if (f.mortality - c === diff) {
        exactMatches.push({ label: f.label, from: f.mortality, to: c, chainImplied: f.chainImpliedMortality });
      }
    }
  }
  if (exactMatches.length === 0) return null;
  // Each flock contributes AT MOST one candidate for a given diff (digit-
  // substitution candidates are deduplicated, so two distinct candidates
  // can never both equal the same required target value) — so
  // exactMatches.length >= 2 here always means >= 2 DIFFERENT flocks, not
  // ambiguity within one flock's own digits.
  if (exactMatches.length === 1) {
    return { ...exactMatches[0], corroborated: true };
  }

  // Multiple distinct flocks could each explain the gap — only resolvable
  // if EVERY one of them has chain-implied data to rank against (ranking
  // among a partial subset would unfairly favor whichever flock happened
  // to have previous-day data, which isn't evidence about which flock's
  // mortality was actually misread).
  if (exactMatches.every((m) => m.chainImplied !== null)) {
    const ranked = exactMatches
      .map((m) => ({ ...m, gap: Math.abs(m.to - (m.chainImplied as number)) }))
      .sort((a, b) => a.gap - b.gap);
    const [best, secondBest] = ranked;
    if (secondBest.gap - best.gap >= MORTALITY_CHAIN_MIN_MARGIN) {
      return { ...best, corroborated: true };
    }
    // The chain leans toward one candidate without clearing the margin to
    // auto-apply it — worth naming as a lead (owner request: "traceable to
    // one flock... flag that specific row, don't leave it clean") rather
    // than discarding real, if inconclusive, evidence.
    return { ...best, corroborated: false };
  }

  // Can't isolate to one flock at all (no chain data to rank by) —
  // genuinely ambiguous, no correction and no single row named (per the
  // owner's own instruction: when it truly can't be isolated to one row,
  // neither a silent correction nor a misdirected flag on the wrong flock
  // is acceptable).
  return null;
}

export interface MortalitySectionCheckInput {
  label: string;
  section: Section;
  mortality: number | null;
  chainImpliedMortality: number | null;
}

export interface MortalityCorrection {
  label: string;
  from: number;
  to: number;
  note: string;
}

export interface MortalityFlag {
  label: string;
  note: string;
}

export interface MortalityChecksumResult {
  corrections: MortalityCorrection[];
  flags: MortalityFlag[];
}

/**
 * Page-wide pass: for every section with a genuine (row-signature-tested)
 * written mortality subtotal that doesn't match the flocks' own sum,
 * traces it and either names a correction (uniquely corroborated) or a
 * flag (traceable to one flock, but not confidently auto-correctable) —
 * never both for the same flock, never silent. A mismatch that can't be
 * isolated to one flock produces neither here (the existing page-level
 * banner in pageChecksum.ts/applyPageChecksum still covers that case,
 * unchanged).
 */
export function checkMortalitySectionChecksums(
  flocks: MortalitySectionCheckInput[],
  subtotals: SectionSubtotal[]
): MortalityChecksumResult {
  const corrections: MortalityCorrection[] = [];
  const flags: MortalityFlag[] = [];
  const trustedSubtotals = subtotals.filter(looksLikeGenuineSubtotal);

  for (const sub of trustedSubtotals) {
    if (sub.mortality === null) continue;
    const inSection = flocks.filter((f) => f.section === sub.section);
    if (inSection.length === 0) continue;

    const sum = inSection.reduce((s, f) => s + (f.mortality ?? 0), 0);
    if (sum === sub.mortality) continue;

    const suspect = traceMortalitySectionMismatch(inSection, sum - sub.mortality);
    if (!suspect) continue;

    if (suspect.corroborated) {
      corrections.push({
        label: suspect.label,
        from: suspect.from,
        to: suspect.to,
        note: `mortality ${suspect.from} corrected to ${suspect.to}: makes the ${sub.section} section's mortality sum match the page's own written subtotal (${sub.mortality}) exactly.`,
      });
    } else {
      flags.push({
        label: suspect.label,
        note: `${sub.section} section: flock mortality sums to ${sum}, page subtotal reads ${sub.mortality} — likely ${suspect.label} (${suspect.from} may be ${suspect.to}), but not confidently auto-correctable.`,
      });
    }
  }

  return { corrections, flags };
}
