-- ROLLBACK for db/proposed/0048_revoke_anon.sql. PROPOSED, NOT APPLIED. (V13 P5)
-- Puts back exactly what the live database had on 29 Oct 2026 (read from pg_default_acl, information_schema and has_*_privilege):
--   tables     anon, authenticated: arwdDxtm (= ALL)      sequences: rwU (= ALL)      functions: EXECUTE (also granted to PUBLIC)
-- Use it only if the app stops working after the revoke (it should not: the app connects as postgres) or on the owner's decision to
-- open the public interface again. It does not enable anything new.
BEGIN;

GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
-- only if the optional database-wide line "REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC" was also run:
-- ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

COMMIT;
