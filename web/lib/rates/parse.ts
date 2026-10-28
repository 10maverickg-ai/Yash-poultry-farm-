// Reads the daily BAFTA rate SMS by meaning, not by one fixed layout. Pure
// functions only (no DB), so scripts/rates-check.mts can test them.
//
//   "OCTOBER 19, 2026 BFTA EGG RATE RS.560/- Subsidy for 0 Paise"
//
// RS.<n> is the price per 100 eggs (560 -> 5.60 per egg). Subsidy is in paise
// per egg. Effective per-egg rate = rate/100 - subsidy_paise/100 (assumed:
// the owner confirms this the first time a non-zero subsidy appears). Big
// eggs sell at effective - 0.03, small at effective - 0.25.

export interface ParsedRate {
  date: string | null; // YYYY-MM-DD read from the message; null if none found
  per100: number;
  subsidyPaise: number;
  original: string;
  notes: string[];
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
const validDate = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
};

/** Finds a date written as "OCTOBER 19, 2026", "19 Oct 2026", "19/10/2026", "19-10-26" or "2026-10-19". */
export function findDate(text: string): string | null {
  let m = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (m && MONTHS[m[1].toLowerCase()]) return validDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{2,4})\b/);
  if (m && MONTHS[m[2].toLowerCase()]) return validDate(+m[3] < 100 ? 2000 + +m[3] : +m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (m) return validDate(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1]); // day first, as written in India
  return null;
}

/** Splits pasted text into one chunk per message (a new chunk starts at each date). */
function chunks(text: string): string[] {
  const clean = text.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!clean) return [];
  const re = /(?:^|\n)(?=[^\n]*(?:\b[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\b\d{1,2}(?:st|nd|rd|th)?[\s-]+[A-Za-z]{3,9}\.?,?[\s-]+\d{2,4}|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\b\d{4}-\d{1,2}-\d{1,2}\b))/;
  // Re-join lines so a message wrapped over several lines stays together:
  // a new message starts on a line that contains a date AND (later) a rate.
  const lines = clean.split("\n");
  const out: string[] = [];
  let cur = "";
  for (const line of lines) {
    const startsNew = re.test("\n" + line) && /RS\.?|₹|INR|RATE/i.test(line + cur);
    if (startsNew && cur && /(?:RS\.?|₹|INR)\s*\d/i.test(cur)) {
      out.push(cur.trim());
      cur = line;
    } else cur += (cur ? " " : "") + line;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parseRateMessages(text: string): ParsedRate[] {
  const res: ParsedRate[] = [];
  for (const chunk of chunks(text)) {
    const notes: string[] = [];
    // price per 100: number after RS / Rs. / ₹ / INR; tolerate "RS.560/-", "Rs 560", "560/-"
    const rate = chunk.match(/(?:RS\.?|₹|INR)\s*\.?\s*(\d{2,4}(?:\.\d+)?)/i) ?? chunk.match(/\b(\d{3,4}(?:\.\d+)?)\s*\/-/);
    if (!rate) continue;
    const per100 = Number(rate[1]);
    if (!(per100 >= 100 && per100 <= 2000)) {
      notes.push(`Rate ${per100} per 100 looks wrong (expected roughly 400–800).`);
    }
    const sub = chunk.match(/subsidy\s*(?:for|of|:)?\s*(\d+(?:\.\d+)?)\s*paise/i) ?? chunk.match(/(\d+(?:\.\d+)?)\s*paise/i);
    const subsidyPaise = sub ? Math.round(Number(sub[1])) : 0;
    if (!sub) notes.push("No subsidy line found; assumed 0 paise.");
    if (subsidyPaise > 0) notes.push(`Subsidy ${subsidyPaise} paise: effective rate assumed = rate − subsidy/100 per egg. Please confirm this the first time.`);
    res.push({ date: findDate(chunk), per100, subsidyPaise, original: chunk, notes });
  }
  return res;
}

/**
 * The owner's own handwritten monthly list is his NET selling price per egg (BAFTA − subsidy − 0.03), one line per
 * day, e.g. "19 Oct 2026  5.22". The stored BAFTA rate is that price + 0.03 (so Farmfresh = rate − 0.03 gives his
 * price back). One line = one day; the price is the only decimal number left once the date is removed.
 */
export function parseNetPriceList(text: string): ParsedRate[] {
  const res: ParsedRate[] = [];
  for (const raw of text.replace(/\r/g, "\n").split("\n")) {
    const line = raw.replace(/[ \t]+/g, " ").trim();
    if (!line) continue;
    const date = findDate(line);
    const rest = line
      .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, " ")
      .replace(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, " ")
      .replace(/\b[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/g, " ")
      .replace(/\b\d{1,2}(?:st|nd|rd|th)?[\s-]+[A-Za-z]{3,9}\.?,?[\s-]+\d{2,4}\b/g, " ");
    const m = rest.match(/(?:RS\.?|₹)?\s*(\d{1,2}\.\d{1,3})\b/i);
    if (!m) continue;
    const price = Number(m[1]);
    const notes: string[] = [`Your own price list: ₹${price.toFixed(2)} is your net selling price per egg. The BAFTA rate saved is ₹${(price + FARMFRESH_DISCOUNT).toFixed(2)} (your price + 0.03), so a Farmfresh sale gets exactly ₹${price.toFixed(2)}.`];
    if (!(price >= 3 && price <= 12)) notes.push(`₹${price} per egg looks wrong (expected roughly ₹4–8).`);
    res.push({ date, per100: Math.round((price + FARMFRESH_DISCOUNT) * 100), subsidyPaise: 0, original: line, notes });
  }
  return res;
}

export interface RateNumbers {
  perEgg: number; // as messaged (per100 / 100)
  effective: number; // after subsidy: "the rate"
  farmfresh: number; // Farmfresh sale price per egg, big OR small = rate - 0.03
  local: number; // local sale price per egg = rate + 0.01
}
const r2 = (x: number) => Math.round(x * 100) / 100;

// Owner (V5 follow-up F3): Farmfresh buys big AND small eggs at rate - 0.03;
// local sales go at rate + 0.01. The old small-egg price (rate - 0.25) is scrapped.
export const FARMFRESH_DISCOUNT = 0.03;
export const LOCAL_PREMIUM = 0.01;
/** A lot this small is never a Farmfresh collection: it is a local sale. */
export const SMALL_LOT_MAX_EGGS = 150;

export function rateNumbers(per100: number, subsidyPaise: number): RateNumbers {
  const perEgg = per100 / 100;
  const effective = r2(perEgg - subsidyPaise / 100);
  return { perEgg: r2(perEgg), effective, farmfresh: r2(effective - FARMFRESH_DISCOUNT), local: r2(effective + LOCAL_PREMIUM) };
}

export type SaleKind = "farmfresh" | "local";

/**
 * Farmfresh or local? A ledger line categorised local_sale, a label that says
 * "local", or any lot up to SMALL_LOT_MAX_EGGS is local (a person's name is
 * categorised local_sale by the ledger step). Everything else sold is Farmfresh.
 */
export function classifySale(input: { category: string | null; label: string; eggs: number }): SaleKind {
  if (input.category === "local_sale") return "local";
  if (Math.abs(input.eggs) <= SMALL_LOT_MAX_EGGS) return "local";
  if (/\blocal\b/i.test(input.label)) return "local";
  return "farmfresh";
}

/** Price per egg for a sale, from the day's rate (the effective BAFTA rate after subsidy). */
export function salePrice(rate: number, kind: SaleKind): number {
  return r2(kind === "farmfresh" ? rate - FARMFRESH_DISCOUNT : rate + LOCAL_PREMIUM);
}
