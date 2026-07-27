#!/usr/bin/env node
/**
 * Injects omni-shim.js into every page of the static export.
 *
 * The shim must patch window.fetch BEFORE any Next.js bundle runs, so it goes
 * in as the first <script> in <head> and is NOT deferred.
 *
 *   node tools/inject-shim.mjs [appDir] [basePath]
 *   node tools/inject-shim.mjs                     # app  /madeea-os/app
 *
 * NOTE: do not pass basePath from Git Bash — MSYS rewrites a leading-slash
 * argument into a Windows path (it once produced
 * "C:/Program Files/Git/madeea-os/app/omni-shim.js" and the shim never
 * loaded). The default below is correct; override only from PowerShell/cmd,
 * or set BASE_PATH in the environment.
 *
 * Re-running is safe: any previously injected tag is stripped first, so a bad
 * path self-heals instead of being skipped as "already present".
 */
import { readFileSync, writeFileSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = process.argv[2] || 'app';
const rawBase = process.argv[3] || process.env.BASE_PATH || '/madeea-os/app';
const basePath = rawBase.replace(/\/+$/, '');

if (/^[A-Za-z]:/.test(basePath) || basePath.includes('Program Files')) {
  console.error(`refusing mangled basePath "${basePath}" — run without the argument, or set BASE_PATH`);
  process.exit(1);
}

const SHIM = 'omni-shim.js';
const TAG = `<script src="${basePath}/${SHIM}"></script>`;
const ANY_TAG = /<script src="[^"]*omni-shim\.js"><\/script>/g;

copyFileSync(join(here, SHIM), join(appDir, SHIM));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

let injected = 0, repaired = 0, skipped = 0;
for (const file of walk(appDir)) {
  let html = readFileSync(file, 'utf8');
  if (!html.includes('<head>')) { skipped++; continue; }

  const had = ANY_TAG.test(html);
  ANY_TAG.lastIndex = 0;
  if (had) html = html.replace(ANY_TAG, '');

  writeFileSync(file, html.replace('<head>', '<head>' + TAG), 'utf8');
  if (had) repaired++; else injected++;
}

console.log(`shim → ${TAG}`);
console.log(`injected ${injected}, repaired ${repaired}, skipped ${skipped}`);
