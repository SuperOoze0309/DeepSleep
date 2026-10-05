import fs from 'node:fs';
import path from 'node:path';

const WEB = path.resolve(import.meta.dirname, '..', 'app', 'web');
const files = ['index.html', 'js/ui.js', 'js/store.js', 'js/icons.js', 'js/main.js', 'js/markdown.js', 'js/api.js', 'js/util.js', 'js/search.js', 'css/app.css'];

console.log('file'.padEnd(18) + '单引号'.padStart(8) + '双引号'.padStart(8) + 'DeepSeek'.padStart(10) + 'D腐蚀'.padStart(8));
for (const rel of files) {
  const t = fs.readFileSync(path.join(WEB, rel), 'utf8');
  const sq = (t.match(/'/g) || []).length;
  const dq = (t.match(/"/g) || []).length;
  const ds = (t.match(/DeepSeek/g) || []).length;
  // 腐蚀特征：出现 E(D...D) 这种模式
  const rot = (t.match(/\bD[a-zA-Z-]+D\b/g) || []).length;
  console.log(rel.padEnd(18) + String(sq).padStart(8) + String(dq).padStart(8) + String(ds).padStart(10) + String(rot).padStart(8));
}

const ui = fs.readFileSync(path.join(WEB, 'js/ui.js'), 'utf8');
const icons = fs.readFileSync(path.join(WEB, 'js/icons.js'), 'utf8');
console.log('');
console.log('手势修复仍在      : ' + (ui.indexOf('installGestureGuard') > -1));
console.log('tap guard 仍在    : ' + (ui.indexOf('consumeDrag') > -1));
console.log('图标单引号修复仍在: ' + (icons.indexOf("url('data:image/svg") > -1));
console.log('原生 KV 存储仍在  : ' + (fs.readFileSync(path.join(WEB, 'js/util.js'), 'utf8').indexOf('kvGet') > -1));
console.log('markdown CJK 修复 : ' + (fs.readFileSync(path.join(WEB, 'js/markdown.js'), 'utf8').indexOf('relaxEmphasis') > -1));
