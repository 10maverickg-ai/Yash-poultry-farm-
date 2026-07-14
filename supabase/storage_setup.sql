-- =============================================================================
-- Phase 3: register-photos storage bucket (2026-07-14)
--
-- Paste into Supabase SQL Editor and run once — same pattern as every
-- db/migrations/*.sql file. Storage buckets are just rows in storage.buckets
-- in the same Postgres database, so no separate Storage API call is needed
-- to set this up.
--
-- Public READ (the review queue displays photos via a plain URL, matching
-- how source_photo_url is already a plain text column on every extracted
-- table — consistent with the rest of this app, which currently has no
-- auth boundary at all). WRITE happens only server-side, using the
-- Supabase "secret" key, which bypasses RLS entirely — so no INSERT policy
-- is defined or needed; nothing can write to this bucket except the app's
-- own server code.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'register-photos',
    'register-photos',
    true,
    15728640,  -- 15 MB — phone photos, especially iPhone HEIC->JPEG, can run large
    ARRAY['image/jpeg', 'image/png', 'image/heic', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;
