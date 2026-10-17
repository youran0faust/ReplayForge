import {componentErrors} from './components-model.cjs';
import {characterDefinitionErrors,resolveCharacter} from './character-definitions.cjs';
import {characterRowsErrors} from './character-rows.cjs';
import {voiceClipsErrors} from './voice-clip-model.cjs';
import {validCanvas, expressionErrors} from './portrait.cjs';
import {pagesErrors, pageAt} from './dialogue-pages.cjs';
import {dialogueCandidates} from './dialogue-semantics.cjs';
import {performanceErrors,finalizePerformance} from './performance-model.cjs';
import {audioEnvelopeErrors} from './audio-envelope.cjs';
import {videoErrors,finalizeVideo} from './video-model.cjs';
import {validateSourceRecord} from './script-source-record.cjs';
export type ScriptSourceRecord = {version:1;text:string;config:Record<string,unknown>;nodes:{stableId:string;nodeId:string;baseline:Record<string,unknown>;objects:{type:string;id:string}[]}[];bindings:Record<string,unknown>[];mediaMappings:{resourceId:string;category:string;relativePath:string;hash:string}[];baselineProject:Project};
export type DialoguePage = {id:string;text:Record<string,string>;startFrame:number;endFrame:number;revealFrames:number};
export type Resource = {id:string;name?:string;kind:'image'|'audio'|'video'|'font';path:string;mime?:string;sampleRate?:number;channels?:number;bitsPerSample?:number;durationSamples?:number;width?:number;height?:number;fps?:number;frameCount?:number;normalizationVersion?:1;audioResourceId?:string};
export type VideoResource = Resource & {kind:'video';mime:'video/mp4';width:number;height:number;fps:30;frameCount:number;normalizationVersion:1};
export type VideoClip = {id:string;resourceId:string;startFrame:number;endFrame:number};
export type ActiveVideo = {clipId:string;resourceId:string;localFrame:number;width:number;height:number;audioResourceId?:string};
export type AudioTrack = {id:string;name:string;kind:'sfx'|'bgm';resourceId:string;startFrame:number;sourceOffsetSamples?:number;durationSamples:number;gain:number;fadeOutSamples?:number};
export type Frame = number;
export type Project = {scriptSource?:ScriptSourceRecord;schemaVersion:1|2|3|4; characterDefinitions?:CharacterDefinition[]; componentDefinitions?:ComponentDefinition[]; id:string; title:string; design:{width:number;height:number;fps:number}; locale:string; resources?:Resource[]; scene:Scene};
export type ComponentDefinition = {id:string;name:string;kind:'dialogue-ui'|'decoration';roles?:('body'|'speaker')[];designSize:{width:number;height:number};scaleMode:'uniform';visibility:'when-active-dialogue'|'instance-range';elements:Record<string,unknown>[]};
export type ComponentInstance = {id:string;definitionId:string;groupId?:string;x:number;y:number;width:number;height:number;zIndex:number;locked:boolean;visibleFrom:number;visibleTo:number};
export type VoiceClip = {id:string;resourceId:string;sampleRate:48000;sourceOffsetSamples:number;durationSamples:number;sourceDurationSamples?:number;binding:{dialogueId:string;mode:'follow'|'independent';followOffsetFrames?:number};startFrame?:number};
export type CharacterRow = {id:string;name:string;characterIds:string[]};
export type OpacityTrack = {id:string;startFrame:number;endFrame:number;from:number;to:number};
export type TitleStyle = {fontSize?:number;color?:string;align?:'left'|'center'|'right'};
export type PerformanceTitle = {id:string;startFrame:number;endFrame:number;fadeInFrames:number;fadeOutFrames:number;text:string;style?:TitleStyle};
export type Performance = {version:1;characterOpacity?:(OpacityTrack & {characterId:string})[];screenFades?:OpacityTrack[];dialogueVisibility?:{id:string;frame:number;visible:boolean}[];dialogueClears?:{id:string;frame:number}[];titles?:PerformanceTitle[]};
export type PerformanceProjection = {characterOpacity:Record<string,number>;screenOpacity:number;dialogueVisible:boolean;clearFrame:number|null;title:{text:string;opacity:number;style?:TitleStyle}|null};
export type EvaluatedDialogue = Omit<Dialogue,'text'> & {text:string;visibleText:string;progress:number;held?:boolean;pageId?:string;pageIndex?:number;pageStartFrame?:number;pageEndFrame?:number};
export type EvaluatedState = {activeVideo?:ActiveVideo|null;frame:number;timeSeconds:number;background:Background;characters:(Character & {portraitLayers?:PortraitLayer[];opacity?:number})[];dialogues:EvaluatedDialogue[];performance?:Pick<PerformanceProjection,'screenOpacity'|'title'|'dialogueVisible'>};
export type Scene = {videoClips?:VideoClip[];performance?:Performance;characterRows?:CharacterRow[];components?:ComponentInstance[];id:string; durationFrames:number; background?:Background; backgroundEvents?:BackgroundEvent[]; characters:(Character|CharacterInstance)[]; dialogues:Dialogue[]; audioTracks?:AudioTrack[]};
export type Background = {kind:'color'|'image'|'video'; color?:string; resourceId?:string; sourceOffsetFrames?:number; loop?:{startFrame:number;endFrame:number}};
export type BackgroundEvent = {id:string;frame:number;background:{kind:'color';color:string;resourceId?:never}|{kind:'image';resourceId:string;color?:string}};
export type PortraitCanvas = {width:number;height:number};
export type PortraitLayer = {id:string;resourceId:string;x:number;y:number;width:number;height:number};
export type Expression = {id:string;name:string} & ({mode?:'replace';resourceId:string;layers?:never}|{mode:'overlay';layers:PortraitLayer[];resourceId?:never});
export type ExpressionEvent = {id:string;frame:number;expressionId:string|null};
export type VisibilityEvent = {id:string;frame:number;visible:boolean};
export type PositionKeyframe = {id:string;frame:number;x:number;y:number;interpolation?:'linear'|'hold'};
export type CharacterDefinition = {id:string;name:string;color:string;resourceId?:string;portraitCanvas?:PortraitCanvas;expressions?:Expression[]};
export type CharacterInstance = {id:string;definitionId:string;x:number;y:number;width:number;height:number;visibleFrom:number;visibleTo:number;expressionEvents?:ExpressionEvent[];visibilityEvents?:VisibilityEvent[];positionKeyframes?:PositionKeyframe[]};
// Character is the legacy/evaluated rendering shape, never the schema3 persistent instance.
export type Character = {definitionId?:string;visibilityEvents?:VisibilityEvent[];positionKeyframes?:PositionKeyframe[];id:string; name:string; resourceId?:string; portraitCanvas?:PortraitCanvas; expressions?:Expression[]; expressionEvents?:ExpressionEvent[]; x:number; y:number; width:number; height:number; color:string; visibleFrom:number; visibleTo:number};
export type Dialogue = {fullText?:Record<string,string>;displayUntilFrame?:number;voiceClips?:VoiceClip[];pages?:DialoguePage[];id:string; speakerId:string; text:Record<string,string>; startFrame:number; endFrame:number; revealFrames:number; voice?:{resourceId:string;durationSamples:number;sampleRate?:number;startFrame?:number;sourceOffsetSamples?:number;sourceDurationSamples?:number;binding?:{dialogueId:string;mode:'follow'|'independent';followOffsetFrames?:number}}};
export const cloneProject = (p:Project):Project => JSON.parse(JSON.stringify(p));
export function validateProject(p:Project):string[] {
  const e:string[] = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['invalid project'];
  e.push(...audioEnvelopeErrors(p));
  if (p.scriptSource !== undefined) {
    if(p.schemaVersion!==4)e.push('scriptSource requires schema4');
    e.push(...validateSourceRecord(p.scriptSource));
  }
  if (![1, 2, 3, 4].includes(p.schemaVersion)) e.push('schemaVersion must be 1, 2, 3 or 4');
  e.push(...characterDefinitionErrors(p),...characterRowsErrors(p.schemaVersion===4?{...p,schemaVersion:3}:p));
  if (p.schemaVersion === 1 && (p.componentDefinitions !== undefined || p.scene?.components !== undefined)) e.push('schema1 cannot contain components');
  if ([2, 3, 4].includes(p.schemaVersion)) e.push(...componentErrors(p.schemaVersion===4?{...p,schemaVersion:3}:p));
  if (!p.id) e.push('project id missing');
  if (!p.design || !(['width', 'height', 'fps'] as const).every(key => Number.isFinite(p.design[key]) && p.design[key] > 0)) e.push('invalid design');
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
    const characterIds = new Set<string>();
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
            if (!('visible' in event) || typeof event.visible !== 'boolean') e.push('visibilityEvents visible must be boolean');
          } else {
            if (!('x' in event) || !('y' in event) || !Number.isFinite(event.x) || !Number.isFinite(event.y)) e.push('positionKeyframes position invalid');
            if ('interpolation' in event && event.interpolation !== undefined && !['linear', 'hold'].includes(event.interpolation)) e.push('positionKeyframes interpolation invalid');
          }
        }
      }
      if (c.resourceId && !ids.has(c.resourceId)) e.push(`character ${c.id} resource missing`);
      if (Object.prototype.hasOwnProperty.call(c, 'portraitLayers')) e.push('portraitLayers is derived and cannot be persisted');
      if (Object.prototype.hasOwnProperty.call(c, 'portraitCanvas') && !validCanvas(c.portraitCanvas)) e.push('portraitCanvas invalid');
      if (c.expressions !== undefined && !Array.isArray(c.expressions)) e.push('expressions must be an array');
      const expressionIds = new Set<string>();
      for (const expression of Array.isArray(c.expressions) ? c.expressions : []) {
        if (!expression || typeof expression !== 'object' || Array.isArray(expression)) { e.push('invalid expression'); continue; }
        if (typeof expression.id !== 'string' || !expression.id.trim() || expressionIds.has(expression.id)) e.push('expression id invalid or duplicate');
        expressionIds.add(expression.id);
        e.push(...expressionErrors(expression, c, resources));
      }
      if (c.expressionEvents !== undefined && !Array.isArray(c.expressionEvents)) e.push('expressionEvents must be an array');
      const eventIds = new Set<string>(), eventFrames = new Set();
      for (const event of Array.isArray(c.expressionEvents) ? c.expressionEvents : []) {
        if (!event || typeof event !== 'object' || Array.isArray(event)) { e.push('invalid expression event'); continue; }
        if (typeof event.id !== 'string' || !event.id.trim() || eventIds.has(event.id)) e.push('expression event id invalid or duplicate');
        eventIds.add(event.id);
        if (!Number.isSafeInteger(event.frame) || event.frame < 0 || event.frame >= scene.durationFrames || eventFrames.has(event.frame)) e.push('expression event frame invalid or duplicate');
        eventFrames.add(event.frame);
        if (event.expressionId !== null && !expressionIds.has(event.expressionId)) e.push('expression event reference missing');
      }
    }
    const trackIds = new Set<string>();
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
      if ([2, 3, 4].includes(p.schemaVersion)) e.push(...voiceClipsErrors(d,p,clipIds));
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
export function evaluate(project:Project,frame:Frame){const s=project.scene,bg=JSON.parse(JSON.stringify((s.backgroundEvents||[]).filter(e=>e.frame<=frame).sort((a,b)=>b.frame-a.frame)[0]?.background??s.background??{kind:'color',color:'#182338'})),chars=s.characters.map(c=>resolveCharacter(project,c)).filter(c=>frame>=c.visibleFrom&&frame<c.visibleTo&&((c.visibilityEvents||[]).filter(e=>e.frame<=frame).sort((a,b)=>b.frame-a.frame)[0]?.visible??true)).map(c=>{const out:Character & {portraitLayers?:PortraitLayer[]}=JSON.parse(JSON.stringify(c)); const keys=(c.positionKeyframes||[]).slice().sort((a,b)=>a.frame-b.frame),previous=keys.filter(k=>k.frame<=frame).at(-1),next=keys.find(k=>k.frame>frame); if(previous){const t=next&&previous.interpolation!=='hold'?(frame-previous.frame)/(next.frame-previous.frame):0;out.x=(1-t)*previous.x+t*(next?next.x:previous.x);out.y=(1-t)*previous.y+t*(next?next.y:previous.y);} delete out.portraitLayers; const ev=(c.expressionEvents||[]).filter(e=>e.frame<=frame).sort((a,b)=>b.frame-a.frame)[0]; const ex=ev&&ev.expressionId!==null?(c.expressions||[]).find(x=>x.id===ev.expressionId):null; if(ex?.mode==='overlay') out.portraitLayers=ex.layers.map(l=>({...l})); else if(ex) out.resourceId=ex.resourceId; return out;}),dialogues=(project.schemaVersion===4?dialogueCandidates(project,frame):s.dialogues.filter(d=>frame>=d.startFrame&&frame<d.endFrame)).map(d=>{const held=project.schemaVersion===4&&frame>=d.endFrame,page=pageAt(d,frame,project.schemaVersion),progress=held?1:Math.max(0,Math.min(1,(frame-page.startFrame+1)/Math.max(1,page.revealFrames))),text=page.text[project.locale]??'',units=Array.from(text);return {...JSON.parse(JSON.stringify(d)),...(held?{held:true}:{}),...(d.pages?{pageId:page.id,pageIndex:d.pages.indexOf(page),pageStartFrame:page.startFrame,pageEndFrame:page.endFrame}:{}),text,visibleText:units.slice(0,Math.floor(units.length*progress)).join(''),progress}});return finalizeVideo(finalizePerformance({frame,timeSeconds:frame/project.design.fps,background:bg,characters:chars,dialogues},project,frame),project,frame)}
