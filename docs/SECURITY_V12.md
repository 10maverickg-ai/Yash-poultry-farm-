# V12 security and safety review (N9)

Scope: what the app exposes, what it keeps secret, and what a stranger or a mistake could do. **No row-level-security or login change was made** (standing rule); the two big findings (S1, S2) are written up as owner decisions. Everything marked *fixed* is small, tested and in its own commit.

## What needs a decision (owner)

| # | Severity | Finding | What it means | What I did |
|---|---|---|---|---|
| S1 | **High** | **Row-level security is off on all 45 tables of the live database, and the database roles `anon` and `authenticated` may read, add, change and delete in all 45.** | Supabase also offers every table over a web address (its REST interface). Anyone who holds the project's public key together with the project address could read or change the farm data without going through the app at all. The app itself does not use that route (it connects directly with `DATABASE_URL`), so nothing the owner does is affected today. The key is not in the app or in this code; it is only on the Supabase dashboard (and anywhere it was copied). | **Not changed.** Read-only look at the live permissions (`pg_class`, `has_table_privilege`). To close it: switch RLS on for every table (no policies needed for the app, which connects as the database owner) and, as a second lock, take the table rights away from `anon` and `authenticated`. It is one migration, but it should be tried first on a Supabase branch because I cannot prove from here which role the live `DATABASE_URL` uses. **Your decision.** |
| S2 | **High** | **There is no login.** Anyone who knows the web address can see and change every record and can start photo reading (each read costs Anthropic credit). | `docs/DEPLOY.md` already says so: the address is "unguessable-ish but public", and Vercel's Deployment Protection is the suggested lock. | Not changed. I cannot see whether Deployment Protection is on (the Vercel link is still not approved in this session). **Please switch on Deployment Protection (Vercel → Settings → Deployment Protection) or ask for a password gate.** |
| S3 | Medium | Set `CRON_SECRET` on Vercel. | The daily weather job (`/api/weather`) only accepts Vercel's own call when this secret is set. Without it the address answers anyone. | Made harmless: without the secret the route now refreshes only when the weather is more than 12 hours old, so nobody can use it to hammer the weather service. **Setting the secret on Vercel is still better.** |
| S4 | Info | The `register-photos` storage bucket is public read. | Anyone with a photo's link (it contains a random part) can open that register photo. Chosen on purpose earlier (`DECISIONS.md`: "consistent with the app's current no-auth posture"). | Not changed. Becomes part of the RLS / login decision. |

## Found and fixed

| # | Finding | Fix |
|---|---|---|
| S5 | **Next.js 16.2.10 had a critical advisory** (a way around middleware/proxy checks) and a denial-of-service advisory on server actions. The app has no middleware, so the first one did not apply here, but the second does on a public address. | Upgraded to **Next 16.4.3** (and `eslint-config-next` to match), plus `npm audit fix` for four small indirect packages. Re-run after the upgrade: type check, lint, production build, all 30 test scripts, and the forms in a real browser (manual day save and replace, Purchases, How targets are learned, Production entry, Settings button). **Not tested: the Vercel build itself.** If anything looks wrong on the preview, reverting `package.json` and `package-lock.json` restores 16.2.10. |
| S6 | Uploads accepted any file type, and the stored path used whatever extension the file name had (a name such as `x.jpg/../../evil` would have gone into the path). | Pictures only (JPEG, PNG, WebP, HEIC, or a phone that sends no type), at most 15 MB, with a plain sentence otherwise; the extension is kept only if it is 2 to 5 letters or digits. `scripts/safety-check.mts` (7 checks). |
| S7 | The browser was not told to refuse content-type guessing, to keep the full address from other sites, or to refuse being shown inside another site's frame. | Three response headers on every page (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`). |
| S8 | `/api/weather` always forced a fetch, even when called by a stranger. | See S3. |

## Checked and clean

| Check | Result |
|---|---|
| **Secrets in what the browser receives.** Searched the whole built client bundle (`.next/static`) for `sk-ant`, `service_role`, `SUPABASE_SECRET`, `ANTHROPIC_API_KEY`, `postgres://`, `CRON_SECRET`, `sb_secret` | none found |
| `NEXT_PUBLIC_` variables (the only kind that reach the browser) | none exist |
| Where the secret keys are read | only on the server: `DATABASE_URL` (`lib/db.ts`), `ANTHROPIC_API_KEY` (reader), `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (`lib/storage.ts`, photo upload only), `CRON_SECRET`, `READER_BENCHMARK_KEY` |
| Error messages and error pages | They name a missing setting but never print its value; the error card shows only a reference number, never a stack |
| SQL built from user input | Every query uses placeholders. The three places that put a name into the SQL text use fixed lists in the code (flag tables, backup tables, re-check columns), never what the user typed |
| `dangerouslySetInnerHTML` | not used anywhere |
| Server actions | Next checks that a form post comes from the app's own address; the body limit is 8 MB; imports are limited to .csv and .xlsx at 5 MB; medicine photos to pictures at 15 MB |
| Dependencies (`npm audit --omit=dev`) | 10 findings before (1 critical); **2 moderate remain**: `exceljs` → `uuid` (a bounds check that only matters when a buffer is handed to it; the app never does). The only fix offered is going back to an old exceljs 3.x, which would break the Excel export, so it is **left as is** |
| Photos and data in the sandbox | The test data is a copy of the live data on a private machine; nothing was sent anywhere |

## Smaller things to know (no action needed now)

| # | Note |
|---|---|
| S9 | The database connection is encrypted but, unless `DATABASE_CA_CERT` is set, the server's certificate is not checked (`lib/db.ts` explains why). The CA certificate is on the Supabase dashboard; setting it is the stronger option. |
| S10 | `/admin/reader-benchmark?key=…` is a test tool protected by a shared secret in the address (so it shows in browser history); it is off unless `READER_BENCHMARK_KEY` is set. |
| S11 | The local-development password in `lib/db.ts` is used only outside production; in production a missing `DATABASE_URL` stops the app instead of falling back. |
| S12 | Backups: the app can export everything to Excel / a zip (Day → Excel / backup). I could not see the Supabase backup plan (daily backups depend on the plan). |

## Needs owner (security)

1. Decide on **S1**: row-level security and the `anon`/`authenticated` rights on the live database.
2. Switch on **Deployment Protection** (or a password) for the web address (**S2**), and set **`CRON_SECRET`** on Vercel (**S3**).
3. Approve the Vercel link so the next session can read the build and runtime logs of the preview with the Next 16.4.3 upgrade (**S5**).
