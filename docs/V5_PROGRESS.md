# V5 progress tracker

Master prompt: `docs/V5_MASTER.md` (re-read it, and this file, after any context reset; continue from the first item that is not `built`).
Branch: `claude/v5-integration` (from `main`). Nothing is merged to `main`.
Gate per item: `tsc`, `eslint`, `next build` pass. Status: todo / built / debugged.

## Items
| ID | Title | Status | Notes |
|---|---|---|---|
| 1.1 | Tracker + docs, branch, merge PR #17 branch | built | PR #17 branch merged cleanly (no conflicts) |
| 1.2 | Additive migrations | todo | |
| 2.1 | HD% display | todo | |
| 2.2 | Sales page (Aug sales, Sep lines, bird sales) | todo | |
| 2.3 | Navigation: seven sections | todo | |
| 3.1 | Alert rules (owner-decided) | todo | |
| 3.2 | Placeholder-age flocks: no standard check | todo | |
| 3.3 | Revenue / cost / profit on analytics | todo | needs 4, 5 |
| 3.4 | Drop `_stage_dp` | todo | |
| 4.1 | BAFTA rate entry | todo | |
| 4.2 | Sales rows from ledger lines when rates exist | todo | |
| 5.1 | Cost settings | todo | |
| 5.2 | Daily/monthly profit | todo | |
| 6.1 | Knowledge tables + screens | todo | |
| 6.2 | Knowledge importer + sample | todo | |
| 7.1 | Flocks screen / lifecycle | todo | |
| 7.2 | Moulting | todo | |
| 7.3 | Chick batches | todo | |
| 7.4 | Medicines / vaccines | todo | |
| 8.1 | Multi-photo upload queue | todo | |
| 8.2 | Review screen | todo | |
| 8.3 | Date rule | todo | |
| 9.1 | Merge readerV2 into integration branch | todo | |
| 9.2 | Benchmark runs | todo | needs READER_TEST_KEY |
| 9.3 | September test dates | todo | |
| Z | Debug everything | todo | |

## Migrations applied
(none yet)

## Known bugs
(none yet)

## Needs owner
- September BAFTA rates.
- Real placement dates of BAB-8, 9, 10 (placeholder 2026-01-01).
- Exact BAB-5 moulting start date (pre-filled Aug 15 2026, inferred).
- Knowledge content files.
- RLS decision (RLS is OFF on all public tables; not changed).
- Costs not yet given: September electricity, diesel, medicine purchase prices.
- First non-zero BAFTA subsidy: confirm effective rate = rate − subsidy/100.

## Could not test
(none yet)

## Decisions
(none yet)
