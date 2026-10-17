'use strict';
// Former risk characterization is now a bounded timeout regression, not a hanging observation.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'preview.js'),'utf8');
const create=vm.runInNewContext(source.slice(source.indexOf('function createWaveformLoader('),source.indexOf('const waveformLoader = createWaveformLoader();'))+'\ncreateWaveformLoader',{setTimeout,clearTimeout,AbortController});
test('hung decode terminates loader and settles all subscribers without starting queued sources',{timeout:2000},async()=>{
 const started=[],loader=create({timeoutMs:20,decode:url=>{started.push(url);return new Promise(()=>{});},yieldTask:async()=>{}});
 const pending=[loader.load('hung'),loader.load('later')];let callbacks=0;
 for(let i=0;i<100;i++)pending.push(loader.load('hung').then(r=>{callbacks++;return r;}));
 for(let i=0;i<510;i++)pending.push(loader.load('queued-'+i));
 assert.equal(loader.stats.inFlight,512);assert.match((await loader.load('overflow')).reason,/队列已满/);
 const results=await Promise.all(pending);assert(results.every(r=>r.restartRequired&&r.peaks===null));assert.equal(callbacks,100);assert.deepEqual(started,['hung']);
 assert.equal(loader.stats.inFlight,0);assert.equal(loader.stats.decodedBytes,0);assert.equal(loader.stats.peakEntries,0);
 assert.equal((await loader.load('after')).restartRequired,true);assert.deepEqual(started,['hung']);
 console.log(JSON.stringify({status:'PASS',checks:['timeout settles 512 pending keys and duplicate subscribers','no subsequent decoder starts','terminal restart-required result','cache and pending counters cleared'],limitations:['injected never-settling decode','does not prove native decoder memory release']}));
});
