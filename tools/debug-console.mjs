/* 调试用：把几种典型场景都在浏览器里跑一遍，收集控制台输出。
   目的是抓「测试断言覆盖不到、但控制台在报错」的问题。 */
import { JSDOM, VirtualConsole } from 'jsdom';

const BASE = 'http://127.0.0.1:8787/';
const SCENES = [
  ['首页', '?demo=home&theme=light'],
  ['对话渲染', '?demo=chat&theme=light'],
  ['深色 + 赛博', '?demo=chat&scheme=cyber&theme=dark'],
  ['像素主题', '?demo=chat&scheme=pink&theme=light'],
  ['女仆主题', '?demo=chat&scheme=maid&theme=light'],
  ['设置页', '?demo=settings&theme=light'],
  ['高级设置', '?demo=advanced&theme=light'],
  ['开屏遮罩', '?demo=reinoverlay&theme=light']
];

let totalProblems = 0;

for (const [name, qs] of SCENES) {
  const vc = new VirtualConsole();
  const msgs = [];
  vc.on('jsdomError', (e) => msgs.push('JSDOM_ERROR: ' + (e && e.message ? e.message : e)));
  vc.on('error', (...a) => msgs.push('ERROR: ' + a.join(' ')));
  vc.on('warn', (...a) => msgs.push('WARN: ' + a.join(' ')));

  const url = BASE + qs;
  let html;
  try {
    html = await (await fetch(url)).text();
  } catch (e) {
    console.log('  ! 取不到 ' + name + ': ' + e.message);
    continue;
  }

  const dom = new JSDOM(html, {
    url, runScripts: 'dangerously', resources: 'usable',
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.fetch = (u, o) => fetch(String(u).startsWith('http') ? u : BASE + String(u).replace(/^\//, ''), o);
    }
  });

  await new Promise((r) => setTimeout(r, 1400));

  // 忽略刻意构造的假失败（预置的错误气泡、模拟的 401 等）
  const filtered = msgs.filter((m) =>
    !/Failed to load resource|net::ERR|Not implemented: HTMLCanvas|Could not parse CSS/i.test(m));

  const w = dom.window;
  const doc = w.document;
  const state = {
    view: ['view-chat', 'view-settings', 'view-advanced']
      .filter((id) => doc.getElementById(id) && !doc.getElementById(id).classList.contains('hidden'))
      .join(',') || '(无)',
    msgs: doc.querySelectorAll('#messages .msg').length,
    chips: doc.querySelectorAll('#hero-chips .hero-chip').length
  };

  console.log('[' + name.padEnd(12) + '] 视图=' + state.view.padEnd(22) +
    ' 消息=' + String(state.msgs).padStart(2) + ' 建议=' + state.chips +
    (filtered.length ? ('  控制台 ' + filtered.length + ' 条') : '  ✓'));

  filtered.slice(0, 4).forEach((m) => console.log('      ' + m.slice(0, 150)));
  totalProblems += filtered.length;

  dom.window.close();
}

console.log('');
console.log(totalProblems ? ('共 ' + totalProblems + ' 条控制台问题') : '✓ 所有场景控制台干净');
