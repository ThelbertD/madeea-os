# D Express Locksmith — SEO pack for MadeEA OS

The SEO content capability from `d-express-locksmith-content-agent`, ported to
run inside MadeEA OS.

## What's inside

- `blog-post-dexpress.md` — the writing skill. Built from three files in the
  Base44 repo: `seo_optimizer.jsonc` (keywords, E-E-A-T, local SEO, schema),
  `blog_content_writer.jsonc` (audiences, topics, client context) and the
  article spec in `src/components/blog/ArticleGenerator.jsx`.
- `seo-sites.json` — pipeline config. Replace every `CHANGE-ME`.
- `sample-article.md` — a real generated article, for reference.

## Install (about 5 minutes)

1. Copy `blog-post-dexpress.md` somewhere stable, e.g. `~/MadeEA-SEO/.skills/`.
2. Create the site folder the pipeline writes into:
   `~/MadeEA-SEO/dexpresslock/src/blog/posts/`
3. Edit `seo-sites.json` — replace each `CHANGE-ME` with your real paths.
   Point `path`/`postsDir` at the actual dexpresslock.com repo when you have
   it checked out locally.
4. Copy it to `~/.agentic-os/seo-sites.json`.
5. Restart the dashboard (`npm run dev`). The config is read once at startup.
6. Open the **SEO** tab. Sites should show `dexpresslock.com`, and the **Skill**
   tab should show this skill rather than the AIPB one.

## Using it

Enter a target keyword and a file slug, then **Generate**. One article is
written per run, to the configured `postsDir`.

Verified spec compliance on a real run (`rekey locks after moving Ambler PA`):
1830 words, 8 H2 sections, exactly 5 FAQs, and LocalBusiness + Service +
FAQPage schema. Meta description landed at 158 chars, inside the 150-160 limit.

## Requirements

- MadeEA OS running locally (`npm run dev`) — this cannot run on a static host.
  Generation spawns the Claude CLI and writes files to disk; GitHub Pages and
  Vercel provide neither.
- The Claude CLI, logged in and working.

## Not included

- **Deploy** needs a Netlify account and `netlify login`.
- **Research** needs Google Search Console OAuth.
- **OpenSEO** needs Docker plus a paid DataForSEO key.

These are account setups, not code.
