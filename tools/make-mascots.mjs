/* 为 7 套主题各生成一个海洋生物吉祥物。
 *
 * 手写 SVG → sharp 光栅化成 PNG。先渲一张联络表看整体，
 * 不满意就改这里的路径再跑一次 —— 视觉部分靠反复看，不靠猜。
 *
 * 用法：
 *   node tools/make-mascots.mjs          # 生成 PNG + 联络表
 *   node tools/make-mascots.mjs sheet    # 只出联络表
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'app', 'web', 'assets');
const SHEET = path.join(ROOT, '.shots', 'mascots.png');

const SIZE = 512;

/* ---------------- 各主题的吉祥物 ---------------- */

const MASCOTS = {
  /* 官方蓝：虎鲸（黑白配色，和桌面图标同一只） */
  blue: {
    label: '官方蓝 · 虎鲸',
    bg: '#E8EDFF',
    svg: `
      <path d="M156 110 C176 94 197 92 199 105 C200 116 188 123 175 120 Z" fill="#1B1D22"/>
      <path d="M156 120 C176 131 194 137 196 127 C197 117 184 111 173 112 Z" fill="#1B1D22"/>
      <path d="M28 114 C24 76 58 50 100 50 C136 50 162 70 168 98 C171 112 162 124 146 128 C116 136 62 138 40 128 C32 124 29 120 28 114 Z" fill="#1B1D22"/>
      <path d="M90 54 C93 18 107 4 123 12 C136 19 140 40 133 58 C119 49 103 49 90 54 Z" fill="#1B1D22"/>
      <path d="M72 122 C80 137 95 143 110 139 C101 130 91 123 83 119 Z" fill="#2C3038"/>
      <path d="M40 116 C62 130 112 134 150 124 C154 120 154 114 150 110 C112 122 66 120 44 108 Z" fill="#FFFFFF"/>
      <ellipse cx="72" cy="84" rx="15" ry="9" fill="#FFFFFF" transform="rotate(-10 72 84)"/>
      <circle cx="76" cy="87" r="4.5" fill="#1B1D22"/>`
  },

  /* 克劳德橙：海星（珊瑚橙，和 Claude 品牌色是同一个色系） */
  claude: {
    label: '克劳德橙 · 海星',
    bg: '#FBEDE6',
    svg: `
      <g fill="#D97757" transform="translate(100 104)">
        <rect x="-17" y="-88" width="34" height="94" rx="17"/>
        <rect x="-17" y="-88" width="34" height="94" rx="17" transform="rotate(72)"/>
        <rect x="-17" y="-88" width="34" height="94" rx="17" transform="rotate(144)"/>
        <rect x="-17" y="-88" width="34" height="94" rx="17" transform="rotate(216)"/>
        <rect x="-17" y="-88" width="34" height="94" rx="17" transform="rotate(288)"/>
        <circle cx="0" cy="0" r="36"/>
      </g>
      <circle cx="100" cy="104" r="19" fill="#EFA184"/>
      <circle cx="83" cy="100" r="5.5" fill="#7A3A26"/>
      <circle cx="117" cy="100" r="5.5" fill="#7A3A26"/>
      <path d="M88 120 q12 11 24 0" stroke="#7A3A26" stroke-width="5" fill="none" stroke-linecap="round"/>`
  },

  /* 紫罗兰：水母（紫色 + 会发光） */
  violet: {
    label: '紫罗兰 · 水母',
    bg: '#ECE8FB',
    svg: `
      <g stroke="#9B84FF" stroke-width="9" stroke-linecap="round" fill="none">
        <path d="M64 108 C58 132 70 146 62 166"/>
        <path d="M86 112 C82 138 92 150 86 172"/>
        <path d="M114 112 C118 138 108 150 116 172"/>
        <path d="M136 108 C142 132 130 146 138 166"/>
      </g>
      <path d="M30 108 C30 64 62 36 100 36 C138 36 170 64 170 108 C170 115 164 119 156 119 L44 119 C36 119 30 115 30 108 Z" fill="#7C5CFF"/>
      <path d="M46 100 C58 70 82 56 106 58" stroke="#C9BCFF" stroke-width="9" fill="none" stroke-linecap="round" opacity="0.8"/>
      <circle cx="80" cy="95" r="6.5" fill="#2A1B4D"/>
      <circle cx="120" cy="95" r="6.5" fill="#2A1B4D"/>
      <path d="M89 108 q11 9 22 0" stroke="#2A1B4D" stroke-width="4.5" fill="none" stroke-linecap="round"/>`
  },

  /* 森林绿：海龟（长寿、沉稳，配墨绿） */
  forest: {
    label: '森林绿 · 海龟',
    bg: '#E4F2E9',
    svg: `
      <g fill="#2E9E6B">
        <ellipse cx="44" cy="72" rx="27" ry="14" transform="rotate(-28 44 72)"/>
        <ellipse cx="156" cy="72" rx="27" ry="14" transform="rotate(28 156 72)"/>
        <ellipse cx="48" cy="144" rx="23" ry="12" transform="rotate(24 48 144)"/>
        <ellipse cx="152" cy="144" rx="23" ry="12" transform="rotate(-24 152 144)"/>
      </g>
      <ellipse cx="100" cy="40" rx="23" ry="21" fill="#3FB57E"/>
      <circle cx="90" cy="38" r="5" fill="#0F1A14"/>
      <circle cx="110" cy="38" r="5" fill="#0F1A14"/>
      <ellipse cx="100" cy="106" rx="63" ry="55" fill="#2E9E6B"/>
      <ellipse cx="100" cy="106" rx="45" ry="38" fill="#4CC08A"/>
      <g fill="#1E6E4A">
        <circle cx="100" cy="81" r="9.5"/>
        <circle cx="75" cy="108" r="9.5"/>
        <circle cx="125" cy="108" r="9.5"/>
        <circle cx="100" cy="135" r="9.5"/>
      </g>`
  },

  /* 霓虹赛博：鮟鱇鱼（深海 + 发光诱饵 = 霓虹） */
  cyber: {
    label: '霓虹赛博 · 鮟鱇鱼',
    bg: '#EFE6F8',
    svg: `
      <path d="M104 68 C104 40 122 26 138 30" stroke="#FF3DCB" stroke-width="7" fill="none" stroke-linecap="round"/>
      <circle cx="142" cy="30" r="23" fill="#FF3DCB" opacity="0.3"/>
      <circle cx="142" cy="30" r="13" fill="#FF3DCB"/>
      <path d="M40 126 C36 90 66 64 104 64 C142 64 170 90 166 126 C163 152 140 166 104 166 C68 166 43 152 40 126 Z" fill="#1A1230"/>
      <path d="M42 124 C70 148 140 148 164 124 C150 156 122 166 104 166 C80 166 52 150 42 124 Z" fill="#2A1B4D"/>
      <g fill="#EAE0FF">
        <path d="M58 130 l8 16 l8 -14 z"/>
        <path d="M84 138 l7 17 l8 -15 z"/>
        <path d="M112 138 l8 15 l7 -17 z"/>
        <path d="M138 128 l8 14 l7 -16 z"/>
      </g>
      <circle cx="76" cy="98" r="12" fill="#EAE0FF"/>
      <circle cx="76" cy="98" r="5.5" fill="#08050F"/>
      <path d="M100 64 C104 48 118 42 128 50 C134 55 134 62 130 66 Z" fill="#FF3DCB" opacity="0.6"/>`
  },

  /* 女仆粉：Q 版二次元女仆
     这一套主题本身就是二次元风（蕾丝、蝴蝶结、爱心光标），配海洋生物会很违和，
     所以这里走人物形象：大头身比、蕾丝头饰、双马尾、大眼高光。 */
  maid: {
    label: '女仆粉 · Q 版女仆',
    bg: '#FDE8F1',
    svg: `
      <g fill="#FF8FC0">
        <ellipse cx="34" cy="96" rx="19" ry="31" transform="rotate(-16 34 96)"/>
        <ellipse cx="166" cy="96" rx="19" ry="31" transform="rotate(16 166 96)"/>
      </g>
      <ellipse cx="100" cy="82" rx="57" ry="59" fill="#FF8FC0"/>
      <path d="M72 120 L128 120 L150 178 L50 178 Z" fill="#3A2A38"/>
      <ellipse cx="64" cy="146" rx="9" ry="16" fill="#FFE3D2" transform="rotate(20 64 146)"/>
      <ellipse cx="136" cy="146" rx="9" ry="16" fill="#FFE3D2" transform="rotate(-20 136 146)"/>
      <path d="M83 126 L117 126 L126 174 L74 174 Z" fill="#FFFFFF"/>
      <path d="M100 131 l-15 -8 v16 z" fill="#FF5C8A"/>
      <path d="M100 131 l15 -8 v16 z" fill="#FF5C8A"/>
      <circle cx="100" cy="131" r="5" fill="#E84A7A"/>
      <ellipse cx="100" cy="88" rx="45" ry="43" fill="#FFE3D2"/>
      <path d="M55 76 C59 40 84 24 100 24 C118 24 143 40 147 76
               C138 58 122 50 100 50 C78 50 62 58 55 76 Z" fill="#FF8FC0"/>
      <path d="M52 54 Q100 14 148 54
               Q142 42 130 37 Q122 46 111 35 Q100 46 89 35 Q78 46 70 37 Q58 42 52 54 Z" fill="#FFFFFF"/>
      <g>
        <ellipse cx="82" cy="90" rx="12" ry="15.5" fill="#3A2430"/>
        <ellipse cx="82" cy="86" rx="7.5" ry="9.5" fill="#E85A9B"/>
        <circle cx="86" cy="81" r="4.2" fill="#FFFFFF"/>
        <circle cx="78" cy="96" r="2.2" fill="#FFFFFF" opacity="0.85"/>
      </g>
      <g>
        <ellipse cx="118" cy="90" rx="12" ry="15.5" fill="#3A2430"/>
        <ellipse cx="118" cy="86" rx="7.5" ry="9.5" fill="#E85A9B"/>
        <circle cx="122" cy="81" r="4.2" fill="#FFFFFF"/>
        <circle cx="114" cy="96" r="2.2" fill="#FFFFFF" opacity="0.85"/>
      </g>
      <ellipse cx="62" cy="104" rx="9" ry="5.5" fill="#FF9EC4" opacity="0.7"/>
      <ellipse cx="138" cy="104" rx="9" ry="5.5" fill="#FF9EC4" opacity="0.7"/>
      <path d="M94 108 q6 7 12 0" stroke="#C4557A" stroke-width="3" fill="none" stroke-linecap="round"/>`
  }
};

/* 像素粉复用现成的像素鲸鱼，不重画 */
const PIXEL = { label: '像素粉 · 像素鲸鱼', file: 'whale-pixel.png', bg: '#FDEBF3' };

/* ---------------- 渲染 ---------------- */

function wrap(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${SIZE}" height="${SIZE}">${inner}</svg>`;
}

const sheetTiles = [];

for (const key of Object.keys(MASCOTS)) {
  const m = MASCOTS[key];
  const buf = await sharp(Buffer.from(wrap(m.svg)))
    .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  fs.writeFileSync(path.join(OUT_DIR, 'mascot-' + key + '.png'), buf);
  console.log('mascot-' + key + '.png  ' + buf.length + 'B');

  sheetTiles.push({ key: key, label: m.label, bg: m.bg, buf: buf });
}

/* 联络表：一行放大图，方便一眼看整体 */
const CELL = 220, PAD = 14, LABEL_H = 34;
const cols = 4;
const rows = Math.ceil(sheetTiles.length / cols);
const sheetW = cols * (CELL + PAD) + PAD;
const sheetH = rows * (CELL + LABEL_H + PAD) + PAD;

const composites = [];
for (let i = 0; i < sheetTiles.length; i++) {
  const t = sheetTiles[i];
  const cx = PAD + (i % cols) * (CELL + PAD);
  const cy = PAD + Math.floor(i / cols) * (CELL + LABEL_H + PAD);
  composites.push({
    input: { create: { width: CELL, height: CELL, channels: 4, background: t.bg } },
    left: cx, top: cy
  });
  // 缩到格子里再叠上去，否则 512 的原图会溢出
  const thumb = await sharp(t.buf)
    .resize(CELL - 28, CELL - 28, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  composites.push({ input: thumb, left: cx + 14, top: cy + 14 });
  composites.push({
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${LABEL_H}">` +
      `<text x="${CELL / 2}" y="22" font-family="Microsoft YaHei, sans-serif" font-size="17"` +
      ` fill="#222" text-anchor="middle">${t.label}</text></svg>`),
    left: cx, top: cy + CELL
  });
}


await sharp({
  create: { width: sheetW, height: sheetH, channels: 4, background: '#FFFFFF' }
}).composite(composites).png().toFile(SHEET);

console.log('\n联络表: ' + path.relative(ROOT, SHEET) + '  (' + sheetW + 'x' + sheetH + ')');
