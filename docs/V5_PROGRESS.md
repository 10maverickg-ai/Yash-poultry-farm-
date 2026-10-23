# V5 progress tracker

Master prompt: `docs/V5_MASTER.md` (re-read it, and this file, after any context reset; continue from the first item that is not `built`).
Branch: `claude/v5-integration` (from `main`). Nothing is merged to `main`.
Gate per item: `tsc`, `eslint`, `next build` pass. Status: todo / built / debugged.

## Items
| ID | Title | Status | Notes |
|---|---|---|---|
| 1.1 | Tracker + docs, branch, merge PR #17 branch | built | PR #17 branch merged cleanly (no conflicts) |
| 1.2 | Additive migrations | built | 0025–0029 applied to live Supabase (5 migrations: v5_rates_subsidy, v5_flock_lifecycle_enum, v5_flock_lifecycle_tables, v5_costs_purchases, v5_knowledge_library incl. vaccination_schedule) and to a local Postgres |
| 2.1 | HD% display | built | calculated HD large+read-only on production form, new /day page (flock rows + day total); written % small optional |
| 2.2 | Sales page (Aug sales, Sep lines, bird sales) | built | 26 Aug sales shown; 27 Sept sale/local lines listed as "waiting for a rate" (no guessing); bird sales table from flock_movements (4 rows at ₹73 exist live); links to /sales/rates (item 4.1) |
| 2.3 | Navigation: seven sections | built | bottom nav on phones, header links on wide screens, sub-nav per section; Purchases/Medicines/rates/batches/moulting pages arrive with their items |
| 3.1 | Alert rules (owner-decided) | built | rules in `web/lib/analytics/engine.ts` RULES; never-flag filter in `web/lib/neverFlag.ts`; 22 self-tests pass (`node web/scripts/analytics-check.mts <fixtures> --selftest`). Counts on real data: Aug prod-drop 12, mort 4, low-feed 12, egg 9; Sep prod-drop 8, mort 2, low-feed 5, egg 23, missing 1 |
| 3.2 | Placeholder-age flocks: no standard check | built | flocks with placement 2026-01-01 and placement_date_confirmed not true show "age unknown, no standard check"; real flock name (flocks.display_label) everywhere with register label secondary |
| 3.3 | Revenue / cost / profit on analytics | built | Money card (revenue, cost, profit, revenue/egg vs cost/egg) + month view profit column + watch item; unpriced eggs shown as "left out", never guessed (September has no rates yet) |
| 3.4 | Drop `_stage_dp` | todo (blocked) | verified no views/FKs/functions depend on it (100 rows); `DROP TABLE` via Supabase tool times out at 60 s because destructive SQL waits for a confirmation I cannot give. SQL in Needs owner |
| 4.1 | BAFTA rate entry | built | /sales/rates: paste one or many SMS (parser tested, 14 cases, `node web/scripts/rates-check.mts`), preview, date-mismatch stop, replace-warning, subsidy note; screenshot path calls Anthropic vision only if a key is set (NOT tested) |
| 4.2 | Sales rows from ledger lines when rates exist | built | on save, missing sales rows are created for those days (big/small price, amount = eggs × price, both links set, never duplicated); new uploads reuse a rate up to 3 days old else stay unpriced. Tested on local copy of real rows |
| 5.1 | Cost settings | built | cost_settings seeded with owner's figures (migration 0030, applied live); /purchases page: costs, purchases, diesel forms + monthly cost table |
| 5.2 | Daily/monthly profit | built | engine `web/lib/costs/engine.ts` (day/month/range/per-flock), `node web/scripts/costs-check.mts <fixtures>` 7 checks pass on real Aug rows (Aug revenue ₹10,153,565, cost ₹8,113,574, est. profit ₹2,039,991); Sept electricity shown as missing, not guessed; shown on /purchases (analytics integration = 3.3) |
| 6.1 | Knowledge tables + screens | built | /knowledge (search, topic buttons, source link) and /knowledge/[id] (standards by week + your flocks vs the standard; age unknown for placeholder flocks; missing week = "no reference loaded"). Sample loaded in live DB (16 values, taken only from the existing bv300 table) |
| 6.2 | Knowledge importer + sample | built | `node web/scripts/import-knowledge.mts [--dry-run]`, schema in `knowledge/README.md`, sample `knowledge/sample-bv300-2023.json`; run twice on local DB: counts unchanged (idempotent). Live import was done by equivalent SQL (no DATABASE_URL in the sandbox) |
| 7.1 | Flocks screen / lifecycle | built | flock page: stage timeline + add stage (chick/grower/pre-lay/layer/moulting/sold/depleted; flock_stage_history), placement date with "day-old chick date" and "real date" ticks (turns the standard check on), age, movements list (reason, buyer, price/bird), other flocks that used the same label; list shows age / "age unknown"; enum gained pre_lay |
| 7.2 | Moulting | built | /flocks/moulting: periods, "moulting day N" with expected g/bird and bags next to register bags (BAB-5 day 7 expects 7.7 bags vs 8 in register), confirm/edit dates; BAB-5 Aug 15 pre-filled as inferred (migration 0031, applied live); analytics suppresses alerts from the recorded period |
| 7.3 | Chick batches | built | /flocks/batches: 3 batches seeded from owner's facts (23 May 19,980; 6 Jun 10,000 with 9,263 to Anil farm; 18 Sep 16,000), left/right/row deaths, cumulative % (row 4 = 966 deaths = 6.04% of 16,000 since 19 Sep), BV300 phase + 10-day changeover (3/3/3/1 split assumed), add batch, link to flock |
| 7.4 | Medicines / vaccines | built | /medicines: purchases (cost counted on buy day), vaccination schedule with overdue + mark given, fill from knowledge library (tested locally with a throwaway entry, then removed); live library has no vaccine content yet |
| 8.1 | Multi-photo upload queue | built | /upload = many photos + per-photo date, stored one by one, server-side `upload_queue` (migration 0032, applied live), read in date order via `lib/reader` interface (old reader default; READER_V2_ENABLED never read), statuses waiting/reading/saved/needs review/failed/duplicate, duplicate-date side-by-side keep/replace, retry, stuck-read recovery after 10 min. Old single form at /upload/single. Tested on local DB with fake photo URLs: duplicate parked, failures isolated, buttons write |
| 8.2 | Review screen | built | /flagged "By day" (from PR #17): day groups with the day's register photo (tap for full size), value read, failing check, one-tap answers setting reviewed_by_owner, never-flag filter applied. NOT built: a crop of the exact cell — the old reader gives no cell coordinates (needs reader v2 locations) |
| 8.3 | Date rule | built | `uploadAndExtractDailyProduction` now stops BEFORE saving anything when the page date differs from the entered date and returns dateMismatch; queue shows "use page date / use my date"; single form has the same two buttons. Not tested with a real reading (no API key): the mismatch branch is code-reviewed only |
| 9.1 | Merge readerV2 into integration branch | built | merged origin/claude/yash-poultry-schema-setup-81xuq7 (c974f77) into this branch only; 2 conflict hunks (date rule, HD% display) resolved in favour of the queue-aware date rule; READER_V2_ENABLED is not set or read by the queue (old reader stays the default) |
| 9.2 | Benchmark runs | todo (blocked) | READER_TEST_KEY is set but the Anthropic API answered "credit balance is too low" on a 8-token test call; per the brief I stopped at once and did not retry. No benchmark was run, so there are NO raw-vs-corrected accuracy figures |
| 9.3 | September test dates | todo (blocked) | the September rows have no stored photos (hand-entered backfill; source_photo_url is null for all 30 days), so there is nothing to read; also blocked by credits |
| Z | Debug everything | todo | |

## Migrations applied
- 0025_rates_subsidy.sql: daily_egg_rates + rate_per_100, subsidy_paise, original_text, date_in_message, carried_forward
- 0026_flock_lifecycle.sql: flock_stage += 'pre_lay'; flocks + placement_is_chick_date, placement_date_confirmed, chick_batch_id; flock_stage_history; chick_batches; moulting_periods
- 0027_costs_purchases.sql: cost_settings, purchases, diesel_purchases (bird sales reuse flock_movements)
- 0028_knowledge_library.sql: knowledge_documents / _entries / _standards
- 0029_vaccination_schedule.sql: vaccination_schedule (live: applied together with 0028 as v5_knowledge_library)

## Known bugs
- 8.2: no per-cell photo crop (old reader returns no coordinates); the whole day's photo is shown instead.

## Needs owner
- September BAFTA rates.
- Real placement dates of BAB-8, 9, 10 (placeholder 2026-01-01).
- Exact BAB-5 moulting start date (pre-filled Aug 15 2026, inferred).
- Knowledge content files (including any vaccination schedule).
- Chick-batch details I do not have: source hatcheries, which shed side, link of the 23 May batch to the flock(s) "BAB 10 and 11" (not in the flocks table yet), chick deaths before 12 Aug.
- RLS decision (RLS is OFF on all public tables; not changed).
- Anthropic credits for READER_TEST_KEY (balance too low) before items 9.2/9.3 can run; and the September register photos (none are stored).
- Costs not yet given: September electricity, diesel, medicine purchase prices.
- Item 3.4: run in the Supabase SQL editor: `DROP TABLE public._stage_dp;` (owner agreed; verified nothing depends on it; the MCP tool times out waiting for confirmation on destructive SQL).
- First non-zero BAFTA subsidy: confirm effective rate = rate − subsidy/100.

## Could not test
- Upload queue with REAL photos: needs SUPABASE_SECRET_KEY (storage) and ANTHROPIC_API_KEY (old reader). Tested only the queue mechanics with fake photo URLs. A date mismatch costs a second reading when the owner answers (the first reading is discarded, nothing saved).
- Vaccination fill from the library on live data: no vaccine content in the live knowledge library; tested only on a local throwaway entry.
- Rate screenshot reading (vision): needs ANTHROPIC_API_KEY; code path written, not run.

## Decisions
- `flocks.display_label` IS the real flock name (V5 §2: Sep 9 register shows DB flocks BAB-3,4,5,6,7,10,9,8). My earlier PR #17 note calling it stale was wrong; analytics and the review screen now show it first and the register label as secondary text.
- Moulting: recorded `moulting_periods` rows win; without one the data-based inference (feed ≤25% of own average, HD <80% of before) is used. End of an open period = HD back to 80% of pre-moult after ≥14 days.
- Never-flag filter is read-time only (no rows edited): rows before 2026-09-01, Sep 8/9 feed cells, Sep 15 BAB-3 eggs, Sep 15 breakage 890/390, Sep 20 subtotal, Sep 25 ledger opening, unlabelled ledger lines.
- The old typed `/production` form still exists (needed to correct a day); the new `/day` page is read-only and is the Daily production entry point in the nav.
