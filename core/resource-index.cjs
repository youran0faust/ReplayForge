const fs=require('fs'),path=require('path');
const {pathToFileURL}=require('url');
function indexProject(project,projectDir){
  const resources=new Map((project.resources||[]).map(r=>[r.id,r])), diagnostics=[], resolved={};
  const root=path.resolve(projectDir);
  for(const r of project.resources||[]){
    if(!r.id||!r.path){diagnostics.push({severity:'error',code:'RESOURCE_INVALID',resourceId:r.id||null,message:'资源缺少 id 或 path'});continue}
    const absolute=path.resolve(root,r.path), relative=path.relative(root,absolute);
    if(relative.startsWith('..')||path.isAbsolute(relative)){diagnostics.push({severity:'error',code:'RESOURCE_OUTSIDE_PROJECT',resourceId:r.id,message:'资源路径必须位于工程目录内'});continue}
    let exists=false, isFile=false, real=absolute;
    try { real=fs.realpathSync(absolute); exists=true; isFile=fs.statSync(real).isFile(); }
    catch (error) { if(error.code!=='ENOENT'&&error.code!=='ENOTDIR') throw error; }
    if(exists&&!path.relative(root,real).startsWith('..')&&!path.isAbsolute(path.relative(root,real))){
      resolved[r.id]={...r,absolute:real,exists:true,url:pathToFileURL(real).href};
      if(!isFile) diagnostics.push({severity:'error',code:'RESOURCE_NOT_FILE',resourceId:r.id,message:`资源不是文件：${r.path}`});
    } else {
      resolved[r.id]={...r,absolute,exists:false,url:pathToFileURL(absolute).href};
      diagnostics.push({severity:'error',code:exists?'RESOURCE_OUTSIDE_PROJECT':'RESOURCE_MISSING',resourceId:r.id,message:exists?'资源路径指向工程目录外':'找不到资源：'+r.path});
    }
  }
  for(const [id,r] of resources){if(r.kind==='audio'&&r.path&&!/\.(wav|mp3|ogg|m4a)$/i.test(r.path))diagnostics.push({severity:'warning',code:'AUDIO_FORMAT_UNCHECKED',resourceId:id,message:'当前仅对 WAV 做时长校验'})}
  return {resources:resolved,diagnostics,hasErrors:diagnostics.some(d=>d.severity==='error')}
}
function readWavInfo(file){const b=fs.readFileSync(file);if(b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE')throw Error('not RIFF/WAVE');let p=12,rate=null,channels=null,bits=null,dataBytes=null;while(p+8<=b.length){const id=b.toString('ascii',p,p+4),size=b.readUInt32LE(p+4);if(id==='fmt '){channels=b.readUInt16LE(p+10);rate=b.readUInt32LE(p+12);bits=b.readUInt16LE(p+22)}if(id==='data')dataBytes=size;p+=8+size+(size%2)}if(!rate||!channels||!bits||dataBytes==null)throw Error('incomplete WAV');return {format:'wav',sampleRate:rate,channels,bitsPerSample:bits,dataBytes,durationSamples:dataBytes/(channels*(bits/8)),durationSeconds:dataBytes/(channels*(bits/8)*rate)}}
function diagnoseAudio(project,dir){const result=indexProject(project,dir);for(const r of project.resources||[]){if(r.kind==='audio'&&result.resources[r.id]?.exists){try{const info=readWavInfo(result.resources[r.id].absolute);result.resources[r.id].audio=info;if(info.format==='wav'&&r.sampleRate&&r.sampleRate!==info.sampleRate)result.diagnostics.push({severity:'error',code:'AUDIO_SAMPLE_RATE_MISMATCH',resourceId:r.id,message:'采样率不匹配'})}catch(e){result.diagnostics.push({severity:'error',code:'AUDIO_INVALID',resourceId:r.id,message:e.message})}}}result.hasErrors=result.diagnostics.some(d=>d.severity==='error');return result}
module.exports={indexProject,readWavInfo,diagnoseAudio};
