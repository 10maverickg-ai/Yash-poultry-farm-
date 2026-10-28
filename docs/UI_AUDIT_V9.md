# UI audit (V9 J8) — 28 Oct 2026

Method: every screen was loaded at 360, 390 and 820 px in a real browser (Playwright, Chromium) against a copy of the live data (2 Jul – 26 Oct). A script counted horizontal overflow, controls under 44 px, text under 13 px, unlabelled fields and images without alt text, and the screens were also looked at (screenshots). Screens: Today, Analytics (day/week/month/year), Day, Flocks, Sales, Egg stock, Upload, Costs, Medicines, Export, Review flags, Home.

## Found, and fixed
| What was confusing or wrong | Where | Fix |
|---|---|---|
| Today was a long list of numbers with no order of importance | Today | Three parts in order: ✔ what is right, ✖ what is wrong now (one sentence, the numbers, **what to do**), ⚠ what may go wrong soon; every line is tappable. Per-group panels and the whole farm come after. |
| "HD %", "standard", "register label", "ramping" unexplained | Today, Analytics, cards, tables | "eggs per 100 birds (HD %)" and "breeder's target" are explained once at the top of the board and used in every label; "register label" is now "written in the register as". |
| "No reference loaded" chip on several flocks | flock cards | Replaced by a chip that says why: Placement date missing / Past the target table / No target for this breed / Ramping up / Moulting; fine flocks show ✔ On target, ⚠ Below target or ✖ Well below target (icon and word, never colour alone). |
| Raw reader wording in alerts ("HD 66.2% vs its own 7-day average …", "bird_population readings disagree") | alerts, review screen | Plain sentences; the original text is under "Technical detail". |
| No "data up to" date; a stale board looked current | Today, Analytics | Visible "Data up to 26 Oct 2026" stamp with a ⚠ warning when the newest day is more than a day old. |
| Costs table: amounts pushed off the screen on a phone | Costs | Labels wrap, amounts stay on one line; "to date, not the full month" note; "not entered" instead of ₹0. |
| Flocks table: the Group control was far off to the right | Flocks | Flocks are cards (name, birds, age, placed date, breed, shed, group control). |
| Controls shorter than 44 px (sub-menu pills, buttons, inputs, brand link) | all | Minimum height 44 px for every control; ◀ ▶ buttons 48 px wide. |
| Small text (11–12 px labels, table headers, badges) | all | Minimum about 13 px for labels; body 16 px. |
| Dates as 2026-10-26 or "Mon, 26 Oct 2026"; mixed number formats | Sales, Day, Costs, Review | DD Mon YYYY everywhere (26 Oct 2026); Indian digit grouping (1,23,456; ₹1,18,27,752). |
| Day, Analytics, Sales did not split the two groups | Day, Sales, Egg stock | Per-group blocks and a check that the farm total equals the sum. |
| Blank or raw error pages on a failed request | all | Friendly loading, error ("Try again") and not-found screens; read-only database queries are retried twice. |
| Photo reading errors showed the provider's raw message | Upload, Rates | "Photo reading is paused … you can enter the day by hand" (never the raw error). |
| Uploading one photo for a saved day could replace it | Upload (one-photo form) | Asks first (a "Replace the day that is already saved" box). |
| Two navigation rows (Day/Week/Month/Year twice) | Analytics | One switch on the board. |
| Focus not visible; no skip link | all | Visible focus ring and a "Skip to the page" link. |

## Not fixed (listed honestly)
- Medicines, Egg stock entry form and Upload still have dense forms with technical field names (for example `small_total_eggs_produced`); they work and have labels, but the wording is the developer's. They need a rewrite with the owner watching.
- The week/month/year tables are wide (many columns) and scroll sideways inside their box on a phone; nothing overflows the page, but a phone user must swipe the table.
- I could not test on a real iPhone Safari or Android Chrome; everything was checked in desktop Chromium at phone widths.
- Reader benchmark pages (admin) were not restyled.
