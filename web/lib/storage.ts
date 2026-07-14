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

/**
 * Uploads a register photo to Supabase Storage and returns its public URL —
 * the exact string that fills a table's source_photo_url column. Path is
 * prefixed by register type and date so photos are browsable in the
 * Supabase dashboard without a database lookup.
 */
export async function uploadRegisterPhoto(
  file: File,
  registerType: "production" | "feed-stock" | "feed-bag-stock",
  date: string
): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${registerType}/${date}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

  const { error } = await getClient().storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);

  const { data } = getClient().storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
