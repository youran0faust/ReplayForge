(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../core/title-style.cjs'));
  else root.TitleLayout = factory(root.TitleStyle);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(TitleStyle) {
  'use strict';
  function applyTitleTextStyle(node, style) {
    const resolved = TitleStyle.resolveTitleStyle(style);
    Object.assign(node.style, {fontFamily: '"Microsoft YaHei", sans-serif', fontSize: `${resolved.fontSize}px`, color: resolved.color, textAlign: resolved.align,
      fontWeight: 'normal', fontStyle: 'normal', letterSpacing: 'normal', lineHeight: '1.5', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'normal',
      boxSizing: 'border-box', padding: '0', border: '0', margin: '0', width: '90%', maxWidth: '90%', maxHeight: '90%', overflow: 'hidden', minWidth: '0', minHeight: '0'});
  }
  function mount(document, title, design, source) {
    if (!Number.isFinite(design.width) || !Number.isFinite(design.height) || design.width <= 0 || design.height <= 0) throw new Error('Title layout requires positive design dimensions');
    const host = document.createElement('div'), text = document.createElement('div');
    Object.assign(host.style, {all: 'initial', position: 'fixed', left: '-100000px', top: '0', width: `${design.width}px`, height: `${design.height}px`, visibility: 'hidden', pointerEvents: 'none', display: 'block'});
    applyTitleTextStyle(text, title.style);
    if (source) Object.assign(text.style, {fontSize: source.style.fontSize, color: source.style.color, textAlign: source.style.textAlign});
    Object.assign(text.style, {display: 'block', height: 'auto', maxHeight: 'none', overflow: 'visible', opacity: '1'});
    text.textContent = title.text;
    host.appendChild(text);
    (document.body || document.documentElement).appendChild(host);
    return {host, text, design};
  }
  function metrics({text, design}) {
    const rect = text.getBoundingClientRect();
    const availableWidth = design.width * .9, availableHeight = design.height * .9;
    const requiredWidth = Math.max(text.scrollWidth, rect.width), requiredHeight = Math.max(text.scrollHeight, rect.height);
    // scroll sizes are integral CSS pixels; tolerate only that rounding, never a line.
    const overflowX = requiredWidth > availableWidth + .5, overflowY = requiredHeight > availableHeight + .5;
    return {fits: !overflowX && !overflowY, overflowX, overflowY, requiredWidth, requiredHeight, availableWidth, availableHeight};
  }
  function measureTitle(stageOrCard, titleText) {
    let node = stageOrCard;
    while (node && !(parseFloat(node.style?.width) > 0 && parseFloat(node.style?.height) > 0)) node = node.parentElement;
    const design = node ? {width: parseFloat(node.style.width), height: parseFloat(node.style.height)} : {width: stageOrCard.clientWidth, height: stageOrCard.clientHeight};
    const mounted = mount(titleText.ownerDocument, {text: titleText.textContent}, design, titleText);
    try { return metrics(mounted); } finally { mounted.host.remove(); }
  }
  function createTitleLayoutProbe(document) {
    const pending = new Set();
    let disposed = false;
    return {
      async measure(title, design) {
        if (disposed) throw new Error('Title layout probe is disposed');
        const mounted = mount(document, title, design);
        pending.add(mounted.host);
        try {
          void mounted.text.offsetHeight; // Request actual font before awaiting its readiness.
          if (document.fonts) await document.fonts.ready;
          if (disposed) throw new Error('Title layout probe is disposed');
          return metrics(mounted);
        } finally { mounted.host.remove(); pending.delete(mounted.host); }
      },
      dispose() { disposed = true; for (const host of pending) host.remove(); pending.clear(); }
    };
  }
  return {applyTitleTextStyle, measureTitle, createTitleLayoutProbe};
});
