// OmniRoute integration — routes the Codex and Free Claude Code agents through
// the local OmniRoute gateway (http://localhost:20128) so they build for FREE
// across 90+ free providers, instead of a paid API or the (uninstalled)
// fcc-server. OmniRoute speaks BOTH protocols the CLIs need:
//   • /v1/messages  (Anthropic)  ← the `claude` CLI  (Free Claude Code)
//   • /v1/responses (OpenAI)     ← the `codex` CLI
//
// All verified live: big-pickle drives both. The catch with the free reasoning
// models is they loop unless told to answer immediately — hence OMNIROUTE_STEER.

// 127.0.0.1, not localhost. Node resolves localhost to ::1 first on Windows,
// and over IPv6 this gateway answers 200 with an EMPTY completion rather than
// refusing the connection — so every caller saw a successful request that
// returned nothing, which looks like a broken model instead of a broken host.
// Same request to 127.0.0.1 returns normally.
export const OMNIROUTE_BASE = process.env.OMNIROUTE_BASE_URL || "http://127.0.0.1:20128";
// Proven-reliable free coding model on this gateway (deepseek-v4-flash loops).
export const OMNIROUTE_FREE_MODEL = process.env.OMNIROUTE_MODEL || "oc/big-pickle";
// Dummy key — the free providers are keyless, but the CLIs require *something*.
export const OMNIROUTE_KEY = process.env.OMNIROUTE_API_KEY || "free-local";

// Without this, the free reasoning models deliberate until they exhaust the
// token budget and never act. This cuts reasoning from ~4000 tokens to ~100 and
// makes them actually write files / run tools.
export const OMNIROUTE_STEER =
  "Answer immediately and act. Do NOT overthink or deliberate at length. When the task needs a file written or a command run, use your tools right away, then stop. Keep reasoning to an absolute minimum.";

const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;
function safeModel(model?: string | null): string {
  return model && MODEL_RE.test(model) ? model : OMNIROUTE_FREE_MODEL;
}

// `codex exec` provider flags — defines an "omniroute" provider inline (no need
// to touch ~/.codex/config.toml, so your own Codex setup is untouched).
// wire_api MUST be "responses": codex-cli ≥0.142 dropped chat-completions.
export function omnirouteCodexArgs(model?: string | null): string[] {
  return [
    "-c", "model_provider=omniroute",
    "-c", "model_providers.omniroute.name=OmniRoute",
    "-c", `model_providers.omniroute.base_url=${OMNIROUTE_BASE}/v1`,
    "-c", "model_providers.omniroute.wire_api=responses",
    "-c", "model_providers.omniroute.env_key=OMNIROUTE_API_KEY",
    "--model", safeModel(model),
  ];
}
export function omnirouteCodexEnv(): Record<string, string> {
  return { OMNIROUTE_API_KEY: OMNIROUTE_KEY };
}

// ── Direct OpenRouter path (HY3 free window) ────────────────────────────────
// Same inline-config trick as OmniRoute, but pointed at OpenRouter's /responses
// endpoint with the real key from the server env. Used for models OmniRoute
// doesn't carry — first user: tencent/hy3:free (Tencent's 295B, free ~2 weeks).
export const OPENROUTER_HY3_MODEL = "tencent/hy3:free";
export function openrouterCodexArgs(model?: string | null): string[] {
  const m = model && MODEL_RE.test(model) ? model : OPENROUTER_HY3_MODEL;
  return [
    "-c", "model_provider=openrouter",
    "-c", "model_providers.openrouter.name=OpenRouter",
    "-c", "model_providers.openrouter.base_url=https://openrouter.ai/api/v1",
    "-c", "model_providers.openrouter.wire_api=responses",
    "-c", "model_providers.openrouter.env_key=OPENROUTER_API_KEY",
    "--model", m,
  ];
}
export function openrouterCodexEnv(): Record<string, string> {
  return { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "" };
}

// ── Native OpenAI path — the REAL Codex on the user's ChatGPT OAuth login ──────
// No OpenRouter / no OmniRoute, no API key. Auth comes from `codex login`
// (~/.codex/auth.json, auth_mode=chatgpt). We force model_provider=openai so the
// config.toml default provider (which may be ollama-launch) can't hijack it.
// Default model is gpt-5.6-sol (the frontier agentic-coding tier). The real
// ChatGPT-account ids are gpt-5.6-{sol|terra|luna} — plain "gpt-5.6" is NOT a
// valid id (400). sol=frontier, terra=balanced, luna=fast/cheap. Override via
// CODEX_NATIVE_MODEL.
export const NATIVE_CODEX_MODEL = process.env.CODEX_NATIVE_MODEL || "gpt-5.6-sol";

/* Two ways to reach OpenAI, chosen by whether a key is configured.
 *
 * With OPENAI_API_KEY set, the provider is declared inline. codex-cli's
 * BUILT-IN "openai" provider does not read that variable — it expects the OAuth
 * session from `codex login` — so passing the key through the environment alone
 * fails with 401 "Missing bearer or basic authentication in header", first over
 * the responses WebSocket and again after it falls back to HTTPS. Declaring the
 * provider with env_key is what actually binds the key to the request. Same
 * inline-config trick used for OmniRoute above, so ~/.codex/config.toml is left
 * untouched either way.
 *
 * Without a key it stays on the OAuth path, so an existing `codex login` keeps
 * working exactly as before.
 *
 * wire_api must be "responses": codex-cli >= 0.142 dropped chat-completions.
 * gpt-5.6-{sol|terra|luna} are valid on both an API key and a ChatGPT account —
 * it is bare "gpt-5.6" that does not exist. */
function hasOpenAIKey(): boolean {
  return !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
}

export function nativeCodexArgs(model?: string | null): string[] {
  const m = model && MODEL_RE.test(model) ? model : NATIVE_CODEX_MODEL;
  if (!hasOpenAIKey()) return ["-c", "model_provider=openai", "--model", m];
  return [
    "-c", "model_provider=oaikey",
    "-c", "model_providers.oaikey.name=OpenAI",
    "-c", "model_providers.oaikey.base_url=https://api.openai.com/v1",
    "-c", "model_providers.oaikey.wire_api=responses",
    "-c", "model_providers.oaikey.env_key=OPENAI_API_KEY",
    "--model", m,
  ];
}

export function nativeCodexEnv(): Record<string, string> {
  // Blank any OpenRouter key so a stray env cannot divert this onto a different
  // paid path. The OpenAI key is inherited from the server env rather than
  // passed here, so it is never assembled into a command line.
  const env: Record<string, string> = { OPENROUTER_API_KEY: "" };
  return env;
}


// Env that points the `claude` CLI at OmniRoute's Anthropic endpoint. Setting
// ANTHROPIC_API_KEY is what makes the CLI use the gateway instead of the OAuth
// creds saved by `claude login`.
export function omnirouteClaudeEnv(model?: string | null): Record<string, string> {
  const m = safeModel(model);
  return {
    ANTHROPIC_BASE_URL: OMNIROUTE_BASE,
    ANTHROPIC_API_KEY: OMNIROUTE_KEY,
    ANTHROPIC_AUTH_TOKEN: OMNIROUTE_KEY,
    ANTHROPIC_MODEL: m,
    ANTHROPIC_SMALL_FAST_MODEL: m,
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
  };
}

// Prepend the steer to a prompt (used for both CLIs).
export function withSteer(prompt: string): string {
  return `${OMNIROUTE_STEER}\n\n${prompt}`;
}

// Is the gateway up? Probes the OpenAI model list (cheap, keyless).
export async function probeOmniRoute(): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(`${OMNIROUTE_BASE}/v1/models`, { signal: ctl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}
