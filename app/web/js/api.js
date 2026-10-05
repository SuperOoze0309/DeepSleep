/* API 客户端
   所有请求都经过 App 内置的本地代理（同源 http://127.0.0.1:port/api/proxy），
   由原生层转发到用户自填的接口地址 —— 因此不受 WebView CORS 限制，
   并且支持真正的 SSE 流式输出。 */
window.DS = window.DS || {};
(function (DS) {
  'use strict';

  var PROXY = '/api/proxy';

  function appToken() {
    return window.__DS_APP_TOKEN__ || '';
  }

  function friendlyError(status, bodyText) {
    var detail = '';
    try {
      var j = JSON.parse(bodyText);
      detail = (j.error && (j.error.message || j.error.code)) || j.message || '';
    } catch (e) {
      detail = String(bodyText || '').slice(0, 300);
    }
    var map = {
      400: '请求格式有误',
      401: 'API Key 无效或未填写',
      402: '账户余额不足',
      403: '没有访问该模型的权限',
      404: '接口地址不正确（检查「接口地址」设置）',
      413: '请求内容过大',
      422: '请求参数不被接受',
      429: '请求过于频繁，请稍后再试',
      500: '接口服务内部错误',
      502: '网关错误，接口服务不可用',
      503: '接口服务暂时不可用',
      504: '接口响应超时'
    };
    var head = map[status] || ('请求失败（HTTP ' + status + '）');
    return detail ? head + '：' + detail : head;
  }

  /** 统一代理请求；返回原始 Response（流式时 body 可读） */
  DS.api = {
    proxy: function (opts) {
      var base = (opts.base || DS.baseUrlNormalized()).replace(/\/+$/, '');
      var extra = opts.headers || {};
      var format = opts.format || DS.settings.apiFormat || 'openai';
      var headers = {
        'X-Api-Base': base,
        'X-Api-Path': opts.path,
        'X-Api-Method': opts.method || 'GET',
        'X-App-Token': appToken()
      };
      // 协议格式决定鉴权头：Anthropic 走 x-api-key，OpenAI 兼容走 Bearer
      headers['X-Auth-Header'] = opts.authHeader ||
        (format === 'anthropic' ? 'x-api-key' : 'Authorization');
      // 这里只传「方案名」，方案名和 Key 之间那个空格由原生层补。
      // 原因：HTTP 头值首尾空白会被规范化裁掉，传 "Bearer " 到对面就变成 "Bearer"，
      // 再拼上 Key 就成了 "Bearersk-xxx"，服务端只会回 401 未授权。
      headers['X-Auth-Scheme'] = opts.authPrefix !== undefined
        ? String(opts.authPrefix).trim()
        : (format === 'anthropic' ? '' : 'Bearer');
      // 搜索等第三方服务不应收到模型服务的 Key
      if (!extra['X-Skip-Auth']) {
        var key = (DS.settings.apiKey || '').trim();
        if (key) headers['X-Api-Key'] = key;
      }
      for (var hk in extra) headers[hk] = extra[hk];

      var init = { method: 'POST', headers: headers, signal: opts.signal };
      if (opts.body !== undefined && opts.body !== null) {
        headers['Content-Type'] = 'application/json';
        init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      }
      return fetch(PROXY, init).catch(function (err) {
        if (DS.isAbort(err)) throw err;
        throw new Error('无法连接本地服务，请重启 App（' + (err && err.message ? err.message : err) + '）');
      });
    },

    /** 读取模型列表 */
    listModels: function () {
      var format = DS.settings.apiFormat || 'openai';
      var opts = { path: '/models', method: 'GET', format: format };
      if (format === 'anthropic') {
        opts.headers = { 'X-Upstream-Headers': JSON.stringify({ 'anthropic-version': '2023-06-01' }) };
      }
      return DS.api.proxy(opts).then(function (res) {
        return res.text().then(function (txt) {
          if (!res.ok) throw new Error(friendlyError(res.status, txt));
          var j;
          try { j = JSON.parse(txt); } catch (e) { throw new Error('接口返回的不是 JSON'); }
          var arr = (j && j.data) || (j && j.models) || [];
          var ids = [];
          for (var i = 0; i < arr.length; i++) {
            var id = arr[i] && (arr[i].id || arr[i].name || arr[i].model);
            if (id) ids.push(String(id));
          }
          if (!ids.length) throw new Error('接口未返回任何模型');
          return ids;
        });
      });
    },

    /** 查询余额（DeepSeek 官方接口；第三方中转可能不支持） */
    balance: function () {
      return DS.api.proxy({ path: '/user/balance', method: 'GET' }).then(function (res) {
        return res.text().then(function (txt) {
          if (!res.ok) throw new Error(friendlyError(res.status, txt));
          try { return JSON.parse(txt); } catch (e) { throw new Error('接口返回的不是 JSON'); }
        });
      });
    },

    /**
     * 流式对话
     * opts: { messages, model, thinking, effort, temperature, maxTokens, signal,
     *         onReasoning(delta, full), onContent(delta, full), onUsage(u) }
     * 返回 { content, reasoning, usage, finishReason, model }
     */
    chat: function (opts) {
      var settings = DS.settings;
      var format = settings.apiFormat || 'openai';
      var model = opts.model || DS.effectiveModel();

      var think = opts.thinking;
      if (think === undefined) think = settings.thinking;

      var payload, path, upstream;
      if (format === 'anthropic') {
        path = '/messages';
        upstream = { 'anthropic-version': '2023-06-01' };
        var system = '';
        var msgs = [];
        (opts.messages || []).forEach(function (m) {
          if (m.role === 'system') {
            system += (system ? '\n\n' : '') + DS.contentToText(m.content);
            return;
          }
          msgs.push({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: toAnthropicContent(m.content)
          });
        });
        payload = {
          model: model,
          messages: msgs,
          // Anthropic 的 max_tokens 是必填项
          max_tokens: opts.maxTokens || settings.maxTokens || 8192,
          stream: true
        };
        if (system) payload.system = system;
        if (think) payload.thinking = { type: 'enabled', budget_tokens: 4096 };
        if (typeof opts.temperature === 'number') payload.temperature = opts.temperature;
      } else {
        path = '/chat/completions';
        upstream = null;
        payload = { model: model, messages: opts.messages, stream: true };

        /* thinking 不是 OpenAI 标准字段，部分第三方中转会因为「未知字段」直接 400。
           所以策略是：
             - 要开启思考时照发（不支持的话本来也用不了）
             - 关闭时，只有 DeepSeek 官方才显式发 disabled（它默认可能是开的），
               其它中转干脆不发这个字段，避免白白撞 400
           reasoning_effort 同理，只在真要开启思考时才带。 */
        var isDeepSeek = /(^|\.)deepseek\.com/i.test(String(settings.baseUrl || ''));
        if (think) {
          payload.thinking = { type: 'enabled' };
          var effort = (opts.effort === undefined ? settings.effort : opts.effort);
          if (effort) payload.reasoning_effort = effort;
        } else if (isDeepSeek) {
          payload.thinking = { type: 'disabled' };
        }
        if (typeof opts.temperature === 'number') payload.temperature = opts.temperature;
        if (opts.maxTokens) payload.max_tokens = opts.maxTokens;
      }

      var acc = { content: '', reasoning: '', usage: null, finishReason: null, model: model };
      var onContent = opts.onContent || function () {};
      var onReasoning = opts.onReasoning || function () {};

      var proxyOpts = {
        path: path,
        method: 'POST',
        body: payload,
        signal: opts.signal,
        format: format
      };
      if (upstream) proxyOpts.headers = { 'X-Upstream-Headers': JSON.stringify(upstream) };

      return DS.api.proxy(proxyOpts)
        .then(function (res) {
          var ctype = (res.headers.get('content-type') || '').toLowerCase();

          if (!res.ok) {
            return res.text().then(function (txt) { throw new Error(friendlyError(res.status, txt)); });
          }

          // 极少数中转会忽略 stream 参数，直接返回完整 JSON
          if (ctype.indexOf('event-stream') < 0 && ctype.indexOf('stream') < 0) {
            return res.text().then(function (txt) {
              var j;
              try { j = JSON.parse(txt); } catch (e) { throw new Error('接口返回格式无法识别'); }
              if (format === 'anthropic') {
                if (j.error) throw new Error((j.error && j.error.message) || '接口返回错误');
                var blocks = j.content || [];
                for (var i = 0; i < blocks.length; i++) {
                  var b = blocks[i] || {};
                  if (b.type === 'thinking' && b.thinking) {
                    acc.reasoning += b.thinking;
                    onReasoning(b.thinking, acc.reasoning);
                  } else if (b.type === 'text' && b.text) {
                    acc.content += b.text;
                    onContent(b.text, acc.content);
                  }
                }
                acc.usage = j.usage || null;
                acc.finishReason = j.stop_reason === 'end_turn' ? 'stop' : (j.stop_reason || 'stop');
              } else {
                var ch = (j.choices && j.choices[0]) || {};
                var msg = ch.message || {};
                var r = msg.reasoning_content || msg.reasoning || '';
                if (r) { acc.reasoning = r; onReasoning(r, r); }
                var c = typeof msg.content === 'string' ? msg.content : '';
                if (c) { acc.content = c; onContent(c, c); }
                acc.usage = j.usage || null;
                acc.finishReason = ch.finish_reason || 'stop';
              }
              if (acc.usage && opts.onUsage) opts.onUsage(acc.usage);
              return acc;
            });
          }

          return readSSE(res, acc, {
            onContent: onContent,
            onReasoning: onReasoning,
            onUsage: opts.onUsage,
            format: format
          });
        });
    }
  };

  /** 把 OpenAI 风格的 content 转成 Anthropic 的 block 数组 */
  function toAnthropicContent(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return String(content === null || content === undefined ? '' : content);
    var out = [];
    for (var i = 0; i < content.length; i++) {
      var part = content[i];
      if (!part) continue;
      if (part.type === 'text') {
        out.push({ type: 'text', text: part.text || '' });
      } else if (part.type === 'image_url') {
        var url = (part.image_url && part.image_url.url) || '';
        var m = /^data:([^;]+);base64,(.*)$/.exec(url);
        if (m) out.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
      }
    }
    return out.length ? out : '';
  }

  /** 逐行解析 SSE */
  function readSSE(res, acc, cb) {
    if (!res.body || typeof res.body.getReader !== 'function') {
      return res.text().then(function (txt) {
        // 退化：整体解析
        var lines = txt.split('\n');
        for (var i = 0; i < lines.length; i++) handleLine(lines[i], acc, cb);
        return acc;
      });
    }

    var reader = res.body.getReader();
    var decoder = new TextDecoder('utf-8');
    var buf = '';

    function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          if (buf) handleLine(buf, acc, cb);
          return acc;
        }
        buf += decoder.decode(r.value, { stream: true });
        var idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          var line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
          handleLine(line, acc, cb);
        }
        return pump();
      });
    }
    return pump();
  }

  /** Anthropic 的流式事件结构与 OpenAI 完全不同，单独处理 */
  function handleAnthropicEvent(j, acc, cb) {
    if (j.type === 'error') {
      throw new Error((j.error && j.error.message) || '接口返回错误');
    }
    if (j.type === 'content_block_delta' && j.delta) {
      if (j.delta.type === 'thinking_delta' && j.delta.thinking) {
        acc.reasoning += j.delta.thinking;
        cb.onReasoning(j.delta.thinking, acc.reasoning);
      } else if (typeof j.delta.text === 'string' && j.delta.text) {
        acc.content += j.delta.text;
        cb.onContent(j.delta.text, acc.content);
      }
      return;
    }
    if (j.type === 'message_start' && j.message && j.message.usage) {
      acc.usage = j.message.usage;
    }
    if (j.type === 'message_delta') {
      if (j.delta && j.delta.stop_reason) {
        acc.finishReason = j.delta.stop_reason === 'end_turn' ? 'stop' : j.delta.stop_reason;
      }
      if (j.usage) {
        acc.usage = acc.usage ? Object.assign({}, acc.usage, j.usage) : j.usage;
        if (cb.onUsage) cb.onUsage(acc.usage);
      }
    }
  }

  function handleLine(line, acc, cb) {
    if (!line) return;
    if (line.charAt(0) === ':') return;              // SSE 注释（部分中转用作心跳）
    if (line.indexOf('data:') !== 0) return;         // 也顺带跳过 event: / id: 行
    var data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;

    var j;
    try { j = JSON.parse(data); } catch (e) { return; }

    if (cb.format === 'anthropic') {
      handleAnthropicEvent(j, acc, cb);
      return;
    }

    if (j.error) {
      var m = (j.error && (j.error.message || j.error.code)) || '接口返回错误';
      throw new Error(String(m));
    }
    if (j.usage) {
      acc.usage = j.usage;
      if (cb.onUsage) cb.onUsage(j.usage);
    }
    var ch = j.choices && j.choices[0];
    if (!ch) return;
    if (ch.finish_reason) acc.finishReason = ch.finish_reason;

    var d = ch.delta || ch.message || {};
    // 兼容不同厂商对思维链的字段命名
    var r = d.reasoning_content !== undefined ? d.reasoning_content
      : (d.reasoning !== undefined ? d.reasoning : d.thinking);
    if (r) {
      acc.reasoning += r;
      cb.onReasoning(r, acc.reasoning);
    }
    var c = d.content;
    if (typeof c === 'string' && c) {
      acc.content += c;
      cb.onContent(c, acc.content);
    } else if (Array.isArray(c)) {
      // 少数实现返回分段数组
      for (var i = 0; i < c.length; i++) {
        if (c[i] && c[i].type === 'text' && c[i].text) {
          acc.content += c[i].text;
          cb.onContent(c[i].text, acc.content);
        }
      }
    }
  }

})(window.DS);
