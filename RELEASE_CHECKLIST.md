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

## Note on tasks 1–5

All five are changes in the OpenAI and Supabase dashboards — rotating a key,
confirming users, toggling signup, adding SMTP credentials. None can be done
from this repository, and none should be automated with a stolen-able
credential. Tasks 6, 7 and 8 are entirely in the codebase and need nothing from
you.
