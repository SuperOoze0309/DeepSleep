/* 把用户给的表情包裁成开屏画面用的形象：
   去掉左侧的对话框、指人的手和饭碗，只留蓝发鲸娘本体。
   顺带输出一个用于取背景色的信息。
   用法： node tools/make-splash.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
// 原图放在 assets-src/ 并随仓库提交 —— 否则克隆下来重建不了开屏图
const SRC = path.join(ROOT, 'assets-src', 'splash-source.png');
const OUT_DIR = path.join(ROOT, 'app', 'android', 'res');
const WEB = path.join(ROOT, 'app', 'web', 'assets');

const meta = await sharp(SRC).metadata();
console.log('原图: ' + meta.width + 'x' + meta.height);

/* 只保留角色。左边 34% 是气泡和手，妥妥裁掉；
   右边留一点余量免得切到头发。 */
const left = Math.round(meta.width * 0.34);
const crop = {
  left: left,
  top: 0,
  width: meta.width - left,
  height: meta.height
};
console.log('裁剪: ' + JSON.stringify(crop) + '  -> ' + crop.width + 'x' + crop.height);

const cut0 = await sharp(SRC).extract(crop).png().toBuffer();

/* 裁完还会剩三块残留：左上角的气泡尾巴、左下角「喵!」和饭碗。
   角色的耳鳍伸到了 x≈40，不能继续往右裁，所以直接把这三块涂成背景白。 */
const cm = await sharp(cut0).metadata();
const PATCHES = [
  { x: 0, y: 0, w: 112, h: 190 },                       // 气泡尾巴
  { x: 0, y: Math.round(cm.height * 0.60), w: 78, h: 96 },   // 「喵!」
  { x: 0, y: Math.round(cm.height * 0.77), w: 86, h: cm.height }  // 饭碗
];
const patchSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + cm.width + '" height="' + cm.height + '">' +
  PATCHES.map((p) => `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="#FFFFFF"/>`).join('') +
  '</svg>';
console.log('涂白 ' + PATCHES.length + ' 块残留');

const cut = await sharp(cut0)
  .composite([{ input: Buffer.from(patchSvg), top: 0, left: 0 }])
  .png()
  .toBuffer();

/* 取四个角的中位色当背景，开屏时铺满能无缝接上 */
const { data, info } = await sharp(cut).ensureAlpha().raw()
  .toBuffer({ resolveWithObject: true });
const at = (x, y) => {
  const i = (y * info.width + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
};
const corners = [at(2, 2), at(info.width - 3, 2), at(2, info.height - 3)];
const bg = [0, 1, 2].map((k) => {
  const v = corners.map((c) => c[k]).sort((a, b) => a - b);
  return v[1];
});
const bgHex = '#' + bg.map((v) => (v < 16 ? '0' : '') + v.toString(16)).join('');
console.log('背景取样色: ' + bgHex);

/* 开屏用的位图：几个密度各出一份 */
const DENSITIES = [
  { dir: 'drawable-mdpi', w: 240 },
  { dir: 'drawable-hdpi', w: 360 },
  { dir: 'drawable-xhdpi', w: 480 },
  { dir: 'drawable-xxhdpi', w: 720 },
  { dir: 'drawable-xxxhdpi', w: 960 }
];
for (const d of DENSITIES) {
  const dir = path.join(OUT_DIR, d.dir);
  fs.mkdirSync(dir, { recursive: true });
  const buf = await sharp(cut)
    .resize({ width: d.w, fit: 'inside' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  fs.writeFileSync(path.join(dir, 'splash_char.png'), buf);
  console.log('  ' + d.dir + '/splash_char.png  ' + d.w + 'px  ' + (buf.length / 1024).toFixed(0) + 'KB');
}

/* 网页里也留一份（预览用） */
await sharp(cut).resize({ width: 420, fit: 'inside' }).png()
  .toFile(path.join(WEB, 'splash-char.png'));

/* 第二张开屏图：像素鲸鱼居中放在浅粉底上。
   名字叫 splash_pixel，和 splash_char 一样进 drawable-*，
   原生开屏按设置在这两张之间选。 */
const pixelSrc = path.join(WEB, 'whale-pixel.png');
for (const d of DENSITIES) {
  const dir = path.join(OUT_DIR, d.dir);
  fs.mkdirSync(dir, { recursive: true });
  const pm = await sharp(pixelSrc).metadata();
  const target = Math.round(d.w * 0.72);
  const whale = await sharp(pixelSrc)
    .resize({ width: target, kernel: 'nearest' })
    .png().toBuffer();
  const canvas = sharp({
    create: { width: d.w, height: d.w, channels: 4, background: '#FDEBF3' }
  }).composite([{ input: whale, gravity: 'center' }]);
  const buf = await canvas.png({ compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(path.join(dir, 'splash_pixel.png'), buf);
}
console.log('另出 splash_pixel.png（像素鲸鱼）' + DENSITIES.length + ' 个密度');

/* 写进 colors.xml */
const colorsFile = path.join(OUT_DIR, 'values', 'colors.xml');
let colors = fs.readFileSync(colorsFile, 'utf8');
if (colors.indexOf('splash_bg') < 0) {
  colors = colors.replace('</resources>',
    `    <color name="splash_bg">${bgHex}</color>\n</resources>`);
  fs.writeFileSync(colorsFile, colors, 'utf8');
  console.log('colors.xml 已加入 splash_bg = ' + bgHex);
}

console.log('\n完成。');
