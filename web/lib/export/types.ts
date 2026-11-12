export type ColType = "date" | "int" | "num" | "text" | "pct" | "auto"; // auto (V15): a number stays a number, a YYYY-MM-DD text becomes a date, anything else is text
export interface Col {
  key: string;
  header: string;
  type: ColType;
  width?: number;
  total?: boolean; // gets a SUM formula in the totals row
  // Custom totals-row formula (no leading "="): receives the first/last data row and the column letter of every key
  totalFormula?: (first: number, last: number, letters: Record<string, string>) => string;
}
export interface Dataset {
  name: string; // sheet name and file stem
  title: string;
  columns: Col[];
  rows: Record<string, string | number | null>[];
  notes: string[]; // printed under the table (estimates, missing inputs)
  // Optional per-row formula columns: key -> (rowNumber) => formula text without "=" (null = no formula in that row, the value is written instead)
  formulas?: Record<string, (row: number) => string | null>;
}
