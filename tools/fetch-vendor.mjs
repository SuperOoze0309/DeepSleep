#!/usr/bin/env node
/**
 * tools/fetch-vendor.mjs
 * ---------------------------------------------------------------------------
 * Vendors the browser libraries used by the offline Android WebView front-end
 * into app/web/vendor/ so they can be loaded with plain <script> / <link> tags
 * (no bundler, no ES modules, no CDN access at runtime).
 *
 * Usage:
 *   node tools/fetch-vendor.mjs                # download everything, then verify
 *   node tools/fetch-vendor.mjs --verify-only  # verify what is already on disk
 *
 * Sources: jsDelivr (npm mirrors). Versions are PINNED to exact releases so a
 * re-run is reproducible. Library contents are written byte-for-byte: nothing
 * is minified, rewritten, patched or re-encoded by this script.
 * ---------------------------------------------------------------------------
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

// --- layout -----------------------------------------------------------------
const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const VENDOR = path.join(REPO_ROOT, 'app', 'web', 'vendor');
const rel = (p) => path.relative(REPO_ROOT, p).split(path.sep).join('/');

// --- pinned versions (resolved from the jsDelivr ranges @14 / @11 / @0.16) ---
const VERSIONS = {
  'markdown-it': '14.3.2',
  '@highlightjs/cdn-assets': '11.12.0',
  katex: '0.16.47',
};

const JSD = 'https://cdn.jsdelivr.net/npm';
const md = (f) => `${JSD}/markdown-it@${VERSIONS['markdown-it']}/${f}`;
const hljs = (f) => `${JSD}/@highlightjs/cdn-assets@${VERSIONS['@highlightjs/cdn-assets']}/${f}`;
const katex = (f) => `${JSD}/katex@${VERSIONS.katex}/${f}`;

// --- font list: exactly the `url(fonts/KaTeX_*.woff2)` refs in katex.min.css --
const KATEX_WOFF2 = [
  'KaTeX_AMS-Regular.woff2',
  'KaTeX_Caligraphic-Bold.woff2',
  'KaTeX_Caligraphic-Regular.woff2',
  'KaTeX_Fraktur-Bold.woff2',
  'KaTeX_Fraktur-Regular.woff2',
  'KaTeX_Main-Bold.woff2',
  'KaTeX_Main-BoldItalic.woff2',
  'KaTeX_Main-Italic.woff2',
  'KaTeX_Main-Regular.woff2',
  'KaTeX_Math-BoldItalic.woff2',
  'KaTeX_Math-Italic.woff2',
  'KaTeX_SansSerif-Bold.woff2',
  'KaTeX_SansSerif-Italic.woff2',
  'KaTeX_SansSerif-Regular.woff2',
  'KaTeX_Script-Regular.woff2',
  'KaTeX_Size1-Regular.woff2',
  'KaTeX_Size2-Regular.woff2',
  'KaTeX_Size3-Regular.woff2',
  'KaTeX_Size4-Regular.woff2',
  'KaTeX_Typewriter-Regular.woff2',
];

// --- the manifest: source URL -> destination path ---------------------------
// kind drives the sanity checks: 'js' | 'css' are text, 'woff2' is binary.
const MANIFEST = [
  { kind: 'js', lib: 'markdown-it', version: VERSIONS['markdown-it'], url: md('dist/markdown-it.min.js'), dest: 'markdown-it.min.js' },
  { kind: 'js', lib: 'highlight.js', version: VERSIONS['@highlightjs/cdn-assets'], url: hljs('highlight.min.js'), dest: 'highlight.min.js' },
  { kind: 'css', lib: 'highlight.js', version: VERSIONS['@highlightjs/cdn-assets'], url: hljs('styles/github.min.css'), dest: 'highlight-github.min.css' },
  { kind: 'css', lib: 'highlight.js', version: VERSIONS['@highlightjs/cdn-assets'], url: hljs('styles/github-dark.min.css'), dest: 'highlight-github-dark.min.css' },
  { kind: 'js', lib: 'katex', version: VERSIONS.katex, url: katex('dist/katex.min.js'), dest: 'katex.min.js' },
  { kind: 'css', lib: 'katex', version: VERSIONS.katex, url: katex('dist/katex.min.css'), dest: 'katex.min.css' },
  { kind: 'js', lib: 'katex', version: VERSIONS.katex, url: katex('dist/contrib/auto-render.min.js'), dest: 'contrib/auto-render.min.js' },
  ...KATEX_WOFF2.map((f) => ({
    kind: 'woff2',
    lib: 'katex',
    version: VERSIONS.katex,
    url: katex(`dist/fonts/${f}`),
    dest: `fonts/${f}`,
  })),
];

// --- sanity thresholds ------------------------------------------------------
const LIMITS = {
  js: { min: 1024, max: 4 * 1024 * 1024 },
  css: { min: 256, max: 1024 * 1024 },
  woff2: { min: 512, max: 512 * 1024 },
};

const MAGIC = {
  woff2: Buffer.from('wOF2', 'latin1'),
  woff: Buffer.from('wOFF', 'latin1'),
  ttf: Buffer.from([0x00, 0x01, 0x00, 0x00]),
};

// jsDelivr serves text assets as text/*|application/* and fonts as font/*.
// Anything else (notably text/html error pages) is rejected before writing.
const OK_CONTENT_TYPE = {
  js: /^(application\/(javascript|json)|text\/(javascript|plain)|application\/octet-stream)/i,
  css: /^(text\/(css|plain)|application\/octet-stream)/i,
  woff2: /^(font\/|application\/(font|octet-stream|x-font))/i,
};

const verifyOnly = process.argv.includes('--verify-only');
const log = (...a) => console.log(...a);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

class VendorError extends Error {}

/** Make sure a fetched buffer is the real asset and not a 0-byte/HTML error page. */
function assertSane(entry, buf, contentType) {
  const { min, max } = LIMITS[entry.kind];
  const where = `${entry.dest} <${entry.url}>`;

  if (buf.length === 0) throw new VendorError(`${where}: 0 bytes`);
  if (buf.length < min) throw new VendorError(`${where}: suspiciously small (${buf.length} B < ${min} B)`);
  if (buf.length > max) throw new VendorError(`${where}: suspiciously large (${buf.length} B > ${max} B)`);

  if (contentType && !OK_CONTENT_TYPE[entry.kind].test(contentType)) {
    throw new VendorError(`${where}: unexpected content-type "${contentType}"`);
  }

  if (entry.kind === 'js' || entry.kind === 'css') {
    const head = buf.subarray(0, 512).toString('utf8');
    const trimmed = head.replace(/^\uFEFF/, '').trimStart();
    if (trimmed.startsWith('<')) {
      throw new VendorError(`${where}: body looks like an HTML/XML error page: ${JSON.stringify(trimmed.slice(0, 80))}`);
    }
    if (/<!doctype html|<html[\s>]/i.test(head)) {
      throw new VendorError(`${where}: body contains an HTML document`);
    }
  }

  if (entry.kind === 'woff2' && !buf.subarray(0, 4).equals(MAGIC.woff2)) {
    throw new VendorError(`${where}: missing wOF2 magic, got ${JSON.stringify(buf.subarray(0, 8).toString('latin1'))}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Download one manifest entry with up to 3 attempts. */
async function download(entry) {
  const destAbs = path.join(VENDOR, entry.dest);
  let lastErr;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(entry.url, { redirect: 'follow' });
      if (!res.ok) throw new VendorError(`HTTP ${res.status} ${res.statusText}`);
      const buf = Buffer.from(await res.arrayBuffer());
      assertSane(entry, buf, res.headers.get('content-type'));
      await mkdir(path.dirname(destAbs), { recursive: true });
      await writeFile(destAbs, buf);
      log(`  ok   ${entry.dest}  ${buf.length} B  (attempt ${attempt})`);
      return { ...entry, bytes: buf.length, sha256: sha256(buf) };
    } catch (err) {
      lastErr = err;
      log(`  retry ${entry.dest}: attempt ${attempt}/3 failed - ${err.message}`);
      if (attempt < 3) await sleep(400 * attempt);
    }
  }
  throw new VendorError(`FAILED after 3 attempts: ${entry.dest} <${entry.url}>: ${lastErr.message}`);
}

// --- verification -----------------------------------------------------------
/**
 * Re-reads every manifest file from disk and re-checks it, then parses the
 * *on-disk* katex.min.css and proves each url(fonts/...) reference resolves to
 * a real file next to it.
 */
async function verify(results) {
  log('\n=== VERIFY ===');
  const byDest = new Map(results.map((r) => [r.dest, r]));
  const problems = [];
  const sizes = new Map();

  for (const entry of MANIFEST) {
    const abs = path.join(VENDOR, entry.dest);
    let buf;
    try {
      buf = await readFile(abs);
    } catch {
      problems.push(`MISSING on disk: ${entry.dest}`);
      continue;
    }
    sizes.set(entry.dest, buf.length);

    try {
      assertSane(entry, buf, null);
    } catch (err) {
      problems.push(`SANITY: ${err.message}`);
    }

    const prior = byDest.get(entry.dest);
    if (prior && prior.bytes !== buf.length) problems.push(`SIZE DRIFT: ${entry.dest} ${prior.bytes} -> ${buf.length}`);

    const kind = entry.kind === 'woff2' ? 'font' : entry.kind;
    log(`  ${String(buf.length).padStart(8)} B  ${kind.padEnd(4)}  ${entry.dest}`);

    if (entry.kind === 'js' || entry.kind === 'css') {
      const head = buf.subarray(0, 512).toString('utf8').replace(/^\uFEFF/, '').trimStart();
      if (head.startsWith('<')) problems.push(`HTML BODY: ${entry.dest}`);
      else log(`           -> not HTML (starts with ${JSON.stringify(head.slice(0, 40))})`);
    }
  }

  // -- globals existence check (plain <script> tags need these) --------------
  const globals = [
    ['markdown-it.min.js', /markdownit/],
    ['highlight.min.js', /hljs/],
    ['katex.min.js', /katex/],
    ['contrib/auto-render.min.js', /renderMathInElement/],
  ];
  log('\n--- UMD global symbols present in bundle text ---');
  for (const [dest, re] of globals) {
    const abs = path.join(VENDOR, dest);
    try {
      const txt = await readFile(abs, 'utf8');
      const hit = re.test(txt);
      log(`  ${hit ? 'ok  ' : 'MISS'} ${dest}  (~${re.source})`);
      if (!hit) problems.push(`global symbol ${re.source} not found in ${dest}`);
    } catch {
      problems.push(`cannot read for globals check: ${dest}`);
    }
  }

  // -- katex.min.css url() reference resolution ------------------------------
  log('\n--- katex.min.css url() reference check ---');
  const cssAbs = path.join(VENDOR, 'katex.min.css');
  const css = await readFile(cssAbs, 'utf8');
  const refs = [...new Set([...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]))];
  const byExt = new Map();
  for (const r of refs) {
    const ext = (r.match(/\.([a-z0-9]+)$/i) || [, '(none)'])[1].toLowerCase();
    if (!byExt.has(ext)) byExt.set(ext, []);
    byExt.get(ext).push(r);
  }
  log(`  unique url() refs in css: ${refs.length}  (${[...byExt].map(([e, l]) => `.${e}:${l.length}`).join(', ')})`);

  let woff2Checked = 0;
  for (const [ext, list] of byExt) {
    let present = 0;
    const missing = [];
    for (const r of list) {
      // CSS uses paths relative to the stylesheet: vendor/katex.min.css -> vendor/<ref>
      const target = path.resolve(VENDOR, r);
      if (!target.startsWith(VENDOR)) {
        missing.push(`${r} (escapes vendor/)`);
        continue;
      }
      try {
        await readFile(target);
        present++;
        if (ext === 'woff2') woff2Checked++;
      } catch {
        missing.push(r);
      }
    }
    if (ext === 'woff2') {
      log(`  .woff2 refs resolved: ${present}/${list.length}`);
      if (missing.length) problems.push(`unresolved .woff2 refs: ${missing.join(', ')}`);
    } else {
      // .woff/.ttf are legacy fallback formats listed after the woff2 source in
      // each @font-face src list. Chromium/Android WebView always picks the
      // woff2 entry and never requests these, so they are intentionally not
      // vendored (see VERSIONS.md). Reported here for transparency only.
      log(`  .${ext} refs on disk: ${present}/${list.length} - fallback format, intentionally not vendored (not a failure)`);
    }
  }
  log(`  woff2 files referenced by css and present on disk: ${woff2Checked}`);

  const fontCount = [...sizes.keys()].filter((d) => d.startsWith('fonts/') && d.endsWith('.woff2')).length;
  log(`  KaTeX .woff2 files vendored: ${fontCount}`);
  if (woff2Checked !== fontCount) problems.push(`css references ${woff2Checked} woff2 but ${fontCount} are vendored`);

  if (problems.length) {
    log('\nVERIFY FAILED:');
    for (const p of problems) log(`  - ${p}`);
    throw new VendorError(`${problems.length} verification problem(s)`);
  }
  log('\nVERIFY OK - all files present, non-HTML, and all woff2 refs resolve.');
  return { sizes, woff2Checked, fontCount };
}

// --- VERSIONS.md ------------------------------------------------------------
/** @param stats Map<dest, {bytes:number, sha256:string}> */
async function writeVersionsMd(stats, woff2Checked, fontCount) {
  const bytesOf = (d) => stats.get(d).bytes;
  const row = (dest) => {
    const e = MANIFEST.find((m) => m.dest === dest);
    return `| \`${dest}\` | ${e.lib} | ${e.version} | ${bytesOf(dest).toLocaleString('en-US')} | [\`${e.url.replace(/^https:\/\//, '')}\`](${e.url}) |`;
  };
  const header = '| File | Library | Version | Bytes | Source URL |\n| --- | --- | --- | ---: | --- |';
  const core = MANIFEST.filter((m) => m.kind !== 'woff2').map((m) => row(m.dest));

  const fontRows = KATEX_WOFF2.map((f) => `| \`fonts/${f}\` | ${bytesOf(`fonts/${f}`).toLocaleString('en-US')} |`);

  const fontTotal = KATEX_WOFF2.reduce((s, f) => s + bytesOf(`fonts/${f}`), 0);
  const grandTotal = [...stats.values()].reduce((a, v) => a + v.bytes, 0);
  const integrity = MANIFEST.map((m) => `- \`${m.dest}\` sha256 \`${stats.get(m.dest).sha256}\``).join('\n');

  const doc = `# Vendored browser libraries

Offline vendor bundle for the Android WebView front-end. Loaded with plain
\`<script>\` / \`<link>\` tags - no bundler, no ES modules, no network at runtime.

Downloaded by [\`tools/fetch-vendor.mjs\`](../../../tools/fetch-vendor.mjs)
(source: [jsDelivr](https://www.jsdelivr.com/) npm mirrors). Contents are
byte-for-byte upstream releases: not minified, rewritten, or patched locally.

## Core files

${header}
${core.join('\n')}

## KaTeX fonts

\`katex.min.css\` declares each face as
\`src:url(fonts/KaTeX_*.woff2) format("woff2"),url(fonts/KaTeX_*.woff) format("woff"),url(fonts/KaTeX_*.ttf) format("truetype")\`.
The stylesheet references ${woff2Checked} \`.woff2\` files and **all ${woff2Checked} are vendored** below.
The parallel \`.woff\` / \`.ttf\` entries in each \`src\` list are legacy fallbacks
that appear *after* the woff2 source: Android WebView is Chromium-based and
always selects the woff2 face, so the \`.woff\`/\`.ttf\` files are never
requested and are deliberately not vendored (~${(60 - fontCount)} files /
several MB saved). No CSS was modified to achieve this.

Source: [\`katex@${VERSIONS.katex}/dist/fonts/\`](${katex('dist/fonts/')})

| Font file | Bytes |
| --- | ---: |
${fontRows.join('\n')}
| **${fontCount} files total** | **${fontTotal.toLocaleString('en-US')}** |

## Totals

- files vendored: **${stats.size}** (7 core + ${fontCount} fonts)
- total bytes: **${grandTotal.toLocaleString('en-US')}**
- \`.woff2\` references in \`katex.min.css\` resolved on disk: **${woff2Checked}/${woff2Checked}**

## Integrity (sha256)

${integrity}

## Layout

\`\`\`
app/web/vendor/
  markdown-it.min.js            -> window.markdownit
  highlight.min.js              -> window.hljs
  highlight-github.min.css
  highlight-github-dark.min.css
  katex.min.js                  -> window.katex
  katex.min.css                 -> url(fonts/...) resolves relative to this file
  contrib/auto-render.min.js    -> window.renderMathInElement
  fonts/KaTeX_*.woff2           -> ${fontCount} files
\`\`\`
`;

  const out = path.join(VENDOR, 'VERSIONS.md');
  await writeFile(out, doc);
  log(`\nwrote ${rel(out)} (${Buffer.byteLength(doc)} B)`);
}

// --- main -------------------------------------------------------------------
async function main() {
  log(`vendor dir: ${VENDOR}`);
  log(`mode: ${verifyOnly ? 'verify-only' : 'download + verify'}`);
  log('\n=== DOWNLOAD ===');

  let results = [];
  if (!verifyOnly) {
    for (const entry of MANIFEST) results = results.concat(await download(entry));
  } else {
    log('  (skipped)');
  }

  const { sizes, woff2Checked, fontCount } = await verify(results);

  if (!verifyOnly) {
    const stats = new Map(results.map((r) => [r.dest, { bytes: r.bytes, sha256: r.sha256 }]));
    await writeVersionsMd(stats, woff2Checked, fontCount);
  }

  log('\nDONE.');
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}`);
  process.exitCode = 1;
});
