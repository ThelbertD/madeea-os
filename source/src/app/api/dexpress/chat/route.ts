import { dxComplete, getAgent } from "@/lib/dexpress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Non-streaming on purpose.
 *
 * The Base44 original streamed, and so did the first version of this. But the
 * free models behind OmniRoute are reasoning models, and on the streaming path
 * the gateway ignores `reasoning: { enabled: false }`: it emits
 * reasoning_content with `content: null` for minutes before the first real
 * token. "Reply with exactly: ok" ran past five minutes and the client timed
 * out holding an empty body — which reads as a broken route, not a slow model.
 *
 * The same prompt on the non-streaming path returns in seconds, so take the
 * whole reply at once. The client reads it with the same reader loop; it just
 * arrives as one chunk.
 */
export async function POST(req: Request) {
  const { agentId, messages } = await req.json().catch(() => ({}));
  const agent = await getAgent(String(agentId ?? ""));
  if (!agent) {
    return new Response(JSON.stringify({ error: "unknown agent" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  if (!Array.isArray(messages) || !messages.length) {
    return new Response(JSON.stringify({ error: "need messages" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // Fold the exchange into a single user turn — the free models here handle one
  // prompt far more reliably than a long multi-turn array.
  const history = messages
    .slice(-10)
    .map((m: { role: string; content: string }) =>
      `${m.role === "assistant" ? "You" : "User"}: ${String(m.content ?? "").slice(0, 4000)}`)
    .join("\n\n");

  try {
    const text = await dxComplete(agent.instructions, history, { maxTokens: 2000, temperature: 0.7 });
    return new Response(text, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message) }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }
}
