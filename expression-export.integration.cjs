'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const out=path.join(__dirname,'runtime-output/expressions');fs.mkdirSync(out,{recursive:true});
const p=JSON.parse(fs.readFileSync(path.join(__dirname,'examples/rain-corridor.json'),'utf8').replace(/^\uFEFF/,''));
p.scene.durationFrames=90;p.scene.dialogues=[];p.scene.characters[0].visibleTo=90;
const c=p.scene.characters[0];c.expressions=[{id:'alternate',name:'Alternate test image',resourceId:p.scene.background.resourceId}];c.expressionEvents=[{id:'switch',frame:30,expressionId:'alternate'},{id:'reset',frame:60,expressionId:null}];
const input=path.join(out,'input.json');fs.writeFileSync(input,JSON.stringify({project:p,revision:3}));
function run(exe,args,log,env=process.env){const fd=fs.openSync(log,'w');try{const r=spawnSync(exe,args,{stdio:['ignore',fd,fd],env});if(r.error)throw r.error;assert.equal(r.status,0,log)}finally{fs.closeSync(fd)}}
run(path.join(__dirname,'../p0/node_modules/electron/dist/electron.exe'),[path.join(__dirname,'export-main.cjs')],path.join(out,'run.log'),{...process.env,REPLAY_EXPORT_INPUT:input,REPLAY_EXPORT_OUTPUT:out});
const frames=n=>fs.readFileSync(path.join(out,'frames',String(n).padStart(4,'0')+'.png'));
assert.deepEqual(frames(0),frames(29));assert.notDeepEqual(frames(29),frames(30));assert.deepEqual(frames(30),frames(59));assert.deepEqual(frames(0),frames(60));
const video=path.join(out,'p1-preview.mp4'),probe=path.join(out,'probe.json');run(path.join(__dirname,'../p0/tools/ffprobe.exe'),['-v','error','-count_frames','-show_streams','-of','json',video],probe);
const streams=JSON.parse(fs.readFileSync(probe,'utf8')).streams;assert.equal(Number(streams[0].nb_read_frames),90);assert.equal(Number(streams[0].duration),3);
const report={status:'PASS',frames:90,duration:3,checks:['default before frame30','switch at30','stable through59','reset at60','real exported PNG boundary comparison','MP4 frame count'],video};fs.writeFileSync(path.join(__dirname,'test-output/expression-export.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
