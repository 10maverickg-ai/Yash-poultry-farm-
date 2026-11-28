export type ColType = "date" | "int" | "num" | "text" | "pct" | "auto" | "percent"; // auto (V15): a number stays a number, a YYYY-MM-DD text becomes a date, anything else is text; percent (V18): a fraction shown with a % format in Excel (75.3 in a CSV)
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
  // (V18: `index` = the row's position in `rows`, so a formula never depends on where the table starts on the sheet)
  formulas?: Record<string, (row: number, index: number) => string | null>;
  /** V18: cells of an "auto" column that hold a percentage (a fraction): Excel shows them with a % format, a CSV writes × 100. */
  percentCells?: (rowIndex: number, key: string) => boolean;
  /** V18: cells of an "auto" column that hold a ratio with 2 decimals (FCR, eggs per kg). */
  ratioCells?: (rowIndex: number, key: string) => boolean;
}
