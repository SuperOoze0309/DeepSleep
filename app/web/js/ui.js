/* 界面控制器：抽屉 / 对话 / 流式输出 / 设置 */
window.DS = window.DS || {};
(function (DS) {
  'use strict';

  function E(id) { return document.getElementById(id); }

  var APP_VERSION = window.__DS_APP_VERSION__ || '1.0.0';

  var S = {
    view: 'chat',
    drawer: false,
    busy: false,
    abort: null,
    stream: null,
    pendingImages: [],
    filter: '',
    pinned: true,
    suppressClick: false,
    paintTimer: null,
    paintLast: 0,
    closeSheet: null,
    closeDialog: null
  };

  var SUGGESTIONS = [
    '帮我写一份本周工作周报',
    '用 Python 写一个贪吃蛇游戏',
    '解释一下 Transformer 的注意力机制',
    '把下面这段话翻译成地道的英文',
    '整理一份三天的北京旅游攻略',
    '这道数学题怎么解：求 x²-5x+6=0',
    '给产品写 5 条宣传标语',
    '帮我润色这封辞职邮件'
  ];

  /* ==================================================================
     启动
     ================================================================== */

  DS.ui = {
    init: function () {
      DS.loadState();
      applyScheme();
      applyAccent();
      applyOled();
      applyTypeface();
      applyDensity();
      applyTheme();
      applyFont();
      bindScrim();
      bindDrawer();
      bindTopbar();
      bindMessages();
      bindComposer();
      bindSettings();
      bindProviders();
      bindMisc();
      installGestureGuard();
      syncSettingsUI();
      syncChips();
      buildChips();
      renderConvList();
      showConvo(DS.activeId, { noScroll: true });
      DS.hydrateIcons(document);
      exposeNativeHooks();
      updateComposer();
      updateApiHint();
      updateVoiceHint();
      autogrow();
      setTimeout(function () { scrollToBottom(true); }, 60);
      // 首帧之后再开启颜色过渡，避免启动瞬间闪一下
      setTimeout(function () {
        document.documentElement.classList.add('theme-ready');
      }, 260);
    }
  };

  /* ==================================================================
     主题 / 字号
     ================================================================== */

  /* 配色主题 —— light / dark 是该配色下的页面背景色，用来同步系统栏 */
  var SCHEMES = {
    blue:   { label: '官方蓝',   light: '#FFFFFF', dark: '#131417' },
    claude: { label: '克劳德橙', light: '#FAF9F5', dark: '#1F1E1D' },
    violet: { label: '紫罗兰',   light: '#F8F7FE', dark: '#100E1C' },
    forest: { label: '森林绿',   light: '#F6FAF7', dark: '#0F1A14' },
    cyber:  { label: '霓虹赛博', light: '#F8F5FC', dark: '#08050F' },
    pink:   { label: '像素粉',   light: '#FFF5FA', dark: '#1A0A14' },
    maid:   { label: '女仆粉',   light: '#FFF7FA', dark: '#1F141A' }
  };

  var SCHEME_HINTS = {
    blue: '官方蓝：经典品牌蓝 #4D6BFE，克制的圆角卡片',
    claude: '克劳德橙：Claude 珊瑚橙 + 暖米白纸张质感',
    violet: '紫罗兰：柔和的紫调，深色下偏冷',
    forest: '森林绿：护眼墨绿，长时间阅读更舒服',
    cyber: '霓虹赛博：以深色为主，品红霓虹光晕 + 网格背景',
    pink: '像素粉：复古像素风格 —— 直角、粗描边、硬阴影、等宽字体',
    maid: '女仆粉：二次元女仆风 —— 蕾丝花边、蝴蝶结、爱心光标、圆润柔和'
  };

  function applyScheme() {
    var s = DS.settings.scheme || 'blue';
    if (!SCHEMES[s]) s = 'blue';
    document.documentElement.setAttribute('data-scheme', s);
    var hint = E('scheme-hint');
    if (hint) hint.textContent = SCHEME_HINTS[s];
    // 首页大图跟着主题换吉祥物（有自定义图标时以自定义为准）
    var logo = document.querySelector('.hero-logo');
    if (logo) {
      var src = mascotFor(s);
      if (src && logo.getAttribute('src') !== src) logo.setAttribute('src', src);
    }
    // 关于页那张仍然用品牌图标，不跟着换
  }

  /* ---------------- 自定义强调色 ----------------
     写在 <html> 的行内样式上；行内优先级高于任何配色块，
     所以「任意配色 + 任意强调色」可以自由组合。 */

  var ACCENT_PRESETS = [
    '#4D6BFE', '#7C5CFF', '#C2189A', '#F2598F', '#D97757',
    '#FFB020', '#2E9E6B', '#00B8D4', '#E5484D', '#64748B'
  ];

  function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6) return null;
    var n = parseInt(h, 16);
    if (isNaN(n)) return null;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function shadeHex(rgb, k) {
    return '#' + [rgb.r, rgb.g, rgb.b].map(function (v) {
      var x = Math.max(0, Math.min(255, Math.round(v * k)));
      return (x < 16 ? '0' : '') + x.toString(16);
    }).join('');
  }

  function renderAccentRow() {
    var box = E('accent-row');
    if (!box) return;
    var cur = (DS.settings.accentColor || '').toLowerCase();
    var html = '<button class="accent-dot accent-auto' + (cur ? '' : ' on') +
      '" data-v="" aria-label="跟随主题">自动</button>';
    for (var i = 0; i < ACCENT_PRESETS.length; i++) {
      var c = ACCENT_PRESETS[i];
      html += '<button class="accent-dot' + (cur === c.toLowerCase() ? ' on' : '') +
        '" data-v="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>';
    }
    box.innerHTML = html;
  }

  function applyAccent() {
    var root = document.documentElement;
    var hex = DS.settings.accentColor || '';
    var rgb = hex ? hexToRgb(hex) : null;
    if (!rgb) {
      root.style.removeProperty('--brand');
      root.style.removeProperty('--brand-press');
      root.style.removeProperty('--brand-weak');
    } else {
      root.style.setProperty('--brand', hex);
      root.style.setProperty('--brand-press', shadeHex(rgb, 0.85));
      root.style.setProperty('--brand-weak',
        'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.14)');
    }
    var label = E('accent-val');
    if (label) label.textContent = rgb ? hex.toUpperCase() : '跟随主题';
    renderAccentRow();
  }

  function applyOled() {
    document.documentElement.setAttribute('data-oled', DS.settings.oledBlack ? '1' : '0');
  }

  function applyTypeface() {
    document.documentElement.setAttribute('data-font', DS.settings.fontFamily || 'system');
  }

  function applyDensity() {
    document.documentElement.setAttribute('data-density', DS.settings.density || 'cozy');
  }

  function isDark() {
    var t = DS.settings.theme || 'system';
    if (t === 'dark') return true;
    if (t === 'light') return false;
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
  }

  function applyTheme() {
    var dark = isDark();
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var l = E('hljs-light'), d = E('hljs-dark');
    if (l) l.disabled = dark;
    if (d) d.disabled = !dark;

    var scheme = DS.settings.scheme || 'blue';
    var palette = SCHEMES[scheme] || SCHEMES.blue;
    var bg = dark ? palette.dark : palette.light;

    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', bg);

    // 状态栏/导航栏跟随页面背景（避免主题切换后系统栏还是旧颜色）
    try {
      if (window.AndroidBridge && AndroidBridge.setSystemBars) {
        AndroidBridge.setSystemBars(dark, bg);
      } else if (window.AndroidBridge && AndroidBridge.setDark) {
        AndroidBridge.setDark(dark);
      }
    } catch (e) { /* 非 App 环境 */ }
  }

  function applyFont() {
    var v = DS.settings.fontScale || 1;
    document.documentElement.style.setProperty('--fs', String(v));
  }

  /* ==================================================================
     原生桥接
     ================================================================== */

  function exposeNativeHooks() {
    window.__onInsets = function (top, bottom) {
      document.documentElement.style.setProperty('--inset-top', (top || 0) + 'px');
      document.documentElement.style.setProperty('--inset-bottom', (bottom || 0) + 'px');
      if (S.pinned) requestAnimationFrame(function () { scrollToBottom(true); });
    };
    window.__onBack = function () {
      if (!E('lightbox').classList.contains('hidden')) { closeLightbox(); return true; }
      if (S.closeSheet) { S.closeSheet(); return true; }
      if (S.closeDialog) { S.closeDialog(); return true; }
      if (S.drawer) { closeDrawer(); return true; }
      if (S.view === 'advanced') { switchView('settings'); return true; }
      if (S.view === 'settings') { switchView('chat'); return true; }
      return false;
    };
    window.__onNativeTheme = function () { applyTheme(); };
    window.__onPauseFlush = function () { DS.saveConvos(true); };
  }

  function nativeShare(text) {
    try {
      if (window.AndroidBridge && AndroidBridge.shareText) { AndroidBridge.shareText(text); return true; }
    } catch (e) { /* ignore */ }
    return false;
  }

  function saveTextFile(name, content) {
    try {
      if (window.AndroidBridge && AndroidBridge.saveFile) return AndroidBridge.saveFile(name, content);
    } catch (e) { /* ignore */ }
    return null;
  }

  /* ==================================================================
     抽屉
     ================================================================== */

  function openDrawer() {
    S.drawer = true;
    E('drawer').classList.add('open');
    E('drawer').setAttribute('aria-hidden', 'false');
    E('scrim').classList.add('show');
  }

  function closeDrawer() {
    S.drawer = false;
    E('drawer').classList.remove('open');
    E('drawer').setAttribute('aria-hidden', 'true');
    E('scrim').classList.remove('show');
  }

  function bindScrim() {
    E('scrim').addEventListener('click', closeDrawer);
  }

  function bindDrawer() {
    E('btn-menu').addEventListener('click', openDrawer);
    E('btn-new-chat').addEventListener('click', function () {
      closeDrawer();
      startNewChat();
    });
    E('conv-search').addEventListener('input', function (e) {
      S.filter = e.target.value.trim().toLowerCase();
      renderConvList();
    });
    E('btn-settings').addEventListener('click', function () {
      closeDrawer();
      switchView('settings');
    });

    // 长按对话项 → 重命名 / 删除
    longPress(E('conv-list'), '.conv-item', function (el) {
      convoMenu(el.getAttribute('data-id'));
    });

    E('conv-list').addEventListener('click', function (e) {
      if (S.suppressClick) { S.suppressClick = false; return; }
      if (consumeDrag()) return;
      var more = e.target.closest('.conv-more');
      var item = e.target.closest('.conv-item');
      if (!item) return;
      var id = item.getAttribute('data-id');
      if (more) { convoMenu(id); return; }
      closeDrawer();
      showConvo(id);
    });
  }

  /** 对话项菜单：重命名 / 删除 */
  function convoMenu(id) {
    var convo = DS.getConvo(id);
    if (!convo) return;
    openSheet(convo.title, [
      { label: '重命名', icon: 'edit', value: 'rename' },
      {
        label: convo.memoryOff ? '允许读写记忆' : '此对话不记入记忆',
        icon: 'think',
        value: 'memory'
      },
      { label: '删除对话', icon: 'trash', value: 'delete', danger: true }
    ]).then(function (act) {
      if (!act) return;
      if (act.value === 'memory') {
        convo.memoryOff = !convo.memoryOff;
        DS.saveConvos();
        DS.toast(convo.memoryOff
          ? '这个对话不会读写长期记忆'
          : '这个对话会读写长期记忆', 2400);
        return;
      }
      if (act.value === 'rename') {
        openDialog({ title: '重命名对话', input: convo.title, okText: '保存' }).then(function (v) {
          if (v) { DS.renameConvo(id, v); renderConvList(); syncTitle(); }
        });
      } else if (act.value === 'delete') {
        openDialog({
          title: '删除对话',
          desc: '「' + convo.title + '」将被永久删除，无法恢复。',
          okText: '删除',
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          var wasActive = DS.activeId === id;
          DS.deleteConvo(id);
          if (wasActive) showConvo(DS.activeId, { noScroll: true });
          renderConvList();
          DS.toast('已删除');
        });
      }
    });
  }

  function renderConvList() {
    var box = E('conv-list');
    var list = DS.convos.filter(function (c) {
      if (!S.filter) return true;
      return (c.title || '').toLowerCase().indexOf(S.filter) >= 0;
    });

    if (!list.length) {
      box.innerHTML = '<div class="drawer-empty">' +
        (DS.convos.length ? '没有匹配的对话' : '还没有对话记录') + '</div>';
      return;
    }

    var html = '';
    var lastGroup = '';
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var g = DS.dateGroup(c.updatedAt || c.createdAt);
      if (g !== lastGroup) {
        html += '<div class="conv-group-title">' + DS.escapeHtml(g) + '</div>';
        lastGroup = g;
      }
      html += '<button class="conv-item' + (c.id === DS.activeId ? ' active' : '') + '" data-id="' + c.id + '">' +
        '<span class="conv-title">' + DS.escapeHtml(c.title || '新对话') + '</span>' +
        '<span class="conv-more" data-more="1">' + DS.iconHtml('more') + '</span>' +
        '</button>';
    }
    box.innerHTML = html;
  }

  function syncTitle() {
    var convo = DS.activeId ? DS.getConvo(DS.activeId) : null;
    E('topbar-title').textContent = convo ? (convo.title || '新对话') : 'DeepSleep';
  }

  /* ==================================================================
     视图切换
     ================================================================== */

  /* 设置分两级：settings（主设置页）/ advanced（高级设置子页）。
     三个视图互斥显示，顶栏的返回键按层级逐级回退。 */
  function switchView(v) {
    S.view = v;
    var isChat = v === 'chat';
    var isSettings = v === 'settings';
    var isAdvanced = v === 'advanced';
    var isPage = isSettings || isAdvanced;
    E('view-settings').classList.toggle('hidden', !isSettings);
    E('view-advanced').classList.toggle('hidden', !isAdvanced);
    E('view-chat').classList.toggle('hidden', !isChat);
    E('btn-menu').classList.toggle('hidden', isPage);
    E('btn-new-chat-2').classList.toggle('hidden', isPage);
    E('btn-reincarnate').classList.toggle('hidden', isPage);
    E('btn-back').classList.toggle('hidden', !isPage);
    E('topbar-title').textContent = isAdvanced ? '高级设置' : (isSettings ? '设置' : '');
    if (isChat) syncTitle();
    // 进入任意一级设置页时按当前状态刷新一遍：从别处返回、或设置被别处改动
    // （比如新加了自定义开屏形象）之后，看到的都是最新值。
    if (isPage) syncSettingsUI();
  }

  /** 返回键：高级设置 -> 设置页 -> 对话页，逐级回退 */
  function goBack() {
    if (S.view === 'advanced') { switchView('settings'); return; }
    switchView('chat');
  }

  function bindTopbar() {
    E('btn-back').addEventListener('click', goBack);
    E('btn-new-chat-2').addEventListener('click', function () { startNewChat(); });
    if (DS.reincarnate) DS.reincarnate.bind();
  }

  function startNewChat() {
    if (S.busy) { DS.toast('正在生成中，请先停止'); return; }
    closeDrawer();
    switchView('chat');
    DS.setActive(null);
    showConvo(null);
    renderConvList();
    setTimeout(function () { try { E('input').focus(); } catch (e) { /* ignore */ } }, 120);
  }

  /* ==================================================================
     对话渲染
     ================================================================== */

  /** 转生记忆提示条：折叠起来只占一行，展开可以看到具体摘要 */
  function buildMemoryNote(memory) {
    var wrap = DS.el('div', { class: 'memory-note' });
    wrap.innerHTML =
      '<button class="memory-head">' + DS.iconHtml('think') +
      '<span>带自上一个对话的记忆</span>' + DS.iconHtml('down', 'memory-caret') + '</button>' +
      '<div class="memory-body"></div>';
    wrap.querySelector('.memory-body').textContent = String(memory);
    wrap.querySelector('.memory-head').addEventListener('click', function () {
      wrap.classList.toggle('open');
    });
    DS.hydrateIcons(wrap);
    return wrap;
  }

  function showConvo(id, opts) {
    opts = opts || {};
    var convo = id ? DS.getConvo(id) : null;
    DS.setActive(convo ? convo.id : null);

    var box = E('messages');
    box.innerHTML = '';
    E('hero').classList.toggle('hidden', !!(convo && convo.messages.length));

    // 转生带过来的记忆：默认收起，需要时展开看看到底带了什么
    if (convo && convo.memory) box.appendChild(buildMemoryNote(convo.memory));

    if (convo) {
      for (var i = 0; i < convo.messages.length; i++) {
        box.appendChild(buildMsgEl(convo.messages[i]));
      }
    }
    syncTitle();

    if (S.stream && convo && S.stream.convoId === convo.id) {
      var el = box.querySelector('[data-id="' + S.stream.msg.id + '"]');
      if (el) { S.stream.nodes = collectNodes(el); schedulePaint(); }
    }

    DS.hydrateIcons(box);
    if (!opts.noScroll) requestAnimationFrame(function () { scrollToBottom(true); });
    E('btn-scroll-bottom').classList.remove('show');
    S.pinned = true;
  }

  function findMsg(convo, id) {
    if (!convo) return null;
    for (var i = 0; i < convo.messages.length; i++) if (convo.messages[i].id === id) return convo.messages[i];
    return null;
  }

  function buildMsgEl(msg) {
    if (msg.role === 'user') return buildUserEl(msg);
    var nodes = createAssistantNodes(msg);
    return nodes.el;
  }

  function buildUserEl(msg) {
    var wrap = DS.el('div', { class: 'msg user', 'data-id': msg.id });
    var col = DS.el('div', { class: 'user-col' });
    var bubble = DS.el('div', { class: 'bubble' });
    if (msg.images && msg.images.length) {
      for (var i = 0; i < msg.images.length; i++) {
        (function (src) {
          var im = DS.el('img', { class: 'bubble-img', src: src, alt: '' });
          im.addEventListener('click', function () { openLightbox(src); });
          bubble.appendChild(im);
        })(msg.images[i]);
      }
    }
    if (msg.content) bubble.appendChild(DS.el('div', { class: 'bubble-text', text: msg.content }));
    col.appendChild(bubble);

    // 自己也给一个明确的入口：复制 / 编辑重发 / 删除。
    // 官方客户端只做长按，但长按不好发现，这里补一个「⋯」。
    var actions = DS.el('div', { class: 'msg-actions user-actions' });
    actions.innerHTML = '<button class="act" data-act="more" aria-label="更多操作">' +
      DS.iconHtml('more') + '</button>';
    col.appendChild(actions);

    wrap.appendChild(col);
    return wrap;
  }

  function createAssistantNodes(msg) {
    var el = DS.el('div', { class: 'msg assistant', 'data-id': msg.id });
    var body = DS.el('div', { class: 'body' });

    var working = DS.el('div', { class: 'working hidden' },
      DS.iconHtml('sparkle') + '<span class="working-text"></span>');
    body.appendChild(working);

    var sources = DS.el('div', { class: 'sources hidden' });
    sources.innerHTML = '<button class="sources-head">' + DS.iconHtml('globe') +
      '<span class="sources-label">搜索来源</span>' + DS.iconHtml('down', 'think-caret') + '</button>' +
      '<div class="sources-list"></div>';
    body.appendChild(sources);

    var think = DS.el('div', { class: 'think hidden' });
    think.innerHTML = '<button class="think-head">' + DS.iconHtml('think') +
      '<span class="think-label">深度思考</span>' + DS.iconHtml('down', 'think-caret') + '</button>' +
      '<div class="think-body"></div>';
    body.appendChild(think);

    var md = DS.el('div', { class: 'md' });
    body.appendChild(md);

    var err = DS.el('div', { class: 'err-box hidden' });
    err.innerHTML = DS.iconHtml('alert') + '<span class="err-text"></span>';
    body.appendChild(err);

    var actions = DS.el('div', { class: 'msg-actions hidden' });
    actions.innerHTML =
      '<button class="act" data-act="copy" aria-label="复制">' + DS.iconHtml('copy') + '</button>' +
      '<button class="act" data-act="regen" aria-label="重新生成">' + DS.iconHtml('refresh') + '</button>' +
      '<button class="act" data-act="speak" aria-label="朗读">' + DS.iconHtml('speaker') + '</button>' +
      '<button class="act" data-act="like" aria-label="赞同">' + DS.iconHtml('thumbup') + '</button>' +
      '<button class="act" data-act="dislike" aria-label="反对">' + DS.iconHtml('thumbdown') + '</button>';
    // 设备没有 TTS 引擎时不显示朗读按钮，免得点了没反应
    if (!DS.tts.available()) {
      var spk = actions.querySelector('[data-act="speak"]');
      if (spk) spk.classList.add('hidden');
    }
    body.appendChild(actions);

    el.appendChild(body);

    if (msg.reasoning) {
      think.classList.remove('hidden');
      think.querySelector('.think-body').textContent = msg.reasoning;
      think.querySelector('.think-label').textContent = '已深度思考（用时 ' + DS.fmtDuration(msg.reasoningMs || 0) + '）';
    }
    if (msg.sources && msg.sources.length) fillSources(sources, msg.sources);
    if (msg.content) renderFinalMd(md, msg);
    if (msg.error) {
      err.classList.remove('hidden');
      err.querySelector('.err-text').textContent = msg.error;
    }
    if (msg.content || msg.error) {
      actions.classList.remove('hidden');
      updateActionsState(actions, msg);
    }

    return collectNodes(el);
  }

  function collectNodes(el) {
    return {
      el: el,
      working: el.querySelector('.working'),
      workingText: el.querySelector('.working-text'),
      sources: el.querySelector('.sources'),
      sourcesLabel: el.querySelector('.sources-label'),
      sourcesList: el.querySelector('.sources-list'),
      think: el.querySelector('.think'),
      thinkLabel: el.querySelector('.think-label'),
      thinkBody: el.querySelector('.think-body'),
      md: el.querySelector('.md'),
      err: el.querySelector('.err-box'),
      errText: el.querySelector('.err-text'),
      actions: el.querySelector('.msg-actions')
    };
  }

  function fillSources(sourcesEl, list) {
    sourcesEl.classList.remove('hidden');
    sourcesEl.querySelector('.sources-label').textContent = '已搜索 ' + list.length + ' 个网页';
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      html += '<a class="source-item" href="' + DS.escapeHtml(r.url) + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="si-title">[' + (i + 1) + '] ' + DS.escapeHtml(r.title) + '</span><br>' +
        '<span class="si-url">' + DS.escapeHtml(shortUrl(r.url)) + '</span>' +
        '</a>';
    }
    sourcesEl.querySelector('.sources-list').innerHTML = html;
  }

  function shortUrl(u) {
    try {
      var x = new URL(u);
      return x.hostname + (x.pathname.length > 1 ? x.pathname : '');
    } catch (e) { return u; }
  }

  function renderFinalMd(mdEl, msg) {
    if (!msg.content) { mdEl.innerHTML = ''; return; }
    mdEl.innerHTML = DS.md.render(msg.content, { streaming: false });
    DS.md.math(mdEl, {});
  }

  function updateActionsState(actionsEl, msg) {
    var like = actionsEl.querySelector('[data-act="like"]');
    var dislike = actionsEl.querySelector('[data-act="dislike"]');
    if (like) like.classList.toggle('on', msg.feedback === 'like');
    if (dislike) dislike.classList.toggle('on', msg.feedback === 'dislike');
  }

  /* ==================================================================
     流式绘制
     ================================================================== */

  function schedulePaint() {
    if (S.paintTimer) return;
    var wait = Math.max(0, 50 - (Date.now() - S.paintLast));
    S.paintTimer = setTimeout(function () {
      S.paintTimer = null;
      S.paintLast = Date.now();
      paintStream();
    }, wait);
  }

  function setWorking(nodes, text) {
    if (!nodes || !nodes.working) return;
    if (!text) { nodes.working.classList.add('hidden'); return; }
    nodes.working.classList.remove('hidden');
    nodes.workingText.textContent = text;
  }

  function paintStream() {
    var st = S.stream;
    if (!st) return;
    var msg = st.msg, n = st.nodes;
    if (!n || !n.el || !n.el.isConnected) return;

    // 思考过程
    if (msg.reasoning) {
      n.think.classList.remove('hidden');
      n.thinkBody.textContent = msg.reasoning;
      var reasoningDone = !st.streaming || st.contentStarted;
      // 用户手动折叠/展开过就以用户为准：流式期间这里每帧都会跑，
      // 之前无条件 add('open') 会把用户刚收起的思考框立刻又展开。
      var userToggled = n.think.getAttribute('data-user-toggled') === '1';
      if (reasoningDone) {
        n.thinkLabel.textContent = '已深度思考（用时 ' + DS.fmtDuration(msg.reasoningMs || 0) + '）';
        if (!userToggled) n.think.classList.remove('open');
      } else {
        n.thinkLabel.textContent = '深度思考中';
        if (!userToggled) n.think.classList.add('open');
      }
    }

    // 来源
    if (msg.sources && msg.sources.length && n.sources.classList.contains('hidden')) {
      fillSources(n.sources, msg.sources);
    }

    // 正文
    if (msg.content) {
      n.md.innerHTML = DS.md.render(msg.content, { streaming: st.streaming }) +
        (st.streaming ? '<span class="cursor"></span>' : '');
      if (!st.streaming) DS.md.math(n.md, {});
      else DS.md.math(n.md, { streaming: true });
    }

    // 错误
    if (msg.error) {
      n.err.classList.remove('hidden');
      n.errText.textContent = msg.error;
    }

    if (S.pinned) scrollToBottom();
  }

  /* ==================================================================
     滚动
     ================================================================== */

  function scrollToBottom(force) {
    var sa = E('scroll-area');
    sa.scrollTop = sa.scrollHeight;
    if (force) { S.pinned = true; E('btn-scroll-bottom').classList.remove('show'); }
  }

  function bindMessages() {
    var sa = E('scroll-area');
    sa.addEventListener('scroll', function () {
      var dist = sa.scrollHeight - sa.scrollTop - sa.clientHeight;
      S.pinned = dist < 70;
      E('btn-scroll-bottom').classList.toggle('show', dist > 240);
    }, { passive: true });

    E('btn-scroll-bottom').addEventListener('click', function () { scrollToBottom(true); });

    E('messages').addEventListener('click', function (e) {
      if (S.suppressClick) { S.suppressClick = false; return; }
      // 滑动列表之后手指蹭到的按钮不要响应
      if (consumeDrag()) return;

      var copyBtn = e.target.closest('.code-copy');
      if (copyBtn) {
        var block = copyBtn.closest('.code-block');
        var codeEl = block ? block.querySelector('code') : null;
        DS.copyText(codeEl ? codeEl.textContent : '');
        var span = copyBtn.querySelector('span');
        if (span) { span.textContent = '已复制'; setTimeout(function () { span.textContent = '复制'; }, 1400); }
        return;
      }

      var thinkHead = e.target.closest('.think-head');
      if (thinkHead) {
        var thinkBox = thinkHead.parentElement;
        thinkBox.classList.toggle('open');
        // 记住用户的手动选择：流式过程中 paintStream 会不停重绘，
        // 不能让它把用户刚收起的思考框又强行展开。
        thinkBox.setAttribute('data-user-toggled', '1');
        return;
      }

      var srcHead = e.target.closest('.sources-head');
      if (srcHead) { srcHead.parentElement.classList.toggle('open'); return; }

      var act = e.target.closest('.act');
      if (act) { handleAction(act); return; }
    });

    longPress(E('messages'), '.msg.user', function (el) {
      var convo = DS.activeId ? DS.getConvo(DS.activeId) : null;
      var msg = findMsg(convo, el.getAttribute('data-id'));
      if (msg) userMsgMenu(convo, msg);
    });

    longPress(E('messages'), '.msg.assistant', function (el) {
      var convo = DS.activeId ? DS.getConvo(DS.activeId) : null;
      var msg = findMsg(convo, el.getAttribute('data-id'));
      if (!msg || !msg.content) return;
      openSheet(null, [
        { label: '复制回答', icon: 'copy', value: 'copy' },
        { label: '分享', icon: 'share', value: 'share' },
        { label: '重新生成', icon: 'refresh', value: 'regen' }
      ]).then(function (a) {
        if (!a) return;
        if (a.value === 'copy') DS.copyText(msg.content);
        else if (a.value === 'share') { if (!nativeShare(msg.content)) DS.copyText(msg.content); }
        else if (a.value === 'regen') regenerate(convo, msg);
      });
    });
  }

  /* ==================================================================
     消息操作
     ================================================================== */

  function handleAction(act) {
    var msgEl = act.closest('.msg');
    var convo = DS.activeId ? DS.getConvo(DS.activeId) : null;
    var msg = findMsg(convo, msgEl.getAttribute('data-id'));
    if (!msg) return;
    var kind = act.getAttribute('data-act');

    if (kind === 'copy') {
      DS.copyText(msg.content || '');
      act.classList.add('done');
      setTimeout(function () { act.classList.remove('done'); }, 1200);
    } else if (kind === 'regen') {
      regenerate(convo, msg);
    } else if (kind === 'like' || kind === 'dislike') {
      msg.feedback = (msg.feedback === kind) ? null : kind;
      updateActionsState(act.parentElement, msg);
      DS.saveConvos();
      DS.toast(msg.feedback === 'like' ? '感谢反馈' : (msg.feedback === 'dislike' ? '已记录，我们会改进' : '已取消'));
    } else if (kind === 'speak') {
      DS.tts.toggle(msg.content, msg.id);
    } else if (kind === 'more') {
      userMsgMenu(convo, msg);
    }
  }

  /** 自己发出的消息：复制 / 编辑重发 / 分享 / 删除 */
  function userMsgMenu(convo, msg) {
    if (!convo || !msg) return;
    openSheet(null, [
      { label: '复制', icon: 'copy', value: 'copy' },
      { label: '编辑并重新发送', icon: 'edit', value: 'edit' },
      { label: '分享', icon: 'share', value: 'share' },
      { label: '删除该消息及之后内容', icon: 'trash', value: 'delete', danger: true }
    ]).then(function (a) {
      if (!a) return;
      if (a.value === 'copy') {
        DS.copyText(msg.content || '');
      } else if (a.value === 'edit') {
        editUserMessage(convo, msg);
      } else if (a.value === 'share') {
        if (!nativeShare(msg.content || '')) DS.copyText(msg.content || '');
      } else if (a.value === 'delete') {
        var idx = convo.messages.indexOf(msg);
        if (idx < 0) return;
        convo.messages.splice(idx, convo.messages.length - idx);
        DS.saveConvos(true);
        showConvo(convo.id, { noScroll: true });
        DS.toast('已删除');
      }
    });
  }

  function regenerate(convo, msg) {
    if (S.busy) { DS.toast('正在生成中，请先停止'); return; }
    if (!convo) return;
    var idx = convo.messages.indexOf(msg);
    if (idx < 0) return;
    convo.messages.splice(idx, convo.messages.length - idx);
    DS.saveConvos(true);
    showConvo(convo.id, { noScroll: true });
    runCompletion(convo, {});
  }

  function editUserMessage(convo, msg) {
    if (S.busy) { DS.toast('正在生成中，请先停止'); return; }
    openDialog({ title: '编辑消息', input: msg.content || '', okText: '重新发送' }).then(function (v) {
      if (v === null || v === undefined) return;
      var idx = convo.messages.indexOf(msg);
      if (idx < 0) return;
      convo.messages.splice(idx, convo.messages.length - idx);
      convo.messages.push({
        id: DS.uid(),
        role: 'user',
        content: v,
        images: (msg.images || []).slice(),
        createdAt: Date.now()
      });
      DS.saveConvos(true);
      showConvo(convo.id, { noScroll: true });
      runCompletion(convo, {});
    });
  }

  /* ==================================================================
     输入区
     ================================================================== */

  function bindComposer() {
    var ta = E('input');
    ta.addEventListener('input', function () { autogrow(); updateComposer(); });
    ta.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        onSend();
      }
    });
    E('btn-send').addEventListener('click', onSend);
    E('chip-think').addEventListener('click', function () {
      DS.settings.thinking = !DS.settings.thinking;
      DS.saveSettings();
      syncChips();
      DS.toast(DS.settings.thinking ? '已开启深度思考' : '已关闭深度思考', 1200);
    });
    E('chip-search').addEventListener('click', function () {
      DS.settings.webSearch = !DS.settings.webSearch;
      DS.saveSettings();
      syncChips();
      DS.toast(DS.settings.webSearch ? '已开启联网搜索' : '已关闭联网搜索', 1200);
    });
    E('btn-attach').addEventListener('click', function () { E('file-input').click(); });
    E('file-input').addEventListener('change', onFilesPicked);
    E('attach-preview').addEventListener('click', function (e) {
      var rm = e.target.closest('.rm');
      if (!rm) return;
      var i = parseInt(rm.getAttribute('data-i'), 10);
      S.pendingImages.splice(i, 1);
      renderAttachPreview();
      updateComposer();
    });
    // 语音输入已整体移除（部分机型识别服务不可靠），这里不再绑定麦克风
  }

  function autogrow() {
    var ta = E('input');
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }

  function updateComposer() {
    var hasText = E('input').value.trim().length > 0 || S.pendingImages.length > 0;
    E('btn-send').disabled = !S.busy && !hasText;
    E('composer').classList.toggle('busy', S.busy);
  }

  /** 未配置 API Key 时，把底部提示变成通往设置页的入口 */
  function updateApiHint() {
    var hint = E('composer-hint');
    if (!hint) return;
    if (DS.settings.apiKey) {
      hint.textContent = '内容由 AI 生成，请仔细甄别';
      hint.classList.remove('link');
      hint.onclick = null;
    } else {
      hint.textContent = '尚未配置 API Key · 点此前往设置';
      hint.classList.add('link');
      hint.onclick = function () { switchView('settings'); };
    }
  }

  function syncChips() {
    E('chip-think').setAttribute('aria-pressed', DS.settings.thinking ? 'true' : 'false');
    E('chip-search').setAttribute('aria-pressed', DS.settings.webSearch ? 'true' : 'false');
  }

  function onSend() {
    if (S.busy) { stopStreaming(); return; }
    var text = E('input').value.trim();
    if (!text && !S.pendingImages.length) return;
    doSend(text);
  }

  function doSend(text) {
    if (!(DS.settings.apiKey || '').trim()) {
      DS.toast('请先在设置中填写 API Key', 2200);
      switchView('settings');
      return;
    }
    var convo = DS.activeId ? DS.getConvo(DS.activeId) : null;
    if (!convo) convo = DS.newConvo();

    var msg = { id: DS.uid(), role: 'user', content: text, createdAt: Date.now() };
    if (S.pendingImages.length) msg.images = S.pendingImages.slice();
    convo.messages.push(msg);
    DS.autoTitle(convo, text || '图片');
    DS.touchConvo(convo.id);
    DS.saveConvos(true);

    E('input').value = '';
    autogrow();
    S.pendingImages = [];
    renderAttachPreview();
    updateComposer();

    showConvo(convo.id, { noScroll: true });
    scrollToBottom(true);
    runCompletion(convo, {});
  }

  function stopStreaming() {
    if (S.abort) {
      try { S.abort.abort(); } catch (e) { /* ignore */ }
    }
  }

  /* ==================================================================
     图片附件
     ================================================================== */

  function onFilesPicked(e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    var jobs = files.slice(0, 4).map(shrinkImage);
    Promise.all(jobs).then(function (list) {
      S.pendingImages = S.pendingImages.concat(list).slice(0, 6);
      renderAttachPreview();
      updateComposer();
      DS.toast('已添加 ' + list.length + ' 张图片');
    }).catch(function (err) {
      DS.toast('图片处理失败：' + (err && err.message ? err.message : err));
    });
  }

  /* 图片压缩
     视觉模型对长边 1568 以内的图分辨最好（再大也会被服务端缩回去）；
     之前压到 1280 + JPEG 0.86，截图里的小字和图表细节会糊，直接影响识图。
     PNG / WebP 走无损；但截图常常好几 MB，超预算就转高质量 JPEG
     （画布已经铺过白底，不会有透明变黑的问题）。 */
  var IMG_MAX_SIDE = 1568;
  var IMG_JPEG_Q = 0.92;
  var IMG_MAX_BYTES = 3.5 * 1024 * 1024;

  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type)) { reject(new Error('不是图片文件')); return; }
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('读取失败')); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('解码失败')); };
        img.onload = function () {
          try {
            var w = img.naturalWidth, h = img.naturalHeight;
            var scale = Math.min(1, IMG_MAX_SIDE / Math.max(w, h));
            w = Math.max(1, Math.round(w * scale));
            h = Math.max(1, Math.round(h * scale));
            var c = document.createElement('canvas');
            c.width = w; c.height = h;
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);

            var lossless = /png|webp|gif/i.test(file.type);
            var url = lossless ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', IMG_JPEG_Q);
            // base64 长度 × 0.75 ≈ 实际字节数
            if (url.length * 0.75 > IMG_MAX_BYTES) {
              url = c.toDataURL('image/jpeg', IMG_JPEG_Q);
            }
            resolve(url);
          } catch (err) { reject(err); }
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  function renderAttachPreview() {
    var box = E('attach-preview');
    if (!S.pendingImages.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    var html = '';
    for (var i = 0; i < S.pendingImages.length; i++) {
      html += '<div class="attach-thumb"><img src="' + S.pendingImages[i] + '" alt="">' +
        '<button class="rm" data-i="' + i + '">' + DS.iconHtml('close') + '</button></div>';
    }
    box.innerHTML = html;
    box.classList.remove('hidden');
  }

  /* ==================================================================
     生成流程
     ================================================================== */

  function lastUserText(convo, beforeIndex) {
    for (var i = beforeIndex - 1; i >= 0; i--) {
      if (convo.messages[i].role === 'user' && convo.messages[i].content) return convo.messages[i].content;
    }
    return '';
  }

  function runCompletion(convo, opts) {
    opts = opts || {};
    var msgIndex = convo.messages.length;

    var msg = {
      id: DS.uid(),
      role: 'assistant',
      content: '',
      reasoning: '',
      createdAt: Date.now(),
      model: DS.effectiveModel(),
      thinking: !!DS.settings.thinking
    };
    convo.messages.push(msg);

    var nodes = createAssistantNodes(msg);
    E('messages').appendChild(nodes.el);
    E('hero').classList.add('hidden');

    S.busy = true;
    S.abort = new AbortController();
    updateComposer();

    var st = {
      convoId: convo.id,
      msg: msg,
      nodes: nodes,
      streaming: true,
      reasoningStart: 0,
      contentStarted: false,
      keepWorking: false,
      results: null,
      searchQuery: ''
    };
    S.stream = st;

    setWorking(nodes, '正在思考…');
    scrollToBottom(true);

    var chain = Promise.resolve();

    if (DS.settings.webSearch) {
      chain = chain.then(function () {
        var q = lastUserText(convo, msgIndex);
        if (!q) return null;
        // 先让模型判断要不要搜、该用什么关键词。
        // 直接拿整句话当搜索词是搜不准的主因，而且开关一开就每句都搜。
        setWorking(nodes, '正在规划检索…');
        return DS.search.plan(q, { signal: S.abort.signal }).then(function (plan) {
          if (!plan.need || !plan.queries.length) {
            // 判定不需要联网就静默跳过，不弹任何提示 ——
            // 用户开着搜索开关，每句都告诉他「这次没搜」纯属打扰。
            setWorking(nodes, null);
            return null;
          }
          st.searchQuery = plan.queries.join(' / ');
          setWorking(nodes, '正在搜索：' + plan.queries[0] +
            (plan.queries.length > 1 ? ' 等 ' + plan.queries.length + ' 条' : ''));

          // 多轮但封顶：默认最多 2 轮、总共 6 条，搜太久比搜不准更难受
          return DS.search.runMulti(plan.queries, {
            maxRounds: 2, perQuery: 4, maxTotal: 6
          }).then(function (list) {
            st.searchAttempted = true;
            // 先筛掉明显不相关的：把导航页、聚合站塞给模型比不给更糟
            var relevant = DS.search.filterRelevant(list, plan.queries);
            st.results = relevant;
            msg.sources = relevant;
            st.keepWorking = true;
            paintStream();
            setWorking(nodes, relevant.length
              ? ('已检索到 ' + relevant.length + ' 个相关网页')
              : '没找到相关网页');
            return relevant;
          });
        }).catch(function (e) {
          setWorking(nodes, null);
          if (DS.isAbort(e)) return null;
          DS.toast('联网搜索失败：' + (e && e.message ? e.message : e), 2600);
          return null;
        });
      });
    }

    chain.then(function () {
      var apiMessages = DS.buildApiMessages(convo, msgIndex);
      // 只要真的尝试过检索就注入说明 —— 包括「一条相关的都没找到」，
      // 那种情况更要讲清楚，否则模型会当作没这回事。
      if (st.searchAttempted) {
        var ctx = DS.search.buildContext(st.searchQuery, st.results || []);
        var at = Math.max(0, apiMessages.length - 1);
        apiMessages.splice(at, 0, { role: 'system', content: ctx });
      }
      return DS.api.chat({
        messages: apiMessages,
        model: msg.model,
        thinking: msg.thinking,
        signal: S.abort.signal,
        onReasoning: function (d, full) {
          if (!st.reasoningStart) st.reasoningStart = Date.now();
          msg.reasoning = full;
          msg.reasoningMs = Date.now() - st.reasoningStart;
          if (!st.keepWorking && !st.contentStarted) setWorking(nodes, '正在深度思考…');
          schedulePaint();
        },
        onContent: function (d, full) {
          if (!st.contentStarted) {
            st.contentStarted = true;
            if (st.reasoningStart) msg.reasoningMs = Date.now() - st.reasoningStart;
          }
          msg.content = full;
          if (!st.keepWorking) setWorking(nodes, null);
          schedulePaint();
        },
        onUsage: function (u) { msg.usage = u; }
      });
    }).then(function (acc) {
      st.streaming = false;
      msg.finishReason = acc.finishReason;
      if (!msg.content) {
        msg.error = msg.reasoning
          ? '模型只返回了思考过程，没有输出最终答案'
          : '接口没有返回任何内容，请检查模型名是否正确';
      }
      finalizeStream(st);
      afterCompletion(convo);
    }).catch(function (err) {
      st.streaming = false;
      if (DS.isAbort(err)) {
        msg.stopped = true;
        if (!msg.content && !msg.reasoning) msg.error = '已停止生成';
      } else {
        msg.error = (err && err.message) ? err.message : String(err);
      }
      finalizeStream(st);
      afterCompletion(convo);
    });
  }

  function finalizeStream(st) {
    var msg = st.msg, n = st.nodes;
    if (n && n.el && n.el.isConnected) {
      setWorking(n, null);

      if (msg.reasoning) {
        n.think.classList.remove('hidden');
        n.thinkBody.textContent = msg.reasoning;
        n.thinkLabel.textContent = '已深度思考（用时 ' + DS.fmtDuration(msg.reasoningMs || 0) + '）';
        n.think.classList.remove('open');
      } else {
        n.think.classList.add('hidden');
      }

      if (msg.sources && msg.sources.length && n.sources.classList.contains('hidden')) {
        fillSources(n.sources, msg.sources);
      }

      renderFinalMd(n.md, msg);

      if (msg.error) {
        n.err.classList.remove('hidden');
        n.errText.textContent = msg.error;
      } else {
        n.err.classList.add('hidden');
      }

      n.actions.classList.remove('hidden');
      updateActionsState(n.actions, msg);
      DS.hydrateIcons(n.el);
      // 自动朗读：只在真正有正文、且没出错时触发
      if (DS.settings.autoRead && msg.content && !msg.error) {
        DS.tts.speak(msg.content, msg.id);
      }
    }
    if (S.pinned) scrollToBottom();
  }

  function afterCompletion(convo) {
    S.busy = false;
    S.abort = null;
    S.stream = null;
    updateComposer();
    DS.touchConvo(convo.id);
    DS.saveConvos(true);
    renderConvList();
    if (DS.activeId === convo.id) syncTitle();
  }

  /* ==================================================================
     Hero 建议
     ================================================================== */

  function buildChips() {
    // 长期记忆里有模型给的「下一步建议」就优先用它 ——
    // 没有记忆（新装/清空过）时再退回写死的通用建议
    var learned = (DS.memory && DS.memory.suggestions()) || [];
    var pool, learnedMode = learned.length > 0;

    if (learnedMode) {
      pool = learned.slice();
      // 记忆建议通常只有 3 条，凑不满就补两条通用的
      var filler = SUGGESTIONS.slice();
      while (pool.length < 4 && filler.length) {
        pool.push(filler.splice(Math.floor(Math.random() * filler.length), 1)[0]);
      }
    } else {
      pool = SUGGESTIONS.slice();
    }

    var picked = [];
    while (picked.length < 4 && pool.length) {
      picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }

    var html = '';
    for (var i = 0; i < picked.length; i++) {
      var fromMemory = learnedMode && learned.indexOf(picked[i]) > -1;
      html += '<button class="hero-chip' + (fromMemory ? ' from-memory' : '') +
        '" data-text="' + DS.escapeHtml(picked[i]) + '">' +
        DS.escapeHtml(picked[i]) + '</button>';
    }
    E('hero-chips').innerHTML = html;
  }

  function bindMisc() {
    E('hero-chips').addEventListener('click', function (e) {
      var chip = e.target.closest('.hero-chip');
      if (!chip) return;
      E('input').value = chip.getAttribute('data-text');
      autogrow();
      updateComposer();
      try { E('input').focus(); } catch (err) { /* ignore */ }
    });

    E('lightbox').addEventListener('click', closeLightbox);

    window.addEventListener('resize', function () {
      if (S.view === 'chat' && S.pinned) requestAnimationFrame(function () { scrollToBottom(true); });
    });

    try {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onMq = function () { if ((DS.settings.theme || 'system') === 'system') applyTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
      else if (mq.addListener) mq.addListener(onMq);
    } catch (e) { /* ignore */ }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) DS.saveConvos(true);
    });
  }

  function openLightbox(src) {
    E('lightbox-img').src = src;
    E('lightbox').classList.remove('hidden');
  }

  function closeLightbox() {
    E('lightbox').classList.add('hidden');
    E('lightbox-img').src = '';
  }

  /* ==================================================================
     设置页
     ================================================================== */

  function fillModelSelect() {
    var sel = E('set-model');
    var models = (DS.settings.models || []).slice();
    var cur = DS.settings.model || '';
    if (cur && models.indexOf(cur) < 0) models.unshift(cur);
    if (!models.length) models = ['deepseek-flash', 'deepseek-v4-pro'];
    var html = '';
    for (var i = 0; i < models.length; i++) {
      html += '<option value="' + DS.escapeHtml(models[i]) + '">' + DS.escapeHtml(models[i]) + '</option>';
    }
    sel.innerHTML = html;
    if (cur) sel.value = cur;
  }

  function markSegmented(id, value) {
    var box = E(id);
    if (!box) return;
    DS.$$('button', box).forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-v') === String(value));
    });
  }

  /* ==================================================================
     服务商：多套 API 配置，一键切换
     ================================================================== */

  function providerHost(p) {
    try { return new URL(p.baseUrl).hostname || p.baseUrl || '未填写地址'; }
    catch (e) { return p.baseUrl || '未填写地址'; }
  }

  function renderProviderList() {
    var box = E('provider-list');
    if (!box) return;
    var list = DS.settings.providers || [];
    if (!list.length) {
      box.innerHTML = '<div class="provider-empty">还没有服务商，点下面的按钮添加</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var active = p.id === DS.settings.activeProviderId;
      var bits = [providerHost(p)];
      if (p.model) bits.push(p.model);
      if (p.format === 'anthropic') bits.push('Anthropic');
      if (!p.apiKey) bits.push('未填 Key');
      html += '<button class="provider-item' + (active ? ' active' : '') +
        '" data-pid="' + p.id + '">' +
        '<span class="provider-check">' + DS.iconHtml('check') + '</span>' +
        '<span class="provider-main">' +
        '<span class="provider-name">' + DS.escapeHtml(p.name || '未命名') + '</span>' +
        '<span class="provider-sub">' + DS.escapeHtml(bits.join(' · ')) + '</span>' +
        '</span>' +
        '<span class="provider-edit" data-edit="1">' + DS.iconHtml('more') + '</span>' +
        '</button>';
    }
    box.innerHTML = html;
  }

  /** 任何影响接口的改动都同步回当前服务商条目 */
  function afterConfigChange() {
    DS.syncToProvider();
    renderProviderList();
  }

  function switchProvider(id) {
    if (id === DS.settings.activeProviderId) return;
    if (!DS.applyProvider(id)) return;
    syncSettingsUI();
    renderProviderList();
    var p = DS.getProvider(id);
    DS.toast('已切换到「' + (p ? p.name : '服务商') + '」', 1600);
  }

  function providerMenu(id) {
    var p = DS.getProvider(id);
    if (!p) return;
    openSheet(p.name, [
      { label: '设为当前使用', icon: 'check', value: 'activate' },
      { label: '重命名', icon: 'edit', value: 'rename' },
      { label: '删除', icon: 'trash', value: 'delete', danger: true }
    ]).then(function (a) {
      if (!a) return;
      if (a.value === 'activate') {
        switchProvider(id);
      } else if (a.value === 'rename') {
        openDialog({ title: '重命名服务商', input: p.name, okText: '保存' }).then(function (v) {
          if (v) { p.name = v; DS.saveSettings(); renderProviderList(); }
        });
      } else if (a.value === 'delete') {
        openDialog({
          title: '删除服务商',
          desc: '「' + p.name + '」及其地址、Key、模型设置都会被删除。',
          okText: '删除',
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          var wasActive = DS.settings.activeProviderId === id;
          DS.removeProvider(id);
          if (wasActive) syncSettingsUI();
          renderProviderList();
          DS.toast('已删除');
        });
      }
    });
  }

  function addProviderFlow() {
    var presets = DS.PROVIDER_PRESETS || [];
    var items = presets.map(function (ps) {
      return { label: ps.name, icon: ps.key === 'custom' ? 'edit' : 'globe', value: ps.key };
    });
    openSheet('选择服务商', items).then(function (a) {
      if (!a) return;
      var preset = null;
      for (var i = 0; i < presets.length; i++) {
        if (presets[i].key === a.value) preset = presets[i];
      }
      if (!preset) return;
      var p = DS.addProvider(preset);
      DS.applyProvider(p.id);
      syncSettingsUI();
      renderProviderList();
      DS.toast(preset.key === 'custom'
        ? '已添加，请填写接口地址与 API Key'
        : ('已添加「' + p.name + '」，请填写 API Key'), 2400);
    });
  }

  function bindProviders() {
    var list = E('provider-list');
    if (list) {
      list.addEventListener('click', function (e) {
        if (consumeDrag()) return;
        var item = e.target.closest('.provider-item');
        if (!item) return;
        var id = item.getAttribute('data-pid');
        if (e.target.closest('.provider-edit')) { providerMenu(id); return; }
        switchProvider(id);
      });
    }
    var addBtn = E('btn-add-provider');
    if (addBtn) addBtn.addEventListener('click', addProviderFlow);

    // 改了地址 / Key / 模型就写回当前服务商
    ['set-key', 'set-base', 'set-model', 'set-model-custom', 'set-format'].forEach(function (id) {
      var el = E(id);
      if (!el) return;
      el.addEventListener('change', afterConfigChange);
      el.addEventListener('input', DS.debounce(afterConfigChange, 520));
    });

    // 下拉是点选，change 立刻生效更跟手；顺便给个反馈，
    // 不然用户改完不知道到底存没存
    E('set-format').addEventListener('change', function (e) {
      var isAnthropic = e.target.value === 'anthropic';
      DS.settings.apiFormat = isAnthropic ? 'anthropic' : 'openai';
      DS.saveSettings();
      // afterConfigChange 挂得比这里早，它跑的时候 settings 还是旧值，
      // 所以这里得再同步一次，否则服务商那头拿到的还是上一个格式
      afterConfigChange();
      DS.toast(isAnthropic
        ? '接口格式：Anthropic（x-api-key）'
        : '接口格式：OpenAI 兼容（Bearer）', 2000);
    });
  }

  /** 朗读能力探测：没有 TTS 引擎就把相关按钮禁用 */
  function updateVoiceHint() {
    var ttsOk = DS.tts.available();
    var prev = E('btn-voice-preview');
    if (prev) prev.disabled = !ttsOk;
    var refresh = E('btn-voice-refresh');
    if (refresh) refresh.disabled = !ttsOk;
    var hint = E('voice-hint');
    if (hint && !ttsOk) hint.textContent = '本机没有可用的朗读引擎（系统「文字转语音」未安装）';
    if (ttsOk) DS.tts.init();
  }

  /** 长期记忆列表：最多显示 30 条，每条可以单删 */
  function renderMemoryList() {
    var box = E('mem-list');
    if (!box) return;
    var items = DS.memory.all().slice().sort(function (a, b) {
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    var label = E('mem-count');
    if (label) label.textContent = items.length ? (items.length + ' 条') : '还没有';

    if (!items.length) {
      box.innerHTML = '<div class="mem-empty">还没有长期记忆。<br>' +
        '转生时自动提取，或点上面的「从当前对话提取」。</div>';
      return;
    }
    var KIND_LABEL = {
      profile: '画像', preference: '偏好', project: '项目',
      todo: '待办', fact: '事实'
    };
    var html = '';
    var show = items.slice(0, 30);
    for (var i = 0; i < show.length; i++) {
      var it = show[i];
      html += '<div class="mem-item" data-id="' + DS.escapeHtml(it.id) + '">' +
        '<span class="mem-kind">' + DS.escapeHtml(KIND_LABEL[it.kind] || '事实') + '</span>' +
        '<span class="mem-text">' + DS.escapeHtml(it.text) + '</span>' +
        '<button class="mem-del" aria-label="删除">' + DS.iconHtml('trash') + '</button>' +
        '</div>';
    }
    if (items.length > show.length) {
      html += '<div class="mem-empty">还有 ' + (items.length - show.length) + ' 条未显示</div>';
    }
    box.innerHTML = html;
    DS.hydrateIcons(box);
  }

  function bindMemoryList() {
    var box = E('mem-list');
    if (!box) return;
    box.addEventListener('click', function (e) {
      var del = e.target.closest('.mem-del');
      if (!del) return;
      var row = del.closest('.mem-item');
      if (!row) return;
      DS.memory.remove(row.getAttribute('data-id'));
      renderMemoryList();
      buildChips();
    });
  }

  /* ---------------- 启动图标 ----------------
     两条路：
     1) 内置 4 套 —— 走 activity-alias，是真正的桌面图标切换
     2) 本地图片 —— 作为应用内形象，并可用 ShortcutManager 钉到桌面
        （Android 不允许运行时替换 launcher 图标的位图，资源是编译期固定的，
          所以自定义图片只能这么落地，所有图标修改器应用都是这个做法） */

  var APP_ICONS = [
    { key: 'pixel', label: '像素鲸鱼', src: 'assets/icon-pixel.png' },
    { key: 'maid', label: '鲸娘女仆', src: 'assets/splash-char.png' }
  ];

  var MAX_CUSTOM_ICONS = 8;

  function customIcons() {
    var l = DS.settings.customIcons;
    return (l && l.length) ? l : [];
  }

  function findCustom(id) {
    var l = customIcons();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }

  /** 当前生效的开屏形象：'custom:<id>' / 内置 key / 默认第一张 */
  function currentIconKey() {
    if (DS.settings.customLogo && findCustom(DS.settings.customLogo)) {
      return 'custom:' + DS.settings.customLogo;
    }
    var art = DS.settings.splashArt || '';
    for (var i = 0; i < APP_ICONS.length; i++) if (APP_ICONS[i].key === art) return art;
    return APP_ICONS[0].key;   // 没选过 = 用默认那张，界面上也该高亮它
  }

  /** 开屏该显示哪张图：自定义 > 指定形象 > 默认像素鲸鱼 */
  function mascotFor(scheme) {
    var c = DS.settings.customLogo ? findCustom(DS.settings.customLogo) : null;
    if (c) return c.data;
    var art = DS.settings.splashArt || '';
    for (var i = 0; i < APP_ICONS.length; i++) {
      if (APP_ICONS[i].key === art) return APP_ICONS[i].src;
    }
    return APP_ICONS[0].src;
  }

  function renderIconPicker() {
    var box = E('icon-picker');
    if (!box) return;
    var cur = currentIconKey();

    // 每格是「一个 div 容器 + 里面的独立按钮」。
    // 之前把删除角标做成 <button> 里的 <i>，属于嵌套可交互元素，
    // 真机 WebView 上点击归属不可靠 —— 拆成并列按钮就没这个问题了。
    function tile(key, label, imgHtml, deletable) {
      var on = (key === cur) ? ' on' : '';
      return '<div class="icon-opt' + on + '">' +
        '<button class="icon-pick" data-v="' + key + '" aria-label="' + DS.escapeHtml(label) + '">' +
        imgHtml + '<span>' + DS.escapeHtml(label) + '</span></button>' +
        (deletable
          ? '<button class="icon-del" data-del="' + deletable + '" aria-label="删除">' +
            DS.iconHtml('trash') + '</button>'
          : '') +
        '</div>';
    }

    var html = '';
    for (var i = 0; i < APP_ICONS.length; i++) {
      var it = APP_ICONS[i];
      html += tile(it.key, it.label,
        '<img src="' + it.src + '" alt=""' +
        (it.key === 'pixel' ? ' style="image-rendering:pixelated"' : '') + '>');
    }

    var customs = customIcons();
    for (var j = 0; j < customs.length; j++) {
      var c = customs[j];
      html += tile('custom:' + c.id, c.name || '自定义',
        '<img src="' + c.data + '" alt="">', c.id);
    }

    if (customs.length < MAX_CUSTOM_ICONS) {
      html += '<div class="icon-opt">' +
        '<button class="icon-pick icon-add" data-v="__add">' +
        '<span class="icon-add-box">+</span><span>本地图片</span></button></div>';
    }

    box.innerHTML = html;
    DS.hydrateIcons(box);
  }

  /** 把本地图片压到指定边长，返回 data URL */
  function downscaleImage(file, max, cb) {
    var reader = new FileReader();
    reader.onerror = function () { cb(null); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { cb(null); };
      img.onload = function () {
        try {
          var w = img.width || 1, h = img.height || 1;
          var k = Math.min(1, max / Math.max(w, h));
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(w * k));
          cv.height = Math.max(1, Math.round(h * k));
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          cb(cv.toDataURL('image/png'));
        } catch (e) { cb(null); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function addCustomIcon(file) {
    downscaleImage(file, 512, function (data) {
      if (!data) { DS.toast('这张图读不出来', 2200); return; }
      var list = customIcons().slice();
      if (list.length >= MAX_CUSTOM_ICONS) {
        DS.toast('最多存 ' + MAX_CUSTOM_ICONS + ' 张，先删掉几张', 2600);
        return;
      }
      var item = {
        id: DS.uid(),
        name: String(file.name || '自定义').replace(/\.[^.]+$/, '').slice(0, 8),
        data: data
      };
      list.push(item);
      DS.settings.customIcons = list;
      DS.settings.customLogo = item.id;
      DS.saveSettings();
      applyScheme();
      renderIconPicker();
      DS.toast('已应用为应用内形象；想放桌面就点「钉到桌面」', 3000);
    });
  }

  function bindIconPicker() {
    var box = E('icon-picker');
    var input = E('icon-input');
    if (!box) return;

    if (input) {
      input.addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (f) addCustomIcon(f);
      });
    }

    box.addEventListener('click', function (e) {
      // 删除角标优先，别让它触发选中
      var del = e.target.closest('.icon-del');
      if (del) {
        e.stopPropagation();
        var id = del.getAttribute('data-del');
        var item = findCustom(id);
        openDialog({
          title: '删除这张自定义图标？',
          desc: (item && item.name) ? ('「' + item.name + '」') : '',
          okText: '删除',
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          DS.settings.customIcons = customIcons().filter(function (x) { return x.id !== id; });
          if (DS.settings.customLogo === id) DS.settings.customLogo = '';
          DS.saveSettings();
          applyScheme();
          renderIconPicker();
        });
        return;
      }

      var b = e.target.closest('.icon-pick');
      if (!b) return;
      var key = b.getAttribute('data-v');

      if (key === '__add') {
        if (!input) { DS.toast('这个环境不支持选图', 2000); return; }
        input.click();
        return;
      }

      if (key.indexOf('custom:') === 0) {
        DS.settings.customLogo = key.slice(7);
        DS.settings.splashArt = '';
      } else {
        DS.settings.splashArt = key;
        DS.settings.customLogo = '';
      }
      DS.saveSettings();
      // 让原生启动开屏也跟着换（自定义图暂时回落到像素鲸鱼）
      try {
        if (window.AndroidBridge && AndroidBridge.setSplashArt) {
          AndroidBridge.setSplashArt(DS.settings.customLogo ? 'pixel' : DS.settings.splashArt);
        }
      } catch (err) { /* ignore */ }
      applyScheme();
      renderIconPicker();
      DS.toast(key === '__theme' ? '开屏形象将跟随主题' : '已换开屏形象', 1800);
    });
  }

  function syncSettingsUI() {
    E('set-key').value = DS.settings.apiKey || '';
    E('set-base').value = DS.settings.baseUrl || '';
    E('set-model-custom').value = DS.settings.modelCustom || '';
    E('set-format').value = DS.settings.apiFormat || 'openai';
    E('set-think').checked = !!DS.settings.thinking;
    E('set-effort').value = DS.settings.effort || '';
    E('set-temp').value = DS.settings.temperature;
    E('val-temp').textContent = Number(DS.settings.temperature || 0).toFixed(1);
    E('set-maxtok').value = DS.settings.maxTokens || '';
    E('set-sysprompt').value = DS.settings.systemPrompt || '';
    E('set-websearch').checked = !!DS.settings.webSearch;
    E('set-search-provider').value = DS.settings.searchProvider || 'duckduckgo';
    E('set-tavily-key').value = DS.settings.tavilyKey || '';
    fillModelSelect();
    markSegmented('seg-scheme', DS.settings.scheme || 'blue');
    markSegmented('seg-theme', DS.settings.theme || 'system');
    markSegmented('seg-font', DS.settings.fontScale || 1);
    markSegmented('seg-typeface', DS.settings.fontFamily || 'system');
    markSegmented('seg-density', DS.settings.density || 'cozy');
    E('set-oled').checked = !!DS.settings.oledBlack;
    E('set-autoread').checked = !!DS.settings.autoRead;
    E('set-automem').checked = DS.settings.autoMemory !== false;
    E('set-mem-on').checked = DS.settings.memoryEnabled !== false;
    var budget = DS.settings.memoryBudget || 900;
    E('mem-budget-val').textContent = (DS.settings.memoryLimit || 8) + ' 条 / ' + budget + ' 字';
    var segs = E('seg-membudget').querySelectorAll('button');
    for (var bi = 0; bi < segs.length; bi++) {
      segs[bi].classList.toggle('on', Number(segs[bi].getAttribute('data-v')) === budget);
    }
    var cost = E('mem-cost');
    if (cost) {
      var lb = DS.memory.lastBlockSize();
      cost.textContent = lb.count
        ? ('上次实际注入 ' + lb.count + ' 条 / ' + lb.chars + ' 字')
        : '还没注入过';
    }
    renderMemoryList();
    renderIconPicker();
    E('set-voice').value = DS.settings.ttsVoice || '';
    E('set-rate').value = DS.settings.ttsRate || 1;
    E('val-rate').textContent = Number(DS.settings.ttsRate || 1).toFixed(1) + '×';
    E('set-pitch').value = DS.settings.ttsPitch || 1;
    E('val-pitch').textContent = Number(DS.settings.ttsPitch || 1).toFixed(1);
    renderAccentRow();
    E('about-ver').textContent = 'v' + APP_VERSION;
    E('foot-ver').textContent = 'DeepSleep · v' + APP_VERSION;
    renderProviderList();
  }

  function bindSettings() {
    E('btn-advanced').addEventListener('click', function () { switchView('advanced'); });
    E('set-key').addEventListener('change', function (e) {
      DS.settings.apiKey = e.target.value.trim();
      DS.saveSettings();
      updateApiHint();
    });
    E('set-base').addEventListener('change', function (e) {
      DS.settings.baseUrl = e.target.value.trim() || 'https://api.deepseek.com';
      e.target.value = DS.settings.baseUrl;
      DS.saveSettings();
    });
    E('set-model').addEventListener('change', function (e) {
      DS.settings.model = e.target.value;
      DS.settings.modelCustom = '';
      E('set-model-custom').value = '';
      DS.saveSettings();
    });
    E('set-model-custom').addEventListener('change', function (e) {
      DS.settings.modelCustom = e.target.value.trim();
      DS.saveSettings();
      DS.toast(DS.settings.modelCustom ? ('将使用模型 ' + DS.settings.modelCustom) : '已恢复使用所选模型');
    });
    E('set-think').addEventListener('change', function (e) {
      DS.settings.thinking = e.target.checked;
      DS.saveSettings();
      syncChips();
    });
    E('set-effort').addEventListener('change', function (e) {
      DS.settings.effort = e.target.value;
      DS.saveSettings();
    });
    E('set-temp').addEventListener('input', function (e) {
      E('val-temp').textContent = Number(e.target.value).toFixed(1);
    });
    E('set-temp').addEventListener('change', function (e) {
      DS.settings.temperature = Number(e.target.value);
      DS.saveSettings();
    });
    E('set-maxtok').addEventListener('change', function (e) {
      var v = parseInt(e.target.value, 10);
      DS.settings.maxTokens = (isNaN(v) || v <= 0) ? null : v;
      e.target.value = DS.settings.maxTokens || '';
      DS.saveSettings();
    });
    E('set-sysprompt').addEventListener('change', function (e) {
      DS.settings.systemPrompt = e.target.value;
      DS.saveSettings();
    });
    E('set-websearch').addEventListener('change', function (e) {
      DS.settings.webSearch = e.target.checked;
      DS.saveSettings();
      syncChips();
    });
    E('set-search-provider').addEventListener('change', function (e) {
      DS.settings.searchProvider = e.target.value;
      DS.saveSettings();
    });
    E('set-tavily-key').addEventListener('change', function (e) {
      DS.settings.tavilyKey = e.target.value.trim();
      DS.saveSettings();
    });

    // 输入过程中也自动保存：部分输入法 / 机型在收起键盘时不触发 change，
    // 会出现「填了 API Key 却没保存」的情况
    [
      ['set-key', function (v) { DS.settings.apiKey = v.trim(); updateApiHint(); }],
      ['set-base', function (v) { DS.settings.baseUrl = v.trim() || 'https://api.deepseek.com'; }],
      ['set-model-custom', function (v) { DS.settings.modelCustom = v.trim(); }],
      // 这个以前漏了：下拉改完只调到 provider，没写回 settings，
      // 于是手工切 OpenAI / Anthropic 切走再回来就被 provider 的旧值覆盖。
      ['set-format', function (v) { DS.settings.apiFormat = (v === 'anthropic') ? 'anthropic' : 'openai'; }],
      ['set-sysprompt', function (v) { DS.settings.systemPrompt = v; }],
      ['set-tavily-key', function (v) { DS.settings.tavilyKey = v.trim(); }],
      ['set-maxtok', function (v) {
        var n = parseInt(v, 10);
        DS.settings.maxTokens = (isNaN(n) || n <= 0) ? null : n;
      }]
    ].forEach(function (pair) {
      var el = E(pair[0]);
      if (!el) return;
      el.addEventListener('input', DS.debounce(function () {
        pair[1](el.value);
        DS.saveSettings();
      }, 450));
    });

    E('btn-key-eye').addEventListener('click', function () {
      var inp = E('set-key');
      var show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      E('btn-key-eye').textContent = show ? '隐藏' : '显示';
    });

    E('btn-load-models').addEventListener('click', function () {
      var hint = E('models-hint');
      hint.textContent = '正在拉取…';
      DS.api.listModels().then(function (ids) {
        DS.settings.models = ids;
        if (ids.indexOf(DS.settings.model) < 0) DS.settings.model = ids[0];
        DS.saveSettings();
        fillModelSelect();
        afterConfigChange();
        hint.textContent = '已获取 ' + ids.length + ' 个模型';
        DS.toast('已获取 ' + ids.length + ' 个模型');
      }).catch(function (e) {
        hint.textContent = '拉取失败：' + (e && e.message ? e.message : e);
        DS.toast('拉取失败');
      });
    });

    /* ---------------- 长期记忆 ---------------- */

    bindMemoryList();
    bindIconPicker();

    E('btn-mem-extract').addEventListener('click', function () {
      var convo = DS.activeId ? DS.getConvo(DS.activeId) : null;
      if (!convo || !convo.messages.length) { DS.toast('当前对话还是空的', 2000); return; }
      DS.toast('正在提取长期记忆…', 1600);
      var btn = E('btn-mem-extract');
      btn.disabled = true;
      DS.memory.extract(convo).then(function (r) {
        if (r.skipped) DS.toast('没有可提取的内容', 2000);
        else if (r.parseFailed) DS.toast('没能解析出结构化记忆，已按纯文本记下', 2800);
        else if (!r.added && !r.merged) DS.toast('这次没有值得长期记住的内容', 2400);
        else DS.toast('新增 ' + r.added + ' 条，合并 ' + r.merged + ' 条', 2400);
        renderMemoryList();
      }).catch(function (e) {
        DS.toast('提取失败：' + (e && e.message ? e.message : e), 2600);
      }).then(function () { btn.disabled = false; });
    });

    E('set-automem').addEventListener('change', function (e) {
      DS.settings.autoMemory = e.target.checked;
      DS.saveSettings();
    });

    E('set-mem-on').addEventListener('change', function (e) {
      DS.settings.memoryEnabled = e.target.checked;
      DS.saveSettings();
      renderMemoryList();
      DS.toast(e.target.checked ? '长期记忆已启用' : '长期记忆已关闭，不会再读写', 2400);
    });

    E('seg-membudget').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var budget = Number(b.getAttribute('data-v'));
      DS.settings.memoryBudget = budget;
      DS.settings.memoryLimit = budget <= 500 ? 5 : (budget <= 900 ? 8 : 12);
      DS.saveSettings();
      syncSettingsUI();
      DS.toast('单次最多注入 ' + DS.settings.memoryLimit + ' 条 / ' + budget + ' 字', 2400);
    });

    E('btn-mem-clear').addEventListener('click', function () {
      if (!DS.memory.count()) { DS.toast('本来就是空的', 1600); return; }
      openDialog({
        title: '清空全部长期记忆？',
        desc: '共 ' + DS.memory.count() + ' 条，清空后无法恢复。',
        okText: '清空',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        DS.memory.clear();
        renderMemoryList();
        buildChips();
        DS.toast('已清空长期记忆', 2000);
      });
    });

    E('seg-scheme').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      DS.settings.scheme = b.getAttribute('data-v');
      DS.saveSettings();
      markSegmented('seg-scheme', DS.settings.scheme);
      applyScheme();
      applyTheme();
      DS.toast('已切换到' + (SCHEMES[DS.settings.scheme] || SCHEMES.blue).label, 1400);
    });

    E('accent-row').addEventListener('click', function (e) {
      var b = e.target.closest('.accent-dot');
      if (!b) return;
      DS.settings.accentColor = b.getAttribute('data-v') || '';
      DS.saveSettings();
      applyAccent();
      DS.toast(DS.settings.accentColor
        ? ('强调色 ' + DS.settings.accentColor.toUpperCase())
        : '强调色已跟随主题', 1400);
    });

    E('set-oled').addEventListener('change', function (e) {
      DS.settings.oledBlack = e.target.checked;
      // 纯黑样式只挂在深色上（[data-oled=1][data-theme=dark]），
      // 在浅色下开启的话肉眼毫无变化，用户会以为「点了没反应」——
      // 所以顺手把明暗模式切成深色，让这次点击立刻可见。
      if (DS.settings.oledBlack && !isDark()) {
        DS.settings.theme = 'dark';
        DS.saveSettings();
        applyOled();
        applyTheme();
        syncSettingsUI();
        DS.toast('已开启纯黑模式，并切换到深色', 2200);
        return;
      }
      DS.saveSettings();
      applyOled();
      applyTheme();
      DS.toast(DS.settings.oledBlack ? '已开启纯黑模式' : '已关闭纯黑模式', 1800);
    });

    /* ---------------- 朗读 ---------------- */

    E('btn-voice-refresh').addEventListener('click', function () {
      if (!DS.tts.available()) { DS.toast('当前设备没有可用的朗读引擎'); return; }
      DS.tts.refreshVoices();
      DS.toast('正在读取系统音色…', 1200);
    });

    E('btn-voice-preview').addEventListener('click', function () {
      if (!DS.tts.available()) { DS.toast('当前设备没有可用的朗读引擎'); return; }
      DS.tts.preview();
    });

    E('set-voice').addEventListener('change', function (e) {
      DS.settings.ttsVoice = e.target.value;
      DS.saveSettings();
      DS.tts.applySettings();
    });

    E('set-rate').addEventListener('input', function (e) {
      E('val-rate').textContent = Number(e.target.value).toFixed(1) + '×';
    });
    E('set-rate').addEventListener('change', function (e) {
      DS.settings.ttsRate = Number(e.target.value);
      DS.saveSettings();
      DS.tts.applySettings();
    });

    E('set-pitch').addEventListener('input', function (e) {
      E('val-pitch').textContent = Number(e.target.value).toFixed(1);
    });
    E('set-pitch').addEventListener('change', function (e) {
      DS.settings.ttsPitch = Number(e.target.value);
      DS.saveSettings();
      DS.tts.applySettings();
    });

    E('set-autoread').addEventListener('change', function (e) {
      DS.settings.autoRead = e.target.checked;
      DS.saveSettings();
      if (!e.target.checked) DS.tts.stop();
    });

    E('seg-typeface').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      DS.settings.fontFamily = b.getAttribute('data-v');
      DS.saveSettings();
      markSegmented('seg-typeface', DS.settings.fontFamily);
      applyTypeface();
    });

    E('seg-density').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      DS.settings.density = b.getAttribute('data-v');
      DS.saveSettings();
      markSegmented('seg-density', DS.settings.density);
      applyDensity();
      if (S.pinned) requestAnimationFrame(function () { scrollToBottom(true); });
    });

    E('seg-theme').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      DS.settings.theme = b.getAttribute('data-v');
      DS.saveSettings();
      markSegmented('seg-theme', DS.settings.theme);
      applyTheme();
    });

    E('seg-font').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      DS.settings.fontScale = Number(b.getAttribute('data-v')) || 1;
      DS.saveSettings();
      markSegmented('seg-font', DS.settings.fontScale);
      applyFont();
    });

    E('btn-test').addEventListener('click', testConnection);

    E('btn-export').addEventListener('click', function () {
      var json = DS.exportData();
      var name = 'deepsleep-chats-' + new Date().toISOString().slice(0, 10) + '.json';
      var saved = saveTextFile(name, json);
      if (saved) { DS.toast('已导出到 ' + saved, 2600); return; }
      try {
        var blob = new Blob([json], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
        DS.toast('已导出 ' + DS.convos.length + ' 个对话');
      } catch (e) {
        DS.toast('导出失败：' + e.message);
      }
    });

    E('btn-import').addEventListener('click', function () { E('import-input').click(); });
    E('import-input').addEventListener('change', function (e) {
      var f = (e.target.files || [])[0];
      e.target.value = '';
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var r = DS.importData(String(fr.result));
          renderConvList();
          renderMemoryList();   // 记忆可能也被带进来了，刷新一下列表
          buildChips();
          DS.toast('已导入 ' + r.conversations + ' 个对话' +
            (r.memories ? ('、' + r.memories + ' 条新记忆') : ''), 2600);
        } catch (err) {
          DS.toast('导入失败：' + err.message, 2600);
        }
      };
      fr.onerror = function () { DS.toast('文件读取失败'); };
      fr.readAsText(f);
    });

    E('btn-clear-all').addEventListener('click', function () {
      openDialog({
        title: '清空全部对话',
        desc: '将删除本机保存的全部 ' + DS.convos.length + ' 个对话，且无法恢复。API Key 等设置不受影响。',
        okText: '全部清空',
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        DS.clearAll();
        showConvo(null, { noScroll: true });
        renderConvList();
        DS.toast('已清空');
      });
    });
  }

  function testConnection() {
    var out = E('test-out');
    out.className = 'test-out';
    out.textContent = '正在测试…';
    var t0 = Date.now();
    var res = {};

    DS.api.listModels().then(function (ids) {
      res.models = ids;
    }).catch(function (e) {
      res.modelsErr = e && e.message ? e.message : String(e);
    }).then(function () {
      return DS.api.balance().then(function (b) {
        res.balance = b;
      }).catch(function (e) {
        res.balanceErr = e && e.message ? e.message : String(e);
      });
    }).then(function () {
      var ms = Date.now() - t0;
      var lines = [];
      lines.push('接口地址：' + DS.baseUrlNormalized());
      lines.push('耗时：' + ms + ' ms');
      lines.push('');
      if (res.models) {
        lines.push('✓ 模型列表可用（' + res.models.length + ' 个）');
        lines.push('  ' + res.models.slice(0, 10).join(', ') + (res.models.length > 10 ? ' …' : ''));
      } else {
        lines.push('✗ 模型列表失败：' + res.modelsErr);
      }
      if (res.balance) {
        var infos = res.balance.balance_infos || [];
        if (infos.length) {
          var parts = infos.map(function (i) {
            var s = (i.currency || '') + ' ' + (i.total_balance !== undefined ? i.total_balance : '?');
            if (i.available_balance !== undefined) s += '（可用 ' + i.available_balance + '）';
            return s;
          });
          lines.push('✓ 余额：' + parts.join('；'));
        } else {
          lines.push('✓ 余额接口可用');
        }
      } else {
        lines.push('· 余额查询：' + res.balanceErr);
        lines.push('  （第三方中转通常不提供该接口，不影响对话）');
      }
      lines.push('');
      lines.push(res.models ? '结论：配置可用 ✓' : '结论：请检查 API Key / 接口地址 ✗');
      out.textContent = lines.join('\n');
      out.className = 'test-out ' + (res.models ? 'ok' : 'bad');
    });
  }

  /* ==================================================================
     弹层：动作面板 / 对话框
     ================================================================== */

  function openSheet(title, items) {
    return new Promise(function (resolve) {
      var wrap = E('sheet-wrap');
      var html = '<div class="sheet-bg"></div><div class="sheet" id="sheet">';
      if (title) html += '<div class="sheet-title">' + DS.escapeHtml(title) + '</div>';
      for (var i = 0; i < items.length; i++) {
        html += '<button class="sheet-item' + (items[i].danger ? ' danger' : '') + '" data-i="' + i + '">' +
          DS.iconHtml(items[i].icon || 'more') + '<span>' + DS.escapeHtml(items[i].label) + '</span></button>';
      }
      html += '<button class="sheet-item" data-i="-1">' + DS.iconHtml('close') + '<span>取消</span></button>';
      html += '</div>';
      wrap.innerHTML = html;
      wrap.classList.remove('hidden');

      function close(v) {
        wrap.classList.add('hidden');
        wrap.innerHTML = '';
        S.closeSheet = null;
        resolve(v);
      }
      S.closeSheet = function () { close(null); };
      wrap.querySelector('.sheet-bg').addEventListener('click', function () { close(null); });
      wrap.querySelector('.sheet').addEventListener('click', function (e) {
        var b = e.target.closest('.sheet-item');
        if (!b) return;
        var idx = parseInt(b.getAttribute('data-i'), 10);
        if (idx < 0) { close(null); return; }
        close(items[idx]);
      });
    });
  }

  function openDialog(o) {
    return new Promise(function (resolve) {
      var wrap = E('dialog-wrap');
      var html = '<div class="dialog-bg"></div><div class="dialog">';
      html += '<h3>' + DS.escapeHtml(o.title || '') + '</h3>';
      if (o.desc) html += '<p>' + DS.escapeHtml(o.desc) + '</p>';
      if (o.input !== undefined) {
        html += '<input type="text" value="' + DS.escapeHtml(o.input) + '" autocomplete="off">';
      }
      html += '<div class="dialog-actions">' +
        '<button class="cancel">取消</button>' +
        '<button class="ok' + (o.danger ? ' danger' : '') + '">' + DS.escapeHtml(o.okText || '确定') + '</button>' +
        '</div></div>';
      wrap.innerHTML = html;
      wrap.classList.remove('hidden');

      var inputEl = wrap.querySelector('input');
      if (inputEl) setTimeout(function () { try { inputEl.focus(); inputEl.select(); } catch (e) { /* ignore */ } }, 80);

      function close(v) {
        wrap.classList.add('hidden');
        wrap.innerHTML = '';
        S.closeDialog = null;
        resolve(v);
      }
      S.closeDialog = function () { close(null); };
      wrap.querySelector('.dialog-bg').addEventListener('click', function () { close(null); });
      wrap.querySelector('.cancel').addEventListener('click', function () { close(null); });
      wrap.querySelector('.ok').addEventListener('click', function () {
        close(inputEl ? inputEl.value.trim() : true);
      });
      if (inputEl) {
        inputEl.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); close(inputEl.value.trim()); }
        });
      }
    });
  }

  /* ==================================================================
     长按
     ================================================================== */

  /* ==================================================================
     手势区分：点按 vs 滑动
     消息下方有操作按钮，每条自己的消息右下角还有「⋯」，
     滑动列表时手指落点很容易蹭到它们，或者按住不动超过长按阈值，
     就会误弹操作面板。这里做两层防护：
       1) 滑动过的这一次点击直接丢弃（tap guard）
       2) 一旦发生滚动，立刻取消待触发的长按
     ================================================================== */

  var tap = { x: 0, y: 0, drag: false };
  var lp = { timer: null, el: null, x: 0, y: 0 };

  /** 滑动之后的第一次点击应当被忽略 */
  function consumeDrag() {
    if (!tap.drag) return false;
    tap.drag = false;
    return true;
  }

  function cancelLongPress() {
    if (lp.timer) { clearTimeout(lp.timer); lp.timer = null; }
    lp.el = null;
  }

  function installGestureGuard() {
    document.addEventListener('touchstart', function (e) {
      var t = e.touches && e.touches[0];
      if (!t) return;
      tap.x = t.clientX;
      tap.y = t.clientY;
      tap.drag = false;
    }, { passive: true, capture: true });

    document.addEventListener('touchmove', function (e) {
      var t = e.touches && e.touches[0];
      if (!t) return;
      var dx = t.clientX - tap.x;
      var dy = t.clientY - tap.y;
      if (dx * dx + dy * dy > 100) tap.drag = true; // 超过 10px 视为滑动
    }, { passive: true, capture: true });

    // 关键：滚动容器是 #scroll-area，它挂在消息列表的父级，
    // 所以监听必须放在 document 的捕获阶段才收得到。
    document.addEventListener('scroll', cancelLongPress, { passive: true, capture: true });
  }

  function longPress(root, selector, handler) {
    root.addEventListener('touchstart', function (e) {
      var t = e.target.closest(selector);
      if (!t) return;
      var touch = e.touches && e.touches[0];
      // 先取消上一次（它会把 lp.el 清空），再写入本次的目标
      cancelLongPress();
      lp.x = touch ? touch.clientX : 0;
      lp.y = touch ? touch.clientY : 0;
      lp.el = t;
      lp.timer = setTimeout(function () {
        lp.timer = null;
        var el = lp.el;
        if (!el) return;
        S.suppressClick = true;
        handler(el);
      }, 460);
    }, { passive: true });

    // 手指轻微抖动不算滑动，超过 10px 才取消
    root.addEventListener('touchmove', function (e) {
      if (!lp.timer) return;
      var touch = e.touches && e.touches[0];
      if (!touch) return;
      var dx = touch.clientX - lp.x;
      var dy = touch.clientY - lp.y;
      if (dx * dx + dy * dy > 100) cancelLongPress();
    }, { passive: true });

    root.addEventListener('touchcancel', cancelLongPress, { passive: true });
    root.addEventListener('touchend', cancelLongPress, { passive: true });

    root.addEventListener('contextmenu', function (e) {
      var t = e.target.closest(selector);
      if (!t) return;
      e.preventDefault();
      S.suppressClick = true;
      handler(t);
    });
  }

  /* ==================================================================
     给其他模块用的小接口
     reincarnate.js 需要复用弹窗、视图切换与会话渲染，避免重复实现

     注意：这里是**往已有的 DS.ui 上挂属性**，不是整个替换。
     DS.ui 里原本就有 init()，而 main.js 会调用 DS.ui.init() ——
     早先整个赋值把 init 覆盖掉了，结果是 App 静默不初始化。
     ================================================================== */
  DS.ui.openDialog = openDialog;
  DS.ui.switchView = switchView;
  DS.ui.startNewChat = startNewChat;
  DS.ui.showConvo = showConvo;
  DS.ui.renderConvList = renderConvList;
  DS.ui.isBusy = function () { return !!S.busy; };
  DS.ui.activeConvo = function () { return DS.activeId ? DS.getConvo(DS.activeId) : null; };
  // 别的模块（转生）更新完长期记忆后，让首页建议与设置列表跟着刷新
  DS.ui.refreshMemory = function () {
    renderMemoryList();
    buildChips();
  };

})(window.DS);
