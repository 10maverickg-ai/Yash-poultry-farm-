import { getAnthropicClient, EXTRACTION_MODEL } from "./anthropicClient";
import { dedupeByNormalizedLabel } from "./flockMatch";
import { FEW_SHOT_DIGIT_EXAMPLES } from "./fewShotExamples";

// The numeric fields a recheck pass can target — shared with reextract.ts so
// both passes agree on the same five names used in ocr_confidence and in
// fn_validate_daily_production's reason strings.
export const RECHECKABLE_FIELDS = [
  "mortality", "feed_bags", "eggs_total", "bird_population", "hd_percent",
] as const;
export type RecheckableField = (typeof RECHECKABLE_FIELDS)[number];

// Field mapping per docs/source-specs/extraction-logic.txt, section 1
// (Daily Production register): header row "Mort, Feed | I | II | Total |
// Bal Bird | %", flock blocks stacked.
//
// This pass extracts Daily Production ONLY. The extraction-logic doc notes
// the Egg Stock Ledger (and, per the owner, Feed Bag Stock) often appear on
// the same photographed page — the prompt below explicitly tells the model
// to ignore those blocks rather than half-extract them, since the write
// paths for those two tables aren't wired up yet. That's the next increment,
// not this one.
//
// shed_code is deliberately NOT extracted (owner decision, 2026-09-18): it
// was adding noise, not signal — a low-confidence read of it could flag an
// entire row (via the low-confidence-on-any-field rule) even when every
// number the row actually needs was read cleanly, and unlike the five
// fields below it was never part of any structural validation rule. The
// daily_production.shed_code COLUMN still exists (manual entry can still
// set it) — this only stops the extraction pass from asking for it.
export interface ExtractedFlockRow {
  display_label_as_written: string;
  mortality: number | null;
  feed_bags: number | null;
  eggs_total: number | null;
  bird_population: number | null;
  hd_percent: number | null;
  // Digit-accuracy pass (owner report, 2026-09-28): each flock's egg count
  // is actually written up to three times on the page — the "I", "II", and
  // "Total" columns — and, when a flock's block spans two written lines,
  // "Bal Bird" is written on both. These arrays are the model's independent
  // reads of each appearance, in the order they're written (I, II, Total;
  // top line, bottom line) — used ONLY to cross-check for disagreement
  // between readings that are supposed to be the same number. They do NOT
  // replace eggs_total/bird_population above, which stay the values the app
  // actually saves (same as before) — this is purely a confidence signal,
  // consistent with this system's standing rule of flagging for review
  // rather than silently picking between disagreeing reads.
  eggs_total_readings: (number | null)[];
  bird_population_readings: (number | null)[];
  confidence: {
    display_label: number;
    mortality: number;
    feed_bags: number;
    eggs_total: number;
    bird_population: number;
    hd_percent: number;
  };
}

// One table section's own subtotal row (sum across that section's own
// flocks) — read separately from the flock rows themselves (a subtotal row
// is explicitly NOT extracted as a flock) so the app can cross-check
// "do the individual flock reads add up to what the page itself says
// they add up to" as a page-level sanity check.
export interface TableSubtotal {
  eggs_total: number | null;
}

export interface ExtractionResult {
  date: string | null; // YYYY-MM-DD, read from the top of the page
  date_confidence: number;
  flocks: ExtractedFlockRow[];
  table_subtotals: TableSubtotal[];
  page_notes: string | null; // model's free-text notes, e.g. illegible sections
  // Self-reported count of distinct physical table blocks the model found
  // flock data in anywhere in the photo. Real register photos are often a
  // two-page spread where flocks split across two separate tables (e.g. 7
  // flocks on the right page, 3 more in a shorter continuation table on the
  // left page, often below unrelated handwritten arithmetic). This field
  // doesn't itself guarantee correctness, but forces the model to consider
  // the question explicitly, and gives the app something concrete to log.
  sections_found: number;
}

// This farm currently runs 10 flocks (BAB-1..BAB-10). Cap the array at
// roughly double that — generous headroom for the farm to grow before this
// needs revisiting, while still giving the model's own JSON schema a hard
// ceiling as one layer of defense against a runaway repeat (owner report,
// 2026-09-28: a photo of the Aug 2 register came back with 2774+ "flocks"
// for a 10-flock page — the model got stuck looping instead of stopping).
// A schema maxItems is a strong hint to the model, not a guarantee, which
// is why extractDailyProductionSafely() below adds a real, unconditional
// backstop (dedupe + reject) that doesn't depend on the model honoring it.
const MAX_FLOCKS_IN_SCHEMA = 20;

// Sized for a legitimate extraction with real headroom, not for whatever
// allowed the runaway case above: each flock entry (six scalar fields +
// two reading arrays + a six-field confidence object) runs roughly
// 120-180 tokens as JSON with real field names; MAX_FLOCKS_IN_SCHEMA (20)
// of those is at most ~3600 tokens, plus a few hundred for date/notes/
// table_subtotals — 5000 leaves comfortable margin for a genuine large
// page while still being a real ceiling, not an effectively-unbounded one.
const MAX_EXTRACTION_TOKENS = 5000;

const EXTRACT_TOOL = {
  name: "record_daily_production_extraction",
  description:
    "Records the Daily Production register data read from the photo.",
  input_schema: {
    type: "object" as const,
    properties: {
      date: {
        type: ["string", "null"],
        description: "Date at the top of the page, as YYYY-MM-DD. Null if illegible.",
      },
      date_confidence: { type: "number", description: "0.0-1.0" },
      page_notes: {
        type: ["string", "null"],
        description:
          "Anything worth the owner knowing that doesn't fit a field: illegible sections, unusual marks, other registers visible on the same page (e.g. an Egg Stock Ledger or Feed Bag Stock block) that were NOT extracted.",
      },
      sections_found: {
        type: "number",
        description:
          "How many separate physical table blocks contained flock data anywhere in this photo (count both pages if a two-page spread is visible). Usually 1, but frequently 2 when flocks continue in a shorter table on the facing page.",
      },
      table_subtotals: {
        type: "array",
        description:
          "One entry per table section (matching sections_found) for that section's own subtotal row at the bottom, if it has one — see the subtotal-row note below. Do not include a table that has no visible subtotal row.",
        items: {
          type: "object",
          properties: {
            eggs_total: {
              type: ["number", "null"],
              description: "The subtotal row's own 'Total' column figure — the sum across that table's flocks, as written.",
            },
          },
          required: ["eggs_total"],
        },
      },
      flocks: {
        type: "array",
        description: `One entry per flock block on the page, top to bottom. Every flock on this page appears EXACTLY ONCE — never write the same flock twice, and never continue past the last real flock block. Hard ceiling: at most ${MAX_FLOCKS_IN_SCHEMA} entries.`,
        maxItems: MAX_FLOCKS_IN_SCHEMA,
        items: {
          type: "object",
          properties: {
            display_label_as_written: {
              type: "string",
              description: "The flock's label, normalized to 'BAB-<number>' with an ordinary digit — see the LABELS section of the instructions. Never a Roman numeral, never any other prefix.",
            },
            mortality: {
              type: ["number", "null"],
              description: "The 'Mort' column — the day's-end total, NOT the stacked first-row sub-number if one is shown.",
            },
            feed_bags: { type: ["number", "null"], description: "The 'Feed' column." },
            eggs_total: { type: ["number", "null"], description: "The 'Total' column — this flock's official egg count." },
            eggs_total_readings: {
              type: "array",
              items: { type: ["number", "null"] },
              description: "Every separate handwritten egg-count figure for this flock, in left-to-right column order: the 'I' column, the 'II' column, then the 'Total' column. Usually 3 entries. Read each one independently, straight off the page — do not copy one into another just because you expect them to match.",
            },
            bird_population: { type: ["number", "null"], description: "The 'Bal Bird' column — this flock's official bird balance." },
            bird_population_readings: {
              type: "array",
              items: { type: ["number", "null"] },
              description: "The 'Bal Bird' figure exactly as written on EACH line of this flock's block, top to bottom (see the two-line note below). Usually 2 entries if the block has two written lines, 1 if it only has one.",
            },
            hd_percent: { type: ["number", "null"], description: "The '%' column, as written." },
            confidence: {
              type: "object",
              description: "0.0-1.0 self-assessed confidence per field, independent of any arithmetic check.",
              properties: {
                display_label: { type: "number" },
                mortality: { type: "number" },
                feed_bags: { type: "number" },
                eggs_total: { type: "number" },
                bird_population: { type: "number" },
                hd_percent: { type: "number" },
              },
              required: [
                "display_label", "mortality", "feed_bags",
                "eggs_total", "bird_population", "hd_percent",
              ],
            },
          },
          required: [
            "display_label_as_written", "mortality", "feed_bags",
            "eggs_total", "eggs_total_readings",
            "bird_population", "bird_population_readings",
            "hd_percent", "confidence",
          ],
        },
      },
    },
    required: ["date", "date_confidence", "page_notes", "sections_found", "table_subtotals", "flocks"],
  },
};

const BASE_PROMPT = `You are reading a photographed page from a Daily Production register at an Indian layer poultry farm, under column headers "Mort, Feed | I | II | Total | Bal Bird | %".

LABELS — read this carefully, it is the single most error-prone part of this task. Every flock on this farm is labeled "BAB" followed by a number from 1 to 10 — nothing else. There is no other prefix and no other naming scheme. The handwriting is often untidy, and the letters "BAB" in particular are frequently scrawled in a way that can look like stray digits or other letters — do NOT try to carefully transcribe the letters; they are always "BAB". A specific known misread: a scrawled "B" is sometimes read as "1" or a two-digit number like "13" or "18", producing something like "18AB-1" or "13AB-1" when the real label is "BAB-1" — if you find yourself reading a label as digits immediately followed by "AB", that is almost certainly this misread; correct it to "BAB" and keep reading the number after "AB" exactly as written. Spend your effort on reading the NUMBER correctly, since that is the only part that actually distinguishes one flock from another. Always output the label as "BAB-<number>" using an ordinary Arabic digit (1, 2, 3, ...) — if the number is written as a Roman numeral (I, II, III, IV, V, VI, VII, VIII, IX, X), convert it: I=1, II=2, III=3, IV=4, V=5, VI=6, VII=7, VIII=8, IX=9, X=10.

Flocks appear in a fixed, known order: BAB-1 through BAB-7 in the main table, then BAB-8 through BAB-10 in the shorter continuation table (see the two-table note below). Use this expected ascending sequence as a cross-check on the number you read — if a number you read breaks the sequence (e.g. you read the same number twice, or jump straight from BAB-2 to BAB-7 with nothing between), look at that label again before finalizing it. But if, after a careful second look, the label genuinely still reads differently from what the sequence would predict, extract exactly what is written and lower that flock's display_label confidence rather than silently forcing it to match the expected sequence — the sequence is a hint for catching your own misreads, not a license to overwrite a real digit.

CRITICAL — do not stop after the first table you find. This is very often a photo of a two-page spread, and the flock blocks are frequently split across TWO SEPARATE physical tables: a main table with most flocks on one page, and a second, often shorter, continuation table with the REMAINING flocks on the facing page. That second table is easy to miss because it's often positioned below unrelated handwritten arithmetic (subtraction sums, running totals) that can look like it isn't part of the register at all. Before answering, scan the ENTIRE photo — both pages if two are visible — for every occurrence of a flock label followed by Mort/Feed/Total/Bal Bird/% data, not just the most prominent block. Set sections_found to how many separate table blocks you actually found flock data in.

CRITICAL — every flock appears EXACTLY ONCE. This farm has at most a handful of flocks per page (rarely more than 10-13 total across both tables). If you notice yourself about to write a label you have already written earlier in this same answer, STOP immediately — you have covered every flock on the page, and continuing means you have started repeating instead of finishing. Call the tool with what you have rather than continuing.

Field mapping (extract exactly these, nothing else) — apply to EVERY flock block in EVERY section you find:
- Date at the top of the page.
- Each flock block's label, per the LABELS section above.
- "Mort" column: the day's-end total for that flock. Some pages show a stacked pair of numbers (a running sub-total and a day total) — take the day's-end total, not the cumulative/stacked sub-number.
- "Feed" column: bags issued.
- Egg total: each flock block shows up to THREE separate handwritten egg-count figures — the "I" column, the "II" column, and the "Total" column. Read all three independently and report them, in that left-to-right order, as eggs_total_readings (do not assume one equals another, even though they often do — write down what's actually there). eggs_total itself is the "Total" column's figure specifically — that's the flock's official egg count.
- Two-line flock blocks: some flock blocks span TWO written lines — a first line, then a second line that also carries that day's Mort/Feed and the "%" figure. When a flock has two lines, the Bal Bird figure is typically written on BOTH lines — read it from each line it appears on and report them, top to bottom, as bird_population_readings. If a flock has only one line, report a single value. bird_population itself is this flock's official current bird balance (the more authoritative of the reading(s), typically the bottom line's).
- "%" column: HD% as written on the page (do not calculate it yourself — read the written figure).

Some tables end with a subtotal row (a sum across that table's own flocks) — that subtotal row is NOT a flock and must not be extracted as one in the flocks array; it just confirms you've reached the bottom of that particular table, not necessarily the bottom of the whole page. DO separately read that subtotal row's own "Total" (egg count) figure into table_subtotals, one entry per table section that has one — this lets the app cross-check whether the individual flock reads add up to what the page's own arithmetic says.

If this photo also shows other registers (an Egg Stock Ledger with running +/- entries, or Feed Bag Stock boxes with OB=/F=/S= figures), do NOT extract those — note their presence in page_notes only.

If a field is blank or illegible, use null and give it low confidence rather than guessing a plausible value. Confidence is your own assessment of read certainty, independent of whether the numbers make arithmetic sense — a downstream system checks the arithmetic separately.

Call record_daily_production_extraction with your findings.`;

// Appended only on the automatic retry after a first attempt failed the
// app's post-extraction sanity check (way too many rows for this page) —
// a stronger, more direct version of the "exactly once" warning already in
// the base prompt, specifically naming what almost certainly went wrong.
const STRICT_RETRY_SUFFIX = `

IMPORTANT — retry notice: your previous attempt at this exact photo returned an implausible number of flock entries — far more than a page like this could really have. That means something went wrong last time and you likely started repeating the same row(s) instead of stopping once you'd covered every flock. This time: each flock on this page appears EXACTLY ONCE in your answer. The moment you notice you are about to write a label you have already written in this same response, STOP — you have already covered every flock on the page. Call the tool immediately with what you have rather than continuing or starting over.`;

// Thrown when the model's response was cut off by the token limit before
// finishing its tool call — the JSON the SDK hands back in that case may be
// structurally patched-up but is not a trustworthy read of the page (some
// fields could be missing purely because generation stopped, not because
// the model actually looked and found nothing). Never treated as a valid
// result; extractDailyProductionSafely() treats it the same as a failed
// sanity check — eligible for one retry, then a clean rejection.
export class ExtractionTruncated extends Error {}

export async function extractDailyProduction(
  imageBase64: string,
  mediaType: string,
  opts: { strict?: boolean } = {}
): Promise<ExtractionResult> {
  const client = getAnthropicClient();
  const promptText = opts.strict ? BASE_PROMPT + STRICT_RETRY_SUFFIX : BASE_PROMPT;

  const response = await client.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: MAX_EXTRACTION_TOKENS,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: EXTRACT_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType as "image/jpeg" | "image/png" | "image/webp",
              data: imageBase64,
            },
          },
          { type: "text", text: promptText },
          ...FEW_SHOT_DIGIT_EXAMPLES,
        ],
      },
    ],
  });

  if (response.stop_reason === "max_tokens") {
    throw new ExtractionTruncated(
      "The model's response was cut off before finishing — likely a runaway repeat rather than a real reading."
    );
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Extraction call returned no structured result");
  }
  return toolUse.input as ExtractionResult;
}

// Thrown when extraction still looks like a runaway repeat after one retry
// — the caller (app/upload/actions.ts) turns this into a plain, friendly
// error and NEVER attempts to save anything from it; no transaction is ever
// opened for a rejected extraction.
export class ExtractionRejected extends Error {}

interface AttemptOk {
  ok: true;
  extraction: ExtractionResult;
  flocks: ExtractedFlockRow[]; // deduped by normalized label
}
interface AttemptFailed {
  ok: false;
  detail: string;
}
type AttemptResult = AttemptOk | AttemptFailed;

/**
 * Wraps extractDailyProduction with the app-level sanity check the schema's
 * maxItems can only hint at: after extraction, dedupe by normalized label
 * (collapsing a harmless exact repeat of the same flock), then check
 * whether the result still has more distinct flocks than this farm
 * plausibly has. If so, retry ONCE with a stricter instruction; if the
 * retry still fails the check, reject cleanly — the caller never sees a
 * runaway result to accidentally save.
 */
export async function extractDailyProductionSafely(
  imageBase64: string,
  mediaType: string,
  activeFlockCount: number
): Promise<{ extraction: ExtractionResult; flocks: ExtractedFlockRow[] }> {
  const maxSane = activeFlockCount + 2;

  async function attempt(strict: boolean): Promise<AttemptResult> {
    let extraction: ExtractionResult;
    try {
      extraction = await extractDailyProduction(imageBase64, mediaType, { strict });
    } catch (err) {
      if (err instanceof ExtractionTruncated) {
        return { ok: false, detail: "hit the model's output token limit" };
      }
      throw err; // a genuine API/network error — not ours to retry-and-swallow
    }

    const flocks = dedupeByNormalizedLabel(extraction.flocks, (f) => f.display_label_as_written);
    if (flocks.length > maxSane) {
      return {
        ok: false,
        detail: `${extraction.flocks.length} raw row(s), ${flocks.length} distinct label(s) for ~${activeFlockCount} active flock(s)`,
      };
    }
    return { ok: true, extraction, flocks };
  }

  const first = await attempt(false);
  if (first.ok) return first;
  console.warn(`[upload] extraction sanity check failed on first pass (${first.detail}) — retrying with a stricter instruction`);

  const retry = await attempt(true);
  if (retry.ok) return retry;
  console.warn(`[upload] extraction sanity check failed again after retry (${retry.detail}) — rejecting this upload`);

  throw new ExtractionRejected(
    `Extraction returned an implausible number of rows for a page with ~${activeFlockCount} flocks — please retry the upload.`
  );
}
