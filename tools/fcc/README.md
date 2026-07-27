# Free Claude Code (install/5) — working setup

## What the guide says vs what this build does

`install/5-FREE-CLAUDE-CODE.md` describes `fcc-server`, a local proxy that
speaks the Anthropic API and routes to free models. **The shipped code had
retired that path** — `src/lib/fcc.ts` said so outright:

```
// kept for reference; the old fcc-server model discovery is retired.
// Free Claude Code now points the `claude` CLI at the OmniRoute gateway
```

That does not work. Pointed straight at OmniRoute the CLI fails:

```
API Error: 400 Ambiguous model 'claude-opus-4-8'.
Use provider/model prefix (ex: cc/claude-opus-4-8 or kie/claude-opus-4-8)
```

The CLI sends bare Anthropic model ids; the gateway will not resolve them.
fcc-server exists precisely to translate that, so the guide was right and the
newer shortcut was not.

## Install

```powershell
& ([scriptblock]::Create((irm "https://raw.githubusercontent.com/Alishahryar1/free-claude-code/main/scripts/install.ps1")))
```

It also pulls in Codex and Pi. On Windows the final step fails under
PowerShell — it wraps `uv`'s progress output as an error — so finish it in
bash:

```bash
uv tool install --force --refresh-package free-claude-code --python 3.14.0 \
  'free-claude-code @ https://github.com/Alishahryar1/free-claude-code/archive/refs/heads/main.zip'
```

Installs `fcc-server`, `fcc-claude`, `fcc-codex`, `fcc-desktop`, `fcc-pi`.

## Config

Copy `dot-fcc-env.example` to `~/.fcc/.env`.

The guide's two options are both unavailable on a fresh machine: Ollama has no
model pulled, and its OpenRouter picks need a key. fcc-server has **no generic
`openai` provider** — it rejects one and lists what it accepts. Two of those,
`lmstudio` and `llamacpp`, are just OpenAI-compatible endpoints with a
configurable base URL, so `lmstudio` is used as the transport and pointed at
OmniRoute:

```
LM_STUDIO_BASE_URL="http://127.0.0.1:20128/v1"
MODEL="lmstudio/oc/deepseek-v4-flash-free"
```

Start it: `fcc-server` (leave running). Admin UI at
<http://127.0.0.1:8082/admin>.

## Two source fixes this needed

**`spawn EINVAL` — every message returned 500.** On Windows the agent CLIs are
`.cmd` shims and Node refuses to spawn them without a shell. `src/lib/runner.ts`
now passes `shell: true` on win32.

**The tab ignored fcc-server.** `fccSpawnEnv()` hard-pointed at OmniRoute.
It is now async, probes `:8082/health` itself, and uses the proxy when it is
up — falling back to the gateway otherwise, so a machine without fcc-server is
unaffected.

## About the cost figure

The stream reports `total_cost_usd` and a `claude-opus-4-8` model. **Nothing is
billed.** That is the CLI's own local estimate, priced from the model name it
believes it is using; fcc-server presents itself as Anthropic, so the CLI does
the sum. The fcc-server log shows where the request really went:

```
POST /v1/messages?beta=true HTTP/1.1  200 OK
```

127.0.0.1:8082 — never Anthropic.
