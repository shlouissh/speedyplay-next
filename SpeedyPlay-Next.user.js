
 // ==UserScript==
 // @name         倍速播放 Next
 // @namespace    https://github.com/shlouissh/speedyplay-next
 // @version      1.1.0
 // @description  HTML5 视频倍速控制：0.1～20 倍、速度记忆、常用速度、拖动面板、动态视频支持；兼容 YouTube Trusted Types
 // @author       shlouissh
 // @license      MIT
 // @icon         https://raw.githubusercontent.com/shlouissh/speedyplay-next/main/speedyplay-icon.png?v=2
 // @match        *://*/*
 // @noframes
 // @grant        none
 // @run-at       document-idle
 // ==/UserScript==

 (() => {
   'use strict';

   // ===== 可自定义的设置 =====
   const STORAGE_KEY = 'speedyplayNext.settings.v1';
   const MIN_RATE = 0.1;
   const MAX_RATE = 20;
   const MAX_PRESETS = 6;
   const PANEL_OPACITY = 0.6; // 面板背景不透明度：0～1。0.85 为轻微透明。
   const DEFAULTS = {
     rate: 1,
     previousRate: 1,
     presets: [1, 1.25, 1.5, 2, 3], // 默认的常用倍速；已保存的设置优先
     x: null, // null 表示默认靠右
     y: 100,
     collapsed: false
   };

   // 拒绝在 iframe 中重复运行（@noframes 的附加保险）。
   if (window.top !== window.self) return;

   let settings = loadSettings();
   let panelHost = null;
   let shadow = null;
   let reopenButton = null;
   let observer = null;
   let lastActiveVideo = null;
   let dragState = null;
   let isHiddenByUser = false;
   let pendingScan = false;
   const trackedVideos = new WeakSet();

   function clampRate(value) {
     if (!Number.isFinite(value)) return 1;
     return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(value * 100) / 100));
   }

   function formatRate(value) {
     return `${Number(value.toFixed(2))}×`;
   }

   function loadSettings() {
     let saved = {};
     try {
       saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
       if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
     } catch (_) { saved = {}; }

     const result = { ...DEFAULTS, ...saved };
     result.rate = clampRate(Number(result.rate));
     result.previousRate = clampRate(Number(result.previousRate));
     result.presets = Array.isArray(result.presets)
       ? [...new Set(result.presets.map(Number).filter(
           n => Number.isFinite(n) && n >= MIN_RATE && n <= MAX_RATE
         ).map(clampRate))].slice(0, MAX_PRESETS)
       : [...DEFAULTS.presets];
     if (!result.presets.length) result.presets = [...DEFAULTS.presets];
     result.x = Number.isFinite(Number(result.x)) && result.x !== null
       ? Math.max(0, Number(result.x)) : null;
     result.y = Number.isFinite(Number(result.y)) ? Math.max(0, Number(result.y)) : 100;
     result.collapsed = Boolean(result.collapsed);
     return result;
   }

   function saveSettings() {
     try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
     catch (_) { /* 某些网页禁止本地存储；此时仅在当前页有效 */ }
   }

   function getVideos() {
     return [...document.querySelectorAll('video')];
   }

   function applyRate(video, rate) {
     if (!video || !video.isConnected) return;
     try {
       if (Math.abs(video.playbackRate - rate) > 0.001) video.playbackRate = rate;
       if (Math.abs(video.defaultPlaybackRate - rate) > 0.001) video.defaultPlaybackRate = rate;
     } catch (_) { /* 某些特殊播放器不支持指定速度 */ }
   }

   function applyRateToAll(rate) {
     getVideos().forEach(video => applyRate(video, rate));
     if (lastActiveVideo?.isConnected) applyRate(lastActiveVideo, rate);
   }

   function setRate(value, remember = true) {
     const number = Number(value);
     if (!Number.isFinite(number) || number < MIN_RATE || number > MAX_RATE) return false;
     const rate = clampRate(number);
     if (remember && Math.abs(rate - settings.rate) > 0.001) {
       settings.previousRate = settings.rate;
     }
     settings.rate = rate;
     saveSettings();
     applyRateToAll(rate);
     updateUI();
     return true;
   }

   function togglePreviousRate() {
     const oldRate = settings.rate;
     const target = settings.previousRate;
     if (Math.abs(oldRate - target) < 0.001) return;
     settings.previousRate = oldRate;
     setRate(target, false);
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
     video.addEventListener('loadedmetadata', markActive, { passive: true });
     video.addEventListener('ratechange', () => {
       // 有的网站会自行恢复 1 倍速；仅当当前速度不同才尝试纠正。
       if (Math.abs(video.playbackRate - settings.rate) > 0.02) {
         queueMicrotask(() => {
           if (video.isConnected && Math.abs(video.playbackRate - settings.rate) > 0.02) {
             applyRate(video, settings.rate);
           }
         });
       }
     }, { passive: true });
     applyRate(video, settings.rate);
   }

   function scanVideos() {
     const videos = getVideos();
     videos.forEach(trackVideo);
     if (videos.length) {
       if (!panelHost || !panelHost.isConnected) createPanel();
       updateVisibility(true);
     } else {
       updateVisibility(false);
     }
   }

   function scheduleScan() {
     if (pendingScan) return;
     pendingScan = true;
     queueMicrotask(() => {
       pendingScan = false;
       try { scanVideos(); }
       catch (error) { console.error('[倍速播放 Next] 扫描视频失败', error); }
     });
   }

   function observePage() {
     scheduleScan();
     observer = new MutationObserver(records => {
       // 我们自身 UI 的增删也会触发 MutationObserver；只在有视频元素
       // 被增删、或页面主要节点被替换时才重新扫描。
       for (const record of records) {
         const changed = [...record.addedNodes, ...record.removedNodes];
         if (changed.some(node => node.nodeType === 1 &&
           (node.localName === 'video' || node.querySelector?.('video')))) {
           scheduleScan();
           return;
         }
       }
     });
     observer.observe(document.documentElement, { childList: true, subtree: true });
     // YouTube 是单页应用：跳转时再扫描一次。
     window.addEventListener('popstate', () => setTimeout(scheduleScan, 150));
     window.addEventListener('pageshow', scheduleScan);
     document.addEventListener('yt-navigate-finish', () => setTimeout(scheduleScan, 150));
   }

   // 只用 DOM API 构造元素，不使用 innerHTML / insertAdjacentHTML。
   // YouTube 的 Trusted Types 策略会阻止不可信字符串写入 innerHTML。
   function element(tag, attrs = {}, children = []) {
     const node = document.createElement(tag);
     for (const [key, value] of Object.entries(attrs)) {
       if (key === 'text') node.textContent = String(value);
       else if (key === 'class') node.className = value;
       else node.setAttribute(key, String(value));
     }
     for (const child of children) {
       node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
     }
     return node;
   }

   function button(id, label, title = '') {
     const attrs = { id, type: 'button', text: label };
     if (title) attrs.title = title;
     return element('button', attrs);
   }

   function createPanel() {
     if (panelHost?.isConnected) return;
     // 创建失败时允许下一次重试，不保留半成品引用。
     panelHost = null;
     shadow = null;
     try {
       const host = document.createElement('div');
       host.id = 'speedyplay-next-host';
       host.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;';
       const root = host.attachShadow({ mode: 'open' });

       const style = document.createElement('style');
       style.textContent = `
         :host { all: initial; }
         *, *::before, *::after { box-sizing: border-box; }
         .panel {
           position: fixed; width: 260px; color: #f5f5f5;
           background: rgba(27, 29, 34, ${PANEL_OPACITY});
           border: 1px solid rgba(255,255,255,.16);
           border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.28);
           font: 13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
           overflow: hidden; user-select: none; backdrop-filter: blur(10px);
           z-index: 2147483647;
         }
         .header { display:flex; align-items:center; justify-content:space-between;
           gap:8px; padding:10px 11px; background:rgba(255,255,255,.06); cursor:move; }
         .brand { font-weight:700; letter-spacing:.2px; }
         .header-actions { display:flex; gap:5px; }
         button { font:inherit; color:inherit; border:1px solid rgba(255,255,255,.16);
           background:rgba(255,255,255,.08); border-radius:7px; padding:5px 8px;
           cursor:pointer; }
         button:hover { background:rgba(255,255,255,.16); }
         button:focus-visible, input:focus-visible { outline:2px solid #8ab4ff; outline-offset:2px; }
         .body { padding:11px; display:grid; gap:10px; }
         .rate-row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
         .rate { font-size:24px; font-weight:750; letter-spacing:-.5px; cursor:pointer; }
         .small { color:#b9bdc7; font-size:11px; }
         .controls { display:flex; align-items:center; gap:6px; }
         .controls button { flex:1; }
         input[type=range] { width:100%; accent-color:#8ab4ff; margin:0; }
         .presets { display:flex; flex-wrap:wrap; gap:6px; }
         .presets button { min-width:46px; flex:1; }
         .presets button.active { border-color:#8ab4ff; background:rgba(138,180,255,.2); }
         .footer { display:flex; justify-content:space-between; align-items:center; gap:8px; }
         .hidden { display:none !important; }
         .edit-row { display:flex; gap:6px; align-items:center; }
         .edit-row input { width:70px; min-width:0; color:#f5f5f5; background:#17191d;
           border:1px solid #555b66; border-radius:6px; padding:6px; }
         @media (max-width:420px) { .panel { width:238px; } }
       `;
       root.appendChild(style);

       const panel = element('section', { class: 'panel', 'aria-label': '倍速播放控制面板' }, [
         element('div', { class: 'header', id: 'drag-handle' }, [
           element('span', { class: 'brand', text: '倍速播放 Next' }),
           element('div', { class: 'header-actions' }, [
             button('collapse', '−', '折叠面板'),
             button('hide', '×', '隐藏面板')
           ])
         ]),
         element('div', { class: 'body', id: 'body' }, [
           element('div', { class: 'rate-row' }, [
             element('div', {}, [
               element('div', { class: 'small', text: '当前速度' }),
               element('div', { class: 'rate', id: 'rate', text: '1×', title: '双击切换上次速度' })
             ]),
             button('toggle', '切换上次', '切换到上一次使用的速度')
           ]),
           element('input', {
             id: 'slider', type: 'range', min: '0.1', max: '4', step: '0.1',
             value: '1', 'aria-label': '播放速度'
           }),
           element('div', { class: 'controls' }, [
             button('minus', '− 0.1'), button('normal', '1× 正常'), button('plus', '+ 0.1')
           ]),
           element('div', { class: 'small', text: `常用速度（最多 ${MAX_PRESETS} 个）` }),
           element('div', { class: 'presets', id: 'presets' }),
           element('div', { class: 'edit-row' }, [
             element('input', {
               id: 'custom', type: 'number', min: '0.1', max: '20', step: '0.1',
               value: '1', 'aria-label': '自定义速度'
             }),
             button('apply-custom', '应用'), button('add-preset', '＋常用')
           ]),
           element('div', { class: 'footer' }, [
             element('span', { class: 'small', id: 'status', text: '自动应用到页面视频' }),
             button('reset', '重置位置')
           ])
         ])
       ]);
       root.appendChild(panel);
       document.documentElement.appendChild(host);
       panelHost = host;
       shadow = root;
       bindUI();
       placePanel();
       updateUI();
     } catch (error) {
       panelHost?.remove();
       panelHost = null;
       shadow = null;
       console.error('[倍速播放 Next] 创建面板失败：', error);
     }
   }

   function $(selector) { return shadow?.querySelector(selector); }

   function bindUI() {
     $('#minus').addEventListener('click', () => setRate(Math.max(MIN_RATE, settings.rate - 0.1)));
     $('#plus').addEventListener('click', () => setRate(Math.min(MAX_RATE, settings.rate + 0.1)));
     $('#normal').addEventListener('click', () => setRate(1));
     $('#toggle').addEventListener('click', togglePreviousRate);
     $('#rate').addEventListener('dblclick', togglePreviousRate);
     $('#slider').addEventListener('input', event => setRate(Number(event.target.value)));
     $('#apply-custom').addEventListener('click', () => {
       if (!setRate($('#custom').value)) $('#status').textContent = '请输入 0.1～20 之间的速度';
     });
     $('#custom').addEventListener('keydown', event => {
       if (event.key === 'Enter') $('#apply-custom').click();
     });
     $('#add-preset').addEventListener('click', addPreset);
     $('#collapse').addEventListener('click', () => {
       settings.collapsed = !settings.collapsed;
       saveSettings();
       updateUI();
     });
     $('#hide').addEventListener('click', () => {
       isHiddenByUser = true;
       updateVisibility(getVideos().length > 0);
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
     const value = Number($('#custom').value);
     if (!Number.isFinite(value) || value < MIN_RATE || value > MAX_RATE) {
       $('#status').textContent = '请输入 0.1～20 之间的速度';
       return;
     }
     const rate = clampRate(value);
     if (settings.presets.some(n => Math.abs(n - rate) < 0.001)) {
       $('#status').textContent = '这个速度已经在常用列表中';
       return;
     }
     if (settings.presets.length >= MAX_PRESETS) {
       $('#status').textContent = `常用速度最多保存 ${MAX_PRESETS} 个，请先移除一个`;
       return;
     }
     settings.presets.push(rate);
     saveSettings();
     renderPresets();
     $('#status').textContent = '已添加常用速度';
   }

   function renderPresets() {
     const container = $('#presets');
     if (!container) return;
     container.replaceChildren();
     settings.presets.forEach(value => {
       const item = button('', formatRate(value), '点击应用；右键移除此常用速度');
       item.removeAttribute('id');
       if (Math.abs(value - settings.rate) < 0.001) item.classList.add('active');
       item.addEventListener('click', () => setRate(value));
       item.addEventListener('contextmenu', event => {
         event.preventDefault();
         if (settings.presets.length <= 1) {
           $('#status').textContent = '至少保留一个常用速度';
           return;
         }
         settings.presets = settings.presets.filter(n => Math.abs(n - value) >= 0.001);
         saveSettings();
         renderPresets();
       });
       container.appendChild(item);
     });
   }

   function updateUI() {
     if (!shadow) return;
     $('#rate').textContent = formatRate(settings.rate);
     $('#custom').value = String(settings.rate);
     $('#slider').value = String(Math.min(4, settings.rate));
     $('#slider').title = '滑块支持 0.1～4 倍；更高倍速请在输入框中填写';
     $('#collapse').textContent = settings.collapsed ? '+' : '−';
     $('#body').classList.toggle('hidden', settings.collapsed);
     renderPresets();
   }

   function placePanel() {
     const panel = $('.panel');
     if (!panel) return;
     const width = panel.offsetWidth || 260;
     const height = panel.offsetHeight || 40;
     if (settings.x === null) {
       panel.style.left = 'auto';
       panel.style.right = '18px';
     } else {
       const x = Math.max(0, Math.min(settings.x, Math.max(0, window.innerWidth - width)));
       panel.style.left = `${x}px`;
       panel.style.right = 'auto';
     }
     const y = Math.max(0, Math.min(settings.y, Math.max(0, window.innerHeight - height)));
     panel.style.top = `${y}px`;
   }

   function startDrag(event) {
     if (event.button !== 0 || event.target.closest('button')) return;
     const rect = $('.panel').getBoundingClientRect();
     dragState = {
       pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
       x: rect.left, y: rect.top
     };
     event.currentTarget.setPointerCapture?.(event.pointerId);
     event.preventDefault();
   }

   function moveDrag(event) {
     if (!dragState || event.pointerId !== dragState.pointerId) return;
     const panel = $('.panel');
     settings.x = Math.max(0, Math.min(
       window.innerWidth - panel.offsetWidth,
       dragState.x + event.clientX - dragState.startX
     ));
     settings.y = Math.max(0, Math.min(
       window.innerHeight - panel.offsetHeight,
       dragState.y + event.clientY - dragState.startY
     ));
     placePanel();
   }

   function endDrag(event) {
     if (!dragState || (event && event.pointerId !== dragState.pointerId)) return;
     dragState = null;
     saveSettings();
   }

   function showReopenButton() {
     if (reopenButton?.isConnected) return;
     const smallButton = document.createElement('button');
     smallButton.type = 'button';
     smallButton.textContent = `倍速 ${formatRate(settings.rate)}`;
     smallButton.title = '重新显示倍速播放面板';
     smallButton.style.cssText =
       'position:fixed;left:18px;top:18px;right:auto;bottom:auto;z-index:2147483647;' +
       'padding:8px 12px;border:0;border-radius:20px;' +
       'background:rgba(32,36,44,.92);color:#fff;font:13px system-ui;' +
       'box-shadow:0 2px 10px #0005;cursor:pointer;';
     smallButton.addEventListener('click', () => {
       isHiddenByUser = false;
       updateVisibility(getVideos().length > 0);
     });
     document.documentElement.appendChild(smallButton);
     reopenButton = smallButton;
   }

   function updateVisibility(hasVideo) {
     if (!hasVideo) {
       if (panelHost) panelHost.style.display = 'none';
       reopenButton?.remove();
       reopenButton = null;
       return;
     }
     if (isHiddenByUser) {
       if (panelHost) panelHost.style.display = 'none';
       showReopenButton();
     } else {
       if (panelHost) panelHost.style.display = '';
       reopenButton?.remove();
       reopenButton = null;
     }
   }

   function init() {
     if (!document.documentElement) return;
     observePage();
     applyRateToAll(settings.rate);
     window.addEventListener('resize', placePanel);
   }

   if (document.readyState === 'loading') {
     document.addEventListener('DOMContentLoaded', init, { once: true });
   } else {
     init();
   }
 })();
