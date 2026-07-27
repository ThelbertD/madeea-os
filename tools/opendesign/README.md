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
