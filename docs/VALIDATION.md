# Validation rules — where each one is enforced

Two enforcement layers (hybrid — see `docs/DECISIONS.md` #2):

- **DB constraint** — structurally impossible states; the insert fails.
- **Flag function** — the spec's auto-flag rules; the record is always saved, and the
  function returns the list of flag reasons for the caller to store in
  `flagged` / `flag_reason` and route to the owner's review queue.

Callers (Phase 2 forms, later the Phase 3 pipeline) run the flag function after every
insert/update of the relevant record:

```sql
SELECT fn_validate_daily_production(42);
-- e.g. {"HD% mismatch: written 82.50%, calculated 78.10%"}
-- caller then: UPDATE daily_production
--              SET flagged = true, flag_reason = 'HD% mismatch: …' WHERE id = 42;
```

## daily_production — `fn_validate_daily_production(id)`

| Rule (from schema spec Table 3) | Enforcement |
|---|---|
| `hd_percent` recalculated ≠ stored, tolerance ±0.2% | flag function |
| `mortality` > 3× flock's trailing 7-day average | flag function (skipped when no prior history) |
| `bird_population` increased day-over-day | flag function (all increases — see DECISIONS #10) |
| Missing field (blank in photo) | flag function (all five data columns) |
| One row per flock per day | DB unique `(flock_internal_id, date)` |
| Counts non-negative | DB check constraints |

## Egg stock ledger — `fn_validate_egg_stock_summary(id)`

| Rule (from schema spec Table 4) | Enforcement |
|---|---|
| `closing_balance_eggs` ≠ `total_eggs_produced` + SUM(entries) | flag function |
| Last `running_balance_after` ≠ `closing_balance_eggs` | flag function |
| `total_eggs_produced` ≠ SUM of day's `daily_production.eggs_total` | flag function (skipped until production rows exist for that date) |
| `total_eggs_produced` / `closing_balance_eggs` blank | flag function (grading counts deliberately exempt — DECISIONS #9) |
| Low-confidence category classification on a ledger line | set by the extractor at write time (Phase 3), stored in the entry's own `flagged`/`flag_reason` |
| One summary per farm per day | DB unique `(farm_code, date)` |
| Ledger line order unique within a day | DB unique `(egg_stock_summary_id, sequence_order)` |
| `closing_balance_trays` = eggs / 30 | DB generated column |
| `running_balance_after` | system-calculated: `fn_recompute_egg_stock_running_balances(summary_id)` — never read from paper |

## feed_stock — `fn_validate_feed_stock(id)`

| Rule (from schema spec Table 6) | Enforcement |
|---|---|
| `closing` ≠ `opening` + `purchase` − `consumed` (the quintal/kg catcher) | flag function, tolerance 0.001 kg |
| Opening/Consumed/Closing blank | flag function (blank Purchase = 0, not missing — DECISIONS #8) |
| One row per material per farm per day | DB unique `(farm_code, material_name, date)` |
| Material must be one of the 28 | DB FK → `feed_materials` |

## Flock label resolution — `resolve_flock_internal_id(farm, label, date)`

Returns the `flock_internal_id` whose label history covers that date. Returns NULL when no
label matches (caller flags — possible unlogged renumbering, per extraction spec) and
raises if two flocks claim the same label on one date (the history table itself is broken).

## Not implemented, by explicit spec exclusion

- Ingredient-consumption-to-bags-produced cross-check (no fixed ratio exists)
- Per-flock formulation-to-`feed_bags` validation (formulation is set by group)
- `typical_filled_layer_count` is a reference figure only, not a constraint
