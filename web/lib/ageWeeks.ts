/** Whole weeks between a YYYY-MM-DD date and today. */
export function weeksSince(date: string | Date): number {
  const d = String(date).slice(0, 10);
  return Math.floor((Date.now() - Date.parse(d + "T00:00:00Z")) / 604800000);
}
