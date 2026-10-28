import { withTransaction } from "../db";
import { extractLedgerAndFeed } from "./ledgerFeedExtraction";
import { resolveEggLedgerSection, type EggLedgerContext, type RawEggLedgerSection } from "./eggLedgerResolve";
import { resolveFeedBox, type FeedBoxContext, type RawFeedBox } from "./feedBoxResolve";
import { writeEggLedgerSection, writeFeedBox } from "./writeLedgerFeed";
import type { EggStockSection } from "../eggstock-types";
import type { FlockGroup } from "./ledgerFeedExtraction";

// Orchestrates the SEPARATE, best-effort egg-ledger/feed-box step (owner
// request, 2026-10-19) — called by app/upload/actions.ts strictly AFTER
// the Daily Production save has already committed. Every failure (the
// vision call itself, a write, anything) is caught by the caller, which
// never lets this affect the Daily Production result; this module's own
// job is just to do the work and report what happened.

export interface FlockSectionTotals {
  // Flocks actually matched to a daily_production row THIS upload, for the
  // "main" (big ledger / BAB-1-7 feed box) or "continuation" (small ledger /
  // BAB-8-10 feed box) side of the page — never guessed from a label range,
  // same reasoning as daily_egg_stock_summary_flocks / daily_feed_bag_stock_flocks.
  flockIds: string[];
  eggsSum: number | null; // null when flockIds is empty
  feedBagsSum: number | null;
}

export interface LedgerFeedResult {
  eggAutoCorrections: { section: EggStockSection; note: string }[];
  eggFlags: { section: EggStockSection; flagReason: string }[];
  feedAutoCorrections: { flockGroup: FlockGroup; note: string }[];
  feedFlags: { flockGroup: FlockGroup; flagReason: string }[];
  pageNotes: string | null;
}

export async function extractAndSaveLedgerFeed(
  farmCode: string,
  date: string,
  photoUrl: string | null,
  photoBase64: string,
  photoMediaType: string,
  main: FlockSectionTotals,
  continuation: FlockSectionTotals
): Promise<LedgerFeedResult> {
  const extraction = await extractLedgerAndFeed(photoBase64, photoMediaType);

  const result: LedgerFeedResult = {
    eggAutoCorrections: [],
    eggFlags: [],
    feedAutoCorrections: [],
    feedFlags: [],
    pageNotes: extraction.page_notes,
  };

  await withTransaction(async (client) => {
    for (const ledger of extraction.egg_ledgers) {
      const totals = ledger.section === "big" ? main : continuation;
      const { rows: prevRows } = await client.query(
        `SELECT closing_balance_eggs FROM daily_egg_stock_summary
          WHERE farm_code = $1 AND section = $2 AND date < $3
            AND closing_balance_eggs IS NOT NULL AND deleted_at IS NULL
          ORDER BY date DESC LIMIT 1`,
        [farmCode, ledger.section, date]
      );
      const context: EggLedgerContext = {
        flockEggsSum: totals.eggsSum,
        previousClosingBalanceEggs: prevRows[0]?.closing_balance_eggs ?? null,
      };
      const raw: RawEggLedgerSection = {
        section: ledger.section,
        openingBalanceEggs: ledger.opening_balance_eggs,
        totalEggsProduced: ledger.total_eggs_produced,
        totalLineEggs: ledger.total_line_eggs,
        deductions: ledger.deductions.map((d) => ({
          labelAsWritten: d.label_as_written,
          amountEggs: d.amount_eggs,
          categoryGuess: d.category_guess,
          confidence: d.confidence,
        })),
        closingBalanceEggs: ledger.closing_balance_eggs,
      };
      const resolved = resolveEggLedgerSection(raw, context);
      const written = await writeEggLedgerSection(client, farmCode, date, photoUrl, resolved, totals.flockIds);
      if (resolved.autoCorrectionNote) {
        result.eggAutoCorrections.push({ section: ledger.section, note: resolved.autoCorrectionNote });
      }
      if (written.flagged && written.flagReason) {
        result.eggFlags.push({ section: ledger.section, flagReason: written.flagReason });
      }
    }

    for (const box of extraction.feed_boxes) {
      // "ALL" (the one feed box of the current register) and "BAB-1-7" cover the main (right-page) table; only the old "BAB-8-10" box covers the continuation table
      const totals = box.flock_group === "BAB-8-10" ? continuation : main;
      const { rows: prevRows } = await client.query(
        `SELECT closing_balance_bags FROM daily_feed_bag_stock
          WHERE farm_code = $1 AND flock_group = $2 AND date < $3
            AND closing_balance_bags IS NOT NULL AND deleted_at IS NULL
          ORDER BY date DESC LIMIT 1`,
        [farmCode, box.flock_group, date]
      );
      const context: FeedBoxContext = {
        flockFeedBagsSum: totals.feedBagsSum,
        previousClosingBalanceBags: prevRows[0]?.closing_balance_bags ?? null,
      };
      const raw: RawFeedBox = {
        flockGroup: box.flock_group,
        openingBalanceBags: box.opening_balance_bags,
        producedBags: box.produced_bags,
        totalBags: box.total_bags,
        closingBalanceBags: box.closing_balance_bags,
        consumedBags: box.consumed_bags,
        millInventoryBags: box.mill_inventory_bags,
        shedInventoryBags: box.shed_inventory_bags,
      };
      const resolved = resolveFeedBox(raw, context);
      const written = await writeFeedBox(client, farmCode, date, photoUrl, resolved, totals.flockIds);
      if (resolved.autoCorrectionNote) {
        result.feedAutoCorrections.push({ flockGroup: box.flock_group, note: resolved.autoCorrectionNote });
      }
      if (written.flagged && written.flagReason) {
        result.feedFlags.push({ flockGroup: box.flock_group, flagReason: written.flagReason });
      }
    }
  });

  return result;
}
