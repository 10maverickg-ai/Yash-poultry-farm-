import { getAnthropicClient, EXTRACTION_MODEL } from "./anthropicClient";

// The numeric fields a recheck pass can target — shared with reextract.ts so
// both passes agree on the same five names used in ocr_confidence and in
// fn_validate_daily_production's reason strings.
export const RECHECKABLE_FIELDS = [
  "mortality", "feed_bags", "eggs_total", "bird_population", "hd_percent",
] as const;
export type RecheckableField = (typeof RECHECKABLE_FIELDS)[number];

// Field mapping per docs/source-specs/extraction-logic.txt, section 1
// (Daily Production register): header row "Mort, Feed | I | II | Total |
// Bal Bird | %", flock blocks stacked. "I"/"II" columns are confirmed not
// meaningfully used and are deliberately not extracted.
//
// This pass extracts Daily Production ONLY. The extraction-logic doc notes
// the Egg Stock Ledger (and, per the owner, Feed Bag Stock) often appear on
// the same photographed page — the prompt below explicitly tells the model
// to ignore those blocks rather than half-extract them, since the write
// paths for those two tables aren't wired up yet. That's the next increment,
// not this one.
export interface ExtractedFlockRow {
  display_label_as_written: string;
  shed_code: string | null;
  mortality: number | null;
  feed_bags: number | null;
  eggs_total: number | null;
  bird_population: number | null;
  hd_percent: number | null;
  confidence: {
    display_label: number;
    shed_code: number;
    mortality: number;
    feed_bags: number;
    eggs_total: number;
    bird_population: number;
    hd_percent: number;
  };
}

export interface ExtractionResult {
  date: string | null; // YYYY-MM-DD, read from the top of the page
  date_confidence: number;
  flocks: ExtractedFlockRow[];
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
      flocks: {
        type: "array",
        description: "One entry per flock block on the page, top to bottom.",
        items: {
          type: "object",
          properties: {
            display_label_as_written: {
              type: "string",
              description: "The flock block header exactly as written, e.g. 'BAB-I'. Never normalize or guess a different label.",
            },
            shed_code: { type: ["string", "null"] },
            mortality: {
              type: ["number", "null"],
              description: "The 'Mort' column — the day's-end total, NOT the stacked first-row sub-number if one is shown.",
            },
            feed_bags: { type: ["number", "null"], description: "The 'Feed' column." },
            eggs_total: { type: ["number", "null"], description: "The 'Total' column. Ignore the 'I' and 'II' columns entirely." },
            bird_population: { type: ["number", "null"], description: "The 'Bal Bird' column." },
            hd_percent: { type: ["number", "null"], description: "The '%' column, as written." },
            confidence: {
              type: "object",
              description: "0.0-1.0 self-assessed confidence per field, independent of any arithmetic check.",
              properties: {
                display_label: { type: "number" },
                shed_code: { type: "number" },
                mortality: { type: "number" },
                feed_bags: { type: "number" },
                eggs_total: { type: "number" },
                bird_population: { type: "number" },
                hd_percent: { type: "number" },
              },
              required: [
                "display_label", "shed_code", "mortality", "feed_bags",
                "eggs_total", "bird_population", "hd_percent",
              ],
            },
          },
          required: [
            "display_label_as_written", "shed_code", "mortality", "feed_bags",
            "eggs_total", "bird_population", "hd_percent", "confidence",
          ],
        },
      },
    },
    required: ["date", "date_confidence", "page_notes", "sections_found", "flocks"],
  },
};

const PROMPT = `You are reading a photographed page from a Daily Production register at an Indian layer poultry farm. Each flock's data is recorded in a block headed by a label like "BAB-I", "BAB-1", "18 BAB", etc., under column headers "Mort, Feed | I | II | Total | Bal Bird | %".

CRITICAL — do not stop after the first table you find. This is very often a photo of a two-page spread, and the flock blocks are frequently split across TWO SEPARATE physical tables: a main table with most flocks on one page, and a second, often shorter, continuation table with the REMAINING flocks on the facing page. That second table is easy to miss because it's often positioned below unrelated handwritten arithmetic (subtraction sums, running totals) that can look like it isn't part of the register at all. Before answering, scan the ENTIRE photo — both pages if two are visible — for every occurrence of a flock label followed by Mort/Feed/Total/Bal Bird/% data, not just the most prominent block. Set sections_found to how many separate table blocks you actually found flock data in.

Field mapping (extract exactly these, nothing else) — apply to EVERY flock block in EVERY section you find:
- Date at the top of the page.
- Each flock block's header text, EXACTLY as written (do not normalize "BAB-I" to "BAB-1" or vice versa, do not guess a label based on sequence).
- The row under the flock name (often just a shed identifier).
- "Mort" column: the day's-end total for that flock. Some pages show a stacked pair of numbers (a running sub-total and a day total) — take the day's-end total, not the cumulative/stacked sub-number.
- "Feed" column: bags issued.
- "Total" column: total eggs. Ignore the "I" and "II" sub-columns entirely — they are not used at this farm.
- "Bal Bird" column: current bird count.
- "%" column: HD% as written on the page (do not calculate it yourself — read the written figure).

Some tables end with a subtotal row (a sum across that table's own flocks) — that subtotal row is NOT a flock and must not be extracted as one; it just confirms you've reached the bottom of that particular table, not necessarily the bottom of the whole page.

If this photo also shows other registers (an Egg Stock Ledger with running +/- entries, or Feed Bag Stock boxes with OB=/F=/S= figures), do NOT extract those — note their presence in page_notes only.

If a field is blank or illegible, use null and give it low confidence rather than guessing a plausible value. Confidence is your own assessment of read certainty, independent of whether the numbers make arithmetic sense — a downstream system checks the arithmetic separately.

Call record_daily_production_extraction with your findings.`;

export async function extractDailyProduction(
  imageBase64: string,
  mediaType: string
): Promise<ExtractionResult> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 4096,
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
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Extraction call returned no structured result");
  }
  return toolUse.input as ExtractionResult;
}
