"use client";

/* D Express content agent.
 *
 * Replaces the old SEO Content Pipeline, which was the pack author's own 5-site
 * AIPB funnel — hard-coded to his repos and offers, and unusable for a client.
 * This is the `d-express-locksmith-content-agent` workflow instead: pick one of
 * the 14 agents and talk to it, or run the title -> article chain, with
 * everything produced kept in a library.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BrainCircuit, FileText, Library, Loader2, Send, Sparkles, Trash2, Wand2 } from "lucide-react";

const ACCENT = "#fd5812";

type Tab = "agents" | "titles" | "article" | "library";

interface Agent { id: string; name: string; description: string; chars: number }
interface Item {
  id: string; kind: string; keyword: string; title?: string; slug?: string;
  body: string; agentId?: string; createdAt: number; wordCount?: number;
}
interface Msg { role: "user" | "assistant"; content: string }

function fmtAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function DExpressView() {
  const [tab, setTab] = useState<Tab>("agents");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dexpress/agents", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setAgents(j.agents ?? []))
      .catch(() => setErr("Could not load the agents — is the pack installed under packs/?"));
  }, []);

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "agents", label: "Agents", icon: <BrainCircuit size={12} /> },
    { key: "titles", label: "Titles", icon: <Sparkles size={12} /> },
    { key: "article", label: "Article", icon: <FileText size={12} /> },
    { key: "library", label: "Library", icon: <Library size={12} /> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] transition"
            style={{
              borderColor: tab === t.key ? `${ACCENT}66` : "var(--line-soft)",
              background: tab === t.key ? `${ACCENT}14` : "transparent",
              color: tab === t.key ? "var(--cream)" : "var(--cream-mute)",
            }}
          >
            {t.icon}{t.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-[var(--cream-mute)]">
          {agents.length} agents · D Express Locksmith
        </span>
      </div>

      {err && (
        <div className="rounded-md border p-3 text-[12px]" style={{ borderColor: `${ACCENT}44`, color: "var(--cream-dim)" }}>
          {err}
        </div>
      )}

      {tab === "agents" && <AgentChat agents={agents} />}
      {tab === "titles" && <Titles onDone={() => setTab("library")} />}
      {tab === "article" && <Article />}
      {tab === "library" && <LibraryView />}
    </div>
  );
}

/* ── Agents ─────────────────────────────────────────────────────────── */

function AgentChat({ agents }: { agents: Agent[] }) {
  const [active, setActive] = useState<string>("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!active && agents.length) setActive(agents[0].id); }, [agents, active]);
  useEffect(() => { logRef.current?.scrollTo({ top: 9e9 }); }, [msgs]);
  useEffect(() => { setMsgs([]); }, [active]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy || !active) return;
    setInput("");
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs([...next, { role: "assistant", content: "" }]);
    setBusy(true);
    try {
      const r = await fetch("/api/dexpress/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: active, messages: next }),
      });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        setMsgs([...next, { role: "assistant", content: `⚠ ${j.error ?? "failed"}` }]);
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMsgs([...next, { role: "assistant", content: acc }]);
      }
      if (!acc.trim()) setMsgs([...next, { role: "assistant", content: "⚠ the model returned nothing" }]);
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: `⚠ ${String(e)}` }]);
    } finally { setBusy(false); }
  }, [input, busy, active, msgs]);

  const agent = agents.find((a) => a.id === active);

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(200px,260px) 1fr" }}>
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--line-soft)" }}>
        <div className="px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-[var(--cream-mute)] font-semibold border-b" style={{ borderColor: "var(--line-soft)" }}>
          Agents
        </div>
        <div className="max-h-[520px] overflow-y-auto">
          {agents.length === 0 && <div className="p-3 text-[11.5px] text-[var(--cream-mute)]">No agents found.</div>}
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => setActive(a.id)}
              className="w-full text-left px-3 py-2.5 border-b transition"
              style={{
                borderColor: "var(--line-soft)",
                background: active === a.id ? `${ACCENT}10` : "transparent",
              }}
            >
              <div className="text-[12px] text-[var(--cream)]">{a.name}</div>
              <div className="text-[10.5px] text-[var(--cream-mute)] line-clamp-2">{a.description}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border flex flex-col" style={{ borderColor: "var(--line-soft)", minHeight: 520 }}>
        <div className="px-3 py-2 border-b text-[12px] text-[var(--cream)]" style={{ borderColor: "var(--line-soft)" }}>
          {agent ? agent.name : "Pick an agent"}
          {agent && <span className="ml-2 text-[10.5px] text-[var(--cream-mute)]">{agent.description}</span>}
        </div>
        <div ref={logRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-3" style={{ maxHeight: 420 }}>
          {msgs.length === 0 && (
            <div className="text-[11.5px] text-[var(--cream-mute)]">
              Ask this agent anything. It already knows the client — services, service area, differentiators.
            </div>
          )}
          {msgs.map((m, i) => (
            <div
              key={i}
              className="rounded-md px-3 py-2 text-[12px] whitespace-pre-wrap leading-relaxed"
              style={{
                background: m.role === "user" ? "var(--bg-elev)" : `${ACCENT}0d`,
                color: m.role === "user" ? "var(--cream-dim)" : "var(--cream)",
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "88%",
              }}
            >
              {m.content || <Loader2 size={12} className="animate-spin" />}
            </div>
          ))}
        </div>
        <div className="p-2.5 border-t flex items-center gap-2" style={{ borderColor: "var(--line-soft)" }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder="Message this agent…"
            className="flex-1 bg-transparent border rounded-md px-2.5 py-2 text-[12px] outline-none"
            style={{ borderColor: "var(--line-soft)", color: "var(--cream)" }}
          />
          <button
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            className="rounded-md px-3 py-2 text-[11.5px] font-semibold flex items-center gap-1.5 disabled:opacity-40"
            style={{ background: `${ACCENT}22`, color: ACCENT }}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}Send
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Titles ─────────────────────────────────────────────────────────── */

function Titles({ onDone }: { onDone: () => void }) {
  const [keywords, setKeywords] = useState("");
  const [titles, setTitles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null); setTitles([]);
    try {
      const j = await fetch("/api/dexpress/titles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, save: true }),
      }).then((r) => r.json());
      if (j.error) setError(j.error); else setTitles(j.titles ?? []);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border p-4 flex flex-col gap-3" style={{ borderColor: "var(--line-soft)" }}>
      <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--cream-mute)] font-semibold">
        Title generator · seo_optimizer
      </div>
      <input
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
        placeholder="lock rekeying Ambler PA, rekey after moving"
        className="bg-transparent border rounded-md px-3 py-2.5 text-[12.5px] outline-none"
        style={{ borderColor: "var(--line-soft)", color: "var(--cream)" }}
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => void run()}
          disabled={busy || !keywords.trim()}
          className="rounded-md px-3.5 py-2 text-[11.5px] font-semibold flex items-center gap-1.5 disabled:opacity-40"
          style={{ background: `${ACCENT}22`, color: ACCENT }}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}Generate 5 titles
        </button>
        {titles.length > 0 && (
          <button onClick={onDone} className="text-[11px] text-[var(--cream-mute)] hover:text-[var(--cream)]">
            saved to library →
          </button>
        )}
      </div>
      {error && <div className="text-[11.5px]" style={{ color: ACCENT }}>{error}</div>}
      {titles.map((t, i) => (
        <div key={i} className="rounded-md border px-3 py-2 text-[12px] text-[var(--cream)]" style={{ borderColor: "var(--line-soft)" }}>
          {t}
        </div>
      ))}
    </div>
  );
}

/* ── Article ────────────────────────────────────────────────────────── */

function Article() {
  const [title, setTitle] = useState("");
  const [keywords, setKeywords] = useState("");
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ wordCount: number; withinSpec: boolean; slug: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null); setResult(null);
    try {
      const j = await fetch("/api/dexpress/article", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, keywords, transcript }),
      }).then((r) => r.json());
      if (j.error) setError(j.error);
      else setResult({ wordCount: j.wordCount, withinSpec: j.withinSpec, slug: j.slug, body: j.item.body });
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(280px,420px) 1fr" }}>
      <div className="rounded-lg border p-4 flex flex-col gap-3" style={{ borderColor: "var(--line-soft)" }}>
        <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--cream-mute)] font-semibold">
          Article · blog_content_writer + seo_optimizer
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Post title"
          className="bg-transparent border rounded-md px-3 py-2.5 text-[12.5px] outline-none"
          style={{ borderColor: "var(--line-soft)", color: "var(--cream)" }} />
        <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="Primary keywords"
          className="bg-transparent border rounded-md px-3 py-2.5 text-[12.5px] outline-none"
          style={{ borderColor: "var(--line-soft)", color: "var(--cream)" }} />
        <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={6}
          placeholder="Optional transcript or notes to write from"
          className="bg-transparent border rounded-md px-3 py-2.5 text-[12px] outline-none resize-y"
          style={{ borderColor: "var(--line-soft)", color: "var(--cream)" }} />
        <button onClick={() => void run()} disabled={busy || !title.trim()}
          className="rounded-md px-3.5 py-2 text-[11.5px] font-semibold flex items-center gap-1.5 disabled:opacity-40"
          style={{ background: `${ACCENT}22`, color: ACCENT }}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
          {busy ? "Writing… (a minute or two)" : "Write the article"}
        </button>
        {error && <div className="text-[11.5px]" style={{ color: ACCENT }}>{error}</div>}
        {result && (
          <div className="text-[11px] text-[var(--cream-mute)]">
            {result.wordCount} words —{" "}
            <span style={{ color: result.withinSpec ? "#4ade80" : ACCENT }}>
              {result.withinSpec ? "within the 1500–1800 spec" : "outside the 1500–1800 spec"}
            </span>
            {" · "}{result.slug}.md
          </div>
        )}
      </div>
      <div className="rounded-lg border p-3 overflow-auto" style={{ borderColor: "var(--line-soft)", maxHeight: 560 }}>
        {result
          ? <pre className="text-[11px] text-[var(--cream-dim)] whitespace-pre-wrap leading-relaxed">{result.body}</pre>
          : <div className="text-[11.5px] text-[var(--cream-mute)]">The finished article appears here and is saved to the library.</div>}
      </div>
    </div>
  );
}

/* ── Library ────────────────────────────────────────────────────────── */

function LibraryView() {
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState<Item | null>(null);

  const load = useCallback(() => {
    fetch("/api/dexpress/library", { cache: "no-store" })
      .then((r) => r.json()).then((j) => setItems(j.items ?? [])).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function del(id: string) {
    await fetch(`/api/dexpress/library?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (open?.id === id) setOpen(null);
    load();
  }

  function download(i: Item) {
    const blob = new Blob([i.body], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${i.slug ?? i.id}.md`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(260px,380px) 1fr" }}>
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--line-soft)" }}>
        <div className="px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-[var(--cream-mute)] font-semibold border-b flex items-center justify-between" style={{ borderColor: "var(--line-soft)" }}>
          <span>Library · {items.length}</span>
          <button onClick={load} className="hover:text-[var(--cream)]">refresh</button>
        </div>
        <div className="max-h-[520px] overflow-y-auto">
          {items.length === 0 && <div className="p-3 text-[11.5px] text-[var(--cream-mute)]">Nothing generated yet.</div>}
          {items.map((i) => (
            <div key={i.id} className="px-3 py-2.5 border-b flex items-start gap-2" style={{ borderColor: "var(--line-soft)" }}>
              <button onClick={() => setOpen(i)} className="flex-1 text-left">
                <div className="text-[12px] text-[var(--cream)] truncate">{i.title ?? i.body.slice(0, 60)}</div>
                <div className="text-[10.5px] text-[var(--cream-mute)]">
                  {i.kind}{i.wordCount ? ` · ${i.wordCount} words` : ""} · {fmtAgo(i.createdAt)}
                </div>
              </button>
              <button onClick={() => void del(i.id)} title="delete" className="text-[var(--cream-mute)] hover:text-[var(--cream)] mt-0.5">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-lg border p-3 overflow-auto" style={{ borderColor: "var(--line-soft)", maxHeight: 560 }}>
        {open ? (
          <>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[12px] text-[var(--cream)]">{open.title ?? open.kind}</div>
              <button onClick={() => download(open)} className="text-[11px]" style={{ color: ACCENT }}>download .md</button>
            </div>
            <pre className="text-[11px] text-[var(--cream-dim)] whitespace-pre-wrap leading-relaxed">{open.body}</pre>
          </>
        ) : <div className="text-[11.5px] text-[var(--cream-mute)]">Pick something to read it.</div>}
      </div>
    </div>
  );
}
