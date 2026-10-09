// ==UserScript==
// @name         倍速播放 Next
// @namespace    https://github.com/shlouissh/speedyplay-next
// @version      1.0.0
// @description  HTML5 视频倍速控制器：0.1～20 倍、记忆速度、常用速度、面板位置与动态视频支持
// @author       shlouissh
// @license      MIT
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  const STORAGE_KEY = 'speedyplayNext.settings.v1';
  const MIN_RATE = 0.1;
  const MAX_RATE = 20;
  const DEFAULTS = {
    rate: 1,
    previousRate: 1,
    presets: [1, 1.25, 1.5, 1.75, 2],
    x: null,
    y: 100,
    collapsed: false
  };

  let settings = loadSettings();
  let panelHost = null;
  let shadow = null;
  let videoObserver = null;
  const trackedVideos = new WeakSet();
  let lastActiveVideo = null;
  let dragState = null;

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const result = { ...DEFAULTS, ...saved };
      result.rate = clampRate(Number(result.rate) || 1);
      result.previousRate = clampRate(Number(result.previousRate) || 1);
      result.presets = Array.isArray(result.presets)
        ? [...new Set(result.presets.map(Number).filter(
            n => Number.isFinite(n) && n >= MIN_RATE && n <= MAX_RATE
          ))].slice(0, 6)
        : [...DEFAULTS.presets];
      if (!result.presets.length) result.presets = [...DEFAULTS.presets];
      return result;
    } catch (_) {
      return { ...DEFAULTS, presets: [...DEFAULTS.presets] };
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (_) {}
  }

  function clampRate(value) {
    return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(value * 100) / 100));
  }

  function formatRate(value) {
    return `${Number(value.toFixed(2))}×`;
  }

  function getVideos() {
    return Array.from(document.querySelectorAll('video'));
  }

  function applyRate(video, rate) {
    if (!video || !Number.isFinite(rate)) return;
    try {
      video.playbackRate = clampRate(rate);
      video.defaultPlaybackRate = clampRate(rate);
    } catch (_) {}
  }

  function applyRateToAll(rate) {
    const videos = getVideos();
    videos.forEach(video => applyRate(video, rate));
    if (lastActiveVideo && !videos.includes(lastActiveVideo)) {
      applyRate(lastActiveVideo, rate);
    }
  }

  function setRate(rate, remember = true) {
    rate = clampRate(Number(rate));
    if (!Number.isFinite(rate)) return;

    if (remember && Math.abs(rate - settings.rate) > 0.001) {
      settings.previousRate = settings.rate;
    }

    settings.rate = rate;
    saveSettings();
    applyRateToAll(rate);
    updateUI();
  }

  function trackVideo(video) {
    if (trackedVideos.has(video)) return;
    trackedVideos.add(video);

    const markActive = () => {
      lastActiveVideo = video;
      applyRate(video, settings.rate);
    };

    video.addEventListener('play', markActive, { passive: true });
    video.addEventListener('playing', markActive, { passive: true });
    video.addEventListener(
      'loadedmetadata',
      () => applyRate(video, settings.rate),
      { passive: true }
    );

    video.addEventListener('ratechange', () => {
      // 若网站播放器主动改速，尝试恢复用户设置。
      if (Math.abs(video.playbackRate - settings.rate) > 0.02) {
        queueMicrotask(() => {
          if (Math.abs(video.playbackRate - settings.rate) > 0.02) {
            applyRate(video, settings.rate);
          }
        });
      }
    }, { passive: true });

    applyRate(video, settings.rate);
  }

  function scanVideos(root = document) {
    if (root instanceof HTMLVideoElement) trackVideo(root);
    if (root.querySelectorAll) {
      root.querySelectorAll('video').forEach(trackVideo);
    }
  }

  function observePage() {
    scanVideos();

    videoObserver = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) scanVideos(node);
        }
      }
    });

    const start = () => {
      if (document.documentElement && videoObserver) {
        videoObserver.observe(document.documentElement, {
          childList: true,
          subtree: true
        });
      }
    };

    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  function createPanel() {
    if (panelHost || !document.documentElement) return;

    panelHost = document.createElement('div');
    panelHost.id = 'speedyplay-next-host';
    panelHost.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;';
    shadow = panelHost.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .panel {
          position: fixed; left: var(--x, auto); top: var(--y, 100px);
          right: var(--right, 18px); width: 260px; color: #f5f5f5;
          background: rgba(27, 29, 34, .96);
          border: 1px solid rgba(255,255,255,.16);
          border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.28);
          font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          overflow: hidden; user-select: none; backdrop-filter: blur(10px);
        }
        .header {
          display:flex; align-items:center; justify-content:space-between; gap:8px;
          padding:10px 11px; background:rgba(255,255,255,.06); cursor:move;
        }
        .brand { font-weight:700; letter-spacing:.2px; }
        .header-actions { display:flex; gap:5px; }
        button {
          font:inherit; color:inherit;
          border:1px solid rgba(255,255,255,.16);
          background:rgba(255,255,255,.08);
          border-radius:7px; padding:5px 8px; cursor:pointer;
        }
        button:hover { background:rgba(255,255,255,.16); }
        button:focus-visible, input:focus-visible {
          outline:2px solid #8ab4ff; outline-offset:2px;
        }
        .body { padding:11px; display:grid; gap:10px; }
        .rate-row {
          display:flex; align-items:center; justify-content:space-between; gap:8px;
        }
        .rate { font-size:24px; font-weight:750; letter-spacing:-.5px; }
        .small { color:#b9bdc7; font-size:11px; }
        .controls { display:flex; align-items:center; gap:6px; }
        .controls button { flex:1; }
        input[type=range] { width:100%; accent-color:#8ab4ff; margin:0; }
        .presets { display:flex; flex-wrap:wrap; gap:6px; }
        .presets button { min-width:46px; flex:1; }
        .presets button.active {
          border-color:#8ab4ff; background:rgba(138,180,255,.2);
        }
        .footer {
          display:flex; justify-content:space-between; align-items:center; gap:8px;
        }
        .hidden { display:none !important; }
        .edit-row { display:flex; gap:6px; align-items:center; }
        .edit-row input {
          width:70px; min-width:0; color:#f5f5f5; background:#17191d;
          border:1px solid #555b66; border-radius:6px; padding:6px;
        }
        @media (max-width: 420px) { .panel { width:238px; } }
      </style>
      <section class="panel" aria-label="倍速播放控制面板">
        <div class="header" id="drag-handle">
          <span class="brand">倍速播放 Next</span>
          <div class="header-actions">
            <button id="collapse" title="折叠面板">−</button>
            <button id="hide" title="隐藏面板">×</button>
          </div>
        </div>
        <div class="body" id="body">
          <div class="rate-row">
            <div>
              <div class="small">当前速度</div>
              <div class="rate" id="rate">1×</div>
            </div>
            <button id="toggle" title="切换到上一次使用的速度">切换上次</button>
          </div>
          <input id="slider" type="range" min="0.1" max="4" step="0.1"
                 value="1" aria-label="播放速度" />
          <div class="controls">
            <button id="minus">− 0.1</button>
            <button id="normal">1× 正常</button>
            <button id="plus">+ 0.1</button>
          </div>
          <div class="small">常用速度（最多 6 个）</div>
          <div class="presets" id="presets"></div>
          <div class="edit-row">
            <input id="custom" type="number" min="0.1" max="20" step="0.1"
                   value="1" aria-label="自定义速度" />
            <button id="apply-custom">应用</button>
            <button id="add-preset">＋常用</button>
          </div>
          <div class="footer">
            <span class="small" id="status">自动应用到页面视频</span>
            <button id="reset">重置位置</button>
          </div>
        </div>
      </section>
    `;

    document.documentElement.appendChild(panelHost);
    bindUI();
    placePanel();
    updateUI();
  }
  function $(selector) {
    return shadow.querySelector(selector);
  }

  function bindUI() {
    $('#minus').addEventListener('click', () => setRate(settings.rate - 0.1));
    $('#plus').addEventListener('click', () => setRate(settings.rate + 0.1));
    $('#normal').addEventListener('click', () => setRate(1));

    $('#toggle').addEventListener('click', () => {
      const target = settings.previousRate;
      setRate(target, false);
    });

    $('#rate').addEventListener('dblclick', () => {
      setRate(settings.previousRate, false);
    });

    $('#slider').addEventListener('input', event => {
      setRate(Number(event.target.value));
    });

    $('#apply-custom').addEventListener('click', () => {
      const value = Number($('#custom').value);
      if (Number.isFinite(value) && value >= MIN_RATE && value <= MAX_RATE) {
        setRate(value);
      } else {
        $('#status').textContent = '请输入 0.1～20 之间的速度';
      }
    });

    $('#custom').addEventListener('keydown', event => {
      if (event.key === 'Enter') $('#apply-custom').click();
    });

    $('#add-preset').addEventListener('click', addPreset);

    $('#collapse').addEventListener('click', () => {
      settings.collapsed = !settings.collapsed;
      $('#body').classList.toggle('hidden', settings.collapsed);
      $('#collapse').textContent = settings.collapsed ? '+' : '−';
      saveSettings();
    });

    $('#hide').addEventListener('click', () => {
      panelHost.style.display = 'none';
      showReopenButton();
    });

    $('#reset').addEventListener('click', () => {
      settings.x = null;
      settings.y = 100;
      saveSettings();
      placePanel();
    });

    $('#drag-handle').addEventListener('pointerdown', startDrag);
    shadow.addEventListener('pointermove', moveDrag);
    shadow.addEventListener('pointerup', endDrag);
    shadow.addEventListener('pointercancel', endDrag);
  }

  function addPreset() {
    const rawValue = Number($('#custom').value);

    if (!Number.isFinite(rawValue) ||
        rawValue < MIN_RATE ||
        rawValue > MAX_RATE) {
      $('#status').textContent = '请输入 0.1～20 之间的速度';
      return;
    }

    const value = clampRate(rawValue);

    if (settings.presets.some(n => Math.abs(n - value) < 0.001)) {
      $('#status').textContent = '这个速度已经在常用列表中';
      return;
    }

    if (settings.presets.length >= 6) {
      $('#status').textContent = '常用速度最多保存 6 个，请先移除一个';
      return;
    }

    settings.presets.push(value);
    saveSettings();
    renderPresets();
  }

  function renderPresets() {
    const container = $('#presets');
    container.replaceChildren();

    settings.presets.forEach(value => {
      const button = document.createElement('button');
      button.textContent = formatRate(value);
      button.title = '点击应用；右键移除此常用速度';

      if (Math.abs(value - settings.rate) < 0.001) {
        button.classList.add('active');
      }

      button.addEventListener('click', () => setRate(value));

      button.addEventListener('contextmenu', event => {
        event.preventDefault();

        if (settings.presets.length <= 1) {
          $('#status').textContent = '至少保留一个常用速度';
          return;
        }

        settings.presets = settings.presets.filter(
          n => Math.abs(n - value) >= 0.001
        );

        saveSettings();
        renderPresets();
      });

      container.appendChild(button);
    });
  }
  function updateUI() {
    if (!shadow) return;

    $('#rate').textContent = formatRate(settings.rate);
    $('#custom').value = String(settings.rate);
    $('#slider').value = String(Math.min(4, settings.rate));
    $('#slider').max = '4';
    $('#slider').title = '滑块支持 0.1～4 倍；更高倍速请在输入框中填写';

    $('#collapse').textContent = settings.collapsed ? '+' : '−';
    $('#body').classList.toggle('hidden', settings.collapsed);

    renderPresets();
  }

  function placePanel() {
    if (!shadow) return;

    const panel = $('.panel');

    if (settings.x == null) {
      panel.style.left = 'auto';
      panel.style.right = '18px';
    } else {
      panel.style.left = `${Math.max(0, settings.x)}px`;
      panel.style.right = 'auto';
    }

    panel.style.top = `${Math.max(0, settings.y)}px`;
  }

  function startDrag(event) {
    if (event.target.closest('button')) return;

    const panel = $('.panel');
    const rect = panel.getBoundingClientRect();

    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: rect.left,
      y: rect.top
    };

    event.target.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function moveDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;

    settings.x = Math.max(
      0,
      Math.min(
        window.innerWidth - 80,
        dragState.x + event.clientX - dragState.startX
      )
    );

    settings.y = Math.max(
      0,
      Math.min(
        window.innerHeight - 40,
        dragState.y + event.clientY - dragState.startY
      )
    );

    placePanel();
  }

  function endDrag(event) {
    if (!dragState ||
        (event && event.pointerId !== dragState.pointerId)) {
      return;
    }

    dragState = null;
    saveSettings();
  }

  function showReopenButton() {
    const button = document.createElement('button');

    button.textContent = '倍速';
    button.title = '显示倍速播放面板';
    button.style.cssText =
      'position:fixed;right:12px;bottom:18px;z-index:2147483647;' +
      'padding:8px 12px;border:0;border-radius:20px;' +
      'background:#20242c;color:#fff;font:13px system-ui;' +
      'box-shadow:0 2px 10px #0005;cursor:pointer;';

    button.addEventListener('click', () => {
      button.remove();
      panelHost.style.display = '';
    }, { once: true });

    document.documentElement.appendChild(button);
  }

  function init() {
    observePage();
    createPanel();

    // 页面后续动态插入的视频会由 MutationObserver 发现。
    applyRateToAll(settings.rate);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
