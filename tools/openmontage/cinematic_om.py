#!/usr/bin/env python3
"""
OpenMontage pipeline — cinematic mode.

The pack ships the OpenMontage tab but not this script, and nothing creates
it, so the tab could never generate anything. This is a replacement built from
parts already working on this machine:

  prompt --> OmniRoute (free, local, no key) writes an HTML composition
         --> HyperFrames renders it to MP4 (same engine as Video -> Create)

The upstream design called gpt-image-2 through OpenRouter for stills, which
costs money per run. This authors motion in HTML/CSS instead, so it is free and
needs no API key.

Contract expected by api/openmontage/status:
    job json -> {status, progress, message, title, video}
    status "done" + video "<file.mp4>" makes the tab show the player.
"""
import argparse, json, os, re, subprocess, sys, time, urllib.request
from pathlib import Path

GATEWAY = os.environ.get("OMNIROUTE_BASE_URL", "http://127.0.0.1:20128")
MODEL   = os.environ.get("OMNIROUTE_MODEL", "oc/deepseek-v4-flash-free")
FPS     = 30


def write_job(path, **fields):
    """Status is polled continuously, so write atomically — a half-written
    file would surface as a parse error mid-render."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(fields), encoding="utf-8")
    tmp.replace(p)


def ask_model(prompt, shots, seconds):
    system = (
        "You write single-file HTML animations for a 1920x1080 video renderer. "
        "Reply with ONE complete HTML document and nothing else — no prose, no code fences.\n"
        "Hard requirements:\n"
        f"- Exactly {shots} full-screen scenes, shown in sequence over {seconds} seconds total.\n"
        "- Drive everything with CSS @keyframes on a fixed timeline; no JS timers, no user input.\n"
        "- Every animation must set animation-fill-mode: both, so any frame can be seeked directly.\n"
        "- Cinematic look: dark background, slow pans/zooms, generous type, high contrast.\n"
        "- Self-contained: no external images, fonts, or network requests."
    )
    body = json.dumps({
        "model": MODEL,
        "stream": False,
        "max_tokens": 8000,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Cinematic sequence about: {prompt}"},
        ],
    }).encode()
    req = urllib.request.Request(
        f"{GATEWAY}/v1/chat/completions", data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer free-local",
            # OmniRoute 403s on urllib's default User-Agent ("Python-urllib/3.x").
            # Any other value passes. Without this every model call fails and
            # the pipeline silently falls back to the plain title card.
            "User-Agent": "openmontage/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.load(r)
    return data["choices"][0]["message"]["content"]


def extract_html(text):
    """Pull an HTML document out of the reply.

    Small models often stop before writing </html>, so a strict
    <!DOCTYPE ... </html> match rejects otherwise-usable output. Accept a
    document that merely starts correctly and close it ourselves — the
    renderer only needs valid-enough markup, and a truncated tail costs one
    scene rather than the whole composition.
    """
    m = re.search(r"```(?:html)?\s*(.*?)```", text, re.S)
    if m:
        text = m.group(1)
    start = re.search(r"<!DOCTYPE html|<html", text, re.I)
    if not start:
        return None
    doc = text[start.start():]
    end = re.search(r"</html\s*>", doc, re.I)
    if end:
        return doc[: end.end()]
    if len(doc) < 400:          # too little to be a real composition
        return None
    if "</body>" not in doc.lower():
        doc += "</body>"
    return doc + "</html>"


def fallback_html(prompt, seconds):
    """If the free model returns nothing usable, still produce a real video
    rather than failing — the free pool is unreliable and a title card beats
    a dead job."""
    safe = (prompt[:120].replace("&", "&amp;").replace("<", "&lt;"))
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;width:1920px;height:1080px;overflow:hidden;background:#09141f;
font-family:Georgia,serif;color:#f4f4f5}}
.wrap{{width:100%;height:100%;display:flex;align-items:center;justify-content:center;
flex-direction:column;animation:zoom {seconds}s ease-out both}}
h1{{font-size:96px;max-width:1400px;text-align:center;line-height:1.15;
animation:fade 3s ease-out both}}
.rule{{width:0;height:4px;background:#fd5812;margin-top:48px;
animation:grow {seconds}s ease-out both}}
@keyframes zoom{{from{{transform:scale(1)}}to{{transform:scale(1.12)}}}}
@keyframes fade{{from{{opacity:0;transform:translateY(30px)}}to{{opacity:1;transform:none}}}}
@keyframes grow{{from{{width:0}}to{{width:900px}}}}
</style></head><body><div class="wrap"><h1>{safe}</h1><div class="rule"></div></div></body></html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--shots", type=int, default=6)
    ap.add_argument("--clips", type=int)          # movie mode uses --clips
    ap.add_argument("--out", required=True)
    ap.add_argument("--job", required=True)
    a = ap.parse_args()

    shots = a.clips or a.shots
    seconds = max(8, shots * 4)
    job, out = a.job, Path(a.out)
    title = a.prompt[:60]

    try:
        write_job(job, status="planning", progress=5,
                  message="Writing the composition…", title=title)
        # The free pool is unreliable — a 403 or an empty reply one minute is
        # fine the next. Retry a few times before dropping to the fallback,
        # otherwise a transient blip costs the whole composition.
        html = None
        for attempt in range(3):
            try:
                html = extract_html(ask_model(a.prompt, shots, seconds))
                if html:
                    break
                print(f"attempt {attempt+1}: no HTML in reply", file=sys.stderr)
            except Exception as e:
                print(f"attempt {attempt+1}: {e}", file=sys.stderr)
            if attempt < 2:
                write_job(job, status="planning", progress=10 + attempt * 8,
                          message=f"Retrying the composition ({attempt+2}/3)…", title=title)
                time.sleep(4)
        used_fallback = html is None
        if html is None:
            html = fallback_html(a.prompt, seconds)

        write_job(job, status="rendering", progress=35,
                  message="Rendering frames…" + (" (simple mode)" if used_fallback else ""),
                  title=title)

        proj = Path(a.job).parent.parent / "projects" / out.stem
        proj.mkdir(parents=True, exist_ok=True)
        (proj / "index.html").write_text(html, encoding="utf-8")
        (proj / "hyperframes.json").write_text(json.dumps({
            "name": out.stem, "composition": "index.html",
            "width": 1920, "height": 1080, "fps": FPS, "duration": seconds,
        }), encoding="utf-8")

        out.parent.mkdir(parents=True, exist_ok=True)
        hf = Path(os.environ.get("APPDATA", "")) / "npm" / "node_modules" / "hyperframes" / "bin" / "hyperframes.mjs"
        cmd = ([sys.executable and "node", str(hf)] if hf.exists() else ["npx", "hyperframes"])
        r = subprocess.run(cmd + ["render", str(proj), "--output", str(out)],
                           capture_output=True, text=True, timeout=1800)
        if not out.exists() or out.stat().st_size == 0:
            raise RuntimeError((r.stderr or r.stdout or "render produced no file")[-400:])

        write_job(job, status="done", progress=100, message="Done", title=title,
                  video=out.name)
    except Exception as e:
        write_job(job, status="error", progress=0, message=str(e)[:400], title=title)
        raise


if __name__ == "__main__":
    main()
