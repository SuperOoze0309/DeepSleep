#!/usr/bin/env node
// Temporary visual probe: dump source + grid overlay + alpha mask for eyeballing.
import fs from 'node:fs';
import sharp from 'sharp';

const SRC = 'H:\\DSH-Desktop\\DSH Desktop\\resources\\app\\build\\app-icon.png';
const OUT = 'H:\\DSHworkspace\\Deepseek-Android\\tools\\_probe';
fs.mkdirSync(OUT, { recursive: true });

await sharp(SRC).resize(512, 512).png().toFile(`${OUT}\\src-512.png`);

// grid overlay every 64px of the 1024 source (=32px at 512)
let svg = '';
for (let i = 1; i < 16; i++) {
  const p = (i * 512) / 16;
  svg += `<line x1="${p}" y1="0" x2="${p}" y2="512" stroke="#00ff00" stroke-width="1" opacity="0.55"/>`;
  svg += `<line x1="0" y1="${p}" x2="512" y2="${p}" stroke="#00ff00" stroke-width="1" opacity="0.55"/>`;
}
for (let i = 0; i < 16; i++) {
  const p = (i * 512) / 16 + 3;
  svg += `<text x="${p}" y="14" font-family="monospace" font-size="13" fill="#00ff00">${i * 64}</text>`;
  svg += `<text x="3" y="${p + 12}" font-family="monospace" font-size="13" fill="#ffff00">${i * 64}</text>`;
}
await sharp(SRC).resize(512, 512)
  .composite([{ input: Buffer.from(`<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`), top: 0, left: 0 }])
  .png().toFile(`${OUT}\\src-grid.png`);

// alpha mask of sprite, cropped, at 512 wide
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const lum = new Float32Array(W * H);
for (let i = 0, p = 0; i < W * H; i++, p += C) lum[i] = data[p + 3] < 8 ? 0 : lumOf(data[p], data[p + 1], data[p + 2]);
const BLACK_POINT = 32;
const out = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  const a = lum[i] <= BLACK_POINT ? 0 : Math.min(255, ((lum[i] - BLACK_POINT) * 255) / (255 - BLACK_POINT));
  out[i * 4] = 255; out[i * 4 + 1] = 255; out[i * 4 + 2] = 255; out[i * 4 + 3] = a;
}
await sharp(out, { raw: { width: W, height: H, channels: 4 } })
  .flatten({ background: '#101010' }).resize(512, 512).png().toFile(`${OUT}\\mask-512.png`);
console.log('written');
