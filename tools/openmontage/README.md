# OpenMontage pipeline

`install/26` documents the tab but the pack ships no pipeline for it: the route
spawns `cinematic_om.py` / `movie_om.py` from
`<HERMES_HOME>/profiles/openmontage/workspace/scripts/`, and nothing anywhere
creates those files. The tab could never generate anything.

This is a replacement built from parts already working here:

```
prompt → OmniRoute (free, local, no key) authors an HTML composition
       → HyperFrames renders it to MP4 (same engine as Video → Create)
```

The upstream design called gpt-image-2 through OpenRouter for stills, billed
per run. This authors motion in HTML/CSS instead — free, no API key.

## Install

```bash
mkdir -p ~/AppData/Local/hermes/profiles/openmontage/workspace/scripts
cp cinematic_om.py .../scripts/
cp cinematic_om.py .../scripts/movie_om.py     # movie mode uses --clips
```

## Three things that cost time to find

**OmniRoute 403s on urllib's default User-Agent.** `Python-urllib/3.x` is
rejected outright; any other value passes. Without an explicit UA every model
call fails and the pipeline silently falls back to a plain title card. This was
invisible because the route spawns detached with `stdio: "ignore"`.

**Small models stop before `</html>`.** A strict `<!DOCTYPE … </html>` match
throws away otherwise-usable output, so extraction now accepts a document that
merely starts correctly and closes it. A truncated tail costs one scene, not
the whole composition.

**The free pool is genuinely flaky**, so the model call retries three times
before falling back. The fallback still renders a real title-card video rather
than leaving a dead job.

## Contract

Writes `{status, progress, message, title, video}` to the job JSON atomically —
the status route polls it continuously and a half-written file surfaces as a
parse error. `status: "done"` plus `video: "<file>.mp4"` makes the tab show the
player.
