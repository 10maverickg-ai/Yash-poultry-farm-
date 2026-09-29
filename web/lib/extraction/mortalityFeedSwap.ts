// Mortality/feed_bags column-swap detection (owner report, 2026-09-28,
// Aug 4 BAB-1: mortality read as 18 — that flock's own feed_bags value —
// instead of the true 3). This is a COLUMN-IDENTITY error, not a digit
// error: the model read the right number, into the wrong field entirely.
// The day-to-day bal-bird chain (see balBirdChain.ts) gives an independent
// way to derive the true mortality directly — previous day's bal bird
// minus today's bal bird — so a suspected swap can be corrected with real
// evidence rather than guessed.
//
// This check must run BEFORE balBirdChain's own check on the same flock:
// if mortality is wrong, balBirdChain's "expected = previous − mortality"
// is computed from a wrong mortality and can itself misfire (e.g. flagging
// bird_population as the problem when mortality was the actual culprit).
// See pipeline.ts for the enforced ordering.

export type MortalityFeedSwapResult =
  | { kind: "no_check" } // missing data to check against (no previous day, etc.)
  | { kind: "ok" } // chain already holds with the extracted mortality — nothing suspicious
  | { kind: "auto_correct"; correctedMortality: number; note: string }
  | { kind: "flag"; note: string }; // suspicious but not confidently resolvable

// A day's mortality for one flock on this farm is always in this range —
// used only to sanity-check a CANDIDATE correction derived from the chain,
// never to validate the model's own raw read (a genuinely high real
// mortality day must still be extractable, just not auto-corrected INTO).
const SANE_MORTALITY_RANGE = { min: 0, max: 30 };

export function checkMortalityFeedSwap(input: {
  mortality: number | null;
  feedBags: number | null;
  birdPopulation: number | null;
  previousBalBird: number | null;
}): MortalityFeedSwapResult {
  const { mortality, feedBags, birdPopulation, previousBalBird } = input;

  if (mortality === null || feedBags === null || birdPopulation === null || previousBalBird === null) {
    return { kind: "no_check" };
  }

  const impliedMortality = previousBalBird - birdPopulation;

  // The chain already holds with the extracted mortality as-is — even if
  // it happens to equal feed_bags too (a real day where mortality and feed
  // bags coincide is possible, if unusual), there's nothing to correct.
  if (mortality === impliedMortality) {
    return { kind: "ok" };
  }

  const sane = impliedMortality >= SANE_MORTALITY_RANGE.min && impliedMortality <= SANE_MORTALITY_RANGE.max;
  const sameValueAsFeed = mortality === feedBags;

  if (sane && sameValueAsFeed) {
    return {
      kind: "auto_correct",
      correctedMortality: impliedMortality,
      note: `mortality ${mortality} corrected to ${impliedMortality}: it matched feed_bags (${feedBags}), a likely column swap, and ${impliedMortality} is what the previous day's bal bird minus today's bal bird (${previousBalBird} − ${birdPopulation}) implies.`,
    };
  }

  if (sameValueAsFeed) {
    // Same-value collision (strong signal) but the chain doesn't imply a
    // sane replacement — worth a flag, not confidently auto-correctable.
    return {
      kind: "flag",
      note: `mortality (${mortality}) equals feed_bags (${feedBags}) — possible column swap, but the previous day's bal bird minus today's bal bird (${previousBalBird} − ${birdPopulation} = ${impliedMortality}) isn't a plausible day's mortality, so this wasn't auto-corrected.`,
    };
  }

  // No same-value collision, but the chain still doesn't hold for the
  // extracted mortality — balBirdChain.ts (run after this) will surface
  // this from the bird_population side; nothing further to add here.
  return { kind: "no_check" };
}
