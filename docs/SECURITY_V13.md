# V13 security: the database's second door (P5) and the new login

## The one-paragraph answer

**Nothing in the app uses Supabase's public interface.** The website talks to the database only through its own direct connection (`DATABASE_URL`, as the database owner `postgres`) and uses Supabase only to store photos (with the secret key, on the server). So the public "anon" door into the 45 tables is not needed by anything and can be closed without changing the app. The fix is written, tested on a scratch copy and **ready but NOT applied**: `db/proposed/0048_revoke_anon.sql` (with `db/proposed/0048_revoke_anon_rollback.sql`). **Your decision: apply it or not** (see "Decision needed").

Why it matters even though the website now has a login: the login protects the website. The database's own public web address (`https://<project>.supabase.co/rest/v1/...`) is a second door that does not go through the website at all. Anyone who holds the project's public "anon" key can open that door today and read, change or delete any record. The login does nothing about that.

## What I checked (nothing was changed on the live database)

### 1. Does the app use the public interface? No.

| Check | Result |
|---|---|
| Any use of the Supabase REST, GraphQL, realtime or auth interface, `.rpc(`, `createBrowserClient`, `rest/v1`, `graphql/v1`, `auth/v1`, `functions/v1` anywhere in the code (app, lib, components, scripts) | none |
| Any use of the anon or publishable key (`NEXT_PUBLIC_SUPABASE_*`, `anon`, `publishable`) | none. The only environment variables the app reads are `DATABASE_URL`, `DATABASE_CA_CERT`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `CRON_SECRET`, `SESSION_SECRET`, `APP_PASSWORD_HASH`, `APP_STAFF_PIN_HASH`, `READER_BENCHMARK_KEY`, `READER_V2_ENABLED`, plus one build id (not a secret) |
| The one place the Supabase library is used | `web/lib/storage.ts`: uploads register photos to the storage bucket `register-photos` with the **secret** key, on the server only. Storage has its own door (`/storage/v1`) and its own permissions; the revoke does not touch it |
| What the browser downloads (the whole built client bundle `.next/static`) | no Supabase client, no key, no `rest/v1` address (the only text that looked similar was Next's own `createClientParams`) |
| Photos on screen | `<img src="https://<project>.supabase.co/storage/v1/object/public/register-photos/...">`: a public-bucket address, read through Storage, not through a table right |
| Edge functions on the project | none |
| Realtime | the `supabase_realtime` publication exists but contains **no tables** |

### 2. What the live database allows today (read-only queries, 29 Oct 2026)

| Thing | State |
|---|---|
| Tables in `public` | 45, all owned by `postgres`, **row-level security off on all 45** (47 once the two login tables, added by migration 0048, are counted; they follow the same pattern) |
| `anon` and `authenticated` on tables | `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` on **all** of them |
| On sequences | usage on all 33 |
| On the 10 functions (`fn_validate_*`, `resolve_flock_internal_id`, …; none is SECURITY DEFINER) | execute, also because everybody (PUBLIC) has execute |
| New tables | created with the same open rights automatically (default rights for `postgres` and `supabase_admin` in `public`) |
| Schema `public` | `anon` has USAGE (needed to see anything at all, harmless without table rights) |
| Who connects | the public interface (`authenticator`, "PostgREST"), the pooler, the management connection and Supabase's own jobs. The app's own connection is not open at the moment of the check; its user is in `DATABASE_URL` (see the pre-check below) |
| Supabase's own security advisor | 45 × `rls_disabled_in_public` (error), 10 × `function_search_path_mutable` (warning) |

### 3. What the proposed file does and does not do

| Does | Does not |
|---|---|
| Takes every right on the existing tables, sequences and functions away from `anon` and `authenticated` (and from PUBLIC on the functions) | enable row-level security |
| Makes tables and sequences created from now on by `postgres` start closed (default rights) | touch `postgres` (the owner, which the app uses) or `service_role` (the secret key, used for photos) |
| | change any role, password or key |
| | take away the public EXECUTE default for **new** functions (PostgreSQL only allows that database-wide; it is a commented line you can choose to run; a new function's own migration can also say `REVOKE EXECUTE … FROM PUBLIC`) |

Tested on a scratch PostgreSQL with the same three roles and the same default rights as the live project: before the file, `anon` could read, write and execute everything including new objects; after it, `anon` and `authenticated` can reach **nothing** that exists and no new table or sequence, `postgres` and `service_role` are unchanged, and the rollback file puts every right back exactly. The scratch database and roles were removed afterwards. It has **not** been run against the live project.

Two other ways to get the same result without SQL, if you prefer: the Supabase dashboard's Data API switch, if your dashboard offers one (Project Settings, Data API: switching the Data API off closes the REST and GraphQL doors for the whole project, whatever the table rights are); or enable row-level security with no policies (a bigger change that I was told not to make).

## Decision needed (owner)

**Apply `db/proposed/0048_revoke_anon.sql` to the live project?** My recommendation: yes. It closes the only way around the login, nothing in the app depends on it, and the rollback is one file.

Before you (or I, in a later session, after you say yes) apply it:

1. **Check who the app connects as.** In Vercel (Project Settings, Environment Variables) look at the start of `DATABASE_URL`: it should read `postgres://postgres.<project reference>:…` (user `postgres`, through the pooler). If it starts with anything else (`anon`, `authenticated`, `service_role`, or a role you created), **do not apply** and tell me: that role would lose access.
2. Do it at a quiet time (after the evening register work), with the rollback file open in another tab.

### Test plan: what to click to prove nothing broke

Before (baseline, takes 5 minutes) and again right after:

| # | Do this | Before | After |
|---|---|---|---|
| 1 | Log in with the owner password. Open **Today**, **Analytics**, **Day** (28 Oct), **Sales**, **Purchases**, **Medicines**, **Flocks**, **Egg stock**, **Settings** | all load | all load, same numbers |
| 2 | **Settings**: tap "Refresh weather now" | "Weather updated" | the same (this writes to the database) |
| 3 | **Upload**: add one real register photo for a date that is not saved yet, open the queue | stored, "in the queue" | the same (this uses the storage door and a table write) |
| 4 | **Day, Enter a day by hand**: open a day; do not save | opens | opens |
| 5 | **Export**: download the Excel backup | downloads | downloads |
| 6 | **Settings, Recent logins** | rows shown, "database" | the same |
| 7 | Log in as staff (PIN) on a second phone, upload one photo | "Uploaded, thank you" | the same |
| 8 | **The proof the door is closed.** On a computer, with the project's anon key from Supabase (Project Settings, API, "anon public"): `curl "https://<project reference>.supabase.co/rest/v1/flocks?select=display_label&limit=1" -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>"` (put the key only in your own terminal, never in a chat) | returns a flock's name (this is the exposure) | `{"code":"42501", … "permission denied for table flocks"}` |
| 9 | Next morning: **Settings**: "Last weather came in" | – | shows the daily job ran (it uses the same connection) |

If any of 1 to 7 fails after applying: run `db/proposed/0048_revoke_anon_rollback.sql` in the Supabase SQL editor (one paste) and tell me which step failed. Step 8 is expected to change.

## What the new login protects, and what it does not

| Protected by the login | Not protected by the login |
|---|---|
| Every page, every button (server action), every route of the website; the weather job needs its own secret; staff can only upload | The database's public door (above). Closing it is the decision above |
| | The photos: the bucket `register-photos` is public-read, so a photo can be opened by anyone who has its (long, random) address; the pages that show them are behind the login, the files are not |
| | A copy of someone's login cookie: logging out ends the session on that phone only. To end every session at once change `SESSION_SECRET` in Vercel; to end staff sessions press "Log out all staff phones" in Settings |

### Weak points that stay until the database door is closed

- The login lock-out counters live in the table `login_attempts`, which has the same open rights as every other table. Someone with the anon key could delete the rows and so reset the lock-out. The same rows are also counted in memory on each server (so a reset helps an attacker only against servers that have restarted), and the owner password is stored only as a slow hash, but the proper fix is the revoke above.
- `auth_state` (the "Log out all staff phones" number) is open in the same way: someone with the anon key could change it. Raising it only logs staff out; setting it back would make a staff cookie that was ended earlier work again (a staff cookie can only upload photos and needs to have been stolen first).

### Login review notes (new in V13)

| Item | Note |
|---|---|
| Passwords | Only a scrypt hash is stored (in Vercel). `scripts/make-password-hash.mts` asks at a hidden prompt, never takes the password from the command line, refuses owner passwords under 10 characters or all digits, refuses easy PINs |
| Cookies | signed with HMAC-SHA256, HttpOnly, Secure, SameSite=Lax; every authenticated answer is `Cache-Control: no-store` |
| Address used for the per-address lock-out | on Vercel the address comes from Vercel's own header (a caller cannot choose it); anywhere else the first hop of `X-Forwarded-For` is trusted as given, so the per-address lock-out should not be relied on outside Vercel (the per-browser one and the farm-wide PIN pause still apply) |
| Login from another website | refused (the form post's `Origin` must be this site) |
| Vercel Authentication | "Standard Protection" is on in the Vercel project, so preview deployments are behind Vercel's own login; the production address is protected by this app's login |
| Not covered | two-factor login; separate accounts per person; an alert to the owner when someone fails to log in (Settings shows the list but nothing is sent) |

## Files

- `db/proposed/0048_revoke_anon.sql`, `db/proposed/0048_revoke_anon_rollback.sql` (proposed, not applied)
- `db/migrations/0048_login_and_sessions.sql` (the two login tables; additive; applied to live)
- `docs/AUTH.md` (how the login works and how the owner sets it up)
