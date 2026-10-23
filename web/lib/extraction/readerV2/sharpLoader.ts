import type Sharp from "sharp";

// Owner report, 2026-10-19, Vercel preview: `/admin/reader-benchmark` 500'd
// with "Failed to load external module sharp: ERR_DLOPEN_FAILED:
// libvips-cpp.so... cannot open shared object file". A STATIC top-level
// `import sharp from "sharp"` throws that dlopen failure the moment this
// module is loaded — before any of our own try/catch ever runs, since
// it happens while Next.js is resolving the route's own dependency graph.
// That's why it reached the user as a raw 500 instead of a friendly error.
//
// The fix: never import sharp statically anywhere in readerV2. Every call
// site awaits loadSharp() instead, which wraps a dynamic import() in a
// real try/catch — an ordinary, catchable rejection now, not a crash
// outside JS's own exception handling. See next.config.ts for the other
// half of the real fix (making sure the native binaries are actually
// present in the deployed function); this loader is the backstop for
// when they still aren't, in THIS or some future deployment — the reader
// switch must fail safely and fall back to the old reader, never 500 a
// real upload just because sharp couldn't load.
export class SharpUnavailableError extends Error {}

let cached: typeof Sharp | null = null;
let failed: string | null = null;

export async function loadSharp(): Promise<typeof Sharp> {
  if (cached) return cached;
  if (failed) throw new SharpUnavailableError(failed);

  try {
    const mod = await import("sharp");
    cached = (mod.default ?? mod) as typeof Sharp;
    return cached;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    failed = `sharp failed to load in this deployment: ${detail}`;
    console.error(`[readerV2] ${failed}`);
    throw new SharpUnavailableError(failed);
  }
}
