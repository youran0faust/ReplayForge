'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {prepareTextMetrics} = require('./text-layout.js');

// Deliberately synthetic geometry: real shaping/wrapping belongs to Electron tests.
function dom(options = {}) {
  const values = {'display': 'block', 'font-size': '20px', 'font-style': 'italic', 'font-family': 'Test Font',
    'font-weight': '600', 'font-variation-settings': '"wght" 600', 'line-height': '30px',
    'width': '240px', 'height': '110px', 'box-sizing': 'border-box', 'white-space': 'pre-wrap', 'direction': 'rtl',
    'padding-left': '10px', 'padding-right': '10px', 'padding-top': '10px', 'padding-bottom': '10px',
    'border-left-width': '0px', 'border-right-width': '0px', 'border-top-width': '0px', 'border-bottom-width': '0px', ...options.styles};
  const computed = {...Object.keys(values), length: Object.keys(values).length, getPropertyValue: key => values[key] || ''};
  const state = {frames: 0, cancelled: 0, detached: 0, calls: [], rects: [{top: 0, height: 20}], overflowX: false, overflowY: false};
  function node(tag) {
    const style = {values: {}, setProperty(k, v) { this.values[k] = v; }};
    return {tag, style, children: [], textContent: '', setAttribute() {},
      appendChild(child) { this.children.push(child); child.parentNode = this; },
      removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; },
      get clientWidth() { return 220; }, get clientHeight() { return 90; },
      get scrollWidth() { return state.overflowX ? 221 : 220; },
      get scrollHeight() { return state.overflowY ? 91 : 90; }};
  }
  const parent = node('parent');
  const doc = {body: parent, createElement: node, fonts: {
    load: (...args) => { state.calls.push(args); return options.load ? options.load() : Promise.resolve([]); },
    ready: options.ready || Promise.resolve()
  }, createRange: () => ({selectNodeContents(span) { state.slice = span.textContent; },
    getClientRects: () => state.slice === '' ? [] : state.rects, detach() { state.detached++; }})};
  doc.defaultView = {getComputedStyle: () => computed,
    requestAnimationFrame(callback) { state.frames++; return options.stallFrames ? 123 : setTimeout(callback, 0); },
    cancelAnimationFrame(id) { state.cancelled++; clearTimeout(id); }};
  const element = {nodeType: 1, isConnected: true, ownerDocument: doc, parentElement: parent, clientWidth: 240, clientHeight: 110, textContent: 'untouched'};
  return {element, doc, parent, state};
}

test('CommonJS and browser global exports', () => {
  assert.equal(typeof prepareTextMetrics, 'function');
  const context = {}; vm.runInNewContext(fs.readFileSync(__dirname + '/text-layout.js', 'utf8'), context);
  assert.equal(typeof context.TextLayout.prepareTextMetrics, 'function');
});

test('API guards reject invalid inputs without a host', async () => {
  await assert.rejects(prepareTextMetrics(), /text/);
  await assert.rejects(prepareTextMetrics({text: 'a'}), /dialogue body/);
  for (const patch of [{text: 1}, {maxLines: 0}, {timeoutMs: 0}, {locale: ''}, {signal: {}}]) {
    const d = dom(); await assert.rejects(prepareTextMetrics({element: d.element, text: 'a', ...patch})); assert.equal(d.parent.children.length, 0);
  }
  for (const styles of [{'font-size': '0px'}, {'font-family': ''}, {width: '0px'}, {height: '0px'}]) {
    const d = dom({styles}); await assert.rejects(prepareTextMetrics({element: d.element, text: 'a'}), /Invalid/);
    assert.equal(d.parent.children.length, 0);
  }
});

test('waits for fonts and two frames; copies content geometry and typography', async () => {
  let ready; const d = dom({ready: new Promise(resolve => { ready = resolve; })});
  const pending = prepareTextMetrics({element: d.element, text: '甲乙'});
  await Promise.resolve(); assert.equal(d.state.frames, 0); ready();
  const metrics = await pending, host = d.parent.children[0];
  assert.deepEqual(d.state.calls, [['italic 20px Test Font', '甲乙']]); assert.equal(d.state.frames, 2);
  assert.equal(host.style.values.width, '220px'); assert.equal(host.style.values.height, '90px');
  assert.equal(host.style.values['font-variation-settings'], '"wght" 600');
  assert.equal(host.style.values['white-space'], 'pre-wrap'); assert.equal(host.dir, 'rtl'); assert.equal(host.lang, 'zh-CN');
  assert.equal(typeof metrics.layoutKey, 'string');
  assert.equal(d.element.textContent, 'untouched'); metrics.dispose(); metrics.dispose();
  assert.equal(d.parent.children.length, 0); assert.throws(() => metrics.measureSlice(0, 1), /disposed/);
});

test('Range rect groups and scroll overflow decide fits, not string length', async () => {
  const d = dom(), m = await prepareTextMetrics({element: d.element, text: '甲乙丙丁', maxLines: 2});
  d.state.rects = [{top: 0, height: 20}, {top: 0.8, height: 20}, {top: 30, height: 20}];
  assert.equal(m.measureSlice(0, 4).lineCount, 2); assert.equal(d.state.slice, '甲乙丙丁');
  d.state.rects.push({top: 60, height: 20}); assert.equal(m.measureSlice(0, 2).fits, false);
  d.state.rects = [{top: 0, height: 20}]; d.state.overflowX = true;
  assert.equal(m.measureSlice(0, 2).overflowX, true); assert.throws(() => m.measureSlice(0, 1), /Single grapheme/);
  d.state.overflowX = false; d.state.overflowY = true; assert.equal(m.measureSlice(0, 2).fits, false);
  d.state.overflowY = false; assert.equal(m.measureSlice(0, 0).lineCount, 0);
  assert.throws(() => m.measureSlice(-1, 1), RangeError); assert.ok(d.state.detached > 0); m.dispose();
});

test('single emoji grapheme overflow rejects', async () => {
  const d = dom(), text = '👨‍👩‍👧‍👦', m = await prepareTextMetrics({element: d.element, text});
  d.state.overflowX = true; assert.throws(() => m.measureSlice(0, text.length), /Single grapheme/); m.dispose();
});

test('pre-abort, in-flight abort and post-ready abort clean up', async () => {
  for (const timing of ['before', 'during', 'after']) {
    const control = new AbortController(), d = dom(timing === 'during' ? {load: () => new Promise(() => {})} : {});
    if (timing === 'before') control.abort();
    const pending = prepareTextMetrics({element: d.element, text: '甲', signal: control.signal});
    if (timing === 'during') control.abort();
    if (timing === 'after') {
      const m = await pending; control.abort(); assert.throws(() => m.measureSlice(0, 1), {name: 'AbortError'});
    } else await assert.rejects(pending, {name: 'AbortError'});
    assert.equal(d.parent.children.length, 0);
  }
});

test('timeouts at font load, fonts.ready and animation frame clean up', async () => {
  for (const options of [{load: () => new Promise(() => {})}, {ready: new Promise(() => {})}, {stallFrames: true}]) {
    const d = dom(options); await assert.rejects(prepareTextMetrics({element: d.element, text: 'a', timeoutMs: 20}), {name: 'TimeoutError'});
    assert.equal(d.parent.children.length, 0); if (options.stallFrames) assert.equal(d.state.cancelled, 1);
  }
});

test('font loading failures clean up', async () => {
  const d = dom({load: () => Promise.reject(new Error('font unavailable'))});
  await assert.rejects(prepareTextMetrics({element: d.element, text: 'a'}), /font unavailable/);
  assert.equal(d.parent.children.length, 0);
});
