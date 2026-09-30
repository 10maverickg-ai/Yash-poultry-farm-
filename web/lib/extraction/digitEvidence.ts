// Digit-accuracy evidence: pure, API-independent functions for scoring
// whether a number was likely misread by this specific scribe's
// handwriting, and for generating a single, confidently-unique correction
// candidate when the evidence supports exactly one. Nothing here ever
// silently applies a correction — callers decide what to do with a
// suggestion (see balBirdChain.ts for the one place a correction is ever
// auto-applied, and only under a corroborated, narrow rule).

// This scribe's confusion pairs, per owner-verified evidence across three
// real register pages (2026-08-01/02/03) — see docs/DECISIONS.md. Checked
// both directions (either digit could be the misread one).
const DIGIT_CONFUSION_PAIRS: [string, string][] = [
  ["3", "8"],
  ["1", "7"],
  ["5", "6"],
  ["4", "9"],
];

// The standard corroboration tolerance used throughout this pass: a
// candidate's implied HD% must land within this many points of the
// register's own written HD% to count as corroborated. Matches the
// threshold used for the bal-bird chain's auto-correction rule — kept as
// one constant so the two stay in sync.
export const HD_CORROBORATION_TOLERANCE = 0.15;

// Used only for the page-checksum-corroborated eggs auto-correction path
// (pipeline.ts's applyPageChecksum stage) — a looser tolerance than
// HD_CORROBORATION_TOLERANCE because that path already requires two OTHER
// independent conditions to hold first (the candidate makes the section's
// eggs sum match the written subtotal EXACTLY, and it's divisible by 30),
// so a slightly wider HD tolerance here is corroboration on top of strong
// evidence, not the sole signal — per the owner's explicit rule.
export const EGGS_AUTO_CORRECT_HD_TOLERANCE = 0.3;

/** Eggs are always counted in whole trays of 30 on this farm — owner-
 * confirmed 2026-09-28 ("a tray of egg sold is of 30 eggs per tray"),
 * and independently verified across all 30 flock-days in the Aug 1-3
 * fixtures and every subtotal. Used as a flag-and-suggest signal (never
 * an auto-correct) throughout this module and writeDailyProduction.ts —
 * confirmed as a real rule of this farm's bookkeeping, not just an
 * observed pattern, but still never strong enough alone to silently
 * pick a value: a genuine partial tray or an unusual real figure could
 * still legitimately not be a multiple of 30. */
export function isMultipleOf30(n: number): boolean {
  return n % 30 === 0;
}

export function calcHd(eggs: number, birdPopulation: number): number | null {
  if (birdPopulation <= 0) return null;
  return (eggs / birdPopulation) * 100;
}

export function hdWithinTolerance(
  a: number,
  b: number,
  tolerance: number = HD_CORROBORATION_TOLERANCE
): boolean {
  return Math.abs(a - b) <= tolerance;
}

/**
 * Every plausible "this scribe wrote X but meant Y" candidate for a number:
 * one confusion-pair digit substituted at a time, plus a trailing zero
 * dropped or added (the "315 vs 3150" failure mode). Never includes the
 * input itself. Order is not meaningful — callers score and filter.
 */
export function digitSubstitutionCandidates(n: number): number[] {
  const candidates = new Set<number>();
  const s = String(Math.trunc(n));

  for (const [a, b] of DIGIT_CONFUSION_PAIRS) {
    for (let i = 0; i < s.length; i++) {
      if (s[i] === a) candidates.add(Number(s.slice(0, i) + b + s.slice(i + 1)));
      else if (s[i] === b) candidates.add(Number(s.slice(0, i) + a + s.slice(i + 1)));
    }
  }
  candidates.add(n * 10); // a trailing zero may have been dropped
  if (n % 10 === 0) candidates.add(n / 10); // or an extra one added

  candidates.delete(n);
  candidates.delete(0);
  return [...candidates].filter((c) => c > 0);
}

/**
 * Digit-substitution search for a single eggs figure, used when eggs%30!=0,
 * an HD gap is large, or repeated readings disagree with no clear winner
 * among the readings themselves (see pickBestReading). Scores every
 * substitution candidate by how well it satisfies the eggs-specific
 * constraints (divisible by 30; if bird_population and writtenHd are both
 * available, its implied HD corroborates the written figure) and returns
 * the candidate ONLY if it's the unique highest scorer with a score that
 * clears the divisibility bar — never returns a "best guess among equally
 * plausible options". This is a suggestion for a human to confirm, never
 * auto-applied (see the "eggs is suggestion-only" rule in the report this
 * shipped with — only bal_bird ever gets auto-corrected, and only via
 * balBirdChain.ts's narrower, HD-corroborated rule).
 */
export function suggestEggsCandidate(
  rawEggs: number,
  birdPopulation: number | null,
  writtenHd: number | null
): number | null {
  const candidates = digitSubstitutionCandidates(rawEggs);
  if (candidates.length === 0) return null;

  const DIVISIBLE_SCORE = 2;
  const HD_SCORE = 1;

  const scored = candidates.map((c) => {
    let score = 0;
    if (isMultipleOf30(c)) score += DIVISIBLE_SCORE;
    if (birdPopulation !== null && birdPopulation > 0 && writtenHd !== null) {
      const impliedHd = calcHd(c, birdPopulation);
      if (impliedHd !== null && hdWithinTolerance(impliedHd, writtenHd)) score += HD_SCORE;
    }
    return { value: c, score };
  });

  const maxScore = Math.max(...scored.map((s) => s.score));
  if (maxScore < DIVISIBLE_SCORE) return null; // divisibility is the baseline bar to clear at all

  const winners = scored.filter((s) => s.score === maxScore);
  return winners.length === 1 ? winners[0].value : null;
}

export interface BestReadingResult {
  value: number;
  allAgree: boolean;
  // True only when the readings disagreed AND exactly one of the EXISTING
  // readings (not a digit-substitution guess) uniquely satisfies the
  // constraints — i.e. this is evidence-backed, not a coin flip between
  // equally-plausible numbers.
  uniquelyBest: boolean;
}

/**
 * Given several independent readings of what should be the same number
 * (e.g. the "I"/"II"/"Total" egg columns, or a two-line block's two Bal
 * Bird lines), picks the one best supported by the given scorer — used to
 * prefer a reading over its disagreeing siblings rather than just reporting
 * "these disagree" with no lean. Never fabricates a value outside the
 * actual readings; if none or more than one reading ties for the top
 * score, uniquelyBest is false and callers should show all readings
 * without endorsing one.
 */
export function pickBestReading(
  readings: (number | null)[],
  scorer: (n: number) => number
): BestReadingResult | null {
  const present = readings.filter((n): n is number => n !== null);
  if (present.length === 0) return null;
  if (present.every((n) => n === present[0])) {
    return { value: present[0], allAgree: true, uniquelyBest: true };
  }

  const scored = present.map((v) => ({ value: v, score: scorer(v) }));
  const maxScore = Math.max(...scored.map((s) => s.score));
  const winners = scored.filter((s) => s.score === maxScore);
  // Dedupe winners by value (the same figure could appear twice among the
  // readings, e.g. both lines of a two-line block agreeing while a third
  // reading disagrees).
  const uniqueWinnerValues = [...new Set(winners.map((w) => w.value))];

  if (maxScore > 0 && uniqueWinnerValues.length === 1) {
    return { value: uniqueWinnerValues[0], allAgree: false, uniquelyBest: true };
  }
  // No clear winner — report the last reading (conventionally the most
  // "final"/authoritative one written, e.g. the Total column or the bottom
  // line) but mark it as not evidence-backed so callers don't overstate it.
  return { value: present[present.length - 1], allAgree: false, uniquelyBest: false };
}
