/* 从 APK（或 res 目录）里把图标捞出来，统计主色，确认背景是不是真的变蓝了。
   用法： node tools/verify-icon.mjs [解包目录]
*/
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');

async function topColors(file, n = 5) {
  const { data, info } = await sharp(file).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const hist = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    const key = a < 16
      ? 'transparent'
      : '#' + [data[i], data[i + 1], data[i + 2]]
          .map((v) => (v < 16 ? '0' : '') + v.toString(16)).join('').toUpperCase();
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  const total = info.width * info.height;
  return Array.from(hist.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([c, v]) => c + ' ' + (v / total * 100).toFixed(1) + '%');
}

async function cornerAlpha(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x, y) => data[(y * info.width + x) * 4 + 3];
  return [at(0, 0), at(info.width - 1, 0), at(0, info.height - 1)];
}

const roots = [];
const unpacked = process.argv[2];
if (unpacked) roots.push({ label: 'APK 内', base: unpacked });
roots.push({ label: '源目录', base: path.join(ROOT, 'app', 'android', 'res') });

for (const r of roots) {
  console.log('=== ' + r.label + '  (' + r.base + ')');
  // 目录名可能是 mipmap-xxxhdpi 或 mipmap-xxxhdpi-v4
  let dirs = [];
  try {
    dirs = fs.readdirSync(r.base).filter((d) => d.startsWith('mipmap-xxxhdpi'));
  } catch (e) {
    console.log('  读不到目录: ' + e.message);
    continue;
  }
  for (const d of dirs) {
    for (const f of ['ic_launcher.png', 'ic_launcher_foreground.png']) {
      const p = path.join(r.base, d, f);
      if (!fs.existsSync(p)) continue;
      const meta = await sharp(p).metadata();
      console.log('  ' + d + '/' + f + '  ' + meta.width + 'x' + meta.height +
        '  ' + fs.statSync(p).size + 'B');
      console.log('     主色: ' + (await topColors(p)).join(' | '));
      if (f === 'ic_launcher.png') {
        console.log('     角上 alpha: ' + (await cornerAlpha(p)).join(',') + '（应为 0）');
      }
    }
  }
}

// colors.xml 里的自适应背景色
const colors = fs.readFileSync(path.join(ROOT, 'app', 'android', 'res', 'values', 'colors.xml'), 'utf8');
const m = /ic_launcher_background">([^<]+)</.exec(colors);
console.log('\ncolors.xml ic_launcher_background = ' + (m ? m[1] : '(未找到)'));
