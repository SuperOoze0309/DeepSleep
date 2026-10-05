/* Markdown 渲染：markdown-it + highlight.js + KaTeX */
window.DS = window.DS || {};
(function (DS) {
  'use strict';

  var md = null;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function init() {
    if (md || typeof window.markdownit !== 'function') return;
    md = window.markdownit({
      html: false,          // 禁止原始 HTML，防止注入
      xhtmlOut: false,
      breaks: true,         // 单个换行即换行（对话场景更自然）
      langPrefix: 'language-',
      linkify: true,
      typographer: false
    });

    // 代码块：自定义容器 + 复制按钮
    function fenceHtml(lang, code, noHighlight) {
      var out;
      if (noHighlight || typeof window.hljs === 'undefined') {
        out = esc(code);
      } else {
        try {
          if (lang && window.hljs.getLanguage(lang)) {
            out = window.hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
          } else if (lang) {
            out = esc(code);
          } else {
            out = window.hljs.highlightAuto(code).value;
          }
        } catch (e) {
          out = esc(code);
        }
      }
      return '<div class="code-block">' +
        '<div class="code-head"><span class="code-lang">' + esc(lang || 'text') + '</span>' +
        '<button class="code-copy" type="button">' + DS.iconHtml('copy') + '<span>复制</span></button></div>' +
        '<pre><code class="hljs">' + out + '</code></pre></div>';
    }

    md.renderer.rules.fence = function (tokens, idx, options, env) {
      var token = tokens[idx];
      var info = (token.info || '').trim();
      var lang = info ? info.split(/\s+/)[0].toLowerCase() : '';
      return fenceHtml(lang, token.content, env && env.noHighlight);
    };

    md.renderer.rules.code_block = function (tokens, idx, options, env) {
      return fenceHtml('', tokens[idx].content, env && env.noHighlight);
    };

    // 表格横向滚动包裹
    var defaultTableOpen = md.renderer.rules.table_open || function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };
    var defaultTableClose = md.renderer.rules.table_close || function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };
    md.renderer.rules.table_open = function (t, i, o, e, s) {
      return '<div class="table-wrap">' + defaultTableOpen(t, i, o, e, s);
    };
    md.renderer.rules.table_close = function (t, i, o, e, s) {
      return defaultTableClose(t, i, o, e, s) + '</div>';
    };

    // 行内代码加类名，便于样式区分
    md.renderer.rules.code_inline = function (tokens, idx) {
      return '<code class="inline">' + esc(tokens[idx].content) + '</code>';
    };

    // 链接：新窗口 / 交给系统浏览器
    var defaultLinkOpen = md.renderer.rules.link_open || function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };
    md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
      tokens[idx].attrSet('target', '_blank');
      tokens[idx].attrSet('rel', 'noopener noreferrer');
      return defaultLinkOpen(tokens, idx, options, env, self);
    };

    // 图片懒加载
    md.renderer.rules.image = function (tokens, idx, options, env, self) {
      tokens[idx].attrSet('loading', 'lazy');
      return self.renderToken(tokens, idx, options);
    };
  }

  /** 流式输出时补全未闭合的代码围栏，避免半截代码块抖动 */
  function prepareStreaming(text) {
    var s = String(text || '');
    var fences = s.match(/^\s*```/gm);
    if (fences && fences.length % 2 === 1) s += '\n```';
    return s;
  }

  /* ------------------------------------------------------------------
     中文强调修复
     CommonMark 的定界符 flanking 规则对中文极不友好：
       `图里展示的是**分区（partition）**这一步`
     收尾的 ** 前面是中文标点、后面是汉字，判定为「不能闭合」，
     于是星号被原样输出，加粗失效。中文回复里这种写法遍地都是。

     这里在收尾定界符前插入一个私有区哨兵字符（既不算空白也不算标点），
     让 flanking 判定成立；渲染完成后再把哨兵从 HTML 中删除。
     原始 msg.content 不受影响，只是渲染时的一份副本。
     ------------------------------------------------------------------ */
  var SENTINEL = '\uE000';
  var SENTINEL_RE = /\uE000/g;

  function relaxEmphasis(src) {
    if (src.indexOf('*') < 0 && src.indexOf('_') < 0) return src;
    return src.replace(/(\*\*|__|\*|_)(?=\S)([\s\S]*?\S)\1/g, function (m, d, body) {
      return d + body + SENTINEL + d;
    });
  }

  DS.md = {
    ready: function () { init(); return !!md; },

    render: function (text, opts) {
      init();
      opts = opts || {};
      var src = opts.streaming ? prepareStreaming(text) : String(text || '');
      src = relaxEmphasis(src);
      if (!md) return '<p>' + esc(src).replace(/\n/g, '<br>').replace(SENTINEL_RE, '') + '</p>';
      try {
        return md.render(src, { noHighlight: !!opts.streaming }).replace(SENTINEL_RE, '');
      } catch (e) {
        return '<p>' + esc(src).replace(/\n/g, '<br>').replace(SENTINEL_RE, '') + '</p>';
      }
    },

    /** 渲染进元素，并做数学公式渲染 */
    renderInto: function (el, text, opts) {
      opts = opts || {};
      el.innerHTML = DS.md.render(text, opts);
      DS.md.math(el, opts);
    },

    /** KaTeX 公式渲染（对含 $ 的内容才执行，避免无谓开销） */
    math: function (el, opts) {
      if (typeof window.renderMathInElement !== 'function') return;
      var txt = el.textContent || '';
      if (txt.indexOf('$') < 0 && txt.indexOf('\\(') < 0) return;
      if (opts && opts.streaming && txt.length > 6000) return;
      try {
        window.renderMathInElement(el, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '\\[', right: '\\]', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false }
          ],
          ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
          throwOnError: false,
          errorColor: '#E5484D'
        });
      } catch (e) { /* 公式渲染失败不影响正文 */ }
    },

    plain: function (text) {
      return esc(text).replace(/\n/g, '<br>');
    },

    /** 把 Markdown 压成适合朗读的纯文本（直接念星号和反引号很难听） */
    speechText: function (text) {
      var s = String(text || '');
      s = s.replace(/```[\s\S]*?```/g, '（代码块）');
      s = s.replace(/`([^`]+)`/g, '$1');
      s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
      s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
      s = s.replace(/^\s{0,3}#{1,6}\s*/gm, '');
      s = s.replace(/(\*\*|__)([\s\S]*?)\1/g, '$2');
      s = s.replace(/(\*|_)([^*_\n]+)\1/g, '$2');
      s = s.replace(/^\s*>\s?/gm, '');
      s = s.replace(/^\s*[-*+]\s+/gm, '');
      s = s.replace(/^\s*\d+\.\s+/gm, '');
      s = s.replace(/^\s*\|.*\|\s*$/gm, '');
      s = s.replace(/^\s*[-:|\s]{4,}\s*$/gm, '');
      s = s.replace(/\$\$([\s\S]*?)\$\$/g, ' $1 ');
      s = s.replace(/\$([^$\n]+)\$/g, ' $1 ');
      s = s.replace(/\\([a-zA-Z]+)/g, '$1');
      s = s.replace(/[*_~#>`]/g, '');
      s = s.replace(/\n{2,}/g, '\n');
      return s.trim();
    },

    escape: esc
  };

})(window.DS);
