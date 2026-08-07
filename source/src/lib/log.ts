/* Application logging.
 *
 * There was none: an audit of src/ found zero console.log/error/warn calls and
 * no logging library, so a failure in production left nothing behind to read.
 * That is what this fixes — it is not an observability platform, just a way for
 * a server-side failure to leave a trace.
 *
 * One line of JSON per event, on stdout/stderr. JSON rather than prose because
 * the launchers already redirect output to a file (see start-backend.cmd), and
 * a file of JSON lines can be grepped and parsed later; prose cannot.
 *
 * No dependency. A logging library here would mean pulling pino or winston into
 * a build that already has to be memory-tuned to finish, for a formatter that
 * fits in twenty lines.
 *
 * LOG_LEVEL=debug|info|warn|error, default info.
 */

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  return ORDER[raw as Level] ?? ORDER.info;
}

/* Values that must never reach a log file. Keys are matched case-insensitively
 * and by substring, so `OPENAI_API_KEY`, `apiKey` and `authorization` all match.
 * Logs get pasted into issues and shared with support; a key that leaks through
 * one is as exposed as one in a screenshot. */
const SECRET_KEY = /(key|token|secret|password|authorization|cookie|bearer)/i;

function redact(value: unknown, depth = 0): unknown {
  if (value == null || depth > 4) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (ORDER[level] < threshold()) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  });
  // Errors and warnings to stderr so the launchers' *.err.log captures them
  // separately from ordinary traffic.
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};

/** Error -> plain fields. `unknown` because catch bindings are not typed. */
export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      error: err.name,
      message: err.message,
      // Truncated: a full Next.js stack is dozens of frames of framework
      // internals, which buries the useful first lines in a log file.
      stack: err.stack?.split("\n").slice(0, 6).join("\n"),
    };
  }
  return { error: "NonError", message: String(err).slice(0, 300) };
}
