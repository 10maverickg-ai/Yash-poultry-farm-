import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  outputFileTracingIncludes: {
    "/*": [
      "node_modules/@img/sharp-linux-x64/**",
      "node_modules/@img/sharp-libvips-linux-x64/**",
    ],
  },
};

export default nextConfig;
