# Sample register photos

Real paper-register photos supplied by the owner (2026-07-10) as reference
fixtures for Phase 3 extraction work — real handwriting, layout quirks, and
bleed-through/mirroring from facing pages, which the written spec alone
doesn't capture. Not used by any code; reference only.

Dates below are read directly off each photo where legible. Verify against
the image itself before relying on a date — do not trust filenames alone.

- **sample-1-two-page-spread.jpg** — two facing pages of the Daily Production
  register, BAB 1–10 flock rows with Mort / I / II / Total / Bal-Bag / % and
  the "V." (variance/%) column. One side headed "9-7-26" (approximate — the
  digit is hard to confirm), the other carries the prior day's totals
  including a bottom "Feathers/Claws" adjustment block (+2730/−180 style
  entries) below the flock rows.

- **sample-2-single-page-8-7-26.jpg** — single Daily Production page headed
  "8-7-26", BAB 1–7 rows plus an "18 BAB" labeled block (renumbered/relabeled
  flock — same phenomenon the flock_label_history table exists for). Same
  Feathers/Claws-style adjustment block at the bottom.

- **sample-3-single-page-7-7-26.jpg** — single Daily Production page headed
  "7-7-26", same BAB 1–7 + 18 BAB layout and bottom adjustment block. Good
  companion to sample-2 for seeing day-over-day continuity (opening figures
  match the prior day's closing).

- **sample-4-feed-bag-boxes-and-production.jpg** — top of page shows the
  Feed Bag Stock reconciliation boxes in two side-by-side groups: "OB="
  (opening balance), "(+)" (produced), running total, "(−)" (consumed),
  remaining, then "F=" (mill inventory) and "S=" (shed inventory) summing to
  the same remaining figure — this is the exact layout
  `daily_feed_bag_stock` (migration 0008) models. Faint mirrored/bleed-
  through text from the facing page is visible behind it; ignore that layer.
  Below the boxes, a Daily Production table continues, undated in the
  visible crop.

## Layout quirks worth knowing before building Phase 3 extraction

- The "two groups side by side" pattern shows up on more than one register
  (Feed Bag Stock's Layer/Grower split, and implicitly on Daily Production
  where "18 BAB" is a distinct block alongside the main BAB 1–7/1–10 rows).
- Flock labels are abbreviated inconsistently across samples ("BAB", "13
  BAB", "18 BAB") — matches the schema's premise that
  `display_label_as_written` needs raw capture, not assumed normalization.
- A bottom adjustment block on the Daily Production pages (labeled something
  like "Feathers"/"Claws" with its own +/− entries) does not currently map to
  any field in the schema — flagged here for whoever scopes further register
  additions; not built, per the owner's "store and validate, no dashboard
  yet" instruction for this round.
