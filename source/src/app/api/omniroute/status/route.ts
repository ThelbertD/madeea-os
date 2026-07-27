import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/omniroute/status — is OmniRoute running locally?
// OmniRoute serves a dashboard on :20128 and an OpenAI-compatible API at /v1.
// We probe /v1/models (fast, unauthenticated list on most builds) and fall back
// to the dashboard root, so the section can show a live green/red state.

// Honour OMNIROUTE_BASE_URL like the rest of the app (src/lib/omniroute.ts),
// and default to 127.0.0.1 rather than localhost: on Windows the name costs
// ~200ms to resolve against ~5ms for the literal address, because it tries
// IPv6 first and falls back.
const BASE = (process.env.OMNIROUTE_BASE_URL || "http://127.0.0.1:20128").replace(/\/+$/, "");

// 1500ms was too tight — a cold gateway took 6s here and the tab reported
// "offline" while curl against the same URL returned 200.
async function ping(path: string, ms = 6000): Promise<number | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(BASE + path, { signal: ctrl.signal, cache: "no-store" });
    return r.status;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function GET() {
  // Try the API first, then the dashboard.
  const api = await ping("/v1/models");
  const dash = api == null ? await ping("/") : 200;
  const running = api != null || dash != null;

  let models: number | null = null;
  if (api === 200) {
    try {
      const r = await fetch(BASE + "/v1/models", { cache: "no-store" });
      const j = await r.json().catch(() => null);
      const arr = j?.data ?? j?.models ?? [];
      if (Array.isArray(arr)) models = arr.length;
    } catch {
      /* ignore */
    }
  }

  return NextResponse.json({
    running,
    base: BASE,
    api: `${BASE}/v1`,
    dashboard: BASE,
    apiStatus: api,
    models,
  });
}
