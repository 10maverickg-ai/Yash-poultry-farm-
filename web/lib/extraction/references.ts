import type { PoolClient } from "pg";
import type { RecheckableField } from "./dailyProduction";

export interface ReferenceExample {
  flockLabel: string;
  imageBase64: string;
  mediaType: string;
  values: Partial<Record<RecheckableField, number | null>>;
}

const MAX_REFERENCES = 4;
// How many recent confirmed-clean rows to scan while looking for distinct
// source photos — several rows usually share one photo (one photo yields
// many flock rows), so this needs to be well above MAX_REFERENCES.
const CANDIDATE_ROWS = 40;

/**
 * Reference examples for the second extraction pass, drawn straight from
 * rows the owner has already reviewed and confirmed correct on the /flagged
 * screen (reviewed_by_owner = true, flagged = false) — no separate curation
 * step or upload needed. Early on, before enough rows have been reviewed,
 * this returns fewer than MAX_REFERENCES, possibly zero; the caller must
 * treat zero references as "skip the second pass," not an error.
 */
export async function getReferenceExamples(
  client: PoolClient,
  farmCode: string
): Promise<ReferenceExample[]> {
  const { rows } = await client.query(
    `SELECT display_label_as_written, source_photo_url,
            mortality, feed_bags, eggs_total, bird_population, hd_percent
       FROM daily_production
      WHERE farm_code = $1
        AND reviewed_by_owner = true
        AND flagged = false
        AND source_photo_url IS NOT NULL
      ORDER BY date DESC
      LIMIT $2`,
    [farmCode, CANDIDATE_ROWS]
  );

  const byUrl = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!byUrl.has(row.source_photo_url)) byUrl.set(row.source_photo_url, row);
    if (byUrl.size >= MAX_REFERENCES) break;
  }

  const examples: ReferenceExample[] = [];
  for (const row of byUrl.values()) {
    try {
      const res = await fetch(row.source_photo_url);
      if (!res.ok) continue;
      const mediaType = res.headers.get("content-type") || "image/jpeg";
      const buf = Buffer.from(await res.arrayBuffer());
      examples.push({
        flockLabel: row.display_label_as_written,
        imageBase64: buf.toString("base64"),
        mediaType,
        values: {
          mortality: row.mortality,
          feed_bags: row.feed_bags,
          eggs_total: row.eggs_total,
          bird_population: row.bird_population,
          hd_percent: row.hd_percent,
        },
      });
    } catch {
      // One unreachable reference photo shouldn't block the second pass —
      // just proceed with fewer references than requested.
      continue;
    }
  }
  return examples;
}
