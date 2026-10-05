/* 朗读（系统 TextToSpeech）
 *
 * 只保留 TTS。语音输入（SpeechRecognizer）在部分机型上不可靠，
 * 按需求整体移除了 —— 连同麦克风按钮、设置项与 RECORD_AUDIO 权限。
 *
 * 原生侧回调：__onTtsReady / __onTtsState / __onTtsError
 */
window.DS = window.DS || {};
(function (DS) {
  'use strict';

  function E(id) { return document.getElementById(id); }

  function bridge() {
    try { return window.AndroidBridge || null; } catch (e) { return null; }
  }

  var T = { ready: false, voices: [], speakingId: null };

  function updateSpeakButtons() {
    var list = document.querySelectorAll('#messages .act[data-act="speak"]');
    for (var i = 0; i < list.length; i++) {
      var msgEl = list[i].closest('.msg');
      var id = msgEl ? msgEl.getAttribute('data-id') : null;
      list[i].classList.toggle('on', !!id && id === T.speakingId);
    }
  }

  function fillVoiceSelect() {
    var sel = E('set-voice');
    if (!sel) return;
    var cur = DS.settings.ttsVoice || '';
    var html = '<option value="">跟随系统默认</option>';
    for (var i = 0; i < T.voices.length; i++) {
      var v = T.voices[i];
      html += '<option value="' + DS.escapeHtml(v.name) + '">' +
        DS.escapeHtml(v.label || v.name) + '</option>';
    }
    sel.innerHTML = html;
    sel.value = cur;
    var hint = E('voice-hint');
    if (hint) {
      hint.textContent = T.voices.length
        ? ('检测到 ' + T.voices.length + ' 个离线音色，可逐个试听')
        : '没有检测到可用音色，请先在系统的「文字转语音」里安装语音数据';
    }
  }

  DS.tts = {
    available: function () {
      var b = bridge();
      if (!b || !b.ttsAvailable) return false;
      try { return !!b.ttsAvailable(); } catch (e) { return false; }
    },

    /** 让原生初始化引擎并回报音色列表 */
    init: function () {
      var b = bridge();
      if (!b || !b.ttsInit) return;
      try { b.ttsInit(); } catch (e) { /* ignore */ }
    },

    voices: function () { return T.voices.slice(); },
    speak: function (text, msgId) {
      var b = bridge();
      if (!b || !b.ttsSpeak) { DS.toast('当前设备不支持朗读'); return false; }
      var plain = DS.md.speechText(text);
      if (!plain) return false;
      T.speakingId = msgId || null;
      try { b.ttsSpeak(plain); } catch (e) { DS.toast('朗读失败'); return false; }
      updateSpeakButtons();
      return true;
    },

    stop: function () {
      var b = bridge();
      try { if (b && b.ttsStop) b.ttsStop(); } catch (e) { /* ignore */ }
      T.speakingId = null;
      updateSpeakButtons();
    },

    /**
     * 同一句再点一次 = 停止；点另一句 = 换过去念。
     * 注意：只要当前有朗读在进行，就先无条件停一次 ——
     * 之前的版本完全依赖 speakingId 精确匹配，
     * 一旦原生那边的事件把状态冲掉，再点就变成「重新开始」而不是「停止」。
     */
    toggle: function (text, msgId) {
      if (T.speakingId) {
        var same = (T.speakingId === msgId);
        DS.tts.stop();
        if (same) return;
      }
      DS.tts.speak(text, msgId);
    },

    applySettings: function () {
      var b = bridge();
      if (!b) return;
      try {
        if (b.ttsSetVoice) b.ttsSetVoice(DS.settings.ttsVoice || '');
        if (b.ttsSetRate) b.ttsSetRate(Number(DS.settings.ttsRate) || 1);
        if (b.ttsSetPitch) b.ttsSetPitch(Number(DS.settings.ttsPitch) || 1);
      } catch (e) { /* ignore */ }
    },

    refreshVoices: function () {
      var b = bridge();
      if (!b || !b.ttsVoices) { fillVoiceSelect(); return; }
      try {
        T.voices = JSON.parse(b.ttsVoices() || '[]');
      } catch (e) { T.voices = []; }
      fillVoiceSelect();
    },

    preview: function () {
      DS.tts.toggle('你好，我是 DeepSleep，这是当前音色的效果。', '__preview__');
    }
  };

  window.__onTtsReady = function (voicesJson) {
    T.ready = true;
    try { T.voices = JSON.parse(voicesJson || '[]'); } catch (e) { T.voices = []; }
    fillVoiceSelect();
    DS.tts.applySettings();
  };

  window.__onTtsState = function (state) {
    if (state === 'idle') T.speakingId = null;
    updateSpeakButtons();
  };

  window.__onTtsError = function (msg) {
    T.speakingId = null;
    updateSpeakButtons();
    if (msg) DS.toast(String(msg), 2400);
  };

  /** 供外部（消息渲染完成时）刷新按钮状态 */
  DS.voiceRefresh = function () {
    updateSpeakButtons();
    if (DS.tts.available() && !T.ready) DS.tts.init();
  };

})(window.DS);
