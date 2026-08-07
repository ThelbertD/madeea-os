# Release Checklist — Madeea OS

Blockers from the production readiness audit of 7 August 2026, in priority
order. No new features; no architecture changes.

Status is one of **Done** (implemented and verified), **Blocked** (waiting on
something only the account owner can do), or **Not started**. A task is not
Done until its verification line records an actual observed result.

| # | Task | Status |
|---|------|--------|
| 1 | Rotate the exposed OpenAI API key | **Blocked — needs you** |
| 2 | Fix authentication for existing team members | Not started |
| 3 | Configure Supabase authentication correctly | Not started |
| 4 | Disable public signup | Not started |
| 5 | Configure SMTP for production | Not started |
| 6 | `.env.example` covering every required variable | Not started |
| 7 | Validate environment variables at startup | Not started |
| 8 | Windows setup guide | Not started |

---

## 1. Rotate the exposed OpenAI API key — **Blocked**

**Why it is first.** The key was exposed twice: once in a screenshot, once
pasted as chat text. Verified on 7 Aug 2026 that it is **still active**
(`GET /v1/models` → 200). Anyone holding either copy can spend against the
account right now.

**Why I cannot do it.** Creating and revoking keys requires signing in to the
OpenAI account. There is no API for it, and it is not something to automate on
someone's behalf.

**What you do**

1. platform.openai.com → API keys.
2. Revoke the key ending **`…9Ojx8A`**.
3. Create a replacement.
4. Tell me, and I will swap it in — or edit `source/.env.local` yourself:
   replace the value on the `OPENAI_API_KEY=` line, save, restart the server.

`source/.env.local` is gitignored — confirmed — so no key has ever reached
GitHub. Nothing else needs changing: the Codex wiring reads the variable, so a
new value works with no code change.

**Verification** — after rotation, both must hold:

- the old key returns **401**
- Codex still answers (`/api/codex/chat` with `engine: "gpt56"` → 200)

**Recorded result:** _pending rotation_

---

## 2–8

Not started. Each will be filled in here as it is completed, with the command
run and the result observed.

---

# Production engineering

Separate from the eight blockers above. No features; quality only.

| Item | Status |
|------|--------|
| GitHub Actions CI | **Done** |
| Automated build verification | **Done** |
| Lint | **Done — non-blocking** |
| Typecheck | **Done** |
| Production build | **Done** |
| Smoke tests | **Done** |
| Logging | **Done** |
| Error handling | **Partial** |

### CI — `.github/workflows/ci.yml`
Runs on push and PR to `main`. Install → typecheck → lint → build → smoke.
Typecheck, build and smoke block; lint does not (see below).

**Verified:** every step was run locally first. Not yet observed on a GitHub
runner — the first push is its own first test.

### Typecheck — `npm run typecheck`
**Verified:** `tsc --noEmit` → exit 0.

### Lint — `npm run lint`
ESLint 9 flat config with `eslint-config-next` 16's native flat exports. Not
routed through `FlatCompat`, which dies on the React plugin's circular
reference with "Converting circular structure to JSON".

**Verified:** runs, exit 1, **210 problems (138 errors / 72 warnings)**.
92 of the errors are one rule, `react-hooks/set-state-in-effect`, in components
written before any linter existed.

**Non-blocking on purpose.** A pipeline that is red on every PR for pre-existing
style gets ignored. The baseline is recorded in the workflow; make it blocking
when it reaches zero.

### Production build — `npm run build`
**Verified:** exit 0, and `.next/server/instrumentation.js` present, so the
error hook is in the output rather than merely in the source.

### Smoke tests — `npm run smoke`
Boots the built server on a spare port and exercises six routes. No framework
and no new dependency. Asserts nothing needing the gateway, a Supabase session
or a CLI, because a CI runner has none of those.

**Verified:** `all 6 checks passed`, exit 0.

### Logging — `src/lib/log.ts`
JSON lines, level via `LOG_LEVEL`, no dependency. Keys matching
`key|token|secret|password|authorization|cookie|bearer` are redacted, because
logs get pasted into issues.

**Verified:** emitted a structured line in the error test below.

### Error handling — `src/instrumentation.ts`
`onRequestError` logs every server error Next captures, with route path, method
and route type. One hook covers all 246 routes including ones not yet written.

**Verified** by reproducing a real failure — a server started without
`AGENTIC_OS_CODEX_BIN`, then `POST /api/codex/chat` with `engine: "gpt56"`:

```
codex gpt56 -> http=500
{"ts":"2026-08-07T19:33:12.020Z","level":"error","msg":"unhandled server error",
 "error":"Error","message":"codex is not installed or not configured. Set
 AGENTIC_OS_CODEX_BIN or install the CLI.","stack":"..."}
```

That is the exact failure that previously surfaced as a 500 with an empty body
and no trace anywhere.

**Why Partial:** this is a safety net, not a fix. **107 of 246 routes still have
no try/catch**, so they still answer with a bare 500 — the difference is that
the reason is now recorded instead of lost. Giving those routes real handling
that returns something useful to the caller is still outstanding.

---

## Note on tasks 1–5

All five are changes in the OpenAI and Supabase dashboards — rotating a key,
confirming users, toggling signup, adding SMTP credentials. None can be done
from this repository, and none should be automated with a stolen-able
credential. Tasks 6, 7 and 8 are entirely in the codebase and need nothing from
you.
