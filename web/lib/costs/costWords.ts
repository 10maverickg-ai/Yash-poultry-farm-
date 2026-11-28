// V19 D1 / D3: the plain words next to each overhead number, from where it came from (pure, safe for any screen).
//   "₹40,000 a month (average)", "bill ₹58,180", "included in feed price", "not entered", and the partial-month note.
import type { CostSourceSummary, SourceLine } from "./engine";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthWord = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]}`;
const dm = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;
const rs = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const months = (l: SourceLine) => l.months.map(monthWord).join(", ");

export type OverheadKey = "electricity" | "labour" | "diesel" | "miscellaneous" | "medicine" | "topDressing" | "interest" | "rent";

/** One line of words for one overhead over a period, e.g. "Aug–Oct bill; Nov average ₹40,000 a month". */
export function sourceWords(sum: CostSourceSummary, key: OverheadKey): string {
  const ls = sum[key];
  if (ls.length === 0) return "";
  const one = (l: SourceLine): string => {
    switch (l.source) {
      case "bill": return `${ls.length > 1 ? `${months(l)}: ` : ""}bill${l.monthly != null && l.months.length === 1 ? ` ${rs(l.monthly)}` : ""}`;
      case "average": return `${ls.length > 1 ? `${months(l)}: ` : ""}average ${l.monthly != null ? `${rs(l.monthly)} a month` : ""}`.trim();
      case "entered": return key === "diesel" || key === "medicine" ? `${ls.length > 1 ? `${months(l)}: ` : ""}as entered, on the day bought` : `${ls.length > 1 ? `${months(l)}: ` : ""}${l.monthly != null ? `${rs(l.monthly)} a month` : "entered"}`;
      case "none": return `${ls.length > 1 ? `${months(l)}: ` : ""}none this month (owner)`;
      case "in_feed": return `included in feed price${ls.length > 1 ? ` from ${dm(l.from)}` : ""}`;
      case "missing": return `${ls.length > 1 ? `${l.from === l.to ? dm(l.from) : `${dm(l.from)}–${dm(l.to)}`}: ` : ""}not entered`;
      case "not_entered": return "not entered";
      default: return "";
    }
  };
  return ls.map(one).join("; ");
}

/** True when the whole period has this line with one source (e.g. every day "average"). */
export const onlySource = (sum: CostSourceSummary, key: OverheadKey, source: string) => sum[key].length > 0 && sum[key].every((l) => l.source === source);
export const anySource = (sum: CostSourceSummary, key: OverheadKey, source: string) => sum[key].some((l) => l.source === source);

/**
 * D3: "November is still running: labour, electricity, diesel and miscellaneous are counted for its 28 days so far
 * (monthly amount × 28 ÷ 30)." Only for a month whose counted days are fewer than its days.
 */
export function partialMonthWords(sum: CostSourceSummary, today: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of sum.months) {
    if (m.days >= m.daysInMonth) continue;
    const running = today != null && today.slice(0, 7) === m.month;
    out.push(`${monthWord(m.month)} ${m.month.slice(0, 4)}${running ? " is still running" : " is only partly in these dates"}: the monthly costs (labour, electricity, diesel, miscellaneous) are counted for ${m.days} of its ${m.daysInMonth} days (the monthly amount × ${m.days} ÷ ${m.daysInMonth}), not the full month.`);
  }
  return out;
}
