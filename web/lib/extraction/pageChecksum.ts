import { digitSubstitutionCandidates } from "./digitEvidence";

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
  // Set when exactly one flock in the section has a digit-substitution
  // candidate that would make the sum match exactly — i.e. the mismatch is
  // traceable to a specific likely misread, not just "something's off".
  suspectFlock: { label: string; from: number; to: number } | null;
  message: string;
}

// Bal bird subtotals are a running sum the register itself sometimes
// rounds or carries a stray +/-1 into — owner-verified, 2026-09-28: the
// Aug 3 right-section bal birds sum to 71208 against a written 71207, a
// real, harmless one-off. Never worth a flag on its own.
const BAL_BIRD_TOLERANCE = 2;

function traceEggsMismatch(
  inSection: SectionFlock[],
  diff: number // flockSum - written; positive means the flocks summed too high
): ChecksumFinding["suspectFlock"] {
  const matches: { label: string; from: number; to: number }[] = [];
  for (const f of inSection) {
    if (f.eggs_total === null) continue;
    for (const c of digitSubstitutionCandidates(f.eggs_total)) {
      if (f.eggs_total - c === diff) {
        matches.push({ label: f.label, from: f.eggs_total, to: c });
      }
    }
  }
  const uniqueLabels = [...new Set(matches.map((m) => m.label))];
  return uniqueLabels.length === 1 ? matches.find((m) => m.label === uniqueLabels[0])! : null;
}

export function checkPageChecksums(
  flocks: SectionFlock[],
  subtotals: SectionSubtotal[]
): ChecksumFinding[] {
  const findings: ChecksumFinding[] = [];

  for (const sub of subtotals) {
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
          message: `${sub.section} section: flock bal bird sums to ${sum}, page subtotal reads ${sub.bal_bird} (informational — within ±${BAL_BIRD_TOLERANCE} is normal)`,
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
