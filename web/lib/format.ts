// One set of number and date formats for every screen: Indian digit grouping (1,23,456; ₹1,18,27,752)
// and dates as DD Mon YYYY (26 Oct 2026).
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const n0 = (x: number | null | undefined): string => (x == null || Number.isNaN(x) ? "–" : Math.round(x).toLocaleString("en-IN"));
export const n1 = (x: number | null | undefined): string => (x == null || Number.isNaN(x) ? "–" : (Math.round(x * 10) / 10).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 1 }));
export const n2 = (x: number | null | undefined): string => (x == null || Number.isNaN(x) ? "–" : x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const inr = (x: number | null | undefined): string => (x == null || Number.isNaN(x) ? "–" : x < 0 ? `−₹${n0(-x)}` : `₹${n0(x)}`);

/** "2026-10-26" -> "26 Oct 2026" */
export function dmy(d: string | null | undefined): string {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return "–";
  return `${d.slice(8, 10)} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
}
/** "2026-10-26" -> "Mon 26 Oct 2026" */
export function dmyw(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(d)) return "–";
  return `${DOW[new Date(d.slice(0, 10) + "T00:00:00Z").getUTCDay()]} ${dmy(d)}`;
}
/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b.slice(0, 10) + "T00:00:00Z") - Date.parse(a.slice(0, 10) + "T00:00:00Z")) / 86400000);
