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
