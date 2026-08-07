# Windows setup

Getting MadeEA OS running on Windows from a fresh clone.

The shipped `.command` launchers are macOS shell scripts and do nothing here —
this is the Windows path. Every problem in Troubleshooting is one that actually
happened during setup, not a precaution.

**Time:** about 30 minutes, most of it waiting on `npm install` and the first
build.

---

## 1. Prerequisites

| | Why |
|---|---|
| **Node.js 24** | `package.json` targets it; the build is memory-tuned for it |
| **Git for Windows** | Supplies `bash.exe`, which some launchers call |
| **A Supabase project** | Sign-in gates the whole dashboard |

Check Node:

```powershell
node -v    # expect v24.x
```

Optional, per feature — nothing below is needed to start the app:

- **OmniRoute** (`npm i -g omniroute`) — chat, the Claude tab, the agent room
- **Codex CLI** — the Codex tab
- **Python 3** — Thumbnails

---

## 2. Clone and install

```powershell
git clone https://github.com/ThelbertD/madeea-os.git
cd madeea-os\source
npm install
```

`npm install` takes a few minutes. `source/` is the application; the `app/`
folder at the repo root is generated output — never edit it by hand.

---

## 3. Configure

```powershell
copy .env.example .env.local
```

Open `.env.local` and set the two required values from your Supabase project
(Settings → API):

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Everything else in that file is optional and switches on one feature.

`.env.local` is gitignored. `.env.example` is the only one that is committed,
and it holds no values.

**If you plan to use Codex**, set this too — it is effectively required on
Windows and the reason is in Troubleshooting:

```
AGENTIC_OS_CODEX_BIN=C:\Users\you\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe
```

---

## 4. Database

Run these once in the Supabase SQL editor, in order. Each is safe to re-run.

| File | Creates |
|---|---|
| `source/supabase/migrations/0001_omniroute_workspace.sql` | saved builds and chat sessions |
| `source/supabase/migrations/0002_avatars.sql` | the avatars storage bucket |
| `source/supabase/migrations/0003_team.sql` | team members and invitations |

Confirm row-level security is on before trusting any of it with data — the anon
key is public, and RLS is the only thing protecting these rows:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public'
  and tablename like 'omniroute_%' or tablename like 'workspace_%';
```

Every row must read `true`.

---

## 5. Run it

Development, with hot reload:

```powershell
npm run dev
```

Production, which is what the launcher and the scheduled task use:

```powershell
npm run build
npm start
```

Either way: **http://localhost:3000**

The server refuses to start if a required variable is missing, and names it.
That is deliberate — the alternative was discovering it on whichever page
happened to need it.

### Starting it without a terminal

`start-backend.cmd` at the repo root runs the production server and logs to
`%LOCALAPPDATA%\madeea-os-backend.log`.

---

## 6. First sign-in

Sign-in is Supabase, and **email confirmation is on by default**. Create your
account in the Supabase dashboard under Authentication → Users, and tick
**Auto Confirm User** — otherwise the account exists but cannot sign in, and the
error looks like a wrong password.

Without custom SMTP configured, Supabase only delivers mail to members of your
Supabase organisation, so confirmation links will not reach outside addresses.

---

## 7. Check your work

```powershell
npm run typecheck    # tsc, no emit
npm run lint         # reports; not currently a gate
npm run build        # production build
npm run smoke        # boots the built server and exercises six routes
npm run verify       # all four in order
```

`npm run smoke` is the quickest honest answer to "is it actually working" — it
starts the built server on a spare port, checks the routes whose failure would
make the app useless, and exits non-zero if any fail.

---

## Troubleshooting

### Codex returns 500 "codex is not installed or not configured"

Set `AGENTIC_OS_CODEX_BIN` to the full path of `codex.exe`. The resolver falls
back to a PATH lookup that does not find the Windows install, **even when
`codex --version` works in your terminal**. The error mentions installation, so
it reads like a missing CLI or a bad API key; it is neither.

That route streams NDJSON, so the failure arrives as an **empty body**. Check
the status code, not the output.

### The build is killed with no error, or the machine locks up

Use webpack rather than Turbopack:

```powershell
$env:NODE_OPTIONS="--max-old-space-size=3072"; npx next build --webpack
```

Turbopack's native allocation is not bounded by `--max-old-space-size`, so on a
memory-constrained machine it is OOM-killed with nothing useful printed. Raising
the heap makes this **worse**, not better — a larger ceiling lets memory grow
until the OS kills the process.

### A `.cmd` file prints `'Open' is not recognized as an internal or external command`

The file has LF line endings. `cmd.exe` needs CRLF and mis-parses without them.
Convert it:

```powershell
$p = "path\to\file.cmd"
[IO.File]::WriteAllText($p, ([IO.File]::ReadAllText($p) -replace "`r`n","`n" -replace "`n","`r`n"))
```

### The production build fails type-checking a file nobody wrote

Something under `.next/dev/types` or `.next/types`. Those are generated by the
dev server and are pulled in by `tsconfig`; killing `next dev` mid-write leaves
one truncated. Delete the folder and rebuild:

```powershell
Remove-Item -Recurse -Force .next\dev
```

### A route module fails with "Property 'X' is incompatible with index signature"

A route file exports something other than the names Next.js allows (`GET`,
`POST`, `runtime`, `dynamic`, …). Stop exporting it or move it to a `lib` file.
`next dev` accepts this; the production build does not.

### The OmniRoute panel says "Gateway offline"

Locally: the gateway is not running. Start it with `omniroute serve` and confirm
`http://127.0.0.1:20128/v1/models` answers.

On a **published** page this is expected and not a fault — a browser is not
allowed to call `http://localhost` from an https page. See `RUNNING.md`.

### Services started by a scheduled task die immediately

They inherit the launching console and are killed with it — the task reports
`3221225786` (`STATUS_CONTROL_C_EXIT`). Start them detached:

```powershell
Start-Process node -ArgumentList '...' -WindowStyle Hidden
```

---

## What will not work on Windows

- The `.command` files — macOS only
- Any agent whose CLI is not installed. Those tabs render and do nothing

## Where things live

| Path | |
|---|---|
| `source/` | the application — edit here |
| `app/` | generated static export — never edit |
| `source/supabase/migrations/` | database setup |
| `RUNNING.md` | services, ports, autostart, the export build |
| `RELEASE_CHECKLIST.md` | outstanding production blockers |
