/* 静态一致性审计：找出「引用了但不存在」的 id / class / 图标名 / CSS 变量。
   这类问题在真机上表现为元素不可见或静默失效，DOM 测试不一定覆盖得到。

   用法： node tools/audit.mjs
*/
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WEB = path.join(ROOT, 'app', 'web');

const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(WEB, 'css', 'app.css'), 'utf8');
const jsFiles = fs.readdirSync(path.join(WEB, 'js')).filter((f) => f.endsWith('.js'));
const js = jsFiles.map((f) => fs.readFileSync(path.join(WEB, 'js', f), 'utf8')).join('\n');

const problems = [];
const notes = [];
const uniq = (a) => Array.from(new Set(a));

const isClassToken = (t) => /^[a-z][\w-]*$/.test(t);

/* 去掉 { ... } 声明体，只留下选择器部分 —— 否则颜色值 #FFF5FA、
   url(data:...) 之类会被误当成 id / class。 */
function selectorsOnly(source) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0) out += c;
  }
  return out;
}
const cssSelectors = selectorsOnly(css);

/* ---------------- 1. id 引用 ---------------- */
const htmlIds = new Set(uniq([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])));
const jsIdRefs = uniq([
  ...[...js.matchAll(/\bE\('([^']+)'\)/g)].map((m) => m[1]),
  ...[...js.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1])
]);
const dynamicIds = new Set(['sheet']); // 由 openSheet() 动态生成的容器

const missingIds = jsIdRefs.filter((id) => !htmlIds.has(id) && !dynamicIds.has(id));
if (missingIds.length) problems.push('JS 引用了 index.html 中不存在的 id: ' + missingIds.join(', '));

/* ---------------- 2. 图标名 ---------------- */
const iconsSrc = fs.readFileSync(path.join(WEB, 'js', 'icons.js'), 'utf8');
const strokeBlock = iconsSrc.slice(iconsSrc.indexOf('var STROKE'), iconsSrc.indexOf('var FILL'));
const fillBlock = iconsSrc.slice(iconsSrc.indexOf('var FILL'), iconsSrc.indexOf('var cache'));
const definedIcons = new Set([
  ...[...strokeBlock.matchAll(/^\s{4}([a-z][a-zA-Z0-9]*):/gm)].map((m) => m[1]),
  ...[...fillBlock.matchAll(/^\s{4}([a-z][a-zA-Z0-9]*):/gm)].map((m) => m[1])
]);
const usedIcons = uniq([
  ...[...html.matchAll(/data-icon="([^"]+)"/g)].map((m) => m[1]),
  ...[...js.matchAll(/iconHtml\('([^']+)'/g)].map((m) => m[1]),
  ...[...js.matchAll(/icon:\s*'([^']+)'/g)].map((m) => m[1])
]);
const missingIcons = usedIcons.filter((n) => !definedIcons.has(n));
if (missingIcons.length) problems.push('使用了未定义的图标名: ' + missingIcons.join(', '));

/* ---------------- 3. class 定义 ---------------- */
const cssClasses = new Set(
  [...cssSelectors.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1])
);

const htmlClasses = uniq(
  [...html.matchAll(/class="([^"]*)"/g)]
    .map((m) => m[1])
    .filter(isLiteralClass)
    .flatMap((s) => s.split(/\s+/)).filter(isClassToken)
);

/** 拼接出来的 class 不是字面量，跳过 —— 否则 "class=\"' + cls + '\"" 会把变量名当成类名 */
function isLiteralClass(s) {
  return s.indexOf('+') < 0 && s.indexOf('$') < 0 && s.indexOf('{') < 0;
}

const jsClasses = uniq([
  ...[...js.matchAll(/class:\s*'([^']*)'/g)].flatMap((m) => m[1].split(/\s+/)).filter(isClassToken),
  ...[...js.matchAll(/class="([^"]*)"/g)]
    .map((m) => m[1]).filter(isLiteralClass)
    .flatMap((s) => s.split(/\s+/)).filter(isClassToken),
  ...[...js.matchAll(/classList\.(?:add|remove|toggle|contains)\('([^']+)'/g)].map((m) => m[1]).filter(isClassToken),
  ...[...js.matchAll(/querySelector(?:All)?\('\.([\w-]+)/g)].map((m) => m[1]).filter(isClassToken),
  ...[...js.matchAll(/closest\('\.([\w-]+)/g)].map((m) => m[1]).filter(isClassToken)
]);

// 有语义但不需要单独样式的类 + 第三方（DuckDuckGo 结果页）选择器
const allowlist = new Set([
  'group', // 设置页的分组包裹元素，样式由 .group-title / .card 承担
  'bubble-text', 'small', 'chev', 'stop', 'send', 'nc-icon', 'code-lang',
  'working-text', 'err-text', 'sources-label', 'think-label', 'si-title', 'si-url',
  'cancel', 'ok', 'active', 'on', 'done', 'hidden', 'show', 'open', 'busy',
  'result', 'result--ad', 'result__snippet', 'result-snippet', 'result-link', 'hljs'
]);
const missingClasses = uniq([...htmlClasses, ...jsClasses])
  .filter((c) => !cssClasses.has(c) && !allowlist.has(c));
if (missingClasses.length) problems.push('使用了但 CSS 中未定义的 class（可能拼写错误）: ' + missingClasses.join(', '));

/* ---------------- 4. CSS 选择器里的 id ---------------- */
const cssIdRefs = uniq([...cssSelectors.matchAll(/#([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const missingCssIds = cssIdRefs.filter((id) => !htmlIds.has(id) && !dynamicIds.has(id));
if (missingCssIds.length) problems.push('CSS 选择器引用了不存在的 id: ' + missingCssIds.join(', '));

/* ---------------- 5. 资源引用 ---------------- */
const assetRefs = uniq([
  ...[...html.matchAll(/src="(assets\/[^"]+)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/href="(vendor\/[^"]+)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/src="(vendor\/[^"]+)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/href="(css\/[^"]+)"/g)].map((m) => m[1])
]);
const missingAssets = assetRefs.filter((r) => !fs.existsSync(path.join(WEB, r)));
if (missingAssets.length) problems.push('index.html 引用了不存在的文件: ' + missingAssets.join(', '));

/* ---------------- 6. CSS 变量定义 ---------------- */
const definedVars = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const usedVars = uniq([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
const undefinedVars = usedVars.filter((v) => !definedVars.has(v));
if (undefinedVars.length) problems.push('CSS 变量未定义: ' + undefinedVars.join(', '));

/* ---------------- 7. 结构型变量（不参与配色覆盖） ---------------- */
const STRUCTURAL = new Set(['--fs', '--radius', '--topbar-h', '--font', '--mono', '--inset-top', '--inset-bottom']);
const isColorVar = (v) => !STRUCTURAL.has(v);

const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('[data-theme="dark"]'));
const darkBlock = css.slice(css.indexOf('[data-theme="dark"]'), css.indexOf('* { box-sizing'));
const rootVars = new Set([...rootBlock.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const darkVars = new Set([...darkBlock.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

const missingInDark = [...rootVars].filter((v) => isColorVar(v) && !darkVars.has(v));
if (missingInDark.length) notes.push('深色主题未覆盖（沿用浅色值）: ' + missingInDark.join(', '));

/* ---------------- 8. 配色主题（scheme）完整性 ----------------
   自动扫描 CSS 里的配色区块，不再硬编码清单 ——
   新增一套配色只要动 CSS + JS 两处，检查会自动覆盖到。 */
function schemeBlocks(pattern) {
  const found = {};
  let m;
  const rx = new RegExp(pattern.source, 'g');
  while ((m = rx.exec(css)) !== null) found[m[1]] = m[2];
  return found;
}

const lightBlocks = schemeBlocks(/\[data-scheme="([a-z]+)"\]:not\(\[data-theme="dark"\]\)\s*\{([^}]*)\}/);
const darkBlocks = schemeBlocks(/\[data-scheme="([a-z]+)"\]\[data-theme="dark"\]\s*\{([^}]*)\}/);

const jsSchemes = uniq([...js.matchAll(/^\s{4}([a-z]+):\s*\{\s*label:/gm)].map((m) => m[1]));

for (const s of jsSchemes) {
  if (s === 'blue') continue; // 官方蓝直接用 :root 的默认值
  for (const pair of [['浅色', lightBlocks], ['深色', darkBlocks]]) {
    const kind = pair[0];
    const body = pair[1][s];
    if (!body) {
      problems.push('配色 "' + s + '" 缺少' + kind + '区块');
      continue;
    }
    const defined = new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const missing = [...rootVars].filter((v) => isColorVar(v) && !defined.has(v));
    if (missing.length) {
      problems.push('配色 "' + s + '" 的' + kind + '区块未覆盖变量（会串色）: ' + missing.join(', '));
    }
  }
}

// 反向检查：CSS 写了配色但 JS 没注册，用户永远选不到
for (const s of Object.keys(lightBlocks)) {
  if (!jsSchemes.includes(s)) problems.push('CSS 定义了配色 "' + s + '" 但 JS 的 SCHEMES 里没有');
}

notes.push('配色主题: ' + jsSchemes.join(', ') +
  '（CSS 浅色 ' + Object.keys(lightBlocks).length + ' 块 / 深色 ' + Object.keys(darkBlocks).length + ' 块）');

/* ---------------- 9. PowerShell 脚本必须保持纯 ASCII ----------------
   PS 5.1 对「无 BOM 的 UTF-8」按系统 ANSI 码页解码，
   脚本里一旦出现中文注释，解析就会错乱 —— 表现是签名突然失败，
   而且报错信息完全指不到真正的原因。踩过一次，这里锁死。 */
for (const rel of ['tools/build-apk.ps1']) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  const txt = fs.readFileSync(p, 'utf8');
  const bad = [...txt].filter((c) => c.charCodeAt(0) > 127).length;
  if (bad > 0) {
    problems.push(rel + ' 里有 ' + bad + ' 个非 ASCII 字符；' +
      'PowerShell 5.1 会把无 BOM 文件按 ANSI 解码，注释里的中文会导致解析错乱。请改回英文。');
  }
}

/* ---------------- 输出 ---------------- */
console.log('id 引用:   ' + jsIdRefs.length + ' 个引用 / HTML 定义 ' + htmlIds.size + ' 个');
console.log('图标:      ' + usedIcons.length + ' 个使用 / ' + definedIcons.size + ' 个定义');
console.log('class:     ' + uniq([...htmlClasses, ...jsClasses]).length + ' 个使用 / CSS ' + cssClasses.size + ' 个');
console.log('CSS 变量:  ' + usedVars.length + ' 个使用 / ' + definedVars.size + ' 个定义');
console.log('配色主题:  ' + jsSchemes.join(', '));
console.log('');

if (notes.length) {
  console.log('提示：');
  notes.forEach((n) => console.log('  · ' + n));
  console.log('');
}

if (problems.length) {
  console.log('发现问题：');
  problems.forEach((p) => console.log('  x ' + p));
  process.exit(1);
}
console.log('OK 静态审计通过，未发现悬空引用');
