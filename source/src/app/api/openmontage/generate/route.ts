import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { hermesHome } from "@/lib/config";

// POST { prompt, shots? } → starts a cinematic generation job, returns { jobId }.
// The Python pipeline (OpenRouter cinematic images → ffmpeg Ken Burns + grade) runs
// detached and writes live progress to a job json that /api/openmontage/status reads.
export async function POST(req: Request) {
  const { prompt, shots, mode } = await req.json().catch(() => ({}));
  if (!prompt || typeof prompt !== "string" || prompt.trim().length < 4) {
    return Response.json({ error: "Describe the video you want (a few words)." }, { status: 400 });
  }
  const isMovie = mode === "movie";
  const n = Math.max(2, Math.min(Number(shots) || (isMovie ? 2 : 6), isMovie ? 4 : 10));
  const jobId = "om-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const ws = path.join(hermesHome(), "profiles", "openmontage", "workspace");
  // movie_om.py  = Veo 3.1 motion clips → CinematicRenderer (real movie, costs ~$2-3, ~8 min)
  // cinematic_om.py = gpt-image-2 stills → CinematicRenderer (film trailer, ~$0.30, ~5 min)
  const script = path.join(ws, "scripts", isMovie ? "movie_om.py" : "cinematic_om.py");
  const countFlag = isMovie ? "--clips" : "--shots";
  const jobsDir = path.join(ws, "jobs");
  const outDir = path.join(process.cwd(), "public", "openmontage", "generated");
  mkdirSync(jobsDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  // The pipeline scripts do not ship with this pack and nothing scaffolds
  // them, so spawning here would detach into nothing: no job file is ever
  // written and the UI polls "Starting… 0%" forever with no error. Fail
  // loudly instead of pretending work has begun.
  if (!existsSync(script)) {
    return Response.json({
      error:
        `OpenMontage pipeline not installed — ${path.basename(script)} is missing.
` +
        `Expected at: ${script}
` +
        `This pack ships the tab but not the Python pipeline it drives, and nothing creates it. ` +
        `Generation also requires an OpenRouter key with credit (billed per run).`,
    }, { status: 503 });
  }

  const jobFile = path.join(jobsDir, `${jobId}.json`);
  const outFile = path.join(outDir, `${jobId}.mp4`);

  // "python3" is not a real interpreter on Windows — it is a Microsoft Store
  // alias stub that prints an install prompt and exits, so the script never
  // runs and the job silently never starts. Use "python" there.
  const py = process.env.OPENMONTAGE_PYTHON
    ?? (process.platform === "win32" ? "python" : "python3");

  const child = spawn(
    py,
    [script, "--prompt", prompt.trim().slice(0, 600), countFlag, String(n),
      "--out", outFile, "--job", jobFile],
    { detached: true, stdio: "ignore", cwd: ws }
  );
  child.unref();

  return Response.json({ jobId, status: "planning" });
}
