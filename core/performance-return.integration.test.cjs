'use strict';
// Real builder, source, disk return package, preflight and portable generator. No loader mocks.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),{createHash}=require('node:crypto');
const {scanAssets}=require('./script-asset-catalog.cjs');
const {preflight,textHash}=require('./script-preflight.cjs');
const {buildScriptProject}=require('./script-project-builder.cjs');
const {createSourceRecord,validateSourceRecord}=require('./script-source-record.cjs');
const {exportScriptText}=require('./script-text-export.cjs');
const {prepareReturnPackage,exportReturnPackage,readReturnMap}=require('./script-return-package.cjs');
const {generatePortableScript}=require('./script-generation-storage.cjs');
const {openPortable}=require('./project-storage.cjs');
const {LAYOUT}=require('./script-pagination-plan.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
const pages=r=>({version:1,sourceHash:r.sourceHash,layout:{...LAYOUT},dialogues:r.preservation?.canPreserve?r.preservation.preservedPages:r.nodes.filter(n=>n.type==='dialogue').map(n=>({nodeId:n.id,pages:[{start:0,end:n.text.length,text:n.text}]}))});
function crc(b){let c=0xffffffff;for(const byte of b){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function png(){const chunk=(name,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;};const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(Buffer.from([0,255,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);}
// Restricted real decoder: checks CRCs/header and inflates precisely this RGBA scanline.
function decodeImage(b){assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');const ids=[];for(let o=8;o<b.length;){const n=b.readUInt32BE(o),type=b.toString('ascii',o+4,o+8);assert.equal(crc(b.subarray(o+4,o+8+n)),b.readUInt32BE(o+8+n));if(type==='IHDR'){assert.equal(n,13);assert.equal(b.readUInt32BE(o+8),1);assert.equal(b.readUInt32BE(o+12),1);assert.equal(b[o+16],8);assert.equal(b[o+17],6);}if(type==='IDAT')ids.push(b.subarray(o+8,o+8+n));o+=n+12;}assert.deepEqual(zlib.inflateSync(Buffer.concat(ids)),Buffer.from([0,255,0,0,255]));return {width:1,height:1};}
function wav(){const b=Buffer.alloc(44+480000*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(96000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
function fixture(t,{media=false,audioFade=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'performance-return-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const assetsRoot=path.join(root,'input'),projectRoot=path.join(root,'project'),outputParent=path.join(root,'return'),generation=path.join(root,'generated');for(const dir of [assetsRoot,projectRoot,outputParent,generation])fs.mkdirSync(dir);
 const config={version:1,characters:media?[{name:'甲',image:'hero.png'},{name:'旁白',voiceCode:'N'}]:[],titleFadeInSeconds:.1,titleHoldSeconds:.3,titleFadeOutSeconds:.1,characterFadeSeconds:.2,screenFadeSeconds:.2,bgmFadeOutSeconds:.2};
 const files=media?[['角色/hero.png',png()],['背景/room.png',png()],['音乐/song.wav',wav()],['配音/N_001_正文.wav',wav()]]:[];
 for(const [name,bytes] of files){const file=path.join(assetsRoot,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
 const text=['# 原标题',...(media?['@背景 room.png 转场=黑屏 时长=0.4秒','@出场 甲 演出=淡入','@音乐 song.wav']:[]),'旁白：正文','@隐藏对白框','@停顿 0.1秒','@显示对白框','@清字幕','@画面 淡出','@画面 淡入',...(media?[audioFade?'@音乐 停止 时长=0.2秒':'@音乐 停止','@退场 甲 演出=淡出']:[]),'@停顿 0.2秒'].join('\n');
 const snapshot={text,config,catalog:scanAssets(assetsRoot),...(!media?{corrections:{version:1,sourceHash:textHash(text),overrides:{'line-2':{status:'unvoiced'}}}}:{})},report=preflight(snapshot);assert(report.ok,JSON.stringify(report.diagnostics));
 const mediaRows=report.assetCatalog.map(a=>({id:a.id,kind:a.kind,path:'assets/'+a.id+(a.kind==='image'?'.png':'.wav'),...(a.kind==='image'?{width:1,height:1}:{sampleRate:48000,channels:1,bitsPerSample:16,durationSamples:480000})}));
 const built=buildScriptProject({config,report,media:mediaRows,schemaVersion:4,paginationPlan:pages(report).dialogues});assert(built.project,JSON.stringify(built.diagnostics));
 const mediaMappings=built.project.resources.map(r=>{const a=report.assetCatalog.find(a=>a.id===r.id),bytes=fs.readFileSync(path.join(assetsRoot,a.relativePath));fs.mkdirSync(path.dirname(path.join(projectRoot,r.path)),{recursive:true});fs.writeFileSync(path.join(projectRoot,r.path),bytes);return {resourceId:r.id,category:a.category,relativePath:a.relativePath,hash:sha(bytes)};});
 built.project.scriptSource=createSourceRecord({text,config,report,...built,mediaMappings});
 return {root,assetsRoot,projectRoot,outputParent,generation,project:built.project,text};
}
function performanceValues(p){const perf=structuredClone(p.scene.performance);for(const [key,list] of Object.entries(perf))if(Array.isArray(list))for(const entry of list){delete entry.id;if(key==='characterOpacity')entry.characterId=p.characterDefinitions.find(d=>d.id===p.scene.characters.find(c=>c.id===entry.characterId).definitionId).name;}return perf;}
for(const {media,audioFade} of [{media:false,audioFade:false},{media:true,audioFade:false},{media:true,audioFade:true}])test('real C title/visual/audio return roundtrip, edited defaults retain saved values '+JSON.stringify({media,audioFade}),async t=>{
 const f=fixture(t,{media,audioFade}),p=f.project;
 if(audioFade)assert.equal(p.scene.audioTracks[0].fadeOutSamples,9600,'real compiler must emit requested 0.2 second BGM fade');assert.equal(p.scene.performance.titles.length,1);assert(p.scene.performance.screenFades.length>=2);assert.equal(p.scene.performance.dialogueVisibility.length,2);assert.equal(p.scene.performance.dialogueClears.length,1);
 if(media)assert.equal(p.scene.performance.characterOpacity.length,2);
 assert.deepEqual(validateSourceRecord(p.scriptSource),[]);assert.equal(exportScriptText(p).text,f.text);
 const oldBindings=structuredClone(p.scriptSource.bindings),stable=p.scriptSource.nodes.find(n=>n.baseline.type==='title').stableId;
 p.scene.performance.titles[0].text='改后标题';p.scene.performance.titles[0].fadeInFrames=1;p.scene.performance.screenFades.at(-1).from=.8;
 if(media){p.scene.performance.characterOpacity[0].from=.2;if(!audioFade)p.scene.audioTracks[0].fadeOutSamples=100;}
 const before=structuredClone(p),prepared=prepareReturnPackage(p);assert.deepEqual(p,before);assert.match(prepared.text,/^# 改后标题/);assert.equal(prepared.source.baselineProject.scene.performance.titles[0].text,'改后标题');assert.equal(prepared.source.nodes.find(n=>n.baseline.type==='title').stableId,stable);assert.equal(prepared.source.bindings[0].textBaseline,oldBindings[0].textBaseline);assert(prepared.losses.some(l=>l.path==='/scene/performance/titles/0/fadeInFrames'));
 const exported=await exportReturnPackage(f),map=readReturnMap(exported.mapFile),assetsRoot=path.join(exported.root,'素材');assert.deepEqual(validateSourceRecord(map.source),[]);
 const config=JSON.parse(fs.readFileSync(path.join(exported.root,'config.json'),'utf8'));Object.assign(config,{titleHoldSeconds:2,characterFadeSeconds:.4,screenFadeSeconds:.4,bgmFadeOutSeconds:.4});
 const snapshot={text:'// relocated\n'+fs.readFileSync(exported.textFile,'utf8'),config,catalog:scanAssets(assetsRoot),reimportSource:map.source},report=preflight(snapshot);assert(report.ok,JSON.stringify(report.diagnostics));assert(report.preservation?.canPreserve,JSON.stringify(report.diagnostics));
 const generated=await generatePortableScript({snapshot,report,paginationPlan:pages(report),assetsRoot,outputParent:f.generation,decodeImage}),opened=openPortable(generated.file).project;
 assert.deepEqual(performanceValues(opened),performanceValues(p));assert.equal(opened.scene.durationFrames,p.scene.durationFrames);assert.deepEqual(validateSourceRecord(opened.scriptSource),[]);assert.equal(opened.scriptSource.bindings[0].textBaseline,oldBindings[0].textBaseline);assert.equal(opened.scriptSource.nodes.find(n=>n.baseline.type==='title').stableId,stable);
 if(media){assert.equal(opened.scene.audioTracks[0].fadeOutSamples,audioFade?9600:100);assert.equal(opened.scene.audioTracks[0].durationSamples,p.scene.audioTracks[0].durationSamples);assert.equal(opened.scene.dialogues[0].voiceClips[0].durationSamples,p.scene.dialogues[0].voiceClips[0].durationSamples);}
 const changed=preflight({...snapshot,text:snapshot.text.replace('# 改后标题','# 再改标题')});assert(!changed.preservation?.canPreserve);assert(changed.diagnostics.some(d=>d.code==='REIMPORT_RECOMPILE'));
 fs.rmSync(assetsRoot,{recursive:true,force:true});assert.deepEqual(openPortable(generated.file).project,opened);
});
