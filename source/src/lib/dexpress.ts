/* D Express content agent.
 *
 * Replaces the old SEO Content Pipeline, which was the pack author's own
 * 5-site AIPB funnel: hard-coded to his repos, his offers, his CTAs. This is a
 * port of `d-express-locksmith-content-agent` (a Base44 app) instead — the same
 * 14 agents, the same article and title specs, driven by OmniRoute so it costs
 * nothing to run.
 *
 * Base44 supplies a hosted model and an entity store. Neither exists here, so
 * model calls go to OmniRoute and everything generated is written under
 * ~/.agentic-os/dexpress/ as plain JSON.
 */
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { OMNIROUTE_BASE, OMNIROUTE_FREE_MODEL, OMNIROUTE_KEY, OMNIROUTE_STEER } from "@/lib/omniroute";

export const DX_ROOT = path.join(os.homedir(), ".agentic-os", "dexpress");

// The agent briefs live in the installed pack; that is what makes this
// retargetable to another client without touching code.
function packAgentsDir(): string {
  const packs = path.join(process.cwd(), "..", "packs");
  for (const name of ["dexpress-seo"]) {
    const dir = path.join(packs, name, "agents");
    if (existsSync(dir)) return dir;
  }
  return path.join(packs, "dexpress-seo", "agents");
}

export interface DxAgent {
  id: string;
  name: string;
  description: string;
  instructions: string;
}

const TITLECASE = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export async function listAgents(): Promise<DxAgent[]> {
  const dir = packAgentsDir();
  let files: string[] = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith(".md")); } catch { return []; }
  const out: DxAgent[] = [];
  for (const f of files.sort()) {
    try {
      const body = await readFile(path.join(dir, f), "utf8");
      // Each brief is "# id\n\n> description\n>\n> provenance\n\n<instructions>"
      const id = f.replace(/\.md$/, "");
      const desc = (body.match(/^>\s*(.+)$/m) ?? [])[1] ?? "";
      const instructions = body.split(/\n\n/).slice(2).join("\n\n").trim();
      out.push({ id, name: TITLECASE(id), description: desc, instructions });
    } catch { /* skip an unreadable brief rather than fail the whole list */ }
  }
  return out;
}

export async function getAgent(id: string): Promise<DxAgent | null> {
  if (!/^[a-z0-9_]+$/.test(id)) return null;
  return (await listAgents()).find((a) => a.id === id) ?? null;
}

/* ── model ─────────────────────────────────────────────────────────────
 * OmniRoute is OpenAI-compatible. It defaults to SSE, and r.json() on a
 * stream throws "Unexpected token 'd'" — so ask for stream:false unless the
 * caller wants the stream itself.
 */
export function dxModel(): string {
  return process.env.DEXPRESS_MODEL || OMNIROUTE_FREE_MODEL;
}

export async function dxComplete(
  system: string,
  user: string,
  opts?: { maxTokens?: number; temperature?: number; signal?: AbortSignal },
): Promise<string> {
  const r = await fetch(`${OMNIROUTE_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OMNIROUTE_KEY}` },
    body: JSON.stringify({
      model: dxModel(),
      stream: false,
      // The free models on this gateway are reasoning models: left alone they
      // emit reasoning_content until the budget is gone and return content:
      // null, which reads as "the model returned nothing". Turn reasoning off
      // where the gateway supports it.
      reasoning: { enabled: false },
      max_tokens: opts?.maxTokens ?? 8000,
      temperature: opts?.temperature ?? 0.7,
      messages: [{ role: "system", content: `${system}

${OMNIROUTE_STEER}` }, { role: "user", content: user }],
    }),
    signal: opts?.signal,
  });
  if (!r.ok) throw new Error(`OmniRoute ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const text = j?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("model returned nothing");
  return text;
}

export function dxStreamBody(system: string, messages: { role: string; content: string }[], maxTokens = 4000) {
  return JSON.stringify({
    model: dxModel(),
    stream: true,
    // Same reason as dxComplete: without this the stream carries only
    // reasoning_content and every content delta is null, so the reply looks
    // empty even though the request succeeded.
    reasoning: { enabled: false },
    max_tokens: maxTokens,
    messages: [{ role: "system", content: `${system}

${OMNIROUTE_STEER}` }, ...messages],
  });
}

/* ── storage ───────────────────────────────────────────────────────────
 * Base44 had an entity store. Files are enough here and stay readable, so a
 * post can be edited or moved into a site repo by hand.
 */
export type DxKind = "title" | "article" | "social" | "email" | "ideas" | "reviews";

export interface DxItem {
  id: string;
  kind: DxKind;
  keyword: string;
  title?: string;
  slug?: string;
  body: string;
  agentId?: string;
  createdAt: number;
  wordCount?: number;
}

function storeFile(): string { return path.join(DX_ROOT, "library.json"); }

export async function readLibrary(): Promise<DxItem[]> {
  try { return JSON.parse(await readFile(storeFile(), "utf8")) as DxItem[]; }
  catch { return []; }
}

export async function addToLibrary(item: Omit<DxItem, "id" | "createdAt">): Promise<DxItem> {
  const full: DxItem = { ...item, id: `dx-${Date.now().toString(36)}`, createdAt: Date.now() };
  const all = await readLibrary();
  all.unshift(full);
  await mkdir(DX_ROOT, { recursive: true });
  // Write to a temp file then rename, so a crash mid-write cannot truncate the
  // whole library.
  const tmp = `${storeFile()}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2), "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(tmp, storeFile());
  return full;
}

export async function removeFromLibrary(id: string): Promise<boolean> {
  const all = await readLibrary();
  const next = all.filter((i) => i.id !== id);
  if (next.length === all.length) return false;
  await mkdir(DX_ROOT, { recursive: true });
  const tmp = `${storeFile()}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(tmp, storeFile());
  return true;
}

export function wordCount(md: string): number {
  const body = md
    .replace(/^---[\s\S]*?---/, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "");
  return (body.match(/\b[\w']+\b/g) ?? []).length;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "post";
}
