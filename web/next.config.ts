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
};

export default nextConfig;
