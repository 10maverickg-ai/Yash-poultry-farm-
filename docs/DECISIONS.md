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
