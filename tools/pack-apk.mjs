/* Package the final APK:
 *   base.apk (from `aapt2 link`, contains resources.arsc + AndroidManifest.xml + assets)
 *   + classes.dex (from d8)
 *   -> unsigned.apk
 *
 * resources.arsc and classes.dex are written STORED (uncompressed); everything
 * else is deflated unless the format is already compressed. Byte alignment is
 * left to `zipalign`, which runs right after this.
 *
 * Usage: node tools/pack-apk.mjs <base.apk> <classes.dex> <out.apk>
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const [baseApk, dexFile, outApk] = process.argv.slice(2);
if (!baseApk || !dexFile || !outApk) {
  console.error('usage: node pack-apk.mjs <base.apk> <classes.dex> <out.apk>');
  process.exit(2);
}

/* ----------------------------- crc32 ----------------------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* --------------------------- zip reader --------------------------- */
function readZip(buf) {
  // End of central directory: scan backwards for the signature
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD not found: not a zip file');

  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory at ' + p);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('bad local header for ' + name);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);

    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error('unsupported compression method ' + method + ' for ' + name);

    if (data.length !== uncompSize) {
      throw new Error('size mismatch for ' + name + ': ' + data.length + ' != ' + uncompSize);
    }
    entries.push({ name, data, crc });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* --------------------------- zip writer --------------------------- */
const DOS_TIME = 0x6000; // 12:00:00
const DOS_DATE = 0x5A21; // 2025-01-01

function shouldStore(name) {
  if (name === 'resources.arsc') return true;
  if (name.endsWith('.dex')) return true;
  // already-compressed payloads gain nothing from deflate
  return /\.(png|jpe?g|webp|gif|ico|woff2?|zip|gz|mp4|mp3|ogg|ttf|otf)$/i.test(name);
}

function buildZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const store = shouldStore(e.name);
    let payload = e.data;
    let method = 0;

    if (!store) {
      const deflated = zlib.deflateRawSync(e.data, { level: 9 });
      if (deflated.length < e.data.length) {
        payload = deflated;
        method = 8;
      }
    }
    const crc = crc32(e.data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);   // version needed
    lh.writeUInt16LE(0, 6);    // flags
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(payload.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);   // extra length

    local.push(lh, nameBuf, payload);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);   // version made by
    ch.writeUInt16LE(20, 6);   // version needed
    ch.writeUInt16LE(0, 8);    // flags
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(payload.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);   // extra
    ch.writeUInt16LE(0, 32);   // comment
    ch.writeUInt16LE(0, 34);   // disk
    ch.writeUInt16LE(0, 36);   // internal attrs
    ch.writeUInt32LE(0, 38);   // external attrs
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);

    offset += 30 + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...local, centralBuf, eocd]);
}

/* ------------------------------- main ------------------------------- */
const baseBuf = fs.readFileSync(baseApk);
// aapt2 link 在 Windows 上会把 -A 目录里的资源路径写成反斜杠，
// 而 ZIP 规范要求正斜杠；Android 的 AssetManager 按字面名索引，
// 带反斜杠的条目会导致 assets.open("css/app.css") 直接 404（白屏）。
const entries = readZip(baseBuf).map((e) => ({ ...e, name: e.name.replace(/\\/g, '/') }));

const seen = new Set();
for (const e of entries) {
  if (seen.has(e.name)) throw new Error('duplicate entry after separator normalization: ' + e.name);
  seen.add(e.name);
}

const names = new Set(entries.map((e) => e.name));

if (!names.has('AndroidManifest.xml')) throw new Error('AndroidManifest.xml missing from base apk');
if (!names.has('resources.arsc')) throw new Error('resources.arsc missing from base apk');
if (names.has('classes.dex')) throw new Error('base apk already contains classes.dex');

const dex = fs.readFileSync(dexFile);
entries.push({ name: 'classes.dex', data: dex });

const out = buildZip(entries);
fs.writeFileSync(outApk, out);

const stored = entries.filter((e) => shouldStore(e.name)).map((e) => e.name);
console.log('entries: ' + entries.length);
console.log('stored : ' + stored.join(', '));
console.log('output : ' + out.length + ' bytes');

// verify the result round-trips
const check = readZip(fs.readFileSync(outApk));
const dexBack = check.find((e) => e.name === 'classes.dex');
if (!dexBack || dexBack.data.length !== dex.length) throw new Error('classes.dex round-trip failed');
console.log('round-trip OK (' + check.length + ' entries)');
