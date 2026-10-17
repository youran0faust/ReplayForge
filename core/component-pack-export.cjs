'use strict';
const fs = require('fs'), path = require('path'), {randomUUID} = require('crypto');
const {parseImage} = require('./image-import.cjs');
const {componentErrors, fail, text} = require('./components-model.cjs');
const {prepareComponentPack} = require('./components.cjs');
const SEMANTICS = '导出为一个组合模板：保留相对布局及可编辑内部元素，不保留原场景时间区间、分组、锁定及历史时序；导入后作为新部件放置。无活动对话时绑定文字为空，装饰元素按新实例区间显示。';
function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') || value.split(/[\\/]/).some(p => p === '.' || p === '..')) fail('必须为无点路径的绝对目录', 'RESOURCE_PATH');
  return path.resolve(value);
}
function directory(value) {
  const resolved = absolute(value);
  let current = path.parse(resolved).root;
  for (const part of path.relative(current, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('目录含符号链接或不是目录', 'RESOURCE_PATH');
  }
  return fs.realpathSync(resolved);
}
function absent(file) {
  try { fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  fail('目标已存在，禁止覆盖', 'TARGET_EXISTS');
}
function imageBytes(root, relative) {
  if (typeof relative !== 'string' || !relative || /[\\:\0]/.test(relative) || path.isAbsolute(relative) || relative.split('/').some(p => !p || p === '.' || p === '..')) fail('非法资源相对路径', 'RESOURCE_PATH');
  let file = root;
  const parts = relative.split('/');
  for (let n = 0; n < parts.length; n++) {
    file = path.join(file, parts[n]);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || (n < parts.length - 1 && !stat.isDirectory())) fail('资源含符号链接', 'RESOURCE_PATH');
  }
  const real = fs.realpathSync(file), rel = path.relative(root, real);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) fail('资源逃逸工程目录', 'RESOURCE_PATH');
  const before = fs.statSync(real);
  if (!before.isFile() || before.size > 32 * 1024 * 1024) fail('资源不是文件或大小超限', 'RESOURCE_TOO_LARGE');
  const fd = fs.openSync(real, 'r');
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) fail('读取期间资源变化');
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) fail('读取不完整');
      offset += count;
    }
    const after = fs.fstatSync(fd);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) fail('读取期间资源变化');
    return bytes;
  } finally { fs.closeSync(fd); }
}
// Change the design coordinate unit, never clamp individual geometry or fonts.
// Most exports keep factor=1; extreme legal instance scales may need a new unit
// to remain representable by the existing pack schema.
function normalizeDesign(definition) {
  let lower = 0, upper = Infinity;
  const constrain = (value, min, max) => {
    if (!Number.isFinite(value) || value < 0) fail('组合坐标无法归一化', 'EXPORT_SCALE_RANGE');
    if (value === 0) { if (min > 0) fail('组合尺寸无法归一化', 'EXPORT_SCALE_RANGE'); return; }
    lower = Math.max(lower, min / value);
    upper = Math.min(upper, max / value);
  };
  for (const value of Object.values(definition.designSize)) constrain(value, 0.001, 1000000);
  for (const e of definition.elements) {
    constrain(Math.abs(e.rect.x), 0, 1000000); constrain(Math.abs(e.rect.y), 0, 1000000);
    constrain(e.rect.width, 0.001, 1000000); constrain(e.rect.height, 0.001, 1000000);
    if (e.fontSize !== undefined) constrain(e.fontSize, 1, 1000);
    for (const key of ['radius', 'borderWidth']) if (e[key] !== undefined) constrain(e[key], 0, 1000000);
  }
  if (lower > upper || !Number.isFinite(lower) || upper <= 0) fail('组合尺寸与字号跨度无法在现有格式范围内统一归一化；请拆分导出', 'EXPORT_SCALE_RANGE');
  let factor = 1;
  // Prefer an interior point to avoid rounding just outside a schema boundary.
  if (lower > 1) factor = Math.min(upper, lower * (1 + 1e-12));
  else if (upper < 1) factor = Math.max(lower, upper * (1 - 1e-12));
  if (factor !== 1) {
    definition.designSize.width *= factor; definition.designSize.height *= factor;
    for (const e of definition.elements) {
      for (const key of ['x', 'y', 'width', 'height']) e.rect[key] *= factor;
      for (const key of ['fontSize', 'radius', 'borderWidth']) if (e[key] !== undefined) e[key] *= factor;
    }
  }
  return factor;
}
function exportComponentPack(project, projectRoot, instanceIds, targetDirectory, options = {}) {
  if (!Array.isArray(instanceIds) || !instanceIds.length || instanceIds.some(id => typeof id !== 'string' || !id) || new Set(instanceIds).size !== instanceIds.length) fail('必须选择至少一个不重复的存在实例');
  const errors = componentErrors(project);
  if (errors.length) fail(errors.join(';'));
  const instances = project.scene.components || [], ids = new Set(instanceIds);
  const selected = instances.filter(i => ids.has(i.id));
  if (selected.length !== ids.size) fail('选择的实例不存在');
  const groups = new Set(selected.map(i => i.groupId).filter(id => id !== undefined));
  if (instances.some(i => groups.has(i.groupId) && !ids.has(i.id))) fail('选择分组时必须选择全组');
  const root = directory(projectRoot), target = absolute(targetDirectory), parent = directory(path.dirname(target));
  absent(target);
  const name = options.name === undefined ? '组合模板' : options.name;
  text(name);
  const defs = new Map(project.componentDefinitions.map(d => [d.id, d]));
  const x = Math.min(...selected.map(i => i.x)), y = Math.min(...selected.map(i => i.y));
  const width = Math.max(...selected.map(i => i.x + i.width)) - x;
  const height = Math.max(...selected.map(i => i.y + i.height)) - y;
  const roles = new Set(), elements = [];
  for (const instance of selected.slice().sort((a, b) => a.zIndex - b.zIndex)) {
    const definition = defs.get(instance.definitionId), scale = instance.width / definition.designSize.width;
    for (const role of definition.roles ?? (definition.kind === 'dialogue-ui' ? ['body', 'speaker'] : [])) roles.add(role);
    for (const source of definition.elements) {
      const element = structuredClone(source);
      element.id = 'element_' + randomUUID();
      element.rect = {x: instance.x - x + source.rect.x * scale, y: instance.y - y + source.rect.y * scale, width: source.rect.width * scale, height: source.rect.height * scale};
      for (const key of ['fontSize', 'radius', 'borderWidth']) if (element[key] !== undefined) element[key] *= scale;
      // lineHeight and opacity are dimensionless multipliers, not lengths.
      elements.push(element);
    }
  }
  const definition = {id: 'component_definition_' + randomUUID(), name, kind: roles.size ? 'dialogue-ui' : 'decoration', designSize: {width, height}, scaleMode: 'uniform', visibility: 'instance-range', elements};
  if (roles.size) definition.roles = ['body', 'speaker'].filter(role => roles.has(role));
  const normalizationScale = normalizeDesign(definition), originalSuggestedSize = {width, height};
  const warnings = [SEMANTICS];
  if (normalizationScale !== 1) warnings.push(`设计坐标已统一归一化 ${normalizationScale} 倍以满足格式范围，未裁剪字号或改变相对布局；导入后设置实例尺寸 ${width} × ${height} 可还原原场景组合大小。`);
  const resources = [], payloads = [], mapping = new Map();
  let total = 0;
  for (const element of elements) {
    if (element.type !== 'image') continue;
    if (!mapping.has(element.resourceId)) {
      const source = (project.resources || []).find(r => r.id === element.resourceId);
      if (!source || source.kind !== 'image' || !['image/png', 'image/jpeg'].includes(source.mime)) fail('资源必须为 PNG/JPEG', 'INVALID_IMAGE');
      const bytes = imageBytes(root, source.path), info = parseImage(bytes, path.extname(source.path));
      if (source.mime !== info.mime) fail('图片内容与登记类型不符', 'INVALID_IMAGE');
      const id = 'image_' + randomUUID(), relative = 'assets/' + randomUUID() + info.extension;
      total += bytes.length;
      if (total > 128 * 1024 * 1024 || resources.length >= 100) fail('资源数量或总大小超限', 'RESOURCE_TOO_LARGE');
      resources.push({id, path: relative}); payloads.push(bytes); mapping.set(element.resourceId, id);
    }
    element.resourceId = mapping.get(element.resourceId);
  }
  const manifest = {format: 'replay-component-pack', formatVersion: '0.1', id: 'component_pack_' + randomUUID(), name, version: '1.0.0', description: warnings.join('\n'), resources, components: [definition]};
  const json = JSON.stringify(manifest, null, 2) + '\n';
  if (Buffer.byteLength(json) > 1024 * 1024 || total + Buffer.byteLength(json) > 128 * 1024 * 1024) fail('包大小超限', 'RESOURCE_TOO_LARGE');
  let staging;
  try {
    staging = fs.mkdtempSync(path.join(parent, '.component-pack-staging-'));
    if (resources.length) fs.mkdirSync(path.join(staging, 'assets'));
    resources.forEach((resource, index) => fs.writeFileSync(path.join(staging, resource.path), payloads[index], {flag: 'wx'}));
    fs.writeFileSync(path.join(staging, 'pack.json'), json, {flag: 'wx'});
    // Without a native decoder this is structural validation only.
    prepareComponentPack(staging, {decodeImage: options.decodeImage ?? (bytes => parseImage(bytes))});
    absent(target);
    fs.renameSync(staging, target);
    staging = undefined;
  } finally {
    if (staging) fs.rmSync(staging, {recursive: true, force: true});
  }
  return {targetDirectory: target, definitionId: definition.id, resourceIds: resources.map(r => r.id), instanceIds: [...instanceIds], semantics: SEMANTICS, warnings, normalizationScale, originalSuggestedSize, nativeImageValidated: resources.length > 0 && typeof options.decodeImage === 'function'};
}
module.exports = {exportComponentPack};
