import { findSingleDigitRepair, type RepairField, type RepairCheck } from "./digitRepair";

// Feed bag box resolution (owner request, 2026-10-19): the five checks from
// the owner's spec, run per box (e.g. "BAB-1-7" / "BAB-8-10"), same
// single-digit-repair-or-flag philosophy as eggLedgerResolve.ts. No
// multiple-of-30 rule here — bags aren't trays. Pure, no database.

export interface RawFeedBox {
  flockGroup: string;
  openingBalanceBags: number | null;
  producedBags: number | null;
  totalBags: number | null;
  // The register's "(−)" line — the CLOSING balance in stock, from which
  // consumption is derived (total − closing = consumed).
  closingBalanceBags: number | null;
  consumedBags: number | null;
  millInventoryBags: number | null; // F
  shedInventoryBags: number | null; // S
}

export interface FeedBoxContext {
  // Sum of feed_bags for the flocks linked to this group on this date, or
  // null if there's nothing to compare against yet.
  flockFeedBagsSum: number | null;
  // The previous day's closing balance for the SAME flock_group, or null
  // if there's no previous day saved.
  previousClosingBalanceBags: number | null;
}

export interface ResolvedFeedBox {
  flockGroup: string;
  openingBalanceBags: number | null;
  openingBalanceBagsOriginal: number | null;
  producedBags: number | null;
  producedBagsOriginal: number | null;
  totalBags: number | null;
  totalBagsOriginal: number | null;
  consumedBags: number | null;
  consumedBagsOriginal: number | null;
  millInventoryBags: number | null;
  millInventoryBagsOriginal: number | null;
  shedInventoryBags: number | null;
  shedInventoryBagsOriginal: number | null;
  closingBalanceBags: number | null;
  closingBalanceBagsOriginal: number | null;
  autoCorrectionNote: string | null;
}

const DB_FIELD_NAME: Record<string, string> = {
  opening: "opening_balance_bags",
  produced: "produced_bags",
  total: "total_bags",
  consumed: "consumed_bags",
  mill: "mill_inventory_bags",
  shed: "shed_inventory_bags",
  closing: "closing_balance_bags",
};

export function resolveFeedBox(raw: RawFeedBox, context: FeedBoxContext): ResolvedFeedBox {
  const fields: RepairField[] = [
    { name: "opening", value: raw.openingBalanceBags },
    { name: "produced", value: raw.producedBags },
    { name: "total", value: raw.totalBags },
    { name: "consumed", value: raw.consumedBags },
    { name: "mill", value: raw.millInventoryBags },
    { name: "shed", value: raw.shedInventoryBags },
    { name: "closing", value: raw.closingBalanceBags },
  ];

  const checks: RepairCheck[] = [];

  // Check 1: OB + produced = total.
  if (raw.openingBalanceBags !== null && raw.producedBags !== null && raw.totalBags !== null) {
    checks.push((v) => (v.opening as number) + (v.produced as number) === v.total);
  }

  // Check 2: total − closing = consumed.
  if (raw.totalBags !== null && raw.closingBalanceBags !== null && raw.consumedBags !== null) {
    checks.push((v) => (v.total as number) - (v.closing as number) === v.consumed);
  }

  // Check 3: F + S = closing.
  if (raw.millInventoryBags !== null && raw.shedInventoryBags !== null && raw.closingBalanceBags !== null) {
    checks.push((v) => (v.mill as number) + (v.shed as number) === v.closing);
  }

  // Check 4: consumed equals the linked flocks' own feed_bags sum. Fixed
  // comparison target — can only ever be "repaired" by changing THIS box's
  // own consumed figure, never Daily Production.
  if (context.flockFeedBagsSum !== null && raw.consumedBags !== null) {
    checks.push((v) => v.consumed === context.flockFeedBagsSum);
  }

  // Check 5: OB equals the previous day's closing for the SAME group.
  // Fixed comparison target — never the previous day's row.
  if (context.previousClosingBalanceBags !== null && raw.openingBalanceBags !== null) {
    checks.push((v) => v.opening === context.previousClosingBalanceBags);
  }

  const repair = findSingleDigitRepair(fields, checks);

  let openingBalanceBags = raw.openingBalanceBags;
  let openingBalanceBagsOriginal: number | null = null;
  let producedBags = raw.producedBags;
  let producedBagsOriginal: number | null = null;
  let totalBags = raw.totalBags;
  let totalBagsOriginal: number | null = null;
  let consumedBags = raw.consumedBags;
  let consumedBagsOriginal: number | null = null;
  let millInventoryBags = raw.millInventoryBags;
  let millInventoryBagsOriginal: number | null = null;
  let shedInventoryBags = raw.shedInventoryBags;
  let shedInventoryBagsOriginal: number | null = null;
  let closingBalanceBags = raw.closingBalanceBags;
  let closingBalanceBagsOriginal: number | null = null;
  let autoCorrectionNote: string | null = null;

  if (repair) {
    const reasoning = `the only single-digit change that makes the ${raw.flockGroup} feed box's own arithmetic balance exactly`;
    switch (repair.field) {
      case "opening":
        openingBalanceBagsOriginal = repair.from;
        openingBalanceBags = repair.to;
        break;
      case "produced":
        producedBagsOriginal = repair.from;
        producedBags = repair.to;
        break;
      case "total":
        totalBagsOriginal = repair.from;
        totalBags = repair.to;
        break;
      case "consumed":
        consumedBagsOriginal = repair.from;
        consumedBags = repair.to;
        break;
      case "mill":
        millInventoryBagsOriginal = repair.from;
        millInventoryBags = repair.to;
        break;
      case "shed":
        shedInventoryBagsOriginal = repair.from;
        shedInventoryBags = repair.to;
        break;
      case "closing":
        closingBalanceBagsOriginal = repair.from;
        closingBalanceBags = repair.to;
        break;
    }
    autoCorrectionNote = `${DB_FIELD_NAME[repair.field]} ${repair.from} corrected to ${repair.to}: ${reasoning}.`;
  }

  return {
    flockGroup: raw.flockGroup,
    openingBalanceBags,
    openingBalanceBagsOriginal,
    producedBags,
    producedBagsOriginal,
    totalBags,
    totalBagsOriginal,
    consumedBags,
    consumedBagsOriginal,
    millInventoryBags,
    millInventoryBagsOriginal,
    shedInventoryBags,
    shedInventoryBagsOriginal,
    closingBalanceBags,
    closingBalanceBagsOriginal,
    autoCorrectionNote,
  };
}
