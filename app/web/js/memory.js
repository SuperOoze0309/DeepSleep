/* 长期记忆
 *
 * 跨对话持久化的一份「用户画像 + 项目上下文」，和单个会话的 memory 字段
 * （转生摘要）是两回事：
 *   - 会话的 memory：一次转生带过去的摘要，跟着那个会话走
 *   - 长期记忆：全局累积，每次请求按当前问题挑相关的几条注入
 *
 * 抽取交给模型，但落库、去重、打分、淘汰都在本地做 ——
 * 不依赖任何向量服务，纯词粒度相似度 + 时间衰减。
 */
window.DS = window.DS || {};
(function (DS) {
  'use strict';

  var KEY = 'ds.memory.v1';
  var MAX_ITEMS = 150;        // 上限，超了按分数淘汰
  var MERGE_AT = 0.72;        // 相似度超过这个值就合并而不是新增
  var KINDS = ['profile', 'preference', 'project', 'fact', 'todo'];

  var M = { items: [], suggestions: [], loaded: false };
  var lastBlock = { count: 0, chars: 0 };

  /* ---------------- 持久化 ---------------- */

  function load() {
    if (M.loaded) return;
    M.loaded = true;
    var raw = DS.store.get(KEY, null);
    if (!raw) return;
    if (Object.prototype.toString.call(raw) === '[object Array]') {
      M.items = raw.slice();            // 兼容早期只有数组的格式
    } else {
      M.items = (raw.items || []).slice();
      M.suggestions = (raw.suggestions || []).slice();
    }
    M.items = M.items.filter(function (it) { return it && it.text; });
    M.suggestions = cleanSuggestions(M.suggestions);
  }

  function save() {
    DS.store.set(KEY, {
      items: M.items,
      suggestions: M.suggestions,
      updatedAt: Date.now()
    });
  }

  /* 命中次数只是排序的微调，不值得每条消息都写一次磁盘 ——
     原生 KV 是把整份 JSON 落成文件的，发一条消息写一次会明显影响流畅度。
     合并成一次延迟写入，页面隐藏时再兜底刷一次。 */
  var saveTimer = null;
  function saveSoon() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      save();
    }, 4000);
  }
  function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; save(); }
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushSave();
    });
  }

  /* ---------------- 文本相似度 ----------------
     中文没有天然分词，用 2-gram；英文按词。两者混在一个集合里算 Jaccard 风格的重合度。 */

  function grams(s) {
    var out = {};
    var t = String(s || '').toLowerCase();
    var words = t.match(/[a-z0-9_\-.]{2,}/g) || [];
    for (var i = 0; i < words.length; i++) out['w:' + words[i]] = 1;
    var cjk = t.replace(/[^\u4e00-\u9fa5]/g, '');
    for (var j = 0; j + 2 <= cjk.length; j++) out['c:' + cjk.slice(j, j + 2)] = 1;
    return out;
  }

  function similarity(a, b) {
    var A = grams(a), B = grams(b);
    var ka = Object.keys(A), kb = Object.keys(B);
    if (!ka.length || !kb.length) {
      return String(a).trim() === String(b).trim() ? 1 : 0;
    }
    var hit = 0;
    for (var i = 0; i < ka.length; i++) if (B[ka[i]]) hit++;
    return hit / Math.max(ka.length, kb.length);
  }

  function cleanSuggestions(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (s) {
      var t = String(s == null ? '' : s).trim().replace(/\s+/g, ' ');
      if (!t || t.length > 30) return;
      var k = t.toLowerCase();
      if (seen[k]) return;
      seen[k] = 1;
      out.push(t);
    });
    return out.slice(0, 4);
  }

  /* ---------------- 打分 ----------------
     拆成「相关度」和「综合分」两部分：
     相关度用来判断「这条该不该进」——不相关的一律不进，这是防上下文膨胀的第一道闸；
     综合分用来排序，额外考虑新鲜度和类型权重。 */

  function relevanceOf(item, queryGrams) {
    if (!queryGrams) return 0;
    var g = grams(item.text);
    var keys = Object.keys(g);
    if (!keys.length) return 0;
    var hit = 0;
    for (var i = 0; i < keys.length; i++) if (queryGrams[keys[i]]) hit++;
    return hit / keys.length;
  }

  function scoreOf(item, queryGrams) {
    var rel = relevanceOf(item, queryGrams);
    var ageDays = (Date.now() - (item.updatedAt || item.createdAt || Date.now())) / 86400000;
    var recency = Math.max(0, 1 - ageDays / 90);
    var kindBonus = item.kind === 'preference' ? 0.32
      : item.kind === 'profile' ? 0.28
      : item.kind === 'project' ? 0.18
      : item.kind === 'todo' ? 0.12 : 0;
    var used = Math.min(item.hits || 0, 20) * 0.01;
    return rel * 2 + recency * 0.45 + kindBonus + used;
  }

  function clampInt(v, lo, hi) {
    v = Math.round(Number(v) || 0);
    return Math.max(lo, Math.min(hi, v));
  }

  /** 永远该带上、且与当前提问无关的信息：画像与偏好 */
  function isAlwaysKind(kind) {
    return kind === 'preference' || kind === 'profile';
  }

  /* ---------------- 对外接口 ---------------- */

  DS.memory = {
    ready: function () { load(); return M.items.length; },

    all: function () { load(); return M.items.slice(); },
    suggestions: function () { load(); return M.suggestions.slice(); },
    count: function () { load(); return M.items.length; },

    add: function (text, kind) {
      load();
      var t = String(text || '').trim();
      if (t.length < 4) return null;
      var item = {
        id: DS.uid(),
        kind: KINDS.indexOf(kind) > -1 ? kind : 'fact',
        text: t.slice(0, 300),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        hits: 0
      };
      var dup = findSimilar(item.text);
      if (dup) { dup.updatedAt = Date.now(); save(); return dup; }
      M.items.push(item);
      trim();
      save();
      return item;
    },

    update: function (id, text) {
      load();
      for (var i = 0; i < M.items.length; i++) {
        if (M.items[i].id === id) {
          M.items[i].text = String(text || '').trim().slice(0, 300);
          M.items[i].updatedAt = Date.now();
          save();
          return true;
        }
      }
      return false;
    },

    remove: function (id) {
      load();
      var before = M.items.length;
      M.items = M.items.filter(function (it) { return it.id !== id; });
      if (M.items.length !== before) { save(); return true; }
      return false;
    },

    clear: function () {
      load();
      M.items = [];
      M.suggestions = [];
      save();
      DS.store.del(KEY);
    },

    setSuggestions: function (list) {
      load();
      M.suggestions = cleanSuggestions(list);
      save();
    },

    /* ---------------- 开关 ----------------
       三道闸，任何一道关掉都完全不读也不写：
         1. 全局总开关 memoryEnabled
         2. 单个对话的 memoryOff
       这样用户既能整体关掉，也能让某个敏感对话不留下痕迹。 */

    enabledFor: function (convo) {
      if (DS.settings.memoryEnabled === false) return false;
      if (convo && convo.memoryOff) return false;
      return true;
    },

    /**
     * 按当前问题挑相关的若干条，拼成可以塞进 system 的文本。
     *
     * 防上下文爆炸的三道限制（缺一不可）：
     *   1. 不相关的一条都不进（relevanceOf > 0），不做「全量注入」
     *   2. 条数上限 maxItems
     *   3. **字符预算** maxChars —— 真正的硬闸，单条也截到 120 字
     * 宁可少给几条，也不能让记忆把上下文吃光。
     */
    promptBlock: function (query, opts) {
      load();
      opts = opts || {};
      if (!M.items.length) return '';

      var maxItems = clampInt(opts.maxItems || DS.settings.memoryLimit || 8, 1, 15);
      var maxChars = clampInt(opts.maxChars || DS.settings.memoryBudget || 900, 200, 2000);

      var qg = grams(query || '');
      var scored = M.items.map(function (it) {
        return { it: it, s: scoreOf(it, qg) };
      }).sort(function (a, b) { return b.s - a.s; });

      // 1) 画像/偏好永远带上（本身有上限），它们跟当前问什么无关
      var picked = [], seen = {};
      scored.forEach(function (x) {
        if (picked.length >= 4) return;
        if (!isAlwaysKind(x.it.kind)) return;
        picked.push(x);
        seen[x.it.id] = 1;
      });

      // 2) 其余按相关度补，且必须有实际相关度
      for (var i = 0; i < scored.length && picked.length < maxItems; i++) {
        var x = scored[i];
        if (seen[x.it.id]) continue;
        if (relevanceOf(x.it, qg) <= 0) continue;
        picked.push(x);
        seen[x.it.id] = 1;
      }

      // 3) 按字符预算收口
      var header = '以下是关于这位用户的长期记忆，请在合适的时候自然运用，不要生硬复述：\n';
      var lines = [];
      var used = header.length;
      for (var j = 0; j < picked.length; j++) {
        var text = String(picked[j].it.text);
        if (text.length > 120) text = text.slice(0, 118) + '…';
        var line = '- [' + labelOf(picked[j].it.kind) + '] ' + text;
        if (used + line.length + 1 > maxChars) break;
        lines.push(line);
        used += line.length + 1;
      }
      if (!lines.length) return '';

      picked.slice(0, lines.length).forEach(function (x) {
        x.it.hits = (x.it.hits || 0) + 1;
      });
      saveSoon();   // 命中次数延迟合并写入，不阻塞发消息

      lastBlock = { count: lines.length, chars: used };
      return header + lines.join('\n');
    },

    /** 上一次注入的规模，设置页用来显示「会占用多少上下文」 */
    lastBlockSize: function () { return lastBlock; },

    /* 把模型抽出来的结果并进来 */
    ingest: function (data) {
      load();
      var added = 0, merged = 0;
      var list = (data && data.memories) || [];
      for (var i = 0; i < list.length; i++) {
        var m = list[i] || {};
        var text = String(m.text == null ? '' : m.text).trim().replace(/\s+/g, ' ');
        if (text.length < 4 || text.length > 300) continue;
        var kind = KINDS.indexOf(m.kind) > -1 ? m.kind : 'fact';
        var dup = findSimilar(text);
        if (dup) {
          // 新的说法更长就更详细，替换掉旧的
          if (text.length > dup.text.length) dup.text = text;
          dup.updatedAt = Date.now();
          dup.hits = (dup.hits || 0) + 1;
          merged++;
        } else {
          M.items.push({
            id: DS.uid(), kind: kind, text: text,
            createdAt: Date.now(), updatedAt: Date.now(), hits: 0
          });
          added++;
        }
      }
      var sugg = cleanSuggestions((data && data.suggestions) || []);
      if (sugg.length) M.suggestions = sugg;
      trim();
      save();
      return { added: added, merged: merged, total: M.items.length };
    },

    /* 供测试与调试 */
    _similarity: similarity,
    _kinds: KINDS
  };

  function labelOf(kind) {
    return kind === 'profile' ? '用户画像'
      : kind === 'preference' ? '偏好'
      : kind === 'project' ? '项目'
      : kind === 'todo' ? '待办' : '事实';
  }

  function findSimilar(text) {
    var best = null, bestSim = 0;
    for (var i = 0; i < M.items.length; i++) {
      var s = similarity(M.items[i].text, text);
      if (s > bestSim) { bestSim = s; best = M.items[i]; }
    }
    return bestSim >= MERGE_AT ? best : null;
  }

  function trim() {
    if (M.items.length <= MAX_ITEMS) return;
    var qg = {};
    M.items.sort(function (a, b) { return scoreOf(b, qg) - scoreOf(a, qg); });
    M.items = M.items.slice(0, MAX_ITEMS);
  }

  /* ==================================================================
     抽取：让模型从一段对话里挑出值得长期记住的东西
     ================================================================== */

  var EXTRACT_PROMPT = [
    '你是长期记忆提取器。从用户给你的对话里抽出「值得跨对话长期记住」的信息。',
    '',
    '只记这几类：',
    '- profile：用户的身份、角色、技术栈、所在领域',
    '- preference：用户明确表达过的长期偏好或硬性要求（例如「不要客套话」）',
    '- project：正在做的项目、它的状态和关键决策',
    '- fact：已经确认的事实性结论或约定',
    '- todo：用户交代过但还没做完的事',
    '',
    '不要记：寒暄、一次性的提问、已经完成的琐碎步骤、模型的客套话、',
    '以及任何离开这段对话就没有意义的内容。',
    '',
    '只输出一个 JSON 对象，不要代码围栏、不要任何解释文字，格式严格如下：',
    '{"memories":[{"kind":"project","text":"..."}],"suggestions":["...","..."]}',
    '',
    'text 用第三人称陈述、一句话说清、不超过 60 字。',
    'suggestions 是 3 条「用户接下来最可能想做的事」，要结合上面抽出的记忆，',
    '写成可以直接点开就问的短句，不超过 18 字。',
    '如果确实没有值得长期记住的内容，两个字段都返回空数组。'
  ].join('\n');

  function transcriptOf(convo, max) {
    var parts = [];
    for (var i = 0; i < convo.messages.length; i++) {
      var m = convo.messages[i];
      if (m.error) continue;
      var text = (m.content || '').trim();
      if (!text) continue;
      parts.push((m.role === 'user' ? '用户' : '助手') + '：' + text);
    }
    var s = parts.join('\n\n');
    var limit = max || 14000;
    if (s.length <= limit) return s;
    return s.slice(0, Math.floor(limit * 0.3)) +
      '\n\n……（中间省略）……\n\n' + s.slice(s.length - Math.ceil(limit * 0.7));
  }

  /* 从可能带围栏、带前后废话的文本里把 JSON 抠出来 */
  function parseJsonLoose(text) {
    var s = String(text || '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a > -1 && b > a) {
      try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { /* 继续降级 */ }
    }
    // 降级：按行抽 "- xxx" 当记忆，总比什么都没有强
    var lines = s.split('\n').map(function (l) {
      return l.replace(/^\s*[-*·\d.]+\s*/, '').trim();
    }).filter(function (l) { return l.length >= 6 && l.length <= 120; });
    if (!lines.length) return null;
    return {
      memories: lines.slice(0, 10).map(function (l) { return { kind: 'fact', text: l }; }),
      suggestions: []
    };
  }

  DS.memory.extract = function (convo, opts) {
    opts = opts || {};
    if (!DS.memory.enabledFor(convo)) {
      return Promise.resolve({ added: 0, merged: 0, skipped: true, reason: 'memory off' });
    }
    if (!convo || !convo.messages || !convo.messages.length) {
      return Promise.resolve({ added: 0, merged: 0, skipped: true });
    }
    var body = transcriptOf(convo, opts.maxChars);
    if (!body.trim()) return Promise.resolve({ added: 0, merged: 0, skipped: true });

    var acc = '';
    return DS.api.chat({
      messages: [
        { role: 'system', content: EXTRACT_PROMPT },
        { role: 'user', content: '请从下面这段对话里抽取长期记忆：\n\n' + body }
      ],
      model: opts.model || DS.effectiveModel(),
      thinking: false,
      signal: opts.signal,
      onContent: function (d, full) { acc = full; }
    }).then(function () {
      var data = parseJsonLoose(acc);
      if (!data) return { added: 0, merged: 0, parseFailed: true };
      var r = DS.memory.ingest(data);
      r.parseFailed = false;
      return r;
    });
  };

  DS.memory._parseJsonLoose = parseJsonLoose;
  DS.memory._transcriptOf = transcriptOf;

})(window.DS);
