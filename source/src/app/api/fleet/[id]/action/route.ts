import { NextRequest, NextResponse } from "next/server";
import { getAgent, getRuntime, startAgent, stopAgent } from "@/lib/fleet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) {
    return NextResponse.json({ error: `Unknown agent "${id}"` }, { status: 404 });
  }

  const { action } = await req.json().catch(() => ({ action: "" }));

  if (action === "start") {
    const r = startAgent(agent);
    return NextResponse.json(
      r.ok ? { ok: true, runtime: getRuntime(id) } : { ok: false, error: r.error },
      { status: r.ok ? 200 : 400 },
    );
  }
  if (action === "stop") {
    const r = stopAgent(id);
    return NextResponse.json({ ...r, runtime: getRuntime(id) });
  }
  return NextResponse.json(
    { error: 'action must be "start" or "stop"' },
    { status: 400 },
  );
}
