/* Download the standalone Electron runtime.
 *
 * `npm install electron` cannot work in this sandbox: its postinstall script
 * spawns node with piped stdio, and the sandbox blocks named pipes (EPERM).
 * So the release zip is fetched directly instead.
 *
 * Usage: node tools/fetch-electron.mjs [version]
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const version = process.argv[2] || 'v33.4.11';
const ROOT = path.resolve(import.meta.dirname, '..');
const DL = path.join(ROOT, '.toolchain', 'dl');
fs.mkdirSync(DL, { recursive: true });

const name = `electron-${version}-win32-x64.zip`;
const url = `https://github.com/electron/electron/releases/download/${version}/${name}`;
const dest = path.join(DL, name);

if (fs.existsSync(dest) && fs.statSync(dest).size > 50 * 1024 * 1024) {
  console.log('[skip] ' + name + ' already downloaded (' + fs.statSync(dest).size + ' bytes)');
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
if (got < 50 * 1024 * 1024) throw new Error('suspiciously small download: ' + got);
fs.renameSync(part, dest);
console.log('ok ' + (got / 1048576).toFixed(1) + ' MB in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
