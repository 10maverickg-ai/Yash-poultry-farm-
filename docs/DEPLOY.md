# Deploying — Vercel + Neon Postgres

Owner-chosen setup: Vercel hosts the `web/` app, Neon hosts Postgres. Neon
over Supabase because the app talks plain SQL through node-postgres — no need
for Supabase's auth/storage layer yet (Phase 3 photo storage can use Vercel
Blob or S3 when it arrives). Both have workable free tiers; Neon's paid tier
(~$5-20/mo) is the safe choice once real data matters, for backups and no
cold-pause.

## 1. Database — Neon (~5 minutes)

1. Create an account at https://neon.tech and a new project (region: Singapore
   `ap-southeast-1` is closest to India; pick the newest Postgres version).
2. From the project dashboard copy **both** connection strings:
   - the **pooled** one (host contains `-pooler`) — for the app
   - the **direct** one — for running migrations
3. Apply the schema and seeds from your machine (or any shell with `psql`):

   ```bash
   DATABASE_URL='postgres://…direct-host…/neondb?sslmode=require' ./scripts/apply.sh
   ```

   Expect the 7 migrations + 3 seeds to print in order. Optionally verify:

   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/smoke_test.sql
   # → "smoke test: all assertions passed" … rolls itself back
   ```

## 2. App — Vercel (~5 minutes)

1. Create an account at https://vercel.com (sign in with the GitHub account
   that owns this repo) and click **Add New → Project → import
   `Yash-poultry-farm-`**.
2. Two settings before deploying:
   - **Root Directory: `web`** (the app lives in a subdirectory)
   - **Environment variable `DATABASE_URL`** = the **pooled** Neon string,
     ending `?sslmode=require`
3. Deploy. The URL is `https://<project-name>.vercel.app` — open it on your
   phone, and use "Add to Home Screen" so it behaves like an app.

## 3. Post-deploy checklist

- Load `/flocks`, add the real sheds and currently running flocks first —
  every other screen depends on the flock list.
- **Access control:** the app currently has no login (Phase 2 is owner-only
  entry). The URL is unguessable-ish but public. For the data-entry trial
  this is acceptable if you keep the URL private; enable Vercel's built-in
  protection (Project → Settings → Deployment Protection) or ask for a simple
  password gate if you want it locked down before Phase 3 adds real roles.
- Migrations after code updates: run any new `db/migrations/*.sql` against
  the **direct** connection string with `./scripts/apply.sh` (it is
  idempotent for seeds, and migrations are numbered — apply new ones in order).

## Alternative: let Claude do steps 1–2

Provide two secrets and the session can run the whole thing end-to-end and
hand back the URL:
- a Vercel token (vercel.com → Account Settings → Tokens)
- a Neon API key (console.neon.tech → Account → API keys), or just a
  ready-made connection string if you prefer to create the project yourself
