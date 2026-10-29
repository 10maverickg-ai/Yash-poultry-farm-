// Client-safe types/constants for the egg stock ledger — no pg import, so
// client components can use these without dragging node-postgres into the
// browser bundle.

export const ENTRY_CATEGORIES = [
  "sale",
  "local_sale",
  "breakage",
  "labour_take",
  "gift",
  "cross_farm_adjustment",
  "production_addition",
  "other",
] as const;
export type EntryCategory = (typeof ENTRY_CATEGORIES)[number];

// The farm runs TWO parallel ledgers on the same page (owner-confirmed,
// 2026-10-19): "big" under the BAB-1..8 table (right page), "small" under the BAB-9..11
// table (left page; since 27 Oct 2026, was BAB-1..7 / BAB-8..10) — see migration 0020.
export const EGG_STOCK_SECTIONS = ["small", "big"] as const;
export type EggStockSection = (typeof EGG_STOCK_SECTIONS)[number];

export interface EggStockEntry {
  id: number;
  sequence_order: number;
  label_as_written: string;
  category: EntryCategory | null;
  amount_eggs: number;
  amount_eggs_original: number | null;
  auto_correction_note: string | null;
  running_balance_after: number | null;
  linked_sale_id: number | null;
}

export interface EggStockSectionSummary {
  id: number;
  section: EggStockSection;
  opening_balance_eggs: number | null;
  opening_balance_eggs_original: number | null;
  total_eggs_produced: number | null;
  total_eggs_produced_original: number | null;
  total_line_eggs: number | null;
  total_line_eggs_original: number | null;
  grade_13_eggs: number | null;
  grade_14_eggs: number | null;
  grade_15_eggs: number | null;
  grade_15plus_eggs: number | null;
  closing_balance_eggs: number | null;
  closing_balance_eggs_original: number | null;
  closing_balance_trays: string | null; // pg numeric
  auto_correction_note: string | null;
  flagged: boolean;
  flag_reason: string | null;
}

export interface ActiveEggFlockOption {
  flock_internal_id: string;
  display_label: string;
  eggs_total: number | null;
}

export interface EggStockSectionDay {
  section: EggStockSection;
  summary: EggStockSectionSummary | null;
  entries: EggStockEntry[];
  // SUM of eggs_total for THIS section's linked flocks on this date (null
  // if nothing linked yet) — the check 4 cross-check.
  linkedProductionSum: number | null;
  // Most recent earlier day's closing balance for this SAME section.
  previousClosing: number | null;
  linkedFlockIds: string[];
}

export interface EggStockDay {
  sections: EggStockSectionDay[]; // always both "small" and "big", one card each even if unsaved
  activeFlocks: ActiveEggFlockOption[];
}

export interface SaleRow {
  id: number;
  date: string;
  transaction_type: string | null;
  buyer_or_recipient: string | null;
  grade: string | null;
  eggs_quantity: number | null;
  trays_quantity: string | null; // pg numeric
  price_per_unit: string | null;
  amount: string | null;
  recipient: string | null; // who got the eggs (V12): farmfresh | local | yash_12 | ... — never changes the price
}
