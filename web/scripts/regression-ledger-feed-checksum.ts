// Permanent regression fixture for the ledger/feed-box self-consistency
// checks (owner request, 2026-10-19) — pure functions, no API access
// needed. Run with `npx tsx scripts/regression-ledger-feed-checksum.ts`
// from `web/`.

import { checkEggLedgerArithmetic, checkFeedBoxArithmetic } from "../lib/extraction/readerV2/ledgerFeedChecksum";
import type { ExtractedEggLedgerRegion } from "../lib/extraction/readerV2/ledgerRegion";
import type { ExtractedFeedBoxRegion } from "../lib/extraction/readerV2/feedBoxRegion";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`PASS: ${name}`);
  } else {
    fail++;
    console.log(`FAIL: ${name}`, detail ?? "");
  }
}

const CONF = { opening_balance_eggs: 0.9, total_eggs_produced: 0.9, total_line_eggs: 0.9, closing_balance_eggs: 0.9 };

function ledger(overrides: Partial<ExtractedEggLedgerRegion>): ExtractedEggLedgerRegion {
  return {
    opening_balance_eggs: 208890,
    total_eggs_produced: 51690,
    total_line_eggs: 260580,
    deductions: [{ label_as_written: "Sale", amount_eggs: 183120, category_guess: "sale", confidence: 0.9 }],
    closing_balance_eggs: 77460,
    region_notes: null,
    confidence: CONF,
    ...overrides,
  };
}

const FEED_CONF = {
  opening_balance_bags: 0.9, produced_bags: 0.9, total_bags: 0.9, closing_balance_bags: 0.9,
  consumed_bags: 0.9, mill_inventory_bags: 0.9, shed_inventory_bags: 0.9,
};

function feedBox(overrides: Partial<ExtractedFeedBoxRegion>): ExtractedFeedBoxRegion {
  return {
    opening_balance_bags: 143,
    produced_bags: 100,
    total_bags: 243,
    closing_balance_bags: 50, // F+S
    consumed_bags: 193, // total - closing
    mill_inventory_bags: 20,
    shed_inventory_bags: 30,
    region_notes: null,
    confidence: FEED_CONF,
    ...overrides,
  };
}

function main() {
  // --- Egg ledger ---
  check("clean ledger: no findings", checkEggLedgerArithmetic(ledger({})).length === 0, checkEggLedgerArithmetic(ledger({})));

  check(
    "ledger: non-multiple-of-30 figure is flagged",
    checkEggLedgerArithmetic(ledger({ closing_balance_eggs: 77461 })).some((f) => f.message.includes("multiple of 30")),
  );

  check(
    "ledger: opening+produced != total line is flagged",
    checkEggLedgerArithmetic(ledger({ total_line_eggs: 260610 })).some((f) => f.message.includes("total line")),
  );

  check(
    "ledger: total line - deductions != closing is flagged",
    checkEggLedgerArithmetic(ledger({ closing_balance_eggs: 77430 })).some((f) => f.message.includes("closing")),
  );

  check(
    "ledger: null fields are skipped, not flagged as mismatches",
    checkEggLedgerArithmetic(ledger({ opening_balance_eggs: null, total_line_eggs: null })).length === 0,
  );

  // --- Feed box ---
  check("clean feed box: no findings", checkFeedBoxArithmetic(feedBox({})).length === 0, checkFeedBoxArithmetic(feedBox({})));

  check(
    "feed box: F+S != closing is flagged",
    checkFeedBoxArithmetic(feedBox({ closing_balance_bags: 55 })).some((f) => f.message.startsWith("F (")),
  );

  check(
    "feed box: OB+received != total is flagged",
    checkFeedBoxArithmetic(feedBox({ total_bags: 250 })).some((f) => f.message.startsWith("OB (")),
  );

  check(
    "feed box: total-closing != consumed is flagged",
    checkFeedBoxArithmetic(feedBox({ consumed_bags: 200 })).some((f) => f.message.startsWith("total (")),
  );

  check(
    "feed box: bags are NOT checked against multiples of 30 (not a tray-of-30 field)",
    checkFeedBoxArithmetic(feedBox({ total_bags: 244, consumed_bags: 194 })).every((f) => !f.message.includes("multiple of 30")),
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
