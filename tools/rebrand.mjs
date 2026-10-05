/* 品牌重命名：DeepSeek -> DeepSleep
 *
 * 刻意用 Node 而不是 PowerShell：PS 5.1 的默认编码会把 UTF-8 文件里的
 * 单引号等字符写坏（本次已经踩过一次，靠 build/assets 备份才救回来）。
 * 这里每一步都断言「确实替换到了」，替换不到就直接报错退出。
 *
 * 用法： node tools/rebrand.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const WEB = path.resolve(import.meta.dirname, '..', 'app', 'web');

const JOBS = [
  {
    file: 'index.html',
    edits: [
      ['<title>DeepSeek</title>', '<title>DeepSleep</title>'],
      ['<span class="brand-name">DeepSeek</span>', '<span class="brand-name">DeepSleep</span>'],
      ['嗨，我是 DeepSeek', '嗨，我是 DeepSleep'],
      ['placeholder="给 DeepSeek 发送消息"', 'placeholder="给 DeepSleep 发送消息"'],
      ['<div class="about-name">DeepSeek</div>', '<div class="about-name">DeepSleep</div>'],
      ['界面参照 DeepSeek 官方安卓端设计', '界面参照主流 AI 客户端的设计'],
      ['<div class="foot-ver" id="foot-ver">DeepSeek · 第三方 API 版</div>',
       '<div class="foot-ver" id="foot-ver">DeepSleep · 第三方 API 版</div>'],
      ['<div class="topbar-title" id="topbar-title">DeepSeek</div>',
       '<div class="topbar-title" id="topbar-title">DeepSleep</div>'],
      ['<span class="row-hint" id="scheme-hint">官方蓝：与 DeepSeek 官方客户端一致的品牌配色</span>',
       '<span class="row-hint" id="scheme-hint">官方蓝：经典品牌蓝 #4D6BFE，克制的圆角卡片</span>']
    ]
  },
  {
    file: 'js/ui.js',
    edits: [
      ["(convo.title || '新对话') : 'DeepSeek';", "(convo.title || '新对话') : 'DeepSleep';"],
      ["E('topbar-title').textContent = isSettings ? '设置' : '';",
       "E('topbar-title').textContent = isSettings ? '设置' : '';"],
      ["E('foot-ver').textContent = 'DeepSeek · v' + APP_VERSION;",
       "E('foot-ver').textContent = 'DeepSleep · v' + APP_VERSION;"],
      ["blue: '官方蓝：与 DeepSeek 官方客户端一致的品牌配色',",
       "blue: '官方蓝：经典品牌蓝 #4D6BFE，克制的圆角卡片',"],
      ["var name = 'deepseek-chats-' + new Date()", "var name = 'deepsleep-chats-' + new Date()"]
    ]
  },
  {
    file: 'js/store.js',
    edits: [
      ["app: 'deepseek-thirdparty-client',", "app: 'deepsleep-client',"]
    ]
  }
];

let failed = 0;

for (const job of JOBS) {
  const full = path.join(WEB, job.file);
  let text = fs.readFileSync(full, 'utf8');
  console.log('=== ' + job.file);

  for (const [from, to] of job.edits) {
    if (from === to) continue; // 占位，跳过
    const count = text.split(from).length - 1;
    if (count === 0) {
      // 已经替换过也算通过
      if (text.includes(to)) {
        console.log('  skip (already)  ' + JSON.stringify(from.slice(0, 46)));
        continue;
      }
      console.log('  MISS            ' + JSON.stringify(from.slice(0, 46)));
      failed++;
      continue;
    }
    text = text.split(from).join(to);
    console.log('  ok x' + count + '          ' + JSON.stringify(from.slice(0, 46)));
  }

  fs.writeFileSync(full, text, 'utf8');
}

console.log('');
// 复查：web 目录里不该再出现裸的 DeepSeek 品牌字样（URL / 模型名里的 deepseek 是小写，不受影响）
for (const f of ['index.html', 'js/ui.js', 'js/store.js', 'js/api.js', 'js/util.js', 'js/icons.js', 'js/markdown.js', 'js/search.js', 'js/main.js']) {
  const t = fs.readFileSync(path.join(WEB, f), 'utf8');
  const hits = t.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter((x) => /DeepSeek/.test(x.line));
  if (hits.length) {
    console.log('残留 DeepSeek 于 ' + f + ':');
    hits.forEach((h) => console.log('   ' + h.n + ': ' + h.line.trim().slice(0, 100)));
  }
}

if (failed) {
  console.log('\n有 ' + failed + ' 条替换没匹配上，请检查上面的 MISS');
  process.exit(1);
}
console.log('品牌重命名完成');
