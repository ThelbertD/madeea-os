#!/usr/bin/env node
/**
 * Smoke tests against a real production server.
 *
 *   npm run smoke              # builds must already exist (.next)
 *
 * Starts `next start` on a spare port, waits for it to bind, exercises the
 * routes whose failure would make the app useless, then shuts down. Exit code 0
 * means every check passed.
 *
 * No test framework on purpose. The repo has no test runner and no test
 * dependencies; adding vitest to assert "does the server answer" would mean a
 * dependency tree and a config file for something Node can already do. If real
 * unit tests arrive later they can bring their own runner — this stays the
 * end-to-end gate.
 *
 * What is deliberately NOT asserted: anything needing the OmniRoute gateway, a
 * Supabase session, or a CLI on PATH. Those depend on a machine and network CI
 * does not have, so asserting them would produce a suite that fails for reasons
 * unrelated to the commit. The checks here are the ones that are true of a
 * correct build anywhere.
 */
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const PORT = Number(process.env.SMOKE_PORT || 3311);
const BASE = `http://127.0.0.1:${PORT}`;
const BOOT_TIMEOUT_MS = 120_000;

if (!existsSync(join(root, ".next", "BUILD_ID"))) {
  console.error("[smoke] no .next build found — run `npm run build` first");
  process.exit(1);
}

const server = spawn(
  process.execPath,
  [join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(PORT)],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);

let serverOutput = "";
server.stdout.on("data", (b) => { serverOutput += b.toString(); });
server.stderr.on("data", (b) => { serverOutput += b.toString(); });

function shutdown() {
  try { server.kill("SIGTERM"); } catch { /* already gone */ }
}
process.on("exit", shutdown);
process.on("SIGINT", () => { shutdown(); process.exit(130); });

async function waitForBoot() {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`server exited early with code ${server.exitCode}\n${serverOutput}`);
    }
    try {
      const r = await fetch(BASE + "/", { signal: AbortSignal.timeout(4000) });
      if (r.status > 0) return;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`server did not bind ${BASE} within ${BOOT_TIMEOUT_MS}ms\n${serverOutput}`);
}

/* A check returns null when it passes, or a string saying what went wrong.
 * Status codes are asserted as a SET, not a single value: several of these
 * routes legitimately answer 200 or an error depending on whether a local
 * service is running, and pinning them to 200 would make the suite fail on a
 * machine that simply has no gateway. What is being tested is that the route
 * exists and returns a considered response rather than crashing. */
const checks = [
  {
    name: "home page renders",
    run: async () => {
      const r = await fetch(BASE + "/", { signal: AbortSignal.timeout(30_000) });
      if (r.status !== 200) return `expected 200, got ${r.status}`;
      const html = await r.text();
      if (!/<html/i.test(html)) return "response was not HTML";
      return null;
    },
  },
  {
    name: "settings page renders",
    run: async () => {
      const r = await fetch(BASE + "/settings", { signal: AbortSignal.timeout(30_000) });
      return r.status === 200 ? null : `expected 200, got ${r.status}`;
    },
  },
  {
    name: "gateway status route answers as JSON",
    run: async () => {
      const r = await fetch(BASE + "/api/omniroute/status", { signal: AbortSignal.timeout(30_000) });
      if (r.status !== 200) return `expected 200, got ${r.status}`;
      const j = await r.json().catch(() => null);
      // `running` is false without a gateway, which is a correct answer here.
      if (!j || typeof j.running !== "boolean") return "no boolean `running` in the response";
      return null;
    },
  },
  {
    name: "workspace route answers",
    run: async () => {
      const r = await fetch(BASE + "/api/omniroute/workspace", { signal: AbortSignal.timeout(30_000) });
      if (r.status !== 200) return `expected 200, got ${r.status}`;
      const j = await r.json().catch(() => null);
      if (!j || !Array.isArray(j.builds)) return "no `builds` array in the response";
      return null;
    },
  },
  {
    name: "chat rejects an empty body instead of crashing",
    run: async () => {
      const r = await fetch(BASE + "/api/omniroute/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(30_000),
      });
      // 400 is the documented answer for a missing `messages`. A 500 would mean
      // the handler threw on bad input, which is the bug this check exists for.
      if (r.status !== 400) return `expected 400 for an empty body, got ${r.status}`;
      return null;
    },
  },
  {
    name: "unknown API path does not 500",
    run: async () => {
      const r = await fetch(BASE + "/api/definitely-not-a-route", { signal: AbortSignal.timeout(30_000) });
      return r.status === 500 ? "unknown path returned 500" : null;
    },
  },
];

const failures = [];
try {
  process.stdout.write(`[smoke] starting server on ${BASE}\n`);
  await waitForBoot();
  process.stdout.write("[smoke] server up\n");

  for (const check of checks) {
    let result;
    try {
      result = await check.run();
    } catch (e) {
      result = `threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (result) {
      failures.push(`${check.name} — ${result}`);
      process.stdout.write(`  FAIL  ${check.name}: ${result}\n`);
    } else {
      process.stdout.write(`  ok    ${check.name}\n`);
    }
  }
} catch (e) {
  failures.push(`server never became usable — ${e instanceof Error ? e.message : String(e)}`);
  process.stdout.write(`  FAIL  ${failures[failures.length - 1]}\n`);
} finally {
  shutdown();
}

if (failures.length) {
  process.stdout.write(`\n[smoke] ${failures.length} of ${checks.length} checks failed\n`);
  process.exit(1);
}
process.stdout.write(`\n[smoke] all ${checks.length} checks passed\n`);
process.exit(0);
