import { NextResponse } from "next/server";
import { readLibrary, removeFromLibrary } from "@/lib/dexpress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind");
  const all = await readLibrary();
  return NextResponse.json({ items: kind ? all.filter((i) => i.kind === kind) : all });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return NextResponse.json({ ok: await removeFromLibrary(id) });
}
