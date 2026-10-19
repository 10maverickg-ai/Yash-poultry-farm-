import { getAnthropicClient, EXTRACTION_MODEL } from "../anthropicClient";
import type { OrientationAndRegions, RegionKind, NormalizedBox } from "./types";

// Reader rebuild, stage 1 of 2 (owner's "V4 build prompt", Phase 1): a
// single, cheap vision call over the FULL, unrotated photo that answers two
// questions before any detail is ever read: which way is it rotated, and
// where does each region actually sit on THIS page. Nothing here reads a
// single Mort/Feed/egg/Bal Bird figure — that's each region's own call
// (dailyProductionRegion.ts and friends), on the cropped, upright, full-
// resolution image this stage's answer makes possible.
//
// Deliberately NEVER hard-codes which regions exist or how many (e.g. one
// feed box vs two) — the owner's own instruction: "Read the labels, the
// table a flock sits in, and the number of feed boxes from the page; never
// hard-code them." A region this call doesn't report simply isn't cropped
// or read at all.

const REGION_KINDS: RegionKind[] = [
  "main_table_block",
  "continuation_table_block",
  "big_egg_ledger",
  "small_egg_ledger",
  "feed_box_single",
  "feed_box_main",
  "feed_box_continuation",
  "chick_rows",
];

const BOX_SCHEMA = {
  type: "object" as const,
  description: "Normalized bounding box on the UPRIGHT (post-rotation) image, 0.0-1.0, origin top-left.",
  properties: {
    x: { type: "number", description: "Left edge, 0.0-1.0 of the upright image's width." },
    y: { type: "number", description: "Top edge, 0.0-1.0 of the upright image's height." },
    width: { type: "number", description: "0.0-1.0 of the upright image's width." },
    height: { type: "number", description: "0.0-1.0 of the upright image's height." },
  },
  required: ["x", "y", "width", "height"],
};

const EXTRACT_TOOL = {
  name: "record_page_layout",
  description: "Records this specific photo's rotation and which regions are present, with their bounding boxes.",
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
        description: "Degrees to rotate the photo CLOCKWISE so the handwriting reads upright. 0 if it's already upright.",
      },
      page_notes: {
        type: ["string", "null"],
        description: "Anything worth noting about the page as a whole that doesn't fit a region below (e.g. heavy glare, a torn corner, mirror-image bleed-through from the reverse side).",
      },
      regions: {
        type: "array",
        description:
          "One entry per region ACTUALLY VISIBLE on this photo — omit any region you can't find at all, never guess one into existence. A farm with one feed box reports feed_box_single; a farm with two separate boxes reports feed_box_main and feed_box_continuation instead — read which applies from the page, there is no fixed answer. A single-table day has no continuation_table_block entry at all.",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: REGION_KINDS,
              description:
                "main_table_block = the flock table with the MOST flocks (usually right page, BAB-1 onward) PLUS its own subtotal row directly beneath it, as one box. continuation_table_block = a second, shorter flock table (usually left page) plus ITS subtotal row, if one exists. big_egg_ledger / small_egg_ledger = the egg stock ledger directly below each table's subtotal (big = under the main table, small = under the continuation table). feed_box_single = ONE feed bag box covering every flock. feed_box_main / feed_box_continuation = used INSTEAD of feed_box_single only when there are genuinely TWO separate feed boxes on the page, one per table. chick_rows = the '1 Chick' / '2 Chick' (and possibly a 3rd Anil-chicks) row block.",
            },
            box: BOX_SCHEMA,
          },
          required: ["kind", "box"],
        },
      },
    },
    required: ["date", "date_confidence", "rotation_degrees", "page_notes", "regions"],
  },
};

const PROMPT = `You are looking at a photographed page from a poultry farm's daily paper registers — usually a two-page spread photographed as one image, and often rotated, since it's photographed at whatever angle was convenient.

Your ONLY job right now is to answer three things — do NOT try to read any individual Mort/Feed/egg/Bal Bird/% figure, ledger number, or feed box number. Someone else will do that, after your answer lets the image be rotated upright and cropped to just their one region, at full resolution.

0. DATE: the date written at the top of the page, as YYYY-MM-DD, with your confidence. Null if illegible.

1. ROTATION: figure out which way to rotate the photo (clockwise, in degrees: 0, 90, 180, or 270) so that the handwriting and column headers read upright, left to right.

2. REGIONS: find every one of these that actually appears on this page, and give each a normalized bounding box (0.0-1.0, relative to the image AFTER applying your own rotation answer above):
   - main_table_block: the larger/first flock table (usually BAB-1 onward) PLUS its own subtotal row directly beneath its last flock, as ONE combined box.
   - continuation_table_block: a second, shorter flock table on the facing page, if one exists, PLUS its own subtotal row — omit this entirely if the page only has one table.
   - big_egg_ledger: the egg stock ledger directly below the main table's subtotal row (running +/- entries, an opening balance, a closing balance).
   - small_egg_ledger: the same, directly below the continuation table's subtotal, if a continuation table exists.
   - feed_box_single OR (feed_box_main AND feed_box_continuation): read the page to tell which applies — some photos show ONE feed bag box (OB=/(+)/(-)/F=/S=) covering every flock, others show TWO separate boxes, one per table. Report whichever is actually there; never assume.
   - chick_rows: the small "1 Chick" / "2 Chick" rows (and a third row if chicks from Anil farm are shown), usually near the bottom.

If a region genuinely isn't on this page, simply don't include it — never invent one. Boxes may overlap slightly at edges; that's fine, generous padding is better than cutting off a column.

Call record_page_layout with your findings.`;

export async function detectOrientationAndRegions(
  imageBase64: string,
  mediaType: string
): Promise<OrientationAndRegions> {
  const client = getAnthropicClient();

  const response = await client.messages.create(
    {
      model: EXTRACTION_MODEL,
      max_tokens: 2000,
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
    { timeout: 60_000 }
  );

  if (response.stop_reason === "max_tokens") {
    throw new Error("The model's response was cut off before finishing the page-layout call.");
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Page-layout call returned no structured result");
  }
  const input = toolUse.input as {
    date?: unknown;
    date_confidence?: unknown;
    rotation_degrees?: unknown;
    page_notes?: unknown;
    regions?: unknown;
  };

  // Owner report, 2026-10-12 (this session, upload/actions.ts's own
  // production incident): every unchecked field from a model's JSON
  // response is a potential crash site downstream. This call's own output
  // feeds straight into sharp crop math (crop.ts) — a malformed box or a
  // rotation outside the 4 allowed values must be caught HERE, with a
  // clear error naming this stage, not three steps later as a cryptic
  // sharp exception.
  if (![0, 90, 180, 270].includes(input.rotation_degrees as number)) {
    throw new Error(
      `Page-layout call returned an invalid rotation_degrees (${JSON.stringify(input.rotation_degrees)}) — expected 0, 90, 180, or 270.`
    );
  }
  if (!Array.isArray(input.regions)) {
    throw new Error("Page-layout call did not include a usable regions array");
  }
  const regions = input.regions.filter((r): r is { kind: RegionKind; box: NormalizedBox } => {
    if (typeof r !== "object" || r === null) return false;
    const kind = (r as Record<string, unknown>).kind;
    const box = (r as Record<string, unknown>).box;
    if (typeof kind !== "string" || !REGION_KINDS.includes(kind as RegionKind)) return false;
    if (typeof box !== "object" || box === null) return false;
    const b = box as Record<string, unknown>;
    return (
      isFraction(b.x) && isFraction(b.y) && isFraction(b.width) && isFraction(b.height)
    );
  });

  return {
    rotationDegrees: input.rotation_degrees as 0 | 90 | 180 | 270,
    regions,
    pageNotes: typeof input.page_notes === "string" ? input.page_notes : null,
    date: typeof input.date === "string" ? input.date : null,
    dateConfidence: typeof input.date_confidence === "number" ? input.date_confidence : 0,
  };
}

function isFraction(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= -0.05 && v <= 1.05;
}
