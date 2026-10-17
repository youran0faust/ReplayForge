'use strict';
// Ephemeral main-process session: no project writes, dirty flag, or persistence.
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID, createHash} = require('node:crypto');
const readers = require('./script-asset-catalog.cjs');
const core = require('./script-preflight.cjs');
const {validatePaginationPlan} = require('./script-pagination-plan.cjs');
const {mergeConfig}=require('./reading-settings.cjs');
const {isDeepStrictEqual} = require('node:util');
const clone = value => structuredClone(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const messages = {
 INVALID_PAYLOAD: '请求字段无效。', INVALID_SENDER: '仅允许当前窗口主框架请求。',
 STALE_CONTEXT: '文档或修订已变化，请重新获取预检状态。', BUSY: '当前操作忙，请稍后重试。',
 STALE_TOKEN: '预检令牌已过期，请重新获取状态。', SELECTION_REQUIRED: '请先选择剧本、素材目录和配置。',
 REPORT_REQUIRED: '请先运行预检。', INVALID_CORRECTION: '校正节点或配音资源无效。',
 PREVIEW_REQUIRED: '请先预览生成摘要，再确认生成。', PREVIEW_CHANGED: '生成预览已变化，请重新预览并确认。',
 DISK_CHANGED: '磁盘内容已变化，请重新运行预检。', IO_FAILED: '读取或预检失败，请检查所选文件后重试。'
};
const reject = code => { throw Object.assign(new Error(messages[code]), {code, publicError: true}); };
function createScriptPreflightSession({getContext, pick, readUtf8 = readers.readUtf8,
 readConfig = readers.readConfig, scanAssets = readers.scanAssets, preflight = core.preflight, previewPortable, generatePortable, pickOutput, getReadingSettings} = {}) {
 if (typeof getContext !== 'function' || typeof pick !== 'function') throw new TypeError('getContext and pick are required');
 let identity, state, pending = false;
 const empty = () => ({paths: {script: null, assets: null, config: null, returnMap: null}, token: randomUUID(), report: null, preview: null, snapshot: null, overrides: {}});
 const same = (a, b) => a && b && ['session', 'documentId', 'win', 'contents', 'frame'].every(k => a[k] === b[k]);
 function context() {
  const c = getContext() || {};
  const now = {session: c.session, documentId: c.documentId, revision: c.revision, win: c.win,
   contents: c.win?.webContents, frame: c.win?.webContents?.mainFrame};
  if (!same(identity, now)) { state = empty(); }
  else if (identity.revision !== now.revision) { state = {...state, report: null, preview: null}; }
  identity = now;
  return {...now, busy: c.busy};
 }
 function guard(event, payload, allowed, required, needsToken, origin) {
  const c = context();
  if (!c.session || !c.win || c.win.isDestroyed?.() || !c.contents || c.contents.isDestroyed?.() ||
   !c.frame || !event || event.sender !== c.contents || event.senderFrame !== c.frame) reject('INVALID_SENDER');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
   ![Object.prototype, null].includes(Object.getPrototypeOf(payload)) ||
   Reflect.ownKeys(payload).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(payload, k)) ||
   !Number.isSafeInteger(payload.documentId) || payload.documentId < 0 ||
   !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) reject('INVALID_PAYLOAD');
  if ((origin && (!same(c, origin) || c.revision !== origin.revision)) || payload.documentId !== c.documentId || payload.expectedRevision !== c.revision) reject('STALE_CONTEXT');
  if (c.busy) reject('BUSY');
  if ((needsToken || Object.hasOwn(payload, 'token')) && (typeof payload.token !== 'string' || payload.token !== state.token)) reject('STALE_TOKEN');
  return c;
 }
 function view(c) {
  return {ok: true, documentId: c.documentId, token: state.token,
   selection: Object.fromEntries(Object.entries(state.paths).map(([k, v]) => [k, v ? path.basename(v) : null])), report: clone(state.report), generationPreview: state.preview ? clone(state.preview.summary) : null};
 }
 // Include unsupported directory entries and same-size rewrites; never follow links.
 async function treeStamp(root) {
  const entries = []; let count = 0;
  async function walk(file, depth) {
   if (++count > 20000 || depth > 16) throw new Error('Snapshot limit');
   const s = await fs.lstat(file, {bigint: true});
   entries.push([path.relative(root, file), String(s.mode), String(s.size), String(s.mtimeNs), String(s.ctimeNs), String(s.ino)]);
   if (s.isDirectory() && !s.isSymbolicLink()) for (const name of (await fs.readdir(file)).sort()) await walk(path.join(file, name), depth + 1);
  }
  await walk(root, 0); return digest(JSON.stringify(entries));
 }
 async function disk(paths) {
  if (['script','assets','config'].some(k => !paths[k])) reject('SELECTION_REQUIRED');
  const returnMap=paths.returnMap?require('./script-return-package.cjs').readReturnMap(paths.returnMap):null;
  const before = await treeStamp(paths.assets);
  const textRead = await readUtf8(paths.script);
  const text = typeof textRead === 'string' ? textRead : textRead.text;
  const rawConfig = await fs.readFile(paths.config);
  const readingSettings=typeof getReadingSettings==='function'?clone(getReadingSettings()):null;
   const rawParsedConfig=clone(await readConfig(paths.config));
   if(returnMap){
    const readingKeys=new Set([...require('./performance-config.cjs').KEYS,'unvoicedDurationSeconds','dialoguePageMaxCharacters','dialoguePageHoldSeconds','unvoicedTimingMode','unvoicedMinimumSeconds','unvoicedReadingSpeed','dialogueRevealCharactersPerSecond']);
    const semantics=c=>Object.fromEntries(Object.entries(c).filter(([k])=>!readingKeys.has(k)));
    if(!require('node:util').isDeepStrictEqual(semantics(rawParsedConfig),semantics(returnMap.source.config)))throw Object.assign(new Error('回接配置的角色、素材映射或布局与来源不一致；请使用配套config.json。'),{publicError:true,code:'RETURN_CONFIG_MISMATCH'});
   }
   const config = mergeConfig(rawParsedConfig,readingSettings);
  let catalog = clone(await scanAssets(paths.assets));
  if(returnMap){
   catalog=require('./script-managed-catalog.cjs').rehydrateManagedCatalog({catalog,source:returnMap.source,assetsRoot:paths.assets});
   for(const m of returnMap.source.mediaMappings){
    const a=catalog.assets.find(a=>a.id===m.resourceId&&a.relativePath===m.relativePath&&a.category===m.category);
    if(!a&&!(returnMap.source.version===3&&m.category==='videoAudio'&&m.videoAudioNormalization))reject('DISK_CHANGED');
     if(m.videoAudioNormalization){require('./script-managed-catalog.cjs').readManagedMapping({mapping:m,source:returnMap.source,assetsRoot:paths.assets});continue;}
    const file=path.resolve(paths.assets,require('./script-audio-provenance.cjs').physicalMappingPath(m)),realRoot=await fs.realpath(paths.assets),realFile=await fs.realpath(file),rel=path.relative(realRoot,realFile),stat=await fs.lstat(file);
    if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel)||stat.isSymbolicLink()||!stat.isFile()||stat.size>256*1024*1024)reject('DISK_CHANGED');
    if(digest(await fs.readFile(file))!==m.hash)reject('DISK_CHANGED');
   }
  }
  const after = await treeStamp(paths.assets);
  if (before !== after || !rawConfig.equals(await fs.readFile(paths.config))) reject('DISK_CHANGED');
  const verifyText = await readUtf8(paths.script);
  if (text !== (typeof verifyText === 'string' ? verifyText : verifyText.text)) reject('DISK_CHANGED');
  if(readingSettings&&JSON.stringify(getReadingSettings())!==JSON.stringify(readingSettings))reject('DISK_CHANGED');
   if(returnMap&&JSON.stringify(returnMap)!==JSON.stringify(require('./script-return-package.cjs').readReturnMap(paths.returnMap)))reject('DISK_CHANGED');
   return {text, config, catalog, ...(returnMap?{reimportSource:returnMap.source,returnLosses:returnMap.losses}:{}), readingConfigSource:readingSettings?.settings.source??'config', textHash: core.textHash(text), signature: digest(JSON.stringify([text, digest(rawConfig), config, catalog, after,readingSettings,returnMap]))};
 }
 async function report(snapshot, overrides) {
  return clone(await preflight({text: snapshot.text, reimportSource:snapshot.reimportSource, returnLosses:snapshot.returnLosses, config: clone(snapshot.config), catalog: clone(snapshot.catalog), readingConfigSource:snapshot.readingConfigSource??'config',
   corrections: {version: 1, sourceHash: snapshot.textHash, overrides: clone(overrides)}}));
 }
 // Shared by preview and generation so preservation has identical validation rules.
 function approvedPlan(payload) {
  if(!state.report||!state.snapshot)reject('REPORT_REQUIRED');
  if(!state.report.ok)throw Object.assign(new Error('请先处理预检错误及配音异常。'),{publicError:true,code:'PREFLIGHT_ERRORS'});
  const preserve=state.snapshot.reimportSource?require('./script-reimport-preservation.cjs').analyzePreservation({text:state.snapshot.text,config:state.snapshot.config,source:state.snapshot.reimportSource,report:state.report}):null;
  if(preserve?.diagnostics.some(d=>d.severity==='error'))throw Object.assign(new Error('回接来源或预检已失效，请重新预检。'),{code:'PRESERVATION_INVALID',publicError:true});
  const config={...state.snapshot.config};if(preserve?.canPreserve)delete config.dialoguePageMaxCharacters;
  const plan=validatePaginationPlan(payload.paginationPlan,state.report,state.snapshot.text,config);
  if(preserve?.canPreserve&&!isDeepStrictEqual(plan.dialogues,preserve.preservedPages))throw Object.assign(new Error('回接分页与已保存页不一致，请重新测量。'),{code:'PAGINATION_INVALID',publicError:true});
  return plan;
 }
 function verifier(check) {
  const captured=state.snapshot.signature, paths={...state.paths};
  return async()=>{check();const current=await disk(paths);check();if(current.signature!==captured)reject('DISK_CHANGED');};
 }
 const base = ['documentId', 'expectedRevision'];
 async function execute(event, payload, extra, requiredExtra, needsToken, work) {
  let c;
  try {
   c = guard(event, payload, [...base, ...extra], [...base, ...requiredExtra], needsToken);
   if (pending) reject('BUSY');
   pending = true;
   try { return await work(c, () => guard(event, payload, [...base, ...extra], [...base, ...requiredExtra], needsToken, c)); }
   finally { pending = false; }
  } catch (e) {
   // Reader exceptions may contain absolute paths: never forward them over IPC.
   let refresh;
   if(c && e.publicError && ['DISK_CHANGED','PREVIEW_CHANGED'].includes(e.code)) {
    const current=context();
    if(same(c,current)&&c.revision===current.revision) {
     state={...state,preview:null,token:randomUUID()};
     refresh=view(current);
    }
   }
   return {ok: false, error: {code: e.publicError ? e.code : 'IO_FAILED', message: e.publicError ? e.message : messages.IO_FAILED}, ...(refresh?{state:refresh}:{})};
  }
 }
 return Object.freeze({
  invalidateReadingSettings(){if(state)state={...state,report:null,preview:null,token:randomUUID()};},
  choose(event, payload) {
   return execute(event, payload, ['kind'], ['kind'], false, async (c, check) => {
    if (!['script', 'assets', 'config', 'returnMap'].includes(payload.kind)) reject('INVALID_PAYLOAD');
    const picked = await pick(payload.kind); check();
    const selected = typeof picked === 'string' ? picked : picked?.canceled ? null : picked?.filePaths?.[0];
    if (!selected) return {...view(c), cancelled: true};
    if (typeof selected !== 'string' || !path.isAbsolute(selected) || selected.includes('\0')) reject('INVALID_PAYLOAD');
    state = {...empty(), paths: {...state.paths, [payload.kind]: selected}};
    return view(c);
   });
  },
  run(event, payload) {
   return execute(event, payload, ['token'], ['token'], true, async (c, check) => {
    state={...state,preview:null};
    const snapshot = await disk(state.paths); check();
    const overrides = state.snapshot?.textHash === snapshot.textHash ? clone(state.overrides) : {};
    const nextReport = await report(snapshot, overrides); check();
    state = {...state, snapshot, overrides, report: nextReport, preview: null, token: randomUUID()};
    return view(c);
   });
  },
  correct(event, payload) {
   return execute(event, payload, ['token', 'nodeId', 'action', 'resourceId'], ['token', 'nodeId', 'action'], true, async (c, check) => {
    if (!['unvoiced', 'bind', 'reset'].includes(payload.action) || typeof payload.nodeId !== 'string' ||
     (payload.action === 'bind' ? typeof payload.resourceId !== 'string' || !payload.resourceId : Object.hasOwn(payload, 'resourceId'))) reject('INVALID_PAYLOAD');
    if (!state.report || !state.snapshot) reject('REPORT_REQUIRED');
    if (state.report.nodes.filter(n => n.id === payload.nodeId && n.type === 'dialogue').length !== 1) reject('INVALID_CORRECTION');
    if (payload.action === 'bind' && state.report.assetCatalog.filter(a => a.id === payload.resourceId && a.category === 'voice' && a.kind === 'audio').length !== 1) reject('INVALID_CORRECTION');
    state={...state,preview:null};
    const current = await disk(state.paths); check();
    if (current.signature !== state.snapshot.signature) reject('DISK_CHANGED');
    const overrides = clone(state.overrides);
    if (payload.action === 'reset') delete overrides[payload.nodeId];
    else overrides[payload.nodeId] = payload.action === 'unvoiced' ? {status: 'unvoiced'} : {resourceId: payload.resourceId};
    const nextReport = await report(state.snapshot, overrides); check();
    if (payload.action !== 'reset') {
     const binding = nextReport.bindings.find(b => b.nodeId === payload.nodeId);
     if (!binding || binding.status !== (payload.action === 'bind' ? 'manual' : 'unvoiced')) reject('INVALID_CORRECTION');
    }
    const verified = await disk(state.paths); check();
    if (verified.signature !== state.snapshot.signature) reject('DISK_CHANGED');
    state = {...state, overrides, report: nextReport, preview: null, token: randomUUID()};
    return view(c);
   });
  },
  preview(event, payload) {
   return execute(event,payload,['token','paginationPlan'],['token'],true,async(c,check)=>{
    if(typeof previewPortable!=='function')throw Object.assign(new Error('预览入口未配置'),{publicError:true,code:'GENERATION_UNAVAILABLE'});
    const paginationPlan=approvedPlan(payload), verify=verifier(check);
    const snapshot=clone(state.snapshot), report=clone(state.report), assetsRoot=state.paths.assets;
    state={...state,preview:null};
    await verify();
    const result=await previewPortable({snapshot,report,paginationPlan:clone(paginationPlan),assetsRoot,check:verify});
    await verify();
    if(!result || !result.summary || typeof result.summary!=='object' || Array.isArray(result.summary) || typeof result.fingerprint!=='string' || !result.fingerprint)throw new Error('Invalid trusted preview');
    state={...state,preview:{summary:clone(result.summary),fingerprint:result.fingerprint,paginationPlan:clone(paginationPlan)},token:randomUUID()};
    return view(c);
   });
  },
  generate(event, payload) {
   return execute(event,payload,['token','paginationPlan'],['token'],true,async(c,check)=>{
    if(typeof generatePortable!=='function'||typeof pickOutput!=='function')throw Object.assign(new Error('生成入口未配置'),{publicError:true,code:'GENERATION_UNAVAILABLE'});
    const paginationPlan=approvedPlan(payload);
    if(!state.preview)reject('PREVIEW_REQUIRED');
    if(!isDeepStrictEqual(paginationPlan,state.preview.paginationPlan))reject('PREVIEW_CHANGED');
    const expectedPreviewFingerprint=state.preview.fingerprint;
    const verify=verifier(check);
    await verify();const selected=await pickOutput();check();const parent=typeof selected==='string'?selected:selected?.canceled?null:selected?.filePaths?.[0];
    if(!parent)return {...view(c),cancelled:true};
    if(typeof parent!=='string'||!path.isAbsolute(parent)||parent.includes('\0'))reject('INVALID_PAYLOAD');
    await verify();
    
     const result=await generatePortable({snapshot:clone(state.snapshot),report:clone(state.report),paginationPlan,expectedPreviewFingerprint,assetsRoot:state.paths.assets,outputParent:parent,check:verify});
    check();
    state={...state,token:randomUUID()};
    return {...view(c),generated:{file:result.file,root:result.root,mediaSummary:result.mediaSummary},message:'已另存为新工程；当前工程未替换。请通过打开工程查看生成结果。'};
   });
  },
  reset(event, payload) {
   return execute(event, payload, ['token'], ['token'], true, async (c, check) => { check(); state = empty(); return view(c); });
  },
  getState(event, payload) {
   return execute(event, payload, ['token'], [], false, async (c, check) => { check(); return view(c); });
  }
 });
}
module.exports = {createScriptPreflightSession};
