import { getAnthropicClient, EXTRACTION_MODEL } from "../anthropicClient";
import type { Section, SectionSubtotal } from "../pageChecksum";
import type { NormalizedBox } from "./types";

// Reader rebuild, stage 2 (Daily Production side): one call per flock-table
// crop (main_table_block or continuation_table_block), at the crop's own
// full resolution — never the whole page. Field semantics are carried over
// unchanged from the proven single-call reader (lib/extraction/dailyProduction.ts)
// — this is the SAME information, just asked of a smaller, sharper image,
// one section at a time. The output feeds pipeline.ts exactly like the old
// reader's did; nothing downstream needed to change.
//
// Two things this version adds that the single-call reader didn't have
// room to ask for everywhere (owner's "V4 build prompt", Phase 1 — "confidence
// per number and the raw text for any scribbled cell"):
//   - ambiguous_digits: free text, only when something in this row looked
//     genuinely uncertain — never filled in for a clean row.
//   - row_box: this flock's own bounding box WITHIN this crop, so a later
//     checksum-driven retry can zoom into exactly this row (crop.ts's
//     recropForRetry) without re-reading the whole section.

export interface RegionFlockRow {
  display_label_as_written: string;
  mortality: number | null;
  feed_bags: number | null;
  eggs_total: number | null;
  eggs_ii: number | null;
  bird_population: number | null;
  bird_population_readings: (number | null)[];
  hd_percent: number | null;
  margin_note: string | null;
  confidence: {
    display_label: number;
    mortality: number;
    feed_bags: number;
    eggs_total: number;
    bird_population: number;
    hd_percent: number;
  };
  ambiguous_digits: string | null;
  row_box: NormalizedBox;
}

export interface DailyProductionRegionResult {
  flocks: RegionFlockRow[];
  subtotal: SectionSubtotal | null;
  region_notes: string | null;
}

const SUBTOTAL_PROPERTIES = {
  eggs: { type: ["number", "null"], description: "This section's subtotal row 'Total' (egg count) figure, as written. Null if not legible, or if you're not confident this is really the subtotal row (see the row-signature test below) rather than a stock-ledger line." },
  bal_bird: { type: ["number", "null"], description: "This section's subtotal row 'Bal Bird' figure, as written. A genuine subtotal row always has one — if you can't find a Bal Bird figure at this row, you are very likely looking at a stock-ledger line instead, and the whole entry should be treated as not found." },
  mortality: { type: ["number", "null"], description: "This section's subtotal row 'Mort' figure, as written. Null if not legible or not present." },
  feed_bags: { type: ["number", "null"], description: "This section's subtotal row 'Feed' figure, as written. Null if not legible or not present." },
  hd_percent: { type: ["number", "null"], description: "This section's subtotal row '%' figure, as written. A genuine subtotal row always has one, same as Bal Bird — a stock-ledger line never does." },
};

const BOX_SCHEMA = {
  type: "object" as const,
  description: "This flock's own row, normalized 0.0-1.0 WITHIN THIS CROPPED IMAGE (not the original photo).",
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
  },
  required: ["x", "y", "width", "height"],
};

const MAX_FLOCKS_IN_SCHEMA = 15;

function buildTool(sectionLabel: string) {
  return {
    name: "record_section_extraction",
    description: `Records every flock's data and the subtotal from this ${sectionLabel} crop.`,
    input_schema: {
      type: "object" as const,
      properties: {
        region_notes: {
          type: ["string", "null"],
          description: "Anything worth the owner knowing about THIS crop specifically — illegible areas, smudges — or null.",
        },
        subtotal: {
          description: "The subtotal row directly beneath the last flock in THIS crop, or null if this crop has no subtotal row at all.",
          anyOf: [
            { type: "null" },
            { type: "object", properties: SUBTOTAL_PROPERTIES, required: ["eggs", "bal_bird", "mortality", "feed_bags", "hd_percent"] },
          ],
        },
        flocks: {
          type: "array",
          description: `One entry per flock block in THIS crop, top to bottom. Every flock appears EXACTLY ONCE. Hard ceiling: at most ${MAX_FLOCKS_IN_SCHEMA} entries.`,
          maxItems: MAX_FLOCKS_IN_SCHEMA,
          items: {
            type: "object",
            properties: {
              display_label_as_written: {
                type: "string",
                description: "The flock's label, normalized to 'BAB-<number>' with an ordinary digit. Never a Roman numeral, never any other prefix.",
              },
              mortality: { type: ["number", "null"], description: "The 'Mort' column — the day's-end total, NOT the stacked first-row sub-number if one is shown." },
              feed_bags: { type: ["number", "null"], description: "The 'Feed' column." },
              eggs_total: { type: ["number", "null"], description: "The 'Total' column — this flock's official egg count." },
              eggs_ii: { type: ["number", "null"], description: "The 'II' column's own figure, read independently of the 'Total' column. The 'I' column is always a dash on this register — never write a number for it anywhere." },
              bird_population: { type: ["number", "null"], description: "The 'Bal Bird' column — this flock's official bird balance." },
              bird_population_readings: {
                type: "array",
                items: { type: ["number", "null"] },
                description: "The 'Bal Bird' figure exactly as written on EACH line of this flock's block, top to bottom. Usually 2 entries if the block has two written lines, 1 if it only has one.",
              },
              hd_percent: { type: ["number", "null"], description: "The '%' column, as written." },
              margin_note: {
                type: ["string", "null"],
                description: "A handwritten note in the MARGIN next to this flock's label block (not in any normal column) — usually a number, sometimes signed/parenthetical, e.g. '(-)2967'. Transcribe exactly as written, or null if there is none.",
              },
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
                required: ["display_label", "mortality", "feed_bags", "eggs_total", "bird_population", "hd_percent"],
              },
              ambiguous_digits: {
                type: ["string", "null"],
                description: "ONLY if something in this row looked genuinely scribbled or uncertain: describe exactly what you saw (e.g. \"the second digit of Mort could be 3 or 8\"). Null for an ordinary, clearly-written row — do not fill this in just to be thorough.",
              },
              row_box: BOX_SCHEMA,
            },
            required: [
              "display_label_as_written", "mortality", "feed_bags", "eggs_total", "eggs_ii",
              "bird_population", "bird_population_readings", "hd_percent", "margin_note",
              "confidence", "ambiguous_digits", "row_box",
            ],
          },
        },
      },
      required: ["region_notes", "subtotal", "flocks"],
    },
  };
}

const BASE_PROMPT = `You are reading a CROPPED section of a photographed Daily Production register page — this crop holds exactly one table of flocks (columns "Mort, Feed | I | II | Total | Bal Bird | %") and, if visible at the bottom, that table's own subtotal row.

GOLDEN RULE: if you cannot clearly read a value, write null and give it low confidence. NEVER guess, NEVER compute a value yourself, NEVER invent a figure that isn't literally written.

Each flock block may span one or two written lines (see bird_population_readings). Eggs is written in exactly TWO places per flock — "II" and "Total" — read them independently; the "I" column is always a dash, never a number.

SUBTOTAL ROW: directly beneath the last flock, if visible in this crop. A genuine subtotal row always has a Bal Bird figure AND a "%" figure alongside its eggs figure — the same shape as a flock's own row. A stock-ledger line below it (running totals, "(+) N", tray counts) has just one bare number and nothing else; never read that as the subtotal.

For EVERY flock, also report row_box — that flock's own row location within THIS crop (not the original photo), normalized 0.0-1.0. And ambiguous_digits — ONLY when a digit genuinely looked uncertain (not a routine field), describe the specific confusion (e.g. "3 or 8").

Digit confusions to watch for in this handwriting specifically: 3 vs 8, 1 vs 7, 1 vs 4, 9 vs 0, 5 vs 6, 2 vs 7, 9 vs 4. Eggs on this farm are always whole trays of 30 — if a total isn't a multiple of 30, look again before finalizing it.

Call record_section_extraction with your findings.`;

export async function extractDailyProductionRegion(
  imageBase64: string,
  mediaType: string,
  section: Section,
  opts: { confusionHint?: string } = {}
): Promise<DailyProductionRegionResult> {
  const client = getAnthropicClient();
  const sectionLabel = section === "main" ? "main (larger) flock table" : "continuation (shorter) flock table";
  const promptText = opts.confusionHint
    ? `${BASE_PROMPT}\n\nRETRY NOTICE — a page-wide checksum didn't match after your first reading: ${opts.confusionHint} Look very carefully at that specific figure before answering again.`
    : BASE_PROMPT;

  const response = await client.messages.create(
    {
      model: EXTRACTION_MODEL,
      max_tokens: 4000,
      tools: [buildTool(sectionLabel)],
      tool_choice: { type: "tool", name: "record_section_extraction" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp", data: imageBase64 },
            },
            { type: "text", text: promptText },
          ],
        },
      ],
    },
    { timeout: 60_000 }
  );

  if (response.stop_reason === "max_tokens") {
    throw new Error(`The model's response was cut off before finishing the ${section} section crop.`);
  }
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(`${section} section extraction call returned no structured result`);
  }
  const input = toolUse.input as {
    region_notes?: unknown;
    subtotal?: unknown;
    flocks?: unknown;
  };

  // Same discipline as every other extraction call in this codebase since
  // the 2026-10-12 production incident: never trust an unchecked field from
  // model JSON, especially an array, this far into a multi-stage pipeline.
  // A zoomed crop of just the subtotal strip legitimately has no flock
  // rows — accept a missing flocks array there as long as a subtotal came
  // back (corrections.ts asks for exactly that).
  if (!Array.isArray(input.flocks)) {
    if (input.subtotal && typeof input.subtotal === "object") input.flocks = [];
    else throw new Error(`${section} section extraction response did not include a usable flocks array`);
  }

  const subtotalRaw = input.subtotal as Record<string, unknown> | null | undefined;
  const subtotal: SectionSubtotal | null =
    subtotalRaw && typeof subtotalRaw === "object"
      ? {
          section,
          eggs: numOrNull(subtotalRaw.eggs),
          bal_bird: numOrNull(subtotalRaw.bal_bird),
          mortality: numOrNull(subtotalRaw.mortality),
          feed_bags: numOrNull(subtotalRaw.feed_bags),
          hd_percent: numOrNull(subtotalRaw.hd_percent),
        }
      : null;

  return {
    flocks: input.flocks as RegionFlockRow[],
    subtotal,
    region_notes: typeof input.region_notes === "string" ? input.region_notes : null,
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
