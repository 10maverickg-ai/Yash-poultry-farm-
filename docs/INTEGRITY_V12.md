# V12 data integrity sweep (N7)

**What this is.** A read-only check of the farm data, run with `web/scripts/integrity-v12.sql` (19 checks, SELECT only; it changes nothing and can be re-run at any time: `psql … -f web/scripts/integrity-v12.sql`). It was run on a copy of the live Supabase data and the row counts were re-read on the live database (read-only) afterwards: they are equal.

| Table | Rows | Dates |
|---|---|---|
| Daily production (flock rows, not deleted) | 1,160 | 2 Jul – 28 Oct 2026 (119 days, none missing) |
| Egg ledger sections / lines | 238 / 337 | 2 Jul – 28 Oct |
| Feed boxes | 169 | 2 Jul – 28 Oct |
| Sales | 106 | 2 Jul – 28 Oct (Farmfresh 79, Local 25, Yash P.F. farms 2) |
| Egg rates | 120 | 1 Jul – 28 Oct |
| Chick rows | 259 | 2 Jul – 28 Oct |
| Bird movements | 36 | 7 Aug – 9 Sep |
| Weather days | 122 | 2 Jul – 31 Oct (forecast days included) |
| Medicine lines | 0 | nothing entered yet (waiting for the register photos) |

## Result in one line

Nothing is broken in the data. Every structural rule passes. What remains is **11 places where the register itself does not add up**, all of them questions only the owner can answer (they were never "fixed" by the app, because the app never guesses). **No finding turned out to be a code bug.** The code bugs found during V12 are listed at the end.

## Checks that passed (0 problems)

| # | Check | Result |
|---|---|---|
| 1 | Rows pointing to a flock that does not exist (production, movements, feed and ledger links) | 0 |
| 2 | Soft-deleted rows still referenced by something live | 0 |
| 3 | Two live rows for the same flock and day; two ledger sections or feed boxes for the same day | 0 |
| 4 | Anything dated in the future (production, ledgers, feed, sales, rates, movements, purchases, vaccinations) | 0 |
| 5 | A day missing between 2 Jul and 28 Oct in any table | 0 (all 119 days present) |
| 9 | Bird chain: birds today = birds yesterday − deaths today ± moves, every flock, every day | 0 breaks |
| 10 | Eggs of the big-egg flocks not a multiple of 30 (trays) | 0 |
| 12 | Sales without a ledger line / ledger sale lines without a sale | 0 / 0 |
| 13 | Sale quantity differs from the ledger line it came from | 0 |
| 14 | Sale price breaks the rule (Farmfresh = rate − ₹0.03, local = rate + ₹0.01) | 0 |
| 15 | Sale amount ≠ quantity × price | 0 |
| 16 | Flock status / depletion date / latest row disagree | 0 (11 active flocks BAB-1 to BAB-11 at their last figure of 28 Oct; two departed flocks closed on 4 and 9 Sep) |
| 18 | Missing eggs, birds or deaths in any production row | 0. Feed is blank on 69 rows: all are the three left-page young flocks (BAB-9/10/11), whose page has no Feed column. That is normal and is not an error. |

## What does not add up (owner questions)

None of these is a software fault: each is a figure written in the register, or a gap between two pages, that the app has flagged and left alone.

| # | Where | What the numbers say | Question for the owner |
|---|---|---|---|
| D1 | Big egg ledger, 29 → 30 Jul | 29 Jul closed at 1,11,990; 30 Jul opened at 1,12,020 (+30 = one tray) | Was one tray added overnight (a late count)? |
| D2 | Big egg ledger, 24 → 25 Sep | 24 Sep closed at 1,82,610; 25 Sep opened at 1,82,580 (−30) | Was one tray taken out (breakage, a gift)? |
| D3 | Big egg ledger, 20 Sep | Ledger says 48,450 eggs produced; the flock rows of that page add to 48,480 (−30) | Which one is right: the ledger line or one flock's eggs? |
| D4 | Small egg ledger, 29 and 30 Jul | Two unnamed "+300" additions. The app asks "say what it is" and keeps them flagged | What were the +300 small eggs on 29 and 30 Jul? |
| D5 | Feed box, 20 → 21 Jul (BAB-1-7 box) | 20 Jul closed at 70 bags; 21 Jul opened at 173 (103 bags more). Flagged | Was the opening 173 correct (a delivery not written)? |
| D6 | Feed box, 21 Oct (one box for the right page) | The page does not give "produced"; the app derived 22 bags (opening 234 + produced = 256 so that stock 98 + consumed 158 add up). Flagged | Is 22 bags right for a festival day with low production? Also asked for 19 and 20 Oct. |
| D7 | Feed box, 3 → 4 Jul (BAB-1-7) | Closing 254, next opening 255 (+1 bag) | Rounding, or a bag opened by hand? |
| D8 | Feed box, 5 → 6 Aug (BAB-8-10) | Closing 28, next opening 33 (+5 bags) | A delivery to this box not written? |
| D9 | Feed box, 8 → 9 Aug (BAB-1-7) | Closing 117, next opening 161 (+44 bags) | Same: a delivery between the two days? |
| D10 | Feed box arithmetic, 11 Aug (BAB-1-7) | 143 + 132 − 158 = 117, but the box says 106 (11 bags) | Which figure is a slip? |
| D11 | Small egg ledger, 3 Sep – 3 Oct (31 days) | The ledger exists but is not linked to any flock (the young flocks BAB-9 to 11 were not yet on the page; the main flocks' graded small eggs were counted instead) | Nothing to fix; stays as it was written. Noted so nobody is surprised that these days have no flock behind the small eggs. |

Also still open on the owner's list (not integrity breaks): 1 July page, chick rows of 2 and 20 Oct, BAB-2 health on 27 and 28 Oct (12 and 14 deaths, HD 67%: this is now an alert, see N5), BAB-3 moult start day.

Two ledger lines (D4) and two feed boxes (D5, D6) are the **only** flagged records still waiting for a review. The 11 flock rows of 28 Oct and every earlier flock row carry no open flag.

## Label history

Check 19 lists eight labels that differ from today's flock names (for example the register said "BAB-2" on early dates for the flock now called "BAB-1"). That is the renumbering of 9 Sep, which was kept on purpose: the original label is stored on every row (`display_label_as_written`), the flock keeps its identity, and Analytics follows the flock, not the label. Nothing to do.

## Code bugs found during V12 (fixed)

| Where | Bug | Fix |
|---|---|---|
| `lib/salesSync.ts` | Saving a ledger day again (reader re-read, correction, or "Replace the saved day") failed with "inconsistent types deduced for parameter $3" whenever a sale line already had its sale row | The quantity is cast `::integer` in both places. Found by the manual-entry test; it would also have stopped a re-read of any day with a sale. |
| Shared production writer | A blank Feed on a left-page flock (BAB-9/10/11) was flagged "missing field: feed_bags" | New `noFeedColumn` option used by the manual entry (the 69 older left-page rows with a blank Feed are not flagged either). |
| `ManualDayForm` | First version defined its sub-parts inside the component, so every key stroke rebuilt them and a phone keyboard would lose focus after each digit (ESLint `react-hooks/static-components` caught it) | Plain render functions; tested by typing digit by digit. |
| Medicines forms | A server action redirect after save sometimes did not return to the page (the data was saved, the "Saved" banner was missing) | Actions return their answer on the same screen and the page refreshes itself. The older forms were tested again in V12 (Purchases, How targets are learned, Production entry): they follow their redirect in under 0.4 s, so only the Medicines pattern needed changing. |
| `costs-check` / `period-check` | Hard-coded 26 Oct expectations failed on any newer data | Expected values are now derived from the data; `scripts/run-all.mts` runs everything. |

## How to re-run

```
psql "$DATABASE_URL" -f web/scripts/integrity-v12.sql
```

Every query only reads. A check is healthy when it prints `(0 rows)` or a count of 0; sections 6, 7, 8, 11, 11b, 17, 19 are the ones that list the open items above.
