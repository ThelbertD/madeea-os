import { NextResponse } from "next/server";
import { addToLibrary, dxComplete, getAgent } from "@/lib/dexpress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TitleGenerator.jsx: 5 SEO titles for 1500-1800 word articles, returned as
// { titles: [...] }.
export async function POST(req: Request) {
  const { keywords, save } = await req.json().catch(() => ({}));
  if (typeof keywords !== "string" || !keywords.trim()) {
    return NextResponse.json({ error: "need keywords" }, { status: 400 });
  }
  const agent = await getAgent("seo_optimizer");
  if (!agent) return NextResponse.json({ error: "seo_optimizer agent missing — is the pack installed?" }, { status: 503 });

  const system = `${agent.instructions}\n\nYou are generating blog post titles.`;
  const user = [
    `Based on these SEO keywords, generate 5 engaging, SEO-friendly blog post titles.`,
    ``,
    `Keywords: ${keywords.trim()}`,
    ``,
    `Requirements:`,
    `- Each title must support a comprehensive 1500-1800 word article.`,
    `- Use power words that signal depth (Complete Guide, Ultimate, Step-by-Step...) where they fit naturally.`,
    `- Optimise for search intent and click-through.`,
    `- Keep each under 60 characters where possible.`,
    ``,
    `Reply with JSON only: {"titles": ["...", "...", "...", "...", "..."]}`,
  ].join("\n");

  let text: string;
  try { text = await dxComplete(system, user, { maxTokens: 1200, temperature: 0.8 }); }
  catch (e) { return NextResponse.json({ error: String((e as Error).message) }, { status: 502 }); }

  // Small models wrap JSON in prose or a fence; pull the object out rather than
  // failing the request over formatting.
  let titles: string[] = [];
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { titles = JSON.parse(m[0]).titles ?? []; } catch { /* fall through */ } }
  if (!titles.length) {
    titles = text.split("\n")
      .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*])\s*/, "").replace(/^["']|["']$/g, "").trim())
      .filter((l) => l.length > 12 && l.length < 120)
      .slice(0, 5);
  }
  if (!titles.length) return NextResponse.json({ error: "no titles in reply", raw: text.slice(0, 300) }, { status: 502 });

  if (save) {
    for (const t of titles) await addToLibrary({ kind: "title", keyword: keywords.trim(), title: t, body: t, agentId: "seo_optimizer" });
  }
  return NextResponse.json({ titles, model: undefined });
}
