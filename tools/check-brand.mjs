import fs from 'node:fs';
import path from 'node:path';

const WEB = path.resolve(import.meta.dirname, '..', 'app', 'web');
const files = ['index.html', 'js/ui.js', 'js/store.js'];

for (const rel of files) {
  const text = fs.readFileSync(path.join(WEB, rel), 'utf8');
  const lines = text.split('\n');
  console.log('=== ' + rel + ' ===');
  lines.forEach((line, i) => {
    if (/DeepSeek|DeepSleep|deepsleep-client/.test(line)) {
      console.log('  ' + (i + 1) + ': ' + line.trim().slice(0, 110));
    }
  });
  // 抽查中文是否完好
  const zh = lines.find((l) => l.includes('尚未配置') || l.includes('嗨，我是') || l.includes('侧边抽屉'));
  console.log('  中文抽查: ' + (zh ? zh.trim().slice(0, 60) : '(未找到)'));
  console.log('');
}
