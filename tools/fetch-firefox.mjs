/* Download a portable Firefox zip for headless screenshots.
 *
 * Chromium (Chrome/Edge/Electron) cannot start in this sandbox: its browser<->
 * renderer IPC and crashpad registration both need named pipes, which the
 * sandbox blocks. Firefox uses a different IPC path and can additionally be
 * forced into single-process mode with MOZ_FORCE_DISABLE_E10S=1.
 *
 * Usage: node tools/fetch-firefox.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const ROOT = path.resolve(import.meta.dirname, '..');
const DL = path.join(ROOT, '.toolchain', 'dl');
fs.mkdirSync(DL, { recursive: true });

const meta = await (await fetch('https://product-details.mozilla.org/1.0/firefox_versions.json')).json();
const version = meta.LATEST_FIREFOX_VERSION;
console.log('latest firefox: ' + version);

const url = `https://archive.mozilla.org/pub/firefox/releases/${version}/win64/en-US/firefox-${version}.zip`;
const dest = path.join(DL, `firefox-${version}.zip`);

if (fs.existsSync(dest) && fs.statSync(dest).size > 40 * 1024 * 1024) {
  console.log('[skip] already downloaded (' + fs.statSync(dest).size + ' bytes)');
  fs.writeFileSync(path.join(DL, 'firefox-version.txt'), version);
  process.exit(0);
}

const part = dest + '.part';
console.log('[get ] ' + url);
const t0 = Date.now();
let res;
for (let attempt = 1; ; attempt++) {
  try {
    res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    break;
  } catch (e) {
    if (attempt >= 4) throw e;
    console.log('  retry ' + attempt + ': ' + e.message);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}
await pipeline(res.body, fs.createWriteStream(part));
const got = fs.statSync(part).size;
if (got < 40 * 1024 * 1024) throw new Error('suspiciously small download: ' + got);
fs.renameSync(part, dest);
fs.writeFileSync(path.join(DL, 'firefox-version.txt'), version);
console.log('ok ' + (got / 1048576).toFixed(1) + ' MB in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
