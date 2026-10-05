/* 启动入口 */
(function () {
  'use strict';

  function boot() {
    try {
      window.DS.ui.init();
    } catch (e) {
      // 启动失败时把错误直接显示出来，避免白屏无从排查
      var box = document.createElement('div');
      box.style.cssText = 'position:fixed;inset:0;background:#fff;color:#c0392b;padding:24px;' +
        'font:13px/1.6 monospace;white-space:pre-wrap;z-index:9999;overflow:auto';
      box.textContent = '启动失败：\n' + (e && e.stack ? e.stack : e);
      document.body.appendChild(box);
    }
  }

  window.addEventListener('error', function (ev) {
    if (window.DS && DS.toast && !DS.__bootFailed) {
      DS.toast('脚本错误：' + (ev.message || ''), 2400);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
