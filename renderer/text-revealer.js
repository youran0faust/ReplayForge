// All revealers share one highlight; updating one text must not unhide another.
const replayHiddenRanges = new Set();
function createTextRevealer(element) {
  let textNode = null, units = [], hiddenRange = null;
  function publish() {
    if (CSS.highlights && window.Highlight) CSS.highlights.set('replay-hidden-tail', new Highlight(...replayHiddenRanges));
  }
  function clear() {
    if (hiddenRange) replayHiddenRanges.delete(hiddenRange);
    hiddenRange = null;
  }
  function prepare(text, locale) {
    clear();
    element.textContent = text;
    textNode = element.firstChild;
    units = [...new Intl.Segmenter(locale || 'en-US', {granularity: 'grapheme'}).segment(text)];
    if (!CSS.highlights || !window.Highlight) throw Error('Chromium text reveal API unavailable');
    publish();
  }
  function reveal(progress) {
    clear();
    if (!textNode) { publish(); return; }
    const n = Math.max(0, Math.min(units.length, Math.floor(units.length * progress)));
    hiddenRange = new Range();
    hiddenRange.setStart(textNode, n < units.length ? units[n].index : textNode.length);
    hiddenRange.setEnd(textNode, textNode.length);
    replayHiddenRanges.add(hiddenRange);
    publish();
    return {units: units.length, visible: n, progress};
  }
  function geometry() {
    return units.map(u => {
      const r = new Range(); r.setStart(textNode, u.index); r.setEnd(textNode, u.index + u.segment.length);
      return [...r.getClientRects()].map(x => [x.x, x.y, x.width, x.height]);
    });
  }
  function dispose() { clear(); textNode = null; units = []; publish(); }
  return {prepare, reveal, geometry, dispose, get count() { return units.length; }};
}
if (typeof module !== 'undefined') module.exports = {createTextRevealer};
