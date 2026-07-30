import { NextResponse } from "next/server";
import { addToLibrary, dxComplete, getAgent, slugify, wordCount } from "@/lib/dexpress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ArticleGenerator.jsx's spec, verbatim in intent: 1500-1800 words, intro,
// 6-8 H2 sections, exactly 5 FAQs, conclusion with CTA.
const SPEC = [
  `Length is a hard requirement: minimum 1500 words, maximum 1800. Target 1650.`,
  `Count prose only — not frontmatter, markup or the JSON-LD block. Runs overshoot far`,
  `more often than they fall short, so count before finishing and cut if over.`,
  ``,
  `Structure:`,
  `- Introduction, 150-200 words.`,
  `- 6-8 sections, each an H2, 200-250 words each, every one carrying a specific`,
  `  example, actionable tip or detailed explanation.`,
  `- A "Frequently Asked Questions" section immediately before the conclusion:`,
  `  exactly 5 questions as H3, each answered in 50-100 words.`,
  `- Conclusion with a clear call to action, 100-150 words.`,
  ``,
  `Output markdown with YAML frontmatter:`,
  `---`,
  `title: "..."          # 50-60 chars, keyword-led`,
  `description: "..."    # 150-160 chars`,
  `keywords: [..., ...]`,
  `date: YYYY-MM-DD`,
  `author: "D Express Locksmith"`,
  `word_count: 0`,
  `---`,
  ``,
  `Then the body — do not repeat the title as an H1, the template renders it —`,
  `then a JSON-LD block covering LocalBusiness, Service and FAQPage.`,
  ``,
  `US English. Never invent reviews, ratings, statistics or awards; the only`,
  `credentials you may claim are the ones in your brief.`,
].join("\n");

export async function POST(req: Request) {
  const { title, keywords, transcript, agentId } = await req.json().catch(() => ({}));
  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "need a title" }, { status: 400 });
  }
  const id = typeof agentId === "string" && agentId ? agentId : "blog_content_writer";
  const writer = await getAgent(id);
  const seo = await getAgent("seo_optimizer");
  if (!writer) return NextResponse.json({ error: `agent ${id} missing — is the pack installed?` }, { status: 503 });

  const system = [writer.instructions, seo ? `\n---\nSEO requirements:\n\n${seo.instructions}` : "", `\n---\n${SPEC}`].join("\n");
  const user = [
    `Blog post title: "${title.trim()}"`,
    keywords ? `Primary keywords: ${String(keywords).trim()}` : "",
    transcript ? `\n<transcript>\n${String(transcript).slice(0, 200_000)}\n</transcript>\n` : "",
    ``,
    `Write the full article now. Output only the markdown file contents.`,
  ].filter(Boolean).join("\n");

  let body: string;
  try { body = await dxComplete(system, user, { maxTokens: 16000, temperature: 0.7 }); }
  catch (e) { return NextResponse.json({ error: String((e as Error).message) }, { status: 502 }); }

  const wc = wordCount(body);
  const slug = slugify(title);
  const item = await addToLibrary({
    kind: "article", keyword: String(keywords ?? "").trim(), title: title.trim(),
    slug, body, agentId: id, wordCount: wc,
  });
  // Report the real count, not the model's own — it consistently under-reports.
  return NextResponse.json({ item, wordCount: wc, withinSpec: wc >= 1500 && wc <= 1800, slug });
}
