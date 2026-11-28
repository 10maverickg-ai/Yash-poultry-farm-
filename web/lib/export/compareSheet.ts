// The Compare sheet (V15), PURE so the V18 share file can build it from the same rows (no database here).
import type { CompareRow, CompareState, SideResult } from "@/lib/analytics/compare";
import type { Dataset } from "./types";

export const HD_NOTE = "HD % = eggs ÷ bird-days × 100. The totals row pools it (total eggs ÷ total bird-days); it is not an average of daily percentages.";

/** The Compare sheet from the two columns and the rows to show (V18: the share file passes only the ticked groups). Pure. */
export function compareSheet(A: SideResult, B: SideResult, st: CompareState, rows: CompareRow[], opts: { money?: boolean } = {}): Dataset {
  const money = opts.money ?? true;
  const numeric = (r: CompareRow) => typeof r.a === "number" && typeof r.b === "number" && r.fmt !== "date" && r.fmt !== "text";
  const name = (x: typeof A) => `${x.side.key.toUpperCase()}: ${x.side.flockLabel}, ${x.side.range.label}`;
  const unit = (r: CompareRow) => (r.fmt === "pct1" || r.fmt === "pct2" ? "%" : r.fmt === "inr" || r.fmt === "inr2" ? "₹" : r.fmt === "age" ? "days" : "");
  return {
    name: "Compare",
    title: `Compare — ${name(A)} against ${name(B)}${st.age && st.weeks ? ` (weeks ${st.weeks.from}–${st.weeks.to} of age)` : ""}`,
    columns: [
      { key: "group", header: "Group", type: "text", width: 16 },
      { key: "measure", header: "Measure", type: "text", width: 40 },
      { key: "a", header: name(A), type: "auto", width: 22 },
      { key: "b", header: name(B), type: "auto", width: 22 },
      { key: "diff", header: "Difference (B − A)", type: "num", width: 16 },
      { key: "diffPct", header: "Difference % of A", type: "num", width: 14 },
      { key: "unit", header: "Unit", type: "text", width: 7 },
      { key: "verdict", header: "B is", type: "text", width: 14 },
      { key: "why", header: "Why blank / note", type: "text", width: 50 },
    ],
    rows: rows.map((r) => ({
      group: r.group,
      measure: r.label,
      a: r.a,
      b: r.b,
      diff: r.diff,
      diffPct: r.diffPct,
      unit: unit(r),
      verdict: r.diff == null ? "" : Math.abs(r.diff) < 1e-9 ? "the same" : r.good == null ? (r.diff > 0 ? "higher" : "lower") : r.good ? "better" : "worse",
      why: [r.aNote ? `A: ${r.aNote}` : "", r.bNote ? `B: ${r.bNote}` : "", r.note ?? ""].filter(Boolean).join(" "),
    })),
    notes: [
      `${name(A)}: ${A.s.dataNote}.${A.coverageNote ? ` ${A.coverageNote}` : ""}`,
      `${name(B)}: ${B.s.dataNote}.${B.coverageNote ? ` ${B.coverageNote}` : ""}`,
      ...st.notes,
      ...st.a.notes.map((x) => `A: ${x}`),
      ...st.b.notes.map((x) => `B: ${x}`),
      "Each column is worked out on its own (its own flock and dates). Difference = B − A, written as a formula; % = difference ÷ A.",
      HD_NOTE.replace(" The totals row pools it (total eggs ÷ total bird-days);", ";"),
      money
        ? "One flock: its own birds and eggs only. Sales, costs, profit and the egg-ledger breakage are farm-level, not split by flock (blank). Profit is an estimate; missing costs are missing, not zero."
        : "One flock: its own birds and eggs only. The egg-ledger breakage is farm-level, not split by flock (blank).",
    ],
    formulas: {
      diff: (row, i) => (numeric(rows[i]) ? `IF(AND(ISNUMBER(C${row}),ISNUMBER(D${row})),D${row}-C${row},"")` : null),
      diffPct: (row, i) => (numeric(rows[i]) ? `IF(AND(ISNUMBER(C${row}),ISNUMBER(D${row}),C${row}<>0),(D${row}-C${row})/ABS(C${row})*100,"")` : null),
    },
  };
}
