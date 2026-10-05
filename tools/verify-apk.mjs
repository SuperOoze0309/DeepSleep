/* 校验产出的 APK：
 *   · 条目名必须是正斜杠（Android AssetManager 按字面名索引，反斜杠会导致资源 404）
 *   · resources.arsc / classes.dex 必须是 STORED 且 4 字节对齐
 *   · 关键前端资源确实打进去了，并且是最新内容
 *
 * 用法： node tools/verify-apk.mjs [apk]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const apkPath = process.argv[2] || path.join(ROOT, 'dist', 'DeepSleep-1.5.0.apk');

const buf = fs.readFileSync(apkPath);
const problems = [];

function readZip(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是 zip：找不到 EOCD');
  const total = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < total; i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('中央目录损坏 @' + p);
    const method = buffer.readUInt16LE(p + 10);
    const compSize = buffer.readUInt32LE(p + 20);
    const uncompSize = buffer.readUInt32LE(p + 24);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buffer.readUInt16LE(localOffset + 26);
    const lExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    out.push({ name, method, compSize, uncompSize, dataStart });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function entryData(e) {
  const raw = buf.subarray(e.dataStart, e.dataStart + e.compSize);
  return e.method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw);
}

const entries = readZip(buf);
const byName = new Map(entries.map((e) => [e.name, e]));

console.log('APK: ' + path.relative(ROOT, apkPath) +
  '  (' + (buf.length / 1048576).toFixed(2) + ' MB, ' + entries.length + ' 条目)');
console.log('');

/* 1. 路径分隔符 —— aapt2 在 Windows 上会写成反斜杠 */
const backslash = entries.filter((e) => e.name.includes('\\'));
if (backslash.length) {
  problems.push('有 ' + backslash.length + ' 个条目名含反斜杠（Android 会找不到这些资源）: ' +
    backslash.slice(0, 5).map((e) => e.name).join(', ') +
    (backslash.length > 5 ? ' 等' : ''));
}

/* 2. 压缩方式与对齐 */
for (const name of ['resources.arsc', 'classes.dex']) {
  const e = byName.get(name);
  if (!e) { problems.push('缺少 ' + name); continue; }
  if (e.method !== 0) problems.push(name + ' 被压缩了（targetSdk>=30 要求 STORED）');
  if (e.dataStart % 4 !== 0) problems.push(name + ' 未 4 字节对齐（偏移 ' + e.dataStart + '）');
}

/* 3. 关键资源存在 */
const required = [
  'AndroidManifest.xml',
  'resources.arsc',
  'classes.dex',
  'assets/index.html',
  'assets/css/app.css',
  'assets/js/icons.js',
  'assets/js/util.js',
  'assets/js/store.js',
  'assets/js/markdown.js',
  'assets/js/api.js',
  'assets/js/search.js',
  'assets/js/voice.js',
  'assets/js/reincarnate.js',
  'assets/js/ui.js',
  'assets/js/main.js',
  'assets/vendor/markdown-it.min.js',
  'assets/vendor/highlight.min.js',
  'assets/vendor/katex.min.js',
  'assets/vendor/contrib/auto-render.min.js',
  'assets/vendor/katex.min.css',
  'assets/assets/mark-pink.png',
  'assets/assets/mark-tile.png',
  'assets/assets/whale-pixel.png',
  'assets/assets/splash-char.png',
  'assets/assets/icon-pixel.png',
  'assets/js/memory.js',
  'res/drawable-xxxhdpi-v4/splash_char.png'
];
for (const r of required) {
  if (!byName.has(r)) problems.push('缺少资源: ' + r);
}

/* 4. 内容抽查 */
function textOf(name) {
  const e = byName.get(name);
  return e ? entryData(e).toString('utf8') : null;
}

const css = textOf('assets/css/app.css');
if (css) {
  for (const s of ['claude', 'violet', 'forest', 'cyber', 'pink', 'maid']) {
    if (css.indexOf('[data-scheme="' + s + '"]') < 0) {
      problems.push('app.css 里找不到配色 ' + s);
    }
  }
  if (css.indexOf('data-oled') < 0) problems.push('app.css 缺少纯黑模式样式');
  if (css.indexOf('data-density') < 0) problems.push('app.css 缺少消息密度样式');
  if (css.indexOf('accent-dot') < 0) problems.push('app.css 缺少强调色色板样式');
}

const html = textOf('assets/index.html');
if (html) {
  if (html.indexOf('seg-scheme') < 0) problems.push('index.html 里没有配色选择器');
  if (html.indexOf('set-voice') < 0) problems.push('index.html 里没有朗读音色设置');
  if (html.indexOf('vendor/markdown-it.min.js') < 0) problems.push('index.html 未引用 markdown-it');
  if (html.indexOf('js/voice.js') < 0) problems.push('index.html 未引用 voice.js');
  if (html.indexOf('js/reincarnate.js') < 0) problems.push('index.html 未引用 reincarnate.js');
  if (html.indexOf('btn-reincarnate') < 0) problems.push('index.html 里没有对话转生按钮');
  if (html.indexOf('whale-pixel.png') < 0) problems.push('index.html 未引用像素鲸鱼');
  if (html.indexOf('js/memory.js') < 0) problems.push('index.html 未引用 memory.js');
  if (html.indexOf('icon-picker') < 0) problems.push('index.html 里没有开屏形象选择器');
  if (html.indexOf('DeepSleep') < 0) problems.push('index.html 里没有 DeepSleep 品牌字样');
  if (html.indexOf('DeepSeek') > -1) problems.push('index.html 里还残留 DeepSeek 品牌字样');
  if (html.indexOf('assets/mark-pink.png') < 0) problems.push('index.html 未引用新的粉色图标资源');
  if (html.indexOf('orca-') > -1) problems.push('index.html 还在引用已删除的 orca-* 资源');
}

const uiJs = textOf('assets/js/ui.js');
if (uiJs) {
  if (uiJs.indexOf('SCHEMES') < 0) problems.push('ui.js 里没有 SCHEMES 定义');
  if (uiJs.indexOf('violet') < 0 || uiJs.indexOf('cyber') < 0) {
    problems.push('ui.js 的 SCHEMES 缺少新配色（会导致切换时回落到官方蓝）');
  }
  if (uiJs.indexOf('setSystemBars') < 0) problems.push('ui.js 未调用 setSystemBars');
}

const voiceJs = textOf('assets/js/voice.js');
if (voiceJs) {
  if (voiceJs.indexOf('__onTtsReady') < 0) problems.push('voice.js 未接朗读回调');
  if (voiceJs.indexOf('__onVoiceResult') > -1) {
    problems.push('voice.js 里还有语音识别回调（应已移除）');
  }
}
if (html && html.indexOf('btn-mic') > -1) {
  problems.push('index.html 里还有麦克风按钮（应已移除）');
}

const manifest = textOf('AndroidManifest.xml');
if (manifest && manifest.indexOf('RECORD_AUDIO') > -1) {
  // AndroidManifest.xml 在 APK 里是二进制，这条只在没被编译时才有效
  problems.push('清单里还声明了 RECORD_AUDIO 权限（应已移除）');
}

const dex = byName.get('classes.dex') ? entryData(byName.get('classes.dex')) : null;
if (dex) {
  const magic = dex.subarray(0, 4).toString('latin1');
  if (magic !== 'dex\n') problems.push('classes.dex magic 不正确: ' + JSON.stringify(magic));
  const dexText = dex.toString('latin1');
  for (const cls of ['MainActivity', 'LocalServer', 'AndroidBridge', 'setSystemBars',
                     'TextToSpeech', 'isCurrentUtterance', 'no-store']) {
    if (dexText.indexOf(cls) < 0) problems.push('classes.dex 中找不到 ' + cls);
  }
  if (dexText.indexOf('SpeechRecognizer') > -1) {
    problems.push('classes.dex 里还有 SpeechRecognizer（语音输入应已移除）');
  }
}

/* 5. 统计 */
const assetEntries = entries.filter((e) => e.name.startsWith('assets/'));
const storedCount = entries.filter((e) => e.method === 0).length;
console.log('assets 条目: ' + assetEntries.length + '，STORED: ' + storedCount + '，其余 DEFLATE');
console.log('');

if (problems.length) {
  console.log('发现问题：');
  problems.forEach((p) => console.log('  x ' + p));
  process.exit(1);
}
console.log('OK APK 校验通过');
