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
| J10 | Final checks | done | tsc, eslint, `next build` clean; 13 regression scripts; analytics self-test 28; rates 26, costs 15, std-for 25, period 53, segment 46, friendly 6, plain 6 checks pass; 360/390/820 px audit of 13 screens and a 22-page sweep: no overflow, no errors, every control ≥ 44 px, no unlabelled fields. |

## J9 — what was found and done
| Check | Found | Done |
|---|---|---|
| Segment control cannot clear | true | "Not set" option; history row stores NULL (migration 0041). |
| Reader prompts / feed-box labels describe 7 + 3 | true | Prompts now describe 8 right-page flocks with ONE feed box (group "ALL"), 3 left-page flocks with small eggs and no feed column, two chick rows; the feed-box pipeline treats "ALL" as the right-page table. NOT TESTED (no credit). `readerV2/corrections.ts` (reader V2, off) still splits 1–7 / 8–10. |
| Slow or failed requests blank the page | true | Root loading screen, friendly error screen with "Try again", not-found screen; read-only queries retried twice; pool connection timeout 10 s. |
| Performance < 3 s | met locally | Production build, local database: Today 0.09 s, Analytics 0.09 s (week/month/year 0.11–0.12 s), Day 0.02 s. Through a throttled "slow 4G" browser (1.6 Mbps, 150 ms): Today 1.2 s, Analytics 0.34 s, Month 0.39 s, Day 0.23 s. Pages are 9–40 KB. Indexes on the big tables already exist (checked; none added). Today and Analytics now read everything in ONE wave of parallel queries. **Not measured against Supabase over a phone connection** (no Vercel access). |
| Upload for a day that already exists | queue: already asked; the one-photo form replaced silently | One-photo form now refuses until "Replace the day that is already saved" is ticked. |
| Review screen quick answers | none | Buttons: Farmfresh sale / Local sale / Breakage / Labour took them / Given to Anil farm / Something else (for added eggs: late eggs of our own flocks / eggs from Anil farm / something else). Sales are created at rate − 0.03 or rate + 0.01; moving a line away from "sale" deletes its sale. Tested in the browser (Farmfresh 5.27 = big_rate on 11 Sep; local 5.31). |
| Rate entry | one path | Must choose "BAFTA message (raw rate)" or "my own price list (net selling price, stored + 0.03)". |
| What changed | none | `/changes` page, linked from Today and the home page. |
| Accessibility / typos / layout | see `docs/UI_AUDIT_V9.md` | focus ring, skip link, 44 px controls, wrapped table labels, flock cards. Not fixed: dense Medicines / Egg-stock forms with developer field names. |

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


---

# V10 — a realistic target learned from the farm's own records (28 Oct 2026)

| Item | Status | What / how checked |
|---|---|---|
| K1 three lines per flock | built | Breeder's target (book, grey), Our realistic target (learned), Actual — on Analytics flock cards, the flock page, Today, and the week/month/year flock tables. Traffic lights are judged against the realistic target; the gap to the book is a plain number ("18.4 points below the book") with no colour. Where a band is not learned, the card is grey: "realistic target not learned yet for this age", book line kept, never silently judged against the book. |
| K2 learning method | built | `web/lib/analytics/realistic.ts`; all thresholds in `REALISTIC_CONFIG`. Healthy days only; 7-day rolling ratio; 70th percentile (deaths: 30th); 5-week bands from placement date (chick-date flocks: age − 18 weeks, one function `bandAgeWeeks`); ≥ 28 healthy flock-days and ≥ 2 flocks; per group (main / young), no borrowing; HD, feed per bird (main only) and deaths per week. Cached by data fingerprint, recomputed whenever data changes. |
| K3 guard rails and slip alert | built | Never above book (deaths never better than book); amber "our realistic level is slipping" when a band's learned HD ratio falls > 3 points between two consecutive month-end computations (Today "may go wrong", Analytics "What can go wrong next", targets page); small trend chart of the main-group learned level by month-end. Sudden-drop alerts are untouched. |
| K4 "How is this learned?" | built | `/analytics/targets`: plain words, days used / left out and why, per group and measure a table (healthy days, flocks, dates used, learned % of book, book, realistic target), owner override per band ("set by owner", wins over learned, "Go back to learned"). Overrides stored in `realistic_target_overrides` (migration 0042). |
| K5 import old registers | built | `/import`: CSV or .xlsx (date, flock label, eggs, birds, mortality, feed bags), template download, dry run, row-level error list, never overwrites an existing day unless ticked, rejects future dates, eggs not multiples of 30 on big-egg flocks, eggs > birds, unknown flocks, duplicates; stored like hand-entered days (same validation function) with `source_tag = 'paper history import'`. No Anthropic. |
| K6 live report | done | `docs/REALISTIC_TARGET_REPORT.md` (below). |
| K7 tests and checks | done | see "Checks run". |

## V10 realistic-target report (K6) — printed before anything was shown to the owner


Printed before anything is shown to the owner. Nothing here is invented: a band with too little healthy data says "not learned yet".
Method and thresholds: `REALISTIC_CONFIG` in `web/lib/analytics/realistic.ts` (70th percentile of 7-day rolling healthy-day ratios to the breeder's book, 5-week age bands, per group, needs ≥ 28 healthy flock-days from ≥ 2 flocks, never above the book).
"seen" = all flock-days in the band; "healthy" = those that passed every filter; "samples" = 7-day rolling values the percentile was taken over.

```
as of 2026-10-26; config {"percentile":70,"mortalityPercentile":30,"minHealthyDays":28,"minFlocks":2,"rampDays":14,"spikeMultiple":3,"spikeMedianFloor":1,"bandWeeks":5,"rollingDays":7,"minHealthyInWindow":4,"departedTrailingDays":7,"chickToLayingWeeks":18,"greenMinRatio":0.9,"amberMinRatio":0.8,"slipPoints":3}

== hd ==
group  band(weeks)  seen  healthy  flocks  samples  from..to              ratio   book@mid  realistic  note
main    20-24          34       18       2       12  2026-07-02..2026-07-16    –    90  not learned  only 18 healthy flock-days (needs 28)
main    25-29          98       84       3       72  2026-07-03..2026-08-22  75.5%  97  73.3  
main    30-34         105      104       3      104  2026-07-30..2026-09-26  74.8%  98  73.3  
main    35-39          95       90       3       90  2026-09-03..2026-10-26  85.9%  97.5  83.8  
main    40-44          34       32       2       29  2026-07-02..2026-10-26  88.6%  96.5  85.5  
main    45-49          35       35       1       35  2026-07-17..2026-08-20    –    95.4  not learned  only 1 flock (needs 2)
main    50-54          35       35       1       35  2026-08-21..2026-09-24    –    94.2  not learned  only 1 flock (needs 2)
main    55-59          83       81       4       72  2026-07-02..2026-10-26  91.7%  92.8  85.1  
main    60-64         105       93       3       93  2026-07-11..2026-08-26  92.2%  91.3  84.2  
main    65-69         105       74       3       71  2026-08-15..2026-09-30  86.0%  89.7  77.1  
main    70-74          87       81       3       81  2026-09-19..2026-10-26  90.9%  87.9  79.9  
main    75-79          32       32       2       29  2026-07-02..2026-10-26  86.3%  86.1  74.3  
main    80-84          35       28       1       28  2026-07-31..2026-08-27    –    84.1  not learned  only 1 flock (needs 2)
main    95-99           8        8       1        5  2026-07-02..2026-07-09    –    77  not learned  only 8 healthy flock-days (needs 28)
main    100-104        35        7       1        7  2026-07-10..2026-07-16    –    –  not learned  only 7 healthy flock-days (needs 28)
main    105-109        63        0       0        0  -..-                     –    –  not learned  only 0 healthy flock-days (needs 28)
main    110-114        70        0       0        0  -..-                     –    –  not learned  only 0 healthy flock-days (needs 28)
main    115-119        10        0       0        0  -..-                     –    –  not learned  only 0 healthy flock-days (needs 28)
young   0-4            62       20       3       12  2026-10-18..2026-10-26    –    –  not learned  only 20 healthy flock-days (needs 28)
young   5-9             7        7       1        6  2026-10-20..2026-10-26    –    –  not learned  only 7 healthy flock-days (needs 28)

== feed ==
group  band(weeks)  seen  healthy  flocks  samples  from..to              ratio   book@mid  realistic  note
main    20-24          34       18       2       12  2026-07-02..2026-07-16    –    95  not learned  only 18 healthy flock-days (needs 28)
main    25-29          98       84       3       72  2026-07-03..2026-08-22  88.4%  108  95.4  
main    30-34         105      104       3      104  2026-07-30..2026-09-26  87.7%  110  96.5  
main    35-39          95       90       3       90  2026-09-03..2026-10-26  92.6%  110  101.8  
main    40-44          34       32       2       29  2026-07-02..2026-10-26  98.3%  111  109.1  
main    45-49          35       35       1       35  2026-07-17..2026-08-20    –    112  not learned  only 1 flock (needs 2)
main    50-54          35       35       1       35  2026-08-21..2026-09-24    –    112  not learned  only 1 flock (needs 2)
main    55-59          83       81       4       72  2026-07-02..2026-10-26  92.8%  112  104.0  
main    60-64         105       93       3       93  2026-07-11..2026-08-26  93.8%  113  106.0  
main    65-69         105       74       3       71  2026-08-15..2026-09-30  87.6%  114  99.8  
main    70-74          87       81       3       81  2026-09-19..2026-10-26  92.5%  114  105.4  
main    75-79          32       32       2       29  2026-07-02..2026-10-26  95.2%  114  108.5  
main    80-84          35       28       1       28  2026-07-31..2026-08-27    –    114  not learned  only 1 flock (needs 2)
main    95-99           8        8       1        5  2026-07-02..2026-07-09    –    114  not learned  only 8 healthy flock-days (needs 28)
main    100-104        35        7       1        7  2026-07-10..2026-07-16    –    –  not learned  only 7 healthy flock-days (needs 28)
main    105-109        63        0       0        0  -..-                     –    –  not learned  only 0 healthy flock-days (needs 28)
main    110-114        70        0       0        0  -..-                     –    –  not learned  only 0 healthy flock-days (needs 28)
main    115-119        10        0       0        0  -..-                     –    –  not learned  only 0 healthy flock-days (needs 28)

== mortality ==
group  band(weeks)  seen  healthy  flocks  samples  from..to              ratio   book@mid  realistic  note
main    20-24          34       34       2       26  2026-07-02..2026-07-18  3546.2%  –  not learned  
main    25-29          98       98       3       94  2026-07-02..2026-08-22  812.1%  –  not learned  
main    30-34         105      105       3      105  2026-07-30..2026-09-26  536.8%  –  not learned  
main    35-39          95       95       3       95  2026-09-03..2026-10-26  280.8%  –  not learned  
main    40-44          34       34       2       30  2026-07-02..2026-10-26  201.2%  –  not learned  
main    45-49          35       35       1       35  2026-07-17..2026-08-20    –    –  not learned  only 1 flock (needs 2)
main    50-54          35       35       1       35  2026-08-21..2026-09-24    –    –  not learned  only 1 flock (needs 2)
main    55-59          83       83       4       71  2026-07-02..2026-10-26  189.0%  –  not learned  
main    60-64         105       93       3       93  2026-07-11..2026-08-26  201.9%  –  not learned  
main    65-69         105       74       3       70  2026-08-15..2026-09-30  213.3%  –  not learned  
main    70-74          87       87       3       87  2026-09-19..2026-10-26  121.6%  –  not learned  
main    75-79          32       32       2       28  2026-07-02..2026-10-26  173.6%  –  not learned  
main    80-84          35       28       1       28  2026-07-31..2026-08-27    –    –  not learned  only 1 flock (needs 2)
main    95-99           8        8       1        4  2026-07-02..2026-07-09    –    –  not learned  only 8 healthy flock-days (needs 28)
main    100-104        35        7       1        7  2026-07-10..2026-07-16    –    –  not learned  only 7 healthy flock-days (needs 28)
main    105-109        63        0       0        0  -..-                     –    –  not learned  only 0 healthy flock-days (needs 28)
main    110-114        70        0       0        0  -..-                     –    –  not learned  only 0 healthy flock-days (needs 28)
main    115-119        10        0       0        0  -..-                     –    –  not learned  only 0 healthy flock-days (needs 28)
young   0-4            62       20       3       10  2026-10-18..2026-10-26    –    –  not learned  only 20 healthy flock-days (needs 28)
young   5-9             7        7       1        5  2026-10-20..2026-10-26    –    –  not learned  only 7 healthy flock-days (needs 28)
```

## Where the bands are missing (plain words)

Only four months (2 Jul – 26 Oct 2026) of records exist, so many bands cannot be learned yet and the app will say "realistic target not learned yet for this age" for them rather than guess:

* **Main group, HD and feed:** learned for ages 25–44 weeks and 55–79 weeks. **Not learned:** 20–24 (only 18 healthy days), 45–49 and 50–54 and 80–84 (a single flock each), 95+ weeks (a few days only, and the book table ends around there).
* **Young group (BAB-9/10/11):** nothing is learned. They arrived in October (about 27 healthy days in the youngest band, one flock short of the minimum in the next), and the young group has no feed column.
* **Mortality:** the farm's deaths per week are several times the book's (book weekly depletion is 0.01–0.15 % at these ages; the farm sees roughly 0.3–0.5 %), so the learned ratios are 120 %–800 % and in the 20–24 band (book 0.01 %) 3500 %. They are real arithmetic on the data, but the ratio is not a useful target for such tiny book numbers; the screen shows the learned deaths per week in plain numbers as well and the owner can override. Most of these flocks have been through only one season, so one bad month shapes a band.
* One extra year of paper-register data (screen K5) would fill most gaps: every age 20–85 weeks would then be seen by ≥ 2 flocks in different seasons.


## V10 Checks run
- `npx tsc --noEmit`, `npx eslint app components lib`, `npx next build`: clean.
- `scripts/realistic-check.mts` (clean fixture, moult fixture, mortality-spike fixture, flagged / missing-feed days, too-little-data band, never above book, override wins and is capped, chick-date age rule, percentile, slip rule, three-line card behaviour incl. grey when not learned): all pass.
- `scripts/import-check.mts` (13 checks on parser and validator): all pass.
- Existing: analytics-check, costs-check, period-check, segment-check, std-for-check, rates-check, friendly-check, plain-check, the 13 `regression-*.ts` scripts: pass (checks that take a fixture folder were run on a fresh dump of the local copy of the live data).
- Browser sweep (production build, local copy of the live data) at 360, 390 and 820 px: Today, Analytics (day/week/month/year), How targets are learned, Import, a flock page — no horizontal overflow, no error screen. Import tested end to end in the browser: dry run lists errors, import wrote 1 good row tagged "paper history import" (then removed from the local copy); override set / rejected above 100 % / cleared.

## V10 Known bugs / findings
- FOUND AND FIXED: React clears the file chosen in a form after an action, so "check, then import" lost the file; the import form now keeps it.
- FOUND AND FIXED: a literal "&apos;" showed in the young-flocks line on Analytics.
- Death ratios are large (120 %–800 % of the book, 3500 % at 20–24 weeks where the book is 0.01 %): real arithmetic, but a weak target; shown with the learned level and can be overridden.
- A band's level after only one season is one season of weather; the more old registers are imported the more reliable.
- The slip alert watches egg production only (feed and death ratios are not a "level that slips").
- The learning counts a day as "moult" only from recorded moults (as everywhere else) and "flagged" only when not accepted by the owner.

## V10 Needs owner
1. Older paper-register data to import (more months better; even one extra year is very valuable) — send CSV/Excel with the columns on `/import`.
2. Confirm the 70th percentile (a good week) versus the median (an ordinary week): change `percentile` in `REALISTIC_CONFIG`.
3. Exact start day of BAB-3's moult.
4. Diesel, medicines and other costs for Jul–Oct.
5. Open ledger questions: 29/30 Jul +300 small eggs; 21 Jul feed box; 19, 20, 21 Oct feed boxes; the 1 Jul page; 2 Oct and 20 Oct chick rows; the 27 and 28 Oct pages.
6. Vercel access approval; Anthropic credits (daily photo upload and the reader are untested); RLS decision.

## V10 Could not test
- Daily photo upload and the reader (no Anthropic credit).
- Vercel preview build and runtime logs (connector not authorised); the app was not run against the live database (migration 0042 was applied to live through the connector).
- Real iPhone Safari / Android Chrome (Chromium at 360, 390, 820 px).
- Importing an .xlsx file in the browser (CSV was tested end to end; the .xlsx reader uses the existing exceljs library, not exercised).


---

# V11 — seasons, deaths on the farm's own level, weather (29 Oct 2026)

Owner decisions (29 Oct 2026): keep the 70th percentile as "a reasonable good week"; deaths are judged against what is realistic for this 25-year-old cage-battery farm in Mohali / Dandrala in this climate, not against the breeder's book; the reference is built from the farm's own 2026 data plus the climate and is labelled "farm's own reference, confirm with vet", never a published standard. A published benchmark for Indian cage farms by Punjab climate was not found.

| Item | Status | What / how checked |
|---|---|---|
| M1 season dimension | built | `REALISTIC_CONFIG.seasonByMonth` (HOT Apr–Jun, MONSOON Jul–Sep, COOL Oct–Nov, COLD Dec–Feb, SPRING Mar, one commented map). Each band is learned per season when that season alone has ≥ 28 healthy flock-days from ≥ 2 flocks; otherwise the all-seasons value is used and the card says "all seasons". Moult days are never mixed in. Unit tests: enough data, too little data, fall-back. |
| M2 deaths | built | Deaths are no longer a ratio to the book. Weekly death rate = deaths in 7 days ÷ the week's average birds × 100; "our usual" = 70th percentile of the farm's own weekly rates per group, season and 5-week age band. Amber above usual × 1.5, red above × 2.5, with two guard rails (below). Starting values until a band has data: cool/cold/spring 0.35 amber / 0.6 red, monsoon/hot 0.55 / 0.9 — marked "starting value". Owner override per band (percent of birds per week). Every flock card shows "Deaths this week x%, our usual y% (season), book z%" with the colour judged against our usual only. Death items on Today (red = what is wrong, amber = may go wrong). |
| M3 weather | built, live fetch NOT testable here | Migration 0043 `weather_daily`; `lib/weather/openMeteo.ts` (Open-Meteo archive + forecast, Mohali 30.70 / 76.72, no key, 10 s timeout, never throws); `lib/weather/store.ts` (cached daily, upsert); `/api/weather` + Vercel cron (`web/vercel.json`, 00:30 UTC daily); pages refresh after the response is sent. The sandbox blocks `archive-api.open-meteo.com` and `api.open-meteo.com` (403), so nothing could be fetched and the live table is empty until the first daily run on Vercel. The app shows "weather not available" and works without it. |
| M4 heat-aware messages | built | A hot day (> 35 °C, or > 30 °C with humidity > 70%) next to a low HD or high deaths adds "hot day: 38 °C, feed intake and eggs usually drop on such days" (week version too) on Analytics cards, Today rows and the flock page; the colour never changes. Max temperature as a thin dashed line on the HD and deaths charts. "What may go wrong soon" from the 3-day forecast: ≥ 38 °C (more water, ventilate, shade) or < 4 °C (cover curtains). |
| M5 Farm reference | built | `/analytics/reference`: season map, starting death values and how they were derived, learned bands with days used, weather columns, the research facts with links, and "These are this farm's own working targets, not published standards; confirm them with your vet", with a link to "How is this learned?". |
| M6 report | done | `docs/FARM_REFERENCE_REPORT.md` (below, read-only, printed before the screens were built). |
| M7 Phase Z | done | see "V11 Checks run". |

## V11 farm reference report (M6)

Printed before anything was shown in the app. Nothing here is invented: a season with no records (HOT, COLD, SPRING) is not shown, and a band with too little healthy data says "not learned yet". These are this farm's own working numbers from its 2026 records, not published standards: confirm them with the vet.

Method: `web/lib/analytics/realistic.ts` (`REALISTIC_CONFIG`). HD ratio = eggs per 100 birds ÷ the breeder's book for the flock's age, 70th percentile of 7-day rolling healthy-day values, per group, 5-week age band and season (fall back to all seasons when the season alone has fewer than 28 healthy flock-days or fewer than 2 flocks). Deaths = the farm's own weekly death rate (% of birds per week), 70th percentile of weekly rates; amber at usual × 1.5 and red at usual × 2.5, with two guard rails (amber never above the starting red limit, red never above 2 × the starting red) and bad weeks (above the starting red) not counted as "usual". Until a band has enough data the starting limits apply: cool/cold/spring 0.35 amber, 0.6 red; monsoon/hot 0.55 amber, 0.9 red.

Reproduce: `npx tsx scripts/farm-reference-report.mts <fixture-dir>` (the fixture = the local copy of the live data, refreshed to 28 Oct 2026).

Seasons present in the data: MONSOON (91 days), COOL (28 days). Seasons with no records (HOT, COLD, SPRING) are not shown and nothing is invented for them.

Starting death limits (percent of birds per week): cool/cold/spring amber 0.35, red 0.6; monsoon/hot amber 0.55, red 0.9. Learned limits = usual x 1.5 (amber) and x 2.5 (red).


## main group, MONSOON

| age band (weeks) | healthy days | flocks | HD: learned % of book | realistic HD (book@mid) | deaths: usual %/wk (healthy days, flocks) | learned amber / red | starting amber / red | book %/wk |
|---|---|---|---|---|---|---|---|---|
| 20–24 | 18 | 2 | not learned yet | – | not learned yet (18 days, 2 flocks) | – | 0.55 / 0.9 | 0.02 |
| 25–29 | 84 | 3 | 75.5% | 73.3 (97.0) | 0.68 (86, 3) | 1.03 / 1.71 | 0.55 / 0.9 | 0.05 |
| 30–34 | 104 | 3 | 74.8% | 73.3 (98.0) | 0.39 (105, 3) | 0.58 / 0.97 | 0.55 / 0.9 | 0.05 |
| 35–39 | 35 | 3 | 80.7% | 78.6 (97.5) | 0.29 (36, 3) | 0.43 / 0.72 | 0.55 / 0.9 | 0.07 |
| 40–44 | 15 | 1 | not learned yet | – | not learned yet (15 days, 1 flock) | – | 0.55 / 0.9 | 0.08 |
| 45–49 | 35 | 1 | not learned yet | – | not learned yet (35 days, 1 flock) | – | 0.55 / 0.9 | 0.10 |
| 50–54 | 35 | 1 | not learned yet | – | not learned yet (35 days, 1 flock) | – | 0.55 / 0.9 | 0.11 |
| 55–59 | 57 | 4 | 90.3% | 83.8 (92.8) | 0.31 (57, 4) | 0.47 / 0.79 | 0.55 / 0.9 | 0.12 |
| 60–64 | 92 | 3 | 92.2% | 84.2 (91.3) | 0.34 (93, 3) | 0.51 / 0.84 | 0.55 / 0.9 | 0.13 |
| 65–69 | 74 | 3 | 86.0% | 77.1 (89.7) | 0.36 (74, 3) | 0.54 / 0.90 | 0.55 / 0.9 | 0.14 |
| 70–74 | 12 | 1 | not learned yet | – | not learned yet (12 days, 1 flock) | – | 0.55 / 0.9 | 0.15 |
| 75–79 | 29 | 1 | not learned yet | – | not learned yet (29 days, 1 flock) | – | 0.55 / 0.9 | 0.15 |
| 80–84 | 28 | 1 | not learned yet | – | not learned yet (28 days, 1 flock) | – | 0.55 / 0.9 | 0.15 |
| 95–99 | 8 | 1 | not learned yet | – | not learned yet (8 days, 1 flock) | – | 0.55 / 0.9 | 0.15 |
| 100–104 | 7 | 1 | not learned yet | – | not learned yet (35 days, 1 flock) | – | 0.55 / 0.9 | – |
| 105–109 | 0 | 0 | not learned yet | – | 0.35 (63, 2) | 0.53 / 0.88 | 0.55 / 0.9 | – |
| 110–114 | 0 | 0 | not learned yet | – | 0.51 (47, 2) | 0.77 / 1.28 | 0.55 / 0.9 | – |
| 115–119 | 0 | 0 | not learned yet | – | not learned yet (0 days, 0 flocks) | – | 0.55 / 0.9 | – |

## main group, COOL

| age band (weeks) | healthy days | flocks | HD: learned % of book | realistic HD (book@mid) | deaths: usual %/wk (healthy days, flocks) | learned amber / red | starting amber / red | book %/wk |
|---|---|---|---|---|---|---|---|---|
| 35–39 | 59 | 3 | 89.9% | 87.6 (97.5) | 0.23 (63, 3) | 0.34 / 0.57 | 0.35 / 0.6 | 0.07 |
| 40–44 | 19 | 1 | not learned yet | – | not learned yet (21 days, 1 flock) | – | 0.35 / 0.6 | 0.08 |
| 55–59 | 26 | 1 | not learned yet | – | not learned yet (28 days, 1 flock) | – | 0.35 / 0.6 | 0.12 |
| 70–74 | 72 | 3 | 93.8% | 82.5 (87.9) | 0.31 (78, 3) | 0.46 / 0.77 | 0.35 / 0.6 | 0.15 |
| 75–79 | 5 | 1 | not learned yet | – | not learned yet (5 days, 1 flock) | – | 0.35 / 0.6 | 0.15 |
| 110–114 | 0 | 0 | not learned yet | – | not learned yet (22 days, 1 flock) | – | 0.35 / 0.6 | – |
| 115–119 | 0 | 0 | not learned yet | – | not learned yet (6 days, 1 flock) | – | 0.35 / 0.6 | – |

## main group, all seasons together

| age band (weeks) | healthy days | flocks | HD: learned % of book | realistic HD (book@mid) | deaths: usual %/wk (healthy days, flocks) | learned amber / red | starting amber / red | book %/wk |
|---|---|---|---|---|---|---|---|---|
| 20–24 | 18 | 2 | not learned yet | – | not learned yet (18 days, 2 flocks) | – | (depends on season) | 0.02 |
| 25–29 | 84 | 3 | 75.5% | 73.3 (97.0) | 0.68 (86, 3) | 1.03 / 1.71 | (depends on season) | 0.05 |
| 30–34 | 104 | 3 | 74.8% | 73.3 (98.0) | 0.39 (105, 3) | 0.58 / 0.97 | (depends on season) | 0.05 |
| 35–39 | 94 | 3 | 87.1% | 84.9 (97.5) | 0.24 (99, 3) | 0.35 / 0.59 | (depends on season) | 0.07 |
| 40–44 | 34 | 2 | 89.4% | 86.3 (96.5) | 0.20 (36, 2) | 0.30 / 0.50 | (depends on season) | 0.08 |
| 45–49 | 35 | 1 | not learned yet | – | not learned yet (35 days, 1 flock) | – | (depends on season) | 0.10 |
| 50–54 | 35 | 1 | not learned yet | – | not learned yet (35 days, 1 flock) | – | (depends on season) | 0.11 |
| 55–59 | 83 | 4 | 91.6% | 85.0 (92.8) | 0.29 (85, 4) | 0.43 / 0.71 | (depends on season) | 0.12 |
| 60–64 | 92 | 3 | 92.2% | 84.2 (91.3) | 0.34 (93, 3) | 0.51 / 0.84 | (depends on season) | 0.13 |
| 65–69 | 74 | 3 | 86.0% | 77.1 (89.7) | 0.36 (74, 3) | 0.54 / 0.90 | (depends on season) | 0.14 |
| 70–74 | 84 | 3 | 91.5% | 80.4 (87.9) | 0.32 (90, 3) | 0.48 / 0.81 | (depends on season) | 0.15 |
| 75–79 | 34 | 2 | 87.8% | 75.6 (86.1) | 0.30 (34, 2) | 0.45 / 0.75 | (depends on season) | 0.15 |
| 80–84 | 28 | 1 | not learned yet | – | not learned yet (28 days, 1 flock) | – | (depends on season) | 0.15 |
| 95–99 | 8 | 1 | not learned yet | – | not learned yet (8 days, 1 flock) | – | (depends on season) | 0.15 |
| 100–104 | 7 | 1 | not learned yet | – | not learned yet (35 days, 1 flock) | – | (depends on season) | – |
| 105–109 | 0 | 0 | not learned yet | – | 0.35 (63, 2) | 0.53 / 0.88 | (depends on season) | – |
| 110–114 | 0 | 0 | not learned yet | – | 0.48 (69, 2) | 0.72 / 1.19 | (depends on season) | – |
| 115–119 | 0 | 0 | not learned yet | – | not learned yet (6 days, 1 flock) | – | (depends on season) | – |

## young group, COOL

| age band (weeks) | healthy days | flocks | HD: learned % of book | realistic HD (book@mid) | deaths: usual %/wk (healthy days, flocks) | learned amber / red | starting amber / red | book %/wk |
|---|---|---|---|---|---|---|---|---|
| 0–4 | 24 | 3 | not learned yet | – | not learned yet (24 days, 3 flocks) | – | 0.35 / 0.6 | – |
| 5–9 | 9 | 1 | not learned yet | – | not learned yet (9 days, 1 flock) | – | 0.35 / 0.6 | – |

## young group, all seasons together

| age band (weeks) | healthy days | flocks | HD: learned % of book | realistic HD (book@mid) | deaths: usual %/wk (healthy days, flocks) | learned amber / red | starting amber / red | book %/wk |
|---|---|---|---|---|---|---|---|---|
| 0–4 | 24 | 3 | not learned yet | – | not learned yet (24 days, 3 flocks) | – | (depends on season) | – |
| 5–9 | 9 | 1 | not learned yet | – | not learned yet (9 days, 1 flock) | – | (depends on season) | – |

## Weeks that crossed amber or red (calendar weeks Monday to Sunday, at least 5 days of rows)

Judged two ways: (A) the limits the app will use (our usual from the farm's own data; the starting values where a band is not learned yet) and (B) the starting values alone.

| flock | week (Mon–Sun) | season | deaths | avg birds | deaths % that week | A: our usual / amber / red | A verdict | B: starting amber / red | B verdict |
|---|---|---|---|---|---|---|---|---|---|
| BAB-1 | 2026-09-28 – 2026-10-04 | COOL | 25 | 6537 | 0.38 | 0.31 / 0.46 / 0.77 (learned, cool) | ok | 0.35 / 0.6 | amber |
| BAB-1 | 2026-10-12 – 2026-10-18 | COOL | 25 | 6491 | 0.39 | 0.31 / 0.46 / 0.77 (learned, cool) | ok | 0.35 / 0.6 | amber |
| BAB-2 | 2026-10-19 – 2026-10-25 | COOL | 41 | 9636 | 0.43 | 0.31 / 0.46 / 0.77 (learned, cool) | ok | 0.35 / 0.6 | amber |
| BAB-4 | 2026-09-28 – 2026-10-04 | COOL | 43 | 9808 | 0.44 | 0.48 / 0.60 / 1.19 (learned, all seasons) | ok | 0.35 / 0.6 | amber |
| BAB-4 | 2026-10-12 – 2026-10-18 | COOL | 38 | 9732 | 0.39 | 0.48 / 0.60 / 1.19 (learned, all seasons) | ok | 0.35 / 0.6 | amber |
| BAB-4 | 2026-10-19 – 2026-10-25 | COOL | 36 | 9699 | 0.37 | starting / 0.35 / 0.60 (starting) | amber | 0.35 / 0.6 | amber |
| BAB-6 | 2026-07-06 – 2026-07-12 | MONSOON | 56 | 6417 | 0.87 | 0.68 / 0.90 / 1.71 (learned, monsoon) | ok | 0.55 / 0.9 | amber |
| BAB-6 | 2026-07-13 – 2026-07-19 | MONSOON | 36 | 6374 | 0.56 | 0.68 / 0.90 / 1.71 (learned, monsoon) | ok | 0.55 / 0.9 | amber |
| BAB-7 | 2026-07-06 – 2026-07-12 | MONSOON | 47 | 4491 | 1.05 | starting / 0.55 / 0.90 (starting) | RED | 0.55 / 0.9 | RED |
| BAB-7 | 2026-07-13 – 2026-07-19 | MONSOON | 25 | 4465 | 0.56 | 0.68 / 0.90 / 1.71 (learned, monsoon) | ok | 0.55 / 0.9 | amber |
| BAB-8 | 2026-07-06 – 2026-07-12 | MONSOON | 73 | 10157 | 0.72 | starting / 0.55 / 0.90 (starting) | amber | 0.55 / 0.9 | amber |
| BAB-8 | 2026-07-13 – 2026-07-19 | MONSOON | 165 | 10037 | 1.64 | 0.68 / 0.90 / 1.71 (learned, monsoon) | amber | 0.55 / 0.9 | RED |
| BAB-8 | 2026-07-20 – 2026-07-26 | MONSOON | 90 | 9904 | 0.91 | 0.68 / 0.90 / 1.71 (learned, monsoon) | amber | 0.55 / 0.9 | RED |
| BAB-8 | 2026-07-27 – 2026-08-02 | MONSOON | 75 | 9827 | 0.76 | 0.68 / 0.90 / 1.71 (learned, monsoon) | ok | 0.55 / 0.9 | amber |
| BAB-8 | 2026-08-03 – 2026-08-09 | MONSOON | 61 | 9762 | 0.62 | 0.68 / 0.90 / 1.71 (learned, monsoon) | ok | 0.55 / 0.9 | amber |
| BAB-8 | 2026-08-10 – 2026-08-16 | MONSOON | 71 | 9695 | 0.73 | 0.68 / 0.90 / 1.71 (learned, monsoon) | ok | 0.55 / 0.9 | amber |
| BAB-8 | 2026-08-17 – 2026-08-23 | MONSOON | 60 | 10402 | 0.58 | 0.39 / 0.58 / 0.97 (learned, monsoon) | ok | 0.55 / 0.9 | amber |
| Old BAB-1 (sold Sep) | 2026-08-17 – 2026-08-23 | MONSOON | 47 | 8518 | 0.55 | 0.51 / 0.77 / 1.28 (learned, monsoon) | ok | 0.55 / 0.9 | amber |

18 flock-weeks cross amber or red under at least one rule. Under (A): 1 red, 4 amber. Under (B): 3 red, 15 amber.

## What this shows, in plain words

* **Seasons in the data:** MONSOON (Jul–Sep, 91 days) and COOL (Oct, 28 days). Nothing is known yet about HOT (Apr–Jun), COLD (Dec–Feb) or SPRING (Mar): those flocks will use the starting limits (and all-season HD ratios) until a year of records or imported paper registers exist.
* **Main group, monsoon:** weekly death rate usual 0.3–0.7 % depending on age (0.68 at 25–29 weeks, 0.39 at 30–34, about 0.3 from 35 weeks on). Many bands outside weeks 25–39 and 55–69 are single-flock, so they fall back to all seasons or the starting limits.
* **Main group, cool (October):** usual about 0.23 % at 35–39 weeks and 0.31 % at 70–74 weeks — close to the starting cool limits (0.35 / 0.6) and about half the monsoon level, as expected.
* **Young group (BAB-9/10/11):** not learned yet (24 healthy days in the youngest band, one flock in the next). They use the cool starting limits.
* **The bad July weeks:** BAB-7 (week of 6 Jul, 1.05 % that week) is red and BAB-8 (week of 13 Jul, 1.64 %, and 20 Jul, 0.91 %) is amber under the app's rules (red under the starting limits alone). Weeks of 0.55–0.9 % for BAB-6/7/8 in July are inside the learned monsoon band and are not flagged by the app, but the starting limits alone would call them amber — a judgement for the vet.
* **BAB-4 (week 115):** 0.37–0.44 % a week all four months. In October the starting cool limit (0.35) calls it amber; the learned all-season band for its age (0.48 usual) does not. Its age band has only two flocks of data, so it is the clearest case for the vet to decide.
* **Honest limits:** with 3 flocks and one season per band the learned "usual" is one season of weather. The guard rail keeps a bad month from silencing its own alert. More years (the paper-register import) make the season bands real.


## V11 Checks run
- `npx tsc --noEmit`, `npx eslint app components lib scripts`, `npx next build`: clean.
- `scripts/realistic-check.mts` (now also: season map; season learned on its own; season too thin so it falls back to all seasons and the card says "all seasons"; weekly death rate arithmetic and scaling; starting limits cool vs monsoon; learned usual and the two guard rails; owner override): all pass.
- `scripts/weather-check.mts` (Open-Meteo response parsing, URLs, India date, archive + forecast calls, MOCKED failures: network error, HTTP 503, junk JSON, a hanging service, database down, missing table; cached daily): all pass. `scripts/heat-check.mts` (hot-day rule at the boundaries, exact sentence, week sentence, forecast alerts at 38 / 37.9 and 4.0 / 3.9, the colour is the same with and without weather): all pass.
- Existing checks: import-check, std-for-check, rates-check, friendly-check, plain-check, segment-check, analytics-check and the 13 `regression-*.ts` scripts pass. `costs-check` and `period-check` hard-code the live data as it stood on 26 Oct: they pass on the 26 Oct fixture and "fail" only on the fixture refreshed to 28 Oct (October day counts 28 instead of 26) — expected, not a regression.
- Browser (production build, local copy of the live data refreshed to 28 Oct): sweep at 360, 390 and 820 px of Today, Analytics (day/week/month/year), How targets are learned, Farm reference, Import, Flocks and a flock page — no overflow, no error screen — once with synthetic weather rows (only to see the temperature line, heat sentence and forecast alerts; removed afterwards) and once with the weather table empty. Death override set (0.40%), rejected above 5%, cleared. Page times 0.03–0.12 s locally.

## V11 Known bugs / findings
- FOUND AND FIXED: a first version learned "usual" deaths from every week, so in a band with only two flocks the bad July weeks of BAB-7 and BAB-8 set the level and silenced their own alert (BAB-7 1.05% was "ok"). Now weeks above the starting red are not counted as usual, amber is never above the starting red, and red is capped at 2× the starting red. With these rules BAB-7 (week of 6 Jul) is red and BAB-8 (weeks of 13 and 20 Jul) amber.
- OPEN: learning can still relax the limits in a thin band: the monsoon 25–29-week band learned 0.68% a week (starting amber 0.55). It is one season of three flocks. The vet should confirm.
- OPEN: BAB-4 (week 115) runs 0.37–0.44% a week; the starting cool limit calls that amber, the learned all-season band for its age (two flocks) does not.
- OPEN: young flocks (BAB-9/10/11) have no learned death band yet (24 healthy days in the youngest band) and use the cool starting limits.
- OPEN: owner overrides apply to every season of a band (the overrides table has no season column; adding one would change a unique constraint, which is not an additive migration).
- OPEN: HOT, COLD and SPRING have no records; those months use all-season HD ratios and the starting death limits until a year of data or imported paper registers exist.
- OPEN: the Mashaly 2004 figures and the Ontario 27 °C threshold on the reference page come from a web-search summary (the sites could not be opened here); the owner's brief figures are shown as "not checked against a source here". The ">10% for older conventional-cage farms" statement was not confirmed by what I found (one US trial reports 4.7% for conventional cages).
- Death limits scale with flock size only through the weekly percentage; a small flock (BAB-7, about 1,700 birds now) crosses the cool amber limit with about six deaths in a week.

## V11 Needs owner
1. Vet to confirm the starting death thresholds (0.35 / 0.6 cool, 0.55 / 0.9 hot), the multiples 1.5 / 2.5, and the season map.
2. Allow `archive-api.open-meteo.com` and `api.open-meteo.com` for the Claude cloud environment if weather should be fetched from here; on Vercel the daily cron needs nothing but a deploy (optionally set `CRON_SECRET`).
3. Older paper-register data to import (more years make the season bands real).
4. BAB-3 moult start day.
5. Diesel, medicines and other costs.
6. Open ledger questions: 29/30 Jul +300 small eggs, 21 Jul feed box, 19/20/21 Oct feed boxes, 1 July page, 2 Oct and 20 Oct chick rows, 27 and 28 Oct pages.
7. Vercel access approval; Anthropic credits; RLS decision.

## V11 Could not test
- Fetching real weather (Open-Meteo hosts are blocked in this environment). The fetch, parse and refresh code is tested with mocked responses only (including failures); the Vercel cron was not run.
- Weather on screen was seen with synthetic rows in the local copy only; the live table `weather_daily` is empty.
- Daily photo upload and the reader (no Anthropic credit); Vercel preview logs; real iPhone / Android (Chromium at 360, 390, 820 px).
- Migration 0043 was applied to live through the connector; the app was not run against the live database.

# V12 — finish the app: medicines, hand entry, health alert, sales recipient, settings, audit (29 Oct 2026)

Branch `claude/v12` from main after V11 (PR #22). Reports: `docs/AUDIT_V12.md` (written before any fix), `docs/INTEGRITY_V12.md`, `docs/SECURITY_V12.md`. Migrations 0044–0047 (all additive, no RLS change) are applied to the live Supabase project and to the local copy.

| Item | Status | What / how checked |
|---|---|---|
| N1 audit first | done | `docs/AUDIT_V12.md`: 38 routes × 360/390/820 px = 114 loads then 232 links (0 errors, 0 broken, 0 sideways scroll) and 17 findings A1–A17, written before any fix; numbers for 28 Oct checked against SQL. Status table added at the end. |
| N2a plain words | built | Egg stock, Feed bags, Production, Feed stock, Purchases settings and Home use plain words and units; page title per section; unnamed inputs have labels. |
| N2b phone tables | built | `StackTables` + CSS: under 600 px tables become cards with a label beside each value; 44 px controls; links inside table cells 44 px. Final sweep: 138 loads, 0 sideways page scroll. |
| N2c tests | built | `costs-check` and `period-check` derive expectations from the data; `scripts/dump-fixtures.mts`; `scripts/run-all.mts` prints a pass/fail table (**30 of 30 pass**). |
| N2d What changed | built | V12 entry in plain words (V9–V11 entries were already there). |
| N3 Medicines | built, photos NOT tried | Migration 0045 `medicine_lines`. `/medicines`: fast entry with "Save and add next", month list with totals per month, flock and shed, "None this month" (monthly_input_status), edit and delete with a confirmation, vaccination schedule done / due soon / overdue / later from the knowledge library, CSV/Excel import with template and dry run, priced lines flow to Costs as medicine / vaccine (checked: Aug ₹850, Sep "none" = ₹0, Oct "not entered"), register photo stored in the `register-photos` bucket. `medicines-check` 21 pass; browser tests at 360/390/820. **Photo upload to storage not tried here (no storage keys in the sandbox).** |
| N4 Enter a day by hand | built | Migration 0046 (`source_tag` on the two ledger tables). `/day/enter`: all 11 flocks, feed box, both egg ledgers with one-tap answers, chick rows, live checks; saves with the SAME writers as the reader (source "manual entry"); anything that does not tie is saved flagged; replacing a saved day needs a tick. `manualday-check` 20 pass; browser test entering a full day at 360, 390 and 820 px (11 flock rows, feed box 198+120−137 = 181, ledgers, 3 sales created at the day's rate, replace flow, digit-by-digit typing). Test day removed afterwards. |
| N5 health alert | built | Deaths above usual two days in a row AND eggs down more than 5% in a week → "What is wrong now" with "call the vet", one event per episode, grouped if 3 or more flocks. On the live data only BAB-2 (27/28 Oct) fires; no storm. `health-check` 11 pass. |
| N6 sales recipient and re-price | built | Migration 0044 `sales.recipient` (backfilled: Farmfresh 79, Local 25, Yash P.F. farms 2); editable on the sale without touching prices; "Re-price the sales of this day" after a rate edit shows before / after totals and changes nothing until confirmed. `reprice-check` 11 pass. |
| N7 integrity sweep | done | `scripts/integrity-v12.sql` (19 read-only checks) → `docs/INTEGRITY_V12.md`: every structural rule passes; 11 register-level questions are owner questions; no code bug. |
| N8 performance, reliability, Settings | built | `/settings`: weather last fetched, last attempt (migration 0047 `weather_fetch_log`), plain-word errors, "Refresh weather now" (one press a minute). Cold first visit on slow 4G (1.6 Mbps, 150 ms) with 0 / 40 / 100 ms database delay per query: every page 1.16–1.41 s (goal 3 s); no index needed. Empty `weather_daily`: 20 pages fine. Database switched off: every page shows the plain "could not load" card and recovers. `weather-check` 24 pass. |
| N9 security / safety | reviewed, 2 owner decisions | `docs/SECURITY_V12.md`: Next 16.2.10 → 16.4.3 (critical advisory) in its own commit; picture-only uploads with a safe extension; response headers; weather route cannot be hammered; client bundle has no secret. **RLS is off on all 45 tables with `anon` rights, and there is no login: owner decisions, not changed.** `safety-check` 7 pass. |
| N10 final checks | done | See below. |

## V12 Checks run
- `npx tsc --noEmit`, `npx eslint app components lib scripts`, `npx next build` (Next 16.4.3): clean.
- `npx tsx scripts/run-all.mts`: 30 of 30 scripts pass (analytics, costs, period, segment, realistic, import, weather, heat, health, medicines, manualday, reprice, safety, friendly, plain, std-for, rates and the 13 regression scripts).
- Browser (production build, local copy of the live data at 28 Oct): `final12.cjs` sweep of 46 routes at 360, 390 and 820 px = 138 loads and 242 links: all 200, 0 console errors, 0 broken links, 0 sideways page scroll, 0 unlabelled inputs, one `h1` each, 0 error words, slowest 1.1 s. Tap targets under 44 px found there (Edit, change, topic links) were fixed and re-measured.
- Forms re-tested in a browser after the Next upgrade: hand-entered day (save, flags, replace), Purchases, How targets are learned, Production entry, Settings button.
- Live database: counts read-only (equal to the local copy); permissions read-only (S1).

## V12 Known bugs / findings
- FOUND AND FIXED: saving a ledger day again failed when a sale line already had its sale row (type error in `salesSync.ts`); would also have stopped a reader re-read of such a day.
- FOUND AND FIXED: first hand-entry form lost keyboard focus after each digit (components defined inside the component); caught by ESLint.
- OPEN: the "Show the board as of" list on Analytics is one long drop-down of 119 days (a date box would be better).
- OPEN: the hand-entry screen asks for numbers for the 11 flocks one card at a time; there is no "copy yesterday" shortcut yet.
- OPEN: owner overrides still apply to every season of a band (needs a non-additive migration).
- OPEN: `exceljs` → `uuid` advisory (moderate); the only offered fix is an old exceljs that would break the Excel export.
- The 28 Oct rate may still change (subsidy): after editing it, use "Re-price the sales of this day".

## V12 Needs owner
1. **Medicine and vaccine register photos for the past four months** (the Medicines screen is ready; also the import file template).
2. **Row-level security decision** (RLS is off on all 45 tables and the `anon` role can read and write them), and **Vercel Deployment Protection / a password** (the app has no login), and **`CRON_SECRET`** on Vercel. See `docs/SECURITY_V12.md` S1–S3.
3. August and September diesel (October is entered: ₹29,000); other costs: repairs, transport, vet, rent, interest.
4. BAB-3 moult start day.
5. Open ledger and chick-row questions: 29/30 Jul +300 small eggs; 21 Jul feed box 173 vs 70; the other ledger and feed-box breaks listed in `docs/INTEGRITY_V12.md` (D1–D10); 1 July page; 2 Oct and 20 Oct chick rows; 19/20/21 Oct feed boxes; 27/28 Oct pages; BAB-2 health on 27/28 Oct (12 and 14 deaths, HD 67%): call the vet.
6. Confirm how sales to the Yash P.F. 12 / 13 / 14 farms should be priced (today they are saved at the Farmfresh price with the recipient "Yash P.F. farms").
7. Vercel access approval (so logs of the Next 16.4.3 preview can be read); Anthropic credits (photo reading).

## V12 Could not test
- The photo reader and photo upload through the queue (no Anthropic credit; the manual entry screen covers the same tables).
- Upload of a medicine register photo to Supabase storage (no storage keys in the sandbox).
- A live weather fetch from here (Open-Meteo hosts are blocked); the live `weather_daily` already has 122 days from the deployed cron. "Refresh weather now" was tested to the point of the service being unreachable (plain-word message, log row) and with mocked answers.
- The Vercel build of the Next 16.4.3 upgrade and the Vercel runtime logs (connector not approved). Revert commit "V12 N9: security update" to go back to 16.2.10.
- A real iPhone Safari and Android Chrome (Chromium at 360, 390, 820 px with touch emulation was used); real database round-trip times (simulated with 40 and 100 ms of delay per query).
