import type { NextConfig } from "next";
import path from "path";

/* The published site under ../app is a static export, and until now the recipe
 * for producing it lived nowhere — this config had never contained `output:
 * "export"` or the basePath the export is served under, so rebuilding it meant
 * guessing. Anyone regenerating the export silently shipped a different build.
 *
 * MADEEA_EXPORT=1 turns on the export settings. `npm run build:export` wraps
 * the whole procedure; see that script for why src/app/api has to move aside.
 *
 * Default (unset) is the normal server build — what `next dev` and `next start`
 * use, where the API routes exist and the app is fully featured. */
const isExport = process.env.MADEEA_EXPORT === "1";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Next 16 treats 127.0.0.1 as a cross-origin dev request and will not serve
  // it the dev assets, so the HMR socket fails and client components never
  // hydrate — pages render server-side and then just sit there, with no error
  // in the console to explain it. Only affects `next dev`; the export is fine.
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  ...(isExport
    ? {
        output: "export" as const,
        // Served from https://<host>/madeea-os/app/ — every asset URL is built
        // with this prefix, so a mismatch here yields a page that loads and
        // then 404s every chunk.
        basePath: process.env.BASE_PATH || "/madeea-os/app",
        // The export writes <route>/index.html, and the existing site is
        // served with trailing slashes (a bare /omniroute 308s to /omniroute/).
        trailingSlash: true,
        // No server means no image optimiser; without this the export refuses
        // to build the moment a next/image appears.
        images: { unoptimized: true },
        // Keep the export out of .next so a running `next start` — which serves
        // the real app from .next — is not swapped underneath itself mid-build.
        distDir: ".next-export",
      }
    : {}),
};

export default nextConfig;
