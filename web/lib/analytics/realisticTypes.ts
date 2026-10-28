// Types for the "realistic target" learned from the farm's own records (V10). Types only, so the engine can
// refer to them without importing the learning code.
export type RGroup = "main" | "young";
export type RMetric = "hd" | "feed" | "mortality";

export interface RealisticOverride {
  group: RGroup;
  metric: RMetric;
  bandStart: number; // first age week of the 5-week band
  ratioPct: number; // "our realistic level = ratioPct % of the breeder's book" typed by the owner
  note?: string | null;
}

export interface RealisticBand {
  group: RGroup;
  metric: RMetric;
  band: number; // index
  fromWeek: number;
  toWeek: number;
  daysSeen: number; // all flock-days of this group in the band, healthy or not
  healthyDays: number; // healthy flock-days that fall in the band
  flocks: number; // different flocks they come from
  dateFrom: string | null;
  dateTo: string | null;
  samples: number; // 7-day rolling healthy-day values used for the percentile
  learnedRatio: number | null; // percentile of the rolling ratios, capped (HD, feed ≤ 1; mortality ≥ 1); null = not learned
  notLearnedReason: string | null;
  override: number | null; // owner's ratio (fraction of the book), if set
  ratio: number | null; // what is used: override if set, else learned
  source: "learned" | "owner" | "none";
}

export interface RealisticModel {
  asOf: string;
  bands: RealisticBand[];
}
