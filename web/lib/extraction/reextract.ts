import { getAnthropicClient, EXTRACTION_MODEL } from "./anthropicClient";
import { RECHECKABLE_FIELDS, type RecheckableField } from "./dailyProduction";
import type { ReferenceExample } from "./references";

export interface FlockRecheckRequest {
  flockLabel: string;
  fields: RecheckableField[];
}

export interface FlockRecheckResult {
  flockLabel: string;
  values: Partial<Record<RecheckableField, number | null>>;
  confidence: Partial<Record<RecheckableField, number>>;
  notes: string | null;
}

const FIELD_PROPS = Object.fromEntries(
  RECHECKABLE_FIELDS.map((f) => [f, { type: ["number", "null"] }])
);
const CONFIDENCE_PROPS = Object.fromEntries(
  RECHECKABLE_FIELDS.map((f) => [f, { type: "number", description: "0.0-1.0" }])
);

const RECHECK_TOOL = {
  name: "record_field_rechecks",
  description: "Records a re-read of specific fields for one or more specific flocks.",
  input_schema: {
    type: "object" as const,
    properties: {
      rechecks: {
        type: "array" as const,
        description: "One entry per flock that was asked about.",
        items: {
          type: "object" as const,
          properties: {
            flock_label: {
              type: "string",
              description: "Exactly as given in the request — used to match the recheck back to the right flock.",
            },
            values: { type: "object" as const, properties: FIELD_PROPS },
            confidence: { type: "object" as const, properties: CONFIDENCE_PROPS },
            notes: {
              type: ["string", "null"],
              description: "Why the field is (or still isn't) legible, if worth noting.",
            },
          },
          required: ["flock_label", "values", "confidence", "notes"],
        },
      },
    },
    required: ["rechecks"],
  },
};

/**
 * Second pass, batched across every flock in ONE uploaded photo that needs a
 * recheck — a single call re-sending the original photo plus reference
 * photos, rather than one call per flagged flock. Most uploads have zero or
 * one flagged flock, but a handwriting-heavy page can flag several at once,
 * and re-sending the full reference set separately for each would multiply
 * the expensive part of this call (the images) for no benefit.
 */
export async function reextractFlaggedFlocks(
  originalImageBase64: string,
  originalMediaType: string,
  requests: FlockRecheckRequest[],
  references: ReferenceExample[]
): Promise<FlockRecheckResult[]> {
  const client = getAnthropicClient();

  const referenceContent = references.flatMap((ref, i) => [
    {
      type: "text" as const,
      text: `Reference photo ${i + 1} of ${references.length} — same register and handwriting style, already confirmed correct by the owner. Flock "${ref.flockLabel}" on that page: ${JSON.stringify(ref.values)}.`,
    },
    {
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: ref.mediaType as "image/jpeg" | "image/png" | "image/webp",
        data: ref.imageBase64,
      },
    },
  ]);

  const askList = requests
    .map((r) => `- "${r.flockLabel}": ${r.fields.join(", ")}`)
    .join("\n");

  const prompt = `You previously read the Daily Production register photo below. For the following flocks, you were unsure about the specific field(s) listed — look ONLY at each named flock's own row again, nothing else:

${askList}

${
  references.length > 0
    ? `${references.length} reference photo(s) follow, each of the same register and handwriting style with already-confirmed-correct values, to help you calibrate how this scribe forms similar digits.`
    : "No reference photos are available this time — just look again carefully."
}

Return one entry in "rechecks" per flock listed above, with "flock_label" matching exactly as given. Only fill in the field(s) that were actually asked about for that flock — leave the rest null. If a field is genuinely illegible even with the reference examples, use null and low confidence rather than forcing a value just because a reference example suggests one — the references are a calibration aid, not a source of truth for any specific flock's actual figure.

Call record_field_rechecks with your findings.`;

  const response = await client.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 2048,
    tools: [RECHECK_TOOL],
    tool_choice: { type: "tool", name: RECHECK_TOOL.name },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: originalMediaType as "image/jpeg" | "image/png" | "image/webp",
              data: originalImageBase64,
            },
          },
          { type: "text", text: prompt },
          ...referenceContent,
        ],
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Recheck call returned no structured result");
  }
  const input = toolUse.input as { rechecks: FlockRecheckResult[] };
  return input.rechecks;
}

/** Maps fn_validate_daily_production's reason strings (plus the app's own
 * "low OCR confidence on X" reasons) back to the field(s) they implicate, so
 * the recheck call only targets fields that actually need a second look. */
export function impliedFields(reasons: string[]): RecheckableField[] {
  const set = new Set<RecheckableField>();
  const isField = (f: string): f is RecheckableField =>
    (RECHECKABLE_FIELDS as readonly string[]).includes(f);

  for (const r of reasons) {
    if (r.startsWith("missing field: ")) {
      const f = r.slice("missing field: ".length);
      if (isField(f)) set.add(f);
    } else if (r.startsWith("low OCR confidence on ")) {
      const f = r.slice("low OCR confidence on ".length);
      if (isField(f)) set.add(f);
    } else if (r.startsWith("HD% mismatch")) {
      // The mismatch could stem from any of the three figures involved.
      set.add("hd_percent");
      set.add("eggs_total");
      set.add("bird_population");
    } else if (r.startsWith("mortality outlier")) {
      set.add("mortality");
    } else if (r.startsWith("bird_population increased")) {
      set.add("bird_population");
    }
  }
  return [...set];
}
