export type ColType = "date" | "int" | "num" | "text" | "pct";
export interface Col {
  key: string;
  header: string;
  type: ColType;
  width?: number;
  total?: boolean; // gets a SUM formula in the totals row
}
export interface Dataset {
  name: string; // sheet name and file stem
  title: string;
  columns: Col[];
  rows: Record<string, string | number | null>[];
  notes: string[]; // printed under the table (estimates, missing inputs)
  // Optional per-row formula columns: key -> (rowNumber) => formula text without "="
  formulas?: Record<string, (row: number) => string>;
}
