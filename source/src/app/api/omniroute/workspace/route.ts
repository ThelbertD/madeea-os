import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverSupabase, currentUserId } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Two backing stores, same wire shape.
//
//   Supabase — used whenever the caller forwards a valid access token. Builds and
//   sessions then survive the machine and follow the user across browsers.
//   RLS (supabase/migrations/0001_omniroute_workspace.sql) scopes every row to
//   auth.uid(); this file never uses a service-role key.
//
//   Disk — the original store, kept as the fallback for a signed-out or
//   unconfigured session so a purely local install keeps working untouched.
//
// The response shape is identical either way, so the UI cannot tell them apart.
const ROOT = path.join(os.homedir(), ".agentic-os", "omniroute-workspace");
const BUILDS = path.join(ROOT, "builds");
const SESSIONS = path.join(ROOT, "sessions");

async function ensure() {
  await fs.mkdir(BUILDS, { recursive: true });
  await fs.mkdir(SESSIONS, { recursive: true });
}
function slug(s: string) {
  return (s || "build").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "build";
}
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
const safe = (name: string) => path.basename(name); // never escape the dir

const html = (body: string) =>
  new NextResponse(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/** Supabase-backed store, or null when the request is not authenticated. */
async function store(req: Request): Promise<{ sb: SupabaseClient; uid: string } | null> {
  const sb = serverSupabase(req);
  if (!sb) return null;
  const uid = await currentUserId(sb);
  // A configured project but an expired/invalid token falls through to disk
  // rather than erroring — the UI stays usable while the session refreshes.
  return uid ? { sb, uid } : null;
}

// GET                       → { root, builds:[...], sessions:[...] }
// GET ?open=<file>          → raw HTML of a saved build (for viewing in a tab)
// GET ?session=<id>         → the saved conversation JSON
export async function GET(req: Request) {
  const url = new URL(req.url);
  const open = url.searchParams.get("open");
  const sid = url.searchParams.get("session");

  const remote = await store(req);
  if (remote) {
    const { sb, uid } = remote;

    if (open) {
      const { data } = await sb
        .from("omniroute_builds").select("html")
        .eq("user_id", uid).eq("file", open).maybeSingle();
      return data?.html ? html(data.html as string) : notFound();
    }

    if (sid) {
      const { data } = await sb
        .from("omniroute_sessions").select("id, title, messages, updated_at")
        .eq("user_id", uid).eq("id", sid).maybeSingle();
      if (!data) return notFound();
      return NextResponse.json({
        id: data.id, title: data.title, when: data.updated_at, messages: data.messages ?? [],
      });
    }

    // `size` is derived rather than stored: the UI only renders it, and a length
    // is exact enough for that without a column that could drift from the body.
    const [{ data: bRows }, { data: sRows }] = await Promise.all([
      sb.from("omniroute_builds").select("file, title, html, created_at")
        .eq("user_id", uid).order("created_at", { ascending: false }),
      sb.from("omniroute_sessions").select("id, title, messages, updated_at")
        .eq("user_id", uid).order("updated_at", { ascending: false }),
    ]);

    const builds = (bRows ?? []).map((b) => ({
      file: b.file as string,
      when: b.created_at as string,
      size: ((b.html as string) ?? "").length,
      title: b.title as string,
    }));
    const sessions = (sRows ?? []).map((s) => {
      const msgs = (s.messages as unknown[]) ?? [];
      return {
        file: `${s.id}.json`,
        when: s.updated_at as string,
        size: JSON.stringify(msgs).length,
        id: s.id as string,
        title: (s.title as string) || "Session",
        count: msgs.length,
      };
    });
    return NextResponse.json({ root: "supabase", builds, sessions });
  }

  // ── disk fallback ────────────────────────────────────────────────────────
  await ensure();
  if (open) {
    try {
      return html(await fs.readFile(path.join(BUILDS, safe(open)), "utf8"));
    } catch { return notFound(); }
  }
  if (sid) {
    try {
      const j = await fs.readFile(path.join(SESSIONS, safe(sid) + ".json"), "utf8");
      return NextResponse.json(JSON.parse(j));
    } catch { return notFound(); }
  }
  const listDir = async (dir: string, ext: string) => {
    const files = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith(ext));
    const out = await Promise.all(files.map(async (f) => {
      const st = await fs.stat(path.join(dir, f));
      return { file: f, when: st.mtime.toISOString(), size: st.size };
    }));
    return out.sort((a, b) => b.when.localeCompare(a.when));
  };
  const builds = (await listDir(BUILDS, ".html")).map((b) => ({ ...b, title: b.file.replace(/^\d{4}-\d\d-\d\dT[\d-]+-/, "").replace(/\.html$/, "").replace(/-/g, " ") }));
  const sessions = await Promise.all((await listDir(SESSIONS, ".json")).map(async (s) => {
    try { const j = JSON.parse(await fs.readFile(path.join(SESSIONS, s.file), "utf8")); return { ...s, id: s.file.replace(/\.json$/, ""), title: j.title || "Session", count: (j.messages || []).length }; }
    catch { return { ...s, id: s.file.replace(/\.json$/, ""), title: "Session", count: 0 }; }
  }));
  return NextResponse.json({ root: ROOT, builds, sessions });
}

// POST { action:"saveBuild", code, title }        → writes builds/<stamp>-<slug>.html
// POST { action:"saveSession", id, title, messages } → writes sessions/<id>.json + .md
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const remote = await store(req);

  if (body.action === "saveBuild") {
    if (typeof body.code !== "string" || !body.code.trim()) return NextResponse.json({ error: "code required" }, { status: 400 });
    const title = String(body.title || "build").slice(0, 80);
    const file = `${stamp()}-${slug(body.title)}.html`;
    if (remote) {
      const { error } = await remote.sb.from("omniroute_builds")
        .upsert({ user_id: remote.uid, file, title, html: body.code }, { onConflict: "user_id,file" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, file });
    }
    await ensure();
    await fs.writeFile(path.join(BUILDS, file), body.code, "utf8");
    return NextResponse.json({ ok: true, file });
  }

  if (body.action === "saveSession") {
    const id = safe(String(body.id || stamp()));
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const title = String(body.title || "Session").slice(0, 80);
    if (remote) {
      const { error } = await remote.sb.from("omniroute_sessions")
        .upsert({ user_id: remote.uid, id, title, messages, updated_at: new Date().toISOString() }, { onConflict: "user_id,id" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, id });
    }
    await ensure();
    await fs.writeFile(path.join(SESSIONS, id + ".json"), JSON.stringify({ id, title, when: new Date().toISOString(), messages }, null, 2), "utf8");
    // Human-readable transcript alongside. Disk-only: on Supabase the messages
    // column already holds the conversation and a rendered copy would be a
    // second thing to keep in sync for no gain.
    const md = `# ${title}\n\n` + messages.map((m: { role: string; content: string }) => `**${m.role}:**\n\n${m.content}\n`).join("\n---\n\n");
    await fs.writeFile(path.join(SESSIONS, id + ".md"), md, "utf8");
    return NextResponse.json({ ok: true, id });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
