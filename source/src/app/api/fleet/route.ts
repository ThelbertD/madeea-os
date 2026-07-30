import { NextRequest, NextResponse } from "next/server";
import {
  dirExists,
  getAgents,
  getRuntime,
  probeHealth,
  saveAgents,
  type FleetAgent,
} from "@/lib/fleet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Never probe our own origin. SEO Office's default URL is localhost:3000 —
 * the port this app runs on — and a route handler fetching its own server
 * deadlocks the single dev worker, which hangs the whole Fleet request.
 */
function isSelf(url: string | undefined, req: NextRequest): boolean {
  if (!url) return false;
  try {
    return new URL(url).host === req.nextUrl.host;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const withHealth = req.nextUrl.searchParams.get("health") === "1";
  const agents = await getAgents();

  const views = await Promise.all(
    agents.map(async (agent) => {
      const rt = getRuntime(agent.id);
      const linked = await dirExists(agent.cwd);
      let reachable: boolean | undefined;

      const target = agent.healthUrl ?? agent.url;
      if (withHealth && !isSelf(target, req)) {
        reachable = await probeHealth(target);
        // A port that answers counts as online even if we didn't spawn it —
        // you may well have started the agent in your own terminal.
        if (reachable && rt.status === "offline") rt.status = "online";
      }
      return { ...agent, runtime: rt, linked, reachable };
    }),
  );

  return NextResponse.json({ agents: views });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { agents?: FleetAgent[] };
  if (!Array.isArray(body.agents)) {
    return NextResponse.json({ error: "agents[] is required" }, { status: 400 });
  }
  return NextResponse.json({ agents: await saveAgents(body.agents) });
}
