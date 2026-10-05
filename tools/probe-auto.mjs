#!/usr/bin/env node
// Temporary prototype #3: multi-anchor zzz placement search + visual output.
import fs from 'node:fs';
import sharp from 'sharp';

const SRC = 'H:\\DSH-Desktop\\DSH Desktop\\resources\\app\\build\\app-icon.png';
const OUT = 'H:\\DSHworkspace\\Deepseek-Android\\tools\\_probe';
fs.mkdirSync(OUT, { recursive: true });

const PINK = [0xff, 0x6e, 0xb4], ZPINK = [0xff, 0xc2, 0xde];
const ZPATH = 'M0,0 L0.72,0 L0.72,0.20 L0.27,0.80 L0.72,0.80 L0.72,1 L0,1 L0,0.80 L0.45,0.20 L0,0.20 Z';
const ROT = 15, CHAIN = 26 * Math.PI / 180, ROTR = ROT * Math.PI / 180;

const { data: src, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels, N = W * H;
const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const lum = new Float32Array(N);
for (let i = 0, p = 0; i < N; i++, p += C) lum[i] = src[p + 3] < 8 ? 0 : lumOf(src[p], src[p + 1], src[p + 2]);
const BLACK_POINT = 32;
const af = new Uint8Array(N);
for (let i = 0; i < N; i++) af[i] = lum[i] <= BLACK_POINT ? 0 : Math.min(255, Math.round(((lum[i] - BLACK_POINT) * 255) / (255 - BLACK_POINT)));

function largest(mask) {
  const seen = new Uint8Array(N), st = new Int32Array(N);
  let best = null;
  for (let s = 0; s < N; s++) {
    if (!mask[s] || seen[s]) continue;
    let sp = 0; st[sp++] = s; seen[s] = 1; let n = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
    const px = [];
    while (sp > 0) {
      const i = st[--sp]; n++; px.push(i);
      const x = i % W, y = (i - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; st[sp++] = i - 1; }
      if (x < W - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; st[sp++] = i + 1; }
      if (y > 0 && mask[i - W] && !seen[i - W]) { seen[i - W] = 1; st[sp++] = i - W; }
      if (y < H - 1 && mask[i + W] && !seen[i + W]) { seen[i + W] = 1; st[sp++] = i + W; }
    }
    if (!best || n > best.n) best = { n, x0, y0, x1, y1, px };
  }
  return best;
}
const m8 = new Uint8Array(N);
for (let i = 0; i < N; i++) m8[i] = af[i] >= 8 ? 1 : 0;
const orca = largest(m8);
const orcaMask = new Uint8Array(N);
for (const i of orca.px) orcaMask[i] = 1;

function distanceTo(mask) {
  const INF = 1 << 20, d = new Int32Array(N).fill(INF), qq = new Int32Array(N);
  let h = 0, t = 0;
  for (let i = 0; i < N; i++) if (mask[i]) { d[i] = 0; qq[t++] = i; }
  while (h < t) {
    const i = qq[h++]; const x = i % W, y = (i - x) / W; const nd = d[i] + 1;
    if (x > 0 && d[i - 1] > nd) { d[i - 1] = nd; qq[t++] = i - 1; }
    if (x < W - 1 && d[i + 1] > nd) { d[i + 1] = nd; qq[t++] = i + 1; }
    if (y > 0 && d[i - W] > nd) { d[i - W] = nd; qq[t++] = i - W; }
    if (y < H - 1 && d[i + W] > nd) { d[i + W] = nd; qq[t++] = i + W; }
  }
  return d;
}
const distWhale = distanceTo(orcaMask);
const nonTile = new Uint8Array(N);
for (let i = 0; i < N; i++) nonTile[i] = src[i * C + 3] > 200 ? 0 : 1;
for (let x = 0; x < W; x++) { nonTile[x] = 1; nonTile[(H - 1) * W + x] = 1; }
for (let y = 0; y < H; y++) { nonTile[y * W] = 1; nonTile[y * W + W - 1] = 1; }
const distEdge = distanceTo(nonTile);

const CLEAR = 22, TILE_MARGIN = 26;
function cluster(sf) {
  const caps = [62 * sf, 80 * sf, 102 * sf], d = [80 * sf, 102 * sf];
  const c = [[0, 0, caps[0]]];
  let px = 0, py = 0;
  for (let k = 1; k < 3; k++) { px += d[k - 1] * Math.cos(CHAIN); py -= d[k - 1] * Math.sin(CHAIN); c.push([px, py, caps[k]]); }
  return c;
}
async function renderCluster(c) {
  const xs = [], ys = [];
  for (const [x, y, cap] of c) {
    const hw = 0.5 * (0.72 * cap * Math.cos(ROTR) + cap * Math.sin(ROTR));
    const hh = 0.5 * (0.72 * cap * Math.sin(ROTR) + cap * Math.cos(ROTR));
    xs.push(x - hw, x + hw); ys.push(y - hh, y + hh);
  }
  const x0 = Math.floor(Math.min(...xs)), y0 = Math.floor(Math.min(...ys));
  const cw = Math.ceil(Math.max(...xs)) - x0 + 2, chh = Math.ceil(Math.max(...ys)) - y0 + 2;
  const inner = c.map(([x, y, cap]) =>
    `<path d="${ZPATH}" fill="#FFFFFF" transform="translate(${(x - x0).toFixed(2)},${(y - y0).toFixed(2)}) rotate(${ROT}) scale(${cap.toFixed(3)}) translate(-0.36,-0.5)"/>`).join('');
  const svg = Buffer.from(`<svg width="${cw}" height="${chh}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`);
  const { data, info: ii } = await sharp(svg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(cw * chh);
  for (let i = 0; i < cw * chh; i++) mask[i] = data[i * ii.channels + 3] > 40 ? 1 : 0;
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) if (mask[y * cw + x]) { sx += x; sy += y; n++; }
  return { mask, w: cw, h: chh, svg, cx: sx / n, cy: sy / n, n };
}

const offsets = [];
for (let dy = -220; dy <= 220; dy += 2) for (let dx = -220; dx <= 220; dx += 2) offsets.push([dx, dy]);
offsets.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]));

async function place(anchorFrac, maxDrift) {
  let best = null;
  for (let sfi = 125; sfi >= 60; sfi -= 5) {
    const sf = sfi / 100;
    const cl = await renderCluster(cluster(sf));
    const cx0 = anchorFrac[0] * W - cl.cx, cy0 = anchorFrac[1] * H - cl.cy;
    let found = null;
    for (const [dx, dy] of offsets) {
      const tx = Math.round(cx0 + dx), ty = Math.round(cy0 + dy);
      if (tx < 0 || ty < 0 || tx + cl.w > W || ty + cl.h > H) continue;
      let ok = true;
      for (let y = 0; y < cl.h && ok; y++) {
        const row = y * cl.w, base = (ty + y) * W + tx;
        for (let x = 0; x < cl.w; x++) {
          if (!cl.mask[row + x]) continue;
          const i = base + x;
          if (distWhale[i] < CLEAR || distEdge[i] < TILE_MARGIN) { ok = false; break; }
        }
      }
      if (ok) { found = { sf, tx, ty, cl, dist: Math.hypot(dx, dy) }; break; }
    }
    if (!found) continue;
    if (!best) best = found;
    if (found.dist <= maxDrift) return found;
  }
  return best;
}

const ANCHORS = [[0.60, 0.135], [0.645, 0.145], [0.70, 0.15], [0.75, 0.17], [0.68, 0.19]];
for (let a = 0; a < ANCHORS.length; a++) {
  const p = await place(ANCHORS[a], 34);
  if (!p) { console.log(`anchor ${ANCHORS[a]} -> none`); continue; }
  console.log(`anchor ${ANCHORS[a]} -> sf=${p.sf} origin (${p.tx},${p.ty}) bbox x ${p.tx}..${p.tx + p.cl.w - 1} y ${p.ty}..${p.ty + p.cl.h - 1} drift=${p.dist.toFixed(1)} zzzPx=${p.cl.n}`);
  const tile = await sharp(SRC).composite([{ input: p.cl.svg, top: p.ty, left: p.tx }]).png().toBuffer();
  const { data: td } = await sharp(tile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < N; i++) if (orcaMask[i] && td[i * 4 + 3] > 0) { td[i * 4] = PINK[0]; td[i * 4 + 1] = PINK[1]; td[i * 4 + 2] = PINK[2]; }
  await sharp(td, { raw: { width: W, height: H, channels: 4 } }).resize(512, 512).png().toFile(`${OUT}\\anchor-${a}.png`);
}
console.log('written');
