/* 生成 DeepSleep 的粉色睡觉鲸鱼图标。
 *
 * 思路：不重新抠图。上一步已经产出过抠好的 orca-white.png（白鲸 + alpha）与
 * orca-tile.png（原始圆角磁贴），这里只需要
 *   1) 把白鲸按 alpha 染色成粉色
 *   2) 把染好的鲸鱼叠回磁贴（像素级重合，正好盖住原来的白鲸）
 *   3) 用多边形画 zzz（不依赖字体，避免渲染出空白）
 *
 * 用法： node tools/make-icons-pink.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, '.icon-backup');
const RES = path.join(ROOT, 'app', 'android', 'res');
const WEB = path.join(ROOT, 'app', 'web', 'assets');

const PINK = { r: 0xFF, g: 0x6E, b: 0xB4 };
const ZZZ = '#FFC2DE';
const TILE_BG = '#1D4ED8';
const DENSITIES = [
  { dir: 'mdpi', launcher: 48, fg: 108 },
  { dir: 'hdpi', launcher: 72, fg: 162 },
  { dir: 'xhdpi', launcher: 96, fg: 216 },
  { dir: 'xxhdpi', launcher: 144, fg: 324 },
  { dir: 'xxxhdpi', launcher: 192, fg: 432 }
];

/* ---------- 用多边形画一个「Z」，不依赖任何字体 ---------- */
function zPolygon(x, y, w, h, t) {
  const p = [
    [x, y], [x + w, y], [x + w, y + t],
    [x + t, y + h - t], [x + w, y + h - t], [x + w, y + h],
    [x, y + h], [x, y + h - t], [x + w - t, y + t], [x, y + t]
  ];
  return 'M' + p.map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join('L') + 'Z';
}

function zzzSvg(size, zs, rotate) {
  const paths = zs.map((z) => `<path d="${zPolygon(z[0], z[1], z[2], z[3], z[4])}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<g fill="${ZZZ}" transform="rotate(${rotate} ${size / 2} ${size / 2})">${paths}</g></svg>`;
}

/* ---------- 染色：保留 alpha，RGB 全部换成粉色 ---------- */
async function tintPink(input) {
  const img = sharp(input).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) {
      data[i] = PINK.r;
      data[i + 1] = PINK.g;
      data[i + 2] = PINK.b;
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png().toBuffer();
}

/* ---------- alpha 包围盒 ---------- */
async function contentBox(pngBuf) {
  const { data, info } = await sharp(pngBuf).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('图片完全透明，包围盒为空');
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1, W: info.width, H: info.height };
}

const out = [];
function record(file, buf) {
  out.push({ file: path.relative(ROOT, file), bytes: buf.length });
  fs.writeFileSync(file, buf);
}

/** 校验 zzz 没有压在鲸鱼身上 */
async function assertNoOverlap(orcaPng, x, y, w, h, zzzPng) {
  const canvas = await sharp({
    create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).composite([{ input: orcaPng, left: x, top: y }]).png().toBuffer();
  const a = await sharp(canvas).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(zzzPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let hit = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i + 3] > 8 && b.data[i + 3] > 8) hit++;
  }
  const orcaPixels = (() => {
    let n = 0;
    for (let i = 0; i < a.data.length; i += 4) if (a.data[i + 3] > 8) n++;
    return n;
  })();
  const ratio = hit / Math.max(1, orcaPixels);
  console.log('zzz 与鲸鱼重叠像素: ' + hit + '（占鲸鱼 ' + (ratio * 100).toFixed(2) + '%）');
  if (ratio > 0.005) throw new Error('zzz 明显压在鲸鱼身上了，请调整位置');
}

/* ================================================================= */
async function main() {
  const whiteOrca = path.join(SRC, 'orca-white.png');
  if (!fs.existsSync(whiteOrca)) throw new Error('缺少 .icon-backup/orca-white.png');

  const pinkFull = await tintPink(whiteOrca);              // 512x512，白鲸位置不变
  const orcaBox = await contentBox(pinkFull);
  console.log('鲸鱼包围盒: ' + JSON.stringify(orcaBox));

  /* ---- A. 标记层：透明画布上的「粉鲸 + zzz」 ---- */
  const orcaW = 336;
  const orcaH = Math.round(orcaBox.height * (orcaW / orcaBox.width));
  const orcaAtX = 40;
  const orcaAtY = 512 - 45 - orcaH;

  const orcaResized = await sharp(pinkFull)
    .extract({ left: orcaBox.left, top: orcaBox.top, width: orcaBox.width, height: orcaBox.height })
    .resize(orcaW, orcaH, { fit: 'fill' })
    .png().toBuffer();

  // 整组带旋转，包围盒会外扩，位置要留够余量
  const zs = [
    [236, 158, 30, 30, 8],
    [282, 112, 40, 40, 10],
    [334, 62, 50, 50, 13]
  ];
  const zzzLayer = await sharp(Buffer.from(zzzSvg(512, zs, -8))).png().toBuffer();

  const mark = await sharp({
    create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  }).composite([
    { input: orcaResized, left: orcaAtX, top: orcaAtY },
    { input: zzzLayer, left: 0, top: 0 }
  ]).png().toBuffer();

  const markBox = await contentBox(mark);
  console.log('标记包围盒: ' + JSON.stringify(markBox));

  // 防回归：内容贴到画布边缘说明被裁了
  if (markBox.left < 2 || markBox.top < 2 ||
      markBox.left + markBox.width > 510 || markBox.top + markBox.height > 510) {
    throw new Error('标记内容贴到画布边缘，可能被裁切: ' + JSON.stringify(markBox));
  }
  await assertNoOverlap(orcaResized, orcaAtX, orcaAtY, orcaW, orcaH, zzzLayer);

  /* ---- mark-pink.png：裁到内容 + 留边，居中放进 512 ---- */
  const pad = 12;
  const crop = {
    left: Math.max(0, markBox.left - pad),
    top: Math.max(0, markBox.top - pad),
    width: 0,
    height: 0
  };
  crop.width = Math.min(512 - crop.left, markBox.width + pad * 2);
  crop.height = Math.min(512 - crop.top, markBox.height + pad * 2);

  const markPink = await sharp(await sharp(mark).extract(crop).png().toBuffer())
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  record(path.join(WEB, 'mark-pink.png'), markPink);

  /* ---- B. 磁贴版：自己画圆角底，再叠标记层 ----
     不直接复用原磁贴：原磁贴里本来就有一只白鲸，
     粉鲸的透明处（眼睛、腹部花纹）会把白鲸透出来，出现白斑。 */
  const squircle = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">` +
    `<rect x="0" y="0" width="512" height="512" rx="112" ry="112" fill="${TILE_BG}"/></svg>`);
  const squirclePng = await sharp(squircle).png().toBuffer();

  const inner = Math.round(512 * 0.88);
  const markScaled = await sharp(mark)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();

  const tile = await sharp(squirclePng).composite([{
    input: markScaled,
    left: Math.round((512 - inner) / 2),
    top: Math.round((512 - inner) / 2)
  }]).png().toBuffer();
  record(path.join(WEB, 'mark-tile.png'), tile);

  /* ---- C. 各密度 launcher / round / foreground ---- */
  for (const d of DENSITIES) {
    const dir = path.join(RES, 'mipmap-' + d.dir);
    fs.mkdirSync(dir, { recursive: true });

    const small = await sharp(tile).resize(d.launcher, d.launcher).png().toBuffer();
    record(path.join(dir, 'ic_launcher.png'), small);

    const r = d.launcher / 2;
    const circle = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${d.launcher}" height="${d.launcher}">` +
      `<circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/></svg>`);
    record(path.join(dir, 'ic_launcher_round.png'),
      await sharp(small).composite([{ input: circle, blend: 'dest-in' }]).png().toBuffer());

    // 自适应前景：内容缩到画布的 62% 并居中
    const target = d.fg * 0.62;
    const scale = Math.min(target / markBox.width, target / markBox.height);
    const w = Math.max(1, Math.round(markBox.width * scale));
    const h = Math.max(1, Math.round(markBox.height * scale));
    const fgContent = await sharp(mark).extract({
      left: markBox.left, top: markBox.top, width: markBox.width, height: markBox.height
    }).resize(w, h, { fit: 'fill' }).png().toBuffer();

    record(path.join(dir, 'ic_launcher_foreground.png'),
      await sharp({
        create: { width: d.fg, height: d.fg, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
      }).composite([{
        input: fgContent,
        left: Math.round((d.fg - w) / 2),
        top: Math.round((d.fg - h) / 2)
      }]).png().toBuffer());
  }

  /* ---- 删掉被替换的旧资源 ---- */
  for (const gone of ['orca-white.png', 'orca-black.png', 'orca-tile.png']) {
    const f = path.join(WEB, gone);
    if (fs.existsSync(f)) { fs.unlinkSync(f); console.log('已删除 ' + gone); }
  }

  console.log('\n产出：');
  out.forEach((o) => console.log('  ' + o.file.padEnd(52) + String(o.bytes).padStart(8) + ' B'));
  console.log('\n共 ' + out.length + ' 个文件');
}

main().catch((e) => { console.error(e); process.exit(1); });
