/* 预览诊断脚本：由 tools/preview.mjs 注入到 <head> 最前面（早于所有应用脚本）。
   用来抓「Uncaught (in promise) TypeError: Failed to construct 'URL'」的调用栈 ——
   这个错误在页面启动阶段就出现，晚注册的 unhandledrejection 监听器抓不到。 */
(function () {
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    console.log('DIAG unhandledrejection :: ' + (r && r.stack ? r.stack : String(r)));
  });

  var NativeURL = window.URL;
  function PatchedURL(u, b) {
    try {
      return b === undefined ? new NativeURL(u) : new NativeURL(u, b);
    } catch (err) {
      console.log('DIAG URL ctor failed :: u=' + String(u) + ' | base=' + String(b) +
        ' | stack=' + (new Error().stack || '(no stack)'));
      throw err;
    }
  }
  PatchedURL.prototype = NativeURL.prototype;
  ['createObjectURL', 'revokeObjectURL', 'canParse'].forEach(function (k) {
    if (typeof NativeURL[k] === 'function') PatchedURL[k] = NativeURL[k].bind(NativeURL);
  });
  try { window.URL = PatchedURL; } catch (e) { console.log('DIAG patch failed: ' + e); }
})();
