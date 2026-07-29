# SEO content packs

A **pack** is a folder in here holding a `blog-post*.md` writing skill — the
rules for how one client's articles should be written.

The stock skill that ships with the pack targets the original author's own
five-site funnel, complete with his offers and CTAs. That is wrong for anyone
else, and rewriting it by hand each time is worse. A pack replaces it.

## How the SEO tab picks one

`src/lib/seoPipeline.ts` resolves the writing skill in this order:

1. `blogPostSkill` in `~/.agentic-os/seo-sites.json` — an explicit path wins.
2. `pack` in the same file — selects a folder in here by name.
3. The first pack found alphabetically.
4. The stock skill next to the first configured site.

So dropping a pack in here is usually enough. Restart the dev server
afterwards — the config and pack list are read once at startup.

## Installing one

```bash
git clone <pack-repo> packs/<pack-name>
```

Then point the pipeline at it:

```json
{
  "pack": "<pack-name>",
  "sites": [
    {
      "id": "example",
      "name": "example.com",
      "url": "https://example.com",
      "path": "/absolute/path/to/site-repo",
      "postsDir": "/absolute/path/to/site-repo/src/blog/posts"
    }
  ]
}
```

Save that as `~/.agentic-os/seo-sites.json` and restart.

The **Skill** tab shows the active skill, so you can confirm which pack is
live without reading any files.

## Building one

A pack needs one file: `blog-post-<name>.md`, a skill describing the client's
voice, audiences, structure and any schema requirements. Everything else —
sample articles, a config template, a README — is optional and only there to
help whoever installs it.

## Why this folder is gitignored

A pack encodes a client's positioning, keyword strategy and contact details.
This repository is public. Packs are cloned per-install and must never be
committed here; keep each one in its own private repo.

Only this README is tracked.
