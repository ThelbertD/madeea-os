# MadeEA OS — local changes

Everything below was applied on top of the upstream Agent OS pack
(build `2026-07-21`) on **27 July 2026**.

> ⚠️ **`Update Agent OS` replaces app code.** `UPDATE.md` states an update keeps
> your settings, keys and vault but swaps the application source. That means the
> four source edits below **will be lost on the next pack update** and must be
> re-applied. This file is the record of what to re-do.

---

## 1. Rebrand: Agentic OS → MadeEA OS

Palette sampled from `../MadeEA Hub/tailwind.config.ts` — deep navy with a single
hot-orange accent, replacing the stock "Midnight Aubergine" theme.

| Token | Upstream | MadeEA |
|---|---|---|
| `--bg-deep` | `#15101a` | `#09141f` |
| `--bg-mid` | `#1c1622` | `#0e1f2f` |
| `--bg-card` | `#251d2c` | `#15293b` |
| `--bg-elev` | `#2e2436` | `#1c3247` |
| `--gold` (accent) | `#d4a574` | `#fd5812` |
| `--gold-soft` | `#e6c69a` | `#ff7a42` |
| `--gold-deep` | `#a87f54` | `#c4400a` |
| `--cream` (fg) | `#f3ebda` | `#f4f4f5` |
| `--cream-soft` | `#ddd0bb` | `#c3cfda` |
| `--cream-dim` | `#a59783` | `#a3b3c2` |
| `--cream-mute` | `#6e6353` | `#6b7d8f` |

Token *names* were kept deliberately — hundreds of components reference
`--cream` and `--gold`, so rebranding stayed a values-only swap.

**Files touched:**
- `source/src/app/globals.css` — `:root` palette, panel/grid tokens, ambient
  gradients, body font → DM Sans
- `source/src/components/Sidebar.tsx` — wordmark now `MadeEA OS`, display face
  → Cormorant Garamond. The `OS` picks up `--gold` from the `.hand` rule.
- `source/src/app/layout.tsx` — page title, plus DM Sans + Cormorant Garamond
  added to the Google Fonts request
- `source/src/components/MediaView.tsx` — spoken welcome line

**Plus a sweep of 33 files / 140 replacements.** Swapping `:root` alone was not
enough: components hardcoded the old palette inline, outside the token system
(`RadarView.tsx` had 19 occurrences, `TodoPanel.tsx` 17). Re-run after an update:

```bash
cd source
grep -rl "#d4a574\|#f3ebda\|#15101a\|#1c1622\|#251d2c\|#2e2436\|#e6c69a\|#ddd0bb\|#a59783" src
```

**Left alone on purpose:** 17 references to the vault path `Agentic OS/…`
(e.g. `Agentic OS/Goals.md`). Those are real Obsidian folder names, not
branding — renaming them would orphan saved notes.

---

## 2. Bug fix — Mastermind crashed on any OpenAI-compatible endpoint

`source/src/lib/agentRoom.ts` (~line 170)

`openaiChat()` parses a single JSON body via `r.json()`, but never sent
`stream: false`. OpenRouter defaults to non-streaming so this never showed up
upstream. OmniRoute defaults to **SSE**, so every reply failed with:

```
SyntaxError: Unexpected token 'd', "data: {"id"... is not valid JSON
```

Fix — add `stream: false` to the request body. Harmless for other providers,
and correct given the function's contract.

---

## 3. Bug fix — hydration error overlay on every page load

`source/src/app/layout.tsx`

The ColorZilla browser extension injects `cz-shortcut-listen="true"` onto
`<body>` before React hydrates, so server and client markup disagreed and the
dev error overlay covered the dashboard. Fix — `suppressHydrationWarning` on
`<body>`. It only suppresses that element's own attributes, so genuine
hydration bugs inside components still surface.

---

## 4. Free AI wiring — OmniRoute

[OmniRoute](https://github.com/diegosouzapw/OmniRoute) v3.8.48 runs locally on
`http://localhost:20128` and routes to free providers with no API key.

```bash
npm install -g omniroute && omniroute   # leave running
```

Wired up in two places:

- **`source/.env.local`** (gitignored — see `.env.local.example`) points the
  OmniRoute paths and the Local tab at the gateway.
- **`~/.agentic-os/config.json`** repoints all seven AI Agent Mastermind agents
  via the pack's supported `roomAgents` override — no source edit needed. This
  file lives outside the repo; a copy is at `config/agentic-os.config.json`.

**Verified working:** OmniRoute tab, Free Claude Code, AI Agent Mastermind
(all 7 agents), Local tab.

### Model choice — read this before debugging

OmniRoute advertises **99 models**; on 27 Jul 2026 exactly **one** answered:
`oc/deepseek-v4-flash-free` (4/4 consecutive successes).

| Family | State |
|---|---|
| `aug/*` (12) | needs the `auggie` CLI installed locally — absent |
| `ddgw/*` (6) | DuckDuckGo, rate-limited (`ERR_RATE_LIMIT`, VQD token failures) |
| `tllm/*` (26) | all HTTP 403 |
| `auto/*` combos | valid but exhausted — "Maximum combo retry limit reached" |
| `oc/big-pickle` | **the pack's own default** — HTTP 500, though it worked 20 min earlier |
| `auto/gemini`, `auto/llama`, `auto/glm` | listed in `/v1/models` but **not valid combos** at chat time |

Free pools fluctuate. When replies start failing, find a live model:

```bash
curl -s http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"oc/big-pickle","messages":[{"role":"user","content":"hi"}],"stream":false}'
```

Then swap the winner into both `source/.env.local` and
`~/.agentic-os/config.json`.

### What OmniRoute cannot cover

It routes **LLM chat only**. These still need their own keys, and no gateway
substitutes for them:

| Needs | Tab |
|---|---|
| `OPENAI_API_KEY` | Thumbnails (gpt-image-2) |
| `ELEVENLABS_API_KEY` | Jarvis voice / TTS |
| `SUNO_API_KEY` | Music Studio |
| `HUNTER_API_KEY`, `FIRECRAWL_API_KEY` | Leads |
| `YT_API_KEY` | Astros |

Separately, **Fusion, MoA, Loop, Hy3, Radar and Hermes have
`https://openrouter.ai` hardcoded** across ~10 files. Repointing the base URL
alone would not work — they request OpenRouter-specific model ids such as
`anthropic/claude-opus-4.8`, which OmniRoute does not expose. Those genuinely
want an `OPENROUTER_API_KEY`.

---

## 5. Security note — the gateway is not localhost-only

OmniRoute binds **`0.0.0.0:20128`**, not `127.0.0.1`. Anyone on the same
network — café, hotel, office Wi-Fi — can reach `http://<your-ip>:20128` and
use it. The pack's README says "everything runs on YOUR computer", which holds
for the dashboard (locked to localhost) but **not** for this gateway.

---

## Related

`omniroute-team-hub/` is excluded from this repo — it is a separate project
with its own repository: <https://github.com/ThelbertD/omniroute-team-hub>
