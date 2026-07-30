// Fleet supervisor — starts, stops and tails the external agent processes that
// live alongside this OS (OpenClaw, OmniRoute, Open Design, the video tools…).
//
// Nothing else in the app manages long-running child processes, so this is the
// one place that owns them. Registry defaults live in code; user edits persist
// to ~/.agentic-os/fleet.json so an update can't overwrite your paths.

import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const CONFIG_FILE = path.join(os.homedir(), ".agentic-os", "fleet.json");
const MAX_LOG_LINES = 500;
const IS_WIN = process.platform === "win32";

const home = (...parts: string[]) => path.join(os.homedir(), ...parts);

export type FleetStatus = "online" | "starting" | "offline" | "error";

export interface FleetAgent {
  id: string;
  name: string;
  tagline: string;
  /** Lucide icon name, resolved client-side. */
  icon: string;
  accent: string;
  cwd: string;
  command: string;
  url?: string;
  healthUrl?: string;
  enabled: boolean;
}

const DEFAULT_AGENTS: FleetAgent[] = [
  {
    id: "openclaw",
    name: "OpenClaw",
    tagline: "Autonomous operator",
    icon: "Bot",
    accent: "#f472b6",
    cwd: home("openclaw"),
    command: "npm run start",
    url: "http://localhost:3002",
    healthUrl: "http://localhost:3002",
    enabled: true,
  },
  {
    id: "omniroute",
    name: "OmniRoute",
    tagline: "Model router",
    icon: "Route",
    accent: "#2dd4bf",
    cwd: home("omniroute"),
    command: "npm run dev",
    url: "http://localhost:8787",
    healthUrl: "http://localhost:8787/health",
    enabled: true,
  },
  {
    id: "open-design",
    name: "Open Design",
    tagline: "Interface studio",
    icon: "Palette",
    accent: "#e879f9",
    cwd: home("open-design"),
    command: "npm run dev",
    url: "http://localhost:5173",
    healthUrl: "http://localhost:5173",
    enabled: true,
  },
  {
    id: "openseo",
    name: "OpenSEO",
    tagline: "Self-hosted SEO suite",
    icon: "TrendingUp",
    accent: "#a3e635",
    cwd: home("open-seo"),
    command: "docker compose up -d",
    url: "http://localhost:3001",
    healthUrl: "http://localhost:3001",
    enabled: true,
  },
  {
    id: "seo-office",
    name: "SEO Office",
    tagline: "Agency OS",
    icon: "Building2",
    accent: "#38bdf8",
    cwd: home("seo-office"),
    command: "pnpm dev",
    url: "http://localhost:3000/office",
    healthUrl: "http://localhost:3000/office",
    enabled: true,
  },
  {
    id: "video-use",
    name: "Video Editor",
    tagline: "Conversational cuts",
    icon: "Scissors",
    accent: "#f59e0b",
    cwd: home("Developer", "video-use"),
    command: "npm run dev",
    url: "http://localhost:5182",
    enabled: true,
  },
];

/* ------------------------------------------------------------------ */
/* Registry persistence                                                */
/* ------------------------------------------------------------------ */

interface FleetConfig {
  agents?: Partial<FleetAgent>[];
}

async function loadConfig(): Promise<FleetConfig> {
  try {
    return JSON.parse(await readFile(CONFIG_FILE, "utf8")) as FleetConfig;
  } catch {
    return {};
  }
}

/** Saved values win for the fields you edit; copy keeps tracking the defaults. */
export async function getAgents(): Promise<FleetAgent[]> {
  const cfg = await loadConfig();
  const saved = new Map((cfg.agents ?? []).map((a) => [a.id, a]));
  const merged = DEFAULT_AGENTS.map((def) => {
    const s = saved.get(def.id);
    saved.delete(def.id);
    return s
      ? {
          ...def,
          cwd: s.cwd ?? def.cwd,
          command: s.command ?? def.command,
          url: s.url ?? def.url,
          healthUrl: s.healthUrl ?? def.healthUrl,
          enabled: s.enabled ?? def.enabled,
        }
      : def;
  });
  // Anything you added yourself.
  for (const custom of saved.values()) {
    if (custom.id && custom.name && custom.command) merged.push(custom as FleetAgent);
  }
  return merged;
}

export async function saveAgents(agents: FleetAgent[]): Promise<FleetAgent[]> {
  await mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  const tmp = `${CONFIG_FILE}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify({ agents }, null, 2), "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(tmp, CONFIG_FILE);
  return getAgents();
}

export async function getAgent(id: string): Promise<FleetAgent | undefined> {
  return (await getAgents()).find((a) => a.id === id);
}

export async function dirExists(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Process supervision                                                 */
/* ------------------------------------------------------------------ */

interface Managed {
  id: string;
  child: ChildProcess;
  startedAt: number;
  logs: { at: number; stream: "out" | "err" | "sys"; text: string }[];
  lastExit?: { code: number | null; signal: string | null; at: number };
}

// Kept on globalThis so Next's dev-mode hot reload can't orphan a running
// child process on every file save.
const g = globalThis as unknown as {
  __fleet?: { procs: Map<string, Managed> };
};
const state = (g.__fleet ??= { procs: new Map() });

function pushLog(p: Managed, stream: "out" | "err" | "sys", chunk: string) {
  for (const line of chunk.split(/\r?\n/)) {
    if (line.trim()) p.logs.push({ at: Date.now(), stream, text: line });
  }
  if (p.logs.length > MAX_LOG_LINES) {
    p.logs.splice(0, p.logs.length - MAX_LOG_LINES);
  }
}

export function isRunning(id: string): boolean {
  const p = state.procs.get(id);
  return !!p && p.child.exitCode === null && !p.child.killed;
}

export function startAgent(
  agent: FleetAgent,
): { ok: true; pid?: number } | { ok: false; error: string } {
  if (!agent.command?.trim()) {
    return { ok: false, error: `${agent.name} has no start command.` };
  }
  if (isRunning(agent.id)) {
    return { ok: true, pid: state.procs.get(agent.id)!.child.pid };
  }

  let child: ChildProcess;
  try {
    child = spawn(agent.command, {
      cwd: agent.cwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const proc: Managed = {
    id: agent.id,
    child,
    startedAt: Date.now(),
    logs: [],
  };
  state.procs.set(agent.id, proc);
  pushLog(proc, "sys", `$ ${agent.command}   (in ${agent.cwd})`);

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (d: string) => pushLog(proc, "out", d));
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (d: string) => pushLog(proc, "err", d));
  child.on("error", (err) => pushLog(proc, "err", `spawn failed: ${err.message}`));
  child.on("close", (code, signal) => {
    proc.lastExit = { code, signal, at: Date.now() };
    pushLog(proc, "sys", `process exited (code ${code ?? "—"})`);
  });

  return { ok: true, pid: child.pid };
}

export function stopAgent(id: string): { ok: boolean; error?: string } {
  const proc = state.procs.get(id);
  if (!proc || proc.child.exitCode !== null) {
    return { ok: false, error: "not running" };
  }
  const pid = proc.child.pid;
  if (pid == null) return { ok: false, error: "no pid" };

  if (IS_WIN) {
    // `shell: true` means our direct child is cmd.exe and the dev server hangs
    // off it — a plain kill() would leave the real process running.
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }).on(
      "error",
      () => proc.child.kill("SIGKILL"),
    );
  } else {
    proc.child.kill("SIGTERM");
    setTimeout(() => {
      if (proc.child.exitCode === null) proc.child.kill("SIGKILL");
    }, 4000).unref?.();
  }
  pushLog(proc, "sys", "stop requested");
  return { ok: true };
}

export type LogLine = { at: number; stream: "out" | "err" | "sys"; text: string };

export function getLogs(id: string, since = 0): LogLine[] {
  const logs: LogLine[] = state.procs.get(id)?.logs ?? [];
  return logs.filter((l) => l.at > since);
}

export interface FleetRuntime {
  status: FleetStatus;
  pid?: number;
  startedAt?: number;
  lastExit?: { code: number | null; signal: string | null; at: number };
  logLines: number;
}

export function getRuntime(id: string): FleetRuntime {
  const proc = state.procs.get(id);
  const exit = proc?.lastExit;
  let status: FleetStatus;

  if (isRunning(id)) {
    // Give a freshly spawned process a moment before calling it healthy.
    status = Date.now() - (proc?.startedAt ?? 0) < 2500 ? "starting" : "online";
  } else if (exit) {
    status = exit.code === 0 || exit.signal ? "offline" : "error";
  } else {
    status = "offline";
  }

  return {
    status,
    pid: isRunning(id) ? proc?.child.pid : undefined,
    startedAt: isRunning(id) ? proc?.startedAt : undefined,
    lastExit: exit,
    logLines: proc?.logs.length ?? 0,
  };
}

/** Is something actually answering on the agent's port? */
export async function probeHealth(url?: string): Promise<boolean> {
  if (!url) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
