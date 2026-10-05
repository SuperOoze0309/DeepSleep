#!/usr/bin/env node
/**
 * make-icons.mjs — DSH Android launcher-icon generator (reusable / re-runnable).
 *
 * Source : H:\DSH-Desktop\DSH Desktop\resources\app\build\app-icon.png  (1024x1024 RGBA)
 * Outputs (per density bucket mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi under app/android/res):
 *          mipmap-<bucket>/ic_launcher.png             48/72/96/144/192
 *          mipmap-<bucket>/ic_launcher_round.png       same sizes, circular
 *          mipmap-<bucket>/ic_launcher_foreground.png  108/162/216/324/432
 *          app/web/assets/orca-white.png, orca-black.png, orca-tile.png (512)
 *
 * Toolchain: sharp (libvips). Install once with:
 *     cd tools && npm install sharp        (set npm_config_cache inside the workspace if sandboxed)
 *
 * Notable facts about the source artwork (measured, not assumed):
 *  - The tile is a squircle that fills the whole canvas; its four corners ARE already
 *    transparent (alpha == 0), so no rounded-rect alpha mask is required for the legacy
 *    icons. The script still checks this at run time and falls back to a rounded-rect
 *    mask (radius = 22% of the icon) if a future source has opaque corners.
 *  - The tile is NOT flat near-black: it is a glossy vertical gradient that reaches
 *    luminance ~208 at the top edge and ~130 at the bottom edge. Therefore a plain
 *    "luminance > 100" test selects the gloss, not the orca. The orca mask below uses a
 *    threshold relative to the per-row tile black level, which isolates the orca cleanly.
 *  - The orca is surrounded by a ~4px opaque *black outline* (RGB 0,0,0), so the
 *    luminance-derived alpha naturally produces a clean orca silhouette.
 *
 * Usage: node tools/make-icons.mjs [sourcePng]
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// pngjs (independent decoder) is used only for the verification pass.
const PNGJS_PATH = 'H:\\DSH-Desktop\\DSH Desktop\\resources\\app\\node_modules\\pngjs';
let PNGJS = null;
try { PNGJS = require(PNGJS_PATH).PNG; } catch { PNGJS = null; }

const SRC = process.argv[2] || 'H:\\DSH-Desktop\\DSH Desktop\\resources\\app\\build\\app-icon.png';

const LEGACY = [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]];
const FOREGROUND = [['mdpi', 108], ['hdpi', 162], ['xhdpi', 216], ['xxhdpi', 324], ['xxxhdpi', 432]];
const SAFE_FRACTION = 0.62;          // orca is scaled to fit inside 62% of the foreground canvas
const CORNER_RADIUS_FRACTION = 0.22; // fallback rounded-rect mask radius
const LOGO_CANVAS = 512;             // in-app logo assets canvas
// Orca detection: pixel is orca when luminance is far above this row's tile black level.
const ORCA_MIN_LUM = 150;
const ORCA_ROW_MARGIN = 80;
const AA_SAMPLES = 4;                // 4x4 subsamples per pixel for analytic coverage

const RES_DIR = path.join(ROOT, 'app', 'android', 'res');
const WEB_DIR = path.join(ROOT, 'app', 'web', 'assets');

const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const pct = (a, b) => ((100 * a) / b).toFixed(1) + '%';

// ---------------------------------------------------------------- source load
const meta = await sharp(SRC).metadata();
const { data: src, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
if (W !== H) throw new Error(`source must be square, got ${W}x${H}`);
if (C !== 4) throw new Error(`expected RGBA source, got ${C} channels`);
const N = W * H;

const lum = new Float32Array(N);
for (let i = 0, p = 0; i < N; i++, p += C) {
  lum[i] = src[p + 3] < 8 ? 0 : lumOf(src[p], src[p + 1], src[p + 2]);
}
const alphaAt = (x, y) => src[(y * W + x) * C + 3];
const rgbAt = (x, y) => { const i = (y * W + x) * C; return [src[i], src[i + 1], src[i + 2]]; };

/** Largest 4-connected component of a boolean mask; returns its tight bbox. */
function largestComponentBox(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
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

// ------------------------------------------------- step 1: per-row tile black level
const rowBlack = new Float32Array(H);
for (let y = 0; y < H; y++) {
  const vals = [];
  for (let x = 0; x < W; x++) if (alphaAt(x, y) > 200) vals.push(lum[y * W + x]);
  vals.sort((a, b) => a - b);
  rowBlack[y] = vals.length ? vals[Math.floor(vals.length * 0.2)] : 0;
}
const rowBlackMax = rowBlack.reduce((a, b) => (b > a ? b : a), 0);

// ------------------------------------------------- step 2: orca bounding box
const orcaMask = new Uint8Array(N);
let naiveCount = 0, nx0 = W, ny0 = H, nx1 = -1, ny1 = -1; // naive "luminance > 100" for the report
for (let y = 0; y < H; y++) {
  const thr = Math.max(ORCA_MIN_LUM, rowBlack[y] + ORCA_ROW_MARGIN);
  for (let x = 0; x < W; x++) {
    const i = y * W + x, l = lum[i];
    if (l > thr) orcaMask[i] = 1;
    if (l > 100) {
      naiveCount++;
      if (x < nx0) nx0 = x; if (x > nx1) nx1 = x; if (y < ny0) ny0 = y; if (y > ny1) ny1 = y;
    }
  }
}
const orca = largestComponentBox(orcaMask, W, H);
if (!orca || orca.count < 1000) throw new Error('orca detection failed');
const orcaBox = { x0: orca.x0, y0: orca.y0, x1: orca.x1, y1: orca.y1 };

// ------------------------------- step 3: tile background colour / corner handling
const cornerPx = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]].map(([x, y]) => ({ x, y, a: alphaAt(x, y), rgb: rgbAt(x, y) }));
const cornersTransparent = cornerPx.every((p) => p.a <= 8);
// also require the small corner boxes to be (almost) fully transparent
let cornerBoxOpaque = 0, cornerBoxTotal = 0;
const box = Math.max(2, Math.round(W * 0.06));
for (const [cx, cy] of [[0, 0], [W - box, 0], [0, H - box], [W - box, H - box]]) {
  for (let y = cy; y < cy + box; y++) for (let x = cx; x < cx + box; x++) { cornerBoxTotal++; if (alphaAt(x, y) > 16) cornerBoxOpaque++; }
}
const needsCornerMask = !cornersTransparent || cornerBoxOpaque / cornerBoxTotal > 0.02;

// background statistics of the tile right around the orca (the area the orca sits on)
const nearOrca = new Uint8Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (orcaMask[y * W + x]) {
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < W && ny >= 0 && ny < H) nearOrca[ny * W + nx] = 1;
  }
}
const bgLums = [], bgPixels = [];
for (let y = orcaBox.y0; y <= orcaBox.y1; y++) for (let x = orcaBox.x0; x <= orcaBox.x1; x++) {
  const i = y * W + x;
  if (nearOrca[i] || alphaAt(x, y) < 200) continue;
  bgLums.push(lum[i]); bgPixels.push(rgbAt(x, y));
}
if (!bgLums.length) throw new Error('no background pixels found around the orca');
let bgMaxLum = 0;
for (const l of bgLums) if (l > bgMaxLum) bgMaxLum = l;
const BLACK_POINT = Math.ceil(bgMaxLum) + 3;            // tile background -> alpha 0
const med = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const tileBg = [0, 1, 2].map((c) => med(bgPixels.map((p) => p[c])));
const tileBgMean = [0, 1, 2].map((c) => Math.round(bgPixels.reduce((a, p) => a + p[c], 0) / bgPixels.length));
// most frequent exact RGB among dark tile pixels (whole canvas)
const modeMap = new Map();
for (let i = 0; i < N; i++) {
  if (src[i * C + 3] < 250 || lum[i] > 60) continue;
  const k = `${src[i * C]},${src[i * C + 1]},${src[i * C + 2]}`;
  modeMap.set(k, (modeMap.get(k) || 0) + 1);
}
const tileBgMode = [...modeMap.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
// corner-most opaque pixel along the top-left diagonal (the "corner pixel" of the tile)
let cornerOpaque = null;
for (let d = 0; d < Math.min(W, H); d++) if (alphaAt(d, d) > 250) { cornerOpaque = { d, rgb: rgbAt(d, d) }; break; }

// ------------------------------- step 4: orca sprite (tight crop + luminance alpha)
const alphaField = new Uint8ClampedArray(N);
for (let i = 0; i < N; i++) {
  const a = lum[i] <= BLACK_POINT ? 0 : ((lum[i] - BLACK_POINT) * 255) / (255 - BLACK_POINT);
  alphaField[i] = a > 255 ? 255 : a;
}
const spriteMask = new Uint8Array(N);
for (let i = 0; i < N; i++) spriteMask[i] = alphaField[i] >= 8 ? 1 : 0;
const sprite = largestComponentBox(spriteMask, W, H);
const crop = {
  x0: Math.max(0, sprite.x0 - 1), y0: Math.max(0, sprite.y0 - 1),
  x1: Math.min(W - 1, sprite.x1 + 1), y1: Math.min(H - 1, sprite.y1 + 1),
};
const cropW = crop.x1 - crop.x0 + 1, cropH = crop.y1 - crop.y0 + 1;

/** Raw RGBA sprite buffer of the crop: uniform `rgb` colour, alpha from luminance. */
function spriteBuffer(rgb) {
  const out = Buffer.alloc(cropW * cropH * 4);
  for (let y = 0; y < cropH; y++) for (let x = 0; x < cropW; x++) {
    const s = (y + crop.y0) * W + (x + crop.x0), d = (y * cropW + x) * 4;
    out[d] = rgb[0]; out[d + 1] = rgb[1]; out[d + 2] = rgb[2]; out[d + 3] = alphaField[s];
  }
  return out;
}
const rawOpts = (w, h) => ({ raw: { width: w, height: h, channels: 4, premultiplied: false } });

// ------------------------------------------------------------ mask helpers (AA)
function coverage(size, inside) {
  const cov = new Float32Array(size * size);
  const step = 1 / AA_SAMPLES, off = step / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let hit = 0;
    for (let sy = 0; sy < AA_SAMPLES; sy++) for (let sx = 0; sx < AA_SAMPLES; sx++) {
      if (inside(x + off + sx * step, y + off + sy * step)) hit++;
    }
    cov[y * size + x] = hit / (AA_SAMPLES * AA_SAMPLES);
  }
  return cov;
}
const roundRectMask = (size, rFrac) => {
  const r = size * rFrac;
  return coverage(size, (px, py) => {
    if (px < 0 || py < 0 || px > size || py > size) return false;
    const cx = Math.min(Math.max(px, r), size - r), cy = Math.min(Math.max(py, r), size - r);
    const dx = px - cx, dy = py - cy;
    return dx * dx + dy * dy <= r * r;
  });
};
const circleMask = (size) => {
  const c = size / 2, r = size / 2 - 0.5;
  return coverage(size, (px, py) => (px - c) * (px - c) + (py - c) * (py - c) <= r * r);
};
function applyCoverage(buf, size, cov) {
  for (let i = 0; i < size * size; i++) buf[i * 4 + 3] = Math.round(buf[i * 4 + 3] * cov[i]);
  return buf;
}
/**
 * Force an exact flat colour on every visible pixel. libvips premultiplies around resize
 * and un-premultiplies afterwards, which can leave e.g. 254 instead of 255 on soft edges;
 * this makes "pure white orca" exact. Fully transparent pixels keep RGBA(0,0,0,0).
 */
function forceRgbWhereVisible(buf, rgb) {
  for (let i = 0; i < buf.length; i += 4) {
    if (buf[i + 3] === 0) continue;
    buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2];
  }
  return buf;
}

// ------------------------------------------------------------------- generate
const outputs = [];   // {file, w, h, kind}
const writePng = async (buf, size, file) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(buf, rawOpts(size, size)).png({ compressionLevel: 9 }).toFile(file);
};
function paste(canvas, size, sprite, sw, sh) {
  const left = Math.floor((size - sw) / 2), top = Math.floor((size - sh) / 2);
  for (let y = 0; y < sh; y++) {
    sprite.copy(canvas, ((top + y) * size + left) * 4, y * sw * 4, (y + 1) * sw * 4);
  }
  return canvas;
}

// A + B: legacy & round launcher icons
for (const [bucket, size] of LEGACY) {
  const dir = path.join(RES_DIR, `mipmap-${bucket}`);
  // legacy: straight downscale of the source tile (transparent corners preserved)
  const legacyFile = path.join(dir, 'ic_launcher.png');
  let buf = await sharp(SRC).resize(size, size, { kernel: 'lanczos3', fit: 'fill' }).ensureAlpha().raw().toBuffer();
  if (needsCornerMask) { buf = Buffer.from(buf); applyCoverage(buf, size, roundRectMask(size, CORNER_RADIUS_FRACTION)); }
  await writePng(buf, size, legacyFile);
  outputs.push({ file: legacyFile, w: size, h: size, kind: 'legacy' });

  // round: flatten the transparent squircle corners onto the tile colour, then circle-mask
  const roundFile = path.join(dir, 'ic_launcher_round.png');
  let rbuf = await sharp(SRC)
    .flatten({ background: { r: tileBg[0], g: tileBg[1], b: tileBg[2] } })
    .resize(size, size, { kernel: 'lanczos3', fit: 'fill' })
    .ensureAlpha().raw().toBuffer();
  rbuf = Buffer.from(rbuf);
  applyCoverage(rbuf, size, circleMask(size));
  await writePng(rbuf, size, roundFile);
  outputs.push({ file: roundFile, w: size, h: size, kind: 'round' });
}

// C: adaptive-icon foreground (white orca, alpha from luminance, inside the safe zone)
const whiteSprite = spriteBuffer([255, 255, 255]);
for (const [bucket, size] of FOREGROUND) {
  const scale = Math.min((SAFE_FRACTION * size) / cropW, (SAFE_FRACTION * size) / cropH);
  const tw = Math.max(1, Math.floor(cropW * scale)), th = Math.max(1, Math.floor(cropH * scale));
  const resized = await sharp(whiteSprite, rawOpts(cropW, cropH)).resize(tw, th, { kernel: 'lanczos3', fit: 'fill' }).raw().toBuffer();
  forceRgbWhereVisible(resized, [255, 255, 255]);
  const canvas = Buffer.alloc(size * size * 4); // fully transparent
  paste(canvas, size, resized, tw, th);
  const file = path.join(RES_DIR, `mipmap-${bucket}`, 'ic_launcher_foreground.png');
  await writePng(canvas, size, file);
  outputs.push({ file, w: size, h: size, kind: 'foreground', rgb: [255, 255, 255] });
}

// D: in-app logo assets
const logoSprite = (rgb, canvas) => {
  const scale = canvas / Math.max(cropW, cropH);           // tight: longest side fills the canvas
  const tw = Math.max(1, Math.round(cropW * scale)), th = Math.max(1, Math.round(cropH * scale));
  return { sprite: spriteBuffer(rgb), tw, th };
};
for (const [name, rgb] of [['orca-white.png', [255, 255, 255]], ['orca-black.png', tileBg]]) {
  const { sprite: sp, tw, th } = logoSprite(rgb, LOGO_CANVAS);
  const resized = await sharp(sp, rawOpts(cropW, cropH)).resize(tw, th, { kernel: 'lanczos3', fit: 'fill' }).raw().toBuffer();
  forceRgbWhereVisible(resized, rgb);
  const canvas = Buffer.alloc(LOGO_CANVAS * LOGO_CANVAS * 4);
  paste(canvas, LOGO_CANVAS, resized, tw, th);
  const file = path.join(WEB_DIR, name);
  await writePng(canvas, LOGO_CANVAS, file);
  outputs.push({ file, w: LOGO_CANVAS, h: LOGO_CANVAS, kind: 'logo', rgb });
}
{
  const file = path.join(WEB_DIR, 'orca-tile.png');
  fs.mkdirSync(WEB_DIR, { recursive: true });
  await sharp(SRC).resize(LOGO_CANVAS, LOGO_CANVAS, { kernel: 'lanczos3', fit: 'fill' })
    .png({ compressionLevel: 9 }).toFile(file);
  outputs.push({ file, w: LOGO_CANVAS, h: LOGO_CANVAS, kind: 'tile' });
}

// ------------------------------------------------------- verification pass
const rows = [];
let failures = 0;
for (const o of outputs) {
  const checks = [];
  const stat = fs.statSync(o.file);
  const bytes = stat.size;
  if (bytes < 200) { checks.push('FILE-TOO-SMALL'); }
  // (1) sharp re-decode
  const { data, info: vi } = await sharp(o.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const dimOk = vi.width === o.w && vi.height === o.h;
  if (!dimOk) checks.push(`DIM(${vi.width}x${vi.height})`);
  if (!vi.hasAlpha) checks.push('NO-ALPHA');
  const n = vi.width * vi.height, ch = vi.channels;
  const A = (x, y) => data[(y * vi.width + x) * ch + 3];
  let minA = 255, maxA = 0, opaque = 0, semi = 0;
  for (let i = 0; i < n; i++) {
    const a = data[i * ch + 3];
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
    if (a > 200) opaque++;
    if (a > 8 && a < 248) semi++;
  }
  const cw = vi.width - 1, chh = vi.height - 1;
  const corners = [[0, 0], [cw, 0], [0, chh], [cw, chh]].map(([x, y]) => A(x, y));
  const maxCorner = Math.max(...corners);
  const centerA = A(vi.width >> 1, vi.height >> 1);
  const opaqueFrac = opaque / n;

  if (maxA < 250) checks.push('FULLY-TRANSPARENT');
  if (opaqueFrac < 0.02) checks.push('TOO-EMPTY');
  if (maxCorner > 16) checks.push(`CORNER-OPAQUE(${maxCorner})`);

  if (o.kind === 'legacy' || o.kind === 'tile') {
    if (centerA < 250) checks.push(`CENTER-TRANSPARENT(${centerA})`);
  }
  if (o.kind === 'round') {
    // the whole inscribed disk must be opaque: a transparent sliver anywhere inside the
    // circle (e.g. the source squircle's corners showing through) is a hard failure
    const cxy = vi.width / 2, rIn = vi.width / 2 * 0.9;
    let worst = 255, wx = 0, wy = 0;
    for (let y = 0; y < vi.height; y++) for (let x = 0; x < vi.width; x++) {
      const dx = x + 0.5 - cxy, dy = y + 0.5 - cxy;
      if (dx * dx + dy * dy <= rIn * rIn) { const a = A(x, y); if (a < worst) { worst = a; wx = x; wy = y; } }
    }
    if (worst < 250) checks.push(`HOLE-IN-DISK(a=${worst}@${wx},${wy})`);
    if (centerA < 250) checks.push(`CENTER-TRANSPARENT(${centerA})`);
    if (semi === 0) checks.push('NO-ANTIALIASED-RIM');
  }
  if (o.kind === 'foreground' || o.kind === 'logo') {
    // every visible pixel must be exactly the requested flat colour (straight alpha)
    const want = o.rgb;
    let bad = 0;
    for (let i = 0; i < n; i++) {
      if (data[i * ch + 3] === 0) continue;
      if (data[i * ch] !== want[0] || data[i * ch + 1] !== want[1] || data[i * ch + 2] !== want[2]) bad++;
    }
    if (bad) checks.push(`NON-${want[0] === 255 ? 'WHITE' : 'FLAT-COLOR'}(${bad})`);
    if (o.kind === 'foreground') {
      // safe zone: the visible orca must stay inside 62% of the canvas
      let x0 = vi.width, y0 = vi.height, x1 = -1, y1 = -1;
      for (let y = 0; y < vi.height; y++) for (let x = 0; x < vi.width; x++) {
        if (A(x, y) > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (bw > SAFE_FRACTION * vi.width + 1 || bh > SAFE_FRACTION * vi.height + 1) checks.push(`OUT-OF-SAFE-ZONE(${bw}x${bh})`);
      if (Math.abs((x0 + x1) / 2 - (vi.width - 1) / 2) > 1.5 || Math.abs((y0 + y1) / 2 - (vi.height - 1) / 2) > 1.5) checks.push('NOT-CENTERED');
    }
  }
  // (2) independent pngjs decode + cross-decoder agreement
  let pngjsNote = 'n/a';
  if (PNGJS) {
    try {
      const p = PNGJS.sync.read(fs.readFileSync(o.file));
      let diff = 0;
      for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) if (Math.abs(p.data[i * 4 + c] - data[i * ch + c]) > 2) diff++;
      if (p.width !== o.w || p.height !== o.h) checks.push('PNGJS-DIM');
      if (diff) checks.push(`DECODER-MISMATCH(${diff})`);
      pngjsNote = diff ? `diff=${diff}` : 'ok';
    } catch (e) { checks.push('PNGJS-FAIL:' + e.message); pngjsNote = 'fail'; }
  }
  if (checks.length) failures++;
  rows.push({
    file: path.relative(ROOT, o.file).replace(/\\/g, '/'), dim: `${vi.width}x${vi.height}`, bytes,
    minA, maxA, opaque: pct(opaque, n), corner: maxCorner, center: centerA, pngjs: pngjsNote,
    status: checks.length ? 'FAIL ' + checks.join(',') : 'PASS',
  });
}

// ------------------------------------------------------------------- report
const line = (s) => console.log(s);
line('');
line('================ DSH icon generation report ================');
line(`source            : ${SRC}`);
line(`source image      : ${W}x${H} RGBA, ${(fs.statSync(SRC).size / 1024).toFixed(0)} KiB`);
line(`toolchain         : sharp ${sharp.versions?.sharp ?? ''} (libvips ${sharp.versions.vips}) + pngjs for verification`);
line(`corners of source : ${cornerPx.map((p) => `(${p.x},${p.y}) rgba(${p.rgb.join(',')},${p.a})`).join(' ')}`);
line(`corner masking    : ${needsCornerMask ? 'APPLIED (rounded rect, r=22%)' : 'NOT NEEDED - source corners are already transparent'} ` +
  `[corner box ${box}x${box}: ${pct(cornerBoxOpaque, cornerBoxTotal)} opaque]`);
line(`tile bg RGB       : median rgb(${tileBg.join(',')}) = ${hex(...tileBg)}   mean rgb(${tileBgMean.join(',')}) = ${hex(...tileBgMean)}   modal rgb(${tileBgMode.join(',')}) = ${hex(...tileBgMode)}`);
line(`corner-most opaque: (${cornerOpaque.d},${cornerOpaque.d}) rgb(${cornerOpaque.rgb.join(',')}) [squircle edge/rim pixel]`);
line(`orca bbox         : x ${orcaBox.x0}..${orcaBox.x1}, y ${orcaBox.y0}..${orcaBox.y1}  (${orca.x1 - orca.x0 + 1}x${orca.y1 - orca.y0 + 1}, ${orca.count} px, threshold max(${ORCA_MIN_LUM}, rowBlack+${ORCA_ROW_MARGIN}))`);
line(`  naive lum>100   : x ${nx0}..${nx1}, y ${ny0}..${ny1}  <- unusable: catches the glossy tile sheen (row black level peaks at lum ${rowBlackMax.toFixed(0)}, tile gradient up to 208)`);
line(`crop used         : x ${crop.x0}..${crop.x1}, y ${crop.y0}..${crop.y1}  (${cropW}x${cropH}, 1px AA margin)`);
line(`alpha mapping     : alpha = clamp((lum - ${BLACK_POINT}) * 255 / (255 - ${BLACK_POINT}))  [row bg max lum ${bgMaxLum.toFixed(1)} -> transparent, white -> 255]`);
line('');
line('file                                              dims      bytes    minA  maxA  opaque   corner  center  pngjs  status');
line('----------------------------------------------------------------------------------------------------------------------');
for (const r of rows) {
  line(`${r.file.padEnd(49)} ${r.dim.padEnd(9)} ${String(r.bytes).padStart(7)}  ${String(r.minA).padStart(4)}  ${String(r.maxA).padStart(4)}  ${r.opaque.padStart(6)}  ${String(r.corner).padStart(6)}  ${String(r.center).padStart(6)}  ${r.pngjs.padEnd(6)} ${r.status}`);
}
line('----------------------------------------------------------------------------------------------------------------------');
line(`${rows.length} files, ${rows.length - failures} passed, ${failures} failed`);
line(`adaptive background colour to use: ${hex(...tileBg)}  (rgb ${tileBg.join(',')})`);
line('============================================================');
if (failures) process.exitCode = 1;
