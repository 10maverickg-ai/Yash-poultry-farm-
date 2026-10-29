import type { NextConfig } from "next";

// A different value for every build: the service worker names its cache after it, and the "Updated" note compares it (not a secret).
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 12) || Date.now().toString(36);

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  experimental: {
    serverActions: {
      // Defense-in-depth only — the real fix is client-side compression in
      // components/UploadForm.tsx, which keeps every upload well under this
      // regardless of the original photo's size. This just gives headroom
      // for anything the compression step doesn't catch (e.g. JS disabled).
      bodySizeLimit: "8mb",
    },
  },
  // sharp (lib/extraction/readerV2/crop.ts's region-cropping) ships its
  // actual native code in separate @img/sharp-<platform>* optional
  // dependencies, not inside the `sharp` package folder itself. Observed
  // on the Vercel preview: sharp's own JS loaded fine but then threw
  // "ERR_DLOPEN_FAILED: libvips-cpp.so... cannot open shared object file"
  // — Next's automatic output-file-tracing didn't pick up those
  // sibling packages' real .so/.node files for the serverless function
  // bundle, even though npm installed them correctly (confirmed in
  // package-lock.json). serverExternalPackages keeps sharp itself from
  // being bundled by Next (so it's `require()`d from node_modules at
  // runtime, same as any native addon needs); outputFileTracingIncludes
  // then makes sure the binaries sharp's require() actually reaches for
  // are copied into the deployed function regardless of what the
  // automatic trace found. See lib/extraction/readerV2/sharpLoader.ts for
  // the matching runtime fallback — this app must never 500 an upload
  // just because sharp failed to load in a given deployment.
  serverExternalPackages: ["sharp"],
  // Basic browser-side safety (V12 N9): no content-type guessing, no sending the full address to other sites, and the app cannot be
  // shown inside another site's frame.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
  outputFileTracingIncludes: {
    "/*": [
      "node_modules/@img/sharp-linux-x64/**",
      "node_modules/@img/sharp-libvips-linux-x64/**",
    ],
  },
};

export default nextConfig;
