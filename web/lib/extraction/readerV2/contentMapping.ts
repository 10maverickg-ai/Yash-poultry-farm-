import type { Section } from "../pageChecksum";
import type { EggStockSection } from "../../eggstock-types";
import type { ExtractedEggLedgerRegion } from "./ledgerRegion";
import type { ExtractedChickRows } from "./chickRowsRegion";
import type { HalfFeedBox, HalfSide, PageHalfExtraction } from "./pageHalfRegion";

// Owner request, 2026-10-21 (Aug 8 run — page upside down inside the
// pipeline): "do not hard-code left=feed, right=flock ... map by content,
// not by side." Every half is read with the same content-agnostic call;
// everything below decides what a result IS from what it contains, never
// from which half it came from.

export interface HalfResult {
  side: HalfSide;
  extraction: PageHalfExtraction;
}

export function halfFlockCount(e: PageHalfExtraction): number {
  return e.table?.flocks.length ?? 0;
}

// Total recognisable items on a half — used to pick the better of two
// orientation attempts.
export function halfContentCount(e: PageHalfExtraction): number {
  return halfFlockCount(e) + (e.ledger ? 1 : 0) + e.feedBoxes.length;
}

// Owner rule, 2026-10-21: a half is "empty" when it returned no flocks AND
// no ledger AND no feed box (chick rows alone don't count as a readable
// page). An empty half is the signal that the photo is probably the wrong
// way up.
export function isHalfEmpty(e: PageHalfExtraction): boolean {
  return halfFlockCount(e) === 0 && !e.ledger && e.feedBoxes.length === 0;
}

function firstNumberIn(label: string): number {
  const m = label.match(/\d+/);
  return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER;
}

function minLabelNumber(e: PageHalfExtraction): number {
  const nums = (e.table?.flocks ?? []).map((f) => firstNumberIn(f.display_label_as_written));
  return nums.length > 0 ? Math.min(...nums) : Number.MAX_SAFE_INTEGER;
}

// Which table is the "main" (longer, BAB-1 onward) one and which the
// "continuation" (shorter) — decided by what each table CONTAINS: more
// flocks wins; a tie goes to the table holding the lower-numbered label.
// A day with a single table has a main table only (same meaning the
// reader has always given a single-table page).
export function assignTableSections(halves: HalfResult[]): Map<HalfSide, Section> {
  const withTable = halves.filter((h) => halfFlockCount(h.extraction) > 0);
  const result = new Map<HalfSide, Section>();
  if (withTable.length === 0) return result;
  if (withTable.length === 1) {
    result.set(withTable[0].side, "main");
    return result;
  }
  const [a, b] = withTable;
  const aCount = halfFlockCount(a.extraction);
  const bCount = halfFlockCount(b.extraction);
  let aIsMain: boolean;
  if (aCount !== bCount) aIsMain = aCount > bCount;
  else aIsMain = minLabelNumber(a.extraction) <= minLabelNumber(b.extraction);
  result.set(a.side, aIsMain ? "main" : "continuation");
  result.set(b.side, aIsMain ? "continuation" : "main");
  return result;
}

export interface LedgerWithSide {
  side: HalfSide;
  ledger: ExtractedEggLedgerRegion;
}

// An egg ledger sits directly under its own table's subtotal, so a
// ledger takes the role of the table on the SAME half: under the main
// table = the big ledger, under the continuation table = the small one.
// A ledger on a half with no table of its own takes whichever section is
// still free (big first).
export function assignLedgerSections(
  halves: HalfResult[],
  tableSections: Map<HalfSide, Section>
): Map<EggStockSection, LedgerWithSide> {
  const result = new Map<EggStockSection, LedgerWithSide>();
  const orphans: LedgerWithSide[] = [];
  for (const h of halves) {
    const ledger = h.extraction.ledger;
    if (!ledger) continue;
    const tableSection = tableSections.get(h.side);
    if (tableSection) {
      result.set(tableSection === "main" ? "big" : "small", { side: h.side, ledger });
    } else {
      orphans.push({ side: h.side, ledger });
    }
  }
  for (const orphan of orphans) {
    const free: EggStockSection | null = !result.has("big") ? "big" : !result.has("small") ? "small" : null;
    if (free) result.set(free, orphan);
  }
  return result;
}

export interface FeedBoxWithSide {
  side: HalfSide;
  box: HalfFeedBox;
}

export function collectFeedBoxes(halves: HalfResult[]): FeedBoxWithSide[] {
  return halves.flatMap((h) => h.extraction.feedBoxes.map((box) => ({ side: h.side, box })));
}

export function pickChickRows(halves: HalfResult[]): ExtractedChickRows | null {
  let best: ExtractedChickRows | null = null;
  for (const h of halves) {
    const c = h.extraction.chickRows;
    if (!c || c.rows.length === 0) continue;
    if (!best || c.rows.length > best.rows.length) best = c;
  }
  return best;
}

// The page date, as read at full resolution from whichever half shows it
// (highest confidence wins).
export function pickDate(halves: HalfResult[]): { date: string | null; confidence: number } {
  let best: { date: string | null; confidence: number } = { date: null, confidence: 0 };
  for (const h of halves) {
    const e = h.extraction;
    if (e.page_date && (best.date === null || e.page_date_confidence > best.confidence)) {
      best = { date: e.page_date, confidence: e.page_date_confidence };
    }
  }
  return best;
}
