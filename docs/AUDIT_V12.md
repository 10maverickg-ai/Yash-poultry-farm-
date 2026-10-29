# V12 audit (N1) — written before any fix

Method: production build of `claude/v12` (= main after V11), against a copy of the live Supabase data refreshed to 28 Oct 2026 (20 tables, 1,182 production rows incl. soft-deleted; counts equal to live). A Playwright script (`scratchpad/audit12.cjs`, described below) loaded **38 routes at 360, 390 and 820 px = 114 page loads** with touch emulation, then followed every internal link found (**232 distinct links**). It records: HTTP status, console errors, failed requests, page-level sideways scroll, elements wider than the screen, tap targets under 44 px, clipped text, inputs without a label, images without alt, headings, load time, and error words ("NaN", "undefined", "Application error", "could not load"). Numbers on Today / Analytics for 28 Oct were compared with direct SQL. Screens were also read by eye at 390 px (Egg stock, Medicines, Purchases, Sales, Production, Upload).

**Clean:** all 114 loads returned 200; 0 console or page errors; 0 sideways page scroll; 0 broken internal links of 232; 0 error words; every page has one `h1`; every page loads in under 1.1 s locally (slowest: Home 1.08 s, Today 1.0 s). Checked against SQL for 28 Oct: main group 53,130 eggs, 36 deaths, 66,599 birds, 79.78% — matches the Analytics board (53,130 / 36 / 66,599); young group 17,160 eggs, 7 deaths matches; revenue ₹10,83,197 for 181,440 big eggs at 5.97 matches.

## Findings

| # | Severity | Screen | What is wrong | How it is fixed (item) |
|---|---|---|---|---|
| A1 | Medium | Analytics week / month / year, Sales (monthly + lists), Purchases, Records, Egg stock, Rates, Medicines, How targets are learned | Tables are wider than the phone and scroll sideways (flock tables up to 1,360 px, Sales month table 1,512 px, targets tables 1,053–1,122 px at 360 px). The first column scrolls away, so numbers lose their row label. | N2b: tables under 600 px become stacked cards (label beside every value) or keep a pinned first column. |
| A2 | Medium | Import, Flock page, Rates, Upload one photo, Egg stock, Feed bags, How targets are learned, Knowledge | Tap targets under 44 px: the "Set" button and % box on How targets are learned (58 of each) and the Knowledge topic links (23 px high). *(Correction after a second run: the check boxes and radio buttons themselves are small, but each sits inside a label that already measures 44 px, so only the "Set" boxes and the Knowledge links were truly too small.)* | N2b: global CSS — labels with a check box become 44 px rows, buttons and boxes at least 44 px. |
| A3 | Medium | Renumber flocks, Feed formulation | Inputs with no accessible name: 11 label boxes on "Renumbering event" and the quantity box on "Feed formulation" (a screen reader says only "edit text"). | N2a: aria-labels with the flock name. |
| A4 | Low | every page | Every page has the same browser title "Yash Poultry Farm" (tabs and history are all alike). | N2a: a title per section. |
| A5 | Medium | Egg stock, Production, Purchases, Home, Feed stock | Developer or register words shown to the owner: Egg stock "Total line", "Grade 13 / 14 / 15 / 15+", "Label (as written)", category "other", "Amount (+/− as written)"; Production "Bal Bird", "Mortality"; Purchases cost-settings table shows internal keys such as `chick_cost_per_chick`; Home subtitles "Mort / Feed / Total / Bal Bird / %", "extraction fills the form", "Generated from sale ledger lines"; Feed stock "qtl". | N2a: plain words, units and examples. |
| A6 | Medium | Upload | Nothing tells the owner what to do when photo reading is switched off or the reader credit has run out ("credit balance is too low"). The only way in is the reader. | N4: "Enter a day by hand" screen (no reader), linked from Upload with a short plain notice. |
| A7 | Medium | Medicines | The Medicines page is a short form: one line at a time, no monthly list or totals per month / flock, no edit or delete, no import, no "none this month", no photo, schedule does not say "due soon". It cannot take four months of register photos. | N3: Medicines area rebuilt. |
| A8 | High | Today / Analytics | BAB-2 (12 and 14 deaths on 27 and 28 Oct, HD 67%) appears only as "slipping" and "deaths creeping" under "may go wrong"; nothing appears under "What is wrong now" and nothing says "call the vet". | N5: health alert (deaths above usual two days running and eggs down more than 5% in a week). |
| A9 | Medium | Sales | The sale already has a `buyer_or_recipient` text but the Sales page does not let the owner pick or edit who got the eggs; sales to Yash P.F. farms (12 / 13 / 14 farm) look the same as Farmfresh sales. No way to re-price a day after a rate change (the 28 Oct rate may still change when a subsidy arrives). | N6. |
| A10 | Low | Costs | Medicines and vaccines cost entry is a single box in a monthly check list; August and September diesel and all medicines show "not entered" (correct, not a bug). | N3 adds proper entry and "none this month". |
| A11 | Medium | Settings | There is no Settings screen at all; the daily weather job cannot be re-run by hand and its last result is invisible. | N8: `/settings` with "Refresh weather now", last fetch time and errors in plain words. |
| A12 | Medium | Tests | `costs-check.mts` and `period-check.mts` hard-code the data as of 26 Oct and fail on any newer fixture (1 and 5 false failures on the 28 Oct fixture). There is no single command to run all the checks. | N2c: expected values derived from the fixture, plus `scripts/run-all.mts`. |
| A13 | Low | What changed | Entries for V9–V11 exist but are uneven; V12 missing. | N2d. |
| A14 | Info | Data | Integrity sweep findings (ledger chain breaks of 30 eggs on 29→30 Jul and 24→25 Sep; 20 Sep big-ledger produced 30 below the flock rows; feed box chain breaks on 3 Jul, 20→21 Jul (103 bags, known), 5→6 Aug, 8→9 Aug; 11 Aug feed box arithmetic off by 11; 5 flagged rows still open) — see `docs/INTEGRITY_V12.md`. | N7 (reported; owner questions, not code bugs). |
| A15 | Info | Navigation | The tab strip under the green header scrolls sideways on a phone (by design; the active tab is highlighted). Prefetch requests are cancelled on navigation (normal, not errors). | none |
| A16 | Low | Analytics | "Show the board as of" lists all 119 days in one drop-down (long to scroll on a phone). | left as is; a date box would be better — see Known bugs. |
| A17 | Medium | Performance | All pages are fast on this machine (≤ 1.1 s); the 3-second goal on a phone connection was not yet measured with throttling. | N8 measures with throttled "slow 4G". |

Not checked in this sweep: the daily photo upload and the reader (no Anthropic credit), a real iPhone Safari and Android Chrome (Chromium at 360, 390 and 820 px with touch emulation was used), and the live Vercel deployment (connector not authorised in this session).


## Status after V12 (written at the end of the version)

| # | Status | Where |
|---|---|---|
| A1 | **Fixed.** Tables under 600 px become stacked cards with a label beside every value; checked on Analytics week / month / year, Sales, Purchases, Records, Egg stock, Rates, Medicines, How targets are learned at 360, 390 and 820 px (0 sideways page scroll in 138 page loads). | N2b |
| A2 | **Fixed.** "Set" box, Knowledge links, and (found in the final sweep) every link inside a table cell (Medicines "Edit", Sales "change", topic names) are now 44 px. | N2b, N10 |
| A3 | **Fixed.** Every input has a name a screen reader can say (flock name in the renumber boxes, the formulation quantity box). Final sweep: 0 unlabelled inputs on 138 loads. | N2a |
| A4 | **Fixed.** Every page has its own browser tab title ("Egg rates — Yash Poultry Farm"). | N2a |
| A5 | **Fixed.** Plain words on Egg stock, Feed bags, Production, Purchases settings, Home, Feed stock. | N2a |
| A6 | **Fixed.** "Enter a day by hand" (`/day/enter`), linked from Upload with a plain notice. Tested on the local copy at 360, 390 and 820 px (save, flags, replace with a tick, one-tap answers, sales created with the day's rate). The photo reader itself still cannot be tried (no Anthropic credit). | N4 |
| A7 | **Fixed.** Medicines area rebuilt (month list, totals, none this month, edit/delete, vaccination schedule, import with dry run, cost flow). Empty of data until the register photos arrive. | N3 |
| A8 | **Fixed.** BAB-2 on 28 Oct is the only flock the health rule raises; it appears under "What is wrong now" with "call the vet". No alert storms on the other 10 flocks. | N5 |
| A9 | **Fixed.** Recipient on every sale (migration 0044), editable without changing the price; "Re-price the sales of this day" with before and after totals, never silent. | N6 |
| A10 | **Fixed** (entry); "not entered" still correct until the owner enters August and September diesel and the other costs. | N3 |
| A11 | **Fixed.** `/settings` with "Refresh weather now", last weather time, last attempt and plain-word errors (migration 0047, `weather_fetch_log`). | N8 |
| A12 | **Fixed.** `costs-check` and `period-check` derive their expected values from the data; `scripts/run-all.mts` runs all 30 scripts and prints a pass/fail table (30 of 30 pass). | N2c |
| A13 | **Fixed.** V12 entry added to What changed. | N2d |
| A14 | **Reported.** See `docs/INTEGRITY_V12.md` (owner questions, no code bug). | N7 |
| A15 | Left as designed. | – |
| A16 | Left. The "as of" list is long; a date box would be better. | Known bugs |
| A17 | **Measured.** Cold first visit on "slow 4G" (1.6 Mbps, 150 ms) with 0, 40 and 100 ms of database delay per query: every page 1.2 to 1.4 s (Today 1.26 s, Analytics 1.37 s at 100 ms, Day 1.17 s), against the 3 s goal. No index was needed: the largest table has 1,160 rows. | N8 |

### Found after the audit (while building V12)

| # | Severity | What | Resolution |
|---|---|---|---|
| B1 | **High** | Saving an egg ledger day again (reader re-read, correction, or "Replace the saved day") failed with a database type error whenever a sale line already had its sale row (`lib/salesSync.ts`). | Fixed: the quantity is cast to integer. Found by the manual-entry replace test. |
| B2 | Low | A blank Feed on a left-page flock (BAB-9/10/11) would be flagged "missing field: feed_bags" on a hand-typed day. | Fixed: `noFeedColumn` option on the shared writer. |
| B3 | Medium | First version of the hand-entry form rebuilt its sub-parts on every key stroke, which on a phone keyboard drops the cursor after each digit. ESLint (`react-hooks/static-components`) caught it. | Fixed; tested by typing digit by digit. |
| B4 | Info | The server-action redirect problem seen on the new Medicines forms (data saved, banner missing) was **not** found on the older forms: Purchases, How targets are learned (message with brackets) and Production entry (`useActionState` + redirect) all return to the page in under 0.4 s and show their banner, also on Next 16.4.3. | Medicines uses same-screen answers; other forms left as they are. |
| B5 | **Critical** | Next.js 16.2.10 had a critical advisory (middleware bypass; this app has no middleware) and a server-action denial-of-service advisory. | Upgraded to 16.4.3 in its own commit. See `docs/SECURITY_V12.md`. |
| B6 | **High** | Row-level security is off on all 45 tables and the `anon` database role may read and write all of them; the app has no login. | **Owner decision** (not changed). See `docs/SECURITY_V12.md` S1, S2. |
| B7 | Low | `/api/weather` answered anyone and always forced a fetch when `CRON_SECRET` was not set. | Fixed (refreshes only when the weather is more than 12 hours old without the secret). |
| B8 | Low | Uploads accepted any file type; stored path used the file name's extension unchecked. | Fixed (pictures only, 15 MB, safe extension). |
