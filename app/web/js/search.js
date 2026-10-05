/* 联网搜索：客户端检索网页，把结果作为参考资料注入对话
   默认使用 DuckDuckGo 的 HTML 端点（无需 Key），也可切换到 Tavily。 */
window.DS = window.DS || {};
(function (DS) {
  'use strict';

  function decodeDdgUrl(href) {
    if (!href) return '';
    var h = href.trim();
    if (h.indexOf('//') === 0) h = 'https:' + h;
    try {
      var u = new URL(h, 'https://duckduckgo.com');
      var uddg = u.searchParams.get('uddg');
      if (uddg) return decodeURIComponent(uddg);
      if (u.hostname.indexOf('duckduckgo.com') >= 0 && u.pathname === '/l/') {
        var m = /[?&]uddg=([^&]+)/.exec(h);
        if (m) return decodeURIComponent(m[1]);
      }
      return u.href;
    } catch (e) {
      return h;
    }
  }

  function parseDdgHtml(html, limit) {
    var out = [];
    var doc;
    try {
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch (e) {
      return out;
    }

    // 常规版布局
    var nodes = doc.querySelectorAll('.result, .web-result');
    for (var i = 0; i < nodes.length && out.length < limit; i++) {
      var n = nodes[i];
      if (n.classList && n.classList.contains('result--ad')) continue;
      var a = n.querySelector('a.result__a, h2 a, a.result-link');
      if (!a) continue;
      var sn = n.querySelector('.result__snippet, .result-snippet, .result__body');
      var url = decodeDdgUrl(a.getAttribute('href'));
      var title = (a.textContent || '').trim();
      if (!title || !url) continue;
      out.push({ title: title, url: url, snippet: (sn ? sn.textContent : '').replace(/\s+/g, ' ').trim().slice(0, 400) });
    }

    // lite 版布局兜底
    if (!out.length) {
      var links = doc.querySelectorAll('a.result-link');
      for (var k = 0; k < links.length && out.length < limit; k++) {
        var la = links[k];
        var tr = la.closest('tr');
        var snip = '';
        if (tr) {
          var next = tr.nextElementSibling;
          while (next && !snip) {
            var td = next.querySelector('td.result-snippet');
            if (td) snip = td.textContent.replace(/\s+/g, ' ').trim();
            next = next.nextElementSibling;
          }
        }
        out.push({
          title: (la.textContent || '').trim(),
          url: decodeDdgUrl(la.getAttribute('href')),
          snippet: snip.slice(0, 400)
        });
      }
    }
    return out.filter(function (r) { return r.title && r.url; });
  }

  DS.search = {
    /** 返回 [{title, url, snippet}] */
    run: function (query, limit) {
      limit = limit || 5;
      var provider = DS.settings.searchProvider || 'duckduckgo';
      if (provider === 'tavily') return tavily(query, limit);
      return duckduckgo(query, limit);
    },

    /**
     * 结果质量过滤。
     * 抓回来的东西经常一半是导航页、广告和聚合站，全塞进上下文会把模型带偏 ——
     * 这比「什么都没搜到」更糟。所以先按关键词重合度筛一道，宁可少给几条。
     */
    filterRelevant: function (results, queries, opts) {
      opts = opts || {};
      var minScore = (opts.minScore === undefined) ? 0.25 : opts.minScore;
      var terms = termsOf(queries);
      if (!terms.length || !results || !results.length) return results || [];
      return results
        .map(function (r) { return { r: r, s: scoreResult(r, terms) }; })
        .filter(function (x) { return x.s >= minScore; })
        .sort(function (a, b) { return b.s - a.s; })
        .map(function (x) { return x.r; });
    },

    /** 供 UI 显示 */
    providerName: function () {
      return (DS.settings.searchProvider || 'duckduckgo') === 'tavily' ? 'Tavily' : 'DuckDuckGo';
    },

    /**
     * 多轮检索：每条关键词搜一次，按 URL 去重，总数封顶。
     * 轮数是硬上限 —— 搜太久比搜不准更让人难受。
     */
    runMulti: function (queries, opts) {
      opts = opts || {};
      var perQuery = opts.perQuery || 4;
      var maxTotal = opts.maxTotal || 6;
      var maxRounds = Math.min(opts.maxRounds || 2, (queries || []).length);
      var seen = {}, out = [];
      var chain = Promise.resolve();

      for (var i = 0; i < maxRounds; i++) {
        (function (q) {
          chain = chain.then(function () {
            if (out.length >= maxTotal) return null;
            return DS.search.run(q, perQuery).then(function (list) {
              for (var j = 0; j < list.length && out.length < maxTotal; j++) {
                var r = list[j] || {};
                var key = String(r.url || r.title || '')
                  .replace(/[#?].*$/, '').replace(/\/+$/, '');
                if (!key || seen[key]) continue;
                seen[key] = 1;
                out.push(r);
              }
              return null;
            }).catch(function () { return null; });   // 单条失败不影响其余
          });
        })(queries[i]);
      }
      return chain.then(function () { return out; });
    }
  };

  /* ==================================================================
     检索规划：让模型决定「要不要搜」以及「搜什么」
     以前直接拿用户整句话当搜索词，长问句检索出来自然不准；
     而且开关一开就每句都搜，很多问题本来不需要联网。
     ================================================================== */

  var PLAN_PROMPT = [
    '你是搜索规划器。判断用户这句话**是否必须**联网才能答好。',
    '',
    '【默认不搜】绝大多数对话都不需要联网 —— 聊天、解释概念、写代码、',
    '改 bug、翻译、润色、数学题、出主意、总结上面的内容，都属于不搜。',
    '拿不准的时候，一律选择不搜。',
    '',
    '【只有满足下面任意一条才需要搜】',
    '1. 用户明确要求：说了「搜一下 / 查一下 / 帮我查 / 最新消息」',
    '2. 时效性数据：今天的新闻、股价、汇率、天气、赛程、版本发布时间',
    '3. 某个具体的人/公司/产品**最近**发生了什么，且这事在训练数据之后',
    '4. 用户给了具体链接，或要求核对某个可查证的具体事实',
    '',
    '注意：「什么是 X」「X 怎么用」「X 和 Y 的区别」这类**不搜**，',
    '直接凭知识回答。只有当你确信「不知道最新情况就答不好」时才搜。',
    '',
    '【输出格式】严格两行，不要 JSON、不要任何多余文字：',
    '第一行：需要搜就输出 SEARCH，不需要就输出 NOSEARCH',
    '第二行：需要搜时给 1-3 个关键词，用 | 分隔（每个不超过 12 字，',
    '是关键词不是整句话）；不需要搜时第二行留空',
    '',
    '示例一（不需要联网）：',
    'NOSEARCH',
    '',
    '示例二（需要联网）：',
    'SEARCH',
    '英伟达 最新财报|英伟达 股价'
  ].join('\n');

  function shortQuery(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 40);
  }

  /* ---------------- 结果相关性打分 ---------------- */

  /** 把检索词拆成匹配元：按空格/标点切，中文长词再补 2-gram */
  function termsOf(queries) {
    var out = [], seen = {};
    function push(t) {
      t = String(t || '').toLowerCase().trim();
      if (t.length < 2 || seen[t]) return;
      seen[t] = 1;
      out.push(t);
    }
    (queries || []).forEach(function (q) {
      String(q || '').toLowerCase().split(/[\s,，、|/]+/).forEach(function (part) {
        push(part);
        var cjk = part.replace(/[^\u4e00-\u9fa5]/g, '');
        if (cjk.length >= 4) {
          for (var i = 0; i + 2 <= cjk.length; i++) push(cjk.slice(i, i + 2));
        }
      });
    });
    return out.slice(0, 24);
  }

  function scoreResult(result, terms) {
    var text = ((result.title || '') + ' ' + (result.snippet || '')).toLowerCase();
    if (!text.trim()) return 0;
    var hit = 0;
    for (var i = 0; i < terms.length; i++) {
      if (text.indexOf(terms[i]) > -1) hit++;
    }
    // 标题里命中权重更高：标题相关通常正文才真相关
    var title = String(result.title || '').toLowerCase();
    var titleHit = 0;
    for (var j = 0; j < terms.length; j++) {
      if (title.indexOf(terms[j]) > -1) titleHit++;
    }
    var base = hit / terms.length;
    var bonus = terms.length ? (titleHit / terms.length) * 0.3 : 0;
    return Math.min(1, base + bonus);
  }

  /* 解析不出来时的兜底：宁可漏搜，也不要每句都搜。
     只有问句里带明显的时效 / 检索信号才放行。 */
  var SEARCH_HINT = /搜一下|搜搜|查一下|查查|帮我查|最新|最近的|今天|昨天|现在|目前|实时|股价|汇率|天气|赛程|多少钱|价格|什么时候|哪一年|发布了|上线了|新闻/i;

  /**
   * 解析规划结果，兼容两种输出：
   *   1. 约定的两行文本（SEARCH / NOSEARCH + 关键词）
   *   2. 老格式 JSON（万一模型还是吐 JSON）
   */
  function parsePlan(text, question) {
    var body = String(text || '').trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

    // 兼容 JSON
    var ja = body.indexOf('{'), jb = body.lastIndexOf('}');
    if (ja > -1 && ja < 40 && jb > ja) {
      try {
        var o = JSON.parse(body.slice(ja, jb + 1));
        var jq = (o.queries || []).map(shortQuery)
          .filter(function (x) { return x.length >= 2; }).slice(0, 3);
        if (o.need === false || !jq.length) return { need: false, queries: [] };
        return { need: true, queries: jq };
      } catch (e) { /* 继续按文本解析 */ }
    }

    var lines = body.split('\n').map(function (l) { return l.trim(); });
    var first = (lines[0] || '').toUpperCase();
    var saidNo = first.indexOf('NOSEARCH') > -1 || first.indexOf('NO SEARCH') > -1;
    var saidYes = !saidNo && first.indexOf('SEARCH') > -1;

    if (saidNo) return { need: false, queries: [] };
    if (saidYes) {
      var qs = (lines[1] || '').split('|').map(shortQuery)
        .filter(function (x) { return x.length >= 2; }).slice(0, 3);
      if (qs.length) return { need: true, queries: qs };
      return { need: true, queries: [shortQuery(question).slice(0, 30)] };
    }

    // 完全没按格式来 —— 这里是关键：
    // 以前这一步是 fail-open（默认去搜），「无论问什么都搜」就是这么来的
    if (SEARCH_HINT.test(question || '')) {
      return { need: true, queries: [shortQuery(question).slice(0, 30)] };
    }
    return { need: false, queries: [] };
  }

  DS.search._SEARCH_HINT = SEARCH_HINT;

  DS.search.plan = function (question, opts) {
    opts = opts || {};
    if (!shortQuery(question)) return Promise.resolve({ need: false, queries: [] });
    var acc = '';
    return DS.api.chat({
      messages: [
        { role: 'system', content: PLAN_PROMPT },
        { role: 'user', content: String(question).slice(0, 1500) }
      ],
      model: opts.model || DS.effectiveModel(),
      thinking: false,
      signal: opts.signal,
      onContent: function (d, full) { acc = full; }
    }).then(function () {
      return parsePlan(acc, question);
    }).catch(function () {
      return { need: true, queries: [shortQuery(question).slice(0, 30)] };
    });
  };

  DS.search._parsePlan = parsePlan;

  function duckduckgo(query, limit) {
    var q = encodeURIComponent(query);
    var attempts = [
      { base: 'https://html.duckduckgo.com', path: '/html/?q=' + q },
      { base: 'https://lite.duckduckgo.com', path: '/lite/?q=' + q }
    ];

    function tryNext(i) {
      if (i >= attempts.length) throw new Error('搜索服务无响应');
      return DS.api.proxy({
        base: attempts[i].base,
        path: attempts[i].path,
        method: 'GET',
        // 搜索引擎属于第三方，绝不能把模型服务的 API Key 一起发过去
        headers: { 'X-Skip-Auth': '1' }
      }).then(function (res) {
        return res.text().then(function (html) {
          if (!res.ok || !html) throw new Error('HTTP ' + res.status);
          var list = parseDdgHtml(html, limit);
          if (!list.length) throw new Error('未解析到结果');
          return list;
        });
      }).catch(function (e) {
        if (i + 1 < attempts.length) return tryNext(i + 1);
        throw new Error('搜索失败：' + (e && e.message ? e.message : e));
      });
    }
    return tryNext(0);
  }

  function tavily(query, limit) {
    var key = (DS.settings.tavilyKey || '').trim();
    if (!key) return Promise.reject(new Error('未填写 Tavily API Key'));
    return DS.api.proxy({
      base: 'https://api.tavily.com',
      path: '/search',
      method: 'POST',
      rawBase: true,
      headers: { 'X-Skip-Auth': '1' },
      body: {
        api_key: key,
        query: query,
        max_results: limit,
        search_depth: 'basic',
        include_answer: false
      }
    }).then(function (res) {
      return res.text().then(function (txt) {
        if (!res.ok) throw new Error('Tavily HTTP ' + res.status + (txt ? '：' + txt.slice(0, 160) : ''));
        var j;
        try { j = JSON.parse(txt); } catch (e) { throw new Error('Tavily 返回格式异常'); }
        var arr = j.results || [];
        return arr.map(function (r) {
          return {
            title: r.title || r.url || '网页',
            url: r.url || '',
            snippet: String(r.content || '').replace(/\s+/g, ' ').slice(0, 400)
          };
        }).filter(function (r) { return r.url; });
      });
    });
  }

  /** 把搜索结果拼成注入对话的参考资料 */
  DS.search.buildContext = function (query, results) {
    var lines = [];
    // 过滤后一条不剩是常态（关键词太偏或上游抽风）。
    // 这种情况必须如实说，不能让模型以为「没资料」等于「没这回事」。
    if (!results || !results.length) {
      return '你尝试联网检索了「' + query + '」，但没有找到与该问题相关的可靠网页。\n' +
        '请不要编造检索结果，也不要假装引用了资料；' +
        '直接依据你已有的知识回答，并说明这部分内容未经联网核实。';
    }
    lines.push('你已开启联网搜索。以下是根据检索词「' + query + '」找到的网页资料，请优先依据这些资料作答，');
    lines.push('在引用具体信息时用 [编号] 标注来源（例如 [1]）。如果资料不足以回答问题，请明确说明并给出你已知的信息。');
    lines.push('');
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      lines.push('[' + (i + 1) + '] ' + r.title);
      lines.push('URL: ' + r.url);
      if (r.snippet) lines.push(r.snippet);
      lines.push('');
    }
    return lines.join('\n');
  };

})(window.DS);
