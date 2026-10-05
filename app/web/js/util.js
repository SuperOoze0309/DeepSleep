/* 通用工具函数 */
window.DS = window.DS || {};
(function (DS) {
  'use strict';

  DS.$ = function (sel, root) { return (root || document).querySelector(sel); };
  DS.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  DS.el = function (tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    }
    if (html !== undefined) n.innerHTML = html;
    return n;
  };

  DS.uid = function () {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  };

  DS.escapeHtml = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  DS.debounce = function (fn, ms) {
    var t;
    return function () {
      var self = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };

  DS.throttle = function (fn, ms) {
    var last = 0, timer = null, pendArgs = null, pendSelf = null;
    return function () {
      var now = Date.now(), self = this, args = arguments;
      if (now - last >= ms) { last = now; fn.apply(self, args); return; }
      pendSelf = self; pendArgs = args;
      if (timer) return;
      timer = setTimeout(function () {
        timer = null; last = Date.now();
        fn.apply(pendSelf, pendArgs);
      }, ms - (now - last));
    };
  };

  /** 让回调在下一帧执行（合并多次调用） */
  DS.raf = function (fn) {
    var queued = false, lastArgs = null;
    return function () {
      lastArgs = arguments;
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        fn.apply(null, lastArgs || []);
      });
    };
  };

  DS.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  DS.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  DS.nowSec = function () { return Math.floor(Date.now() / 1000); };

  /** '刚刚' / 'HH:MM' / '昨天' / 'M月D日' */
  DS.fmtTime = function (ts) {
    var d = new Date(ts);
    var now = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    var y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return '昨天';
    if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  };

  /** 对话列表分组 */
  DS.dateGroup = function (ts) {
    var d = new Date(ts), now = new Date();
    var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= startOfToday) return '今天';
    if (ts >= startOfToday - 86400000) return '昨天';
    if (ts >= startOfToday - 86400000 * 7) return '7 天内';
    if (ts >= startOfToday - 86400000 * 30) return '30 天内';
    return '更早';
  };

  DS.fmtDuration = function (ms) {
    var s = ms / 1000;
    if (s < 60) return (Math.round(s * 10) / 10) + ' 秒';
    var m = Math.floor(s / 60);
    return m + ' 分 ' + Math.round(s - m * 60) + ' 秒';
  };

  DS.fmtBytes = function (n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  };

  DS.fmtNum = function (n) {
    if (typeof n !== 'number' || !isFinite(n)) return '-';
    return n.toLocaleString('zh-CN');
  };

  /* ---------------- Toast ---------------- */
  var toastTimer = null;
  DS.toast = function (msg, ms) {
    var t = DS.$('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 1800);
  };

  /* ---------------- 剪贴板 ---------------- */
  DS.copyText = function (text) {
    var done = function () { DS.toast('已复制'); };
    try {
      if (window.AndroidBridge && AndroidBridge.copyText) {
        AndroidBridge.copyText(text);
        done();
        return Promise.resolve(true);
      }
    } catch (e) { /* ignore */ }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { done(); return true; })
        .catch(function () { return legacyCopy(text).then(done); });
    }
    return legacyCopy(text).then(done);
  };

  function legacyCopy(text) {
    return new Promise(function (resolve) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      try { document.execCommand('copy'); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
      resolve(true);
    });
  }

  /* ---------------- 存储 ----------------
     优先走原生 KV（SharedPreferences 支撑的文件存储），localStorage 作为
     副本与降级路径。原因：页面是从 http://127.0.0.1:<port> 提供的，
     而 localStorage 按「源」隔离 —— 端口一变，旧数据就读不到了。
     原生存储不受端口影响，配置和对话记录不会再丢。 */
  var nativeKV = (function () {
    try {
      if (window.AndroidBridge && window.AndroidBridge.kvGet && window.AndroidBridge.kvSet) {
        return window.AndroidBridge;
      }
    } catch (e) { /* 非 App 环境 */ }
    return null;
  })();

  function readRaw(key) {
    var raw = null;
    if (nativeKV) {
      try { raw = nativeKV.kvGet(key); } catch (e) { raw = null; }
    }
    if (raw === null || raw === undefined || raw === '') {
      try { raw = localStorage.getItem(key); } catch (e) { raw = null; }
    }
    return (raw === undefined) ? null : raw;
  }

  DS.store = {
    usingNative: !!nativeKV,
    get: function (key, def) {
      var raw = readRaw(key);
      if (raw === null || raw === '') return def;
      try { return JSON.parse(raw); } catch (e) { return def; }
    },
    set: function (key, val) {
      var raw = JSON.stringify(val);
      if (nativeKV) {
        try { nativeKV.kvSet(key, raw); } catch (e) { /* 降级到 localStorage */ }
      }
      try {
        localStorage.setItem(key, raw);
        return true;
      } catch (e) {
        if (String(e && e.name).indexOf('Quota') >= 0 || String(e).indexOf('quota') >= 0) {
          if (!nativeKV) DS.toast('本地存储空间已满，请清理一些旧对话');
        } else if (!nativeKV) {
          DS.toast('保存失败：' + (e && e.message ? e.message : e));
        }
        return !!nativeKV; // 原生存储成功的话依然算保存成功
      }
    },
    del: function (key) {
      if (nativeKV) { try { nativeKV.kvRemove(key); } catch (e) { /* ignore */ } }
      try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    }
  };

  /* ---------------- 文本处理 ---------------- */
  DS.titleFrom = function (text, max) {
    max = max || 24;
    var s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return '新对话';
    // 去掉常见 markdown 噪音
    s = s.replace(/^[#>\-*\s]+/, '').replace(/`/g, '');
    return s.length > max ? s.slice(0, max) + '…' : s;
  };

  /** 供 api 使用：把 OpenAI 风格 content 数组拍平成纯文本 */
  DS.contentToText = function (content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(function (p) {
        if (!p) return '';
        if (p.type === 'text') return p.text || '';
        if (p.type === 'image_url') return '[图片]';
        return '';
      }).join(' ');
    }
    return '';
  };

  DS.isAbort = function (err) {
    if (!err) return false;
    return err.name === 'AbortError' || err.code === 20 || /abort/i.test(String(err.message || ''));
  };

})(window.DS);
