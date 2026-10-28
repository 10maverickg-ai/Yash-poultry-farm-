import { getAnthropicClient, EXTRACTION_MODEL } from "../anthropicClient";
import { ENTRY_CATEGORIES } from "../../eggstock-types";
import type { NormalizedBox } from "./types";
import type { ExtractedEggLedgerRegion, ExtractedDeduction } from "./ledgerRegion";
import type { ExtractedFeedBoxRegion, FeedBoxGroupLabel } from "./feedBoxRegion";
import type { ExtractedChickRows } from "./chickRowsRegion";

// Reader rebuild, stage 2 (owner report, 2026-10-21, replacing the
// region-box approach — see pageSplit.ts's header comment for why). One
// call per HALF of the two-page spread (left, right — pageSplit.ts's
// deterministic, non-LLM split), at that half's own full resolution,
// asking for EVERYTHING actually visible on it in one shot: the flock
// table (if one is here) plus its subtotal, the egg ledger (if one is
// here), the feed box(es) (if any are here), and the chick rows (if they're
// here). No bounding boxes for any of these items
// themselves; the only box asked for is each flock's own row_box, kept
// for exactly one purpose — a later checksum-guided retry can zoom into
// that one row (crop.ts's recropForRetry) without re-reading the whole
// half.
//
// Revised 2026-10-21 (owner report — Aug 8 run: the page was upside down
// inside the pipeline, so the "left = feed boxes, right = flock table"
// expectation baked into these prompts made every half report nothing):
// nothing here assumes which side holds what any more. Each call is told
// to IDENTIFY what is on the half it was given — flock table, feed
// box(es), egg ledger, chick rows — and return exactly that; callers map
// results by CONTENT (contentMapping.ts), never by side. A thin sliver of
// the neighbouring page can appear along the edge facing the spine (the
// split deliberately overlaps ~4%), and the prompt says to ignore it.
// Each call also reads the date written at the top of the page, if it is
// on this half, at full resolution (orientation is now read from a
// low-resolution copy and no longer returns the date).

export type HalfSide = "left" | "right";

export interface HalfFlockRow {
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
  // Relative to THIS HALF image (not the original photo, not the other
  // half) — the only box in this whole stage, kept solely so a later
  // checksum-guided retry can zoom into exactly this row.
  row_box: NormalizedBox;
}

export interface HalfSubtotal {
  eggs: number | null;
  bal_bird: number | null;
  mortality: number | null;
  feed_bags: number | null;
  hd_percent: number | null;
}

export interface HalfTable {
  flocks: HalfFlockRow[];
  subtotal: HalfSubtotal | null;
  region_notes: string | null;
}

export interface HalfFeedBox extends ExtractedFeedBoxRegion {
  // Which flocks this specific box covers, read from the box's own label
  // (or "ALL" if this farm currently uses one box for everyone) — unlike
  // feedBoxRegion.ts's dedicated per-crop call, this call can see MULTIPLE
  // boxes at once, so it has to say which is which itself.
  coverage: FeedBoxGroupLabel;
}

export interface PageHalfExtraction {
  table: HalfTable | null;
  ledger: ExtractedEggLedgerRegion | null;
  feedBoxes: HalfFeedBox[];
  chickRows: ExtractedChickRows | null;
  half_notes: string | null;
  // Date written at the top of the page, if THIS half shows it.
  page_date: string | null;
  page_date_confidence: number;
}

const CONFIDENCE_PROP = { type: "number" as const, description: "0.0-1.0" };

const BOX_SCHEMA = {
  type: "object" as const,
  description: "This flock's own row, normalized 0.0-1.0 WITHIN THIS HALF IMAGE (not the original photo, not the other half).",
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
  },
  required: ["x", "y", "width", "height"],
};

const MAX_FLOCKS_IN_SCHEMA = 15;

const SUBTOTAL_PROPERTIES = {
  eggs: { type: ["number", "null"], description: "This section's subtotal row 'Total' (egg count) figure, as written. Null if not legible, or if you're not confident this is really the subtotal row (see the row-signature test below) rather than a stock-ledger line." },
  bal_bird: { type: ["number", "null"], description: "This section's subtotal row 'Bal Bird' figure, as written. A genuine subtotal row always has one — if you can't find a Bal Bird figure at this row, you are very likely looking at a stock-ledger line instead, and the whole entry should be treated as not found." },
  mortality: { type: ["number", "null"], description: "This section's subtotal row 'Mort' figure, as written. Null if not legible or not present." },
  feed_bags: { type: ["number", "null"], description: "This section's subtotal row 'Feed' figure, as written. Null if not legible or not present." },
  hd_percent: { type: ["number", "null"], description: "This section's subtotal row '%' figure, as written. A genuine subtotal row always has one, same as Bal Bird — a stock-ledger line never does." },
};

const TABLE_SCHEMA = {
  anyOf: [
    { type: "null" as const },
    {
      type: "object" as const,
      description: "The flock table on THIS half, plus its own subtotal row — omit entirely (null) if this half has no flock table at all.",
      properties: {
        region_notes: {
          type: ["string", "null"],
          description: "Anything worth the owner knowing about the table on THIS half specifically — illegible areas, smudges — or null.",
        },
        subtotal: {
          description: "The subtotal row directly beneath the last flock in this table, or null if no subtotal row is visible.",
          anyOf: [
            { type: "null" },
            { type: "object", properties: SUBTOTAL_PROPERTIES, required: ["eggs", "bal_bird", "mortality", "feed_bags", "hd_percent"] },
          ],
        },
        flocks: {
          type: "array",
          description: `One entry per flock block in this table, top to bottom. Every flock appears EXACTLY ONCE. Hard ceiling: at most ${MAX_FLOCKS_IN_SCHEMA} entries.`,
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
  ],
};

const LEDGER_SCHEMA = {
  anyOf: [
    { type: "null" as const },
    {
      type: "object" as const,
      description: "The egg stock ledger on THIS half — omit entirely (null) if this half has no egg ledger at all.",
      properties: {
        region_notes: {
          type: ["string", "null"],
          description: "Anything worth the owner knowing about this ledger specifically, or null.",
        },
        opening_balance_eggs: { type: ["number", "null"], description: "The number written next to the ledger's \"(+)\" sign — on this register that number IS the opening balance (there is usually no \"OB\" label on the egg ledger)." },
        total_eggs_produced: { type: ["number", "null"], description: "The day's produced figure = the SUBTOTAL row's 'Total' (egg count) figure directly above the ledger (the same figure as the table's subtotal). It is not written inside the ledger itself; read it from the subtotal row." },
        total_line_eggs: { type: ["number", "null"], description: "The ledger's own written 'total' line (opening + production, as written — do not calculate it yourself, read exactly what's written)." },
        deductions: {
          type: "array",
          description: "Every deduction line — each one written with a \"(−)\" sign and a label — below the total, top to bottom. A bare unlabelled number between two deductions is a RUNNING REMAINDER (total minus the deductions so far), never a deduction. A day may have none, one, or several; use an empty array if there are none.",
          items: {
            type: "object",
            properties: {
              label_as_written: { type: "string", description: "The line's label exactly as written (e.g. 'Sale', 'Farmfresh', a person's name, 'Breakage', 'Bark', 'Lab', 'Labour take'). Keep it as written, even if you're not sure what it means." },
              amount_eggs: { type: "number", description: "The quantity on this line, as a positive number (the sign is implied by it being a deduction, not written as part of the figure)." },
              category_guess: {
                type: ["string", "null"],
                enum: [...ENTRY_CATEGORIES, null],
                description: "Your best guess at classifying this line: 'sale' for a sale to Farmfresh (large quantities, usually explicitly labeled), 'local_sale' for a local buyer or person's name (usually small quantities), 'breakage' for breakage/'bark', 'labour_take' for the labour's take ('Lab'), 'other' for anything else. Null if you can't tell.",
              },
              confidence: CONFIDENCE_PROP,
            },
            required: ["label_as_written", "amount_eggs", "category_guess", "confidence"],
          },
        },
        closing_balance_eggs: { type: ["number", "null"], description: "The ledger's final closing balance, as written (not the tray count below it — that's eggs ÷ 30, do not read it here)." },
        confidence: {
          type: "object",
          description: "0.0-1.0 self-assessed confidence per field, independent of any arithmetic check.",
          properties: {
            opening_balance_eggs: CONFIDENCE_PROP,
            total_eggs_produced: CONFIDENCE_PROP,
            total_line_eggs: CONFIDENCE_PROP,
            closing_balance_eggs: CONFIDENCE_PROP,
          },
          required: ["opening_balance_eggs", "total_eggs_produced", "total_line_eggs", "closing_balance_eggs"],
        },
      },
      required: [
        "region_notes", "opening_balance_eggs", "total_eggs_produced", "total_line_eggs",
        "deductions", "closing_balance_eggs", "confidence",
      ],
    },
  ],
};

const FEED_BOX_ITEM_SCHEMA = {
  type: "object" as const,
  properties: {
    coverage: {
      type: "string",
      enum: ["BAB-1-7", "BAB-8-10", "ALL"],
      description: "Which flocks this specific box covers, read from its own label — 'ALL' only if this farm currently uses ONE box for every flock.",
    },
    region_notes: {
      type: ["string", "null"],
      description: "Anything worth the owner knowing about THIS box specifically, or null.",
    },
    opening_balance_bags: { type: ["number", "null"], description: "The box's 'OB =' figure." },
    produced_bags: { type: ["number", "null"], description: "The box's '(+)' figure — bags received from the feed mill that day." },
    total_bags: { type: ["number", "null"], description: "The box's written total line (OB + the '(+)' figure, as written — do not calculate it yourself)." },
    closing_balance_bags: { type: ["number", "null"], description: "The box's '(-)' line — the closing balance in stock (this is SUBTRACTED from the total to get consumption, read exactly what's written)." },
    consumed_bags: { type: ["number", "null"], description: "The box's own written consumption figure (total minus the '(-)' line, as written on the page)." },
    mill_inventory_bags: { type: ["number", "null"], description: "The box's 'F =' figure — bags still at the feed mill." },
    shed_inventory_bags: { type: ["number", "null"], description: "The box's 'S =' figure — bags already moved to the shed." },
    confidence: {
      type: "object",
      description: "0.0-1.0 self-assessed confidence per field, independent of any arithmetic check.",
      properties: {
        opening_balance_bags: CONFIDENCE_PROP,
        produced_bags: CONFIDENCE_PROP,
        total_bags: CONFIDENCE_PROP,
        closing_balance_bags: CONFIDENCE_PROP,
        consumed_bags: CONFIDENCE_PROP,
        mill_inventory_bags: CONFIDENCE_PROP,
        shed_inventory_bags: CONFIDENCE_PROP,
      },
      required: [
        "opening_balance_bags", "produced_bags", "total_bags", "closing_balance_bags",
        "consumed_bags", "mill_inventory_bags", "shed_inventory_bags",
      ],
    },
  },
  required: [
    "coverage", "region_notes", "opening_balance_bags", "produced_bags", "total_bags",
    "closing_balance_bags", "consumed_bags", "mill_inventory_bags", "shed_inventory_bags",
    "confidence",
  ],
};

const CHICK_ROWS_SCHEMA = {
  anyOf: [
    { type: "null" as const },
    {
      type: "object" as const,
      description: "The chick-rows block on THIS half — omit entirely (null) if it isn't here.",
      properties: {
        region_notes: {
          type: ["string", "null"],
          description: "Anything worth the owner knowing about this block specifically, or null.",
        },
        rows: {
          type: "array",
          description: "One entry per chick row visible, top to bottom. Usually '1 Chick' and '2 Chick'; occasionally a third row for chicks from Anil farm.",
          items: {
            type: "object",
            properties: {
              label_as_written: {
                type: "string",
                description: "The row's label exactly as written (e.g. '1 Chick', '2 Chick', or whatever a third row is labeled).",
              },
              deaths: { type: ["number", "null"], description: "The mortality/deaths figure on this row, as written. Null if not legible." },
              confidence: { type: "number", description: "0.0-1.0" },
            },
            required: ["label_as_written", "deaths", "confidence"],
          },
        },
      },
      required: ["region_notes", "rows"],
    },
  ],
};

function buildTool() {
  return {
    name: "record_half_page_extraction",
    description: "Records everything actually visible on this half of a photographed register spread.",
    input_schema: {
      type: "object" as const,
      properties: {
        half_notes: {
          type: ["string", "null"],
          description: "Anything worth the owner knowing about this half as a whole that doesn't fit one of the items below, or null.",
        },
        page_date: {
          type: ["string", "null"],
          description: "The date written at the top of the page, as YYYY-MM-DD, if it is visible on THIS half. Null if this half doesn't show a date or it is illegible.",
        },
        page_date_confidence: { type: "number", description: "0.0-1.0" },
        table: TABLE_SCHEMA,
        ledger: LEDGER_SCHEMA,
        chick_rows: CHICK_ROWS_SCHEMA,
        feed_boxes: {
          type: "array",
          description: "Every feed bag box visible on this half (there may be none, one, or two). Empty array if none.",
          maxItems: 2,
          items: FEED_BOX_ITEM_SCHEMA,
        },
      },
      required: ["half_notes", "page_date", "page_date_confidence", "table", "ledger", "chick_rows", "feed_boxes"],
    },
  };
}

const GOLDEN_RULE = `GOLDEN RULE (applies to every field below): if you cannot clearly read a value, write null and give it low confidence. NEVER guess, NEVER compute a value yourself by adding or subtracting other numbers, NEVER invent a figure that isn't literally written. A downstream system does all the arithmetic and cross-checking — your job is only to report exactly what is written.

Never force an item into existence just because it is usually here — if a table, ledger, feed box, or chick-row block genuinely isn't visible on THIS half, report it as null/empty rather than guessing. Never hard-code or assume flock labels, row counts, or box counts — read each one directly off this image.`;

const TABLE_INSTRUCTIONS = `FLOCK TABLE (if one is on this half): columns "Mort, Feed | I | II | Total | Bal Bird | %". Each flock block may span one or two written lines (see bird_population_readings). Eggs is written in exactly TWO places per flock — "II" and "Total" — read them independently; the "I" column is always a dash, never a number.

SUBTOTAL ROW: directly beneath the last flock, if visible. It has no flock label; its Mort and Feed cells are the sums for the section (e.g. "31 | 142"), followed by the egg Total, the Bal Bird sum and the section's %. A genuine subtotal row always has a Bal Bird figure AND a "%" figure alongside its eggs figure — the same shape as a flock's own row. A stock-ledger line below it (running totals, "(+) N", tray counts) has just one bare number and nothing else; never read that as the subtotal.

For EVERY flock, also report row_box — that flock's own row location WITHIN THIS HALF IMAGE, normalized 0.0-1.0. And ambiguous_digits — ONLY when a digit genuinely looked uncertain, describe the specific confusion (e.g. "3 or 8").

Digit confusions to watch for in this handwriting specifically: 3 vs 8, 1 vs 7, 1 vs 4, 9 vs 0, 5 vs 6, 2 vs 7, 9 vs 4. Eggs on this farm are always whole trays of 30 — if a total isn't a multiple of 30, look again before finalizing it.`;

const LEDGER_INSTRUCTIONS = `EGG STOCK LEDGER (if one is on this half): there is one directly under each flock table's subtotal row (the big one under the BAB-1..8 table on the right page, a small one under the BAB-9..11 table on the left page). Quirk of this register — read it exactly like this:
  1. The number written next to the "(+)" sign IS THE OPENING BALANCE (opening_balance_eggs). There is normally no "OB" label.
  2. "Produced" is the day's SUBTOTAL: the "Total" (egg count) figure of the flock table's subtotal row directly above the ledger. Report that figure as total_eggs_produced.
  3. The written TOTAL line below "(+)" is opening + produced (read exactly what's written, never calculate it).
  4. Then the deduction lines, each a "(−)" with a label (e.g. Sale, Breakage, Local, Lab). A bare unlabelled number between deductions is the running remainder after the deductions so far — skip it, it is not a deduction.
  5. Then the closing balance (= total minus every deduction), then a smaller tray count (closing ÷ 30) — never read the tray count as the closing balance.
The small ledger follows the same pattern but usually has no deduction or only a tiny one (e.g. 90 eggs), so its closing equals or is just below its total.

Eggs on this farm are ALWAYS counted in whole trays of 30 — every real figure in the ledger is a multiple of 30. If a number you're about to write isn't, look again before finalizing it — it's very likely a misread digit. Do NOT look for a sale price anywhere in this ledger.`;

const FEED_BOX_INSTRUCTIONS = `FEED BAG BOX: ONE hand-drawn box sits near the top of the right page; it covers the 8 right-page flocks BAB-1..BAB-8. The left page (BAB-9..11) has no feed box and no feed column. (Older pages had two boxes side by side, one for BAB-1..7 and one for BAB-8..10.) Each box is ONE column that reads top to bottom: "OB =" (opening balance in bags), "(+)" (bags received from the mill that day), a written total line (OB + the "(+)" figure, as written — do not calculate it), a "(-)" line (the CLOSING balance in stock — written as a figure to be SUBTRACTED from the total, not the consumption), then the consumption figure itself (total minus the "(-)" line, as written), and — lower down, after some blank lines, still in the same column — "F =" (bags still at the feed mill), "S =" (bags already moved to the shed) and their sum (= the closing balance). The F/S lines belong to the SAME box as the OB/(+) lines above them in that column: never report them as a separate box. Report each box once. The consumption figure must equal the sum of the Feed column of the flocks that box covers — use that to sanity-check what you read. Bags are NOT trays-of-30 — do not apply that rule here.`;

const CHICK_INSTRUCTIONS = `CHICK ROWS (if visible on this half): a small block listing the TWO chick batches as two rows ("1 Chick" and "2 Chick") each with its own daily mortality/deaths figure. Occasionally a third row appears for chicks sourced from Anil farm.`;

function promptFor(side: HalfSide): string {
  return `You are reading the ${side.toUpperCase()} HALF of a photographed Daily Production register spread — the photo has been turned upright and split at the page's spine (the vertical fold between the two paper pages). A thin sliver of the NEIGHBOURING page may show along the edge that faces the spine; ignore it.

Your first job is to IDENTIFY what is on this half. Any of these may be present, in any combination, and the other half may hold different ones — do not assume what belongs on which side:
  - a flock table (rows labelled BAB-<number>, columns Mort / Feed / I / II / Total / Bal Bird / %) with its subtotal row,
  - an egg stock ledger (OB, (+), a total line, deduction lines, a closing balance),
  - one or two feed bag boxes (OB = / (+) / (-) / F = / S =),
  - the chick rows ("1 Chick", "2 Chick"),
  - the date written at the top of the page.
Then read each one you found, exactly as written. Report what is actually here — if an item isn't on this half, return null (or an empty list for feed boxes); never force one into existence, and never assume flock labels, row counts, or box counts — read them directly off this image.

${GOLDEN_RULE}

${[TABLE_INSTRUCTIONS, LEDGER_INSTRUCTIONS, FEED_BOX_INSTRUCTIONS, CHICK_INSTRUCTIONS].join("\n\n")}

Call record_half_page_extraction with your findings.`;
}

export async function extractPageHalf(
  imageBase64: string,
  mediaType: string,
  side: HalfSide,
  opts: { confusionHint?: string } = {}
): Promise<PageHalfExtraction> {
  const client = getAnthropicClient();
  const promptText = opts.confusionHint
    ? `${promptFor(side)}\n\nRETRY NOTICE — something on this half didn't check out after your first reading: ${opts.confusionHint} Look very carefully at those specific figures before answering again.`
    : promptFor(side);

  const response = await client.messages.create(
    {
      model: EXTRACTION_MODEL,
      max_tokens: 6000,
      tools: [buildTool()],
      tool_choice: { type: "tool", name: "record_half_page_extraction" },
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
    { timeout: 120_000 }
  );

  if (response.stop_reason === "max_tokens") {
    throw new Error(`The model's response was cut off before finishing the ${side} half.`);
  }
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(`${side}-half extraction call returned no structured result`);
  }
  const input = toolUse.input as {
    half_notes?: unknown;
    table?: unknown;
    ledger?: unknown;
    chick_rows?: unknown;
    feed_boxes?: unknown;
    page_date?: unknown;
    page_date_confidence?: unknown;
  };

  const table = parseTable(input.table);
  const ledger = parseLedger(input.ledger);
  const chickRows = parseChickRows(input.chick_rows);
  const feedBoxes = Array.isArray(input.feed_boxes) ? input.feed_boxes.map(parseFeedBox).filter((b): b is HalfFeedBox => b !== null) : [];

  return {
    table,
    ledger,
    feedBoxes,
    chickRows,
    half_notes: typeof input.half_notes === "string" ? input.half_notes : null,
    page_date: typeof input.page_date === "string" ? input.page_date : null,
    page_date_confidence: typeof input.page_date_confidence === "number" ? input.page_date_confidence : 0,
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseTable(raw: unknown): HalfTable | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.flocks)) return null;
  const subtotalRaw = r.subtotal as Record<string, unknown> | null | undefined;
  const subtotal: HalfSubtotal | null =
    subtotalRaw && typeof subtotalRaw === "object"
      ? {
          eggs: numOrNull(subtotalRaw.eggs),
          bal_bird: numOrNull(subtotalRaw.bal_bird),
          mortality: numOrNull(subtotalRaw.mortality),
          feed_bags: numOrNull(subtotalRaw.feed_bags),
          hd_percent: numOrNull(subtotalRaw.hd_percent),
        }
      : null;
  return {
    flocks: r.flocks as HalfFlockRow[],
    subtotal,
    region_notes: typeof r.region_notes === "string" ? r.region_notes : null,
  };
}

function parseLedger(raw: unknown): ExtractedEggLedgerRegion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.deductions)) return null;
  return {
    opening_balance_eggs: numOrNull(r.opening_balance_eggs),
    total_eggs_produced: numOrNull(r.total_eggs_produced),
    total_line_eggs: numOrNull(r.total_line_eggs),
    deductions: r.deductions as ExtractedDeduction[],
    closing_balance_eggs: numOrNull(r.closing_balance_eggs),
    region_notes: typeof r.region_notes === "string" ? r.region_notes : null,
    confidence: (r.confidence as ExtractedEggLedgerRegion["confidence"]) ?? {
      opening_balance_eggs: 0,
      total_eggs_produced: 0,
      total_line_eggs: 0,
      closing_balance_eggs: 0,
    },
  };
}

function parseChickRows(raw: unknown): ExtractedChickRows | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.rows)) return null;
  return {
    rows: r.rows as ExtractedChickRows["rows"],
    region_notes: typeof r.region_notes === "string" ? r.region_notes : null,
  };
}

function parseFeedBox(raw: unknown): HalfFeedBox | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const coverage = r.coverage;
  if (coverage !== "BAB-1-7" && coverage !== "BAB-8-10" && coverage !== "ALL") return null;
  return {
    coverage,
    opening_balance_bags: numOrNull(r.opening_balance_bags),
    produced_bags: numOrNull(r.produced_bags),
    total_bags: numOrNull(r.total_bags),
    closing_balance_bags: numOrNull(r.closing_balance_bags),
    consumed_bags: numOrNull(r.consumed_bags),
    mill_inventory_bags: numOrNull(r.mill_inventory_bags),
    shed_inventory_bags: numOrNull(r.shed_inventory_bags),
    region_notes: typeof r.region_notes === "string" ? r.region_notes : null,
    confidence: (r.confidence as ExtractedFeedBoxRegion["confidence"]) ?? {
      opening_balance_bags: 0,
      produced_bags: 0,
      total_bags: 0,
      closing_balance_bags: 0,
      consumed_bags: 0,
      mill_inventory_bags: 0,
      shed_inventory_bags: 0,
    },
  };
}
