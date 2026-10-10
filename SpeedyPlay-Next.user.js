// ==UserScript==
// @name         倍速播放 Next
// @namespace    https://github.com/shlouissh/speedyplay-next
// @version      1.2.1
// @description  HTML5 倍速控制：悬停展开、固定窗口、速度记忆、动态视频支持；兼容 YouTube
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

   // ===== 用户可修改的配置 =====
   const STORAGE_KEY = 'speedyplayNext.settings.v1';
   const ICON_URL = 'https://raw.githubusercontent.com/shlouissh/speedyplay-next/main/speedyplay-icon.png?v=2';
   const PANEL_OPACITY = 0.85; // 背景不透明度：0~1
   const MIN_RATE = 0.1;
   const MAX_RATE = 20;
   const MAX_PRESETS = 6;
   const DEFAULTS = {
     rate: 1,
     previousRate: 1,
     presets: [1, 1.25, 1.5, 1.75, 2],
     x: null,
     y: 100,
     pinned: false // false：悬停展开，移开折叠；true：始终展开
   };

   if (window.top !== window.self) return;

   let settings = loadSettings();
   // 当前正在编辑的常用速度索引
   // null 表示没有选中预设
   let selectedPresetIndex = null;
   let panelHost = null;
   let shadow = null;
   let reopenButton = null;
   let hovered = false;
   let dragging = null;
   let hiddenByUser = false;
   let scanQueued = false;
   let lastActiveVideo = null;
   const trackedVideos = new WeakSet();

   function clampRate(value) {
     return Number.isFinite(value)
       ? Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(value * 100) / 100)) : 1;
   }
   function formatRate(value) { return `${Number(value.toFixed(2))}×`; }

   function loadSettings() {
     let saved = {};
     try {
       const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
       if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed;
     } catch (_) { /* 本地存储可能不可用 */ }
     const result = { ...DEFAULTS, ...saved };
     result.rate = clampRate(Number(result.rate));
     result.previousRate = clampRate(Number(result.previousRate));
     result.presets = Array.isArray(result.presets)
       ? [...new Set(result.presets.map(Number).filter(
           n => Number.isFinite(n) && n >= MIN_RATE && n <= MAX_RATE
         ).map(clampRate))].slice(0, MAX_PRESETS)
       : [...DEFAULTS.presets];
     if (!result.presets.length) result.presets = [...DEFAULTS.presets];
     result.x = result.x === null || !Number.isFinite(Number(result.x))
       ? null : Math.max(0, Number(result.x));
     result.y = Number.isFinite(Number(result.y)) ? Math.max(0, Number(result.y)) : 100;
     result.pinned = result.pinned === true;
     return result;
   }

   function saveSettings() {
     try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
     catch (_) { /* 忽略禁用本地存储的站点 */ }
   }

   function getVideos() { return [...document.querySelectorAll('video')]; }

   function applyRate(video, rate) {
     if (!video?.isConnected) return;
     try {
       if (Math.abs(video.playbackRate - rate) > 0.001) video.playbackRate = rate;
       if (Math.abs(video.defaultPlaybackRate - rate) > 0.001) video.defaultPlaybackRate = rate;
     } catch (_) { /* 某些播放器限制倍速 */ }
   }

   function applyRateToAll(rate) {
     getVideos().forEach(v => applyRate(v, rate));
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
     if (Math.abs(oldRate - settings.previousRate) < 0.001) return;
     const previous = settings.previousRate;
     settings.previousRate = oldRate;
     setRate(previous, false);
   }

   function trackVideo(video) {
     if (trackedVideos.has(video)) return;
     trackedVideos.add(video);
     const markActive = () => {
       lastActiveVideo = video;
       applyRate(video, settings.rate);
     };
     for (const eventName of ['play', 'playing', 'loadedmetadata']) {
       video.addEventListener(eventName, markActive, { passive: true });
     }
     video.addEventListener('ratechange', () => {
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
       if (!panelHost?.isConnected) createPanel();
       updateVisibility(true);
     } else {
       updateVisibility(false);
     }
   }

   function scheduleScan() {
     if (scanQueued) return;
     scanQueued = true;
     queueMicrotask(() => {
       scanQueued = false;
       try { scanVideos(); }
       catch (error) { console.error('[倍速播放 Next] 视频扫描失败：', error); }
     });
   }

   function observePage() {
     scheduleScan();
     new MutationObserver(records => {
       for (const record of records) {
         const changed = [...record.addedNodes, ...record.removedNodes];
         if (changed.some(node => node.nodeType === 1 &&
           (node.localName === 'video' || node.querySelector?.('video')))) {
           scheduleScan();
           return;
         }
       }
     }).observe(document.documentElement, { childList: true, subtree: true });
     window.addEventListener('popstate', () => setTimeout(scheduleScan, 150));
     window.addEventListener('pageshow', scheduleScan);
     document.addEventListener('yt-navigate-finish', () => setTimeout(scheduleScan, 150));
   }

   // 安全地构造 DOM，避免 YouTube 的 Trusted Types 拦截 innerHTML。
   function el(tag, attrs = {}, children = []) {
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
   function btn(id, label, title = '') {
     return el('button', { id, type: 'button', text: label, title });
   }
   function $(selector) { return shadow?.querySelector(selector); }

   // ===== 新折叠逻辑 =====
   // 未固定时：鼠标离开自动折叠，鼠标进入自动展开。
   // 固定后：始终展开，直到再次点击「取消固定」。
   function updatePanelMode() {
     if (!shadow) return;
     const expanded = settings.pinned || hovered || !!dragging;
     $('.panel').classList.toggle('compact', !expanded);
     $('.panel').classList.toggle('expanded', expanded);
     $('#pin').textContent = settings.pinned ? '取消固定' : '固定窗口';
     $('#pin').title = settings.pinned ? '取消固定，恢复鼠标悬停展开' : '固定窗口，始终保持展开';
     // 窗口宽度改变后，重新校正屏幕范围。
     placePanel();
   }

   function createPanel() {
     if (panelHost?.isConnected) return;
     let host = null;
     try {
       host = el('div', { id: 'speedyplay-next-host' });
       host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;';
       const root = host.attachShadow({ mode: 'open' });
       const style = el('style');
       style.textContent = `
         :host { all: initial; }
         *, *::before, *::after { box-sizing: border-box; }
         .panel {
           position: fixed; width: 260px; top:100px;
           color:#f5f5f5; background:rgba(27,29,34,${PANEL_OPACITY});
           border:1px solid rgba(255,255,255,.16); border-radius:12px;
           box-shadow:0 8px 28px rgba(0,0,0,.28);
           font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;
           overflow:hidden; user-select:none; backdrop-filter:blur(10px);
           z-index:2147483647;
         }
         .panel.compact { width:108px; height:52px; border-radius:10px; }
         .compact-bar { display:none; width:100%; height:100%; align-items:center;
           justify-content:center; gap:4px; padding:4px; cursor:pointer; }
         .panel.compact .compact-bar { display:flex; }
         .panel.compact .expanded-content { display:none; }
         .compact-tile { display:flex; align-items:center; justify-content:center;
           width:44px; height:44px; flex:none; border-radius:7px;
           background:rgba(255,255,255,.09); }
         .compact-tile img { width:35px; height:35px; object-fit:contain; }
         .compact-rate { font-size:13px; font-weight:750; white-space:nowrap; }
         .header { display:flex; align-items:center; justify-content:space-between;
           gap:6px; padding:10px 11px; background:rgba(255,255,255,.06); cursor:move; }
         .brand { font-weight:700; letter-spacing:.2px; white-space:nowrap; }
         .header-actions { display:flex; gap:5px; align-items:center; }
         button { font:inherit; color:inherit; border:1px solid rgba(255,255,255,.16);
           background:rgba(255,255,255,.08); border-radius:7px;
           padding:5px 8px; cursor:pointer; }
         button:hover { background:rgba(255,255,255,.16); }
         button:focus-visible, input:focus-visible { outline:2px solid #8ab4ff; outline-offset:2px; }
         #pin { white-space:nowrap; font-size:11px; }
         .body { padding:11px; display:grid; gap:10px; }
         .rate-row { display:flex; justify-content:space-between; align-items:center; gap:8px; }
         .rate { font-size:24px; font-weight:750; cursor:pointer; }
         .small { color:#b9bdc7; font-size:11px; }
         .controls { display:flex; gap:6px; }
         .controls button { flex:1; }
         input[type=range] { width:100%; accent-color:#8ab4ff; margin:0; }
         .presets { display:flex; flex-wrap:wrap; gap:6px; }
         .presets button { min-width:46px; flex:1; }
         .presets button.active { border-color:#8ab4ff; background:rgba(138,180,255,.2); }
         .edit-row { display:flex; gap:6px; align-items:center; }
         .edit-row input { width:70px; min-width:0; color:#f5f5f5; background:#17191d;
           border:1px solid #555b66; border-radius:6px; padding:6px; }
         .footer { display:flex; justify-content:space-between; align-items:center; gap:8px; }
       `;
       root.appendChild(style);

       const compactBar = el('div', { class: 'compact-bar', id: 'compact-bar', title: '鼠标悬停展开；点击固定展开' }, [
         el('div', { class: 'compact-tile' }, [el('img', { src: ICON_URL, alt: '倍速播放 Next 图标' })]),
         el('div', { class: 'compact-tile compact-rate', id: 'compact-rate', text: '1×' })
       ]);
       const expandedContent = el('div', { class: 'expanded-content' }, [
         el('div', { class: 'header', id: 'drag-handle' }, [
           el('span', { class: 'brand', text: '倍速播放 Next' }),
           el('div', { class: 'header-actions' }, [
             btn('pin', '固定窗口', '固定窗口，始终保持展开'),
             btn('hide', '×', '隐藏面板')
           ])
         ]),
         el('div', { class: 'body' }, [
           el('div', { class: 'rate-row' }, [
             el('div', {}, [
               el('div', { class: 'small', text: '当前速度' }),
               el('div', { class: 'rate', id: 'rate', title: '双击切换上次速度', text: '1×' })
             ]),
             btn('toggle', '切换上次')
           ]),
           el('input', { id: 'slider', type: 'range', min: '0.1', max: '4', step: '0.1', value: '1' }),
           el('div', { class: 'controls' }, [
             btn('minus', '− 0.1'), btn('normal', '1× 正常'), btn('plus', '+ 0.1')
           ]),
           el('div', { class: 'small', text: `常用速度（最多 ${MAX_PRESETS} 个）` }),
           el('div', { class: 'presets', id: 'presets' }),
           el('div', { class: 'edit-row' }, [
             el('input', { id: 'custom', type: 'number', min: '0.1', max: '20', step: '0.1', value: '1' }),
             btn('apply-custom', '应用'), btn('add-preset', '＋常用')
           ]),
           el('div', { class: 'footer' }, [
             el('span', { class: 'small', id: 'status', text: '自动应用到页面视频' }),
             btn('reset', '重置位置')
           ])
         ])
       ]);
       root.appendChild(el('section', { class: 'panel expanded' }, [compactBar, expandedContent]));
       document.documentElement.appendChild(host);
       panelHost = host;
       shadow = root;
       bindUI();
       updateUI();
       updatePanelMode();
     } catch (error) {
       host?.remove();
       panelHost = null;
       shadow = null;
       console.error('[倍速播放 Next] 创建面板失败：', error);
     }
   }

   function bindUI() {
     const panel = $('.panel');
     // pointerenter / pointerleave 不会因在面板内部按钮之间移动而反复触发。
     panel.addEventListener('pointerenter', event => {
       if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
         hovered = true;
         updatePanelMode();
       }
     });
     panel.addEventListener('pointerleave', () => {
       if (dragging) return;
       hovered = false;
       updatePanelMode();
     });
     // 触屏设备没有鼠标悬停；点击折叠条也可以固定展开。
     $('#compact-bar').addEventListener('click', () => {
       settings.pinned = true;
       saveSettings();
       updatePanelMode();
     });
     $('#pin').addEventListener('click', () => {
       settings.pinned = !settings.pinned;
       saveSettings();
       updatePanelMode();
     });
     $('#hide').addEventListener('click', () => {
       hiddenByUser = true;
       updateVisibility(getVideos().length > 0);
     });
     $('#minus').addEventListener('click', () => setRate(Math.max(MIN_RATE, settings.rate - 0.1)));
     $('#plus').addEventListener('click', () => setRate(Math.min(MAX_RATE, settings.rate + 0.1)));
     $('#normal').addEventListener('click', () => setRate(1));
     $('#toggle').addEventListener('click', togglePreviousRate);
     $('#rate').addEventListener('dblclick', togglePreviousRate);
     $('#slider').addEventListener('input', e => setRate(Number(e.target.value)));
     $('#apply-custom').addEventListener('click', () => {
       const value = Number($('#custom').value);
     
       if (!Number.isFinite(value) || value < MIN_RATE || value > MAX_RATE) {
         $('#status').textContent = '请输入 0.1～20 之间的速度';
         return;
       }
     
       const rate = clampRate(value);
     
       // 如果之前选中了一个常用速度，就更新对应的预设
       if (selectedPresetIndex !== null &&
           selectedPresetIndex < settings.presets.length) {
     
         // 避免把其他预设修改成重复的速度
         const duplicate = settings.presets.some(
           (preset, index) =>
             index !== selectedPresetIndex &&
             Math.abs(preset - rate) < 0.001
         );
     
         if (duplicate) {
           $('#status').textContent = '常用速度中已经存在这个倍速';
           return;
         }
     
         settings.presets[selectedPresetIndex] = rate;
         saveSettings();
     
         setRate(rate);
         $('#status').textContent = '已更新选中的常用速度';
       } else {
         // 没有选中预设：保持原来的功能，只修改当前播放速度
         setRate(rate);
         $('#status').textContent = '已应用播放速度';
       }
     });

    
     $('#custom').addEventListener('keydown', e => {
       if (e.key === 'Enter') $('#apply-custom').click();
     });
     $('#add-preset').addEventListener('click', addPreset);
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
     if (settings.presets.includes(rate)) {
       $('#status').textContent = '这个速度已在常用列表中';
       return;
     }
     if (settings.presets.length >= MAX_PRESETS) {
       $('#status').textContent = `最多保存 ${MAX_PRESETS} 个，请先右键移除一个`;
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
   
     settings.presets.forEach((rate, index) => {
       const item = btn(
         '',
         formatRate(rate),
         '点击选中并应用；右键删除'
       );
   
       item.removeAttribute('id');
   
       // 用高亮效果标记当前选中的预设
       if (selectedPresetIndex === index) {
         item.classList.add('active');
       }
   
       // 点击预设：记录选中项并应用速度
       item.addEventListener('click', () => {
         selectedPresetIndex = index;
         setRate(rate);
       });
   
       // 右键删除预设
       item.addEventListener('contextmenu', event => {
         event.preventDefault();
   
         if (settings.presets.length <= 1) {
           $('#status').textContent = '至少保留一个常用速度';
           return;
         }
   
         settings.presets.splice(index, 1);
   
         // 删除后修正选中位置
         if (selectedPresetIndex === index) {
           selectedPresetIndex = null;
         } else if (selectedPresetIndex > index) {
           selectedPresetIndex--;
         }
   
         saveSettings();
         renderPresets();
       });
   
       container.appendChild(item);
     });
   }

   function updateUI() {
     if (!shadow) return;
     $('#rate').textContent = formatRate(settings.rate);
     $('#compact-rate').textContent = formatRate(settings.rate);
     $('#custom').value = String(settings.rate);
     $('#slider').value = String(Math.min(4, settings.rate));
     renderPresets();
     if (reopenButton?.isConnected) reopenButton.textContent = `倍速 ${formatRate(settings.rate)}`;
   }

   function placePanel() {
     const panel = $('.panel');
     if (!panel) return;
     const width = panel.offsetWidth || 260;
     const height = panel.offsetHeight || 52;
     if (settings.x === null) {
       panel.style.left = 'auto';
       panel.style.right = '18px';
     } else {
       // 对已有绝对坐标限制范围，但不因折叠宽度变化覆盖用户保存的位置。
       panel.style.left = `${Math.max(0, Math.min(settings.x, Math.max(0, innerWidth - width)))}px`;
       panel.style.right = 'auto';
     }
     panel.style.top = `${Math.max(0, Math.min(settings.y, Math.max(0, innerHeight - height)))}px`;
   }

   function startDrag(event) {
     if (event.button !== 0 || event.target.closest('button')) return;
     const rect = $('.panel').getBoundingClientRect();
     dragging = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY,
       x: rect.left, y: rect.top };
     event.currentTarget.setPointerCapture?.(event.pointerId);
     event.preventDefault();
   }
   function moveDrag(event) {
     if (!dragging || event.pointerId !== dragging.id) return;
     const panel = $('.panel');
     settings.x = Math.max(0, Math.min(Math.max(0, innerWidth - panel.offsetWidth),
       dragging.x + event.clientX - dragging.clientX));
     settings.y = Math.max(0, Math.min(Math.max(0, innerHeight - panel.offsetHeight),
       dragging.y + event.clientY - dragging.clientY));
     placePanel();
   }
   function endDrag(event) {
     if (!dragging || event.pointerId !== dragging.id) return;
     dragging = null;
     saveSettings();
     hovered = $('.panel')?.matches(':hover') || false;
     updatePanelMode();
   }

   function showReopenButton() {
     if (reopenButton?.isConnected) return;
     const button = el('button', { type: 'button', title: '重新显示倍速面板' });
     button.textContent = `倍速 ${formatRate(settings.rate)}`;
     button.style.cssText = 'position:fixed;left:18px;top:18px;z-index:2147483647;' +
       'padding:8px 12px;border:0;border-radius:20px;background:rgba(32,36,44,.92);' +
       'color:white;font:13px system-ui;box-shadow:0 2px 10px #0005;cursor:pointer;';
     button.addEventListener('click', () => {
       hiddenByUser = false;
       hovered = false;
       updateVisibility(getVideos().length > 0);
       updatePanelMode();
     });
     document.documentElement.appendChild(button);
     reopenButton = button;
   }

   function updateVisibility(hasVideo) {
     if (!hasVideo) {
       if (panelHost) panelHost.style.display = 'none';
       reopenButton?.remove();
       reopenButton = null;
       return;
     }
     if (hiddenByUser) {
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
