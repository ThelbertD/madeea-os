/* Request-scoped Supabase client for route handlers.
 *
 * The browser already holds a session (see supabaseClient.ts / LoginGate). Route
 * handlers have no session of their own, so the caller forwards its access token
 * as `Authorization: Bearer <token>` and this builds a client that carries it.
 *
 * Why the anon key and not a service-role key: the service-role key bypasses RLS
 * entirely, so a single missing user_id check anywhere would expose every user's
 * rows. Passing the caller's own token instead means Postgres evaluates auth.uid()
 * per statement and the RLS policies in supabase/migrations are actually load-
 * bearing. It also keeps a bypass-everything secret out of the deployment.
 *
 * Returns null when Supabase is unconfigured or the request is unauthenticated —
 * callers treat that as "fall back to the on-disk store" rather than an error, so
 * a local, signed-out session keeps working exactly as it did before.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function serverSupabase(req: Request): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const authorization = req.headers.get("authorization");
  if (!authorization || !/^Bearer\s+\S+/i.test(authorization)) return null;

  return createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    // A route handler is stateless: never write a session to disk, and never
    // start a refresh timer that would outlive the request.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** The signed-in user's id, or null if the token is absent/expired/invalid. */
export async function currentUserId(sb: SupabaseClient): Promise<string | null> {
  const { data, error } = await sb.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}
