"use client";

/* Login gate.
 *
 * Wraps the whole dashboard: no session, no app. Supabase auth runs entirely in
 * the browser, which is what lets it work on the static export as well as the
 * local dev server.
 *
 * What this does and does not do, plainly: it gates the UI. On a static host the
 * published files — the memory snapshot, the agent briefs, the JS — are still
 * fetchable by URL, because a static host has no server to check a token before
 * serving a file. Treat this as "who gets to use the dashboard", not "who can
 * read the data". Anything that genuinely needs protecting belongs in Supabase
 * behind Row Level Security, or behind Vercel Deployment Protection.
 */
import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { KeyRound, Loader2, Mail } from "lucide-react";
import { getSupabase, readConfig, redirectTo } from "@/lib/supabaseClient";

const ACCENT = "#fd5812";

type Mode = "password" | "magic";

export default function LoginGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | undefined;

    // Whatever happens below, stop showing the spinner. getSession() against an
    // unreachable project neither resolves nor rejects promptly, and a rejected
    // promise here used to leave the entire dashboard on a spinner with no way
    // forward — the app looked dead rather than signed out.
    const done = (s: Session | null) => { if (alive) { setSession(s); setReady(true); } };
    const timer = setTimeout(() => { if (alive) setReady(true); }, 6000);

    try {
      setConfigured(!!readConfig());
      const sb = getSupabase();
      if (!sb) { setReady(true); return; }
      sb.auth.getSession()
        .then(({ data }) => done(data.session))
        .catch(() => done(null));
      const { data: sub } = sb.auth.onAuthStateChange((_e, s) => { if (alive) setSession(s); });
      unsub = () => sub.subscription.unsubscribe();
    } catch {
      setReady(true);   // a malformed URL makes createClient throw
    }

    return () => { alive = false; clearTimeout(timer); unsub?.(); };
  }, []);

  if (!ready) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <Loader2 size={18} className="animate-spin" style={{ color: ACCENT }} />
      </div>
    );
  }

  if (!session) return <SignInCard configured={configured} />;

  // No account bar above the app. The email and sign-out that used to sit here
  // are on the Settings page, which is reachable from the sidebar — one place
  // for account actions rather than a strip on top of every screen.
  return <>{children}</>;
}

/* ── sign in ────────────────────────────────────────────────────────── */

function SignInCard({ configured }: { configured: boolean }) {
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) {
      setErr(
        "This build has no Supabase project. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY and redeploy, or open this page once with " +
        "?sbUrl=https://xxxx.supabase.co&sbKey=YOUR_ANON_KEY to set it for this browser.",
      );
      return;
    }
    setBusy(true); setErr(null); setSent(false);
    try {
      if (mode === "password") {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { error } = await sb.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: redirectTo() },
        });
        if (error) throw error;
        setSent(true);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }, [mode, email, password]);

  return (
    <Card title="Sign in to MadeEA OS" icon={<KeyRound size={14} />}>
      <div className="flex gap-2">
        {(["password", "magic"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setErr(null); setSent(false); }}
            className="rounded-full border px-3 py-1.5 text-[11px]"
            style={{
              borderColor: mode === m ? `${ACCENT}66` : "var(--line-soft)",
              background: mode === m ? `${ACCENT}14` : "transparent",
              color: mode === m ? "var(--cream)" : "var(--cream-mute)",
            }}
          >
            {m === "password" ? "Password" : "Magic link"}
          </button>
        ))}
      </div>

      <Field label="Email" value={email} onChange={setEmail} placeholder="you@example.com" type="email" />
      {mode === "password" && (
        <Field label="Password" value={password} onChange={setPassword} placeholder="••••••••" type="password"
               onEnter={() => void submit()} />
      )}

      {err && <div className="text-[11.5px]" style={{ color: ACCENT }}>{err}</div>}
      {sent && (
        <div className="text-[11.5px]" style={{ color: "#4ade80" }}>
          Check your email — the link brings you back here signed in.
        </div>
      )}

      <Button onClick={() => void submit()} busy={busy}
              label={mode === "password" ? "Sign in" : "Send magic link"}
              icon={mode === "password" ? <KeyRound size={13} /> : <Mail size={13} />} />

      <p className="text-[10.5px] text-[var(--cream-mute)] leading-relaxed">
        There is no sign-up here on purpose. Add people in the Supabase dashboard
        (Authentication → Users), and leave public sign-ups disabled so the URL
        alone is not an invitation.
      </p>
      {!configured && (
        <div className="text-[10.5px] leading-relaxed" style={{ color: ACCENT }}>
          No Supabase project is configured for this build, so sign-in will fail until one is set.
        </div>
      )}
    </Card>
  );
}


/* ── bits ───────────────────────────────────────────────────────────── */

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-[70vh] grid place-items-center px-5">
      <div className="w-full max-w-[420px] rounded-xl border p-6 flex flex-col gap-3.5"
           style={{ borderColor: "var(--line-soft)", background: "var(--bg-card)" }}>
        <div className="flex items-center gap-2 text-[13px] text-[var(--cream)]">
          <span style={{ color: ACCENT }}>{icon}</span>{title}
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", onEnter }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; onEnter?: () => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--cream-mute)] font-semibold">{label}</span>
      <input
        type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); } }}
        className="bg-transparent border rounded-md px-3 py-2.5 text-[12.5px] outline-none"
        style={{ borderColor: "var(--line-soft)", color: "var(--cream)" }}
      />
    </label>
  );
}

function Button({ onClick, label, busy, icon }: {
  onClick: () => void; label: string; busy?: boolean; icon?: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={busy}
            className="rounded-md px-3.5 py-2.5 text-[12px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40"
            style={{ background: `${ACCENT}22`, color: ACCENT }}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : icon}{label}
    </button>
  );
}
