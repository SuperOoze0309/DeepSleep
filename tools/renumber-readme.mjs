/* README 章节重新编号：插入「多服务商接入」后，其后的章节整体 +1。
 * 必须从后往前替换，否则会互相撞车。用法： node tools/renumber-readme.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve(import.meta.dirname, '..', 'README.md');
let text = fs.readFileSync(FILE, 'utf8');

// 从大到小，避免「二→三」撞上还没改的「三」
const MAP = [
  ['## 十二、签名信息', '## 十三、签名信息'],
  ['## 十一、安全与隐私', '## 十二、安全与隐私'],
  ['## 十、已知限制', '## 十一、已知限制'],
  ['## 九、踩过的坑（都已在代码里修掉）', '## 十、踩过的坑（都已在代码里修掉）'],
  ['## 八、自动化检查', '## 九、自动化检查'],
  ['## 七、不装 APK 也能看界面（本地预览）', '## 八、不装 APK 也能看界面（本地预览）'],
  ['## 六、从源码构建', '## 七、从源码构建'],
  ['## 五、项目结构', '## 六、项目结构'],
  ['## 四、四套配色主题', '## 五、四套配色主题'],
  ['## 三、功能', '## 四、功能'],
  ['## 二、首次配置', '## 三、首次配置']
];

for (const [from, to] of MAP) {
  if (text.includes(to)) { console.log('skip (已存在) ' + to); continue; }
  if (!text.includes(from)) { console.log('MISS           ' + from); continue; }
  text = text.split(from).join(to);
  console.log('ok             ' + from + '  ->  ' + to);
}

fs.writeFileSync(FILE, text, 'utf8');

console.log('\n当前章节：');
text.split('\n').filter((l) => l.startsWith('## ')).forEach((l) => console.log('  ' + l));
