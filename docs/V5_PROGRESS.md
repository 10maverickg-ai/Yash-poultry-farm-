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

# V14 — medicines from one master list, per-flock boosters, chick vaccination plan (7 Nov 2026)

Branch `claude/v14` from main after V13 was merged (PR #24) and reverted (PR #25): the login is deferred and was not touched. The login tables of migration 0048 stay in the database, unused. Plan written first: `docs/MEDICINES_V14_PLAN.md`. Migrations 0049 to 0051 (all additive, no RLS change) are applied to the live project and to the local copy. `READER_V2_ENABLED` not set; no Anthropic credit spent.

| Item | Status | What / how checked |
|---|---|---|
| Q1 audit first | done | `docs/MEDICINES_V14_PLAN.md`: what exists (V12 `medicine_lines` with typed names and one target per line, `vaccination_schedule`, import, costs flow), what changes, how old lines are carried over. Live check (read-only): `medicine_lines` 0 rows, `vaccination_schedule` 0 rows; chick batch 3 (18 Sep, in the chick shed) is on day 51. |
| Q2 master list | built | Migration 0049: `medicine_catalogue` (unique on lower(name)) + `medicine_aliases` (an alias can never be another item's name: app check and database trigger). Seeded with only what the owner said: 22 items, 16 other spellings (MAS = MA5, Coryza = Croyza, Lufofloxin = Levofloxacin, …). His guesses (MD, IBD, LASOTA, Croyza, NDIB, N.D.K spelling HUUESHEILD, the two lay booster items) are "to confirm"; Levofloxacin is a water medicine "given when needed"; debeaking and nail cutting are farm tasks; no doses invented. Screen `/medicines/list`: search, add (to confirm unless ticked as checked), edit, other spellings, mark as confirmed, take out of the pick list (never deleted once used), plain labels. Browser test at 360/390/820 px. |
| Q3 usage linked to the list | built | `medicine_lines` + `catalogue_id`, `entry_group`, `cost_total_inr`, `quantity_total`, `split_basis`. Entry form: search the list, tick flocks (whole farm / main / young), date, quantity, cost, photo; "add a new one" creates a "to confirm" item. One line per flock; totals split by birds on the date (equal when a count is unknown) summing to the total exactly, with the sentence on screen before and after saving. Month totals, none this month, edit and delete with confirmation, save-and-add-next and the cost flow kept; a grouped line says it is one of N and "delete the whole entry" works. Old typed lines match by exact name or other spelling by themselves; the rest under "Not matched to the list" with a one-tap match. Browser-tested end to end (8 flocks, ₹1,000 and 3 bottles: lines add up to 1000.00 and 3.000). |
| Q4 per flock | built | `/medicines/flocks` ("What is each flock on") and the same card on every flock page: ND and LPAI boosters with a traffic light that is also written in words, last date, next due, what was given (latest first), mobile cards grouped Main / Young. |
| Q5 boosters every 6 months | built | Migration 0050 `vaccine_repeat_rules` (+ items that count): ND booster and LPAI booster, 6 months, laying flocks. Next due = last + 6 calendar months, month ends clamped (31 Aug → 28 Feb, 29 Feb 2028 → 29 Aug 2028). **A flock with no recorded date is "last date not entered" (amber) with "Enter the last date": never assumed, never done.** Today: ONE line per vaccine (overdue and due within 14 days together, flocks listed) plus ONE line for missing dates, at the top of "may go wrong soon": at most three lines for 11 flocks. |
| Q6 chick vaccination plan | built | Migration 0051 `vaccination_schedule_template` (the owner's 16 steps = 25 rows, linked to the list) + `catalogue_id`, `template_id`, `window_end` on `vaccination_schedule`. `/medicines/chicks`: the schedule, a preview for any arrival date (nothing saved), per batch "Make the plan" (existing batches) or automatic for a newly registered batch, steps done / overdue / due now / due soon / later in words, tick-off with the real date (and take back), debeaking and nail cutting as tasks, Today line per batch with a plan. Nothing is created for the current flocks or batches automatically. |
| Q7 import | built | CSV/Excel columns: date, name (list item or other spelling), flock (`BAB-1; BAB-2`, main, young, all), quantity + unit, cost (totals), supplier, note; new template; dry run; unknown names listed once with a choice (match / add as "to confirm" / leave out) and Import refuses until each is answered; per-flock lines with the same split rule; repeats are skipped. Browser-tested (alias, main, all, unknown name, future date, farm task, repeat; second import = all "already in the register"). |
| Q8 plain words, tests, docs | done | `scripts/medicines-v14-check.mts` (58 checks, in `run-all`): list uniqueness and aliases (app and database), entries for several flocks with exact splits (500 random cases), the booster rule incl. no date and month-end / leap cases, schedule generation from a placement date, grouped alerts, old-line matching, import, cost flow; leaves nothing in the database. What changed entry and DECISIONS. See below. |

## V14 Checks run
- `npx tsc --noEmit`, `npx eslint app components lib scripts`, `npx next build`: clean.
- `npx tsx scripts/run-all.mts`: 31 of 31 scripts pass, including the new `medicines-v14-check` (58 checks; it leaves nothing in the database) and `medicines-check` (the V12 checks, import tests moved to the new script).
- Browser (production build, local copy of the live data; test lines and a test plan were inserted for the sweep and removed afterwards): 54 routes at 360, 390 and 820 px = 162 page loads and 273 links (every old page plus `/medicines` with entries, grouped lines and unmatched lines, `/medicines/list` and an item page, `/medicines/flocks`, `/medicines/chicks` with a plan and a preview, `/medicines/import`, a flock page, Today): all 200, 0 console errors, 0 broken links, 0 sideways scroll, 0 unlabelled inputs, slowest 1.0 s. The only tap targets under 44 px were card-title links (Knowledge, the flock names on the new screens): fixed and re-checked (21 loads, 0 small).
- Test rows created while testing (catalogue items, medicine lines, plan rows, a test chick batch) were all deleted; the local and live catalogue and template hold only the seed.

## V14 Known bugs / findings
- The 22 seeded items and the 25 template rows come from the owner's message of 7 Nov; eight items are marked "to confirm" and must be checked by the owner or the vet.
- The split on the entry screen is shown on the latest bird counts; the saved split uses the counts on the entry's date (the sentence after saving shows the exact figures).
- Whole-farm and shed lines from the V12 entry still count towards boosters (a farm line counts for every laying flock); the new entry always writes one line per flock.
- After a one-tap match or "Mark as confirmed" the card disappears from its list (the answer is the change itself); the confirmation message is not kept.
- Chick batch 3 (18 Sep, day 51) has no plan until the owner taps "Make the plan"; all steps up to day 46 would then show overdue until he ticks what was done.
- The existing "Add a vaccination" and "Fill a schedule from the knowledge library" boxes on `/medicines` still take a typed vaccine name (V12 behaviour); the chick plan and the boosters use the list.
- Older: the "Show the board as of" list; owner overrides apply to every season; `exceljs` advisory.

## V14 Needs owner
1. **Last ND booster date and last LPAI booster date for each flock** (BAB-1 to BAB-11): enter them on "What is each flock on" (until then every flock says "last date not entered").
2. **The other medicines in use** (water medicines, vitamins, liver tonic, calcium, dewormer, other antibiotics) with how they are given and the usual dose: add them to the Medicines list, or send the list and it is loaded.
3. **Confirm the guesses marked "to confirm"**: Marek's for MD, Gumboro for IBD, LASOTA as Newcastle, coryza for Croyza, what NDIB protects against (brand Ceva), the spelling HUUESHEILD (N.D.K) and Hester (R6 + R8 on day 102); the exact product names for the ND and LPAI boosters.
4. Chick batch 18 Sep 2026 (on day 51): say which steps were done if you want its plan ("Make the plan" then tick).
5. Medicine and vaccine register photos for August to November; August and September diesel and the other costs; BAB-3 moult start day; the open ledger and chick-row questions (`docs/INTEGRITY_V12.md`); how sales to the Yash P.F. farms are priced.
6. Vercel access approval; Anthropic credits; the database-door (anon) decision (`docs/SECURITY_V13.md`, `db/proposed/`, not applied) and the login (deferred; it needs a computer to make the codes).

## V14 Could not test
- A real iPhone Safari and Android Chrome (Chromium at 360, 390 and 820 px with touch emulation only).
- Entering with the register photo through to storage (no storage keys in the sandbox): the photo field is unchanged from V12.
- The live site: migrations 0049 to 0051 were applied through the connector and read back; the pages were run against the local copy of the live data, not on Vercel.
- The Vercel cron / deployment logs (connector not approved).

# V15 — custom date range and flock comparison in Analytics (12 Nov 2026)

Branch `claude/v15` from main after V14 was merged (PR #26). No migration (none needed), no RLS or login change, `READER_V2_ENABLED` not set, no Anthropic credit spent. The login stays deferred (V13 revert untouched).

| Item | Status | What / how checked |
|---|---|---|
| R1 range selector (Custom tab) | built | `lib/analytics/period.ts`: ONE engine `summarizeRange(range, {segment, flocks})` for any from..to; `summarizePeriod` (week / month / year) is now a one-line wrapper. `customRange` (swap when From is after To, future days left out, at most 366 days, each with a sentence), `rangeCoverage` ("data starts 2 Jul 2026 …" / "the last entered day is …"), `precedingRange` (same length just before), `partsWithin` (weeks up to 120 days, then months), `quickRanges`. `lib/analytics/rangeParams.ts` reads the address (`?view=custom&from=…&to=…`). Analytics gets a fifth tab "Custom": two date boxes, chips Last 7 days / Last 14 / Last 30 / This month / Last month / Since 1 Aug; default = the last 14 days with data; the Month-view blocks (headline cards, eggs bars + HD % line, deaths and feed charts, day table with tap-through to the Day screen, week-by-week table, per-flock table, sales by buyer and grade, costs with the missing list, alerts, what can go wrong next) are the same components; comparison with the range of the same length just before, with a "not like for like" line when either side has missing days. Before/after check: all 81 V7 summaries (every week, month and the year × whole farm, main, young) are identical after the change. |
| R2 flock filter | built | On the Custom tab: "Flocks: All flocks" opens a tick list (real names first, register label and main / young / "left after …" underneath; main, young, then departed flocks). With flocks ticked, `summarizeRange` uses only those flocks' own rows (eggs, birds, deaths, feed, per-flock table, their own alerts and watch items). Sales, revenue, costs, profit, ledger breakage and the farm feed / egg stock are farm-level: hidden, with the sentence "farm-level, not split by flock" and a "Show all flocks" link (never shown as zero). A note when the chosen flocks are in both groups. Address: `&f=BAB-3&f=BAB-5`; an unknown name is left out with a sentence. Browser: ticking BAB-3 and BAB-7 and pressing Show gives `…&f=BAB-3&f=BAB-7`. |
| R3 Compare screen | built | `/analytics/compare` (`lib/analytics/compare.ts`, `components/CompareView.tsx`): columns A and B (stacked on a phone, side by side from 640 px), each with its own flock (one flock or All flocks) and its own From / To; quick set-ups "Same flock, two periods" (A = the days just before, B = the chosen days), "Two flocks, same dates", "Two flocks, different dates" (A one month earlier); **each column is its own call of `summarizeRange`**. One row per measure with A, B and B − A (absolute and %), ▲/▼ plus the word better / worse / higher / lower (colour is never the only signal; days, ages, bird counts and feed per bird have no better or worse): dates, days in range and days with data; eggs total, trays, eggs/day, pooled HD %; the breeder's standard for the flock's age and breed over the same rows (weighted by birds) and the points below it, with moult days named; best day and its HD %; age at start and end (days and week); birds at start and end, deaths, deaths %, per 1,000 and per 1,000 per day; feed bags, g/bird/day, kg per 100 eggs ("feed not recorded" for the left page); breakage and labour take % and revenue per egg / profit only for All flocks, else "not split by flock". Totals over a different number of days get no better/worse and a sentence. "Align by flock age": both columns are the same weeks of age (week w = days 7w..7w+6 after placement), a flock without a real placement date falls back to its dates with a sentence. Same flock and dates in both columns = every difference 0 with a line saying so. |
| R4 comparison charts | built | `OverlayChart` (inline SVG, `components/PeriodCharts.tsx`): HD % by day and eggs per day, x = day 1..N of each range (or "wk 25 …" when aligned by age), A a solid blue line with round dots, B a dashed orange line with square dots (the pair passes the colour-blind separation check), legend with flock and dates, "A" / "B" written at the line ends, real date in each point's title and a "Day by day with the real dates" table under the charts (each date opens the Day screen). Eggs start at 0; HD % gets a 5-point frame. Ranges of different length: both are drawn over the shorter length and the sentence says so; the table uses every day. Readable at 360 px (checked by screenshot). |
| R5 entry points and URL state | built | "Compare flocks" button under the view switch on every Analytics view (Day, Week, Month, Year, Custom; from Custom it carries the dates and the first chosen flock), on every card of the Flocks screen and on each flock page (pre-fills A with that flock; B = another flock of the same group, same dates), plus "This flock over any dates" on the flock page and "Compare flocks" in the Analytics menu. All state is in the address: `?a=BAB-3&af=2026-09-01&at=2026-09-15&b=BAB-5&bf=2026-10-01&bt=2026-10-15&age=0` (`&age=1&wf=25&wt=30` to align by age); nothing in local storage. Align by age says which weeks of age each flock has rows for and which weeks both share, and defaults to the last 6 shared weeks. Browser-tested: flock card → `?a=BAB-3`; Analytics → default A BAB-1 / B BAB-2; each quick set-up; the form with Align by age; unknown flock name, From after To and future dates each give a sentence. |
| R6 export | built | "Download this view" on the Custom tab (Whole farm / Main / Young, or the chosen flocks) and on Compare, Excel and CSV: `/export/download?kind=range&from=…&to=…[&f=…][&segment=…]` and `?kind=compare&a=…&af=…` (the same address as the screen, read by the same `readRange` / `readCompare`, so the file has the screen's numbers). Range file = one row per day (real dates, HD % formula, pooled HD % and SUMs in the totals row; revenue / cost / profit columns only for all flocks). Compare file = one row per measure: A and B as numbers or real dates, "Difference (B − A)" and "Difference % of A" as formulas (blank for date rows), unit, better / worse / higher / lower in words, why a value is blank. Read back with exceljs: date cells are dates, formulas present. Week / month / year files unchanged: the 18 V7 period files (2 weeks, 3 months, the year × 3 groups) compared before / after the change are identical. |
| R7 tests | done | `scripts/range-check.mts` (82 checks on the real rows, in `run-all`, expected values from the raw rows): 1–15 Sep whole farm (eggs, deaths, feed, pooled HD %, revenue, breakage) and one flock (BAB-3: its own rows; sales / costs / breakage left out); two flocks = sum of each; all main flocks ticked = the Main group; a range = the sum of the same days queried one by one (eggs, deaths, feed, revenue, cost, breakage, alerts; farm and one flock); September / October main and young / every September week / the year through the wrappers = the custom range, number for number; V7 figures (13,54,350 eggs sold, ₹72,67,620.30) through a custom range; pooled HD % ≠ mean of daily HD % (64.69 vs 64.74). Edge cases: From after To, single day, a missing day (row removed: 14 of 15, average over 14, nothing filled in), a flock placed inside the range (BAB-10), range entirely before the data, range past the last entered day, future days, more than 366 days, depletion inside the range (Old BAB-1: 2 sales = 8,399 birds are movements; Old BAB-2: 5,330 to Anil farm), birds at start rebuilt for a flock that starts inside the range, BAB-3's moult (status moult; Compare names 15 moult days), Compare (each column = its own engine call, B − A, %, better/worse, neutral rows, not split by flock, identical selections all 0, different lengths), age (weeks 34–39 = days 238–279), align-by-age defaults and "no week in common", presets, the address and the chips. Live database (read-only SQL) equals the engine for the owner's test cases: farm 1–15 Oct 8,99,280 eggs / 1,340,012 bird-days / 444 deaths / 2,290 bags / ₹49,15,089.90 sales; BAB-3 1–15 Sep 20,820 eggs (12.08 %); BAB-5 1–15 Oct 1,45,140 eggs (85.88 %). |
| R8 docs | done | This section; `docs/DECISIONS.md` V15 ("custom range = same engine as week / month / year", "compare = two independent engine calls", "state in the URL", dates and limits, chosen flocks, align by age, charts); "What changed" entry (12 Nov). |

## V15 Checks run
- `npx tsc --noEmit`, `npx eslint app components lib scripts`, `npx next build`: clean.
- `npx tsx scripts/run-all.mts`: 32 of 32 scripts pass, including the new `range-check` (82 checks) and `period-check` (53, V7).
- Before / after the engine change, on the real rows: all 81 V7 summaries (every week from 29 Jun to 15 Nov, every month, the year × whole farm, main, young) identical; the 18 V7 Excel/CSV period files (2 weeks, 3 months, the year × 3 groups) identical.
- Live database, read-only SQL: the owner's test cases (Custom 1–15 Oct; Compare BAB-3 1–15 Sep against BAB-5 1–15 Oct) give the same eggs, bird-days, deaths, feed and sales as the engine.
- Browser (production build, local copy of the live data up to 28 Oct): 22 routes at 360, 390 and 820 px = 66 page loads and 358 links (Custom: default, 1–15 Oct, two flocks, 2 Jul–28 Oct, one day, June (before the data), From after To with one young flock, a departed flock past the last entered day; Compare: default, BAB-3 Sep vs BAB-5 Oct, align by age, identical, all flocks Sep vs 1–15 Oct, BAB-9 vs BAB-10 by age; Analytics day / week / month / year, Flocks, a flock page, Export, Today): all 200, 0 console errors, 0 broken links, 0 sideways scroll, 0 tap targets under 44 px, 0 unlabelled inputs, slowest 1.2 s. Ticking flocks and pressing Show, every quick set-up, the Compare form with Align by age, the Compare flocks buttons (Analytics, flock card, flock page) clicked through. Downloads fetched and read back (exceljs): dates are dates, formulas present.

## V15 Known bugs / findings
- BAB-3 was moulting in September (HD 12 %, recorded moult from 15 Aug), so the owner's example "BAB-3 in September against BAB-5 in October" shows a very large gap; the Compare screen names the 15 moult days under the breeder's standard.
- The Custom tab for all flocks is long on a phone (Main, Young, then Whole farm, like the Month view); the day table folds away when the range has more than 7 days.
- "Birds at end" is the count on the last day with data: for Old BAB-1 in 1–15 Sep it is the 8 Sep figure (the last 3,181 birds were sold on 9 Sep and show under "sold").
- With Align by age ticked, the date boxes keep the earlier dates (they are not used until the box is unticked).
- CSV files carry full decimals (as the V7 CSV files do); Excel formats them.
- Two small display fixes in the shared Month-view blocks: the young group's feed chart and day table said 0 bags where feed is not recorded; they now say "not recorded".
- Older items unchanged (see V14).

## V15 Needs owner
Nothing blocking. After it deploys: try **Custom 1–15 Oct** and **Compare BAB-3 Sept vs BAB-5 Oct**, and say anything that is confusing. The V14 list still stands (booster dates, other medicines, the "to confirm" items, register photos and costs, Vercel access, Anthropic credits, the database-door and login decisions).

## V15 Could not test
- The Vercel preview build and its runtime logs: the Vercel connector still answers 403 for team yashfarm (access not approved).
- The screens against the live database: they ran against the local copy (data to 28 Oct); live has data to 10 Nov. The owner's two test cases were checked against live with read-only SQL.
- A real iPhone Safari and Android Chrome (Chromium at 360, 390 and 820 px with touch emulation only); the native date picker of iOS.
- The downloaded files opened in Excel or Numbers on a phone (read back with exceljs only).

# V16 — feed numbers on Analytics, for the day and for 7 days, each labelled (21 Nov 2026)

Branch `claude/v16` from main after V15 was merged (PR #27). No migration, no RLS or login change, `READER_V2_ENABLED` not set, no Anthropic credit spent. The local copy of the live data was rebuilt for this version (new container): the repo's migrations, then every live table copied read-only (1,424 production rows, data to 19 Nov 2026).

Owner's report (21 Nov): the Main flocks card "as of 19 Nov" showed "Feed 157 bags/day, 107 g/bird/day" next to single-day tiles; 157.4 is the 7-day average (13–19 Nov = 1,102 bags ÷ 7), the register says 154 for 19 Nov, and the day's own g/bird was shown nowhere.

| Item | Status | What / how checked |
|---|---|---|
| F1 Main flocks feed tile | built | `lib/analytics/feed.ts` (pure): `feedPair` / `segmentFeed` / `flockFeed` build the board day's own feed and the last 7 days with rows (the same window as the other 7-day tiles) from the existing per-day totals (`dayTotals`: bags of the rows that record feed and the birds of those rows) and the existing bag weight `BAG_KG` (45 kg); g/bird = bags × 45 kg ÷ birds. The board card now has two tiles: **"Feed today (19 Nov)": 154 bags, "105 g/bird today"**, then **"Feed, last 7 days (13 Nov – 19 Nov)": 1,102 bags, "average 157 bags a day · 107 g/bird a day"** (and "feed recorded on N of these 7 days, averages over those only" when some days have no feed). "Feed stock left: N days" stays on the day tile, its calculation untouched. The Deaths tile is now "Deaths today" with "last 7 days: … a day on average". Browser (production build, live copy): 19 Nov 154 / 105 and 1,102 / 157 / 107; 18 Nov 163 / 111 and 1,095 / 156 / 107. |
| F2 every other feed number | built | **Young group card** (and Today, which shows the same cards): the same two tiles; on 19 Nov "Feed today (19 Nov): feed not recorded — the register has no feed figure for this group on 19 Nov" and "Feed, last 7 days: 385 bags, average 64 bags a day · 105 g/bird a day · feed recorded on 6 of these 7 days, averages over those only"; with no feed in the whole window one tile "feed not recorded" with the reason, never a bare "–". **Day screen**: each group has "Feed on 19 Nov" + "Feed, last 7 days" tiles from the same helper; each flock shows "16 bags · 113 g/bird that day" (or "feed not recorded") and "Feed, last 7 days: … bags a day on average · … g/bird a day"; the whole-farm line says "feed 154 bags that day (groups that record feed: main flocks)". **Analytics flock cards**: "Feed today: 4 bags · 107 g/bird" and "Feed, last 7 days: … bags a day on average · … g/bird a day (feed on N of 7 days)" instead of an unlabelled "bags/day"; "1,680 birds today", deaths "last 7 days: … a day on average". **Week / Month / Year / Custom**: the feed card is "Feed g/bird a day, average this week / month / in this range" with "total … bags · average … bags a day · … kg per 100 eggs" and "feed recorded on N of M days, totals and averages over those only" when partial; a day without a feed figure is "not recorded" in the day table and a gap on the feed chart (it was 0); table columns "Feed g/bird a day (average)", "Feed that day (bags)", "Feed bags (month total)" with "(feed on N of M days)"; the period comparison row "Feed g / bird a day (average)". **Compare**: new row "Feed, average bags a day", "Feed g / bird a day (average)" with the partial-days sentence. **Alert and watch texts** name the 7-day average: "49 bags in stock; 157 bags a day used on average over the last 7 days, so 0.31 days of feed" (wording only). Browser (production build, live copy): 19 and 18 Nov on the board, Day screen, flock cards, week of 16 Nov, Custom BAB-9 25 Oct–19 Nov, Today: no page errors, no sideways scroll. |
| F3 days of stock left unchanged | done | No change to the calculation: `feedDaysLeft` (closing bags in the feed box ÷ average box consumption over the last 7 dates with a box row), `RULES.feedDaysMin` (0.5) and the alert rule are untouched; only the wording of the low-feed alert and the feed watch line now names the 7-day average. Checked by running main's engine and this branch's engine side by side on every day of the live copy (141 days, 2 Jul – 19 Nov): days-left identical on all 141 days, low-feed alerts 15 and 15 with the same keys, feed watch items the same. 19 Nov: 49 bags ÷ 157.4 = 0.31 days (the alert on the Main flocks card). |
| F4 tests | done | New `scripts/feed-check.mts` (26 checks on the live copy, in `run-all`; expected values from the raw rows plus the owner's own figures): board 19 Nov Main feed today = 154 bags (the register, not the 7-day 157), 105.2 g/bird (154 × 45 kg ÷ 65,886 birds); last 7 days 13–19 Nov = 1,102 bags, 157.4 a day, 107.4 g/bird a day; board 18 Nov = 163 bags (111.3 g/bird); the rendered tiles read "Feed today (19 Nov) · 154 bags · 105 g/bird today" and "Feed, last 7 days (13 Nov – 19 Nov) · 1,102 bags · average 157 bags a day · 107 g/bird a day", no "bags/day", days of stock left keeps its own label; BAB-9, BAB-10 and BAB-11 show their own bags and g/bird on every day 29 Oct – 18 Nov (21 days × 3 flocks) and "feed not recorded" on 19 Nov (flock cards and the Young card, which still gives the 7-day figure over the 6 days with feed); the week view says "not recorded" for 19 Nov, not 0; a window with no feed at all is one "feed not recorded" tile with the reason; the bag weight is the existing 45 kg constant; on every board day since 1 Aug the Main "feed today" equals that day's register bags. Three older checks assumed data ending in October and were made date-independent (not caused by V16): `period-check` (the "empty week" is now a week after the last day of data; the run rate uses the last full month, now October), `health-check` (BAB-2's episode is checked on 28 Oct, not on the last day of data), `medicines-v14-check` (the seed is read from the migration files; the database is checked for its rules only, because on live the owner confirmed seven medicines on 11 Nov, the chick schedule's later steps moved to days 62, 70, 80, 95 and the day-5 IBD step was switched off). |

## V16 Checks run
- `npx tsc --noEmit`, `npx eslint app components lib scripts`, `npx next build`: clean (see the note on the Next.js security notice below).
- `npx tsx scripts/run-all.mts`: 33 of 33 scripts pass, including the new `feed-check` (26) and `range-check` (82).
- F3: main's engine and this branch's engine side by side on all 141 days: days of feed stock left identical, low-feed alerts 15 = 15.
- Browser (production build on the live copy to 19 Nov): 16 routes (board 19 Nov, 18 Nov, 28 Oct; Today; Day 19 Nov, 18 Nov, 15 Oct; week of 16 Nov; November, October; the year; Custom default and BAB-9 25 Oct–19 Nov; Compare BAB-9 / BAB-10; a flock page; Flocks) at 360, 390 and 820 px = 48 page loads and 168 links: all 200, 0 console errors, 0 broken links, 0 sideways scroll (after the wrap fix), 0 tap targets under 44 px, 0 unlabelled inputs, no "bags/day" anywhere, no feed tile showing a bare "–"; slowest 1.4 s.

## V16 Known bugs / findings
- The young flocks also have feed in the data on 22 and 23 Oct (BAB-9 20 and 21 bags, BAB-10 22 and 23, BAB-11 20 and 21), besides 29 Oct – 18 Nov; the screens show those days too.
- The "days of feed stock left" figure comes from the feed box (closing bags ÷ average box consumption over the last 7 box days) and is unchanged; on 19 Nov it is 49 ÷ 157.4 = 0.31 days and raises the low-feed alert.
- The live chick vaccination schedule differs from the V14 seed (later steps on days 62, 70, 80, 95 instead of 66, 75, 83, 102; the day-5 IBD step switched off). Nothing in the app edits the schedule, so it was changed directly in the database after V14: please confirm the new days are what you want.
- The repo migration for `chick_daily_mortality` allows row positions 1–3, the live database 1–4 (row 4 "Chicks"); a fresh install from the migrations alone would refuse row 4. Not changed (no migrations in V16).
- `next build` stops once with a Next.js security notice and passes on the second run; `npm audit` lists moderate advisories for Next 16.0.0–16.4.4 (fixed in 16.4.6; they concern `use cache`, Cache Components, the Edge runtime and image optimisation).

## V16 Needs owner
1. Look at the Analytics board for 19 Nov and say whether the two feed tiles read right (today 154 bags, 105 g/bird; last 7 days 1,102 / 157 a day / 107 g/bird a day).
2. Confirm the chick schedule days now on live (62, 70, 80, 95 and no day-5 IBD), or say which are wrong.
3. Decide on the Next.js upgrade to 16.4.6 (a separate small change; it needs a Vercel preview check).
4. Still open from before: the database-door / RLS decision (all 52 tables are readable and writable with the public key), Vercel access, Anthropic credits, booster dates and the other V14 items.

## V16 Could not test
- The Vercel preview build and runtime logs (Vercel connector not approved for team yashfarm).
- A real iPhone Safari or Android Chrome (Chromium at 360, 390 and 820 px with touch emulation).
- The screens on the live database itself (they ran on a fresh copy of it taken on 21 Nov; the numbers were also read on live with SQL).
# V17 — eggs per kg of feed in Analytics (25 Nov 2026)

Branch `claude/v17` from main. V16 (PR #28) was not merged when V17 was built, so V17 was built on main in V16's labelling style; on 25 Nov the owner merged V16 and main was merged into this branch: the 12 overlapping files were resolved by keeping both (V16's feed tiles and labels, V17's eggs-per-kg tile, columns, rows and alert); the period summary keeps one count of days with feed (V16's `feed.daysRecorded`). After the merge: 34 of 34 scripts pass (V16's `feed-check` 26 and V17's `eggs-per-kg-check` 42 together), build clean, 51 page loads at 360 / 390 / 820 px with no errors, no sideways scroll and no "bags/day" left. No migration, no RLS or login change, `READER_V2_ENABLED` not set, no Anthropic credit spent. Local copy refreshed read-only from live (data to 19 Nov 2026).

**Definition (owner, 25 Nov):** eggs per kg of feed = eggs laid ÷ (feed bags × 45 kg), for the same flocks and the same days; pooled over a period (total eggs ÷ total feed kg, never the average of daily ratios); only flock-days with a feed figure count (the eggs of a day without feed are left out of both sides, "N of M days with feed"); no feed at all = "feed not recorded", never 0; shown with 2 decimals, with "kg of feed per 100 eggs" (the V15 metric) as the reverse from the same totals.

| Item | Status | What / how checked |
|---|---|---|
| E1 engine | built | `lib/analytics/feedEfficiency.ts` (pure): `feedEfficiency(rows)` (eggs per kg, kg per 100 eggs from the same totals, eggs, kg, days, days with feed, a reason when empty), `effOn` (a group or chosen flocks over dates), `boardEff` (the day, the last 7 days with rows, the 7 days before, the change), `flockEff`, `effTrend` (30 days + 7-day line). The period engine returns it for every period (day, week, month, year, custom, chosen flocks): `feed.eggsPerKg`, `feed.eggsPerKgWhy`, `feed.daysWithFeed`, and per flock `eggsPerKgFeed`; `kgPer100Eggs` now comes from the same totals. Main's engine and this branch compared on 93 summaries (every week, month, the year × 3 groups, three flocks 1 Aug–19 Nov): every existing number identical. `scripts/eggs-per-kg-check.mts` (34 checks on the real rows, in `run-all`): 18 Nov main 50,400 eggs ÷ 7,335 kg = 6.87; 19 Nov 50,910 ÷ 6,930 = 7.35; 13–19 Nov 3,47,820 ÷ 49,590 = 7.01 (board, custom range and by hand agree; pooled ≠ mean of days 7.02); week, month and year views; one flock (BAB-5 8.15); BAB-9 13–19 Nov 6 of 7 days with feed (19 Nov left out of both sides); BAB-9 5–15 Oct = null "feed not recorded on these days"; zero bags = null, not infinity. |
| E2 board tile | built | Each group card on the board (and Today, which shows the same cards) gets the tile **"Eggs per kg feed today (19 Nov)"**: the day's value as the big number (2 decimals) with "today: 13.6 kg feed per 100 eggs", then **"7-day (13 Nov – 19 Nov): 7.01 eggs per kg · 14.3 kg per 100 eggs"** ("N of 7 days with feed" when some days have none), then ▲/▼, the change and "— better" / "— worse" against the 7 days before (6–12 Nov), coloured green / red but always written (more eggs per kg = better). The day without feed reads "feed not recorded"; a group with no feed in the window gets one tile saying so with the reason, never 0 or a bare "–". The tile spans the card's width so it reads on a phone. Browser (production build, live copy): 19 Nov Main 7.35 / 7.01, ▼ 0.59 (−7.8 %) worse; Young "feed not recorded" / 6.95 on 6 of 7 days; 18 Nov Main 6.87 / 6.98; 15 Oct Young "feed not recorded" with the reason; no page errors, no sideways scroll at 360 px. |
| E3 flock cards, tables, Compare | built | **Flock cards** on the board: "Eggs per kg feed: today 6.54 · last 7 days 6.29" ("feed not recorded" with "(N of 7 days with feed)" when partial). **Per-flock tables**: Week / Month / Custom per-flock table and the Year "Flocks this year" table get "Eggs per kg feed" (pooled over the flock's days with feed, "(N of M days with feed)", or "feed not recorded"); the board's Month table gets "Eggs per kg feed (month)" per flock and for each group total; the **Day screen** gets an "Eggs per kg feed (that day)" tile per group and the value on every flock row. **Week / Month / Year / Custom headline**: a card "Eggs per kg feed, this week / month / range" with kg per 100 eggs, "N of M days with feed" and ▲/▼ better / worse against the previous period; the period comparison table gets "Eggs per kg of feed (pooled)" (more = better). **Compare**: row "Eggs per kg of feed" (2 decimals, B − A, ▲/▼ better / worse, the reason when a side has no feed, "N of M days with feed"). Browser: board 19 Nov, week of 16 Nov (Main 7.20 ▲ +0.9 %), Custom BAB-9 13–19 Nov (6.17, 6 of 7 days), Year, Compare BAB-3 Sep vs BAB-5 Oct (1.26 vs 8.31: BAB-3 was moulting) and BAB-9 vs BAB-10 5–15 Oct ("feed not recorded on these days"), Day 19 Nov: no page errors, no sideways scroll at 390 px. In passing: the Year table printed "-0" birds sold for flocks that sold none (now 0). |
| E4 trend line | built | Main flocks card (board and Today): "Eggs per kg feed, last 30 days (21 Oct – 19 Nov)", inline SVG (`EffTrendChart`): each day a solid blue line with dots, the 7-day value (all eggs ÷ all feed kg of the last 7 days with rows) a dashed orange line, a gap where the register has no feed, legend in words, every point's date and value in its title and in the chart's text description; "Higher is better" under it. Checked by screenshot at 360 px (labels not clipped or overlapping after two fixes); on the live copy it shows the slide from about 8.5 eggs per kg in late October to about 7 in mid-November. |
| E5 alert | built | New alert kind `feed_efficiency` inside the existing rules (`alertsForRaw`), shown like every other alert (Analytics alerts, the group card, Today under "wrong now" with what to do, the period alert counts; "Was this useful?" works as for the others). Per group: the last 7 days' pooled eggs per kg against the 7 days before; it fires when it is more than 8% lower (`RULES.effDropPct`) and both windows have feed on at least 5 of 7 days (`RULES.effMinFeedDays`); flocks moulting on a day are left out of both windows and named (the never-flag rule for moulting flocks); never before 1 Sep. Words: "Main flocks: feed is giving fewer eggs: 6.98 eggs per kg of feed now (last 7 days, 12 Nov – 18 Nov) vs 7.66 before (5 Nov – 11 Nov), 8.9% lower (alert above 8%). Likely checks: feed waste (spilt feed, feeder level, rats or birds), a change in feed quality or the mill's mix, disease (deaths, droppings, birds off feed), heat." On the live copy it fires 5 times (7 Sep with BAB-3 left out; 9, 14, 15 and 18 Nov), never for the young group; 19 Nov is −7.8% (no alert). Checks added to `eggs-per-kg-check` (42 in total): 18 Nov fires with the board's numbers, 19 Nov does not, young never, a made-up 20% egg cut fires, fewer than 5 days with feed does not. The three older checks that assumed data ending in October were brought over unchanged from V16 (`period-check`, `health-check`, `medicines-v14-check`), so `run-all` passes on today's data (33 of 33). |
| E6 export | built | Excel / CSV: the **daily production** file gets "Eggs per kg feed (bags × 45 kg)" per flock-day as a formula (=eggs ÷ (bags × 45), empty when no feed figure) and a pooled totals row (eggs of the rows with feed ÷ all feed); the **week / month / custom range** files (day rows) and the **year** file (month rows) get "Eggs of flocks with feed" and "Eggs per kg feed" as the last two columns (formula per row, pooled in the totals row, so a whole-farm day uses only the eggs of the flocks whose feed is written: 19 Nov = 50,910 ÷ (154 × 45) = 7.35, not 72,690 ÷ …); the **Compare** file gets the row "Eggs per kg of feed" with its B − A difference formula. The 45 kg comes from `BAG_KG`. Before / after on 15 export files (week, two months and the year × 3 groups, two custom ranges, November production): every existing column, row, formula and note unchanged. |
| E7 tests | done | `npx tsc --noEmit`, `npx eslint app components lib scripts`, `npx next build`: clean (the build stops once with the Next.js security notice and passes on the second run, as in V16). `npx tsx scripts/run-all.mts` (fresh dump of the local copy): 33 of 33 pass, including `eggs-per-kg-check` (42), `period-check` (53), `range-check` (82). **R-style check on the live database (read-only SQL)**: 13–19 Nov main flocks = 3,47,820 eggs ÷ (1,102 bags × 45 = 49,590 kg) = 7.0139 eggs per kg, 56 flock-rows on 7 days; the engine, the board tile, the custom range and the by-hand check in the script all give 7.0139. Browser sweep (production build, live copy): 17 routes (board 19 Nov, 18 Nov, 15 Oct; Today; Day 19 Nov and 15 Oct; week of 16 Nov; November; the year; Custom default, BAB-9 13–19 Nov and BAB-9 5–15 Oct (no feed); Compare BAB-3 Sep / BAB-5 Oct and BAB-9 / BAB-10; a flock page; Flocks; Export) at 360, 390 and 820 px = 51 page loads and 185 links: all 200, 0 console errors, 0 broken links, 0 sideways scroll, 0 tap targets under 44 px, 0 unlabelled inputs, no eggs-per-kg tile with a bare "–"; slowest 1.5 s. Downloads read back with exceljs: range (formula per row, pooled totals formula), November production (formula per flock-day, SUMIFS totals), Compare (row 26 "Eggs per kg of feed", BAB-9 6.17 vs BAB-10 7.27, difference formula =D26−C26). Vercel preview logs: not readable (403, team access not approved). |
| E9 hen-housed (owner, 25 Nov) | built | The owner asked to add the hen-housed calculation and chose the breeder's definition ("since housing only"). `lib/analytics/henHoused.ts` (pure): **hens housed** per flock = the owner's number when he gives it (`OWNER_HENS_HOUSED`, no database change), else the birds at the start of the flock's first day in the register when that day is inside the data (BAB-9 8,957, BAB-10 9,923, BAB-11 9,001 on 4 Oct), else a **stand-in**: the birds at the start of 2 Jul 2026 for flocks already laying when the data starts (BAB-1 to 8 and the two departed flocks), always labelled and never compared with the book. Birds **moved** in or out after housing (transfers, Anil farm, unexplained, count corrections) change the number from that day; **deaths, culls and sales do not** (that is the loss hen-housed shows). **Eggs per hen housed** = the sum of each day's eggs ÷ that day's hens housed (= all eggs ÷ hens housed when nothing moved); **hen-housed %** = eggs ÷ hens housed per day × 100, shown next to hen-day %. The **book** (BV300 "current HH", eggs per hen housed per week of age ÷ 7, summed over the same days) is shown only where the number housed is real, without a colour. Shown on: a board tile per group "Hen-housed %, last 7 days" with the hen-day % of the same days and the stand-in note (Main 70.4 % vs HD 75.3 %, stand-in; Young 72.9 % vs 73.7 %); every flock card ("30.3 eggs per hen housed since 4 Oct (book 41.9) · last 7 days 71.7 % of hens housed (book 96.3)"); a "Hen-housed (breeder's definition)" card on each flock page; a "Hen-housed %" column (with "*" for stand-ins and the book beside real ones) in the Week / Month / Custom and Year per-flock tables; four Compare rows (hens housed, hen-housed %, eggs per hen housed in the range, the book; "per flock only" for All flocks); the daily production export ("Hens housed (that day)", "Hen-housed %" as a formula, "Hens housed from"). `scripts/henhoused-check.mts` (19 checks, in `run-all`): BAB-9's number from the raw first row, its eggs per hen housed and hen-housed % by hand, the book by hand from the BV300 rows, BAB-2's stand-in with the 2,589 birds moved in during August, Old BAB-1's sales not changing the number, no flock above its hen-day % without birds moved in, the period engine and the group tile by hand, Compare, an owner-given number. Live database (read-only SQL): BAB-9 8,957 housed on 4 Oct, 47 days, 2,71,080 eggs = 30.26 eggs per hen housed (the app: 30.3). All 93 existing summaries unchanged apart from the new fields. 35 of 35 scripts pass; sweep 15 routes × 3 widths = 45 loads, 165 links, no problems. |
| E8 docs | done | This section; `docs/DECISIONS.md` V17 ("eggs per kg = pooled eggs ÷ pooled feed kg, only days with feed", the alert rule, display); "What changed" entry. |

## V17 Known bugs / findings
- V16 was merged on 25 Nov and is now in this branch too (see above).
- Eggs per kg has been falling: about 8.5 eggs per kg of feed in late October, 7.35 on 19 Nov (7.01 over 13–19 Nov). The new alert fired on 9, 14, 15 and 18 Nov (and on 7 Sep, with BAB-3's moult left out). Feed per bird rose to about 107 g while the laying rate fell; worth a look (feed waste, the mill's mix, the cold).
- A day written with 0 bags (a moult) counts as "feed recorded": its eggs count with 0 kg of feed. On the group totals this is rare; a single flock-day with 0 bags shows "the feed written is 0 bags … nothing to divide by".
- Excel totals rows carry formulas without a stored result (as the older files do); Excel and Numbers work them out on opening.
- Hen-housed for the young flocks is well below the book (BAB-9 30.3 eggs per hen housed since 4 Oct vs 41.9; last 7 days 71.7 % vs 96.3 %): they are still ramping up (first 60 days of lay), which the book does not allow for; the book is shown without a colour.
- `next build` security notice for Next 16.4.3 (moderate advisories, fixed in 16.4.6) is still open (V16 Needs owner 3).

## V17 Needs owner
0. **Hens housed for BAB-1 to BAB-8**: the number of hens put into each laying house and the date (from the purchase or shifting records). Until then those flocks use the birds on 2 Jul 2026 as a labelled stand-in and get no book comparison. Send them as a message; nothing to type in the app.
1. After it deploys: open the board as of 19 Nov and check the Main flocks tile against your own calculation (50,910 eggs ÷ (154 bags × 45 kg) = 7.35 eggs per kg; last 7 days 3,47,820 ÷ 49,590 kg = 7.01).
2. Say whether 8% is the right size for the "feed is giving fewer eggs" alert (it fired 4 times in the last 2 weeks).
3. Still open: the Next.js upgrade, the chick schedule days (V16), the database-door / RLS decision (owner, 25 Nov: RLS stays off for now), Vercel access.

## V17 Could not test
- The Vercel preview build and its runtime logs (403: the Vercel connector is not approved for team yashfarm).
- A real iPhone Safari or Android Chrome (Chromium at 360, 390 and 820 px with touch emulation).
- The screens on the live database itself (a fresh copy of it, data to 19 Nov; the key number was checked on live with SQL).
- The downloaded files opened in Excel or Numbers on a phone (read back with exceljs only).

# V18 — share Analytics as Excel / CSV (A) and FCR (B) (28 Nov 2026)

Branch `claude/v18` from main after V16 and V17 were merged (PRs #28, #29). One additive migration (B3, egg weights), no RLS or login change, `READER_V2_ENABLED` not set, no Anthropic credit spent. Local copy refreshed read-only from live (data to 19 Nov 2026).

**FCR (owner, decided):** kg of feed eaten ÷ kg of eggs laid, same flocks and days; feed kg = bags × 45 kg (`BAG_KG`), only flock-days with a feed figure; egg kg = eggs × egg weight, the BV300 standard for the flock's week of age until the farm weighs eggs ("FCR (estimated from standard egg weight)"); pooled, never an average of daily ratios; 2 decimals, with "feed g per egg" (exact, = 1000 ÷ eggs per kg of V17); compared with the book for the same flock-days.

**Facts found before building (they change details of the brief):**
- **BAB-6 is BV300 in the data** (all 13 flocks are BV300), not Bovans White. The "no egg-weight reference loaded for <breed>" rule is built and tested with a made-up Bovans White copy of BAB-6; on the real data BAB-6 gets a number.
- **`feed_per_egg_g` in `bv300_standard_laying` is cumulative from week 19** (it equals the cycle goals: 121 g at week 80, 125 g at week 100). The week's own figure is `current_feed_per_egg_g` (= book feed a day ÷ book laying rate; week 77: 114 ÷ 0.861 = 132). The standard FCR for a period uses the weekly figure; the cycle goals are shown as a reference.
- **The book's egg weights stop at week 100.** BAB-4 (week 118) and Old BAB-1 (weeks 114–115) have no standard egg weight: their flock-days are left out of the FCR on both sides with the reason "past the end of the breeder's egg-weight table"; their feed per egg (no egg weight needed) is still shown.

| Item | Status | What / how checked |
|---|---|---|
| B1 FCR engine | built | `lib/analytics/fcr.ts` (pure): `eggWeightFor` (an actual weighing of that flock on the day or the 6 days before, else the BV300 standard for its week; else the reason), `fcrOf` (pooled FCR, feed g per egg, eggs per kg, standard FCR for the same flock-days weighted by their eggs, gap, which egg weight was used, flock-days left out and why), `fcrOn`, `boardFcr` (day, last 7 days with rows, 7 days before, change; lower = better), `flockFcr`, `fcrTrend`, `fcrLabel`. The period engine returns `feed.fcrEstimated`, `feed.feedPerEggG`, `feed.standardFcr`, `feed.fcrGap`, `feed.fcrLabel`, `feed.fcrWhy`, `feed.fcrLeftOut` for every period (day, week, month, year, custom, chosen flocks) and the same per flock. `scripts/fcr-check.mts` (33 checks, in `run-all`): 13–19 Nov main FCR 2.401 by hand (standard 2.133, gap +0.268; feed per egg 142.6 g; BAB-4's 7 flock-days left out with the reason); the same through the custom range, the week / month / year views; pooled ≠ mean of daily FCRs (2.401 vs 2.403); feed per egg × eggs per kg = 1000; one flock (BAB-5 2.087, standard 2.109); BAB-9 13–19 Nov on its 6 days with feed; BAB-9 5–15 Oct = empty with "feed not recorded on these days"; a Bovans White flock = empty with "no egg-weight reference loaded for Bovans White" (feed per egg still exact); an actual egg weight used for 7 days then the standard again, labelled "actual egg weight" or mixed; zero eggs = empty, not infinity. All 93 existing summaries unchanged apart from the new fields. |
| B3 egg weight table | built | Migration `0052_egg_weight_samples.sql` (additive: one new table; no RLS change, the same as every other table): flock, date, `avg_egg_weight_g` (checked 20–100 g), optional `eggs_weighed` and note, one row per flock and day. Applied locally and to the live project (read back: 0 rows, columns as in the file). No entry screen (as asked). The loader reads it (`EngineInput.eggWeights`; an empty list if the table is missing, so Analytics never stops); the engine uses an actual weight for that flock on the day it was weighed and the 6 days after, the BV300 standard otherwise, and every FCR label says which ("FCR (actual egg weight)", "FCR (estimated from standard egg weight)" or "actual egg weight on N flock-days, standard on M"). `scripts/eggweight-db-check.mts` (5 checks, in `run-all`): no weighing = standard; a stored weighing is loaded and preferred; the label changes; 0 g is refused by the table; nothing left behind. |
| B2 FCR screens | built | Every FCR number says "FCR (estimated from standard egg weight)" (or "actual egg weight"), 2 decimals, lower = better. **Board** (and Today): a tile on each group card, "FCR (estimated from standard egg weight) today (19 Nov)": Main **2.30** (feed 136.1 g per egg, exact), 7-day (13–19 Nov) **2.40**, book for these ages 2.13 (+0.27, worse than the book), feed 142.6 g per egg, BAB-4's 7 flock-days left out with the reason, ▲/▼ and better / worse against the 7 days before; Young: "feed not recorded" today, 7-day 2.65 on 6 of 7 days (book 2.03). A **30-day FCR line** on the Main card (each day solid, the 7-day value dashed, gaps without feed or egg weight; the eggs-per-kg chart component reused with a finer scale). **Flock cards**: "FCR (est. from standard egg weight): today 2.75 · last 7 days 2.85 (book 2.00) · feed 164.1 g per egg", or the reason (BAB-4: past the end of the book's egg-weight table, with its feed per egg). **Per-flock tables** (Week / Month / Custom: "FCR (est.)" with the book in brackets and "Feed g per egg"; Year: "FCR (est.)"; the board's Month table "FCR, est. (month)"; the Day screen: each flock's FCR and the book). **Period headline** card "FCR (estimated from standard egg weight), this week / month / range" with the book, feed per egg and ▲/▼ against the previous period; the period comparison table gets the FCR row (lower = better). **Compare**: rows "FCR (estimated from standard egg weight)" (B − A, ▲/▼ better / worse), "Breeder's FCR for the same days", "Feed g per egg (exact)". Browser (production build, live copy): board 19 Nov, flock cards, week of 16 Nov, Compare BAB-5 / BAB-4, Day 19 Nov: no page errors, no sideways scroll at 390 px. |
| B4 FCR alert | todo | |
| A1 Share / Download button | todo | |
| A1b Choose what to share | todo | |
| A2 file contents | todo | |
| A3 file names | todo | |
| A4 missing values | todo | |
| A5 / B5 / B6 tests | todo | |
| B7 docs | todo | |
