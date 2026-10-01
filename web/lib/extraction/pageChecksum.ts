import {
  digitSubstitutionCandidates,
  isMultipleOf30,
  calcHd,
  hdWithinTolerance,
  EGGS_AUTO_CORRECT_HD_TOLERANCE,
} from "./digitEvidence";

// Page checksum, rebuilt (owner report, 2026-09-28: the previous version
// flagged an entire correct 10-flock page because the model misread the
// continuation table's subtotal as a stock-ledger carry-forward line one
// row further down — see docs/DECISIONS.md for exactly where that number
// came from). Two changes from the old version: (1) each section's
// subtotal is compared ONLY against that section's own flocks, tagged
// explicitly rather than inferred, so a bad read in one section can't get
// summed together with a good read in the other; (2) a mismatch is a
// property of the PAGE, never copied onto every flock row — callers turn
// these findings into ONE page-level issue, not a flag on every flock.

export type Section = "main" | "continuation";

export interface SectionSubtotal {
  section: Section;
  eggs: number | null;
  bal_bird: number | null;
  mortality: number | null;
  feed_bags: number | null;
  hd_percent: number | null;
}

export interface SectionFlock {
  label: string;
  section: Section;
  mortality: number | null;
  feed_bags: number | null;
  eggs_total: number | null;
  bird_population: number | null;
  // Needed to fully corroborate a traced eggs candidate (divisible by 30
  // + HD match) — see traceEggsMismatch. Only eggs findings use it.
  hd_percent_written: number | null;
}

// Named for eggs (where it was first needed) but structurally generic —
// reused as-is for mortality's section-checksum tracing in
// mortalityChecksum.ts, which needs the exact same shape.
export interface EggsSuspect {
  label: string;
  from: number;
  to: number;
  // True when this candidate is the UNIQUE one that's simultaneously an
  // exact fix for the section sum, divisible by 30, and HD-corroborated —
  // the owner's three-way bar for auto-correcting eggs (pipeline.ts acts
  // on this flag directly rather than re-deriving it). False means it's
  // still worth naming as a lead (e.g. the only flock whose substitution
  // exactly closes the gap, even without the other two conditions, or the
  // best of several that were narrowed by corroboration but not to a
  // unique answer) — shown in the message, never auto-applied.
  corroborated: boolean;
}

export interface ChecksumFinding {
  section: Section;
  field: "eggs" | "mortality" | "feed_bags" | "bal_bird";
  // "mismatch": an exact-arithmetic check failed — always worth a page
  // issue. "info": bal_bird only, a tolerant check that never gates
  // anything on its own (bal_bird is already checked far more precisely,
  // per flock, by the day-to-day chain in balBirdChain.ts).
  severity: "mismatch" | "info";
  flockSum: number;
  written: number;
  suspectFlock: EggsSuspect | null;
  message: string;
}

// Bal bird subtotals are a running sum the register itself sometimes
// rounds or carries a stray +/-1 into — owner-verified, 2026-09-28: the
// Aug 3 right-section bal birds sum to 71208 against a written 71207, a
// real, harmless one-off. Never worth a flag on its own.
const BAL_BIRD_TOLERANCE = 2;

/**
 * Row-signature test (owner report, 2026-09-29 — this exact confusion
 * misread a stock-ledger line as the continuation subtotal on BOTH Aug 3
 * and Aug 4): a genuine subtotal row always shows a Bal Bird figure and an
 * HD% alongside its eggs figure, the same shape as a flock's own row. A
 * stock-ledger line (a running total, a "(+) N"/"Buy (−) N" entry, a
 * tray count) has just one bare number — never a Bal Bird, never an HD%.
 * Applied here as a model-INDEPENDENT backstop: even if the model's own
 * judgment (see the ROW-SIGNATURE TEST section of the extraction prompt)
 * misfires and reports a ledger line as if it were a subtotal, an entry
 * missing both of these structural markers is discarded entirely before
 * it ever reaches the sum comparison below, rather than trusted at face
 * value. This can only be verified against the prompt's OWN behavior with
 * live API access (untested here) — this filter holds regardless of
 * whether the prompt succeeds.
 */
export function looksLikeGenuineSubtotal(sub: SectionSubtotal): boolean {
  return sub.bal_bird !== null && sub.hd_percent !== null;
}

/**
 * Traces a section's eggs mismatch to a specific flock's likely misread,
 * when the evidence uniquely points to one. Two tiers, evidence-strongest
 * first:
 *   1. Among every (flock, digit-substitution-candidate) pair that would
 *      exactly close the section's gap, keep only those ALSO divisible by
 *      30 and HD-corroborated. If that narrows to exactly one, it's fully
 *      corroborated — pipeline.ts auto-corrects it.
 *   2. Otherwise, if exactly one FLOCK (regardless of which of its
 *      candidates) has any exact-sum-closing substitution at all, name it
 *      as a lead — worth showing the owner, not worth auto-applying.
 * Real case this tiering exists for: Aug 4's main section, where BOTH
 * BAB-1's actual misread (6080→6030) and BAB-4's correctly-extracted
 * 5880 happened to have a digit-substitution (5880→5830) that closed
 * the exact same $50 gap — tier 1 correctly narrows to BAB-1 alone, since
 * 5830 isn't divisible by 30 (194.33) while 6030 is (201) and matches
 * written HD.
 */
function traceEggsMismatch(
  inSection: SectionFlock[],
  diff: number // flockSum - written; positive means the flocks summed too high
): EggsSuspect | null {
  const exactMatches: { label: string; from: number; to: number }[] = [];
  for (const f of inSection) {
    if (f.eggs_total === null) continue;
    for (const c of digitSubstitutionCandidates(f.eggs_total)) {
      if (f.eggs_total - c === diff) {
        exactMatches.push({ label: f.label, from: f.eggs_total, to: c });
      }
    }
  }
  if (exactMatches.length === 0) return null;

  const corroborated = exactMatches.filter((m) => {
    if (!isMultipleOf30(m.to)) return false;
    const flock = inSection.find((f) => f.label === m.label)!;
    if (flock.bird_population === null || flock.bird_population <= 0 || flock.hd_percent_written === null) {
      return false;
    }
    const hd = calcHd(m.to, flock.bird_population);
    return hd !== null && hdWithinTolerance(hd, flock.hd_percent_written, EGGS_AUTO_CORRECT_HD_TOLERANCE);
  });
  if (corroborated.length === 1) {
    return { ...corroborated[0], corroborated: true };
  }

  const uniqueLabels = [...new Set(exactMatches.map((m) => m.label))];
  if (uniqueLabels.length === 1) {
    return { ...exactMatches.find((m) => m.label === uniqueLabels[0])!, corroborated: false };
  }
  return null;
}

export function checkPageChecksums(
  flocks: SectionFlock[],
  subtotals: SectionSubtotal[]
): ChecksumFinding[] {
  const findings: ChecksumFinding[] = [];
  const trustedSubtotals = subtotals.filter(looksLikeGenuineSubtotal);

  for (const sub of trustedSubtotals) {
    const inSection = flocks.filter((f) => f.section === sub.section);
    // No flocks matched to this section at all — nothing to compare
    // against; a subtotal with no corresponding flocks is not this check's
    // problem to report (could be a section-tagging mismatch worth its own
    // separate look, but asserting a false "sum to 0" finding here would
    // be exactly the kind of false positive this rebuild exists to avoid).
    if (inSection.length === 0) continue;

    if (sub.eggs !== null) {
      const sum = inSection.reduce((s, f) => s + (f.eggs_total ?? 0), 0);
      if (sum !== sub.eggs) {
        const suspect = traceEggsMismatch(inSection, sum - sub.eggs);
        findings.push({
          section: sub.section, field: "eggs", severity: "mismatch",
          flockSum: sum, written: sub.eggs, suspectFlock: suspect,
          message: suspect
            ? `${sub.section} section: flock eggs sum to ${sum}, page subtotal reads ${sub.eggs} — likely ${suspect.label} (${suspect.from} may be ${suspect.to})`
            : `${sub.section} section: flock eggs sum to ${sum}, page subtotal reads ${sub.eggs}`,
        });
      }
    }
    if (sub.mortality !== null) {
      const sum = inSection.reduce((s, f) => s + (f.mortality ?? 0), 0);
      if (sum !== sub.mortality) {
        findings.push({
          section: sub.section, field: "mortality", severity: "mismatch",
          flockSum: sum, written: sub.mortality, suspectFlock: null,
          message: `${sub.section} section: flock mortality sums to ${sum}, page subtotal reads ${sub.mortality}`,
        });
      }
    }
    if (sub.feed_bags !== null) {
      const sum = inSection.reduce((s, f) => s + (f.feed_bags ?? 0), 0);
      if (sum !== sub.feed_bags) {
        findings.push({
          section: sub.section, field: "feed_bags", severity: "mismatch",
          flockSum: sum, written: sub.feed_bags, suspectFlock: null,
          message: `${sub.section} section: flock feed bags sum to ${sum}, page subtotal reads ${sub.feed_bags}`,
        });
      }
    }
    if (sub.bal_bird !== null) {
      const sum = inSection.reduce((s, f) => s + (f.bird_population ?? 0), 0);
      if (Math.abs(sum - sub.bal_bird) > BAL_BIRD_TOLERANCE) {
        findings.push({
          section: sub.section, field: "bal_bird", severity: "info",
          flockSum: sum, written: sub.bal_bird, suspectFlock: null,
          message: `${sub.section} section: flock bal bird sums to ${sum}, page subtotal reads ${sub.bal_bird}`,
        });
      }
    }
  }

  return findings;
}

/**
 * One page-level issue string from a set of findings, or null if there's
 * nothing worth a human's attention. An "info"-only finding (bal_bird)
 * never creates a page issue by itself — it only rides along, for context,
 * when at least one hard (eggs/mortality/feed_bags) finding already exists.
 */
export function buildPageIssueText(findings: ChecksumFinding[]): string | null {
  const hard = findings.filter((f) => f.severity === "mismatch");
  if (hard.length === 0) return null;
  const info = findings.filter((f) => f.severity === "info");
  return [...hard, ...info].map((f) => f.message).join("; ");
}
