# Running MadeEA OS

There are two different things in this repo that both call themselves the app, and
picking the wrong one is the single most confusing failure mode.

| | `app/` (static export) | `source/` (Next.js server) |
|---|---|---|
| Has `/api/*` route handlers | **No** | Yes |
| How OmniRoute is reached | `omni-shim.js`, from the browser | server-side, over `127.0.0.1` |
| Works on an https origin | **No** (see below) | Yes |
| What GitHub Pages / Vercel serve | this | — |

## Why the deployed page says "Gateway offline"

The static export has no server, so `app/omni-shim.js` patches `fetch` and answers
`/api/*` in the browser by calling the OmniRoute gateway directly. On an **https**
origin it refuses to even try:

```js
function localBlocked() {
  return location.protocol === 'https:' && !isRemoteBridge();
}
```

Chrome's Private Network Access check blocks an https page from calling
`http://localhost`, and no header on the gateway can change that. Worse, even if it
were allowed, a visitor's browser would be looking for a gateway on *their* machine.

**This is not a bug and cannot be fixed by configuration.** To use OmniRoute from a
shareable URL, serve `source/` (which reaches the gateway server-side) and expose
*that*, or host the gateway somewhere public.

## Services and ports

| Service | Port | Needed for |
|---|---|---|
| MadeEA OS server | 3000 | the UI and every `/api/*` route |
| OmniRoute gateway | 20128 | OmniRoute chat, Codex, Free Claude, OpenClaw |
| OpenClaw gateway | 3002 | the OpenClaw tile in Fleet |
| OpenSEO | 3001 | OpenSEO tile |
| Open Design | 5173 | Open Design tile |
| Video Editor | 5182 | Video Editor tile |

OmniRoute is the critical one — MadeEA OS chat and OpenClaw both route through it.

## Autostart

Three Windows scheduled tasks, all at logon:

| Task | Launcher |
|---|---|
| `MadeEA OS Backend` | `start-backend.cmd` (this repo) |
| `OmniRoute Gateway` | `~/.omniroute/start-gateway.cmd` |
| `OpenClaw Gateway` | installed by `openclaw onboard --install-daemon` |

`omniroute autostart enable` is **Linux-only** (systemd). On Windows it fails with
"The system cannot find the path specified" and leaves `enabled=false` — hence the
scheduled task instead.

To start anything by hand:

```
start-backend.cmd                      # MadeEA OS on 127.0.0.1:3000
%USERPROFILE%\.omniroute\start-gateway.cmd
```

Logs: `%LOCALAPPDATA%\madeea-os-backend.log`, `%LOCALAPPDATA%\omniroute-gateway.log`.

## Building

```
cd source
npx next build --webpack
```

`--webpack` is deliberate. Turbopack's native (Rust) memory is not bounded by
`--max-old-space-size`, so on a memory-constrained machine the build gets OOM-killed
with no useful error. Webpack is slower but stays within a heap you can cap.

Two build gotchas worth knowing:

- A route module may only export the names Next.js knows (`GET`, `POST`, `runtime`,
  `dynamic`, …). Exporting anything else fails the production type check with
  *"Property 'X' is incompatible with index signature"* even though `next dev`
  accepts it.
- `tsconfig.json` includes `.next/dev/types/**/*.ts`. If a dev server is killed
  mid-write those generated files can be left truncated, and the production build
  then fails type-checking on a file nobody wrote. Delete `.next/dev` and rebuild.

## OpenClaw

Runs against the local OmniRoute gateway rather than a paid Anthropic key:

```
openclaw onboard --non-interactive --accept-risk --flow quickstart \
  --auth-choice custom-api-key \
  --custom-base-url http://127.0.0.1:20128 \
  --custom-compatibility anthropic \
  --custom-model-id oc/big-pickle \
  --gateway-port 3002 --gateway-bind loopback --install-daemon
```

`--gateway-port 3002` is load-bearing: `src/lib/fleet.ts` probes that port, so
without it the tile stays red no matter how healthy the daemon is.

## Workspace storage

Saved builds and chat sessions go to Supabase when the caller is signed in, and to
`~/.agentic-os/omniroute-workspace` otherwise. Run
`source/supabase/migrations/0001_omniroute_workspace.sql` once in the Supabase SQL
editor to create the tables.

The route authenticates with the **caller's own access token**, forwarded as a bearer
header — never a service-role key, which would bypass RLS entirely. Confirm RLS is on
before trusting it with anything:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public'
  and tablename in ('omniroute_builds', 'omniroute_sessions');
```

A signed-out or expired session silently falls back to disk rather than erroring, so
**absence of an error is not proof rows are reaching Supabase** — check the table.

## Sharing it externally

`cloudflared tunnel --url http://127.0.0.1:3000 --protocol http2` puts the *server*
(not the export) on a public https URL, so OmniRoute works for anyone who opens it.

Caveats worth knowing before relying on it:

- Quick tunnels are best-effort. One died mid-session with
  `control stream encountered a failure while serving`; `--protocol http2` avoids the
  QUIC datagram path that failed.
- Stopping cloudflared destroys the hostname permanently — a restart mints a new one.
- The tunnel is a new origin, so you must sign in again there. Use **password**
  sign-in; a magic link redirects to a URL Supabase has not allowlisted.
- Everything still runs on this machine. It must stay awake.
