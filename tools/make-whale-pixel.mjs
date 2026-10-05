/* 生成「像素版」小鲸鱼：把 512px 的矢量风图标用最近邻降采样成 32px，
 * 页面里再用 image-rendering: pixelated 放大 —— 得到干净的像素画。
 *
 * 用法： node tools/make-whale-pixel.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'app', 'web', 'assets', 'mark-pink.png');
const OUT = path.join(ROOT, 'app', 'web', 'assets', 'whale-pixel.png');

const W = 32;   // 像素网格宽度

// 先裁掉透明边，再把上半部分（zzz 所在区域）切掉，只留鲸鱼本体
const trimmed = await sharp(SRC).trim({ threshold: 1 }).png().toBuffer();
const meta = await sharp(trimmed).metadata();
const cutTop = Math.round(meta.height * 0.34);

const whale = await sharp(trimmed)
  .extract({ left: 0, top: cutTop, width: meta.width, height: meta.height - cutTop })
  .png()
  .toBuffer();

const wm = await sharp(whale).metadata();
const h = Math.max(1, Math.round(W * wm.height / wm.width));

// 最近邻降采样 —— 这一步决定了它看起来像不像像素画
const px = await sharp(whale)
  .resize({ width: W, height: h, kernel: 'nearest', fit: 'fill' })
  .png({ compressionLevel: 9 })
  .toBuffer();

fs.writeFileSync(OUT, px);

// 统计一下实际用了多少种颜色（像素画应该很少）
const { data } = await sharp(px).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const colors = new Set();
for (let i = 0; i < data.length; i += 4) {
  if (data[i + 3] < 16) continue;
  colors.add(data[i] + ',' + data[i + 1] + ',' + data[i + 2]);
}

console.log('像素鲸鱼: ' + W + 'x' + h + '，' + px.length + 'B，' + colors.size + ' 种颜色');
console.log('输出: ' + path.relative(ROOT, OUT));
