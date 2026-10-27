# Segment check (V8 S0.7) — read-only

Per-segment numbers from the engine (`web/scripts/segment-check.mts`, 33+ checks) next to a direct SQL sum on the live database (27 Oct 2026). Both agree.

| Scope | Group | Eggs | Birds (or bird-days) | Deaths | Feed bags | HD % |
|---|---|---|---|---|---|---|
| 26 Oct | Main (BAB-1..8) | 52,860 | 66,663 | 29 | 137 | 79.29 |
| 26 Oct | Young (BAB-9..11) | 15,930 | 27,708 | 11 | not recorded | 57.49 |
| 26 Oct | **Whole farm (old number)** | 68,790 | 94,371 | 40 | 137 | **72.89** |
| 1–26 Oct | Main | 1,426,830 | 1,740,898 | 601 | 3,629 | 81.96 |
| 1–26 Oct | Young | 223,800 | 639,023 | 173 | 127 (2 days) | 35.02 (ramping up) |
| 1–26 Oct | **Whole farm (old number)** | 1,650,630 | 2,379,921 | 774 | 3,756 | **69.36** |

- Segments add up to the old whole-farm total for eggs, birds, bird-days and deaths (26 Oct and October).
- The whole-farm HD % (72.89 / 69.36) is a blend of a 79–82 % group and a 35–57 % group. It describes neither, which is why every view now shows the groups first.
- On 26 Oct the main group's eggs equal the big ledger's "laid" figure (52,860) and the young group's equal the small ledger's (15,930).
- SQL used: `select seg, sum(eggs_total), sum(bird_population), sum(mortality), sum(feed_bags) from daily_production d join flocks f using (flock_internal_id) where deleted_at is null and date = '2026-10-26' group by f.segment` (and the same for `date between '2026-10-01' and '2026-10-26'`).
