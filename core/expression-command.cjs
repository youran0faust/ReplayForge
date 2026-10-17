'use strict';
// Electron invoke does not preserve custom Error properties: failures are data.
function fail(code, message) { throw Object.assign(new Error(message), {code}); }
function record(value, fields) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== fields.length || fields.some(k => !Object.hasOwn(value, k)) ||
      Reflect.ownKeys(value).some(k => !fields.includes(k) || !Object.getOwnPropertyDescriptor(value, k)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), 'value'))) fail('INVALID_PAYLOAD', '字段必须精确匹配命令契约');
}
function id(value) { if (typeof value !== 'string' || !value.trim() || value.length > 256) fail('INVALID_PAYLOAD', 'ID必须是1至256字符的非空字符串'); }
function unique(items, key, kind) {
  const matches = (items || []).filter(x => x.id === key);
  if (matches.length !== 1) fail(matches.length ? 'AMBIGUOUS_TARGET' : 'NOT_FOUND', kind + '必须存在且ID唯一');
  return matches[0];
}
function createExpressionCommands({getContext, publish = () => {}, cacheLimit = 256}) {
  if (!Number.isSafeInteger(cacheLimit) || cacheLimit < 1 || cacheLimit > 4096) throw Error('invalid cacheLimit');
  const cache = new Map();
  let ownerSession, ownerDocument;
  function reset() { cache.clear(); ownerSession = undefined; ownerDocument = undefined; }
  function execute(kind, event, payload) {
    try {
      const context = getContext(), {session, documentId, win} = context;
      if (session !== ownerSession || documentId !== ownerDocument) { cache.clear(); ownerSession = session; ownerDocument = documentId; }
      if (!win || win.isDestroyed() || !win.webContents?.mainFrame || event?.sender !== win.webContents || event?.senderFrame !== win.webContents.mainFrame) fail('INVALID_SENDER', '仅允许主窗口mainFrame调用');
      if (!session) fail('NO_DOCUMENT', '工程尚未加载');
      if (context.busy) fail('BUSY', '正在选择或读写工程文件');
      const common = ['commandId', 'documentId', 'expectedRevision'];
      record(payload, [...common, ...(kind === 'drop' ? ['source', 'target', 'atFrame'] : ['characterId', 'eventId', ...(kind === 'edit' ? ['patch'] : [])])]);
      id(payload.commandId);
      if (!Number.isSafeInteger(payload.documentId) || payload.documentId < 0 || !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) fail('INVALID_PAYLOAD', '文档与版本必须是非负安全整数');
      let characterId, expressionId, frame;
      if (kind === 'drop') {
        record(payload.source, [[3,4].includes(session.project.schemaVersion)?'definitionId':'characterId', 'expressionId']); record(payload.target, ['characterId']);
        id([3,4].includes(session.project.schemaVersion)?payload.source.definitionId:payload.source.characterId); id(payload.source.expressionId); id(payload.target.characterId);
        characterId = payload.target.characterId; expressionId = payload.source.expressionId; frame = payload.atFrame;
      } else {
        id(payload.characterId); id(payload.eventId); characterId = payload.characterId;
        if (kind === 'edit') { record(payload.patch, ['frame', 'expressionId']); ({frame, expressionId} = payload.patch); if (expressionId !== null) id(expressionId); }
      }
      if (kind !== 'delete' && (!Number.isSafeInteger(frame) || frame < 0 || frame >= session.project.scene.durationFrames)) fail('INVALID_FRAME', '帧必须位于场景范围内');
      if (payload.documentId !== documentId) fail('DOCUMENT_MISMATCH', '命令属于旧工程');
      const fingerprint = JSON.stringify([kind, payload.documentId, payload.expectedRevision, characterId, payload.eventId, expressionId, frame, payload.source?.characterId, payload.source?.definitionId]);
      const cached = cache.get(payload.commandId);
      if (cached) {
        if (cached.fingerprint !== fingerprint) fail('COMMAND_ID_REUSED', '同commandId不能用于不同命令或payload');
        if (cached.result.revision !== session.revision) fail('COMMAND_STALE', '命令已执行但工程随后已变化；不会重新应用');
        return structuredClone(cached.result);
      }
      if (payload.expectedRevision !== session.revision) fail('REVISION_MISMATCH', '工程版本已改变');
      // Explicit edit applies its own expression form; do not deadlock Apply.
      if (context.dialoguePageDraftDirty || (context.expressionDraftDirty && kind !== 'edit')) fail('DIRTY_DRAFT', '请先应用或放弃相关表单');
      if (kind === 'drop' && ![3,4].includes(session.project.schemaVersion) && payload.source.characterId !== characterId) fail('CROSS_CHARACTER', '表情只能拖入所属角色');
      const character = unique(session.project.scene.characters, characterId, '角色');
      if(kind==='drop'&&[3,4].includes(session.project.schemaVersion)&&payload.source.definitionId!==character.definitionId)fail('CROSS_CHARACTER','表情只能拖入引用所属模板的角色实例');
      if (kind !== 'delete' && expressionId !== null) {const definition=[3,4].includes(session.project.schemaVersion)?unique(session.project.characterDefinitions,character.definitionId,'角色模板'):character;unique(definition.expressions, expressionId, '表情');}
      if (kind !== 'drop') unique(character.expressionEvents, payload.eventId, '事件');
      if (kind !== 'delete' && (character.expressionEvents || []).some(e => e.frame === frame && (kind === 'drop' || e.id !== payload.eventId))) fail('FRAME_CONFLICT', '该帧已有表情事件');
      let eventId = payload.eventId;
      if (kind === 'drop') eventId = session.addExpressionEvent(characterId, {frame, expressionId}).id;
      else if (kind === 'edit') session.editExpressionEvent(characterId, eventId, {frame, expressionId});
      else session.deleteExpressionEvent(characterId, eventId);
      const result = {ok: true, commandId: payload.commandId, documentId, revision: session.revision, [kind === 'drop' ? 'created' : kind === 'edit' ? 'updated' : 'deleted']: {characterId, eventId}};
      cache.set(payload.commandId, {fingerprint, result});
      if (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
      try { publish(); } catch (error) { console.error('Expression command publication failed:', error); }
      return structuredClone(result);
    } catch (error) { return {ok: false, error: {code: error.code || 'TRANSACTION_REJECTED', message: error.message}}; }
  }
  return {dropExpression: (e, p) => execute('drop', e, p), editExpressionEventChecked: (e, p) => execute('edit', e, p), deleteExpressionEventChecked: (e, p) => execute('delete', e, p), reset};
}
module.exports = {createExpressionCommands};
