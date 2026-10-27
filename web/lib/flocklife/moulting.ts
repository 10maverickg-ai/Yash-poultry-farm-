// Moulting feed schedule (owner, V5 7.2), grams per bird per day:
//   days 1-5 none (hens may still lay) · 6-8 30 g · 9-11 40 g · 12-14 50 g ·
//   15-17 60 g · 18-19 70 g · 20-21 80 g · 22-23 90 g · then 100 g for 3-4 days
//   until body weight is corrected · then normal feed.
export interface MoultDay {
  day: number;
  grams: number | null; // null = back to normal feed
  label: string;
}

export function moultFeedForDay(day: number): MoultDay {
  if (day < 1) return { day, grams: null, label: "not started" };
  if (day <= 5) return { day, grams: 0, label: "no feed (hens may still lay)" };
  if (day <= 8) return { day, grams: 30, label: "30 g per bird" };
  if (day <= 11) return { day, grams: 40, label: "40 g per bird" };
  if (day <= 14) return { day, grams: 50, label: "50 g per bird" };
  if (day <= 17) return { day, grams: 60, label: "60 g per bird" };
  if (day <= 19) return { day, grams: 70, label: "70 g per bird" };
  if (day <= 21) return { day, grams: 80, label: "80 g per bird" };
  if (day <= 23) return { day, grams: 90, label: "90 g per bird" };
  if (day <= 27) return { day, grams: 100, label: "100 g per bird until body weight is corrected (3–4 days)" };
  return { day, grams: null, label: "back to normal feed" };
}

/** Bags (45 kg) the schedule expects for a flock of `birds` on a given moult day, or null on normal feed. */
export function expectedBags(day: number, birds: number): number | null {
  const g = moultFeedForDay(day).grams;
  return g == null ? null : (g * birds) / 1000 / 45;
}

export const dayOfMoult = (start: string, date: string) =>
  Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000) + 1;
