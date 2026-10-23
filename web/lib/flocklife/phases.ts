// BV300 feed phases by age in weeks (owner, V5 7.3):
//   chick starter -> grower at 400 g body weight (about week 6)
//   grower -> developer at 750 g (about week 10)
//   developer -> pre-lay 14 days before the first egg (lay starts about week 18, so about week 16)
//   pre-lay -> Phase I at 0.5% HD, Phase II from 31 wk, III from 56 wk, IV from 81 wk
// A changeover runs over 10 days: 75/25, 50/50, 25/75, then 100% new feed. The
// owner gave the four steps; spreading them as days 1-3, 4-6, 7-9 and 10 is my
// assumption and is labelled as such on screen.
export interface FeedPhase {
  key: string;
  label: string;
  fromWeek: number;
  note: string;
}

export const PHASES: FeedPhase[] = [
  { key: "chick", label: "Chick starter", fromWeek: 0, note: "until about 400 g body weight (about week 6)" },
  { key: "grower", label: "Grower", fromWeek: 6, note: "until about 750 g (about week 10)" },
  { key: "developer", label: "Developer", fromWeek: 10, note: "until 14 days before the first egg (about week 16)" },
  { key: "prelay", label: "Pre-lay", fromWeek: 16, note: "until 0.5% HD (about week 18–19)" },
  { key: "phase1", label: "Layer Phase I", fromWeek: 19, note: "to week 31" },
  { key: "phase2", label: "Layer Phase II", fromWeek: 31, note: "to week 56" },
  { key: "phase3", label: "Layer Phase III", fromWeek: 56, note: "to week 81" },
  { key: "phase4", label: "Layer Phase IV", fromWeek: 81, note: "from week 81" },
];

export function phaseForAge(ageWeeks: number): FeedPhase {
  let cur = PHASES[0];
  for (const p of PHASES) if (ageWeeks >= p.fromWeek) cur = p;
  return cur;
}

/** If the next phase starts within `lookDays`, the changeover steps with their dates (assumed split 3/3/3/1 days). */
export function changeover(ageDays: number, lookDays = 10): { to: FeedPhase; startsInDays: number } | null {
  const ageWeeks = ageDays / 7;
  const next = PHASES.find((p) => p.fromWeek > ageWeeks);
  if (!next) return null;
  const startsInDays = Math.ceil(next.fromWeek * 7 - ageDays);
  return startsInDays <= lookDays ? { to: next, startsInDays } : null;
}

export const CHANGEOVER_STEPS = [
  { days: "days 1–3", mix: "75% old / 25% new" },
  { days: "days 4–6", mix: "50% / 50%" },
  { days: "days 7–9", mix: "25% old / 75% new" },
  { days: "day 10", mix: "100% new" },
];
