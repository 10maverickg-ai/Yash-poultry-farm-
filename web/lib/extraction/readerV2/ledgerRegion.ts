import { getAnthropicClient, EXTRACTION_MODEL } from "../anthropicClient";
import { ENTRY_CATEGORIES, type EntryCategory, type EggStockSection } from "../../eggstock-types";

// Reader rebuild, benchmark-only extension (owner request, 2026-10-19):
// one call per egg-ledger CROP (big_egg_ledger or small_egg_ledger),
// adapted field-for-field from the proven whole-page prompt in
// ledgerFeedExtraction.ts — same columns, same golden rule, same
// trays-of-30 check, just asked of one cropped ledger at a time instead of
// both ledgers and both feed boxes in one call. Not wired into the real
// upload flow (that still runs the single whole-page ledgerFeedExtraction
// call, unchanged) — this exists only so the benchmark page can report
// the egg ledger's own accuracy, separately from the flock tables.

export interface ExtractedDeduction {
  label_as_written: string;
  amount_eggs: number;
  category_guess: EntryCategory | null;
  confidence: number;
}

export interface ExtractedEggLedgerRegion {
  opening_balance_eggs: number | null;
  total_eggs_produced: number | null;
  total_line_eggs: number | null;
  deductions: ExtractedDeduction[];
  closing_balance_eggs: number | null;
  region_notes: string | null;
  confidence: {
    opening_balance_eggs: number;
    total_eggs_produced: number;
    total_line_eggs: number;
    closing_balance_eggs: number;
  };
}

const CONFIDENCE_PROP = { type: "number" as const, description: "0.0-1.0" };

function buildTool(sectionLabel: string) {
  return {
    name: "record_egg_ledger_extraction",
    description: `Records the ${sectionLabel} egg stock ledger read from this crop.`,
    input_schema: {
      type: "object" as const,
      properties: {
        region_notes: {
          type: ["string", "null"],
          description: "Anything worth the owner knowing about THIS crop specifically, or null.",
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
      },
      required: [
        "region_notes", "opening_balance_eggs", "total_eggs_produced", "total_line_eggs",
        "deductions", "closing_balance_eggs", "confidence",
      ],
    },
  };
}

function promptFor(sectionLabel: string): string {
  return `You are reading a CROPPED egg stock ledger from a photographed Daily Production register page — this crop holds exactly one ledger: the "${sectionLabel}" one.

GOLDEN RULE: if you cannot clearly read a value, write null and give it low confidence. NEVER guess, NEVER compute a value yourself by adding or subtracting other numbers, NEVER invent a figure that isn't literally written. A downstream system does all the arithmetic and cross-checking — your job is only to report exactly what is written.

This ledger reads top to bottom: an opening balance ("OB"), a "(+)" production figure, a written TOTAL line (do not calculate this — read exactly what's written, even if it looks like it doesn't add up), then a VARIABLE number of deduction lines (a day may have none, one, or several), then a closing balance, then the closing figure in trays (closing ÷ 30 — do NOT read this tray count into closing_balance_eggs, it's a different, smaller number).

Deduction lines: each has a label and a quantity. Read the label EXACTLY as written (a person's name, "Sale", "Farmfresh", "Breakage" — sometimes written "Bark" or similar — "Lab" for the labour's take, or anything else). The quantity is always written as a positive number even though it's a deduction — report it as such (amount_eggs), and separately give your best guess at its category.

Eggs on this farm are ALWAYS counted in whole trays of 30 — every real figure in this ledger (opening, production, total line, every deduction, closing) is a multiple of 30. If a number you're about to write isn't a multiple of 30, look again before finalizing it — it's very likely a misread digit. This is still not a license to force a number to the nearest multiple of 30 if it genuinely reads differently after a careful look — write exactly what's written and lower its confidence instead.

Do NOT look for a sale price anywhere in this ledger — it is never written on this register and is not something you need to report.

Call record_egg_ledger_extraction with your findings.`;
}

export async function extractEggLedgerRegion(
  imageBase64: string,
  mediaType: string,
  section: EggStockSection
): Promise<ExtractedEggLedgerRegion> {
  const client = getAnthropicClient();
  const sectionLabel = section === "big" ? "big (under the BAB-1..7 table)" : "small (under the BAB-8..10 table)";

  const response = await client.messages.create(
    {
      model: EXTRACTION_MODEL,
      max_tokens: 2000,
      tools: [buildTool(sectionLabel)],
      tool_choice: { type: "tool", name: "record_egg_ledger_extraction" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp", data: imageBase64 },
            },
            { type: "text", text: promptFor(sectionLabel) },
          ],
        },
      ],
    },
    { timeout: 60_000 }
  );

  if (response.stop_reason === "max_tokens") {
    throw new Error(`The model's response was cut off before finishing the ${section} egg ledger crop.`);
  }
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(`${section} egg ledger extraction call returned no structured result`);
  }
  const input = toolUse.input as Partial<ExtractedEggLedgerRegion>;
  if (!Array.isArray(input.deductions)) {
    throw new Error(`${section} egg ledger extraction response did not include a usable deductions array`);
  }

  return {
    opening_balance_eggs: numOrNull(input.opening_balance_eggs),
    total_eggs_produced: numOrNull(input.total_eggs_produced),
    total_line_eggs: numOrNull(input.total_line_eggs),
    deductions: input.deductions as ExtractedDeduction[],
    closing_balance_eggs: numOrNull(input.closing_balance_eggs),
    region_notes: typeof input.region_notes === "string" ? input.region_notes : null,
    confidence: input.confidence ?? {
      opening_balance_eggs: 0,
      total_eggs_produced: 0,
      total_line_eggs: 0,
      closing_balance_eggs: 0,
    },
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
