'use strict';
const fs = require('node:fs');
const path = require('node:path');
function rectangle(r) { return !!r && typeof r==='object' && ['x','y','width','height'].every(k=>Number.isSafeInteger(r[k])) && r.width>0 && r.height>0; }
function validateWindowState(value) {
  if (!value || typeof value!=='object' || Array.isArray(value) || value.version!==1 || typeof value.maximized!=='boolean' || !rectangle(value.normalBounds)) return null;
  if (Object.keys(value).some(k=>!['version','normalBounds','maximized'].includes(k)) || Object.keys(value.normalBounds).some(k=>!['x','y','width','height'].includes(k))) return null;
  const {x,y,width,height}=value.normalBounds;
  return {version:1,normalBounds:{x,y,width,height},maximized:value.maximized};
}
function loadWindowState(file) { try { if(fs.statSync(file).size>65536)return null; return validateWindowState(JSON.parse(fs.readFileSync(file,'utf8'))); } catch(_){return null;} }
function area(display) { return rectangle(display?.workArea)?display.workArea:null; }
function overlap(a,b) { return Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)); }
function distance(a,b) { const x=a.x+a.width/2,y=a.y+a.height/2;return Math.hypot(Math.max(b.x-x,0,x-b.x-b.width),Math.max(b.y-y,0,y-b.y-b.height)); }
function getWindowOptions({displays=[],primaryDisplay,saved}={}) {
  const primary=area(primaryDisplay)||displays.map(area).find(Boolean)||{x:0,y:0,width:1280,height:800};
  const screens=displays.map(area).filter(Boolean);if(!screens.length)screens.push(primary);
  const isPrimary=r=>['x','y','width','height'].every(k=>r[k]===primary[k]);
  screens.sort((a,b)=>Number(isPrimary(b))-Number(isPrimary(a)));
  const state=validateWindowState(saved);
  if(state){
    const bounds=state.normalBounds;
    const target=screens.reduce((best,next)=>overlap(bounds,next)>overlap(bounds,best)||(overlap(bounds,next)===overlap(bounds,best)&&distance(bounds,next)<distance(bounds,best))?next:best,screens[0]);
    const width=Math.min(bounds.width,target.width),height=Math.min(bounds.height,target.height);
    return {x:Math.max(target.x,Math.min(bounds.x,target.x+target.width-width)),y:Math.max(target.y,Math.min(bounds.y,target.y+target.height-height)),width,height,maximized:state.maximized};
  }
  // User-approved normal window: 1830x1206. Fit smaller work areas uniformly
  // with breathing room; do not constrain subsequent user resizing.
  const margin=32;
  const scale=Math.min(1,Math.max(1,primary.width-margin*2)/1830,Math.max(1,primary.height-margin*2)/1206);
  const width=Math.max(1,Math.floor(1830*scale));
  const height=Math.max(1,Math.floor(1206*scale));
  return {x:primary.x+Math.floor((primary.width-width)/2),y:primary.y+Math.floor((primary.height-height)/2),width,height,maximized:false};
}
function trackWindowState(win,file) {
  let last=null,disposed=false;
  function write(state){try{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n','utf8');return true;}catch(_){return false;}}
  function save(){
    if(disposed)return false;
    try{
      if(win.isDestroyed?.()||win.isMinimized?.()||win.isFullScreen?.())return false;
      const state=validateWindowState({version:1,normalBounds:win.getNormalBounds(),maximized:!!win.isMaximized()});
      if(!state)return false;last=state;return write(state);
    }catch(_){return false;}
  }
  const events=['move','resize','maximize','unmaximize','close'];
  function dispose(){if(disposed)return;disposed=true;for(const event of events)win.removeListener?.(event,save);win.removeListener?.('closed',closed);}
  function closed(){if(last)write(last);dispose();}
  for(const event of events)win.on?.(event,save);win.on?.('closed',closed);
  return {save,dispose};
}
module.exports={validateWindowState,getWindowOptions,loadWindowState,trackWindowState};
