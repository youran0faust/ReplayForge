'use strict';
const fs = require('fs'), path = require('path');
const {randomUUID} = require('crypto');
const {parseVoiceWav} = require('./voice-import.cjs');
const {parseImage} = require('./image-import.cjs');
function fail(code, message) { throw Object.assign(new Error(message), {code}); }
function record(value, fields) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== fields.length || fields.some(k => !Object.hasOwn(value, k)) ||
      Reflect.ownKeys(value).some(k => !fields.includes(k) || !Object.getOwnPropertyDescriptor(value, k)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), 'value'))) fail('INVALID_PAYLOAD', '字段必须精确匹配命令契约');
}
function id(value) { if (typeof value !== 'string' || !value.trim() || value.length > 256) fail('INVALID_PAYLOAD', 'ID必须是1至256字符的非空字符串'); }
function unique(items, key) {
  const matches = (items || []).filter(x => x.id === key);
  if (matches.length !== 1) fail(matches.length ? 'AMBIGUOUS_TARGET' : 'NOT_FOUND', '目标必须存在且ID唯一');
  return matches[0];
}
function inside(root, file) { const rel = path.relative(root, file); return rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); }
// Registered resources only. Bound allocation before reading the opened file;
// never import, copy, or write bytes. Symlinks resolving outside root are refused.
function resourceBytes(root, resource, limit) {
  if (typeof resource.path !== 'string' || !resource.path || path.isAbsolute(resource.path) || /[:\x00]/.test(resource.path)) fail('RESOURCE_PATH', '资源必须是工程内相对文件路径');
  root = fs.realpathSync(root);
  const candidate = path.resolve(root, resource.path);
  if (!inside(root, candidate)) fail('RESOURCE_PATH', '资源超出工程目录');
  let real;
  try { real = fs.realpathSync(candidate); } catch (error) { fail('RESOURCE_MISSING', '找不到资源文件'); }
  if (!inside(root, real)) fail('RESOURCE_PATH', '资源realpath超出工程目录');
  const stat = fs.statSync(real);
  if (!stat.isFile()) fail('RESOURCE_NOT_FILE', '资源必须是普通文件');
  if (stat.size > limit) fail('RESOURCE_TOO_LARGE', '资源超过大小上限');
  const fd = fs.openSync(real, 'r');
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) fail('RESOURCE_CHANGED', '读取时资源发生变化');
    if (opened.size > limit) fail('RESOURCE_TOO_LARGE', '资源超过大小上限');
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) { const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (!n) fail('RESOURCE_CHANGED', '读取时资源发生变化'); offset += n; }
    if (fs.fstatSync(fd).size !== opened.size) fail('RESOURCE_CHANGED', '读取时资源发生变化');
    return bytes;
  } finally { fs.closeSync(fd); }
}
function createMediaCommands({getContext, publish = () => {}, decodeImage, cacheLimit = 256}) {
  if (!Number.isSafeInteger(cacheLimit) || cacheLimit < 1 || cacheLimit > 4096) throw Error('invalid cacheLimit');
  const cache = new Map(); let ownerSession, ownerDocument;
  function reset() { cache.clear(); ownerSession = ownerDocument = undefined; }
  function execute(kind, event, payload) {
    try {
      const context = getContext(), {session, documentId, win} = context;
      if (session !== ownerSession || documentId !== ownerDocument) { reset(); ownerSession = session; ownerDocument = documentId; }
      if (!win || win.isDestroyed() || !win.webContents?.mainFrame || event?.sender !== win.webContents || event?.senderFrame !== win.webContents.mainFrame) fail('INVALID_SENDER', '仅允许主窗口mainFrame调用');
      if (!session) fail('NO_DOCUMENT', '工程尚未加载');
      if (context.busy) fail('BUSY', '正在选择或读写工程文件');
      record(payload, ['commandId', 'documentId', 'expectedRevision', ...(kind === 'audio' ? ['resourceId', 'kind', 'atFrame'] : kind === 'background' ? ['resourceId', 'atFrame'] : ['eventId', ...(kind === 'edit' ? ['patch'] : [])])]);
      id(payload.commandId);
      if (!Number.isSafeInteger(payload.documentId) || payload.documentId < 0 || !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) fail('INVALID_PAYLOAD', '文档与版本必须是非负安全整数');
      let resourceId = payload.resourceId, frame = payload.atFrame;
      if (kind === 'edit') { record(payload.patch, ['frame', 'resourceId']); ({frame, resourceId} = payload.patch); }
      if (kind === 'edit' || kind === 'delete') id(payload.eventId);
      if (kind !== 'delete') { id(resourceId); if (!Number.isSafeInteger(frame) || frame < 0 || frame >= session.project.scene.durationFrames) fail('INVALID_FRAME', '帧必须位于场景范围内'); }
      if (kind === 'audio' && !['bgm', 'sfx'].includes(payload.kind)) fail('INVALID_PAYLOAD', '音频用途仅支持bgm/sfx');
      if (payload.documentId !== documentId) fail('DOCUMENT_MISMATCH', '命令属于旧工程');
      const fingerprint = JSON.stringify([kind, documentId, payload.expectedRevision, resourceId, frame, payload.kind, payload.eventId]);
      const cached = cache.get(payload.commandId);
      if (cached) {
        if (cached.fingerprint !== fingerprint) fail('COMMAND_ID_REUSED', '同commandId不能用于不同命令');
        if (cached.result.revision !== session.revision) fail('COMMAND_STALE', '命令已执行但工程随后已变化');
        return structuredClone(cached.result);
      }
      if (payload.expectedRevision !== session.revision) fail('REVISION_MISMATCH', '工程版本已改变');
      if (context.expressionDraftDirty || context.dialoguePageDraftDirty || (context.mediaDraftDirty && kind !== 'edit')) fail('DIRTY_DRAFT', '请先应用或放弃相关表单');
      const project = session.project;
      if (kind === 'edit' || kind === 'delete') unique(project.scene.backgroundEvents, payload.eventId);
      if (kind !== 'audio' && kind !== 'delete' && (project.scene.backgroundEvents || []).some(e => e.frame === frame && (kind !== 'edit' || e.id !== payload.eventId))) fail('FRAME_CONFLICT', '该帧已有背景事件');
      let info, metadata = {};
      if (kind !== 'delete') {
        const resource = unique(project.resources, resourceId);
        if (resource.kind !== (kind === 'audio' ? 'audio' : 'image')) fail('RESOURCE_KIND', '资源类型不匹配');
        if (kind === 'audio') {
          try { info = parseVoiceWav(resourceBytes(context.projectRoot, resource, 256 * 1024 * 1024)); }
          catch (error) { if (error.code) throw error; fail('INVALID_AUDIO', error.message); }
          for (const key of ['sampleRate', 'channels', 'bitsPerSample', 'durationSamples']) {
            if (Object.hasOwn(resource, key) && resource[key] !== info[key]) fail('AUDIO_METADATA_MISMATCH', '音频元数据与真实源不一致：' + key);
            if (!Object.hasOwn(resource, key)) metadata[key] = info[key];
          }
          const frameSamples = 48000 / project.design.fps;
          if (!Number.isSafeInteger(frameSamples) || !Number.isSafeInteger(frame * frameSamples + info.durationSamples) || frame * frameSamples + info.durationSamples > project.scene.durationFrames * frameSamples) fail('AUDIO_OUT_OF_RANGE', '完整音频超出场景；请另行裁剪或修改场景，不会自动截断');
        } else {
          if (/\.svg$/i.test(resource.path) || resource.mime === 'image/svg+xml') fail('UNSUPPORTED_IMAGE', 'SVG背景拖入/编辑尚未支持；旧工程加载不受影响');
          try {
            const bytes = resourceBytes(context.projectRoot, resource, 32 * 1024 * 1024);
            info = parseImage(bytes, path.extname(resource.path));
            if (resource.mime && resource.mime !== info.mime) fail('IMAGE_METADATA_MISMATCH', '图片格式元数据不一致');
            const decoded = decodeImage?.(bytes);
            if (!decoded || decoded.width !== info.width || decoded.height !== info.height) fail('INVALID_IMAGE', '图片无法完整解码或尺寸不一致');
          } catch (error) { if (error.code) throw error; fail('INVALID_IMAGE', error.message); }
        }
      }
      const objectId = (kind === 'audio' ? 'track_' : 'background_') + randomUUID();
      if ((kind === 'audio' ? project.scene.audioTracks : project.scene.backgroundEvents)?.some(x => x.id === objectId)) fail('ID_CONFLICT', '新对象ID冲突');
      session.apply(candidate => {
        if (kind === 'audio') {
          Object.assign(unique(candidate.resources, resourceId), metadata);
          (candidate.scene.audioTracks ||= []).push({id: objectId, name: resourceId, kind: payload.kind, resourceId, startFrame: frame, sourceOffsetSamples: 0, durationSamples: info.durationSamples, gain: 1});
        } else if (kind === 'background') (candidate.scene.backgroundEvents ||= []).push({id: objectId, frame, background: {kind: 'image', resourceId}});
        else if (kind === 'edit') Object.assign(unique(candidate.scene.backgroundEvents, payload.eventId), {frame, background: {kind: 'image', resourceId}});
        else candidate.scene.backgroundEvents = candidate.scene.backgroundEvents.filter(e => e.id !== payload.eventId);
      }, 'media ' + kind);
      const result = {ok: true, commandId: payload.commandId, documentId, revision: session.revision,
        [kind === 'edit' ? 'updated' : kind === 'delete' ? 'deleted' : 'created']: kind === 'audio' ? {audioTrackId: objectId} : {eventId: kind === 'background' ? objectId : payload.eventId}};
      cache.set(payload.commandId, {fingerprint, result}); if (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
      try { publish(); } catch (error) { console.error('Media command publication failed:', error); }
      return structuredClone(result);
    } catch (error) { return {ok: false, error: {code: error.code || 'TRANSACTION_REJECTED', message: error.message}}; }
  }
  return {dropAudioResource: (e, p) => execute('audio', e, p), dropBackgroundResource: (e, p) => execute('background', e, p), editBackgroundEventChecked: (e, p) => execute('edit', e, p), deleteBackgroundEventChecked: (e, p) => execute('delete', e, p), reset};
}
module.exports = {createMediaCommands};
