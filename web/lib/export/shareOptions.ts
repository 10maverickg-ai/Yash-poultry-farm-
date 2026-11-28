// V18 A1b: what can go into a shared Analytics file, how the choice is written in the address, and the file names.
// PURE and safe for the browser (no database, no Node modules): the share page (client) and the file builder (server)
// use the same rules, so the panel says exactly what the file will contain.

export const BLOCKS = ["production", "feed", "mortality", "sales", "costs", "alerts", "flocks", "days"] as const;
export type Block = (typeof BLOCKS)[number];

export const BLOCK_LABEL: Record<Block, string> = {
  production: "Production (eggs, trays, HD %)",
  feed: "Feed intake (bags, g/bird, eggs per kg, feed per egg, FCR)",
  mortality: "Mortality and birds",
  sales: "Sales and revenue",
  costs: "Costs and profit",
  alerts: "Alerts",
  flocks: "Per-flock table",
  days: "Day-by-day table",
};

/** Money blocks are never in a file unless ticked; with chosen flocks they are farm-level and are left out (never hidden). */
export const MONEY: readonly Block[] = ["sales", "costs"];

export type ShareView = "board" | "day" | "week" | "month" | "year" | "custom" | "flock" | "compare";
export const SHARE_VIEWS: readonly ShareView[] = ["board", "day", "week", "month", "year", "custom", "flock", "compare"];
export const VIEW_LABEL: Record<ShareView, string> = {
  board: "Analytics board",
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
  custom: "Custom range",
  flock: "One flock",
  compare: "Compare",
};

/**
 * The ticked blocks from the address: no `inc` at all = everything ticked (the default); `inc=` (empty) = nothing;
 * `inc=all`; or a comma list (`inc=production,feed`). Unknown words are ignored.
 */
export function parseInc(p: string | string[] | undefined): Block[] {
  if (p === undefined) return [...BLOCKS];
  const words = (Array.isArray(p) ? p : [p]).flatMap((x) => x.split(",")).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (words.includes("all")) return [...BLOCKS];
  return BLOCKS.filter((b) => words.includes(b));
}

export const incParam = (inc: readonly Block[]): string => (inc.length === BLOCKS.length ? "all" : BLOCKS.filter((b) => inc.includes(b)).join(","));

/**
 * The sheets the file will have for a choice, in order. "Summary" holds the headline numbers of the ticked measure
 * blocks; "Flocks" and "Days" are the two tables; "Sales" and "Costs" only for the whole farm; "Alerts" when ticked.
 * Compare has its own single sheet. No empty sheet is ever made.
 */
export function sheetsFor(inc: readonly Block[], opts: { farmLevel: boolean; compare: boolean }): string[] {
  const has = (b: Block) => inc.includes(b);
  if (opts.compare) return has("production") || has("feed") || has("mortality") || (opts.farmLevel && (has("sales") || has("costs"))) ? ["Compare"] : [];
  const counts = has("production") || has("feed") || has("mortality"); // what fills the per-flock and day-by-day tables
  const money = opts.farmLevel && (has("sales") || has("costs"));
  const measures = counts || has("alerts") || money;
  const out: string[] = [];
  if (measures) out.push("Summary");
  if (has("flocks") && counts) out.push("Flocks");
  if (has("days") && (counts || money)) out.push("Days");
  if (opts.farmLevel && has("sales")) out.push("Sales");
  if (opts.farmLevel && has("costs")) out.push("Costs");
  if (has("alerts")) out.push("Alerts");
  return out;
}

/** yash-poultry-<view>-<from>_<to> (for example yash-poultry-week-2026-11-16_2026-11-22). */
export function shareFileStem(view: ShareView, from: string, to: string): string {
  return `yash-poultry-${view}-${from}_${to}`;
}

/** Why the download is not possible yet (null = ready). */
export function cannotShare(inc: readonly Block[], opts: { farmLevel: boolean; compare: boolean }): string | null {
  if (inc.length === 0) return "Nothing is ticked: tick at least one thing to put in the file.";
  if (sheetsFor(inc, opts).length === 0) {
    if (!opts.farmLevel && inc.every((b) => MONEY.includes(b))) return "Sales and costs are kept for the whole farm, not per flock: choose All flocks, or tick something else.";
    if (inc.every((b) => b === "flocks" || b === "days")) return "A table needs something in it: tick Production, Feed intake or Mortality as well.";
    return "These ticks give an empty file: tick a measure (Production, Feed intake or Mortality) or a table.";
  }
  return null;
}

/**
 * The address of a choice, shared by the buttons, the share page and the file:
 * view, from, to, one f= per flock (labels), inc= (left out = everything), and the Compare columns as they are.
 */
export function shareQuery(o: { view: ShareView; from?: string; to?: string; flocks?: readonly string[]; inc?: readonly Block[]; compare?: Record<string, string> }): string {
  const q = new URLSearchParams({ view: o.view });
  if (o.compare) for (const [k, v] of Object.entries(o.compare)) q.set(k, v);
  else {
    if (o.from) q.set("from", o.from);
    if (o.to) q.set("to", o.to);
    for (const f of o.flocks ?? []) q.append("f", f);
  }
  if (o.inc) q.set("inc", incParam(o.inc));
  return q.toString();
}

/** The Compare columns read from a Compare address (only these keys travel with a Compare share). */
export const COMPARE_KEYS = ["a", "af", "at", "b", "bf", "bt", "age", "wf", "wt"] as const;
