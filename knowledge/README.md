# Knowledge library files

One JSON file per source document. `web/scripts/import-knowledge.mts` loads every
`knowledge/*.json` into `knowledge_documents`, `knowledge_entries` and
`knowledge_standards`. It is **idempotent**: running it twice changes nothing; a
changed file updates the matching rows (matched by `doc_key`, `entry_key` and
`metric + age_weeks`). It never deletes.

Content rules: facts, tables and short cited notes only. Do not paste long passages
of copyrighted text. Every document needs a `source_url`; every entry should say
which `page` (page / table / section) it came from. If a number is not in the source,
leave it out — the app shows "no reference loaded" for anything missing.

```json
{
  "doc_key": "venky-bv300-2023",            // stable id, lowercase, no spaces
  "company": "Venkateshwara Hatcheries",
  "title": "BV 300 Management Guide",
  "year": 2023,
  "source_url": "https://…",
  "entries": [
    {
      "entry_key": "hdp-by-week",           // stable within the document
      "topic": "Hen-day production",        // what the topic page groups by
      "page": "Table B",                    // page / section
      "breed": "BV300",                     // optional
      "notes": "short note, optional",
      "standards": [                        // optional numeric standards by age
        { "metric": "hen_day_percent", "age_weeks": 20, "value": 50, "unit": "%" }
      ]
    }
  ]
}
```

Metrics the Analytics screens understand: `hen_day_percent`, `feed_g_per_bird_day`,
`body_weight_g`, `cumulative_depletion_percent`. Other metric names are stored and shown
but not used in comparisons.

Run: `DATABASE_URL=… node web/scripts/import-knowledge.mts` (Node ≥ 22.18, from the repo root),
add `--dry-run` to only validate the files.

## Vaccination schedules

An entry whose standards are named `vaccine:<name>` (for example `vaccine:Marek's`) at an age in
weeks (`age_weeks`, counted from hatch/placement) is a vaccination schedule. The Medicines screen
can create dated vaccinations for a chick batch or flock from it (due date = arrival/placement
date + weeks). Put the route (e.g. "eye drop", "injection") in `unit`; `value` is not used (use 1).
Nothing is added unless a document you supply contains it.
