// Import of OLD paper-register days (K5). Pure functions: parse a table (CSV text or rows read from Excel), check every
// row, and say what would happen. No database, no reader/Anthropic. The page and the server action call these.
export const IMPORT_SOURCE_TAG = "paper history import";

export interface ImportRow {
  line: number; // line in the file (header = 1)
  date: string | null;
  flockLabel: string;
  eggs: number | null;
  birds: number | null;
  mortality: number | null;
  feedBags: number | null;
  raw: string[];
}
export interface ImportFlock { id: string; label: string; big: boolean } // big = lays big eggs (trays of 30)
export type RowState = "ok" | "exists" | "error";
export interface RowResult {
  row: ImportRow;
  flockId: string | null;
  state: RowState;
  errors: string[];
  warnings: string[];
}
export interface ImportReport {
  results: RowResult[];
  columnsFound: string[];
  columnProblems: string[];
  counts: { total: number; ok: number; exists: number; error: number };
}

/** Minimal CSV reader: commas or semicolons or tabs, quoted cells, CRLF. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const first = t.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const HEADERS: Record<string, string[]> = {
  date: ["date", "day", "tarikh"],
  flock: ["flock", "flock label", "label", "flock name", "shed"],
  eggs: ["eggs", "total eggs", "eggs total", "eggs_total"],
  birds: ["birds", "bird population", "bird_population", "population", "balance birds", "bal birds"],
  mortality: ["mortality", "deaths", "dead", "death"],
  feed: ["feed bags", "feed", "feed_bags", "bags", "feed bag"],
};
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** ISO date from 2026-10-05, 05/10/2026, 5-10-2026, 5.10.2026 or an Excel serial number. Day first (India). */
export function parseDate(v: string): string | null {
  const s = v.trim();
  let y: number, m: number, d: number;
  let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
  else if (/^\d{5}$/.test(s)) { const t = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate(); }
  else return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const intOrNull = (v: string | undefined): number | null | "bad" => {
  const s = (v ?? "").trim().replace(/,/g, "");
  if (s === "") return null;
  return /^\d+$/.test(s) ? Number(s) : "bad";
};

/** Turn a table (first row = headers) into rows. Unknown columns are ignored. */
export function readTable(table: string[][]): { rows: ImportRow[]; columnsFound: string[]; columnProblems: string[] } {
  const problems: string[] = [];
  if (table.length === 0) return { rows: [], columnsFound: [], columnProblems: ["The file is empty."] };
  const head = table[0].map(norm);
  const col: Record<string, number> = {};
  for (const [k, names] of Object.entries(HEADERS)) {
    const i = head.findIndex((h) => names.includes(h));
    if (i >= 0) col[k] = i;
  }
  for (const need of ["date", "flock", "eggs"]) if (col[need] == null) problems.push(`Column "${need === "flock" ? "flock label" : need}" not found.`);
  if (col.birds == null && col.mortality == null) problems.push('Give either a "birds" column or a "mortality" column (best: both).');
  const rows: ImportRow[] = [];
  const bad: string[] = [];
  table.slice(1).forEach((cells, i) => {
    const get = (k: string) => (col[k] == null ? undefined : cells[col[k]]);
    const line = i + 2;
    const num = (k: string, label: string) => {
      const r = intOrNull(get(k));
      if (r === "bad") { bad.push(`${line}|${label}`); return null; }
      return r;
    };
    rows.push({
      line,
      date: parseDate(get("date") ?? ""),
      flockLabel: (get("flock") ?? "").trim(),
      eggs: num("eggs", "eggs"),
      birds: num("birds", "birds"),
      mortality: num("mortality", "mortality"),
      feedBags: num("feed", "feed bags"),
      raw: cells,
    });
  });
  // bad number cells become row errors in validateRows via this marker
  (rows as unknown as { _bad?: string[] })._bad = bad;
  return { rows, columnsFound: Object.keys(col), columnProblems: problems };
}

/** Check every row. `existing` = "flockId|YYYY-MM-DD" of days already in the register. */
export function validateRows(
  parsed: { rows: ImportRow[]; columnsFound: string[]; columnProblems: string[] },
  flocks: ImportFlock[],
  existing: Set<string>,
  today: string,
): ImportReport {
  const byLabel = new Map(flocks.map((f) => [norm(f.label), f]));
  const bad = new Map<number, string[]>();
  for (const b of (parsed.rows as unknown as { _bad?: string[] })._bad ?? []) {
    const [line, label] = b.split("|");
    bad.set(Number(line), [...(bad.get(Number(line)) ?? []), `${label} is not a whole number`]);
  }
  const seen = new Set<string>();
  const results: RowResult[] = parsed.rows.map((row) => {
    const errors: string[] = [...(bad.get(row.line) ?? [])];
    const warnings: string[] = [];
    const flock = byLabel.get(norm(row.flockLabel)) ?? null;
    if (!row.date) errors.push("date not understood (use YYYY-MM-DD or DD/MM/YYYY)");
    else if (row.date > today) errors.push(`date ${row.date} is in the future`);
    if (!row.flockLabel) errors.push("flock label is empty");
    else if (!flock) errors.push(`flock "${row.flockLabel}" is not in the app (add it on the Flocks screen first)`);
    if (row.eggs == null && !errors.some((e) => e.startsWith("eggs"))) errors.push("eggs is empty");
    if (row.birds == null && row.mortality == null) errors.push("give birds or mortality");
    if (row.birds == null && row.mortality != null) warnings.push("no birds count: this day cannot be used for the realistic target");
    if (row.feedBags == null) warnings.push("no feed bags: this day cannot be used for the feed target");
    if (flock?.big && row.eggs != null && row.eggs % 30 !== 0) errors.push(`eggs ${row.eggs} is not a multiple of 30 (big eggs are counted in trays of 30)`);
    if (row.eggs != null && row.birds != null && row.eggs > row.birds) errors.push(`eggs ${row.eggs} is more than the ${row.birds} birds`);
    let state: RowState = errors.length ? "error" : "ok";
    if (flock && row.date) {
      const k = `${flock.id}|${row.date}`;
      if (seen.has(k)) { errors.push("the same flock and date appear twice in the file"); state = "error"; }
      seen.add(k);
      if (state === "ok" && existing.has(k)) state = "exists";
    }
    return { row, flockId: flock?.id ?? null, state, errors, warnings };
  });
  const c = { total: results.length, ok: 0, exists: 0, error: 0 };
  for (const r of results) c[r.state]++;
  return { results, columnsFound: parsed.columnsFound, columnProblems: parsed.columnProblems, counts: c };
}

export const TEMPLATE_CSV = "date,flock label,eggs,birds,mortality,feed bags\n2025-03-14,BAB-1,5760,6400,2,38\n2025-03-15,BAB-1,5730,6398,3,38\n";
