// Regression fixture for the correction stages (owner request, 2026-10-21):
// pure logic, FAKE re-read calls, no API key. Values come from the real
// 2026-08-03 / 2026-08-08 registers. Run with `npx tsx scripts/regression-correction-stages.ts`.
import {
  assignFeedBoxesByContent,
  buildRawPage,
  flockFeedSums,
  normalizeLedgerQuirk,
  runCorrectionStages,
  type CorrectionDeps,
  type FeedBoxEntry,
} from "../lib/extraction/readerV2/corrections";
import { interpretLedgerLines } from "../lib/extraction/readerV2/ledgerRegion";
import type { ExtractedEggLedgerRegion } from "../lib/extraction/readerV2/ledgerRegion";
import type { ExtractedFeedBoxRegion } from "../lib/extraction/readerV2/feedBoxRegion";
import type { HalfFlockRow, PageHalfExtraction } from "../lib/extraction/readerV2/pageHalfRegion";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`, detail ?? ""); }
}

const conf = { display_label: 1, mortality: 1, feed_bags: 1, eggs_total: 1, bird_population: 1, hd_percent: 1 };
const box = { x: 0, y: 0, width: 1, height: 0.05 };
function row(label: string, mort: number, feed: number, eggs: number, bird: number, hd: number, y: number): HalfFlockRow {
  return { display_label_as_written: label, mortality: mort, feed_bags: feed, eggs_total: eggs, eggs_ii: eggs, bird_population: bird, bird_population_readings: [bird], hd_percent: hd, margin_note: null, confidence: conf, ambiguous_digits: null, row_box: { ...box, y } };
}
const noLedgerConf = { opening_balance_eggs: 1, total_eggs_produced: 1, total_line_eggs: 1, closing_balance_eggs: 1 };
function ledger(o: Partial<ExtractedEggLedgerRegion>): ExtractedEggLedgerRegion {
  return { opening_balance_eggs: null, total_eggs_produced: null, total_line_eggs: null, deductions: [], closing_balance_eggs: null, region_notes: null, confidence: noLedgerConf, ...o };
}
const feedConf = { opening_balance_bags: 1, produced_bags: 1, total_bags: 1, closing_balance_bags: 1, consumed_bags: 1, mill_inventory_bags: 1, shed_inventory_bags: 1 };
function feedBox(o: Partial<ExtractedFeedBoxRegion>): ExtractedFeedBoxRegion {
  return { opening_balance_bags: null, produced_bags: null, total_bags: null, closing_balance_bags: null, consumed_bags: null, mill_inventory_bags: null, shed_inventory_bags: null, region_notes: null, confidence: feedConf, ...o };
}
const ded = (label: string, amount: number) => ({ label_as_written: label, amount_eggs: amount, category_guess: null, confidence: 1 });

// ---- big-ledger quirk (Aug 8 big ledger: "(+) 242640", subtotal 54060) ----
{
  const raw = ledger({ opening_balance_eggs: null, total_eggs_produced: 242640, total_line_eggs: 296700, deductions: [ded("Sale", 132510), ded("", 164190), ded("Breakage", 600)], closing_balance_eggs: 163590 });
  const n = normalizeLedgerQuirk(raw, 54060);
  check("number next to (+) becomes the opening balance", n.ledger.opening_balance_eggs === 242640, n.ledger);
  check("produced = the day's subtotal", n.ledger.total_eggs_produced === 54060);
  check("running remainder is dropped from the deductions", n.ledger.deductions.map((d) => d.amount_eggs).join() === "132510,600", n.ledger.deductions);
  check("OB + produced = total", n.ledger.opening_balance_eggs! + n.ledger.total_eggs_produced! === n.ledger.total_line_eggs!);
}

// ---- line transcription -> ledger (Aug 3 small ledger: no deductions) ----
{
  const small = interpretLedgerLines([
    { kind: "subtotal", label: null, figure: 14490 },
    { kind: "plus", label: null, figure: 1290 },
    { kind: "plain", label: null, figure: 15780 },
  ], null);
  check("small ledger: opening 1290, total 15780, closing = total", small.opening_balance_eggs === 1290 && small.total_line_eggs === 15780 && small.closing_balance_eggs === 15780, small);
  const big = interpretLedgerLines([
    { kind: "subtotal", label: null, figure: 56070 },
    { kind: "plus", label: null, figure: 185550 },
    { kind: "plain", label: null, figure: 241620 },
    { kind: "minus", label: "Buy", figure: 216300 },
    { kind: "plain", label: null, figure: 25320 },
    { kind: "minus", label: "Buy", figure: 1980 },
    { kind: "plain", label: null, figure: 23340 },
  ], null);
  check("big ledger: 2 deductions, remainder skipped, closing 23340", big.deductions.length === 2 && big.closing_balance_eggs === 23340 && big.opening_balance_eggs === 185550, big);
}

// ---- feed boxes identified by content, not label ----
{
  const flocks = [
    ...[["BAB-1", 20], ["BAB-2", 32], ["BAB-3", 15], ["BAB-4", 15], ["BAB-5", 24], ["BAB-6", 25], ["BAB-7", 30], ["BAB-8", 24], ["BAB-9", 10], ["BAB-10", 15]].map(([l, f]) => ({ display_label_as_written: l as string, feed_bags: f as number })),
  ];
  const sums = flockFeedSums(flocks);
  check("flock feed sums (Aug 8): 161 and 49", sums["BAB-1-7"] === 161 && sums["BAB-8-10"] === 49, sums);
  // Labels swapped on purpose: content must win.
  const left: FeedBoxEntry = { group: "BAB-8-10", side: "left", index: 0, assignedBy: "as_read", box: feedBox({ opening_balance_bags: 146, produced_bags: 132, total_bags: 278, closing_balance_bags: 117, consumed_bags: 161, mill_inventory_bags: 79, shed_inventory_bags: 38 }) };
  const right: FeedBoxEntry = { group: "BAB-1-7", side: "left", index: 1, assignedBy: "as_read", box: feedBox({ opening_balance_bags: 71, produced_bags: 44, total_bags: 115, closing_balance_bags: 66, consumed_bags: 49, mill_inventory_bags: 58, shed_inventory_bags: 8 }) };
  const out = assignFeedBoxesByContent([left, right], sums);
  check("box with consumed 161 is BAB-1-7 even though labelled BAB-8-10", out.find((e) => e.box.consumed_bags === 161)?.group === "BAB-1-7", out.map((e) => e.group));
  check("box with consumed 49 is BAB-8-10", out.find((e) => e.box.consumed_bags === 49)?.group === "BAB-8-10");
  // Fragments of one box (OB/(+) lines, then F/S lines) are merged.
  const frag1: FeedBoxEntry = { ...left, group: "BAB-1-7", box: feedBox({ opening_balance_bags: 146, produced_bags: 132, total_bags: 278, closing_balance_bags: 117, consumed_bags: 161 }) };
  const frag2: FeedBoxEntry = { ...left, group: "BAB-1-7", index: 2, box: feedBox({ mill_inventory_bags: 79, shed_inventory_bags: 38 }) };
  const merged = assignFeedBoxesByContent([frag1, frag2, { ...right, group: "BAB-8-10" }], sums);
  check("fragments merge into two boxes", merged.length === 2 && merged.find((e) => e.group === "BAB-1-7")?.box.mill_inventory_bags === 79, merged);
}

// ---- full flow with fake re-reads: unique single-digit repair, ambiguity, re-read, needs review ----
async function flow() {
  const mk = (flocks: HalfFlockRow[], subtotal: PageHalfExtraction["table"] extends infer T ? T extends { subtotal: infer S } ? S : never : never): PageHalfExtraction => ({
    table: { flocks, subtotal, region_notes: null }, ledger: null, feedBoxes: [], chickRows: null, half_notes: null, page_date: null, page_date_confidence: 0,
  });
  // Main table of Aug 8; BAB-1 eggs misread 5780 (true 5730: 8-for-3 -> eggs not a multiple of 30 AND the eggs sum is 50 high).
  const flocks = [
    row("BAB-1", 6, 20, 5780, 8559, 67.1, 0.1), row("BAB-2", 6, 32, 11370, 15551, 73.1, 0.18), row("BAB-3", 1, 15, 5100, 6382, 80.1, 0.26),
    row("BAB-4", 3, 15, 5730, 7387, 77.5, 0.34), row("BAB-5", 3, 24, 8310, 10416, 79.7, 0.42), row("BAB-6", 4, 25, 7440, 10156, 73.2, 0.5), row("BAB-7", 5, 30, 10380, 12604, 82.3, 0.58),
  ];
  const half = mk(flocks, { eggs: 54060, bal_bird: 71055, mortality: 28, feed_bags: 161, hd_percent: 76.7 });
  const raw = buildRawPage([{ side: "right", extraction: half }, { side: "left", extraction: { ...half, table: null } }]);
  const unusedImage = { base64: "", mediaType: "image/jpeg" as const };
  let calls = 0;
  const deps: CorrectionDeps = {
    rereadSection: async () => { calls++; throw new Error("no table re-read expected here"); },
    rereadLedger: async () => { throw new Error("offline test"); },
    rereadFeedBox: async () => { throw new Error("offline test"); },
  };
  const { corrected, report } = await runCorrectionStages(raw, { prevBird: null, prevLedgerClosing: {}, prevFeedClosing: {}, images: { left: unusedImage, right: unusedImage } }, deps);
  const bab1 = corrected.flocks.find((f) => f.display_label_as_written === "BAB-1")!;
  check("BAB-1 eggs 5780 auto-repaired to 5730 (unique single-digit fix)", bab1.eggs_total === 5730, report.outcomes);
  check("repair recorded as 'repaired'", report.outcomes.some((o) => o.item === "BAB-1" && o.field === "eggs_total" && o.status === "repaired"));
  check("raw page is untouched by the correction", raw.flocks.find((f) => f.display_label_as_written === "BAB-1")!.eggs_total === 5780);
  check("no row re-read needed when the repair is unique (at most one subtotal-strip look)", calls <= 1 && !report.outcomes.some((o) => o.status === "reread"), { calls, outcomes: report.outcomes });
}
flow().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
});
