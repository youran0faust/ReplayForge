(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TextLayout = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const error = (name, message) => Object.assign(new Error(message), {name});
  // Slice offsets are UTF-16 offsets. Only DOM geometry determines fit.
  async function prepareTextMetrics({element, text, locale = 'zh-CN', signal, timeoutMs = 2000, maxLines = 3} = {}) {
    if (typeof text !== 'string') throw new TypeError('text must be a string');
    if (!Number.isSafeInteger(maxLines) || maxLines < 1) throw new RangeError('Invalid maxLines');
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('Invalid timeoutMs');
    if (typeof locale !== 'string' || !locale.trim()) throw new TypeError('Invalid locale');
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw new TypeError('Invalid signal');
    if (signal && signal.aborted) throw error('AbortError', 'Text layout aborted');
    const doc = element && element.ownerDocument, view = doc && doc.defaultView;
    if (!element || element.nodeType !== 1 || element.isConnected === false || !view ||
        typeof view.getComputedStyle !== 'function' || typeof doc.createRange !== 'function' ||
        typeof view.requestAnimationFrame !== 'function' || typeof view.cancelAnimationFrame !== 'function') throw new TypeError('A connected dialogue body and DOM layout APIs are required');
    if (!doc.fonts || typeof doc.fonts.load !== 'function' || !doc.fonts.ready) throw new Error('Font APIs unavailable');
    if (typeof Intl.Segmenter !== 'function') throw new Error('Intl.Segmenter unavailable');
    const segmenter = new Intl.Segmenter(locale, {granularity: 'grapheme'});
    const computed = view.getComputedStyle(element), value = name => computed.getPropertyValue(name);
    const px = name => /^\d+(?:\.\d+)?px$|^0$/.test(value(name).trim()) ? parseFloat(value(name)) : NaN;
    const fontSize = px('font-size'), fontFamily = value('font-family').trim();
    if (!(fontSize > 0) || !fontFamily || value('display') === 'none') throw new Error('Invalid font or display');
    const paddingX = px('padding-left') + px('padding-right'), paddingY = px('padding-top') + px('padding-bottom');
    const borderX = px('border-left-width') + px('border-right-width'), borderY = px('border-top-width') + px('border-bottom-width');
    const borderBox = value('box-sizing') === 'border-box';
    let width = px('width'), height = px('height');
    width = Number.isFinite(width) ? width - (borderBox ? paddingX + borderX : 0) : element.clientWidth - paddingX;
    height = Number.isFinite(height) ? height - (borderBox ? paddingY + borderY : 0) : element.clientHeight - paddingY;
    if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height) ||
        !(element.clientWidth > 0) || !(element.clientHeight > 0)) throw new Error('Invalid element content dimensions');
    const host = doc.createElement('div'), span = doc.createElement('span'), properties = [];
    // Copy all computed properties, including all current/future font properties.
    for (let i = 0; i < computed.length; i++) {
      const name = computed[i]; properties.push([name, value(name)]); host.style.setProperty(name, value(name));
    }
    const overrides = {display: 'block', position: 'absolute', visibility: 'hidden', opacity: '0',
      'pointer-events': 'none', 'content-visibility': 'visible', contain: 'none',
      top: '0', left: '0', right: 'auto', bottom: 'auto', transform: 'none', translate: 'none', rotate: 'none', scale: 'none', zoom: '1',
      margin: '0', padding: '0', border: '0', 'box-sizing': 'content-box', width: width + 'px', height: height + 'px',
      'min-width': '0', 'max-width': 'none', 'min-height': '0', 'max-height': 'none', overflow: 'hidden',
      resize: 'none', animation: 'none', transition: 'none', 'column-count': 'auto', 'column-width': 'auto',
      'white-space': value('white-space'), direction: value('direction') || 'ltr'};
    for (const [name, val] of Object.entries(overrides)) host.style.setProperty(name, val, 'important');
    host.lang = locale; host.dir = value('direction') || 'ltr'; host.setAttribute('aria-hidden', 'true');
    span.style.setProperty('all', 'inherit', 'important');
    for (const [name, val] of Object.entries({display: 'inline', position: 'static', width: 'auto', height: 'auto', margin: '0', padding: '0', border: '0'})) span.style.setProperty(name, val, 'important');
    host.appendChild(span);
    const parent = element.parentElement || doc.body;
    if (!parent) throw new Error('No measurement host parent');
    let disposed = false, aborted = false, timer, frame, rejectCancellation;
    const cancellation = new Promise((resolve, reject) => { rejectCancellation = reject; });
    // Also consume cancellation after preparation, when abort only invalidates metrics.
    cancellation.catch(() => {});
    function dispose() {
      if (disposed) return;
      disposed = true; clearTimeout(timer);
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (host.parentNode) host.parentNode.removeChild(host);
    }
    function onAbort() { aborted = true; dispose(); rejectCancellation(error('AbortError', 'Text layout aborted')); }
    const nextFrame = () => new Promise(resolve => { frame = view.requestAnimationFrame(() => { frame = undefined; resolve(); }); });
    try {
      parent.appendChild(host);
      if (signal) signal.addEventListener('abort', onAbort, {once: true});
      timer = setTimeout(() => { dispose(); rejectCancellation(error('TimeoutError', 'Text layout timed out')); }, timeoutMs);
      const wait = promise => Promise.race([promise, cancellation]);
      if (signal && signal.aborted) onAbort();
      await wait(doc.fonts.load(`${value('font-style') || 'normal'} ${fontSize}px ${fontFamily}`, text));
      await wait(doc.fonts.ready);
      await wait(nextFrame()); await wait(nextFrame());
      clearTimeout(timer);
      const lineHeight = px('line-height');
      const tolerance = Math.max(0.5, Math.min(3, (Number.isFinite(lineHeight) ? lineHeight : fontSize) * 0.15));
      const layoutKey = JSON.stringify({locale, maxLines, width, height, properties: properties.sort((a, b) => a[0].localeCompare(b[0]))});
      function measureSlice(start, end) {
        if (aborted || (signal && signal.aborted)) throw error('AbortError', 'Text layout aborted');
        if (disposed) throw new Error('Text layout disposed');
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > text.length) throw new RangeError('Invalid source slice offsets');
        const slice = text.slice(start, end); span.textContent = slice;
        const range = doc.createRange(); let rects;
        try { range.selectNodeContents(span); rects = Array.from(range.getClientRects()).filter(rect => rect.height > 0); }
        finally { if (typeof range.detach === 'function') range.detach(); }
        const tops = [];
        for (const rect of rects.sort((a, b) => a.top - b.top)) if (!tops.some(top => Math.abs(top - rect.top) <= tolerance)) tops.push(rect.top);
        const lineCount = tops.length, overflowX = host.scrollWidth > host.clientWidth, overflowY = host.scrollHeight > host.clientHeight;
        const overflow = overflowX || overflowY, fits = lineCount <= maxLines && !overflow;
        if (!fits && slice !== '') {
          const iterator = segmenter.segment(slice)[Symbol.iterator](); iterator.next();
          if (iterator.next().done) throw new Error(`Single grapheme overflows text layout at offset ${start}`);
        }
        return {fits, lineCount, overflow, overflowX, overflowY};
      }
      return {layoutKey, measureSlice, dispose};
    } catch (cause) { dispose(); throw cause; }
  }
  return {prepareTextMetrics};
});
