import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Next 16 treats 127.0.0.1 as a cross-origin dev request and will not serve
  // it the dev assets, so the HMR socket fails and client components never
  // hydrate — pages render server-side and then just sit there, with no error
  // in the console to explain it. Only affects `next dev`; the export is fine.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
