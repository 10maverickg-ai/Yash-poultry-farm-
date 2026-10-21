import { getAnthropicClient, EXTRACTION_MODEL } from "../anthropicClient";

// Reader rebuild, stage 1 (owner report, 2026-10-21): this used to also ask
// the model for region bounding boxes (orientationAndRegions.ts) — those
// boxes turned out to be unreliable (see pageSplit.ts's own header comment)
// and have been removed. All this call does now is answer the two things
// that genuinely need a model's eyes before any deterministic image work
// can happen: which way is the photo rotated, and what date is written at
// the top. The page SPLIT into its two halves is now pageSplit.ts's pure,
// non-LLM job instead.

export interface PageOrientation {
  rotationDegrees: 0 | 90 | 180 | 270;
  date: string | null;
  dateConfidence: number;
  pageNotes: string | null;
}

const TOOL = {
  name: "record_page_orientation",
  description: "Records this photo's rotation and the date written at the top of the page.",
  input_schema: {
    type: "object" as const,
    properties: {
      date: {
        type: ["string", "null"],
        description: "Date at the top of the page, as YYYY-MM-DD. Null if illegible.",
      },
      date_confidence: { type: "number", description: "0.0-1.0" },
      rotation_degrees: {
        type: "number",
        enum: [0, 90, 180, 270],
        description: "Degrees to rotate the photo CLOCKWISE so the handwriting reads upright, left to right. 0 if it's already upright.",
      },
      page_notes: {
        type: ["string", "null"],
        description: "Anything worth noting about the page as a whole — heavy glare, a torn corner, mirror-image bleed-through from the reverse side — or null.",
      },
    },
    required: ["date", "date_confidence", "rotation_degrees", "page_notes"],
  },
};

const PROMPT = `You are looking at a photographed page from a poultry farm's daily paper registers — a two-page spread photographed as one image, often at whatever angle was convenient.

Your ONLY job right now is to answer two things — do NOT try to read any individual figure, table, ledger, or feed box number; someone else does that next, once your answer lets the image be rotated upright and split into its two pages at full resolution.

1. DATE: the date written at the top of the page, as YYYY-MM-DD, with your confidence. Null if illegible.

2. ROTATION: figure out which way to rotate the photo (clockwise, in degrees: 0, 90, 180, or 270) so that the handwriting and column headers read upright, left to right.

Call record_page_orientation with your findings.`;

export async function detectPageOrientation(imageBase64: string, mediaType: string): Promise<PageOrientation> {
  const client = getAnthropicClient();

  const response = await client.messages.create(
    {
      model: EXTRACTION_MODEL,
      max_tokens: 500,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
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
    { timeout: 60_000 }
  );

  if (response.stop_reason === "max_tokens") {
    throw new Error("The model's response was cut off before finishing the page-orientation call.");
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Page-orientation call returned no structured result");
  }
  const input = toolUse.input as {
    date?: unknown;
    date_confidence?: unknown;
    rotation_degrees?: unknown;
    page_notes?: unknown;
  };

  if (![0, 90, 180, 270].includes(input.rotation_degrees as number)) {
    throw new Error(
      `Page-orientation call returned an invalid rotation_degrees (${JSON.stringify(input.rotation_degrees)}) — expected 0, 90, 180, or 270.`
    );
  }

  return {
    rotationDegrees: input.rotation_degrees as 0 | 90 | 180 | 270,
    date: typeof input.date === "string" ? input.date : null,
    dateConfidence: typeof input.date_confidence === "number" ? input.date_confidence : 0,
    pageNotes: typeof input.page_notes === "string" ? input.page_notes : null,
  };
}
