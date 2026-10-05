/* 在 jsdom 中真实运行前端：加载 index.html + 全部脚本 + 种子数据，
   通过 Node 的 fetch 桥接预览服务器的假 SSE 接口，验证：
     · 启动无异常
     · 首页 / 对话 / 抽屉 / 设置 的 DOM 结构与状态
     · 发送消息 -> 流式输出 -> 最终渲染 的完整链路
     · Markdown / 代码块 / 表格 / 公式 / 思维链 / 搜索来源 / 错误框 的产出

   用法： node tools/test-dom.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.resolve(import.meta.dirname, '..');
const WEB = path.join(ROOT, 'app', 'web');
const BASE = 'http://127.0.0.1:8787/';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else {
    fail++;
    failures.push(name + (extra ? ' -> ' + extra : ''));
    console.log('  FAIL ' + name + (extra ? ' -> ' + extra : ''));
  }
}

/* ---------- 把 index.html 的外部脚本内联，避免 jsdom 走网络 ---------- */
function inlineScripts(html) {
  return html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
    const file = path.join(WEB, src);
    if (!fs.existsSync(file)) throw new Error('missing script: ' + src);
    const code = fs.readFileSync(file, 'utf8');
    // 防止脚本内容里的 </script> 提前闭合
    return '<script>' + code.replace(/<\/script>/gi, '<\\/script>') + '</script>';
  }).replace(/<link rel="stylesheet"[^>]*>/g, '');
}

/* ---------- 复用 preview-seed.js 生成 localStorage 种子 ---------- */
const seedSrc = fs.readFileSync(path.join(ROOT, 'tools', 'preview-seed.js'), 'utf8');

function makeSeed(search) {
  const store = new Map();
  const sandbox = {
    location: { search },
    URLSearchParams,
    localStorage: {
      clear() { store.clear(); },
      setItem(k, v) { store.set(k, String(v)); },
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      removeItem(k) { store.delete(k); }
    }
  };
  vm.runInNewContext(seedSrc, sandbox);
  return store;
}

const html = inlineScripts(fs.readFileSync(path.join(WEB, 'index.html'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 预检：端到端那一段依赖预览服务器模拟的 /api/proxy，
   服务器没起就只会看到一堆莫名其妙的断言失败，这里先明确报出来。 */
try {
  const probe = await fetch(BASE + '?demo=home');
  if (!probe.ok) throw new Error('HTTP ' + probe.status);
} catch (e) {
  console.error('\n预览服务器不可达: ' + BASE + '  (' + (e && e.message ? e.message : e) + ')');
  console.error('请先另开一个终端运行:  node tools/preview.mjs 8787\n');
  process.exit(2);
}

/* 预检：注入的驱动脚本必须能解析。
   它是模板字符串拼的，一个没转义的 \n 就会让整段脚本失效 ——
   而页面本身看起来完全正常，demo 模式却全部失灵，很难查。 */
{
  const r = spawnSync(process.execPath,
    [path.join(ROOT, 'tools', 'check-driver.mjs')], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error('\n注入驱动脚本有问题，所有 demo 模式都会失效：\n' +
      (r.stdout || '') + (r.stderr || ''));
    process.exit(3);
  }
}

async function boot(search, opts = {}) {
  const seed = makeSeed(search);
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e && e.message ? e.message : e)));
  vc.on('error', (msg) => errors.push('console.error: ' + msg));

  const dom = new JSDOM(html, {
    url: BASE + search,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      // 可选：注入一个假的原生桥，用来测语音/朗读这类只存在于 App 内的路径
      if (opts.bridge) window.AndroidBridge = opts.bridge;
      // 桥接 Node 的 fetch / 流 API
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? new URL(input, BASE).href : input;
        const o = {};
        if (init) {
          if (init.method) o.method = init.method;
          if (init.headers) o.headers = init.headers;
          if (init.body !== undefined) o.body = init.body;
          if (init.signal) o.signal = init.signal;
        }
        return fetch(url, o);
      };
      window.TextDecoder = TextDecoder;
      window.TextEncoder = TextEncoder;
      window.ReadableStream = ReadableStream;
      window.AbortController = AbortController;
      window.Response = Response;
      for (const [k, v] of seed) window.localStorage.setItem(k, v);
      window.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e)));
    }
  });

  await sleep(opts.settle || 400);
  return { dom, window: dom.window, doc: dom.window.document, errors };
}

function visible(el) {
  return !!el && !el.classList.contains('hidden');
}

/* ================================================================= */
console.log('\n[1] 启动与首页');
/* ================================================================= */
{
  const { window, doc, errors } = await boot('?demo=home&theme=light');
  check('启动无脚本错误', errors.length === 0, errors.join(' | '));
  check('DS 命名空间就绪', !!(window.DS && window.DS.ui && window.DS.md));
  // 回归守卫：DS.ui 是既有模块，main.js 会调用 DS.ui.init()。
  // 曾经有别的模块整个赋值 DS.ui，把 init 覆盖掉，App 会静默不初始化。
  check('DS.ui.init 仍然存在（没被其他模块覆盖）',
        typeof window.DS.ui.init === 'function',
        typeof window.DS.ui.init);
  check('首页 hero 可见', visible(doc.getElementById('hero')));
  check('首页无消息', doc.querySelectorAll('#messages .msg').length === 0);
  check('建议词条有 4 个', doc.querySelectorAll('#hero-chips .hero-chip').length === 4);
  check('发送按钮初始禁用', doc.getElementById('btn-send').disabled === true);
  check('深度思考开关为开', doc.getElementById('chip-think').getAttribute('aria-pressed') === 'true');
  check('联网搜索开关为关', doc.getElementById('chip-search').getAttribute('aria-pressed') === 'false');
  check('主题为 light', doc.documentElement.getAttribute('data-theme') === 'light');
  check('图标已渲染为 mask', (doc.querySelector('#btn-menu .ds-icon').style.getPropertyValue('-webkit-mask-image') || '').indexOf('data:image/svg') > -1,
        doc.querySelector('#btn-menu .ds-icon').getAttribute('style'));

  // 输入 -> 发送按钮可用
  const input = doc.getElementById('input');
  input.value = '你好';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  check('有内容后发送按钮可用', doc.getElementById('btn-send').disabled === false);
}

/* ================================================================= */
console.log('\n[2] 对话渲染（思维链 / Markdown / 代码 / 表格 / 来源 / 错误）');
/* ================================================================= */
{
  const { window, doc, errors } = await boot('?demo=chat&theme=light');
  check('启动无脚本错误', errors.length === 0, errors.join(' | '));

  const msgs = doc.querySelectorAll('#messages .msg');
  check('消息数量为 6', msgs.length === 6, 'got ' + msgs.length);
  check('首页 hero 已隐藏', !visible(doc.getElementById('hero')));
  check('用户气泡 3 条', doc.querySelectorAll('#messages .msg.user').length === 3);
  check('助手消息 3 条', doc.querySelectorAll('#messages .msg.assistant').length === 3);
  check('顶栏标题为对话标题', doc.getElementById('topbar-title').textContent === '快速排序原理与 Python 实现');

  const think = doc.querySelector('#messages .think');
  check('思维链区块可见', visible(think));
  check('思维链标题为已完成', /已深度思考（用时/.test(think.querySelector('.think-label').textContent),
        think.querySelector('.think-label').textContent);
  check('思维链正文非空', think.querySelector('.think-body').textContent.length > 40);

  const mdText = doc.querySelector('#messages .md').textContent;
  check('Markdown 渲染出标题', doc.querySelector('#messages .md h2') !== null);
  check('Markdown 渲染出代码块', doc.querySelector('#messages .code-block') !== null);
  check('代码块有语言标签', /python/.test(doc.querySelector('#messages .code-block .code-lang').textContent));
  check('代码高亮生效', doc.querySelectorAll('#messages .code-block .hljs-keyword, #messages .code-block .hljs-string').length > 0);
  check('代码块有复制按钮', doc.querySelector('#messages .code-block .code-copy') !== null);
  check('表格被包裹以支持横向滚动', doc.querySelector('#messages .md .table-wrap table') !== null);
  check('行内代码带 inline 类', doc.querySelector('#messages .md code.inline') !== null);
  check('有序列表已渲染', doc.querySelectorAll('#messages .md ol li').length >= 3);
  check('引用块已渲染', doc.querySelector('#messages .md blockquote') !== null);
  check('LaTeX 已渲染为 KaTeX', doc.querySelector('#messages .katex') !== null);

  const sources = doc.querySelectorAll('#messages .msg[data-id="m4"] .sources');
  check('搜索来源面板存在', sources.length === 1);
  check('来源条数为 3', sources[0].querySelectorAll('.source-item').length === 3);
  check('来源标题正确', /已搜索 3 个网页/.test(sources[0].querySelector('.sources-label').textContent));

  const err = doc.querySelector('#messages .msg[data-id="m6"] .err-box');
  check('错误框可见', visible(err));
  check('错误文案正确', /API Key 无效或未填写/.test(err.querySelector('.err-text').textContent));

  // 中文强调：CommonMark flanking 规则会把 `**中文（标点）**中文` 的星号原样输出
  const m4md = doc.querySelector('#messages .msg[data-id="m4"] .md');
  check('中文加粗已渲染（flanking 修复）', m4md.querySelector('strong') !== null,
        m4md.innerHTML.slice(0, 160));
  check('渲染后无残留星号', m4md.textContent.indexOf('**') < 0, m4md.textContent);
  check('哨兵字符未泄漏到 DOM', m4md.innerHTML.indexOf('\uE000') < 0);
  check('加粗文字内容正确', m4md.querySelector('strong') &&
        /分区/.test(m4md.querySelector('strong').textContent),
        m4md.querySelector('strong') ? m4md.querySelector('strong').textContent : '(none)');

  const actions = doc.querySelectorAll('#messages .msg-actions');
  check('操作栏存在', actions.length >= 2);
  const liked = doc.querySelector('#messages .act[data-act="like"].on');
  check('点赞状态已恢复', liked !== null);

  check('图片附件已渲染', doc.querySelectorAll('#messages .bubble-img').length === 1);

  // 用户消息必须有明确的操作入口（官方只做长按，长按不好发现）
  const umore = doc.querySelector('#messages .msg.user .act[data-act="more"]');
  check('用户消息带「⋯」操作入口', umore !== null);
  check('用户消息的操作图标已渲染', umore && (umore.querySelector('.ds-icon').getAttribute('style') || '')
        .indexOf('data:image/svg') > -1);
  if (umore) {
    umore.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const wrap = doc.getElementById('sheet-wrap');
    check('点击「⋯」弹出操作面板', !wrap.classList.contains('hidden'));
    const sheetText = wrap.textContent || '';
    check('面板含「编辑并重新发送」', sheetText.indexOf('编辑并重新发送') > -1, sheetText.slice(0, 80));
    check('面板含「复制」与「删除」', sheetText.indexOf('复制') > -1 && sheetText.indexOf('删除') > -1);
    // 关掉，避免影响后续断言
    wrap.querySelector('.sheet-bg').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check('点击遮罩关闭面板', wrap.classList.contains('hidden'));
  }

  // 助手消息的操作栏图标同样要能渲染出来
  const asstAct = doc.querySelector('#messages .msg.assistant .msg-actions .act .ds-icon');
  check('助手操作栏图标已渲染', asstAct && (asstAct.getAttribute('style') || '')
        .indexOf('data:image/svg') > -1);

  // 点击思维链标题应展开
  const head = doc.querySelector('#messages .think-head');
  head.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('点击思维链可展开', doc.querySelector('#messages .think').classList.contains('open'));
}

/* ================================================================= */
console.log('\n[3] 抽屉与对话列表');
/* ================================================================= */
{
  const { window, doc, errors } = await boot('?demo=drawer&theme=light');
  check('启动无脚本错误', errors.length === 0, errors.join(' | '));
  // 预览服务器会注入一个驱动脚本自动点击，jsdom 里没有，这里显式点击菜单键
  doc.getElementById('btn-menu').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('抽屉已打开', doc.getElementById('drawer').classList.contains('open'));
  check('遮罩已显示', doc.getElementById('scrim').classList.contains('show'));
  const items = doc.querySelectorAll('#conv-list .conv-item');
  check('对话列表 2 项', items.length === 2, 'got ' + items.length);
  check('有分组标题', doc.querySelectorAll('#conv-list .conv-group-title').length >= 2);
  check('当前对话高亮', doc.querySelectorAll('#conv-list .conv-item.active').length === 1);

  // 搜索过滤
  const search = doc.getElementById('conv-search');
  search.value = '北京';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  check('搜索过滤生效', doc.querySelectorAll('#conv-list .conv-item').length === 1);

  // 关闭抽屉
  doc.getElementById('scrim').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('点击遮罩关闭抽屉', !doc.getElementById('drawer').classList.contains('open'));
}

/* ================================================================= */
console.log('\n[4] 设置页');
/* ================================================================= */
{
  const { window, doc, errors } = await boot('?demo=settings&theme=dark');
  check('启动无脚本错误', errors.length === 0, errors.join(' | '));
  doc.getElementById('btn-settings').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('设置页可见', visible(doc.getElementById('view-settings')));
  check('对话页隐藏', !visible(doc.getElementById('view-chat')));
  check('返回键可见', visible(doc.getElementById('btn-back')));
  check('主题为 dark', doc.documentElement.getAttribute('data-theme') === 'dark');
  check('dark 高亮在深色按钮', doc.querySelector('#seg-theme button[data-v="dark"]').classList.contains('on'));
  check('接口地址已回填', doc.getElementById('set-base').value === 'https://api.deepseek.com');
  check('API Key 已回填', doc.getElementById('set-key').value.indexOf('sk-demo') === 0);
  check('模型下拉已填充', doc.querySelectorAll('#set-model option').length === 2);
  check('模型选中值正确', doc.getElementById('set-model').value === 'deepseek-flash');
  check('思考强度回填', doc.getElementById('set-effort').value === 'high');

  // 修改设置应写回 localStorage
  const base = doc.getElementById('set-base');
  base.value = 'https://my-relay.example.com/v1';
  base.dispatchEvent(new window.Event('change', { bubbles: true }));
  const saved = JSON.parse(window.localStorage.getItem('ds.settings.v1'));
  check('设置已持久化', saved.baseUrl === 'https://my-relay.example.com/v1', saved.baseUrl);
  check('baseUrl 归一化去掉 /v1 之外的尾斜杠', window.DS.baseUrlNormalized() === 'https://my-relay.example.com/v1');

  // 关键回归：部分输入法/机型收起键盘不触发 change，
  // 之前只监听 change 会出现「填了 API Key 却没保存」
  const keyEl = doc.getElementById('set-key');
  keyEl.value = 'sk-typed-without-blur';
  keyEl.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(700);
  check('输入过程中自动保存（无需失焦）',
        JSON.parse(window.localStorage.getItem('ds.settings.v1')).apiKey === 'sk-typed-without-blur',
        JSON.parse(window.localStorage.getItem('ds.settings.v1')).apiKey);

  check('jsdom 下走 localStorage 降级路径（无原生桥）', window.DS.store.usingNative === false);

  // 主题切换
  doc.querySelector('#seg-theme button[data-v="light"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('切到浅色主题生效', doc.documentElement.getAttribute('data-theme') === 'light');

  // 字号
  doc.querySelector('#seg-font button[data-v="1.1"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('字号写入 CSS 变量', doc.documentElement.style.getPropertyValue('--fs') === '1.1',
        doc.documentElement.style.getPropertyValue('--fs'));

  // 返回
  doc.getElementById('btn-back').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('返回后回到对话页', visible(doc.getElementById('view-chat')) && !visible(doc.getElementById('view-settings')));
}

/* ================================================================= */
console.log('\n[5] 端到端：发送消息 -> 流式输出 -> 最终渲染');
/* ================================================================= */
{
  const { window, doc, errors } = await boot('?demo=home&theme=light');
  check('启动无脚本错误', errors.length === 0, errors.join(' | '));

  const input = doc.getElementById('input');
  input.value = '用一段话解释量子纠缠，并给出一个 Python 示例。';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  doc.getElementById('btn-send').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  await sleep(150);

  check('用户消息已上屏', doc.querySelectorAll('#messages .msg.user').length === 1);
  check('助手占位已创建', doc.querySelectorAll('#messages .msg.assistant').length === 1);
  check('首页 hero 已隐藏', !visible(doc.getElementById('hero')));
  check('生成中：发送键变为停止', doc.getElementById('composer').classList.contains('busy'));
  check('生成中：出现进行中提示', visible(doc.querySelector('#messages .working')));

  // 等到流结束
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    if (!doc.getElementById('composer').classList.contains('busy')) break;
  }

  check('流式结束：忙碌状态解除', !doc.getElementById('composer').classList.contains('busy'));

  const asst = doc.querySelector('#messages .msg.assistant');
  const mdEl = asst.querySelector('.md');
  const text = mdEl.textContent;

  check('正文包含核心内容', /量子纠缠/.test(text));
  check('正文渲染出标题', mdEl.querySelector('h2') !== null);
  check('正文渲染出代码块', mdEl.querySelector('.code-block') !== null);
  check('代码内容正确', /QuantumCircuit/.test(mdEl.querySelector('.code-block code').textContent));
  check('公式已渲染', mdEl.querySelector('.katex') !== null);
  check('正文渲染出引用块', mdEl.querySelector('blockquote') !== null);
  check('思维链已保留', /Bell|纠缠/.test(asst.querySelector('.think-body').textContent));
  check('思维链标记为已完成', /已深度思考（用时/.test(asst.querySelector('.think-label').textContent));
  check('无错误框', !visible(asst.querySelector('.err-box')));
  check('操作栏已出现', visible(asst.querySelector('.msg-actions')));
  check('对话标题已自动生成', doc.getElementById('topbar-title').textContent.length > 0 &&
        doc.getElementById('topbar-title').textContent !== 'DeepSeek',
        doc.getElementById('topbar-title').textContent);
  check('对话已写入 localStorage', JSON.parse(window.localStorage.getItem('ds.convos.v1'))[0].messages.length === 2);
  check('对话列表出现新条目', doc.querySelectorAll('#conv-list .conv-item').length === 1);

  // 重新生成
  const regen = asst.querySelector('.act[data-act="regen"]');
  check('重新生成按钮存在', regen !== null);

  // 关键回归：Authorization 必须是 "Bearer <key>"。
  // 曾经前端传的是 "Bearer "（带尾空格），而 HTTP 头值首尾空白会被规范化裁掉，
  // 服务端拼出来成了 "Bearersk-xxx" —— 表现就是「Key 明明有效却一直提示未授权」。
  const auth = await (await fetch(BASE + '__lastauth')).json();
  check('OpenAI 鉴权头是 "Bearer <key>"',
        !!auth && auth.name === 'Authorization' && auth.value === 'Bearer sk-demo-key-for-preview',
        JSON.stringify(auth));
  check('Bearer 与 Key 之间恰好一个空格（没有粘连）',
        !!auth && /^Bearer \S+$/.test(auth.value), auth ? auth.value : '(null)');

  check('全过程无脚本错误', errors.length === 0, errors.join(' | '));
}

/* ================================================================= */
console.log('\n[6] 停止生成与错误处理');
/* ================================================================= */
{
  const { window, doc } = await boot('?demo=home&theme=light');
  const input = doc.getElementById('input');
  input.value = '测试停止';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  doc.getElementById('btn-send').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(120);

  // 再点一次发送键 = 停止
  doc.getElementById('btn-send').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(400);

  check('停止后解除忙碌', !doc.getElementById('composer').classList.contains('busy'));
  const asst = doc.querySelector('#messages .msg.assistant');
  check('停止后仍保留消息', asst !== null);
  const stopped = !visible(asst.querySelector('.err-box')) || /停止/.test(asst.querySelector('.err-text').textContent);
  check('停止后状态合理（保留部分内容或提示已停止）', stopped,
        asst.querySelector('.err-text').textContent);
}

/* ================================================================= */
console.log('\n[7] 配色主题（官方蓝 / 克劳德橙 / 像素粉）');
/* ================================================================= */
{
  const { window, doc, errors } = await boot('?demo=settings&scheme=claude&theme=light');
  check('启动无脚本错误', errors.length === 0, errors.join(' | '));
  check('data-scheme 为 claude', doc.documentElement.getAttribute('data-scheme') === 'claude');
  check('配色选择器高亮 claude', doc.querySelector('#seg-scheme button[data-v="claude"]').classList.contains('on'));
  check('配色说明已更新', /克劳德橙/.test(doc.getElementById('scheme-hint').textContent));
  check('系统栏颜色 meta 已更新', doc.querySelector('meta[name="theme-color"]').getAttribute('content') === '#FAF9F5');
  check('配色按钮全部就位', doc.querySelectorAll('#seg-scheme button').length === 7,
        String(doc.querySelectorAll('#seg-scheme button').length));
  check('每个配色都有色块', doc.querySelectorAll('#seg-scheme .swatch').length === 7,
        String(doc.querySelectorAll('#seg-scheme .swatch').length));

  // 切到女仆粉（二次元）
  doc.querySelector('#seg-scheme button[data-v="maid"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('切到 maid 生效', doc.documentElement.getAttribute('data-scheme') === 'maid');
  check('maid 已持久化', JSON.parse(window.localStorage.getItem('ds.settings.v1')).scheme === 'maid');
  check('maid 说明提到女仆', /女仆/.test(doc.getElementById('scheme-hint').textContent));
  check('maid 浅色系统栏颜色', doc.querySelector('meta[name="theme-color"]').getAttribute('content') === '#FFF7FA');

  // 切到像素粉
  doc.querySelector('#seg-scheme button[data-v="pink"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('切到 pink 生效', doc.documentElement.getAttribute('data-scheme') === 'pink');
  check('pink 已持久化', JSON.parse(window.localStorage.getItem('ds.settings.v1')).scheme === 'pink');
  check('pink 说明为像素风', /像素/.test(doc.getElementById('scheme-hint').textContent));
  check('pink 浅色系统栏颜色', doc.querySelector('meta[name="theme-color"]').getAttribute('content') === '#FFF5FA');

  // 配色与明暗正交
  doc.querySelector('#seg-theme button[data-v="dark"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('pink + dark 同时生效',
        doc.documentElement.getAttribute('data-scheme') === 'pink' &&
        doc.documentElement.getAttribute('data-theme') === 'dark');
  check('pink 深色系统栏颜色', doc.querySelector('meta[name="theme-color"]').getAttribute('content') === '#1A0A14');

  // 切回官方蓝
  doc.querySelector('#seg-scheme button[data-v="blue"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('切回 blue 生效', doc.documentElement.getAttribute('data-scheme') === 'blue');
  check('blue 深色系统栏颜色', doc.querySelector('meta[name="theme-color"]').getAttribute('content') === '#131417');
  check('deep think 开关仍可用', doc.getElementById('chip-think') !== null);
}

/* ================================================================= */
console.log('\n[8] 首次启动：未配置 API Key 的引导');
/* ================================================================= */
{
  // 不带 demo 参数 -> 没有任何种子数据，等同于全新安装
  const { window, doc, errors } = await boot('');
  check('全新安装启动无脚本错误', errors.length === 0, errors.join(' | '));
  check('默认配色为官方蓝', doc.documentElement.getAttribute('data-scheme') === 'blue');
  check('底部提示变为配置入口', /尚未配置 API Key/.test(doc.getElementById('composer-hint').textContent),
        doc.getElementById('composer-hint').textContent);

  const input = doc.getElementById('input');
  input.value = '你好';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  doc.getElementById('btn-send').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(150);

  check('未配置 Key 时不发起请求', doc.querySelectorAll('#messages .msg').length === 0);
  check('未配置 Key 时跳到设置页', visible(doc.getElementById('view-settings')));

  // 填上 Key 后提示恢复
  const key = doc.getElementById('set-key');
  key.value = 'sk-test-123';
  key.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('填入 Key 后提示恢复', /内容由 AI 生成/.test(doc.getElementById('composer-hint').textContent));
}

/* ================================================================= */
console.log('\n[9] 动态生成的图标必须是合法的 HTML（内联 mask 样式不能被引号截断）');
/* ================================================================= */
{
  const { window, doc } = await boot('?demo=home&theme=light');
  const host = doc.createElement('div');
  doc.body.appendChild(host);

  for (const name of ['more', 'copy', 'refresh', 'globe', 'alert', 'think', 'send', 'stop']) {
    host.innerHTML = window.DS.iconHtml(name);
    const el = host.firstElementChild;
    const styleAttr = el.getAttribute('style') || '';
    check('图标 ' + name + ' 的 style 属性完整', styleAttr.indexOf('mask-image') > -1 &&
          styleAttr.split('mask-image').length >= 3, styleAttr.slice(0, 90));
    check('图标 ' + name + ' 的 style 里没有裸双引号', styleAttr.indexOf('"') < 0,
          styleAttr.slice(0, 90));
    check('图标 ' + name + ' 没有被解析出多余属性', el.attributes.length <= 2,
          Array.prototype.map.call(el.attributes, function (a) { return a.name; }).join(' | '));
  }
}

/* ================================================================= */
console.log('\n[10] 手势：滑动列表不应误触发操作面板');
/* ================================================================= */
{
  const { window, doc } = await boot('?demo=chat&theme=light');
  const sheet = doc.getElementById('sheet-wrap');
  const umore = doc.querySelector('#messages .msg.user .act[data-act="more"]');
  const userMsg = doc.querySelector('#messages .msg.user');

  function touch(target, type, x, y) {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    ev.touches = [{ clientX: x, clientY: y }];
    ev.changedTouches = ev.touches;
    target.dispatchEvent(ev);
  }
  const isOpen = () => !sheet.classList.contains('hidden');
  const closeSheet = () => {
    const bg = sheet.querySelector('.sheet-bg');
    if (bg) bg.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  };

  check('初始没有面板', !isOpen());

  // 1) 滑完列表手指正好落在「⋯」上 —— 不应弹面板
  touch(doc.body, 'touchstart', 100, 500);
  touch(doc.body, 'touchmove', 100, 560);
  touch(doc.body, 'touchend', 100, 560);
  umore.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('滑动之后的误触被忽略', !isOpen());

  // 2) 正常点按仍然有效
  touch(doc.body, 'touchstart', 100, 500);
  umore.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('正常点按仍能弹出面板', isOpen());
  closeSheet();

  // 3) 按住不动但期间列表滚动了 —— 不应触发长按。
  //    滚动容器是消息列表的父级，取消逻辑必须挂在 document 捕获阶段才收得到。
  touch(userMsg, 'touchstart', 100, 500);
  doc.dispatchEvent(new window.Event('scroll'));
  await sleep(640);
  check('滚动会取消待触发的长按', !isOpen());

  // 4) 真正按住不动 —— 应当触发长按
  touch(userMsg, 'touchstart', 100, 500);
  await sleep(640);
  check('按住不动仍能弹出面板', isOpen());
  closeSheet();

  // 5) 手指小幅抖动（10px 以内）不该取消长按
  touch(userMsg, 'touchstart', 100, 500);
  touch(userMsg, 'touchmove', 103, 502);
  await sleep(640);
  check('轻微抖动不影响长按', isOpen());
  closeSheet();
}

/* ================================================================= */
console.log('\n[11] 多服务商：预设、切换、写回');
/* ================================================================= */
{
  const { window, doc } = await boot('?demo=settings&theme=light');
  const list = doc.getElementById('provider-list');
  check('服务商列表容器存在', list !== null);
  const initialCount = doc.querySelectorAll('#provider-list .provider-item').length;
  check('服务商列表已渲染出条目', initialCount === 3, String(initialCount));
  check('当前服务商高亮', doc.querySelectorAll('#provider-list .provider-item.active').length === 1);
  check('服务商条目有可点区域', doc.querySelector('#provider-list .provider-edit') !== null);

  // 打开添加面板
  doc.getElementById('btn-add-provider').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const wrap = doc.getElementById('sheet-wrap');
  check('添加面板已弹出', !wrap.classList.contains('hidden'));
  const sheetText = wrap.textContent || '';
  check('预设含 Anthropic', sheetText.indexOf('Anthropic') > -1);
  check('预设含 OpenRouter', sheetText.indexOf('OpenRouter') > -1);
  check('预设含硅基流动', sheetText.indexOf('硅基流动') > -1);
  check('预设含自定义', sheetText.indexOf('自定义') > -1);

  const btns = Array.from(wrap.querySelectorAll('.sheet-item'));
  const anth = btns.filter((b) => b.textContent.indexOf('Anthropic') > -1)[0];
  check('找到 Anthropic 预设', !!anth);
  if (anth) anth.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(150);

  check('新增后多了一个服务商',
        doc.querySelectorAll('#provider-list .provider-item').length === initialCount + 1,
        String(doc.querySelectorAll('#provider-list .provider-item').length));
  check('地址已切到 Anthropic', doc.getElementById('set-base').value.indexOf('anthropic.com') > -1,
        doc.getElementById('set-base').value);
  check('接口格式已切到 anthropic', doc.getElementById('set-format').value === 'anthropic');
  check('格式已持久化', JSON.parse(window.localStorage.getItem('ds.settings.v1')).apiFormat === 'anthropic');

  // 改 Key 应写回当前服务商条目
  const keyEl = doc.getElementById('set-key');
  keyEl.value = 'sk-ant-test-key';
  keyEl.dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(760);
  const saved = JSON.parse(window.localStorage.getItem('ds.settings.v1'));
  const active = (saved.providers || []).filter((p) => p.id === saved.activeProviderId)[0];
  check('Key 已写回当前服务商', !!active && active.apiKey === 'sk-ant-test-key',
        active ? active.apiKey : '(没有 active 服务商)');
  check('服务商条目记录了格式', !!active && active.format === 'anthropic');

  // 切回第一个服务商
  const first = doc.querySelectorAll('#provider-list .provider-item')[0];
  first.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(120);
  check('切换后格式回到 openai', doc.getElementById('set-format').value === 'openai');
  check('切换后地址回到 DeepSeek', doc.getElementById('set-base').value.indexOf('deepseek') > -1,
        doc.getElementById('set-base').value);
  check('切换后仍只有一个 active', doc.querySelectorAll('#provider-list .provider-item.active').length === 1);
}

/* ================================================================= */
console.log('\n[12] Anthropic 协议：/messages + thinking_delta + text_delta');
/* ================================================================= */
{
  const { window, doc } = await boot('?demo=home&theme=light');
  window.DS.settings.apiFormat = 'anthropic';
  window.DS.settings.apiKey = 'sk-ant-test';
  window.DS.settings.baseUrl = 'https://api.anthropic.com/v1';
  window.DS.settings.model = 'claude-sonnet-4-5';

  const input = doc.getElementById('input');
  input.value = '你好';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  doc.getElementById('btn-send').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  await sleep(220);
  check('anthropic：请求已发出并进入生成态',
        doc.getElementById('composer').classList.contains('busy'));

  for (let i = 0; i < 60; i++) {
    await sleep(200);
    if (!doc.getElementById('composer').classList.contains('busy')) break;
  }

  const asst = doc.querySelector('#messages .msg.assistant');
  const md = asst.querySelector('.md');
  check('anthropic：正文已流式输出', /DeepSleep/.test(md.textContent), md.textContent.slice(0, 60));
  check('anthropic：加粗已渲染', md.querySelector('strong') !== null);
  check('anthropic：思维链已解析',
        /用户打招呼/.test(asst.querySelector('.think-body').textContent),
        asst.querySelector('.think-body').textContent.slice(0, 40));
  check('anthropic：思维链标记完成', /已深度思考/.test(asst.querySelector('.think-label').textContent));
  check('anthropic：无错误框', !visible(asst.querySelector('.err-box')),
        asst.querySelector('.err-text').textContent);

  // Anthropic 走 x-api-key，且不该带方案名前缀
  const auth2 = await (await fetch(BASE + '__lastauth')).json();
  check('Anthropic 用 x-api-key 且无方案前缀',
        !!auth2 && auth2.name === 'x-api-key' && auth2.value === 'sk-ant-test',
        JSON.stringify(auth2));
}

/* ================================================================= */
console.log('\n[13] 主题系统扩展：更多配色 / 强调色 / 纯黑 / 字体 / 密度');
/* ================================================================= */
{
  const { window, doc } = await boot('?demo=settings&theme=dark');
  check('配色按钮有 7 个', doc.querySelectorAll('#seg-scheme button').length === 7,
        String(doc.querySelectorAll('#seg-scheme button').length));
  check('强调色色板已渲染', doc.querySelectorAll('#accent-row .accent-dot').length === 11,
        String(doc.querySelectorAll('#accent-row .accent-dot').length));
  check('默认强调色为「跟随主题」', doc.getElementById('accent-val').textContent === '跟随主题');

  doc.querySelector('#seg-scheme button[data-v="cyber"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('切换到 cyber 生效', doc.documentElement.getAttribute('data-scheme') === 'cyber');
  check('cyber 的深色背景色正确',
        doc.querySelector('meta[name="theme-color"]').getAttribute('content') === '#08050F',
        doc.querySelector('meta[name="theme-color"]').getAttribute('content'));

  doc.querySelector('#seg-scheme button[data-v="forest"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('切换到 forest 生效', doc.documentElement.getAttribute('data-scheme') === 'forest');
  doc.querySelector('#seg-scheme button[data-v="violet"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('切换到 violet 生效', doc.documentElement.getAttribute('data-scheme') === 'violet');

  // 强调色覆盖
  const amber = doc.querySelector('#accent-row .accent-dot[data-v="#FFB020"]');
  check('存在琥珀色色块', !!amber);
  if (amber) amber.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('强调色写进了行内样式',
        doc.documentElement.style.getPropertyValue('--brand') === '#FFB020',
        doc.documentElement.style.getPropertyValue('--brand'));
  check('同时生成了按下态颜色',
        doc.documentElement.style.getPropertyValue('--brand-press') !== '');
  check('强调色标签已更新', doc.getElementById('accent-val').textContent === '#FFB020');
  check('强调色已持久化',
        JSON.parse(window.localStorage.getItem('ds.settings.v1')).accentColor === '#FFB020');

  doc.querySelector('#accent-row .accent-dot[data-v=""]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('选「自动」会清掉强调色覆盖',
        doc.documentElement.style.getPropertyValue('--brand') === '');

  // 纯黑
  // 纯黑：浅色下开启必须顺手切深色，否则「点了没反应」
  const oled = doc.getElementById('set-oled');
  doc.getElementById('seg-theme').querySelector('[data-v="light"]')
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('先切到浅色', doc.documentElement.getAttribute('data-theme') === 'light');
  oled.checked = true;
  oled.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('浅色下开纯黑会切到深色',
        doc.documentElement.getAttribute('data-theme') === 'dark',
        doc.documentElement.getAttribute('data-theme'));
  check('并且真的开了纯黑', doc.documentElement.getAttribute('data-oled') === '1');
  check('明暗选择器同步成了深色',
        doc.querySelector('#seg-theme button[data-v="dark"]').classList.contains('on'));
  check('纯黑模式已持久化',
        JSON.parse(window.localStorage.getItem('ds.settings.v1')).oledBlack === true);

  // 字体
  doc.querySelector('#seg-typeface button[data-v="serif"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('字体切到衬线', doc.documentElement.getAttribute('data-font') === 'serif');

  // 密度
  doc.querySelector('#seg-density button[data-v="compact"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('消息密度切到紧凑', doc.documentElement.getAttribute('data-density') === 'compact');
  check('密度已持久化',
        JSON.parse(window.localStorage.getItem('ds.settings.v1')).density === 'compact');
}

/* ================================================================= */
console.log('\n[14] 朗读（假原生桥驱动）+ 思考框折叠');
/* ================================================================= */
{
  const calls = { spoken: [], stopped: 0, rate: null };
  const fakeBridge = {
    kvGet: () => null,
    kvSet: () => {},
    kvRemove: () => {},
    ttsAvailable: () => true,
    ttsInit: () => {},
    ttsVoices: () => JSON.stringify([
      { name: 'zh-cn-1', locale: 'zh-CN', label: '中文（中国）· 音色 1（标准）' }
    ]),
    ttsSpeak: (t) => { calls.spoken.push(t); },
    ttsStop: () => { calls.stopped++; },
    ttsSetVoice: () => {},
    ttsSetRate: (r) => { calls.rate = r; },
    ttsSetPitch: () => {}
  };

  const { window, doc } = await boot('?demo=chat&theme=light', { bridge: fakeBridge });

  // --- 语音输入应当已被整体移除 ---
  check('麦克风按钮已移除', doc.getElementById('btn-mic') === null);
  check('设置里没有语音输入状态项', doc.getElementById('voice-state') === null);
  check('设置里没有语音「试一下」按钮', doc.getElementById('btn-voice-test') === null);
  check('DS.voice 模块已不存在', typeof window.DS.voice === 'undefined');

  // --- 朗读 ---
  check('有 TTS 时朗读按钮可见',
        doc.querySelector('#messages .act[data-act="speak"]') !== null);

  const asst = doc.querySelector('#messages .msg.assistant');
  const speakBtn = asst.querySelector('.act[data-act="speak"]');
  speakBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('点朗读把内容交给原生引擎', calls.spoken.length === 1,
        String(calls.spoken.length));
  check('朗读内容是纯文本（去掉了 Markdown）',
        calls.spoken[0].indexOf('**') < 0 && calls.spoken[0].indexOf('```') < 0,
        (calls.spoken[0] || '').slice(0, 50));
  check('正在朗读的按钮被高亮', speakBtn.classList.contains('on'));

  // 关键回归：再点一次必须「停止」，不能变成重新念一遍。
  // 之前依赖 speakingId 精确匹配，原生迟到的 idle 事件会把状态冲掉，
  // 于是 toggle 永远走不到 stop 分支。
  speakBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('再点一次调用的是 stop，而不是重新 speak',
        calls.stopped === 1 && calls.spoken.length === 1,
        'stopped=' + calls.stopped + ' spoken=' + calls.spoken.length);
  check('停止后高亮消失', !speakBtn.classList.contains('on'));

  // 换一条消息 = 先停掉当前，再念新的
  const second = doc.querySelectorAll('#messages .msg.assistant')[1];
  if (second) {
    const btn2 = second.querySelector('.act[data-act="speak"]');
    const s0 = calls.stopped, p0 = calls.spoken.length;
    speakBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));  // A 开始念
    btn2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));      // 切到 B
    check('念另一条会先停掉当前的，再念新的',
          calls.stopped === s0 + 1 && calls.spoken.length === p0 + 2,
          'stopped ' + s0 + '->' + calls.stopped + ', spoken ' + p0 + '->' + calls.spoken.length);
  }

  // 音色与语速
  window.__onTtsReady(JSON.stringify([{ name: 'zh-cn-9', locale: 'zh-CN', label: '测试音色' }]));
  check('音色列表已填入下拉框',
        doc.querySelectorAll('#set-voice option').length === 2,
        String(doc.querySelectorAll('#set-voice option').length));
  const rate = doc.getElementById('set-rate');
  rate.value = '1.5';
  rate.dispatchEvent(new window.Event('change', { bubbles: true }));
  check('语速改动会通知原生', calls.rate === 1.5, String(calls.rate));

  // --- 思考框折叠 ---
  // 只断言「点击确实切换了状态」，不断言切换后的具体值 ——
  // 思考完的框默认收起、思考中的默认展开，起始状态不固定。
  const think = doc.querySelector('#messages .think:not(.hidden)');
  check('会话里存在思考框', think !== null);
  if (think) {
    const head = think.querySelector('.think-head');
    const wasOpen = think.classList.contains('open');
    head.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check('点标题切换了折叠状态', think.classList.contains('open') !== wasOpen,
          'wasOpen=' + wasOpen + ' now=' + think.classList.contains('open'));
    check('点击后打上用户标记（流式重绘不再抢控制权）',
          think.getAttribute('data-user-toggled') === '1');
    head.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    check('再点一次恢复原状态', think.classList.contains('open') === wasOpen);
  }

  // --- Markdown → 朗读文本 ---
  const speech = window.DS.md.speechText(
    '## 标题\n\n这是**重点**和 `代码`。\n\n```js\nvar a = 1;\n```\n\n[链接](https://x.com)');
  check('朗读文本去掉了标题符号', speech.indexOf('#') < 0);
  check('朗读文本去掉了加粗星号', speech.indexOf('**') < 0);
  check('朗读文本保留了正文', speech.indexOf('重点') > -1);
  check('代码块被替换成提示语', speech.indexOf('代码块') > -1);
  check('链接只保留文字', speech.indexOf('https') < 0 && speech.indexOf('链接') > -1);
}

/* ================================================================= */
console.log('\n[15] 对话转生');
/* ================================================================= */
{
  const { window, doc } = await boot('?demo=chat&theme=light');
  const DS = window.DS;

  // 按钮与遮罩都在
  check('顶部有转生按钮', doc.getElementById('btn-reincarnate') !== null);
  check('转生按钮在「新对话」左边',
        doc.getElementById('btn-reincarnate').nextElementSibling.id === 'btn-new-chat-2');
  check('压缩遮罩默认隐藏', doc.getElementById('rein-wrap').classList.contains('hidden'));
  check('遮罩里有像素鲸鱼', doc.querySelector('#rein-wrap .pixel-whale') !== null);
  check('遮罩里有泡泡（5 个）',
        doc.querySelectorAll('#rein-wrap .bub rect').length === 5,
        String(doc.querySelectorAll('#rein-wrap .bub rect').length));

  // 转生按钮在空对话上应该给出提示而不是崩
  DS.setActive(null);
  DS.ui.showConvo(null);
  doc.getElementById('btn-reincarnate').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('空对话点转生不会抛异常', true);
  check('空对话不会打开确认弹窗',
        doc.getElementById('dialog-wrap').classList.contains('hidden'));

  // 有内容的对话：点按钮应弹出确认框
  const convo = DS.convos[0];
  DS.setActive(convo.id);
  DS.ui.showConvo(convo.id);
  doc.getElementById('btn-reincarnate').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  const dlg = doc.getElementById('dialog-wrap');
  check('弹出确认弹窗', !dlg.classList.contains('hidden'));
  check('弹窗文案是「要带着记忆进入下一个对话吗？」',
        dlg.querySelector('h3') && dlg.querySelector('h3').textContent === '要带着记忆进入下一个对话吗？',
        dlg.querySelector('h3') ? dlg.querySelector('h3').textContent : '(无)');
  check('确认按钮写着「带着记忆转生」',
        dlg.querySelector('.ok') && dlg.querySelector('.ok').textContent === '带着记忆转生',
        dlg.querySelector('.ok') ? dlg.querySelector('.ok').textContent : '(无)');
  check('弹窗说明了会压缩多少条消息',
        /' + convo.messages.length + '/.test(dlg.querySelector('p').textContent) ||
        dlg.querySelector('p').textContent.indexOf(String(convo.messages.length)) > -1,
        dlg.querySelector('p').textContent.slice(0, 40));

  // 取消不应产生新对话
  const before = DS.convos.length;
  dlg.querySelector('.cancel').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('取消不会新建对话', DS.convos.length === before, String(DS.convos.length));

  // --- 对话摊平 ---
  const text = DS.reincarnate._transcript(convo);
  check('摊平文本带说话人前缀', /用户：/.test(text) && /助手：/.test(text), text.slice(0, 40));
  check('摊平文本包含正文', text.indexOf('快速排序') > -1);

  // --- 记忆注入 ---
  const fresh = DS.newConvo({ title: '转生测试', memory: '用户在做 Android 客户端，偏好简洁回答。' });
  check('newConvo 接受 memory', fresh.memory === '用户在做 Android 客户端，偏好简洁回答。');
  check('newConvo 接受 title', fresh.title === '转生测试');

  const apiMsgs = DS.buildApiMessages(fresh);
  check('记忆被注入成 system 消息',
        apiMsgs.length === 1 && apiMsgs[0].role === 'system' &&
        apiMsgs[0].content.indexOf('Android 客户端') > -1,
        JSON.stringify(apiMsgs).slice(0, 80));

  // 无记忆的对话不应多出 system 消息
  const plain = DS.newConvo({ title: '普通' });
  check('没有记忆时不注入 system 消息', DS.buildApiMessages(plain).length === 0);

  // --- 记忆提示条 ---
  DS.ui.showConvo(fresh.id);
  const note = doc.querySelector('#messages .memory-note');
  check('新对话顶部显示记忆提示条', note !== null);
  check('提示条默认收起', !note.classList.contains('open'));
  check('提示条里能看到摘要内容',
        note.querySelector('.memory-body').textContent.indexOf('Android 客户端') > -1);
  note.querySelector('.memory-head').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('点一下可以展开记忆', note.classList.contains('open'));

  DS.ui.showConvo(plain.id);
  check('没有记忆的对话不显示提示条',
        doc.querySelector('#messages .memory-note') === null);

  // --- 端到端：真的点一次「带着记忆转生」 ---
  const target = DS.convos.find((c) => c.messages.length > 2) || convo;
  DS.setActive(target.id);
  DS.ui.showConvo(target.id);
  const convoCountBefore = DS.convos.length;

  doc.getElementById('btn-reincarnate').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  dlg.querySelector('.ok').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  // openDialog 是用 Promise 决议的，.then 属于微任务，
  // 点完的同一 tick 里遮罩还没显示，这里让出一拍再看
  await sleep(30);
  check('确认后立刻显示压缩遮罩',
        !doc.getElementById('rein-wrap').classList.contains('hidden'));
  check('遮罩里显示了进度文案',
        /正在/.test(doc.getElementById('rein-status').textContent),
        doc.getElementById('rein-status').textContent);

  // 等摘要流式写完
  let born = null;
  for (let i = 0; i < 60; i++) {
    await sleep(60);
    if (!doc.getElementById('rein-wrap').classList.contains('hidden')) continue;
    if (DS.convos.length > convoCountBefore) { born = DS.convos[0]; break; }
  }

  check('转生后新增了一个对话', DS.convos.length === convoCountBefore + 1,
        convoCountBefore + ' -> ' + DS.convos.length);
  check('新对话带着 memory', !!(born && born.memory), born ? String(!!born.memory) : 'null');
  check('memory 是模型返回的摘要',
        !!(born && born.memory && born.memory.indexOf('Android 客户端') > -1),
        born && born.memory ? born.memory.slice(0, 40) : '(空)');
  check('新对话标题带「转生」', !!(born && /转生/.test(born.title)), born ? born.title : '(无)');
  check('新对话是空的（记忆不占可见消息）', !!(born && born.messages.length === 0),
        born ? String(born.messages.length) : 'null');
  check('遮罩已关闭', doc.getElementById('rein-wrap').classList.contains('hidden'));
  check('已经切到新对话', DS.activeId === (born && born.id));
  check('新对话里能看到记忆提示条',
        doc.querySelector('#messages .memory-note') !== null);

  const injected = DS.buildApiMessages(born);
  check('再次发消息时记忆会被注入',
        injected.length === 1 && injected[0].role === 'system' &&
        injected[0].content.indexOf('上下文压缩器') < 0,
        JSON.stringify(injected).slice(0, 60));
}

/* ================================================================= */
console.log('\n[16] 长期记忆：开关与上下文预算');
/* ================================================================= */
{
  const { window, doc } = await boot('?demo=chat&theme=light');
  const DS = window.DS;
  const M = DS.memory;

  M.clear();
  DS.settings.memoryEnabled = true;
  DS.settings.memoryBudget = 900;
  DS.settings.memoryLimit = 8;

  const convo = DS.convos[0];
  convo.memoryOff = false;

  // --- 写入与去重 ---
  M.add('用户在做 Android 客户端 DeepSleep', 'project');
  M.add('用户偏好简洁回答，不要客套话', 'preference');
  M.add('用户在做 Android 客户端 DeepSleep 的开发', 'project');   // 应当合并
  check('高度相似的记忆会合并而不是新增', M.count() === 2, String(M.count()));
  check('偏好类被识别', M.all().some((x) => x.kind === 'preference'));

  // --- 不相关的不该被注入 ---
  const unrelated = M.promptBlock('今天晚饭吃什么比较好呢', { maxItems: 8, maxChars: 900 });
  check('不相关的追问不会把项目记忆塞进去',
        unrelated.indexOf('DeepSleep') < 0,
        unrelated.slice(0, 60));
  check('但偏好类永远带上', unrelated.indexOf('客套话') > -1);

  // --- 总开关 ---
  const hasMem = (c) => DS.buildApiMessages(c).some(
    (m) => m.role === 'system' && String(m.content).indexOf('长期记忆') > -1);
  DS.settings.memoryEnabled = false;
  check('总开关关闭时不注入', !hasMem(convo));
  check('总开关关闭时 enabledFor 为假', M.enabledFor(convo) === false);
  DS.settings.memoryEnabled = true;

  // --- 单对话开关 ---
  convo.memoryOff = true;
  check('单对话关闭记忆时不注入', !hasMem(convo));
  check('单对话关闭时 enabledFor 为假', M.enabledFor(convo) === false);
  let skipReason = null;
  await M.extract(convo).then((r) => { skipReason = r.reason; });
  check('单对话关闭记忆时不提取', skipReason === 'memory off', String(skipReason));
  convo.memoryOff = false;

  // --- 字符预算是硬闸 ---
  // 注意：条目之间必须真正不同 —— 共享长后缀会被相似度去重合并掉（这是设计如此）
  const notes = [
    '量子比特退相干时间是微秒量级', '面包发酵温度控制在二十六度', '马拉松配速保持在五分半',
    '水族箱硝化系统需要四到六周', '逆光拍摄要给人脸补光', '手冲咖啡水温九十二度',
    '雪山攀登窗口期通常在凌晨', '榫卯结构不用一颗钉子', '陶艺拉坯要控制泥料含水率',
    '帆船逆风航行走之字形', '围棋布局讲究金角银边', '深空摄影需要导星和叠加',
    '多肉植物夏季要断水', '篆刻冲刀和切刀效果不同', '皮划艇翻艇后要做翻滚',
    '滑翔伞地面斗伞练的是手感', '化石修复用气动笔最稳妥', '香料要先干焙再研磨',
    '植物染用明矾做媒染剂', '机械表擒纵机构决定走时精度'
  ];
  notes.forEach((t) => M.add(t, 'fact'));
  check('大量记忆已写入', M.count() > 12, String(M.count()));

  const wide = M.promptBlock('量子 摄影 马拉松 咖啡 帆船 围棋', { maxItems: 15, maxChars: 2000 });
  check('放开上限时也不会超过字符预算', wide.length <= 2000, String(wide.length));

  const tight = M.promptBlock('量子 摄影 马拉松 咖啡 帆船 围棋', { maxItems: 15, maxChars: 300 });
  check('收紧预算时严格截断', tight.length <= 300, String(tight.length));
  check('收紧预算时仍然给出了内容', tight.length > 40, String(tight.length));

  const lb = M.lastBlockSize();
  check('记录了上次注入的规模', lb.count > 0 && lb.chars > 0,
        JSON.stringify(lb));

  // 单条再长也会被截
  M.clear();
  M.add('很长的记忆'.repeat(80), 'fact');
  const one = M.promptBlock('很长的记忆', { maxItems: 8, maxChars: 900 });
  const longest = one.split('\n').slice(1).reduce((a, b) => Math.max(a, b.length), 0);
  check('单条记忆会被截断到 120 字左右', longest <= 128, String(longest));

  // --- 设置界面 ---
  DS.ui.reloadSettingsUI ? DS.ui.reloadSettingsUI() : null;
  check('设置里有总开关', doc.getElementById('set-mem-on') !== null);
  check('设置里有预算三档', doc.querySelectorAll('#seg-membudget button').length === 3);
  check('总开关反映当前状态', doc.getElementById('set-mem-on').checked === true);
  check('显示单次注入上限', /条 \/ \d+ 字/.test(doc.getElementById('mem-budget-val').textContent),
        doc.getElementById('mem-budget-val').textContent);
}

/* ================================================================= */
console.log('\n[17] 设置页两级导航');
/* ================================================================= */
{
  const { window, doc } = await boot('?demo=chat&theme=light');
  const DS = window.DS;
  // 自己点进设置，不依赖预览驱动的自动点击（jsdom 里那条定时器不一定跑）
  doc.getElementById('btn-settings').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(60);

  check('一级页有高级设置入口', doc.getElementById('btn-advanced') !== null);
  check('存在高级设置视图', doc.getElementById('view-advanced') !== null);
  check('初始停在设置页',
        !doc.getElementById('view-settings').classList.contains('hidden') &&
        doc.getElementById('view-advanced').classList.contains('hidden'),
        'settings.hidden=' + doc.getElementById('view-settings').classList.contains('hidden') +
        ' advanced.hidden=' + doc.getElementById('view-advanced').classList.contains('hidden') +
        ' chat.hidden=' + doc.getElementById('view-chat').classList.contains('hidden'));

  // 高级项确实被搬到了二级页
  const adv = doc.getElementById('view-advanced');
  for (const id of ['set-sysprompt', 'set-temp', 'set-maxtok', 'set-effort', 'set-think', 'set-format']) {
    check('高级项 ' + id + ' 在二级页里', adv.querySelector('#' + id) !== null);
  }
  // 一级页不该再出现这些
  const main = doc.getElementById('view-settings');
  check('一级页不再有系统提示词', main.querySelector('#set-sysprompt') === null);
  check('一级页不再有温度', main.querySelector('#set-temp') === null);
  // 常用项要留在一级
  for (const id of ['set-key', 'set-base', 'set-model', 'provider-list', 'icon-picker']) {
    check('常用项 ' + id + ' 留在一级页', main.querySelector('#' + id) !== null);
  }

  // 进入
  doc.getElementById('btn-advanced').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('点击后切到高级设置',
        !doc.getElementById('view-advanced').classList.contains('hidden') &&
        doc.getElementById('view-settings').classList.contains('hidden'));
  check('顶栏标题变成「高级设置」',
        doc.getElementById('topbar-title').textContent === '高级设置',
        doc.getElementById('topbar-title').textContent);
  check('设置类页面隐藏了菜单与新建按钮',
        doc.getElementById('btn-menu').classList.contains('hidden') &&
        doc.getElementById('btn-new-chat-2').classList.contains('hidden'));

  // 接口格式：手工改下拉必须写回 settings（以前漏了这一条）
  const fmt = doc.getElementById('set-format');
  fmt.value = 'anthropic';
  fmt.dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(30);
  check('手工改接口格式会写回 settings',
        DS.settings.apiFormat === 'anthropic', DS.settings.apiFormat);
  check('并且落到当前服务商上（provider 上的字段叫 format）',
        DS.getProvider(DS.settings.activeProviderId).format === 'anthropic',
        DS.getProvider(DS.settings.activeProviderId).format);
  fmt.value = 'openai';
  fmt.dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(30);
  check('切回 OpenAI 也生效', DS.settings.apiFormat === 'openai', DS.settings.apiFormat);

  // 返回：应该回设置页，而不是聊天页
  doc.getElementById('btn-back').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('返回回到设置页而不是聊天页',
        !doc.getElementById('view-settings').classList.contains('hidden') &&
        doc.getElementById('view-chat').classList.contains('hidden'));
  check('顶栏标题变回「设置」',
        doc.getElementById('topbar-title').textContent === '设置',
        doc.getElementById('topbar-title').textContent);

  // 再返回才回聊天
  doc.getElementById('btn-back').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('再返回一次回到聊天',
        !doc.getElementById('view-chat').classList.contains('hidden') &&
        doc.getElementById('view-settings').classList.contains('hidden'));
}

/* ================================================================= */
console.log('\n[18] 开屏形象：内置 / 本地图片 / 跟随主题');
/* ================================================================= */
{
  const { window, doc } = await boot('?demo=chat&theme=light');
  const DS = window.DS;
  doc.getElementById('btn-settings').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(60);

  const picker = doc.getElementById('icon-picker');
  check('选择器已渲染', picker !== null);
  check('内置 2 张 + 本地图片共 3 格',
        picker.querySelectorAll('.icon-opt').length === 3,
        String(picker.querySelectorAll('.icon-opt').length));
  check('只有像素鲸鱼与鲸娘女仆两张',
        picker.querySelector('[data-v="pixel"]') !== null &&
        picker.querySelector('[data-v="maid"]') !== null &&
        picker.querySelector('[data-v="pink"]') === null &&
        picker.querySelector('[data-v="orca"]') === null);
  check('不再有「跟随主题」这一格', picker.querySelector('[data-v="__theme"]') === null);
  check('有「本地图片」这一格', picker.querySelector('[data-v="__add"]') !== null);
  check('默认选中像素鲸鱼',
        picker.querySelector('[data-v="pixel"]').closest('.icon-opt').classList.contains('on'));

  // --- 选另一张内置形象 ---
  DS.settings.customIcons = [];
  DS.settings.customLogo = '';
  picker.querySelector('[data-v="maid"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('选鲸娘女仆后写入 splashArt', DS.settings.splashArt === 'maid', DS.settings.splashArt);
  check('选内置形象后清掉自定义', DS.settings.customLogo === '');
  check('选中的那格被高亮',
        picker.querySelector('[data-v="maid"]').closest('.icon-opt').classList.contains('on'));
  check('首页 logo 换成了鲸娘女仆',
        doc.querySelector('.hero-logo').getAttribute('src').indexOf('splash-char') > -1,
        doc.querySelector('.hero-logo').getAttribute('src'));

  // --- 自定义图片：注入两条（不真的解码图片，jsdom 没有 canvas）---
  DS.settings.customIcons = [
    { id: 'c1', name: '我的图', data: 'data:image/png;base64,iVBORw0KGgo=' },
    { id: 'c2', name: '第二张', data: 'data:image/png;base64,iVBORw0KGgo=' }
  ];
  DS.settings.customLogo = '';
  DS.settings.splashArt = '';
  DS.ui.refreshMemory ? null : null;
  // 重新渲染选择器
  doc.getElementById('btn-settings').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  DS.ui.showConvo && null;
  // 直接触发一次设置界面同步
  window.DS.ui.openDialog && null;
  // 用切走再切回的方式让 renderIconPicker 跑一遍
  doc.getElementById('btn-back').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(30);
  doc.getElementById('btn-settings').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(60);

  const p2 = doc.getElementById('icon-picker');
  check('自定义图片出现在选择器里',
        p2.querySelector('[data-v="custom:c1"]') !== null &&
        p2.querySelector('[data-v="custom:c2"]') !== null,
        String(p2.querySelectorAll('.icon-opt').length));
  check('每条自定义都带删除角标',
        p2.querySelectorAll('.icon-del').length === 2,
        String(p2.querySelectorAll('.icon-del').length));

  // --- 选中自定义 ---
  p2.querySelector('[data-v="custom:c2"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  check('选中自定义写入 customLogo', DS.settings.customLogo === 'c2', DS.settings.customLogo);
  check('选中自定义时清掉 splashArt', DS.settings.splashArt === '');
  check('首页 logo 用上了自定义图片',
        doc.querySelector('.hero-logo').getAttribute('src').indexOf('base64') > -1);

  // --- 删除 ---
  const del = doc.getElementById('icon-picker').querySelector('[data-del="c1"]');
  check('删除角标可点', del !== null);
  del.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(40);
  const dlg2 = doc.getElementById('dialog-wrap');
  check('删除前会确认', !dlg2.classList.contains('hidden'));
  dlg2.querySelector('.ok').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(40);
  check('确认后删掉了那一条',
        DS.settings.customIcons.length === 1 && DS.settings.customIcons[0].id === 'c2',
        JSON.stringify(DS.settings.customIcons.map((x) => x.id)));
  check('删除后选择器里也没有了',
        doc.getElementById('icon-picker').querySelector('[data-v="custom:c1"]') === null);

  // 删掉正在使用的那张，应该回落到跟随主题
  const del2 = doc.getElementById('icon-picker').querySelector('[data-del="c2"]');
  del2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(40);
  doc.getElementById('dialog-wrap').querySelector('.ok').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await sleep(40);
  check('删掉正在用的那张会清空选择',
        DS.settings.customLogo === '' && DS.settings.customIcons.length === 0,
        'customLogo=' + DS.settings.customLogo);

  // --- 回落到默认的像素鲸鱼 ---
  check('首页 logo 回落到像素鲸鱼',
        doc.querySelector('.hero-logo').getAttribute('src').indexOf('icon-pixel') > -1,
        doc.querySelector('.hero-logo').getAttribute('src'));
  check('像素鲸鱼那格重新高亮',
        doc.getElementById('icon-picker').querySelector('[data-v="pixel"]')
          .closest('.icon-opt').classList.contains('on'));
}

/* ================================================================= */
console.log('\n[19] 联网搜索：检索规划与多轮上限');
/* ================================================================= */
{
  const { window } = await boot('?demo=chat&theme=light');
  const parse = window.DS.search._parsePlan;

  const a = parse('{"need":true,"queries":["量子计算 最新","量子比特 退相干"]}', '随便什么问题');
  check('老 JSON 格式仍能解析', a.need === true && a.queries.length === 2, JSON.stringify(a));
  check('检索词原样保留', a.queries[0] === '量子计算 最新', a.queries[0]);

  const b = parse('```json\n{"need":false,"queries":[]}\n```', '帮我润色这封邮件');
  check('带代码围栏的 JSON 也能解析', b.need === false && b.queries.length === 0, JSON.stringify(b));

  const c = parse('前面废话 {"need":true,"queries":["关键词"]} 后面废话', 'q');
  check('夹在废话里的 JSON 也能抠出来', c.need === true && c.queries[0] === '关键词', JSON.stringify(c));

  const d = parse('{"need":true,"queries":["关键词甲","关键词乙","关键词丙","关键词丁","关键词戊"]}', 'q');
  check('检索词最多留 3 条', d.queries.length === 3, String(d.queries.length));

  const f = parse('{"need":true,"queries":[]}', 'q');
  check('need 为真但没给词，按不搜处理', f.need === false, JSON.stringify(f));

  // --- 新格式：两行文本（比 JSON 更容易被小模型遵守）---
  const n1 = parse('NOSEARCH', '帮我写一个快速排序');
  check('NOSEARCH 判定为不搜', n1.need === false && n1.queries.length === 0, JSON.stringify(n1));

  const y1 = parse('SEARCH\n英伟达 财报|英伟达 股价', '英伟达最近财报怎么样');
  check('SEARCH 能取出多个关键词',
        y1.need === true && y1.queries.length === 2, JSON.stringify(y1));
  check('关键词按竖线正确切分', y1.queries[0] === '英伟达 财报', y1.queries[0]);

  const y2 = parse('SEARCH\n关键词甲|关键词乙|关键词丙|关键词丁', 'q');
  check('新格式下关键词也最多 3 条', y2.queries.length === 3, String(y2.queries.length));

  const n2 = parse('nosearch\n', '随便聊聊');
  check('NOSEARCH 大小写不敏感', n2.need === false, JSON.stringify(n2));

  // --- 关键回归：模型完全不按格式来时，绝不能再默认去搜 ---
  const junk1 = parse('我觉得这个问题不需要联网查询呢', '帮我润色这封邮件');
  check('胡说八道 + 无检索信号 → 不搜（修掉了 fail-open）',
        junk1.need === false, JSON.stringify(junk1));

  const junk2 = parse('抱歉我不太确定', '今天英伟达股价多少');
  check('胡说八道 + 有检索信号 → 才去搜', junk2.need === true, JSON.stringify(junk2));

  const junk3 = parse('', '什么是快速排序');
  check('空输出 + 概念题 → 不搜', junk3.need === false, JSON.stringify(junk3));

  const junk4 = parse('', '帮我查一下明天的天气');
  check('空输出 + 明确要求查 → 搜', junk4.need === true, JSON.stringify(junk4));

  const g = parse('{"need":true,"queries":["a"]}', 'q');
  check('过短的检索词被丢掉',
        g.queries.length === 0 || g.queries[0].length >= 2, JSON.stringify(g));

  // runMulti 的去重与封顶（不真的联网：把 run 临时换掉）
  const realRun = window.DS.search.run;
  let calls = 0;
  window.DS.search.run = function (q) {
    calls++;
    return Promise.resolve([
      { title: 'A', url: 'https://x.com/a?utm=1' },
      { title: 'B', url: 'https://x.com/b' },
      { title: 'A2', url: 'https://x.com/a/' }     // 与第一条同源，应被去掉
    ]);
  };
  const merged = await window.DS.search.runMulti(['q1', 'q2', 'q3', 'q4'], {
    maxRounds: 2, perQuery: 4, maxTotal: 6
  });
  check('多轮检索遵守轮数上限', calls === 2, '实际搜了 ' + calls + ' 轮');
  check('按 URL 去重', merged.filter((r) => /\/a/.test(r.url)).length === 1,
        JSON.stringify(merged.map((r) => r.url)));
  check('总条数封顶', merged.length <= 6, String(merged.length));

  let calls2 = 0;
  window.DS.search.run = function () {
    calls2++;
    return Promise.reject(new Error('boom'));
  };
  const none = await window.DS.search.runMulti(['q1', 'q2'], { maxRounds: 2 });
  check('单条搜索失败不会让整轮崩掉', Array.isArray(none) && none.length === 0,
        JSON.stringify(none));

  window.DS.search.run = realRun;

  // --- 结果质量过滤：把导航页/广告挡在上下文之外 ---
  const filt = window.DS.search.filterRelevant;
  const mixed = [
    { title: '英伟达发布最新财报', url: 'https://a.com/1', snippet: '英伟达本季度营收创新高' },
    { title: '首页 - 某某导航', url: 'https://b.com/2', snippet: '网址大全 天气预报 彩票' },
    { title: '英伟达股价走势', url: 'https://c.com/3', snippet: '财报公布后英伟达股价上涨' }
  ];
  const kept = filt(mixed, ['英伟达 财报']);
  check('不相关的导航页被滤掉',
        kept.every((r) => r.title.indexOf('导航') < 0),
        JSON.stringify(kept.map((r) => r.title)));
  check('相关的保留下来', kept.length === 2, String(kept.length));

  const allJunk = filt([
    { title: '导航站', url: 'https://x.com', snippet: '网址大全' },
    { title: '广告', url: 'https://y.com', snippet: '点击领取优惠券' }
  ], ['英伟达 财报']);
  check('全是垃圾时返回空，而不是硬凑', allJunk.length === 0, String(allJunk.length));
  check('没给关键词时不误杀', filt(mixed, []).length === 3);

  // --- 搜不到要如实告知，不能让模型当作没这回事 ---
  const ctxEmpty = window.DS.search.buildContext('英伟达 财报', []);
  check('没搜到时注入的是「没找到」说明',
        /没有找到/.test(ctxEmpty) && /不要编造/.test(ctxEmpty), ctxEmpty.slice(0, 30));
  check('没搜到时不谎称有资料', ctxEmpty.indexOf('以下是') < 0);

  const ctxOk = window.DS.search.buildContext('英伟达 财报', kept);
  check('有结果时正常列出', ctxOk.indexOf('[1]') > -1 && ctxOk.indexOf('https://') > -1);
}

/* ================================================================= */
console.log('\n[20] 导出 / 导入：长期记忆也要跟着走');
/* ================================================================= */
{
  const { window } = await boot('?demo=chat&theme=light', { clearStorage: true });
  const DS = window.DS;

  DS.memory.clear();
  DS.memory.add('用户在做 Android 客户端 DeepSleep', 'project');
  DS.memory.add('用户偏好简洁回答', 'preference');
  DS.memory.setSuggestions(['继续开发 DeepSleep', '帮我写个单元测试']);

  const json = DS.exportData();
  const parsed = JSON.parse(json);
  check('导出格式版本升到 2', parsed.version === 2, String(parsed.version));
  check('导出里带上了 memory', !!parsed.memory, String(!!parsed.memory));
  check('导出保留了记忆条目', (parsed.memory.items || []).length === 2,
        String((parsed.memory.items || []).length));
  check('导出保留了下一步建议', (parsed.memory.suggestions || []).length === 2);

  // 清空后从这份 JSON 还原
  DS.memory.clear();
  check('清空后记忆为 0', DS.memory.count() === 0, String(DS.memory.count()));

  const r = DS.importData(json);
  check('导入返回结构与对话数', typeof r.conversations === 'number' && typeof r.memories === 'number',
        JSON.stringify(r));
  check('记忆被还原回来', DS.memory.count() >= 2, String(DS.memory.count()));
  check('还原的记忆内容正确',
        DS.memory.all().some((x) => x.text.indexOf('DeepSleep') > -1),
        JSON.stringify(DS.memory.all().map((x) => x.text)));
  check('建议也还原了', DS.memory.suggestions().length === 2,
        String(DS.memory.suggestions().length));

  // 重复导入不应产生重复条目（走的是 ingest 的去重路径）
  const before = DS.memory.count();
  DS.importData(json);
  check('重复导入不会堆出重复记忆', DS.memory.count() === before,
        before + ' -> ' + DS.memory.count());

  // 老版本（v1，没有 memory 字段）也要能导入
  const v1 = JSON.stringify({ app: 'deepsleep-client', version: 1, conversations: [] });
  const r1 = DS.importData(v1);
  check('v1 老文件仍可导入且记忆为 0', r1.conversations === 0 && r1.memories === 0,
        JSON.stringify(r1));
}

/* ================================================================= */
console.log('\n=========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) {
  console.log('\n失败明细：');
  failures.forEach((f) => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
