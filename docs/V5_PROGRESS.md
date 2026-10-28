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
| 3.1 | Alert rules (owner-decided) | built | rules in `web/lib/analytics/engine.ts` RULES; never-flag filter in `web/lib/neverFlag.ts`; 21 self-tests pass (`node web/scripts/analytics-check.mts <fixtures> --selftest`). Counts on real data: Aug prod-drop 12, mort 4, low-feed 12, egg 9; Sep prod-drop 8, mort 2, low-feed 5, egg 23, missing 1 |
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
| F1 | Egg build-up rule (follow-up) | built | fires only above 5 days of production (big+small) OR 4+ days since the last Farmfresh sale; Sept 23 → 6 alerts, August 9 → 0; 28 self-tests pass (`--include-cleared` evaluates August) |
| F2 | Missing-day: both ledger sections | built | a day is complete when it has a big AND a small egg_stock_summary row (Sep 3 now ok; was 1 alert, now 0; a day with only one section still alerts) |
| F5 | Sales page shows Sept rates/sales | built | live: 27 Sept sales rows, all priced; Sales page month totals on a local copy of the live rows: Sept 13,46,850 eggs ✓ and ₹71,84,492 (live sum 7,184,492.40 — ₹3.40 above the ₹71,84,489 quoted; not changed). Fixed: the page only loaded the latest 60 sales (53 now) and would have under-counted month totals later; now loads all |
| F3 | Pricing of new ledger sales | built | Farmfresh (big OR small) = rate − 0.03; local (category local_sale, label "local", or a lot ≤150 eggs) = rate + 0.01; enum `sales_transaction_type` += `local` (migration 0033, applied live); rate save no longer writes the generated big_rate/small_rate columns (live has both GENERATED ALWAYS — my first version would have failed there; local test DB now mirrors that); existing sales rows are never re-typed or repriced; tested in browser: rate 5.00 → 4.97 / 4.97 / 5.01 / 5.01 for 7,200 big, 36,330 small, 120-egg lot, "Ashok" |
| F7 | Knowledge content branch | built | `claude/knowledge-content` merged into this branch. It holds 2 files (not 5): its newest commit removed the Hy-Line/Lohmann performance and molt files because the farm uses Babcock and Bovans only; the vaccination files remain (Hy-Line technical update, Merck layer example programme). Importer `--dry-run`: 3 files valid. Loaded: **3 documents, 5 entries, 36 standard values** (BV300 sample 16 + Hy-Line 8 + Merck 12), live and local; run twice, counts unchanged. (a) list + search + topic filter checked; (b) Analytics: BV300 primary, new "extra reference" lines from `hen_day_percent` of other breeds, colour unchanged; (c) Medicines creates dated vaccinations for the 18 Sept batch (Hy-Line 5, Merck 12), Merck labelled EXAMPLE PROGRAMME with a note, due date editable; (d) `hen_day_percent_low/_high`, `egg_weight_g` stored, shown, ignored by comparisons (tested with a throwaway local entry, since removed) |
| F6 | Checks | built | tsc, eslint, next build clean; 13 regression scripts 244 checks pass; analytics 28, rates 20, costs 7 checks pass; knowledge importer dry-run valid |
| F4 | Never alert on reviewed / section-3 items | built | August dates return no alerts by default; owner-confirmed rows (Sep 8/9 feed cells, Sep 15 BAB-3 eggs) skipped via `neverFlag` on rows; reviewed rows suppressed (tests) |
| Z | Debug everything | built (partly) | route sweep 29 routes × 360/390 px: all 200, no horizontal scroll, no console errors; fixed day-nav wrapping and <40 px tap targets; 13 regression scripts 244 checks pass; own self-tests: analytics 21, rates 14, costs 7, knowledge idempotent; live-schema smoke queries for every new page run OK against live Supabase; never-flag filter verified on local copy; Vercel preview pending at time of writing |

## Migrations applied
- 0025_rates_subsidy.sql: daily_egg_rates + rate_per_100, subsidy_paise, original_text, date_in_message, carried_forward
- 0026_flock_lifecycle.sql: flock_stage += 'pre_lay'; flocks + placement_is_chick_date, placement_date_confirmed, chick_batch_id; flock_stage_history; chick_batches; moulting_periods
- 0027_costs_purchases.sql: cost_settings, purchases, diesel_purchases (bird sales reuse flock_movements)
- 0028_knowledge_library.sql: knowledge_documents / _entries / _standards
- 0029_vaccination_schedule.sql: vaccination_schedule (live: applied together with 0028 as v5_knowledge_library)

## Known bugs
- 8.2: no per-cell photo crop (old reader returns no coordinates); the whole day's photo is shown instead.

## Needs owner
- F3: `small_rate` (rate − 0.25) is scrapped and no longer used anywhere. Run when ready: `ALTER TABLE daily_egg_rates DROP COLUMN small_rate;` (it is a generated column; `big_rate` = rate − 0.03 equals the Farmfresh price and can stay).
- (Done by the owner meanwhile: as of 23 Oct the live database already holds BAFTA rates 2026-08-01..10-19 (64 days) and 27 September sales rows; 6 of them are priced differently from the grade rate, e.g. Farmfresh small eggs at the big rate — that is the owner's own entry, left untouched.)
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
- F7: the real importer script could not run against the live database from this sandbox (no DATABASE_URL / DB password here); the identical rows were loaded with equivalent idempotent SQL through the Supabase connector (twice, counts 3/5/36 both times — the second live pass re-ran the two vaccination documents and the BV300 document row, not the BV300 sample's entries, which were already loaded). The real script was run twice on the local database.
- F7 (b): no Hy-Line Brown / Lohmann performance data is loaded now (files were removed from the branch), so the extra-reference lines have only been seen with a throwaway local entry.
- Upload queue with REAL photos: needs SUPABASE_SECRET_KEY (storage) and ANTHROPIC_API_KEY (old reader). Tested only the queue mechanics with fake photo URLs. A date mismatch costs a second reading when the owner answers (the first reading is discarded, nothing saved).
- Vaccination fill from the library on live data: no vaccine content in the live knowledge library; tested only on a local throwaway entry.
- Rate screenshot reading (vision): needs ANTHROPIC_API_KEY; code path written, not run.

## Decisions
- `flocks.display_label` IS the real flock name (V5 §2: Sep 9 register shows DB flocks BAB-3,4,5,6,7,10,9,8). My earlier PR #17 note calling it stale was wrong; analytics and the review screen now show it first and the register label as secondary text.
- Moulting: recorded `moulting_periods` rows win; without one the data-based inference (feed ≤25% of own average, HD <80% of before) is used. End of an open period = HD back to 80% of pre-moult after ≥14 days.
- Never-flag filter is read-time only (no rows edited): rows before 2026-09-01, Sep 8/9 feed cells, Sep 15 BAB-3 eggs, Sep 15 breakage 890/390, Sep 20 subtotal, Sep 25 ledger opening, unlabelled ledger lines.
- The old typed `/production` form still exists (needed to correct a day); the new `/day` page is read-only and is the Daily production entry point in the nav.

---
# V6 (same branch `claude/v5-integration`)

Facts that changed (do not redo): all 30 Sept BAFTA rates + 27 Sept sales rows are in the DB (13,46,850 eggs, ₹71,84,492.40; the extra ₹3 is the Sep 23 90-egg lot re-typed local at 5.38). Pricing: Farmfresh big or small = rate − 0.03; local (local line / label says local / person's name / lot ≤150 eggs) = rate + 0.01. Two breeds: BV300 (nine flocks) and Bovans White (BAB-6, stored as "Bowan").

| ID | Title | Status | Notes |
|---|---|---|---|
| G1 | Merge `claude/f8-breed-standard`; stdFor regression test | built | merged; 1 conflict (load.ts) resolved; my F7 "extra reference" lines removed because F8 says every flock compares only with its own breed; `node web/scripts/std-for-check.mts` 21 checks; local run: BAB-6 "no reference loaded for Bovans White", BV300 flocks colour normally; a Bovans guide loaded later as `knowledge/bovans-white-*.json` (breed "Bovans White", metric `hen_day_percent`) is picked up with no code change |
| G2 | Vercel logs for PR #18 | blocked | Vercel MCP still returns no teams (access link not approved). GitHub status for the PR head stays "pending" (Vercel deploying). Build and runtime logs could not be read; sandbox cannot reach *.vercel.app. Retry after approving the Vercel link. |
| G3 | Alert review table + `alert_feedback` | built | `docs/ALERTS_SEPTEMBER.md` (21 alerts: 7 look real, 12 noise, 2 unclear — guesses with reasons, thresholds untouched; generator `web/scripts/alerts-report.mts`); table `alert_feedback` (migration 0034, applied live); "This was real / This was noise" buttons on every alert on /analytics (stored per alert key, can be changed); tested in browser on the local DB |
| G4 | Excel/CSV export | built | `/export` (month buttons; Daily production, Egg ledger, Egg sales, Costs & profit as real .xlsx via exceljs — dates are dates, numbers numbers, totals row with SUM formulas, per-row formulas for HD%, amount, total, profit — and CSV with UTF-8 BOM); "Download this month" buttons on /day, /sales, /purchases; attachment download (Safari/Chrome). Tested: all 8 downloads 200, bad month/kind 400, files re-read with exceljs (types, formulas, totals row). Not opened in real Excel / not tried on an iPhone |
| G5 | Backup zip | built | `/export/backup` page ("do this on the 1st of every month, keep it in Google Drive") + `/export/backup/zip`: 33 tables as CSV + README.txt with row counts and timestamp in the name; includes soft-deleted rows; tables missing in a database are skipped and noted. Tested on local DB (34 files). Live DB not exercised through the app |
| G6 | Bird sales + Anil farm lists | built | Buyer column with save; separate "Shifted to Anil farm" list (transfers, not sales/losses); `local` added to transaction types. Browser-tested at 390px. |
| G7 | Costs honesty + missing-inputs checklist | built | Migration 0035 (live+local). Missing electricity shows "missing: not entered"; cost/profit labelled incomplete estimate; per-month checklist (electricity, diesel, medicines, labour, packing). Browser-tested locally (none-this-month, electricity save, no overflow). |
| G8 | Today screen | built | `/today` (nav: Analytics section, plus home card). Per-flock eggs/HD% vs own-breed standard with colour + one line, open alerts (max 5, tap to expand), feed days and egg-stock days, cash estimate (marked incomplete), what is missing (photo not uploaded for yesterday, no rate, cost inputs). No new tables. Browser-tested at 360/390 px. |
| G9 | Reader benchmark | blocked | Tiny call (1 message, ~10 tokens, no photo) on 2026-10-23 returned "credit balance is too low". Stopped as instructed; 0 photos run, USD 0 spent. Added to Needs owner. |
| G10 | Phase Z for G1–G8 | done (G2 blocked) | tsc clean; eslint clean; `next build` OK (incl. /today, /export, /export/backup); 13 regression scripts pass (via tsx); analytics selftest 28 PASS; rates-check, costs-check, std-for-check pass; 360 and 390 px sweep of 11 pages: no overflow (fixed a 3 px overflow on /purchases at 360) and no browser console errors. Vercel build/runtime logs NOT read (see G2). |

## V6 Known bugs
- Local test DB shows 33 alerts for September in the month view (live fixtures give 21): the local copy has different flags; not a code difference. Not investigated further.

## V6 Needs owner
1. Run in the Supabase SQL editor: `DROP TABLE public._stage_dp;` and `ALTER TABLE public.daily_egg_rates DROP COLUMN small_rate;` (the tool cannot run destructive SQL).
2. Bovans White management guide / performance table (owner's assistant is getting it) → `knowledge/bovans-white-*.json`.
3. Real placement dates of BAB-8, 9, 10; confirm BAB-5 moult start (Aug 15 inferred).
4. September electricity, diesel, medicines.
5. RLS decision (off on all tables).
6. Mark alerts real/noise after G3.
7. Add Anthropic credits only after G1–G8 are verified.

## V6 Could not test
- G4/G5: files not opened in real Excel or downloaded on an actual iPhone; backup zip not run against the live database through the app (no DATABASE_URL here).

## V6 Decisions
- G1: the F7 extra-reference lines (other breeds' hen-day % on the flock cards) were removed: F8's rule is "own breed only".

- **G9 (owner):** the Anthropic key still reports "credit balance is too low" (checked 2026-10-23). Add credits, then re-run the benchmark; budget cap USD 5.

---
# V7 — Week / Month / Year views in Analytics

| Item | What | Status | Notes |
|---|---|---|---|
| H1 | Period aggregation engine (pure, tested) | built | `lib/analytics/period.ts` (summarizePeriod, compare, rangeOf/shiftRange/lastYearRange, weeksWithin, monthsWithin, runRate). `scripts/period-check.mts`: 44 checks on real Aug/Sep rows (run with `npx tsx`). |
| H2 | Week view UI | built | `/analytics?view=week&p=<date>`; headline cards with change vs previous week, eggs bar + HD% line (inline SVG), day table linking to /day, per-flock table, comparison, alerts, what can go wrong next. |
| H3 | Month view UI | built | `?view=month`; daily series (eggs, HD%, deaths, feed), week-by-week table, sales by buyer/grade/channel, costs with missing inputs and link to the checklist, profit labelled estimate. |
| H4 | Year view UI | built | `?view=year`; month-by-month table + 7 charts, best/worst month, per-flock year summary (months, HD%, deaths %, birds sold), run-rate line only with ≥2 full months, "data since 1 Aug 2026". |
| H5 | Excel/CSV period summaries | built | `/export/download?kind=week|month|year&p=…&format=xlsx|csv`; export page section; per-day (week, month) or per-month (year) rows, real dates/numbers, HD% formula per row, pooled HD% and profit formulas in the totals row, notes on estimates and missing inputs. Re-read with exceljs. |
| H6 | Navigation switch, home/Today links, DECISIONS.md | built | Day / Week / Month / Year switch on every Analytics view (state in the URL); sub-nav entries with correct highlight; home and Today link to this week / month / year; `docs/DECISIONS.md` V7 section. MainNav wrapped in Suspense (useSearchParams). |
| H7 | Verification | done (preview logs not read) | `period-check` 44 PASS on real Aug/Sep rows (Sept 13,46,850 eggs sold, ₹71,84,492.40; weeks 7–13 Sep and 1–7 Sep; partial week 3 of 7; pooled vs mean HD% 68.65 vs 68.83); tsc, eslint, `next build` clean; 13 regression scripts, analytics self-test 28, rates/costs/std-for checks pass; 360 and 390 px sweep of week/month/year/empty-week/day views and 11 older pages: no overflow, no page errors. |

## V7 Known bugs
(none yet)

## V7 Needs owner
Nothing new. Existing list unchanged (Bovans White guide, BAB-8/9/10 placement dates, BAB-5 moult start, September electricity/diesel/medicines, RLS decision, alert verdicts, credits, Vercel link).

## V7 Could not test
- Preview deployment build/runtime logs: the Vercel connector still returns 403 for team yashfarm (access link not approved), so runtime logs were not read.
- Period views were browser-tested against the local copy of the data, not the live database (live read queries are the same SQL as the existing Sales/Costs pages plus a ledger-deductions query that was run directly on live).
- Excel formulas were checked by reading them back with exceljs, not by opening Excel/Numbers on a phone.
- Same-month-last-year comparison is untested with real data (none exists before Aug 2026); only the empty case ('no earlier data') and the shifting arithmetic are tested.


---
# V8 — analytics per segment, checks against July–October data (branch claude/v8, from main after PR #18)

| Item | What | Status | Notes |
|---|---|---|---|
| S0.1 | `flocks.segment` + history + control on Flocks screen | built | Migrations 0036, 0037 (live + local). Backfilled: BAB-1..8 and the two departed flocks main; BAB-9, 10, 11 young. |
| S0.2 | Engine: every aggregate takes a segment | built | `dayTotals`, `farmToday`, `eggStockDays`, `monthView`, `alertsFor`, `watchList`, `summarizePeriod`, exports. Whole farm = sum. |
| S0.3 | One panel per segment on Analytics and Today | built | `components/SegmentPanels.tsx`, `lib/analytics/segments.ts`; week/month/year views are split per segment with the whole farm last. |
| S0.4 | Ramping up (young, first 60 days of lay) | built | Status "Ramping up", no standard check, no low-HD alert, own-7-day trend. |
| S0.5 | Alert rules get a segment; moves re-evaluate from the move date | built | `alertKey` for young farm-wide alerts ends `farm-young`. |
| S0.6 | Sales and Egg Stock pages by group | built | Sales month table: main/young/whole farm + local; Egg Stock: group table with a check line. |
| S0.7 | Read-only per-segment check vs SQL | done | `docs/SEGMENTS_CHECK.md`, `scripts/segment-check.mts`. |
| S0.8 | DECISIONS.md | done | |
| I1 | Check the app against July–October data | done | Day pages (2 Jul, 6 Jul, 27 Jul, 4 Oct, 21 Oct, 26 Oct): flock count, totals and both ledgers equal direct SQL. Sales month totals equal the reference SQL (Jul 19,20,270 eggs / ₹1,18,31,835 incl. 600 local; Aug 20,22,930 / ₹1,03,01,556; Sep 13,46,850 / ₹72,24,898; Oct 16,08,960 / ₹86,25,758). Export Jul and Oct (production, sales) equal SQL. ONE DIFFERENCE FOUND AND FIXED: the Sales page listed all July (1,920,270) and October (1,608,960) eggs as "waiting for a rate" because 49 ledger lines had linked_sale_id NULL (migration 0039). Year view says data starts 2 Jul 2026 and names the partial months (Jul 30 of 31 days, Oct 26 of 31). |
| I2 | Departed flocks and unknown ages | done | Departed flocks are "left", no cards or alerts after their last day, still in history and sales. Unknown/placeholder age: "age unknown, no standard check". Stray dots fixed ("placement date not set"). |
| I3 | Feed logic | done | Oct 1–26 alerts before (main engine) / after: low_feed_stock 1 / 1, production_drop 11 / 11, missing_day 2 / 2, feed_anomaly 0 / 0, egg_buildup 0 / 7 (new: young small-egg stock built to 8 days between 3 and 12 Oct, hidden before by the whole-farm pool). Null feed never fires "0 feed"; box check uses only its 8 linked flocks; feed per bird uses only rows that record feed. |
| I4 | Ledger arithmetic | done | Every ledger row Jul–Oct ties (opening + produced/late additions − sales − breakage − other = closing), the ledger export gained a Late additions column and a closing check. Opening-to-previous-closing gaps: only 25 Sep big −30 (known) and 30 Jul big +30 (new question for the owner). 28 Jul and 22 Oct (2,520) tie. |
| I5 | Daily upload flow from 27 Oct | blocked | Anthropic key: "credit balance is too low" (checked 27 Oct) — stopped as instructed. Prepared without credit: flock_label_history synced (migration 0038) so "BAB-1..11" match the right flocks and BAB-9..11 exist; flock cap in the schema is 20. NOT done: the reader prompts and ledger/feed-box labels still describe the old 7 + 3 layout (BAB-1..7 big, BAB-8..10 small, boxes "BAB-1-7"/"BAB-8-10"; the new page is 8 + 3 with one box "ALL") — change when credit allows so the change can be tested. |
| I6 | Final checks | done | tsc, eslint, next build clean; 13 regression scripts; analytics self-test 28; rates, costs, std-for checks; period-check 50; segment-check 36; 360/390 px sweep of 20 pages: no overflow or errors. |

## V8 Known bugs
- FOUND AND FIXED: Sales page showed July and October ledger sales as "waiting for a rate" (49 lines with linked_sale_id NULL) — migration 0039, plus the query now also checks the sales row.
- FOUND AND FIXED: flock_label_history still had the pre-27-Oct names, so a photo uploaded from 27 Oct would have been filed under the wrong flock, and BAB-9..11 had no label — migration 0038.
- OPEN: 30 Jul big ledger opens 30 eggs over the previous closing (owner question).
- OPEN: reader prompts and the feed-box group names still describe the old 7 + 3 layout (I5, needs credit to test).
- OPEN: the young small-egg "no Farmfresh sale for 4+ days" rule uses the same 4-day limit as big eggs; small eggs sold 7 times in Oct only every 3–9 days, so it fires 7 times in October. Real build-up (8 days of stock on 11 Oct), but the limit may be too tight for small eggs — owner to decide.
- Per-segment cost and profit are not computed (shared costs are not split); shown for the whole farm only.
- The segment control cannot clear a segment back to "not set" (only change it).

## V8 Needs owner
1. Confirm the MAIN / YOUNG split (BAB-1..8 / BAB-9..11).
2. Real placement dates for BAB-6, 7, 8 (placeholder 2026-01-01) and BAB-9, 10, 11 (none).
3. BAB-4 (placed 9 Aug 2024, week 115): was it moulted, and when did its second cycle start? (The BV300 table stops at week 100, so it has no standard check until this is known.)
4. Cost inputs: Sep and Oct electricity, diesel, medicines, chick costs.
5. Open ledger questions listed in `claude/status-2026-10-27.md` (not in this repo; please paste them), plus: 30 Jul big opening is 30 over the previous closing.
6. Vercel access approval (so I can read preview build and runtime logs).
7. Anthropic credits (I5 and the reader benchmark).
8. RLS decision.
9. Is 4 days without a sale too tight for small eggs (7 young-group build-up alerts in October)?

## V8 Could not test
- I5: the daily photo upload (no Anthropic credit).
- Vercel preview build and runtime logs (connector not authorised for team yashfarm); everything was tested on a local copy of the live data (refreshed 27 Oct) with Playwright, not on iPhone Safari or Android Chrome.
- Migrations 0036–0039 were applied to live through the Supabase connector and verified with SQL; the app code was not run against the live database.
- Moving a flock between groups was tested on the local copy only (BAB-9 main and back), not on live.


---
# V9 — costs, targets, plain language (branch claude/v9, from main after PR #19)

| Item | What | Status | Notes |
|---|---|---|---|
| J1 | Young small-egg limit 6 days | built | `EGG_LIMITS` constant. October egg build-up alerts (young) **7 → 5** (the 7 and 20 Oct "4 days without a sale" alerts are gone; the 5 left are stock above 5 days: 8, 9, 10, 11, 15 Oct). If the stock limit were also 6 days, 8 and 15 Oct would go too (→ 3) — owner to say. |
| J2 | Chick cost in profit | built | Batch count × ₹52, in the month of arrival, own line "Chick purchase (average ₹52 per chick)"; Sep = 16,000 × 52 = ₹8,32,000. Diesel, medicines and other costs show "not entered". Migration 0040 allows "other" in the monthly checklist. |
| J3 | Feed cost, electricity, monthly lines | built | See table below. `scripts/costs-report.mts` prints them. |
| J4 | BAB-4 past the end of the table | built | "past the end of the breeder's target table (week 115; the table stops at week 100)"; own 7-day trend alerts still run. |
| J5 | Placeholder rule | built | One rule (`isPlaceholderDate`) used everywhere: placeholder only if 2026-01-01 AND not confirmed. BAB-6 (confirmed) and BAB-7/8 show age and target. BAB-9/10/11 use the chick arrival date (the breeder table counts from day-old) and show the target for information while ramping up. |
| J6 | Moult handling | built | Only recorded moults count (BAB-3). The card says "moult dates not confirmed" and is not compared with the target; no other flock is ever moulting. |
| J7 | Sales for 15 and 24 Sep | done | Page totals = SQL: Sep Farmfresh 21 rows, 12,79,860 eggs, ₹68,75,181.60; local 7 rows, 74,490 eggs, ₹3,92,438.70; 103 sales rows. No page differed (the Type column showed "other"; it now says Local). |
| J8 | UI pass | built | `docs/UI_AUDIT_V9.md`; Today in three plain parts. |
| J9 | General fixes | built (see list) | Segment can be cleared; reader prompts updated; retry + friendly error/loading states; one-photo form asks before replacing; one-tap answers on the review screen; rate entry asks BAFTA message or own price list; "What changed" page. |
| J10 | Final checks | see below | |

## J3 — cost and profit lines (local copy of the live data, 28 Oct)
| Month | Feed | Labour | Electricity | Packing | Chick | Total cost so far | Egg revenue | Profit (estimate) | Basis |
|---|---|---|---|---|---|---|---|---|---|
| Aug | ₹83,25,667 | ₹3,50,000 | ₹1,00,000 | ₹2,69,724 | ₹0 | ₹90,45,391 | ₹1,03,01,556 | ₹12,56,165 | full month; INCOMPLETE (diesel, medicines, other not entered) |
| Sep | ₹70,71,793 | ₹3,50,000 | ₹99,080 | ₹1,80,580 | ₹8,32,000 | ₹85,33,453 | ₹72,67,620 | −₹12,65,832 | full month; INCOMPLETE (same) — the loss is mostly the 16,000 chicks counted in September |
| Oct | ₹56,33,437 | ₹2,93,548 | ₹48,796 | ₹2,14,528 | ₹0 | ₹61,90,309 | ₹86,25,758 | ₹24,35,449 | **TO DATE: 26 of 31 days** (data ends 26 Oct; labour and electricity counted for 26 days); INCOMPLETE |
| Jul | not entered (price starts 1 Aug) | not entered | not entered | not entered | – | – | ₹1,18,31,835 | – | 30 of 31 days; no cost inputs |
Feed = bags × 45 kg × ₹33.33 (price row effective 1 Aug 2026). Electricity for Sep (₹99,080) and Oct (₹58,180) is picked up.

## V9 Known bugs / findings
- FOUND AND FIXED: Costs table pushed the amounts off the screen on a phone (long labels did not wrap).
- FOUND AND FIXED: July's two open ledger questions were hidden because everything before 1 Sep counted as cleared (only August was).
- FOUND AND FIXED: a flock-segment history row could not be "not set"; migration 0041.
- OPEN: reader V2 (off) still splits feed boxes 1–7 / 8–10 in `readerV2/corrections.ts`; the old reader's feed-box pipeline now treats the box "ALL" as the right-page table. Not testable without credits.
- OPEN: the "4 days without a sale" limit for the main group's big eggs is unchanged (4).
- OPEN: the Egg stock entry and Medicines forms still use developer field names (see the UI audit).
- Sept loss: the 16,000 chicks (₹8,32,000) land in September by design; the owner may prefer to spread them — not done without his say.

## V9 Needs owner
1. Exact start date of BAB-3's moult (September?); left "not confirmed".
2. Diesel, medicines and other costs for Jul–Oct (or "none this month").
3. Open ledger questions: 29/30 Jul +300 small eggs (now on the Review screen — answer with the buttons); 21 Jul feed box 173 vs 70; 19, 20, 21 Oct feed boxes; the 1 Jul page; chick rows 2 Oct and 20 Oct; the 27 and 28 Oct pages.
4. Is the 6-day limit for small eggs also meant for the stock-days limit (now 5)?
5. Should chick cost stay in the month of arrival (September) or be spread? (Currently: month of arrival.)
6. Vercel access approval; Anthropic credits (blocks the daily photo upload and the reader); RLS decision; confirm the main/young split.

## V9 Could not test
- The daily photo upload and every reader prompt change (no Anthropic credit).
- Vercel preview build/runtime logs (connector not authorised). Page timings were measured on a production build against the LOCAL database (see J9 below), not over a phone connection to Supabase.
- Real iPhone Safari / Android Chrome (checked in Chromium at 360, 390 and 820 px).
- Migrations 0040 and 0041 were applied to live through the connector; the app was not run against the live database.
