const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{EventEmitter}=require('node:events');
function minimalMp4(extra=0){const b=Buffer.alloc(24+extra);b.writeUInt32BE(b.length);b.write('ftyp',4);b.write('isom',8);return b;}
function fixture(t, options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'video-provider-test-'));
 fs.writeFileSync(path.join(root,'source.mp4'),minimalMp4());
 const resource={id:'v',kind:'video',mime:'video/mp4',path:'source.mp4',width:2,height:2,fps:30,frameCount:2,normalizationVersion:1};
 const project={schemaVersion:4,characterDefinitions:[],componentDefinitions:[],id:'test',design:{width:1280,height:720,fps:30},resources:[resource],scene:{durationFrames:60,background:{color:'#000'},characters:[],dialogues:[],audioTracks:[]}};
 let calls=0,argv,mode='ok';
 function png(marker){const sig=Buffer.from('89504e470d0a1a0a','hex'),ihdr=Buffer.alloc(25),iend=Buffer.alloc(12);ihdr.writeUInt32BE(13);ihdr.write('IHDR',4);ihdr.writeUInt32BE(2,8);ihdr.writeUInt32BE(2,12);ihdr[16]=marker;iend.write('IEND',4);return Buffer.concat([sig,ihdr,iend]);}
 const module={exports:{}};
 const fakeSpawn=(exe,args,spawnOptions)=>{calls++;argv=args;assert.equal(spawnOptions.stdio[0],'ignore');assert.equal(typeof spawnOptions.stdio[1],'number');const c=new EventEmitter();c.kill=()=>{setImmediate(()=>c.emit('close',1));};if(mode==='hang')return c;if(options.onSpawn)options.onSpawn(root,args);fs.writeSync(spawnOptions.stdio[1],mode==='bad'?Buffer.from('bad'):Buffer.concat([png(8),png(16)]));setImmediate(()=>c.emit('close',0));return c;};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'video-frame-provider.cjs'),'utf8'),{require:id=>id==='node:fs'&&options.fsOverride?options.fsOverride:id==='node:child_process'?{spawn:fakeSpawn}:id==='./model.cjs'?require('./model.cjs'):id==='./video-media.cjs'?require('./video-media.cjs'):require(id),module,Buffer,setInterval,clearInterval,setTimeout,clearTimeout});
 const provider=module.exports.createVideoFrameProvider({cacheRoot:root,ffmpegPath:path.resolve(root,'ffmpeg.exe'),...options});t.after(async()=>{try{await provider.dispose();}catch(error){if(!options.allowChangedCache)throw error;}finally{fs.rmSync(root,{recursive:true,force:true});}});
 return {root,project,resource,provider,calls:()=>calls,argv:()=>argv,mode:value=>{mode=value;},request:(localFrame=0)=>provider.frame({project,projectRoot:root,resourceId:'v',localFrame})};
}
function twoVideos(f){fs.writeFileSync(path.join(f.root,'second.mp4'),minimalMp4());f.project.resources.push({...f.resource,id:'second',path:'second.mp4'});f.project.scene.videoClips=[{id:'one',resourceId:'v',startFrame:0,endFrame:2},{id:'two',resourceId:'second',startFrame:2,endFrame:4}];}
test('prepare retains multiple videos and snapshot copies without redecoding',async t=>{const f=fixture(t);twoVideos(f);const ready=await f.provider.prepare({project:f.project,projectRoot:f.root});assert.equal(ready.resourceCount,2);assert.equal(f.calls(),2);for(const id of ['v','second','v','second'])await f.provider.frame({project:JSON.parse(JSON.stringify(f.project)),projectRoot:f.root,resourceId:id,localFrame:1});assert.equal(f.calls(),2);assert.equal(fs.readdirSync(path.join(f.root,fs.readdirSync(f.root).find(x=>x.startsWith('video-frames-')))).length,2);});
test('prepare total budget failure clears partial cache and cancellation never succeeds',async t=>{const f=fixture(t,{maxBytes:65630});twoVideos(f);await assert.rejects(f.provider.prepare({project:f.project,projectRoot:f.root}),/budget exceeded/);assert.equal(f.calls(),1);assert.equal(fs.readdirSync(path.join(f.root,fs.readdirSync(f.root).find(x=>x.startsWith('video-frames-')))).length,0);let cancelled=false;const g=fixture(t,{check:()=>!cancelled});twoVideos(g);g.mode('hang');const pending=g.provider.prepare({project:g.project,projectRoot:g.root});await new Promise(setImmediate);cancelled=true;await assert.rejects(pending,/cancelled/);});
test('external MP4 data references are rejected before decoder spawn',async t=>{const f=fixture(t);const atom=Buffer.alloc(28);atom.writeUInt32BE(28);atom.write('dref',4);atom.writeUInt32BE(1,12);atom.writeUInt32BE(12,16);atom.write('url ',20);fs.writeFileSync(path.join(f.root,'source.mp4'),Buffer.concat([minimalMp4(),atom]));await assert.rejects(f.request(),/external|data reference/i);assert.equal(f.calls(),0);});
test('HLS and concat disguised as MP4 never reach decoder',async t=>{const f=fixture(t);for(const text of ['#EXTM3U\n#EXTINF:1,\nhttps://example.test/private.ts\n',"ffconcat version 1.0\nfile '../private.mp4'\n"]){fs.writeFileSync(path.join(f.root,'source.mp4'),text);await assert.rejects(f.request(),/MP4|container/i);}assert.equal(f.calls(),0);});
test('decode failure cleanup preserves foreign replacement cache directory and file',async t=>{
 let foreign,replaced=false,owned;
 // Windows forbids renaming an ancestor while the decoder's FD is open.
 // Model that adversarial filesystem change through stat identity substitution;
 // the foreign marker is real and must survive both failure and disposal.
 const fsOverride={...fs,statSync(file,...args){const s=fs.statSync(file,...args);return replaced&&file===owned?{...s,dev:-12345}:s;}};
 const f=fixture(t,{allowChangedCache:true,fsOverride,onSpawn(root){owned=path.join(root,fs.readdirSync(root).find(x=>x.startsWith('video-frames-')));foreign=path.join(owned,'foreign-marker');fs.writeFileSync(foreign,'foreign must survive');replaced=true;}});
 f.mode('bad');await assert.rejects(f.request(),/identity changed/);assert.equal(fs.readFileSync(foreign,'utf8'),'foreign must survive');await assert.rejects(f.provider.dispose(),/identity changed/);assert.equal(fs.readFileSync(foreign,'utf8'),'foreign must survive');
});
test('parallel requests decode once, exact indexed frame, fixed safe argv',async t=>{const f=fixture(t);const [a,b,c]=await Promise.all([f.request(0),f.request(1),f.request(0)]);assert.equal(f.calls(),1);assert.equal(a.frameIndex,0);assert.equal(b.frameIndex,1);assert.notEqual(a.dataUrl,b.dataUrl);assert.equal(a.dataUrl,c.dataUrl);assert(f.argv().includes('-fps_mode'));assert(f.argv().includes('passthrough'));assert(!f.argv().includes('-ss'));await f.provider.dispose();assert.deepEqual(fs.readdirSync(f.root),['source.mp4']);await assert.rejects(f.request(),/disposed/);});
test('reject invalid metadata bounds and unsafe source paths before spawn',async t=>{const f=fixture(t);for(const n of [-1,2,0.1,NaN])await assert.rejects(f.request(n));for(const name of ['../outside.mp4','C:/outside.mp4','https://x/a','a\\b.mp4']){f.resource.path=name;await assert.rejects(f.request());}f.resource.path='source.mp4';f.resource.normalizationVersion=2;await assert.rejects(f.request());assert.equal(f.calls(),0);});
test('cache identity includes project root and file replacement; failure cannot reuse old frame',async t=>{const f=fixture(t);await f.request();fs.writeFileSync(path.join(f.root,'source.mp4'),minimalMp4(8));f.mode('bad');await assert.rejects(f.request(),/PNG/);f.mode('ok');await f.request();assert.equal(f.calls(),3);const other=path.join(f.root,'other');fs.mkdirSync(other);fs.writeFileSync(path.join(other,'source.mp4'),minimalMp4());await f.provider.frame({project:f.project,projectRoot:other,resourceId:'v',localFrame:0});assert.equal(f.calls(),4);});
const realFFmpeg=path.resolve(__dirname,'../../p0/tools/ffmpeg.exe');
test('real FFmpeg prepares two videos and serves random exact unique-color frames',{skip:!fs.existsSync(realFFmpeg)},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'video-frame-real-'));let provider;
 t.after(async()=>{await provider?.dispose();fs.rmSync(root,{recursive:true,force:true});});
 const {spawnSync}=require('node:child_process');
 function run(args){const r=spawnSync(realFFmpeg,['-hide_banner','-loglevel','error','-y',...args],{stdio:'inherit',windowsHide:true});assert.equal(r.status,0,r.error?.message);}
 const colors=[[255,0,0],[0,255,0],[0,0,255],[255,255,0],[255,0,255],[0,255,255]];
 for(let video=0;video<2;video++){
   const raw=Buffer.alloc(16*16*3*3);for(let n=0;n<3;n++)for(let pixel=0;pixel<256;pixel++)for(let c=0;c<3;c++)raw[n*768+pixel*3+c]=colors[video*3+n][c];
   const file=path.join(root,`${video}.rgb`);fs.writeFileSync(file,raw);
   run(['-f','rawvideo','-pixel_format','rgb24','-video_size','16x16','-framerate','30','-i',file,'-frames:v','3','-c:v','libx264','-pix_fmt','yuv420p',path.join(root,`${video}.mp4`)]);
 }
 const project={schemaVersion:4,id:'real',characterDefinitions:[],componentDefinitions:[],design:{width:1280,height:720,fps:30},resources:[0,1].map(n=>({id:String(n),kind:'video',path:`${n}.mp4`,mime:'video/mp4',width:16,height:16,fps:30,frameCount:3,normalizationVersion:1})),scene:{durationFrames:6,characters:[],dialogues:[],audioTracks:[],videoClips:[0,1].map(n=>({id:'c'+n,resourceId:String(n),startFrame:n*3,endFrame:n*3+3}))}};
 provider=require('./video-frame-provider.cjs').createVideoFrameProvider({cacheRoot:root,ffmpegPath:realFFmpeg});
 const prepared=await provider.prepare({project,projectRoot:root});assert.equal(prepared.resourceCount,2);assert(prepared.bytes>0);
 for(const [video,n] of [[1,2],[0,1],[1,0],[0,2],[1,1],[0,0]]){
   const frame=await provider.frame({project,projectRoot:root,resourceId:String(video),localFrame:n});assert.equal(frame.frameIndex,n);
   const png=path.join(root,'frame.png'),rgb=path.join(root,'frame.rgb');fs.writeFileSync(png,Buffer.from(frame.dataUrl.split(',')[1],'base64'));
   run(['-i',png,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24',rgb]);const actual=fs.readFileSync(rgb),expected=colors[video*3+n];for(let c=0;c<3;c++)assert(Math.abs(actual[c]-expected[c])<8,`${video}/${n} color ${actual.subarray(0,3)} expected ${expected}`);
 }
});
test('dispose terminates owned active decode and cleans only own directory',async t=>{const f=fixture(t);f.mode('hang');const pending=f.request();await new Promise(setImmediate);const disposing=f.provider.dispose();await assert.rejects(pending,/decode|disposed/);await disposing;assert(fs.existsSync(path.join(f.root,'source.mp4')));});
