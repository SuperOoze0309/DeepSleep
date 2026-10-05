#!/usr/bin/env node
// Temporary reconnaissance probe (not part of the deliverable pipeline).
import fs from 'node:fs';
import sharp from 'sharp';

const SRC = process.argv[2] || 'H:\\DSH-Desktop\\DSH Desktop\\resources\\app\\build\\app-icon.png';
const { data: src, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels, N = W * H;
const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const lum = new Float32Array(N);
for (let i = 0, p = 0; i < N; i++, p += C) lum[i] = src[p + 3] < 8 ? 0 : lumOf(src[p], src[p + 1], src[p + 2]);
const A = (x, y) => src[(y * W + x) * C + 3];

function largestComponentBox(mask, w, h) {
  const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
  let best = null;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    let sp = 0; stack[sp++] = s; seen[s] = 1;
    let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    while (sp > 0) {
      const i = stack[--sp]; n++;
      const x = i % w, y = (i - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[sp++] = i - w; }
      if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[sp++] = i + w; }
    }
    if (!best || n > best.count) best = { count: n, x0, y0, x1, y1 };
  }
  return best;
}

// per-row tile black level
const rowBlack = new Float32Array(H);
for (let y = 0; y < H; y++) {
  const v = [];
  for (let x = 0; x < W; x++) if (A(x, y) > 200) v.push(lum[y * W + x]);
  v.sort((a, b) => a - b);
  rowBlack[y] = v.length ? v[Math.floor(v.length * 0.2)] : 0;
}
const orcaMask = new Uint8Array(N);
for (let y = 0; y < H; y++) {
  const thr = Math.max(150, rowBlack[y] + 80);
  for (let x = 0; x < W; x++) if (lum[y * W + x] > thr) orcaMask[y * W + x] = 1;
}
const orca = largestComponentBox(orcaMask, W, H);
console.log('corners:', [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]].map(([x, y]) => `(${x},${y}) a=${A(x, y)}`).join(' '));
console.log('orca component:', JSON.stringify(orca));

// bg around orca
const near = new Uint8Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (orcaMask[y * W + x])
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < W && ny >= 0 && ny < H) near[ny * W + nx] = 1;
  }
const bgPix = [], bgL = [];
for (let y = orca.y0; y <= orca.y1; y++) for (let x = orca.x0; x <= orca.x1; x++) {
  const i = y * W + x;
  if (near[i] || A(x, y) < 200) continue;
  bgL.push(lum[i]); bgPix.push([src[i * C], src[i * C + 1], src[i * C + 2]]);
}
let maxL = 0; for (const l of bgL) if (l > maxL) maxL = l;
const BLACK_POINT = Math.ceil(maxL) + 3;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
console.log('bg maxLum', maxL.toFixed(1), 'BLACK_POINT', BLACK_POINT,
  'median rgb', [0, 1, 2].map((c) => med(bgPix.map((p) => p[c]))).join(','),
  'n=', bgPix.length);
// modal dark rgb whole canvas
const mm = new Map();
for (let i = 0; i < N; i++) { if (src[i * C + 3] < 250 || lum[i] > 60) continue; const k = `${src[i * C]},${src[i * C + 1]},${src[i * C + 2]}`; mm.set(k, (mm.get(k) || 0) + 1); }
console.log('modal dark rgb:', [...mm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} x${v}`).join('  '));

// sprite alpha field
const af = new Uint8ClampedArray(N);
for (let i = 0; i < N; i++) { const a = lum[i] <= BLACK_POINT ? 0 : ((lum[i] - BLACK_POINT) * 255) / (255 - BLACK_POINT); af[i] = a > 255 ? 255 : a; }
const sm = new Uint8Array(N);
for (let i = 0; i < N; i++) sm[i] = af[i] >= 8 ? 1 : 0;
const spr = largestComponentBox(sm, W, H);
console.log('sprite component (a>=8):', JSON.stringify(spr));

// ASCII map of sprite alpha over its bbox, 64 cols
const cols = 64, rows = 32;
const bx0 = spr.x0, by0 = spr.y0, bw = spr.x1 - spr.x0 + 1, bh = spr.y1 - spr.y0 + 1;
console.log(`bbox ${bx0},${by0} ${bw}x${bh}`);
for (let r = 0; r < rows; r++) {
  let line = '';
  for (let c = 0; c < cols; c++) {
    const x0 = bx0 + Math.floor((c * bw) / cols), x1 = bx0 + Math.floor(((c + 1) * bw) / cols);
    const y0 = by0 + Math.floor((r * bh) / rows), y1 = by0 + Math.floor(((r + 1) * bh) / rows);
    let hit = 0, tot = 0;
    for (let y = y0; y < Math.max(y1, y0 + 1); y++) for (let x = x0; x < Math.max(x1, x0 + 1); x++) { tot++; if (af[y * W + x] > 8) hit++; }
    const f = hit / Math.max(1, tot);
    line += f > 0.6 ? '#' : f > 0.25 ? '+' : f > 0.05 ? '.' : ' ';
  }
  console.log(String(by0 + Math.floor((r * bh) / rows)).padStart(4) + ' |' + line + '|');
}
console.log('cols x from ' + bx0 + ' to ' + (bx0 + bw - 1) + ', 1 col = ' + (bw / cols).toFixed(1) + 'px, 1 row = ' + (bh / rows).toFixed(1) + 'px');

// per-row left/right extent of the sprite (to find free space)
console.log('\nrow extents (source px): row: xmin..xmax   (right free space to 1024)');
for (let y = by0; y <= spr.y1; y += 32) {
  let x0 = -1, x1 = -1;
  for (let x = 0; x < W; x++) if (af[y * W + x] > 8) { if (x0 < 0) x0 = x; x1 = x; }
  console.log(`  y=${String(y).padStart(4)}  ${x0}..${x1}`);
}
// column extents
console.log('\ncol extents: col: ymin..ymax');
for (let x = bx0; x <= spr.x1; x += 48) {
  let y0 = -1, y1 = -1;
  for (let y = 0; y < H; y++) if (af[y * W + x] > 8) { if (y0 < 0) y0 = y; y1 = y; }
  console.log(`  x=${String(x).padStart(4)}  ${y0}..${y1}`);
}
