/* 生成多套启动图标。
 *
 * 每套产出三张位图（普通 / 圆形 / 自适应前景）+ 一个 adaptive-icon 描述，
 * 落在各自的资源名下（ic_launcher_orca 等），由 AndroidManifest 里的
 * activity-alias 引用 —— 这样可以在不重装的前提下换桌面图标。
 *
 * 用法： node tools/make-icon-sets.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const RES = path.join(ROOT, 'app', 'android', 'res');
const WEB = path.join(ROOT, 'app', 'web', 'assets');

const DENSITIES = [
  { dir: 'mdpi', launcher: 48, fg: 108 },
  { dir: 'hdpi', launcher: 72, fg: 162 },
  { dir: 'xhdpi', launcher: 96, fg: 216 },
  { dir: 'xxhdpi', launcher: 144, fg: 324 },
  { dir: 'xxxhdpi', launcher: 192, fg: 432 }
];

/* 自适应图标前景只有中间约 66% 是安全区，超出的部分会被系统裁掉 */
const FG_SAFE = 0.66;

const PINK = '#FF6EB4';
const PINK_LIGHT = '#FFC2DE';
const INK = '#1B1D22';

/* ---------------- 鲸娘女仆 ----------------
   参照用户给的形象：蓝发、鲸鱼耳鳍、白色蕾丝头饰、藏青女仆裙 + 白围裙。 */
function maidBody() {
  const HAIR = '#4A6FD4';
  const HAIR_D = '#33509F';
  const DRESS = '#26365E';
  const SKIN = '#FFE3D2';
  return `
    <path d="M52 86 C16 66 -2 86 10 108 C18 122 44 126 60 112 Z" fill="${HAIR_D}"/>
    <path d="M50 88 C30 78 18 88 24 100" stroke="${HAIR}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M148 86 C184 66 202 86 190 108 C182 122 156 126 140 112 Z" fill="${HAIR_D}"/>
    <path d="M150 88 C170 78 182 88 176 100" stroke="${HAIR}" stroke-width="3" fill="none" stroke-linecap="round"/>
    <ellipse cx="100" cy="88" rx="60" ry="62" fill="${HAIR}"/>
    <path d="M70 126 L130 126 L154 186 L46 186 Z" fill="${DRESS}"/>
    <ellipse cx="62" cy="154" rx="10" ry="17" fill="${DRESS}" transform="rotate(20 62 154)"/>
    <ellipse cx="138" cy="154" rx="10" ry="17" fill="${DRESS}" transform="rotate(-20 138 154)"/>
    <path d="M82 132 L118 132 L128 182 L72 182 Z" fill="#FFFFFF"/>
    <path d="M100 138 l-16 -8 v17 z" fill="${HAIR}"/>
    <path d="M100 138 l16 -8 v17 z" fill="${HAIR}"/>
    <circle cx="100" cy="138" r="5.5" fill="${HAIR_D}"/>
    <ellipse cx="100" cy="94" rx="46" ry="44" fill="${SKIN}"/>
    <path d="M54 82 C58 44 84 28 100 28 C118 28 144 44 148 82
             C138 62 122 54 100 54 C78 54 62 62 54 82 Z" fill="${HAIR}"/>
    <path d="M51 60 Q100 18 149 60
             Q143 47 131 42 Q123 51 112 40 Q100 51 88 40 Q77 51 69 42 Q57 47 51 60 Z" fill="#FFFFFF"/>
    <path d="M51 60 Q100 18 149 60" stroke="${HAIR_D}" stroke-width="2.5" fill="none" opacity="0.3"/>
    <ellipse cx="81" cy="96" rx="12.5" ry="16" fill="#2A3050"/>
    <ellipse cx="81" cy="92" rx="8" ry="10" fill="#4A8FE0"/>
    <circle cx="85" cy="87" r="4.4" fill="#FFFFFF"/>
    <circle cx="77" cy="102" r="2.3" fill="#FFFFFF" opacity="0.85"/>
    <ellipse cx="119" cy="96" rx="12.5" ry="16" fill="#2A3050"/>
    <ellipse cx="119" cy="92" rx="8" ry="10" fill="#4A8FE0"/>
    <circle cx="123" cy="87" r="4.4" fill="#FFFFFF"/>
    <circle cx="115" cy="102" r="2.3" fill="#FFFFFF" opacity="0.85"/>
    <ellipse cx="61" cy="110" rx="9.5" ry="6" fill="#FF9EC4" opacity="0.6"/>
    <ellipse cx="139" cy="110" rx="9.5" ry="6" fill="#FF9EC4" opacity="0.6"/>
    <path d="M93 114 q7 8 14 0" stroke="#C4557A" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
}

/* 像素鲸鱼：把现成的像素图**逐个像素转成 SVG 方块**。
   直接内嵌位图 + image-rendering:pixelated 在光栅化时不被支持，
   结果被平滑插值糊成一团 —— 用方块重画才能保证硬边。 */
const pxSrc = await sharp(path.join(WEB, 'whale-pixel.png'))
  .ensureAlpha().raw().toBuffer({ resolveWithObject: true });

function pixelRects() {
  const { data, info } = pxSrc;
  let out = '';
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (data[i + 3] < 90) continue;                 // 半透明边缘丢掉，像素画要干净
      const hex = '#' + [data[i], data[i + 1], data[i + 2]]
        .map((v) => (v < 16 ? '0' : '') + v.toString(16)).join('');
      out += `<rect x="${x}" y="${y}" width="1" height="1" fill="${hex}"/>`;
    }
  }
  return out;
}

const PX_W = pxSrc.info.width, PX_H = pxSrc.info.height;
const pxScale = 172 / PX_W;
const pixelBody = '<g transform="translate(' + ((200 - PX_W * pxScale) / 2).toFixed(2) + ' ' +
  ((200 - PX_H * pxScale) / 2).toFixed(2) + ') scale(' + pxScale.toFixed(4) + ')">' +
  pixelRects() + '</g>';

/* ---------------- 各套图标 ---------------- */

const SETS = {
  /* 粉鲸 */
  pink: {
    label: '粉鲸',
    bg: '#1D4ED8',
    body: `
      <path d="M40 118 C36 86 66 62 104 62 C138 62 164 80 170 104
               C173 117 164 128 150 132 C122 139 74 140 52 131
               C44 128 41 124 40 118 Z" fill="${PINK}"/>
      <path d="M96 66 C100 40 116 32 128 44 C136 53 136 64 130 70 Z" fill="${PINK}"/>
      <path d="M74 128 C82 141 96 147 110 143 C102 135 92 129 84 125 Z" fill="#E85A9E"/>
      <circle cx="78" cy="96" r="5" fill="${INK}"/>
      <path d="M104 96 a10 10 0 0 1 20 0" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>
      <g fill="${PINK_LIGHT}" font-family="sans-serif" font-weight="bold">
        <text x="132" y="56" font-size="34" transform="rotate(-12 132 56)">z</text>
        <text x="154" y="36" font-size="28" transform="rotate(-12 154 36)">z</text>
        <text x="174" y="20" font-size="22" transform="rotate(-12 174 20)">z</text>
      </g>`
  },

  orca: {
    label: '虎鲸',
    bg: '#E8EDFF',
    body: `
      <path d="M156 110 C176 94 197 92 199 105 C200 116 188 123 175 120 Z" fill="${INK}"/>
      <path d="M156 120 C176 131 194 137 196 127 C197 117 184 111 173 112 Z" fill="${INK}"/>
      <path d="M28 114 C24 76 58 50 100 50 C136 50 162 70 168 98
               C171 112 162 124 146 128 C116 136 62 138 40 128
               C32 124 29 120 28 114 Z" fill="${INK}"/>
      <path d="M90 54 C93 18 107 4 123 12 C136 19 140 40 133 58
               C119 49 103 49 90 54 Z" fill="${INK}"/>
      <path d="M72 122 C80 137 95 143 110 139 C101 130 91 123 83 119 Z" fill="#2C3038"/>
      <path d="M40 116 C62 130 112 134 150 124 C154 120 154 114 150 110
               C112 122 66 120 44 108 Z" fill="#FFFFFF"/>
      <ellipse cx="72" cy="84" rx="15" ry="9" fill="#FFFFFF" transform="rotate(-10 72 84)"/>
      <circle cx="76" cy="87" r="4.5" fill="${INK}"/>`
  },

  maid: { label: '鲸娘女仆', bg: '#EAF0FF', body: maidBody() },

  pixel: { label: '像素鲸鱼', bg: '#FDEBF3', body: pixelBody }
};

/* ---------------- 组装 ---------------- */

function tileSvg(set, px, shape, inset) {
  const r = shape === 'circle' ? px / 2 : px * 0.22;
  const inner = px * inset;
  const off = (px - inner) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">
    <rect x="0" y="0" width="${px}" height="${px}" rx="${r}" ry="${r}" fill="${set.bg}"/>
    <g transform="translate(${off} ${off}) scale(${inner / 200})">${set.body}</g>
  </svg>`;
}

function fgSvg(set, px) {
  const inner = px * FG_SAFE;
  const off = (px - inner) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">
    <g transform="translate(${off} ${off}) scale(${inner / 200})">${set.body}</g>
  </svg>`;
}

const keys = Object.keys(SETS);
const colorsXml = ['<?xml version="1.0" encoding="utf-8"?>', '<resources>',
  '    <!-- 启动图标背景色：由 tools/make-icon-sets.mjs 生成，改这里没用 -->'];

for (const key of keys) {
  const set = SETS[key];
  // 应用图标定为像素粉鲸（真机对比后选定的）；其余只作开屏形象
  const isAppIcon = key === 'pixel';
  const resName = isAppIcon ? 'ic_launcher' : 'ic_launcher_' + key;
  colorsXml.push(`    <color name="${resName}_background">${set.bg}</color>`);

  // 只有应用图标那一套需要进 res/；
  // 其余的只是应用内开屏形象，放 assets 就够了 ——
  // 全塞进 res 会让 APK 白白多出两百多 KB。
  if (isAppIcon) {
    for (const d of DENSITIES) {
      const dir = path.join(RES, 'mipmap-' + d.dir);
      fs.mkdirSync(dir, { recursive: true });

      const square = await sharp(Buffer.from(tileSvg(set, d.launcher * 6, 'square', set.inset || 0.76)))
        .resize(d.launcher).png({ compressionLevel: 9 }).toBuffer();
      fs.writeFileSync(path.join(dir, resName + '.png'), square);

      const round = await sharp(Buffer.from(tileSvg(set, d.launcher * 6, 'circle', (set.inset || 0.76) - 0.08)))
        .resize(d.launcher).png({ compressionLevel: 9 }).toBuffer();
      fs.writeFileSync(path.join(dir, resName + '_round.png'), round);

      const fg = await sharp(Buffer.from(fgSvg(set, d.fg * 4)))
        .resize(d.fg).png({ compressionLevel: 9 }).toBuffer();
      fs.writeFileSync(path.join(dir, resName + '_foreground.png'), fg);
    }

    const anydpi = path.join(RES, 'mipmap-anydpi-v26');
    fs.mkdirSync(anydpi, { recursive: true });
    fs.writeFileSync(path.join(anydpi, resName + '.xml'),
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n' +
      `    <background android:drawable="@color/${resName}_background" />\n` +
      `    <foreground android:drawable="@mipmap/${resName}_foreground" />\n` +
      '</adaptive-icon>\n');
  }

  // 每套都出一张网页用的预览图（开屏形象选择器要用）
  const prev = await sharp(Buffer.from(tileSvg(set, 1024, 'square', set.inset || 0.76)))
    .resize(256).png({ compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(path.join(WEB, 'icon-' + key + '.png'), prev);

  console.log((isAppIcon ? resName + '.png (应用图标)' : '  assets/icon-' + key + '.png')
    .padEnd(30) + set.label);
}

colorsXml.push('    <color name="app_bg_light">#FFFFFF</color>');
colorsXml.push('    <color name="app_bg_dark">#131417</color>');
colorsXml.push('</resources>');
fs.writeFileSync(path.join(RES, 'values', 'colors.xml'), colorsXml.join('\n') + '\n', 'utf8');

console.log('\n' + keys.length + ' 套图标 x ' + DENSITIES.length + ' 个密度 = ' +
  (keys.length * DENSITIES.length * 3) + ' 张位图');
console.log('自适应描述: ' + keys.length + ' 个');
