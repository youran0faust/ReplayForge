'use strict';
// Sustained real WAV/AudioContext exercise of the production loader in the full editor.
const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const runId=process.env.REPLAY_CACHE_RUN_ID||crypto.randomUUID(),startedAt=new Date().toISOString();
const root=fs.mkdtempSync(path.join(__dirname,'test-output','waveform-cache-'));
const reportPath=path.join(root,'report.json');
process.env.REPLAY_RECOVERY_DIR=path.join(root,'recovery');
app.disableHardwareAcceleration();app.commandLine.appendSwitch('force-device-scale-factor','1');
const seconds=24,sourceCount=6,N=48000*seconds,maxRounds=600;
const roundCount=Number(process.env.REPLAY_CACHE_ROUNDS??4);
assert(Number.isSafeInteger(roundCount)&&roundCount>=1&&roundCount<=maxRounds,`REPLAY_CACHE_ROUNDS must be an integer from 1 to ${maxRounds}`);
const watchdogMs=60000+roundCount*6000; // Startup allowance plus 6s/round; 120 rounds normally ~3min.
assert(10000+(maxRounds*50-1)*32+1600<=N,'all configured ranges fit 24-second source');
const sources=[];
for(let s=0;s<sourceCount;s++){
 const b=Buffer.alloc(44+N*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(192000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(N*4,40);
 const amplitude=3000+s*3000;for(let i=0;i<N;i++)b.writeInt16LE(Math.round(amplitude*Math.sin(2*Math.PI*(i%80)/80)),44+i*4+2);
 const file=path.join(root,`source-${s}.wav`);fs.writeFileSync(file,b);sources.push({file,url:pathToFileURL(file).href,amplitude,sha256:crypto.createHash('sha256').update(b).digest('hex')});
}
let settled=false,memoryTimer;const memorySamples=[];
function finish(status,detail){if(settled)return;settled=true;clearInterval(memoryTimer);const r={status,runId,startedAt,finishedAt:new Date().toISOString(),root,...detail};fs.writeFileSync(reportPath,JSON.stringify(r,null,2));console.log(JSON.stringify(r));app.exit(status==='PASS'?0:1);}
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{try{
 const js=s=>win.webContents.executeJavaScript(s);win.show();win.focus();
 for(let i=0;i<500;i++){if(await js('!!window.timelineTest?.model'))break;if(i===499)throw Error('editor init timeout');await new Promise(r=>setTimeout(r,20));}
 const rendererPid=win.webContents.getOSProcessId();
 const sample=()=>{try{const m=app.getAppMetrics().find(x=>x.pid===rendererPid);if(m)memorySamples.push({at:new Date().toISOString(),pid:m.pid,...m.memory});}catch(e){memorySamples.push({error:e.message});}};
 sample();memoryTimer=setInterval(sample,100);
 const result=await js(`(async()=>{
  const sources=${JSON.stringify(sources.map(s=>({url:s.url,amplitude:s.amplitude})))},roundCount=${roundCount};
  const loader=createWaveformLoader(),originalFetch=window.fetch,counts=Object.create(null),rounds=[],gaps=[];let previous=performance.now(),start=previous;
  // Instrument, do not replace decoding or bytes: every request reaches real file fetch.
  window.fetch=function(input,...args){const url=String(input);counts[url]=(counts[url]||0)+1;return originalFetch.call(this,input,...args);};
  const timer=setInterval(()=>{const now=performance.now();gaps.push(now-previous);previous=now;},16);
  function check(value,message){if(!value)throw Error(message);}
  function verify(result,source){check(result.peaks?.length===128,'missing real peaks '+JSON.stringify(result));const peak=Math.max(...result.peaks.map(x=>x[1]));check(Math.abs(peak-source.amplitude/32768)<.003,'wrong source envelope '+peak);return peak;}
  function stats(){const x=loader.stats;check(x.decodedBytes<=32*1024*1024,'decoded budget exceeded');check(x.peakEntries<=256,'peak entry budget exceeded');check(x.inFlight<=512,'pending bound exceeded');return x;}
  try{
   const first=await loader.load(sources[0].url,0,4800);verify(first,sources[0]);
   for(let round=0;round<roundCount;round++){
    const t=performance.now();
    // 300 distinct interval keys per round, on 6 URLs: cumulative decoded data >32MiB.
    for(let s=0;s<sources.length;s++){
     const requests=[];for(let j=0;j<50;j++){const offset=10000+(round*50+j)*32;check(offset>=0&&offset+1600<=${N},'range exceeds 24-second source');requests.push(loader.load(sources[s].url,offset,1600));}
     check(loader.stats.inFlight>0,'expected pending batch');stats();const results=await Promise.all(requests);for(const r of results)verify(r,sources[s]);
     check(stats().inFlight===0,'pending did not drain');
    }
    const before=counts[sources[0].url]||0,preRevisit=stats();check(preRevisit.peakEntries===256,'peak cache should reach capacity');
    const revisit=await loader.load(sources[0].url,0,4800);verify(revisit,sources[0]);
    check((counts[sources[0].url]||0)>before,'evicted first source must be fetched again');
    check(JSON.stringify(revisit.peaks)===JSON.stringify(first.peaks),'revisit output changed');
    const end=stats();check(end.inFlight===0,'revisit pending did not drain');
    rounds.push({round:round+1,elapsedMs:performance.now()-t,preRevisit,afterRevisit:end,firstSourceFetches:counts[sources[0].url]});
   }
   const sorted=gaps.slice().sort((a,b)=>a-b);check(sorted.length>0,'timer did not tick');
   return {elapsedMs:performance.now()-start,rounds,fetchCounts:counts,finalCache:stats(),timer:{intervalMs:16,ticks:sorted.length,maxGapMs:sorted.at(-1),p95GapMs:sorted[Math.floor((sorted.length-1)*.95)]}};
  }finally{clearInterval(timer);window.fetch=originalFetch;}
 })()`);
 sample();clearInterval(memoryTimer);
 const valid=memorySamples.filter(m=>Number.isFinite(m.workingSetSize));assert(valid.length>0,'renderer memory samples required');
 for(const source of sources)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source.file)).digest('hex'),source.sha256);
 assert.equal(result.rounds.length,roundCount);assert.equal(result.finalCache.inFlight,0);
  const summarize=xs=>({count:xs.length,from:xs[0].at,to:xs.at(-1).at,minWorkingSetKiB:Math.min(...xs.map(x=>x.workingSetSize)),maxWorkingSetKiB:Math.max(...xs.map(x=>x.workingSetSize)),meanWorkingSetKiB:xs.reduce((n,x)=>n+x.workingSetSize,0)/xs.length});
  const firstSamples=valid.slice(0,20),lastSamples=valid.slice(-20),firstWindow=summarize(firstSamples),lastWindow=summarize(lastSamples);
  const trend={windowSamples:20,firstSamples,lastSamples,firstWindow,lastWindow,meanWorkingSetDeltaKiB:lastWindow.meanWorkingSetKiB-firstWindow.meanWorkingSetKiB,interpretation:'observational first/last windows, not a leak test or GC guarantee'};
 finish('PASS',{scale:{sourceCount,secondsPerSource:seconds,channels:2,sampleRate:48000,decodedBytesPerSource:N*2*4,cumulativeDistinctDecodedBytes:N*2*4*sourceCount,roundCount,maxRounds,watchdogMs,rangeGeneration:{startSamples:10000,strideSamples:32,durationSamples:1600,maxEndSamples:10000+(roundCount*50-1)*32+1600,sourceSamples:N},uniqueIntervalRequests:sourceCount*50*roundCount,revisits:roundCount},result,memory:{rendererPid,sampleIntervalMs:100,unit:'KiB (Electron ProcessMemoryInfo)',sampleCount:valid.length,trend,first:valid[0],last:valid.at(-1),sampledMaxWorkingSetKiB:Math.max(...valid.map(m=>m.workingSetSize)),samples:memorySamples},sources,checks:['full editor production createWaveformLoader with real file fetch and AudioContext decode','six distinct URLs exceed decoded LRU byte budget','300 distinct peak keys each round exceed 256-entry LRU',`${roundCount} rounds preserve cache bounds and drain all in-flight requests`,'evicted source refetched each round and peaks exactly match first result','all source hashes preserved','renderer timer and OS process memory sampled'],limitations:['sampled memory maximum is not an absolute peak','no forced GC; memory return-to-baseline is not asserted',`single machine run, ${roundCount} rounds rather than multi-hour soak; no no-leak claim`,'timer gaps are observational, no strict latency target','direct loader exercise in full editor; not a native drag or canvas regression']});
 }catch(error){finish('FAIL',{error:error.stack||String(error),memorySamples});}}));
setTimeout(()=>finish('FAIL',{error:'sustained waveform watchdog expired',roundCount,watchdogMs,memorySamples}),watchdogMs).unref();
require('./main.cjs');app.setPath('userData',path.join(root,'profile'));app.setPath('sessionData',path.join(root,'profile'));
