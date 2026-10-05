// Download the Android build toolchain into ./.toolchain (workspace-local).
// Node's fetch is used because PowerShell/curl TLS (schannel) is blocked in this sandbox.
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const ROOT = path.resolve(import.meta.dirname, '..');
const DL = path.join(ROOT, '.toolchain', 'dl');
fs.mkdirSync(DL, { recursive: true });

const items = [
  {
    name: 'jdk17.zip',
    url: 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse',
    size: 190817615,
  },
  {
    name: 'build-tools_r34-windows.zip',
    url: 'https://dl.google.com/android/repository/build-tools_r34-windows.zip',
    size: 58253258,
  },
  {
    name: 'platform-35_r01.zip',
    url: 'https://dl.google.com/android/repository/platform-35_r01.zip',
    size: 64281654,
  },
];

function fmt(n) {
  return (n / 1048576).toFixed(1) + 'MB';
}

for (const it of items) {
  const dest = path.join(DL, it.name);
  if (fs.existsSync(dest) && fs.statSync(dest).size === it.size) {
    console.log(`[skip] ${it.name} already complete (${fmt(it.size)})`);
    continue;
  }
  const part = dest + '.part';
  process.stdout.write(`[get ] ${it.name} ... `);
  const t0 = Date.now();
  let res;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(it.url, { redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      break;
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  await pipeline(res.body, fs.createWriteStream(part));
  const got = fs.statSync(part).size;
  if (got !== it.size) {
    throw new Error(`${it.name}: size mismatch, got ${got} expected ${it.size}`);
  }
  fs.renameSync(part, dest);
  const secs = (Date.now() - t0) / 1000;
  console.log(`ok ${fmt(got)} in ${secs.toFixed(1)}s (${(got / 1048576 / secs).toFixed(1)} MB/s)`);
}
console.log('ALL DOWNLOADS COMPLETE');
