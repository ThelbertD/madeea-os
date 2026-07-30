import { NextRequest, NextResponse } from "next/server";
import { getLogs } from "@/lib/fleet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const since = Number(req.nextUrl.searchParams.get("since") ?? 0);
  return NextResponse.json({
    lines: getLogs(id, Number.isFinite(since) ? since : 0),
    now: Date.now(),
  });
}
