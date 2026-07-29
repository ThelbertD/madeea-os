import { readdir, readFile, stat } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export interface Site {
  id: string;
  name: string;
  url: string;
  path: string;
  postsDir: string;
}

// The 5-site SEO funnel, mirrored from the blog-post.md skill.
//
// These defaults are the pack author's own sites under his home directory.
// On anyone else's machine none of them exist, so every tab in the SEO
// pipeline failed: Skill 404'd, Transcripts came back empty, and Generate
// would have written five articles into folders that aren't there.
//
// The pack's fix is to hand-edit this array (see seoPipeline.ts.template in
// the SEO Pack), which is lost on every update. Read a config file instead
// and keep these as the fallback.
const DEFAULT_SITES: Site[] = [
  { id: "bestaiagentcommunity",  name: "bestaiagentcommunity.com",   url: "https://bestaiagentcommunity.com",  path: path.join(os.homedir(), "AIProfitBoardroom.com"),         postsDir: path.join(os.homedir(), "AIProfitBoardroom.com", "src/blog/posts") },
  { id: "aiprofitboardroom",     name: "aiprofitboardroom.com",      url: "https://aiprofitboardroom.com",     path: path.join(os.homedir(), "AIProfitBoardroom-main"),         postsDir: path.join(os.homedir(), "AIProfitBoardroom-main", "src/blog/posts") },
  { id: "juliangoldieautomation", name: "juliangoldieaiautomation.com", url: "https://juliangoldieaiautomation.com", path: path.join(os.homedir(), "juliangoldieaiautomation"), postsDir: path.join(os.homedir(), "juliangoldieaiautomation", "src/blog/posts") },
  { id: "aisuccesslab",          name: "aisuccesslabjuliangoldie.com", url: "https://aisuccesslabjuliangoldie.com", path: path.join(os.homedir(), "aisuccesslab"),                postsDir: path.join(os.homedir(), "aisuccesslab", "src/blog/posts") },
  { id: "aimoneylab",            name: "aimoneylabjuliangoldie.com", url: "https://aimoneylabjuliangoldie.com", path: path.join(os.homedir(), "aimoneylab"),                  postsDir: path.join(os.homedir(), "aimoneylab", "src/blog/posts") },
];

const CONFIG_PATH = path.join(os.homedir(), ".agentic-os", "seo-sites.json");

interface SeoConfig {
  sites?: Site[];
  transcriptsDir?: string;
  blogPostSkill?: string;
  pack?: string;
}

function loadConfig(): SeoConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as SeoConfig;
    // A malformed or half-written config should fall back rather than crash
    // every SEO route at import time.
    if (raw.sites && (!Array.isArray(raw.sites) || raw.sites.some((s) => !s?.id || !s?.postsDir))) {
      delete raw.sites;
    }
    return raw;
  } catch {
    return {};
  }
}

const CONFIG = loadConfig();

export const SITES: Site[] = CONFIG.sites?.length ? CONFIG.sites : DEFAULT_SITES;

export const SEO_CONFIG_PATH = CONFIG_PATH;
export const SEO_CONFIGURED = Boolean(CONFIG.sites?.length);

export const TRANSCRIPTS_DIR = CONFIG.transcriptsDir
  ?? path.join(SITES[0]?.path ?? os.homedir(), ".claude", "transcripts");

/* Content packs.
 *
 * A pack is a folder under packs/ holding a `blog-post*.md` writing skill —
 * how a given client's articles should be written. The stock skill targets
 * the pack author's own five-site funnel, which is wrong for anyone else, so
 * a pack lets the SEO tab write in the client's voice instead of needing the
 * skill path wired up by hand.
 *
 * packs/ is gitignored: a pack encodes a client's positioning and strategy
 * and must not land in this public repo. Clone one in per install.
 */
export interface SeoPack { id: string; skillPath: string; }

function discoverPacks(): SeoPack[] {
  // cwd is the Next app (source/), so packs/ sits one level up.
  const dir = path.join(process.cwd(), "..", "packs");
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const skill = readdirSync(path.join(dir, e.name))
          .find((f) => /^blog-post.*\.md$/i.test(f));
        return skill ? { id: e.name, skillPath: path.join(dir, e.name, skill) } : null;
      })
      .filter((p): p is SeoPack => p !== null)
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

export const SEO_PACKS = discoverPacks();

// Explicit config wins; otherwise the first installed pack; otherwise the
// stock skill next to the first site.
export const ACTIVE_PACK = CONFIG.pack
  ? SEO_PACKS.find((p) => p.id === CONFIG.pack) ?? SEO_PACKS[0]
  : SEO_PACKS[0];

export const BLOG_POST_SKILL = CONFIG.blogPostSkill
  ?? ACTIVE_PACK?.skillPath
  ?? path.join(SITES[0]?.path ?? os.homedir(), ".claude", "skills", "blog-post.md");

export interface SiteStats {
  site: Site;
  postCount: number;
  recent: { slug: string; mtime: number; title?: string; date?: string }[];
}

async function listFilesMtime(dir: string, n = 6): Promise<{ name: string; mtime: number }[]> {
  try {
    const items = await readdir(dir);
    const mds = items.filter((f) => /\.md$/.test(f));
    const stats = await Promise.all(mds.map(async (f) => {
      try { const s = await stat(path.join(dir, f)); return { name: f, mtime: s.mtimeMs }; }
      catch { return { name: f, mtime: 0 }; }
    }));
    stats.sort((a, b) => b.mtime - a.mtime);
    return stats.slice(0, n);
  } catch { return []; }
}

async function readFrontMatter(file: string): Promise<{ title?: string; date?: string }> {
  try {
    const data = await readFile(file, "utf8");
    const m = data.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!m) return {};
    const fm = m[1];
    const titleMatch = fm.match(/^title:\s*["']?([^"'\n]+)["']?\s*$/m);
    const dateMatch = fm.match(/^date:\s*["']?([^"'\n]+)["']?\s*$/m);
    return {
      title: titleMatch ? titleMatch[1].trim() : undefined,
      date: dateMatch ? dateMatch[1].trim() : undefined,
    };
  } catch { return {}; }
}

export async function getSiteStats(site: Site): Promise<SiteStats> {
  const recent = await listFilesMtime(site.postsDir, 6);
  let postCount = 0;
  try { postCount = (await readdir(site.postsDir)).filter((f) => /\.md$/.test(f)).length; }
  catch {}
  const enriched = await Promise.all(recent.map(async (r) => {
    const fm = await readFrontMatter(path.join(site.postsDir, r.name));
    return { slug: r.name.replace(/\.md$/, ""), mtime: r.mtime, ...fm };
  }));
  return { site, postCount, recent: enriched };
}

export async function getAllSiteStats(): Promise<SiteStats[]> {
  return Promise.all(SITES.map(getSiteStats));
}

export interface TranscriptMeta { slug: string; bytes: number; mtime: number; preview: string; }

export async function listTranscripts(): Promise<TranscriptMeta[]> {
  try {
    const items = await readdir(TRANSCRIPTS_DIR);
    const txts = items.filter((f) => /\.txt$/.test(f));
    const out: TranscriptMeta[] = [];
    for (const t of txts) {
      const full = path.join(TRANSCRIPTS_DIR, t);
      try {
        const s = await stat(full);
        const head = (await readFile(full, "utf8")).slice(0, 220).replace(/\s+/g, " ").trim();
        out.push({ slug: t.replace(/\.txt$/, ""), bytes: s.size, mtime: s.mtimeMs, preview: head });
      } catch {}
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  } catch { return []; }
}

export async function readTranscript(slug: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) return null;
  const file = path.join(TRANSCRIPTS_DIR, `${slug}.txt`);
  try { return await readFile(file, "utf8"); }
  catch { return null; }
}
