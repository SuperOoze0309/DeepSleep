#!/usr/bin/env node
/**
 * tools/smoke-vendor.mjs
 * ---------------------------------------------------------------------------
 * Independent smoke test for the vendored bundles in app/web/vendor/.
 *
 * fetch-vendor.mjs proves the files are present, non-HTML and byte-sane; this
 * script proves they actually *execute* and expose the globals a plain
 * <script> tag relies on (window.markdownit / hljs / katex /
 * renderMathInElement), then renders real input through each one.
 *
 * Evaluation happens in a bare VM context with `window`/`self` but no DOM,
 * mirroring the UMD "browser global" path used by a WebView.
 *
 * Usage: node tools/smoke-vendor.mjs
 * ---------------------------------------------------------------------------
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import vm from 'node:vm';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const VENDOR = path.join(REPO_ROOT, 'app', 'web', 'vendor');

const read = (p) => readFile(path.join(VENDOR, p), 'utf8');

// Bare browser-ish global: no `document` (same shape as a DOM-less worker).
const sandbox = {};
sandbox.window = sandbox;
sandbox.self = sandbox;
const ctx = vm.createContext(sandbox);

const failures = [];
async function check(label, fn) {
  try {
    const detail = await fn();
    console.log(`  ok    ${label}${detail ? ` - ${detail}` : ''}`);
  } catch (err) {
    failures.push(`${label}: ${err.message}`);
    console.log(`  FAIL  ${label} - ${err.message}`);
  }
}

console.log('=== SMOKE: execute bundles in a bare browser-like context ===');

// --- markdown-it ------------------------------------------------------------
vm.runInContext(await read('markdown-it.min.js'), ctx, { filename: 'markdown-it.min.js' });
await check('window.markdownit is a function', () => {
  if (typeof sandbox.markdownit !== 'function') throw new Error(`got ${typeof sandbox.markdownit}`);
  const md = sandbox.markdownit({ html: true, linkify: true });
  const html = md.render('# Title\n\nSome **bold** and `code`.\n\n```js\nconst a = 1;\n```\n');
  if (!/<h1>Title<\/h1>/.test(html)) throw new Error(`unexpected render: ${html.slice(0, 60)}`);
  if (!/<strong>bold<\/strong>/.test(html)) throw new Error('bold not rendered');
  if (!/<pre><code class="language-js">/.test(html)) throw new Error('fenced code not rendered');
  return `rendered ${html.length} chars, fences + inline OK`;
});

// --- highlight.js -----------------------------------------------------------
vm.runInContext(await read('highlight.min.js'), ctx, { filename: 'highlight.min.js' });
await check('window.hljs exposes highlight()', () => {
  const hljs = sandbox.hljs;
  if (!hljs || typeof hljs.highlight !== 'function') throw new Error(`got ${typeof hljs}`);
  const r = hljs.highlight('def f(x):\n    return x + 1\n', { language: 'python' });
  if (!r || typeof r.value !== 'string' || r.value.length === 0) throw new Error('empty highlight result');
  if (!/hljs-/.test(r.value)) throw new Error('no hljs-* class emitted');
  return `${Object.keys(hljs.listLanguages()).length} languages, python -> ${r.value.length} chars`;
});

// --- katex ------------------------------------------------------------------
vm.runInContext(await read('katex.min.js'), ctx, { filename: 'katex.min.js' });
await check('window.katex.renderToString()', () => {
  const katex = sandbox.katex;
  if (!katex || typeof katex.renderToString !== 'function') throw new Error(`got ${typeof katex}`);
  const html = katex.renderToString('c = \\pm\\sqrt{a^2 + b^2}', { throwOnError: true });
  if (!/katex/.test(html)) throw new Error('no katex class in output');
  if (!/sqrt|msqrt/.test(html)) throw new Error('sqrt not rendered');
  return `version ${katex.version}, ${html.length} chars`;
});

// --- katex auto-render (needs the katex global to already be present) -------
vm.runInContext(await read('contrib/auto-render.min.js'), ctx, { filename: 'contrib/auto-render.min.js' });
await check('window.renderMathInElement is a function', () => {
  if (typeof sandbox.renderMathInElement !== 'function') throw new Error(`got ${typeof sandbox.renderMathInElement}`);
  return 'exposed';
});

// --- katex.min.css font wiring ---------------------------------------------
console.log('\n=== SMOKE: katex.min.css <-> fonts/ wiring ===');
const css = await read('katex.min.css');

await check('every css url() target is a relative fonts/KaTeX_* path', () => {
  const bad = [...new Set([...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]))].filter(
    (u) => !/^fonts\/KaTeX_[A-Za-z0-9]+(-[A-Za-z0-9]+)*\.(woff2|woff|ttf)$/.test(u),
  );
  if (bad.length) throw new Error(`unexpected url() targets: ${bad.slice(0, 3).join(', ')}`);
  const faces = (css.match(/@font-face/g) || []).length;
  return `${faces} @font-face rules, all url() targets relative under fonts/`;
});

await check('every woff2 referenced by css exists on disk with wOF2 magic', async () => {
  const woff2 = [...new Set([...css.matchAll(/url\((fonts\/[^)]+\.woff2)\)/g)].map((m) => m[1]))];
  const bad = [];
  for (const f of woff2) {
    try {
      const buf = await readFile(path.join(VENDOR, f));
      if (buf.subarray(0, 4).toString('latin1') !== 'wOF2') bad.push(`${f} (bad magic)`);
    } catch {
      bad.push(`${f} (missing)`);
    }
  }
  if (bad.length) throw new Error(bad.join(', '));
  return `${woff2.length}/${woff2.length} present, all wOF2`;
});

if (failures.length) {
  console.log(`\nSMOKE FAILED (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log('\nSMOKE OK');
}
