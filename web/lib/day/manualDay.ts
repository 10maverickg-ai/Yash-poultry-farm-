// "Enter a day by hand" (V12 N4): the guaranteed way to enter a day while the photo reader is off. Pure functions (no database):
// the same arithmetic runs live in the form and again on the server when the day is saved, and scripts/manualday-check.mts tests it.
//
// What a day is (register layout, 2026):
//   right page  BAB-1..BAB-8  "main": deaths, feed bags, eggs, birds left   + ONE feed box + the BIG egg ledger
//   left page   BAB-9..BAB-11 "young": deaths, eggs, birds left (no feed)   + the SMALL egg ledger + the chick rows
export type Group = "main" | "young";

/** One-tap answers for a ledger line (the same words as the review screen). */
export const LEFT_ANSWERS = [
  { key: "sale", label: "Farmfresh sale", category: "sale" },
  { key: "local_sale", label: "Local sale", category: "local_sale" },
  { key: "breakage", label: "Breakage", category: "breakage" },
  { key: "labour_take", label: "Labour took them", category: "labour_take" },
  { key: "anil_out", label: "Given to Anil farm", category: "cross_farm_adjustment" },
  { key: "gift", label: "Gift", category: "gift" },
  { key: "other_out", label: "Something else", category: "other" },
] as const;
export const ADDED_ANSWERS = [
  { key: "late", label: "Late eggs of our own flocks", category: "production_addition" },
  { key: "anil_in", label: "Eggs from Anil farm", category: "cross_farm_adjustment" },
  { key: "other_in", label: "Something else", category: "other" },
] as const;
export type AnswerKey = (typeof LEFT_ANSWERS)[number]["key"] | (typeof ADDED_ANSWERS)[number]["key"];
export const answerCategory = (k: string): string | null => [...LEFT_ANSWERS, ...ADDED_ANSWERS].find((a) => a.key === k)?.category ?? null;
export const answerLabel = (k: string): string => [...LEFT_ANSWERS, ...ADDED_ANSWERS].find((a) => a.key === k)?.label ?? "";

export interface LedgerLine { answer: AnswerKey; eggs: number; label: string } // eggs is a positive count; the answer says whether they left or were added
export const lineSign = (l: Pick<LedgerLine, "answer">): 1 | -1 => (ADDED_ANSWERS.some((a) => a.key === l.answer) ? 1 : -1);
export const signedEggs = (l: LedgerLine): number => lineSign(l) * l.eggs;

export interface FlockDay {
  flockId: string;
  label: string;
  group: Group;
  prevBirds: number | null; // birds left yesterday (null = no row yesterday)
  moved?: number; // birds moved in (+) or out (−) today, as already recorded on the Flocks screen
  mortality: number | null;
  feed: number | null; // bags (right-page flocks only)
  eggs: number | null;
  birds: number | null; // birds left today
}
export interface LedgerDay {
  prevClosing: number | null;
  opening: number | null;
  closing: number | null; // as written; null = use the worked-out figure
  lines: LedgerLine[];
}
export interface FeedBoxDay {
  prevClosing: number | null;
  opening: number | null;
  produced: number | null;
  mill: number | null;
  shed: number | null;
}
export interface PageTotals { rightDeaths: number | null; rightFeed: number | null; rightEggs: number | null; leftDeaths: number | null; leftEggs: number | null }
export interface ChickRow { label: string; deaths: number | null }
export interface ManualDay {
  date: string;
  flocks: FlockDay[];
  pages: PageTotals;
  feed: FeedBoxDay;
  big: LedgerDay;
  small: LedgerDay;
  chick: ChickRow[];
}

const sum = (xs: (number | null)[]) => xs.reduce<number>((t, x) => t + (x ?? 0), 0);
const nOr = (x: number | null | undefined) => (x == null ? null : x);
export const fmt = (x: number) => Math.round(x).toLocaleString("en-IN");

/** Birds left today when nothing but deaths happened: yesterday's birds − today's deaths (movements are entered on the Flocks screen). */
export const autoBirds = (prev: number | null, deaths: number | null, moved = 0): number | null => (prev == null ? null : prev + moved - (deaths ?? 0));

export interface Derived {
  rightEggs: number; rightFeed: number; rightDeaths: number;
  leftEggs: number; leftDeaths: number;
  feedTotal: number | null; feedConsumed: number; feedClosing: number | null; feedShedMill: number | null;
  big: { produced: number; totalLine: number | null; linesSum: number; closing: number | null };
  small: { produced: number; totalLine: number | null; linesSum: number; closing: number | null };
}
export function derive(d: ManualDay): Derived {
  const main = d.flocks.filter((f) => f.group === "main");
  const young = d.flocks.filter((f) => f.group === "young");
  const feedTotal = d.feed.opening != null && d.feed.produced != null ? d.feed.opening + d.feed.produced : null;
  const feedConsumed = sum(main.map((f) => f.feed));
  const led = (l: LedgerDay, produced: number) => {
    const totalLine = l.opening != null ? l.opening + produced : null;
    const linesSum = sum(l.lines.map(signedEggs));
    return { produced, totalLine, linesSum, closing: totalLine != null ? totalLine + linesSum : null };
  };
  return {
    rightEggs: sum(main.map((f) => f.eggs)), rightFeed: feedConsumed, rightDeaths: sum(main.map((f) => f.mortality)),
    leftEggs: sum(young.map((f) => f.eggs)), leftDeaths: sum(young.map((f) => f.mortality)),
    feedTotal, feedConsumed, feedClosing: feedTotal != null ? feedTotal - feedConsumed : null,
    feedShedMill: d.feed.mill != null || d.feed.shed != null ? sum([d.feed.mill, d.feed.shed]) : null,
    big: led(d.big, sum(main.map((f) => f.eggs))),
    small: led(d.small, sum(young.map((f) => f.eggs))),
  };
}

export interface Check {
  id: string;
  level: "ok" | "warn" | "error";
  text: string;
  flockId?: string; // the flock row it belongs to (the flag goes on that row)
}

/** Every check, in plain words. "warn" and "error" are saved anyway but flagged for review (the app never rejects a day). */
export function checkDay(d: ManualDay, today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)): Check[] {
  const out: Check[] = [];
  const add = (id: string, ok: boolean, okText: string, badText: string, level: "warn" | "error" = "warn", flockId?: string) => out.push({ id, level: ok ? "ok" : level, text: ok ? okText : badText, flockId });
  const x = derive(d);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) add("date", false, "", "Choose the date of the page.", "error");
  else if (d.date > today) add("date", false, "", `${d.date} is in the future. Choose the date written on the page.`, "error");

  for (const f of d.flocks) {
    const touched = f.mortality != null || f.eggs != null || f.birds != null || f.feed != null;
    if (!touched) continue;
    if (f.eggs == null) add(`eggs-${f.flockId}`, false, "", `${f.label}: eggs are missing.`, "warn", f.flockId);
    if (f.mortality == null) add(`mort-${f.flockId}`, false, "", `${f.label}: deaths are missing (write 0 if none).`, "warn", f.flockId);
    if (f.group === "main" && f.feed == null) add(`feed-${f.flockId}`, false, "", `${f.label}: feed bags are missing.`, "warn", f.flockId);
    if (f.birds == null) add(`birds-${f.flockId}`, false, "", `${f.label}: birds left is missing.`, "warn", f.flockId);
    if (f.eggs != null) add(`e30-${f.flockId}`, f.eggs % 30 === 0, `${f.label}: eggs are a whole number of trays of 30.`, `${f.label}: ${fmt(f.eggs)} eggs is not a multiple of 30 (eggs are counted in trays of 30). Check the figure.`, "warn", f.flockId);
    if (f.eggs != null && f.birds != null && f.eggs > f.birds) add(`eb-${f.flockId}`, false, "", `${f.label}: ${fmt(f.eggs)} eggs from ${fmt(f.birds)} birds is more than one egg a bird. Check both figures.`, "warn", f.flockId);
    const exp = autoBirds(f.prevBirds, f.mortality, f.moved ?? 0);
    if (exp != null && f.birds != null) add(`chain-${f.flockId}`, f.birds === exp, `${f.label}: birds left follow yesterday's ${fmt(f.prevBirds!)} less ${f.mortality ?? 0} deaths${f.moved ? ` ${f.moved > 0 ? "plus" : "less"} ${fmt(Math.abs(f.moved))} moved` : ""}.`, `${f.label}: birds left ${fmt(f.birds)} but yesterday's ${fmt(f.prevBirds!)} less ${f.mortality ?? 0} deaths${f.moved ? ` ${f.moved > 0 ? "plus" : "less"} ${fmt(Math.abs(f.moved))} moved` : ""} is ${fmt(exp)} (difference ${f.birds - exp > 0 ? "+" : "−"}${fmt(Math.abs(f.birds - exp))}). If birds were moved or sold, record it on the Flocks screen.`, "warn", f.flockId);
  }

  // page totals as written at the bottom of each page
  const p = d.pages;
  const pg = (id: string, label: string, written: number | null, calc: number) => {
    if (written == null) return;
    add(id, written === calc, `${label}: the rows add up to ${fmt(calc)}, as the page says.`, `${label}: the rows add up to ${fmt(calc)} but the page says ${fmt(written)} (difference ${calc - written > 0 ? "+" : "−"}${fmt(Math.abs(calc - written))}). One row is probably mistyped.`);
  };
  pg("pg-rd", "Right page deaths", p.rightDeaths, x.rightDeaths);
  pg("pg-rf", "Right page feed bags", p.rightFeed, x.rightFeed);
  pg("pg-re", "Right page eggs", p.rightEggs, x.rightEggs);
  pg("pg-ld", "Left page deaths", p.leftDeaths, x.leftDeaths);
  pg("pg-le", "Left page eggs", p.leftEggs, x.leftEggs);

  // feed box
  const fb = d.feed;
  if (fb.opening != null && fb.prevClosing != null) add("fb-open", fb.opening === fb.prevClosing, `Feed box opens at yesterday's closing (${fmt(fb.prevClosing)} bags).`, `Feed box opens at ${fmt(fb.opening)} bags but yesterday closed at ${fmt(fb.prevClosing)}.`);
  if (fb.opening == null || fb.produced == null) add("fb-fill", false, "", "Feed box: opening stock and the bags made today are needed.");
  if (x.feedClosing != null && x.feedShedMill != null) add("fb-close", x.feedClosing === x.feedShedMill, `Feed box ties: ${fmt(x.feedTotal!)} − ${fmt(x.feedConsumed)} fed = ${fmt(x.feedClosing)} bags = mill + shed.`, `Feed box: ${fmt(x.feedTotal!)} − ${fmt(x.feedConsumed)} fed leaves ${fmt(x.feedClosing)} bags, but mill + shed is ${fmt(x.feedShedMill)} (difference ${x.feedShedMill - x.feedClosing > 0 ? "+" : "−"}${fmt(Math.abs(x.feedShedMill - x.feedClosing))}).`);
  else if (x.feedClosing != null) add("fb-close", false, "", `Feed box: ${fmt(x.feedClosing)} bags should be left. Write the bags left at the mill and in the shed.`);

  // ledgers
  const led = (id: string, name: string, l: LedgerDay, v: { produced: number; totalLine: number | null; linesSum: number; closing: number | null }) => {
    if (l.opening != null && l.prevClosing != null) add(`${id}-open`, l.opening === l.prevClosing, `${name} ledger opens at yesterday's closing (${fmt(l.prevClosing)}).`, `${name} ledger opens at ${fmt(l.opening)} but yesterday closed at ${fmt(l.prevClosing)}.`);
    if (l.opening == null) add(`${id}-fill`, false, "", `${name} ledger: the opening stock is needed.`);
    if (v.closing != null && l.closing != null) add(`${id}-close`, l.closing === v.closing, `${name} ledger ties: ${fmt(l.opening!)} + ${fmt(v.produced)} laid ${v.linesSum >= 0 ? "+" : "−"} ${fmt(Math.abs(v.linesSum))} lines = ${fmt(v.closing)}.`, `${name} ledger: ${fmt(l.opening!)} + ${fmt(v.produced)} laid ${v.linesSum >= 0 ? "+" : "−"} ${fmt(Math.abs(v.linesSum))} lines is ${fmt(v.closing)}, but the closing written is ${fmt(l.closing)} (difference ${l.closing - v.closing > 0 ? "+" : "−"}${fmt(Math.abs(l.closing - v.closing))}).`);
    for (const ln of l.lines) {
      if (ln.eggs <= 0) add(`${id}-ln0`, false, "", `${name} ledger: a line has no number of eggs.`, "warn");
      else if (ln.eggs % 30 !== 0 && ln.answer !== "breakage") add(`${id}-l30-${ln.eggs}`, false, "", `${name} ledger: ${fmt(ln.eggs)} eggs (${answerLabel(ln.answer)}) is not a multiple of 30. Sales are counted in trays of 30; check it.`);
    }
  };
  led("big", "Big egg", d.big, x.big);
  led("small", "Small egg", d.small, x.small);
  return out;
}

/** The reasons to flag a flock's row (warn/error checks that belong to it). */
export const reasonsFor = (checks: Check[], flockId: string): string[] => checks.filter((c) => c.flockId === flockId && c.level !== "ok").map((c) => c.text);
/** Do the day-level (non-flock) checks pass? Used for the final line "N things do not tie". */
export const problems = (checks: Check[]) => checks.filter((c) => c.level !== "ok");

/** Parses the form's JSON; returns null when it is not a usable day. */
export function parseDay(json: string): ManualDay | null {
  try {
    const o = JSON.parse(json) as ManualDay;
    if (!o || typeof o.date !== "string" || !Array.isArray(o.flocks)) return null;
    const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
    const led = (l: LedgerDay): LedgerDay => ({
      prevClosing: num(l?.prevClosing), opening: num(l?.opening), closing: num(l?.closing),
      lines: (Array.isArray(l?.lines) ? l.lines : []).filter((x) => x && answerCategory(String(x.answer)) && Number(x.eggs) > 0).map((x) => ({ answer: x.answer, eggs: Math.round(Number(x.eggs)), label: String(x.label ?? "").slice(0, 120) })),
    });
    return {
      date: o.date,
      flocks: o.flocks.map((f) => ({ flockId: String(f.flockId), label: String(f.label), group: f.group === "young" ? "young" : "main", prevBirds: num(f.prevBirds), moved: num(f.moved) ?? 0, mortality: num(f.mortality), feed: num(f.feed), eggs: num(f.eggs), birds: num(f.birds) })),
      pages: { rightDeaths: num(o.pages?.rightDeaths), rightFeed: num(o.pages?.rightFeed), rightEggs: num(o.pages?.rightEggs), leftDeaths: num(o.pages?.leftDeaths), leftEggs: num(o.pages?.leftEggs) },
      feed: { prevClosing: num(o.feed?.prevClosing), opening: num(o.feed?.opening), produced: num(o.feed?.produced), mill: num(o.feed?.mill), shed: num(o.feed?.shed) },
      big: led(o.big), small: led(o.small),
      chick: (Array.isArray(o.chick) ? o.chick : []).map((c) => ({ label: String(c.label ?? "").slice(0, 60), deaths: num(c.deaths) })).filter((c) => c.label !== "" && c.deaths != null),
    };
  } catch {
    return null;
  }
}
export { nOr };
