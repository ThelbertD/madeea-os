import { NextResponse } from "next/server";
import { listAgents } from "@/lib/dexpress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const agents = await listAgents();
  // Trim the instructions out of the list payload — 40KB of briefs is not
  // needed to render a picker, and the chat route loads the one it needs.
  return NextResponse.json({
    count: agents.length,
    agents: agents.map((a) => ({ id: a.id, name: a.name, description: a.description, chars: a.instructions.length })),
  });
}
