import { getAnthropicClient, EXTRACTION_MODEL } from "../anthropicClient";

// Reader rebuild, benchmark-only extension (owner request, 2026-10-19):
// one call for the chick_rows CROP. Unlike the table/ledger/feed-box
// readers above, there is no existing extraction prompt for this anywhere
// in the app — chick_daily_mortality (migration 0021) has always been
// filled in by hand, never by this app's own vision pipeline. This is a
// genuinely new, unproven prompt; the benchmark page labels results from
// it accordingly rather than implying it inherits the old reader's track
// record. Not wired into the real upload flow.

export interface ExtractedChickRow {
  label_as_written: string; // e.g. "1 Chick", "2 Chick"
  deaths: number | null;
  confidence: number;
}

export interface ExtractedChickRows {
  rows: ExtractedChickRow[];
  region_notes: string | null;
}

const TOOL = {
  name: "record_chick_rows_extraction",
  description: "Records every chick row read from this crop.",
  input_schema: {
    type: "object" as const,
    properties: {
      region_notes: {
        type: ["string", "null"],
        description: "Anything worth the owner knowing about this crop specifically, or null.",
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
};

const PROMPT = `You are reading a CROPPED block of chick rows from a photographed Daily Production register page — a small block, usually near the bottom, listing one or more "N Chick" rows (e.g. "1 Chick", "2 Chick") each with its own daily mortality/deaths figure. Occasionally a third row appears for chicks sourced from Anil farm.

GOLDEN RULE: if you cannot clearly read a value, write null and give it low confidence. NEVER guess, NEVER invent a figure that isn't literally written.

Report every row you can actually see, top to bottom, with its label exactly as written and its deaths figure. If this crop has no chick rows at all, return an empty rows array and say so in region_notes.

Call record_chick_rows_extraction with your findings.`;

export async function extractChickRowsRegion(
  imageBase64: string,
  mediaType: string
): Promise<ExtractedChickRows> {
  const client = getAnthropicClient();

  const response = await client.messages.create(
    {
      model: EXTRACTION_MODEL,
      max_tokens: 1000,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "record_chick_rows_extraction" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp", data: imageBase64 },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    },
    { timeout: 45_000 }
  );

  if (response.stop_reason === "max_tokens") {
    throw new Error("The model's response was cut off before finishing the chick-rows crop.");
  }
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Chick-rows extraction call returned no structured result");
  }
  const input = toolUse.input as { region_notes?: unknown; rows?: unknown };
  if (!Array.isArray(input.rows)) {
    throw new Error("Chick-rows extraction response did not include a usable rows array");
  }

  return {
    rows: input.rows as ExtractedChickRow[],
    region_notes: typeof input.region_notes === "string" ? input.region_notes : null,
  };
}
