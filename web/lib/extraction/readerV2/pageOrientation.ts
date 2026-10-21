import { getAnthropicClient, EXTRACTION_MODEL } from "../anthropicClient";
import { loadSharp } from "./sharpLoader";

// Reader rebuild, stage 1. Revised 2026-10-21 (owner report — Aug 8 run:
// the whole page was upside down inside the pipeline, so every half came
// back empty and everything scored 0%; the model's own page notes said
// "rotating 90° clockwise would make it upright" yet the pipeline ended
// up 180° off).
//
// The previous version asked the model for "rotation_degrees clockwise" —
// a mental-rotation question, and the classic way to get it wrong is
// swapping 90 and 270, which are exactly 180° apart (precisely the
// failure seen). This version asks for a plain visual FACT instead —
// which way the TOPS of the handwritten letters point in the photo as
// shown — and derives the rotation in code (rotationFromTextTop). The
// model's own rotation_degrees answer is still requested, but only as a
// cross-check: a disagreement is recorded in the debug output rather than
// silently trusted either way. A cheap, LOW-RESOLUTION copy of the photo
// is sent (orientation needs no fine detail), and a self-check one level
// up (halfPipeline.ts) still retries 180° away if a half comes back empty.
//
// Deliberately NOT asked here any more: the date. A date read from a
// thumbnail is less reliable than one read from the upright, full-
// resolution half pages (pageHalfRegion.ts now returns it), and a wrong
// date here would be a false "date mismatch" stop in production.

export type Rotation = 0 | 90 | 180 | 270;
export type TextTop = "up" | "right" | "down" | "left";
export type LeftPageContent = "flock_table" | "feed_box" | "other" | "unknown";

export interface PageOrientation {
  // The rotation actually applied: derived from textTopPointsTo when the
  // model gave a valid one, else the model's own rotation answer.
  rotationDegrees: Rotation;
  textTopPointsTo: TextTop | null;
  // What the model separately said, kept only as a cross-check.
  modelRotationDegrees: Rotation | null;
  // Diagnostic only (never used to map content): which page the model saw
  // on the left once upright — the flock table with BAB labels, the feed
  // box (OB / F= S=) page, or something else.
  leftPageContent: LeftPageContent;
  // Non-null when the two rotation answers disagreed.
  disagreementNote: string | null;
  pageNotes: string | null;
}

// If the tops of the letters point LEFT, turning the photo clockwise 90°
// brings them up; if they point RIGHT, it takes 270° clockwise (= 90°
// counter-clockwise); DOWN needs 180°.
export function rotationFromTextTop(top: TextTop): Rotation {
  switch (top) {
    case "up":
      return 0;
    case "left":
      return 90;
    case "down":
      return 180;
    case "right":
      return 270;
  }
}

const ORIENTATION_LONG_EDGE_PX = 1280;

// Low-resolution copy for the orientation call — it only needs the
// overall layout and the direction of the handwriting.
export async function makeOrientationThumbnail(
  imageBuffer: Buffer
): Promise<{ base64: string; mediaType: "image/jpeg" }> {
  const sharp = await loadSharp();
  const resized = await sharp(imageBuffer)
    .rotate()
    .resize({ width: ORIENTATION_LONG_EDGE_PX, height: ORIENTATION_LONG_EDGE_PX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { base64: resized.toString("base64"), mediaType: "image/jpeg" };
}

const TOOL = {
  name: "record_page_orientation",
  description: "Records which way this photo is rotated and what is on its left page.",
  input_schema: {
    type: "object" as const,
    properties: {
      text_top_points_to: {
        type: "string",
        enum: ["up", "right", "down", "left"],
        description:
          "Looking at the photo EXACTLY AS SHOWN: which edge of the photo do the TOPS of the handwritten letters and the column headers point toward? 'up' if the writing already reads normally, 'down' if it is upside down, 'left' if the writing runs bottom-to-top (tops point to the left edge), 'right' if it runs top-to-bottom (tops point to the right edge).",
      },
      rotation_degrees: {
        type: "number",
        enum: [0, 90, 180, 270],
        description:
          "Degrees to turn the photo CLOCKWISE so the handwriting reads upright, left to right. 0 if it already is.",
      },
      left_page_content: {
        type: "string",
        enum: ["flock_table", "feed_box", "other", "unknown"],
        description:
          "Once the photo is upright, what is on the LEFT page: 'flock_table' = the table of flocks with BAB labels and Mort/Feed/Total columns; 'feed_box' = the page with the feed bag boxes (OB = / (+) / (-) / F = S =); 'other' if neither; 'unknown' if you can't tell.",
      },
      page_notes: {
        type: ["string", "null"],
        description: "Anything worth noting about the photo as a whole — heavy glare, a torn corner, bleed-through — or null.",
      },
    },
    required: ["text_top_points_to", "rotation_degrees", "left_page_content", "page_notes"],
  },
};

const PROMPT = `You are looking at a LOW-RESOLUTION photo of a two-page spread from a poultry farm's handwritten daily registers, taken at whatever angle was convenient — it may be upright, sideways, or upside down.

Your ONLY job is to say how the photo is turned. Do NOT read any figure, label, or date.

1. text_top_points_to: look at the handwriting and the printed column headers as the photo is shown. Which edge of the photo do the TOPS of the letters point toward? (up = reads normally, down = upside down, left = the lines run bottom-to-top, right = the lines run top-to-bottom.)
2. rotation_degrees: how many degrees clockwise would you turn the photo so everything reads upright? It must agree with answer 1.
3. left_page_content: once upright, what is on the LEFT page — the flock table (BAB labels, Mort/Feed/Total columns), the feed-box page (OB =, (+), (-), F =, S =), something else, or unknown.

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
    text_top_points_to?: unknown;
    rotation_degrees?: unknown;
    left_page_content?: unknown;
    page_notes?: unknown;
  };

  const textTop: TextTop | null =
    input.text_top_points_to === "up" ||
    input.text_top_points_to === "right" ||
    input.text_top_points_to === "down" ||
    input.text_top_points_to === "left"
      ? input.text_top_points_to
      : null;
  const modelRotation: Rotation | null = [0, 90, 180, 270].includes(input.rotation_degrees as number)
    ? (input.rotation_degrees as Rotation)
    : null;

  if (textTop === null && modelRotation === null) {
    throw new Error(
      `Page-orientation call returned neither a usable text direction (${JSON.stringify(input.text_top_points_to)}) nor a usable rotation (${JSON.stringify(input.rotation_degrees)}).`
    );
  }

  const derived = textTop !== null ? rotationFromTextTop(textTop) : null;
  const rotationDegrees = (derived ?? modelRotation) as Rotation;
  const disagreementNote =
    derived !== null && modelRotation !== null && derived !== modelRotation
      ? `Orientation answers disagreed: text tops point ${textTop} (=> ${derived}° clockwise) but the model's own rotation answer was ${modelRotation}°. Used ${derived}°.`
      : null;

  const leftPageContent: LeftPageContent =
    input.left_page_content === "flock_table" ||
    input.left_page_content === "feed_box" ||
    input.left_page_content === "other" ||
    input.left_page_content === "unknown"
      ? input.left_page_content
      : "unknown";

  return {
    rotationDegrees,
    textTopPointsTo: textTop,
    modelRotationDegrees: modelRotation,
    leftPageContent,
    disagreementNote,
    pageNotes: typeof input.page_notes === "string" ? input.page_notes : null,
  };
}
