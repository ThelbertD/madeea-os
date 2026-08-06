"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { UserRound, Upload, Trash2, KeyRound, LogOut, Loader2, Check, TriangleAlert, Mail, Users, UserPlus, Copy } from "lucide-react";
import { getSupabase } from "@/lib/supabaseClient";

const ACCENT = "#fd5812";
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB — an avatar renders at 96px; more is wasted bandwidth
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

type Note = { kind: "ok" | "err"; text: string } | null;

export default function SettingsView() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) { setReady(true); return; }
    let alive = true;
    sb.auth.getUser().then(({ data }) => { if (alive) { setUser(data.user); setReady(true); } });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => { if (alive) setUser(s?.user ?? null); });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  if (!ready) {
    return <div className="grid place-items-center py-20 text-[12px] text-[var(--cream-mute)]">
      <Loader2 size={16} className="animate-spin" />
    </div>;
  }

  return (
    <div className="mx-auto w-full max-w-[680px] px-5 py-8 flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <div className="text-[11px] mono uppercase tracking-[0.14em] text-[var(--cream-mute)]">Account</div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[var(--cream)]">Settings</h1>
        <p className="text-[12.5px] text-[var(--cream-mute)]">Your picture, your password, and the way out.</p>
      </header>

      <ProfileCard user={user} onUser={setUser} />
      <TeamCard user={user} />
      <PasswordCard user={user} />
      <SignOutCard />
    </div>
  );
}

/* ── profile picture ─────────────────────────────────────────────────── */

function ProfileCard({ user, onUser }: { user: User | null; onUser: (u: User | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const avatar = (user?.user_metadata?.avatar_url as string | undefined) || "";
  const email = user?.email ?? "";

  const pick = useCallback(async (file: File) => {
    const sb = getSupabase();
    if (!sb || !user) return;
    if (!ALLOWED.includes(file.type)) { setNote({ kind: "err", text: "Use a PNG, JPEG, WebP or GIF." }); return; }
    if (file.size > MAX_BYTES) { setNote({ kind: "err", text: "That image is over 2 MB. Try a smaller one." }); return; }

    setBusy(true); setNote(null);
    // Folder must be the uid: the storage policy checks the first path segment.
    // The timestamp busts both the CDN and <img> caches, which otherwise keep
    // showing the previous picture at an unchanged URL.
    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${user.id}/${Date.now()}.${ext}`;

    const up = await sb.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
    if (up.error) { setBusy(false); setNote({ kind: "err", text: up.error.message }); return; }

    const { data: pub } = sb.storage.from("avatars").getPublicUrl(path);
    const res = await sb.auth.updateUser({ data: { avatar_url: pub.publicUrl } });
    setBusy(false);
    if (res.error) { setNote({ kind: "err", text: res.error.message }); return; }
    onUser(res.data.user);
    setNote({ kind: "ok", text: "Picture updated." });
  }, [user, onUser]);

  const clear = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true); setNote(null);
    const res = await sb.auth.updateUser({ data: { avatar_url: null } });
    setBusy(false);
    if (res.error) { setNote({ kind: "err", text: res.error.message }); return; }
    onUser(res.data.user);
    setNote({ kind: "ok", text: "Picture removed." });
  }, [onUser]);

  return (
    <Card title="Profile picture" icon={<UserRound size={14} />}>
      <div className="flex items-center gap-4">
        <Avatar url={avatar} email={email} />
        <div className="flex flex-col gap-2 min-w-0">
          <div className="flex items-center gap-1.5 text-[12px] text-[var(--cream)] truncate">
            <Mail size={12} color="var(--cream-mute)" className="shrink-0" />
            <span className="mono truncate">{email || "not signed in"}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !user} onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] disabled:opacity-50"
              style={{ border: "1px solid var(--line-soft)", background: "rgba(255,255,255,0.03)", color: "var(--cream)" }}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              {avatar ? "Replace" : "Upload"}
            </button>
            {avatar && (
              <button type="button" disabled={busy} onClick={clear}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] disabled:opacity-50"
                style={{ border: "1px solid var(--line-soft)", color: "var(--cream-mute)" }}>
                <Trash2 size={12} /> Remove
              </button>
            )}
          </div>
          <p className="text-[11px] text-[var(--cream-mute)]">PNG, JPEG, WebP or GIF, up to 2 MB.</p>
        </div>
      </div>
      <input ref={fileRef} type="file" accept={ALLOWED.join(",")} className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />
      <Notice note={note} />
    </Card>
  );
}

/* Soft-edged, never a hard crop — the picture fades into the panel rather than
   ending on a drawn circle. */
function Avatar({ url, email }: { url: string; email: string }) {
  const letter = (email.trim()[0] || "?").toUpperCase();
  const fade = "radial-gradient(circle at 50% 50%, #000 58%, rgba(0,0,0,0.55) 78%, transparent 100%)";
  return (
    <div className="relative shrink-0" style={{ width: 76, height: 76 }}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" width={76} height={76}
          className="w-[76px] h-[76px] object-cover"
          style={{ WebkitMaskImage: fade, maskImage: fade }} />
      ) : (
        <div className="w-[76px] h-[76px] grid place-items-center text-[24px] font-semibold"
          style={{
            color: ACCENT,
            background: "radial-gradient(circle at 50% 45%, rgba(253,88,18,0.20), transparent 70%)",
            WebkitMaskImage: fade, maskImage: fade,
          }}>
          {letter}
        </div>
      )}
    </div>
  );
}

/* ── team ────────────────────────────────────────────────────────────── */

interface Member { user_id: string; email: string; role: string; joined_at: string }
interface Invite { id: string; email: string; token: string; created_at: string; accepted_at: string | null }

function TeamCard({ user }: { user: User | null }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) return;
    const [m, i] = await Promise.all([
      sb.from("workspace_members").select("user_id, email, role, joined_at").order("joined_at"),
      sb.from("workspace_invites").select("id, email, token, created_at, accepted_at").is("accepted_at", null).order("created_at", { ascending: false }),
    ]);
    if (m.data) setMembers(m.data as Member[]);
    if (i.data) setInvites(i.data as Invite[]);
    // The tables are optional: until 0003_team.sql is run these error, and the
    // card should say so once rather than sit empty and look broken.
    if (m.error && /relation .* does not exist/i.test(m.error.message)) {
      setNote({ kind: "err", text: "Team tables are missing — run supabase/migrations/0003_team.sql." });
    }
  }, []);

  const linkFor = useCallback((token: string) => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}${window.location.pathname}?invite=${token}`;
  }, []);

  /* Accepting happens here rather than on a page of its own: the link lands on
     Settings, and if the visitor is signed in as the invited address the invite
     closes and they join. RLS enforces both halves — an invite can only be
     accepted by the address it names, so a leaked token is not a way in. */
  const acceptFromUrl = useCallback(async () => {
    if (typeof window === "undefined" || !user) return;
    const token = new URLSearchParams(window.location.search).get("invite");
    if (!token) return;
    const sb = getSupabase();
    if (!sb) return;

    const upd = await sb.from("workspace_invites")
      .update({ accepted_at: new Date().toISOString(), accepted_by: user.id })
      .eq("token", token).is("accepted_at", null).select("email").maybeSingle();

    // Strip the token from the address bar either way, so it is not re-used
    // on refresh or leaked by copy-paste.
    window.history.replaceState({}, "", window.location.pathname);

    if (upd.error || !upd.data) {
      setNote({ kind: "err", text: "That invitation is not for this account, or it has already been used." });
      return;
    }
    await sb.from("workspace_members").upsert(
      { user_id: user.id, email: user.email ?? upd.data.email, role: "member" },
      { onConflict: "user_id" },
    );
    setNote({ kind: "ok", text: "You've joined the workspace." });
    load();
  }, [user, load]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { acceptFromUrl(); }, [acceptFromUrl]);

  const invite = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !user) return;
    const addr = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) { setNote({ kind: "err", text: "That doesn't look like an email address." }); return; }
    if (invites.some((i) => i.email === addr)) { setNote({ kind: "err", text: "There's already an open invitation for that address." }); return; }

    setBusy(true); setNote(null);
    const token = crypto.randomUUID().replace(/-/g, "");
    const res = await sb.from("workspace_invites").insert({ email: addr, token, invited_by: user.id, role: "member" });
    setBusy(false);
    if (res.error) { setNote({ kind: "err", text: res.error.message }); return; }
    setEmail("");
    setNote({ kind: "ok", text: "Invitation created — copy the link and send it to them." });
    load();
  }, [email, user, invites, load]);

  const revoke = useCallback(async (id: string) => {
    const sb = getSupabase();
    if (!sb) return;
    await sb.from("workspace_invites").delete().eq("id", id);
    load();
  }, [load]);

  const copy = useCallback(async (token: string) => {
    try { await navigator.clipboard.writeText(linkFor(token)); setCopied(token); setTimeout(() => setCopied(""), 1600); }
    catch { setNote({ kind: "err", text: "Couldn't copy — select the link and copy it manually." }); }
  }, [linkFor]);

  return (
    <Card title="Team" icon={<Users size={14} />}>
      <div className="flex gap-2">
        <input
          type="email" value={email} placeholder="teammate@company.com" autoComplete="off"
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") invite(); }}
          className="flex-1 px-3 py-1.5 rounded-lg text-[12.5px] outline-none"
          style={{ border: "1px solid var(--line-soft)", background: "rgba(255,255,255,0.03)", color: "var(--cream)" }}
        />
        <button type="button" disabled={busy || !user || !email.trim()} onClick={invite}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] disabled:opacity-50 shrink-0"
          style={{ border: `1px solid ${ACCENT}`, color: ACCENT, background: "rgba(253,88,18,0.08)" }}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />} Invite
        </button>
      </div>

      {members.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[11px] text-[var(--cream-mute)]">Members</div>
          {members.map((m) => (
            <div key={m.user_id} className="flex items-center gap-2 text-[12px] text-[var(--cream)]">
              <UserRound size={12} color="var(--cream-mute)" className="shrink-0" />
              <span className="mono truncate flex-1">{m.email}</span>
              <span className="text-[10.5px] text-[var(--cream-mute)]">{m.role}</span>
            </div>
          ))}
        </div>
      )}

      {invites.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] text-[var(--cream-mute)]">Pending invitations</div>
          {invites.map((i) => (
            <div key={i.id} className="flex items-center gap-2">
              <Mail size={12} color="var(--cream-mute)" className="shrink-0" />
              <span className="mono text-[12px] text-[var(--cream)] truncate flex-1">{i.email}</span>
              <button type="button" onClick={() => copy(i.token)}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md shrink-0"
                style={{ border: "1px solid var(--line-soft)", color: "var(--cream-mute)" }}>
                {copied === i.token ? <Check size={11} /> : <Copy size={11} />} {copied === i.token ? "Copied" : "Copy link"}
              </button>
              <button type="button" onClick={() => revoke(i.id)}
                className="text-[11px] px-2 py-1 rounded-md shrink-0"
                style={{ border: "1px solid var(--line-soft)", color: "var(--cream-mute)" }}>
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-[var(--cream-mute)]">
        Invitations aren&apos;t emailed — copy the link and send it however you like. Only the address you
        invited can accept it, so the link is safe to paste into chat or email.
      </p>
      <Notice note={note} />
    </Card>
  );
}

/* ── password ────────────────────────────────────────────────────────── */

function PasswordCard({ user }: { user: User | null }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  const submit = useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !user?.email) return;
    if (next.length < 8) { setNote({ kind: "err", text: "Use at least 8 characters." }); return; }
    if (next !== confirm) { setNote({ kind: "err", text: "The two new passwords do not match." }); return; }

    setBusy(true); setNote(null);
    // Supabase lets a signed-in user set a new password without proving the old
    // one. Checking it here means someone who walks up to an unlocked screen
    // cannot silently take the account over.
    const check = await sb.auth.signInWithPassword({ email: user.email, password: current });
    if (check.error) { setBusy(false); setNote({ kind: "err", text: "Current password is not correct." }); return; }

    const res = await sb.auth.updateUser({ password: next });
    setBusy(false);
    if (res.error) { setNote({ kind: "err", text: res.error.message }); return; }
    setCurrent(""); setNext(""); setConfirm("");
    setNote({ kind: "ok", text: "Password changed. It applies the next time you sign in." });
  }, [current, next, confirm, user]);

  return (
    <Card title="Change password" icon={<KeyRound size={14} />}>
      <div className="flex flex-col gap-2.5">
        <Field label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
        <Field label="New password" value={next} onChange={setNext} autoComplete="new-password" />
        <Field label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <button type="button" disabled={busy || !user?.email || !current || !next}
          onClick={submit}
          className="self-start flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] disabled:opacity-50"
          style={{ border: `1px solid ${ACCENT}`, color: ACCENT, background: "rgba(253,88,18,0.08)" }}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Update password
        </button>
      </div>
      <Notice note={note} />
    </Card>
  );
}

/* ── sign out ────────────────────────────────────────────────────────── */

function SignOutCard() {
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Sign out" icon={<LogOut size={14} />}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-[12px] text-[var(--cream-mute)] max-w-[380px]">
          Ends this session on this device. Saved builds and conversations stay in your account.
        </p>
        <button type="button" disabled={busy}
          onClick={async () => { setBusy(true); await getSupabase()?.auth.signOut(); setBusy(false); }}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] disabled:opacity-50"
          style={{ border: "1px solid var(--line-soft)", color: "var(--cream)" }}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />} Sign out
        </button>
      </div>
    </Card>
  );
}

/* ── bits ────────────────────────────────────────────────────────────── */

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border p-4 flex flex-col gap-3"
      style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
      <div className="flex items-center gap-2">
        <span style={{ color: ACCENT }}>{icon}</span>
        <h2 className="text-[12.5px] font-medium text-[var(--cream)]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Field({ label, value, onChange, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-[var(--cream-mute)]">{label}</span>
      <input
        type="password"
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-1.5 rounded-lg text-[12.5px] outline-none focus:ring-1"
        style={{ border: "1px solid var(--line-soft)", background: "rgba(255,255,255,0.03)", color: "var(--cream)" }}
      />
    </label>
  );
}

function Notice({ note }: { note: Note }) {
  if (!note) return null;
  const ok = note.kind === "ok";
  return (
    <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: ok ? "#34d399" : "#f87171" }}>
      {ok ? <Check size={12} /> : <TriangleAlert size={12} />} {note.text}
    </div>
  );
}
