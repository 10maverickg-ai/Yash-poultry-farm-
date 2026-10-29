import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Same lesson as lib/db.ts: never touch env vars at import time, since
// `next build` loads this module with no runtime environment. The client is
// created lazily, on first upload, and throws a specific error there —
// not a mysterious failure partway through a request.
let client: SupabaseClient | undefined;

function getClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SECRET_KEY are not set. Configure both in the " +
        "deployment environment and redeploy — env var edits do not apply to " +
        "already-built deployments. SUPABASE_SECRET_KEY is the project's " +
        "secret key (Project Settings -> API), used server-side only."
    );
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

const BUCKET = "register-photos";

/** Only a short letters-and-digits extension from the file name is used in the stored path; anything else becomes jpg/png/webp/heic by type. */
export function safeExt(name: string, type: string): string {
  const raw = name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
  if (/^[a-z0-9]{2,5}$/.test(raw)) return raw;
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : type === "image/heic" ? "heic" : "jpg";
}

export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;

/** A plain sentence when the file is not a picture or is too big; null when it is fine. (A phone sometimes sends no type at all: that is accepted.) */
export function photoProblem(file: File): string | null {
  if (file.type && !file.type.startsWith("image/")) return "That file is not a picture. Choose a JPEG, PNG, WebP or HEIC photo of the page.";
  if (file.size > PHOTO_MAX_BYTES) return "That photo is bigger than 15 MB. Take it again at a lower quality.";
  return null;
}

/**
 * Uploads a register photo to Supabase Storage and returns its public URL —
 * the exact string that fills a table's source_photo_url column. Path is
 * prefixed by register type and date so photos are browsable in the
 * Supabase dashboard without a database lookup.
 */
export async function uploadRegisterPhoto(
  file: File,
  registerType: "production" | "feed-stock" | "feed-bag-stock" | "medicines",
  date: string
): Promise<string> {
  const ext = safeExt(file.name, file.type);
  const path = `${registerType}/${date}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

  const { error } = await getClient().storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);

  const { data } = getClient().storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Uploads a photo for the reader-rebuild benchmark page ONLY (owner
 * request, 2026-10-19) — same bucket as a real register photo, but under
 * its own "benchmark/" prefix so it's never confusable with one. Its URL
 * is stored in reader_benchmark_photos, never in daily_production or any
 * other production table, and nothing in the upload flow ever reads this
 * prefix.
 */
export async function uploadBenchmarkPhoto(file: File, date: string): Promise<string> {
  const ext = safeExt(file.name, file.type);
  const path = `benchmark/${date}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

  const { error } = await getClient().storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(`Benchmark photo upload failed: ${error.message}`);

  const { data } = getClient().storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
