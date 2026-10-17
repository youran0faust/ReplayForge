const {validCanvas, expressionErrors} = require('./portrait.cjs');
const {pagesErrors, pageAt} = require('./dialogue-pages.cjs');
const {dialogueCandidates} = require('./dialogue-semantics.cjs');
const {characterDefinitionErrors,resolveCharacter} = require('./character-definitions.cjs');
const {characterRowsErrors}=require('./character-rows.cjs');
const {performanceErrors,finalizePerformance}=require('./performance-model.cjs');
const {audioEnvelopeErrors}=require('./audio-envelope.cjs');
const {videoErrors,finalizeVideo}=require('./video-model.cjs');
function clone(p) { return JSON.parse(JSON.stringify(p)); }

function validateProject(p) {
  const e = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['invalid project'];
  e.push(...audioEnvelopeErrors(p));
  if (p.scriptSource !== undefined) {
    if(p.schemaVersion!==4)e.push('scriptSource requires schema4');
    e.push(...require('./script-source-record.cjs').validateSourceRecord(p.scriptSource));
  }
  if (![1, 2, 3, 4].includes(p.schemaVersion)) e.push('schemaVersion must be 1, 2, 3 or 4');
  e.push(...characterDefinitionErrors(p),...characterRowsErrors(p.schemaVersion===4?{...p,schemaVersion:3}:p));
  if (p.schemaVersion === 1 && (p.componentDefinitions !== undefined || p.scene?.components !== undefined)) e.push('schema1 cannot contain components');
  if ([2, 3, 4].includes(p.schemaVersion)) e.push(...require('./components-model.cjs').componentErrors(p.schemaVersion===4?{...p,schemaVersion:3}:p));
  if (!p.id) e.push('project id missing');
  if (!p.design || !['width', 'height', 'fps'].every(key => Number.isFinite(p.design[key]) && p.design[key] > 0)) e.push('invalid design');
  const resources = p.resources || [];
  const ids = new Set(resources.map(r => r.id));
  for (const r of resources) if (!r.id || !r.path) e.push('invalid resource');
  if (!p.scene) e.push('scene missing');
  else {
    const scene = p.scene;
    if (!Number.isSafeInteger(scene.durationFrames) || scene.durationFrames <= 0) e.push('scene duration invalid');
    if (scene.background?.resourceId && !ids.has(scene.background.resourceId)) e.push('background resource missing');
    if (scene.backgroundEvents !== undefined && !Array.isArray(scene.backgroundEvents)) e.push('backgroundEvents must be an array');
    const backgroundEventIds = new Set(), backgroundEventFrames = new Set();
    for (const event of Array.isArray(scene.backgroundEvents) ? scene.backgroundEvents : []) {
      if (!event || typeof event !== 'object' || Array.isArray(event)) { e.push('invalid background event'); continue; }
      if (typeof event.id !== 'string' || !event.id.trim() || backgroundEventIds.has(event.id)) e.push('background event id invalid or duplicate');
      backgroundEventIds.add(event.id);
      if (!Number.isSafeInteger(event.frame) || event.frame < 0 || event.frame >= scene.durationFrames || backgroundEventFrames.has(event.frame)) e.push('background event frame invalid or duplicate');
      backgroundEventFrames.add(event.frame);
      const bg = event.background;
      if (!bg || typeof bg !== 'object' || Array.isArray(bg) || !['color', 'image'].includes(bg.kind)) { e.push('background event background invalid'); continue; }
      if ((bg.kind === 'color' || bg.color !== undefined) && (typeof bg.color !== 'string' || !bg.color.trim())) e.push('background event color invalid');
      if (bg.kind === 'color' && bg.resourceId !== undefined) e.push('color background event cannot reference image');
      if (bg.kind === 'image') {
        const resource = resources.find(r => r.id === bg.resourceId);
        if (typeof bg.resourceId !== 'string' || !bg.resourceId.trim() || !resource || resource.kind !== 'image') e.push('background event image resource invalid');
      }
    }
    const characters = Array.isArray(scene.characters) ? scene.characters.map(c=>[3,4].includes(p.schemaVersion)&&c&&typeof c==='object'?resolveCharacter(p,c):c) : [];
    if([3,4].includes(p.schemaVersion))for(const d of Array.isArray(p.characterDefinitions)?p.characterDefinitions:[]){
      if(!d||typeof d!=='object')continue;
      if(Object.hasOwn(d,'portraitCanvas')&&!validCanvas(d.portraitCanvas))e.push('definition portraitCanvas invalid');
      if(d.expressions!==undefined&&!Array.isArray(d.expressions))e.push('definition expressions must be an array');
      const ids=new Set();for(const ex of Array.isArray(d.expressions)?d.expressions:[]){if(!ex||typeof ex!=='object'){e.push('invalid definition expression');continue;}if(typeof ex.id!=='string'||!ex.id.trim()||ids.has(ex.id))e.push('definition expression id invalid or duplicate');ids.add(ex.id);e.push(...expressionErrors(ex,d,resources));}
    }
    const dialogues = Array.isArray(scene.dialogues) ? scene.dialogues : [];
    if (!Array.isArray(scene.characters)) e.push('characters missing');
    if (!Array.isArray(scene.dialogues)) e.push('dialogues missing');
    const characterIds = new Set();
    for (const c of characters) {
      if (!c || typeof c !== 'object') { e.push('invalid character'); continue; }
      if (typeof c.id !== 'string' || !c.id.trim() || c.id === 'narrator' || characterIds.has(c.id)) e.push(`character ${c.id} id invalid or duplicate`);
      else characterIds.add(c.id);
      if (typeof c.name !== 'string' || !c.name.trim()) e.push(`character ${c.id} name invalid`);
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) e.push(`character ${c.id} position invalid`);
      if (!Number.isFinite(c.width) || !Number.isFinite(c.height) || c.width <= 0 || c.height <= 0 || c.width > 8192 || c.height > 8192) e.push(`character ${c.id} dimensions invalid`);
      if (typeof c.color !== 'string' || !c.color.trim()) e.push(`character ${c.id} color invalid`);
      if (!Number.isSafeInteger(c.visibleFrom) || !Number.isSafeInteger(c.visibleTo) || c.visibleFrom < 0 || c.visibleTo <= c.visibleFrom || c.visibleTo > scene.durationFrames) e.push(`character ${c.id} visibility range invalid`);
      for (const field of ['visibilityEvents', 'positionKeyframes']) {
        if (c[field] !== undefined && !Array.isArray(c[field])) e.push(`${field} must be an array`);
        const motionIds = new Set(), motionFrames = new Set();
        for (const event of Array.isArray(c[field]) ? c[field] : []) {
          if (!event || typeof event !== 'object' || Array.isArray(event)) { e.push(`${field} entry invalid`); continue; }
          if (typeof event.id !== 'string' || !event.id.trim() || motionIds.has(event.id)) e.push(`${field} id invalid or duplicate`);
          motionIds.add(event.id);
          if (!Number.isSafeInteger(event.frame) || event.frame < 0 || event.frame > scene.durationFrames || motionFrames.has(event.frame)) e.push(`${field} frame invalid or duplicate`);
          motionFrames.add(event.frame);
          if (field === 'visibilityEvents') {
            if (event.frame >= scene.durationFrames || event.frame < c.visibleFrom || event.frame >= c.visibleTo) e.push('visibilityEvents frame outside base range');
            if (typeof event.visible !== 'boolean') e.push('visibilityEvents visible must be boolean');
          } else {
            if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) e.push('positionKeyframes position invalid');
            if (event.interpolation !== undefined && !['linear', 'hold'].includes(event.interpolation)) e.push('positionKeyframes interpolation invalid');
          }
        }
      }
      if (c.resourceId && !ids.has(c.resourceId)) e.push(`character ${c.id} resource missing`);
      if (Object.hasOwn(c, 'portraitLayers')) e.push('portraitLayers is derived and cannot be persisted');
      if (Object.hasOwn(c, 'portraitCanvas') && !validCanvas(c.portraitCanvas)) e.push('portraitCanvas invalid');
      if (c.expressions !== undefined && !Array.isArray(c.expressions)) e.push('expressions must be an array');
      const expressionIds = new Set();
      for (const expression of Array.isArray(c.expressions) ? c.expressions : []) {
        if (!expression || typeof expression !== 'object' || Array.isArray(expression)) { e.push('invalid expression'); continue; }
        if (typeof expression.id !== 'string' || !expression.id.trim() || expressionIds.has(expression.id)) e.push('expression id invalid or duplicate');
        expressionIds.add(expression.id);
        e.push(...expressionErrors(expression, c, resources));
      }
      if (c.expressionEvents !== undefined && !Array.isArray(c.expressionEvents)) e.push('expressionEvents must be an array');
      const eventIds = new Set(), eventFrames = new Set();
      for (const event of Array.isArray(c.expressionEvents) ? c.expressionEvents : []) {
        if (!event || typeof event !== 'object' || Array.isArray(event)) { e.push('invalid expression event'); continue; }
        if (typeof event.id !== 'string' || !event.id.trim() || eventIds.has(event.id)) e.push('expression event id invalid or duplicate');
        eventIds.add(event.id);
        if (!Number.isSafeInteger(event.frame) || event.frame < 0 || event.frame >= scene.durationFrames || eventFrames.has(event.frame)) e.push('expression event frame invalid or duplicate');
        eventFrames.add(event.frame);
        if (event.expressionId !== null && !expressionIds.has(event.expressionId)) e.push('expression event reference missing');
      }
    }
    const trackIds = new Set();
    if (scene.audioTracks !== undefined && !Array.isArray(scene.audioTracks)) e.push('audioTracks must be an array');
    for (const track of Array.isArray(scene.audioTracks) ? scene.audioTracks : []) {
      if (!track || typeof track !== 'object' || Array.isArray(track)) { e.push('invalid audio track'); continue; }
      if (typeof track.id !== 'string' || !track.id.trim() || trackIds.has(track.id)) e.push('audio track id invalid or duplicate');
      trackIds.add(track.id);
      if (typeof track.name !== 'string' || !track.name.trim()) e.push('audio track name invalid');
      if (!['sfx', 'bgm'].includes(track.kind)) e.push('audio track kind invalid');
      const resource = resources.find(r => r.id === track.resourceId);
      if (!resource || resource.kind !== 'audio' || (resource.sampleRate !== undefined && resource.sampleRate !== 48000) || (resource.durationSamples !== undefined && (!Number.isSafeInteger(resource.durationSamples) || resource.durationSamples <= 0))) e.push('audio track resource invalid');
      const sourceOffset = track.sourceOffsetSamples === undefined ? 0 : track.sourceOffsetSamples;
      if (!Number.isSafeInteger(sourceOffset) || sourceOffset < 0 || !Number.isSafeInteger(sourceOffset + track.durationSamples) || (resource?.durationSamples !== undefined && sourceOffset + track.durationSamples > resource.durationSamples)) e.push('audio track source range invalid or exceeds source');
      if (!Number.isFinite(track.gain) || track.gain < 0 || track.gain > 2) e.push('audio track gain invalid');
      const start = track.startFrame * 48000 / p.design?.fps;
      const end = scene.durationFrames * 48000 / p.design?.fps;
      if (!Number.isSafeInteger(track.startFrame) || track.startFrame < 0 || !Number.isSafeInteger(track.durationSamples) || track.durationSamples <= 0 || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(start + track.durationSamples) || start + track.durationSamples > end) e.push('audio track range invalid or exceeds scene');
    }
    const clipIds = new Set();
    for (const d of dialogues) {
      if ([2, 3, 4].includes(p.schemaVersion)) e.push(...require('./voice-clip-model.cjs').voiceClipsErrors(d,p,clipIds));
      else if (d.voiceClips !== undefined) e.push('schema1 cannot contain voiceClips');
      if (d.speakerId !== 'narrator' && !(p.schemaVersion===4?(Array.isArray(p.characterDefinitions)?p.characterDefinitions:[]).some(def=>def&&typeof d.speakerId==='string'&&def.id===d.speakerId):characterIds.has(d.speakerId))) e.push(`dialogue ${d.id} speaker missing`);
      if (p.schemaVersion===4) {
        if (Object.hasOwn(d,'speaker')) e.push('schema4 uses speakerId, not speaker');
        if (!Number.isSafeInteger(d.displayUntilFrame)) e.push(`dialogue ${d.id} displayUntilFrame required`);
        else if (d.displayUntilFrame<d.endFrame||d.displayUntilFrame>scene.durationFrames) e.push(`dialogue ${d.id} displayUntilFrame invalid`);
      }
      if (!Number.isSafeInteger(d.startFrame) || !Number.isSafeInteger(d.endFrame) || !Number.isSafeInteger(d.revealFrames) || d.revealFrames < 1 || d.revealFrames > d.endFrame - d.startFrame || d.startFrame < 0 || d.endFrame <= d.startFrame || d.endFrame > scene.durationFrames) e.push(`dialogue ${d.id} range invalid`);
      if (!d.text?.[p.locale]) e.push(`dialogue ${d.id} missing locale ${p.locale}`);
      e.push(...pagesErrors(d,p.locale,p.schemaVersion));
      const v=d.voice;
      if(v!==undefined){
        if(!v||typeof v!=='object'||Array.isArray(v)){e.push('voice invalid');continue;}
        const b=v.binding,resource=resources.find(r=>r.id===v.resourceId),offset=v.sourceOffsetSamples===undefined?0:v.sourceOffsetSamples;
        if(b!==undefined&&(!b||typeof b!=='object'||Array.isArray(b)||Reflect.ownKeys(b).some(k=>!['dialogueId','mode','followOffsetFrames'].includes(k))||b.dialogueId!==d.id||!['follow','independent'].includes(b.mode)||(Object.hasOwn(b,'followOffsetFrames')&&(!Number.isSafeInteger(b.followOffsetFrames)||b.mode!=='follow'))))e.push('voice binding invalid');
        const effective=b?.mode==='independent'?v.startFrame:d.startFrame+(b?.followOffsetFrames===undefined?0:b.followOffsetFrames);
        if(b?.mode==='independent'&&!Object.hasOwn(v,'startFrame'))e.push('independent voice requires startFrame');
        if(Object.hasOwn(v,'startFrame')&&(!Number.isSafeInteger(v.startFrame)||v.startFrame<0||b?.mode!=='independent'))e.push('voice materialized start invalid');
        if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(v.durationSamples)||v.durationSamples<=0||!Number.isSafeInteger(offset+v.durationSamples))e.push('voice source range invalid');
        if(resource?.durationSamples!==undefined&&(!Number.isSafeInteger(resource.durationSamples)||resource.durationSamples<=0||offset+v.durationSamples>resource.durationSamples))e.push('voice source duration invalid');
        const total=resource?.durationSamples===undefined?v.sourceDurationSamples:resource.durationSamples;
        if(v.sourceDurationSamples!==undefined&&(!Number.isSafeInteger(v.sourceDurationSamples)||v.sourceDurationSamples<=0||(resource?.durationSamples!==undefined&&v.sourceDurationSamples!==resource.durationSamples)))e.push('voice full source hint invalid');
        if(total!==undefined&&offset+v.durationSamples>total)e.push('voice source range exceeds total');
        if(b===undefined&&(offset!==0||Object.hasOwn(v,'startFrame')||(resource?.durationSamples!==undefined&&v.durationSamples!==resource.durationSamples)))e.push('legacy voice must retain full source and parent timing');
        if(b!==undefined){
          if(!resource||resource.kind!=='audio'||(resource.sampleRate!==undefined&&resource.sampleRate!==48000)||(v.sampleRate!==undefined&&v.sampleRate!==48000))e.push('voice resource invalid');
          const start=effective*48000/p.design?.fps,end=scene.durationFrames*48000/p.design?.fps;
          if(!Number.isSafeInteger(effective)||effective<0||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||!Number.isSafeInteger(start+v.durationSamples)||start+v.durationSamples>end)e.push('voice scene range invalid');
        }
      }
    }
  }
  e.push(...performanceErrors(p),...videoErrors(p));
  return e;
}

function evaluate(p,f){const s=p.scene,bg=clone((s.backgroundEvents||[]).filter(e=>e.frame<=f).sort((a,b)=>b.frame-a.frame)[0]?.background||s.background||{kind:'color',color:'#182338'}),chars=s.characters.map(c=>resolveCharacter(p,c)).filter(c=>f>=c.visibleFrom&&f<c.visibleTo&&((c.visibilityEvents||[]).filter(e=>e.frame<=f).sort((a,b)=>b.frame-a.frame)[0]?.visible??true)).map(c=>{const out=clone(c); const keys=(c.positionKeyframes||[]).slice().sort((a,b)=>a.frame-b.frame),previous=keys.filter(k=>k.frame<=f).at(-1),next=keys.find(k=>k.frame>f); if(previous){const t=next&&previous.interpolation!=='hold'?(f-previous.frame)/(next.frame-previous.frame):0;out.x=(1-t)*previous.x+t*(next?next.x:previous.x);out.y=(1-t)*previous.y+t*(next?next.y:previous.y);} delete out.portraitLayers; const ev=(c.expressionEvents||[]).filter(e=>e.frame<=f).sort((a,b)=>b.frame-a.frame)[0]; const ex=ev&&ev.expressionId!==null?(c.expressions||[]).find(x=>x.id===ev.expressionId):null; if(ex?.mode==='overlay') out.portraitLayers=ex.layers.map(l=>({...l})); else if(ex) out.resourceId=ex.resourceId; return out;}),dialogues=(p.schemaVersion===4?dialogueCandidates(p,f):s.dialogues.filter(d=>f>=d.startFrame&&f<d.endFrame)).map(d=>{const held=p.schemaVersion===4&&f>=d.endFrame,page=pageAt(d,f,p.schemaVersion),progress=held?1:Math.max(0,Math.min(1,(f-page.startFrame+1)/Math.max(1,page.revealFrames))),text=page.text[p.locale]||'',u=Array.from(text);return {...clone(d),...(held?{held:true}:{}),...(d.pages?{pageId:page.id,pageIndex:d.pages.indexOf(page),pageStartFrame:page.startFrame,pageEndFrame:page.endFrame}:{}),text,visibleText:u.slice(0,Math.floor(u.length*progress)).join(''),progress}});return finalizeVideo(finalizePerformance({frame:f,timeSeconds:f/p.design.fps,background:bg,characters:chars,dialogues},p,f),p,f)}
module.exports = {clone, validateProject, evaluate};
