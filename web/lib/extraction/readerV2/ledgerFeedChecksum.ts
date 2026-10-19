import type { ExtractedEggLedgerRegion } from "./ledgerRegion";
import type { ExtractedFeedBoxRegion } from "./feedBoxRegion";

// Owner request, 2026-10-19: the flock tables already get a checksum-
// guided retry (pageChecksum.ts + readerV2/index.ts) — the egg ledger and
// feed box crops did not, so a misread figure there was accepted on the
// first try with no self-check at all. These are the SAME-CALL,
// no-DB-access checks: whatever a single ledger/feed-box crop can verify
// about its OWN internal arithmetic, used to decide whether to re-ask
// (ledgerRegion.ts / feedBoxRegion.ts's confusionHint) before accepting.
//
// Deliberately does NOT check "opening equals the previous day's closing"
// — that needs another day's saved data this single photo can never
// supply, and (for the feed box specifically) the owner has confirmed the
// supervisor genuinely only re-counts the box every two days, so opening
// legitimately does NOT always chain from the previous close (migration
// 0024). The benchmark's own ground-truth comparison already covers that
// cross-day question from the database; it doesn't belong in a vision
// retry loop that can only ever look at one photo.

export interface ArithmeticFinding {
  message: string;
}

export function checkEggLedgerArithmetic(l: ExtractedEggLedgerRegion): ArithmeticFinding[] {
  const findings: ArithmeticFinding[] = [];

  const allFigures = [
    l.opening_balance_eggs,
    l.total_eggs_produced,
    l.total_line_eggs,
    l.closing_balance_eggs,
    ...l.deductions.map((d) => d.amount_eggs),
  ];
  if (allFigures.some((v) => v !== null && v % 30 !== 0)) {
    findings.push({ message: "one or more egg figures are not a multiple of 30 — eggs on this farm are always whole trays" });
  }

  if (l.opening_balance_eggs !== null && l.total_eggs_produced !== null && l.total_line_eggs !== null) {
    const expected = l.opening_balance_eggs + l.total_eggs_produced;
    if (expected !== l.total_line_eggs) {
      findings.push({
        message: `opening (${l.opening_balance_eggs}) + produced (${l.total_eggs_produced}) = ${expected}, but the total line was read as ${l.total_line_eggs}`,
      });
    }
  }

  if (l.total_line_eggs !== null && l.closing_balance_eggs !== null) {
    const deductionSum = l.deductions.reduce((sum, d) => sum + d.amount_eggs, 0);
    const expected = l.total_line_eggs - deductionSum;
    if (expected !== l.closing_balance_eggs) {
      findings.push({
        message: `the total line (${l.total_line_eggs}) minus the deductions (${deductionSum}) = ${expected}, but closing was read as ${l.closing_balance_eggs}`,
      });
    }
  }

  return findings;
}

export function checkFeedBoxArithmetic(f: ExtractedFeedBoxRegion): ArithmeticFinding[] {
  const findings: ArithmeticFinding[] = [];

  if (f.mill_inventory_bags !== null && f.shed_inventory_bags !== null && f.closing_balance_bags !== null) {
    const expected = f.mill_inventory_bags + f.shed_inventory_bags;
    if (expected !== f.closing_balance_bags) {
      findings.push({
        message: `F (${f.mill_inventory_bags}) + S (${f.shed_inventory_bags}) = ${expected}, but the "(-)" closing figure was read as ${f.closing_balance_bags}`,
      });
    }
  }

  if (f.opening_balance_bags !== null && f.produced_bags !== null && f.total_bags !== null) {
    const expected = f.opening_balance_bags + f.produced_bags;
    if (expected !== f.total_bags) {
      findings.push({
        message: `OB (${f.opening_balance_bags}) + received (${f.produced_bags}) = ${expected}, but the total was read as ${f.total_bags}`,
      });
    }
  }

  if (f.total_bags !== null && f.closing_balance_bags !== null && f.consumed_bags !== null) {
    const expected = f.total_bags - f.closing_balance_bags;
    if (expected !== f.consumed_bags) {
      findings.push({
        message: `total (${f.total_bags}) minus closing (${f.closing_balance_bags}) = ${expected}, but consumed was read as ${f.consumed_bags}`,
      });
    }
  }

  return findings;
}
