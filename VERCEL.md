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
