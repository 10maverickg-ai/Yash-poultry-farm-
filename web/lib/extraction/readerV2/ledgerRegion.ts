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

Quirk of this register — this ledger reads top to bottom like this: the number written next to the "(+)" sign IS THE OPENING BALANCE (there is normally no "OB" label); a written TOTAL line (opening + the day's produced figure — do not calculate this, read exactly what's written, even if it looks like it doesn't add up); then a VARIABLE number of deduction lines, each a "(−)" with a label (a day may have none, one, or several); a bare unlabelled number between two deductions is the RUNNING REMAINDER after the deductions so far and is NOT a deduction; then the closing balance, then the closing figure in trays (closing ÷ 30 — do NOT read this tray count into closing_balance_eggs, it's a different, smaller number). If the crop also shows the flock table above the ledger, the subtotal row (the unlabelled row with Mort, Feed, Total, Bal Bird and % figures) is NOT part of the ledger — its Total is never the opening balance and never a deduction; the ledger starts at the line written with "(+)". A ledger whose deduction lines are absent simply has closing = total line. The day's "produced" figure is not written inside the ledger: it is the subtotal row's egg Total directly above the ledger — if that row is visible in this crop, report it as total_eggs_produced, otherwise null.

Deduction lines: each has a label and a quantity. Read the label EXACTLY as written (a person's name, "Sale", "Farmfresh", "Breakage" — sometimes written "Bark" or similar — "Lab" for the labour's take, or anything else). The quantity is always written as a positive number even though it's a deduction — report it as such (amount_eggs), and separately give your best guess at its category.

Eggs on this farm are ALWAYS counted in whole trays of 30 — every real figure in this ledger (opening, production, total line, every deduction, closing) is a multiple of 30. If a number you're about to write isn't a multiple of 30, look again before finalizing it — it's very likely a misread digit. This is still not a license to force a number to the nearest multiple of 30 if it genuinely reads differently after a careful look — write exactly what's written and lower its confidence instead.

Do NOT look for a sale price anywhere in this ledger — it is never written on this register and is not something you need to report.

Call record_egg_ledger_extraction with your findings.`;
}

export async function extractEggLedgerRegion(
  imageBase64: string,
  mediaType: string,
  section: EggStockSection,
  opts: { confusionHint?: string } = {}
): Promise<ExtractedEggLedgerRegion> {
  const client = getAnthropicClient();
  const sectionLabel = section === "big" ? "big (under the BAB-1..7 table)" : "small (under the BAB-8..10 table)";
  const promptText = opts.confusionHint
    ? `${promptFor(sectionLabel)}\n\nRETRY NOTICE — this ledger's own arithmetic didn't check out after your first reading: ${opts.confusionHint} Look very carefully at those specific figures before answering again.`
    : promptFor(sectionLabel);

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
            { type: "text", text: promptText },
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

// ---------------------------------------------------------------------
// Line-by-line ledger transcription (owner request, 2026-10-21: the
// big-ledger quirk). Asking the model to fill OB / produced / total /
// closing fields invites it to slot figures into the wrong field (it
// reads the subtotal row's Total as the opening balance, a running
// remainder as a deduction, the tray count as the closing balance...).
// So for the zoomed re-read it only TRANSCRIBES: every handwritten line
// from the subtotal row downward, top to bottom, each tagged with what
// kind of line it is. The register's quirk is then applied in plain code:
//   - the figure on the "(+)" line IS the opening balance;
//   - the first unsigned line after it is the written total (OB + the
//     day's subtotal);
//   - every "(−)" line is a deduction; unsigned lines between/after them
//     are running remainders;
//   - closing = the last unsigned line (which is the total itself when
//     there are no deductions); a second, smaller figure beside it is
//     the tray count and is ignored.
// ---------------------------------------------------------------------

export type LedgerLineKind = "subtotal" | "plus" | "minus" | "plain";

export interface LedgerLine {
  kind: LedgerLineKind;
  label: string | null;
  figure: number | null; // the figure in the Total column (the wide column)
}

const LINES_TOOL = {
  name: "record_ledger_lines",
  description: "Transcribes the handwritten lines from the table's subtotal row downward, top to bottom, exactly as written.",
  input_schema: {
    type: "object" as const,
    properties: {
      region_notes: { type: ["string", "null"], description: "Anything worth the owner knowing, or null." },
      lines: {
        type: "array",
        description: "One entry per handwritten line, from the subtotal row downward, top to bottom. Include EVERY written line, even ones you think are just working-out.",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: ["subtotal", "plus", "minus", "plain"],
              description: "'subtotal' = the unlabelled table row with Mort, Feed, Total, Bal Bird and % figures (it ends the flock table); 'plus' = a line written with a (+) sign; 'minus' = a line written with a (−) sign and usually a name/label (Sale, Buy, Lab, Breakage, Local, a person's name...); 'plain' = a bare figure with no sign.",
            },
            label: { type: ["string", "null"], description: "The name written beside a 'minus' line (e.g. 'Sale', 'Lab', 'Local'), exactly as written; null if none." },
            figure: { type: ["number", "null"], description: "The figure written in the TOTAL column (the wide column under 'Total', the same column the flock egg totals sit in). Never the figure from the Bal Bird / tray column to its right. Null if illegible." },
          },
          required: ["kind", "label", "figure"],
        },
      },
    },
    required: ["region_notes", "lines"],
  },
};

function linesPrompt(sectionLabel: string): string {
  return `You are looking at part of a photographed Daily Production register page: the bottom of a flock table, its SUBTOTAL ROW, and the egg stock ledger written directly under that subtotal row — the ${sectionLabel}.

Your ONLY job is to transcribe, top to bottom, every handwritten line from the SUBTOTAL ROW downward (the unlabelled table row with Mort, Feed, Total, Bal Bird and % figures), tagging each line as 'subtotal', 'plus' (written with a (+) sign), 'minus' (written with a (−) sign, usually with a name such as Sale / Buy / Lab / Breakage / Local), or 'plain' (a bare figure). For each, give the figure in the TOTAL column (the wide column the flock egg totals sit in) — never a figure from the narrower column to its right (that one holds the Bal Bird sum or a tray count).

Do NOT interpret: do not decide which figure is the opening balance, the produced figure, the total or the closing; do not calculate anything; do not skip a line because it looks like working-out. Faint, mirrored or ghosted writing bleeding through from the other side of the paper is not part of the page — ignore it. If a figure can't be read clearly, give null. Eggs on this farm are counted in whole trays of 30 — every real figure in the ledger is a multiple of 30; if a figure you read isn't, look again.

Call record_ledger_lines with your transcription.`;
}

export function interpretLedgerLines(lines: LedgerLine[], regionNotes: string | null): ExtractedEggLedgerRegion {
  const afterSubtotal = (() => {
    const i = lines.findIndex((l) => l.kind === "subtotal");
    return i >= 0 ? lines.slice(i + 1) : lines;
  })();
  const plusIdx = afterSubtotal.findIndex((l) => l.kind === "plus");
  const opening = plusIdx >= 0 ? afterSubtotal[plusIdx].figure : null;
  const body = plusIdx >= 0 ? afterSubtotal.slice(plusIdx + 1) : [];
  const firstPlain = body.findIndex((l) => l.kind === "plain");
  const total = firstPlain >= 0 ? body[firstPlain].figure : null;
  const rest = firstPlain >= 0 ? body.slice(firstPlain + 1) : [];
  const deductions: ExtractedDeduction[] = rest
    .filter((l) => l.kind === "minus" && l.figure !== null)
    .map((l) => ({ label_as_written: l.label ?? "", amount_eggs: l.figure as number, category_guess: null, confidence: 0.5 }));
  const lastMinus = rest.map((l) => l.kind).lastIndexOf("minus");
  const afterLastMinus = rest.slice(lastMinus + 1).filter((l) => l.kind === "plain");
  const closing = lastMinus >= 0 ? (afterLastMinus.length > 0 ? afterLastMinus[afterLastMinus.length - 1].figure : null) : total;
  return {
    opening_balance_eggs: opening,
    total_eggs_produced: null, // the day's subtotal — filled in by the caller
    total_line_eggs: total,
    deductions,
    closing_balance_eggs: closing,
    region_notes: regionNotes,
    confidence: { opening_balance_eggs: 0.5, total_eggs_produced: 0, total_line_eggs: 0.5, closing_balance_eggs: 0.5 },
  };
}

export async function extractEggLedgerByLines(
  imageBase64: string,
  mediaType: string,
  section: EggStockSection,
  opts: { confusionHint?: string } = {}
): Promise<ExtractedEggLedgerRegion> {
  const client = getAnthropicClient();
  const sectionLabel = section === "big" ? "big ledger (under the BAB-1..7 table)" : "small ledger (under the BAB-8..10 table)";
  const promptText = opts.confusionHint
    ? `${linesPrompt(sectionLabel)}\n\nRETRY NOTICE — the first transcription did not add up: ${opts.confusionHint} Look very carefully at those specific figures before answering again.`
    : linesPrompt(sectionLabel);
  const response = await client.messages.create(
    {
      model: EXTRACTION_MODEL,
      max_tokens: 2000,
      tools: [LINES_TOOL],
      tool_choice: { type: "tool", name: "record_ledger_lines" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp", data: imageBase64 } },
            { type: "text", text: promptText },
          ],
        },
      ],
    },
    { timeout: 60_000 }
  );
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error(`${section} ledger line transcription returned no structured result`);
  const input = toolUse.input as { lines?: unknown; region_notes?: unknown };
  if (!Array.isArray(input.lines)) throw new Error(`${section} ledger line transcription did not include a lines array`);
  const lines = (input.lines as LedgerLine[]).filter((l) => l && typeof l === "object").map((l) => ({
    kind: l.kind,
    label: typeof l.label === "string" ? l.label : null,
    figure: numOrNull(l.figure),
  }));
  return interpretLedgerLines(lines, typeof input.region_notes === "string" ? input.region_notes : null);
}
