# Phase 1 Decisions

**Status: reviewed and approved by the owner (2026-07-03). These are final, not
provisional.** The "Noted for later phases" items at the bottom remain open.

Every choice below was either left open by the spec documents or is a gap/contradiction
between them that had to be resolved to write the schema. Items marked
**[owner's call per the brief]** were explicitly deferred to the owner in the docs;
the rest are the smallest resolutions I could make of ambiguities, flagged per instruction.

## 1. Flag/review fields on all extracted tables

**The contradiction:** the schema spec lists `flagged` / `flag_reason` / `reviewed_by_owner` /
`ocr_confidence` only on `daily_production`, but defines auto-flag validation rules for the
egg stock tables and `feed_stock` too — and the extraction spec says flagged records of
*every* register type get "written with `flagged = true`" and routed to the review queue.

**Resolution:** added the same four fields to `daily_egg_stock_summary`,
`daily_egg_stock_entries` (which additionally needs them for low-confidence category
classification flags), and `feed_stock`. No other tables got them: `sales` is derived, not
extracted; `feed_formulation` is owner-entered per the extraction spec; reference tables
aren't extraction targets.

## 2. Hybrid validation enforcement **[owner's call per the brief]**

The flag-for-review rules (HD% mismatch, mortality outlier, ledger balance, feed balance,
missing fields) **cannot** be hard DB constraints — a violating record must still be saved
with `flagged = true`, not rejected. So:

- **DB constraints:** primary/foreign keys, enums, uniqueness ("one row per flock per day"
  etc.), computed display columns, non-negative checks on counts/quantities.
- **SQL functions (`fn_validate_*` in migration 0006):** every flagging rule from the spec,
  returning an array of human-readable reasons. Phase 2 entry screens call these after each
  write and set `flagged` / `flag_reason` from the result. Nothing is ever rejected by them.

See `docs/VALIDATION.md` for the rule-by-rule mapping.

## 3. Plain SQL migrations, no ORM

Delivered as numbered SQL files + Docker Postgres 16 + seed files. Keeps Phase 2 free to
choose any web stack; an ORM can be layered on later without redoing Phase 1.

## 4. `stage_transition_dates` as jsonb

Spec offered "jsonb / separate table" without choosing. Went with jsonb, matching the
spec's own example shape: `{"chick_to_grower": "...", "grower_to_layer": "..."}`.

## 5. `feed_materials` has no `farm_code`

The spec says "every table below gets a farm_code field" but the `feed_materials` field
list doesn't include one. Treated it as a shared reference list (like `farms` itself) —
per-farm separation happens in `feed_stock`, which does carry `farm_code` ("each farm has
its own feed mill/stock"). If the two farms ever need different material lists, this
becomes a join table — flag if that's the case.

## 6. Uniqueness constraints implied by "one row per X"

- `daily_production`: unique `(flock_internal_id, date)`
- `daily_egg_stock_summary`: unique `(farm_code, date)`
- `feed_stock`: unique `(farm_code, material_name, date)`
- `daily_egg_stock_entries`: unique `(egg_stock_summary_id, sequence_order)`
- `feed_formulation`: unique `(farm_code, formulation_group, effective_date, material_name)`
  — this one is *inferred* (one quantity per material per group per version), not stated.

## 7. Extracted data columns are nullable

`mortality`, `eggs_total`, `feed_bags`, etc. allow NULL on purpose: a blank field in the
photo is a **flag condition** (record saved, flagged as "missing field"), never an insert
rejection. NOT NULL is reserved for identity/structural columns (date, farm, flock, keys).

## 8. Blank feed `purchase` column = zero, not missing

On the Feed Stock page a blank Purchase column almost certainly means "no purchase that
day," so `fn_validate_feed_stock` treats NULL purchase as 0 in the balance check and does
not raise a missing-field flag for it. Opening/Consumed/Closing blank *do* flag as missing.
**Confirm this reading of the register.**

## 9. Grading counts absent ≠ missing field

The four grade columns are the deliberate new addition and "may be absent on older pages,"
so `fn_validate_egg_stock_summary` does not flag them as missing fields. Once the habit is
established, this could be tightened — owner's call, later.

## 10. Any bird_population increase flags

The spec's rule says increases should only happen via "a logged transfer/placement," but no
transfer/placement event table exists in the spec. So Phase 1 flags **every** day-over-day
increase for owner review. If transfers turn out to be frequent enough to make this noisy,
that's a signal to add an event log (a schema addition — owner decision, not made here).

## 11. `daily_production.shed_code` stays raw text

Kept as-written (per "as written that day"), not an FK to `sheds` — supervisors' notation
may not match the shed master exactly, and mismatch shouldn't block a write. `sheds` itself
is included (spec: optional but recommended) with composite PK `(farm_code, shed_code)`,
and `flocks.current_shed` does FK to it.

## 12. Timestamps only where specified

`created_at` / `updated_at` exist only on `flocks` (the one table that lists them).
No audit columns were silently added elsewhere.

## Post-Phase-1 owner-approved addition: BV300 breed standards (2026-07-04)

Owner supplied `bv300-standards-reference.md` (compiled from Venky's BV300 2023
guide) and chose **option (b)** of the proposed surfacing approaches:

- **HD% and feed/bird/day vs standard → Phase 4 dashboard only.** Their gaps
  are persistent and daily values noisy; a daily flag would spam the queue.
- **Cumulative laying mortality vs the depletion curve → flag now** (rule 5 in
  `fn_validate_daily_production`, migration 0007): flags when a flock's excess
  over standard first crosses **+2 points**, re-flags only per further whole
  point — a quiet slow-bleed complement to the acute 3× spike rule.

Implementation choices to know about:

1. **Hen-housed base is approximated** as the start-of-day population
   (`bird_population + mortality`) of the flock's first Daily Production row at
   or after lay start (placement + 19 weeks) — the closest figure register
   data offers. The rule stays silent until such a row exists.
2. **Depletion standards are stored only at the guide's stated anchors**
   (wk 19 ≈ 0, 60 → 3.1%, 80 → 6.0%, 100 → 9.0%); comparisons interpolate
   linearly at query time and clamp past week 100. Interpolated values are
   never stored as if they were the standard.
3. **Table B granularity:** the reference is condensed to ~5-week steps.
   Fine for the mortality flag (the curve is near-linear), but the owner will
   pull the full week-by-week table before Phase 4 builds the HD% overlay,
   where early-lay steepness (25%→50% in one week) makes interpolation
   visibly wrong. Extra rows drop in with no logic change.
4. **Versioning:** every standards table is keyed by `guide_version`
   (currently '2023'); a future guide is new rows, never an overwrite.
5. **Table D (body-weight uniformity): not built** — a genuinely new metric,
   parked at the owner's direction. **Table E (water quality): seeded as
   reference only, no UI or flags.**

## Post-Phase-2 owner addition: daily_feed_bag_stock (2026-07-10)

Second Feed Stock register (migration 0008): made-up feed bag counts by
flock group, mirroring the register's two-group-side-by-side layout
("Layer (BAB 1-7)" / "Grower (BAB 8-10)"). Entry screen sits at
`/feed-bag-stock`, placed right after Feed Stock in navigation, matching the
owner's requested placement. Per the owner's explicit scoping, this round
built storage + validation + entry screen only — no records/flagged-queue
integration and no dashboard, both left for a later pass if wanted.

**Interpretation flagged for confirmation:** the cross-table validation rule
("consumed_bags should equal SUM(daily_production.feed_bags) for flocks
belonging to that group") needs a way to know group membership per date.
Nothing in the existing schema provides this — `flock_group` here, like
`feed_formulation.formulation_group`, is free text with no FK to flocks, and
BAB-number ranges shift under renumbering exactly like shed assignment does
(the reason `daily_production.shed_code` is captured per-row rather than
read live off `flocks.current_shed`). Rather than parse the group label or
trust a mutable "current group" attribute — either of which could silently
give the wrong answer for a past date after a later regrouping — membership
is captured explicitly at entry time via a new junction table,
`daily_feed_bag_stock_flocks`, populated by a flock checklist in the form.
This is an interpretation, not a literal instruction; flag if a different
mechanism (e.g. reusing `feed_formulation.formulation_group` as the join
key) was intended instead.

**Sample register photos** (owner-supplied, 2026-07-10) saved to
`docs/sample-registers/` as Phase 3 fixtures — real handwriting, the
two-group side-by-side layout, and label abbreviation quirks ("BAB", "13
BAB", "18 BAB") a written spec alone doesn't capture. A bottom
"Feathers/Claws"-style adjustment block visible on the Daily Production
photos doesn't map to any current field — noted in the sample-registers
README as a candidate for a future register addition, not built here.

## Post-Phase-2 owner addition: chick_batch_log (2026-07-10)

Lightweight holding table (migration 0009) for chick/grower batches that
don't have a BAB number yet — deliberately no FK to `flocks`. Once a batch
is numbered, the owner creates it properly via the normal "New flock" form;
nothing here converts automatically or is auto-removed. Entry screen at
`/chick-batches`, placed next to Flocks/Sheds in navigation. Only
validation is missing-`shed_code`/missing-`total_birds`, per instruction —
no cross-checks against anything.

## Phase 3 kickoff: photo upload + Daily Production extraction (2026-07-14)

First real slice of Phase 3, scoped deliberately narrow: photo upload +
storage, and Claude-vision extraction for **Daily Production only**. Egg
Stock Ledger and Feed Bag Stock extraction are next — both often appear on
the same photographed page as Daily Production (confirmed by the owner),
but their write-paths (ledger line categorization + running balance, and
flock-group linking) aren't wired into the extraction flow yet. The current
prompt explicitly tells the model to ignore those blocks rather than
half-extract them.

**Storage:** Supabase Storage (`register-photos` bucket, public read —
consistent with the app's current no-auth posture), not Vercel Blob, to
reuse infra already paid for. Bucket is created via plain SQL
(`supabase/storage_setup.sql`) pasted into the SQL Editor, same pattern as
every migration — Storage buckets are just rows in `storage.buckets` in the
same Postgres database, so no separate Storage API call was needed to set
this up (useful, since this sandbox can't reach Supabase's HTTP APIs any
more than it could reach the raw database port). Uploads happen
server-side using the project's secret key, which bypasses RLS — no
`INSERT` policy needed or defined; nothing else can write to the bucket.

**AI approach:** Claude vision via tool-use (structured JSON output), per
the build brief's own direction — not a traditional OCR engine, since the
task is interpretive. Structural validation (`fn_validate_daily_production`)
runs independent of the model's self-reported confidence, per the
extraction spec's "independent of OCR confidence" rule — a confidently
wrong extraction still gets caught by the same arithmetic checks manual
entry already relies on. Low self-reported confidence (<0.6) on any field
is itself folded into the flag reasons, alongside the structural checks.

**Unresolved flock labels:** `daily_production.flock_internal_id` is
`NOT NULL` (Phase 1, owner-approved) — a label that doesn't resolve via
`resolve_flock_internal_id` genuinely cannot be written as a row under the
current schema. Rather than change that constraint or invent a new holding
table under time pressure, unresolved labels are simply not written and are
surfaced directly on the upload result page (usually means an unlogged
renumbering event or a misread label) — other flocks on the same photo that
do resolve are still written normally.

**New environment variables** (all three needed in Vercel for this to work
live): `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (Storage), `ANTHROPIC_API_KEY`
(extraction). None of these are testable from this sandbox — same network
restriction as the original database setup — so end-to-end verification
happens once the owner adds them.

## Phase 3 increment 2: multi-section extraction fix + two-pass recheck (2026-08-08)

**Multi-section bug:** confirmed against real photos already in this
conversation (same date, two-page spread) that a Daily Production photo
routinely shows flock blocks split across TWO separate physical tables — a
main table on one page, a shorter continuation table on the facing page,
often sitting below unrelated handwritten arithmetic that made it easy for
the model to treat as "not part of the register." The original prompt
described "flock blocks stacked vertically" as if there were a single
stack, which is exactly the framing that would make a model stop after the
first, more prominent table. Fixed by rewriting the prompt to explicitly
describe the two-page/two-table pattern and instruct the model to scan the
entire photo, plus adding a self-reported `sections_found` count — not a
correctness guarantee by itself, but it forces the model to consider the
question and gives the app something concrete to log per upload.

**Two-pass extraction:** first pass runs exactly as before, no reference
photos attached, on every upload. Only flocks that end up flagged (low
self-reported confidence or a structural validation mismatch) trigger a
second pass — one batched call per upload (not per flagged flock) that
re-sends the original photo plus up to 4 reference photos, pulled directly
from rows the owner has already confirmed correct on `/flagged`
(`reviewed_by_owner = true`, `flagged = false`) — no separate curation step.
A recheck's value only overwrites the first-pass value if it comes back at
confidence ≥0.6 and at least as confident as the original read; otherwise
the row stays flagged with its original reasons, same as if no recheck had
run. Before enough rows have been reviewed to supply references, the second
pass simply has nothing to draw on and the row stays flagged for manual
review — same fallback as today, just reached from a different path.
Batching into one call per upload (rather than one per flagged flock)
matters for cost: the reference photos are the expensive part of this call,
and a handwriting-heavy page can flag several flocks at once.

**Correction (2026-09-18):** the live test on the real Aug 1 two-section
photo showed the prompt fix above did NOT resolve the bug — BAB-1 through
BAB-7 were still completely missing from the extraction (no row, no flag,
nothing), only BAB-8/9/10 came through. The root cause is still open; see
the next entry for the diagnostic groundwork needed to actually
distinguish "model still isn't seeing the second table" from "it saw both
but something downstream dropped one" before attempting another fix.

## Phase 3 increment 3: extraction diagnostics in the DB, not just logs (2026-09-18)

Every diagnostic from the extraction call (`sections_found`, `page_notes`)
was previously console.log'd only — visible in Vercel's function logs,
which the owner cannot reliably reach from the mobile interface. Added
`sections_found` and `page_notes` columns directly on `daily_production`
(migration `0010_extraction_diagnostics.sql`), populated by every photo
upload and surfaced on `/flagged` right under the flag reason. Follows the
same denormalized pattern already used for `source_photo_url`: these are
properties of the whole photo/extraction call, not of any one flock, so
every flock row from one upload carries identical values — redundant, but
visible per-row in Supabase's Table Editor with no join and no log access
needed. This is what actually lets us tell apart the two candidate causes
of the still-open multi-section bug: `sections_found = 1` means the model
never saw the second table at all; `sections_found = 2` with flocks still
missing means extraction found both but something downstream dropped one.

**`flocks.current_bird_count` mirror — flagged rows excluded (owner
request, 2026-09-18):** the mirror-update query (present in both the photo
upload path and manual production entry — same query, same bug in both
places) previously used the latest dated `bird_population` reading
regardless of `flagged` status. Fixed in both places: a flagged row is now
excluded both as the update's source AND from the "does a later reading
exist" check, so an unreviewed OCR misread — or an unreviewed manual-entry
typo — can no longer push a wrong number into the live flock register
before the owner reviews it on `/flagged`. Flagged-data write behavior
itself is unchanged (owner confirmed: write immediately, flag for review,
same as manual entry already works) — this only narrows what the
*downstream mirror* is allowed to trust.

**Multi-section fix confirmed working (2026-09-18):** the Aug 1 live test
proved the vision/prompt side is genuinely fixed — the model's own notes
show it correctly found both table sections with the right subtotals. But
every one of the 10 flocks then failed to write a row: `resolve_flock_internal_id`
did (and by design was always meant to do) an exact, case-sensitive,
whitespace-sensitive string match between the extracted label and
`flock_label_history.display_label`. A handwritten register will never be
that literal day to day — "BAB 1" vs "BAB-1" is normal variation, not an
error — and the old code treated any such mismatch as "this flock doesn't
exist," discarding the row's numbers entirely (only ever visible in the
ephemeral upload-result screen, gone the moment the owner navigated away).

## Phase 3 increment 4: forgiving label matching + never lose extracted data (2026-09-18)

**Fuzzy matching (`lib/extraction/flockMatch.ts`):** labels are now
compared after normalizing case, whitespace, hyphen-vs-space-vs-nothing,
and leading zeros — "BAB 1", "Bab-1", "bab1", and "BAB-01" all normalize to
the same form as the stored "BAB-1". Deliberately NOT edit-distance /
typo-tolerant matching on the identifying digits themselves: this farm's
labels (BAB-1 .. BAB-10) differ from each other by exactly one character,
so treating a one-character difference as "probably the same flock" would
risk silently filing one flock's numbers under a different real flock's
identity — confirmed safe by testing that all ten labels still normalize to
ten distinct forms, no collisions.

**Never silently drop unmatched data:** even after normalization, a label
that matches zero (or, in the case of a `flock_label_history` data problem,
more than one) active flocks used to mean the row was discarded outright —
`daily_production.flock_internal_id` is `NOT NULL` (Phase 1, owner-approved),
so there was nowhere else for it to go. New `unresolved_extractions` table
(migration `0011`) holds the raw numbers plus the exact as-written label
instead; `/flagged` gets a new "Unmatched flock labels" section showing
those numbers with a dropdown of active flocks, and picking one calls
`resolveExtraction` (`app/flagged/actions.ts`), which writes a normal
`daily_production` row via the same `insertDailyProductionRow` helper the
upload path itself uses — new shared module
(`lib/extraction/writeDailyProduction.ts`) so the insert/validate/flag logic
isn't duplicated a third time. `register_type` is a text discriminator, not
an enum, so Egg Stock Ledger and Feed Bag Stock extraction can reuse this
same holding table later without another migration.

**Open question, not yet resolved:** why did all 10 labels fail uniformly
rather than a handful — a fully systematic formatting difference (e.g. the
model consistently writing "BAB 1" with a space because that's how the
label and number are visually stacked on the page) and a `flock_label_history`
date-coverage gap for 2026-08-01 would both present as "100% failure," and
this sandbox has no way to query the live database to tell them apart.
Asked the owner to check `flock_label_history` coverage for that date
directly in Supabase's Table Editor as a parallel diagnostic. If the fuzzy
match now resolves all 10 cleanly, it was formatting; if any still land in
`unresolved_extractions`, that specific label's history coverage needs a
look next.

## Phase 3 increment 5: drop shed_code from extraction; HD% trace (2026-09-18)

**shed_code no longer extracted (owner decision):** it was adding noise,
not signal — a low-confidence read of it could flag an entire row via the
low-confidence-on-any-field rule even when the six fields that actually
matter (label + the five `RECHECKABLE_FIELDS`) were all read cleanly, and
unlike those five it was never part of any structural validation rule to
begin with. Removed from `ExtractedFlockRow`, the tool schema (including
its own `required` list and the per-field `confidence` object), and the
prompt text in `lib/extraction/dailyProduction.ts`. The
`daily_production.shed_code` **column stays** — manual entry
(`ProductionEntryForm.tsx`) still writes it — this is purely an extraction
scope change, not a schema change. Downstream call sites in
`app/upload/actions.ts` now pass `shedCode: null` explicitly; the
"Unmatched flock labels" table on `/flagged` dropped its Shed column since
it would always read empty for extraction-sourced rows now.

**HD% ~10x-off trace (owner report on BAB-9):** grepped every file in the
repo referencing `hd_percent`, `eggs_total`, or `bird_population`. There is
exactly one place HD% math happens — `fn_validate_daily_production` Rule 1,
`eggs_total / bird_population * 100` — the standard hen-day-percent
formula, and it's identical between the 0006 version (superseded) and the
0007 version that's actually live. `hd_percent` itself is never computed or
overwritten anywhere else; it's stored exactly as extracted or as typed
manually. Also checked both INSERT statements that populate
`daily_production` for a column-order/swap bug (a "wrong column read into
the formula," per the owner's own hypothesis) — none found; parameter
order matches column order in both `lib/extraction/writeDailyProduction.ts`
and `app/production/actions.ts`.

**Conclusion: no divisor bug found in this code.** The formula divides
exactly the two numbers it should. A clean ~10x discrepancy is far more
consistent with a genuine misread of one of the three numbers involved
(`eggs_total`, `bird_population`, or the written `hd_percent` itself) — a
decimal-point placement error is the classic way a handwritten or
photographed percentage ends up exactly ~10x off, and this system has no
way to detect that from the numbers alone (a plausible-looking wrong
number passes the same arithmetic check a correct one would, just at the
wrong scale). Rather than guess further without BAB-9's actual stored
values, migration `0012` makes every future HD% mismatch self-diagnosing:
the flag reason now states `eggs_total` and `bird_population` directly
(`"HD% mismatch: written X%, calculated Y% (E eggs / B birds x 100)"`),
visible on `/flagged` with no second lookup — satisfies "trace exactly
which two numbers it's dividing" as a standing feature, not a one-time
debugging answer.

## Phase 3 increment 6: label misread root cause found — the "BAB" prefix, not the number (2026-09-28)

**Root cause of the 10/10 match failure (owner diagnosis, confirmed by
inspecting `unresolved_extractions`):** not a formatting convention issue
and not a `flock_label_history` coverage gap — genuine OCR misreads of
untidy handwriting, e.g. "18AB-2", "18BB-6", "BAB-I". The numbers/eggs/
mortality/feed themselves were being read correctly throughout; only the
label was wrong. Every flock on this farm is "BAB" plus a number 1–10 —
nothing else — so the letters carry zero identifying information and were
exactly the part of the label the model was struggling to read cleanly.

**Prompt fix (`lib/extraction/dailyProduction.ts`):** added a dedicated
LABELS section telling the model the label convention directly (BAB +
1–10, nothing else), that the handwriting is untidy, to spend its reading
effort on the number rather than the letters, to always output
"BAB-<number>" with an ordinary digit, and to convert a Roman numeral if
it sees one (explicit I–X mapping, since "BAB-I" was one of the actual
failures). Also told it the expected ascending order (1–7 main table, 8–10
continuation table) as a self-check — phrased as "look again if a number
breaks the sequence," explicitly NOT as license to force a digit to fit
the sequence when it genuinely reads differently, matching this system's
standing rule of never guessing a plausible value over a real illegible
one. The "1 to 10" range is hardcoded to this farm's current flock count —
flagged in the code comment as needing a manual update after the next
renumbering event (per `flock_label_history`'s own migration note,
roughly an annual event), rather than built to auto-derive the live range
from the database, since that would add a moving part this specific fix
doesn't need yet.

**Matching fix (`lib/extraction/flockMatch.ts`):** added `matchByNumber` as
a further fallback after byte-exact and cosmetic-normalized matching both
fail — extracts the LAST contiguous digit run from both the raw label and
each active label (not the first: the observed failure mode is a spurious
*leading* digit run from a garbled "BAB" prefix, e.g. "18AB-2" — the real
flock number is the trailing "2"), and matches only when exactly one
active flock shares that number. Comparison stays exact-once-parsed on the
digit itself (never edit-distance/"close enough" between different
numbers) — same standing rule as `normalizeFlockLabel`, re-verified here:
tested all ten real labels (BAB-1..BAB-10) plus the actual six garbled
strings from `unresolved_extractions` against this logic. Four of the six
garbled labels ("18AB-2", "18AB-3", "18BB-6", "18AB-7") now resolve
correctly through matching alone; the two Roman-numeral cases ("18AB-I",
"BAB-I") have no digit at all for `matchByNumber` to find and stay
unresolved — matching can't recover a digit the model never output, so
these depend on the prompt fix converging on "BAB-1" going forward. The
two fixes are complementary, not redundant: prompt fix reduces how often
the number-only fallback is needed at all; matching fix is the safety net
for whatever garbled reads still get through.

## Phase 3 increment 7: soft delete for flagged records + HD% official/written split (2026-09-28)

**Soft delete (owner request — old test uploads were piling up in
`/flagged` with no way to clear them):** added `deleted_at timestamptz`
to `daily_production` and `unresolved_extractions` (migration
`0013_soft_delete.sql`). Never a hard `DELETE` — matches this system's
standing "write but flag/mark, never destroy" philosophy, now extended to
"clear but don't destroy." Every query touching either table was audited
and given a `deleted_at IS NULL` filter (or the LEFT JOIN-condition
equivalent, so a deleted row behaves as "not entered" rather than
excluding the whole flock/date slot) — not just `/flagged` itself but
every downstream analytics/cross-register query: `lib/production.ts`
(entry-screen JOIN), `lib/eggstock.ts` (production-sum cross-check for
the Egg Stock Ledger), `lib/feedBagStock.ts` (feed-bag entry-screen
JOIN), the `flocks.current_bird_count` mirror updates in both write
paths, and both `fn_validate_daily_production` and
`fn_bv300_cum_mortality`'s own internal lookups. The old table-level
`UNIQUE (flock_internal_id, date)` became a partial unique index
(`WHERE deleted_at IS NULL`) so a soft-deleted row no longer blocks
re-inserting a fresh row for the same flock+day — verified locally: a
deleted row stays in place untouched, a fresh insert for the same
flock+date succeeds, and a second insert against the new active row
correctly hits `ON CONFLICT ... WHERE deleted_at IS NULL` instead of
erroring. "Mark reviewed" is unchanged and stays semantically distinct
from Delete: reviewed acknowledges a genuine event (e.g. a real
mortality spike); delete is for wrong or duplicate data (e.g. a
re-uploaded test photo). `/flagged` gained a per-card Delete button (with
a `confirm()` naming the flock and date) on both flagged Daily Production
cards and Unmatched flock label cards, a GET date-range filter, and
checkbox multi-select with a sticky bulk-delete bar — implemented as a
client component (`FlaggedProductionSection.tsx`) that calls the new
`deleteFlaggedRecords` server action directly (not via `<form action>`)
and follows up with `router.refresh()`, since Next.js Server Actions can
be called like plain async functions from a Client Component event
handler. egg_stock/feed_stock cards are unaffected — the owner's request
named Daily Production and Unmatched labels specifically, and those two
registers have no extraction pipeline or `deleted_at` column yet.

**HD% official/written split (owner request — rounding differences
between the supervisor's written HD% and the app's calculated HD% were
flooding `/flagged`):** `hd_percent` is now a Postgres `GENERATED ALWAYS
... STORED` column (`eggs_total / bird_population * 100`, rounded to 2
decimals) — permanently correct, un-writable, and used everywhere as the
"official" analytics value with zero code changes needed on the read
side (`/records` reads plain `hd_percent` and got the new official value
for free). The supervisor's originally written/typed value moved to a
new `hd_percent_written` column, kept purely for reference/audit — every
INSERT and `ON CONFLICT ... DO UPDATE` that used to target `hd_percent`
now targets `hd_percent_written` instead (Postgres rejects any explicit
write to a generated column). The mismatch-flag rule in
`fn_validate_daily_production` (migration `0014_hd_percent_split.sql` —
required a `DROP FUNCTION` + fresh `CREATE FUNCTION` since changing a
function's OUT-parameter shape isn't allowed via `CREATE OR REPLACE`)
now flags only when `abs(hd_percent - hd_percent_written) > 1.0` point;
a gap of 0.2–1.0 points is written to a new `hd_percent_note` column
instead — a quiet, non-flagging note shown on the entry screen under the
HD% field — and a gap under 0.2 is treated as exact. Verified locally:
an 85%-written vs. 90%-calculated row (5-point gap) flags with the exact
expected reason string; a 90.5%-written vs. 90%-calculated row (0.5-point
gap) does not flag and gets the expected quiet-note text. One
self-caught bug during implementation: the two-pass recheck/reapply path
was initializing `hd_percent_note` to `null` on every reapply regardless
of whether that recheck touched HD-related fields, which would silently
wipe a legitimate note computed on the first pass — fixed by threading
the first pass's note through `PendingRecheck` and defaulting the
reapply loop to preserve it.

Both migrations (`0013_soft_delete.sql`, `0014_hd_percent_split.sql`)
were run end-to-end against a local Postgres 16 instance via
`scripts/apply.sh` before shipping, given the unusual SQL involved
(generated columns, a function signature change, partial unique indexes
paired with matching `ON CONFLICT ... WHERE` clauses) — all 14
migrations and 3 seeds applied cleanly, and the functional tests above
were run against the resulting schema, not just reviewed by inspection.

## Phase 3 increment 8: runaway-extraction defenses + digit-accuracy pass (2026-09-28)

**Root cause of the Aug 2 upload failure (owner report):** a photo of the
2026-08-02 register came back from extraction reporting 2774, then 2784,
"flocks" for a 10-flock page — the model got stuck in a repetition loop
instead of stopping once it had covered every flock. No schema change was
needed to fix this (owner's explicit constraint) — everything below is
prompt, application logic, and one new defensive layering, all in
`lib/extraction/`.

**Layered defenses, in the order they actually run:**
1. **Schema hint:** `flocks` gained `maxItems: 20` (double the farm's
   current 10-flock count, headroom for growth) — a strong hint to the
   model, not a guarantee, since Anthropic's tool-use JSON schema isn't
   grammar-enforced for array-length constraints the way `required`/types
   are.
2. **Token ceiling:** `max_tokens` is now a named, reasoned constant
   (5000 — comfortably fits a genuine ~20-flock extraction with the richer
   per-flock schema below, per the token-budget math in the code comment)
   instead of an unexamined round number. A response that hits this ceiling
   (`stop_reason === "max_tokens"`) is never trusted as a real result — it
   throws `ExtractionTruncated` immediately, since a cut-off tool call's
   JSON may be structurally patched up but isn't a genuine read of the page.
3. **Dedupe + sanity check (`extractDailyProductionSafely`):** after
   extraction, rows are deduped by normalized label (collapsing a harmless
   verbatim repeat of the same flock down to one entry). If the *distinct*
   count still exceeds active-flock-count + 2, that's treated as a real
   failure, not a data-quality issue. Verified directly (not just by
   inspection): a simulated 2774-row loop that just repeats the same 10
   labels collapses to 10 (passes, upload proceeds normally); a simulated
   loop of 500 *genuinely varying* labels stays at 500 distinct (correctly
   fails) — dedup only forgives harmless exact repetition, never masks
   actual hallucinated content.
4. **One retry, stricter prompt:** on a first-pass failure (truncation or
   the sanity check), a second attempt runs with an added instruction
   naming exactly what likely went wrong ("you were repeating rows —
   each flock appears exactly once, stop the moment you'd repeat a label").
5. **Clean rejection, never saved:** if the retry also fails, the upload
   returns a plain friendly error ("extraction returned an implausible
   number of rows... please retry") and **no transaction is ever opened** —
   this isn't "we chose not to call INSERT," there's structurally no DB
   write path reachable for a rejected extraction.

**Prefix normalization (owner report — "18AB-1", "13AB-1" both meaning
BAB-1):** `normalizeFlockLabel` (`lib/extraction/flockMatch.ts`) gained a
rule collapsing a leading 1-2 digit run immediately followed by "AB" to
"BAB" — this scribe's "B" is sometimes misread as a stray digit or two,
but the letters "AB" still come through, and a genuine "BAB-N" label never
starts with a digit so this can't misfire on an already-correct one. Unit
tested directly against all the reported garbled forms plus edge cases
(hyphenated, spaced, no separator, a hypothetical real "BAB-18"). This
also strengthens the dedupe step above, since it's the same normalization
function.

**Technical-detail line on save failure (owner report — "please retry"
with nothing else to go on):** a DB write failure now also returns the
real Postgres/driver error text (never the primary message — that stays
plain — as a secondary "Technical detail" line on the page) so the owner
has something concrete to relay when reporting a stuck upload.

**Digit-accuracy pass, same upload flow:**
- **Repeated-copy cross-check:** the register actually writes each flock's
  egg figure up to three times (the "I", "II", "Total" columns) and, when a
  flock's block spans two written lines, writes Bal Bird on both lines —
  confirmed by zooming into the real sample photos (not assumed): "II" and
  "Total" are NOT the same figure in general, and both lines of a two-line
  block repeat the same numbers verbatim. The model now reads each
  appearance independently into `eggs_total_readings`/
  `bird_population_readings`; if they disagree, the row is flagged with
  both readings spelled out directly in `flag_reason` (e.g. "eggs_total
  readings disagree: 6270, 6270, 8679") — verified against the real
  `insertDailyProductionRow` path on a local DB, both the disagreeing case
  (correctly flagged, reasons in-place) and the agreeing case (correctly
  left clean). These readings are diagnostic-only — they do NOT change
  what gets saved to `eggs_total`/`bird_population`, matching this
  system's standing rule of flagging for review rather than silently
  picking between disagreeing reads.
- **Page checksum:** the register's own subtotal row (previously read only
  to know where a table ends, never for its own figure) is now captured
  into `table_subtotals`; the app sums every flock's `eggs_total` and
  compares against the page's own subtotal, flagging every row from the
  upload on a mismatch. Deliberately does **not** auto-trigger a
  second-pass recheck on its own (`impliedFields` in `reextract.ts`
  explicitly excludes it) — a page-wide sum mismatch doesn't point at any
  one flock's field, so auto-rechecking every flagged row on the page would
  be expensive without being any more likely to land on the actual culprit
  than owner review.
- **Automatic second pass:** reuses the existing batched
  `reextractFlaggedFlocks` mechanism (built in increment 2) rather than a
  new one — `impliedFields` now recognizes the two readings-disagreement
  reason strings and maps them to the right field, so a disagreeing row
  automatically joins the same batched recheck call as any other flagged
  field. **Scope cut, stated plainly:** the owner asked for this second
  pass to run "cropped, at higher resolution." That part is NOT
  implemented — doing it properly needs the model to return approximate
  bounding-box coordinates for each flock block (a new capability with no
  way to verify accuracy without live testing against the real vision API,
  which this environment has no credentials for) plus a new image-cropping
  dependency. The recheck re-sends the full photo, same as it already did
  for every other flagged-field case. Flagged as a real follow-up, not
  silently dropped.
- **Compression settings:** `compressImageForUpload`'s defaults were
  1600px/0.82 — shrinking a two-page-spread photo's already-small
  handwritten digits before the model ever saw the page. Bumped to
  2000px/0.9. Checked against two real sample photos: both are already
  under 2000px on their long edge (no upscaling triggered), and a
  from-scratch resize+recompress at the new settings stayed under 0.5MB,
  comfortably inside the existing 7MB client-side / 8MB server-side limits.
- **Few-shot digit examples:** two crops from an already-reviewed sample
  page (BAB-2 and BAB-4/5 rows, chosen after visually confirming they
  contain clean, unambiguous 3s, 8s, 1s, and 7s) are sent as extra image
  content in every extraction call, with neutral factual captions ("this
  row reads 8940... this row reads 3, 24...") rather than asserted
  stroke-shape descriptions that couldn't be independently verified.
  Embedded as base64 constants in `fewShotExamples.ts`, not read from disk
  at runtime — nothing else in this codebase reads a bundled file inside a
  serverless function, and relying on Next.js's file-tracing to correctly
  include an `fs.readFileSync`'d asset would be a new, unverified
  assumption; a base64 literal is unambiguously part of the compiled
  module. Round-trip verified (decoded the embedded constants back to JPEG
  bytes and confirmed an exact byte match against the source crops).

**What could not be verified here:** every prompt change, the few-shot
examples' actual effect on read accuracy, and the retry/reject flow's
behavior against a REAL runaway response all depend on the Anthropic
vision API, which this sandbox has no credentials for. What COULD be
verified directly was verified directly (dedupe math against both a
simulated repeating-loop and a simulated varying-hallucination case, the
prefix normalization against every reported garbled form, the disagreement
flagging and checksum-reason wiring against a live local database) rather
than reviewed by inspection alone. The next real upload is the first true
test of the prompt-level changes.

## Phase 3 increment 9: near-zero false flags — page-checksum rebuild, bal-bird chain, digit evidence (2026-09-28)

**Context:** a full page of 10 correct flocks came back with all 10
flagged. The owner was explicit: flags must mean "a human should look",
not "the app got confused by its own arithmetic" — and handed over
verified ground truth from three real register pages (2026-08-01/02/03,
including exact subtotal rows) as test fixtures, plus a diagnosis to
confirm or refute. All of section 2's fixtures now live as literal
values in a verification script run against this migration and the real
`insertDailyProductionRow`/`checkBalBirdChain`/`checkPageChecksums` code
(not reimplemented for the test) — see the 8-case output this shipped
with. No schema change was strictly required for the checksum rebuild
itself, but two were for the other half of this increment (see below).

**Where the 71850 false-positive number actually came from (owner asked
for this explicitly):** the MODEL, not this app's summing code. The
previous increment's `table_subtotals` had no per-section tagging, so
`app/upload/actions.ts` summed every subtotal entry together and compared
against every flock together. On the real Aug 3 page, the model correctly
read the main section's subtotal (56070) but, for the continuation
section, read a stock-ledger carry-forward line (15780 = 14490 + a 1290
carry) instead of the actual subtotal row one line above it — the app then
mechanically summed 56070 + 15780 = 71850 and compared it against the true
flock sum (70560), correctly-per-its-own-math but on a wrong input. Fixed
two ways: (1) the prompt now spells out the full page layout — main/
continuation tables, the ledger below each subtotal row with concrete
examples (`(+) 185550`, `Buy (−) 216300`, tray counts), Feed Bag Stock
boxes, Chicks rows, bleed-through — and tells the model to read ONLY the
row directly beneath the last flock, never anything below it, never
compute or invent a figure; (2) even if the model still misreads a
subtotal, `pageChecksum.ts` now compares each section's subtotal ONLY
against that section's own flocks (each flock and subtotal explicitly
tagged `section: "main" | "continuation"`), so a bad read in one section
can no longer implicate the other's correct flocks. Verified directly:
feeding the exact 56070/15780 pair back in isolates the finding to the
continuation section alone (main: zero findings) — the old code would
have flagged all 10.

**A page issue is a property of the page, not a flock.** New table
`daily_production_page_issues` (migration 0015) gives page-level checksum
findings their own flagged/reviewed/deleted lifecycle, mirroring every
other register in this schema, shown once as a banner at the top of
`/flagged` and on the upload result — never copied onto every flock row.
Mortality/feed-bag subtotal mismatches are exact checks (same tier as
eggs); a bal-bird subtotal mismatch is informational-only with a ±2
tolerance (verified: Aug 3's real subtotal, 71207, is one off the true sum
71208 — a normal register rounding/carry, not a flag) and never triggers a
page issue by itself, since bal_bird already gets a far more precise,
per-flock check below. When a mismatch traces to exactly one flock's
plausible digit substitution, that flock is named in the banner.

**Bal-bird day-to-day chain (owner-verified: held exactly for all 10
flocks, Aug 2 → Aug 3): `bird_population[today] = bird_population[prev
day] − mortality[today]`.** `lib/extraction/balBirdChain.ts` is a pure
function implementing the owner's exact four-way rule: match; auto-correct
today's figure to the chain-expected value ONLY when that value's implied
HD corroborates today's written HD within 0.15 points (the one place this
whole pass ever auto-applies a value, and only bal_bird, never eggs);
flag the PREVIOUS day's row with a suggestion (never auto-rewritten) when
today's own reading is what actually corroborates written HD instead;
otherwise flag today's row naming the previous day's entry as the likely
culprit rather than the old, misleading "increased" message that blamed
whichever row happened to be newer. Verified against the exact Aug 3
fixtures: BAB-3 (misread 6894) auto-corrects to 6394 with the identical
80.70%-vs-80.7% corroboration in the brief; BAB-1 keeps today's correct
8582 and flags *Aug 2's* stored row with suggestion 8588, reproducing the
brief's own corroboration arithmetic (71.66%, 71.26%) exactly. The SQL
"bird_population increased" rule is suppressed on today's row specifically
in the flag-previous case (`suppressBirdPopulationIncreaseFlag`), since
blaming today's row is exactly the old bug.

**Digit evidence, shared by both of the above plus repeated-reading
disagreement:** `lib/extraction/digitEvidence.ts` — confusion-pair digit
substitution (3↔8, 1↔7, 5↔6, 4↔9, trailing zero dropped/added) plus a
tray-of-30 divisibility check and HD-tolerance scoring, all pure and unit
tested. Reproduces the brief's Aug 1 BAB-9 case exactly: `315` → unique
candidate `3150` (the only substitution divisible by 30), returned as a
**suggestion only** — eggs are never auto-corrected regardless of how
confident the candidate looks, only shown in the flag text, even when (as
in that case) the written HD used for corroboration is itself wrong. When
the three egg-column readings or two bal-bird-line readings disagree,
`writeDailyProduction.ts` now names which one the evidence prefers instead
of just listing them.

**Standing question for the owner, stated as such rather than assumed:**
every egg figure across all three fixture pages (30 flock-days) and every
subtotal was divisible by 30 — treated here as a **soft** signal
(triggers the candidate search, never forces a value, never auto-corrects
eggs) pending confirmation that this farm always counts eggs in whole
trays of 30. If confirmed, later work could reasonably lean on it harder.

**Missing written HD% is no longer a flag** (Rule 4 in
`fn_validate_daily_production`, migration 0015, same OUT-parameter shape
as 0014 so `CREATE OR REPLACE` applies) — `hd_percent` is the generated,
app-calculated figure and doesn't depend on the supervisor having written
one; `hd_percent_written` is a cross-check only, per the owner's framing
("correct eggs and correct bal bird are what matter most").

**Thumbnail clipping on `/flagged` (owner report: thin strip visible,
large blank area below, iPad Safari):** not reproducible in Chromium here
at any width tested — the image rendered at full, correctly-proportioned
size every time, the same "real bug on Safari, absent in Chromium" pattern
as this project's date-filter bug two increments ago. Replaced the
`max-height` soft-cap approach with the standard, most defensive
responsive-image pattern (`width: 100%; height: auto; object-fit:
contain`) rather than iterating on the max-height version blind. Could not
confirm the fix against real WebKit — flagged here rather than implied
tested, matching this project's own established practice for this exact
class of bug.

**Verification approach, in full:** every pure function
(`digitEvidence.ts`, `balBirdChain.ts`, `pageChecksum.ts`) is independently
unit tested with no API or DB dependency. The three DB-dependent brief
test cases (1-3) were run against the real `insertDailyProductionRow` and
a real local Postgres 16 instance with this migration applied, seeding
actual Aug 2 rows and running the actual Aug 3 upload-time logic
end-to-end — not reimplemented or mocked. All 8 of the brief's section-7
cases produced the exact expected output; see the increment's report for
the full transcript. **What remains genuinely untested:** the prompt
rewrite's actual effect on the model's reads, the few-shot examples, and
the thumbnail CSS fix against real Safari — all require live access this
sandbox doesn't have (no ANTHROPIC_API_KEY, no WebKit browser reachable
through the network policy here). The next real upload is the first true
test of the prompt-level changes.

**Follow-up, same day: owner confirmed the tray-of-30 question** ("a tray
of egg sold is of 30 eggs per tray"). Fixing the answer surfaced a real
gap in the increment above: the tray-of-30 signal was only ever consulted
*inside* the readings-disagreement and digit-substitution-suggestion
checks — a consistently-misread eggs figure (all three column copies
agreeing with each other on the same wrong number, e.g. "315" read the
same way three times) had no disagreement to catch it and sailed through
un-flagged, even though the brief's section 4.2 explicitly asked for
`eggs % 30 != 0` to be its own standalone flag-and-suggest trigger.
Fixed: `writeDailyProduction.ts` now flags any saved `eggs_total` that
isn't a multiple of 30 on its own, calling `suggestEggsCandidate` for a
suggestion — still never auto-corrected, same as every other eggs
suggestion in this pass. Verified against the Aug 1 BAB-9 fixture with
all three readings set to agree with each other (315, 315, 315 — the
harder, more realistic version of that test case, since a consistent
misread naturally reproduces itself across repeated reads): now flags
with "eggs_total 315 is not a multiple of 30 ... — suggested: 3150"
independent of whether HD% also happens to catch it. `impliedFields`
maps the new reason text to `eggs_total` so it joins the same automatic
second-pass recheck as every other localized field flag. Prompt wording
and code comments updated from "typically"/"a soft signal, not a hard
rule" to stating the trays-of-30 convention as owner-confirmed.

## Phase 3 increment 10: stop finding a new bug every photo — explicit staged pipeline (2026-09-29)

**Context:** the owner's own words: "stop finding a new bug every time a
new photo is uploaded." Four real register days (Aug 1-4) had each
surfaced a *different* mistake, and the pattern behind all of them was
the same four categories repeating in new disguises — row
misclassification, column misidentification, single-digit misreads, and
checksum/derived-value ordering bugs. The brief asked for two things at
once: fix all 10 named bugs from those four days, AND restructure the
code so the categories can't keep recurring, not just patch each
instance. Full ground truth (all 4 days, written subtotals included) was
supplied as verified test fixtures.

**The core structural change: an explicit 3-stage pipeline
(`lib/extraction/pipeline.ts`).** Bug 8 (checksum computed before
corrections were applied, producing residual false mismatches) turned
out to be a symptom of a deeper problem: there was no enforced order
between "read a flock's own numbers," "cross-check against the previous
day," and "cross-check against the page's own subtotal" — different call
sites could, and did, run these in whatever order the code happened to
be written. Fixed by making the order a type-level guarantee, not a
convention: `resolveFieldsLocally` (stage 2, per-flock, no DB) returns a
`LocallyResolvedFlock`; `applyChainCorrections` (stage 3, needs the
previous day's saved row) takes that as its ONLY input and returns a
`ResolvedFlock`; `applyPageChecksum` (stage 4, needs every flock on the
page) takes `ResolvedFlock[]` as its ONLY input. Stage 4 cannot compile
against raw extraction data or against stage 2's output — the checksum
literally cannot run on pre-correction numbers anymore. `app/upload/actions.ts`
was rewritten to call the three stages in sequence, section-by-section.

**The 10 bugs, what changed:**
1. **Aug 1 BAB-9 dropped-zero eggs+HD** — covered by the standalone
   tray-of-30 flag+suggest (already existed from the increment 9
   follow-up); re-verified via the general digit-substitution logic, not
   against the original page's exact digits (not in hand this increment
   — see "what's still unverified" below).
2. **Aug 2 BAB-1 8↔3 bal-bird misread** and
3. **Aug 3 BAB-3 8↔3 bal-bird misread (auto-corrected)** — unchanged
   logic (`balBirdChain.ts`), re-verified with a fresh synthetic 8↔3 case
   built the same shape as the real one (previous bal bird − mortality =
   expected; extracted figure is a plausible misread of expected; HD
   corroborates) — auto-corrects.
4. **Aug 3 & 4 ledger-line read as the continuation subtotal** — root
   cause fixed structurally, not just re-flagged: `pageChecksum.ts` now
   has `looksLikeGenuineSubtotal()`, the row-signature test made code
   (genuine subtotal = bal_bird AND hd_percent both present, same shape
   as a flock's own row; a ledger line has neither) — applied as a
   model-independent filter before ANY subtotal is used for a checksum
   comparison. The extraction prompt (`dailyProduction.ts`) also gained
   an explicit "ROW-SIGNATURE TEST" section so the model itself is told
   the same rule — untested against the live model (see below), but the
   code-side filter holds regardless of whether the prompt succeeds.
5. **Aug 4 BAB-1 eggs 6080 vs true 6030** — re-verified against the
   *exact* real coincidence the owner reported: BAB-4's correctly-read
   5880 has its own digit-substitution candidate (5830) that happens to
   close the identical section-sum gap as BAB-1's actual misread. A
   naive "find the one flock with a matching candidate" trace would see
   TWO candidates and correctly refuse to guess — which meant the
   brief's own claim that this "worked" would not have reproduced under
   my first implementation. Fixed by moving all three of the owner's
   auto-correct conditions (exact section-sum match, divisible by 30, HD
   within tolerance) into `traceEggsMismatch` as a two-tier filter, so it
   disambiguates on evidence (5830 fails divisibility; 6030 passes both
   extra conditions) rather than just "first exact match wins."
6. **4 flocks with a phantom 3rd eggs reading = that row's own Bal
   Bird** — fixed at the root: the extraction schema's `eggs_total_readings`
   3-element array (an "I"/"II"/"Total" slot) is gone entirely, replaced
   with a single `eggs_ii` field, because "I" is confirmed always blank —
   there is no more empty slot for the model to fill with a nearby
   number. Belt-and-suspenders: `pipeline.ts` stage 2 also discards any
   `eggs_ii` reading that coincidentally equals that row's own mortality,
   feed_bags, or bird_population (the same-value collision guard, Part
   B.2 below) before it's used for anything.
7. **Aug 4 BAB-1 mortality read as its own feed_bags value (18 not 3)** —
   new module `mortalityFeedSwap.ts`: detects mortality == feed_bags as a
   possible column swap, derives the true mortality independently from
   the bal-bird chain (previous day's bal bird − today's bal bird), and
   auto-corrects only when that derived value is sane (0-30) — this
   check runs BEFORE the bal-bird chain check in stage 3, specifically so
   a wrong mortality can't also cause the chain to misfire and blame the
   PREVIOUS day's row for a discrepancy that was actually today's
   mortality miscolumn. Verified this ordering matters with a direct
   contrast test (see fixtures): running the chain first on the
   unswapped mortality misfires; running it after the swap fix doesn't.
8. **Checksum computed before corrections applied** — fixed structurally,
   see above; no longer possible to call stage 4 on pre-correction data.
9. **Page-issue banners duplicating on re-upload** — `upload/actions.ts`
   now soft-deletes every open `daily_production_page_issues` row for
   that farm+date at the start of every upload transaction, unconditionally
   (even when the new upload turns out clean), before inserting anything
   new — no schema change needed, `daily_production_page_issues.deleted_at`
   already existed from increment 9.
10. **`/flagged` thumbnail clipped strip** — the CSS fix from increment 9
    (`width:100%; height:auto; object-fit:contain` on `.flagged-photo-thumb`)
    is still in place and applied consistently at all 4 usage sites
    (`app/flagged/page.tsx` x2, `components/FlaggedProductionSection.tsx`
    x2) — not reproducible in Chromium in either increment, and this
    sandbox has no way to test against real Safari. Stated plainly, not
    claimed fixed.

**Part B audit (row-signature / column-mapping), findings:** grepped
every place the codebase classifies a table row or maps a column to a DB
field. `section_subtotals` (via `looksLikeGenuineSubtotal`) is the only
row-classification point in the pipeline — no second instance found
elsewhere. Column-mapping collision risk was likewise isolated to the
single extraction path; the same-value collision guard (stage 2: an
`eggs_ii` reading equal to this row's own mortality/feed_bags/bird_population
is discarded as a likely copy-from-the-wrong-cell) is the one general
defense this increment adds, on top of the schema-level fix for bug 6's
specific case.

**Migration 0016** (`db/migrations/0016_more_auto_correction_columns.sql`,
applied): `daily_production.mortality_original`, `daily_production.eggs_total_original` —
same "never lose the original value" pattern as `bird_population_original`
(migration 0015), one column per auto-correctable field so multiple
corrections on one row don't collide over which field an "original"
belonged to. Run order: after 0015 (already applied), no other
dependency.

**Synthetic adversarial fixtures (Part B.4, owner's own request):** 28
cases written against the actual pipeline functions (not reimplemented),
covering every named confusion pair (3↔8, 1↔7, 5↔6, 4↔9), both trailing-
zero directions, a same-value column-swap case, a combined mortality-swap
+ bal-bird-chain interaction with an explicit before/after contrast
proving the stage-3 ordering guarantee actually matters (not just
"nice to have"), and three property-based checks (correct data produces
zero page issues; no flock's eggs_total changes when nothing disagreed;
no two fields on one row share a value unless the inputs genuinely did) —
all 28 pass. Re-ran bugs 3-8 above as their own targeted cases against
the exact real numbers quoted in the brief. Bugs 1-2 are covered by the
same underlying (already-tested) logic but not against those two days'
original exact digits, which weren't available in this increment's
context — noted honestly rather than assumed passing.

**What remains genuinely untested — this sandbox has no live Anthropic
API access and no real Safari:** the prompt-level ROW-SIGNATURE TEST and
COLUMN-SWAP WARNING wording's actual effect on the model's own reads; the
`eggs_ii` schema change's effect on what the model reports; and the
`/flagged` thumbnail CSS against real Safari (only re-confirmed present
in source, not re-tested visually). Everything else in this entry was
verified by running the real code — pipeline stages, digit-evidence
scoring, chain/swap/checksum logic — against literal fixture values, not
by inspection alone. The owner's tray-of-30 confirmation ("a tray of egg
sold is of 30 eggs per tray") was already given in the turn immediately
before this brief — not re-asked here.

## Phase 3 increment 10 follow-up: the bug-6 collision guard was one-directional (2026-09-30)

**Context:** first real production upload after increment 10 (a fresh Aug
1 photo, after both PRs merged to `main`) immediately produced a false
`bird_population readings disagree: A, B` flag on 3 flocks (BAB-8/9/10)
where A and B were each individually CORRECT — just two different fields
(`eggs_total` and `bird_population`), not two readings of one field. A
4th flock (BAB-4) showed the same message with two numbers that matched
neither field on its own row — not conclusively diagnosed (see below).

**Root cause, confirmed by reading the deployed code (commit `c21b1be`
on `main`, merge of `db10608` — no drift from what increment 10 shipped):**
the collision guard added in increment 10 for bug 6 (`resolveFieldsLocally`,
`lib/extraction/pipeline.ts`) only ever ran in one direction — it
strips a spurious `eggs_ii` reading that coincidentally equals
`mortality`/`feed_bags`/`bird_population`. It was never mirrored onto
`bird_population_readings`, which was still taken completely at face
value: whatever the live model's tool-call JSON put in that array
(`toolUse.input as ExtractionResult` has no runtime validation) flows
unchanged through `dedupeByNormalizedLabel` — which only drops exact-
repeat rows, never merges fields across different flocks — straight into
the two-line disagreement check. So when the model's own
`bird_population_readings` array for a row contained `[eggs_total's own
value, the real bird_population value]` instead of two genuine Bal Bird
line-reads, the code compared them as if they were competing readings of
one field, and (correctly) picked the real one as "looks right" while
still wrongly flagging the row — bug 6's exact failure mode (a value
from a different column bleeding into a multi-reading array slot),
recurring in the un-guarded mirror direction. Reproduced with a
regression test using BAB-8/9/10's literal real numbers against the
actual deployed function before any change — confirmed it fails
(produces the exact reported flag text) on the current code, then
passes after the fix, without silencing a genuine two-line disagreement
(control case: two real, non-colliding readings still flag).

**Fix:** `bird_population_readings` entries are now filtered through the
same collision principle before being compared to each other — a value
matching `mortality`/`feed_bags`/`eggs_total`/`eggs_ii` on the same row
is discarded (with its own quiet flag note, mirroring the existing
`eggs_ii` guard's note) rather than treated as a legitimate second
Bal Bird line. Only `lib/extraction/pipeline.ts` changed — no HD%,
checksum, or chain logic touched.

**Not resolved, stated plainly:** BAB-4's two reported numbers (7280,
9708) matched neither eggs_total nor bird_population on that row per the
owner's report — this fix only catches a same-row collision against
`mortality`/`feed_bags`/`eggs_total`/`eggs_ii`, and without that row's
extracted mortality/feed_bags in hand it isn't possible to say from here
whether BAB-4 is the same root cause or a distinct one (e.g. genuine
model hallucination unrelated to any real number on the page). Needs
either that row's full raw extraction or, ideally, the actual model
response logged at upload time — neither available in this sandbox.

## Phase 3 increment 10, second follow-up: production crash + a self-correction wrongly shown as a flag (2026-09-30)

**Issue 1 — production crash, `TypeError: a is not iterable`.** Reported
against Vercel runtime logs on the deployment carrying the collision-guard
fix above, logged as `[upload] extraction call failed`. That log line is
produced by exactly one catch block (`app/upload/actions.ts`, around the
`extractDailyProductionSafely` call) — tracing its call graph rules out
the collision guard itself: `resolveFieldsLocally` never runs until
*after* extraction has already succeeded, so nothing in that stage-2
function is reachable from this crash. The real site: `extraction.flocks`
comes from `toolUse.input as ExtractionResult` (`lib/extraction/dailyProduction.ts`)
— an unchecked cast, no runtime validation — passed straight into
`dedupeByNormalizedLabel(extraction.flocks, ...)` (`lib/extraction/flockMatch.ts`),
which does a bare `for (const row of rows)` with no check that `rows` is
actually an array. A malformed or partial model response (missing or
non-array `flocks`) throws exactly `TypeError: X is not iterable` there —
reproduced directly: `dedupeByNormalizedLabel(undefined, ...)` throws
`TypeError: rows is not iterable` against the unmodified function, same
shape as the minified production trace (`a is not iterable`). Fixed:
`dedupeByNormalizedLabel` now returns `[]` for non-array input instead of
throwing; `extractDailyProductionSafely`'s `attempt()` additionally
treats a non-array `extraction.flocks` as a retry-eligible failure (same
bucket as "too many rows"), not a silent empty success, so a malformed
response still gets the existing retry-then-reject treatment instead of
surfacing as a confusing "0 flocks found". `pipeline.ts`'s
`birdPopulationReadings` handling was also hardened the same way as a
precaution (same class of unchecked model-controlled input) — this was
**not** the confirmed cause of this specific crash, stated plainly rather
than implied fixed. Regression test (deleted after use, per this
codebase's established scratch-script pattern): `dedupeByNormalizedLabel`
called with `undefined`/`null`/`{}`/a string/a number all previously threw,
now all return `[]`; a genuine two-row array still dedupes correctly.

Also fixed, per the report: the catch block around the extraction call
previously discarded the real error's `detail` entirely, so an actual bug
looked on screen identical to an ordinary "the model couldn't read this
photo" outcome. It now always includes `technicalDetail` (matching the
"database write failed" branch's existing pattern) and the friendly
message no longer implies it's about photo quality. **Not something a
code change can fully address, stated plainly:** the HTTP 200 status
itself is inherent to how Next.js Server Actions work — an action that
catches its own error and returns a normal `UploadOutcome` object (rather
than letting the exception escape uncaught) completes as an ordinary
transport-level success by design, the same way the *legitimate* failure
paths (a truly unreadable photo) need to for the UI to render gracefully.
Distinguishing "a bug" from "the model couldn't read this" now happens in
the payload (`technicalDetail`), not the HTTP status, since changing the
status would require *also* breaking the graceful-degradation behavior
every other failure in this same catch block depends on.

**Issue 2 — a working collision-guard catch was shown as a flag instead of
a quiet note.** Verified against `daily_production` for BAB-10,
2026-08-01: `flagged: true` on a row whose saved `eggs_total`/`bird_population`
were both correct — the collision guard had discarded a spurious extra
reading and the row was otherwise clean. Root cause: `resolveFieldsLocally`
pushed the collision guard's own "discarded and not used" message into
`extraFlagReasons` — the same array real disagreements (eggs II vs Total,
bal-bird two-line, tray-of-30) use — so a successful self-correction was
indistinguishable from something that actually needed a human. Fixed by
giving stage 2's collision notes their own array (`collisionNotes`),
merged into the EXISTING `autoCorrectionNotes` in stage 3 (no new column —
`auto_correction_note` already exists for exactly this "informational,
row saved clean" case, per its own migration-0015 comment) instead of
`extraFlagReasons`. `upload/actions.ts` needed no changes at all: it
already joins all of `autoCorrectionNotes` into `auto_correction_note`
and passes only `extraFlagReasons` as flag-worthy reasons, so moving the
message between the two arrays at the pipeline level was sufficient.
Verified against BAB-10's real numbers (4320/6328, HD 68.20 vs
calculated 68.27): `collisionNotes` now catches the discard,
`extraFlagReasons` is empty, `autoCorrectionNotes` carries the note
through stage 3 — the row would no longer be flagged (confirmed against
`lib/records.ts`'s `/flagged` queries, which filter on `flagged` being
true) but the note still shows on the entry screen via
`ProductionEntryForm.tsx`'s existing `auto_correction_note` rendering.
Control case confirms a genuine disagreement still lands in
`extraFlagReasons` and is not swallowed by this change.

**Issue 3 — status check on a previously-reported HD-written-digit fix
(BAB-4, `hd_percent_written: 88.10` vs register's true 83.1):** no record
of this request exists anywhere it could — not in this session's history,
not in `git log`, not in this file, not anywhere in the codebase (grepped
for `hd_percent_written_original` and the literal figures), and this
account has exactly one Claude Code session on record, this one. Stated
plainly rather than assumed: **this was never implemented, and as far as
I can find, never actually received.** No `hd_percent_written_original`
column or equivalent exists; `hd_percent_written` is still written as a
single value with no original-value audit trail. Needs a fresh request
(or resending whatever channel the original one went through) to
implement.

**Commit and `main` status:** issues 1 and 2 are one commit touching
`web/app/upload/actions.ts`, `web/lib/extraction/dailyProduction.ts`,
`web/lib/extraction/flockMatch.ts`, and `web/lib/extraction/pipeline.ts`.
Given what happened last round (a commit pushed to this branch after its
PR was already merged, stranded until caught and re-opened as a fresh
PR), this one goes through a fresh PR against current `main` from the
start, merged before being reported as done — not pushed to a branch and
assumed.

## Noted for later phases (no Phase 1 action)

- **Trays-vs-eggs magnitude heuristic (owner addendum, 2026-07-09):** register
  numbers can be trays or eggs depending on magnitude (1 tray = 30 eggs;
  tray-scale ≈ up to a few thousand, egg-scale = tens of thousands). Phase 3
  must treat a magnitude that doesn't fit the expected unit scale for a column
  as a flag trigger — never a silent auto-conversion. Full wording in the
  addendum at the end of `docs/source-specs/extraction-logic.txt`.

- **Phase 3 contradiction to reconcile:** the extraction spec says ledger sale lines
  "attempt match to sales table by name" and lists a "no confident sale match" flag — but
  both docs elsewhere state `sales` is *generated from* ledger entries and has no
  independent source, so there is never anything pre-existing to match against.
- **Potassium Chloride dosage units** — flagged in the brief as unverified against the
  register's actual units; re-check when real Feed Stock pages are entered in Phase 2.
- **Egg Stock Ledger variable-line structure** — to be validated against a full week of
  real entries during Phase 2, per the brief.
