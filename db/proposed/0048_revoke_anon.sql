-- PROPOSED, NOT APPLIED, NOT in db/migrations. (V13 P5)  Read docs/SECURITY_V13.md before anything else.
--
-- What it does: takes every right on the app's tables, sequences and functions away from the two roles Supabase uses for people who
-- come in through its public web interface (the project's public "anon" key): `anon` (not logged in) and `authenticated` (logged in
-- to Supabase's own login, which this app does not use). The app itself connects as the database owner (`postgres`) with a direct
-- connection string, which this does not touch. `service_role` (the secret key used for photo storage) is not touched either.
--
-- It does NOT enable row-level security and does NOT touch any role or any right of `postgres` or `service_role`.
-- Rollback: db/proposed/0048_revoke_anon_rollback.sql puts back exactly what the live database has today (checked read-only on 29 Oct 2026:
-- tables arwdDxtm, sequences rwU, functions X for anon and authenticated; the same default rights for new objects).
-- The number 0048 is reserved for this file by the owner's request; when it is applied it takes the next free number in db/migrations.
BEGIN;

-- 1. Everything that exists today
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
-- Functions are executable by everybody (PUBLIC) unless that is taken away too; anon would still reach them through /rest/v1/rpc/...
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- 2. Everything created from now on by the role the migrations run as (postgres)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- Known limit: a NEW function is executable by everybody (PUBLIC) unless its own migration says
--   REVOKE EXECUTE ON FUNCTION name(args) FROM PUBLIC;
-- Taking that default away for every future function postgres creates is a database-wide change (PostgreSQL does not allow it per
-- schema), so it is left to the owner's decision and is not part of this file:
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Optional, only if the Supabase SQL editor lets your role do it (it may answer "permission denied"; if so skip it, nothing in this
-- project is created by supabase_admin). Tables made through the dashboard's Table Editor can be created by supabase_admin:
-- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
-- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
-- ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;

COMMIT;

-- Check after applying (should return 0 rows for both):
--   SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon','authenticated');
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
