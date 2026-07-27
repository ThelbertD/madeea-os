# Deploying to Vercel

The `/app/` dashboard is a Next **static export** built with
`basePath: '/madeea-os/app'`, because GitHub Pages serves this repo from
`https://thelbertd.github.io/madeea-os/`. Every asset URL in the HTML is
absolute and carries that prefix.

Vercel serves the repo at the **domain root**, where `/madeea-os` does not
exist — so without help every asset 404s and you get unstyled markup:

```
/app/                       200   ← the HTML loads
/madeea-os/app/_next/…css   404   ← what the HTML asks for
/app/_next/…css             200   ← where the file actually is
```

`vercel.json` fixes it by rewriting `/madeea-os/*` → `/*`, so one build serves
both hosts. GitHub Pages ignores the file.

## The URL must keep the /madeea-os/ prefix

The build hard-codes `basePath: /madeea-os/app`. Served at a path that does not
match, Next's router disagrees with the server-rendered HTML and React throws
a hydration error (#418) on every page:

| URL | result |
|---|---|
| `/app/` | 1 hydration error |
| `/madeea-os/app/` | clean |

So the canonical address here is
**https://madeea-os.vercel.app/madeea-os/app/**, and `vercel.json` redirects
`/` and `/app/*` there. Redirects run before rewrites, so there is no loop.

## Settings

| Setting | Value |
|---|---|
| Framework Preset | **Other** |
| Root Directory | *(leave blank — repo root)* |
| Build Command | *(none)* |
| Output Directory | *(none)* |

It is a static repo; there is nothing to build. If Vercel tries to run a build
it will fail — the Next source lives in `source/`, which is the desktop app and
is not what gets deployed.

## Gotcha

`vercel.json` is validated strictly. Unknown top-level keys — including a
`_comment` — make the deployment fail, and the previous deployment stays live.
That looks exactly like "my change did nothing". Check the Deployments tab for
a failed build before assuming a caching problem.

## The AI tabs

They will not work from `*.vercel.app` any more than from GitHub Pages: Chrome
blocks a public https origin from reaching services on your machine. See
`tools/opendesign/README.md`. Run `node tools/start-all.mjs` and use
`http://localhost:4173/madeea-os/app/` for a fully working dashboard.

---

## Connecting the deployed site to your machine

The AI tabs need services running on your computer, and a browser forbids a
public https page from reaching localhost. As of Chrome 150 that is a per-site
**permission** — measured, including with `Access-Control-Allow-Private-Network`
set, which used to be sufficient:

```
fetch  →  BLOCKED: Permission was denied for this request to access the
          loopback address space
iframe →  0 frames loaded
```

A tunnel removes the problem rather than working around it: published at an
https address, the page is making an ordinary cross-origin request.

```bash
node tools/tunnel.mjs
```

Starts the bridge with a fresh token, tunnels it, and prints one link to open
once. The page stores the address and token and clears them from the URL.

**Verified from https://madeea-os.vercel.app in stock Chrome, no flags:**

| | |
|---|---|
| OmniRoute | `Gateway live · 99 models` |
| Mastermind | real reply — *"Hi from Codex here."* |
| Open Design status | `healthy: true` |
| Open Design **embed** | does not load — see below |

The studio's own UI navigates to its `127.0.0.1` origin, which a public page
cannot follow. Its status reports correctly, but the embed only works at
`localhost:3737`.

⚠ **The tunnel URL is public.** The token is what keeps your gateway private,
so do not paste the link anywhere shared. Quick tunnels are ephemeral — the
URL dies when you stop the process, and a new one is issued next time.
