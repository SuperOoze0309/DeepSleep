#!/usr/bin/env node
// Temporary prototype: render candidate zzz placements over the tile for eyeballing.
import fs from 'node:fs';
import sharp from 'sharp';

const SRC = 'H:\\DSH-Desktop\\DSH Desktop\\resources\\app\\build\\app-icon.png';
const OUT = 'H:\\DSHworkspace\\Deepseek-Android\\tools\\_probe';
fs.mkdirSync(OUT, { recursive: true });

const PINK = '#FF6EB4';
const ZZZ = '#FFC2DE';

// glyph: cap height 1, width 0.72, heavy sans-serif Z
const ZPATH = 'M0,0 L0.72,0 L0.72,0.20 L0.27,0.80 L0.72,0.80 L0.72,1 L0,1 L0,0.80 L0.45,0.20 L0,0.20 Z';
const zzzSvg = (cx, cy, cap, rot, colour = ZZZ) =>
  `<path d="${ZPATH}" fill="${colour}" transform="translate(${cx},${cy}) rotate(${rot}) scale(${cap}) translate(-0.36,-0.5)"/>`;

const S = 1024;
function clusterSvg(list, colour) {
  const inner = list.map(([cx, cy, cap, rot]) => zzzSvg(cx, cy, cap, rot, colour)).join('');
  return Buffer.from(`<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`);
}

// candidates
const CAND = {
  a: [[688, 176, 62, 15], [784, 122, 84, 15], [872, 66, 110, 15]],
  b: [[666, 180, 58, 15], [762, 128, 78, 15], [852, 72, 102, 15]],
  c: [[700, 170, 60, 15], [790, 112, 80, 15], [868, 52, 104, 15]],
  d: [[640, 190, 56, 15], [742, 138, 76, 15], [838, 82, 100, 15]],
};

// whale mask (alpha of whale pixels) from the source
const { data: src, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const lum = new Float32Array(W * H);
for (let i = 0, p = 0; i < W * H; i++, p += C) lum[i] = src[p + 3] < 8 ? 0 : lumOf(src[p], src[p + 1], src[p + 2]);
const BLACK_POINT = 32;
const whaleAlpha = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) whaleAlpha[i] = lum[i] <= BLACK_POINT ? 0 : Math.min(255, ((lum[i] - BLACK_POINT) * 255) / (255 - BLACK_POINT));

const tileAlpha = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) tileAlpha[i] = src[i * C + 3];

for (const [name, list] of Object.entries(CAND)) {
  const { data: z, info: zi } = await sharp(clusterSvg(list, ZZZ)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (z[(y * W + x) * zi.channels + 3] > 8) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  // overlap with whale and tile-edge clearance
  let whaleHit = 0, outTile = 0, minClear = 1e9;
  const zz = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) zz[i] = z[i * zi.channels + 3] > 8 ? 1 : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!zz[y * W + x]) continue;
    if (whaleAlpha[y * W + x] > 0) whaleHit++;
    if (tileAlpha[y * W + x] < 128) outTile++;
  }
  // clearance from zzz to whale (chebyshev-ish via brute BFS on distance transform)
  const dist = new Int32Array(W * H).fill(1 << 20);
  const q = new Int32Array(W * H); let qh = 0, qt = 0;
  for (let i = 0; i < W * H; i++) if (whaleAlpha[i] > 8) { dist[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++]; const x = i % W, y = (i - x) / W; const d = dist[i] + 1;
    if (x > 0 && dist[i - 1] > d) { dist[i - 1] = d; q[qt++] = i - 1; }
    if (x < W - 1 && dist[i + 1] > d) { dist[i + 1] = d; q[qt++] = i + 1; }
    if (y > 0 && dist[i - W] > d) { dist[i - W] = d; q[qt++] = i - W; }
    if (y < H - 1 && dist[i + W] > d) { dist[i + W] = d; q[qt++] = i + W; }
  }
  for (let i = 0; i < W * H; i++) if (zz[i]) minClear = Math.min(minClear, dist[i]);
  console.log(`cand ${name}: px=${n} bbox x ${x0}..${x1} y ${y0}..${y1} (${x1 - x0 + 1}x${y1 - y0 + 1}) whaleOverlap=${whaleHit} outsideTile=${outTile} minClearanceToWhale=${minClear}`);

  const pinkTile = await sharp(SRC).composite([{ input: clusterSvg(list, ZZZ), top: 0, left: 0 }]).png().toBuffer();
  // pink whale: force RGB where whale alpha > 0
  const { data: ptd, info: pti } = await sharp(pinkTile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < W * H; i++) {
    if (whaleAlpha[i] === 0) continue;
    if (ptd[i * 4 + 3] === 0) continue;
    // skip if this pixel is zzz (leave it light pink)
    if (zz[i]) continue;
    ptd[i * 4] = 0xFF; ptd[i * 4 + 1] = 0x6E; ptd[i * 4 + 2] = 0xB4;
  }
  await sharp(ptd, { raw: { width: W, height: H, channels: 4 } }).resize(512, 512).png().toFile(`${OUT}\\cand-${name}.png`);
}
console.log('written');
