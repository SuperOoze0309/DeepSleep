/* 对话转生
 *
 * 顶部那个蓝色加号：把当前对话交给模型压成一份「记忆摘要」，
 * 然后开一个新对话，把摘要作为长期记忆带过去。
 * 摘要只在请求里作为 system 注入，不占用可见的消息列表。
 */
window.DS = window.DS || {};
(function (DS) {
  'use strict';

  function E(id) { return document.getElementById(id); }

  var R = { running: false, ctrl: null, lastSummary: '' };

  var SYS_PROMPT = [
    '你是一个上下文压缩器。把用户给你的这段对话压缩成一份「记忆摘要」，',
    '让接手的助手在不看原文的情况下也能继续把事做完。',
    '',
    '必须保留：',
    '1. 用户的目标、需求，以及已经确认的结论',
    '2. 关键事实、数字、文件名、路径、命令、代码要点',
    '3. 用户的偏好与硬性要求（例如「不要用 X」「必须用 Y」）',
    '4. 尚未完成的事项和下一步',
    '',
    '可以丢弃：寒暄、重复内容、被推翻的中间尝试、思考过程。',
    '用要点列表写，控制在 800 字以内。',
    '直接输出摘要本身，不要任何前言、说明或客套话。'
  ].join('\n');

  /* ---------------- 把对话摊平成纯文本 ---------------- */

  function clampText(s, max) {
    if (s.length <= max) return s;
    // 开头是目标、结尾是最新进展，两头都比中间重要
    var head = Math.floor(max * 0.3);
    var tail = max - head;
    return s.slice(0, head) + '\n\n……（中间部分过长，已省略）……\n\n' + s.slice(s.length - tail);
  }

  function transcriptOf(convo) {
    var parts = [];
    for (var i = 0; i < convo.messages.length; i++) {
      var m = convo.messages[i];
      if (m.error) continue;
      var text = (m.content || '').trim();
      if (m.images && m.images.length) {
        text += (text ? '\n' : '') + '（附了 ' + m.images.length + ' 张图片）';
      }
      if (!text) continue;
      parts.push((m.role === 'user' ? '用户' : '助手') + '：' + text);
    }
    return clampText(parts.join('\n\n'), 26000);
  }

  /* ---------------- 遮罩 ---------------- */

  function overlay(show) {
    var el = E('rein-wrap');
    if (el) el.classList.toggle('hidden', !show);
  }

  function setStatus(text) {
    var el = E('rein-status');
    if (el) el.textContent = text;
  }

  /* ---------------- 调模型压缩 ---------------- */

  function summarize(convo, onProgress) {
    var acc = '';
    R.ctrl = new AbortController();
    return DS.api.chat({
      messages: [
        { role: 'system', content: SYS_PROMPT },
        { role: 'user', content: '请把下面这段对话压缩成记忆摘要：\n\n' + transcriptOf(convo) }
      ],
      model: DS.effectiveModel(),
      thinking: false,
      signal: R.ctrl.signal,
      onContent: function (d, full) {
        acc = full;
        onProgress(full.length);
      }
    }).then(function () {
      return acc.trim();
    });
  }

  /* ---------------- 流程 ---------------- */

  function run() {
    if (R.running) return;
    if (DS.ui && DS.ui.isBusy()) { DS.toast('正在生成中，请先停止', 2000); return; }

    var convo = DS.activeId ? DS.getConvo(DS.activeId) : null;
    if (!convo || !convo.messages.length) {
      DS.toast('当前对话还是空的，没什么可带的', 2200);
      return;
    }
    if (!(DS.settings.apiKey || '').trim()) {
      DS.toast('先去设置里填 API Key', 2400);
      return;
    }

    DS.ui.openDialog({
      title: '要带着记忆进入下一个对话吗？',
      desc: '我会先把当前这 ' + convo.messages.length +
        ' 条消息压缩成一份摘要，带进新对话继续用。\n不想带记忆的话，直接用旁边那个「新对话」即可。',
      okText: '带着记忆转生'
    }).then(function (ok) {
      if (ok) start(convo);
    });
  }

  function start(convo) {
    R.running = true;
    overlay(true);
    setStatus('正在阅读 ' + convo.messages.length + ' 条消息…');

    summarize(convo, function (n) {
      setStatus('正在归纳…已压缩 ' + n + ' 字');
    }).then(function (summary) {
      finish(convo, summary);
    }).catch(function (err) {
      R.running = false;
      overlay(false);
      if (DS.isAbort(err)) { DS.toast('已取消转生', 1800); return; }
      var msg = (err && err.message) ? err.message : String(err);
      DS.ui.openDialog({
        title: '压缩记忆失败',
        desc: msg + '\n\n要不要不带记忆，直接开一个新对话？',
        okText: '直接开新对话'
      }).then(function (ok) {
        if (ok) DS.ui.startNewChat();
      });
    });
  }

  function finish(convo, summary) {
    R.running = false;
    overlay(false);

    if (!summary) {
      DS.toast('摘要为空，已取消转生', 2400);
      return;
    }
    R.lastSummary = summary;

    var title = (convo.title && convo.title !== '新对话') ? ('转生 · ' + convo.title) : '转生对话';
    if (title.length > 22) title = title.slice(0, 22) + '…';

    var c = DS.newConvo({ title: title, memory: summary });
    DS.ui.switchView('chat');
    DS.ui.showConvo(c.id);
    DS.ui.renderConvList();
    DS.toast('已带着记忆进入新对话（摘要 ' + summary.length + ' 字）', 2800);

    // 顺带把这段对话沉淀成长期记忆。失败也不影响转生本身，所以静默处理。
    if (DS.settings.autoMemory !== false && DS.memory && DS.memory.enabledFor(convo)) {
      DS.memory.extract(convo).then(function (r) {
        if (r && (r.added || r.merged) && DS.ui && DS.ui.refreshMemory) {
          DS.ui.refreshMemory();
        }
      }).catch(function () { /* 忽略 */ });
    }
  }

  DS.reincarnate = {
    bind: function () {
      var btn = E('btn-reincarnate');
      if (btn) btn.addEventListener('click', run);
      var cancel = E('rein-cancel');
      if (cancel) {
        cancel.addEventListener('click', function () {
          if (R.ctrl) { try { R.ctrl.abort(); } catch (e) { /* ignore */ } }
        });
      }
    },
    lastSummary: function () { return R.lastSummary; },
    // 供测试直接驱动，不必真的发请求
    _transcript: transcriptOf,
    _run: run
  };

})(window.DS);
