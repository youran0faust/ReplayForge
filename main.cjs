const {app, BrowserWindow, ipcMain, dialog, nativeImage, Menu, screen, shell} = require('electron');
const {getWindowOptions,loadWindowState,trackWindowState} = screen ? require('./core/window-state.cjs') : {};
const {installEditorContextMenu} = require('./core/context-menu.cjs');
const {importExpressionImage, importImage, unbindImage, requireImageTarget} = require('./core/image-import.cjs');
const path = require('path');
const fs = require('fs');
const {pathToFileURL} = require('url');
const {ProjectSession} = require('./core/session.cjs');
const {applyTimelineEdit} = require('./core/timeline-edit.cjs');
const {applyProjectCode} = require('./core/code-edit.cjs');
const {importVoice, unbindVoice} = require('./core/voice-import.cjs');
const {setDialogueVoiceBinding, editDialogueVoiceTiming} = require('./core/voice-binding.cjs');
const {importAudioTrack, editAudioTrack, splitAudioTrack, deleteAudioTrack, validateAudioTrackOptions} = require('./core/audio-track.cjs');
const {saveSessionPortable, openPortable} = require('./core/project-storage.cjs');

const {RecoveryStore, normalizeDraft} = require('./core/recovery.cjs');
const recovery = new RecoveryStore(process.env.REPLAY_RECOVERY_DIR || path.join(__dirname, 'runtime-output', 'recovery'));
let codeDraft = null, draftVersion = 0, documentId = 0;
let expressionDraftDirty = false, dialoguePageDraftDirty = false, mediaDraftDirty = false, extensionDraftDirty = false, voiceClipDraftDirty = false, componentDraftDirty = false, characterDefinitionDraftDirty = false, textImportDraftDirty = false, characterPerformanceDraftDirty = false, scenePerformanceDraftDirty = false;
let recoveryTimer = null, recoveryFirstChangeAt = null, recoverySavedAt = null, recoveryError = null, recoveryBlocked = false;
const RECOVERY_IDLE_MS = 5000, RECOVERY_MAX_WAIT_MS = 15000;
// Recovery writes are synchronous portable snapshot transactions on the main
// thread, so capture and publication cannot interleave with mutations.
function hasRecoverableChanges() { return session.revision !== session.savedRevision || !!codeDraft?.dirty; }
function isDirty() { return hasRecoverableChanges() || expressionDraftDirty || dialoguePageDraftDirty || mediaDraftDirty || extensionDraftDirty || characterDefinitionDraftDirty || textImportDraftDirty || characterPerformanceDraftDirty || scenePerformanceDraftDirty; }
function recoveryStatus() { return {codeDraft, documentId, expressionDraftDirty, dialoguePageDraftDirty, mediaDraftDirty, extensionDraftDirty, characterDefinitionDraftDirty, textImportDraftDirty, characterPerformanceDraftDirty, scenePerformanceDraftDirty, recoverySavedAt, recoveryPending:!!recoveryTimer, recoveryError}; }
function publishRecoveryStatus() {
  if (win && !win.isDestroyed()) win.webContents.send('recovery-status', recoveryStatus());
}
function cancelRecoveryTimer() { if (recoveryTimer) clearTimeout(recoveryTimer); recoveryTimer = null; recoveryFirstChangeAt = null; }
function clearRecovery() { cancelRecoveryTimer(); recovery.clear(); recoverySavedAt = null; recoveryError = null; recoveryBlocked = false; }
function scheduleRecovery() {
  if (recoveryBlocked || !session || !hasRecoverableChanges()) return;
  if (codeDraft?.dirty && codeDraft.baseRevision !== session.revision) codeDraft.stale = true;
  if (typeof setTimeout !== 'function') return;
  const now = Date.now();
  if (recoveryFirstChangeAt === null) recoveryFirstChangeAt = now;
  if (recoveryTimer) clearTimeout(recoveryTimer);
  const delay = Math.min(RECOVERY_IDLE_MS, Math.max(0, RECOVERY_MAX_WAIT_MS - (now - recoveryFirstChangeAt)));
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null; recoveryFirstChangeAt = null;
    try {
      if (hasRecoverableChanges()) recoverySavedAt = recovery.write({project:session.snapshot(), revision:session.revision, root:projectRoot, draft:codeDraft, originalFile:currentFile});
      recoveryError = null;
    } catch (error) { recoveryError = error.message; }
    publishRecoveryStatus();
  }, delay);
}

const exampleFile = path.join(__dirname, 'examples/rain-corridor-v4.json');
let session, win;
let projectRoot = __dirname;
let currentFile = null, openedSchemaVersion = null;
let busy = false;
let exporting = false, activeExport = null;
let allowClose = false;
app.setPath('userData', path.join(__dirname, 'user-data'));

// Preview reads never acquire the file-operation lock. Each provider owns only
// an application cache directory, and each reply is tied to its captured document.
let videoGeneration = 0, videoProvider = null, videoCacheRoot = null, videoCacheRootIdentity = null;
let videoPending = 0, videoClosing = false;
function removeOwnedVideoRoot(root, identity) {
  if (!root || !identity) return;
  try {
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== identity.dev || stat.ino !== identity.ino) return;
    fs.rmSync(root, {recursive:true, force:true});
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error('Video cache cleanup failed:', error);
  }
}
const videoDisposals = new Set(), videoTokens = new Map();
function resetVideoFrames() {
  videoGeneration++; videoTokens.clear();
  const provider = videoProvider, root = videoCacheRoot, identity = videoCacheRootIdentity;
  videoProvider = null; videoCacheRoot = null; videoCacheRootIdentity = null;
  if (!provider && !root) return Promise.resolve();
  const disposal = Promise.resolve().then(() => provider?.dispose()).then(() => {
    removeOwnedVideoRoot(root, identity);
  }).catch(error => console.error('Video preview cleanup failed:', error));
  videoDisposals.add(disposal);
  disposal.finally(() => videoDisposals.delete(disposal));
  return disposal;
}
function videoSender(event) {
  if (videoClosing || !win || win.isDestroyed() || !win.webContents?.mainFrame || win.webContents.isDestroyed?.() || event?.sender !== win.webContents || event?.senderFrame !== win.webContents.mainFrame) throw Error('VIDEO_SENDER: 仅主窗口mainFrame可读取视频');
}
function getVideoProvider() {
  if (videoProvider) return videoProvider;
  const base = path.join(__dirname, 'runtime-output', 'video-cache');
  fs.mkdirSync(base, {recursive:true});
  videoCacheRoot = fs.mkdtempSync(path.join(base, 'preview-'));
  videoCacheRootIdentity = fs.lstatSync(videoCacheRoot);
  const generation = videoGeneration;
  try {
    videoProvider = require('./core/video-frame-provider.cjs').createVideoFrameProvider({
      cacheRoot:videoCacheRoot,
      ffmpegPath:path.resolve(__dirname, '../p0/tools/ffmpeg.exe'),
      check:() => !videoClosing && generation === videoGeneration && !!win && !win.isDestroyed()
    });
  } catch (error) { removeOwnedVideoRoot(videoCacheRoot, videoCacheRootIdentity); videoCacheRoot=null; videoCacheRootIdentity=null; throw error; }
  return videoProvider;
}
ipcMain.handle('video-frame', async (event, payload) => {
  videoSender(event);
  if (busy) throw Error('BUSY: 正在读写工程');
  if (!session) throw Error('VIDEO_DOCUMENT: 工程尚未加载');
  const required = ['resourceId','localFrame'], allowed = [...required,'documentId','revision'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Reflect.ownKeys(payload).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(payload,k)) || Reflect.ownKeys(payload).some(k => { const d=Object.getOwnPropertyDescriptor(payload,k); return !d.enumerable || !Object.hasOwn(d,'value'); }) || typeof payload.resourceId !== 'string' || !payload.resourceId || payload.resourceId.length > 256 || !Number.isSafeInteger(payload.localFrame) || payload.localFrame < 0) throw Error('VIDEO_FIELDS: 视频帧字段无效');
  for (const key of ['documentId','revision']) if (Object.hasOwn(payload,key) && (!Number.isSafeInteger(payload[key]) || payload[key] < 0 || payload[key] !== (key === 'documentId' ? documentId : session.revision))) throw Error('VIDEO_DOCUMENT: 文档或修订已变化');
  const resource = session.project.resources.find(r => r.id === payload.resourceId);
  if (!resource || resource.kind !== 'video' || payload.localFrame >= resource.frameCount) throw Error('VIDEO_RESOURCE: 当前工程视频资源或帧无效');
  if (videoPending >= 16) throw Error('BUSY: 视频帧请求过多');
  const captured = {session, documentId, revision:session.revision, projectRoot, owner:win, generation:videoGeneration};
  const project = session.snapshot(), resourceId = payload.resourceId, localFrame = payload.localFrame;
  const token = {}; videoTokens.set(resourceId, token); videoPending++;
  try {
    const result = await getVideoProvider().frame({project, projectRoot:captured.projectRoot, resourceId, localFrame});
    videoSender(event);
    if (session !== captured.session || documentId !== captured.documentId || session.revision !== captured.revision || projectRoot !== captured.projectRoot || win !== captured.owner || videoGeneration !== captured.generation || videoTokens.get(resourceId) !== token) throw Error('VIDEO_STALE: 视频帧属于旧请求或旧工程');
    return result;
  } finally { videoPending--; if (videoTokens.get(resourceId) === token) videoTokens.delete(resourceId); }
});

ipcMain.handle('video-prepare', async (event, payload = {}) => {
  videoSender(event);
  if (busy) throw Error('BUSY: 正在读写工程');
  if (!session) throw Error('VIDEO_DOCUMENT: 工程尚未加载');
  const allowed = ['documentId','revision'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Reflect.ownKeys(payload).some(k => !allowed.includes(k) || !Object.getOwnPropertyDescriptor(payload,k).enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(payload,k),'value'))) throw Error('VIDEO_FIELDS: 视频预加载字段无效');
  for (const key of allowed) if (Object.hasOwn(payload,key) && (!Number.isSafeInteger(payload[key]) || payload[key] < 0 || payload[key] !== (key === 'documentId' ? documentId : session.revision))) throw Error('VIDEO_DOCUMENT: 文档或修订已变化');
  if (videoPending >= 16) throw Error('BUSY: 视频帧请求过多');
  const captured = {session, documentId, revision:session.revision, projectRoot, owner:win, generation:videoGeneration};
  const project = session.snapshot();
  videoPending++;
  try {
    const result = await getVideoProvider().prepare({project, projectRoot:captured.projectRoot});
    videoSender(event);
    if (session !== captured.session || documentId !== captured.documentId || session.revision !== captured.revision || projectRoot !== captured.projectRoot || win !== captured.owner || videoGeneration !== captured.generation) throw Error('VIDEO_STALE: 视频预加载属于旧工程');
    return result;
  } finally { videoPending--; }
});

function resourceUrl(project, id) {
  const resource = (project.resources || []).find(item => item.id === id);
  return resource ? pathToFileURL(path.resolve(projectRoot, resource.path)).href : null;
}

function bundle() {
  const project = session.snapshot();
  return {
    project, revision: session.revision, savedRevision: session.savedRevision,
    file: currentFile, dirty: isDirty(), ...recoveryStatus(),
    resourceUrls: Object.fromEntries((project.resources || []).map(r => [r.id, resourceUrl(project, r.id)]))
  };
}

function send() {
  scheduleRecovery();
  if (win && !win.isDestroyed()) {
    const state = bundle();
    win.webContents.send('state', session.evaluate(0), state.project, state.revision, state.resourceUrls, recoveryStatus());
  }
}

function requireIdle() {
  if (busy) throw Error('正在选择或读写工程文件，请稍后重试');
  if (!session) throw Error('工程尚未加载');
}

async function fileOperation(operation) {
  requireIdle();
  busy = true;
  try { return await operation(); }
  finally { busy = false; }
}

// Revision checks are a second guard against edits during asynchronous dialogs.
function capture() {
  return {session, revision: session.revision, root: projectRoot, owner: win, draftVersion};
}

function assertUnchanged(captured) {
  if (session !== captured.session || session.revision !== captured.revision ||
      projectRoot !== captured.root || draftVersion !== captured.draftVersion || win !== captured.owner || !win || win.isDestroyed()) {
    throw Error('选择文件期间工程已改变，操作已取消以保留修改');
  }
}

async function confirmDiscard(captured) {
  if (!isDirty()) return true;
  const answer = await dialog.showMessageBox(win, {
    type: 'warning', title: '工程有未保存的修改',
    message: '放弃未保存的修改？', detail: (expressionDraftDirty || dialoguePageDraftDirty || mediaDraftDirty || extensionDraftDirty || characterDefinitionDraftDirty || textImportDraftDirty || characterPerformanceDraftDirty || scenePerformanceDraftDirty) ? '还有未应用的表情、画布、对白分页、媒体或场景演出表单；仅保存工程不会保存这些内容。选择“取消”返回编辑器应用或放弃表单。' : '选择“取消”返回工程并保存。',
    buttons: ['取消', '放弃修改'], defaultId: 0, cancelId: 0, noLink: true
  });
  assertUnchanged(captured);
  return answer.response === 1;
}

function installProject(loaded, revision) {
  const next = new ProjectSession(loaded.project);
  next.revision = revision;
  next.savedRevision = revision;
  // Opening a document starts a fresh history. Saves rebase the existing session below.
  resetVideoFrames();
  session = next;
  resetExternalDropState(); expressionCommands.reset(); mediaCommands.reset(); voiceClipCommands.reset(); componentCommands.reset(); textCommands.reset(); characterLibraryCommands.reset(); characterClipCommands.reset(); performanceCommands.reset(); scenePerformanceCommands.reset(); timelineClipboard.reset(); timelineDeleteCommands.reset(); characterRowCommands.reset();
  projectRoot = loaded.root;
  currentFile = loaded.file; openedSchemaVersion = loaded.project.schemaVersion;
  codeDraft = null; expressionDraftDirty = dialoguePageDraftDirty = mediaDraftDirty = extensionDraftDirty = voiceClipDraftDirty = componentDraftDirty = characterDefinitionDraftDirty = textImportDraftDirty = characterPerformanceDraftDirty = scenePerformanceDraftDirty = false; draftVersion++; documentId++;
  send();
}

async function saveProject(chooseFile) {
  return fileOperation(async () => {
    if(extensionDraftDirty||characterDefinitionDraftDirty||textImportDraftDirty||characterPerformanceDraftDirty||scenePerformanceDraftDirty)throw Error('还有未应用的部件、配音、角色模板、文本预览或场景演出修改，请先应用/创建或放弃后再保存；文字溢出警告不阻止保存。');
    const captured = capture();
    let target = currentFile;
    const needsUpgradeCopy = openedSchemaVersion !== session.project.schemaVersion;
    if (chooseFile || !target || needsUpgradeCopy) {
      const selected = await dialog.showSaveDialog(win, {
        title: needsUpgradeCopy ? `工程格式变为版本${session.project.schemaVersion}，请另存副本（不要覆盖不同版本工程）` : '保存可移植工程',
        defaultPath: needsUpgradeCopy && currentFile ? currentFile.replace(/\.json$/i,'')+`.v${session.project.schemaVersion}.json` : currentFile || 'untitled.replay.json',
        filters: [{name: 'Replay 工程', extensions: ['json']}]
      });
      assertUnchanged(captured);
      if (selected.canceled || !selected.filePath) return null;
      target = selected.filePath;
    }
    assertUnchanged(captured);
    if (needsUpgradeCopy && currentFile && path.resolve(target).toLowerCase() === path.resolve(currentFile).toLowerCase()) throw Error(`版本${session.project.schemaVersion}必须另存副本，不能覆盖原版本${openedSchemaVersion}工程`);
    const saved = await saveSessionPortable(captured.session, captured.root, target);
    assertUnchanged(captured);
    captured.session.project = saved.project;
    captured.session.history = saved.history;
    captured.session.future = saved.future;
    captured.session.savedRevision = captured.session.revision;
    if (projectRoot !== saved.root) { resetVideoFrames(); resetExternalDropState(); }
    projectRoot = saved.root;
    currentFile = saved.file; openedSchemaVersion = saved.project.schemaVersion;
    if (!hasRecoverableChanges()) clearRecovery();
    send();
    return saved.file;
  });
}

app.whenReady().then(async () => {
  session = new ProjectSession(JSON.parse(fs.readFileSync(exampleFile, 'utf8').replace(/^\uFEFF/, '')));
  openedSchemaVersion = session.project.schemaVersion;
  const windowStateFile = screen && typeof app.getPath === 'function' ? path.join(app.getPath('userData'), 'editor-window-state.json') : null;
  const {maximized: restoreMaximized, ...windowBounds} = windowStateFile
    ? getWindowOptions({displays:screen.getAllDisplays(),primaryDisplay:screen.getPrimaryDisplay(),saved:loadWindowState(windowStateFile)})
    : {width:1280,height:800,maximized:false};
  win = new BrowserWindow({
    ...windowBounds, show: true,
    webPreferences: {preload: path.join(__dirname, 'renderer/preload.cjs'), contextIsolation: true, nodeIntegration: false}
  });
  if (restoreMaximized) win.maximize();
  if (windowStateFile) trackWindowState(win, windowStateFile).save();
  if (Menu && typeof win.webContents.on === 'function') installEditorContextMenu(win, Menu);
  if (Menu?.setApplicationMenu) {
    const command = id => () => { if (!win.isDestroyed()) win.webContents.send('file-command', id); };
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {label:'文件(&F)',submenu:[
        {id:'file-open',label:'打开工程…',accelerator:'CmdOrCtrl+O',click:command('open')},
        {id:'file-save',label:'保存工程',accelerator:'CmdOrCtrl+S',click:command('save')},
        {id:'file-save-as',label:'另存为…',accelerator:'CmdOrCtrl+Shift+S',click:command('save-as')},
        {type:'separator'},
        {id:'file-export',label:'导出 MP4…',click:command('export')},
        {id:'file-export-cancel',label:'取消导出',click:command('export-cancel')},
        {type:'separator'},{label:'退出',click:()=>win.close()}
      ]},
      {label:'编辑(&E)',submenu:[{role:'undo',label:'撤销文本编辑'},{role:'redo',label:'重做文本编辑'},{type:'separator'},{role:'cut',label:'剪切'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]},
      {label:'视图(&V)',submenu:[{role:'togglefullscreen',label:'全屏'},{role:'toggleDevTools',label:'开发者工具'}]}
    ]));
  }
  win.on('close', event => {
    if (allowClose) return;
    // Keep the supervising editor alive until the dedicated export tree settles.
    // User can cancel via the export control, then close normally.
    if (busy || exporting) { event.preventDefault(); return; }
    event.preventDefault();
    fileOperation(async () => {
      const captured = capture();
      if (!await confirmDiscard(captured)) return;
      assertUnchanged(captured);
      clearRecovery();
      videoClosing = true;
      await resetVideoFrames();
      await Promise.all([...videoDisposals]);
      allowClose = true;
      win.close();
    }).catch(error => dialog.showErrorBox('无法关闭工程', error.message));
  });
  busy = true;
  try {
    if (recovery.inspect()) {
      const answer = await dialog.showMessageBox(win, {type:'question', title:'恢复未保存工程', message:'发现上次未保存的工程与代码草稿。', buttons:['恢复', '放弃恢复'], defaultId:0, cancelId:0, noLink:true});
      if (answer.response === 1) clearRecovery();
      else {
        const loaded = recovery.open();
        resetVideoFrames();
        session = new ProjectSession(loaded.project);
        openedSchemaVersion = session.project.schemaVersion;
        resetExternalDropState(); expressionCommands.reset(); mediaCommands.reset(); voiceClipCommands.reset(); componentCommands.reset(); textCommands.reset(); characterLibraryCommands.reset(); characterClipCommands.reset(); performanceCommands.reset(); scenePerformanceCommands.reset(); timelineClipboard.reset(); timelineDeleteCommands.reset(); characterRowCommands.reset();
        session.revision = loaded.revision; session.savedRevision = -1;
        projectRoot = loaded.root; currentFile = null; documentId++;
        scenePerformanceDraftDirty = false;
        codeDraft = loaded.draft;
        if (codeDraft?.dirty) codeDraft.stale = true;
        recoverySavedAt = loaded.timestamp;
      }
    }
  } catch (error) {
    recoveryError = error.message;
    recoveryBlocked = true;
    dialog.showErrorBox('无法读取恢复记录', '恢复记录已保留：' + error.message);
  } finally { busy = false; }
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
  win.webContents.once('did-finish-load', send);
});

ipcMain.handle('open-project', () => fileOperation(async () => {
  const captured = capture();
  if (!await confirmDiscard(captured)) return {cancelled: true, file: null};
  const selected = await dialog.showOpenDialog(win, {
    title: '打开 Replay 工程', properties: ['openFile'],
    filters: [{name: 'Replay 工程', extensions: ['json']}]
  });
  assertUnchanged(captured);
  if (selected.canceled || !selected.filePaths?.length) return {cancelled: true, file: null};
  const loaded = await openPortable(selected.filePaths[0]);
  assertUnchanged(captured);
  clearRecovery();
  installProject(loaded, loaded.revision);
  return {cancelled: false, file: loaded.file};
}));
ipcMain.handle('save', () => saveProject(false));
ipcMain.handle('save-as', async () => {
  const file = await saveProject(true);
  return {cancelled: file === null, file};
});

const expressionCommands = require('./core/expression-command.cjs').createExpressionCommands({
  getContext: () => ({session, documentId, win, busy, expressionDraftDirty, dialoguePageDraftDirty: dialoguePageDraftDirty || mediaDraftDirty || extensionDraftDirty || characterDefinitionDraftDirty || textImportDraftDirty || characterPerformanceDraftDirty || scenePerformanceDraftDirty}),
  publish: send
});
ipcMain.handle('drop-expression', (event, payload) => expressionCommands.dropExpression(event, payload));
ipcMain.handle('edit-expression-event-checked', (event, payload) => expressionCommands.editExpressionEventChecked(event, payload));
ipcMain.handle('delete-expression-event-checked', (event, payload) => expressionCommands.deleteExpressionEventChecked(event, payload));

const mediaCommands = require('./core/media-command.cjs').createMediaCommands({
  getContext: () => ({session, documentId, projectRoot, win, busy, expressionDraftDirty, dialoguePageDraftDirty:dialoguePageDraftDirty||extensionDraftDirty||characterDefinitionDraftDirty||textImportDraftDirty||characterPerformanceDraftDirty||scenePerformanceDraftDirty, mediaDraftDirty}),
  publish: send,
  decodeImage: bytes => { const image = nativeImage.createFromBuffer(bytes); return image.isEmpty() ? null : image.getSize(); }
});
ipcMain.handle('drop-audio-resource', (event, payload) => mediaCommands.dropAudioResource(event, payload));
ipcMain.handle('drop-background-resource', (event, payload) => mediaCommands.dropBackgroundResource(event, payload));
ipcMain.handle('edit-background-event-checked', (event, payload) => mediaCommands.editBackgroundEventChecked(event, payload));
ipcMain.handle('delete-background-event-checked', (event, payload) => mediaCommands.deleteBackgroundEventChecked(event, payload));
ipcMain.handle('update-media-draft-status', (event, payload) => {
  if (!win || win.isDestroyed() || !win.webContents?.mainFrame || event?.sender !== win.webContents || event?.senderFrame !== win.webContents.mainFrame) throw Error('仅允许主窗口mainFrame更新媒体草稿');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Reflect.ownKeys(payload).length !== 2 || ['dirty', 'documentId'].some(key => !Object.hasOwn(payload, key) || !Object.getOwnPropertyDescriptor(payload, key)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(payload, key), 'value')) || typeof payload.dirty !== 'boolean' || !Number.isSafeInteger(payload.documentId) || payload.documentId < 0) throw Error('媒体草稿状态无效');
  if (payload.documentId !== documentId) throw Error('媒体草稿属于旧工程');
  if (mediaDraftDirty !== payload.dirty) draftVersion++;
  mediaDraftDirty = payload.dirty;
  return {documentId, mediaDraftDirty};
});

const {upgradeProject} = require('./core/schema-migration.cjs');
const extensionContext = () => ({session,documentId,projectRoot,win,busy,expressionDraftDirty,dialoguePageDraftDirty:dialoguePageDraftDirty||characterDefinitionDraftDirty||textImportDraftDirty||characterPerformanceDraftDirty||scenePerformanceDraftDirty,mediaDraftDirty,voiceClipDraftDirty,componentDraftDirty});
const s3Context=()=>({session,documentId,projectRoot,win,busy:busy||exporting,codeDraft,expressionDraftDirty,dialoguePageDraftDirty,mediaDraftDirty,extensionDraftDirty,voiceClipDraftDirty,componentDraftDirty,characterDefinitionDraftDirty,textImportDraftDirty,characterPerformanceDraftDirty,scenePerformanceDraftDirty});
// Older controllers enumerate known owners; expose this foreign draft through a
// field they already gate, while keeping the canonical S3 context owner-specific.
const legacyS3Context=()=>({...s3Context(),dialoguePageDraftDirty:dialoguePageDraftDirty||scenePerformanceDraftDirty});
const externalDropCommands=require('./core/external-drop-command.cjs').createExternalDropCommands({
 getContext:()=>({...s3Context(),root:projectRoot,exporting,draftVersion}),publish:send,
 decodeImage(bytes){const image=nativeImage.createFromBuffer(bytes);return image.isEmpty()?null:image.getSize();},
 ffmpegPath:path.resolve(__dirname,'../p0/tools/ffmpeg.exe'),ffprobePath:path.resolve(__dirname,'../p0/tools/ffprobe.exe')
});
function resetExternalDropState(){
 try{Promise.resolve(externalDropCommands.reset()).catch(()=>console.warn('External drop cleanup deferred; inspect owned staging diagnostics.'));}
 catch{console.warn('External drop reset failed; pending authorization will be rejected by document guards.');}
}
// Registration is internal to the isolated preload's trusted native File handler.
// No public renderer bridge exposes registration or path extraction.
ipcMain.handle('external-drop-register',(event,payload)=>externalDropCommands.register(event,payload));
ipcMain.handle('external-drop-prepare',(event,payload)=>externalDropCommands.prepare(event,payload));
ipcMain.handle('external-drop-commit',(event,payload)=>externalDropCommands.commit(event,payload));
ipcMain.handle('external-drop-cancel',(event,payload)=>externalDropCommands.cancel(event,payload));
const scenePerformanceCommands=require('./core/scene-performance-command.cjs').createScenePerformanceCommands({getContext:s3Context,publish:send});
ipcMain.handle('update-scene-performance',(event,payload)=>scenePerformanceCommands.updateScenePerformance(event,payload));
ipcMain.handle('update-scene-performance-draft-status',(event,payload)=>{
  if(!win||win.isDestroyed()||!win.webContents?.mainFrame||win.webContents.isDestroyed?.()||event?.sender!==win.webContents||event?.senderFrame!==win.webContents.mainFrame)throw Error('仅主窗口mainFrame可更新场景演出草稿');
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Reflect.ownKeys(payload).length!==2||['documentId','dirty'].some(key=>{const d=Object.getOwnPropertyDescriptor(payload,key);return !d||!d.enumerable||!Object.hasOwn(d,'value');})||!Number.isSafeInteger(payload.documentId)||payload.documentId<0||typeof payload.dirty!=='boolean')throw Error('场景演出草稿字段无效');
  if(payload.documentId!==documentId)throw Error('场景演出草稿属于旧工程');
  if(scenePerformanceDraftDirty!==payload.dirty)draftVersion++;
  scenePerformanceDraftDirty=payload.dirty;
  return {documentId,scenePerformanceDraftDirty};
});
const performanceCommands=require('./core/character-performance-command.cjs').createCharacterPerformanceCommands({getContext:s3Context,publish:send});
const timelineClipboard=require('./core/timeline-clipboard.cjs').createTimelineClipboard({getContext:s3Context,publish:send});
const timelineDeleteCommands=require('./core/timeline-delete-command.cjs').createTimelineDeleteCommands({getContext:s3Context,publish:send});
const characterRowCommands=require('./core/character-row-command.cjs').createCharacterRowCommands({getContext:s3Context,publish:send});
for(const [channel,method]of [['move-character-to-row','moveCharacterToRow'],['shift-character-row','shiftCharacterRow']])ipcMain.handle(channel,(event,payload)=>characterRowCommands[method](event,payload));
for(const [channel,method]of [['upsert-character-performance','upsertCharacterPerformance'],['delete-character-performance','deleteCharacterPerformance']])ipcMain.handle(channel,(event,payload)=>performanceCommands[method](event,payload));
ipcMain.handle('capture-timeline-item',(event,payload)=>timelineClipboard.captureTimelineItem(event,payload));
ipcMain.handle('paste-timeline-item',(event,payload)=>timelineClipboard.pasteTimelineItem(event,payload));
ipcMain.handle('delete-timeline-item',(event,payload)=>timelineDeleteCommands.deleteTimelineItem(event,payload));
ipcMain.handle('update-performance-draft-status',(event,payload)=>{if(event?.sender!==win?.webContents||event?.senderFrame!==win?.webContents?.mainFrame)throw Error('仅主窗口可更新草稿');if(!payload||Object.keys(payload).length!==2||payload.documentId!==documentId||typeof payload.dirty!=='boolean')throw Error('角色事件草稿文档或字段无效');if(characterPerformanceDraftDirty!==payload.dirty)draftVersion++;characterPerformanceDraftDirty=payload.dirty;return {documentId,characterPerformanceDraftDirty};});
let readingSettingsStore;
function getReadingSettingsStore(){if(!readingSettingsStore)readingSettingsStore=require(path.join(__dirname,'core/reading-settings.cjs')).createReadingSettingsStore({file:typeof app.getPath==='function'?path.join(app.getPath('userData'),'reading-settings.json'):undefined});return readingSettingsStore;}
function readingSettingsSender(event){if(!win||win.isDestroyed?.()||!win.webContents?.mainFrame||win.webContents.isDestroyed?.()||event?.sender!==win.webContents||event?.senderFrame!==win.webContents.mainFrame)throw Error('仅主窗口可访问阅读设置');}
ipcMain.handle('get-reading-settings',(event)=>{readingSettingsSender(event);return getReadingSettingsStore().snapshot();});
ipcMain.handle('set-reading-settings',(event,payload)=>{readingSettingsSender(event);if(busy||exporting)throw Error('当前操作忙，请稍后重试');const result=getReadingSettingsStore().update(payload);scriptPreflightSession.invalidateReadingSettings();return result;});
const scriptPreflightSession=require('./core/script-preflight-session.cjs').createScriptPreflightSession({
 getReadingSettings:()=>getReadingSettingsStore().snapshot(),
 getContext:()=>({session,documentId,revision:session?.revision,win,busy:busy||exporting}),
 pickOutput:()=>dialog.showOpenDialog(win,{title:'选择生成工程保存位置（新建独立目录，不替换当前工程）',properties:['openDirectory']}),
 previewPortable:options=>require('./core/script-generation-storage.cjs').previewPortableScript({...options,decodeImage:bytes=>{const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw Error('图片无法解码');return image.getSize();}}),
 generatePortable:options=>require('./core/script-generation-storage.cjs').generatePortableScript({...options,decodeImage:bytes=>{const image=nativeImage.createFromBuffer(bytes);if(image.isEmpty())throw Error('图片无法解码');return image.getSize();}}),
 pick:async kind=>{const options=kind==='assets'?{title:'选择剧本素材根目录',properties:['openDirectory']}:{title:kind==='script'?'选择UTF-8剧本 TXT / MD':kind==='returnMap'?'选择配套 script.replay-map.json':'选择剧本素材配置 JSON',properties:['openFile'],filters:[{name:kind==='script'?'剧本':'素材配置',extensions:kind==='script'?['txt','md']:['json']}]};return dialog.showOpenDialog(win,options);}
});
for(const [channel,method] of [['script-preflight-preview','preview'],['generate-script-project','generate'],['pick-script-preflight','choose'],['run-script-preflight','run'],['correct-script-preflight','correct'],['reset-script-preflight','reset'],['get-script-preflight','getState']])ipcMain.handle(channel,(event,payload)=>scriptPreflightSession[method](event,payload));
ipcMain.handle('export-script-return-package',async(event,payload)=>{
 readingSettingsSender(event);
 if(!payload||Object.keys(payload).length!==2||!Object.hasOwn(payload,'documentId')||!Object.hasOwn(payload,'expectedRevision')||payload.documentId!==documentId||payload.expectedRevision!==session?.revision)throw Error('文档或修订已变化，请重试');
 if(busy||exporting)throw Error('当前操作忙');
 const checkDrafts=()=>{if(codeDraft?.dirty||expressionDraftDirty||dialoguePageDraftDirty||mediaDraftDirty||extensionDraftDirty||voiceClipDraftDirty||componentDraftDirty||characterDefinitionDraftDirty||textImportDraftDirty||characterPerformanceDraftDirty||scenePerformanceDraftDirty)throw Error('请先应用或放弃未提交草稿，再导出剧本');};
 checkDrafts();
 return fileOperation(async()=>{
  const captured=capture(),project=session.snapshot();
  const verify=()=>{readingSettingsSender(event);assertUnchanged(captured);checkDrafts();if(payload.documentId!==documentId||payload.expectedRevision!==session.revision)throw Error('文档已变化');};
  const api=require('./core/script-return-package.cjs'),prepared=await api.prepareReturnPackageVerified({project,projectRoot:captured.root,check:verify});
   verify();
  if(!prepared.source)throw Error('当前编辑无法形成有效回接包：'+prepared.losses.map(l=>l.message).join('；'));
  const answer=await dialog.showMessageBox(win,{type:prepared.losses.length?'warning':'info',title:'导出剧本回接包（新目录）',message:prepared.losses.length?'以下编辑不能由剧本文本重现，继续导出？':'导出已支持剧本子集及配套来源记录？',detail:(prepared.losses.map(l=>l.message+' ['+l.path+']').join('\n')||'将保存全文、批注、素材原名和配音绑定。')+'\n纯文本和回接包均不是完整工程备份；请保留已保存工程。',buttons:['取消','导出新版本'],defaultId:0,cancelId:0,noLink:true});verify();
  if(answer.response!==1)return {ok:true,cancelled:true};
  const picked=await dialog.showOpenDialog(win,{title:'选择回接包输出父目录（不覆盖原文）',properties:['openDirectory']});verify();
  if(picked.canceled||!picked.filePaths?.[0])return {ok:true,cancelled:true};
  const result=await api.exportReturnPackage({project,projectRoot,outputParent:picked.filePaths[0],check:verify});
  return {ok:true,...result};
 });
});
const textCommands=require('./core/text-command.cjs').createTextCommands({getContext:legacyS3Context,publish:send});
let dialogueReadingCommands;
ipcMain.handle('apply-dialogue-reading',(event,payload)=>{if(!dialogueReadingCommands)dialogueReadingCommands=require(path.join(__dirname,'core/dialogue-reading-command.cjs')).createDialogueReadingCommands({getContext:legacyS3Context,publish:send});return dialogueReadingCommands.applyDialogueReading(event,payload);});
const characterLibraryCommands=require('./core/character-library-command.cjs').createCharacterLibraryCommands({getContext:s3Context,publish:send});
const characterClipCommands=require('./core/character-clip-command.cjs').createCharacterClipCommands({getContext:s3Context,publish:send});
for(const [channel,method] of [['duplicate-character-clip','duplicateCharacterClip'],['delete-character-clip','deleteCharacterClip']])ipcMain.handle(channel,(event,payload)=>characterClipCommands[method](event,payload));
ipcMain.handle('create-dialogue-from-text',(event,payload)=>textCommands.createDialogueFromText(event,payload));
for(const [channel,method] of [['upgrade-character-library','upgradeCharacterLibrary'],['create-character-definition','createCharacterDefinition'],['edit-character-definition','editCharacterDefinition'],['delete-character-definition','deleteCharacterDefinition'],['instantiate-character','instantiateCharacter'],['instantiate-legacy-character','instantiateLegacyCharacter']])ipcMain.handle(channel,(event,payload)=>characterLibraryCommands[method](event,payload));
ipcMain.handle('update-s3-draft-status',(event,payload)=>{if(event?.sender!==win?.webContents||event?.senderFrame!==win?.webContents?.mainFrame)throw Error('仅主窗口可更新草稿');if(!payload||Object.keys(payload).length!==3||payload.documentId!==documentId||typeof payload.characterDefinitionDirty!=='boolean'||typeof payload.textImportDirty!=='boolean')throw Error('S3草稿文档或字段无效');const changed=characterDefinitionDraftDirty!==payload.characterDefinitionDirty||textImportDraftDirty!==payload.textImportDirty;characterDefinitionDraftDirty=payload.characterDefinitionDirty;textImportDraftDirty=payload.textImportDirty;if(changed)draftVersion++;return {documentId,characterDefinitionDraftDirty,textImportDraftDirty};});
const voiceClipCommands = require('./core/voice-clips.cjs').createVoiceClipCommands({getContext:extensionContext,publish:send});
const componentCommands = require('./core/component-command.cjs').createComponentCommands({getContext:extensionContext,publish:send,upgradeProject});
for(const [channel,method] of [['split-voice-clip','splitVoiceClip'],['edit-voice-clip','editVoiceClip'],['delete-voice-clip','deleteVoiceClip']])ipcMain.handle(channel,(event,payload)=>voiceClipCommands[method](event,payload));
for(const [channel,method] of [['add-component','addComponent'],['edit-component','editComponent'],['delete-component','deleteComponent'],['create-component','createComponent'],['edit-component-definition','editComponentDefinition'],['group-components','groupComponents'],['ungroup-components','ungroupComponents'],['transform-components','transformComponents']])ipcMain.handle(channel,(event,payload)=>componentCommands[method](event,payload));
ipcMain.handle('update-extension-draft-status',(event,payload)=>{if(event?.sender!==win?.webContents||event?.senderFrame!==win?.webContents?.mainFrame)throw Error('仅主窗口可更新草稿');if(!payload||Object.keys(payload).length!==3||payload.documentId!==documentId||typeof payload.voiceClipDirty!=='boolean'||typeof payload.componentDirty!=='boolean')throw Error('扩展草稿文档或字段无效');const changed=voiceClipDraftDirty!==payload.voiceClipDirty||componentDraftDirty!==payload.componentDirty;voiceClipDraftDirty=payload.voiceClipDirty;componentDraftDirty=payload.componentDirty;extensionDraftDirty=voiceClipDraftDirty||componentDraftDirty;if(changed)draftVersion++;return {documentId,extensionDraftDirty};});
ipcMain.handle('import-component-pack',(event)=>fileOperation(async()=>{if(event?.sender!==win?.webContents||event?.senderFrame!==win?.webContents?.mainFrame)throw Error('仅主窗口可导入部件');requireSettledForms();const captured=capture();const chosen=await dialog.showOpenDialog(win,{title:'选择部件包目录（含pack.json）',properties:['openDirectory']});assertUnchanged(captured);if(chosen.canceled||!chosen.filePaths?.length)return {cancelled:true};const result=require('./core/components.cjs').importComponentPack(session,projectRoot,chosen.filePaths[0],{upgradeProject,decodeImage:bytes=>{const image=nativeImage.createFromBuffer(bytes);return image.isEmpty()?null:image.getSize();}});send();return {cancelled:false,...result};}));

ipcMain.handle('export-component-pack',(event,payload)=>fileOperation(async()=>{
  if(event?.sender!==win?.webContents||event?.senderFrame!==win?.webContents?.mainFrame)throw Error('仅主窗口可导出部件');
  requireSettledForms();
  if(!payload||Object.keys(payload).some(k=>!['documentId','expectedRevision','instanceIds','name'].includes(k))||payload.documentId!==documentId||payload.expectedRevision!==session.revision||!Array.isArray(payload.instanceIds)||!payload.instanceIds.length||new Set(payload.instanceIds).size!==payload.instanceIds.length||payload.instanceIds.some(id=>typeof id!=='string')||typeof payload.name!=='string'||!payload.name.trim()||payload.name.length>256)throw Error('导出部件选择、名称或工程版本无效');
  const captured=capture(),chosen=await dialog.showOpenDialog(win,{title:'选择部件包导出父目录（将新建独立包目录）',properties:['openDirectory','createDirectory']});assertUnchanged(captured);if(chosen.canceled||!chosen.filePaths?.length)return {cancelled:true};
  const target=path.join(chosen.filePaths[0],'component-pack-'+Date.now()+'-'+require('crypto').randomUUID());
  const result=require('./core/component-pack-export.cjs').exportComponentPack(session.snapshot(),projectRoot,payload.instanceIds,target,{name:payload.name.trim(),decodeImage:bytes=>{const image=nativeImage.createFromBuffer(bytes);return image.isEmpty()?null:image.getSize();}});
  return {cancelled:false,directory:target,...result};
}));

function requireS3Settled(){if(characterDefinitionDraftDirty||textImportDraftDirty||characterPerformanceDraftDirty||scenePerformanceDraftDirty)throw Error('请先应用或放弃角色模板、文本预览、角色事件或场景演出');}
function requireSettledForms() {
  if (expressionDraftDirty || dialoguePageDraftDirty || mediaDraftDirty || extensionDraftDirty || characterDefinitionDraftDirty || textImportDraftDirty || characterPerformanceDraftDirty || scenePerformanceDraftDirty) throw Error('请先应用或放弃表情、对白分页、媒体或场景演出表单');
}

// Only actual form submissions may consume their own owner. Structural edits,
// deletes, drags and audio-track forms (which have no main-process owner) must
// not silently invalidate another editor's unpublished values.
const legacyMutationOwner = new Map([
  ...['set-portrait-canvas','add-expression','edit-expression','add-expression-event','edit-expression-event'].map(channel=>[channel,'expressionDraftDirty']),
  ...['edit-dialogue','edit-dialogue-page','set-dialogue-pages'].map(channel=>[channel,'dialoguePageDraftDirty']),
  ['apply-project-code','codeDraft']
]);
function requireMutationDrafts(channel) {
  const owner=legacyMutationOwner.get(channel);
  const drafts={expressionDraftDirty,dialoguePageDraftDirty,mediaDraftDirty,extensionDraftDirty,voiceClipDraftDirty,componentDraftDirty,characterDefinitionDraftDirty,textImportDraftDirty,characterPerformanceDraftDirty,scenePerformanceDraftDirty,codeDraft:!!codeDraft?.dirty||session.draft!=null};
  if(Object.entries(drafts).some(([key,dirty])=>dirty&&key!==owner))throw Error('请先应用或放弃其他表单或代码草稿，再修改对象');
}
function mutation(channel, operation) {
  ipcMain.handle(channel, (event, ...args) => {
    requireIdle();
    requireMutationDrafts(channel);
    const result = operation(event, ...args);
    send();
    return result;
  });
}

mutation('add-character', () => {
  const id = session.addCharacter();
  return {id, revision: session.revision};
});
mutation('edit-character', (_, id, patch) => {
  session.editCharacter(id, patch);
  return {revision: session.revision};
});
mutation('delete-character', (_, id) => {
  session.deleteCharacter(id);
  return {revision: session.revision};
});
mutation('set-portrait-canvas', (event, cid, canvas) => voiceSession(event).setPortraitCanvas(cid, canvas));
mutation('add-expression', (_, cid, p) => session.addExpression(cid,p));
mutation('edit-expression', (_, cid, eid, p) => session.editExpression(cid,eid,p));
mutation('delete-expression', (_, cid, eid) => session.deleteExpression(cid,eid));
mutation('add-expression-event', (_, cid, p) => session.addExpressionEvent(cid,p));
mutation('edit-expression-event', (_, cid, eid, p) => session.editExpressionEvent(cid,eid,p));
mutation('delete-expression-event', (_, cid, eid) => session.deleteExpressionEvent(cid,eid));
mutation('set-dialogue-speaker', (_, dialogueId, speakerId) => {
  session.setDialogueSpeaker(dialogueId, speakerId);
  return {revision: session.revision};
});

mutation('set-dialogue-pages', (event,id,pages) => voiceSession(event).setDialoguePages(id,pages));
mutation('add-dialogue-page', (event,id,options) => voiceSession(event).addDialoguePage(id,options));
mutation('edit-dialogue-page', (event,id,pageId,patch) => voiceSession(event).editDialoguePage(id,pageId,patch));
mutation('delete-dialogue-page', (event,id,pageId) => voiceSession(event).deleteDialoguePage(id,pageId));
mutation('edit-timeline', (_, patch) => applyTimelineEdit(session, patch));
mutation('apply-project-code', (event, payload) => applyProjectCode(voiceSession(event), payload));
mutation('edit-dialogue', (_, id, patch) => {
  session.editDialogue(id, patch);
  return {revision: session.revision};
});
mutation('add-dialogue', () => {
  const id = session.addDialogue();
  return {id, revision: session.revision};
});
mutation('delete-dialogue', (_, id) => {
  session.deleteDialogue(id);
  return {revision: session.revision};
});
mutation('move-dialogue', (_, id, direction) => {
  const moved = session.moveDialogue(id, direction);
  return {moved, revision: session.revision};
});

function voiceSession(event) {
  if (!win || win.isDestroyed() || event.sender !== win.webContents || !session) throw Error('语音操作窗口或工程无效');
  if (event.senderFrame && event.senderFrame !== win.webContents.mainFrame) throw Error('语音操作仅允许主窗口');
  return session;
}

ipcMain.handle('import-voice', (event, id) => fileOperation(async () => {
  requireS3Settled();
  const current = voiceSession(event);
  if (typeof id !== 'string' || !current.snapshot().scene.dialogues.some(d => d.id === id)) throw Error('对白不存在');
  const captured = capture();
  const selected = await dialog.showOpenDialog(win, {
    title: '导入对白语音（48 kHz PCM16 WAV）', properties: ['openFile'],
    filters: [{name: 'WAV 音频', extensions: ['wav']}]
  });
  assertUnchanged(captured);
  if (voiceSession(event) !== current) throw Error('选择文件期间工程已切换');
  if (selected.canceled || !selected.filePaths?.length) return {cancelled: true};
  const count=current.project.scene.dialogues.find(d=>d.id===id)?.voiceClips?.length||0;
  if(count){const answer=await dialog.showMessageBox(win,{type:'warning',title:'替换全部配音片段',message:`这段对白已有 ${count} 个配音片段。导入将替换全部片段，原裁剪与位置不保留。`,buttons:['取消','替换全部'],defaultId:0,cancelId:0,noLink:true});assertUnchanged(captured);if(answer.response!==1)return {cancelled:true};}
  const result = importVoice(current, id, selected.filePaths[0], captured.root);
  send();
  return {revision: result.revision};
}));
mutation('unbind-voice', (event, id) => unbindVoice(voiceSession(event), id));
mutation('set-dialogue-voice-binding', (event, id, options) => setDialogueVoiceBinding(voiceSession(event), id, options));
mutation('edit-dialogue-voice-timing', (event, id, patch) => editDialogueVoiceTiming(voiceSession(event), id, patch));
ipcMain.handle('import-audio-track', (event, options) => fileOperation(async () => {
  requireS3Settled();
  const current = voiceSession(event);
  validateAudioTrackOptions(options);
  const captured = capture();
  const selected = await dialog.showOpenDialog(win, {
    title: '导入独立音轨（48 kHz PCM16 WAV）', properties: ['openFile'],
    filters: [{name: 'WAV 音频', extensions: ['wav']}]
  });
  assertUnchanged(captured);
  if (voiceSession(event) !== current) throw Error('选择文件期间工程已切换');
  if (selected.canceled || !selected.filePaths?.length) return {cancelled: true};
  const result = importAudioTrack(current, selected.filePaths[0], captured.root, options);
  send(); return result;
}));
mutation('edit-audio-track', (event, id, patch) => editAudioTrack(voiceSession(event), id, patch));
mutation('split-audio-track', (event, id, at) => splitAudioTrack(voiceSession(event), id, at));
mutation('delete-audio-track', (event, id) => deleteAudioTrack(voiceSession(event), id));
ipcMain.handle('pick-dialogue-text',(event)=>fileOperation(async()=>{
 if(event?.sender!==win?.webContents||event?.senderFrame!==win?.webContents?.mainFrame)throw Error('仅主窗口可读取文本');const captured=capture();
 const chosen=await dialog.showOpenDialog(win,{title:'选择UTF-8文本，预览后创建对白',properties:['openFile'],filters:[{name:'UTF-8文本',extensions:['txt']}]});assertUnchanged(captured);if(chosen.canceled||!chosen.filePaths?.length)return {cancelled:true};
 const file=chosen.filePaths[0],stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size>256*1024||path.extname(file).toLowerCase()!=='.txt')throw Error('只支持不超过256KiB的普通UTF-8 .txt文件');const bytes=fs.readFileSync(file);if(bytes.length>256*1024)throw Error('文本过大');let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');}catch{throw Error('文本不是有效UTF-8');}if(!text.trim()||text.includes('\0'))throw Error('文本不能为空或包含NUL');assertUnchanged(captured);return {cancelled:false,text,name:path.basename(file),documentId,revision:session.revision};
}));
ipcMain.handle('import-character-library-image',event=>fileOperation(async()=>{
 if(event?.sender!==win?.webContents||event?.senderFrame!==win?.webContents?.mainFrame)throw Error('仅主窗口可导入角色图片');requireSettledForms();const captured=capture();const selected=await dialog.showOpenDialog(win,{title:'导入角色模板PNG/JPEG资源',properties:['openFile'],filters:[{name:'图片',extensions:['png','jpg','jpeg']}]});assertUnchanged(captured);if(selected.canceled||!selected.filePaths?.length)return {cancelled:true};const result=importExpressionImage(session,selected.filePaths[0],projectRoot,{decodeImage(bytes){const image=nativeImage.createFromBuffer(bytes);return image.isEmpty()?null:image.getSize();}});send();return {cancelled:false,...result};
}));
ipcMain.handle('import-component-image', (event) => fileOperation(async () => {
  if(event?.sender!==win?.webContents||event?.senderFrame!==win?.webContents?.mainFrame)throw Error('仅主窗口可导入部件图片');
  requireSettledForms();const current=voiceSession(event),captured=capture();
  const selected=await dialog.showOpenDialog(win,{title:'导入部件 PNG/JPEG 图片资源',properties:['openFile'],filters:[{name:'图片',extensions:['png','jpg','jpeg']}]});assertUnchanged(captured);
  if(selected.canceled||!selected.filePaths?.length)return {cancelled:true};
  const result=importExpressionImage(current,selected.filePaths[0],captured.root,{decodeImage(bytes){const image=nativeImage.createFromBuffer(bytes);return image.isEmpty()?null:image.getSize();}});send();return {cancelled:false,...result};
}));
ipcMain.handle('import-expression-image', (event) => fileOperation(async () => {
  requireS3Settled();
  const current = voiceSession(event), captured = capture();
  const selected = await dialog.showOpenDialog(win, {title: '导入表情 PNG/JPEG 图片', properties: ['openFile'], filters: [{name: '图片', extensions: ['png', 'jpg', 'jpeg']}]});
  assertUnchanged(captured); if (voiceSession(event) !== current) throw Error('选择文件期间工程已切换');
  if (selected.canceled || !selected.filePaths?.length) return {cancelled: true};
  const result = importExpressionImage(current, selected.filePaths[0], captured.root, {decodeImage(bytes) {
    const image = nativeImage.createFromBuffer(bytes); return image.isEmpty() ? null : image.getSize();
  }});
  send(); return result;
}));
ipcMain.handle('import-image', (event, target) => fileOperation(async () => {
  requireS3Settled();
  const current = voiceSession(event); requireImageTarget(current.snapshot(), target);
  const captured = capture();
  const selected = await dialog.showOpenDialog(win, {title: '导入 PNG/JPEG 图片', properties: ['openFile'], filters: [{name: '图片', extensions: ['png', 'jpg', 'jpeg']}]});
  assertUnchanged(captured); if (voiceSession(event) !== current) throw Error('选择文件期间工程已切换');
  if (selected.canceled || !selected.filePaths?.length) return {cancelled: true};
  const result = importImage(current, target, selected.filePaths[0], captured.root, {decodeImage(bytes) {
    const image = nativeImage.createFromBuffer(bytes); return image.isEmpty() ? null : image.getSize();
  }});
  send(); return result;
}));
mutation('unbind-image', (event, target) => unbindImage(voiceSession(event), target));
mutation('set-locale', (_, locale) => {
  session.apply(project => {
    if (!['zh-CN', 'ja-JP', 'en-US'].includes(locale)) throw Error('unsupported locale');
    project.locale = locale;
  }, 'change locale');
  return {revision: session.revision};
});
mutation('move-character', (_, id, x, y) => {
  session.apply(project => {
    const character = project.scene.characters.find(c => c.id === id);
    if (!character) throw Error('character not found');
    character.x = Number(x);
    character.y = Number(y);
  }, 'move character');
  return {revision: session.revision};
});
mutation('undo', () => { requireSettledForms(); return session.undo(); });
mutation('redo', () => { requireSettledForms(); return session.redo(); });
ipcMain.handle('evaluate', (_, frame) => session.evaluate(Number(frame)));
ipcMain.handle('project', () => bundle());
// Only an unsaved-status flag crosses IPC; unapplied portrait form data is not a recovery snapshot.
ipcMain.handle('update-expression-draft-status', (event, payload) => {
  voiceSession(event);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(k => !['dirty','documentId'].includes(k)) || typeof payload.dirty !== 'boolean' || !Number.isSafeInteger(payload.documentId)) throw Error('表情草稿状态无效');
  if (payload.documentId !== documentId) throw Error('表情草稿属于旧工程');
  if (expressionDraftDirty !== payload.dirty) draftVersion++;
  expressionDraftDirty = payload.dirty;
  return {documentId, expressionDraftDirty};
});
ipcMain.handle('update-dialogue-page-draft-status', (event, payload) => {
  voiceSession(event);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(k => !['dirty','documentId'].includes(k)) || typeof payload.dirty !== 'boolean' || !Number.isSafeInteger(payload.documentId)) throw Error('对白分页草稿状态无效');
  if (payload.documentId !== documentId) throw Error('对白分页草稿属于旧工程');
  if (dialoguePageDraftDirty !== payload.dirty) draftVersion++;
  dialoguePageDraftDirty = payload.dirty;
  return {documentId, dialoguePageDraftDirty};
});
ipcMain.handle('update-code-draft', (event, payload) => {
  voiceSession(event);
  codeDraft = normalizeDraft(payload);
  draftVersion++;
  scheduleRecovery();
  publishRecoveryStatus();
  return recoveryStatus();
});
ipcMain.handle('get-recovery-draft', event => { voiceSession(event); return codeDraft; });

/* Legacy PNG export handlers disabled: retained below for source-history review only.
ipcMain.handle('cancel-export', event => {
  voiceSession(event);
  if (!exporting || !activeExport) return {cancelled:false};
  const job = activeExport;
  if (job.cancelled) return {cancelled:true};
  fs.writeFileSync(job.cancelFile, 'cancel');
  job.cancelled = true;
  // Cooperative worker normally settles within one frame/encoder polling tick.
  // Fallback targets ONLY the still-active dedicated export process and its tree.
  job.cancelTimer = setTimeout(() => {
    if (activeExport !== job || job.settled) return;
    if (process.platform === 'win32') {
      const killer = require('child_process').spawn('taskkill.exe', ['/PID', String(job.child.pid), '/T', '/F'], {stdio:'ignore', windowsHide:true});
      killer.once('error', error => console.error('Export tree cancellation failed:', error));
    } else job.child.kill('SIGTERM');
  }, 5000);
  job.cancelTimer.unref?.();
  return {cancelled:true};
});
ipcMain.handle('export-current', async event => {
  voiceSession(event);
  requireIdle();
  if(characterDefinitionDraftDirty||textImportDraftDirty||characterPerformanceDraftDirty||scenePerformanceDraftDirty)throw Error('请先应用或放弃角色模板、文本预览、角色事件或场景演出，再导出');
  if (exporting) throw Error('已有导出任务运行');
  require('./core/export-dependencies.cjs').checkExportDependencies({appRoot:__dirname});
  exporting = true;
  const snapshot = {project: session.snapshot(), revision: session.revision};
  const exportRoot = projectRoot;
  const directory = path.join(__dirname, 'runtime-output', 'job-' + require('crypto').randomUUID());
  try {
    fs.mkdirSync(directory, {recursive: true});
    const input = path.join(directory, 'input.json');
    fs.writeFileSync(input, JSON.stringify(snapshot));
    const log = fs.openSync(path.join(directory, 'job.log'), 'w');
    try {
      await new Promise((resolve, reject) => {
        const cancelFile = path.join(directory, 'cancel.request');
        const env = {...process.env, REPLAY_EXPORT_INPUT: input, REPLAY_EXPORT_OUTPUT: directory, REPLAY_PROJECT_ROOT: exportRoot, REPLAY_EXPORT_CANCEL: cancelFile};
        delete env.ELECTRON_RUN_AS_NODE;
        const child = require('child_process').spawn(process.execPath, [path.join(__dirname, 'export-main.cjs')], {
          env, stdio: ['ignore', log, log]
        });
        const job = activeExport = {child, cancelFile, cancelled:false, settled:false};
        let spawnError;
        child.once('error', error => { spawnError = error; });
        // close, unlike exit, also waits for process stdio to finish.
        child.once('close', code => {
          job.settled = true;
          if (job.cancelTimer) clearTimeout(job.cancelTimer);
          if (job.cancelled) {
            // Only this unique job's partial movie is removed; keep diagnostic logs.
            try { fs.rmSync(path.join(directory, 'p1-preview.mp4'), {force:true}); } catch (error) { console.error(error); }
            reject(Error('导出已取消'));
          } else if (spawnError) {
             try { fs.rmSync(path.join(directory, 'p1-preview.mp4'), {force:true}); } catch (error) { console.error(error); }
             reject(spawnError);
           }
          else if (code === 0 && fs.existsSync(path.join(directory, 'p1-preview.mp4'))) resolve();
          else {
             try { fs.rmSync(path.join(directory, 'p1-preview.mp4'), {force:true}); } catch (error) { console.error(error); }
             reject(Error('导出失败，请检查 ' + directory));
           }
        });
      });
    } finally { fs.closeSync(log); }
    return path.join(directory, 'p1-preview.mp4');
  } finally { activeExport = null; exporting = false; }
});

*/
let exportV2Controller;
function getExportV2Controller() {
  if(exportV2Controller)return exportV2Controller;
  const base=path.resolve(__dirname,'../export-v2');
  const policy=require(path.join(base,'core/job-policy.cjs'));
  const worker=require(path.join(base,'worker.cjs'));
  exportV2Controller=require('./core/export-v2-controller.cjs').createController({
    authorize:voiceSession, requireIdle, capture, assertUnchanged,
    guardDrafts(){if(characterDefinitionDraftDirty||textImportDraftDirty||characterPerformanceDraftDirty||scenePerformanceDraftDirty)throw Error('请先应用或放弃角色模板、文本预览、角色事件或场景演出，再导出');},
    snapshot:()=>session.snapshot(),setBusy(value,job){exporting=value;activeExport=job;},
    managedRoot:()=>path.join(app.getPath('userData'),'export-jobs'),ordinary:worker.ordinary,
    publicName:policy.publicName,validateTarget:policy.validateTarget,
    chooseTarget:defaultPath=>dialog.showSaveDialog(win,{title:'导出 MP4（请选择新文件名，不覆盖已有成片）',defaultPath,filters:[{name:'MP4 视频',extensions:['mp4']}]}),
    confirmResume:async()=> (await dialog.showMessageBox(win,{type:'question',buttons:['继续原快照导出','取消'],defaultId:0,cancelId:1,message:'继续上次未完成的导出？',detail:'恢复的是上次导出的工程快照，不是当前编辑内容。已完成的成片不会覆盖；合成失败后的任务若不能恢复，会保留诊断并提示错误。'})).response===0,
    checkDependencies(){require('./core/export-dependencies.cjs').checkExportDependencies({appRoot:__dirname});worker.ordinary(path.resolve(__dirname,'../p0/tools/ffprobe.exe'));},
    spec:()=>({runtimeRoot:__dirname,electron:process.execPath,ffmpeg:path.resolve(__dirname,'../p0/tools/ffmpeg.exe'),ffprobe:path.resolve(__dirname,'../p0/tools/ffprobe.exe')}),
    coordinator:require(path.join(base,'coordinator.cjs')),finalize:require(path.join(base,'finalize.cjs')).finalize,
    resumeFinalization:options=>require(path.join(base,'finalize.cjs')).resumeFinalization(options),
    cleanupCompleted:root=>require(path.join(base,'cleanup.cjs')).cleanupCompleted(root),showItem:file=>shell.showItemInFolder(file)
  });return exportV2Controller;
}
ipcMain.handle('export-current',(event,payload)=>getExportV2Controller().start(event,payload));
ipcMain.handle('cancel-export',event=>getExportV2Controller().cancel(event));
ipcMain.handle('export-resume',event=>getExportV2Controller().resume(event));
ipcMain.handle('export-open-folder',event=>getExportV2Controller().openFolder(event));

let videoQuitReady = false, videoQuitPending = null;
app.on('before-quit', event => {
  // app.quit() must use the same busy/export and discard guards as window.close().
  // A cancelled close must leave preview reads and the current provider intact.
  if (win && !win.isDestroyed() && !allowClose) {
    event.preventDefault();
    win.close();
    return;
  }
  if (videoQuitReady) return;
  event.preventDefault();
  if (videoQuitPending) return;
  videoClosing = true;
  videoQuitPending = resetVideoFrames().then(() => Promise.all([...videoDisposals])).finally(() => { videoQuitReady=true; app.quit(); });
});
app.on('window-all-closed', () => app.quit());
