-- =============================================================================
-- Migration 0025: reader_benchmark_photos
--
-- Owner request, 2026-10-19: the reader-rebuild benchmark page
-- (/admin/reader-benchmark) can only run the new reader against a date
-- that already has a stored photo — most real daily_production history
-- (e.g. all of August) was entered by hand from the paper register, with
-- no photo ever uploaded through the app. This table lets the owner upload
-- a photo for exactly that purpose from the benchmark page, WITHOUT it
-- ever touching daily_production or any other production table — it is
-- read ONLY by the benchmark (lib/extraction/readerV2/benchmark.ts), never
-- by the upload flow, and holds no extracted numbers of its own, only the
-- photo's location.
--
-- One photo per farm/date (a re-upload replaces it, via upsert — there is
-- no reason to keep more than the latest for a diagnostic tool). No RLS,
-- matching every other table in this schema.
-- =============================================================================

CREATE TABLE reader_benchmark_photos (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    farm_code       text NOT NULL,
    date            date NOT NULL,
    photo_url       text NOT NULL,
    uploaded_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (farm_code, date)
);

COMMENT ON TABLE reader_benchmark_photos IS
    'Benchmark-only photo storage for /admin/reader-benchmark — never read by, or written from, any production upload/save path.';
