# Yash Poultry Farm — Digitization System

Photo-capture + structured-database system replacing paper registers at Yash Poultry Farm
(and later Anil Poultry Farm — same owner, separate operation, same schema via `farm_code`).
Supervisors keep photographing registers exactly as they do today; the system extracts,
validates, and surfaces only genuine exceptions to the owner.

Every field in this schema corresponds to something actually written on a real paper
register at this farm. The only two deliberate additions beyond the paper: daily egg
size-grading counts, and the Flock Register as a formal table.

## Current status: Phase 2 in progress

| Phase | Scope | Status |
|---|---|---|
| 1 | Schema, validation rules, seed data | ✅ done (owner-approved) |
| 2 | Manual entry screens (owner-facing) | ✅ increments 1–5 done (BV300 standards comparison queued as increment 6) |
| 3 | OCR/extraction capture flow + review queue | not started |
| 4 | Analysis dashboard | not started |

Phase 2 increments: **1.** skeleton + flocks/sheds ✅ → **2.** Daily Production ✅ →
**3.** Egg Stock Ledger & sales ✅ → **4.** Feed screens ✅ → **5.** records + flagged view ✅.

## Layout

```
db/migrations/   numbered SQL, apply in order
  0001_reference.sql             enums, farms, sheds, feed_materials
  0002_flocks.sql                flocks, flock_label_history, label resolution fn
  0003_daily_production.sql      daily per-flock production register
  0004_egg_stock_and_sales.sql   egg stock ledger (header + lines), derived sales
  0005_feed.sql                  feed_stock (mill-level), feed_formulation (versioned)
  0006_validation_functions.sql  flag-for-review rules as fn_validate_* functions
db/seeds/        farms (YPF/APF) + the 28 feed materials
scripts/         apply.sh (migrations+seeds), smoke_test.sql
web/             Next.js (TypeScript, App Router) entry screens, node-postgres
                 directly against the schema — no ORM, SQL stays authoritative
docs/            DECISIONS.md (Phase 1 judgment calls — read this first),
                 VALIDATION.md (rule → enforcement mapping),
                 source-specs/ (the three planning documents, text-extracted)
```

## Run it

```bash
docker compose up -d                    # Postgres 16 on localhost:5432
export DATABASE_URL=postgres://yash:yash_dev_password@localhost:5432/yash_poultry
./scripts/apply.sh                      # migrations + seeds
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/smoke_test.sql   # self-rolls-back
```

Then the entry screens:

```bash
cd web
npm install
cp .env.example .env.local   # points at the docker Postgres above
npm run dev                  # http://localhost:3000
```

The smoke test builds a realistic day of data (a renumbered "BAB-I" flock pair, a
production row, an egg-stock ledger with a Sukha sale / breakage / cross-farm line, feed
stock rows including a deliberate quintal/kg misread) and asserts every validation rule
fires — or stays quiet — exactly as specified. It rolls back and leaves only seed data.

## Key design points (from the schema spec)

- **Labels aren't identities.** "BAB-I" is a position label that gets reassigned when the
  oldest flock is depleted. `flocks.flock_internal_id` is forever;
  `resolve_flock_internal_id(farm, label, date)` maps what supervisors write to the right
  flock via `flock_label_history`.
- **The egg ledger is a ledger.** Header (`daily_egg_stock_summary`) + variable signed
  lines (`daily_egg_stock_entries`), not fixed columns — a new entry type never breaks the
  schema. Running balances are system-computed, never read from paper.
- **Sales have no paper register.** Rows in `sales` are generated from ledger lines with
  `category = 'sale'`. Price has no paper source anywhere and stays null unless manually
  entered.
- **Validation flags, it doesn't reject.** Records failing the spec's checks are saved
  with `flagged = true` for the owner's review queue. See `docs/VALIDATION.md`.
- **Feed stock is mill-level, in kg.** Paper mixes quintals and kg on the same page; the
  balance check exists precisely to catch conversion misreads.

## Out of scope for v1 (deliberately)

Weekly Health register, per-flock formulation validation, ingredient-to-bags cross-checks,
and the Anil Poultry Farm build-out (schema supports it; build effort targets Yash first).
