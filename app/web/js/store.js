/* 状态与持久化：设置 + 对话历史 */
window.DS = window.DS || {};
(function (DS) {
  'use strict';

  var K_SETTINGS = 'ds.settings.v1';
  var K_CONVOS = 'ds.convos.v1';
  var K_ACTIVE = 'ds.active.v1';

  var DEFAULT_SETTINGS = {
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    modelCustom: '',
    apiFormat: 'openai',
    providers: [],
    activeProviderId: '',
    thinking: true,
    effort: '',
    temperature: 1,
    maxTokens: null,
    systemPrompt: '',
    webSearch: false,
    searchProvider: 'duckduckgo',
    tavilyKey: '',
    theme: 'system',
    scheme: 'blue',
    accentColor: '',
    oledBlack: false,
    fontFamily: 'system',
    density: 'cozy',
    ttsVoice: '',
    ttsRate: 1,
    ttsPitch: 1,
    autoRead: false,
    // 长期记忆：默认开，但有三道闸（总开关 / 会话开关 / 字符预算）
    memoryEnabled: true,
    autoMemory: true,
    memoryLimit: 8,
    memoryBudget: 900,
    appIcon: 'default',
    splashArt: '',
    customIcons: [],
    customLogo: '',
    fontScale: 1
  };

  /* 常见服务商预设：一键填好地址、模型与协议格式 */
  DS.PROVIDER_PRESETS = [
    { key: 'deepseek', name: 'DeepSeek 官方', baseUrl: 'https://api.deepseek.com',
      models: ['deepseek-flash', 'deepseek-v4-pro'], format: 'openai' },
    { key: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'], format: 'openai' },
    { key: 'anthropic', name: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1',
      models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'], format: 'anthropic' },
    { key: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1',
      models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-4o', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat'],
      format: 'openai' },
    { key: 'siliconflow', name: '硅基流动 SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1',
      models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'], format: 'openai' },
    { key: 'moonshot', name: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn/v1',
      models: ['moonshot-v1-128k', 'kimi-k2-0905-preview'], format: 'openai' },
    { key: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      models: ['glm-4-plus', 'glm-4-flash'], format: 'openai' },
    { key: 'dashscope', name: '阿里通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: ['qwen-max', 'qwen-plus'], format: 'openai' },
    { key: 'custom', name: '自定义 / 中转站', baseUrl: '', models: [], format: 'openai' }
  ];

  DS.settings = Object.assign({}, DEFAULT_SETTINGS);
  DS.convos = [];
  DS.activeId = null;

  DS.loadState = function () {
    var s = DS.store.get(K_SETTINGS, {});
    DS.settings = Object.assign({}, DEFAULT_SETTINGS, s || {});
    if (!Array.isArray(DS.settings.models) || !DS.settings.models.length) {
      DS.settings.models = DEFAULT_SETTINGS.models.slice();
    }
    var c = DS.store.get(K_CONVOS, []);
    DS.convos = Array.isArray(c) ? c : [];
    DS.activeId = DS.store.get(K_ACTIVE, null);
    if (DS.activeId && !DS.getConvo(DS.activeId)) DS.activeId = null;
    DS.migrateProviders();
  };

  var saveConvos = DS.debounce(function () {
    DS.store.set(K_CONVOS, DS.convos);
  }, 400);

  DS.saveSettings = function () {
    DS.store.set(K_SETTINGS, DS.settings);
  };

  DS.saveConvos = function (immediate) {
    if (immediate) {
      DS.store.set(K_CONVOS, DS.convos);
    } else {
      saveConvos();
    }
  };

  DS.setActive = function (id) {
    DS.activeId = id;
    DS.store.set(K_ACTIVE, id);
  };

  /* ---------------- 对话 ---------------- */

  DS.getConvo = function (id) {
    for (var i = 0; i < DS.convos.length; i++) if (DS.convos[i].id === id) return DS.convos[i];
    return null;
  };

  DS.newConvo = function (opts) {
    opts = opts || {};
    var c = {
      id: DS.uid(),
      title: opts.title || '新对话',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    };
    // 对话转生：把上一段对话压缩出的摘要作为长期记忆带进来
    if (opts.memory) c.memory = String(opts.memory);
    DS.convos.unshift(c);
    DS.setActive(c.id);
    DS.saveConvos(true);
    return c;
  };

  DS.deleteConvo = function (id) {
    DS.convos = DS.convos.filter(function (c) { return c.id !== id; });
    if (DS.activeId === id) DS.setActive(null);
    DS.saveConvos(true);
  };

  DS.renameConvo = function (id, title) {
    var c = DS.getConvo(id);
    if (!c) return;
    c.title = DS.titleFrom(title, 40);
    DS.saveConvos(true);
  };

  DS.touchConvo = function (id) {
    var c = DS.getConvo(id);
    if (!c) return;
    c.updatedAt = Date.now();
    // 最近更新的排在最前
    var idx = DS.convos.indexOf(c);
    if (idx > 0) {
      DS.convos.splice(idx, 1);
      DS.convos.unshift(c);
    }
    DS.saveConvos();
  };

  DS.clearAll = function () {
    DS.convos = [];
    DS.setActive(null);
    DS.saveConvos(true);
  };

  /** 由首条用户消息生成标题 */
  DS.autoTitle = function (convo, text) {
    if (!convo) return;
    if (convo.title && convo.title !== '新对话') return;
    convo.title = DS.titleFrom(text, 24);
  };

  /* ---------------- 导入 / 导出 ---------------- */

  DS.exportData = function () {
    return JSON.stringify({
      app: 'deepsleep-client',
      version: 2,
      exportedAt: new Date().toISOString(),
      settings: {
        baseUrl: DS.settings.baseUrl,
        model: DS.settings.model,
        thinking: DS.settings.thinking,
        effort: DS.settings.effort,
        temperature: DS.settings.temperature,
        systemPrompt: DS.settings.systemPrompt
      },
      conversations: DS.convos,
      // 长期记忆单独一份：它是跨对话攒出来的，丢了没法从对话里还原
      memory: (DS.memory && DS.memory.count()) ? {
        items: DS.memory.all(),
        suggestions: DS.memory.suggestions()
      } : null
    }, null, 2);
  };

  DS.importData = function (jsonText) {
    var data;
    try { data = JSON.parse(jsonText); } catch (e) { throw new Error('文件不是合法的 JSON'); }
    var list = data && (data.conversations || (Array.isArray(data) ? data : null));
    if (!Array.isArray(list)) throw new Error('未找到 conversations 数组');
    var added = 0;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || !Array.isArray(c.messages)) continue;
      DS.convos.unshift({
        id: DS.uid(),
        title: DS.titleFrom(c.title || '导入的对话', 40),
        createdAt: c.createdAt || Date.now(),
        updatedAt: c.updatedAt || Date.now(),
        messages: c.messages.map(function (m) {
          return {
            id: DS.uid(),
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: DS.contentToText(m.content),
            reasoning: m.reasoning || '',
            createdAt: m.createdAt || Date.now()
          };
        })
      });
      added++;
    }
    DS.saveConvos(true);

    // v2 起带上长期记忆：合并进去（同一条会自动去重），而不是覆盖
    var memCount = 0;
    if (data && data.memory && DS.memory) {
      var before = DS.memory.count();
      DS.memory.ingest({
        memories: (data.memory.items || []).map(function (it) {
          return { kind: it && it.kind, text: it && it.text };
        }),
        suggestions: data.memory.suggestions || []
      });
      memCount = DS.memory.count() - before;
    }
    return { conversations: added, memories: memCount };
  };

  /* ---------------- 发送给接口的消息构造 ---------------- */

  DS.buildApiMessages = function (convo, upToIndex) {
    var out = [];
    var sp = (DS.settings.systemPrompt || '').trim();
    if (sp) out.push({ role: 'system', content: sp });

    // 转生带过来的记忆摘要：放在系统提示之后、正式对话之前
    var mem = (convo && convo.memory ? String(convo.memory) : '').trim();
    if (mem) {
      out.push({
        role: 'system',
        content: '以下是之前对话留下的记忆摘要，供你参考背景，不要主动复述它：\n\n' + mem
      });
    }

    var msgs = convo.messages.slice(0, upToIndex === undefined ? convo.messages.length : upToIndex);

    // 长期记忆：按这一轮的实际提问挑相关的几条。
    // 开关在 DS.memory.enabledFor 里统一判断（全局 + 单会话），
    // 字符预算在 promptBlock 里收口 —— 记忆绝不能把上下文吃光。
    if (DS.memory && DS.memory.enabledFor(convo)) {
      var q = '';
      for (var qi = msgs.length - 1; qi >= 0; qi--) {
        if (msgs[qi].role === 'user' && msgs[qi].content) {
          q = typeof msgs[qi].content === 'string'
            ? msgs[qi].content
            : DS.contentToText(msgs[qi].content);
          break;
        }
      }
      var block = DS.memory.promptBlock(q, {
        maxItems: DS.settings.memoryLimit,
        maxChars: DS.settings.memoryBudget
      });
      if (block) out.push({ role: 'system', content: block });
    }

    var msgs = convo.messages.slice(0, upToIndex === undefined ? convo.messages.length : upToIndex);
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (m.error) continue;
      if (m.role === 'user') {
        if (m.images && m.images.length) {
          var parts = [];
          if (m.content) parts.push({ type: 'text', text: m.content });
          for (var k = 0; k < m.images.length; k++) {
            parts.push({ type: 'image_url', image_url: { url: m.images[k] } });
          }
          out.push({ role: 'user', content: parts });
        } else if (m.content) {
          out.push({ role: 'user', content: m.content });
        }
      } else if (m.role === 'assistant') {
        if (m.content) out.push({ role: 'assistant', content: m.content });
      } else if (m.role === 'system') {
        out.push({ role: 'system', content: m.content });
      }
    }
    return out;
  };

  /** 当前生效的模型名 */
  DS.effectiveModel = function () {
    var custom = (DS.settings.modelCustom || '').trim();
    if (custom) return custom;
    return DS.settings.model || 'deepseek-flash';
  };

  /* ---------------- 多服务商配置 ----------------
     一套「服务商」= 地址 + Key + 模型 + 协议格式。
     当前生效的那套会展开到 settings 顶层的 baseUrl/apiKey/model/... 上，
     这样 api.js 那条单配置的代码路径完全不用改。
     ------------------------------------------------ */

  DS.getProvider = function (id) {
    var list = DS.settings.providers || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  DS.activeProvider = function () {
    return DS.getProvider(DS.settings.activeProviderId);
  };

  /** 把当前生效的配置写回它所属的服务商条目 */
  DS.syncToProvider = function () {
    var p = DS.activeProvider();
    if (!p) return;
    p.baseUrl = DS.settings.baseUrl;
    p.apiKey = DS.settings.apiKey;
    p.model = DS.settings.model;
    p.models = (DS.settings.models || []).slice();
    p.modelCustom = DS.settings.modelCustom || '';
    p.format = DS.settings.apiFormat || 'openai';
    DS.saveSettings();
  };

  /** 切换到某个服务商：把它那一套配置展开为当前生效 */
  DS.applyProvider = function (id) {
    var p = DS.getProvider(id);
    if (!p) return false;
    DS.settings.activeProviderId = id;
    DS.settings.baseUrl = p.baseUrl || 'https://api.deepseek.com';
    DS.settings.apiKey = p.apiKey || '';
    DS.settings.model = p.model || (p.models && p.models[0]) || 'deepseek-flash';
    DS.settings.models = (p.models && p.models.length) ? p.models.slice() : [DS.settings.model];
    DS.settings.modelCustom = p.modelCustom || '';
    DS.settings.apiFormat = p.format || 'openai';
    DS.saveSettings();
    return true;
  };

  /** 新建服务商；preset 为空即从零开始 */
  DS.addProvider = function (preset, name) {
    preset = preset || {};
    var p = {
      id: DS.uid(),
      name: name || preset.name || '新服务商',
      baseUrl: preset.baseUrl || '',
      apiKey: '',
      model: (preset.models && preset.models[0]) || '',
      models: (preset.models || []).slice(),
      modelCustom: '',
      format: preset.format || 'openai'
    };
    if (!Array.isArray(DS.settings.providers)) DS.settings.providers = [];
    DS.settings.providers.push(p);
    DS.saveSettings();
    return p;
  };

  DS.removeProvider = function (id) {
    var list = DS.settings.providers || [];
    DS.settings.providers = list.filter(function (p) { return p.id !== id; });
    if (DS.settings.activeProviderId === id) {
      DS.settings.activeProviderId = '';
      if (DS.settings.providers.length) {
        DS.applyProvider(DS.settings.providers[0].id);
      } else {
        DS.settings.apiKey = '';
        DS.saveSettings();
      }
    } else {
      DS.saveSettings();
    }
  };

  /** 老版本只有一个全局配置：首次启动时把它收成一个服务商条目 */
  DS.migrateProviders = function () {
    if (!Array.isArray(DS.settings.providers)) DS.settings.providers = [];
    if (DS.settings.providers.length) {
      if (!DS.getProvider(DS.settings.activeProviderId)) {
        DS.applyProvider(DS.settings.providers[0].id);
      }
      return;
    }
    var label = 'DeepSeek 官方';
    try {
      var host = new URL(DS.baseUrlNormalized()).hostname;
      if (host) label = host;
    } catch (e) { /* 保留默认名 */ }
    var p = {
      id: DS.uid(),
      name: label,
      baseUrl: DS.settings.baseUrl,
      apiKey: DS.settings.apiKey,
      model: DS.settings.model,
      models: (DS.settings.models || []).slice(),
      modelCustom: DS.settings.modelCustom || '',
      format: DS.settings.apiFormat || 'openai'
    };
    DS.settings.providers = [p];
    DS.settings.activeProviderId = p.id;
    DS.saveSettings();
  };

  DS.baseUrlNormalized = function () {
    var u = (DS.settings.baseUrl || '').trim();
    if (!u) return 'https://api.deepseek.com';
    u = u.replace(/\s+/g, '');
    u = u.replace(/\/+$/, '');
    u = u.replace(/\/chat\/completions$/i, '');
    u = u.replace(/\/completions$/i, '');
    u = u.replace(/\/messages$/i, '');
    return u;
  };

})(window.DS);
