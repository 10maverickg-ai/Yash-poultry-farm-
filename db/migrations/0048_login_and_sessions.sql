-- Migration 0048 (V13): the login. Additive only; no RLS change; no change to roles or grants.
--   login_attempts : one row per login try (time, which login was tried, success, hashed address and browser id; never a password or PIN).
--                    The lock-outs are worked out from it, and the owner sees the latest rows on Settings ("Recent logins").
--   auth_state     : small named numbers. 'staff_session_version' is raised by "Log out all staff phones" and ends every staff session.
-- The app works without them (it keeps the same counters in memory and treats staff sessions as ended): see lib/auth/attempts.ts.
BEGIN;
CREATE TABLE IF NOT EXISTS login_attempts (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ref          text NOT NULL UNIQUE,
    attempted_at timestamptz NOT NULL DEFAULT now(),
    role_tried   text NOT NULL CHECK (role_tried IN ('owner', 'staff')),
    ok           boolean NOT NULL DEFAULT false,
    blocked      boolean NOT NULL DEFAULT false,  -- refused because of a lock-out; not counted as a new wrong try
    ip_hash      text NOT NULL,
    fid_hash     text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_role_time ON login_attempts (role_tried, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_time ON login_attempts (attempted_at DESC);
COMMENT ON TABLE login_attempts IS 'One row per login try; hashed address, no secrets. Read by lib/auth/attempts.ts and shown on Settings. Old rows can be deleted at any time.';

CREATE TABLE IF NOT EXISTS auth_state (
    key        text PRIMARY KEY,
    int_value  bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO auth_state (key, int_value) VALUES ('staff_session_version', 0) ON CONFLICT (key) DO NOTHING;
COMMENT ON TABLE auth_state IS 'Named counters for the login. staff_session_version: raise it to end every staff session.';
COMMIT;
