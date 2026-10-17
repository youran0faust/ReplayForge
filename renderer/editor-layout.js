'use strict';
/* Auto preserves preview space; expand is an explicit temporary all-track view. */
function timelineFitBudget({availableHeight,gap,fullHeight,minTimeline,preferredTop,minPreview=64,transportHeight=78,mode='auto',manualHeight=null}) {
  const budget=Math.max(0,availableHeight-gap);
  const floor=Math.min(budget,Math.max(0,minPreview+transportHeight+2));
  const minimum=Math.min(Math.max(0,minTimeline),Math.max(0,budget-floor));
  const reserved=mode==='expand'?floor:Math.min(Math.max(0,budget-minimum),Math.max(floor,preferredTop));
  const maximum=Math.max(minimum,Math.min(budget-reserved,mode==='auto'?budget*.38:budget));
  const desired=mode==='manual'&&Number.isFinite(manualHeight)?manualHeight:fullHeight;
  const height=Math.max(minimum,Math.min(maximum,desired));
  return {height,minimum,maximum,top:budget-height,allVisible:fullHeight<=height+1};
}
if(typeof module==='object'&&module.exports)module.exports={timelineFitBudget};
/* Layout only: never reads preview's lexical state, mutates project data, or clones controls. */
(() => {
  if(typeof document==='undefined')return;
  const $ = selector => document.querySelector(selector);
  const workspace = $('.workspace'), side = $('.side'), visual = $('#visual-panel'), audio = $('#audio-panel');
  const visualContent = $('#visual-content'), audioContent = $('#audio-content');
  const visualViews = { character: $('.image-editor'), background: $('#background-editor-host'), characterEvents: $('#character-event-editor-host'), characterAppearance: $('#character-appearance-host'), expressions: $('#expression-library'), resource: $('#resource-inspector'), code: $('#code-editor') };
  // Relocate the existing controls rather than cloning: IDs, drafts and listeners retain ownership.
  visualViews.background.append($('#background-base-controls'));
  $('#character-expression-events').append($('#character-event-fields'), $('#character-event-actions'), $('#character-event-help'));
  visualViews.characterAppearance.append($('#expression-editor'));
  const range = $('#range-start').closest('fieldset');
  const audioViews = { dialogue: $('.dialogue-editor'), pages: $('#dialogue-pages-host'), voice: $('#voice-editor-host'), audio: $('#audio-track-editor'), range };
  const dialogueContext = $('#dialogue-context-controls'), dialogueFields = $('#dialogue-fields');
  dialogueContext.prepend($('#dialogue-select').closest('.row'));
  audioViews.pages.append($('#dialogue-page-editor'));
  dialogueFields.append($('#dialogue-apply'), $('#dialogue-page-status'), $('#dialogue-page-discard'));
  audioViews.voice.append($('#legacy-voice-controls'));
  // Move the original nodes, preserving every ID, form value and production event binding.
  visualContent.append(visualViews.character, visualViews.code);
  audioContent.append(...Object.values(audioViews));
  $('#app-menubar').append($('#undo').closest('.buttons'), $('#locale').closest('.row'));
  const frameControls = $('#frame').closest('.row');
  frameControls.classList.add('frame-controls');
  $('#playback-status').after(frameControls);
  const details = $('#project-details-content');
  for (const child of [...side.children]) if (child !== visual && child !== audio) details.append(child);
  const timeline = $('#timeline'), tracks = $('#timeline-tracks');
  const fitStatus = document.createElement('span');
  fitStatus.id = 'timeline-fit-status'; fitStatus.setAttribute('role', 'status');
  $('#timeline-toolbar-title').append(fitStatus);
  let focus = null, visualTab = 'character', audioTab = 'dialogue', expressionFocus = false, queued = 0, geometry = {};
  const storageKey = 'replay.p2.editor-layout.v1';
  const defaults = () => ({ left: null, right: null, upper: null, timeline: null, timelineMode: 'auto' });
  let requested = defaults(), storageAvailable = true, drag = null;
  const splitters = {};
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved?.version === 1) {
      for (const key of ['left', 'right', 'upper', 'timeline']) {
        if (Number.isFinite(saved[key]) && saved[key] >= 0 && (key !== 'upper' || saved[key] <= 1)) requested[key] = saved[key];
      }
      requested.timelineMode = saved.timelineMode === 'manual' ? 'manual' : 'auto';
    }
  } catch (_) { storageAvailable = false; }
  function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, ...requested, timelineMode: requested.timelineMode === 'expand' ? 'auto' : requested.timelineMode })); storageAvailable = true; }
    catch (_) { storageAvailable = false; }
  }
  const modeButtons = {};
  for (const [mode, text, id] of [['auto', '自动布局', 'timeline-fit-all'], ['expand', '展开时间轴', 'timeline-expand'], ['manual', '手动高度', 'timeline-manual']]) {
    const button = document.createElement('button');
    button.id = id; button.type = 'button'; button.textContent = text;
    button.addEventListener('click', () => setTimelineMode(mode));
    fitStatus.before(button); modeButtons[mode] = button;
  }
  const px = value => Number.parseFloat(value) || 0;
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  function refresh() {
    if (queued) return;
    queued = requestAnimationFrame(() => { queued = 0; measure(); });
  }
  function measure() {
    const css = getComputedStyle(workspace), token = name => px(css.getPropertyValue('--' + name));
    const gap = token('layout-gap'), padding = token('layout-padding');
    const availableHeight = Math.max(0, workspace.clientHeight - padding * 2);
    // Read responsive defaults from root, not the previously applied inline dimensions.
    const rootCSS = getComputedStyle(document.documentElement);
    const defaultLeft = px(rootCSS.getPropertyValue('--layout-left')), defaultRight = px(rootCSS.getPropertyValue('--layout-right'));
    const widthBudget = Math.max(0, workspace.clientWidth - padding * 2 - gap * 2 - 2);
    const minLeft = Math.min(150, defaultLeft), minRight = defaultRight;
    const centerFloor = Math.min(token('preview-target'), Math.max(0, widthBudget - minLeft - minRight));
    const sideBudget = Math.max(0, widthBudget - centerFloor);
    const maxLeft = Math.max(minLeft, sideBudget - minRight);
    const left = requested.left === null ? defaultLeft : clamp(requested.left, minLeft, maxLeft);
    const maxRight = Math.max(minRight, sideBudget - left);
    const right = requested.right === null ? defaultRight : clamp(requested.right, minRight, maxRight);
    workspace.style.setProperty('--layout-left', left + 'px');
    workspace.style.setProperty('--layout-right', right + 'px');
    const centerWidth = Math.max(0, widthBudget - left - right);
    const audioTabsHeight = audio.querySelector('.tabs').getBoundingClientRect().height;
    const visualTabsHeight = visual.querySelector('.tabs').getBoundingClientRect().height;
    const dialogueContextHeight = dialogueContext.hidden ? 0 : dialogueContext.getBoundingClientRect().height;
    const audioChrome = token('panel-title-height') + audioTabsHeight + dialogueContextHeight + 2;
    const visualChrome = token('panel-title-height') + visualTabsHeight + 2;
    const audioContentCSS = getComputedStyle(audioContent);
    const minAudio = Math.max(token('audio-min'), audioChrome + token('audio-content-min') + px(audioContentCSS.paddingTop) + px(audioContentCSS.paddingBottom));
    const visualContentCSS = getComputedStyle(visualContent);
    const minVisual = Math.max(token('panel-min'), visualChrome + token('audio-content-min') + px(visualContentCSS.paddingTop) + px(visualContentCSS.paddingBottom));
    const previewTargetWidth = Math.min(centerWidth, token('preview-target'));
    const previewFloor = previewTargetWidth * 9 / 16 + token('transport-height') + 2;
    let panelFloor = focus ? (focus === 'visual' ? minVisual : minAudio) + token('summary-height') + gap : minVisual + minAudio + gap;
    if (focus === 'visual' && visualTab === 'expressions') {
      const toolsHeight = [...visualViews.expressions.children].filter(node => node.id !== 'expression-library-grid').reduce((sum, node) => sum + node.getBoundingClientRect().height, 0);
      const contentCSS = getComputedStyle(visualContent), count = token('expression-min-rows');
      const libraryFloor = visualChrome + px(contentCSS.paddingTop) + px(contentCSS.paddingBottom) + toolsHeight
        + count * token('expression-card-height') + Math.max(0, count - 1) * token('expression-card-gap') + token('summary-height') + gap;
      panelFloor = Math.max(panelFloor, libraryFloor);
    }
    const timelineCSS = getComputedStyle(timeline), scrollCSS = getComputedStyle($('#timeline-scroll'));
    const toolbarHeight = $('#timeline-toolbar').getBoundingClientRect().height;
    const rulerHeight = $('#timeline-ruler').getBoundingClientRect().height;
    const scrollNode=$('#timeline-scroll');
    const horizontalScrollbar=Math.max(0,(Number(scrollNode.offsetHeight)||0)-(Number(scrollNode.clientHeight)||0)-(px(scrollCSS.borderTopWidth)||0)-(px(scrollCSS.borderBottomWidth)||0));
    const chrome = toolbarHeight + rulerHeight + px(scrollCSS.paddingTop) + px(scrollCSS.paddingBottom)
      + px(timelineCSS.paddingTop) + px(timelineCSS.paddingBottom) + 2 + horizontalScrollbar;
    // Preserve the fixed controls plus a visible lane even when the timeline is resized small.
    const minTimeline = Math.min(Math.max(0, availableHeight - gap), Math.max(Math.min(token('timeline-min'), availableHeight * .16), chrome + token('timeline-row-height')));
    const reserved = requested.timelineMode === 'manual' ? Math.max(previewFloor,panelFloor) : previewFloor;
    // Auto-fit may shrink the editors below their preferred content size: their own
    // scroll containers, not the document body, own the excess.
    // Production rows contain labels plus variable-height lanes; no invented lane model.
    const rows = [...tracks.children].filter(node => !node.hidden && node.classList.contains('timeline-lane'));
    const heightWithMargin = node => { if (!node || node.hidden) return 0; const s = getComputedStyle(node); return node.getBoundingClientRect().height + px(s.marginTop) + px(s.marginBottom); };
    const warningHeight = heightWithMargin($('#timeline-warnings'));
    // Grid labels and lanes share rows. Measure their union, never sum cells or
    // reuse the allocated scroll viewport height (which prevents shrink-to-content).
    const trackTop=tracks.getBoundingClientRect().top,trackStyle=getComputedStyle(tracks);
    const bottoms=[...tracks.children].filter(node=>!node.hidden&&getComputedStyle(node).display!=='none').map(node=>node.getBoundingClientRect().bottom-trackTop+px(getComputedStyle(node).marginBottom));
    const contentHeight=Math.max(0,...bottoms)+px(trackStyle.paddingBottom)+px(trackStyle.borderBottomWidth);
    const fullHeight = chrome + warningHeight + contentHeight;
    const fit = timelineFitBudget({availableHeight,gap,fullHeight,minTimeline,preferredTop:reserved,minPreview:token('preview-min-height')||64,transportHeight:token('transport-height'),mode:requested.timelineMode,manualHeight:requested.timeline});
    const timelineHeight = fit.height, maxTimeline = fit.maximum;
    // With little vertical room scroll the whole editor, including its tabs/context;
    // otherwise a min-content child would be clipped above its own scroll region.
    for(const panel of [visual,audio])panel.style.overflowY=requested.timelineMode!=='manual'?'auto':'';
    const panelSpace = Math.max(0, availableHeight - timelineHeight - gap * 2);
    const autoFit=requested.timelineMode!=='manual';
    const visualFloor=autoFit?Math.min(token('panel-title-height')+24,panelSpace/2):minVisual;
    const audioFloor=autoFit?Math.min(token('panel-title-height')+24,panelSpace/2):minAudio;
    const minUpper = Math.min(visualFloor, Math.max(0, panelSpace - audioFloor)), maxUpper = Math.max(0, panelSpace - audioFloor);
    let upper = clamp(panelSpace * (requested.upper ?? token('visual-ratio')), minUpper, maxUpper);
    if (focus === 'visual') upper = Math.max(0, panelSpace - token('summary-height'));
    if (focus === 'audio') upper = Math.min(token('summary-height'), panelSpace);
    workspace.style.setProperty('--layout-timeline', timelineHeight + 'px');
    workspace.style.setProperty('--layout-upper', upper + 'px');
    const allVisible = fullHeight <= timelineHeight + 1;
    fitStatus.textContent = `${requested.timelineMode === 'auto' ? '自动' : requested.timelineMode === 'expand' ? '展开（临时）' : '手动'} · 共 ${rows.length} 行 · ${allVisible ? '全部可见' : '内部滚动'}`;
    for (const [mode, button] of Object.entries(modeButtons)) button.setAttribute('aria-pressed', String(requested.timelineMode === mode));
    const limits = { left: [minLeft, maxLeft], right: [minRight, maxRight], upper: [minUpper, maxUpper], timeline: [fit.minimum, maxTimeline] };
    const actual = { left, right, upper, timeline: timelineHeight };
    geometry = { timelineHeight, fullHeight, maxTimeline, rowCount: rows.length, allVisible, previewTargetWidth, upper, audio: panelSpace - upper, panelSpace, actual, limits };
    for (const [key, el] of Object.entries(splitters)) {
      el.setAttribute('aria-valuemin', Math.round(limits[key][0]));
      el.setAttribute('aria-valuemax', Math.round(limits[key][1]));
      el.setAttribute('aria-valuenow', Math.round(actual[key]));
      el.setAttribute('aria-disabled', String(key === 'upper' && focus !== null));
    }
    const topHeight = availableHeight - timelineHeight - gap;
    const place = (key, styles) => { if (splitters[key]) Object.assign(splitters[key].style, styles); };
    place('left', { left: padding + left + 'px', top: padding + 'px', width: gap + 'px', height: topHeight + 'px' });
    place('right', { left: workspace.clientWidth - padding - right - gap + 'px', top: padding + 'px', width: gap + 'px', height: topHeight + 'px' });
    place('upper', { left: workspace.clientWidth - padding - right + 'px', top: padding + upper + 'px', width: right + 'px', height: gap + 'px' });
    place('timeline', { left: padding + 'px', right: padding + 'px', top: padding + topHeight + 'px', height: gap + 'px' });
    // Parent's production preview owns scene dimensions and scaling. No lexical current/fitPreview access here.
    window.dispatchEvent(new CustomEvent('editor-layout-resize', { detail: { ...geometry } }));
  }
  function endDrag(commit) {
    if (!drag) return;
    const previous = drag; drag = null;
    if (!commit) requested = previous.before;
    previous.el.classList.remove('dragging'); document.body.classList.remove('layout-dragging');
    if (previous.el.hasPointerCapture(previous.pointer)) previous.el.releasePointerCapture(previous.pointer);
    measure(); if (commit) persist();
  }
  function setTimelineMode(mode) {
    if (!['auto','expand','manual'].includes(mode)) return false;
    endDrag(false);
    if (mode === 'manual' && requested.timeline === null) requested.timeline = geometry.timelineHeight;
    requested.timelineMode = mode; measure(); if(mode!=='expand')persist(); return true;
  }
  function updateRequest(key, value) {
    if (key === 'upper') requested.upper = clamp(value / Math.max(1, geometry.panelSpace), 0, 1);
    else requested[key] = Math.max(0, value);
    if (key === 'timeline') requested.timelineMode = 'manual';
    measure();
  }
  for (const [key, label, vertical] of [['left', '左侧素材库宽度', true], ['right', '右侧编辑栏宽度', true], ['upper', '画面与声音比例（聚焦时请先恢复）', false], ['timeline', '时间轴高度', false]]) {
    const el = document.createElement('div');
    el.id = 'split-' + key; el.dataset.layoutSplitter = key;
    el.className = 'layout-splitter ' + (vertical ? 'vertical' : 'horizontal'); el.tabIndex = 0;
    el.setAttribute('role', 'separator'); el.setAttribute('aria-label', label);
    el.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');
    el.title = label + '：拖动或方向键调整，Shift加速；Esc/失焦取消拖动';
    workspace.append(el); splitters[key] = el;
    el.addEventListener('pointerdown', event => {
      if (event.button !== 0 || (key === 'upper' && focus)) return;
      endDrag(false); measure(); event.preventDefault(); el.focus();
      drag = { key, el, pointer: event.pointerId, x: event.clientX, y: event.clientY, start: geometry.actual[key], before: { ...requested } };
      el.setPointerCapture(event.pointerId); el.classList.add('dragging'); document.body.classList.add('layout-dragging');
    });
    el.addEventListener('pointermove', event => {
      if (!drag || drag.el !== el || drag.pointer !== event.pointerId) return;
      const delta = vertical ? event.clientX - drag.x : event.clientY - drag.y;
      updateRequest(key, drag.start + delta * (key === 'right' || key === 'timeline' ? -1 : 1));
    });
    el.addEventListener('pointerup', event => { if (drag?.el === el && drag.pointer === event.pointerId) endDrag(true); });
    for (const type of ['pointercancel', 'lostpointercapture', 'blur']) el.addEventListener(type, () => { if (drag?.el === el) endDrag(false); });
    el.addEventListener('keydown', event => {
      if (drag || (key === 'upper' && focus)) return;
      const sign = vertical ? ({ ArrowLeft: -1, ArrowRight: 1 })[event.key] : ({ ArrowUp: -1, ArrowDown: 1 })[event.key];
      if (!sign) return;
      event.preventDefault(); event.stopPropagation();
      updateRequest(key, geometry.actual[key] + sign * (event.shiftKey ? 25 : 8) * (key === 'right' || key === 'timeline' ? -1 : 1)); persist();
    });
  }
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopImmediatePropagation(); endDrag(false); }
  }, true);
  window.addEventListener('blur', () => endDrag(false));
  document.addEventListener('visibilitychange', () => { if (document.hidden) endDrag(false); });
  function reset() {
    endDrag(false); requested = defaults(); expressionFocus = false; setFocus(null);
    try { localStorage.removeItem(storageKey); storageAvailable = true; } catch (_) { storageAvailable = false; }
    measure();
  }
  function setFocus(value) {
    if (value !== null && value !== 'visual' && value !== 'audio') return false;
    focus = value;
    side.dataset.focus = value || '';
    for (const [name, panel] of [['visual', visual], ['audio', audio]]) {
      const collapsed = value !== null && value !== name;
      panel.classList.toggle('layout-collapsed', collapsed);
      panel.querySelector('.collapsed-summary').hidden = !collapsed;
      panel.querySelector('[data-layout-focus]').setAttribute('aria-pressed', String(value === name));
    }
    refresh();
    window.dispatchEvent(new CustomEvent('layout-focus-change', { detail: { focus } }));
    return true;
  }
  function showVisualTab(tab) {
    if (!Object.prototype.hasOwnProperty.call(visualViews, tab)) return false;
    visualTab = tab;
    for (const [name, node] of Object.entries(visualViews)) node.hidden = name !== tab;
    document.querySelectorAll('[data-visual-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.visualTab === tab)));
    visual.dataset.tab = tab;
    visual.classList.toggle('library-active', tab === 'expressions');
    if (tab === 'expressions') { expressionFocus = true; setFocus('visual'); }
    else if (expressionFocus || focus === 'audio') { expressionFocus = false; setFocus(null); }
    refresh();
    window.dispatchEvent(new CustomEvent('visual-tab-change',{detail:{tab}}));
    return true;
  }
  function showAudioTab(tab) {
    if (!Object.prototype.hasOwnProperty.call(audioViews, tab)) return false;
    audioTab = tab;
    if (tab === 'dialogue' || tab === 'pages') audioViews[tab].append(dialogueFields);
    dialogueContext.hidden = !['dialogue', 'pages', 'voice'].includes(tab);
    audio.dataset.tab = tab;
    for (const [name, node] of Object.entries(audioViews)) node.hidden = name !== tab;
    document.querySelectorAll('[data-audio-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.audioTab === tab)));
    if (focus === 'visual') { expressionFocus = false; setFocus(null); }
    refresh(); return true;
  }
  document.querySelectorAll('[data-visual-tab]').forEach(button => button.addEventListener('click', () => showVisualTab(button.dataset.visualTab)));
  document.querySelectorAll('[data-audio-tab]').forEach(button => button.addEventListener('click', () => showAudioTab(button.dataset.audioTab)));
  document.querySelectorAll('[data-layout-focus]').forEach(button => button.addEventListener('click', () => { expressionFocus = false; setFocus(focus === button.dataset.layoutFocus ? null : button.dataset.layoutFocus); }));
  document.querySelectorAll('[data-layout-restore]').forEach(button => button.addEventListener('click', () => { expressionFocus = false; setFocus(null); }));
  for (const [name, panel] of [['visual', visual], ['audio', audio]]) {
    panel.querySelector('.tabs').addEventListener('dblclick', event => {
      if (event.defaultPrevented || event.target.closest('input,textarea,select,[contenteditable]')) return;
      expressionFocus = false;
      setFocus(focus === name ? null : name);
    });
  }
  $('#layout-reset').addEventListener('click', reset);
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(refresh);
    observer.observe(workspace); observer.observe(tracks); observer.observe($('#timeline-toolbar'));
    observer.observe(visual.querySelector('.tabs')); observer.observe(audio.querySelector('.tabs')); observer.observe(dialogueContext);
  }
  if (typeof MutationObserver === 'function') new MutationObserver(refresh).observe(tracks, { childList: true, subtree: true });
  window.addEventListener('resize', refresh);
  document.addEventListener('fullscreenchange', refresh);
  document.addEventListener('load', refresh, true);
  document.fonts?.ready.then(refresh);
  window.editorLayout = { registerVisualTab(name,node){if(Object.hasOwn(visualViews,name))throw Error('Tab already registered');visualViews[name]=node;visualContent.append(node);node.hidden=true;refresh();}, showVisualTab, showAudioTab, setFocus, setTimelineMode, reset, refresh, storageKey,
    snapshot: () => structuredClone({ focus, visualTab, audioTab, ...geometry, requested, timelineMode: requested.timelineMode, storageAvailable, dragging: drag?.key || null }) };
  showVisualTab('character'); showAudioTab('dialogue'); setFocus(null);
})();
