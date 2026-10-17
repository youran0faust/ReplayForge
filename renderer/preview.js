const stage = document.querySelector('#stage');
const viewport = document.querySelector('.preview');
const frame = document.querySelector('#frame');
const x = document.querySelector('#x'), y = document.querySelector('#y');
const locale = document.querySelector('#locale');
const meta = document.querySelector('#meta'), log = document.querySelector('#log');
const rangeStart = document.querySelector('#range-start'), rangeEnd = document.querySelector('#range-end');
let rangeDocument = Symbol('uninitialized'), rangeDuration = null;
function resetPreviewRange() { rangeStart.value = 0; rangeEnd.value = rangeDuration; }
function syncPreviewRange(packet) {
  const duration = packet.project.scene.durationFrames;
  const changedDocument = Object.prototype.hasOwnProperty.call(packet, 'documentId') && rangeDocument !== packet.documentId;
  if (changedDocument || rangeDuration === null) {
    rangeDocument = packet.documentId;
    rangeDuration = duration;
    resetPreviewRange();
  } else if (duration !== rangeDuration) {
    const start = Number(rangeStart.value), end = Number(rangeEnd.value);
    const wholeScene = start === 0 && end === rangeDuration;
    rangeDuration = duration;
    if (wholeScene || rangeStart.value === '' || rangeEnd.value === '' || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || start >= duration) resetPreviewRange();
    else rangeEnd.value = Math.min(end, duration);
  }
  rangeStart.max = Math.max(0, duration - 1); rangeEnd.max = duration;
  rangeStart.disabled = rangeEnd.disabled = duration < 1;
  document.querySelector('#range-play').disabled = document.querySelector('#range-reset').disabled = duration < 1;
}
const dialogueSelect = document.querySelector('#dialogue-select');
const dialoguePageSelect = document.querySelector('#dialogue-page-select'), dialoguePageStatus = document.querySelector('#dialogue-page-status');
let selectedDialoguePageId = null, pageDraft = null, pageSerial = 0, pagePublishing = Promise.resolve(), pagePublishedKey = null;
function publishPageDraft() {
  if (!current || !window.replay.updateDialoguePageDraftStatus) return;
  const payload = {dirty:!!pageDraft,documentId:current.documentId}, key=JSON.stringify([payload,pageSerial]);
  if (key===pagePublishedKey) return; pagePublishedKey=key;
  pagePublishing=pagePublishing.catch(()=>{}).then(()=>window.replay.updateDialoguePageDraftStatus(payload)).catch(e=>{log.textContent='对白页草稿状态同步失败：'+e.message;});
}
function clearPageDraft() { pageDraft=null; pageSerial++; publishPageDraft(); }
function allowPageDiscard() { if (!pageDraft) return true; if (!window.confirm('存在未应用的对白页文本或时间修改。确定放弃吗？')) return false; clearPageDraft(); return true; }
function markPageDraft() {
  if (!current || !selectedDialogueId) return;
  if (!pageDraft) pageDraft={documentId:current.documentId,dialogueId:selectedDialogueId,pageId:selectedDialoguePageId,revision:current.revision,locale:current.project.locale};
  pageSerial++; publishPageDraft(); document.querySelector('#dialogue-page-discard').disabled=false; document.querySelector('#dialogue-page-add').disabled=true; dialoguePageStatus.textContent=pageDraft.revision!==current.revision || pageDraft.locale!==current.project.locale ? '工程版本或语言已变化；草稿已保留，不可应用，请放弃并重新载入。' : '有未应用的本地对白页修改；定位和保存不会清除。请应用或明确放弃。未应用表单不自动恢复。';
}
function pageFresh() { if(pageDraft && (pageDraft.documentId!==current.documentId || pageDraft.revision!==current.revision || pageDraft.locale!==current.project.locale)) throw Error('工程版本或语言已变化；对白页草稿已保留，请先放弃并重新载入。'); }

const dialogueSpeaker = document.querySelector('#dialogue-speaker');
const dialogueSpeakerApply = document.querySelector('#dialogue-speaker-apply');
const dialogueText = document.querySelector('#dialogue-text');
const dialogueStart = document.querySelector('#dialogue-start');
const dialogueEnd = document.querySelector('#dialogue-end');
const dialogueReveal = document.querySelector('#dialogue-reveal');
const dialogueAdd = document.querySelector('#dialogue-add');
const dialogueDelete = document.querySelector('#dialogue-delete');
const dialogueDeleteConfirm = document.querySelector('#dialogue-delete-confirm');
const dialogueUp = document.querySelector('#dialogue-up');
const dialogueDown = document.querySelector('#dialogue-down');
const characterSelect = document.querySelector('#character-select');
const characterAdd = document.querySelector('#character-add');
const characterDelete = document.querySelector('#character-delete');
const characterDeleteConfirm = document.querySelector('#character-delete-confirm');
const characterName = document.querySelector('#character-name');
const characterWidth = document.querySelector('#character-width');
const characterHeight = document.querySelector('#character-height');
const characterFrom = document.querySelector('#character-from');
const characterTo = document.querySelector('#character-to');
const characterApply = document.querySelector('#character-apply');
const backgroundImport = document.querySelector('#background-import');
const backgroundUnbind = document.querySelector('#background-unbind');
const characterImport = document.querySelector('#character-import');
const characterUnbind = document.querySelector('#character-unbind');
const audioTrackSelect = document.querySelector('#audio-track-select'), audioTrackKind = document.querySelector('#audio-track-kind'), audioTrackImport = document.querySelector('#audio-track-import'), audioTrackName = document.querySelector('#audio-track-name'), audioTrackStart = document.querySelector('#audio-track-start'), audioTrackGain = document.querySelector('#audio-track-gain'), audioTrackApply = document.querySelector('#audio-track-apply'), audioTrackDelete = document.querySelector('#audio-track-delete'), audioTrackDeleteConfirm = document.querySelector('#audio-track-delete-confirm');
const imageInfo = document.querySelector('#image-info');
const characterPreview = document.querySelector('#character-preview');
const characterPreviewInfo = document.querySelector('#character-preview-info');
let portraitKey = null;
const timeline = document.querySelector('#timeline');
const timelineRuler = document.querySelector('#timeline-ruler');
const timelineTracks = document.querySelector('#timeline-tracks');
const timelineWarnings = document.querySelector('#timeline-warnings');
const timelineFrame = document.querySelector('#timeline-frame');
const playhead = document.querySelector('#timeline-playhead');
let playheadDrag = null;
function positionTimelinePlayhead(value, extent) {
  const ratio=Math.max(0,Math.min(1,Number(value)/Math.max(1,extent)));
  playhead.style.left=`${timelineRuler.offsetLeft+timelineRuler.getBoundingClientRect().width*ratio}px`;
}
if(typeof ResizeObserver==='function')new ResizeObserver(()=>positionTimelinePlayhead(Number(frame.value)||0,Number(timeline.dataset.extent)||1)).observe(timelineRuler);
function syncTransportFrame(value) {
  frame.value = value; document.querySelector('#scrub').value = value;
  timelineFrame.textContent = formatTimelineNumber(value);
  const extent = Number(timeline.dataset.extent) || 1;
  positionTimelinePlayhead(value, extent);
  playhead.setAttribute('aria-valuenow', value);
  playhead.setAttribute('aria-valuemax', Math.max(0, (current?.project.scene.durationFrames || 1) - 1));
}
function seekTransport(value) {
  if (!current) return;
  syncTransportFrame(Math.max(0, Math.min(current.project.scene.durationFrames - 1, Math.floor(value))));
  pendingFrame = Number(frame.value); pumpPlaybackFrame();
}
function finishPlayheadDrag() {
  const drag = playheadDrag; playheadDrag = null;
  if (drag) try { if (playhead.hasPointerCapture(drag.pointerId)) playhead.releasePointerCapture(drag.pointerId); } catch (_) {}
}
function movePlayhead(event) {
  if (!playheadDrag || event.pointerId !== playheadDrag.pointerId) return;
  event.preventDefault(); event.stopPropagation();
  seekTransport(timelineFrameAt(event.clientX, timelineRuler.getBoundingClientRect(), Number(timeline.dataset.extent)));
}
playhead.onpointerdown = event => {
  if (!current || event.button !== 0 || event.isPrimary === false) return;
  event.preventDefault(); event.stopPropagation(); cancelTimelineDrag(); pausePlayback();
  playheadDrag = {pointerId:event.pointerId};
  try { playhead.setPointerCapture(event.pointerId); } catch (_) { finishPlayheadDrag(); return; }
  movePlayhead(event);
};
playhead.onpointermove = movePlayhead;
playhead.onpointerup = event => { if (playheadDrag?.pointerId !== event.pointerId) return; movePlayhead(event); finishPlayheadDrag(); };
playhead.onpointercancel = playhead.onlostpointercapture = finishPlayheadDrag;
playhead.onclick = event => { event.stopPropagation(); };
const codeText = document.querySelector('#code-text'), codeStatus = document.querySelector('#code-status'), codeApply = document.querySelector('#code-apply'), codeReset = document.querySelector('#code-reset'), codeResetConfirm = document.querySelector('#code-reset-confirm');
const codeEditor = createCodeEditorController();
let codeBusy = false, codeGeneration = 0;
const recoveryStatus = document.querySelector('#recovery-status');
const recoveryHint = '自动恢复：修改后空闲5秒写入，持续编辑最长15秒触发；不等同于正式保存工程。';
let recoveryDocument = Symbol('uninitialized'), draftSequence = 0, draftFailure = null;
const draftUpdates = new Set();
function showRecoveryStatus(packet) {
  if (!recoveryStatus || !packet) return;
  if (packet.recoveryError) recoveryStatus.textContent = `自动恢复失败：${packet.recoveryError}。请正式保存工程；代码草稿请另行保留。`;
  else if (Object.prototype.hasOwnProperty.call(packet, 'recoveryError') || packet.recoveryStatus) {
    const status = packet.recoveryStatus;
    const savedAt = packet.recoverySavedAt || status?.savedAt;
    const pending = packet.recoveryPending ?? status?.pending;
    recoveryStatus.textContent = status?.error ? `自动恢复失败：${status.error}` :
      pending ? '自动恢复待写入。' + recoveryHint :
      savedAt ? `自动恢复快照已写入（${new Date(savedAt).toLocaleTimeString()}）；不等同于正式保存工程。` : recoveryHint;
  }
}
function publishCodeDraft() {
  const sequence = ++draftSequence;
  if (!window.replay.updateCodeDraft) return Promise.resolve();
  // Send in input order immediately, not after the previous disk/IPC acknowledgment.
  // Main records each snapshot synchronously and serializes its debounced disk writes.
  let request;
  try { request = window.replay.updateCodeDraft(codeEditor.state); }
  catch (error) { request = Promise.reject(error); }
  const pending = Promise.resolve(request).then(packet => {
    if (sequence !== draftSequence) return;
    draftFailure = null; showRecoveryStatus(packet || {recoveryError: null});
  }, error => {
    if (sequence !== draftSequence) return;
    draftFailure = error; showRecoveryStatus({recoveryError: error.message || String(error)});
  }).finally(() => draftUpdates.delete(pending));
  draftUpdates.add(pending);
  return pending;
}
async function awaitCodeDrafts() {
  await Promise.all([...draftUpdates]);
  if (draftFailure) throw draftFailure;
}
function syncCodeEditor(packet) {
  showRecoveryStatus(packet);
  if (!codeBusy) {
    if (packet?.project && Object.prototype.hasOwnProperty.call(packet, 'documentId') && recoveryDocument !== packet.documentId) {
      recoveryDocument = packet.documentId;
      codeEditor.restoreDraft(packet.codeDraft, packet);
      if (packet.codeDraft?.dirty && recoveryStatus && !packet.recoveryError) recoveryStatus.textContent = '已恢复未提交草稿（尚未应用）。' + recoveryHint;
    } else codeEditor.sync(packet);
    codeText.value = codeEditor.state.text;
  }
  codeResetConfirm.checked = false;
  codeStatus.textContent = codeEditor.state.stale ? '工程已变化，当前草稿基于旧版本；请保留文本并重置后再应用。' : (codeEditor.state.dirty ? '有未提交草稿' : '已同步');
  codeApply.disabled = codeBusy || codeEditor.state.stale;
  codeReset.disabled = codeBusy || (!codeEditor.state.dirty && !codeEditor.state.stale);
  codeResetConfirm.disabled = codeBusy || !codeEditor.state.dirty;
}
let timelineModel = null, timelineSelection = null, timelineRenderKey = null;
// Independent of transport: bounded caches and serialized, retryable analysis.
function createWaveformLoader(options = {}) {
  const budget=options.byteBudget??32*1024*1024, maxBytes=32*1024*1024, maxDecoded=64*1024*1024;
  const decodedCache=new Map(), peaksCache=new Map(), jobs=new Map(), pending=new Map();
  const yieldTask=options.yieldTask||(()=>new Promise(r=>setTimeout(r,0)));
  let used=0,tail=Promise.resolve(),context,stopped=false,controller;
  const timeoutMs=Number.isFinite(options.timeoutMs)&&options.timeoutMs>0?options.timeoutMs:30000;
  const stoppedResult={peaks:null,reason:'波形处理超时，已停止波形加载；请保存工程后重启编辑器',restartRequired:true};
  function stop(){
    if(stopped)return;stopped=true;
    try{controller?.abort();}catch(_){}
    try{const closing=context?.close();closing?.catch?.(()=>{});}catch(_){}
    for(const job of jobs.values()){clearTimeout(job.timer);job.requests.length=0;}
    for(const entry of pending.values())entry.resolve(stoppedResult);
    pending.clear();jobs.clear();decodedCache.clear();peaksCache.clear();used=0;
  }
  function checkActive(){if(stopped)throw Error(stoppedResult.reason);}
  const skip=message=>Object.assign(Error(message),{skip:true});
  function touch(map,key){const v=map.get(key);map.delete(key);map.set(key,v);return v;}
  async function decode(url){
    if(decodedCache.has(url))return touch(decodedCache,url).buffer;
    let buffer;
    if(options.decode)buffer=await options.decode(url);
    else {
      const Context=window.AudioContext||window.webkitAudioContext;
      if(!Context||typeof fetch!=='function')throw skip('当前环境不支持波形');
      controller=new AbortController();
      const response=await fetch(url,{signal:controller.signal});checkActive();if(!response.ok)throw Error(`读取失败 ${response.status}`);
      if(Number(response.headers?.get('content-length'))>maxBytes){await response.body?.cancel();throw skip('素材超过32MiB波形读取上限');}
      let encoded;
      if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let size=0;
        try {while(true){const part=await reader.read();checkActive();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes){await reader.cancel();throw skip('素材超过32MiB波形读取上限');}chunks.push(part.value);}}
        finally{reader.releaseLock();}
        const data=new Uint8Array(size);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.length;}encoded=data.buffer;
      } else {encoded=await response.arrayBuffer();if(encoded.byteLength>maxBytes)throw skip('素材超过32MiB波形读取上限');}
      // P1 imports PCM WAV. Inspect the header before decode to avoid compressed expansion.
      checkActive();
      const view=new DataView(encoded), tag=at=>String.fromCharCode(...new Uint8Array(encoded,at,4));
      if(encoded.byteLength<44||tag(0)!=='RIFF'||tag(8)!=='WAVE')throw skip('仅为PCM WAV显示波形');
      let channels=0,rate=0,align=0,dataBytes=0,format=0;
      for(let at=12;at+8<=view.byteLength;){const size=view.getUint32(at+4,true),end=at+8+size;if(end>view.byteLength)throw skip('WAV数据不完整');
        if(tag(at)==='fmt '&&size>=16){format=view.getUint16(at+8,true);channels=view.getUint16(at+10,true);rate=view.getUint32(at+12,true);align=view.getUint16(at+20,true);}
        if(tag(at)==='data')dataBytes+=size;at=end+(size%2);
      }
      if(![1,3,65534].includes(format)||![1,2].includes(channels)||!rate||!align)throw skip('WAV格式不支持波形');
      const seconds=dataBytes/align/rate;
      if(seconds>600||seconds*48000*channels*4>maxDecoded)throw skip('大素材已跳过波形（10分钟/64MiB解码上限）');
      context ||= new Context({sampleRate:48000});buffer=await context.decodeAudioData(encoded);
    }
    checkActive();
    const bytes=buffer.length*buffer.numberOfChannels*4;
    if(buffer.sampleRate<=0||buffer.numberOfChannels<1||!Number.isFinite(bytes)||bytes>maxDecoded||buffer.length/buffer.sampleRate>600)throw skip('大素材或无效音频已跳过波形');
    if(bytes<=budget){while(used+bytes>budget&&decodedCache.size){const key=decodedCache.keys().next().value;used-=decodedCache.get(key).bytes;decodedCache.delete(key);}decodedCache.set(url,{buffer,bytes});used+=bytes;}
    return buffer;
  }
  async function reduce(buffer,offset,duration){
    const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
    const from=Math.min(buffer.length,Math.floor(offset*buffer.sampleRate/48000));
    const to=duration===undefined?buffer.length:Math.max(from,Math.min(buffer.length,Math.floor((offset+duration)*buffer.sampleRate/48000)));
    const peaks=[];let work=0;await yieldTask();checkActive();
    for(let i=0;i<128;i++){const start=from+Math.floor(i*(to-from)/128),end=Math.min(to,Math.max(start+1,from+Math.floor((i+1)*(to-from)/128)));let min=0,max=0;
      for(let j=start;j<end;j++)for(const channel of channels){const value=channel[j];if(Number.isFinite(value)){min=Math.min(min,value);max=Math.max(max,value);}if(++work>=65536){work=0;await yieldTask();checkActive();}}
      peaks.push([min,max]);
    }return peaks;
  }
  function load(url,offset=0,duration=undefined,facts={}){
    if(stopped)return Promise.resolve(stoppedResult);
    if(!url||!Number.isSafeInteger(offset)||offset<0||(duration!==undefined&&(!Number.isSafeInteger(duration)||duration<0||!Number.isSafeInteger(offset+duration))))return Promise.resolve({peaks:null,reason:'源区间无效',skipped:true});
    if(facts.sourceDurationSamples>600*48000||facts.sourceBytes>maxBytes||facts.sourceDurationSamples*(facts.channels||2)*4>maxDecoded)return Promise.resolve({peaks:null,reason:'大素材已跳过波形',skipped:true});
    const key=JSON.stringify([url,offset,duration??null]);if(peaksCache.has(key))return Promise.resolve(touch(peaksCache,key));if(pending.has(key))return pending.get(key).promise;
    if(pending.size>=512)return Promise.resolve({peaks:null,reason:'波形队列已满，请稍后重试',skipped:false});
    let resolve;const promise=new Promise(r=>{resolve=r;});pending.set(key,{promise,resolve});
    // Deadline includes time queued behind other sources; terminal stop never overlaps decoders.
    let job=jobs.get(url);if(!job){job={requests:[],timer:setTimeout(stop,timeoutMs)};jobs.set(url,job);
      tail=tail.then(async()=>{
        if(stopped)return;
        let buffer,failure;
        for(let attempt=0;attempt<2;attempt++)try{checkActive();buffer=await decode(url);break;}catch(e){if(stopped)return;failure={peaks:null,reason:e.message,skipped:!!e.skip};if(e.skip||attempt===1)break;await (options.retryDelay?options.retryDelay():new Promise(r=>setTimeout(r,300)));}
        while(job.requests.length){const request=job.requests.shift();let result=failure;
          if(buffer)try{result={peaks:await reduce(buffer,request.offset,request.duration)};checkActive();peaksCache.set(request.key,result);while(peaksCache.size>(options.maxPeakEntries??256))peaksCache.delete(peaksCache.keys().next().value);}catch(e){result={peaks:null,reason:e.message};}
          pending.delete(request.key);request.resolve(result);
        }
        clearTimeout(job.timer);jobs.delete(url);
      }).catch(error=>{while(job.requests.length){const request=job.requests.shift();pending.delete(request.key);request.resolve(stopped?stoppedResult:{peaks:null,reason:error.message});}clearTimeout(job.timer);jobs.delete(url);});
    }
    job.requests.push({key,offset,duration,resolve});return promise;
  }
  return {load,get stats(){return {decodedBytes:used,peakEntries:peaksCache.size,inFlight:pending.size};}};
}
const waveformLoader = createWaveformLoader();
function loadWaveform(url, sourceOffsetSamples = 0, durationSamples = undefined) {
  return waveformLoader.load(url, sourceOffsetSamples, durationSamples).then(result => result.peaks);
}
function renderWaveform(button, url, key, sourceOffsetSamples = 0, durationSamples = undefined, facts = {}) {
  if (!url) return;
  waveformLoader.load(url, sourceOffsetSamples, durationSamples, facts).then(result => {
    if (!button.isConnected || button.dataset.waveformKey !== key) return;
    const peaks = result.peaks;
    if (!peaks) {
      button.dataset.waveformStatus = result.skipped ? 'skipped' : 'failed';
      const hint = document.createElement('span'); hint.className = 'timeline-waveform-hint';
      hint.textContent = result.restartRequired ? ' [波形已停止，请保存工程后重启编辑器]' : result.skipped ? ' [波形已跳过]' : ' [波形加载失败]';
      hint.title = `波形：${result.reason}（不影响播放或导出）`;
      button.querySelector('.timeline-waveform-hint')?.remove(); button.appendChild(hint);
      if (!result.skipped && !result.restartRequired) hint.onclick = event => { event.stopPropagation(); if(button.isConnected && button.dataset.waveformKey === key) { hint.remove(); renderWaveform(button,url,key,sourceOffsetSamples,durationSamples,facts); } };
      return;
    }
    button.querySelector('.timeline-waveform-hint')?.remove();
    button.dataset.waveformStatus = 'ready';
    button.querySelector('.timeline-waveform')?.remove();
    const canvas = document.createElement('canvas'); canvas.className = 'timeline-waveform'; canvas.setAttribute('aria-hidden', 'true');
    const width = Math.max(1, Math.floor(button.clientWidth * (window.devicePixelRatio || 1))), height = Math.max(1, Math.floor(button.clientHeight * (window.devicePixelRatio || 1)));
    canvas.width = width; canvas.height = height; canvas.style.width = '100%'; canvas.style.height = '100%';
    const ctx = canvas.getContext?.('2d'); if (!ctx) return;
    ctx.strokeStyle = 'rgba(255,255,255,.68)'; ctx.lineWidth = Math.max(1, window.devicePixelRatio || 1); ctx.beginPath();
    peaks.forEach((pair, i) => { const px = (i + .5) / peaks.length * width; ctx.moveTo(px, height * (1 - Math.max(-1, Math.min(1, pair[1]))) / 2); ctx.lineTo(px, height * (1 - Math.max(-1, Math.min(1, pair[0]))) / 2); }); ctx.stroke();
    button.insertBefore(canvas, button.firstChild);
  });
}
function syncTimelineSelection() {
  characterClipEditor?.render();
  for(const node of timelineTracks.querySelectorAll('[data-kind][data-id]')) {const yes=!!timelineSelection&&node.dataset.kind===timelineSelection.kind&&node.dataset.id===timelineSelection.id&&(node.dataset.pageId||null)===(timelineSelection.pageId||null);node.classList.toggle('selected',yes);node.setAttribute('aria-pressed',String(yes));}
  const eligible=timelineSelection&&['dialogues','pages','dialogueGroups','audioTracks','audio','voiceClips'].includes(timelineSelection.kind);
  document.querySelector('#timeline-split').disabled=!eligible||timelineSplitBusy;
  document.querySelector('#timeline-selection-status').textContent=eligible ? (timelineSelection.kind==='audioTracks' ? '播放头位于独立音轨内部时可切分；共享源文件，切分后选中右段。' : '播放头位于所选片段内部时可切分；保留原文与连续配音。') : '单击选择；双击定位。切分支持对白/页、配音片段和独立BGM/音效；配音切分不改变字幕。';
}
function allowProductionSelection({owner='unknown',id=null,eventId,pageId}={}){
 if(scenePerformanceEditor?.busy)return false;
 if(scenePerformanceEditor?.dirty&&!scenePerformanceEditor.allowDiscard())return false;
 publishScenePerformanceDraft();
 if(owner==='resource')return true;
 if(owner==='character'){
  if(imageBusy||performanceEditor?.busy)return false;
  const switching=id!==selectedCharacterId;
  if(!switching){if(eventId!==undefined&&eventId!==selectedEventId){if(!allowEventDiscard())return false;publishExpressionDraft();}return true;}
  const labels=[...(hasExpressionDraft()?['表情/画布']:[]),...(eventFormDraft?['表情事件']:[]),...(performanceEditor?.dirty?['显隐/位置事件']:[])];
  if(labels.length&&!window.confirm('当前角色有未应用的'+labels.join('、')+'修改。确定放弃这些修改并切换角色吗？其他面板草稿将保留。'))return false;
  eventFormDraft=null;clearExpressionDraft();performanceEditor?.clear();publishExpressionDraft();publishPerformanceDraft();return true;
 }
 if(owner==='dialogue')return (id===selectedDialogueId&&(pageId===undefined||pageId===selectedDialoguePageId))||allowPageDiscard();
 if(owner==='audio'){if(id===selectedAudioTrackId)return true;if(!allowAudioDiscard())return false;audioFormBinding=null;return true;}
 if(owner==='background')return !backgroundEditor?.busy;
 if(owner==='voice')return !voiceClipEditor?.busy;
 if(owner==='component')return !componentEditor?.busy;
 if(owner==='library')return !characterLibraryEditor?.busy;
 if(backgroundEditor?.busy||voiceClipEditor?.busy||componentEditor?.busy||characterLibraryEditor?.busy||textImportEditor?.busy||performanceEditor?.busy)return false;
 if((eventFormDraft||hasExpressionDraft()||pageDraft||audioFormDirty()||backgroundEditor?.dirty||voiceClipEditor?.dirty||componentEditor?.dirty||characterLibraryEditor?.dirty||textImportEditor?.dirty||performanceEditor?.dirty)&&!window.confirm('有未应用的属性表单，确定全部放弃并切换对象吗？取消将完整保留。'))return false;
 eventFormDraft=null;clearExpressionDraft();clearPageDraft();audioFormBinding=null;syncAudioTrackEditor(current.project);backgroundEditor?.clear();voiceClipEditor?.clear();componentEditor?.clear();characterLibraryEditor?.clear();textImportEditor?.clear();performanceEditor?.clear();publishPerformanceDraft();publishExpressionDraft();publishExtensionDraft();publishS3Draft();return true;
}
function selectTimelineItem(node, followed=false) {
 if(!followed&&productionAssets){const identity={...node.dataset},doc=current?.documentId;return productionAssets.follow(()=>{if(current?.documentId!==doc)return false;const live=Array.from(timelineTracks.querySelectorAll('[data-kind][data-id]')).find(n=>n.dataset.kind===identity.kind&&n.dataset.id===identity.id&&(n.dataset.characterId||'')===(identity.characterId||'')&&(n.dataset.dialogueId||'')===(identity.dialogueId||'')&&(n.dataset.pageId||'')===(identity.pageId||''));return live?selectTimelineItem(live,true):false;},node.title||node.dataset.id);}
 const kind=node.dataset.kind,id=node.dataset.id,pageId=node.dataset.pageId||null;
 if(kind==='components')return selectImageComponent(id);
 if(kind==='backgroundEvents'){if(!current.project.scene.backgroundEvents?.some(e=>e.id===id)||!allowProductionSelection({owner:'background',id})||!backgroundEditor.select(id))return false;timelineSelection={kind,id,pageId:null};syncTimelineSelection();return true;}
 const owner=['audio','voiceClips'].includes(kind)?'voice':kind==='audioTracks'?'audio':['characters','expressionEvents'].includes(kind)?'character':'dialogue';
 if(!allowProductionSelection({owner,id:kind==='expressionEvents'?node.dataset.characterId:id,...(kind==='expressionEvents'?{eventId:id}:{}),...(['pages','dialogues','dialogueGroups'].includes(kind)?{pageId}:{})}))return false;
 if(kind==='audio'||kind==='voiceClips'){const dialogueId=kind==='audio'?id:node.dataset.dialogueId;if(!voiceClipEditor.select(dialogueId,kind==='audio'?null:id))return false;timelineSelection={kind,id,dialogueId,pageId:null};syncTimelineSelection();editorLayout.showAudioTab('voice');editorLayout.setFocus(null);return true;}
 if(kind==='expressionEvents'){const characterId=node.dataset.characterId;selectedCharacterId=characterId;selectedEventId=id;syncImageEditor(current.project);characterEventSublanes?.expand(characterId);} else if(kind==='characters'){selectedCharacterId=id;syncImageEditor(current.project);}
 else if(kind==='audioTracks'){if(id!==selectedAudioTrackId&&!allowAudioDiscard())return false;selectedAudioTrackId=id;syncAudioTrackEditor(current.project);}
 else {if((id!==selectedDialogueId||pageId!==selectedDialoguePageId)&&!allowPageDiscard())return false;selectedDialogueId=id;selectedDialoguePageId=pageId;syncDialogueEditor(current.project);}
 timelineSelection={kind,id,pageId};syncTimelineSelection();if(['characters','expressionEvents'].includes(kind))window.editorLayout?.showVisualTab(kind==='expressionEvents'?'characterEvents':'character');else {window.editorLayout?.showAudioTab(kind==='audioTracks'?'audio':['pages','dialogueGroups'].includes(kind)?'pages':'dialogue');window.editorLayout?.setFocus(null);}return true;
}
let timelineDrag = null, timelineCommitting = false, suppressTimelineClick = false;
let timelineSnapEnabled=true;
function syncTimelineSnapControl(){const button=document.querySelector('#timeline-snap-toggle');if(button){button.setAttribute('aria-pressed',String(timelineSnapEnabled));button.textContent=timelineSnapEnabled?'吸附：开':'吸附：关';}const status=document.querySelector('#timeline-snap-status');if(status)status.textContent=timelineSnapEnabled?'移动或调整边缘时自动对齐；按住 Alt 临时精调。':'吸附已关闭；拖动按帧精调。';}
function renderTimelineSnapGuide(drag,snap){drag.snapGuide?.remove();drag.snapGuide=null;if(!snap)return;const guide=document.createElement('div');guide.className='timeline-snap-guide';guide.style.left=`${snap.frame/drag.extent*100}%`;guide.setAttribute('aria-hidden','true');const label=document.createElement('span');label.textContent=`对齐 ${snap.frame}帧 · ${snap.label}`;guide.append(label);drag.lane.append(guide);drag.snapGuide=guide;const status=document.querySelector('#timeline-snap-status');if(status)status.textContent=label.textContent;}
function detachTimelineDrag() {
  const drag = timelineDrag;
  timelineDrag = null;
  if (!drag) return null;
  drag.ghost?.remove();drag.snapGuide?.remove();syncTimelineSnapControl();
  try { if (drag.item.hasPointerCapture?.(drag.pointerId)) drag.item.releasePointerCapture(drag.pointerId); } catch (_) { /* Capture may already be lost. */ }
  return drag;
}
function cancelTimelineDrag() {
  if (timelineDrag) { suppressTimelineClick = true; detachTimelineDrag(); }
}
function validTimelineDrag(drag) {
  return current && drag.documentId === current.documentId && drag.revision === current.revision && drag.generation === playbackGeneration;
}
function timelinePointerDown(event) {
  if (event.button !== 0 || event.isPrimary === false || timelineCommitting) return;
  cancelTimelineDrag(); suppressTimelineClick = false;
  const item = event.target.closest('[data-kind][data-id]');
  if (!current || !item || !['dialogues', 'characters','expressionEvents','dialogueGroups','pages','audioTracks','audio'].includes(item.dataset.kind)) return;
  const group=item.closest('.timeline-group'), divider=event.target.closest('.timeline-divider');
  if (item.dataset.kind === 'expressionEvents') {
    const characterId=item.dataset.characterId, character=current.project.scene.characters.find(c=>c.id===characterId), eventData=character?.expressionEvents?.find(e=>e.id===item.dataset.id);
    if (!character || !eventData || !allowExpressionSelection()) return;
    pausePlayback(); const lane=item.closest('.timeline-lane'), rect=lane?.getBoundingClientRect(); if (!rect || rect.width<=0) return;
    timelineDrag={item,pointerId:event.pointerId,x:event.clientX,y:event.clientY,rect,extent:Number(timeline.dataset.extent),project:current.project,documentId:current.documentId,revision:current.revision,generation:playbackGeneration,kind:'expressionEvents',selectionKind:'expressionEvents',id:eventData.id,characterId,source:eventData,startFrame:eventData.frame,lane,top:Number.parseFloat(item.closest('.timeline-item,.timeline-character-events')?.style.top)||0,mode:'move',durationFrames:current.project.scene.durationFrames,moved:false};
    try { item.setPointerCapture(event.pointerId); } catch (_) { cancelTimelineDrag(); } return;
  }
  if(item.dataset.kind==='pages'&&!divider)return;
  const kind=group?'dialogues':item.dataset.kind;
  const source = timelineModel?.tracks.filter(track=>track.kind===kind && (!item.dataset.laneKey || track.laneKey===item.dataset.laneKey)).flatMap(track=>track.items).find(value => value.id === item.dataset.id);
   if(kind==='characters'&&source?.visibilityControlled){log.textContent='角色显隐片段由事件控制；请到角色事件页编辑显隐，暂不支持直接拖动或裁剪片段。';return;}
   if(kind==='audio'&&source?.bindingMode!=='independent'){log.textContent='配音当前绑定对白，请先解绑定再独立移动或裁剪。';return;}
  const lane=item.closest('.timeline-lane'),rect = lane.getBoundingClientRect();
  if (!source || rect.width <= 0 || current.project.scene.durationFrames < 1) return;
  pausePlayback();
  const mode = divider?'boundary':event.target.closest('.timeline-handle-start') ? 'start' : event.target.closest('.timeline-handle-end') ? 'end' : 'move';
  const audio=kind==='audioTracks'?current.project.scene.audioTracks.find(a=>a.id===item.dataset.id):kind==='audio'?current.project.scene.dialogues.find(d=>d.id===item.dataset.id)?.voice:null;
  const audioResource=audio?{durationSamples:current.project.resources.find(r=>r.id===audio.resourceId)?.durationSamples??audio.sourceDurationSamples}:null;
  if(audio&&mode!=='move'&&!Number.isSafeInteger(audioResource?.durationSamples)){log.textContent='源音频总时长未知，只能移动，不能裁剪。';return;}
  if(audio&&!Number.isSafeInteger(48000/current.project.design.fps)){log.textContent='当前帧率无法映射整数音频样本，不能拖动音轨。';return;}
  timelineDrag = {item, pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect,
    extent: Number(timeline.dataset.extent), project: current.project, documentId:current.documentId, revision: current.revision, generation: playbackGeneration,
    kind, selectionKind:item.dataset.kind, id: item.dataset.id, startFrame: source.startFrame, endFrame: source.endFrame,
    ...(audio?{sourceOffsetSamples:audio.sourceOffsetSamples??0,durationSamples:audio.durationSamples,sourceDurationSamples:audioResource?.durationSamples,fps:current.project.design.fps}:{}),
    lane,top:source.top,group:!!group,pages:source.children,pageId:divider?item.dataset.pageId:null,
    mode, durationFrames: current.project.scene.durationFrames, moved: false};
  try { item.setPointerCapture(event.pointerId); } catch (_) { cancelTimelineDrag(); }
}
function timelinePointerMove(event) {
  const drag = timelineDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (!validTimelineDrag(drag)) { cancelTimelineDrag(); return; }
  if (Math.hypot(event.clientX - drag.x, (event.clientY ?? drag.y) - drag.y) >= 3) drag.moved = true;
  if (!drag.moved) return;
  event.preventDefault();
  const deltaFrames=(event.clientX-drag.x)/drag.rect.width*drag.extent;
  const calculate=delta=>drag.kind==='expressionEvents'?{frame:Math.max(0,Math.min(drag.durationFrames-1,Math.round(drag.startFrame+delta)))}:(['audioTracks','audio'].includes(drag.kind)?calculateAudioTrackDrag:drag.group?calculateGroupDrag:calculateTimelineDrag)({...drag,deltaFrames:delta});
  if(!drag.snapTargets)drag.snapTargets=collectTimelineSnapTargets({project:drag.project,model:timelineModel,drag,playhead:Number(frame.value)});
  const snapped=timelineSnapEnabled&&!event.altKey?snapTimelineDrag({drag,deltaFrames,targets:drag.snapTargets,thresholdFrames:8*drag.extent/drag.rect.width,calculate}):{result:calculate(deltaFrames),snap:null};
  drag.result=snapped.result;renderTimelineSnapGuide(drag,snapped.snap);if(!snapped.snap)syncTimelineSnapControl();
  const endFrame=drag.kind==='expressionEvents'?drag.result.frame+1:(['audioTracks','audio'].includes(drag.kind)?drag.result.startFrame+drag.result.durationSamples/48000*drag.fps:drag.result.endFrame);
  if (!drag.ghost) {
    drag.ghost = document.createElement('div'); drag.ghost.className = 'timeline-item timeline-ghost';
    drag.ghost.style.top = `${drag.top}px`; if(drag.group)drag.ghost.style.height='50px'; drag.lane.appendChild(drag.ghost);
  }
  const ghostStart=drag.kind==='expressionEvents'?drag.result.frame:drag.result.startFrame;
  drag.ghost.style.left = `${ghostStart / drag.extent * 100}%`;
  drag.ghost.style.width = `${(endFrame - ghostStart) / drag.extent * 100}%`;
  drag.ghost.textContent = `${ghostStart}–${formatTimelineNumber(endFrame)}`;
}
async function timelinePointerUp(event) {
  if (!timelineDrag || event.pointerId !== timelineDrag.pointerId) return;
  timelinePointerMove(event);
  const drag = detachTimelineDrag();
  if (!drag || !drag.moved || !validTimelineDrag(drag)) return;
  suppressTimelineClick = true; timelineCommitting = true;
  if (drag.kind === 'characters') { if (drag.id !== selectedCharacterId && !allowExpressionSelection()) { timelineCommitting=false; return; } selectedCharacterId = drag.id; }
  else if(drag.kind==='audioTracks'){if(!allowAudioDiscard()){timelineCommitting=false;return;}selectedAudioTrackId=drag.id;}
   else if(drag.kind==='expressionEvents'){if(!allowExpressionSelection()){timelineCommitting=false;return;}selectedCharacterId=drag.characterId;selectedEventId=drag.id;}
  else {if(pageDraft&&!allowPageDiscard()){timelineCommitting=false;return;}selectedDialogueId = drag.id;}
  timelineSelection={kind:drag.selectionKind,id:drag.id,pageId:drag.pageId};
  if(drag.kind==='dialogues')selectedDialoguePageId=drag.pageId;
  let failure;
  try {
    const serial=pageSerial;
    if(['dialogues','audio'].includes(drag.kind))await pagePublishing;
    if(drag.kind==='audio'&&!allowAudioDiscard())return;
    if(!validTimelineDrag(drag)||serial!==pageSerial)throw Error('工程或表单已改变，拖动已取消。');
    if(drag.kind==='expressionEvents'){const eventData=drag.source;if(drag.result.frame===eventData.frame) return;const editSerial=expressionEditSerial;publishExpressionDraft();await expressionDraftPublishing;if(!validTimelineDrag(drag)||editSerial!==expressionEditSerial)throw Error('拖动期间工程或表单已变化。');checkedResult(await window.replay.editExpressionEventChecked({commandId:crypto.randomUUID(),documentId:drag.documentId,expectedRevision:drag.revision,characterId:drag.characterId,eventId:drag.id,patch:{frame:drag.result.frame,expressionId:eventData.expressionId}}));}
     else if(drag.kind==='audioTracks')await window.replay.editAudioTrack(drag.id,Number.isSafeInteger(drag.sourceDurationSamples)?drag.result:{startFrame:drag.result.startFrame});
    else if(drag.kind==='audio')await window.replay.editDialogueVoiceTiming(drag.id,Number.isSafeInteger(drag.sourceDurationSamples)?drag.result:{startFrame:drag.result.startFrame});
    else await window.replay.editTimeline({kind: drag.kind, id: drag.id, ...(drag.pageId?{pageId:drag.pageId}:{}), ...drag.result});
  }
  catch (error) { failure = error; }
  finally {
    try { await locate(); } catch (error) { failure = failure || error; }
    timelineCommitting = false;
    if (failure) log.textContent = `错误：${failure.message || failure}`;
  }
}
timeline.onpointerdown = timelinePointerDown;
timeline.onpointermove = timelinePointerMove;
timeline.onpointerup = timelinePointerUp;
timeline.onpointercancel = event => { if (timelineDrag && (event.pointerId == null || event.pointerId === timelineDrag.pointerId)) cancelTimelineDrag(); };
timeline.onlostpointercapture = event => { if (timelineDrag && (event.pointerId == null || event.pointerId === timelineDrag.pointerId)) cancelTimelineDrag(); };
document.addEventListener('keydown', event => { if (event.key === 'Escape' && timelineDrag) { event.preventDefault(); cancelTimelineDrag(); } });
function renderTimeline(project, resourceUrls) {
  const renderKey=JSON.stringify([project,resourceUrls]);
  if(renderKey===timelineRenderKey){syncTimelineSelection();syncTransportFrame(Number(frame.value));return timelineModel;}
  timelineRenderKey=renderKey;
  cancelTimelineDrag();
  const model = timelineModel = buildTimelineModel(project, resourceUrls);
  const extent = Math.max(1, model.durationFrames, ...model.tracks.flatMap(track => track.items.map(item => item.endFrame)));
  timelineRuler.textContent = '';
  for (let tick = 0; tick < 10; tick++) {
    const label = document.createElement('span');
    label.textContent = formatTimelineNumber(extent * tick / 9);
    timelineRuler.appendChild(label);
  }
  timelineTracks.textContent = '';
  let imageTrackNodes=null;
  for (const track of model.tracks) {
    if(['audio','voiceClips'].includes(track.kind)&&!track.items.length)continue;
    const label = document.createElement('div'); label.className = 'timeline-label'; label.textContent = track.label; label.title=track.label;
    const lane = document.createElement('div'); lane.className = 'timeline-lane';
    if(track.kind==='characters')lane.dataset.characterCreateTarget='true';if(track.kind==='audioTracks')lane.dataset.mediaDropKind=track.laneKey;if(track.kind==='components')lane.dataset.mediaDropKind='image';if(track.kind==='dialogues')lane.dataset.textCreateTarget='true';
    lane.style.height = `${Math.max(28, ...track.items.map(item => item.top + item.height))}px`;
    for (const item of track.items) {
      if(track.kind==='characters'&&item.visibilityControlled){
        const hint='角色显隐片段由事件控制；点击选择角色，到角色事件页编辑显隐；暂不支持直接拖动或裁剪片段。';
        // A separate neutral identity/event row stays present even when all intervals are hidden.
        const identity=document.createElement('button');identity.type='button';identity.className='timeline-character-identity';identity.dataset.kind='characters';identity.dataset.id=item.id;identity.dataset.startFrame=item.startFrame;identity.textContent=item.label;identity.title=hint;
        Object.assign(identity.style,{position:'absolute',left:`${item.startFrame/extent*100}%`,width:`${Math.max(0,(item.endFrame-item.startFrame)/extent*100)}%`,top:`${item.top}px`,height:'20px',maxWidth:'25%',minWidth:'0',boxSizing:'border-box',padding:'0',overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis',fontSize:'11px',zIndex:'1'});lane.appendChild(identity);
        for(const [index,segment]of item.segments.entries()){
          const button=document.createElement('button');button.type='button';button.className='timeline-item timeline-character-segment';button.dataset.kind='characters';button.dataset.id=item.id;button.dataset.characterId=item.id;button.dataset.segmentIndex=index;button.dataset.startFrame=segment.startFrame;button.dataset.endFrame=segment.endFrame;
          button.textContent=item.label;button.title=`${item.label}: ${segment.startFrame}–${segment.endFrame}\n${hint}`;button.style.cursor='pointer';button.style.left=`${formatTimelineNumber(segment.startFrame/extent*100)}%`;button.style.width=`${formatTimelineNumber((segment.endFrame-segment.startFrame)/extent*100)}%`;button.style.top=`${item.top+24}px`;lane.appendChild(button);
        }
        // Markers use scene time, not a segment's width; hidden-period expression events remain editable.
        const events=document.createElement('div');events.className='timeline-character-events';events.dataset.characterId=item.id;Object.assign(events.style,{position:'absolute',left:'0',width:'100%',top:`${item.top}px`,height:'20px',pointerEvents:'none',zIndex:'2'});
        for(const expressionEvent of item.events){const marker=document.createElement('span');marker.className='timeline-expression-marker';marker.dataset.kind='expressionEvents';marker.dataset.id=expressionEvent.id;marker.dataset.characterId=item.id;marker.dataset.startFrame=expressionEvent.frame;marker.title=`${expressionEvent.label} · ${formatTimelineNumber(expressionEvent.frame)}帧（表情事件独立于显隐）`;marker.setAttribute('aria-label',marker.title);marker.style.left=`${expressionEvent.frame/extent*100}%`;marker.style.pointerEvents='auto';events.appendChild(marker);}lane.appendChild(events);continue;
      }
      if(item.group){
        const group=document.createElement('div');group.className='timeline-group';group.dataset.groupId=item.id;group.style.left=`${item.startFrame/extent*100}%`;group.style.width=`${(item.endFrame-item.startFrame)/extent*100}%`;group.style.top=`${item.top}px`;
        const header=document.createElement('button');header.type='button';header.className='timeline-group-header';header.dataset.kind='dialogueGroups';header.dataset.id=item.id;header.dataset.startFrame=item.startFrame;header.textContent=`对白组 · ${item.children.length}页 · ${item.label}`;header.title=header.textContent;group.appendChild(header);
        for(const edge of ['start','end']){const handle=document.createElement('span');handle.className=`timeline-handle-${edge} timeline-group-edge`;handle.dataset.kind='dialogueGroups';handle.dataset.id=item.id;handle.dataset.startFrame=item.startFrame;handle.title=edge==='start'?'调整整组开始':'调整整组结束';group.appendChild(handle);}
        for(const page of item.children){const child=document.createElement('button');child.type='button';child.className='timeline-item timeline-page';child.dataset.kind='pages';child.dataset.id=item.id;child.dataset.pageId=page.id;child.dataset.startFrame=page.startFrame;child.textContent=page.label;child.title=`${page.label}: ${page.startFrame}–${page.endFrame}`;child.style.left=`${(page.startFrame-item.startFrame)/(item.endFrame-item.startFrame)*100}%`;child.style.width=`${(page.endFrame-page.startFrame)/(item.endFrame-item.startFrame)*100}%`;if(page!==item.children[item.children.length-1]){const divider=document.createElement('span');divider.className='timeline-divider';divider.title='拖动调整相邻两页分界';child.appendChild(divider);}group.appendChild(child);}
        lane.appendChild(group);continue;
      }
      const button = document.createElement('button'); button.type = 'button';
      button.className = 'timeline-item' + (item.warning ? ' warning' : '');
      button.dataset.kind = track.kind; button.dataset.id = item.id;if(item.dialogueId)button.dataset.dialogueId=item.dialogueId;button.dataset.startFrame=item.startFrame;if(track.laneKey)button.dataset.laneKey=track.laneKey;if(item.bindingMode)button.dataset.bindingMode=item.bindingMode;
      button.textContent = item.label;
      const voice=track.kind==='audio'?project.scene.dialogues.find(d=>d.id===item.id)?.voice:null;
      const audioSource=['audio','audioTracks','voiceClips'].includes(track.kind)?{durationSamples:project.resources.find(r=>r.id===item.resourceId)?.durationSamples??voice?.sourceDurationSamples}:null;
      if (!['voiceClips','components'].includes(track.kind) && ((!['audio','audioTracks'].includes(track.kind)) || (Number.isSafeInteger(audioSource?.durationSamples)&&(track.kind!=='audio'||item.bindingMode==='independent')))) {
        const startHandle = document.createElement('span'); startHandle.className = 'timeline-handle-start'; startHandle.setAttribute('aria-hidden', 'true');
        const endHandle = document.createElement('span'); endHandle.className = 'timeline-handle-end'; endHandle.setAttribute('aria-hidden', 'true');
        button.prepend(startHandle); button.append(endHandle);
      }
      button.title = `${item.label}: ${formatTimelineNumber(item.startFrame)}–${formatTimelineNumber(item.endFrame)}${item.warning ? '\n' + item.warning : ''}`;
      if(track.kind==='audio')button.title+='\n'+(item.bindingMode==='follow'?'绑定中：先解绑定再独立移动/裁剪。':'独立配音：可移动，已知源总长时可裁剪。');
      if(track.kind==='audioTracks')button.title+='\n'+(Number.isSafeInteger(audioSource?.durationSamples)?'拖动中间移动；拖动两端裁剪/恢复原音频，不变速。':'源文件总时长未知：仅可移动，不能裁剪。');
      button.style.left = `${formatTimelineNumber(Math.max(0, item.startFrame / extent * 100))}%`;
      button.style.width = `${formatTimelineNumber(Math.max(0, (item.endFrame - item.startFrame) / extent * 100))}%`;
      button.style.top = `${item.top}px`;
      if(track.kind==='characters' && Array.isArray(item.events)) { button.dataset.characterId=item.id; for(const expressionEvent of item.events) { const marker=document.createElement('span'); marker.className='timeline-expression-marker'; marker.dataset.kind='expressionEvents'; marker.dataset.id=expressionEvent.id; marker.dataset.characterId=item.id; marker.dataset.startFrame=expressionEvent.frame; marker.title=`${expressionEvent.label} · ${formatTimelineNumber(expressionEvent.frame)}帧`; marker.setAttribute('aria-label',marker.title); marker.style.left=`${Math.max(0,Math.min(100,(expressionEvent.frame-item.startFrame)/Math.max(1,item.endFrame-item.startFrame)*100))}%`; button.appendChild(marker); } }
       if (['audioTracks','audio','voiceClips'].includes(track.kind)) {
         const waveformUrl = resourceUrls?.[item.resourceId];
         button.dataset.waveformKey = JSON.stringify([waveformUrl || '', item.sourceOffsetSamples ?? 0, item.durationSamples]);
         const resource = project.resources.find(r => r.id === item.resourceId);
          lane.appendChild(button); renderWaveform(button, waveformUrl, button.dataset.waveformKey, item.sourceOffsetSamples ?? 0, item.durationSamples, {sourceDurationSamples:resource?.durationSamples,channels:resource?.channels,sourceBytes:resource?.size});
       } else lane.appendChild(button);
    }
    if(track.kind==='components')imageTrackNodes=[label,lane];else timelineTracks.append(label, lane);if(track.kind==='characters')characterEventSublanes?.appendTo(timelineTracks,project,track.items,extent);
  }
  for(const [kind,text] of [['background','背景']] ){const label=document.createElement('div');label.className='timeline-label';label.textContent=text;label.title='拖入图片创建背景切换';const lane=document.createElement('div');lane.className='timeline-lane';lane.dataset.mediaDropKind=kind;lane.style.height='28px';lane.setAttribute('aria-label',text);if(kind==='background')for(const e of project.scene.backgroundEvents||[]){const marker=document.createElement('button');marker.type='button';marker.className='timeline-expression-marker';marker.dataset.kind='backgroundEvents';marker.dataset.id=e.id;marker.dataset.startFrame=e.frame;marker.style.left=`${e.frame/extent*100}%`;marker.title=`${e.frame}帧 · ${e.background.resourceId||e.background.color}`;marker.setAttribute('aria-label',marker.title);lane.append(marker);}timelineTracks.append(label,lane);}
  if(imageTrackNodes)timelineTracks.append(...imageTrackNodes);
  timeline.dataset.extent = extent;
  const scrollViewport=document.querySelector('#timeline-scroll');if(scrollViewport)scrollViewport.dataset.extent=extent;
  timelineWarnings.textContent = model.warnings.join('\n');
  if(timelineSelection&&!Array.from(timelineTracks.querySelectorAll('[data-kind][data-id]')).some(n=>n.dataset.kind===timelineSelection.kind&&n.dataset.id===timelineSelection.id&&(n.dataset.pageId||null)===(timelineSelection.pageId||null)))timelineSelection=null;
  syncTimelineSelection();
  syncTransportFrame(Number(frame.value));
  return model;
}
// One delegated handler handles both items and empty track/ruler space.
timeline.onclick = async event => {
  if (suppressTimelineClick) { suppressTimelineClick = false; return; }
  if (!current || event.target.closest('#timeline-toolbar')) return;
  pausePlayback();
  const item = event.target.closest('[data-kind][data-id]');
  if (item) {
    selectTimelineItem(item);return;
  }
  if(!event.target.closest('#timeline-ruler'))return;
  const extent = Number(timeline.dataset.extent);
  frame.value = Math.min(Math.max(0, current.project.scene.durationFrames - 1), timelineFrameAt(event.clientX, timelineRuler.getBoundingClientRect(), extent));
  document.querySelector('#scrub').value = frame.value;
  syncTransportFrame(Number(frame.value));
  try { await locate(); } catch (error) { log.textContent = `错误：${error.message}`; }
};
timeline.ondblclick=async event=>{const item=event.target.closest('[data-kind][data-id]');if(!item||!current||!selectTimelineItem(item))return;pausePlayback();syncTransportFrame(Number(item.dataset.startFrame));await locate();};
let timelineSplitBusy=false;
async function splitTimelineSelection(){
 if(timelineSplitBusy)return;
 timelineSplitBusy=true;syncTimelineSelection();
 try {
 if(!current||!timelineSelection||!['dialogues','pages','dialogueGroups','audioTracks','audio','voiceClips'].includes(timelineSelection.kind))throw Error('先选择对白、页、对白组或独立音轨。');
  if(timelineSelection.kind==='audioTracks'){const at=Number(frame.value),track=current.project.scene.audioTracks.find(x=>x.id===timelineSelection.id);if(!track)throw Error('选中音轨已不存在。');if(!Number.isSafeInteger(at)||at<=track.startFrame||at*48000/current.project.design.fps>=track.startFrame*48000/current.project.design.fps+track.durationSamples)throw Error('播放头必须严格位于独立音轨内部。');if(!allowAudioDiscard())return;const identity={documentId:current.documentId};const result=await window.replay.splitAudioTrack(track.id,at);if(identity.documentId!==current.documentId)return;selectedAudioTrackId=result.id;timelineSelection={kind:'audioTracks',id:result.id,pageId:null};await locate();log.textContent='已在播放头切分并选中右段；共享原素材，源文件未修改。';return;}
 if(['audio','voiceClips'].includes(timelineSelection.kind)){const selected={...timelineSelection},envelope=commandEnvelope(),atFrame=Number(frame.value),dialogueId=selected.dialogueId||selected.id;if(!await prepareProductionMutation())return;if(current.documentId!==envelope.documentId||current.revision!==envelope.expectedRevision)throw Error('配音切分期间工程已改变');const result=checkedResult(await replay.splitVoiceClip({...envelope,dialogueId,clipId:selected.kind==='audio'?null:selected.id,atFrame}));await locate();if(current.documentId!==envelope.documentId)return;voiceClipEditor.select(result.created.dialogueId,result.created.clipId);log.textContent='配音已切分，保留对白关联与字幕；选中右段。版本2工程需另存副本。';return;}
 const selected={...timelineSelection},d=current.project.scene.dialogues.find(d=>d.id===selected.id),at=Number(frame.value);
 if(!d)throw Error('选中对白已不存在。');
 const page=d.pages?(selected.kind==='pages'?d.pages.find(p=>p.id===selected.pageId):d.pages.find(p=>at>p.startFrame&&at<p.endFrame)):d;
 if(!page||!Number.isSafeInteger(at)||at<=page.startFrame||at>=page.endFrame)throw Error('播放头必须严格位于所选页内部，不能在页边界切分。');
 if(!allowPageDiscard())return;
 const identity={documentId:current.documentId,revision:current.revision,serial:pageSerial};
 await pagePublishing;
 if(identity.documentId!==current.documentId||identity.revision!==current.revision||identity.serial!==pageSerial)throw Error('工程或表单已改变，切分已取消。');
 const result=await window.replay.addDialoguePage(d.id,{...(d.pages?{afterPageId:page.id}:{}),splitFrame:at});
 if(identity.documentId!==current.documentId)return;
 if(identity.serial===pageSerial){selectedDialogueId=d.id;selectedDialoguePageId=result.pageId;timelineSelection={kind:'pages',id:d.id,pageId:result.pageId};}
 await locate();log.textContent='已在播放头切分；原文字复制到两页，配音保持连续。';
 } finally {timelineSplitBusy=false;syncTimelineSelection();}
}
document.querySelector('#timeline-split').onclick=async()=>{try{pausePlayback();await splitTimelineSelection();}catch(e){log.textContent='错误：'+e.message;}};
document.addEventListener('keydown',event=>{if(event.code!=='KeyS'&&event.key?.toLowerCase()!=='s')return;if(event.repeat||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey||event.isComposing||event.defaultPrevented)return;const t=event.target;if(t?.closest('input,textarea,select,[contenteditable]')||t?.isContentEditable||(t?.closest('button')&&!t.closest('.timeline-item,.timeline-group-header')))return;event.preventDefault();document.querySelector('#timeline-split').onclick();});
window.timelineTest = {buildTimelineModel, timelineFrameAt, calculateTimelineDrag, render: renderTimeline,
  pointerDown: timelinePointerDown, pointerMove: timelinePointerMove, pointerUp: timelinePointerUp, cancel: cancelTimelineDrag,
  get model() { return timelineModel; }, get extent() { return Number(timeline.dataset.extent); }};
const sceneRenderer = window.sceneRenderer = createSceneRenderer(stage, {onVideoError: handleVideoError});
let current;
let videoRenderIdentity;
function renderPreviewScene(state, project, resourceUrls) {
  videoRenderIdentity = {project, state, documentId: current?.documentId};
  sceneRenderer.render(state, project, resourceUrls);
}
function handleVideoError(error, target) {
  const identity = videoRenderIdentity;
  if (!identity || !current || target.project !== identity.project || target.state !== identity.state ||
      current.project !== identity.project || current.documentId !== identity.documentId) return;
  pausePlayback();
  log.textContent = `视频错误：${error.message || error}（素材 ${target.active.resourceId}，源帧 ${target.active.localFrame}）。播放已暂停；修复后可重新定位重试。`;
}
let externalFileDrop=null;
let productionAssets=null,productionDrop=null,mediaDrop=null,backgroundEditor=null,voiceClipEditor=null,componentEditor=null,characterLibraryEditor=null,textImportEditor=null,scriptPreflightEditor=null,dialogueReadingEditor=null,s3Drop=null,characterClipEditor=null,performanceEditor=null,characterRowEditor=null,characterEventSublanes=null,scenePerformanceEditor=null;
let extensionPublishing=Promise.resolve(),s3Publishing=Promise.resolve(),performancePublishing=Promise.resolve(),scenePerformancePublishing=Promise.resolve();
const scenePerformanceHelp='场景演出参数：角色范围仅 opacity 联动；既有位置、显隐、表情帧仍绝对定位。标题不自动缩字；溢出允许保存，但禁止提交标题及导出。';
let titleLayoutProbe;
function measureSceneTitle(title,design=current?.project?.design){
 if(!window.TitleLayout?.createTitleLayoutProbe)throw Error('标题量测组件未加载，无法验证标题是否溢出。');
 titleLayoutProbe ||= window.TitleLayout.createTitleLayoutProbe(document);
 return titleLayoutProbe.measure(title,design);
}
function publishScenePerformanceDraft(){if(!current)return scenePerformancePublishing;const payload={documentId:current.documentId,dirty:!!scenePerformanceEditor?.dirty};scenePerformancePublishing=scenePerformancePublishing.catch(()=>{}).then(()=>window.replay.updateScenePerformanceDraftStatus(payload));scenePerformancePublishing.catch(e=>{log.textContent='场景演出草稿同步失败：'+e.message;});return scenePerformancePublishing;}
function captureScenePerformance(){return {documentId:current?.documentId,revision:current?.revision,serial:scenePerformanceEditor?.serial};}
function assertScenePerformance(captured){if(captured.documentId!==current?.documentId||captured.revision!==current?.revision||captured.serial!==scenePerformanceEditor?.serial)throw Error('等待期间工程或场景演出表单已改变，操作取消。');}
async function settleScenePerformance({allowDirty=false}={}){
 const captured=captureScenePerformance();
 if(scenePerformanceEditor?.busy)throw Error('场景演出参数正在提交，请稍候。');
 await scenePerformanceEditor?.publishing;await publishScenePerformanceDraft();
 assertScenePerformance(captured);
 if(scenePerformanceEditor?.busy||(!allowDirty&&scenePerformanceEditor?.dirty))throw Error('场景演出参数有未应用修改，请先应用或明确放弃。');
 return captured;
}
async function checkSceneTitles({rejectOverflow=false}={}){
 const captured=captureScenePerformance(),project=current?.project;
 const problems=[];
 for(const title of project?.scene?.performance?.titles||[]){
  const measured=await measureSceneTitle(title,project.design);assertScenePerformance(captured);
  if(!measured?.fits)problems.push(`标题 ${title.id||'（无ID）'}「${title.text||title.title||''}」`);
 }
 if(problems.length){const message='标题溢出：'+problems.join('；')+'。请缩短文字或调整标题样式；不会自动缩字。';if(rejectOverflow)throw Error(message+' 导出已拒绝。');return ' 警告：'+message+' 工程仍可保存，导出前必须修正。';}
 return '';
}
function publishPerformanceDraft(){if(!current)return performancePublishing;const payload={documentId:current.documentId,dirty:!!performanceEditor?.dirty};performancePublishing=performancePublishing.catch(()=>{}).then(()=>replay.updatePerformanceDraftStatus(payload));performancePublishing.catch(e=>{log.textContent='角色事件草稿同步失败：'+e.message;});return performancePublishing;}
function publishS3Draft(){if(!current)return s3Publishing;const payload={documentId:current.documentId,characterDefinitionDirty:!!characterLibraryEditor?.dirty,textImportDirty:!!textImportEditor?.dirty};s3Publishing=s3Publishing.catch(()=>{}).then(()=>replay.updateS3DraftStatus(payload));s3Publishing.catch(e=>{log.textContent='角色/文本草稿状态同步失败：'+e.message;});return s3Publishing;}
function publishExtensionDraft(){if(!current)return extensionPublishing;const payload={documentId:current.documentId,voiceClipDirty:!!voiceClipEditor?.dirty,componentDirty:!!componentEditor?.dirty};extensionPublishing=extensionPublishing.catch(()=>{}).then(()=>replay.updateExtensionDraftStatus(payload));extensionPublishing.catch(e=>{log.textContent='扩展草稿状态同步失败：'+e.message;});return extensionPublishing;}
let voiceBusy = false;
let imageBusy = false;
let selectedCharacterId = null;
let selectedDialogueId = null, selectedAudioTrackId = null;
function selectedAudioTrack(project) { return (project?.scene?.audioTracks || []).find(a => a.id === selectedAudioTrackId); }
let audioFormBinding=null,audioEditSerial=0;
for(const input of [audioTrackName,audioTrackStart,audioTrackGain])input.addEventListener('input',()=>{audioEditSerial++;});
function audioFormDirty(){return audioFormBinding&&[audioTrackName.value,String(audioTrackStart.value),String(audioTrackGain.value)].join('\u0000')!==audioFormBinding.values;}
function allowAudioDiscard(){if(!audioFormDirty())return true;if(!window.confirm('音轨有未应用的名称、开始帧或增益修改，确定放弃吗？'))return false;audioFormBinding=null;return true;}
function syncAudioTrackEditor(project) {
  const keep=audioFormDirty()&&audioFormBinding.documentId===current?.documentId&&audioFormBinding.id===selectedAudioTrackId;
  if(audioFormBinding?.id!==selectedAudioTrackId||audioFormBinding?.documentId!==current?.documentId)audioTrackDeleteConfirm.checked=false;
  const tracks = project?.scene?.audioTracks || []; if (!tracks.some(a => a.id === selectedAudioTrackId)) selectedAudioTrackId = tracks[0]?.id || null;
  const wanted=new Set(tracks.map(a=>a.id));for(const option of Array.from(audioTrackSelect.options))if(!wanted.has(option.value))option.remove();tracks.forEach((a,i)=>{let o=Array.from(audioTrackSelect.options).find(o=>o.value===a.id);if(!o){o=document.createElement('option');o.value=a.id;}o.textContent=a.name||a.id;if(audioTrackSelect.options[i]!==o)audioTrackSelect.insertBefore(o,audioTrackSelect.options[i]||null);});if(audioTrackSelect.value!==(selectedAudioTrackId||''))audioTrackSelect.value=selectedAudioTrackId||'';
  const a = selectedAudioTrack(project), disabled = !a; audioTrackSelect.disabled = !tracks.length; audioTrackKind.disabled = false; audioTrackName.disabled = audioTrackGain.disabled = audioTrackApply.disabled = disabled; audioTrackStart.disabled = false; audioTrackDeleteConfirm.disabled = disabled; audioTrackDelete.disabled = disabled || !audioTrackDeleteConfirm.checked; if(!keep){audioTrackName.value = a?.name || ''; audioTrackStart.value = a?.startFrame ?? 0; audioTrackGain.value = a?.gain ?? 1;audioFormBinding={id:selectedAudioTrackId,documentId:current?.documentId,revision:current?.revision,values:[audioTrackName.value,String(audioTrackStart.value),String(audioTrackGain.value)].join('\u0000')};} if (a) audioTrackKind.value = a.kind || 'sfx'; audioTrackImport.disabled = !project?.scene;
  const total=project?.resources?.find(r=>r.id===a?.resourceId)?.durationSamples;
  document.querySelector('#audio-track-timing-info').textContent=a?`场景开始 ${a.startFrame} 帧 · 源偏移 ${formatTimelineNumber((a.sourceOffsetSamples??0)/48000)} 秒 · 播放 ${formatTimelineNumber(a.durationSamples/48000)} 秒 · 源总长 ${Number.isSafeInteger(total)?formatTimelineNumber(total/48000)+' 秒':'未知（仅可移动）'}`:'未选择音轨';
}
let playbackGeneration = 0, framePending = false, pendingFrame = null;
let videoPlaybackStartBusy = false;
async function startPreparedPlayback(start, options) {
  if (!current || videoPlaybackStartBusy) return;
  const packet = current, project = packet.project, documentId = packet.documentId, revision = packet.revision;
  const generation = ++playbackGeneration;
  videoPlaybackStartBusy = true;
  try {
    if (project.scene.videoClips?.length) {
      if (typeof window.replay.prepareVideo !== 'function') throw Error('视频预热接口不可用');
      log.textContent = '正在预解码场景视频，完成前不会启动播放时钟…';
      await window.replay.prepareVideo();
    }
    if (generation !== playbackGeneration || current !== packet || current.project !== project || current.documentId !== documentId || current.revision !== revision) return;
    if (project.scene.videoClips?.length) log.textContent = '场景视频预解码完成，正在启动播放。';
    await playback.play(project, packet.resourceUrls, start, options);
  } finally { videoPlaybackStartBusy = false; }
}
const playback = window.playbackController = createPlaybackController({
  onFrame: value => { syncTransportFrame(value); pendingFrame = value; pumpPlaybackFrame(); },
  onState: state => { document.querySelector('#playback-status').textContent = state;componentEditor?.render(current); },
  onError: error => { log.textContent = `播放错误：${error.message || error}`; }
});
async function pumpPlaybackFrame() {
  if (framePending || pendingFrame === null) return;
  const value = pendingFrame, generation = playbackGeneration; pendingFrame = null; framePending = true;
  try { const state = await window.replay.evaluate(value); if (generation === playbackGeneration && current) { renderPreviewScene(state, current.project, current.resourceUrls); current.state = state; productionAssets?.render(current); } }
  catch (error) { pausePlayback(); log.textContent = `播放错误：${error.message}`; }
  finally { framePending = false; if (pendingFrame !== null) pumpPlaybackFrame(); }
}
function pausePlayback() { playback.pause(); playbackGeneration++; pendingFrame = null; }

function characterReadView(project, id) { return project && typeof CharacterDefinitions !== 'undefined' ? CharacterDefinitions.resolveCharacter(project, id) : (project?.scene?.characters || []).find(c => c.id === id); }
function selectedCharacter(project) { return characterReadView(project, selectedCharacterId); }
function dialogueSpeakerName(project, speaker) {
  if(speaker.id==='narrator')return '旁白';
  if(typeof CharacterDefinitions!=='undefined'&&typeof CharacterDefinitions.getDialogueSpeakerName==='function')return CharacterDefinitions.getDialogueSpeakerName(project,{speakerId:speaker.id});
  return speaker.name||speaker.id;
}
function requireLegacyCharacterAppearance() { if([3,4].includes(current?.project?.schemaVersion))throw Error('角色名称、基础立绘、画布与表情定义请到“角色模板”页编辑；这里仅编辑场景实例与表情事件。'); }
function syncLegacyAppearanceControls() { if(![3,4].includes(current?.project?.schemaVersion))return;for(const id of ['character-name','character-import','character-unbind','expression-name','expression-resource','expression-mode','expression-add','expression-apply','expression-delete','expression-delete-confirm','expression-import','portrait-canvas-width','portrait-canvas-height','portrait-canvas-apply','layer-import','layer-add','layer-remove','layer-native','layer-up','layer-down','layer-resource','layer-x','layer-y','layer-width','layer-height']){const el=document.getElementById(id);if(el){el.disabled=true;el.title='请到角色模板页编辑共享外观定义';}}draftStatus.textContent='外观定义只读：请到角色模板页编辑名称、立绘、画布与表情；下方表情事件仍属于当前场景实例。'; }
// Inspector-only view: independent of frame visibility and never edits the project.
function syncCharacterPreview(project) {
  const character = selectedCharacter(project);
  const resource = (project?.resources || []).find(r => r.id === character?.resourceId);
  const url = resource && current?.resourceUrls?.[resource.id];
  const key = JSON.stringify([character?.id, character?.name, character?.resourceId, resource?.width, resource?.height, url]);
  if (key === portraitKey) return;
  portraitKey = key;
  // Detach the previous image immediately; late events cannot restore it.
  characterPreview.replaceChildren();
  const dimensions = resource?.width && resource?.height ? `${resource.width} × ${resource.height}` : '尺寸未知';
  const metadata = character?.resourceId ? `${character.resourceId} · 素材尺寸：${dimensions}` : '';
  characterPreviewInfo.textContent = metadata;
  if (!character || !character.resourceId || !resource || !url) {
    const message = !character ? '未选择角色' : !character.resourceId ? '未绑定立绘' : !resource ? '立绘资源不存在' : '立绘资源 URL 不可用';
    characterPreview.textContent = message;
    characterPreviewInfo.textContent = [metadata, message].filter(Boolean).join('\n');
    return;
  }
  const image = document.createElement('img');
  image.alt = `${character.name || character.id} · 立绘预览`;
  const loading = document.createElement('span'); loading.textContent = '正在加载立绘…';
  characterPreview.appendChild(loading);
  image.onload = () => {
    if (portraitKey !== key || !loading.isConnected) return;
    characterPreview.replaceChildren(image);
    characterPreviewInfo.textContent = `${metadata}\n图像原始尺寸：${image.naturalWidth} × ${image.naturalHeight}`;
  };
  image.onerror = () => {
    if (portraitKey !== key || !loading.isConnected) return;
    image.removeAttribute('src');
    characterPreview.textContent = '立绘加载失败';
    characterPreviewInfo.textContent = `${metadata}\n立绘加载失败，请检查素材文件。`;
  };
  image.src = url;
}
const expressionSelect = document.querySelector('#expression-select'), expressionResource = document.querySelector('#expression-resource'), expressionName = document.querySelector('#expression-name');
const expressionConfirm = document.querySelector('#expression-delete-confirm'), expressionPreview = document.querySelector('#expression-preview'), expressionPreviewInfo = document.querySelector('#expression-preview-info');
const eventSelect = document.querySelector('#event-select'), eventFrame = document.querySelector('#event-frame'), eventExpression = document.querySelector('#event-expression');
let selectedExpressionId = null, selectedEventId = null, expressionCharacterId = null, expressionPreviewKey = null;
const expressionMode = document.querySelector('#expression-mode'), draftStatus = document.querySelector('#expression-draft-status');
const layerSelect = document.querySelector('#layer-select'), layerResource = document.querySelector('#layer-resource');
const canvasWidth = document.querySelector('#portrait-canvas-width'), canvasHeight = document.querySelector('#portrait-canvas-height');
const layerInputs = Object.fromEntries(['x','y','width','height'].map(key => [key, document.querySelector('#layer-' + key)]));
let expressionLayers = [], selectedLayerId = null, expressionDirty = false, canvasDirty = false, layerSequence = 0, canvasGeneration = 0;
let expressionDocumentId, expressionBaseRevision = null, expressionStale = false, expressionDraftPublishing = Promise.resolve(), expressionEditSerial = 0, expressionPublishedKey = null;
function hasExpressionDraft() { return expressionDirty || canvasDirty; }
function publishExpressionDraft() {
  if (!window.replay.updateExpressionDraftStatus || !current) return;
  const status = {dirty:hasExpressionDraft()||!!eventFormDraft,documentId:current.documentId};
  const key = JSON.stringify([status.documentId,status.dirty,expressionEditSerial]); if (key === expressionPublishedKey) return; expressionPublishedKey = key;
  expressionDraftPublishing = expressionDraftPublishing.catch(()=>{}).then(()=>window.replay.updateExpressionDraftStatus(status)).catch(error=>{ log.textContent = `表情草稿状态同步失败：${error.message}`; });
}
function expressionDraftStatus() {
  draftStatus.textContent = expressionStale ? '工程版本已变化；本地表情/画布草稿已保留，但不可应用。请先保留需要的数据，再点击“丢弃草稿并重新加载”。' : hasExpressionDraft() ? '有未应用的本地表情/画布草稿；定位和保存工程不会清除。请应用，或明确丢弃。未应用表单不自动恢复。' : '表单已同步；修改后请应用表情或确认画布。';
  const disabled = expressionStale || !selectedCharacter(current?.project) || imageBusy;
  for (const id of ['expression-add','portrait-canvas-apply','expression-import','layer-import']) document.getElementById(id).disabled = disabled;
  document.querySelector('#expression-apply').disabled = disabled || !selectedExpressionId;
  document.querySelector('#expression-discard').disabled = !hasExpressionDraft() && !expressionStale && !eventFormDraft;
  syncLegacyAppearanceControls();publishExpressionDraft();
}
function clearExpressionDraft() { if (hasExpressionDraft() || expressionStale) ++expressionEditSerial; expressionDirty = canvasDirty = expressionStale = false; expressionBaseRevision = current?.revision; ++canvasGeneration; }
let eventFormDraft = null;
function allowEventDiscard(){if(!eventFormDraft)return true;if(!window.confirm('有未应用的表情事件属性，确定放弃吗？'))return false;eventFormDraft=null;return true;}
function allowExpressionSelection() {
  if (!hasExpressionDraft()&&!eventFormDraft) return true;
  if (!window.confirm('存在未应用的表情、画布或事件草稿。确定全部丢弃并切换吗？')) return false;
  eventFormDraft=null;clearExpressionDraft();publishExpressionDraft();return true;
}
function assertExpressionFresh() { if (expressionStale || (hasExpressionDraft() && expressionBaseRevision !== current?.revision)) throw Error('工程版本已变化，请先丢弃草稿并重新加载。'); }
function rebaseExpressionDraft() { expressionBaseRevision = current.revision; expressionStale = false; expressionDraftStatus(); }
const intrinsicSizes = new Map();
function imageDimensions(id) { const r = current?.project.resources.find(r => r.id === id); return r?.width && r?.height ? r : intrinsicSizes.get(current?.resourceUrls?.[id]); }
async function decodeDimensions(id) {
  const known = imageDimensions(id); if (known) return known;
  const url = current?.resourceUrls?.[id]; if (!url) throw Error('图片 URL 不可用');
  const image = new Image(); image.src = url; await image.decode();
  const size = {width:image.naturalWidth, height:image.naturalHeight}; intrinsicSizes.set(url, size); return size;
}
function markExpressionDraft() { requireLegacyCharacterAppearance(); expressionDirty = true; ++expressionEditSerial; ++canvasGeneration; expressionDraftStatus(); syncExpressionPreview(); }
function selectedLayer() { return expressionLayers.find(l => l.id === selectedLayerId); }
function syncLayerControls() {
  fillExpressionOptions(layerSelect, expressionLayers.map((l,i) => ({id:l.id,name:`${i+1}. ${l.id} · ${l.resourceId}`})), selectedLayerId);
  const layer = selectedLayer(), index = expressionLayers.indexOf(layer);
  layerResource.value = layer?.resourceId || layerResource.options[0]?.value || '';
  for (const [key,input] of Object.entries(layerInputs)) { input.value = layer?.[key] ?? ''; input.disabled = !layer; }
  layerResource.disabled = !layer; layerSelect.disabled = !expressionLayers.length;
  document.querySelector('#layer-remove').disabled = document.querySelector('#layer-native').disabled = !layer;
  document.querySelector('#layer-up').disabled = !layer || index <= 0;
  document.querySelector('#layer-down').disabled = !layer || index >= expressionLayers.length - 1;
  const size = imageDimensions(layer?.resourceId);
  document.querySelector('#layer-native-info').textContent = size ? `原始尺寸：${size.width} × ${size.height}` : '原始尺寸未知；可点击“使用图片原始尺寸”解码读取。';
  document.querySelector('#overlay-editor').hidden = expressionMode.value !== 'overlay';
  syncExpressionPreview();syncLegacyAppearanceControls();
}
function expressionPayload() {
  if (canvasDirty) throw Error('请先确认画布修改，或丢弃草稿。');
  if (expressionMode.value !== 'overlay') return {name:expressionName.value, mode:'replace', resourceId:expressionResource.value};
  if (!selectedCharacter(current?.project)?.portraitCanvas || canvasDirty) throw Error('请先点击“确认保存画布”，再应用叠加表情。');
  if (!expressionLayers.length) throw Error('请至少添加一个图层。');
  for (const layer of expressionLayers) if (!layer.resourceId || !['x','y','width','height'].every(k => Number.isFinite(layer[k])) || layer.width <= 0 || layer.height <= 0) throw Error('图层需要图片、有限坐标及正数宽高。');
  return {name:expressionName.value, mode:'overlay', layers:expressionLayers.map(l => ({...l}))};
}
function syncPortraitCanvas(character) {
  const generation = ++canvasGeneration; canvasDirty = false;
  const size = character?.portraitCanvas || imageDimensions(character?.resourceId);
  canvasWidth.value = size?.width ?? ''; canvasHeight.value = size?.height ?? '';
  const status = document.querySelector('#portrait-canvas-status');
  status.textContent = character?.portraitCanvas ? '已确认保存的画布。' : '建议尺寸尚未保存；叠加前必须确认保存画布。';
  if (!size && character?.resourceId) decodeDimensions(character.resourceId).then(size => {
    if (generation !== canvasGeneration || canvasDirty) return;
    canvasWidth.value = size.width; canvasHeight.value = size.height;
    status.textContent = '已读取基础图片原始尺寸；请确认保存画布。';
  }).catch(() => { if (generation === canvasGeneration) status.textContent = '无法读取基础图片尺寸，请手动填写并确认保存。'; });
}
function fillExpressionOptions(select, entries, value) {
  select.replaceChildren(...entries.map(entry => { const option = document.createElement('option'); option.value = entry.id; option.textContent = entry.name || entry.id; return option; }));
  select.value = value || '';
}
function syncExpressionPreview() {
  if (expressionMode.value === 'overlay') {
    expressionPreviewKey = null; expressionPreview.replaceChildren();
    const character = selectedCharacter(current?.project);
    if (!character?.portraitCanvas) { expressionPreview.textContent = '请先确认保存立绘画布'; expressionPreviewInfo.textContent = '叠加候选（本地草稿）'; return; }
    const group = document.createElement('div'); group.style.cssText = 'position:relative;width:240px;height:220px;flex:none'; expressionPreview.appendChild(group);
    renderPortrait(group, {...character, width:240, height:220, portraitLayers:expressionLayers.map(l => ({...l}))}, {width:240, height:220, imageUrl:id => current?.resourceUrls?.[id]});
    for (const node of group.querySelectorAll('[data-layer-id]')) node.classList.toggle('selected-layer', node.dataset.layerId === selectedLayerId);
    expressionPreviewInfo.textContent = `叠加候选（${expressionDirty ? '尚未应用' : '已同步'}） · 画布 ${character.portraitCanvas.width} × ${character.portraitCanvas.height}`;
    return;
  }
  const resource = (current?.project?.resources || []).find(r => r.id === expressionResource.value);
  const url = resource && current?.resourceUrls[resource.id];
  const key = JSON.stringify([expressionCharacterId, resource?.id, resource?.width, resource?.height, resource?.name, url]);
  if (key === expressionPreviewKey) return;
  expressionPreviewKey = key; expressionPreview.replaceChildren();
  expressionPreviewInfo.textContent = resource ? `${resource.id} · 素材尺寸：${resource.width && resource.height ? `${resource.width} × ${resource.height}` : '未知'}` : '';
  if (!resource || !url) { expressionPreview.textContent = resource ? '图片 URL 不可用' : '未选择图片'; return; }
  const image = document.createElement('img'); image.alt = '表情候选图片（只读）';
  image.onload = () => { if (key !== expressionPreviewKey || !image.isConnected) return; expressionPreviewInfo.textContent = `${resource.id}\n图像原始尺寸：${image.naturalWidth} × ${image.naturalHeight}`; };
  image.onerror = () => { if (key !== expressionPreviewKey || !image.isConnected) return; expressionPreview.textContent = '图片加载失败'; };
  expressionPreview.appendChild(image); image.src = url;
}
function syncExpressionEvents(project) {
  const character = selectedCharacter(project), expressions=character?.expressions||[],events=character?.expressionEvents||[];
  const owner=document.querySelector('#character-event-owner');if(owner)owner.textContent=character?`当前实例：${character.name} · ${character.id}`:'先在角色页或时间轴选择角色实例';
  const eventStatus=document.querySelector('#character-event-status');if(eventStatus)eventStatus.textContent=eventFormDraft?'此实例有未应用的表情事件修改。':'表情事件只影响当前出场实例，不修改共享模板。';
  const eventDiscard=document.querySelector('#character-event-discard');if(eventDiscard)eventDiscard.disabled=!eventFormDraft;
  if(eventFormDraft&&eventFormDraft.documentId===current?.documentId)return;
  if (!events.some(e=>e.id===selectedEventId)) selectedEventId=events[0]?.id||null;
  const event=events.find(e=>e.id===selectedEventId);
  fillExpressionOptions(eventSelect,[...events].sort((a,b)=>a.frame-b.frame).map(e=>({id:e.id,name:`${e.frame}帧 · ${expressions.find(x=>x.id===e.expressionId)?.name||'基础立绘'}`})),selectedEventId);
  fillExpressionOptions(eventExpression,[{id:'',name:'基础立绘'},...expressions],event?.expressionId);if(event)eventFrame.value=event.frame;
  for(const id of ['#event-apply','#event-delete'])document.querySelector(id).disabled=!event||imageBusy;
}
function syncExpressionEditor(project) {
  if(eventFormDraft&&eventFormDraft.documentId!==current?.documentId)eventFormDraft=null;
  const retainedEventDraft=eventFormDraft?{...eventFormDraft}:null;
  if (hasExpressionDraft() && expressionDocumentId === current?.documentId) {
    if (selectedCharacterId !== expressionCharacterId) {
      if (!project?.scene.characters.some(c=>c.id===expressionCharacterId)) { selectedCharacterId=expressionCharacterId; expressionStale=true; }
      else if (!allowExpressionSelection()) { selectedCharacterId = expressionCharacterId; characterSelect.value = selectedCharacterId || ''; }
    }
    if (hasExpressionDraft()) {
      expressionStale ||= expressionBaseRevision !== current?.revision;
      const images = (project?.resources || []).filter(r=>r.kind==='image');
      const selectedResource = expressionResource.value, selectedLayerResource = layerResource.value;
      fillExpressionOptions(expressionResource, images, selectedResource); fillExpressionOptions(layerResource, images, selectedLayerResource);
      syncExpressionEvents(project); expressionDraftStatus(); syncExpressionPreview(); return;
    }
  }
  clearExpressionDraft(); expressionDocumentId = current?.documentId;
  const character = selectedCharacter(project), expressions = character?.expressions || [], events = character?.expressionEvents || [];
  if (expressionCharacterId !== character?.id) { expressionCharacterId = character?.id; selectedExpressionId = selectedEventId = null; eventFrame.value = Number(frame.value); }
  if (!expressions.some(e => e.id === selectedExpressionId)) selectedExpressionId = expressions[0]?.id || null;
  if (!events.some(e => e.id === selectedEventId)) selectedEventId = events[0]?.id || null;
  const expression = expressions.find(e => e.id === selectedExpressionId), event = events.find(e => e.id === selectedEventId);
  const images = (project?.resources || []).filter(r => r.kind === 'image');
  fillExpressionOptions(expressionSelect, expressions, selectedExpressionId);
  fillExpressionOptions(expressionResource, images.map(r => ({id:r.id, name:`${r.id}${r.path ? ' · ' + r.path : ''}`})), expression?.resourceId || images[0]?.id);
  expressionName.value = expression?.name || '';
  expressionMode.value = expression?.mode || 'replace';
  expressionLayers = (expression?.layers || []).map(layer => ({...layer}));
  selectedLayerId = expressionLayers.some(l => l.id === selectedLayerId) ? selectedLayerId : expressionLayers[0]?.id || null;
  fillExpressionOptions(layerResource, images, selectedLayer()?.resourceId || images[0]?.id);
  syncPortraitCanvas(character);
  for (const id of ['expression-mode','expression-import','layer-import','layer-add','portrait-canvas-width','portrait-canvas-height','portrait-canvas-apply']) document.getElementById(id).disabled = !character || imageBusy;
  syncLayerControls();
  fillExpressionOptions(eventSelect, [...events].sort((a,b) => a.frame-b.frame).map(e => ({id:e.id, name:`${e.frame}帧 · ${expressions.find(x => x.id === e.expressionId)?.name || '基础立绘'}`})), selectedEventId);
  fillExpressionOptions(eventExpression, [{id:'',name:'基础立绘'}, ...expressions], event?.expressionId);
  if (event) eventFrame.value = event.frame;
  eventFrame.max = Math.max(0, (project?.scene.durationFrames || 1) - 1);
  expressionConfirm.checked = false;
  const disabled = !character || imageBusy;
  for (const input of [expressionResource, expressionName, eventFrame, eventExpression, expressionConfirm]) input.disabled = disabled;
  expressionSelect.disabled = disabled || !expressions.length; eventSelect.disabled = disabled || !events.length;
  document.querySelector('#expression-add').disabled = disabled || !images.length;
  document.querySelector('#expression-apply').disabled = disabled || !expression || !images.length;
  document.querySelector('#expression-delete').disabled = true;
  expressionConfirm.disabled = disabled || !expression;
  for (const id of ['#event-add', '#event-current']) document.querySelector(id).disabled = disabled;
  for (const id of ['#event-apply', '#event-delete']) document.querySelector(id).disabled = disabled || !event;
  syncExpressionPreview(); expressionDraftStatus();
  if(retainedEventDraft){eventFrame.value=retainedEventDraft.frame;eventExpression.value=retainedEventDraft.expressionId;const stale=retainedEventDraft.revision!==current.revision||retainedEventDraft.characterId!==selectedCharacterId||retainedEventDraft.eventId!==selectedEventId;document.querySelector('#event-apply').disabled ||= stale;if(stale)draftStatus.textContent='表情事件草稿已过期，内容保留；请放弃后重新编辑。';}
}
expressionSelect.onchange = () => { if (!allowExpressionSelection()) { expressionSelect.value = selectedExpressionId || ''; return; } selectedExpressionId = expressionSelect.value || null; syncExpressionEditor(current?.project); };
document.querySelector('#expression-discard').onclick = () => { if (!allowExpressionSelection()) return; clearExpressionDraft(); syncExpressionEditor(current?.project); };
document.querySelector('#character-event-discard')?.addEventListener('click',()=>{if(!allowEventDiscard())return;publishExpressionDraft();syncExpressionEvents(current?.project);});
document.querySelector('#character-open-events')?.addEventListener('click',()=>editorLayout.showVisualTab('characterEvents'));
document.querySelector('#character-open-appearance')?.addEventListener('click',()=>editorLayout.showVisualTab('characterAppearance'));
document.querySelector('#character-open-library')?.addEventListener('click',()=>{editorLayout.showVisualTab('characterLibrary');const c=selectedCharacter(current?.project);if(c?.definitionId)characterLibraryEditor?.select(c.definitionId);});
document.querySelector('#character-appearance-library')?.addEventListener('click',()=>{editorLayout.showVisualTab('characterLibrary');const c=selectedCharacter(current?.project);if(c?.definitionId)characterLibraryEditor?.select(c.definitionId);});
eventSelect.onchange = () => { const next=eventSelect.value;if(!allowProductionSelection({owner:'character',id:selectedCharacterId,eventId:next})||!allowEventDiscard()){eventSelect.value=selectedEventId||'';return;} selectedEventId = next || null; syncExpressionEditor(current?.project); };
for(const input of [eventFrame,eventExpression])input.addEventListener('input',()=>{if(!current)return;if(!eventFormDraft)eventFormDraft={documentId:current.documentId,revision:current.revision,characterId:selectedCharacterId,eventId:selectedEventId};eventFormDraft.frame=eventFrame.value;eventFormDraft.expressionId=eventExpression.value;++expressionEditSerial;publishExpressionDraft();});
expressionResource.onchange = markExpressionDraft;
expressionName.oninput = markExpressionDraft;
expressionMode.onchange = () => { markExpressionDraft(); syncLayerControls(); };
layerSelect.onchange = () => { selectedLayerId = layerSelect.value; syncLayerControls(); };
layerResource.onchange = () => { const layer = selectedLayer(); if (layer) { layer.resourceId = layerResource.value; markExpressionDraft(); syncLayerControls(); } };
for (const [key,input] of Object.entries(layerInputs)) input.oninput = () => { const layer = selectedLayer(); if (layer) { layer[key] = input.value.trim() === '' ? NaN : Number(input.value); markExpressionDraft(); } };
for (const input of [canvasWidth,canvasHeight]) input.oninput = () => { canvasDirty = true; ++expressionEditSerial; ++canvasGeneration; expressionDraftStatus(); document.querySelector('#portrait-canvas-status').textContent = '画布尺寸尚未保存；确认画布会保留表情草稿。'; };
expressionConfirm.onchange = () => { document.querySelector('#expression-delete').disabled = [3,4].includes(current?.project?.schemaVersion) || !selectedExpressionId || imageBusy || !expressionConfirm.checked; };
function syncImageEditor(project) {
  characterDeleteConfirm.checked = false;
  const characters = (project?.scene?.characters || []).map(c=>characterReadView(project,c.id));
  if (!characters.some(c => c.id === selectedCharacterId)) selectedCharacterId = characters[0]?.id || null;
  characterSelect.textContent = '';
  for (const character of characters) {
    const option = document.createElement('option');
    option.value = character.id;
    option.textContent = character.name ? `${character.name} (${character.id})` : character.id;
    characterSelect.appendChild(option);
  }
  characterSelect.value = selectedCharacterId || '';
  characterSelect.disabled = !characters.length || imageBusy;
  syncExpressionEditor(project);
  characterSelect.value = selectedCharacterId || '';
  const character = selectedCharacter(project);
  syncCharacterPreview(project);
  const background = project?.scene?.background;
  backgroundImport.disabled = !project?.scene || imageBusy;
  backgroundUnbind.disabled = !background?.resourceId || imageBusy;
  characterImport.disabled = !character || imageBusy;
  characterUnbind.disabled = !character?.resourceId || imageBusy;
  backgroundImport.textContent = background?.resourceId ? '替换背景' : '导入背景';
  characterImport.textContent = character?.resourceId ? '替换立绘' : '导入立绘';
  function describe(resourceId) {
    if (!resourceId) return '未绑定';
    const resource = (project?.resources || []).find(r => r.id === resourceId);
    const dimensions = resource?.width && resource?.height ? `${resource.width} × ${resource.height}` : '尺寸未知';
    return `${resourceId} · ${dimensions}${resource?.path ? `\n${resource.path}` : ''}`;
  }
  imageInfo.textContent = `立绘：${character ? describe(character.resourceId) : '未选择角色'}`;
  const backgroundInfo=document.querySelector('#background-image-info');if(backgroundInfo)backgroundInfo.textContent=`初始背景：${describe(background?.resourceId)}`;
  x.value = character ? character.x : '';
  y.value = character ? character.y : '';
  characterName.value = character?.name || '';
  characterWidth.value = character?.width ?? '';
  characterHeight.value = character?.height ?? '';
  characterFrom.value = character?.visibleFrom ?? '';
  characterTo.value = character?.visibleTo ?? '';
  characterAdd.disabled = !project?.scene || imageBusy;
  characterDeleteConfirm.disabled = !character || imageBusy;
  characterDelete.disabled = true;
  for (const input of [x, y, characterName, characterWidth, characterHeight, characterFrom, characterTo]) input.disabled = !character || imageBusy;
  characterApply.disabled = !character || imageBusy;
  document.querySelector('#move').disabled = !character || imageBusy;
  characterAdd.textContent=[3,4].includes(project?.schemaVersion)?'从角色模板添加':'新增角色';
  if([3,4].includes(project?.schemaVersion))imageInfo.textContent+='\n外观来自角色模板；名称、立绘、画布与表情定义请到角色模板页修改。';
  syncLegacyAppearanceControls();performanceEditor?.render(current);characterRowEditor?.render(current);
}
// Keep native select option nodes intact during playback/seek repaints. Replacing
// them while Windows' select popup is open invalidates its pending choice.
function syncDialogueOptions(select, entries) {
  const key=JSON.stringify(entries);
  if(select.dataset.optionsKey===key)return;
  select.dataset.optionsKey=key;
  select.replaceChildren(...entries.map(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;return option;}));
}
let dialogueConfirmationKey = null;
function selectedDialogue(project) { return (project?.scene?.dialogues || []).find(d => d.id === selectedDialogueId); }
function syncDialogueEditor(project) {
  if (pageDraft && pageDraft.documentId !== current?.documentId) clearPageDraft();
  if (pageDraft && selectedDialogueId !== pageDraft.dialogueId) {
    if (!allowPageDiscard()) selectedDialogueId=pageDraft.dialogueId;
  }
  const dialogues = project?.scene?.dialogues || [];
  const stillSelected = dialogues.some(d => d.id === selectedDialogueId);
  if (!stillSelected) selectedDialogueId = dialogues[0]?.id || null;
  syncDialogueOptions(dialogueSelect,dialogues.map(d=>[d.id,d.id]));
  if(dialogueSelect.value !== (selectedDialogueId || '')) dialogueSelect.value = selectedDialogueId || '';
  const d = selectedDialogue(project);
  dialogueReadingEditor?.render();
  const index = d ? dialogues.indexOf(d) : -1;
  const disabled = !d;
  document.querySelector('#range-dialogue').disabled = disabled;
  dialogueSelect.disabled = !dialogues.length;
  dialogueAdd.disabled = !project?.scene;
  dialogueDeleteConfirm.disabled = disabled;
  dialogueSpeaker.textContent = '';
  for (const speaker of [{id: 'narrator', name: '旁白'}, ...(project?.schemaVersion===4?(project.characterDefinitions||[]):(project?.scene?.characters || []).map(c=>characterReadView(project,c.id)))]) {
    const option = document.createElement('option');
    option.value = speaker.id;
    option.textContent = speaker.id === 'narrator' ? '旁白' : `${dialogueSpeakerName(project,speaker)} (${speaker.id})`;
    dialogueSpeaker.appendChild(option);
  }
  dialogueSpeaker.value = d?.speakerId || 'narrator';
  dialogueSpeaker.disabled = dialogueSpeakerApply.disabled = disabled;
  document.querySelector('#voice-import').disabled = disabled || voiceBusy;
  document.querySelector('#voice-unbind').disabled = disabled || !d?.voice || voiceBusy;
  const voice=d?.voice,independent=voice?.binding?.mode==='independent';
   const voiceStart=independent?voice.startFrame:(d?.startFrame||0)+(voice?.binding?.followOffsetFrames||0);
   for(const id of ['voice-binding-independent','voice-binding-preserve','voice-binding-align'])document.querySelector('#'+id).disabled=!voice||voiceBusy||(id==='voice-binding-independent'&&independent);
   document.querySelector('#voice-info').textContent = voice ? `配音：${voice.resourceId} · 关联对白 ${d.id} · ${independent?'已解绑定（独立）':'绑定联动'} · 起点 ${voiceStart} 帧 · 源偏移 ${( (voice.sourceOffsetSamples||0)/48000).toFixed(3)} 秒 · 播放 ${(voice.durationSamples/48000).toFixed(3)} 秒${voiceStart!==d.startFrame||voiceStart>=d.endFrame||voiceStart+voice.durationSamples/48000*project.design.fps<=d.startFrame?' · ⚠ 与对白时间不一致（不自动调整）':''}` : d?.voiceClips?.length ? `配音已分为 ${d.voiceClips.length} 个片段；在“配音”页选择片段编辑。` : '未设置配音';
  for (const input of [dialogueText, dialogueStart, dialogueEnd, dialogueReveal]) input.disabled = disabled;
  document.querySelector('#dialogue-apply').disabled = disabled;
  dialogueDelete.disabled = disabled || !dialogueDeleteConfirm.checked;
  dialogueUp.disabled = disabled || index <= 0;
  dialogueDown.disabled = disabled || index < 0 || index >= dialogues.length - 1;
  const pages=d?.pages || [];
  if (!pages.some(p=>p.id===selectedDialoguePageId)) selectedDialoguePageId=pages[0]?.id || null;
  const sharedNote=document.querySelector('#audio-shared-context-note');if(sharedNote)sharedNote.textContent=d?`当前对白：${d.id}${pages.length?' · 第'+(pages.findIndex(p=>p.id===selectedDialoguePageId)+1)+' / '+pages.length+'页':''}。对白与分页页共用当前文本草稿；配音片段有自己的所属对白选择。`:'先选择或新增对白。';
  syncDialogueOptions(dialoguePageSelect,(pages.length ? pages : [{id:''}]).map((p,i)=>[p.id,pages.length ? `${i+1} · ${p.startFrame}–${p.endFrame}帧` : '默认单页（未分页）']));
  if(dialoguePageSelect.value !== (selectedDialoguePageId||'')) dialoguePageSelect.value=selectedDialoguePageId||'';
  dialoguePageSelect.disabled=disabled;
  const confirmationKey=JSON.stringify([current?.documentId,selectedDialogueId,selectedDialoguePageId]);
  if(dialogueConfirmationKey!==confirmationKey){dialogueConfirmationKey=confirmationKey;dialogueDeleteConfirm.checked=false;document.querySelector('#dialogue-page-delete-confirm').checked=false;dialogueDelete.disabled=true;}
  document.querySelector('#dialogue-page-delete-confirm').disabled=disabled || !pages.length;
  document.querySelector('#dialogue-page-add').disabled=disabled;
  document.querySelector('#dialogue-page-delete').disabled=disabled || !pages.length || !document.querySelector('#dialogue-page-delete-confirm').checked;
  document.querySelector('#dialogue-page-delete').textContent=pages.length===1 ? '恢复默认单页' : '删除页';
  document.querySelector('#dialogue-page-discard').disabled=!pageDraft;
  document.querySelector('#dialogue-apply').textContent=pages.length ? '应用当前页' : '应用对白';
  if (pageDraft) {
    const stale=pageDraft.revision!==current.revision || pageDraft.locale!==project.locale || !d || pageDraft.pageId!==selectedDialoguePageId;
    dialoguePageStatus.textContent=stale ? '工程版本或语言已变化；本地草稿已保留，不可应用。请保留需要的数据，再放弃并重新载入。' : '有未应用的本地对白页修改；定位和保存不会清除。请应用或明确放弃。';
    document.querySelector('#dialogue-apply').disabled=stale;
    document.querySelector('#dialogue-page-add').disabled=true;
    // Deletion remains reachable: its handler explicitly confirms discarding the draft.
    return;
  }
  dialoguePageStatus.textContent=pages.length ? `整段对白 ${d.startFrame}–${d.endFrame}帧，共${pages.length}页。页边界编辑必须维持连续覆盖。` : '默认单页。新增页会在所选页中点拆分；随后可调整前一页结束帧。';
  if (!d) { dialogueText.value = ''; dialogueStart.value = ''; dialogueEnd.value = ''; dialogueReveal.value = ''; return; }
  const page=pages.find(p=>p.id===selectedDialoguePageId)||d;
  dialogueStart.readOnly=pages.length>0;
  dialogueEnd.readOnly=pages.length>0 && pages.indexOf(page)===pages.length-1;
  dialogueText.value = page.text?.[project.locale] || '';
  dialogueStart.value = page.startFrame;
  dialogueEnd.value = page.endFrame;
  dialogueReveal.value = page.revealFrames;
}
function fitPreview() {
  if (!current) return;
  const {width, height} = current.project.design;
  const rect=viewport.getBoundingClientRect();
  const scale = Math.min(rect.width / width, rect.height / height);
  stage.style.transform = scale === 1 ? 'none' : `scale(${scale})`;
  stage.style.left = `${(rect.width - width * scale) / 2}px`;
  stage.style.top = `${(rect.height - height * scale) / 2}px`;
}
function paint(state, packet) {
  if(current&&current.documentId!==packet.documentId){timelineSelection=null;timelineRenderKey=null;}
  current = {state, project: packet.project, revision: packet.revision, documentId:packet.documentId, resourceUrls: packet.resourceUrls || {}};
  syncCodeEditor(packet);
  syncPreviewRange(packet);
  frame.max = packet.project.scene.durationFrames - 1;
  document.querySelector('#scrub').max = frame.max;
  document.querySelector('#scrub').value = frame.value;
  renderPreviewScene(state, packet.project, packet.resourceUrls || {});
  const painted = current;
  sceneRenderer.ready().catch(error => {
    // Video failures have their own pause + diagnostic path. Old paints must
    // not overwrite a newer document's status after asynchronous readiness.
    if (current !== painted || state.activeVideo) return;
    log.textContent = `场景资源错误：${error.message}`;
  });
  fitPreview();
  syncImageEditor(packet.project);
  locale.value = packet.project.locale;
  syncDialogueEditor(packet.project);
  syncAudioTrackEditor(packet.project);
  renderTimeline(packet.project, packet.resourceUrls || {});
  meta.textContent = `${packet.project.title} | rev ${packet.revision} | ${state.timeSeconds.toFixed(2)}s | ${packet.project.locale}`;
  const fileStatus=document.querySelector('#file-status'); if(fileStatus){const dirty=packet.dirty||packet.file==null;fileStatus.textContent=dirty?`未保存${packet.file?' · '+packet.file:''}`:`已保存 · ${packet.file}`;fileStatus.classList.toggle('saved',!dirty);}
  log.textContent = scenePerformanceHelp+'\n'+JSON.stringify(state, null, 2);
  productionAssets?.render(current);productionDrop?.invalidate(current);mediaDrop?.invalidate(current);backgroundEditor?.render(current);voiceClipEditor?.render(current);componentEditor?.render(current);characterLibraryEditor?.render(current);textImportEditor?.render(current);scriptPreflightEditor?.sync(current);externalFileDrop?.sync(current);performanceEditor?.render(current);scenePerformanceEditor?.render(current);characterRowEditor?.render(current);characterEventSublanes?.invalidate(current);s3Drop?.invalidate(current);characterClipEditor?.invalidate(current);characterClipEditor?.render();window.editorLayout?.refresh();
}
window.previewTest = {stage, render: async (state, packet) => {
  paint(state, packet);
  await sceneRenderer.ready();
}};
new ResizeObserver(fitPreview).observe(viewport);
let locateSequence = 0;
async function locate() {
  const sequence = ++locateSequence;
  const before = await window.replay.project();
  const at = Math.max(0,Math.min(before.project.scene.durationFrames-1,Number(frame.value)||0));
  const state = await window.replay.evaluate(at);
  const packet = await window.replay.project();
  if(sequence!==locateSequence)return;
  if(before.documentId!==packet.documentId||before.revision!==packet.revision)return locate();
  syncTransportFrame(at); paint(state, packet);
}
function action(id, handler) {
  document.querySelector(id).onclick = async () => {
    try { if (id !== '#play' && id !== '#pause') pausePlayback(); if(!['#play','#pause','#export-cancel','#save','#save-as','#open','#export','#undo','#redo','#range-play','#range-reset'].includes(id)&&(scenePerformanceEditor?.dirty||scenePerformanceEditor?.busy))throw Error('场景演出参数有未应用修改或正在提交，请先应用或明确放弃，再修改其他表单。'); await handler(); } catch (error) { log.textContent = `错误：${error.message}`; }
  };
}
async function changeImage(target, unbind = false) {
  if(target.kind==='character')requireLegacyCharacterAppearance();
  if (!current || imageBusy) return;
  const binding = target.kind === 'background' ? current.project.scene.background : selectedCharacter(current.project);
  if (target.kind === 'character' && !binding) return;
  if (unbind && !binding?.resourceId) return;
  imageBusy = true;
  syncImageEditor(current.project);
  try {
    const result = await (unbind ? window.replay.unbindImage(target) : window.replay.importImage(target));
    await locate();
    log.textContent = result.cancelled ? '已取消导入' : (unbind ? '图片已解绑' : '图片已复制并绑定');
  } finally {
    imageBusy = false;
    syncImageEditor(current?.project);
  }
}
function expressionEventPatch() {
  const value = Number(eventFrame.value);
  if (eventFrame.value.trim() === '' || !Number.isSafeInteger(value) || value < 0 || value >= current.project.scene.durationFrames) throw Error('事件帧必须是场景内的非负整数。');
  return {frame:value, expressionId:eventExpression.value || null};
}
action('#portrait-canvas-apply', async () => {
  const width = Number(canvasWidth.value), height = Number(canvasHeight.value);
  if (!canvasWidth.value.trim() || !canvasHeight.value.trim() || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw Error('画布宽高必须为正数。');
  requireLegacyCharacterAppearance();assertExpressionFresh();
  const documentId = current.documentId, cid = selectedCharacterId, serial = expressionEditSerial;
  await window.replay.setPortraitCanvas(cid, {width,height}); await locate();
  if (current.documentId === documentId && selectedCharacterId === cid && expressionEditSerial === serial) { canvasDirty = false; rebaseExpressionDraft(); syncExpressionEditor(current.project); }
});
action('#layer-add', () => {
  requireLegacyCharacterAppearance();
  const resourceId = layerResource.value || expressionResource.value; if (!resourceId) throw Error('请先导入图片。');
  const size = imageDimensions(resourceId) || {width:8,height:8};
  let id; do { id = `layer_${++layerSequence}`; } while (expressionLayers.some(l => l.id === id));
  expressionLayers.push({id,resourceId,x:0,y:0,width:size.width,height:size.height}); selectedLayerId = id; markExpressionDraft(); syncLayerControls();
});
action('#layer-remove', () => { requireLegacyCharacterAppearance();expressionLayers = expressionLayers.filter(l => l.id !== selectedLayerId); selectedLayerId = expressionLayers[0]?.id || null; markExpressionDraft(); syncLayerControls(); });
for (const [id,delta] of [['#layer-up',-1],['#layer-down',1]]) action(id, () => {
  requireLegacyCharacterAppearance();
  const index = expressionLayers.findIndex(l => l.id === selectedLayerId), next = index + delta;
  if (index < 0 || next < 0 || next >= expressionLayers.length) return;
  [expressionLayers[index],expressionLayers[next]] = [expressionLayers[next],expressionLayers[index]]; markExpressionDraft(); syncLayerControls();
});
action('#layer-native', async () => {
  requireLegacyCharacterAppearance();
  const layer = selectedLayer(); if (!layer) return;
  const resourceId = layer.resourceId, size = await decodeDimensions(resourceId);
  if (!expressionLayers.includes(layer) || layer.resourceId !== resourceId) return;
  layer.width = size.width; layer.height = size.height; markExpressionDraft(); syncLayerControls();
});
async function importExpressionResource(forLayer) {
  if (imageBusy || !selectedCharacter(current?.project)) return;
  requireLegacyCharacterAppearance();assertExpressionFresh();
  const identity = {documentId:current.documentId, characterId:selectedCharacterId,serial:expressionEditSerial};
  const draft = {name:expressionName.value, mode:expressionMode.value, resourceId:expressionResource.value, layers:expressionLayers.map(l => ({...l})), selectedLayerId, selectedExpressionId};
  await expressionDraftPublishing;
  const result = await window.replay.importExpressionImage();
  if (result.cancelled) return;
  await locate();
  if (current.documentId !== identity.documentId || selectedCharacterId !== identity.characterId) { draftStatus.textContent = '图片已导入；工程或角色已切换，未恢复原表单草稿。'; return; }
  if (expressionEditSerial !== identity.serial) { expressionStale = true; expressionDraftStatus(); return; }
  expressionName.value = draft.name; expressionMode.value = draft.mode; expressionResource.value = draft.resourceId;
  expressionLayers = draft.layers; selectedLayerId = draft.selectedLayerId; selectedExpressionId = draft.selectedExpressionId; expressionSelect.value = selectedExpressionId || '';
  if (forLayer) {
    expressionMode.value = 'overlay';
    const layer = selectedLayer();
    if (layer) { layer.resourceId = result.resourceId; layer.width = result.width; layer.height = result.height; }
    else { let id; do { id = `layer_${++layerSequence}`; } while (expressionLayers.some(l => l.id === id)); expressionLayers.push({id,resourceId:result.resourceId,x:0,y:0,width:result.width,height:result.height}); selectedLayerId = id; }
  } else { expressionMode.value = 'replace'; expressionResource.value = result.resourceId; }
  rebaseExpressionDraft(); markExpressionDraft(); syncLayerControls();
  draftStatus.textContent = '图片已独立导入，基础立绘未改变。已保留本地表单；当前图片及图层修改尚未应用，请应用/注册表情。';
}
action('#expression-import', () => importExpressionResource(false));
action('#layer-import', () => importExpressionResource(true));
action('#event-current', () => { eventFrame.value = Number(frame.value); });
action('#expression-add', async () => {
  if (!selectedCharacter(current?.project) || imageBusy) return;
  requireLegacyCharacterAppearance();assertExpressionFresh(); const serial=expressionEditSerial, doc=current.documentId, cid=selectedCharacterId; const result = await window.replay.addExpression(cid, expressionPayload());
  if (serial===expressionEditSerial && doc===current.documentId && cid===selectedCharacterId) { clearExpressionDraft(); selectedExpressionId = result.id; } await locate(); if (!hasExpressionDraft()) draftStatus.textContent = '表情已注册到工程；正式保存请点击“保存工程”。';
});
action('#expression-apply', async () => {
  if (!selectedExpressionId || imageBusy) return;
  requireLegacyCharacterAppearance();assertExpressionFresh(); const serial=expressionEditSerial, doc=current.documentId, cid=selectedCharacterId; await window.replay.editExpression(cid, selectedExpressionId, expressionPayload()); if(serial===expressionEditSerial && doc===current.documentId && cid===selectedCharacterId) clearExpressionDraft(); await locate(); if (!hasExpressionDraft()) draftStatus.textContent = '表情修改已应用到工程；正式保存请点击“保存工程”。';
});
action('#expression-delete', async () => {
  requireLegacyCharacterAppearance();
  if (!selectedExpressionId || imageBusy || !expressionConfirm.checked) return;
  if (!allowExpressionSelection()) return;
  await window.replay.deleteExpression(selectedCharacterId, selectedExpressionId); selectedExpressionId = null; await locate();
});
action('#event-add', async () => {
  if (!selectedCharacter(current?.project) || imageBusy) return;
  const patch=expressionEventPatch();const result = await window.replay.addExpressionEvent(selectedCharacterId, patch);eventFormDraft=null;publishExpressionDraft(); selectedEventId = result.id; await locate();
});
action('#event-apply', async () => {
  if (!selectedEventId || imageBusy) return;
  if(eventFormDraft&&(eventFormDraft.documentId!==current.documentId||eventFormDraft.revision!==current.revision))throw Error('事件草稿已过期，请先放弃。');
  const captured={...commandEnvelope(),characterId:selectedCharacterId,eventId:selectedEventId,serial:expressionEditSerial,patch:expressionEventPatch()};if(!allowPageDiscard())return;await pagePublishing;
  if(captured.documentId!==current.documentId||captured.expectedRevision!==current.revision||captured.characterId!==selectedCharacterId||captured.eventId!==selectedEventId||captured.serial!==expressionEditSerial)throw Error('等待期间工程或事件表单已改变。');
  const {serial,...payload}=captured;checkedResult(await window.replay.editExpressionEventChecked(payload));
  if(serial===expressionEditSerial&&captured.documentId===current.documentId&&captured.characterId===selectedCharacterId&&captured.eventId===selectedEventId)eventFormDraft=null;publishExpressionDraft();await locate();
});
action('#event-delete', async () => {
  if (!selectedEventId || imageBusy) return;
  if(!await prepareProductionMutation())return;
  checkedResult(await window.replay.deleteExpressionEventChecked({...commandEnvelope(),characterId:selectedCharacterId,eventId:selectedEventId})); selectedEventId = null; await locate();
});
action('#background-import', () => changeImage({kind: 'background'}));
action('#background-unbind', () => changeImage({kind: 'background'}, true));
action('#character-import', () => changeImage({kind: 'character', id: selectedCharacterId}));
action('#character-unbind', () => changeImage({kind: 'character', id: selectedCharacterId}, true));
characterSelect.onchange = () => {const next=characterSelect.value||null;if(!allowProductionSelection({owner:'character',id:next})){characterSelect.value=selectedCharacterId||'';return;}selectedCharacterId=next;syncImageEditor(current?.project);};
characterDeleteConfirm.onchange = () => { characterDelete.disabled = !selectedCharacter(current?.project) || imageBusy || !characterDeleteConfirm.checked; };
action('#character-add', async () => {
  if (!current?.project?.scene || imageBusy) return;
  if([3,4].includes(current.project.schemaVersion)){window.editorLayout?.showVisualTab('characterLibrary');log.textContent='请在角色模板页选择模板并添加场景实例。';return;}
  if (!allowExpressionSelection()) return;
  const result = await window.replay.addCharacter();
  selectedCharacterId = result.id;
  await locate();
});
action('#character-delete', async () => {
  const character = selectedCharacter(current?.project);
  if (!character || imageBusy || !characterDeleteConfirm.checked) return;
  if (!allowExpressionSelection()) return;
  await window.replay.deleteCharacter(character.id);
  selectedCharacterId = null;
  await locate();
});
action('#character-apply', async () => {
  const character = selectedCharacter(current?.project);
  if (!character || imageBusy) return;
  await window.replay.editCharacter(character.id, {
    ...([3,4].includes(current.project.schemaVersion)?{}:{name:characterName.value}),
    x: Number(x.value),
    y: Number(y.value),
    width: Number(characterWidth.value),
    height: Number(characterHeight.value),
    visibleFrom: Number(characterFrom.value),
    visibleTo: Number(characterTo.value)
  });
  await locate();
});
action('#voice-import', async () => {
  const d = selectedDialogue(current?.project); if (!d || voiceBusy) return;
  voiceBusy = true; syncDialogueEditor(current.project);
  try { const result = await window.replay.importVoice(d.id); await locate(); log.textContent = result.cancelled ? '已取消导入' : '配音已复制并绑定'; }
  finally { voiceBusy = false; syncDialogueEditor(current.project); }
});
action('#voice-unbind', async () => {
  const d = selectedDialogue(current?.project); if (!d?.voice || voiceBusy || !allowPageDiscard() || !allowAudioDiscard()) return;
  await pagePublishing;await window.replay.unbindVoice(d.id); await locate();
});
for(const [id,mode,position] of [['voice-binding-independent','independent','preserve'],['voice-binding-preserve','follow','preserve'],['voice-binding-align','follow','dialogueStart']])action('#'+id,async()=>{
 const d=selectedDialogue(current?.project);if(!d?.voice||voiceBusy||!allowPageDiscard()||!allowAudioDiscard())return;
 const identity={doc:current.documentId,rev:current.revision,serial:pageSerial};voiceBusy=true;syncDialogueEditor(current.project);
 try{pausePlayback();await pagePublishing;if(identity.doc!==current.documentId||identity.rev!==current.revision||identity.serial!==pageSerial)throw Error('工程或表单已改变，请重试。');await window.replay.setDialogueVoiceBinding(d.id,{mode,position});await locate();log.textContent=mode==='independent'?'已解绑定，位置不变；关联标记保留。':position==='preserve'?'已重新绑定，位置不变；移动对白将保持当前偏移。':'已重新绑定并对齐对白起点；裁剪区间保持。';}
 finally{voiceBusy=false;syncDialogueEditor(current.project);}
});
// Range controls are view state: no edit IPC, no automatic pause on invalid input.
document.querySelector('#range-reset').onclick = resetPreviewRange;
document.querySelector('#range-dialogue').onclick = () => {
  const d = selectedDialogue(current?.project);
  if (d) { rangeStart.value = d.startFrame; rangeEnd.value = d.endFrame; }
};
document.querySelector('#range-play').onclick = async () => {
  try {
    if (!current) return;
    const start = Number(rangeStart.value), end = Number(rangeEnd.value), duration = current.project.scene.durationFrames;
    if (rangeStart.value === '' || rangeEnd.value === '' || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > duration) throw Error('区间必须为场景内整数帧：0 ≤ 开始帧 < 结束帧 ≤ ' + duration + '（结束帧不含）。');
    if (videoPlaybackStartBusy) return;
    pausePlayback();
    await startPreparedPlayback(start, {endFrame: end});
  } catch (error) { log.textContent = `错误：${error.message}`; }
};
action('#play', async () => { if (!current) return; if (playback.state === 'playing' || playback.state === 'loading' || videoPlaybackStartBusy) return; await startPreparedPlayback(Number(frame.value)); });
action('#pause', async () => { const active = playback.state === 'playing' || playback.state === 'loading'; const value = active ? playback.frame : Number(frame.value); pausePlayback(); seekTransport(value); });
action('#stop', async () => { finishPlayheadDrag(); playback.stop(); playbackGeneration++; pendingFrame = null; seekTransport(0); });
document.querySelector('#scrub').oninput = event => { pausePlayback(); seekTransport(Number(event.target.value)); };
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' && event.key !== ' ') return;
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.defaultPrevented) return;
  const target = event.target;
  if (target?.closest?.('input, textarea, select, button') || target?.isContentEditable) return;
  if (!current) return;
  event.preventDefault();
  document.querySelector(playback.state === 'playing' || playback.state === 'loading' ? '#pause' : '#play').onclick();
});
window.addEventListener('pagehide', () => { finishPlayheadDrag(); pausePlayback(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { finishPlayheadDrag(); pausePlayback(); } });
action('#apply', locate);
dialogueSelect.onchange = () => { if(!allowProductionSelection({owner:'dialogue',id:dialogueSelect.value||null,pageId:null})){dialogueSelect.value=selectedDialogueId||'';return;} selectedDialogueId = dialogueSelect.value || null; selectedDialoguePageId=null; syncDialogueEditor(current?.project); };
dialoguePageSelect.onchange=()=>{if(!allowProductionSelection({owner:'dialogue',id:selectedDialogueId,pageId:dialoguePageSelect.value||null})||!allowPageDiscard()){dialoguePageSelect.value=selectedDialoguePageId||'';return;}selectedDialoguePageId=dialoguePageSelect.value||null;syncDialogueEditor(current?.project);};
for(const input of [dialogueText,dialogueStart,dialogueEnd,dialogueReveal]) input.oninput=markPageDraft;
document.querySelector('#dialogue-page-delete-confirm').onchange=()=>syncDialogueEditor(current?.project);
action('#dialogue-page-discard',()=>{if(allowPageDiscard())syncDialogueEditor(current?.project);});
action('#dialogue-page-add',async()=>{
  const d=selectedDialogue(current?.project);if(!d || !allowPageDiscard())return;
  await pagePublishing;const result=await window.replay.addDialoguePage(d.id,selectedDialoguePageId?{afterPageId:selectedDialoguePageId}:{});
  selectedDialoguePageId=result.pageId;await locate();
});
action('#dialogue-page-delete',async()=>{
 const d=selectedDialogue(current?.project);if(!d || !selectedDialoguePageId || !document.querySelector('#dialogue-page-delete-confirm').checked || !allowPageDiscard())return;
 await pagePublishing;await window.replay.deleteDialoguePage(d.id,selectedDialoguePageId);selectedDialoguePageId=null;document.querySelector('#dialogue-page-delete-confirm').checked=false;await locate();
});
audioTrackSelect.onchange = () => {const next=audioTrackSelect.value;if(!allowProductionSelection({owner:'audio',id:next})){audioTrackSelect.value=selectedAudioTrackId||'';return;}selectedAudioTrackId=next||null;timelineSelection=selectedAudioTrackId?{kind:'audioTracks',id:selectedAudioTrackId,pageId:null}:null;syncAudioTrackEditor(current?.project);syncTimelineSelection();};
audioTrackDeleteConfirm.onchange = () => { audioTrackDelete.disabled = !selectedAudioTrack(current?.project) || !audioTrackDeleteConfirm.checked; };
function audioStartValue() {
  const value = Number(audioTrackStart.value);
  if (!audioTrackStart.value.trim() || !Number.isSafeInteger(value) || value < 0 || value >= current.project.scene.durationFrames) throw Error('音轨开始帧必须是场景内的非负整数。');
  return value;
}
action('#audio-track-import', async () => { if (!current?.project?.scene||!allowAudioDiscard()) return; const result = await window.replay.importAudioTrack({kind: audioTrackKind.value, startFrame: audioStartValue()}); if (!result.cancelled) selectedAudioTrackId = result.id; await locate(); });
action('#audio-track-reset',()=>{if(allowAudioDiscard()){audioFormBinding=null;syncAudioTrackEditor(current?.project);}});
action('#audio-track-apply', async () => { const a = selectedAudioTrack(current?.project); if (!a) return;if(audioFormDirty()&&audioFormBinding.revision!==current.revision)throw Error('音轨表单已过期，请丢弃表单并重新编辑。'); const startFrame = audioStartValue(), gain = Number(audioTrackGain.value); if (!audioTrackGain.value.trim() || !Number.isFinite(gain) || gain < 0 || gain > 2) throw Error('音量必须是0到2的数值。'); await window.replay.editAudioTrack(a.id, {name: audioTrackName.value, startFrame, gain}); audioFormBinding=null;await locate(); });
action('#audio-track-delete', async () => { const a = selectedAudioTrack(current?.project); if (!a || !audioTrackDeleteConfirm.checked||!allowAudioDiscard()) return; await window.replay.deleteAudioTrack(a.id); selectedAudioTrackId = null; await locate(); });
dialogueDeleteConfirm.onchange = () => { dialogueDelete.disabled = !selectedDialogue(current?.project) || !dialogueDeleteConfirm.checked; };
action('#dialogue-add', async () => {
  if(!allowPageDiscard())return;
  const result = await window.replay.addDialogue();
  selectedDialogueId = result.id;
  await locate();
});
action('#dialogue-delete', async () => {
  const d = selectedDialogue(current?.project);
  if (!d || !dialogueDeleteConfirm.checked || !allowPageDiscard()) return;
  await window.replay.deleteDialogue(d.id);
  selectedDialogueId = null;
  await locate();
});
action('#dialogue-up', async () => {
  const d = selectedDialogue(current?.project);
  if (!d) return;
  await window.replay.moveDialogue(d.id, -1);
  await locate();
});
action('#dialogue-down', async () => {
  const d = selectedDialogue(current?.project);
  if (!d) return;
  await window.replay.moveDialogue(d.id, 1);
  await locate();
});
action('#dialogue-speaker-apply', async () => {
  const d = selectedDialogue(current?.project);
  if (!d) return;
  await window.replay.setDialogueSpeaker(d.id, dialogueSpeaker.value);
  await locate();
});
action('#dialogue-apply', async () => {
  const d = selectedDialogue(current?.project);
  if (!d) return;
  pageFresh();
  for (const input of [dialogueStart,dialogueEnd,dialogueReveal]) if(!input.value.trim() || !Number.isSafeInteger(Number(input.value))) throw Error('对白页时间必须为整数帧。');
  const serial=pageSerial,doc=current.documentId;
  const patch={text:dialogueText.value,revealFrames:Number(dialogueReveal.value)};
  await pagePublishing;
  if(d.pages?.length){
    const index=d.pages.findIndex(p=>p.id===selectedDialoguePageId);if(index<0)throw Error('请选择有效对白页');
    if(index<d.pages.length-1)patch.endFrame=Number(dialogueEnd.value);
    await window.replay.editDialoguePage(d.id,selectedDialoguePageId,patch);
  }else await window.replay.editDialogue(d.id,{...patch,startFrame:Number(dialogueStart.value),endFrame:Number(dialogueEnd.value)});
  if(pageSerial===serial && current.documentId===doc)clearPageDraft();
  await locate();
});
codeText.oninput = () => { if (!codeBusy) { codeEditor.edit(codeText.value); syncCodeEditor(current ? {project: current.project, revision: current.revision} : null); publishCodeDraft(); } };
codeReset.onclick = async () => {
  if (codeBusy || (!codeEditor.state.dirty && !codeEditor.state.stale)) return;
  if (!codeResetConfirm.checked && codeEditor.state.dirty) { codeStatus.textContent = '请勾选确认丢弃草稿'; return; }
  codeBusy = true; codeText.disabled = true;
  try {
    await Promise.all([...draftUpdates]);
    codeEditor.resetToLatest();
    await publishCodeDraft();
  } catch (error) { showRecoveryStatus({recoveryError: error.message || String(error)}); }
  finally { codeBusy = false; codeText.disabled = false; syncCodeEditor(current ? {project: current.project, revision: current.revision} : null); }
};
codeApply.onclick = async () => {
  if (codeBusy || codeEditor.state.stale || !window.replay.applyProjectCode) return;
  pausePlayback(); codeBusy = true; codeText.disabled = true; let resultMessage = ''; const generation = ++codeGeneration; syncCodeEditor(current ? {project: current.project, revision: current.revision} : null); codeStatus.textContent = '正在应用…';
  try { if(!await prepareProductionMutation({preserveCode:true}))return; await awaitCodeDrafts(); await window.replay.applyProjectCode(codeEditor.submission()); if (generation !== codeGeneration) return; await locate(); const latestPacket = await window.replay.project(); codeEditor.markApplied(latestPacket); await publishCodeDraft(); syncCodeEditor(latestPacket); resultMessage = '已应用'; }
  catch (error) { if (generation === codeGeneration) resultMessage = `错误：${error.message || error}`; }
  finally { if (generation === codeGeneration) { codeBusy = false; codeText.disabled = false; syncCodeEditor(current ? {project: current.project, revision: current.revision} : null); if (resultMessage) codeStatus.textContent = resultMessage; } }
};
locale.onchange = async () => {
  try { pausePlayback(); if(!await prepareProductionMutation()){locale.value=current.project.locale;return;} await window.replay.setLocale(locale.value); await locate(); }
  catch (error) { log.textContent = `错误：${error.message}`; }
};
action('#move', async () => {
  const character = selectedCharacter(current?.project);
  if (character) { await window.replay.move(character.id, x.value, y.value); await locate(); }
});
action('#undo', async () => { if(!await prepareProductionMutation())return;await window.replay.undo(); await locate(); });
action('#redo', async () => { if(!await prepareProductionMutation())return;await window.replay.redo(); await locate(); });
async function settleExtensionSave(){if(componentEditor?.busy||voiceClipEditor?.busy||characterLibraryEditor?.busy||textImportEditor?.busy||performanceEditor?.busy)throw Error('部件、配音或角色/文本正在提交，请等待完成后再保存。');await componentEditor?.publishing;await voiceClipEditor?.publishing;await extensionPublishing;await characterLibraryEditor?.publishing;await textImportEditor?.publishing;await s3Publishing;await performanceEditor?.publishing;await performancePublishing;if(componentEditor?.dirty||voiceClipEditor?.dirty||characterLibraryEditor?.dirty||textImportEditor?.dirty||performanceEditor?.dirty)throw Error('还有未应用的部件、配音、角色模板或文本预览，请先应用/创建或放弃，再保存。文字溢出警告不阻止保存。');}
action('#save', async () => { const captured=await settleScenePerformance();await settleExtensionSave();await expressionDraftPublishing; await pagePublishing; await backgroundEditor?.publishing; await extensionPublishing; const warning=await checkSceneTitles();assertScenePerformance(captured);const file = await window.replay.save(); await locate(); log.textContent = file ? '已保存：' + file + warning : '已取消保存'; });
action('#save-as', async () => { const captured=await settleScenePerformance();await settleExtensionSave();await expressionDraftPublishing; await pagePublishing; await backgroundEditor?.publishing; await extensionPublishing; const warning=await checkSceneTitles();assertScenePerformance(captured);const result = await window.replay.saveAs(); await locate(); log.textContent = result.cancelled ? '已取消另存' : '已另存：' + result.file + warning; });
action('#open', async () => { if(scenePerformanceEditor?.busy)throw Error('场景演出参数正在提交，请稍候。');if(scenePerformanceEditor?.dirty&&!scenePerformanceEditor.allowDiscard())return;const captured=await settleScenePerformance();await expressionDraftPublishing; await pagePublishing; await backgroundEditor?.publishing; await extensionPublishing;assertScenePerformance(captured);const result = await window.replay.openProject(); if (!result.cancelled) { frame.value = 0; selectedDialogueId = null; } await locate(); log.textContent = result.cancelled ? '已取消打开' : '已打开：' + result.file; });
window.replay.onFileCommand?.(command => { const map={open:'#open',save:'#save','save-as':'#save-as',export:'#export','export-cancel':'#export-cancel'}; const target=map[command]; if(target) document.querySelector(target)?.click(); });
let exportCleanupWarning=false;
window.replay.onExportProgress?.(p=>{const labels={PREPARING:'正在准备',VIDEO:'正在导出视频',VIDEO_FINISHED:'视频分段已完成',render:'正在绘制',rendering:'正在绘制',verify:'正在核验',audio:'正在合成音轨',concat:'正在合并分段',mux:'正在合成成片',complete:'导出完成','cleanup-warning':'成片完成，清理待处理'};if(p.stage==='cleanup-warning')exportCleanupWarning=true;log.textContent=(p.message||labels[p.stage]||p.stage||'正在导出')+(Number.isFinite(p.completedFrames)?` ${p.completedFrames}/${p.totalFrames??'?' } 帧`:'');});
function exportControls(busy){document.querySelector('#export').disabled=busy;document.querySelector('#export-resume').disabled=busy;document.querySelector('#export-mode').disabled=busy;document.querySelector('#export-cancel').disabled=!busy;}
action('#export-folder',()=>window.replay.openExportFolder());
action('#export-resume',async()=>{exportControls(true);exportCleanupWarning=false;try{const result=await window.replay.resumeExport();log.textContent=result?'已导出：'+result+(exportCleanupWarning?'（临时分段清理待处理）':''):'已取消恢复';if(result)document.querySelector('#export-folder').disabled=false;}finally{exportControls(false);}});
action('#export-cancel', async () => {
  const button=document.querySelector('#export-cancel');button.disabled=true;
  try { const result=await window.replay.cancelExport();if(result.cancelled&&document.querySelector('#export').disabled)log.textContent='正在取消导出，等待编码进程退出…'; }
  catch(error){button.disabled=!document.querySelector('#export').disabled;throw error;}
});
action('#export', async () => {
  const button = document.querySelector('#export');
  const cancel = document.querySelector('#export-cancel');
  exportControls(true);exportCleanupWarning=false;
  log.textContent = '正在选择导出位置…';
  try { const captured=await settleScenePerformance();if(characterLibraryEditor?.busy||textImportEditor?.busy||performanceEditor?.busy)throw Error('角色/文本正在提交，请稍候');await characterLibraryEditor?.publishing;await textImportEditor?.publishing;await s3Publishing;await performanceEditor?.publishing;await performancePublishing;if(characterLibraryEditor?.dirty||textImportEditor?.dirty||performanceEditor?.dirty)throw Error('请先应用或放弃角色模板、文本预览，再导出');await checkSceneTitles({rejectOverflow:true});assertScenePerformance(captured);const result=await window.replay.exportCurrent({workers:Number(document.querySelector('#export-mode').value)});log.textContent = result ? '已导出：'+result+(exportCleanupWarning?'（临时分段清理待处理）':'') : '已取消选择导出位置';if(result)document.querySelector('#export-folder').disabled=false; }
  catch(error) { log.textContent = /导出已取消/.test(error.message) ? '导出已取消；之前的成功成片未修改。' : '导出失败：'+error.message; }
  finally { exportControls(false); }
});
function checkedResult(result){if(!result?.ok)throw Error(result?.error?.message||'命令未成功');return result;}
function commandEnvelope(){return {commandId:crypto.randomUUID(),documentId:current.documentId,expectedRevision:current.revision};}
async function prepareProductionMutation({preserveBackground=false,preserveVoiceClips=false,preserveComponents=false,preserveCharacterLibrary=false,preserveTextImport=false,preserveCharacterPerformance=false,preserveScenePerformance=false,preserveCode=false}={}){
 if((!preserveScenePerformance&&scenePerformanceEditor?.busy)||(!preserveCode&&codeBusy))throw Error('场景演出或代码正在提交，请稍候。');
 if((!preserveBackground&&backgroundEditor?.busy)||(!preserveVoiceClips&&voiceClipEditor?.busy)||(!preserveComponents&&componentEditor?.busy)||(!preserveCharacterLibrary&&characterLibraryEditor?.busy)||(!preserveTextImport&&textImportEditor?.busy)||(!preserveCharacterPerformance&&performanceEditor?.busy))throw Error('其他属性表单正在提交，请稍候。');
 const foreignDraftNames=[...(eventFormDraft?['表情事件']:[]),...(hasExpressionDraft()?['表情/画布']:[]),...(pageDraft?['对白/页']:[]),...(audioFormDirty()?['独立音轨']:[]),...(!preserveBackground&&backgroundEditor?.dirty?['背景事件']:[]),...(!preserveVoiceClips&&voiceClipEditor?.dirty?['配音片段']:[]),...(!preserveComponents&&componentEditor?.dirty?['部件']:[]),...(!preserveCharacterLibrary&&characterLibraryEditor?.dirty?['角色模板']:[]),...(!preserveTextImport&&textImportEditor?.dirty?['文本预览']:[]),...(!preserveCharacterPerformance&&performanceEditor?.dirty?['角色显隐/位置事件']:[]),...(!preserveScenePerformance&&scenePerformanceEditor?.dirty?['场景演出参数']:[]),...(!preserveCode&&codeEditor.state.dirty?['代码']:[])];
 if(foreignDraftNames.length&&!window.confirm('提交此操作会改变工程版本。以下面板有未应用修改：'+foreignDraftNames.join('、')+'。确定放弃这些修改后继续吗？取消将完整保留；仅切换查看对象不会清除其他面板草稿。'))return false;
 eventFormDraft=null;clearExpressionDraft();clearPageDraft();audioFormBinding=null;syncAudioTrackEditor(current.project);if(!preserveBackground)backgroundEditor?.clear();if(!preserveVoiceClips)voiceClipEditor?.clear();if(!preserveComponents)componentEditor?.clear();if(!preserveCharacterLibrary)characterLibraryEditor?.clear();if(!preserveTextImport)textImportEditor?.clear();if(!preserveCharacterPerformance)performanceEditor?.clear();if(!preserveScenePerformance)scenePerformanceEditor?.clear();if(!preserveCode&&codeEditor.state.dirty){codeEditor.resetToLatest();syncCodeEditor(current);publishCodeDraft();}
 const captured={documentId:current.documentId,revision:current.revision,expressionSerial:expressionEditSerial,pageSerial,backgroundSerial:backgroundEditor?.serial,audioSerial:audioEditSerial,voiceSerial:voiceClipEditor?.serial,componentSerial:componentEditor?.serial,characterSerial:characterLibraryEditor?.serial,textSerial:textImportEditor?.serial,performanceSerial:performanceEditor?.serial,scenePerformanceSerial:scenePerformanceEditor?.serial,codeSerial:draftSequence};
 publishExpressionDraft();await expressionDraftPublishing;await pagePublishing;await backgroundEditor?.publishing;await publishExtensionDraft();await characterLibraryEditor?.publishing;await textImportEditor?.publishing;await publishS3Draft();await performanceEditor?.publishing;await publishPerformanceDraft();await scenePerformanceEditor?.publishing;await publishScenePerformanceDraft();await awaitCodeDrafts();
 if(captured.documentId!==current.documentId||captured.revision!==current.revision||captured.expressionSerial!==expressionEditSerial||captured.pageSerial!==pageSerial||captured.backgroundSerial!==backgroundEditor?.serial||captured.audioSerial!==audioEditSerial||captured.voiceSerial!==voiceClipEditor?.serial||captured.componentSerial!==componentEditor?.serial||captured.characterSerial!==characterLibraryEditor?.serial||captured.textSerial!==textImportEditor?.serial||captured.performanceSerial!==performanceEditor?.serial||captured.scenePerformanceSerial!==scenePerformanceEditor?.serial||captured.codeSerial!==draftSequence)throw Error('等待期间工程或表单已改变，操作取消。');return true;
}
async function commitExpressionIntent(intent){
 const {documentId,expectedRevision,source,target,atFrame}=intent;
 if(!current||current.documentId!==documentId||current.revision!==expectedRevision)throw Error('工程版本已改变，请重新拖入。');
 if(!await prepareProductionMutation())return;
 if(current.documentId!==documentId||current.revision!==expectedRevision)throw Error('确认期间工程已改变，已取消。');
 pausePlayback();const commandId=crypto.randomUUID();
 const result=checkedResult(await window.replay.dropExpression({commandId,documentId,expectedRevision,source:[3,4].includes(current.project.schemaVersion)?{definitionId:source.definitionId||characterReadView(current.project,source.characterId)?.definitionId,expressionId:source.expressionId}:source,target,atFrame}));
 await locate();if(current.documentId!==documentId)return;
 const followCreated=()=>{if(current.documentId!==documentId||!current.project.scene.characters.find(c=>c.id===result.created.characterId)?.expressionEvents?.some(e=>e.id===result.created.eventId))return false;if(!allowProductionSelection({owner:'character',id:result.created.characterId,eventId:result.created.eventId}))return false;selectedCharacterId=result.created.characterId;syncImageEditor(current.project);selectedEventId=result.created.eventId;timelineSelection={kind:'expressionEvents',id:selectedEventId,pageId:null};syncExpressionEvents(current.project);syncTimelineSelection();editorLayout.showVisualTab('characterEvents');return true;};
 if(productionAssets)productionAssets.follow(followCreated,'新表情事件 · '+atFrame+'帧');else followCreated();
 productionAssets?.committed(atFrame);
}
function selectImageComponent(id){
 if(!current?.project.scene.components?.some(i=>i.id===id)||!allowProductionSelection({owner:'component',id}))return false;
 editorLayout.showVisualTab('components');
 if(!componentEditor.select(id))return false;
 timelineSelection={kind:'components',id,pageId:null};syncTimelineSelection();return true;
}
async function commitMediaIntent(intent){
 if(intent.target.kind==='image'){
  const {documentId,expectedRevision,source,atFrame}=intent;
  if(source.kind!=='image'||current.documentId!==documentId||current.revision!==expectedRevision)throw Error('图片来源或工程版本已改变，请重新拖入。');
  pausePlayback();const result=checkedResult(await window.replay.createComponent({commandId:crypto.randomUUID(),documentId,expectedRevision,type:'image',resourceId:source.resourceId,atFrame,x:0,y:0}));
  await locate();if(current.documentId!==documentId)return result;
  productionAssets.follow(()=>current.documentId===documentId&&selectImageComponent(result.created.instanceId||result.created.id),'新图片片段');
  log.textContent=`已创建图片片段 · ${atFrame}帧。位置、尺寸与显示范围可在部件属性中编辑。`;return result;
 }
 const {documentId,expectedRevision,source,target,atFrame}=intent;if(current.documentId!==documentId||current.revision!==expectedRevision)throw Error('工程版本已改变，请重新拖入。');pausePlayback();const payload={commandId:crypto.randomUUID(),documentId,expectedRevision,resourceId:source.resourceId,atFrame};const result=checkedResult(await (target.kind==='background'?window.replay.dropBackgroundResource(payload):window.replay.dropAudioResource({...payload,kind:target.kind})));await locate();if(current.documentId!==documentId)return;productionAssets.follow(()=>{if(current.documentId!==documentId)return false;if(target.kind==='background'){if(!current.project.scene.backgroundEvents?.some(e=>e.id===result.created.eventId)||!allowProductionSelection({owner:'background',id:result.created.eventId}))return false;return backgroundEditor.select(result.created.eventId);}const track=current.project.scene.audioTracks?.find(t=>t.id===result.created.audioTrackId);if(!track||!allowProductionSelection({owner:'audio',id:track.id}))return false;selectedAudioTrackId=track.id;timelineSelection={kind:'audioTracks',id:track.id,pageId:null};syncAudioTrackEditor(current.project);syncTimelineSelection();editorLayout.showAudioTab('audio');editorLayout.setFocus(null);return true;},target.kind==='background'?'新背景事件':'新音频片段');log.textContent=`已创建${target.kind==='background'?'背景事件':target.kind.toUpperCase()+'片段'} · ${atFrame}帧。当前画面/声音按播放头求值。`;return result;
}
function selectTimelineIdentity({kind,id,parentId,characterId,dialogueId,pageId}={}){
 const page=pageId??null,parent=parentId??(kind==='expressionEvents'?characterId:kind==='voiceClips'?dialogueId:null)??null;
 if(typeof kind!=='string'||typeof id!=='string'||!id||(page!==null&&(typeof page!=='string'||!page))||(kind==='pages'&&page===null))return false;
 const nodes=Array.from(timelineTracks.querySelectorAll('[data-kind][data-id]')).filter(n=>{
  const d=n.dataset,pageKind=page!==null&&['pages','dialogues'].includes(kind)&&['pages','dialogues'].includes(d.kind);
  return (d.kind===kind||pageKind||(page===null&&kind==='dialogues'&&d.kind==='dialogueGroups'))&&d.id===id&&(d.pageId||null)===page&&(parent===null||(['expressionEvents'].includes(kind)?d.characterId:kind==='voiceClips'?d.dialogueId:d.characterId||d.dialogueId)===parent);
 });
 // Ambiguous or missing identities must not silently select a different page/parent.
 return nodes.length===1?selectTimelineItem(nodes[0]):false;
}
function selectS3Instance(id){if(!current?.project.scene.characters.some(c=>c.id===id)||!allowProductionSelection({owner:'character',id}))return false;selectedCharacterId=id;timelineSelection={kind:'characters',id,pageId:null};syncImageEditor(current.project);syncTimelineSelection();editorLayout.showVisualTab('character');return true;}
async function commitCharacterIntent({source,target,atFrame,documentId,expectedRevision}){if(current.documentId!==documentId||current.revision!==expectedRevision)throw Error('工程版本已变化');if(![3,4].includes(current.project.schemaVersion)&&!window.confirm('拖入此角色将启用共享角色模板，并新增独立出场片段。工程升级为版本3，保存必须另存副本；可一次撤销升级与新增。继续吗？'))return;if(!await prepareProductionMutation())return;if(current.documentId!==documentId||current.revision!==expectedRevision)throw Error('确认期间工程已改变');const command={commandId:crypto.randomUUID(),documentId,expectedRevision,atFrame};const result=checkedResult(await ([3,4].includes(current.project.schemaVersion)?replay.instantiateCharacter({...command,definitionId:source.definitionId}):replay.instantiateLegacyCharacter({...command,characterId:source.characterId})));await locate();if(current.documentId===documentId)selectS3Instance(result.created.characterId);}
if(typeof createScenePerformanceEditor==='function'&&document.querySelector('#scene-performance-editor-host'))scenePerformanceEditor=createScenePerformanceEditor({container:document.querySelector('#scene-performance-editor-host'),packet:()=>current,prepare:()=>prepareProductionMutation({preserveScenePerformance:true}),refresh:locate,dirtyChanged:publishScenePerformanceDraft,seek:at=>{pausePlayback();syncTransportFrame(at);return locate();},measureTitle:title=>measureSceneTitle(title,current.project.design)});
if(typeof createDialogueReadingEditor==='function'&&document.querySelector('#dialogue-pages-host'))dialogueReadingEditor=createDialogueReadingEditor({container:document.querySelector('#dialogue-pages-host'),getPacket:()=>current,currentDialogue:()=>selectedDialogue(current?.project),api:window.replay,refresh:locate,beforeApply:()=>pausePlayback()});
if(typeof createProductionAssets==='function'&&document.querySelector('#asset-list')){
 backgroundEditor=createBackgroundEditor({packet:()=>current,prepare:prepareProductionMutation,refresh:locate,onSelect:id=>{timelineSelection={kind:'backgroundEvents',id,pageId:null};syncTimelineSelection();},container:document.querySelector('#background-editor-host'),show:()=>editorLayout.showVisualTab('background'),seek:at=>{pausePlayback();syncTransportFrame(at);return locate();}});
 voiceClipEditor=createVoiceClipEditor({container:document.querySelector('#voice-editor-host'),packet:()=>current,prepare:prepareProductionMutation,refresh:locate,dirtyChanged:publishExtensionDraft,onSelect:({dialogueId,clipId})=>{timelineSelection={kind:clipId?'voiceClips':'audio',id:clipId||dialogueId,dialogueId,pageId:null};syncTimelineSelection();},show:()=>{editorLayout.showAudioTab('voice');editorLayout.setFocus(null);},seek:at=>{pausePlayback();syncTransportFrame(at);return locate();}});
 const componentHost=document.createElement('div');componentHost.id='component-editor-host';editorLayout.registerVisualTab('components',componentHost);const componentTab=Object.assign(document.createElement('button'),{type:'button',textContent:'部件',onclick:()=>editorLayout.showVisualTab('components')});componentTab.dataset.visualTab='components';document.querySelector('#visual-panel .tabs').append(componentTab);window.addEventListener('visual-tab-change',()=>componentEditor?.render(current));
 componentEditor=createComponentEditor({container:componentHost,packet:()=>current,prepare:prepareProductionMutation,refresh:locate,frame:()=>Number(frame.value),stage,viewport,isEnabled:()=>!componentHost.hidden,dirtyChanged:publishExtensionDraft,allowSelection:()=>allowProductionSelection({owner:'component'}),isPlaying:()=>['playing','loading'].includes(playback.state),onSelect:id=>{timelineSelection={kind:'components',id,pageId:null};syncTimelineSelection();}});
 const s3Tab=(name,label)=>{const host=document.createElement('div');host.id=name+'-host';editorLayout.registerVisualTab(name,host);const button=document.createElement('button');button.type='button';button.dataset.visualTab=name;button.textContent=label;button.onclick=()=>editorLayout.showVisualTab(name);document.querySelector('#visual-panel .tabs').append(button);return host;};
 const scenePerformanceHost=document.querySelector('#scene-performance-editor-host');if(scenePerformanceHost)s3Tab('scenePerformance','场景演出参数').append(scenePerformanceHost.parentElement);
 characterLibraryEditor=createCharacterLibraryEditor({container:s3Tab('characterLibrary','角色库'),packet:()=>current,prepare:prepareProductionMutation,refresh:locate,frame:()=>Number(frame.value),dirtyChanged:publishS3Draft,allowSelection:()=>allowProductionSelection({owner:'library'}),allowInstanceSelection:id=>allowProductionSelection({owner:'character',id}),onSelectInstance:selectS3Instance,onSelectDefinition:id=>{timelineSelection={kind:'characterDefinitions',id,pageId:null};syncTimelineSelection();},onBeginDrag:(source,event)=>s3Drop?.beginCharacter(source,event)});
 textImportEditor=createTextImportEditor({container:s3Tab('textImport','文本导入'),packet:()=>current,prepare:prepareProductionMutation,refresh:locate,frame:()=>Number(frame.value),dirtyChanged:publishS3Draft,onSelect:id=>{selectedDialogueId=id;timelineSelection={kind:'dialogues',id,pageId:null};syncDialogueEditor(current.project);syncTimelineSelection();editorLayout.showAudioTab('dialogue');},seek:at=>{pausePlayback();syncTransportFrame(at);return locate();},onBeginDrag:(source,event)=>s3Drop?.beginText(source,event)});
 if(typeof createExternalFileDrop==='function'&&window.replay.onExternalFileDrop)externalFileDrop=createExternalFileDrop({container:s3Tab('externalFiles','外部文件'),packet:()=>current,frame:()=>Number(frame.value),prepare:prepareProductionMutation,refresh:locate,hasDraft:()=>!!(eventFormDraft||hasExpressionDraft()||pageDraft||audioFormDirty()||backgroundEditor?.dirty||voiceClipEditor?.dirty||componentEditor?.dirty||characterLibraryEditor?.dirty||textImportEditor?.dirty||performanceEditor?.dirty||scenePerformanceEditor?.dirty||codeEditor.state.dirty),status:text=>{log.textContent=text;editorLayout.showVisualTab('externalFiles');},targetAt:(x,y)=>{const root=document.querySelector('#timeline-scroll'),hit=document.elementFromPoint(x,y),lane=hit?.closest('[data-media-drop-kind]');if(!lane||!root||!root.contains(lane))return null;const atFrame=expressionDropFrame(x,lane.getBoundingClientRect(),Number(root.dataset.extent),current.project.scene.durationFrames);return atFrame===null?null:{kind:lane.dataset.mediaDropKind,atFrame};},selectCreated:rows=>{const r=rows?.[0];if(!r)return;if(r.audioTrackId)selectTimelineIdentity({kind:'audioTracks',id:r.audioTrackId});else if(r.eventId)selectTimelineIdentity({kind:'backgroundEvents',id:r.eventId});else if(r.dialogueId)selectTimelineIdentity({kind:'dialogues',id:r.dialogueId});else if(r.instanceId)componentEditor?.select?.(r.instanceId);else if(r.definitionId)characterLibraryEditor?.select?.(r.definitionId);}});
 scriptPreflightEditor=createScriptPreflightEditor({container:s3Tab('scriptPreflight','剧本预检'),packet:()=>current,api:window.replay});
 s3Drop=createS3Drop({root:document.querySelector('#timeline-scroll'),packet:()=>current,commitCharacter:commitCharacterIntent,previewText:(source,atFrame)=>textImportEditor.commitDrop(atFrame,source),status:text=>{log.textContent=text;},suppressClick:()=>{productionAssets?.suppressClick();suppressTimelineClick=true;}});
 mediaDrop=createMediaDrop({root:document.querySelector('#timeline-scroll'),packet:()=>current,prepare:prepareProductionMutation,commit:commitMediaIntent,status:text=>{log.textContent=text;},suppressClick:()=>productionAssets?.suppressClick()});
 productionDrop=createExpressionDrop({root:document.querySelector('#timeline-scroll'),packet:()=>current,status:text=>productionAssets?.message(text),commit:commitExpressionIntent,suppressClick:()=>productionAssets?.suppressClick()});
 const snapButton=document.createElement('button');snapButton.id='timeline-snap-toggle';snapButton.type='button';snapButton.title='吸附到播放头、片段边界和场景边界；按住 Alt 临时跳过';snapButton.onclick=()=>{cancelTimelineDrag();timelineSnapEnabled=!timelineSnapEnabled;syncTimelineSnapControl();};const snapStatus=document.createElement('span');snapStatus.id='timeline-snap-status';snapStatus.setAttribute('role','status');document.querySelector('#timeline-split').after(snapButton);document.querySelector('#timeline-toolbar-status').append(snapStatus);syncTimelineSnapControl();
 const clipToolbar=document.createElement('div');clipToolbar.id='timeline-character-toolbar';document.querySelector('#timeline-toolbar-actions').append(clipToolbar);
 characterClipEditor=createTimelineItemEditor({root:timeline,toolbar:clipToolbar,packet:()=>current,selection:()=>timelineSelection,selectItem:selectTimelineIdentity,prepare:prepareProductionMutation,refresh:locate,frame:()=>Number(frame.value),status:text=>{log.textContent=text;}});
 document.querySelector('#timeline-toolbar-status').append(document.querySelector('#timeline-item-status'));
 for(const actionName of ['undo','redo']){const proxy=document.querySelector('#timeline-'+actionName),original=document.querySelector('#'+actionName);proxy.disabled=original.disabled;proxy.addEventListener('click',()=>original.click());new MutationObserver(()=>{proxy.disabled=original.disabled;}).observe(original,{attributes:true,attributeFilter:['disabled']});}
 characterRowEditor=createCharacterRowEditor({container:document.querySelector('.image-editor'),packet:()=>current,characterId:()=>selectedCharacterId,prepare:prepareProductionMutation,refresh:locate,status:text=>{log.textContent=text;}});
 characterEventSublanes=createCharacterEventSublanes({packet:()=>current,selectedCharacterId:()=>selectedCharacterId,onToggle:()=>window.editorLayout?.refresh()});
 performanceEditor=createCharacterPerformanceEditor({container:document.querySelector('#character-event-editor-host'),packet:()=>current,characterId:()=>selectedCharacterId,prepare:prepareProductionMutation,refresh:locate,frame:()=>Number(frame.value),dirtyChanged:publishPerformanceDraft,seek:at=>{pausePlayback();syncTransportFrame(at);return locate();}});
 productionAssets=createProductionAssets({packet:()=>current,frame:()=>Number(frame.value),characterId:()=>selectedCharacterId,commit:commitExpressionIntent,begin:(s,e)=>productionDrop.begin(s,e),beginMedia:(s,e)=>mediaDrop.begin(s,e),beginCharacter:(s,e)=>s3Drop.beginCharacter(s,e),selectDefinition:id=>{editorLayout.showVisualTab('characterLibrary');characterEventSublanes?.expand(selectedCharacterId);return characterLibraryEditor.select(id);},status:text=>{log.textContent=text;},showTab:tab=>{if(tab==='expressions')characterEventSublanes?.expand(selectedCharacterId);window.editorLayout?.showVisualTab(tab);},allowSelection:()=>allowProductionSelection({owner:'resource'}),selectCharacter:id=>{if(!allowProductionSelection({owner:'character',id}))return false;selectedCharacterId=id;syncImageEditor(current.project);window.editorLayout?.showVisualTab('character');return true;},selectDialogue:id=>{if(!allowProductionSelection({owner:'dialogue',id,pageId:null}))return false;selectedDialoguePageId=null;selectedDialogueId=id;syncDialogueEditor(current.project);window.editorLayout?.setFocus('audio');},seek:at=>{pausePlayback();syncTransportFrame(at);return locate();}});
}
window.replay.onRecoveryStatus?.(showRecoveryStatus);
window.replay.onState(packet => { if (!packet.project || !packet.state) { showRecoveryStatus(packet); return; } finishPlayheadDrag(); pausePlayback(); productionDrop?.invalidate(packet);mediaDrop?.invalidate(packet);externalFileDrop?.sync(packet); if(current&&current.documentId!==packet.documentId)frame.value=0; locate().catch(error=>{log.textContent='刷新失败：'+error.message;}); });
locate().catch(error => { log.textContent = `错误：${error.message}`; });
