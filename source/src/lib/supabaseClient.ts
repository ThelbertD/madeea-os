"use client";

/* Supabase auth for the dashboard.
 *
 * Config resolution, in order:
 *   1. NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY at build time
 *   2. localStorage, set once from the login screen
 *
 * The second path exists because the published build is a static export: there
 * is no server to read an env var, and rebuilding the whole export just to
 * change a project URL is a poor trade. Both are read in the browser only.
 *
 * The anon key is designed to be public — it identifies the project, it does
 * not grant access. Row Level Security is what actually protects data, so any
 * table this app reads must have RLS enabled or the key is a skeleton key.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const LS_URL = "madeea.supabase.url";
const LS_KEY = "madeea.supabase.anonKey";

export interface SupabaseConfig { url: string; anonKey: string }

export function readConfig(): SupabaseConfig | null {
  const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const envKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (envUrl && envKey) return { url: envUrl, anonKey: envKey };
  if (typeof window === "undefined") return null;
  try {
    const url = localStorage.getItem(LS_URL);
    const anonKey = localStorage.getItem(LS_KEY);
    if (url && anonKey) return { url, anonKey };
  } catch { /* storage blocked — treat as unconfigured */ }
  return null;
}

export function saveConfig(cfg: SupabaseConfig): void {
  localStorage.setItem(LS_URL, cfg.url.replace(/\/+$/, ""));
  localStorage.setItem(LS_KEY, cfg.anonKey.trim());
  client = null; // force a rebuild against the new project
}

export function clearConfig(): void {
  localStorage.removeItem(LS_URL);
  localStorage.removeItem(LS_KEY);
  client = null;
}

/* The setup screen is gone — sign-in is the first thing anyone sees. A project
 * can still be pointed at without a rebuild by opening the page once with
 * ?sbUrl=…&sbKey=…, which is stripped from the address bar immediately so it is
 * not shared by copy-paste or leaked in a Referer header. */
if (typeof window !== "undefined") {
  try {
    const q = new URLSearchParams(window.location.search);
    const u = q.get("sbUrl");
    const k = q.get("sbKey");
    if (u && k) {
      localStorage.setItem(LS_URL, u.replace(/\/+$/, ""));
      localStorage.setItem(LS_KEY, k.trim());
      history.replaceState({}, "", window.location.pathname + window.location.hash);
    }
  } catch { /* storage or history blocked — fall through unconfigured */ }
}

let client: SupabaseClient | null = null;

/** Null when nothing is configured yet — callers show the setup step instead. */
export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  const cfg = readConfig();
  if (!cfg) return null;
  client = createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The static export is served from a path, not a route the SDK controls,
      // so let it read the hash itself after a magic-link redirect.
      detectSessionInUrl: true,
    },
  });
  return client;
}

/* Authorization header for calls to our own /api routes.
 *
 * Route handlers have no session of their own, so forwarding the access token is
 * what lets one act as the signed-in user and read/write that user's rows under
 * RLS (see lib/supabaseServer.ts). Resolves to {} when signed out or
 * unconfigured, which the routes treat as "use the local on-disk store" — so a
 * signed-out session degrades to the old behaviour instead of failing. */
export async function authHeaders(): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) return {};
  try {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/** Where a magic link should land. Keeps the basePath the export was built with. */
export function redirectTo(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin + window.location.pathname;
}
