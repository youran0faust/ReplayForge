'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {createHash} = require('node:crypto');
const {validateProject} = require('./model.cjs');
const LIMIT = 256 * 1024 * 1024;
function ordinary(file, directory) {
  const absolute = path.resolve(file), root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const s = fs.lstatSync(current);
    if (s.isSymbolicLink() || (current !== absolute && !s.isDirectory())) throw Error('Video path must have ordinary ancestors');
  }
  const s = fs.lstatSync(absolute);
  if (directory ? !s.isDirectory() : !s.isFile()) throw Error('Video path is not an ordinary file/directory');
  return absolute;
}
function sourceFor(project, projectRoot, resourceId, localFrame) {
  let errors;
  try { errors = validateProject(project); } catch { throw Error('Invalid video project'); }
  if (errors.length) throw Error(`Invalid video project: ${errors.join('; ')}`);
  const r = project.resources.find(r => r.id === resourceId);
  if (!r || r.kind !== 'video' || r.mime !== 'video/mp4' || r.normalizationVersion !== 1 || r.fps !== 30 || !Number.isSafeInteger(r.frameCount) || r.frameCount < 1 || r.frameCount > 1800 || !Number.isSafeInteger(r.width) || !Number.isSafeInteger(r.height) || r.width < 1 || r.height < 1 || r.width > 4096 || r.height > 4096) throw Error('Invalid normalized video metadata');
  if (!Number.isSafeInteger(localFrame) || localFrame < 0 || localFrame >= r.frameCount) throw Error('Video frame out of bounds');
  const root = ordinary(projectRoot, true);
  if (typeof r.path !== 'string' || !r.path || r.path.includes('\\') || r.path.includes(':') || r.path.includes('\0') || path.isAbsolute(r.path) || r.path.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Unsafe video resource path');
  const file = path.resolve(root, r.path), relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Video path escapes project');
  ordinary(file, false);
  const stat = fs.statSync(file);
  const key = createHash('sha256').update(JSON.stringify([root, file, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, r])).digest('hex');
  return {r, file, key};
}
// FFmpeg writes concatenated PNGs to an owned disk descriptor, never a Node pipe.
// Chunk indexing lets us read just one exact frame into memory.
function indexPngs(file, r, maxBytes) {
  const size = fs.statSync(file).size;
  if (size > maxBytes) throw Error('Video frame cache budget exceeded');
  const fd = fs.openSync(file, 'r'), frames = [];
  const read = (at, length) => { const b = Buffer.alloc(length); if (fs.readSync(fd,b,0,length,at) !== length) throw Error('Truncated video PNG'); return b; };
  try {
    let at = 0;
    while (at < size) {
      const start = at;
      if (!read(at,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) throw Error('Invalid video PNG signature');
      at += 8; let first = true;
      for (;;) {
        const header = read(at,8), length = header.readUInt32BE(0), type = header.toString('ascii',4,8);
        if (length > size - at - 12) throw Error('Truncated video PNG chunk');
        if (first) { const ihdr=read(at+8,13); if(type!=='IHDR'||length!==13||ihdr.readUInt32BE(0)!==r.width||ihdr.readUInt32BE(4)!==r.height) throw Error('Video PNG dimensions mismatch'); first=false; }
        at += length + 12;
        if (type === 'IEND') break;
      }
      frames.push({offset:start,length:at-start});
      if (frames.length > r.frameCount) throw Error('Video frame count mismatch');
    }
    if (frames.length !== r.frameCount) throw Error('Video frame count mismatch');
    return frames;
  } finally { fs.closeSync(fd); }
}
function createVideoFrameProvider({cacheRoot, ffmpegPath, maxBytes = LIMIT, check = () => {}}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > LIMIT) throw Error('Invalid video cache budget');
  if (typeof ffmpegPath !== 'string' || !path.isAbsolute(ffmpegPath)) throw Error('FFmpeg must be an absolute trusted executable path');
  ordinary(cacheRoot,true);
  const owned = fs.mkdtempSync(path.join(cacheRoot,'video-frames-')), identity = fs.statSync(owned);
  let disposed=false, child=null, tail=Promise.resolve(), disposal, epoch=null, usedBytes=0;
  const cache=new Map();
  function removeOwned(file,identity){own();const s=fs.lstatSync(file);if(s.isSymbolicLink()||!s.isFile()||s.dev!==identity.dev||s.ino!==identity.ino)throw Error('Video cache file identity changed');fs.unlinkSync(file);}
  function clearCache(){own();for(const entry of cache.values())removeOwned(entry.file,entry.identity);cache.clear();usedBytes=0;}
  function syncProject(project,projectRoot){
    const root=ordinary(projectRoot,true);
    const signature=createHash('sha256').update(JSON.stringify([root,project])).digest('hex');
    if(epoch!==signature){clearCache();epoch=signature;}
  }
  function enqueue(task){const run=tail.then(task);tail=run.catch(()=>{});return run;}
  function checkpoint() { if(disposed) throw Error('Video frame provider disposed'); if(check() === false) throw Error('Video frame request cancelled'); }
  function own() { ordinary(owned,true); const s=fs.statSync(owned); if(s.dev!==identity.dev||s.ino!==identity.ino) throw Error('Video cache identity changed'); }
  async function decode(source) {
    checkpoint(); own();require('./video-media.cjs').assertSelfContainedMp4(source.file);
    // image2pipe checks -fs between packets; reserve a conservative RGBA PNG
    // packet bound so that the last packet cannot take disk usage over budget.
    const rawBytes=(source.r.width*4+1)*source.r.height;
    const packetBound=rawBytes+Math.ceil(rawBytes/16383)*5+65536;
    const remaining=maxBytes-usedBytes;
    if(packetBound>=remaining)throw Error('Video frame cache budget exceeded');
    const outputLimit=remaining-packetBound;
    const output=path.join(owned,source.key+'.pngs');
    const fd=fs.openSync(output,'wx'),outputIdentity=fs.fstatSync(fd);
    try {
      await new Promise((resolve,reject)=>{
        let failure=null, timer, poll;
        const stop = error => { failure ||= error; child?.kill(); };
        try {
          child=spawn(ffmpegPath,['-hide_banner','-loglevel','error','-nostdin','-noautorotate','-protocol_whitelist','file,pipe','-format_whitelist','mov','-enable_drefs','0','-use_absolute_path','0','-i',source.file,'-map','0:v:0','-an','-sn','-dn','-fps_mode','passthrough','-frames:v',String(source.r.frameCount+1),'-c:v','png','-pix_fmt','rgba','-threads','1','-f','image2pipe','-fs',String(outputLimit),'pipe:1'],{windowsHide:true,stdio:['ignore',fd,'inherit']});
          timer=setTimeout(()=>stop(Error('Video decode timeout (90s)')),90000);
          poll=setInterval(()=>{try{checkpoint();if(fs.fstatSync(fd).size>remaining)throw Error('Video frame cache budget exceeded');}catch(e){stop(e);}},25);
          child.once('error',e=>{failure=e;});
          child.once('close',code=>{clearTimeout(timer);clearInterval(poll);child=null; failure ? reject(failure) : code === 0 ? resolve() : reject(Error(`Video decode failed (${code})`));});
        } catch(e) {clearTimeout(timer);clearInterval(poll);child=null;reject(e);}
      });
      checkpoint();
    } catch(e) { fs.closeSync(fd);removeOwned(output,outputIdentity);throw e; }
    fs.closeSync(fd);
    own();const visible=fs.lstatSync(output);if(visible.dev!==outputIdentity.dev||visible.ino!==outputIdentity.ino)throw Error('Video cache file identity changed');
    try { const frames=indexPngs(output,source.r,remaining), size=fs.statSync(output).size; cache.set(source.key,{file:output,frames,size,identity:outputIdentity});usedBytes+=size; }
    catch(e){const limited=fs.statSync(output).size>=outputLimit;removeOwned(output,outputIdentity);if(limited)throw Error('Video frame cache budget exceeded');throw e;}
  }
  async function ensure(project,projectRoot,resourceId,localFrame){
    checkpoint();const source=sourceFor(project,projectRoot,resourceId,localFrame);
    // Remove obsolete signatures for this path, never return a former file revision.
    for(const [key,entry] of cache)if(entry.sourceFile===source.file&&key!==source.key){removeOwned(entry.file,entry.identity);usedBytes-=entry.size;cache.delete(key);}
    if(!cache.has(source.key))await decode(source);
    checkpoint();own();
    if(sourceFor(project,projectRoot,resourceId,localFrame).key!==source.key){clearCache();throw Error('Video source changed during decode');}
    const entry=cache.get(source.key);entry.sourceFile=source.file;return {source,entry};
  }
  function frame({project,projectRoot,resourceId,localFrame}) {
    return enqueue(async()=>{
      checkpoint();syncProject(project,projectRoot);
      const {source,entry}=await ensure(project,projectRoot,resourceId,localFrame);
      const item=entry.frames[localFrame],bytes=Buffer.alloc(item.length),fd=fs.openSync(entry.file,'r');
      try {const s=fs.fstatSync(fd);if(s.dev!==entry.identity.dev||s.ino!==entry.identity.ino||s.size!==entry.size)throw Error('Video cache file identity changed');if(fs.readSync(fd,bytes,0,item.length,item.offset)!==item.length)throw Error('Truncated cached frame');}finally{fs.closeSync(fd);}
      return {dataUrl:`data:image/png;base64,${bytes.toString('base64')}`,width:source.r.width,height:source.r.height,frameIndex:localFrame};
    });
  }
  function prepare({project,projectRoot}){
    return enqueue(async()=>{
      checkpoint();syncProject(project,projectRoot);
      const errors=validateProject(project);if(errors.length)throw Error(`Invalid video project: ${errors.join('; ')}`);
      const ids=[...new Set((project.scene.videoClips||[]).map(clip=>clip.resourceId))];
      try{for(const resourceId of ids)await ensure(project,projectRoot,resourceId,0);checkpoint();return {resourceCount:ids.length,bytes:usedBytes};}
      catch(error){clearCache();throw error;}
    });
  }
  function dispose() {
    if(disposal)return disposal;
    disposed=true; child?.kill();
    disposal=tail.finally(()=>{own();fs.rmSync(owned,{recursive:true,force:true});cache.clear();usedBytes=0;});
    return disposal;
  }
  return {frame,prepare,dispose};
}
module.exports={createVideoFrameProvider};
