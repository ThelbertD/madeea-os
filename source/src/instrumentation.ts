/* Server error reporting.
 *
 * 107 of the 246 route handlers have no try/catch. Wrapping each one would be a
 * 107-file change that cannot be verified route by route; onRequestError is a
 * single hook Next.js calls for every server error it captures, so one file
 * covers all of them — including the ones nobody has written yet.
 *
 * This does not replace per-route handling. A route that can fail in an
 * expected way should still catch it and return something useful. This is the
 * net under the ones that do not, so an unhandled failure leaves a record
 * instead of an empty 500.
 *
 * Concretely: the Codex outage earlier surfaced as a 500 with an empty body,
 * because the route streams NDJSON and the throw happened before the stream
 * opened. The reason ("codex is not installed or not configured") existed only
 * in a console nobody was capturing. With this, it lands in the error log with
 * the route attached.
 *
 * Docs: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md
 */
import type { Instrumentation } from "next";
import { log, errorFields } from "@/lib/log";

/* Environment validation, at boot.
 *
 * 82 variables are read across the codebase and only two are required, but a
 * missing one used to surface as a broken screen on whichever request happened
 * to need it — the sign-in card simply reporting no project configured, with
 * nothing said at startup. This makes the server refuse to start instead, and
 * name what is missing.
 *
 * Fatal ONLY when actually serving. `next build` also runs this file, and CI
 * builds with no .env.local at all — throwing there would fail the pipeline for
 * a variable the build does not need. Phases come from
 * node_modules/next/dist/shared/lib/constants.js. */
const REQUIRED: { name: string; why: string }[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", why: "sign-in; the dashboard is gated behind it" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", why: "sign-in; the dashboard is gated behind it" },
];

export function register() {
  const phase = process.env.NEXT_PHASE ?? "";
  const serving = phase === "phase-production-server" || phase === "phase-development-server" || phase === "";

  const missing = REQUIRED.filter(({ name }) => !process.env[name]?.trim());

  if (!missing.length) {
    log.info("environment ok", { required: REQUIRED.length, phase: phase || "(unset)" });
    return;
  }

  const detail = missing.map((m) => `  ${m.name} — needed for ${m.why}`).join("\n");
  const message =
    `Missing required environment variable${missing.length > 1 ? "s" : ""}:\n${detail}\n\n` +
    `Copy source/.env.example to source/.env.local and fill these in. ` +
    `Values come from your Supabase project under Settings -> API.`;

  if (!serving) {
    // A build does not need these; say so once and carry on.
    log.warn("environment incomplete (not fatal during build)", {
      phase,
      missing: missing.map((m) => m.name),
    });
    return;
  }

  log.error("environment invalid — refusing to start", { missing: missing.map((m) => m.name) });
  process.stderr.write("\n" + message + "\n\n");

  /* Exit rather than throw. Throwing from here does NOT stop the server:
   * Next catches it, reports "Failed to prepare server", then keeps the port
   * open and answers every request with a 500. Verified — a server started
   * without these bound its port and served 500s rather than stopping.
   *
   * A process that is listening but broken is the worst of both: a supervisor
   * sees a healthy port, and the operator sees 500s with the reason scrolled
   * off in a log. Exiting non-zero means the port never opens and the launcher
   * records a failure. */
  process.exit(1);
}

export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  log.error("unhandled server error", {
    ...errorFields(err),
    path: request.path,
    method: request.method,
    // Which file threw, and whether it was a route handler, a render or an
    // action — the three fail very differently and the path alone does not say.
    routePath: context.routePath,
    routeType: context.routeType,
    // Headers are deliberately omitted: they carry cookies and Authorization,
    // and the logger would only redact the ones whose names it recognises.
  });
};
