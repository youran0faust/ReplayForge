'use strict';
// Synthetic tone fixtures, NOT recorded dialogue. Never overwrites existing files.
const fs=require('node:fs'),path=require('node:path');
const dir=path.join(__dirname,'素材','配音');fs.mkdirSync(dir,{recursive:true});
for(const [name,hz] of [['CHA_001_你终于来了.wav',440],['TRV_001_抱歉让你久等了.wav',550],['CHA_002_先进来坐吧.wav',660]]){
 const file=path.join(dir,name);const samples=4800,buffer=Buffer.alloc(44+samples*2);buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(48000,24);buffer.writeUInt32LE(96000,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)buffer.writeInt16LE(Math.round(1000*Math.sin(2*Math.PI*hz*i/48000)),44+i*2);
 if(fs.existsSync(file)){const s=fs.lstatSync(file);if(s.isSymbolicLink()||!s.isFile()||!fs.readFileSync(file).equals(buffer))throw Error('拒绝覆盖不同的已有文件：'+file);console.log('保持相同夹具：'+name);}else{fs.writeFileSync(file,buffer,{flag:'wx'});console.log('创建合成音夹具：'+name);}
}
