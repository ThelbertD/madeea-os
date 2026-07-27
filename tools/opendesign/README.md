# Open Design — working setup for Windows

The **Open Design** tab was stuck on "offline". These three files fix it.
They belong in `~/open-design/` — copy them there after cloning the project.

## What was wrong

`install/21-OPEN-DESIGN.md` lists macOS, Linux and WSL2 only, and its start
script assumes `pnpm tools-dev start web` can run the web UI. On this machine
that failed with **"web exited before exposing status"** and an empty log.

The cause: `apps/web` is built with Next's `output: "export"`. `next start`
refuses an exported build —

> `"next start" does not work with "output: export" configuration.`

so the web process died the moment tools-dev launched it. The daemon was fine
throughout; only the iframe half was broken.

`od-web-server.mjs` replaces that half: it serves `apps/web/out` statically
and proxies `/api/*` to the daemon on 7455, which is what tools-dev's web
launcher was doing before it fell over.

## Install

```bash
git clone https://github.com/nexu-io/open-design ~/open-design
cd ~/open-design
npm install -g pnpm@10.33.2          # `corepack enable` needs admin on Windows
pnpm install                          # ~6 min
pnpm --filter @open-design/web build  # tools-dev never builds this
cp /path/to/MadeEA-OS/tools/opendesign/* ~/open-design/
```

Then press **Start Open Design** in the tab, or run `bash ~/open-design/od-host-start.sh`.

## Verify

```
daemon: {"ok":true,"version":"0.16.1"}     # 127.0.0.1:7455
web:    200                                 # 127.0.0.1:7456
```

The dashboard health-checks the **daemon**, so the tab reads "running" as soon
as 7455 is up — the iframe needs 7456 as well.

## First run

Open Design shows its own onboarding: **Local coding agent**, cloud sign-in, or
**Bring your own key**. Pick *Local coding agent* to drive the CLIs already on
your PATH — nothing in this pack needs a key for it.

## Notes

- Ports 7455 and 7456 must be free.
- `node-pty` build scripts are skipped by pnpm; nothing here needed them.
- Projects save to `~/open-design/.od/projects/`.

---

## Using Open Design from the exported pages

`/app/opendesign/` on **GitHub Pages can never work**. Chrome refuses an https
page any access to your machine — verified in a real browser:

```
fetch  →  BLOCKED: Failed to fetch
iframe →  0 frames loaded
```

That is Private Network Access, and it covers iframes as well as fetch, so no
page code gets around it.

Served over plain http from your own machine, the identical files work:

```bash
node tools/serve-local.mjs        # → http://localhost:4173/madeea-os/app/
```

One extra wrinkle: the Open Design daemon sends no `Access-Control-Allow-Origin`
header (OmniRoute reflects the origin, which is why that one works directly), so
even over http a browser fetch to :7455 is refused. `serve-local.mjs` relays it
at `/__od/health`, and the shim uses that when present.

Verified through the launcher:

| | |
|---|---|
| Open Design | `running · 127.0.0.1:7456`, studio embedded in the tab |
| OmniRoute | `Gateway live · 99 models`, prompt enabled |

---

## "vela binary not found; install vela or configure VELA_BIN"

Open Design ships with **amr** as its default agent, and amr's binary is
`vela`, which is not installed — so onboarding stopped with that error before
anything could be created.

amr is only one of ~15 supported runtimes. `apps/daemon/src/runtimes/executables.ts`
maps each to a binary:

| agentId | binary |
|---|---|
| amr | `vela` ← default, absent |
| claude | `claude` ← installed, authenticated |
| hermes | `hermes` ← installed |
| codex, aider, copilot, cursor-agent, kimi … | not installed |

Fix — switch the agent in `~/open-design/.od/app-config.json`:

```json
{ "agentId": "claude" }
```

Stop the host first (`bash od-host-stop.sh`), edit, then start again — the
daemon rewrites this file while running. A backup is kept at
`app-config.json.bak`.

Verified: the vela error is gone and onboarding offers **Local coding agent**
(now Claude) or **Bring your own key**.

## Two ways to finish onboarding

**Local coding agent** — zero config. Uses the `claude` CLI already on your
PATH and already signed in. Nothing else needed.

**Bring your own key, pointed at OmniRoute** — free, no real key. On the BYOK
screen choose **OpenAI** as the provider and enter:

| Field | Value |
|---|---|
| API key | `free-local` |
| Base URL | `http://localhost:20128/v1` |
| Model | `oc/deepseek-v4-flash-free` |

OmniRoute is OpenAI-compatible, so Open Design treats it as a normal provider
and every request stays on your machine at no cost. Requires `omniroute` to be
running.

---

## Using it from https://thelbertd.github.io/madeea-os/app/opendesign/

This **does** work, but only after one Chrome setting, and the reason is worth
knowing.

Chrome forbids a public https origin from touching anything on your machine.
Measured against the live site with every service running:

```
fetch  →  BLOCKED: Permission was denied for this request to access the
          loopback address space
iframe →  0 frames loaded
```

Private Network Access used to be a header handshake — answer the preflight
with `Access-Control-Allow-Private-Network: true` and the call is allowed.
`tools/bridge.mjs` sends exactly that header, and Chrome **still** refuses:
as of Chrome 150 this is a per-site *permission*, not a header negotiation.

With the check disabled, the same live page works completely:

```
via bridge :20129   OK 200
direct :20128       OK 200
opendesign :7455    OK 200
iframe on 7456      1 frame loaded
```

### Turn it on (once)

1. `chrome://flags/#local-network-access-checks` → **Disabled**
2. `chrome://flags/#block-insecure-private-network-requests` → **Disabled**
3. Relaunch Chrome

Only do this if you are comfortable with it — it relaxes a browser protection
for every site, not just this one. Serving the pages locally needs no such
change, which is why that is the recommended route.

### Start everything

```bash
node tools/start-all.mjs
```

Brings up OmniRoute, the Open Design host, the bridge and the local page host,
skipping anything already running, then prints what is actually up.
