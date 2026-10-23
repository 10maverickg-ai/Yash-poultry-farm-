# Reader rebuild — benchmark page

A protected, read-only admin page that runs the NEW region-cropped reader
(`lib/extraction/readerV2`) against a photo this app already has stored,
and compares its reads field by field against what's currently saved in
`daily_production`. It never writes anything, and it never affects what a
real upload saves — it calls the new reader directly, independent of the
`READER_V2_ENABLED` switch in `app/upload/actions.ts`.

It must be run on a real deployment (a Vercel preview or production),
never locally — there is no `ANTHROPIC_API_KEY` in a dev sandbox, so the
page will error out immediately if visited on a machine without that key
configured.

## One-time setup (per deployment)

1. In the Vercel project's environment variables, add `READER_BENCHMARK_KEY`
   — any private value you choose, e.g. a random string. This is the only
   thing protecting the page; anyone who has this value can run the
   benchmark (read-only) but cannot write anything through it.
2. Redeploy — env var edits never apply to an already-built deployment.

## What to tap on your phone

1. Open `https://<your-preview-or-prod-url>/admin/reader-benchmark?key=<the value you set above>`.
2. You'll see a list of dates that already have a stored photo and saved
   numbers, most recent first. Pick a date you already trust — a reviewed,
   unflagged day is the most meaningful test (August dates are the ones
   this round of work was built against).
3. Tap "Run" next to that date. This can take a little while — it's making
   several real vision API calls (orientation + region detection, one call
   per flock table, plus up to 3 rounds of checksum-guided retry on any
   specific row that doesn't add up) — not a single instant call.
4. You'll land on a results page with:
   - An **accuracy by field** table — for each column (Mort, Feed, Total,
     Bal Bird, %), how many of the saved rows the new reader matched
     exactly, out of how many were comparable.
   - A **cell by cell** table — every flock, every field, with the new
     reader's value and (in red, with the saved value alongside) anything
     that didn't match.
   - Any label the new reader read that didn't match a saved flock, and
     any saved flock the new reader never produced a matching read for at
     all (the second one matters most — a field-by-field table alone can't
     show a flock the reader missed entirely).

Repeat for a few different dates — single-table days, two-table days, a
day with a margin note, a day with messy handwriting — before deciding the
number is good enough.

## What "good enough" means here

Per the ground rules this reader rebuild is being built under: the new
reader does not replace the old one in production (`READER_V2_ENABLED`
stays unset) and does not get merged to `main` until this benchmark has
been run on a preview and the result has been reviewed and approved. A
"good enough" result is one with no wrong number that the benchmark page
shows as a confident, unflagged match-but-actually-wrong case — a few
dates where both readers agree on a value the owner already knows is
correct is the bar, not a particular percentage.
