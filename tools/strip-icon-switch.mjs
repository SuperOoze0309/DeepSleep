/* 一次性脚本：把 MainActivity 里「切换启动图标 / 钉到桌面」相关代码摘掉。
 * 用户已明确：应用图标固定不变，多套形象只用于应用内的开屏展示页。
 *
 * 删除范围一律用「段注释头 → 下一个段注释头」来定，不靠猜方法体结尾
 * （上一次就是靠猜，结果多删了 200 行）。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const file = path.join(ROOT, 'app', 'android', 'java', 'com', 'deepsleep', 'app', 'MainActivity.java');

let lines = fs.readFileSync(file, 'utf8').split('\n');
const before = lines.length;

function sectionHeaderIndex(keyword) {
  const i = lines.findIndex((l) => l.trim() === keyword);
  if (i < 0) throw new Error('找不到段落: ' + keyword);
  let s = i;
  while (s > 0 && !lines[s].trim().startsWith('/* ====')) s--;
  return s;
}

function nextSectionHeader(from) {
  for (let i = from + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('/* ====')) {
      // 往回退掉它上面的空行
      let e = i;
      while (e > from && lines[e - 1].trim() === '') e--;
      return e;
    }
  }
  throw new Error('后面没有段落头了');
}

/* 从后往前删，避免下标错位 */
const targets = ['钉到桌面', '启动图标切换'];
for (const name of targets) {
  const start = sectionHeaderIndex(name);
  const end = nextSectionHeader(start);
  const seg = lines.slice(start, end).join('\n');
  if (!/pinShortcut|decodeDataUrl|ICON_ALIASES|applyAppIcon/.test(seg)) {
    throw new Error('待删区间「' + name + '」内容不像预期，中止');
  }
  console.log('删除「' + name + '」: 第 ' + (start + 1) + ' - ' + end + ' 行（' + (end - start) + ' 行）');
  lines.splice(start, end - start);
}

/* 桥里对应的三个方法 */
const out = [];
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  if (/^public (void setAppIcon|String appIcon|void pinShortcut)\(/.test(t)) {
    if (out.length && out[out.length - 1].trim() === '@JavascriptInterface') out.pop();
    let depth = 0;
    do {
      depth += (lines[i].match(/\{/g) || []).length;
      depth -= (lines[i].match(/\}/g) || []).length;
      i++;
    } while (i < lines.length && depth > 0);
    while (i < lines.length && lines[i].trim() === '') i++;
    i--;
    console.log('删除桥方法');
    continue;
  }
  if (t.indexOf('applyAppIcon(currentAppIcon())') > -1) continue;
  if (t.indexOf('覆盖安装后系统有时会把 alias') > -1) continue;
  out.push(lines[i]);
}

/* 多余的 import */
const drop = /^import (android\.content\.pm\.Shortcut|android\.graphics\.Bitmap|android\.graphics\.drawable\.Icon|android\.os\.Build|android\.util\.Base64|android\.content\.ComponentName)/;
const cleaned = out.filter((l) => !drop.test(l.trim()));
console.log('删除 import: ' + (out.length - cleaned.length) + ' 行');

fs.writeFileSync(file, cleaned.join('\n'), 'utf8');
console.log('完成: ' + before + ' 行 -> ' + cleaned.length + ' 行');

const left = cleaned.filter((l) => /applyAppIcon|currentAppIcon|ICON_ALIASES|pinShortcut|decodeDataUrl|ShortcutManager|setComponentEnabledSetting|icon-alias/.test(l));
console.log(left.length ? ('仍有残留 ' + left.length + ' 处:') : '无残留');
left.forEach((l) => console.log('  ' + l.trim()));
