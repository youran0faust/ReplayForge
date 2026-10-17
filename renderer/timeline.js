/* Pure timeline model and geometry; usable in Node and the renderer. */
(function (root) {
  'use strict';
  const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const list = value => Array.isArray(value) ? value : [];
  function formatTimelineNumber(value) { return String(Number(finite(value).toFixed(3))); }
  // Reduce decoded mono samples to at most maxBins peak pairs for lightweight rendering.
  function downsampleWaveform(samples, maxBins = 128) {
    const values = samples && typeof samples.length === 'number' ? samples : [];
    const bins = Math.max(1, Math.min(128, Math.floor(finite(maxBins, 128))));
    const out = [];
    for (let i = 0; i < bins; i++) {
      const from = Math.floor(i * values.length / bins), to = Math.max(from + 1, Math.floor((i + 1) * values.length / bins));
      let min = 0, max = 0;
      for (let j = from; j < Math.min(to, values.length); j++) { const v = finite(Number(values[j])); min = Math.min(min, v); max = Math.max(max, v); }
      out.push([min, max]);
    }
    return out;
  }
  function timelineFrameAt(clientX, rect, durationFrames) {
    const duration = Math.max(0, Math.floor(finite(durationFrames)));
    if (!duration || !rect || finite(rect.width) <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, (finite(clientX, finite(rect.left)) - finite(rect.left)) / rect.width));
    return Math.min(duration - 1, Math.floor(ratio * duration));
  }
  // Empty/invalid durations normalize to one frame: a nonempty interval needs a domain.
  function calculateTimelineDrag({startFrame, endFrame, mode, deltaFrames, durationFrames} = {}) {
    const duration = Math.max(1, Math.floor(finite(durationFrames, 1)));
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    let start = clamp(Math.round(finite(startFrame)), 0, duration - 1);
    let end = clamp(Math.round(finite(endFrame, start + 1)), start + 1, duration);
    const delta = Math.round(finite(deltaFrames));
    if (mode === 'move') {
      const length = end - start;
      start = clamp(start + delta, 0, duration - length); end = start + length;
    } else if (mode === 'start') start = clamp(start + delta, 0, end - 1);
    else if (mode === 'end') end = clamp(end + delta, start + 1, duration);
    return {startFrame: start, endFrame: end};
  }
  function calculateGroupDrag({startFrame,endFrame,mode,deltaFrames,durationFrames,pages,pageId} = {}) {
    const delta=Math.round(finite(deltaFrames)), clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
    if(mode==='boundary') {const i=pages.findIndex(p=>p.id===pageId),left=pages[i],right=pages[i+1];if(!left||!right)throw Error('Invalid page divider');return {startFrame:left.startFrame,endFrame:clamp(left.endFrame+delta,left.startFrame+1,right.endFrame-1)};}
    if(mode==='start')return {startFrame:clamp(startFrame+delta,0,pages[0].endFrame-1),endFrame};
    if(mode==='end')return {startFrame,endFrame:clamp(endFrame+delta,pages[pages.length-1].startFrame+1,durationFrames)};
    return calculateTimelineDrag({startFrame,endFrame,mode,deltaFrames,durationFrames});
  }
  // Integer-frame deltas, sample-native lengths: retain a source's fractional final frame.
  function calculateAudioTrackDrag({startFrame,sourceOffsetSamples=0,durationSamples,sourceDurationSamples,durationFrames,fps,mode,deltaFrames}={}) {
    const spf=48000/fps,scene=durationFrames*spf,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
    if(!Number.isSafeInteger(spf)||spf<=0||!Number.isSafeInteger(scene)||!Number.isSafeInteger(startFrame)||!Number.isSafeInteger(sourceOffsetSamples)||sourceOffsetSamples<0||!Number.isSafeInteger(durationSamples)||durationSamples<=0||startFrame<0||startFrame*spf+durationSamples>scene)throw Error('音轨时间无法按整数样本编辑');
    let delta=Math.round(finite(deltaFrames)),start=startFrame,offset=sourceOffsetSamples,length=durationSamples;
    if(mode==='move')start=clamp(start+delta,0,Math.floor((scene-length)/spf));
    else {
      if(!Number.isSafeInteger(sourceDurationSamples)||sourceDurationSamples<=0||offset+length>sourceDurationSamples)throw Error('缺少有效源音频总时长，不能裁剪');
      if(mode==='start'){delta=clamp(delta,Math.max(-start,Math.ceil(-offset/spf)),Math.floor((length-1)/spf));start+=delta;offset+=delta*spf;length-=delta*spf;}
      else if(mode==='end'){delta=clamp(delta,Math.ceil((1-length)/spf),Math.floor(Math.min(sourceDurationSamples-offset-length,scene-start*spf-length)/spf));length+=delta*spf;}
      else throw Error('无效音轨拖动模式');
    }
    return {startFrame:start,sourceOffsetSamples:offset,durationSamples:length};
  }
  function characterVisibleSegments(character, durationFrames) {
    const start=Math.max(0,finite(character.visibleFrom)),end=Math.min(durationFrames,finite(character.visibleTo,durationFrames));
    const segments=[];let cursor=start,visible=true;
    const events=list(character.visibilityEvents).filter(e=>e&&Number.isFinite(e.frame)&&typeof e.visible==='boolean').slice().sort((a,b)=>a.frame-b.frame);
    for(const event of events){
      if(event.frame<=start){visible=event.visible;continue;}
      if(event.frame>=end)break;
      if(event.visible===visible)continue;
      if(visible&&event.frame>cursor)segments.push({startFrame:cursor,endFrame:event.frame});
      visible=event.visible;cursor=event.frame;
    }
    if(visible&&end>cursor)segments.push({startFrame:cursor,endFrame:end});
    return segments;
  }
  function buildTimelineModel(project, resourceUrls) {
    const scene = project?.scene || {};
    const durationFrames = Math.max(0, finite(scene.durationFrames));
    const fps = Math.max(0, finite(project?.design?.fps));
    const warnings = [];
    const resources = new Map(list(project?.resources).map(resource => [resource.id, resource]));
    // Read-only projection: instance timing/identity stays local; appearance belongs to its definition.
    const characters = list(scene.characters).map(instance => {
      if (![3,4].includes(project?.schemaVersion)) return instance;
      if (root.CharacterDefinitions?.resolveCharacter) return root.CharacterDefinitions.resolveCharacter(project, instance) || instance;
      const definition = list(project.characterDefinitions).find(d => d.id === instance.definitionId);
      return definition ? {...definition, ...instance, name:definition.name, expressions:definition.expressions} : instance;
    });
    const tracks = [
      {kind: 'characters', label: '角色', items: characters.map(character => {
        const expressions = list(character.expressions);
        const expressionName = new Map(expressions.map(expression => [expression.id, expression.name || expression.id]));
        // Event order in persisted projects is not guaranteed; keep the source untouched.
        const events = list(character.expressionEvents).map((event, index) => ({
          id: event?.id || `expression-event-${index}`,
          frame: finite(event?.frame),
          expressionId: event?.expressionId || null,
          label: event?.label || expressionName.get(event?.expressionId) || event?.expressionId || '基础立绘'
        })).sort((a, b) => a.frame - b.frame || String(a.id).localeCompare(String(b.id)));
        return {id: character.id, label: character.name || character.id, startFrame: finite(character.visibleFrom),
          endFrame: finite(character.visibleTo, durationFrames), events,
          ...(list(character.visibilityEvents).length ? {visibilityControlled:true,segments:characterVisibleSegments(character,durationFrames)} : {}),
          ...(character.resourceId ? {resourceId: character.resourceId} : {})};
      })},
      {kind: 'dialogues', label: '对白', items: list(scene.dialogues).map(dialogue => ({
        id: dialogue.id, label: dialogue.text?.[project?.locale] || dialogue.id,
        startFrame: finite(dialogue.startFrame), endFrame: finite(dialogue.endFrame),
        ...(list(dialogue.pages).length ? {group:true, children:dialogue.pages.map((page,index)=>({id:page.id,dialogueId:dialogue.id,label:`${index+1} · ${page.text?.[project?.locale] || page.id}`,startFrame:finite(page.startFrame),endFrame:finite(page.endFrame)}))} : {})
      }))},
      {kind: 'audio', label: '配音', items: []}
    ];
    for(const [laneKey,label] of [['bgm','音乐'],['sfx','音效']]) tracks.push({kind:'audioTracks',laneKey,label,items:[]});
    const voiceClipLane = {kind:'voiceClips',label:'配音片段',items:[]};
    if (list(scene.dialogues).some(dialogue=>dialogue.voiceClips !== undefined)) tracks.splice(3,0,voiceClipLane);
    for (const dialogue of list(scene.dialogues)) {
      const isClip = dialogue.voiceClips !== undefined;
      for (const voice of isClip ? list(dialogue.voiceClips) : (dialogue.voice ? [dialogue.voice] : [])) {
      const {resourceId, durationSamples} = voice;
      const independent=voice.binding?.mode==='independent';
      const startFrame = independent ? finite(voice.startFrame) : finite(dialogue.startFrame)+finite(voice.binding?.followOffsetFrames);
      const bindingMode=independent?'independent':'follow';
      const endFrame = startFrame + finite(durationSamples) / 48000 * fps;
      const itemWarnings = [];
      if (!resourceId || !resources.has(resourceId) || (resourceUrls !== undefined && !resourceUrls?.[resourceId])) {
        itemWarnings.push(`配音资源缺失 (missing voice resource): ${resourceId || dialogue.id}`);
      }
      if (!Number.isFinite(durationSamples) || durationSamples < 0 || !fps || !Number.isFinite(endFrame)) {
        itemWarnings.push(`配音时长无效 (invalid audio duration): ${dialogue.id}`);
      }
      if (endFrame > durationFrames) itemWarnings.push(`配音超出场景 (audio overflow): ${dialogue.id} · ${formatTimelineNumber(endFrame)} > ${formatTimelineNumber(durationFrames)}`);
      if(startFrame!==dialogue.startFrame || endFrame<=dialogue.startFrame || startFrame>=dialogue.endFrame)itemWarnings.push(`配音与对白时间不一致（仅提示，不自动调整）：${dialogue.id}`);
      warnings.push(...itemWarnings);
      (isClip ? voiceClipLane : tracks[2]).items.push({id: isClip ? voice.id : dialogue.id,
        ...(isClip ? {dialogueId:dialogue.id} : {}), bindingMode, label: `${independent?'未联动':'绑定'} · ${resourceId || dialogue.id} · ${dialogue.id}`, startFrame,
        endFrame: finite(endFrame, startFrame), resourceId, sourceOffsetSamples: voice.sourceOffsetSamples ?? 0, durationSamples, ...(itemWarnings.length ? {warning: itemWarnings.join('\n')} : {})});
      }
    }
    for (const audio of list(scene.audioTracks)) {
      const audioTrackLane=tracks.find(track=>track.kind==='audioTracks'&&track.laneKey===audio.kind);if(!audioTrackLane)continue;
      const startFrame = finite(audio.startFrame), endFrame = startFrame + finite(audio.durationSamples) / 48000 * fps;
      const itemWarnings = [];
      if (!audio.resourceId || !resources.has(audio.resourceId) || (resourceUrls !== undefined && !resourceUrls?.[audio.resourceId])) itemWarnings.push(`音轨资源缺失 (missing audio resource): ${audio.resourceId || audio.id}`);
      if (!Number.isFinite(audio.durationSamples) || audio.durationSamples < 0 || !fps || !Number.isFinite(endFrame)) itemWarnings.push(`音轨时长无效 (invalid audio duration): ${audio.id}`);
      if (endFrame > durationFrames) itemWarnings.push(`音轨超出场景 (audio overflow): ${audio.id}`);
      if (!Number.isFinite(audio.gain) || audio.gain < 0 || audio.gain > 2) itemWarnings.push(`音轨增益无效 (invalid gain): ${audio.id}`);
      warnings.push(...itemWarnings); audioTrackLane.items.push({id: audio.id, label: audio.name || audio.kind || audio.id, startFrame, endFrame, resourceId: audio.resourceId, sourceOffsetSamples: audio.sourceOffsetSamples ?? 0, durationSamples: audio.durationSamples, ...(itemWarnings.length ? {warning: itemWarnings.join('\n')} : {})});
    }
    const imageDefinitions=new Map(list(project?.componentDefinitions).filter(d=>list(d.elements).some(e=>e.type==='image')).map(d=>[d.id,d]));
    tracks.push({kind:'components',label:'图片',items:list(scene.components).filter(i=>imageDefinitions.has(i.definitionId)).map(i=>({id:i.id,label:imageDefinitions.get(i.definitionId).name||i.id,startFrame:finite(i.visibleFrom),endFrame:finite(i.visibleTo,durationFrames)}))});
    // Character instances own stable rows in scene order, never interval-packed.
    // Dialogue/audio tracks retain their existing overlap-based display packing.
    for (const track of tracks) {
      if (track.kind === 'characters') {
        let top = 0;
        const rowApi=typeof module!=='undefined'&&module.exports?require('../core/character-rows.cjs'):root.CharacterRows;
        const rows=rowApi?rowApi.effectiveCharacterRows(project):[...list(scene.characterRows),...track.items.filter(item=>!list(scene.characterRows).some(r=>r.characterIds.includes(item.id))).map(item=>({id:'implicit:'+item.id,name:item.label,characterIds:[item.id]}))];
        for (const row of rows) {
          const items=row.characterIds.map(id=>track.items.find(item=>item.id===id)).filter(Boolean),height=items.some(item=>item.visibilityControlled)?54:28;
          for(const item of items){item.top=top;item.height=height;item.rowId=row.id;item.rowName=row.name;}
          top+=height;
        }
        continue;
      }
      const rows = [];
      for (const item of track.items) {
        let row = rows.findIndex(intervals => intervals.every(other => item.endFrame <= other.startFrame || item.startFrame >= other.endFrame));
        if (row < 0) { row = rows.length; rows.push([]); }
        rows[row].push(item); item.row = row;
      }
      let top = 0;
      for (const row of rows) {
        const height = row.some(item=>item.group || item.visibilityControlled) ? 54 : 28;
        for (const item of row) { item.top=top; item.height=height; delete item.row; }
        top += height;
      }
    }
    return {durationFrames, tracks, warnings};
  }
  const api = {buildTimelineModel, timelineFrameAt, formatTimelineNumber, downsampleWaveform, calculateTimelineDrag, calculateGroupDrag, calculateAudioTrackDrag};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
