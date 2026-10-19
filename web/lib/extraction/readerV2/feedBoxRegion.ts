import { getAnthropicClient, EXTRACTION_MODEL } from "../anthropicClient";

// Reader rebuild, benchmark-only extension (owner request, 2026-10-19):
// one call per feed-box CROP (feed_box_single, feed_box_main, or
// feed_box_continuation), adapted field-for-field from the proven
// whole-page prompt in ledgerFeedExtraction.ts. Which group this box
// covers is already known from WHICH region kind the crop came from (the
// page-layout call already decided single-box-vs-two-box for this page),
// so it's told to the model directly rather than re-asked — groupLabel
// here is for display/comparison only, never asked of the model itself.
// Not wired into the real upload flow.

export interface ExtractedFeedBoxRegion {
  opening_balance_bags: number | null;
  produced_bags: number | null;
  total_bags: number | null;
  closing_balance_bags: number | null;
  consumed_bags: number | null;
  mill_inventory_bags: number | null;
  shed_inventory_bags: number | null;
  region_notes: string | null;
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

// Matches the three real possibilities readerV2/types.ts's RegionKind
// already distinguishes — "ALL" is this benchmark's own label for a
// feed_box_single crop (one box covering every flock), matching the
// flock_group value daily_feed_bag_stock itself stores for that case.
export type FeedBoxGroupLabel = "BAB-1-7" | "BAB-8-10" | "ALL";

const CONFIDENCE_PROP = { type: "number" as const, description: "0.0-1.0" };

const TOOL = {
  name: "record_feed_box_extraction",
  description: "Records the feed bag box read from this crop.",
  input_schema: {
    type: "object" as const,
    properties: {
      region_notes: {
        type: ["string", "null"],
        description: "Anything worth the owner knowing about THIS crop specifically, or null.",
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
      "region_notes", "opening_balance_bags", "produced_bags", "total_bags",
      "closing_balance_bags", "consumed_bags", "mill_inventory_bags", "shed_inventory_bags",
      "confidence",
    ],
  },
};

function promptFor(groupLabel: FeedBoxGroupLabel): string {
  const coverage =
    groupLabel === "ALL"
      ? "This farm currently uses ONE feed box covering every flock."
      : groupLabel === "BAB-1-7"
        ? "This box covers flocks BAB-1 through BAB-7."
        : "This box covers flocks BAB-8 through BAB-10.";

  return `You are reading a CROPPED feed bag box from a photographed Daily Production register page. ${coverage}

GOLDEN RULE: if you cannot clearly read a value, write null and give it low confidence. NEVER guess, NEVER compute a value yourself by adding or subtracting other numbers, NEVER invent a figure that isn't literally written.

This box reads top to bottom: "OB =" (opening balance in bags), "(+)" (bags received from the mill that day), a written total line (OB + the "(+)" figure, as written — do not calculate it), a "(-)" line (the CLOSING balance currently in stock — this is written as a figure to be SUBTRACTED from the total, do not treat it as the consumption figure itself), then the consumption figure itself (total minus the "(-)" line, as written), then "F =" (bags still at the feed mill) and "S =" (bags already moved to the shed) underneath. Bags are NOT trays-of-30 — do not apply that rule here.

Call record_feed_box_extraction with your findings.`;
}

export async function extractFeedBoxRegion(
  imageBase64: string,
  mediaType: string,
  groupLabel: FeedBoxGroupLabel
): Promise<ExtractedFeedBoxRegion> {
  const client = getAnthropicClient();

  const response = await client.messages.create(
    {
      model: EXTRACTION_MODEL,
      max_tokens: 1500,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "record_feed_box_extraction" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp", data: imageBase64 },
            },
            { type: "text", text: promptFor(groupLabel) },
          ],
        },
      ],
    },
    { timeout: 60_000 }
  );

  if (response.stop_reason === "max_tokens") {
    throw new Error(`The model's response was cut off before finishing the ${groupLabel} feed box crop.`);
  }
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(`${groupLabel} feed box extraction call returned no structured result`);
  }
  const input = toolUse.input as Partial<ExtractedFeedBoxRegion>;

  return {
    opening_balance_bags: numOrNull(input.opening_balance_bags),
    produced_bags: numOrNull(input.produced_bags),
    total_bags: numOrNull(input.total_bags),
    closing_balance_bags: numOrNull(input.closing_balance_bags),
    consumed_bags: numOrNull(input.consumed_bags),
    mill_inventory_bags: numOrNull(input.mill_inventory_bags),
    shed_inventory_bags: numOrNull(input.shed_inventory_bags),
    region_notes: typeof input.region_notes === "string" ? input.region_notes : null,
    confidence: input.confidence ?? {
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

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
