'use strict';
// Deliberately non-speech placeholders: never claim these tones are TTS or a human voice.
const fs=require('node:fs'),path=require('node:path');
const {parseScript}=require('./core/script-parser.cjs');
const {parseVoiceWav}=require('./core/voice-import.cjs');
const {scanAssets,readConfig}=require('./core/script-asset-catalog.cjs');
const {preflight,textHash}=require('./core/script-preflight.cjs');
const root=path.resolve(__dirname,'../test-output/P2/b3-watch-sample-source');
const script=path.join(root,'窗边约定.md'),assets=path.join(root,'assets'),config=path.join(root,'config.json');
const text=fs.readFileSync(script,'utf8').replace(/^\uFEFF/,''),parsed=parseScript(text);
if(parsed.diagnostics.some(d=>(d.severity||d.level)==='error'))throw Error(JSON.stringify(parsed.diagnostics));
const spoken=parsed.nodes.filter(n=>n.type==='dialogue'&&n.speaker==='小窗');if(spoken.length!==2)throw Error('Expected two voiced character lines');
const rate=48000,amplitude=.12,voiceDir=path.join(assets,'配音');fs.mkdirSync(voiceDir,{recursive:true});
function wav(seconds,seed){
 const samples=seconds*rate,out=Buffer.alloc(44+samples*2);out.write('RIFF',0);out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*2,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(samples*2,40);
 let phase=0;for(let i=0;i<samples;i++){
  const t=i/rate,segment=Math.floor(t/.73),u=t/.73-segment;
  // Seeded deterministic motif: each segment differs in frequency, tremolo and envelope.
  let h=Math.imul(segment+1,2654435761)^Math.imul(seed,2246822519);h=(h^(h>>>16))>>>0;
  const frequency=185+(h%277)+21*Math.sin(2*Math.PI*u),pulse=.48+.52*Math.pow(Math.sin(Math.PI*u),2),tremolo=.82+.18*Math.sin(2*Math.PI*(2+(h%5))*t);
  phase+=2*Math.PI*frequency/rate;
  const fade=Math.min(1,t/.12,(seconds-t)/.18),signal=.72*Math.sin(phase)+.20*Math.sin(phase*2+.3)+.08*Math.sin(2*Math.PI*(91+seed*17)*t);
  out.writeInt16LE(Math.round(32767*amplitude*fade*pulse*tremolo*signal),44+i*2);
 }
 return out;
}
const voices=spoken.map((node,i)=>{
 const excerpt=node.text.replace(/[\s\p{P}]/gu,''),name=`CHA_${String(i+1).padStart(3,'0')}_${excerpt}.wav`;if(name.length>255)throw Error('Filename component too long');
 const file=path.join(voiceDir,name),seconds=i===0?48:8;fs.writeFileSync(file,wav(seconds,i+1));const info=parseVoiceWav(fs.readFileSync(file));
 return {speaker:node.speaker,nodeId:node.id,text:node.text,file,...info,seconds:info.durationSamples/rate,voiceName:'synthetic-tone-placeholder',rate:null,tts:false,synthetic:true,placeholder:true,amplitude,patternSeed:i+1,filenameCharacters:name.length};
});
const unvoicedNodeIds=parsed.nodes.filter(n=>n.type==='dialogue'&&n.speaker==='旁白').map(n=>n.id);
const report=preflight({text,config:readConfig(config),catalog:scanAssets(assets),corrections:{version:1,sourceHash:textHash(text),overrides:Object.fromEntries(unvoicedNodeIds.map(id=>[id,{status:'unvoiced'}]))}});
if(!report.ok||report.summary.voices.matched!==2)throw Error(JSON.stringify(report.diagnostics));
const metadata={title:'窗边约定',script,assets,config,voices,unvoicedSpeaker:'旁白',unvoicedNodeIds,syntheticSpeech:false,syntheticPlaceholder:true,tts:false,description:'原创中文剧本；音频为用户授权的合成音型占位，不是TTS，不是真人，不含中文语音。48秒与8秒两段用于观看字幕时间和验证音频连续性。',audioFormat:{formatTag:1,sampleRate:rate,channels:1,bitsPerSample:16},voiceSeconds:56,durationNote:'真实分页后总长=56秒+无声页数*3秒+停顿1.2秒；两页长无声和一页短无声时66.2秒。',assetProvenance:{project:'P2/fixtures/original-scene-project/场景.json',resources:['background','portrait_base']},preflightSummary:report.summary,voiceBindings:report.bindings};
const file=path.join(root,'source.json');fs.writeFileSync(file,JSON.stringify(metadata,null,2));console.log(JSON.stringify({source:file,voiceSeconds:56,unvoicedNodeIds,voices:voices.map(v=>({seconds:v.seconds,durationSamples:v.durationSamples,filenameCharacters:v.filenameCharacters})),summary:report.summary},null,2));
