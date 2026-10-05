/* 图标库：以 CSS mask 方式渲染内联 SVG，颜色跟随 currentColor */
window.DS = window.DS || {};
(function (DS) {
  'use strict';

  // 24x24 线性图标（stroke）
  var STROKE = {
    menu: '<path d="M3.5 7h17M3.5 12h17M3.5 17h17"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    right: '<path d="M9 5l7 7-7 7"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M4.5 12.5l5 5 10-11"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.9-3.9"/>',
    settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 14.5a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.03 1.56V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.55 1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.56-1.03H3a2 2 0 110-4h.1a1.7 1.7 0 001.55-1.1 1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.87.34H9a1.7 1.7 0 001.03-1.56V3a2 2 0 114 0v.1a1.7 1.7 0 001.03 1.56 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87V9a1.7 1.7 0 001.56 1.03H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1.03z"/>',
    newchat: '<path d="M20 12.5V19a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2h6.5"/><path d="M17.5 3.5a2.12 2.12 0 013 3L13 14l-4 1 1-4z"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    morev: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M5.5 15H5a1.9 1.9 0 01-1.9-1.9V5A2 2 0 015 3h8.1A1.9 1.9 0 0115 4.9v.6"/>',
    refresh: '<path d="M20.5 11a8.5 8.5 0 10-1.9 6.3"/><path d="M20.5 4.5V11h-6"/>',
    trash: '<path d="M4 7h16"/><path d="M9.5 7V5.2A1.2 1.2 0 0110.7 4h2.6a1.2 1.2 0 011.2 1.2V7"/><path d="M6.5 7l.9 12a1.6 1.6 0 001.6 1.5h6a1.6 1.6 0 001.6-1.5l.9-12"/>',
    edit: '<path d="M16.5 4.5a2.12 2.12 0 013 3L8 19l-4 1 1-4z"/>',
    thumbup: '<path d="M7 21V10.5l4.4-7.2a1.6 1.6 0 012.9 1.1L13.5 9h4.9a2 2 0 011.95 2.45l-1.5 7A2 2 0 0116.9 20H7z"/><path d="M7 10.5H4.6A1.6 1.6 0 003 12.1v7.3A1.6 1.6 0 004.6 21H7"/>',
    thumbdown: '<path d="M17 3v10.5l-4.4 7.2a1.6 1.6 0 01-2.9-1.1L10.5 15H5.6a2 2 0 01-1.95-2.45l1.5-7A2 2 0 017.1 4H17z"/><path d="M17 13.5h2.4A1.6 1.6 0 0021 11.9V4.6A1.6 1.6 0 0019.4 3H17"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.2 2.4 3.3 5.3 3.3 8.5S14.2 18.1 12 20.5c-2.2-2.4-3.3-5.3-3.3-8.5S9.8 5.9 12 3.5z"/>',
    think: '<path d="M12 3.2a5.8 5.8 0 00-5.8 5.8c0 1.3.4 2.4 1.1 3.4.5.7.8 1.2.9 1.9l.1 1.2h7.4l.1-1.2c.1-.7.4-1.2.9-1.9a5.8 5.8 0 00-4.7-9.2z"/><path d="M9.4 18.6h5.2"/><path d="M10.4 21h3.2"/>',
    mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0013 0"/><path d="M12 18v3.5"/>',
    speaker: '<path d="M11 5.2L6.6 8.9H3.4v6.2h3.2L11 18.8z"/><path d="M14.9 8.7a4.6 4.6 0 010 6.6"/><path d="M17.8 6a8.3 8.3 0 010 12"/>',
    image: '<rect x="3" y="4.5" width="18" height="15" rx="2.4"/><circle cx="8.6" cy="10" r="1.7"/><path d="M3.6 17.5l4.9-4.4a2 2 0 012.7 0l6.9 6.2"/>',
    camera: '<path d="M4 8.5h2.6l1.4-2.2h8l1.4 2.2H20a1.6 1.6 0 011.6 1.6v7.3A1.6 1.6 0 0120 19H4a1.6 1.6 0 01-1.6-1.6v-7.3A1.6 1.6 0 014 8.5z"/><circle cx="12" cy="13.6" r="3.4"/>',
    share: '<path d="M12 3.5v12"/><path d="M8 7l4-3.5L16 7"/><path d="M5 13v6.1A1.9 1.9 0 006.9 21h10.2a1.9 1.9 0 001.9-1.9V13"/>',
    download: '<path d="M12 3.5v12"/><path d="M8 11.5l4 4 4-4"/><path d="M4.5 20.5h15"/>',
    upload: '<path d="M12 15.5v-12"/><path d="M8 7.5l4-4 4 4"/><path d="M4.5 20.5h15"/>',
    alert: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.6v5"/><circle cx="12" cy="16.2" r="0.9" fill="currentColor" stroke="none"/>',
    info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.4"/><circle cx="12" cy="7.9" r="0.9" fill="currentColor" stroke="none"/>',
    doc: '<path d="M13.5 3.5H7a1.9 1.9 0 00-1.9 1.9v13.2A1.9 1.9 0 007 20.5h10a1.9 1.9 0 001.9-1.9V9z"/><path d="M13.5 3.5V9h5.4"/>',
    folder: '<path d="M3.5 6.8A1.8 1.8 0 015.3 5h3.5l2 2.6h8a1.8 1.8 0 011.8 1.8v7.8A1.8 1.8 0 0118.8 19H5.3a1.8 1.8 0 01-1.8-1.8z"/>',
    sparkle: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5"/><path d="M17 6l2 2"/><path d="M14.5 8.5l2 2"/>',
    eye: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.9"/>',
    robot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4.5V8"/><circle cx="12" cy="3.2" r="1.2"/><circle cx="9.3" cy="13" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.7" cy="13" r="1.1" fill="currentColor" stroke="none"/>',
    logout: '<path d="M15 4.5h3A1.9 1.9 0 0119.9 6.4v11.2a1.9 1.9 0 01-1.9 1.9h-3"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h9"/>'
  };

  // 24x24 填充图标
  var FILL = {
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.6"/>',
    send: '<path d="M12 3.6l6.2 6.2a1.4 1.4 0 01-2 2L13.4 9.1V19a1.4 1.4 0 01-2.8 0V9.1L7.8 11.8a1.4 1.4 0 11-2-2z"/>'
  };

  var cache = {};

  function svgFor(name) {
    if (cache[name]) return cache[name];
    var body, attrs;
    if (FILL[name]) {
      body = FILL[name];
      attrs = 'fill="#000" stroke="none"';
    } else if (STROKE[name]) {
      body = STROKE[name];
      attrs = 'fill="none" stroke="#000" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"';
    } else {
      body = STROKE.info;
      attrs = 'fill="none" stroke="#000" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"';
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ' + attrs + '>' + body + '</svg>';
    // 注意：这里必须用单引号包裹 url()。
    // iconHtml() 生成的是 <span style="-webkit-mask-image:url(...)">，
    // 若 url() 内部用双引号，会提前闭合 HTML 的 style 属性，
    // 导致 mask 丢失、图标全部不可见（data URI 还会被解析成一堆假属性）。
    var encoded = encodeURIComponent(svg).replace(/'/g, '%27');
    cache[name] = "url('data:image/svg+xml;charset=utf-8," + encoded + "')";
    return cache[name];
  }

  DS.iconUrl = svgFor;

  /** 把 data-icon="xxx" 的元素渲染成图标 */
  DS.iconHtml = function (name, extraClass) {
    return '<span class="ds-icon ' + (extraClass || '') + '" style="-webkit-mask-image:' +
      svgFor(name) + ';mask-image:' + svgFor(name) + '"></span>';
  };

  DS.applyIcon = function (el, name) {
    var url = svgFor(name);
    var s = el.style;
    // 用 setProperty 写连字符属性名：兼容只认标准名或只认前缀名的引擎
    s.setProperty('-webkit-mask-image', url);
    s.setProperty('mask-image', url);
    s.setProperty('-webkit-mask-repeat', 'no-repeat');
    s.setProperty('mask-repeat', 'no-repeat');
    s.setProperty('-webkit-mask-position', 'center');
    s.setProperty('mask-position', 'center');
    s.setProperty('-webkit-mask-size', 'contain');
    s.setProperty('mask-size', 'contain');
  };

  DS.hydrateIcons = function (root) {
    var list = (root || document).querySelectorAll('[data-icon]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.__iconDone === el.getAttribute('data-icon')) continue;
      DS.applyIcon(el, el.getAttribute('data-icon'));
      el.__iconDone = el.getAttribute('data-icon');
    }
  };
})(window.DS);
