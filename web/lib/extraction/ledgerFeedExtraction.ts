import { getAnthropicClient, EXTRACTION_MODEL } from "./anthropicClient";
import { ENTRY_CATEGORIES, EGG_STOCK_SECTIONS, type EntryCategory, type EggStockSection } from "../eggstock-types";

// Second, SEPARATE vision call (owner request, 2026-10-19) reading the egg
// stock ledger and feed bag box visible on the SAME photo already used for
// the Daily Production extraction — run AFTER that extraction has finished
// and SAVED, and never allowed to affect it. See app/upload/actions.ts for
// how a failure or timeout here is caught and recorded (a
// ledger_extraction_issues row), never thrown up to the Daily Production
// save.
//
// Raw numbers only, exactly as written — all arithmetic (totals, closing
// balances, repairs) happens in code afterward (eggLedgerResolve.ts /
// feedBoxResolve.ts), never asked of the model here.

export const FLOCK_GROUPS = ["BAB-1-7", "BAB-8-10", "ALL"] as const; // "ALL" = the one feed box of the current register (BAB-1..8)
export type FlockGroup = (typeof FLOCK_GROUPS)[number];

export interface ExtractedDeduction {
  label_as_written: string;
  amount_eggs: number; // positive magnitude, as written
  category_guess: EntryCategory | null;
  confidence: number;
}

export interface ExtractedEggLedger {
  section: EggStockSection;
  opening_balance_eggs: number | null;
  total_eggs_produced: number | null;
  total_line_eggs: number | null;
  deductions: ExtractedDeduction[];
  closing_balance_eggs: number | null;
  confidence: {
    opening_balance_eggs: number;
    total_eggs_produced: number;
    total_line_eggs: number;
    closing_balance_eggs: number;
  };
}

export interface ExtractedFeedBox {
  flock_group: FlockGroup;
  opening_balance_bags: number | null;
  produced_bags: number | null;
  total_bags: number | null;
  closing_balance_bags: number | null; // the register's "(-)" line
  consumed_bags: number | null;
  mill_inventory_bags: number | null; // F
  shed_inventory_bags: number | null; // S
  confidence: {
    opening_balance_bags: number;
    produced_bags: number;
    total_bags: number;
    closing_balance_bags: number;
    consumed_bags: number;
    mill_inventory_bags: number;
    shed_inventory_bags: number;
  };
}

export interface LedgerFeedExtractionResult {
  page_notes: string | null;
  egg_ledgers: ExtractedEggLedger[];
  feed_boxes: ExtractedFeedBox[];
}

const CONFIDENCE_PROP = { type: "number" as const, description: "0.0-1.0" };

const EGG_LEDGER_PROPERTIES = {
  section: {
    type: "string" as const,
    enum: [...EGG_STOCK_SECTIONS],
    description: "'big' = the ledger directly under the BAB-1..8 table (right page, the 8 mature flocks). 'small' = the ledger directly under the BAB-9..11 table (left page, the 3 young flocks).",
  },
  opening_balance_eggs: { type: ["number", "null"], description: "The ledger's 'OB' figure — the opening balance." },
  total_eggs_produced: { type: ["number", "null"], description: "The ledger's '(+)' production figure for the day — NOT the total line below it." },
  total_line_eggs: { type: ["number", "null"], description: "The ledger's own written 'total' line (opening + production, as written — do not calculate it yourself, read exactly what's written)." },
  deductions: {
    type: "array",
    description: "Every deduction line below the total, top to bottom, in order. A day may have none, one, or several. Omit entirely (empty array) if there are none.",
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
};

const FEED_BOX_PROPERTIES = {
  flock_group: {
    type: "string" as const,
    enum: [...FLOCK_GROUPS],
    description: "'ALL' = the ONE feed box on the page (it covers the 8 right-page flocks BAB-1 through BAB-8; the left page has no feed box). Older pages may have two boxes: 'BAB-1-7' (flocks BAB-1 through BAB-7) and 'BAB-8-10' (flocks BAB-8 through BAB-10).",
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
};

const EXTRACT_TOOL = {
  name: "record_ledger_feed_extraction",
  description: "Records the egg stock ledger(s) and feed bag box(es) read from the photo.",
  input_schema: {
    type: "object" as const,
    properties: {
      page_notes: {
        type: ["string", "null"],
        description: "Anything worth the owner knowing that doesn't fit a field: illegible sections, unusual marks, a ledger or box you couldn't find at all.",
      },
      egg_ledgers: {
        type: "array",
        description: "One entry per egg ledger you can find (up to 2 — 'small' and 'big'). Omit a ledger entirely (don't include it in this array) if you can't find it on the page at all, rather than guessing its numbers.",
        maxItems: 2,
        items: {
          type: "object",
          properties: EGG_LEDGER_PROPERTIES,
          required: [
            "section", "opening_balance_eggs", "total_eggs_produced", "total_line_eggs",
            "deductions", "closing_balance_eggs", "confidence",
          ],
        },
      },
      feed_boxes: {
        type: "array",
        description: "One entry per feed bag box you can find (up to 2 — 'BAB-1-7' and 'BAB-8-10'). Omit a box entirely if you can't find it at all.",
        maxItems: 2,
        items: {
          type: "object",
          properties: FEED_BOX_PROPERTIES,
          required: [
            "flock_group", "opening_balance_bags", "produced_bags", "total_bags",
            "closing_balance_bags", "consumed_bags", "mill_inventory_bags",
            "shed_inventory_bags", "confidence",
          ],
        },
      },
    },
    required: ["page_notes", "egg_ledgers", "feed_boxes"],
  },
};

const PROMPT = `You are reading the SAME photographed Daily Production register page you were already shown, but this time looking ONLY at two OTHER things on it: the Egg Stock Ledger(s) and the Feed Bag Box(es). Ignore every flock's Mort/Feed/Total/Bal Bird/% row entirely — that has already been read separately. Also ignore anything about chicks (the two "Chicks" rows, or any chick count) — not needed here.

GOLDEN RULE: if you cannot clearly read a value, write null and give it low confidence. NEVER guess, NEVER compute a value yourself by adding or subtracting other numbers, NEVER invent a figure that isn't literally written. A downstream system does all the arithmetic and cross-checking — your job is only to report exactly what is written.

EGG STOCK LEDGER — two parallel running ledgers, each directly below one of the flock tables and its subtotal row:
- The "big" ledger sits under the BAB-1..8 table (the right page, 8 mature flocks).
- The "small" ledger sits under the BAB-9..11 table (the left page, 3 young flocks; that table has no Feed column).
Each ledger reads top to bottom: an opening balance ("OB"), a "(+)" production figure, a written TOTAL line (do not calculate this — read exactly what's written, even if it looks like it doesn't add up), then a VARIABLE number of deduction lines (a day may have none, one, or several), then a closing balance, then the closing figure in trays (closing ÷ 30 — do NOT read this tray count into closing_balance_eggs, it's a different, smaller number).

Deduction lines: each has a label and a quantity. Read the label EXACTLY as written (a person's name, "Sale", "Farmfresh", "Breakage" — sometimes written "Bark" or similar — "Lab" for the labour's take, or anything else). The quantity is always written as a positive number even though it's a deduction — report it as such (amount_eggs), and separately give your best guess at its category. A sale to Farmfresh is usually a large quantity; a local buyer or named person is usually small and is a SEPARATE kind of line from a Farmfresh sale, even though both are called "sale" in casual terms.

Eggs on this farm are ALWAYS counted in whole trays of 30 — every real figure in this ledger (opening, production, total line, every deduction, closing) is a multiple of 30. If a number you're about to write isn't a multiple of 30, look again before finalizing it — it's very likely a misread digit (commonly 3/8, 1/7, 5/6, 4/9, or 4/8 confused, or a dropped/added trailing zero). This is still not a license to force a number to the nearest multiple of 30 if it genuinely reads differently after a careful look — write exactly what's written and lower its confidence instead. A downstream system also checks this and will flag it either way.

Do NOT look for a sale price anywhere in this ledger — it is never written on this register (it changes daily) and is not something you need to report.

FEED BAG BOX — there is now ONE feed box on the page, near the top of the right page; it covers the 8 right-page flocks BAB-1 through BAB-8 (report its flock_group as "ALL"). The left page has no feed box and no feed column. (An older page may show two boxes side by side: a LEFT box for BAB-1 through BAB-7 reported as "BAB-1-7" and a RIGHT box for BAB-8 through BAB-10 reported as "BAB-8-10".) The box reads top to bottom: "OB =" (opening balance in bags), "(+)" (bags received from the mill that day), a written total line (OB + the "(+)" figure, as written — do not calculate it), a "(-)" line (the CLOSING balance currently in stock — this is written as a figure to be SUBTRACTED from the total, do not treat it as the consumption figure itself), then the consumption figure itself (total minus the "(-)" line, as written), then "F =" (bags still at the feed mill) and "S =" (bags already moved to the shed) underneath. Bags are NOT trays-of-30 — do not apply that rule here.

If either the egg ledger or the feed box is illegible, missing, or you genuinely can't find it anywhere on the page, omit that entry from the array entirely (don't include a ledger/box with every field null) and mention it in page_notes instead.

Call record_ledger_feed_extraction with your findings.`;

export async function extractLedgerAndFeed(
  imageBase64: string,
  mediaType: string
): Promise<LedgerFeedExtractionResult> {
  const client = getAnthropicClient();

  const response = await client.messages.create(
    {
      model: EXTRACTION_MODEL,
      max_tokens: 3000,
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
    },
    // Owner request, 2026-10-19: this call must never hang the upload — a
    // firm timeout so a slow/stuck response is caught and recorded (see
    // app/upload/actions.ts) rather than left to the SDK's own much longer
    // default.
    { timeout: 90_000 }
  );

  if (response.stop_reason === "max_tokens") {
    throw new Error("The model's response was cut off before finishing reading the ledger/feed box.");
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Ledger/feed extraction call returned no structured result");
  }
  const input = toolUse.input as LedgerFeedExtractionResult;
  if (!Array.isArray(input.egg_ledgers) || !Array.isArray(input.feed_boxes)) {
    throw new Error("Ledger/feed extraction response did not include usable egg_ledgers/feed_boxes arrays");
  }
  return input;
}
