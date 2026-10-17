'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), {createHash} = require('crypto');
const {exportComponentPack} = require('./component-pack-export.cjs');
const {prepareComponentPack, importComponentPack} = require('./components.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const decodeImage = () => ({width: 1, height: 1});
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(t, image = false) {
  const output = path.resolve(__dirname, '../../test-output/P2');
  fs.mkdirSync(output, {recursive: true});
  const base = fs.mkdtempSync(path.join(output, 'pack-export-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const root = path.join(base, 'project'), target = path.join(base, 'export');
  fs.mkdirSync(root);
  const definition = {id: 'def', name: 'Decoration', kind: 'decoration', designSize: {width: 100, height: 50}, scaleMode: 'uniform', visibility: 'instance-range', elements: [
    {id: 'panel', type: 'panel', rect: {x: 0, y: 0, width: 100, height: 50}, fill: '#ffffff', radius: 3, borderWidth: 2, opacity: 0.6},
    {id: 'text', type: 'text', rect: {x: 5, y: 10, width: 80, height: 30}, fontSize: 12, lineHeight: 1.4, color: '#000000', text: 'Editable'}
  ]};
  const project = {schemaVersion: 2, resources: [], componentDefinitions: [definition], scene: {durationFrames: 100, components: [
    {id: 'a', definitionId: 'def', x: 10, y: 20, width: 200, height: 100, zIndex: 2, locked: false, visibleFrom: 0, visibleTo: 50},
    {id: 'b', definitionId: 'def', x: -30, y: 0, width: 100, height: 50, zIndex: 1, locked: true, visibleFrom: 50, visibleTo: 100}
  ]}};
  if (image) {
    fs.writeFileSync(path.join(root, 'source.png'), png);
    project.resources.push({id: 'image', kind: 'image', mime: 'image/png', path: 'source.png', width: 1, height: 1});
    project.resources.push({id: 'unused', kind: 'image', mime: 'image/png', path: 'missing.png', width: 1, height: 1});
    definition.elements.push({id: 'picture', type: 'image', resourceId: 'image', rect: {x: 0, y: 0, width: 10, height: 10}});
  }
  return {base, root, target, project, definition};
}
test('flatten selection into one editable template, preserve geometry and stable z order without source changes', t => {
  const f = fixture(t), before = structuredClone(f.project);
  const result = exportComponentPack(f.project, f.root, ['a', 'b'], f.target, {name: 'Custom template'});
  const prepared = prepareComponentPack(f.target), d = prepared.definitions[0];
  assert.equal(prepared.definitions.length, 1); assert.equal(d.name, 'Custom template');
  assert.deepEqual(d.designSize, {width: 240, height: 120});
  assert.deepEqual(d.elements[0].rect, {x: 0, y: 0, width: 100, height: 50});
  assert.deepEqual(d.elements[2].rect, {x: 40, y: 20, width: 200, height: 100});
  assert.equal(d.elements[2].radius, 6); assert.equal(d.elements[2].borderWidth, 4); assert.equal(d.elements[2].opacity, 0.6);
  assert.equal(d.elements[3].fontSize, 24); assert.equal(d.elements[3].lineHeight, 1.4);
  assert.equal(new Set(d.elements.map(e => e.id)).size, 4);
  assert.equal(d.kind, 'decoration'); assert.equal(d.visibility, 'instance-range');
  assert.match(result.semantics, /不保留.*时序/); assert.deepEqual(f.project, before);
  assert.deepEqual(fs.readdirSync(f.root), []);
  const destination = {project: {schemaVersion: 2, resources: [], componentDefinitions: [], scene: {durationFrames: 100, components: []}}, revision: 0, apply(fn) { fn(this.project); this.revision++; }};
  importComponentPack(destination, f.root, f.target);
  assert.equal(destination.project.componentDefinitions.length, 1);
  assert.equal(destination.project.componentDefinitions[0].elements[3].text, 'Editable');
  assert.deepEqual(destination.project.scene.components, []);
});
test('copy only actual image references, preserve exact source bytes and round trip', t => {
  const f = fixture(t, true), source = path.join(f.root, 'source.png'), before = hash(source), snapshot = structuredClone(f.project);
  const result = exportComponentPack(f.project, f.root, ['a', 'b'], f.target, {decodeImage});
  assert.equal(result.nativeImageValidated, true);
  const prepared = prepareComponentPack(f.target, {decodeImage});
  assert.equal(prepared.resources.length, 1); assert.equal(prepared.resources[0].bytes.equals(png), true);
  assert.match(prepared.resources[0].path, /^assets\/[\w-]+\.png$/);
  assert.equal(hash(path.join(f.target, prepared.resources[0].path)), before);
  assert.equal(hash(source), before); assert.deepEqual(f.project, snapshot);
  assert.equal(new Set(prepared.definitions[0].elements.filter(e => e.type === 'image').map(e => e.resourceId)).size, 1);
});
test('empty unknown duplicate selection and existing target rejected without overwriting', t => {
  const f = fixture(t);
  for (const selection of [[], ['missing'], ['a', 'a']]) assert.throws(() => exportComponentPack(f.project, f.root, selection, f.target));
  fs.mkdirSync(f.target); fs.writeFileSync(path.join(f.target, 'keep'), 'unchanged');
  assert.throws(() => exportComponentPack(f.project, f.root, ['a'], f.target), {code: 'TARGET_EXISTS'});
  assert.equal(fs.readFileSync(path.join(f.target, 'keep'), 'utf8'), 'unchanged');
  assert.deepEqual(fs.readdirSync(f.base).sort(), ['export', 'project']);
});
test('bad image bytes, unsupported extensions and paths reject without output', t => {
  const f = fixture(t, true), source = path.join(f.root, 'source.png');
  fs.writeFileSync(source, '<svg/>');
  assert.throws(() => exportComponentPack(f.project, f.root, ['a'], f.target), /PNG\/JPEG/);
  fs.writeFileSync(source, png);
  for (const relative of ['../source.png', 'folder/../source.png', 'https://example/image.png', 'C:/source.png']) {
    f.project.resources[0].path = relative;
    assert.throws(() => exportComponentPack(f.project, f.root, ['a'], f.target), /路径/);
  }
  fs.writeFileSync(path.join(f.root, 'source.gif'), png); f.project.resources[0].path = 'source.gif';
  assert.throws(() => exportComponentPack(f.project, f.root, ['a'], f.target), /PNG\/JPEG/);
  assert.deepEqual(fs.readdirSync(f.base), ['project']);
});
test('native decoding and publication failures remove only owned staging', t => {
  const f = fixture(t, true), before = hash(path.join(f.root, 'source.png'));
  assert.throws(() => exportComponentPack(f.project, f.root, ['a'], f.target, {decodeImage: () => null}), /nativeImage/);
  assert.deepEqual(fs.readdirSync(f.base), ['project']);
  assert.throws(() => exportComponentPack(f.project, f.root, ['a'], f.target, {decodeImage() {
    fs.mkdirSync(f.target); fs.writeFileSync(path.join(f.target, 'keep'), 'raced'); return decodeImage();
  }}), {code: 'TARGET_EXISTS'});
  assert.equal(fs.readFileSync(path.join(f.target, 'keep'), 'utf8'), 'raced');
  assert.deepEqual(fs.readdirSync(f.base).sort(), ['export', 'project']);
  assert.equal(hash(path.join(f.root, 'source.png')), before);
});
test('groups must be selected whole and roles aggregate with legacy defaults', t => {
  const f = fixture(t);
  f.project.scene.components.forEach(i => i.groupId = 'group');
  assert.throws(() => exportComponentPack(f.project, f.root, ['a'], f.target), /全组/);
  const dialogue = structuredClone(f.definition);
  dialogue.id = 'dialogue'; dialogue.kind = 'dialogue-ui'; dialogue.roles = ['body'];
  dialogue.elements[1].binding = 'activeDialogue.text'; delete dialogue.elements[1].text;
  f.project.componentDefinitions.push(dialogue); f.project.scene.components[0].definitionId = 'dialogue';
  exportComponentPack(f.project, f.root, ['a', 'b'], f.target);
  let d = prepareComponentPack(f.target).definitions[0];
  assert.equal(d.kind, 'dialogue-ui'); assert.deepEqual(d.roles, ['body']);
  assert.equal(d.visibility, 'instance-range'); assert.equal(d.elements[3].binding, 'activeDialogue.text');
  delete dialogue.roles;
  const legacy = path.join(f.base, 'legacy');
  exportComponentPack(f.project, f.root, ['a', 'b'], legacy);
  d = prepareComponentPack(legacy).definitions[0]; assert.deepEqual(d.roles, ['body', 'speaker']);
});
test('small and large legal instance scales normalize the entire design without clamping', t => {
  const f = fixture(t); f.definition.elements[1].fontSize = 32;
  for (const scale of [0.025, 40]) {
    const i = f.project.scene.components[0]; i.width = 100 * scale; i.height = 50 * scale;
    const target = path.join(f.base, 'scale-' + scale);
    const result = exportComponentPack(f.project, f.root, ['a'], target);
    const d = prepareComponentPack(target).definitions[0], font = d.elements[1].fontSize;
    assert(font >= 1 && font <= 1000); assert.notEqual(result.normalizationScale, 1);
    assert.deepEqual(result.originalSuggestedSize, {width: i.width, height: i.height});
    const close = (a, b) => assert(Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b)));
    close(font / d.designSize.width, 32 / 100);
    close(d.elements[0].radius / d.designSize.width, 3 / 100);
    close(d.elements[0].borderWidth / d.designSize.width, 2 / 100);
    close(d.elements[1].rect.x / d.designSize.width, 5 / 100);
    assert.equal(d.elements[0].opacity, 0.6); assert.equal(d.elements[1].lineHeight, 1.4);
    assert.match(result.warnings[1], /归一化/);
  }
});
test('incompatible font scales reject explicitly rather than distorting geometry', t => {
  const f = fixture(t);
  const i = f.project.scene.components[0]; i.width = 0.1; i.height = 0.05;
  const j = f.project.scene.components[1]; j.width = 1000; j.height = 500;
  assert.throws(() => exportComponentPack(f.project, f.root, ['a', 'b'], f.target), {code: 'EXPORT_SCALE_RANGE'});
  assert.deepEqual(fs.readdirSync(f.base), ['project']);
});
test('symlink resource and target parent escape is rejected', t => {
  const f = fixture(t, true), outside = path.join(f.base, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'image.png'), png);
  try { fs.symlinkSync(outside, path.join(f.root, 'link'), 'junction'); } catch (e) { if (['EPERM', 'EACCES', 'EISDIR'].includes(e.code)) { t.skip(e.code); return; } throw e; }
  f.project.resources[0].path = 'link/image.png';
  assert.throws(() => exportComponentPack(f.project, f.root, ['a'], f.target), /符号链接/);
  f.project.resources[0].path = 'source.png';
  assert.throws(() => exportComponentPack(f.project, f.root, ['a'], path.join(f.root, 'link', 'pack')), /符号链接/);
  assert.deepEqual(fs.readdirSync(outside), ['image.png']);
});
