// Client-safe types/constants for the egg stock ledger — no pg import, so
// client components can use these without dragging node-postgres into the
// browser bundle.

export const ENTRY_CATEGORIES = [
  "sale",
  "breakage",
  "gift",
  "cross_farm_adjustment",
  "production_addition",
  "other",
] as const;
export type EntryCategory = (typeof ENTRY_CATEGORIES)[number];

export interface EggStockEntry {
  id: number;
  sequence_order: number;
  label_as_written: string;
  category: EntryCategory | null;
  amount_eggs: number;
  running_balance_after: number | null;
  linked_sale_id: number | null;
}

export interface EggStockDay {
  summary: null | {
    id: number;
    total_eggs_produced: number | null;
    grade_13_eggs: number | null;
    grade_14_eggs: number | null;
    grade_15_eggs: number | null;
    grade_15plus_eggs: number | null;
    closing_balance_eggs: number | null;
    closing_balance_trays: string | null; // pg numeric
    flagged: boolean;
    flag_reason: string | null;
  };
  entries: EggStockEntry[];
  productionSum: number | null; // SUM of that date's daily_production.eggs_total
  previousClosing: number | null; // most recent earlier day's closing balance
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
}
