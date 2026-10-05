/* 本地预览服务器：模拟 App 内 LocalServer 的行为，
   以便在桌面 Chrome / 无头 Chrome 中检查界面与流式渲染。
   用法： node tools/preview.mjs [port]
   然后访问 http://127.0.0.1:8787/?demo=chat&theme=dark */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WEB = path.join(ROOT, 'app', 'web');
const SEED = fs.readFileSync(path.join(ROOT, 'tools', 'preview-seed.js'), 'utf8');
const DIAG = fs.readFileSync(path.join(ROOT, 'tools', 'preview-diag.js'), 'utf8');
const PORT = Number(process.argv[2] || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8'
};

const DRIVER = `<script>
window.addEventListener('unhandledrejection', function (e) {
  var r = e.reason;
  console.log('UNHANDLED_REJECTION: ' + (r && r.stack ? r.stack : String(r)));
});
window.addEventListener('error', function (e) {
  console.log('WINDOW_ERROR: ' + (e.error && e.error.stack ? e.error.stack : e.message));
});
window.addEventListener('load', function () {
  var p = new URLSearchParams(location.search);
  var demo = p.get('demo');
  function click(id) { var e = document.getElementById(id); if (e) e.click(); }
  if (demo === 'drawer') setTimeout(function () { click('btn-menu'); }, 60);
  if (demo === 'settings') setTimeout(function () { click('btn-settings'); }, 60);
  if (demo === 'appearance') {
    setTimeout(function () { click('btn-settings'); }, 60);
    // 滚到「外观」分组，方便给主题设置截图
    setTimeout(function () {
      var el = document.getElementById('seg-scheme');
      if (!el) return;
      var card = el.closest('.card') || el;
      var title = card.previousElementSibling;
      (title && title.classList.contains('group-title') ? title : card)
        .scrollIntoView({ block: 'start' });
    }, 320);
  }
  if (demo === 'newchat') setTimeout(function () { click('btn-new-chat'); }, 60);
  // 通用：?scroll=<元素id> 会把该元素所在的设置分组滚到顶部
  var scrollId = p.get('scroll');
  if (scrollId) {
    setTimeout(function () {
      var el = document.getElementById(scrollId);
      if (!el) return;
      var card = el.closest('.card') || el;
      var title = card.previousElementSibling;
      (title && title.classList.contains('group-title') ? title : card)
        .scrollIntoView({ block: 'start' });
    }, 340);
  }
  if (demo === 'switchtest') {
    // 运行时切换配色：进设置 -> 点「森林绿」，用来复现真机上的切换行为
    setTimeout(function () { click('btn-settings'); }, 60);
    setTimeout(function () {
      var b = document.querySelector('#seg-scheme button[data-v="forest"]');
      console.log('SWITCHTEST click=' + (b ? b.getAttribute('data-v') : 'NOT_FOUND'));
      if (b) b.click();
    }, 400);
    setTimeout(function () {
      var on = document.querySelector('#seg-scheme button.on');
      var toast = document.getElementById('toast');
      console.log('SWITCHTEST after: scheme=' + document.documentElement.getAttribute('data-scheme') +
        ' onBtn=' + (on ? on.getAttribute('data-v') : 'none') +
        ' toast="' + (toast ? toast.textContent : '') + '"' +
        ' saved=' + (JSON.parse(localStorage.getItem('ds.settings.v1') || '{}').scheme));
    }, 900);
  }
  // 对话转生：确认弹窗
  if (demo === 'reindialog') {
    setTimeout(function () {
      var b = document.getElementById('btn-reincarnate');
      if (b) b.click();
    }, 420);
  }
  // 对话转生：直接展示压缩遮罩（截图用，省得真跑一次请求）
  if (demo === 'reinoverlay') {
    setTimeout(function () {
      var w = document.getElementById('rein-wrap');
      if (w) w.classList.remove('hidden');
      var s = document.getElementById('rein-status');
      if (s) s.textContent = '正在归纳…已压缩 1240 字';
    }, 420);
  }
  // 对话转生：带记忆的新对话（展示记忆提示条）
  if (demo === 'reinmemory') {
    setTimeout(function () {
      var memory = '· 项目：Android 客户端 DeepSleep（第三方 API 版）\\n' +
        '· 已完成：多服务商接入、7 套配色、朗读功能\\n' +
        '· 用户偏好：回答简洁，不要客套话\\n' +
        '· 下一步：验证对话转生';
      var c = window.DS.newConvo({ title: '转生 · 安卓客户端', memory: memory });
      window.DS.ui.showConvo(c.id);
      window.DS.ui.renderConvList();
    }, 380);
  }
  // 高级设置子页面
  if (demo === 'advanced') {
    setTimeout(function () { click('btn-settings'); }, 60);
    setTimeout(function () {
      var b = document.getElementById('btn-advanced');
      if (b) b.click();
    }, 340);
  }
  if (demo === 'sheet') {
    setTimeout(function () { click('btn-menu'); }, 40);
    setTimeout(function () { var m = document.querySelector('.conv-more'); if (m) m.click(); }, 140);
  }
  if (demo === 'stream') {
    setTimeout(function () {
      var ta = document.getElementById('input');
      ta.value = '用一段话解释量子纠缠，并给出一个 Python 示例。';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      click('btn-send');
    }, 120);
  }
});
</script>`;


const REASON_CHUNKS = [
  '用户想要一个关于量子纠缠的解释，', '并要求 Python 示例。\n',
  '先讲清楚纠缠的核心：', '两个粒子的联合态不可分解为各自状态的乘积。\n',
  '用一个 Bell 态举例最直观。\n',
  '再补充一句：', '纠缠本身不能超光速传递信息，', '需要经典信道配合。\n'
];

const ANSWER_CHUNKS = [
  '## 量子纠缠是什么\n\n',
  '量子纠缠是指两个或多个粒子共享同一个**不可分解**的量子态。',
  '此时你无法单独描述其中一个粒子——',
  '只能描述整个系统。\n\n',
  '最简单的例子是 Bell 态：\n\n',
  '$$|\\Phi^+\\rangle = \\frac{1}{\\sqrt{2}}\\big(|00\\rangle + |11\\rangle\\big)$$\n\n',
  '测量其中一个粒子得到 `0`，另一个立刻确定为 `0`，',
  '无论相隔多远。\n\n',
  '### 一个最小示例\n\n',
  '```python\n',
  'from qiskit import QuantumCircuit\n',
  'from qiskit_aer import AerSimulator\n\n',
  'qc = QuantumCircuit(2, 2)\n',
  'qc.h(0)          # 叠加\n',
  'qc.cx(0, 1)      # 纠缠\n',
  'qc.measure([0, 1], [0, 1])\n\n',
  'result = AerSimulator().run(qc, shots=1000).result()\n',
  'print(result.get_counts())   # 只会出现 00 / 11\n',
  '```\n\n',
  '运行后你只会看到 `00` 和 `11` 两个结果各约一半，',
  '**`01` 和 `10` 永远不会出现**——这就是纠缠的签名。\n\n',
  '> 注意：纠缠不能用来超光速通信。\n\n',
  '常见应用包括量子密钥分发、量子隐形传态和量子计算中的纠错码。'
];

function sseChunk(obj) {
  return 'data: ' + JSON.stringify(obj) + '\n\n';
}

function makeStream(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  });

  let i = 0, j = 0;
  const model = 'deepseek-flash';

  const timer = setInterval(() => {
    if (i < REASON_CHUNKS.length) {
      res.write(sseChunk({
        id: 'demo', object: 'chat.completion.chunk', model,
        choices: [{ index: 0, delta: { reasoning_content: REASON_CHUNKS[i++] } }]
      }));
      return;
    }
    if (j < ANSWER_CHUNKS.length) {
      res.write(sseChunk({
        id: 'demo', object: 'chat.completion.chunk', model,
        choices: [{ index: 0, delta: { content: ANSWER_CHUNKS[j++] } }]
      }));
      return;
    }
    res.write(sseChunk({
      id: 'demo', object: 'chat.completion.chunk', model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 42, completion_tokens: 386, total_tokens: 428 }
    }));
    res.write('data: [DONE]\n\n');
    clearInterval(timer);
    res.end();
  }, 35);

  res.on('close', () => clearInterval(timer));
}

/** Anthropic /messages 的流式事件结构与 OpenAI 完全不同，单独模拟一份 */
function makeAnthropicStream(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  });

  const send = (type, obj) => {
    res.write('event: ' + type + '\n');
    res.write('data: ' + JSON.stringify(obj) + '\n\n');
  };

  const think = ['用户打招呼，', '应该简短友好地回应。\n', '顺便提一下我能做什么。'];
  const text = ['你好！', '我是 **DeepSleep**。\n\n', '我可以帮你写代码、解释概念、整理资料。',
    '\n\n试试问我：\n\n', '- 解释一下 `async/await`\n', '- 写一个 Python 脚本\n'];

  let i = 0, j = 0;
  send('message_start', {
    type: 'message_start',
    message: { id: 'msg_demo', model: 'claude-sonnet-4-5', usage: { input_tokens: 14, output_tokens: 0 } }
  });

  const timer = setInterval(() => {
    if (i < think.length) {
      send('content_block_delta', {
        type: 'content_block_delta', index: 0,
        delta: { type: 'thinking_delta', thinking: think[i++] }
      });
      return;
    }
    if (j < text.length) {
      send('content_block_delta', {
        type: 'content_block_delta', index: 0,
        delta: { type: 'text_delta', text: text[j++] }
      });
      return;
    }
    send('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 57 }
    });
    send('message_stop', { type: 'message_stop' });
    clearInterval(timer);
    res.end();
  }, 35);

  res.on('close', () => clearInterval(timer));
}

/* 复刻原生代理（LocalServer.java）的鉴权头拼装逻辑。
   重点：HTTP 头值的首尾空白会被规范化裁掉 —— Node 和 Java 都一样。
   所以「Bearer」和 Key 之间的空格必须在服务端补，
   前端若指望传 "Bearer " 过来，实际收到的是 "Bearer"，拼出 "Bearersk-xxx" 直接 401。 */
let lastAuth = null;
function composeAuth(h) {
  const key = h['x-api-key'];
  if (!key) return null;
  const schemeRaw = h['x-auth-scheme'];
  const prefixRaw = h['x-auth-prefix'];
  let scheme;
  if (schemeRaw !== undefined) scheme = String(schemeRaw).trim();
  else scheme = prefixRaw === undefined ? 'Bearer' : String(prefixRaw).trim();
  return {
    name: h['x-auth-header'] || 'Authorization',
    value: scheme ? scheme + ' ' + key : key
  };
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');

  // 测试用：回放最近一次代理请求拼出来的鉴权头
  if (u.pathname === '/__lastauth') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(lastAuth));
    return;
  }

  if (u.pathname === '/api/proxy') {
    lastAuth = composeAuth(req.headers);
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const apiPath = req.headers['x-api-path'] || '';
      if (apiPath === '/models') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] }));
        return;
      }
      if (apiPath === '/user/balance') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '48.20', available_balance: '48.20' }] }));
        return;
      }
      if (apiPath === '/messages') {
        makeAnthropicStream(res);
        return;
      }
      // 对话转生：压缩请求返回一份固定摘要，方便端到端测试
      {
        let asked = '';
        try { asked = Buffer.concat(chunks).toString('utf8'); } catch (e) { asked = ''; }
        if (asked.indexOf('上下文压缩器') > -1) {
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-store',
            'connection': 'close'
          });
          const summary = '· 项目：Android 客户端 DeepSleep（第三方 API 版）\n' +
            '· 已完成：多服务商接入、7 套配色、朗读功能\n' +
            '· 用户偏好：回答简洁、不要客套话\n' +
            '· 下一步：验证对话转生';
          const pieces = summary.match(/[\s\S]{1,14}/g) || [];
          let i = 0;
          const timer = setInterval(() => {
            if (i >= pieces.length) {
              res.write('data: [DONE]\n\n');
              clearInterval(timer);
              res.end();
              return;
            }
            res.write('data: ' + JSON.stringify({
              choices: [{ delta: { content: pieces[i++] } }]
            }) + '\n\n');
          }, 6);
          return;
        }
      }
      makeStream(res);
    });
    return;
  }

  let rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1));
  const file = path.join(WEB, rel);
  if (!file.startsWith(WEB)) { res.writeHead(403); res.end('forbidden'); return; }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found: ' + rel); return; }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    if (rel === 'index.html') {
      let html = data.toString('utf8');
      const head = '<script>' + DIAG + '</script>' +
        '<script>window.__DS_APP_TOKEN__="preview";window.__DS_APP_VERSION__="1.0.0";</script>' +
        '<script>' + SEED + '</script>';
      html = html.replace('<head>', '<head>' + head);
      html = html.replace('</body>', DRIVER + '</body>');
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(html);
      return;
    }
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const base = 'http://127.0.0.1:' + PORT + '/';
  console.log('preview server: ' + base);
  console.log('');
  console.log('  页面      ?demo=home | chat | drawer | settings | sheet | stream | newchat');
  console.log('  配色      &scheme=blue | claude | pink');
  console.log('  明暗      &theme=light | dark');
  console.log('');
  console.log('  示例：');
  console.log('    首页·官方蓝      ' + base + '?demo=home&scheme=blue&theme=light');
  console.log('    对话·官方蓝深色  ' + base + '?demo=chat&scheme=blue&theme=dark');
  console.log('    对话·克劳德橙    ' + base + '?demo=chat&scheme=claude&theme=light');
  console.log('    设置·像素粉      ' + base + '?demo=settings&scheme=pink&theme=light');
  console.log('    对话·像素粉深色  ' + base + '?demo=chat&scheme=pink&theme=dark');
  console.log('    抽屉·像素粉      ' + base + '?demo=drawer&scheme=pink&theme=light');
  console.log('    流式输出演示     ' + base + '?demo=stream&scheme=blue&theme=light');
});
