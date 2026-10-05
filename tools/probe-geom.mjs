#!/usr/bin/env node
// Temporary geometry probe: tile opaque boundary + whale top profile.
import sharp from 'sharp';

const SRC = 'H:\\DSH-Desktop\\DSH Desktop\\resources\\app\\build\\app-icon.png';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const lum = new Float32Array(W * H);
for (let i = 0, p = 0; i < W * H; i++, p += C) lum[i] = data[p + 3] < 8 ? 0 : lumOf(data[p], data[p + 1], data[p + 2]);
const A = (x, y) => data[(y * W + x) * C + 3];

const rowBlack = new Float32Array(H);
for (let y = 0; y < H; y++) {
  const v = [];
  for (let x = 0; x < W; x++) if (A(x, y) > 200) v.push(lum[y * W + x]);
  v.sort((a, b) => a - b);
  rowBlack[y] = v.length ? v[Math.floor(v.length * 0.2)] : 0;
}
const whale = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  const thr = Math.max(150, rowBlack[y] + 80);
  for (let x = 0; x < W; x++) if (lum[y * W + x] > thr) whale[y * W + x] = 1;
}
// keep only the largest component (reuse simple flood)
const seen = new Uint8Array(W * H), stack = new Int32Array(W * H);
let best = null;
for (let s = 0; s < W * H; s++) {
  if (!whale[s] || seen[s]) continue;
  let sp = 0; stack[sp++] = s; seen[s] = 1; let n = 0; const px = [];
  while (sp > 0) {
    const i = stack[--sp]; n++; px.push(i);
    const x = i % W, y = (i - x) / W;
    if (x > 0 && whale[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[sp++] = i - 1; }
    if (x < W - 1 && whale[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[sp++] = i + 1; }
    if (y > 0 && whale[i - W] && !seen[i - W]) { seen[i - W] = 1; stack[sp++] = i - W; }
    if (y < H - 1 && whale[i + W] && !seen[i + W]) { seen[i + W] = 1; stack[sp++] = i + W; }
  }
  if (!best || n > best.n) best = { n, px };
}
const whaleOnly = new Uint8Array(W * H);
for (const i of best.px) whaleOnly[i] = 1;

console.log('--- tile opaque boundary (alpha>128), sampled rows ---');
console.log('  y    xmin  xmax   (inset from edge)');
for (let y = 0; y < H; y += 32) {
  let x0 = -1, x1 = -1;
  for (let x = 0; x < W; x++) if (A(x, y) > 128) { if (x0 < 0) x0 = x; x1 = x; }
  console.log(`  ${String(y).padStart(4)}  ${String(x0).padStart(4)}  ${String(x1).padStart(4)}   L${x0} R${W - 1 - x1}`);
}
console.log('--- tile opaque boundary (alpha>128), sampled cols ---');
console.log('  x    ymin  ymax');
for (let x = 0; x < W; x += 64) {
  let y0 = -1, y1 = -1;
  for (let y = 0; y < H; y++) if (A(x, y) > 128) { if (y0 < 0) y0 = y; y1 = y; }
  console.log(`  ${String(x).padStart(4)}  ${String(y0).padStart(4)}  ${String(y1).padStart(4)}`);
}
console.log('--- whale (largest component) top/bottom profile per column ---');
console.log('  x     top  bottom');
for (let x = 160; x <= 960; x += 20) {
  let y0 = -1, y1 = -1;
  for (let y = 0; y < H; y++) if (whaleOnly[y * W + x]) { if (y0 < 0) y0 = y; y1 = y; }
  console.log(`  ${String(x).padStart(4)}  ${String(y0).padStart(4)}  ${String(y1).padStart(4)}`);
}
console.log('--- whale left/right profile per row (in region of interest) ---');
for (let y = 200; y <= 700; y += 20) {
  let x0 = -1, x1 = -1;
  for (let x = 0; x < W; x++) if (whaleOnly[y * W + x]) { if (x0 < 0) x0 = x; x1 = x; }
  console.log(`  y=${String(y).padStart(4)}  ${String(x0).padStart(4)}..${String(x1).padStart(4)}`);
}
