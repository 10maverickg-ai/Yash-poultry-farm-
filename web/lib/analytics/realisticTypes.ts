// Types for the "realistic target" learned from the farm's own records (V10, seasons and deaths in V11). Types only, so
// the engine can refer to them without importing the learning code.
export type RGroup = "main" | "young";
export type RMetric = "hd" | "feed" | "mortality";
/** Punjab season (month map in REALISTIC_CONFIG.seasonByMonth). "all" = learned from every season together. */
export type Season = "HOT" | "MONSOON" | "COOL" | "COLD" | "SPRING";
export type SeasonKey = Season | "all";

export interface RealisticOverride {
  group: RGroup;
  metric: RMetric;
  bandStart: number; // first age week of the 5-week band
  /** HD and feed: "our realistic level = ratioPct % of the breeder's book". Deaths (V11): "our usual level = ratioPct % of birds per week". Applies to every season of the band. */
  ratioPct: number;
  note?: string | null;
}

export interface RealisticBand {
  group: RGroup;
  metric: RMetric;
  season: SeasonKey;
  band: number; // index
  fromWeek: number;
  toWeek: number;
  daysSeen: number; // all flock-days of this group (and season) in the band, healthy or not
  healthyDays: number; // healthy flock-days that fall in the band
  flocks: number; // different flocks they come from
  dateFrom: string | null;
  dateTo: string | null;
  samples: number; // 7-day rolling healthy-day values used for the percentile
  // HD and feed: ratio to the book (fraction), capped at 1. Deaths: null (see learnedRate).
  learnedRatio: number | null;
  override: number | null; // owner's ratio (fraction of the book), if set (HD, feed)
  ratio: number | null; // what is used: override if set, else learned
  // Deaths only: percent of birds per week, the 70th percentile of weekly death rates.
  learnedRate: number | null;
  overrideRate: number | null;
  rate: number | null;
  notLearnedReason: string | null;
  source: "learned" | "owner" | "none";
}

export interface RealisticModel {
  asOf: string;
  bands: RealisticBand[];
}
