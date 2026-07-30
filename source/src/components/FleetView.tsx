"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Route, Palette, TrendingUp, Building2, Scissors, Cpu,
  Play, Square, ExternalLink, Terminal, RefreshCw, AlertCircle,
  CheckCircle2, ChevronDown, Trash2,
} from "lucide-react";

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  Bot, Route, Palette, TrendingUp, Building2, Scissors, Cpu,
};

interface Runtime {
  status: "online" | "starting" | "offline" | "error";
  pid?: number;
  startedAt?: number;
  lastExit?: { code: number | null; signal: string | null; at: number };
  logLines: number;
}
interface Agent {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  accent: string;
  cwd: string;
  command: string;
  url?: string;
  healthUrl?: string;
  enabled: boolean;
  runtime: Runtime;
  linked: boolean;
  reachable?: boolean;
}

function fmtAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return `${Math.floor(d / 1000)}s`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  return `${Math.floor(d / 3_600_000)}h`;
}

export default function FleetView() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [openLogs, setOpenLogs] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(async (health = false) => {
    try {
      const r = await fetch(`/api/fleet?health=${health ? 1 : 0}`, { cache: "no-store" });
      if (r.ok) setAgents((await r.json()).agents ?? []);
    } catch {
      /* keep the last good list on screen */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    const fast = setInterval(() => void refresh(), 4000);
    const slow = setInterval(() => void refresh(true), 20_000);
    return () => { clearInterval(fast); clearInterval(slow); };
  }, [refresh]);

  const act = async (agent: Agent, action: "start" | "stop") => {
    setBusy(agent.id);
    try {
      const r = await fetch(`/api/fleet/${agent.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = await r.json();
      setNotice(
        r.ok && j.ok !== false
          ? { tone: "ok", text: `${agent.name} ${action === "start" ? "starting" : "stopped"}` }
          : { tone: "err", text: j.error ?? `Could not ${action} ${agent.name}` },
      );
    } catch (e) {
      setNotice({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy(null);
      await refresh(true);
    }
  };

  const online = agents.filter((a) => a.runtime.status === "online").length;

  return (
    <div className="space-y-5">
      {/* summary row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="pill pill-ok">{online} online</span>
        <span className="pill">{agents.length} agents</span>
        {agents.some((a) => !a.linked) && (
          <span className="pill pill-warn">
            {agents.filter((a) => !a.linked).length} not linked
          </span>
        )}
        <button
          onClick={() => void refresh(true)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12.5px] transition border-[var(--panel-border)] text-[var(--fg-dim)] hover:text-[var(--fg)] hover:border-[var(--panel-border-hot)]"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            onAnimationComplete={() => setTimeout(() => setNotice(null), 3500)}
            className="panel p-3 flex items-center gap-2 text-[12.5px]"
            style={{ color: notice.tone === "ok" ? "var(--emerald)" : "var(--plum)" }}
          >
            {notice.tone === "ok" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            {notice.text}
          </motion.div>
        )}
      </AnimatePresence>

      {loading && !agents.length && (
        <div className="panel p-6 text-[12.5px] text-[var(--fg-dim)]">Reading the fleet…</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {agents.map((agent) => {
          const Icon = ICONS[agent.icon] ?? Cpu;
          const running =
            agent.runtime.status === "online" || agent.runtime.status === "starting";
          return (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="panel panel-hover p-4 relative overflow-hidden"
            >
              <div
                className="pointer-events-none absolute -right-8 -top-8 w-32 h-32 rounded-full blur-3xl opacity-20"
                style={{ background: agent.accent }}
              />
              <div className="relative flex items-start gap-3">
                <span
                  className="shrink-0 grid place-items-center w-9 h-9 rounded-lg"
                  style={{ background: `${agent.accent}22`, color: agent.accent }}
                >
                  <Icon size={17} />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium" style={{ color: agent.accent }}>
                      {agent.name}
                    </span>
                    <span
                      className={
                        agent.runtime.status === "online"
                          ? "pill pill-ok"
                          : agent.runtime.status === "starting"
                            ? "pill pill-warn"
                            : agent.runtime.status === "error"
                              ? "pill pill-err"
                              : "pill"
                      }
                    >
                      {agent.runtime.status}
                    </span>
                    {!agent.linked && <span className="pill pill-warn">no folder</span>}
                  </div>
                  <div className="text-[11.5px] text-[var(--fg-dim)] mt-0.5">
                    {agent.tagline}
                  </div>
                  <div className="text-[10.5px] metric text-[var(--fg-dimmer)] mt-1 truncate">
                    {agent.command} · {agent.cwd}
                  </div>
                  <div className="text-[10.5px] metric text-[var(--fg-dimmer)] mt-0.5">
                    {running && agent.runtime.startedAt
                      ? `up ${fmtAgo(agent.runtime.startedAt)} · pid ${agent.runtime.pid ?? "—"}`
                      : agent.runtime.lastExit
                        ? `exit ${agent.runtime.lastExit.code ?? "—"} · ${fmtAgo(agent.runtime.lastExit.at)} ago`
                        : "never started here"}
                  </div>
                </div>
              </div>

              <div className="relative mt-3 flex items-center gap-2 flex-wrap">
                <button
                  disabled={busy === agent.id || (!agent.linked && !running)}
                  onClick={() => void act(agent, running ? "stop" : "start")}
                  className="flex items-center gap-1.5 px-3 h-[32px] rounded-lg text-[12px] transition disabled:opacity-50"
                  style={
                    running
                      ? {
                          background: "rgba(244,114,182,0.12)",
                          border: "1px solid rgba(244,114,182,0.4)",
                          color: "var(--plum)",
                        }
                      : {
                          background: `${agent.accent}22`,
                          border: `1px solid ${agent.accent}55`,
                          color: agent.accent,
                        }
                  }
                  title={running ? "Stop this agent" : agent.command}
                >
                  {running ? <Square size={12} /> : <Play size={12} />}
                  {running ? "Stop" : "Start"}
                </button>

                {agent.url && (
                  <a
                    href={agent.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 h-[32px] rounded-lg border text-[12px] transition border-[var(--panel-border)] text-[var(--fg-dim)] hover:text-[var(--fg)]"
                  >
                    <ExternalLink size={12} /> Open
                  </a>
                )}

                <button
                  onClick={() => setOpenLogs(openLogs === agent.id ? null : agent.id)}
                  className="flex items-center gap-1.5 px-3 h-[32px] rounded-lg border text-[12px] transition border-[var(--panel-border)] text-[var(--fg-dim)] hover:text-[var(--fg)]"
                >
                  <Terminal size={12} /> Logs
                  <ChevronDown
                    size={11}
                    style={{
                      transform: openLogs === agent.id ? "rotate(180deg)" : "none",
                      transition: "transform .2s",
                    }}
                  />
                </button>

                {agent.reachable != null && (
                  <span className="ml-auto text-[10.5px] metric text-[var(--fg-dimmer)]">
                    port {agent.reachable ? "answering" : "silent"}
                  </span>
                )}
              </div>

              <AnimatePresence>
                {openLogs === agent.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <LogTail agentId={agent.id} live={running} />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function LogTail({ agentId, live }: { agentId: string; live: boolean }) {
  const [lines, setLines] = useState<{ at: number; stream: string; text: string }[]>([]);
  const since = useRef(0);
  const box = useRef<HTMLPreElement>(null);

  useEffect(() => {
    since.current = 0;
    setLines([]);
  }, [agentId]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/fleet/${agentId}/logs?since=${since.current}`, {
          cache: "no-store",
        });
        if (!r.ok || cancelled) return;
        const j = await r.json();
        if (j.lines?.length) {
          since.current = j.lines[j.lines.length - 1].at;
          setLines((prev) => [...prev, ...j.lines].slice(-400));
        }
      } catch {
        /* the agent may simply not be running */
      }
    };
    void poll();
    // Tail fast while it's up, slowly once it has exited.
    const id = setInterval(poll, live ? 1200 : 6000);
    return () => { cancelled = true; clearInterval(id); };
  }, [agentId, live]);

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines]);

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">
          {lines.length} lines
        </span>
        <button
          onClick={() => { setLines([]); since.current = Date.now(); }}
          className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] hover:text-[var(--fg-dim)]"
        >
          <Trash2 size={10} /> Clear
        </button>
      </div>
      <pre
        ref={box}
        className="scroll bg-[rgba(0,0,0,0.45)] border border-[var(--panel-border)] rounded-lg p-2.5 max-h-[220px] overflow-auto text-[11px] leading-relaxed metric whitespace-pre-wrap"
      >
        {lines.length
          ? lines
              .map((l) => (l.stream === "sys" ? `— ${l.text}` : l.text))
              .join("\n")
          : live
            ? "running, no output yet…"
            : "not running — press Start to see its output here."}
      </pre>
    </div>
  );
}
